// scripts/regen-agents.mjs — node scripts/regen-agents.mjs [--write]
import { createJiti } from 'jiti';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const jiti = createJiti(import.meta.url);
const T = join(root, 'libs/backend/harness-sync/src/lib/targets/transformers');
const { OpencodeAgentTransformer } = await jiti.import(join(T, 'opencode-agent-transformer.ts'));
const { CodexAgentTransformer } = await jiti.import(join(T, 'codex-agent-transformer.ts'));
const write = process.argv.includes('--write');
const changed = [];
for (const file of readdirSync(join(root, '.claude/agents')).filter((f) => f.endsWith('.md'))) {
  const agentId = file.replace(/\.md$/, '');
  const content = readFileSync(join(root, '.claude/agents', file), 'utf8');
  for (const t of [new OpencodeAgentTransformer(), new CodexAgentTransformer()]) {
    const rel = t.relPathFor(agentId);
    const out = t.transform({ agentId, content });
    let cur = ''; try { cur = readFileSync(join(root, rel), 'utf8'); } catch {}
    if (cur !== out) { changed.push(rel); if (write) writeFileSync(join(root, rel), out); }
  }
}
console.log((write ? 'WROTE ' : 'WOULD CHANGE ') + changed.length + '\n' + changed.join('\n'));
