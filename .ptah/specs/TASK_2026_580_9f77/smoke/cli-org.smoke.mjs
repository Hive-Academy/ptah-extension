// TASK_2026_580 T1 - CLI smoke (S7 CLI part). Drives `ptah interact` over
// JSON-RPC stdio with an isolated HOME and PTAH_DB_PATH; uses rpc.call to reach
// the session:* organization methods. No credentials involved.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../../../../');
const main = path.join(root, 'dist/apps/ptah-cli/main.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-580-cli-home-'));
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-580-cli-ws-'));
const dbPath = path.join(home, 'cli.sqlite');
const sessionsDir = path.join(
  home,
  '.claude',
  'projects',
  path.resolve(ws).replace(/[:\\/]/g, '-'),
);
fs.mkdirSync(sessionsDir, { recursive: true });
const sid = randomUUID();
fs.writeFileSync(
  path.join(sessionsDir, `${sid}.jsonl`),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'CLI smoke session' },
    timestamp: new Date().toISOString(),
    sessionId: sid,
  }) + '\n',
);

const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  PTAH_DB_PATH: dbPath,
  NODE_ENV: 'test',
};
const child = spawn(process.execPath, [main, 'interact', '--cwd', ws], {
  cwd: ws,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const out = [];
const errLines = [];
let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push({ raw: line });
    }
  }
});
child.stderr.on('data', (d) => errLines.push(d.toString()));

let nextId = 1;
const pending = new Map();
function waitFor(id, ms = 60000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const hit = out.find((m) => m.id === id);
      if (hit) return resolve(hit);
      if (Date.now() - t0 > ms) return reject(new Error('timeout id ' + id));
      setTimeout(tick, 100);
    };
    tick();
  });
}
async function rpcCall(method, params) {
  const id = nextId++;
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', id, method: 'rpc.call', params: { method, params } }) + '\n',
  );
  return waitFor(id);
}

const evidence = { sessionId: sid, workspace: ws };
try {
  // wait for the engine to come up
  const t0 = Date.now();
  let list;
  for (;;) {
    try {
      list = await rpcCall('session:list', { workspacePath: ws, limit: 10 });
    } catch (e) {
      list = { error: String(e) };
    }
    const d = list.result?.data ?? list.result;
    if (d?.organizationAvailable === true || Date.now() - t0 > 120000) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  evidence.list = list;
  evidence.availableAfterMs = Date.now() - t0;
  evidence.setOrganization = await rpcCall('session:setOrganization', {
    sessionId: sid,
    priority: 'high',
    status: 'waiting',
    pinned: true,
  });
  evidence.listAfter = await rpcCall('session:list', {
    workspacePath: ws,
    limit: 10,
    priority: ['high'],
    sort: 'priority',
  });
  evidence.unknownSession = await rpcCall('session:setOrganization', {
    sessionId: randomUUID(),
    priority: 'low',
  });
} catch (e) {
  evidence.error = String(e);
}
evidence.stderrTail = errLines.join('').split('\n').slice(-15);
child.stdin.end();
await new Promise((r) => setTimeout(r, 3000));
child.kill();
fs.writeFileSync(
  path.join(import.meta.dirname, 'results-cli-evidence.json'),
  JSON.stringify(evidence, null, 2),
);
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(ws, { recursive: true, force: true });
console.log('done', Object.keys(evidence).join(','));
