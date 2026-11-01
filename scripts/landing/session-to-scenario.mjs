#!/usr/bin/env node
/**
 * Convert one turn of a real PtahCode/Claude session into a public live-demo
 * scenario. Read-only on every source; the output is synthetic text.
 *
 * Usage:
 *   node scripts/landing/session-to-scenario.mjs \
 *     --session ~/.claude/projects/<project>/<session-id>.jsonl \
 *     --turn "<text from the user prompt>" | --turn "#<n>" \
 *     [--end-row <transcript row>] [--duration <seconds, default 75>] \
 *     [--id orchestration] [--title "PtahCode orchestration session"] [--prompt "<composer text>"] \
 *     [--subagent-steps 4] [--lane-segments 8] [--state-dir ~/.ptah/state] [--deny "term,term"] \
 *     --out libs/web/landing/src/lib/live-demo/scenarios/<id>.json
 *
 * Pipeline:
 * 1. PtahCode's history reader and replay service turn the transcript window
 *    into the events `chat:resume` serves (session-replay/ptah-history.mjs).
 * 2. Lane references and output come from the session record and its
 *    `agent-output.<agentId>` blobs (session-replay/lane-history.mjs).
 * 3. The events become the live push stream, compressed to --duration
 *    (session-replay/live-timeline.mjs).
 * 4. Text is rewritten to synthetic content, the B5 sanitizer runs in strict
 *    mode, placeholders it leaves are refilled with the synthetic text, a final
 *    rewrite runs, and both privacy scans must report nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { loadRepoModule, readSession, replayToStreamEvents, repoRoot, parseLaneEnvelope } from './session-replay/ptah-history.mjs';
import { readLanes } from './session-replay/lane-history.mjs';
import { classify, selectTurnWindow, textOf } from './session-replay/turn-window.mjs';
import { DEMO_SESSION_ID, DEMO_WORKSPACE, buildLiveTimeline } from './session-replay/live-timeline.mjs';
import { SyntheticRewriter, truncate } from './session-replay/synthetic-text.mjs';

const TIME_BASE = 1793476800000;
const SCENARIO_DIR = join(repoRoot, 'libs/web/landing/src/lib/live-demo/scenarios');
const STRUCTURAL_KEYS = new Set(['eventType', 'type', 'role', 'source', 'toolName', 'agentType', 'cli', 'status', 'phase',
  'terminalReason', 'model', 'stopReason', 'lastToolName', 'startedAt', 'completedAt', 'displayName', 'ptahCliName',
  'roleDelivery', 'roleChannel', 'providerId', 'scope', 'coverage', 'pricingCoverage', 'cwd', 'workingDirectory']);
const ID_KEY = /^(?:id|messageId|toolCallId|parentToolUseId|agentId|taskId|sessionId|realSessionId|tabId|cliSessionId|ptahCliId)$/;
const PLACEHOLDERS = new Set(['[sanitized tool output]', '[sanitized file content]', '[sanitized diff]', '[sanitized cli output]']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argv[i]}`);
    args[argv[i].slice(2)] = value;
    i++;
  }
  if (!args.session || !args.turn || !args.out) {
    throw new Error('Usage: --session <file.jsonl> --turn <prompt text|#n> --out <scenario.json> [see file header]');
  }
  const number = (key, fallback) => {
    const value = args[key] === undefined ? fallback : Number(args[key]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number`);
    return value;
  };
  return {
    session: resolve(args.session.replace(/^~(?=\/)/, homedir())),
    turn: args.turn,
    endRow: args['end-row'] === undefined ? undefined : number('end-row'),
    durationMs: number('duration', 75) * 1000,
    id: args.id ?? 'orchestration',
    title: args.title ?? 'PtahCode orchestration session',
    prompt: args.prompt,
    subagentSteps: number('subagent-steps', 4),
    laneSegments: number('lane-segments', 8),
    stateDir: resolve((args['state-dir'] ?? join(homedir(), '.ptah/state')).replace(/^~(?=\/)/, homedir())),
    deny: (args.deny ?? '').split(',').map((term) => term.trim()).filter(Boolean),
    out: resolve(args.out),
    chunkWords: 7,
    peerChars: 900,
  };
}

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    return ''; // No git metadata: the runtime deny list is just shorter; the privacy scans still gate the output.
  }
}

/** Real names to replace, discovered at runtime only: user, repository, org, worktrees, branches. */
function discoverDenyTerms(window, agents, lanes, facts, extra) {
  const deny = new Map();
  const set = (from, to) => { if (from && from.length >= 3 && !deny.has(from)) deny.set(from, to); };
  set(userInfo().username, 'demo-user');
  const name = git(repoRoot, 'config', 'user.name');
  if (!name && !extra.length) throw new Error('git user.name is empty: pass --deny "<real names>" so prose cannot keep them');
  set(name, 'demo-user');
  for (const part of name.split(/\s+/)) set(part, 'demo-user');
  const corpus = JSON.stringify([window.rows.map((row) => row.message), agents.map((agent) => agent.messages), lanes]);
  for (const cwd of facts.cwds) {
    const root = cwd.split('/.claude-worktrees/')[0];
    set(basename(root), 'acme-app');
    const origin = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(git(root, 'remote', 'get-url', 'origin'));
    if (origin) { set(origin[1], 'acme'); set(origin[2], 'acme-app'); }
    else if (!extra.length) throw new Error(`no git origin for ${root}: pass --deny "<org,repo>" so prose cannot keep them`);
  }
  const worktrees = [...new Set([...`${corpus}${JSON.stringify([...facts.cwds])}`.matchAll(/\.claude-worktrees\/([\w.-]+)/g)]
    .map((match) => match[1]))]
    .sort((a, b) => b.length - a.length);
  worktrees.forEach((tree, i) => {
    const synthetic = `feature-${String.fromCharCode(97 + (i % 26))}`;
    set(tree, synthetic);
    // A shortened name (`grep session-prefix`) still names the worktree.
    const parts = tree.split('-');
    for (let n = parts.length - 1; n >= 2; n--) set(parts.slice(0, n).join('-'), synthetic);
  });
  const branches = new Set([...corpus.matchAll(/(?:worktree add -b|checkout -b|switch -c)\s+([\w./-]+)/g)].map((match) => match[1]));
  for (const branch of facts.branches) if (branch && branch !== 'main' && branch !== 'HEAD') branches.add(branch);
  [...branches].forEach((branch, i) => set(branch, `feat/demo-${String.fromCharCode(97 + (i % 26))}`));
  for (const term of extra) set(term, 'acme');
  return deny;
}

