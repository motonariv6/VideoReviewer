import { AppDatabase } from './db.js';
import { formatTime, parseTime, generateFileSignature, captureVideoFrame, validateVideoUrl, getFileHandleFromRelativePath } from './video-helper.js';
import { RadarChart } from './radar.js';
import { scanDirectory, classifyScanResults, applyScanDifferentials } from './directory-scanner.js';

// Instantiate DB & components
const db = new AppDatabase();
let radar;

// IME Composition State Tracking
let isTagInputComposing = false;
let isTimelineCommentComposing = false;
let isSettingsNewNameComposing = false;
let isFilterSearchComposing = false;

// Application State
const state = {
  currentView: 'library', // 'library' | 'editor'
  currentVideoId: null,
  activeVideoFile: null,      // For currently playing local file or directory file
  activeBlobUrl: null,        // Tracks active video Blob URL for revoking
  videoFilesMap: new Map(),   // videoId -> File object cache for session
  imageBlobUrls: [],          // Tracks dynamic image Blob URLs to revoke on redraws
  currentRatings: {},         // criterionId -> score (1-5)
  currentOverallGrade: null,  // 'A'..'E' | null
  isDirty: false,
  capturedNoteTime: 0,
  capturedNoteThumb: null,    // Blob of screenshot frame
  scanAbort: false,           // Scan abort flag
  
  // Filter & Sort state for library
  filters: {
    search: '',
    tagId: '',
    overallGrade: '',
    status: '', // 'rated' | 'unrated'
    sourceType: '', // 'directory' | 'local-file' | 'url' | ''
    availability: '', // 'available' | 'missing' | 'permission-required' | 'unsupported' | ''
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
  filterSourceType: document.getElementById('filter-source-type'),
  filterAvailability: document.getElementById('filter-availability'),
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
  urlModalError: document.getElementById('url-modal-error'),
  
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
  playerFolderPermissionButton: document.getElementById('player-folder-permission-button'),
  playerFileReconnectLabel: document.getElementById('player-file-reconnect-label'),
  
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
  
  // Settings Modal (Evaluation)
  modalSettings: document.getElementById('modal-settings'),
  settingsCloseX: document.getElementById('settings-close-x'),
  settingsCriteriaList: document.getElementById('settings-criteria-list'),
  settingsNewNameInput: document.getElementById('settings-new-name-input'),
  settingsBtnAdd: document.getElementById('settings-btn-add'),
  settingsBtnSave: document.getElementById('settings-btn-save'),
  
  // Settings Modal (Video Folder additions)
  folderApiFallbackMsg: document.getElementById('folder-api-fallback-msg'),
  folderSettingsPanel: document.getElementById('folder-settings-panel'),
  folderNameVal: document.getElementById('folder-name-val'),
  folderStatusVal: document.getElementById('folder-status-val'),
  folderPermissionVal: document.getElementById('folder-permission-val'),
  folderVideoCountVal: document.getElementById('folder-video-count-val'),
  folderLastScanVal: document.getElementById('folder-last-scan-val'),
  folderRecursiveCheckbox: document.getElementById('folder-recursive-checkbox'),
  scanProgressBox: document.getElementById('scan-progress-box'),
  scanProgressFiles: document.getElementById('scan-progress-files'),
  scanProgressVideos: document.getElementById('scan-progress-videos'),
  btnFolderScanAbort: document.getElementById('btn-folder-scan-abort'),
  btnFolderSelect: document.getElementById('btn-folder-select'),
  btnFolderRescan: document.getElementById('btn-folder-rescan'),
  btnFolderRequestPerm: document.getElementById('btn-folder-request-perm'),
  btnFolderDisconnect: document.getElementById('btn-folder-disconnect'),
  
  // Toast notifications
  toastContainer: document.getElementById('toast-container')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  radar = new RadarChart(document.getElementById('radar-chart-container'));
  
  // Connect to IndexedDB and run legacy image migration
  await db.initAsync();
  
  // Query permission for active directory sources on boot
  await syncActiveDirectoryPermissions();
  
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
  els.playerFolderPermissionButton.addEventListener('click', handlePlayerFolderPermissionClick);
  els.btnAddUrlModal.addEventListener('click', () => {
    if (els.urlModalError) {
      els.urlModalError.classList.add('hidden');
      els.urlModalError.textContent = '';
    }
    openModal(els.modalAddUrl);
  });
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
  els.filterSourceType.addEventListener('change', () => {
    state.filters.sourceType = els.filterSourceType.value;
    renderLibrary();
  });
  els.filterAvailability.addEventListener('change', () => {
    state.filters.availability = els.filterAvailability.value;
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
  
  // Directory Settings Buttons
  els.btnFolderSelect.addEventListener('click', handleFolderSelect);
  els.btnFolderRescan.addEventListener('click', handleFolderRescan);
  els.btnFolderRequestPerm.addEventListener('click', handleFolderRequestPermission);
  els.btnFolderDisconnect.addEventListener('click', handleFolderDisconnect);
  els.btnFolderScanAbort.addEventListener('click', () => {
    state.scanAbort = true;
    showToast('スキャンを中止しています...', 'error');
  });

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
  els.video.addEventListener('error', handleVideoError);
  els.video.addEventListener('playing', handleVideoPlaying);
  
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
  
  // Tags Input composition tracking
  els.tagInputField.addEventListener('compositionstart', () => {
    isTagInputComposing = true;
  });
  els.tagInputField.addEventListener('compositionend', () => {
    isTagInputComposing = false;
  });
  els.tagInputField.addEventListener('keydown', handleTagInputKeydown);
  els.tagInputField.addEventListener('input', handleTagInputAutocomplete);
  document.addEventListener('click', (e) => {
    if (!els.tagInputField.contains(e.target) && !els.tagAutocomplete.contains(e.target)) {
      els.tagAutocomplete.classList.add('hidden');
    }
  });
  
  // Comments and ratings changes mark dirty
  els.commentEditor.addEventListener('input', markDirty);
  
  // Timeline capturing & adding composition tracking
  els.timelineCommentField.addEventListener('compositionstart', () => {
    isTimelineCommentComposing = true;
  });
  els.timelineCommentField.addEventListener('compositionend', () => {
    isTimelineCommentComposing = false;
  });
  els.btnTimelineCapture.addEventListener('click', captureTimelineTimestamp);
  els.btnTimelineAddNote.addEventListener('click', addTimelineNote);
  els.timelineCommentField.addEventListener('keydown', (e) => {
    if (e.isComposing || isTimelineCommentComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      addTimelineNote();
    }
  });

  // Criteria input composition tracking (Settings modal)
  els.settingsNewNameInput.addEventListener('compositionstart', () => {
    isSettingsNewNameComposing = true;
  });
  els.settingsNewNameInput.addEventListener('compositionend', () => {
    isSettingsNewNameComposing = false;
  });
  els.settingsNewNameInput.addEventListener('keydown', (e) => {
    if (e.isComposing || isSettingsNewNameComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSettingsAddCriterion();
    }
  });

  // Filter search composition tracking
  els.filterSearch.addEventListener('compositionstart', () => {
    isFilterSearchComposing = true;
  });
  els.filterSearch.addEventListener('compositionend', () => {
    isFilterSearchComposing = false;
  });
  els.filterSearch.addEventListener('keydown', (e) => {
    if (e.isComposing || isFilterSearchComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  });
  
  // Manual Save button
  els.btnSaveReview.addEventListener('click', () => saveReviewForm());
}

// Show/Hide Modals
function openModal(modal) {
  modal.classList.add('open');
}

function closeModal(modal) {
  modal.classList.remove('open');
}

// Display Toast Notifications (XSS Clean via textContent)
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const span = document.createElement('span');
  span.textContent = message; // Safe text insertion
  toast.appendChild(span);
  
  els.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Memory Optimization: Revoke dynamic image Blob URLs from memory
function clearImageBlobUrls() {
  state.imageBlobUrls.forEach(url => {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Failed to revoke image Blob URL:', e);
    }
  });
  state.imageBlobUrls = [];
}

// Memory Optimization: Revoke active video playing Blob URL
function revokeActiveBlobUrl() {
  if (state.activeBlobUrl) {
    try {
      URL.revokeObjectURL(state.activeBlobUrl);
    } catch (e) {
      console.warn('Failed to revoke video Blob URL:', e);
    }
    state.activeBlobUrl = null;
  }
}

// Load IndexedDB image onto an element asynchronously, with legacy Base64 fallback
async function loadImageToElement(imgElement, imageId, fallbackUrl) {
  if (imageId) {
    try {
      const blob = await db.getImage(imageId);
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        imgElement.src = objectUrl;
        state.imageBlobUrls.push(objectUrl);
        return;
      }
    } catch (e) {
      console.warn(`Failed to load IndexedDB image ${imageId}:`, e.message);
    }
  }
  
  if (fallbackUrl && fallbackUrl.startsWith('data:')) {
    imgElement.src = fallbackUrl;
  } else {
    imgElement.removeAttribute('src');
  }
}

// Dirty state tracking
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
      saveReviewForm(true);
    }
  }, 5000);
}

