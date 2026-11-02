// B9 visual review of the PtahCode live demo section (headless Chromium).
const { chromium } = require('/home/amun/ptah-extension/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:4874';
const OUT = process.argv[2];
const results = {};
const shot = (name) => path.join(OUT, `b9-after-${name}.png`);

function lum([r, g, b]) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

async function sectionInfo(page) {
  return page.evaluate(() => {
    const s = document.querySelector('#live-demo');
    const f = s.querySelector('iframe');
    const v = s.querySelector('video');
    const pb = s.querySelector('[role=progressbar]');
    return {
      iframe: f ? { src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'), title: f.title } : null,
      video: v ? { src: v.getAttribute('src'), muted: v.muted, controls: v.controls, preload: v.preload, poster: v.getAttribute('poster') } : null,
      poster: s.querySelector('img')?.getAttribute('src') ?? null,
      progress: pb?.getAttribute('aria-valuenow') ?? null,
      buttons: [...s.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      replay: f?.contentWindow?.__ptahReplay?.state ?? null,
    };
  });
}

async function contrast(page) {
  const pairs = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const s = document.querySelector('#live-demo');
    const bg = parse(getComputedStyle(s).backgroundColor);
    const panelBg = parse(getComputedStyle(s.querySelector('[role=tabpanel]')).backgroundColor);
    const pick = (sel, base) => {
      const el = s.querySelector(sel);
      return el ? { sel, fg: parse(getComputedStyle(el).color), bg: base ?? parse(getComputedStyle(el).backgroundColor) } : null;
    };
    return [
      pick('span', bg),
      pick('h2', bg),
      pick('p', bg),
      pick('[role=tab][aria-selected=true]'),
      pick('[role=tab][aria-selected=false]', bg),
      pick('[role=tabpanel] p', panelBg),
      pick('a[href="/download"]', panelBg),
    ].filter(Boolean);
  });
  return pairs.map((p) => ({ sel: p.sel, fg: p.fg.join(','), bg: p.bg.join(','), ratio: ratio(p.fg, p.bg) }));
}

async function focusOrder(page) {
  await page.evaluate(() => {
    const h = document.querySelector('#ptah-live-demo-heading');
    h.setAttribute('tabindex', '-1');
    h.focus();
  });
  const order = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        const inSection = !!a.closest('#live-demo');
        const cs = getComputedStyle(a);
        return {
          inSection,
          el: `${a.tagName.toLowerCase()}${a.getAttribute('role') ? `[role=${a.getAttribute('role')}]` : ''}`,
          name: (a.getAttribute('aria-label') || a.textContent || a.title || '').trim().slice(0, 40),
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        };
      }),
    );
  }
  return order;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // Desktop, normal motion: auto iframe.
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    let page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.locator('#live-demo').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('#live-demo').scrollIntoView());
    await page.waitForSelector('#live-demo iframe', { timeout: 15000 });
    await page.waitForTimeout(9000);
    results.desktopBeforeSend = await sectionInfo(page);
    await page.evaluate(() => window.scrollBy(0, 330));
    await page.screenshot({ path: shot('desktop-iframe-waiting-send') });
    const frame = page.frameLocator('#live-demo iframe');
    await frame.locator('ptah-chat-input button[data-testid="chat-send-btn"], ptah-chat-input button[aria-label*="Send"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(12000);
    results.desktopAfterSend = await sectionInfo(page);
    await page.screenshot({ path: shot('desktop-iframe-playing') });
    // Tab change reloads iframe.
    await page.locator('#live-demo [role=tab]', { hasText: 'Tribunal Council' }).click();
    await page.waitForTimeout(10000);
    results.desktopTribunal = await sectionInfo(page);
    await page.screenshot({ path: shot('desktop-tribunal') });
    // Scroll away pauses.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    results.desktopScrolledAway = await sectionInfo(page);
    await page.evaluate(() => document.querySelector('#live-demo').scrollIntoView());
    results.contrast = await contrast(page);
    results.focusOrderDesktop = await focusOrder(page);
    await page.screenshot({ path: shot('desktop-focus') });
    results.consoleErrorsDesktop = consoleErrors;
    await ctx.close();

    // Tablet: poster + click-to-load.
    ctx = await browser.newContext({ viewport: { width: 900, height: 1100 }, colorScheme: 'dark' });
    page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelector('#live-demo').scrollIntoView());
    await page.waitForTimeout(2500);
    results.tablet = await sectionInfo(page);
    await page.screenshot({ path: shot('tablet') });
    await ctx.close();

    // Mobile: video fallback.
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelector('#live-demo').scrollIntoView());
    await page.waitForTimeout(2500);
    results.mobile = await sectionInfo(page);
    await page.screenshot({ path: shot('mobile') });
    await page.evaluate(() => window.scrollBy(0, 420));
    await page.screenshot({ path: shot('mobile-video') });
    await ctx.close();

    // Demo pages directly.
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    page = await ctx.newPage();
    await page.goto(BASE + '/demo/?scenario=multi-agent', { waitUntil: 'networkidle' });
    await page.waitForTimeout(15000);
    await page.screenshot({ path: shot('demo-page-desktop') });
    await ctx.close();
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true });
    page = await ctx.newPage();
    await page.goto(BASE + '/demo/?scenario=tribunal-council', { waitUntil: 'networkidle' });
    await page.waitForTimeout(12000);
    await page.screenshot({ path: shot('demo-page-mobile') });
    await ctx.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'b9-review-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 1).slice(0, 6000));
})().catch((e) => {
  console.error('B9 FAILED', e);
  fs.writeFileSync(path.join(OUT, 'b9-review-results.json'), JSON.stringify({ ...results, error: String(e) }, null, 2));
  process.exit(1);
});
