/**
 * Database abstraction layer using localStorage and IndexedDB.
 * Implements a relational data schema for video reviews, ratings, tags, and timeline notes.
 */

import { base64ToBlob } from './video-helper.js';

// Helper to generate unique IDs
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

// Default Rating Criteria
const DEFAULT_CRITERIA = [
  { id: 'crit-content', name: '内容', displayOrder: 1, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-visuals', name: '映像', displayOrder: 2, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-audio', name: '音声', displayOrder: 3, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-pacing', name: 'テンポ', displayOrder: 4, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-originality', name: '独自性', displayOrder: 5, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'crit-replayability', name: '再視聴性', displayOrder: 6, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

// Sample Videos with sourceType: 'url'
const SAMPLE_VIDEOS = [
  {
    id: 'vid-sample-bunny',
    title: 'Big Buck Bunny (Sample)',
    fileName: 'big_buck_bunny.mp4',
    fileSize: 5510872,
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    duration: 596,
    thumbnailUrl: '',
    thumbnailId: '',
    sourceType: 'url',
    availabilityStatus: 'available',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'vid-sample-sintel',
    title: 'Sintel Trailer (Sample)',
    fileName: 'sintel.mp4',
    fileSize: 4238712,
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    duration: 52,
    thumbnailUrl: '',
    thumbnailId: '',
    sourceType: 'url',
    availabilityStatus: 'available',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'vid-sample-tears',
    title: 'Tears of Steel (Sample)',
    fileName: 'tears_of_steel.mp4',
    fileSize: 6734123,
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    duration: 734,
    thumbnailUrl: '',
    thumbnailId: '',
    sourceType: 'url',
    availabilityStatus: 'available',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

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
    this.videos = this._loadTable('videos', SAMPLE_VIDEOS);
    this.criteria = this._loadTable('rating_criteria', DEFAULT_CRITERIA);
    this.reviews = this._loadTable('video_reviews', []);
    this.criterionRatings = this._loadTable('criterion_ratings', []);
    this.tags = this._loadTable('tags', []);
    this.videoTags = this._loadTable('video_tags', []);
    this.timelineNotes = this._loadTable('timeline_notes', []);
    
    // Directory Sources table setup
    this.directorySources = this._loadTable('directory_sources', []);
  }

  async initAsync() {
    this.idb = new IndexedDBStore(this.idbName);
    try {
      await this.idb.init();
      this.idbAvailable = true;
      
      // Perform base64 conversion migrations
      await this._migrateSchema();
    } catch (e) {
      console.warn('IndexedDB initialization failed. Images/Handles will fall back:', e.message);
      this.idbAvailable = false;
    }

    // sourceType property backfilling for legacy items
    let videosChanged = false;
    this.videos.forEach(v => {
      if (!v.sourceType) {
        v.sourceType = v.videoUrl ? 'url' : 'local-file';
        videosChanged = true;
      }
      if (!v.availabilityStatus) {
        v.availabilityStatus = 'available';
        videosChanged = true;
      }
    });
    if (videosChanged) {
      this._saveTable('videos', this.videos);
    }
  }

  _loadTable(key, defaults) {
    if (!this.storage) return defaults;
    try {
      const data = this.storage.getItem(`${this.prefix}${key}`);
      if (!data) {
        this.storage.setItem(`${this.prefix}${key}`, JSON.stringify(defaults));
        return defaults;
      }
      return JSON.parse(data);
    } catch (e) {
      console.error(`Failed to load localStorage table for ${key}:`, e);
      return defaults;
    }
  }

  _saveTable(key, data) {
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

    if (currentVersion === '2') {
      return;
    }

    console.log('Running IndexedDB image storage schema migration (v2)...');
    
    try {
      // 1. Migrate Videos thumbnails
      let videosChanged = false;
      for (const video of this.videos) {
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
      for (const note of this.timelineNotes) {
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
        this._saveTable('videos', this.videos);
      }
      if (notesChanged) {
        this._saveTable('timeline_notes', this.timelineNotes);
      }

      this.storage.setItem(versionKey, '2');
      console.log('Migration to IndexedDB completed successfully.');
    } catch (err) {
      console.error('IndexedDB image migration failed. Retaining original data:', err);
    }
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

    // 3. Mark matching videos as 'permission-required' or 'missing' (do NOT delete ratings)
    this.videos.forEach(v => {
      if (v.sourceType === 'directory' && v.directoryId === id) {
        v.availabilityStatus = 'permission-required';
        v.updatedAt = new Date().toISOString();
      }
    });
    this._saveTable('videos', this.videos);
    return true;
  }

  async updateDirectoryVideosAvailability(directoryId, availabilityStatus) {
    let changed = false;
    this.videos.forEach(v => {
      if (v.sourceType === 'directory' && v.directoryId === directoryId) {
        if (v.availabilityStatus !== availabilityStatus) {
          v.availabilityStatus = availabilityStatus;
          v.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
    });
    if (changed) {
      this._saveTable('videos', this.videos);
    }
  }

  // --- VIDEO OPERATIONS ---

  getVideos() {
    return this.videos;
  }

  getVideo(id) {
    return this.videos.find(v => v.id === id);
  }

  async addVideo({ title, fileName, fileSize, videoUrl, duration, thumbnailBlob, sourceType, directoryId, relativePath, lastModified }) {
    const sType = sourceType || (videoUrl ? 'url' : 'local-file');
    
    // Prevent duplicates based on SourceType
    let existing;
    if (sType === 'directory') {
      existing = this.videos.find(v => v.sourceType === 'directory' && v.directoryId === directoryId && v.relativePath === relativePath);
    } else if (sType === 'url') {
      existing = this.videos.find(v => v.sourceType === 'url' && v.videoUrl === videoUrl);
    } else {
      existing = this.videos.find(v => v.sourceType === 'local-file' && v.fileName === fileName && v.fileSize === fileSize);
    }

    if (existing) {
      return existing;
    }

    const id = 'vid-' + generateUUID();
    const video = {
      id,
      title: title || fileName || 'Untitled Video',
      fileName: fileName || '',
      fileSize: fileSize || 0,
      videoUrl: videoUrl || '',
      duration: duration || 0,
      thumbnailUrl: '',
      thumbnailId: '',
      sourceType: sType,
      directoryId: directoryId || null,
      relativePath: relativePath || null,
      lastModified: lastModified || 0,
      availabilityStatus: 'available',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (thumbnailBlob && this.idbAvailable) {
      try {
        const imgId = `img-vid-${id}`;
        await this.putImage(imgId, thumbnailBlob);
        video.thumbnailId = imgId;
      } catch (err) {
        console.error('Failed to save new video thumbnail to IndexedDB:', err);
      }
    }

    this.videos.push(video);
    this._saveTable('videos', this.videos);
    return video;
  }

  async updateVideo(id, updates) {
    const idx = this.videos.findIndex(v => v.id === id);
    if (idx !== -1) {
      this.videos[idx] = {
        ...this.videos[idx],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this._saveTable('videos', this.videos);
      return this.videos[idx];
    }
    return null;
  }

  async updateVideoThumbnail(videoId, thumbnailBlob) {
    const video = this.getVideo(videoId);
    if (!video) throw new Error('Video not found');

    if (thumbnailBlob && this.idbAvailable) {
      const imgId = `img-vid-${videoId}`;
      await this.putImage(imgId, thumbnailBlob);
      await this.updateVideo(videoId, { thumbnailId: imgId });
    }
  }
  async deleteVideoThumbnail(videoId) {
    const video = this.getVideo(videoId);
    if (!video) return;
    if (video.thumbnailId && this.idbAvailable) {
      try {
        await this.idb.delete(video.thumbnailId, 'images');
      } catch (err) {
        console.error('Failed to delete video thumbnail Blob:', err);
      }
    }
  }

  async deleteVideoCascade(videoId) {
    const video = this.getVideo(videoId);
    if (!video) return false;

    // 1. Delete image Blobs from IndexedDB
    if (this.idbAvailable) {
      // Delete Video Thumbnail
      if (video.thumbnailId) {
        try {
          await this.idb.delete(video.thumbnailId, 'images');
        } catch (err) {
          console.warn('Failed to delete video thumbnail image:', err);
        }
      }

      // Delete Timeline Note Screenshots
      const matchedNotes = this.timelineNotes.filter(n => n.videoId === videoId);
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

    // 2. Cascade delete records from tables
    this.videos = this.videos.filter(v => v.id !== videoId);
    this._saveTable('videos', this.videos);

    const reviewsToDelete = this.reviews.filter(r => r.videoId === videoId);
    const reviewIds = reviewsToDelete.map(r => r.id);

    this.reviews = this.reviews.filter(r => r.videoId !== videoId);
    this._saveTable('video_reviews', this.reviews);

    this.criterionRatings = this.criterionRatings.filter(cr => !reviewIds.includes(cr.reviewId));
    this._saveTable('criterion_ratings', this.criterionRatings);

    this.videoTags = this.videoTags.filter(vt => vt.videoId !== videoId);
    this._saveTable('video_tags', this.videoTags);

    this.timelineNotes = this.timelineNotes.filter(n => n.videoId !== videoId);
    this._saveTable('timeline_notes', this.timelineNotes);

    return true;
  }

  // --- CRITERIA OPERATIONS ---

  getCriteria() {
    return this.criteria.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  getActiveCriteria() {
    return this.getCriteria().filter(c => c.isActive);
  }

  async addCriterion(name) {
    const active = this.getActiveCriteria();
    if (active.length >= 6) {
      throw new Error('Maximum of 6 active criteria allowed.');
    }

    const maxOrder = this.criteria.reduce((max, c) => Math.max(max, c.displayOrder), 0);
    const crit = {
      id: 'crit-' + generateUUID(),
      name,
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

  getReviewForVideo(videoId) {
    return this.reviews.find(r => r.videoId === videoId);
  }

  getCriterionRatingsForReview(reviewId) {
    return this.criterionRatings.filter(cr => cr.videoReviewId === reviewId);
  }

  async saveReview(videoId, { overallGrade, comment, ratings }) {
    let review = this.getReviewForVideo(videoId);
    const now = new Date().toISOString();

    if (!review) {
      review = {
        id: 'rev-' + generateUUID(),
        videoId,
        overallGrade: overallGrade || null,
        comment: comment || '',
        createdAt: now,
        updatedAt: now
      };
      this.reviews.push(review);
    } else {
      review.overallGrade = overallGrade || null;
      review.comment = comment || '';
      review.updatedAt = now;
    }

    this._saveTable('video_reviews', this.reviews);

    this.criterionRatings = this.criterionRatings.filter(cr => cr.videoReviewId !== review.id);

    if (ratings && typeof ratings === 'object') {
      for (const [criterionId, score] of Object.entries(ratings)) {
        if (score !== null && score !== undefined) {
          this.criterionRatings.push({
            id: 'rate-' + generateUUID(),
            videoReviewId: review.id,
            criterionId,
            score: parseInt(score, 10),
            createdAt: now,
            updatedAt: now
          });
        }
      }
    }

    this._saveTable('criterion_ratings', this.criterionRatings);
    await this.updateVideo(videoId, {});

    return review;
  }

  // --- TAG OPERATIONS ---

  getTags() {
    return this.tags;
  }

  getVideoTags(videoId) {
    const associationIds = this.videoTags
      .filter(vt => vt.videoId === videoId)
      .map(vt => vt.tagId);
    return this.tags.filter(t => associationIds.includes(t.id));
  }

  async addTagToVideo(videoId, tagName) {
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

    const alreadyAssociated = this.videoTags.some(vt => vt.videoId === videoId && vt.tagId === tag.id);
    if (!alreadyAssociated) {
      this.videoTags.push({ videoId, tagId: tag.id });
      this._saveTable('video_tags', this.videoTags);
      await this.updateVideo(videoId, {});
    }

    return tag;
  }

  async removeTagFromVideo(videoId, tagId) {
    const initialLength = this.videoTags.length;
    this.videoTags = this.videoTags.filter(vt => !(vt.videoId === videoId && vt.tagId === tagId));
    if (this.videoTags.length !== initialLength) {
      this._saveTable('video_tags', this.videoTags);
      await this.updateVideo(videoId, {});
      return true;
    }
    return false;
  }

  // --- TIMELINE NOTES OPERATIONS ---

  getTimelineNotes(videoId) {
    const review = this.getReviewForVideo(videoId);
    if (!review) return [];
    
    return this.timelineNotes
      .filter(n => n.videoReviewId === review.id)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }

  async addTimelineNote(videoId, { timestampSeconds, timestampLabel, comment, thumbnailBlob }) {
    let review = this.getReviewForVideo(videoId);
    const now = new Date().toISOString();
    
    if (!review) {
      review = await this.saveReview(videoId, { overallGrade: null, comment: '', ratings: {} });
    }

    const noteId = 'note-' + generateUUID();
    const note = {
      id: noteId,
      videoReviewId: review.id,
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
    await this.updateVideo(videoId, {});
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
        await this.updateVideo(review.videoId, {});
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
      await this.updateVideo(review.videoId, {});
    }
    return true;
  }
}
