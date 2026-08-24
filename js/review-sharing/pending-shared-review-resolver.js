// pending-shared-review-resolver.js - Resolves pending shared reviews upon file hash resolution
import { importSharedReviewItem } from './review-share-importer.js';

/**
 * Resolves pending shared reviews for a given video hash and active media asset.
 * @param {object} params
 * @param {AppDatabase} params.db
 * @param {string} params.mediaAssetId
 * @param {string} params.contentHash
 * @returns {object} Summary of resolved, duplicate, failed counts
 */
export function resolvePendingSharedReviewsForVideo({ db, mediaAssetId, contentHash }) {
  const summary = {
    resolved: 0,
    duplicate: 0,
    failed: 0
  };

  if (!contentHash) return summary;

  // Validate format is strictly 64-character lowercase hex SHA-256 (no automatic conversion to lowercase)
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    return summary;
  }

  // Find the media asset to verify it exists and is active (not archived)
  const matchedVideo = db.getVideo(mediaAssetId);
  if (!matchedVideo || matchedVideo.isArchived || matchedVideo.hashStatus !== 'completed') {
    return summary;
  }

  // Exclude conflict assets or wait until canonical asset is determined using readonly public API
  const rawAsset = db.getMediaAssetById(mediaAssetId);
  if (!rawAsset || rawAsset.identityStatus === 'conflict' || rawAsset.identityStatus === 'provisional') {
    return summary;
  }

  // Get all pending reviews
  const allPending = db.getPendingSharedReviews();
  const matchingPending = allPending.filter(p => p.videoHash === contentHash && p.status === 'pending');

  if (matchingPending.length === 0) {
    return summary;
  }

  for (const pending of matchingPending) {
    const reviewPayload = pending.payload;
    const { reviewId, reviewerId } = reviewPayload;

    // Duplicate Check 1: Already imported?
    const alreadyImported = db.findReviewBySourceId(reviewId, reviewerId);
    if (alreadyImported) {
      db.removePendingSharedReview(pending.id);
      summary.duplicate++;
      continue;
    }

    // Atomicity: 1 pending item unit transaction
    const snapshot = db.createTransactionSnapshot();
    try {
      importSharedReviewItem(db, {
        videoHash: contentHash,
        review: reviewPayload,
        exporterDisplayName: reviewPayload.exporterDisplayName,
        matchedVideo: rawAsset
      });

      // Remove from pending reviews on success
      db.removePendingSharedReview(pending.id);
      summary.resolved++;
    } catch (err) {
      db.rollbackTransactionSnapshot(snapshot);
      console.error(`Failed to resolve pending review ${pending.id}:`, err);
      summary.failed++;
    }
  }

  return summary;
}

/**
 * Resolves all pending shared reviews by searching matching media assets in DB.
 * @param {AppDatabase} db
 * @returns {object} Overall summary
 */
export function resolveAllPendingSharedReviews(db) {
  const summary = {
    resolved: 0,
    duplicate: 0,
    failed: 0
  };

  const allPending = db.getPendingSharedReviews();
  const activePendingHashes = [...new Set(allPending.filter(p => p.status === 'pending').map(p => p.videoHash))];

  for (const hash of activePendingHashes) {
    const matchedVideo = db.findVideoByContentHash(hash);
    if (matchedVideo && !matchedVideo.isArchived && matchedVideo.hashStatus === 'completed' && matchedVideo.identityStatus !== 'conflict' && matchedVideo.identityStatus !== 'provisional') {
      const res = resolvePendingSharedReviewsForVideo({
        db,
        mediaAssetId: matchedVideo.id,
        contentHash: hash
      });
      summary.resolved += res.resolved;
      summary.duplicate += res.duplicate;
      summary.failed += res.failed;
    }
  }

  return summary;
}
