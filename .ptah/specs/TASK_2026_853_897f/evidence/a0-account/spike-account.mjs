// A0 named-account + synced-skill collision spike (TASK_2026_853_897f, batch 1).
// Evidence fixture only. Runs the installed Agent SDK on the default Claude subscription
// route (no ANTHROPIC_* / proxy env), with the real CLAUDE config dir visible READ-ONLY
// through a bubblewrap read-only root. Only the case's own temp dirs are writable; the
// config dir's projects/ folder is shadowed by a temp mount inside the sandbox so the
// runtime transcript (for the first-turn skill_listing) never lands in the real dir.
// Credentials are never read by this script; only names / lengths are exported.
import {query} from '/home/amun/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root = path.dirname(new URL(import.meta.url).pathname);
const raw = path.join(root, 'raw');
const home = '/home/amun';
const configDir = path.join(home, '.claude');
const exe = process.env.CLAUDE_CODE_EXECPATH;

const env = {...process.env};
for (const k of Object.keys(env)) {
  if (
    k.startsWith('CLAUDE_CODE_') ||
    k.startsWith('ANTHROPIC_') ||
    /^(https?|all|no)_proxy$/i.test(k) ||
    ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_CONFIG_DIR', 'CLAUDE_EFFORT'].includes(k)
  ) delete env[k];
}

const UNKNOWN = 'anthropic-skills:a0-nonexistent-897f';
const cases = [
  {name: 'named-stream', projectDocs: false, overrides: {[UNKNOWN]: 'off'}},
  {name: 'a-baseline', projectDocs: true, overrides: null},
  {name: 'b-qualified-off', projectDocs: true, overrides: {'anthropic-skills:docs': 'off', 'anthropic-skills:pdf': 'off'}},
  {name: 'c-bare-off', projectDocs: true, overrides: {docs: 'off'}},
];

const walk = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
  : [];
// Names may be qualified (`anthropic-skills:docs`), so stop at the first colon followed by space/EOL.
// (The first recorded run used /^- ([^:\n]+):/ which truncated qualified names; see report.)
const listingNames = (content) => [...String(content).matchAll(/^- (\S+?):(?:\s|$)/gm)].map((m) => m[1]);
// Optional subset: A0_CASES=b-qualified-off,c-bare-off appends a `rerun` block to the existing results.
const only = process.env.A0_CASES ? process.env.A0_CASES.split(',') : null;

const out = {
  sdkVersion: JSON.parse(fs.readFileSync('/home/amun/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/package.json', 'utf8')).version,
  runtimeExecutable: path.basename(exe ?? 'unknown'),
  strippedEnvKeyFamilies: ['CLAUDE_CODE_*', 'ANTHROPIC_*', '*_proxy', 'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_CONFIG_DIR', 'CLAUDE_EFFORT'],
  configDirMount: 'read-only (bwrap --ro-bind / /); projects/ shadowed by a per-case temp bind inside the sandbox',
  cases: [],
};

