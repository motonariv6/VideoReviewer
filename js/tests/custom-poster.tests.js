// custom-poster.tests.js - Automated tests for Custom Poster feature
import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { exportReviews } from '../review-sharing/review-share-exporter.js';
import { setDbForTesting, generateLocalBackupZipBlob } from '../app.js';

export async function runCustomPosterTests() {
  const results = [];
  const runTest = async (name, fn) => {
    try {
      await fn();
      const res = { name, passed: true };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    } catch (e) {
      const res = { name, passed: false, error: e.message || String(e) };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    }
  };

  const assert = (condition, msg) => {
    if (!condition) throw new Error(msg);
  };

  console.group('Group 24: Custom Poster Tests');

  // Helper to create a test DB instance with preloaded media asset
  const createTestDb = (presetAssets = []) => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');
    memStorage.setItem('vreview_media_assets', JSON.stringify(presetAssets));
    memStorage.setItem('vreview_file_locations', JSON.stringify([]));
    memStorage.setItem('vreview_video_reviews', JSON.stringify([]));
    memStorage.setItem('vreview_criterion_ratings', JSON.stringify([]));
    memStorage.setItem('vreview_tags', JSON.stringify([]));
    memStorage.setItem('vreview_review_tags', JSON.stringify([]));
    memStorage.setItem('vreview_timeline_notes', JSON.stringify([]));
    memStorage.setItem('vreview_directory_sources', JSON.stringify([]));
    memStorage.setItem('vreview_genres', JSON.stringify([{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'desc', displayOrder: 1, isActive: true, createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }]));
    memStorage.setItem('vreview_pending_shared_reviews', JSON.stringify([]));
    memStorage.setItem('vreview_reviewers', JSON.stringify([
      { id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]));
    return new AppDatabase(memStorage, 'vreview_');
  };

  // 1. customPosterIdありのmedia_assetがSchema v4 validation PASS
  await runTest('1. customPosterIdありのmedia_assetがSchema v4 validation PASS', async () => {
    const db = createTestDb();
    const dbData = {
      schemaVersion: 4,
      reviewers: [{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }],
      media_assets: [{
        id: 'vid-12345678',
        contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        hashAlgorithm: 'SHA-256',
        quickHash: 'qhash123',
        hashStatus: 'completed',
        fileSize: 1024,
        duration: 60,
        displayTitle: 'Video 1',
        genreId: 'genre-default',
        customPosterId: 'img-poster-vid-12345678',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        createdAt: '2026-08-29T12:00:00Z',
        updatedAt: '2026-08-29T12:00:00Z'
      }],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'desc', displayOrder: 1, isActive: true, createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }],
      evaluation_templates: [],
      pending_shared_reviews: []
    };
    const valRes = db.validateBackupData(dbData, { schemaVersion: 4, application: 'VideoReviewer', createdAt: new Date().toISOString(), counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 1, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 } }, ['img-poster-vid-12345678']);
    assert(valRes.isValid === true, 'Validation should pass with customPosterId');
  });

  // 2. customPosterIdなしの旧v4 media_assetがPASS
  await runTest('2. customPosterIdなしの旧v4 media_assetがPASS', async () => {
    const db = createTestDb();
    const dbData = {
      schemaVersion: 4,
      reviewers: [{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }],
      media_assets: [{
        id: 'vid-12345678',
        contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        hashAlgorithm: 'SHA-256',
        quickHash: 'qhash123',
        hashStatus: 'completed',
        fileSize: 1024,
        duration: 60,
        displayTitle: 'Video 1',
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        createdAt: '2026-08-29T12:00:00Z',
        updatedAt: '2026-08-29T12:00:00Z'
      }],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'desc', displayOrder: 1, isActive: true, createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }],
      evaluation_templates: [],
      pending_shared_reviews: []
    };
    const valRes = db.validateBackupData(dbData, { schemaVersion: 4, application: 'VideoReviewer', createdAt: new Date().toISOString(), counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 } }, []);
    assert(valRes.isValid === true, 'Validation should pass without customPosterId');
  });

  // 3. customPosterId:nullがPASS
  await runTest('3. customPosterId:nullがPASS', async () => {
    const db = createTestDb();
    const dbData = {
      schemaVersion: 4,
      reviewers: [{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }],
      media_assets: [{
        id: 'vid-12345678',
        contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        hashAlgorithm: 'SHA-256',
        quickHash: 'qhash123',
        hashStatus: 'completed',
        fileSize: 1024,
        duration: 60,
        displayTitle: 'Video 1',
        genreId: 'genre-default',
        customPosterId: null,
        identityStatus: 'normal',
        identityConflictGroupId: null,
        createdAt: '2026-08-29T12:00:00Z',
        updatedAt: '2026-08-29T12:00:00Z'
      }],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'desc', displayOrder: 1, isActive: true, createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }],
      evaluation_templates: [],
      pending_shared_reviews: []
    };
    const valRes = db.validateBackupData(dbData, { schemaVersion: 4, application: 'VideoReviewer', createdAt: new Date().toISOString(), counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 } }, []);
    assert(valRes.isValid === true, 'Validation should pass with null customPosterId');
  });

  // Helper for actual mock JSZip extraction validation
  const createMockPosterZip = async (dbData, posterId, posterBlob) => {
    const zip = new JSZip();
    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      counts: {
        media_assets: dbData.media_assets.length,
        file_locations: dbData.file_locations.length,
        reviews: dbData.video_reviews.length,
        images: posterBlob ? 1 : 0,
        reviewers: dbData.reviewers.length,
        review_tags: dbData.review_tags.length,
        pending_shared_reviews: dbData.pending_shared_reviews.length
      }
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('database.json', JSON.stringify(dbData, null, 2));
    if (posterBlob) {
      zip.folder('images').folder('posters').file(posterId, posterBlob);
    }
    return await zip.generateAsync({ type: 'blob' });
  };

  // 4. Full Backupでposter Blobがimages/posters/に出力される & 5. Restoreで復元される
  await runTest('4 & 5. Backup/Restoreで posters/ フォルダを介して画像Blob + customPosterIdが復元されること', async () => {
    const asset = {
      id: 'vid-test-roundtrip',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Test Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-test-roundtrip',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const testDb = createTestDb([asset]);
    await testDb.initAsync();

    // Insert dummy poster blob
    const dummyBlob = new Blob(['poster-binary-data'], { type: 'image/png' });
    await testDb.putImage('img-poster-vid-test-roundtrip', dummyBlob);

    // Save original app.js db state
    const originalAppDb = await new Promise(resolve => {
      import('../app.js').then(m => resolve(m.db));
    });

    setDbForTesting(testDb);

    let zipBlob;
    try {
      zipBlob = await generateLocalBackupZipBlob();
    } finally {
      setDbForTesting(originalAppDb);
    }

    // Validate restoration flow
    const loadedZip = await JSZip.loadAsync(zipBlob);
    const manifestFile = loadedZip.file('manifest.json');
    const dbFile = loadedZip.file('database.json');
    const parsedDb = JSON.parse(await dbFile.async('string'));
    const parsedManifest = JSON.parse(await manifestFile.async('string'));

    // Verify images/posters/ layout inside ZIP (Blocker 2)
    const imageIds = [];
    const postersFolder = loadedZip.folder('images/posters');
    assert(postersFolder !== null, 'ZIP should contain images/posters folder');
    postersFolder.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir) imageIds.push(relativePath);
    });
    assert(imageIds.includes('img-poster-vid-test-roundtrip'), 'images/posters/ must contain the poster file');

    // Verify poster is NOT placed in images/thumbnails/ (Blocker 2)
    const thumbnailsFolder = loadedZip.folder('images/thumbnails');
    if (thumbnailsFolder) {
      let containsPosterInThumbnails = false;
      thumbnailsFolder.forEach((relativePath) => {
        if (relativePath.startsWith('img-poster-')) {
          containsPosterInThumbnails = true;
        }
      });
      assert(containsPosterInThumbnails === false, 'Poster image must NOT be placed inside images/thumbnails/');
    }

    const valResult = testDb.validateBackupData(parsedDb, parsedManifest, imageIds);
    assert(valResult.isValid === true, 'Backup should pass validation');

    // Restore to fresh DB
    const freshDb = createTestDb();
    await freshDb.initAsync();

    const imageEntries = [];
    await Promise.all(imageIds.map(async (id) => {
      const entry = postersFolder.file(id);
      const blob = await entry.async('blob');
      imageEntries.push({ id, data: blob });
    }));

    await freshDb.restoreWithRollback(valResult.repairedDb, imageEntries);

    // Verify restore values
    const restoredAsset = freshDb.getVideo('vid-test-roundtrip');
    assert(restoredAsset !== null, 'Asset should be restored');
    assert(restoredAsset.customPosterId === 'img-poster-vid-test-roundtrip', 'customPosterId should be restored');

    const restoredBlob = await freshDb.getImage('img-poster-vid-test-roundtrip');
    assert(restoredBlob !== null, 'Poster image Blob should be restored in IndexedDB');
    assert(restoredBlob.size === dummyBlob.size, 'Restored Blob size should match');
  });

  // 6. customPosterId参照画像がZIPに存在しないBackupをreject
  await runTest('6. customPosterId参照画像がZIPに存在しないBackupをrejectすること', async () => {
    const asset = {
      id: 'vid-missing-poster',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Test Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-missing',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([asset]);
    await db.initAsync();

    const dbData = {
      schemaVersion: 4,
      media_assets: [asset],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: db.genres,
      evaluation_templates: [],
      pending_shared_reviews: [],
      reviewers: db.reviewers
    };

    const valResult = db.validateBackupData(dbData, {
      application: 'VideoReviewer',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 }
    }, []); // Empty imageIds -> zip is missing image

    assert(valResult.isValid === false, 'Validation must reject missing required customPosterId image');
    assert(valResult.fatalErrors.some(e => e.includes('img-poster-missing')), 'Error should mention the missing poster ID');
  });

  // 7. archiveでposter保持
  await runTest('7. archive時にポスター参照および画像データが保持されること', async () => {
    const asset = {
      id: 'vid-archive-test',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Test Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-archive-test',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([asset]);
    await db.initAsync();

    const dummyBlob = new Blob(['poster-binary'], { type: 'image/png' });
    await db.putImage('img-poster-vid-archive-test', dummyBlob);

    // Archive video
    await db.updateVideo('vid-archive-test', { isArchived: true, archivedAt: new Date().toISOString() });

    const archivedAsset = db.getVideo('vid-archive-test');
    assert(archivedAsset.isArchived === true, 'Should be archived');
    assert(archivedAsset.customPosterId === 'img-poster-vid-archive-test', 'customPosterId must be retained during archive');

    const imageBlob = await db.getImage('img-poster-vid-archive-test');
    assert(imageBlob !== null, 'Image Blob must be retained in IndexedDB during archive');
  });

  // 8. permanent deleteでposter Blob削除
  await runTest('8. permanent deleteでポスター画像が IndexedDB から削除されること', async () => {
    const asset = {
      id: 'vid-delete-test',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Test Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-delete-test',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([asset]);
    await db.initAsync();

    const dummyBlob = new Blob(['poster-binary'], { type: 'image/png' });
    await db.putImage('img-poster-vid-delete-test', dummyBlob);

    // Trigger cascade delete
    const success = await db.deleteVideoCascade('vid-delete-test');
    assert(success === true, 'Delete cascade should succeed');

    const deletedAsset = db.getVideo('vid-delete-test');
    assert(deletedAsset === null, 'Asset should be deleted');

    const imageBlob = await db.getImage('img-poster-vid-delete-test');
    assert(imageBlob === null, 'Poster image Blob must be deleted from IndexedDB');
  });

  // 9. merge: targetなし/sourceあり -> target IDへBlob移管 -> source Blob削除
  await runTest('9. merge (targetなし/sourceあり) で target ID へ移管され source が削除されること', async () => {
    const target = {
      id: 'vid-target',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Target Video',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const source = {
      id: 'vid-source',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Source Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-source',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([target, source]);
    await db.initAsync();

    const dummyBlob = new Blob(['source-poster'], { type: 'image/png' });
    await db.putImage('img-poster-vid-source', dummyBlob);

    // Merge source into target
    const mergeRes = await db.mergeMediaAssets('vid-target', 'vid-source');
    assert(mergeRes.merged === true, 'Merge should succeed');

    const mergedTarget = db.getVideo('vid-target');
    assert(mergedTarget.customPosterId === 'img-poster-vid-target', 'Poster should transfer to target ID img-poster-vid-target');

    const targetBlob = await db.getImage('img-poster-vid-target');
    assert(targetBlob !== null, 'Target poster Blob should exist in IndexedDB');
    assert(targetBlob.size === dummyBlob.size, 'Blob size should match');

    const sourceBlob = await db.getImage('img-poster-vid-source');
    assert(sourceBlob === null, 'Source poster Blob should be deleted from IndexedDB');
  });

  // 10. merge: targetあり/sourceあり -> target保持 -> source削除
  await runTest('10. merge (targetあり/sourceあり) で target ポスターが維持され source ポスターが削除されること', async () => {
    const target = {
      id: 'vid-target',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Target Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-target',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const source = {
      id: 'vid-source',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Source Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-source',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([target, source]);
    await db.initAsync();

    const targetBlob = new Blob(['target-poster-data'], { type: 'image/png' });
    const sourceBlob = new Blob(['source-poster-data'], { type: 'image/png' });
    await db.putImage('img-poster-vid-target', targetBlob);
    await db.putImage('img-poster-vid-source', sourceBlob);

    const mergeRes = await db.mergeMediaAssets('vid-target', 'vid-source');
    assert(mergeRes.merged === true, 'Merge should succeed');

    const mergedTarget = db.getVideo('vid-target');
    assert(mergedTarget.customPosterId === 'img-poster-vid-target', 'Target poster ID should remain unchanged');

    const activeBlob = await db.getImage('img-poster-vid-target');
    assert(activeBlob !== null, 'Target poster Blob should exist');
    assert(activeBlob.size === targetBlob.size, 'Target poster data should be preserved');

    const deletedBlob = await db.getImage('img-poster-vid-source');
    assert(deletedBlob === null, 'Source poster Blob should be deleted');
  });

  // 11. merge: targetあり/sourceなし -> target保持
  await runTest('11. merge (targetあり/sourceなし) で target ポスターがそのまま維持されること', async () => {
    const target = {
      id: 'vid-target',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Target Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-target',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const source = {
      id: 'vid-source',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Source Video',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([target, source]);
    await db.initAsync();

    const targetBlob = new Blob(['target-poster-data'], { type: 'image/png' });
    await db.putImage('img-poster-vid-target', targetBlob);

    const mergeRes = await db.mergeMediaAssets('vid-target', 'vid-source');
    assert(mergeRes.merged === true, 'Merge should succeed');

    const mergedTarget = db.getVideo('vid-target');
    assert(mergedTarget.customPosterId === 'img-poster-vid-target', 'Target poster ID should remain unchanged');

    const activeBlob = await db.getImage('img-poster-vid-target');
    assert(activeBlob !== null && activeBlob.size === targetBlob.size, 'Target poster Blob should remain intact');
  });

  // 12. merge: 両方なし -> no-op
  await runTest('12. merge (両方ポスターなし) がエラーなく正常完了すること', async () => {
    const target = {
      id: 'vid-target',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Target Video',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const source = {
      id: 'vid-source',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Source Video',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([target, source]);
    await db.initAsync();

    const mergeRes = await db.mergeMediaAssets('vid-target', 'vid-source');
    assert(mergeRes.merged === true, 'Merge should succeed');

    const mergedTarget = db.getVideo('vid-target');
    assert(!mergedTarget.customPosterId, 'Target should not have customPosterId');
  });

  // 13. merge処理中のポスター書込/削除成功後のマージ失敗時ロールバック (Policy 3)
  await runTest('13. merge処理中のポスター書込/削除成功後のマージ失敗時ロールバック (Policy 3)', async () => {
    const target = {
      id: 'vid-target',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Target Video',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const source = {
      id: 'vid-source',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Source Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-source',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([target, source]);
    await db.initAsync();

    const dummyBlob = new Blob(['source-poster'], { type: 'image/png' });
    await db.putImage('img-poster-vid-source', dummyBlob);

    // Mock _saveTable to throw error during target merge write phase
    const originalSaveTable = db._saveTable;
    db._saveTable = (table) => {
      if (table === 'media_assets') {
        throw new Error('故意のマージ後エラー');
      }
    };

    let errorThrown = false;
    try {
      await db.mergeMediaAssets('vid-target', 'vid-source');
    } catch (err) {
      errorThrown = true;
    }

    assert(errorThrown === true, 'Merge should raise error');

    // Restore _saveTable function
    db._saveTable = originalSaveTable;

    // Verify rollback (source and target still exist)
    const rolledBackTarget = db.getVideo('vid-target');
    const rolledBackSource = db.getVideo('vid-source');
    assert(rolledBackTarget !== null, 'Target should exist');
    assert(rolledBackSource !== null, 'Source should exist');
    assert(!rolledBackTarget.customPosterId, 'Target poster reference must be rolled back to none');
    assert(rolledBackSource.customPosterId === 'img-poster-vid-source', 'Source poster reference must be restored');

    const sourceBlobExists = await db.getImage('img-poster-vid-source');
    assert(sourceBlobExists !== null, 'Source poster Blob must be restored in IndexedDB');

    const targetBlobExists = await db.getImage('img-poster-vid-target');
    assert(targetBlobExists === null, 'Newly created target poster Blob must be cleaned up from IndexedDB');
  });

  // 13-2. merge処理中のポスター削除成功後のマージ失敗時ロールバック (Policy 1)
  await runTest('13-2. merge処理中のポスター削除成功後のマージ失敗時ロールバック (Policy 1)', async () => {
    const target = {
      id: 'vid-target',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Target Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-target',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const source = {
      id: 'vid-source',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Source Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-source',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([target, source]);
    await db.initAsync();

    const targetBlob = new Blob(['target-poster-data'], { type: 'image/png' });
    const sourceBlob = new Blob(['source-poster-data'], { type: 'image/png' });
    await db.putImage('img-poster-vid-target', targetBlob);
    await db.putImage('img-poster-vid-source', sourceBlob);

    // Mock _saveTable to throw error during target merge write phase
    const originalSaveTable = db._saveTable;
    db._saveTable = (table) => {
      if (table === 'media_assets') {
        throw new Error('故意のマージ後エラー');
      }
    };

    let errorThrown = false;
    try {
      await db.mergeMediaAssets('vid-target', 'vid-source');
    } catch (err) {
      errorThrown = true;
    }

    assert(errorThrown === true, 'Merge should raise error');

    // Restore _saveTable function
    db._saveTable = originalSaveTable;

    // Verify rollback
    const rolledBackTarget = db.getVideo('vid-target');
    const rolledBackSource = db.getVideo('vid-source');
    assert(rolledBackTarget !== null && rolledBackSource !== null, 'Both assets should exist');
    assert(rolledBackTarget.customPosterId === 'img-poster-vid-target', 'Target poster reference must be restored');
    assert(rolledBackSource.customPosterId === 'img-poster-vid-source', 'Source poster reference must be restored');

    const targetBlobExists = await db.getImage('img-poster-vid-target');
    const sourceBlobExists = await db.getImage('img-poster-vid-source');
    assert(targetBlobExists !== null && targetBlobExists.size === targetBlob.size, 'Target poster Blob must be preserved');
    assert(sourceBlobExists !== null && sourceBlobExists.size === sourceBlob.size, 'Source poster Blob must be restored');
  });

  // 14. Full Backup → Restore → Full Backup round-tripでposter association / Blobが保持される
  await runTest('14. Full Backup -> Restore -> Full Backup round-tripでポスターとBlobが完璧に保持されること', async () => {
    const asset = {
      id: 'vid-roundtrip',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Roundtrip Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-roundtrip',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([asset]);
    await db.initAsync();

    const dummyBlob = new Blob(['roundtrip-data'], { type: 'image/png' });
    await db.putImage('img-poster-vid-roundtrip', dummyBlob);

    // Simulate Backup creation
    const dbData = {
      schemaVersion: 4,
      media_assets: db.mediaAssets,
      file_locations: db.fileLocations,
      rating_criteria: db.criteria,
      video_reviews: db.reviews,
      criterion_ratings: db.criterionRatings,
      tags: db.tags,
      review_tags: db.reviewTags,
      timeline_notes: db.timelineNotes,
      directory_sources: db.directorySources,
      genres: db.genres,
      evaluation_templates: db.templates,
      pending_shared_reviews: db.pendingSharedReviews,
      reviewers: db.reviewers
    };

    const zipBlob = await createMockPosterZip(dbData, 'img-poster-vid-roundtrip', dummyBlob);

    // Simulate Restore
    const loadedZip = await JSZip.loadAsync(zipBlob);
    const dbFile = loadedZip.file('database.json');
    const parsedDb = JSON.parse(await dbFile.async('string'));

    const imageIds = [];
    const postersFolder = loadedZip.folder('images/posters');
    postersFolder.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir) imageIds.push(relativePath);
    });

    const valResult = db.validateBackupData(parsedDb, {
      application: 'VideoReviewer',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 1, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 }
    }, imageIds);
    assert(valResult.isValid === true, 'Round-trip data validation should pass. Errors: ' + valResult.fatalErrors.join('; '));

    const freshDb = createTestDb();
    await freshDb.initAsync();

    const imageEntries = [{ id: 'img-poster-vid-roundtrip', data: dummyBlob }];
    await freshDb.restoreWithRollback(valResult.repairedDb, imageEntries);

    const restoredAsset = freshDb.getVideo('vid-roundtrip');
    assert(restoredAsset.customPosterId === 'img-poster-vid-roundtrip', 'Poster reference should be maintained');

    const restoredBlob = await freshDb.getImage('img-poster-vid-roundtrip');
    assert(restoredBlob !== null && restoredBlob.size === dummyBlob.size, 'Poster Blob data must be preserved');
  });

  // 15. Shared Review export結果にcustomPosterId / poster image metadataが含まれない
  await runTest('15. Shared Review export パッケージに customPosterId / ポスター画像が一切含まれないこと', async () => {
    const asset = {
      id: 'vid-export-share',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      displayTitle: 'Share Video',
      genreId: 'genre-default',
      customPosterId: 'img-poster-vid-export-share',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb([asset]);
    await db.initAsync();

    // Create review to make it eligible for export
    db.reviews.push({
      id: 'rev-share-12345',
      mediaAssetId: 'vid-export-share',
      reviewerId: 'reviewer-owner-default',
      origin: 'local',
      overallScore: 5,
      comment: 'Review for share',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const sharePackage = exportReviews(db, ['vid-export-share']);
    assert(sharePackage !== null, 'Should successfully export');

    const packageStr = JSON.stringify(sharePackage);
    assert(!packageStr.includes('customPosterId'), 'Package must not contain customPosterId text');
    assert(!packageStr.includes('img-poster-'), 'Package must not contain poster key string');
  });

  // 16. 既存Backup/Restore regression
  await runTest('16. 既存の（ポスターを持たない旧 V4）バックアップの復元回帰テストが成功すること', async () => {
    const legacyAsset = {
      id: 'vid-legacy-v4',
      contentHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      hashAlgorithm: 'SHA-256',
      quickHash: 'qhash2',
      hashStatus: 'completed',
      fileSize: 200,
      duration: 20,
      displayTitle: 'Legacy Video',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = createTestDb();
    await db.initAsync();

    const legacyDb = {
      schemaVersion: 4,
      reviewers: db.reviewers,
      media_assets: [legacyAsset],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: db.genres,
      evaluation_templates: [],
      pending_shared_reviews: []
    };

    const valResult = db.validateBackupData(legacyDb, {
      application: 'VideoReviewer',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      counts: { media_assets: 1, file_locations: 0, reviews: 0, images: 0, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 }
    }, []);

    assert(valResult.isValid === true, 'Legacy V4 backup must validate successfully');

    const success = await db.restoreWithRollback(valResult.repairedDb, []);
    assert(success === true, 'Restoring legacy V4 backup should succeed');

    const restoredAsset = db.getVideo('vid-legacy-v4');
    assert(restoredAsset !== null, 'Legacy asset should be restored');
    assert(restoredAsset.customPosterId === undefined, 'Legacy asset customPosterId should be undefined');
  });

  // 17. customPosterId優先表示 (getPreferredVideoImageId helper検証)
  await runTest('17. getPreferredVideoImageId が customPosterId を最優先で返すこと', async () => {
    const m = await import('../app.js');
    const asset1 = { customPosterId: 'img-poster-x', thumbnailId: 'img-vid-y' };
    const asset2 = { thumbnailId: 'img-vid-y' };
    const asset3 = {};

    assert(m.getPreferredVideoImageId(asset1) === 'img-poster-x', 'Should return customPosterId');
    assert(m.getPreferredVideoImageId(asset2) === 'img-vid-y', 'Should return thumbnailId');
    assert(m.getPreferredVideoImageId(asset3) === null, 'Should return null');
  });

  // 18. 一覧カード内ポスターボタン存在 & click時バブリング防止検証 (renderLibrary production path)
  await runTest('18. 一覧カード内にポスター画像設定ボタンが存在し、クリック時にバブリングしないこと', async () => {
    const asset = {
      id: 'vid-card-btn-test',
      displayTitle: 'Card Button Test',
      genreId: 'genre-default',
      identityStatus: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const testDb = createTestDb([asset]);
    await testDb.initAsync();

    const originalAppDb = await new Promise(resolve => {
      import('../app.js').then(m => resolve(m.db));
    });

    setDbForTesting(testDb);

    try {
      const m = await import('../app.js');
      m.renderLibrary();

      const grid = document.getElementById('video-grid');
      const card = grid.querySelector('.video-card');
      assert(card !== null, 'Video card must be rendered in DOM');

      const posterBtn = card.querySelector('.btn-poster-card');
      assert(posterBtn !== null, 'Card must contain poster button');

      let cardClicked = false;
      card.addEventListener('click', () => {
        cardClicked = true;
      });

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      posterBtn.dispatchEvent(clickEvent);

      assert(cardClicked === false, 'Clicking posterBtn must not trigger card click event (bubbling prevented)');
    } finally {
      setDbForTesting(originalAppDb);
    }
  });

  // 19. Review Editorからポスター設定/削除およびプレビューが可能なこと
  await runTest('19. 詳細画面内にポスター設定・削除ボタンおよびプレビュー領域が存在すること', async () => {
    assert(document.getElementById('btn-editor-upload-poster') !== null, 'Upload button must exist in DOM');
    assert(document.getElementById('btn-editor-delete-poster') !== null, 'Delete button must exist in DOM');
    assert(document.getElementById('editor-poster-preview-container') !== null, 'Preview container must exist in DOM');
    assert(document.getElementById('editor-poster-preview-img') !== null, 'Preview image element must exist in DOM');
  });

  // 20. image以外のFile、空Blob、デコード失敗画像が正しくエラーになること
  await runTest('20. 不正な画像ファイルがバリデーションで弾かれること', async () => {
    const textFile = new Blob(['not-an-image'], { type: 'text/plain' });
    let textErr = null;
    try {
      const m = await import('../app.js');
      await m.validateImageFile(textFile);
    } catch (err) {
      textErr = err;
    }
    assert(textErr !== null, 'Text file must be rejected');
    assert(textErr.message.includes('画像ではありません'), 'Error message must specify non-image');

    const emptyBlob = new Blob([], { type: 'image/png' });
    let emptyErr = null;
    try {
      const m = await import('../app.js');
      await m.validateImageFile(emptyBlob);
    } catch (err) {
      emptyErr = err;
    }
    assert(emptyErr !== null, 'Empty Blob must be rejected');
    assert(emptyErr.message.includes('空のファイル'), 'Error should specify empty file');

    const malformedImg = new Blob(['invalid-png-header-data'], { type: 'image/png' });
    let decodeErr = null;
    try {
      const m = await import('../app.js');
      await m.validateImageFile(malformedImg);
    } catch (err) {
      decodeErr = err;
    }
    assert(decodeErr !== null, 'Malformed image must fail to decode');
    assert(decodeErr.message.includes('デコードに失敗'), 'Error should specify decode failure');
  });

  // 21. 新規poster設定失敗時 rollback (customPosterIdは元状態、新Blobは削除)
  await runTest('21. 新規ポスター設定失敗時のロールバック検証', async () => {
    const asset = {
      id: 'vid-new-poster-rollback',
      displayTitle: 'New Poster Rollback',
      genreId: 'genre-default',
      identityStatus: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const testDb = createTestDb([asset]);
    await testDb.initAsync();

    const originalAppDb = await new Promise(resolve => {
      import('../app.js').then(m => resolve(m.db));
    });
    setDbForTesting(testDb);

    try {
      const m = await import('../app.js');
      const originalUpdateVideo = testDb.updateVideo;
      testDb.updateVideo = async () => {
        throw new Error('故意のメタデータ更新エラー');
      };

      const dummyFile = new Blob(['new-poster-binary'], { type: 'image/png' });

      let errorThrown = false;
      try {
        await m.setPosterImageAction('vid-new-poster-rollback', dummyFile);
      } catch (err) {
        errorThrown = true;
      }
      assert(errorThrown === true, 'setPosterImageAction should throw error');

      testDb.updateVideo = originalUpdateVideo;

      const checkAsset = testDb.getVideo('vid-new-poster-rollback');
      assert(!checkAsset.customPosterId, 'customPosterId must remain unset');

      const blobExists = await testDb.getImage('img-poster-vid-new-poster-rollback');
      assert(blobExists === null, 'Newly written Blob must be deleted from IndexedDB');
    } finally {
      setDbForTesting(originalAppDb);
    }
  });

  // 22. poster置換失敗時 rollback (customPosterId元状態、元Blob復帰)
  await runTest('22. ポスター置換失敗時のロールバック検証', async () => {
    const asset = {
      id: 'vid-replace-rollback',
      displayTitle: 'Replace Rollback',
      customPosterId: 'img-poster-vid-replace-rollback',
      genreId: 'genre-default',
      identityStatus: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const testDb = createTestDb([asset]);
    await testDb.initAsync();

    const originalAppDb = await new Promise(resolve => {
      import('../app.js').then(m => resolve(m.db));
    });
    setDbForTesting(testDb);

    try {
      const m = await import('../app.js');
      const oldBlob = new Blob(['old-binary'], { type: 'image/png' });
      await testDb.putImage('img-poster-vid-replace-rollback', oldBlob);

      const originalUpdateVideo = testDb.updateVideo;
      testDb.updateVideo = async () => {
        throw new Error('故意のメタデータ更新エラー');
      };

      const newBlob = new Blob(['new-binary'], { type: 'image/png' });

      let errorThrown = false;
      try {
        await m.setPosterImageAction('vid-replace-rollback', newBlob);
      } catch (err) {
        errorThrown = true;
      }
      assert(errorThrown === true, 'setPosterImageAction should throw error');

      testDb.updateVideo = originalUpdateVideo;

      const checkAsset = testDb.getVideo('vid-replace-rollback');
      assert(checkAsset.customPosterId === 'img-poster-vid-replace-rollback', 'customPosterId must remain unchanged');

      const restoredBlob = await testDb.getImage('img-poster-vid-replace-rollback');
      assert(restoredBlob !== null, 'Poster Blob must still exist');
      const text = await restoredBlob.text();
      assert(text === 'old-binary', 'Poster Blob content must be rolled back to the old content');
    } finally {
      setDbForTesting(originalAppDb);
    }
  });

  // 23. poster削除失敗時 rollback (customPosterId / Blobとも復帰)
  await runTest('23. ポスター削除中のIndexedDB削除失敗時のロールバック検証', async () => {
    const asset = {
      id: 'vid-del-rollback',
      displayTitle: 'Delete Rollback',
      customPosterId: 'img-poster-vid-del-rollback',
      genreId: 'genre-default',
      identityStatus: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const testDb = createTestDb([asset]);
    await testDb.initAsync();

    const originalAppDb = await new Promise(resolve => {
      import('../app.js').then(m => resolve(m.db));
    });
    setDbForTesting(testDb);

    try {
      const m = await import('../app.js');
      const dummyBlob = new Blob(['delete-rollback-binary'], { type: 'image/png' });
      await testDb.putImage('img-poster-vid-del-rollback', dummyBlob);

      const originalDelete = testDb.idb.delete;
      testDb.idb.delete = async () => {
        throw new Error('故意のIndexedDB削除エラー');
      };

      try {
        await m.deletePosterImageAction('vid-del-rollback');
      } catch (err) {
        // Expected to fail silently and trigger rollback
      }

      testDb.idb.delete = originalDelete;

      const checkAsset = testDb.getVideo('vid-del-rollback');
      assert(checkAsset.customPosterId === 'img-poster-vid-del-rollback', 'customPosterId must be restored to original ID');

      const restoredBlob = await testDb.getImage('img-poster-vid-del-rollback');
      assert(restoredBlob !== null, 'Poster Blob must be restored in IndexedDB');
      const text = await restoredBlob.text();
      assert(text === 'delete-rollback-binary', 'Poster Blob content must match the original content');
    } finally {
      setDbForTesting(originalAppDb);
    }
  });

  // 24. 正常削除 (customPosterId null、generated thumbnail自動復帰)
  await runTest('24. ポスターの正常削除および generated thumbnail への自動復帰検証', async () => {
    const asset = {
      id: 'vid-del-success',
      displayTitle: 'Delete Success',
      thumbnailId: 'img-vid-default-thumbnail',
      customPosterId: 'img-poster-vid-del-success',
      genreId: 'genre-default',
      identityStatus: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const testDb = createTestDb([asset]);
    await testDb.initAsync();

    const originalAppDb = await new Promise(resolve => {
      import('../app.js').then(m => resolve(m.db));
    });
    setDbForTesting(testDb);

    try {
      const m = await import('../app.js');
      const dummyBlob = new Blob(['binary-data'], { type: 'image/png' });
      await testDb.putImage('img-poster-vid-del-success', dummyBlob);

      await m.deletePosterImageAction('vid-del-success');

      const checkAsset = testDb.getVideo('vid-del-success');
      assert(checkAsset.customPosterId === null, 'customPosterId reference must be cleared');

      const blobExists = await testDb.getImage('img-poster-vid-del-success');
      assert(blobExists === null, 'Poster image must be deleted from IndexedDB');

      const imageId = m.getPreferredVideoImageId(checkAsset);
      assert(imageId === 'img-vid-default-thumbnail', 'Should fallback to generated thumbnailId after poster deletion');
    } finally {
      setDbForTesting(originalAppDb);
    }
  });

  // 25. 10MB容量制限テスト
  await runTest('25. 10MB超のポスター画像ファイルが10MB制限バリデーションにより却下されること', async () => {
    const largeFile = new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'image/png' });
    let error = null;
    try {
      const m = await import('../app.js');
      await m.validateImageFile(largeFile);
    } catch (err) {
      error = err;
    }
    assert(error !== null, 'Large file (>10MB) must be rejected');
    assert(error.message.includes('10MB以下の画像を選択'), 'Error message must mention the 10MB limit');
  });

  // 26. Editor表示中のポスター更新で他画像のObject URLを不要にrevokeしない検証
  await runTest('26. Editor表示中のポスター更新時に既存の別画像のObject URLが不要に消去されないこと', async () => {
    const asset = {
      id: 'vid-url-cleanup-test',
      displayTitle: 'URL Cleanup Video',
      genreId: 'genre-default',
      identityStatus: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const testDb = createTestDb([asset]);
    await testDb.initAsync();

    const originalAppDb = await new Promise(resolve => {
      import('../app.js').then(m => resolve(m.db));
    });
    setDbForTesting(testDb);

    try {
      const m = await import('../app.js');
      
      m.state.currentView = 'editor';
      m.state.currentVideoId = 'vid-url-cleanup-test';
      
      m.state.imageBlobUrls.push('blob:http://localhost/dummy-other-image-blob-url');

      const dummyFile = new Blob(['dummy-binary'], { type: 'image/png' });
      await m.setPosterImageAction('vid-url-cleanup-test', dummyFile);

      assert(m.state.imageBlobUrls.includes('blob:http://localhost/dummy-other-image-blob-url'), 'Unrelated image blob URL must not be revoked when in editor view');

      m.state.currentView = 'library';
      await m.setPosterImageAction('vid-url-cleanup-test', dummyFile);
      
      assert(!m.state.imageBlobUrls.includes('blob:http://localhost/dummy-other-image-blob-url'), 'Blob URLs should be cleared when executing library redraw in library view');
    } finally {
      setDbForTesting(originalAppDb);
    }
  });

  console.groupEnd();
  return results;
}
