// pending-shared-review-linking.tests.js - Automated tests for pending shared review automatic linking
import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { resolvePendingSharedReviewsForVideo, resolveAllPendingSharedReviews } from '../review-sharing/pending-shared-review-resolver.js';
import { buildSharedReviewViewModel } from '../review-sharing/review-share-view-model.js';

export async function runPendingSharedReviewLinkingTests() {
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

  console.group('Group 21: Pending Shared Review Automatic Linking Tests');

  // Helper to create test database with preset data
  const createTestDb = (preset = {}) => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');
    const defaultData = {
      reviewers: [
        {
          id: 'reviewer-owner1234',
          displayName: '自分',
          isLocal: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      media_assets: [
        {
          id: 'vid-11111111',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          contentHash: 'aaaa111111111111111111111111111111111111111111111111111111111111',
          hashAlgorithm: 'SHA-256',
          quickHash: 'q_100',
          hashStatus: 'completed',
          fileSize: 1000,
          duration: 12.5,
          genreId: 'genre-default',
          identityStatus: 'verified',
          identityConflictGroupId: null,
          isArchived: false,
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      video_reviews: [],
      review_tags: [],
      tags: [],
      timeline_notes: [],
      file_locations: [],
      rating_criteria: [],
      criterion_ratings: [],
      directory_sources: [],
      genres: [],
      evaluation_templates: [],
      pending_shared_reviews: []
    };

    // Apply overrides
    const merged = { ...defaultData };
    Object.keys(preset).forEach(k => {
      merged[k] = preset[k];
    });

    // Populate memory storage BEFORE AppDatabase constructor is called
    Object.keys(merged).forEach(k => {
      memStorage.setItem('vreview_' + k, JSON.stringify(merged[k]));
    });

    const db = new AppDatabase(memStorage);
    return db;
  };

  // Pre-defined values for test packages
  const HASH_A = 'aaaa111111111111111111111111111111111111111111111111111111111111';
  const HASH_B = 'bbbb222222222222222222222222222222222222222222222222222222222222';
  const INVALID_HASH = 'not-a-valid-sha-256-hex-hash';

  // ==========================================
  // BASIC RESOLUTION TESTS (1-5)
  // ==========================================

  await runTest('1. pendingなし → no-op', async () => {
    const db = createTestDb();
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({
      db,
      mediaAssetId: 'vid-11111111',
      contentHash: HASH_A
    });

    assert(res.resolved === 0);
    assert(res.duplicate === 0);
    assert(res.failed === 0);
  });

  await runTest('2. hash一致1件 → imported reviewへ昇格', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-99',
            reviewerId: 'reviewer-remote-99',
            exporterDisplayName: 'レビュアーA',
            overallRating: 5,
            comment: 'すばらしい'
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({
      db,
      mediaAssetId: 'vid-11111111',
      contentHash: HASH_A
    });

    assert(res.resolved === 1);
    assert(db.reviews.length === 1);
    assert(db.reviews[0].origin === 'imported');
    assert(db.pendingSharedReviews.length === 0, 'Resolved pending review must be removed');
  });

  await runTest('3. hash一致複数pending → 全件昇格', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-1',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-1',
            exporterDisplayName: 'レビュアーA',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'pending-review-2',
          packageId: 'package-xyz',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-2',
          payload: {
            reviewId: 'rev-remote-2',
            reviewerId: 'reviewer-remote-2',
            exporterDisplayName: 'レビュアーB',
            overallRating: 5
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({
      db,
      mediaAssetId: 'vid-11111111',
      contentHash: HASH_A
    });

    assert(res.resolved === 2);
    assert(db.reviews.length === 2);
    assert(db.pendingSharedReviews.length === 0);
  });

  await runTest('4. hash不一致 → pending維持', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_B, // different hash
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-1',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-1',
            exporterDisplayName: 'レビュアーA',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({
      db,
      mediaAssetId: 'vid-11111111',
      contentHash: HASH_A // target asset hash
    });

    assert(res.resolved === 0);
    assert(db.pendingSharedReviews.length === 1);
    assert(db.reviews.length === 0);
  });

  await runTest('5. invalid hash → resolveしない', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: INVALID_HASH,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-1',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-1',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({
      db,
      mediaAssetId: 'vid-11111111',
      contentHash: INVALID_HASH
    });

    assert(res.resolved === 0);
    assert(db.pendingSharedReviews.length === 1);
  });

  // ==========================================
  // TRIGGER TESTS (6-9)
  // ==========================================

  await runTest('6. full hash completion後にresolve', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-11111111',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          fileSize: 1000,
          quickHash: 'q_100',
          hashStatus: 'pending',
          identityStatus: 'provisional'
        }
      ],
      file_locations: [
        {
          id: 'loc-1',
          mediaAssetId: 'vid-11111111',
          verificationStatus: 'provisional',
          fileSize: 1000,
          fileName: 'video1.mp4'
        }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-1',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-1',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    // Trigger full hash completion
    await db.completeLocationProvisionalVerification('loc-1', HASH_A);

    assert(db.pendingSharedReviews.length === 0, 'Pending review should be resolved');
    assert(db.reviews.length === 1);
  });

  await runTest('7. provisionalではresolveしない', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-11111111',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          fileSize: 1000,
          quickHash: 'q_100',
          hashStatus: 'pending',
          identityStatus: 'provisional'
        }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-1',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-1',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    // Provisional unarchiving or setup does not trigger pending resolution since hashStatus is still 'pending'
    const res = resolvePendingSharedReviewsForVideo({
      db,
      mediaAssetId: 'vid-11111111',
      contentHash: HASH_A
    });

    assert(res.resolved === 0, 'Provisional asset must not link to pending reviews');
    assert(db.pendingSharedReviews.length === 1);
  });

  await runTest('8. new video + completed hashでresolve', async () => {
    const db = createTestDb({
      media_assets: [], // empty
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-1',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-1',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    // Register new video with completed hash status
    await db.addVideo({
      title: 'video1.mp4',
      fileName: 'video1.mp4',
      fileSize: 1000,
      contentHash: HASH_A,
      hashStatus: 'completed'
    });

    assert(db.pendingSharedReviews.length === 0, 'Resolves immediately upon new video addition');
    assert(db.reviews.length === 1);
  });

  await runTest('9. archive復元後resolve', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-11111111',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          contentHash: HASH_A,
          hashStatus: 'completed',
          isArchived: true, // currently archived
          archivedAt: new Date().toISOString()
        }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-1',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-1',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    // Re-scanning and finding this contentHash restores (unarchives) it
    await db.resolveAndRegisterNewScannedFile({
      directoryId: 'dir-1',
      directoryHandle: {},
      sf: { fileName: 'video1.mp4', fileSize: 1000, relativePath: 'video1.mp4' },
      getFileHandleFromRelativePathFn: async () => ({ getFile: async () => new Blob() }),
      computeFileSHA256Fn: async () => HASH_A
    });

    assert(db.pendingSharedReviews.length === 0, 'Unarchiving video triggers pending resolution');
    assert(db.reviews.length === 1);
  });

  // ==========================================
  // REVIEWER TESTS (10-13)
  // ==========================================

  await runTest('10. existing remote reviewer再利用', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote-existing', displayName: '他レビュアー', isLocal: false, sourceReviewerId: 'reviewer-remote-99' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.reviews[0].reviewerId === 'reviewer-remote-existing', 'Should reuse existing reviewer ID');
    assert(db.reviewers.length === 2, 'No new reviewer must be created');
  });

  await runTest('11. 新規remote reviewer作成', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-new',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-new',
            exporterDisplayName: '新規ユーザー',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.reviewers.length === 2);
    const newReviewer = db.reviewers.find(r => r.sourceReviewerId === 'reviewer-remote-new');
    assert(newReviewer !== undefined);
    assert(newReviewer.displayName === '新規ユーザー');
  });

  await runTest('12. local reviewer保護', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-owner1234', // same source ID as local owner ID
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-owner1234',
            exporterDisplayName: 'なりすまし',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    const owner = db.reviewers.find(r => r.id === 'reviewer-owner1234');
    assert(owner.isLocal === true);
    assert(owner.displayName === '自分', 'Local owner display name must remain unchanged');
  });

  await runTest('13. sourceReviewerId保持', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4
          },
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    const rev = db.reviewers.find(r => r.sourceReviewerId === 'reviewer-remote-99');
    assert(rev.sourceReviewerId === 'reviewer-remote-99');
  });

  // ==========================================
  // REVIEW TESTS (14-17)
  // ==========================================

  await runTest('14. origin imported', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.reviews[0].origin === 'imported');
  });

  await runTest('15. sourceReviewId保持', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-99', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.reviews[0].sourceReviewId === 'rev-remote-99');
  });

  await runTest('16. local owner review不変', async () => {
    const db = createTestDb({
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4, comment: '自分のメモ' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 5, comment: '他者のメモ' },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    const ownerRev = db.reviews.find(r => r.origin === 'local');
    assert(ownerRev.overallScore === 4);
    assert(ownerRev.comment === '自分のメモ');
  });

  await runTest('17. local owner reviewと共存', async () => {
    const db = createTestDb({
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 5 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.reviews.length === 2);
    assert(db.reviews.some(r => r.origin === 'local'));
    assert(db.reviews.some(r => r.origin === 'imported'));
  });

  // ==========================================
  // TAGS TESTS (18-20)
  // ==========================================

  await runTest('18. imported tags登録', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            tags: [{ tag: '新規タグ' }]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.tags.length === 1);
    assert(db.tags[0].name === '新規タグ');
    assert(db.reviewTags.length === 1);
  });

  await runTest('19. canonical global tag再利用', async () => {
    const db = createTestDb({
      tags: [
        { id: 'tag-existing', name: '旅行' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            tags: [{ tag: '旅行' }]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.tags.length === 1, 'No new tag record must be created');
    assert(db.reviewTags[0].tagId === 'tag-existing');
  });

  await runTest('20. local tag association変更なし', async () => {
    const db = createTestDb({
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local' }
      ],
      tags: [
        { id: 'tag-local', name: 'ローカルタグ' }
      ],
      review_tags: [
        { id: 'rt-local', videoReviewId: 'rev-local', tagId: 'tag-local' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            tags: [{ tag: '共有タグ' }]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    const localRT = db.reviewTags.filter(rt => rt.videoReviewId === 'rev-local');
    assert(localRT.length === 1);
    assert(localRT[0].tagId === 'tag-local');
  });

  // ==========================================
  // TIMELINE TESTS (21-23)
  // ==========================================

  await runTest('21. timeline comments登録', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            timelineComments: [
              { id: 'comment-abc', time: 5.5, comment: '注目のシーン' }
            ]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.timelineNotes.length === 1);
    assert(db.timelineNotes[0].comment === '注目のシーン');
    assert(db.timelineNotes[0].timestampSeconds === 5.5);
  });

  await runTest('22. sourceCommentId保持', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            timelineComments: [
              { id: 'comment-abc', time: 5.5, comment: '注目のシーン' }
            ]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.timelineNotes[0].sourceCommentId === 'comment-abc');
  });

  await runTest('23. local timeline変更なし', async () => {
    const db = createTestDb({
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local' }
      ],
      timeline_notes: [
        { id: 'note-local', videoReviewId: 'rev-local', mediaAssetId: 'vid-11111111', timestampSeconds: 1, comment: 'マイコメント' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            timelineComments: [
              { id: 'comment-abc', time: 5.5, comment: '他者コメント' }
            ]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    const localNotes = db.timelineNotes.filter(n => n.videoReviewId === 'rev-local');
    assert(localNotes.length === 1);
    assert(localNotes[0].comment === 'マイコメント');
  });

  // ==========================================
  // DUPLICATE TESTS (24-26)
  // ==========================================

  await runTest('24. already imported reviewは再作成しない', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-remote-ex', displayName: '他レビュアー', isLocal: false, sourceReviewerId: 'reviewer-remote-99' }
      ],
      video_reviews: [
        { id: 'rev-imported', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote-ex', origin: 'imported', sourceReviewId: 'rev-remote-1', sourceReviewerId: 'reviewer-remote-99' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(res.resolved === 0);
    assert(res.duplicate === 1);
    assert(db.reviews.length === 1, 'Review must not be recreated');
    assert(db.pendingSharedReviews.length === 0, 'Duplicate pending must be cleaned up');
  });

  await runTest('25. duplicate pendingは安全に除去', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-remote-ex', displayName: '他レビュアー', isLocal: false, sourceReviewerId: 'reviewer-remote-99' }
      ],
      video_reviews: [
        { id: 'rev-imported', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote-ex', origin: 'imported', sourceReviewId: 'rev-remote-1', sourceReviewerId: 'reviewer-remote-99' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.pendingSharedReviews.length === 0);
  });

  await runTest('26. different package / same source identityでもduplicate', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-remote-ex', displayName: '他レビュアー', isLocal: false, sourceReviewerId: 'reviewer-remote-99' }
      ],
      video_reviews: [
        { id: 'rev-imported', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote-ex', origin: 'imported', sourceReviewId: 'rev-remote-1', sourceReviewerId: 'reviewer-remote-99' }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'different-package-id-1111',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(res.duplicate === 1);
    assert(db.pendingSharedReviews.length === 0);
  });

  // ==========================================
  // ATOMICITY TESTS (27-31)
  // ==========================================

  await runTest('27. reviewer作成後失敗rollback', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-new',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-new',
            overallRating: 4
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    // Mock addImportedReview to throw error to force transactional failure after reviewer is created
    const originalAdd = db.addImportedReview;
    db.addImportedReview = () => { throw new Error('Simulated failure'); };

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(res.failed === 1);
    assert(db.reviewers.length === 1, 'New reviewer must be rolled back');
    assert(db.pendingSharedReviews.length === 1, 'Pending review must not be deleted');

    db.addImportedReview = originalAdd;
  });

  await runTest('28. review作成後失敗rollback', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            tags: [{ tag: '共有タグ' }]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    // Mock addImportedTagAssociation to throw error to force failure after review is created
    const originalAddTag = db.addImportedTagAssociation;
    db.addImportedTagAssociation = () => { throw new Error('Simulated tag failure'); };

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(res.failed === 1);
    assert(db.reviews.length === 0, 'New review must be rolled back');
    assert(db.reviewers.length === 1, 'New reviewer must be rolled back');
    assert(db.pendingSharedReviews.length === 1);

    db.addImportedTagAssociation = originalAddTag;
  });

  await runTest('29. tag作成後失敗rollback', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            tags: [{ tag: '共有タグ' }],
            timelineComments: [{ id: 'comment-1', time: 5, comment: 'コメ' }]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    // Mock addImportedTimelineNote to throw error
    const originalAddNote = db.addImportedTimelineNote;
    db.addImportedTimelineNote = () => { throw new Error('Simulated note failure'); };

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(res.failed === 1);
    assert(db.reviews.length === 0, 'Review rolled back');
    assert(db.tags.length === 0, 'Tag rolled back');
    assert(db.pendingSharedReviews.length === 1);

    db.addImportedTimelineNote = originalAddNote;
  });

  await runTest('30. timeline途中失敗rollback', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4,
            timelineComments: [
              { id: 'comment-1', time: 5, comment: '成功コメ' },
              { id: 'comment-2', time: 10, comment: '失敗コメ' }
            ]
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    // Mock addImportedTimelineNote to fail on second comment
    let count = 0;
    const originalAddNote = db.addImportedTimelineNote;
    db.addImportedTimelineNote = (params) => {
      count++;
      if (count === 2) {
        throw new Error('Timeline failure on second item');
      }
      return originalAddNote.call(db, params);
    };

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(res.failed === 1);
    assert(db.timelineNotes.length === 0, 'All timeline notes must be rolled back');
    assert(db.reviews.length === 0, 'Review must be rolled back');
    assert(db.pendingSharedReviews.length === 1);

    db.addImportedTimelineNote = originalAddNote;
  });

  await runTest('31. failure時pending維持', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 4
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    const originalAdd = db.addImportedReview;
    db.addImportedReview = () => { throw new Error('Fail'); };

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.pendingSharedReviews.length === 1);
    assert(db.pendingSharedReviews[0].id === 'pending-review-1');

    db.addImportedReview = originalAdd;
  });

  // ==========================================
  // CONFLICT / CANONICAL TESTS (32-34)
  // ==========================================

  await runTest('32. hash merge後canonical assetへattach', async () => {
    const db = createTestDb({
      media_assets: [
        // Verified target asset
        {
          id: 'vid-canonical',
          title: 'video_real.mp4',
          fileName: 'video_real.mp4',
          contentHash: HASH_A,
          hashStatus: 'completed',
          identityStatus: 'verified'
        },
        // Provisional source asset
        {
          id: 'vid-provisional',
          title: 'video_prov.mp4',
          fileName: 'video_prov.mp4',
          quickHash: 'q_200',
          fileSize: 2000,
          hashStatus: 'pending',
          identityStatus: 'provisional'
        }
      ],
      file_locations: [
        { id: 'loc-canonical', mediaAssetId: 'vid-canonical', relativePath: 'video_real.mp4', verificationStatus: 'verified' },
        { id: 'loc-provisional', mediaAssetId: 'vid-provisional', relativePath: 'video_prov.mp4', verificationStatus: 'provisional', fileSize: 2000 }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    // Trigger full hash completion on the provisional asset, which will trigger a merge into the canonical asset
    await db.completeLocationProvisionalVerification('loc-provisional', HASH_A);

    // Verify the review is attached to vid-canonical (the canonical asset)
    assert(db.reviews.length === 1);
    assert(db.reviews[0].mediaAssetId === 'vid-canonical', 'Review must be attached to the canonical asset');
    assert(db.pendingSharedReviews.length === 0);
  });

  await runTest('33. conflict assetではpending維持', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-conflict-1',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          contentHash: HASH_A,
          hashStatus: 'completed',
          identityStatus: 'conflict' // conflict
        }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-conflict-1', contentHash: HASH_A });

    assert(res.resolved === 0, 'Must not resolve pending review for a conflict asset');
    assert(db.pendingSharedReviews.length === 1);
  });

  await runTest('34. archivedのみ存在ではresolveしない', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-archived',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          contentHash: HASH_A,
          hashStatus: 'completed',
          isArchived: true // archived
        }
      ],
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    const res = resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-archived', contentHash: HASH_A });

    assert(res.resolved === 0, 'Must not resolve pending review for an archived asset');
    assert(db.pendingSharedReviews.length === 1);
  });

  // ==========================================
  // AGGREGATE UI TESTS (35-37)
  // ==========================================

  await runTest('35. resolve後ViewModelへ反映', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: {
            reviewId: 'rev-remote-1',
            reviewerId: 'reviewer-remote-99',
            overallRating: 5
          },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    // Check before resolve
    let vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.reviewCount === 0);

    // Resolve
    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    // Check after resolve
    vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.reviewCount === 1);
    assert(vm.averageRating === 5.0);
  });

  await runTest('36. current editor再描画可能', async () => {
    // Controller mock and UI refresh verification is handled by tests.js integration test,
    // here we verify the view model build matches correctly.
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote-99', displayName: '他レビュアー', isLocal: false, sourceReviewerId: 'reviewer-remote-99' }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote-1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote-99', origin: 'imported', overallScore: 5 }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    assert(vm.reviewers.length === 2);
  });

  await runTest('37. aggregate値はDB保存されない', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          videoHash: HASH_A,
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending'
        }
      ]
    });
    await db.initAsync();

    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    assert(db.reviews[0].averageRating === undefined);
  });

  // ==========================================
  // BACKUP TESTS (38-39)
  // ==========================================

  await runTest('38. unresolved pending round-trip', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending',
          importedAt: '2026-08-24T00:00:00.000Z',
          createdAt: '2026-08-24T00:00:00.000Z',
          updatedAt: '2026-08-24T00:00:00.000Z'
        }
      ]
    });
    await db.initAsync();

    const backup = {
      schemaVersion: 4,
      reviewers: db.reviewers,
      media_assets: db.mediaAssets,
      file_locations: db.fileLocations,
      rating_criteria: db.criteria,
      video_reviews: db.reviews,
      criterion_ratings: db.criterionRatings,
      tags: db.tags,
      review_tags: db.reviewTags,
      timeline_notes: db.timelineNotes,
      directory_sources: db.directorySources,
      genres: db.genres,
      evaluation_templates: db.templates,
      pending_shared_reviews: db.pendingSharedReviews
    };

    const db2 = createTestDb();
    await db2.initAsync();
    await db2.restoreWithRollback(backup, []);

    assert(db2.pendingSharedReviews.length === 1);
    assert(db2.pendingSharedReviews[0].id === 'pending-review-1');
  });

  await runTest('39. resolved review round-trip', async () => {
    const db = createTestDb({
      pending_shared_reviews: [
        {
          id: 'pending-review-1',
          packageId: 'package-abc',
          videoHash: HASH_A,
          hashAlgorithm: 'sha256',
          reviewerId: 'reviewer-remote-99',
          payload: { reviewId: 'rev-remote-1', reviewerId: 'reviewer-remote-99', overallRating: 4 },
          status: 'pending',
          importedAt: '2026-08-24T00:00:00.000Z',
          createdAt: '2026-08-24T00:00:00.000Z',
          updatedAt: '2026-08-24T00:00:00.000Z'
        }
      ]
    });
    await db.initAsync();

    // Resolve it
    resolvePendingSharedReviewsForVideo({ db, mediaAssetId: 'vid-11111111', contentHash: HASH_A });

    const backup = {
      schemaVersion: 4,
      reviewers: db.reviewers,
      media_assets: db.mediaAssets,
      file_locations: db.fileLocations,
      rating_criteria: db.criteria,
      video_reviews: db.reviews,
      criterion_ratings: db.criterionRatings,
      tags: db.tags,
      review_tags: db.reviewTags,
      timeline_notes: db.timelineNotes,
      directory_sources: db.directorySources,
      genres: db.genres,
      evaluation_templates: db.templates,
      pending_shared_reviews: db.pendingSharedReviews
    };

    const db2 = createTestDb();
    await db2.initAsync();
    await db2.restoreWithRollback(backup, []);

    assert(db2.pendingSharedReviews.length === 0);
    assert(db2.reviews.length === 1);
    assert(db2.reviews[0].origin === 'imported');
  });

  console.groupEnd(); // Group 21
  return results;
}
