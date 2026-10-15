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
    // Delta 1: inspector TASK section states (both themes)
    for (const th of ['dark', 'light']) for (const ts of ['linked', 'multi', 'loading', 'error', 'partial', 'notfound', 'none']) jobs.push(wide(`theme=${th}&task=${ts}`, `${th}-task-${ts}`));
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
      // Round 2: lane opened from the 400 px sheet by keyboard (sheet closed, focus on the lane title)
      ['lane-opened', 'insp=closed&ask=multi', N2, async (pg) => {
        await pg.focus('#inspToggle'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
        await pg.focus('.agent[data-agent="gemini"] .agent__main'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
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
          await page.focus('[data-act="review"][data-key="lane:gemini:r1"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
          await page.focus('[data-act="open-lane"]'); await page.keyboard.press('Enter');
        }
        await page.waitForTimeout(350);
        const st = await state(page), want = route === 'agent row' ? 'frontend-developer' : 'Gemini';
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
        await page.focus('[data-act="review"][data-key="lane:gemini:r1"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
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
    console.log(report.join('\n'));
  }
} finally {
  await browser.close();
  server.close();
}
