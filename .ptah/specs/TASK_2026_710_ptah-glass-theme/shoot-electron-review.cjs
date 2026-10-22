// Electron visual review (revision 2 ::after blur layer) for TASK_2026_710.
//   node .ptah/specs/TASK_2026_710_ptah-glass-theme/shoot-electron-review.cjs
// Derived from shoot-electron.cjs. Uses the real theme picker (no attribute hacks), seeded Claude-CLI
// sessions (isolated HOME), and a temp workspace. Output: shots-review/.
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const root = path.resolve(__dirname, '..', '..', '..');
const entry = path.join(root, 'dist', 'apps', 'ptah-electron', 'main.mjs');
const out = path.join(__dirname, 'shots-review');
fs.mkdirSync(out, { recursive: true });
const log = [];
const note = (k, v) => {
  const s = `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`;
  console.log(s.slice(0, 900));
  log.push(s);
};

// ---- seed ----
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-rv-home-'));
const ws = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-rv-ws-')));
fs.writeFileSync(path.join(ws, 'README.md'), '# demo\n');
fs.writeFileSync(path.join(ws, 'app.ts'), 'export const x = 1;\n');
try {
  const { execSync } = require('child_process');
  execSync('git init -q && git add -A && git -c user.email=a@b.c -c user.name=rv commit -qm init', { cwd: ws });
  fs.writeFileSync(path.join(ws, 'app.ts'), 'export const x = 2;\nexport const y = 3;\n');
  fs.writeFileSync(path.join(ws, 'new.ts'), 'export {};\n');
} catch (e) {
  console.log('git seed failed', e.message);
}
const sessDir = path.join(home, '.claude', 'projects', ws.replace(/[:\\/]/g, '-'));
fs.mkdirSync(sessDir, { recursive: true });
function writeSession(records, ageMin) {
  const id = randomUUID();
  let parent = null;
  let t = Date.now() - ageMin * 60000;
  const lines = records.map((r) => {
    const uuid = randomUUID();
    const rec = {
      parentUuid: parent,
      isSidechain: false,
      userType: 'external',
      cwd: ws,
      sessionId: id,
      version: '1.0.0',
      uuid,
      timestamp: new Date((t += 4000)).toISOString(),
      ...r,
    };
    parent = uuid;
    return JSON.stringify(rec);
  });
  fs.writeFileSync(path.join(sessDir, `${id}.jsonl`), lines.join('\n') + '\n');
  return id;
}
const u = (content) => ({ type: 'user', message: { role: 'user', content } });
const a = (content, stop = 'end_turn') => ({
  type: 'assistant',
  message: {
    id: 'msg_' + randomUUID().slice(0, 8),
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content,
    stop_reason: stop,
    usage: { input_tokens: 120, output_tokens: 240 },
  },
});
writeSession(
  [
    u('Refactor the theme service so accent handling is isolated, then run the tests.'),
    a(
      [
        { type: 'text', text: 'I will start by reading the service and its spec to understand how accents are applied.' },
        { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: 'libs/frontend/core/src/lib/services/theme.service.ts' } },
      ],
      'tool_use',
    ),
    u([{ type: 'tool_result', tool_use_id: 'toolu_01', content: "export class ThemeService {\n  private readonly accent = signal('gold');\n  apply(theme: string) { document.documentElement.setAttribute('data-theme', theme); }\n}\n" }]),
    a(
      [
        { type: 'text', text: 'The accent state lives in the same class as theme switching. I will run the focused tests to get a baseline.' },
        { type: 'tool_use', id: 'toolu_02', name: 'Bash', input: { command: 'npx jest -c libs/frontend/core/jest.config.ts theme.service.spec.ts --coverage=false', description: 'Run the theme service spec' } },
      ],
      'tool_use',
    ),
    u([{ type: 'tool_result', tool_use_id: 'toolu_02', content: 'PASS libs/frontend/core/src/lib/services/theme.service.spec.ts\n  ThemeService\n    ok applies theme (4 ms)\n    ok persists accent (2 ms)\n\nTests: 2 passed, 2 total' }]),
    a([
      {
        type: 'text',
        text:
          '## Result\n\nBaseline is green, so the split is safe.\n\n- Extract `AccentService` with the `accent` signal\n- Keep `ThemeService.apply()` as the single DOM writer\n- Add two specs for persistence\n\n```ts\nexport class AccentService {\n  readonly accent = signal<"gold" | "rose" | "moonstone">("gold");\n}\n```\n\nA long unbroken path to check wrapping: libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts and then more prose so the card has multiple lines of text to measure padding against.',
      },
    ]),
  ],
  5,
);
writeSession([u('Fix the settings page spacing'), a([{ type: 'text', text: 'Done. The gap between the tab strip and the first card is now 16px.' }])], 60);
writeSession([u('Explain the routing map'), a([{ type: 'text', text: 'It lists the main agent, background roles and the CLI matrix.' }])], 180);

