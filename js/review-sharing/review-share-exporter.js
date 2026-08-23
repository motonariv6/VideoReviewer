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

    // Verify SHA-256 hash status
    if (video.hashStatus !== 'completed' || !video.contentHash || video.contentHash.length !== 64) {
      throw new Error(`動画「${video.title}」の SHA-256 ハッシュ値が未計算、または計算中です。`);
    }

    // Only export owner review
    const review = db.getOwnerReviewForVideo(videoId);
    if (!review) {
      // If no owner review exists, we still create a valid item with empty tags/timelineComments
      items.push({
        videoHash: video.contentHash.toLowerCase(),
        review: {
          reviewId: 'rev-' + generateUUIDv4(),
          reviewerId: localReviewer.id,
          overallRating: null,
          tags: [],
          timelineComments: []
        }
      });
      continue;
    }

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
      videoHash: video.contentHash.toLowerCase(),
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
