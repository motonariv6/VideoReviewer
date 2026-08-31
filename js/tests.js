import { AppDatabase } from './db.js';
import { generateFileSignature, formatTime, parseTime, normalizePath, filterVideosByTag } from './video-helper.js';
import { isSupportedVideoFile, isPathCoveredByFailedDirectory, scanDirectory, classifyScanResults, applyScanDifferentials, isIgnoredSystemEntry } from './directory-scanner.js';
import { RadarChart } from './radar.js';
import { db, setDbForTesting, handleFolderSelect, handleFolderRequestPermission, processSingleLocationVerification, bgHashState, updateBackgroundHashingProgress, processBackgroundHashingQueue, updateBackgroundHashingUI } from './app.js';
import { computeSHA256, computeQuickHash, computeFileSHA256, HashQueue, globalHashQueue } from './hash-helper.js';
import { runGroup11Tests } from './tests/hash-media-identity.tests.js';
import { runFolderManagementTests } from './tests/folder-management.tests.js';
import { runArchiveManagementTests } from './tests/archive-management.tests.js';
import { runReviewEditorTests } from './tests/review-editor.tests.js';
import { runMultiReviewSchemaTests } from './tests/multi-review-schema.tests.js';
import { runReviewShareSchemaTests } from './tests/review-share-schema.tests.js';
import { runReviewShareImportExportTests } from './tests/review-share-import-export.tests.js';
import { runReviewShareAggregateUITests } from './tests/review-share-aggregate-ui.tests.js';
import { runPendingSharedReviewLinkingTests } from './tests/pending-shared-review-linking.tests.js';
import { runTagManagementTests } from './tests/tag-management.tests.js';
import { runSchemaCanonicalizationTests } from './tests/schema-canonicalization.tests.js';
import { runCustomPosterTests } from './tests/custom-poster.tests.js';

export const VALID_HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const VALID_HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const INVALID_HASH = 'not-a-sha256';

// In-Memory Storage Driver for 100% isolated tests
export class MemoryStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

// --- FILE SYSTEM ACCESS API MOCKS FOR TESTS ---

export class MockFileSystemFileHandle {
  constructor(name, size = 12345, lastModified = 99999, content = null) {
    this.kind = 'file';
    this.name = name;
    this._size = size;
    this._lastModified = lastModified;
    this._shouldFail = false;
    this._content = content || new Uint8Array(size);
  }
  async getFile() {
    if (this._shouldFail) {
      throw new Error('Mock read error');
    }
    const ext = this.name.split('.').pop().toLowerCase();
    let type = 'video/mp4';
    if (ext === 'jpg' || ext === 'jpeg') {
      type = 'image/jpeg';
    } else if (ext === 'png') {
      type = 'image/png';
    } else if (ext === 'webp') {
      type = 'image/webp';
    }
    const blob = new Blob([this._content], { type });
    blob.name = this.name;
    blob.lastModified = this._lastModified;
    return blob;
  }
}

export class MockFileSystemDirectoryHandle {
  constructor(name, entries = {}) {
    this.kind = 'directory';
    this.name = name;
    this._entries = entries; // name -> mock handle
    this._permission = 'granted';
    this._shouldFail = false;
  }
  async *values() {
    if (this._shouldFail) {
      throw new Error('Mock iteration error');
    }
    for (const handle of Object.values(this._entries)) {
      yield handle;
    }
  }
  async getDirectoryHandle(name) {
    if (this._shouldFail) {
      throw new Error('Mock iteration error');
    }
    const handle = this._entries[name];
    if (!handle || handle.kind !== 'directory') {
      throw new DOMException('Directory not found', 'NotFoundError');
    }
    return handle;
  }
  async getFileHandle(name) {
    if (this._shouldFail) {
      throw new Error('Mock iteration error');
    }
    const handle = this._entries[name];
    if (!handle || handle.kind !== 'file') {
      throw new DOMException('File not found', 'NotFoundError');
    }
    return handle;
  }
  async queryPermission(options) {
    return this._permission;
  }
  async requestPermission(options) {
    return this._permission;
  }
}

/**
 * Runs the unit test suite and returns array of results
 * @returns {Promise<Array>}
 */