/** Library and app folder names of the session's repositories: internal names for the rewrite. */
function discoverProjectNames(cwds) {
  const names = new Set();
  const dirs = (path) => (existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => entry.name) : []);
  for (const root of new Set([...cwds].map((cwd) => cwd.split('/.claude-worktrees/')[0]))) {
    for (const group of ['apps', 'libs']) {
      for (const name of dirs(join(root, group))) {
        names.add(name);
        for (const child of dirs(join(root, group, name))) names.add(child);
      }
    }
  }
  return [...names].filter((name) => name.includes('-'));
}

/** Walk every string; id fields get id rewrites, content gets the full rewrite, structural keys stay. */
function rewriteTree(value, rewriter, key = '') {
  if (typeof value === 'string') {
    if (STRUCTURAL_KEYS.has(key)) return value;
    return ID_KEY.test(key) ? rewriter.ids(value) : rewriter.text(value);
  }
  if (Array.isArray(value)) return value.map((item) => rewriteTree(item, rewriter, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewriteTree(child, rewriter, childKey)]));
  }
  return value;
}

/** Stamp replay-relative times and compact ids onto the compressed timeline. */
function finalizeTimeline(entries) {
  const messageIds = new Map();
  const mapMessage = (id) => {
    if (typeof id !== 'string') return id;
    if (!messageIds.has(id)) messageIds.set(id, `msg-${messageIds.size + 1}`);
    return messageIds.get(id);
  };
  let eventCount = 0;
  const spawnedAt = new Map();
  const agentStartAt = new Map();
  const fixEvent = (event, at) => {
    const out = { ...event, id: `demo-${++eventCount}`, timestamp: TIME_BASE + at };
    if (out.messageId !== undefined) out.messageId = mapMessage(out.messageId);
    if (out.eventType === 'agent_start') agentStartAt.set(out.toolCallId, at);
    if (out.eventType === 'agent_progress') out.durationMs = Math.max(0, at - (agentStartAt.get(out.parentToolUseId) ?? at));
    for (const key of Object.keys(out)) if (key.startsWith('__')) delete out[key];
    return out;
  };
  return entries.map(({ at, message }) => {
    const payload = { ...message.payload };
    if (message.type === 'chat:chunk') payload.event = fixEvent(payload.event, at);
    if ('timestamp' in payload) payload.timestamp = TIME_BASE + at;
    if (message.type === 'agent-monitor:spawned') {
      spawnedAt.set(payload.agentId, at);
      payload.startedAt = new Date(TIME_BASE + at).toISOString();
    }
    if (message.type === 'agent-monitor:exited') {
      payload.startedAt = new Date(TIME_BASE + (spawnedAt.get(payload.agentId) ?? at)).toISOString();
      payload.completedAt = new Date(TIME_BASE + at).toISOString();
    }
    if (message.type === 'agent-monitor:output' && payload.streamEvents) {
      payload.streamEvents = payload.streamEvents.map((event) => fixEvent(event, at));
    }
    return { at, message: { type: message.type, payload } };
  });
}

