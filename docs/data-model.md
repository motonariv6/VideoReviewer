# VideoReviewer Database Model Specification

This document details the database architecture of the VideoReviewer application.

## Overview

The database splits the logical concept of a "Video" (a unique media asset represented by its file content) from its physical "Location" (its filepath or directory source connection). This ensures that moving, renaming, or copying a file across storage directories does not destroy its ratings, reviews, tags, and timeline notes.

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
- **genreId**: Foreign key pointing to `genres.id`.
- **thumbnailId**: Foreign key pointing to the `images` store in IndexedDB.

### 2. `file_locations` (Physical Record)
- Keyed by unique location ID (`loc-UUID`).
- **mediaAssetId**: Foreign key pointing to `media_assets.id`.
- **directoryId**: Foreign key pointing to `directory_sources.id`.
- **availabilityStatus**: Indicates if the file is reachable (`available`), needs authorization (`permission-required`), or is missing (`missing`).

---

## File Status & logical Availability

A media asset is logical available (`available`) if **at least one** of its physical `file_locations` has an `availabilityStatus` of `'available'`. If all connected locations are `'missing'` or `'permission-required'`, the logical asset is flagged as disconnected but all ratings and reviews remain intact.

---

## Schema Migration History

- **v1**: LocalStorage schema with base64 encoded thumbnails.
- **v2**: Migration of base64 thumbnails to binary Blobs inside IndexedDB to prevent localStorage quota exhaustion.
- **v3**: Separation of `videos` into `media_assets` and `file_locations` to support content-hash identity. Related tables migrated from `videoId` to `mediaAssetId`.

---

## Future Extensibility Design

The `media_assets` schema is designed to allow extensions for AI analysis and natural language search.

### Proposed AI/Search Fields (Extensibility Blueprint)
```json
{
  "jellyfinItemId": "string",
  "transcript": {
    "text": "string",
    "segments": [{"start": 0.0, "end": 2.5, "text": "string"}]
  },
  "sceneSummaries": [
    {"start": 0.0, "end": 10.0, "summary": "string"}
  ],
  "aiTags": ["string"],
  "embeddingRefId": "string",
  "searchIndexStatus": "pending | indexed | failed"
}
```

### Data Provenance & AI Isolation
To distinguish human-created metadata from AI-generated outputs, all future AI modules must register metadata under a `provenance` wrapper, specifying the generating model name, version, timestamp, and confidence:

```json
{
  "provenance": {
    "module": "whisper-v3",
    "createdAt": "2026-08-16T22:00:00Z",
    "confidence": 0.94
  }
}
```
All UI elements presenting AI-generated data must display a visual indicator of its source model.
