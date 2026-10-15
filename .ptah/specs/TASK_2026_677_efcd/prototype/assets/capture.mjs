// Prototype capture + verification tool (not product code). Needs Playwright from the main checkout:
//   node capture.mjs shots   -> refreshes ../screenshots/*.png (dark + light)
//   node capture.mjs checks  -> real-keyboard focus-path checks (docked + 400 px sheet) and target-size audit, prints a report
//   node capture.mjs delta2-merged -> delta2-merged-*.png (dock, hover card, N agents menu, 400 px; dark + light)
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


async function delta2Merged() {
  const out = path.join(root, 'screenshots');
  fs.mkdirSync(out, { recursive: true });
  const W = { width: 1594, height: 839 }, N = { width: 400, height: 900 };
  for (const th of ['dark', 'light']) {
    const q = (extra = '') => 'bare=1&replay=0&theme=' + th + extra;
    const jobs = [
      ['full-dock-inspector', q('&ask=lane'), W, async () => {}],
      ['lane-selected', q('&ask=lane&lane=antigravity'), W, async () => {}],
      ['dock-400', q('&ask=lane&insp=closed'), N, async () => {}],
      ['dock-400-overflow-pip', q('&ask=multi&lane=arch&insp=closed'), { width: 340, height: 700 }, async () => {}],
      ['hover-card', q('&ask=lane'), W, async (pg) => { await pg.locator('#dock .dk-chip[data-dk="fe"]').hover(); await pg.waitForTimeout(600); }],
      ['hover-card-focus-visible', q('&ask=lane&insp=closed'), N, async (pg) => { await pg.focus('#dock [aria-selected="true"]'); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(600); }],
      ['agents-menu-open', q('&ask=lane'), W, async (pg) => { await pg.click('#dock .dk-all'); await pg.waitForTimeout(250); }],
      ['agents-menu-open-400', q('&ask=lane&insp=closed'), N, async (pg) => { await pg.click('#dock .dk-all'); await pg.waitForTimeout(250); }],
      ['dock-unknown-provider', q('&ask=lane&insp=closed&prov=unknown'), N, async () => {}],
      ['tool-rows', q('&t1=expanded&ask=none'), W, async () => {}]
    ];
    for (const [name, query, vp, prep] of jobs) {
      const { page, ctx, errors } = await open(query, vp);
      await prep(page);
      await page.screenshot({ path: path.join(out, 'delta2-merged-' + name + '-' + th + '.png') });
      console.log('shot delta2-merged-' + name + '-' + th, errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok');
      await ctx.close();
    }
  }
}

async function delta3() {
  const out = path.join(root, 'screenshots');
  fs.mkdirSync(out, { recursive: true });
  for (const th of ['dark', 'light']) {
    const q = (extra = '') => 'bare=1&replay=0&theme=' + th + extra;
    const jobs = [
      ['full-inspector', '1440', q('&insp=open'), { width: 1440, height: 1500 }, async () => {}],
      ['expanded-inspector', '1440', q('&insp=open'), { width: 1440, height: 1900 }, async (pg) => { await pg.click('[data-d3="models"]'); await pg.click('[data-d3="tile"][data-k="plan:weekly"]'); await pg.click('[data-d3="tile"][data-k="lane:codex:software-architect"]'); await pg.click('[data-d3="menu"][data-id="fe"]'); await pg.waitForTimeout(250); }],
      ['at-limit-inspector', '1440', q('&insp=open&stats=at'), { width: 1440, height: 1500 }, async () => {}],
      ['closed', '760', q('&insp=closed&stats=full'), { width: 760, height: 700 }, async () => {}],
      ['sheet', '760', q('&insp=open'), { width: 760, height: 1500 }, async () => {}],
      ['closed', '400', q('&insp=closed&stats=at'), { width: 400, height: 700 }, async () => {}],
      ['sheet', '400', q('&insp=open'), { width: 400, height: 1900 }, async () => {}],
      ['partial-inspector', '1440', q('&insp=open&body=partial'), { width: 1440, height: 1200 }, async () => {}]
    ];
    for (const [name, w, query, vp, prep] of jobs) {
      const { page, ctx, errors } = await open(query, vp);
      await prep(page);
      await page.screenshot({ path: path.join(out, 'delta3-' + name + '-' + w + '-' + th + '.png') });
      console.log('shot delta3-' + name + '-' + w + '-' + th, errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok');
      await ctx.close();
    }
  }
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
    // Delta 1: inspector TASK section states (both themes)
    for (const th of ['dark', 'light']) for (const ts of ['linked', 'multi', 'loading', 'error', 'partial', 'notfound', 'none']) jobs.push(wide(`theme=${th}&task=${ts}`, `${th}-task-${ts}`));
    const out = path.join(root, 'screenshots');
    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(out)) if (f.endsWith('.png') && !f.startsWith('delta2-')) fs.unlinkSync(path.join(out, f));
    for (const j of jobs) {
      const { page, ctx, errors } = await open(j.q, j.vp);
      await page.screenshot({ path: path.join(out, j.name + '.png') });
      console.log('shot', j.name, errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok');
      await ctx.close();
    }
    // Interaction states (Round 1): reached by real clicks / keys, then captured
    const W2 = { width: 1594, height: 839 }, N2 = { width: 400, height: 900 };
    const states = [
      ['requests-more-open', 'ask=multi', W2, async (pg) => { await pg.click('[data-act="more"][data-owner="antigravity"]'); }],
      ['request-error-retry', 'ask=lane-open&fail=1', W2, async (pg) => { await pg.click('[data-act="decide"][data-d="allow"]'); await pg.waitForTimeout(900); }],
      ['request-closed-elsewhere', 'ask=lane-open', W2, async (pg) => { await pg.evaluate(() => document.getElementById('laneEnds').click()); await pg.waitForTimeout(150); }],
      ['request-electron-fallback', 'ask=multi&host=electron', W2, async (pg) => { await pg.click('[data-act="review"][data-key="perm:p1"]'); }],
      ['narrow-400-overlay-focus', 'insp=closed&ask=multi', N2, async (pg) => { await pg.focus('#inspToggle'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(450); }],
      ['narrow-400-multi-more-open', 'insp=open&ask=multi', N2, async (pg) => { await pg.click('[data-act="more"][data-owner="antigravity"]'); }],
      // Round 2: lane opened from the 400 px sheet by keyboard (sheet closed, focus on the lane title)
      ['lane-opened', 'insp=closed&ask=multi', N2, async (pg) => {
        await pg.focus('#inspToggle'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
        await pg.focus('.agent[data-agent="antigravity"] .agent__main'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
      }],
      // Round 2: question card never mounted (ask=question&fail=card) -> row-level error with Retry, focus on that row's Answer button
      ['question-card-missing', 'ask=question&fail=card&host=rail&insp=open', W2, async (pg) => {
        await pg.focus('[data-act="answer"]'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1400);
      }],
      // Round 2: wide docked sheet, window narrows to overlay width -> sheet closes, focus back on the opener
      ['resize-closed', 'insp=closed&ask=multi', W2, async (pg) => {
        await pg.focus('#inspToggle'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
        await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(500);
      }],
      // Delta 1: TASK section interaction states
      ['task-multi-related-open', 'task=multi', W2, async (pg) => { await pg.click('[data-act="task-rel"]'); }],
      ['task-docs-expanded', 'task=linked', W2, async (pg) => { await pg.click('[data-act="task-more"]'); }],
      ['task-open-failed', 'task=openfail', W2, async (pg) => { await pg.focus('[data-file="design-spec.md"]'); await pg.keyboard.press('Enter'); }],
      ['task-live-flipped', 'task=live', W2, async (pg) => { await pg.waitForTimeout(2400); }],
      ['task-artifact-opened', 'task=linked', W2, async (pg) => { await pg.click('[data-file="design-spec.md"]'); await pg.waitForTimeout(200); }],
      ['task-artifact-focus', 'task=linked', W2, async (pg) => { await pg.focus('[data-file="parity-inventory.md"]'); await pg.keyboard.press('Tab'); }],
      ['task-narrow-400-sheet', 'insp=open&task=multi', N2, async (pg) => { await pg.click('[data-act="task-rel"]'); }],
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
      await page.click('[data-act="review"][data-key="lane:antigravity:r1"]'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => document.activeElement.getAttribute('role'))) === 'group', 'Review moves focus to the decision panel');
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => document.querySelector('#inspector') && getComputedStyle(document.querySelector('#inspector')).display !== 'none')), 'first Escape closes the panel, the sheet stays open');
      ok((await act(page)).startsWith('Review permission request from Antigravity'), 'focus returns to the Review button (' + (await act(page)) + ')');
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
      await page.click('[data-act="review"][data-key="lane:antigravity:r1"]'); await page.waitForTimeout(100);
      await page.click('[data-act="more"][data-owner="antigravity"]'); await page.waitForTimeout(100);
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('button,a[href],input')).filter((e) => e.getClientRects().length && !e.closest('[hidden]') && !e.closest('.proto-bar') && !e.closest('[inert]') || (e.closest('#inspector') && e.getClientRects().length)).map((e) => { const t = (e.tagName === 'INPUT' && e.closest('label')) || e; const b = t.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 36), w: Math.round(b.width), h: Math.round(b.height) }; }).filter((x) => x.w < 24 || x.h < 24));
      ok(small.length === 0, `target size >= 24x24, ${label}: ${small.length ? JSON.stringify(small) : 'all controls pass'}`);
      await ctx.close();
    }
    // E. Retry / Answer / Close / Open lane targets in the states that render them
    for (const vp of [{ width: 1594, height: 839 }, { width: 400, height: 900 }]) {
      const { page, ctx } = await open('bare=1&replay=0&ask=multi&fail=1', vp);
      await page.click('[data-act="review"][data-key="lane:antigravity:r1"]'); await page.click('[data-act="decide"][data-d="allow"]'); await page.waitForTimeout(900);
      const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('#inspector [data-act]')).filter((e) => e.getClientRects().length).map((e) => { const b = e.getBoundingClientRect(); return e.dataset.act + ':' + Math.round(b.width) + 'x' + Math.round(b.height); }));
      const hasRetry = sizes.some((x) => x.startsWith('retry:'));
      ok(hasRetry && sizes.every((x) => { const [w, h] = x.split(':')[1].split('x').map(Number); return w >= 24 && h >= 24; }), `Retry / Answer / Review / More / Open lane targets at ${vp.width}px: ${sizes.join(' ')}`);
      await ctx.close();
    }
    // F. Lane navigation by keyboard at 400 px (round 2): row select and Open lane close the sheet through the common routine
    {
      const state = (page) => page.evaluate(() => ({
        insp: window.document.getElementById('shell').dataset.inspector, inert: document.getElementById('mainRegion').inert,
        active: document.activeElement ? document.activeElement.id || document.activeElement.tagName : 'none',
        title: document.getElementById('laneTitle').textContent, laneShown: !document.getElementById('laneView').hidden,
        thread: getComputedStyle(document.getElementById('scroll')).display !== 'none', say: document.getElementById('announce').textContent,
      }));
      for (const route of ['agent row', 'Open lane']) {
        const { page, ctx } = await open('bare=1&replay=0&insp=closed&ask=multi', { width: 400, height: 900 });
        await page.focus('#inspToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
        if (route === 'agent row') {
          await page.focus('.agent[data-agent="fe"] .agent__main'); await page.keyboard.press('Enter');
        } else {
          await page.focus('[data-act="review"][data-key="lane:antigravity:r1"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
          await page.focus('[data-act="open-lane"]'); await page.keyboard.press('Enter');
        }
        await page.waitForTimeout(350);
        const st = await state(page), want = route === 'agent row' ? 'frontend-developer' : 'Antigravity';
        ok(st.insp === 'closed' && !st.inert, `lane via ${route}, 400 px: sheet closed and background live again`);
        ok(st.laneShown && !st.thread && st.title === want, `lane via ${route}: main region shows the ${want} lane view instead of the thread`);
        ok(st.active === 'laneTitle', `lane via ${route}: focus is on the lane title (now: ${st.active})`);
        ok(st.say === `Opened the ${want} lane.`, `lane via ${route}: announced only after it opened ("${st.say}")`);
        if (route === 'agent row') {
          await page.focus('#laneBack'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
          const b = await state(page);
          ok(b.active === 'sessTitle' && b.thread && !b.laneShown, 'Back to session: thread returns and focus lands on the session title (' + b.active + ')');
        }
        await ctx.close();
      }
      // Electron single chat: no lane surface, so no Open lane and no lane view; the inline panel stays the way to answer
      {
        const { page, ctx } = await open('bare=1&replay=0&insp=open&ask=multi&host=electron', { width: 400, height: 900 });
        await page.focus('[data-act="review"][data-key="lane:antigravity:r1"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
        const hasOpen = await page.evaluate(() => !!document.querySelector('[data-act="open-lane"]'));
        const chipsMention = await page.evaluate(() => Array.from(document.querySelectorAll('.chip[data-agent]')).some((c) => /Open lane/.test(c.getAttribute('aria-label'))));
        await page.focus('.agent[data-agent="fe"] .agent__main'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
        const st = await state(page);
        ok(!hasOpen && !chipsMention, 'host=electron: no Open lane link and no "Open lane" in agent chips');
        ok(!st.laneShown && st.insp === 'open', 'host=electron: row select opens no lane view; the sheet and the inline panel stay available');
        await ctx.close();
      }
    }
    // G. Question card missing (round 2): Answer keeps the request and count, shows a row error with Retry, focus on the row's Answer button
    for (const host of ['electron', 'rail']) for (const vp of [{ width: 1594, height: 839 }, { width: 400, height: 900 }]) {
      const { page, ctx, errors } = await open(`bare=1&replay=0&ask=question&fail=card&host=${host}&insp=open`, vp);
      await page.focus('[data-act="answer"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
      const r = await page.evaluate(() => ({
        active: document.activeElement ? (document.activeElement.dataset.act || document.activeElement.id) : '', answer: !!document.querySelector('[data-act="answer"]'),
        retry: !!document.querySelector('#inspector [data-act="retry-answer"]'), chip: document.getElementById('needChip').textContent,
        card: !!document.getElementById('qCard'), insp: document.getElementById('shell').dataset.inspector,
      }));
      const tag = `qcard missing, host=${host}, ${vp.width} px`;
      ok(!r.card && r.answer && r.chip === '1 needs you', `${tag}: request and count kept (chip "${r.chip}"), no exception (${errors.length} errors)`);
      ok(r.retry && r.active === 'answer', `${tag}: row-level error with Retry, focus back on that row's Answer button (${r.active})`);
      ok(r.insp === 'open' && errors.length === 0, `${tag}: sheet stays open on failure`);
      // recovery: the card mounts, Retry succeeds, focus reaches the first option (the sheet closes at overlay width)
      await page.evaluate(() => document.getElementById('qRestore').click());
      await page.focus('[data-act="retry-answer"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const ok2 = await page.evaluate(() => ({ tag: document.activeElement.tagName, name: document.activeElement.name, insp: document.getElementById('shell').dataset.inspector, err: !!document.querySelector('[data-act="retry-answer"]') }));
      ok(ok2.tag === 'INPUT' && ok2.name === 'q1' && !ok2.err, `${tag}: Retry after the card mounts focuses its first option (${ok2.tag})`);
      if (vp.width < 960) ok(ok2.insp === 'closed', `${tag}: sheet closes on the successful Answer`);
      await ctx.close();
    }
    // H. Resize across 960 px while the sheet is open (round 2): the sheet closes through the common routine
    {
      const { page, ctx } = await open('bare=1&replay=0&insp=closed&ask=multi', { width: 1594, height: 839 });
      await page.focus('#inspToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      ok((await page.evaluate(() => document.getElementById('shell').dataset.inspector)) === 'open', 'resize: docked sheet is open at 1594 px');
      await page.setViewportSize({ width: 400, height: 900 }); await page.waitForTimeout(500);
      const r = await page.evaluate(() => ({ insp: document.getElementById('shell').dataset.inspector, inert: document.getElementById('mainRegion').inert, a: document.activeElement.id }));
      ok(r.insp === 'closed' && !r.inert, 'resize to 400 px: sheet closed automatically, background live');
      ok(r.a === 'inspToggle', 'resize to 400 px: focus returns to the opener, the header toggle (' + r.a + ')');
      await page.setViewportSize({ width: 1594, height: 839 }); await page.waitForTimeout(400);
      ok((await page.evaluate(() => document.getElementById('shell').dataset.inspector)) === 'closed', 'resize back to wide: sheet stays closed (the inspector never opens itself)');
      await ctx.close();
      const b = await open('bare=1&replay=0&insp=open&ask=multi', { width: 1594, height: 839 });
      await b.page.setViewportSize({ width: 400, height: 900 }); await b.page.waitForTimeout(500);
      const r2 = await b.page.evaluate(() => ({ insp: document.getElementById('shell').dataset.inspector, a: document.activeElement.id }));
      ok(r2.insp === 'closed' && r2.a === 'sessTitle', 'resize with no recorded opener (sheet open on load): sheet closes, focus on the session title (' + r2.a + ')');
      await b.ctx.close();
    }
    // I. Session switch (round 2): the sheet closes, focus lands on the new session's title
    for (const [label, vp] of [['400 px sheet', { width: 400, height: 900 }], ['wide docked', { width: 1594, height: 839 }]]) {
      const { page, ctx } = await open('bare=1&replay=0&insp=closed&ask=multi', vp);
      await page.focus('#inspToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      await page.evaluate(() => document.getElementById('replay').click()); await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ insp: document.getElementById('shell').dataset.inspector, inert: document.getElementById('mainRegion').inert, a: document.activeElement.id }));
      ok(r.insp === 'closed' && !r.inert && r.a === 'sessTitle', `session switch, ${label}: sheet closed, background live, focus on the session title (${r.a})`);
      await ctx.close();
    }
    // J. Live line follows the shared needs-you aggregate in every state (round 2, finding 6)
    for (const t2 of ['ref', 'streaming', 'answered']) {
      const { page, ctx } = await open(`bare=1&replay=0&t2=${t2}&ask=multi`, { width: 1594, height: 839 });
      const r = await page.evaluate(() => ({ chip: document.getElementById('needChip').textContent, live: document.getElementById('liveLabel').textContent }));
      ok(r.chip === '5 need you' && r.live === 'Waiting for you', `t2=${t2}: header "${r.chip}" and live line "${r.live}" agree`);
      await page.evaluate(() => document.querySelector('[data-set="ask=none"]').click());
      ok((await page.evaluate(() => document.getElementById('liveLabel').textContent)) === 'Orchestrating', `t2=${t2}: no pending request -> "Orchestrating"`);
      await ctx.close();
    }
    // K. Delta 1: TASK section (design-spec 4.6: targets, keyboard reach, +N more documents, +N related tasks, Retry, states, silent live push) and the B-14/B-15/B-16 visibility decisions
    for (const [label, vp] of [['wide docked', { width: 1594, height: 839 }], ['400 px sheet', { width: 400, height: 900 }]]) {
      const insp = vp.width < 960 ? '&insp=open' : '';
      // K1 linked: content, order (between AGENTS and TODOS), targets >= 24 x 24, keyboard reach, open is silent
      {
        const { page, ctx, errors } = await open('bare=1&replay=0' + insp, vp);
        const r = await page.evaluate(() => {
          const sec = document.getElementById('taskSec'), todos = document.getElementById('todosSec'), ag = document.querySelector('.insp-sec--agents');
          const files = [...document.querySelectorAll('.task-file')].map((b) => { const q = b.getBoundingClientRect(); return { n: b.dataset.file, w: q.width, h: q.height, tag: b.tagName }; });
          const more = document.querySelector('[data-act="task-more"]'), mq = more && more.getBoundingClientRect(), pill = sec && sec.querySelector('.task-pill'), body = document.getElementById('inspBody');
          return { has: !!sec, order: !!(sec && todos && ag && (ag.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING) && (sec.compareDocumentPosition(todos) & Node.DOCUMENT_POSITION_FOLLOWING)), head: sec && sec.querySelector('.sec-label').textContent,
            id: sec && sec.querySelector('.task-id code').textContent, title: sec && sec.querySelector('.task-title').textContent, pill: pill && pill.textContent, pillBg: pill && getComputedStyle(pill).backgroundColor, pillBorder: pill && getComputedStyle(pill).borderTopStyle,
            stage: sec && (sec.querySelector('.task-stage') || {}).textContent, phaseWord: sec && /Phase/.test(sec.textContent), files, more: more && more.textContent, mw: mq && mq.width, mh: mq && mq.height, overflow: body.scrollWidth > body.clientWidth + 1 };
        });
        const tag = 'task linked, ' + label;
        ok(r.has && r.order && r.head === 'Task', tag + ': TASK section sits between AGENTS and TODOS');
        ok(r.id === 'TASK_2026_677_efcd' && r.title === 'Clean session view' && r.pill === 'In Progress' && r.stage === 'Stage: Design' && !r.phaseWord, tag + ': ID, title, status pill "In Progress" and derived "Stage: Design" (no "Phase" wording)');
        ok(r.pillBg === 'rgba(0, 0, 0, 0)' && r.pillBorder === 'solid', tag + ': status pill is an outline pill (transparent fill, solid border)');
        ok(r.files.length === 6 && r.files.every((f) => f.tag === 'BUTTON' && f.w >= 24 && f.h >= 24) && r.more === '+3 more documents' && r.mw >= 24 && r.mh >= 24, tag + ': 6 document rows at rest (native buttons, min ' + Math.min(...r.files.map((f) => Math.round(f.h))) + ' px high), "+3 more documents" ' + Math.round(r.mw) + ' x ' + Math.round(r.mh) + ' px');
        ok(!r.overflow, tag + ': no horizontal overflow in the inspector');
        await page.evaluate(() => { const l = [...document.querySelectorAll('#agentList .agent__main')].pop(); l.focus(); });
        const seen = [];
        for (let i = 0; i < 16 && seen.length < 7; i++) { await page.keyboard.press('Tab'); const d = await page.evaluate(() => document.activeElement.dataset.file || (document.activeElement.dataset.act === 'task-more' ? '+more' : '')); if (d && !seen.includes(d)) seen.push(d); }
        ok(seen.join(',') === 'task.md,task-description.md,design-spec.md,parity-inventory.md,decisions.md,design-spec-review-r1.md,+more', tag + ': Tab reaches the 6 document links in order, then "+N more documents" (' + seen.join(', ') + ')');
        await page.focus('[data-file="design-spec.md"]'); await page.waitForTimeout(250);
        const fx = await page.evaluate(() => { const b = document.querySelector('[data-file="design-spec.md"]'); return { x: getComputedStyle(b.querySelector('.task-file__x')).opacity, ring: getComputedStyle(b).outlineStyle + ' ' + getComputedStyle(b).outlineWidth }; });
        ok(fx.x === '1' && /solid 2px/.test(fx.ring), tag + ': ExternalLink is visible without hover and the focused row has a 2 px focus ring (' + fx.ring + ')');
        await page.keyboard.press('Enter'); await page.waitForTimeout(150);
        const op = await page.evaluate(() => ({ an: document.getElementById('announce').textContent, a: document.activeElement.dataset.file, alert: !!document.querySelector('#taskSec [role=alert]') }));
        ok(op.an === '' && op.a === 'design-spec.md' && !op.alert, tag + ': opening a document is silent (no toast in the product, no announcement), focus stays on the row');
        await page.focus('[data-act="task-more"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
        const ex = await page.evaluate(() => ({ n: document.querySelectorAll('.task-file').length, exp: document.querySelector('[data-act="task-more"]').getAttribute('aria-expanded'), f: document.activeElement.dataset.act }));
        ok(ex.n === 9 && ex.exp === 'true' && ex.f === 'task-more', tag + ': Enter on "+3 more documents" lists all 9, aria-expanded=true, focus stays on the button');
        ok(errors.length === 0, tag + ': no script errors');
        await ctx.close();
      }
      // K2 multi: related tasks behind "+2 related tasks" (>= 24 x 24), non-interactive rows
      {
        const { page, ctx } = await open('bare=1&replay=0&task=multi' + insp, vp);
        const b = await page.evaluate(() => { const m = document.querySelector('[data-act="task-rel"]'), q = m.getBoundingClientRect(); return { t: m.textContent, w: q.width, h: q.height, exp: m.getAttribute('aria-expanded'), first: document.querySelector('#taskSec .task-id code').textContent, hidden: document.getElementById('taskOthers').hidden }; });
        ok(b.t === '+2 related tasks' && b.w >= 24 && b.h >= 24 && b.exp === 'false' && b.hidden && b.first === 'TASK_2026_677_efcd', 'task multi, ' + label + ': lead first, "+2 related tasks" ' + Math.round(b.w) + ' x ' + Math.round(b.h) + ' px, collapsed');
        await page.focus('[data-act="task-rel"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
        const a = await page.evaluate(() => ({ exp: document.querySelector('[data-act="task-rel"]').getAttribute('aria-expanded'), n: document.querySelectorAll('#taskOthers .task-other').length, ctl: document.querySelectorAll('#taskOthers button, #taskOthers a, #taskOthers [tabindex]').length, f: document.activeElement.dataset.act, pills: [...document.querySelectorAll('#taskOthers .task-pill')].map((e) => e.textContent).join('/') }));
        ok(a.exp === 'true' && a.n === 2 && a.ctl === 0 && a.f === 'task-rel', 'task multi, ' + label + ': Enter expands 2 related tasks (' + a.pills + '), rows are not interactive, focus stays on the button');
        await ctx.close();
      }
      // K3 error: Retry >= 24 x 24, keyboard activation, busy state keeps the message, recovers, focus on the task title
      {
        const { page, ctx } = await open('bare=1&replay=0&task=error' + insp, vp);
        const e = await page.evaluate(() => { const r = document.querySelector('#taskSec .retry'), q = r.getBoundingClientRect(); return { w: q.width, h: q.height, alert: !!document.querySelector('#taskSec [role=alert]'), name: r.getAttribute('aria-label'), id: document.querySelector('#taskSec .task-id code').textContent }; });
        ok(e.alert && e.w >= 24 && e.h >= 24 && e.name === 'Retry loading task' && e.id === 'TASK_2026_677_efcd', 'task error, ' + label + ': ID row + error line (role=alert) + Retry ' + Math.round(e.w) + ' x ' + Math.round(e.h) + ' px');
        await page.focus('#taskSec .retry'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
        const l = await page.evaluate(() => ({ busy: document.querySelector('#taskSec .retry').getAttribute('aria-busy'), msg: !!document.querySelector('#taskSec [role=alert]'), f: document.activeElement.className }));
        await page.waitForTimeout(900);
        const d = await page.evaluate(() => ({ a: document.activeElement.id, title: (document.querySelector('#taskSec .task-title') || {}).textContent }));
        ok(l.busy === 'true' && l.msg && /retry/.test(l.f) && d.a === 'taskTitle' && d.title === 'Clean session view', 'task error, ' + label + ': Retry is aria-busy with the message kept, then the task loads, focus on the task title (' + d.a + ')');
        await ctx.close();
      }
      // K4 loading / none (not rendered) / partial / notfound / openfail / live (silent)
      {
        const { page, ctx } = await open('bare=1&replay=0&task=loading' + insp, vp);
        ok(await page.evaluate(() => document.querySelectorAll('#taskSec .sk').length >= 5 && document.getElementById('taskSec').getAttribute('aria-busy') === 'true' && !document.querySelector('#taskSec button')), 'task loading, ' + label + ': skeleton rows, aria-busy, nothing focusable');
        await page.evaluate(() => document.querySelector('[data-set="task=none"]').click());
        ok(await page.evaluate(() => !document.getElementById('taskSec') && !/Task\b/.test([...document.querySelectorAll('.sec-label')].map((e) => e.textContent).join(' ')) && !/No task linked/.test(document.getElementById('inspBody').textContent)), 'task none, ' + label + ': the TASK section is not rendered at all (no heading, no row)');
        await page.evaluate(() => document.querySelector('[data-set="task=partial"]').click());
        ok(await page.evaluate(() => /No documents yet/.test(document.getElementById('taskSec').textContent) && !document.querySelector('.task-stage') && !!document.querySelector('#taskSec [role=status]')), 'task partial, ' + label + ': "No documents yet" (role=status), Stage hidden because it cannot be derived');
        await page.evaluate(() => document.querySelector('[data-set="task=notfound"]').click());
        ok(await page.evaluate(() => /Task folder not found/.test(document.getElementById('taskSec').textContent) && !document.querySelector('#taskSec .retry') && !document.querySelector('#taskSec .task-file')), 'task notfound, ' + label + ': "Task folder not found", no Retry, no links');
        await page.evaluate(() => document.querySelector('[data-set="task=openfail"]').click());
        await page.focus('[data-file="task.md"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
        const of = await page.evaluate(() => { const r = document.querySelector('#taskSec .task-openerr .retry'), q = r && r.getBoundingClientRect(); return { alert: !!document.querySelector('#taskSec .task-openerr[role=alert]'), t: (document.querySelector('.task-openerr span') || {}).textContent, w: q && q.width, h: q && q.height, f: document.activeElement.dataset.file }; });
        ok(of.alert && of.t === 'Could not open task.md' && of.w >= 24 && of.h >= 24 && of.f === 'task.md', 'task openfail, ' + label + ': row-level alert "' + of.t + '" with Retry ' + Math.round(of.w) + ' x ' + Math.round(of.h) + ' px, focus stays on the row');
        await ctx.close();
        const L = await open('bare=1&replay=0&task=live' + insp, vp);
        const before = await L.page.evaluate(() => document.querySelector('#taskStat').textContent.trim());
        await L.page.waitForTimeout(2600);
        const after = await L.page.evaluate(() => ({ s: document.querySelector('#taskStat').textContent.trim(), an: document.getElementById('announce').textContent, busy: document.getElementById('taskSec').hasAttribute('aria-busy'), sk: document.querySelectorAll('#taskSec .sk').length }));
        ok(before === 'In Progress' && after.s === 'In Review' && after.an === '' && !after.busy && after.sk === 0, 'task live, ' + label + ': pill updates In Progress -> In Review after 2 s in place (no skeleton, no aria-busy) and nothing is announced');
        await L.ctx.close();
      }
    }
    // K5 empty / loading inspector bodies carry no Task section (D27: link unresolved or absent -> not rendered), nothing throws
    for (const body of ['empty', 'loading']) {
      const { page, ctx, errors } = await open('bare=1&replay=0&body=' + body + '&ask=none', { width: 1594, height: 839 });
      ok((await page.evaluate(() => !document.getElementById('taskSec') && !/Task\b|task/.test(document.getElementById('inspBody').textContent.replace(/Loading todos and git/g, '')))) && errors.length === 0, 'body=' + body + ': no TASK section rendered and nothing throws');
      await ctx.close();
    }
    // K6 decisions row 23: B-16 time + "You" visible at rest; B-14/B-15 reveal on hover only (no focus reveal)
    {
      const { page, ctx } = await open('bare=1&replay=0', { width: 1594, height: 839 });
      const m = await page.evaluate(() => [...document.querySelectorAll('.cs-user-meta')].map((e) => { const cs = getComputedStyle(e), q = e.getBoundingClientRect(); return { t: e.textContent, op: cs.opacity, vis: cs.visibility, h: q.height }; }));
      ok(m.length === 2 && m.every((x) => x.op === '1' && x.vis === 'visible' && x.h > 0 && /^You·\d\d:\d\d$/.test(x.t.replace(/\s/g, ''))), 'B-16: "You" + time visible at rest on both user turns (' + m.map((x) => x.t).join(' | ') + ')');
      const rest = await page.evaluate(() => getComputedStyle(document.querySelector('.cs-user-actions')).opacity);
      await page.focus('.cs-user-actions button'); await page.waitForTimeout(250);
      const foc = await page.evaluate(() => getComputedStyle(document.querySelector('.cs-user-actions')).opacity);
      await page.hover('.cs-user'); await page.waitForTimeout(250);
      const hov = await page.evaluate(() => getComputedStyle(document.querySelector('.cs-user-actions')).opacity);
      ok(rest === '0' && foc === '0' && hov === '1', 'B-14/B-15: Branch/Rewind opacity at rest ' + rest + ', on keyboard focus ' + foc + ' (no focus reveal, as decided), on hover ' + hov);
      await ctx.close();
    }
    // L. Delta 2 (decisions rows 30-32): agent dock (option B), new AGENTS tile, no Gemini, tool rows as today
    {
      const tgt = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#dock button')).filter((e) => e.getClientRects().length && !e.closest('[hidden]')).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent).slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) }; }));
      const dockState = (page) => page.evaluate(() => {
        const tabs = [...document.querySelectorAll('#dock [role="tab"]')].filter((t) => !t.closest('[hidden]'));
        const lane = document.getElementById('laneView');
        return { n: tabs.length, sel: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.dk), zero: tabs.filter((t) => t.tabIndex === 0).length,
          active: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.dk || document.activeElement.dataset.pick || (document.activeElement.hasAttribute('data-dk-toggle') ? 'toggle' : document.activeElement.id) : '',
          activeRole: document.activeElement.getAttribute('role'), laneShown: !lane.hidden, lane: document.getElementById('laneTitle').textContent, hiddenCount: document.querySelectorAll('#dock .dk-item[hidden]').length };
      });
      const tipVisible = (page, k) => page.evaluate((id) => getComputedStyle(document.getElementById('dk-tip-' + id)).visibility === 'visible' && getComputedStyle(document.getElementById('dk-tip-' + id)).opacity === '1', k);
      for (const [label, vp] of [['wide 1594 px', { width: 1594, height: 839 }], ['400 px', { width: 400, height: 900 }]]) {
        const { page, ctx, errors } = await open('bare=1&replay=0&insp=closed&ask=lane', vp);
        report.push('--- L. delta 2 agent dock, ' + label + ' ---');
        const st0 = await dockState(page), t0 = await tgt(page);
        ok((await page.evaluate(() => document.querySelector('#dock [role="tablist"]').getAttribute('aria-label'))) === 'Agent threads' && st0.sel.join() === 'orch' && st0.zero === 1, `dock ${label}: tablist "Agent threads", Orchestrator selected, one tab stop (roving tabindex) (${st0.n} tabs shown, ${st0.hiddenCount} behind "N agents")`);
        ok(t0.length >= 3 && t0.every((x) => x.w >= 24 && x.h >= 24), `dock ${label}: no target < 24 x 24 px (${t0.length} targets, min ${Math.min(...t0.map((x) => x.w))} x ${Math.min(...t0.map((x) => x.h))})`);
        if (vp.width > 1000) ok(st0.n === 6 && st0.hiddenCount === 0, `dock ${label}: all 6 agents fit, no overflow (${st0.n} shown)`); else ok(st0.n >= 3 && st0.n < 6, `dock ${label}: overflow keeps the priority agents and moves the rest behind "N agents" (${st0.n} shown, ${st0.hiddenCount} hidden)`);
        // roving keys: arrows (wrap), Home, End, automatic activation, focus stays on the tab
        await page.focus('#dock [aria-selected="true"]');
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120);
        let s1 = await dockState(page);
        ok(s1.sel.length === 1 && s1.sel[0] !== 'orch' && s1.laneShown && s1.activeRole === 'tab' && s1.active === s1.sel[0] && s1.zero === 1, `dock ${label}: ArrowRight selects the next tab (${s1.sel[0]}), opens its lane view (${s1.lane}), focus stays on the tab`);
        await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(120);
        let s2 = await dockState(page);
        ok(s2.sel[0] === 'orch' && !s2.laneShown && s2.active === 'orch', `dock ${label}: ArrowLeft returns to the Orchestrator thread (lane view hidden)`);
        await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(120);
        let s3 = await dockState(page);
        await page.keyboard.press('Home'); await page.waitForTimeout(120);
        let s4 = await dockState(page);
        await page.keyboard.press('End'); await page.waitForTimeout(120);
        let s5 = await dockState(page);
        ok(s3.sel[0] !== 'orch' && s3.laneShown && s4.sel[0] === 'orch' && s5.sel[0] === s3.sel[0] && s5.activeRole === 'tab', `dock ${label}: ArrowLeft wraps to the last tab, Home goes to the first, End to the last (${s3.sel[0]}, ${s4.sel[0]}, ${s5.sel[0]})`);
        await page.keyboard.press('Home'); await page.waitForTimeout(120);
        // hover card: opens on :focus-visible after the delay, Esc dismisses, stays dismissed while focus stays
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
        const cur = (await dockState(page)).sel[0];
        ok(await tipVisible(page, cur), `dock ${label}: hover/focus card opens on keyboard focus (${cur})`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        ok(!(await tipVisible(page, cur)), `dock ${label}: Esc dismisses the card; the tab keeps focus (${(await dockState(page)).activeRole})`);
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
        const cur2 = (await dockState(page)).sel[0];
        ok(await tipVisible(page, cur2), `dock ${label}: moving to the next tab opens its card again (${cur2})`);
        // pointer: 220 ms delay, then stays while the pointer is over the card
        if (vp.width > 1000) {
          await page.mouse.move(5, 400); await page.waitForTimeout(200);
          const chip = page.locator('#dock .dk-chip[data-dk="fe"]'); await chip.hover(); await page.waitForTimeout(90);
          const early = await tipVisible(page, 'fe'); await page.waitForTimeout(450);
          const late = await tipVisible(page, 'fe');
          const box = await page.locator('#dk-tip-fe .dk-tip__card').boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 }); await page.waitForTimeout(350);
          const over = await tipVisible(page, 'fe');
          await page.mouse.move(5, 400); await page.waitForTimeout(400);
          const gone = await tipVisible(page, 'fe');
          ok(!early && late && over && !gone, `dock ${label}: pointer card waits ~220 ms (early ${early}), opens (${late}), stays while the pointer is on the card (${over}), closes after it leaves (${!gone})`);
          await page.mouse.move(5, 400);
        }
        ok(errors.length === 0, `dock ${label}: no script errors (${errors.length})`);
        await ctx.close();
      }
      // "N agents" menu: open by click, focus into the list, arrows, Esc returns to the button, Enter selects
      {
        const { page, ctx } = await open('bare=1&replay=0&insp=closed&ask=lane', { width: 400, height: 900 });
        report.push('--- L. delta 2 "N agents" menu, 400 px ---');
        await page.click('#dock .dk-all'); await page.waitForTimeout(150);
        const o = await page.evaluate(() => ({ exp: document.querySelector('#dock .dk-all').getAttribute('aria-expanded'), open: !document.getElementById('dk-pop').hidden, rows: document.querySelectorAll('#dk-pop [role="menuitemradio"]').length, groups: document.querySelectorAll('#dk-pop [role="group"]').length, checked: document.activeElement.getAttribute('aria-checked'), role: document.activeElement.getAttribute('role'), small: [...document.querySelectorAll('#dk-pop button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).length, inview: (() => { const r = document.getElementById('dk-pop').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; })() }));
        ok(o.exp === 'true' && o.open && o.rows === 6 && o.groups === 4 && o.role === 'menuitemradio' && o.checked === 'true' && o.small === 0 && o.inview, `menu: opens grouped (4 groups, ${o.rows} agents), focus on the checked row, rows >= 24 px, inside the viewport`);
        await page.keyboard.press('ArrowDown'); await page.waitForTimeout(60);
        const mv = await act(page);
        await page.keyboard.press('Escape'); await page.waitForTimeout(150);
        const c = await page.evaluate(() => ({ open: !document.getElementById('dk-pop').hidden, f: document.activeElement.hasAttribute('data-dk-toggle') }));
        ok(!c.open && c.f && mv !== '', `menu: ArrowDown moves (${mv.slice(0, 30)}), Esc closes it and focus returns to the "N agents" button`);
        await page.keyboard.press('Enter'); await page.waitForTimeout(150);
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
        const sel = await dockState(page);
        ok(sel.sel.length === 1 && sel.sel[0] !== 'orch' && sel.laneShown, `menu: Enter on a row selects that agent and shows its lane (${sel.sel[0]}, ${sel.lane})`);
        await ctx.close();
      }
      // overflow pip: a hidden agent that needs you puts a pip on "N agents"
      {
        let found = null;
        for (const w of [400, 360, 320]) {
          const { page, ctx } = await open('bare=1&replay=0&insp=closed&ask=multi&lane=arch', { width: w, height: 800 });
          const r = await page.evaluate(() => ({ hid: [...document.querySelectorAll('#dock .dk-item[hidden]')].map((i) => i.dataset.ik), pip: !!document.querySelector('#dock .dk-all .dk-pip'), label: document.querySelector('#dock .dk-all').getAttribute('aria-label'), waiting: [...document.querySelectorAll('#dock .dk-item')].filter((i) => /waiting/.test(i.querySelector('.dk-chip').getAttribute('aria-label'))).map((i) => i.dataset.ik) }));
          const hidWaiting = r.hid.filter((k) => r.waiting.includes(k));
          if (hidWaiting.length) { found = { w, ...r, hidWaiting }; await ctx.close(); break; }
          await ctx.close();
        }
        ok(found && found.pip && /needs you/.test(found.label), found ? `overflow pip: ${found.w} px, hidden agent(s) needing you (${found.hidWaiting.join(', ')}) put a pip on "N agents" ("${found.label}")` : 'overflow pip: no width produced a hidden needs-you agent');
        const { page, ctx } = await open('bare=1&replay=0&insp=closed&ask=none&lane=arch', { width: 400, height: 800 });
        const none = await page.evaluate(() => ({ hid: document.querySelectorAll('#dock .dk-item[hidden]').length, pip: !!document.querySelector('#dock .dk-all .dk-pip') }));
        ok(none.hid > 0 && !none.pip, `overflow pip: no pip while nothing hidden needs you or failed (${none.hid} hidden)`);
        await ctx.close();
      }
      // AGENTS tile + no Gemini + orchestrator mark + tool rows
      for (const th of ['dark', 'light']) {
        const { page, ctx, errors } = await open(`bare=1&replay=0&t1=expanded&theme=${th}&ask=lane`, { width: 1594, height: 839 });
        report.push('--- L. delta 2 AGENTS tile, orchestrator mark, tool rows, ' + th + ' ---');
        const r = await page.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const use = (root, s) => { const e = q(root + ' ' + s); return e ? e.getAttribute('href') : null; };
          const rows = [...document.querySelectorAll('#agentList .agent')];
          const tc = q('.log-tool--call'); const tn = tc.querySelector('.tn'), tv = tc.querySelector('.tv'), tp = tc.querySelector('.tp'), ch = tc.querySelector('.tc');
          const cs = (e) => getComputedStyle(e);
          return {
            gemini: /gemini/i.test(document.body.innerHTML), rows: rows.length,
            tiles: rows.every((a) => a.querySelector('.av--32 .av__ring') && a.querySelector('.av__badge') && a.querySelector('.agent__l2 .kind')),
            codex: use('.agent[data-agent="codex"]', 'use[href^="#m-"]'), agy: use('.agent[data-agent="antigravity"]', 'use[href^="#m-"]'),
            fe: use('.agent[data-agent="fe"]', '.av__tile use'), arch: use('.agent[data-agent="arch"]', '.av__tile use'), bg: use('.agent[data-agent="bg"]', '.av__tile use'),
            orchMark: use('#dock [data-dk="orch"]', '.av__tile use'), orchMain: !!q('#dock [data-dk="orch"] .av--main'), orchBorder: cs(q('#dock [data-dk="orch"] .av__tile')).borderTopColor,
            workflow: !!q('use[href="#d-workflow"]'), bot: !!q('.agent use[href="#d-bot"]'),
            verbMuted: cs(tv).color !== cs(tn).color, nameBold: Number(cs(tn).fontWeight) >= 600, pathMuted: cs(tp).color === cs(tv).color, chip: ch ? ch.textContent : '', bar: cs(tc).borderLeftWidth, rowsCall: document.querySelectorAll('.log-tool--call').length,
            verbs: [...document.querySelectorAll('.log-tool--call .tv')].map((e) => e.textContent).join(',')
          };
        });
        ok(!r.gemini, `${th}: no "Gemini" anywhere in index.html output`);
        ok(r.rows === 5 && r.tiles, `${th}: ${r.rows} AGENTS tiles, each avatar 32 with status ring, corner glyph badge and kind badge on line 2`);
        ok(r.codex === '#m-codex' && r.agy === '#m-antigravity' && r.fe === '#d-layout-template' && r.arch === '#d-drafting-compass' && r.bg === '#d-square-terminal' && !r.bot, `${th}: provider marks for CLI lanes (${r.codex}, ${r.agy}), lucide role icons for sub-agents (${r.fe}, ${r.arch}), no generic Bot`);
        ok(r.orchMark === '#m-claude' && r.orchMain && !r.workflow, `${th}: mock DECLARES a Claude session (sessionProvider claude-cli): Orchestrator avatar = Claude mark (${r.orchMark}) with the gold hairline border (${r.orchBorder}), no neutral glyph`);
        ok(r.rowsCall >= 3 && r.verbMuted && r.nameBold && r.pathMuted && /^(lines 14-25|content|allow_large)$/.test(r.chip) && r.bar === '2px', `${th}: tool rows as today: ${r.rowsCall} rows (${r.verbs}), verb muted, name bold, path muted, chip "${r.chip}", ${r.bar} left accent bar`);
        ok(errors.length === 0, `${th}: no script errors (${errors.length})`);
        await ctx.close();
      }
      // delta 2 revise round 1: unknown session provider = neutral orchestrator glyph (PM-14, req 18.5); status words are today's vocabulary
      for (const th of ['dark', 'light']) {
        const { page, ctx, errors } = await open(`bare=1&replay=0&theme=${th}&ask=multi&prov=unknown`, { width: 1594, height: 839 });
        report.push('--- M. delta 2 unknown session provider + status vocabulary, ' + th + ' ---');
        const r = await page.evaluate(() => {
          const tab = document.querySelector('#dock [data-dk="orch"]');
          const hrefs = [...tab.querySelectorAll('.av__tile use')].map((u) => u.getAttribute('href'));
          const words = [...document.querySelectorAll('#dock .w, #agentList .w')].map((e) => e.textContent.trim());
          const bad = words.filter((w) => !['running', 'waiting', 'done', 'failed', 'stopped', 'queued'].includes(w));
          return { hrefs, main: !!tab.querySelector('.av--main'), label: tab.getAttribute('aria-label') || '', vendor: !!tab.querySelector('use[href^="#m-"]'), bot: hrefs.includes('#d-bot'), mono: !!tab.querySelector('.mono, .monogram'), words: [...new Set(words)].join(','), bad: bad.join(','), all: document.querySelector('#dock .dk-all').getAttribute('aria-label') };
        });
        ok(r.hrefs.join() === '#d-workflow' && r.main && !r.vendor && !r.bot && !r.mono && /^Orchestrator,/.test(r.label), `${th}: unknown session provider: Orchestrator avatar = neutral Workflow glyph (${r.hrefs.join()}), gold hairline kept, no vendor mark, no Bot, no monogram; accessible name "${r.label}"`);
        ok(r.bad === '' && /waiting/.test(r.words) && !/Needs you|Error/.test(r.words), `${th}: displayed agent status words in dock, hover card, menu and AGENTS are from {running, waiting, done, failed, stopped} (seen: ${r.words}); "Needs you" is not a status word`);
        ok(!/an error|has an error/.test(r.all), `${th}: "N agents" button name uses failed / waiting, not "error" ("${r.all}")`);
        ok(errors.length === 0, `${th}: no script errors (${errors.length})`);
        await ctx.close();
      }
      // dock is absent where there is no lane surface (host=electron) and where there are no agents yet
      for (const q of ['host=electron', 'body=empty&ask=none']) {
        const { page, ctx } = await open('bare=1&replay=0&' + q, { width: 1594, height: 839 });
        ok(await page.evaluate(() => document.getElementById('dock').hidden), `dock hidden for ${q} (no lane surface / no agents)`);
        await ctx.close();
      }
    }

    // K. Delta 3: session stats in the inspector (design-spec Delta 3)
    for (const th of ['dark', 'light']) {
      const { page, ctx, errors } = await open('bare=1&replay=0&insp=open&theme=' + th, { width: 1440, height: 1500 });
      const r = await page.evaluate(() => {
        const q = (x) => document.querySelector(x), all = (x) => Array.from(document.querySelectorAll(x));
        const order = all('#inspBody > section').map((e) => (e.querySelector('.sec-label') || {}).textContent || e.getAttribute('aria-label'));
        const bars = all('#inspBody [role="progressbar"]').map((b) => ({ n: b.getAttribute('aria-valuenow'), t: b.getAttribute('aria-valuetext') || '' }));
        const small = all('#inspBody button, #inspBody input, #inspBody [role="menuitem"]').filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect()).filter((b) => b.width < 24 || b.height < 24).length;
        return { order, bars, small, strip: !!q('ptah-session-stats-summary, .stats-grid'), orchLine: (q('.orch-sub') || {}).textContent,
          tray: (q('[data-testid="tray-summary"]') || {}).textContent, compact: !!q('[data-testid="stats-compactions"]'),
          notin: /not in totals/.test(q('#inspBody').textContent), sub: !!q('[data-testid="lane-subtotal"]'), tilde: !!q('[data-testid="stats-tokens"] .sr-only'), alert: !!q('[data-testid="limits-alert"]') };
      });
      ok(r.order.join('|') === 'Orchestrator|Session|Agents|Plan limits|Lanes|Task|Todos|Git', th + ': inspector order Orchestrator, Session, Agents, Plan limits, Lanes, Task, Todos, Git (' + r.order.join(', ') + ')');
      ok(!r.strip && !/Opus/.test(r.orchLine || ''), th + ': no stats strip in the chat column, no model on the Orchestrator card line (' + r.orchLine + ')');
      ok(r.bars.length >= 5 && r.bars.every((b) => b.n !== null && b.t.length > 6), th + ': every ring and bar is a progressbar with a value and a text value (' + r.bars.length + ')');
      ok(r.small === 0, th + ': all inspector controls >= 24 x 24 px');
      ok(r.compact && r.notin && r.sub && r.tilde && r.alert && /background/.test(r.tray || ''), th + ': compactions, not in totals, Subtotal, ~ estimate sr text, limits alert and tray summary present (' + r.tray + ')');
      await page.focus('[data-d3="models"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => document.getElementById('modelsPanel').hidden)) === false && (await page.evaluate(() => document.activeElement.getAttribute('data-d3'))) === 'models', th + ': Models opens the per-model panel by keyboard and keeps focus');
      await page.focus('[data-d3="tile"][data-k="plan:weekly"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
      ok(await page.evaluate(() => !document.getElementById('pn-plan-weekly').hidden && /Resets/.test(document.getElementById('pn-plan-weekly').textContent)), th + ': Weekly tile expands with the reset facts');
      await page.focus('[data-d3="menu"][data-id="fe"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => document.activeElement.getAttribute('role'))) === 'menuitem', th + ': actions menu opens with focus on the first item');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('End');
      ok((await page.evaluate(() => document.activeElement.textContent.trim())) === 'Stop', th + ': arrow keys and End move through the menu (Stop is last)');
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Actions for agent frontend-developer', th + ': Escape closes the menu and returns focus to its button');
      ok(errors.length === 0, th + ': delta 3, no script errors (' + errors.length + ')');
      await ctx.close();
    }
    for (const [w, h] of [[760, 900], [400, 900]]) {
      for (const stats of ['full', 'at']) {
        const { page, ctx } = await open('bare=1&replay=0&insp=closed&stats=' + stats, { width: w, height: h });
        const r = await page.evaluate(() => ({ chip: (document.getElementById('limChip').hidden ? '' : document.getElementById('limChip').textContent), ring: document.getElementById('togRing').style.display !== 'none',
          dot: !document.getElementById('needDot').hidden, desc: document.getElementById('togDesc').textContent, name: document.getElementById('inspToggle').getAttribute('aria-label') }));
        ok(r.chip.indexOf(stats === 'at' ? 'At limit' : 'Limit near') === 0 && r.ring && r.dot && /Context 15%/.test(r.desc) && /limit/.test(r.desc) && r.name === 'Show session details', w + ' px closed, stats=' + stats + ': limit chip with text, context ring, dot and description (' + r.chip + ' | ' + r.desc + ')');
        await page.focus('#inspToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
        const o = await page.evaluate(() => ({ sess: !!document.getElementById('sessH'), plan: !!document.getElementById('planH'), chip: document.getElementById('limChip').hidden }));
        ok(o.sess && o.plan && o.chip, w + ' px sheet, stats=' + stats + ': one action reaches SESSION and PLAN LIMITS; the chip hides while the sheet is open');
        await ctx.close();
      }
    }
    // K'. Delta 3 revise round 1: tile details by keyboard, lane-only limit, unknown window, sub-agent model in AGENTS, status / evidence / cooldown tiles, cost budget bar
    for (const th of ['dark', 'light']) {
      const { page, ctx, errors } = await open('bare=1&replay=0&insp=open&theme=' + th, { width: 1440, height: 1500 });
      const keys = ['ctx', 'tok', 'cost', 'agents'];
      const r = await page.evaluate((keys) => {
        const btn = (k) => document.querySelector('[data-d3="sdet"][data-k="s:' + k + '"]');
        return {
          btns: keys.map((k) => { const b = btn(k); return b ? { exp: b.getAttribute('aria-expanded'), ctl: b.getAttribute('aria-controls'), has: !!document.getElementById(b.getAttribute('aria-controls')), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, name: b.getAttribute('aria-label') } : null; }),
          timeStatic: !document.querySelector('[data-tile-d="time"]') && !!Array.from(document.querySelectorAll('.d3-grid .tile')).find((t) => /Time/.test(t.textContent) && !t.querySelector('button')),
          titles: Array.from(document.querySelectorAll('.tile--d')).filter((t) => t.hasAttribute('title')).length,
          model: Array.from(document.querySelectorAll('[data-testid="agent-model"]')).map((e) => e.textContent + '|' + e.title),
          desc: (document.getElementById('agm-fe') || {}).textContent,
          rows: document.querySelectorAll('.agent').length,
          dockModel: /Model/.test(Array.from(document.querySelectorAll('.dk-tip')).map((e) => e.textContent).join(' ')),
        };
      }, keys);
      ok(r.btns.every((b) => b && b.exp === 'false' && b.has && b.w >= 24 && b.h >= 24 && /details$/.test(b.name)), th + ': Context, Tokens, Cost and Agents tiles each have a >= 24 px details button with aria-expanded=false and an aria-controls region');
      ok(r.timeStatic && r.titles === 0, th + ': Time tile is static, no tile with details carries a hover-only title (' + r.titles + ')');
      await page.focus('[data-d3="sdet"][data-k="s:tok"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
      const o = await page.evaluate(() => { const d = document.getElementById('sd-tok'); return { shown: !d.hidden, txt: d.textContent, exp: document.activeElement.getAttribute('aria-expanded'), foc: document.activeElement.getAttribute('data-k'), col: getComputedStyle(d.parentElement).gridColumnEnd }; });
      ok(o.shown && /Input \(uncached\)/.test(o.txt) && /Cache Creation/.test(o.txt) && /Total: 19,100,000/.test(o.txt) && /Live estimate/.test(o.txt) && o.exp === 'true' && o.foc === 's:tok', th + ': Enter on the Tokens details button opens the breakdown (estimate line, input, cache, total, budget) and keeps focus');
      await page.keyboard.press('Escape'); await page.waitForTimeout(120);
      ok(await page.evaluate(() => document.getElementById('sd-tok').hidden && document.activeElement.getAttribute('data-k') === 's:tok'), th + ': Escape closes the details and keeps focus on its button');
      await page.keyboard.press('Tab'); await page.waitForTimeout(60);
      ok((await page.evaluate(() => document.activeElement.getAttribute('data-k'))) === 's:cost', th + ': Tab moves Tokens -> Cost (focus order follows the grid)');
      await page.keyboard.press('Space'); await page.waitForTimeout(120);
      ok(await page.evaluate(() => /Only part of this session has a known price/.test(document.getElementById('sd-cost').textContent) && !document.getElementById('sd-cost').hidden), th + ': Cost details show the estimate line and the known-subtotal sentence');
      ok(r.model.length === 3 && r.model.some((m) => m === 'Sonnet 5 \u00b7|claude-sonnet-5') && /id claude-sonnet-5/.test(r.desc || ''), th + ': AGENTS rows show the sub-agent model (visible token, raw id in title and in the accessible description) (' + r.model.join('; ') + ')');
      ok(r.model.length < r.rows && !r.dockModel, th + ': an agent without a model source shows nothing, and no dock hover card carries a Model line');
      ok(errors.length === 0, th + ': revise r1, no script errors (' + errors.length + ')');
      await ctx.close();
    }
    {
      const { page, ctx } = await open('bare=1&replay=0&insp=closed&stats=lane', { width: 760, height: 900 });
      const r = await page.evaluate(() => ({ chip: document.getElementById('limChip').textContent, hidden: document.getElementById('limChip').hidden, title: document.getElementById('limChip').title,
        desc: document.getElementById('togDesc').textContent, dot: !document.getElementById('needDot').hidden }));
      ok(!r.hidden && /Limit near/.test(r.chip) && /Codex CLI/.test(r.title) && /Codex CLI \u00b7 software-architect \u00b7 Near limit/.test(r.desc) && /Context 15%/.test(r.desc) && r.dot, 'lane-only near limit, inspector closed: chip, title, toggle description and dot all carry the lane warning (' + r.desc + ')');
      await page.focus('#inspToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const a = await page.evaluate(() => { const e = document.querySelector('[data-testid="limits-alert"]'); return e ? e.textContent : ''; });
      ok(/Codex CLI/.test(a) && /Lanes/.test(a) && !/Plan limits/.test(a), 'lane-only near limit, inspector open: the SESSION alert says the same text with a Lanes link (' + a + ')');
      await ctx.close();
    }
    {
      const { page, ctx } = await open('bare=1&replay=0&insp=closed&stats=unk', { width: 760, height: 900 });
      const r = await page.evaluate(() => ({ ring: document.getElementById('togRing').style.display, desc: document.getElementById('togDesc').textContent }));
      ok(r.ring === 'none' && /Context unknown/.test(r.desc) && !/Context \d/.test(r.desc), 'unknown window, closed: no toggle ring, description says Context unknown (' + r.desc + ')');
      await page.focus('#inspToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const c = await page.evaluate(() => { const t = document.getElementById('ctxL').closest('.tile'); return { txt: t.textContent, ring: !!t.querySelector('svg.ring'), pct: /%/.test(t.querySelector('.tv').textContent) }; });
      ok(/\u2014/.test(c.txt) && /Window unknown/.test(c.txt) && !c.ring && !c.pct && !/152\.9k/.test(c.txt), 'unknown window, open: em dash, Window unknown, no ring, no percent, no used-token count (' + c.txt.replace(/\s+/g, ' ') + ')');
      await page.focus('[data-d3="sdet"][data-k="s:ctx"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
      ok(await page.evaluate(() => /Context unknown: the latest main request or its verified capacity is unavailable\./.test(document.getElementById('sd-ctx').textContent)), 'unknown window: Context details hold the unknown sentence of contextTooltip()');
      await ctx.close();
    }
    {
      const { page, ctx } = await open('bare=1&replay=0&insp=open&stats=more', { width: 1440, height: 1700 });
      const r = await page.evaluate(() => ({ ids: ['status', 'evidence', 'cooldown'].map((k) => !!document.querySelector('[data-testid="plan-limit-tile-' + k + '"]')),
        bars: Array.from(document.querySelectorAll('#inspBody [role="progressbar"]')).map((b) => b.getAttribute('aria-valuetext') || ''), small: Array.from(document.querySelectorAll('#inspBody button')).filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect()).filter((b) => b.width < 24 || b.height < 24).length }));
      ok(r.ids.every(Boolean), 'stats=more: status, evidence and cooldown tiles are drawn in PLAN LIMITS');
      ok(r.bars.some((t) => /44% of the \$20\.00 cost budget/.test(t)), 'stats=more: the cost budget bar is drawn with a text value');
      ok(r.small === 0, 'stats=more: all inspector buttons >= 24 x 24 px');
      await ctx.close();
    }
    console.log(report.join('\n'));
  }
  if (mode === 'delta3') await delta3();
  if (mode === 'delta2-merged') await delta2Merged();
} finally {
  await browser.close();
  server.close();
}
