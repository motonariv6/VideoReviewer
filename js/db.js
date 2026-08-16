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
    this.videos = this._loadTable('videos', SAMPLE_VIDEOS);
    this.criteria = this._loadTable('rating_criteria', DEFAULT_CRITERIA);
    this.reviews = this._loadTable('video_reviews', []);
    this.criterionRatings = this._loadTable('criterion_ratings', []);
    this.tags = this._loadTable('tags', []);
    this.videoTags = this._loadTable('video_tags', []);
    this.timelineNotes = this._loadTable('timeline_notes', []);
    
    // Directory Sources table setup
    this.directorySources = this._loadTable('directory_sources', []);

    // Genres & templates tables
    this.genres = this._loadTable('genres', []);
    this.templates = this._loadTable('evaluation_templates', []);
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

    // Perform genre and template migrations
    this._migrateGenres();

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

  _migrateGenres() {
    if (!this.storage) return;

    // 2. Find or create default genre '一般'
    let defaultGenre = this.genres.find(g => g.id === 'genre-default' || g.isDefault);
    if (!defaultGenre) {
      defaultGenre = {
        id: 'genre-default',
        name: '一般',
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
        id: 'template-default',
        genreId: defaultGenre.id,
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

    // 5. Update existing videos to reference default genre if they have no genreId
    let videosChanged = false;
    this.videos.forEach(v => {
      if (!v.genreId) {
        v.genreId = defaultGenre.id;
        videosChanged = true;
      }
    });
    if (videosChanged) {
      this._saveTable('videos', this.videos);
    }

    // 6. Backfill existing ratings in criterion_ratings with snapshot fields
    let ratingsChanged = false;
    this.criterionRatings.forEach(cr => {
      if (!cr.genreId || !cr.criterionName) {
        const review = this.reviews.find(r => r.id === cr.videoReviewId);
        const videoId = review ? review.videoId : null;
        const video = videoId ? this.getVideo(videoId) : null;
        
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

    const reviewsToDelete = this.reviews.filter(r => r.videoId === videoId);
    const reviewIds = reviewsToDelete.map(r => r.id);

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
      const matchedNotes = this.timelineNotes.filter(n => n.videoId === videoId || reviewIds.includes(n.videoReviewId));
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

    this.reviews = this.reviews.filter(r => r.videoId !== videoId);
    this._saveTable('video_reviews', this.reviews);

    this.criterionRatings = this.criterionRatings.filter(cr => !reviewIds.includes(cr.videoReviewId));
    this._saveTable('criterion_ratings', this.criterionRatings);

    this.videoTags = this.videoTags.filter(vt => vt.videoId !== videoId);
    this._saveTable('video_tags', this.videoTags);

    this.timelineNotes = this.timelineNotes.filter(n => n.videoId !== videoId && !reviewIds.includes(n.videoReviewId));
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

    const video = this.getVideo(videoId);
    const genreId = video ? (video.genreId || 'genre-default') : 'genre-default';
    const genre = this.genres.find(g => g.id === genreId);
    const genreName = genre ? genre.name : '一般';

    if (ratings && typeof ratings === 'object') {
      for (const [criterionId, score] of Object.entries(ratings)) {
        if (score !== null && score !== undefined) {
          const criterion = this.criteria.find(c => c.id === criterionId);
          const criterionName = criterion ? criterion.name : '';

          this.criterionRatings.push({
            id: 'rate-' + generateUUID(),
            videoReviewId: review.id,
            criterionId,
            criterionName,
            genreId,
            genreName,
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

  _saveAll() {
    const prevAllow = this._allowSaveDuringRestore;
    this._allowSaveDuringRestore = true;
    try {
      this._saveTable('videos', this.videos);
      this._saveTable('rating_criteria', this.criteria);
      this._saveTable('video_reviews', this.reviews);
      this._saveTable('criterion_ratings', this.criterionRatings);
      this._saveTable('tags', this.tags);
      this._saveTable('video_tags', this.videoTags);
      this._saveTable('timeline_notes', this.timelineNotes);
      this._saveTable('directory_sources', this.directorySources);
      this._saveTable('genres', this.genres);
      this._saveTable('evaluation_templates', this.templates);
    } finally {
      this._allowSaveDuringRestore = prevAllow;
    }
  }

  // Production Backup integrity validator
  validateBackupData(parsedDb, manifest, imageIds = []) {
    const fatalErrors = [];
    const warnings = [];

    // 1. Verify manifest exists
    if (!manifest || typeof manifest !== 'object') {
      fatalErrors.push('マニフェストファイルがありません。');
    } else {
      // 2. Verify schemaVersion is exactly a supported integer
      if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion !== 1) {
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
        const reqCounts = ['videos', 'reviews', 'images'];
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

    // 6. Validate tables presence and types
    const tables = [
      'videos', 'rating_criteria', 'video_reviews', 'criterion_ratings',
      'tags', 'video_tags', 'timeline_notes', 'directory_sources',
      'genres', 'evaluation_templates'
    ];
    tables.forEach(t => {
      if (!parsedDb || !Array.isArray(parsedDb[t])) {
        fatalErrors.push(`データベーステーブル ${t} が見つからないか、フォーマットが不正です。`);
      }
    });

    if (fatalErrors.length === 0) {
      // 7. Match counts
      if (manifest.counts.videos !== parsedDb.videos.length) {
        fatalErrors.push('動画の件数がマニフェストのカウントと一致しません。');
      }
      if (manifest.counts.reviews !== parsedDb.video_reviews.length) {
        fatalErrors.push('レビューの件数がマニフェストのカウントと一致しません。');
      }
      if (manifest.counts.images !== imageIds.length) {
        fatalErrors.push('画像の件数がマニフェストのカウントと一致しません。');
      }
    }

    if (parsedDb && typeof parsedDb === 'object') {
      // 8. Validate structural existence in genres and templates
      if (Array.isArray(parsedDb.genres)) {
        parsedDb.genres.forEach(g => {
          if (!g.id || !g.name) {
            fatalErrors.push('ジャンルテーブル of レコードに不正なデータが含まれています。');
          }
        });
      }
      if (Array.isArray(parsedDb.evaluation_templates)) {
        parsedDb.evaluation_templates.forEach(t => {
          if (!t.id || !t.genreId) {
            fatalErrors.push('評価テンプレートのレコードに不正なデータが含まれています。');
          }
        });
      }

      // 9. Validate duplicate IDs within each table
      const tablesWithId = ['videos', 'rating_criteria', 'video_reviews', 'tags', 'timeline_notes', 'directory_sources', 'genres', 'evaluation_templates'];
      tablesWithId.forEach(t => {
        if (Array.isArray(parsedDb[t])) {
          const ids = new Set();
          parsedDb[t].forEach(item => {
            if (!item.id) {
              fatalErrors.push(`テーブル ${t} にIDのないレコードが存在します。`);
            } else {
              if (ids.has(item.id)) {
                fatalErrors.push(`テーブル ${t} に重複するID ${item.id} が検出されました。`);
              }
              ids.add(item.id);
            }
          });
        }
      });

      // 10. Validate criterion_ratings IDs are present and unique
      if (Array.isArray(parsedDb.criterion_ratings)) {
        const crIds = new Set();
        parsedDb.criterion_ratings.forEach(cr => {
          if (!cr.id) {
            fatalErrors.push('criterion_ratings のレコードに ID がありません。');
          } else {
            if (crIds.has(cr.id)) {
              fatalErrors.push(`criterion_ratings に重複する ID ${cr.id} が検出されました。`);
            }
            crIds.add(cr.id);
          }
        });
      }
    }

    // Inspect timeline notes and perform legacy repair/exclusion
    const keptTimelineNotes = [];
    if (parsedDb && Array.isArray(parsedDb.timeline_notes) && Array.isArray(parsedDb.video_reviews)) {
      parsedDb.timeline_notes.forEach(n => {
        const hasDirectReview = parsedDb.video_reviews.some(r => r.id === n.videoReviewId);
        if (hasDirectReview) {
          keptTimelineNotes.push(n);
        } else {
          // Attempt safe repair
          const matchingReviews = n.videoId ? parsedDb.video_reviews.filter(r => r.videoId === n.videoId) : [];
          if (matchingReviews.length === 1) {
            const targetReview = matchingReviews[0];
            const repairedNote = {
              ...n,
              videoReviewId: targetReview.id
            };
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

    // Recalculate required images set based only on kept/valid database objects
    const requiredImageIdsSet = new Set();
    if (parsedDb && Array.isArray(parsedDb.videos)) {
      parsedDb.videos.forEach(v => {
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
    if (parsedDb && fatalErrors.length === 0) {
      if (Array.isArray(parsedDb.video_reviews)) {
        parsedDb.video_reviews.forEach(r => {
          if (!parsedDb.videos.some(v => v.id === r.videoId)) {
            fatalErrors.push(`レビュー ${r.id} が参照する動画 ${r.videoId} が存在しません。`);
          }
        });
      }

      if (Array.isArray(parsedDb.criterion_ratings)) {
        parsedDb.criterion_ratings.forEach(cr => {
          if (!parsedDb.video_reviews.some(r => r.id === cr.videoReviewId)) {
            fatalErrors.push(`評価スコア ${cr.id} が参照するレビュー ${cr.videoReviewId} が存在しません。`);
          }
          if (!parsedDb.rating_criteria.some(c => c.id === cr.criterionId)) {
            fatalErrors.push(`評価スコア ${cr.id} が参照する評価項目 ${cr.criterionId} が存在しません。`);
          }
        });
      }

      if (Array.isArray(parsedDb.video_tags)) {
        parsedDb.video_tags.forEach(vt => {
          if (!parsedDb.videos.some(v => v.id === vt.videoId)) {
            fatalErrors.push(`タグ関連情報が参照する動画 ${vt.videoId} が存在しません。`);
          }
          if (!parsedDb.tags.some(t => t.id === vt.tagId)) {
            fatalErrors.push(`タグ関連情報が参照するタグ ${vt.tagId} が存在しません。`);
          }
        });
      }

      // Check referential integrity for kept notes
      keptTimelineNotes.forEach(n => {
        if (!parsedDb.video_reviews.some(r => r.id === n.videoReviewId)) {
          fatalErrors.push(`タイムラインメモ ${n.id} が参照するレビュー ${n.videoReviewId} が存在しません。`);
        }
      });

      if (Array.isArray(parsedDb.videos)) {
        parsedDb.videos.forEach(v => {
          if (v.genreId && !parsedDb.genres.some(g => g.id === v.genreId)) {
            fatalErrors.push(`動画 ${v.id} が参照するジャンル ${v.genreId} が存在しません。`);
          }
        });
      }

      if (Array.isArray(parsedDb.evaluation_templates)) {
        parsedDb.evaluation_templates.forEach(t => {
          if (!parsedDb.genres.some(g => g.id === t.genreId)) {
            fatalErrors.push(`テンプレート ${t.id} が参照するジャンル ${t.genreId} が存在しません。`);
          }
        });
      }

      if (Array.isArray(parsedDb.rating_criteria)) {
        parsedDb.rating_criteria.forEach(c => {
          if (!parsedDb.evaluation_templates.some(t => t.id === c.templateId)) {
            fatalErrors.push(`評価項目 ${c.id} が参照するテンプレート ${c.templateId} が存在しません。`);
          }
        });
      }
    }

    return {
      isValid: fatalErrors.length === 0,
      fatalErrors,
      warnings,
      repairedDb: {
        ...parsedDb,
        timeline_notes: keptTimelineNotes
      },
      requiredImageIds: Array.from(requiredImageIdsSet)
    };
  }

  // Production Restore execution method with full transaction rollback (memory, storage, IndexedDB)
  async restoreWithRollback(parsedDb, images) {
    // 1. Snapshot in-memory collections (deep copy)
    const inMemorySnapshot = {
      videos: JSON.parse(JSON.stringify(this.videos)),
      criteria: JSON.parse(JSON.stringify(this.criteria)),
      reviews: JSON.parse(JSON.stringify(this.reviews)),
      criterionRatings: JSON.parse(JSON.stringify(this.criterionRatings)),
      tags: JSON.parse(JSON.stringify(this.tags)),
      videoTags: JSON.parse(JSON.stringify(this.videoTags)),
      timelineNotes: JSON.parse(JSON.stringify(this.timelineNotes)),
      directorySources: JSON.parse(JSON.stringify(this.directorySources)),
      genres: JSON.parse(JSON.stringify(this.genres)),
      templates: JSON.parse(JSON.stringify(this.templates))
    };

    // 2. Snapshot original localStorage entries
    const originalLocalData = {};
    const localKeys = [
      'videos', 'rating_criteria', 'video_reviews', 'criterion_ratings',
      'tags', 'video_tags', 'timeline_notes', 'directory_sources',
      'genres', 'evaluation_templates'
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

      // 4b. Assign parsedDb values to in-memory collections
      this.videos = parsedDb.videos;
      this.criteria = parsedDb.rating_criteria;
      this.reviews = parsedDb.video_reviews;
      this.criterionRatings = parsedDb.criterion_ratings;
      this.tags = parsedDb.tags;
      this.videoTags = parsedDb.video_tags;
      this.timelineNotes = parsedDb.timeline_notes;

      // Reconcile directory sources with existing DirectoryHandles in IndexedDB
      const reconciledSources = [];
      if (Array.isArray(parsedDb.directory_sources)) {
        for (const src of parsedDb.directory_sources) {
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

      this.genres = parsedDb.genres;
      this.templates = parsedDb.evaluation_templates;

      // 4c. Persist all tables to storage
      this._saveAll();

      this._inRestoreTransaction = false;
      return true;
    } catch (err) {
      console.error('Error during write phase, triggering rollback:', err);

      // 5. Rollback everything
      // 5a. Rollback in-memory properties
      this.videos = inMemorySnapshot.videos;
      this.criteria = inMemorySnapshot.criteria;
      this.reviews = inMemorySnapshot.reviews;
      this.criterionRatings = inMemorySnapshot.criterionRatings;
      this.tags = inMemorySnapshot.tags;
      this.videoTags = inMemorySnapshot.videoTags;
      this.timelineNotes = inMemorySnapshot.timelineNotes;
      this.directorySources = inMemorySnapshot.directorySources;
      this.genres = inMemorySnapshot.genres;
      this.templates = inMemorySnapshot.templates;

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
      displayOrder: maxOrder + 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.genres.push(genre);
    this._saveTable('genres', this.genres);

    const templateId = 'template-' + generateUUID();
    const template = {
      id: templateId,
      genreId: genreId,
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

  async addCriterionToGenre(genreId, name) {
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
        displayOrder: index + 1,
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
    });

    this._saveTable('rating_criteria', this.criteria);
  }

  getCriteriaForVideoReview(videoId) {
    const video = this.getVideo(videoId);
    if (!video) return [];
    
    const genreId = video.genreId || 'genre-default';
    const template = this.templates.find(t => t.genreId === genreId);
    const templateId = template ? template.id : null;
    
    const active = this.criteria.filter(c => c.templateId === templateId && c.isActive);
    const review = this.getReviewForVideo(videoId);
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
      this.videos.forEach(v => {
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
