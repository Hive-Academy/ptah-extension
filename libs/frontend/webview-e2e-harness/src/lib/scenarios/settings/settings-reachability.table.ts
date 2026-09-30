/**
 * The Gate G reachability table (TASK_2026_555 Batch 16, Task 16.1 — D14,
 * plan Component 14, implementation-plan.md:797-820).
 *
 * One entry per `parity-inventory.md` "yes"/"partial" row (all tables,
 * except #85 — dead code), plus the 17 restored items (parity-inventory.md
 * "Missing capabilities", everything except #21, which the user approved
 * removing), frozen against the page as it renders TODAY (before any
 * TASK_2026_555 redesign batch lands). `reach` performs the real clicks a
 * user would make — tab, then trigger, then the resulting control — and
 * asserts that control is visible and enabled. It is never a bare DOM-
 * presence query on something the page may be hiding.
 *
 * `status: 'pending'` entries are NOT asserted by the spec (D14: they do not
 * exist yet). A later batch that builds the capability flips its entry to
 * `'restored'` in the SAME commit that mounts it (plan rule 4), and gives it
 * a real `reach`.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  AGENT_CONFIG_FIXTURE, baseSettingsFixtures, getFixtureState, gotoSettingsTab, installHost,
  installRpcAutoResponder, INVALID_PROBE_KEY, SETTINGS_TAB_LABELS,
} from './settings.fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';

export type CapabilityStatus = 'present' | 'restored' | 'pending';

export interface ReachabilityEntry {
  readonly id: string;
  readonly capability: string;
  readonly status: CapabilityStatus;
  /** Real user clicks proving the capability is reachable. No-op for `pending`. */
  readonly reach: (page: Page) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared helpers — every `reach` composes these rather than querying raw
// selectors, so a later batch that moves a control edits one helper instead
// of every entry that happens to use it.
// ---------------------------------------------------------------------------

const providersTab = (page: Page) => gotoSettingsTab(page, 'Providers');
const orchestrationTab = (page: Page) => gotoSettingsTab(page, 'Agent Orchestration');
const advancedTab = (page: Page) => gotoSettingsTab(page, 'Advanced');

/** A connection card by its visible provider name (today's flat card list). */
const card = (page: Page, name: string): Locator =>
  page.locator('[data-testid="provider-connection-card"]').filter({ hasText: name });

async function visibleEnabled(locator: Locator): Promise<void> {
  await expect(locator.first()).toBeVisible();
  await expect(locator.first()).toBeEnabled();
}

/** Clicks a visible+enabled trigger, asserts the opened control, then closes it. */
async function openThenClose(trigger: Locator, opened: Locator, closer: Locator): Promise<void> {
  await visibleEnabled(trigger);
  await trigger.click();
  await visibleEnabled(opened);
  await closer.click();
}

const wizardBody = (page: Page) => page.locator('[data-testid="wizard-body"]');

/**
 * Clicks Cancel, then discards the "Discard this setup?" review
 * (`wizard-discard-review`) if it appears — `requestWizardClose()`
 * (`provider-setup-wizard.component.ts:2321-2334`) always shows it once a
 * provider is selected (`hasUserDraft()` is true the moment `_selection()`
 * is non-null, before any field is even touched), so every deep-linked or
 * card-triggered wizard session this table opens hits it on close.
 */
async function closeWizard(page: Page): Promise<void> {
  // code-logic-review Blocking/Serious FM-4: this is called from a `finally`
  // inside `throughCard`/`throughCatalog`, so it must NEVER throw an
  // unhandled error — a crashed or already-unmounted wizard here would
  // otherwise cascade every remaining reachability entry into failure. Each
  // recovery step is its own best-effort attempt; the final assertion is the
  // only thing allowed to surface as a real failure.
  await page.locator('[data-testid="wizard-cancel"]').click({ timeout: 5000 }).catch(() => undefined);
  const discardConfirm = page.locator('[data-testid="wizard-discard-confirm"]');
  // A synchronous `.count()` right after the click races Angular's own
  // re-render: when a draft is present the click flips `_closeReview` and
  // wizard-body swaps to the discard-review CHILD content (still counted as
  // 1 wizard-body), so an immediate .count() can read 0 discard buttons
  // before that render lands, silently skip the discard click, and leave the
  // whole wizard stuck open for every entry after this one. `waitFor` gives
  // that render its own timeout instead of trusting an instant snapshot.
  try {
    await discardConfirm.waitFor({ state: 'visible', timeout: 2000 });
    await discardConfirm.click({ timeout: 5000 });
  } catch {
    // No draft to discard — the first Cancel already closed the wizard.
  }
  if (await wizardBody(page).count()) {
    // The normal close path did not work (crashed modal, missing button).
    // Escape is the drawer's own documented close path
    // (`requestWizardClose()` is wired to it too); if even that fails,
    // force a remount by leaving and re-entering the Providers tab — the
    // wizard lives inside `ProvidersSettingsComponent`, which is torn down
    // and rebuilt by the `@if` in `settings.component.html` on tab switch,
    // resetting `wizardOpen()` to `false` regardless of its stuck state.
    await page.keyboard.press('Escape').catch(() => undefined);
    if (await wizardBody(page).count()) {
      await page.getByRole('button', { name: 'Advanced', exact: true }).click().catch(() => undefined);
      await providersTab(page);
    }
  }
  await expect(wizardBody(page)).toHaveCount(0);
}

/**
 * Drives the wizard forward from wherever it is: clicks Continue while
 * enabled, and on the Verify step (where Continue starts disabled) clicks
 * "Verify connection" first (the credential-step "Verify stored key" button
 * pre-verifies too, both feed the SAME `auth:verifyDraftConnection` fixture
 * resolver). Stops once `targetTestId` is visible, once the Scope step
 * (`wizard-commit`, no Continue button) is reached, or after `maxSteps`
 * clicks — a real UI gap (a field this helper does not fill) surfaces as the
 * caller's own assertion failing on a step short of its target, not as an
 * infinite loop.
 */
