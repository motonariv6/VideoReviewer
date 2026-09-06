import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { buildCoreSnapshot } from '../connect/core-snapshot-builder.js';
import { buildMediaLocators } from '../connect/media-locator-builder.js';
import { ConnectClient, DEFAULT_CONNECT_URL } from '../connect/connect-client.js';
import { handleConnectSync, els, setDbForTesting } from '../app.js';

export async function runCoreConnectSyncTests() {
  const results = [];

  const assert = (condition, message) => {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  };

  const runTest = async (name, fn) => {
    try {
      await fn();
      const res = { name, passed: true, error: null };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    } catch (e) {
      const res = { name, passed: false, error: e.message };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    }
  };

  console.group('Group 27: Core Connect Sync Tests');

  const createTestDb = (preset = {}) => {
    const memStorage = new MemoryStorage();
    for (const [key, val] of Object.entries(preset)) {
      memStorage.setItem('vreview_' + key, typeof val === 'string' ? val : JSON.stringify(val));
    }
    const testDb = new AppDatabase(memStorage, 'vreview_', 'TestDB-' + Math.random());
    testDb.idbAvailable = false;
    return { testDb, memStorage };
  };

  // Helper to set up standard mock db with local reviewer
  const setupStandardDb = async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();
    // Default local reviewer exists
    return testDb;
  };

  // Test 1: Snapshot version is exactly 1
  await runTest('1. Snapshot version is exactly 1', async () => {
    const db = await setupStandardDb();
    const snapshot = buildCoreSnapshot(db);
    assert(snapshot.snapshotVersion === 1, 'snapshotVersion must be integer 1');
  });

  // Test 2: generatedAt is valid ISO timestamp
  await runTest('2. generatedAt is valid ISO timestamp', async () => {
    const db = await setupStandardDb();
    const before = Date.now();
    const snapshot = buildCoreSnapshot(db);
    const after = Date.now();
    assert(typeof snapshot.generatedAt === 'string', 'generatedAt must be string');
    const parsed = Date.parse(snapshot.generatedAt);
    assert(!isNaN(parsed), 'generatedAt must be valid date');
    assert(parsed >= before - 1000 && parsed <= after + 1000, 'generatedAt must be close to current time');
    // Also test explicit generatedAt option
    const explicitTime = '2026-09-06T12:34:56.789Z';
    const snapshotExplicit = buildCoreSnapshot(db, { generatedAt: explicitTime });
    assert(snapshotExplicit.generatedAt === explicitTime, 'explicit generatedAt must be preserved');
  });

  // Test 3: localReviewer uses existing reviewerId/displayName
  await runTest('3. localReviewer uses existing reviewerId/displayName', async () => {
    const db = await setupStandardDb();
    const local = db.getLocalReviewer();
    db.updateLocalReviewerDisplayName('SyncTestUser');
    const snapshot = buildCoreSnapshot(db);
    assert(snapshot.localReviewer, 'localReviewer must exist');
    assert(snapshot.localReviewer.reviewerId === local.id, 'reviewerId must match db.getLocalReviewer().id');
    assert(snapshot.localReviewer.displayName === 'SyncTestUser', 'displayName must match updated name');

    // Fail safely if local reviewer is missing
    const { testDb: emptyDb } = createTestDb();
    emptyDb.reviewers = [];
    let caught = false;
    try {
      buildCoreSnapshot(emptyDb);
    } catch (e) {
      caught = true;
      assert(e.message.includes('ローカルレビュアー'), 'Must throw error on missing reviewer');
    }
    assert(caught, 'Must fail safely when local reviewer is missing');
  });

  // Test 4 & 5: Only local reviewer rating is exported; other reviewer ratings are ignored
  await runTest('4 & 5. Only local reviewer rating is exported and other reviewer ratings are ignored', async () => {
    const db = await setupStandardDb();
    const local = db.getLocalReviewer();
    const assetId = 'ast-multi-rev-1';

    db.mediaAssets.push({
      id: assetId,
      contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
      hashStatus: 'completed',
      duration: 120,
      displayTitle: 'Multi Review Video'
    });

    // Local review with score 4
    db.reviews.push({
      id: 'rev-local-1',
      mediaAssetId: assetId,
      reviewerId: local.id,
      origin: 'local',
      overallScore: 4
    });

    // Remote review with score 5
    db.reviews.push({
      id: 'rev-remote-1',
      mediaAssetId: assetId,
      reviewerId: 'reviewer-other-9999',
      origin: 'imported',
      overallScore: 5
    });

    const snapshot = buildCoreSnapshot(db);
    const videoDto = snapshot.videos.find(v => v.mediaAssetId === assetId);
    assert(videoDto, 'Video DTO must be found');
    assert(videoDto.rating !== null, 'Rating must not be null');
    assert(videoDto.rating.value === 4, 'Rating value must be local rating (4), not remote (5)');
    assert(videoDto.rating.reviewer.reviewerId === local.id, 'Rating reviewerId must be local reviewer ID');
    assert(videoDto.rating.reviewer.displayName === local.displayName, 'Rating reviewer displayName must match local');
  });

  // Test 6: Unrated media returns rating=null
  await runTest('6. Unrated media returns rating=null', async () => {
    const db = await setupStandardDb();
    const local = db.getLocalReviewer();
    const assetId1 = 'ast-unrated-1'; // no review at all
    const assetId2 = 'ast-unrated-2'; // review exists but overallScore is null

    db.mediaAssets.push({
      id: assetId1,
      duration: 60,
      displayTitle: 'Unrated 1'
    });
    db.mediaAssets.push({
      id: assetId2,
      duration: 60,
      displayTitle: 'Unrated 2'
    });

    db.reviews.push({
      id: 'rev-unrated-2',
      mediaAssetId: assetId2,
      reviewerId: local.id,
      origin: 'local',
      overallScore: null
    });

    const snapshot = buildCoreSnapshot(db);
    const dto1 = snapshot.videos.find(v => v.mediaAssetId === assetId1);
    const dto2 = snapshot.videos.find(v => v.mediaAssetId === assetId2);

    assert(dto1 && dto1.rating === null, 'Media without review must have rating=null');
    assert(dto2 && dto2.rating === null, 'Media with null overallScore must have rating=null');
  });

  // Test 7 & 8: Rating object structure and numeric value preservation
  await runTest('7 & 8. Rating object includes local reviewer identity and preserves valid numeric value', async () => {
    const db = await setupStandardDb();
    const local = db.getLocalReviewer();
    local.displayName = 'RatingReviewer';
    const assetId = 'ast-rating-val';

    db.mediaAssets.push({
      id: assetId,
      duration: 100,
      displayTitle: 'Rating Test Video'
    });
    db.reviews.push({
      id: 'rev-rating-1',
      mediaAssetId: assetId,
      reviewerId: local.id,
      origin: 'local',
      overallScore: 3
    });

    const snapshot = buildCoreSnapshot(db);
    const dto = snapshot.videos.find(v => v.mediaAssetId === assetId);
    assert(dto.rating.value === 3, 'Rating value must be 3');
    assert(typeof dto.rating.value === 'number', 'Rating value must be typeof number');
    assert(dto.rating.reviewer.reviewerId === local.id, 'reviewerId must match');
    assert(dto.rating.reviewer.displayName === 'RatingReviewer', 'displayName must match');
  });

  // Test 9: displayTitle uses current canonical UI behavior
  await runTest('9. displayTitle uses current canonical UI behavior', async () => {
    const db = await setupStandardDb();
    
    // Video A: has user-edited displayTitle
    db.mediaAssets.push({
      id: 'ast-title-a',
      displayTitle: 'Custom Title A'
    });
    db.fileLocations.push({
      id: 'loc-title-a',
      mediaAssetId: 'ast-title-a',
      fileName: 'raw_filename_a.mp4',
      availabilityStatus: 'available'
    });

    // Video B: no displayTitle, has location fileName
    db.mediaAssets.push({
      id: 'ast-title-b',
      displayTitle: ''
    });
    db.fileLocations.push({
      id: 'loc-title-b',
      mediaAssetId: 'ast-title-b',
      fileName: 'raw_filename_b.mp4',
      availabilityStatus: 'available'
    });

    // Video C: no displayTitle, no location
    db.mediaAssets.push({
      id: 'ast-title-c',
      displayTitle: null
    });

    const snapshot = buildCoreSnapshot(db);
    const dtoA = snapshot.videos.find(v => v.mediaAssetId === 'ast-title-a');
    const dtoB = snapshot.videos.find(v => v.mediaAssetId === 'ast-title-b');
    const dtoC = snapshot.videos.find(v => v.mediaAssetId === 'ast-title-c');

    assert(dtoA.displayTitle === 'Custom Title A', 'User displayTitle should be preferred');
    assert(dtoB.displayTitle === 'raw_filename_b.mp4', 'Fallback to fileName when displayTitle is empty');
    assert(dtoC.displayTitle === '不明な動画' || dtoC.displayTitle === 'Unknown', 'Fallback to default title when no fileName');
  });

  // Test 10: tags serialize as [] when empty
  await runTest('10. tags serialize as [] when empty and preserves tag text', async () => {
    const db = await setupStandardDb();
    const local = db.getLocalReviewer();
    
    // Video with tags
    const assetId1 = 'ast-tag-1';
    db.mediaAssets.push({ id: assetId1 });
    db.reviews.push({ id: 'rev-tag-1', mediaAssetId: assetId1, reviewerId: local.id, origin: 'local' });
    db.tags.push({ id: 't-1', name: 'Action' }, { id: 't-2', name: 'Sci-Fi' });
    db.reviewTags.push({ id: 'rt-1', videoReviewId: 'rev-tag-1', tagId: 't-1' });
    db.reviewTags.push({ id: 'rt-2', videoReviewId: 'rev-tag-1', tagId: 't-2' });

    // Video without tags
    const assetId2 = 'ast-tag-2';
    db.mediaAssets.push({ id: assetId2 });

    const snapshot = buildCoreSnapshot(db);
    const dto1 = snapshot.videos.find(v => v.mediaAssetId === assetId1);
    const dto2 = snapshot.videos.find(v => v.mediaAssetId === assetId2);

    assert(Array.isArray(dto1.tags), 'Tags must be array');
    assert(dto1.tags.length === 2 && dto1.tags.includes('Action') && dto1.tags.includes('Sci-Fi'), 'Tags text preserved');
    assert(Array.isArray(dto2.tags) && dto2.tags.length === 0, 'Tags must serialize as [] when empty');
  });

  // Test 11 & 12: durationSeconds preserves numeric/fractional value; null if unavailable
  await runTest('11 & 12. durationSeconds preserves numeric/fractional value and null if unavailable', async () => {
    const db = await setupStandardDb();
    
    db.mediaAssets.push({ id: 'ast-dur-1', duration: 723.45 });
    db.mediaAssets.push({ id: 'ast-dur-2', duration: 0 });
    db.mediaAssets.push({ id: 'ast-dur-3', duration: null });
    db.mediaAssets.push({ id: 'ast-dur-4', duration: undefined });

    const snapshot = buildCoreSnapshot(db);
    const dto1 = snapshot.videos.find(v => v.mediaAssetId === 'ast-dur-1');
    const dto2 = snapshot.videos.find(v => v.mediaAssetId === 'ast-dur-2');
    const dto3 = snapshot.videos.find(v => v.mediaAssetId === 'ast-dur-3');
    const dto4 = snapshot.videos.find(v => v.mediaAssetId === 'ast-dur-4');

    assert(dto1.durationSeconds === 723.45, 'Fractional duration must be preserved');
    assert(dto2.durationSeconds === null, '0 duration must return null');
    assert(dto3.durationSeconds === null, 'null duration must return null');
    assert(dto4.durationSeconds === null, 'undefined duration must return null');
  });

  // Test 13, 14, 15, 16: timelineNotes include only local reviewer notes, exclude others, preserve fractional timestamp, [] when empty
  await runTest('13-16. timelineNotes include only local reviewer notes, preserve fractional timestamp, [] when empty', async () => {
    const db = await setupStandardDb();
    const local = db.getLocalReviewer();
    const assetId = 'ast-notes-1';

    db.mediaAssets.push({ id: assetId, displayTitle: 'Notes Test' });
    
    // Local review with notes
    const localRevId = 'rev-notes-local';
    db.reviews.push({ id: localRevId, mediaAssetId: assetId, reviewerId: local.id, origin: 'local' });
    db.timelineNotes.push({
      id: 'note-loc-1',
      videoReviewId: localRevId,
      timestampSeconds: 125.25,
      comment: 'Local note 1'
    });
    db.timelineNotes.push({
      id: 'note-loc-2',
      videoReviewId: localRevId,
      timestampSeconds: 30.5,
      comment: 'Local note 2'
    });

    // Other review with notes
    const otherRevId = 'rev-notes-other';
    db.reviews.push({ id: otherRevId, mediaAssetId: assetId, reviewerId: 'reviewer-other-0000', origin: 'imported' });
    db.timelineNotes.push({
      id: 'note-other-1',
      videoReviewId: otherRevId,
      timestampSeconds: 50.0,
      comment: 'Other reviewer note should be excluded'
    });

    // Second video with no notes
    db.mediaAssets.push({ id: 'ast-notes-2', displayTitle: 'No Notes' });

    const snapshot = buildCoreSnapshot(db);
    const dto1 = snapshot.videos.find(v => v.mediaAssetId === assetId);
    const dto2 = snapshot.videos.find(v => v.mediaAssetId === 'ast-notes-2');

    assert(Array.isArray(dto1.timelineNotes), 'timelineNotes must be array');
    assert(dto1.timelineNotes.length === 2, 'Only 2 local notes should be included');
    assert(dto1.timelineNotes.find(n => n.id === 'note-loc-1'), 'note-loc-1 must be present');
    assert(dto1.timelineNotes.find(n => n.id === 'note-loc-2'), 'note-loc-2 must be present');
    assert(!dto1.timelineNotes.find(n => n.id === 'note-other-1'), 'Other reviewer note must be excluded');

    const note1 = dto1.timelineNotes.find(n => n.id === 'note-loc-1');
    assert(note1.timestampSeconds === 125.25, 'Fractional timestamp 125.25 preserved');
    assert(note1.comment === 'Local note 1', 'Comment preserved');

    assert(Array.isArray(dto2.timelineNotes) && dto2.timelineNotes.length === 0, 'Empty timelineNotes must be []');
  });

  // Test 17: posterUrl is always null
  await runTest('17. posterUrl is always null in Milestone 3B', async () => {
    const db = await setupStandardDb();
    db.mediaAssets.push({
      id: 'ast-poster-test',
      thumbnailId: 'img-12345',
      customPosterId: 'img-67890'
    });

    const snapshot = buildCoreSnapshot(db);
    for (const v of snapshot.videos) {
      assert(v.posterUrl === null, `posterUrl for ${v.mediaAssetId} must be null`);
    }
  });

  // Test 18 & 19: No local path or internal fields appear in snapshot DTO; mediaAssetId uses canonical ID
  await runTest('18 & 19. No local path or internal DB fields appear in snapshot DTO', async () => {
    const db = await setupStandardDb();
    const assetId = 'ast-clean-boundary';

    db.mediaAssets.push({
      id: assetId,
      contentHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      quickHash: 'qhash123',
      fileSize: 999999,
      genreId: 'genre-private',
      identityStatus: 'normal'
    });
    db.fileLocations.push({
      id: 'loc-clean-1',
      mediaAssetId: assetId,
      directoryId: 'dir-private-1',
      relativePath: 'secret/path/to/movie.mp4',
      fileName: 'movie.mp4',
      availabilityStatus: 'available'
    });

    const snapshot = buildCoreSnapshot(db);
    const dto = snapshot.videos.find(v => v.mediaAssetId === assetId);

    assert(dto.mediaAssetId === assetId, 'mediaAssetId must match canonical asset id');
    // Verify no internal fields leaked
    assert(dto.relativePath === undefined, 'relativePath must not appear');
    assert(dto.directoryId === undefined, 'directoryId must not appear');
    assert(dto.locations === undefined, 'locations must not appear');
    assert(dto.filePath === undefined, 'filePath must not appear');
    assert(dto.quickHash === undefined, 'quickHash must not appear');
    assert(dto.genreId === undefined, 'genreId must not appear');
    assert(dto.identityStatus === undefined, 'identityStatus must not appear');

    // Confirm allowed keys only
    const allowedKeys = ['mediaAssetId', 'displayTitle', 'posterUrl', 'rating', 'tags', 'durationSeconds', 'timelineNotes'];
    const actualKeys = Object.keys(dto);
    for (const k of actualKeys) {
      assert(allowedKeys.includes(k), `Unexpected key '${k}' found on video DTO`);
    }
  });

  // Test 20 & 21: ConnectClient sends POST to isolated URL with Content-Type application/json
  await runTest('20 & 21. ConnectClient sends POST to isolated URL with application/json header', async () => {
    let capturedUrl = '';
    let capturedOptions = {};

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', snapshotVersion: 1, videoCount: 3 })
      };
    };

    const client = new ConnectClient(DEFAULT_CONNECT_URL, { fetchFn: mockFetch });
    assert(DEFAULT_CONNECT_URL === 'http://127.0.0.1:8765', 'DEFAULT_CONNECT_URL must be http://127.0.0.1:8765');

    const fakeSnapshot = { snapshotVersion: 1, generatedAt: new Date().toISOString(), localReviewer: {}, videos: [] };
    const res = await client.sendSnapshot(fakeSnapshot);

    assert(capturedUrl === 'http://127.0.0.1:8765/api/v1/core/snapshot', 'Must target exact endpoint');
    assert(capturedOptions.method === 'POST', 'Must be POST');
    assert(capturedOptions.headers['Content-Type'] === 'application/json', 'Must have Content-Type: application/json');
    assert(JSON.parse(capturedOptions.body).snapshotVersion === 1, 'Body must serialize snapshot');
    assert(res.status === 'ok' && res.videoCount === 3, 'Result must be returned');
  });

  // Test 22: Successful JSON response is parsed
  await runTest('22. Successful JSON response is parsed', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', snapshotVersion: 1, videoCount: 42 })
    });

    const client = new ConnectClient(DEFAULT_CONNECT_URL, { fetchFn: mockFetch });
    const result = await client.sendSnapshot({ snapshotVersion: 1 });
    assert(result.status === 'ok', 'Status must be ok');
    assert(result.videoCount === 42, 'videoCount must be 42');
  });

  // Test 23: Non-2xx response becomes a clear error
  await runTest('23. Non-2xx response becomes a clear error', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Invalid snapshot schema' })
    });

    const client = new ConnectClient(DEFAULT_CONNECT_URL, { fetchFn: mockFetch });
    let caught = false;
    try {
      await client.sendSnapshot({ snapshotVersion: 1 });
    } catch (e) {
      caught = true;
      assert(e.message.includes('422'), 'Error must contain status code 422');
      assert(e.message.includes('Invalid snapshot schema'), 'Error must contain server detail');
    }
    assert(caught, 'Must throw error on non-2xx');
  });

  // Test 24: Network failure becomes a clear error
  await runTest('24. Network failure becomes a clear error', async () => {
    const mockFetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    const client = new ConnectClient(DEFAULT_CONNECT_URL, { fetchFn: mockFetch });
    let caught = false;
    try {
      await client.sendSnapshot({ snapshotVersion: 1 });
    } catch (e) {
      caught = true;
      assert(e.message.includes('Connectに接続できません'), 'Error must contain Japanese connection failure message');
      assert(e.message.includes('Failed to fetch'), 'Error must contain underlying network message');
    }
    assert(caught, 'Must throw error on network failure');
  });

  // Test 25: Concurrent Settings sync actions are prevented and button disabled appropriately
  await runTest('25. Concurrent Settings sync actions are prevented and button disabled appropriately', async () => {
    const db = await setupStandardDb();
    setDbForTesting(db);

    // Mock UI elements in test environment
    const fakeBtn = { disabled: false, addEventListener: () => {} };
    const fakeStatus = { textContent: '', style: {} };
    els.settingsBtnConnectSync = fakeBtn;
    els.settingsConnectSyncStatus = fakeStatus;

    // Trigger handleConnectSync with a fetch that takes time on the first call
    let resolveFirstFetch;
    let fetchCalls = 0;
    const slowFetch = () => new Promise(resolve => {
      fetchCalls++;
      if (fetchCalls === 1) {
        resolveFirstFetch = resolve;
      } else {
        resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', locatorVersion: 1, mediaCount: 5 })
        });
      }
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = slowFetch;

    try {
      const syncPromise1 = handleConnectSync();
      assert(fakeBtn.disabled === true, 'Button must be disabled while sync is active');
      assert(fakeStatus.textContent.includes('同期中'), 'Status must indicate syncing');

      // Attempt concurrent second sync click
      const syncPromise2 = handleConnectSync();
      assert(fetchCalls === 1, 'Concurrent sync must be rejected immediately (fetchCalls === 1)');

      // Complete the first fetch
      resolveFirstFetch({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', snapshotVersion: 1, videoCount: 5 })
      });

      await syncPromise1;
      await syncPromise2;

      assert(fakeBtn.disabled === false, 'Button must be re-enabled after sync completes');
      assert(fakeStatus.textContent.includes('同期完了'), 'Status must show completion: ' + fakeStatus.textContent);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // Test 26: Full sync sends snapshot first, then media locators in sequence
  await runTest('26. Full sync sends snapshot first, then media locators in sequence', async () => {
    const db = await setupStandardDb();
    setDbForTesting(db);

    db.mediaAssets.push({ id: 'ast-seq-1', displayTitle: 'Sequence Test Video', duration: 120 });
    db.fileLocations.push({ id: 'loc-seq-1', mediaAssetId: 'ast-seq-1', directoryId: 'dir-seq', relativePath: 'seq.mp4' });

    const fakeBtn = { disabled: false, addEventListener: () => {} };
    const fakeStatus = { textContent: '', style: {} };
    els.settingsBtnConnectSync = fakeBtn;
    els.settingsConnectSyncStatus = fakeStatus;

    const capturedRequests = [];
    const mockFetch = async (url, options) => {
      capturedRequests.push({
        url,
        method: options.method,
        body: JSON.parse(options.body),
        timestamp: Date.now()
      });
      if (url.includes('/api/v1/core/snapshot')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', snapshotVersion: 1, videoCount: 1 })
        };
      }
      if (url.includes('/api/v1/core/media-locators')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', locatorVersion: 1, mediaCount: 1 })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await handleConnectSync();

      assert(capturedRequests.length === 2, 'Exactly two requests must be sent (snapshot then locators)');
      assert(capturedRequests[0].url.endsWith('/api/v1/core/snapshot'), 'Request 1 must be snapshot endpoint');
      assert(capturedRequests[1].url.endsWith('/api/v1/core/media-locators'), 'Request 2 must be media-locators endpoint');
      assert(capturedRequests[0].body.snapshotVersion === 1, 'Request 1 payload must be snapshot version 1');
      assert(capturedRequests[1].body.locatorVersion === 1, 'Request 2 payload must be locator version 1');
      assert(fakeStatus.textContent.includes('同期完了'), 'Status must show completion');
      assert(fakeBtn.disabled === false, 'Button must be re-enabled');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // Test 27: Both payload builders are invoked and output formats match expected contracts
  await runTest('27. Both payload builders are invoked with exact contract structures', async () => {
    const db = await setupStandardDb();
    setDbForTesting(db);

    db.mediaAssets.push({ id: 'ast-payload-1', displayTitle: 'Payload Test', duration: 300 });
    db.fileLocations.push({ id: 'loc-payload-1', mediaAssetId: 'ast-payload-1', directoryId: 'dir-pay', relativePath: 'pay.mp4' });

    const fakeBtn = { disabled: false, addEventListener: () => {} };
    const fakeStatus = { textContent: '', style: {} };
    els.settingsBtnConnectSync = fakeBtn;
    els.settingsConnectSyncStatus = fakeStatus;

    let snapshotPayload = null;
    let locatorsPayload = null;

    const mockFetch = async (url, options) => {
      const parsed = JSON.parse(options.body);
      if (url.includes('/api/v1/core/snapshot')) {
        snapshotPayload = parsed;
        return { ok: true, status: 200, json: async () => ({ status: 'ok', snapshotVersion: 1, videoCount: 1 }) };
      }
      if (url.includes('/api/v1/core/media-locators')) {
        locatorsPayload = parsed;
        return { ok: true, status: 200, json: async () => ({ status: 'ok', locatorVersion: 1, mediaCount: 1 }) };
      }
      throw new Error(`Unexpected endpoint: ${url}`);
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await handleConnectSync();

      assert(snapshotPayload !== null, 'Snapshot payload must be built');
      assert(snapshotPayload.snapshotVersion === 1, 'snapshotVersion must be 1');
      assert(snapshotPayload.videos.some(v => v.mediaAssetId === 'ast-payload-1'), 'Video must be present in snapshot');
      assert(snapshotPayload.videos[0].relativePath === undefined, 'No relativePath in public snapshot');
      assert(snapshotPayload.videos[0].directoryId === undefined, 'No directoryId in public snapshot');

      assert(locatorsPayload !== null, 'Locators payload must be built');
      assert(locatorsPayload.locatorVersion === 1, 'locatorVersion must be 1');
      const mediaEntry = locatorsPayload.media.find(m => m.mediaAssetId === 'ast-payload-1');
      assert(mediaEntry, 'Media entry must be in locator payload');
      assert(mediaEntry.locations[0].directoryId === 'dir-pay', 'directoryId must match');
      assert(mediaEntry.locations[0].relativePath === 'pay.mp4', 'relativePath must match');
      assert(mediaEntry.rating === undefined, 'No rating in locators');
      assert(mediaEntry.tags === undefined, 'No tags in locators');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // Test 28: Snapshot failure prevents media locator sync and avoids false success
  await runTest('28. Snapshot failure prevents media locator sync and avoids false success', async () => {
    const db = await setupStandardDb();
    setDbForTesting(db);

    const fakeBtn = { disabled: false, addEventListener: () => {} };
    const fakeStatus = { textContent: '', style: {} };
    els.settingsBtnConnectSync = fakeBtn;
    els.settingsConnectSyncStatus = fakeStatus;

    let locatorFetchAttempted = false;
    const mockFetch = async (url) => {
      if (url.includes('/api/v1/core/snapshot')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: 'Database unavailable' })
        };
      }
      if (url.includes('/api/v1/core/media-locators')) {
        locatorFetchAttempted = true;
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      throw new Error(`Unexpected endpoint: ${url}`);
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await handleConnectSync();

      assert(locatorFetchAttempted === false, 'Media locator sync must NOT be attempted when snapshot fails');
      assert(!fakeStatus.textContent.includes('同期完了'), 'Must NOT report success');
      assert(fakeStatus.textContent.includes('同期に失敗しました') || fakeStatus.textContent.includes('Database unavailable'), 'Must display error message');
      assert(fakeBtn.disabled === false, 'Button must be re-enabled');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // Test 29: Locator failure after snapshot success reports partial failure
  await runTest('29. Locator failure after snapshot success reports partial failure', async () => {
    const db = await setupStandardDb();
    setDbForTesting(db);

    const fakeBtn = { disabled: false, addEventListener: () => {} };
    const fakeStatus = { textContent: '', style: {} };
    els.settingsBtnConnectSync = fakeBtn;
    els.settingsConnectSyncStatus = fakeStatus;

    let snapshotSucceeded = false;
    let locatorAttempted = false;

    const mockFetch = async (url) => {
      if (url.includes('/api/v1/core/snapshot')) {
        snapshotSucceeded = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', snapshotVersion: 1, videoCount: 3 })
        };
      }
      if (url.includes('/api/v1/core/media-locators')) {
        locatorAttempted = true;
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: 'Disk full' })
        };
      }
      throw new Error(`Unexpected endpoint: ${url}`);
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await handleConnectSync();

      assert(snapshotSucceeded === true, 'Snapshot request must have succeeded');
      assert(locatorAttempted === true, 'Media locator request must have been attempted');
      assert(!fakeStatus.textContent.includes('同期完了'), 'Must NOT report success when locators fail');
      assert(fakeStatus.textContent.includes('メディアロケーター') || fakeStatus.textContent.includes('Disk full'), 'Must report partial locator failure');
      assert(fakeBtn.disabled === false, 'Button must be re-enabled');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  console.groupEnd();
  return results;
}
