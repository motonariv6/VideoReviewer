# VideoReviewer Database Model Specification

This document details the database architecture of the VideoReviewer application, updated for Schema v4 (Multi-Reviewer support).

## Overview

The database splits the logical concept of a "Video" (a unique media asset represented by its file content) from its physical "Location" (its filepath or directory source connection). This ensures that moving, renaming, or copying a file across storage directories does not destroy its ratings, reviews, tags, and timeline notes.

In Schema v4, the system is designed to support multiple reviewers. Reviews, rating criteria scores, tags, and timeline notes are linked to a specific Reviewer.

---

## Identity & Hashing Architecture

1. **Quick Hash (Candidate Selection)**:
   - Formed from `fileSize` + leading 1MB + middle 1MB + trailing 1MB chunks (e.g. `q_10485760_1a89c...`).
   - Quick Hash is used exclusively for candidate pre-filtering during scanning. It is **never** used as proof of uniqueness or final deduplication.
2. **Full Content Hash (SHA-256 Identity)**:
   - Full 64-character lowercase hexadecimal string of the entire file's SHA-256 digest (`^[0-9a-f]{64}$`).
   - Absolute identity of any media asset is established strictly by this complete `contentHash`.
   - Calculated asynchronously in 1MB chunks using Web Workers (`js/sha256-worker.js`) to prevent UI blocking or excessive memory allocation.
3. **Hashing States**:
   - `pending`: Waiting in queue for calculation.
   - `calculating`: Currently being computed.
   - `completed`: Successfully computed 64-character SHA-256 hash.
   - `failed`: File read error or computation failure (does not damage existing annotations).

---

## Storage Architecture & Boundary

The application uses a hybrid storage model:
1. **localStorage**: Used for structured relational data. Faster querying, smaller sizes.
2. **IndexedDB (VideoReviewerDB)**: Used for binary assets (thumbnails) and system file handles (`FileSystemDirectoryHandle`).

| Table / Store | Storage Engine | Backed Up? | Purpose |
| --- | --- | --- | --- |
| `reviewers` | localStorage | Yes | Reviewer profiles (including local owner). |
| `media_assets` | localStorage | Yes | Logical video records keyed by content hash. |
| `file_locations` | localStorage | Yes | Physical paths and availability of files. |
| `video_reviews` | localStorage | Yes | Review records (overall scores, comments) per reviewer. |
| `criterion_ratings` | localStorage | Yes | Specific rating values per criterion. |
| `tags` | localStorage | Yes | Global tag catalog. |
| `review_tags` | localStorage | Yes | Tag associations linked to specific reviews. |
| `timeline_notes` | localStorage | Yes | Timestamped annotations on media assets linked to specific reviews. |
| `directory_sources` | localStorage | Yes | Storage directories registered in the app. |
| `genres` | localStorage | Yes | Genre definition catalog. |
| `evaluation_templates` | localStorage | Yes | Genre-specific evaluation criteria mappings. |
| `rating_criteria` | localStorage | Yes | Global criteria registry. |
| `pending_shared_reviews`| localStorage | Yes | Unlinked shared reviews waiting for local assets. |
| `images` (store) | IndexedDB | Yes | Binary thumbnail images keyed by thumbnail ID. |
| `directory_handles` (store) | IndexedDB | No | Restored on the same machine but excluded from cross-device backups due to OS security limits. |

---

## Tables and Associations

```
[media_assets] (1) <--- (*) [file_locations]
    | (1)
    +--- (*) [video_reviews] (1) <--- (*) [criterion_ratings]
                 | (1)
                 +--- (*) [review_tags]
                 +--- (*) [timeline_notes]
```

### 1. `reviewers`
- Keyed by unique reviewer ID (`reviewer-UUID`), generated permanently.
- **displayName**: Non-empty display name.
- **isLocal**: Boolean declaring if the reviewer profile belongs to the local machine owner. Exactly one local owner reviewer exists (`isLocal: true`).

### 2. `media_assets` (Logical Record)
- Keyed by unique logical IDs (UUIDs prefixed with `vid-`). The absolute identity is verified via `contentHash` (SHA-256).
- **displayTitle**: Nullable user-set title (`string | null`).
- **genreId**: Foreign key pointing to `genres.id`.
- **thumbnailId**: Foreign key pointing to the `images` store in IndexedDB.
- **customPosterId**: Nullable foreign key pointing to the user's custom poster image in the `images` store of IndexedDB (`string | null`).
- **identityStatus**: `"normal" | "conflict"`. Used to declare if the asset is in a conflict state.
- **identityConflictGroupId**: Nullable group ID (`string | null`).

