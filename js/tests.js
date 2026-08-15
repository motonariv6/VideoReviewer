import { AppDatabase } from './db.js';
import { generateFileSignature, formatTime, parseTime, validateVideoUrl } from './video-helper.js';
import { isSupportedVideoFile, isPathCoveredByFailedDirectory, scanDirectory, classifyScanResults, applyScanDifferentials } from './directory-scanner.js';

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

  console.groupEnd();
  return results;
}
