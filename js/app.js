import { AppDatabase } from './db.js';
import { formatTime, parseTime, generateFileSignature, captureVideoFrame } from './video-helper.js';
import { RadarChart } from './radar.js';
import { runTests } from './tests.js';

// Instantiate DB & components
const db = new AppDatabase();
let radar;

// Run automated tests in dev console
runTests();

// Application State
const state = {
  currentView: 'library', // 'library' | 'editor'
  currentVideoId: null,
  activeVideoFile: null,      // For currently playing local video
  videoFilesMap: new Map(),   // videoId -> File object cache for session
  currentRatings: {},         // criterionId -> score (1-5)
  currentOverallGrade: null,  // 'A'..'E' | null
  isDirty: false,
  capturedNoteTime: 0,
  capturedNoteThumb: '',      // Base64 thumbnail data URL
  
  // Filter & Sort state for library
  filters: {
    search: '',
    tagId: '',
    overallGrade: '',
    status: '', // 'rated' | 'unrated'
    sort: 'updatedAt-desc'
  }
};

// UI Elements
const els = {
  // Screens
  viewLibrary: document.getElementById('view-library'),
  viewEditor: document.getElementById('view-editor'),
  
  // Header controls
  btnBack: document.getElementById('header-btn-library'),
  btnSettings: document.getElementById('header-btn-settings'),
  
  // Library components
  videoGrid: document.getElementById('video-grid'),
  libraryEmpty: document.getElementById('library-empty'),
  filterSearch: document.getElementById('filter-search'),
  filterTag: document.getElementById('filter-tag'),
  filterGrade: document.getElementById('filter-grade'),
  filterStatus: document.getElementById('filter-review-status'),
  filterSort: document.getElementById('filter-sort'),
  addLocalFileInput: document.getElementById('library-add-file'),
  btnAddUrlModal: document.getElementById('btn-add-url-modal'),
  
  // Add URL Modal
  modalAddUrl: document.getElementById('modal-add-url'),
  addUrlCloseX: document.getElementById('add-url-close-x'),
  urlTitleInput: document.getElementById('url-title-input'),
  urlPathInput: document.getElementById('url-path-input'),
  urlDurationInput: document.getElementById('url-duration-input'),
  btnAddUrlSubmit: document.getElementById('btn-add-url-submit'),
  
  // Editor Header
  editorBack: document.getElementById('editor-btn-back'),
  editorTitle: document.getElementById('editor-video-title'),
  btnPrevVideo: document.getElementById('player-btn-prev'),
  btnNextVideo: document.getElementById('player-btn-next'),
  
  // Video Player elements
  video: document.getElementById('video-element'),
  reconnectCard: document.getElementById('local-file-required-warning'),
  reconnectFileInput: document.getElementById('player-reconnect-file'),
  warningFileName: document.getElementById('warning-file-name'),
  
  // Custom Controls
  progressBar: document.getElementById('player-progress-bar'),
  progressLoad: document.getElementById('player-progress-load'),
  progressFill: document.getElementById('player-progress-fill'),
  progressHandle: document.getElementById('player-progress-handle'),
  btnPlay: document.getElementById('player-btn-play'),
  playIcon: document.getElementById('play-icon'),
  pauseIcon: document.getElementById('pause-icon'),
  btnMute: document.getElementById('player-btn-mute'),
  muteIconOff: document.getElementById('mute-icon-off'),
  muteIconOn: document.getElementById('mute-icon-on'),
  volumeSlider: document.getElementById('player-volume-slider'),
  timeCurrent: document.getElementById('player-time-current'),
  timeTotal: document.getElementById('player-time-total'),
  btnFullscreen: document.getElementById('player-btn-fullscreen'),
  
  // File details
  infoFileName: document.getElementById('info-file-name'),
  infoFileSize: document.getElementById('info-file-size'),
  infoDuration: document.getElementById('info-duration'),
  
  // Review inputs
  gradeButtons: document.querySelectorAll('.grade-btn[data-grade]'),
  btnClearGrade: document.getElementById('btn-grade-clear'),
  criteriaPanel: document.getElementById('criteria-ratings-panel'),
  tagInputField: document.getElementById('tag-input-field'),
  tagsChipsList: document.getElementById('tags-chips-list'),
  tagAutocomplete: document.getElementById('tag-autocomplete-dropdown'),
  commentEditor: document.getElementById('comment-editor'),
  
  // Timeline editor
  capturedTimestampLabel: document.getElementById('captured-timestamp-label'),
  btnTimelineCapture: document.getElementById('btn-timeline-capture'),
  timelineCommentField: document.getElementById('timeline-comment-field'),
  btnTimelineAddNote: document.getElementById('btn-timeline-add-note'),
  timelineNotesList: document.getElementById('timeline-notes-list'),
  
  // Save Review Bar
  btnSaveReview: document.getElementById('editor-btn-save'),
  autosaveIndicator: document.getElementById('autosave-indicator'),
  
  // Settings Modal
  modalSettings: document.getElementById('modal-settings'),
  settingsCloseX: document.getElementById('settings-close-x'),
  settingsCriteriaList: document.getElementById('settings-criteria-list'),
  settingsNewNameInput: document.getElementById('settings-new-name-input'),
  settingsBtnAdd: document.getElementById('settings-btn-add'),
  settingsBtnSave: document.getElementById('settings-btn-save'),
  
  // Toast notifications
  toastContainer: document.getElementById('toast-container')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  radar = new RadarChart(document.getElementById('radar-chart-container'));
  
  initEventListeners();
  initAutosaveTimer();
  renderLibrary();
});

