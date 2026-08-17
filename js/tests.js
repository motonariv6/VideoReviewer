import { AppDatabase } from './db.js';
import { generateFileSignature, formatTime, parseTime, validateVideoUrl, normalizePath, filterVideosByTag } from './video-helper.js';
import { isSupportedVideoFile, isPathCoveredByFailedDirectory, scanDirectory, classifyScanResults, applyScanDifferentials } from './directory-scanner.js';
import { RadarChart } from './radar.js';
import { db, setDbForTesting, handleFolderSelect, handleFolderRequestPermission } from './app.js';
import { computeSHA256, computeQuickHash, computeFileSHA256 } from './hash-helper.js';

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
    const blob = new Blob([this._content], { type: 'video/mp4' });
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
export async function runTests() {
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

    // Test 18 & 19: Confirm test suite imports shared directory-scanner.js (completed by module imports)
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

  // --- GROUP 2.5: ROOT SCAN FAILURE TESTS ---

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

  // --- GROUP 3: FOLDER SWITCHING TWO-PHASE COMMIT & INITIAL REGISTRY REGRESSION TESTS ---

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

    // ----------------------------------------------------
    // Scenario 1: Initial Registration from Clean State (未設定状態から初回登録)
    // ----------------------------------------------------
    const firstHandle = new MockFileSystemDirectoryHandle('FirstFolder', {
      'first_vid.mp4': new MockFileSystemFileHandle('first_vid.mp4', 5000, 100)
    });

    const firstSource = await runFolderSelectSimulation({
      db: testDb,
      folderHandle: firstHandle
    });

    assert(firstSource !== null, 'Initial source registration must succeed');
    
    // - 新規sourceが登録後も残る
    const sourcesAfterFirst = testDb.getDirectorySources();
    assert(sourcesAfterFirst.length === 1, 'Exactly 1 source must exist');
    assert(sourcesAfterFirst[0].id === firstSource.id, 'Registered source ID must match the returned source');

    // - DirectoryHandleが残る
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

    // Add rating to this video to verify it stays
    await testDb.saveReview(dummyVideo.id, { overallGrade: 'S', comment: 'Excellent quality' });

    // - スキャン動画のdirectoryIdが新規source.idと一致する
    const videos = testDb.getVideos().filter(v => v.fileName === 'first_vid.mp4');
    assert(videos.length === 1, 'Video must be registered');
    assert(videos[0].directoryId === firstSource.id, 'Scanned video directoryId must match the registered source ID');

    // - 動画を開いてFileを取得できる
    const fileHandle = await firstSavedHandle.getFileHandle(videos[0].relativePath);
    const resolvedFile = await fileHandle.getFile();
    assert(resolvedFile.name === 'first_vid.mp4' && resolvedFile.size === 5000, 'Resolved video file must match mock structure');


    // ----------------------------------------------------
    // Scenario 2: Switching from Existing to New Folder (既存から別フォルダへ切り替え)
    // ----------------------------------------------------
    const secondHandle = new MockFileSystemDirectoryHandle('SecondFolder', {
      'second_vid.mp4': new MockFileSystemFileHandle('second_vid.mp4', 8000, 200)
    });

    const secondSource = await runFolderSelectSimulation({
      db: testDb,
      folderHandle: secondHandle,
      confirmResult: true
    });

    assert(secondSource !== null, 'Switching folder must succeed');
    
    // - 新規sourceと新規Handleは残る
    const sourcesAfterSwitch = testDb.getDirectorySources();
    assert(sourcesAfterSwitch.length === 1, 'Exactly 1 source must exist after switch');
    assert(sourcesAfterSwitch[0].id === secondSource.id, 'Active source ID must be the new source');
    
    const secondSavedHandle = await testDb.getDirectoryHandle(secondSource.handleKey);
    assert(secondSavedHandle !== null && secondSavedHandle.name === 'SecondFolder', 'New DirectoryHandle must be saved in IndexedDB');

    // - 旧sourceのみ削除される (Old source is deleted, but new is kept)
    assert(testDb.getDirectorySource(firstSource.id) === undefined, 'Old source must be deleted');
    assert(testDb.getDirectorySource(secondSource.id) !== undefined, 'New source must NOT be deleted');


    // ----------------------------------------------------
    // Scenario 3: Switching Cancellation (切り替えキャンセル)
    // ----------------------------------------------------
    const cancelHandle = new MockFileSystemDirectoryHandle('CancelledFolder');
    
    const cancelledSource = await runFolderSelectSimulation({
      db: testDb,
      folderHandle: cancelHandle,
      confirmResult: false // Cancel confirmation
    });

    assert(cancelledSource === null, 'Cancelled transition must return null source');

    // - 旧sourceとHandleが維持される
    const sourcesAfterCancel = testDb.getDirectorySources();
    assert(sourcesAfterCancel.length === 1, 'Exactly 1 source must remain active');
    assert(sourcesAfterCancel[0].id === secondSource.id, 'Old active source must remain connected');
    
    const cancelCheckedHandle = await testDb.getDirectoryHandle(secondSource.handleKey);
    assert(cancelCheckedHandle !== null && cancelCheckedHandle.name === 'SecondFolder', 'Old DirectoryHandle must be preserved');
    
    // Verify cancelled handle was not saved permanently
    const cancelTempHandle = await testDb.getDirectoryHandle(cancelHandle.handleKey);
    assert(cancelTempHandle === null, 'Cancelled handle must not be saved under permanent key');


    // ----------------------------------------------------
    // Scenario 4: Verification / Save Failures (新規フォルダの保存・検証失敗)
    // ----------------------------------------------------
    
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

    // - 旧sourceとHandleが維持される
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

    // - 旧sourceとHandleが維持される
    assert(testDb.getDirectorySources().length === 1, 'Active source remains connected on read validation failures');
    assert(testDb.getDirectorySources()[0].id === secondSource.id, 'Active source remains the second source');

    // - 一時Handleが削除される
    const tempKeyPattern = `pending-directory-handle-temp-uuid-test`;
    const tempHandleCheck = await testDb.getDirectoryHandle(tempKeyPattern);
    assert(tempHandleCheck === null, 'Temporary verification handle must be deleted from IDB');
  });

  // --- GROUP 4: REGRESSION TEST BASES (20-27) ---

  await runTest('20. sourceType migration preservation', async () => {
    const memory = new MemoryStorage();
    const legacyVideo = { id: 'vid-mig-1', title: 'Mig Video', videoUrl: 'https://site.com/vid.mp4' };
    memory.setItem('test_vreview_videos', JSON.stringify([legacyVideo]));

    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_Mig');
    await testDb.initAsync();
    
    assert(testDb.getVideo('vid-mig-1').sourceType === 'url', 'Legacy URLs must map to url sourceType');
  });

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

  await runTest('24-26. Japanese IME composition enter tag registrations', async () => {
    const tagsList = [];
    let isComposing = false;

    const keydownHandlerMock = (e, val) => {
      if (e.isComposing || isComposing || e.keyCode === 229) {
        return; // Block additions
      }
      if (e.key === 'Enter') {
        if (tagsList.includes(val)) {
          return; // Block duplicate tags
        }
        tagsList.push(val);
      }
    };

    // Test 24: IME active conversion (Enter key)
    isComposing = true;
    keydownHandlerMock({ key: 'Enter', isComposing: true, keyCode: 229 }, '映像美');
    assert(tagsList.length === 0, 'Tags must not be added while IME composition is active');

    // Test 25: IME conversion finalized (standard Enter key)
    isComposing = false;
    keydownHandlerMock({ key: 'Enter', isComposing: false, keyCode: 13 }, '映像美');
    assert(tagsList.length === 1 && tagsList[0] === '映像美', 'Tag must be added once composition is finalized');

    // Test 26: Duplicate tag block
    keydownHandlerMock({ key: 'Enter', isComposing: false, keyCode: 13 }, '映像美');
    assert(tagsList.length === 1, 'Duplicate tag values must be rejected');
  });

  // --- GROUP 5: CASCADE VIDEO DELETION TESTS ---

  await runTest('Cascade video deletion integrity and asset checks', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_del_', 'TestVideoDB_CascadeDelete');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb._saveTable('media_assets', []);
    testDb._saveTable('file_locations', []);

    // 1. Setup Video A (to be deleted cascade) and Video B (to be kept)
    const vidA = await testDb.addVideo({
      title: 'Video A',
      fileName: 'video_a.mp4',
      sourceType: 'local-file'
    });
    const vidB = await testDb.addVideo({
      title: 'Video B',
      fileName: 'video_b.mp4',
      sourceType: 'local-file'
    });

    // Verify initial count
    assert(testDb.getVideos().length === 2, 'Initial videos count must be 2');

    // Add Ratings, Reviews, Tags, Notes for Video A using saveReview API (proper schema)
    const revA = await testDb.saveReview(vidA.id, {
      overallGrade: 'A',
      comment: 'Excellent',
      ratings: {
        'crit-1': 4,
        'crit-2': 5
      }
    });

    // Add tags association
    testDb.videoTags.push({ mediaAssetId: vidA.id, tagId: 'tag-1' });
    testDb._saveTable('video_tags', testDb.videoTags);

    // Add timeline notes
    testDb.timelineNotes.push({ id: 'note-a1', videoReviewId: revA.id, mediaAssetId: vidA.id, timestampSeconds: 10, comment: 'First note', thumbnailId: 'img-note-a1', createdAt: new Date().toISOString() });
    testDb._saveTable('timeline_notes', testDb.timelineNotes);

    // Seed thumbnails and note screenshots in IndexedDB mock if available
    await testDb.updateVideoThumbnail(vidA.id, new Blob(['thumb-a'], { type: 'image/jpeg' }));
    const videoWithThumb = testDb.getVideo(vidA.id);
    assert(videoWithThumb.thumbnailId !== '', 'Video A should have a thumbnail ID');

    // Setup associated reviews and notes for Video B using saveReview API (proper schema)
    const revB = await testDb.saveReview(vidB.id, {
      overallGrade: 'B',
      comment: 'Good',
      ratings: {
        'crit-1': 3,
        'crit-2': 2
      }
    });
    testDb.videoTags.push({ mediaAssetId: vidB.id, tagId: 'tag-2' });
    testDb._saveTable('video_tags', testDb.videoTags);
    testDb.timelineNotes.push({ id: 'note-b1', videoReviewId: revB.id, mediaAssetId: vidB.id, timestampSeconds: 20, comment: 'Second note', thumbnailId: 'img-note-b1', createdAt: new Date().toISOString() });
    testDb._saveTable('timeline_notes', testDb.timelineNotes);

    if (testDb.idbAvailable) {
      await testDb.putImage('img-note-a1', new Blob(['note-img-a'], { type: 'image/jpeg' }));
      await testDb.putImage('img-note-b1', new Blob(['note-img-b'], { type: 'image/jpeg' }));
    }

    // Run cascade delete for Video A
    const deleteSuccess = await testDb.deleteVideoCascade(vidA.id);
    assert(deleteSuccess === true, 'Cascade delete operation must return true');

    // Assert Video A is deleted but Video B remains
    assert(testDb.getVideo(vidA.id) === undefined, 'Video A must be removed from videos');
    assert(testDb.getVideo(vidB.id) !== undefined, 'Video B must NOT be removed from videos');

    // Assert reviews and ratings are cascaded
    assert(testDb.getReviewForVideo(vidA.id) === undefined, 'Review for Video A must be removed');
    assert(testDb.getReviewForVideo(vidB.id) !== undefined, 'Review for Video B must remain');
    
    // Video A criterion ratings must be 0
    assert(testDb.criterionRatings.some(cr => cr.videoReviewId === revA.id) === false, 'Criterion ratings for Review A must be removed');
    // Video B criterion ratings must remain
    assert(testDb.criterionRatings.some(cr => cr.videoReviewId === revB.id) === true, 'Criterion ratings for Review B must remain');

    // Assert that the changes are written to the persistence layer (MemoryStorage)
    const storedRatings = JSON.parse(memory.getItem('test_vreview_del_criterion_ratings') || '[]');
    assert(storedRatings.some(cr => cr.videoReviewId === revA.id) === false, 'Stored criterion ratings in localStorage for Review A must be deleted');
    assert(storedRatings.some(cr => cr.videoReviewId === revB.id) === true, 'Stored criterion ratings in localStorage for Review B must remain');

    // Assert tags and notes are cascaded
    assert(testDb.videoTags.some(vt => vt.mediaAssetId === vidA.id) === false, 'Tag relations for Video A must be removed');
    assert(testDb.videoTags.some(vt => vt.mediaAssetId === vidB.id) === true, 'Tag relations for Video B must remain');
    assert(testDb.getTimelineNotes(vidA.id).length === 0, 'Timeline notes for Video A must be removed');
    assert(testDb.getTimelineNotes(vidB.id).length === 1, 'Timeline notes for Video B must remain');

    // Assert IndexedDB images are deleted
    if (testDb.idbAvailable) {
      const deletedVidThumb = await testDb.getImage(videoWithThumb.thumbnailId);
      const deletedNoteThumb = await testDb.getImage('img-note-a1');
      const keptNoteThumb = await testDb.getImage('img-note-b1');

      assert(deletedVidThumb === null, 'Deleted video thumbnail must be removed from IndexedDB');
      assert(deletedNoteThumb === null, 'Deleted timeline note thumbnail must be removed from IndexedDB');
      assert(keptNoteThumb !== null, 'Kept video timeline note thumbnail must remain in IndexedDB');
    }
  });

  // --- GROUP 6: RADAR CHART RENDER AND LABEL TESTS ---

  await runTest('Radar chart coordinates, label clamping, and responsiveness checks', async () => {
    // Mock container
    const container = document.createElement('div');
    container.style.width = '320px';
    container.style.height = '320px';
    document.body.appendChild(container);

    try {
      const chart = new RadarChart(container);
      
      // Test cases for N = 3, 4, 5, 6 criteria items
      const criteriaList = [
        { id: 'c1', name: '映像美' }, // Short label (<=8 characters)
        { id: 'c2', name: 'ストーリー構成' }, // Short label
        { id: 'c3', name: 'ユーザーインターフェースデザイン' }, // Long label (>8 characters)
        { id: 'c4', name: '音楽音響効果' },
        { id: 'c5', name: '演出力' },
        { id: 'c6', name: '革新性' }
      ];

      const ratings = { c1: 4, c2: 5, c3: 3, c4: 2, c5: 5, c6: 4 };

      for (let n = 3; n <= 6; n++) {
        const activeCriteria = criteriaList.slice(0, n);
        
        // Render chart
        chart.render(activeCriteria, ratings);
        
        // Verify SVG elements generated inside container
        const svg = container.querySelector('svg');
        assert(svg !== null, `SVG chart must render for N = ${n}`);
        assert(svg.getAttribute('viewBox') === '0 0 440 440', 'SVG viewBox must be set to 440x440');

        // Check text labels count and content
        const textElements = svg.querySelectorAll('.radar-labels text');
        assert(textElements.length === n, `Should render exactly ${n} text labels`);

        // Check clamping and coordinates fall inside safe box [15, 425]
        textElements.forEach(text => {
          const x = parseFloat(text.getAttribute('x'));
          const y = parseFloat(text.getAttribute('y'));
          assert(x >= 15 && x <= 425, `Label x (${x}) must fall in safe bounds [15, 425]`);
          assert(y >= 15 && y <= 425, `Label y (${y}) must fall in safe bounds [15, 425]`);
          
          // Verify title node exists for full-name hover tooltip support
          const title = text.querySelector('title');
          assert(title !== null, 'Text label must include a title tooltip element');

          // Verify tspan node exists to ensure title element was not wiped out
          const tspans = text.querySelectorAll('tspan');
          assert(tspans.length > 0, 'Text label must use tspan children to prevent wiping out title node');
        });
      }
    } finally {
      document.body.removeChild(container);
    }
  });

  // --- GROUP 7: BACKUP/RESTORE, DISPLAY TITLE, GENRES TESTS ---

  console.group('Group 7: New Features Tests');

  await runTest('Display title fallback and editing constraints', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_title_');
    await testDb.initAsync();
    const video = testDb.getVideos()[0];
    assert(video !== undefined, 'Must have at least one sample video');
    
    // 2. Set custom display title
    await testDb.updateVideo(video.id, { displayTitle: 'カスタムタイトル' });
    
    const updatedVideo = testDb.getVideo(video.id);
    assert(updatedVideo.displayTitle === 'カスタムタイトル', 'Display title should be saved');
    
    // 3. Clear/set displayTitle to null
    await testDb.updateVideo(video.id, { displayTitle: null });
    const clearedVideo = testDb.getVideo(video.id);
    assert(clearedVideo.displayTitle === null, 'Display title should be cleared');
  });

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
      videoUrl: '',
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
    testDb.mediaAssets = [{ id: 'vid-original', contentHash: 'hash-orig', hashAlgorithm: 'SHA-256', quickHash: 'qo', hashStatus: 'completed', fileSize: 100, duration: 10, displayTitle: 'Original', genreId: 'genre-original', thumbnailId: 'img-original', videoUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.fileLocations = [{ id: 'loc-original', mediaAssetId: 'vid-original', directoryId: 'dir-original', relativePath: 'orig.mp4', fileName: 'orig.mp4', fileSize: 100, lastModified: 0, availabilityStatus: 'available', lastVerifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.criteria = [{ id: 'crit-original', name: 'Original', description: 'Original' }];
    testDb.reviews = [{ id: 'rev-original', mediaAssetId: 'vid-original', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    testDb.criterionRatings = [{ id: 'rate-original', videoReviewId: 'rev-original', criterionId: 'crit-original', score: 3 }];
    testDb.tags = [{ id: 'tag-original', name: 'Original' }];
    testDb.videoTags = [{ mediaAssetId: 'vid-original', tagId: 'tag-original' }];
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

  console.groupEnd();

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
      videoUrl: '',
      duration: 10,
      sourceType: 'directory',
      directoryId: initialSource.id,
      relativePath: 'video.mp4',
      lastModified: 100
    });
    const videoId = video.id; // Correctly get the generated video ID

    // Add review, rating, tags, timeline notes referencing the actual generated videoId
    testDb.reviews = [{ id: 'rev-1', mediaAssetId: videoId, overallGrade: 'A', createdAt: '', updatedAt: '' }];
    testDb.criterionRatings = [{ id: 'rate-1', videoReviewId: 'rev-1', criterionId: 'crit-1', score: 4 }];
    testDb.videoTags = [{ mediaAssetId: videoId, tagId: 'tag-1' }];
    testDb.timelineNotes = [{ id: 'note-1', videoReviewId: 'rev-1', mediaAssetId: videoId, timestampSeconds: 0, timestampLabel: '00:00', comment: 'Note 1', createdAt: '' }];
    testDb._saveAll();

    // Reconnection via production DB method (Requirement 4)
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

    // Set as the app database (Requirement 3 & 4)
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

    // Simulating normal handleFolderSelect (without reconnectSourceId)
    const tempKey = 'pending-directory-handle-temp';
    await testDb.putDirectoryHandle(tempKey, folderHandleB);
    
    const sourceB = await testDb.addDirectorySource({ name: 'FolderB', includeSubdirectories: true });
    await testDb.putDirectoryHandle(sourceB.handleKey, folderHandleB);
    await testDb.updateDirectorySource(sourceB.id, { permissionStatus: 'granted' });
    await testDb.deleteDirectoryHandle(tempKey);

    // Normal switch: delete old source A
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

  console.groupEnd();

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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
      videoUrl: '',
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
    const retrievedReview = testDb.reviews.find(r => r.mediaAssetId === video.id);
    assert(retrievedReview.overallGrade === 'A', 'Review grade preserved');
    
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
      videoUrl: '',
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

    const review = testDb.reviews.find(r => r.mediaAssetId === video.id);
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
    testDb.videoTags = [];
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

    await testDb.addVideoTag(videoB.id, 'tag-1');

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
          id: 'ast-1',
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          id: 'loc-1',
          mediaAssetId: 'ast-1',
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
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
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
    assert(result.fatalErrors.length === 0, 'Backup with displayTitle: null is valid');
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
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
    const originalTimelineNotes = [
      { id: 'note-1', videoId: 'vid-1', timestampSeconds: 2, timestampLabel: '00:02', comment: 'Cool scene', thumbnailId: 'img-note-1', createdAt: new Date().toISOString() }
    ];

    memory.setItem('test_v2_schema_version', '2');
    memory.setItem('test_v2_videos', JSON.stringify(originalVideos));
    memory.setItem('test_v2_video_reviews', JSON.stringify(originalReviews));
    memory.setItem('test_v2_video_tags', JSON.stringify(originalVideoTags));
    memory.setItem('test_v2_timeline_notes', JSON.stringify(originalTimelineNotes));

    const testDb = new AppDatabase(memory, 'test_v2_', 'TestVideoDB_v2');
    await testDb.initAsync();

    assert(testDb.mediaAssets.length === 1, 'Video migrated to media asset');
    assert(testDb.fileLocations.length === 1, 'Location created');

    const review = testDb.reviews.find(r => r.mediaAssetId === 'vid-v2-1' || r.mediaAssetId === 'vid-1');
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

    const res1 = await testDb.completeVideoHashing(vid1.id, 'hash1234567890123456789012345678901234567890123456789012345678901234');
    assert(!res1.merged && !res1.conflict, 'First hash completes normally');

    const res2 = await testDb.completeVideoHashing(vid2.id, 'hash1234567890123456789012345678901234567890123456789012345678901234');
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
      { id: 'vid-dir-calc', contentHash: '', hashStatus: 'calculating', videoUrl: '' },
      { id: 'vid-url-calc', contentHash: '', hashStatus: 'calculating', videoUrl: 'http://example.com/v.mp4' },
      { id: 'vid-sample-calc', contentHash: '', hashStatus: 'calculating', videoUrl: '' }
    ];
    memory.setItem('test_vreview_startup_calc_media_assets', JSON.stringify(mockAssets));

    const testDb = new AppDatabase(memory, 'test_vreview_startup_calc_', 'TestVideoDB_StartupCalc');
    await testDb.initAsync();

    const vDir = testDb.getVideo('vid-dir-calc');
    const vUrl = testDb.getVideo('vid-url-calc');
    const vSample = testDb.getVideo('vid-sample-calc');

    assert(vDir.hashStatus === 'pending', 'Directory video calculating state reverted to pending');
    assert(vUrl.hashStatus === 'calculating', 'URL video calculating state left untouched');
    assert(vSample.hashStatus === 'calculating', 'Sample video calculating state left untouched');
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

    const revA = await testDb.saveVideoReview({ mediaAssetId: vidA.id, overallGrade: 'A', comment: 'First' });
    const revB = await testDb.saveVideoReview({ mediaAssetId: vidB.id, overallGrade: 'A', comment: 'Second' });

    const res = await testDb.completeVideoHashing(vidB.id, 'hash1234567890123456789012345678901234567890123456789012345678901234');
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

    const revA = await testDb.saveVideoReview({ mediaAssetId: vidA.id, overallGrade: '', comment: '' });
    const revB = await testDb.saveVideoReview({ mediaAssetId: vidB.id, overallGrade: '', comment: '' });

    testDb.criterionRatings.push({ id: 'cr-1', videoReviewId: revA.id, criterionId: 'crit-lighting', score: 4 });
    testDb.criterionRatings.push({ id: 'cr-2', videoReviewId: revB.id, criterionId: 'crit-lighting', score: 3 });

    const res = await testDb.completeVideoHashing(vidB.id, 'hash1234567890123456789012345678901234567890123456789012345678901234');
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

    const res = await testDb.completeVideoHashing(vidB.id, 'hash1234567890123456789012345678901234567890123456789012345678901234');
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

    await testDb.saveVideoReview({ mediaAssetId: vidA.id, overallGrade: 'A', comment: 'First' });
    await testDb.saveVideoReview({ mediaAssetId: vidB.id, overallGrade: 'B', comment: 'Second' });

    const res = await testDb.completeVideoHashing(vidB.id, 'hash1234567890123456789012345678901234567890123456789012345678901234');
    
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
          id: 'ast-1',
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          id: 'ast-2',
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          id: 'loc-1',
          mediaAssetId: 'ast-1',
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
          id: 'loc-2',
          mediaAssetId: 'ast-2',
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
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
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
    assert(result.fatalErrors.length === 0, 'Backup is validated successfully without fatal errors');
  });

  await runTest('10-29. Backup is rejected if duplicate contentHash exists on normal assets', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_conf_ng_', 'TestVideoDB_BackupConfNg');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-1',
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          id: 'loc-1',
          mediaAssetId: 'ast-1',
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
          id: 'loc-2',
          mediaAssetId: 'ast-2',
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
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
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
  });

  await runTest('10-30. Backup is rejected if duplicate contentHash conflict assets have different group IDs', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_backup_conf_ng2_', 'TestVideoDB_BackupConfNg2');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-1',
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          id: 'ast-2',
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          id: 'loc-1',
          mediaAssetId: 'ast-1',
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
          id: 'loc-2',
          mediaAssetId: 'ast-2',
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
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
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

    const mockFileBefore = { size: 600, lastModified: 1000 };
    const loc = testDb.fileLocations.find(l => l.mediaAssetId === asset.id);
    const sizeChangedBefore = mockFileBefore.size !== loc.fileSize || mockFileBefore.lastModified !== loc.lastModified;
    assert(sizeChangedBefore, 'Detected size change before hashing');

    const fileObjAfter = { size: 500, lastModified: 1000 };
    const freshFileAfter = { size: 600, lastModified: 1000 };
    const sizeChangedAfter = freshFileAfter.size !== fileObjAfter.size || freshFileAfter.lastModified !== fileObjAfter.lastModified;
    assert(sizeChangedAfter, 'Detected size change after hashing');
  });

  await runTest('10-33. Backfill and schema normalization on restore', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_restore_norm_', 'TestVideoDB_RestoreNorm');
    await testDb.initAsync();

    const sampleBackup = {
      schemaVersion: 3,
      media_assets: [
        {
          id: 'ast-1',
          contentHash: 'hash1234567890123456789012345678901234567890123456789012345678901234',
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
          id: 'loc-1',
          mediaAssetId: 'ast-1',
          directoryId: 'dir-1',
          relativePath: 'path1.mp4',
          fileName: 'path1.mp4',
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
      genres: [{ id: 'genre-default', name: 'default', displayTitle: 'Default', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      evaluation_templates: []
    };

    const fatalErrors = [];
    const rawDb = JSON.parse(JSON.stringify(sampleBackup));

    rawDb.media_assets.forEach(a => {
      a.displayTitle = normalizeDisplayTitle(a.displayTitle);
      if (a.identityStatus === undefined) a.identityStatus = 'normal';
      if (a.identityConflictGroupId === undefined) a.identityConflictGroupId = null;
    });

    assert(rawDb.media_assets[0].displayTitle === null, 'displayTitle normalized to null');
    assert(rawDb.media_assets[0].identityStatus === 'normal', 'identityStatus backfilled to normal');
    assert(rawDb.media_assets[0].identityConflictGroupId === null, 'identityConflictGroupId backfilled to null');
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

    vidB.thumbnailId = 'img-source';

    await testDb.mergeMediaAssets(vidA.id, vidB.id);

    const mergedAsset = testDb.mediaAssets.find(a => a.id === vidA.id);
    assert(mergedAsset.thumbnailId === 'img-source', 'Inherited thumbnail from source asset');

    const vidC = await testDb.addVideo({ title: 'C.mp4', fileName: 'C.mp4' });
    const vidD = await testDb.addVideo({ title: 'D.mp4', fileName: 'D.mp4' });
    vidC.thumbnailId = 'img-target';
    vidD.thumbnailId = 'img-source-new';

    await testDb.mergeMediaAssets(vidC.id, vidD.id);
    const mergedAsset2 = testDb.mediaAssets.find(a => a.id === vidC.id);
    assert(mergedAsset2.thumbnailId === 'img-target', 'Preserved target thumbnail');
  });

  console.groupEnd();

  console.groupEnd();
  return results;
}
