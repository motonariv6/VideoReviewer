// review-share-ui.js - Handles the UI interactions for exporting/importing reviews
import { exportReviews, isVideoEligibleForExport } from './review-share-exporter.js';
import { importPackage } from './review-share-importer.js';
import { validateSharedReviewPackage } from './review-share-validator.js';
import { scoreToGrade } from './review-share-model.js';

let dbRef = null;
let stateRef = null;
let showToastRef = null;
let renderLibraryRef = null;

// UI Elements caching
let elements = {};
let currentImportPackage = null;

let getFilteredVideosListRef = null;

/**
 * Initializes the Review Sharing UI controls and binds events.
 * @param {AppDatabase} db
 * @param {object} state
 * @param {function} showToast
 * @param {function} renderLibrary
 * @param {function} getFilteredVideosList
 */
export function initShareUI(db, state, showToast, renderLibrary, getFilteredVideosList) {
  dbRef = db;
  stateRef = state;
  showToastRef = showToast;
  renderLibraryRef = renderLibrary;
  getFilteredVideosListRef = getFilteredVideosList;

  // Cache elements
  elements = {
    standardActions: document.getElementById('library-standard-actions'),
    exportActions: document.getElementById('library-export-actions'),
    exportSelectedCount: document.getElementById('export-selected-count'),
    btnExportStart: document.getElementById('btn-share-export-start'),
    btnExportCancel: document.getElementById('btn-share-export-cancel'),
    btnExportSelectAll: document.getElementById('btn-share-export-select-all'),
    btnExportDeselectAll: document.getElementById('btn-share-export-deselect-all'),
    btnExportSubmit: document.getElementById('btn-share-export-submit'),
    btnImportTrigger: document.getElementById('btn-share-import-trigger'),
    importFileInput: document.getElementById('share-import-file'),

    // Import Preview Modal
    modalImportPreview: document.getElementById('modal-share-import-preview'),
    importCloseX: document.getElementById('share-import-preview-close-x'),
    importExporterName: document.getElementById('import-exporter-name'),
    importExportedAt: document.getElementById('import-exported-at'),
    importPreviewList: document.getElementById('share-import-preview-list'),
    btnImportSelectAll: document.getElementById('btn-share-import-select-all'),
    btnImportDeselectAll: document.getElementById('btn-share-import-deselect-all'),
    btnImportPreviewCancel: document.getElementById('btn-share-import-preview-cancel'),
    btnImportPreviewSubmit: document.getElementById('btn-share-import-preview-submit'),
    importPreviewSelectedCount: document.getElementById('import-preview-selected-count')
  };

  // Bind Events
  if (elements.btnExportStart) {
    elements.btnExportStart.addEventListener('click', startExportMode);
  }
  if (elements.btnExportCancel) {
    elements.btnExportCancel.addEventListener('click', cancelExportMode);
  }
  if (elements.btnExportSelectAll) {
    elements.btnExportSelectAll.addEventListener('click', selectAllExport);
  }
  if (elements.btnExportDeselectAll) {
    elements.btnExportDeselectAll.addEventListener('click', deselectAllExport);
  }
  if (elements.btnExportSubmit) {
    elements.btnExportSubmit.addEventListener('click', submitExport);
  }
  if (elements.btnImportTrigger) {
    elements.btnImportTrigger.addEventListener('click', () => {
      if (elements.importFileInput) {
        elements.importFileInput.click();
      }
    });
  }
  if (elements.importFileInput) {
    elements.importFileInput.addEventListener('change', handleFileImport);
  }
  if (elements.importCloseX) {
    elements.importCloseX.addEventListener('click', closeImportPreview);
  }
  if (elements.btnImportPreviewCancel) {
    elements.btnImportPreviewCancel.addEventListener('click', closeImportPreview);
  }
  if (elements.btnImportSelectAll) {
    elements.btnImportSelectAll.addEventListener('click', selectAllImportPreview);
  }
  if (elements.btnImportDeselectAll) {
    elements.btnImportDeselectAll.addEventListener('click', deselectAllImportPreview);
  }
  if (elements.btnImportPreviewSubmit) {
    elements.btnImportPreviewSubmit.addEventListener('click', submitImport);
  }
}

// === EXPORT MODE CONTROLS ===

function startExportMode() {
  stateRef.shareExportMode = true;
  stateRef.selectedExportVideoIds = new Set();

  if (elements.standardActions) elements.standardActions.classList.add('hidden');
  if (elements.exportActions) elements.exportActions.classList.remove('hidden');

  updateExportSelectedCount();
  renderLibraryRef();
  showToastRef('エクスポート選択モードを開始しました。アセットを選択してください。', 'success');
}