async function advanceWizardTo(page: Page, targetTestId: string, maxSteps = 6): Promise<void> {
  const stepHeading = page.locator('[data-testid="wizard-step-heading"]');
  for (let i = 0; i < maxSteps; i += 1) {
    if (await page.locator(`[data-testid="${targetTestId}"]`).count()) return;
    if (await page.locator('[data-testid="wizard-commit"]').count()) return;
    const continueButton = page.locator('[data-testid="wizard-continue"]');
    if (!(await continueButton.count())) return;
    if (await continueButton.isDisabled()) {
      const verifyStart = page.locator('[data-testid="wizard-verify-start"]');
      if (await verifyStart.count()) {
        await verifyStart.click();
        await expect(
          page.locator('[data-testid="wizard-verify-success"], [data-testid="wizard-verify-failure"]'),
        ).toBeVisible({ timeout: 10000 });
        continue;
      }
      return;
    }
    // Read the step label BEFORE clicking, then wait for it to actually
    // change — `continueButton.isDisabled()` is an immediate snapshot with
    // no auto-retry, so checking it again on the next loop iteration right
    // after a click races Angular's zoneless change detection: the OLD
    // step's Continue button can still read "enabled" for a moment after
    // the click handler fired, before the new step has rendered its own
    // Continue/disabled state. Waiting for the visible step label to move
    // on removes that race instead of a fixed guess at how long it takes.
    const before = await stepHeading.innerText();
    await continueButton.click();
    await expect(stepHeading).not.toHaveText(before, { timeout: 5000 });
  }
}

/**
 * Some capabilities are gated behind data this suite's SHARED session
 * cannot show at the same time as everything else (an empty CLI list for
 * #77, alongside the populated one every other CLI/orchestration entry
 * needs). Rather than force that state through the shared fixture, this
 * opens a SECOND page in the same browser context with its own fixture
 * override, drives it, and closes it — the shared session `page` is
 * untouched by anything that happens inside `assertion`.
 */
async function throughVariantBoot(
  page: Page,
  overrides: Record<string, unknown>,
  tab: (typeof SETTINGS_TAB_LABELS)[number],
  assertion: (variantPage: Page) => Promise<void>,
): Promise<void> {
  const variantPage = await page.context().newPage();
  try {
    await installCspStub(variantPage);
    const bridge = await installPostMessageBridge(variantPage);
    await installHost(variantPage, 'vscode', 'chat');
    await installRpcAutoResponder(variantPage, { ...baseSettingsFixtures(), ...overrides });
    await variantPage.goto(page.url());
    // Same boot order as `bootSettings` in settings.fixtures.ts: the shell
    // must be up BEFORE `switchView`, and `settings-back` only exists AFTER
    // it — this used to check `settings-back` before injecting `switchView`
    // at all, which only "worked" by outliving its own 5s timeout on a
    // slow load, never because the check was correct.
    await expect(variantPage.locator('ptah-app-shell').first()).toBeVisible({ timeout: 15000 });
    await bridge.inject({ type: 'switchView', payload: { view: 'settings' } });
    await expect(variantPage.locator('[data-testid="settings-back"]')).toBeVisible({ timeout: 15000 });
    await variantPage.getByRole('button', { name: tab, exact: true }).click();
    await assertion(variantPage);
  } finally {
    await variantPage.close();
  }
}

/**
 * The deep link (`deepLinkProviderId`) preselects a provider on open but
 * deliberately does not advance the step
 * (`provider-setup-wizard.component.ts:1895-1909`, "preselect on open,
 * without displaying the step") — so every card/catalog trigger below lands
 * on `wizard-step-provider` with the radio pre-checked, one `Continue` away
 * from the credential step. `advancePastProviderStep` is skipped only by
 * entries that assert something ON the provider step itself.
 */
async function advancePastProviderStep(page: Page): Promise<void> {
  if (await page.locator('[data-testid="wizard-step-provider"]').count()) {
    await page.locator('[data-testid="wizard-continue"]').click();
  }
}

/**
 * Opens the "More providers" `<details>` disclosure if it is not already
 * open. A plain `.click()` on the summary TOGGLES it, so a later entry in
 * the same sequential run would collapse it right back closed if a previous
 * entry left it open — this checks the real `open` state first.
 */
async function openCatalogDisclosure(page: Page): Promise<void> {
  const disclosure = page.locator('summary[data-focus="more-providers"]');
  await visibleEnabled(disclosure);
  const isOpen = await disclosure.evaluate(
    (el) => (el.closest('details') as HTMLDetailsElement | null)?.open ?? false,
  );
  if (!isOpen) await disclosure.click();
}

/** Opens the setup wizard for `providerName` from the "More providers" catalog and closes it after `assertion`. */
async function throughCatalog(
  page: Page,
  providerName: string,
  assertion: (page: Page) => Promise<void>,
  advance = true,
): Promise<void> {
  await providersTab(page);
  await openCatalogDisclosure(page);
  const setupButton = page
    .locator('.p-3.space-y-2')
    .filter({ hasText: providerName })
    .getByRole('button', { name: new RegExp('Set up ' + providerName) });
  await visibleEnabled(setupButton);
  await setupButton.click();
  await visibleEnabled(wizardBody(page));
  try {
    if (advance) await advancePastProviderStep(page);
    await assertion(page);
  } finally {
    await closeWizard(page);
  }
}

/**
 * Opens the wizard with NO deep link (`openWizard('')`, the "Custom
 * endpoint" catalog footer button) so it lands on the provider step with
 * nothing preselected, selects the "Custom endpoint" radio, then closes.
 */
async function throughBlankWizardCustomOption(
  page: Page,
  assertion: (page: Page) => Promise<void>,
): Promise<void> {
  await providersTab(page);
  await openCatalogDisclosure(page);
  const customEntry = page.getByRole('button', { name: 'Custom endpoint · choose Custom in setup' });
  await visibleEnabled(customEntry);
  await customEntry.click();
  await visibleEnabled(wizardBody(page));
  try {
    const radio = page.locator('[data-testid="wizard-provider-custom-radio"]');
    await visibleEnabled(radio);
    await radio.check();
    await assertion(page);
  } finally {
    await closeWizard(page);
  }
}

/**
 * Since Batch 20 the card's Manage opens the connection detail drawer. Asserts it is THIS
 * connection's drawer, then takes the Models & Tiers tab's one primary action, "Edit in setup", which
 * keeps the setup wizard path Manage used to open directly (D14) until Batch 22 builds that tab body.
 * (Since Batch 21 the Credentials tab of an API-key, sign-in or CLI connection holds its own actions
 * and no longer offers setup; Models & Tiers still does for every kind.)
 */
