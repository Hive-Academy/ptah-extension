/**
 * E2E: Settings smoke captures (TASK_2026_555 Batch 16, Task 16.1 — plan
 * Component 14, §6): both tabs, both hosts, both themes, at 1024x768, so
 * drift is visible at every commit (execution default 9). Batch 28 added the
 * Providers fold gate (`assertProvidersFold`) and the popover stacking check
 * (`assertPopoverOnTop`); Batch 36 added the Orchestration fold gate (`assertOrchestrationFold`).
 *
 * Pattern followed: `../marketplace/marketplace-visual.e2e.spec.ts`
 * (`waitForSettled`, `useAppBuild: true`, captures written under
 * `.ptah/specs/<task>/screenshots/angular/`). Every capture goes through the shared `capture()`
 * (`settings-capture.ts`, Batch 51.6).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { bootSettings, gotoSettingsTab, waitForSettled } from './settings.fixtures';
import { capture } from './settings-capture';
import { LIVE_VERSIONS, liveShapeOverrides } from './settings-live-shape.fixtures';

test.use({ useAppBuild: true });

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

/**
 * Batch 30: the CLI matrix (table-xs) and its Codex model, effort and permission popovers, each captured open and
 * fully on screen, then closed with Esc (the model search closes its list first). Row heights are logged; the
 * Orchestration fold is asserted in `assertOrchestrationFold` (Batch 36).
 */
