import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'void-smoke-'));
await writeFile(path.join(temp, '.env'), '');
const secret = () => randomBytes(32).toString('hex');
const frontendPort = process.env.SMOKE_FRONTEND_PORT || '43100';
const backendPort = process.env.SMOKE_BACKEND_PORT || '43101';
const front = `http://127.0.0.1:${frontendPort}`;
const back = `http://127.0.0.1:${backendPort}`;
const require = createRequire(path.join(root, 'backend/server/package.json'));
const { WebSocket } = require('ws');
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1',
  VOID_ACCESS_USER: 'smoke', VOID_ACCESS_PASSWORD: secret(), VOID_INTERNAL_KEY: secret(),
  ENCRYPTION_KEY: secret(), BACKEND_URL: '', FRONTEND_URL: '',
  BACKEND_PORT: backendPort, PORT: frontendPort,
  VOID_ENV_PATH: path.join(temp, '.env'), FREEAPI_DB_PATH: path.join(temp, 'smoke.db'),
  ATTACHMENT_STORAGE_DIR: path.join(temp, 'attachments'),
};
const children = [];
let backendPid;
let startupOutput = '';
function start(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Drain logs without exposing generated credentials or provider data.
  child.stdout.on('data', chunk => {
    startupOutput = (startupOutput + chunk.toString()).slice(-10_000);
    const starts = [...startupOutput.matchAll(/Agent server process started \(pid (\d+)\)/g)];
    if (starts.length) backendPid = Number(starts.at(-1)[1]);
  });
  child.stderr.on('data', () => {});
  child.on('error', error => console.error('Smoke child process failed:', error.message));
  children.push(child); return child;
}
async function wait(url, child) {
  for (let n = 0; n < 120; n++) {
    if (child.exitCode !== null) throw new Error(`Service exited with code ${child.exitCode}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Service never became ready: ${url}`);
}
async function rejectVoiceUpgrade() {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(front.replace(/^http/, 'ws') + '/api/voice-stream?ticket=invalid', { handshakeTimeout: 5000 });
    socket.once('unexpected-response', (_request, response) => {
      try { assert.equal(response.statusCode, 410, 'the retired environment-key voice socket cannot be used'); resolve(); }
      catch (error) { reject(error); }
      finally { response.resume(); socket.terminate(); }
    });
    socket.once('error', reject);
    socket.once('open', () => { socket.terminate(); reject(new Error('Invalid voice ticket was accepted')); });
  });
}
try {
  const supervisor = start([path.join(root, 'scripts/app-supervisor.mjs'), '--production'], root);
  await Promise.all([wait(`${back}/api/ping`, supervisor), wait(`${front}/api/health`, supervisor)]);
  assert(Number.isInteger(backendPid), 'supervisor must own the backend process');
  const originalBackendPid = backendPid;
  process.kill(originalBackendPid);
  for (let n = 0; n < 100 && backendPid === originalBackendPid; n++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.notEqual(backendPid, originalBackendPid, 'supervisor must restart a stopped backend');
  await Promise.all([wait(`${back}/api/ping`, supervisor), wait(`${front}/api/health`, supervisor)]);
  for (const route of ['/api/chat', '/api/client-tool', '/api/file-read', '/api/sandbox', '/sandbox-runtime/private.txt', '/api/attachments', '/api/voice', '/api/generated-image/missing', '/']) {
    assert.equal((await fetch(front + route)).status, 401, route);
  }
  assert.equal((await fetch(`${back}/api/agent/chat`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${back}/api/auth/setup`, { method: 'POST' })).status, 404);
  for (const route of ['/api/keys', '/api/models', '/api/fallback', '/v1/models', '/']) {
    assert.equal((await fetch(back + route)).status, 404, route);
  }
  await assert.rejects(access(env.FREEAPI_DB_PATH), 'startup must not create a legacy SQLite database');
  await rejectVoiceUpgrade();
  const auth = { Authorization: `Basic ${Buffer.from(`${env.VOID_ACCESS_USER}:${env.VOID_ACCESS_PASSWORD}`).toString('base64')}` };
  assert.equal((await fetch(front, { headers: auth })).status, 200);
  const runtime = await fetch(`${front}/sandbox-runtime/worker.js`, { headers: { Origin: 'null' } });
  assert.equal(runtime.status, 200); assert.equal(runtime.headers.get('access-control-allow-origin'), '*');
  const sandbox = await fetch(`${front}/api/sandbox`, { headers: auth });
  assert.equal(sandbox.status, 200); assert.match(sandbox.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.match(await sandbox.text(), new RegExp(`127\\.0\\.0\\.1:${frontendPort}/sandbox-runtime`));
  assert.equal((await fetch(`${front}/dev-workspace-preview`, { headers: auth })).status, 404);
  const form = new FormData(); form.append('file', new Blob(['private smoke file'], { type: 'text/plain' }), 'smoke.txt');
  const upload = await fetch(`${front}/api/attachments`, { method: 'POST', headers: auth, body: form });
  assert.equal(upload.status, 200);
  assert.equal(upload.headers.has('x-void-internal-key'), false);
  const { url } = await upload.json();
  assert.equal((await fetch(front + url)).status, 401);
  const download = await fetch(front + url, { headers: auth });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'private smoke file');
  assert.equal((await fetch(`${front}/api/image-proxy?url=http://127.0.0.1`, { headers: auth })).status, 400);
  console.log('Production smoke passed: custom PORT supervision and backend restart, no SQLite key pool, retired API removal, frontend/backend access, same-port voice ticket rejection, authenticated upload/download, secret-header redaction, and private-network image rejection.');
  console.log('Only temporary test data was written. No provider or hosted database calls were made by the smoke checks.');
} finally {
  for (const child of children) {
    if (process.platform === 'win32' && child.exitCode === null) {
      // Windows SIGTERM forcibly ends the supervisor without running its signal
      // handler. Stop this smoke run's complete process tree to avoid orphans.
      try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    } else child.kill();
  }
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
}