async function setupThroughDrawer(page: Page, providerName: string): Promise<void> {
  await expect(page.locator('[data-testid="connection-detail-drawer"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-drawer-title"]')).toContainText(providerName);
  await page.getByRole('tab', { name: 'Models & Tiers', exact: true }).click();
  const setup = page.locator('[data-testid="connection-edit-in-setup"]');
  await visibleEnabled(setup);
  await setup.click();
  await expect(page.locator('[data-testid="connection-detail-drawer"]')).toHaveCount(0);
}

/** Manage on a configured card, then the drawer's Credentials tab (Batch 21). */
async function credentialsOf(page: Page, providerName: string): Promise<Locator> {
  await providersTab(page);
  const trigger = card(page, providerName).locator('[data-testid="btn-manage"]');
  await visibleEnabled(trigger);
  await trigger.click();
  await expect(page.locator('[data-testid="connection-drawer-title"]')).toContainText(providerName);
  await page.getByRole('tab', { name: 'Credentials', exact: true }).click();
  const tab = page.locator('[data-testid="connection-credentials"]');
  await expect(tab).toBeVisible();
  return tab;
}

/** Closes the connection drawer through its footer Close. Best-effort: used from `finally`. */
async function closeConnectionDrawer(page: Page): Promise<void> {
  await page.locator('[data-testid="connection-drawer-close"]').click({ timeout: 5000 }).catch(() => undefined);
  await expect(page.locator('[data-testid="connection-detail-drawer"]')).toHaveCount(0);
}

/**
 * Re-reads the Providers page: leaving the tab tears `ProvidersSettingsComponent` down and coming back
 * runs `state.open()` again, so a fixture auth change (a stored Claude API key, a Copilot sign-in) shows.
 */
async function remountProviders(page: Page): Promise<void> {
  await advancedTab(page);
  await providersTab(page);
}

/**
 * Runs `body` with an auth fixture change that makes an extra card appear, then restores the fixture
 * and re-reads, so later entries see the BRIEF baseline.
 */
