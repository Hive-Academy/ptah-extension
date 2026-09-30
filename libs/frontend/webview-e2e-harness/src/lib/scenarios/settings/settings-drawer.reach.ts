/**
 * Reach helpers for the Gate G table (`settings-reachability.table.ts`): the shared card/visibility
 * primitives and the connection drawer's tabs (Batches 20-22). Kept apart from the table so the table
 * holds the entries, and a later batch that moves a drawer control edits one helper here.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { getFixtureState, gotoSettingsTab } from './settings.fixtures';

export const providersTab = (page: Page) => gotoSettingsTab(page, 'Providers');
export const orchestrationTab = (page: Page) => gotoSettingsTab(page, 'Agent Orchestration');
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

/**
 * Opens a connection's drawer the way a user does since Batch 24: a click on the card itself (the
 * provider name, clear of the card's one inline action).
 */
export async function openCardDrawer(page: Page, providerName: string): Promise<void> {
  const name = card(page, providerName).locator('[data-testid="provider-name"]');
  await expect(name).toBeVisible();
  await name.click();
  await expect(page.locator('[data-testid="connection-detail-drawer"]')).toBeVisible();
}

/** A click on a configured card, then the drawer tab named `tab`; returns the tab body `body`. */
export async function drawerTabOf(page: Page, providerName: string, tab: string, body: string): Promise<Locator> {
  await providersTab(page);
  await openCardDrawer(page, providerName);
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

/**
 * Providers tab, then the scope badge of `field` (its full name, `data-field`, D16); returns its open
 * popover. Batch 23: the badge replaced the always-visible scope strip.
 */
export async function openScopeBadge(page: Page, field: string): Promise<Locator> {
  await providersTab(page);
  const badge = page.locator(`[data-testid="scope-badge"][data-field="${field}"]`);
  await visibleEnabled(badge);
  await badge.click();
  const popover = page.locator('[data-testid="scope-popover"]');
  await expect(popover).toBeVisible();
  await expect(popover.locator('[data-testid="scope-popover-title"]')).toHaveText(field);
  return popover;
}

/**
 * The Ptah CLI instance manager. Batch 18 (D14) moved it, unchanged, from Providers to the interim
 * Orchestration container, together with its read states and the commit feedback (#56).
 */
export async function cliConfigSection(page: Page): Promise<Locator> {
  await orchestrationTab(page);
  const heading = page.locator('#providers-cli-heading');
  await visibleEnabled(heading);
  return heading;
}

/** Opens one delegated CLI's Edit on the CLI manager, then cancels it. */
export async function throughDelegatedEdit(page: Page, choiceLabel: string): Promise<void> {
  await cliConfigSection(page);
  const editButton = page.getByRole('button', { name: `Edit ${choiceLabel}` });
  await visibleEnabled(editButton);
  await editButton.click();
  const cancelButton = page.getByRole('button', { name: `Cancel ${choiceLabel} edit` });
  await visibleEnabled(cancelButton);
  await cancelButton.click();
}

/** Providers tab, then the routing map's Main Agent "Reassign": returns the open Main Agent popover (Batch 26). */
export async function openMainAgentPopover(page: Page): Promise<Locator> {
  await providersTab(page);
  const reassign = page.locator('[data-testid="routing-node-main-agent"] [data-testid="routing-node-action"]');
  await visibleEnabled(reassign);
  await reassign.click();
  const popover = page.locator('[data-testid="main-agent-popover"]');
  await expect(popover).toBeVisible();
  return popover;
}

/**
 * Batch 27b: the App scope is the running host's own layer (`app.vscode.*` / `app.electron.*`), offered in
 * both hosts and named after the host ("VS Code" or "Desktop app"). Asserts `appEntry` reads the host's name
 * and `container` never shows the other host's; returns the host's name.
 */
export async function expectHostAppScope(page: Page, container: Locator, appEntry: Locator): Promise<string> {
  const electron = (await page.locator('ptah-electron-shell').count()) > 0;
  const [label, other] = electron ? ['Desktop app', 'VS Code'] : ['VS Code', 'Desktop app'];
  await expect(appEntry).toHaveText(label);
  await expect(container).not.toContainText(other);
  return label;
}

/** Closes the Main Agent popover with Esc (focus returns to Reassign). */
export async function closeMainAgentPopover(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="main-agent-popover"]')).toHaveCount(0);
}

/**
 * The provider catalog modal's native `<dialog>` (Batch 27). daisyUI's `.modal` keeps a closed dialog laid out at
 * opacity 0, so Playwright's visible/hidden cannot tell open from closed: use `expectCatalogOpen` instead.
 */
export const catalogDialog = (page: Page): Locator => page.locator('ptah-provider-catalog-modal dialog');
export async function expectCatalogOpen(page: Page, open: boolean): Promise<void> {
  if (open) await expect(catalogDialog(page)).toHaveAttribute('open', '');
  else await expect(catalogDialog(page)).not.toHaveAttribute('open');
}
/** The page header's "Connect provider" (the catalog opener that focus returns to). */
export const connectProviderButton = (page: Page): Locator => page.getByRole('button', { name: 'Connect provider', exact: true });

/** Providers tab, then "Connect provider": the catalog modal is open with its search focused (Batch 27). */
export async function openCatalog(page: Page): Promise<Locator> {
  await providersTab(page);
  // A modal left open by an earlier failed entry makes the page inert: close it rather than click through it.
  if ((await catalogDialog(page).getAttribute('open').catch(() => null)) !== null) await page.keyboard.press('Escape');
  await visibleEnabled(connectProviderButton(page));
  await connectProviderButton(page).click();
  await expectCatalogOpen(page, true);
  await expect(catalogDialog(page).locator('[data-testid="provider-catalog-search"]')).toBeFocused();
  return catalogDialog(page);
}

/** Closes the catalog modal with Esc; focus returns to "Connect provider". */
export async function closeCatalog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expectCatalogOpen(page, false);
  await expect(connectProviderButton(page)).toBeFocused();
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
