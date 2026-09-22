#!/usr/bin/env node
/**
 * Agent usage report — token cost across the CLI vendors that keep local logs.
 *
 * Reads, per vendor:
 * - codex:  `~/.codex/sessions/**\/*.jsonl` (rollout files, including the ones
 *   the Ptah spawn lane starts through `@openai/codex-sdk`). Each `token_count`
 *   event carries the per-request input size and the account's
 *   `rate_limits.primary.used_percent`, so the codex section can also attribute
 *   weekly-limit drain to originator, model, reasoning effort and directory.
 * - claude: `~/.claude/projects/**\/*.jsonl` (Claude Code session transcripts,
 *   including the `subagents/` files). One assistant message carrying
 *   `message.usage` is one API request; its context is
 *   `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
 *
 * Both vendors resend the entire thread on every tool call, so the number that
 * matters is requests × context — which is why this report leads with requests
 * and average context rather than with a total.
 *
 * Usage: node scripts/agent-usage-report.mjs [days=7] [top=15]
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const days = Number(process.argv[2] ?? 7);
const topN = Number(process.argv[3] ?? 15);
const since = Date.now() - days * 864e5;

/** Every `*.jsonl` under `root` touched inside the window. Missing root = none. */
function collectLogs(root) {
  if (!existsSync(root)) return [];
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue; // A session file can vanish mid-walk; it is not an error.
      }
      if (s.isDirectory()) walk(p);
      else if (entry.endsWith('.jsonl') && s.mtimeMs > since) files.push(p);
    }
  })(root);
  return files;
}

function* jsonLines(file) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      continue;
    }
  }
}

const mtok = (n) => (n / 1e6).toFixed(1) + 'M';
const pct = (part, whole) => Math.round((100 * part) / Math.max(1, whole));

// ---------------------------------------------------------------------------
// codex
// ---------------------------------------------------------------------------

function readCodex() {
  const root = join(
    process.env.CODEX_HOME ?? join(homedir(), '.codex'),
    'sessions',
  );
  const rows = [];
  const toolCalls = {};
  const toolOutputBytes = {};
  let requests = 0;
  let contextSum = 0;
  let requestsOver200k = 0;
  let compactions = 0;

  for (const file of collectLogs(root)) {
    let meta = {};
    let model = '';
    let effort = '';
    let last = null;
    let firstInput = 0;
    let turns = 0;
    let sessionRequests = 0;
    let pctStart = null;
    let pctEnd = null;
    const pendingCalls = {};

    for (const record of jsonLines(file)) {
      const p = record.payload ?? {};
      if (record.type === 'session_meta') meta = p;
      if (record.type === 'turn_context') {
        model = p.model || model;
        effort = p.effort || effort;
        turns++;
      }
      if (record.type === 'compacted') compactions++;
      if (record.type === 'event_msg' && p.type === 'token_count' && p.info) {
        last = p.info.total_token_usage;
        const ctx = p.info.last_token_usage?.input_tokens ?? 0;
        if (ctx) {
          if (!firstInput) firstInput = ctx;
          requests++;
          sessionRequests++;
          contextSum += ctx;
          if (ctx > 200_000) requestsOver200k++;
        }
        const used = p.rate_limits?.primary?.used_percent;
        if (used != null) {
          if (pctStart == null) pctStart = used;
          pctEnd = used;
        }
      }
      if (
        record.type === 'response_item' &&
        (p.type === 'function_call' || p.type === 'custom_tool_call')
      ) {
        const name = p.name ?? '?';
        toolCalls[name] = (toolCalls[name] ?? 0) + 1;
        pendingCalls[p.call_id] = name;
      }
      if (
        record.type === 'response_item' &&
        (p.type === 'function_call_output' ||
          p.type === 'custom_tool_call_output')
      ) {
        const name = pendingCalls[p.call_id] ?? '?';
        const out =
          typeof p.output === 'string'
            ? p.output
            : JSON.stringify(p.output ?? '');
        toolOutputBytes[name] = (toolOutputBytes[name] ?? 0) + out.length;
      }
    }
    if (!last) continue;
    rows.push({
      id: file.split(/[\\/]/).pop().slice(8, 27),
      originator: meta.originator ?? '?',
      cwd: (meta.cwd ?? '').split(/[\\/]/).pop(),
      model,
      effort,
      turns,
      requests: sessionRequests,
      firstInput,
      input: last.input_tokens,
      cached: last.cached_input_tokens,
      output: last.output_tokens,
      reasoning: last.reasoning_output_tokens,
      total: last.total_tokens,
      // Negative when the weekly window reset during the session.
      pctDelta: pctStart == null ? null : +(pctEnd - pctStart).toFixed(1),
    });
  }

  rows.sort((a, b) => b.total - a.total);
  return {
    rows,
    requests,
    contextSum,
    requestsOver200k,
    compactions,
    toolCalls,
    toolOutputBytes,
  };
}

// ---------------------------------------------------------------------------
// claude
// ---------------------------------------------------------------------------

