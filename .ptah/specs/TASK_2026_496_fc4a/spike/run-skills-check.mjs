// Does `strictMcpConfig: true` cost anything besides settings-file MCP servers?
// Checks the system init message for project skills and slash commands.
// The loop breaks at init, so no model turn is billed.
// Run: node run-skills-check.mjs
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out-skills');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
const PROJECT = join(OUT, 'project');
mkdirSync(join(PROJECT, '.claude', 'skills', 'spike-skill'), { recursive: true });
mkdirSync(join(PROJECT, '.claude', 'commands'), { recursive: true });
writeFileSync(
  join(PROJECT, '.claude', 'skills', 'spike-skill', 'SKILL.md'),
  '---\nname: spike-skill\ndescription: A skill that exists only to be counted by the spike.\n---\n\nSay SPIKE.\n'
);
writeFileSync(join(PROJECT, '.claude', 'commands', 'spike-cmd.md'), 'Say SPIKE.\n');
writeFileSync(join(PROJECT, '.mcp.json'), JSON.stringify({ mcpServers: { spike: { command: 'node', args: ['nope.js'] } } }, null, 2));
writeFileSync(join(PROJECT, 'CLAUDE.md'), '# Project\n\nThe project magic token is PTAH-SPIKE-7731.\n');

async function probe(label, options) {
  async function* prompt() {
    yield { type: 'user', message: { role: 'user', content: 'noop' } };
  }
  const q = query({ prompt: prompt(), options: { model: 'claude-haiku-4-5-20251001', cwd: PROJECT, maxTurns: 1, ...options } });
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log(`\n===== ${label} =====`);
      console.log('init keys:', Object.keys(msg).join(', '));
      console.log('mcp_servers:', JSON.stringify(msg.mcp_servers));
      console.log('slash_commands includes spike-cmd:', (msg.slash_commands ?? []).includes('spike-cmd'));
      console.log('skill surface:', JSON.stringify(msg.skills ?? msg.agents ?? '(no skills field)').slice(0, 300));
      console.log('tools includes Skill:', (msg.tools ?? []).includes('Skill'));
      console.log('plugins:', JSON.stringify(msg.plugins ?? '(none)').slice(0, 300));
      break;
    }
  }
  await q.interrupt?.().catch(() => {});
}

await probe('strictMcpConfig unset', { settingSources: ['project'], skills: 'all' });
await probe('strictMcpConfig true', { settingSources: ['project'], skills: 'all', strictMcpConfig: true });
process.exit(0);