async function captureMatrixPopovers(page: Page, host: 'vscode' | 'electron', theme: string): Promise<void> {
  const matrix = page.locator('[data-testid="cli-matrix"]');
  await expect(matrix).toBeVisible();
  const rows = await matrix.locator('tr[data-testid^="cli-matrix-row-"]').evaluateAll((all) => all.map((row) =>
    `${row.getAttribute('data-testid')?.replace('cli-matrix-row-', '')}:${Math.round(row.getBoundingClientRect().height)}`));
  // Every column fits its box in both hosts (Electron moves the provider under the agent name): nothing scrolls sideways.
  const overflow = await matrix.evaluate((table) => {
    const box = table.parentElement;
    return box ? box.scrollWidth - box.clientWidth : 0;
  });
  console.log(`B30 matrix ${host}/${theme}: header bottom ${await bottomOf(page, '[data-testid="cli-matrix"] thead')}, `
    + `first row bottom ${await bottomOf(page, '[data-testid="cli-matrix"] tbody tr')}; overflow ${overflow}px; rows ${rows.join(', ')}`);
  expect(overflow, 'CLI matrix horizontal overflow').toBeLessThanOrEqual(0);
  const viewport = page.viewportSize();
  const onScreen = async (selector: string) => {
    const box = await page.locator(selector).boundingBox();
    expect(box && viewport && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width,
      `${selector} on screen`).toBe(true);
  };
  // Batch 31: popovers sit inside table cells (nowrap, right-aligned); their text must still wrap inside the panel.
  const noOverflow = async (selector: string) => {
    const overflow = await page.locator(selector).evaluate((panel) =>
      Math.max(0, ...Array.from(panel.querySelectorAll('p, h3, label, span')).map((node) => node.scrollWidth - node.clientWidth),
        panel.scrollWidth - panel.clientWidth));
    expect(overflow, `${selector} content overflow`).toBeLessThanOrEqual(0);
  };
  const popover = '[data-testid="cli-matrix-popover"]';
  // Model: the cell opens the popover with its search focused and the list open (interactions/orchestration-2).
  await page.locator('[data-testid="cli-matrix-model-codex"]').click();
  const search = page.locator(`${popover} input[role="combobox"]`);
  await expect(search).toBeEnabled();
  await expect(search).toBeFocused();
  const listbox = page.locator(`[id="${await search.getAttribute('aria-controls')}"]`);
  await expect(listbox).toBeVisible();
  await waitForSettled(page);
  await onScreen(popover);
  await assertPopoverOnTop(page, popover, 'h3, button');
  await capture(page, 'orchestration-popover-model', host, theme);
  await page.keyboard.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator(popover)).toHaveCount(0);
  // Effort: the CLI's allowlist as a two-column grid, the saved value pressed (interactions/orchestration-3).
  await page.locator('[data-testid="cli-matrix-effort-codex"]').click();
  await expect(page.locator(`${popover} [aria-pressed="true"]`)).toHaveText('Medium');
  await onScreen(popover);
  await assertPopoverOnTop(page, popover, 'button');
  await capture(page, 'orchestration-popover-effort', host, theme);
  await page.keyboard.press('Escape');
  await expect(page.locator(popover)).toHaveCount(0);
  // Permission ℹ (the copy shown to the user at Gate V 36).
  await page.locator('[data-testid="cli-matrix-permission-info-codex"]').click();
  await expect(page.locator('[data-testid="cli-permission-popover"]')).toBeVisible();
  await onScreen('[data-testid="cli-permission-popover"]');
  await capture(page, 'orchestration-popover-permission', host, theme);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="cli-permission-popover"]')).toHaveCount(0);
  // Batch 31: Copilot's permission popover with the moved auto-approve toggle, and Cursor's Credentials popover.
  await page.locator('[data-testid="cli-matrix-permission-info-copilot"]').click();
  await expect(page.locator('[data-testid="cli-permission-popover"] [data-testid="copilot-auto-approve"]')).toBeEnabled();
  await onScreen('[data-testid="cli-permission-popover"]');
  await noOverflow('[data-testid="cli-permission-popover"]');
  await assertPopoverOnTop(page, '[data-testid="cli-permission-popover"]', 'h3, p, input');
  await capture(page, 'orchestration-popover-copilot', host, theme);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="cli-permission-popover"]')).toHaveCount(0);
  // Gate V 36 decision 1: Cursor's row is in the Uninstalled group, collapsed by default.
  const uninstalledToggle = page.locator('[data-testid="cli-matrix-uninstalled-toggle"]');
  if ((await uninstalledToggle.getAttribute('aria-expanded')) === 'false') await uninstalledToggle.click();
  await page.locator('[data-testid="cli-matrix-credentials-cursor"]').click();
  const cursorPopover = '[data-testid="cursor-credential-popover"]';
  await expect(page.locator(`${cursorPopover} [data-testid="cursor-credential-key"]`)).toBeFocused();
  await onScreen(cursorPopover);
  await noOverflow(cursorPopover);
  expect(await page.locator(`${cursorPopover} [data-testid="cursor-credential-help"]`).evaluate((node) => getComputedStyle(node).textAlign))
    .toBe('left');
  await assertPopoverOnTop(page, cursorPopover, 'h3, p, input, button');
  console.log(`B31 cursor popover ${host}/${theme}: ${JSON.stringify(await page.locator(cursorPopover).boundingBox())}`);
  await capture(page, 'orchestration-popover-cursor', host, theme);
  await page.keyboard.press('Escape');
  await expect(page.locator(cursorPopover)).toHaveCount(0);
  await uninstalledToggle.click();
  await expect(uninstalledToggle).toHaveAttribute('aria-expanded', 'false');
  // Batch 32: the add-instance modal (prototype interactions/orchestration-1, with an API-key provider chosen) and Glm's
  // tier-mapping modal, centred and fully on screen once daisyUI's open transition has finished.
  for (const modal of [
    { opener: '[data-testid="cli-matrix-add"]', testid: 'add-cli-instance-modal', name: 'orchestration-modal-add' },
    { opener: '[data-testid="cli-matrix-tiers-glm-instance-1"]', testid: 'cli-tier-mapping-modal', name: 'orchestration-modal-tiers' },
  ]) {
    await page.locator(modal.opener).click();
    const dialog = page.locator(`dialog:has([data-testid="${modal.testid}"])`);
    await expect(dialog).toHaveAttribute('open', '');
    if (modal.testid === 'add-cli-instance-modal') {
      await dialog.locator('[data-testid="add-cli-instance-name"]').fill('Glm-Secondary');
      await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('moonshot');
    } else {
      await expect(dialog.locator('[data-testid="cli-tier-source-haiku"]')).not.toContainText('loading');
    }
    await dialog.locator('.modal-box').evaluate((box) => Promise.all(box.getAnimations().map((animation) => animation.finished)));
    const panel = await dialog.locator('.modal-box').boundingBox();
    expect(panel && viewport && panel.y >= 0 && panel.y + panel.height <= viewport.height, `${modal.name} on screen`).toBe(true);
    console.log(`B32 ${modal.name} ${host}/${theme}: ${Math.round(panel?.width ?? 0)}x${Math.round(panel?.height ?? 0)} @ ${Math.round(panel?.x ?? 0)},${Math.round(panel?.y ?? 0)}`);
    await waitForSettled(page, dialog);
    await capture(page, modal.name, host, theme);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open');
  }
}