function baseRpc(sessionId) {
  const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, 'chat-tool-call.json'), 'utf8'));
  const multi = JSON.parse(readFileSync(join(SCENARIO_DIR, 'multi-agent.json'), 'utf8'));
  const rpc = { ...multi.rpc, ...fixture.rpc };
  const owners = multi.rpc['provider:getPlanLimits'].owners.slice(0, 1);
  return {
    multi,
    rpc: {
      ...rpc,
      'chat:start': { success: true, sessionId },
      'session:list': { sessions: [], total: 0, hasMore: false },
      'session:load': { sessionId, messages: [], agentSessions: [] },
      'chat:resume': { success: true, sessionId, events: [], historyPage: { olderCursor: null }, cliSessions: [] },
      'provider:getPlanLimits': { generatedAt: TIME_BASE, owners,
        sessionOwners: { [sessionId]: { ownerKey: owners[0].owner.key, modelScope: null } } },
    },
  };
}

function statsTemplate(multi) {
  const live = multi.timeline.find((entry) => entry.message.type === 'session:stats-live').message.payload;
  const result = multi.timeline.find((entry) => entry.message.type === 'session:stats').message.payload;
  return { live, result };
}

/** Put the synthetic value back wherever the sanitizer left a placeholder; collect UUID remaps on the way. */
function refill(synthetic, sanitized, uuidMap) {
  if (typeof sanitized === 'string') {
    if (PLACEHOLDERS.has(sanitized) && synthetic !== undefined) return { value: synthetic, filled: 1 };
    if (typeof synthetic === 'string') {
      const before = synthetic.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
      const after = sanitized.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
      if (before.length === after.length) before.forEach((id, i) => uuidMap.set(id.toLowerCase(), after[i]));
    }
    return { value: sanitized, filled: 0 };
  }
  if (Array.isArray(sanitized)) {
    let filled = 0;
    const value = sanitized.map((item, i) => { const r = refill(synthetic?.[i], item, uuidMap); filled += r.filled; return r.value; });
    return { value, filled };
  }
  if (sanitized && typeof sanitized === 'object') {
    let filled = 0;
    const value = {};
    for (const [key, child] of Object.entries(sanitized)) {
      const r = refill(synthetic?.[key], child, uuidMap);
      filled += r.filled;
      value[key] = r.value;
    }
    return { value, filled };
  }
  return { value: sanitized, filled: 0 };
}

