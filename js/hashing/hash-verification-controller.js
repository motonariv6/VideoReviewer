import { logMetric } from '../hash-helper.js';

export let bgHashState = {
  batchId: '',
  generation: 0,
  targetKeys: new Set(),
  completedKeys: new Set(),
  failedKeys: new Set(),
  skippedKeys: new Set(),
  activeId: null,
  activeName: '',
  activePercent: null,
  lastUpdateTime: 0,
  lastUpdatePercent: -1,
  panelMinimized: false,
  panelClosed: false
};

export async function processSingleLocationVerification(dbInstance, locId, sources, getDirectoryHandleFn, getFileHandleFn, computeHashFn) {
  const freshLoc = dbInstance.fileLocations.find(l => l.id === locId);
  if (!freshLoc || freshLoc.verificationStatus !== 'provisional') return;

  const source = sources.find(s => s.id === freshLoc.directoryId);
  if (!source) return;

  const handle = await getDirectoryHandleFn(source.handleKey);
  if (!handle) return;

  const perm = await handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted') return;

  const fileHandle = await getFileHandleFn(handle, freshLoc.relativePath);
  const fileObj = await fileHandle.getFile();

  // 1. Calculate full SHA-256
  const hash = await computeHashFn(fileObj);

  // 2. Complete verification
  const result = await dbInstance.completeLocationProvisionalVerification(freshLoc.id, hash);
  return result;
}