// Setup event bindings
function initEventListeners() {
  // Navigation & Screen switching
  els.btnBack.addEventListener('click', () => handleBackToLibrary());
  els.editorBack.addEventListener('click', () => handleBackToLibrary());
  
  // Add Media
  els.addLocalFileInput.addEventListener('change', handleAddLocalFile);
  els.reconnectFileInput.addEventListener('change', handleReconnectFile);
  els.btnAddUrlModal.addEventListener('click', () => openModal(els.modalAddUrl));
  els.addUrlCloseX.addEventListener('click', () => closeModal(els.modalAddUrl));
  els.btnAddUrlSubmit.addEventListener('click', handleAddUrlSubmit);
  
  // Library filters
  els.filterSearch.addEventListener('input', () => {
    state.filters.search = els.filterSearch.value;
    renderLibrary();
  });
  els.filterTag.addEventListener('change', () => {
    state.filters.tagId = els.filterTag.value;
    renderLibrary();
  });
  els.filterGrade.addEventListener('change', () => {
    state.filters.overallGrade = els.filterGrade.value;
    renderLibrary();
  });
  els.filterStatus.addEventListener('change', () => {
    state.filters.status = els.filterStatus.value;
    renderLibrary();
  });
  els.filterSort.addEventListener('change', () => {
    state.filters.sort = els.filterSort.value;
    renderLibrary();
  });
  
  // Settings triggers
  els.btnSettings.addEventListener('click', openSettingsModal);
  els.settingsCloseX.addEventListener('click', closeSettingsModal);
  els.settingsBtnAdd.addEventListener('click', handleSettingsAddCriterion);
  els.settingsBtnSave.addEventListener('click', closeSettingsModal);

  // Next / Prev Video buttons
  els.btnPrevVideo.addEventListener('click', () => navigateAdjacentVideo(-1));
  els.btnNextVideo.addEventListener('click', () => navigateAdjacentVideo(1));
  
  // Video element controls
  els.video.addEventListener('click', togglePlay);
  els.btnPlay.addEventListener('click', togglePlay);
  els.btnMute.addEventListener('click', toggleMute);
  els.volumeSlider.addEventListener('input', handleVolumeSlider);
  els.video.addEventListener('timeupdate', handleTimeUpdate);
  els.video.addEventListener('durationchange', () => {
    els.timeTotal.textContent = formatTime(els.video.duration);
  });
  els.btnFullscreen.addEventListener('click', toggleFullscreen);
  
  // Progress bar seeking
  els.progressBar.addEventListener('click', handleProgressSeek);
  
  // Keyboard Shortcuts Handler
  window.addEventListener('keydown', handleKeyboardShortcuts);
  
  // Grade Ratings A-E Selector
  els.gradeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      els.gradeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentOverallGrade = btn.getAttribute('data-grade');
      markDirty();
      updateRadar();
    });
  });
  els.btnClearGrade.addEventListener('click', () => {
    els.gradeButtons.forEach(b => b.classList.remove('active'));
    state.currentOverallGrade = null;
    markDirty();
    updateRadar();
  });
  
  // Tags Input
  els.tagInputField.addEventListener('keydown', handleTagInputKeydown);
  els.tagInputField.addEventListener('input', handleTagInputAutocomplete);
  document.addEventListener('click', (e) => {
    if (!els.tagInputField.contains(e.target) && !els.tagAutocomplete.contains(e.target)) {
      els.tagAutocomplete.classList.add('hidden');
    }
  });
  
  // Comments and ratings changes mark dirty
  els.commentEditor.addEventListener('input', markDirty);
  
  // Timeline capturing & adding
  els.btnTimelineCapture.addEventListener('click', captureTimelineTimestamp);
  els.btnTimelineAddNote.addEventListener('click', addTimelineNote);
  els.timelineCommentField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTimelineNote();
    }
  });
  
  // Manual Save button
  els.btnSaveReview.addEventListener('click', saveReviewForm);
}

// Show/Hide Modals
function openModal(modal) {
  modal.classList.add('open');
}

function closeModal(modal) {
  modal.classList.remove('open');
}