async function withAuthStatus(page: Page, change: Partial<ReturnType<typeof getFixtureState>['authStatus']>,
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
async function confirmWrite(page: Page, trigger: string, confirm: string, method: string, params: unknown): Promise<void> {
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

/** Opens the setup wizard from an already-configured card's action button, then closes it. */
async function throughCard(
  page: Page,
  providerName: string,
  buttonTestId: string,
  assertion: (page: Page) => Promise<void>,
  advance = true,
): Promise<void> {
  await providersTab(page);
  const trigger = card(page, providerName).locator(`[data-testid="${buttonTestId}"]`);
  await visibleEnabled(trigger);
  await trigger.click();
  if (buttonTestId === 'btn-manage') await setupThroughDrawer(page, providerName);
  await visibleEnabled(wizardBody(page));
  try {
    if (advance) await advancePastProviderStep(page);
    await assertion(page);
  } finally {
    await closeWizard(page);
  }
}

/**
 * The Ptah CLI instance manager. Batch 18 (D14) moved it, unchanged, from Providers to the interim
 * Orchestration container, together with its read states and the commit feedback (#56).
 */
async function cliConfigSection(page: Page): Promise<Locator> {
  await orchestrationTab(page);
  const heading = page.locator('#providers-cli-heading');
  await visibleEnabled(heading);
  return heading;
}

async function throughDelegatedEdit(page: Page, choiceLabel: string): Promise<void> {
  await cliConfigSection(page);
  const editButton = page.getByRole('button', { name: `Edit ${choiceLabel}` });
  await visibleEnabled(editButton);
  await editButton.click();
  const cancelButton = page.getByRole('button', { name: `Cancel ${choiceLabel} edit` });
  await visibleEnabled(cancelButton);
  await cancelButton.click();
}

// ---------------------------------------------------------------------------
// Table 1: Providers / auth (parity-inventory.md #1-31)
// ---------------------------------------------------------------------------

const providersAuth: readonly ReachabilityEntry[] = [
  {
    id: '#1', capability: 'All providers visible (configured cards + More providers catalog)', status: 'present',
    reach: async (page) => {
      await providersTab(page);
      const disclosure = page.locator('summary[data-focus="more-providers"]');
      await openThenClose(disclosure, page.locator('#providers-catalog-search'), disclosure);
    },
  },
  {
    id: '#2', capability: 'Per-provider configured/active marker', status: 'present',
    reach: async (page) => { await providersTab(page); await visibleEnabled(card(page, 'Claude (Subscription)').locator('[data-testid="status-badge"]')); },
  },
  {
    id: '#3', capability: 'Switch main provider', status: 'present',
    reach: async (page) => {
      await providersTab(page);
      const activate = card(page, 'Moonshot').locator('[data-testid="btn-activate-main"]');
      await openThenClose(activate, page.getByRole('button', { name: 'Use for main agent' }), page.getByRole('button', { name: 'Cancel provider change' }));
    },
  },
  {
    id: '#4', capability: 'Claude API key vs Claude CLI (subscription) as separate connections', status: 'present',
    reach: async (page) => { await providersTab(page); await visibleEnabled(card(page, 'Claude (Subscription)')); },
  },
  {
    id: '#5', capability: 'Enter and save an API key (wizard credential step)', status: 'present',
    reach: (page) => throughCatalog(page, 'OpenRouter', async (p) => visibleEnabled(p.locator('[data-testid="wizard-api-key"]'))),
  },
  {
    id: '#6', capability: 'Masked stored key with Replace', status: 'present',
    reach: (page) => throughCard(page, 'Moonshot', 'btn-manage', async (p) => visibleEnabled(p.locator('[data-testid="wizard-key-stored"], [data-testid="wizard-replace-key"]'))),
  },
  {
    id: '#9', capability: 'Key help (prefix hint)', status: 'present',
    reach: (page) => throughCatalog(page, 'OpenRouter', async (p) => {
      // The hint only renders once a non-matching key is typed
      // (`provider-setup-wizard.component.ts:1617-1625`).
      await p.locator('[data-testid="wizard-api-key"]').fill('wrong-prefix-key');
      await visibleEnabled(p.locator('[data-testid="wizard-key-prefix-hint"]'));
    }),
  },
  {
    id: '#10', capability: 'Claude CLI detected / install and login state', status: 'present',
    reach: (page) => throughCard(page, 'Claude (Subscription)', 'btn-manage', async (p) => visibleEnabled(p.locator('[data-testid="wizard-cli-signed-in"], [data-testid="wizard-cli-signed-out"], [data-testid="wizard-cli-not-installed"]'))),
  },
  {
    id: '#11', capability: 'GitHub Copilot sign-in (OAuth)', status: 'present',
    reach: (page) => throughCatalog(page, 'GitHub Copilot', async (p) => visibleEnabled(p.locator('[data-testid="wizard-sign-in"], [data-testid="wizard-sign-in-waiting"]'))),
  },
  {
    id: '#13', capability: 'Codex auth-file status / Open login', status: 'present',
    // The oauth branch's real controls (`provider-setup-wizard.component.ts:717-753`),
    // not the generic step heading every step shares.
    reach: (page) => throughCard(page, 'OpenAI Codex', 'btn-manage', async (p) => visibleEnabled(p.locator('[data-testid="wizard-sign-in"], [data-testid="wizard-sign-in-waiting"], [data-testid="wizard-sign-in-ok"]'))),
  },
  {
    id: '#14', capability: 'Local provider (no key needed) with editable endpoint', status: 'present',
    reach: (page) => throughCatalog(page, 'Ollama', async (p) => visibleEnabled(p.locator('[data-testid="wizard-base-url"]'))),
  },
  {
    id: '#15', capability: 'Ollama Cloud optional key', status: 'present',
    // BRIEF status is "Check failed (Retry)" -> the card's 'unreachable' case
    // (`provider-connection-card.component.ts:290-309`), which offers Retry
    // and Edit connection, not Manage. `ollama-cloud`'s registry entry has
    // `isLocal: false` (`local-provider-entry.ts:122`, cloud inference), so
    // `deriveAuthMode` (`provider-setup-wizard.component.ts:251-256`) resolves
    // it to the plain `apiKey` branch, not `local-native`/`local-proxy` —
    // stored-key controls are what is actually reachable today.
    reach: (page) => throughCard(page, 'Ollama Cloud', 'btn-edit-connection', async (p) => visibleEnabled(p.locator('[data-testid="wizard-key-stored"], [data-testid="wizard-api-key"]'))),
  },
  {
    id: '#16', capability: 'Apply to: Global / App / Workspace save target', status: 'present',
    reach: async (page) => {
      await providersTab(page);
      const scopeRows = page.locator('[data-testid="setting-scope-row"]');
      await visibleEnabled(scopeRows);
    },
  },
  {
    id: '#17', capability: 'Scope badge (Workspace/App override, Inherited)', status: 'present',
    reach: async (page) => { await providersTab(page); await visibleEnabled(page.locator('[data-testid="scope-source-badge"]')); },
  },
  {
    id: '#18', capability: 'Clear the workspace override', status: 'present',
    reach: async (page) => {
      await providersTab(page);
      const clear = page.locator('[data-testid="scope-clear-override"]').first();
      await openThenClose(clear, page.getByRole('button', { name: 'Confirm clear override' }), page.getByRole('button', { name: 'Cancel clear' }));
    },
  },
  {
    id: '#19', capability: 'Save & Test with verify states', status: 'present',
    // Actually reaches and runs Verify — no comma-fallback to the credential
    // step's key input, which is a different step entirely.
    reach: (page) => throughCatalog(page, 'OpenRouter', async (p) => {
      await p.locator('[data-testid="wizard-api-key"]').fill('sk-or-e2e-test-key');
      await advanceWizardTo(p, 'wizard-step-verify');
      const verifyStart = p.locator('[data-testid="wizard-verify-start"]');
      await visibleEnabled(verifyStart);
      await verifyStart.click();
      await visibleEnabled(p.locator('[data-testid="wizard-verify-success"]'));
    }),
  },
  {
    id: '#20', capability: '401/invalid-key diagnostics copy', status: 'present',
    // Drives a REAL failed probe (`INVALID_PROBE_KEY`,
    // `verifyDraftConnectionResolver` in settings.fixtures.ts) and asserts
    // the failure copy that only renders on `outcome === 'failed'` — no
    // fallback to the credential step's key input.
    reach: (page) => throughCatalog(page, 'OpenRouter', async (p) => {
      await p.locator('[data-testid="wizard-api-key"]').fill(INVALID_PROBE_KEY);
      await advanceWizardTo(p, 'wizard-step-verify');
      await p.locator('[data-testid="wizard-verify-start"]').click();
      await visibleEnabled(p.locator('[data-testid="wizard-failure-copy"]'));
    }),
  },
  {
    id: '#22', capability: 'Security copy (local vs custom endpoint)', status: 'present',
    reach: async (page) => {
      await providersTab(page);
      await visibleEnabled(page.locator('[data-testid="builtin-provider-security-copy"], [data-testid="custom-provider-security-copy"]'));
    },
  },
  {
    id: '#23', capability: 'Add custom provider (name, base URL, lane, key)', status: 'present',
    reach: (page) => throughBlankWizardCustomOption(page, async (p) => visibleEnabled(p.locator('[data-testid="wizard-custom-name"]'))),
  },
  {
    id: '#24', capability: 'Edit custom provider', status: 'present',
    reach: (page) => throughCard(page, 'sovereigneg', 'btn-manage', async (p) => visibleEnabled(p.locator('[data-testid="wizard-custom-name"], [data-testid="wizard-base-url"]'))),
  },
  {
    id: '#26', capability: 'Test custom provider (verify)', status: 'present',
    // `sovereigneg`'s deep link lands on the provider step with its custom
    // editor already expanded (`isCustomSelected()`), the same reachable
    // surface #24 pins, one Continue away from Credential and one more from
    // Verify. Actually runs the probe and asserts success — not a
    // step-1-Continue-is-visible check.
    reach: (page) => throughCard(page, 'sovereigneg', 'btn-manage', async (p) => {
      await advanceWizardTo(p, 'wizard-step-verify');
      await p.locator('[data-testid="wizard-verify-start"]').click();
      await visibleEnabled(p.locator('[data-testid="wizard-verify-success"]'));
    }, false),
  },
  {
    id: '#29', capability: 'Custom provider tier model mapping (Models step)', status: 'present',
    // Actually reaches the Models step (through Credential + a real Verify
    // probe) and asserts a tier picker, not a step-1 Continue button.
    reach: (page) => throughCard(page, 'sovereigneg', 'btn-manage', async (p) => {
      await advanceWizardTo(p, 'wizard-step-models');
      await visibleEnabled(p.locator('[data-testid="wizard-step-models"]'));
      await visibleEnabled(p.locator('[data-testid^="wizard-tier-"] ptah-provider-model-picker').first());
    }, false),
  },
  {
    id: '#31', capability: 'Custom provider validation / host security note', status: 'present',
    reach: (page) => throughBlankWizardCustomOption(page, async (p) => visibleEnabled(p.locator('[data-testid="wizard-protocol-openai"], [data-testid="wizard-protocol-anthropic"]'))),
  },
];

// ---------------------------------------------------------------------------
// Table 2: Main-agent model and tiers (#32-39)
// ---------------------------------------------------------------------------

const mainAgentModel: readonly ReachabilityEntry[] = [
  {
    id: '#32', capability: 'Model-mapping editor (inside Manage -> wizard Models step)', status: 'present',
    // Actually reaches the Models step (Credential + a real Verify probe),
    // not a step-1 Continue button every step shares.
    reach: (page) => throughCard(page, 'Moonshot', 'btn-manage', async (p) => {
      await advanceWizardTo(p, 'wizard-step-models');
      await visibleEnabled(p.locator('[data-testid="wizard-step-models"]'));
      await visibleEnabled(p.locator('[data-testid^="wizard-tier-"] ptah-provider-model-picker').first());
    }, false),
  },
  {
    id: '#33', capability: 'Per-tier change saved via wizard commit', status: 'present',
    // Reaches Models, types a manual model id into the "everyday" tier's
    // picker and applies it, then asserts `tierSource()`
    // (`provider-setup-wizard.component.ts:1843-1846`) actually flips from
    // "Provider default" to "Set in this wizard" — a real per-tier change,
    // not a step-1 Continue button.
    reach: (page) => throughCard(page, 'Moonshot', 'btn-manage', async (p) => {
      await advanceWizardTo(p, 'wizard-step-models');
      const tier = p.locator('[data-testid="wizard-tier-everyday"]');
      await visibleEnabled(tier);
      await tier.getByText('Not listed? Enter a model ID').click();
      const manualInput = tier.locator('[data-testid="provider-model-picker-manual-input"]');
      await visibleEnabled(manualInput);
      await manualInput.fill('moonshot/kimi-k2.7-code');
      await tier.locator('[data-testid="provider-model-picker-manual-apply"]').click();
      await expect(tier.locator('[data-testid="wizard-tier-source"]')).toContainText('Set in this wizard');
    }, false),
  },
  {
    id: '#35', capability: 'Custom model ID per tier ("Not listed? Enter a model ID")', status: 'present',
    reach: async (page) => {
      await providersTab(page);
      const editModel = page.getByRole('button', { name: 'Edit model' });
      await openThenClose(editModel, page.locator('ptah-provider-model-picker'), page.getByRole('button', { name: 'Cancel model edit' }));
    },
  },
  {
    id: '#36', capability: 'Clear a tier to provider default (wizard)', status: 'present',
    // Reaches Models and uses "Use provider defaults"
    // (`wizard-use-defaults`, only rendered when `defaultsResolvable()` —
    // Moonshot has registry default tiers), then asserts every tier reads
    // "Provider default" again — the real clear action, not a step-1
    // Continue button.
    reach: (page) => throughCard(page, 'Moonshot', 'btn-manage', async (p) => {
      await advanceWizardTo(p, 'wizard-step-models');
      const useDefaults = p.locator('[data-testid="wizard-use-defaults"]');
      await visibleEnabled(useDefaults);
      await useDefaults.click();
      await expect(p.locator('[data-testid="wizard-tier-source"]').first()).toContainText('Provider default');
    }, false),
  },
  {
    id: '#37', capability: 'Current mapping / resolved model shown', status: 'present',
    // The real resolved-model text on the main-agent card
    // (`providers-settings.component.ts:80-84`), not the section heading.
    reach: async (page) => {
      await providersTab(page);
      await visibleEnabled(page.getByText('Default model (chosen by Claude)'));
    },
  },
  {
    id: '#39', capability: 'Refresh the model list (Retry on error)', status: 'present',
    // The harness's RPC auto-responder always answers `success: true`
    // (`marketplace.fixtures.ts` — `respond()` hardcodes it), so an
    // `isSuccess() === false` branch (`providers-models-loader.service.ts:12-13`)
    // cannot be forced through this fixture layer; that gap is recorded
    // here rather than papered over with a heading check. What IS reachable
    // today: each Ptah CLI instance's OWN model picker
    // (`ptah-cli-config.component.ts:70-72`), a distinct catalogue fetch
    // from the main-agent one #35 already pins.
    reach: async (page) => {
      await cliConfigSection(page);
      const editButton = page.getByRole('button', { name: 'Edit Glm model' });
      await openThenClose(editButton, page.locator('ptah-provider-model-picker'), page.getByRole('button', { name: 'Cancel Glm model edit' }));
    },
  },
];

// ---------------------------------------------------------------------------
// Table 3: CLI agents (#42-71, present/partial only)
// ---------------------------------------------------------------------------

const cliAgents: readonly ReachabilityEntry[] = [
  { id: '#42', capability: 'List Ptah CLI agents with name and provider badge', status: 'present',
    reach: async (page) => { await cliConfigSection(page); await visibleEnabled(page.getByText('Glm · Ollama Cloud')); } },
  { id: '#45', capability: 'Model count', status: 'present',
    reach: async (page) => { await cliConfigSection(page); await visibleEnabled(page.getByText(/available models/)); } },
  { id: '#46', capability: 'Add agent: name, provider, key', status: 'present',
    reach: async (page) => {
      await cliConfigSection(page);
      const add = page.getByRole('button', { name: 'Add CLI agent' });
      await openThenClose(add, page.locator('#providers-cli-name'), page.getByRole('button', { name: 'Cancel CLI setup' }));
    } },
  { id: '#48', capability: 'Keyless / optional-key hints', status: 'present',
    reach: async (page) => {
      await cliConfigSection(page);
      const add = page.getByRole('button', { name: 'Add CLI agent' });
      await openThenClose(add, page.locator('#providers-cli-key-help'), page.getByRole('button', { name: 'Cancel CLI setup' }));
    } },
  { id: '#50', capability: 'Edit name / replace key inline', status: 'present',
    reach: async (page) => {
      await cliConfigSection(page);
      const edit = page.getByRole('button', { name: 'Edit name or key' });
      await openThenClose(edit, page.getByLabel('Agent name'), page.getByRole('button', { name: 'Cancel instance edit' }));
    } },
  { id: '#51', capability: 'Enable/disable agent toggle', status: 'present',
    reach: async (page) => { await cliConfigSection(page); await visibleEnabled(page.getByLabel('Enable Glm for delegated work')); } },
  { id: '#52', capability: 'Test connection', status: 'present',
    reach: async (page) => { await cliConfigSection(page); await visibleEnabled(page.getByRole('button', { name: 'Test connection' })); } },
  { id: '#55', capability: 'Delete with confirmation', status: 'present',
    reach: async (page) => {
      await cliConfigSection(page);
      const remove = page.getByRole('button', { name: 'Remove Glm' });
      await openThenClose(remove, page.getByRole('button', { name: 'Confirm removal of Glm' }), page.getByRole('button', { name: 'Cancel removal' }));
    } },
  { id: '#56', capability: 'Success/error commit feedback', status: 'present',
    // Toggles Glm's enable checkbox (a real `ptahCli:update` write), asserts
    // the commit-feedback panel shows "Saved", the write RPC was recorded,
    // and the read-back (`state.ptahCliAgents`) reflects it — then restores
    // the toggle so later entries see the BRIEF baseline (Glm enabled).
    reach: async (page) => {
      await cliConfigSection(page);
      const state = getFixtureState(page);
      const before = state.calls.length;
      const toggle = page.getByLabel('Enable Glm for delegated work');
      await visibleEnabled(toggle);
      await toggle.click();
      const feedback = page.locator('[data-testid="providers-commit-feedback"]');
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText('Saved');
      const written = state.calls.slice(before);
      expect(written.some((c) => c.method === 'ptahCli:update')).toBe(true);
      expect(state.ptahCliAgents.find((a) => a.id === 'glm-instance-1')?.enabled).toBe(false);
      await toggle.click();
      await expect(feedback).toContainText('Saved');
      expect(state.ptahCliAgents.find((a) => a.id === 'glm-instance-1')?.enabled).toBe(true);
    } },
  { id: '#57', capability: 'Empty state with Add link', status: 'present',
    reach: async (page) => { await cliConfigSection(page); await visibleEnabled(page.getByRole('button', { name: 'Add CLI agent' })); } },
  { id: '#58', capability: 'Deep link opens setup for a preselected provider', status: 'present',
    reach: (page) => throughCatalog(page, 'OpenRouter', async (p) => visibleEnabled(p.locator('[data-testid="wizard-title"]'))) },
  { id: '#59', capability: 'Codex model (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Codex model') },
  { id: '#60', capability: 'Codex reasoning effort (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Codex reasoning effort') },
  { id: '#61', capability: 'Copilot model (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Copilot model') },
  { id: '#62', capability: 'Copilot reasoning effort (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Copilot reasoning effort') },
  { id: '#63', capability: 'Copilot auto-approve toggle', status: 'present',
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.locator('[data-testid="copilot-auto-approve"]')); } },
  { id: '#64', capability: 'Cursor API key input + Save', status: 'present',
    reach: async (page) => { await cliConfigSection(page); await visibleEnabled(page.locator('#providers-cursor-key')); } },
  { id: '#65', capability: 'Cursor model (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Cursor model') },
  { id: '#66', capability: 'Antigravity model (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Antigravity model') },
  { id: '#67', capability: 'opencode model (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'OpenCode model') },
  { id: '#68', capability: 'Pi model (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Pi model') },
  { id: '#69', capability: 'Pi reasoning effort (delegated)', status: 'present', reach: (page) => throughDelegatedEdit(page, 'Pi reasoning effort') },
];

