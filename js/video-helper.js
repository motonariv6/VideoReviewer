/**
 * Video helper utilities for timing, hashing, and Canvas screen capturing.
 */

/**
 * Format a number of seconds into "HH:MM:SS" or "MM:SS"
 * @param {number} seconds 
 * @returns {string}
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds === null || seconds === undefined) {
    return '00:00';
  }
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  
  if (h > 0) {
    const hh = h.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  
  return `${mm}:${ss}`;
}

/**
 * Parses time strings like "01:23:45" or "12:34" back into seconds
 * @param {string} label 
 * @returns {number}
 */
export function parseTime(label) {
  const parts = label.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    // SS
    return parts[0];
  }
  return 0;
}

/**
 * Generate a unique signature for a local file to identify it even if the path changes
 * @param {File} file 
 * @returns {string}
 */
export function generateFileSignature(file) {
  const nameClean = file.name.replace(/[^a-zA-Z0-9]/g, '_');
  const size = file.size;
  const modDate = file.lastModified || 0;
  return `local-${nameClean}-${size}-${modDate}`;
}

/**
 * Captures the current frame of the video and returns a base64 JPG data URL
 * @param {HTMLVideoElement} videoElement 
 * @param {number} targetWidth 
 * @returns {Promise<string>}
 */
export function captureVideoFrame(videoElement, targetWidth = 160) {
  return new Promise((resolve) => {
    if (!videoElement || videoElement.readyState < 2) {
      resolve('');
      return;
    }
    
    try {
      const canvas = document.createElement('canvas');
      const aspect = videoElement.videoWidth / videoElement.videoHeight || 16/9;
      
      canvas.width = targetWidth;
      canvas.height = targetWidth / aspect;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('');
        return;
      }
      
      // Draw the current video frame onto canvas
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      
      // Export as JPG to save space in localStorage
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      resolve(dataUrl);
    } catch (error) {
      // In case of CORS errors (tainted canvas) or other browser limits, fail gracefully
      console.warn('Could not capture video thumbnail frame:', error.message);
      resolve('');
    }
  });
}
