// Assertion A4 for TASK_2026_496_fc4a: a REAL vendor SDK query drives the
// re-exposed in-process SDK server. Needs working Claude credentials.
// Run: node run-model.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SingleOwnerBroker } from './broker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out-model');
const LOG = join(OUT, 'upstream.jsonl');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT);
writeFileSync(LOG, '');

const readLog = () =>
  readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const broker = new SingleOwnerBroker({
  name: 'spike',
  command: process.execPath,
  args: [join(HERE, 'fake-mcp-server.mjs')],
  env: { SPIKE_LOG: LOG, SPIKE_ROLE: 'broker-owned' },
});
await broker.connect();
const sdkServer = broker.createSdkServer();

const permissionCalls = [];
const toolUses = [];
const texts = [];
let status = null;
let initServers = null;

async function* prompt() {
  yield {
    type: 'user',
    message: {
      role: 'user',
      content:
        'Call the tool mcp__spike__spike_remember with value "model-turn", then call mcp__spike__spike_recall. Report both results verbatim. Do not use any other tool.',
    },
  };
}

const q = query({
  prompt: prompt(),
  options: {
    model: process.env.SPIKE_MODEL ?? 'claude-haiku-4-5-20251001',
    mcpServers: { spike: sdkServer },
    settingSources: [],
    strictMcpConfig: true,
    systemPrompt: 'You are a test harness. Call exactly the tools you are told to call.',
    maxTurns: 6,
    canUseTool: async (toolName, input) => {
      permissionCalls.push({ toolName, input });
      // Prove the gate is real: deny spike_recall, allow spike_remember.
      if (toolName === 'mcp__spike__spike_recall') {
        return { behavior: 'deny', message: 'denied by the spike canUseTool gate' };
      }
      return { behavior: 'allow', updatedInput: input };
    },
  },
});

for await (const msg of q) {
  if (msg.type === 'system' && msg.subtype === 'init') {
    initServers = msg.mcp_servers ?? msg.mcpServers ?? null;
    try {
      status = await q.mcpServerStatus();
    } catch (e) {
      status = `mcpServerStatus() threw: ${e.message}`;
    }
  }
  if (msg.type === 'assistant') {
    for (const block of msg.message.content ?? []) {
      if (block.type === 'tool_use') toolUses.push({ name: block.name, input: block.input });
      if (block.type === 'text') texts.push(block.text);
    }
  }
}

const rows = readLog();
const sessions = new Set(rows.map((r) => r.session));
const upstreamCalls = rows.filter((r) => r.event === 'tools/call');

console.log('--- tool_use blocks the model emitted:', JSON.stringify(toolUses, null, 2));
console.log('--- canUseTool invocations:', JSON.stringify(permissionCalls, null, 2));
console.log('--- upstream tools/call records:', JSON.stringify(upstreamCalls, null, 2));
console.log('--- distinct upstream sessions:', sessions.size, [...sessions]);
console.log('--- system init mcp_servers:', JSON.stringify(initServers, null, 2));
console.log('--- mcpServerStatus():', JSON.stringify(status, null, 2));
console.log('--- assistant text:', texts.join('\n'));

await broker.close();
