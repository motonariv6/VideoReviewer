// review-share-model.js - Pure functions for review sharing data models and aggregation

/**
 * Converts overall grade (A-E) to rating score (5-1)
 * @param {string|null} grade
 * @returns {number|null}
 * @throws {Error} for invalid grade values
 */
export function gradeToScore(grade) {
  if (grade === null || grade === undefined) return null;
  const upper = String(grade).toUpperCase();
  switch (upper) {
    case 'A': return 5;
    case 'B': return 4;
    case 'C': return 3;
    case 'D': return 2;
    case 'E': return 1;
    default:
      throw new Error(`Invalid grade value: ${grade}`);
  }
}

/**
 * Converts rating score (5-1) to overall grade (A-E)
 * @param {number|null} score
 * @returns {string|null}
 * @throws {Error} for invalid score values
 */
export function scoreToGrade(score) {
  if (score === null || score === undefined) return null;
  const num = Number(score);
  if (!Number.isInteger(num)) {
    throw new Error(`Invalid score value (must be integer): ${score}`);
  }
  switch (num) {
    case 5: return 'A';
    case 4: return 'B';
    case 3: return 'C';
    case 2: return 'D';
    case 1: return 'E';
    default:
      throw new Error(`Invalid score value (must be 1-5): ${score}`);
  }
}

/**
 * Normalizes tag text using Trim + Unicode NFKC + lowercase
 * @param {string} tag
 * @returns {string}
 */
export function normalizeTag(tag) {
  return String(tag).trim().normalize('NFKC').toLowerCase();
}

/**
 * Aggregates overall ratings from multiple reviews.
 * Calculates average score and active review count, excluding null ratings.
 * @param {Array<Object>} reviews
 * @returns {Object} { averageScore: number|null, reviewCount: number }
 */
export function aggregateOverallRating(reviews) {
  if (!Array.isArray(reviews)) {
    throw new Error('Invalid arguments: reviews must be an array');
  }

  let totalScore = 0;
  let count = 0;

  reviews.forEach(r => {
    if (!r) return;
    const score = r.overallRating;
    if (score !== null && score !== undefined) {
      const num = Number(score);
      if (Number.isInteger(num) && num >= 1 && num <= 5) {
        totalScore += num;
        count++;
      }
    }
  });

  return {
    averageScore: count > 0 ? totalScore / count : null,
    reviewCount: count
  };
}

/**
 * Aggregates tags across multiple reviews and tracks their source reviewers.
 * Trims tag text, discards empty tags, and deduplicates tags per review.
 * @param {Array<Object>} reviews
 * @returns {Array<Object>} Array of { tag: string, sources: Array<{ reviewerId: string, reviewId: string }> }
 */
export function aggregateTags(reviews) {
  if (!Array.isArray(reviews)) {
    throw new Error('Invalid arguments: reviews must be an array');
  }

  const tagMap = new Map(); // normalized tag -> Map(reviewId -> reviewerId)
  const tagDisplayMap = new Map(); // normalized tag -> first display form string

  reviews.forEach(r => {
    if (!r || !Array.isArray(r.tags)) return;
    const reviewId = r.reviewId || '';
    const reviewerId = r.reviewerId || '';

    const seenInThisReview = new Set();

    r.tags.forEach(tObj => {
      if (!tObj || typeof tObj.tag !== 'string') return;
      const normalized = normalizeTag(tObj.tag);
      if (normalized === '') return;

      if (seenInThisReview.has(normalized)) return;
      seenInThisReview.add(normalized);

      if (!tagMap.has(normalized)) {
        tagMap.set(normalized, new Map());
        tagDisplayMap.set(normalized, tObj.tag.trim());
      }
      tagMap.get(normalized).set(reviewId, reviewerId);
    });
  });

  const results = [];
  for (const [normalized, sourcesMap] of tagMap.entries()) {
    const sources = [];
    for (const [reviewId, reviewerId] of sourcesMap.entries()) {
      sources.push({ reviewId, reviewerId });
    }
    // Sort sources deterministically by reviewId then reviewerId
    sources.sort((a, b) => {
      if (a.reviewId !== b.reviewId) return a.reviewId.localeCompare(b.reviewId);
      return a.reviewerId.localeCompare(b.reviewerId);
    });
    results.push({ tag: tagDisplayMap.get(normalized), sources });
  }

  // Sort final tags list alphabetically
  results.sort((a, b) => a.tag.localeCompare(b.tag));
  return results;
}

/**
 * Aggregates timeline comments across multiple reviews.
 * Comments are returned sorted by time ascending, with deterministic tie-breaking.
 * @param {Array<Object>} reviews
 * @returns {Array<Object>} Array of comment objects with source review and reviewer info
 */
export function aggregateTimelineComments(reviews) {
  if (!Array.isArray(reviews)) {
    throw new Error('Invalid arguments: reviews must be an array');
  }

  const allComments = [];

  reviews.forEach(r => {
    if (!r || !Array.isArray(r.timelineComments)) return;
    const reviewId = r.reviewId || '';
    const reviewerId = r.reviewerId || '';

    r.timelineComments.forEach(c => {
      if (!c || typeof c.id !== 'string' || typeof c.comment !== 'string' || typeof c.time !== 'number') return;
      if (c.comment.trim() === '') return;

      allComments.push({
        id: c.id,
        time: c.time,
        comment: c.comment,
        sourceReviewId: reviewId,
        sourceReviewerId: reviewerId
      });
    });
  });

  // Sort by time ascending, tie-breaking by id, then by sourceReviewerId
  allComments.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    return a.sourceReviewerId.localeCompare(b.sourceReviewerId);
  });

  return allComments;
}