fs.mkdirSync(raw, {recursive: true});
for (const c of cases.filter((x) => !only || only.includes(x.name))) {
  const dir = path.join(raw, c.name);
  const ws = path.join(dir, 'workspace');
  const tmp = path.join(dir, 'tmp');
  const proj = path.join(dir, 'projects');
  for (const d of [ws, tmp, proj]) fs.mkdirSync(d, {recursive: true});
  if (c.projectDocs) {
    fs.mkdirSync(path.join(ws, '.claude/skills/docs'), {recursive: true});
    fs.writeFileSync(path.join(ws, '.claude/skills/docs/SKILL.md'), '---\nname: docs\ndescription: A0 workspace docs probe\n---\n\nA0 probe skill. Do nothing.\n');
  }
  const stderr = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  const options = {
    cwd: ws,
    pathToClaudeCodeExecutable: exe,
    env: {...env, HOME: home, TMPDIR: '/tmp'},
    settingSources: ['user', 'project', 'local'],
    persistSession: true, // transcript goes to the shadowed projects/ temp mount only
    includePartialMessages: true,
    maxTurns: 1,
    maxBudgetUsd: 0.5,
    abortController: controller,
    tools: {type: 'preset', preset: 'claude_code'},
    ...(c.overrides ? {settings: {skillOverrides: c.overrides}} : {}),
    canUseTool: async (tool, input) => tool === 'Agent'
      ? {behavior: 'allow', updatedInput: input}
      : {behavior: 'deny', message: 'A0 fixture permits Agent only; no tool side effects.'},
    stderr: (s) => { if (/EROFS|EACCES|read-only|permission denied/i.test(s)) stderr.push('[write-denied diagnostic observed]'); },
    spawnClaudeCodeProcess: (o) => spawn('/usr/bin/bwrap', [
      '--ro-bind', '/', '/',
      '--bind', dir, dir,
      '--bind', tmp, '/tmp',
      '--bind', proj, path.join(configDir, 'projects'),
      '--dev', '/dev', '--proc', '/proc', '--unshare-pid', '--die-with-parent',
      '--chdir', o.cwd, o.command, ...o.args,
    ], {cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'], signal: o.signal}),
  };
  const rec = {case: c.name, options: {settingSources: options.settingSources, skillOverrides: c.overrides ?? {}, projectDocsSkill: c.projectDocs, maxTurns: 1, persistSession: 'true (sandbox temp projects/ only)'}, messageStarts: 0, textDeltas: 0};
  try {
    const q = query({prompt: 'Reply OK', options});
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        rec.init = {model: m.model, apiKeySource: m.apiKeySource, skills: m.skills, slashCommandCount: m.slash_commands?.length};
      }
      if (m.type === 'stream_event') {
        if (m.event?.type === 'message_start') rec.messageStarts++;
        if (m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') rec.textDeltas++;
      }
      if (m.type === 'assistant' && !m.parent_tool_use_id) {
        const t = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        rec.assistantText = /^OK\.?$/i.test(t) ? t : `[non-OK text omitted, length ${t.length}]`;
        rec.assistantModel = m.message.model;
      }
      if (m.type === 'result') rec.result = {subtype: m.subtype, is_error: m.is_error, num_turns: m.num_turns, total_cost_usd: m.total_cost_usd, modelUsage: Object.keys(m.modelUsage ?? {})};
      if (m.type === 'system' && m.subtype === 'startup_failure') rec.startupFailure = m.reason;
    }
  } catch (e) {
    rec.exception = {name: e.name, message: 'Runtime query failed; raw diagnostic not exported'};
  } finally {
    clearTimeout(timer);
  }
  rec.writeDeniedDiagnostics = stderr.length;
  // First-turn system-reminder skill listing from the sandbox transcript (names only).
  const listings = [];
  for (const f of walk(proj).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      try {
        const row = JSON.parse(line);
        if (row.type === 'attachment' && row.attachment?.type === 'skill_listing') listings.push(listingNames(row.attachment.content));
      } catch {}
    }
  }
  rec.transcriptSkillListing = listings.length ? listings[0] : null;
  rec.transcriptSkillListingCount = listings.length;
  out.cases.push(rec);
  console.log(JSON.stringify({case: c.name, ok: rec.result?.subtype, model: rec.init?.model, starts: rec.messageStarts, skills: rec.init?.skills?.length, listing: rec.transcriptSkillListing?.length, exception: !!rec.exception}));
}

const resultsFile = path.join(root, 'sanitized-results.json');
const final = only && fs.existsSync(resultsFile)
  ? {...JSON.parse(fs.readFileSync(resultsFile, 'utf8')), rerun: {reason: 'exact qualified names in transcript skill_listing (fixed regex)', cases: out.cases}}
  : out;
fs.writeFileSync(resultsFile, JSON.stringify(final, null, 2));
fs.rmSync(raw, {recursive: true, force: true});
console.log('raw removed:', !fs.existsSync(raw));
