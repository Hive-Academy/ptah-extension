/**
 * TASK_2026_662 Phase B visual capture. Usage: node capture-phase-b.cjs <buildWorktree> <outDir> [onlyStage]
 * Private HOME/APPDATA/userData/DB under os.tmpdir(); Ollama endpoints point at 127.0.0.1:1. CDP port 9390 only.
 * RPC faults (delay / failure / fake reply) are injected in the renderer by wrapping window.vscode.postMessage.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

const root = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const ONLY = process.argv[4] || '';
const VIEWPORT = { width: 1280, height: 800 };
const req = createRequire(path.join(root, 'package.json'));
const { _electron } = req('@playwright/test');
const index = [];
const log = (s) => { index.push(s); console.log(s); };

function userLayerAgentDirName(r) {
  const slashed = r.split('\\').join('/').replace(/\/+$/, '');
  const canonical = process.platform === 'win32' ? slashed.toLowerCase() : slashed;
  const seg = canonical.slice(canonical.lastIndexOf('/') + 1);
  const label = seg.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 32) || 'ws';
  let high = 0x811c9dc5, low = 0xcbf29ce4;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    high = Math.imul(high ^ c, 0x01000193) >>> 0;
    low = Math.imul(low ^ (c + i), 0x01000021) >>> 0;
  }
  return `${label}-${(high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')).slice(0, 16)}`;
}

const AGENTS = [
  ['architect', 'Designs component boundaries and writes the implementation plan.', 'opus'],
  ['backend-developer', 'Writes server-side services, handlers and persistence code.', 'sonnet'],
  ['frontend-developer', 'Builds Angular components, templates and styling.', 'sonnet'],
  ['code-reviewer', 'Reviews a diff for correctness and repository conventions.', 'sonnet'],
];

function sidecar(kind, slug, i) {
  return JSON.stringify({
    kind, slug, pluginId: null, version: null, sourceHash: `seedhash-${slug}`,
    clonedAt: Date.now() - 86400000 * (i + 1), diverged: false,
    lastEnhancedAt: null, historyDir: '.history',
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-662-pb-')));
  const home = path.join(tmp, 'home');
  const udd = path.join(tmp, 'udd');
  const appdata = path.join(tmp, 'appdata');
  const ws = path.join(tmp, 'ws');
  for (const d of [home, udd, appdata, path.join(ws, '.claude', 'agents'), path.join(ws, '.ptah')]) fs.mkdirSync(d, { recursive: true });
  const wsKey = userLayerAgentDirName(ws);
  for (const agentsRoot of [path.join(home, '.ptah', 'user', 'agents', wsKey), path.join(home, '.ptah', 'user', 'agents')]) {
    fs.mkdirSync(agentsRoot, { recursive: true });
    AGENTS.forEach(([name, desc, model], i) => {
      fs.writeFileSync(path.join(agentsRoot, `${name}.md`), `---\nname: ${name}\ndescription: ${desc}\nmodel: ${model}\n---\n\nYou are the ${name} agent. ${desc}\n`);
      fs.writeFileSync(path.join(agentsRoot, `${name}.ptah-origin.json`), sidecar('agent', name, i));
    });
  }
  // skills (dir clones) and commands (file clones)
  const SKILLS = [['unused-skill', 'Never run.'], ['used-skill', 'Run but never graded.'], ['graded-skill', 'Run and graded.'], ['zero-skill', 'Run, graded, always failing.']];
  SKILLS.forEach(([slug, desc], i) => {
    const d = path.join(home, '.ptah', 'user', 'skills', slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${desc}\n---\n\n# ${slug}\n\n${desc}\n`);
    fs.writeFileSync(path.join(d, '.ptah-origin.json'), sidecar('skill', slug, i));
  });
  const COMMANDS = [['unused-cmd', 'Never run.'], ['used-cmd', 'Run but never graded.'], ['graded-cmd', 'Run and graded.']];
  fs.mkdirSync(path.join(home, '.ptah', 'user', 'commands'), { recursive: true });
  COMMANDS.forEach(([slug, desc], i) => {
    const f = path.join(home, '.ptah', 'user', 'commands', slug);
    fs.writeFileSync(`${f}.md`, `---\ndescription: ${desc}\n---\n\n${desc}\n`);
    fs.writeFileSync(`${f}.ptah-origin.json`, sidecar('command', slug, i));
  });
  const dbPath = path.join(tmp, 'ptah.sqlite');
  const env = {
    ...process.env, NODE_ENV: 'test', PTAH_E2E: '1', PTAH_DB_PATH: dbPath,
    HOME: home, USERPROFILE: home, APPDATA: appdata, LOCALAPPDATA: appdata,
    OLLAMA_HOST: '127.0.0.1:1', OLLAMA_BASE_URL: 'http://127.0.0.1:1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [path.join(root, 'dist', 'apps', 'ptah-electron', 'main.mjs'), `--user-data-dir=${udd}`, '--remote-debugging-port=9390', ws], env, timeout: 90_000 });
  log('electron pid: ' + app.process().pid);
  const mainLog = [];
  for (const st of ['stdout', 'stderr']) app.process()[st].on('data', (d) => mainLog.push(String(d)));
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForURL((u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'), { timeout: 90_000 });
    await app.evaluate(({ BrowserWindow }, vp) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w.isMaximized()) w.unmaximize();
      w.setContentSize(vp.width, vp.height);
      w.center();
    }, VIEWPORT);
    await page.waitForTimeout(1500);
    log('viewport ' + JSON.stringify(await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))));

    // Seed events + grades after the DB exists (migrations ran at boot).
    {
      const { DatabaseSync } = require('node:sqlite');
      let db = null;
      for (let t = 0; t < 60; t++) {
        try {
          if (fs.existsSync(dbPath)) {
            db = new DatabaseSync(dbPath);
            db.prepare('SELECT 1 FROM skill_invocation_events LIMIT 1').all();
            db.prepare('SELECT 1 FROM skill_task_grades LIMIT 1').all();
            break;
          }
        } catch (e) { try { db && db.close(); } catch (_) { /* */ } db = null; }
        await page.waitForTimeout(1000);
      }
      if (!db) throw new Error('db tables never appeared');
      const ev = db.prepare("INSERT INTO skill_invocation_events (id,skill_slug,session_id,context_id,source,succeeded,is_error,invoked_at,task_id,run_id) VALUES (?,?,?,?,?,?,?,?,?,?)");
      const gr = db.prepare("INSERT INTO skill_task_grades (task_id,subject_kind,subject_slug,attribution_key,run_id,verdict,source_file,source_digest,evidence_source,workspace_root,graded_at,findings_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
      let n = 0;
      const now = Date.now();
      const SEED = process.env.SEED || 'all';
      const events = (slug, count, source) => { if (SEED === 'grades') return; for (let i = 0; i < count; i++) { n++; ev.run('EV' + String(n).padStart(6, '0'), slug, 'sess-' + n, 'ctx-' + (i % 2), source, null, 0, now - n * 600000, null, 'run-' + slug + '-' + i); } };
      const grades = (kind, slug, verdicts) => SEED === 'events' ? [] : verdicts.forEach((v, i) => { gr.run('TASK_2026_9' + String(n++ % 100).padStart(2, '0') + slug.slice(0, 3), kind, slug, 'event:' + slug + ':' + i, null, v, null, null, 'window', null, now - i * 3600000, null); });
      events('backend-developer', 3, 'subagent');
      events('frontend-developer', 6, 'subagent'); grades('agent', 'frontend-developer', ['pass', 'pass', 'pass', 'fail']);
      events('code-reviewer', 2, 'subagent'); grades('agent', 'code-reviewer', ['fail', 'fail']);
      events('used-skill', 3, 'skill_tool');
      events('graded-skill', 6, 'skill_tool'); grades('skill', 'graded-skill', ['pass', 'pass', 'pass']);
      events('zero-skill', 2, 'skill_tool'); grades('skill', 'zero-skill', ['fail']);
      events('used-cmd', 2, 'slash_command');
      events('graded-cmd', 4, 'slash_command'); grades('command', 'graded-cmd', ['pass', 'fail']);
      db.close();
      log('seeded events=' + n);
    }

    let theme = 'dark';
    const shot = async (name, what, locator) => {
      const file = `pb-${name}-${theme}.png`;
      try {
        if (locator) await locator.screenshot({ path: path.join(outDir, file) });
        else await page.screenshot({ path: path.join(outDir, file) });
        index.push(`| ${name} | ${theme} | ${file} | ${what} |`);
        console.log('SHOT', file);
      } catch (e) { index.push(`| ${name} | ${theme} | MISSING | ${what} (${String(e.message).slice(0, 80)}) |`); console.log('MISSING', name, e.message.slice(0, 100)); }
    };
    const txt = async (label, sel) => {
      try { const t = (await page.locator(sel).first().innerText({ timeout: 3000 })).split('\n').join(' | ').slice(0, 700); log(`(note ${theme}) ${label}: ${t}`); return t; }
      catch (e) { log(`(note ${theme}) ${label}: <none> ${e.message.slice(0, 60)}`); return ''; }
    };
    const tryDo = async (label, fn) => { try { await fn(); } catch (e) { log(`STEP FAIL ${theme} ${label}: ${String(e.message).slice(0, 160)}`); } };
    async function setTheme(name) {
      await page.locator('[aria-label="Change theme"]').first().click();
      await page.locator(`button[data-theme="${name}"]`).first().click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
      await page.waitForTimeout(800);
      log('theme ' + await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    }

    const contrast = async (label, sel) => {
      try {
        const res = await page.evaluate((selector) => {
          const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
          const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
          const els = Array.from(document.querySelectorAll(selector)).slice(0, 3);
          return els.map((el) => {
            let bg = [255, 255, 255]; const stack = []; let e = el;
            while (e) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 0.99) break; e = e.parentElement; }
            for (const c of stack.reverse()) bg = bg.map((v, i) => Math.round(c[i] * c[3] + v * (1 - c[3])));
            const f = rgba(getComputedStyle(el).color); const fg = f.slice(0, 3).map((v, i) => Math.round(v * f[3] + bg[i] * (1 - f[3])));
            const L1 = lum(fg), L2 = lum(bg); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
            return { text: el.textContent.trim().slice(0, 30), fg: fg.join(','), bg: bg.join(','), ratio: ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2), px: cs.fontSize, w: Math.round(r.width), h: Math.round(r.height) };
          });
        }, sel);
        log(`(contrast ${theme}) ${label}: ${JSON.stringify(res)}`);
      } catch (e) { log(`(contrast ${theme}) ${label}: error ${e.message.slice(0, 80)}`); }
    };
    // --- RPC fault injection in the Electron main process (preload bridge is frozen)
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis;
      if (g.__px) return;
      g.__px = true; g.__rules = []; g.__log = [];
      const originals = ipcMain.listeners('rpc');
      ipcMain.removeAllListeners('rpc');
      ipcMain.on('rpc', (event, msg) => {
        const p = msg && (msg.payload || msg);
        const m = p && p.method;
        if (m) {
          g.__log.push(m + (p.params && p.params.key ? ':' + p.params.key : ''));
          const idx = g.__rules.findIndex((r) => r.method === m && (!r.key || (p.params && p.params.key === r.key)));
          if (idx >= 0) {
            const r = g.__rules[idx];
            if (r.times !== undefined) { r.times -= 1; if (r.times <= 0) g.__rules.splice(idx, 1); }
            const send = (body) => { if (!event.sender.isDestroyed()) event.sender.send('to-renderer', { type: 'rpc:response', correlationId: p.correlationId, ...body }); };
            if (r.mode === 'delay') { setTimeout(() => { for (const l of originals) l(event, msg); }, r.ms); return; }
            if (r.mode === 'fail') { setTimeout(() => send({ success: false, error: r.error || 'injected failure' }), r.ms || 60); return; }
            if (r.mode === 'fake') { const d = r.map ? (r.map[p.params && p.params[r.field]] ?? r.data) : r.data; setTimeout(() => send({ success: true, data: d }), r.ms || 60); return; }
          }
        }
        for (const l of originals) l(event, msg);
      });
    });
    const rule = (r) => app.evaluate((_e, x) => { globalThis.__rules.push(x); }, r);
    const clearRules = () => app.evaluate(() => { globalThis.__rules.length = 0; });


    // The real listClones/getClone/getScorecardDetail path throws at HEAD (see review: SkillScorecardService
    // constructor param 5 has no @inject). Synthetic replies let the Library UI itself be reviewed.
    const mk = (kind, slug, inv, rate) => ({ slug, kind, cloneStatus: 'clone', diverged: false, invocationCount: inv, successRate: rate, lastEnhancedAt: null, historyCount: 0, pendingSourceHash: null, enhanceMinInvocations: 5, enhanceCooldownUntil: null, orphaned: false });
    const CLONES = [
      mk('agent', 'architect', 0, null), mk('agent', 'backend-developer', 3, null), mk('agent', 'frontend-developer', 6, 0.75), mk('agent', 'code-reviewer', 2, 0),
      mk('skill', 'unused-skill', 0, null), mk('skill', 'used-skill', 3, null), mk('skill', 'graded-skill', 6, 1), mk('skill', 'zero-skill', 2, 0),
      mk('command', 'unused-cmd', 0, null), mk('command', 'used-cmd', 2, null), mk('command', 'graded-cmd', 4, 0.5),
    ];
    const now0 = Date.now();
    const sc = (slug, total, graded, rate, verdicts) => ({ slug, totalInvocations: total, gradedCount: graded, gradedSuccessRate: rate, avgInputTokens: 1200, avgOutputTokens: 400, avgCacheReadTokens: null, totalInputTokens: 3600, totalOutputTokens: 1200, avgCostUsd: 0.04, avgDurationMs: 42000, avgToolCount: 5, winRate: null, recentVerdicts: verdicts });
    const SCORECARDS = {
      'backend-developer': sc('backend-developer', 3, 0, null, [{ taskId: 'T1', succeeded: null, reconciledAt: now0 }, { taskId: 'T2', succeeded: true, reconciledAt: now0 }, { taskId: 'T3', succeeded: false, reconciledAt: now0 }]),
      'frontend-developer': sc('frontend-developer', 6, 4, 0.75, [{ taskId: 'T1', succeeded: true, reconciledAt: now0 }, { taskId: 'T2', succeeded: true, reconciledAt: now0 }, { taskId: 'T3', succeeded: true, reconciledAt: now0 }, { taskId: 'T4', succeeded: false, reconciledAt: now0 }]),
      'code-reviewer': sc('code-reviewer', 2, 2, 0, [{ taskId: 'T1', succeeded: false, reconciledAt: now0 }, { taskId: 'T2', succeeded: false, reconciledAt: now0 }]),
    };
    const row = (taskId, succeeded) => ({ taskId, succeeded, exactAttribution: true, inputTokens: 1200, outputTokens: 400, costUsd: 0.04, durationMs: 42000, invokedAt: now0 - 3600000, reconciledAt: now0 });
    const DETAIL = {
      'backend-developer': { slug: 'backend-developer', rows: [row('TASK_2026_101', null), row('TASK_2026_102', null), row('TASK_2026_103', null)], findingsExcerpt: null },
      'frontend-developer': { slug: 'frontend-developer', rows: [row('TASK_2026_201', true), row('TASK_2026_202', false), row(null, null)], findingsExcerpt: null },
    };
    const CLONE_DETAIL = Object.fromEntries(CLONES.map((c) => [c.slug, { clone: c, body: `# ${c.slug}\n\nSeeded body for ${c.slug}.\n`, history: [] }]));
    const fakeLibrary = async () => {
      await rule({ method: 'skillSynthesis:listClones', mode: 'fake', data: { clones: CLONES }, ms: 80 });
      await rule({ method: 'skillSynthesis:getScorecards', mode: 'fake', data: { scorecards: SCORECARDS }, ms: 80 });
      await rule({ method: 'skillSynthesis:getScorecardDetail', mode: 'fake', field: 'slug', map: DETAIL, data: { slug: 'x', rows: [], findingsExcerpt: null }, ms: 80 });
      await rule({ method: 'skillSynthesis:getClone', mode: 'fake', field: 'slug', map: CLONE_DETAIL, data: { clone: null, body: null, history: [] }, ms: 80 });
    };

    const stages = {
      async thoth() {
        await page.locator('[data-test="config-menu-item-thoth"]').click();
        await tryDo('skills tab', () => page.locator('#thoth-tab-skills').click({ timeout: 15000 }));
        await page.waitForTimeout(2500);
        await shot('thoth-skills-landing', 'Thoth shell, Skills tab landing (nav tiles + pause + telemetry)');
        const nav = page.locator('[data-testid="thoth-section-nav"]');
        await shot('dashboard-tiles', 'Thoth nav pillar tiles', nav);
        const tile = page.locator('[data-testid="dashboard-status-card"][data-pillar="skills"]');
        await shot('skills-tile-initial', 'Skills tile (initial telemetry state)', tile);
        await txt('skills tile (initial)', '[data-testid="dashboard-status-card"][data-pillar="skills"]');
        await contrast('tile value', '[data-testid="dashboard-status-card-value"]');
        await contrast('tile paused badge', '[data-testid="thoth-tab-paused"]');
        await contrast('switch label muted', '#skills-telemetry-help');
        await shot('pause-and-telemetry', 'Pause + telemetry switches', page.locator('[data-testid="skills-pause-switch"]'));
        await shot('telemetry-switch', 'Telemetry switch card', page.locator('[data-testid="skills-telemetry-switch"]'));
        await txt('telemetry switch', '[data-testid="skills-telemetry-switch"]');
        const before = await page.locator('[data-testid="skills-telemetry-toggle"]').isChecked();
        log(`(note ${theme}) telemetry checked initially: ${before}`);
        // toggle to the other value
        await page.locator('[data-testid="skills-telemetry-toggle"]').click();
        await page.waitForTimeout(2500);
        log(`(note ${theme}) telemetry checked after toggle: ${await page.locator('[data-testid="skills-telemetry-toggle"]').isChecked()}`);
        await shot('skills-tile-toggled', 'Skills tile after telemetry toggled', tile);
        await shot('telemetry-switch-toggled', 'Telemetry switch after toggle', page.locator('[data-testid="skills-telemetry-switch"]'));
        await txt('skills tile (after toggle)', '[data-testid="dashboard-status-card"][data-pillar="skills"]');
        await shot('dashboard-tiles-toggled', 'Nav tiles after toggle', nav);
        // does the tile follow the switch without a tab switch? wait, then switch tabs and back
        await page.waitForTimeout(3000);
        await txt('skills tile (3s later, same tab)', '[data-testid="dashboard-status-card"][data-pillar="skills"]');
        await page.locator('#thoth-tab-memory').click().catch(() => undefined);
        await page.waitForTimeout(1500);
        await page.locator('#thoth-tab-skills').click().catch(() => undefined);
        await page.waitForTimeout(2000);
        await txt('skills tile (after tab round trip)', '[data-testid="dashboard-status-card"][data-pillar="skills"]');
        await shot('dashboard-tiles-after-roundtrip', 'Nav tiles after tab round trip', nav);
        await shot('skills-tile-after-roundtrip', 'Skills tile after tab round trip', tile);
        // telemetry pending
        await rule({ method: 'settings:set', key: 'skills.telemetry.enabled', mode: 'delay', ms: 5000, times: 1 });
        await page.locator('[data-testid="skills-telemetry-toggle"]').click();
        await page.waitForTimeout(900);
        await shot('telemetry-pending', 'Telemetry write pending (host reply held 5s)', page.locator('[data-testid="skills-telemetry-switch"]'));
        log(`(note ${theme}) telemetry pending: checked=${await page.locator('[data-testid="skills-telemetry-toggle"]').isChecked()} disabled=${await page.locator('[data-testid="skills-telemetry-toggle"]').isDisabled()}`);
        await page.waitForTimeout(5500);
        await shot('telemetry-after-pending', 'Telemetry after pending write settled', page.locator('[data-testid="skills-telemetry-switch"]'));
        await txt('tile after pending', '[data-testid="dashboard-status-card"][data-pillar="skills"]');
        // telemetry error
        await rule({ method: 'settings:set', key: 'skills.telemetry.enabled', mode: 'fail', error: 'injected failure', times: 1 });
        await page.locator('[data-testid="skills-telemetry-toggle"]').click();
        await page.waitForTimeout(1500);
        await shot('telemetry-error', 'Telemetry write failed', page.locator('[data-testid="skills-telemetry-switch"]'));
        await txt('telemetry error', '[data-testid="skills-telemetry-switch"]');
        await contrast('telemetry error text', '[data-testid="skills-telemetry-switch"] [role="alert"], [data-testid="skills-telemetry-switch"] p.text-error, [data-testid="skills-telemetry-switch"] p:last-of-type');
        await clearRules();
      },
      async pause() {
        await page.locator('[data-test="config-menu-item-thoth"]').click();
        await tryDo('skills tab', () => page.locator('#thoth-tab-skills').click({ timeout: 15000 }));
        await page.waitForTimeout(1500);
        const sw = page.locator('[data-testid="skills-pause-switch"]');
        const tog = page.locator('[data-testid="skills-enabled-toggle"]');
        if (!(await tog.isChecked())) { await tog.click({ force: true }); await page.waitForTimeout(2500); }
        log(`(note ${theme}) pause initial: checked=${await tog.isChecked()} state=${await txt('pause state', '[data-testid="skills-pause-state"]')}`);
        await shot('pause-on', 'Pause switch committed On', sw);
        // pending
        await rule({ method: 'settings:set', key: 'skillSynthesis.enabled', mode: 'delay', ms: 5000, times: 1 });
        await tog.click({ force: true });
        await page.waitForTimeout(900);
        await shot('pause-pending', 'Pause switch while write pending (host held 5s)', sw);
        log(`(note ${theme}) pause pending: checked=${await tog.isChecked()} disabled=${await tog.isDisabled()} state=${await txt('state', '[data-testid="skills-pause-state"]')}`);
        await page.waitForTimeout(5500);
        await shot('pause-paused', 'Pause switch committed Paused', sw);
        await txt('paused state', '[data-testid="skills-pause-switch"]');
        await shot('pause-paused-tab', 'Skills tab while paused (full window)');
        const nav = page.locator('[data-testid="thoth-section-nav"]');
        await shot('dashboard-tiles-paused', 'Nav tiles while paused', nav);
        // error on resume
        await rule({ method: 'settings:set', key: 'skillSynthesis.enabled', mode: 'fail', error: 'injected failure', times: 1 });
        await tog.click({ force: true });
        await page.waitForTimeout(1500);
        await contrast('pause error text', '[data-testid="skills-pause-error"]');
        await contrast('pause state', '[data-testid="skills-pause-state"]');
        await shot('pause-error', 'Pause switch write failed (stays Paused, error alert)', sw);
        log(`(note ${theme}) pause error: checked=${await tog.isChecked()}`);
        await txt('error text', '[data-testid="skills-pause-switch"]');
        await clearRules();
        // resume for real
        await tog.click({ force: true });
        await page.waitForTimeout(2500);
        await shot('pause-resumed', 'Pause switch resumed', sw);
        log(`(note ${theme}) resumed: checked=${await tog.isChecked()}`);
      },
      async library() {
        if (!process.env.REAL_LIBRARY) await fakeLibrary();
        await page.locator('[data-test="config-menu-item-thoth"]').click();
        await tryDo('skills tab', () => page.locator('#thoth-tab-skills').click({ timeout: 15000 }));
        await page.waitForTimeout(1000);
        await page.locator('[data-testid="skills-subview-clones"]').click({ timeout: 10000 });
        await page.locator('[data-testid="clones-view"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(7000);
        await shot('library-header', 'Library view with pause/telemetry header (agents tab)');
        for (const kind of ['Skills', 'Commands', 'Agents']) {
          await tryDo(kind, async () => {
            await page.locator('[data-testid="clones-view"]').getByRole('tab', { name: new RegExp('^' + kind) }).first().click({ timeout: 10000 });
            await page.waitForTimeout(2500);
          });
          await shot(`library-${kind.toLowerCase()}`, `Library > ${kind}`);
          const cards = page.locator('[data-testid="clones-row"]');
          const n = await cards.count();
          log(`(note ${theme}) ${kind} cards: ${n}`);
          for (let i = 0; i < n; i++) {
            const c = cards.nth(i);
            const t = (await c.innerText()).split('\n').join(' | ').slice(0, 260);
            log(`(note ${theme}) ${kind} card ${i}: ${t}`);
            await shot(`card-${kind.toLowerCase()}-${i}`, `${kind} card ${i}`, c);
          }
          // drawers
          for (let i = 0; i < n; i++) {
            await tryDo(`drawer ${kind} ${i}`, async () => {
              await cards.nth(i).click({ timeout: 5000 });
              await page.waitForTimeout(2200);
              await shot(`drawer-${kind.toLowerCase()}-${i}`, `${kind} drawer ${i}`);
              const drawer = page.locator('[data-testid*="drawer"]').first();
              if (await drawer.isVisible().catch(() => false)) {
                log(`(note ${theme}) ${kind} drawer ${i}: ${(await drawer.innerText()).split('\n').join(' | ').slice(0, 700)}`);
                const rows = page.locator('[data-testid="scorecard-detail-row"]');
                const rc = await rows.count();
                log(`(note ${theme}) ${kind} drawer ${i} detail rows: ${rc}`);
                if (rc) await shot(`rows-${kind.toLowerCase()}-${i}`, `${kind} drawer ${i} detail rows`, rows.first());
                await contrast('row verdict pill', '[data-testid="scorecard-row-verdict"]');
                await contrast('scorecard badge', '[data-testid="drawer-scorecard"] .badge');
                await contrast('success value', '[data-testid="clone-metric-success"], [data-testid="drawer-metrics"] dd');
                const dots = page.locator('[data-testid="scorecard-verdict-dots"]');
                if (await dots.count()) await shot(`dots-${kind.toLowerCase()}-${i}`, `${kind} drawer ${i} verdict dots`, dots.first());
              }
              await page.keyboard.press('Escape').catch(() => undefined);
              await page.waitForTimeout(700);
            });
          }
        }
        log(`(note ${theme}) horizontal overflow: ${await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)}`);
      },
      async models() {
        if (!process.env.REAL_LIBRARY) await fakeLibrary();
        await page.locator('[data-test="config-menu-item-thoth"]').click();
        await tryDo('skills tab', () => page.locator('#thoth-tab-skills').click({ timeout: 15000 }));
        await page.waitForTimeout(800);
        const cv = page.locator('[data-testid="clones-view"]');
        const tabAgents = () => cv.getByRole('tab', { name: /^Agents/ }).first();
        const tabSkills = () => cv.getByRole('tab', { name: /^Skills/ }).first();
        // FIRST load of the session held 14s (slow, under the 20s UI timeout)
        await rule({ method: 'skillSynthesis:getAgentModels', mode: 'delay', ms: 14000, times: 1 });
        await page.locator('[data-testid="skills-subview-clones"]').click({ timeout: 10000 });
        await cv.waitFor({ state: 'visible', timeout: 30000 });
        await tabAgents().click({ timeout: 10000 });
        await page.waitForTimeout(3000);
        const card = page.locator('[data-testid="clones-row"]').first();
        await shot('model-slow-3s', 'Model editor while list loading (3s)', card);
        log(`(note ${theme}) model loading text at 3s: ${await page.locator('[data-testid="agent-model-loading"]').count()}`);
        await page.waitForTimeout(8000);
        await shot('model-slow-11s', 'Model editor still loading at 11s', card);
        log(`(note ${theme}) model loading text at 11s: ${await page.locator('[data-testid="agent-model-loading"]').count()}`);
        await page.waitForTimeout(5000);
        await shot('model-slow-16s', 'Model editor after slow reply (16s)', card);
        log(`(note ${theme}) model loading text at 16s: ${await page.locator('[data-testid="agent-model-loading"]').count()}`);
        // reload held past the 20s UI timeout -> unavailable
        await rule({ method: 'skillSynthesis:getAgentModels', mode: 'delay', ms: 30000, times: 1 });
        await tabSkills().click(); await page.waitForTimeout(500); await tabAgents().click();
        await page.waitForTimeout(8000);
        await shot('model-reload-stale-8s', 'Model editor while a reload is in flight (8s)', card);
        await page.waitForTimeout(14000);
        await shot('model-unavailable', 'Model editor after UI timeout (22s)', card);
        log(`(note ${theme}) model load error present: ${await page.locator('[data-testid="agent-model-load-error"]').count()}`);
        await txt('unavailable text', '[data-testid="agent-model-load-error"]');
        await contrast('unavailable text', '[data-testid="agent-model-load-error"] span');
        await contrast('loading text', '[data-testid="agent-model-loading"]');
        await shot('model-unavailable-window', 'Window with models unavailable');
        // explicit failure (fast)
        await clearRules(); await fakeLibrary();
        await rule({ method: 'skillSynthesis:getAgentModels', mode: 'fail', error: 'Model list could not be read', ms: 200, times: 1 });
        await tabSkills().click(); await page.waitForTimeout(500); await tabAgents().click();
        await page.waitForTimeout(3000);
        await shot('model-unavailable-fast', 'Model editor, fast failure', card);
        await txt('fast failure text', '[data-testid="agent-model-load-error"]');
      },
      async enhance() {
        if (!process.env.REAL_LIBRARY) await fakeLibrary();
        await page.locator('[data-test="config-menu-item-thoth"]').click();
        await tryDo('skills tab', () => page.locator('#thoth-tab-skills').click({ timeout: 15000 }));
        await page.waitForTimeout(800);
        await page.locator('[data-testid="skills-subview-clones"]').click({ timeout: 10000 });
        await page.locator('[data-testid="clones-view"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(6000);
        await page.locator('[data-testid="clones-view"]').getByRole('tab', { name: /^Agents/ }).first().click({ timeout: 10000 });
        await page.waitForTimeout(1500);
        const body = 'You are the frontend-developer agent.\n\nBuilds Angular components, templates and styling.\n\n## Added by enhancement\n\nPrefer signals over RxJS for local state.\n';
        const draft = { before: 'You are the frontend-developer agent. Builds Angular components, templates and styling.\n', after: body, diff: '', evidence: { trajectory: '', findings: '', scorecard: '' }, model: 'test-model', sourceHash: 'seedhash-frontend-developer' };
        const ok = { proposed: true, skipReason: null, currentBody: draft.before, proposedBody: body, judgeScore: 8, judgeReason: 'The proposal adds a concrete signals guideline without changing the existing contract.', proposalId: null, draft };
        const none = { proposed: false, skipReason: 'The judge found no change worth proposing.', currentBody: draft.before, proposedBody: null, judgeScore: 3, judgeReason: 'No improvement over the current body.', proposalId: null, draft: null };
        const card = page.locator('[data-testid="clones-row"]', { hasText: 'frontend-developer' }).first();
        const btn = card.getByRole('button', { name: /Enhance now/i });
        log(`(note ${theme}) enhance btn count=${await btn.count()} enabled=${await btn.isEnabled().catch(() => 'n/a')}`);
        await shot('enhance-card', 'frontend-developer card with Enhance now', card);
        // loading
        await rule({ method: 'skillSynthesis:previewEnhancement', mode: 'fake', data: ok, ms: 4000, times: 1 });
        await btn.click();
        await page.waitForTimeout(1200);
        await shot('enhance-loading', 'Preview drawer while generating');
        await page.waitForTimeout(5000);
        await shot('enhance-draft', 'Preview drawer with draft, Save enabled');
        const save = page.locator('[data-testid="preview-save-btn"]');
        await contrast('save btn', '[data-testid="preview-save-btn"]');
        await contrast('discard btn', '[data-testid="preview-discard-btn"]');
        await contrast('verdict badge', '[data-testid="preview-verdict"]');
        await contrast('judge badge', '[data-testid="preview-judge-score"]');
        log(`(note ${theme}) save enabled w/ draft: ${await save.isEnabled()} title=${await save.getAttribute('title')}`);
        await txt('drawer text', '[role="dialog"], ptah-enhance-preview-drawer');
        // saving in flight
        await rule({ method: 'skillSynthesis:saveCloneBody', mode: 'fake', data: { written: true }, ms: 5000, times: 1 });
        await save.click();
        await page.waitForTimeout(1200);
        await shot('enhance-saving', 'Preview drawer, save in flight');
        log(`(note ${theme}) saving: label=${await save.innerText()} disabled=${await save.isDisabled()} discardDisabled=${await page.locator('[data-testid="preview-discard-btn"]').isDisabled()}`);
        await page.waitForTimeout(5500);
        await shot('enhance-after-save', 'After save settles');
        // stale refusal: reopen, then fail the save
        await rule({ method: 'skillSynthesis:previewEnhancement', mode: 'fake', data: ok, ms: 100, times: 1 });
        await btn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
        await rule({ method: 'skillSynthesis:saveCloneBody', mode: 'fail', error: 'This clone changed since the draft was created. Preview it again before saving.', ms: 200, times: 1 });
        await page.locator('[data-testid="preview-save-btn"]').click().catch(() => undefined);
        await page.waitForTimeout(1500);
        await contrast('stale alert', '[data-testid="preview-save-error"]');
        await shot('enhance-stale', 'Preview drawer after stale refusal, draft kept open');
        log(`(note ${theme}) stale: save-error=${await page.locator('[data-testid="preview-save-error"]').count()} diff=${await page.locator('[data-testid="preview-diff"]').count()} saveEnabled=${await page.locator('[data-testid="preview-save-btn"]').isEnabled().catch(() => 'n/a')}`);
        await page.locator('[data-testid="preview-discard-btn"]').click().catch(() => undefined);
        await page.waitForTimeout(800);
        // no draft
        await rule({ method: 'skillSynthesis:previewEnhancement', mode: 'fake', data: none, ms: 100, times: 1 });
        await btn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
        await contrast('save disabled', '[data-testid="preview-save-btn"]');
        await contrast('skip reason', '[data-testid="preview-skip-reason"]');
        await shot('enhance-nodraft', 'Preview drawer, no draft (Save disabled)');
        log(`(note ${theme}) nodraft: saveEnabled=${await page.locator('[data-testid="preview-save-btn"]').isEnabled().catch(() => 'n/a')} title=${await page.locator('[data-testid="preview-save-btn"]').getAttribute('title').catch(() => 'n/a')}`);
        // preview error
        await page.locator('[data-testid="preview-discard-btn"]').click().catch(() => undefined);
        await page.waitForTimeout(800);
        await rule({ method: 'skillSynthesis:previewEnhancement', mode: 'fail', error: 'Enhancement model unavailable', ms: 100, times: 1 });
        await btn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
        await shot('enhance-error', 'Preview drawer, preview failed');
        await page.locator('[data-testid="preview-discard-btn"]').click().catch(() => undefined);
        await clearRules();
      },
      async providers() {
        await page.locator('[data-test="config-menu-item-settings"]').click({ timeout: 15000 });
        await page.locator('[data-testid="settings-back"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.locator('ptah-settings').getByRole('button', { name: 'Providers', exact: true }).click({ timeout: 10000 });
        await page.waitForTimeout(3000);
        await shot('providers-top', 'Settings > Providers top');
        await tryDo('routing map', async () => {
          const rm = page.locator('[data-testid="routing-map"]');
          await rm.scrollIntoViewIfNeeded({ timeout: 10000 });
          await page.waitForTimeout(800);
          await shot('routing-map', 'Routing map', rm);
          await shot('routing-map-viewport', 'Routing map in window');
          await txt('routing map', '[data-testid="routing-map"]');
        });
        await tryDo('consumers', async () => {
          const as = page.locator('[data-testid="provider-consumer-assignments"]');
          if (!(await as.isVisible().catch(() => false))) {
            await page.locator('ptah-settings').getByRole('button', { name: 'Agent Orchestration', exact: true }).click({ timeout: 10000 });
            const summary = page.locator('[data-testid="background-roles-summary"]');
            await summary.waitFor({ state: 'attached', timeout: 30000 });
            await summary.scrollIntoViewIfNeeded();
            await shot('orch-background-summary-closed', 'Orchestration background roles summary (closed)', page.locator('[data-testid="background-roles-details"]'));
            await txt('background summary', '[data-testid="background-roles-summary"]');
            const details = page.locator('[data-testid="background-roles-details"]');
            if (!(await details.evaluate((d) => d.open))) await summary.click();
            await as.waitFor({ state: 'visible', timeout: 30000 });
          }
          await page.waitForTimeout(3000);
          await as.scrollIntoViewIfNeeded();
          await shot('consumer-assignments', 'Consumer assignments rows', as);
          await shot('consumer-assignments-viewport', 'Consumer assignments in window');
          const rows = await page.locator('[data-testid^="consumer-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
          log(`(note ${theme}) consumer rows: ${rows.join(', ')}`);
          await txt('assignments', '[data-testid="provider-consumer-assignments"]');
          // open the Enhancement row editor
          const edit = page.locator('[data-testid="consumer-edit-enhancement"]');
          log(`(note ${theme}) enhancement edit btn: ${await edit.count()}`);
          if (await edit.count()) {
            await edit.click();
            await page.waitForTimeout(1500);
            await shot('enhancement-editor', 'Enhancement row editor open', as);
            await shot('enhancement-editor-viewport', 'Enhancement editor in window');
            const close = page.locator('[data-testid="consumer-close-enhancement"]');
            if (await close.count()) await close.click();
            await page.waitForTimeout(500);
          }
          const te = page.locator('[data-testid="timeout-edit-button"]');
          if (await te.count()) {
            await te.click();
            await page.waitForTimeout(800);
            await shot('enhancement-timeout-editor', 'Timeout editor', page.locator('[data-testid="enhancement-timeout-section"]'));
            await page.locator('[data-testid="timeout-cancel-button"]').click().catch(() => undefined);
          }
        });
        await tryDo('back', () => page.locator('[data-testid="settings-back"]').click({ timeout: 5000 }));
        await page.waitForTimeout(800);
      },
    };

    for (const [label, tname] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
      if (process.env.THEMES && !process.env.THEMES.split(',').includes(label)) continue;
      theme = label;
      await page.locator('[data-test="config-menu-item-thoth"]').waitFor({ state: 'visible', timeout: 60_000 });
      await setTheme(tname);
      for (const [name, fn] of Object.entries(stages)) {
        if (ONLY && !ONLY.split(',').includes(name)) continue;
        log(`== stage ${name} (${theme})`);
        await tryDo('stage ' + name, async () => { await fn(); });
        await clearRules().catch(() => undefined);
        await page.keyboard.press('Escape').catch(() => undefined);
        // back to a neutral place
        await page.locator('[data-testid="settings-back"]').click({ timeout: 1500 }).catch(() => undefined);
        await page.waitForTimeout(500);
      }
    }
    // --- diagnostics for listClones
    try { for (const f of fs.readdirSync(path.join(udd, 'logs'))) fs.copyFileSync(path.join(udd, 'logs', f), path.join(outDir, 'udd-' + f.replace(/ /g, '_'))); } catch (_) { /* */ }
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath);
      log('DIAG indexes: ' + JSON.stringify(db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_skill%'").all()));
      log('DIAG user_version/migrations: ' + JSON.stringify(db.prepare("SELECT MAX(version) v FROM schema_migrations").all()));
      for (const q of [
        "SELECT COUNT(*) AS graded FROM skill_task_grades INDEXED BY idx_skill_task_grades_subject WHERE subject_kind='agent' AND subject_slug='x'",
        "SELECT COUNT(*) c, COUNT(DISTINCT context_id) d FROM skill_invocation_events WHERE skill_slug='x'",
      ]) { try { log('DIAG ok: ' + JSON.stringify(db.prepare(q).all()) + ' <- ' + q.slice(0, 60)); } catch (e) { log('DIAG ERROR: ' + e.message + ' <- ' + q.slice(0, 80)); } }
      db.close();
    } catch (e) { log('DIAG open failed ' + e.message); }
    const walk = (d, acc = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name); if (f.isDirectory()) walk(fp, acc); else if (/\.(log|txt)$/i.test(f.name)) acc.push(fp); } return acc; };
    for (const f of walk(tmp)) { try { const t = fs.readFileSync(f, 'utf8'); const lines = t.split(String.fromCharCode(10)).filter((l) => /listClones|getInvocationStats|no such|INDEXED|SqliteError|ZodError/i.test(l)); log('DIAG logfile ' + f.replace(tmp, '') + ' (' + t.length + 'b): ' + lines.slice(0, 6).join(' || ').slice(0, 1500)); } catch (_) { /* */ } }
    log('rpc log tail: ' + JSON.stringify((await app.evaluate(() => globalThis.__log.slice(-60)))));
  } finally {
    await app.close().catch(() => undefined);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.writeFileSync(path.join(outDir, 'main-log.txt'), mainLog.join(''));
    fs.writeFileSync(path.join(outDir, `index-raw${ONLY ? '-' + ONLY.replace(/,/g, '_') : ''}.txt`), index.join('\n'));
  }
}
main().catch((e) => { console.error('CAPTURE FAILED', e); process.exit(1); });