// Display Toast Notifications
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
  `;
  els.toastContainer.appendChild(toast);
  
  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'none'; // Clear animation to prepare fade out or remove
    toast.remove();
  }, 3000);
}

// Dirty state tracking (to prompt if leaving unsaved items)
function markDirty() {
  state.isDirty = true;
  els.autosaveIndicator.textContent = '未保存の変更があります';
  els.autosaveIndicator.style.color = 'var(--color-warning)';
}

function clearDirty() {
  state.isDirty = false;
  els.autosaveIndicator.textContent = '自動保存: 有効';
  els.autosaveIndicator.style.color = 'var(--color-text-dim)';
}

// Periodical Autosave loop
function initAutosaveTimer() {
  setInterval(() => {
    if (state.currentVideoId && state.isDirty && state.currentView === 'editor') {
      saveReviewForm(true); // silent autosave
    }
  }, 5000);
}

// Navigate Screen: Library
function renderLibrary() {
  // Populate Tags list in filter select
  const oldVal = els.filterTag.value;
  els.filterTag.innerHTML = '<option value="">すべて</option>';
  db.getTags().forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag.id;
    opt.textContent = tag.name;
    els.filterTag.appendChild(opt);
  });
  els.filterTag.value = oldVal;

  let videos = db.getVideos();

  // 1. Text Search Filter
  if (state.filters.search) {
    const query = state.filters.search.toLowerCase();
    videos = videos.filter(v => v.title.toLowerCase().includes(query) || v.fileName.toLowerCase().includes(query));
  }

  // 2. Tag Filter
  if (state.filters.tagId) {
    const tagAssoc = db.videoTags.filter(vt => vt.tagId === state.filters.tagId).map(vt => vt.videoId);
    videos = videos.filter(v => tagAssoc.includes(v.id));
  }

  // 3. Overall Grade Filter
  if (state.filters.overallGrade) {
    videos = videos.filter(v => {
      const review = db.getReviewForVideo(v.id);
      if (state.filters.overallGrade === 'unrated') {
        return !review || !review.overallGrade;
      }
      return review && review.overallGrade === state.filters.overallGrade;
    });
  }

  // 4. Status Filter (rated/unrated)
  if (state.filters.status) {
    videos = videos.filter(v => {
      const review = db.getReviewForVideo(v.id);
      const ratings = review ? db.getCriterionRatingsForReview(review.id) : [];
      const hasRating = review && (review.overallGrade || review.comment || ratings.length > 0);
      
      return state.filters.status === 'rated' ? hasRating : !hasRating;
    });
  }

  // 5. Sort Videos
  videos.sort((a, b) => {
    const rA = db.getReviewForVideo(a.id);
    const rB = db.getReviewForVideo(b.id);
    
    // Sort logic helper for dates
    const getUpdateSecs = (video, review) => {
      const dates = [video.updatedAt];
      if (review) dates.push(review.updatedAt);
      const notes = db.getTimelineNotes(video.id);
      if (notes.length > 0) dates.push(notes[notes.length - 1].updatedAt);
      return Math.max(...dates.map(d => new Date(d).getTime()));
    };

    if (state.filters.sort === 'updatedAt-desc') {
      return getUpdateSecs(b, rB) - getUpdateSecs(a, rA);
    } else if (state.filters.sort === 'updatedAt-asc') {
      return getUpdateSecs(a, rA) - getUpdateSecs(b, rB);
    } else if (state.filters.sort === 'title-asc') {
      return a.title.localeCompare(b.title, 'ja');
    } else if (state.filters.sort === 'grade-desc') {
      const gradeVal = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1, null: 0, undefined: 0 };
      const valA = gradeVal[rA?.overallGrade];
      const valB = gradeVal[rB?.overallGrade];
      return valB - valA;
    } else if (state.filters.sort === 'avgRating-desc') {
      const getAvg = (review) => {
        if (!review) return 0;
        const scores = db.getCriterionRatingsForReview(review.id);
        if (scores.length === 0) return 0;
        return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
      };
      return getAvg(rB) - getAvg(rA);
    }
    return 0;
  });

  // Render Grid Cards
  els.videoGrid.innerHTML = '';
  if (videos.length === 0) {
    els.libraryEmpty.classList.remove('hidden');
  } else {
    els.libraryEmpty.classList.add('hidden');
    
    videos.forEach(v => {
      const review = db.getReviewForVideo(v.id);
      const starScores = review ? db.getCriterionRatingsForReview(review.id) : [];
      const tags = db.getVideoTags(v.id);
      const notes = db.getTimelineNotes(v.id);
      
      // Calculate rating average
      let avgText = '未評価';
      let avgScore = 0;
      if (starScores.length > 0) {
        avgScore = starScores.reduce((sum, s) => sum + s.score, 0) / starScores.length;
        avgText = avgScore.toFixed(1);
      }

      // Format date
      const lastUpdatedDate = new Date(v.updatedAt).toLocaleDateString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const card = document.createElement('article');
      card.className = 'glass-card video-card';
      card.addEventListener('click', () => switchScreenToEditor(v.id));

      // Build overall grade badge HTML if rated
      let gradeBadgeHtml = '';
      if (review && review.overallGrade) {
        gradeBadgeHtml = `<span class="video-card-badge" style="background-color:var(--color-grade-${review.overallGrade.toLowerCase()})">総合: ${review.overallGrade}</span>`;
      }

      // Stars rating HTML
      let starsHtml = '';
      const roundedStars = Math.round(avgScore);
      for (let i = 1; i <= 5; i++) {
        const starClass = i <= roundedStars ? 'active' : '';
        starsHtml += `<svg class="star-elem ${starClass}" style="width:14px;height:14px" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>`;
      }

      // Thumbnail Image Source
      const thumbSrc = v.thumbnailUrl || '';
      const thumbContentHtml = thumbSrc 
        ? `<img src="${thumbSrc}" alt="${v.title}">` 
        : `<svg class="placeholder-video-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>`;

      card.innerHTML = `
        <div class="video-card-thumb">
          ${thumbContentHtml}
          ${gradeBadgeHtml}
          <span class="video-card-duration">${formatTime(v.duration)}</span>
        </div>
        <div class="video-card-body">
          <h4 class="video-card-title" title="${v.title}">${v.title}</h4>
          <div class="video-card-rating-row">
            <span style="color:var(--color-text-muted)">平均: ${avgText}</span>
            <div class="video-card-avg-stars">${starsHtml}</div>
          </div>
          <div class="video-card-tags">
            ${tags.length > 0 
              ? tags.slice(0, 3).map(t => `<span class="tag-badge">${t.name}</span>`).join('') 
              : '<span class="tag-badge" style="border:dashed 1px var(--color-border);background:transparent">タグ無し</span>'}
            ${tags.length > 3 ? `<span class="tag-badge">+${tags.length - 3}</span>` : ''}
          </div>
          <div class="video-card-stats">
            <div class="stat-item" title="タイムラインメモ数">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>${notes.length}</span>
            </div>
            <div class="stat-item" title="総コメント">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>${review && review.comment ? 1 : 0}</span>
            </div>
            <div style="margin-left:auto;font-size:0.6875rem;color:var(--color-text-dim)" title="最終更新日時">
              ${lastUpdatedDate}
            </div>
          </div>
        </div>
      `;
      els.videoGrid.appendChild(card);
    });
  }
}

