// TASK_2026_853 Phase A AC2 probe: an agent's own disallowedTools must survive the
// top-level Phase A disallowedTools. Reads tool names from api-request-shape rows.
import { query } from '/home/amun/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
import fs from 'node:fs';

const [outFile, workspace, slugDir] = process.argv.slice(2);
const denyTools = ['Workflow', 'ReportFindings', 'PushNotification', 'DesignSync', 'EnterWorktree', 'ExitWorktree'];
const env = { ...process.env };
for (const k of Object.keys(env))
  if (k.startsWith('CLAUDE_CODE_') || ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_AGENT_SDK_VERSION'].includes(k)) delete env[k];

let sessionId = null;
const q = query({
  prompt: 'Call the Agent tool once with subagent_type probe-deny and the prompt "Reply PROBE_CHILD_OK only. Do not use tools." Then reply PROBE_OK only.',
  options: {
    cwd: workspace,
    pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECPATH,
    env,
    settingSources: ['user', 'project', 'local'],
    tools: { type: 'preset', preset: 'claude_code' },
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    maxTurns: 4,
    maxBudgetUsd: 2,
    persistSession: true,
    disallowedTools: denyTools,
    agents: {
      'probe-deny': {
        description: 'Phase A probe agent with its own deny list',
        prompt: 'Reply PROBE_CHILD_OK only. Do not use tools.',
        model: 'inherit',
        disallowedTools: ['Edit'],
      },
    },
    canUseTool: async (tool, input) =>
      tool === 'Agent' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Probe permits Agent only.' },
  },
});
for await (const m of q) if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;

const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name])) : []);
const files = walk(slugDir).filter((f) => f.includes(sessionId) && f.endsWith('.jsonl'));
const toolNames = (row) => [...JSON.stringify(row).matchAll(/"name":"([A-Za-z]+)"/g)].map((x) => x[1]);
const out = { sessionId, transcripts: [] };
for (const f of files) {
  const shapes = fs.readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { const r = JSON.parse(l); return r.type === 'api-request-shape' ? [r] : []; } catch { return []; } });
  if (!shapes.length) continue;
  const names = new Set(toolNames(shapes[0]));
  out.transcripts.push({
    kind: f.includes('/subagents/') ? 'subagent' : 'main',
    firstShapeToolCount: names.size,
    hasWebFetch: names.has('WebFetch'),
    hasEdit: names.has('Edit'),
    names: [...names].sort(),
    hasWorkflow: names.has('Workflow'),
    hasReportFindings: names.has('ReportFindings'),
    hasRead: names.has('Read'),
  });
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
