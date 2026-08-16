import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import url from 'url';

const PORT = 3000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let server = null;
let chromeProcess = null;
let currentPendingAction = 'HTTPサーバー起動前';

// Ensure clean exit on termination signals
process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

function cleanupAndExit() {
  console.log('\n[CLEANUP] テスト専用プロセスをクリーンアップ中...');
  if (chromeProcess && chromeProcess.pid) {
    try {
      console.log(`[CLEANUP] Chrome プロセス (PID: ${chromeProcess.pid}) を終了します。`);
      process.kill(chromeProcess.pid, 'SIGKILL');
    } catch (err) {
      // Ignore if already dead
    }
  }
  if (server) {
    try {
      console.log(`[CLEANUP] HTTP サーバー (ポート: ${PORT}) を停止します。`);
      server.close();
    } catch (err) {
      // Ignore
    }
  }
}

// Simple Static File Server + API receiver
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

async function main() {
  currentPendingAction = 'HTTPサーバー起動中';
  console.log(`[START] HTTPサーバーを起動中 (ポート: ${PORT})...`);

  // We wrap the test run in a Promise so we can wait for results or timeout
  let resolveTestRun = null;
  let rejectTestRun = null;
  const testRunPromise = new Promise((resolve, reject) => {
    resolveTestRun = resolve;
    rejectTestRun = reject;
  });

  // Set timeout
  const timeoutId = setTimeout(() => {
    console.error(`\n【タイムアウト】テスト実行がタイムアウトしました (5分超過)。`);
    console.error(`待機中の処理: ${currentPendingAction}`);
    cleanupAndExit();
    process.exitCode = 1;
    rejectTestRun(new Error('Timeout'));
  }, TIMEOUT_MS);

  server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Handle API endpoints
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        const data = body ? JSON.parse(body) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));

        if (pathname === '/api/group-start') {
          console.log(`\n${data.name}`);
        } else if (pathname === '/api/group-end') {
          // No-op or end marker
        } else if (pathname === '/api/test-progress') {
          if (data.passed) {
            console.log(`  ✓ PASS: ${data.name}`);
          } else {
            console.error(`  ✗ FAIL: ${data.name}`);
            console.error(`     Error: ${data.error}`);
          }
        } else if (pathname === '/api/report-results') {
          clearTimeout(timeoutId);
          resolveTestRun(data);
        }
      });
      return;
    }

    // Serve static files
    let relativePath = pathname === '/' ? '/test.html' : pathname;
    const fullPath = path.join(process.cwd(), relativePath);

    fs.stat(fullPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('File Not Found');
        return;
      }

      const ext = path.extname(fullPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'text/plain';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(fullPath).pipe(res);
    });
  });

  server.listen(PORT, async () => {
    console.log(`[SUCCESS] HTTPサーバーが起動しました。`);

    currentPendingAction = 'Chrome起動中';
    console.log(`[START] Google Chromeを起動中...`);

    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const chromeArgs = [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${path.resolve('./chrome-user-data')}`,
      `http://localhost:${PORT}/test.html?automated=true`
    ];

    try {
      chromeProcess = spawn(chromePath, chromeArgs);
      console.log(`[SUCCESS] Chromeが正常に起動しました (PID: ${chromeProcess.pid})。`);

      chromeProcess.on('error', (err) => {
        console.error('Failed to start Chrome process:', err);
        clearTimeout(timeoutId);
        rejectTestRun(err);
      });

      chromeProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.error(`Chrome process exited early with code ${code}`);
        }
      });

      currentPendingAction = 'Chromeによるテスト実行完了待ち';
      console.log(`[START] テストページ読込・テスト結果の受信を待機中...`);

      // Wait for test results to be posted
      const results = await testRunPromise;

      console.log('\n[SUMMARY] 全テストが完了しました。結果を集計中...');
      let passedCount = 0;
      let failedCount = 0;
      results.forEach(res => {
        if (res.passed) {
          passedCount++;
        } else {
          failedCount++;
        }
      });

      console.log(`\nTest Run Summary:`);
      console.log(`  Passed: ${passedCount}/${results.length}`);
      console.log(`  Failed: ${failedCount}/${results.length}`);

      process.exitCode = failedCount > 0 ? 1 : 0;
      console.log(`[EXIT] Exit Code: ${process.exitCode}`);

    } catch (err) {
      console.error('Test run failed with error:', err.message);
      process.exitCode = 1;
    } finally {
      cleanupAndExit();
    }
  });
}

main().catch(err => {
  console.error('Unhandled fatal error:', err);
  cleanupAndExit();
  process.exitCode = 1;
});