// Bootup Directory Permission Sync
async function syncActiveDirectoryPermissions() {
  const sources = db.getDirectorySources();
  for (const source of sources) {
    try {
      const handle = await db.getDirectoryHandle(source.handleKey);
      if (handle) {
        const status = await handle.queryPermission({ mode: 'read' });
        await db.updateDirectorySource(source.id, { permissionStatus: status });
        
        // Sync videos availabilityStatus based on permission
        db.videos.forEach(v => {
          if (v.sourceType === 'directory' && v.directoryId === source.id) {
            v.availabilityStatus = (status === 'granted') ? 'available' : 'permission-required';
          }
        });
      } else {
        await db.updateDirectorySource(source.id, { permissionStatus: 'prompt' });
        db.videos.forEach(v => {
          if (v.sourceType === 'directory' && v.directoryId === source.id) {
            v.availabilityStatus = 'permission-required';
          }
        });
      }
    } catch (err) {
      console.error(`Failed to sync permission for directory source ${source.name}:`, err);
    }
  }
}

// Navigate Screen: Library (XSS Safe DOM creation)
function renderLibrary() {
  clearImageBlobUrls();

  // Populate Tags list in filter select (XSS Safe)
  const oldVal = els.filterTag.value;
  els.filterTag.innerHTML = '';
  
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'すべて';
  els.filterTag.appendChild(defaultOpt);
  
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

  // 5. Source Type Filter
  if (state.filters.sourceType) {
    videos = videos.filter(v => v.sourceType === state.filters.sourceType);
  }

  // 6. Availability Status Filter
  if (state.filters.availability) {
    videos = videos.filter(v => v.availabilityStatus === state.filters.availability);
  }

  // 7. Sort Videos
  videos.sort((a, b) => {
    const rA = db.getReviewForVideo(a.id);
    const rB = db.getReviewForVideo(b.id);
    
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

  // Render Grid Cards securely using DOM API (XSS Safe)
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
      
      let avgText = '未評価';
      let avgScore = 0;
      if (starScores.length > 0) {
        avgScore = starScores.reduce((sum, s) => sum + s.score, 0) / starScores.length;
        avgText = avgScore.toFixed(1);
      }

      const lastUpdatedDate = new Date(v.updatedAt).toLocaleDateString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      // Construct card securely
      const card = document.createElement('article');
      card.className = 'glass-card video-card';
      
      // Bind status styles
      if (v.availabilityStatus === 'missing') {
        card.classList.add('status-missing');
      } else if (v.availabilityStatus === 'permission-required') {
        card.classList.add('status-permission-required');
      } else if (v.availabilityStatus === 'unsupported') {
        card.classList.add('status-unsupported');
      } else if (v.availabilityStatus === 'scan-error') {
        card.classList.add('status-scan-error');
      }
      
      card.addEventListener('click', () => switchScreenToEditor(v.id));

      // Thumbnail wrapper
      const thumbDiv = document.createElement('div');
      thumbDiv.className = 'video-card-thumb';

      const img = document.createElement('img');
      img.alt = v.title;
      loadImageToElement(img, v.thumbnailId, v.thumbnailUrl);
      thumbDiv.appendChild(img);

      // Default placeholder icon if img src fails
      const fallbackSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      fallbackSvg.setAttribute('class', 'placeholder-video-icon');
      fallbackSvg.setAttribute('fill', 'none');
      fallbackSvg.setAttribute('viewBox', '0 0 24 24');
      fallbackSvg.setAttribute('stroke', 'currentColor');
      fallbackSvg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />`;
      thumbDiv.appendChild(fallbackSvg);

      // Status Banners on Thumbnail (Missing / Permission required / Unsupported / Scan Error)
      if (v.availabilityStatus === 'missing') {
        const missingBadge = document.createElement('span');
        missingBadge.className = 'video-card-badge';
        missingBadge.style.backgroundColor = 'var(--color-error)';
        missingBadge.textContent = 'ファイル消失';
        thumbDiv.appendChild(missingBadge);
      } else if (v.availabilityStatus === 'permission-required') {
        const permBadge = document.createElement('span');
        permBadge.className = 'video-card-badge';
        permBadge.style.backgroundColor = 'var(--color-warning)';
        permBadge.textContent = 'アクセス許可が必要';
        thumbDiv.appendChild(permBadge);
      } else if (v.availabilityStatus === 'unsupported') {
        const unsuppBadge = document.createElement('span');
        unsuppBadge.className = 'video-card-badge';
        unsuppBadge.style.backgroundColor = 'var(--color-text-dim)';
        unsuppBadge.textContent = '再生非対応';
        thumbDiv.appendChild(unsuppBadge);
      } else if (v.availabilityStatus === 'scan-error') {
        const scanErrBadge = document.createElement('span');
        scanErrBadge.className = 'video-card-badge';
        scanErrBadge.style.backgroundColor = 'var(--color-error)';
        scanErrBadge.textContent = 'スキャンエラー';
        thumbDiv.appendChild(scanErrBadge);
      } else if (review && review.overallGrade) {
        const gradeSpan = document.createElement('span');
        gradeSpan.className = 'video-card-badge';
        gradeSpan.style.backgroundColor = `var(--color-grade-${review.overallGrade.toLowerCase()})`;
        gradeSpan.textContent = `総合: ${review.overallGrade}`;
        thumbDiv.appendChild(gradeSpan);
      }

      // Duration label
      const durationSpan = document.createElement('span');
      durationSpan.className = 'video-card-duration';
      durationSpan.textContent = formatTime(v.duration);
      thumbDiv.appendChild(durationSpan);

      // Body wrapper
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'video-card-body';

      // Title heading
      const titleH4 = document.createElement('h4');
      titleH4.className = 'video-card-title';
      titleH4.title = v.title;
      titleH4.textContent = v.title;
      bodyDiv.appendChild(titleH4);

      // Source/Path Meta details for Directory Videos
      if (v.sourceType === 'directory') {
        const pathDiv = document.createElement('div');
        pathDiv.className = 'video-card-meta-detail';
        const source = db.getDirectorySource(v.directoryId);
        const folderName = source ? source.name : 'フォルダ不明';
        pathDiv.textContent = `📁 ${folderName} / ${v.relativePath}`;
        bodyDiv.appendChild(pathDiv);
      }

      // Rating Row
      const ratingRow = document.createElement('div');
      ratingRow.className = 'video-card-rating-row';
      
      const avgSpan = document.createElement('span');
      avgSpan.style.color = 'var(--color-text-muted)';
      avgSpan.textContent = `平均: ${avgText}`;
      ratingRow.appendChild(avgSpan);

      const starsDiv = document.createElement('div');
      starsDiv.className = 'video-card-avg-stars';
      
      const roundedStars = Math.round(avgScore);
      for (let i = 1; i <= 5; i++) {
        const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        starSvg.setAttribute('class', `star-elem ${i <= roundedStars ? 'active' : ''}`);
        starSvg.setAttribute('style', 'width:14px;height:14px');
        starSvg.setAttribute('fill', 'currentColor');
        starSvg.setAttribute('viewBox', '0 0 20 20');
        starSvg.innerHTML = `<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />`;
        starsDiv.appendChild(starSvg);
      }
      ratingRow.appendChild(starsDiv);
      bodyDiv.appendChild(ratingRow);

      // Tags wrapper
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'video-card-tags';
      if (tags.length > 0) {
        tags.slice(0, 3).forEach(t => {
          const tSpan = document.createElement('span');
          tSpan.className = 'tag-badge';
          tSpan.textContent = t.name;
          tagsDiv.appendChild(tSpan);
        });
        if (tags.length > 3) {
          const extraSpan = document.createElement('span');
          extraSpan.className = 'tag-badge';
          extraSpan.textContent = `+${tags.length - 3}`;
          tagsDiv.appendChild(extraSpan);
        }
      } else {
        const emptyTagSpan = document.createElement('span');
        emptyTagSpan.className = 'tag-badge';
        emptyTagSpan.style.border = 'dashed 1px var(--color-border)';
        emptyTagSpan.style.background = 'transparent';
        emptyTagSpan.textContent = 'タグ無し';
        tagsDiv.appendChild(emptyTagSpan);
      }
      bodyDiv.appendChild(tagsDiv);

      // Stats row
      const statsDiv = document.createElement('div');
      statsDiv.className = 'video-card-stats';

      // Notes counter
      const noteStat = document.createElement('div');
      noteStat.className = 'stat-item';
      noteStat.title = 'タイムラインメモ数';
      noteStat.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
      const noteCountSpan = document.createElement('span');
      noteCountSpan.textContent = notes.length;
      noteStat.appendChild(noteCountSpan);
      statsDiv.appendChild(noteStat);

      // Comments counter
      const commentStat = document.createElement('div');
      commentStat.className = 'stat-item';
      commentStat.title = '総コメント';
      commentStat.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>`;
      const commentCountSpan = document.createElement('span');
      commentCountSpan.textContent = review && review.comment ? 1 : 0;
      commentStat.appendChild(commentCountSpan);
      statsDiv.appendChild(commentStat);

      // Update date
      const dateDiv = document.createElement('div');
      dateDiv.style.marginLeft = 'auto';
      dateDiv.style.fontSize = '0.6875rem';
      dateDiv.style.color = 'var(--color-text-dim)';
      dateDiv.title = '最終更新日時';
      dateDiv.textContent = lastUpdatedDate;
      statsDiv.appendChild(dateDiv);

      bodyDiv.appendChild(statsDiv);

      card.appendChild(thumbDiv);
      card.appendChild(bodyDiv);
      els.videoGrid.appendChild(card);
    });
  }
}

