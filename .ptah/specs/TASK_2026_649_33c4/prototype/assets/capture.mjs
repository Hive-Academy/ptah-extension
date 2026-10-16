// Prototype capture + verification tool (not product code). Needs Playwright from the worktree's node_modules.
//   node capture.mjs shots [name-filter]  -> refreshes ../screenshots/*.png
//   node capture.mjs checks               -> real-keyboard checks (dialog trap/Escape/focus return, sheet Escape, inert, overflow, target sizes)
// Serves the prototype folder on 127.0.0.1 (random port) and stops the server when done. Fonts fall back offline.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pw = process.env.PLAYWRIGHT_ENTRY || path.resolve(root, '../../../../node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pw).href);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const mode = process.argv[2] || 'shots';
const browser = await chromium.launch();
const W = { width: 1280, height: 820 }, N = { width: 400, height: 860 }, N360 = { width: 360, height: 760 }, H = { width: 1100, height: 760 };

async function open(file, query, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/${file}?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-ready="1"], .hub', { timeout: 5000 });
  await page.waitForTimeout(400);
  return { page, ctx, errors };
}
const out = path.join(root, 'screenshots');
fs.mkdirSync(out, { recursive: true });

async function shots() {
  const jobs = [];
  const j = (name, file, q, vp, opt = {}) => jobs.push({ name, file, q, vp, opt });
  const TALL = { width: 1280, height: 1120 };
  for (const th of ['dark', 'light']) {
    const t = `theme=${th}`;
    j(`${th}-configure-building-wide`, 'index.html', `${t}&chat=streaming&apply=partial`, W);
    j(`${th}-configure-ready-wide`, 'index.html', `${t}&chat=idle&apply=ready`, W);
    j(`${th}-configure-applied-wide`, 'index.html', `${t}&chat=idle&apply=applied&files=all`, TALL);
    j(`${th}-newproject-stack-profile-wide`, 'index.html', `${t}&kind=newproject&chat=ask&apply=partial&stack=${th === 'dark' ? 'warn' : 'ok'}`, W);
    j(`${th}-leave-dialog-start-over`, 'index.html', `${t}&chat=streaming&apply=ready&dlg=start-over.running&draft=${th === 'dark' ? 1 : 0}`, W);
    j(`${th}-narrow-400-closed-peek`, 'index.html', `${t}&chat=idle&apply=ready&sb=closed`, N);
    j(`${th}-narrow-400-sheet-open`, 'index.html', `${t}&chat=idle&apply=ready&sb=open`, N);
    j(`${th}-hub-resume-draft`, 'hub.html', `${t}&hub=draft`, H);
  }
  j('dark-configure-apply-error-wide', 'index.html', 'theme=dark&chat=idle&apply=error', W);
  j('dark-configure-applying-wide', 'index.html', 'theme=dark&chat=idle&apply=applying', W);
  j('dark-configure-apply-blocked-wide', 'index.html', 'theme=dark&chat=streaming&apply=blocked', W);
  j('dark-configure-applied-health-issues', 'index.html', 'theme=dark&chat=idle&apply=applied&health=issues', TALL);
  j('dark-configure-pin-badge-wide', 'index.html', 'theme=dark&chat=idle&apply=ready&pin=1', W);
  j('dark-configure-empty-wide', 'index.html', 'theme=dark&chat=empty&apply=none&empty=1', W);
  j('dark-configure-init-loading', 'index.html', 'theme=dark&chat=empty&apply=none&init=loading', W);
  j('dark-configure-init-error', 'index.html', 'theme=dark&chat=idle&apply=none&init=error&empty=1', W);
  j('dark-configure-launch-error', 'index.html', 'theme=dark&chat=empty&apply=none&empty=1&launch=err', W);
  j('dark-configure-hydrating', 'index.html', 'theme=dark&chat=idle&apply=none&hydr=loading', W);
  j('light-configure-proposal-unavailable', 'index.html', 'theme=light&chat=idle&apply=none&hydr=unavailable', W);
  j('dark-configure-proposal-restore-failed', 'index.html', 'theme=dark&chat=idle&apply=none&hydr=failed', W);
  j('dark-configure-sidebar-closed-ready-dot', 'index.html', 'theme=dark&chat=idle&apply=ready&sb=closed', W);
  j('dark-leave-dialog-save-pending', 'index.html', 'theme=dark&chat=streaming&apply=none&empty=1&dlg=start-over.pending', W);
  j('dark-leave-dialog-saving', 'index.html', 'theme=dark&chat=idle&apply=ready&dlg=start-over.busy', W);
  j('light-leave-dialog-save-failed', 'index.html', 'theme=light&chat=idle&apply=ready&dlg=start-over.error', W);
  j('dark-leave-dialog-new-project-from-hub', 'hub.html', 'theme=dark&hub=conflict', H);
  j('light-leave-dialog-resume-from-hub', 'hub.html', 'theme=light&hub=resumeconflict', H);
  j('dark-hub-new-project-resume', 'hub.html', 'theme=dark&hub=resume', H);
  j('dark-hub-delete-draft-confirm', 'hub.html', 'theme=dark&hub=delete', H);
  j('dark-page-session-missing', 'index.html', 'theme=dark&page=missing', W);
  j('dark-page-wrong-kind', 'index.html', 'theme=dark&page=wrongkind', W);
  j('dark-newproject-stack-unavailable', 'index.html', 'theme=dark&kind=newproject&chat=idle&apply=partial&hydr=stackgone', W);
  j('dark-configure-draft-resumed', 'index.html', 'theme=dark&chat=idle&apply=ready&notice=resumed', W);
  j('dark-hub-draft-session-missing', 'hub.html', 'theme=dark&hub=draftmissing', H);
  j('dark-hub-open-failed', 'hub.html', 'theme=dark&hub=openfailed', H);
  j('dark-hub-relay-cancelled', 'hub.html', 'theme=dark&hub=relay', H);
  j('dark-hub-abort-warning', 'hub.html', 'theme=dark&hub=abortwarn', H);
  j('dark-narrow-400-needs-answer', 'index.html', 'theme=dark&kind=newproject&chat=ask&apply=partial&sb=closed', N);
  j('dark-narrow-360-sheet-applied', 'index.html', 'theme=dark&chat=idle&apply=applied&sb=open', N360);
  j('dark-narrow-400-leave-dialog', 'index.html', 'theme=dark&chat=streaming&apply=ready&sb=closed&dlg=start-over.running&draft=1', N);
  j('dark-narrow-400-newproject-sheet', 'index.html', 'theme=dark&kind=newproject&chat=idle&apply=partial&sb=open&stack=warn', N);
  const SB = { width: 1280, height: 900 }; // wide container so the sidebar renders in its docked (>= 720 px) layout; the shot is clipped to the sidebar box
  j('dark-sidebar-full-configure-ai-helpers', 'index.html', 'theme=dark&chat=idle&apply=ready&ai=mixed&sess=open&aside=full', SB, { full: true });
  j('light-sidebar-full-configure-ai-helpers', 'index.html', 'theme=light&chat=idle&apply=ready&ai=mixed&sess=open&aside=full', SB, { full: true });
  j('dark-sidebar-full-newproject-stack', 'index.html', 'theme=dark&kind=newproject&chat=idle&apply=partial&stack=warn&ai=nopersona&aside=full', SB, { full: true });
  j('dark-sidebar-full-presets-save-form', 'index.html', 'theme=dark&chat=idle&apply=none&preset=open&ai=doc&aside=full', SB, { full: true });
  j('light-sidebar-full-presets-saved', 'index.html', 'theme=light&chat=idle&apply=partial&preset=saved&aside=full', SB, { full: true });
  j('dark-sidebar-full-preset-loaded', 'index.html', 'theme=dark&chat=idle&apply=partial&preset=loaded&aside=full', SB, { full: true });
  const only = process.argv[3];
  let bad = 0;
  for (const { name, file, q, vp, opt } of jobs) {
    if (only && !name.includes(only)) continue;
    const { page, ctx, errors } = await open(file, q, vp);
    if (opt.full) {
      const h = await page.evaluate(() => document.querySelector('.sb').scrollHeight);
      const hh = Math.min(h + 2, 4000);
      await page.setViewportSize({ width: vp.width, height: hh });
      await page.waitForTimeout(150);
      const box = await page.evaluate((hh) => { const r = document.querySelector('.sb-wrap').getBoundingClientRect(); return { x: Math.floor(r.x), y: 0, width: Math.ceil(r.width), height: hh }; }, hh);
      await page.screenshot({ path: path.join(out, name + '.png'), clip: box });
    } else await page.screenshot({ path: path.join(out, name + '.png') });
    if (errors.length) { bad++; console.log('ERR', name, errors.join(' | ')); } else console.log('ok ', name);
    await ctx.close();
  }
  console.log(bad ? `${bad} page(s) with console errors` : 'no console errors');
}

