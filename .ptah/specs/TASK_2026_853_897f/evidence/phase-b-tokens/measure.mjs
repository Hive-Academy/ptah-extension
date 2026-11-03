// TASK_2026_853 Phase B token measurement. Same login, same workspace, same settings;
// both sides carry the Phase A denials; only the 13 synced-skill denials differ.
import { query } from '/home/amun/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
import fs from 'node:fs';

const [outFile, workspace, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const denyTools = ['Workflow', 'ReportFindings', 'PushNotification', 'DesignSync', 'EnterWorktree', 'ExitWorktree'];
const denySkills = ['keybindings-help', 'update-config', 'fewer-permission-prompts', 'plugin-authoring', 'init', 'workflow-authoring', 'code-review'];
const syncedSkills = ['built-in-browser','chrome-browser','computer-use','deep-research','docs','docx','google-workspace','import-memory','morning','pdf','pptx','skill-creator','xlsx'].map((n) => 'anthropic-skills:' + n);
const env = { ...process.env };
for (const k of Object.keys(env))
  if (k.startsWith('CLAUDE_CODE_') || ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_AGENT_SDK_VERSION'].includes(k)) delete env[k];

const total = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
const results = [];
for (let i = 0; i < runs; i++) {
  for (const side of ['before', 'after']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    const options = {
      cwd: workspace,
      pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECPATH,
      env,
      settingSources: ['user', 'project', 'local'],
      tools: { type: 'preset', preset: 'claude_code' },
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      maxTurns: 4,
      maxBudgetUsd: 2,
      abortController: controller,
      persistSession: true,
      disallowedTools: denyTools,
      settings: { skillOverrides: Object.fromEntries([...denySkills, ...(side === 'after' ? syncedSkills : [])].map((n) => [n, 'off'])) },
      canUseTool: async (tool, input) =>
        tool === 'Agent' || tool === 'Task'
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Measurement run permits Agent only.' },
    };
    const row = { run: i + 1, side, main: null, subagent: null, toolCount: null, skillCount: null };
    try {
      const q = query({
        prompt:
          'Call the Agent tool once with subagent_type general-purpose and the prompt "Reply MEASURE_CHILD_OK only. Do not use tools." Then reply MEASURE_OK only.',
        options,
      });
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          row.toolCount = m.tools?.length ?? null;
          row.skillCount = m.skills?.length ?? null;
          row.sessionId = m.session_id;
        }
        if (m.type === 'assistant' && m.message?.usage) {
          const key = m.parent_tool_use_id ? 'subagent' : 'main';
          if (row[key] === null) row[key] = total(m.message.usage);
        }
        if (m.type === 'result') row.result = m.subtype;
      }
    } catch (e) {
      row.error = e?.name ?? 'Error';
    } finally {
      clearTimeout(timer);
    }
    if (row.sessionId) {
      const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]) : [];
      const base = process.env.HOME + '/.claude/projects/-home-amun-ptah-extension';
      const files = walk(base).filter((f) => f.includes(row.sessionId) && f.includes('/subagents/') && f.endsWith('.jsonl'));
      for (const f of files) {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          try { const r = JSON.parse(line); if (r.type === 'assistant' && r.message?.usage && row.subagent === null) row.subagent = total(r.message.usage); } catch {}
        }
      }
      row.subagentFiles = files.length;
    }
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const summary = {};
for (const side of ['before', 'after'])
  for (const key of ['main', 'subagent'])
    summary[`${side}.${key}`] = median(results.filter((r) => r.side === side).map((r) => r[key]));
fs.writeFileSync(outFile, JSON.stringify({ denyTools, denySkills, syncedSkills, results, summary }, null, 2));
console.log(JSON.stringify(summary));
