// Assertions A1, A2, A3, A5 and A6 for TASK_2026_496_fc4a. No model needed.
// Run: node run-host.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { SingleOwnerBroker, assertNoSettingsCollision } from './broker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const LOG = join(OUT, 'upstream.jsonl');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT);
writeFileSync(LOG, '');

const results = [];
function check(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${title}\n      ${detail}`);
}

function readLog() {
  return readFileSync(LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
function liveSessions(rows) {
  const open = new Set();
  for (const r of rows) {
    if (r.event === 'initialize') open.add(r.session);
    if (r.event === 'close') open.delete(r.session);
  }
  return [...open];
}

const broker = new SingleOwnerBroker({
  name: 'spike',
  command: process.execPath,
  args: [join(HERE, 'fake-mcp-server.mjs')],
  env: { SPIKE_LOG: LOG, SPIKE_ROLE: 'broker-owned' },
});

await broker.connect();
await new Promise((r) => setTimeout(r, 200));

// --- A3: the host path sees tool `_meta` and can list and read resources.
const tools = broker.tools;
const metaTool = tools.find((t) => t.name === 'spike_remember');
check(
  'A3a',
  'Host lists tools WITH _meta',
  !!metaTool?._meta?.['spike/uiResource'],
  `spike_remember._meta = ${JSON.stringify(metaTool?._meta)}`
);
const resources = await broker.listResources();
check(
  'A3b',
  'Host lists resources',
  resources.length === 2 && resources.some((r) => r.uri === 'ui://spike/card.html'),
  `resources = ${resources.map((r) => r.uri).join(', ')}`
);
const card = await broker.readResource('ui://spike/card.html');
check(
  'A3c',
  'Host reads a resource',
  card.contents[0].mimeType === 'text/html+skybridge',
  `read ui://spike/card.html -> ${card.contents[0].text.slice(0, 48)}...`
);

// --- A1: exactly ONE live upstream transport for one configured server.
let rows = readLog();
let live = liveSessions(rows);
const ownerSession = live[0];
check(
  'A1',
  'Exactly one live upstream session after connect',
  live.length === 1,
  `initialize=${rows.filter((r) => r.event === 'initialize').length} close=${rows.filter((r) => r.event === 'close').length} live=${live.length} session=${ownerSession}`
);

// --- A5: the re-exposed in-process SDK server lists and calls tools, and the
// call reaches the SAME upstream session (no second process).
const sdkServer = broker.createSdkServer();
check(
  'A5a',
  'createSdkMcpServer returns type "sdk" with a live instance, named after upstream',
  sdkServer.type === 'sdk' && sdkServer.name === 'spike' && !!sdkServer.instance,
  `type=${sdkServer.type} name=${sdkServer.name} instance=${sdkServer.instance?.constructor?.name}`
);

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await sdkServer.instance.connect(serverSide);
const modelClient = new Client({ name: 'model-side', version: '0.0.0' }, { capabilities: {} });
await modelClient.connect(clientSide);

const sdkTools = await modelClient.request({ method: 'tools/list' }, z.any());
check(
  'A5b',
  'Model path lists the tools through the SDK server',
  sdkTools.tools.map((t) => t.name).sort().join(',') === 'spike_recall,spike_remember',
  `tools = ${sdkTools.tools.map((t) => t.name).join(', ')}`
);

const sdkCall = await modelClient.request(
  { method: 'tools/call', params: { name: 'spike_remember', arguments: { value: 'written-by-model-path' } } },
  z.any()
);
check(
  'A5c',
  'Model path calls a tool through the SDK server',
  sdkCall.content[0].text.startsWith('stored:written-by-model-path'),
  `result = ${sdkCall.content[0].text}`
);

// --- state consistency: one memory, shared by both paths.
const mem = await broker.readResource('spike://memory');
const memJson = JSON.parse(mem.contents[0].text);
check(
  'A5d',
  'Host resource read sees the model path write (one session, one memory)',
  memJson.memory === 'written-by-model-path' && memJson.session === ownerSession,
  `spike://memory = ${mem.contents[0].text}`
);

rows = readLog();
live = liveSessions(rows);
check(
  'A1b',
  'Still exactly one live upstream session after the model path call',
  live.length === 1 && live[0] === ownerSession,
  `live=${live.length} sessions seen=${new Set(rows.map((r) => r.session)).size}`
);

// --- A2: close before replace on reconnect.
await broker.reconnect();
await new Promise((r) => setTimeout(r, 200));
rows = readLog();
const order = rows.filter((r) => r.event === 'initialize' || r.event === 'close').map((r) => `${r.event}:${r.session.slice(0, 8)}`);
const idxOldClose = rows.findIndex((r) => r.event === 'close' && r.session === ownerSession);
const idxNewInit = rows.findIndex((r) => r.event === 'initialize' && r.session !== ownerSession);
check(
  'A2a',
  'Reconnect closes the old session BEFORE the new session starts',
  idxOldClose >= 0 && idxNewInit >= 0 && idxOldClose < idxNewInit,
  `order = ${order.join(' -> ')}`
);
live = liveSessions(rows);
check(
  'A2b',
  'Exactly one live upstream session after reconnect',
  live.length === 1 && live[0] !== ownerSession,
  `live=${live.length} distinct sessions ever=${new Set(rows.map((r) => r.session)).size}`
);

// --- A6 (unit half): the fail-closed collision rule.
let collisionError = null;
try {
  assertNoSettingsCollision(['spike'], { spike: { command: 'node', args: ['other.js'] }, other: {} });
} catch (e) {
  collisionError = e;
}
check(
  'A6a',
  'Same-name settings server makes the broker refuse to start (fail closed)',
  collisionError instanceof Error && /refusing to start/.test(collisionError.message),
  `error = ${collisionError?.message}`
);

// --- guard: a second connect() on the same broker is refused.
let secondConnect = null;
try {
  await broker.connect();
} catch (e) {
  secondConnect = e;
}
check(
  'A1c',
  'A second upstream transport for the same server is refused',
  secondConnect instanceof Error,
  `error = ${secondConnect?.message}`
);

await modelClient.close();
await broker.close();
await new Promise((r) => setTimeout(r, 200));
rows = readLog();
check(
  'A1d',
  'No upstream session is left alive after teardown',
  liveSessions(rows).length === 0,
  `initialize=${rows.filter((r) => r.event === 'initialize').length} close=${rows.filter((r) => r.event === 'close').length}`
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed.`);
process.exit(failed.length === 0 ? 0 : 1);
