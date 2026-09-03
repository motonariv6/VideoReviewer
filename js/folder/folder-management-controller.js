// folder-management-controller.js - Business logic for folder management

import { t } from '../i18n.js';

let scanAbortController = null;
let scanAbortState = false;
let isScanning = false;

export async function syncActiveDirectoryPermissions({
  db,
  processBackgroundHashingQueue
}) {
  const sources = db.getDirectorySources();
  for (const source of sources) {
    try {
      const handle = await db.getDirectoryHandle(source.handleKey);
      if (handle) {
        const status = await handle.queryPermission({ mode: 'read' });
        await db.updateDirectorySource(source.id, { permissionStatus: status });

        // Sync videos availabilityStatus based on permission
        db.fileLocations.forEach(loc => {
          if (loc.directoryId === source.id) {
            loc.availabilityStatus = (status === 'granted') ? 'available' : 'permission-required';
          }
        });
        db._saveTable('file_locations', db.fileLocations);

        if (status === 'granted') {
          processBackgroundHashingQueue();
        }
      } else {
        await db.updateDirectorySource(source.id, { permissionStatus: 'prompt' });
        db.fileLocations.forEach(loc => {
          if (loc.directoryId === source.id) {
            loc.availabilityStatus = 'permission-required';
          }
        });
        db._saveTable('file_locations', db.fileLocations);
      }
    } catch (err) {
      console.error(`Failed to sync permission for directory source ${source.name}:`, err);
    }
  }
}

