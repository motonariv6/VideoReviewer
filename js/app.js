import { AppDatabase } from './db.js';
import { formatTime, parseTime, generateFileSignature, captureVideoFrame, getFileHandleFromRelativePath, filterVideosByTag } from './video-helper.js';
import { RadarChart } from './radar.js';
import { ReviewEditorUI } from './review/review-editor-ui.js';
import { ReviewEditorController } from './review/review-editor-controller.js';
import { scanDirectory, classifyScanResults, applyScanDifferentials, isIgnoredSystemEntry } from './directory-scanner.js';
import { computeQuickHash, computeFileSHA256, globalHashQueue, logMetric } from './hash-helper.js';
import {
  bgHashState,
  processBackgroundHashingQueue as processBackgroundHashingQueueController,
  processSingleLocationVerification,
  handleLocationsRemoved
} from './hashing/hash-verification-controller.js';
import {
  updateBackgroundHashingProgress,
  updateBackgroundHashingUI,
  clearCloseTimeout
} from './hashing/hash-progress-ui.js';
import {
  syncActiveDirectoryPermissions as syncActiveDirectoryPermissionsController,
  handleFolderSelect as handleFolderSelectController,
  handleFolderRequestPermission as handleFolderRequestPermissionController,
  handleFolderRescan as handleFolderRescanController,
  startFolderScanning as startFolderScanningController,
  abortFolderScanning,
  handleFolderDisconnect as handleFolderDisconnectController
} from './folder/folder-management-controller.js';
import {
  archiveVideoAction,
  deleteVideoCascadeAction,
  deleteFileLocationAction,
  handleBulkDeleteAction
} from './archive/archive-management-controller.js';
import { renderFolderSettingsUI, updateScanProgressUI } from './folder/folder-settings-ui.js';
import { initShareUI } from './review-sharing/review-share-ui.js';
import { isVideoEligibleForExport } from './review-sharing/review-share-exporter.js';

export {
  bgHashState,
  processSingleLocationVerification,
  updateBackgroundHashingProgress,
  updateBackgroundHashingUI,
  clearCloseTimeout,
  handleLocationsRemoved,
  els,
  openSettingsModal
};

// Instantiate DB & components
export let db = new AppDatabase();

export function setDbForTesting(mockDb) {
  db = mockDb;
}
let radar;

// IME Composition State Tracking
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
  selectedSettingsGenreId: null, // Tracks selected genre in settings panel

  // Filter & Sort state for library
  filters: {
    search: '',
    tagId: '',
    overallGrade: '',
    status: '', // 'rated' | 'unrated'
    sourceType: '', // 'directory' | 'local-file' | ''
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
  btnBulkDelete: document.getElementById('btn-bulk-delete'),
  addLocalFileInput: document.getElementById('library-add-file'),

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
  infoLocationsContainer: document.getElementById('info-locations-container'),
  infoLocationsList: document.getElementById('info-locations-list'),

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

  // Shared Reviews elements
  sharedReviewsSection: document.getElementById('shared-reviews-section'),
  sharedAverageRating: document.getElementById('shared-average-rating'),
  sharedReviewersCount: document.getElementById('shared-reviewers-count'),
  sharedRatedCount: document.getElementById('shared-rated-count'),
  sharedReviewersList: document.getElementById('shared-reviewers-list'),
  sharedTagsList: document.getElementById('shared-tags-list'),
  sharedTimelineList: document.getElementById('shared-timeline-list'),

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
  toastContainer: document.getElementById('toast-container'),

  provisionalWarningBanner: document.getElementById('provisional-warning-banner'),

  // Display Title Override UI
  titleDisplayContainer: document.getElementById('title-display-container'),
  titleEditContainer: document.getElementById('title-edit-container'),
  btnEditDisplayTitle: document.getElementById('btn-edit-display-title'),
  displayTitleInput: document.getElementById('display-title-input'),
  btnSaveDisplayTitle: document.getElementById('btn-save-display-title'),
  btnCancelDisplayTitle: document.getElementById('btn-cancel-display-title'),

  // Video Genre dropdown
  videoGenreSelect: document.getElementById('video-genre-select'),

  // Settings Modal Genre additions
  settingsGenreSelect: document.getElementById('settings-genre-select'),
  settingsBtnGenreRename: document.getElementById('settings-btn-genre-rename'),
  settingsBtnGenreToggleActive: document.getElementById('settings-btn-genre-toggle-active'),
  settingsNewGenreInput: document.getElementById('settings-new-genre-input'),
  settingsBtnGenreAdd: document.getElementById('settings-btn-genre-add'),
  settingsBtnGenreUp: document.getElementById('settings-btn-genre-up'),
  settingsBtnGenreDown: document.getElementById('settings-btn-genre-down'),
  settingsCopySourceSelect: document.getElementById('settings-copy-source-select'),
  settingsBtnCopyCriteria: document.getElementById('settings-btn-copy-criteria'),

  // Data Management Backup / Restore
  backupLastTimeVal: document.getElementById('backup-last-time-val'),
  btnBackupCreate: document.getElementById('btn-backup-create'),
  btnBackupRestoreTrigger: document.getElementById('btn-backup-restore-trigger'),
  backupRestoreFile: document.getElementById('backup-restore-file'),
  modalBackupProgress: document.getElementById('modal-backup-progress'),
  backupProgressTitle: document.getElementById('backup-progress-title'),
  backupProgressMsg: document.getElementById('backup-progress-msg'),
  btnCleanOrphanData: document.getElementById('btn-clean-orphan-data')
};

export let reviewEditorUI = new ReviewEditorUI({ els });
export let reviewEditorController = new ReviewEditorController({
  db,
  ui: reviewEditorUI,
  state,
  radar: null, // set during DOMContentLoaded
  showToast,
  markDirty,
  clearDirty,
  getCurrentTime: () => els.video.currentTime || 0,
  seekTo: (secs) => {
    els.video.currentTime = secs;
    els.video.pause();
  },
  captureFrame: () => captureVideoFrame(els.video),
  loadImageToElement,
  clearImageBlobUrls,
  formatTime,
  renderLibrary,
  handleBackToLibrary,
  deleteFileLocationAction,
  handleLocationsRemoved,
  updateBackgroundHashingProgress,
  loadVideoMediaSource,
  confirm: (msg) => confirm(msg)
});

