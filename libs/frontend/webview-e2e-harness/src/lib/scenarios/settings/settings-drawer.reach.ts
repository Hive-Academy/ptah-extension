/**
 * Reach helpers for the Gate G table (`settings-reachability.table.ts`): the shared card/visibility
 * primitives and the connection drawer's tabs (Batches 20-22). Kept apart from the table so the table
 * holds the entries, and a later batch that moves a drawer control edits one helper here.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { getFixtureState, gotoSettingsTab } from './settings.fixtures';

export const providersTab = (page: Page) => gotoSettingsTab(page, 'Providers');
export const advancedTab = (page: Page) => gotoSettingsTab(page, 'Advanced');

/** A connection card by its visible provider name (today's flat card list). */
export const card = (page: Page, name: string): Locator =>
  page.locator('[data-testid="provider-connection-card"]').filter({ hasText: name });

export async function visibleEnabled(locator: Locator): Promise<void> {
  await expect(locator.first()).toBeVisible();
  await expect(locator.first()).toBeEnabled();
}

/**
 * Since Batch 20 the card's Manage opens the connection detail drawer. Asserts it is THIS
 * connection's drawer, then takes "Edit in setup" on the Advanced tab. Since Batch 22 only a custom
 * gateway keeps that setup path (D14: its name and protocol are edited in setup); every other kind's
 * credential and tier edits live in the drawer tabs, and their entries reach those directly.
 */
export async function setupThroughDrawer(page: Page, providerName: string): Promise<void> {
  await expect(page.locator('[data-testid="connection-detail-drawer"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-drawer-title"]')).toContainText(providerName);
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  const setup = page.locator('[data-testid="connection-edit-in-setup"]');
  await visibleEnabled(setup);
  await setup.click();
  await expect(page.locator('[data-testid="connection-detail-drawer"]')).toHaveCount(0);
}

/** Manage on a configured card, then the drawer tab named `tab`; returns the tab body `body`. */
export async function drawerTabOf(page: Page, providerName: string, tab: string, body: string): Promise<Locator> {
  await providersTab(page);
  const trigger = card(page, providerName).locator('[data-testid="btn-manage"]');
  await visibleEnabled(trigger);
  await trigger.click();
  await expect(page.locator('[data-testid="connection-drawer-title"]')).toContainText(providerName);
  await page.getByRole('tab', { name: tab, exact: true }).click();
  const panel = page.locator(`[data-testid="${body}"]`);
  await expect(panel).toBeVisible();
  return panel;
}

/** Manage on a configured card, then the drawer's Credentials tab (Batch 21). */
export const credentialsOf = (page: Page, providerName: string): Promise<Locator> =>
  drawerTabOf(page, providerName, 'Credentials', 'connection-credentials');

/** Closes the connection drawer through its footer Close. Best-effort: used from `finally`. */
export async function closeConnectionDrawer(page: Page): Promise<void> {
  await page.locator('[data-testid="connection-drawer-close"]').click({ timeout: 5000 }).catch(() => undefined);
  await expect(page.locator('[data-testid="connection-detail-drawer"]')).toHaveCount(0);
}

/** Runs `run` inside a drawer tab and always closes the drawer after it. */
export async function inDrawerTab(page: Page, providerName: string, tab: string, body: string,
  run: (panel: Locator) => Promise<void>): Promise<void> {
  try {
    await run(await drawerTabOf(page, providerName, tab, body));
  } finally {
    await closeConnectionDrawer(page);
  }
}

/** Types a model id into a tier's "Not listed? Enter a model ID" entry and applies it (a save on selection). */
export async function applyManualTierModel(panel: Locator, tier: string, modelId: string): Promise<void> {
  const row = panel.locator(`[data-tier="${tier}"]`);
  await row.getByText('Not listed? Enter a model ID').click();
  const manual = row.locator('[data-testid="provider-model-picker-manual-input"]');
  await visibleEnabled(manual);
  await manual.fill(modelId);
  await row.locator('[data-testid="provider-model-picker-manual-apply"]').click();
}

/** Asserts a `method` call recorded after `before` carries `params`. */
export async function expectCall(page: Page, before: number, method: string, params: unknown): Promise<void> {
  const state = getFixtureState(page);
  await expect.poll(() => state.calls.slice(before).filter((call) => call.method === method).map((call) => call.params))
    .toContainEqual(params);
}

/**
 * Re-reads the Providers page: leaving the tab tears `ProvidersSettingsComponent` down and coming back
 * runs `state.open()` again, so a fixture auth change (a stored Claude API key, a Copilot sign-in) shows.
 */
export async function remountProviders(page: Page): Promise<void> {
  await advancedTab(page);
  await providersTab(page);
}

/**
 * Runs `body` with an auth fixture change that makes an extra card appear, then restores the fixture
 * and re-reads, so later entries see the BRIEF baseline.
 */
export async function withAuthStatus(page: Page, change: Partial<ReturnType<typeof getFixtureState>['authStatus']>,
  body: () => Promise<void>): Promise<void> {
  const state = getFixtureState(page);
  const before = { ...state.authStatus };
  Object.assign(state.authStatus, change);
  try {
    await remountProviders(page);
    await body();
  } finally {
    await closeConnectionDrawer(page);
    Object.assign(state.authStatus, before);
    await remountProviders(page);
  }
}

/** Confirms an inline two-step write in the Credentials tab and asserts its RPC went out. */
export async function confirmWrite(page: Page, trigger: string, confirm: string, method: string, params: unknown): Promise<void> {
  const state = getFixtureState(page);
  const before = state.calls.length;
  const start = page.locator(`[data-testid="${trigger}"]`);
  await visibleEnabled(start);
  await start.click();
  const confirmButton = page.locator(`[data-testid="${confirm}"]`);
  await visibleEnabled(confirmButton);
  await confirmButton.click();
  await expect(page.locator('[data-testid="credentials-commit"]')).toBeVisible();
  await expect.poll(() => state.calls.slice(before).find((call) => call.method === method)?.params).toEqual(params);
}
