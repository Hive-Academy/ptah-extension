'use strict';

/**
 * Pure parsing and summarising for the streaming-load performance evaluation.
 *
 * Reads the two log families the Electron main process writes and turns them
 * into one metrics object. No I/O except `readLogFile` (streaming line reader).
 * CommonJS so both the `.mjs` CLI and the Jest spec under `scripts/` can load it.
 *
 * Log shapes (all verified against real logs from 2026-11-05/06):
 *   - Electron log line:
 *       [2026-11-05T22:32:21.534Z] [WARN ] 2026-11-05T22:32:21.534Z - <message>
 *     Lines that do not start with `[` + ISO time are continuation lines
 *     (`  Context: {...}`) and are ignored.
 *   - ptah-hang.log: one JSON object per line from the main-loop watchdog:
 *       {"time":"...","source":"main-loop-watchdog","event":"hang"|"recovered",
 *        "blockedForMs":N,"breadcrumbs":{...}}
 */

const fs = require('node:fs');
const readline = require('node:readline');

const LINE_RE =
  /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] \[(\w+)\s*\] \d{4}-\d{2}-\d{2}T[\d:.]+Z - (.*)$/;

/** A slow-handler duration above this is a clock/sleep artefact, not a block. */
const SUSPECT_DURATION_MS = 10 * 60 * 1000;

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Extract the JSON object that follows the first `: {` in a message, if any. */
function trailingJson(message) {
  const idx = message.indexOf('{');
  if (idx < 0) return null;
  return tryJson(message.slice(idx));
}

/**
 * Parse one Electron log line into a typed event, or `{ kind: 'line' }` for a
 * line that is a log record we do not classify (still counted for volume), or
 * 
ull` for continuation / unparseable lines.
 */
function parseElectronLogLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const ts = Date.parse(m[1]);
  if (Number.isNaN(ts)) return null;
  const level = m[2];
  const message = m[3];
  const base = { ts, level, message };

  if (message.startsWith('[event-loop] lag:')) {
    const j = trailingJson(message);
    if (j && typeof j.maxMs === 'number') {
      return {
        ...base,
        kind: 'eventLoopLag',
        maxMs: j.maxMs,
        p99Ms: typeof j.p99Ms === 'number' ? j.p99Ms : 0,
      };
    }
  } else if (message.startsWith('[RPC] slow handler:')) {
    const j = trailingJson(message);
    if (j && typeof j.method === 'string' && typeof j.durationMs === 'number') {
      return {
        ...base,
        kind: 'slowRpc',
        method: j.method,
        durationMs: j.durationMs,
      };
    }
  } else if (message.startsWith('[SQLite] slow statement:')) {
    const j = trailingJson(message);
    if (j && typeof j.durationMs === 'number') {
      return {
        ...base,
        kind: 'slowSqlite',
        durationMs: j.durationMs,
        op: typeof j.op === 'string' ? j.op : 'unknown',
        rows: typeof j.rows === 'number' ? j.rows : null,
        failed: j.failed === true,
        sql: typeof j.sql === 'string' ? j.sql.replace(/\s+/g, ' ').trim() : '',
        suppressed:
          typeof j.suppressedSinceLastLog === 'number'
            ? j.suppressedSinceLastLog
            : 0,
      };
    }
  } else if (message.startsWith('[GitProcessGate]')) {
    const g =
      /waited (\d+(?:\.\d+)?)ms for a git slot \(live=(\d+), queued=(\d+), max=(\d+)\)/.exec(
        message,
      );
    if (g) {
      return {
        ...base,
        kind: 'gitGateSaturated',
        waitedMs: Number(g[1]),
        live: Number(g[2]),
        queued: Number(g[3]),
        max: Number(g[4]),
      };
    }
  } else if (message.startsWith('[background-work] lagging')) {
    const j = trailingJson(message);
    return {
      ...base,
      kind: 'backgroundLag',
      trigger: j && typeof j.trigger === 'string' ? j.trigger : 'unknown',
      maxMs: j && typeof j.maxMs === 'number' ? j.maxMs : 0,
    };
  } else if (message.startsWith('[renderer] console.error:')) {
    const j = trailingJson(message);
    const text = j && typeof j.message === 'string' ? j.message : message;
    const t = /RPC timeout for method: (\S+)/.exec(text);
    if (t) {
      return {
        ...base,
        kind: 'rpcTimeout',
        method: t[1],
        windowId: j && typeof j.windowId === 'number' ? j.windowId : 0,
      };
    }
  } else if (message.includes('RendererFrame')) {
    const outer = trailingJson(message);
    // A renderer warning arrives wrapped in the `[renderer] console.warning`
    // envelope; the frame metrics are the JSON inside its `message` text.
    const inner =
      outer && typeof outer.message === 'string'
        ? trailingJson(outer.message)
        : null;
    const pick = (j) =>
      j
        ? [j.maxMs, j.durationMs, j.gapMs, j.frameMs].find(
            (v) => typeof v === 'number',
          )
        : undefined;
    const ms = pick(inner) ?? pick(outer);
    return {
      ...base,
      kind: 'rendererFrame',
      ms: typeof ms === 'number' ? ms : 0,
    };
  }
  return { ...base, kind: 'line' };
}