// Back to Library screen (revoke resources)
function handleBackToLibrary() {
  if (state.isDirty) {
    if (!confirm('保存されていない変更があります。ライブラリに戻りますか？')) {
      return;
    }
  }
  
  els.video.pause();
  els.video.removeAttribute('src');
  els.video.load();
  revokeActiveBlobUrl(); // Release object URL memory
  
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

  // Set header details safely
  els.editorTitle.textContent = video.title;
  els.infoFileName.textContent = video.fileName || (video.sourceType === 'url' ? 'URL動画' : 'フォルダ内動画');
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
  state.capturedNoteThumb = null;
  els.capturedTimestampLabel.textContent = '[00:00]';
  els.timelineCommentField.value = '';

  // Draw chart
  updateRadar();

  // Load media source in player
  loadVideoMediaSource(video);
  
  clearDirty();
}

// Show specific errors on the player warning card
function showFolderErrorOnPlayer(message, mode = 'none') {
  els.video.pause();
  els.video.removeAttribute('src');
  els.video.load();
  els.activeVideoFile = null;
  revokeActiveBlobUrl();

  els.warningFileName.textContent = message;
  els.reconnectCard.classList.remove('hidden');
  
  // Toggle buttons by mode without destroying innerHTML
  if (mode === 'permission') {
    els.playerFolderPermissionButton.classList.remove('hidden');
    els.playerFileReconnectLabel.classList.add('hidden');
  } else if (mode === 'reconnect') {
    els.playerFolderPermissionButton.classList.add('hidden');
    els.playerFileReconnectLabel.classList.remove('hidden');
  } else {
    els.playerFolderPermissionButton.classList.add('hidden');
    els.playerFileReconnectLabel.classList.add('hidden');
  }
}

// Request permission context explicitly inside user click on the warning button
async function handlePlayerFolderPermissionClick() {
  if (!state.currentVideoId) return;
  const video = db.getVideo(state.currentVideoId);
  if (!video || video.sourceType !== 'directory') return;
  
  const source = db.getDirectorySource(video.directoryId);
  if (!source) return;
  
  try {
    const handle = await db.getDirectoryHandle(source.handleKey);
    if (!handle) return;
    
    const status = await handle.requestPermission({ mode: 'read' });
    await db.updateDirectorySource(source.id, { permissionStatus: status });
    
    // Persist video availabilityStatus changes using DB layer
    await db.updateDirectoryVideosAvailability(source.id, status === 'granted' ? 'available' : 'permission-required');
    
    if (status === 'granted') {
      showToast('アクセスを許可しました');
      loadVideoMediaSource(video);
    } else {
      showToast('アクセスが拒否されました', 'error');
      renderLibrary();
    }
  } catch (err) {
    showToast(`アクセス許可エラー: ${err.message}`, 'error');
  }
}

