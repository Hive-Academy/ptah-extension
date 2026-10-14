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
  writeFileSync(`${OUT}/../_capture/metrics-${PHASE}.json`, JSON.stringify(metrics, null, 1));
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
  for (const w of WIDTHS) {
    if (PHASE === 'before') {
      test(`before ${tname} ${w}`, async ({ page }: any) => {
        await boot(page, theme, w, H(w));
        await fx.gotoSettingsTab(page, 'Agent Orchestration');
        await page.waitForTimeout(1500); await fx.waitForSettled(page);
        await shot(page, `before-orchestration-${tname}-${w}`);
        metrics[`before-orch-${tname}-${w}-advancedSettingCount`] = await page.locator('[data-testid^="advanced-setting-"]').count();
        await fx.gotoSettingsTab(page, 'Advanced');
        await page.waitForTimeout(1500); await fx.waitForSettled(page);
        await shot(page, `before-advanced-${tname}-${w}`);
        metrics[`before-adv-${tname}-${w}-advancedSettingCount`] = await page.locator('[data-testid^="advanced-setting-"]').count();
        metrics[`before-adv-${tname}-${w}-fineTuning`] = await page.locator('[data-testid="fine-tuning-details"]').count();
      });
    } else {
      test(`after ${tname} ${w}`, async ({ page }: any) => {
        await boot(page, theme, w, H(w));
        const key = `${tname}-${w}`;
        // --- Orchestration
        await fx.gotoSettingsTab(page, 'Agent Orchestration');
        const field = page.locator('[data-testid="advanced-setting-internalQuery.maxConcurrent"]');
        await expect(field).toBeVisible({ timeout: 20000 });
        await expect(page.locator('[data-testid="advanced-setting-compaction.toolOutputBudgetTokens"]')).toBeVisible();
        await page.waitForTimeout(1500); await fx.waitForSettled(page);
        await shot(page, `after-orchestration-${tname}-${w}`);
        metrics[`orch-${key}-layout`] = await page.evaluate(`(${LAYOUT_JS})('[data-testid^="settings-section-"]')`);
        metrics[`orch-${key}-sections`] = await page.locator('[data-testid^="settings-section-"]').evaluateAll((els: any[]) => els.map((e) => e.getAttribute('data-testid')));
        metrics[`orch-${key}-contrast`] = (await page.evaluate(`(${CONTRAST_JS})('[data-testid^="settings-section-"]')`));
        // focus ring: keyboard focus on an input
        await page.locator('[data-testid="advanced-setting-compaction.toolOutputBudgetTokens"]').focus();
        await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        metrics[`orch-${key}-focusStyle`] = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a); return { tid: a.getAttribute('data-testid'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, offset: cs.outlineOffset }; });
        await page.locator('[data-testid="settings-section-context-budgets"]').screenshot({ path: `${OUT}/after-orchestration-focus-${tname}-${w}.png` });
        // validation
        await field.scrollIntoViewIfNeeded();
        await field.fill('0'); await page.keyboard.press('Tab');
        const err = page.locator('[data-testid="advanced-setting-internalQuery.maxConcurrent-error"]');
        await expect(err).toBeVisible();
        metrics[`orch-${key}-errorText`] = await err.innerText();
        metrics[`orch-${key}-errorContrast`] = await page.evaluate(`(${CONTRAST_JS})('[data-testid="advanced-setting-internalQuery.maxConcurrent-error"]')`);
        await page.locator('[data-testid="settings-section-background-queries"]').screenshot({ path: `${OUT}/after-validation-error-${tname}-${w}.png` });
        // --- Advanced
        await fx.gotoSettingsTab(page, 'Advanced');
        const sum = page.locator('[data-testid="fine-tuning-summary"]');
        await expect(sum).toBeVisible();
        await page.waitForTimeout(1000); await fx.waitForSettled(page);
        await shot(page, `after-advanced-closed-${tname}-${w}`);
        metrics[`adv-${key}-closedAdvancedSettingCount`] = await page.locator('[data-testid^="advanced-setting-"]:visible').count();
        await sum.click();
        await expect(page.locator('[data-testid="advanced-setting-cron.maxConcurrentJobs"]')).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(1500); await fx.waitForSettled(page);
        await shot(page, `after-advanced-open-${tname}-${w}`);
        metrics[`adv-${key}-layout`] = await page.evaluate(`(${LAYOUT_JS})('[data-testid="fine-tuning-details"]')`);
        metrics[`adv-${key}-contrast`] = (await page.evaluate(`(${CONTRAST_JS})('[data-testid="fine-tuning-details"]')`));
        metrics[`adv-${key}-sections`] = await page.locator('[data-testid^="settings-section-"]').evaluateAll((els: any[]) => els.map((e) => e.getAttribute('data-testid')));
        await page.locator('[data-testid="settings-section-scheduled-jobs"]').screenshot({ path: `${OUT}/after-restart-note-${tname}-${w}.png` });
        // focus on summary
        await page.locator('[data-testid="fine-tuning-summary"]').focus();
        metrics[`adv-${key}-summaryFocus`] = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a); return { outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, matchesFocusVisible: a.matches(':focus-visible') }; });
        await page.keyboard.press('Tab');
        metrics[`adv-${key}-firstTabAfterSummary`] = await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-testid'));
        // write success
        const f2 = page.locator('[data-testid="advanced-setting-memory.retention.processedDays"]');
        await f2.fill('9'); await page.keyboard.press('Tab');
        await page.waitForTimeout(400);
        metrics[`adv-${key}-saveStatus`] = await page.locator('[role="status"]').allInnerTexts();
        metrics[`adv-${key}-rpcCalls`] = fx.getFixtureState(page).calls.filter((c: any) => c.method === 'settings:set');
      });
    }
  }
}