function readClaude() {
  const root = join(
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    'projects',
  );
  const rows = [];
  let requests = 0;
  let contextSum = 0;
  let requestsOver200k = 0;

  for (const file of collectLogs(root)) {
    let model = '';
    let cwd = '';
    let sessionRequests = 0;
    let firstInput = 0;
    let input = 0;
    let cached = 0;
    let output = 0;

    for (const record of jsonLines(file)) {
      if (record.cwd && !cwd) cwd = record.cwd;
      if (record.type !== 'assistant') continue;
      const usage = record.message?.usage;
      if (!usage) continue;
      model = record.message.model || model;

      // What the request actually cost to send: fresh input plus everything
      // read from, or written to, the prompt cache.
      const read = usage.cache_read_input_tokens ?? 0;
      const created = usage.cache_creation_input_tokens ?? 0;
      const ctx = (usage.input_tokens ?? 0) + read + created;

      requests++;
      sessionRequests++;
      contextSum += ctx;
      if (ctx > 200_000) requestsOver200k++;
      if (!firstInput) firstInput = ctx;
      input += ctx;
      cached += read;
      output += usage.output_tokens ?? 0;
    }

    if (!sessionRequests) continue;
    const name = file.split(/[\\/]/);
    rows.push({
      // Subagent transcripts sit under `<session>/subagents/`; keep the leaf so
      // a lane is distinguishable from the session that spawned it.
      id: name[name.length - 1].replace(/\.jsonl$/, '').slice(0, 19),
      originator: name.includes('subagents') ? 'subagent' : 'session',
      cwd: (cwd || name[name.length - 2] || '').split(/[\\/]/).pop(),
      model,
      effort: '',
      turns: 0,
      requests: sessionRequests,
      firstInput,
      input,
      cached,
      output,
      reasoning: 0,
      total: input + output,
      pctDelta: null,
    });
  }

  rows.sort((a, b) => b.total - a.total);
  return { rows, requests, contextSum, requestsOver200k, compactions: null };
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

function aggregate(rows, key) {
  const map = {};
  for (const r of rows) {
    const k = r[key] || '?';
    map[k] ??= { n: 0, input: 0, cached: 0, output: 0, reasoning: 0, pct: 0 };
    const a = map[k];
    a.n++;
    a.input += r.input;
    a.cached += r.cached;
    a.output += r.output;
    a.reasoning += r.reasoning;
    a.pct += Math.max(0, r.pctDelta ?? 0);
  }
  return Object.entries(map).sort((a, b) => b[1].input - a[1].input);
}

function printAgg(rows, title, key) {
  console.log(`\n-- by ${title}`);
  for (const [k, v] of aggregate(rows, key)) {
    console.log(
      `${k.padEnd(40).slice(0, 40)} n=${String(v.n).padStart(4)} input=${mtok(v.input).padStart(8)} cached=${String(pct(v.cached, v.input)).padStart(3)}% output=${mtok(v.output).padStart(6)} reasoning=${mtok(v.reasoning).padStart(6)} limit%=${v.pct.toFixed(0).padStart(4)}`,
    );
  }
}

function printHeadline(vendor, stats) {
  const { rows, requests, contextSum, requestsOver200k, compactions } = stats;
  const input = rows.reduce((s, r) => s + r.input, 0);
  const cached = rows.reduce((s, r) => s + r.cached, 0);
  const output = rows.reduce((s, r) => s + r.output, 0);

  console.log(`\n=== ${vendor}`);
  if (!rows.length) {
    console.log('no sessions in window (no local logs found)');
    return;
  }
  console.log(
    `sessions=${rows.length}  requests=${requests}  avg/session=${(requests / rows.length).toFixed(0)}`,
  );
  console.log(
    `avg context/request=${Math.round(contextSum / Math.max(1, requests) / 1e3)}k  over 200k=${requestsOver200k}` +
      (compactions == null ? '' : `  compactions=${compactions}`),
  );
  console.log(
    `total input=${mtok(input)}  cached=${pct(cached, input)}%  output=${mtok(output)}`,
  );
}

function printTopSessions(vendor, rows) {
  console.log(`\n-- top ${topN} sessions by tokens (${vendor})`);
  for (const r of rows.slice(0, topN)) {
    console.log(
      `${r.id.padEnd(19)} ${r.originator.padEnd(13)} ${r.model.padEnd(16).slice(0, 16)} ${(r.cwd ?? '').padEnd(22).slice(0, 22)} requests=${String(r.requests).padStart(4)} first=${String(r.firstInput).padStart(6)} input=${mtok(r.input).padStart(7)} cached=${String(pct(r.cached, r.input)).padStart(3)}% output=${String(Math.round(r.output / 1e3)).padStart(4)}k`,
    );
  }
}

const codex = readCodex();
const claude = readClaude();

console.log(`Agent usage over the last ${days} days`);
console.log(
  `Every tool call resends the thread: cost tracks requests x context, not session count.`,
);

printHeadline('codex', codex);
if (codex.rows.length) {
  printAgg(codex.rows, 'originator', 'originator');
  printAgg(codex.rows, 'model', 'model');
  printAgg(codex.rows, 'reasoning effort', 'effort');
  printAgg(codex.rows, 'working directory', 'cwd');

  console.log('\n-- tool calls');
  for (const [k, v] of Object.entries(codex.toolCalls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)) {
    console.log(
      `${String(v).padStart(6)} ${k}  output=${((codex.toolOutputBytes[k] ?? 0) / 1e6).toFixed(1)}MB`,
    );
  }
  printTopSessions('codex', codex.rows);
}

printHeadline('claude', claude);
if (claude.rows.length) {
  printAgg(claude.rows, 'lane kind', 'originator');
  printAgg(claude.rows, 'model', 'model');
  printAgg(claude.rows, 'working directory', 'cwd');
  printTopSessions('claude', claude.rows);
}
