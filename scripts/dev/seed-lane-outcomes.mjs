/**
 * Seed a disposable lane-outcome database with the production migrations.
 * Usage: node scripts/dev/seed-lane-outcomes.mjs --db /tmp/ptah-lanes.sqlite [--seed 7] [--profile skewed] [--rows 2]
 * Existing databases require this script's seed_meta marker. Never use a Ptah profile database.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

export function safeDbPath(input) {
  const path = resolve(input);
  const home = realpathSync(process.env.HOME);
  const profile = join(home, '.ptah');
  const realProfile = existsSync(profile) ? realpathSync(profile) : profile;
  const real = existsSync(path)
    ? realpathSync(path)
    : join(realpathSync(dirname(path)), path.split('/').at(-1));
  for (const protectedPath of [profile, realProfile]) {
    const rel = relative(protectedPath, real);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      throw new Error(`Refusing Ptah profile path: ${path}`);
    }
  }
  return path;
}

export function loadSource() {
  require('reflect-metadata');
  const { createJiti } = require('jiti');
  const config = require(join(root, 'tsconfig.base.json'));
  const alias = Object.fromEntries(Object.entries(config.compilerOptions.paths)
    .filter(([, paths]) => paths.length === 1)
    .map(([key, paths]) => [key, resolve(root, paths[0])]));
  alias['@ptah-extension/vscode-core'] = join(root, 'libs/backend/vscode-core/src/di/tokens.ts');
  alias['@ptah-extension/shared'] = join(root, 'libs/shared/src/index.ts');
  const jiti = createJiti(import.meta.url, { alias });
  return {
    persistence: { ...jiti(join(root, 'libs/backend/persistence-sqlite/src/lib/migration-runner.ts')), ...jiti(join(root, 'libs/backend/persistence-sqlite/src/lib/migrations/index.ts')) },
    shared: jiti(join(root, 'libs/shared/src/lib/types/lane-outcome.types.ts')),
    routing: (path) => jiti(join(root, 'libs/backend/lane-routing/src/lib', path)),
    outcomes: (path) => jiti(join(root, 'libs/backend/lane-outcomes/src/lib', path)),
  };
}

function options(argv) {
  const out = { seed: 7, lanes: 'codex,grok,antigravity', rows: 1, profile: 'skewed' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help') { out.help = true; continue; }
    if (!['--db', '--seed', '--lanes', '--rows', '--profile'].includes(flag) || !argv[i + 1]) throw new Error(`Invalid argument: ${flag}`);
    out[flag.slice(2)] = argv[++i];
  }
  if (out.help) return out;
  if (!out.db) throw new Error('--db is required');
  for (const key of ['seed', 'rows']) {
    out[key] = Number(out[key]);
    if (!Number.isSafeInteger(out[key]) || (key === 'rows' && out[key] < 1)) throw new Error(`--${key} must be an integer${key === 'rows' ? ' >= 1' : ''}`);
  }
  if (!['uniform', 'skewed'].includes(out.profile)) throw new Error('--profile must be uniform or skewed');
  out.lanes = [...new Set(out.lanes.split(',').map((s) => s.trim()))];
  if (out.lanes.some((s) => !s || s === 'subagent' || s.includes('/'))) throw new Error('Invalid --lanes list');
  return out;
}

const usage = 'Usage: node scripts/dev/seed-lane-outcomes.mjs --db <path> [--seed <int>] [--lanes <csv>] [--rows <n>] [--profile <uniform|skewed>] [--help]';

async function main() {
  let args;
  try { args = options(process.argv.slice(2)); }
  catch (error) { console.error(error.message, '\n', usage); process.exitCode = 2; return; }
  if (args.help) { console.log(usage); return; }
  const path = safeDbPath(args.db);
  const Database = require('better-sqlite3');
  const existed = existsSync(path);
  if (existed) {
    const probe = new Database(path, { readonly: true, fileMustExist: true });
    try {
      if (!probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='seed_meta'").get()) throw new Error('Existing database lacks seed_meta marker');
    } finally { probe.close(); }
  }
  const db = new Database(path, { fileMustExist: existed });
  try {
    const { persistence, shared } = loadSource();
    const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
    await new persistence.SqliteMigrationRunner(db, logger, undefined, safeDbPath(`${path}.archives`)).applyAll(persistence.MIGRATIONS, { vecExtensionLoaded: false });
    db.exec('CREATE TABLE IF NOT EXISTS seed_meta (seed INTEGER NOT NULL, generated_at INTEGER NOT NULL)');
    const columns = new Set(db.pragma('table_info(lane_outcome_records)').map((c) => c.name));
    const required = ['run_id', 'executor_kind', 'lane_id', 'agent_id', 'model', 'task_kind', 'verdict', 'ended_at', 'created_at', 'updated_at', 'deliverables_declared_at'];
    if (required.some((name) => !columns.has(name))) throw new Error('Migrated outcome schema lacks required columns');
    let randomState = args.seed >>> 0;
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
    const now = Math.floor(Date.now() / 86400000) * 86400000;
    const rows = [];
    const add = (lane, taskKind, verdict, index, old = false) => {
      const endedAt = now - (old ? 95 : 1 + Math.floor(random() * 80)) * 86400000;
      rows.push({ run_id: `seed-${args.seed}-${lane}-${taskKind}-${verdict}-${index}${old ? '-old' : ''}`, executor_kind: lane === 'subagent' ? 'subagent' : 'cli', lane_id: lane, agent_id: lane, family: lane === 'codex' ? 'openai' : lane, model: 'seed-model', role: lane === 'subagent' ? 'backend-developer' : null, task_kind: taskKind, task_kind_source: 'explicit', verdict, ended_at: endedAt, started_at: endedAt - 30000, duration_ms: 30000, deliverables_declared_at: verdict === 'delivered' || (lane === 'subagent' && verdict === 'no-deliverable') ? endedAt : null, created_at: endedAt, updated_at: endedAt });
    };
    for (const [laneIndex, lane] of args.lanes.entries()) for (const taskKind of shared.OUTCOME_TASK_KINDS) {
      if (args.profile === 'uniform') {
        for (const verdict of ['delivered', 'failed', 'no-deliverable', 'unverified']) for (let n = 0; n < args.rows; n++) add(lane, taskKind, verdict, n);
      } else {
        const deliveries = [18, 10, 3][Math.min(laneIndex, 2)] * args.rows;
        for (let n = 0; n < 20 * args.rows; n++) add(lane, taskKind, n < deliveries ? 'delivered' : n % 2 ? 'failed' : 'no-deliverable', n);
        add(lane, taskKind, 'unverified', 0);
      }
    }
    for (const verdict of ['delivered', 'no-deliverable', 'unverified']) add('subagent', 'implement', verdict, 0);
    for (const lane of args.lanes) add(lane, 'implement', 'delivered', 0, true);
    const names = Object.keys(rows[0]).filter((name) => columns.has(name));
    const insert = db.prepare(`INSERT INTO lane_outcome_records (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`);
    db.transaction(() => {
      db.prepare('DELETE FROM lane_outcome_records').run();
      db.prepare('DELETE FROM seed_meta').run();
      db.prepare('INSERT INTO seed_meta (seed, generated_at) VALUES (?, ?)').run(args.seed, now);
      for (const row of rows) insert.run(...names.map((name) => row[name] ?? null));
    })();
    console.log(`db=${path} seed=${args.seed} profile=${args.profile} rows=${rows.length}`);
    console.table(db.prepare(`SELECT lane_id AS lane, task_kind AS taskKind, CASE WHEN verdict = 'no-deliverable' THEN 'failed' ELSE verdict END AS verdict, COUNT(*) AS count FROM lane_outcome_records WHERE ended_at >= ? GROUP BY lane_id, task_kind, CASE WHEN verdict = 'no-deliverable' THEN 'failed' ELSE verdict END ORDER BY lane_id, task_kind, verdict`).all(now - 90 * 86400000));
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = /Refusing Ptah profile path|Existing database lacks seed_meta marker/.test(error.message) ? 2 : 1; });