export async function processBackgroundHashingQueue({
  dbInstance,
  hashQueue,
  getFileHandleFn,
  computeHashFn,
  logMetricFn = logMetric,
  onProgressChange = () => {},
  onLibraryRender = () => {},
  onPendingResolved = () => {},
  onNewBatch = () => {}
}) {
  const provisionalLocs = dbInstance.fileLocations.filter(loc => loc.verificationStatus === 'provisional');
  const sources = dbInstance.getDirectorySources();

  logMetricFn(`[DIAGNOSTIC] Total provisional locations found in DB: ${provisionalLocs.length}`);
  for (const loc of provisionalLocs) {
    const source = sources.find(s => s.id === loc.directoryId);
    let hasHandle = false;
    if (source) {
      const handle = await dbInstance.getDirectoryHandle(source.handleKey);
      hasHandle = !!handle;
    }
    const isQueued = hashQueue.queuedKeys.has(loc.id);
    const isRunning = hashQueue.runningKeys.has(loc.id);
    logMetricFn(`[DIAGNOSTIC_ITEM] location.id: ${loc.id}, mediaAssetId: ${loc.mediaAssetId}, sourceId: ${loc.directoryId}, relativePath: ${loc.relativePath}, verificationStatus: ${loc.verificationStatus}, sourceStatus: ${source ? 'present' : 'absent'}, hasHandle: ${hasHandle}, permissionStatus: ${source ? source.permissionStatus : 'N/A'}, isQueued: ${isQueued}, isRunning: ${isRunning}`);
  }

  if (provisionalLocs.length === 0) {
    onProgressChange(true);
    return;
  }

  if (sources.length === 0) return;

  // 1. Asynchronously filter only currently eligible/accessible locations
  const eligibleLocs = [];
  for (const loc of provisionalLocs) {
    const source = sources.find(s => s.id === loc.directoryId);
    if (!source || source.permissionStatus !== 'granted') continue;

    const handle = await dbInstance.getDirectoryHandle(source.handleKey);
    if (!handle) continue;

    try {
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') continue;
    } catch (err) {
      continue;
    }

    eligibleLocs.push(loc);
  }

  const finalLocsToProcess = eligibleLocs;

  if (finalLocsToProcess.length === 0) {
    onProgressChange(true);
    return;
  }

  // Start new batch if queued/running are empty and we have new locations to process
  const newLocs = finalLocsToProcess.filter(loc => {
    return !hashQueue.queuedKeys.has(loc.id) && !hashQueue.runningKeys.has(loc.id);
  });

  if (newLocs.length === 0) {
    onProgressChange();
    return;
  }

  if (hashQueue.queuedKeys.size === 0 && hashQueue.runningKeys.size === 0) {
    bgHashState.batchId = 'batch-' + Math.random().toString(36).slice(2);
    bgHashState.generation++;
    bgHashState.targetKeys.clear();
    bgHashState.completedKeys.clear();
    bgHashState.failedKeys.clear();
    bgHashState.skippedKeys.clear();
    bgHashState.panelClosed = false;
    onNewBatch();
  }

  const currentGeneration = bgHashState.generation;
  const currentBatchId = bgHashState.batchId;

  for (const loc of newLocs) {
    logMetricFn(`Queue Enqueue: Name: ${loc.fileName}, Size: ${loc.fileSize}, LocId: ${loc.id}`);

    const promise = hashQueue.enqueue(loc.id, async () => {
      // 4. Validate generation before starting execution
      if (bgHashState.generation !== currentGeneration || bgHashState.batchId !== currentBatchId) {
        return;
      }

      // Pre-execution DB validation check
      const freshLoc = dbInstance.fileLocations.find(l => l.id === loc.id);
      if (!freshLoc || freshLoc.verificationStatus !== 'provisional') {
        if (bgHashState.generation === currentGeneration) {
          onProgressChange();
        }
        return;
      }

      const source = sources.find(s => s.id === freshLoc.directoryId);
      if (!source) {
        if (bgHashState.generation === currentGeneration) {
          onProgressChange();
        }
        return;
      }

      try {
        const handle = await dbInstance.getDirectoryHandle(source.handleKey);
        if (!handle) {
          if (bgHashState.generation === currentGeneration) {
            onProgressChange();
          }
          return;
        }
        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') {
          if (bgHashState.generation === currentGeneration) {
            onProgressChange();
          }
          return;
        }

        if (bgHashState.generation === currentGeneration) {
          bgHashState.activeId = loc.id;
          bgHashState.activeName = loc.fileName;
          bgHashState.activePercent = null;
          onProgressChange(true);
        }

        const verifyRes = await processSingleLocationVerification(
          dbInstance,
          loc.id,
          sources,
          (key) => dbInstance.getDirectoryHandle(key),
          getFileHandleFn,
          (file, opts) => {
            return computeHashFn(file, {
              ...opts,
              onProgress: (pInfo) => {
                // Validate generation in progress callback
                if (bgHashState.generation === currentGeneration) {
                  if (pInfo.percent < 100) {
                    bgHashState.activePercent = pInfo.percent;
                  } else {
                    bgHashState.activePercent = 100;
                  }
                  onProgressChange();
                }
              }
            });
          }
        );

        if (bgHashState.generation === currentGeneration) {
          // Double check targetKeys before marking completed
          if (bgHashState.targetKeys.has(loc.id)) {
            bgHashState.completedKeys.add(loc.id);
          }
          if (verifyRes && verifyRes.resolvedPendingSummary && verifyRes.resolvedPendingSummary.resolved > 0) {
            const video = dbInstance.getVideo(verifyRes.targetAssetId || verifyRes.assetId || verifyRes.newAssetId);
            if (video) {
              onPendingResolved(verifyRes.resolvedPendingSummary, video);
            }
          }
        }
      } catch (err) {
        console.error(`Failed background verification for location ${loc.relativePath}:`, err);
        if (bgHashState.generation === currentGeneration) {
          if (bgHashState.targetKeys.has(loc.id)) {
            bgHashState.failedKeys.add(loc.id);
          }
        }
      } finally {
        if (bgHashState.generation === currentGeneration) {
          if (bgHashState.activeId === loc.id) {
            bgHashState.activeId = null;
            bgHashState.activeName = '';
            bgHashState.activePercent = null;
          }
          onProgressChange(true);
          onLibraryRender();
        }
      }
    });

    if (promise) {
      bgHashState.targetKeys.add(loc.id);
      promise.catch(err => {
        console.error(`Queue error for location ${loc.relativePath}:`, err);
      });
    }
  }

  onProgressChange(true);
}

export function handleLocationsRemoved(locationIds, updateProgressFn) {
  const ids = Array.isArray(locationIds) ? locationIds : [locationIds];
  for (const id of ids) {
    bgHashState.targetKeys.delete(id);
    bgHashState.completedKeys.delete(id);
    bgHashState.failedKeys.delete(id);
    bgHashState.skippedKeys.delete(id);
  }
  if (updateProgressFn) {
    updateProgressFn(true);
  }
}
