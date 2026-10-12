// A/B: Layerize cost under a simulated stream, before and after cancelling the
// finished execFadeIn animations that keep a fill (and a layer) on every tool row.
const path = require('node:path');
const { chromium } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const SECS = 12;
require('node:fs').mkdirSync(
  process.env.PTAH_PERF_OUT ?? path.join(__dirname, 'out'),
  { recursive: true },
);
(async () => {
  const b = await chromium.connectOverCDP(
    `http://127.0.0.1:${process.env.PTAH_CDP_PORT ?? 9333}`,
  );
  const page = b
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes('index.html'));
  const info = await page.evaluate(() => ({
    fade: document
      .getAnimations()
      .filter(
        (a) =>
          String(a.animationName).endsWith('FadeIn') ||
          String(a.animationName).endsWith('SlideIn'),
      ).length,
    scrollbarTransitions: document
      .getAnimations()
      .filter(
        (a) =>
          a.transitionProperty === 'scrollbar-color' &&
          a.playState === 'running',
      ).length,
    anims: document.getAnimations().length,
    nodes: document.getElementsByTagName('*').length,
  }));
  console.log('state', JSON.stringify(info));
  const run = async (label) => {
    const file = path.join(
      process.env.PTAH_PERF_OUT ?? path.join(__dirname, 'out'),
      `${label}.trace.json`,
    );
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
    const out = execFileSync(process.execPath, [
      path.join(__dirname, 'analyze.js'),
      file,
    ]).toString();
    const d = JSON.parse(out.slice(0, out.indexOf('\n}\n') + 2));
    const layerize =
      d.topEvents.find((e) => e.startsWith('Layerize')) || 'Layerize: 0ms';
    console.log(
      label,
      JSON.stringify({
        busyPct: d.busyPct,
        longTasks: d.longTasksOver50ms,
        longest: d.longestTaskMs,
        cat: d.byCategoryMs,
        layerize,
      }),
    );
  };
  await run('ab-before');
  const cancelled = await page.evaluate(() => {
    const list = document
      .getAnimations()
      .filter((a) => /(FadeIn|SlideIn)$/.test(String(a.animationName)));
    list.forEach((a) => a.cancel());
    return list.length;
  });
  console.log('cancelled fade-in fills', cancelled);
  await run('ab-no-fade');
  const sb = await page.evaluate(() => {
    const list = document
      .getAnimations()
      .filter((a) => a.transitionProperty === 'scrollbar-color');
    list.forEach((a) => a.cancel());
    return list.length;
  });
  console.log('cancelled scrollbar transitions', sb);
  await run('ab-no-fade-no-scrollbar');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
