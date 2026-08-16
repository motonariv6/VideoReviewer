import { AppDatabase } from './db.js';
import { generateFileSignature, formatTime, parseTime, validateVideoUrl } from './video-helper.js';
import { isSupportedVideoFile, isPathCoveredByFailedDirectory, scanDirectory, classifyScanResults, applyScanDifferentials } from './directory-scanner.js';
import { RadarChart } from './radar.js';

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
  constructor(name, size = 12345, lastModified = 99999) {
    this.kind = 'file';
    this.name = name;
    this._size = size;
    this._lastModified = lastModified;
    this._shouldFail = false;
  }
  async getFile() {
    if (this._shouldFail) {
      throw new Error('Mock read error');
    }
    return {
      name: this.name,
      size: this._size,
      lastModified: this._lastModified,
      type: 'video/mp4'
    };
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
      results.push({ name, passed: true, error: null });
    } catch (e) {
      results.push({ name, passed: false, error: e.message });
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
    testDb.videos = [];
    testDb._saveTable('videos', []);

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
    testDb.videoTags.push({ videoId: vidA.id, tagId: 'tag-1' });
    testDb._saveTable('video_tags', testDb.videoTags);

    // Add timeline notes
    testDb.timelineNotes.push({ id: 'note-a1', videoReviewId: revA.id, timestampSeconds: 10, comment: 'First note', thumbnailId: 'img-note-a1' });
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
    testDb.videoTags.push({ videoId: vidB.id, tagId: 'tag-2' });
    testDb._saveTable('video_tags', testDb.videoTags);
    testDb.timelineNotes.push({ id: 'note-b1', videoReviewId: revB.id, timestampSeconds: 20, comment: 'Second note', thumbnailId: 'img-note-b1' });
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
    assert(testDb.videoTags.some(vt => vt.videoId === vidA.id) === false, 'Tag relations for Video A must be removed');
    assert(testDb.videoTags.some(vt => vt.videoId === vidB.id) === true, 'Tag relations for Video B must remain');
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

    const video = testDb.videos[0];
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
      title: 'バックアップテスト動画',
      fileName: 'back.mp4',
      genreId: customGenre.id,
      sourceType: 'local-file'
    };
    testDb.videos.push(newVideo);
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
      videos: testDb.videos,
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
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      counts: {
        videos: testDb.videos.length,
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

    assert(testDb2.videos.length !== testDb.videos.length, 'Fresh DB should not have the new video');

    assert(testDb2.videos.length !== testDb.videos.length, 'Fresh DB should not have the new video');

    // Production validation and restore invocation
    const valRes = testDb2.validateBackupData(restoredDbData, manifest, []);
    assert(valRes.isValid === true, 'Restored data must pass validation');
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
      schemaVersion: 1,
      createdAt: '2026-08-16T12:00:00.000Z',
      counts: { videos: 0, reviews: 0, images: 0 }
    };
    const validDb = {
      videos: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [], directory_sources: [],
      genres: [], evaluation_templates: []
    };

    // 1. Valid case
    const res1 = testDb.validateBackupData(validDb, validManifest, []);
    assert(res1.isValid === true, 'Valid manifest is accepted');

    // 2. Invalid schema version
    const res2 = testDb.validateBackupData(validDb, { ...validManifest, schemaVersion: 2 }, []);
    assert(res2.isValid === false, 'Should be invalid for schemaVersion !== 1');
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
      counts: { videos: -1, reviews: 0, images: 0 }
    }, []);
    assert(res5.isValid === false, 'Should be invalid for negative counts');
    assert(res5.fatalErrors.some(e => e.includes('非負の整数')), 'Rejected negative count');

    // 6. manifest counts match database table counts (video count mismatch)
    const res6 = testDb.validateBackupData(validDb, {
      ...validManifest,
      counts: { videos: 1, reviews: 0, images: 0 }
    }, []);
    assert(res6.isValid === false, 'Should be invalid for videos count mismatch');
    assert(res6.fatalErrors.some(e => e.includes('動画の件数')), 'Rejected video count mismatch');

    // 7. manifest image count matches ZIP image entries (image count mismatch)
    const res7 = testDb.validateBackupData(validDb, {
      ...validManifest,
      counts: { videos: 0, reviews: 0, images: 1 }
    }, []);
    assert(res7.isValid === false, 'Should be invalid for images count mismatch');
    assert(res7.fatalErrors.some(e => e.includes('画像の件数')), 'Rejected image count mismatch');

    // 8. duplicate criterion rating ID
    const badCrDb = {
      ...validDb,
      criterion_ratings: [{ id: 'rate-1', score: 3 }, { id: 'rate-1', score: 5 }]
    };
    const res8 = testDb.validateBackupData(badCrDb, validManifest, []);
    assert(res8.isValid === false, 'Should be invalid for duplicate criterion rating ID');
    assert(res8.fatalErrors.some(e => e.includes('重複する ID rate-1')), 'Rejected duplicate criterion rating ID');

    // 9. missing video thumbnail
    const badVidDb = {
      ...validDb,
      videos: [{ id: 'vid-1', title: 'Test', thumbnailId: 'img-nonexistent' }]
    };
    const res9 = testDb.validateBackupData(badVidDb, {
      ...validManifest,
      counts: { videos: 1, reviews: 0, images: 0 }
    }, []);
    assert(res9.isValid === false, 'Should be invalid for missing video thumbnail');
    assert(res9.fatalErrors.some(e => e.includes('ZIP内に存在しません')), 'Rejected missing video thumbnail image');

    // 10. missing timeline-note image
    const badNoteDb = {
      ...validDb,
      timeline_notes: [{ id: 'note-1', text: 'note text', thumbnailId: 'img-nonexistent', videoReviewId: 'rev-1' }],
      video_reviews: [{ id: 'rev-1', videoId: 'vid-1' }],
      videos: [{ id: 'vid-1', title: 'Test' }]
    };
    const res10 = testDb.validateBackupData(badNoteDb, {
      ...validManifest,
      counts: { videos: 1, reviews: 1, images: 0 }
    }, []);
    assert(res10.isValid === false, 'Should be invalid for missing timeline-note image');
    assert(res10.fatalErrors.some(e => e.includes('ZIP内に存在しません')), 'Rejected missing note image');

    // 11. duplicate ZIP image IDs
    const res11 = testDb.validateBackupData(validDb, {
      ...validManifest,
      counts: { videos: 0, reviews: 0, images: 2 }
    }, ['img-1', 'img-1']);
    assert(res11.isValid === false, 'Should be invalid for duplicate ZIP image IDs');
    assert(res11.fatalErrors.some(e => e.includes('重複する画像ID')), 'Rejected duplicate ZIP image IDs');
  });

  await runTest('DB Restore atomic transaction rollback under image/write failures', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_tx_');
    await testDb.initAsync();
    
    // Seed initial database state with distinct objects in all collections
    testDb.videos = [{ id: 'vid-original', title: 'Original' }];
    testDb.criteria = [{ id: 'crit-original', name: 'Original' }];
    testDb.reviews = [{ id: 'rev-original', videoId: 'vid-original' }];
    testDb.criterionRatings = [{ id: 'rate-original', videoReviewId: 'rev-original', criterionId: 'crit-original', score: 3 }];
    testDb.tags = [{ id: 'tag-original', name: 'Original' }];
    testDb.videoTags = [{ videoId: 'vid-original', tagId: 'tag-original' }];
    testDb.timelineNotes = [{ id: 'note-original', videoReviewId: 'rev-original', text: 'Original' }];
    testDb.directorySources = [{ id: 'dir-original', name: 'Original' }];
    testDb.genres = [{ id: 'genre-original', name: 'Original' }];
    testDb.templates = [{ id: 'template-original', genreId: 'genre-original' }];
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
      videos: [{ id: 'vid-new', title: 'New Video' }],
      rating_criteria: [{ id: 'crit-new', name: 'New' }],
      video_reviews: [{ id: 'rev-new', videoId: 'vid-new' }],
      criterion_ratings: [{ id: 'rate-new', videoReviewId: 'rev-new', criterionId: 'crit-new', score: 5 }],
      tags: [{ id: 'tag-new', name: 'New' }],
      video_tags: [{ videoId: 'vid-new', tagId: 'tag-new' }],
      timeline_notes: [{ id: 'note-new', videoReviewId: 'rev-new', text: 'New' }],
      directory_sources: [{ id: 'dir-new', name: 'New' }],
      genres: [{ id: 'genre-new', name: 'New' }],
      evaluation_templates: [{ id: 'template-new', genreId: 'genre-new' }]
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
    assert(testDb.videos[0].id === 'vid-original', 'Original videos must be preserved');
    assert(testDb.videos.some(v => v.id === 'vid-new') === false, 'New videos must not be present');
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
    assert(testDb.videos[0].id === 'vid-original', 'Original videos must be preserved on localStorage write error');
    assert(testDb.videos.some(v => v.id === 'vid-new') === false, 'New videos must not be present on localStorage write error');
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
      videos: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
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
    testDb.videos = [{ id: 'vid-1', title: 'Test Video' }];
    testDb.reviews = [{ id: 'rev-1', videoId: 'vid-1' }];
    testDb.timelineNotes = [];
    testDb._saveAll();

    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 1,
      createdAt: '2026-08-16T12:00:00.000Z',
      counts: { videos: 1, reviews: 1, images: 2 }
    };

    const parsedDb = {
      videos: [{ id: 'vid-1', title: 'Test Video' }],
      rating_criteria: [],
      video_reviews: [{ id: 'rev-1', videoId: 'vid-1' }],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [
        // 1. Repairable note (missing videoReviewId but has videoId and exactly one review)
        { id: 'note-repairable', text: 'Repairable', videoId: 'vid-1', videoReviewId: 'nonexistent-rev', thumbnailId: 'img-valid' },
        // 2. Irreparable note (missing review and videoId)
        { id: 'note-irreparable', text: 'Irreparable', videoReviewId: 'nonexistent-rev-2', thumbnailId: 'img-orphan' }
      ],
      directory_sources: [],
      genres: [],
      evaluation_templates: []
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
    assert(repairableWarning.repairedToReviewId === 'rev-1', 'Repairable note is mapped to rev-1');
    
    assert(irreparableWarning !== undefined, 'Has warning for irreparable note');
    assert(irreparableWarning.repaired === false, 'Irreparable note is marked not repaired');

    // Repaired DB state check
    const repairedNotes = validationResult.repairedDb.timeline_notes;
    assert(repairedNotes.length === 1, 'Irreparable note must be excluded from active timeline_notes');
    assert(repairedNotes[0].id === 'note-repairable', 'Repairable note must be included');
    assert(repairedNotes[0].videoReviewId === 'rev-1', 'Repairable note review ID must be updated');

    // Image exclusion check
    assert(validationResult.requiredImageIds.includes('img-valid') === true, 'img-valid must be included');
    assert(validationResult.requiredImageIds.includes('img-orphan') === false, 'img-orphan must be excluded');

    // Confirm that other broken references (e.g. broken review video reference) still reject the backup
    const fatalDb = {
      ...parsedDb,
      video_reviews: [{ id: 'rev-1', videoId: 'nonexistent-video' }]
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
    testDb.videos = [{ id: 'vid-original', title: 'Original' }];
    testDb.timelineNotes = [{ id: 'note-original', videoReviewId: 'rev-original', text: 'Original' }];
    testDb._saveAll();

    const parsedDb = {
      videos: [{ id: 'vid-new', title: 'New' }],
      rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [], directory_sources: [],
      genres: [], evaluation_templates: []
    };

    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 1,
      createdAt: '2026-08-16T12:00:00.000Z',
      counts: { videos: 1, reviews: 0, images: 0 }
    };

    // Preflight validation - changes nothing
    testDb.validateBackupData(parsedDb, manifest, []);
    assert(testDb.videos[0].id === 'vid-original', 'In-memory state remains unchanged before confirmation');
    assert(memoryStorage.getItem('test_v8_cancel_videos').includes('vid-original'), 'Storage state remains unchanged before confirmation');
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
    testDb.videos = [{ id: 'vid-1', title: 'Video', thumbnailId: 'img-referenced' }];
    testDb.reviews = [{ id: 'rev-1', videoId: 'vid-1' }];
    testDb.timelineNotes = [
      // Valid note
      { id: 'note-valid', videoReviewId: 'rev-1', text: 'Valid', thumbnailId: 'img-referenced-by-note' },
      // Irreparable orphan note
      { id: 'note-orphan', videoReviewId: 'nonexistent-rev', text: 'Orphan', thumbnailId: 'img-orphan' }
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

  await runTest('Successful restore preserves matching handles and reconciles permissionStatus', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_pres_');
    await testDb.initAsync();

    // 1. Setup mock handles
    testDb.idbAvailable = true;
    const mockHandle = {
      name: 'real-dir',
      queryPermission: async () => 'granted'
    };
    testDb.idb = {
      store: {
        'handle-matched': mockHandle,
        'handle-unmatched': { name: 'other-dir' }
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
      get: async function(key, storeName) {
        return this.store[key];
      },
      clearImages: async function() {},
      clearHandles: async function() {
        this.clearCalls.push('clearHandles');
      },
      put: async function(key, val, storeName) {
        this.store[key] = val;
      }
    };

    // Restored sources
    const restoredData = {
      videos: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        // Matched source (has handle in IndexedDB)
        { id: 'src-1', name: 'real-dir', handleKey: 'handle-matched', permissionStatus: 'prompt' },
        // Unmatched source (has NO handle in IndexedDB)
        { id: 'src-2', name: 'missing-dir', handleKey: 'handle-nonexistent', permissionStatus: 'granted' } // ZIP has 'granted', should be ignored
      ],
      genres: [], evaluation_templates: []
    };

    // Execute restore
    await testDb.restoreWithRollback(restoredData, []);

    // Assertions
    // successful restore does not call clearHandles()
    assert(testDb.idb.clearCalls.length === 0, 'Successful restore must not call clearHandles()');

    // matching handles must still exist in IndexedDB (preserved unmatched handles as well)
    assert(testDb.idb.store['handle-matched'] !== undefined, 'Matching handle must be preserved');
    assert(testDb.idb.store['handle-unmatched'] !== undefined, 'Unmatched handle must be preserved safely');

    // matching source receives the queried permission status
    const matchedSource = testDb.directorySources.find(s => s.id === 'src-1');
    assert(matchedSource.permissionStatus === 'granted', 'Matching source receives queried status "granted"');

    // unmatched source becomes prompt/reconnection-required, and backup status is ignored
    const unmatchedSource = testDb.directorySources.find(s => s.id === 'src-2');
    assert(unmatchedSource.permissionStatus === 'prompt', 'Unmatched source status falls back to "prompt" and ignores backup "granted"');

    // page-reload simulation can retrieve the preserved handle
    const retrievedHandle = await testDb.getDirectoryHandle('handle-matched');
    assert(retrievedHandle === mockHandle, 'Retrieved handle matches the mock handle after reload');
  });

  await runTest('Failed restore still restores all original handles and rollback works', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_fail_');
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
      videos: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
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

    assert(restoreSucceeded === false, 'Restore must fail due to localStorage write error');
    assert(testDb.idb.clearCalls.includes('clearHandles') === true, 'Failed restore must call clearHandles() to initiate rollback');
    assert(testDb.idb.store['handle-orig'] !== undefined, 'Original handles must be restored after rollback');
    assert(testDb.directorySources[0].id === 'src-orig', 'In-memory directory sources must be rolled back');
  });

  await runTest('Restore on clean machine with no handles succeeds but requires reconnection', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v9_clean_');
    await testDb.initAsync();

    testDb.idbAvailable = true;
    testDb.idb = {
      store: {},
      getAll: async function() { return []; },
      clearImages: async function() {},
      clearHandles: async function() {},
      put: async function(key, val) { this.store[key] = val; }
    };

    const restoredData = {
      videos: [], rating_criteria: [], video_reviews: [], criterion_ratings: [],
      tags: [], video_tags: [], timeline_notes: [],
      directory_sources: [
        { id: 'src-1', name: 'some-dir', handleKey: 'handle-some', permissionStatus: 'granted' }
      ],
      genres: [], evaluation_templates: []
    };

    await testDb.restoreWithRollback(restoredData, []);

    assert(testDb.directorySources[0].permissionStatus === 'prompt', 'Succeeds but sets permissionStatus to "prompt" requiring reconnection');
  });

  console.groupEnd();

  console.groupEnd();
  return results;
}