type OrchestrationFoldRegion = 'policyBar' | 'matrixHeader' | 'firstRow' | 'rolesSummary';

/**
 * THE per-host Orchestration fold budget (plan §6 :1049-1052, design-spec §1.2), measured on the 5+2 reference set
 * (5 installed CLIs / instances, 2 uninstalled). Ratchet (execution default 3), the track B
 * `SEARCH_VOICE_FOLD_ENFORCED` pattern:
 * - VS Code: every region is enforced (roles summary at 643 px since Batch 33).
 * - Electron: every region is enforced since Batch 36b (fold round 2). The roles summary was at 779 px (Gate V 36
 *   item 4). It now fits because the Uninstalled group is collapsed by default (user decision, 2026-10-02), instance
 *   actions are on one line (V36-7), and in the narrow layout the tier badges become one summary badge and the status
 *   and provider share one line (orchestrator decision).
 */
const ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = true;
const ORCHESTRATION_FOLD = 660;
const ORCHESTRATION_FOLD_REGIONS: Readonly<Record<'vscode' | 'electron', readonly OrchestrationFoldRegion[]>> = {
  vscode: ['policyBar', 'matrixHeader', 'firstRow', 'rolesSummary'],
  electron: ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED
    ? ['policyBar', 'matrixHeader', 'firstRow', 'rolesSummary']
    : ['policyBar', 'matrixHeader', 'firstRow'],
};

/**
 * Batch 36 fold gate for Orchestration, per host (`ORCHESTRATION_FOLD_REGIONS`): nothing scrolled, the reference set
 * (5 installed rows, 2 uninstalled), both tables `table-xs`, the roles `<details>` closed, and the region bottoms at or
 * above 660 px. Every number (bottoms, matrix row heights) is logged for the report, enforced or not.
 */
