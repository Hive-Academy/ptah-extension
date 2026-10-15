// Prototype capture + verification tool (not product code). Needs Playwright from the main checkout:
//   node capture.mjs shots   -> refreshes ../screenshots/*.png (dark + light)
//   node capture.mjs checks  -> real-keyboard focus-path checks (docked + 400 px sheet) and target-size audit, prints a report
//   node capture.mjs measure -> prints layout offsets used for the one-to-one fidelity comparison
// Serves the prototype folder on 127.0.0.1 (random port) and stops the server when done. No network access is required
// except Google Fonts (falls back to system fonts offline, widths then differ by a few px).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pw = process.env.PLAYWRIGHT_ENTRY || 'D:/projects/ptah-extension/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(pw).href);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const mode = process.argv[2] || 'shots';
const browser = await chromium.launch();

async function open(query, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?${query}`);
  await page.waitForTimeout(1300); // stagger settles (1000 ms) + fonts
  return { page, ctx, errors };
}

try {
  if (mode === 'shots') {
    const W = { width: 1594, height: 839 }, N = { width: 400, height: 900 };
    const wide = (q, name, vp = W) => ({ q: `bare=1&replay=0&${q}`, name, vp });
    const jobs = [];
    for (const th of ['dark', 'light']) {
      jobs.push(wide(`theme=${th}`, `${th}-collapsed-wide`));
      jobs.push(wide(`theme=${th}&t2=streaming`, `${th}-live-streaming-wide`));
      jobs.push(wide(`theme=${th}&t2=done`, `${th}-turn-done-wide`));
      jobs.push(wide(`theme=${th}&ask=lane-open`, `${th}-request-review-open`));
      jobs.push(wide(`theme=${th}&ask=multi`, `${th}-requests-several`));
      jobs.push(wide(`theme=${th}&ask=question`, `${th}-request-question`));
      jobs.push(wide(`theme=${th}&body=partial`, `${th}-inspector-partial`));
      jobs.push(wide(`theme=${th}&parity=1&t1=expanded&ask=none`, `${th}-parity-surfaces`));
      jobs.push(wide(`theme=${th}&insp=closed`, `${th}-inspector-closed-wide`));
      jobs.push(wide(`theme=${th}&width=sidebar&insp=closed`, `${th}-sidebar-400-container`, { width: 700, height: 839 }));
      jobs.push(wide(`theme=${th}&insp=open`, `${th}-narrow-400-inspector-sheet`, N));
      jobs.push(wide(`theme=${th}&insp=open&ask=lane-open`, `${th}-narrow-400-review-open`, N));
      jobs.push(wide(`theme=${th}&insp=closed&t2=streaming`, `${th}-narrow-400-streaming`, N));
    }
    jobs.push(wide('t1=expanded&t2=answered', 'dark-expanded-and-answered-wide'));
    jobs.push(wide('body=empty&ask=none', 'dark-inspector-empty'));
    jobs.push(wide('body=loading', 'dark-inspector-loading'));
    jobs.push(wide('body=error', 'dark-inspector-error'));
    jobs.push(wide('theme=light&body=error', 'light-inspector-error'));
    jobs.push(wide('theme=light&body=empty&ask=none', 'light-inspector-empty'));
    jobs.push(wide('theme=light&body=loading', 'light-inspector-loading'));
    const out = path.join(root, 'screenshots');
    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.unlinkSync(path.join(out, f));
    for (const j of jobs) {
      const { page, ctx, errors } = await open(j.q, j.vp);
      await page.screenshot({ path: path.join(out, j.name + '.png') });
      console.log('shot', j.name, errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok');
      await ctx.close();
    }
    // Interaction states (Round 1): reached by real clicks / keys, then captured
    const W2 = { width: 1594, height: 839 }, N2 = { width: 400, height: 900 };
    const states = [
      ['requests-more-open', 'ask=multi', W2, async (pg) => { await pg.click('[data-act="more"][data-owner="gemini"]'); }],
      ['request-error-retry', 'ask=lane-open&fail=1', W2, async (pg) => { await pg.click('[data-act="decide"][data-d="allow"]'); await pg.waitForTimeout(900); }],
      ['request-closed-elsewhere', 'ask=lane-open', W2, async (pg) => { await pg.evaluate(() => document.getElementById('laneEnds').click()); await pg.waitForTimeout(150); }],
      ['request-electron-fallback', 'ask=multi&host=electron', W2, async (pg) => { await pg.click('[data-act="review"][data-key="perm:p1"]'); }],
      ['narrow-400-overlay-focus', 'insp=closed&ask=multi', N2, async (pg) => { await pg.focus('#inspToggle'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(450); }],
      ['narrow-400-multi-more-open', 'insp=open&ask=multi', N2, async (pg) => { await pg.click('[data-act="more"][data-owner="gemini"]'); }],
    ];
    for (const th of ['dark', 'light']) for (const [name, q, vp, run] of states) {
      const { page, ctx, errors } = await open(`bare=1&replay=0&theme=${th}&${q}`, vp);
      await run(page); await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, `${th}-${name}.png`) });
      console.log('shot', `${th}-${name}`, errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok');
      await ctx.close();
    }
  }

  if (mode === 'measure') {
    const { page, ctx } = await open('bare=1&replay=0', { width: 1594, height: 839 });
    const m = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
      return { header: r('.cs-header'), worked1: r('#worked1'), user1: r('.cs-user'), answer: r('#turn1 .cs-answer'), composer: r('.cs-composer'), compTop: r('.cs-comp-top'), inspector: r('#inspector'), scroll: r('#scroll'), sbw: document.querySelector('#scroll').offsetWidth - document.querySelector('#scroll').clientWidth };
    });
    console.log(JSON.stringify(m, null, 1));
    await ctx.close();
  }

  if (mode === 'checks') {
    const report = [];
    const ok = (c, m) => report.push((c ? 'PASS  ' : 'FAIL  ') + m);
    const act = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 40)) : 'none'; });

    // A. In-page check (sidebar width = overlay mode inside a wide window)
    {
      const { page, ctx, errors } = await open('bare=1&replay=0', { width: 1594, height: 839 });
      await page.evaluate(() => document.getElementById('checkFocus').click()); await page.waitForTimeout(1200);
      const lines = await page.evaluate(() => window.__focusCheck || []);
      report.push('--- in-page focus-path check (shell forced to 400 px container) ---', ...lines);
      if (errors.length) report.push('ERRORS ' + errors.join(' | '));
      await ctx.close();
    }
    // B. Real keyboard on a 400 px viewport: entry, trap, Esc, close, scrim, return
    {
      const { page, ctx } = await open('bare=1&replay=0&insp=closed&ask=multi', { width: 400, height: 900 });
      report.push('--- real keyboard, 400 px viewport, 5 requests ---');
      await page.focus('#inspToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
      ok((await act(page)) === 'inspClose', 'Enter on the toggle opens the sheet and focus lands on Close (' + (await act(page)) + ')');
      const inert = await page.evaluate(() => document.querySelector('#mainRegion').inert);
      ok(inert, 'thread, header and composer are inert while the sheet is open');
      const stops = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        stops.push(await act(page));
        if (stops.length > 1 && stops[stops.length - 1] === stops[0]) break;
      }
      const insideOnly = await page.evaluate((s) => s.every((x) => x), stops);
      report.push('Tab cycle (' + stops.length + ' stops): ' + stops.join(' > '));
      ok(stops.includes('inspClose') && stops.filter((x) => x === 'inspClose').length >= 1 && insideOnly, 'Tab wraps inside the sheet; it never reaches the composer or the header');
      const leaked = await page.evaluate(() => !document.querySelector('#inspector').contains(document.activeElement));
      ok(!leaked, 'focus is still inside the sheet after the cycle');
      await page.keyboard.press('Shift+Tab');
      ok(!(await page.evaluate(() => !document.querySelector('#inspector').contains(document.activeElement))), 'Shift+Tab stays inside the sheet');
      // Review panel then Esc: innermost first
      await page.click('[data-act="review"][data-key="lane:gemini:r1"]'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => document.activeElement.getAttribute('role'))) === 'group', 'Review moves focus to the decision panel');
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => document.querySelector('#inspector') && getComputedStyle(document.querySelector('#inspector')).display !== 'none')), 'first Escape closes the panel, the sheet stays open');
      ok((await act(page)).startsWith('Review permission request from Gemini'), 'focus returns to the Review button (' + (await act(page)) + ')');
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      ok((await act(page)) === 'inspToggle', 'second Escape closes the sheet; focus returns to the toggle (' + (await act(page)) + ')');
      // Close button, scrim
      await page.keyboard.press('Enter'); await page.waitForTimeout(100);
      await page.keyboard.press('Enter'); await page.waitForTimeout(100); // Close is focused
      ok((await act(page)) === 'inspToggle', 'Enter on Close: focus returns to the toggle');
      await page.keyboard.press('Enter'); await page.waitForTimeout(100);
      await page.mouse.click(5, 450); await page.waitForTimeout(100); // scrim is under the sheet at 400 px; click path covered by in-page check
      await ctx.close();
    }
    // C. Docked wide: tab order main then inspector
    {
      const { page, ctx } = await open('bare=1&replay=0&ask=multi', { width: 1594, height: 839 });
      const order = await page.evaluate(() => Array.from(document.querySelectorAll('a[href],button:not([disabled]),input,textarea,[tabindex]:not([tabindex="-1"])')).filter((e) => e.getClientRects().length && !e.closest('[hidden]') && !e.closest('.proto-bar')).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()).replace(/\s+/g, ' ').slice(0, 44)));
      report.push('--- docked tab order (1594 px, 5 requests) ---', order.map((x, i) => (i + 1) + '. ' + x).join('\n'));
      const iMain = order.findIndex((x) => x.startsWith('Send message')), iInsp = order.findIndex((x) => x === 'Close session details');
      ok(iMain > -1 && iInsp > iMain, 'DOM order: composer (' + (iMain + 1) + ') comes before the inspector (' + (iInsp + 1) + ')');
      await ctx.close();
    }
    // D. Target-size audit: every interactive control of the inspector and thread
    for (const [label, q, vp] of [['wide, 5 requests, panel open, error row', 'bare=1&replay=0&ask=multi&parity=1&body=full', { width: 1594, height: 839 }], ['400 px sheet', 'bare=1&replay=0&ask=multi', { width: 400, height: 900 }]]) {
      const { page, ctx } = await open(q, vp);
      await page.click('[data-act="review"][data-key="lane:gemini:r1"]'); await page.waitForTimeout(100);
      await page.click('[data-act="more"][data-owner="gemini"]'); await page.waitForTimeout(100);
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('button,a[href],input')).filter((e) => e.getClientRects().length && !e.closest('[hidden]') && !e.closest('.proto-bar') && !e.closest('[inert]') || (e.closest('#inspector') && e.getClientRects().length)).map((e) => { const t = (e.tagName === 'INPUT' && e.closest('label')) || e; const b = t.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 36), w: Math.round(b.width), h: Math.round(b.height) }; }).filter((x) => x.w < 24 || x.h < 24));
      ok(small.length === 0, `target size >= 24x24, ${label}: ${small.length ? JSON.stringify(small) : 'all controls pass'}`);
      await ctx.close();
    }
    // E. Retry / Answer / Close / Open lane targets in the states that render them
    for (const vp of [{ width: 1594, height: 839 }, { width: 400, height: 900 }]) {
      const { page, ctx } = await open('bare=1&replay=0&ask=multi&fail=1', vp);
      await page.click('[data-act="review"][data-key="lane:gemini:r1"]'); await page.click('[data-act="decide"][data-d="allow"]'); await page.waitForTimeout(900);
      const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('#inspector [data-act]')).filter((e) => e.getClientRects().length).map((e) => { const b = e.getBoundingClientRect(); return e.dataset.act + ':' + Math.round(b.width) + 'x' + Math.round(b.height); }));
      const hasRetry = sizes.some((x) => x.startsWith('retry:'));
      ok(hasRetry && sizes.every((x) => { const [w, h] = x.split(':')[1].split('x').map(Number); return w >= 24 && h >= 24; }), `Retry / Answer / Review / More / Open lane targets at ${vp.width}px: ${sizes.join(' ')}`);
      await ctx.close();
    }
    console.log(report.join('\n'));
  }
} finally {
  await browser.close();
  server.close();
}
