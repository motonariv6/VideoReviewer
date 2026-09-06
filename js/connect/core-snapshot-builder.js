// core-snapshot-builder.js - Builds public Core Snapshot DTO for VRV Connect
// Adheres strictly to the Connect API contract (snapshotVersion 1).
// Does not perform network operations or mutate internal database state.

/**
 * Builds a public Core Snapshot DTO from the local VideoReviewer database.
 * 
 * @param {AppDatabase} db - VideoReviewer database instance
 * @param {object} [options]
 * @param {string} [options.generatedAt] - Optional explicit ISO-8601 timestamp (defaults to current UTC time)
 * @returns {object} Public Core Snapshot DTO
 * @throws {Error} if local reviewer is not initialized
 */
export function buildCoreSnapshot(db, options = {}) {
  if (!db) {
    throw new Error('Database instance is required.');
  }

  const localReviewer = db.getLocalReviewer();
  if (!localReviewer || !localReviewer.id) {
    throw new Error('ローカルレビュアー情報が取得できません。');
  }

  const activeVideos = typeof db.getVideos === 'function' ? db.getVideos() : [];

  const snapshotVideos = activeVideos.map(video => {
    // 1. mediaAssetId: canonical media asset identifier (video.id)
    const mediaAssetId = video.id;

    // 2. displayTitle: user-edited title preferred, fallback to title/fileName
    const displayTitle = (video.displayTitle && String(video.displayTitle).trim()) ||
                         video.title ||
                         video.fileName ||
                         'Unknown';

    // 3. posterUrl: strictly null for Milestone 3B
    const posterUrl = null;

    // 4. rating: local reviewer's review overall score only
    let rating = null;
    const localReview = typeof db.getOwnerReviewForVideo === 'function' ?
      db.getOwnerReviewForVideo(video.id) : null;

    if (localReview &&
        typeof localReview.overallScore === 'number' &&
        !isNaN(localReview.overallScore) &&
        localReview.overallScore >= 0 &&
        localReview.overallScore <= 5) {
      rating = {
        value: localReview.overallScore,
        reviewer: {
          reviewerId: localReviewer.id,
          displayName: (localReviewer.displayName && String(localReviewer.displayName).trim()) || 'Anonymous'
        }
      };
    }

    // 5. tags: array of tag name strings (always [] when none, never null)
    let tags = [];
    if (typeof db.getVideoTags === 'function') {
      const dbTags = db.getVideoTags(video.id);
      if (Array.isArray(dbTags)) {
        tags = dbTags
          .map(t => (t && typeof t.name === 'string' ? t.name : ''))
          .filter(Boolean);
      }
    }

    // 6. durationSeconds: numeric seconds (fractional allowed), null when unavailable or <= 0
    let durationSeconds = null;
    if (typeof video.duration === 'number' && !isNaN(video.duration) && video.duration > 0) {
      durationSeconds = video.duration;
    }

    // 7. timelineNotes: only notes linked to the local reviewer's review
    let timelineNotes = [];
    if (localReview && typeof db.getTimelineNotesForReview === 'function') {
      const notes = db.getTimelineNotesForReview(localReview.id);
      if (Array.isArray(notes)) {
        timelineNotes = notes.map(n => ({
          id: n.id,
          timestampSeconds: typeof n.timestampSeconds === 'number' && !isNaN(n.timestampSeconds) ?
            n.timestampSeconds :
            (parseFloat(n.timestampSeconds) || 0),
          comment: n.comment || ''
        }));
      }
    }

    return {
      mediaAssetId,
      displayTitle,
      posterUrl,
      rating,
      tags,
      durationSeconds,
      timelineNotes
    };
  });

  return {
    snapshotVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    localReviewer: {
      reviewerId: localReviewer.id,
      displayName: (localReviewer.displayName && String(localReviewer.displayName).trim()) || 'Anonymous'
    },
    videos: snapshotVideos
  };
}