export function cancelExportMode() {
  stateRef.shareExportMode = false;
  stateRef.selectedExportVideoIds = new Set();

  if (elements.standardActions) elements.standardActions.classList.remove('hidden');
  if (elements.exportActions) elements.exportActions.classList.add('hidden');

  renderLibraryRef();
}

function updateExportSelectedCount() {
  if (elements.exportSelectedCount) {
    elements.exportSelectedCount.textContent = stateRef.selectedExportVideoIds ? stateRef.selectedExportVideoIds.size : 0;
  }
}

function selectAllExport() {
  const filteredVideos = getFilteredVideosListLocal();
  let count = 0;
  filteredVideos.forEach(v => {
    if (isVideoEligibleForExport(dbRef, v)) {
      stateRef.selectedExportVideoIds.add(v.id);
      count++;
    }
  });
  updateExportSelectedCount();
  renderLibraryRef();
  if (count === 0) {
    showToastRef('エクスポート可能な有効なハッシュ値とレビューを持つ動画がありません。', 'warning');
  }
}

function deselectAllExport() {
  stateRef.selectedExportVideoIds.clear();
  updateExportSelectedCount();
  renderLibraryRef();
}

function submitExport() {
  if (!stateRef.selectedExportVideoIds || stateRef.selectedExportVideoIds.size === 0) {
    showToastRef('エクスポート対象の動画が選択されていません。', 'error');
    return;
  }

  try {
    const pkg = exportReviews(dbRef, Array.from(stateRef.selectedExportVideoIds));
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `reviews-share-${pkg.packageId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToastRef('共有レビューのエクスポートに成功しました。', 'success');
    cancelExportMode();
  } catch (err) {
    showToastRef(err.message, 'error');
  }
}

// === IMPORT MODE CONTROLS ===

function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const pkg = JSON.parse(evt.target.result);

      // Perform validation before showing preview
      const validation = validateSharedReviewPackage(pkg);
      if (!validation.isValid) {
        showToastRef('インポートパッケージの検証に失敗しました:\n' + validation.errors.join('; '), 'error');
        elements.importFileInput.value = '';
        return;
      }

      currentImportPackage = pkg;
      openImportPreview(pkg);
    } catch (err) {
      showToastRef('JSONの解析に失敗しました: ' + err.message, 'error');
      elements.importFileInput.value = '';
    }
  };
  reader.readAsText(file);
}

function openImportPreview(pkg) {
  if (elements.importExporterName) {
    elements.importExporterName.textContent = pkg.exporter.displayName;
  }
  if (elements.importExportedAt) {
    elements.importExportedAt.textContent = new Date(pkg.exportedAt).toLocaleString('ja-JP');
  }

  if (elements.importPreviewList) {
    elements.importPreviewList.innerHTML = '';

    pkg.items.forEach((item, idx) => {
      const { videoHash, review } = item;
      const { reviewId, reviewerId } = review;

      const matchedVideo = dbRef.findVideoByContentHash(videoHash);

      // Check duplicates using clean DB APIs
      const isDuplicateImported = !!dbRef.findReviewBySourceId(reviewId, reviewerId);
      const isDuplicatePending = dbRef.hasPendingSharedReview(videoHash, reviewId, reviewerId);
      const isDuplicate = isDuplicateImported || isDuplicatePending;

      let titleText = '(動画未登録)';
      let statusText = '未登録 (保留保存)';
      let statusStyle = 'color: var(--color-warning, #f59e0b); font-weight: 600;';

      if (matchedVideo) {
        titleText = matchedVideo.displayTitle || matchedVideo.title;
        statusText = 'ローカル一致';
        statusStyle = 'color: var(--color-success, #10b981); font-weight: 600;';
      }

      if (isDuplicate) {
        statusText = '重複 (スキップ予定)';
        statusStyle = 'color: var(--color-text-muted, #9ca3af); font-style: italic;';
      }

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--color-border)';

      // Checkbox TD
      const tdCheck = document.createElement('td');
      tdCheck.style.padding = '10px';
      tdCheck.style.textAlign = 'center';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'share-import-item-checkbox';
      chk.dataset.index = idx;
      // Duplicates are unchecked and disabled
      if (isDuplicate) {
        chk.checked = false;
        chk.disabled = true;
        chk.title = '既にインポート済み、または保留リストに存在します';
      } else {
        chk.checked = true;
      }
      chk.addEventListener('change', updateImportPreviewCount);
      tdCheck.appendChild(chk);
      tr.appendChild(tdCheck);

      // Title & Hash TD
      const tdTitle = document.createElement('td');
      tdTitle.style.padding = '10px';

      const mainTitle = document.createElement('div');
      mainTitle.style.fontWeight = '500';
      mainTitle.textContent = titleText;
      tdTitle.appendChild(mainTitle);

      const hashDiv = document.createElement('div');
      hashDiv.style.fontSize = '0.75rem';
      hashDiv.style.color = 'var(--color-text-dim)';
      hashDiv.textContent = `SHA-256: ${videoHash}`;
      tdTitle.appendChild(hashDiv);
      tr.appendChild(tdTitle);

      // Status TD
      const tdStatus = document.createElement('td');
      tdStatus.style.padding = '10px';
      tdStatus.style.cssText += statusStyle;
      tdStatus.textContent = statusText;
      tr.appendChild(tdStatus);

      // Rating TD
      const tdRating = document.createElement('td');
      tdRating.style.padding = '10px';
      tdRating.style.textAlign = 'center';
      tdRating.textContent = review.overallRating ? scoreToGrade(review.overallRating) : '未評価';
      tr.appendChild(tdRating);

      // Tags Count TD
      const tdTags = document.createElement('td');
      tdTags.style.padding = '10px';
      tdTags.style.textAlign = 'center';
      tdTags.textContent = review.tags ? review.tags.length : 0;
      tr.appendChild(tdTags);

      // Comments Count TD
      const tdComments = document.createElement('td');
      tdComments.style.padding = '10px';
      tdComments.style.textAlign = 'center';
      tdComments.textContent = review.timelineComments ? review.timelineComments.length : 0;
      tr.appendChild(tdComments);

      elements.importPreviewList.appendChild(tr);
    });
  }

  updateImportPreviewCount();
  if (elements.modalImportPreview) {
    elements.modalImportPreview.classList.add('open');
  }
}

function closeImportPreview() {
  if (elements.modalImportPreview) {
    elements.modalImportPreview.classList.remove('open');
  }
  if (elements.importFileInput) {
    elements.importFileInput.value = '';
  }
  currentImportPackage = null;
}

function updateImportPreviewCount() {
  if (!elements.importPreviewList) return;
  const checkboxes = elements.importPreviewList.querySelectorAll('.share-import-item-checkbox');
  let checkedCount = 0;
  checkboxes.forEach(chk => {
    if (chk.checked) checkedCount++;
  });
  if (elements.importPreviewSelectedCount) {
    elements.importPreviewSelectedCount.textContent = checkedCount;
  }
}

function selectAllImportPreview() {
  if (!elements.importPreviewList) return;
  const checkboxes = elements.importPreviewList.querySelectorAll('.share-import-item-checkbox');
  checkboxes.forEach(chk => {
    if (!chk.disabled) {
      chk.checked = true;
    }
  });
  updateImportPreviewCount();
}

function deselectAllImportPreview() {
  if (!elements.importPreviewList) return;
  const checkboxes = elements.importPreviewList.querySelectorAll('.share-import-item-checkbox');
  checkboxes.forEach(chk => {
    chk.checked = false;
  });
  updateImportPreviewCount();
}

function submitImport() {
  if (!currentImportPackage || !elements.importPreviewList) return;

  const checkboxes = elements.importPreviewList.querySelectorAll('.share-import-item-checkbox');
  const selectedIndices = [];
  checkboxes.forEach(chk => {
    if (chk.checked) {
      selectedIndices.push(parseInt(chk.dataset.index));
    }
  });

  if (selectedIndices.length === 0) {
    showToastRef('インポート対象が選択されていません。', 'error');
    return;
  }

  try {
    const summary = importPackage(dbRef, currentImportPackage, selectedIndices);

    // Display summary results
    const summaryText = `インポート完了しました。\n` +
      `インポート成功: ${summary.imported} 件\n` +
      `保留保存(未登録): ${summary.pending} 件\n` +
      `重複スキップ: ${summary.duplicate} 件\n` +
      `保護/スキップ: ${summary.protected} 件\n` +
      `失敗: ${summary.failed} 件`;

    alert(summaryText); // using standard alert as per requirement (or we can show modal/toast)
    showToastRef('インポートが完了しました。', 'success');
    closeImportPreview();
    renderLibraryRef();
  } catch (err) {
    showToastRef('インポート中にエラーが発生しました: ' + err.message, 'error');
  }
}

// Helper local proxy to avoid import loops or missing definitions
function getFilteredVideosListLocal() {
  if (getFilteredVideosListRef && typeof getFilteredVideosListRef === 'function') {
    return getFilteredVideosListRef();
  }
  return dbRef.getVideos();
}
