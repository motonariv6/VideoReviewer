# Schema Migrations Documentation

This document describes the changes across database schema versions.

## Schema Version 4 (Current)
Introduced Multi-Reviewer support, Review-linked tags, pending reviews storage, and Custom Poster image references.

### Overview of Changes
1. **Added Tables**:
   - `reviewers` (tracks multiple reviewer profiles, identifying exactly one profile as the local owner: `isLocal: true`).
   - `review_tags` (associates tags to specific reviews rather than logical assets).
   - `pending_shared_reviews` (stores shared review packages that lack a matching local video file).
2. **Removed Table**: `video_tags` (replaced by `review_tags`).
3. **Modified Tables / Fields**:
   - `media_assets`: Added `customPosterId` pointing to user's custom poster image in IndexedDB.
   - `video_reviews`: Added `reviewerId` and `origin` (`"local" | "imported"`).
   - `criterion_ratings`: Linked to `videoReviewId` instead of logical asset ID.
   - `timeline_notes`: Linked to `videoReviewId` in addition to `mediaAssetId`.
4. **Migration Logic**:
   - During upgrade, tags previously stored under `video_tags` are migrated to the local owner's review (`review_tags`).
   - Incomplete data (e.g. legacy `template-*` evaluations) are canonicalized, merged, and cleaned up.

---

## Schema Version 3
Introduced the concept of persistent logical media identity based on file content hashing.

### Overview of Changes
1. **Removed Table**: `videos`
2. **Added Tables**:
   - `media_assets` (stores logical video asset metadata, keyed by SHA-256 contentHash)
   - `file_locations` (stores physical files connected to directory sources and media assets)
3. **Modified Associations**:
   - `video_reviews`: `videoId` renamed to `mediaAssetId`
   - `video_tags`: `videoId` renamed to `mediaAssetId`
   - `timeline_notes`: `videoId` renamed to `mediaAssetId`

### Field Mapping Reference

| Old Table/Field | New Table/Field | Conversion Logic / Notes |
| --- | --- | --- |
| `videos.id` | `media_assets.id` | Preserved to avoid changing foreign key IDs in dependent tables. |
| `videos.title` | `media_assets.displayTitle` | Fallback to `fileName` if missing. |
| `videos.genreId` | `media_assets.genreId` | Preserved. |
| `videos.thumbnailId` | `media_assets.thumbnailId` | Preserved. |
| `videos.fileSize` | `media_assets.fileSize`, `file_locations.fileSize` | Distributed. |
| `videos.duration` | `media_assets.duration` | Preserved on logical asset. |
| `videos.directoryId` | `file_locations.directoryId` | Distributed. |
| `videos.relativePath` | `file_locations.relativePath` | Distributed. |
| `videos.fileName` | `file_locations.fileName` | Distributed. |
| `videos.lastModified` | `file_locations.lastModified` | Distributed. |
| `videos.availabilityStatus` | `file_locations.availabilityStatus` | Distributed. |
| `video_reviews.videoId` | `video_reviews.mediaAssetId` | Renamed. |
| `video_tags.videoId` | `video_tags.mediaAssetId` | Renamed. |
| `timeline_notes.videoId` | `timeline_notes.mediaAssetId` | Renamed. |

### Rollback Strategy
Automatic rollback is supported. If any failure happens during the migration transaction in `initAsync()`, the transaction is aborted and the original `videos` table and version key remain intact. Manual rollback can be done by restoring a v2 database backup.

---

## Schema Version 2
Introduced binary asset offloading to IndexedDB to prevent localStorage limit exhaustion.

- **Changes**: base64 encoded thumbnails in the `videos` table were extracted, converted to binary Blobs, and stored in the IndexedDB `images` table. `videos.thumbnailId` was set to point to the IndexedDB keys.

---

## Schema Version 1
Initial database model where all data, including base64 encoded images, was stored in `localStorage` under table arrays.
