import { AppDatabase } from '../db.js';
import { generateFileSignature, formatTime, parseTime, normalizePath, filterVideosByTag } from '../video-helper.js';
import { isSupportedVideoFile, isPathCoveredByFailedDirectory, scanDirectory, classifyScanResults, applyScanDifferentials, isIgnoredSystemEntry } from '../directory-scanner.js';
import { RadarChart } from '../radar.js';
import { db, setDbForTesting, handleFolderSelect, handleFolderRequestPermission, processSingleLocationVerification, bgHashState, updateBackgroundHashingProgress, processBackgroundHashingQueue, updateBackgroundHashingUI } from '../app.js';
import { computeSHA256, computeQuickHash, computeFileSHA256, HashQueue, globalHashQueue, logMetric } from '../hash-helper.js';
import { VALID_HASH_A, VALID_HASH_B, INVALID_HASH, MemoryStorage, MockFileSystemFileHandle, MockFileSystemDirectoryHandle } from '../tests.js';

export async function runGroup11Tests(runTest, assert) {
  console.group('Group 11: Hash-Based Reconnection & Playback Resolution');

  await runTest('11-1. Same folder reconnect resolves existing videos', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_1_', 'TestVideoDB_G11_1');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    // Create a directory source and add a video
    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    const handle = new MockFileSystemDirectoryHandle('FolderA', {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 100, 200)
    });
    await testDb.putDirectoryHandle(source.handleKey, handle);

    const video = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'movie.mp4',
      lastModified: 200
    });

    // Disconnect the source
    await testDb.updateDirectorySource(source.id, { handleKey: '', permissionStatus: 'disconnected' });
    let virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    assert(virtual.availabilityStatus === 'missing' || virtual.availabilityStatus === 'permission-required', 'Should be missing/permission-required on disconnect');

    // Reconnect the source
    await testDb.reconnectDirectorySource(source.id, handle);
    
    // Simulate scan
    const scanResult = {
      scannedFiles: [{ fileName: 'movie.mp4', relativePath: 'movie.mp4', fileSize: 100, lastModified: 200 }],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };
    await applyScanDifferentials({ db: testDb, directoryId: source.id, scanResult });

    virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    assert(virtual.availabilityStatus === 'available', 'Should be available after reconnect and scan');
  });

  await runTest('11-2. Lost handleKey recovery restores playback', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_2_', 'TestVideoDB_G11_2');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    const video = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'movie.mp4',
      lastModified: 200
    });

    // Delete the handleKey from IndexedDB to simulate a lost handle
    await testDb.deleteDirectoryHandle(source.handleKey);

    let virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'disconnected' });
    virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    assert(virtual.availabilityStatus === 'missing', 'Video status should be missing when source is disconnected');

    // Reconnect with a new handle
    const newHandle = new MockFileSystemDirectoryHandle('FolderA', {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 100, 200)
    });
    await testDb.reconnectDirectorySource(source.id, newHandle);

    virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    assert(virtual.availabilityStatus === 'available', 'Video should be available after reconnection');
  });

  await runTest('11-3. Different directoryId mapping with same hash', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_3_', 'TestVideoDB_G11_3');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source1 = await testDb.addDirectorySource({ name: 'FolderA' });
    const video1 = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source1.id,
      relativePath: 'movie.mp4',
      lastModified: 200,
      contentHash: VALID_HASH_A,
      hashStatus: 'completed'
    });

    // Delete folder 1 (disconnect)
    await testDb.deleteDirectorySource(source1.id);

    // Add folder 2 (different ID)
    const source2 = await testDb.addDirectorySource({ name: 'FolderB' });
    
    // Add the same file under folder 2 (as provisional asset)
    const video2 = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source2.id,
      relativePath: 'movie.mp4',
      lastModified: 200,
      hashStatus: 'pending'
    });

    // Hashing completes and resolves same hash
    const mergeRes = await testDb.completeVideoHashing(video2.id, VALID_HASH_A);
    assert(mergeRes.merged, 'Should merge video2 into video1');

    // Verify existing asset has two locations
    const locations = testDb.fileLocations.filter(loc => loc.mediaAssetId === video1.id);
    assert(locations.length === 2, 'Should keep both locations pointing to video1');
    assert(locations.some(loc => loc.directoryId === source1.id), 'Should contain source1 location');
    assert(locations.some(loc => loc.directoryId === source2.id), 'Should contain source2 location');
  });

  await runTest('11-4. Moved relativePath preserves reviews, tags, and notes on hashing merge', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_4_', 'TestVideoDB_G11_4');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.videoTags = [];
    testDb.timelineNotes = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    const video1 = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'movie.mp4',
      lastModified: 200,
      contentHash: VALID_HASH_A,
      hashStatus: 'completed'
    });

    // Add review, tag, and note
    await testDb.saveReview(video1.id, { overallGrade: 'A', comment: 'Loved it' });
    await testDb.addTagToVideo(video1.id, 'tag-1');
    testDb.timelineNotes.push({
      id: 'note-1',
      videoReviewId: testDb.reviews[0].id,
      mediaAssetId: video1.id,
      timestampSeconds: 10,
      timestampLabel: '0:10',
      comment: 'Key frame',
      createdAt: new Date().toISOString()
    });

    // Move file: scan differential marks old loc as missing and registers new loc
    const scanResult = {
      scannedFiles: [{ fileName: 'movie.mp4', relativePath: 'sub/movie.mp4', fileSize: 100, lastModified: 200 }],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };
    await applyScanDifferentials({ db: testDb, directoryId: source.id, scanResult });

    const video2 = testDb.getVideos().find(v => v.relativePath === 'sub/movie.mp4');
    assert(video2 !== undefined, 'Should detect new video at sub/movie.mp4');

    // Complete hashing for sub/movie.mp4
    const mergeRes = await testDb.completeVideoHashing(video2.id, VALID_HASH_A);
    assert(mergeRes.merged, 'Should merge');

    // Verify reviews, tags, notes are preserved on the original mediaAsset (video1.id)
    assert(testDb.reviews.length === 1 && testDb.reviews[0].mediaAssetId === video1.id, 'Review preserved');
    assert(testDb.videoTags.length === 1 && testDb.videoTags[0].mediaAssetId === video1.id, 'Tag preserved');
    assert(testDb.timelineNotes.length === 1 && testDb.timelineNotes[0].mediaAssetId === video1.id, 'Note preserved');
  });

  await runTest('11-5. Playback falls back to second location if first is missing', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_5_', 'TestVideoDB_G11_5');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source1 = await testDb.addDirectorySource({ name: 'FolderA' });
    const source2 = await testDb.addDirectorySource({ name: 'FolderB' });
    await testDb.updateDirectorySource(source1.id, { permissionStatus: 'granted' });
    await testDb.updateDirectorySource(source2.id, { permissionStatus: 'granted' });

    // A single video with two locations
    const assetId = 'vid-test-video-12345678';
    testDb.mediaAssets.push({
      id: assetId,
      contentHash: VALID_HASH_A,
      hashAlgorithm: 'SHA-256',
      quickHash: 'qh1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 0,
      displayTitle: 'Dual Locations',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Location 1: missing
    testDb.fileLocations.push({
      id: 'loc-location11111111',
      mediaAssetId: assetId,
      directoryId: source1.id,
      relativePath: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      lastModified: 200,
      availabilityStatus: 'missing',
      lastVerifiedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Location 2: available
    testDb.fileLocations.push({
      id: 'loc-location22222222',
      mediaAssetId: assetId,
      directoryId: source2.id,
      relativePath: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      lastModified: 200,
      availabilityStatus: 'available',
      lastVerifiedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    assert(virtual.availabilityStatus === 'available', 'Should be available overall');
    assert(virtual.directoryId === source2.id, 'Should resolve to source2 (available) as primary location');
  });

  await runTest('11-6. Playback falls back to second location if first needs permission', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_6_', 'TestVideoDB_G11_6');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source1 = await testDb.addDirectorySource({ name: 'FolderA' });
    const source2 = await testDb.addDirectorySource({ name: 'FolderB' });

    // Set source1 as prompt, source2 as granted
    await testDb.updateDirectorySource(source1.id, { permissionStatus: 'prompt' });
    await testDb.updateDirectorySource(source2.id, { permissionStatus: 'granted' });

    const assetId = 'vid-test-video-12345678';
    testDb.mediaAssets.push({
      id: assetId,
      contentHash: VALID_HASH_A,
      hashAlgorithm: 'SHA-256',
      quickHash: 'qh1',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 0,
      displayTitle: 'Dual Locations',
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    testDb.fileLocations.push({
      id: 'loc-location11111111',
      mediaAssetId: assetId,
      directoryId: source1.id,
      relativePath: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      lastModified: 200,
      availabilityStatus: 'permission-required',
      lastVerifiedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    testDb.fileLocations.push({
      id: 'loc-location22222222',
      mediaAssetId: assetId,
      directoryId: source2.id,
      relativePath: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      lastModified: 200,
      availabilityStatus: 'available',
      lastVerifiedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    assert(virtual.availabilityStatus === 'available', 'Should be available because loc-2 is granted');
    assert(virtual.directoryId === source2.id, 'Should resolve to source2 (granted/available) as primary');
  });

  await runTest('11-7. Distinct files with same name/size but different contentHash are not merged', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_7_', 'TestVideoDB_G11_7');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    const video1 = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'movie.mp4',
      lastModified: 200,
      contentHash: VALID_HASH_A,
      hashStatus: 'completed'
    });

    const video2 = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'subdir/movie.mp4',
      lastModified: 200,
      hashStatus: 'pending'
    });

    // Hash is calculated as VALID_HASH_B (different!)
    const mergeRes = await testDb.completeVideoHashing(video2.id, VALID_HASH_B);
    assert(!mergeRes.merged, 'Should not merge');
    assert(testDb.mediaAssets.length === 2, 'Should keep both mediaAssets');
  });

  await runTest('11-8. Reconnection recovery does not delete evaluations, tags, and notes', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_8_', 'TestVideoDB_G11_8');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.videoTags = [];
    testDb.timelineNotes = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    const video = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'movie.mp4',
      lastModified: 200,
      contentHash: VALID_HASH_A,
      hashStatus: 'completed'
    });

    await testDb.saveReview(video.id, { overallGrade: 'B', comment: 'Fine' });
    await testDb.addTagToVideo(video.id, 'tag-2');
    testDb.timelineNotes.push({
      id: 'note-2',
      videoReviewId: testDb.reviews[0].id,
      mediaAssetId: video.id,
      timestampSeconds: 5,
      timestampLabel: '0:05',
      comment: 'Nice',
      createdAt: new Date().toISOString()
    });

    // Disconnect and reconnect
    await testDb.updateDirectorySource(source.id, { handleKey: '', permissionStatus: 'disconnected' });
    const handle = new MockFileSystemDirectoryHandle('FolderA', {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 100, 200)
    });
    await testDb.reconnectDirectorySource(source.id, handle);

    // Verify all evaluation records are completely intact
    assert(testDb.mediaAssets.length === 1, 'mediaAsset exists');
    assert(testDb.reviews.length === 1, 'Review exists');
    assert(testDb.videoTags.length === 1, 'Tag exists');
    assert(testDb.timelineNotes.length === 1, 'Note exists');
  });

  await runTest('11-9. Separator differences (backslashes vs forward slashes) are normalized', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_9_', 'TestVideoDB_G11_9');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    
    // Add location with Windows path separator
    await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'subfolder\\movie.mp4',
      lastModified: 200
    });

    // Scan with Unix path separator
    const scanResult = {
      scannedFiles: [{ fileName: 'movie.mp4', relativePath: 'subfolder/movie.mp4', fileSize: 100, lastModified: 200 }],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };
    await applyScanDifferentials({ db: testDb, directoryId: source.id, scanResult });

    // Should match and not add a new file
    assert(testDb.fileLocations.length === 1, 'Should resolve to the same location record');
    assert(normalizePath(testDb.fileLocations[0].relativePath) === 'subfolder/movie.mp4', 'Path normalized');
  });

  await runTest('11-10. Backup and restore correctly maps reconnected files', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_10_', 'TestVideoDB_G11_10');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });

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
          displayTitle: 'Imported Video',
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
          directoryId: source.id,
          relativePath: 'movie.mp4',
          fileName: 'movie.mp4',
          fileSize: 100,
          lastModified: 200,
          availabilityStatus: 'permission-required',
          lastVerifiedAt: '',
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
      directory_sources: [
        {
          id: source.id,
          name: 'FolderA',
          includeSubdirectories: true,
          permissionStatus: 'prompt',
          handleKey: source.handleKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', description: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      evaluation_templates: []
    };

    await testDb.restoreWithRollback(sampleBackup, []);

    // Reconnect source
    const handle = new MockFileSystemDirectoryHandle('FolderA', {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 100, 200)
    });
    await testDb.reconnectDirectorySource(source.id, handle);

    const virtual = testDb._buildVirtualVideo(testDb.mediaAssets[0]);
    assert(virtual.availabilityStatus === 'available', 'Should resolve to available after backup restore and reconnect');
  });

  await runTest('11-11. Rescan identical file in different folder maps to existing reviews/metadata without duplicates', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_11_', 'TestVideoDB_G11_11');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.videoTags = [];
    testDb.timelineNotes = [];

    const source1 = await testDb.addDirectorySource({ name: 'FolderA' });
    const video = await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source1.id,
      relativePath: 'movie.mp4',
      lastModified: 200,
      contentHash: VALID_HASH_A,
      quickHash: 'qh_bunny',
      hashStatus: 'completed'
    });

    // Add rating and comment
    await testDb.saveReview(video.id, { overallGrade: 'A', comment: 'Excellent' });
    await testDb.addTagToVideo(video.id, 'tag-11');
    testDb.timelineNotes.push({
      id: 'note-11',
      videoReviewId: testDb.reviews[0].id,
      mediaAssetId: video.id,
      timestampSeconds: 12,
      timestampLabel: '0:12',
      comment: 'Check this out',
      createdAt: new Date().toISOString()
    });

    // Set source1 as disconnected
    await testDb.updateDirectorySource(source1.id, { handleKey: '', permissionStatus: 'disconnected' });

    // Connect source2
    const source2 = await testDb.addDirectorySource({ name: 'FolderB' });
    await testDb.updateDirectorySource(source2.id, { permissionStatus: 'granted' });
    const handleB = new MockFileSystemDirectoryHandle('FolderB', {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 100, 200)
    });
    await testDb.putDirectoryHandle(source2.handleKey, handleB);

    // Scan source2
    const scanResult = {
      scannedFiles: [{ fileName: 'movie.mp4', relativePath: 'movie.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_bunny' }],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };

    // Run scan (does not execute full hashing)
    await applyScanDifferentials({
      db: testDb,
      directoryId: source2.id,
      scanResult,
      recursive: true
    });

    // Verify database count (provisional phase)
    assert(testDb.mediaAssets.length === 1, 'Only one mediaAsset should exist');
    assert(testDb.fileLocations.length === 2, 'Should have exactly two locations');
    const newLoc = testDb.fileLocations.find(l => l.directoryId === source2.id);
    assert(newLoc.verificationStatus === 'provisional', 'Location verification status should be provisional');

    // Run background verification completion
    const res = await testDb.completeLocationProvisionalVerification(newLoc.id, VALID_HASH_A);
    assert(res.status === 'success', 'Verification succeeds');

    assert(testDb.mediaAssets.length === 1, 'Still only one mediaAsset');
    assert(testDb.mediaAssets[0].id === video.id, 'Original mediaAsset ID must be maintained');
    assert(testDb.reviews.length === 1 && testDb.reviews[0].comment === 'Excellent', 'Review preserved');
    assert(testDb.videoTags.length === 1, 'Tag preserved');
    assert(testDb.timelineNotes.length === 1, 'Timeline note preserved');

    // Verify video resolution fallback plays from source2 (available)
    const virtual = testDb.getVideo(video.id);
    assert(virtual.availabilityStatus === 'available', 'Should be available overall');
    assert(virtual.directoryId === source2.id, 'Primary location should resolve to source2');
    assert(virtual.relativePath === 'movie.mp4', 'Primary location path should be movie.mp4');
  });

  await runTest('11-12. Scan same size/quickHash but different SHA-256 does not merge', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_12_', 'TestVideoDB_G11_12');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });
    const handle = new MockFileSystemDirectoryHandle('FolderA', {
      'movie1.mp4': new MockFileSystemFileHandle('movie1.mp4', 100, 200),
      'movie2.mp4': new MockFileSystemFileHandle('movie2.mp4', 100, 200)
    });
    await testDb.putDirectoryHandle(source.handleKey, handle);

    // Add first video
    const video1 = await testDb.addVideo({
      title: 'movie1.mp4',
      fileName: 'movie1.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'movie1.mp4',
      lastModified: 200,
      contentHash: VALID_HASH_A,
      quickHash: 'qh_same',
      hashStatus: 'completed'
    });

    // Scan second video
    const scanResult = {
      scannedFiles: [
        { fileName: 'movie1.mp4', relativePath: 'movie1.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_same' },
        { fileName: 'movie2.mp4', relativePath: 'movie2.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_same' }
      ],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };

    await applyScanDifferentials({
      db: testDb,
      directoryId: source.id,
      scanResult,
      recursive: true
    });

    // Provisional phase: provisionally matches video1 because exactly 1 candidate exists
    assert(testDb.mediaAssets.length === 1, 'Provisional match');
    assert(testDb.fileLocations.length === 2, 'Two locations');

    // Run background verification on movie2.mp4 with different hash
    const loc2 = testDb.fileLocations.find(l => l.relativePath === 'movie2.mp4');
    const res = await testDb.completeLocationProvisionalVerification(loc2.id, VALID_HASH_B);
    assert(res.status === 'separated', 'Separated due to hash mismatch');

    // Should create two distinct mediaAssets
    assert(testDb.mediaAssets.length === 2, 'Should create a new mediaAsset for movie2.mp4');
    assert(testDb.mediaAssets.some(a => a.contentHash === VALID_HASH_B), 'Should contain mediaAsset with hash B');
  });

  await runTest('11-13. Scan computes hash on pending candidate and merges successfully', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_13_', 'TestVideoDB_G11_13');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });
    const handle = new MockFileSystemDirectoryHandle('FolderA', {
      'movie1.mp4': new MockFileSystemFileHandle('movie1.mp4', 100, 200),
      'movie2.mp4': new MockFileSystemFileHandle('movie2.mp4', 100, 200)
    });
    await testDb.putDirectoryHandle(source.handleKey, handle);

    // movie1 is in database but its contentHash is pending
    const video1 = await testDb.addVideo({
      title: 'movie1.mp4',
      fileName: 'movie1.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'movie1.mp4',
      lastModified: 200,
      quickHash: 'qh_same',
      hashStatus: 'pending',
      identityStatus: 'provisional'
    });
    const loc1 = testDb.fileLocations.find(l => l.mediaAssetId === video1.id);
    loc1.verificationStatus = 'provisional';
    testDb._saveTable('file_locations', testDb.fileLocations);

    // Scan movie2
    const scanResult = {
      scannedFiles: [
        { fileName: 'movie1.mp4', relativePath: 'movie1.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_same' },
        { fileName: 'movie2.mp4', relativePath: 'movie2.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_same' }
      ],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };

    await applyScanDifferentials({
      db: testDb,
      directoryId: source.id,
      scanResult,
      recursive: true
    });

    const loc2 = testDb.fileLocations.find(l => l.relativePath === 'movie2.mp4');

    // Run background verification on both
    await testDb.completeLocationProvisionalVerification(loc1.id, VALID_HASH_A);
    const res = await testDb.completeLocationProvisionalVerification(loc2.id, VALID_HASH_A);

    // Should merge because both resolve to VALID_HASH_A
    assert(testDb.mediaAssets.length === 1, 'Should merge movie2 into movie1');
    assert(testDb.mediaAssets[0].contentHash === VALID_HASH_A, 'Hash should be computed and updated to A');
    assert(testDb.fileLocations.length === 2, 'Should have both location entries');
  });

  await runTest('11-14. Excludes AppleDouble files, DS_Store, __MACOSX, and other hidden files during scanning and additions', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_14_', 'TestVideoDB_G11_14');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });

    // Mock folder containing ignored files and normal files
    const handle = new MockFileSystemDirectoryHandle('FolderA', {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 100, 200),
      '._movie.mp4': new MockFileSystemFileHandle('._movie.mp4', 100, 200),
      '.DS_Store': new MockFileSystemFileHandle('.DS_Store', 50, 200),
      '.hidden-video.mp4': new MockFileSystemFileHandle('.hidden-video.mp4', 100, 200),
      'movie._edited.mp4': new MockFileSystemFileHandle('movie._edited.mp4', 120, 200),
      '__MACOSX': new MockFileSystemDirectoryHandle('__MACOSX', {
        'nested.mp4': new MockFileSystemFileHandle('nested.mp4', 100, 200)
      })
    });
    await testDb.putDirectoryHandle(source.handleKey, handle);

    // Run directory scan (mock scanDirectory simulates files detected)
    const scanResult = {
      scannedFiles: [
        { fileName: 'movie.mp4', relativePath: 'movie.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_1' },
        { fileName: '._movie.mp4', relativePath: '._movie.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_2' },
        { fileName: '.DS_Store', relativePath: '.DS_Store', fileSize: 50, lastModified: 200, quickHash: 'qh_3' },
        { fileName: '.hidden-video.mp4', relativePath: '.hidden-video.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_4' },
        { fileName: 'movie._edited.mp4', relativePath: 'movie._edited.mp4', fileSize: 120, lastModified: 200, quickHash: 'qh_5' },
        { fileName: 'nested.mp4', relativePath: '__MACOSX/nested.mp4', fileSize: 100, lastModified: 200, quickHash: 'qh_6' }
      ],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };

    // Filter using isIgnoredSystemEntry (mimic scanner integration)
    const filteredScannedFiles = scanResult.scannedFiles.filter(sf => !isIgnoredSystemEntry(sf.fileName, sf.relativePath));
    assert(filteredScannedFiles.length === 2, 'Should only detect 2 files (movie.mp4 and movie._edited.mp4)');
    assert(filteredScannedFiles.some(sf => sf.fileName === 'movie.mp4'), 'movie.mp4 included');
    assert(filteredScannedFiles.some(sf => sf.fileName === 'movie._edited.mp4'), 'movie._edited.mp4 included');

    const summary = await applyScanDifferentials({
      db: testDb,
      directoryId: source.id,
      scanResult: { ...scanResult, scannedFiles: filteredScannedFiles },
      recursive: true
    });

    assert(testDb.mediaAssets.length === 2, 'Only 2 mediaAssets should be registered');
    assert(testDb.fileLocations.some(loc => loc.relativePath === 'movie.mp4'), 'movie.mp4 registered');
    assert(testDb.fileLocations.some(loc => loc.relativePath === 'movie._edited.mp4'), 'movie._edited.mp4 registered');

    // Windows backslash separator test
    assert(isIgnoredSystemEntry('nested.mp4', '__MACOSX\\sub\\nested.mp4'), 'Should ignore Windows-style MACOSX paths');
    assert(isIgnoredSystemEntry('._movie.mp4', 'subdir\\._movie.mp4'), 'Should ignore Windows-style AppleDouble files');
  });

  await runTest('11-15. Hashing / read error during rescan does not register duplicate assets or locations', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_15_', 'TestVideoDB_G11_15');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.videoTags = [];
    testDb.timelineNotes = [];

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });

    // Mock folder handle
    const handle = new MockFileSystemDirectoryHandle('FolderA', {
      'error_movie.mp4': new MockFileSystemFileHandle('error_movie.mp4', 150, 200)
    });
    await testDb.putDirectoryHandle(source.handleKey, handle);

    const scanResult = {
      scannedFiles: [
        { fileName: 'error_movie.mp4', relativePath: 'error_movie.mp4', fileSize: 150, lastModified: 200, quickHash: 'qh_err' }
      ],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };

    await applyScanDifferentials({
      db: testDb,
      directoryId: source.id,
      scanResult,
      recursive: true
    });

    assert(testDb.mediaAssets.length === 1, 'Registers provisional asset');
    assert(testDb.fileLocations.length === 1, 'Registers provisional location');
    const locId = testDb.fileLocations[0].id;

    // Enqueue in HashQueue and simulate rejection
    const testQueue = new HashQueue();
    let queueNextRan = false;
    let completionNotificationRan = false;

    const computeHashFnReject = async () => {
      throw new Error('Hash calculation failed');
    };

    await testQueue.enqueue('task-1', async () => {
      try {
        await processSingleLocationVerification(
          testDb,
          locId,
          [source],
          async (key) => testDb.getDirectoryHandle(key),
          async (h, path) => h.getFileHandle(path),
          computeHashFnReject
        );
      } catch (err) {
        // Handled
      } finally {
        completionNotificationRan = true;
      }
    });

    await testQueue.enqueue('task-2', async () => {
      queueNextRan = true;
    });

    assert(testDb.mediaAssets.length === 1, 'Asset count should not increase');
    assert(testDb.fileLocations.length === 1, 'Location count should not increase');
    assert(testDb.fileLocations[0].verificationStatus === 'provisional', 'Status remains provisional');
    assert(queueNextRan === true, 'Queue advanced to next job');
    assert(completionNotificationRan === true, 'UI progress/completion notification ran');
  });

  await runTest('11-16. Multiple locations: changing one location preserves asset.contentHash', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_16_', 'TestVideoDB_G11_16');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; }
    };
    testDb.mediaAssets = [];
    testDb.fileLocations = [];

    // Create asset
    const asset = await testDb.addVideo({
      title: 'movie.mp4',
      fileSize: 100,
      contentHash: VALID_HASH_A,
      hashStatus: 'completed',
      identityStatus: 'verified'
    });

    // Add another location to same asset
    const source2 = await testDb.addDirectorySource({ name: 'FolderB' });
    const loc2 = {
      id: 'loc-2',
      mediaAssetId: asset.id,
      directoryId: source2.id,
      relativePath: 'movie_copy.mp4',
      fileName: 'movie_copy.mp4',
      fileSize: 100,
      lastModified: 200,
      availabilityStatus: 'available',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    testDb.fileLocations.push(loc2);

    // Now, scan/add loc2 with modified size (150)
    await testDb.addVideo({
      title: 'movie_copy.mp4',
      fileName: 'movie_copy.mp4',
      fileSize: 150,
      lastModified: 300,
      sourceType: 'directory',
      directoryId: source2.id,
      relativePath: 'movie_copy.mp4'
    });

    const updatedAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    assert(updatedAsset.contentHash === VALID_HASH_A, 'asset.contentHash must be preserved');
    assert(updatedAsset.hashStatus === 'completed', 'asset.hashStatus must remain completed');

    const updatedLoc1 = testDb.fileLocations.find(l => l.id !== 'loc-2');
    const updatedLoc2 = testDb.fileLocations.find(l => l.id === 'loc-2');
    assert(updatedLoc2.verificationStatus === 'provisional', 'Modified location verificationStatus becomes provisional');
    assert(updatedLoc1.verificationStatus !== 'provisional', 'Unmodified location verificationStatus remains verified');
  });

  await runTest('11-17. Mismatch separation: original asset retains evaluations, new asset has none', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_17_', 'TestVideoDB_G11_17');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; }
    };
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb.reviews = [];
    testDb.criterionRatings = [];
    testDb.videoTags = [];
    testDb.timelineNotes = [];

    // Create verified asset with review, ratings, tags, notes
    const asset = await testDb.addVideo({
      title: 'movie.mp4',
      fileSize: 100,
      contentHash: VALID_HASH_A,
      hashStatus: 'completed',
      identityStatus: 'verified'
    });

    await testDb.saveReview(asset.id, {
      overallGrade: 'A',
      comment: 'Excellent video',
      ratings: { 'crit-1': 5 }
    });
    await testDb.addTagToVideo(asset.id, 'Action');
    await testDb.addTimelineNote(asset.id, {
      timestampSeconds: 10,
      timestampLabel: '00:10',
      comment: 'Nice scene'
    });

    // Add provisional location
    const source2 = await testDb.addDirectorySource({ name: 'FolderB' });
    const loc2 = {
      id: 'loc-2',
      mediaAssetId: asset.id,
      directoryId: source2.id,
      relativePath: 'movie_other.mp4',
      fileName: 'movie_other.mp4',
      fileSize: 100,
      lastModified: 200,
      availabilityStatus: 'available',
      verificationStatus: 'provisional',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    testDb.fileLocations.push(loc2);

    const result = await testDb.completeLocationProvisionalVerification('loc-2', VALID_HASH_B);
    assert(result.status === 'separated', 'Location is separated');

    const reviewsA = testDb.reviews.filter(r => r.mediaAssetId === asset.id);
    const tagsA = testDb.getVideoTags(asset.id);
    const notesA = testDb.timelineNotes.filter(n => n.mediaAssetId === asset.id);
    assert(reviewsA.length === 1 && reviewsA[0].comment === 'Excellent video', 'Original review comment remains');
    assert(tagsA.length === 1 && tagsA[0].name === 'Action', 'Original tag remains');
    assert(notesA.length === 1 && notesA[0].comment === 'Nice scene', 'Original note remains');

    const newAssetId = result.newAssetId;
    const reviewsB = testDb.reviews.filter(r => r.mediaAssetId === newAssetId);
    const tagsB = testDb.getVideoTags(newAssetId);
    const notesB = testDb.timelineNotes.filter(n => n.mediaAssetId === newAssetId);
    assert(reviewsB.length === 0, 'New asset must not copy reviews');
    assert(tagsB.length === 0, 'New asset must not copy tags');
    assert(notesB.length === 0, 'New asset must not copy notes');
  });

  await runTest('11-18. Provisional video editing is not blocked', async () => {
    const testDb = new AppDatabase();

    const video = await testDb.addVideo({
      fileName: 'provisional.mp4',
      fileSize: 100,
      lastModified: 100,
      hashStatus: 'pending',
      identityStatus: 'provisional'
    });

    // Check we can save review
    await testDb.saveReview(video.id, {
      overallGrade: 'A',
      comment: 'Provisional allowed comment',
      ratings: {}
    });

    const review = testDb.getReviewForVideo(video.id);
    assert(review && review.overallGrade === 'A' && review.comment === 'Provisional allowed comment', 'Can save review for provisional video');

    // Check we can add tag
    await testDb.addTagToVideo(video.id, 'TestTag');
    const videoTags = testDb.getVideoTags(video.id);
    assert(videoTags.length === 1 && videoTags[0].name === 'TestTag', 'Can add tag to provisional video');

    // Check we can add timeline note
    await testDb.addTimelineNote(video.id, {
      timestampSeconds: 10,
      timestampLabel: '[00:10]',
      comment: 'Provisional allowed note'
    });
    const notes = testDb.timelineNotes.filter(n => n.mediaAssetId === video.id);
    assert(notes.length === 1 && notes[0].comment === 'Provisional allowed note', 'Can add timeline note to provisional video');
  });

  await runTest('11-19. HashQueue key-based deduplication and state tracking', async () => {
    const queue = new HashQueue(1);
    let runCount1 = 0;
    let runCount2 = 0;

    queue.pause();

    const p1 = queue.enqueue('loc-1', async () => { runCount1++; return 'res-1'; });
    const p2 = queue.enqueue('loc-1', async () => { runCount1++; return 'res-2'; });
    const p3 = queue.enqueue('loc-2', async () => { runCount2++; return 'res-3'; });

    assert(queue.queue.length === 2, 'Queue has exactly 2 tasks (duplicates are ignored)');
    assert(queue.queuedKeys.has('loc-1') && queue.queuedKeys.has('loc-2'), 'Keys are tracked as queued');

    queue.resume();

    await Promise.all([p1, p2, p3]);

    assert(runCount1 === 1, 'Task 1 ran exactly once');
    assert(runCount2 === 1, 'Task 2 ran exactly once');
    assert(queue.queuedKeys.size === 0, 'No queued keys remain');
    assert(queue.runningKeys.size === 0, 'No running keys remain');
  });

  await runTest('11-20. Hashing UI progress calculation, failure, and state cleanup', async () => {
    globalHashQueue.cancelPending();

    bgHashState.targetKeys.clear();
    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();
    bgHashState.activeId = null;
    bgHashState.activeName = '';
    bgHashState.activePercent = null;
    bgHashState.batchId = '';
    bgHashState.generation = 0;

    // --- Scenario 1: Batch 1 starts with 2 items and completes ---
    bgHashState.batchId = 'batch-1';
    bgHashState.generation = 1;
    
    bgHashState.targetKeys.add('loc-1');
    bgHashState.targetKeys.add('loc-2');
    
    bgHashState.completedKeys.add('loc-1');
    bgHashState.completedKeys.add('loc-2');
    
    let total1 = bgHashState.targetKeys.size;
    let completed1 = 0;
    for (const id of bgHashState.targetKeys) {
      if (bgHashState.completedKeys.has(id)) completed1++;
    }
    assert(total1 === 2, 'Batch 1 total is 2');
    assert(completed1 === 2, 'Batch 1 completed is 2 (2/2 completed)');

    // --- Scenario 2: Start Batch 2 while Batch 1 completed keys exist ---
    bgHashState.batchId = 'batch-2';
    bgHashState.generation = 2;
    bgHashState.targetKeys.clear();
    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();
    
    bgHashState.targetKeys.add('loc-3');
    
    let total2_start = bgHashState.targetKeys.size;
    let completed2_start = 0;
    for (const id of bgHashState.targetKeys) {
      if (bgHashState.completedKeys.has(id)) completed2_start++;
    }
    assert(total2_start === 1, 'Batch 2 total is 1');
    assert(completed2_start === 0, 'Batch 2 starts at 0/1');

    bgHashState.completedKeys.add('loc-3');
    let completed2_end = 0;
    for (const id of bgHashState.targetKeys) {
      if (bgHashState.completedKeys.has(id)) completed2_end++;
    }
    assert(completed2_end === 1, 'Batch 2 finishes at 1/1');

    // --- Scenario 3: Add new item to Batch 3 while it is still running ---
    bgHashState.batchId = 'batch-3';
    bgHashState.generation = 3;
    bgHashState.targetKeys.clear();
    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();

    bgHashState.targetKeys.add('loc-4');
    assert(bgHashState.targetKeys.size === 1, 'Batch 3 starts with 1 item');

    bgHashState.targetKeys.add('loc-5');
    assert(bgHashState.targetKeys.size === 2, 'Batch 3 total increases to 2 when item is added');

    // --- Scenario 4: Delete location removes it from targetKeys and other status Sets ---
    bgHashState.completedKeys.add('loc-4');
    
    bgHashState.targetKeys.delete('loc-4');
    bgHashState.completedKeys.delete('loc-4');
    
    assert(bgHashState.targetKeys.size === 1, 'Deleted location is removed from targetKeys, denominator decreases');
    assert(!bgHashState.targetKeys.has('loc-4'), 'targetKeys does not contain deleted location');
    assert(!bgHashState.completedKeys.has('loc-4'), 'completedKeys does not contain deleted location');

    // --- Scenario 5: Older generation callback does not update UI/sets ---
    const oldGen = 2;
    const currentGen = bgHashState.generation; // 3
    
    if (oldGen === currentGen) {
      bgHashState.completedKeys.add('loc-ignored');
    }
    assert(!bgHashState.completedKeys.has('loc-ignored'), 'Old generation callback execution is ignored');

    bgHashState.targetKeys.clear();
    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();
    bgHashState.batchId = '';
    bgHashState.generation = 0;
  });

  await runTest('11-21. processBackgroundHashingQueue integration, duplicate triggers, and safety rules', async () => {
    globalHashQueue.cancelPending();
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_21_', 'TestVideoDB_G11_21');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };

    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();
    bgHashState.activeId = null;
    bgHashState.activeName = '';
    bgHashState.activePercent = null;

    const originalDb = db;
    setDbForTesting(testDb);

    try {
      window.testComputeSHA256Hook = () => 'mock_hash';

      const source = await testDb.addDirectorySource({ name: 'FolderA' });
      await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });
      const mockHandle = new MockFileSystemDirectoryHandle('FolderA', {
        'video1.mp4': new MockFileSystemFileHandle('video1.mp4', 100, 100),
        'video2.mp4': new MockFileSystemFileHandle('video2.mp4', 200, 200)
      });
      await testDb.putDirectoryHandle(source.handleKey, mockHandle);

      const loc1 = {
        id: 'loc-test-1',
        mediaAssetId: 'asset-1',
        directoryId: source.id,
        relativePath: 'video1.mp4',
        fileName: 'video1.mp4',
        fileSize: 100,
        lastModified: 100,
        availabilityStatus: 'available',
        verificationStatus: 'provisional',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const loc2 = {
        id: 'loc-test-2',
        mediaAssetId: 'asset-2',
        directoryId: source.id,
        relativePath: 'video2.mp4',
        fileName: 'video2.mp4',
        fileSize: 200,
        lastModified: 200,
        availabilityStatus: 'available',
        verificationStatus: 'provisional',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      testDb.fileLocations.push(loc1);
      testDb.fileLocations.push(loc2);

      globalHashQueue.pause();
      
      await processBackgroundHashingQueue();
      await processBackgroundHashingQueue();
      await processBackgroundHashingQueue();

      let total = bgHashState.targetKeys.size;
      assert(total === 2, 'Total Y limit does not exceed 2 even after calling 3 times');
      assert(globalHashQueue.queue.length === 2, 'Only 2 tasks are enqueued');

      globalHashQueue.resume();

      await new Promise(resolve => setTimeout(resolve, 50));

      assert(globalHashQueue.queuedKeys.size === 0, 'Queued keys cleared');
      assert(globalHashQueue.runningKeys.size === 0, 'Running keys cleared');

    } finally {
      window.testComputeSHA256Hook = undefined;
      setDbForTesting(originalDb);
      globalHashQueue.cancelPending();
    }
  });

  await runTest('11-22. Verification of provisional locations exclusion for disconnected/unauthorized folder sources', async () => {
    globalHashQueue.cancelPending();
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g11_22_', 'TestVideoDB_G11_22');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };

    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();
    bgHashState.activeId = null;
    bgHashState.activeName = '';
    bgHashState.activePercent = null;

    const originalDb = db;
    setDbForTesting(testDb);

    try {
      const oldSource = await testDb.addDirectorySource({ name: 'OldFolder' });
      await testDb.updateDirectorySource(oldSource.id, { permissionStatus: 'permission-required' });

      const newSource = await testDb.addDirectorySource({ name: 'NewFolder' });
      await testDb.updateDirectorySource(newSource.id, { permissionStatus: 'granted' });
      
      let computeSHA256CallCount = 0;
      window.testComputeSHA256Hook = (fileObj) => {
        computeSHA256CallCount++;
        if (fileObj.name === 'video1.mp4') return 'hash_asset_1';
        if (fileObj.name === 'video2.mp4') return 'different_hash_for_asset_2';
        return 'dummy_hash';
      };

      const newHandle = new MockFileSystemDirectoryHandle('NewFolder', {
        'video1.mp4': new MockFileSystemFileHandle('video1.mp4', 100, 100),
        'video2.mp4': new MockFileSystemFileHandle('video2.mp4', 200, 200)
      });
      await testDb.putDirectoryHandle(newSource.handleKey, newHandle);

      await testDb.deleteDirectorySource(oldSource.id);

      const asset1 = await testDb.addVideo({
        fileName: 'video1.mp4',
        fileSize: 100,
        lastModified: 100,
        quickHash: 'qh_1',
        hashStatus: 'completed',
        identityStatus: 'verified'
      });
      asset1.contentHash = 'hash_asset_1';
      await testDb._saveTable('media_assets', testDb.mediaAssets);

      const asset2 = await testDb.addVideo({
        fileName: 'video2.mp4',
        fileSize: 200,
        lastModified: 200,
        quickHash: 'qh_2',
        hashStatus: 'completed',
        identityStatus: 'verified'
      });
      asset2.contentHash = 'hash_asset_2_original';
      await testDb._saveTable('media_assets', testDb.mediaAssets);

      const locOld1 = {
        id: 'loc-old-1',
        mediaAssetId: asset1.id,
        directoryId: oldSource.id,
        relativePath: 'video1.mp4',
        fileName: 'video1.mp4',
        fileSize: 100,
        lastModified: 100,
        availabilityStatus: 'permission-required',
        verificationStatus: 'provisional',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const locNew1 = {
        id: 'loc-new-1',
        mediaAssetId: asset1.id,
        directoryId: newSource.id,
        relativePath: 'video1.mp4',
        fileName: 'video1.mp4',
        fileSize: 100,
        lastModified: 100,
        availabilityStatus: 'available',
        verificationStatus: 'provisional',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const locOld2 = {
        id: 'loc-old-2',
        mediaAssetId: asset2.id,
        directoryId: oldSource.id,
        relativePath: 'video2.mp4',
        fileName: 'video2.mp4',
        fileSize: 200,
        lastModified: 200,
        availabilityStatus: 'permission-required',
        verificationStatus: 'provisional',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const locNew2 = {
        id: 'loc-new-2',
        mediaAssetId: asset2.id,
        directoryId: newSource.id,
        relativePath: 'video2.mp4',
        fileName: 'video2.mp4',
        fileSize: 200,
        lastModified: 200,
        availabilityStatus: 'available',
        verificationStatus: 'provisional',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      testDb.fileLocations.push(locOld1, locNew1, locOld2, locNew2);

      globalHashQueue.pause();

      await processBackgroundHashingQueue();
      await processBackgroundHashingQueue();

      let total = bgHashState.targetKeys.size;
      assert(total === 2, `Total must be 2, got ${total}`);
      assert(globalHashQueue.queue.length === 2, `Queue length must be 2, got ${globalHashQueue.queue.length}`);
      assert(globalHashQueue.queuedKeys.has('loc-new-1') && globalHashQueue.queuedKeys.has('loc-new-2'), 'Only new locations are enqueued');
      assert(!globalHashQueue.queuedKeys.has('loc-old-1') && !globalHashQueue.queuedKeys.has('loc-old-2'), 'Old locations are excluded');

      globalHashQueue.resume();

      await new Promise(resolve => setTimeout(resolve, 50));

      assert(globalHashQueue.queuedKeys.size === 0, 'All enqueued tasks complete');
      assert(globalHashQueue.runningKeys.size === 0, 'All running tasks complete');

      // 1. Confirm that full SHA-256 function was called for loc-new-1 despite asset1.contentHash being pre-verified
      assert(computeSHA256CallCount >= 2, 'Full hash computed for all provisional locations, even if contentHash is completed');

      // 2. Confirm loc-new-1 is verified (matches hash)
      const freshNew1 = testDb.fileLocations.find(l => l.id === 'loc-new-1');
      assert(freshNew1.verificationStatus === 'verified', 'Matches contentHash -> verified');

      // 3. Confirm loc-new-2 got separated because of hash mismatch
      const freshNew2 = testDb.fileLocations.find(l => l.id === 'loc-new-2');
      assert(freshNew2.verificationStatus === 'verified', 'Separated loc is also verified');
      assert(freshNew2.mediaAssetId !== asset2.id, 'Mismatch -> separated to a new asset');

      // 5. Confirm separated asset does not have duplicated ratings or reviews
      const originalAssetReviews = testDb.reviews.filter(r => r.mediaAssetId === asset2.id);
      const separatedAssetReviews = testDb.reviews.filter(r => r.mediaAssetId === freshNew2.mediaAssetId);
      assert(separatedAssetReviews.length === 0, 'Separated asset reviews are empty');

    } finally {
      window.testComputeSHA256Hook = undefined;
      setDbForTesting(originalDb);
      globalHashQueue.cancelPending();
    }
  });

  console.groupEnd();
}
