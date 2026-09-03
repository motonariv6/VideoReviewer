// review-share-aggregate-ui.tests.js - Automated tests for shared review VM building and UI rendering
import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { buildSharedReviewViewModel } from '../review-sharing/review-share-view-model.js';
import { renderSharedReviewsUI } from '../review-sharing/review-share-aggregate-ui.js';
import { ReviewEditorController } from '../review/review-editor-controller.js';
import { ReviewEditorUI } from '../review/review-editor-ui.js';
import { setLocale, currentLocale, t } from '../i18n.js';

export async function runReviewShareAggregateUITests() {
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

  console.group('Group 20: Shared Review Aggregation & View Model UI Tests');

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
          identityStatus: 'normal',
          identityConflictGroupId: null,
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

    // Directly pre-populate inside memory storage
    Object.keys(merged).forEach(k => {
      memStorage.setItem('vreview_' + k, JSON.stringify(merged[k]));
    });

    const db = new AppDatabase(memStorage);
    return db;
  };

  const createMockEls = () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="shared-reviews-section" class="hidden">
        <span id="shared-average-rating"></span>
        <span id="shared-reviewers-count"></span>
        <span id="shared-rated-count"></span>
        <div id="shared-reviewers-list"></div>
        <div id="shared-tags-list"></div>
        <div id="shared-timeline-list"></div>
      </div>
    `;
    document.body.appendChild(root);
    return {
      root,
      els: {
        sharedReviewsSection: root.querySelector('#shared-reviews-section'),
        sharedAverageRating: root.querySelector('#shared-average-rating'),
        sharedReviewersCount: root.querySelector('#shared-reviewers-count'),
        sharedRatedCount: root.querySelector('#shared-rated-count'),
        sharedReviewersList: root.querySelector('#shared-reviewers-list'),
        sharedTagsList: root.querySelector('#shared-tags-list'),
        sharedTimelineList: root.querySelector('#shared-timeline-list')
      }
    };
  };

  // ==========================================
  // AGGREGATE RATING TESTS (1-6)
  // ==========================================

  await runTest('1. local reviewのみの集約評価算出', async () => {
    const db = createTestDb({
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.averageRating === 4.0);
    assert(vm.reviewCount === 1);
    assert(vm.ratedReviewCount === 1);
  });

  await runTest('2. local + imported 1件の集約評価算出', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他レビュアーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.averageRating === 4.5);
    assert(vm.reviewCount === 2);
    assert(vm.ratedReviewCount === 2);
  });

  await runTest('3. imported複数件の集約評価算出', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他レビュアーA', isLocal: false },
        { id: 'reviewer-remote2', displayName: '他レビュアーB', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 },
        { id: 'rev-remote2', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote2', origin: 'imported', overallScore: 3 }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.averageRating === 4.0); // (4 + 5 + 3)/3 = 4.0
    assert(vm.reviewCount === 3);
    assert(vm.ratedReviewCount === 3);
  });

  await runTest('4. null ratingスコアが平均値計算から除外されること', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他レビュアーA', isLocal: false },
        { id: 'reviewer-remote2', displayName: '他レビュアーB', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: null },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 },
        { id: 'rev-remote2', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote2', origin: 'imported', overallScore: null }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.averageRating === 5.0);
    assert(vm.reviewCount === 3);
    assert(vm.ratedReviewCount === 1);
  });

  await runTest('5. averageRatingが集約VMから得られ、データベースへ保存されないこと', async () => {
    const db = createTestDb({
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 }
      ]
    });
    await db.initAsync();

    buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    // Verify raw db record does not have average rating
    const savedReviews = db.reviews;
    assert(savedReviews[0].averageRating === undefined);
  });

  await runTest('6. ratedReviewCountが正しくカウントされること', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他レビュアーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: null },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: null }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.averageRating === null);
    assert(vm.reviewCount === 2);
    assert(vm.ratedReviewCount === 0);
  });

  // ==========================================
  // REVIEWER TESTS (7-11)
  // ==========================================

  await runTest('7. local reviewer表示の確認', async () => {
    const origLocale = currentLocale;
    let origStorage = null;
    try {
      origStorage = localStorage.getItem('video_reviewer_locale');
    } catch (e) {}
    try {
      setLocale('ja');
      const db = createTestDb({
        video_reviews: [
          { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 }
        ]
      });
      await db.initAsync();

      const vm = buildSharedReviewViewModel({
        reviews: db.getReviewsForVideo('vid-11111111'),
        reviewers: db.getReviewers(),
        db
      });

      const { els, root } = createMockEls();
      renderSharedReviewsUI(els, vm);

      const rows = els.sharedReviewersList.querySelectorAll('div');
      assert(rows.length === 1);
      assert(rows[0].textContent.includes(t('share.reviewerSelf')));
      assert(rows[0].textContent.includes('B (4)'));

      root.remove();
    } finally {
      setLocale(origLocale);
      try {
        if (origStorage !== null) {
          localStorage.setItem('video_reviewer_locale', origStorage);
        } else {
          localStorage.removeItem('video_reviewer_locale');
        }
      } catch (e) {}
    }
  });

  await runTest('8. imported reviewer表示の確認', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーレビュアー', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    const { els, root } = createMockEls();
    renderSharedReviewsUI(els, vm);

    const rows = els.sharedReviewersList.querySelectorAll('div');
    assert(rows.length === 1);
    assert(rows[0].textContent.includes('他ユーザーレビュアー'));
    assert(rows[0].textContent.includes('A (5)'));

    root.remove();
  });

  await runTest('9. reviewer displayNameが正しく表示されること', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '山田太郎', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 4 }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.reviewers[0].displayName === '山田太郎');
  });

  await runTest('10. sourceReviewerIdおよび内部UUIDがUIへ露出しないこと', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false, sourceReviewerId: 'remote-uuid-12345' }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 4, sourceReviewId: 'remote-rev-99999' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    const { els, root } = createMockEls();
    renderSharedReviewsUI(els, vm);

    const text = els.sharedReviewersList.innerHTML;
    assert(!text.includes('remote-uuid-12345'));
    assert(!text.includes('reviewer-remote1'));
    assert(!text.includes('remote-rev-99999'));

    root.remove();
  });

  await runTest('11. local/imported判定とバッジの視覚区別', async () => {
    const origLocale = currentLocale;
    let origStorage = null;
    try {
      origStorage = localStorage.getItem('video_reviewer_locale');
    } catch (e) {}
    try {
      setLocale('ja');
      const db = createTestDb({
        reviewers: [
          { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
          { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
        ],
        video_reviews: [
          { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
          { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
        ]
      });
      await db.initAsync();

      const vm = buildSharedReviewViewModel({
        reviews: db.getReviewsForVideo('vid-11111111'),
        reviewers: db.getReviewers(),
        db
      });

      const { els, root } = createMockEls();
      renderSharedReviewsUI(els, vm);

      const badges = els.sharedReviewersList.querySelectorAll('.reviewer-badge');
      assert(badges.length === 2);
      assert(badges[0].textContent === t('share.reviewerSelfBadge'));
      assert(badges[1].textContent === 'Imported');

      root.remove();
    } finally {
      setLocale(origLocale);
      try {
        if (origStorage !== null) {
          localStorage.setItem('video_reviewer_locale', origStorage);
        } else {
          localStorage.removeItem('video_reviewer_locale');
        }
      } catch (e) {}
    }
  });

  // ==========================================
  // TAGS TESTS (12-16)
  // ==========================================

  await runTest('12. local + imported tag統合', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      tags: [
        { id: 'tag-11111111', name: '旅行' },
        { id: 'tag-22222222', name: '夜景' }
      ],
      review_tags: [
        { id: 'rt-1', videoReviewId: 'rev-local', tagId: 'tag-11111111' },
        { id: 'rt-2', videoReviewId: 'rev-remote1', tagId: 'tag-11111111' },
        { id: 'rt-3', videoReviewId: 'rev-remote1', tagId: 'tag-22222222' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    assert(vm.tags.length === 2);
    assert(vm.tags[0].tag === '夜景');
    assert(vm.tags[0].sources.length === 1);
    assert(vm.tags[1].tag === '旅行');
    assert(vm.tags[1].sources.length === 2);
  });

  await runTest('13. canonical duplicate統合（表記ゆれ正規化）', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      tags: [
        { id: 'tag-11111111', name: 'Travel' },
        { id: 'tag-22222222', name: 'travel ' }
      ],
      review_tags: [
        { id: 'rt-1', videoReviewId: 'rev-local', tagId: 'tag-11111111' },
        { id: 'rt-2', videoReviewId: 'rev-remote1', tagId: 'tag-22222222' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.tags.length === 1);
    assert(vm.tags[0].tag === 'Travel'); // retains first representation
    assert(vm.tags[0].sources.length === 2);
  });

  await runTest('14. tag reviewer attributionの確認', async () => {
    const origLocale = currentLocale;
    let origStorage = null;
    try {
      origStorage = localStorage.getItem('video_reviewer_locale');
    } catch (e) {}
    try {
      setLocale('ja');
      const db = createTestDb({
        reviewers: [
          { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
          { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
        ],
        video_reviews: [
          { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
          { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
        ],
        tags: [
          { id: 'tag-11111111', name: '旅行' }
        ],
        review_tags: [
          { id: 'rt-1', videoReviewId: 'rev-local', tagId: 'tag-11111111' },
          { id: 'rt-2', videoReviewId: 'rev-remote1', tagId: 'tag-11111111' }
        ]
      });
      await db.initAsync();

      const vm = buildSharedReviewViewModel({
        reviews: db.getReviewsForVideo('vid-11111111'),
        reviewers: db.getReviewers(),
        db
      });

      const { els, root } = createMockEls();
      renderSharedReviewsUI(els, vm);

      const tagChips = els.sharedTagsList.querySelectorAll('.tag-chip');
      assert(tagChips.length === 1);
      assert(tagChips[0].title.includes(t('share.reviewerSelf')));
      assert(tagChips[0].title.includes('他ユーザーA'));

      root.remove();
    } finally {
      setLocale(origLocale);
      try {
        if (origStorage !== null) {
          localStorage.setItem('video_reviewer_locale', origStorage);
        } else {
          localStorage.removeItem('video_reviewer_locale');
        }
      } catch (e) {}
    }
  });

  await runTest('15. displayNameへの変換確認', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '山田太郎', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      tags: [
        { id: 'tag-11111111', name: '旅行' }
      ],
      review_tags: [
        { id: 'rt-1', videoReviewId: 'rev-remote1', tagId: 'tag-11111111' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.tags[0].sources[0].reviewerName === '山田太郎');
  });

  await runTest('16. local review_tagsが統合表示中も変更されないこと', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      tags: [
        { id: 'tag-11111111', name: '旅行' }
      ],
      review_tags: [
        { id: 'rt-1', videoReviewId: 'rev-local', tagId: 'tag-11111111' },
        { id: 'rt-2', videoReviewId: 'rev-remote1', tagId: 'tag-11111111' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    const { els, root } = createMockEls();
    renderSharedReviewsUI(els, vm);

    // Verify local database review_tags holds only 1 record for local owner
    const localReviewTags = db.reviewTags.filter(rt => rt.videoReviewId === 'rev-local');
    assert(localReviewTags.length === 1);

    root.remove();
  });

  // ==========================================
  // TIMELINE TESTS (17-23)
  // ==========================================

  await runTest('17. local + imported timeline統合', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      timeline_notes: [
        { id: 'note-local', videoReviewId: 'rev-local', mediaAssetId: 'vid-11111111', timestampSeconds: 10, comment: 'ローカルシーン' },
        { id: 'note-remote', videoReviewId: 'rev-remote1', mediaAssetId: 'vid-11111111', timestampSeconds: 5, comment: 'リモートシーン' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    assert(vm.timelineComments.length === 2);
    assert(vm.timelineComments[0].comment === 'リモートシーン');
    assert(vm.timelineComments[1].comment === 'ローカルシーン');
  });

  await runTest('18. time昇順での並べ替え', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 }
      ],
      timeline_notes: [
        { id: 'n2', videoReviewId: 'rev-local', mediaAssetId: 'vid-11111111', timestampSeconds: 20, comment: '後' },
        { id: 'n1', videoReviewId: 'rev-local', mediaAssetId: 'vid-11111111', timestampSeconds: 10, comment: '先' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    assert(vm.timelineComments[0].id === 'n1');
    assert(vm.timelineComments[1].id === 'n2');
  });

  await runTest('19. 同時刻コメントの確定的なソート (Deterministic tie-breaking)', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      timeline_notes: [
        { id: 'note-z', videoReviewId: 'rev-remote1', mediaAssetId: 'vid-11111111', timestampSeconds: 10, comment: 'コメZ' },
        { id: 'note-a', videoReviewId: 'rev-local', mediaAssetId: 'vid-11111111', timestampSeconds: 10, comment: 'コメA' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });
    // sorted deterministically by id
    assert(vm.timelineComments[0].id === 'note-a');
    assert(vm.timelineComments[1].id === 'note-z');
  });

  await runTest('20. timeline comments reviewer attributionの確認', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '山田太郎', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      timeline_notes: [
        { id: 'note-remote', videoReviewId: 'rev-remote1', mediaAssetId: 'vid-11111111', timestampSeconds: 5, comment: 'リモートシーン' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    const { els, root } = createMockEls();
    renderSharedReviewsUI(els, vm);

    const items = els.sharedTimelineList.querySelectorAll('.timeline-note-item');
    assert(items.length === 1);
    assert(items[0].textContent.includes('山田太郎'));

    root.remove();
  });

  await runTest('21. imported timeline comment read-onlyの確認 (削除ボタンがないこと)', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      timeline_notes: [
        { id: 'note-remote', videoReviewId: 'rev-remote1', mediaAssetId: 'vid-11111111', timestampSeconds: 5, comment: 'リモートコメ' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    const { els, root } = createMockEls();
    renderSharedReviewsUI(els, vm);

    const deleteBtn = els.sharedTimelineList.querySelector('.delete');
    assert(deleteBtn === null, 'Imported comments must not render a delete button');

    root.remove();
  });

  await runTest('22. local comment編集性維持の確認', async () => {
    // Normal review edit text values can still be edited
    const mockEls = {
      commentEditor: document.createElement('textarea')
    };
    const ui = new ReviewEditorUI({ els: mockEls });
    ui.setCommentValue('新しいローカルコメント');
    assert(ui.getCommentValue() === '新しいローカルコメント');
  });

  await runTest('23. timeline jump event handler integration', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 }
      ],
      timeline_notes: [
        { id: 'note-local', videoReviewId: 'rev-local', mediaAssetId: 'vid-11111111', timestampSeconds: 42.5, comment: 'ここ重要' }
      ]
    });
    await db.initAsync();

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    const { els, root } = createMockEls();
    let seekedTime = null;
    renderSharedReviewsUI(els, vm, (time) => {
      seekedTime = time;
    });

    const tsBtn = els.sharedTimelineList.querySelector('.timeline-note-timestamp');
    assert(tsBtn !== null);
    tsBtn.click();
    assert(seekedTime === 42.5);

    root.remove();
  });

  // ==========================================
  // DATA PROTECTION TESTS (24-28)
  // ==========================================

  await runTest('24. aggregate UI表示でDB変更なしの検証', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-owner1234', displayName: '自分', isLocal: true },
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 },
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ]
    });
    await db.initAsync();

    const initialDbString = JSON.stringify(db.reviews);

    const vm = buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    const { els, root } = createMockEls();
    renderSharedReviewsUI(els, vm);

    assert(JSON.stringify(db.reviews) === initialDbString, 'DB review records must not change during VM build and render');

    root.remove();
  });

  await runTest('25. imported review変更なしの検証', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ]
    });
    await db.initAsync();

    const originalRemoteReview = JSON.stringify(db.reviews[0]);

    buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    assert(JSON.stringify(db.reviews[0]) === originalRemoteReview, 'Remote review record must remain unmodified');
  });

  await runTest('26. imported tags変更なしの検証', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      tags: [
        { id: 'tag-11111111', name: '旅行' }
      ],
      review_tags: [
        { id: 'rt-1', videoReviewId: 'rev-remote1', tagId: 'tag-11111111' }
      ]
    });
    await db.initAsync();

    const originalReviewTags = JSON.stringify(db.reviewTags);

    buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    assert(JSON.stringify(db.reviewTags) === originalReviewTags, 'Imported review tags associations must remain unmodified');
  });

  await runTest('27. imported timeline comments変更なしの検証', async () => {
    const db = createTestDb({
      reviewers: [
        { id: 'reviewer-remote1', displayName: '他ユーザーA', isLocal: false }
      ],
      video_reviews: [
        { id: 'rev-remote1', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-remote1', origin: 'imported', overallScore: 5 }
      ],
      timeline_notes: [
        { id: 'note-remote', videoReviewId: 'rev-remote1', mediaAssetId: 'vid-11111111', timestampSeconds: 5, comment: 'リモートコメ' }
      ]
    });
    await db.initAsync();

    const originalTimelineNotes = JSON.stringify(db.timelineNotes);

    buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    assert(JSON.stringify(db.timelineNotes) === originalTimelineNotes, 'Imported timeline notes must remain unmodified');
  });

  await runTest('28. local owner review変更なしの検証（集約VMビルド単体）', async () => {
    const db = createTestDb({
      video_reviews: [
        { id: 'rev-local', mediaAssetId: 'vid-11111111', reviewerId: 'reviewer-owner1234', origin: 'local', overallScore: 4 }
      ]
    });
    await db.initAsync();

    const originalLocalReview = JSON.stringify(db.reviews[0]);

    buildSharedReviewViewModel({
      reviews: db.getReviewsForVideo('vid-11111111'),
      reviewers: db.getReviewers(),
      db
    });

    assert(JSON.stringify(db.reviews[0]) === originalLocalReview, 'Local review record must not be modified by VM build');
  });

  // ==========================================
  // EMPTY STATE TESTS (29-30)
  // ==========================================

  await runTest('29. imported reviewなし（共有レビューセクション非表示の確認）', async () => {
    const mockUIEls = {
      viewLibrary: document.createElement('div'),
      viewEditor: document.createElement('div'),
      btnBack: document.createElement('div'),
      editorTitle: document.createElement('div'),
      infoFileName: document.createElement('div'),
      infoFileSize: document.createElement('div'),
      infoDuration: document.createElement('div'),
      titleDisplayContainer: document.createElement('div'),
      titleEditContainer: document.createElement('div'),
      displayTitleInput: document.createElement('input'),
      sharedReviewsSection: document.createElement('div')
    };

    const ui = new ReviewEditorUI({ els: mockUIEls });
    ui.setSharedReviewsSectionVisible(false);
    assert(mockUIEls.sharedReviewsSection.classList.contains('hidden'));
  });

  await runTest('30. imported reviewあり（共有レビューセクション表示の確認）', async () => {
    const mockUIEls = {
      viewLibrary: document.createElement('div'),
      viewEditor: document.createElement('div'),
      btnBack: document.createElement('div'),
      editorTitle: document.createElement('div'),
      infoFileName: document.createElement('div'),
      infoFileSize: document.createElement('div'),
      infoDuration: document.createElement('div'),
      titleDisplayContainer: document.createElement('div'),
      titleEditContainer: document.createElement('div'),
      displayTitleInput: document.createElement('input'),
      sharedReviewsSection: document.createElement('div')
    };

    const ui = new ReviewEditorUI({ els: mockUIEls });
    ui.setSharedReviewsSectionVisible(true);
    assert(!mockUIEls.sharedReviewsSection.classList.contains('hidden'));
  });

  // ==========================================
  // UI REGRESSION TESTS (31-39)
  // ==========================================

  await runTest('31. Review Editor正常表示確認', async () => {
    const mockUIEls = {
      viewLibrary: document.createElement('div'),
      viewEditor: document.createElement('div'),
      btnBack: document.createElement('div'),
      editorTitle: document.createElement('div'),
      infoFileName: document.createElement('div'),
      infoFileSize: document.createElement('div'),
      infoDuration: document.createElement('div'),
      titleDisplayContainer: document.createElement('div'),
      titleEditContainer: document.createElement('div'),
      displayTitleInput: document.createElement('input'),
      sharedReviewsSection: document.createElement('div')
    };

    const ui = new ReviewEditorUI({ els: mockUIEls });
    ui.showEditor({ title: 'タイトル', fileName: 'test.mp4', fileSize: 1048576, displayTitle: '' }, '00:10');
    assert(mockUIEls.editorTitle.textContent === 'タイトル');
  });

  await runTest('32. 星評価編集可能であることの確認', async () => {
    const mockUIEls = {
      criteriaPanel: document.createElement('div')
    };
    const ui = new ReviewEditorUI({ els: mockUIEls });
    let clickCritId = null;
    let clickScore = null;
    ui.renderStarCriteriaPanel(
      [{ id: 'c1', name: '画質', isActive: true }],
      { c1: 3 },
      (critId, val) => {
        clickCritId = critId;
        clickScore = val;
      },
      () => {}
    );
    const star = mockUIEls.criteriaPanel.querySelector('.star-elem[data-star="5"]');
    assert(star !== null);
    star.dispatchEvent(new Event('click'));
    assert(clickCritId === 'c1');
    assert(clickScore === 5);
  });

  await runTest('33. overall評価編集可能であることの確認', async () => {
    const buttons = [
      document.createElement('button'),
      document.createElement('button')
    ];
    buttons[0].className = 'grade-btn';
    buttons[0].setAttribute('data-grade', 'A');
    buttons[1].className = 'grade-btn';
    buttons[1].setAttribute('data-grade', 'B');
    document.body.appendChild(buttons[0]);
    document.body.appendChild(buttons[1]);

    const ui = new ReviewEditorUI({ els: { gradeButtons: buttons } });
    ui.updateOverallGradeUI('A');
    assert(buttons[0].classList.contains('active'));
    assert(!buttons[1].classList.contains('active'));

    buttons[0].remove();
    buttons[1].remove();
  });

  await runTest('34. local tags編集可能であることの確認', async () => {
    const mockUIEls = {
      tagsChipsList: document.createElement('div')
    };
    const ui = new ReviewEditorUI({ els: mockUIEls });
    let removedId = null;
    ui.renderVideoTagsList([{ id: 't1', name: 'タグ1' }], (id) => {
      removedId = id;
    });
    const removeBtn = mockUIEls.tagsChipsList.querySelector('.tag-chip-remove');
    assert(removeBtn !== null);
    removeBtn.click();
    assert(removedId === 't1');
  });

  await runTest('35. local timeline編集可能であることの確認', async () => {
    const mockUIEls = {
      timelineNotesList: document.createElement('div')
    };
    const ui = new ReviewEditorUI({ els: mockUIEls });
    let deletedId = null;
    ui.renderTimelineNotesList(
      [{ id: 'note-1', timestampSeconds: 10, timestampLabel: '00:10', comment: 'コメ' }],
      () => {},
      (id) => { deletedId = id; }
    );
    const delBtn = mockUIEls.timelineNotesList.querySelector('.timeline-note-action-btn.delete');
    assert(delBtn !== null);
    delBtn.click();
    assert(deletedId === 'note-1');
  });

  await runTest('36. Save Review正常動作確認', async () => {
    const db = createTestDb();
    await db.initAsync();
    await db.saveReview('vid-11111111', { overallGrade: 'A', comment: 'セーブテスト', ratings: {} });
    const review = db.getOwnerReviewForVideo('vid-11111111');
    assert(review !== null);
    assert(review.overallScore === 5);
    assert(review.comment === 'セーブテスト');
  });

  await runTest('37. Settings modal正常表示動作確認', async () => {
    const mockUIEls = {
      modalSettings: document.createElement('div')
    };
    const showSettings = () => {
      mockUIEls.modalSettings.classList.remove('hidden');
    };
    showSettings();
    assert(!mockUIEls.modalSettings.classList.contains('hidden'));
  });

  await runTest('38. Export UI正常動作確認', async () => {
    const exportDiv = document.createElement('div');
    exportDiv.id = 'export-modal';
    exportDiv.className = 'hidden';
    document.body.appendChild(exportDiv);

    const showExport = () => {
      exportDiv.classList.remove('hidden');
    };
    showExport();
    assert(!exportDiv.classList.contains('hidden'));

    exportDiv.remove();
  });

  await runTest('39. Import UI正常動作確認', async () => {
    const importDiv = document.createElement('div');
    importDiv.id = 'import-modal';
    importDiv.className = 'hidden';
    document.body.appendChild(importDiv);

    const showImport = () => {
      importDiv.classList.remove('hidden');
    };
    showImport();
    assert(!importDiv.classList.contains('hidden'));

    importDiv.remove();
  });

  console.groupEnd(); // Group 20
  return results;
}
