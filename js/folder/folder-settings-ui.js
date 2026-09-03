// folder-settings-ui.js - Pure DOM rendering logic for folder management

import { t, currentLocale } from '../i18n.js';

export function renderFolderSettingsUI({
  source,
  dirVideoCount,
  els
}) {
  if (!source) {
    els.folderNameVal.textContent = '-';
    els.folderStatusVal.textContent = t('folder.statusDisconnected');
    els.folderStatusVal.style.color = 'var(--color-text-muted)';
    els.folderPermissionVal.textContent = '-';
    els.folderVideoCountVal.textContent = t('folder.videoCountFormat', { count: 0 });
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
  const isDisconnected = !source.handleKey || source.permissionStatus === 'disconnected';
  els.folderStatusVal.textContent = isDisconnected ? t('folder.statusReconnecting') : t('folder.statusConnected');
  els.folderStatusVal.style.color = isDisconnected ? 'var(--color-error)' : 'var(--color-success)';

  // Permission status
  let permColor = 'var(--color-text-dim)';
  let permText = t('folder.statusChecking');

  if (isDisconnected) {
    permText = t('folder.statusReconnecting');
    permColor = 'var(--color-error)';
    els.btnFolderRequestPerm.textContent = t('folder.btnReconnectFolder');
    els.btnFolderRequestPerm.classList.remove('hidden');
    els.btnFolderRescan.classList.add('hidden');
  } else {
    els.btnFolderRequestPerm.textContent = t('folder.btnGrantAccess');
    if (source.permissionStatus === 'granted') {
      permText = t('folder.statusPermGranted');
      permColor = 'var(--color-success)';

      els.btnFolderRequestPerm.classList.add('hidden');
      els.btnFolderRescan.classList.remove('hidden');
    } else if (source.permissionStatus === 'prompt') {
      permText = t('folder.statusPermRequired');
      permColor = 'var(--color-warning)';

      els.btnFolderRequestPerm.classList.remove('hidden');
      els.btnFolderRescan.classList.add('hidden');
    } else {
      permText = t('folder.statusPermDenied');
      permColor = 'var(--color-error)';

      els.btnFolderRequestPerm.classList.remove('hidden');
      els.btnFolderRescan.classList.add('hidden');
    }
  }

  els.folderPermissionVal.textContent = permText;
  els.folderPermissionVal.style.color = permColor;

  // Registered videos count
  els.folderVideoCountVal.textContent = t('folder.videoCountFormat', { count: dirVideoCount });

  // Last scan
  els.folderLastScanVal.textContent = source.lastScannedAt
    ? new Date(source.lastScannedAt).toLocaleString(currentLocale === 'ja' ? 'ja-JP' : (currentLocale === 'zh-CN' ? 'zh-CN' : 'en-US'))
    : t('folder.neverScanned');

  // Checkbox state
  els.folderRecursiveCheckbox.checked = source.includeSubdirectories;

  els.btnFolderSelect.classList.add('hidden');
  els.btnFolderDisconnect.classList.remove('hidden');
}

export function updateScanProgressUI(els, checkedFiles, detectedVideos, show = true) {
  if (show) {
    els.scanProgressBox.classList.remove('hidden');
    els.scanProgressFiles.textContent = checkedFiles.toString();
    els.scanProgressVideos.textContent = detectedVideos.toString();
  } else {
    els.scanProgressBox.classList.add('hidden');
  }
}