// Load Video File / Url into HTML5 Video player (memory cleanup & folder traversal)
async function loadVideoMediaSource(video) {
  els.video.pause();
  els.video.removeAttribute('src');
  els.video.load();
  els.reconnectCard.classList.add('hidden');
  
  // Release old video file reference from RAM
  revokeActiveBlobUrl();

  if (video.sourceType === 'directory') {
    const source = db.getDirectorySource(video.directoryId);
    if (!source) {
      showFolderErrorOnPlayer('接続フォルダ設定が削除されています。');
      return;
    }
    
    try {
      const handle = await db.getDirectoryHandle(source.handleKey);
      if (!handle) {
        showFolderErrorOnPlayer('フォルダの継続参照ハンドルが見つかりません。再接続してください。');
        return;
      }

      // Query active permissions
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        showFolderErrorOnPlayer(`動画フォルダ「${source.name}」へのアクセス権限が必要です。`, 'permission');
        return;
      }

      // Traverse path to resolve File
      const fileHandle = await getFileHandleFromRelativePath(handle, video.relativePath);
      const file = await fileHandle.getFile();
      state.activeVideoFile = file;

      const objectUrl = URL.createObjectURL(file);
      state.activeBlobUrl = objectUrl;
      els.video.src = objectUrl;
      els.video.load();
      
      // Auto capture thumbnail if missing
      if (!video.thumbnailId && !video.thumbnailUrl) {
        els.video.addEventListener('loadeddata', async function grabFirstFrame() {
          const blob = await captureVideoFrame(els.video);
          if (blob) {
            try {
              await db.updateVideoThumbnail(video.id, blob);
            } catch (err) {
              console.error('Failed to auto save folder video thumbnail:', err);
            }
          }
          els.video.removeEventListener('loadeddata', grabFirstFrame);
        }, { once: true });
      }
    } catch (err) {
      if (err.name === 'NotFoundError') {
        showFolderErrorOnPlayer(`ファイルが見つかりません: ${video.relativePath}`);
        await db.updateVideo(video.id, { availabilityStatus: 'missing' });
        renderLibrary();
      } else {
        showFolderErrorOnPlayer(`ファイル読み込み失敗: ${err.message}`);
      }
    }
  } else if (video.sourceType === 'url') {
    els.video.src = video.videoUrl;
    els.video.load();
  } else {
    // sourceType === 'local-file'
    const file = state.videoFilesMap.get(video.id);
    if (file) {
      state.activeVideoFile = file;
      const objectUrl = URL.createObjectURL(file);
      state.activeBlobUrl = objectUrl;
      els.video.src = objectUrl;
      els.video.load();
    } else {
      state.activeVideoFile = null;
      showFolderErrorOnPlayer(video.fileName, 'reconnect');
    }
  }

  // Reset controls
  els.playIcon.classList.remove('hidden');
  els.pauseIcon.classList.add('hidden');
}

// Handle video loading or playback errors, updating status to unsupported if applicable
async function handleVideoError() {
  const error = els.video.error;
  if (!error || !state.currentVideoId) return;

  const video = db.getVideo(state.currentVideoId);
  if (!video) return;

  console.warn(`Video playback error: code ${error.code}, message: ${error.message}`);

  let message = 'この動画形式またはコーデックをブラウザで再生できません。';
  if (video.sourceType === 'directory') {
    message += '\nファイルは存在しており、評価データも保持されています。';
    try {
      await db.updateVideo(video.id, { availabilityStatus: 'unsupported' });
      renderLibrary();
    } catch (err) {
      console.error('Failed to update availability status to unsupported:', err);
    }
  }

  showFolderErrorOnPlayer(message, 'none');
}

// Restore available status if video starts playing successfully
async function handleVideoPlaying() {
  if (!state.currentVideoId) return;
  const video = db.getVideo(state.currentVideoId);
  if (!video) return;

  if (video.availabilityStatus === 'unsupported') {
    try {
      await db.updateVideo(video.id, { availabilityStatus: 'available' });
      renderLibrary();
    } catch (err) {
      console.error('Failed to restore availability status to available:', err);
    }
  }
}

// Add Local Video File (XSS Safe & revoke Object URL after use)
function handleAddLocalFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const tempVideo = document.createElement('video');
  tempVideo.preload = 'metadata';
  const objectUrl = URL.createObjectURL(file);
  tempVideo.src = objectUrl;
  
  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
    tempVideo.onloadedmetadata = null;
    tempVideo.onerror = null;
  };
  
  tempVideo.onloadedmetadata = async () => {
    const duration = tempVideo.duration || 0;
    
    // Snatch initial frame
    let frameBlob = null;
    try {
      frameBlob = await captureVideoFrame(tempVideo);
    } catch (err) {
      console.warn('Failed to capture initial frame from tempVideo:', err);
    }
    
    cleanup(); // Revoke Object URL immediately
    
    try {
      const added = await db.addVideo({
        title: file.name,
        fileName: file.name,
        fileSize: file.size,
        videoUrl: '',
        duration: duration,
        thumbnailBlob: frameBlob,
        sourceType: 'local-file'
      });

      state.videoFilesMap.set(added.id, file);
      els.addLocalFileInput.value = '';

      switchScreenToEditor(added.id);
      showToast('動画を追加しました');
    } catch (err) {
      showToast(`動画を追加できませんでした: ${err.message}`, 'error');
    }
  };
  
  tempVideo.onerror = () => {
    cleanup();
    
    db.addVideo({
      title: file.name,
      fileName: file.name,
      fileSize: file.size,
      videoUrl: '',
      duration: 0,
      thumbnailBlob: null,
      sourceType: 'local-file'
    }).then(added => {
      state.videoFilesMap.set(added.id, file);
      els.addLocalFileInput.value = '';
      switchScreenToEditor(added.id);
      showToast('動画を追加しました(再生時間未取得)');
    }).catch(err => {
      showToast(`動画を追加できませんでした: ${err.message}`, 'error');
    });
  };
}

// Reconnect file to play again
function handleReconnectFile(e) {
  const file = e.target.files[0];
  if (!file || !state.currentVideoId) return;

  const video = db.getVideo(state.currentVideoId);
  if (!video) return;

  revokeActiveBlobUrl();

  // Save mapping
  state.videoFilesMap.set(video.id, file);
  state.activeVideoFile = file;

  const objectUrl = URL.createObjectURL(file);
  state.activeBlobUrl = objectUrl;
  els.video.src = objectUrl;
  els.video.load();
  els.reconnectCard.classList.add('hidden');

  els.reconnectFileInput.value = '';

  if (!video.thumbnailId && !video.thumbnailUrl) {
    els.video.addEventListener('loadeddata', async function grabFirstFrame() {
      const blob = await captureVideoFrame(els.video);
      if (blob) {
        try {
          await db.updateVideoThumbnail(video.id, blob);
        } catch (err) {
          console.error('Failed to save reconnected thumbnail:', err);
        }
      }
      els.video.removeEventListener('loadeddata', grabFirstFrame);
    }, { once: true });
  }

  showToast('動画ファイルを再接続しました');
}

