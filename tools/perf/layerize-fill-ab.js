// A/B on one build: Layerize cost under a simulated stream with the enter
// fade-ins as shipped (fill backwards, nothing held) and with their fill
// switched back to `both` (the pre-fix state, every finished fade-in held).
// Also snapshots the compositor layer count in each state. No tokens used.
// Usage: node layerize-fill-ab.js [seconds=15]
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const SECS = Number(process.argv[2] ?? 15);
const outDir = process.env.PTAH_PERF_OUT ?? path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const b = await chromium.connectOverCDP(
    `http://127.0.0.1:${process.env.PTAH_CDP_PORT ?? 9333}`,
  );
  const page = b
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes('index.html'));
  const cdp = await page.context().newCDPSession(page);

  const layerCount = async () => {
    const tree = new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 3000);
      cdp.once('LayerTree.layerTreeDidChange', (e) => {
        clearTimeout(t);
        resolve(e.layers ?? null);
      });
    });
    await cdp.send('LayerTree.enable');
    const list = await tree;
    await cdp.send('LayerTree.disable');
    return list ? list.length : null;
  };

  const state = () =>
    page.evaluate(() => {
      const a = document.getAnimations();
      return {
        nodes: document.getElementsByTagName('*').length,
        tiles: document.querySelectorAll('ptah-canvas-tile').length,
        heldFadeIns: a.filter(
          (x) =>
            /(FadeIn|SlideIn)$/.test(String(x.animationName)) &&
            x.playState === 'finished',
        ).length,
        animations: a.length,
      };
    });

  const run = async (label) => {
    const file = path.join(outDir, `${label}.trace.json`);
    await b.startTracing(page, {
      path: file,
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
      ],
    });
    await page.evaluate(
      (secs) =>
        new Promise((resolve) => {
          const host = [
            ...document.querySelectorAll('ptah-chat-transcript'),
          ].find((e) => e.getBoundingClientRect().height > 0);
          const target =
            host?.querySelector('ptah-message-bubble:last-of-type') ?? host;
          const spans = [];
          const end = performance.now() + secs * 1000;
          const tick = () => {
            const s = document.createElement('span');
            s.textContent = ' token';
            target.appendChild(s);
            spans.push(s);
            if (performance.now() < end) requestAnimationFrame(tick);
            else {
              spans.forEach((x) => x.remove());
              resolve();
            }
          };
          requestAnimationFrame(tick);
        }),
      SECS,
    );
    await b.stopTracing();
    const out = execFileSync('node', [
      path.join(__dirname, 'analyze.js'),
      file,
    ]).toString();
    const d = JSON.parse(out.slice(0, out.indexOf('\n}\n') + 2));
    const ms = (name) =>
      Number(
        (d.topEvents.find((e) => e.startsWith(name + ':')) ?? `${name}: 0ms`)
          .split(': ')[1]
          .replace('ms', ''),
      );
    return {
      busyPct: d.busyPct,
      layerizeMs: ms('Layerize'),
      commitMs: ms('Commit'),
      paintMs: d.byCategoryMs.paint,
      longTasks: d.longTasksOver50ms,
    };
  };

  const a = { state: await state(), layers: await layerCount() };
  a.result = await run('fill-ab-backwards');
  console.log('A backwards', JSON.stringify(a));

  const switched = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((el) =>
      /(FadeIn|SlideIn)$/.test(getComputedStyle(el).animationName),
    );
    els.forEach((el) => {
      el.style.animationFillMode = 'both';
    });
    return els.length;
  });
  await page.waitForTimeout(500);
  const bState = { switched, state: await state(), layers: await layerCount() };
  bState.result = await run('fill-ab-both');
  console.log('B both     ', JSON.stringify(bState));

  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*'))
      if (el.style.animationFillMode === 'both')
        el.style.removeProperty('animation-fill-mode');
  });
  console.log('restored', JSON.stringify(await state()));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
