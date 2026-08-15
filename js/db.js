/**
 * Database abstraction layer using localStorage.
 * Implements a relational data schema for video reviews, ratings, tags, and timeline notes.
 */

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

// Sample Videos to make the app ready to run immediately
const SAMPLE_VIDEOS = [
  {
    id: 'vid-sample-bunny',
    title: 'Big Buck Bunny (Sample)',
    fileName: 'big_buck_bunny.mp4',
    fileSize: 5510872,
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    duration: 596,
    thumbnailUrl: '',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export class AppDatabase {
  constructor() {
    this.initDatabase();
  }

  // Load from localStorage or initialize with default structure
  initDatabase() {
    this.videos = this._loadTable('videos', SAMPLE_VIDEOS);
    this.criteria = this._loadTable('rating_criteria', DEFAULT_CRITERIA);
    this.reviews = this._loadTable('video_reviews', []);
    this.criterionRatings = this._loadTable('criterion_ratings', []);
    this.tags = this._loadTable('tags', []);
    this.videoTags = this._loadTable('video_tags', []);
    this.timelineNotes = this._loadTable('timeline_notes', []);
  }

  _loadTable(key, defaults) {
    try {
      const data = localStorage.getItem(`vreview_${key}`);
      if (!data) {
        localStorage.setItem(`vreview_${key}`, JSON.stringify(defaults));
        return defaults;
      }
      return JSON.parse(data);
    } catch (e) {
      console.error(`Failed to load localStorage table for ${key}:`, e);
      return defaults;
    }
  }

  _saveTable(key, data) {
    try {
      localStorage.setItem(`vreview_${key}`, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to save localStorage table for ${key}:`, e);
    }
  }

  // --- VIDEO OPERATIONS ---

  getVideos() {
    return this.videos;
  }

  getVideo(id) {
    return this.videos.find(v => v.id === id);
  }

  addVideo({ title, fileName, fileSize, videoUrl, duration, thumbnailUrl }) {
    // Prevent duplicates by checking fileName and fileSize
    let existing = this.videos.find(v => v.fileName === fileName && v.fileSize === fileSize);
    if (existing) {
      return existing;
    }

    const video = {
      id: 'vid-' + generateUUID(),
      title: title || fileName || 'Untitled Video',
      fileName: fileName || '',
      fileSize: fileSize || 0,
      videoUrl: videoUrl || '',
      duration: duration || 0,
      thumbnailUrl: thumbnailUrl || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.videos.push(video);
    this._saveTable('videos', this.videos);
    return video;
  }

  updateVideo(id, updates) {
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

  // --- CRITERIA OPERATIONS ---

  getCriteria() {
    return this.criteria.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  getActiveCriteria() {
    return this.getCriteria().filter(c => c.isActive);
  }

  addCriterion(name) {
    const active = this.getActiveCriteria();
    if (active.length >= 6) {
      throw new Error('Maximum of 6 active criteria allowed.');
    }

    // Determine displayOrder
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

  updateCriterion(id, updates) {
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

  reorderCriteria(orderedIds) {
    this.criteria.forEach(c => {
      const idx = orderedIds.indexOf(c.id);
      if (idx !== -1) {
        c.displayOrder = idx + 1;
        c.updatedAt = new Date().toISOString();
      }
    });
    this._saveTable('rating_criteria', this.criteria);
  }

  deleteCriterion(id) {
    // Soft delete: set isActive to false to preserve historical scores
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

  saveReview(videoId, { overallGrade, comment, ratings }) {
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

    // Save individual criteria ratings
    // First clear old ratings for this review to prevent accumulation
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

    // Also update the video updatedAt field
    this.updateVideo(videoId, {});

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

  addTagToVideo(videoId, tagName) {
    const cleanedName = tagName.trim();
    if (!cleanedName) return null;

    const normalized = cleanedName.toLowerCase();
    
    // Check if tag already exists in master list
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

    // Check if video already has this tag
    const alreadyAssociated = this.videoTags.some(vt => vt.videoId === videoId && vt.tagId === tag.id);
    if (!alreadyAssociated) {
      this.videoTags.push({ videoId, tagId: tag.id });
      this._saveTable('video_tags', this.videoTags);
      
      // Update video timestamp
      this.updateVideo(videoId, {});
    }

    return tag;
  }

  removeTagFromVideo(videoId, tagId) {
    const initialLength = this.videoTags.length;
    this.videoTags = this.videoTags.filter(vt => !(vt.videoId === videoId && vt.tagId === tagId));
    if (this.videoTags.length !== initialLength) {
      this._saveTable('video_tags', this.videoTags);
      this.updateVideo(videoId, {});
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

  addTimelineNote(videoId, { timestampSeconds, timestampLabel, comment, thumbnailUrl }) {
    let review = this.getReviewForVideo(videoId);
    const now = new Date().toISOString();
    
    if (!review) {
      // Create a review container if one doesn't exist
      review = this.saveReview(videoId, { overallGrade: null, comment: '', ratings: {} });
    }

    const note = {
      id: 'note-' + generateUUID(),
      videoReviewId: review.id,
      timestampSeconds: parseFloat(timestampSeconds),
      timestampLabel: timestampLabel || '00:00',
      comment: comment || '',
      thumbnailUrl: thumbnailUrl || '',
      createdAt: now,
      updatedAt: now
    };

    this.timelineNotes.push(note);
    this._saveTable('timeline_notes', this.timelineNotes);
    this.updateVideo(videoId, {});
    return note;
  }

  updateTimelineNote(noteId, updates) {
    const idx = this.timelineNotes.findIndex(n => n.id === noteId);
    if (idx !== -1) {
      this.timelineNotes[idx] = {
        ...this.timelineNotes[idx],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this._saveTable('timeline_notes', this.timelineNotes);
      
      // Update the parent video timestamp
      const review = this.reviews.find(r => r.id === this.timelineNotes[idx].videoReviewId);
      if (review) {
        this.updateVideo(review.videoId, {});
      }
      return this.timelineNotes[idx];
    }
    return null;
  }

  deleteTimelineNote(noteId) {
    const note = this.timelineNotes.find(n => n.id === noteId);
    if (!note) return false;

    this.timelineNotes = this.timelineNotes.filter(n => n.id !== noteId);
    this._saveTable('timeline_notes', this.timelineNotes);

    const review = this.reviews.find(r => r.id === note.videoReviewId);
    if (review) {
      this.updateVideo(review.videoId, {});
    }
    return true;
  }
}