// ---------------------------------------------------------------------------
// Table 4: Agent orchestration policy (#72-79)
// ---------------------------------------------------------------------------

const orchestrationPolicy: readonly ReachabilityEntry[] = [
  { id: '#72', capability: 'Re-detect CLIs', status: 'present',
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.getByRole('button', { name: 'Re-detect CLI agents' })); } },
  { id: '#73', capability: 'Preferred agent order (up/down)', status: 'present',
    // The first row's "Move up" is always disabled by design
    // (`agent-orchestration-config.component.ts:138`); "Move down" on the
    // first of 4 BRIEF-ordered agents is the real enabled control.
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.getByRole('button', { name: 'Move down' }).first()); } },
  { id: '#74', capability: 'Max concurrent agents slider', status: 'present',
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.locator('#agent-max-concurrent')); } },
  { id: '#75', capability: 'System CLI rows with detection badges', status: 'present',
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.getByText(/Installed/).first()); } },
  { id: '#76', capability: 'Enable/disable toggle per system CLI', status: 'present',
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.getByLabel('Toggle codex agent')); } },
  { id: '#77', capability: '"No CLI agents found" install help', status: 'present',
    // `!hasInstalledCli()` is the branch that renders this
    // (`agent-orchestration-config.component.ts:302-321`) — the shared
    // session's fixture has installed CLIs (BRIEF data), so a SECOND page
    // with none installed is booted to actually reach the empty state,
    // rather than asserting the "System CLIs" heading that renders either way.
    reach: (page) => throughVariantBoot(
      page,
      { 'agent:getConfig': { ...AGENT_CONFIG_FIXTURE, detectedClis: [] } },
      'Agent Orchestration',
      async (variantPage) => {
        await visibleEnabled(variantPage.getByText('No CLI agents found. Install one to enable agent'));
      },
    ) },
  { id: '#78', capability: 'Ptah CLI agents managed inside Orchestration (moved to Providers)', status: 'present',
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.getByRole('button', { name: 'Manage provider, model and credentials in Providers' }).first()); } },
  { id: '#79', capability: 'Loading and error states', status: 'present',
    // `agentConfigError()` only sets from a THROWN `agent:getConfig` call or
    // `result.isSuccess() === false` (`agent-orchestration-config.component.ts:396-411`);
    // this harness's RPC auto-responder always answers `success: true`
    // (`marketplace.fixtures.ts`'s `respond()`), so that branch cannot be
    // forced through the fixture layer — recorded here rather than asserted
    // around. What IS real and checked: the loaded state renders with no
    // error banner present, proving the loaded/error switch resolves to the
    // correct branch for the data this fixture provides.
    reach: async (page) => {
      await orchestrationTab(page);
      await visibleEnabled(page.getByText(/Headless agents \(Codex CLI, Copilot, Cursor, Antigravity, opencode,/));
      await expect(page.locator('ptah-agent-orchestration-config .text-error')).toHaveCount(0);
    } },
];

