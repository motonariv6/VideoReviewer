// archive-management-controller.js - Business logic for video archiving, permanent deletion, and location deletion

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
  const confirmMsg = `一覧からこの動画を削除します。評価データは保持され、再スキャン時に復元可能です。実際の動画ファイルは削除されません。\n\n動画: 「${displayTitle}」\n本当に削除しますか？`;

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
        showToast('動画をアーカイブ削除しました。');

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
        showToast('動画のアーカイブ削除に失敗しました。', 'error');
      }
    } catch (err) {
      showToast(`削除エラー: ${err.message}`, 'error');
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
  const confirmMsg = `完全に削除します。\n評価・タグ・コメント・タイムラインメモも削除され、再スキャンしても復元できません。実際の動画ファイルは削除されません。\n\n動画: 「${displayTitle}」\n本当に完全に削除しますか？`;

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
        showToast('データベースから完全に削除しました。');

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
        showToast('動画の完全削除に失敗しました。', 'error');
      }
    } catch (err) {
      showToast(`完全削除エラー: ${err.message}`, 'error');
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
  const confirmMsg = `このロケーション登録を削除しますか？\n他のロケーション、アセット、評価データは削除しないでおきます。\n\nパス: ${relativePath}`;

  if (confirm(confirmMsg)) {
    try {
      const success = await db.deleteFileLocation(locId);
      if (success) {
        showToast('ロケーション登録を削除しました。');

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
      showToast(`削除エラー: ${err.message}`, 'error');
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

  const confirmMsg = `表示中のリンク切れ・エラー動画 ${filteredVideos.length}本 を一括削除します。\n評価、タグ、コメント、タイムラインメモもすべて削除されます。実際の動画ファイルは削除されません。\n\n本当によろしいですか？`;
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

  showToast(`${successCount}本の動画を一覧から削除しました。実ファイルは削除されていません。`);
  if (failCount > 0) {
    showToast(`${failCount}本の動画の削除に失敗しました。`, 'error');
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
