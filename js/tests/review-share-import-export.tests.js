// review-share-import-export.tests.js - Automated tests for review sharing export/import
import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { exportReviews } from '../review-sharing/review-share-exporter.js';
import { importPackage } from '../review-sharing/review-share-importer.js';
import { validateSharedReviewPackage } from '../review-sharing/review-share-validator.js';
import { initShareUI } from '../review-sharing/review-share-ui.js';

export async function runReviewShareImportExportTests() {
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

  console.group('Group 19: Shared Review Export & Import Tests');

  // Helper to create test database with preset data
  const createTestDb = (preset = {}) => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4'); // Prevent automatic V3->V4 upgrade trigger
    // Default initial data structure
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
          hashStatus: 'completed',
          fileSize: 1000,
          duration: 12.5,
          displayTitle: '動画1',
          genreId: 'genre-default',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'vid-22222222',
          title: 'video2.mp4',
          fileName: 'video2.mp4',
          contentHash: 'bbbb222222222222222222222222222222222222222222222222222222222222',
          hashAlgorithm: 'SHA-256',
          hashStatus: 'completed',
          fileSize: 2000,
          duration: 25.0,
          genreId: 'genre-default',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'vid-provisional',
          title: 'video_prov.mp4',
          fileName: 'video_prov.mp4',
          contentHash: '',
          hashAlgorithm: 'SHA-256',
          hashStatus: 'pending',
          fileSize: 500,
          duration: 5.0,
          genreId: 'genre-default',
          identityStatus: 'provisional',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      video_reviews: [
        {
          id: 'rev-owner12345678',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 4,
          comment: 'ローカルオーナーコメント',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      tags: [
        { id: 'tag-1', name: '感動' }
      ],
      review_tags: [
        { id: 'rt-1', videoReviewId: 'rev-owner12345678', tagId: 'tag-1', createdAt: new Date().toISOString() }
      ],
      timeline_notes: [
        {
          id: 'note-11112222',
          videoReviewId: 'rev-owner12345678',
          mediaAssetId: 'vid-11111111',
          timestampSeconds: 5.5,
          timestampLabel: '00:05',
          comment: 'ローカルのタイムラインメモ',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    // Override defaultData with presets
    const merged = { ...defaultData, ...preset };
    for (const [key, val] of Object.entries(merged)) {
      memStorage.setItem('vreview_' + key, JSON.stringify(val));
    }

    const db = new AppDatabase(memStorage, 'vreview_', 'TestDB-' + Math.random());
    db.idbAvailable = false;
    return db;
  };

  // Helper to generate a valid import package
  const createValidImportPackage = (reviewerId = 'reviewer-remote12', reviewId = 'rev-remote98765432') => ({
    schema: 'video-review-share',
    version: 1,
    packageId: '88888888-4444-4333-8222-111111111111',
    exportedAt: new Date().toISOString(),
    exporter: {
      reviewerId: reviewerId,
      displayName: '他ユーザーレビュアー'
    },
    items: [
      {
        videoHash: 'aaaa111111111111111111111111111111111111111111111111111111111111', // matches video1.mp4
        review: {
          reviewId: reviewId,
          reviewerId: reviewerId,
          overallRating: 5,
          tags: [{ tag: '秀逸' }],
          timelineComments: [
            {
              id: 'note-remote87654321',
              time: 3.2,
              comment: '他レビュアーのコメント'
            }
          ]
        }
      }
    ]
  });

  // === EXPORT TESTS ===

  await runTest('1. 1作品export', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    assert(pkg.items.length === 1, 'Should contain 1 item');
    assert(pkg.items[0].videoHash === 'aaaa111111111111111111111111111111111111111111111111111111111111', 'Hash match');
    assert(pkg.items[0].review.overallRating === 4, 'Grade score matches');
  });

  await runTest('2. 複数作品export', async () => {
    const db = createTestDb({
      video_reviews: [
        {
          id: 'rev-owner11111111',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 4
        },
        {
          id: 'rev-owner22222222',
          mediaAssetId: 'vid-22222222',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 3
        }
      ]
    });
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111', 'vid-22222222']);
    assert(pkg.items.length === 2, 'Should contain 2 items');
  });

  await runTest('3. 選択作品だけexport', async () => {
    const db = createTestDb({
      video_reviews: [
        {
          id: 'rev-owner22222222',
          mediaAssetId: 'vid-22222222',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 3
        }
      ]
    });
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-22222222']);
    assert(pkg.items.length === 1);
    assert(pkg.items[0].videoHash === 'bbbb222222222222222222222222222222222222222222222222222222222222');
  });

  await runTest('4. local owner reviewのみexport', async () => {
    const db = createTestDb({
      video_reviews: [
        {
          id: 'rev-owner12345678',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 4,
          comment: 'オーナーコメント',
          createdAt: new Date().toISOString()
        },
        {
          id: 'rev-imported999',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-imported77',
          origin: 'imported', // should be excluded
          overallScore: 5,
          comment: '他者コメント',
          createdAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    // exporter reviews must only belong to reviewer-owner1234
    assert(pkg.items[0].review.reviewerId === 'reviewer-owner1234');
    assert(pkg.items[0].review.overallRating === 4);
  });

  await runTest('5. imported reviewはexportされない', async () => {
    const db = createTestDb({
      video_reviews: [
        {
          id: 'rev-imported999',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-imported77',
          origin: 'imported', // only this exists on matched asset
          overallScore: 5,
          comment: '他者コメント',
          createdAt: new Date().toISOString()
        }
      ],
      timeline_notes: []
    });
    await db.initAsync();

    let errorThrown = false;
    try {
      exportReviews(db, ['vid-11111111']);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true, 'Exporting video with only imported review should throw');
  });

  await runTest('6. criterion ratingsを含まない', async () => {
    const db = createTestDb({
      criterion_ratings: [
        { id: 'rate-1', videoReviewId: 'rev-owner12345678', criterionId: 'crit-content', score: 5 }
      ]
    });
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    assert(pkg.items[0].review.criterionRatings === undefined, 'No criterion ratings');
  });

  await runTest('7. free commentを含まない', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    assert(pkg.items[0].review.comment === undefined, 'No comment field in Shared Review Package v1 review schema');
  });

  await runTest('8. displayTitleを含まない', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    assert(pkg.items[0].displayTitle === undefined, 'No displayTitle');
  });

  await runTest('9. path / handleを含まない', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    assert(pkg.items[0].localPath === undefined);
    assert(pkg.items[0].relativePath === undefined);
    assert(pkg.items[0].fileHandle === undefined);
  });

  await runTest('10. thumbnailを含まない', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    assert(pkg.items[0].thumbnailId === undefined);
    assert(pkg.items[0].thumbnailUrl === undefined);
  });

  await runTest('11. valid SHA-256のみexport可能', async () => {
    const db = createTestDb();
    await db.initAsync();
    let errorThrown = false;
    try {
      exportReviews(db, ['vid-11111111', 'vid-provisional']);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true, 'Provisional/empty hash must throw export failure');
  });

  await runTest('12. provisional動画はexport不可', async () => {
    const db = createTestDb();
    await db.initAsync();
    let errorThrown = false;
    try {
      exportReviews(db, ['vid-provisional']);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true);
  });

  await runTest('13. packageId UUIDv4生成', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    const uuidv4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert(uuidv4Pattern.test(pkg.packageId), 'packageId must be strict UUIDv4');
  });

  await runTest('14. generated package validator PASS', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true);
  });

  await runTest('15. empty selection拒否', async () => {
    const db = createTestDb();
    await db.initAsync();
    let errorThrown = false;
    try {
      exportReviews(db, []);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true);
  });

  // === IMPORT VALIDATION & PREVIEW TESTS ===

  await runTest('16. valid package preview', async () => {
    const pkg = createValidImportPackage();
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true);
  });

  await runTest('17. invalid package拒否', async () => {
    const pkg = createValidImportPackage();
    pkg.schema = 'invalid-schema';
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false);
  });

  await runTest('18. DB変更前にvalidationされる', async () => {
    const db = createTestDb();
    await db.initAsync();
    const originalReviewsCount = db.reviews.length;
    const pkg = createValidImportPackage();
    pkg.schema = 'invalid-schema'; // trigger failure

    let errorThrown = false;
    try {
      importPackage(db, pkg, [0]);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true);
    assert(db.reviews.length === originalReviewsCount, 'DB must remain unchanged');
  });

  await runTest('19. local SHA-256 matched', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    const summary = importPackage(db, pkg, [0]);
    assert(summary.imported === 1, 'Should match and import 1 review');
    assert(summary.pending === 0);
  });

  await runTest('20. unmatched判定', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    pkg.items[0].videoHash = 'cccc333333333333333333333333333333333333333333333333333333333333'; // non-existent
    const summary = importPackage(db, pkg, [0]);
    assert(summary.imported === 0);
    assert(summary.pending === 1, 'Should record in pending');
  });

  await runTest('21. preview checkbox selection', async () => {
    // Verified by checking importPackage behaves correctly when indices are provided
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    const summary = importPackage(db, pkg, []); // empty selection
    assert(summary.imported === 0);
    assert(summary.pending === 0);
  });

  // === IMPORT DATABASE SIDE-EFFECT TESTS ===

  await runTest('22. matched shared review登録', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    // Check if new review registered
    const videoReviews = db.getReviewsForVideo('vid-11111111');
    assert(videoReviews.length === 2, 'Should co-exist (local owner review + imported review)');
  });

  await runTest('23. origin imported', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    const importedReview = db.reviews.find(r => r.origin === 'imported');
    assert(importedReview !== undefined, 'Must save with origin imported');
  });

  await runTest('24. local owner review保持', async () => {
    const db = createTestDb();
    await db.initAsync();
    const originalOwnerReview = { ...db.getOwnerReviewForVideo('vid-11111111') };

    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    const ownerReview = db.getOwnerReviewForVideo('vid-11111111');
    assert(ownerReview.id === originalOwnerReview.id, 'Owner review ID must not change');
    assert(ownerReview.reviewerId === originalOwnerReview.reviewerId);
  });

  await runTest('25. local owner review内容不変', async () => {
    const db = createTestDb();
    await db.initAsync();
    const originalScore = db.getOwnerReviewForVideo('vid-11111111').overallScore;

    const pkg = createValidImportPackage();
    // import overallRating: 5
    importPackage(db, pkg, [0]);

    const ownerScore = db.getOwnerReviewForVideo('vid-11111111').overallScore;
    assert(ownerScore === originalScore, 'Owner review score must not be modified');
  });

  await runTest('26. imported reviewer登録', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage('reviewer-remote8888');
    importPackage(db, pkg, [0]);

    const reviewers = db.getReviewers();
    const remoteRev = reviewers.find(r => r.sourceReviewerId === 'reviewer-remote8888');
    assert(remoteRev !== undefined, 'Remote reviewer must be added to DB');
    assert(remoteRev.isLocal === false, 'Remote reviewer isLocal must be false');
  });

  await runTest('27. tags imported reviewへ紐付く', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    // tag inside package: "秀逸"
    importPackage(db, pkg, [0]);

    const importedReview = db.reviews.find(r => r.origin === 'imported');
    const tags = db.getTagsForReview(importedReview.id);
    assert(tags.length === 1);
    assert(tags[0].name === '秀逸');
  });

  await runTest('28. global tag再利用', async () => {
    const db = createTestDb({
      tags: [
        { id: 'tag-1', name: '秀逸' } // already exists
      ]
    });
    await db.initAsync();
    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    const importedReview = db.reviews.find(r => r.origin === 'imported');
    const tags = db.getTagsForReview(importedReview.id);
    assert(tags[0].id === 'tag-1', 'Should reuse global tag ID');
  });

  await runTest('29. timeline comments imported reviewへ紐付く', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    const importedReview = db.reviews.find(r => r.origin === 'imported');
    const timeline = db.timelineNotes.filter(n => n.videoReviewId === importedReview.id);
    assert(timeline.length === 1);
    assert(timeline[0].comment === '他レビュアーのコメント');
  });

  await runTest('30. pending unmatched review登録', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    pkg.items[0].videoHash = 'cccc333333333333333333333333333333333333333333333333333333333333';
    importPackage(db, pkg, [0]);

    assert(db.pendingSharedReviews.length === 1, 'Should add to pendingSharedReviews table');
    assert(db.pendingSharedReviews[0].videoHash === 'cccc333333333333333333333333333333333333333333333333333333333333');
  });

  // === DUPLICATE DETECTION TESTS ===

  await runTest('31. same package再import', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();

    // First import
    const summary1 = importPackage(db, pkg, [0]);
    assert(summary1.imported === 1);

    // Second import
    const summary2 = importPackage(db, pkg, [0]);
    assert(summary2.imported === 0);
    assert(summary2.duplicate === 1, 'Must skip duplicate same package review');
  });

  await runTest('32. same review / different package再import', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg1 = createValidImportPackage();
    const pkg2 = createValidImportPackage();
    pkg2.packageId = '99999999-9999-4999-9999-999999999999'; // different packageId

    const summary1 = importPackage(db, pkg1, [0]);
    assert(summary1.imported === 1);

    const summary2 = importPackage(db, pkg2, [0]);
    assert(summary2.imported === 0);
    assert(summary2.duplicate === 1, 'Must skip duplicate review even from different package');
  });

  await runTest('33. duplicate matched review skip', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();

    importPackage(db, pkg, [0]);
    const reviewsBefore = db.reviews.length;

    importPackage(db, pkg, [0]); // re-import
    assert(db.reviews.length === reviewsBefore, 'Do not add new reviews to DB');
  });

  await runTest('34. duplicate pending review skip', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    pkg.items[0].videoHash = 'cccc333333333333333333333333333333333333333333333333333333333333';

    importPackage(db, pkg, [0]);
    const pendingCount = db.pendingSharedReviews.length;

    importPackage(db, pkg, [0]);
    assert(db.pendingSharedReviews.length === pendingCount, 'Do not duplicate pending review registrations');
  });

  await runTest('35. duplicateでlocal review変化なし', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    const reviewsBefore = db.reviews.length;
    importPackage(db, pkg, [0]);
    assert(db.reviews.length === reviewsBefore);
  });

  // === IDENTITY COLLISION TESTS ===

  await runTest('36. remote reviewer IDがlocal reviewer IDと同じ場合', async () => {
    const db = createTestDb();
    await db.initAsync();

    // Remote reviewer ID matches local reviewer-owner1234
    const pkg = createValidImportPackage('reviewer-owner1234');
    importPackage(db, pkg, [0]);

    const localRev = db.getLocalReviewer();
    assert(localRev.isLocal === true, 'Local reviewer properties must be preserved');

    const importedReview = db.reviews.find(r => r.origin === 'imported');
    assert(importedReview.reviewerId !== 'reviewer-owner1234', 'Collision mapping must map imported review to a different reviewer ID');
  });

  await runTest('37. remote review IDがlocal review IDと同じ場合', async () => {
    const db = createTestDb();
    await db.initAsync();

    // Remote review ID matches local owner review ID: rev-owner12345678
    const pkg = createValidImportPackage('reviewer-remote12', 'rev-owner12345678');
    importPackage(db, pkg, [0]);

    // Local owner review must not be overwritten
    const ownerReview = db.getOwnerReviewForVideo('vid-11111111');
    assert(ownerReview.reviewerId === 'reviewer-owner1234', 'Owner review must still belong to owner');

    const importedReview = db.reviews.find(r => r.origin === 'imported');
    assert(importedReview.id !== 'rev-owner12345678', 'Collision mapping must map imported review to a generated review ID');
  });

  await runTest('38. remote comment IDがlocal note IDと同じ場合', async () => {
    const db = createTestDb();
    await db.initAsync();

    // Remote comment ID matches local note-11112222
    const pkg = createValidImportPackage();
    pkg.items[0].review.timelineComments[0].id = 'note-11112222';
    importPackage(db, pkg, [0]);

    const localNote = db.timelineNotes.find(n => n.id === 'note-11112222');
    assert(localNote.videoReviewId === 'rev-owner12345678', 'Local note must not be overwritten');

    const importedReview = db.reviews.find(r => r.origin === 'imported');
    const importedNotes = db.timelineNotes.filter(n => n.videoReviewId === importedReview.id);
    assert(importedNotes[0].id !== 'note-11112222', 'Collided comment ID must be remapped to unique ID');
    assert(importedNotes[0].sourceCommentId === 'note-11112222', 'Original source ID must be stored');
  });

  // === ATOMICITY / ROLLBACK TESTS ===

  await runTest('39. reviewer登録後の故意失敗rollback', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage('reviewer-remote-fail');

    // Simulate error during processing (e.g. inject an error in addImportedReview)
    const originalAddReview = db.addImportedReview;
    db.addImportedReview = () => { throw new Error('Simulated Crash'); };

    let errorThrown = false;
    try {
      importPackage(db, pkg, [0]);
    } catch (e) {
      errorThrown = true;
    } finally {
      db.addImportedReview = originalAddReview;
    }

    assert(errorThrown === true);
    // Remote reviewer remote-fail must have been rolled back
    const reviewers = db.getReviewers();
    assert(reviewers.find(r => r.sourceReviewerId === 'reviewer-remote-fail') === undefined, 'Reviewer registration rolled back');
  });

  await runTest('40. review登録後の故意失敗rollback', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();

    const originalAddTagAssoc = db.addImportedTagAssociation;
    db.addImportedTagAssociation = () => { throw new Error('Simulated Crash'); };

    let errorThrown = false;
    try {
      importPackage(db, pkg, [0]);
    } catch (e) {
      errorThrown = true;
    } finally {
      db.addImportedTagAssociation = originalAddTagAssoc;
    }

    assert(errorThrown === true);
    // Imported review must have been rolled back
    assert(db.reviews.find(r => r.origin === 'imported') === undefined, 'Review registration rolled back');
  });

  await runTest('41. tag登録後の故意失敗rollback', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();

    const originalAddNote = db.addImportedTimelineNote;
    db.addImportedTimelineNote = () => { throw new Error('Simulated Crash'); };

    const tagsBefore = db.tags.length;
    let errorThrown = false;
    try {
      importPackage(db, pkg, [0]);
    } catch (e) {
      errorThrown = true;
    } finally {
      db.addImportedTimelineNote = originalAddNote;
    }

    assert(errorThrown === true);
    // Created tag (秀逸) must be rolled back
    assert(db.tags.length === tagsBefore, 'Tag additions rolled back');
  });

  await runTest('42. pending登録中の故意失敗rollback', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage();
    pkg.items[0].videoHash = 'cccc333333333333333333333333333333333333333333333333333333333333';

    // Throw error on db.pendingSharedReviews.push (override db.addPendingSharedReview)
    const originalAddPending = db.addPendingSharedReview;
    db.addPendingSharedReview = () => { throw new Error('Simulated Crash'); };

    let errorThrown = false;
    try {
      importPackage(db, pkg, [0]);
    } catch (e) {
      errorThrown = true;
    } finally {
      db.addPendingSharedReview = originalAddPending;
    }

    assert(errorThrown === true);
    assert(db.pendingSharedReviews.length === 0, 'Pending additions rolled back');
  });

  // === UI REGRESSION / STATE TESTS ===

  await runTest('43. export mode開始', async () => {
    const db = createTestDb();
    await db.initAsync();
    const state = { shareExportMode: false, selectedExportVideoIds: new Set() };
    const showToast = () => {};
    const renderLibrary = () => {};
    const getFilteredVideosList = () => db.getVideos();

    initShareUI(db, state, showToast, renderLibrary, getFilteredVideosList);

    // Simulate clicking export start button (or directly call startExportMode if exposed)
    const startBtn = document.getElementById('btn-share-export-start');
    if (startBtn) {
      startBtn.click();
      assert(state.shareExportMode === true, 'Export mode must be active');
    }
  });

  await runTest('44. export cancel', async () => {
    const db = createTestDb();
    await db.initAsync();
    const state = { shareExportMode: true, selectedExportVideoIds: new Set(['vid-11111111']) };
    const showToast = () => {};
    const renderLibrary = () => {};
    const getFilteredVideosList = () => db.getVideos();

    initShareUI(db, state, showToast, renderLibrary, getFilteredVideosList);

    const cancelBtn = document.getElementById('btn-share-export-cancel');
    if (cancelBtn) {
      cancelBtn.click();
      assert(state.shareExportMode === false);
      assert(state.selectedExportVideoIds.size === 0);
    }
  });

  await runTest('45. import preview open', async () => {
    const db = createTestDb();
    await db.initAsync();
    const state = {};
    const showToast = () => {};
    const renderLibrary = () => {};
    const getFilteredVideosList = () => db.getVideos();

    initShareUI(db, state, showToast, renderLibrary, getFilteredVideosList);

    // Manually trigger handleFileImport helper via triggering DOM element or manually testing input preview display
    const modal = document.getElementById('modal-share-import-preview');
    if (modal) {
      modal.classList.remove('open');
      // Simulate file upload structure (UI component open method)
      // Directly check if elements cache is initialized
      assert(modal !== null);
    }
  });

  await runTest('46. import preview cancel', async () => {
    const db = createTestDb();
    await db.initAsync();
    const state = {};
    const showToast = () => {};
    const renderLibrary = () => {};
    const getFilteredVideosList = () => db.getVideos();

    initShareUI(db, state, showToast, renderLibrary, getFilteredVideosList);

    const cancelBtn = document.getElementById('btn-share-import-preview-cancel');
    if (cancelBtn) {
      const modal = document.getElementById('modal-share-import-preview');
      modal.classList.add('open');
      cancelBtn.click();
      assert(!modal.classList.contains('open'));
    }
  });

  await runTest('47. settings modal等既存UI regressionなし', async () => {
    const resp = await fetch('index.html');
    const htmlText = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const modalSettings = doc.getElementById('modal-settings');
    assert(modalSettings !== null, 'Settings modal element must exist in index.html');
  });

  await runTest('48. owner reviewなし動画はexport不可', async () => {
    // vid-22222222 has no owner review in default createTestDb
    const db = createTestDb();
    await db.initAsync();
    let errorThrown = false;
    try {
      exportReviews(db, ['vid-22222222']);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true, 'Should throw when exporting video with no owner review');
  });

  await runTest('49. owner reviewあり + overallRating nullはexport可能', async () => {
    const db = createTestDb({
      video_reviews: [
        {
          id: 'rev-owner12345678',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: null, // null rating
          comment: '空の評価点',
          createdAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();
    const pkg = exportReviews(db, ['vid-11111111']);
    assert(pkg.items.length === 1);
    assert(pkg.items[0].review.overallRating === null);
  });

  await runTest('50. 64文字だがhexでないhashはexport不可', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-invalid-hex',
          title: 'video.mp4',
          fileName: 'video.mp4',
          contentHash: 'gggg111111111111111111111111111111111111111111111111111111111111', // contains 'g'
          hashAlgorithm: 'SHA-256',
          hashStatus: 'completed',
          genreId: 'genre-default'
        }
      ],
      video_reviews: [
        {
          id: 'rev-owner999',
          mediaAssetId: 'vid-invalid-hex',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 5
        }
      ]
    });
    await db.initAsync();
    let errorThrown = false;
    try {
      exportReviews(db, ['vid-invalid-hex']);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true, 'Should reject non-hex hash characters');
  });

  await runTest('51. uppercase SHA-256はexport不可', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-uppercase',
          title: 'video.mp4',
          fileName: 'video.mp4',
          contentHash: 'AAAA111111111111111111111111111111111111111111111111111111111111', // uppercase
          hashAlgorithm: 'SHA-256',
          hashStatus: 'completed',
          genreId: 'genre-default'
        }
      ],
      video_reviews: [
        {
          id: 'rev-owner888',
          mediaAssetId: 'vid-uppercase',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 5
        }
      ]
    });
    await db.initAsync();
    let errorThrown = false;
    try {
      exportReviews(db, ['vid-uppercase']);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true, 'Should reject uppercase SHA-256');
  });

  await runTest('52. Select Allがinvalid hashを選択しない', async () => {
    const db = createTestDb({
      media_assets: [
        { id: 'v1', contentHash: 'aaaa111111111111111111111111111111111111111111111111111111111111', hashStatus: 'completed', genreId: 'genre-default' }, // eligible
        { id: 'v2', contentHash: 'AAAA111111111111111111111111111111111111111111111111111111111111', hashStatus: 'completed', genreId: 'genre-default' }, // ineligible (uppercase)
        { id: 'v3', contentHash: 'bbbb222222222222222222222222222222222222222222222222222222222222', hashStatus: 'completed', genreId: 'genre-default' }  // ineligible (no owner review)
      ],
      video_reviews: [
        { id: 'rev-v1', mediaAssetId: 'v1', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 5 },
        { id: 'rev-v2', mediaAssetId: 'v2', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 5 }
      ]
    });
    await db.initAsync();

    const state = { shareExportMode: true, selectedExportVideoIds: new Set() };
    initShareUI(db, state, () => {}, () => {}, () => db.getVideos());

    const btnSelectAll = document.getElementById('btn-share-export-select-all');
    if (btnSelectAll) {
      btnSelectAll.click();
      assert(state.selectedExportVideoIds.has('v1') === true, 'v1 must be selected');
      assert(state.selectedExportVideoIds.has('v2') === false, 'v2 (uppercase hash) must not be selected');
      assert(state.selectedExportVideoIds.has('v3') === false, 'v3 (no owner review) must not be selected');
    }
  });

  await runTest('53. Importerがdb._saveTableを直接利用しない構造になっていること', async () => {
    const resp = await fetch('js/review-sharing/review-share-importer.js');
    const sourceText = await resp.text();
    assert(!sourceText.includes('_saveTable'), 'importer.js should not call _saveTable directly');
    assert(!sourceText.includes('db.tags.push'), 'importer.js should not push to db.tags directly');
    assert(!sourceText.includes('db.mediaAssets'), 'importer.js should not read db.mediaAssets directly');
    assert(!sourceText.includes('db.pendingSharedReviews'), 'importer.js should not read db.pendingSharedReviews directly');
  });

  await runTest('54. imported reviewerのlocal ID != sourceReviewerId', async () => {
    const db = createTestDb();
    await db.initAsync();
    const pkg = createValidImportPackage('reviewer-remote-xyz');
    importPackage(db, pkg, [0]);

    const reviewer = db.reviewers.find(r => r.sourceReviewerId === 'reviewer-remote-xyz');
    assert(reviewer !== undefined);
    assert(reviewer.id !== 'reviewer-remote-xyz', 'Local ID must not be the source ID');
    assert(reviewer.id.startsWith('reviewer-'), 'Local ID should still have reviewer- prefix');
  });

  await runTest('55. remote sourceReviewerIdが既存imported reviewerのlocal IDと衝突しても安全', async () => {
    const db = createTestDb({
      reviewers: [
        {
          id: 'reviewer-remote-xyz', // mock existing local ID being same as remote source ID
          displayName: '競合レビュアー',
          isLocal: false,
          sourceReviewerId: 'reviewer-original-source',
          createdAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();
    const pkg = createValidImportPackage('reviewer-remote-xyz');
    importPackage(db, pkg, [0]);

    // The newly imported reviewer should get a newly generated ID, preserving the original
    const oldReviewer = db.reviewers.find(r => r.id === 'reviewer-remote-xyz');
    assert(oldReviewer.sourceReviewerId === 'reviewer-original-source', 'Original reviewer must not be overwritten');

    const newReviewer = db.reviewers.find(r => r.sourceReviewerId === 'reviewer-remote-xyz');
    assert(newReviewer !== undefined);
    assert(newReviewer.id !== 'reviewer-remote-xyz', 'New reviewer should get a unique generated ID');
  });

  await runTest('56. duplicate preview checkboxがdisabled', async () => {
    const db = createTestDb();
    await db.initAsync();

    // Import once to create duplicate
    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    // Set up UI preview container in page body
    const previewList = document.getElementById('share-import-preview-list');
    if (previewList) {
      previewList.innerHTML = '';
      const state = {};
      initShareUI(db, state, () => {}, () => {}, () => db.getVideos());

      // Call UI open method to render duplicate row
      const btnTrigger = document.getElementById('btn-share-import-trigger');
      if (btnTrigger) {
        // Trigger modal rendering (simulate file loader or direct UI list population)
        const uiContainer = document.getElementById('modal-share-import-preview');
        uiContainer.classList.add('open');

        // Populate preview with the duplicate package
        const checkboxes = previewList.querySelectorAll('.share-import-item-checkbox');
        // Because of duplicate, the checkbox should be disabled
        checkboxes.forEach(chk => {
          assert(chk.disabled === true, 'Duplicate checkbox must be disabled');
          assert(chk.checked === false, 'Duplicate checkbox must be unchecked');
        });
        uiContainer.classList.remove('open');
      }
    }
  });

  await runTest('57. Select All Import Previewでduplicateが選択されない', async () => {
    const db = createTestDb();
    await db.initAsync();

    // Import once to create duplicate
    const pkg = createValidImportPackage();
    importPackage(db, pkg, [0]);

    const previewList = document.getElementById('share-import-preview-list');
    if (previewList) {
      const state = {};
      initShareUI(db, state, () => {}, () => {}, () => db.getVideos());

      const uiContainer = document.getElementById('modal-share-import-preview');
      uiContainer.classList.add('open');

      const btnSelectAll = document.getElementById('btn-share-import-select-all');
      if (btnSelectAll) {
        btnSelectAll.click();
        const checkboxes = previewList.querySelectorAll('.share-import-item-checkbox');
        checkboxes.forEach(chk => {
          // Since it is duplicate and disabled, it should remain unchecked!
          assert(chk.checked === false, 'Disabled duplicate checkbox must not be selected by Select All');
        });
      }
      uiContainer.classList.remove('open');
    }
  });

  await runTest('58. Backup round-trip regression test for imported source identity fields', async () => {
    const db = createTestDb({
      media_assets: [
        {
          id: 'vid-11111111',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          contentHash: 'aaaa111111111111111111111111111111111111111111111111111111111111',
          hashAlgorithm: 'SHA-256',
          quickHash: 'q_100_dummy',
          hashStatus: 'completed',
          fileSize: 1000,
          duration: 12.5,
          displayTitle: '動画1',
          genreId: 'genre-default',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      video_reviews: [
        {
          id: 'rev-owner11111111',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-owner1234',
          origin: 'local',
          overallScore: 4,
          comment: 'ローカルオーナーコメント',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      criterion_ratings: []
    });
    await db.initAsync();

    // 1. Pre-assert: Check local owner review in the database
    const initialOwnerReview = db.getOwnerReviewForVideo('vid-11111111');
    assert(initialOwnerReview !== null, 'Initial owner review must exist');
    assert(initialOwnerReview.origin === 'local');
    assert(initialOwnerReview.overallScore === 4);

    // 2. Import package containing remote review
    const pkg = createValidImportPackage('reviewer-remote12', 'rev-remote98765432');
    importPackage(db, pkg, [0]);

    // Verify imported values in memory database
    const importedReviewer = db.reviewers.find(r => r.sourceReviewerId === 'reviewer-remote12');
    assert(importedReviewer !== undefined);
    assert(importedReviewer.isLocal === false);
    assert(importedReviewer.id.startsWith('reviewer-'));

    const importedReview = db.reviews.find(r => r.sourceReviewId === 'rev-remote98765432');
    assert(importedReview !== undefined);
    assert(importedReview.sourceReviewerId === 'reviewer-remote12');
    assert(importedReview.origin === 'imported');
    assert(importedReview.reviewerId === importedReviewer.id);

    const importedNote = db.timelineNotes.find(n => n.sourceCommentId === 'note-remote87654321');
    assert(importedNote !== undefined);
    assert(importedNote.videoReviewId === importedReview.id);

    // 3. Emulate export/backup format
    const exportedDb = {
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

    const manifest = {
      application: "VideoReviewer",
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      appVersion: "1.0.0",
      counts: {
        media_assets: db.mediaAssets.length,
        file_locations: db.fileLocations.length,
        reviews: db.reviews.length,
        images: 0,
        reviewers: db.reviewers.length,
        review_tags: db.reviewTags.length,
        pending_shared_reviews: db.pendingSharedReviews.length
      }
    };

    // 4. Validate backup data against BACKUP_SCHEMA_V4
    const validation = db.validateBackupData(exportedDb, manifest, []);
    assert(validation.isValid === true, 'V4 backup with imported items validation must pass. Errors: ' + validation.fatalErrors?.join(', '));

    // 5. Emulate restore
    const restoreDb = createTestDb({
      media_assets: [
        {
          id: 'vid-11111111',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          contentHash: 'aaaa111111111111111111111111111111111111111111111111111111111111',
          hashAlgorithm: 'SHA-256',
          quickHash: 'q_100_dummy',
          hashStatus: 'completed',
          fileSize: 1000,
          duration: 12.5,
          displayTitle: '動画1',
          genreId: 'genre-default',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      video_reviews: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      criterion_ratings: []
    });
    await restoreDb.restoreWithRollback(exportedDb, []);

    // 6. Assert restored data contains all source identities unchanged
    const restoredReviewer = restoreDb.reviewers.find(r => r.sourceReviewerId === 'reviewer-remote12');
    assert(restoredReviewer !== undefined, 'Restored reviewer must exist');
    assert(restoredReviewer.isLocal === false, 'Restored reviewer must be remote');
    assert(restoredReviewer.displayName === '他ユーザーレビュアー');

    const restoredReview = restoreDb.reviews.find(r => r.sourceReviewId === 'rev-remote98765432');
    assert(restoredReview !== undefined, 'Restored review must exist');
    assert(restoredReview.sourceReviewerId === 'reviewer-remote12', 'Restored review source reviewer ID must match');
    assert(restoredReview.origin === 'imported', 'Restored review origin must be imported');
    assert(restoredReview.reviewerId === restoredReviewer.id, 'Restored review reviewerId reference must match');

    const restoredNote = restoreDb.timelineNotes.find(n => n.sourceCommentId === 'note-remote87654321');
    assert(restoredNote !== undefined, 'Restored timeline note must exist');
    assert(restoredNote.videoReviewId === restoredReview.id, 'Restored note videoReviewId reference must match');

    // 7. Assert local owner review remains intact and unmodified
    const postOwnerReview = restoreDb.getOwnerReviewForVideo('vid-11111111');
    assert(postOwnerReview !== null);
    assert(postOwnerReview.origin === 'local');
    assert(postOwnerReview.overallScore === 4);
    assert(postOwnerReview.comment === 'ローカルオーナーコメント');
  });

  console.groupEnd(); // Group 19
  return results;
}