async function assertOrchestrationFold(page: Page, host: 'vscode' | 'electron', theme: string): Promise<void> {
  const matrix = page.locator('[data-testid="cli-matrix"]');
  await expect(matrix).toBeVisible();
  const details = page.locator('[data-testid="background-roles-details"]');
  const scroll = await page.evaluate(() => ({
    window: window.scrollY,
    page: Math.max(0, ...Array.from(document.querySelectorAll('ptah-orchestration-settings, ptah-orchestration-settings *'))
      .map((node) => node.scrollTop)),
  }));
  const bottoms: Record<OrchestrationFoldRegion, number> = {
    policyBar: await bottomOf(page, '[data-testid="orchestration-policy-bar"]'),
    matrixHeader: await bottomOf(page, '[data-testid="cli-matrix"] thead'),
    firstRow: await bottomOf(page, '[data-testid="cli-matrix"] tbody tr[data-testid^="cli-matrix-row-"]'),
    rolesSummary: await bottomOf(page, '[data-testid="background-roles-summary"]'),
  };
  const rowHeights = await matrix.locator('tr[data-testid^="cli-matrix-row-"]').evaluateAll((rows) => rows.map((row) =>
    `${row.getAttribute('data-testid')?.replace('cli-matrix-row-', '')}:${Math.round(row.getBoundingClientRect().height)}`));
  const uninstalledHeader = await matrix.locator('[data-testid="cli-matrix-uninstalled"] tr').first()
    .evaluate((row) => Math.round(row.getBoundingClientRect().height));
  const installed = await matrix.locator('tbody:not([data-testid="cli-matrix-uninstalled"]) tr[data-testid^="cli-matrix-row-"]').count();
  // Decision 1: the group is collapsed by default; its disclosure carries the count ("Uninstalled CLI agents (2)").
  const uninstalledToggle = matrix.locator('[data-testid="cli-matrix-uninstalled-toggle"]');
  await expect(uninstalledToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(matrix.locator('[data-testid="cli-matrix-uninstalled"] tr[data-testid^="cli-matrix-row-"]')).toHaveCount(0);
  const uninstalled = Number(/\((\d+)\)/.exec((await uninstalledToggle.textContent()) ?? '')?.[1] ?? NaN);
  const over = (Object.keys(bottoms) as OrchestrationFoldRegion[])
    .filter((region) => bottoms[region] > ORCHESTRATION_FOLD).map((region) => `${region} ${bottoms[region]}px > ${ORCHESTRATION_FOLD}px`);
  console.log(`B36 fold orchestration ${host}/${theme}: scroll ${scroll.window}/${scroll.page}; bottoms policy bar ${bottoms.policyBar}, `
    + `matrix header ${bottoms.matrixHeader}, first row ${bottoms.firstRow}, roles summary ${bottoms.rolesSummary} (budget ${ORCHESTRATION_FOLD}); `
    + `reference set ${installed}+${uninstalled} (collapsed); uninstalled header ${uninstalledHeader}; row heights ${rowHeights.join(', ')}; `
    + `over: ${over.length ? over.join('; ') : 'none'}`);
  expect(scroll).toEqual({ window: 0, page: 0 });
  expect({ installed, uninstalled }, 'the 5+2 reference set').toEqual({ installed: 5, uninstalled: 2 });
  await expect(matrix).toHaveClass(/\btable-xs\b/);
  await expect(page.locator('[data-testid="consumer-table"]')).toHaveClass(/\btable-xs\b/);
  await expect(details).not.toHaveAttribute('open');
  for (const region of ORCHESTRATION_FOLD_REGIONS[host]) {
    expect(bottoms[region], `${region} bottom`).toBeLessThanOrEqual(ORCHESTRATION_FOLD);
  }
  const pending = over.filter((entry) => !ORCHESTRATION_FOLD_REGIONS[host].some((region) => entry.startsWith(`${region} `)));
  if (pending.length) {
    test.info().annotations.push({
      type: 'fold-pending',
      description: `${host}/${theme}: ${pending.join('; ')} — over after the Gate V 36 decision 1 collapse (Batch 36b)`,
    });
  }
}

/**
 * Batch 33: captures the background roles `<details>` opened by its summary, and closes it again. Batch 36 moved the
 * fold measurement to `assertOrchestrationFold`.
 */
async function captureRolesOpen(page: Page, host: 'vscode' | 'electron', theme: string): Promise<void> {
  await expect(page.locator('[data-testid="cli-matrix"]')).toBeVisible();
  const details = page.locator('[data-testid="background-roles-details"]');
  const summary = page.locator('[data-testid="background-roles-summary"]');
  await expect(details).not.toHaveAttribute('open');
  // Batch 34 revise 1: the disclosure chevron points right (›) closed and down (⌄) open: one 90° clockwise turn, on its
  // wrapper only. lucide-angular copies its host class onto the <svg>, so a rotate on the icon applied twice (180°, ‹).
  const chevron = summary.locator('[data-testid="background-roles-chevron"]');
  const turn = () => chevron.evaluate((node) => {
    const icons = Array.from(node.querySelectorAll('lucide-angular, svg')).map((icon) => getComputedStyle(icon).transform);
    return { wrapper: getComputedStyle(node).transform, icons: icons.every((value) => value === 'none') ? 'none' : icons.join(' / ') };
  });
  expect(await turn(), 'closed chevron points right').toEqual({ wrapper: 'none', icons: 'none' });
  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(page.locator('[data-testid="assignments-heading"]')).toBeVisible();
  await expect.poll(turn, { message: 'open chevron points down: the wrapper turns 90° clockwise, the icon does not turn' })
    .toEqual({ wrapper: 'matrix(0, 1, -1, 0, 0, 0)', icons: 'none' });
  // Batch 35 revise R1: every role's Provider & model cell is one line in both hosts (the label truncates instead).
  const cellHeights = await page.locator('[data-testid^="consumer-edit-"]').evaluateAll((cells) =>
    cells.map((cell) => Math.round(cell.getBoundingClientRect().height)));
  const rowHeights = await page.locator('[data-testid^="consumer-row-"]').evaluateAll((rows) =>
    rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  console.log(`B35 role cells ${host}/${theme}: cell heights ${cellHeights.join(',')}; row heights ${rowHeights.join(',')}`);
  expect(cellHeights).toHaveLength(6);
  for (const height of cellHeights) expect(height, 'role cell is one line').toBeLessThanOrEqual(24);
  await summary.evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await waitForSettled(page);
  await capture(page, 'orchestration-roles-open', host, theme);
  // Batch 35: a role's reassignment popover (the Judge lane cell), on screen and painted on top; Esc returns focus.
  const roleCell = page.locator('[data-testid="consumer-edit-judge"]');
  await roleCell.click();
  const rolePopover = page.locator('[data-testid="consumer-editor-judge"]');
  await expect(rolePopover).toBeVisible();
  const popoverBox = await rolePopover.boundingBox();
  const viewport = page.viewportSize();
  expect(popoverBox && viewport && popoverBox.y + popoverBox.height <= viewport.height && popoverBox.x + popoverBox.width <= viewport.width,
    'role popover is fully on screen').toBeTruthy();
  console.log(`B35 role popover ${host}/${theme}: ${Math.round(popoverBox?.width ?? 0)}x${Math.round(popoverBox?.height ?? 0)} at ${Math.round(popoverBox?.x ?? 0)},${Math.round(popoverBox?.y ?? 0)}`);
  await waitForSettled(page);
  await capture(page, 'orchestration-role-popover', host, theme);
  await page.keyboard.press('Escape');
  await expect(rolePopover).toHaveCount(0);
  await expect(roleCell).toBeFocused();
  await summary.click();
  await expect(details).not.toHaveAttribute('open');
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const node of Array.from(document.querySelectorAll('*'))) if (node.scrollTop) node.scrollTop = 0;
  });
}

