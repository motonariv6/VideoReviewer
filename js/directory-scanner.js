/**
 * Directory Scanner module for File System Access API
 * Isolated from DOM and DB layers for unit testing compatibility.
 */

import { computeQuickHash } from './hash-helper.js';
import { normalizePath } from './video-helper.js';

/**
 * Checks if a file or directory should be ignored as a system/hidden entry
 * @param {string} name
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isIgnoredSystemEntry(name, relativePath) {
  const lowerName = name.toLowerCase();
  
  if (lowerName === '.ds_store') {
    return true;
  }
  
  if (name.startsWith('.')) {
    return true;
  }
  
  const normalizedPath = (relativePath || '').replace(/\\/g, '/');
  const components = normalizedPath.split('/');
  
  for (const part of components) {
    const lowerPart = part.toLowerCase();
    if (lowerPart === '__macosx') {
      return true;
    }
    if (part.startsWith('.')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Checks if a filename matches supported video formats (case-insensitive)
 * @param {string} fileName 
 * @returns {boolean}
 */
export function isSupportedVideoFile(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const videoExtensions = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv']);
  return videoExtensions.has(ext);
}

/**
 * Checks if a filename matches supported image formats (case-insensitive)
 * @param {string} fileName
 * @returns {boolean}
 */
export function isSupportedImageFile(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp']);
  return imageExtensions.has(ext);
}

/**
 * Checks if a relative path starts with or is inside a failed directory path
 * @param {string} path 
 * @param {Array} failedDirectories 
 * @returns {boolean}
 */
export function isPathCoveredByFailedDirectory(path, failedDirectories) {
  if (!failedDirectories || failedDirectories.length === 0) return false;
  return failedDirectories.some(fd => {
    const fdPath = fd.relativePath;
    if (fdPath === '') return true; // Root failure covers all paths!
    return path === fdPath || path.startsWith(fdPath + '/');
  });
}

/**
 * Checks if a relative path falls inside scanned folders scope
 * @param {string} path 
 * @param {boolean} recursive 
 * @returns {boolean}
 */
function isPathInScope(path, recursive) {
  if (!recursive) {
    // Non-recursive: only files in the root folder are in scope (no slashes)
    return !path.includes('/');
  }
  return true;
}

/**
 * Recursively scans a FileSystemDirectoryHandle for video files
 * @param {Object} options
 * @param {FileSystemDirectoryHandle} options.directoryHandle
 * @param {boolean} [options.recursive=true]
 * @param {AbortSignal} [options.signal=null]
 * @param {Function} [options.onProgress=null]
 * @returns {Promise<Object>}
 */
