/**
 * Batch 22 AFTER capture, part 2: the new "Decision model" card (consumer-row-decision), dark + light.
 *
 * Usage:  node capture-decision-card.cjs <worktreeRoot> <outDir> <prefix> [scenario,scenario,...]
 *
 * Each scenario launches its own isolated Electron (same isolation as capture-orchestration-settings.cjs:
 * temp HOME/USERPROFILE, temp --user-data-dir, temp PTAH_DB_PATH, NODE_ENV=test, PTAH_E2E=1, temp workspace
 * with a .ptah marker). The real ~/.ptah and the real %APPDATA%\Ptah Dev profile are never read or written.
 *
 * Seeding (isolated profile only): <udd>/config.json = { ptah: { "agentOrchestration.decisionModel": ... } }
 * (ElectronWorkspaceProvider config file, electron-workspace-provider.ts:69,90-100) and
 * <isolated HOME>/.ptah/settings.json = { "provider.ollama.baseUrl": ... } (a file-based key by pattern).
 * (Run 1 wrongly seeded the base URL into config.json; it was ignored and the app probed the machine's real
 * Ollama at 127.0.0.1:11434. Those run-1 Ollama shots were discarded.)
 * A tiny local HTTP mock (127.0.0.1, random port) plays the Ollama endpoint for the unsupported / ready states.
 * The "unreachable" state points provider.ollama.baseUrl at 127.0.0.1:1 (connection refused).
 *
 * Scenarios:
 *   default            unset card, editor (all four kinds, Jev kind + key field, keyboard focus pass), 1100 and 700 wide
 *   ollama-unreachable decisionModel=ollama/tev1, baseUrl=http://127.0.0.1:1
 *   ollama-unsupported decisionModel=ollama/tev1, mock reports Ollama 0.34.2
 *   ollama-ready       decisionModel=ollama/tev1, mock reports 0.35.0 and serves /v1/systemone
 *   jev-nokey          decisionModel=jev, no key stored (no-credential, remote)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createRequire } = require('module');

const root = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const prefix = process.argv[4] || 'after';
const only = (process.argv[5] || '').split(',').filter(Boolean);
const WIDE = { width: 1100, height: 700 };
const NARROW = { width: 700, height: 700 };

const req = createRequire(path.join(root, 'package.json'));
const { _electron } = req('@playwright/test');

const metrics = [];

function startMock(kind) {
  return new Promise((resolve) => {
    const server = http.createServer((rq, rs) => {
      const url = rq.url || '';
      if (url.startsWith('/api/version')) {
        rs.writeHead(200, { 'content-type': 'application/json' });
        rs.end(JSON.stringify({ version: kind === 'old' ? '0.34.2' : '0.35.0' }));
      } else if (url.startsWith('/v1/systemone-ptah-probe-absent')) {
        rs.writeHead(404, { 'content-type': 'text/plain' });
        rs.end('404 page not found');
      } else if (url.startsWith('/v1/systemone') && kind === 'new') {
        rs.writeHead(400, { 'content-type': 'application/json' });
        rs.end(JSON.stringify({ error: 'invalid request' }));
      } else if (url.startsWith('/api/tags')) {
        rs.writeHead(200, { 'content-type': 'application/json' });
        rs.end(JSON.stringify({ models: [] }));
      } else {
        rs.writeHead(404, { 'content-type': 'text/plain' });
        rs.end('404 page not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const SCENARIOS = {
  default: { seed: null, full: true },
  kinds: { seed: null, kindsOnly: true },
  sibling: { seed: null, siblingOnly: true },
  'ollama-unreachable': {
    seed: () => ({ model: { kind: 'ollama', model: 'tev1' }, baseUrl: 'http://127.0.0.1:1' }),
  },
  'ollama-unsupported': { mock: 'old', seed: (u) => ({ model: { kind: 'ollama', model: 'tev1' }, baseUrl: u }) },
  'ollama-ready': { mock: 'new', seed: (u) => ({ model: { kind: 'ollama', model: 'tev1' }, baseUrl: u }) },
  'jev-nokey': { seed: () => ({ model: { kind: 'jev', model: 'jev-1.13.0' }, baseUrl: 'http://127.0.0.1:1' }) },
};

/** In-page helpers: contrast of every text-bearing element in a root, computed in sRGB via a canvas. */
const MEASURE = `(rootSel) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0,0,1,1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2],d[3]/255]; };
  const over = (top, bot) => { const a = top[3]; return [top[0]*a+bot[0]*(1-a), top[1]*a+bot[1]*(1-a), top[2]*a+bot[2]*(1-a), 1]; };
  const bgOf = (el) => { const layers = []; let n = el; while (n && n.nodeType === 1) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; n = n.parentElement; } let base = [255,255,255,1]; if (!layers.length || layers[layers.length-1][3] < 1) { base = rgba(getComputedStyle(document.documentElement).backgroundColor); if (base[3] < 1) base = [255,255,255,1]; } for (let i = layers.length-1; i >= 0; i--) base = over(layers[i], base); return base; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05); };
  const hex = (c) => '#' + c.slice(0,3).map((v) => Math.round(v).toString(16).padStart(2,'0')).join('');
  const out = [];
  const rootEl = document.querySelector(rootSel);
  if (!rootEl) return out;
  const els = [rootEl, ...rootEl.querySelectorAll('*')];
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('data-testid') || el.id || '';
    if (direct && r.width > 0) {
      const bg = bgOf(el); const fg = over(rgba(cs.color), bg);
      out.push({ kind: 'text', el: tag + (id ? '#' + id : ''), text: direct.slice(0, 70), fontPx: cs.fontSize, weight: cs.fontWeight, fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2) });
    }
    if ((tag === 'input' || tag === 'select') && r.width > 0) {
      const bg = bgOf(el); const fg = over(rgba(cs.color), bg);
      const bc = over(rgba(cs.borderTopColor), bgOf(el.parentElement));
      out.push({ kind: 'control-text', el: tag + (id ? '#' + id : ''), value: tag === 'input' && el.type === 'password' ? '(password, length ' + el.value.length + ')' : (el.value || '').slice(0, 40), fontPx: cs.fontSize, fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2), borderHex: hex(bc), borderVsSurround: +ratio(bc, bgOf(el.parentElement)).toFixed(2), borderWidth: cs.borderTopWidth });
      if (tag === 'input' && el.placeholder) {
        const pc = getComputedStyle(el, '::placeholder'); const pfg = over(rgba(pc.color), bg);
        out.push({ kind: 'placeholder', el: tag + (id ? '#' + id : ''), text: el.placeholder, fg: hex(pfg), bg: hex(bg), ratio: +ratio(pfg, bg).toFixed(2) });
      }
    }
    if ((tag === 'button' || tag === 'select' || tag === 'input') && r.width > 0) {
      out.push({ kind: 'target', el: tag + (id ? '#' + id : ''), label: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40), w: +r.width.toFixed(1), h: +r.height.toFixed(1), disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' });
    }
    if (tag === 'svg' && r.width > 0) {
      const bg = bgOf(el); const fg = over(rgba(cs.color), bg);
      out.push({ kind: 'icon', el: 'svg', fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2), w: +r.width.toFixed(1) });
    }
  }
  return out;
}`;