/**
 * Batch 33 revise 1: the policy bar is one row in both hosts, and its order popover (opened from the chips) has ▲/▼
 * targets of at least 24×24 px (WCAG 2.5.8). Captured open; Esc closes it and returns focus to the chips.
 */
async function captureOrderPopover(page: Page, host: 'vscode' | 'electron', theme: string): Promise<void> {
  const bar = page.locator('[data-testid="orchestration-policy-bar"]');
  const barBox = await bar.boundingBox();
  console.log(`B33 policy bar ${host}/${theme}: ${Math.round(barBox?.width ?? 0)}x${Math.round(barBox?.height ?? 0)}`);
  expect(barBox?.height ?? 0, 'policy bar is one row').toBeLessThanOrEqual(48);
  const trigger = bar.locator('[data-testid="policy-order-edit"]');
  const triggerBox = await trigger.boundingBox();
  expect(Math.min(triggerBox?.width ?? 0, triggerBox?.height ?? 0), 'Edit order target').toBeGreaterThanOrEqual(24);
  await trigger.click();
  const popover = page.locator('[data-testid="policy-order-popover"]');
  await expect(popover).toBeVisible();
  const targets = await popover.locator('li button').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return Math.min(Math.round(box.width), Math.round(box.height));
  }));
  console.log(`B33 order popover ${host}/${theme}: ${JSON.stringify(await popover.boundingBox())}; smallest target ${Math.min(...targets)}px`);
  for (const size of targets) expect(size, 'move button target').toBeGreaterThanOrEqual(24);
  const box = await popover.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y >= 0 && box.y + box.height <= viewport.height && box.x + box.width <= viewport.width,
    'order popover on screen').toBe(true);
  await assertPopoverOnTop(page, '[data-testid="policy-order-popover"]', 'h3, li span, li button');
  await waitForSettled(page);
  await capture(page, 'orchestration-order-popover', host, theme);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
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
        // The matrix is a deferred chunk: the capture waits for its rows, or it can catch an empty section or the
        // On ticks mid-bounce (Batch 36c.i).
        if (tab.name === 'orchestration') await expect(page.locator('[data-testid="cli-matrix-toggle-codex"]')).toBeVisible();
        await capture(page, tab.name, host, theme);
      }
      // Batch 36: the Orchestration fold gate (the tab is still open), then (Batch 33) the roles <details> open.
      await test.step('orchestration fold', () => assertOrchestrationFold(page, host, theme))
        .catch((error: unknown) => { foldFailure = error; });
      await captureRolesOpen(page, host, theme);
      await captureOrderPopover(page, host, theme);
      // Batch 30: the CLI matrix's cell popovers (prototype interactions/orchestration-2/-3).
      await captureMatrixPopovers(page, host, theme);
      await gotoSettingsTab(page, 'Providers');
      await waitForSettled(page);
      // Batch 28: the fold gate, in both hosts (Q-extra-1: container-width columns, 80 px cards everywhere).
      await test.step('fold', () => assertProvidersFold(page, host, theme)).catch((error: unknown) => { foldFailure ??= error; });
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
      // Gate V 28 (prototype header): the status pill and badges sit beside the title. Since Batch 52.6 every title is
      // one line (16 px leading); a layer badge that does not fit moves, whole, to the next line under it.
      for (const height of await page.locator('[data-testid="routing-map"] h3').evaluateAll((all) => all.map((h) => h.getBoundingClientRect().height))) {
        expect(height).toBeLessThanOrEqual(17);
      }
      const titleRow = await page.locator('[data-testid="routing-node-main-agent"]').evaluate((node) => ({
        title: node.querySelector('h3')?.getBoundingClientRect() ?? null,
        badges: Array.from(node.querySelectorAll('[data-testid="routing-node-status"], [data-testid="main-scope-layer"]'))
          .map((badge) => badge.getBoundingClientRect().top),
      }));
      console.log(`B28 main node header ${host}/${theme}: title ${Math.round(titleRow.title?.top ?? 0)}-${Math.round(titleRow.title?.bottom ?? 0)}, badge tops ${titleRow.badges.map(Math.round).join(',')}`);
      // The status pill sits on the title's line; layer badges are on it or on the one line under it.
      expect(titleRow.badges[0]).toBeLessThan(titleRow.title?.bottom ?? 0);
      for (const top of titleRow.badges) expect(top).toBeLessThan((titleRow.title?.bottom ?? 0) + 28);
      // Batch 52.6: no layer badge runs past the node, and none is truncated (its text fits its box).
      const headFit = await page.locator('[data-testid="routing-node-main-agent"]').evaluate((node) => ({
        title: node.querySelector('h3')?.getBoundingClientRect().height ?? 0,
        overflow: Math.max(0, ...Array.from(node.querySelectorAll('[data-testid="main-scope-layer"]'))
          .map((badge) => badge.getBoundingClientRect().right - node.getBoundingClientRect().right)),
        clipped: Array.from(node.querySelectorAll<HTMLElement>('[data-testid="main-scope-layer"]')).some((badge) => badge.scrollWidth > badge.clientWidth + 1),
      }));
      expect(headFit.title).toBeLessThanOrEqual(17);
      expect(headFit.overflow).toBeLessThanOrEqual(0.5);
      expect(headFit.clipped).toBe(false);
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
      await capture(page, 'main-agent-popover', host, theme);
      // Batch 28b: the compact model search with its list open and filtered. The list (position: fixed) is never
      // clipped by the popover's scroll box: it is inside the viewport and on top at every row.
      await modelInput.click();
      // The list must be open before typing: a query that lands on the same render as the open keeps the open contract
      // (no active row, `native-autocomplete` applyOpenActiveIndex), so the 51.3 wait below would never be met.
      await expect(modelInput).toHaveAttribute('aria-expanded', 'true');
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
      // Batch 51.3: the active row is drawn before the capture (the attribute and the row's highlight follow the next
      // render; 2 of 4 merge-run captures caught the list without it).
      await expect(modelInput).toHaveAttribute('aria-activedescendant', /.+/);
      const activeId = await modelInput.getAttribute('aria-activedescendant');
      await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator(`[id="${activeId}"]`)).toHaveClass(/\bbg-primary\b/);
      await capture(page, 'main-agent-model-search', host, theme);
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
      await capture(page, 'main-agent-save-to', host, theme);
      await mainPopover.getByRole('button', { name: 'Cancel provider change' }).click();
      await page.keyboard.press('Escape');
      await expect(mainPopover).toHaveCount(0);
      // Batch 23 (D16): every scope badge names its field; the open popover is its own capture. Since Batch 52.6 the
      // Main Agent's field badges are in its layer badge's popover.
      await page.locator('[data-testid="main-scope-layer"]').first().click();
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
      await capture(page, 'scope-popover', host, theme);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="scope-popover"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="main-scope-layer-popover"]')).toHaveCount(0);
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
      await capture(page, 'provider-catalog', host, theme);
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
        await capture(page, entry.name, host, theme);
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
      }
      if (foldFailure) throw foldFailure;
    });
  }
}

