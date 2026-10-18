// Prototype capture + check tool (not product code). Needs Playwright from a worktree's node_modules (set PLAYWRIGHT_ENTRY=<path to playwright/index.mjs>).
//   node capture.mjs shots [name-filter] [exclude-regex]   -> writes ../screenshots/*.png and lists console errors per page
//   node capture.mjs checks                -> keyboard + layout checks (dialog trap/Escape/focus return, sheet Escape, inert, no horizontal scroll, 24x24 targets)
// Opens the prototype files through file:// (no server, no build).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pw = process.env.PLAYWRIGHT_ENTRY || path.resolve(root, '../../../../../node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pw).href);
const url = (page, q) => pathToFileURL(path.join(root, page)).href + (q ? '?' + q : '');

const WIDE = { width: 1280, height: 820 }, NARROW = { width: 400, height: 860 };
const shots = [];
const add = (name, page, q, vp = WIDE, theme = ['dark', 'light']) => { for (const t of theme) shots.push({ name: `${t}-${name}`, page, q: `${q ? q + '&' : ''}theme=${t}`, vp }); };
add('landing-default', 'landing.html', 's=default');
add('landing-saved', 'landing.html', 's=saved');
add('landing-resume-agents', 'landing.html', 's=resume-agents&host=panel', WIDE, ['dark']);
add('landing-running-blocked', 'landing.html', 's=blocked', WIDE, ['dark']);
add('landing-narrow-400', 'landing.html', 's=resume-analysis', NARROW, ['dark']);
add('agents-setup-catalog', 'agents.html', 's=setup');
add('agents-setup-analysis', 'agents.html', 's=setup&src=ok&sel=none', WIDE, ['dark']);
add('agents-setup-expired', 'agents.html', 's=setup&src=expired&guid=saved', WIDE, ['dark']);
add('agents-resume-offer', 'agents.html', 's=resume', WIDE, ['dark']);
add('agents-confirm', 'agents.html', 's=confirm');
add('agents-confirm-changed', 'agents.html', 's=confirm-changed', WIDE, ['dark']);
add('agents-running', 'agents.html', 's=running&src=ok');
add('agents-running-fail', 'agents.html', 's=running-fail', WIDE, ['dark']);
add('agents-running-quiet', 'agents.html', 's=running-quiet&cm=diff');
add('agents-cancelling', 'agents.html', 's=cancelling', WIDE, ['dark']);
add('agents-starting', 'agents.html', 's=starting');
add('agents-cancelling-queued', 'agents.html', 's=cancelling&pend=1', WIDE);
add('agents-stop-failed', 'agents.html', 's=stop-failed');
add('agents-stop-unconfirmed', 'agents.html', 's=stop-unconfirmed');
add('agents-stop-unknown', 'agents.html', 's=stop-unknown');
add('agents-narrow-stop-unknown', 'agents.html', 's=stop-unknown&sb=open', NARROW);
add('agents-stop-late', 'agents.html', 's=stop-late');
add('agents-run-failed', 'agents.html', 's=run-failed');
add('agents-run-failed-unverified', 'agents.html', 's=run-failed&ver=0&err=1', WIDE, ['dark']);
add('agents-run-failed-flow', 'agents.html', 's=run-failed&flow=1', WIDE, ['dark']);
add('agents-errors-many', 'agents.html', 's=partial&err=many');
add('agents-partial-flow', 'agents.html', 's=partial-flow');
add('agents-done-flow-started', 'agents.html', 's=done-flow-started');
add('agents-done-flow-skipped', 'agents.html', 's=done-flow-skipped');
add('agents-narrow-stop', 'agents.html', 's=running-quiet', NARROW);
add('agents-narrow-cancelling', 'agents.html', 's=cancelling', NARROW);
add('agents-retry-waiting', 'agents.html', 's=retrying', WIDE, ['dark']);
add('agents-cancelled', 'agents.html', 's=cancelled');
add('agents-partial', 'agents.html', 's=partial');
add('agents-done', 'agents.html', 's=done&guid=late');
add('agents-done-flow', 'agents.html', 's=done-flow&src=ok');
add('agents-done-flow-model-differs', 'agents.html', 's=done-flow&gm=diff');
add('agents-done-flow-new-tab', 'agents.html', 's=done-flow&gt=new');
add('agents-blocked', 'agents.html', 's=blocked', WIDE, ['dark']);
add('agents-rejected', 'agents.html', 's=rejected', WIDE, ['dark']);
add('agents-packs', 'agents.html', 's=setup&pk=list', WIDE, ['dark']);
add('agents-narrow-closed', 'agents.html', 's=running', NARROW, ['dark']);
add('agents-narrow-sheet', 'agents.html', 's=running&sb=open', NARROW);
add('agents-narrow-sheet-setup', 'agents.html', 's=setup&sb=open&src=ok', NARROW, ['dark']);
add('agents-narrow-confirm', 'agents.html', 's=confirm', NARROW, ['dark']);
add('guidance-setup', 'guidance.html', 's=setup');
add('guidance-running', 'guidance.html', 's=running');
add('guidance-running-quiet', 'guidance.html', 's=running-quiet&cm=diff');
add('guidance-cancelling', 'guidance.html', 's=cancelling', WIDE, ['dark']);
add('guidance-starting', 'guidance.html', 's=starting');
add('guidance-narrow-starting', 'guidance.html', 's=starting&sb=open', NARROW);
add('guidance-setup-tab-model', 'guidance.html', 's=setup&gm=diff&flow=1', WIDE);
add('guidance-blocked-queued', 'guidance.html', 's=blocked&pend=1', WIDE);
add('guidance-cancelling-queued', 'guidance.html', 's=cancelling&pend=1', WIDE);
add('guidance-rejected-queued', 'guidance.html', 's=rejected&pend=1', WIDE);
add('guidance-stop-failed', 'guidance.html', 's=stop-failed');
add('guidance-stop-unconfirmed', 'guidance.html', 's=stop-unconfirmed');
add('guidance-stop-unknown', 'guidance.html', 's=stop-unknown');
add('guidance-stop-late', 'guidance.html', 's=stop-late');
add('guidance-narrow-stop', 'guidance.html', 's=running', NARROW);
add('guidance-done', 'guidance.html', 's=complete&src=ok');
add('guidance-existing', 'guidance.html', 's=existing', WIDE, ['dark']);
add('guidance-cancelled', 'guidance.html', 's=cancelled&prev=saved');
add('guidance-failed-flow', 'guidance.html', 's=failed&flow=1', WIDE, ['dark']);
add('guidance-rejected-flow', 'guidance.html', 's=rejected&flow=1', WIDE, ['dark']);
add('guidance-trace-failed', 'guidance.html', 's=trace-failed', WIDE, ['dark']);
add('guidance-trace-failed-unverified', 'guidance.html', 's=trace-failed&prev=saved&ver=0', WIDE, ['dark']);
add('guidance-narrow-sheet', 'guidance.html', 's=complete&sb=open&fb=1', NARROW, ['dark']);
add('source-gallery', 'source.html', '', { width: 1280, height: 1500 });
add('hub-excerpt', 'hub.html', '');

