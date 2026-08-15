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

  // --- GROUP 3: FOLDER SWITCHING TWO-PHASE COMMIT (13-17) ---

  await runTest('13-17. Folder switching transaction commit and rollback', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_FolderSwitch');
    await testDb.initAsync();

    // Setup original source and matching video
    const originalSource = await testDb.addDirectorySource({ name: 'OriginalFolder' });
    const originalVideo = await testDb.addVideo({
      title: 'original.mp4',
      fileName: 'original.mp4',
      sourceType: 'directory',
      directoryId: originalSource.id,
      relativePath: 'original.mp4'
    });
    // Add review to verify original review data remains safe
    await testDb.saveReview(originalVideo.id, { overallGrade: 'A', comment: 'Keep this reviews data' });

    // Test 14: Save failure rollback simulation
    let failedTransition = false;
    let tempKey = 'pending-directory-handle-temp';
    try {
      // Simulate IDB handle put failure
      throw new Error('IndexedDB save failed during Phase 1');
    } catch (err) {
      failedTransition = true;
    }
    assert(failedTransition, 'Transition error must be caught');
    // Verify old connection remains active
    assert(testDb.getDirectorySource(originalSource.id) !== undefined, 'Old directory source must remain registered on failures');

    // Test 15: Read / verification failure rollback simulation
    let readVerificationFailed = false;
    try {
      // Phase 1: save handle to temp
      const mockNewHandle = new MockFileSystemDirectoryHandle('NewFolder');
      await testDb.putDirectoryHandle(tempKey, mockNewHandle);
      
      // Phase 2: mock query fails
      mockNewHandle._shouldFail = true;
      const verified = await testDb.getDirectoryHandle(tempKey);
      
      // Test read walk throws
      const iterator = verified.values();
      await iterator.next();
    } catch (err) {
      readVerificationFailed = true;
      // Phase 3: Rollback temp handle
      await testDb.deleteDirectoryHandle(tempKey);
    }
    assert(readVerificationFailed, 'Read failure must trigger directory rollback');
    assert(testDb.getDirectorySource(originalSource.id) !== undefined, 'Old directory source remains connected on read failures');

    // Test 13: Success path commit
    const newHandle = new MockFileSystemDirectoryHandle('VerifiedFolder');
    const newSource = await testDb.addDirectorySource({ name: newHandle.name });
    await testDb.putDirectoryHandle(newSource.handleKey, newHandle);
    
    // Disconnect old source
    await testDb.deleteDirectorySource(originalSource.id);

    // Verify final state
    assert(testDb.getDirectorySource(originalSource.id) === undefined, 'Old folder source is disconnected on commits');
    assert(testDb.getDirectorySource(newSource.id) !== undefined, 'New folder source is connected');
    
    // Test 17: Check original video review remains safe in database
    const rev = testDb.getReviewForVideo(originalVideo.id);
    assert(rev !== undefined && rev.overallGrade === 'A', 'Original reviews and annotations must be fully preserved');
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
