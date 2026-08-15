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

  // Test 1: Time conversion helpers
  await runTest('Time conversion helpers', async () => {
    assert(formatTime(0) === '00:00', 'formatTime(0) should be 00:00');
    assert(formatTime(65) === '01:05', 'formatTime(65) should be 01:05');
    assert(formatTime(3605) === '01:00:05', 'formatTime(3605) should be 01:00:05');
    assert(parseTime('00:00') === 0, 'parseTime(00:00) should be 0');
    assert(parseTime('01:05') === 65, 'parseTime(01:05) should be 65');
    assert(parseTime('01:00:05') === 3605, 'parseTime(01:00:05) should be 3605');
  });

  // Test 2: File signature generation
  await runTest('File signature generation', async () => {
    const dummyFile1 = { name: 'holiday.mp4', size: 1234567, lastModified: 987654321 };
    const sig1 = generateFileSignature(dummyFile1);
    assert(sig1.includes('holiday_mp4'), 'Signature should clean name');
    assert(sig1.includes('1234567'), 'Signature should contain file size');
    
    const dummyFile2 = { name: 'holiday.mp4', size: 1234567, lastModified: 987654321 };
    const sig2 = generateFileSignature(dummyFile2);
    assert(sig1 === sig2, 'Identical file metadata must produce matching signatures');
  });

  // Test 3: Database operations sandbox (isolated to memory storage)
  await runTest('Database CRUD operations (Isolated in memory)', async () => {
    const testDb = new AppDatabase(new MemoryStorage(), 'test_vreview_', 'TestVideoDB_CRUD');
    await testDb.initAsync();
    
    // Add video
    const video = await testDb.addVideo({
      title: 'Unit Test Clip',
      fileName: 'unittest.mp4',
      fileSize: 9999,
      videoUrl: '',
      duration: 30
    });
    assert(video.id.startsWith('vid-'), 'Video ID should have vid prefix');
    assert(video.title === 'Unit Test Clip', 'Video title should match input');

    // Save review
    const ratings = { 'crit-content': 5, 'crit-visuals': 3 };
    await testDb.saveReview(video.id, {
      overallGrade: 'A',
      comment: 'Excellent video!',
      ratings
    });

    const review = testDb.getReviewForVideo(video.id);
    assert(review !== undefined, 'Review should be saved');
    assert(review.overallGrade === 'A', 'Overall grade should be A');
    assert(review.comment === 'Excellent video!', 'Comment should match');

    const scores = testDb.getCriterionRatingsForReview(review.id);
    assert(scores.length === 2, 'Should save exactly 2 ratings');
    assert(scores.find(s => s.criterionId === 'crit-content').score === 5, 'Content score should be 5');

    // Timeline notes ordering
    await testDb.addTimelineNote(video.id, {
      timestampSeconds: 15,
      timestampLabel: '00:15',
      comment: 'Middle scene'
    });
    await testDb.addTimelineNote(video.id, {
      timestampSeconds: 5,
      timestampLabel: '00:05',
      comment: 'Beginning scene'
    });

    const notes = testDb.getTimelineNotes(video.id);
    assert(notes.length === 2, 'Should have 2 timeline notes');
    assert(notes[0].timestampSeconds === 5, 'Notes should be sorted chronologically');
    assert(notes[1].timestampSeconds === 15, 'Notes should be sorted chronologically');

    // Tags
    await testDb.addTagToVideo(video.id, 'UnitTest');
    await testDb.addTagToVideo(video.id, 'TestTag');
    
    let tags = testDb.getVideoTags(video.id);
    assert(tags.length === 2, 'Video should have 2 tags');
    assert(tags.some(t => t.name === 'UnitTest'), 'Tags should contain UnitTest');

    // Tag removal (BUG FIX: using testDb instead of production db)
    await testDb.removeTagFromVideo(video.id, tags[0].id);
    tags = testDb.getVideoTags(video.id);
    assert(tags.length === 1, 'Video should have 1 tag after removal');
  });

  // Test 4: Criteria Management
  await runTest('Criteria settings management (Isolated in memory)', async () => {
    const testDb = new AppDatabase(new MemoryStorage(), 'test_vreview_', 'TestVideoDB_Criteria');
    await testDb.initAsync();
    
    const countBefore = testDb.getActiveCriteria().length;
    if (countBefore < 6) {
      const newCrit = await testDb.addCriterion('テスト項目');
      assert(testDb.getActiveCriteria().length === countBefore + 1, 'Criteria count should increase');
      
      await testDb.deleteCriterion(newCrit.id);
      assert(testDb.getActiveCriteria().length === countBefore, 'Criteria count should return to previous size');
      assert(testDb.criteria.find(c => c.id === newCrit.id).isActive === false, 'Criterion should be deactivated');
    }
  });

  // Test 5: Strict URL Protocol Rejection
  await runTest('Strict Video URL Protocol Validation', async () => {
    // Valid URLs
    validateVideoUrl('https://example.com/movie.mp4');
    validateVideoUrl('http://localhost:8000/movie.mp4');
    
    // Invalid URLs (should throw)
    let threw = false;
    try {
      validateVideoUrl('javascript:alert(1)');
    } catch (e) {
      threw = true;
      assert(e.message.includes('プロトコル'), 'Should indicate protocol error');
    }
    assert(threw, 'javascript: URL should be rejected');

    threw = false;
    try {
      validateVideoUrl('data:text/html,<script>alert(1)</script>');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'data: URL should be rejected');

    threw = false;
    try {
      validateVideoUrl('file:///C:/video.mp4');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'file: URL should be rejected');

    threw = false;
    try {
      validateVideoUrl('   ');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'Empty URL should be rejected');
  });

  // Test 6: IndexedDB Read / Write Integrity
  await runTest('IndexedDB image storage and retrieval', async () => {
    const testDb = new AppDatabase(new MemoryStorage(), 'test_vreview_', 'TestVideoDB_Integrity');
    await testDb.initAsync();
    
    if (!testDb.idbAvailable) {
      throw new Error('IndexedDB is not available or blocked in this browser sandbox');
    }

    const testBlob = new Blob(['test-binary-data'], { type: 'image/jpeg' });
    const testId = 'img-test-integrity-key';
    
    // Clean old
    try {
      await testDb.idb.delete(testId);
    } catch (e) {}

    // Put
    await testDb.putImage(testId, testBlob);

    // Get
    const retrieved = await testDb.getImage(testId);
    assert(retrieved !== null, 'Image should be retrieved');
    assert(retrieved instanceof Blob, 'Retrieved item should be a Blob');
    assert(retrieved.size === testBlob.size, 'Retrieved Blob size should match');

    // Clean up
    await testDb.idb.delete(testId);
  });

  console.groupEnd();
  return results;
}
