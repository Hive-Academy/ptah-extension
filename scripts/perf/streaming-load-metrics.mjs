#!/usr/bin/env node
/**
 * Streaming-load metrics collector for the Electron main-loop freeze evaluation.
 *
 * Reads the Ptah Electron daily log(s) and ptah-hang.log for a time window and
 * prints JSON (and optionally a markdown report). Plain Node, no dependencies.
 *
 * Examples:
 *   # Whole of one log day (prod profile), JSON + markdown:
 *   node scripts/perf/streaming-load-metrics.mjs --date 2026-11-05 --md out.md --json out.json
 *   # Dev profile ("Ptah Dev"), a 15 min window starting at an ISO time:
 *   node scripts/perf/streaming-load-metrics.mjs --dev --from 2026-11-06T02:20:00Z --duration 15m
 *   # Last 15 minutes of the newest log, checked against thresholds (exit 1 on FAIL):
 *   node scripts/perf/streaming-load-metrics.mjs --last 15m --check
 *   # Worst non-overlapping 15 min bucket of a day:
 *   node scripts/perf/streaming-load-metrics.mjs --date 2026-11-05 --rolling 15m
 *   # Explicit files (eg. a profile used by the live harness):
 *   node scripts/perf/streaming-load-metrics.mjs --log "<electron log>" --hang-log "<ptah-hang.log>" --from ... --to ...
 *   # Compare two JSON outputs:
 *   node scripts/perf/streaming-load-metrics.mjs --compare baseline.json current.json
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('./streaming-load-metrics-lib.cjs');
const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { logs: [], hangLogs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--log': args.logs.push(resolve(next())); break;
      case '--hang-log': args.hangLogs.push(resolve(next())); break;
      case '--logs-dir': args.logsDir = resolve(next()); break;
      case '--dev': args.dev = true; break;
      case '--date': args.date = next(); break;
      case '--from': args.from = next(); break;
      case '--to': args.to = next(); break;
      case '--duration': args.duration = next(); break;
      case '--last': args.last = next(); break;
      case '--rolling': args.rolling = next(); break;
      case '--storm': args.storm = Number(next()); break;
      case '--json': args.json = resolve(next()); break;
      case '--md': args.md = resolve(next()); break;
      case '--title': args.title = next(); break;
      case '--thresholds': args.thresholds = resolve(next()); break;
      case '--check': args.check = true; break;
      case '--compare': args.compare = [resolve(next()), resolve(next())]; break;
      case '--help': case '-h': args.help = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function parseDuration(text) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text);
  if (!m) throw new Error(`Bad duration "${text}" (use 30s, 15m, 2h)`);
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
  return Number(m[1]) * unit;
}

function defaultLogsDir(dev) {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  return join(appData, dev ? 'Ptah Dev' : 'ptah', 'logs');
}

const DAY = 86400000;

function resolveInputs(args, fromMs, toMs) {
  const dir = args.logsDir ?? defaultLogsDir(args.dev);
  let logs = args.logs;
  let hangLogs = args.hangLogs;
  if (logs.length === 0 && existsSync(dir)) {
    const names = readdirSync(dir)
      .map((n) => /^Ptah Electron-(\d{4}-\d{2}-\d{2})\.log$/.exec(n))
      .filter(Boolean)
      .map((m) => ({ file: join(dir, m[0]), day: Date.parse(`${m[1]}T00:00:00Z`) }))
      .sort((a, b) => a.day - b.day);
    if (names.length === 0) throw new Error(`No Ptah Electron-*.log in ${dir}`);
    // Log files roll on LOCAL midnight, so a UTC window can sit in the neighbouring file.
    logs = names
      .filter((n) => n.day + DAY + 14 * 3600000 >= fromMs && n.day - 14 * 3600000 <= toMs)
      .map((n) => n.file);
    if (!Number.isFinite(fromMs) && !Number.isFinite(toMs)) {
      logs = [names[names.length - 1].file];
    }
  }
  if (hangLogs.length === 0) {
    // With explicit --log files the hang log is the one beside them, never the default profile's.
    const hangDir = args.logs.length > 0 ? dirname(args.logs[0]) : dir;
    const f = join(hangDir, 'ptah-hang.log');
    if (existsSync(f)) hangLogs = [f];
  }
  return { logs, hangLogs };
}

function resolveWindow(args) {
  let fromMs = -Infinity;
  let toMs = Infinity;
  if (args.date) {
    // A "date" is a LOCAL calendar day (log files roll on local midnight).
    const [y, mo, d] = args.date.split('-').map(Number);
    fromMs = new Date(y, mo - 1, d).getTime();
    toMs = new Date(y, mo - 1, d + 1).getTime() - 1;
  }
  if (args.from) fromMs = Date.parse(args.from);
  if (args.to) toMs = Date.parse(args.to);
  if (args.duration) {
    if (!Number.isFinite(fromMs)) throw new Error('--duration needs --from');
    toMs = fromMs + parseDuration(args.duration);
  }
  if (args.last) {
    toMs = Number.isFinite(toMs) ? toMs : Date.now();
    fromMs = toMs - parseDuration(args.last);
  }
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw new Error('Bad --from/--to');
  return { fromMs, toMs };
}

function compare(a, b) {
  const fa = lib.flatten(a);
  const fb = lib.flatten(b);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  const rows = ['| Metric | Baseline | Current | Delta |', '| --- | --- | --- | --- |'];
  for (const k of keys) {
    const x = fa[k] ?? 0;
    const y = fb[k] ?? 0;
    if (x === 0 && y === 0) continue;
    const d = Math.round((y - x) * 10) / 10;
    rows.push(`| ${k} | ${x} | ${y} | ${d > 0 ? '+' : ''}${d} |`);
  }
  return rows.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return 0;
  }
  if (args.compare) {
    const [a, b] = args.compare.map((f) => JSON.parse(readFileSync(f, 'utf8')));
    console.log(compare(a.summary ?? a, b.summary ?? b));
    return 0;
  }

  const { fromMs, toMs } = resolveWindow(args);
  const { logs, hangLogs } = resolveInputs(args, fromMs, toMs);
  if (logs.length === 0 && hangLogs.length === 0) {
    throw new Error('No input logs found (use --log / --hang-log / --logs-dir).');
  }
  const collector = lib.createCollector();
  for (const f of logs) await lib.readLogFile(f, (l) => lib.addElectronLine(collector, l));
  for (const f of hangLogs) await lib.readLogFile(f, (l) => lib.addHangLine(collector, l));

  const options = { stormLinesPerMin: args.storm };
  const window = { fromMs, toMs };
  const summary = lib.summarize(collector, window, options);

  let rolling = null;
  let worstBucket = null;
  let bucketEnvelope = null;
  if (args.rolling) {
    const step = parseDuration(args.rolling);
    let first = Infinity;
    let last = 0;
    for (const e of collector.events) {
      if (e.ts < first) first = e.ts;
      if (e.ts > last) last = e.ts;
    }
    if (first === Infinity) first = 0;
    const start = Math.max(Number.isFinite(fromMs) ? fromMs : first, first);
    const end = Math.min(Number.isFinite(toMs) ? toMs : last, last);
    const buckets = [];
    for (let t = start; t <= end; t += step) {
      const s = lib.summarize(collector, { fromMs: t, toMs: t + step - 1 }, options);
      buckets.push({
        from: new Date(t).toISOString(),
        hangEvents: s.watchdog.hangEvents,
        blockedMs: s.watchdog.totalBlockedMs,
        lagOver1s: s.eventLoop.over1s,
        lagMaxMs: s.eventLoop.maxMs,
        lagWarnings: s.eventLoop.warnings,
        rpcTimeouts: s.rpcTimeouts.total,
        gitGateEvents: s.gitGate.saturatedEvents,
        summary: s,
      });
    }
    buckets.sort(
      (x, y) => y.blockedMs - x.blockedMs || y.lagOver1s - x.lagOver1s || y.lagWarnings - x.lagWarnings,
    );
    rolling = {
      bucket: args.rolling,
      buckets: buckets.length,
      worst: buckets.slice(0, 5).map(({ summary: _s, ...rest }) => rest),
    };
    worstBucket = buckets.length ? buckets[0] : null;
    bucketEnvelope = lib.envelope(buckets.map((b) => b.summary));
  }

  const thresholdFile = args.thresholds ?? join(here, 'streaming-load-thresholds.json');
  const thresholds = args.check || args.thresholds
    ? JSON.parse(readFileSync(thresholdFile, 'utf8'))
    : null;
  // With --rolling the verdict uses each metric's worst value over all buckets: a freeze in any window fails.
  const results = thresholds
    ? bucketEnvelope
      ? lib.evaluateFlat(bucketEnvelope, thresholds)
      : lib.evaluateThresholds(summary, thresholds)
    : null;

  const output = {
    generatedAt: new Date().toISOString(),
    inputs: { logs, hangLogs },
    summary,
    ...(rolling ? { rolling, worstBucketSummary: worstBucket ? worstBucket.summary : null } : {}),
    ...(results ? { thresholdResults: results } : {}),
  };
  if (args.json) writeFileSync(args.json, JSON.stringify(output, null, 2));
  const md = lib.toMarkdown(summary, worstBucket ? null : results, args.title) +
    (worstBucket ? '\n\n' + lib.toMarkdown(worstBucket.summary, results, `Worst ${args.rolling} bucket (${worstBucket.from})`) : '');
  const rollingMd = rolling
    ? `\n\n### Worst ${rolling.bucket} buckets (of ${rolling.buckets})\n\n| Bucket start (UTC) | Hangs | Blocked ms | Lag > 1 s | Lag max ms | Lag warnings | RPC timeouts | Git gate events |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n` +
      rolling.worst.map((w) => `| ${w.from} | ${w.hangEvents} | ${w.blockedMs} | ${w.lagOver1s} | ${w.lagMaxMs} | ${w.lagWarnings} | ${w.rpcTimeouts} | ${w.gitGateEvents} |`).join('\n')
    : '';
  if (args.md) writeFileSync(args.md, md + rollingMd + '\n');
  if (!args.json && !args.md) console.log(md + rollingMd);
  else console.log(`wrote ${[args.json, args.md].filter(Boolean).join(' and ')}`);
  return results && results.some((r) => !r.pass) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