// ---------------------------------------------------------------------------
// Table 5: Other (#80-84, excluding dead #85 and new #86/#87)
// ---------------------------------------------------------------------------

const other: readonly ReachabilityEntry[] = [
  { id: '#80', capability: 'License status card', status: 'present',
    reach: async (page) => { await advancedTab(page); await visibleEnabled(page.locator('ptah-license-status-card')); } },
  { id: '#81', capability: 'Export / Import settings', status: 'present',
    reach: async (page) => { await advancedTab(page); await visibleEnabled(page.getByRole('button', { name: 'Export settings' })); } },
  { id: '#82', capability: 'Back to chat', status: 'present',
    reach: async (page) => { await visibleEnabled(page.locator('[data-testid="settings-back"]')); } },
  { id: '#83', capability: 'Deep link to a Settings tab (also while open)', status: 'present',
    // The real deep-link trigger: `manageProviders()`
    // (`agent-orchestration-config.component.ts:415-418`) calls
    // `requestSettingsTab({tab:'providers', section:'cli-agents'})` while
    // Settings is ALREADY open. Since Batch 18 the `cli-agents` section routes
    // to the tab that hosts the CLI agents (Orchestration, plan Component 10),
    // so the request is applied in place: the routed tab stays active and the
    // CLI-agents heading receives focus (proof the request was consumed and
    // routed, not just that the heading happens to be on the page).
    reach: async (page) => {
      await orchestrationTab(page);
      await page.getByRole('button', { name: 'Manage provider, model and credentials in Providers' }).first().click();
      await expect(page.getByRole('button', { name: 'Agent Orchestration', exact: true })).toHaveClass(/tab-active/);
      await visibleEnabled(page.locator('#providers-cli-heading'));
      await expect(page.locator('#providers-cli-heading')).toBeFocused();
    } },
  { id: '#84', capability: 'VS Code LM model change triggers a CLI re-detect', status: 'present',
    reach: async (page) => { await advancedTab(page); await visibleEnabled(page.locator('ptah-vscode-lm-config')); } },
];

