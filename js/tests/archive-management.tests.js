import { AppDatabase } from '../db.js';
import { MemoryStorage, MockFileSystemFileHandle, MockFileSystemDirectoryHandle } from '../tests.js';
import {
  archiveVideoAction,
  deleteVideoCascadeAction,
  deleteFileLocationAction,
  handleBulkDeleteAction
} from '../archive/archive-management-controller.js';
import { bgHashState, handleLocationsRemoved } from '../hashing/hash-verification-controller.js';

export async function runArchiveManagementTests(runTest, assert) {
  console.group('Group 12: Video Archiving, Rescanning, and Location Deletion');

  // Old Group 5 Cascade Video Deletion Test
  await runTest('Cascade video deletion integrity and asset checks', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_del_', 'TestVideoDB_CascadeDelete');
    await testDb.initAsync();
    testDb.mediaAssets = [];
    testDb.fileLocations = [];
    testDb._saveTable('media_assets', []);
    testDb._saveTable('file_locations', []);

    // 1. Setup Video A (to be deleted cascade) and Video B (to be kept)
    const vidA = await testDb.addVideo({
      title: 'Video A',
      fileName: 'video_a.mp4',
      sourceType: 'local-file'
    });
    const vidB = await testDb.addVideo({
      title: 'Video B',
      fileName: 'video_b.mp4',
      sourceType: 'local-file'
    });

    // Verify initial count
    assert(testDb.getVideos().length === 2, 'Initial videos count must be 2');

    // Add Ratings, Reviews, Tags, Notes for Video A using saveReview API (proper schema)
    const revA = await testDb.saveReview(vidA.id, {
      overallGrade: 'A',
      comment: 'Excellent',
      ratings: {
        'crit-1': 4,
        'crit-2': 5
      }
    });

    // Add tags association
    await testDb.addTagToVideo(vidA.id, 'Tag1');

    // Add timeline notes
    testDb.timelineNotes.push({ id: 'note-a1', videoReviewId: revA.id, mediaAssetId: vidA.id, timestampSeconds: 10, comment: 'First note', thumbnailId: 'img-note-a1', createdAt: new Date().toISOString() });
    testDb._saveTable('timeline_notes', testDb.timelineNotes);

    // Seed thumbnails and note screenshots in IndexedDB mock if available
    await testDb.updateVideoThumbnail(vidA.id, new Blob(['thumb-a'], { type: 'image/jpeg' }));
    const videoWithThumb = testDb.getVideo(vidA.id);
    assert(videoWithThumb.thumbnailId !== '', 'Video A should have a thumbnail ID');

    // Setup associated reviews and notes for Video B using saveReview API (proper schema)
    const revB = await testDb.saveReview(vidB.id, {
      overallGrade: 'B',
      comment: 'Good',
      ratings: {
        'crit-1': 3,
        'crit-2': 2
      }
    });
    await testDb.addTagToVideo(vidB.id, 'Tag2');
    testDb.timelineNotes.push({ id: 'note-b1', videoReviewId: revB.id, mediaAssetId: vidB.id, timestampSeconds: 20, comment: 'Second note', thumbnailId: 'img-note-b1', createdAt: new Date().toISOString() });
    testDb._saveTable('timeline_notes', testDb.timelineNotes);

    if (testDb.idbAvailable) {
      await testDb.putImage('img-note-a1', new Blob(['note-img-a'], { type: 'image/jpeg' }));
      await testDb.putImage('img-note-b1', new Blob(['note-img-b'], { type: 'image/jpeg' }));
    }

    // Run cascade delete for Video A
    const deleteSuccess = await testDb.deleteVideoCascade(vidA.id);
    assert(deleteSuccess === true, 'Cascade delete operation must return true');

    // Assert Video A is deleted but Video B remains
    assert(!testDb.getVideo(vidA.id), 'Video A must be removed from videos');
    assert(!!testDb.getVideo(vidB.id), 'Video B must NOT be removed from videos');

    // Assert reviews and ratings are cascaded
    assert(testDb.getReviewForVideo(vidA.id) === undefined, 'Review for Video A must be removed');
    assert(testDb.getReviewForVideo(vidB.id) !== undefined, 'Review for Video B must remain');

    // Video A criterion ratings must be 0
    assert(testDb.criterionRatings.some(cr => cr.videoReviewId === revA.id) === false, 'Criterion ratings for Review A must be removed');
    // Video B criterion ratings must remain
    assert(testDb.criterionRatings.some(cr => cr.videoReviewId === revB.id) === true, 'Criterion ratings for Review B must remain');

    // Assert that the changes are written to the persistence layer (MemoryStorage)
    const storedRatings = JSON.parse(memory.getItem('test_vreview_del_criterion_ratings') || '[]');
    assert(storedRatings.some(cr => cr.videoReviewId === revA.id) === false, 'Stored criterion ratings in localStorage for Review A must be deleted');
    assert(storedRatings.some(cr => cr.videoReviewId === revB.id) === true, 'Stored criterion ratings in localStorage for Review B must remain');

    // Assert tags and notes are cascaded
    assert(testDb.getVideoTags(vidA.id).length === 0, 'Tag relations for Video A must be removed');
    assert(testDb.getVideoTags(vidB.id).some(t => t.name === 'Tag2') === true, 'Tag relations for Video B must remain');
    assert(testDb.getTimelineNotes(vidA.id).length === 0, 'Timeline notes for Video A must be removed');
    assert(testDb.getTimelineNotes(vidB.id).length === 1, 'Timeline notes for Video B must remain');

    // Assert IndexedDB images are deleted
    if (testDb.idbAvailable) {
      const deletedVidThumb = await testDb.getImage(videoWithThumb.thumbnailId);
      const deletedNoteThumb = await testDb.getImage('img-note-a1');
      const keptNoteThumb = await testDb.getImage('img-note-b1');

      assert(deletedVidThumb === null, 'Deleted video thumbnail must be removed from IndexedDB');
      assert(deletedNoteThumb === null, 'Deleted timeline note thumbnail must be removed from IndexedDB');
      assert(keptNoteThumb !== null, 'Kept video timeline note thumbnail must remain in IndexedDB');
    }
  });

  // Old Group 12-1
  await runTest('12-1. Archive video retains reviews in DB, hides it from getVideos, and recovers on rescan', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g12_1_', 'TestVideoDB_G12_1');
    await testDb.initAsync();

    const asset = await testDb.addVideo({
      fileName: 'archive_test.mp4',
      fileSize: 12345,
      lastModified: 1000,
      quickHash: 'qh_archive_test',
      hashStatus: 'completed',
      identityStatus: 'verified'
    });
    const realAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    realAsset.contentHash = 'hash_archive_test';
    await testDb._saveTable('media_assets', testDb.mediaAssets);

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });

    const loc = {
      id: 'loc-archive-test',
      mediaAssetId: asset.id,
      directoryId: source.id,
      relativePath: 'archive_test.mp4',
      fileName: 'archive_test.mp4',
      fileSize: 12345,
      lastModified: 1000,
      availabilityStatus: 'available',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    testDb.fileLocations.push(loc);
    await testDb._saveTable('file_locations', testDb.fileLocations);

    const review = await testDb.saveReview(asset.id, {
      overallGrade: 'A',
      comment: 'Excellent video'
    });

    let activeVideos = testDb.getVideos();
    assert(activeVideos.some(v => v.id === asset.id), 'Asset is in active videos list');
    assert(testDb.reviews.some(r => r.mediaAssetId === asset.id), 'Review exists in DB');

    const archiveResult = await testDb.archiveVideo(asset.id);
    assert(archiveResult === true, 'archiveVideo returns true');

    const freshAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    assert(freshAsset.isArchived === true, 'Asset isArchived flag is set to true');
    assert(freshAsset.archivedAt !== null, 'Asset archivedAt has a timestamp');

    const assetLocs = testDb.fileLocations.filter(l => l.mediaAssetId === asset.id);
    assert(assetLocs.length === 0, 'Active locations of archived video are removed from db');

    activeVideos = testDb.getVideos();
    assert(!activeVideos.some(v => v.id === asset.id), 'Archived video is hidden from active videos list');
    assert(testDb.reviews.some(r => r.mediaAssetId === asset.id), 'Review data is preserved in DB');

    const mockHandle = new MockFileSystemDirectoryHandle('FolderA', {
      'archive_test.mp4': new MockFileSystemFileHandle('archive_test.mp4', 12345, 1000)
    });
    await testDb.putDirectoryHandle(source.handleKey, mockHandle);

    const scanResult = {
      relativePath: 'archive_test.mp4',
      fileName: 'archive_test.mp4',
      fileSize: 12345,
      lastModified: 1000,
      quickHash: 'qh_archive_test'
    };

    const rescanResult = await testDb.resolveAndRegisterNewScannedFileProvisional({
      directoryId: source.id,
      sf: scanResult
    });

    assert(rescanResult.status === 'merged', 'Provisional rescan maps to candidate');
    assert(rescanResult.assetId === asset.id, 'Maps back to original asset ID');

    const restoredAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    assert(restoredAsset.isArchived === false, 'Asset isArchived is restored to false');
    assert(restoredAsset.archivedAt === null, 'Asset archivedAt is restored to null');

    const restoredVideo = testDb.getVideo(asset.id);
    assert(restoredVideo.isArchived === false, 'Virtual video shows not archived');
    const restoredReview = testDb.getReviewForVideo(asset.id);
    assert(restoredReview && restoredReview.overallGrade === 'A', 'Evaluation is visible during provisional restore');
  });

  // Old Group 12-2
  await runTest('12-2. Mismatch full hash on provisional restore archives the original asset again', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g12_2_', 'TestVideoDB_G12_2');
    await testDb.initAsync();

    const asset = await testDb.addVideo({
      fileName: 'mismatch.mp4',
      fileSize: 500,
      lastModified: 2000,
      quickHash: 'qh_mismatch',
      hashStatus: 'completed',
      identityStatus: 'verified'
    });
    const realAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    realAsset.contentHash = 'original_correct_hash';
    realAsset.isArchived = true;
    realAsset.archivedAt = new Date().toISOString();
    testDb.fileLocations = testDb.fileLocations.filter(l => l.mediaAssetId !== asset.id);
    await testDb._saveTable('file_locations', testDb.fileLocations);
    await testDb._saveTable('media_assets', testDb.mediaAssets);

    await testDb.saveReview(asset.id, {
      overallGrade: 'A',
      comment: 'Good video'
    });

    const source = await testDb.addDirectorySource({ name: 'FolderA' });
    await testDb.updateDirectorySource(source.id, { permissionStatus: 'granted' });

    const scanResult = {
      relativePath: 'mismatch.mp4',
      fileName: 'mismatch.mp4',
      fileSize: 500,
      lastModified: 2000,
      quickHash: 'qh_mismatch'
    };
    await testDb.resolveAndRegisterNewScannedFileProvisional({
      directoryId: source.id,
      sf: scanResult
    });

    const restoredAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    assert(restoredAsset.isArchived === false, 'Provisionally restored');

    const newLoc = testDb.fileLocations.find(l => l.mediaAssetId === asset.id);
    assert(newLoc && newLoc.verificationStatus === 'provisional', 'Location is provisional');

    const mismatchHash = 'different_mismatch_hash';
    const verifyResult = await testDb.completeLocationProvisionalVerification(newLoc.id, mismatchHash);

    assert(verifyResult.status === 'separated', 'Mismatch causes separation');
    assert(verifyResult.newAssetId !== asset.id, 'Separated to new asset');

    const reArchivedAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    assert(reArchivedAsset.isArchived === true, 'Original asset goes back to archived state');

    const newAssetReviews = testDb.reviews.filter(r => r.mediaAssetId === verifyResult.newAssetId);
    assert(newAssetReviews.length === 0, 'New separated asset has no ratings or reviews');
  });

  // Old Group 12-3
  await runTest('12-3. Permanent deletion cascade removes all review details', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g12_3_', 'TestVideoDB_G12_3');
    await testDb.initAsync();

    const asset = await testDb.addVideo({
      fileName: 'perm.mp4',
      fileSize: 100,
      lastModified: 3000,
      quickHash: 'qh_perm',
      hashStatus: 'completed',
      identityStatus: 'verified'
    });

    await testDb.saveReview(asset.id, {
      overallGrade: 'B'
    });

    testDb.fileLocations = [];
    await testDb._saveTable('file_locations', []);

    // 1. Verify Archive Controller does not receive bgHashState and updateBackgroundHashingProgress
    // Mock the callback target state
    const mockBgHashState = {
      targetKeys: new Set(['loc-1', 'loc-2']),
      completedKeys: new Set(['loc-1']),
      failedKeys: new Set(),
      skippedKeys: new Set()
    };

    let removedIds = [];
    let progressUpdateCount = 0;

    const mockUpdateProgress = (force) => {
      progressUpdateCount++;
    };

    const testHandleLocationsRemoved = (ids) => {
      for (const id of ids) {
        mockBgHashState.targetKeys.delete(id);
        mockBgHashState.completedKeys.delete(id);
        mockBgHashState.failedKeys.delete(id);
        mockBgHashState.skippedKeys.delete(id);
      }
      mockUpdateProgress(true);
    };

    // Seed file locations for asset
    const loc1 = {
      id: 'loc-1',
      mediaAssetId: asset.id,
      directoryId: 'dir-1',
      relativePath: 'perm.mp4',
      fileName: 'perm.mp4',
      fileSize: 100,
      lastModified: 3000,
      availabilityStatus: 'available',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    testDb.fileLocations.push(loc1);
    await testDb._saveTable('file_locations', testDb.fileLocations);

    let callbackCalled = false;
    let callbackArgs = null;

    // Call controller action WITHOUT bgHashState or updateBackgroundHashingProgress parameters
    await deleteVideoCascadeAction({
      db: testDb,
      mediaAssetId: asset.id,
      currentVideoId: asset.id,
      videoFilesMap: new Map([[asset.id, {}]]),
      onRevoke: () => {},
      showToast: () => {},
      handleBackToLibrary: () => {},
      renderLibrary: () => {},
      onLocationsRemoved: (ids) => {
        callbackCalled = true;
        callbackArgs = ids;
        testHandleLocationsRemoved(ids);
      },
      confirm: () => true
    });

    assert(callbackCalled === true, 'onLocationsRemoved callback must be called');
    assert(callbackArgs.length === 1 && callbackArgs[0] === 'loc-1', 'Correct location ID must be passed');
    assert(!mockBgHashState.targetKeys.has('loc-1'), 'Deleted location must be removed from targetKeys');
    assert(mockBgHashState.targetKeys.has('loc-2'), 'Other locations must remain in targetKeys');
    assert(progressUpdateCount === 1, 'updateBackgroundHashingProgress must be called exactly once');

    // Test calling handleLocationsRemoved multiple times with same ID does not break state
    testHandleLocationsRemoved(['loc-1']);
    assert(mockBgHashState.targetKeys.size === 1, 'State remains consistent on repeat notifications');

    // Verify the real handleLocationsRemoved API function works directly on imported bgHashState
    bgHashState.targetKeys.clear();
    bgHashState.completedKeys.clear();
    bgHashState.targetKeys.add('test-loc-a');
    bgHashState.targetKeys.add('test-loc-b');
    bgHashState.completedKeys.add('test-loc-a');

    let realUIUpdateCalled = false;
    handleLocationsRemoved(['test-loc-a'], (force) => {
      realUIUpdateCalled = force;
    });

    assert(!bgHashState.targetKeys.has('test-loc-a'), 'Real handleLocationsRemoved cleans targetKeys');
    assert(bgHashState.targetKeys.has('test-loc-b'), 'Real handleLocationsRemoved preserves others');
    assert(realUIUpdateCalled === true, 'Real handleLocationsRemoved triggers progress updater');

    const freshAsset = testDb.mediaAssets.find(a => a.id === asset.id);
    assert(!freshAsset, 'Asset completely removed from DB');

    const freshReview = testDb.reviews.find(r => r.mediaAssetId === asset.id);
    assert(!freshReview, 'Review completely removed from DB');
  });

  // Old Group 12-4
  await runTest('12-4. Location deletion preserves other locations and asset evaluations', async () => {
    const memory = new MemoryStorage();
    const testDb = new AppDatabase(memory, 'test_vreview_g12_4_', 'TestVideoDB_G12_4');
    await testDb.initAsync();

    const asset = await testDb.addVideo({
      fileName: 'multi.mp4',
      fileSize: 100,
      lastModified: 4000,
      quickHash: 'qh_multi',
      hashStatus: 'completed',
      identityStatus: 'verified'
    });

    await testDb.saveReview(asset.id, {
      overallGrade: 'A'
    });

    testDb.fileLocations = [];
    await testDb._saveTable('file_locations', []);

    const loc1 = {
      id: 'loc-1',
      mediaAssetId: asset.id,
      directoryId: 'dir-1',
      relativePath: 'path1.mp4',
      fileName: 'multi.mp4',
      fileSize: 100,
      lastModified: 4000,
      availabilityStatus: 'available',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const loc2 = {
      id: 'loc-2',
      mediaAssetId: asset.id,
      directoryId: 'dir-2',
      relativePath: 'path2.mp4',
      fileName: 'multi.mp4',
      fileSize: 100,
      lastModified: 4000,
      availabilityStatus: 'available',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    testDb.fileLocations.push(loc1, loc2);

    let callbackIds = [];
    await deleteFileLocationAction({
      db: testDb,
      locId: 'loc-1',
      videoId: asset.id,
      relativePath: 'path1.mp4',
      showToast: () => {},
      handleBackToLibrary: () => {},
      renderLocationsListInEditor: () => {},
      onLocationsRemoved: (ids) => {
        callbackIds.push(...ids);
      },
      confirm: () => true
    });

    assert(callbackIds.length === 1 && callbackIds[0] === 'loc-1', 'deleteFileLocationAction notifies correct ID');

    assert(!testDb.fileLocations.some(l => l.id === 'loc-1'), 'loc-1 is deleted');
    assert(testDb.fileLocations.some(l => l.id === 'loc-2'), 'loc-2 remains');

    const freshReview = testDb.getReviewForVideo(asset.id);
    assert(freshReview && freshReview.overallGrade === 'A', 'Evaluations remain intact');

    // Test handleBulkDeleteAction with multiple location notifications
    const mockBgHashState = {
      targetKeys: new Set(['loc-2', 'loc-other']),
      completedKeys: new Set(),
      failedKeys: new Set(),
      skippedKeys: new Set()
    };

    let bulkRemovedIds = [];
    const testHandleLocationsRemoved = (ids, updateProgressFn) => {
      for (const id of ids) {
        mockBgHashState.targetKeys.delete(id);
      }
      bulkRemovedIds.push(...ids);
      if (updateProgressFn) updateProgressFn(true);
    };

    let progressUpdateCount = 0;
    const mockUpdateProgress = () => { progressUpdateCount++; };

    const video = testDb.getVideo(asset.id);
    video.availabilityStatus = 'missing';

    await handleBulkDeleteAction({
      db: testDb,
      currentVideoId: asset.id,
      videoFilesMap: new Map([[asset.id, {}]]),
      onRevoke: () => {},
      showToast: () => {},
      handleBackToLibrary: () => {},
      renderLibrary: () => {},
      getFilteredVideosList: () => [video],
      onLocationsRemoved: (ids) => {
        testHandleLocationsRemoved(ids, mockUpdateProgress);
      },
      confirm: () => true
    });

    assert(bulkRemovedIds.length === 1 && bulkRemovedIds[0] === 'loc-2', 'Bulk delete notifies loc-2');
    assert(!mockBgHashState.targetKeys.has('loc-2'), 'loc-2 removed from targetKeys');
    assert(mockBgHashState.targetKeys.has('loc-other'), 'Other progress states maintained');
    assert(progressUpdateCount === 1, 'Progress updater triggered');
  });

  console.groupEnd(); // Group 12
}
