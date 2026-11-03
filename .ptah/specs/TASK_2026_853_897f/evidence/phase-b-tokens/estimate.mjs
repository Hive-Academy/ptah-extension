// Offline estimate only (no model call, no credentials): reader formula ceil(len("- anthropic-skills:<name>: <desc>")/2.64)
// over manifest.json files under ~/.claude/skills/synced (read-only), deduped by id, first account folder wins.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = path.join(os.homedir(), '.claude/skills/synced'); const by = new Map();
for (const a of fs.readdirSync(dir).sort()) { const f = path.join(dir, a, 'manifest.json'); if (!fs.existsSync(f)) continue;
  for (const s of JSON.parse(fs.readFileSync(f, 'utf8')).skills) { const id = 'anthropic-skills:' + s.name; if (!by.has(id)) by.set(id, Math.ceil(`- ${id}: ${s.description ?? ''}`.length / 2.64)); } }
const rows = [...by].sort(); const total = rows.reduce((n, [, t]) => n + t, 0);
console.log(JSON.stringify({ count: rows.length, totalApproxTokens: total, rows }, null, 1));