/** Parse one ptah-hang.log JSON line. */
function parseHangLine(line) {
  if (!line.startsWith('{')) return null;
  const j = tryJson(line);
  if (
    !j ||
    j.source !== 'main-loop-watchdog' ||
    (j.event !== 'hang' && j.event !== 'recovered') ||
    typeof j.blockedForMs !== 'number'
  ) {
    return null;
  }
  const ts = Date.parse(j.time);
  if (Number.isNaN(ts)) return null;
  return { kind: 'watchdog', event: j.event, ts, blockedForMs: j.blockedForMs };
}

/** Stream a file line by line into `onLine`. */
async function readLogFile(file, onLine) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) onLine(line);
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank))];
}

/** Spread-free max/min: event lists can hold millions of entries. */
function maxOf(list) {
  let m = 0;
  for (const v of list) if (v > m) m = v;
  return m;
}

function minOf(list) {
  let m = Infinity;
  for (const v of list) if (v < m) m = v;
  return m;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function distribution(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    count: s.length,
    p50: round1(percentile(s, 50)),
    p90: round1(percentile(s, 90)),
    p99: round1(percentile(s, 99)),
    max: round1(s.length ? s[s.length - 1] : 0),
  };
}

/**
 * Collect events (and a per-minute line histogram) from line sources.
 * Create one with `createCollector()`, feed `addElectronLine` / `addHangLine`,
 * then call `summarize(collector, window)` any number of times.
 */
function createCollector() {
  return { events: [], minuteLines: new Map(), minuteSigs: new Map(), lines: 0 };
}

function messageSignature(message) {
  const head = message.replace(/\d+(\.\d+)?/g, '#');
  return head.slice(0, 70);
}

function addElectronLine(collector, line) {
  const ev = parseElectronLogLine(line);
  if (!ev) return;
  collector.lines += 1;
  const minute = Math.floor(ev.ts / 60000);
  collector.minuteLines.set(minute, (collector.minuteLines.get(minute) ?? 0) + 1);
  const sigs = collector.minuteSigs.get(minute) ?? new Map();
  const sig = messageSignature(ev.message);
  sigs.set(sig, (sigs.get(sig) ?? 0) + 1);
  collector.minuteSigs.set(minute, sigs);
  if (ev.kind !== 'line') collector.events.push(ev);
  if (ev.level === 'WARN' || ev.level === 'ERROR') {
    collector.events.push({ ts: ev.ts, level: ev.level, kind: 'levelOnly' });
  }
}

function addHangLine(collector, line) {
  const ev = parseHangLine(line);
  if (ev) collector.events.push(ev);
}

