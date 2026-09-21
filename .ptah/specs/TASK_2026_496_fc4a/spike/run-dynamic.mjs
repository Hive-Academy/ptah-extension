// Extra probes for TASK_2026_496_fc4a, at protocol level, no model turn:
//   D1 does the SDK server forward tool `_meta` to its client?
//   D2 can the tool list change after createSdkMcpServer(), with list_changed?
// Run: node run-dynamic.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { SingleOwnerBroker } from './broker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out-dynamic');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT);
const LOG = join(OUT, 'upstream.jsonl');
writeFileSync(LOG, '');

const broker = new SingleOwnerBroker({
  name: 'spike',
  command: process.execPath,
  args: [join(HERE, 'fake-mcp-server.mjs')],
  env: { SPIKE_LOG: LOG, SPIKE_ROLE: 'broker-owned' },
});
await broker.connect();
const sdkServer = broker.createSdkServer();

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await sdkServer.instance.connect(serverSide);
const client = new Client({ name: 'probe', version: '0.0.0' }, { capabilities: {} });
let listChangedSeen = 0;
client.setNotificationHandler(
  z.object({ method: z.literal('notifications/tools/list_changed'), params: z.any().optional() }),
  () => { listChangedSeen += 1; }
);
await client.connect(clientSide);

const first = await client.request({ method: 'tools/list' }, z.any());
console.log('D1 tool as the SDK server reports it:', JSON.stringify(first.tools.find((t) => t.name === 'spike_remember'), null, 2));

// D2: register a new tool after construction.
sdkServer.instance.registerTool(
  'spike_added_later',
  { description: 'Added after createSdkMcpServer', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: 'late tool ok' }] })
);
await new Promise((r) => setTimeout(r, 100));
const second = await client.request({ method: 'tools/list' }, z.any());
const called = await client.request({ method: 'tools/call', params: { name: 'spike_added_later', arguments: {} } }, z.any());
console.log('D2 tools after late registration:', second.tools.map((t) => t.name).join(', '));
console.log('D2 list_changed notifications seen:', listChangedSeen);
console.log('D2 late tool call result:', JSON.stringify(called.content));

await client.close();
await broker.close();
