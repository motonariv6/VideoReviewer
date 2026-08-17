// js/sha256-worker.js
// Standalone incremental SHA-256 implementation inside a Web Worker.

class SHA256Hasher {
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

let hasher = null;

self.onmessage = function (e) {
  const { type, data } = e.data;
  if (type === 'start') {
    hasher = new SHA256Hasher();
    self.postMessage({ type: 'started' });
  } else if (type === 'update') {
    if (hasher) {
      hasher.update(data);
      self.postMessage({ type: 'updated' });
    }
  } else if (type === 'digest') {
    if (hasher) {
      const hash = hasher.digest();
      self.postMessage({ type: 'result', hash: hash });
      hasher = null;
    }
  }
};
