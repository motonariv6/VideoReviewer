#!/usr/bin/env node
/**
 * VideoReviewer Development HTTP Server (Node.js)
 * Serves static assets with explicit no-cache headers to prevent stale module caching
 * in Google Chrome and modern browsers during ES module development.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

const port = parseInt(process.argv[2], 10) || 8000;

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];

  if (req.method === 'POST') {
    if (reqPath === '/api/metric') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          if (data.message) {
            console.log(`[METRIC] ${data.message}`);
          }
        } catch (e) {
          // ignore parse errors
        }

        const resp = JSON.stringify({ status: 'ok' });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(resp),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(resp);
      });
      return;
    }

    const errResp = JSON.stringify({ error: 'Not found' });
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(errResp),
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(errResp);
    return;
  }

  if (reqPath === '/') reqPath = '/index.html';

  const safeSuffix = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT_DIR, safeSuffix);

  // Security check: ensure path is within ROOT_DIR
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('='.repeat(60));
  console.log(' VideoReviewer Development Server (Node.js)');
  console.log(` URL:             http://localhost:${port}/`);
  console.log(` Document Root:   ${ROOT_DIR}`);
  console.log(' Cache-Control:   no-cache, no-store, must-revalidate');
  console.log('='.repeat(60));
  console.log('Press Ctrl+C to stop the server.\n');
});
