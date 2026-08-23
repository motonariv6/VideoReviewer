// review-share-exporter.js - Exports selected reviews to Shared Review Package v1
import { validateSharedReviewPackage } from './review-share-validator.js';

function generateUUIDv4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Checks if a hash value is eligible as a Shared Review Package v1 SHA-256 hash.
 * Enforces exactly 64 lowercase hex characters.
 * @param {string} hash
 * @param {string} hashStatus
 * @returns {boolean}
 */
export function isHashEligible(hash, hashStatus) {
  if (hashStatus !== 'completed' || !hash) {
    return false;
  }
  const hashPattern = /^[0-9a-f]{64}$/;
  return hashPattern.test(hash);
}

/**
 * Checks if a video asset is eligible for sharing export.
 * @param {AppDatabase} db
 * @param {object} video
 * @returns {boolean}
 */
export function isVideoEligibleForExport(db, video) {
  if (!video) return false;
  if (!isHashEligible(video.contentHash, video.hashStatus)) {
    return false;
  }
  const ownerReview = db.getOwnerReviewForVideo(video.id);
  return ownerReview !== null;
}

/**
 * Exports local owner reviews of selected video IDs.
 * @param {AppDatabase} db
 * @param {string[]} videoIds
 * @returns {object} Shared Review Package JSON object
 */
export function exportReviews(db, videoIds) {
  if (!videoIds || videoIds.length === 0) {
    throw new Error('エクスポート対象の動画が選択されていません。');
  }

  const localReviewer = db.getLocalReviewer();
  if (!localReviewer) {
    throw new Error('ローカルレビュアー情報が取得できません。');
  }

  const items = [];

  for (const videoId of videoIds) {
    const video = db.getVideo(videoId);
    if (!video) {
      throw new Error(`動画 ID ${videoId} が存在しません。`);
    }

    // Verify eligibility
    if (!isVideoEligibleForExport(db, video)) {
      throw new Error(`動画「${video.title}」はエクスポートできません（有効なハッシュ値またはオーナーレビューが存在しません）。`);
    }

    const review = db.getOwnerReviewForVideo(videoId);
    // review is guaranteed to exist due to isVideoEligibleForExport check

    // Map tags
    const dbTags = db.getTagsForReview(review.id);
    const tags = dbTags.map(t => ({ tag: t.name }));

    // Map timeline comments
    const dbTimeline = db.timelineNotes
      .filter(n => n.videoReviewId === review.id)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    const timelineComments = dbTimeline.map(n => ({
      id: n.id,
      time: parseFloat(n.timestampSeconds),
      comment: n.comment || ''
    }));

    items.push({
      videoHash: video.contentHash, // keep original casing (which is guaranteed lowercase due to regex)
      review: {
        reviewId: review.id,
        reviewerId: localReviewer.id,
        overallRating: typeof review.overallScore === 'number' ? review.overallScore : null,
        tags,
        timelineComments
      }
    });
  }

  const pkg = {
    schema: 'video-review-share',
    version: 1,
    packageId: generateUUIDv4(),
    exportedAt: new Date().toISOString(),
    exporter: {
      reviewerId: localReviewer.id,
      displayName: localReviewer.displayName
    },
    items
  };

  // Perform validation before returning
  const validation = validateSharedReviewPackage(pkg);
  if (!validation.isValid) {
    console.error('Validation failure during export:', validation.errors);
    throw new Error('エクスポートデータの検証に失敗しました: ' + validation.errors.join('; '));
  }

  return pkg;
}