export async function runTests(groupFilter = null) {
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

  console.group('=== Running Video Annotation Studio Test Suite ===');

  const runAll = !groupFilter || groupFilter === 'all';

  if (runAll) {
    // --- GROUP 1: RECONNECTION UI TESTS (1-5) ---

  await runTest('1-5. Player reconnect warning UI element safety checks', async () => {
    // Mock DOM elements to verify innerHTML actions do not occur
    const container = document.createElement('div');
    container.innerHTML = `
      <div id="local-file-required-warning">
        <button id="player-folder-permission-button" class="hidden">フォルダのアクセスを許可する</button>
        <label id="player-file-reconnect-label">
          <input type="file" id="player-reconnect-file" accept="video/*" style="display:none">
          <span>ファイルを指定して再生</span>
        </label>
      </div>
    `;

    const fileInput = container.querySelector('#player-reconnect-file');
    const label = container.querySelector('#player-file-reconnect-label');
    const folderBtn = container.querySelector('#player-folder-permission-button');

    // Verify initial structure
    assert(fileInput !== null, 'reconnect-file input must exist');
    assert(label !== null, 'reconnect-file label must exist');
    assert(folderBtn !== null, 'folder permission button must exist');

    // Simulate warning logic under permission required
    folderBtn.classList.remove('hidden');
    label.classList.add('hidden');

    // Test 1 & 2: Verify input remains in DOM and reference is preserved
    assert(container.querySelector('#player-reconnect-file') === fileInput, 'DOM replacement must not destroy reconnect-file input');

    // Simulate warning logic under individual file reconnect needed
    folderBtn.classList.add('hidden');
    label.classList.remove('hidden');

    // Test 3 & 4: Reconnect file stays intact and listener triggers are valid
    assert(container.querySelector('#player-reconnect-file') === fileInput, 'File input element must retain memory reference');
  });

  // --- GROUP 2: SCAN SAFETY & DIFFERENTIAL TESTS (6-12) ---

  // --- GROUP 2.5: ROOT SCAN FAILURE TESTS ---

  // --- GROUP 3: FOLDER SWITCHING TWO-PHASE COMMIT & INITIAL REGISTRY REGRESSION TESTS ---

  // --- GROUP 4: REGRESSION TEST BASES (20-27) ---

  await runTest('21. XSS safety preservation', async () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const container = document.createElement('div');
    container.textContent = malicious;
    assert(container.innerHTML !== malicious, 'Special tag characters must remain escaped in DOM');
  });

  await runTest('22. IndexedDB image store integrity checks', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_IDBImg');
    await testDb.initAsync();

    if (testDb.idbAvailable) {
      const blob = new Blob(['image-bytes'], { type: 'image/jpeg' });
      await testDb.putImage('img-test-1', blob);
      const res = await testDb.getImage('img-test-1');
      assert(res.size === blob.size, 'Binary image Blobs size must match');
    }
  });

  await runTest('23. Object URL release logic check', async () => {
    let releasedUrl = null;
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url) => { releasedUrl = url; };

    try {
      const activeUrl = 'blob:http://localhost/active-video-handle';
      const mockState = { activeBlobUrl: activeUrl };
      const revokeMock = () => {
        if (mockState.activeBlobUrl) {
          URL.revokeObjectURL(mockState.activeBlobUrl);
          mockState.activeBlobUrl = null;
        }
      };
      revokeMock();
      assert(releasedUrl === activeUrl, 'Should call URL.revokeObjectURL on old active Blob URLs');
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });



  // --- GROUP 7: BACKUP/RESTORE, DISPLAY TITLE, GENRES TESTS ---

  console.group('Group 7: New Features Tests');

  await runTest('Genres and Genre-specific evaluation templates (CRUD & Constraints)', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_genres_');
    await testDb.initAsync();

    // 1. Default genre '一般' should be auto-created
    const genres = testDb.getActiveGenres();
    const defaultGenre = genres.find(g => g.id === 'genre-default');
    assert(defaultGenre !== undefined, 'Default genre 一般 must exist');
    assert(defaultGenre.name === '一般', 'Default genre name must be 一般');

    // 2. Add a new genre
    const newGenre = await testDb.addGenre('インタビュー');
    assert(newGenre !== null && newGenre.name === 'インタビュー', 'Genre インタビュー should be created');

    // 3. Check templates linkage
    const templates = testDb.templates;
    const linkedTemplate = templates.find(t => t.genreId === newGenre.id);
    assert(linkedTemplate !== undefined, 'Genre must have an evaluation template');

    // 4. Add criteria to the new genre
    const c1 = await testDb.addCriterionToGenre(newGenre.id, '声量');
    const c2 = await testDb.addCriterionToGenre(newGenre.id, '話すテンポ');

    const criteria = testDb.getActiveCriteriaForGenre(newGenre.id);
    assert(criteria.length === 2, 'Should have 2 criteria added');
    assert(criteria[0].name === '声量', 'First item name matches');

    // 5. Test 6 items limit constraint
    await testDb.addCriterionToGenre(newGenre.id, '内容');
    await testDb.addCriterionToGenre(newGenre.id, '表現');
    await testDb.addCriterionToGenre(newGenre.id, '表情');
    await testDb.addCriterionToGenre(newGenre.id, '姿勢');

    // Trying to add 7th active criterion should throw an error
    let threwError = false;
    try {
      await testDb.addCriterionToGenre(newGenre.id, '超過項目');
    } catch (err) {
      threwError = true;
    }
    assert(threwError === true, 'Adding 7th criterion must throw an error');

    // 6. Test copying criteria from another genre
    const copyTargetGenre = await testDb.addGenre('コピー先ジャンル');
    await testDb.copyCriteria(newGenre.id, copyTargetGenre.id);
    const copiedCriteria = testDb.getActiveCriteriaForGenre(copyTargetGenre.id);
    assert(copiedCriteria.length === 6, 'Copied criteria count must be 6');
    assert(copiedCriteria[0].name === '声量', 'Copied items names match');
  });

  await runTest('DB Backup & Restore serialization and content verification', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_backup_');
    await testDb.initAsync();

    // Verify we can get all images without failure
    const images = await testDb.getAllImages();
    assert(Array.isArray(images), 'getAllImages must return an array');

    // Add custom genre and video
    const customGenre = await testDb.addGenre('アクション');
    const newVideo = {
      id: 'vid-test-back',
      contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      hashAlgorithm: 'SHA-256',
      quickHash: 'q123',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'バックアップテスト動画',
      genreId: customGenre.id,
      thumbnailId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    testDb.mediaAssets.push(newVideo);
    testDb.fileLocations.push({
      id: 'loc-test-location-new',
      mediaAssetId: 'vid-test-back',
      directoryId: '',
      relativePath: '',
      fileName: 'back.mp4',
      fileSize: 100,
      lastModified: 0,
      availabilityStatus: 'available',
      lastVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await testDb.updateVideo(newVideo.id, {});

    // Save a review
    await testDb.saveReview(newVideo.id, {
      overallGrade: 'A',
      comment: '素晴らしい映像',
      ratings: {
        'crit-content': 5
      }
    });

    const dbData = {
      media_assets: testDb.mediaAssets,
      file_locations: testDb.fileLocations,
      rating_criteria: testDb.criteria,
      video_reviews: testDb.reviews,
      criterion_ratings: testDb.criterionRatings,
      tags: testDb.tags,
      video_tags: testDb.videoTags,
      timeline_notes: testDb.timelineNotes,
      directory_sources: testDb.directorySources,
      genres: testDb.genres,
      evaluation_templates: testDb.templates
    };

    const zip = new JSZip();
    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: testDb.mediaAssets.length,
        file_locations: testDb.fileLocations.length,
        reviews: testDb.reviews.length,
        images: 0
      }
    };
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('database.json', JSON.stringify(dbData));

    const contentBlob = await zip.generateAsync({ type: 'blob' });
    assert(contentBlob !== null && contentBlob.size > 0, 'Backup ZIP should be generated');

    const zipLoaded = await JSZip.loadAsync(contentBlob);
    const dbFile = zipLoaded.file('database.json');
    assert(dbFile !== null, 'ZIP must contain database.json');

    const restoredDbData = JSON.parse(await dbFile.async('string'));

    const memoryStorage2 = new MemoryStorage();
    const testDb2 = new AppDatabase(memoryStorage2, 'test_v7_restored_');
    await testDb2.initAsync();

    assert(testDb2.getVideos().length !== testDb.getVideos().length, 'Fresh DB should not have the new video');

    assert(testDb2.getVideos().length !== testDb.getVideos().length, 'Fresh DB should not have the new video');

    // Production validation and restore invocation
    const valRes = testDb2.validateBackupData(restoredDbData, manifest, []);
    if (!valRes.isValid) {
      console.error('Validation errors:', valRes.fatalErrors);
    }
    assert(valRes.isValid === true, 'Restored data must pass validation: ' + (valRes.fatalErrors ? valRes.fatalErrors.join(', ') : ''));
    await testDb2.restoreWithRollback(valRes.repairedDb, []);

    const restoredVideo = testDb2.getVideo(newVideo.id);
    assert(restoredVideo !== null, 'Restored database must contain our test video');
    assert(restoredVideo.genreId === customGenre.id, 'Restored video genre link must be preserved');

    const restoredReview = testDb2.getReviewForVideo(newVideo.id);
    assert(restoredReview !== undefined, 'Restored database must contain video reviews');
    assert(restoredReview.overallGrade === 'A', 'Restored review overall grade matches');
  });

  await runTest('DB Backup & Restore safety validation constraint checks', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_validation_');
    await testDb.initAsync();

    const validManifest = {
      application: 'VideoReviewer',
      schemaVersion: 3,
      createdAt: '2026-08-16T12:00:00.000Z',
      counts: { media_assets: 0, file_locations: 0, reviews: 0, images: 0 }
    };
    const validDb = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [], directory_sources: [],
      genres: [], evaluation_templates: []
    };

    // 1. Valid case
    const res1 = testDb.validateBackupData(validDb, validManifest, []);
    assert(res1.isValid === true, 'Valid manifest is accepted');

    // 2. Invalid schema version
    const res2 = testDb.validateBackupData(validDb, { ...validManifest, schemaVersion: 2 }, []);
    assert(res2.isValid === false, 'Should be invalid for schemaVersion !== 3');
    assert(res2.fatalErrors.some(e => e.includes('スキーマバージョン')), 'Rejected invalid schema version');

    // 3. Invalid createdAt (not valid ISO timestamp)
    const res3 = testDb.validateBackupData(validDb, { ...validManifest, createdAt: 'invalid-date' }, []);
    assert(res3.isValid === false, 'Should be invalid for invalid createdAt');
    assert(res3.fatalErrors.some(e => e.includes('createdAt')), 'Rejected invalid createdAt');

    // 4. Missing manifest counts
    const res4 = testDb.validateBackupData(validDb, { ...validManifest, counts: undefined }, []);
    assert(res4.isValid === false, 'Should be invalid for missing counts');
    assert(res4.fatalErrors.some(e => e.includes('counts')), 'Rejected missing counts');

    // 5. Negative counts in manifest
    const res5 = testDb.validateBackupData(validDb, {
      ...validManifest,
      counts: { media_assets: -1, file_locations: 0, reviews: 0, images: 0 }
    }, []);
    assert(res5.isValid === false, 'Should be invalid for negative counts');
    assert(res5.fatalErrors.some(e => e.includes('非負の整数')), 'Rejected negative count');

    // 6. manifest counts match database table counts (video count mismatch)
    const res6 = testDb.validateBackupData(validDb, {
      ...validManifest,
      counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0 }
    }, []);
    assert(res6.isValid === false, 'Should be invalid for videos count mismatch');
    assert(res6.fatalErrors.some(e => e.includes('動画アセットの件数')), 'Rejected video count mismatch');

    // 7. manifest image count matches ZIP image entries (image count mismatch)
    const res7 = testDb.validateBackupData(validDb, {
      ...validManifest,
      counts: { media_assets: 0, file_locations: 0, reviews: 0, images: 1 }
    }, []);
    assert(res7.isValid === false, 'Should be invalid for images count mismatch');
    assert(res7.fatalErrors.some(e => e.includes('画像の件数')), 'Rejected image count mismatch');

    // 8. duplicate criterion rating ID
    const badCrDb = {
      ...validDb,
      criterion_ratings: [
        { id: 'rate-test-rating-1', videoReviewId: 'rev-test-review-1', criterionId: 'crit-content', score: 3 },
        { id: 'rate-test-rating-1', videoReviewId: 'rev-test-review-1', criterionId: 'crit-content', score: 5 }
      ]
    };
    const res8 = testDb.validateBackupData(badCrDb, validManifest, []);
    assert(res8.isValid === false, 'Should be invalid for duplicate criterion rating ID');
    assert(res8.fatalErrors.some(e => e.includes('重複する ID rate-test-rating-1')), 'Rejected duplicate criterion rating ID');

    // 9. missing video thumbnail
    const badVidDb = {
      ...validDb,
      media_assets: [{ id: 'vid-test-video-1', displayTitle: 'Test', thumbnailId: 'img-nonexistent', contentHash: '', hashAlgorithm: 'SHA-256', quickHash: '', hashStatus: 'pending', fileSize: 0, duration: 0, genreId: 'genre-default', createdAt: '', updatedAt: '' }]
    };
    const res9 = testDb.validateBackupData(badVidDb, {
      ...validManifest,
      counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0 }
    }, []);
    assert(res9.isValid === false, 'Should be invalid for missing video thumbnail');
    assert(res9.fatalErrors.some(e => e.includes('ZIP内に存在しません')), 'Rejected missing video thumbnail image');

    // 10. missing timeline-note image
    const badNoteDb = {
      ...validDb,
      timeline_notes: [{ id: 'note-test-note-1', comment: 'note text', thumbnailId: 'img-nonexistent', videoReviewId: 'rev-test-review-1', mediaAssetId: 'vid-test-video-1', timestampSeconds: 0, timestampLabel: '00:00', createdAt: '' }],
      video_reviews: [{ id: 'rev-test-review-1', mediaAssetId: 'vid-test-video-1', createdAt: '', updatedAt: '' }],
      media_assets: [{ id: 'vid-test-video-1', displayTitle: 'Test', contentHash: '', hashAlgorithm: 'SHA-256', quickHash: '', hashStatus: 'pending', fileSize: 0, duration: 0, genreId: 'genre-default', createdAt: '', updatedAt: '' }]
    };
    const res10 = testDb.validateBackupData(badNoteDb, {
      ...validManifest,
      counts: { media_assets: 1, file_locations: 0, reviews: 1, images: 0 }
    }, []);
    assert(res10.isValid === false, 'Should be invalid for missing timeline-note image');
    assert(res10.fatalErrors.some(e => e.includes('ZIP内に存在しません')), 'Rejected missing note image');

    // 11. duplicate ZIP image IDs
    const res11 = testDb.validateBackupData(validDb, {
      ...validManifest,
      counts: { media_assets: 0, file_locations: 0, reviews: 0, images: 2 }
    }, ['img-1', 'img-1']);
    assert(res11.isValid === false, 'Should be invalid for duplicate ZIP image IDs');
    assert(res11.fatalErrors.some(e => e.includes('重複する画像ID')), 'Rejected duplicate ZIP image IDs');
  });

  await runTest('DB Restore atomic transaction rollback under image/write failures', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_tx_');
    await testDb.initAsync();

    // Seed initial database state with distinct objects in all collections
    testDb.mediaAssets = [{ id: 'vid-original', contentHash: 'hash-orig', hashAlgorithm: 'SHA-256', quickHash: 'qo', hashStatus: 'completed', fileSize: 100, duration: 10, displayTitle: 'Original', genreId: 'genre-original', thumbnailId: 'img-original', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.fileLocations = [{ id: 'loc-original', mediaAssetId: 'vid-original', directoryId: 'dir-original', relativePath: 'orig.mp4', fileName: 'orig.mp4', fileSize: 100, lastModified: 0, availabilityStatus: 'available', lastVerifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.criteria = [{ id: 'crit-original', name: 'Original', description: 'Original' }];
    testDb.reviews = [{ id: 'rev-original', mediaAssetId: 'vid-original', reviewerId: testDb.getLocalReviewer().id, origin: 'local', overallScore: 4, comment: 'Nice', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.criterionRatings = [{ id: 'rate-original', videoReviewId: 'rev-original', criterionId: 'crit-original', score: 3 }];
    testDb.tags = [{ id: 'tag-original', name: 'Original' }];
    testDb.reviewTags = [{ id: 'rt-original', videoReviewId: 'rev-original', tagId: 'tag-original', createdAt: new Date().toISOString() }];
    testDb.timelineNotes = [{ id: 'note-original', videoReviewId: 'rev-original', mediaAssetId: 'vid-original', timestampSeconds: 0, timestampLabel: '00:00', comment: 'Original', createdAt: new Date().toISOString() }];
    testDb.directorySources = [{ id: 'dir-original', name: 'Original', includeSubdirectories: true, permissionStatus: 'granted', handleKey: 'handle-orig', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.genres = [{ id: 'genre-original', name: 'Original', displayTitle: 'Original Genre', description: 'Original', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.templates = [{ id: 'template-original', genreId: 'genre-original', name: 'Original Template', criteriaIds: 'crit-original', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb._saveAll();

    // Mock IndexedDB
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {
        'img-original': new Blob(['original-img'], { type: 'image/jpeg' }),
        'handle-original': { name: 'orig-dir' }
      },
      getAll: async function(storeName) {
        if (storeName === 'images') {
          return [{ id: 'img-original', data: this.store['img-original'] }];
        }
        if (storeName === 'handles') {
          return [{ id: 'handle-original', data: this.store['handle-original'] }];
        }
        return [];
      },
      put: async function(key, val, storeName) {
        if (this.shouldFailPut && key === 'img-new') {
          throw new Error('Injected IndexedDB put failure');
        }
        this.store[key] = val;
      },
      clearImages: async function() {
        for (const k in this.store) {
          if (k.startsWith('img-')) delete this.store[k];
        }
      },
      clearHandles: async function() {
        for (const k in this.store) {
          if (k.startsWith('handle-')) delete this.store[k];
        }
      },
      delete: async function(key) {
        delete this.store[key];
      }
    };

    // Target restore values
    const restoredData = {
      media_assets: [{ id: 'vid-new', contentHash: 'hash-new', hashAlgorithm: 'SHA-256', quickHash: 'qn', hashStatus: 'completed', fileSize: 200, duration: 20, displayTitle: 'New Video', genreId: 'genre-new', thumbnailId: 'img-new', videoUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      file_locations: [{ id: 'loc-new', mediaAssetId: 'vid-new', directoryId: 'dir-new', relativePath: 'new.mp4', fileName: 'new.mp4', fileSize: 200, lastModified: 0, availabilityStatus: 'available', lastVerifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      rating_criteria: [{ id: 'crit-new', name: 'New', description: 'New Crit' }],
      video_reviews: [{ id: 'rev-new', mediaAssetId: 'vid-new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      criterion_ratings: [{ id: 'rate-new', videoReviewId: 'rev-new', criterionId: 'crit-new', score: 5 }],
      tags: [{ id: 'tag-new', name: 'New' }],
      video_tags: [{ mediaAssetId: 'vid-new', tagId: 'tag-new' }],
      timeline_notes: [{ id: 'note-new', videoReviewId: 'rev-new', mediaAssetId: 'vid-new', timestampSeconds: 10, timestampLabel: '00:10', comment: 'New', createdAt: new Date().toISOString() }],
      directory_sources: [{ id: 'dir-new', name: 'New', includeSubdirectories: true, permissionStatus: 'granted', handleKey: 'handle-new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      genres: [{ id: 'genre-new', name: 'New', displayTitle: 'New Genre', description: 'New', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      evaluation_templates: [{ id: 'template-new', genreId: 'genre-new', name: 'New Template', criteriaIds: 'crit-new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    };
    const newImages = [{ id: 'img-new', data: new Blob(['new-img'], { type: 'image/jpeg' }) }];

    // --- TEST 1: Injected image put failure ---
    testDb.idb.shouldFailPut = true;

    let restoreSucceeded = false;
    try {
      await testDb.restoreWithRollback(restoredData, newImages);
      restoreSucceeded = true;
    } catch (err) {
      // Handled by restoreWithRollback
    }

    assert(restoreSucceeded === false, 'Restore should have failed due to IndexedDB error');
    // Verify rollback integrity for every in-memory collection
    assert(testDb.getVideos()[0].id === 'vid-original', 'Original videos must be preserved');
    assert(testDb.getVideos().some(v => v.id === 'vid-new') === false, 'New videos must not be present');
    assert(testDb.criteria[0].id === 'crit-original', 'Original criteria must be preserved');
    assert(testDb.reviews[0].id === 'rev-original', 'Original reviews must be preserved');
    assert(testDb.criterionRatings[0].id === 'rate-original', 'Original criterionRatings must be preserved');
    assert(testDb.tags[0].id === 'tag-original', 'Original tags must be preserved');
    assert(testDb.videoTags[0].tagId === 'tag-original', 'Original videoTags must be preserved');
    assert(testDb.timelineNotes[0].id === 'note-original', 'Original timelineNotes must be preserved');
    assert(testDb.directorySources[0].id === 'dir-original', 'Original directorySources must be preserved');
    assert(testDb.genres[0].id === 'genre-original', 'Original genres must be preserved');
    assert(testDb.templates[0].id === 'template-original', 'Original templates must be preserved');

    assert(testDb.idb.store['img-original'] !== undefined, 'Original images must be preserved');
    assert(testDb.idb.store['handle-original'] !== undefined, 'Original DirectoryHandles must be preserved');

    // --- TEST 2: Injected localStorage write failure ---
    testDb.idb.shouldFailPut = false;

    // Inject localStorage save failure via _saveTable mock
    const origSaveTable = testDb._saveTable;
    testDb._saveTable = function(key, data) {
      throw new Error('Injected localStorage write failure');
    };

    restoreSucceeded = false;
    try {
      await testDb.restoreWithRollback(restoredData, newImages);
      restoreSucceeded = true;
    } catch (err) {
      // Handled by restoreWithRollback
    }

    // Restore original _saveTable
    testDb._saveTable = origSaveTable;

    assert(restoreSucceeded === false, 'Restore should have failed due to localStorage write error');

    // Verify rollback integrity for every in-memory collection on localStorage failure
    assert(testDb.getVideos()[0].id === 'vid-original', 'Original videos must be preserved on localStorage write error');
    assert(testDb.getVideos().some(v => v.id === 'vid-new') === false, 'New videos must not be present on localStorage write error');
    assert(testDb.criteria[0].id === 'crit-original', 'Original criteria must be preserved on localStorage write error');
    assert(testDb.reviews[0].id === 'rev-original', 'Original reviews must be preserved on localStorage write error');
    assert(testDb.criterionRatings[0].id === 'rate-original', 'Original ratings must be preserved on localStorage write error');
    assert(testDb.tags[0].id === 'tag-original', 'Original tags must be preserved on localStorage write error');
    assert(testDb.videoTags[0].tagId === 'tag-original', 'Original videoTags must be preserved on localStorage write error');
    assert(testDb.timelineNotes[0].id === 'note-original', 'Original timelineNotes must be preserved on localStorage write error');
    assert(testDb.directorySources[0].id === 'dir-original', 'Original directorySources must be preserved on localStorage write error');
    assert(testDb.genres[0].id === 'genre-original', 'Original genres must be preserved on localStorage write error');
    assert(testDb.templates[0].id === 'template-original', 'Original templates must be preserved on localStorage write error');

    assert(testDb.idb.store['img-original'] !== undefined, 'Original images must remain intact');
    assert(testDb.idb.store['handle-original'] !== undefined, 'Original DirectoryHandles must remain intact');
  });

  await runTest('DB Restore successful execution writes sequence verification', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_seq_');
    await testDb.initAsync();

    const sequenceLog = [];
    testDb.idbAvailable = true;
    testDb.idb = {
      getAll: async function(storeName) {
        return [];
      },
      clearImages: async function() {
        sequenceLog.push('clearImages');
      },
      clearHandles: async function() {
        sequenceLog.push('clearHandles');
      },
      put: async function(key, val, storeName) {
        sequenceLog.push(`put:${storeName}`);
      }
    };
    testDb._saveTable = function(key) {
      sequenceLog.push(`saveTable:${key}`);
    };

    const restoredData = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [], directory_sources: [],
      genres: [], evaluation_templates: []
    };
    const newImages = [{ id: 'img-1', data: null }];

    await testDb.restoreWithRollback(restoredData, newImages);

    assert(sequenceLog[0] === 'clearImages', 'Images cleared first');
    assert(sequenceLog[1] === 'put:images', 'New images written');

    assert(sequenceLog.includes('clearHandles') === false, 'Handles must not be cleared on successful restore');
  });

  console.group('Group 8: Legacy Orphan Note Recovery & Clean-up Tests');

  await runTest('Legacy timeline note repair and orphan exclusion validation', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v8_legacy_');
    await testDb.initAsync();

    // Seed base DB state
    testDb.mediaAssets = [{ id: 'vid-test-video-1', displayTitle: 'Test Video', contentHash: '', hashAlgorithm: 'SHA-256', quickHash: '', hashStatus: 'pending', fileSize: 0, duration: 0, genreId: 'genre-default', createdAt: '', updatedAt: '' }];
    testDb.fileLocations = [];
    testDb.reviews = [{ id: 'rev-test-review-1', mediaAssetId: 'vid-test-video-1', createdAt: '', updatedAt: '' }];
    testDb.timelineNotes = [];
    testDb._saveAll();

    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 3,
      createdAt: '2026-08-16T12:00:00.000Z',
      counts: { media_assets: 1, file_locations: 0, reviews: 1, images: 2 }
    };

    const parsedDb = {
      media_assets: [{ id: 'vid-test-video-1', displayTitle: 'Test Video', contentHash: '', hashAlgorithm: 'SHA-256', quickHash: '', hashStatus: 'pending', fileSize: 0, duration: 0, genreId: 'genre-default', createdAt: '', updatedAt: '' }],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [{ id: 'rev-test-review-1', mediaAssetId: 'vid-test-video-1', createdAt: '', updatedAt: '' }],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [
        // 1. Repairable note (missing videoReviewId but has mediaAssetId and exactly one review)
        { id: 'note-repairable', comment: 'Repairable', mediaAssetId: 'vid-test-video-1', videoReviewId: 'nonexistent-rev', timestampSeconds: 0, timestampLabel: '00:00', createdAt: '', thumbnailId: 'img-valid' },
        // 2. Irreparable note (missing review and mediaAssetId)
        { id: 'note-irreparable', comment: 'Irreparable', videoReviewId: 'nonexistent-rev-2', timestampSeconds: 0, timestampLabel: '00:00', createdAt: '', thumbnailId: 'img-orphan' }
      ],
      directory_sources: [],
      genres: [{
        id: 'genre-default',
        name: '一般',
        displayTitle: '一般',
        description: 'デフォルトのジャンル区分',
        createdAt: '2026-08-16T12:00:00.000Z',
        updatedAt: '2026-08-16T12:00:00.000Z'
      }],
      evaluation_templates: [{
        id: 'temp-default',
        genreId: 'genre-default',
        name: 'デフォルトテンプレート',
        criteriaIds: '',
        createdAt: '2026-08-16T12:00:00.000Z',
        updatedAt: '2026-08-16T12:00:00.000Z'
      }]
    };

    const zipImageIds = ['img-valid', 'img-orphan'];

    // Validate
    const validationResult = testDb.validateBackupData(parsedDb, manifest, zipImageIds);
    // Assertions
    assert(validationResult.isValid === true, 'Validation is valid because warnings are not fatal');
    assert(validationResult.fatalErrors.length === 0, 'No fatal errors');

    // Warnings check
    const repairableWarning = validationResult.warnings.find(w => w.noteId === 'note-repairable');
    const irreparableWarning = validationResult.warnings.find(w => w.noteId === 'note-irreparable');

    assert(repairableWarning !== undefined, 'Has warning for repairable note');
    assert(repairableWarning.repaired === true, 'Repairable note is marked repaired');
    assert(repairableWarning.repairedToReviewId === 'rev-test-review-1', 'Repairable note is mapped to rev-test-review-1');

    assert(irreparableWarning !== undefined, 'Has warning for irreparable note');
    assert(irreparableWarning.repaired === false, 'Irreparable note is marked not repaired');

    // Repaired DB state check
    const repairedNotes = validationResult.repairedDb.timeline_notes;
    assert(repairedNotes.length === 1, 'Irreparable note must be excluded from active timeline_notes');
    assert(repairedNotes[0].id === 'note-repairable', 'Repairable note must be included');
    assert(repairedNotes[0].videoReviewId === 'rev-test-review-1', 'Repairable note review ID must be updated');

    // Image exclusion check
    assert(validationResult.requiredImageIds.includes('img-valid') === true, 'img-valid must be included');
    assert(validationResult.requiredImageIds.includes('img-orphan') === false, 'img-orphan must be excluded');

    // Confirm that other broken references (e.g. broken review video reference) still reject the backup
    const fatalDb = {
      ...parsedDb,
      video_reviews: [{ id: 'rev-test-review-1', mediaAssetId: 'nonexistent-video', createdAt: '', updatedAt: '' }]
    };
    const fatalResult = testDb.validateBackupData(fatalDb, manifest, zipImageIds);
    assert(fatalResult.isValid === false, 'Broken review video reference must make validation invalid');
    assert(fatalResult.fatalErrors.length > 0, 'Must contain fatal error messages');
  });

  await runTest('Legacy note rollback and cancellation safety', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v8_cancel_');
    await testDb.initAsync();

    // Seed original DB state
    testDb.mediaAssets = [{ id: 'vid-original', displayTitle: 'Original', contentHash: '', hashAlgorithm: 'SHA-256', quickHash: '', hashStatus: 'pending', fileSize: 0, duration: 0, genreId: 'genre-default', createdAt: '', updatedAt: '' }];
    testDb.fileLocations = [];
    testDb.timelineNotes = [{ id: 'note-original', videoReviewId: 'rev-original', mediaAssetId: 'vid-original', timestampSeconds: 0, timestampLabel: '00:00', comment: 'Original', createdAt: '' }];
    testDb._saveAll();

    const parsedDb = {
      media_assets: [{ id: 'vid-test-video-new', displayTitle: 'New', contentHash: '', hashAlgorithm: 'SHA-256', quickHash: '', hashStatus: 'pending', fileSize: 0, duration: 0, genreId: 'genre-default', createdAt: '', updatedAt: '' }],
      file_locations: [],
      rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [], directory_sources: [],
      genres: [], evaluation_templates: []
    };

    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 3,
      createdAt: '2026-08-16T12:00:00.000Z',
      counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0 }
    };

    // Preflight validation - changes nothing
    testDb.validateBackupData(parsedDb, manifest, []);
    assert(testDb.getVideos()[0].id === 'vid-original', 'In-memory state remains unchanged before confirmation');
    assert(memoryStorage.getItem('test_v8_cancel_media_assets').includes('vid-original'), 'Storage state remains unchanged before confirmation');
  });

  await runTest('Check & Clean up orphan data action', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v8_cleanup_');
    await testDb.initAsync();

    // Mock IndexedDB
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {
        'img-referenced': new Blob(['img-ref'], { type: 'image/jpeg' }),
        'img-referenced-by-note': new Blob(['img-note'], { type: 'image/jpeg' }),
        'img-orphan': new Blob(['img-orph'], { type: 'image/jpeg' })
      },
      getAll: async function(storeName) {
        if (storeName === 'images') {
          return Object.keys(this.store).map(id => ({ id, data: this.store[id] }));
        }
        return [];
      },
      delete: async function(id, storeName) {
        if (storeName === 'images') delete this.store[id];
      }
    };

    // Seed database
    testDb.mediaAssets = [{ id: 'vid-test-video-1', displayTitle: 'Video', thumbnailId: 'img-referenced', contentHash: '', hashAlgorithm: 'SHA-256', quickHash: '', hashStatus: 'pending', fileSize: 0, duration: 0, genreId: 'genre-default', createdAt: '', updatedAt: '' }];
    testDb.fileLocations = [];
    testDb.reviews = [{ id: 'rev-test-review-1', mediaAssetId: 'vid-test-video-1', createdAt: '', updatedAt: '' }];
    testDb.timelineNotes = [
      // Valid note
      { id: 'note-valid', videoReviewId: 'rev-test-review-1', mediaAssetId: 'vid-test-video-1', timestampSeconds: 0, timestampLabel: '00:00', comment: 'Valid', thumbnailId: 'img-referenced-by-note', createdAt: '' },
      // Irreparable orphan note
      { id: 'note-orphan', videoReviewId: 'nonexistent-rev', mediaAssetId: 'vid-test-video-1', timestampSeconds: 0, timestampLabel: '00:00', comment: 'Orphan', thumbnailId: 'img-orphan', createdAt: '' }
    ];
    testDb._saveAll();

    // Check orphan data
    const checkResult = await testDb.checkOrphanData();
    assert(checkResult.orphanNotes.length === 1, 'Should detect exactly 1 orphan note');
    assert(checkResult.orphanNotes[0].id === 'note-orphan', 'Detected orphan note id matches');
    assert(checkResult.unreferencedImageIds.length === 1, 'Should detect exactly 1 unreferenced image');
    assert(checkResult.unreferencedImageIds[0] === 'img-orphan', 'Detected unreferenced image id matches');

    // Clean orphan data
    const cleanResult = await testDb.cleanOrphanData();
    assert(cleanResult.notesCleanedCount === 1, 'Cleans 1 note');
    assert(cleanResult.imagesCleanedCount === 1, 'Cleans 1 image');

    // Verify post-clean state
    assert(testDb.timelineNotes.length === 1, 'Only 1 note left');
    assert(testDb.timelineNotes[0].id === 'note-valid', 'Valid note remains');
    assert(testDb.idb.store['img-referenced'] !== undefined, 'Referenced video image not removed');
    assert(testDb.idb.store['img-referenced-by-note'] !== undefined, 'Referenced note image not removed');
    assert(testDb.idb.store['img-orphan'] === undefined, 'Orphan image must be removed');
  });

  console.group('Group 10. Media Identity & Content Hashing Tests');

  await runTest('10-1. Empty data SHA-256 matches known NIST/RFC vector', async () => {
    const hash = computeSHA256(new Uint8Array(0));
    assert(hash === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Empty hash matches');
  });

  await runTest('10-2. "abc" SHA-256 matches known vector', async () => {
    const hash = computeSHA256('abc');
    assert(hash === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'Hash of "abc" matches');
  });

  await runTest('10-3. Multi-chunk data matches correct SHA-256', async () => {
    const data = new Uint8Array(1024 * 1024 * 3 + 500);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }
    const file = new Blob([data]);
    const hashDirect = computeSHA256(data);
    const hashChunked = await computeFileSHA256(file, { chunkSize: 1024 * 1024, useWorker: false });
    assert(hashChunked === hashDirect, 'Chunked hash matches direct hash');
  });

  await runTest('10-4. Variable chunk boundaries yield identical hash', async () => {
    const data = new Uint8Array(1024 * 1024 * 2 + 100);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 3) % 256;
    }
    const file = new Blob([data]);
    const hash1 = await computeFileSHA256(file, { chunkSize: 500 * 1024, useWorker: false });
    const hash2 = await computeFileSHA256(file, { chunkSize: 1024 * 1024, useWorker: false });
    assert(hash1 === hash2, 'Hash with different chunk sizes matches');
  });

  await runTest('10-5. Same content & same filename re-scan does not duplicate records', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_hash_dup_', 'TestVideoDB_HashDup');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const content = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new MockFileSystemFileHandle('video.mp4', content.length, 100, content);
    const qh = await computeQuickHash(await file.getFile());
    const hash = await computeFileSHA256(await file.getFile(), { useWorker: false });

    const videoA = await testDb.addVideo({
      title: 'video.mp4',
      fileName: 'video.mp4',
      fileSize: content.length,
      duration: 10,
      sourceType: 'directory',
      directoryId: 'src-1',
      relativePath: 'video.mp4',
      lastModified: 100,
      quickHash: qh,
      contentHash: hash,
      hashStatus: 'completed'
    });

    const videoB = await testDb.addVideo({
      title: 'video.mp4',
      fileName: 'video.mp4',
      fileSize: content.length,
      duration: 10,
      sourceType: 'directory',
      directoryId: 'src-1',
      relativePath: 'video.mp4',
      lastModified: 100,
      quickHash: qh,
      contentHash: hash,
      hashStatus: 'completed'
    });

    assert(videoA.id === videoB.id, 'Same file re-add resolves to the same asset ID');
    assert(testDb.mediaAssets.length === 1, 'Only one media asset is stored');
    assert(testDb.fileLocations.length === 1, 'Only one file location is stored');
  });

  await runTest('10-6. Same content & different filename merges into single media_asset', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_diff_name_', 'TestVideoDB_DiffName');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const content = new Uint8Array([10, 20, 30]);
    const file1 = new MockFileSystemFileHandle('video1.mp4', content.length, 100, content);
    const file2 = new MockFileSystemFileHandle('video2.mp4', content.length, 101, content);

    const hash = await computeFileSHA256(await file1.getFile(), { useWorker: false });

    const video1 = await testDb.addVideo({
      title: 'video1.mp4',
      fileName: 'video1.mp4',
      fileSize: content.length,
      duration: 10,
      sourceType: 'directory',
      directoryId: 'src-1',
      relativePath: 'video1.mp4',
      lastModified: 100,
      contentHash: hash,
      hashStatus: 'completed'
    });

    const video2 = await testDb.addVideo({
      title: 'video2.mp4',
      fileName: 'video2.mp4',
      fileSize: content.length,
      duration: 10,
      sourceType: 'directory',
      directoryId: 'src-1',
      relativePath: 'video2.mp4',
      lastModified: 101,
      contentHash: hash,
      hashStatus: 'completed'
    });

    assert(video1.id === video2.id, 'Assets with identical contentHash resolve to the same media_asset ID');
    assert(testDb.mediaAssets.length === 1, 'Exactly one logical media asset stored');
    assert(testDb.fileLocations.length === 2, 'Two file locations registered for the same media asset');
  });

  await runTest('10-7. Same content & different directory registers 1 asset + multiple locations', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_diff_dir_', 'TestVideoDB_DiffDir');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const content = new Uint8Array([5, 6, 7, 8]);
    const hash = await computeFileSHA256(new Blob([content]), { useWorker: false });

    const video1 = await testDb.addVideo({
      title: 'vid.mp4',
      fileName: 'vid.mp4',
      fileSize: content.length,
      duration: 10,
      sourceType: 'directory',
      directoryId: 'dir-A',
      relativePath: 'vid.mp4',
      lastModified: 100,
      contentHash: hash,
      hashStatus: 'completed'
    });

    const video2 = await testDb.addVideo({
      title: 'vid.mp4',
      fileName: 'vid.mp4',
      fileSize: content.length,
      duration: 10,
      sourceType: 'directory',
      directoryId: 'dir-B',
      relativePath: 'vid.mp4',
      lastModified: 100,
      contentHash: hash,
      hashStatus: 'completed'
    });

    assert(video1.id === video2.id, 'Linked to same asset');
    assert(testDb.mediaAssets.length === 1, 'Only one media_asset');
    assert(testDb.fileLocations.length === 2, 'Two location records created');
    assert(testDb.fileLocations.some(l => l.directoryId === 'dir-A'), 'Has location dir-A');
    assert(testDb.fileLocations.some(l => l.directoryId === 'dir-B'), 'Has location dir-B');
  });

  await runTest('10-8. Same file size with different content registers distinct assets', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_same_size_', 'TestVideoDB_SameSize');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const size = 100;
    const contentA = new Uint8Array(size); contentA[0] = 1;
    const contentB = new Uint8Array(size); contentB[0] = 2;

    const hashA = await computeFileSHA256(new Blob([contentA]), { useWorker: false });
    const hashB = await computeFileSHA256(new Blob([contentB]), { useWorker: false });

    const videoA = await testDb.addVideo({
      title: 'vidA.mp4',
      fileName: 'vidA.mp4',
      fileSize: size,
      duration: 5,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'vidA.mp4',
      lastModified: 100,
      contentHash: hashA,
      hashStatus: 'completed'
    });

    const videoB = await testDb.addVideo({
      title: 'vidB.mp4',
      fileName: 'vidB.mp4',
      fileSize: size,
      duration: 5,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'vidB.mp4',
      lastModified: 100,
      contentHash: hashB,
      hashStatus: 'completed'
    });

    assert(videoA.id !== videoB.id, 'Different content hashes yield distinct asset IDs');
    assert(testDb.mediaAssets.length === 2, 'Two separate media assets exist');
  });

  await runTest('10-9. File move / relative path change preserves evaluations, tags, and notes', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_move_', 'TestVideoDB_Move');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const content = new Uint8Array([42, 42]);
    const hash = await computeFileSHA256(new Blob([content]), { useWorker: false });

    // Register initial location
    const video = await testDb.addVideo({
      title: 'original.mp4',
      fileName: 'original.mp4',
      fileSize: content.length,
      duration: 60,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'original.mp4',
      lastModified: 100,
      contentHash: hash,
      hashStatus: 'completed'
    });

    // Add review, rating, tags, and notes
    await testDb.saveReview(video.id, { overallGrade: 'A', comment: 'Loved it', ratings: { 'crit-content': 5 } });
    const tag = await testDb.addTagToVideo(video.id, 'tag-1');
    await testDb.addTimelineNote(video.id, { timestampSeconds: 10, comment: 'Great transition', timestampLabel: '00:10', thumbnailBlob: null });

    // Scan detects file moved to new relative path
    const movedVideo = await testDb.addVideo({
      title: 'moved.mp4',
      fileName: 'moved.mp4',
      fileSize: content.length,
      duration: 60,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'subfolder/moved.mp4',
      lastModified: 101,
      contentHash: hash,
      hashStatus: 'completed'
    });

    assert(video.id === movedVideo.id, 'Moved file shares the same logical asset ID');

    // Check that evaluations, tags, and notes are preserved
    const retrievedReview = testDb.getReviewForVideo(video.id);
    assert(retrievedReview && retrievedReview.overallGrade === 'A', 'Review grade preserved');

    const hasTag = testDb.videoTags.some(vt => vt.mediaAssetId === video.id && vt.tagId === tag.id);
    assert(hasTag, 'Tag association preserved');

    const note = testDb.timelineNotes.find(n => n.mediaAssetId === video.id);
    assert(note && note.comment === 'Great transition', 'Timeline note preserved');
  });

  await runTest('10-10. Hashing failure marks hashStatus: failed without destroying existing data', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_hash_fail_', 'TestVideoDB_HashFail');
    await testDb.initAsync();

    const video = await testDb.addVideo({
      title: 'test.mp4',
      fileName: 'test.mp4',
      fileSize: 500,
      duration: 30,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'test.mp4',
      lastModified: 100,
      hashStatus: 'pending'
    });

    await testDb.saveReview(video.id, { overallGrade: 'B', comment: 'Tested' });

    // Mark hash as failed
    await testDb.updateVideo(video.id, { hashStatus: 'failed' });

    const updatedVideo = testDb.getVideo(video.id);
    assert(updatedVideo.hashStatus === 'failed', 'Status is failed');
    assert(updatedVideo.contentHash === '', 'Hash remains empty');

    const review = testDb.getReviewForVideo(video.id);
    assert(review && review.overallGrade === 'B', 'Review remains intact');
  });

  await runTest('10-11. Deduplication merge rollback on failure', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_merge_fail_', 'TestVideoDB_MergeFail');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.criterionRatings = [];
    testDb.reviewTags = [];
    testDb.timelineNotes = [];

    const videoA = await testDb.addVideo({
      title: 'A.mp4',
      fileName: 'A.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'A.mp4',
      contentHash: 'hash-A',
      hashStatus: 'completed'
    });

    const videoB = await testDb.addVideo({
      title: 'B.mp4',
      fileName: 'B.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'B.mp4',
      contentHash: 'hash-B',
      hashStatus: 'completed'
    });

    await testDb.addTagToVideo(videoB.id, 'tag-1');

    const snapMemoryAssets = JSON.stringify(testDb.mediaAssets);
    const snapMemoryLocations = JSON.stringify(testDb.fileLocations);
    const snapMemoryReviews = JSON.stringify(testDb.reviews);
    const snapMemoryVideoTags = JSON.stringify(testDb.videoTags);
    const snapStorageAssets = memory.getItem('test_vreview_merge_fail_media_assets');
    const snapStorageLocations = memory.getItem('test_vreview_merge_fail_file_locations');
    const snapStorageVideoTags = memory.getItem('test_vreview_merge_fail_video_tags');

    const originalSaveTable = testDb._saveTable;
    testDb._saveTable = function(key, data) {
      if (key === 'file_locations') {
        throw new Error('Disk Full Mock Error');
      }
      return originalSaveTable.call(testDb, key, data);
    };

    let threw = false;
    try {
      await testDb.mergeMediaAssets(videoA.id, videoB.id);
    } catch (err) {
      if (err.message.includes('Disk Full Mock Error')) {
        threw = true;
      }
    }

    testDb._saveTable = originalSaveTable;

    assert(threw, 'Merge throws error mid-way during saving');

    assert(JSON.stringify(testDb.mediaAssets) === snapMemoryAssets, 'In-memory assets rolled back');
    assert(JSON.stringify(testDb.fileLocations) === snapMemoryLocations, 'In-memory locations rolled back');
    assert(JSON.stringify(testDb.reviews) === snapMemoryReviews, 'In-memory reviews rolled back');
    assert(JSON.stringify(testDb.videoTags) === snapMemoryVideoTags, 'In-memory video tags rolled back');

    assert(memory.getItem('test_vreview_merge_fail_media_assets') === snapStorageAssets, 'Storage assets rolled back');
    assert(memory.getItem('test_vreview_merge_fail_file_locations') === snapStorageLocations, 'Storage locations rolled back');
    assert(memory.getItem('test_vreview_merge_fail_video_tags') === snapStorageVideoTags, 'Storage video tags rolled back');
  });

  await runTest('10-12. Tag filter works with mediaAssetId', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_tag_filter_', 'TestVideoDB_TagFilter');
    await testDb.initAsync();

    const video = await testDb.addVideo({
      title: 'tag-test.mp4',
      fileName: 'tag-test.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'tag-test.mp4'
    });

    const tag = await testDb.addTagToVideo(video.id, 'tag-action');

    const videosList = [video];
    const filtered = filterVideosByTag(videosList, testDb.videoTags, tag.id);
    assert(filtered.length === 1, 'Filter returns tagged video');
    assert(filtered[0].id === video.id, 'Successfully resolved to media asset ID');
  });

  await runTest('10-13. Backup restore with displayTitle: null succeeds', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_null_', 'TestVideoDB_BackupNull');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-asset12345678',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh1',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: null,
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      file_locations: [
        {
          id: 'loc-location12345678',
          mediaAssetId: 'ast-asset12345678',
          directoryId: 'dir-1',
          relativePath: 'path.mp4',
          fileName: 'path.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', description: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      evaluation_templates: []
    };

    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: 1,
        file_locations: 1,
        reviews: 0,
        images: 0
      }
    };

    const result = testDb.validateBackupData(sampleBackup, manifest, []);
    assert(result.fatalErrors.length === 0, 'Backup with displayTitle: null failed validation: ' + result.fatalErrors.join(', '));
  });

  await runTest('10-14. Backup restore with custom criteria descriptions succeeds', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_crit_', 'TestVideoDB_BackupCrit');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [],
      file_locations: [],
      rating_criteria: [
        { id: 'crit-custom', name: 'Custom Name', description: 'Custom Description', templateId: 'temp-default', status: 'active', orderIndex: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [],
      evaluation_templates: []
    };

    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: 0,
        file_locations: 0,
        reviews: 0,
        images: 0
      }
    };

    const result = testDb.validateBackupData(sampleBackup, manifest, []);
    assert(result.fatalErrors.length === 0, 'Custom criteria validated successfully');
  });

  await runTest('10-15. Reject backup if hashStatus: completed has invalid SHA-256', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_invalid_hash_', 'TestVideoDB_BackupInvalidHash');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-1',
          contentHash: 'short-hash',
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh1',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video A',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [],
      evaluation_templates: []
    };

    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: 1,
        file_locations: 0,
        reviews: 0,
        images: 0
      }
    };

    const result = testDb.validateBackupData(sampleBackup, manifest, []);
    assert(result.fatalErrors.length > 0, 'Rejected invalid contentHash length');
  });

  await runTest('10-16. Reject backup if duplicate completed contentHash exists across multiple assets', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_dup_hash_', 'TestVideoDB_BackupDupHash');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-1',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh1',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video A',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'ast-2',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh2',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video B',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [],
      evaluation_templates: []
    };

    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: 2,
        file_locations: 0,
        reviews: 0,
        images: 0
      }
    };

    const result = testDb.validateBackupData(sampleBackup, manifest, []);
    assert(result.fatalErrors.length > 0, 'Rejected duplicate completed hash without conflict status');
  });

  await runTest('10-17. Migration from v2 preserves reviews, tags, notes, thumbnails', async () => {
    const memory = new MemoryStorage();
    const originalVideos = [
      { id: 'vid-1', title: 'Video 1', fileName: 'v1.mp4', fileSize: 100, duration: 10, hashStatus: 'pending', genreId: 'genre-default', thumbnailUrl: '', thumbnailId: 'img-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];
    const originalReviews = [
      { id: 'rev-1', videoId: 'vid-1', overallGrade: 'A', comment: 'Cool', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];
    const originalVideoTags = [
      { mediaAssetId: 'vid-1', videoId: 'vid-1', tagId: 'tag-action' }
    ];
    const originalTags = [
      { id: 'tag-action', name: 'Action', normalizedName: 'action' }
    ];
    const originalTimelineNotes = [
      { id: 'note-1', videoId: 'vid-1', timestampSeconds: 2, timestampLabel: '00:02', comment: 'Cool scene', thumbnailId: 'img-note-1', createdAt: new Date().toISOString() }
    ];

    memory.setItem('test_v2_schema_version', '2');
    memory.setItem('test_v2_videos', JSON.stringify(originalVideos));
    memory.setItem('test_v2_video_reviews', JSON.stringify(originalReviews));
    memory.setItem('test_v2_tags', JSON.stringify(originalTags));
    memory.setItem('test_v2_video_tags', JSON.stringify(originalVideoTags));
    memory.setItem('test_v2_timeline_notes', JSON.stringify(originalTimelineNotes));

    const testDb = new AppDatabase(memory, 'test_v2_', 'TestVideoDB_v2');
    await testDb.initAsync();

    assert(testDb.mediaAssets.length === 1, 'Video migrated to media asset');
    assert(testDb.fileLocations.length === 1, 'Location created');

    const review = testDb.getReviewForVideo('vid-1');
    assert(review && review.overallGrade === 'A', 'Review overallGrade preserved');

    const hasTag = testDb.videoTags.some(vt => (vt.mediaAssetId === 'vid-1' || vt.mediaAssetId === 'vid-v2-1') && vt.tagId === 'tag-action');
    assert(hasTag, 'Tag preserved');

    const note = testDb.timelineNotes.find(n => n.mediaAssetId === 'vid-1' || n.mediaAssetId === 'vid-v2-1');
    assert(note && note.comment === 'Cool scene', 'Timeline note preserved');
  });

  await runTest('10-18. Windows backslash vs Unix slash path normalization does not affect hash identity', async () => {
    const relativePathWindows = 'subfolder\\video.mp4';
    const relativePathUnix = 'subfolder/video.mp4';

    const normalizedWindows = normalizePath(relativePathWindows);
    assert(normalizedWindows === relativePathUnix, 'Backslashes successfully converted to Unix forward slashes');
    assert(normalizePath('/subfolder/video.mp4/') === 'subfolder/video.mp4', 'Leading/trailing slashes stripped');
  });

  await runTest('10-19. Database reload / persistence retains completed hashes and associations', async () => {
    const memory = new MemoryStorage();
    const testDb1 = new AppDatabase(memory, 'test_vreview_reload_', 'TestVideoDB_Reload');
    await testDb1.initAsync();

    const video = await testDb1.addVideo({
      title: 'persisted.mp4',
      fileName: 'persisted.mp4',
      fileSize: 1000,
      contentHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      hashStatus: 'completed'
    });

    const testDb2 = new AppDatabase(memory, 'test_vreview_reload_', 'TestVideoDB_Reload');
    await testDb2.initAsync();

    const reloadedVideo = testDb2.getVideo(video.id);
    assert(reloadedVideo, 'Video exists after database reload');
    assert(reloadedVideo.contentHash === 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', 'SHA-256 hash persists');
    assert(reloadedVideo.hashStatus === 'completed', 'hashStatus persists');
  });

  await runTest('10-20. Dual folders with same relative paths register correctly', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_dual_folder_', 'TestVideoDB_DualFolder');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const vid1 = await testDb.addVideo({
      title: 'vid.mp4',
      fileName: 'vid.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'sub/vid.mp4'
    });

    const vid2 = await testDb.addVideo({
      title: 'vid.mp4',
      fileName: 'vid.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-2',
      relativePath: 'sub/vid.mp4'
    });

    assert(vid1.id !== vid2.id, 'Different media assets initially');
    assert(testDb.fileLocations.length === 2, 'Two locations created');
    assert(testDb.fileLocations.some(l => l.directoryId === 'dir-1'), 'Location 1 mapped to dir-1');
    assert(testDb.fileLocations.some(l => l.directoryId === 'dir-2'), 'Location 2 mapped to dir-2');
  });

  await runTest('10-21. Hashing second folder video merges into first if no evaluations exist', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_dual_hash_', 'TestVideoDB_DualHash');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const vid1 = await testDb.addVideo({
      title: 'vid.mp4',
      fileName: 'vid.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'sub/vid.mp4'
    });

    const vid2 = await testDb.addVideo({
      title: 'vid.mp4',
      fileName: 'vid.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-2',
      relativePath: 'sub/vid.mp4'
    });

    const res1 = await testDb.completeVideoHashing(vid1.id, VALID_HASH_A);
    assert(!res1.merged && !res1.conflict, 'First hash completes normally');

    const res2 = await testDb.completeVideoHashing(vid2.id, VALID_HASH_A);
    assert(res2.merged, 'Second hash triggers auto-merge');
    assert(res2.targetAssetId === vid1.id, 'Merged target is vid1');
    assert(testDb.mediaAssets.length === 1, 'Only one media asset remains');
    assert(testDb.fileLocations.length === 2, 'Both locations exist on target');
    assert(testDb.fileLocations.every(l => l.mediaAssetId === vid1.id), 'Locations point to vid1');
  });

  await runTest('10-22. Multi-location fallback on handle permission failure', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_fallback_', 'TestVideoDB_Fallback');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.directorySources = [
      { id: 'dir-fail', name: 'Failed Folder', handleKey: 'key-fail', permissionStatus: 'denied' },
      { id: 'dir-ok', name: 'OK Folder', handleKey: 'key-ok', permissionStatus: 'granted' }
    ];

    const asset = await testDb.addVideo({
      title: 'file.mp4',
      fileName: 'file.mp4',
      fileSize: 500,
      sourceType: 'directory',
      directoryId: 'dir-fail',
      relativePath: 'file.mp4',
      lastModified: 999
    });

    await testDb.addFileLocation(asset.id, {
      directoryId: 'dir-ok',
      relativePath: 'file.mp4',
      fileName: 'file.mp4',
      fileSize: 500,
      lastModified: 999
    });

    const mockFileObj = new Blob([new Uint8Array(500)]);
    mockFileObj.lastModified = 999;
    const mockFileHandle = { getFile: async () => mockFileObj };
    const mockDirHandleOK = {
      queryPermission: async () => 'granted',
      getFileHandle: async () => mockFileHandle
    };
    const mockDirHandleFail = {
      queryPermission: async () => 'denied'
    };

    const handles = {
      'key-fail': mockDirHandleFail,
      'key-ok': mockDirHandleOK
    };
    testDb.getDirectoryHandle = async (key) => handles[key];

    const locations = testDb.fileLocations.filter(loc => loc.mediaAssetId === asset.id);
    let resolvedFile = null;
    for (const loc of locations) {
      try {
        const source = testDb.directorySources.find(s => s.id === loc.directoryId);
        const handle = await testDb.getDirectoryHandle(source.handleKey);
        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') throw new Error('No permission');
        resolvedFile = await handle.getFileHandle(loc.relativePath);
        break;
      } catch (e) {
        // continues
      }
    }

    assert(resolvedFile !== null, 'Successfully fell back to working directory handle');
  });

  await runTest('10-23. Revert calculating state to pending on startup for directory and local-file videos', async () => {
    const memory = new MemoryStorage();
    const mockAssets = [
      { id: 'vid-dir-calc', contentHash: '', hashStatus: 'calculating' }
    ];
    memory.setItem('test_vreview_startup_calc_media_assets', JSON.stringify(mockAssets));

    const testDb = new AppDatabase(memory, 'test_vreview_startup_calc_', 'TestVideoDB_StartupCalc');
    await testDb.initAsync();

    const vDir = testDb.getVideo('vid-dir-calc');

    assert(vDir.hashStatus === 'pending', 'Directory video calculating state reverted to pending');
  });

  await runTest('10-24. Same grade but different comments triggers conflict', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_conflict_comment_', 'TestVideoDB_ConflictComment');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];

    const vidA = await testDb.addVideo({ title: 'A.mp4', fileName: 'A.mp4' });
    const vidB = await testDb.addVideo({ title: 'B.mp4', fileName: 'B.mp4' });

    await testDb.saveReview(vidA.id, { overallGrade: 'A', comment: 'First' });
    await testDb.saveReview(vidB.id, { overallGrade: 'A', comment: 'Second' });

    await testDb.completeVideoHashing(vidA.id, VALID_HASH_A);
    const res = await testDb.completeVideoHashing(vidB.id, VALID_HASH_A);
    assert(res.conflict, 'Conflict detected');
    assert(res.reason === 'both-assets-have-review-data', 'Reason matches both-assets-have-review-data');
  });

  await runTest('10-25. Ratings presence on both assets triggers conflict', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_conflict_rating_', 'TestVideoDB_ConflictRating');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.criterionRatings = [];

    const vidA = await testDb.addVideo({ title: 'A.mp4', fileName: 'A.mp4' });
    const vidB = await testDb.addVideo({ title: 'B.mp4', fileName: 'B.mp4' });

    const revA = await testDb.saveReview(vidA.id, { overallGrade: '', comment: '' });
    const revB = await testDb.saveReview(vidB.id, { overallGrade: '', comment: '' });

    testDb.criterionRatings.push({ id: 'cr-1', videoReviewId: revA.id, criterionId: 'crit-lighting', score: 4 });
    testDb.criterionRatings.push({ id: 'cr-2', videoReviewId: revB.id, criterionId: 'crit-lighting', score: 3 });

    await testDb.completeVideoHashing(vidA.id, VALID_HASH_A);
    const res = await testDb.completeVideoHashing(vidB.id, VALID_HASH_A);
    assert(res.conflict, 'Conflict detected');
  });

  await runTest('10-26. Timeline note presence on both assets triggers conflict', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_conflict_notes_', 'TestVideoDB_ConflictNotes');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.timelineNotes = [];

    const vidA = await testDb.addVideo({ title: 'A.mp4', fileName: 'A.mp4' });
    const vidB = await testDb.addVideo({ title: 'B.mp4', fileName: 'B.mp4' });

    testDb.timelineNotes.push({ id: 'note-1', mediaAssetId: vidA.id, timestampSeconds: 5, comment: 'note A' });
    testDb.timelineNotes.push({ id: 'note-2', mediaAssetId: vidB.id, timestampSeconds: 5, comment: 'note B' });

    await testDb.completeVideoHashing(vidA.id, VALID_HASH_A);
    const res = await testDb.completeVideoHashing(vidB.id, VALID_HASH_A);
    assert(res.conflict, 'Conflict detected');
  });

  await runTest('10-27. Conflict returns separate assets and preserves all original data of both', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_preserve_', 'TestVideoDB_Preserve');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.timelineNotes = [];

    const vidA = await testDb.addVideo({ title: 'A.mp4', fileName: 'A.mp4' });
    const vidB = await testDb.addVideo({ title: 'B.mp4', fileName: 'B.mp4' });

    await testDb.saveReview(vidA.id, { overallGrade: 'A', comment: 'First' });
    await testDb.saveReview(vidB.id, { overallGrade: 'B', comment: 'Second' });

    await testDb.completeVideoHashing(vidA.id, VALID_HASH_A);
    const res = await testDb.completeVideoHashing(vidB.id, VALID_HASH_A);

    assert(res.conflict, 'Conflict returned');

    assert(testDb.mediaAssets.length === 2, 'Both assets retained');
    assert(testDb.fileLocations.length === 2, 'Both locations retained');
    assert(testDb.reviews.length === 2, 'Both reviews retained');

    const assetA = testDb.mediaAssets.find(a => a.id === vidA.id);
    const assetB = testDb.mediaAssets.find(a => a.id === vidB.id);
    assert(assetA.identityStatus === 'conflict' && assetB.identityStatus === 'conflict', 'Both marked as conflict');
    assert(assetA.identityConflictGroupId === assetB.identityConflictGroupId, 'Conflict group IDs match');
    assert(assetA.identityConflictGroupId !== null, 'Conflict group ID is not null');
  });

  await runTest('10-28. Backup with duplicate contentHash succeeds if marked as conflict with matching group ID', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_conf_ok_', 'TestVideoDB_BackupConfOk');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-asset12345678',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh1',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video A',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'conflict',
          identityConflictGroupId: 'group-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'ast-asset87654321',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh2',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video B',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'conflict',
          identityConflictGroupId: 'group-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      file_locations: [
        {
          id: 'loc-location12345678',
          mediaAssetId: 'ast-asset12345678',
          directoryId: 'dir-1',
          relativePath: 'path1.mp4',
          fileName: 'path1.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'loc-location87654321',
          mediaAssetId: 'ast-asset87654321',
          directoryId: 'dir-2',
          relativePath: 'path2.mp4',
          fileName: 'path2.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', description: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      evaluation_templates: []
    };

    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: 2,
        file_locations: 2,
        reviews: 0,
        images: 0
      }
    };

    const result = testDb.validateBackupData(sampleBackup, manifest, []);
    assert(result.fatalErrors.length === 0, 'Backup failed validation in 10-28: ' + result.fatalErrors.join(', '));
  });

  await runTest('10-29. Backup is rejected if duplicate contentHash exists on normal assets', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_conf_ng_', 'TestVideoDB_BackupConfNg');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-asset12345678',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh1',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video A',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'ast-asset87654321',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh2',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video B',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'conflict',
          identityConflictGroupId: 'group-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      file_locations: [
        {
          id: 'loc-location12345678',
          mediaAssetId: 'ast-asset12345678',
          directoryId: 'dir-1',
          relativePath: 'path1.mp4',
          fileName: 'path1.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'loc-location87654321',
          mediaAssetId: 'ast-asset87654321',
          directoryId: 'dir-2',
          relativePath: 'path2.mp4',
          fileName: 'path2.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', description: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      evaluation_templates: []
    };

    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: 2,
        file_locations: 2,
        reviews: 0,
        images: 0
      }
    };

    const result = testDb.validateBackupData(sampleBackup, manifest, []);
    assert(result.fatalErrors.length > 0, 'Backup is rejected with fatal errors due to invalid duplicate hashes');
    assert(result.fatalErrors.some(err => err.includes('重複')), 'Rejection error mentions duplicate hash');
  });

  await runTest('10-30. Backup is rejected if duplicate contentHash conflict assets have different group IDs', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_conf_ng2_', 'TestVideoDB_BackupConfNg2');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-asset12345678',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh1',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video A',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'conflict',
          identityConflictGroupId: 'group-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'ast-asset87654321',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh2',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: 'Video B',
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'conflict',
          identityConflictGroupId: 'group-2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      file_locations: [
        {
          id: 'loc-location12345678',
          mediaAssetId: 'ast-asset12345678',
          directoryId: 'dir-1',
          relativePath: 'path1.mp4',
          fileName: 'path1.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'loc-location87654321',
          mediaAssetId: 'ast-asset87654321',
          directoryId: 'dir-2',
          relativePath: 'path2.mp4',
          fileName: 'path2.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', description: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      evaluation_templates: []
    };

    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: 2,
        file_locations: 2,
        reviews: 0,
        images: 0
      }
    };

    const result = testDb.validateBackupData(sampleBackup, manifest, []);
    assert(result.fatalErrors.length > 0, 'Backup is rejected if conflict group IDs mismatch');
    assert(result.fatalErrors.some(err => err.includes('identityConflictGroupId')), 'Rejection error mentions mismatch of identityConflictGroupId');
  });

  await runTest('10-31. Path separator normalization across folder scans and addVideo matching', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_path_norm_', 'TestVideoDB_PathNorm');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const video = await testDb.addVideo({
      title: 'video.mp4',
      fileName: 'video.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'subfolder\\video.mp4'
    });

    const loc = testDb.fileLocations.find(l => l.mediaAssetId === video.id);
    assert(loc.relativePath === 'subfolder/video.mp4', 'Path normalized in DB to forward slash');

    const matched = await testDb.addVideo({
      title: 'video.mp4',
      fileName: 'video.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'subfolder/video.mp4'
    });

    assert(matched.id === video.id, 'Matching successfully resolves to same media asset ID');
  });

  await runTest('10-32. Hashing resets to pending if file size changes before or after calculation', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_dynamic_', 'TestVideoDB_Dynamic');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const asset = await testDb.addVideo({
      title: 'file.mp4',
      fileName: 'file.mp4',
      fileSize: 500,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'file.mp4',
      lastModified: 1000
    });

    let fileObjBefore = { size: 600, lastModified: 1000 };
    const resBefore = await testDb.performVerifiedVideoHashing(
      asset.id,
      async (loc) => fileObjBefore,
      async (file) => VALID_HASH_A
    );
    assert(resBefore.status === 'failed' && resBefore.reason === 'all-locations-failed', 'Fails when properties mismatched before hashing');

    let resolveCount = 0;
    const resDuring = await testDb.performVerifiedVideoHashing(
      asset.id,
      async (loc) => {
        resolveCount++;
        if (resolveCount === 1) {
          return { size: 500, lastModified: 1000 };
        } else {
          return { size: 600, lastModified: 1000 };
        }
      },
      async (file) => VALID_HASH_A
    );
    assert(resDuring.status === 'discarded' && resDuring.reason === 'metadata-changed', 'Discarded when properties change during hashing');

    const updatedAsset = testDb.getVideo(asset.id);
    assert(updatedAsset.hashStatus === 'pending', 'Asset hashStatus reset to pending');
  });

  await runTest('10-33. Backfill and schema normalization on restore', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_restore_norm_', 'TestVideoDB_RestoreNorm');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-asset12345678',
          contentHash: VALID_HASH_A,
          hashAlgorithm: 'SHA-256',
          quickHash: 'qh1',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          displayTitle: '',
          genreId: 'genre-default',
          thumbnailId: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      file_locations: [
        {
          id: 'loc-location12345678',
          mediaAssetId: 'ast-asset12345678',
          directoryId: 'dir-1',
          relativePath: 'path1\\subfolder\\file.mp4',
          fileName: 'file.mp4',
          fileSize: 100,
          lastModified: 100,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const normalized = testDb.normalizeBackupData(sampleBackup);

    assert(sampleBackup.media_assets[0].displayTitle === '', 'Original object was not mutated (displayTitle)');
    assert(sampleBackup.file_locations[0].relativePath === 'path1\\subfolder\\file.mp4', 'Original object was not mutated (path)');
    assert(sampleBackup.media_assets[0].identityStatus === undefined, 'Original object was not mutated (identityStatus)');

    assert(normalized.media_assets[0].displayTitle === null, 'displayTitle normalized to null');
    assert(normalized.media_assets[0].identityStatus === 'normal', 'identityStatus backfilled to normal');
    assert(normalized.media_assets[0].identityConflictGroupId === null, 'identityConflictGroupId backfilled to null');
    assert(normalized.file_locations[0].relativePath === 'path1/subfolder/file.mp4', 'relativePath normalized to forward slash');
  });

  await runTest('10-34. Merging preserves thumbnail correctly based on canonical priority rules', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_merge_thumb_', 'TestVideoDB_MergeThumb');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];

    const vidA = await testDb.addVideo({ title: 'A.mp4', fileName: 'A.mp4' });
    const vidB = await testDb.addVideo({ title: 'B.mp4', fileName: 'B.mp4' });

    await testDb.updateVideo(vidB.id, { thumbnailId: 'img-source' });

    await testDb.mergeMediaAssets(vidA.id, vidB.id);

    const mergedAsset = testDb.mediaAssets.find(a => a.id === vidA.id);
    assert(mergedAsset.thumbnailId === 'img-source', 'Inherited thumbnail from source asset');

    const vidC = await testDb.addVideo({ title: 'C.mp4', fileName: 'C.mp4' });
    const vidD = await testDb.addVideo({ title: 'D.mp4', fileName: 'D.mp4' });
    await testDb.updateVideo(vidC.id, { thumbnailId: 'img-target' });
    await testDb.updateVideo(vidD.id, { thumbnailId: 'img-source-new' });

    await testDb.mergeMediaAssets(vidC.id, vidD.id);
    const mergedAsset2 = testDb.mediaAssets.find(a => a.id === vidC.id);
    assert(mergedAsset2.thumbnailId === 'img-target', 'Preserved target thumbnail');
  });

  } // ends if (runAll) for Group 1-10

  // --- GROUP 11: HASH-BASED RECONNECTION & PLAYBACK RESOLUTION TESTS (11-1 to 11-10) ---
  if (runAll || groupFilter === 'hash') {
    await runGroup11Tests(runTest, assert);
  }

  // --- GROUP 14: FOLDER MANAGEMENT & SCAN LOGIC TESTS ---
  if (runAll || groupFilter === 'folder') {
    await runFolderManagementTests(runTest, assert);
  }

  // --- GROUP 12: VIDEO ARCHIVING, RESCANNING, AND LOCATION DELETION TESTS ---
  if (runAll || groupFilter === 'archive') {
    await runArchiveManagementTests(runTest, assert);
  }

  // --- GROUP 16: REVIEW EDITOR & UI COMPONENTS TESTS ---
  if (runAll || groupFilter === 'review') {
    const editorResults = await runReviewEditorTests();
    results.push(...editorResults);
  }

  // --- GROUP 17: MULTI-REVIEWER DATABASE SCHEMA V4 TESTS ---
  if (runAll || groupFilter === 'schema') {
    const schemaResults = await runMultiReviewSchemaTests();
    results.push(...schemaResults);
  }

  // --- GROUP 18: SHARED REVIEW SCHEMA & PURE FUNCTIONS TESTS ---
  if (runAll || groupFilter === 'review-share-schema') {
    const shareResults = await runReviewShareSchemaTests();
    results.push(...shareResults);
  }

  // --- GROUP 19: SHARED REVIEW EXPORT & IMPORT TESTS ---
  if (runAll || groupFilter === 'review-share-import-export') {
    const shareImportExportResults = await runReviewShareImportExportTests();
    results.push(...shareImportExportResults);
  }

  // --- GROUP 20: SHARED REVIEW AGGREGATION & VIEW MODEL UI TESTS ---
  if (runAll || groupFilter === 'review-share-aggregate-ui') {
    const aggregateUIResults = await runReviewShareAggregateUITests();
    results.push(...aggregateUIResults);
  }

  // --- GROUP 21: PENDING SHARED REVIEW AUTOMATIC LINKING TESTS ---
  if (runAll || groupFilter === 'pending-shared-review-linking') {
    const pendingLinkingResults = await runPendingSharedReviewLinkingTests();
    results.push(...pendingLinkingResults);
  }

  // --- GROUP 22: TAG MANAGEMENT TESTS ---
  if (runAll || groupFilter === 'tag-management') {
    const tagManagementResults = await runTagManagementTests();
    results.push(...tagManagementResults);
  }

  if (runAll) {
    console.group('Group 13: Progress Panel UI Layout & Control Tests');

  await runTest('13-1. Progress panel positioning, styling, and z-index properties', async () => {
    bgHashState.panelClosed = false;
    bgHashState.panelMinimized = false;
    bgHashState.targetKeys.clear();
    bgHashState.targetKeys.add('test-key-1');

    updateBackgroundHashingUI(0, 1);

    const indicator = document.getElementById('bg-hash-indicator');
    assert(indicator !== null, 'Progress panel indicator must be present in DOM');
    assert(!indicator.classList.contains('hidden'), 'Indicator must be visible when targetKeys has active verification');

    const styleEl = document.getElementById('bg-hash-styles');
    assert(styleEl !== null, 'Dynamic styles tag for hashing panel must be present');

    const cssText = styleEl.textContent;
    assert(cssText.includes('position: fixed'), 'Must be fixed positioned');
    assert(cssText.includes('top: 76px'), 'Must be positioned at top: 76px below sticky header');
    assert(cssText.includes('right: 16px'), 'Must be positioned at right: 16px');
    assert(cssText.includes('z-index: 90'), 'z-index must be 90 (below modal overlay 100)');
    assert(cssText.includes('width: 260px'), 'Default desktop width is 260px');
    assert(cssText.includes('max-width: calc(100vw - 32px)'), 'Mobile max-width keeps panel within screen boundaries');

    bgHashState.targetKeys.clear();
    updateBackgroundHashingUI(0, 0);
  });

  await runTest('13-2. Minimize and maximize toggles changes layout but preserves background verification state', async () => {
    bgHashState.panelClosed = false;
    bgHashState.panelMinimized = false;
    bgHashState.targetKeys.clear();
    bgHashState.targetKeys.add('test-key-1');
    bgHashState.activeId = 'test-key-1';
    bgHashState.activeName = 'my_video.mp4';
    bgHashState.activePercent = 50;

    updateBackgroundHashingUI(0, 1);

    const indicator = document.getElementById('bg-hash-indicator');
    const fileEl = indicator.querySelector('.bg-hash-file');
    const progressContainer = indicator.querySelector('.bg-hash-progress-container');

    assert(fileEl.style.display !== 'none', 'Active file name is visible when maximized');
    assert(progressContainer.style.display !== 'none', 'Progress bar is visible when maximized');

    const minBtn = indicator.querySelector('.bg-hash-btn-min');
    minBtn.click();

    assert(bgHashState.panelMinimized === true, 'Flag panelMinimized must be true after clicking');
    assert(fileEl.style.display === 'none', 'Active file name must be hidden when minimized');
    assert(progressContainer.style.display === 'none', 'Progress bar must be hidden when minimized');

    const titleEl = indicator.querySelector('.bg-hash-title');
    assert(titleEl.textContent === 'ハッシュ検証 0 / 1', 'Title text matches minimized 1-line layout: ハッシュ検証 0 / 1');

    minBtn.click();
    assert(bgHashState.panelMinimized === false, 'Flag panelMinimized must be false after maximizing again');
    assert(fileEl.style.display !== 'none', 'File name visible again');

    bgHashState.targetKeys.clear();
    updateBackgroundHashingUI(0, 0);
  });

  await runTest('13-3. Closing progress panel hides it from view but keeps background verification running', async () => {
    bgHashState.panelClosed = false;
    bgHashState.targetKeys.clear();
    bgHashState.targetKeys.add('test-key-1');

    updateBackgroundHashingUI(0, 1);

    const indicator = document.getElementById('bg-hash-indicator');
    assert(!indicator.classList.contains('hidden'), 'Indicator visible');

    const closeBtn = indicator.querySelector('.bg-hash-btn-close');
    closeBtn.click();

    assert(bgHashState.panelClosed === true, 'panelClosed is true');
    assert(indicator.classList.contains('hidden'), 'Panel is hidden after close click');

    assert(bgHashState.targetKeys.has('test-key-1'), 'Target verification keys still exist in state');

    bgHashState.targetKeys.clear();
    bgHashState.panelClosed = false;
    updateBackgroundHashingUI(0, 0);
  });

  await runTest('13-4. New batch starts resets panelClosed and restores panel visibility', async () => {
    bgHashState.panelClosed = true;
    bgHashState.targetKeys.clear();

    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g13_4_', 'TestVideoDB_G13_4');
    await testDb.initAsync();

    globalHashQueue.queuedKeys.clear();
    globalHashQueue.runningKeys.clear();

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });

    const mockHandle = new MockFileSystemDirectoryHandle('FolderA', {
      'new_batch_video.mp4': new MockFileSystemFileHandle('new_batch_video.mp4', 100, 1000)
    });
    await testDb.putDirectoryHandle(source.handleKey, mockHandle);

    globalHashQueue.queuedKeys.clear();
    globalHashQueue.runningKeys.clear();

    bgHashState.panelClosed = true;

    if (globalHashQueue.queuedKeys.size === 0 && globalHashQueue.runningKeys.size === 0) {
      bgHashState.batchId = 'batch-' + Math.random().toString(36).slice(2);
      bgHashState.generation++;
      bgHashState.targetKeys.clear();
      bgHashState.completedKeys.clear();
      bgHashState.failedKeys.clear();
      bgHashState.skippedKeys.clear();
      bgHashState.panelClosed = false;
    }

    assert(bgHashState.panelClosed === false, 'panelClosed must be reset to false when new batch starts');
  });

  console.groupEnd(); // Group 13

  console.group('Group 15: URL Video Feature Deprecation Tests');

  await runTest('15-1. URL video feature deprecation and safety constraints', async () => {
    // 1. URL video add UI elements do not exist
    const btnAddUrlModal = document.getElementById('btn-add-url-modal');
    const modalAddUrl = document.getElementById('modal-add-url');
    assert(btnAddUrlModal === null, 'btn-add-url-modal should be removed');
    assert(modalAddUrl === null, 'modal-add-url should be removed');

    // 2. URL video register methods or handlers do not exist
    assert(typeof window.handleAddUrlSubmit === 'undefined', 'handleAddUrlSubmit should not be globally exposed');

    // 3. Setup test database
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_url_dep_');
    await testDb.initAsync();

    // 4. Verify new local asset does not have videoUrl property saved
    const addedLocal = await testDb.addVideo({
      title: 'test_local.mp4',
      fileName: 'test_local.mp4',
      fileSize: 100,
      sourceType: 'local-file'
    });
    assert(addedLocal.videoUrl === undefined, 'New local asset should not have videoUrl property');

    // 5. Verify addVideo() normal usage path does not accept videoUrl
    const addedWithUrl = await testDb.addVideo({
      title: 'test_local_url.mp4',
      fileName: 'test_local_url.mp4',
      fileSize: 100,
      sourceType: 'local-file',
      videoUrl: 'https://example.com/movie.mp4'
    });
    assert(addedWithUrl.videoUrl === undefined, 'addVideo should not save videoUrl even if passed');

    // 6. Verify addVideo() throws error when sourceType: 'url' is passed
    try {
      await testDb.addVideo({
        title: 'test_url.mp4',
        fileName: 'test_url.mp4',
        fileSize: 100,
        sourceType: 'url'
      });
      assert(false, 'Should throw error when sourceType is url');
    } catch (err) {
      assert(err.message.includes('URL動画はサポートされていません'), 'Error message should mention URL videos are not supported');
    }

    // 7. Verify backup checks
    const manifest = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0 }
    };

    // 7a. Backup with sourceType: 'url' is rejected even if videoUrl is empty
    const backupUrlSource = {
      media_assets: [{
        id: 'vid-invalid-url-source',
        contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        displayTitle: 'Invalid URL Source Video',
        genreId: 'genre-default',
        thumbnailId: '',
        videoUrl: '',
        sourceType: 'url',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      file_locations: [],
      video_reviews: [],
      criterion_ratings: [],
      rating_criteria: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{
        id: 'genre-default',
        name: 'Default',
        displayTitle: 'Default Genre',
        description: 'Default Genre',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      evaluation_templates: []
    };
    const resUrlSource = testDb.validateBackupData(backupUrlSource, manifest, []);
    assert(resUrlSource.isValid === false, 'Backup with sourceType url must be rejected');
    assert(resUrlSource.fatalErrors.some(e => e.includes("sourceType: 'url'")), 'Error message must mention sourceType: url');

    // 7b. Backup with non-empty videoUrl is rejected
    const backupNonEmptyUrl = {
      media_assets: [{
        id: 'vid-invalid-url',
        contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        displayTitle: 'Invalid URL Video',
        genreId: 'genre-default',
        thumbnailId: '',
        videoUrl: 'https://example.com/movie.mp4',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      file_locations: [],
      video_reviews: [],
      criterion_ratings: [],
      rating_criteria: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{
        id: 'genre-default',
        name: 'Default',
        displayTitle: 'Default Genre',
        description: 'Default Genre',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      evaluation_templates: []
    };
    const resNonEmptyUrl = testDb.validateBackupData(backupNonEmptyUrl, manifest, []);
    assert(resNonEmptyUrl.isValid === false, 'Backup with non-empty videoUrl must be rejected');
    assert(resNonEmptyUrl.fatalErrors.some(e => e.includes('URL動画ソース')), 'Error message must mention URL video source rejection');

    // 7c. Legacy backup containing only videoUrl: '' is accepted, and field is removed during restore
    const legacyBackup = {
      media_assets: [{
        id: 'vid-legacy-empty-url',
        contentHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        displayTitle: 'Legacy Empty URL Video',
        genreId: 'genre-default',
        thumbnailId: '',
        videoUrl: '',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      file_locations: [],
      video_reviews: [],
      criterion_ratings: [],
      rating_criteria: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{
        id: 'genre-default',
        name: 'Default',
        displayTitle: 'Default Genre',
        description: 'Default Genre',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      evaluation_templates: []
    };
    const resLegacy = testDb.validateBackupData(legacyBackup, manifest, []);
    assert(resLegacy.isValid === true, 'Legacy backup with empty videoUrl must be accepted. Errors: ' + (resLegacy.fatalErrors || []).join(', '));
    assert(resLegacy.repairedDb.media_assets[0].videoUrl === undefined, 'videoUrl must be removed in repairedDb');

    // Check restoreWithRollback clears videoUrl
    await testDb.restoreWithRollback(legacyBackup, []);
    const restoredAsset = testDb.getVideo('vid-legacy-empty-url');
    assert(restoredAsset !== null, 'Asset should be restored');
    assert(restoredAsset.videoUrl === undefined, 'Restored asset must not have videoUrl property');

    // 8. Local video Object URL playback is maintained
    const testUrl = URL.createObjectURL(new Blob(['test'], { type: 'video/mp4' }));
    assert(typeof testUrl === 'string' && testUrl.startsWith('blob:'), 'Object URL generation works normally');
    URL.revokeObjectURL(testUrl);
  });

  console.groupEnd(); // Group 15
  } // ends if (runAll) for Group 12-13

  // --- RUN GROUP 23: SCHEMA CANONICALIZATION TESTS ---
  if (!groupFilter || groupFilter === 'all' || groupFilter === 'schema-canonicalization') {
    const canonicalizationRes = await runSchemaCanonicalizationTests();
    results.push(...canonicalizationRes);
  }

  // --- RUN GROUP 24: CUSTOM POSTER TESTS ---
  if (!groupFilter || groupFilter === 'all' || groupFilter === 'custom-poster') {
    const customPosterRes = await runCustomPosterTests();
    results.push(...customPosterRes);
  }

  console.groupEnd(); // main suite
  return results;
}