async function checks() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); };
  {
    const { page, ctx } = await open('index.html', 'theme=dark&chat=streaming&apply=ready', W);
    await page.focus('#start-over'); await page.keyboard.press('Enter');
    ok(await page.evaluate(() => !!document.querySelector('.dlg[role=dialog][aria-modal=true][aria-labelledby][aria-describedby]')), 'dialog has role=dialog, aria-modal, aria-labelledby, aria-describedby');
    ok(await page.evaluate(() => document.activeElement.id === 'dlg-cancel'), 'initial focus is Cancel (least destructive)');
    const seq = [];
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => document.activeElement.textContent.trim())); }
    ok(new Set(seq).size === 3 && seq[0] === 'Discard' && seq[2] === 'Cancel', `Tab cycles inside the dialog only: ${seq.join(' > ')}`);
    await page.focus('#dlg-cancel'); await page.keyboard.press('Shift+Tab');
    ok(await page.evaluate(() => document.activeElement.textContent.includes('Save as draft')), 'Shift+Tab from Cancel wraps to Save as draft');
    ok(await page.evaluate(() => document.querySelector('.body').inert && document.querySelector('.hdr').inert), 'header and page content are inert while the dialog is open');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => !document.querySelector('.dlg')), 'Escape closes the dialog (= Cancel)');
    ok(await page.evaluate(() => document.activeElement.id === 'start-over'), 'focus returns to the Start over trigger');
    await ctx.close();
  }
  {
    const { page, ctx } = await open('index.html', 'theme=dark&chat=idle&apply=ready&sb=closed', N);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '400 px closed: no horizontal scroll');
    await page.focus('#peek'); await page.keyboard.press('Enter');
    ok(await page.evaluate(() => document.querySelector('.page').dataset.sb === 'open'), 'Enter on the peek bar opens the sheet');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('sb-scroll').scrollWidth <= document.getElementById('sb-scroll').clientWidth), '400 px sheet open: no horizontal scroll (page and sheet)');
    ok(await page.evaluate(() => document.getElementById('chatcol').inert), 'covered chat column is inert while the sheet is open');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => document.querySelector('.page').dataset.sb === 'closed' && document.activeElement.id === 'peek'), 'Escape closes the sheet and returns focus to the peek bar');
    ok(await page.evaluate(() => !document.getElementById('chatcol').inert), 'chat column is interactive again');
    await ctx.close();
  }
  {
    // Dialog opened over the open sheet: trap in the dialog, derived inert restored, focus returns to the trigger.
    const { page, ctx } = await open('index.html', 'theme=dark&chat=idle&apply=ready&sb=open', N);
    await page.focus('#start-over'); await page.keyboard.press('Enter');
    ok(await page.evaluate(() => document.activeElement.id === 'dlg-cancel' && document.querySelector('.body').inert && document.querySelector('.peek').inert && document.querySelector('.hdr').inert), 'dialog over the sheet: focus on Cancel, header, peek bar and sheet inert');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
    ok(await page.evaluate(() => !!document.activeElement.closest('.dlg')), 'dialog over the sheet: Tab never leaves the dialog');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => document.getElementById('chatcol').inert && !document.querySelector('.body').inert && !document.querySelector('.peek').inert), 'dialog closed with the sheet still open: chat column stays inert, sheet and peek bar active again');
    ok(await page.evaluate(() => document.activeElement.id === 'start-over'), 'dialog over the sheet: focus returns to the Start over trigger');
    await page.focus('#peek'); await page.keyboard.press('Enter');
    ok(await page.evaluate(() => document.querySelector('.page').dataset.sb === 'closed' && document.activeElement.id === 'peek' && !document.getElementById('chatcol').inert), 'peek bar closes the sheet, focus stays on the peek bar, chat interactive');
    // Focus inside the sheet when it closes: Escape from a sheet control returns focus to the peek bar.
    await page.focus('#peek'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    ok(await page.evaluate(() => !!document.activeElement.closest('#builder-sidebar')), 'Tab from the peek bar enters the sheet');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => document.activeElement.id === 'peek'), 'Escape with focus inside the sheet returns focus to the peek bar');
    await ctx.close();
  }
  for (const [name, vp, q] of [['360 sheet applied', N360, 'theme=dark&chat=idle&apply=applied&sb=open'], ['400 new project sheet', N, 'theme=light&kind=newproject&chat=idle&apply=partial&sb=open&stack=warn'], ['360 closed pin', N360, 'theme=dark&chat=idle&apply=ready&pin=1&sb=closed'], ['wide applied', W, 'theme=dark&chat=idle&apply=applied'], ['wide ai helpers', W, 'theme=dark&chat=idle&apply=ready&ai=mixed&preset=open']]) {
    const { page, ctx } = await open('index.html', q, vp);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal page scroll`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, a, select, input, textarea, summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && e.offsetParent && (r.width < 24 || r.height < 24) && !e.closest('[inert]'); }).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 30) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    ok(small.length === 0, `${name}: every interactive target is at least 24 x 24 px${small.length ? ' (small: ' + small.join('; ') + ')' : ''}`);
    await ctx.close();
  }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
}

try { await (mode === 'checks' ? checks() : shots()); } finally { await browser.close(); server.close(); }
