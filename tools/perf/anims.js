const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP(
    `http://127.0.0.1:${process.env.PTAH_CDP_PORT ?? 9333}`,
  );
  const page = b
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes('index.html'));
  console.log(
    JSON.stringify(
      await page.evaluate(() => {
        const out = {};
        for (const a of document.getAnimations()) {
          const t = a.effect?.target;
          const timing = a.effect?.getTiming?.() ?? {};
          const visible =
            t &&
            t.getBoundingClientRect &&
            t.getBoundingClientRect().width > 0 &&
            t.checkVisibility?.();
          const key = `${a.animationName || a.transitionProperty || a.constructor.name} | ${timing.iterations === Infinity ? 'infinite' : 'finite'} | ${a.playState} | ${visible ? 'visible' : 'hidden'} | ${t?.tagName?.toLowerCase()}.${String(
            t?.className ?? '',
          )
            .split(' ')
            .filter((c) => /anim|spin|pulse|glow|shimmer|dot|blink/.test(c))
            .join('.')}`;
          out[key] = (out[key] || 0) + 1;
        }
        return Object.entries(out).sort((x, y) => y[1] - x[1]);
      }),
      null,
      1,
    ),
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
