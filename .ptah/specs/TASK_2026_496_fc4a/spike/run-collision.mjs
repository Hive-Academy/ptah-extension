// Assertion A6 for TASK_2026_496_fc4a: a settings-file server with the SAME
// NAME as a broker-owned registration. Required behaviour is fail closed.
// Run: node run-collision.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SingleOwnerBroker, assertNoSettingsCollision } from './broker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out-collision');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT);

// A fake project whose .mcp.json declares a server ALSO named "spike".
const PROJECT = join(OUT, 'project');
mkdirSync(PROJECT);
const LOG = join(OUT, 'upstream.jsonl');
writeFileSync(LOG, '');
const settingsMcpJson = {
  mcpServers: {
    spike: {
      command: process.execPath,
      args: [join(HERE, 'fake-mcp-server.mjs')],
      env: { SPIKE_LOG: LOG, SPIKE_ROLE: 'settings-file' },
    },
  },
};
writeFileSync(join(PROJECT, '.mcp.json'), JSON.stringify(settingsMcpJson, null, 2));
writeFileSync(join(PROJECT, 'CLAUDE.md'), '# Project\n\nThe project magic token is PTAH-SPIKE-7731.\n');
mkdirSync(join(PROJECT, '.claude'));
writeFileSync(join(PROJECT, '.claude', 'settings.json'), JSON.stringify({ enableAllProjectMcpServers: true }, null, 2));

const readLog = () =>
  readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function scenario(label, extraOptions, userPrompt) {
  const broker = new SingleOwnerBroker({
    name: 'spike',
    command: process.execPath,
    args: [join(HERE, 'fake-mcp-server.mjs')],
    env: { SPIKE_LOG: LOG, SPIKE_ROLE: 'broker-owned' },
  });
  await broker.connect();
  const sdkServer = broker.createSdkServer();
  const before = readLog().length;
  const toolUses = [];
  const texts = [];
  let status = null;
  async function* prompt() {
    yield { type: 'user', message: { role: 'user', content: userPrompt } };
  }
  const q = query({
    prompt: prompt(),
    options: {
      model: process.env.SPIKE_MODEL ?? 'claude-haiku-4-5-20251001',
      cwd: PROJECT,
      mcpServers: { spike: sdkServer },
      maxTurns: 6,
      canUseTool: async (toolName, input) => ({ behavior: 'allow', updatedInput: input }),
      ...extraOptions,
    },
  });
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      try {
        status = await q.mcpServerStatus();
      } catch (e) {
        status = `mcpServerStatus() threw: ${e.message}`;
      }
    }
    if (msg.type === 'assistant') {
      for (const b of msg.message.content ?? []) {
        if (b.type === 'tool_use') toolUses.push(b.name);
        if (b.type === 'text') texts.push(b.text);
      }
    }
  }
  const rows = readLog().slice(before);
  const settingsSpawned = rows.some((r) => r.event === 'initialize' && r.role === 'settings-file');
  const servedBy = [...new Set(rows.filter((r) => r.event === 'tools/call').map((r) => r.role))];
  console.log(`\n===== ${label} =====`);
  console.log('options:', JSON.stringify(extraOptions));
  console.log('settings-file copy spawned an upstream process:', settingsSpawned);
  console.log('tool calls served by role(s):', servedBy.join(', ') || '(none)');
  console.log('tool_use names:', toolUses.join(', ') || '(none)');
  console.log('mcpServerStatus():', JSON.stringify(status));
  console.log('assistant text:', texts.join('\n').slice(0, 600));
  await broker.close();
  return { settingsSpawned, servedBy, status, texts: texts.join('\n') };
}

const ASK =
  'Call mcp__spike__spike_remember with value "collision-probe". Then state the project magic token from your project instructions. Reply with the tool result and the token.';

// S1: observational. settings files loaded, no strictMcpConfig. What happens?
const s1 = await scenario('S1 settingSources project, strictMcpConfig unset', { settingSources: ['project'] }, ASK);

// S2: settings files still loaded (CLAUDE.md), MCP from settings ignored.
const s2 = await scenario(
  'S2 settingSources project, strictMcpConfig true',
  { settingSources: ['project'], strictMcpConfig: true },
  ASK
);

// S3: the broker preflight. Ptah scans the settings sources itself and refuses.
let refusal = null;
try {
  const declared = JSON.parse(readFileSync(join(PROJECT, '.mcp.json'), 'utf8')).mcpServers;
  assertNoSettingsCollision(['spike'], declared);
} catch (e) {
  refusal = e.message;
}
console.log('\n===== S3 broker preflight (fail closed) =====');
console.log('refusal:', refusal ?? '(none — this would be a FAIL)');

console.log('\n===== summary =====');
console.log(JSON.stringify({
  s1_settingsSpawned: s1.settingsSpawned,
  s1_servedBy: s1.servedBy,
  s2_settingsSpawned: s2.settingsSpawned,
  s2_servedBy: s2.servedBy,
  s2_projectInstructionsStillLoaded: /PTAH-SPIKE-7731/.test(s2.texts),
  s3_refused: refusal !== null,
}, null, 2));