// ---------------------------------------------------------------------------
// The 17 restored items (parity-inventory.md "Missing capabilities", minus
// #21). `reach` is a placeholder until the batch that builds each one
// replaces it — plan D14 rule 3 forbids a present entry regressing to
// pending, so these start below that line and are never asserted until they
// flip.
// ---------------------------------------------------------------------------

const notYetBuilt = async (): Promise<void> => {
  throw new Error('Not built yet — flip this entry to \'restored\' in the batch that builds it.');
};

const restoredPending: readonly ReachabilityEntry[] = [
  { id: '#7', capability: 'Delete the stored Anthropic API key', status: 'restored',
    // Batch 21: drawer Credentials -> Delete key -> inline confirm -> auth:deleteStoredKey (D4).
    reach: (page) => withAuthStatus(page, { hasApiKey: true }, async () => {
      await credentialsOf(page, 'Claude API');
      await confirmWrite(page, 'credentials-delete', 'credentials-delete-confirm-button', 'auth:deleteStoredKey', { providerId: 'anthropic' });
    }) },
  { id: '#8', capability: 'Delete a stored third-party provider key', status: 'restored',
    reach: async (page) => {
      try {
        await credentialsOf(page, 'Moonshot');
        await confirmWrite(page, 'credentials-delete', 'credentials-delete-confirm-button', 'auth:deleteStoredKey', { providerId: 'moonshot' });
      } finally {
        await closeConnectionDrawer(page);
      }
    } },
  { id: '#12', capability: 'GitHub Copilot sign out / disconnect', status: 'restored',
    // Batch 21: drawer Credentials -> Sign out -> inline confirm -> auth:copilotLogout.
    reach: (page) => withAuthStatus(page, { copilotAuthenticated: true }, async () => {
      await credentialsOf(page, 'GitHub Copilot');
      await confirmWrite(page, 'credentials-sign-out', 'credentials-sign-out-confirm-button', 'auth:copilotLogout', {});
    }) },
  { id: '#25', capability: 'Delete a custom provider', status: 'pending', reach: notYetBuilt },
  { id: '#27', capability: 'Custom provider models endpoint', status: 'pending', reach: notYetBuilt },
  { id: '#28', capability: 'Custom provider help URL', status: 'pending', reach: notYetBuilt },
  { id: '#30', capability: 'Custom provider pricing (input/output per 1M)', status: 'pending', reach: notYetBuilt },
  { id: '#34', capability: 'Searchable model autocomplete for tier mapping', status: 'pending', reach: notYetBuilt },
  { id: '#38', capability: 'Tool-use compatibility indicators', status: 'pending', reach: notYetBuilt },
  { id: '#43', capability: 'Ptah CLI agent status (Ready/Error/Init/No Key)', status: 'pending', reach: notYetBuilt },
  { id: '#44', capability: 'Ptah CLI agent key status (Key set/No key/Cloud signin)', status: 'pending', reach: notYetBuilt },
  { id: '#47', capability: 'Inline GitHub login when adding a Copilot-backed CLI agent', status: 'pending', reach: notYetBuilt },
  { id: '#49', capability: 'Show/hide API key in CLI agent add/edit forms', status: 'restored',
    // Batch 21 restores the drawer Credentials half (the Replace key field). The CLI agent add/edit
    // forms get theirs with the add-instance modal (plan :753); that batch extends this reach.
    reach: async (page) => {
      try {
        await credentialsOf(page, 'Moonshot');
        await page.locator('[data-testid="credentials-replace"]').click();
        const key = page.locator('[data-testid="credentials-new-key"]');
        await expect(key).toHaveAttribute('type', 'password');
        await page.locator('[data-testid="credentials-toggle-visibility"]').click();
        await expect(key).toHaveAttribute('type', 'text');
      } finally {
        await closeConnectionDrawer(page);
      }
    } },
  { id: '#53', capability: 'CLI-agent tier mapping (cliAgent scope)', status: 'pending', reach: notYetBuilt },
  { id: '#54', capability: 'Tier-mapping badges on CLI agent cards', status: 'pending', reach: notYetBuilt },
  { id: '#70', capability: 'Per-CLI permission and safety notes', status: 'pending', reach: notYetBuilt },
  { id: '#71', capability: 'Per-CLI grouping of delegated settings, hidden when not installed', status: 'pending', reach: notYetBuilt },
];