// ---- helpers ----
const { PNG } = require('playwright-core/lib/utilsBundle');
const relLum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
// Pixel-sampled contrast: bg = most common colour in the element's box (after blur), fg = mean of the 4% of pixels farthest from bg.
async function pc(label, locator) {
  try {
    const bb = await locator.first().boundingBox({ timeout: 4000 });
    const buf = await win.screenshot({ clip: { x: Math.max(0, bb.x), y: Math.max(0, bb.y), width: Math.max(2, Math.min(bb.width, 1400)), height: Math.max(2, Math.min(bb.height, 300)) } });
    const png = PNG.sync.read(buf);
    const px = []; const counts = new Map();
    for (let i = 0; i < png.data.length; i += 4) { const c = [png.data[i], png.data[i + 1], png.data[i + 2]]; px.push(c); const k = c.map((v) => v >> 2).join(','); counts.set(k, (counts.get(k) || 0) + 1); }
    let best = null, bn = 0; for (const [k, n] of counts) if (n > bn) { bn = n; best = k; }
    const bg = best.split(',').map((v) => +v * 4 + 2);
    const d = (c) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
    const sorted = px.map((c) => [d(c), c]).sort((x, y) => y[0] - x[0]);
    const top = sorted.slice(0, Math.max(3, Math.floor(sorted.length * 0.01))).map((x) => x[1]);
    const fg = [0, 1, 2].map((i) => Math.round(top.reduce((s, c) => s + c[i], 0) / top.length));
    const L1 = relLum(fg), L2 = relLum(bg);
    note(`contrast.${label}`, { fg: fg.join(','), bg: bg.join(','), ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2) });
  } catch (e) { note(`contrast.${label}`, 'n/a ' + e.message.split('\n')[0]); }
}
let win;
let app;
const shot = async (name) => {
  await win.waitForTimeout(350);
  await win.screenshot({ path: path.join(out, `${name}.png`) });
  note('shot', name);
};
const picker = () => win.locator('button[aria-label="Change theme"]');
async function pickerVisible() {
  return win.locator('ptah-theme-toggle [role="tablist"]:visible').count();
}
async function openPicker() {
  if (!(await pickerVisible())) {
    await picker().click();
    await win.waitForTimeout(500);
  }
}
async function pickerState() {
  return win.evaluate(() => {
    const dd = document.querySelector('ptah-theme-toggle [aria-label="Theme"]');
    if (!dd) return null;
    const r = dd.getBoundingClientRect();
    const tabs = [...dd.querySelectorAll('[role=tab]')].map((t) => `${t.textContent.trim()}:${t.getAttribute('aria-selected')}`);
    const tiles = [...dd.querySelectorAll('button[data-theme]')].map((t) => `${t.getAttribute('aria-label')}${t.getAttribute('aria-pressed') === 'true' ? '*' : ''}`);
    const topEl = document.elementFromPoint(r.x + r.width / 2, r.y + 20);
    return {
      h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y), tabs, tiles,
      inTopLayer: !!dd.closest('[popover]'),
      hit: dd.contains(topEl),
      attrs: ['data-theme', 'data-glass', 'data-accent'].map((k) => `${k}=${document.documentElement.getAttribute(k)}`),
    };
  });
}
async function tab(name) {
  await win.locator('ptah-theme-toggle [role=tab]', { hasText: name }).first().click();
  await win.waitForTimeout(400);
}
async function tile(label) {
  await win.locator(`ptah-theme-toggle button[data-theme][aria-label="${label}"]`).first().click();
  await win.waitForTimeout(700);
}
async function accent(label) {
  await win.locator(`ptah-theme-toggle label[title="${label}"]`).first().click();
  await win.waitForTimeout(500);
}
async function closePicker() {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
}
async function contrast(sel) {
  return win.evaluate((s) => {
    const parse = (c) => c.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const el = document.querySelector(s);
    if (!el) return null;
    const fg = parse(getComputedStyle(el).color);
    const layers = [];
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      const al = c[3] === undefined ? 1 : c[3];
      if (al > 0) layers.push(c);
      if (al === 1) break;
      n = n.parentElement;
    }
    let base = document.documentElement.getAttribute('data-theme-mode') === 'dark' ? [20, 20, 22] : [250, 250, 250];
    for (const c of layers.reverse()) {
      const al = c[3] === undefined ? 1 : c[3];
      base = base.map((v, i) => v * (1 - al) + c[i] * al);
    }
    const L1 = lum(fg), L2 = lum(base);
    return { fg: getComputedStyle(el).color, bg: base.map(Math.round).join(','), ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2), note: 'bg approximated from ancestor alpha stack; backdrop blur not sampled' };
  }, sel);
}
async function fixedLayers() {
  return win.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((e) => {
        const cs = getComputedStyle(e), r = e.getBoundingClientRect();
        return cs.position === 'fixed' && r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8 && cs.visibility !== 'hidden' && cs.display !== 'none';
      })
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 50)} pe=${getComputedStyle(e).pointerEvents} bg=${getComputedStyle(e).backgroundColor} z=${getComputedStyle(e).zIndex}`),
  );
}
async function chromeInfo() {
  return win.evaluate(() =>
    [...document.querySelectorAll('[data-glass-surface]')].slice(0, 14).map((e) => {
      const a = getComputedStyle(e, '::after');
      const r = e.getBoundingClientRect();
      return `${e.tagName.toLowerCase()}[${e.getAttribute('data-glass-surface')}] ${Math.round(r.width)}x${Math.round(r.height)} elBF=${getComputedStyle(e).backdropFilter} afterBF=${a.backdropFilter || a.webkitBackdropFilter} afterBg=${a.backgroundColor} elBg=${getComputedStyle(e).backgroundColor}`;
    }),
  );
}
const attrs = () => win.evaluate(() => ['data-theme', 'data-theme-mode', 'data-glass', 'data-glass-mode', 'data-accent'].map((k) => `${k}=${document.documentElement.getAttribute(k)}`));
async function setTheme(label, tabName) {
  await openPicker();
  await tab(tabName);
  await tile(label);
  await closePicker();
  await win.waitForTimeout(500);
}
async function popState() {
  return win.evaluate(() => {
    const p = document.querySelector('[aria-label="Session filters"]');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    const cb = p.querySelector('input[type=checkbox]');
    const cr = cb.getBoundingClientRect();
    const t = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2);
    const modal = document.querySelector('.modal-box');
    const mr = modal && modal.getBoundingClientRect();
    const host = p.closest('[popover]');
    return { rect: [r.x, r.y, r.width, r.height].map(Math.round), topLayerHost: !!host, popoverOpen: host ? host.matches(':popover-open') : null, checkboxHit: p.contains(t), modalRect: mr && [mr.x, mr.y, mr.width, mr.height].map(Math.round) };
  });
}

async function suite(mode) {
  const dark = mode === 'dark';
  const P = mode;
  note('=== suite', P);
  // a. picker
  await openPicker();
  await win.waitForTimeout(500);
  note(`${P}.picker.open`, await pickerState());
  await pc(`${P}.picker.tabDark`, win.locator('ptah-theme-toggle [role=tab]', { hasText: 'Dark' }));
  await pc(`${P}.picker.tabGlassSelected`, win.locator('ptah-theme-toggle [role=tab]', { hasText: 'Glass' }));
  await pc(`${P}.picker.accentLegend`, win.locator('ptah-theme-toggle legend'));
  {
    const bb = await win.locator('ptah-theme-toggle [role=tab][aria-selected="true"]').first().boundingBox();
    const pb = await win.locator('ptah-theme-toggle [aria-label="Theme"]').first().boundingBox();
    const buf = await win.screenshot({ clip: { x: pb.x, y: bb.y - 2, width: pb.width, height: bb.height + 4 } });
    const png = PNG.sync.read(buf);
    const at = (x, y) => { const i = (Math.round(y) * png.width + Math.round(x)) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
    const pill = at(bb.x - pb.x + 4, 2 + bb.height / 2);
    const panel = at(3, 2 + bb.height / 2);
    const L1 = relLum(pill), L2 = relLum(panel);
    note(`${P}.picker.selectedTabPillVsPanel`, { pill: pill.join(','), panel: panel.join(','), ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2) });
  }
  await shot(`${P}-a1-picker-open`);
  for (const t of ['Light', 'Dark', 'Glass']) {
    await tab(t);
    note(`${P}.picker.tab.${t}`, await pickerState());
    await shot(`${P}-a2-picker-tab-${t.toLowerCase()}`);
  }
  const other = dark ? 'Dracula' : 'Cupcake';
  await tile(other);
  await openPicker();
  await tab('Glass');
  note(`${P}.picker.afterPick.${other}`, await pickerState());
  await shot(`${P}-a3-picker-after-pick-${other.toLowerCase()}`);
  await win.locator('ptah-theme-toggle button[data-theme][aria-pressed="true"]').first().focus().catch(() => {});
  await shot(`${P}-a4-picker-focus-selected-${other.toLowerCase()}`);
  await tile(dark ? 'Ptah Glass' : 'Ptah Glass Light');
  await openPicker();
  await tab('Glass');
  note(`${P}.picker.restored`, await pickerState());
  await win.locator('ptah-theme-toggle button[data-theme][aria-pressed="true"]').first().focus().catch(() => {});
  await shot(`${P}-a5-picker-restored`);
  if (dark) {
    await accent('Rose quartz');
    note('rose.picker', await pickerState());
    await shot(`${P}-a6-picker-rose`);
    await accent('Gold');
  }
  await closePicker();
  note(`${P}.picker.visibleAfterEscape`, await pickerVisible());
  await win.mouse.click(700, 500).catch(() => {});

  // c/b. Previous sessions modal + popover
  await win.getByRole('button', { name: /Previous sessions/i }).first().click();
  await win.waitForTimeout(1200);
  await shot(`${P}-c1-previous-sessions`);
  note(`${P}.prevSessions.fixedLayers`, await fixedLayers());
  await pc(`${P}.modal.title`, win.getByText('Refactor the theme service so accent', { exact: false }).last());
  await pc(`${P}.modal.meta`, win.getByText(/Just now|ago/).last());
  await pc(`${P}.modal.header`, win.getByText('Previous sessions', { exact: true }).last());
  await pc(`${P}.header.voiceNavDuringModal`, win.getByText('Voice', { exact: true }).first());
  await pc(`${P}.sidebar.workspaceRowDuringModal`, win.getByText('ptah-rv-ws', { exact: false }).first());
  note(`${P}.header.stack`, await win.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Voice');
    if (!el) return null;
    const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const chain = []; let n = el;
    while (n && n !== document.documentElement) { const cs = getComputedStyle(n); if (cs.zIndex !== 'auto' || cs.position === 'fixed' || cs.isolation === 'isolate') chain.push(`${n.tagName.toLowerCase()}.${String(n.className).slice(0, 30)} z=${cs.zIndex} pos=${cs.position} iso=${cs.isolation}`); n = n.parentElement; }
    const d = document.querySelector('dialog.modal-open'); const dr = d && d.getBoundingClientRect();
    return { hit: hit && `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`, dialogRect: dr && [dr.x, dr.y, dr.width, dr.height].map(Math.round), chain };
  }));
  note(`${P}.header.trialClickVoice`, await win.getByText('Voice', { exact: true }).first().click({ trial: true, timeout: 2500 }).then(() => 'actionable: header receives pointer events under the open modal').catch((e) => 'blocked: ' + String(e.message).replace(/\s+/g, ' ').slice(0, 260)));
  note(`${P}.modal.info`, await win.evaluate(() => { const d = document.querySelector('dialog'); const h = document.querySelector('header, [data-glass-surface="bar"], [data-glass-surface="chrome"]'); return { dialogModal: d ? d.matches(':modal') : null, dialogOpen: d ? d.open : null, headerPos: h ? `${h.tagName} z=${getComputedStyle(h).zIndex} pos=${getComputedStyle(h).position}` : null, inertHeader: !!document.querySelector('header')?.closest('[inert]') }; }));
  // b. shared native popover in a modal. No reachable modal hosts a ptah-native-popover, so the theme picker (a top-layer
  // native popover) is opened programmatically while the modal is open (header is inert; click() bypasses hit testing).
  await win.evaluate(() => document.querySelector('button[aria-label="Change theme"]').click());
  await win.waitForTimeout(800);
  await shot(`${P}-b1-picker-popover-over-modal`);
  note(`${P}.popoverOverModal`, await win.evaluate(() => {
    const dd = document.querySelector('ptah-theme-toggle [aria-label="Theme"]');
    if (!dd) return null;
    const r = dd.getBoundingClientRect();
    const tile = dd.querySelector('button[data-theme]');
    const tr = tile.getBoundingClientRect();
    const t = document.elementFromPoint(tr.x + tr.width / 2, tr.y + tr.height / 2);
    return { rect: [r.x, r.y, r.width, r.height].map(Math.round), tileHit: tile.contains(t), hitEl: t && t.tagName, topLayerHost: !!dd.closest('[popover]'), open: dd.closest('[popover]')?.matches(':popover-open') };
  }));
  await win.locator('ptah-theme-toggle [role=tab]', { hasText: 'Dark' }).first().click({ timeout: 3000 }).catch((e) => note(`${P}.popoverOverModal.tabClick`, 'FAILED ' + e.message.split('\n')[0]));
  await win.waitForTimeout(500);
  await shot(`${P}-b2-picker-over-modal-tab-dark`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
  note(`${P}.escape1`, { pickerVisible: await pickerVisible(), modalVisible: await win.locator('dialog.modal-open:visible').count() });
  await shot(`${P}-b3-after-escape1`);
  await win.evaluate(() => document.querySelector('button[aria-label="Change theme"]').click());
  await win.waitForTimeout(600);
  await win.mouse.click(120, 460);
  await win.waitForTimeout(500);
  note(`${P}.outsideClick`, { pickerVisible: await pickerVisible(), modalVisible: await win.locator('dialog.modal-open:visible').count() });
  await shot(`${P}-b4-after-outside-click`);
  if (await win.locator('dialog.modal-open:visible').count()) {
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);
  }
  note(`${P}.modalVisibleAfterEscape2`, await win.locator('dialog.modal-open:visible').count());

  // d. chat
  const row = win.getByText('Refactor the theme service', { exact: false }).first();
  await row.click({ timeout: 5000 }).catch((e) => note(`${P}.chat.open`, 'FAILED ' + e.message.split('\n')[0]));
  await win.waitForTimeout(2500);
  await shot(`${P}-d1-chat`);
  const disc = win.locator('summary, [aria-expanded="false"]:not([aria-label="Change theme"])').filter({ hasText: /Read|Bash|tool|Run|call|Thinking/i });
  note(`${P}.chat.disclosureCount`, await disc.count());
  for (let i = 0; i < Math.min(await disc.count(), 3); i++) await disc.nth(i).click({ timeout: 1500 }).catch(() => {});
  await win.waitForTimeout(600);
  await shot(`${P}-d2-chat-disclosures`);
  await win.evaluate(() => { const a = document.querySelector('.cs-answer'); if (a) a.scrollIntoView({ block: 'center' }); });
  await win.waitForTimeout(600);
  await shot(`${P}-d3-chat-answer-card`);
  note(`${P}.chat.answerGap`, await win.evaluate(() => {
    const a = document.querySelector('.cs-answer'); if (!a) return null;
    const ar = a.getBoundingClientRect(); const art = a.closest('article');
    let best = null;
    for (const e of art.querySelectorAll('*')) { if (a.contains(e) || e.contains(a)) continue; const r = e.getBoundingClientRect(); if (r.height > 4 && r.bottom <= ar.top + 1 && r.bottom > ar.top - 60 && (!best || r.bottom > best.bottom)) best = { bottom: r.bottom, cls: `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}` }; }
    const cs = getComputedStyle(a);
    return { answerTop: Math.round(ar.top), prevBottom: best && Math.round(best.bottom), gap: best && Math.round(ar.top - best.bottom), prev: best && best.cls, pad: cs.padding, radius: cs.borderRadius, border: cs.border };
  }));
  await pc(`${P}.chat.codeBlockInAnswer`, win.locator('.cs-answer pre').first());
  await pc(`${P}.chat.inlineCodeInAnswer`, win.locator('.cs-answer p code, .cs-answer li code').first());
  await pc(`${P}.chat.bulletText`, win.locator('.cs-answer li').nth(2));
  await pc(`${P}.chat.answerText`, win.getByText('Baseline is green, so the split is safe.'));
  await pc(`${P}.chat.answerLongPara`, win.getByText('A long unbroken path to check wrapping', { exact: false }));
  await pc(`${P}.chat.userBubble`, win.getByText('Refactor the theme service so accent handling is isolated', { exact: false }));
  note(`${P}.chat.answerCard`, await win.evaluate(() => {
    const t = [...document.querySelectorAll('p')].find((e) => e.textContent.trim() === 'Baseline is green, so the split is safe.');
    if (!t) return null;
    const out = []; let n = t;
    for (let k = 0; k < 9 && n; k++, n = n.parentElement) {
      const cs = getComputedStyle(n); const r = n.getBoundingClientRect(); const prev = n.previousElementSibling; const pr = prev && prev.getBoundingClientRect();
      out.push(`${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)} rect=${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)} pad=${cs.paddingTop}/${cs.paddingRight}/${cs.paddingBottom}/${cs.paddingLeft} bg=${cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '-' : 'y'} bd=${cs.borderTopWidth} gapPrev=${pr ? Math.round(r.top - pr.bottom) : '-'}`);
    }
    return out;
  }));
  await pc(`${P}.chat.answerText`, win.getByText('Baseline is green, so the split is safe.'));
  await pc(`${P}.chat.answerLongPara`, win.getByText('A long unbroken path to check wrapping', { exact: false }));
  await pc(`${P}.chat.userBubble`, win.getByText('Refactor the theme service so accent handling is isolated', { exact: false }));
  note(`${P}.chat.answerCard`, await win.evaluate(() => {
    const t = [...document.querySelectorAll('p,li,h2')].find((e) => e.textContent.includes('Baseline is green'));
    if (!t) return null;
    let n = t; let card = null;
    while (n && n.parentElement) { const cs = getComputedStyle(n); const r = n.getBoundingClientRect(); if (parseFloat(cs.paddingLeft) >= 8 && r.width > 300 && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px' || cs.boxShadow !== 'none')) { card = n; break; } n = n.parentElement; }
    if (!card) return 'card not found';
    const cs = getComputedStyle(card); const r = card.getBoundingClientRect(); const prev = card.previousElementSibling; const pr = prev && prev.getBoundingClientRect(); const tr = t.getBoundingClientRect();
    return { cls: String(card.className).slice(0, 80), pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft], gapToPrev: pr ? Math.round(r.top - pr.bottom) : null, prevCls: prev && String(prev.className).slice(0, 50), textInset: [Math.round(tr.left - r.left), Math.round(r.right - tr.right)], bg: cs.backgroundColor, color: getComputedStyle(t).color };
  }));

  // f. chrome + git dock
  note(`${P}.chrome`, await chromeInfo());
  await pc(`${P}.header.voiceNav`, win.getByText('Voice', { exact: true }).first());
  await pc(`${P}.sidebar.workspaceRow`, win.getByText('ptah-rv-ws', { exact: false }).first());
  await pc(`${P}.sessions.cardMeta`, win.getByText('Lanes none yet').first());
  await win.getByRole('button', { name: /Toggle Git panel/i }).click().catch(() => {});
  await win.waitForTimeout(1200);
  await shot(`${P}-f1-chrome-git-dock-open`);
  note(`${P}.git.fixedLayers`, await fixedLayers());
  await win.getByRole('button', { name: /Toggle Git panel/i }).click().catch(() => {});
  await win.waitForTimeout(600);

  // e. settings
  await win.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await win.waitForTimeout(1500);
  await shot(`${P}-e1-settings-providers`);
  for (const [name, f] of [['Advanced', 'e2-settings-advanced'], ['Search & Voice', 'e3-settings-search-voice']]) {
    note(`${P}.settings.${name}.hit`, await win.evaluate((n) => {
      const el = [...document.querySelectorAll('button,[role=tab]')].find((b) => b.textContent.trim().includes(n));
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { ok: el.contains(t), hit: t && `${t.tagName}.${String(t.className).slice(0, 50)}` };
    }, name));
    await win.getByRole('button', { name: new RegExp(name, 'i') }).first().click({ timeout: 4000 }).catch((e) => note(`${P}.settings.${name}.click`, 'FAILED ' + e.message.split('\n')[0]));
    await win.waitForTimeout(900);
    note(`${P}.settings.${name}.fixedLayers`, await fixedLayers());
    await shot(`${P}-${f}`);
  }
  await win.getByRole('button', { name: /Providers/ }).first().click().catch(() => {});
  await win.waitForTimeout(800);
  const reassign = win.getByText('Reassign', { exact: false }).first();
  if (await reassign.count()) {
    await reassign.click().catch(() => {});
    await win.waitForTimeout(700);
    await shot(`${P}-e4-settings-popover-reassign`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }
  await win.getByRole('button', { name: /^Back|Back to/i }).first().click({ timeout: 2000 }).catch(async () => {
    await win.getByRole('button', { name: 'Chat', exact: true }).first().click().catch(() => {});
  });
  await win.waitForTimeout(800);
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-rv-udd-'));
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-rv-db-'));
  const env = { ...process.env, NODE_ENV: 'test', PTAH_E2E: '1', PTAH_DB_PATH: path.join(dbDir, 'db.sqlite'), USERPROFILE: home, HOME: home };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: [entry, `--user-data-dir=${userDataDir}`, ws], env, timeout: 90000 });
  win = await app.firstWindow({ timeout: 90000 });
  win.on('pageerror', (e) => note('pageerror', e.message.slice(0, 200)));
  await win.waitForURL((u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'), { timeout: 90000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await win.waitForTimeout(10000);
  note('boot', await attrs());
  await shot('00-boot');
  try {
    await suite('dark');
    await setTheme('Ptah Glass Light', 'Glass');
    note('light.attrs', await attrs());
    await suite('light');
  } catch (e) {
    note('SUITE ERROR', e.stack.slice(0, 600));
    await shot('zz-error').catch(() => {});
  }
  try {
    await setTheme('Anubis', 'Dark');
    note('control.attrs', await attrs());
    await openPicker(); await tab('Dark'); await shot('control-anubis-picker'); await closePicker();
    await win.getByRole('button', { name: /Previous sessions/i }).first().click().catch(() => {});
    await win.waitForTimeout(1000);
    await shot('control-anubis-modal');
    note('control.header.trialClickVoice', await win.getByText('Voice', { exact: true }).first().click({ trial: true, timeout: 2500 }).then(() => 'actionable: header receives pointer events under the open modal').catch((e) => 'blocked: ' + String(e.message).replace(/\s+/g, ' ').slice(0, 260)));
    await pc('control.header.voiceNavDuringModal', win.getByText('Voice', { exact: true }).first());
    await win.getByRole('button', { name: /Date range/i }).first().click().catch(() => {});
    await win.waitForTimeout(600);
    await shot('control-anubis-modal-popover');
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    await setTheme('Dracula', 'Glass');
    note('control2.attrs', await attrs());
    await win.getByRole('button', { name: /Previous sessions/i }).first().click().catch(() => {});
    await win.waitForTimeout(1000);
    await shot('control-dracula-modal');
  } catch (e) {
    note('CONTROL ERROR', e.stack.slice(0, 600));
  }
  fs.writeFileSync(path.join(out, '_log.txt'), log.join('\n'));
  await app.close();
  console.log('done');
})().catch(async (e) => {
  console.error(e);
  fs.writeFileSync(path.join(out, '_log.txt'), log.join('\n') + '\nFATAL ' + e.stack);
  try { await app.close(); } catch {}
  process.exit(1);
});