export async function scanDirectory({ directoryHandle, recursive = true, signal = null, onProgress = null }) {
  const scannedFiles = [];
  const failedFiles = [];
  const failedDirectories = [];
  let aborted = false;
  let scanCompleted = true;
  let checkedFilesCount = 0;

  const queue = [{ dirHandle: directoryHandle, relPath: '' }];

  const IMAGE_EXT_PRIORITY = {
    'jpg': 1,
    'jpeg': 2,
    'png': 3,
    'webp': 4
  };

  try {
    while (queue.length > 0) {
      if (signal && signal.aborted) {
        aborted = true;
        break;
      }

      const { dirHandle, relPath } = queue.shift();
      
      let iterator;
      try {
        iterator = dirHandle.values();
      } catch (err) {
        failedDirectories.push({
          relativePath: relPath, // relativePath is '' for root folder failures
          errorName: err.name,
          errorMessage: err.message
        });
        if (relPath === '') {
          scanCompleted = false; // Root traversal failed
        }
        continue;
      }

      const entries = [];
      try {
        for await (const entry of iterator) {
          if (signal && signal.aborted) {
            aborted = true;
            break;
          }
          entries.push(entry);
        }
      } catch (err) {
        failedDirectories.push({
          relativePath: relPath,
          errorName: err.name,
          errorMessage: err.message
        });
        if (relPath === '') {
          scanCompleted = false; // Root traversal failed
        }
        continue;
      }

      if (aborted) break;

      // 1. Separate files and directories, build imageMap for this directory
      const supportedVideos = [];
      const imageMap = new Map();

      for (const entry of entries) {
        checkedFilesCount++;
        const entryRelPath = normalizePath(relPath ? `${relPath}/${entry.name}` : entry.name);

        if (isIgnoredSystemEntry(entry.name, entryRelPath)) {
          continue;
        }

        if (entry.kind === 'file') {
          if (isSupportedVideoFile(entry.name)) {
            supportedVideos.push({ entry, relPath: entryRelPath });
          } else {
            const ext = entry.name.split('.').pop().toLowerCase();
            if (IMAGE_EXT_PRIORITY[ext] !== undefined) {
              const lastDotIdx = entry.name.lastIndexOf('.');
              const base = (lastDotIdx === -1 ? entry.name : entry.name.substring(0, lastDotIdx)).toLowerCase();
              const existing = imageMap.get(base);
              if (!existing || IMAGE_EXT_PRIORITY[ext] < IMAGE_EXT_PRIORITY[existing.ext]) {
                imageMap.set(base, { entry, ext });
              }
            }
          }
        } else if (entry.kind === 'directory' && recursive) {
          queue.push({
            dirHandle: entry,
            relPath: entryRelPath
          });
        }
      }

      // 2. Process video files and match custom poster images O(n)
      for (const { entry, relPath: fileRelPath } of supportedVideos) {
        if (signal && signal.aborted) {
          aborted = true;
          break;
        }

        const lastDotIdx = entry.name.lastIndexOf('.');
        const videoBase = (lastDotIdx === -1 ? entry.name : entry.name.substring(0, lastDotIdx)).toLowerCase();
        const matched = imageMap.get(videoBase);
        const autoPosterHandle = matched ? matched.entry : null;

        try {
          const file = await entry.getFile();
          const qh = await computeQuickHash(file);
          scannedFiles.push({
            fileName: entry.name,
            fileSize: file.size,
            lastModified: file.lastModified,
            relativePath: fileRelPath,
            quickHash: qh,
            autoPosterHandle // Pass the handle for auto poster setting!
          });
        } catch (err) {
          failedFiles.push({
            relativePath: fileRelPath,
            errorName: err.name,
            errorMessage: err.message
          });
        }

        if (checkedFilesCount % 20 === 0 && onProgress) {
          onProgress({ checkedFiles: checkedFilesCount, detectedVideos: scannedFiles.length });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }
  } catch (err) {
    console.error('Directory scanner encountered unexpected error:', err);
    scanCompleted = false;
  }

  // If root walk failed, scan is considered incomplete
  if (failedDirectories.some(fd => fd.relativePath === '')) {
    scanCompleted = false;
  }

  return {
    scannedFiles,
    failedFiles,
    failedDirectories,
    completed: scanCompleted && !aborted,
    aborted
  };
}

/**
 * Classifies scan results comparing with existing DB items (pure function)
 * @param {Object} options
 * @param {Array} options.existingVideos
 * @param {Array} options.scannedFiles
 * @param {Array} options.failedFiles
 * @param {Array} options.failedDirectories
 * @param {boolean} [options.recursive=true]
 * @returns {Object}
 */
export function classifyScanResults({ existingVideos, scannedFiles, failedFiles, failedDirectories, recursive = true }) {
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  let pending = 0;

  const isRootFailed = failedDirectories.some(fd => fd.relativePath === '');
  if (isRootFailed) {
    return { added: 0, updated: 0, unchanged: 0, missing: 0, pending: existingVideos.length };
  }

  const scannedPaths = new Set(scannedFiles.map(sf => sf.relativePath));

  for (const sf of scannedFiles) {
    const matched = existingVideos.find(ev => ev.relativePath === sf.relativePath);
    if (!matched) {
      added++;
    } else {
      const isModified = matched.fileSize !== sf.fileSize || matched.lastModified !== sf.lastModified;
      if (isModified) {
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  for (const ev of existingVideos) {
    if (scannedPaths.has(ev.relativePath)) {
      continue;
    }

    const isFailedFile = failedFiles.some(ff => ff.relativePath === ev.relativePath);
    const isFailedDir = isPathCoveredByFailedDirectory(ev.relativePath, failedDirectories);
    const inScope = !ev.relativePath.includes('/') || recursive;

    if (inScope && !isFailedFile && !isFailedDir) {
      missing++;
    } else {
      pending++;
    }
  }

  return { added, updated, unchanged, missing, pending };
}

/**
 * Applies scan results to the database
 * @param {Object} options
 * @param {AppDatabase} options.db
 * @param {string} options.directoryId
 * @param {Object} options.scanResult
 * @param {boolean} [options.recursive=true]
 * @returns {Promise<Object>}
 */
export async function applyScanDifferentials({
  db,
  directoryId,
  scanResult,
  recursive = true,
  directoryHandle = null,
  getFileHandleFromRelativePathFn = null,
  computeFileSHA256Fn = null,
  onProgress = null
}) {
  const { scannedFiles, failedFiles, failedDirectories, completed, aborted } = scanResult;
  const existingLocations = db.fileLocations.filter(loc => loc.directoryId === directoryId);
  
  const isRootFailed = failedDirectories.some(fd => fd.relativePath === '');

  // If root walk failed, abort diff additions and set all to scan-error status
  if (aborted || !completed || isRootFailed) {
    for (const loc of existingLocations) {
      await db.updateLocationInfo(loc.id, { availabilityStatus: 'scan-error' });
    }
    return { 
      added: 0, 
      updated: 0, 
      unchanged: 0, 
      missing: 0, 
      pending: existingLocations.length, 
      error: failedFiles.length + failedDirectories.length 
    };
  }

  const scannedPaths = new Set(scannedFiles.map(sf => sf.relativePath));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  let pending = 0;
  let errorCount = failedFiles.length + failedDirectories.length;

  // 1. Process successfully scanned files
  let processedCount = 0;
  for (const sf of scannedFiles) {
    processedCount++;
    if (onProgress) {
      onProgress(processedCount, scannedFiles.length);
    }
    const matchedLoc = db.fileLocations.find(loc => loc.directoryId === directoryId && normalizePath(loc.relativePath) === normalizePath(sf.relativePath));
    let assetId = null;
    if (!matchedLoc) {
      try {
        const res = await db.resolveAndRegisterNewScannedFileProvisional({
          directoryId,
          sf
        });
        assetId = res.assetId;
        if (res.status === 'new') {
          added++;
        } else if (res.status === 'merged') {
          unchanged++;
        } else if (res.status === 'verification-pending') {
          pending++;
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }
    } else {
      assetId = matchedLoc.mediaAssetId;
      const isModified = matchedLoc.fileSize !== sf.fileSize || matchedLoc.lastModified !== sf.lastModified;
      if (isModified) {
        try {
          await db.updateLocationInfo(matchedLoc.id, {
            fileSize: sf.fileSize,
            lastModified: sf.lastModified,
            availabilityStatus: 'available',
            verificationStatus: 'provisional'
          });
          
          updated++;
        } catch (err) {
          errorCount++;
        }
      } else {
        await db.updateLocationInfo(matchedLoc.id, { availabilityStatus: 'available' });
        unchanged++;
      }
    }

    if (assetId && sf.autoPosterHandle) {
      try {
        await db.registerAutoPosterImage(assetId, sf.autoPosterHandle);
      } catch (err) {
        console.warn(`Failed to set auto custom poster for video ${sf.fileName}:`, err.message);
      }
    }
  }

  // 2. Process missing/failed locations
  for (const loc of existingLocations) {
    if (scannedPaths.has(loc.relativePath)) {
      continue;
    }

    const isFailedFile = failedFiles.some(ff => ff.relativePath === loc.relativePath);
    const isFailedDir = isPathCoveredByFailedDirectory(loc.relativePath, failedDirectories);
    const inScope = isPathInScope(loc.relativePath, recursive);

    if (inScope && !isFailedFile && !isFailedDir) {
      await db.updateLocationInfo(loc.id, { availabilityStatus: 'missing' });
      missing++;
    } else if (isFailedFile || isFailedDir) {
      await db.updateLocationInfo(loc.id, { availabilityStatus: 'scan-error' });
      pending++;
    } else {
      pending++;
    }
  }

  return { added, updated, unchanged, missing, pending, error: errorCount };
}