// ---------------------------------------------------------------------------
// Regressed UX (parity-inventory.md "Regressed UX"), added when the batch that fixes each one lands.
// ---------------------------------------------------------------------------

const regressedUx: readonly ReachabilityEntry[] = [
  { id: 'RUX-1', capability: 'Replace a stored key without the 5-step wizard (verify, then save)', status: 'restored',
    // Batch 21: a failed check keeps Save disabled; a passing one enables it. Nothing is saved here.
    reach: async (page) => {
      try {
        await credentialsOf(page, 'Moonshot');
        await page.locator('[data-testid="credentials-replace"]').click();
        const key = page.locator('[data-testid="credentials-new-key"]');
        const save = page.locator('[data-testid="credentials-save"]');
        await key.fill(INVALID_PROBE_KEY);
        await page.locator('[data-testid="credentials-verify"]').click();
        await expect(page.locator('[data-testid="credentials-probe"]')).toContainText('Nothing was saved');
        await expect(save).toBeDisabled();
        await key.fill('sk-e2e-replacement');
        await page.locator('[data-testid="credentials-verify"]').click();
        await expect(page.locator('[data-testid="credentials-probe"]')).toContainText('Key verified');
        await expect(save).toBeEnabled();
      } finally {
        await closeConnectionDrawer(page);
      }
    } },
  { id: 'RUX-4', capability: 'The Claude API key is manageable from its own card', status: 'restored',
    reach: (page) => withAuthStatus(page, { hasApiKey: true }, async () => {
      const tab = await credentialsOf(page, 'Claude API');
      await expect(tab.locator('[data-testid="credentials-key-mask"]')).toBeVisible();
      await visibleEnabled(tab.locator('[data-testid="credentials-delete"]'));
    }) },
  { id: 'RUX-10', capability: 'Setup help text (claude login / install, Codex login, Get a key)', status: 'restored',
    reach: async (page) => {
      try {
        const cli = await credentialsOf(page, 'Claude (Subscription)');
        await expect(cli.locator('[data-testid="credentials-cli"]')).toContainText('npm install -g @anthropic-ai/claude-code');
        await visibleEnabled(cli.locator('[data-testid="credentials-copy-login"]'));
        await closeConnectionDrawer(page);
        const codex = await credentialsOf(page, 'OpenAI Codex');
        await expect(codex.locator('[data-testid="credentials-codex-copy"]')).toContainText('~/.codex/auth.json');
        await visibleEnabled(codex.locator('[data-testid="credentials-open-login"]'));
        await closeConnectionDrawer(page);
        const key = await credentialsOf(page, 'Moonshot');
        await expect(key.locator('[data-testid="credentials-get-key"]')).toHaveAttribute('href', /^https:\/\//);
      } finally {
        await closeConnectionDrawer(page);
      }
    } },
];

// ---------------------------------------------------------------------------
// The kept-selector set (plan §6 finding 7): selectors
// `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts` and
// `docs-screenshots/workspace-settings.shot.ts` depend on. Checked directly
// by the spec, not through this table (they are not user-facing
// "capabilities", they are the exact strings those two scripts key off).
// ---------------------------------------------------------------------------

export interface KeptSelector {
  readonly selector: string;
  /** The tab that hosts it (plan §6: `assignments-heading` "on whichever tab hosts it"). */
  readonly tab: (typeof SETTINGS_TAB_LABELS)[number];
}

export const KEPT_SELECTORS: readonly KeptSelector[] = [
  { selector: '[data-testid="settings-back"]', tab: 'Providers' },
  { selector: '[data-testid="provider-connection-card"]', tab: 'Providers' },
  { selector: '#providers-connections-heading', tab: 'Providers' },
  // Moved with the background roles to Orchestration in Batch 18 (D14).
  { selector: '[data-testid="assignments-heading"]', tab: 'Agent Orchestration' },
];

/** Every parity-inventory entry this baseline covers, frozen in S4 (D14 rule 2/3). */
export const REACHABILITY_TABLE: readonly ReachabilityEntry[] = [
  ...providersAuth,
  ...mainAgentModel,
  ...cliAgents,
  ...orchestrationPolicy,
  ...other,
  ...restoredPending,
  ...regressedUx,
];

/**
 * Guard constant (D14 rule 2): S4 set it to 81; later batches may only grow it. Batch 21 added the
 * three regressed-UX entries it fixes (RUX-1, RUX-4, RUX-10): 84.
 */
export const EXPECTED_CAPABILITY_COUNT = 84;

/**
 * The frozen S4 baseline (D14 rule 3): every id that was `'present'` in THIS
 * commit, written out as a LITERAL list of strings — not derived from the
 * arrays above.
 *
 * code-logic-review Blocking #1 (batch-16-code-logic-review.md): the
 * previous version computed this as `[...providersAuth, ...mainAgentModel,
 * ...].map(e => e.id)`. That meant deleting an id from `providersAuth`, or
 * moving it into `restoredPending`, silently shrank this list too — the
 * exact TASK_2026_523 failure (a capability disappearing while its own gate
 * stayed green) Gate G exists to catch. A literal list cannot be shrunk by
 * editing the arrays it used to be derived from; the only way to remove an
 * id from THIS list is to edit this list, which is the point.
 *
 * A later batch's reachability run fails if any of these ids is missing
 * from `REACHABILITY_TABLE` or has status `'pending'` — a capability may
 * move forward (`'present'` -> `'restored'` once its replacement mounts)
 * but never disappear or go backward.
 */
export const BASELINE_PRESENT_IDS: readonly string[] = [
  '#1', '#2', '#3', '#4', '#5', '#6', '#9', '#10', '#11', '#13', '#14', '#15',
  '#16', '#17', '#18', '#19', '#20', '#22', '#23', '#24', '#26', '#29', '#31',
  '#32', '#33', '#35', '#36', '#37', '#39',
  '#42', '#45', '#46', '#48', '#50', '#51', '#52', '#55', '#56', '#57', '#58',
  '#59', '#60', '#61', '#62', '#63', '#64', '#65', '#66', '#67', '#68', '#69',
  '#72', '#73', '#74', '#75', '#76', '#77', '#78', '#79',
  '#80', '#81', '#82', '#83', '#84',
];
