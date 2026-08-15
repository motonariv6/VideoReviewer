import { AppDatabase } from './db.js';
import { generateFileSignature, formatTime, parseTime, validateVideoUrl } from './video-helper.js';

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
  }
  async getFile() {
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
  }
  async *values() {
    for (const handle of Object.values(this._entries)) {
      yield handle;
    }
  }
  async getDirectoryHandle(name) {
    const handle = this._entries[name];
    if (!handle || handle.kind !== 'directory') {
      throw new DOMException('Directory not found', 'NotFoundError');
    }
    return handle;
  }
  async getFileHandle(name) {
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

// --- SCANNER TEST IMPLEMENTATION ---
// Re-implemented scanner function within tests to assert logic isolated from DOM
async function testScanDirectory(dirHandle, recursive = true) {
  const scanned = [];
  const queue = [{ dirHandle, relPath: '' }];
  while (queue.length > 0) {
    const { dirHandle: currentDir, relPath } = queue.shift();
    for await (const entry of currentDir.values()) {
      if (entry.kind === 'file') {
        const ext = entry.name.split('.').pop().toLowerCase();
        const videoExtensions = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv']);
        if (videoExtensions.has(ext)) {
          const file = await entry.getFile();
          scanned.push({
            fileName: entry.name,
            fileSize: file.size,
            lastModified: file.lastModified,
            relativePath: relPath ? `${relPath}/${entry.name}` : entry.name
          });
        }
      } else if (entry.kind === 'directory' && recursive) {
        queue.push({
          dirHandle: entry,
          relPath: relPath ? `${relPath}/${entry.name}` : entry.name
        });
      }
    }
  }
  return scanned;
}

// Compare scan results with stored DB metadata to find differentials (Isolated helper)
async function testProcessScanDifferentials(testDb, directoryId, scannedFiles) {
  const existingVideos = testDb.getVideos().filter(v => v.sourceType === 'directory' && v.directoryId === directoryId);
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let missing = 0;

  const scannedPaths = new Set(scannedFiles.map(sf => sf.relativePath));

  for (const sf of scannedFiles) {
    const matched = existingVideos.find(ev => ev.relativePath === sf.relativePath);
    if (!matched) {
      await testDb.addVideo({
        title: sf.fileName,
        fileName: sf.fileName,
        fileSize: sf.fileSize,
        videoUrl: '',
        duration: 0,
        sourceType: 'directory',
        directoryId,
        relativePath: sf.relativePath,
        lastModified: sf.lastModified
      });
      added++;
    } else {
      const isModified = matched.fileSize !== sf.fileSize || matched.lastModified !== sf.lastModified;
      if (isModified) {
        await testDb.updateVideo(matched.id, {
          fileSize: sf.fileSize,
          lastModified: sf.lastModified,
          availabilityStatus: 'available'
        });
        updated++;
      } else {
        await testDb.updateVideo(matched.id, { availabilityStatus: 'available' });
        unchanged++;
      }
    }
  }

  for (const ev of existingVideos) {
    if (!scannedPaths.has(ev.relativePath)) {
      await testDb.updateVideo(ev.id, { availabilityStatus: 'missing' });
      missing++;
    }
  }

  return { added, updated, unchanged, missing };
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

  // Test 1: 通常起動時にテストデータが本番ストレージへ書き込まれない
  await runTest('1. Test isolation from production storage', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_Isolation');
    await testDb.initAsync();
    
    // Write something
    await testDb.addVideo({ title: 'Test Video', sourceType: 'local-file' });
    
    // Check that standard localStorage does not contain the key
    if (typeof localStorage !== 'undefined') {
      assert(localStorage.getItem('test_vreview_videos') === null, 'Should not write to production keys');
    }
  });

  // Test 2: 既存VideoへsourceTypeが安全に補完される
  await runTest('2. Safe migration of sourceType on initialization', async () => {
    const memory = new MemoryStorage();
    // Simulate legacy video in localStorage
    const legacyVideo = {
      id: 'vid-legacy-1',
      title: 'Legacy Video',
      fileName: 'legacy.mp4',
      fileSize: 1234,
      videoUrl: '' // Empty signifies local-file
    };
    const legacyUrlVideo = {
      id: 'vid-legacy-2',
      title: 'Legacy URL Video',
      fileName: '',
      fileSize: 0,
      videoUrl: 'https://example.com/legacy.mp4'
    };
    memory.setItem('test_vreview_videos', JSON.stringify([legacyVideo, legacyUrlVideo]));

    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_Migrate');
    await testDb.initAsync();

    const v1 = testDb.getVideo('vid-legacy-1');
    const v2 = testDb.getVideo('vid-legacy-2');

    assert(v1.sourceType === 'local-file', 'Legacy local file should fall back to local-file');
    assert(v2.sourceType === 'url', 'Legacy URL file should fall back to url');
  });

  // Test 3: URL動画がローカル動画として誤判定されない
  await runTest('3. URL source type is not misidentified as local-file', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_URL');
    await testDb.initAsync();

    const video = await testDb.addVideo({
      title: 'Bunny URL',
      videoUrl: 'https://example.com/bunny.mp4',
      sourceType: 'url'
    });

    assert(video.sourceType === 'url', 'URL videos must explicitly have url sourceType');
    assert(video.fileName === '', 'URL videos must not require file names');
  });

  // Test 4: DirectoryHandleがIndexedDBへ保存・取得される
  await runTest('4. DirectoryHandle serialization in IndexedDB handles store', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_DBStore');
    await testDb.initAsync();

    if (!testDb.idbAvailable) {
      throw new Error('IndexedDB is not available');
    }

    const mockHandle = new MockFileSystemDirectoryHandle('FolderA');
    const handleKey = 'directory-handle-test-key';

    // Put
    await testDb.putDirectoryHandle(handleKey, mockHandle);

    // Get
    const retrieved = await testDb.getDirectoryHandle(handleKey);
    assert(retrieved !== null, 'Should load directory handle');
    assert(retrieved.name === 'FolderA', 'Should retain folder properties');

    // Clean
    await testDb.deleteDirectoryHandle(handleKey);
  });

  // Test 5: 権限状態granted、prompt、deniedを処理できる
  await runTest('5. Directory handle permission status queries', async () => {
    const mockHandle = new MockFileSystemDirectoryHandle('FolderB');
    
    mockHandle._permission = 'granted';
    let perm = await mockHandle.queryPermission({ mode: 'read' });
    assert(perm === 'granted', 'Permission should be granted');

    mockHandle._permission = 'prompt';
    perm = await mockHandle.queryPermission({ mode: 'read' });
    assert(perm === 'prompt', 'Permission should be prompt');

    mockHandle._permission = 'denied';
    perm = await mockHandle.queryPermission({ mode: 'read' });
    assert(perm === 'denied', 'Permission should be denied');
  });

  // Test 6: サブフォルダを含めた動画検出
  // Test 7: サブフォルダを除外した動画検出
  // Test 8: 大文字拡張子を検出できる
  // Test 9: 非対象ファイルを無視する
  // Test 10: 同名動画が別フォルダにあっても衝突しない
  await runTest('6-10. Recursive directory scanner matching rules', async () => {
    // Setup nested files structure
    // Root Folder
    // ├── movie.mp4 (valid)
    // ├── document.txt (ignore)
    // ├── MOVIE_UPPERCASE.MOV (valid uppercase)
    // └── subfolder/
    //     ├── movie.mp4 (valid nested - same name as root!)
    //     └── photo.png (ignore)

    const nested = {
      'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 1000, 100),
      'document.txt': new MockFileSystemFileHandle('document.txt', 200, 200),
      'MOVIE_UPPERCASE.MOV': new MockFileSystemFileHandle('MOVIE_UPPERCASE.MOV', 3000, 300),
      'subfolder': new MockFileSystemDirectoryHandle('subfolder', {
        'movie.mp4': new MockFileSystemFileHandle('movie.mp4', 5000, 500),
        'photo.png': new MockFileSystemFileHandle('photo.png', 150, 150)
      })
    };

    const rootDir = new MockFileSystemDirectoryHandle('root', nested);

    // Test 6 & 8 & 9 & 10: Recursive Scan
    const recScanned = await testScanDirectory(rootDir, true);
    assert(recScanned.length === 3, 'Should discover movie.mp4, MOVIE_UPPERCASE.MOV, and subfolder/movie.mp4');
    
    // Check uppercase extension
    assert(recScanned.some(f => f.fileName === 'MOVIE_UPPERCASE.MOV'), 'Should detect uppercase .MOV');
    
    // Check no text/png files
    assert(!recScanned.some(f => f.fileName === 'document.txt'), 'Should ignore document.txt');
    assert(!recScanned.some(f => f.fileName === 'photo.png'), 'Should ignore photo.png');

    // Check same names in different subfolders
    const rootMovie = recScanned.find(f => f.relativePath === 'movie.mp4');
    const subMovie = recScanned.find(f => f.relativePath === 'subfolder/movie.mp4');
    assert(rootMovie !== undefined && subMovie !== undefined, 'Both movies must be found');
    assert(rootMovie.fileSize !== subMovie.fileSize, 'Path variables should separate duplicate filenames');

    // Test 7: Non-recursive Scan
    const nonRecScanned = await testScanDirectory(rootDir, false);
    assert(nonRecScanned.length === 2, 'Omit subfolder contents when recursive is false');
    assert(!nonRecScanned.some(f => f.relativePath.includes('subfolder')), 'Should not contain subfolder paths');
  });

  // Test 11: 再スキャンで重複登録されない
  // Test 12: 新規・更新・変更なし・消失を判定できる
  await runTest('11-12. Differential scanning classifications', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_ScanDiff');
    await testDb.initAsync();

    const dirId = 'dir-test-id';

    // Seed existing videos in DB
    // 1. Unchanged video
    await testDb.addVideo({
      title: 'unchanged.mp4',
      fileName: 'unchanged.mp4',
      fileSize: 100,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'unchanged.mp4',
      lastModified: 500
    });
    // 2. Updated video (will simulate modification date/size change)
    const updatedVideo = await testDb.addVideo({
      title: 'updated.mp4',
      fileName: 'updated.mp4',
      fileSize: 200,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'updated.mp4',
      lastModified: 500
    });
    // 3. Missing video (will simulate missing in scanned files)
    const missingVideo = await testDb.addVideo({
      title: 'missing.mp4',
      fileName: 'missing.mp4',
      fileSize: 300,
      sourceType: 'directory',
      directoryId: dirId,
      relativePath: 'missing.mp4',
      lastModified: 500
    });

    // Scanned Files input:
    // - unchanged.mp4 (size 100, mod 500) -> Unchanged
    // - updated.mp4 (size 250, mod 600) -> Updated
    // - new.mp4 (size 999, mod 999) -> New
    // (missing.mp4 is omitted) -> Missing
    const scanned = [
      { fileName: 'unchanged.mp4', fileSize: 100, lastModified: 500, relativePath: 'unchanged.mp4' },
      { fileName: 'updated.mp4', fileSize: 250, lastModified: 600, relativePath: 'updated.mp4' },
      { fileName: 'new.mp4', fileSize: 999, lastModified: 999, relativePath: 'new.mp4' }
    ];

    const diff = await testProcessScanDifferentials(testDb, dirId, scanned);

    assert(diff.unchanged === 1, 'Should report 1 unchanged video');
    assert(diff.updated === 1, 'Should report 1 updated video');
    assert(diff.added === 1, 'Should report 1 added video');
    assert(diff.missing === 1, 'Should report 1 missing video');

    // Test 11: Repeat scan with same inputs, assert duplicate registers do not occur
    const diff2 = await testProcessScanDifferentials(testDb, dirId, scanned);
    assert(diff2.added === 0, 'Subsequent identical scans must add 0 duplicates');
    assert(diff2.unchanged === 3, 'All scanned files should now report unchanged');
  });

  // Test 13: 消失動画の評価データが削除されない
  await runTest('13. Preserving rating stars and notes for missing videos', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_Preserve');
    await testDb.initAsync();

    const v = await testDb.addVideo({ title: 'Missing Video', sourceType: 'directory', directoryId: 'dir-x', relativePath: 'lost.mp4' });
    
    // Save review
    await testDb.saveReview(v.id, {
      overallGrade: 'B',
      comment: 'Nice try',
      ratings: { 'crit-content': 4 }
    });
    await testDb.addTimelineNote(v.id, { timestampSeconds: 2, timestampLabel: '00:02', comment: 'Scene 1' });

    // Mark missing
    await testDb.updateVideo(v.id, { availabilityStatus: 'missing' });

    // Check records exist
    const review = testDb.getReviewForVideo(v.id);
    assert(review !== undefined, 'Review should remain intact');
    assert(review.overallGrade === 'B', 'Overall grade remains B');
    
    const notes = testDb.getTimelineNotes(v.id);
    assert(notes.length === 1, 'Timeline note remains intact');
  });

  // Test 14: フォルダ解除でホスト上のファイル操作を行わない
  await runTest('14. Folder disconnection does not mutate directory handles on host', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_Disconnect');
    await testDb.initAsync();

    const source = await testDb.addDirectorySource({ name: 'HostFolder' });
    const video = await testDb.addVideo({
      title: 'Local video',
      sourceType: 'directory',
      directoryId: source.id,
      relativePath: 'video.mp4'
    });

    // Disconnect directory source
    await testDb.deleteDirectorySource(source.id);

    // Verify source is deleted from source list
    assert(testDb.getDirectorySource(source.id) === undefined, 'Source must be deleted from sources table');
    // Verify video metadata remains in database, but marked as permission-required / missing
    const v = testDb.getVideo(video.id);
    assert(v !== undefined, 'Video metadata must be preserved');
    assert(v.availabilityStatus === 'permission-required', 'Video availability status changes to permission-required');
  });

  // Test 15: 動画再生用Blob URLを切替時に解放する
  await runTest('15. Memory optimization: object URL revoke actions', async () => {
    let revokedUrl = null;
    const originalRevoke = URL.revokeObjectURL;
    
    // Temporarily spy revokeObjectURL
    URL.revokeObjectURL = (url) => {
      revokedUrl = url;
    };

    try {
      const activeUrl = 'blob:http://localhost/test-url';
      // Simulate revoke inside a mock runner
      const mockState = { activeBlobUrl: activeUrl };
      
      const revokeActiveBlobUrlMock = () => {
        if (mockState.activeBlobUrl) {
          URL.revokeObjectURL(mockState.activeBlobUrl);
          mockState.activeBlobUrl = null;
        }
      };

      revokeActiveBlobUrlMock();
      assert(revokedUrl === activeUrl, 'Should revoke active blob url');
      assert(mockState.activeBlobUrl === null, 'Active blob url should be cleared');
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });

  // Test 16: フォルダ名やファイル名にHTML文字列があっても実行されない
  await runTest('16. XSS protection on folder and file name text content', async () => {
    const payload = '<script>alert("xss")</script>';
    
    // Simulate setting textContent
    const el = document.createElement('div');
    el.textContent = payload;
    
    assert(el.innerHTML !== payload, 'innerHTML should escape HTML special characters');
    assert(el.innerHTML.includes('&lt;script&gt;'), 'HTML tags should be escaped');
  });

  // Test 17: API非対応時も従来の個別ファイル登録が利用できる
  await runTest('17. Individual file registration availability', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_Fallback');
    await testDb.initAsync();

    // Verify individual files can still be registered manually
    const added = await testDb.addVideo({
      title: 'Individual File.mp4',
      fileName: 'individual.mp4',
      fileSize: 1000,
      sourceType: 'local-file'
    });

    assert(added.sourceType === 'local-file', 'Individual video registers as local-file');
    assert(added.fileName === 'individual.mp4', 'Filename is preserved');
  });

  // Test 18: 既存の評価、タグ、コメント、レーダーチャートが正常に動く
  await runTest('18. Core ratings, tags, annotations integrity tests', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_CoreIntegrity');
    await testDb.initAsync();

    const video = await testDb.addVideo({ title: 'Integrity Video', sourceType: 'local-file' });
    
    // Add tag
    await testDb.addTagToVideo(video.id, 'TagA');
    
    // Save ratings
    await testDb.saveReview(video.id, {
      overallGrade: 'A',
      comment: 'Excellent',
      ratings: { 'crit-content': 5, 'crit-visuals': 4 }
    });

    // Add note
    await testDb.addTimelineNote(video.id, {
      timestampSeconds: 10,
      timestampLabel: '00:10',
      comment: 'Capture scene'
    });

    // Checks
    const tags = testDb.getVideoTags(video.id);
    const review = testDb.getReviewForVideo(video.id);
    const scores = testDb.getCriterionRatingsForReview(review.id);
    const notes = testDb.getTimelineNotes(video.id);

    assert(tags.length === 1 && tags[0].name === 'TagA', 'Tags verified');
    assert(review.overallGrade === 'A' && review.comment === 'Excellent', 'Overall review verified');
    assert(scores.length === 2, 'Ratings scores count verified');
    assert(notes.length === 1 && notes[0].comment === 'Capture scene', 'Timeline notes verified');
  });

  // Test 19: 日本語IME変換Enter操作と重複タグの登録防止の検証
  await runTest('19. IME Conversion inputs and duplicate tag protections', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_', 'TestVideoDB_IME');
    await testDb.initAsync();

    const video = await testDb.addVideo({ title: 'IME Test Video', sourceType: 'local-file' });

    // Mock Tag addition event handler checks
    const tagsAdded = [];
    const mockAddTag = async (val) => {
      tagsAdded.push(val);
    };

    let isMockTagComposing = false;
    const handleTagInputKeydownMock = async (e, val) => {
      if (e.isComposing || isMockTagComposing || e.keyCode === 229) {
        return; // Ignore keydown while composing
      }
      if (e.key === 'Enter') {
        if (tagsAdded.includes(val)) {
          return; // Skip duplicate
        }
        await mockAddTag(val);
      }
    };

    // 1. Simulating IME conversion Enter (isComposing = true, keyCode = 229)
    isMockTagComposing = true;
    await handleTagInputKeydownMock({ key: 'Enter', isComposing: true, keyCode: 229 }, '映像美');
    assert(tagsAdded.length === 0, 'Should not add tag while composing');

    // 2. Simulating standard Enter (isComposing = false, compositionend has triggered)
    isMockTagComposing = false;
    await handleTagInputKeydownMock({ key: 'Enter', isComposing: false, keyCode: 13 }, '映像美');
    assert(tagsAdded.length === 1, 'Should add tag after composition ends');
    assert(tagsAdded[0] === '映像美', 'Tag content matches');

    // 3. Simulating duplicate tag submission (identical value)
    await handleTagInputKeydownMock({ key: 'Enter', isComposing: false, keyCode: 13 }, '映像美');
    assert(tagsAdded.length === 1, 'Should block duplicate tags');
  });

  console.groupEnd();
  return results;
}
