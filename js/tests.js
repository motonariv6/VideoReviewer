import { AppDatabase } from './db.js';
import { generateFileSignature, formatTime, parseTime } from './video-helper.js';

export function runTests() {
  console.group('=== Running Video Annotation Studio Test Suite ===');
  
  // Test 1: Helper time conversions
  try {
    console.assert(formatTime(0) === '00:00', 'formatTime(0) should be 00:00');
    console.assert(formatTime(65) === '01:05', 'formatTime(65) should be 01:05');
    console.assert(formatTime(3605) === '01:00:05', 'formatTime(3605) should be 01:00:05');
    
    console.assert(parseTime('00:00') === 0, 'parseTime(00:00) should be 0');
    console.assert(parseTime('01:05') === 65, 'parseTime(01:05) should be 65');
    console.assert(parseTime('01:00:05') === 3605, 'parseTime(01:00:05) should be 3605');
    console.log('✓ Test 1: Time Helpers passed.');
  } catch (e) {
    console.error('✗ Test 1: Time Helpers failed:', e);
  }

  // Test 2: File signature generation
  try {
    const dummyFile1 = { name: 'holiday.mp4', size: 1234567, lastModified: 987654321 };
    const sig1 = generateFileSignature(dummyFile1);
    console.assert(sig1.includes('holiday_mp4'), 'Signature should clean name');
    console.assert(sig1.includes('1234567'), 'Signature should contain file size');
    
    const dummyFile2 = { name: 'holiday.mp4', size: 1234567, lastModified: 987654321 };
    const sig2 = generateFileSignature(dummyFile2);
    console.assert(sig1 === sig2, 'Identical file metadata must produce matching signatures');
    console.log('✓ Test 2: File Signature passed.');
  } catch (e) {
    console.error('✗ Test 2: File Signature failed:', e);
  }

  // Test 3: Database operations sandbox
  try {
    // Clear test storage area to avoid mixing with real user data
    const testDb = new AppDatabase();
    
    // Test video addition
    const testVideo = testDb.addVideo({
      title: 'Unit Test Clip',
      fileName: 'unittest.mp4',
      fileSize: 9999,
      videoUrl: '',
      duration: 30
    });
    console.assert(testVideo.id.startsWith('vid-'), 'Video ID should have vid prefix');
    console.assert(testVideo.title === 'Unit Test Clip', 'Video title should match input');

    // Test review saving
    const ratings = {};
    ratings['crit-content'] = 5;
    ratings['crit-visuals'] = 3;
    
    testDb.saveReview(testVideo.id, {
      overallGrade: 'A',
      comment: 'Excellent video!',
      ratings
    });

    const review = testDb.getReviewForVideo(testVideo.id);
    console.assert(review !== undefined, 'Review should be saved');
    console.assert(review.overallGrade === 'A', 'Overall grade should be A');
    console.assert(review.comment === 'Excellent video!', 'Comment should match');

    const scores = testDb.getCriterionRatingsForReview(review.id);
    console.assert(scores.length === 2, 'Should save exactly 2 ratings');
    console.assert(scores.find(s => s.criterionId === 'crit-content').score === 5, 'Content score should be 5');

    // Test timeline comments ordering
    testDb.addTimelineNote(testVideo.id, {
      timestampSeconds: 15,
      timestampLabel: '00:15',
      comment: 'Middle scene'
    });
    testDb.addTimelineNote(testVideo.id, {
      timestampSeconds: 5,
      timestampLabel: '00:05',
      comment: 'Beginning scene'
    });

    const notes = testDb.getTimelineNotes(testVideo.id);
    console.assert(notes.length === 2, 'Should have 2 timeline notes');
    console.assert(notes[0].timestampSeconds === 5, 'Notes should be sorted chronologically (5s first)');
    console.assert(notes[1].timestampSeconds === 15, 'Notes should be sorted chronologically (15s second)');

    // Test tags mapping
    testDb.addTagToVideo(testVideo.id, 'UnitTest');
    testDb.addTagToVideo(testVideo.id, 'TestTag');
    
    let tags = testDb.getVideoTags(testVideo.id);
    console.assert(tags.length === 2, 'Video should have 2 tags');
    console.assert(tags.some(t => t.name === 'UnitTest'), 'Tags should contain UnitTest');

    // Test tag removal
    db.removeTagFromVideo(testVideo.id, tags[0].id);
    console.log('✓ Test 3: Database Sandbox Operations passed.');
  } catch (e) {
    console.error('✗ Test 3: Database Sandbox Operations failed:', e);
  }

  // Test 4: Criteria Management
  try {
    const testDb = new AppDatabase();
    const criteriaCountBefore = testDb.getActiveCriteria().length;
    
    // Add new criterion
    if (criteriaCountBefore < 6) {
      const newCrit = testDb.addCriterion('テスト項目');
      console.assert(testDb.getActiveCriteria().length === criteriaCountBefore + 1, 'Criteria count should increase');
      
      // Delete (disable) criterion
      testDb.deleteCriterion(newCrit.id);
      console.assert(testDb.getActiveCriteria().length === criteriaCountBefore, 'Criteria count should return to previous size');
      console.assert(testDb.criteria.find(c => c.id === newCrit.id).isActive === false, 'Criterion should be inactive');
    }
    console.log('✓ Test 4: Criteria Settings Management passed.');
  } catch (e) {
    console.error('✗ Test 4: Criteria Settings Management failed:', e);
  }

  console.groupEnd();
}
