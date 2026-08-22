export function logMetric(message) {
  console.log(`[METRIC] ${message}`);
  if (typeof fetch !== 'undefined') {
    fetch('/api/metric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    }).catch(() => {});
  }
}


export class SHA256Hasher {
  constructor() {
    this.init();
  }

  init() {
    this.h0 = 0x6a09e667;
    this.h1 = 0xbb67ae85;
    this.h2 = 0x3c6ef372;
    this.h3 = 0xa54ff53a;
    this.h4 = 0x510e527f;
    this.h5 = 0x9b05688c;
    this.h6 = 0x1f83d9ab;
    this.h7 = 0x5be0cd19;

    this.block = new Uint8Array(64);
    this.blockLen = 0;
    this.totalBytes = 0;
  }

  update(data) {
    if (typeof data === 'string') {
      data = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }
    
    let offset = 0;
    const len = data.length;
    this.totalBytes += len;

    while (offset < len) {
      const remaining = 64 - this.blockLen;
      const writeLen = Math.min(remaining, len - offset);
      
      this.block.set(data.subarray(offset, offset + writeLen), this.blockLen);
      this.blockLen += writeLen;
      offset += writeLen;

      if (this.blockLen === 64) {
        this.processBlock(this.block);
        this.blockLen = 0;
      }
    }
    return this;
  }

  processBlock(M) {
    const W = new Uint32Array(64);
    for (let t = 0; t < 16; t++) {
      W[t] = (M[t * 4] << 24) | (M[t * 4 + 1] << 16) | (M[t * 4 + 2] << 8) | M[t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = this.rotr(W[t - 15], 7) ^ this.rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = this.rotr(W[t - 2], 17) ^ this.rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let t = 0; t < 64; t++) {
      const S1 = this.rotr(e, 6) ^ this.rotr(e, 11) ^ this.rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
      const S0 = this.rotr(a, 2) ^ this.rotr(a, 13) ^ this.rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    this.h0 = (this.h0 + a) | 0;
    this.h1 = (this.h1 + b) | 0;
    this.h2 = (this.h2 + c) | 0;
    this.h3 = (this.h3 + d) | 0;
    this.h4 = (this.h4 + e) | 0;
    this.h5 = (this.h5 + f) | 0;
    this.h6 = (this.h6 + g) | 0;
    this.h7 = (this.h7 + h) | 0;
  }

  rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  digest() {
    const totalBits = this.totalBytes * 8;
    this.update(new Uint8Array([0x80]));
    const padLen = (this.blockLen <= 56) ? (56 - this.blockLen) : (120 - this.blockLen);
    const padding = new Uint8Array(padLen);
    this.update(padding);

    const lenBlock = new Uint8Array(8);
    const high = Math.floor(totalBits / 0x100000000);
    const low = totalBits % 0x100000000;
    
    lenBlock[0] = (high >>> 24) & 0xff;
    lenBlock[1] = (high >>> 16) & 0xff;
    lenBlock[2] = (high >>> 8) & 0xff;
    lenBlock[3] = high & 0xff;
    lenBlock[4] = (low >>> 24) & 0xff;
    lenBlock[5] = (low >>> 16) & 0xff;
    lenBlock[6] = (low >>> 8) & 0xff;
    lenBlock[7] = low & 0xff;

    this.update(lenBlock);

    const hex = val => (val >>> 0).toString(16).padStart(8, '0');
    return (hex(this.h0) + hex(this.h1) + hex(this.h2) + hex(this.h3) + 
            hex(this.h4) + hex(this.h5) + hex(this.h6) + hex(this.h7)).toLowerCase();
  }
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/**
 * Computes SHA-256 for a string or buffer in memory.
 * @param {string|ArrayBuffer|Uint8Array} data
 * @returns {string} 64-char lowercase hex string
 */
export function computeSHA256(data) {
  const hasher = new SHA256Hasher();
  hasher.update(data);
  return hasher.digest();
}

/**
 * Computes a fast candidate quickHash for a File or Blob.
 * Uses file size + head (1MB) + middle (1MB) + tail (1MB).
 * @param {Blob|File} file
 * @returns {Promise<string>}
 */
export async function computeQuickHash(file) {
  if (!file) return '';
  const startTime = Date.now();
  const size = file.size || 0;
  const SAMPLE_SIZE = 1024 * 1024; // 1MB

  const sizeStr = `size:${size}|`;
  const sizeBuf = new TextEncoder().encode(sizeStr);
  const parts = [sizeBuf];

  if (size <= SAMPLE_SIZE * 3) {
    parts.push(file);
  } else {
    // Read head
    parts.push(file.slice(0, SAMPLE_SIZE));
    // Read middle
    const midStart = Math.floor((size - SAMPLE_SIZE) / 2);
    parts.push(file.slice(midStart, midStart + SAMPLE_SIZE));
    // Read tail
    parts.push(file.slice(size - SAMPLE_SIZE, size));
  }

  const combinedBlob = new Blob(parts);
  const buf = await combinedBlob.arrayBuffer();
  const readBytes = buf.byteLength;

  let hashStr;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashStr = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    const hasher = new SHA256Hasher();
    hasher.update(buf);
    hashStr = hasher.digest();
  }

  const hashResult = `q_${size}_${hashStr}`;
  const endTime = Date.now();
  logMetric(`Type: quickHash, Name: ${file.name || 'unknown'}, Size: ${size}, ReadBytes: ${readBytes}, Start: ${startTime}, End: ${endTime}, Elapsed: ${endTime - startTime}ms`);
  return hashResult;
}

/**
 * Computes full SHA-256 for a File or Blob chunk-by-chunk.
 * Can run either directly or via Web Worker.
 * @param {Blob|File} file
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - ({ processedBytes, totalBytes, percent }) => void
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.chunkSize=1048576] - 1MB chunk size
 * @param {boolean} [options.useWorker=true]
 * @returns {Promise<string>}
 */
export async function computeFileSHA256(file, { onProgress = null, signal = null, chunkSize = 1024 * 1024, useWorker = true } = {}) {
  if (!file) throw new Error('No file provided for hashing');
  if (typeof window !== 'undefined' && window.testComputeSHA256Hook) {
    const result = window.testComputeSHA256Hook(file);
    if (onProgress) {
      onProgress({ processedBytes: file.size, totalBytes: file.size, percent: 100 });
    }
    return result;
  }
  const startTime = Date.now();
  const totalBytes = file.size;

  const runHashing = async () => {
    if (totalBytes === 0) {
      return computeSHA256(new Uint8Array(0));
    }

    if (totalBytes <= 250 * 1024 * 1024 && typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await file.arrayBuffer();
      if (signal && signal.aborted) {
        throw new DOMException('Hashing aborted by signal', 'AbortError');
      }
      const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      if (onProgress) {
        onProgress({ processedBytes: totalBytes, totalBytes, percent: 100 });
      }
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Check Web Worker availability
    const canUseWorker = useWorker && typeof Worker !== 'undefined';

    if (canUseWorker) {
      return new Promise((resolve, reject) => {
        let worker;
        try {
          worker = new Worker(new URL('./sha256-worker.js', import.meta.url));
        } catch {
          // Fallback to in-thread calculation if worker instantiation fails
          return computeFileSHA256InThread(file, { onProgress, signal, chunkSize }).then(resolve, reject);
        }

        let currentOffset = 0;

        const cleanup = () => {
          if (worker) {
            worker.terminate();
            worker = null;
          }
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
        };

        const onAbort = () => {
          cleanup();
          reject(new DOMException('Hashing aborted by signal', 'AbortError'));
        };

        if (signal) {
          if (signal.aborted) {
            return onAbort();
          }
          signal.addEventListener('abort', onAbort);
        }

        const readNextChunk = () => {
          if (signal && signal.aborted) return;
          if (currentOffset >= totalBytes) {
            worker.postMessage({ type: 'digest' });
            return;
          }

          const nextOffset = Math.min(currentOffset + chunkSize, totalBytes);
          const slice = file.slice(currentOffset, nextOffset);
          
          slice.arrayBuffer().then(buffer => {
            if (signal && signal.aborted) return;
            worker.postMessage({ type: 'update', data: buffer }, [buffer]);
            currentOffset = nextOffset;
            if (onProgress) {
              onProgress({
                processedBytes: currentOffset,
                totalBytes,
                percent: Math.min(100, Math.round((currentOffset / totalBytes) * 100))
              });
            }
          }).catch(err => {
            cleanup();
            reject(err);
          });
        };

        worker.onmessage = (e) => {
          const { type, hash } = e.data;
          if (type === 'started') {
            readNextChunk();
          } else if (type === 'updated') {
            readNextChunk();
          } else if (type === 'result') {
            cleanup();
            resolve(hash);
          }
        };

        worker.onerror = (err) => {
          cleanup();
          reject(err);
        };

        worker.postMessage({ type: 'start' });
      });
    }

    return computeFileSHA256InThread(file, { onProgress, signal, chunkSize });
  };

  const hashResult = await runHashing();
  const endTime = Date.now();
  logMetric(`Type: fullSHA256, Name: ${file.name || 'unknown'}, Size: ${totalBytes}, Start: ${startTime}, End: ${endTime}, Elapsed: ${endTime - startTime}ms`);
  return hashResult;
}

/**
 * In-thread chunk-by-chunk computation fallback
 */
async function computeFileSHA256InThread(file, { onProgress = null, signal = null, chunkSize = 1024 * 1024 } = {}) {
  const totalBytes = file.size;
  const hasher = new SHA256Hasher();
  let currentOffset = 0;

  while (currentOffset < totalBytes) {
    if (signal && signal.aborted) {
      throw new DOMException('Hashing aborted by signal', 'AbortError');
    }

    const nextOffset = Math.min(currentOffset + chunkSize, totalBytes);
    const slice = file.slice(currentOffset, nextOffset);
    const buffer = await slice.arrayBuffer();

    hasher.update(buffer);
    currentOffset = nextOffset;

    if (onProgress) {
      onProgress({
        processedBytes: currentOffset,
        totalBytes,
        percent: Math.min(100, Math.round((currentOffset / totalBytes) * 100))
      });
    }

    // Yield to event loop
    await new Promise(r => setTimeout(r, 0));
  }

  return hasher.digest();
}

/**
 * Concurrency Queue to prevent overwhelming memory/workers with too many parallel calculations.
 */
export class HashQueue {
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.runningCount = 0;
    this.queue = [];
    this.isPaused = false;
    this.queuedKeys = new Set();
    this.runningKeys = new Set();
  }

  enqueue(key, taskFn) {
    if (this.queuedKeys.has(key) || this.runningKeys.has(key)) {
      return null;
    }
    this.queuedKeys.add(key);

    return new Promise((resolve, reject) => {
      this.queue.push({ key, taskFn, resolve, reject });
      this.processNext();
    });
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    this.processNext();
  }

  cancelPending() {
    const oldQueue = this.queue;
    this.queue = [];
    this.queuedKeys.clear();
    for (const item of oldQueue) {
      item.reject(new Error('Hashing queue cancelled'));
    }
  }

  clearPending() {
    this.cancelPending();
  }

  async processNext() {
    if (this.isPaused || this.runningCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.runningCount++;
    const { key, taskFn, resolve, reject } = this.queue.shift();

    this.queuedKeys.delete(key);
    this.runningKeys.add(key);

    try {
      const result = await taskFn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.runningKeys.delete(key);
      this.runningCount--;
      this.processNext();
    }
  }
}

export const globalHashQueue = new HashQueue(1);
