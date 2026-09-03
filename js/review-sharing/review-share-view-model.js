// review-share-view-model.js - Converts database reviews to structured view model using pure functions
import { aggregateOverallRating, aggregateTags, aggregateTimelineComments } from './review-share-model.js';
import { DEFAULT_SHARED_REVIEWER_NAME } from './review-share-importer.js';
import { t } from '../i18n.js';

/**
 * Resolves user-facing reviewer display name with i18n support.
 * Local owner -> share.reviewerSelf
 * Default/Missing shared reviewer -> share.sharedReviewerDefault
 * Custom reviewer name -> preserved as-is (user data)
 * Missing reviewer -> share.reviewerUnknown
 */
export function getReviewerDisplayName(reviewer) {
  if (!reviewer) return t('share.reviewerUnknown');
  if (reviewer.isLocal) return t('share.reviewerSelf');
  if (!reviewer.displayName || reviewer.displayName === DEFAULT_SHARED_REVIEWER_NAME) {
    return t('share.sharedReviewerDefault');
  }
  return reviewer.displayName;
}

/**
 * Builds the View Model for Shared Reviews of a specific video asset.
 * Converts database records into Shared Review Package structure and runs aggregations.
 *
 * @param {Object} params
 * @param {Array<Object>} params.reviews - List of DB review records for the video
 * @param {Array<Object>} params.reviewers - List of all DB reviewer records
 * @param {Object} params.db - DB instance to query tags and timeline comments for each review
 * @returns {Object} Structured view model
 */
export function buildSharedReviewViewModel({ reviews, reviewers, db }) {
  if (!Array.isArray(reviews) || !Array.isArray(reviewers) || !db) {
    throw new Error('Invalid arguments passed to buildSharedReviewViewModel');
  }

  // Map each DB review record to Shared Review Package format
  const pkgReviews = reviews.map(r => {
    // Get tags for this review
    const dbTags = db.getTagsForReview(r.id) || [];
    const tags = dbTags.map(tItem => ({ tag: tItem.name }));

    // Get timeline notes for this review
    const dbTimeline = db.getTimelineNotesForReview(r.id) || [];
    const timelineComments = dbTimeline.map(n => ({
      id: n.id,
      time: parseFloat(n.timestampSeconds),
      comment: n.comment || ''
    }));

    return {
      reviewId: r.id,
      reviewerId: r.reviewerId,
      overallRating: typeof r.overallScore === 'number' ? r.overallScore : null,
      tags,
      timelineComments
    };
  });

  // Run pure aggregation functions
  const ratingAggregate = aggregateOverallRating(pkgReviews);
  const tagsAggregate = aggregateTags(pkgReviews);
  const commentsAggregate = aggregateTimelineComments(pkgReviews);

  // Map reviewers list in VM
  const vmReviewers = reviews.map(r => {
    const reviewer = reviewers.find(rev => rev.id === r.reviewerId);
    return {
      reviewerId: r.reviewerId,
      displayName: getReviewerDisplayName(reviewer),
      isLocal: reviewer ? !!reviewer.isLocal : false,
      overallRating: typeof r.overallScore === 'number' ? r.overallScore : null
    };
  });

  // Map tags list in VM (including resolver for display names of reviewers who added the tag)
  const vmTags = tagsAggregate.map(tItem => {
    const sources = tItem.sources.map(src => {
      const reviewer = reviewers.find(rev => rev.id === src.reviewerId);
      return {
        reviewerId: src.reviewerId,
        reviewerName: getReviewerDisplayName(reviewer),
        isLocal: reviewer ? !!reviewer.isLocal : false
      };
    });
    return {
      tag: tItem.tag,
      sources
    };
  });

  // Map timeline comments list in VM (resolve commenter details)
  const vmTimelineComments = commentsAggregate.map(c => {
    const reviewer = reviewers.find(rev => rev.id === c.reviewerId || rev.id === c.sourceReviewerId);
    return {
      id: c.id,
      time: c.time,
      comment: c.comment,
      reviewerId: c.reviewerId || c.sourceReviewerId,
      reviewerName: getReviewerDisplayName(reviewer),
      isLocal: reviewer ? !!reviewer.isLocal : false
    };
  });

  return {
    reviewCount: reviews.length,
    ratedReviewCount: ratingAggregate.reviewCount,
    averageRating: ratingAggregate.averageScore !== null ? parseFloat(ratingAggregate.averageScore.toFixed(1)) : null,
    reviewers: vmReviewers,
    tags: vmTags,
    timelineComments: vmTimelineComments
  };
}
