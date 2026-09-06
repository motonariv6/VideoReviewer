// media-locator-builder.js - Builds private Media Locator projection DTO for VRV Connect
// Maps canonical mediaAssetId to portable file_locations (directoryId, relativePath).
// Strictly excludes absolute paths, browser handles, hashes, and review metadata.
// Does not mutate database records or perform network operations.

import { normalizePath } from '../video-helper.js';

/**
 * Builds a private Media Locator projection DTO from the local VideoReviewer database.
 *
 * Conceptual Contract (locatorVersion 1):
 * {
 *   "locatorVersion": 1,
 *   "generatedAt": "<ISO timestamp>",
 *   "media": [
 *     {
 *       "mediaAssetId": "vid-...",
 *       "locations": [
 *         {
 *           "directoryId": "dir-...",
 *           "relativePath": "Travel/2026/foo.mp4"
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * @param {object} db - VideoReviewer database instance
 * @param {object} [options]
 * @param {string} [options.generatedAt] - Optional explicit ISO-8601 timestamp (defaults to current UTC time)
 * @returns {object} Private Media Locator projection DTO
 * @throws {Error} if db is not provided
 */
export function buildMediaLocators(db, options = {}) {
  if (!db) {
    throw new Error('Database instance is required.');
  }

  // 1. Gather active media assets consistent with public Core snapshot
  let activeAssets = [];
  if (typeof db.getVideos === 'function') {
    activeAssets = db.getVideos();
  } else if (Array.isArray(db.mediaAssets)) {
    activeAssets = db.mediaAssets.filter(asset => asset && !asset.isArchived);
  }

  const projectedMedia = [];

  for (const asset of activeAssets) {
    if (!asset || !asset.id) {
      continue;
    }

    const mediaAssetId = String(asset.id);

    // 2. Gather file locations for this media asset
    let rawLocations = [];
    if (Array.isArray(db.fileLocations)) {
      rawLocations = db.fileLocations.filter(loc => loc && loc.mediaAssetId === mediaAssetId);
    } else if (Array.isArray(asset.locations)) {
      rawLocations = asset.locations;
    }

    // 3. Project and filter locations
    const validLocations = [];
    const seenKeys = new Set();

    for (const loc of rawLocations) {
      if (!loc || typeof loc !== 'object') {
        continue;
      }

      const directoryId = typeof loc.directoryId === 'string' ? loc.directoryId.trim() : '';
      let relativePath = normalizePath(loc.relativePath);
      if (relativePath === '/') {
        relativePath = '';
      }

      // Safe filtering: location must safely produce non-empty directoryId and non-empty relativePath
      if (!directoryId || !relativePath) {
        continue;
      }

      const locKey = `${directoryId}::${relativePath}`;
      if (seenKeys.has(locKey)) {
        continue;
      }
      seenKeys.add(locKey);

      validLocations.push({
        directoryId,
        relativePath
      });
    }

    // 4. Stable deterministic ordering for locations within this media asset
    validLocations.sort((a, b) => {
      const dirCmp = a.directoryId.localeCompare(b.directoryId);
      if (dirCmp !== 0) return dirCmp;
      return a.relativePath.localeCompare(b.relativePath);
    });

    projectedMedia.push({
      mediaAssetId,
      locations: validLocations
    });
  }

  // 5. Stable deterministic ordering for media assets
  projectedMedia.sort((a, b) => a.mediaAssetId.localeCompare(b.mediaAssetId));

  return {
    locatorVersion: 1,
    generatedAt: (typeof options.generatedAt === 'string' && options.generatedAt.trim()) || new Date().toISOString(),
    media: projectedMedia
  };
}

export const buildMediaLocatorProjection = buildMediaLocators;
