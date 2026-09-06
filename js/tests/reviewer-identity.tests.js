import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { exportReviews } from '../review-sharing/review-share-exporter.js';
import { importPackage } from '../review-sharing/review-share-importer.js';
import { resolvePendingSharedReviewsForVideo } from '../review-sharing/pending-shared-review-resolver.js';
import { formatReviewerIdentity, getReviewerShortId } from '../review-sharing/review-share-model.js';

export async function runReviewerIdentityTests() {
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

  console.group('Group 26: Reviewer Identity Tests');

  // Helper to create test database with memory storage
  const createTestDb = (preset = {}) => {
    const memStorage = new MemoryStorage();
    for (const [key, val] of Object.entries(preset)) {
      memStorage.setItem('vreview_' + key, typeof val === 'string' ? val : JSON.stringify(val));
    }
    const testDb = new AppDatabase(memStorage, 'vreview_', 'TestDB-' + Math.random());
    testDb.idbAvailable = false;
    return { testDb, memStorage };
  };

  // Helper to create valid Shared Review Package
  const createTestPackage = (reviewerId, displayName, videoHash, reviewId = 'rev-test-pkg-' + Math.random().toString(36).slice(2).padEnd(8, '0')) => ({
    schema: 'video-review-share',
    version: 1,
    packageId: '11111111-2222-4333-8444-555555555555',
    exportedAt: new Date().toISOString(),
    exporter: {
      reviewerId,
      displayName
    },
    items: [
      {
        videoHash,
        review: {
          reviewId,
          reviewerId,
          overallRating: 4,
          tags: [{ tag: '素晴らしい' }],
          timelineComments: [
            {
              id: 'note-scene-00000001',
              time: 10.0,
              comment: '見事なシーン'
            }
          ]
        }
      }
    ]
  });

  // A. 新規 Reviewer 生成時に reviewerId（UUIDv4）が作られる
  await runTest('A. 新規 Reviewer 生成時に reviewerId（UUIDv4）が作られる', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const local = testDb.getLocalReviewer();
    assert(local !== null, 'Local reviewer must be created on initialization');
    assert(local.isLocal === true, 'Local reviewer isLocal must be true');

    // UUIDv4 format check: reviewer-<8-4-4-4-12 hex chars with version 4>
    const uuidv4Pattern = /^reviewer-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert(uuidv4Pattern.test(local.id), 'reviewerId must follow reviewer-<UUIDv4> format, got: ' + local.id);
  });

  // B. displayName 初期値が Anonymous
  await runTest('B. displayName 初期値が Anonymous', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const local = testDb.getLocalReviewer();
    assert(local.displayName === 'Anonymous', 'Initial displayName must be "Anonymous", got: ' + local.displayName);
  });

  // C. displayName 変更後も reviewerId が変わらない
  await runTest('C. displayName 変更後も reviewerId が変わらない', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const initialId = testDb.getLocalReviewer().id;
    const updated = await testDb.updateLocalReviewerDisplayName('Morry');

    assert(updated !== null, 'updateLocalReviewerDisplayName should return updated reviewer');
    assert(updated.displayName === 'Morry', 'displayName should be updated to "Morry"');
    assert(testDb.getLocalReviewer().displayName === 'Morry', 'getLocalReviewer must reflect updated displayName');
    assert(testDb.getLocalReviewer().id === initialId, 'reviewerId must remain completely invariant after name change');

    // Test whitespace/empty fallback to 'Anonymous'
    await testDb.updateLocalReviewerDisplayName('   ');
    assert(testDb.getLocalReviewer().displayName === 'Anonymous', 'Empty or whitespace string should fallback to "Anonymous"');
    assert(testDb.getLocalReviewer().id === initialId, 'reviewerId must still remain invariant');
  });

  // D. 再初期化 / reload 後も reviewerId が維持される
  await runTest('D. 再初期化 / reload 後も reviewerId が維持される', async () => {
    const { testDb, memStorage } = createTestDb();
    await testDb.initAsync();
    await testDb.updateLocalReviewerDisplayName('PersistentUser');
    const initialId = testDb.getLocalReviewer().id;

    // Simulate page reload by creating a second AppDatabase instance with the same storage
    const reloadedDb = new AppDatabase(memStorage, 'vreview_', 'TestDB-Reloaded');
    reloadedDb.idbAvailable = false;
    await reloadedDb.initAsync();

    const reloadedLocal = reloadedDb.getLocalReviewer();
    assert(reloadedLocal !== null, 'Local reviewer must be preserved across reload');
    assert(reloadedLocal.id === initialId, 'reviewerId must be identical across reload/re-init');
    assert(reloadedLocal.displayName === 'PersistentUser', 'displayName must be preserved across reload');
    assert(reloadedLocal.isLocal === true, 'isLocal must remain true across reload');
  });

  // E. 既存 Reviewer migration でレビュー参照が壊れない
  await runTest('E. 既存 Reviewer migration でレビュー参照が壊れない', async () => {
    const legacyReviewerId = 'reviewer-legacy-1111-2222-3333-444455556666';
    const mediaAssetId = 'vid-asset-legacy-001';
    const reviewId = 'rev-legacy-001';

    // Preset DB with Schema v4 data containing existing reviewer and review
    const preset = {
      schema_version: 4,
      reviewers: [
        {
          id: legacyReviewerId,
          displayName: '自分',
          isLocal: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z'
        }
      ],
      media_assets: [
        {
          id: mediaAssetId,
          title: 'test.mp4',
          fileName: 'test.mp4',
          contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
          hashAlgorithm: 'SHA-256',
          hashStatus: 'completed',
          fileSize: 5000,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z'
        }
      ],
      video_reviews: [
        {
          id: reviewId,
          mediaAssetId,
          reviewerId: legacyReviewerId,
          origin: 'local',
          overallScore: 5,
          comment: 'レガシーレビューコメント',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z'
        }
      ],
      tags: [{ id: 'tag-1', name: '感動' }],
      review_tags: [
        {
          id: 'rt-1',
          videoReviewId: reviewId,
          tagId: 'tag-1',
          createdAt: '2025-01-01T00:00:00.000Z'
        }
      ]
    };

    const { testDb } = createTestDb(preset);
    await testDb.initAsync();

    const local = testDb.getLocalReviewer();
    assert(local.id === legacyReviewerId, 'Existing reviewerId must not be overwritten or regenerated');
    assert(local.displayName === '自分', 'Existing displayName must be preserved');

    const reviews = testDb.getReviewsForVideo(mediaAssetId);
    assert(reviews.length === 1, 'Review reference must be intact');
    assert(reviews[0].reviewerId === legacyReviewerId, 'Review reviewerId must point to local reviewer');
    assert(reviews[0].overallScore === 5, 'Review overallScore must match');
    assert(reviews[0].comment === 'レガシーレビューコメント', 'Review comment must match');

    const ownerReview = testDb.getOwnerReviewForVideo(mediaAssetId);
    assert(ownerReview !== null && ownerReview.id === reviewId, 'Owner review resolution must succeed');

    const tags = testDb.getTagsForReview(reviewId);
    assert(tags.length === 1 && tags[0].name === '感動', 'Review tags must remain intact');
  });

  // F. Export に reviewerId + displayName が含まれる
  await runTest('F. Export に reviewerId + displayName が含まれる', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();
    await testDb.updateLocalReviewerDisplayName('Alice');

    const local = testDb.getLocalReviewer();
    const videoHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const video = await testDb.addVideo({
      title: 'export_test.mp4',
      fileName: 'export_test.mp4',
      contentHash: videoHash,
      hashAlgorithm: 'SHA-256',
      hashStatus: 'completed',
      fileSize: 1000
    });

    // Create owner review
    await testDb.saveReview(video.id, {
      overallGrade: 'A',
      comment: 'エクスポート検証レビュー'
    });

    const exportedPkg = exportReviews(testDb, [video.id]);

    assert(exportedPkg !== null, 'Export package must be created');
    assert(exportedPkg.schema === 'video-review-share', 'Package schema must be video-review-share');
    assert(exportedPkg.exporter !== undefined, 'Package exporter must exist');
    assert(exportedPkg.exporter.reviewerId === local.id, 'exporter.reviewerId must match local reviewer ID');
    assert(exportedPkg.exporter.displayName === 'Alice', 'exporter.displayName must match local reviewer displayName');

    assert(Array.isArray(exportedPkg.items) && exportedPkg.items.length === 1, 'Package items must contain 1 item');
    assert(exportedPkg.items[0].review.reviewerId === local.id, 'items[0].review.reviewerId must match local reviewer ID');
  });

  // G. Import で同じ reviewerId が同一 Reviewer として扱われ、相手の displayName が変わっていれば同期される
  await runTest('G. Import で同じ reviewerId が同一 Reviewer として扱われ、相手の displayName が変わっていれば同期される', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const videoHash1 = '1111111111111111111111111111111111111111111111111111111111111111';
    const videoHash2 = '2222222222222222222222222222222222222222222222222222222222222222';

    await testDb.addVideo({
      title: 'video1.mp4',
      fileName: 'video1.mp4',
      contentHash: videoHash1,
      hashAlgorithm: 'SHA-256',
      hashStatus: 'completed',
      fileSize: 1000
    });
    await testDb.addVideo({
      title: 'video2.mp4',
      fileName: 'video2.mp4',
      contentHash: videoHash2,
      hashAlgorithm: 'SHA-256',
      hashStatus: 'completed',
      fileSize: 2000
    });

    const remoteReviewerId = 'reviewer-remote-bob-0000-1111-222233334444';

    // 1st Import: Bob sends review for video1
    const pkg1 = createTestPackage(remoteReviewerId, 'Bob', videoHash1, 'rev-bob-0001');
    const result1 = await importPackage(testDb, pkg1);
    assert(result1.imported === 1, 'First import should import 1 review');

    const reviewersAfter1 = testDb.getReviewers().filter(r => !r.isLocal);
    assert(reviewersAfter1.length === 1, 'Exactly 1 remote reviewer should exist in DB');
    const importedReviewer = reviewersAfter1[0];
    assert(importedReviewer.sourceReviewerId === remoteReviewerId, 'sourceReviewerId must match remote reviewerId');
    assert(importedReviewer.displayName === 'Bob', 'Initial imported displayName should be Bob');

    // 2nd Import: Bob changed displayName to 'Bob The Builder' and sends review for video2
    const pkg2 = createTestPackage(remoteReviewerId, 'Bob The Builder', videoHash2, 'rev-bob-0002');
    const result2 = await importPackage(testDb, pkg2);
    assert(result2.imported === 1, 'Second import should import 1 review');

    const reviewersAfter2 = testDb.getReviewers().filter(r => !r.isLocal);
    assert(reviewersAfter2.length === 1, 'Still exactly 1 remote reviewer should exist (no duplicate reviewer record)');
    assert(reviewersAfter2[0].id === importedReviewer.id, 'Internal reviewer ID must remain identical');
    assert(reviewersAfter2[0].displayName === 'Bob The Builder', 'displayName must be updated/synchronized to "Bob The Builder"');
  });

  // H. 同じ displayName + 異なる reviewerId は別 Reviewer になる
  await runTest('H. 同じ displayName + 異なる reviewerId は別 Reviewer になる', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const videoHash1 = '3333333333333333333333333333333333333333333333333333333333333333';
    const videoHash2 = '4444444444444444444444444444444444444444444444444444444444444444';

    await testDb.addVideo({
      title: 'video3.mp4',
      fileName: 'video3.mp4',
      contentHash: videoHash1,
      hashAlgorithm: 'SHA-256',
      hashStatus: 'completed',
      fileSize: 1000
    });
    await testDb.addVideo({
      title: 'video4.mp4',
      fileName: 'video4.mp4',
      contentHash: videoHash2,
      hashAlgorithm: 'SHA-256',
      hashStatus: 'completed',
      fileSize: 2000
    });

    const reviewerId1 = 'reviewer-user-one-1111-2222-333344445555';
    const reviewerId2 = 'reviewer-user-two-6666-7777-888899990000';

    // Both users share the exact same displayName 'Alice'
    const pkgA = createTestPackage(reviewerId1, 'Alice', videoHash1, 'rev-alice-0001');
    const pkgB = createTestPackage(reviewerId2, 'Alice', videoHash2, 'rev-alice-0002');

    await importPackage(testDb, pkgA);
    await importPackage(testDb, pkgB);

    const remoteReviewers = testDb.getReviewers().filter(r => !r.isLocal);
    assert(remoteReviewers.length === 2, 'Two distinct reviewer records must be created for different reviewerIds');

    const rev1 = remoteReviewers.find(r => r.sourceReviewerId === reviewerId1);
    const rev2 = remoteReviewers.find(r => r.sourceReviewerId === reviewerId2);

    assert(rev1 !== undefined, 'Reviewer 1 must exist');
    assert(rev2 !== undefined, 'Reviewer 2 must exist');
    assert(rev1.id !== rev2.id, 'Internal IDs must be distinct');
    assert(rev1.displayName === 'Alice' && rev2.displayName === 'Alice', 'Both reviewers can legitimately have displayName "Alice"');
  });

  // I. 同一 mediaAssetId + reviewerId を繰り返し Import してもレビュー票が重複増殖しない
  await runTest('I. 同一 mediaAssetId + reviewerId を繰り返し Import してもレビュー票が重複増殖しない', async () => {
    const { testDb } = createTestDb();
    await testDb.initAsync();

    const videoHash = '5555555555555555555555555555555555555555555555555555555555555555';
    const video = await testDb.addVideo({
      title: 'video5.mp4',
      fileName: 'video5.mp4',
      contentHash: videoHash,
      hashAlgorithm: 'SHA-256',
      hashStatus: 'completed',
      fileSize: 3000
    });

    const remoteReviewerId = 'reviewer-remote-carl-aaaa-bbbb-ccccddddeeee';
    const pkg = createTestPackage(remoteReviewerId, 'Carl', videoHash, 'rev-carl-0001');

    // 1st import: should succeed
    const res1 = await importPackage(testDb, pkg);
    assert(res1.imported === 1, 'First import must import 1 review');
    assert(res1.duplicate === 0, 'First import should have 0 duplicates');

    const reviewsAfter1 = testDb.getReviewsForVideo(video.id);
    assert(reviewsAfter1.length === 1, 'Should have exactly 1 review after first import');

    // 2nd import of the exact same package/review
    const res2 = await importPackage(testDb, pkg);
    assert(res2.imported === 0, 'Second import must import 0 reviews');
    assert(res2.duplicate === 1, 'Second import must count 1 review as duplicate');

    const reviewsAfter2 = testDb.getReviewsForVideo(video.id);
    assert(reviewsAfter2.length === 1, 'Review count must remain strictly 1; no duplicate vote proliferation');

    // Test with pending shared reviews promotion idempotency
    const pendingHash = '6666666666666666666666666666666666666666666666666666666666666666';
    const pendingPkg = createTestPackage(remoteReviewerId, 'Carl', pendingHash, 'rev-carl-pending1');

    // Import while video asset does not exist yet (creates pending_shared_review)
    const pendingImport = await importPackage(testDb, pendingPkg);
    assert(pendingImport.pending === 1, 'Pending import should register 1 pending review');

    // Now video asset is registered
    const pendingVideo = await testDb.addVideo({
      title: 'video_pending.mp4',
      fileName: 'video_pending.mp4',
      contentHash: pendingHash,
      hashAlgorithm: 'SHA-256',
      hashStatus: 'completed',
      fileSize: 4000
    });

    // 1st Promotion (automatically executed by addVideo when contentHash is completed)
    assert(pendingVideo.resolvedPendingSummary && pendingVideo.resolvedPendingSummary.resolved === 1, 'addVideo should automatically link pending review');
    const pendingVideoReviews1 = testDb.getReviewsForVideo(pendingVideo.id);
    assert(pendingVideoReviews1.length === 1, 'Video should have 1 promoted review');

    // 2nd Promotion: even if another pending review for the same reviewer and videoHash arrived
    await testDb.addPendingSharedReview({
      videoHash: pendingHash,
      payload: { ...pendingPkg.items[0].review, exporterDisplayName: 'Carl' },
      status: 'pending'
    });
    const promoRes2 = resolvePendingSharedReviewsForVideo({ db: testDb, mediaAssetId: pendingVideo.id, contentHash: pendingHash });
    assert(promoRes2.resolved === 0, 'Second promotion must not link duplicate review');
    assert(promoRes2.duplicate === 1, 'Second promotion must mark duplicate');
    const pendingVideoReviews2 = testDb.getReviewsForVideo(pendingVideo.id);
    assert(pendingVideoReviews2.length === 1, 'Video review count must remain strictly 1');
  });

  // J. 旧形式データの migration / compatibility
  await runTest('J. 旧形式データの migration / compatibility', async () => {
    // Legacy storage where local reviewer has displayName = '自分'
    const legacyPreset = {
      schema_version: 4,
      reviewers: [
        {
          id: 'reviewer-existing-legacy-local',
          displayName: '自分',
          isLocal: true,
          createdAt: '2024-10-01T12:00:00.000Z',
          updatedAt: '2024-10-01T12:00:00.000Z'
        }
      ]
    };

    const { testDb } = createTestDb(legacyPreset);
    await testDb.initAsync();

    const local = testDb.getLocalReviewer();
    assert(local !== null, 'Local reviewer must exist');
    assert(local.id === 'reviewer-existing-legacy-local', 'Existing reviewer ID must be preserved');
    assert(local.displayName === '自分', 'Existing displayName "自分" must NOT be overwritten to "Anonymous"');

    // Validate backup compatibility with legacy reviewer
    const exportedDb = {
      schemaVersion: 4,
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
      reviewers: testDb.reviewers,
      evaluation_templates: testDb.templates,
      pending_shared_reviews: testDb.pendingSharedReviews
    };

    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
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
    assert(validation.isValid === true, 'Backup with legacy displayName "自分" must validate as valid: ' + (validation.fatalErrors || []).join(', '));
  });

  // K. formatReviewerIdentity による短縮表現 {displayName}@{shortId} の動作検証
  await runTest('K. formatReviewerIdentity による短縮表現 {displayName}@{shortId} の動作検証', async () => {
    // 1. Full reviewer ID with reviewer- prefix
    const fullId = 'reviewer-8f3a2d2e-1111-4222-8333-abcdef123456';
    assert(getReviewerShortId(fullId) === '8f3a2d2e', 'getReviewerShortId should extract first 8 chars after prefix');
    assert(formatReviewerIdentity('Morry', fullId) === 'Morry@8f3a2d2e', 'formatReviewerIdentity should format Morry@8f3a2d2e');

    // 2. Raw UUID without prefix
    const rawUuid = '550e8400-e29b-41d4-a716-446655440000';
    assert(getReviewerShortId(rawUuid) === '550e8400', 'getReviewerShortId should extract first 8 chars of raw UUID');
    assert(formatReviewerIdentity('Alice', rawUuid) === 'Alice@550e8400', 'formatReviewerIdentity should format Alice@550e8400');

    // 3. Fallback when displayName is missing or empty
    assert(formatReviewerIdentity('', fullId) === 'Anonymous@8f3a2d2e', 'Empty string name should fallback to Anonymous');
    assert(formatReviewerIdentity('   ', fullId) === 'Anonymous@8f3a2d2e', 'Whitespace name should fallback to Anonymous');
    assert(formatReviewerIdentity(null, fullId) === 'Anonymous@8f3a2d2e', 'null name should fallback to Anonymous');
    assert(formatReviewerIdentity(undefined, fullId) === 'Anonymous@8f3a2d2e', 'undefined name should fallback to Anonymous');

    // 4. Fallback when reviewerId is missing or empty
    assert(formatReviewerIdentity('Bob', null) === 'Bob', 'Missing reviewerId should return only displayName');
    assert(formatReviewerIdentity('Bob', '') === 'Bob', 'Empty reviewerId should return only displayName');

    // 5. Short ID corner cases
    assert(getReviewerShortId('') === '', 'Empty string should yield empty shortId');
    assert(getReviewerShortId(null) === '', 'null should yield empty shortId');
    assert(getReviewerShortId(undefined) === '', 'undefined should yield empty shortId');
    assert(getReviewerShortId('reviewer-abc') === 'abc', 'Shorter than 8 chars should yield available chars');
  });

  // L. Schema v4 既定環境での local reviewer 自動初期化と表示名更新フォールバック
  await runTest('L. Schema v4 既定環境での local reviewer 自動初期化と表示名更新フォールバック', async () => {
    const mockStorage = new MemoryStorage();
    mockStorage.setItem('test_schema_version', '4');
    mockStorage.setItem('test_reviewers', JSON.stringify([]));

    const testDb = new AppDatabase(mockStorage, 'test_');
    assert(testDb.getLocalReviewer() === null, 'Initially without initAsync, local reviewer may be null');

    await testDb.initAsync();
    const local = testDb.getLocalReviewer();
    assert(local !== null, 'initAsync must ensure local reviewer even if schema_version is already 4');
    assert(local.isLocal === true, 'Local reviewer must have isLocal: true');
    assert(local.displayName === 'Anonymous', 'Default displayName must be Anonymous');

    const updated = testDb.updateLocalReviewerDisplayName('Morry');
    assert(updated.displayName === 'Morry', 'DisplayName must update to Morry');
    assert(testDb.getLocalReviewer().displayName === 'Morry', 'getLocalReviewer must return updated displayName');

    // Test safe fallback if reviewers is emptied unexpectedly
    testDb.reviewers = [];
    const recovered = testDb.updateLocalReviewerDisplayName('RecoveredUser');
    assert(recovered.displayName === 'RecoveredUser', 'Fallback must create and return new local reviewer');
    assert(recovered.isLocal === true, 'Fallback local reviewer must have isLocal: true');
  });

  console.groupEnd();
  return results;
}
