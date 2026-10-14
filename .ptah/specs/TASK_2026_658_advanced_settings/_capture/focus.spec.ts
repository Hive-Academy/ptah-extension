import { writeFileSync } from 'node:fs';
const WT = 'D:/projects/ptah-extension/.claude-worktrees/feat-advanced-settings-ui/libs/frontend/webview-e2e-harness/src/lib';
const WTR = 'file:///D:/projects/ptah-extension/.claude-worktrees/feat-advanced-settings-ui/libs/';
const { test, expect } = await import(`${WTR}frontend/webview-e2e-harness/src/lib/test-fixtures.ts`);
const { startFixtureServer } = await import(`${WTR}frontend/webview-e2e-harness/src/lib/fixture-server.ts`);
const fx = await import(`${WTR}frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts`);
const shared = await import(`${WTR}shared/src/lib/types/advanced-settings.types.ts`);

const PHASE = process.env.PHASE as 'before' | 'after';
const OUT = 'D:/projects/ptah-extension/.ptah/specs/TASK_2026_658_advanced_settings/screenshots';
const THEMES = [['dark', 'anubis'], ['light', 'anubis-light']] as const;
const WIDTHS = [360, 1000];
const metrics: Record<string, unknown> = {};

let server: { url: string; close(): Promise<void> } | null = null;
test.beforeAll(async () => {
  if (PHASE === 'before') {
    server = await startFixtureServer({ rootDir: 'D:/projects/ptah-extension/dist/apps/ptah-extension-webview/browser' });
  }
});
test.afterAll(async () => {
  if (server) await server.close();
  writeFileSync(`${OUT}/../_capture/metrics-focus-${PHASE}.json`, JSON.stringify(metrics, null, 1));
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

const CONTRAST_JS = `(scopeSel) => {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const paint = (c) => { ctx.fillStyle = c; ctx.fillRect(0,0,1,1); };
  const bgOf = (el) => {
    const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
    ctx.clearRect(0,0,1,1); ctx.fillStyle='#fff'; ctx.fillRect(0,0,1,1);
    for (const e of chain) { const b = getComputedStyle(e).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b!=='transparent') paint(b); }
    const d = ctx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]];
  };
  const lum = ([r,g,b]) => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
  const fg = (el, bg) => { ctx.fillStyle='rgb('+bg.join(',')+')'; ctx.fillRect(0,0,1,1); paint(getComputedStyle(el).color); const d=ctx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
  const out = {};
  document.querySelectorAll(scopeSel).forEach(scope => {
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement;
      const cs = getComputedStyle(el); if (cs.visibility==='hidden' || el.getClientRects().length===0) continue;
      const bg = bgOf(el); const f = fg(el,bg); const r = ratio(f,bg);
      const k = cs.color+'|'+cs.fontSize+'|'+cs.fontWeight+'|'+bg.join(',');
      if (!out[k] || out[k].ratio > r) out[k] = { ratio: +r.toFixed(2), size: cs.fontSize, weight: cs.fontWeight, fg: f.join(','), bg: bg.join(','), sample: t.slice(0,50), testid: el.closest('[data-testid]')?.getAttribute('data-testid') };
    }
  });
  return Object.values(out).sort((a,b)=>a.ratio-b.ratio);
}`;

const LAYOUT_JS = `(scopeSel) => {
  const res = { docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, overflowing: [], small: [], clipped: [] };
  document.querySelectorAll(scopeSel).forEach(scope => {
    const sr = scope.getBoundingClientRect();
    scope.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el); if (el.getClientRects().length===0) return;
      const r = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && el.clientWidth>0) res.clipped.push({tag: el.tagName, tid: el.getAttribute('data-testid'), sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent||'').trim().slice(0,40)});
      if (r.right > sr.right + 1 || r.left < sr.left - 1) res.overflowing.push({tag: el.tagName, tid: el.getAttribute('data-testid'), right: Math.round(r.right), scopeRight: Math.round(sr.right)});
      if (['INPUT','BUTTON','SUMMARY','A','SELECT'].includes(el.tagName) || el.getAttribute('role')==='button') {
        if (r.width < 24 || r.height < 24) res.small.push({tag: el.tagName, tid: el.getAttribute('data-testid'), w: +r.width.toFixed(1), h: +r.height.toFixed(1), type: el.getAttribute('type')});
      }
    });
  });
  return res;
}`;

async function boot(page: any, theme: string, w: number, h: number) {
  const url = PHASE === 'before' ? server!.url : process.env.BASE_URL!;
  await page.setViewportSize({ width: w, height: h });
  await fx.bootSettings(page, url, 'vscode', theme, overrides);
}
const shot = (page: any, name: string, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const H = (w: number) => (w < 500 ? 3600 : 2600);


for (const [tname, theme] of THEMES) {
  test(`focus ${tname}`, async ({ page }: any) => {
    await boot(page, theme, 360, 1400);
    await fx.gotoSettingsTab(page, 'Advanced');
    const sum = page.locator('[data-testid="fine-tuning-summary"]');
    await expect(sum).toBeVisible();
    await sum.scrollIntoViewIfNeeded();
    await page.locator('[data-testid="settings-back"]').focus();
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('data-testid') === 'fine-tuning-summary');
    }
    metrics[`${tname}-reachedSummaryByTab`] = found;
    metrics[`${tname}-summaryFocus`] = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a); return { outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, fv: a.matches(':focus-visible') }; });
    const box = await sum.boundingBox();
    await page.screenshot({ path: `${OUT}/after-fine-tuning-summary-focus-${tname}-360.png`, clip: { x: 0, y: Math.max(0, box.y - 20), width: 360, height: box.height + 40 } });
    // keyboard open with Enter and tab into first control
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="advanced-setting-memory.symbolInjectionEnabled"]')).toBeVisible();
    await page.keyboard.press('Tab');
    metrics[`${tname}-afterEnterTab`] = await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-testid'));
    metrics[`${tname}-toggleFocus`] = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a); return { outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, fv: a.matches(':focus-visible') }; });
    const sec = page.locator('[data-testid="settings-section-memory-upkeep"]');
    await sec.screenshot({ path: `${OUT}/after-toggle-focus-${tname}-360.png` });
  });
}
