// folder-settings-ui.js - Pure DOM rendering logic for folder management

export function renderFolderSettingsUI({
  source,
  dirVideoCount,
  els
}) {
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
  const isDisconnected = !source.handleKey || source.permissionStatus === 'disconnected';
  els.folderStatusVal.textContent = isDisconnected ? '再接続が必要' : '接続済み';
  els.folderStatusVal.style.color = isDisconnected ? 'var(--color-error)' : 'var(--color-success)';

  // Permission status
  let permColor = 'var(--color-text-dim)';
  let permText = '確認中';

  if (isDisconnected) {
    permText = '再接続が必要';
    permColor = 'var(--color-error)';
    els.btnFolderRequestPerm.textContent = 'フォルダを再接続';
    els.btnFolderRequestPerm.classList.remove('hidden');
    els.btnFolderRescan.classList.add('hidden');
  } else {
    els.btnFolderRequestPerm.textContent = 'アクセスを許可';
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
  }

  els.folderPermissionVal.textContent = permText;
  els.folderPermissionVal.style.color = permColor;

  // Registered videos count
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

export function updateScanProgressUI(els, checkedFiles, detectedVideos, show = true) {
  if (show) {
    els.scanProgressBox.classList.remove('hidden');
    els.scanProgressFiles.textContent = checkedFiles.toString();
    els.scanProgressVideos.textContent = detectedVideos.toString();
  } else {
    els.scanProgressBox.classList.add('hidden');
  }
}