// Add Online Video URL (Strict Validation & error reporting)
async function handleAddUrlSubmit() {
  const title = els.urlTitleInput.value.trim();
  const url = els.urlPathInput.value.trim();
  const duration = parseInt(els.urlDurationInput.value, 10) || 0;

  if (els.urlModalError) {
    els.urlModalError.classList.add('hidden');
    els.urlModalError.textContent = '';
  }

  try {
    validateVideoUrl(url);

    const added = await db.addVideo({
      title: title || 'URL動画プロジェクト',
      fileName: '',
      fileSize: 0,
      videoUrl: url,
      duration: duration,
      thumbnailBlob: null,
      sourceType: 'url'
    });

    els.urlTitleInput.value = '';
    els.urlPathInput.value = '';
    els.urlDurationInput.value = '';
    
    closeModal(els.modalAddUrl);
    switchScreenToEditor(added.id);
    showToast('URL動画を追加しました');
  } catch (error) {
    if (els.urlModalError) {
      els.urlModalError.textContent = error.message;
      els.urlModalError.classList.remove('hidden');
    } else {
      showToast(error.message, 'error');
    }
  }
}

// Navigate Adjacent Video
function navigateAdjacentVideo(direction) {
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
  if (state.filters.sourceType) {
    videos = videos.filter(v => v.sourceType === state.filters.sourceType);
  }
  if (state.filters.availability) {
    videos = videos.filter(v => v.availabilityStatus === state.filters.availability);
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

// Individual Criteria Stars panel
function renderStarCriteriaPanel() {
  const activeCriteria = db.getActiveCriteria();
  els.criteriaPanel.innerHTML = '';
  
  if (activeCriteria.length === 0) {
    const p = document.createElement('p');
    p.style.fontSize = '0.8125rem';
    p.style.color = 'var(--color-text-dim)';
    p.style.textAlign = 'center';
    p.style.padding = '12px';
    p.textContent = '有効な評価項目が登録されていません。「評価項目設定」から項目を追加してください。';
    els.criteriaPanel.appendChild(p);
    return;
  }

  activeCriteria.forEach(crit => {
    const currentScore = state.currentRatings[crit.id] || 0;

    const row = document.createElement('div');
    row.className = 'star-rating-row';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'star-rating-label';
    labelSpan.textContent = crit.name;
    row.appendChild(labelSpan);

    const interactiveDiv = document.createElement('div');
    interactiveDiv.className = 'stars-interactive-container';

    const starsGroup = document.createElement('div');
    starsGroup.className = 'stars-group';
    starsGroup.setAttribute('data-criterion-id', crit.id);

    for (let s = 1; s <= 5; s++) {
      const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      starSvg.setAttribute('class', `star-elem ${s <= currentScore ? 'active' : ''}`);
      starSvg.setAttribute('data-star', s.toString());
      starSvg.setAttribute('fill', 'currentColor');
      starSvg.setAttribute('viewBox', '0 0 20 20');
      starSvg.innerHTML = `<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />`;
      
      starSvg.addEventListener('click', () => {
        const starVal = s;
        if (state.currentRatings[crit.id] === starVal) {
          state.currentRatings[crit.id] = 0;
        } else {
          state.currentRatings[crit.id] = starVal;
        }

        const rowStars = starsGroup.querySelectorAll('.star-elem');
        rowStars.forEach((st, idx) => {
          if (idx < (state.currentRatings[crit.id] || 0)) {
            st.classList.add('active');
          } else {
            st.classList.remove('active');
          }
        });

        markDirty();
        updateRadar();
      });
      starsGroup.appendChild(starSvg);
    }
    interactiveDiv.appendChild(starsGroup);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'star-clear-btn';
    clearBtn.title = '評価をクリア';
    clearBtn.textContent = 'クリア';
    clearBtn.addEventListener('click', () => {
      state.currentRatings[crit.id] = 0;
      starsGroup.querySelectorAll('.star-elem').forEach(st => st.classList.remove('active'));
      markDirty();
      updateRadar();
    });
    interactiveDiv.appendChild(clearBtn);
    row.appendChild(interactiveDiv);

    els.criteriaPanel.appendChild(row);
  });
}

// Redraw custom Radar
function updateRadar() {
  const activeCriteria = db.getActiveCriteria();
  radar.render(activeCriteria, state.currentRatings);
}

// Render video tags chips (XSS Safe DOM)
function renderVideoTagsList() {
  if (!state.currentVideoId) return;
  const tags = db.getVideoTags(state.currentVideoId);
  els.tagsChipsList.innerHTML = '';
  
  if (tags.length === 0) {
    const span = document.createElement('span');
    span.style.fontSize = '0.75rem';
    span.style.color = 'var(--color-text-dim)';
    span.textContent = 'タグ登録がありません';
    els.tagsChipsList.appendChild(span);
  } else {
    tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      
      const label = document.createElement('span');
      label.textContent = t.name;
      chip.appendChild(label);
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'tag-chip-remove';
      removeBtn.title = 'タグを削除';
      removeBtn.innerHTML = `<svg fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
      removeBtn.addEventListener('click', async () => {
        try {
          await db.removeTagFromVideo(state.currentVideoId, t.id);
          renderVideoTagsList();
        } catch (err) {
          showToast(`タグの削除に失敗しました: ${err.message}`, 'error');
        }
      });
      chip.appendChild(removeBtn);
      
      els.tagsChipsList.appendChild(chip);
    });
  }
}

// Tags Autocomplete dropdown
function handleTagInputAutocomplete() {
  const val = els.tagInputField.value.trim().toLowerCase();
  if (!val) {
    els.tagAutocomplete.classList.add('hidden');
    return;
  }

  const matches = db.getTags()
    .filter(t => t.normalizedName.includes(val))
    .slice(0, 5);

  if (matches.length === 0) {
    els.tagAutocomplete.classList.add('hidden');
    return;
  }

  els.tagAutocomplete.innerHTML = '';
  matches.forEach(t => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.textContent = t.name;
    item.addEventListener('click', async () => {
      if (state.currentVideoId) {
        try {
          await db.addTagToVideo(state.currentVideoId, t.name);
          els.tagInputField.value = '';
          els.tagAutocomplete.classList.add('hidden');
          renderVideoTagsList();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
    els.tagAutocomplete.appendChild(item);
  });
  els.tagAutocomplete.classList.remove('hidden');
}

// Handle enter button inside tag input field
async function handleTagInputKeydown(e) {
  if (e.isComposing || isTagInputComposing || e.keyCode === 229) {
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = els.tagInputField.value.trim();
    if (val && state.currentVideoId) {
      try {
        // Prevent duplicate tag assignment
        const existingTags = db.getVideoTags(state.currentVideoId);
        if (existingTags.some(t => t.name.toLowerCase() === val.toLowerCase())) {
          showToast('このタグは既に追加されています', 'error');
          els.tagInputField.value = '';
          els.tagAutocomplete.classList.add('hidden');
          return;
        }

        await db.addTagToVideo(state.currentVideoId, val);
        els.tagInputField.value = '';
        els.tagAutocomplete.classList.add('hidden');
        renderVideoTagsList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }
}

// Render Timeline notes (XSS Safe DOM)
function renderTimelineNotesList() {
  if (!state.currentVideoId) return;
  
  clearImageBlobUrls();
  
  const notes = db.getTimelineNotes(state.currentVideoId);
  els.timelineNotesList.innerHTML = '';

  if (notes.length === 0) {
    const p = document.createElement('p');
    p.style.fontSize = '0.8125rem';
    p.style.color = 'var(--color-text-dim)';
    p.style.textAlign = 'center';
    p.style.padding = '20px';
    p.textContent = 'タイムライン引用メモはまだありません。';
    els.timelineNotesList.appendChild(p);
    return;
  }

  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'timeline-note-item';
    
    // Thumbnail container
    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'timeline-note-thumb';
    
    const img = document.createElement('img');
    img.alt = 'Scene capture';
    loadImageToElement(img, note.thumbnailId, note.thumbnailUrl);
    thumbDiv.appendChild(img);

    const fallbackIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    fallbackIcon.setAttribute('class', 'timeline-note-thumb-icon');
    fallbackIcon.setAttribute('fill', 'none');
    fallbackIcon.setAttribute('viewBox', '0 0 24 24');
    fallbackIcon.setAttribute('stroke', 'currentColor');
    fallbackIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />`;
    thumbDiv.appendChild(fallbackIcon);

    // Content container
    const contentBox = document.createElement('div');
    contentBox.className = 'timeline-note-content-box';

    const metaRow = document.createElement('div');
    metaRow.className = 'timeline-note-meta-row';

    const tsBtn = document.createElement('button');
    tsBtn.className = 'timeline-note-timestamp';
    tsBtn.title = 'この再生位置へ移動';
    tsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>`;
    const tsLabelText = document.createTextNode(` ${note.timestampLabel}`);
    tsBtn.appendChild(tsLabelText);
    tsBtn.addEventListener('click', () => {
      els.video.currentTime = note.timestampSeconds;
      els.video.pause();
    });
    metaRow.appendChild(tsBtn);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'timeline-note-actions';
    
    const delBtn = document.createElement('button');
    delBtn.className = 'timeline-note-action-btn delete';
    delBtn.title = 'メモを削除';
    delBtn.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;
    delBtn.addEventListener('click', async () => {
      if (confirm('タイムラインメモを削除しますか？')) {
        try {
          await db.deleteTimelineNote(note.id);
          renderTimelineNotesList();
          showToast('メモを削除しました');
        } catch (err) {
          showToast(`削除に失敗しました: ${err.message}`, 'error');
        }
      }
    });
    actionsDiv.appendChild(delBtn);
    metaRow.appendChild(actionsDiv);

    const commentP = document.createElement('p');
    commentP.className = 'timeline-note-comment';
    if (note.comment) {
      commentP.textContent = note.comment;
    } else {
      const italicSpan = document.createElement('span');
      italicSpan.style.color = 'var(--color-text-dim)';
      italicSpan.style.fontStyle = 'italic';
      italicSpan.textContent = 'コメント未入力';
      commentP.appendChild(italicSpan);
    }

    contentBox.appendChild(metaRow);
    contentBox.appendChild(commentP);

    item.appendChild(thumbDiv);
    item.appendChild(contentBox);
    els.timelineNotesList.appendChild(item);
  });
}

// Capture current video timestamp context details
async function captureTimelineTimestamp() {
  if (!state.currentVideoId) return;

  const currentSecs = els.video.currentTime || 0;
  state.capturedNoteTime = currentSecs;
  els.capturedTimestampLabel.textContent = `[${formatTime(currentSecs)}]`;

  els.timelineCommentField.focus();

  // Snatch frame image Blob from Canvas
  state.capturedNoteThumb = await captureVideoFrame(els.video);
}

// Add Timeline note item save to DB
async function addTimelineNote() {
  const comment = els.timelineCommentField.value.trim();
  if (!state.currentVideoId) return;

  const label = formatTime(state.capturedNoteTime);
  
  try {
    await db.addTimelineNote(state.currentVideoId, {
      timestampSeconds: state.capturedNoteTime,
      timestampLabel: label,
      comment: comment,
      thumbnailBlob: state.capturedNoteThumb
    });

    els.timelineCommentField.value = '';
    state.capturedNoteThumb = null;
    state.capturedNoteTime = 0;
    els.capturedTimestampLabel.textContent = '[00:00]';

    renderTimelineNotesList();
    showToast('タイムラインメモを追加しました');
  } catch (err) {
    showToast(`保存できませんでした: ${err.message}`, 'error');
  }
}

// Save Ratings review data
async function saveReviewForm(isAutosave = false) {
  if (!state.currentVideoId) return;

  try {
    await db.saveReview(state.currentVideoId, {
      overallGrade: state.currentOverallGrade,
      comment: els.commentEditor.value,
      ratings: state.currentRatings
    });

    clearDirty();
    
    if (!isAutosave) {
      showToast('評価内容を保存しました');
    } else {
      els.autosaveIndicator.textContent = '自動保存しました';
      els.autosaveIndicator.style.color = 'var(--color-success)';
      setTimeout(() => {
        if (!state.isDirty && state.currentView === 'editor') {
          els.autosaveIndicator.textContent = '自動保存: 有効';
          els.autosaveIndicator.style.color = 'var(--color-text-dim)';
        }
      }, 1500);
    }
  } catch (err) {
    showToast(`保存できませんでした: ${err.message}`, 'error');
  }
}

// --- SETTINGS VIEW PANEL OVERLAYS ---

function openSettingsModal() {
  // Check API capability
  const isIdbSupported = (typeof indexedDB !== 'undefined');
  const isFileSystemSupported = (typeof window.showDirectoryPicker === 'function');
  
  if (!isFileSystemSupported) {
    els.folderApiFallbackMsg.classList.remove('hidden');
    els.folderSettingsPanel.classList.add('hidden');
  } else {
    els.folderApiFallbackMsg.classList.add('hidden');
    els.folderSettingsPanel.classList.remove('hidden');
    renderFolderSettingsPanel();
  }

  renderSettingsCriteriaList();
  openModal(els.modalSettings);
}

function closeSettingsModal() {
  closeModal(els.modalSettings);
  
  if (state.currentVideoId && state.currentView === 'editor') {
    renderStarCriteriaPanel();
    updateRadar();
  }
}

// Render Folder Settings Panel inside the settings modal
function renderFolderSettingsPanel() {
  const sources = db.getDirectorySources();
  const source = sources[0]; // Supports 1 active folder source in MVP
  
  if (!source) {
    els.folderNameVal.textContent = '-';
    els.folderStatusVal.textContent = '未接続';
    els.folderStatusVal.style.color = 'var(--color-text-muted)';
    els.folderPermissionVal.textContent = '-';
    els.folderVideoCountVal.textContent = '0本';
    els.folderLastScanVal.textContent = '-';
    
    els.btnFolderRescan.classList.add('hidden');
    els.btnFolderRequestPerm.classList.add('hidden');
    els.btnFolderDisconnect.classList.add('hidden');
    els.btnFolderSelect.classList.remove('hidden');
    return;
  }

  // Bind directory source properties safely
  els.folderNameVal.textContent = source.name;
  
  // Status check
  els.folderStatusVal.textContent = '接続済み';
  els.folderStatusVal.style.color = 'var(--color-success)';
  
  // Permission status
  let permColor = 'var(--color-text-dim)';
  let permText = '確認中';
  if (source.permissionStatus === 'granted') {
    permText = '許可済み';
    permColor = 'var(--color-success)';
    
    els.btnFolderRequestPerm.classList.add('hidden');
    els.btnFolderRescan.classList.remove('hidden');
  } else if (source.permissionStatus === 'prompt') {
    permText = '許可が必要';
    permColor = 'var(--color-warning)';
    
    els.btnFolderRequestPerm.classList.remove('hidden');
    els.btnFolderRescan.classList.add('hidden');
  } else {
    permText = '拒否';
    permColor = 'var(--color-error)';
    
    els.btnFolderRequestPerm.classList.remove('hidden');
    els.btnFolderRescan.classList.add('hidden');
  }
  
  els.folderPermissionVal.textContent = permText;
  els.folderPermissionVal.style.color = permColor;
  
  // Registered videos count
  const dirVideoCount = db.getVideos().filter(v => v.sourceType === 'directory' && v.directoryId === source.id).length;
  els.folderVideoCountVal.textContent = `${dirVideoCount}本`;
  
  // Last scan
  els.folderLastScanVal.textContent = source.lastScannedAt 
    ? new Date(source.lastScannedAt).toLocaleString('ja-JP') 
    : '未スキャン';
  
  // Checkbox state
  els.folderRecursiveCheckbox.checked = source.includeSubdirectories;

  els.btnFolderSelect.classList.add('hidden');
  els.btnFolderDisconnect.classList.remove('hidden');
}

// Select a new folder on the host machine using a Two-Phase Commit with Rollback
async function handleFolderSelect() {
  if (!window.showDirectoryPicker) {
    showToast('このブラウザはフォルダ選択に対応していません。', 'error');
    return;
  }

  // Generate temporary key for the 2-phase verification
  const tempUUID = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  const tempKey = `pending-directory-handle-${tempUUID}`;
  let handleSavedToTemp = false;

  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    if (!handle) return;

    // Phase 1: Try saving the new handle under a temporary key
    await db.putDirectoryHandle(tempKey, handle);
    handleSavedToTemp = true;

    // Phase 2: Read it back to verify serialization integrity
    const verifiedHandle = await db.getDirectoryHandle(tempKey);
    if (!verifiedHandle) {
      throw new Error('一時キーからのハンドルの読み戻しに失敗しました。');
    }

    // Phase 3: Test-read the directory to verify permissions/integrity
    let testReadSuccess = false;
    try {
      const iterator = verifiedHandle.values();
      await iterator.next();
      testReadSuccess = true;
    } catch (err) {
      console.warn('Folder test read failed:', err);
    }
    if (!testReadSuccess) {
      throw new Error('選択したフォルダへのアクセス権限がないか、読み取りに失敗しました。');
    }

    // Phase 4: Overwrite confirmation
    const oldSourceIds = db.getDirectorySources().map(s => s.id);
    if (oldSourceIds.length > 0) {
      if (!confirm('すでに接続されているフォルダ設定があります。上書きして新しいフォルダを選択しますか？')) {
        // Clean temp handle and return
        await db.deleteDirectoryHandle(tempKey);
        return;
      }
    }

    // Phase 5: Commit changes to Database
    const source = await db.addDirectorySource({
      name: handle.name,
      includeSubdirectories: els.folderRecursiveCheckbox.checked
    });

    // Copy from temporary key to permanent handle key
    await db.putDirectoryHandle(source.handleKey, handle);
    
    // Set permission status
    const status = await handle.queryPermission({ mode: 'read' });
    await db.updateDirectorySource(source.id, { permissionStatus: status });

    // Clean up temporary handle
    await db.deleteDirectoryHandle(tempKey);
    handleSavedToTemp = false;

    // Disconnect old source if exists
    for (const oldId of oldSourceIds) {
      if (oldId !== source.id) {
        await db.deleteDirectorySource(oldId);
      }
    }

    showToast(`フォルダ「${handle.name}」を接続しました。`);
    renderFolderSettingsPanel();
    
    // Trigger initial scan
    await startFolderScanning(source, handle);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Folder selection cancelled by user');
      if (handleSavedToTemp) {
        try { await db.deleteDirectoryHandle(tempKey); } catch (e) {}
      }
      return;
    }
    
    // Rollback: Keep old folder connection intact
    if (handleSavedToTemp) {
      try { await db.deleteDirectoryHandle(tempKey); } catch (e) {}
    }
    
    showToast(`新しいフォルダへ切り替えられませんでした: ${err.message}`, 'error');
  }
}

// Request permission context explicitly inside user click
async function handleFolderRequestPermission() {
  const source = db.getDirectorySources()[0];
  if (!source) return;

  try {
    const handle = await db.getDirectoryHandle(source.handleKey);
    if (!handle) {
      showToast('フォルダの参照データが見つかりません。再接続してください。', 'error');
      return;
    }

    const status = await handle.requestPermission({ mode: 'read' });
    await db.updateDirectorySource(source.id, { permissionStatus: status });
    
    // Update and persist video availability statuses via public DB method
    await db.updateDirectoryVideosAvailability(source.id, status === 'granted' ? 'available' : 'permission-required');

    showToast(status === 'granted' ? 'アクセス権限が許可されました。' : 'アクセス権限が拒否されました。');
    renderFolderSettingsPanel();
    renderLibrary();
  } catch (err) {
    showToast(`権限要求エラー: ${err.message}`, 'error');
  }
}

// Rescan current connected folder
async function handleFolderRescan() {
  const source = db.getDirectorySources()[0];
  if (!source) return;

  try {
    const handle = await db.getDirectoryHandle(source.handleKey);
    if (!handle) {
      showToast('フォルダが見つかりません。再接続してください。', 'error');
      return;
    }
    await startFolderScanning(source, handle);
  } catch (err) {
    showToast(`スキャン起動エラー: ${err.message}`, 'error');
  }
}

// Non-blocking Folder scanner using the shared directory-scanner.js module
async function startFolderScanning(source, handle) {
  state.scanAbort = false;
  els.scanProgressBox.classList.remove('hidden');
  els.scanProgressFiles.textContent = '0';
  els.scanProgressVideos.textContent = '0';

  const recursive = els.folderRecursiveCheckbox.checked;
  await db.updateDirectorySource(source.id, { includeSubdirectories: recursive });

  // Use AbortController for cancellation support
  const controller = new AbortController();
  const abortListener = () => {
    controller.abort();
  };
  
  const originalScanAbort = els.btnFolderScanAbort.onclick;
  els.btnFolderScanAbort.onclick = () => {
    state.scanAbort = true;
    controller.abort();
  };

  try {
    const scanResult = await scanDirectory({
      directoryHandle: handle,
      recursive: recursive,
      signal: controller.signal,
      onProgress: ({ checkedFiles, detectedVideos }) => {
        els.scanProgressFiles.textContent = checkedFiles.toString();
        els.scanProgressVideos.textContent = detectedVideos.toString();
      }
    });

    els.scanProgressBox.classList.add('hidden');

    if (scanResult.aborted || state.scanAbort) {
      showToast('フォルダスキャンが中止されました。', 'error');
      state.scanAbort = false;
      return;
    }

    // Apply differentials
    const summary = await applyScanDifferentials({
      db,
      directoryId: source.id,
      scanResult,
      recursive
    });

    // Save scan timestamp
    await db.updateDirectorySource(source.id, { lastScannedAt: new Date().toISOString() });

    alert(`スキャン完了\n\n新規：${summary.added}本\n更新：${summary.updated}本\n変更なし：${summary.unchanged}本\n見つからない：${summary.missing}本\n判定保留：${summary.pending}本\nエラー：${summary.error}件`);

    renderFolderSettingsPanel();
    renderLibrary();
  } catch (err) {
    els.scanProgressBox.classList.add('hidden');
    if (err.name === 'AbortError' || state.scanAbort) {
      showToast('フォルダスキャンが中止されました。', 'error');
    } else {
      showToast(`スキャンエラー: ${err.message}`, 'error');
    }
  } finally {
    els.btnFolderScanAbort.onclick = originalScanAbort;
  }
}

// Confirm Disconnect Folder Source
async function handleFolderDisconnect() {
  const sources = db.getDirectorySources();
  if (sources.length === 0) return;

  const source = sources[0];
  if (!confirm(`動画フォルダ「${source.name}」との接続を解除します。\n登録済みの評価・タグ・コメントは削除されません。`)) {
    return;
  }

  try {
    await db.deleteDirectorySource(source.id);
    showToast('動画フォルダの接続を解除しました。');
    renderFolderSettingsPanel();
    renderLibrary();
  } catch (err) {
    showToast(`接続解除エラー: ${err.message}`, 'error');
  }
}

// Settings criteria rows renderer (XSS Safe DOM)
function renderSettingsCriteriaList() {
  const criteria = db.getCriteria();
  els.settingsCriteriaList.innerHTML = '';

  criteria.forEach((crit, index) => {
    const row = document.createElement('div');
    row.className = 'settings-criterion-row';
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'criterion-order-controls';

    const upBtn = document.createElement('button');
    upBtn.className = 'criterion-order-btn up';
    upBtn.title = '上に移動';
    upBtn.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>`;
    if (index === 0) {
      upBtn.disabled = true;
      upBtn.style.opacity = '0.3';
      upBtn.style.pointerEvents = 'none';
    }
    upBtn.addEventListener('click', async () => {
      if (index > 0) {
        const orderedIds = criteria.map(c => c.id);
        const temp = orderedIds[index];
        orderedIds[index] = orderedIds[index - 1];
        orderedIds[index - 1] = temp;
        await db.reorderCriteria(orderedIds);
        renderSettingsCriteriaList();
      }
    });
    controlsDiv.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.className = 'criterion-order-btn down';
    downBtn.title = '下に移動';
    downBtn.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>`;
    if (index === criteria.length - 1) {
      downBtn.disabled = true;
      downBtn.style.opacity = '0.3';
      downBtn.style.pointerEvents = 'none';
    }
    downBtn.addEventListener('click', async () => {
      if (index < criteria.length - 1) {
        const orderedIds = criteria.map(c => c.id);
        const temp = orderedIds[index];
        orderedIds[index] = orderedIds[index + 1];
        orderedIds[index + 1] = temp;
        await db.reorderCriteria(orderedIds);
        renderSettingsCriteriaList();
      }
    });
    controlsDiv.appendChild(downBtn);
    row.appendChild(controlsDiv);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input criterion-input-field';
    input.value = crit.name;
    input.addEventListener('change', async () => {
      const newName = input.value.trim();
      if (newName) {
        await db.updateCriterion(crit.id, { name: newName });
      } else {
        input.value = crit.name;
      }
    });
    row.appendChild(input);

    const activeLabel = document.createElement('label');
    activeLabel.style.display = 'flex';
    activeLabel.style.alignItems = 'center';
    activeLabel.style.gap = '6px';
    activeLabel.style.fontSize = '0.75rem';
    activeLabel.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'criterion-active-checkbox';
    checkbox.checked = crit.isActive;
    checkbox.addEventListener('change', async () => {
      const active = checkbox.checked;
      
      if (active) {
        const activeCount = db.getActiveCriteria().length;
        if (activeCount >= 6) {
          showToast('有効な評価項目は最大6項目までです。', 'error');
          checkbox.checked = false;
          return;
        }
      }
      
      await db.updateCriterion(crit.id, { isActive: active });
    });
    activeLabel.appendChild(checkbox);
    activeLabel.appendChild(document.createTextNode('有効'));
    row.appendChild(activeLabel);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon btn-danger settings-criterion-delete';
    deleteBtn.title = '削除';
    deleteBtn.style.width = '30px';
    deleteBtn.style.height = '30px';
    deleteBtn.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;
    deleteBtn.addEventListener('click', async () => {
      if (confirm(`評価項目「${crit.name}」を削除しますか？\n過去の動画レビューの数値データは非表示として安全に保持されます。`)) {
        await db.deleteCriterion(crit.id);
        renderSettingsCriteriaList();
        showToast('項目を削除（非表示）にしました');
      }
    });
    row.appendChild(deleteBtn);

    els.settingsCriteriaList.appendChild(row);
  });

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
async function handleSettingsAddCriterion() {
  const name = els.settingsNewNameInput.value.trim();
  if (!name) return;

  try {
    await db.addCriterion(name);
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
    return;
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
  
  els.timeCurrent.textContent = formatTime(current);

  const pct = (current / duration) * 100;
  els.progressFill.style.width = `${pct}%`;
  els.progressHandle.style.left = `${pct}%`;

  if (els.video.buffered && els.video.buffered.length > 0) {
    const bufferedEnd = els.video.buffered.end(els.video.buffered.length - 1);
    const bufferedPct = (bufferedEnd / duration) * 100;
    els.progressLoad.style.width = `${bufferedPct}%`;
  }
}

function handleProgressSeek(e) {
  if (!els.video.duration) return;
  const rect = els.progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = clickX / rect.width;
  els.video.currentTime = pct * els.video.duration;
}

function toggleFullscreen() {
  const container = els.video.parentElement;
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

function handleKeyboardShortcuts(e) {
  if (e.isComposing || e.keyCode === 229) {
    return;
  }

  const tag = document.activeElement.tagName.toLowerCase();
  const isInput = tag === 'input' || tag === 'textarea' || document.activeElement.hasAttribute('contenteditable');
  if (isInput) return;

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  }

  if (e.key === 'ArrowLeft' && !e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.max(0, els.video.currentTime - 5);
  }
  if (e.key === 'ArrowRight' && !e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.min(els.video.duration || 0, els.video.currentTime + 5);
  }

  if (e.key === 'ArrowLeft' && e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.max(0, els.video.currentTime - 10);
  }
  if (e.key === 'ArrowRight' && e.shiftKey) {
    e.preventDefault();
    els.video.currentTime = Math.min(els.video.duration || 0, els.video.currentTime + 10);
  }

  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    toggleMute();
  }

  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    if (state.currentView === 'editor') {
      captureTimelineTimestamp();
    }
  }

  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (state.currentView === 'editor') {
      saveReviewForm();
    }
  }
}
