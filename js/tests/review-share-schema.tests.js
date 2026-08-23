// review-share-schema.tests.js - Automated tests for Shared Review Package validator and pure models

import { validateSharedReviewPackage, LIMITS } from '../review-sharing/review-share-validator.js';
import { gradeToScore, scoreToGrade, aggregateOverallRating, aggregateTags, aggregateTimelineComments } from '../review-sharing/review-share-model.js';

export async function runReviewShareSchemaTests() {
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

  console.group('Group 18: Shared Review Package Schema & Models Tests');

  // Helper to generate a valid package object
  const createValidPackage = () => ({
    schema: 'video-review-share',
    version: 1,
    packageId: '11111111-2222-4333-8444-555555555555',
    exportedAt: new Date().toISOString(),
    exporter: {
      reviewerId: 'reviewer-owner1234',
      displayName: 'ローカルレビュアーA'
    },
    items: [
      {
        videoHash: 'aaaa111111111111111111111111111111111111111111111111111111111111',
        review: {
          reviewId: 'rev-owner12345678',
          reviewerId: 'reviewer-owner1234',
          overallRating: 5,
          tags: [{ tag: '感動' }, { tag: '秀逸' }],
          timelineComments: [
            {
              id: 'note-comm12345678',
              time: 12.34,
              comment: 'ここが素晴らしい'
            }
          ]
        }
      }
    ]
  });

  // === VALID TESTS ===

  await runTest('1. 1作品package (Valid)', async () => {
    const pkg = createValidPackage();
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true, '1-item package must be valid. Errors: ' + res.errors.join(', '));
  });

  await runTest('2. 複数作品package (Valid)', async () => {
    const pkg = createValidPackage();
    pkg.items.push({
      videoHash: 'bbbb222222222222222222222222222222222222222222222222222222222222',
      review: {
        reviewId: 'rev-owner87654321',
        reviewerId: 'reviewer-owner1234',
        overallRating: 4,
        tags: [{ tag: '伏線回収' }],
        timelineComments: []
      }
    });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true, 'Multi-item package must be valid. Errors: ' + res.errors.join(', '));
  });

  await runTest('3. overallRating null (Valid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.overallRating = null;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true, 'null overallRating must be accepted');
  });

  await runTest('4. tags 0件 (Valid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.tags = [];
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true, 'Empty tags array must be accepted');
  });

  await runTest('5. timeline comments 0件 (Valid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.timelineComments = [];
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true, 'Empty timelineComments array must be accepted');
  });

  // === INVALID TESTS ===

  await runTest('6. schema名不正 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.schema = 'invalid-schema-name';
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject invalid schema name');
  });

  await runTest('7. version不正 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.version = 2; // expected 1
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject invalid version');
  });

  await runTest('8. packageId欠落 (Invalid)', async () => {
    const pkg = createValidPackage();
    delete pkg.packageId;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject missing packageId');
  });

  await runTest('9. exporter欠落 (Invalid)', async () => {
    const pkg = createValidPackage();
    delete pkg.exporter;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject missing exporter');
  });

  await runTest('10. items欠落 (Invalid)', async () => {
    const pkg = createValidPackage();
    delete pkg.items;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject missing items');
  });

  await runTest('11. SHA-256が63文字 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].videoHash = 'aaaa11111111111111111111111111111111111111111111111111111111111'; // 63 chars
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject non-64 char videoHash');
  });

  await runTest('12. SHA-256大文字 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].videoHash = 'AAAA111111111111111111111111111111111111111111111111111111111111'; // uppercase
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject uppercase videoHash');
  });

  await runTest('13. overallRating 0 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.overallRating = 0;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'overallRating must be between 1 and 5');
  });

  await runTest('14. overallRating 6 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.overallRating = 6;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'overallRating must be between 1 and 5');
  });

  await runTest('15. overallRating 4.5 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.overallRating = 4.5;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'overallRating must be integer or null');
  });

  await runTest('16. 空tag (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.tags.push({ tag: '' });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject empty tags');
  });

  await runTest('17. 空timeline comment (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.timelineComments.push({
      id: 'note-comm87654321',
      time: 5.0,
      comment: '  ' // whitespace only
    });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject whitespace-only comments');
  });

  await runTest('18. negative timestamp (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.timelineComments[0].time = -1.5;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject negative times');
  });

  await runTest('19. NaN/Infinity相当 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.timelineComments[0].time = Infinity;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject non-finite times');
  });

  await runTest('20. duplicate videoHash (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items.push({
      videoHash: 'aaaa111111111111111111111111111111111111111111111111111111111111', // duplicate hash
      review: {
        reviewId: 'rev-owner87654321',
        reviewerId: 'reviewer-owner1234',
        overallRating: 4,
        tags: [],
        timelineComments: []
      }
    });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject duplicate videoHashes');
  });

  await runTest('21. duplicate review identity (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items.push({
      videoHash: 'bbbb222222222222222222222222222222222222222222222222222222222222',
      review: {
        reviewId: 'rev-owner12345678',   // Duplicate review ID
        reviewerId: 'reviewer-owner1234', // Duplicate reviewer ID
        overallRating: 3,
        tags: [],
        timelineComments: []
      }
    });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject duplicate reviewId + reviewerId combinations');
  });

  await runTest('22. duplicate timeline comment (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.timelineComments.push({
      id: 'note-comm12345678', // Duplicate comment ID
      time: 25.0,
      comment: 'また追加したコメント'
    });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject duplicate timeline comment IDs');
  });

  await runTest('23. unknown property (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.extraField = 'unknown';
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject unknown properties (additionalProperties: false)');
  });

  await runTest('24. localPath等の禁止フィールド混入 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.localPath = '/Users/home/movie.mp4';
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject banned fields');
  });

  await runTest('25. items上限超過 (Invalid)', async () => {
    const pkg = createValidPackage();
    // Simulate exceeding MAX_ITEMS limit
    const originalMaxItems = LIMITS.MAX_ITEMS;
    LIMITS.MAX_ITEMS = 1; // temporarily restrict to 1 item maximum

    try {
      pkg.items.push({
        videoHash: 'bbbb222222222222222222222222222222222222222222222222222222222222',
        review: {
          reviewId: 'rev-owner87654321',
          reviewerId: 'reviewer-owner1234',
          overallRating: 4,
          tags: [],
          timelineComments: []
        }
      });
      const res = validateSharedReviewPackage(pkg);
      assert(res.isValid === false, 'Should reject package exceeding items limit');
    } finally {
      LIMITS.MAX_ITEMS = originalMaxItems;
    }
  });

  await runTest('26. comment/tag文字数上限超過 (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.tags[0].tag = 'a'.repeat(LIMITS.MAX_TAG_LENGTH + 1);
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject tag exceeding length limit');
  });

  // === PURE FUNCTIONS TESTS ===

  await runTest('27. A〜E → 5〜1 (Pure function)', async () => {
    assert(gradeToScore('A') === 5);
    assert(gradeToScore('B') === 4);
    assert(gradeToScore('C') === 3);
    assert(gradeToScore('D') === 2);
    assert(gradeToScore('E') === 1);
    assert(gradeToScore(null) === null);
  });

  await runTest('28. 5〜1 → A〜E (Pure function)', async () => {
    assert(scoreToGrade(5) === 'A');
    assert(scoreToGrade(4) === 'B');
    assert(scoreToGrade(3) === 'C');
    assert(scoreToGrade(2) === 'D');
    assert(scoreToGrade(1) === 'E');
    assert(scoreToGrade(null) === null);
  });

  await runTest('29. invalid rating rejection (Pure function)', async () => {
    let errorThrown = false;
    try {
      gradeToScore('X');
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true, 'gradeToScore should throw on invalid input');

    errorThrown = false;
    try {
      scoreToGrade(6);
    } catch (e) {
      errorThrown = true;
    }
    assert(errorThrown === true, 'scoreToGrade should throw on invalid input');
  });

  await runTest('30. overall average (Pure function)', async () => {
    const reviews = [
      { overallRating: 5 },
      { overallRating: 3 },
      { overallRating: 4 }
    ];
    const res = aggregateOverallRating(reviews);
    assert(res.averageScore === 4, 'Average rating must be 4');
    assert(res.reviewCount === 3, 'Active review count must be 3');
  });

  await runTest('31. null rating除外 (Pure function)', async () => {
    const reviews = [
      { overallRating: 5 },
      { overallRating: null },
      { overallRating: 3 }
    ];
    const res = aggregateOverallRating(reviews);
    assert(res.averageScore === 4, 'Average rating must exclude null');
    assert(res.reviewCount === 2, 'Active review count must exclude null');
  });

  await runTest('32. tag aggregation (Pure function)', async () => {
    const reviews = [
      {
        reviewId: 'rev-1',
        reviewerId: 'reviewer-A',
        tags: [{ tag: '感動' }]
      },
      {
        reviewId: 'rev-2',
        reviewerId: 'reviewer-B',
        tags: [{ tag: '秀逸' }]
      }
    ];
    const res = aggregateTags(reviews);
    assert(res.length === 2);
    assert(res[0].tag === '感動');
    assert(res[1].tag === '秀逸');
  });

  await runTest('33. reviewer attribution保持 (Pure function)', async () => {
    const reviews = [
      {
        reviewId: 'rev-1',
        reviewerId: 'reviewer-A',
        tags: [{ tag: '感動' }]
      }
    ];
    const res = aggregateTags(reviews);
    assert(res[0].sources.length === 1);
    assert(res[0].sources[0].reviewId === 'rev-1');
    assert(res[0].sources[0].reviewerId === 'reviewer-A');
  });

  await runTest('34. duplicate tag aggregation (Pure function)', async () => {
    const reviews = [
      {
        reviewId: 'rev-1',
        reviewerId: 'reviewer-A',
        tags: [{ tag: '感動' }]
      },
      {
        reviewId: 'rev-2',
        reviewerId: 'reviewer-B',
        tags: [{ tag: '感動' }]
      }
    ];
    const res = aggregateTags(reviews);
    assert(res.length === 1);
    assert(res[0].tag === '感動');
    assert(res[0].sources.length === 2, 'Should track both review sources for duplicate tag');
  });

  await runTest('35. timeline sort (Pure function)', async () => {
    const reviews = [
      {
        reviewId: 'rev-1',
        reviewerId: 'reviewer-A',
        timelineComments: [{ id: 'note-comm1', time: 15.0, comment: '後発' }]
      },
      {
        reviewId: 'rev-2',
        reviewerId: 'reviewer-B',
        timelineComments: [{ id: 'note-comm2', time: 5.5, comment: '先発' }]
      }
    ];
    const res = aggregateTimelineComments(reviews);
    assert(res.length === 2);
    assert(res[0].id === 'note-comm2', '先発 must be sorted first');
    assert(res[1].id === 'note-comm1', '後発 must be sorted second');
  });

  await runTest('36. timeline source保持 (Pure function)', async () => {
    const reviews = [
      {
        reviewId: 'rev-1',
        reviewerId: 'reviewer-A',
        timelineComments: [{ id: 'note-comm1', time: 10.0, comment: 'テスト' }]
      }
    ];
    const res = aggregateTimelineComments(reviews);
    assert(res[0].sourceReviewId === 'rev-1');
    assert(res[0].sourceReviewerId === 'reviewer-A');
  });

  await runTest('37. deterministic ordering (Pure function)', async () => {
    const reviews = [
      {
        reviewId: 'rev-1',
        reviewerId: 'reviewer-B',
        timelineComments: [{ id: 'note-comm2', time: 10.0, comment: 'コメントB' }]
      },
      {
        reviewId: 'rev-2',
        reviewerId: 'reviewer-A',
        timelineComments: [{ id: 'note-comm1', time: 10.0, comment: 'コメントA' }]
      }
    ];
    const res = aggregateTimelineComments(reviews);
    assert(res[0].id === 'note-comm1', 'Tie-break by id must place note-comm1 first');
    assert(res[1].id === 'note-comm2', 'Tie-break by id must place note-comm2 second');
  });

  // === NEW REGRESSION TESTS ===

  await runTest('38. Travel/travel duplicate tag (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.tags = [{ tag: 'Travel' }, { tag: 'travel' }];
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject duplicate tags Travel/travel');
  });

  await runTest('39. Unicode NFKC normalized duplicate tag (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.tags = [{ tag: 'ﾀｸﾞ' }, { tag: 'タグ' }];
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject Unicode NFKC normalized duplicate tags');
  });

  await runTest('40. Decimal overallRating rejection in validateSharedReviewPackage (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.overallRating = 4.5;
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject decimal overallRating in package validation');
  });

  await runTest('41. Decimal overallRating ignored in aggregateOverallRating (Pure function)', async () => {
    const reviews = [
      { overallRating: 5 },
      { overallRating: 4.5 },
      { overallRating: 3 }
    ];
    const res = aggregateOverallRating(reviews);
    assert(res.averageScore === 4, 'Average rating must exclude decimal 4.5');
    assert(res.reviewCount === 2, 'Active review count must exclude decimal 4.5');
  });

  await runTest('42. Prototype Pollution rejection (Invalid)', async () => {
    // 1. __proto__
    const pkg1 = createValidPackage();
    const badObj1 = JSON.parse(JSON.stringify(pkg1));
    Object.defineProperty(badObj1, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true
    });
    const res1 = validateSharedReviewPackage(badObj1);

    // 2. constructor
    const pkg2 = createValidPackage();
    pkg2.exporter.constructor = { polluted: true };
    const res2 = validateSharedReviewPackage(pkg2);

    // 3. prototype
    const pkg3 = createValidPackage();
    pkg3.items[0].review.prototype = { polluted: true };
    const res3 = validateSharedReviewPackage(pkg3);

    assert(res1.isValid === false && res2.isValid === false && res3.isValid === false, 'Should reject prototype pollution keys __proto__, constructor, and prototype');
  });

  await runTest('43. Tag aggregation with normalization and display retention (Pure function)', async () => {
    const reviews = [
      {
        reviewId: 'rev-1',
        reviewerId: 'reviewer-A',
        tags: [{ tag: 'Travel' }]
      },
      {
        reviewId: 'rev-2',
        reviewerId: 'reviewer-B',
        tags: [{ tag: 'travel' }]
      }
    ];
    const res = aggregateTags(reviews);
    assert(res.length === 1);
    assert(res[0].tag === 'Travel', 'Must retain first display spelling: Travel');
    assert(res[0].sources.length === 2, 'Should track both sources');
  });

  await runTest('44. Timeline comment duplicate identity check (Invalid)', async () => {
    const pkg = createValidPackage();
    pkg.items[0].review.timelineComments.push({
      id: 'note-comm12345678', // duplicate ID within same reviewerId & reviewId
      time: 20.0,
      comment: '重複コメント'
    });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === false, 'Should reject duplicate comment ID within same reviewer and review');
  });

  await runTest('45. Timeline comment duplicate ID is allowed across different reviews (Valid)', async () => {
    const pkg = createValidPackage();
    pkg.items.push({
      videoHash: 'bbbb222222222222222222222222222222222222222222222222222222222222',
      review: {
        reviewId: 'rev-another12345',
        reviewerId: 'reviewer-another12',
        overallRating: 4,
        tags: [],
        timelineComments: [
          {
            id: 'note-comm12345678', // SAME comment ID, but different review/reviewer
            time: 12.34,
            comment: '問題なし'
          }
        ]
      }
    });
    const res = validateSharedReviewPackage(pkg);
    assert(res.isValid === true, 'Should allow same comment ID across different reviewer + review identities');
  });

  console.groupEnd(); // suite
  return results;
}
