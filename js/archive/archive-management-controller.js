// archive-management-controller.js - Business logic for video archiving, permanent deletion, and location deletion

import { t } from '../i18n.js';

export async function archiveVideoAction({
  db,
  mediaAssetId,
  currentVideoId,
  videoFilesMap,
  onRevoke,
  showToast,
  handleBackToLibrary,
  renderLibrary,
  onLocationsRemoved,
  confirm
}) {
  const asset = db.mediaAssets.find(a => a.id === mediaAssetId);
  if (!asset) return;

  const displayTitle = asset.displayTitle || asset.title;
  const confirmMsg = t('archive.confirmArchiveDelete', { title: displayTitle });

  if (confirm(confirmMsg)) {
    try {
      if (currentVideoId === mediaAssetId) {
        onRevoke();
      }

      const locsToDelete = db.fileLocations.filter(l => l.mediaAssetId === mediaAssetId);
      const locIds = locsToDelete.map(l => l.id);

      const success = await db.archiveVideo(mediaAssetId);
      if (success) {
        videoFilesMap.delete(mediaAssetId);
        showToast(t('archive.toastArchived'));

        if (onLocationsRemoved) {
          onLocationsRemoved(locIds);
        }

        const currentVideoStillExists = db.getVideo(currentVideoId);
        if (currentVideoId && !currentVideoStillExists) {
          handleBackToLibrary();
        } else {
          renderLibrary();
        }
      } else {
        showToast(t('archive.toastArchiveFailed'), 'error');
      }
    } catch (err) {
      showToast(t('archive.toastDeleteError', { error: err.message }), 'error');
    }
  }
}

export async function deleteVideoCascadeAction({
  db,
  mediaAssetId,
  currentVideoId,
  videoFilesMap,
  onRevoke,
  showToast,
  handleBackToLibrary,
  renderLibrary,
  onLocationsRemoved,
  confirm
}) {
  const asset = db.mediaAssets.find(a => a.id === mediaAssetId);
  if (!asset) return;

  const displayTitle = asset.displayTitle || asset.title;
  const confirmMsg = t('archive.confirmPermanentDelete', { title: displayTitle });

  if (confirm(confirmMsg)) {
    try {
      if (currentVideoId === mediaAssetId) {
        onRevoke();
      }

      const locsToDelete = db.fileLocations.filter(l => l.mediaAssetId === mediaAssetId);
      const locIds = locsToDelete.map(l => l.id);

      const success = await db.deleteVideoCascade(mediaAssetId);
      if (success) {
        videoFilesMap.delete(mediaAssetId);
        showToast(t('archive.toastPermanentlyDeleted'));

        if (onLocationsRemoved) {
          onLocationsRemoved(locIds);
        }

        const currentVideoStillExists = db.getVideo(currentVideoId);
        if (currentVideoId && !currentVideoStillExists) {
          handleBackToLibrary();
        } else {
          renderLibrary();
        }
      } else {
        showToast(t('archive.toastPermanentDeleteFailed'), 'error');
      }
    } catch (err) {
      showToast(t('archive.toastPermanentDeleteError', { error: err.message }), 'error');
    }
  }
}

export async function deleteFileLocationAction({
  db,
  locId,
  videoId,
  relativePath,
  showToast,
  handleBackToLibrary,
  renderLocationsListInEditor,
  onLocationsRemoved,
  confirm
}) {
  const confirmMsg = t('archive.confirmRemoveLocation', { path: relativePath });

  if (confirm(confirmMsg)) {
    try {
      const success = await db.deleteFileLocation(locId);
      if (success) {
        showToast(t('archive.toastLocationRemoved'));

        if (onLocationsRemoved) {
          onLocationsRemoved([locId]);
        }

        const updatedVideo = db.getVideo(videoId);
        if (!updatedVideo || !updatedVideo.locations || updatedVideo.locations.length === 0) {
          handleBackToLibrary();
        } else {
          renderLocationsListInEditor(updatedVideo);
        }
      }
    } catch (err) {
      showToast(t('archive.toastDeleteError', { error: err.message }), 'error');
    }
  }
}

export async function handleBulkDeleteAction({
  db,
  currentVideoId,
  videoFilesMap,
  onRevoke,
  showToast,
  handleBackToLibrary,
  renderLibrary,
  getFilteredVideosList,
  onLocationsRemoved,
  confirm
}) {
  const filteredVideos = getFilteredVideosList();
  if (filteredVideos.length === 0) return;

  const confirmMsg = t('archive.confirmBulkDelete', { count: filteredVideos.length });
  if (!confirm(confirmMsg)) return;

  let successCount = 0;
  let failCount = 0;
  const allDeletedLocIds = [];

  for (const v of filteredVideos) {
    try {
      if (currentVideoId === v.id) {
        onRevoke();
      }

      const locsToDelete = db.fileLocations.filter(l => l.mediaAssetId === v.id);
      const locIds = locsToDelete.map(l => l.id);

      const success = await db.deleteVideoCascade(v.id);
      if (success) {
        videoFilesMap.delete(v.id);
        successCount++;
        allDeletedLocIds.push(...locIds);
      } else {
        failCount++;
      }
    } catch (err) {
      console.error(`Failed to delete video ${v.id}:`, err);
      failCount++;
    }
  }

  showToast(t('archive.toastBulkDeleted', { count: successCount }));
  if (failCount > 0) {
    showToast(t('archive.toastBulkDeleteFailed', { count: failCount }), 'error');
  }

  if (allDeletedLocIds.length > 0 && onLocationsRemoved) {
    onLocationsRemoved(allDeletedLocIds);
  }

  const currentVideoStillExists = db.getVideo(currentVideoId);
  if (currentVideoId && !currentVideoStillExists) {
    handleBackToLibrary();
  } else {
    renderLibrary();
  }
}