// Back to Library screen
function handleBackToLibrary() {
  if (state.isDirty) {
    if (!confirm('保存されていない変更があります。ライブラリに戻りますか？')) {
      return;
    }
  }
  
  // Pause video playing
  els.video.pause();
  state.currentVideoId = null;
  state.activeVideoFile = null;
  
  state.currentView = 'library';
  els.viewLibrary.classList.remove('hidden');
  els.viewEditor.classList.add('hidden');
  els.btnBack.classList.add('hidden');
  
  clearDirty();
  renderLibrary();
}

// Switch Screen: Editor Workspace
function switchScreenToEditor(videoId) {
  const video = db.getVideo(videoId);
  if (!video) return;

  state.currentVideoId = videoId;
  state.currentView = 'editor';
  els.viewLibrary.classList.add('hidden');
  els.viewEditor.classList.remove('hidden');
  els.btnBack.classList.remove('hidden');

  // Set header details
  els.editorTitle.textContent = video.title;
  els.infoFileName.textContent = video.fileName || 'URL動画';
  els.infoFileSize.textContent = video.fileSize ? (video.fileSize / 1024 / 1024).toFixed(1) + ' MB' : '-';
  els.infoDuration.textContent = formatTime(video.duration);

  // Load ratings content
  const review = db.getReviewForVideo(videoId);
  
  // Load overall grade button state
  els.gradeButtons.forEach(btn => btn.classList.remove('active'));
  state.currentOverallGrade = review ? review.overallGrade : null;
  if (state.currentOverallGrade) {
    const activeBtn = document.querySelector(`.grade-btn[data-grade="${state.currentOverallGrade}"]`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  // Load individual ratings stars map
  const scores = review ? db.getCriterionRatingsForReview(review.id) : [];
  state.currentRatings = {};
  scores.forEach(s => {
    state.currentRatings[s.criterionId] = s.score;
  });

  // Render individual star lists
  renderStarCriteriaPanel();
  
  // Load comment
  els.commentEditor.value = review ? review.comment : '';

  // Render tags
  renderVideoTagsList();

  // Render timeline notes
  renderTimelineNotesList();
  
  // Initialize dynamic captured timestamp label
  state.capturedNoteTime = 0;
  state.capturedNoteThumb = '';
  els.capturedTimestampLabel.textContent = '[00:00]';
  els.timelineCommentField.value = '';

  // Draw chart
  updateRadar();

  // Load media source in player
  loadVideoMediaSource(video);
  
  clearDirty();
}

// Load Video File / Url into HTML5 Video player
function loadVideoMediaSource(video) {
  els.video.removeAttribute('src');
  els.video.load();
  els.reconnectCard.classList.add('hidden');

  const isLocal = video.id.startsWith('local-') || video.fileName !== '';
  
  if (isLocal) {
    // Check if we have file cached in memory
    const file = state.videoFilesMap.get(video.id);
    if (file) {
      state.activeVideoFile = file;
      els.video.src = URL.createObjectURL(file);
      els.video.load();
    } else {
      // Reconnect required
      state.activeVideoFile = null;
      els.warningFileName.textContent = video.fileName;
      els.reconnectCard.classList.remove('hidden');
    }
  } else {
    // Online MP4 Link
    els.video.src = video.videoUrl;
    els.video.load();
  }

  // Play Pause UI state reset
  els.playIcon.classList.remove('hidden');
  els.pauseIcon.classList.add('hidden');
}

// Add Local Video File (from File input in Library)
function handleAddLocalFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const signature = generateFileSignature(file);
  
  // Create an offscreen video elements to pull duration
  const tempVideo = document.createElement('video');
  tempVideo.preload = 'metadata';
  tempVideo.src = URL.createObjectURL(file);
  
  tempVideo.onloadedmetadata = () => {
    const duration = tempVideo.duration || 0;
    
    // Add to DB
    const added = db.addVideo({
      title: file.name,
      fileName: file.name,
      fileSize: file.size,
      videoUrl: '',
      duration: duration,
      thumbnailUrl: '' // Captured first frame on editor load
    });

    // Save File context mapping in session
    state.videoFilesMap.set(added.id, file);

    // Reset input
    els.addLocalFileInput.value = '';

    // Route straight to editor workspace
    switchScreenToEditor(added.id);
    showToast('動画を追加しました');
  };
  
  tempVideo.onerror = () => {
    // Fallback if metadata fails to load
    const added = db.addVideo({
      title: file.name,
      fileName: file.name,
      fileSize: file.size,
      videoUrl: '',
      duration: 0,
      thumbnailUrl: ''
    });
    state.videoFilesMap.set(added.id, file);
    els.addLocalFileInput.value = '';
    switchScreenToEditor(added.id);
    showToast('動画を追加しました(再生時間未取得)');
  };
}

// Reconnect file to play again (Local Video sandbox reload)
function handleReconnectFile(e) {
  const file = e.target.files[0];
  if (!file || !state.currentVideoId) return;

  const video = db.getVideo(state.currentVideoId);
  if (!video) return;

  // Save mapping
  state.videoFilesMap.set(video.id, file);
  state.activeVideoFile = file;

  // Re-establish playback source
  els.video.src = URL.createObjectURL(file);
  els.video.load();
  els.reconnectCard.classList.add('hidden');

  // Reset file selector
  els.reconnectFileInput.value = '';

  // Snatch thumbnail async if video doesn't have one
  if (!video.thumbnailUrl) {
    els.video.addEventListener('loadeddata', async function grabFirstFrame() {
      const thumb = await captureVideoFrame(els.video);
      if (thumb) {
        db.updateVideo(video.id, { thumbnailUrl: thumb });
      }
      els.video.removeEventListener('loadeddata', grabFirstFrame);
    }, { once: true });
  }

  showToast('動画ファイルを再接続しました');
}

// Add Online Video URL
function handleAddUrlSubmit() {
  const title = els.urlTitleInput.value.trim();
  const url = els.urlPathInput.value.trim();
  const duration = parseInt(els.urlDurationInput.value, 10) || 0;

  if (!url) {
    showToast('動画のURLアドレスを入力してください', 'error');
    return;
  }

  const added = db.addVideo({
    title: title || 'URL動画プロジェクト',
    fileName: '',
    fileSize: 0,
    videoUrl: url,
    duration: duration,
    thumbnailUrl: ''
  });

  // Clear modal inputs
  els.urlTitleInput.value = '';
  els.urlPathInput.value = '';
  els.urlDurationInput.value = '';
  
  closeModal(els.modalAddUrl);
  
  // Route to review
  switchScreenToEditor(added.id);
  showToast('URL動画を追加しました');
}

// Navigate Adjacent Video (Prev / Next) in currently filtered library index list
function navigateAdjacentVideo(direction) {
  // Pull current active IDs in filtered sequence from library
  // (We use a simplified list from library filters)
  let videos = db.getVideos();
  if (state.filters.search) {
    const query = state.filters.search.toLowerCase();
    videos = videos.filter(v => v.title.toLowerCase().includes(query) || v.fileName.toLowerCase().includes(query));
  }
  if (state.filters.tagId) {
    const tagAssoc = db.videoTags.filter(vt => vt.tagId === state.filters.tagId).map(vt => vt.videoId);
    videos = videos.filter(v => tagAssoc.includes(v.id));
  }
  if (state.filters.overallGrade) {
    videos = videos.filter(v => {
      const review = db.getReviewForVideo(v.id);
      return review && review.overallGrade === state.filters.overallGrade;
    });
  }

  const currentIdx = videos.findIndex(v => v.id === state.currentVideoId);
  if (currentIdx === -1) return;

  const targetIdx = currentIdx + direction;
  if (targetIdx < 0 || targetIdx >= videos.length) {
    showToast('隣の動画はありません', 'error');
    return;
  }

  if (state.isDirty) {
    if (!confirm('保存されていない評価内容があります。隣の動画に移動しますか？')) {
      return;
    }
  }

  els.video.pause();
  switchScreenToEditor(videos[targetIdx].id);
}

// Individual Criteria Stars panel binding & drawing
function renderStarCriteriaPanel() {
  const activeCriteria = db.getActiveCriteria();
  els.criteriaPanel.innerHTML = '';
  
  if (activeCriteria.length === 0) {
    els.criteriaPanel.innerHTML = `
      <p style="font-size:0.8125rem;color:var(--color-text-dim);text-align:center;padding:12px">
        有効な評価項目が登録されていません。「評価項目設定」から項目を追加してください。
      </p>
    `;
    return;
  }

  activeCriteria.forEach(crit => {
    const currentScore = state.currentRatings[crit.id] || 0;

    const row = document.createElement('div');
    row.className = 'star-rating-row';

    // Stars rating items
    let starsMarkup = '';
    for (let s = 1; s <= 5; s++) {
      const activeClass = s <= currentScore ? 'active' : '';
      starsMarkup += `
        <svg class="star-elem ${activeClass}" data-star="${s}" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      `;
    }

    row.innerHTML = `
      <span class="star-rating-label">${crit.name}</span>
      <div class="stars-interactive-container">
        <div class="stars-group" data-criterion-id="${crit.id}">
          ${starsMarkup}
        </div>
        <button class="star-clear-btn" data-criterion-id="${crit.id}" title="評価をクリア">クリア</button>
      </div>
    `;

    // Hook Star events
    const starsGroup = row.querySelector('.stars-group');
    const starElems = starsGroup.querySelectorAll('.star-elem');
    const clearBtn = row.querySelector('.star-clear-btn');

    starElems.forEach(star => {
      star.addEventListener('click', () => {
        const starVal = parseInt(star.getAttribute('data-star'), 10);
        
        // If clicking the same active value, reset it. Otherwise set value.
        if (state.currentRatings[crit.id] === starVal) {
          state.currentRatings[crit.id] = 0;
        } else {
          state.currentRatings[crit.id] = starVal;
        }

        // Re-draw active star states in this row
        starElems.forEach(s => {
          const val = parseInt(s.getAttribute('data-star'), 10);
          if (val <= (state.currentRatings[crit.id] || 0)) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });

        markDirty();
        updateRadar();
      });
    });

    clearBtn.addEventListener('click', () => {
      state.currentRatings[crit.id] = 0;
      starElems.forEach(s => s.classList.remove('active'));
      markDirty();
      updateRadar();
    });

    els.criteriaPanel.appendChild(row);
  });
}

// Redraw custom Radar chart drawing
function updateRadar() {
  const activeCriteria = db.getActiveCriteria();
  radar.render(activeCriteria, state.currentRatings);
}

// Render video tags chips
function renderVideoTagsList() {
  if (!state.currentVideoId) return;
  const tags = db.getVideoTags(state.currentVideoId);
  els.tagsChipsList.innerHTML = '';
  
  if (tags.length === 0) {
    els.tagsChipsList.innerHTML = `<span style="font-size:0.75rem;color:var(--color-text-dim)">タグ登録がありません</span>`;
  } else {
    tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${t.name}</span>
        <button class="tag-chip-remove" data-tag-id="${t.id}" title="タグを削除">
          <svg fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
        </button>
      `;
      chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
        db.removeTagFromVideo(state.currentVideoId, t.id);
        renderVideoTagsList();
      });
      els.tagsChipsList.appendChild(chip);
    });
  }
}

// Tags Autocomplete Auto-suggestions
function handleTagInputAutocomplete() {
  const val = els.tagInputField.value.trim().toLowerCase();
  if (!val) {
    els.tagAutocomplete.classList.add('hidden');
    return;
  }

  // Filter tags master list matching query
  const matches = db.getTags()
    .filter(t => t.normalizedName.includes(val))
    .slice(0, 5); // Limit 5

  if (matches.length === 0) {
    els.tagAutocomplete.classList.add('hidden');
    return;
  }

  els.tagAutocomplete.innerHTML = '';
  matches.forEach(t => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.textContent = t.name;
    item.addEventListener('click', () => {
      if (state.currentVideoId) {
        db.addTagToVideo(state.currentVideoId, t.name);
        els.tagInputField.value = '';
        els.tagAutocomplete.classList.add('hidden');
        renderVideoTagsList();
      }
    });
    els.tagAutocomplete.appendChild(item);
  });
  els.tagAutocomplete.classList.remove('hidden');
}

// Handle enter button inside tag input field
function handleTagInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = els.tagInputField.value.trim();
    if (val && state.currentVideoId) {
      db.addTagToVideo(state.currentVideoId, val);
      els.tagInputField.value = '';
      els.tagAutocomplete.classList.add('hidden');
      renderVideoTagsList();
    }
  }
}

// Render Timeline notes ordered layout list
function renderTimelineNotesList() {
  if (!state.currentVideoId) return;
  const notes = db.getTimelineNotes(state.currentVideoId);
  els.timelineNotesList.innerHTML = '';

  if (notes.length === 0) {
    els.timelineNotesList.innerHTML = `
      <p style="font-size:0.8125rem;color:var(--color-text-dim);text-align:center;padding:20px">
        タイムライン引用メモはまだありません。
      </p>
    `;
    return;
  }

  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'timeline-note-item';
    
    // Thumbnail content (if canvas shot available)
    const thumbHtml = note.thumbnailUrl 
      ? `<img src="${note.thumbnailUrl}" alt="Scene capture">` 
      : `<svg class="timeline-note-thumb-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;

    item.innerHTML = `
      <div class="timeline-note-thumb">
        ${thumbHtml}
      </div>
      <div class="timeline-note-content-box">
        <div class="timeline-note-meta-row">
          <button class="timeline-note-timestamp" data-seconds="${note.timestampSeconds}" title="この再生位置へ移動">
            <svg xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            </svg>
            ${note.timestampLabel}
          </button>
          <div class="timeline-note-actions">
            <button class="timeline-note-action-btn delete" data-note-id="${note.id}" title="メモを削除">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
        <p class="timeline-note-comment">${escapeHtml(note.comment) || '<span style="color:var(--color-text-dim);font-style:italic">コメント未入力</span>'}</p>
      </div>
    `;

    // Bind timestamp jump
    item.querySelector('.timeline-note-timestamp').addEventListener('click', () => {
      els.video.currentTime = note.timestampSeconds;
      els.video.pause();
    });

    // Bind delete action
    item.querySelector('.timeline-note-action-btn.delete').addEventListener('click', () => {
      if (confirm('タイムラインメモを削除しますか？')) {
        db.deleteTimelineNote(note.id);
        renderTimelineNotesList();
        showToast('メモを削除しました');
      }
    });

    els.timelineNotesList.appendChild(item);
  });
}