// Initialize Application
if (typeof window !== 'undefined' && !window.__TEST_ENV__) {
  document.addEventListener('DOMContentLoaded', async () => {
    radar = new RadarChart(document.getElementById('radar-chart-container'));
    reviewEditorController.radar = radar;

    // Connect to IndexedDB and run legacy image migration
    await db.initAsync();

    // Query permission for active directory sources on boot
    await syncActiveDirectoryPermissions();

    initEventListeners();
    initAutosaveTimer();
    initShareUI(db, state, showToast, renderLibrary, getFilteredVideosList);
    renderLibrary();
  });
}

// Setup event bindings
function initEventListeners() {
  // Navigation & Screen switching
  els.btnBack.addEventListener('click', () => handleBackToLibrary());
  els.editorBack.addEventListener('click', () => handleBackToLibrary());

  // Add Media
  els.addLocalFileInput.addEventListener('change', handleAddLocalFile);
  els.reconnectFileInput.addEventListener('change', handleReconnectFile);
  els.playerFolderPermissionButton.addEventListener('click', handlePlayerFolderPermissionClick);

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
  els.btnBulkDelete.addEventListener('click', handleBulkDelete);

  // Settings triggers
  // Settings triggers
  els.btnSettings.addEventListener('click', openSettingsModal);
  els.settingsCloseX.addEventListener('click', closeSettingsModal);
  els.settingsBtnAdd.addEventListener('click', handleSettingsAddCriterion);
  els.settingsBtnSave.addEventListener('click', closeSettingsModal);

  // Review Editor UI Event Listeners
  reviewEditorUI.setupEventListeners({
    onGradeClick: (grade) => {
      reviewEditorController.handleGradeClick(grade);
    },
    onClearGradeClick: () => {
      reviewEditorController.handleClearGradeClick();
    },
    onGenreChange: () => {
      reviewEditorController.changeGenre();
    },
    onTitleSave: () => {
      reviewEditorController.saveDisplayTitle();
    },
    onTagInput: () => {
      reviewEditorController.handleTagInputFieldAutocomplete();
    },
    onTagKeydown: (e, isComposing) => {
      reviewEditorController.handleTagInputKeydown(e, isComposing);
    },
    onCaptureTimeClick: () => {
      reviewEditorController.captureTimelineTimestamp();
    },
    onAddTimelineNoteClick: () => {
      reviewEditorController.addTimelineNote();
    },
    onTimelineCommentKeydown: (e, isComposing) => {
      reviewEditorController.handleTimelineCommentKeydown(e, isComposing);
    },
    onCommentInput: () => {
      markDirty();
    },
    onCommentBlur: () => {
      reviewEditorController.saveReviewForm(true);
    }
  });

  // 3. Settings Modal - Genre Select Dropdown
  els.settingsGenreSelect.addEventListener('change', () => {
    state.selectedSettingsGenreId = els.settingsGenreSelect.value;
    renderSettingsCriteriaList();
    renderSettingsGenreControls();
  });

  // 4. Settings Modal - Genre Add
  els.settingsBtnGenreAdd.addEventListener('click', async () => {
    const name = els.settingsNewGenreInput.value.trim();
    if (!name) {
      showToast('ジャンル名を入力してください。', 'error');
      return;
    }
    try {
      const g = await db.addGenre(name);
      els.settingsNewGenreInput.value = '';
      state.selectedSettingsGenreId = g.id;
      // Reload dropdowns
      populateSettingsGenreSelect();
      renderSettingsCriteriaList();
      renderSettingsGenreControls();
      showToast(`ジャンル「${name}」を追加しました。`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // 5. Settings Modal - Genre Rename
  els.settingsBtnGenreRename.addEventListener('click', async () => {
    const genreId = state.selectedSettingsGenreId || 'genre-default';
    const genre = db.getGenre(genreId);
    if (!genre) return;

    const newName = prompt('新しいジャンル名を入力してください。', genre.name);
    if (newName === null) return;
    const cleanName = newName.trim();
    if (!cleanName) {
      showToast('有効なジャンル名を入力してください。', 'error');
      return;
    }

    try {
      await db.updateGenre(genreId, { name: cleanName });
      populateSettingsGenreSelect();
      renderSettingsGenreControls();
      showToast('ジャンル名を変更しました。');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // 6. Settings Modal - Genre Disable/Enable Toggle
  els.settingsBtnGenreToggleActive.addEventListener('click', async () => {
    const genreId = state.selectedSettingsGenreId || 'genre-default';
    if (genreId === 'genre-default') {
      showToast('既定のジャンルは無効化できません。', 'error');
      return;
    }

    const genre = db.getGenre(genreId);
    if (!genre) return;

    if (genre.isActive) {
      if (confirm(`ジャンル「${genre.name}」を無効化しますか？\n過去に登録した動画および評価データは消えずに残ります。`)) {
        await db.updateGenre(genreId, { isActive: false });
        populateSettingsGenreSelect();
        renderSettingsCriteriaList();
        renderSettingsGenreControls();
        showToast(`ジャンル「${genre.name}」を無効にしました。`);
      }
    } else {
      await db.updateGenre(genreId, { isActive: true });
      populateSettingsGenreSelect();
      renderSettingsCriteriaList();
      renderSettingsGenreControls();
      showToast(`ジャンル「${genre.name}」を有効にしました。`);
    }
  });

  // 7. Settings Modal - Genre Up & Down Sorting
  els.settingsBtnGenreUp.addEventListener('click', async () => {
    const genreId = state.selectedSettingsGenreId;
    if (!genreId) return;
    const genres = db.getGenres();
    const idx = genres.findIndex(g => g.id === genreId);
    if (idx > 0) {
      const g1 = genres[idx];
      const g2 = genres[idx - 1];
      const temp = g1.displayOrder;
      g1.displayOrder = g2.displayOrder;
      g2.displayOrder = temp;

      await db.updateGenre(g1.id, { displayOrder: g1.displayOrder });
      await db.updateGenre(g2.id, { displayOrder: g2.displayOrder });

      populateSettingsGenreSelect();
      renderSettingsGenreControls();
    }
  });

  els.settingsBtnGenreDown.addEventListener('click', async () => {
    const genreId = state.selectedSettingsGenreId;
    if (!genreId) return;
    const genres = db.getGenres();
    const idx = genres.findIndex(g => g.id === genreId);
    if (idx !== -1 && idx < genres.length - 1) {
      const g1 = genres[idx];
      const g2 = genres[idx + 1];
      const temp = g1.displayOrder;
      g1.displayOrder = g2.displayOrder;
      g2.displayOrder = temp;

      await db.updateGenre(g1.id, { displayOrder: g1.displayOrder });
      await db.updateGenre(g2.id, { displayOrder: g2.displayOrder });

      populateSettingsGenreSelect();
      renderSettingsGenreControls();
    }
  });

  // 8. Settings Modal - Criteria Template Copy
  els.settingsBtnCopyCriteria.addEventListener('click', async () => {
    const fromGenreId = els.settingsCopySourceSelect.value;
    const toGenreId = state.selectedSettingsGenreId || 'genre-default';
    if (!fromGenreId) {
      showToast('コピー元のジャンルが選択されていません。', 'error');
      return;
    }
    if (fromGenreId === toGenreId) {
      showToast('コピー元とコピー先が同じです。', 'error');
      return;
    }

    if (confirm('現在のジャンルの評価項目を上書きして、コピー元の項目に置き換えますか？')) {
      try {
        await db.copyCriteria(fromGenreId, toGenreId);
        renderSettingsCriteriaList();
        showToast('他のジャンルから評価項目をコピーしました。');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  // 9. Backup & Restore triggers
  els.btnBackupCreate.addEventListener('click', handleBackupCreate);
  els.btnBackupRestoreTrigger.addEventListener('click', () => {
    els.backupRestoreFile.click();
  });
  els.backupRestoreFile.addEventListener('change', handleBackupRestore);
  els.btnCleanOrphanData.addEventListener('click', handleCleanOrphanData);

  // Directory Settings Buttons
  els.btnFolderSelect.addEventListener('click', () => handleFolderSelect());
  els.btnFolderRescan.addEventListener('click', handleFolderRescan);
  els.btnFolderRequestPerm.addEventListener('click', handleFolderRequestPermission);
  els.btnFolderDisconnect.addEventListener('click', handleFolderDisconnect);
  els.btnFolderScanAbort.addEventListener('click', () => {
    abortFolderScanning();
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
  els.btnSaveReview.addEventListener('click', () => reviewEditorController.saveReviewForm());
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

  if (els.toastContainer) {
    els.toastContainer.appendChild(toast);
  } else {
    console.log(`[Toast] [${type}] ${message}`);
  }

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
  return syncActiveDirectoryPermissionsController({
    db,
    processBackgroundHashingQueue
  });
}

export async function processBackgroundHashingQueue() {
  await processBackgroundHashingQueueController({
    dbInstance: db,
    hashQueue: globalHashQueue,
    getFileHandleFn: getFileHandleFromRelativePath,
    computeHashFn: computeFileSHA256,
    logMetricFn: logMetric,
    onProgressChange: (force) => updateBackgroundHashingProgress(force),
    onLibraryRender: () => {
      renderLibrary();
      if (state.currentView === 'editor' && state.currentVideoId) {
        reviewEditorController.renderSharedReviews();
      }
    },
    onPendingResolved: (summary, video) => {
      if (summary && summary.resolved > 0 && video) {
        showToast(`共有レビュー ${summary.resolved}件を動画「${video.displayTitle || video.title}」に紐付けました`);
      }
    },
    onNewBatch: () => clearCloseTimeout()
  });
}

// Reusable helper to filter videos
function getFilteredVideosList() {
  let videos = db.getVideos();

  // 1. Text Search Filter
  if (state.filters.search) {
    const query = state.filters.search.toLowerCase();
    videos = videos.filter(v => (v.displayTitle || v.title).toLowerCase().includes(query) || v.fileName.toLowerCase().includes(query));
  }

  // 2. Tag Filter
  if (state.filters.tagId) {
    videos = filterVideosByTag(videos, db.videoTags, state.filters.tagId);
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
    if (state.filters.availability === 'no-directory') {
      videos = videos.filter(v => v.sourceType === 'directory' && !db.getDirectorySource(v.directoryId));
    } else if (state.filters.availability === 'isolated') {
      videos = videos.filter(v =>
        v.availabilityStatus === 'missing' ||
        v.availabilityStatus === 'scan-error' ||
        v.availabilityStatus === 'unsupported' ||
        (v.sourceType === 'directory' && !db.getDirectorySource(v.directoryId))
      );
    } else {
      videos = videos.filter(v => v.availabilityStatus === state.filters.availability);
    }
  }

  return videos;
}

async function handleBulkDelete() {
  const availabilityFilter = els.filterAvailability.value;
  if (!['missing', 'scan-error', 'no-directory', 'isolated'].includes(availabilityFilter)) return;

  await handleBulkDeleteAction({
    db,
    currentVideoId: state.currentVideoId,
    videoFilesMap: state.videoFilesMap,
    onRevoke: () => {
      revokeActiveBlobUrl();
      state.activeVideoFile = null;
    },
    showToast,
    handleBackToLibrary,
    renderLibrary,
    getFilteredVideosList,
    onLocationsRemoved: (locIds) => {
      handleLocationsRemoved(locIds, updateBackgroundHashingProgress);
    },
    confirm: (msg) => confirm(msg)
  });
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

  let videos = getFilteredVideosList();

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

  // Dynamic Bulk Delete Button update
  const availabilityFilter = els.filterAvailability.value;
  const isIsolatedFilter = ['missing', 'scan-error', 'no-directory', 'isolated'].includes(availabilityFilter);
  if (isIsolatedFilter && videos.length > 0) {
    els.btnBulkDelete.classList.remove('hidden');
    els.btnBulkDelete.textContent = `表示中の${videos.length}本を一括削除`;
  } else {
    els.btnBulkDelete.classList.add('hidden');
  }

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
      const hasDirectorySource = v.sourceType === 'directory' ? !!db.getDirectorySource(v.directoryId) : true;
      if (v.availabilityStatus === 'missing') {
        card.classList.add('status-missing');
      } else if (v.availabilityStatus === 'permission-required') {
        card.classList.add('status-permission-required');
      } else if (v.availabilityStatus === 'unsupported') {
        card.classList.add('status-unsupported');
      } else if (v.availabilityStatus === 'scan-error') {
        card.classList.add('status-scan-error');
      } else if (v.sourceType === 'directory' && !hasDirectorySource) {
        card.classList.add('status-no-directory');
      }


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

      // Status Banners on Thumbnail (Missing / Permission required / Unsupported / Scan Error / No Directory)
      if (v.sourceType === 'directory' && !hasDirectorySource) {
        const noDirBadge = document.createElement('span');
        noDirBadge.className = 'video-card-badge';
        noDirBadge.style.backgroundColor = 'var(--color-error)';
        noDirBadge.textContent = '参照フォルダなし';
        thumbDiv.appendChild(noDirBadge);
      } else if (v.availabilityStatus === 'missing') {
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

      if (state.shareExportMode) {
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'export-card-checkbox';
        chk.style.position = 'absolute';
        chk.style.top = '8px';
        chk.style.left = '8px';
        chk.style.width = '20px';
        chk.style.height = '20px';
        chk.style.zIndex = '10';
        chk.style.cursor = 'pointer';
        chk.checked = state.selectedExportVideoIds && state.selectedExportVideoIds.has(v.id);

        const canExport = isVideoEligibleForExport(db, v);
        if (!canExport) {
          chk.disabled = true;
          chk.title = 'ハッシュ値計算未完了、またはオーナーレビューが存在しないため選択できません';
        }

        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!canExport) return;
          if (chk.checked) {
            state.selectedExportVideoIds.add(v.id);
          } else {
            state.selectedExportVideoIds.delete(v.id);
          }
          document.getElementById('export-selected-count').textContent = state.selectedExportVideoIds.size;
        });

        card.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!canExport) {
            showToast('この動画はハッシュ値計算未完了、またはオーナーレビューが存在しないため選択できません。', 'warning');
            return;
          }
          if (state.selectedExportVideoIds.has(v.id)) {
            state.selectedExportVideoIds.delete(v.id);
            chk.checked = false;
          } else {
            state.selectedExportVideoIds.add(v.id);
            chk.checked = true;
          }
          document.getElementById('export-selected-count').textContent = state.selectedExportVideoIds.size;
        });

        thumbDiv.appendChild(chk);
      } else {
        card.addEventListener('click', () => switchScreenToEditor(v.id));
      }

      // Body wrapper
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'video-card-body';

      // Title Container to hold title text and delete button side-by-side
      const titleContainer = document.createElement('div');
      titleContainer.style.display = 'flex';
      titleContainer.style.justifyContent = 'space-between';
      titleContainer.style.alignItems = 'flex-start';
      titleContainer.style.gap = '8px';

      // Title heading
      const titleH4 = document.createElement('h4');
      titleH4.className = 'video-card-title';
      titleH4.title = v.displayTitle || v.title;
      titleH4.textContent = v.displayTitle || v.title;
      titleH4.style.flex = '1';
      titleContainer.appendChild(titleH4);

      // Card Delete Button (Archive)
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-icon btn-delete-card';
      delBtn.title = 'ライブラリからアーカイブ削除 (評価データは保持されます)';
      delBtn.style.padding = '2px';
      delBtn.style.color = 'var(--color-text-muted)';
      delBtn.style.cursor = 'pointer';
      delBtn.style.flexShrink = '0';
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>`;

      delBtn.addEventListener('mouseenter', () => { delBtn.style.color = 'var(--color-warning, #f59e0b)'; });
      delBtn.addEventListener('mouseleave', () => { delBtn.style.color = 'var(--color-text-muted)'; });

      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await archiveVideoAction({
          db,
          mediaAssetId: v.id,
          currentVideoId: state.currentVideoId,
          videoFilesMap: state.videoFilesMap,
          onRevoke: () => {
            revokeActiveBlobUrl();
            state.activeVideoFile = null;
          },
          showToast,
          handleBackToLibrary,
          renderLibrary,
          onLocationsRemoved: (locIds) => {
            handleLocationsRemoved(locIds, updateBackgroundHashingProgress);
          },
          confirm: (msg) => confirm(msg)
        });
      });

      // Card Permanent Delete Button
      const permDelBtn = document.createElement('button');
      permDelBtn.className = 'btn btn-icon btn-perm-delete-card';
      permDelBtn.title = '完全に削除 (評価データも削除され、再スキャンしても復元できません)';
      permDelBtn.style.padding = '2px';
      permDelBtn.style.color = 'var(--color-text-muted)';
      permDelBtn.style.cursor = 'pointer';
      permDelBtn.style.flexShrink = '0';
      permDelBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11l4 4m0-4l-4 4" />
      </svg>`;

      permDelBtn.addEventListener('mouseenter', () => { permDelBtn.style.color = 'var(--color-error)'; });
      permDelBtn.addEventListener('mouseleave', () => { permDelBtn.style.color = 'var(--color-text-muted)'; });

      permDelBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteVideoCascadeAction({
          db,
          mediaAssetId: v.id,
          currentVideoId: state.currentVideoId,
          videoFilesMap: state.videoFilesMap,
          onRevoke: () => {
            revokeActiveBlobUrl();
            state.activeVideoFile = null;
          },
          showToast,
          handleBackToLibrary,
          renderLibrary,
          onLocationsRemoved: (locIds) => {
            handleLocationsRemoved(locIds, updateBackgroundHashingProgress);
          },
          confirm: (msg) => confirm(msg)
        });
      });

      if (!state.shareExportMode) {
        titleContainer.appendChild(delBtn);
        titleContainer.appendChild(permDelBtn);
      }
      bodyDiv.appendChild(titleContainer);

      // Display original title as subtitle if displayTitle is present
      if (v.displayTitle) {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'video-card-meta-detail';
        fileDiv.style.fontStyle = 'italic';
        fileDiv.textContent = `ファイル: ${v.title}`;
        bodyDiv.appendChild(fileDiv);
      }
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

function renderLocationsListInEditor(video) {
  reviewEditorController.renderLocationsListInEditor(video);
}

// Switch Screen: Editor Workspace
function switchScreenToEditor(videoId) {
  reviewEditorController.switchScreenToEditor(videoId);
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

  const isDisconnected = !source.handleKey || source.permissionStatus === 'disconnected';
  let handle = null;
  if (!isDisconnected) {
    try {
      handle = await db.getDirectoryHandle(source.handleKey);
    } catch (err) {
      console.warn('Failed to retrieve folder handle:', err);
    }
  }

  if (isDisconnected || !handle) {
    // Clean up handleKey and update status
    await db.updateDirectorySource(source.id, { handleKey: '', permissionStatus: 'disconnected' });
    showToast('フォルダの参照データが見つかりません。フォルダを再接続してください。', 'error');
    openSettingsModal();
    return;
  }

  try {
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
    const locations = video.locations || [];
    if (locations.length === 0) {
      showFolderErrorOnPlayer('接続フォルダ設定が削除されています。');
      return;
    }

    let resolvedFile = null;
    let resolvedLoc = null;
    let resolvedSource = null;
    let hasPermissionError = false;
    let permissionErrorSource = null;
    let hasMissingHandleError = false;
    let missingHandleSource = null;

    for (const loc of locations) {
      const source = db.getDirectorySource(loc.directoryId);
      if (!source) continue;

      const isDisconnected = !source.handleKey || source.permissionStatus === 'disconnected';
      if (isDisconnected) {
        if (!hasMissingHandleError) {
          hasMissingHandleError = true;
          missingHandleSource = source;
        }
        continue;
      }

      try {
        const handle = await db.getDirectoryHandle(source.handleKey);
        if (!handle) {
          if (!hasMissingHandleError) {
            hasMissingHandleError = true;
            missingHandleSource = source;
          }
          continue;
        }

        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') {
          if (!hasPermissionError) {
            hasPermissionError = true;
            permissionErrorSource = source;
          }
          continue;
        }

        const fileHandle = await getFileHandleFromRelativePath(handle, loc.relativePath);
        const file = await fileHandle.getFile();
        resolvedFile = file;
        resolvedLoc = loc;
        resolvedSource = source;
        break;
      } catch (err) {
        console.warn(`Failed to resolve location ${loc.id}:`, err);
      }
    }

    if (resolvedFile) {
      // Record this successful playback location as preferred
      await db.updateLocationLastVerified(resolvedLoc.id);

      state.activeVideoFile = resolvedFile;
      const objectUrl = URL.createObjectURL(resolvedFile);
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
    } else if (hasPermissionError) {
      els.playerFolderPermissionButton.textContent = 'フォルダのアクセスを許可する';
      showFolderErrorOnPlayer(`動画フォルダ「${permissionErrorSource.name}」へのアクセス権限が必要です。`, 'permission');
    } else if (hasMissingHandleError) {
      els.playerFolderPermissionButton.textContent = 'フォルダを再接続する';
      showFolderErrorOnPlayer(`動画フォルダ「${missingHandleSource.name}」の接続ハンドルが見つかりません。再接続してください。`, 'permission');
    } else {
      // No location worked, mark the primary (first) location as missing
      const primaryLoc = locations[0] || {};
      showFolderErrorOnPlayer(`ファイルが見つかりません: ${primaryLoc.relativePath || '不明なパス'}`);
      await db.updateVideo(video.id, { availabilityStatus: 'missing', directoryId: primaryLoc.directoryId, relativePath: primaryLoc.relativePath });
      renderLibrary();
    }
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

  if (isIgnoredSystemEntry(file.name, file.name)) {
    showToast('このファイルはシステムファイルのため無視されました。', 'error');
    els.addLocalFileInput.value = '';
    return;
  }

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
      const qh = await computeQuickHash(file);
      const added = await db.addVideo({
        title: file.name,
        fileName: file.name,
        fileSize: file.size,
        duration: duration,
        thumbnailBlob: frameBlob,
        sourceType: 'local-file',
        quickHash: qh,
        hashStatus: 'calculating'
      });

      state.videoFilesMap.set(added.id, file);
      els.addLocalFileInput.value = '';

      switchScreenToEditor(added.id);
      showToast('動画を追加しました');

      // Trigger background full content hashing
      computeFileSHA256(file).then(async hash => {
        const result = await db.completeVideoHashing(added.id, hash);
        if (result.merged) {
          console.log(`Merged duplicate local asset: ${added.id} -> ${result.targetAssetId}`);
          switchScreenToEditor(result.targetAssetId);
        } else if (result.conflict) {
          console.log(`Conflict detected for local file contentHash ${hash}. Group ID: ${result.conflictGroupId}`);
        }
        if (result.resolvedPendingSummary && result.resolvedPendingSummary.resolved > 0) {
          showToast(`共有レビュー ${result.resolvedPendingSummary.resolved}件を動画「${added.title}」に紐付けました`);
        }
        renderLibrary();
      }).catch(async err => {
        console.error('Local file hashing failed:', err);
        await db.updateVideo(added.id, { hashStatus: 'failed' });
      });

    } catch (err) {
      showToast(`動画を追加できませんでした: ${err.message}`, 'error');
    }
  };

  tempVideo.onerror = async () => {
    cleanup();

    try {
      const qh = await computeQuickHash(file);
      const added = await db.addVideo({
        title: file.name,
        fileName: file.name,
        fileSize: file.size,
        duration: 0,
        thumbnailBlob: null,
        sourceType: 'local-file',
        quickHash: qh,
        hashStatus: 'calculating'
      });

      state.videoFilesMap.set(added.id, file);
      els.addLocalFileInput.value = '';
      switchScreenToEditor(added.id);
      showToast('動画を追加しました(再生時間未取得)');

      // Trigger background full content hashing
      computeFileSHA256(file).then(async hash => {
        const result = await db.completeVideoHashing(added.id, hash);
        if (result.merged) {
          console.log(`Merged duplicate local asset: ${added.id} -> ${result.targetAssetId}`);
          switchScreenToEditor(result.targetAssetId);
        } else if (result.conflict) {
          console.log(`Conflict detected for local file contentHash ${hash}. Group ID: ${result.conflictGroupId}`);
        }
        if (result.resolvedPendingSummary && result.resolvedPendingSummary.resolved > 0) {
          showToast(`共有レビュー ${result.resolvedPendingSummary.resolved}件を動画「${added.title}」に紐付けました`);
        }
        renderLibrary();
      }).catch(async err => {
        console.error('Local file hashing failed:', err);
        await db.updateVideo(added.id, { hashStatus: 'failed' });
      });

    } catch (err) {
      showToast(`動画を追加できませんでした: ${err.message}`, 'error');
    }
  };
}

// Reconnect file to play again
function handleReconnectFile(e) {
  const file = e.target.files[0];
  if (!file || !state.currentVideoId) return;

  if (isIgnoredSystemEntry(file.name, file.name)) {
    showToast('システムファイルは選択できません。', 'error');
    els.reconnectFileInput.value = '';
    return;
  }

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



// Navigate Adjacent Video
function navigateAdjacentVideo(direction) {
  let videos = db.getVideos();
  if (state.filters.search) {
    const query = state.filters.search.toLowerCase();
    videos = videos.filter(v => (v.displayTitle || v.title).toLowerCase().includes(query) || v.fileName.toLowerCase().includes(query));
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
  reviewEditorController.renderStarCriteriaPanel();
}

// Redraw custom Radar
function updateRadar() {
  reviewEditorController.updateRadar();
}

// Render video tags chips (XSS Safe DOM)
function renderVideoTagsList() {
  reviewEditorController.renderVideoTagsList();
}

// Tags Autocomplete dropdown
function handleTagInputAutocomplete() {
  reviewEditorController.handleTagInputFieldAutocomplete();
}

// Handle enter button inside tag input field
async function handleTagInputKeydown(e) {
  await reviewEditorController.handleTagInputKeydown(e, isTagInputComposing);
}

// Render Timeline notes (XSS Safe DOM)
function renderTimelineNotesList() {
  reviewEditorController.renderTimelineNotesList();
}

// Capture current video timestamp context details
async function captureTimelineTimestamp() {
  await reviewEditorController.captureTimelineTimestamp();
}

// Add Timeline note item save to DB
async function addTimelineNote() {
  await reviewEditorController.addTimelineNote();
}

// Save Ratings review data
async function saveReviewForm(isAutosave = false) {
  await reviewEditorController.saveReviewForm(isAutosave);
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

  // Set active settings genre ID
  if (state.currentVideoId && state.currentView === 'editor') {
    const video = db.getVideo(state.currentVideoId);
    state.selectedSettingsGenreId = video ? (video.genreId || 'genre-default') : 'genre-default';
  } else {
    state.selectedSettingsGenreId = 'genre-default';
  }

  // Populate dropdowns & configure states
  populateSettingsGenreSelect();
  renderSettingsGenreControls();
  renderSettingsCriteriaList();

  // Populate backup timestamp label
  const lastBackup = localStorage.getItem('vreview_last_backup_time');
  els.backupLastTimeVal.textContent = lastBackup ? new Date(lastBackup).toLocaleString() : '未作成';

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
  const dirVideoCount = source
    ? db.getVideos().filter(v => v.sourceType === 'directory' && v.directoryId === source.id).length
    : 0;

  renderFolderSettingsUI({
    source,
    dirVideoCount,
    els
  });
}

// Select a new folder on the host machine using a Two-Phase Commit with Rollback
export async function handleFolderSelect(reconnectSourceId = null) {
  return handleFolderSelectController({
    db,
    reconnectSourceId,
    isRecursiveChecked: els.folderRecursiveCheckbox?.checked || false,
    showToast,
    renderFolderSettingsPanel,
    renderLibrary,
    confirm: (msg) => confirm(msg),
    startFolderScanningFn: (source, handle) => startFolderScanning(source, handle)
  });
}

// Request permission context explicitly inside user click
export async function handleFolderRequestPermission() {
  return handleFolderRequestPermissionController({
    db,
    showToast,
    renderFolderSettingsPanel,
    renderLibrary,
    handleFolderSelectFn: (id) => handleFolderSelect(id)
  });
}

// Rescan current connected folder
async function handleFolderRescan() {
  return handleFolderRescanController({
    db,
    showToast,
    startFolderScanningFn: (source, handle) => startFolderScanning(source, handle)
  });
}

// Non-blocking Folder scanner using the shared directory-scanner.js module
async function startFolderScanning(source, handle) {
  return startFolderScanningController({
    db,
    source,
    handle,
    recursive: els.folderRecursiveCheckbox?.checked || false,
    scanDirectory,
    applyScanDifferentials,
    processBackgroundHashingQueue,
    updateScanProgressUI: (checkedFiles, detectedVideos, show) => updateScanProgressUI(els, checkedFiles, detectedVideos, show),
    showToast,
    alert: (msg) => alert(msg),
    renderFolderSettingsPanel,
    renderLibrary
  });
}

// Confirm Disconnect Folder Source
async function handleFolderDisconnect() {
  return handleFolderDisconnectController({
    db,
    globalHashQueue,
    bgHashState,
    updateBackgroundHashingProgress,
    showToast,
    renderFolderSettingsPanel,
    renderLibrary,
    confirm: (msg) => confirm(msg)
  });
}

// Settings criteria rows renderer (XSS Safe DOM)
function renderSettingsCriteriaList() {
  const genreId = state.selectedSettingsGenreId || 'genre-default';
  const criteria = db.getCriteriaForGenre(genreId);
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
        const activeCount = db.getActiveCriteriaForGenre(genreId).length;
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

  const genreId = state.selectedSettingsGenreId || 'genre-default';
  try {
    await db.addCriterionToGenre(genreId, name);
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
      reviewEditorController.captureTimelineTimestamp();
    }
  }

  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (state.currentView === 'editor') {
      reviewEditorController.saveReviewForm();
    }
  }
}

// --- VIDEOPLAY / EVALUATION GENRES & BACKUP HELPERS ---

function populateSettingsGenreSelect() {
  const genres = db.getGenres();

  // 1. Configure configuration genre select dropdown
  els.settingsGenreSelect.innerHTML = '';
  genres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.isActive ? g.name : `${g.name} (無効)`;
    els.settingsGenreSelect.appendChild(opt);
  });

  if (state.selectedSettingsGenreId) {
    els.settingsGenreSelect.value = state.selectedSettingsGenreId;
  } else if (genres.length > 0) {
    state.selectedSettingsGenreId = genres[0].id;
    els.settingsGenreSelect.value = genres[0].id;
  }

  // 2. Configure copy source select dropdown (only active genres, excluding current one)
  els.settingsCopySourceSelect.innerHTML = '';
  const currentGenreId = state.selectedSettingsGenreId;

  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '-- コピー元ジャンルを選択 --';
  els.settingsCopySourceSelect.appendChild(placeholderOpt);

  genres.forEach(g => {
    if (g.isActive && g.id !== currentGenreId) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      els.settingsCopySourceSelect.appendChild(opt);
    }
  });
}

function renderSettingsGenreControls() {
  const genreId = state.selectedSettingsGenreId || 'genre-default';
  const genre = db.getGenre(genreId);
  if (!genre) return;

  if (genre.isActive) {
    els.settingsBtnGenreToggleActive.textContent = '無効化';
    els.settingsBtnGenreToggleActive.className = 'btn btn-danger';
  } else {
    els.settingsBtnGenreToggleActive.textContent = '有効化';
    els.settingsBtnGenreToggleActive.className = 'btn btn-primary';
  }

  const genres = db.getGenres();
  const idx = genres.findIndex(g => g.id === genreId);
  els.settingsBtnGenreUp.disabled = (idx <= 0);
  els.settingsBtnGenreDown.disabled = (idx === -1 || idx === genres.length - 1);
}

// Helper to generate a ZIP Blob of the current database state
async function generateLocalBackupZipBlob() {
  const images = await db.getAllImages();
  const dbData = {
    schemaVersion: 4,
    reviewers: db.reviewers || [],
    media_assets: db.mediaAssets,
    file_locations: db.fileLocations,
    rating_criteria: db.criteria,
    video_reviews: db.reviews,
    criterion_ratings: db.criterionRatings,
    tags: db.tags,
    review_tags: db.reviewTags || [],
    timeline_notes: db.timelineNotes,
    directory_sources: db.directorySources,
    genres: db.genres,
    evaluation_templates: db.templates,
    pending_shared_reviews: db.pendingSharedReviews || []
  };

  // Strip DirectoryHandles and reset status to 'prompt'
  dbData.directory_sources = dbData.directory_sources.map(src => ({
    ...src,
    permissionStatus: 'prompt'
  }));

  const manifest = {
    application: "VideoReviewer",
    schemaVersion: 4,
    createdAt: new Date().toISOString(),
    appVersion: "1.0.0",
    counts: {
      media_assets: db.mediaAssets.length,
      file_locations: db.fileLocations.length,
      reviews: db.reviews.length,
      images: images.length,
      reviewers: (db.reviewers || []).length,
      review_tags: (db.reviewTags || []).length,
      pending_shared_reviews: (db.pendingSharedReviews || []).length
    }
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('database.json', JSON.stringify(dbData, null, 2));

  const imgFolder = zip.folder('images');
  const thumbFolder = imgFolder.folder('thumbnails');
  const noteFolder = imgFolder.folder('timeline-notes');

  images.forEach(image => {
    if (image.id.startsWith('img-vid-')) {
      thumbFolder.file(image.id, image.data);
    } else if (image.id.startsWith('img-note-')) {
      noteFolder.file(image.id, image.data);
    } else {
      thumbFolder.file(image.id, image.data);
    }
  });

  return await zip.generateAsync({ type: 'blob' });
}

// DB Backup Zip Creator
async function handleBackupCreate() {
  els.backupProgressTitle.textContent = 'バックアップを作成中...';
  els.backupProgressMsg.textContent = 'データベースおよび画像をパッケージ化しています。';
  els.modalBackupProgress.classList.add('open');

  try {
    const content = await generateLocalBackupZipBlob();

    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    link.download = `VideoReviewer-backup-${timestamp}.zip`;
    link.click();

    localStorage.setItem('vreview_last_backup_time', new Date().toISOString());
    els.backupLastTimeVal.textContent = new Date().toLocaleString();

    showToast('バックアップを作成しました。');
  } catch (err) {
    console.error(err);
    showToast(`バックアップ作成に失敗しました: ${err.message}`, 'error');
  } finally {
    els.modalBackupProgress.classList.remove('open');
  }
}

// DB Backup Zip Restorer
async function handleBackupRestore(e) {
  const file = e.target.files[0];
  if (!file) return;

  els.backupProgressTitle.textContent = 'バックアップを検証中...';
  els.backupProgressMsg.textContent = 'ファイルを読み込んで内容を確認しています。';
  els.modalBackupProgress.classList.add('open');

  try {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('manifest.json');
    const dbFile = zip.file('database.json');

    if (!manifestFile || !dbFile) {
      throw new Error('ZIP内に必要なファイル（manifest.json, database.json）が見つかりません。');
    }

    const manifest = JSON.parse(await manifestFile.async('string'));
    if (manifest.application !== 'VideoReviewer') {
      throw new Error('VideoReviewerのバックアップファイルではありません。');
    }

    const parsedDb = JSON.parse(await dbFile.async('string'));

    // Extract image IDs/keys from ZIP for validation
    const imageIds = [];
    const thumbnailsFolder = zip.folder('images/thumbnails');
    const notesFolder = zip.folder('images/timeline-notes');
    if (thumbnailsFolder) {
      thumbnailsFolder.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) imageIds.push(relativePath);
      });
    }
    if (notesFolder) {
      notesFolder.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) imageIds.push(relativePath);
      });
    }

    // Invoke production database validation before overwrite confirmation
    const validationResult = db.validateBackupData(parsedDb, manifest, imageIds);
    if (!validationResult.isValid) {
      throw new Error('検証エラーが発生しました:\n' + validationResult.fatalErrors.join('\n'));
    }

    els.modalBackupProgress.classList.remove('open');

    const irreparableWarnings = validationResult.warnings.filter(w => !w.repaired);
    const repairedWarnings = validationResult.warnings.filter(w => w.repaired);

    let confirmMsg = `バックアップデータを復元しますか？\n現在のデータは上書きされ、復元されたデータに置き換わります。\n\n` +
      `作成日時: ${new Date(manifest.createdAt).toLocaleString()}\n` +
      `動画数: ${manifest.counts.media_assets !== undefined ? manifest.counts.media_assets : manifest.counts.videos}本\n` +
      `レビュー数: ${manifest.counts.reviews}件\n` +
      `画像数: ${manifest.counts.images}枚\n\n`;

    if (repairedWarnings.length > 0) {
      confirmMsg += `【自動修復】\n旧バージョンの孤立したタイムラインメモ ${repairedWarnings.length} 件を修復しました（レビューへの再紐付け）。\n\n`;
    }

    if (irreparableWarnings.length > 0) {
      confirmMsg += `【警告：孤立データの除外】\n以下の修復不可能な孤立したタイムラインメモ ${irreparableWarnings.length} 件を除外して復元します。これらは復旧できません。\n` +
        `対象ID: ${irreparableWarnings.map(w => w.noteId).join(', ')}\n\n`;
    }

    confirmMsg += `※ 復元前に現在のデータが自動でダウンロード退避されます。\n本当に復元しますか？`;

    if (!confirm(confirmMsg)) {
      els.backupRestoreFile.value = '';
      return;
    }

    // Phase 1: Generate safety download ZIP of current state before restore starts
    els.backupProgressTitle.textContent = '現在のデータを退避中...';
    els.backupProgressMsg.textContent = '上書き前のデータを安全にZIPへ書き出しています。';
    els.modalBackupProgress.classList.add('open');

    const safetyZipBlob = await generateLocalBackupZipBlob();
    const safetyLink = document.createElement('a');
    safetyLink.href = URL.createObjectURL(safetyZipBlob);
    const safetyTimestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    safetyLink.download = `VideoReviewer-safety-backup-before-restore-${safetyTimestamp}.zip`;
    safetyLink.click();

    els.backupProgressTitle.textContent = 'データを復元中...';
    els.backupProgressMsg.textContent = 'データベースの上書き処理を実行しています。';

    // Phase 2: Extract images and execute production restore
    try {
      const imageEntries = [];
      const imagePromises = [];

      if (thumbnailsFolder) {
        thumbnailsFolder.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir) {
            imagePromises.push(
              zipEntry.async('blob').then(blob => {
                imageEntries.push({ id: relativePath, data: blob });
              })
            );
          }
        });
      }

      if (notesFolder) {
        notesFolder.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir) {
            imagePromises.push(
              zipEntry.async('blob').then(blob => {
                imageEntries.push({ id: relativePath, data: blob });
              })
            );
          }
        });
      }

      await Promise.all(imagePromises);

      // Exclude orphaned images by filtering based on requiredImageIds from validationResult
      const filteredImageEntries = imageEntries.filter(img => validationResult.requiredImageIds.includes(img.id));

      // Invoke production DB restore routine with repaired database and filtered images (rollback transaction on failure)
      await db.restoreWithRollback(validationResult.repairedDb, filteredImageEntries);

      els.modalBackupProgress.classList.remove('open');
      showToast('データの復元が完了しました。自動再読み込みします。');
      setTimeout(() => {
        window.location.reload();
      }, 1000);

    } catch (innerErr) {
      console.error('Error during write phase:', innerErr);
      throw new Error('復元書き込み処理中にエラーが発生しました。データを元の状態にロールバックしました。: ' + innerErr.message);
    }

  } catch (err) {
    console.error(err);
    alert(`復元に失敗しました: ${err.message}`);
  } finally {
    els.backupRestoreFile.value = '';
    els.modalBackupProgress.classList.remove('open');
  }
}

// Clean up orphan timeline notes and unreferenced images
async function handleCleanOrphanData() {
  try {
    const { orphanNotes, unreferencedImageIds } = await db.checkOrphanData();

    if (orphanNotes.length === 0 && unreferencedImageIds.length === 0) {
      alert('クリーンアップが必要な孤立データ（メモ・画像）は見つかりませんでした。');
      return;
    }

    let confirmMsg = 'データベース内の孤立データをクリーンアップしますか？\n\n' +
      `孤立したタイムラインメモ: ${orphanNotes.length} 件\n` +
      `参照されていない画像: ${unreferencedImageIds.length} 枚\n\n` +
      '※ この操作は元に戻せません。本当に実行しますか？';

    if (!confirm(confirmMsg)) {
      return;
    }

    const { notesCleanedCount, imagesCleanedCount } = await db.cleanOrphanData();

    showToast(`クリーンアップを完了しました（タイムラインメモ: ${notesCleanedCount}件、画像: ${imagesCleanedCount}枚）。`);
    renderLibrary();
  } catch (err) {
    console.error(err);
    alert(`クリーンアップに失敗しました: ${err.message}`);
  }
}