const OVERFLOW = `(rootSel) => {
  const rootEl = document.querySelector(rootSel); if (!rootEl) return null;
  const clipped = [];
  for (const el of [rootEl, ...rootEl.querySelectorAll('*')]) {
    const cs = getComputedStyle(el); if (cs.display === 'none') continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.display !== 'inline') clipped.push({ el: el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? '#' + el.getAttribute('data-testid') : ''), scrollW: el.scrollWidth, clientW: el.clientWidth, overflowX: cs.overflowX, textOverflow: cs.textOverflow });
  }
  const r = rootEl.getBoundingClientRect();
  return { box: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }, docScrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, clipped };
}`;

const STYLE_COMPARE = `() => {
  const pick = (sel, props) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs[p]; const r = el.getBoundingClientRect(); o.h = +r.height.toFixed(1); o.w = +r.width.toFixed(1); return o; };
  const out = {};
  for (const id of ['synthesis', 'decision']) {
    out[id] = {
      article: pick('[data-testid="consumer-row-' + id + '"]', ['paddingTop','paddingLeft','borderRadius','backgroundColor','display','gap']),
      name: pick('[data-testid="consumer-name-' + id + '"]', ['fontSize','fontWeight','lineHeight','color']),
      badge: pick('[data-testid="consumer-tier-' + id + '"]', ['fontSize','lineHeight','backgroundColor','color','paddingLeft']),
      cell: pick('[data-testid="consumer-edit-' + id + '"]', ['fontSize','color','paddingLeft','gap']),
    };
  }
  return out;
}`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const names = Object.keys(SCENARIOS).filter((n) => !only.length || only.includes(n));
  for (const name of names) {
    const before = metrics.length;
    await runScenario(name, SCENARIOS[name]);
    // Batch 40 recheck: write metrics per scenario so a stopped run keeps what it measured.
    fs.writeFileSync(path.join(outDir, `${prefix}-decision-metrics-${name}.json`), JSON.stringify(metrics.slice(before), null, 2));
  }
  fs.writeFileSync(path.join(outDir, `${prefix}-decision-metrics-${names.join('+')}.json`), JSON.stringify(metrics, null, 2));
  console.log('metrics written');
}

