// Attach to a running Ptah (started with --remote-debugging-port) and record
// frame, long-task, layout-shift and heap data plus a Chrome trace.
// Usage: node probe.js <port> <label> <seconds> [promptFile|action.js]
// PTAH_LAYERS=1 also snapshots the compositor layer tree (CDP LayerTree) every
// 20 s and groups the largest tree by owning element with its compositing
// reasons. Each snapshot costs a little main-thread time of its own.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const [port = '9333', label = 'run', secs = '30', promptFile] =
  process.argv.slice(2);
const outDir = process.env.PTAH_PERF_OUT ?? path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const OBSERVER = `(() => {
  if (window.__probe) window.__probe.running = false;
  const p = window.__probe = { longTasks: [], shifts: 0, shiftCount: 0, shiftSources: {}, frames: [], last: performance.now(), running: true };
  if (!window.__probeObs) {
    window.__probeObs = true;
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__probe.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) { const q = window.__probe; q.shifts += e.value; q.shiftCount++; for (const src of e.sources ?? []) { const n = src.node; const el = n && (n.nodeType === 1 ? n : n.parentElement); const host = el?.closest?.('[class*=ptah-], ptah-chat-transcript, ptah-message-bubble, ptah-canvas-tile') ; const key = (el ? el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0, 3).join('.') : '?') + ' < ' + (host ? host.tagName.toLowerCase() : '-') + ' dy=' + Math.round((src.currentRect?.y ?? 0) - (src.previousRect?.y ?? 0)); q.shiftSources[key] = (q.shiftSources[key] || 0) + e.value; } } }).observe({ type: 'layout-shift', buffered: false });
  }
  const loop = t => { if (!p.running) return; p.frames.push(t - p.last); p.last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})()`;

const SUMMARY = `(() => {
  const p = window.__probe; p.running = false;
  const f = p.frames.slice(1);
  const over = ms => f.filter(d => d > ms).length;
  const sorted = [...f].sort((a, b) => a - b);
  const pct = q => sorted.length ? Math.round(sorted[Math.floor(q * (sorted.length - 1))] * 10) / 10 : 0;
  return {
    frames: f.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: Math.round(Math.max(0, ...f)),
    framesOver33ms: over(33.4), framesOver50ms: over(50),
    longTasks: p.longTasks.length, longTaskMax: Math.max(0, ...p.longTasks), longTaskTotal: p.longTasks.reduce((a, b) => a + b, 0),
    cls: Math.round(p.shifts * 1000) / 1000, shiftCount: p.shiftCount,
    topShiftSources: Object.entries(p.shiftSources).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ' : ' + v.toFixed(3)),
    domNodes: document.getElementsByTagName('*').length,
  };
})()`;

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().includes('index.html')) ?? pages[0];
  if (!page) throw new Error('No renderer page found');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return {
      heapMB: Math.round(m.JSHeapUsedSize / 1048576),
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      layouts: m.LayoutCount,
      styles: m.RecalcStyleCount,
      layoutSec: +m.LayoutDuration.toFixed(2),
      styleSec: +m.RecalcStyleDuration.toFixed(2),
      scriptSec: +m.ScriptDuration.toFixed(2),
      taskSec: +m.TaskDuration.toFixed(2),
    };
  };

  // LayerTree is enabled only for a short snapshot every 20 s, so its own
  // cost stays out of most of the trace.
  const layers = { samples: [], peak: null };
  const snapshotLayers = async () => {
    const tree = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      cdp.once('LayerTree.layerTreeDidChange', (e) => {
        clearTimeout(timer);
        resolve(e.layers ?? null);
      });
    });
    await cdp.send('LayerTree.enable');
    const list = await tree;
    if (list && (!layers.peak || list.length > layers.peak.length))
      layers.peak = list;
    // Resolve owners while the domain is on; layer ids are only valid then.
    if (list && layers.peak === list)
      layers.peakOwners = await describeLayers(list);
    await cdp.send('LayerTree.disable');
    layers.samples.push(list ? list.length : null);
  };
  const describeLayers = async (list) => {
    const groups = new Map();
    for (const l of list.filter((x) => x.backendNodeId).slice(0, 400)) {
      let key = 'node#' + l.backendNodeId;
      try {
        const { node } = await cdp.send('DOM.describeNode', {
          backendNodeId: l.backendNodeId,
        });
        const cls = (node.attributes ?? []).reduce(
          (a, v, i, arr) => (v === 'class' ? arr[i + 1] : a),
          '',
        );
        key = node.localName + '.' + cls.split(' ').slice(0, 3).join('.');
      } catch {
        /* node gone */
      }
      const g = groups.get(key) ?? { count: 0, reasons: new Set() };
      g.count++;
      if (g.count <= 2) {
        try {
          (
            await cdp.send('LayerTree.compositingReasons', {
              layerId: l.layerId,
            })
          ).compositingReasonIds?.forEach((r) => g.reasons.add(r));
        } catch {
          /* layer gone */
        }
      }
      groups.set(key, g);
    }
    return [...groups]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([k, g]) => ({ owner: k, count: g.count, reasons: [...g.reasons] }));
  };
  let layerTimer;
  if (process.env.PTAH_LAYERS === '1') {
    await cdp.send('DOM.enable');
    await snapshotLayers();
    layerTimer = setInterval(() => {
      snapshotLayers().catch(() => {});
    }, 20000);
  }

  await page.evaluate(OBSERVER);
  const before = await heap();
  await browser.startTracing(page, {
    path: path.join(outDir, `${label}.trace.json`),
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'blink.user_timing',
      'v8.execute',
      'loading',
      'latencyInfo',
    ],
  });

  if (promptFile && promptFile.endsWith('.js')) {
    await require(path.resolve(promptFile))(page);
  } else if (promptFile) {
    const text = fs.readFileSync(promptFile, 'utf8').trim();
    const box = page.locator('ptah-chat-input textarea').first();
    await box.click();
    await box.fill(text);
    await box.press('Enter');
    console.log('prompt sent');
  }

  await page.waitForTimeout(Number(secs) * 1000);
  await browser.stopTracing();
  let layerReport;
  if (layerTimer) {
    clearInterval(layerTimer);
    await snapshotLayers().catch(() => {});
    const peak = layers.peak ?? [];
    layerReport = {
      samples: layers.samples,
      peak: peak.length,
      withoutNode: peak.filter((x) => !x.backendNodeId).length,
      byOwner: layers.peakOwners,
    };
  }
  const after = await heap();
  const summary = await page.evaluate(SUMMARY);
  const delta = Object.fromEntries(
    Object.keys(after).map((k) => [
      k,
      typeof after[k] === 'number' ? +(after[k] - before[k]).toFixed(2) : null,
    ]),
  );
  const result = {
    label,
    secs: Number(secs),
    summary,
    heapBefore: before.heapMB,
    heapAfter: after.heapMB,
    delta,
    layers: layerReport,
  };
  fs.writeFileSync(
    path.join(outDir, `${label}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await browser.close().catch(() => {});
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