// Escape HTML content utility to prevent simple XSS inside dynamic entries
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// Capture current video timestamp context details
async function captureTimelineTimestamp() {
  if (!state.currentVideoId) return;

  const currentSecs = els.video.currentTime || 0;
  state.capturedNoteTime = currentSecs;
  els.capturedTimestampLabel.textContent = `[${formatTime(currentSecs)}]`;

  // Focus comment field immediately
  els.timelineCommentField.focus();

  // Snatch frame image thumbnail from Canvas asynchronously
  state.capturedNoteThumb = await captureVideoFrame(els.video);
}

// Add Timeline note item save to DB
function addTimelineNote() {
  const comment = els.timelineCommentField.value.trim();
  if (!state.currentVideoId) return;

  const label = formatTime(state.capturedNoteTime);
  
  db.addTimelineNote(state.currentVideoId, {
    timestampSeconds: state.capturedNoteTime,
    timestampLabel: label,
    comment: comment,
    thumbnailUrl: state.capturedNoteThumb
  });

  // Reset inputs
  els.timelineCommentField.value = '';
  state.capturedNoteThumb = '';
  // Progress timestamp capture to 0 placeholder
  state.capturedNoteTime = 0;
  els.capturedTimestampLabel.textContent = '[00:00]';

  renderTimelineNotesList();
  showToast('タイムラインメモを追加しました');
}