### 3. `video_reviews`
- Keyed by unique review ID (`rev-UUID`).
- **mediaAssetId**: Foreign key pointing to `media_assets.id`.
- **reviewerId**: Foreign key pointing to `reviewers.id`.
- **origin**: `"local" | "imported"`. Specifies if the review was authored locally or imported from a peer.
- **overallScore**: Nullable integer rating score (`1` to `5` or `null`).
- **comment**: Overall comment text (`string | null`). Maps to the external sharing JSON field `free_comment`. Each reviewer maintains a completely independent comment for the video.
- **Uniqueness / Logical Owner Review**: For a given `mediaAssetId`, there can only be one review with `reviewerId` belonging to the local owner. The pair `(mediaAssetId, reviewerId)` forms a unique constraint.

### 4. `review_tags`
- Keyed by unique association ID (`review-tag-UUID`).
- **videoReviewId**: Foreign key pointing to `video_reviews.id`.
- **tagId**: Foreign key pointing to `tags.id`.
- **Uniqueness**: The pair `(videoReviewId, tagId)` must be unique. Same tag cannot be assigned to the same review twice.

### 5. `timeline_notes`
- Keyed by unique note ID (`note-UUID`).
- **videoReviewId**: Foreign key pointing to `video_reviews.id`.
- **mediaAssetId**: Foreign key pointing to `media_assets.id`.

### 6. `pending_shared_reviews`
- Keyed by unique pending ID (`pending-review-UUID`).
- **packageId**: Identifier of the imported sharing package.
- **videoHash**: SHA-256 hash (`contentHash`) of the target video.
- **hashAlgorithm**: `"sha256"`.
- **reviewerId**: ID of the shared reviewer.
- **payload**: JSON object holding the shared review details. The payload is designed to hold: `overall_score` (1-5), `tags` (array of strings), `free_comment` (comment text), `timeline_comments` (notes array), `review_id`, `reviewer_id`, and `updated_at`.
- **status**: `"pending"`.

---

## Compatibility & Migration Rules

### A. A〜E Score Mapping (Grade <=> Score Compatibility)
Existing UI uses overall grades from A to E. The database正本 stores `overallScore` as an integer.
* `A` <=> `5`
* `B` <=> `4`
* `C` <=> `3`
* `D` <=> `2`
* `E` <=> `1`
* `null` <=> `null` (or empty strings)
Invalid values during migration or validation trigger a rollback and abort.

### B. Video Tags to Review Tags Migration
In Schema v3, tags were linked to the logical media asset (`video_tags`). In Schema v4, they are linked to specific reviews (`review_tags`).
* During migration, all existing `video_tags` are migrated to the local owner's review (`review_tags`).
* If a media asset has tags but no review exists, a minimal owner review (`overallScore: null, comment: ''`) is automatically created to anchor the tags.

### C. Cascade Deletion Rules
When a media asset is permanently deleted:
* The asset record itself is removed.
* All associated `file_locations` are removed.
* All associated `video_reviews` (both local owner and imported reviews) for this asset are deleted.
* All associated `criterion_ratings` referencing the deleted reviews are deleted.
* All associated `review_tags` referencing the deleted reviews are deleted.
* All associated `timeline_notes` referencing the deleted reviews are deleted.
* Associated image/thumbnail files are pruned from IndexedDB.

### D. Archiving Behavior
When a video is archived, its evaluations (reviews, ratings, tags, timeline notes) are **preserved** in the database. Only physical location information is modified/removed in accordance with the scan rules.

### E. Schema v3 to v4 Upgrade (Atomics & Idempotence)
1. **Atomics**: Any failure during migration triggers an immediate rollback to the pre-upgrade state in localStorage and memory.
2. **Idempotence**: Upgrading is idempotent. If `schema_version` is already `4`, the migration immediately exits without doing anything.
3. **Anomalies**: If an asset is found to have duplicate reviews in Schema v3, the upgrade is aborted with a detailed error message and rolled back.

---

## Shared Review Package (v1)

For cross-user sharing of reviews, the application defines a standard sharing JSON package format.
Refer to [Review Sharing Specification](./review-sharing.md) for full details.

* **Format Name**: `video-review-share`
* **Version**: `1` (versioned independently of the internal Database Schema).
* **Scope**: Only exports the local owner's review. Imported reviews from peer users, rating criteria scores, free comments, thumbnails, local paths, and folder structures are strictly excluded.
* **Asset Mapping**: Performed exclusively via 64-character SHA-256 content hash (`videoHash`).
* **Relational Rules**:
  - `packageId` tracks the JSON file itself.
  - `reviewId` + `reviewerId` tracks individual review uniqueness.
  - Validation catches duplicate items, reviews, tags, or timeline comments to ensure database integrity on import.
