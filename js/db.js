/**
 * Database abstraction layer using localStorage and IndexedDB.
 * Implements a relational data schema for video reviews, ratings, tags, and timeline notes.
 */

import { base64ToBlob, normalizePath } from './video-helper.js';
import { normalizeTag } from './review-sharing/review-share-model.js';
import { resolvePendingSharedReviewsForVideo } from './review-sharing/pending-shared-review-resolver.js';

// Helper to generate unique IDs
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

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

// Normalizes displayTitle: null/undefined/blank becomes null, non-empty string is trimmed.
export function normalizeDisplayTitle(title) {
  if (title === null || title === undefined) return null;
  const trimmed = String(title).trim();
  return trimmed === '' ? null : trimmed;
}

// Default Rating Criteria
const DEFAULT_CRITERIA = [
  { id: 'crit-content', name: '内容', description: 'ストーリーやテーマ性など構成要素の評価', displayOrder: 1, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-visuals', name: '映像', description: '画質、カメラワーク、演出手法の美しさ', displayOrder: 2, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-audio', name: '音声', description: '音響効果、BGM、声優・録音の明瞭度', displayOrder: 3, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-pacing', name: 'テンポ', description: '展開速度、無駄な引き伸ばしのなさ', displayOrder: 4, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-originality', name: '独自性', description: '企画力、構成、新規性、他にない特徴', displayOrder: 5, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-replayability', name: '再視聴性', description: '何度も見たくなる魅力、見返した時の発見', displayOrder: 6, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

// Sample Videos with sourceType: 'url' (removed)
const SAMPLE_MEDIA_ASSETS = [];

const SAMPLE_FILE_LOCATIONS = [];

// --- INDEXEDDB ADAPTER CLASS (Version 2 with handles store) ---
export class IndexedDBStore {
  constructor(dbName = 'VideoReviewerDB', storeName = 'images', version = 2) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = version;
    this.db = null;
    this.initError = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        this.initError = new Error('IndexedDB is not supported in this browser.');
        reject(this.initError);
        return;
      }

      try {
        const request = indexedDB.open(this.dbName, this.version);

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('images')) {
            db.createObjectStore('images', { keyPath: 'id' });
          }
          // Store 2: For Directory Handles
          if (!db.objectStoreNames.contains('handles')) {
            db.createObjectStore('handles', { keyPath: 'id' });
          }
        };

        request.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this);
        };

        request.onerror = (e) => {
          this.initError = new Error('IndexedDB open request failed: ' + e.target.error?.message);
          reject(this.initError);
        };
      } catch (err) {
        this.initError = err;
        reject(err);
      }
    });
  }

  get(id, customStoreName = null) {
    const store = customStoreName || this.storeName;
    return new Promise((resolve, reject) => {
      if (this.initError) {
        reject(new Error('IndexedDB is not available: ' + this.initError.message));
        return;
      }
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      try {
        const tx = this.db.transaction(store, 'readonly');
        const objectStore = tx.objectStore(store);
        const req = objectStore.get(id);

        req.onsuccess = () => {
          resolve(req.result ? req.result.data : null);
        };

        req.onerror = (e) => {
          reject(new Error(`Failed to retrieve from ${store}: ` + e.target.error?.message));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  put(id, data, customStoreName = null) {
    const store = customStoreName || this.storeName;
    return new Promise((resolve, reject) => {
      if (this.initError) {
        reject(new Error('IndexedDB is not available: ' + this.initError.message));
        return;
      }
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      try {
        const tx = this.db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        const req = objectStore.put({ id, data, updatedAt: new Date().toISOString() });

        req.onsuccess = () => {
          resolve();
        };

        req.onerror = (e) => {
          reject(new Error(`Failed to save to ${store}: ` + e.target.error?.message));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  delete(id, customStoreName = null) {
    const store = customStoreName || this.storeName;
    return new Promise((resolve, reject) => {
      if (this.initError) {
        reject(new Error('IndexedDB is not available: ' + this.initError.message));
        return;
      }
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      try {
        const tx = this.db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        const req = objectStore.delete(id);

        req.onsuccess = () => {
          resolve();
        };

        req.onerror = (e) => {
          reject(new Error(`Failed to delete from ${store}: ` + e.target.error?.message));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  getAll(customStoreName = null) {
    const store = customStoreName || this.storeName;
    return new Promise((resolve, reject) => {
      if (this.initError) {
        reject(new Error('IndexedDB is not available: ' + this.initError.message));
        return;
      }
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      try {
        const tx = this.db.transaction(store, 'readonly');
        const objectStore = tx.objectStore(store);
        const req = objectStore.getAll();

        req.onsuccess = () => {
          resolve(req.result || []);
        };

        req.onerror = (e) => {
          reject(new Error(`Failed to retrieve all from ${store}: ` + e.target.error?.message));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  clear() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      try {
        const tx = this.db.transaction('images', 'readwrite');
        const store = tx.objectStore('images');
        const req = store.clear();
        req.onsuccess = () => {
          // Clear handles too
          const tx2 = this.db.transaction('handles', 'readwrite');
          const store2 = tx2.objectStore('handles');
          const req2 = store2.clear();
          req2.onsuccess = () => resolve();
          req2.onerror = (e) => reject(e.target.error);
        };
        req.onerror = (e) => reject(e.target.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  clearImages() {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      try {
        const tx = this.db.transaction('images', 'readwrite');
        const store = tx.objectStore('images');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(new Error('Failed to clear images: ' + e.target.error?.message));
      } catch (err) {
        reject(err);
      }
    });
  }

  clearHandles() {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      try {
        const tx = this.db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(new Error('Failed to clear handles: ' + e.target.error?.message));
      } catch (err) {
        reject(err);
      }
    });
  }
}

// --- DATABASE LAYER ---
export class AppDatabase {
  constructor(storageEngine = null, prefix = 'vreview_', idbName = 'VideoReviewerDB') {
    this.storage = storageEngine || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.prefix = prefix;
    this.idbName = idbName;
    this.idb = null;
    this.idbAvailable = false;

    this.initDatabase();
  }

  // Load from storage or initialize with defaults
  initDatabase() {
    this.mediaAssets = this._loadTable('media_assets', SAMPLE_MEDIA_ASSETS);
    this.fileLocations = this._loadTable('file_locations', SAMPLE_FILE_LOCATIONS);
    this.criteria = this._loadTable('rating_criteria', DEFAULT_CRITERIA);
    this.reviews = this._loadTable('video_reviews', []);
    this.criterionRatings = this._loadTable('criterion_ratings', []);
    this.tags = this._loadTable('tags', []);

    const versionKey = `${this.prefix}schema_version`;
    const currentVersion = this.storage ? this.storage.getItem(versionKey) : null;
    if (!currentVersion || currentVersion !== '4') {
      this._legacyVideoTags = this._loadTable('video_tags', []);
    } else {
      this._legacyVideoTags = [];
    }

    this.timelineNotes = this._loadTable('timeline_notes', []);

    // Directory Sources table setup
    this.directorySources = this._loadTable('directory_sources', []);

    // Genres & templates tables
    this.genres = this._loadTable('genres', []);
    this.templates = this._loadTable('evaluation_templates', []);

    // Schema v4 tables
    this.reviewers = this._loadTable('reviewers', []);
    this.reviewTags = this._loadTable('review_tags', []);
    this.pendingSharedReviews = this._loadTable('pending_shared_reviews', []);
  }

  async initAsync() {
    this.idb = new IndexedDBStore(this.idbName);
    try {
      await this.idb.init();
      this.idbAvailable = true;
    } catch (e) {
      console.warn('IndexedDB initialization failed. Images/Handles will fall back:', e.message);
      this.idbAvailable = false;
    }

    // Perform base64 conversion migrations (v2)
    try {
      await this._migrateSchema();
    } catch (err) {
      console.error('Schema v2 migration failed:', err);
    }

    // Perform genre and template migrations
    this._migrateGenres();

    // Perform media assets & file locations migration (v3)
    await this._migrateToV3MediaIdentity();

    // Perform multi-reviewer and Schema v4 migration (v4)
    await this._migrateToV4MultiReview();



    // Backfill Schema v3 conflict fields and recover calculating status to pending
    let assetsModified = false;
    this.mediaAssets.forEach(a => {
      if (a.identityStatus === undefined) {
        a.identityStatus = 'normal';
        assetsModified = true;
      }
      if (a.identityConflictGroupId === undefined) {
        a.identityConflictGroupId = null;
        assetsModified = true;
      }
      const isUrlOrSample = false;
      if (!isUrlOrSample && a.hashStatus === 'calculating') {
        a.hashStatus = 'pending';
        assetsModified = true;
      }
    });
    if (assetsModified) {
      this._saveTable('media_assets', this.mediaAssets);
    }
  }

  _loadTable(key, defaults) {
    if (!this.storage) return JSON.parse(JSON.stringify(defaults));
    try {
      const data = this.storage.getItem(`${this.prefix}${key}`);
      if (!data) {
        this.storage.setItem(`${this.prefix}${key}`, JSON.stringify(defaults));
        return JSON.parse(JSON.stringify(defaults));
      }
      return JSON.parse(data);
    } catch (e) {
      console.error(`Failed to load localStorage table for ${key}:`, e);
      return JSON.parse(JSON.stringify(defaults));
    }
  }

  _saveTable(key, data) {
    if (this._inRestoreTransaction && !this._allowSaveDuringRestore) return;
    if (!this.storage) return;
    try {
      this.storage.setItem(`${this.prefix}${key}`, JSON.stringify(data));
    } catch (e) {
      throw new Error(`ブラウザの保存容量上限に達したため保存できませんでした (${e.name})`);
    }
  }

  // Schema migration version 2: localStorage base64 -> IndexedDB Blobs
  async _migrateSchema() {
    if (!this.storage) return;
    const versionKey = `${this.prefix}schema_version`;
    const currentVersion = this.storage.getItem(versionKey);

    if (currentVersion === '2' || currentVersion === '3' || currentVersion === '4') {
      return;
    }

    console.log('Running IndexedDB image storage schema migration (v2)...');

    try {
      const videos = this._loadTable('videos', []);
      const timelineNotes = this._loadTable('timeline_notes', []);

      // 1. Migrate Videos thumbnails
      let videosChanged = false;
      for (const video of videos) {
        if (video.thumbnailUrl && video.thumbnailUrl.startsWith('data:image/') && !video.thumbnailId) {
          const blob = base64ToBlob(video.thumbnailUrl);
          if (blob) {
            const imgId = `img-vid-${video.id}`;
            await this.idb.put(imgId, blob, 'images');
            video.thumbnailId = imgId;
            videosChanged = true;
          }
        }
      }

      // 2. Migrate Timeline Notes screenshots
      let notesChanged = false;
      for (const note of timelineNotes) {
        if (note.thumbnailUrl && note.thumbnailUrl.startsWith('data:image/') && !note.thumbnailId) {
          const blob = base64ToBlob(note.thumbnailUrl);
          if (blob) {
            const imgId = `img-note-${note.id}`;
            await this.idb.put(imgId, blob, 'images');
            note.thumbnailId = imgId;
            notesChanged = true;
          }
        }
      }

      if (videosChanged) {
        this._saveTable('videos', videos);
      }
      if (notesChanged) {
        this._saveTable('timeline_notes', timelineNotes);
      }

      this.storage.setItem(versionKey, '2');
      console.log('Migration to IndexedDB completed successfully.');
    } catch (err) {
      console.error('IndexedDB image migration failed. Retaining original data:', err);
    }
  }

  _migrateGenres() {
    if (!this.storage) return;

    // 2. Find or create default genre '一般'
    let defaultGenre = this.genres.find(g => g.id === 'genre-default' || g.isDefault);
    if (!defaultGenre) {
      defaultGenre = {
        id: 'genre-default',
        name: '一般',
        displayTitle: '一般',
        description: 'デフォルトのジャンル区分',
        displayOrder: 1,
        isActive: true,
        isDefault: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.genres.push(defaultGenre);
      this._saveTable('genres', this.genres);
    }

    // 3. Find or create default template
    let defaultTemplate = this.templates.find(t => t.genreId === defaultGenre.id);
    if (!defaultTemplate) {
      defaultTemplate = {
        id: 'temp-default',
        genreId: defaultGenre.id,
        name: 'デフォルトテンプレート',
        criteriaIds: 'crit-content,crit-visuals,crit-audio,crit-pacing,crit-originality,crit-replayability',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.templates.push(defaultTemplate);
      this._saveTable('evaluation_templates', this.templates);
    }

    // 4. Update existing criteria to reference default template if they have no templateId
    let criteriaChanged = false;
    this.criteria.forEach(c => {
      if (!c.templateId) {
        c.templateId = defaultTemplate.id;
        criteriaChanged = true;
      }
    });
    if (criteriaChanged) {
      this._saveTable('rating_criteria', this.criteria);
    }

    const versionKey = `${this.prefix}schema_version`;
    const currentVersion = this.storage.getItem(versionKey);

    if (currentVersion === '3') {
      let assetsChanged = false;
      this.mediaAssets.forEach(a => {
        if (!a.genreId) {
          a.genreId = defaultGenre.id;
          assetsChanged = true;
        }
      });
      if (assetsChanged) {
        this._saveTable('media_assets', this.mediaAssets);
      }

      let ratingsChanged = false;
      this.criterionRatings.forEach(cr => {
        if (!cr.genreId || !cr.criterionName) {
          const review = this.reviews.find(r => r.id === cr.videoReviewId);
          const mediaAssetId = review ? review.mediaAssetId : null;
          const asset = mediaAssetId ? this.mediaAssets.find(a => a.id === mediaAssetId) : null;

          const gId = asset ? (asset.genreId || defaultGenre.id) : defaultGenre.id;
          const g = this.genres.find(genre => genre.id === gId) || defaultGenre;
          const c = this.criteria.find(crit => crit.id === cr.criterionId);

          cr.genreId = g.id;
          cr.genreName = g.name;
          cr.criterionName = c ? c.name : (cr.criterionName || '不明な項目');
          ratingsChanged = true;
        }
      });
      if (ratingsChanged) {
        this._saveTable('criterion_ratings', this.criterionRatings);
      }
    } else {
      const videos = this._loadTable('videos', []);
      let videosChanged = false;
      videos.forEach(v => {
        if (!v.genreId) {
          v.genreId = defaultGenre.id;
          videosChanged = true;
        }
      });
      if (videosChanged) {
        this._saveTable('videos', videos);
      }

      let ratingsChanged = false;
      this.criterionRatings.forEach(cr => {
        if (!cr.genreId || !cr.criterionName) {
          const review = this.reviews.find(r => r.id === cr.videoReviewId);
          const videoId = review ? review.videoId : null;
          const video = videos.find(v => v.id === videoId);

          const gId = video ? (video.genreId || defaultGenre.id) : defaultGenre.id;
          const g = this.genres.find(genre => genre.id === gId) || defaultGenre;
          const c = this.criteria.find(crit => crit.id === cr.criterionId);

          cr.genreId = g.id;
          cr.genreName = g.name;
          cr.criterionName = c ? c.name : (cr.criterionName || '不明な項目');
          ratingsChanged = true;
        }
      });
      if (ratingsChanged) {
        this._saveTable('criterion_ratings', this.criterionRatings);
      }
    }
  }

  async _migrateToV3MediaIdentity() {
    if (!this.storage) return;
    const versionKey = `${this.prefix}schema_version`;
    const currentVersion = this.storage.getItem(versionKey);

    if (currentVersion === '3' || currentVersion === '4') {
      return;
    }

    const hasLegacyVideos = this.storage.getItem(`${this.prefix}videos`) !== null;
    if (!hasLegacyVideos) {
      this.storage.setItem(versionKey, '3');
      this._saveAll();
      console.log('Fresh install detected, skipping v3 migration and setting version to 3.');
      return;
    }

    console.log('Running Content Hash Separation and Media Identity migration (v3)...');

    const originalVideos = this._loadTable('videos', []);
    const originalReviews = this._loadTable('video_reviews', []);
    const originalVideoTags = this._loadTable('video_tags', []);
    const originalTimelineNotes = this._loadTable('timeline_notes', []);

    if (originalVideos.length === 0) {
      this.storage.removeItem(`${this.prefix}videos`);
      this.storage.setItem(versionKey, '3');
      this._saveAll();
      console.log('No legacy videos found. Setting schema version to 3.');
      return;
    }

    try {
      const mediaAssets = [];
      const fileLocations = [];

      for (const v of originalVideos) {
        const asset = {
          id: v.id,
          contentHash: v.contentHash || '',
          hashAlgorithm: v.hashAlgorithm || 'SHA-256',
          quickHash: v.quickHash || '',
          hashStatus: v.hashStatus || 'pending',
          fileSize: v.fileSize || 0,
          duration: v.duration || 0,
          displayTitle: v.displayTitle || v.title || v.fileName || '不明な動画',
          genreId: v.genreId || 'genre-default',
          thumbnailId: v.thumbnailId || '',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          createdAt: v.createdAt || new Date().toISOString(),
          updatedAt: v.updatedAt || new Date().toISOString()
        };
        mediaAssets.push(asset);

        const loc = {
          id: 'loc-' + generateUUID(),
          mediaAssetId: v.id,
          directoryId: v.directoryId || '',
          relativePath: v.relativePath || '',
          fileName: v.fileName || '',
          fileSize: v.fileSize || 0,
          lastModified: v.lastModified || 0,
          availabilityStatus: v.availabilityStatus || 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: v.createdAt || new Date().toISOString(),
          updatedAt: v.updatedAt || new Date().toISOString()
        };
        fileLocations.push(loc);
      }

      const reviews = originalReviews.map(r => {
        const newR = { ...r };
        if (newR.videoId) {
          newR.mediaAssetId = newR.videoId;
          delete newR.videoId;
        }
        return newR;
      });

      const videoTags = originalVideoTags.map(vt => {
        const newVT = { ...vt };
        if (newVT.videoId) {
          newVT.mediaAssetId = newVT.videoId;
          delete newVT.videoId;
        }
        return newVT;
      });

      const timelineNotes = originalTimelineNotes.map(n => {
        const newN = { ...n };
        if (newN.videoId) {
          newN.mediaAssetId = newN.videoId;
          delete newN.videoId;
        }
        return newN;
      });

      this._saveTable('media_assets', mediaAssets);
      this._saveTable('file_locations', fileLocations);
      this._saveTable('video_reviews', reviews);
      this._saveTable('video_tags', videoTags);
      this._saveTable('timeline_notes', timelineNotes);

      this.storage.removeItem(`${this.prefix}videos`);

      this.mediaAssets = mediaAssets;
      this.fileLocations = fileLocations;
      this.reviews = reviews;
      this._legacyVideoTags = videoTags;
      this.timelineNotes = timelineNotes;
      this.videos = undefined;

      this.storage.setItem(versionKey, '3');
      console.log('Migration to v3 (Persistent Media Identity) completed successfully.');
    } catch (err) {
      console.error('Migration to v3 failed. Rolling back changes...', err);
      this._saveTable('videos', originalVideos);
      this._saveTable('video_reviews', originalReviews);
      this._saveTable('video_tags', originalVideoTags);
      this._saveTable('timeline_notes', originalTimelineNotes);
      throw err;
    }
  }

  async _migrateToV4MultiReview() {
    if (!this.storage) return;
    const versionKey = `${this.prefix}schema_version`;
    const currentVersion = this.storage.getItem(versionKey);

    if (currentVersion === '4') {
      return;
    }

    console.log('Running Multi-Reviewer and Schema v4 migration...');

    // 1. Snapshot original collections for rollback
    const inMemorySnapshot = {
      mediaAssets: JSON.parse(JSON.stringify(this.mediaAssets || [])),
      fileLocations: JSON.parse(JSON.stringify(this.fileLocations || [])),
      criteria: JSON.parse(JSON.stringify(this.criteria || [])),
      reviews: JSON.parse(JSON.stringify(this.reviews || [])),
      criterionRatings: JSON.parse(JSON.stringify(this.criterionRatings || [])),
      tags: JSON.parse(JSON.stringify(this.tags || [])),
      _legacyVideoTags: JSON.parse(JSON.stringify(this._legacyVideoTags || [])),
      timelineNotes: JSON.parse(JSON.stringify(this.timelineNotes || [])),
      directorySources: JSON.parse(JSON.stringify(this.directorySources || [])),
      genres: JSON.parse(JSON.stringify(this.genres || [])),
      templates: JSON.parse(JSON.stringify(this.templates || [])),
      reviewers: JSON.parse(JSON.stringify(this.reviewers || [])),
      reviewTags: JSON.parse(JSON.stringify(this.reviewTags || [])),
      pendingSharedReviews: JSON.parse(JSON.stringify(this.pendingSharedReviews || []))
    };

    const originalLocalData = {};
    const localKeys = [
      'media_assets', 'file_locations', 'rating_criteria', 'video_reviews', 'criterion_ratings',
      'tags', 'video_tags', 'timeline_notes', 'directory_sources',
      'genres', 'evaluation_templates', 'reviewers', 'review_tags', 'pending_shared_reviews'
    ];
    localKeys.forEach(k => {
      originalLocalData[k] = this.storage.getItem(`${this.prefix}${k}`);
    });

    try {
      await this._migrateInMemoryToV4();

      const validationErrors = this.validateV4Structure({
        reviewers: this.reviewers,
        media_assets: this.mediaAssets,
        file_locations: this.fileLocations,
        video_reviews: this.reviews,
        criterion_ratings: this.criterionRatings,
        tags: this.tags,
        review_tags: this.reviewTags,
        timeline_notes: this.timelineNotes,
        directory_sources: this.directorySources,
        genres: this.genres,
        evaluation_templates: this.templates,
        pending_shared_reviews: this.pendingSharedReviews
      });

      if (validationErrors.length > 0) {
        throw new Error('V4 Schema Validation Failed: ' + validationErrors.join('; '));
      }

      this._saveTable('reviewers', this.reviewers);
      this._saveTable('video_reviews', this.reviews);
      this._saveTable('review_tags', this.reviewTags);
      this._saveTable('pending_shared_reviews', this.pendingSharedReviews);

      if (this.storage) {
        this.storage.removeItem(`${this.prefix}video_tags`);
      }

      this.storage.setItem(versionKey, '4');
      console.log('Migration to Schema v4 completed successfully.');
    } catch (err) {
      console.error('Migration to Schema v4 failed. Rolling back changes...', err);
      // Rollback memory state
      this.mediaAssets = inMemorySnapshot.mediaAssets;
      this.fileLocations = inMemorySnapshot.fileLocations;
      this.criteria = inMemorySnapshot.criteria;
      this.reviews = inMemorySnapshot.reviews;
      this.criterionRatings = inMemorySnapshot.criterionRatings;
      this.tags = inMemorySnapshot.tags;
      this._legacyVideoTags = inMemorySnapshot._legacyVideoTags;
      this.timelineNotes = inMemorySnapshot.timelineNotes;
      this.directorySources = inMemorySnapshot.directorySources;
      this.genres = inMemorySnapshot.genres;
      this.templates = inMemorySnapshot.templates;
      this.reviewers = inMemorySnapshot.reviewers;
      this.reviewTags = inMemorySnapshot.reviewTags;
      this.pendingSharedReviews = inMemorySnapshot.pendingSharedReviews;

      // Rollback localStorage
      localKeys.forEach(k => {
        if (originalLocalData[k] !== null && originalLocalData[k] !== undefined) {
          this.storage.setItem(`${this.prefix}${k}`, originalLocalData[k]);
        } else {
          this.storage.removeItem(`${this.prefix}${k}`);
        }
      });
      throw err;
    }
  }

  async _migrateInMemoryToV4() {
    const localReviewer = this._ensureLocalReviewerDuringInitialization();

    // Check duplicate mediaAssetId in reviews
    const assetReviewMap = new Map();
    this.reviews.forEach(r => {
      if (!assetReviewMap.has(r.mediaAssetId)) {
        assetReviewMap.set(r.mediaAssetId, []);
      }
      assetReviewMap.get(r.mediaAssetId).push(r);
    });

    for (const [mediaAssetId, revs] of assetReviewMap.entries()) {
      if (revs.length > 1) {
        throw new Error(`同一media asset [${mediaAssetId}] に対する複数のレビューが検出されました。重複レビューID: [${revs.map(r=>r.id).join(', ')}]`);
      }
    }

    const migratedReviews = [];
    this.reviews.forEach(r => {
      let score = null;
      if (r.overallScore !== undefined) {
        score = r.overallScore;
      } else {
        score = overallGradeToScore(r.overallGrade);
      }

      migratedReviews.push({
        id: r.id,
        mediaAssetId: r.mediaAssetId,
        reviewerId: localReviewer.id,
        origin: r.origin || 'local',
        overallScore: score,
        comment: r.comment || '',
        createdAt: r.createdAt || new Date().toISOString(),
        updatedAt: r.updatedAt || new Date().toISOString()
      });
    });

    // Migrate timeline notes to Schema v4 (assign videoReviewId strictly)
    this.timelineNotes.forEach(note => {
      if (note.videoReviewId) {
        const review = migratedReviews.find(r => r.id === note.videoReviewId);
        if (!review) {
          throw new Error(`Timeline note ${note.id} references non-existent review ${note.videoReviewId}`);
        }
        const assetId = note.mediaAssetId || note.videoId;
        if (assetId && review.mediaAssetId !== assetId) {
          throw new Error(`Timeline note ${note.id} references review ${review.id} with mediaAssetId ${review.mediaAssetId} which contradicts note's video reference ${assetId}`);
        }
        note.mediaAssetId = review.mediaAssetId;
        delete note.videoId;
      } else {
        const assetId = note.mediaAssetId || note.videoId;
        if (!assetId) {
          throw new Error(`Timeline note ${note.id} is missing video reference (videoId/mediaAssetId)`);
        }
        const matchingReviews = migratedReviews.filter(r => r.mediaAssetId === assetId && r.reviewerId === localReviewer.id);
        if (matchingReviews.length === 0) {
          throw new Error(`Timeline note ${note.id} has 0 matching owner reviews for asset ${assetId}`);
        }
        if (matchingReviews.length > 1) {
          throw new Error(`Timeline note ${note.id} has multiple matching owner reviews for asset ${assetId}`);
        }
        note.videoReviewId = matchingReviews[0].id;
        note.mediaAssetId = assetId;
        delete note.videoId;
      }
    });

    const migratedReviewTags = [];
    const seenReviewTags = new Set();
    const vtags = this._legacyVideoTags || [];
    vtags.forEach(vt => {
      let targetReview = migratedReviews.find(r => r.mediaAssetId === vt.mediaAssetId);
      if (!targetReview) {
        targetReview = {
          id: 'rev-' + generateUUID(),
          mediaAssetId: vt.mediaAssetId,
          reviewerId: localReviewer.id,
          origin: 'local',
          overallScore: null,
          comment: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        migratedReviews.push(targetReview);
      }

      const rtagKey = `${targetReview.id}::${vt.tagId}`;
      if (!seenReviewTags.has(rtagKey)) {
        migratedReviewTags.push({
          id: 'review-tag-' + generateUUID(),
          videoReviewId: targetReview.id,
          tagId: vt.tagId,
          createdAt: new Date().toISOString()
        });
        seenReviewTags.add(rtagKey);
      }
    });

    this.reviews = migratedReviews;
    this.reviewTags = migratedReviewTags;
    this.pendingSharedReviews = this.pendingSharedReviews || [];
    this._legacyVideoTags = [];
  }

  validateV4Structure(data) {
    const errors = [];

    // 1. Reviewer validation
    const reviewers = data.reviewers || [];
    const reviewerIds = new Set();
    let localReviewerCount = 0;
    reviewers.forEach((r, idx) => {
      if (!r.id) errors.push(`reviewer[${idx}] id is missing`);
      if (reviewerIds.has(r.id)) errors.push(`Duplicate reviewer ID: ${r.id}`);
      reviewerIds.add(r.id);
      if (!r.displayName || String(r.displayName).trim() === '') {
        errors.push(`reviewer ${r.id || idx} displayName is empty`);
      }
      if (r.isLocal === true) {
        localReviewerCount++;
      }
    });
    if (localReviewerCount !== 1) {
      errors.push(`local reviewer count must be exactly 1, found ${localReviewerCount}`);
    }

    // 2. Media asset checks
    const mediaAssets = data.media_assets || [];
    mediaAssets.forEach(v => {
      if (v.sourceType === 'url' || (v.videoUrl !== undefined && v.videoUrl !== null && v.videoUrl !== '')) {
        errors.push(`URL video source found in media asset ${v.id}. This is deprecated.`);
      }
    });

    // 3. Review validation
    const reviews = data.video_reviews || [];
    const reviewIds = new Set();
    const uniqueReviews = new Set();
    reviews.forEach((r, idx) => {
      if (!r.id) errors.push(`video_review[${idx}] id is missing`);
      if (reviewIds.has(r.id)) errors.push(`Duplicate review ID: ${r.id}`);
      reviewIds.add(r.id);

      const uniqueKey = `${r.mediaAssetId}::${r.reviewerId}`;
      if (uniqueReviews.has(uniqueKey)) {
        errors.push(`Duplicate review for mediaAssetId + reviewerId: ${uniqueKey}`);
      }
      uniqueReviews.add(uniqueKey);

      // Check reviewer exists
      if (!reviewerIds.has(r.reviewerId)) {
        errors.push(`Review ${r.id} references non-existent reviewer: ${r.reviewerId}`);
      }
      // Check media asset exists
      if (!mediaAssets.some(v => v.id === r.mediaAssetId)) {
        errors.push(`Review ${r.id} references non-existent media asset: ${r.mediaAssetId}`);
      }
      // Check overallScore
      if (r.overallScore !== null && r.overallScore !== undefined) {
        const score = parseInt(r.overallScore, 10);
        if (isNaN(score) || score < 1 || score > 5) {
          errors.push(`Review ${r.id} has invalid overallScore: ${r.overallScore}`);
        }
      }
      // Check origin
      if (r.origin !== 'local' && r.origin !== 'imported') {
        errors.push(`Review ${r.id} has invalid origin: ${r.origin}`);
      }
      // Check comment type
      if (r.comment !== null && r.comment !== undefined && typeof r.comment !== 'string') {
        errors.push(`Review ${r.id} has invalid comment type: ${typeof r.comment}`);
      }
    });

    // 4. Criterion rating validation
    const ratings = data.criterion_ratings || [];
    ratings.forEach(cr => {
      if (!reviewIds.has(cr.videoReviewId)) {
        errors.push(`Criterion rating ${cr.id} references non-existent review: ${cr.videoReviewId}`);
      }
    });

    // 5. Review tags validation
    const reviewTags = data.review_tags || [];
    const tagIds = new Set((data.tags || []).map(t => t.id));
    const reviewTagIds = new Set();
    const seenReviewTags = new Set();
    reviewTags.forEach(rt => {
      if (!rt.id) errors.push(`review_tag id is missing`);
      if (reviewTagIds.has(rt.id)) errors.push(`Duplicate review tag ID: ${rt.id}`);
      reviewTagIds.add(rt.id);

      const rtagKey = `${rt.videoReviewId}::${rt.tagId}`;
      if (seenReviewTags.has(rtagKey)) {
        errors.push(`Duplicate review tag association for videoReviewId + tagId: ${rtagKey}`);
      }
      seenReviewTags.add(rtagKey);

      if (!reviewIds.has(rt.videoReviewId)) {
        errors.push(`Review tag ${rt.id} references non-existent review: ${rt.videoReviewId}`);
      }
      if (!tagIds.has(rt.tagId)) {
        errors.push(`Review tag ${rt.id} references non-existent tag: ${rt.tagId}`);
      }
    });

    // 6. Timeline notes validation
    const notes = data.timeline_notes || [];
    notes.forEach(n => {
      if (!reviewIds.has(n.videoReviewId)) {
        errors.push(`Timeline note ${n.id} references non-existent review: ${n.videoReviewId}`);
      }
    });

    // 7. Pending shared reviews validation
    const pending = data.pending_shared_reviews || [];
    const pendingIds = new Set();
    pending.forEach(p => {
      if (!p.id) errors.push(`pending_shared_review id is missing`);
      if (pendingIds.has(p.id)) errors.push(`Duplicate pending ID: ${p.id}`);
      pendingIds.add(p.id);

      if (!/^[0-9a-f]{64}$/.test(p.videoHash)) {
        errors.push(`Pending review ${p.id} has invalid videoHash: ${p.videoHash}`);
      }
      if (p.hashAlgorithm !== 'sha256') {
        errors.push(`Pending review ${p.id} has invalid hashAlgorithm: ${p.hashAlgorithm}`);
      }
      if (p.status !== 'pending') {
        errors.push(`Pending review ${p.id} has invalid status: ${p.status}`);
      }
    });

    return errors;
  }

  // --- IMAGE STORES ---

  async getImage(imageId) {
    if (!imageId) return null;
    if (!this.idbAvailable) {
      throw new Error('IndexedDB is not initialized or unavailable');
    }
    return await this.idb.get(imageId, 'images');
  }

  async putImage(imageId, imageBlob) {
    if (!imageBlob) return;
    if (!this.idbAvailable) {
      throw new Error('IndexedDB is not initialized or unavailable');
    }
    await this.idb.put(imageId, imageBlob, 'images');
  }

  // --- FILE SYSTEM ACCESS DIRECTORY HANDLES STORES ---

  async getDirectoryHandle(handleKey) {
    if (!this.idbAvailable) {
      throw new Error('IndexedDB is not initialized or unavailable');
    }
    return await this.idb.get(handleKey, 'handles');
  }

  async putDirectoryHandle(handleKey, handle) {
    if (!this.idbAvailable) {
      throw new Error('IndexedDB is not initialized or unavailable');
    }
    await this.idb.put(handleKey, handle, 'handles');
  }

  async deleteDirectoryHandle(handleKey) {
    if (!this.idbAvailable) {
      throw new Error('IndexedDB is not initialized or unavailable');
    }
    await this.idb.delete(handleKey, 'handles');
  }

  // --- DIRECTORY SOURCES OPERATIONS ---

  getDirectorySources() {
    return this.directorySources;
  }

  getDirectorySource(id) {
    return this.directorySources.find(ds => ds.id === id);
  }

  async addDirectorySource({ name, includeSubdirectories }) {
    const id = 'dir-' + generateUUID();
    const source = {
      id,
      name: name || '動画フォルダ',
      handleKey: `directory-handle-${id}`,
      includeSubdirectories: includeSubdirectories !== false,
      permissionStatus: 'prompt', // Initial query needed on boot
      lastScannedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.directorySources.push(source);
    this._saveTable('directory_sources', this.directorySources);
    return source;
  }

  async updateDirectorySource(id, updates) {
    const idx = this.directorySources.findIndex(ds => ds.id === id);
    if (idx !== -1) {
      this.directorySources[idx] = {
        ...this.directorySources[idx],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this._saveTable('directory_sources', this.directorySources);
      return this.directorySources[idx];
    }
    return null;
  }

  async reconnectDirectorySource(sourceId, handle) {
    const source = this.getDirectorySource(sourceId);
    if (!source) {
      throw new Error('再接続対象のフォルダソースが見つかりません。');
    }

    const handleKey = source.handleKey || `directory-handle-${source.id}`;
    if (this.idbAvailable) {
      await this.putDirectoryHandle(handleKey, handle);
    }

    const status = typeof handle.queryPermission === 'function'
      ? await handle.queryPermission({ mode: 'read' })
      : 'granted';

    await this.updateDirectorySource(source.id, {
      name: handle.name,
      handleKey: handleKey,
      permissionStatus: status,
      updatedAt: new Date().toISOString()
    });

    await this.updateDirectoryVideosAvailability(source.id, status === 'granted' ? 'available' : 'permission-required');
  }

  async deleteDirectorySource(id) {
    const source = this.getDirectorySource(id);
    if (!source) return false;

    // 1. Delete Handle from IndexedDB
    if (this.idbAvailable) {
      try {
        await this.deleteDirectoryHandle(source.handleKey);
      } catch (err) {
        console.error('Failed to delete directory handle:', err);
      }
    }

    // 2. Remove Source from list
    this.directorySources = this.directorySources.filter(ds => ds.id !== id);
    this._saveTable('directory_sources', this.directorySources);

    // 3. Mark matching physical locations as 'permission-required'
    this.fileLocations.forEach(loc => {
      if (loc.directoryId === id) {
        loc.availabilityStatus = 'permission-required';
        loc.updatedAt = new Date().toISOString();
      }
    });
    this._saveTable('file_locations', this.fileLocations);
    return true;
  }

  async updateDirectoryVideosAvailability(directoryId, availabilityStatus) {
    let changed = false;
    this.fileLocations.forEach(loc => {
      if (loc.directoryId === directoryId) {
        if (loc.availabilityStatus !== availabilityStatus) {
          loc.availabilityStatus = availabilityStatus;
          loc.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
    });
    if (changed) {
      this._saveTable('file_locations', this.fileLocations);
    }
  }

  // --- VIDEO OPERATIONS ---

  get videos() {
    return this.getVideos();
  }

  set videos(val) {
    if (val === undefined || val === null) {
      return;
    }
    if (Array.isArray(val)) {
      this.mediaAssets = [];
      this.fileLocations = [];
      val.forEach(v => {
        const asset = {
          id: v.id || ('vid-' + generateUUID()),
          contentHash: v.contentHash || '',
          hashAlgorithm: v.hashAlgorithm || 'SHA-256',
          quickHash: v.quickHash || '',
          hashStatus: v.hashStatus || 'pending',
          fileSize: v.fileSize || 0,
          duration: v.duration || 0,
          displayTitle: v.displayTitle || v.title || v.fileName || '不明な動画',
          genreId: v.genreId || 'genre-default',
          thumbnailId: v.thumbnailId || '',
          createdAt: v.createdAt || new Date().toISOString(),
          updatedAt: v.updatedAt || new Date().toISOString()
        };
        this.mediaAssets.push(asset);

        const loc = {
          id: 'loc-' + (v.id ? v.id.replace('vid-', '') : generateUUID()),
          mediaAssetId: asset.id,
          directoryId: v.directoryId || '',
          relativePath: v.relativePath || '',
          fileName: v.fileName || '',
          fileSize: v.fileSize || 0,
          lastModified: v.lastModified || 0,
          availabilityStatus: v.availabilityStatus || 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: v.createdAt || new Date().toISOString(),
          updatedAt: v.updatedAt || new Date().toISOString()
        };
        this.fileLocations.push(loc);
      });
    }
  }

  _buildVirtualVideo(asset) {
    if (!asset) return undefined;
    const locations = this.fileLocations.filter(loc => loc.mediaAssetId === asset.id);

    const scoredLocations = locations.map(loc => {
      const ds = this.directorySources.find(source => source.id === loc.directoryId);
      let status = 'missing';
      let score = 0;

      if (loc.availabilityStatus === 'available') {
        if (ds && ds.handleKey && ds.permissionStatus !== 'disconnected') {
          if (ds.permissionStatus === 'granted') {
            status = 'available';
            score = 3;
          } else {
            status = 'permission-required';
            score = 2;
          }
        } else {
          status = 'missing';
          score = 0;
        }
      } else if (loc.availabilityStatus === 'permission-required') {
        if (ds && ds.handleKey && ds.permissionStatus !== 'disconnected') {
          status = 'permission-required';
          score = 1;
        } else {
          status = 'missing';
          score = 0;
        }
      } else {
        status = loc.availabilityStatus || 'missing';
        score = 0;
      }
      return { loc, status, score, lastVerifiedAt: loc.lastVerifiedAt || '' };
    });

    // Sort by score descending, then lastVerifiedAt descending safely
    scoredLocations.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const timeA = a.lastVerifiedAt ? new Date(a.lastVerifiedAt).getTime() : 0;
      const timeB = b.lastVerifiedAt ? new Date(b.lastVerifiedAt).getTime() : 0;
      return timeB - timeA;
    });

    const primaryWrapper = scoredLocations[0];
    const primary = primaryWrapper ? primaryWrapper.loc : null;

    let logicalStatus = 'missing';
    if (scoredLocations.some(w => w.status === 'available')) {
      logicalStatus = 'available';
    } else if (scoredLocations.some(w => w.status === 'permission-required')) {
      logicalStatus = 'permission-required';
    } else if (locations.some(loc => loc.availabilityStatus === 'scan-error')) {
      logicalStatus = 'scan-error';
    } else if (locations.some(loc => loc.availabilityStatus === 'unsupported')) {
      logicalStatus = 'unsupported';
    }

    const firstLoc = primary || {
      directoryId: '',
      relativePath: '',
      fileName: '',
      fileSize: asset.fileSize || 0,
      lastModified: 0
    };

    const displayTitle = asset.displayTitle;
    const title = displayTitle || firstLoc.fileName || '不明な動画';
    return {
      ...asset,
      displayTitle,
      title,
      fileName: firstLoc.fileName,
      fileSize: firstLoc.fileSize,
      directoryId: firstLoc.directoryId,
      relativePath: firstLoc.relativePath,
      lastModified: firstLoc.lastModified,
      availabilityStatus: logicalStatus,
      sourceType: 'directory',
      locations: scoredLocations.map(w => w.loc)
    };
  }

  getVideos() {
    return this.mediaAssets
      .filter(asset => !asset.isArchived)
      .map(asset => this._buildVirtualVideo(asset));
  }

  getVideo(id) {
    const asset = this.mediaAssets.find(a => a.id === id);
    if (!asset) return null;
    return this._buildVirtualVideo(asset);
  }

  getMediaAssetById(id) {
    const asset = this.mediaAssets.find(a => a.id === id);
    if (!asset) return null;
    return { ...asset };
  }

  async resolveAndRegisterNewScannedFileProvisional({
    directoryId,
    sf
  }) {
    // 1. Get candidates by quickHash and fileSize
    const candidates = this.mediaAssets.filter(a => a.fileSize === sf.fileSize && a.quickHash === sf.quickHash);

    if (candidates.length === 1) {
      // Exactly 1 candidate -> provisional match!
      const matchedAsset = candidates[0];

      if (matchedAsset.isArchived) {
        matchedAsset.isArchived = false;
        matchedAsset.archivedAt = null;
        matchedAsset.updatedAt = new Date().toISOString();
        this._saveTable('media_assets', this.mediaAssets);
      }

      const normPath = normalizePath(sf.relativePath);
      let existingLoc = this.fileLocations.find(l => l.directoryId === directoryId && normalizePath(l.relativePath) === normPath);
      if (!existingLoc) {
        const newLoc = {
          id: 'loc-' + generateUUID(),
          mediaAssetId: matchedAsset.id,
          directoryId: directoryId || '',
          relativePath: normPath,
          fileName: sf.fileName || '',
          fileSize: sf.fileSize || 0,
          lastModified: sf.lastModified || 0,
          availabilityStatus: 'available',
          lastVerifiedAt: '',
          verificationStatus: 'provisional',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.fileLocations.push(newLoc);
        this._saveTable('file_locations', this.fileLocations);
      } else {
        if (existingLoc.availabilityStatus !== 'available' || existingLoc.verificationStatus !== 'provisional') {
          existingLoc.availabilityStatus = 'available';
          existingLoc.verificationStatus = 'provisional';
          existingLoc.updatedAt = new Date().toISOString();
          this._saveTable('file_locations', this.fileLocations);
        }
      }
      return { status: 'merged', assetId: matchedAsset.id };
    } else if (candidates.length > 1) {
      // Multiple candidates -> do NOT merge. Treat as verification-pending.
      const newAsset = await this.addVideo({
        title: sf.fileName,
        fileName: sf.fileName,
        fileSize: sf.fileSize,
        duration: 0,
        sourceType: 'directory',
        directoryId,
        relativePath: sf.relativePath,
        lastModified: sf.lastModified,
        quickHash: sf.quickHash || '',
        hashStatus: 'pending',
        identityStatus: 'provisional'
      });
      const loc = this.fileLocations.find(l => l.mediaAssetId === newAsset.id);
      if (loc) {
        loc.verificationStatus = 'provisional';
        this._saveTable('file_locations', this.fileLocations);
      }
      return { status: 'verification-pending', assetId: newAsset.id };
    } else {
      // 0 candidates -> register as a new provisional asset!
      const newAsset = await this.addVideo({
        title: sf.fileName,
        fileName: sf.fileName,
        fileSize: sf.fileSize,
        duration: 0,
        sourceType: 'directory',
        directoryId,
        relativePath: sf.relativePath,
        lastModified: sf.lastModified,
        quickHash: sf.quickHash || '',
        hashStatus: 'pending',
        identityStatus: 'provisional'
      });
      const loc = this.fileLocations.find(l => l.mediaAssetId === newAsset.id);
      if (loc) {
        loc.verificationStatus = 'provisional';
        this._saveTable('file_locations', this.fileLocations);
      }
      return { status: 'new', assetId: newAsset.id };
    }
  }

  async completeLocationProvisionalVerification(locId, scannedHash) {
    const loc = this.fileLocations.find(l => l.id === locId);
    if (!loc) throw new Error('Location not found');

    const video = this.mediaAssets.find(a => a.id === loc.mediaAssetId);
    if (!video) throw new Error('Video not found');

    // Check if there is already another VERIFIED asset in the database with this hash
    const existingAsset = this.mediaAssets.find(a => a.contentHash === scannedHash && a.id !== video.id && a.identityStatus !== 'provisional' && a.identityStatus !== 'conflict');

    if (video.identityStatus === 'provisional') {
      // Case A: The asset itself was newly registered as provisional
      if (existingAsset) {
        // A verified asset already exists with this hash. Merge video into existingAsset!
        const mergeResult = await this.mergeMediaAssets(existingAsset.id, video.id);
        loc.verificationStatus = 'verified';
        this._saveTable('file_locations', this.fileLocations);
        const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: existingAsset.id, contentHash: scannedHash });
        return { status: 'success', merged: true, targetAssetId: existingAsset.id, resolvedPendingSummary: summary };
      } else {
        // No verified asset has this hash. Make this asset the canonical one!
        video.contentHash = scannedHash;
        video.hashStatus = 'completed';
        video.identityStatus = 'verified';
        video.updatedAt = new Date().toISOString();
        this._saveTable('media_assets', this.mediaAssets);

        loc.verificationStatus = 'verified';
        this._saveTable('file_locations', this.fileLocations);
        const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: video.id, contentHash: scannedHash });
        return { status: 'success', merged: false, assetId: video.id, resolvedPendingSummary: summary };
      }
    } else {
      // Case B: The asset was verified, but this location was provisionally matched to it
      if (video.contentHash === scannedHash) {
        // The provisional match was correct!
        loc.verificationStatus = 'verified';
        this._saveTable('file_locations', this.fileLocations);
        const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: video.id, contentHash: scannedHash });
        return { status: 'success', merged: false, assetId: video.id, resolvedPendingSummary: summary };
      } else {
        // The provisional match was incorrect! (Full hash mismatch)
        // We must undo the match and separate this location into a new asset!

        let targetAsset = existingAsset;
        if (!targetAsset) {
          // Create a new verified asset
          const assetId = 'vid-' + generateUUID();
          targetAsset = {
            id: assetId,
            contentHash: scannedHash,
            hashAlgorithm: 'SHA-256',
            quickHash: video.quickHash,
            hashStatus: 'completed',
            fileSize: loc.fileSize,
            duration: video.duration || 0,
            displayTitle: loc.fileName,
            genreId: video.genreId || 'genre-default',
            thumbnailId: '',
            identityStatus: 'verified',
            identityConflictGroupId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          this.mediaAssets.push(targetAsset);
          this._saveTable('media_assets', this.mediaAssets);
        }

        // Separate loc by pointing it to targetAsset
        loc.mediaAssetId = targetAsset.id;
        loc.verificationStatus = 'verified';
        this._saveTable('file_locations', this.fileLocations);

        // If the original asset has no locations left, archive it again!
        const remainingLocs = this.fileLocations.filter(l => l.mediaAssetId === video.id);
        if (remainingLocs.length === 0) {
          video.isArchived = true;
          video.archivedAt = new Date().toISOString();
          this._saveTable('media_assets', this.mediaAssets);
        }

        const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: targetAsset.id, contentHash: scannedHash });
        return { status: 'separated', newAssetId: targetAsset.id, resolvedPendingSummary: summary };
      }
    }
  }

  async resolveAndRegisterNewScannedFile({
    directoryId,
    directoryHandle,
    sf,
    getFileHandleFromRelativePathFn,
    computeFileSHA256Fn
  }) {
    // 1. Get candidates by quickHash and fileSize
    const candidates = this.mediaAssets.filter(a => a.fileSize === sf.fileSize && a.quickHash === sf.quickHash);

    let scannedHash = null;
    let fileObj = null;
    try {
      const fileHandle = await getFileHandleFromRelativePathFn(directoryHandle, sf.relativePath);
      fileObj = await fileHandle.getFile();
      scannedHash = await computeFileSHA256Fn(fileObj);
    } catch (err) {
      console.warn(`Failed to compute hash for scanned file ${sf.relativePath}:`, err);
      return { status: 'verification-pending', assetId: null };
    }

    // 2. Resolve candidate hashes if they are not computed yet
    for (const candidate of candidates) {
      if (candidate.hashStatus !== 'completed' || !candidate.contentHash) {
        const candLocs = this.fileLocations.filter(l => l.mediaAssetId === candidate.id);
        let resolvedCandidateHash = null;
        for (const cl of candLocs) {
          const ds = this.getDirectorySource(cl.directoryId);
          if (ds && ds.handleKey && ds.permissionStatus === 'granted') {
            try {
              const handle = await this.getDirectoryHandle(ds.handleKey);
              if (handle) {
                const fh = await getFileHandleFromRelativePathFn(handle, cl.relativePath);
                const f = await fh.getFile();
                resolvedCandidateHash = await computeFileSHA256Fn(f);
                break;
              }
            } catch (e) {
              console.warn(`Failed to resolve candidate location ${cl.id} for hashing:`, e);
            }
          }
        }
        if (resolvedCandidateHash) {
          candidate.contentHash = resolvedCandidateHash;
          candidate.hashStatus = 'completed';
          candidate.updatedAt = new Date().toISOString();
          this._saveTable('media_assets', this.mediaAssets);
        }
      }
    }

    // 3. Find if any existing asset has the identical non-empty contentHash (exclude conflict assets)
    const matchedAsset = this.mediaAssets.find(a => a.contentHash === scannedHash && a.identityStatus !== 'conflict');
    if (matchedAsset) {
      if (matchedAsset.isArchived) {
        matchedAsset.isArchived = false;
        matchedAsset.archivedAt = null;
        matchedAsset.updatedAt = new Date().toISOString();
        this._saveTable('media_assets', this.mediaAssets);
      }

      // Check if location already exists for this directory and path (safety check)
      const normPath = normalizePath(sf.relativePath);
      let existingLoc = this.fileLocations.find(l => l.directoryId === directoryId && normalizePath(l.relativePath) === normPath);
      if (!existingLoc) {
        const newLoc = {
          id: 'loc-' + generateUUID(),
          mediaAssetId: matchedAsset.id,
          directoryId: directoryId || '',
          relativePath: normPath,
          fileName: sf.fileName || '',
          fileSize: sf.fileSize || 0,
          lastModified: sf.lastModified || 0,
          availabilityStatus: 'available',
          lastVerifiedAt: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.fileLocations.push(newLoc);
        this._saveTable('file_locations', this.fileLocations);
      } else {
        if (existingLoc.availabilityStatus !== 'available') {
          existingLoc.availabilityStatus = 'available';
          existingLoc.updatedAt = new Date().toISOString();
          this._saveTable('file_locations', this.fileLocations);
        }
      }
      const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: matchedAsset.id, contentHash: scannedHash });
      return { status: 'merged', assetId: matchedAsset.id, resolvedPendingSummary: summary };
    } else {
      // Create new mediaAsset with completed hash
      const newAsset = await this.addVideo({
        title: sf.fileName,
        fileName: sf.fileName,
        fileSize: sf.fileSize,
        duration: 0,
        sourceType: 'directory',
        directoryId,
        relativePath: sf.relativePath,
        lastModified: sf.lastModified,
        quickHash: sf.quickHash || '',
        contentHash: scannedHash,
        hashStatus: 'completed'
      });
      return { status: 'new', assetId: newAsset.id, resolvedPendingSummary: newAsset.resolvedPendingSummary };
    }
  }

  async addVideo({ title, displayTitle, fileName, fileSize, duration, thumbnailBlob, sourceType, directoryId, relativePath, lastModified, contentHash, quickHash, hashStatus, identityStatus }) {
    if (sourceType === 'url') {
      throw new Error('URL動画はサポートされていません。');
    }
    const normalizedTitle = normalizeDisplayTitle(displayTitle !== undefined ? displayTitle : title);
    const normPath = normalizePath(relativePath);

    let existingAsset = null;
    let existingLoc = null;

    // 1. Check physical location match (directoryId + relativePath)
    existingLoc = this.fileLocations.find(l => l.directoryId === directoryId && normalizePath(l.relativePath) === normPath);
    if (existingLoc) {
      existingAsset = this.mediaAssets.find(a => a.id === existingLoc.mediaAssetId);
      if (existingAsset) {
        let assetChanged = false;
        if (contentHash && existingAsset.contentHash !== contentHash) {
          existingAsset.contentHash = contentHash;
          existingAsset.hashStatus = hashStatus || 'completed';
          assetChanged = true;
        }
        if (quickHash && !existingAsset.quickHash) {
          existingAsset.quickHash = quickHash;
          assetChanged = true;
        }
        if (normalizedTitle !== undefined && normalizedTitle !== null && existingAsset.displayTitle !== normalizedTitle) {
          existingAsset.displayTitle = normalizedTitle;
          assetChanged = true;
        }
        if (assetChanged) {
          existingAsset.updatedAt = new Date().toISOString();
          this._saveTable('media_assets', this.mediaAssets);
        }
        if (existingLoc.availabilityStatus !== 'available' || (fileSize && existingLoc.fileSize !== fileSize)) {
          const isSizeChanged = fileSize && existingLoc.fileSize !== fileSize;
          existingLoc.availabilityStatus = 'available';
          if (fileSize) existingLoc.fileSize = fileSize;
          if (lastModified) existingLoc.lastModified = lastModified;
          existingLoc.lastVerifiedAt = new Date().toISOString();
          if (isSizeChanged) {
            existingLoc.verificationStatus = 'provisional';
          }
          existingLoc.updatedAt = new Date().toISOString();
          this._saveTable('file_locations', this.fileLocations);
        }
        const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: existingAsset.id, contentHash: existingAsset.contentHash });
        const virtualVideo = this._buildVirtualVideo(existingAsset);
        virtualVideo.resolvedPendingSummary = summary;
        return virtualVideo;
      }
    }

    // 2. Check if another asset already exists with identical non-empty contentHash (exclude conflict assets)
    if (contentHash) {
      existingAsset = this.mediaAssets.find(a => a.contentHash === contentHash && a.identityStatus !== 'conflict');
    }

    // 3. If matching media asset exists by contentHash, attach new location to it
    if (existingAsset) {
      if (!existingLoc) {
        const newLoc = {
          id: 'loc-' + generateUUID(),
          mediaAssetId: existingAsset.id,
          directoryId: directoryId || '',
          relativePath: normPath,
          fileName: fileName || '',
          fileSize: fileSize || existingAsset.fileSize || 0,
          lastModified: lastModified || 0,
          availabilityStatus: 'available',
          lastVerifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.fileLocations.push(newLoc);
        this._saveTable('file_locations', this.fileLocations);
      }
      const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: existingAsset.id, contentHash: existingAsset.contentHash });
      const virtualVideo = this._buildVirtualVideo(existingAsset);
      virtualVideo.resolvedPendingSummary = summary;
      return virtualVideo;
    }

    // 4. Create new media asset and location
    const assetId = 'vid-' + generateUUID();
    const locId = 'loc-' + generateUUID();

    const asset = {
      id: assetId,
      contentHash: contentHash || '',
      hashAlgorithm: 'SHA-256',
      quickHash: quickHash || '',
      hashStatus: hashStatus || (contentHash ? 'completed' : 'pending'),
      fileSize: fileSize || 0,
      duration: duration || 0,
      displayTitle: normalizedTitle,
      genreId: 'genre-default',
      thumbnailId: '',
      identityStatus: identityStatus || 'normal',
      identityConflictGroupId: null,
      isArchived: false,
      archivedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const loc = {
      id: locId,
      mediaAssetId: assetId,
      directoryId: directoryId || '',
      relativePath: normPath,
      fileName: fileName || '',
      fileSize: fileSize || 0,
      lastModified: lastModified || 0,
      availabilityStatus: 'available',
      lastVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (thumbnailBlob && this.idbAvailable) {
      try {
        const imgId = `img-vid-${assetId}`;
        await this.putImage(imgId, thumbnailBlob);
        asset.thumbnailId = imgId;
      } catch (err) {
        console.error('Failed to save new video thumbnail to IndexedDB:', err);
      }
    }

    this.mediaAssets.push(asset);
    this.fileLocations.push(loc);

    this._saveTable('media_assets', this.mediaAssets);
    this._saveTable('file_locations', this.fileLocations);

    let summary = { resolved: 0, duplicate: 0, failed: 0 };
    if (asset.hashStatus === 'completed') {
      summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: asset.id, contentHash: asset.contentHash });
    }

    const virtualVideo = this._buildVirtualVideo(asset);
    virtualVideo.resolvedPendingSummary = summary;
    return virtualVideo;
  }

  async addFileLocation(mediaAssetId, { directoryId, relativePath, fileName, fileSize, lastModified, availabilityStatus }) {
    const normPath = normalizePath(relativePath);
    let loc = this.fileLocations.find(l => l.directoryId === directoryId && normalizePath(l.relativePath) === normPath);
    if (loc) {
      loc.mediaAssetId = mediaAssetId;
      loc.fileSize = fileSize;
      loc.lastModified = lastModified;
      loc.availabilityStatus = availabilityStatus || 'available';
      loc.lastVerifiedAt = new Date().toISOString();
      loc.updatedAt = new Date().toISOString();
    } else {
      loc = {
        id: 'loc-' + generateUUID(),
        mediaAssetId,
        directoryId,
        relativePath: normPath,
        fileName,
        fileSize,
        lastModified,
        availabilityStatus: availabilityStatus || 'available',
        lastVerifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.fileLocations.push(loc);
    }
    this._saveTable('file_locations', this.fileLocations);
    return loc;
  }

  hasMeaningfulReviewData(assetId) {
    const review = this.reviews.find(r => r.mediaAssetId === assetId);
    const ratings = review ? this.getCriterionRatingsForReview(review.id) : [];
    const notes = this.timelineNotes.filter(n => n.mediaAssetId === assetId);

    const hasOverall = !!(review && review.overallGrade && review.overallGrade.trim() !== '');
    const hasComment = !!(review && review.comment && review.comment.trim() !== '');
    const hasRatings = ratings.length > 0;
    const hasNotes = notes.length > 0;

    return hasOverall || hasComment || hasRatings || hasNotes;
  }

  async mergeMediaAssets(targetAssetId, sourceAssetId, { force = false } = {}) {
    if (targetAssetId === sourceAssetId) return { merged: true, targetAssetId };

    const targetAsset = this.mediaAssets.find(a => a.id === targetAssetId);
    const sourceAsset = this.mediaAssets.find(a => a.id === sourceAssetId);
    if (!targetAsset || !sourceAsset) {
      throw new Error('Merge error: target or source media asset not found.');
    }

    const hasTargetEval = this.hasMeaningfulReviewData(targetAssetId);
    const hasSourceEval = this.hasMeaningfulReviewData(sourceAssetId);

    let canonicalTargetId = targetAssetId;
    let canonicalSourceId = sourceAssetId;

    if (!hasTargetEval && hasSourceEval) {
      canonicalTargetId = sourceAssetId;
      canonicalSourceId = targetAssetId;
    } else if (hasTargetEval && hasSourceEval && !force) {
      return {
        merged: false,
        conflict: true,
        reason: "both-assets-have-review-data",
        targetAssetId,
        sourceAssetId
      };
    }

    const snapAssets = JSON.parse(JSON.stringify(this.mediaAssets));
    const snapLocations = JSON.parse(JSON.stringify(this.fileLocations));
    const snapReviews = JSON.parse(JSON.stringify(this.reviews));
    const snapRatings = JSON.parse(JSON.stringify(this.criterionRatings));
    const snapReviewTags = JSON.parse(JSON.stringify(this.reviewTags));
    const snapNotes = JSON.parse(JSON.stringify(this.timelineNotes));

    const keys = ['media_assets', 'file_locations', 'video_reviews', 'criterion_ratings', 'review_tags', 'timeline_notes'];
    const storageSnap = {};
    if (this.storage) {
      keys.forEach(k => {
        storageSnap[k] = this.storage.getItem(`${this.prefix}${k}`);
      });
    }

    try {
      const target = this.mediaAssets.find(a => a.id === canonicalTargetId);
      const source = this.mediaAssets.find(a => a.id === canonicalSourceId);

      this.fileLocations.forEach(loc => {
        if (loc.mediaAssetId === canonicalSourceId) {
          loc.mediaAssetId = canonicalTargetId;
          loc.updatedAt = new Date().toISOString();
        }
      });

      // Merge reviews, timeline notes, and review tags per reviewer
      const sourceReviews = this.reviews.filter(r => r.mediaAssetId === canonicalSourceId);
      sourceReviews.forEach(srcReview => {
        const reviewerId = srcReview.reviewerId;
        const targetReview = this.reviews.find(r => r.mediaAssetId === canonicalTargetId && r.reviewerId === reviewerId);
        if (!targetReview) {
          // Move review to target asset
          srcReview.mediaAssetId = canonicalTargetId;
          srcReview.updatedAt = new Date().toISOString();

          // Move timeline notes referencing this review to target asset
          this.timelineNotes.forEach(note => {
            if (note.videoReviewId === srcReview.id) {
              note.mediaAssetId = canonicalTargetId;
              note.updatedAt = new Date().toISOString();
            }
          });
        } else {
          // Merge review tags from source review to target review
          const targetTagIds = new Set(this.reviewTags.filter(rt => rt.videoReviewId === targetReview.id).map(rt => rt.tagId));
          const srcReviewTags = this.reviewTags.filter(rt => rt.videoReviewId === srcReview.id);
          srcReviewTags.forEach(rt => {
            if (!targetTagIds.has(rt.tagId)) {
              rt.videoReviewId = targetReview.id;
            } else {
              this.reviewTags = this.reviewTags.filter(x => x.id !== rt.id);
            }
          });

          // Move timeline notes referencing source review to target review
          this.timelineNotes.forEach(note => {
            if (note.videoReviewId === srcReview.id) {
              note.videoReviewId = targetReview.id;
              note.mediaAssetId = canonicalTargetId;
              note.updatedAt = new Date().toISOString();
            }
          });

          // Delete duplicate source review and its ratings
          this.reviews = this.reviews.filter(r => r.id !== srcReview.id);
          this.criterionRatings = this.criterionRatings.filter(cr => cr.videoReviewId !== srcReview.id);
        }
      });

      if (!target.thumbnailId && source.thumbnailId) {
        target.thumbnailId = source.thumbnailId;
      }

      this.mediaAssets = this.mediaAssets.filter(a => a.id !== canonicalSourceId);

      this._saveTable('media_assets', this.mediaAssets);
      this._saveTable('file_locations', this.fileLocations);
      this._saveTable('video_reviews', this.reviews);
      this._saveTable('criterion_ratings', this.criterionRatings);
      this._saveTable('review_tags', this.reviewTags);
      this._saveTable('timeline_notes', this.timelineNotes);

      return { merged: true, targetAssetId: canonicalTargetId, sourceAssetId: canonicalSourceId };
    } catch (err) {
      this.mediaAssets = snapAssets;
      this.fileLocations = snapLocations;
      this.reviews = snapReviews;
      this.criterionRatings = snapRatings;
      this.reviewTags = snapReviewTags;
      this.timelineNotes = snapNotes;

      if (this.storage) {
        keys.forEach(k => {
          const val = storageSnap[k];
          if (val === null) {
            this.storage.removeItem(`${this.prefix}${k}`);
          } else {
            this.storage.setItem(`${this.prefix}${k}`, val);
          }
        });
      }
      throw err;
    }
  }

  async completeVideoHashing(videoId, contentHash) {
    const video = this.getVideo(videoId);
    if (!video) throw new Error('Video not found: ' + videoId);

    if (video.contentHash === contentHash && video.hashStatus === 'completed') {
      return { merged: false, conflict: false };
    }

    const snapAssets = JSON.parse(JSON.stringify(this.mediaAssets));
    const storageSnap = this.storage ? this.storage.getItem(`${this.prefix}media_assets`) : null;

    try {
      const existingAsset = this.mediaAssets.find(a => a.contentHash === contentHash && a.id !== video.id);

      if (existingAsset) {
        const mergeResult = await this.mergeMediaAssets(existingAsset.id, video.id);
        if (mergeResult.merged) {
          const summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: existingAsset.id, contentHash: contentHash });
          return { merged: true, conflict: false, targetAssetId: mergeResult.targetAssetId, sourceAssetId: mergeResult.sourceAssetId, resolvedPendingSummary: summary };
        } else if (mergeResult.conflict) {
          const conflictGroupId = existingAsset.identityConflictGroupId || ('conflict-' + generateUUID());

          existingAsset.identityStatus = 'conflict';
          existingAsset.identityConflictGroupId = conflictGroupId;
          existingAsset.updatedAt = new Date().toISOString();

          const currentAsset = this.mediaAssets.find(a => a.id === video.id);
          if (currentAsset) {
            currentAsset.contentHash = contentHash;
            currentAsset.hashStatus = 'completed';
            currentAsset.identityStatus = 'conflict';
            currentAsset.identityConflictGroupId = conflictGroupId;
            currentAsset.updatedAt = new Date().toISOString();
          }

          this._saveTable('media_assets', this.mediaAssets);
          return { merged: false, conflict: true, conflictGroupId, targetAssetId: existingAsset.id, sourceAssetId: video.id, reason: mergeResult.reason };
        }
      }

      const currentAsset = this.mediaAssets.find(a => a.id === video.id);
      let summary = { resolved: 0, duplicate: 0, failed: 0 };
      if (currentAsset) {
        currentAsset.contentHash = contentHash;
        currentAsset.hashStatus = 'completed';
        currentAsset.identityStatus = 'normal';
        currentAsset.identityConflictGroupId = null;
        currentAsset.updatedAt = new Date().toISOString();
        this._saveTable('media_assets', this.mediaAssets);
        summary = resolvePendingSharedReviewsForVideo({ db: this, mediaAssetId: currentAsset.id, contentHash: currentAsset.contentHash });
      }
      return { merged: false, conflict: false, resolvedPendingSummary: summary };
    } catch (err) {
      this.mediaAssets = snapAssets;
      if (this.storage) {
        if (storageSnap === null) {
          this.storage.removeItem(`${this.prefix}media_assets`);
        } else {
          this.storage.setItem(`${this.prefix}media_assets`, storageSnap);
        }
      }
      throw err;
    }
  }

  async performVerifiedVideoHashing(videoId, resolveFileObjFn, computeHashFn) {
    const video = this.getVideo(videoId);
    if (!video) {
      throw new Error('Video not found: ' + videoId);
    }

    const locations = this.fileLocations.filter(loc => loc.mediaAssetId === video.id);
    if (locations.length === 0) {
      await this.updateVideo(video.id, { hashStatus: 'failed' });
      return { status: 'failed', reason: 'no-locations' };
    }

    const sortedLocations = [...locations].sort((a, b) => {
      if (a.availabilityStatus === 'available' && b.availabilityStatus !== 'available') return -1;
      if (a.availabilityStatus !== 'available' && b.availabilityStatus === 'available') return 1;
      return 0;
    });

    let file = null;
    let successfulLoc = null;

    for (const loc of sortedLocations) {
      try {
        const fileObj = await resolveFileObjFn(loc);
        if (!fileObj) continue;

        if (fileObj.size !== loc.fileSize || fileObj.lastModified !== loc.lastModified) {
          console.warn(`File properties changed before hashing. Expected size: ${loc.fileSize}, got: ${fileObj.size}. Expected modified: ${loc.lastModified}, got: ${fileObj.lastModified}`);
          continue;
        }

        file = fileObj;
        successfulLoc = loc;
        break;
      } catch (err) {
        console.warn(`Failed to resolve location ${loc.id}:`, err);
      }
    }

    if (!file || !successfulLoc) {
      await this.updateVideo(video.id, { hashStatus: 'failed' });
      return { status: 'failed', reason: 'all-locations-failed' };
    }

    await this.updateVideo(video.id, { hashStatus: 'calculating' });

    let hash;
    try {
      hash = await computeHashFn(file);
    } catch (err) {
      console.error(`Hashing failed during calculation for video ${video.id}:`, err);
      await this.updateVideo(video.id, { hashStatus: 'failed' });
      return { status: 'failed', reason: 'hash-error', error: err };
    }

    try {
      const freshFile = await resolveFileObjFn(successfulLoc);
      if (!freshFile || freshFile.size !== file.size || freshFile.lastModified !== file.lastModified) {
        console.warn(`File properties changed during hashing! Discarding result.`);
        await this.updateVideo(video.id, { hashStatus: 'pending' });
        return { status: 'discarded', reason: 'metadata-changed' };
      }
    } catch (err) {
      console.warn(`Failed to verify file properties after hashing:`, err);
      await this.updateVideo(video.id, { hashStatus: 'pending' });
      return { status: 'discarded', reason: 'post-verify-failed', error: err };
    }

    const result = await this.completeVideoHashing(video.id, hash);
    return { status: 'success', hash, ...result };
  }

  async updateLocationLastVerified(locId) {
    const loc = this.fileLocations.find(l => l.id === locId);
    if (loc) {
      loc.lastVerifiedAt = new Date().toISOString();
      this._saveTable('file_locations', this.fileLocations);
    }
  }

  async updateLocationInfo(locId, updates) {
    const loc = this.fileLocations.find(l => l.id === locId);
    if (loc) {
      Object.assign(loc, updates);
      loc.updatedAt = new Date().toISOString();
      this._saveTable('file_locations', this.fileLocations);
    }
  }

  async updateVideo(id, updates) {
    const asset = this.mediaAssets.find(a => a.id === id);
    if (asset) {
      const assetKeys = ['contentHash', 'hashAlgorithm', 'quickHash', 'hashStatus', 'fileSize', 'duration', 'displayTitle', 'genreId', 'thumbnailId'];
      const locKeys = ['directoryId', 'relativePath', 'fileName', 'fileSize', 'lastModified', 'availabilityStatus'];

      const assetUpdates = {};
      const locUpdates = {};

      for (const [k, v] of Object.entries(updates)) {
        if (k === 'title' || k === 'displayTitle') {
          assetUpdates.displayTitle = normalizeDisplayTitle(v);
        } else if (assetKeys.includes(k)) {
          assetUpdates[k] = v;
        }

        if (locKeys.includes(k)) {
          locUpdates[k] = v;
        }
      }

      Object.assign(asset, assetUpdates);
      asset.updatedAt = new Date().toISOString();
      this._saveTable('media_assets', this.mediaAssets);

      if (Object.keys(locUpdates).length > 0) {
        let loc = this.fileLocations.find(l => l.mediaAssetId === id &&
                    (updates.directoryId === undefined || l.directoryId === updates.directoryId) &&
                    (updates.relativePath === undefined || l.relativePath === updates.relativePath));

        if (!loc) {
          loc = this.fileLocations.find(l => l.mediaAssetId === id);
        }

        if (loc) {
          Object.assign(loc, locUpdates);
          loc.lastVerifiedAt = new Date().toISOString();
          loc.updatedAt = new Date().toISOString();
          this._saveTable('file_locations', this.fileLocations);
        }
      }

      return this._buildVirtualVideo(asset);
    }
    return null;
  }

  async updateVideoThumbnail(videoId, thumbnailBlob) {
    const asset = this.mediaAssets.find(a => a.id === videoId);
    if (!asset) throw new Error('Video not found');

    if (thumbnailBlob && this.idbAvailable) {
      const imgId = `img-vid-${videoId}`;
      await this.putImage(imgId, thumbnailBlob);
      await this.updateVideo(videoId, { thumbnailId: imgId });
    }
  }

  async deleteVideoThumbnail(videoId) {
    const asset = this.mediaAssets.find(a => a.id === videoId);
    if (!asset) return;
    if (asset.thumbnailId && this.idbAvailable) {
      try {
        await this.idb.delete(asset.thumbnailId, 'images');
      } catch (err) {
        console.error('Failed to delete video thumbnail Blob:', err);
      }
    }
  }

  async deleteVideoCascade(mediaAssetId) {
    const asset = this.mediaAssets.find(a => a.id === mediaAssetId);
    if (!asset) return false;

    const reviewsToDelete = this.reviews.filter(r => r.mediaAssetId === mediaAssetId);
    const reviewIds = reviewsToDelete.map(r => r.id);

    if (this.idbAvailable) {
      if (asset.thumbnailId) {
        try {
          await this.idb.delete(asset.thumbnailId, 'images');
        } catch (err) {
          console.warn('Failed to delete video thumbnail image:', err);
        }
      }

      const matchedNotes = this.timelineNotes.filter(n => n.mediaAssetId === mediaAssetId || reviewIds.includes(n.videoReviewId));
      for (const note of matchedNotes) {
        if (note.thumbnailId) {
          try {
            await this.idb.delete(note.thumbnailId, 'images');
          } catch (err) {
            console.warn('Failed to delete note screenshot image:', err);
          }
        }
      }
    }

    this.mediaAssets = this.mediaAssets.filter(a => a.id !== mediaAssetId);
    this._saveTable('media_assets', this.mediaAssets);

    this.fileLocations = this.fileLocations.filter(l => l.mediaAssetId !== mediaAssetId);
    this._saveTable('file_locations', this.fileLocations);

    this.reviews = this.reviews.filter(r => r.mediaAssetId !== mediaAssetId);
    this._saveTable('video_reviews', this.reviews);

    this.criterionRatings = this.criterionRatings.filter(cr => !reviewIds.includes(cr.videoReviewId));
    this._saveTable('criterion_ratings', this.criterionRatings);

    this.reviewTags = this.reviewTags.filter(rt => !reviewIds.includes(rt.videoReviewId));
    this._saveTable('review_tags', this.reviewTags);

    this.timelineNotes = this.timelineNotes.filter(n => n.mediaAssetId !== mediaAssetId && !reviewIds.includes(n.videoReviewId));
    this._saveTable('timeline_notes', this.timelineNotes);

    return true;
  }

  async archiveVideo(mediaAssetId) {
    const asset = this.mediaAssets.find(a => a.id === mediaAssetId);
    if (!asset) return false;

    asset.isArchived = true;
    asset.archivedAt = new Date().toISOString();
    this._saveTable('media_assets', this.mediaAssets);

    // Remove active locations associated with this archived asset
    this.fileLocations = this.fileLocations.filter(l => l.mediaAssetId !== mediaAssetId);
    this._saveTable('file_locations', this.fileLocations);

    return true;
  }

  async deleteFileLocation(locId) {
    this.fileLocations = this.fileLocations.filter(l => l.id !== locId);
    this._saveTable('file_locations', this.fileLocations);
    return true;
  }

  // --- CRITERIA OPERATIONS ---

  getCriteria() {
    return this.criteria.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  getActiveCriteria() {
    return this.getCriteria().filter(c => c.isActive);
  }

  async addCriterion(name, description = '') {
    const active = this.getActiveCriteria();
    if (active.length >= 6) {
      throw new Error('Maximum of 6 active criteria allowed.');
    }

    const maxOrder = this.criteria.reduce((max, c) => Math.max(max, c.displayOrder), 0);
    const crit = {
      id: 'crit-' + generateUUID(),
      name,
      description: description || '',
      displayOrder: maxOrder + 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.criteria.push(crit);
    this._saveTable('rating_criteria', this.criteria);
    return crit;
  }

  async updateCriterion(id, updates) {
    const idx = this.criteria.findIndex(c => c.id === id);
    if (idx !== -1) {
      if (updates.description !== undefined) {
        updates.description = updates.description || '';
      }
      this.criteria[idx] = {
        ...this.criteria[idx],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this._saveTable('rating_criteria', this.criteria);
      return this.criteria[idx];
    }
    return null;
  }

  async reorderCriteria(orderedIds) {
    this.criteria.forEach(c => {
      const idx = orderedIds.indexOf(c.id);
      if (idx !== -1) {
        c.displayOrder = idx + 1;
        c.updatedAt = new Date().toISOString();
      }
    });
    this._saveTable('rating_criteria', this.criteria);
  }

  async deleteCriterion(id) {
    const crit = this.criteria.find(c => c.id === id);
    if (crit) {
      crit.isActive = false;
      crit.updatedAt = new Date().toISOString();
      this._saveTable('rating_criteria', this.criteria);
      return true;
    }
    return false;
  }

  // --- REVIEW & RATING OPERATIONS ---

  _ensureLocalReviewerDuringInitialization() {
    if (!this.reviewers) {
      this.reviewers = [];
    }
    let local = this.reviewers.find(r => r.isLocal);
    if (!local) {
      const reviewerName = (this.storage && (this.storage.getItem(`${this.prefix}reviewer_name`) || this.storage.getItem('vreview_reviewer_name') || this.storage.getItem('reviewerName'))) || '自分';
      local = {
        id: 'reviewer-' + generateUUID(),
        displayName: reviewerName,
        isLocal: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.reviewers.push(local);
      this._saveTable('reviewers', this.reviewers);
    }
    return local;
  }

  getLocalReviewer() {
    return this.reviewers.find(r => r.isLocal) || null;
  }

  getReviewers() {
    return this.reviewers;
  }

  getReviewerById(reviewerId) {
    return this.reviewers.find(r => r.id === reviewerId) || null;
  }

  getReviewsForVideo(mediaAssetId) {
    return this.reviews.filter(r => r.mediaAssetId === mediaAssetId);
  }

  getOwnerReviewForVideo(mediaAssetId) {
    const localRev = this.getLocalReviewer();
    if (!localRev) return null;
    return this.reviews.find(r => r.mediaAssetId === mediaAssetId && r.reviewerId === localRev.id) || null;
  }

  getTimelineNotesForReview(videoReviewId) {
    return this.timelineNotes
      .filter(n => n.videoReviewId === videoReviewId)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }

  getTagsForReview(videoReviewId) {
    const associationIds = this.reviewTags
      .filter(rt => rt.videoReviewId === videoReviewId)
      .map(rt => rt.tagId);
    return this.tags.filter(t => associationIds.includes(t.id));
  }

  getReviewForVideo(mediaAssetId) {
    const review = this.getOwnerReviewForVideo(mediaAssetId);
    if (!review) return undefined;
    return {
      ...review,
      overallGrade: overallScoreToGrade(review.overallScore)
    };
  }

  getCriterionRatingsForReview(reviewId) {
    return this.criterionRatings.filter(cr => cr.videoReviewId === reviewId);
  }

  async saveReview(mediaAssetId, { overallGrade, comment, ratings }) {
    const localReviewer = this.getLocalReviewer();
    if (!localReviewer) {
      throw new Error('Local owner reviewer is not initialized.');
    }

    let review = this.getOwnerReviewForVideo(mediaAssetId);
    const now = new Date().toISOString();
    const score = overallGradeToScore(overallGrade);

    let finalComment = '';
    if (comment === null) {
      finalComment = null;
    } else if (comment !== undefined) {
      finalComment = String(comment);
    } else {
      finalComment = review ? review.comment : '';
    }

    if (!review) {
      review = {
        id: 'rev-' + generateUUID(),
        mediaAssetId,
        reviewerId: localReviewer.id,
        origin: 'local',
        overallScore: score,
        comment: finalComment,
        createdAt: now,
        updatedAt: now
      };
      this.reviews.push(review);
    } else {
      review.overallScore = score;
      review.comment = finalComment;
      review.updatedAt = now;
    }

    this._saveTable('video_reviews', this.reviews);

    this.criterionRatings = this.criterionRatings.filter(cr => cr.videoReviewId !== review.id);

    const video = this.getVideo(mediaAssetId);
    const genreId = video ? (video.genreId || 'genre-default') : 'genre-default';
    const genre = this.genres.find(g => g.id === genreId);
    const genreName = genre ? genre.name : '一般';

    if (ratings && typeof ratings === 'object') {
      for (const [criterionId, scoreVal] of Object.entries(ratings)) {
        if (scoreVal !== null && scoreVal !== undefined) {
          const criterion = this.criteria.find(c => c.id === criterionId);
          const criterionName = criterion ? criterion.name : '';

          this.criterionRatings.push({
            id: 'rate-' + generateUUID(),
            videoReviewId: review.id,
            criterionId,
            criterionName,
            genreId,
            genreName,
            score: parseInt(scoreVal, 10),
            createdAt: now,
            updatedAt: now
          });
        }
      }
    }

    this._saveTable('criterion_ratings', this.criterionRatings);
    await this.updateVideo(mediaAssetId, {});

    return {
      ...review,
      overallGrade: overallScoreToGrade(review.overallScore)
    };
  }

  get videoTags() {
    if (!this.reviewTags) return [];
    const localReviewer = this.reviewers ? this.reviewers.find(r => r.isLocal) : null;
    if (!localReviewer) return [];

    const ownerReviewIds = new Set(this.reviews.filter(r => r.reviewerId === localReviewer.id).map(r => r.id));
    return this.reviewTags
      .filter(rt => rt && ownerReviewIds.has(rt.videoReviewId))
      .map(rt => {
        const review = this.reviews.find(r => r.id === rt.videoReviewId);
        return {
          mediaAssetId: review ? review.mediaAssetId : null,
          tagId: rt.tagId
        };
      }).filter(vt => vt && vt.mediaAssetId !== null);
  }

  // --- TAG OPERATIONS ---

  getTags() {
    return this.tags;
  }

  getVideoTags(mediaAssetId) {
    const review = this.getOwnerReviewForVideo(mediaAssetId);
    if (!review) return [];

    const associationIds = this.reviewTags
      .filter(rt => rt.videoReviewId === review.id)
      .map(rt => rt.tagId);
    return this.tags.filter(t => associationIds.includes(t.id));
  }

  async addTagToVideo(mediaAssetId, tagName) {
    const cleanedName = tagName.trim();
    if (!cleanedName) return null;

    const normalized = cleanedName.toLowerCase();

    let tag = this.tags.find(t => t.normalizedName === normalized);
    if (!tag) {
      tag = {
        id: 'tag-' + generateUUID(),
        name: cleanedName,
        normalizedName: normalized
      };
      this.tags.push(tag);
      this._saveTable('tags', this.tags);
    }

    let review = this.getOwnerReviewForVideo(mediaAssetId);
    if (!review) {
      review = await this.saveReview(mediaAssetId, { overallGrade: null, comment: '', ratings: {} });
    }

    const alreadyAssociated = this.reviewTags.some(rt => rt.videoReviewId === review.id && rt.tagId === tag.id);
    if (!alreadyAssociated) {
      this.reviewTags.push({
        id: 'review-tag-' + generateUUID(),
        videoReviewId: review.id,
        tagId: tag.id,
        createdAt: new Date().toISOString()
      });
      this._saveTable('review_tags', this.reviewTags);
      await this.updateVideo(mediaAssetId, {});
    }

    return tag;
  }

  async removeTagFromVideo(mediaAssetId, tagId) {
    const review = this.getOwnerReviewForVideo(mediaAssetId);
    if (!review) return false;

    const initialLength = this.reviewTags.length;
    this.reviewTags = this.reviewTags.filter(rt => !(rt.videoReviewId === review.id && rt.tagId === tagId));
    if (this.reviewTags.length !== initialLength) {
      this._saveTable('review_tags', this.reviewTags);
      await this.updateVideo(mediaAssetId, {});
      return true;
    }
    return false;
  }

  // --- TIMELINE NOTES OPERATIONS ---

  getTimelineNotes(mediaAssetId) {
    const review = this.getOwnerReviewForVideo(mediaAssetId);
    if (!review) return [];

    return this.timelineNotes
      .filter(n => n.videoReviewId === review.id)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }

  async addTimelineNote(mediaAssetId, { timestampSeconds, timestampLabel, comment, thumbnailBlob }) {
    let review = this.getOwnerReviewForVideo(mediaAssetId);
    const now = new Date().toISOString();

    if (!review) {
      review = await this.saveReview(mediaAssetId, { overallGrade: null, comment: '', ratings: {} });
    }

    const noteId = 'note-' + generateUUID();
    const note = {
      id: noteId,
      videoReviewId: review.id,
      mediaAssetId,
      timestampSeconds: parseFloat(timestampSeconds),
      timestampLabel: timestampLabel || '00:00',
      comment: comment || '',
      thumbnailUrl: '',
      thumbnailId: '',
      createdAt: now,
      updatedAt: now
    };

    if (thumbnailBlob && this.idbAvailable) {
      const imgId = `img-note-${noteId}`;
      await this.putImage(imgId, thumbnailBlob);
      note.thumbnailId = imgId;
    }

    this.timelineNotes.push(note);
    this._saveTable('timeline_notes', this.timelineNotes);
    await this.updateVideo(mediaAssetId, {});
    return note;
  }

  async updateTimelineNote(noteId, updates) {
    const idx = this.timelineNotes.findIndex(n => n.id === noteId);
    if (idx !== -1) {
      this.timelineNotes[idx] = {
        ...this.timelineNotes[idx],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this._saveTable('timeline_notes', this.timelineNotes);

      const review = this.reviews.find(r => r.id === this.timelineNotes[idx].videoReviewId);
      if (review) {
        await this.updateVideo(review.mediaAssetId, {});
      }
      return this.timelineNotes[idx];
    }
    return null;
  }

  async deleteTimelineNote(noteId) {
    const note = this.timelineNotes.find(n => n.id === noteId);
    if (!note) return false;

    this.timelineNotes = this.timelineNotes.filter(n => n.id !== noteId);
    this._saveTable('timeline_notes', this.timelineNotes);

    if (note.thumbnailId && this.idbAvailable) {
      try {
        await this.idb.delete(note.thumbnailId);
      } catch (err) {
        console.error('Failed to delete timeline note screenshot from IndexedDB:', err);
      }
    }

    const review = this.reviews.find(r => r.id === note.videoReviewId);
    if (review) {
      await this.updateVideo(review.mediaAssetId, {});
    }
    return true;
  }

  // --- IMAGE BULK EXPORT OPERATION ---

  async getAllImages() {
    if (!this.idbAvailable) return [];
    return await this.idb.getAll('images');
  }

  // --- DIRECTORY HANDLE BULK EXPORT OPERATION ---

  async getAllDirectoryHandles() {
    if (!this.idbAvailable) return [];
    return await this.idb.getAll('handles');
  }

  // --- SHARED REVIEW OPERATIONS ---

  getImportedReviewers() {
    return this.reviewers.filter(r => !r.isLocal);
  }

  getPendingSharedReviews() {
    return this.pendingSharedReviews;
  }

  addPendingSharedReview(pendingRecord) {
    const exists = this.pendingSharedReviews.some(p =>
      p.videoHash === pendingRecord.videoHash &&
      p.payload.reviewId === pendingRecord.payload.reviewId &&
      p.payload.reviewerId === pendingRecord.payload.reviewerId
    );
    if (exists) return;

    this.pendingSharedReviews.push(pendingRecord);
    this._saveTable('pending_shared_reviews', this.pendingSharedReviews);
  }

  removePendingSharedReview(id) {
    const initialLength = this.pendingSharedReviews.length;
    this.pendingSharedReviews = this.pendingSharedReviews.filter(p => p.id !== id);
    if (this.pendingSharedReviews.length !== initialLength) {
      this._saveTable('pending_shared_reviews', this.pendingSharedReviews);
      return true;
    }
    return false;
  }

  findVideoByContentHash(contentHash) {
    if (!contentHash) return null;
    const lowerHash = contentHash.toLowerCase();
    return this.mediaAssets.find(v => v.contentHash && v.contentHash.toLowerCase() === lowerHash) || null;
  }

  hasPendingSharedReview(videoHash, reviewId, reviewerId) {
    if (!videoHash) return false;
    const lowerHash = videoHash.toLowerCase();
    return this.pendingSharedReviews.some(p =>
      p.videoHash === lowerHash &&
      p.payload.reviewId === reviewId &&
      p.payload.reviewerId === reviewerId
    );
  }

  getOrCreateTag(tagName) {
    if (!tagName) return null;
    const normalized = normalizeTag(tagName);
    let dbTag = this.tags.find(t => normalizeTag(t.name) === normalized);
    if (!dbTag) {
      const newTagId = 'tag-' + generateUUIDv4();
      dbTag = {
        id: newTagId,
        name: tagName
      };
      this.tags.push(dbTag);
      this._saveTable('tags', this.tags);
    }
    return dbTag;
  }

  findReviewerBySourceId(sourceReviewerId) {
    return this.reviewers.find(r => r.sourceReviewerId === sourceReviewerId) || null;
  }

  findReviewBySourceId(sourceReviewId, sourceReviewerId) {
    return this.reviews.find(r => r.sourceReviewId === sourceReviewId && r.sourceReviewerId === sourceReviewerId) || null;
  }

  addImportedReviewer({ displayName, sourceReviewerId }) {
    const now = new Date().toISOString();
    const reviewer = {
      id: 'reviewer-' + generateUUIDv4(), // Always generate local UUIDv4
      displayName,
      isLocal: false,
      sourceReviewerId,
      createdAt: now,
      updatedAt: now
    };
    this.reviewers.push(reviewer);
    this._saveTable('reviewers', this.reviewers);
    return reviewer;
  }

  addImportedReview({ mediaAssetId, reviewerId, overallScore, comment, sourceReviewId, sourceReviewerId }) {
    const now = new Date().toISOString();
    const review = {
      id: 'rev-' + generateUUIDv4(), // Always generate local UUIDv4
      mediaAssetId,
      reviewerId,
      origin: 'imported',
      overallScore,
      comment: comment || '',
      sourceReviewId,
      sourceReviewerId,
      createdAt: now,
      updatedAt: now
    };
    this.reviews.push(review);
    this._saveTable('video_reviews', this.reviews);
    return review;
  }

  addImportedTagAssociation({ videoReviewId, tagId }) {
    const now = new Date().toISOString();
    const exists = this.reviewTags.some(rt => rt.videoReviewId === videoReviewId && rt.tagId === tagId);
    if (exists) return null;

    const rt = {
      id: 'review-tag-' + generateUUID(),
      videoReviewId,
      tagId,
      createdAt: now
    };
    this.reviewTags.push(rt);
    this._saveTable('review_tags', this.reviewTags);
    return rt;
  }

  addImportedTimelineNote({ videoReviewId, mediaAssetId, timestampSeconds, timestampLabel, comment, sourceCommentId }) {
    const now = new Date().toISOString();
    if (sourceCommentId) {
      const exists = this.timelineNotes.some(n => n.videoReviewId === videoReviewId && n.sourceCommentId === sourceCommentId);
      if (exists) return null;
    }

    const note = {
      id: 'note-' + generateUUID(),
      videoReviewId,
      mediaAssetId,
      timestampSeconds: parseFloat(timestampSeconds),
      timestampLabel: timestampLabel || '00:00',
      comment: comment || '',
      thumbnailUrl: '',
      thumbnailId: '',
      sourceCommentId,
      createdAt: now,
      updatedAt: now
    };
    this.timelineNotes.push(note);
    this._saveTable('timeline_notes', this.timelineNotes);
    return note;
  }

  createTransactionSnapshot() {
    return {
      reviews: JSON.parse(JSON.stringify(this.reviews || [])),
      timelineNotes: JSON.parse(JSON.stringify(this.timelineNotes || [])),
      reviewers: JSON.parse(JSON.stringify(this.reviewers || [])),
      reviewTags: JSON.parse(JSON.stringify(this.reviewTags || [])),
      pendingSharedReviews: JSON.parse(JSON.stringify(this.pendingSharedReviews || [])),
      tags: JSON.parse(JSON.stringify(this.tags || []))
    };
  }

  rollbackTransactionSnapshot(snapshot) {
    this.reviews = snapshot.reviews;
    this.timelineNotes = snapshot.timelineNotes;
    this.reviewers = snapshot.reviewers;
    this.reviewTags = snapshot.reviewTags;
    this.pendingSharedReviews = snapshot.pendingSharedReviews;
    this.tags = snapshot.tags;

    this._saveTable('video_reviews', this.reviews);
    this._saveTable('timeline_notes', this.timelineNotes);
    this._saveTable('reviewers', this.reviewers);
    this._saveTable('review_tags', this.reviewTags);
    this._saveTable('pending_shared_reviews', this.pendingSharedReviews);
    this._saveTable('tags', this.tags);
  }

  _saveAll() {
    const prevAllow = this._allowSaveDuringRestore;
    this._allowSaveDuringRestore = true;
    try {
      this._saveTable('media_assets', this.mediaAssets);
      this._saveTable('file_locations', this.fileLocations);
      this._saveTable('rating_criteria', this.criteria);
      this._saveTable('video_reviews', this.reviews);
      this._saveTable('criterion_ratings', this.criterionRatings);
      this._saveTable('tags', this.tags);
      this._saveTable('review_tags', this.reviewTags);
      this._saveTable('timeline_notes', this.timelineNotes);
      this._saveTable('directory_sources', this.directorySources);
      this._saveTable('genres', this.genres);
      this._saveTable('evaluation_templates', this.templates);
      this._saveTable('reviewers', this.reviewers);
      this._saveTable('pending_shared_reviews', this.pendingSharedReviews);
    } finally {
      this._allowSaveDuringRestore = prevAllow;
    }
  }



  normalizeBackupData(inputDb) {
    if (!inputDb || typeof inputDb !== 'object') {
      return {};
    }
    const rawDb = JSON.parse(JSON.stringify(inputDb));

    if (Array.isArray(rawDb.media_assets)) {
      rawDb.media_assets.forEach(a => {
        if (a.displayTitle === undefined) {
          a.displayTitle = null;
        } else {
          a.displayTitle = normalizeDisplayTitle(a.displayTitle);
        }
        if (a.identityStatus === undefined) {
          a.identityStatus = 'normal';
        }
        if (a.identityConflictGroupId === undefined) {
          a.identityConflictGroupId = null;
        }
        if (a.isArchived === undefined) {
          a.isArchived = false;
        }
        if (a.archivedAt === undefined) {
          a.archivedAt = null;
        }
        delete a.videoUrl;
        delete a.sourceType;
      });
    }

    if (Array.isArray(rawDb.file_locations)) {
      rawDb.file_locations.forEach(loc => {
        loc.relativePath = normalizePath(loc.relativePath);
      });
    }

    return rawDb;
  }

  validateBackupData(parsedDb, manifest, imageIds = []) {
    const fatalErrors = [];
    const warnings = [];

    // Pre-normalization URL video deprecation checks
    if (parsedDb && Array.isArray(parsedDb.media_assets)) {
      parsedDb.media_assets.forEach(v => {
        if (v.sourceType === 'url') {
          fatalErrors.push(`動画アセット ${v.id} の sourceType: 'url' はサポートされていません。`);
        }
        if (v.videoUrl !== undefined && v.videoUrl !== null && v.videoUrl !== '') {
          fatalErrors.push(`動画アセット ${v.id} はURL動画ソース (${v.videoUrl}) ですが、URL動画機能は廃止されたためサポートされていません。`);
        }
      });
    }

    const rawDb = this.normalizeBackupData(parsedDb);

    // 1. Verify manifest exists
    if (!manifest || typeof manifest !== 'object') {
      fatalErrors.push('マニフェストファイルがありません。');
    } else {
      // 2. Verify schemaVersion is 3 or 4
      if (!Number.isInteger(manifest.schemaVersion) || (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4)) {
        fatalErrors.push(`サポートされていないスキーマバージョンです: ${manifest.schemaVersion}`);
      }

      // 3. Verify manifest.createdAt is a valid ISO timestamp
      if (typeof manifest.createdAt !== 'string' || isNaN(Date.parse(manifest.createdAt))) {
        fatalErrors.push('マニフェストの作成日時 (createdAt) が不正なフォーマットです。');
      }

      // 4. Verify counts object and required fields
      if (!manifest.counts || typeof manifest.counts !== 'object') {
        fatalErrors.push('マニフェストに counts が存在しません。');
      } else {
        const reqCounts = ['media_assets', 'file_locations', 'reviews', 'images'];
        if (manifest.schemaVersion === 4) {
          reqCounts.push('reviewers', 'review_tags', 'pending_shared_reviews');
        }
        reqCounts.forEach(c => {
          const val = manifest.counts[c];
          if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
            fatalErrors.push(`manifest.counts.${c} は非負の整数である必要があります。`);
          }
        });
      }
    }

    // 5. Validate duplicate ZIP image IDs
    const seenImages = new Set();
    imageIds.forEach(imgId => {
      if (seenImages.has(imgId)) {
        fatalErrors.push(`ZIP内に重複する画像IDが検出されました: ${imgId}`);
      }
      seenImages.add(imgId);
    });

    if (rawDb && typeof rawDb === 'object') {
      if (manifest && manifest.schemaVersion) {
        rawDb.schemaVersion = rawDb.schemaVersion || manifest.schemaVersion;
      }
    }

    if (fatalErrors.length === 0 && rawDb && typeof rawDb === 'object') {
      // 7. Match counts
      if (manifest.counts.media_assets !== (rawDb.media_assets || []).length) {
        fatalErrors.push('動画アセットの件数がマニフェストのカウントと一致しません。');
      }
      if (manifest.counts.file_locations !== (rawDb.file_locations || []).length) {
        fatalErrors.push('ファイル所在地の件数がマニフェストのカウントと一致しません。');
      }
      if (manifest.counts.reviews !== (rawDb.video_reviews || []).length) {
        fatalErrors.push('レビューの件数がマニフェストのカウントと一致しません。');
      }
      if (manifest.counts.images !== imageIds.length) {
        fatalErrors.push('画像の件数がマニフェストのカウントと一致しません。');
      }
      if (manifest.schemaVersion === 4) {
        if (manifest.counts.reviewers !== (rawDb.reviewers || []).length) {
          fatalErrors.push('レビュアーの件数がマニフェストのカウントと一致しません。');
        }
        if (manifest.counts.review_tags !== (rawDb.review_tags || []).length) {
          fatalErrors.push('レビュータグの件数がマニフェストのカウントと一致しません。');
        }
        if (manifest.counts.pending_shared_reviews !== (rawDb.pending_shared_reviews || []).length) {
          fatalErrors.push('保留中レビューの件数がマニフェストのカウントと一致しません。');
        }
      }

      // 8. Validate duplicate IDs within each table
      const tablesWithId = ['media_assets', 'file_locations', 'rating_criteria', 'video_reviews', 'tags', 'timeline_notes', 'directory_sources', 'genres', 'evaluation_templates'];
      if (manifest.schemaVersion === 4) {
        tablesWithId.push('reviewers', 'review_tags', 'pending_shared_reviews');
      }
      tablesWithId.forEach(t => {
        if (Array.isArray(rawDb[t])) {
          const ids = new Set();
          rawDb[t].forEach((item, idx) => {
            if (item && item.id) {
              if (ids.has(item.id)) {
                fatalErrors.push(`テーブル ${t} に重複するID ${item.id} が検出されました。`);
              }
              ids.add(item.id);
            }
          });
        }
      });

      // 9. Validate duplicate IDs in criterion_ratings
      if (Array.isArray(rawDb.criterion_ratings)) {
        const crIds = new Set();
        rawDb.criterion_ratings.forEach(cr => {
          if (cr && cr.id) {
            if (crIds.has(cr.id)) {
              fatalErrors.push(`criterion_ratings に重複する ID ${cr.id} が検出されました。`);
            }
            crIds.add(cr.id);
          }
        });
      }

      // 10. Validate contentHash constraints and check duplicate non-empty contentHash
      if (Array.isArray(rawDb.media_assets)) {
        const hashGroups = new Map();
        rawDb.media_assets.forEach(v => {
          if (v.hashStatus === 'completed') {
            if (!v.contentHash || !/^[0-9a-f]{64}$/.test(v.contentHash)) {
              fatalErrors.push(`動画アセット ${v.id} の contentHash が不正です (completed 状態では 64 文字の小文字 16 進数が必要です)。`);
            }
          } else {
            if (v.contentHash && !/^[0-9a-f]{64}$/.test(v.contentHash)) {
              fatalErrors.push(`動画アセット ${v.id} の contentHash の形式が不正です。`);
            }
          }
          if (v.contentHash && v.contentHash.trim() !== '') {
            if (!hashGroups.has(v.contentHash)) {
              hashGroups.set(v.contentHash, []);
            }
            hashGroups.get(v.contentHash).push(v);
          }
        });

        // Check duplicate hash groups
        for (const [hash, assets] of hashGroups.entries()) {
          if (assets.length > 1) {
            const allConflict = assets.every(v => v.identityStatus === 'conflict');
            const firstGroupId = assets[0].identityConflictGroupId;
            const allSameGroupId = firstGroupId && assets.every(v => v.identityConflictGroupId === firstGroupId);
            if (!allConflict || !allSameGroupId) {
              fatalErrors.push(`動画アセット間に重複する contentHash (${hash}) が検出されました。正しい競合状態 (identityStatus === 'conflict' かつ同一の identityConflictGroupId) ではありません。`);
            }
          }
        }
      }

      // 11. Validate file_locations constraints: mediaAssetId reference and unique physical path
      if (Array.isArray(rawDb.file_locations)) {
        const seenLocations = new Set();
        rawDb.file_locations.forEach(loc => {
          loc.relativePath = normalizePath(loc.relativePath);
          if (!rawDb.media_assets.some(v => v.id === loc.mediaAssetId)) {
            fatalErrors.push(`ファイル所在地 ${loc.id} が参照する動画アセット ${loc.mediaAssetId} が存在しません。`);
          }
          if (loc.directoryId || loc.relativePath) {
            const locKey = `${loc.directoryId || ''}::${loc.relativePath || ''}`;
            if (seenLocations.has(locKey)) {
              fatalErrors.push(`ファイル所在地 ${loc.id} (${loc.relativePath}) の物理パスが重複して登録されています。`);
            }
            seenLocations.add(locKey);
          }
        });
      }

      // 12. Backfill missing rating criteria descriptions
      if (Array.isArray(rawDb.rating_criteria)) {
        rawDb.rating_criteria.forEach(c => {
          if (c.description === undefined) {
            c.description = '';
          }
        });
      }
    }

    // Inspect timeline notes and perform legacy repair/exclusion
    const keptTimelineNotes = [];
    if (rawDb && Array.isArray(rawDb.timeline_notes) && Array.isArray(rawDb.video_reviews)) {
      rawDb.timeline_notes.forEach(n => {
        const hasDirectReview = rawDb.video_reviews.some(r => r.id === n.videoReviewId);
        if (hasDirectReview) {
          keptTimelineNotes.push(n);
        } else {
          // Attempt safe repair (mediaAssetId / videoId match)
          const targetAssetId = n.mediaAssetId || n.videoId;
          const matchingReviews = targetAssetId ? rawDb.video_reviews.filter(r => r.mediaAssetId === targetAssetId) : [];
          if (matchingReviews.length === 1) {
            const targetReview = matchingReviews[0];
            const repairedNote = {
              ...n,
              mediaAssetId: targetReview.mediaAssetId,
              videoReviewId: targetReview.id
            };
            delete repairedNote.videoId;
            keptTimelineNotes.push(repairedNote);
            warnings.push({
              noteId: n.id,
              repaired: true,
              repairedToReviewId: targetReview.id,
              thumbnailId: n.thumbnailId || null
            });
          } else {
            // Irreparable orphan note
            warnings.push({
              noteId: n.id,
              repaired: false,
              repairedToReviewId: null,
              thumbnailId: n.thumbnailId || null
            });
          }
        }
      });
    }

    rawDb.timeline_notes = keptTimelineNotes;

    // 6. Validate using JSON Schema v3/v4 on the repaired/cleaned database
    if (rawDb && typeof rawDb === 'object') {
      const schemaToUse = (manifest && manifest.schemaVersion === 4) ? BACKUP_SCHEMA_V4 : BACKUP_SCHEMA;
      const schemaErrors = validateDataByJsonSchema(rawDb, schemaToUse);
      if (schemaErrors && schemaErrors.length > 0) {
        fatalErrors.push(...schemaErrors);
      }
    }

    // Recalculate required images set based only on kept/valid database objects
    const requiredImageIdsSet = new Set();
    if (rawDb && Array.isArray(rawDb.media_assets)) {
      rawDb.media_assets.forEach(v => {
        if (v.thumbnailId) requiredImageIdsSet.add(v.thumbnailId);
      });
    }
    keptTimelineNotes.forEach(n => {
      if (n.thumbnailId) requiredImageIdsSet.add(n.thumbnailId);
    });

    // Check that all required images are present in imageIds
    requiredImageIdsSet.forEach(imgId => {
      if (!imageIds.includes(imgId)) {
        fatalErrors.push(`動画/メモが参照する画像 ${imgId} がZIP内に存在しません。`);
      }
    });

    // Cross-table references (referential integrity check) on valid kept entries
    if (rawDb && fatalErrors.length === 0) {
      if (manifest && manifest.schemaVersion === 4) {
        const v4Errors = this.validateV4Structure(rawDb);
        if (v4Errors.length > 0) {
          fatalErrors.push(...v4Errors);
        }
      }

      if (Array.isArray(rawDb.video_reviews)) {
        rawDb.video_reviews.forEach(r => {
          if (!rawDb.media_assets.some(v => v.id === r.mediaAssetId)) {
            fatalErrors.push(`レビュー ${r.id} が参照する動画 ${r.mediaAssetId} が存在しません。`);
          }
        });
      }

      if (Array.isArray(rawDb.criterion_ratings)) {
        rawDb.criterion_ratings.forEach(cr => {
          if (!rawDb.video_reviews.some(r => r.id === cr.videoReviewId)) {
            fatalErrors.push(`評価スコア ${cr.id} が参照するレビュー ${cr.videoReviewId} が存在しません。`);
          }
          if (!rawDb.rating_criteria.some(c => c.id === cr.criterionId)) {
            fatalErrors.push(`評価スコア ${cr.id} が参照する評価項目 ${cr.criterionId} が存在しません。`);
          }
        });
      }

      if (Array.isArray(rawDb.video_tags)) {
        rawDb.video_tags.forEach(vt => {
          if (!rawDb.media_assets.some(v => v.id === vt.mediaAssetId)) {
            fatalErrors.push(`タグ関連情報が参照する動画 ${vt.mediaAssetId} が存在しません。`);
          }
          if (!rawDb.tags.some(t => t.id === vt.tagId)) {
            fatalErrors.push(`タグ関連情報が参照するタグ ${vt.tagId} が存在しません。`);
          }
        });
      }

      // Check referential integrity for kept notes
      keptTimelineNotes.forEach(n => {
        if (!rawDb.video_reviews.some(r => r.id === n.videoReviewId)) {
          fatalErrors.push(`タイムラインメモ ${n.id} が参照するレビュー ${n.videoReviewId} が存在しません。`);
        }
      });

      if (Array.isArray(rawDb.media_assets)) {
        rawDb.media_assets.forEach(v => {
          if (v.genreId && !rawDb.genres.some(g => g.id === v.genreId)) {
            fatalErrors.push(`動画 ${v.id} が参照するジャンル ${v.genreId} が存在しません。`);
          }
        });
      }

      if (Array.isArray(rawDb.evaluation_templates)) {
        rawDb.evaluation_templates.forEach(t => {
          if (!rawDb.genres.some(g => g.id === t.genreId)) {
            fatalErrors.push(`テンプレート ${t.id} が参照するジャンル ${t.genreId} が存在しません。`);
          }
          if (t.criteriaIds) {
            const ids = t.criteriaIds.split(',').map(s => s.trim()).filter(Boolean);
            ids.forEach(cid => {
              if (!rawDb.rating_criteria.some(c => c.id === cid)) {
                fatalErrors.push(`テンプレート ${t.id} が参照する評価項目 ${cid} が存在しません。`);
              }
            });
          }
        });
      }
    }

    return {
      isValid: fatalErrors.length === 0,
      fatalErrors,
      warnings,
      repairedDb: rawDb,
      requiredImageIds: Array.from(requiredImageIdsSet)
    };
  }

  // Production Restore execution method with full transaction rollback (memory, storage, IndexedDB)
  async restoreWithRollback(parsedDb, images) {
    if (parsedDb && Array.isArray(parsedDb.media_assets)) {
      for (const v of parsedDb.media_assets) {
        if (v.sourceType === 'url') {
          throw new Error(`動画アセット ${v.id} の sourceType: 'url' はサポートされていません。`);
        }
        if (v.videoUrl !== undefined && v.videoUrl !== null && v.videoUrl !== '') {
          throw new Error(`動画アセット ${v.id} はURL動画ソース (${v.videoUrl}) ですが、URL動画機能は廃止されたためサポートされていません。`);
        }
      }
    }
    const normalizedDb = this.normalizeBackupData(parsedDb);

    // 1. Snapshot in-memory collections (deep copy)
    const inMemorySnapshot = {
      mediaAssets: JSON.parse(JSON.stringify(this.mediaAssets || [])),
      fileLocations: JSON.parse(JSON.stringify(this.fileLocations || [])),
      criteria: JSON.parse(JSON.stringify(this.criteria || [])),
      reviews: JSON.parse(JSON.stringify(this.reviews || [])),
      criterionRatings: JSON.parse(JSON.stringify(this.criterionRatings || [])),
      tags: JSON.parse(JSON.stringify(this.tags || [])),
      _legacyVideoTags: JSON.parse(JSON.stringify(this._legacyVideoTags || [])),
      timelineNotes: JSON.parse(JSON.stringify(this.timelineNotes || [])),
      directorySources: JSON.parse(JSON.stringify(this.directorySources || [])),
      genres: JSON.parse(JSON.stringify(this.genres || [])),
      templates: JSON.parse(JSON.stringify(this.templates || [])),
      reviewers: JSON.parse(JSON.stringify(this.reviewers || [])),
      reviewTags: JSON.parse(JSON.stringify(this.reviewTags || [])),
      pendingSharedReviews: JSON.parse(JSON.stringify(this.pendingSharedReviews || []))
    };

    // 2. Snapshot original localStorage entries
    const originalLocalData = {};
    const localKeys = [
      'media_assets', 'file_locations', 'rating_criteria', 'video_reviews', 'criterion_ratings',
      'tags', 'video_tags', 'timeline_notes', 'directory_sources',
      'genres', 'evaluation_templates', 'reviewers', 'review_tags', 'pending_shared_reviews'
    ];
    localKeys.forEach(k => {
      originalLocalData[k] = this.storage ? this.storage.getItem(`${this.prefix}${k}`) : null;
    });

    // 3. Snapshot original IndexedDB images and DirectoryHandles
    let originalImages = [];
    let originalHandles = [];
    if (this.idbAvailable) {
      try {
        originalImages = await this.getAllImages();
        originalHandles = await this.getAllDirectoryHandles();
      } catch (e) {
        console.warn('Failed to snapshot original images/handles:', e.message);
        throw e;
      }
    }

    try {
      this._inRestoreTransaction = true;

      // 4. Perform the write sequence
      // 4a. Import images first
      if (this.idbAvailable) {
        await this.idb.clearImages();
        const promises = images.map(img => this.idb.put(img.id, img.data, 'images'));
        await Promise.all(promises);
      }

      // 4b. Assign normalizedDb values to in-memory collections
      this.mediaAssets = normalizedDb.media_assets || [];
      this.fileLocations = normalizedDb.file_locations || [];
      this.criteria = normalizedDb.rating_criteria || [];
      this.reviews = normalizedDb.video_reviews || [];
      this.criterionRatings = normalizedDb.criterion_ratings || [];
      this.tags = normalizedDb.tags || [];
      this._legacyVideoTags = normalizedDb.video_tags || [];
      this.timelineNotes = normalizedDb.timeline_notes || [];
      this.reviewers = normalizedDb.reviewers || [];
      this.reviewTags = normalizedDb.review_tags || [];
      this.pendingSharedReviews = normalizedDb.pending_shared_reviews || [];

      // Reconcile directory sources with existing DirectoryHandles in IndexedDB
      const reconciledSources = [];
      if (Array.isArray(normalizedDb.directory_sources)) {
        for (const src of normalizedDb.directory_sources) {
          let matchedHandleKey = null;

          // Priority 1: Restored src.id matches origSrc.id and origSrc has a handle in IndexedDB
          const origSrcById = inMemorySnapshot.directorySources.find(os => os.id === src.id);
          if (origSrcById && origSrcById.handleKey) {
            const hasHandle = originalHandles.some(h => h.id === origSrcById.handleKey);
            if (hasHandle) {
              matchedHandleKey = origSrcById.handleKey;
            }
          }

          // Priority 2: Restored handleKey exists in IndexedDB directly
          if (!matchedHandleKey && src.handleKey) {
            const hasHandle = originalHandles.some(h => h.id === src.handleKey);
            if (hasHandle) {
              matchedHandleKey = src.handleKey;
            }
          }

          // Priority 3: Restored src.name matches origSrc.name where exactly one candidates has a handle
          if (!matchedHandleKey) {
            const candidates = inMemorySnapshot.directorySources.filter(os =>
              os.name === src.name &&
              os.handleKey &&
              originalHandles.some(h => h.id === os.handleKey)
            );
            if (candidates.length === 1) {
              matchedHandleKey = candidates[0].handleKey;
            }
          }

          let status = 'prompt';
          let finalHandleKey = '';

          if (matchedHandleKey) {
            finalHandleKey = matchedHandleKey;
            const matchingHandleObj = originalHandles.find(h => h.id === matchedHandleKey);
            if (matchingHandleObj && matchingHandleObj.data && typeof matchingHandleObj.data.queryPermission === 'function') {
              try {
                status = await matchingHandleObj.data.queryPermission({ mode: 'read' });
              } catch (err) {
                console.warn('Failed to query handle permission during restore:', err);
              }
            }
          } else {
            status = 'disconnected';
          }

          reconciledSources.push({
            ...src,
            handleKey: finalHandleKey,
            permissionStatus: status
          });
        }
      }
      this.directorySources = reconciledSources;

      this.genres = normalizedDb.genres || [];
      this.templates = normalizedDb.evaluation_templates || [];

      // 4d. Memory upgrade from v3 to v4 if needed
      const restoreSchemaVersion = normalizedDb.schemaVersion || 3;
      if (restoreSchemaVersion === 3) {
        await this._migrateInMemoryToV4();
      }

      // 4e. Validate final memory V4 structure
      const v4Errors = this.validateV4Structure({
        reviewers: this.reviewers,
        media_assets: this.mediaAssets,
        file_locations: this.fileLocations,
        video_reviews: this.reviews,
        criterion_ratings: this.criterionRatings,
        tags: this.tags,
        review_tags: this.reviewTags,
        timeline_notes: this.timelineNotes,
        directory_sources: this.directorySources,
        genres: this.genres,
        evaluation_templates: this.templates,
        pending_shared_reviews: this.pendingSharedReviews
      });

      if (v4Errors.length > 0) {
        throw new Error('V4 Schema Validation Failed during restore: ' + v4Errors.join('; '));
      }

      // 4c. Persist all tables to storage
      this._saveAll();

      this._inRestoreTransaction = false;
      return true;
    } catch (err) {
      console.error('Error during write phase, triggering rollback:', err);

      // 5. Rollback everything
      // 5a. Rollback in-memory properties
      this.mediaAssets = inMemorySnapshot.mediaAssets;
      this.fileLocations = inMemorySnapshot.fileLocations;
      this.criteria = inMemorySnapshot.criteria;
      this.reviews = inMemorySnapshot.reviews;
      this.criterionRatings = inMemorySnapshot.criterionRatings;
      this.tags = inMemorySnapshot.tags;
      this._legacyVideoTags = inMemorySnapshot._legacyVideoTags;
      this.timelineNotes = inMemorySnapshot.timelineNotes;
      this.directorySources = inMemorySnapshot.directorySources;
      this.genres = inMemorySnapshot.genres;
      this.templates = inMemorySnapshot.templates;
      this.reviewers = inMemorySnapshot.reviewers;
      this.reviewTags = inMemorySnapshot.reviewTags;
      this.pendingSharedReviews = inMemorySnapshot.pendingSharedReviews;

      // 5b. Rollback localStorage
      localKeys.forEach(k => {
        if (originalLocalData[k] !== null) {
          if (this.storage) this.storage.setItem(`${this.prefix}${k}`, originalLocalData[k]);
        } else {
          if (this.storage) this.storage.removeItem(`${this.prefix}${k}`);
        }
      });

      // 5c. Rollback IndexedDB images and handles
      if (this.idbAvailable) {
        try {
          await this.idb.clearImages();
          await this.idb.clearHandles();

          const rollbackImgPromises = originalImages.map(img => this.idb.put(img.id, img.data, 'images'));
          await Promise.all(rollbackImgPromises);

          const rollbackHandlePromises = originalHandles.map(h => this.idb.put(h.id, h.data, 'handles'));
          await Promise.all(rollbackHandlePromises);
        } catch (rollbackErr) {
          console.error('Fatal error during IndexedDB rollback:', rollbackErr);
        }
      }

      this._inRestoreTransaction = false;
      throw err;
    }
  }

  // --- GENRE OPERATIONS ---

  getGenres() {
    return this.genres.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  getActiveGenres() {
    return this.getGenres().filter(g => g.isActive);
  }

  getGenre(id) {
    return this.genres.find(g => g.id === id);
  }

  async addGenre(name) {
    if (!name || !name.trim()) throw new Error('ジャンル名を入力してください。');
    const cleanName = name.trim();

    const dup = this.genres.find(g => g.name === cleanName && g.isActive);
    if (dup) throw new Error('同名のジャンルが既に存在します。');

    const maxOrder = this.genres.reduce((max, g) => Math.max(max, g.displayOrder), 0);
    const genreId = 'genre-' + generateUUID();
    const genre = {
      id: genreId,
      name: cleanName,
      displayTitle: cleanName,
      description: cleanName + 'のジャンル区分',
      displayOrder: maxOrder + 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.genres.push(genre);
    this._saveTable('genres', this.genres);

    const templateId = 'temp-' + generateUUID();
    const template = {
      id: templateId,
      genreId: genreId,
      name: cleanName + 'のテンプレート',
      criteriaIds: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.templates.push(template);
    this._saveTable('evaluation_templates', this.templates);

    return genre;
  }

  async updateGenre(id, updates) {
    const idx = this.genres.findIndex(g => g.id === id);
    if (idx !== -1) {
      if (updates.name) {
        updates.name = updates.name.trim();
        const dup = this.genres.find(g => g.id !== id && g.name === updates.name && g.isActive);
        if (dup) throw new Error('同名のジャンルが既に存在します。');
      }
      this.genres[idx] = {
        ...this.genres[idx],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this._saveTable('genres', this.genres);
      return this.genres[idx];
    }
    return null;
  }

  // --- CRITERIA BY GENRE OPERATIONS ---

  getCriteriaForGenre(genreId) {
    const template = this.templates.find(t => t.genreId === genreId);
    if (!template) return [];
    return this.criteria
      .filter(c => c.templateId === template.id)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  getActiveCriteriaForGenre(genreId) {
    return this.getCriteriaForGenre(genreId).filter(c => c.isActive);
  }

  async addCriterionToGenre(genreId, name, description = '') {
    if (!name || !name.trim()) throw new Error('項目名を入力してください。');
    const cleanName = name.trim();

    const template = this.templates.find(t => t.genreId === genreId);
    if (!template) throw new Error('ジャンルの評価テンプレートが見つかりません。');

    const active = this.getActiveCriteriaForGenre(genreId);
    if (active.length >= 6) {
      throw new Error('評価項目は最大6項目まで登録できます。');
    }

    const dup = active.find(c => c.name === cleanName);
    if (dup) throw new Error('同名の評価項目が既に存在します。');

    const allOfTemplate = this.criteria.filter(c => c.templateId === template.id);
    const maxOrder = allOfTemplate.reduce((max, c) => Math.max(max, c.displayOrder), 0);

    const crit = {
      id: 'crit-' + generateUUID(),
      templateId: template.id,
      name: cleanName,
      description: description || '',
      displayOrder: maxOrder + 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.criteria.push(crit);
    this._saveTable('rating_criteria', this.criteria);
    return crit;
  }

  async copyCriteria(fromGenreId, toGenreId) {
    const fromTemplate = this.templates.find(t => t.genreId === fromGenreId);
    const toTemplate = this.templates.find(t => t.genreId === toGenreId);
    if (!fromTemplate || !toTemplate) throw new Error('ジャンルが見つかりません。');

    const sourceCriteria = this.criteria.filter(c => c.templateId === fromTemplate.id && c.isActive);
    if (sourceCriteria.length === 0) throw new Error('コピー元のジャンルに有効な評価項目がありません。');
    if (sourceCriteria.length > 6) throw new Error('コピー元の評価項目が6項目を超えています。');

    this.criteria.forEach(c => {
      if (c.templateId === toTemplate.id) {
        c.isActive = false;
        c.updatedAt = new Date().toISOString();
      }
    });

    const now = new Date().toISOString();
    sourceCriteria.forEach((sc, index) => {
      this.criteria.push({
        id: 'crit-' + generateUUID(),
        templateId: toTemplate.id,
        name: sc.name,
        description: sc.description || '',
        displayOrder: index + 1,
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
    });

    this._saveTable('rating_criteria', this.criteria);
  }

  getCriteriaForVideoReview(mediaAssetId) {
    const video = this.getVideo(mediaAssetId);
    if (!video) return [];

    const genreId = video.genreId || 'genre-default';
    const template = this.templates.find(t => t.genreId === genreId);
    const templateId = template ? template.id : null;

    const active = this.criteria.filter(c => c.templateId === templateId && c.isActive);
    const review = this.getReviewForVideo(mediaAssetId);
    if (!review) {
      return active.sort((a, b) => a.displayOrder - b.displayOrder);
    }

    const ratings = this.criterionRatings.filter(cr => cr.videoReviewId === review.id);
    const result = [...active];

    ratings.forEach(r => {
      const exists = result.find(c => c.id === r.criterionId);
      if (!exists) {
        result.push({
          id: r.criterionId,
          name: r.criterionName || '不明な項目',
          isActive: false,
          templateId: templateId,
          displayOrder: 99
        });
      }
    });

    return result.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async checkOrphanData() {
    const orphanNotes = this.timelineNotes.filter(n => {
      return !this.reviews.some(r => r.id === n.videoReviewId);
    });

    const unreferencedImageIds = [];
    if (this.idbAvailable) {
      const allImages = await this.getAllImages();
      const referencedImageIds = new Set();
      this.mediaAssets.forEach(v => {
        if (v.thumbnailId) referencedImageIds.add(v.thumbnailId);
      });
      this.timelineNotes.forEach(n => {
        const isOrphan = orphanNotes.some(on => on.id === n.id);
        if (!isOrphan && n.thumbnailId) {
          referencedImageIds.add(n.thumbnailId);
        }
      });

      allImages.forEach(img => {
        if (!referencedImageIds.has(img.id)) {
          unreferencedImageIds.push(img.id);
        }
      });
    }

    return {
      orphanNotes,
      unreferencedImageIds
    };
  }

  async cleanOrphanData() {
    const { orphanNotes, unreferencedImageIds } = await this.checkOrphanData();

    const orphanNoteIds = orphanNotes.map(n => n.id);
    this.timelineNotes = this.timelineNotes.filter(n => !orphanNoteIds.includes(n.id));
    this._saveTable('timeline_notes', this.timelineNotes);

    if (this.idbAvailable) {
      for (const imgId of unreferencedImageIds) {
        await this.idb.delete(imgId, 'images');
      }
    }

    return {
      notesCleanedCount: orphanNotes.length,
      imagesCleanedCount: unreferencedImageIds.length
    };
  }
}

export const BACKUP_SCHEMA = {
  "type": "object",
  "required": [
    "schemaVersion",
    "media_assets",
    "file_locations",
    "rating_criteria",
    "video_reviews",
    "criterion_ratings",
    "tags",
    "video_tags",
    "timeline_notes",
    "directory_sources",
    "genres",
    "evaluation_templates"
  ],
  "properties": {
    "schemaVersion": {
      "type": "integer",
      "enum": [3]
    },
    "media_assets": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "contentHash",
          "hashAlgorithm",
          "quickHash",
          "hashStatus",
          "fileSize",
          "duration",
          "displayTitle",
          "genreId",
          "identityStatus",
          "identityConflictGroupId",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "contentHash": { "type": "string" },
          "hashAlgorithm": { "type": "string", "enum": ["SHA-256"] },
          "quickHash": { "type": "string" },
          "hashStatus": { "type": "string", "enum": ["pending", "calculating", "completed", "failed"] },
          "fileSize": { "type": "integer", "minimum": 0 },
          "duration": { "type": "number", "minimum": 0 },
          "displayTitle": { "type": ["string", "null"] },
          "genreId": { "type": "string", "pattern": "^genre-[a-zA-Z0-9-]{1,64}$" },
          "thumbnailId": { "type": "string" },
          "identityStatus": { "type": "string", "enum": ["normal", "conflict", "provisional", "verified"] },
          "identityConflictGroupId": { "type": ["string", "null"] },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" },
          "isArchived": { "type": "boolean" },
          "archivedAt": { "type": ["string", "null"] }
        }
      }
    },
    "file_locations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "mediaAssetId",
          "relativePath",
          "fileName",
          "fileSize",
          "lastModified",
          "availabilityStatus",
          "lastVerifiedAt",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^loc-[a-zA-Z0-9-]{8,64}$" },
          "mediaAssetId": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "directoryId": { "type": "string" },
          "relativePath": { "type": "string" },
          "fileName": { "type": "string" },
          "fileSize": { "type": "integer", "minimum": 0 },
          "lastModified": { "type": "integer" },
          "availabilityStatus": { "type": "string", "enum": ["available", "permission-required", "missing", "unsupported", "scan-error"] },
          "lastVerifiedAt": { "type": "string" },
          "verificationStatus": { "type": "string", "enum": ["provisional", "verified", "failed"] },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "rating_criteria": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "description"],
        "properties": {
          "id": { "type": "string", "pattern": "^crit-[a-zA-Z0-9-]{1,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "description": { "type": "string" }
        }
      }
    },
    "video_reviews": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "mediaAssetId", "createdAt", "updatedAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^rev-[a-zA-Z0-9-]{8,64}$" },
          "mediaAssetId": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "overallGrade": { "type": ["string", "null"] },
          "comment": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "criterion_ratings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "videoReviewId", "criterionId", "score"],
        "properties": {
          "id": { "type": "string", "pattern": "^rate-[a-zA-Z0-9-]{8,64}$" },
          "videoReviewId": { "type": "string", "pattern": "^rev-[a-zA-Z0-9-]{8,64}$" },
          "criterionId": { "type": "string", "pattern": "^crit-[a-zA-Z0-9-]{1,64}$" },
          "score": { "type": "integer", "minimum": 1, "maximum": 5 }
        }
      }
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": { "type": "string", "pattern": "^tag-[a-zA-Z0-9-]{8,64}$" },
          "name": { "type": "string", "minLength": 1 }
        }
      }
    },
    "video_tags": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["mediaAssetId", "tagId"],
        "properties": {
          "mediaAssetId": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "tagId": { "type": "string", "pattern": "^tag-[a-zA-Z0-9-]{8,64}$" }
        }
      }
    },
    "timeline_notes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "videoReviewId", "mediaAssetId", "timestampSeconds", "timestampLabel", "comment", "createdAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^note-[a-zA-Z0-9-]{8,64}$" },
          "videoReviewId": { "type": "string", "pattern": "^rev-[a-zA-Z0-9-]{8,64}$" },
          "mediaAssetId": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "timestampSeconds": { "type": "number", "minimum": 0 },
          "timestampLabel": { "type": "string" },
          "comment": { "type": "string" },
          "thumbnailId": { "type": "string" },
          "createdAt": { "type": "string" }
        }
      }
    },
    "directory_sources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "includeSubdirectories", "permissionStatus", "handleKey", "createdAt", "updatedAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^dir-[a-zA-Z0-9-]{8,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "includeSubdirectories": { "type": "boolean" },
          "permissionStatus": { "type": "string", "enum": ["granted", "denied", "prompt", "disconnected"] },
          "handleKey": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "genres": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "displayTitle", "description", "createdAt", "updatedAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^genre-[a-zA-Z0-9-]{1,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "displayTitle": { "type": "string", "minLength": 1 },
          "description": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "evaluation_templates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "genreId", "name", "criteriaIds", "createdAt", "updatedAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^temp-[a-zA-Z0-9-]{1,64}$" },
          "genreId": { "type": "string", "pattern": "^genre-[a-zA-Z0-9-]{1,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "criteriaIds": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    }
  }
};

export function validateDataByJsonSchema(data, schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    errors.push('JSON Schema is invalid or not loaded.');
    return errors;
  }
  if (schema.required) {
    for (const reqField of schema.required) {
      if (!(reqField in data)) {
        errors.push("ルートオブジェクトに必須フィールド " + reqField + " が存在しません。");
      }
    }
  }
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in data)) continue;
      const value = data[key];
      if (propSchema.type === 'integer') {
        if (!Number.isInteger(value)) {
          errors.push("フィールド " + key + " は整数である必要があります。");
        }
      } else if (propSchema.type === 'array') {
        if (!Array.isArray(value)) {
          errors.push("フィールド " + key + " は配列である必要があります。");
          continue;
        }
        const itemSchema = propSchema.items;
        if (itemSchema && itemSchema.properties) {
          const itemRequired = itemSchema.required || [];
          const itemProps = itemSchema.properties;
          value.forEach((item, idx) => {
            if (typeof item !== 'object' || item === null) {
              errors.push("配列 " + key + " のインデックス " + idx + " がオブジェクトではありません。");
              return;
            }
            for (const reqProp of itemRequired) {
              if (!(reqProp in item) || item[reqProp] === undefined) {
                errors.push("テーブル " + key + " のレコード (index: " + idx + ") に必須プロパティ " + reqProp + " が存在しません。");
              }
            }
            for (const [propName, rules] of Object.entries(itemProps)) {
              if (!(propName in item) || item[propName] === undefined || item[propName] === null) {
                continue;
              }
              const val = item[propName];
              let typeMatch = false;
              const allowedTypes = Array.isArray(rules.type) ? rules.type : [rules.type];
              for (const t of allowedTypes) {
                if (t === 'string' && typeof val === 'string') typeMatch = true;
                if (t === 'number' && typeof val === 'number') typeMatch = true;
                if (t === 'integer' && Number.isInteger(val)) typeMatch = true;
                if (t === 'boolean' && typeof val === 'boolean') typeMatch = true;
                if (t === 'null' && val === null) typeMatch = true;
              }
              if (!typeMatch) {
                errors.push("テーブル " + key + " (index: " + idx + ") のプロパティ " + propName + " の値が期待される型 [" + allowedTypes.join(', ') + "] ではありません。");
              }
              if (rules.enum && !rules.enum.includes(val)) {
                errors.push("テーブル " + key + " (index: " + idx + ") のプロパティ " + propName + " の値が許可された値 [" + rules.enum.join(', ') + "] ではありません。");
              }
              if (rules.pattern && typeof val === 'string') {
                const regex = new RegExp(rules.pattern);
                if (!regex.test(val)) {
                  errors.push("テーブル " + key + " (index: " + idx + ") のプロパティ " + propName + " の形式がパターン \"" + rules.pattern + "\" にマッチしません (値: \"" + val + "\")。");
                }
              }
              if (rules.minimum !== undefined && typeof val === 'number' && val < rules.minimum) {
                errors.push("テーブル " + key + " (index: " + idx + ") のプロパティ " + propName + " は最小値 " + rules.minimum + " 以上である必要があります。");
              }
              if (rules.maximum !== undefined && typeof val === 'number' && val > rules.maximum) {
                errors.push("テーブル " + key + " (index: " + idx + ") のプロパティ " + propName + " は最大値 " + rules.maximum + " 以下である必要があります。");
              }
              if (rules.minLength !== undefined && typeof val === 'string' && val.length < rules.minLength) {
                errors.push("テーブル " + key + " (index: " + idx + ") のプロパティ " + propName + " は最小文字数 " + rules.minLength + " 以上である必要があります。");
              }
            }
          });
        }
      }
    }
  }
  return errors;
}

export function overallGradeToScore(grade) {
  if (grade === null || grade === undefined) return null;
  const upper = String(grade).toUpperCase().trim();
  if (upper === '') return null;
  if (upper === 'A') return 5;
  if (upper === 'B') return 4;
  if (upper === 'C') return 3;
  if (upper === 'D') return 2;
  if (upper === 'E') return 1;
  throw new Error(`Invalid grade value: ${grade}`);
}

export function overallScoreToGrade(score) {
  if (score === null || score === undefined || score === '') return null;
  const num = parseInt(score, 10);
  if (num === 5) return 'A';
  if (num === 4) return 'B';
  if (num === 3) return 'C';
  if (num === 2) return 'D';
  if (num === 1) return 'E';
  throw new Error(`Invalid score value: ${score}`);
}

export const BACKUP_SCHEMA_V4 = {
  "type": "object",
  "required": [
    "schemaVersion",
    "reviewers",
    "media_assets",
    "file_locations",
    "rating_criteria",
    "video_reviews",
    "criterion_ratings",
    "tags",
    "review_tags",
    "timeline_notes",
    "directory_sources",
    "genres",
    "evaluation_templates",
    "pending_shared_reviews"
  ],
  "properties": {
    "schemaVersion": {
      "type": "integer",
      "enum": [4]
    },
    "reviewers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "displayName",
          "isLocal",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^reviewer-[a-zA-Z0-9-]{8,64}$" },
          "displayName": { "type": "string", "minLength": 1 },
          "isLocal": { "type": "boolean" },
          "sourceReviewerId": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "media_assets": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "contentHash",
          "hashAlgorithm",
          "quickHash",
          "hashStatus",
          "fileSize",
          "duration",
          "displayTitle",
          "genreId",
          "identityStatus",
          "identityConflictGroupId",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "contentHash": { "type": "string" },
          "hashAlgorithm": { "type": "string", "enum": ["SHA-256"] },
          "quickHash": { "type": "string" },
          "hashStatus": { "type": "string", "enum": ["pending", "calculating", "completed", "failed"] },
          "fileSize": { "type": "integer", "minimum": 0 },
          "duration": { "type": "number", "minimum": 0 },
          "displayTitle": { "type": ["string", "null"] },
          "genreId": { "type": "string", "pattern": "^genre-[a-zA-Z0-9-]{1,64}$" },
          "thumbnailId": { "type": "string" },
          "identityStatus": { "type": "string", "enum": ["normal", "conflict", "provisional", "verified"] },
          "identityConflictGroupId": { "type": ["string", "null"] },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" },
          "isArchived": { "type": "boolean" },
          "archivedAt": { "type": ["string", "null"] }
        }
      }
    },
    "file_locations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "mediaAssetId",
          "relativePath",
          "fileName",
          "fileSize",
          "lastModified",
          "availabilityStatus",
          "lastVerifiedAt",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^loc-[a-zA-Z0-9-]{8,64}$" },
          "mediaAssetId": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "directoryId": { "type": "string" },
          "relativePath": { "type": "string" },
          "fileName": { "type": "string" },
          "fileSize": { "type": "integer", "minimum": 0 },
          "lastModified": { "type": "integer" },
          "availabilityStatus": { "type": "string", "enum": ["available", "permission-required", "missing", "unsupported", "scan-error"] },
          "lastVerifiedAt": { "type": "string" },
          "verificationStatus": { "type": "string", "enum": ["provisional", "verified", "failed"] },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "rating_criteria": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "description"],
        "properties": {
          "id": { "type": "string", "pattern": "^crit-[a-zA-Z0-9-]{1,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "description": { "type": "string" }
        }
      }
    },
    "video_reviews": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "mediaAssetId",
          "reviewerId",
          "origin",
          "overallScore",
          "comment",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^rev-[a-zA-Z0-9-]{8,64}$" },
          "mediaAssetId": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "reviewerId": { "type": "string", "pattern": "^reviewer-[a-zA-Z0-9-]{8,64}$" },
          "origin": { "type": "string", "enum": ["local", "imported"] },
          "overallScore": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 },
          "comment": { "type": "string" },
          "sourceReviewId": { "type": "string" },
          "sourceReviewerId": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "criterion_ratings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "videoReviewId", "criterionId", "score"],
        "properties": {
          "id": { "type": "string", "pattern": "^rate-[a-zA-Z0-9-]{8,64}$" },
          "videoReviewId": { "type": "string", "pattern": "^rev-[a-zA-Z0-9-]{8,64}$" },
          "criterionId": { "type": "string", "pattern": "^crit-[a-zA-Z0-9-]{1,64}$" },
          "score": { "type": "integer", "minimum": 1, "maximum": 5 }
        }
      }
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": { "type": "string", "pattern": "^tag-[a-zA-Z0-9-]{8,64}$" },
          "name": { "type": "string", "minLength": 1 }
        }
      }
    },
    "review_tags": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "videoReviewId", "tagId", "createdAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^review-tag-[a-zA-Z0-9-]{8,64}$" },
          "videoReviewId": { "type": "string", "pattern": "^rev-[a-zA-Z0-9-]{8,64}$" },
          "tagId": { "type": "string", "pattern": "^tag-[a-zA-Z0-9-]{8,64}$" },
          "createdAt": { "type": "string" }
        }
      }
    },
    "timeline_notes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "videoReviewId",
          "mediaAssetId",
          "timestampSeconds",
          "timestampLabel",
          "comment",
          "createdAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^note-[a-zA-Z0-9-]{8,64}$" },
          "videoReviewId": { "type": "string", "pattern": "^rev-[a-zA-Z0-9-]{8,64}$" },
          "mediaAssetId": { "type": "string", "pattern": "^(vid-|ast-)[a-zA-Z0-9-]{8,64}$" },
          "timestampSeconds": { "type": "number", "minimum": 0 },
          "timestampLabel": { "type": "string" },
          "comment": { "type": "string" },
          "thumbnailId": { "type": "string" },
          "sourceCommentId": { "type": "string" },
          "createdAt": { "type": "string" }
        }
      }
    },
    "directory_sources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "includeSubdirectories", "permissionStatus", "handleKey", "createdAt", "updatedAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^dir-[a-zA-Z0-9-]{8,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "includeSubdirectories": { "type": "boolean" },
          "permissionStatus": { "type": "string", "enum": ["granted", "denied", "prompt", "disconnected"] },
          "handleKey": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "genres": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "displayTitle", "description", "createdAt", "updatedAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^genre-[a-zA-Z0-9-]{1,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "displayTitle": { "type": "string", "minLength": 1 },
          "description": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "evaluation_templates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "genreId", "name", "criteriaIds", "createdAt", "updatedAt"],
        "properties": {
          "id": { "type": "string", "pattern": "^temp-[a-zA-Z0-9-]{1,64}$" },
          "genreId": { "type": "string", "pattern": "^genre-[a-zA-Z0-9-]{1,64}$" },
          "name": { "type": "string", "minLength": 1 },
          "criteriaIds": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    },
    "pending_shared_reviews": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "packageId",
          "videoHash",
          "hashAlgorithm",
          "reviewerId",
          "payload",
          "status",
          "importedAt",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^pending-review-[a-zA-Z0-9-]{8,64}$" },
          "packageId": { "type": "string" },
          "videoHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "hashAlgorithm": { "type": "string", "enum": ["sha256"] },
          "reviewerId": { "type": "string", "pattern": "^reviewer-[a-zA-Z0-9-]{8,64}$" },
          "payload": { "type": "object" },
          "status": { "type": "string", "enum": ["pending"] },
          "importedAt": { "type": "string" },
          "createdAt": { "type": "string" },
          "updatedAt": { "type": "string" }
        }
      }
    }
  }
};