function remapUuids(value, uuidMap) {
  if (typeof value === 'string') {
    return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => uuidMap.get(id.toLowerCase()) ?? id);
  }
  if (Array.isArray(value)) return value.map((item) => remapUuids(item, uuidMap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapUuids(child, uuidMap)]));
  }
  return value;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { sessionId, messages, agents, attachments, cwds, branches } = await readSession(options.session);
  const window = selectTurnWindow(messages, { turn: options.turn, endRow: options.endRow, attachments });
  const events = replayToStreamEvents(sessionId, window.rows.map((row) => row.message), agents);

  const laneNames = new Map();
  for (const { message } of window.rows) {
    const envelope = classify(message) === 'peer' ? parseLaneEnvelope(textOf(message)) : null;
    if (envelope && envelope.cli !== 'subagent') laneNames.set(envelope.agentId.toLowerCase(), envelope.agent);
  }
  const lanes = readLanes(options.stateDir, sessionId)
    .filter((lane) => window.laneIds.has(lane.agentId.toLowerCase()) && lane.status === 'completed')
    .map((lane) => ({ ...lane, displayName: laneNames.get(lane.agentId.toLowerCase()) }));

  const deny = discoverDenyTerms(window, agents, lanes, { cwds, branches }, options.deny);
  const keep = new Set([
    ...events.flatMap((event) => [event.toolName, event.agentType].filter(Boolean)),
    ...lanes.flatMap((lane) => [lane.cli, lane.displayName].filter(Boolean)),
    // Tool parameter names (`resume_session_id`, `subagent_type`) are public API, not internal names.
    ...events.flatMap((event) => (event.toolInput && typeof event.toolInput === 'object' ? Object.keys(event.toolInput) : [])),
  ]);
  const rewriter = new SyntheticRewriter({ deny, keep, internal: discoverProjectNames(cwds) });
  const { multi, rpc } = baseRpc(DEMO_SESSION_ID);
  const built = buildLiveTimeline({ events, window, agents, lanes, rewriter,
    options: { ...options, statsTemplate: statsTemplate(multi) } });
  const timeline = finalizeTimeline(built.entries);

  const promptText = options.prompt ?? rewriter.text(textOf(window.rows[0].message)).trim();
  const prompt = truncate(promptText.charAt(0).toUpperCase() + promptText.slice(1), 240);
  const synthetic = {
    id: options.id,
    title: options.title,
    timeBase: TIME_BASE,
    config: { initialView: 'chat', workspaceRoot: DEMO_WORKSPACE, workspaceName: 'acme-app' },
    rpc,
    start: { mode: 'on-send', prompt },
    timeline: rewriteTree(timeline, rewriter),
  };

  const { sanitizeScenario, scanScenarioPrivacy: scanStrict } = loadRepoModule('apps/ptah-electron/src/replay/scenario-sanitizer.ts');
  const { scanScenarioPrivacy } = loadRepoModule('libs/web/landing/src/lib/live-demo/scenario/privacy-scan.ts');
  const sanitized = sanitizeScenario(synthetic, { id: options.id, title: options.title, strict: true, timeBase: TIME_BASE });
  if (sanitized.scenario.timeline.length !== synthetic.timeline.length) {
    throw new Error('Sanitizer changed the timeline length; refusing to refill placeholders by position');
  }
  const uuidMap = new Map();
  const refilled = refill(synthetic.timeline, sanitized.scenario.timeline, uuidMap);
  const scenario = rewriteTree({
    ...sanitized.scenario,
    start: { mode: 'on-send', prompt: rewriter.text(prompt) },
    timeline: remapUuids(refilled.value, uuidMap),
  }, rewriter);
  // The structural parts of the sanitized scenario (rpc, config) are kept as the sanitizer produced them.
  scenario.rpc = sanitized.scenario.rpc;
  scenario.config = sanitized.scenario.config;

  const findings = [...scanScenarioPrivacy(scenario), ...scanStrict(scenario)];
  if (findings.length) {
    const at = (path) => path.replace(/ \(key\)$/, '').split(/\.|\[|\]/).filter(Boolean).slice(1)
      .reduce((node, key) => node?.[key], scenario);
    // Local diagnostics only: the rejected text never reaches the output file.
    for (const finding of findings.slice(0, 20)) console.error(finding.kind, finding.path, JSON.stringify(String(at(finding.path)).slice(0, 300)));
    throw new Error(`Privacy scan found ${findings.length} item(s); scenario not written`);
  }
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(scenario, null, 2)}\n`);

  const count = (type, eventType) => scenario.timeline.filter((entry) => entry.message.type === type
    && (!eventType || entry.message.payload.event?.eventType === eventType)).length;
  const peers = scenario.timeline.filter((entry) => entry.message.payload?.event?.eventType === 'message_start'
    && entry.message.payload.event.inboundPeer).length;
  console.log(JSON.stringify({
    out: options.out,
    window: { firstRow: window.start, lastRow: window.end, excludedRows: window.excluded.length, rows: window.rows.length },
    durationMs: scenario.timeline.at(-1).at,
    events: scenario.timeline.length,
    subagents: count('chat:chunk', 'agent_start'),
    subagentCompletions: count('chat:chunk', 'agent_completed'),
    lanes: count('agent-monitor:spawned'),
    laneOutputs: count('agent-monitor:output'),
    laneEnvelopes: peers,
    toolCalls: count('chat:chunk', 'tool_start'),
    sanitizer: { ...sanitized.report, redactedFields: sanitized.report.redactedFields.length, refilledPlaceholders: refilled.filled },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