const mode = process.argv[2] || 'shots'; const filter = process.argv[3] || ''; const exclude = process.argv[4] ? new RegExp(process.argv[4]) : null;
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });

if (mode === 'shots') {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  for (const s of shots.filter((x) => x.name.includes(filter) && !(exclude && exclude.test(x.name)))) {
    const page = await ctx.newPage(); const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
    await page.setViewportSize(s.vp); await page.goto(url(s.page, s.q), { waitUntil: 'load' });
    await page.waitForSelector('body[data-ready="1"], .idx', { timeout: 5000 }).catch(() => errs.push('not ready'));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(root, 'screenshots', s.name + '.png') });
    console.log(s.name, errs.filter((e) => !/fonts\.googleapis|ERR_/.test(e)).join(' | ') || 'ok'); await page.close();
  }
}

if (mode === 'checks') {
  let fail = 0; const ok = (c, m) => { if (!c) fail++; console.log(c ? 'PASS' : 'FAIL', m); };
  const open = async (p, q, vp) => { const pg = await ctx.newPage(); await pg.setViewportSize(vp); await pg.goto(url(p, q)); await pg.waitForSelector('body[data-ready="1"]'); return pg; };
  // dialog: focus on Cancel, trap, Escape returns to setup
  let pg = await open('agents.html', 's=confirm', WIDE);
  ok(await pg.evaluate(() => document.activeElement?.id === 'dlg-cancel'), 'confirm dialog: initial focus on Cancel');
  ok(await pg.evaluate(() => !!document.querySelector('.dlg[role=dialog][aria-modal=true][aria-labelledby][aria-describedby]')), 'confirm dialog: role, aria-modal, labelled, described');
  await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab');
  ok(await pg.evaluate(() => !!document.activeElement.closest('.dlg')), 'confirm dialog: Tab stays inside');
  ok(await pg.evaluate(() => document.querySelector('.hdr').inert && document.getElementById('chatcol').inert), 'confirm dialog: page behind is inert');
  await pg.keyboard.press('Escape');
  ok(await pg.evaluate(() => !document.querySelector('.dlg')), 'confirm dialog: Escape closes (= Cancel)');
  ok(await pg.evaluate(() => document.activeElement?.id === 'gen-btn' || document.activeElement?.tagName === 'BUTTON'), 'confirm dialog: focus returns to a control');
  await pg.close();
  // narrow sheet
  pg = await open('agents.html', 's=running&sb=open', NARROW);
  ok(await pg.evaluate(() => document.getElementById('chatcol').inert), 'narrow sheet open: chat column inert');
  await pg.focus('#peek'); await pg.keyboard.press('Escape');
  ok(await pg.evaluate(() => document.querySelector('.page').dataset.sb === 'closed' && document.activeElement.id === 'peek'), 'narrow sheet: Escape closes and focuses the peek bar');
  ok(await pg.evaluate(() => !document.getElementById('chatcol').inert), 'narrow sheet closed: chat column interactive');
  await pg.close();
  // Stop generation: reachable in every active state, also when the chat is idle, and next to the peek bar when narrow
  for (const [p, st] of [['guidance.html', 'starting'], ['agents.html', 'starting'], ['agents.html', 'running'], ['agents.html', 'running-quiet'], ['agents.html', 'retrying'], ['guidance.html', 'running'], ['guidance.html', 'running-quiet'], ['guidance.html', 'regenerating']]) {
    pg = await open(p, 's=' + st, WIDE);
    ok(await pg.evaluate(() => !!document.querySelector('#wizard-sidebar [data-act=stop][aria-label="Stop generation"]')), p + ' ' + st + ': Stop generation is in the Run section');
    await pg.close();
    pg = await open(p, 's=' + st, NARROW);
    ok(await pg.evaluate(() => { const b = document.querySelector('.peek-stop'); return !!b && b.offsetParent !== null && b.getAttribute('aria-label') === 'Stop generation'; }), p + ' ' + st + ' at 400px: Stop generation next to the peek bar');
    await pg.close();
  }
  pg = await open('agents.html', 's=running-quiet', WIDE);
  ok(await pg.evaluate(() => !document.querySelector('[aria-label="Stop generating"]')), 'agents running-quiet: chat Stop absent (chat idle) while Stop generation stays');
  await pg.close();
  // Stop goes through Stopping to Cancelled
  pg = await open('agents.html', 's=running', WIDE);
  await pg.click('#wizard-sidebar [data-act=stop]');
  ok(await pg.evaluate(() => /Stopping generation/.test(document.querySelector('#wizard-sidebar').textContent)), 'Stop generation: shows Stopping generation');
  ok(await pg.evaluate(() => document.activeElement?.id === 'gen-stop' && document.activeElement.getAttribute('aria-disabled') === 'true' && /Stopping/.test(document.activeElement.textContent)), 'Stop generation: focus stays on the Stopping... button');
  await pg.waitForTimeout(1500);
  ok(await pg.evaluate(() => /Generation cancelled/.test(document.querySelector('#wizard-sidebar').textContent)), 'Stop generation: ends in Generation cancelled');
  ok(await pg.evaluate(() => document.activeElement?.tagName === 'H3' && /Generation cancelled/.test(document.activeElement.textContent)), 'Stop generation: focus moves to the Generation cancelled heading');
  await pg.close();
  // combined-flow handoff (design-spec 2.9.2): Skip before the countdown ends prevents the start; otherwise it starts after 5 s
  pg = await open('agents.html', 's=done-flow', WIDE);
  const txt = () => pg.evaluate(() => document.querySelector('#wizard-sidebar').textContent);
  ok(/Project guidance starts next/.test(await txt()) && !!(await pg.$('[data-set="fs=skipped"]')) && !!(await pg.$('[data-set="fs=started"]')), 'done-flow: countdown card with Skip guidance and Start now');
  await pg.click('[data-set="fs=skipped"]'); await pg.waitForTimeout(5600);
  ok(/Project guidance skipped/.test(await txt()) && !/Project guidance started/.test(await txt()), 'done-flow: Skip before 5 s means guidance never starts');
  ok(/Generate project guidance/.test(await txt()), 'done-flow skipped: Next steps offers the separate start');
  await pg.close();
  pg = await open('agents.html', 's=done-flow', WIDE);
  await pg.waitForTimeout(5600);
  ok(/Project guidance started/.test(await txt()) && !(await pg.$('[data-set="fs=skipped"]')), 'done-flow: after 5 s guidance has started and Skip no longer exists');
  await pg.close();
  pg = await open('agents.html', 's=partial-flow', WIDE);
  ok(/Project guidance starts next/.test(await txt()) && /Retry/.test(await txt()) && /Failed items stay available to retry here/.test(await txt()), 'partial-flow: countdown continues and failed items stay retryable');
  await pg.close();
  pg = await open('agents.html', 's=run-failed&flow=1', WIDE);
  ok(/Continue to project guidance/.test(await txt()) && !!(await pg.$('[data-set="fs=skipped"]')) && !/starts next/.test(await txt()), 'run-failed in the flow: manual Continue and Skip, no countdown');
  await pg.close();
  // stop failure, late stop, errors block
  for (const p of ['agents.html', 'guidance.html']) {
    pg = await open(p, 's=stop-failed', WIDE);
    ok(await pg.evaluate(() => !!document.querySelector('#wizard-sidebar [role=alert]') && /Could not stop the run/.test(document.querySelector('#wizard-sidebar').textContent) && !!document.querySelector('#wizard-sidebar [data-act=stop]:not([aria-disabled])')), p + ' stop-failed: alert and an enabled Stop generation');
    await pg.close();
    pg = await open(p, 's=stop-late', WIDE);
    ok(await pg.evaluate(() => /finished before the stop took effect/.test(document.querySelector('#wizard-sidebar').textContent) && !document.querySelector('#wizard-sidebar [data-act=stop]')), p + ' stop-late: final result and no Stop');
    await pg.close();
  }
  // round 2: failed stop wording follows the verified-fact rule; guidance starting with a queued stop
  for (const p of ['agents.html', 'guidance.html']) {
    pg = await open(p, 's=stop-failed', WIDE);
    ok(await pg.evaluate(() => { const t = document.querySelector('#wizard-sidebar').textContent; return /The run is still active\. Try stopping again/.test(t) && !/did not reach the run/.test(t) && !!document.querySelector('#wizard-sidebar [data-act=stop]:not([aria-disabled])'); }), p + ' stop-failed: says only that the run is still active, Stop enabled');
    await pg.close();
    pg = await open(p, 's=stop-unconfirmed', WIDE);
    ok(await pg.evaluate(() => /Stop could not be confirmed/.test(document.querySelector('#wizard-sidebar').textContent) && !document.querySelector('#wizard-sidebar [data-act=stop]') && !!document.querySelector('#wizard-sidebar #gen-stop[aria-disabled=true]')), p + ' stop-unconfirmed: re-reading, Stop disabled');
    await pg.close();
    pg = await open(p, 's=stop-unknown', WIDE);
    ok(await pg.evaluate(() => { const sb = document.querySelector('#wizard-sidebar'); return /Run state could not be confirmed/.test(sb.textContent) && !sb.querySelector('[data-act=stop]') && /Check again/.test(sb.textContent); }), p + ' stop-unknown: no Stop offered, only Check again');
    await pg.close();
    pg = await open(p, 's=stop-unknown', NARROW);
    ok(await pg.evaluate(() => !document.querySelector('.peek-stop')), p + ' stop-unknown at 400px: no Stop beside the peek bar');
    await pg.close();
    pg = await open(p, 's=starting', WIDE);
    await pg.click('#wizard-sidebar [data-act=stop]');
    ok(await pg.evaluate(() => /received before the run began/.test(document.querySelector('#wizard-sidebar').textContent)), p + ' starting: a stop is queued until the run exists');
    await pg.waitForTimeout(1500);
    ok(await pg.evaluate(() => /cancelled/i.test(document.querySelector('#wizard-sidebar').textContent)), p + ' starting: the queued stop ends in cancelled');
    await pg.close();
    pg = await open(p, 's=rejected&pend=1', WIDE);
    ok(await pg.evaluate(() => /stop request was dropped/.test(document.querySelector('#wizard-sidebar').textContent)), p + ' rejected start after a queued stop: the stop is dropped and says so');
    await pg.close();
  }
  // round 2: the countdown names the project guidance tab's model
  pg = await open('agents.html', 's=done-flow&gm=diff', WIDE);
  ok(await pg.evaluate(() => { const t = document.querySelector('#wizard-sidebar').textContent; return /uses Anthropic, Claude Opus 4\.1, the model of the Project Prompt tab/.test(t) && /The agent run used Anthropic, Claude Sonnet 4\.5/.test(t); }), 'done-flow: countdown names the guidance tab model and the agent run model when they differ');
  await pg.close();
  pg = await open('agents.html', 's=done-flow&gt=new', WIDE);
  ok(await pg.evaluate(() => /the default model for a new Project Prompt tab/.test(document.querySelector('#wizard-sidebar').textContent)), 'done-flow: with no guidance tab yet the countdown names the new-tab default');
  await pg.close();
  pg = await open('guidance.html', 's=setup&gm=diff', WIDE);
  ok(await pg.evaluate(() => { const t = document.querySelector('#wizard-sidebar').textContent; return /Model: Anthropic, Claude Opus 4\.1/.test(t) && /This run will use Anthropic, Claude Opus 4\.1/.test(t) && document.querySelector('#model-sel').value === 'Claude Opus 4.1'; }), 'guidance setup with its own tab model: the model before submission is the tab model');
  await pg.close();
  pg = await open('agents.html', 's=partial&err=many', WIDE);
  ok(await pg.evaluate(() => { const b = document.querySelector('#wizard-sidebar [role=alert]'); return !!b && /(7)/.test(b.textContent) && /Show 4 more/.test(b.textContent) && b.querySelectorAll(':scope > .grow > ul > li').length === 3; }), 'errors block: count, first three shown, the rest behind Show 4 more');
  await pg.close();
  pg = await open('agents.html', 's=run-failed&ver=0', WIDE);
  ok(await pg.evaluate(() => { const t = document.querySelector('#wizard-sidebar').textContent; return /could not be confirmed/.test(t) && !/no files were written/i.test(t); }), 'run-failed unverified: never claims that no files were written');
  await pg.close();
  for (const [p, st] of [['agents.html', 'running'], ['agents.html', 'starting'], ['agents.html', 'stop-failed'], ['guidance.html', 'running']]) {
    pg = await open(p, 's=' + st, WIDE);
    ok(await pg.evaluate(() => !!document.querySelector('.standin [aria-label="Stop generating"]')), p + ' ' + st + ': composer Stop is present while the chat streams');
    await pg.close();
  }
  // horizontal scroll + target sizes
  for (const [p, q] of [['landing.html', 's=saved'], ['agents.html', 's=partial&sb=open&pk=list'], ['agents.html', 's=setup&sb=open&src=ok'], ['agents.html', 's=stop-failed&sb=open'], ['agents.html', 's=partial&err=many&sb=open'], ['agents.html', 's=done-flow&sb=open'], ['guidance.html', 's=stop-failed&sb=open'], ['guidance.html', 's=complete&sb=open&fb=1'], ['source.html', '']]) {
    for (const w of [400, 360]) {
      pg = await open(p, q, { width: w, height: 860 });
      const o = await pg.evaluate(() => { let max = 0; for (const el of document.querySelectorAll('.sb-scroll, .land, .page, .gal')) max = Math.max(max, el.scrollWidth - el.clientWidth); return max; });
      ok(o <= 1, `${p}?${q} at ${w}px: no horizontal overflow (${o}px)`);
      await pg.close();
    }
  }
  for (const [p, q] of [['landing.html', 's=saved'], ['agents.html', 's=partial&sb=open&pk=list'], ['guidance.html', 's=complete&sb=open']]) {
    pg = await open(p, q, WIDE);
    const small = await pg.evaluate(() => [...document.querySelectorAll('.page button, .page a.btn, .page select, .page input')].filter((e) => !e.closest('.proto') && e.offsetParent && (e.getBoundingClientRect().width < 24 || e.getBoundingClientRect().height < 24)).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30)));
    ok(small.length === 0, `${p}?${q}: every visible control >= 24x24 ${small.join(', ')}`);
    await pg.close();
  }
  console.log(fail ? `${fail} FAILED` : 'all passed');
}
await browser.close();
