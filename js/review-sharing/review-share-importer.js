// review-share-importer.js - Imports Shared Review Package v1
import { validateSharedReviewPackage } from './review-share-validator.js';
import { normalizeTag } from './review-share-model.js';

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

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Imports reviews from a Shared Review Package.
 * @param {AppDatabase} db 
 * @param {object} pkg The Shared Review Package JSON object
 * @param {number[]} selectedIndices Indices of items chosen by the user
 * @returns {object} Import summary counts
 */
export function importPackage(db, pkg, selectedIndices) {
  // 1. Validation
  const validation = validateSharedReviewPackage(pkg);
  if (!validation.isValid) {
    throw new Error('インポートパッケージの検証に失敗しました:\n' + validation.errors.join('\n'));
  }

  const indices = selectedIndices || pkg.items.map((_, i) => i);
  if (indices.length === 0) {
    return { imported: 0, pending: 0, duplicate: 0, protected: 0, failed: 0 };
  }

  // 2. Setup Transaction Snapshot
  const snapshot = db.createTransactionSnapshot();
  const summary = {
    imported: 0,
    pending: 0,
    duplicate: 0,
    protected: 0,
    failed: 0
  };

  try {
    for (const idx of indices) {
      const item = pkg.items[idx];
      const { videoHash, review } = item;
      const { reviewId, reviewerId } = review;

      // Duplicate Check 1: Already imported?
      const alreadyImported = db.findReviewBySourceId(reviewId, reviewerId);
      if (alreadyImported) {
        summary.duplicate++;
        continue;
      }

      // Duplicate Check 2: Already pending?
      const alreadyPending = db.pendingSharedReviews.some(p => 
        p.videoHash === videoHash.toLowerCase() && 
        p.payload.reviewId === reviewId &&
        p.payload.reviewerId === reviewerId
      );
      if (alreadyPending) {
        summary.duplicate++;
        continue;
      }

      // Match video by full SHA-256 hash
      const matchedVideo = db.mediaAssets.find(v => 
        v.contentHash && v.contentHash.toLowerCase() === videoHash.toLowerCase()
      );

      if (matchedVideo) {
        // Matched! Register shared review
        // Resolve/Register Remote Reviewer
        let dbReviewer = db.findReviewerBySourceId(reviewerId);
        if (!dbReviewer) {
          // Check for reviewer ID collision (if remote reviewer ID matches our local reviewer ID)
          const localRev = db.getLocalReviewer();
          let nextReviewerId = reviewerId;
          if (localRev && localRev.id === reviewerId) {
            // Generate unique local ID to protect local owner properties
            nextReviewerId = 'reviewer-' + generateUUIDv4();
          }
          dbReviewer = db.addImportedReviewer({
            id: nextReviewerId,
            displayName: pkg.exporter.displayName || '共有レビュアー',
            sourceReviewerId: reviewerId
          });
        }

        // Add Video Review
        const localReviewId = 'rev-' + generateUUIDv4();
        db.addImportedReview({
          id: localReviewId,
          mediaAssetId: matchedVideo.id,
          reviewerId: dbReviewer.id,
          overallScore: review.overallRating,
          comment: review.comment || '',
          sourceReviewId: reviewId,
          sourceReviewerId: reviewerId
        });

        // Map and Associate Tags
        if (review.tags && review.tags.length > 0) {
          for (const tObj of review.tags) {
            const normalized = normalizeTag(tObj.tag);
            let dbTag = db.tags.find(t => normalizeTag(t.name) === normalized);
            if (!dbTag) {
              // Create new global tag
              const newTagId = 'tag-' + generateUUIDv4();
              dbTag = {
                id: newTagId,
                name: tObj.tag
              };
              db.tags.push(dbTag);
              db._saveTable('tags', db.tags);
            }
            db.addImportedTagAssociation({
              videoReviewId: localReviewId,
              tagId: dbTag.id
            });
          }
        }

        // Map and Add Timeline Comments
        if (review.timelineComments && review.timelineComments.length > 0) {
          for (const tc of review.timelineComments) {
            db.addImportedTimelineNote({
              videoReviewId: localReviewId,
              mediaAssetId: matchedVideo.id,
              timestampSeconds: tc.time,
              timestampLabel: formatTime(tc.time),
              comment: tc.comment,
              sourceCommentId: tc.id
            });
          }
        }

        summary.imported++;
      } else {
        // Unmatched! Add to pending shared reviews
        const pendingRecord = {
          id: 'pending-review-' + generateUUIDv4(),
          packageId: pkg.packageId,
          videoHash: videoHash.toLowerCase(),
          hashAlgorithm: 'sha256',
          reviewerId: reviewerId,
          payload: review,
          status: 'pending',
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        db.addPendingSharedReview(pendingRecord);
        summary.pending++;
      }
    }
  } catch (err) {
    db.rollbackTransactionSnapshot(snapshot);
    console.error('Import transaction rolled back due to error:', err);
    throw err;
  }

  return summary;
}
