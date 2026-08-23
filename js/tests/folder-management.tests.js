import { AppDatabase } from '../db.js';
import { generateFileSignature, formatTime, parseTime, normalizePath, filterVideosByTag } from '../video-helper.js';
import { isSupportedVideoFile, isPathCoveredByFailedDirectory, scanDirectory, classifyScanResults, applyScanDifferentials, isIgnoredSystemEntry } from '../directory-scanner.js';
import { RadarChart } from '../radar.js';
import { db, setDbForTesting, handleFolderSelect, handleFolderRequestPermission, processSingleLocationVerification, els, openSettingsModal } from '../app.js';
import { MemoryStorage, MockFileSystemFileHandle, MockFileSystemDirectoryHandle } from '../tests.js';

export async function runFolderManagementTests(runTest, assert) {
  console.group('Group 14: Folder Management & Scan Logic Tests');

  await runTest('6-12. Directory scanner recursive matching and missing checks', async () => {
    // Setup nested files tree
    // Root Folder
    // ├── movie.mp4 (valid size 1000)
    // ├── failed_file.mp4 (will simulate getFile() crash)
    // ├── document.txt (unsupported extension)
    // ├── MOVIE_UPPERCASE.MOV (valid size 3000)
    // ├── failed_dir/ (will simulate iteration crash)
    // │   └── nested.mp4
    // └── subfolder/
    //     ├── movie.mp4 (valid nested - duplicate name in sub)
    //     └── photo.png (unsupported extension)

    const failedFileHandle = new MockFileSystemFileHandle('failed_file.mp4', 2000, 200);
    failedFileHandle._shouldFail = true; // getFile() throws error

    const failedDirHandle = new MockFileSystemDirectoryHandle('failed_dir', {
      'nested.mp4': new MockFileSystemFileHandle('nested.mp4', 4000, 400)
    });
    failedDirHandle._shouldFail = true; // values() throws error

    const rootDir = new MockFileSystemDirectoryHandle('root', {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 1000, 100),
      'failed_file.mp4': failedFileHandle,
      'document.txt': new MockFileSystemFileHandle('document.txt', 200, 200),
      'MOVIE_UPPERCASE.MOV': new MockFileSystemFileHandle('MOVIE_UPPERCASE.MOV', 3000, 300),
      'failed_dir': failedDirHandle,
      'subfolder': new MockFileSystemDirectoryHandle('subfolder', {
        'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 5000, 500),
        'photo.png': new MockFileSystemFileHandle('photo.png', 150, 150)
      })
    });

    const scanResult = await scanDirectory({
      directoryHandle: rootDir,
      recursive: true
    });

    // Verify scan results collection structure
    assert(scanResult.completed === true, 'Scan must run to completion');
    assert(scanResult.scannedFiles.length === 3, 'Successfully scanned movie.mp4, MOVIE_UPPERCASE.MOV, and subfolder/movie.mp4');
    assert(scanResult.failedFiles.length === 1, 'Should log 1 failed file getFile() crash');
    assert(scanResult.failedDirectories.length === 1, 'Should log 1 failed directory walk iteration crash');

    // Seed test DB to test applyScanDifferentials
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_ScannerDiff');
    await testDb.initAsync();
    const dirId = 'dir-integrity-id';

    // 1. Unchanged video
    await testDb.addVideo({
      title: 'movie.mp4',
      fileName: 'movie.mp4',
      fileSize: 1000,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'movie.mp4',
      lastModified: 100
    });
    // 2. Modified video (size will change)
    await testDb.addVideo({
      title: 'MOVIE_UPPERCASE.MOV',
      fileName: 'MOVIE_UPPERCASE.MOV',
      fileSize: 500,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'MOVIE_UPPERCASE.MOV',
      lastModified: 100
    });
    // 3. Truly missing video in scanned tree (not in scanned, failedFiles, or failedDirs)
    const trulyMissing = await testDb.addVideo({
      title: 'removed.mp4',
      fileName: 'removed.mp4',
      fileSize: 9999,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'removed.mp4',
      lastModified: 100
    });
    // 4. Failed file video (exists in failedFiles scan list)
    const failedFileVideo = await testDb.addVideo({
      title: 'failed_file.mp4',
      fileName: 'failed_file.mp4',
      fileSize: 2000,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'failed_file.mp4',
      lastModified: 200
    });
    // 5. Failed directory video (exists under failed_dir path in failedDirectories scan list)
    const failedDirVideo = await testDb.addVideo({
      title: 'nested.mp4',
      fileName: 'nested.mp4',
      fileSize: 4000,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'failed_dir/nested.mp4',
      lastModified: 400
    });

    // Run differential classification (pure classification helper check)
    const existingVideos = testDb.getVideos().filter(v => v.sourceType === 'directory' && v.directoryId === dirId);
    const classified = classifyScanResults({
      existingVideos,
      scannedFiles: scanResult.scannedFiles,
      failedFiles: scanResult.failedFiles,
      failedDirectories: scanResult.failedDirectories,
      recursive: true
    });

    // Assert classification counts
    assert(classified.unchanged === 1, '1 unchanged video (movie.mp4)');
    assert(classified.updated === 1, '1 updated video (MOVIE_UPPERCASE.MOV size changed)');
    assert(classified.added === 1, '1 new video added (subfolder/movie.mp4)');
    assert(classified.missing === 1, 'Only 1 video truly missing (removed.mp4)');
    assert(classified.pending === 2, '2 videos pending review status due to scan failures (failed_file & nested)');

    // Run formal apply differentials on database
    const summary = await applyScanDifferentials({
      db: testDb,
      directoryId: dirId,
      scanResult,
      recursive: true
    });

    // Test 6: Verify truly missing file became 'missing'
    assert(testDb.getVideo(trulyMissing.id).availabilityStatus === 'missing', 'Missing files must become missing');

    // Test 7: Verify failed file did NOT become 'missing' (marked as scan-error)
    assert(testDb.getVideo(failedFileVideo.id).availabilityStatus === 'scan-error', 'getFile() failed files must not be flagged as missing');

    // Test 8: Verify file under failed directory did NOT become 'missing' (marked as scan-error)
    assert(testDb.getVideo(failedDirVideo.id).availabilityStatus === 'scan-error', 'Files inside failed directory iterations must not be flagged as missing');

    // Test 9: Verify aborted scans do not apply any differentials
    const abortedResult = { ...scanResult, completed: false, aborted: true };
    const abortSummary = await applyScanDifferentials({
      db: testDb,
      directoryId: dirId,
      scanResult: abortedResult,
      recursive: true
    });
    assert(abortSummary.added === 0 && abortSummary.missing === 0, 'No modifications should trigger on aborted scans');
  });

  await runTest('Root directory scan failure safety rules', async () => {
    // 1. Root handle throws values() error
    const brokenRootDir = new MockFileSystemDirectoryHandle('root');
    brokenRootDir._shouldFail = true; // values() fails immediately at root level

    const scanResult = await scanDirectory({
      directoryHandle: brokenRootDir,
      recursive: true
    });

    // 4. Verify scan is treated as incomplete/failed
    assert(scanResult.completed === false, 'Completed status must be false when root directory walk fails');
    assert(scanResult.failedDirectories.length === 1, 'Should record 1 failed directory');
    assert(scanResult.failedDirectories[0].relativePath === '', 'Root directory relativePath failure is saved as empty string');

    // Setup mock Database and existing video items
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_err_', 'TestVideoDB_RootScanError');
    await testDb.initAsync();
    const dirId = 'dir-root-error-id';

    const vid1 = await testDb.addVideo({
      title: 'movie1.mp4',
      fileName: 'movie1.mp4',
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'movie1.mp4',
      availabilityStatus: 'available'
    });

    const vid2 = await testDb.addVideo({
      title: 'movie2.mp4',
      fileName: 'movie2.mp4',
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'movie2.mp4',
      availabilityStatus: 'available'
    });

    // Test pure classification
    const existingVideos = testDb.getVideos().filter(v => v.sourceType === 'directory' && v.directoryId === dirId);
    const classified = classifyScanResults({
      existingVideos,
      scannedFiles: scanResult.scannedFiles,
      failedFiles: scanResult.failedFiles,
      failedDirectories: scanResult.failedDirectories,
      recursive: true
    });

    assert(classified.missing === 0, 'No videos should be classified as missing when root fails');
    assert(classified.pending === 2, 'All videos should remain pending');

    // 2 & 3. Run applyScanDifferentials and verify availabilityStatus
    const summary = await applyScanDifferentials({
      db: testDb,
      directoryId: dirId,
      scanResult,
      recursive: true
    });

    assert(summary.missing === 0, 'No videos must be marked as missing on root failures');
    assert(summary.pending === 2, 'All videos should be counted as pending');

    // Verify status updated to scan-error in DB
    assert(testDb.getVideo(vid1.id).availabilityStatus === 'scan-error', 'Video 1 must become scan-error');
    assert(testDb.getVideo(vid2.id).availabilityStatus === 'scan-error', 'Video 2 must become scan-error');
  });

  await runTest('Folder switching transaction and registration safety checks', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_fs_', 'TestVideoDB_FolderSwitchRegression');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) {
        return this.store[key] || null;
      },
      put: async function(key, val, storeName) {
        this.store[key] = val;
      },
      delete: async function(key, storeName) {
        delete this.store[key];
      },
      clear: async function() {
        this.store = {};
      }
    };

    // Simulation of handleFolderSelect with snapshotted old sources and safe deletes
    async function runFolderSelectSimulation({
      db,
      folderHandle,
      confirmResult = true,
      shouldFailPhase1 = false,
      shouldFailPhase3 = false
    }) {
      const tempUUID = 'temp-uuid-test';
      const tempKey = `pending-directory-handle-${tempUUID}`;
      let handleSavedToTemp = false;

      try {
        if (!folderHandle) return null;

        // Phase 1: Try saving new handle under temporary key
        if (shouldFailPhase1) {
          throw new Error('IndexedDB save failed during Phase 1');
        }
        await db.putDirectoryHandle(tempKey, folderHandle);
        handleSavedToTemp = true;

        // Phase 2: Read it back to verify serialization integrity
        const verifiedHandle = await db.getDirectoryHandle(tempKey);
        if (!verifiedHandle) {
          throw new Error('一時キーからのハンドルの読み戻しに失敗しました。');
        }

        // Phase 3: Test-read the directory to verify permissions/integrity
        if (shouldFailPhase3) {
          verifiedHandle._shouldFail = true;
        }
        let testReadSuccess = false;
        try {
          const iterator = verifiedHandle.values();
          await iterator.next();
          testReadSuccess = true;
        } catch (err) {
          console.warn('Folder test read failed:', err);
        }
        if (!testReadSuccess) {
          throw new Error('選択したフォルダへのアクセス権限がないか、読み取りに失敗しました。');
        }

        // Phase 4: Overwrite confirmation
        const oldSourceIds = db.getDirectorySources().map(s => s.id);
        if (oldSourceIds.length > 0) {
          if (!confirmResult) {
            await db.deleteDirectoryHandle(tempKey);
            return null;
          }
        }

        // Phase 5: Commit changes to Database
        const source = await db.addDirectorySource({
          name: folderHandle.name,
          includeSubdirectories: true
        });

        // Copy from temporary key to permanent handle key
        await db.putDirectoryHandle(source.handleKey, folderHandle);

        // Set permission status
        const status = await folderHandle.queryPermission({ mode: 'read' });
        await db.updateDirectorySource(source.id, { permissionStatus: status });

        // Clean up temporary handle
        await db.deleteDirectoryHandle(tempKey);
        handleSavedToTemp = false;

        // Disconnect old source if exists
        for (const oldId of oldSourceIds) {
          if (oldId !== source.id) {
            await db.deleteDirectorySource(oldId);
          }
        }

        return source;
      } catch (err) {
        if (handleSavedToTemp) {
          try { await db.deleteDirectoryHandle(tempKey); } catch (e) {}
        }
        throw err;
      }
    }

    // Scenario 1: Initial Registration from Clean State
    const firstHandle = new MockFileSystemDirectoryHandle('FirstFolder', {
      'first_vid.mp4': new MockFileSystemFileHandle('first_vid.mp4', 5000, 100)
    });

    const firstSource = await runFolderSelectSimulation({
      db: testDb,
      folderHandle: firstHandle
    });

    assert(firstSource !== null, 'Initial source registration must succeed');

    const sourcesAfterFirst = testDb.getDirectorySources();
    assert(sourcesAfterFirst.length === 1, 'Exactly 1 source must exist');
    assert(sourcesAfterFirst[0].id === firstSource.id, 'Registered source ID must match the returned source');

    const firstSavedHandle = await testDb.getDirectoryHandle(firstSource.handleKey);
    assert(firstSavedHandle !== null && firstSavedHandle.name === 'FirstFolder', 'DirectoryHandle must remain stored in IndexedDB');

    // Simulate scan/adding videos for this directory to test association
    const dummyVideo = await testDb.addVideo({
      title: 'first_vid.mp4',
      fileName: 'first_vid.mp4',
      fileSize: 5000,
      sourceType: 'directory',
      directoryId: firstSource.id,
      relativePath: 'first_vid.mp4',
      lastModified: 100
    });

    await testDb.saveReview(dummyVideo.id, { overallGrade: 'A', comment: 'Excellent quality' });

    const videos = testDb.getVideos().filter(v => v.fileName === 'first_vid.mp4');
    assert(videos.length === 1, 'Video must be registered');
    assert(videos[0].directoryId === firstSource.id, 'Scanned video directoryId must match the registered source ID');

    const fileHandle = await firstSavedHandle.getFileHandle(videos[0].relativePath);
    const resolvedFile = await fileHandle.getFile();
    assert(resolvedFile.name === 'first_vid.mp4' && resolvedFile.size === 5000, 'Resolved video file must match mock structure');


    // Scenario 2: Switching from Existing to New Folder
    const secondHandle = new MockFileSystemDirectoryHandle('SecondFolder', {
      'second_vid.mp4': new MockFileSystemFileHandle('second_vid.mp4', 8000, 200)
    });

    const secondSource = await runFolderSelectSimulation({
      db: testDb,
      folderHandle: secondHandle,
      confirmResult: true
    });

    assert(secondSource !== null, 'Switching folder must succeed');

    const sourcesAfterSwitch = testDb.getDirectorySources();
    assert(sourcesAfterSwitch.length === 1, 'Exactly 1 source must exist after switch');
    assert(sourcesAfterSwitch[0].id === secondSource.id, 'Active source ID must be the new source');

    const secondSavedHandle = await testDb.getDirectoryHandle(secondSource.handleKey);
    assert(secondSavedHandle !== null && secondSavedHandle.name === 'SecondFolder', 'New DirectoryHandle must be saved in IndexedDB');

    assert(testDb.getDirectorySource(firstSource.id) === undefined, 'Old source must be deleted');
    assert(testDb.getDirectorySource(secondSource.id) !== undefined, 'New source must NOT be deleted');


    // Scenario 3: Switching Cancellation
    const cancelHandle = new MockFileSystemDirectoryHandle('CancelledFolder');

    const cancelledSource = await runFolderSelectSimulation({
      db: testDb,
      folderHandle: cancelHandle,
      confirmResult: false // Cancel confirmation
    });

    assert(cancelledSource === null, 'Cancelled transition must return null source');

    const sourcesAfterCancel = testDb.getDirectorySources();
    assert(sourcesAfterCancel.length === 1, 'Exactly 1 source must remain active');
    assert(sourcesAfterCancel[0].id === secondSource.id, 'Old active source must remain connected');

    const cancelCheckedHandle = await testDb.getDirectoryHandle(secondSource.handleKey);
    assert(cancelCheckedHandle !== null && cancelCheckedHandle.name === 'SecondFolder', 'Old DirectoryHandle must be preserved');

    const cancelTempHandle = await testDb.getDirectoryHandle(cancelHandle.handleKey);
    assert(cancelTempHandle === null, 'Cancelled handle must not be saved under permanent key');


    // Scenario 4: Verification / Save Failures

    // 4a. IndexedDB write failure (Save failure)
    let saveFailed = false;
    try {
      await runFolderSelectSimulation({
        db: testDb,
        folderHandle: new MockFileSystemDirectoryHandle('BrokenIDB'),
        shouldFailPhase1: true
      });
    } catch (e) {
      saveFailed = true;
    }
    assert(saveFailed, 'Phase 1 write error must throw');

    assert(testDb.getDirectorySources().length === 1, 'Active source remains connected on save failures');
    assert(testDb.getDirectorySources()[0].id === secondSource.id, 'Active source remains the second source');

    // 4b. Test-read failure (Walk/validation failure)
    let readFailed = false;
    try {
      await runFolderSelectSimulation({
        db: testDb,
        folderHandle: new MockFileSystemDirectoryHandle('BrokenRead'),
        shouldFailPhase3: true
      });
    } catch (e) {
      readFailed = true;
    }
    assert(readFailed, 'Phase 3 read validation error must throw');

    assert(testDb.getDirectorySources().length === 1, 'Active source remains connected on read validation failures');
    assert(testDb.getDirectorySources()[0].id === secondSource.id, 'Active source remains the second source');

    const tempKeyPattern = `pending-directory-handle-temp-uuid-test`;
    const tempHandleCheck = await testDb.getDirectoryHandle(tempKeyPattern);
    assert(tempHandleCheck === null, 'Temporary verification handle must be deleted from IDB');
  });


  console.group('Group 9: Backup Restore Folder Handle Preservation Tests');

  await runTest('Test A: restored handleKey is identical to local handleKey -> reused', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_a_');
    await testDb.initAsync();

    testDb.idbAvailable = true;
    const mockHandle = {
      name: 'real-dir',
      queryPermission: async () => 'granted'
    };
    testDb.idb = {
      store: { 'handle-1': mockHandle },
      getAll: async function(storeName) {
        if (storeName === 'handles') return [{ id: 'handle-1', data: this.store['handle-1'] }];
        return [];
      },
      clearImages: async function() {},
      clearHandles: async function() {},
      put: async function() {}
    };

    const restoredData = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        { id: 'src-1', name: 'real-dir', handleKey: 'handle-1', permissionStatus: 'prompt' }
      ],
      genres: [], evaluation_templates: []
    };

    await testDb.restoreWithRollback(restoredData, []);

    const src = testDb.directorySources[0];
    assert(src.handleKey === 'handle-1', 'handleKey remains handle-1');
    assert(src.permissionStatus === 'granted', 'permissionStatus is queried as granted');
  });

  await runTest('Test B: source.id is identical, but handleKey differs -> remapped to existing local handleKey', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_b_');
    await testDb.initAsync();

    // Setup local state with src-1 pointing to handle-local
    testDb.directorySources = [{ id: 'src-1', name: 'real-dir', handleKey: 'handle-local', permissionStatus: 'granted' }];
    testDb._saveAll();

    testDb.idbAvailable = true;
    const mockHandle = {
      name: 'real-dir',
      queryPermission: async () => 'granted'
    };
    testDb.idb = {
      store: { 'handle-local': mockHandle },
      getAll: async function(storeName) {
        if (storeName === 'handles') return [{ id: 'handle-local', data: this.store['handle-local'] }];
        return [];
      },
      clearImages: async function() {},
      clearHandles: async function() {},
      put: async function() {}
    };

    // Restored data has src-1 pointing to handle-backup (different handleKey)
    const restoredData = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        { id: 'src-1', name: 'real-dir', handleKey: 'handle-backup', permissionStatus: 'prompt' }
      ],
      genres: [], evaluation_templates: []
    };

    await testDb.restoreWithRollback(restoredData, []);

    const src = testDb.directorySources[0];
    assert(src.handleKey === 'handle-local', 'handleKey is remapped to handle-local');
    assert(src.permissionStatus === 'granted', 'permissionStatus is queried as granted');
  });

  await runTest('Test C: no handle matches handleKey -> prompt/disconnected and clears handleKey', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_c_');
    await testDb.initAsync();

    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      getAll: async function() { return []; },
      clearImages: async function() {},
      clearHandles: async function() {},
      put: async function() {}
    };

    const restoredData = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        { id: 'src-1', name: 'missing-dir', handleKey: 'handle-missing', permissionStatus: 'granted' }
      ],
      genres: [], evaluation_templates: []
    };

    await testDb.restoreWithRollback(restoredData, []);

    const src = testDb.directorySources[0];
    assert(src.handleKey === '', 'handleKey must be cleared');
    assert(src.permissionStatus === 'disconnected', 'permissionStatus becomes disconnected');
  });

  await runTest('Test D: clean machine (0 saved handles) -> succeeds but requires reconnection', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_d_');
    await testDb.initAsync();

    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      getAll: async function() { return []; },
      clearImages: async function() {},
      clearHandles: async function() {},
      put: async function() {}
    };

    const restoredData = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        { id: 'src-1', name: 'some-dir', handleKey: 'handle-some', permissionStatus: 'granted' }
      ],
      genres: [], evaluation_templates: []
    };

    await testDb.restoreWithRollback(restoredData, []);

    const src = testDb.directorySources[0];
    assert(src.handleKey === '', 'handleKey is empty');
    assert(src.permissionStatus === 'disconnected', 'Requires reconnection (disconnected)');
  });

  await runTest('Test E: reload simulation retrieves preserved handle', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_e_');
    await testDb.initAsync();

    testDb.idbAvailable = true;
    const mockHandle = {
      name: 'real-dir',
      queryPermission: async () => 'granted'
    };
    testDb.idb = {
      store: { 'handle-1': mockHandle },
      getAll: async function(storeName) {
        if (storeName === 'handles') return [{ id: 'handle-1', data: this.store['handle-1'] }];
        return [];
      },
      get: async function(key) {
        return this.store[key];
      },
      clearImages: async function() {},
      clearHandles: async function() {},
      put: async function() {}
    };

    const restoredData = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        { id: 'src-1', name: 'real-dir', handleKey: 'handle-1', permissionStatus: 'prompt' }
      ],
      genres: [], evaluation_templates: []
    };

    await testDb.restoreWithRollback(restoredData, []);

    // Simulating page reload by instantiating database again pointing to same memoryStorage & IndexedDB
    const reloadedDb = new AppDatabase(memoryStorage, 'test_v9_e_');
    await reloadedDb.initAsync();
    reloadedDb.idbAvailable = true;
    reloadedDb.idb = testDb.idb;

    const handle = await reloadedDb.getDirectoryHandle(reloadedDb.directorySources[0].handleKey);
    assert(handle === mockHandle, 'Reloaded database retrieves the correct preserved handle');
  });

  await runTest('Test F: failed restore rolls back all directory_sources, handleKey, and DirectoryHandle', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_f_');
    await testDb.initAsync();

    testDb.idbAvailable = true;
    testDb.idb = {
      store: {
        'handle-orig': { name: 'orig-dir' }
      },
      clearCalls: [],
      getAll: async function(storeName) {
        if (storeName === 'handles') {
          return Object.keys(this.store)
            .filter(k => k.startsWith('handle-'))
            .map(k => ({ id: k, data: this.store[k] }));
        }
        return [];
      },
      clearImages: async function() {},
      clearHandles: async function() {
        this.clearCalls.push('clearHandles');
        for (const k in this.store) {
          if (k.startsWith('handle-')) delete this.store[k];
        }
      },
      put: async function(key, val, storeName) {
        this.store[key] = val;
      }
    };

    // Seed original data
    testDb.directorySources = [{ id: 'src-orig', name: 'orig-dir', handleKey: 'handle-orig', permissionStatus: 'granted' }];
    testDb._saveAll();

    // Setup localStorage failure mock
    testDb._saveTable = function() {
      throw new Error('Injected localStorage write failure');
    };

    const restoredData = {
      media_assets: [], file_locations: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        { id: 'src-new', name: 'new-dir', handleKey: 'handle-new', permissionStatus: 'granted' }
      ],
      genres: [], evaluation_templates: []
    };

    let restoreSucceeded = false;
    try {
      await testDb.restoreWithRollback(restoredData, []);
      restoreSucceeded = true;
    } catch (err) {
      // expected
    }

    assert(restoreSucceeded === false, 'Restore must fail');
    assert(testDb.idb.clearCalls.includes('clearHandles') === true, 'Failed restore must call clearHandles() during rollback');
    assert(testDb.idb.store['handle-orig'] !== undefined, 'Original handles must be restored after rollback');
    assert(testDb.directorySources[0].id === 'src-orig', 'In-memory directory sources must be rolled back');
  });

  console.groupEnd(); // Group 9

  await runTest('Folder reconnection preserves source ID, video associations, and evaluations without duplication', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_reconn_', 'TestVideoDB_ReconnectRegression');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };

    // 1. Setup initial source and video with evaluations
    const initialSource = await testDb.addDirectorySource({
      name: 'OriginalFolder',
      includeSubdirectories: true
    });
    // Set to disconnected (simulating restore on different browser or lost handle)
    await testDb.updateDirectorySource(initialSource.id, {
      handleKey: '',
      permissionStatus: 'disconnected'
    });

    const video = await testDb.addVideo({
      title: 'video.mp4',
      fileName: 'video.mp4',
      fileSize: 5000,
      duration: 10,
      sourceType: 'directory',
      directoryId: initialSource.id,
      relativePath: 'video.mp4',
      lastModified: 100
    });
    const videoId = video.id;

    // Add review, rating, tags, timeline notes referencing the actual generated videoId
    await testDb.saveReview(videoId, { overallGrade: 'A', comment: '', ratings: { 'crit-1': 4 } });
    await testDb.addTagToVideo(videoId, 'tag-1');
    const review = testDb.getOwnerReviewForVideo(videoId);
    testDb.timelineNotes = [{ id: 'note-1', videoReviewId: review.id, mediaAssetId: videoId, timestampSeconds: 0, timestampLabel: '00:00', comment: 'Note 1', createdAt: '' }];
    testDb._saveAll();

    // Reconnection via production DB method
    const folderHandle = new MockFileSystemDirectoryHandle('ReconnectedFolder', {
      'video.mp4': new MockFileSystemFileHandle('video.mp4', 5000, 100)
    });

    await testDb.reconnectDirectorySource(initialSource.id, folderHandle);

    const reconnectedSource = testDb.getDirectorySource(initialSource.id);

    // Check source.id is kept and updated
    assert(reconnectedSource !== undefined, 'Reconnection must succeed');
    assert(reconnectedSource.id === initialSource.id, 'source.id is preserved (does not change)');
    assert(reconnectedSource.name === 'ReconnectedFolder', 'Folder source name is updated');
    assert(reconnectedSource.permissionStatus === 'granted', 'permissionStatus is updated to granted');

    // Verify video directory ID is kept
    const videoAfterReconnect = testDb.getVideos().find(v => v.relativePath === 'video.mp4');
    assert(videoAfterReconnect.directoryId === initialSource.id, 'Existing video directoryId remains the same');

    // Simulate rescan and check for duplicates
    const scanResult = {
      scannedFiles: [{ relativePath: 'video.mp4', fileName: 'video.mp4', fileSize: 5000, lastModified: 100 }],
      failedFiles: [],
      failedDirectories: [],
      completed: true,
      aborted: false
    };

    const summary = await applyScanDifferentials({
      db: testDb,
      directoryId: initialSource.id,
      scanResult,
      recursive: true
    });

    assert(summary.added === 0, 'No new videos should be added during scan because relativePath matched');
    assert(summary.unchanged === 1, 'The existing video should be matched and marked unchanged');
    assert(testDb.getVideos().filter(v => v.sourceType === 'directory').length === 1, 'Total video count remains exactly 1 (no duplicates)');

    // Verify evaluations are preserved
    assert(testDb.reviews.length === 1, 'Reviews are preserved');
    assert(testDb.reviews[0].mediaAssetId === videoId, 'Review is still linked to video');
    assert(testDb.criterionRatings.length === 1, 'Ratings are preserved');
    assert(testDb.videoTags.length === 1, 'Tags are preserved');
    assert(testDb.timelineNotes.length === 1, 'Timeline notes are preserved');
  });

  await runTest('Event handler path: handleFolderRequestPermission delegates to reconnect mode', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_handler_path_', 'TestVideoDB_HandlerPath');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };

    const originalAppDb = db;
    setDbForTesting(testDb);

    try {
      const initialSource = await testDb.addDirectorySource({
        name: 'OriginalFolder',
        includeSubdirectories: true
      });
      // Set to disconnected
      await testDb.updateDirectorySource(initialSource.id, {
        handleKey: '',
        permissionStatus: 'disconnected'
      });

      // Mock window.showDirectoryPicker
      const folderHandle = new MockFileSystemDirectoryHandle('ReconnectedFolder', {
        'video.mp4': new MockFileSystemFileHandle('video.mp4', 5000, 100)
      });
      const originalShowDirectoryPicker = window.showDirectoryPicker;
      window.showDirectoryPicker = async () => folderHandle;

      // Trigger the actual event handler path
      await handleFolderRequestPermission();

      // Restore picker
      window.showDirectoryPicker = originalShowDirectoryPicker;

      // Verify that reconnect happened and the source ID remains initialSource.id
      const sources = testDb.getDirectorySources();
      assert(sources.length === 1, 'Still only one directory source');
      assert(sources[0].id === initialSource.id, 'Source ID is preserved after event handler reconnect');
      assert(sources[0].name === 'ReconnectedFolder', 'Name updated via event handler');
      assert(sources[0].permissionStatus === 'granted', 'Permission granted via event handler');
    } finally {
      // Revert the app database
      setDbForTesting(originalAppDb);
    }
  });

  await runTest('Normal folder switching continues to work as expected', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_normal_switch_', 'TestVideoDB_NormalSwitch');
    await testDb.initAsync();
    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      get: async function(key, storeName) { return this.store[key] || null; },
      put: async function(key, val, storeName) { this.store[key] = val; },
      delete: async function(key, storeName) { delete this.store[key]; },
      clear: async function() { this.store = {}; }
    };

    // 1. Add directory source A
    const sourceA = await testDb.addDirectorySource({ name: 'FolderA', includeSubdirectories: true });

    // 2. Select directory source B (Normal Switch)
    const folderHandleB = new MockFileSystemDirectoryHandle('FolderB', {
      'new_video.mp4': new MockFileSystemFileHandle('new_video.mp4', 8000, 200)
    });

    const tempKey = 'pending-directory-handle-temp';
    await testDb.putDirectoryHandle(tempKey, folderHandleB);

    const sourceB = await testDb.addDirectorySource({ name: 'FolderB', includeSubdirectories: true });
    await testDb.putDirectoryHandle(sourceB.handleKey, folderHandleB);
    await testDb.updateDirectorySource(sourceB.id, { permissionStatus: 'granted' });
    await testDb.deleteDirectoryHandle(tempKey);

    const oldSourceIds = [sourceA.id];
    for (const oldId of oldSourceIds) {
      if (oldId !== sourceB.id) {
        await testDb.deleteDirectorySource(oldId);
      }
    }

    assert(testDb.getDirectorySources().length === 1, 'Only one directory source remains');
    assert(testDb.getDirectorySources()[0].id === sourceB.id, 'Remaining source is FolderB');
    assert(testDb.getDirectorySource(sourceA.id) === undefined, 'FolderA has been deleted');
  });

  await runTest('Settings button click opens settings modal regression test', async () => {
    // 1. Mock the showDirectoryPicker function on window so that isFileSystemSupported is true
    const originalShowDirectoryPicker = window.showDirectoryPicker;
    window.showDirectoryPicker = () => {};

    try {
      // 2. Save original els properties
      const originalEls = { ...els };

      // 3. Mock required elements in els for openSettingsModal and renderFolderSettingsUI
      els.folderApiFallbackMsg = document.createElement('div');
      els.folderSettingsPanel = document.createElement('div');
      els.modalSettings = document.createElement('div');

      els.folderNameVal = document.createElement('span');
      els.folderStatusVal = document.createElement('span');
      els.folderPermissionVal = document.createElement('span');
      els.folderVideoCountVal = document.createElement('span');
      els.folderLastScanVal = document.createElement('span');

      els.btnFolderRescan = document.createElement('button');
      els.btnFolderRequestPerm = document.createElement('button');
      els.btnFolderDisconnect = document.createElement('button');
      els.btnFolderSelect = document.createElement('button');
      els.folderRecursiveCheckbox = document.createElement('input');
      els.folderRecursiveCheckbox.type = 'checkbox';

      els.settingsGenreSelect = document.createElement('select');
      els.settingsCopySourceSelect = document.createElement('select');
      els.settingsNewGenreInput = document.createElement('input');
      els.settingsBtnGenreToggleActive = document.createElement('button');
      els.settingsBtnGenreAdd = document.createElement('button');
      els.settingsBtnGenreUp = document.createElement('button');
      els.settingsBtnGenreDown = document.createElement('button');
      els.settingsNewNameInput = document.createElement('input');
      els.settingsBtnAdd = document.createElement('button');
      els.settingsCriteriaList = document.createElement('div');
      els.backupLastTimeVal = document.createElement('span');

      // Make sure the modal does not have 'open' class initially
      els.modalSettings.classList.remove('open');

      // 4. Call openSettingsModal()
      openSettingsModal();

      // 5. Assertions
      assert(els.modalSettings.classList.contains('open'), 'Modal must have open class after opening');

      // Restore els
      Object.assign(els, originalEls);
    } finally {
      // Restore window.showDirectoryPicker
      window.showDirectoryPicker = originalShowDirectoryPicker;
    }
  });

  console.groupEnd(); // Group 14
}
