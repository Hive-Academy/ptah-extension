/**
 * Inspect a disposable seeded DB; add --live to POST to System One.
 * Prerequisite: ptah-chappie-ollama.service tunnel (warm ≈3.4 s, cold ≈17 s).
 * node scripts/dev/seed-lane-outcomes.mjs --db /tmp/ptah-lanes.sqlite --seed 7
 * node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-lanes.sqlite --lane-ids codex,grok --task-kind implement [--live] [--ab]
 * Add --live --ab to compare with/without pastOutcomes using equal lane scores.
 * Optional Electron check: restart Ptah, confirm one '[lane-routing] route decided'
 * INFO line with timeoutMs in ~/.config/Ptah/logs/Ptah Electron-YYYY-MM-DD.log;
 * run one subagent and inspect its row with a read-only SQLite query.
 */
import { createRequire } from 'node:module';
import { safeDbPath, loadSource } from './seed-lane-outcomes.mjs';

const require = createRequire(import.meta.url);
const usage = 'Usage: node scripts/dev/check-past-outcomes-live.mjs --db <seeded path> [--lane-ids <csv>] [--task-kind <kind>] [--live] [--ab] [--base-url <url>] [--model <model>]';

function parse(argv) {
  const out = { 'lane-ids': 'codex,grok,antigravity', 'task-kind': 'implement', 'base-url': 'http://127.0.0.1:11435', model: 'd3:4b', live: false, ab: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help') { out.help = true; continue; }
    if (flag === '--live' || flag === '--ab') { out[flag.slice(2)] = true; continue; }
    if (!['--db', '--lane-ids', '--task-kind', '--base-url', '--model'].includes(flag) || !argv[i + 1]) throw new Error(`Invalid argument: ${flag}`);
    out[flag.slice(2)] = argv[++i];
  }
  if (!out.help && !out.db) throw new Error('--db is required');
  if (out.ab && !out.live) throw new Error('--ab requires --live');
  out.lanes = [...new Set(out['lane-ids'].split(',').map((s) => s.trim()))];
  if (out.lanes.some((s) => !s || s === 'subagent' || s.includes('/'))) throw new Error('Invalid lane ids');
  return out;
}

async function main() {
  let args;
  try { args = parse(process.argv.slice(2)); }
  catch (error) { console.error(error.message, '\n', usage); process.exitCode = 2; return; }
  if (args.help) { console.log(usage); return; }
  const path = safeDbPath(args.db);
  const Database = require('better-sqlite3');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='seed_meta'").get()) throw new Error('Database is not seeded by the harness');
    const { shared, routing, outcomes } = loadSource();
    if (!shared.OUTCOME_TASK_KINDS.includes(args['task-kind'])) throw new Error('Invalid task kind');
    const logger = { debug: () => undefined, info: () => undefined, warn(message, fields) { console.warn(message, fields); }, error: () => undefined };
    // Production LaneOutcomeReader over SqliteLaneOutcomeStore; the connection adapter exposes its open read-only DB.
    const reader = new (outcomes('lane-outcome-reader.service.ts').LaneOutcomeReader)(new (outcomes('store/sqlite-lane-outcome.store.ts').SqliteLaneOutcomeStore)({ db }, logger), logger);
    const sinceMs = Date.now() - 90 * 86400000;
    const summaries = (await Promise.all(args.lanes.map((lane) => reader.recentOutcomes(lane, { sinceMs })))).flat();
    const lookup = routing('matrix/outcome-figures.ts').outcomeFiguresFrom(summaries);
    const ranked = args.lanes.map((lane) => ({
      candidate: { kind: 'lane', id: lane, family: lane === 'codex' ? 'openai' : lane, limitState: 'unknown' },
      scored: { model: 'seed-model', score: 80 },
    }));
    const phase = routing('pipeline/phase-plan.ts').laneQuestion({ phaseId: args['task-kind'], kind: args['task-kind'], taskKind: args['task-kind'], ranked });
    let payload;
    const caller = { async decide(value) {
      payload = value;
      return { ok: false, cause: 'provider-error', notFound: false, detail: 'capture only' };
    } };
    const outcome = await routing('pipeline/model-refine.ts').runLaneRequest({
      provider: 'ollama', request: `Gate check for ${args['task-kind']}`,
      phases: [phase], outcomes: lookup, maxRequestBytes: 100_000,
      dispatch: { kind: 'system-one', caller, model: args.model }, logger,
    });
    if (!outcome.sent || !payload) throw new Error('Production lane payload builder did not send a request');
    const past = payload.state.pastOutcomes;
    const offered = new Set(args.lanes.map((lane) => `${lane}/${args['task-kind']}`));
    const keys = Object.keys(past);
    if (!keys.length || keys.some((key) => !offered.has(key) || key.startsWith('subagent/'))) throw new Error('pastOutcomes keys do not match offered lanes');
    const recent = db.prepare('SELECT lane_id, task_kind, verdict, COUNT(*) AS n FROM lane_outcome_records WHERE ended_at >= ? AND lane_id != ? GROUP BY lane_id, task_kind, verdict').all(sinceMs, 'subagent');
    for (const key of keys) {
      const [lane, kind] = key.split('/');
      const rows = recent.filter((row) => row.lane_id === lane && row.task_kind === kind);
      const delivered = rows.filter((row) => row.verdict === 'delivered').reduce((sum, row) => sum + row.n, 0);
      const failed = rows.filter((row) => ['failed', 'no-deliverable'].includes(row.verdict)).reduce((sum, row) => sum + row.n, 0);
      if (past[key].delivered !== delivered || past[key].failed !== failed) throw new Error(`Window/count mismatch for ${key}`);
    }
    const body = { model: args.model, ...payload };
    const { SystemOneRequestBodySchema, SystemOneResultSchema } = routing('decision-model/system-one.schema.ts');
    SystemOneRequestBodySchema.parse(body);
    console.log(`pastOutcomes keys=${keys.join(', ')} counts=${JSON.stringify(past)}`);
    console.log(JSON.stringify(body, null, 2));
    if (!args.live) return;
    const { CONFIDENCE_THRESHOLD } = routing('routing-constants.ts');
    async function send(label, requestBody) {
      const started = performance.now();
      const response = await fetch(new URL('/v1/systemone', args['base-url']), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`System One ${label} HTTP ${response.status}`);
      const result = SystemOneResultSchema.parse(await response.json());
      const answer = result.answers[args['task-kind']];
      if (!answer) throw new Error(`System One ${label} omitted ${args['task-kind']} answer`);
      return { label, choice: answer.choice, probabilities: answer.probabilities ?? null, confidence: answer.confidence ?? null, clearsThreshold: answer.confidence == null ? null : answer.confidence >= CONFIDENCE_THRESHOLD, latencyMs: Math.round(performance.now() - started) };
    }
    const withOutcomes = await send('with pastOutcomes', body);
    if (args.ab) {
      const without = { ...body, state: { ...body.state, pastOutcomes: {} } };
      SystemOneRequestBodySchema.parse(without);
      const withoutOutcomes = await send('without pastOutcomes', without);
      console.table([withOutcomes, withoutOutcomes]);
    } else console.table([withOutcomes]);
  } finally { db.close(); }
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
