import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import url from 'url';

const LAUNCH_TIMEOUT_MS = 30 * 1000;
const TESTS_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_TIMEOUT_MS = 10 * 1000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB

let server = null;
let chromeProcess = null;
let tempProfileDir = null;
let cleanupStarted = false;
let cleanupPromise = null;
let launchTimeoutId = null;
let testsTimeoutId = null;
let serverPort = 0;

const startTime = Date.now();

function getElapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(2) + 's';
}

function logPhase(phase, details = '') {
  console.log(`\n[PHASE] ${phase} [${getElapsed()}] ${details}`);
}

// Search for Chrome/Chromium executable
function findChromeExecutable() {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }
    console.error(`CHROME_PATH was specified but not found: ${process.env.CHROME_PATH}`);
  }

  const macCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];

  for (const candidate of macCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// Consolidate async cleanup
async function cleanup(reason) {
  if (cleanupStarted) return cleanupPromise;
  cleanupStarted = true;

  logPhase('cleanup', `Reason: ${reason}`);

  cleanupPromise = (async () => {
    // 1. Clear timeouts
    if (launchTimeoutId) clearTimeout(launchTimeoutId);
    if (testsTimeoutId) clearTimeout(testsTimeoutId);

    // 2. Kill Chrome process group
    if (chromeProcess && chromeProcess.pid && typeof chromeProcess.pid === 'number' && chromeProcess.pid > 1) {
      const pid = chromeProcess.pid;
      if (pid !== process.pid && pid !== 0 && pid !== 1) {
        console.log(`[CLEANUP] Terminating Chrome process group (PGID: ${pid}) via SIGTERM...`);
        try {
          // Negative PID kills the process group on Unix systems
          process.kill(-pid, 'SIGTERM');
        } catch (err) {
          // Ignore if process group doesn't exist
        }

        // Wait up to 3 seconds for it to exit
        let isDead = false;
        for (let i = 0; i < 30; i++) {
          try {
            process.kill(pid, 0); // Check if process is still alive
            await new Promise(r => setTimeout(r, 100));
          } catch (e) {
            isDead = true;
            break;
          }
        }

        if (!isDead) {
          console.log(`[CLEANUP] Chrome process group (PGID: ${pid}) still alive. Sending SIGKILL...`);
          try {
            process.kill(-pid, 'SIGKILL');
          } catch (err) {
            // Ignore
          }
        } else {
          console.log('[CLEANUP] Chrome process group terminated successfully.');
        }
      }
    }

    // 3. Close HTTP server
    if (server) {
      console.log(`[CLEANUP] Closing HTTP server on port ${serverPort}...`);
      await new Promise(resolve => {
        server.close(() => {
          console.log('[CLEANUP] HTTP server closed.');
          resolve();
        });
      });
    }

    // 4. Remove temporary Profile directory
    if (tempProfileDir && fs.existsSync(tempProfileDir)) {
      const isTmpDir = tempProfileDir.startsWith(os.tmpdir());
      if (isTmpDir && tempProfileDir !== os.tmpdir()) {
        console.log(`[CLEANUP] Removing temporary Profile directory: ${tempProfileDir}`);
        try {
          fs.rmSync(tempProfileDir, { recursive: true, force: true });
          console.log('[CLEANUP] Temporary Profile directory removed.');
        } catch (err) {
          console.error(`[CLEANUP] Failed to remove temporary Profile directory: ${err.message}`);
        }
      }
    }

    logPhase('complete', `Cleanup finished.`);
  })();

  // Enforce cleanup timeout
  await Promise.race([
    cleanupPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timed out')), CLEANUP_TIMEOUT_MS))
  ]).catch(err => {
    console.error(`[CLEANUP ERROR] ${err.message}`);
  });
}

// Handle signals
process.on('SIGINT', async () => {
  await cleanup('SIGINT');
  process.exit(1);
});
process.on('SIGTERM', async () => {
  await cleanup('SIGTERM');
  process.exit(1);
});

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

async function run() {
  const args = process.argv.slice(2);
  let testGroup = null;
  let hasInvalidArg = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--group') {
      testGroup = args[i + 1] || null;
      i++;
    } else if (args[i].startsWith('--group=')) {
      testGroup = args[i].split('=')[1] || null;
    } else if (args[i] === '--all') {
      testGroup = 'all';
    } else {
      hasInvalidArg = true;
    }
  }

  const validGroups = ['hash', 'folder', 'archive', 'review', 'all'];
  if (hasInvalidArg || (testGroup !== null && !validGroups.includes(testGroup))) {
    console.error(`
利用方法 (Usage):
  node run-tests-node.js [--group <group_name>] [--all]

有効なグループ名 (Valid group names):
  - hash    : ハッシュ検証関連テストのみ実行
  - folder  : フォルダ管理・スキャン関連テストのみ実行
  - archive : アーカイブ・完全削除関連テストのみ実行
  - review  : レビュー編集（Review Editor）関連テストのみ実行
  - all     : すべてのテストを実行

例 (Examples):
  node run-tests-node.js --group folder
  node run-tests-node.js --group hash
  node run-tests-node.js --group archive
  node run-tests-node.js --group review
  node run-tests-node.js --all
    `);
    process.exitCode = 1;
    return;
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error(`
========================================================================
Chrome executable was not found.
Set CHROME_PATH or install Google Chrome/Chromium.
Candidates searched:
  - /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  - /Applications/Chromium.app/Contents/MacOS/Chromium
========================================================================
    `);
    process.exitCode = 1;
    return;
  }

  // Define resolve/reject for the main tests run promise
  let resolveTestRun;
  let rejectTestRun;
  const testRunPromise = new Promise((resolve, reject) => {
    resolveTestRun = resolve;
    rejectTestRun = reject;
  });

  let resolvedOnce = false;
  function resolveOnce(data, isError = false, errorMsg = '') {
    if (resolvedOnce) return;
    resolvedOnce = true;
    if (isError) {
      rejectTestRun(new Error(errorMsg));
    } else {
      resolveTestRun(data);
    }
  }

  logPhase('server-start', 'Starting HTTP server on dynamic port...');

  server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (req.method === 'POST') {
      let body = '';
      let bytesReceived = 0;
      let bodyLimitExceeded = false;

      req.on('data', chunk => {
        if (bodyLimitExceeded) return;
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_BODY_BYTES) {
          bodyLimitExceeded = true;
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end('Payload Too Large');
          resolveOnce(null, true, 'Request body size limit exceeded');
          return;
        }
        body += chunk;
      });

      req.on('end', () => {
        if (bodyLimitExceeded) return;

        let data = {};
        try {
          data = body ? JSON.parse(body) : {};
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          console.error(`[SERVER] Failed to parse POST JSON: ${err.message}`);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));

        // Clear launch timeout on first contact
        if (launchTimeoutId) {
          clearTimeout(launchTimeoutId);
          launchTimeoutId = null;
        }

        if (pathname === '/api/group-start') {
          console.log(`\n${data.name}`);
        } else if (pathname === '/api/metric') {
          console.log(`[METRIC] ${data.message}`);
        } else if (pathname === '/api/group-end') {
          // No-op
        } else if (pathname === '/api/test-progress') {
          if (data.passed) {
            console.log(`  ✓ PASS: ${data.name}`);
          } else {
            console.error(`  ✗ FAIL: ${data.name}`);
            console.error(`     Error: ${data.error}`);
          }
        } else if (pathname === '/api/report-results') {
          logPhase('result-received', `Received ${data.length} test results.`);
          resolveOnce(data);
        } else if (pathname === '/api/test-fatal') {
          console.error(`\n[FATAL ERROR IN BROWSER] Reason: ${data.reason}\nError: ${data.error}`);
          resolveOnce(null, true, `Fatal browser error: ${data.error}`);
        }
      });
      return;
    }

    // Serve static files
    const relativePath = pathname === '/' ? '/test.html' : pathname;
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

  // Listen on random port (0)
  server.listen(0, '127.0.0.1', async (err) => {
    if (err) {
      console.error(`HTTP server failed to start: ${err.message}`);
      resolveOnce(null, true, `HTTP server error: ${err.message}`);
      return;
    }

    serverPort = server.address().port;
    console.log(`[SERVER] HTTP server running on http://127.0.0.1:${serverPort}`);

    // Create temporary profile
    try {
      tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-reviewer-test-'));
      console.log(`[PROFILE] Temporary Profile Directory created: ${tempProfileDir}`);
    } catch (profileErr) {
      console.error(`Failed to create temporary profile dir: ${profileErr.message}`);
      resolveOnce(null, true, `Profile dir error: ${profileErr.message}`);
      return;
    }

    logPhase('chrome-launch', `Launching Chrome Headless via: ${chromePath}`);



    let targetUrl = `http://127.0.0.1:${serverPort}/test.html?automated=true`;
    if (testGroup) {
      targetUrl += `&group=${testGroup}`;
    }

    const chromeArgs = [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--remote-debugging-port=0',
      '--no-sandbox',
      `--user-data-dir=${tempProfileDir}`,
      targetUrl
    ];

    try {
      // Launch Chrome in separate process group
      chromeProcess = spawn(chromePath, chromeArgs, { detached: true });
      console.log(`[CHROME] Chrome process group spawned (PID: ${chromeProcess.pid})`);

      // Set launch timeout (30 seconds)
      launchTimeoutId = setTimeout(() => {
        resolveOnce(null, true, 'Chrome failed to start or load tests page within 30 seconds');
      }, LAUNCH_TIMEOUT_MS);

      chromeProcess.on('error', (spawnErr) => {
        console.error('[CHROME ERROR] Spawn failed:', spawnErr);
        resolveOnce(null, true, `Chrome spawn error: ${spawnErr.message}`);
      });

      chromeProcess.on('exit', (exitCode) => {
        console.log(`[CHROME EXIT] Chrome exited with code ${exitCode}`);
        resolveOnce(null, true, `Chrome exited prematurely with code ${exitCode}`);
      });

      testsTimeoutId = setTimeout(() => {
        resolveOnce(null, true, 'Test suite execution timed out (5 minutes exceeded)');
      }, TESTS_TIMEOUT_MS);

      logPhase('page-load', 'Waiting for automated tests page load and test progress updates...');

      // Wait for results or failure
      const results = await testRunPromise;
      if (launchTimeoutId) clearTimeout(launchTimeoutId);
      if (testsTimeoutId) clearTimeout(testsTimeoutId);

      // Analyze results
      let passedCount = 0;
      let failedCount = 0;
      results.forEach(res => {
        if (res.passed) {
          passedCount++;
        } else {
          failedCount++;
        }
      });

      console.log(`\n===================================`);
      console.log(`Test Run Completed:`);
      console.log(`  Passed: ${passedCount}/${results.length}`);
      console.log(`  Failed: ${failedCount}/${results.length}`);
      console.log(`===================================`);

      process.exitCode = failedCount > 0 ? 1 : 0;

    } catch (err) {
      console.error(`\n[FATAL RUN ERROR] ${err.message}`);
      process.exitCode = 1;
    } finally {
      await cleanup(process.exitCode === 0 ? 'Success' : 'Failure');
      
      // Diagnostic check for hanging handles
      const activeHandles = process._getActiveHandles ? process._getActiveHandles() : [];
      const activeRequests = process._getActiveRequests ? process._getActiveRequests() : [];
      if (activeHandles.length > 0 || activeRequests.length > 0) {
        console.log(`\n[DIAGNOSTIC] Remaining active handles: ${activeHandles.length}, requests: ${activeRequests.length}`);
        activeHandles.forEach((h, idx) => {
          console.log(`  Handle ${idx + 1}: type=${h.constructor.name}`);
        });
      }
    }
  });
}

run().catch(async (err) => {
  console.error('[UNHANDLED FATAL ERROR]', err);
  process.exitCode = 1;
  await cleanup('Unhandled error');
});