// Save Ratings review data
function saveReviewForm(isAutosave = false) {
  if (!state.currentVideoId) return;

  db.saveReview(state.currentVideoId, {
    overallGrade: state.currentOverallGrade,
    comment: els.commentEditor.value,
    ratings: state.currentRatings
  });

  clearDirty();
  
  if (!isAutosave) {
    showToast('評価内容を保存しました');
  } else {
    // Subtle flash autosaved message
    els.autosaveIndicator.textContent = '自動保存しました';
    els.autosaveIndicator.style.color = 'var(--color-success)';
    setTimeout(() => {
      if (!state.isDirty && state.currentView === 'editor') {
        els.autosaveIndicator.textContent = '自動保存: 有効';
        els.autosaveIndicator.style.color = 'var(--color-text-dim)';
      }
    }, 1500);
  }
}

// --- SETTINGS VIEW PANEL OVERLAYS ---

function openSettingsModal() {
  renderSettingsCriteriaList();
  openModal(els.modalSettings);
}

function closeSettingsModal() {
  closeModal(els.modalSettings);
  
  // Re-draw editor workspace context if active
  if (state.currentVideoId && state.currentView === 'editor') {
    renderStarCriteriaPanel();
    updateRadar();
  }
}

function renderSettingsCriteriaList() {
  const criteria = db.getCriteria();
  els.settingsCriteriaList.innerHTML = '';

  criteria.forEach((crit, index) => {
    const row = document.createElement('div');
    row.className = 'settings-criterion-row';
    
    // Determine active classes for disabling up/down arrows at ends
    const upDisabled = index === 0 ? 'disabled style="opacity:0.3;pointer-events:none"' : '';
    const downDisabled = index === criteria.length - 1 ? 'disabled style="opacity:0.3;pointer-events:none"' : '';

    row.innerHTML = `
      <div class="criterion-order-controls">
        <button class="criterion-order-btn up" data-id="${crit.id}" ${upDisabled} title="上に移動">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
        </button>
        <button class="criterion-order-btn down" data-id="${crit.id}" ${downDisabled} title="下に移動">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>
      <input type="text" class="form-input criterion-input-field" data-id="${crit.id}" value="${crit.name}">
      
      <label style="display:flex;align-items:center;gap:6px;font-size:0.75rem;cursor:pointer">
        <input type="checkbox" class="criterion-active-checkbox" data-id="${crit.id}" ${crit.isActive ? 'checked' : ''}>
        有効
      </label>
      
      <button class="btn-icon btn-danger settings-criterion-delete" data-id="${crit.id}" style="width:30px;height:30px" title="削除">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
      </button>
    `;

    // Hook inline blur renaming
    const input = row.querySelector('.criterion-input-field');
    input.addEventListener('change', () => {
      const newName = input.value.trim();
      if (newName) {
        db.updateCriterion(crit.id, { name: newName });
      } else {
        input.value = crit.name; // Reset empty
      }
    });

    // Hook active toggle checkbox
    const checkbox = row.querySelector('.criterion-active-checkbox');
    checkbox.addEventListener('change', () => {
      const active = checkbox.checked;
      
      // Enforce max 6 active criteria constraint
      if (active) {
        const activeCount = db.getActiveCriteria().length;
        if (activeCount >= 6) {
          showToast('有効な評価項目は最大6項目までです。', 'error');
          checkbox.checked = false;
          return;
        }
      }
      
      db.updateCriterion(crit.id, { isActive: active });
    });

    // Hook ordering buttons
    row.querySelector('.criterion-order-btn.up').addEventListener('click', () => {
      if (index > 0) {
        const orderedIds = criteria.map(c => c.id);
        const temp = orderedIds[index];
        orderedIds[index] = orderedIds[index - 1];
        orderedIds[index - 1] = temp;
        db.reorderCriteria(orderedIds);
        renderSettingsCriteriaList();
      }
    });

    row.querySelector('.criterion-order-btn.down').addEventListener('click', () => {
      if (index < criteria.length - 1) {
        const orderedIds = criteria.map(c => c.id);
        const temp = orderedIds[index];
        orderedIds[index] = orderedIds[index + 1];
        orderedIds[index + 1] = temp;
        db.reorderCriteria(orderedIds);
        renderSettingsCriteriaList();
      }
    });

    // Hook delete button
    row.querySelector('.settings-criterion-delete').addEventListener('click', () => {
      if (confirm(`評価項目「${crit.name}」を削除しますか？\n過去の動画レビューの数値データは非表示として安全に保持されます。`)) {
        db.deleteCriterion(crit.id);
        renderSettingsCriteriaList();
        showToast('項目を削除（非表示）にしました');
      }
    });

    els.settingsCriteriaList.appendChild(row);
  });

  // Enable/Disable Add New Input based on max 6 check
  const activeCount = db.getActiveCriteria().length;
  if (activeCount >= 6) {
    els.settingsNewNameInput.disabled = true;
    els.settingsBtnAdd.disabled = true;
    els.settingsNewNameInput.placeholder = '最大6項目まで有効化できます（それ以上は追加不可）';
  } else {
    els.settingsNewNameInput.disabled = false;
    els.settingsBtnAdd.disabled = false;
    els.settingsNewNameInput.placeholder = '新しい評価項目名を入力 (例: 独自性)...';
  }
}

