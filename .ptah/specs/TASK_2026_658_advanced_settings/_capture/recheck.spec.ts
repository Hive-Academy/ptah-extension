import { writeFileSync } from 'node:fs';
const WTR = 'file:///D:/projects/ptah-extension/.claude-worktrees/feat-advanced-settings-ui/libs/';
const { test, expect } = await import(`${WTR}frontend/webview-e2e-harness/src/lib/test-fixtures.ts`);
const fx = await import(`${WTR}frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts`);
const shared = await import(`${WTR}shared/src/lib/types/advanced-settings.types.ts`);

const TASK = 'D:/projects/ptah-extension/.ptah/specs/TASK_2026_658_advanced_settings';
const OUT = `${TASK}/screenshots`;
const THEME_ONLY = process.env.THEME_ONLY;
const THEMES = ([['dark', 'anubis'], ['light', 'anubis-light']] as const).filter(([n]) => !THEME_ONLY || n === THEME_ONLY);
const WIDTHS = [360, 1000];
const metrics: Record<string, unknown> = {};
test.afterAll(async () => {
  writeFileSync(`${TASK}/_capture/metrics-recheck-${THEME_ONLY ?? 'all'}.json`, JSON.stringify(metrics, null, 1));
});
const defaults = new Map<string, unknown>(shared.ADVANCED_SETTINGS.map((s: any) => [s.key, s.default]));
const overrides = {
  'settings:get': (params: any) => {
    const key = params?.key;
    if (defaults.has(key)) return { success: true, value: defaults.get(key) };
    if (typeof key === 'string' && Object.hasOwn(fx.SESSION_BUDGET_SETTINGS_FIXTURE, key))
      return { success: true, value: fx.SESSION_BUDGET_SETTINGS_FIXTURE[key] };
    return fx.PTAH_CLI_AGENTS_SETTING_FIXTURE;
  },
  'settings:set': () => ({ success: true }),
};
const MEASURE_JS = `(sel) => {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { ctx.clearRect(0,0,1,1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0,0,1,1); const d = ctx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
  const probe = document.createElement('span'); document.body.appendChild(probe);
  const resolve = (c) => { probe.style.color = ''; probe.style.color = c; return getComputedStyle(probe).color; };
  const parse = (s) => {
    const m = s.match(/color\\(srgb ([\\d.e-]+) ([\\d.e-]+) ([\\d.e-]+)(?: \\/ ([\\d.e-]+))?\\)/);
    if (m) return [m[1]*255, m[2]*255, m[3]*255, m[4]===undefined ? 1 : +m[4]];
    const n = s.match(/rgba?\\(([^)]+)\\)/);
    if (n) { const p = n[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2], p.length>3 ? p[3] : 1]; }
    return null;
  };
  const col = (c) => { let p = parse(resolve(c)); if (!p) { const q = rgba(c); p = [q[0],q[1],q[2],1]; } return p; };
  const over = (f, b) => [0,1,2].map(i => f[i]*f[3] + b[i]*(1-f[3]));
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = col(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
    let b = col(getComputedStyle(document.body).backgroundColor).slice(0,3);
    for (let i = stack.length - 1; i >= 0; i--) b = over(stack[i], b);
    return b;
  };
  const lum = (c) => { const f = c.map(v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2]; };
  const ratio = (a,b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
  const hex = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
  const el = document.querySelector(sel); if (!el) return { missing: sel };
  const cs = getComputedStyle(el);
  const parentBg = bgOf(el.parentElement);
  const ownBg = bgOf(el);
  const fg = over(col(cs.color), ownBg);
  const bc = col(cs.borderTopColor); const bcOver = over(bc, ownBg);
  const r = el.getBoundingClientRect();
  const out = {
    sel, text: (el.textContent||'').trim(), tag: el.tagName, role: el.getAttribute('role'), id: el.id, cls: el.className,
    color: hex(fg), ownBg: hex(ownBg), parentBg: hex(parentBg), textContrast: +ratio(fg, ownBg).toFixed(2),
    fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    borderWidth: cs.borderTopWidth, borderStyle: cs.borderTopStyle, borderColor: hex(bcOver), borderAlpha: bc[3],
    borderVsParent: +ratio(bcOver, parentBg).toFixed(2), borderVsOwnFill: +ratio(bcOver, ownBg).toFixed(2),
    rects: el.getClientRects().length, scrollW: el.scrollWidth, clientW: el.clientWidth, offsetH: el.offsetHeight,
    lineHeight: cs.lineHeight, whiteSpace: cs.whiteSpace, overflowX: cs.overflowX,
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
  probe.remove();
  return out;
}`;
async function boot(page: any, theme: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await fx.bootSettings(page, process.env.BASE_URL!, 'vscode', theme, overrides);
}
const ctrl = (page: any, sel: string) => page.evaluate(`(${MEASURE_JS})(${JSON.stringify(sel)})`);
for (const [tname, theme] of THEMES) {
  for (const w of WIDTHS) {
    test(`recheck ${tname} ${w}`, async ({ page }: any) => {
      await boot(page, theme, w, w < 500 ? 3600 : 2600);
      const key = `${tname}-${w}`;
      // 1. number error
      await fx.gotoSettingsTab(page, 'Agent Orchestration');
      const input = page.locator('[data-testid="advanced-setting-internalQuery.maxConcurrent"]');
      await expect(input).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(1500); await fx.waitForSettled(page);
      await input.scrollIntoViewIfNeeded();
      metrics[`${key}-input-before`] = await ctrl(page, '[data-testid="advanced-setting-internalQuery.maxConcurrent"]');
      await input.fill('0'); await page.keyboard.press('Tab');
      const err = page.locator('[data-testid="advanced-setting-internalQuery.maxConcurrent-error"]');
      await expect(err).toBeVisible();
      await page.waitForTimeout(600);
      metrics[`${key}-error`] = await ctrl(page, '[data-testid="advanced-setting-internalQuery.maxConcurrent-error"]');
      metrics[`${key}-input-after`] = await ctrl(page, '[data-testid="advanced-setting-internalQuery.maxConcurrent"]');
      metrics[`${key}-input-attrs`] = await input.evaluate((e: any) => ({ ariaInvalid: e.getAttribute('aria-invalid'), describedBy: e.getAttribute('aria-describedby'), focused: document.activeElement === e, cls: e.className }));
      metrics[`${key}-statusLines`] = await page.locator('[role="status"], [role="alert"]').evaluateAll((els: any[]) => els.map((e) => ({ role: e.getAttribute('role'), text: e.textContent.trim().slice(0, 80), tid: e.getAttribute('data-testid') })));
      metrics[`${key}-docOverflowX`] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.locator('[data-testid="settings-section-background-queries"]').screenshot({ path: `${OUT}/recheck-number-error-${tname}-${w}.png` });
      // 2. toggle
      await fx.gotoSettingsTab(page, 'Advanced');
      const sum = page.locator('[data-testid="fine-tuning-summary"]');
      await expect(sum).toBeVisible();
      await sum.click();
      const tg = page.locator('[data-testid="advanced-setting-memory.symbolInjectionEnabled"]');
      await expect(tg).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(1200); await fx.waitForSettled(page);
      const stSel = '[data-testid="advanced-setting-memory.symbolInjectionEnabled-state"]';
      metrics[`${key}-toggle-checked1`] = await tg.isChecked();
      metrics[`${key}-state-1`] = await ctrl(page, stSel);
      await tg.scrollIntoViewIfNeeded();
      const sec = page.locator('[data-testid="settings-section-memory-upkeep"]');
      await sec.screenshot({ path: `${OUT}/recheck-toggle-${tname}-${w}.png` });
      await tg.click();
      await page.waitForTimeout(800); await fx.waitForSettled(page);
      metrics[`${key}-toggle-checked2`] = await tg.isChecked();
      metrics[`${key}-state-2`] = await ctrl(page, stSel);
      metrics[`${key}-labelBox`] = await tg.evaluate((e: any) => { const l = e.closest('label').getBoundingClientRect(); return { l: Math.round(l.left), r: Math.round(l.right), vw: innerWidth }; });
      await sec.screenshot({ path: `${OUT}/recheck-toggle-disabled-${tname}-${w}.png` });
    });
  }
}
