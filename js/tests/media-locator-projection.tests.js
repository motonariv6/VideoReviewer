import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { buildMediaLocators, buildMediaLocatorProjection } from '../connect/media-locator-builder.js';
import { buildCoreSnapshot } from '../connect/core-snapshot-builder.js';
import { ConnectClient, DEFAULT_CONNECT_URL } from '../connect/connect-client.js';

export async function runMediaLocatorProjectionTests() {
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

  console.group('Group 28: Media Locator Projection Tests');

  const createTestDb = (preset = {}) => {
    const memStorage = new MemoryStorage();
    for (const [key, val] of Object.entries(preset)) {
      memStorage.setItem('vreview_' + key, typeof val === 'string' ? val : JSON.stringify(val));
    }
    const testDb = new AppDatabase(memStorage, 'vreview_', 'TestDB-' + Math.random());
    testDb.idbAvailable = false;
    return { testDb, memStorage };
  };

  const setupStandardDb = async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();
    return testDb;
  };

  // Test 1: Correct locatorVersion = 1
  await runTest('1. Correct locatorVersion = 1', async () => {
    const db = await setupStandardDb();
    const locators = buildMediaLocators(db);
    assert(locators.locatorVersion === 1, 'locatorVersion must be integer 1');
    assert(typeof buildMediaLocatorProjection === 'function', 'buildMediaLocatorProjection alias must exist');
    const locatorsAlias = buildMediaLocatorProjection(db);
    assert(locatorsAlias.locatorVersion === 1, 'alias must produce identical locatorVersion');
  });

  // Test 2: generatedAt is present and valid ISO timestamp
  await runTest('2. generatedAt is present and valid ISO timestamp', async () => {
    const db = await setupStandardDb();
    const before = Date.now();
    const locators = buildMediaLocators(db);
    const after = Date.now();

    assert(typeof locators.generatedAt === 'string', 'generatedAt must be a string');
    const parsed = Date.parse(locators.generatedAt);
    assert(!isNaN(parsed), 'generatedAt must be a valid ISO date');
    assert(parsed >= before - 1000 && parsed <= after + 1000, 'generatedAt must match current time window');

    // Explicit options.generatedAt
    const customTime = '2026-09-06T12:00:00.000Z';
    const locatorsCustom = buildMediaLocators(db, { generatedAt: customTime });
    assert(locatorsCustom.generatedAt === customTime, 'options.generatedAt must be preserved');
  });

  // Test 3: mediaAssetId comes from canonical media asset identity
  await runTest('3. mediaAssetId comes from canonical media asset identity', async () => {
    const db = await setupStandardDb();
    const canonicalId = 'vid-canonical-test-001';

    db.mediaAssets.push({
      id: canonicalId,
      displayTitle: 'Canonical Asset Test',
      duration: 100
    });
    db.fileLocations.push({
      id: 'loc-test-001',
      mediaAssetId: canonicalId,
      directoryId: 'dir-source-001',
      relativePath: 'Movies/sample.mp4',
      fileName: 'sample.mp4'
    });

    const locators = buildMediaLocators(db);
    assert(Array.isArray(locators.media), 'media must be an array');
    const entry = locators.media.find(m => m.mediaAssetId === canonicalId);
    assert(entry, 'Media entry with canonical ID must exist');
    assert(entry.mediaAssetId === canonicalId, 'mediaAssetId must match canonical asset id exactly');
  });

  // Test 4: One media asset with one location projects correctly
  await runTest('4. One media asset with one location projects correctly', async () => {
    const db = await setupStandardDb();
    const assetId = 'ast-single-loc-01';

    db.mediaAssets.push({
      id: assetId,
      displayTitle: 'Single Location Asset'
    });
    db.fileLocations.push({
      id: 'loc-single-01',
      mediaAssetId: assetId,
      directoryId: 'dir-main-01',
      relativePath: 'Travel/2026/vacation.mp4',
      fileName: 'vacation.mp4'
    });

    const locators = buildMediaLocators(db);
    const entry = locators.media.find(m => m.mediaAssetId === assetId);
    assert(entry, 'Asset must be projected');
    assert(entry.locations.length === 1, 'Locations length must be exactly 1');
    assert(entry.locations[0].directoryId === 'dir-main-01', 'directoryId must match');
    assert(entry.locations[0].relativePath === 'Travel/2026/vacation.mp4', 'relativePath must match');
  });

  // Test 5: One media asset with multiple locations preserves all locations
  await runTest('5. One media asset with multiple locations preserves all locations', async () => {
    const db = await setupStandardDb();
    const assetId = 'ast-multi-loc-01';

    db.mediaAssets.push({
      id: assetId,
      displayTitle: 'Multi Location Asset'
    });
    db.fileLocations.push({
      id: 'loc-multi-a',
      mediaAssetId: assetId,
      directoryId: 'dir-a',
      relativePath: 'Archives/tape1.mp4'
    });
    db.fileLocations.push({
      id: 'loc-multi-b',
      mediaAssetId: assetId,
      directoryId: 'dir-b',
      relativePath: 'Backup/tape1.mp4'
    });

    const locators = buildMediaLocators(db);
    const entry = locators.media.find(m => m.mediaAssetId === assetId);
    assert(entry, 'Asset must be projected');
    assert(entry.locations.length === 2, 'All 2 locations must be preserved');
    assert(entry.locations.some(l => l.directoryId === 'dir-a' && l.relativePath === 'Archives/tape1.mp4'), 'Location A must be present');
    assert(entry.locations.some(l => l.directoryId === 'dir-b' && l.relativePath === 'Backup/tape1.mp4'), 'Location B must be present');
  });

  // Test 6: directoryId is preserved exactly
  await runTest('6. directoryId is preserved exactly', async () => {
    const db = await setupStandardDb();
    const assetId = 'ast-dir-exact';
    const exactDirId = 'dir-exact-uuid-1234-5678-90ab';

    db.mediaAssets.push({ id: assetId });
    db.fileLocations.push({
      id: 'loc-dir-exact',
      mediaAssetId: assetId,
      directoryId: exactDirId,
      relativePath: 'test.mp4'
    });

    const locators = buildMediaLocators(db);
    const entry = locators.media.find(m => m.mediaAssetId === assetId);
    assert(entry.locations[0].directoryId === exactDirId, 'directoryId must not be modified or replaced with name');
  });

  // Test 7: normalized relativePath is preserved exactly
  await runTest('7. normalized relativePath is preserved exactly', async () => {
    const db = await setupStandardDb();
    const assetId = 'ast-path-norm';

    db.mediaAssets.push({ id: assetId });
    // Windows backslashes and redundant slashes
    db.fileLocations.push({
      id: 'loc-path-norm',
      mediaAssetId: assetId,
      directoryId: 'dir-norm',
      relativePath: '\\FolderA\\SubFolderB\\clip.mp4/'
    });

    const locators = buildMediaLocators(db);
    const entry = locators.media.find(m => m.mediaAssetId === assetId);
    assert(entry.locations[0].relativePath === 'FolderA/SubFolderB/clip.mp4', 'relativePath must normalize backslashes and outer slashes');
  });

  // Test 8: Public snapshot remains unchanged and does not expose locator fields
  await runTest('8. Public snapshot remains unchanged and does not expose locator fields', async () => {
    const db = await setupStandardDb();
    const assetId = 'ast-pub-intact';

    db.mediaAssets.push({
      id: assetId,
      displayTitle: 'Public Snapshot Invariance'
    });
    db.fileLocations.push({
      id: 'loc-pub-intact',
      mediaAssetId: assetId,
      directoryId: 'dir-secret',
      relativePath: 'secret/path.mp4'
    });

    const snapshot = buildCoreSnapshot(db);
    const pubVideo = snapshot.videos.find(v => v.mediaAssetId === assetId);
    assert(pubVideo, 'Video must exist in public snapshot');
    assert(pubVideo.locations === undefined, 'locations must NOT be in public snapshot');
    assert(pubVideo.directoryId === undefined, 'directoryId must NOT be in public snapshot');
    assert(pubVideo.relativePath === undefined, 'relativePath must NOT be in public snapshot');
    assert(pubVideo.handleKey === undefined, 'handleKey must NOT be in public snapshot');
  });

  // Test 9: Locator projection does not expose internal or sensitive fields
  await runTest('9. Locator projection does not expose absolute path, handleKey, FileSystemHandle, contentHash, or review metadata', async () => {
    const db = await setupStandardDb();
    const local = db.getLocalReviewer();
    const assetId = 'ast-leak-check';

    db.mediaAssets.push({
      id: assetId,
      displayTitle: 'Leak Check',
      contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      quickHash: 'qh-12345',
      hashStatus: 'completed',
      fileSize: 1048576,
      duration: 3600
    });
    db.fileLocations.push({
      id: 'loc-leak-check',
      mediaAssetId: assetId,
      directoryId: 'dir-leak',
      relativePath: 'media/video.mp4',
      fileName: 'video.mp4',
      fileSize: 1048576,
      handleKey: 'directory-handle-dir-leak',
      availabilityStatus: 'available'
    });
    db.reviews.push({
      id: 'rev-leak',
      mediaAssetId: assetId,
      reviewerId: local.id,
      overallScore: 5
    });

    const locators = buildMediaLocators(db);
    const entry = locators.media.find(m => m.mediaAssetId === assetId);

    // Assert top-level keys
    const allowedTopKeys = ['locatorVersion', 'generatedAt', 'media'];
    for (const key of Object.keys(locators)) {
      assert(allowedTopKeys.includes(key), `Top-level key '${key}' is not allowed`);
    }

    // Assert media entry keys
    const allowedMediaKeys = ['mediaAssetId', 'locations'];
    for (const key of Object.keys(entry)) {
      assert(allowedMediaKeys.includes(key), `Media key '${key}' is not allowed`);
    }

    // Assert location keys
    const allowedLocKeys = ['directoryId', 'relativePath'];
    for (const loc of entry.locations) {
      for (const key of Object.keys(loc)) {
        assert(allowedLocKeys.includes(key), `Location key '${key}' is not allowed`);
      }
    }

    // Explicit exclusions
    assert(entry.contentHash === undefined, 'contentHash must not be in media entry');
    assert(entry.quickHash === undefined, 'quickHash must not be in media entry');
    assert(entry.rating === undefined, 'rating must not be in media entry');
    assert(entry.tags === undefined, 'tags must not be in media entry');
    assert(entry.timelineNotes === undefined, 'timelineNotes must not be in media entry');
    assert(entry.locations[0].handleKey === undefined, 'handleKey must not be in location');
    assert(entry.locations[0].absolutePath === undefined, 'absolutePath must not be in location');
    assert(entry.locations[0].filePath === undefined, 'filePath must not be in location');
  });

  // Test 10: Empty library produces media: []
  await runTest('10. Empty library produces media: []', async () => {
    const db = await setupStandardDb();
    db.mediaAssets = [];
    db.fileLocations = [];

    const locators = buildMediaLocators(db);
    assert(locators.locatorVersion === 1, 'locatorVersion must be 1');
    assert(Array.isArray(locators.media) && locators.media.length === 0, 'media must be empty array []');
  });

  // Test 11: Stable deterministic ordering
  await runTest('11. Stable deterministic ordering for media entries and locations', async () => {
    const db = await setupStandardDb();

    // Insert media assets out of order
    db.mediaAssets.push({ id: 'vid-z-last' });
    db.mediaAssets.push({ id: 'vid-a-first' });
    db.mediaAssets.push({ id: 'vid-m-middle' });

    // Insert locations out of order
    db.fileLocations.push({ id: 'loc-1', mediaAssetId: 'vid-a-first', directoryId: 'dir-z', relativePath: 'b.mp4' });
    db.fileLocations.push({ id: 'loc-2', mediaAssetId: 'vid-a-first', directoryId: 'dir-a', relativePath: 'z.mp4' });
    db.fileLocations.push({ id: 'loc-3', mediaAssetId: 'vid-a-first', directoryId: 'dir-a', relativePath: 'a.mp4' });

    const locators = buildMediaLocators(db);

    // Media ordering
    assert(locators.media[0].mediaAssetId === 'vid-a-first', 'First media must be vid-a-first');
    assert(locators.media[1].mediaAssetId === 'vid-m-middle', 'Second media must be vid-m-middle');
    assert(locators.media[2].mediaAssetId === 'vid-z-last', 'Third media must be vid-z-last');

    // Location ordering within vid-a-first
    const aLocations = locators.media[0].locations;
    assert(aLocations.length === 3, 'Must have 3 locations');
    assert(aLocations[0].directoryId === 'dir-a' && aLocations[0].relativePath === 'a.mp4', 'First loc must be dir-a a.mp4');
    assert(aLocations[1].directoryId === 'dir-a' && aLocations[1].relativePath === 'z.mp4', 'Second loc must be dir-a z.mp4');
    assert(aLocations[2].directoryId === 'dir-z' && aLocations[2].relativePath === 'b.mp4', 'Third loc must be dir-z b.mp4');
  });

  // Test 12: Builder does not mutate database records
  await runTest('12. Builder does not mutate database records', async () => {
    const db = await setupStandardDb();
    db.mediaAssets.push({ id: 'ast-immut-1', displayTitle: 'Immutable' });
    db.fileLocations.push({ id: 'loc-immut-1', mediaAssetId: 'ast-immut-1', directoryId: 'dir-1', relativePath: 'a/b/c.mp4' });

    const snapshotBeforeAssets = JSON.stringify(db.mediaAssets);
    const snapshotBeforeLocs = JSON.stringify(db.fileLocations);

    buildMediaLocators(db);

    const snapshotAfterAssets = JSON.stringify(db.mediaAssets);
    const snapshotAfterLocs = JSON.stringify(db.fileLocations);

    assert(snapshotBeforeAssets === snapshotAfterAssets, 'db.mediaAssets must not be mutated');
    assert(snapshotBeforeLocs === snapshotAfterLocs, 'db.fileLocations must not be mutated');
  });

  // Test 13: Invalid or orphaned location records are safely excluded
  await runTest('13. Invalid or orphaned location records are safely excluded', async () => {
    const db = await setupStandardDb();
    const assetId = 'ast-valid-asset';

    db.mediaAssets.push({ id: assetId });

    // Valid location
    db.fileLocations.push({ id: 'loc-valid', mediaAssetId: assetId, directoryId: 'dir-valid', relativePath: 'valid/file.mp4' });

    // Invalid: missing directoryId
    db.fileLocations.push({ id: 'loc-bad-dir', mediaAssetId: assetId, directoryId: '', relativePath: 'file.mp4' });

    // Invalid: missing relativePath
    db.fileLocations.push({ id: 'loc-bad-path', mediaAssetId: assetId, directoryId: 'dir-valid', relativePath: '' });

    // Invalid: relativePath is only slashes
    db.fileLocations.push({ id: 'loc-slash-path', mediaAssetId: assetId, directoryId: 'dir-valid', relativePath: '///' });

    // Orphaned: points to nonexistent mediaAssetId
    db.fileLocations.push({ id: 'loc-orphan', mediaAssetId: 'ast-nonexistent', directoryId: 'dir-valid', relativePath: 'orphan.mp4' });

    const locators = buildMediaLocators(db);
    const entry = locators.media.find(m => m.mediaAssetId === assetId);

    assert(entry, 'Valid asset must exist');
    assert(entry.locations.length === 1, 'Only the single valid location must be included');
    assert(entry.locations[0].relativePath === 'valid/file.mp4', 'Valid location path preserved');

    const orphanEntry = locators.media.find(m => m.mediaAssetId === 'ast-nonexistent');
    assert(!orphanEntry, 'Orphaned location must not create a media entry');
  });

  // Test 14: ConnectClient.sendMediaLocators posts to correct endpoint with json header
  await runTest('14. ConnectClient.sendMediaLocators posts to correct endpoint with json header', async () => {
    let capturedUrl = '';
    let capturedOptions = {};

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', locatorVersion: 1, mediaCount: 2 })
      };
    };

    const client = new ConnectClient(DEFAULT_CONNECT_URL, { fetchFn: mockFetch });
    const dummyPayload = { locatorVersion: 1, generatedAt: new Date().toISOString(), media: [] };
    const res = await client.sendMediaLocators(dummyPayload);

    assert(capturedUrl === 'http://127.0.0.1:8765/api/v1/core/media-locators', 'Must target /api/v1/core/media-locators');
    assert(capturedOptions.method === 'POST', 'Must use POST method');
    assert(capturedOptions.headers['Content-Type'] === 'application/json', 'Must set Content-Type: application/json');
    assert(res.status === 'ok', 'Must parse JSON response');
  });

  // Test 15: ConnectClient.sendMediaLocators handles network errors cleanly
  await runTest('15. ConnectClient.sendMediaLocators handles network errors cleanly', async () => {
    const mockFetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    const client = new ConnectClient(DEFAULT_CONNECT_URL, { fetchFn: mockFetch });
    let caught = false;
    try {
      await client.sendMediaLocators({ locatorVersion: 1 });
    } catch (e) {
      caught = true;
      assert(e.message.includes('Connectに接続できません'), 'Must include connection failure prefix');
    }
    assert(caught, 'Must reject on network failure');
  });

  console.groupEnd();
  return results;
}
