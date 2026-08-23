// multi-review-schema.tests.js - Automated tests for Schema v4 and multi-reviewer migrations

import { AppDatabase, overallGradeToScore, overallScoreToGrade, BACKUP_SCHEMA_V4 } from '../db.js';
import { MemoryStorage } from '../tests.js';

export async function runMultiReviewSchemaTests() {
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

  console.group('Group 17: Multi-Reviewer Database Schema v4 Tests');

  // Test helper: Create database instance with memory storage
  const createTestDb = (initialLocalStorageData = {}) => {
    const memStorage = new MemoryStorage();
    for (const [key, val] of Object.entries(initialLocalStorageData)) {
      memStorage.setItem('vreview_' + key, typeof val === 'string' ? val : JSON.stringify(val));
    }
    const testDb = new AppDatabase(memStorage, 'vreview_', 'TestDB-' + Math.random());
    testDb.idbAvailable = false; // Mock IndexedDB as unavailable for isolation
    return { testDb, memStorage };
  };

  await runTest('1. fresh installでlocal reviewerが1件作成される', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const reviewers = testDb.getReviewers();
    assert(reviewers.length === 1, 'Reviewers should contain exactly 1 entry on fresh install');
    const local = testDb.getLocalReviewer();
    assert(local !== null, 'Local reviewer must be created');
    assert(local.isLocal === true, 'Local reviewer isLocal must be true');
    assert(local.displayName === '自分', 'Default displayName should be "自分"');
  });

  await runTest('2. reviewer IDが表示名から生成されない', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const local = testDb.getLocalReviewer();
    assert(local.id !== local.displayName, 'Reviewer ID must not be display name');
    assert(local.id.startsWith('reviewer-'), 'Reviewer ID must start with "reviewer-" prefix');
  });

  await runTest('3. v3→v4で既存review IDが維持される', async () => {
    const v3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [{
        id: 'rev-abcdefgh',
        mediaAssetId: 'vid-12345678',
        overallGrade: 'A',
        comment: 'Good',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_tags: []
    };

    const { testDb } = createTestDb(v3Data);
    await testDb.initAsync();

    const review = testDb.getOwnerReviewForVideo('vid-12345678');
    assert(review !== null, 'Review should exist');
    assert(review.id === 'rev-abcdefgh', 'Original review ID must be maintained');
  });

  await runTest('4. A〜Eが5〜1へ正しく変換される', async () => {
    const grades = ['A', 'B', 'C', 'D', 'E'];
    const expectedScores = [5, 4, 3, 2, 1];

    for (let i = 0; i < grades.length; i++) {
      const g = grades[i];
      const s = expectedScores[i];

      const v3Data = {
        schema_version: '3',
        media_assets: [{
          id: `vid-video-${i}000`,
          contentHash: `${i}111111111111111111111111111111111111111111111111111111111111111`,
          hashAlgorithm: 'SHA-256',
          quickHash: '',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          genreId: 'genre-default',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }],
        video_reviews: [{
          id: `rev-review-${i}000`,
          mediaAssetId: `vid-video-${i}000`,
          overallGrade: g,
          comment: 'Test comment',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      };

      const { testDb } = createTestDb(v3Data);
      await testDb.initAsync();

      const review = testDb.getOwnerReviewForVideo(`vid-video-${i}000`);
      assert(review.overallScore === s, `Grade ${g} must migrate to score ${s}, got ${review.overallScore}`);
      assert(review.overallGrade === undefined, 'overallGrade field must be removed');
    }
  });

  await runTest('5. 未評価がnullになる', async () => {
    const emptyGrades = [null, undefined, '', '   '];
    for (let i = 0; i < emptyGrades.length; i++) {
      const v3Data = {
        schema_version: '3',
        media_assets: [{
          id: `vid-video-${i}111`,
          contentHash: `${i}222222222222222222222222222222222222222222222222222222222222222`,
          hashAlgorithm: 'SHA-256',
          quickHash: '',
          hashStatus: 'completed',
          fileSize: 100,
          duration: 10,
          genreId: 'genre-default',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }],
        video_reviews: [{
          id: `rev-review-${i}111`,
          mediaAssetId: `vid-video-${i}111`,
          overallGrade: emptyGrades[i],
          comment: 'Test comment',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      };

      const { testDb } = createTestDb(v3Data);
      await testDb.initAsync();

      const review = testDb.getOwnerReviewForVideo(`vid-video-${i}111`);
      assert(review.overallScore === null, 'Empty grade must migrate to score null');
    }
  });

  await runTest('6. criterion ratings参照が維持される', async () => {
    const v3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [{
        id: 'rev-abcdefgh',
        mediaAssetId: 'vid-12345678',
        overallGrade: 'B',
        comment: 'nice',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      criterion_ratings: [{
        id: 'rate-11112222',
        videoReviewId: 'rev-abcdefgh',
        criterionId: 'crit-acting',
        score: 4
      }]
    };

    const { testDb } = createTestDb(v3Data);
    await testDb.initAsync();

    const ratings = testDb.getCriterionRatingsForReview('rev-abcdefgh');
    assert(ratings.length === 1, 'Criterion ratings list must have 1 element');
    assert(ratings[0].criterionId === 'crit-acting', 'Criterion reference must match');
    assert(ratings[0].score === 4, 'Score must match');
  });

  await runTest('7. timeline notes参照が維持される', async () => {
    const v3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [{
        id: 'rev-abcdefgh',
        mediaAssetId: 'vid-12345678',
        overallGrade: 'B',
        comment: 'nice',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      timeline_notes: [{
        id: 'note-11112222',
        videoReviewId: 'rev-abcdefgh',
        mediaAssetId: 'vid-12345678',
        timestampSeconds: 10.5,
        timestampLabel: '00:10',
        comment: 'Shake',
        createdAt: new Date().toISOString()
      }]
    };

    const { testDb } = createTestDb(v3Data);
    await testDb.initAsync();

    const notes = testDb.getTimelineNotes('vid-12345678');
    assert(notes.length === 1, 'Timeline notes list must have 1 element');
    assert(notes[0].id === 'note-11112222', 'Timeline note reference must match');
  });

  await runTest('8. video tagsがreview tagsへ移行される', async () => {
    const v3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [{
        id: 'rev-abcdefgh',
        mediaAssetId: 'vid-12345678',
        overallGrade: 'B',
        comment: 'nice',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      tags: [{
        id: 'tag-action',
        name: 'Action'
      }],
      video_tags: [{
        mediaAssetId: 'vid-12345678',
        tagId: 'tag-action'
      }]
    };

    const { testDb } = createTestDb(v3Data);
    await testDb.initAsync();

    const tags = testDb.getVideoTags('vid-12345678');
    assert(tags.length === 1, 'Video tags list must have 1 element');
    assert(tags[0].id === 'tag-action', 'Tag ID must match');

    // Check review tags structure in db
    assert(testDb.reviewTags.length === 1, 'reviewTags must contain 1 item');
    assert(testDb.reviewTags[0].videoReviewId === 'rev-abcdefgh', 'reviewTag videoReviewId matches');
    assert(testDb.reviewTags[0].tagId === 'tag-action', 'reviewTag tagId matches');
  });

  await runTest('9. タグだけの動画にowner reviewが作成される', async () => {
    const v3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [], // No reviews
      tags: [{
        id: 'tag-comedy',
        name: 'Comedy'
      }],
      video_tags: [{
        mediaAssetId: 'vid-12345678',
        tagId: 'tag-comedy'
      }]
    };

    const { testDb } = createTestDb(v3Data);
    await testDb.initAsync();

    const review = testDb.getOwnerReviewForVideo('vid-12345678');
    assert(review !== null, 'An owner review must be auto-generated to anchor tags');
    assert(review.overallScore === null, 'Auto-generated review score must be null');
    assert(review.comment === '', 'Auto-generated review comment must be empty string');

    const tags = testDb.getVideoTags('vid-12345678');
    assert(tags.length === 1, 'Tag must be associated');
    assert(tags[0].id === 'tag-comedy', 'Tag ID must match');
  });

  await runTest('10. migration再実行で重複しない', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const origReviewersCount = testDb.getReviewers().length;

    // Call migration again
    await testDb._migrateToV4MultiReview();
    assert(testDb.getReviewers().length === origReviewersCount, 'Re-running migration must be idempotent and not duplicate reviewers');
  });

  await runTest('11. migration途中失敗で全状態がロールバックされる', async () => {
    // Create an invalid grade value that will fail during migration validation
    const invalidV3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [{
        id: 'rev-abcdefgh',
        mediaAssetId: 'vid-12345678',
        overallGrade: 'X', // Invalid grade!
        comment: 'Nice',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_tags: []
    };

    const { testDb, memStorage } = createTestDb(invalidV3Data);

    let thrown = false;
    try {
      await testDb.initAsync();
    } catch (e) {
      thrown = true;
    }

    assert(thrown === true, 'Migration must throw on invalid grade');
    // Schema version must remain 3 or non-existent in storage (rollbacked)
    const ver = memStorage.getItem('vreview_schema_version');
    assert(ver !== '4', 'Storage schema version must not be set to 4');

    // Checks that the database memory properties were restored
    assert(testDb.reviewers.length === 0, 'Reviewers list should be rollbacked to empty');
  });

  await runTest('12. 不正な総合評価で移行が中断される', async () => {
    const invalidV3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [{
        id: 'rev-abcdefgh',
        mediaAssetId: 'vid-12345678',
        overallGrade: 'invalid-grade',
        comment: 'good',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    };

    const { testDb } = createTestDb(invalidV3Data);
    let error = null;
    try {
      await testDb.initAsync();
    } catch (e) {
      error = e;
    }
    assert(error !== null, 'An error should be thrown due to invalid grade');
  });

  await runTest('13. 同一assetに複数既存reviewがある場合に安全に中断される', async () => {
    const duplicateReviewV3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [
        {
          id: 'rev-1',
          mediaAssetId: 'vid-12345678',
          overallGrade: 'A',
          comment: 'Review 1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'rev-2',
          mediaAssetId: 'vid-12345678',
          overallGrade: 'B',
          comment: 'Review 2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const { testDb } = createTestDb(duplicateReviewV3Data);
    let error = null;
    try {
      await testDb.initAsync();
    } catch (e) {
      error = e;
    }
    assert(error !== null && error.message.includes('複数のレビューが検出されました'), 'Must throw descriptive error on multiple reviews for same asset');
  });

  await runTest('14. owner review of existing API compatibility', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    // 1. Add video
    testDb.mediaAssets.push({
      id: 'vid-test-video',
      contentHash: '2222222222222222222222222222222222222222222222222222222222222222',
      hashAlgorithm: 'SHA-256',
      quickHash: '',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // 2. saveReview
    await testDb.saveReview('vid-test-video', {
      overallGrade: 'B',
      comment: 'Compatible comments',
      ratings: { 'crit-acting': 4 }
    });

    // 3. getReviewForVideo
    const review = testDb.getReviewForVideo('vid-test-video');
    assert(review !== undefined, 'Review must be retrievable');
    assert(review.overallGrade === 'B', 'overallGrade B is returned');
    assert(review.comment === 'Compatible comments', 'Comment is retrieved');

    // 4. getCriterionRatingsForReview
    const cr = testDb.getCriterionRatingsForReview(review.id);
    assert(cr.length === 1, 'One criterion rating should exist');
    assert(cr[0].criterionId === 'crit-acting', 'Acting criterion matches');
    assert(cr[0].score === 4, 'Score matches');

    // 5. tag operations
    await testDb.addTagToVideo('vid-test-video', 'Sci-Fi');
    const tags = testDb.getVideoTags('vid-test-video');
    assert(tags.length === 1 && tags[0].name === 'Sci-Fi', 'Tag Sci-Fi should be associated');

    await testDb.removeTagFromVideo('vid-test-video', tags[0].id);
    assert(testDb.getVideoTags('vid-test-video').length === 0, 'Tag should be removed');

    // 6. timeline notes operations
    const note = await testDb.addTimelineNote('vid-test-video', {
      timestampSeconds: 5,
      timestampLabel: '00:05',
      comment: 'Nice Scene'
    });
    const notes = testDb.getTimelineNotes('vid-test-video');
    assert(notes.length === 1 && notes[0].id === note.id, 'Timeline note should be retrievable');
  });

  await runTest('15. Review EditorからA〜Eを保存・再読込できる', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    testDb.mediaAssets.push({
      id: 'vid-test-editor',
      contentHash: '3333333333333333333333333333333333333333333333333333333333333333',
      hashAlgorithm: 'SHA-256',
      quickHash: '',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const grades = ['A', 'B', 'C', 'D', 'E', null];
    for (const g of grades) {
      await testDb.saveReview('vid-test-editor', {
        overallGrade: g,
        comment: 'Reviewing ' + g,
        ratings: {}
      });
      const review = testDb.getReviewForVideo('vid-test-editor');
      assert(review.overallGrade === g, `Saved grade ${g} must be reloaded as ${g}, got ${review.overallGrade}`);
    }
  });

  await runTest('16. cascade deleteで新規関連が削除される', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    testDb.mediaAssets.push({
      id: 'vid-to-delete',
      contentHash: '4444444444444444444444444444444444444444444444444444444444444444',
      hashAlgorithm: 'SHA-256',
      quickHash: '',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await testDb.saveReview('vid-to-delete', {
      overallGrade: 'A',
      comment: 'To be deleted',
      ratings: { 'crit-acting': 5 }
    });
    await testDb.addTagToVideo('vid-to-delete', 'Temporary');
    await testDb.addTimelineNote('vid-to-delete', {
      timestampSeconds: 1,
      timestampLabel: '00:01',
      comment: 'Pointless note'
    });

    const review = testDb.getOwnerReviewForVideo('vid-to-delete');
    assert(review !== null, 'Review exists before deletion');

    // Run cascade delete
    const success = await testDb.deleteVideoCascade('vid-to-delete');
    assert(success === true, 'Cascade delete succeeds');

    assert(testDb.getVideo('vid-to-delete') === null, 'Asset must be deleted');
    assert(testDb.getReviewsForVideo('vid-to-delete').length === 0, 'Reviews must be deleted');
    assert(testDb.criterionRatings.filter(cr => cr.videoReviewId === review.id).length === 0, 'Ratings must be deleted');
    assert(testDb.reviewTags.filter(rt => rt.videoReviewId === review.id).length === 0, 'Review tags must be deleted');
    assert(testDb.timelineNotes.filter(n => n.videoReviewId === review.id).length === 0, 'Timeline notes must be deleted');
  });

  await runTest('17. archiveでは新規関連が保持される', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    testDb.mediaAssets.push({
      id: 'vid-to-archive',
      contentHash: '5555555555555555555555555555555555555555555555555555555555555555',
      hashAlgorithm: 'SHA-256',
      quickHash: '',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    testDb.fileLocations.push({
      id: 'loc-to-archive',
      mediaAssetId: 'vid-to-archive',
      relativePath: 'video.mp4',
      fileName: 'video.mp4',
      fileSize: 100,
      lastModified: Date.now(),
      availabilityStatus: 'available',
      lastVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await testDb.saveReview('vid-to-archive', { overallGrade: 'A', comment: 'Keep', ratings: {} });

    // Run archive
    const success = await testDb.archiveVideo('vid-to-archive');
    assert(success === true, 'Archive succeeds');

    const asset = testDb.getVideo('vid-to-archive');
    assert(asset !== null, 'Asset should exist');
    assert(asset.isArchived === true, 'Asset isArchived must be true');

    const review = testDb.getOwnerReviewForVideo('vid-to-archive');
    assert(review !== null, 'Review should be preserved');
  });

  await runTest('18. v4バックアップexport／restore', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    testDb.mediaAssets.push({
      id: 'vid-backup-v4',
      contentHash: '6666666666666666666666666666666666666666666666666666666666666666',
      hashAlgorithm: 'SHA-256',
      quickHash: '',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await testDb.saveReview('vid-backup-v4', { overallGrade: 'A', comment: 'Export V4 test', ratings: {} });

    const localRev = testDb.getLocalReviewer();

    // Emulate export format
    const exportedDb = {
      schemaVersion: 4,
      reviewers: testDb.reviewers,
      media_assets: testDb.mediaAssets,
      file_locations: testDb.fileLocations,
      rating_criteria: testDb.criteria,
      video_reviews: testDb.reviews,
      criterion_ratings: testDb.criterionRatings,
      tags: testDb.tags,
      review_tags: testDb.reviewTags,
      timeline_notes: testDb.timelineNotes,
      directory_sources: testDb.directorySources,
      genres: testDb.genres,
      evaluation_templates: testDb.templates,
      pending_shared_reviews: testDb.pendingSharedReviews
    };

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: testDb.mediaAssets.length,
        file_locations: testDb.fileLocations.length,
        reviews: testDb.reviews.length,
        images: 0,
        reviewers: testDb.reviewers.length,
        review_tags: testDb.reviewTags.length,
        pending_shared_reviews: testDb.pendingSharedReviews.length
      }
    };

    const validation = testDb.validateBackupData(exportedDb, manifest, []);
    assert(validation.isValid === true, 'V4 exported backup validation must pass. Errors: ' + validation.fatalErrors.join(', '));

    // Emulate restore
    const restoreDb = createTestDb().testDb;
    await restoreDb.restoreWithRollback(exportedDb, []);

    const restoredReview = restoreDb.getOwnerReviewForVideo('vid-backup-v4');
    assert(restoredReview !== null, 'Restored owner review must exist');
    assert(restoredReview.comment === 'Export V4 test', 'Restored comment must match');
    assert(restoreDb.getLocalReviewer().id === localRev.id, 'Restored local reviewer ID must match');
  });

  await runTest('19. v3バックアップrestore後のv4移行', async () => {
    const v3Backup = {
      schemaVersion: 3,
      media_assets: [{
        id: 'vid-legacy-v3',
        contentHash: '7777777777777777777777777777777777777777777777777777777777777777',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [{
        id: 'rev-legacy-v3',
        mediaAssetId: 'vid-legacy-v3',
        overallGrade: 'C',
        comment: 'V3 comments',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      criterion_ratings: [],
      tags: [],
      video_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{
        id: 'genre-default',
        name: 'Default',
        displayTitle: 'Default Genre',
        description: 'Default Genre',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      evaluation_templates: []
    };

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: 1,
        file_locations: 0,
        reviews: 1,
        images: 0
      }
    };

    const { testDb } = createTestDb();
    // Validate backup schema version 3
    const validation = testDb.validateBackupData(v3Backup, manifest, []);
    assert(validation.isValid === true, 'V3 backup validation must pass');

    // Restore v3 backup
    await testDb.restoreWithRollback(v3Backup, []);

    // Check it successfully upgraded to v4 during restoreWithRollback
    const local = testDb.getLocalReviewer();
    assert(local !== null, 'Local reviewer must be automatically created during restore upgrade');

    const review = testDb.getOwnerReviewForVideo('vid-legacy-v3');
    assert(review !== null, 'Owner review must be migrated to owner');
    assert(review.overallScore === 3, 'Grade C must be migrated to score 3');
  });

  await runTest('20. v4バックアップ不整合時の拒否', async () => {
    const invalidV4Backup = {
      schemaVersion: 4,
      reviewers: [], // Missing local reviewer!
      media_assets: [],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [],
      evaluation_templates: [],
      pending_shared_reviews: []
    };

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: 0,
        file_locations: 0,
        reviews: 0,
        images: 0,
        reviewers: 0,
        review_tags: 0,
        pending_shared_reviews: 0
      }
    };

    const { testDb } = createTestDb();
    const validation = testDb.validateBackupData(invalidV4Backup, manifest, []);
    assert(validation.isValid === false, 'V4 backup validation must fail when local reviewer is missing');
  });

  await runTest('21. local reviewerが複数あるバックアップの拒否', async () => {
    const invalidV4Backup = {
      schemaVersion: 4,
      reviewers: [
        {
          id: 'reviewer-11111111',
          displayName: 'One',
          isLocal: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'reviewer-22222222',
          displayName: 'Two',
          isLocal: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      media_assets: [],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [],
      evaluation_templates: [],
      pending_shared_reviews: []
    };

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: 0,
        file_locations: 0,
        reviews: 0,
        images: 0,
        reviewers: 2,
        review_tags: 0,
        pending_shared_reviews: 0
      }
    };

    const { testDb } = createTestDb();
    const validation = testDb.validateBackupData(invalidV4Backup, manifest, []);
    assert(validation.isValid === false, 'V4 backup validation must fail when multiple local reviewers are present');
    assert(validation.fatalErrors.some(e => e.includes('local reviewer count')), 'Error must mention local reviewer count');
  });

  await runTest('22. mediaAssetId + reviewerId 重複の拒否', async () => {
    const invalidV4Backup = {
      schemaVersion: 4,
      reviewers: [
        {
          id: 'reviewer-11111111',
          displayName: 'One',
          isLocal: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        displayTitle: null,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [
        {
          id: 'rev-11111111',
          mediaAssetId: 'vid-12345678',
          reviewerId: 'reviewer-11111111',
          origin: 'local',
          overallScore: 4,
          comment: 'Review 1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'rev-22222222',
          mediaAssetId: 'vid-12345678',
          reviewerId: 'reviewer-11111111', // Duplicate pair!
          origin: 'local',
          overallScore: 5,
          comment: 'Review 2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [{
        id: 'genre-default',
        name: 'Default',
        displayTitle: 'Default Genre',
        description: 'Default Genre',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      evaluation_templates: [],
      pending_shared_reviews: []
    };

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: 1,
        file_locations: 0,
        reviews: 2,
        images: 0,
        reviewers: 1,
        review_tags: 0,
        pending_shared_reviews: 0
      }
    };

    const { testDb } = createTestDb();
    const validation = testDb.validateBackupData(invalidV4Backup, manifest, []);
    assert(validation.isValid === false, 'V4 backup validation must fail when multiple reviews exist for the same asset and reviewer');
    assert(validation.fatalErrors.some(e => e.includes('Duplicate review for mediaAssetId')), 'Error must mention duplicate review for mediaAssetId + reviewerId');
  });

  await runTest('23. videoReviewId + tagId 重複の拒否', async () => {
    const invalidV4Backup = {
      schemaVersion: 4,
      reviewers: [
        {
          id: 'reviewer-11111111',
          displayName: 'One',
          isLocal: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      media_assets: [{
        id: 'vid-12345678',
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        displayTitle: null,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [
        {
          id: 'rev-11111111',
          mediaAssetId: 'vid-12345678',
          reviewerId: 'reviewer-11111111',
          origin: 'local',
          overallScore: 4,
          comment: 'Review 1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      criterion_ratings: [],
      tags: [
        {
          id: 'tag-11111111',
          name: 'Action'
        }
      ],
      review_tags: [
        {
          id: 'review-tag-11111111',
          videoReviewId: 'rev-11111111',
          tagId: 'tag-11111111',
          createdAt: new Date().toISOString()
        },
        {
          id: 'review-tag-22222222',
          videoReviewId: 'rev-11111111', // Duplicate association!
          tagId: 'tag-11111111',
          createdAt: new Date().toISOString()
        }
      ],
      timeline_notes: [],
      directory_sources: [],
      genres: [{
        id: 'genre-default',
        name: 'Default',
        displayTitle: 'Default Genre',
        description: 'Default Genre',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      evaluation_templates: [],
      pending_shared_reviews: []
    };

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: 1,
        file_locations: 0,
        reviews: 1,
        images: 0,
        reviewers: 1,
        review_tags: 2,
        pending_shared_reviews: 0
      }
    };

    const { testDb } = createTestDb();
    const validation = testDb.validateBackupData(invalidV4Backup, manifest, []);
    assert(validation.isValid === false, 'V4 backup validation must fail when duplicate review tag associations are present');
    assert(validation.fatalErrors.some(e => e.includes('Duplicate review tag association')), 'Error must mention duplicate review tag association');
  });

  await runTest('24. URL動画フィールドが復活していない', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    // Check properties on a fresh install default asset
    testDb.mediaAssets.push({
      id: 'vid-fresh-asset',
      contentHash: '8888888888888888888888888888888888888888888888888888888888888888',
      hashAlgorithm: 'SHA-256',
      quickHash: '',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const rawAsset = testDb.mediaAssets.find(a => a.id === 'vid-fresh-asset');
    assert(rawAsset.videoUrl === undefined, 'videoUrl property should not exist in DB');
    assert(rawAsset.sourceType === undefined, 'sourceType property should not exist in DB');
  });

  await runTest('25. 全タグ削除時のタグ復活防止テスト', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    testDb.mediaAssets.push({
      id: 'vid-tag-del-test',
      contentHash: '9999999999999999999999999999999999999999999999999999999999999999',
      hashAlgorithm: 'SHA-256',
      quickHash: '',
      hashStatus: 'completed',
      fileSize: 100,
      duration: 10,
      genreId: 'genre-default',
      identityStatus: 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const t1 = await testDb.addTagToVideo('vid-tag-del-test', 'Tag1');
    const t2 = await testDb.addTagToVideo('vid-tag-del-test', 'Tag2');

    let tags = testDb.getVideoTags('vid-tag-del-test');
    assert(tags.length === 2, 'Should have 2 tags associated');

    testDb._saveAll();

    await testDb.removeTagFromVideo('vid-tag-del-test', t1.id);
    await testDb.removeTagFromVideo('vid-tag-del-test', t2.id);

    tags = testDb.getVideoTags('vid-tag-del-test');
    assert(tags.length === 0, 'Should have 0 tags after deletion');

    testDb._saveAll();

    const reloadedDb = new AppDatabase(testDb.storage, testDb.prefix, testDb.idbName);
    await reloadedDb.initAsync();

    tags = reloadedDb.getVideoTags('vid-tag-del-test');
    assert(tags.length === 0, 'Tags must remain 0 after reload (no resurrection)');

    assert(reloadedDb.reviewTags.length === 0, 'reviewTags must be completely empty in storage');
  });

  await runTest('26. getLocalReviewer() の副作用排除テスト', async () => {
    const mem = new MemoryStorage();
    const testDb = new AppDatabase(mem, 'vreview_', 'TestDB-副作用なし');
    assert(testDb.reviewers.length === 0, 'Reviewers is empty before initialization');

    const local = testDb.getLocalReviewer();
    assert(local === null, 'getLocalReviewer must return null if not initialized');
    assert(testDb.reviewers.length === 0, 'Reviewers list must remain empty');
    assert(JSON.parse(mem.getItem('vreview_reviewers')).length === 0, 'LocalStorage must have empty reviewers list');

    let saveFailed = false;
    try {
      await testDb.saveReview('vid-123', { overallGrade: 'A', comment: 'test', ratings: {} });
    } catch (e) {
      saveFailed = true;
      assert(e.message.includes('not initialized'), 'Should throw not initialized error');
    }
    assert(saveFailed === true, 'SaveReview must throw when reviewer is not initialized');
  });

  await runTest('27. 総評コメント複数レビュアー関連テスト', async () => {
    const v3Data = {
      schema_version: '3',
      media_assets: [{
        id: 'vid-comment-test-1',
        contentHash: 'aaaa111111111111111111111111111111111111111111111111111111111111',
        hashAlgorithm: 'SHA-256',
        quickHash: '',
        hashStatus: 'completed',
        fileSize: 100,
        duration: 10,
        genreId: 'genre-default',
        identityStatus: 'normal',
        identityConflictGroupId: null,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_reviews: [{
        id: 'rev-comment-test-1',
        mediaAssetId: 'vid-comment-test-1',
        overallGrade: 'A',
        comment: 'V3 comments exist',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      video_tags: []
    };

    const { testDb } = createTestDb(v3Data);
    await testDb.initAsync();

    const localRev = testDb.getLocalReviewer();
    const ownerReview = testDb.getOwnerReviewForVideo('vid-comment-test-1');
    assert(ownerReview.comment === 'V3 comments exist', 'Comment must be preserved');
    assert(ownerReview.reviewerId === localRev.id, 'Comment review must belong to owner');

    await testDb.saveReview('vid-comment-test-1', {
      overallGrade: 'B',
      comment: 'Updated owner comment',
      ratings: {}
    });
    let reloadedReview = testDb.getOwnerReviewForVideo('vid-comment-test-1');
    assert(reloadedReview.comment === 'Updated owner comment', 'Comment should update');
    assert(reloadedReview.overallScore === 4, 'Score should be 4 (Grade B)');

    const importedReviewId = 'rev-imported-reviewer';
    const importedReviewerId = 'reviewer-imported-1';

    testDb.reviewers.push({
      id: importedReviewerId,
      displayName: '田中',
      isLocal: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    testDb.reviews.push({
      id: importedReviewId,
      mediaAssetId: 'vid-comment-test-1',
      reviewerId: importedReviewerId,
      origin: 'imported',
      overallScore: 3,
      comment: '田中コメント: 後半が少し長く感じた',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    testDb._saveAll();

    const ownerRev2 = testDb.getOwnerReviewForVideo('vid-comment-test-1');
    const importedRev2 = testDb.reviews.find(r => r.id === importedReviewId);
    assert(ownerRev2.comment === 'Updated owner comment', 'Owner comment must match');
    assert(importedRev2.comment === '田中コメント: 後半が少し長く感じた', 'Imported comment must match');

    await testDb.saveReview('vid-comment-test-1', {
      overallGrade: 'B',
      comment: 'Owner updated comment again',
      ratings: {}
    });

    const ownerRev3 = testDb.getOwnerReviewForVideo('vid-comment-test-1');
    const importedRev3 = testDb.reviews.find(r => r.id === importedReviewId);
    assert(ownerRev3.comment === 'Owner updated comment again', 'Owner comment updated');
    assert(importedRev3.comment === '田中コメント: 後半が少し長く感じた', 'Imported comment must remain unchanged');

    await testDb.saveReview('vid-comment-test-1', {
      overallGrade: 'C',
      comment: null,
      ratings: {}
    });
    const ownerRevNull = testDb.getOwnerReviewForVideo('vid-comment-test-1');
    assert(ownerRevNull.comment === null, 'Comment: null should be preserved');

    const compReview = testDb.getReviewForVideo('vid-comment-test-1');
    assert(compReview.comment === null, 'getReviewForVideo must return owner review comment');

    const exportedDb = {
      schemaVersion: 4,
      reviewers: testDb.reviewers,
      media_assets: testDb.mediaAssets,
      file_locations: testDb.fileLocations,
      rating_criteria: testDb.criteria,
      video_reviews: testDb.reviews,
      criterion_ratings: testDb.criterionRatings,
      tags: testDb.tags,
      review_tags: testDb.reviewTags,
      timeline_notes: testDb.timelineNotes,
      directory_sources: testDb.directorySources,
      genres: testDb.genres,
      evaluation_templates: testDb.templates,
      pending_shared_reviews: testDb.pendingSharedReviews
    };

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: testDb.mediaAssets.length,
        file_locations: testDb.fileLocations.length,
        reviews: testDb.reviews.length,
        images: 0,
        reviewers: testDb.reviewers.length,
        review_tags: testDb.reviewTags.length,
        pending_shared_reviews: testDb.pendingSharedReviews.length
      }
    };

    const validation = testDb.validateBackupData(exportedDb, manifest, []);
    assert(validation.isValid === true, 'V4 backup validation must pass. Errors: ' + validation.fatalErrors.join(', '));

    const restoreDb = createTestDb().testDb;
    await restoreDb.restoreWithRollback(exportedDb, []);

    const restoredOwner = restoreDb.getOwnerReviewForVideo('vid-comment-test-1');
    const restored田中 = restoreDb.reviews.find(r => r.reviewerId === importedReviewerId);
    assert(restoredOwner.comment === null, 'Restored owner comment is null');
    assert(restored田中.comment === '田中コメント: 後半が少し長く感じた', 'Restored 田中 comment matches');

    testDb.fileLocations.push({
      id: 'loc-comment-test-1',
      mediaAssetId: 'vid-comment-test-1',
      relativePath: 'video.mp4',
      fileName: 'video.mp4',
      fileSize: 100,
      lastModified: Date.now(),
      availabilityStatus: 'available',
      lastVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await testDb.saveReview('vid-comment-test-1', { overallGrade: 'A', comment: 'Preserve on archive', ratings: {} });
    await testDb.archiveVideo('vid-comment-test-1');
    assert(testDb.getOwnerReviewForVideo('vid-comment-test-1').comment === 'Preserve on archive', 'Comment must be preserved after archive');

    await testDb.deleteVideoCascade('vid-comment-test-1');
    assert(testDb.reviews.filter(r => r.mediaAssetId === 'vid-comment-test-1').length === 0, 'All reviews for vid-comment-test-1 must be deleted');
    assert(testDb.reviews.find(r => r.id === importedReviewId) === undefined, '田中 review must be deleted');

    const targetAsset = testDb.mediaAssets.find(a => a.id === 'vid-comment-test-1');
    if (targetAsset) {
      assert(targetAsset.comment === undefined, 'Media asset record itself must not hold comment property');
    }
  });

  console.groupEnd(); // main suite
  return results;
}
