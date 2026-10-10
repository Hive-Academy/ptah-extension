// Sum main-thread time by category from a Chrome trace written by probe.js.
// Usage: node analyze.js <trace.json>
const fs = require('node:fs');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const events = Array.isArray(raw) ? raw : raw.traceEvents;

const threadNames = new Map();
for (const e of events)
  if (e.ph === 'M' && e.name === 'thread_name')
    threadNames.set(`${e.pid}:${e.tid}`, e.args.name);
const mainKeys = [...threadNames]
  .filter(([, n]) => n === 'CrRendererMain')
  .map(([k]) => k);

const cat = {
  scripting: [
    'FunctionCall',
    'EvaluateScript',
    'v8.compile',
    'TimerFire',
    'FireAnimationFrame',
    'EventDispatch',
    'RunMicrotasks',
    'v8.callFunction',
  ],
  style: [
    'UpdateLayoutTree',
    'RecalculateStyles',
    'ScheduleStyleRecalculation',
  ],
  layout: ['Layout', 'UpdateLayerTree'],
  paint: [
    'Paint',
    'PaintImage',
    'RasterTask',
    'CompositeLayers',
    'Commit',
    'PrePaint',
    'Layerize',
  ],
  gc: ['MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'V8.GC_MARK_COMPACTOR'],
};
const lookup = new Map(
  Object.entries(cat).flatMap(([k, names]) => names.map((n) => [n, k])),
);

for (const key of mainKeys) {
  const totals = { scripting: 0, style: 0, layout: 0, paint: 0, gc: 0 };
  let tasks = 0,
    longTasks = 0,
    longest = 0,
    taskTotal = 0,
    t0 = Infinity,
    t1 = 0;
  const top = new Map();
  for (const e of events) {
    if (`${e.pid}:${e.tid}` !== key || e.ph !== 'X' || !e.dur) continue;
    t0 = Math.min(t0, e.ts);
    t1 = Math.max(t1, e.ts + e.dur);
    const ms = e.dur / 1000;
    if (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') {
      tasks++;
      taskTotal += ms;
      longest = Math.max(longest, ms);
      if (ms > 50) longTasks++;
    }
    const c = lookup.get(e.name);
    if (c) totals[c] += ms;
    top.set(e.name, (top.get(e.name) ?? 0) + ms);
  }
  if (!tasks) continue;
  const wall = (t1 - t0) / 1000;
  const r = (n) => Math.round(n);
  console.log(
    JSON.stringify(
      {
        thread: key,
        wallMs: r(wall),
        busyMs: r(taskTotal),
        busyPct: +((100 * taskTotal) / wall).toFixed(1),
        tasks,
        longTasksOver50ms: longTasks,
        longestTaskMs: r(longest),
        byCategoryMs: Object.fromEntries(
          Object.entries(totals).map(([k, v]) => [k, r(v)]),
        ),
        topEvents: [...top]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([n, v]) => `${n}: ${r(v)}ms`),
      },
      null,
      2,
    ),
  );
}