export async function handleFolderSelect({
  db,
  reconnectSourceId = null,
  isRecursiveChecked,
  showToast,
  renderFolderSettingsPanel,
  renderLibrary,
  confirm,
  startFolderScanningFn
}) {
  if (!window.showDirectoryPicker) {
    showToast(t('folder.toastBrowserUnsupported'), 'error');
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

    if (reconnectSourceId && typeof reconnectSourceId === 'string') {
      // Reconnect Mode: Update the existing source in place without creating a new ID
      const source = db.getDirectorySource(reconnectSourceId);
      if (!source) {
        throw new Error('再接続対象のフォルダソースが見つかりません。');
      }

      await db.reconnectDirectorySource(source.id, handle);

      // Clean up temporary handle
      await db.deleteDirectoryHandle(tempKey);
      handleSavedToTemp = false;

      showToast(t('folder.toastReconnected'));
      if (!window.__TEST_ENV__) {
        renderFolderSettingsPanel();
        renderLibrary();
        // Trigger initial scan on the reconnected folder
        await startFolderScanningFn(source, handle);
      }
    } else {
      // Normal Mode: Overwrite / select a brand new folder source
      // Phase 4: Overwrite confirmation
      const oldSourceIds = db.getDirectorySources().map(s => s.id);
      if (oldSourceIds.length > 0) {
        if (!confirm(t('folder.confirmOverwriteFolder'))) {
          // Clean temp handle and return
          await db.deleteDirectoryHandle(tempKey);
          return;
        }
      }

      // Phase 5: Commit changes to Database
      const source = await db.addDirectorySource({
        name: handle.name,
        includeSubdirectories: isRecursiveChecked
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

      showToast(t('folder.toastConnected', { name: handle.name }));
      if (!window.__TEST_ENV__) {
        renderFolderSettingsPanel();
        // Trigger initial scan
        await startFolderScanningFn(source, handle);
      }
    }
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

    showToast(t('folder.toastConnectError', { error: err.message }), 'error');
  }
}

export async function handleFolderRequestPermission({
  db,
  showToast,
  renderFolderSettingsPanel,
  renderLibrary,
  handleFolderSelectFn
}) {
  const source = db.getDirectorySources()[0];
  if (!source) return;

  const isDisconnected = !source.handleKey || source.permissionStatus === 'disconnected';
  if (isDisconnected) {
    await handleFolderSelectFn(source.id);
    return;
  }

  try {
    const handle = await db.getDirectoryHandle(source.handleKey);
    if (!handle) {
      await db.updateDirectorySource(source.id, { handleKey: '', permissionStatus: 'disconnected' });
      showToast(t('folder.toastRefNotFound'), 'error');
      if (!window.__TEST_ENV__) {
        renderFolderSettingsPanel();
      }
      return;
    }

    const status = await handle.requestPermission({ mode: 'read' });
    await db.updateDirectorySource(source.id, { permissionStatus: status });

    // Update and persist video availability statuses via public DB method
    await db.updateDirectoryVideosAvailability(source.id, status === 'granted' ? 'available' : 'permission-required');

    showToast(status === 'granted' ? t('folder.toastPermGranted') : t('folder.toastPermDenied'));
    if (!window.__TEST_ENV__) {
      renderFolderSettingsPanel();
      renderLibrary();
    }
  } catch (err) {
    showToast(t('folder.toastPermError', { error: err.message }), 'error');
  }
}

export async function handleFolderRescan({
  db,
  showToast,
  startFolderScanningFn
}) {
  const source = db.getDirectorySources()[0];
  if (!source) return;

  try {
    const handle = await db.getDirectoryHandle(source.handleKey);
    if (!handle) {
      showToast(t('folder.toastNotFound'), 'error');
      return;
    }
    await startFolderScanningFn(source, handle);
  } catch (err) {
    showToast(t('folder.toastScanLaunchError', { error: err.message }), 'error');
  }
}

export async function startFolderScanning({
  db,
  source,
  handle,
  recursive,
  scanDirectory,
  applyScanDifferentials,
  processBackgroundHashingQueue,
  updateScanProgressUI,
  showToast,
  alert,
  renderFolderSettingsPanel,
  renderLibrary
}) {
  if (isScanning) {
    console.warn('Scan already in progress');
    return;
  }
  isScanning = true;
  scanAbortState = false;
  scanAbortController = new AbortController();

  if (!window.__TEST_ENV__) {
    updateScanProgressUI(0, 0, true);
  }

  await db.updateDirectorySource(source.id, { includeSubdirectories: recursive });

  try {
    const scanResult = await scanDirectory({
      directoryHandle: handle,
      recursive: recursive,
      signal: scanAbortController.signal,
      onProgress: ({ checkedFiles, detectedVideos }) => {
        if (!window.__TEST_ENV__) {
          updateScanProgressUI(checkedFiles, detectedVideos, true);
        }
      }
    });

    if (!window.__TEST_ENV__) {
      updateScanProgressUI(0, 0, false);
    }

    if (scanResult.aborted || scanAbortState) {
      showToast(t('folder.toastScanAborted'), 'error');
      scanAbortState = false;
      isScanning = false;
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

    const sourcesList = db.getDirectorySources();
    let eligibleCount = 0;
    for (const loc of db.fileLocations) {
      if (loc.verificationStatus !== 'provisional') continue;
      const src = sourcesList.find(s => s.id === loc.directoryId);
      if (!src || src.permissionStatus !== 'granted') continue;
      const handle = await db.getDirectoryHandle(src.handleKey);
      if (!handle) continue;
      try {
        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
          eligibleCount++;
        }
      } catch (e) {}
    }
    const pendingValidationCount = eligibleCount;

    alert(t('folder.alertScanComplete', {
      added: summary.added,
      updated: summary.updated,
      unchanged: summary.unchanged,
      missing: summary.missing,
      pending: summary.pending,
      error: summary.error,
      pendingValidation: pendingValidationCount
    }));

    if (!window.__TEST_ENV__) {
      renderFolderSettingsPanel();
      renderLibrary();
    }
    processBackgroundHashingQueue();
  } catch (err) {
    if (!window.__TEST_ENV__) {
      updateScanProgressUI(0, 0, false);
    }
    if (err.name === 'AbortError' || scanAbortState) {
      showToast(t('folder.toastScanAborted'), 'error');
    } else {
      showToast(t('folder.toastScanError', { error: err.message }), 'error');
    }
  } finally {
    isScanning = false;
    scanAbortController = null;
  }
}

export function abortFolderScanning() {
  if (scanAbortController) {
    scanAbortState = true;
    scanAbortController.abort();
  }
}

export async function handleFolderDisconnect({
  db,
  globalHashQueue,
  bgHashState,
  updateBackgroundHashingProgress,
  showToast,
  renderFolderSettingsPanel,
  renderLibrary,
  confirm
}) {
  const sources = db.getDirectorySources();
  if (sources.length === 0) return;

  const source = sources[0];
  if (!confirm(t('folder.confirmDisconnectFolder', { name: source.name }))) {
    return;
  }

  try {
    globalHashQueue.cancelPending();
    bgHashState.targetKeys.clear();
    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();
    bgHashState.activeId = null;
    bgHashState.activeName = '';
    bgHashState.activePercent = null;
    updateBackgroundHashingProgress(true);

    await db.deleteDirectorySource(source.id);
    showToast(t('folder.toastDisconnected'));
    if (!window.__TEST_ENV__) {
      renderFolderSettingsPanel();
      renderLibrary();
    }
  } catch (err) {
    showToast(t('folder.toastDisconnectError', { error: err.message }), 'error');
  }
}
