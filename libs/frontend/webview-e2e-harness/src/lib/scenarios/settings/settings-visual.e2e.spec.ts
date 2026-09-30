/**
 * E2E: Settings smoke captures (TASK_2026_555 Batch 16, Task 16.1 — plan
 * Component 14, §6): both tabs, both hosts, both themes, at 1024x768, so
 * drift is visible at every commit (execution default 9). Batch 28 added the
 * Providers fold gate (`assertProvidersFold`) and the popover stacking check
 * (`assertPopoverOnTop`); the Orchestration fold follows in Batch 36.
 *
 * Pattern followed: `../marketplace/marketplace-visual.e2e.spec.ts`
 * (`waitForSettled`, `useAppBuild: true`, captures written under
 * `.ptah/specs/<task>/screenshots/angular/`).
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { bootSettings, gotoSettingsTab, waitForSettled } from './settings.fixtures';

test.use({ useAppBuild: true });

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../../../../../../.ptah/specs/TASK_2026_555/screenshots/angular');

/**
 * Per-batch smoke captures are `current-*`. The `baseline-*` "before" images the visual gates
 * compare against are written only on an explicit `SETTINGS_CAPTURE_BASELINE=1` run.
 */
const CAPTURE_KIND = process.env['SETTINGS_CAPTURE_BASELINE'] === '1' ? 'baseline' : 'current';

function capturePath(tab: string, host: string, theme: string): string {
  return join(OUT_DIR, `${CAPTURE_KIND}-${tab}-${host}-${theme}-1024x768.png`);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

const TABS: readonly { readonly label: 'Providers' | 'Agent Orchestration'; readonly name: string }[] = [
  { label: 'Providers', name: 'providers' },
  { label: 'Agent Orchestration', name: 'orchestration' },
];

/**
 * Connection drawers compared with `prototypes/final/screenshots/interactions/drawer-*.png` (Batch 20)
 * and with the prototype's Credentials markup (`prototypes/final/index.html`, Batch 21). `tab` is the
 * drawer tab shown; Overview when absent.
 */
const DRAWERS: readonly { readonly card: string; readonly name: string; readonly tab?: string; readonly ready?: string }[] = [
  { card: 'Moonshot', name: 'drawer-moonshot' },
  { card: 'sovereigneg', name: 'drawer-sovereigneg' },
  { card: 'Moonshot', name: 'drawer-moonshot-credentials', tab: 'Credentials' },
  { card: 'Claude (Subscription)', name: 'drawer-claude-cli-credentials', tab: 'Credentials' },
  // Batch 22. `ready`: the pickers' catalogue has loaded (their tool-use summary renders).
  { card: 'Moonshot', name: 'drawer-moonshot-models', tab: 'Models & Tiers',
    ready: '[data-tier="haiku"] [data-testid="provider-model-picker-tooluse-summary"]' },
  { card: 'sovereigneg', name: 'drawer-sovereigneg-models', tab: 'Models & Tiers',
    ready: '[data-tier="haiku"] [data-testid="provider-model-picker-tooluse-summary"]' },
  { card: 'sovereigneg', name: 'drawer-sovereigneg-advanced', tab: 'Advanced', ready: '[data-testid="advanced-base-url"]' },
];

/**
 * The drawer slides its panel in (translateX) and fades its backdrop in (`native-drawer.component.ts`
 * keyframes). Waits for those two animations to finish, then asserts the panel sits fully inside the
 * viewport against the trailing edge, so a mid-slide frame is never captured and a real layout clip
 * fails here instead of passing as a screenshot.
 */
async function waitForDrawerOpened(page: Page): Promise<void> {
  const root = page.locator('[data-testid="native-drawer-root"]');
  // Only the drawer's own entry keyframes (`ptah-drawer-*`). Incidental tab colour transitions and
  // button pops started by the tab click could leave `finished` unsettled when read at once (Batch 22:
  // electron hung here intermittently; with a 5 s grace every animation had finished). The screenshot
  // disables animations anyway, and the box check below still catches a mid-slide panel.
  await root.evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .filter((animation) => animation instanceof CSSAnimation && animation.animationName.includes('ptah-drawer-'))
    .map((animation) => animation.finished)));
  const box = await page.locator('[data-testid="native-drawer-panel"]').boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThanOrEqual(1);
  // Every tab fits on one line inside the panel (the prototype's single-row tab strip).
  const tabs = page.locator('[data-testid="native-drawer-panel"] [role="tablist"]');
  expect(await tabs.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
}

