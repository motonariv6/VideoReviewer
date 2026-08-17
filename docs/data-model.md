# VideoReviewer Database Model Specification

This document details the database architecture of the VideoReviewer application.

## Overview

The database splits the logical concept of a "Video" (a unique media asset represented by its file content) from its physical "Location" (its filepath or directory source connection). This ensures that moving, renaming, or copying a file across storage directories does not destroy its ratings, reviews, tags, and timeline notes.

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
| `media_assets` | localStorage | Yes | Logical video records keyed by content hash. |
| `file_locations` | localStorage | Yes | Physical paths and availability of files. |
| `video_reviews` | localStorage | Yes | Overall evaluations (grade, comments) of media assets. |
| `criterion_ratings` | localStorage | Yes | Specific rating values per criterion. |
| `tags` | localStorage | Yes | Global tag catalog. |
| `video_tags` | localStorage | Yes | Association of tags with logical media assets. |
| `timeline_notes` | localStorage | Yes | Timestamped annotations on media assets. |
| `directory_sources` | localStorage | Yes | Storage directories registered in the app. |
| `genres` | localStorage | Yes | Genre definition catalog. |
| `evaluation_templates` | localStorage | Yes | Genre-specific evaluation criteria mappings. |
| `rating_criteria` | localStorage | Yes | Global criteria registry. |
| `images` (store) | IndexedDB | Yes | Binary thumbnail images keyed by thumbnail ID. |
| `directory_handles` (store) | IndexedDB | No | Restored on the same machine but excluded from cross-device backups due to OS security limits. |

---

## Tables and Associations

```
[media_assets] (1) <--- (*) [file_locations]
    | (1)
    +--- (*) [video_reviews] <--- (*) [criterion_ratings]
    +--- (*) [video_tags]
    +--- (*) [timeline_notes]
```

### 1. `media_assets` (Logical Record)
- **Key Identifiers**: Keyed by unique logical IDs (UUIDs prefixed with `vid-`). The absolute identity is verified via `contentHash` (SHA-256).
- **displayTitle**: Nullable user-set title (`string | null`). When null or empty, displays fallback to physical `fileName` or original title.
- **genreId**: Foreign key pointing to `genres.id`.
- **thumbnailId**: Foreign key pointing to the `images` store in IndexedDB.
- **identityStatus**: `"normal" | "conflict"`. Used to declare if the asset is in a conflict state due to non-mergible evaluation data.
- **identityConflictGroupId**: Nullable group ID (`string | null`). Shares the same ID across conflicting logical records representing the same SHA-256 hash.

### 2. `file_locations` (Physical Record)
- Keyed by unique location ID (`loc-UUID`).
- **mediaAssetId**: Foreign key pointing to `media_assets.id`.
- **directoryId**: Foreign key pointing to `directory_sources.id`.
- **availabilityStatus**: Indicates if the file is reachable (`available`), needs authorization (`permission-required`), or is missing (`missing`).

---

## Deduplication & Merge Safety Rules

When duplicate assets with the same `contentHash` are detected:
1. **Target Selection**: The asset containing existing ratings or evaluations is prioritized as the canonical target.
2. **Conflict Prevention**: If both assets contain meaningful evaluations (e.g. overall grades, non-empty comments, rating criteria, or timeline notes), automatic merging is prevented. Both assets are preserved, marked with `identityStatus: "conflict"`, and assigned the same `identityConflictGroupId` to maintain database referential integrity without losing user data.
3. **Location Re-linking**: All `file_locations` pointing to the source asset are safely re-linked to the canonical target asset (only when auto-merge is permitted).
4. **Tag & Note Migration**: Tags are merged without duplicate IDs; timeline notes are reassigned to the canonical target and active review without breaking image thumbnail references.
5. **Atomic Rollback**: If any error occurs during merging, all affected tables are restored from in-memory snapshots immediately.