/**
 * Batch 52.4: live-shaped values (raw CLI version lines, an "id<TAB>name" Antigravity model, three Main Agent override
 * layers; `settings-live-shape.fixtures.ts`). Asserts 52.1-52.3 in both hosts and themes, and captures both tabs as
 * `live-providers` / `live-orchestration`.
 */
for (const host of ['vscode', 'electron'] as const) {
  for (const theme of ['anubis', 'anubis-light'] as const) {
    test(`live-shaped values — Batch 52 (${host}, ${theme})`, async ({ page, fixtureServer }) => {
      await bootSettings(page, fixtureServer.url, host, theme, liveShapeOverrides(page));
      await page.setViewportSize({ width: 1024, height: 768 });
      await gotoSettingsTab(page, 'Providers');
      await waitForSettled(page);
      // 52.6: one badge per overridden layer (prototype), never truncated: the App layer named after the host, then
      // "Workspace override". The title stays one line; a badge that does not fit moves under it.
      const node = page.locator('[data-testid="routing-node-main-agent"]');
      const layers = node.locator('[data-testid="main-scope-layer"]');
      await expect(layers).toHaveText([host === 'electron' ? 'Desktop app override' : 'VS Code override', 'Workspace override']);
      const head = await node.evaluate((element) => {
        const title = element.querySelector('h3')?.getBoundingClientRect();
        const badges = Array.from(element.querySelectorAll<HTMLElement>('[data-testid="main-scope-layer"]'));
        const nodeBox = element.getBoundingClientRect();
        return { titleHeight: title?.height ?? 0, titleBottom: title?.bottom ?? 0,
          tops: badges.map((badge) => badge.getBoundingClientRect().top),
          overflow: Math.max(...badges.map((badge) => badge.getBoundingClientRect().right)) - nodeBox.right,
          clipped: badges.some((badge) => badge.scrollWidth > badge.clientWidth + 1), nodeHeight: nodeBox.height };
      });
      console.log(`B52 main node head ${host}/${theme}: title h ${Math.round(head.titleHeight)}, layer tops ${head.tops.map(Math.round).join(',')}, overflow ${Math.round(head.overflow)}, node h ${Math.round(head.nodeHeight)}`);
      expect(head.titleHeight).toBeLessThanOrEqual(17);
      // Whole badges wrap under the title: in the 261 px VS Code node each of the two takes its own line (two badge
      // lines); in Electron the first fits beside the title. Never more than two lines under the title.
      for (const top of head.tops) expect(top).toBeLessThan(head.titleBottom + 56);
      expect(head.overflow).toBeLessThanOrEqual(0.5);
      expect(head.clipped).toBe(false);
      // The Gate V 28 fold still holds with the taller node (VS Code card 5, Electron map + Connections heading).
      await assertProvidersFold(page, host, theme);
      await capture(page, 'live-providers', host, theme);
      // The workspace layer's popover lists its two fields by name (D16); Esc returns focus to the layer badge.
      await layers.nth(1).click();
      const popover = page.locator('[data-testid="main-scope-layer-popover"]');
      await expect(popover.locator('[data-testid="scope-badge"]')).toHaveCount(2);
      await expect(popover.locator('[data-testid="scope-badge"]').nth(0)).toHaveAttribute('data-field', 'Main agent authentication');
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(layers.nth(1)).toBeFocused();

      await gotoSettingsTab(page, 'Agent Orchestration');
      await waitForSettled(page);
      await expect(page.locator('[data-testid="cli-matrix-toggle-codex"]')).toBeVisible();
      // 52.1: one normalised version beside each name, on the name's line.
      const expected: Readonly<Record<string, string>> = { codex: 'v0.155.1', copilot: 'v1.0.83', opencode: 'v2.0.12', antigravity: 'v1.2.14' };
      for (const [cli, label] of Object.entries(expected)) {
        const version = page.locator(`[data-testid="cli-matrix-row-${cli}"] [data-testid="cli-matrix-version"]`);
        await expect(version).toHaveText(label);
        await expect(version).toHaveAttribute('title', LIVE_VERSIONS[cli]);
        const line = await version.evaluate((element) => {
          const name = element.parentElement?.firstElementChild?.getBoundingClientRect();
          const own = element.getBoundingClientRect();
          return { nameTop: name?.top ?? 0, nameBottom: name?.bottom ?? 0, top: own.top, bottom: own.bottom };
        });
        expect(line.top).toBeLessThan(line.nameBottom);
        expect(line.bottom).toBeGreaterThan(line.nameTop);
      }
      // 52.2: the Antigravity model cell shows the id once, on at most two lines, with the name in its title.
      const model = page.locator('[data-testid="cli-matrix-model-antigravity"]');
      await expect(model.locator('span').first()).toHaveText('claude-sonnet-4-6');
      await expect(model).toHaveAttribute('title', 'claude-sonnet-4-6 (Claude Sonnet 4.6 (Thinking))');
      const modelLines = await model.locator('span').first().evaluate((element) =>
        Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)));
      expect(modelLines).toBeLessThanOrEqual(2);
      await capture(page, 'live-orchestration', host, theme);
    });
  }
}
