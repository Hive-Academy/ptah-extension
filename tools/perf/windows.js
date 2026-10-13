// Split a probe.js trace into fixed time windows and sum main-thread cost per
// window, so a short stream inside a long trace is not averaged away.
// Usage: node windows.js <trace.json> [windowSeconds=10]
const fs = require('node:fs');
const [file, winArg = '10'] = process.argv.slice(2);
const win = Number(winArg) * 1e6;
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const events = Array.isArray(raw) ? raw : raw.traceEvents;

const names = new Map();
for (const e of events)
  if (e.ph === 'M' && e.name === 'thread_name')
    names.set(`${e.pid}:${e.tid}`, e.args.name);
const counts = new Map();
for (const e of events) {
  const k = `${e.pid}:${e.tid}`;
  if (names.get(k) === 'CrRendererMain' && e.ph === 'X' && e.name === 'RunTask')
    counts.set(k, (counts.get(k) ?? 0) + 1);
}
const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
if (!main) throw new Error('no renderer main thread in trace');

const tracked = {
  RunTask: 'busy',
  Layerize: 'layerize',
  Commit: 'commit',
  Paint: 'paint',
  PrePaint: 'prepaint',
  FunctionCall: 'script',
  UpdateLayoutTree: 'style',
  Layout: 'layout',
};
let t0 = Infinity;
for (const e of events)
  if (`${e.pid}:${e.tid}` === main && e.ph === 'X' && e.ts < t0) t0 = e.ts;
const buckets = new Map();
for (const e of events) {
  if (`${e.pid}:${e.tid}` !== main || e.ph !== 'X' || !e.dur) continue;
  const key = tracked[e.name];
  if (!key) continue;
  const i = Math.floor((e.ts - t0) / win);
  const b =
    buckets.get(i) ??
    Object.fromEntries(Object.values(tracked).map((v) => [v, 0]));
  b[key] += e.dur / 1000;
  buckets.set(i, b);
}
for (const [i, b] of [...buckets].sort((x, y) => x[0] - y[0])) {
  const start = (i * win) / 1e6;
  const cols = Object.entries(b)
    .map(([k, v]) => `${k}=${Math.round(v)}`)
    .join(' ');
  console.log(
    `${String(start).padStart(4)}s busy%=${((100 * b.busy) / (win / 1000)).toFixed(1).padStart(5)} ${cols}`,
  );
}