async function runScenario(name, sc) {
  console.log(`\n===== scenario ${name} =====`);
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-646-b22d-')));
  const home = path.join(tmp, 'home');
  const udd = path.join(tmp, 'udd');
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(udd, { recursive: true });
  fs.mkdirSync(path.join(ws, '.ptah'), { recursive: true });

  let mock = null;
  let seedInfo = null;
  if (sc.seed) {
    let url = null;
    if (sc.mock) {
      mock = await startMock(sc.mock);
      url = `http://127.0.0.1:${mock.address().port}`;
    }
    const s = sc.seed(url);
    seedInfo = s;
    // The selection lives in the per-app config.json; `provider.<id>.baseUrl` matches PROVIDER_BASE_URL_PATTERN
    // (platform-core file-settings-keys.ts:724,775), so it is a file-based setting: <HOME>/.ptah/settings.json (isolated HOME).
    fs.writeFileSync(
      path.join(udd, 'config.json'),
      JSON.stringify({ ptah: { 'agentOrchestration.decisionModel': s.model } }, null, 2),
    );
    fs.mkdirSync(path.join(home, '.ptah'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ptah', 'settings.json'), JSON.stringify({ 'provider.ollama.baseUrl': s.baseUrl }, null, 2));
    console.log('seeded isolated config.json:', JSON.stringify(s));
  } else {
    // Batch 40 recheck guard: scenarios without a seed (default/kinds/sibling) still open the Ollama kind or the
    // provider model loaders; point the isolated HOME at a refused port so the real Ollama (127.0.0.1:11434) is never probed.
    fs.mkdirSync(path.join(home, '.ptah'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ptah', 'settings.json'), JSON.stringify({ 'provider.ollama.baseUrl': 'http://127.0.0.1:1' }, null, 2));
    console.log('guard: isolated ollama baseUrl -> http://127.0.0.1:1');
  }

  const entry = path.join(root, 'dist', 'apps', 'ptah-electron', 'main.mjs');
  const env = { ...process.env, NODE_ENV: 'test', PTAH_E2E: '1', PTAH_DB_PATH: path.join(tmp, 'ptah.sqlite'), HOME: home, USERPROFILE: home };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [entry, `--user-data-dir=${udd}`, ws], env, timeout: 90_000 });
  console.log('electron pid:', app.process().pid);
  const echoAll=(c)=>{for(const l of c.toString('utf8').split(String.fromCharCode(10))){ if(/decision|Decision|getConfig|agent:|config.json|selection|error|Error|warn/i.test(l)) console.log('[app]', l.trim().slice(0,400)); }};
  app.process().stdout&&app.process().stdout.on('data',echoAll); app.process().stderr&&app.process().stderr.on('data',echoAll);
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForURL((u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'), { timeout: 90_000 });
    const resize = async (vp) => {
      await app.evaluate(({ BrowserWindow }, v) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w.isMaximized()) w.unmaximize();
        w.setContentSize(v.width, v.height);
        w.center();
      }, vp);
      await page.waitForTimeout(900);
      console.log('actual viewport:', JSON.stringify(await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }))));
    };
    await resize(WIDE);
    await page.waitForTimeout(1000);

    const log = (m) => console.log('[step]', m);
    const shot = async (state, theme, width) => {
      const p = path.join(outDir, `${prefix}-decision-${name}-${state}-${theme}${width ? '-' + width : ''}.png`);
      await page.screenshot({ path: p });
      console.log('SHOT', path.basename(p));
    };
    const elShot = async (sel, state, theme, width) => {
      const p = path.join(outDir, `${prefix}-decision-${name}-${state}-${theme}${width ? '-' + width : ''}.png`);
      await page.locator(sel).first().screenshot({ path: p });
      console.log('SHOT', path.basename(p));
    };
    async function setTheme(themeName) {
      await page.locator('[aria-label="Change theme"]').first().click();
      await page.locator(`button[data-theme="${themeName}"]`).first().click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
      await page.waitForTimeout(800);
      console.log('theme now:', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    }

    // Navbar > Settings > Agent Orchestration > expand Background Model Roles.
    await page.locator('[data-test="config-menu-item-settings"]').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('[data-test="config-menu-item-settings"]').click();
    await page.locator('[data-testid="settings-back"]').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('ptah-settings').getByRole('button', { name: 'Agent Orchestration', exact: true }).click();
    const details = page.locator('[data-testid="background-roles-details"]');
    await details.waitFor({ state: 'attached', timeout: 30_000 });
    if (!(await details.evaluate((d) => d.open))) await page.locator('[data-testid="background-roles-summary"]').click();
    await page.locator('[data-testid="provider-consumer-assignments"]').waitFor({ state: 'visible', timeout: 30_000 });
    const card = page.locator('[data-testid="consumer-row-decision"]');
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    // The status read can take the 1.5 s probe budget; wait until the badge leaves "loading".
    await page
      .waitForFunction(() => {
        const b = document.querySelector('[data-testid="consumer-tier-decision"]');
        return b && b.textContent.trim() !== 'loading';
      }, null, { timeout: 20_000 })
      .catch(() => log('WARN: badge still loading'));
    await page.waitForTimeout(3000);

    const rowIds = await page.locator('[data-testid^="consumer-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    console.log('consumer rows:', rowIds.length, JSON.stringify(rowIds));
    console.log('summary badge:', await page.locator('[data-testid="background-roles-summary"] .badge').first().innerText().catch(() => '?'));

    const themes = [['dark', 'anubis'], ['light', 'anubis-light']];
    const cardState = async (theme, width) => {
      await page.mouse.move(5, 5);
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector('[data-testid="consumer-row-decision"]').scrollIntoView({ block: 'end' }));
      await page.waitForTimeout(500);
      await shot('viewport', theme, width);
      await elShot('[data-testid="consumer-row-decision"]', 'card', theme, width);
      const text = await card.innerText();
      const rec = {
        scenario: name, theme, width: width || 1100, seed: seedInfo,
        cardText: text,
        measure: await page.evaluate(`(${MEASURE})('[data-testid="consumer-row-decision"]')`),
        overflow: await page.evaluate(`(${OVERFLOW})('[data-testid="consumer-row-decision"]')`),
      };
      if (!width) rec.styleCompare = await page.evaluate(`(${STYLE_COMPARE})()`);
      metrics.push(rec);
      console.log(`[${theme}${width ? ' ' + width : ''}] card text:`, JSON.stringify(text));
    };
    const openEditor = async () => {
      await card.scrollIntoViewIfNeeded();
      await page.locator('[data-testid="consumer-edit-decision"]').click();
      await page.locator('[data-testid="consumer-editor-decision"]').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => log('WARN: editor not visible'));
      await page.waitForTimeout(1200);
    };
    const closeEditor = async () => {
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(400);
      if (await page.locator('[data-testid="consumer-editor-decision"]').isVisible().catch(() => false)) {
        await page.locator('[data-testid="consumer-close-decision"]').click().catch(() => undefined);
        await page.waitForTimeout(400);
      }
      if (await page.locator('[data-testid="consumer-editor-decision"]').isVisible().catch(() => false)) {
        await page.mouse.click(5, 5).catch(() => undefined); // transparent backdrop closes the popover
        await page.waitForTimeout(400);
      }
      console.log('editor still open:', await page.locator('[data-testid="consumer-editor-decision"]').isVisible().catch(() => false));
    };
    const editorMetrics = async (theme, width, tag) => {
      metrics.push({
        scenario: name, theme, width: width || 1100, editor: tag,
        measure: await page.evaluate(`(${MEASURE})('[data-testid="consumer-editor-decision"]')`),
        overflow: await page.evaluate(`(${OVERFLOW})('[data-testid="consumer-editor-decision"]')`),
        kindOptions: await page.locator('#decision-model-kind option').allInnerTexts().catch(() => []),
        selectedKind: await page.locator('#decision-model-kind').inputValue().catch(() => null),
      });
    };

    // Whole-section element shot (all 7 rows) for the state scenarios.
    for (const [theme, themeName] of themes) {
      await setTheme(themeName);
      await cardState(theme);
      if (sc.siblingOnly) {
        // Reference measurement on the EXISTING Synthesis editor: control borders and placeholder contrast.
        await page.locator('[data-testid="consumer-edit-synthesis"]').scrollIntoViewIfNeeded();
        await page.locator('[data-testid="consumer-edit-synthesis"]').click();
        await page.locator('[data-testid="consumer-editor-synthesis"]').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        await page.locator('[data-testid="consumer-editor-synthesis"] summary').first().click().catch(() => undefined);
        await page.waitForTimeout(500);
        await shot('synthesis-editor', theme);
        metrics.push({ scenario: name, theme, editor: 'synthesis-editor', measure: await page.evaluate(`(${MEASURE})('[data-testid="consumer-editor-synthesis"]')`) });
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.mouse.click(5, 5).catch(() => undefined);
        await page.waitForTimeout(500);
        continue;
      }
      if (sc.kindsOnly) {
        await openEditor();
        await page.evaluate(() => { const s = document.getElementById('decision-model-kind'); if (s) { s.size = 4; s.style.height = 'auto'; s.style.minHeight = '5.5rem'; } });
        await page.waitForTimeout(400);
        console.log(`[${theme}] kinds:`, JSON.stringify(await page.locator('#decision-model-kind option').allInnerTexts()));
        await shot('editor-kinds', theme);
        await closeEditor();
        continue;
      }
      if (sc.full) continue; // default scenario does its editor passes below
      await openEditor();
      await shot('editor', theme);
      await editorMetrics(theme, 0, 'editor');
      await closeEditor();
    }

    if (sc.full) {
      for (const [width, vp] of [[0, WIDE], [700, NARROW]]) {
        if (width) {
          await resize(vp);
          await page.waitForTimeout(800);
          for (const [theme, themeName] of themes) {
            await setTheme(themeName);
            await cardState(theme, width);
          }
        }
        for (const [theme, themeName] of themes) {
          await setTheme(themeName);
          // 1) editor open on the default (unset) selection.
          await openEditor();
          await shot('editor-unset', theme, width);
          await editorMetrics(theme, width, 'editor-unset');
          // 2) the four kinds: expand the native <select> inline (size=4 is a DOM tweak for the screenshot only).
          const kinds = await page.locator('#decision-model-kind option').allInnerTexts();
          console.log(`[${theme}] kinds:`, JSON.stringify(kinds));
          await page.evaluate(() => { const s = document.getElementById('decision-model-kind'); if (s) { s.size = 4; s.style.height = 'auto'; s.style.minHeight = '5.5rem'; } });
          await page.waitForTimeout(400);
          await shot('editor-kinds', theme, width);
          await page.evaluate(() => { const s = document.getElementById('decision-model-kind'); if (s) { s.removeAttribute('size'); s.style.height = ''; s.style.minHeight = ''; } });
          // 3) Jev kind: model + write-only key field, empty.
          await page.locator('#decision-model-kind').selectOption('jev');
          await page.waitForTimeout(800);
          await shot('editor-jev', theme, width);
          await editorMetrics(theme, width, 'editor-jev');
          console.log(`[${theme}] jev key field:`, JSON.stringify(await page.evaluate(() => {
            const k = document.getElementById('decision-model-jev-key');
            return k ? { type: k.type, valueLength: k.value.length, autocomplete: k.autocomplete, ariaDescribedBy: k.getAttribute('aria-describedby') } : null;
          })));
          // 4) Ollama kind and Structured kind editors (no save).
          await page.locator('#decision-model-kind').selectOption('ollama');
          await page.waitForTimeout(1200);
          await shot('editor-ollama', theme, width);
          await editorMetrics(theme, width, 'editor-ollama');
          await page.locator('#decision-model-kind').selectOption('structured');
          await page.waitForTimeout(800);
          await shot('editor-structured', theme, width);
          await editorMetrics(theme, width, 'editor-structured');
          // 5) back to Jev and type a dummy key to show it stays masked (never saved: the editor is closed with Escape).
          await page.locator('#decision-model-kind').selectOption('jev');
          await page.waitForTimeout(500);
          await page.locator('#decision-model-jev-key').fill('dummy-not-a-real-key-123');
          await page.waitForTimeout(300);
          await shot('editor-jev-typed', theme, width);
          console.log(`[${theme}] typed-key field:`, JSON.stringify(await page.evaluate(() => { const k = document.getElementById('decision-model-jev-key'); return { type: k.type, valueLength: k.value.length }; })));
          await closeEditor();
          // After closing, the typed key must be dropped; reopen and confirm the field is empty again.
          await openEditor();
          await page.locator('#decision-model-kind').selectOption('jev');
          await page.waitForTimeout(500);
          console.log(`[${theme}] jev key after reopen (unsaved):`, JSON.stringify(await page.evaluate(() => { const k = document.getElementById('decision-model-jev-key'); return k ? { valueLength: k.value.length } : null; })));
          await closeEditor();
          // Selection must still be unset (nothing was saved).
          console.log(`[${theme}] card after cancel:`, JSON.stringify(await card.innerText()));
        }
      }

      // Keyboard focus pass in the editor (1100 wide, Jev kind so every field is present).
      await resize(WIDE);
      for (const [theme, themeName] of themes) {
        await setTheme(themeName);
        await openEditor();
        await page.locator('#decision-model-kind').selectOption('jev');
        await page.waitForTimeout(600);
        // Start from the cell (the focus the editor was opened from), then Tab.
        await page.locator('[data-testid="consumer-edit-decision"]').focus();
        const stops = [];
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(250);
          const info = await page.evaluate(() => {
            const a = document.activeElement; if (!a || a === document.body) return { tag: 'body' };
            const cs = getComputedStyle(a); const r = a.getBoundingClientRect();
            return {
              tag: a.tagName.toLowerCase(), id: a.id || '', testid: a.getAttribute('data-testid') || '', aria: a.getAttribute('aria-label') || '',
              text: (a.textContent || '').trim().slice(0, 40),
              focusVisible: a.matches(':focus-visible'),
              outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`, boxShadow: cs.boxShadow === 'none' ? '' : cs.boxShadow.slice(0, 80),
              inEditor: !!a.closest('[data-testid="consumer-editor-decision"]'), inCard: !!a.closest('[data-testid="consumer-row-decision"]'),
              rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            };
          });
          stops.push(info);
          console.log(`[${theme}] tab ${i + 1}:`, JSON.stringify(info));
          await shot(`focus-${String(i + 1).padStart(2, '0')}`, theme);
          if (info.tag === 'body' || !info.inEditor) break; // focus left the editor: stop (no focus containment)
        }
        metrics.push({ scenario: name, theme, focusStops: stops });
        await closeEditor();
      }
      // Sibling reference: does the existing Synthesis editor contain focus? (same Tab walk from its cell)
      {
        await page.locator('[data-testid="consumer-edit-synthesis"]').scrollIntoViewIfNeeded();
        await page.locator('[data-testid="consumer-edit-synthesis"]').click();
        await page.locator('[data-testid="consumer-editor-synthesis"]').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        const sib = [];
        for (let i = 0; i < 8; i++) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(200);
          const info = await page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName.toLowerCase(), testid: a.getAttribute('data-testid') || '', aria: a.getAttribute('aria-label') || '', text: (a.textContent || '').trim().slice(0, 30), inEditor: !!a.closest('[data-testid="consumer-editor-synthesis"]') }; });
          sib.push(info);
          if (!info.inEditor) break;
        }
        console.log('[sibling synthesis] tab walk:', JSON.stringify(sib));
        metrics.push({ scenario: name, siblingFocusStops: sib });
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.mouse.click(5, 5).catch(() => undefined);
        await page.waitForTimeout(500);
      }
    }

    // Section-level shot (all seven rows) at the end of every scenario, current theme (light) and then dark.
    for (const [theme, themeName] of themes.slice().reverse()) {
      await resize(WIDE);
      await setTheme(themeName);
      await page.evaluate(() => document.querySelector('[data-testid="background-roles-summary"]').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(500);
      const sp = path.join(outDir, `${prefix}-decision-${name}-section-${theme}.png`);
      await details.screenshot({ path: sp });
      console.log('SHOT', path.basename(sp), JSON.stringify(await details.boundingBox()));
    }
  } finally {
    try { console.log('[final config.json]', fs.readFileSync(path.join(udd,'config.json'),'utf8').replace(/s+/g,' ')); } catch (e) { console.log('[final config.json] missing', e.message); }
    try {
      const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (/.(log|jsonl)$/.test(e.name)) o.push(p); } return o; };
      const fl = walk(tmp);
      console.log('[files]', fl.map((f) => path.relative(tmp, f) + ':' + fs.statSync(f).size).join(' | '));
      for (const f of fl) { const t = fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).filter((l) => /decision|getConfig|agent:|error|warn/i.test(l)).slice(-25); console.log('[logfile]', path.relative(tmp, f)); t.forEach((l) => console.log('   ', l.slice(0, 400))); }
    } catch (e) { console.log('walk fail', e.message); }

    await app.close().catch(() => undefined);
    if (mock) mock.close();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('CAPTURE FAILED', e);
  process.exit(1);
});