/** Bottom edge (px from the viewport top) of the first element matching `selector`. */
async function bottomOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} is laid out`).not.toBeNull();
  return Math.round((box?.y ?? 0) + (box?.height ?? 0));
}

type FoldRegion = 'tabs' | 'map' | 'heading' | 'card5';

/**
 * THE per-host Providers fold budget. Source: task.md "Gate V 28 (2026-10-01, user)" (the user asked for "the most
 * visible and clean layout"; orchestrator choice recorded there).
 * - VS Code keeps the full plan budget (plan §6 :1045-1048): the tabs, routing map, Connections heading and 5th card
 *   end at or above 660 px; 3 columns at 1024 px; at least 2 at 800 px.
 * - Electron's page is about 670 px wide beside the shell sidebar: 2 columns of 80 px cards, the routing map's third
 *   node on a full row, and the tabs, routing map and Connections heading at or above 660 px (card 5 is below the
 *   fold by that decision); at least 1 column at 800 px.
 * Both hosts: nothing scrolled, every card at most 80 px, and no horizontal overflow at 800 px.
 */
const FOLD_BUDGET: Readonly<Record<'vscode' | 'electron', {
  readonly maxBottom: number; readonly regions: readonly FoldRegion[]; readonly columnsAt1024: number; readonly minColumnsAt800: number;
}>> = {
  vscode: { maxBottom: 660, regions: ['tabs', 'map', 'heading', 'card5'], columnsAt1024: 3, minColumnsAt800: 2 },
  electron: { maxBottom: 660, regions: ['tabs', 'map', 'heading'], columnsAt1024: 2, minColumnsAt800: 1 },
};

/** Batch 28 fold gate, per host (`FOLD_BUDGET`). The numbers are logged for the report. */
async function assertProvidersFold(page: Page, host: 'vscode' | 'electron', theme: string): Promise<void> {
  const budget = FOLD_BUDGET[host];
  const cards = page.locator('[data-testid="provider-connection-card"]');
  await expect(cards.nth(4)).toBeVisible();
  const scroll = await page.evaluate(() => ({
    window: window.scrollY,
    page: document.querySelector('ptah-providers-settings > div')?.scrollTop ?? 0,
  }));
  const bottoms: Record<FoldRegion, number> = {
    tabs: await bottomOf(page, '[data-testid="settings-tabs"]'),
    map: await bottomOf(page, '[data-testid="routing-map"]'),
    heading: await bottomOf(page, '#providers-connections-heading'),
    card5: Math.round(await cards.nth(4).evaluate((node) => node.getBoundingClientRect().bottom)),
  };
  const heights = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  const widths = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
  const columnsOf = () => page.locator('[data-testid="connections-grid"]').evaluate((grid) =>
    getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  const columns = await columnsOf();
  await page.setViewportSize({ width: 800, height: 768 });
  const columnsAt800 = await columnsOf();
  // Horizontal overflow at 800 px: neither the document nor the Providers scroll container is wider than its box.
  const overflowAt800 = await page.evaluate(() => {
    const pageBox = document.querySelector('ptah-providers-settings > div');
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pageBox ? pageBox.scrollWidth - pageBox.clientWidth : 0);
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  console.log(`B28 fold ${host}/${theme}: scroll ${scroll.window}/${scroll.page}; bottoms tabs ${bottoms.tabs}, map ${bottoms.map}, `
    + `heading ${bottoms.heading}, card5 ${bottoms.card5}; card heights ${heights.join(',')}; widths ${widths.join(',')}; `
    + `${columns} columns at 1024, ${columnsAt800} at 800 (overflow ${overflowAt800}px)`);
  expect(scroll).toEqual({ window: 0, page: 0 });
  expect(columns).toBe(budget.columnsAt1024);
  expect(columnsAt800).toBeGreaterThanOrEqual(budget.minColumnsAt800);
  expect(overflowAt800).toBeLessThanOrEqual(0);
  for (const height of heights) expect(height).toBeLessThanOrEqual(80);
  for (const region of budget.regions) expect(bottoms[region], `${region} bottom`).toBeLessThanOrEqual(budget.maxBottom);
}

/**
 * Batch 27b deviation 6 / Batch 28: an open popover is painted above everything on the page, the routing-map
 * node badges included. The top-most element at the centre of each popover row must belong to the popover.
 */
async function assertPopoverOnTop(page: Page, popover: string, rows: string): Promise<void> {
  const covered = await page.locator(popover).evaluate((panel, rowSelector) => Array.from(panel.querySelectorAll(rowSelector))
    .map((row) => {
      const box = row.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top && panel.contains(top) ? null : `${(row.textContent ?? '').trim()} is covered by ${top?.outerHTML.slice(0, 80)}`;
    }).filter(Boolean), rows);
  expect(covered).toEqual([]);
}

for (const host of ['vscode', 'electron'] as const) {
  for (const theme of ['anubis', 'anubis-light'] as const) {
    test(`baseline smoke — both tabs (${host}, ${theme})`, async ({ page, fixtureServer }) => {
      // A fold failure is reported at the end, after every capture was still taken (a red fold must not hide them).
      let foldFailure: unknown = null;
      await bootSettings(page, fixtureServer.url, host, theme);
      await page.setViewportSize({ width: 1024, height: 768 });
      for (const tab of TABS) {
        await gotoSettingsTab(page, tab.label);
        await waitForSettled(page);
        await page.screenshot({ path: capturePath(tab.name, host, theme) });
      }
      await gotoSettingsTab(page, 'Providers');
      await waitForSettled(page);
      // Batch 28: the fold gate, in both hosts (Q-extra-1: container-width columns, 80 px cards everywhere).
      await test.step('fold', () => assertProvidersFold(page, host, theme)).catch((error: unknown) => { foldFailure = error; });
      // Batch 25: the routing map's three work nodes (deferred chunk; wait for it, not its placeholder).
      const nodes = page.locator('[data-testid^="routing-node-"][data-testid$="agent"], [data-testid="routing-node-background-roles"], [data-testid="routing-node-cli-agents"]');
      await expect(page.locator('[data-testid="routing-map"]')).toBeVisible();
      await expect(nodes).toHaveCount(3);
      const nodeBoxes = await nodes.evaluateAll((all) => all.map((node) => {
        const box = node.getBoundingClientRect();
        return { w: Math.round(box.width), h: Math.round(box.height), top: Math.round(box.top) };
      }));
      const nodeColumns = await page.locator('[data-testid="routing-map-nodes"]').evaluate((grid) =>
        getComputedStyle(grid).gridTemplateColumns.split(' ').length);
      console.log(`B25 nodes ${host}/${theme}: ${nodeBoxes.map((b) => `${b.w}x${b.h}@${b.top}`).join(', ')}, ${nodeColumns} columns`);
      // Container-width columns (Q-extra-1 rule): 3 side by side in VS Code, 2 in Electron's narrower page, where the
      // third node spans the full row (task.md "Gate V 28"): no half-width node beside an empty half row.
      expect(nodeColumns).toBe(host === 'vscode' ? 3 : 2);
      const gridWidth = await page.locator('[data-testid="routing-map-nodes"]').evaluate((grid) => grid.getBoundingClientRect().width);
      if (host === 'electron') expect(Math.abs(nodeBoxes[2].w - Math.round(gridWidth))).toBeLessThanOrEqual(1);
      // Gate V 28 (prototype header): the status pill and badges sit on the title row; a title may wrap to at most two
      // lines (16 px leading) rather than push the badges to a row of their own.
      for (const height of await page.locator('[data-testid="routing-map"] h3').evaluateAll((all) => all.map((h) => h.getBoundingClientRect().height))) {
        expect(height).toBeLessThanOrEqual(34);
      }
      const titleRow = await page.locator('[data-testid="routing-node-main-agent"]').evaluate((node) => ({
        title: node.querySelector('h3')?.getBoundingClientRect() ?? null,
        badges: Array.from(node.querySelectorAll('[data-testid="routing-node-badges"] [data-testid="scope-badge"], [data-testid="routing-node-status"]'))
          .map((badge) => badge.getBoundingClientRect().top),
      }));
      console.log(`B28 main node header ${host}/${theme}: title ${Math.round(titleRow.title?.top ?? 0)}-${Math.round(titleRow.title?.bottom ?? 0)}, badge tops ${titleRow.badges.map(Math.round).join(',')}`);
      // Every badge starts within the title's height: none drops to a row of its own under the header. In a 261 px
      // VS Code node the pill and one badge stack beside the two-line title; wider nodes hold them on one line.
      for (const top of titleRow.badges) expect(top).toBeLessThan(titleRow.title?.bottom ?? 0);
      // "PROVIDER:" / "MODEL:" start on the value's first line, and the value is shown whole (Batch 28b: it may wrap in
      // its own column, never truncate): nothing overflows its box and the text is the full route value.
      for (const row of ['routing-main-provider-row', 'routing-main-model-row']) {
        const layout = await page.locator(`[data-testid="${row}"]`).evaluate((node) => {
          const [label, value] = Array.from(node.children) as HTMLElement[];
          return { labelTop: label.getBoundingClientRect().top, valueTop: value.getBoundingClientRect().top,
            overflow: value.scrollWidth - value.clientWidth, lines: Math.round(value.getBoundingClientRect().height / 16) };
        });
        console.log(`B28b ${row} ${host}/${theme}: ${layout.lines} line(s), overflow ${layout.overflow}`);
        expect(Math.abs(layout.labelTop - layout.valueTop)).toBeLessThanOrEqual(4);
        expect(layout.overflow).toBeLessThanOrEqual(0);
      }
      await expect(page.locator('[data-testid="routing-main-model"]')).toHaveText('Default (chosen by Claude)');
      // Gate V 28 defect 1: in light theme the popover trigger wrapper drew a square border around the scope badge.
      expect(await page.locator('[data-testid="routing-node-main-agent"] .popover-trigger').first()
        .evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('0px');
      // Batch 26: the Main Agent popover (Reassign), captured open, then closed with Esc.
      await page.locator('[data-testid="routing-node-main-agent"] [data-testid="routing-node-action"]').click();
      const mainPopover = page.locator('[data-testid="main-agent-popover"]');
      await expect(mainPopover).toBeVisible();
      // The model catalogue has loaded (the model search is enabled) and the whole popover is on screen.
      const modelInput = mainPopover.locator('[data-testid="main-agent-model"] input');
      await expect(modelInput).toBeEnabled();
      const box = await mainPopover.boundingBox();
      const viewport = page.viewportSize();
      expect(box && viewport && box.y >= 0 && box.y + box.height <= viewport.height).toBe(true);
      console.log(`B26 popover ${host}/${theme}: ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)} @ ${Math.round(box?.x ?? 0)},${Math.round(box?.y ?? 0)}`);
      await waitForSettled(page);
      await assertPopoverOnTop(page, '[data-testid="main-agent-popover"]', 'select, button');
      await page.screenshot({ path: capturePath('main-agent-popover', host, theme), animations: 'disabled' });
      // Batch 28b: the compact model search with its list open and filtered. The list (position: fixed) is never
      // clipped by the popover's scroll box: it is inside the viewport and on top at every row.
      await modelInput.click();
      await modelInput.fill('kimi');
      const listboxId = await modelInput.getAttribute('aria-controls');
      const listbox = page.locator(`[id="${listboxId}"]`);
      await expect(listbox).toBeVisible();
      await expect(listbox.getByRole('option')).toHaveCount(4);
      const inView = (rect: { x: number; y: number; width: number; height: number } | null) => !!rect && !!viewport
        && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height;
      const listRect = await listbox.boundingBox();
      console.log(`B28b model list ${host}/${theme}: ${Math.round(listRect?.width ?? 0)}x${Math.round(listRect?.height ?? 0)} @ ${Math.round(listRect?.x ?? 0)},${Math.round(listRect?.y ?? 0)}`);
      expect(inView(listRect)).toBe(true);
      expect(inView(await mainPopover.boundingBox())).toBe(true);
      await assertPopoverOnTop(page, `[id="${listboxId}"]`, '[role="option"]');
      await page.screenshot({ path: capturePath('main-agent-model-search', host, theme), animations: 'disabled' });
      // Esc closes the list only; the popover stays.
      await page.keyboard.press('Escape');
      await expect(modelInput).toHaveAttribute('aria-expanded', 'false');
      await expect(mainPopover).toBeVisible();
      // The manual model-ID state is fully visible too; Cancel returns to the search (whose list the focus opens).
      await modelInput.click();
      await listbox.getByRole('option', { name: 'Enter a model ID…', exact: true }).click();
      await expect(mainPopover.locator('[data-testid="main-agent-model-manual"]')).toBeVisible();
      expect(inView(await mainPopover.boundingBox())).toBe(true);
      await mainPopover.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(modelInput).toBeFocused();
      await expect(modelInput).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(modelInput).toHaveAttribute('aria-expanded', 'false');
      // Batch 27b: the "Save to" list with the App target chosen, named after the host, and the provider
      // re-save confirm that names it ("Saved to: VS Code." / "Saved to: Desktop app."); cancelled after.
      const appLabel = host === 'electron' ? 'Desktop app' : 'VS Code';
      const saveTo = mainPopover.locator('[data-testid="main-agent-save-to"]');
      const saveToOptions = await saveTo.locator('option').allTextContents();
      console.log(`B27b save-to ${host}/${theme}: ${saveToOptions.map((text) => text.trim()).join(' | ')}`);
      expect(saveToOptions.map((text) => text.trim())).toEqual(['Global · all apps', appLabel, 'This workspace']);
      await saveTo.selectOption('app');
      await mainPopover.locator('[data-testid="main-agent-provider-rescope"]').click();
      await expect(mainPopover.locator('[data-testid="main-agent-provider-confirm"]')).toContainText(`Saved to: ${appLabel}.`);
      await waitForSettled(page);
      // Gate V 28 defect 4: the confirm state stays fully inside the viewport (the body scrolls, not the page).
      const confirmBox = await mainPopover.boundingBox();
      console.log(`B28 popover confirm ${host}/${theme}: ${Math.round(confirmBox?.width ?? 0)}x${Math.round(confirmBox?.height ?? 0)} @ ${Math.round(confirmBox?.x ?? 0)},${Math.round(confirmBox?.y ?? 0)}`);
      expect(confirmBox && viewport && confirmBox.y >= 0 && confirmBox.y + confirmBox.height <= viewport.height).toBe(true);
      await assertPopoverOnTop(page, '[data-testid="main-agent-popover"]', '[data-testid="main-agent-provider-confirm"] button');
      await page.screenshot({ path: capturePath('main-agent-save-to', host, theme), animations: 'disabled' });
      await mainPopover.getByRole('button', { name: 'Cancel provider change' }).click();
      await page.keyboard.press('Escape');
      await expect(mainPopover).toHaveCount(0);
      // Batch 23 (D16): every scope badge names its field; the open popover is its own capture.
      const badges = page.locator('[data-testid="scope-badge"]');
      // The scopes read lands after the tab renders; the fixture overrides the effort key.
      await expect(badges.first()).toBeVisible();
      for (const field of await badges.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-field')))) {
        expect(field?.trim()).toBeTruthy();
      }
      await badges.first().click();
      await expect(page.locator('[data-testid="scope-popover"]')).toBeVisible();
      await waitForSettled(page);
      // Batch 27b deviation 6: no routing-map node badge may paint over the open scope popover.
      await assertPopoverOnTop(page, '[data-testid="scope-popover"]', 'li, button, p');
      const scopeBox = await page.locator('[data-testid="scope-popover"]').boundingBox();
      console.log(`B28 scope popover ${host}/${theme}: ${Math.round(scopeBox?.width ?? 0)}x${Math.round(scopeBox?.height ?? 0)} @ ${Math.round(scopeBox?.x ?? 0)},${Math.round(scopeBox?.y ?? 0)}`);
      await page.screenshot({ path: capturePath('scope-popover', host, theme), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="scope-popover"]')).toHaveCount(0);
      // Batch 27: the provider catalog modal (prototype `#modalPalette`), centred and fully on screen.
      const connect = page.getByRole('button', { name: 'Connect provider', exact: true });
      await connect.click();
      const catalog = page.locator('ptah-provider-catalog-modal dialog');
      await expect(catalog).toHaveAttribute('open', '');
      await expect(catalog.locator('[data-testid="provider-catalog-search"]')).toBeFocused();
      // daisyUI scales the box in on open: measure once its transition has finished.
      await catalog.locator('.modal-box').evaluate((box) => Promise.all(box.getAnimations().map((animation) => animation.finished)));
      const panel = await catalog.locator('.modal-box').boundingBox();
      const view = page.viewportSize();
      expect(panel && view && panel.y >= 0 && panel.y + panel.height <= view.height).toBe(true);
      // Centred in its full-screen dialog (fixed, inset 0: the area left of the host's scrollbar gutter).
      const frame = await catalog.boundingBox();
      expect(panel && frame && Math.abs(panel.x + panel.width / 2 - (frame.x + frame.width / 2))).toBeLessThanOrEqual(1);
      console.log(`B27 catalog ${host}/${theme}: ${Math.round(panel?.width ?? 0)}x${Math.round(panel?.height ?? 0)} @ ${Math.round(panel?.y ?? 0)}`);
      await waitForSettled(page);
      await page.screenshot({ path: capturePath('provider-catalog', host, theme), animations: 'disabled' });
      await page.keyboard.press('Escape');
      // daisyUI keeps a closed `.modal` laid out at opacity 0: the `open` attribute is the real state.
      await expect(catalog).not.toHaveAttribute('open');
      await expect(connect).toBeFocused();
      const drawer = page.locator('[data-testid="connection-detail-drawer"]');
      for (const entry of DRAWERS) {
        // Batch 24: the card itself opens the drawer (a click on its name, clear of the inline action).
        await page.locator('[data-testid="provider-connection-card"]').filter({ hasText: entry.card })
          .locator('[data-testid="provider-name"]').click();
        await expect(drawer).toBeVisible();
        if (entry.tab) await page.getByRole('tab', { name: entry.tab, exact: true }).click();
        if (entry.ready) await expect(page.locator(entry.ready)).toBeVisible();
        await waitForSettled(page);
        await waitForDrawerOpened(page);
        await page.screenshot({ path: capturePath(entry.name, host, theme), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
      }
      if (foldFailure) throw foldFailure;
    });
  }
}