// Add Rating criteria setting
function handleSettingsAddCriterion() {
  const name = els.settingsNewNameInput.value.trim();
  if (!name) return;

  try {
    db.addCriterion(name);
    els.settingsNewNameInput.value = '';
    renderSettingsCriteriaList();
    showToast('評価項目を追加しました');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// --- VIDEO PLAYER ACTIONS & EVENTS ---

function togglePlay() {
  if (els.reconnectCard.classList.contains('hidden') === false) {
    return; // Don't play if missing local file binding
  }

  if (els.video.paused) {
    els.video.play();
    els.playIcon.classList.add('hidden');
    els.pauseIcon.classList.remove('hidden');
  } else {
    els.video.pause();
    els.playIcon.classList.remove('hidden');
    els.pauseIcon.classList.add('hidden');
  }
}

function toggleMute() {
  els.video.muted = !els.video.muted;
  if (els.video.muted) {
    els.muteIconOff.classList.add('hidden');
    els.muteIconOn.classList.remove('hidden');
  } else {
    els.muteIconOff.classList.remove('hidden');
    els.muteIconOn.classList.add('hidden');
  }
}

function handleVolumeSlider() {
  els.video.volume = els.volumeSlider.value;
  els.video.muted = (els.video.volume === 0);
  
  if (els.video.muted) {
    els.muteIconOff.classList.add('hidden');
    els.muteIconOn.classList.remove('hidden');
  } else {
    els.muteIconOff.classList.remove('hidden');
    els.muteIconOn.classList.add('hidden');
  }
}

function handleTimeUpdate() {
  const current = els.video.currentTime || 0;
  const duration = els.video.duration || 1;
  
  // Update time display labels
  els.timeCurrent.textContent = formatTime(current);

  // Update progress bar width percentages
  const pct = (current / duration) * 100;
  els.progressFill.style.width = `${pct}%`;
  els.progressHandle.style.left = `${pct}%`;

  // Draw buffer loader timeline pct
  if (els.video.buffered && els.video.buffered.length > 0) {
    const bufferedEnd = els.video.buffered.end(els.video.buffered.length - 1);
    const bufferedPct = (bufferedEnd / duration) * 100;
    els.progressLoad.style.width = `${bufferedPct}%`;
  }
}

// Progress bar slider seek handler
function handleProgressSeek(e) {
  if (!els.video.duration) return;
  const rect = els.progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = clickX / rect.width;
  els.video.currentTime = pct * els.video.duration;
}

// Toggle native full-screen element mode
function toggleFullscreen() {
  const container = els.video.parentElement;
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen(); // Safari support
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

// Keyboard shortcuts global handler
function handleKeyboardShortcuts(e) {
  // If editing text inputs, ignore hotkeys to prevent typing collision
  const tag = document.activeElement.tagName.toLowerCase();
  const isInput = tag === 'input' || tag === 'textarea' || document.activeElement.hasAttribute('contenteditable');
  if (isInput) return;

  // Space -> Play/Pause (Prevent default browser scroll action)
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  }

  // Left Arrow / Right Arrow -> Rewind/Forward 5s
  if (e.key === 'ArrowLeft' && !e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.max(0, els.video.currentTime - 5);
  }
  if (e.key === 'ArrowRight' && !e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.min(els.video.duration || 0, els.video.currentTime + 5);
  }

  // Shift + Left Arrow / Shift + Right Arrow -> Rewind/Forward 10s
  if (e.key === 'ArrowLeft' && e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.max(0, els.video.currentTime - 10);
  }
  if (e.key === 'ArrowRight' && e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.min(els.video.duration || 0, els.video.currentTime + 10);
  }

  // M -> Mute Toggle
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    toggleMute();
  }

  // T -> Capture timecitation marker
  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    if (state.currentView === 'editor') {
      captureTimelineTimestamp();
    }
  }

  // Ctrl+S / Cmd+S -> Save reviews
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (state.currentView === 'editor') {
      saveReviewForm();
    }
  }
}