/** Dedupe renderer RPC timeouts logged twice within the same second. */
function dedupeRpcTimeouts(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.method}|${e.windowId}|${Math.floor(e.ts / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function groupBy(list, keyFn) {
  const m = new Map();
  for (const item of list) {
    const k = keyFn(item);
    const arr = m.get(k);
    if (arr) arr.push(item);
    else m.set(k, [item]);
  }
  return m;
}

/**
 * Summarise the events inside `[fromMs, toMs]` (inclusive; either may be null).
 */
function summarize(collector, window = {}, options = {}) {
  const fromMs = window.fromMs ?? -Infinity;
  const toMs = window.toMs ?? Infinity;
  const stormLinesPerMin = options.stormLinesPerMin ?? 500;
  const inWin = collector.events.filter((e) => e.ts >= fromMs && e.ts <= toMs);
  const of = (kind) => inWin.filter((e) => e.kind === kind);

  const lag = of('eventLoopLag');
  const lagMax = lag.map((e) => e.maxMs);
  const lagP99 = lag.map((e) => e.p99Ms);
  const eventLoop = {
    warnings: lag.length,
    maxMs: round1(maxOf(lagMax)),
    maxOfP99Ms: round1(maxOf(lagP99)),
    maxMsDistribution: distribution(lagMax),
    p99MsDistribution: distribution(lagP99),
    over1s: lagMax.filter((v) => v > 1000).length,
    over5s: lagMax.filter((v) => v > 5000).length,
  };

  const wd = of('watchdog');
  const recovered = wd.filter((e) => e.event === 'recovered');
  const hangs = wd.filter((e) => e.event === 'hang');
  // An unrecovered hang is one with no `recovered` line at or after it before the next hang.
  // Judged against ALL watchdog events so a hang at a bucket edge whose "recovered" line falls in the
  // next bucket is not reported as unrecovered.
  if (!collector.wdSorted || collector.wdSortedFor !== collector.events.length) {
    collector.wdSorted = collector.events
      .filter((e) => e.kind === 'watchdog')
      .sort((a, b) => a.ts - b.ts);
    collector.wdSortedFor = collector.events.length;
  }
  const sorted = collector.wdSorted;
  let unrecovered = 0;
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    if (h.event !== 'hang' || h.ts < fromMs || h.ts > toMs) continue;
    const next = sorted[i + 1];
    if (!next || next.event === 'hang') unrecovered += 1;
  }
  const blockedValues = [
    ...recovered.map((e) => e.blockedForMs),
    ...(unrecovered ? hangs.map((e) => e.blockedForMs) : []),
  ];
  const watchdog = {
    hangEvents: hangs.length,
    recoveredEvents: recovered.length,
    unrecoveredHangs: unrecovered,
    totalBlockedMs: Math.round(
      recovered.reduce((s, e) => s + e.blockedForMs, 0),
    ),
    maxBlockedMs: Math.round(maxOf(blockedValues)),
    blockedPct:
      Number.isFinite(fromMs) && Number.isFinite(toMs)
        ? round1((100 * recovered.reduce((s, e) => s + e.blockedForMs, 0)) / (toMs - fromMs + 1))
        : null,
  };

  const rpc = of('slowRpc');
  const rpcValid = rpc.filter((e) => e.durationMs <= SUSPECT_DURATION_MS);
  const slowRpc = {
    total: rpcValid.length,
    suspectDurations: rpc.length - rpcValid.length,
    byMethod: Object.fromEntries(
      [...groupBy(rpcValid, (e) => e.method)]
        .map(([method, list]) => {
          const d = distribution(list.map((e) => e.durationMs));
          return [
            method,
            {
              count: d.count,
              p50Ms: d.p50,
              p95Ms: round1(
                percentile(
                  list.map((e) => e.durationMs).sort((a, b) => a - b),
                  95,
                ),
              ),
              maxMs: d.max,
              totalMs: Math.round(list.reduce((s, e) => s + e.durationMs, 0)),
            },
          ];
        })
        .sort((a, b) => b[1].totalMs - a[1].totalMs),
    ),
  };

  const timeouts = dedupeRpcTimeouts(of('rpcTimeout'));
  const rpcTimeouts = {
    total: timeouts.length,
    byMethod: Object.fromEntries(
      [...groupBy(timeouts, (e) => e.method)].map(([m, l]) => [m, l.length]),
    ),
  };

  const gateAll = of('gitGateSaturated');
  // A wait above 10 min is a suspend/resume artefact (same as slow handlers), not queueing.
  const gate = gateAll.filter((e) => e.waitedMs <= SUSPECT_DURATION_MS);
  const gateWaits = gate.map((e) => e.waitedMs);
  const gitGate = {
    saturatedEvents: gate.length,
    suspectWaits: gateAll.length - gate.length,
    maxWaitMs: round1(maxOf(gateWaits)),
    p50WaitMs: distribution(gateWaits).p50,
    maxQueued: maxOf(gate.map((e) => e.queued)),
  };

  const sq = of('slowSqlite');
  const sqliteSig = (e) => e.sql.slice(0, 60) || `<${e.op}>`;
  const sqlite = {
    slowStatements: sq.length,
    suppressedStatements: sq.reduce((s, e) => s + e.suppressed, 0),
    maxMs: round1(maxOf(sq.map((e) => e.durationMs))),
    over1s: sq.filter((e) => e.durationMs > 1000).length,
    over5s: sq.filter((e) => e.durationMs > 5000).length,
    top: [...groupBy(sq, sqliteSig)]
      .map(([sig, list]) => ({
        statement: sig,
        count: list.length,
        maxMs: round1(maxOf(list.map((e) => e.durationMs))),
      }))
      .sort((a, b) => b.maxMs - a.maxMs)
      .slice(0, 5),
  };

  const frames = of('rendererFrame');
  const rendererFrames = {
    warnings: frames.length,
    maxMs: round1(maxOf(frames.map((e) => e.ms))),
  };

  const bg = of('backgroundLag');
  const backgroundWork = {
    laggingEvents: bg.length,
    byTrigger: Object.fromEntries(
      [...groupBy(bg, (e) => e.trigger)].map(([t, l]) => [t, l.length]),
    ),
  };

  const levels = of('levelOnly');
  const warnErr = {
    warnOrError: levels.length,
  };

  // Log volume uses the per-minute histogram, clipped to whole minutes in the window.
  const minutes = [...collector.minuteLines.entries()].filter(
    ([minute]) => minute * 60000 >= fromMs - 60000 && minute * 60000 <= toMs,
  );
  const counts = minutes.map(([, n]) => n);
  const total = counts.reduce((s, n) => s + n, 0);
  let peakMinute = null;
  let peakLines = 0;
  for (const [minute, n] of minutes) {
    if (n > peakLines) {
      peakLines = n;
      peakMinute = minute;
    }
  }
  const stormMinutes = counts.filter((n) => n > stormLinesPerMin).length;
  const topPeakMessages = [];
  if (peakMinute !== null) {
    const sigs = collector.minuteSigs.get(peakMinute) ?? new Map();
    for (const [sig, n] of [...sigs].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      topPeakMessages.push({ signature: sig, count: n });
    }
  }
  const spanMinutes = Number.isFinite(fromMs) && Number.isFinite(toMs)
    ? Math.max(1, (toMs - fromMs) / 60000)
    : Math.max(1, minutes.length);
  const logVolume = {
    lines: total,
    activeMinutes: minutes.length,
    meanLinesPerMin: round1(total / spanMinutes),
    peakLinesPerMin: peakLines,
    peakMinuteUtc:
      peakMinute === null ? null : new Date(peakMinute * 60000).toISOString(),
    stormThresholdLinesPerMin: stormLinesPerMin,
    stormMinutes,
    topMessagesInPeakMinute: topPeakMessages,
  };

  const firstTs = inWin.length ? minOf(inWin.map((e) => e.ts)) : null;
  const lastTs = inWin.length ? maxOf(inWin.map((e) => e.ts)) : null;
  return {
    window: {
      from: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : null,
      to: Number.isFinite(toMs) ? new Date(toMs).toISOString() : null,
      firstEvent: firstTs === null ? null : new Date(firstTs).toISOString(),
      lastEvent: lastTs === null ? null : new Date(lastTs).toISOString(),
    },
    eventLoop,
    watchdog,
    slowRpc,
    rpcTimeouts,
    gitGate,
    sqlite,
    rendererFrames,
    backgroundWork,
    warnErr,
    logVolume,
  };
}

/**
 * Flatten a summary into the scalar metrics thresholds are written against.
 * `slowRpc.<method>.maxMs` is exposed as `rpc.<method>.maxMs`.
 */
function flatten(summary) {
  const flat = {
    'watchdog.hangEvents': summary.watchdog.hangEvents,
    'watchdog.unrecoveredHangs': summary.watchdog.unrecoveredHangs,
    'watchdog.totalBlockedMs': summary.watchdog.totalBlockedMs,
    'watchdog.maxBlockedMs': summary.watchdog.maxBlockedMs,
    'watchdog.blockedPct': summary.watchdog.blockedPct ?? 0,
    'eventLoop.maxMs': summary.eventLoop.maxMs,
    'eventLoop.maxOfP99Ms': summary.eventLoop.maxOfP99Ms,
    'eventLoop.over1s': summary.eventLoop.over1s,
    'eventLoop.over5s': summary.eventLoop.over5s,
    'eventLoop.warnings': summary.eventLoop.warnings,
    'rpcTimeouts.total': summary.rpcTimeouts.total,
    'gitGate.saturatedEvents': summary.gitGate.saturatedEvents,
    'gitGate.maxWaitMs': summary.gitGate.maxWaitMs,
    'sqlite.maxMs': summary.sqlite.maxMs,
    'sqlite.over1s': summary.sqlite.over1s,
    'sqlite.slowStatements': summary.sqlite.slowStatements,
    'rendererFrames.maxMs': summary.rendererFrames.maxMs,
    'rendererFrames.warnings': summary.rendererFrames.warnings,
    'logVolume.peakLinesPerMin': summary.logVolume.peakLinesPerMin,
    'logVolume.stormMinutes': summary.logVolume.stormMinutes,
    'slowRpc.maxMs': Math.max(
      0,
      ...Object.values(summary.slowRpc.byMethod).map((m) => m.maxMs),
    ),
  };
  for (const [method, m] of Object.entries(summary.slowRpc.byMethod)) {
    flat[`rpc.${method}.maxMs`] = m.maxMs;
    flat[`rpc.${method}.count`] = m.count;
  }
  return flat;
}

/**
 * Evaluate a summary against thresholds:
 *   { "<metric>": { "max": N, "note": "..." } | { "min": N } }.
 * Keys ending in `*` are patterns: `rpc.*.maxMs` applies to every RPC method.
 * A missing metric counts as 0 (nothing observed).
 */
function evaluateThresholds(summary, thresholds) {
  return evaluateFlat(flatten(summary), thresholds);
}

/** Per-metric maximum across several summaries (the worst value seen in any bucket). */
function envelope(summaries) {
  const out = {};
  for (const s of summaries) {
    for (const [k, v] of Object.entries(flatten(s))) {
      if (!(k in out) || v > out[k]) out[k] = v;
    }
  }
  return out;
}

function evaluateFlat(flat, thresholds) {
  const results = [];
  for (const [key, rule] of Object.entries(thresholds)) {
    if (key.startsWith('_')) continue;
    const metrics = key.includes('*')
      ? Object.keys(flat).filter((k) =>
          new RegExp(
            `^${key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`,
          ).test(k),
        )
      : [key];
    if (metrics.length === 0) metrics.push(key);
    for (const metric of metrics) {
      const value = flat[metric] ?? 0;
      let pass = true;
      if (typeof rule.max === 'number' && value > rule.max) pass = false;
      if (typeof rule.min === 'number' && value < rule.min) pass = false;
      results.push({
        metric,
        value,
        max: rule.max ?? null,
        min: rule.min ?? null,
        pass,
        note: rule.note ?? '',
      });
    }
  }
  return results;
}

function fmt(n) {
  return typeof n === 'number' ? String(n) : '-';
}

function toMarkdown(summary, thresholdResults, title) {
  const s = summary;
  const rows = [];
  rows.push(`## ${title ?? 'Streaming load metrics'}`);
  rows.push('');
  rows.push(
    `Window: ${s.window.from ?? 'start'} .. ${s.window.to ?? 'end'} (first event ${s.window.firstEvent ?? '-'}, last ${s.window.lastEvent ?? '-'})`,
  );
  rows.push('');
  rows.push('| Metric | Value |');
  rows.push('| --- | --- |');
  rows.push(`| Watchdog hang events (>5 s) | ${s.watchdog.hangEvents} |`);
  rows.push(`| Watchdog recovered events | ${s.watchdog.recoveredEvents} |`);
  rows.push(`| Watchdog unrecovered hangs | ${s.watchdog.unrecoveredHangs} |`);
  rows.push(`| Watchdog total blocked ms | ${s.watchdog.totalBlockedMs} |`);
  rows.push(`| Watchdog max blocked ms | ${s.watchdog.maxBlockedMs} |`);
  rows.push(`| Watchdog blocked % of window | ${s.watchdog.blockedPct ?? '-'} |`);
  rows.push(`| Event-loop lag warnings | ${s.eventLoop.warnings} |`);
  rows.push(`| Event-loop lag max ms | ${s.eventLoop.maxMs} |`);
  rows.push(
    `| Event-loop lag warning distribution p50 / p90 / p99 (ms) | ${s.eventLoop.maxMsDistribution.p50} / ${s.eventLoop.maxMsDistribution.p90} / ${s.eventLoop.maxMsDistribution.p99} |`,
  );
  rows.push(`| Event-loop max reported p99 ms | ${s.eventLoop.maxOfP99Ms} |`);
  rows.push(`| Lag warnings > 1 s | ${s.eventLoop.over1s} |`);
  rows.push(`| Lag warnings > 5 s | ${s.eventLoop.over5s} |`);
  rows.push(`| Renderer RPC timeouts (deduped) | ${s.rpcTimeouts.total} |`);
  rows.push(`| Git gate saturated events | ${s.gitGate.saturatedEvents} |`);
  rows.push(`| Git gate max wait ms | ${s.gitGate.maxWaitMs} |`);
  rows.push(`| Git gate max queued | ${s.gitGate.maxQueued} (${s.gitGate.suspectWaits} waits > 10 min excluded as suspend artefacts) |`);
  rows.push(`| Slow SQLite statements | ${s.sqlite.slowStatements} (+${s.sqlite.suppressedStatements} suppressed) |`);
  rows.push(`| Slow SQLite max ms | ${s.sqlite.maxMs} |`);
  rows.push(`| Slow SQLite > 1 s | ${s.sqlite.over1s} |`);
  rows.push(`| Renderer frame warnings | ${s.rendererFrames.warnings} (max ${s.rendererFrames.maxMs} ms) |`);
  rows.push(`| Background-work lagging events | ${s.backgroundWork.laggingEvents} |`);
  rows.push(`| Log lines | ${s.logVolume.lines} (mean ${s.logVolume.meanLinesPerMin}/min, peak ${s.logVolume.peakLinesPerMin}/min at ${s.logVolume.peakMinuteUtc ?? '-'}) |`);
  rows.push(`| Log-storm minutes (> ${s.logVolume.stormThresholdLinesPerMin}/min) | ${s.logVolume.stormMinutes} |`);
  rows.push('');
  const methods = Object.entries(s.slowRpc.byMethod).slice(0, 12);
  rows.push(
    `### Slow RPC handlers by method (${s.slowRpc.total} total, ${s.slowRpc.suspectDurations} suspect durations > 10 min excluded)`,
  );
  rows.push('');
  rows.push('| Method | Count | p50 ms | p95 ms | Max ms | Total ms |');
  rows.push('| --- | --- | --- | --- | --- | --- |');
  for (const [method, m] of methods) {
    rows.push(
      `| ${method} | ${m.count} | ${m.p50Ms} | ${m.p95Ms} | ${m.maxMs} | ${m.totalMs} |`,
    );
  }
  if (Object.keys(s.rpcTimeouts.byMethod).length) {
    rows.push('');
    rows.push('### Renderer RPC timeouts by method');
    rows.push('');
    for (const [method, n] of Object.entries(s.rpcTimeouts.byMethod)) {
      rows.push(`- ${method}: ${n}`);
    }
  }
  if (s.sqlite.top.length) {
    rows.push('');
    rows.push('### Slowest SQLite statements');
    rows.push('');
    rows.push('| Statement (first 60 chars) | Count | Max ms |');
    rows.push('| --- | --- | --- |');
    for (const t of s.sqlite.top) {
      rows.push(`| \`${t.statement.replace(/\|/g, '/')}\` | ${t.count} | ${t.maxMs} |`);
    }
  }
  if (s.logVolume.topMessagesInPeakMinute.length) {
    rows.push('');
    rows.push('### Top messages in the peak log minute');
    rows.push('');
    for (const t of s.logVolume.topMessagesInPeakMinute) {
      rows.push(`- ${t.count} x \`${t.signature.replace(/`/g, "'")}\``);
    }
  }
  if (thresholdResults) {
    rows.push('');
    rows.push('### Threshold evaluation');
    rows.push('');
    rows.push('| Metric | Value | Limit | Result |');
    rows.push('| --- | --- | --- | --- |');
    for (const r of thresholdResults) {
      const limit = r.max !== null ? `<= ${fmt(r.max)}` : `>= ${fmt(r.min)}`;
      rows.push(`| ${r.metric} | ${r.value} | ${limit} | ${r.pass ? 'PASS' : 'FAIL'} |`);
    }
    const failed = thresholdResults.filter((r) => !r.pass).length;
    rows.push('');
    rows.push(`Overall: ${failed === 0 ? 'PASS' : `FAIL (${failed} metric(s) over limit)`}`);
  }
  return rows.join('\n');
}

module.exports = {
  SUSPECT_DURATION_MS,
  parseElectronLogLine,
  parseHangLine,
  readLogFile,
  createCollector,
  addElectronLine,
  addHangLine,
  summarize,
  flatten,
  evaluateThresholds,
  evaluateFlat,
  envelope,
  toMarkdown,
  percentile,
};
