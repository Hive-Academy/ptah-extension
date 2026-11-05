// Probe: does a Node child spawn (and network) work inside each Codex sandbox policy?
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = join(dirname(fileURLToPath(import.meta.url)), 'codex-eperm-probe.json');
const codexJs = join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
const child = spawn(process.execPath, [codexJs, 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1; const pending = new Map(); const events = [];
createInterface({ input: child.stdout }).on('line', (l) => { try { const m = JSON.parse(l); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else events.push(m); } catch {} });
const req = (method, params) => new Promise((r) => { const i = id++; pending.set(i, r); child.stdin.write(JSON.stringify({ id: i, method, params }) + '\n'); });
const cwd = process.cwd();
const policies = {
  'workspace-write-no-network': { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false },
  'workspace-write-network': { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: true },
  'danger-full-access': { type: 'dangerFullAccess' },
};
const cmd = `node -e "const r=require('node:child_process').spawnSync(process.execPath,['-e','process.stdout.write(1+1+String())'],{encoding:'utf8'});console.log('SPAWN', r.error?r.error.code:'ok:'+r.stdout)" ; node -e "fetch('https://registry.npmjs.org/-/ping').then(r=>console.log('NET ok',r.status)).catch(e=>console.log('NET fail',e.cause?.code||e.message))"`;
const results = {};
await req('initialize', { clientInfo: { name: 'ptah-eperm-probe', version: '1' }, capabilities: { experimentalApi: true } });
child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
for (const [name, sandboxPolicy] of Object.entries(policies)) {
  const t = await req('thread/start', { cwd, approvalPolicy: 'never', ephemeral: true });
  const threadId = t.result.thread.id;
  const s = await req('turn/start', { threadId, sandboxPolicy, approvalPolicy: 'never', effort: 'low', input: [{ type: 'text', text: `Run exactly this one shell command and then reply with only its full output, verbatim:\n${cmd}` }] });
  const turnId = s.result?.turn?.id;
  for (let i = 0; i < 120 && !events.some((e) => e.method === 'turn/completed' && e.params?.turn?.id === turnId); i++) await new Promise((r) => setTimeout(r, 1000));
  const exec = events.filter((e) => e.params?.threadId === threadId && e.method === 'item/completed' && e.params?.item?.type === 'commandExecution').map((e) => ({ exitCode: e.params.item.exitCode, output: String(e.params.item.aggregatedOutput ?? '').slice(0, 600) }));
  results[name] = { startError: s.error ?? null, exec };
  console.log(name, JSON.stringify(results[name]));
}
writeFileSync(out, JSON.stringify(results, null, 2));
child.kill();
