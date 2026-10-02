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
 *
 * Batch 36 (Gate V 36): no entry here or in the spread-in entry files is
 * `pending` any more. The last Orchestration ones flipped with the CLI matrix
 * (Batches 30-32) and the retired instance manager's entries were re-pointed
 * in Batch 34. Every entry is asserted in both hosts.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  AGENT_CONFIG_FIXTURE, getFixtureState, INVALID_PROBE_KEY, MOONSHOT_KEY_HINT, SETTINGS_TAB_LABELS,
} from './settings.fixtures';
import { ROUTING_MAP_ENTRIES } from './settings-routing-map.entries';
import { CLI_MATRIX_ENTRIES } from './settings-cli-matrix.entries';
import {
  advancedTab, applyManualTierModel, card, chooseMainAgentModel, expectHostAppScope, closeCatalog, closeConnectionDrawer, expectCatalogOpen, openCatalog, confirmWrite, credentialsOf, expectCall, inDrawerTab,
  closeMainAgentPopover, openCardDrawer, openMainAgentPopover, openScopeBadge, orchestrationTab, providersTab,
  throughVariantBoot, setupThroughDrawer, visibleEnabled, withAuthStatus,
} from './settings-drawer.reach';

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

/** Opens the setup wizard for `providerName` from the catalog modal's Connect (Batch 27) and closes it after `assertion`. */
async function throughCatalog(
  page: Page,
  providerName: string,
  assertion: (page: Page) => Promise<void>,
  advance = true,
): Promise<void> {
  const setupButton = (await openCatalog(page)).getByRole('button', { name: 'Connect ' + providerName, exact: true });
  await visibleEnabled(setupButton);
  await setupButton.click();
  await expectCatalogOpen(page, false);
  await visibleEnabled(wizardBody(page));
  try {
    if (advance) await advancePastProviderStep(page);
    await assertion(page);
  } finally {
    await closeWizard(page);
  }
}

/**
 * Opens the wizard with NO deep link (`openWizard('')`, the catalog modal's
 * "Custom endpoint gateway" Configure) so it lands on the provider step with
 * nothing preselected, selects the "Custom endpoint" radio, then closes.
 */
async function throughBlankWizardCustomOption(
  page: Page,
  assertion: (page: Page) => Promise<void>,
): Promise<void> {
  const customEntry = (await openCatalog(page)).getByRole('button', { name: 'Configure a custom endpoint', exact: true });
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
 * Opens the setup wizard for an already-configured custom gateway: its card (Batch 24: the card itself
 * opens the drawer), then the drawer's "Edit in setup" (D14), then closes the wizard.
 */
async function throughCard(
  page: Page,
  providerName: string,
  assertion: (page: Page) => Promise<void>,
  advance = true,
): Promise<void> {
  await providersTab(page);
  await openCardDrawer(page, providerName);
  await setupThroughDrawer(page, providerName);
  await visibleEnabled(wizardBody(page));
  try {
    if (advance) await advancePastProviderStep(page);
    await assertion(page);
  } finally {
    await closeWizard(page);
  }
}


// ---------------------------------------------------------------------------
// Table 1: Providers / auth (parity-inventory.md #1-31)
// ---------------------------------------------------------------------------

const providersAuth: readonly ReachabilityEntry[] = [
  {
    id: '#1', capability: 'All providers visible (configured cards + More providers catalog)', status: 'present',
    // Since Batch 27 the catalog is a modal: the unconfigured providers are listed there, searchable.
    reach: async (page) => {
      const dialog = await openCatalog(page);
      await visibleEnabled(dialog.locator('[data-provider="openrouter"]').getByRole('button', { name: 'Connect OpenRouter', exact: true }));
      await closeCatalog(page);
    },
  },
  {
    id: '#2', capability: 'Per-provider configured/active marker', status: 'present',
    reach: async (page) => { await providersTab(page); await visibleEnabled(card(page, 'Claude (Subscription)').locator('[data-testid="status-badge"]')); },
  },
  {
    id: '#3', capability: 'Switch main provider', status: 'present',
    // Gate V 28: the card has no "Use for main agent" (prototype); Reassign -> the popover's provider select -> D6 confirm.
    reach: async (page) => {
      const popover = await openMainAgentPopover(page);
      await popover.locator('[data-testid="main-agent-provider"]').selectOption('moonshot');
      await visibleEnabled(popover.getByRole('button', { name: 'Use for main agent' }));
      await popover.getByRole('button', { name: 'Cancel provider change' }).click();
      await closeMainAgentPopover(page);
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
    // Since Batch 22 (D14): the drawer's Credentials tab, not the wizard.
    reach: (page) => inDrawerTab(page, 'Moonshot', 'Credentials', 'connection-credentials', async (panel) => {
      await expect(panel.locator('[data-testid="credentials-key-mask"]')).toBeVisible();
      await visibleEnabled(panel.locator('[data-testid="credentials-replace"]'));
    }),
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
    // Since Batch 22 (D14): the drawer's Credentials tab shows detection, the commands and Check again.
    reach: (page) => inDrawerTab(page, 'Claude (Subscription)', 'Credentials', 'connection-credentials', async (panel) => {
      await expect(panel.locator('[data-testid="credentials-cli-detected"]')).toContainText('Claude CLI detected');
      await visibleEnabled(panel.locator('[data-testid="credentials-cli-check"]'));
    }),
  },
  {
    id: '#11', capability: 'GitHub Copilot sign-in (OAuth)', status: 'present',
    reach: (page) => throughCatalog(page, 'GitHub Copilot', async (p) => visibleEnabled(p.locator('[data-testid="wizard-sign-in"], [data-testid="wizard-sign-in-waiting"]'))),
  },
  {
    id: '#13', capability: 'Codex auth-file status / Open login', status: 'present',
    // The oauth branch's real controls (`provider-setup-wizard.component.ts:717-753`),
    // not the generic step heading every step shares.
    // Since Batch 22 (D14): the drawer's Credentials tab (auth-file copy + Open login).
    reach: (page) => inDrawerTab(page, 'OpenAI Codex', 'Credentials', 'connection-credentials', async (panel) => {
      await expect(panel.locator('[data-testid="credentials-codex-copy"]')).toContainText('~/.codex/auth.json');
      await visibleEnabled(panel.locator('[data-testid="credentials-open-login"]'));
    }),
  },
  {
    id: '#14', capability: 'Local provider (no key needed) with editable endpoint', status: 'present',
    reach: (page) => throughCatalog(page, 'Ollama', async (p) => visibleEnabled(p.locator('[data-testid="wizard-base-url"]'))),
  },
  {
    id: '#15', capability: 'Ollama Cloud optional key', status: 'present',
    // Since Batch 24 (D14): an api-key connection's drawer Credentials tab (optional-key copy + the key).
    reach: (page) => inDrawerTab(page, 'Ollama Cloud', 'Credentials', 'connection-credentials', async (panel) => {
      await expect(panel.locator('[data-testid="credentials-optional-key"]')).toContainText('The key is optional');
      await visibleEnabled(panel.locator('[data-testid="credentials-replace"]'));
    }),
  },
  {
    id: '#16', capability: 'Apply to: Global / App / Workspace save target', status: 'present',
    // Since Batch 26: the Main Agent popover's "Save to"; the workspace target's provider D6 confirm is cancelled.
    // Batch 27b: 3 targets in both hosts (the App target is the host's own layer); RUX-5 pins their names per host.
    reach: async (page) => {
      const popover = await openMainAgentPopover(page);
      await expect(popover.locator('[data-testid="main-agent-save-to"] option')).toHaveCount(3);
      await popover.locator('[data-testid="main-agent-save-to"]').selectOption('workspace');
      await openThenClose(popover.locator('[data-testid="main-agent-provider-rescope"]'),
        popover.getByRole('button', { name: 'Use for main agent' }), popover.getByRole('button', { name: 'Cancel provider change' }));
      await closeMainAgentPopover(page);
    },
  },
  {
    id: '#17', capability: 'Scope badge (Workspace/App override, Inherited)', status: 'present',
    // Since Batch 23 (D16): a badge naming the field, shown only for an override (the fixture's effort key).
    reach: async (page) => {
      await providersTab(page);
      const badge = page.locator('[data-testid="scope-badge"][data-field="Reasoning effort"]');
      await visibleEnabled(badge);
      await expect(badge).toContainText('Effort · Workspace');
    },
  },
  {
    id: '#18', capability: 'Clear the workspace override', status: 'present',
    // Since Batch 23: badge -> popover (App layer named after the host, Batch 27b) -> Clear override -> review.
    reach: async (page) => {
      const scopePopover = await openScopeBadge(page, 'Reasoning effort');
      await expectHostAppScope(page, scopePopover, scopePopover.locator('[data-layer="app"]'));
      const clear = page.locator('[data-testid="scope-clear-override"]');
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
    reach: (page) => throughCard(page, 'sovereigneg', async (p) => visibleEnabled(p.locator('[data-testid="wizard-custom-name"], [data-testid="wizard-base-url"]'))),
  },
  {
    id: '#26', capability: 'Test custom provider (verify)', status: 'present',
    // `sovereigneg`'s deep link lands on the provider step with its custom
    // editor already expanded (`isCustomSelected()`), the same reachable
    // surface #24 pins, one Continue away from Credential and one more from
    // Verify. Actually runs the probe and asserts success — not a
    // step-1-Continue-is-visible check.
    reach: (page) => throughCard(page, 'sovereigneg', async (p) => {
      await advanceWizardTo(p, 'wizard-step-verify');
      await p.locator('[data-testid="wizard-verify-start"]').click();
      await visibleEnabled(p.locator('[data-testid="wizard-verify-success"]'));
    }, false),
  },
  {
    id: '#29', capability: 'Custom provider tier model mapping (Models step)', status: 'present',
    // Actually reaches the Models step (through Credential + a real Verify
    // probe) and asserts a tier picker, not a step-1 Continue button.
    reach: (page) => throughCard(page, 'sovereigneg', async (p) => {
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
    id: '#32', capability: 'Model-mapping editor (Manage -> drawer Models & Tiers)', status: 'present',
    // Since Batch 22 (D14): one picker per tier in the drawer, no billable re-verify.
    reach: (page) => inDrawerTab(page, 'Moonshot', 'Models & Tiers', 'connection-models', async (panel) => {
      for (const tier of ['sonnet', 'opus', 'haiku']) await expect(panel.locator(`[data-tier="${tier}"] ptah-provider-model-picker`)).toBeVisible();
    }),
  },
  {
    id: '#33', capability: 'Per-tier change saved (drawer Models & Tiers, save on selection)', status: 'present',
    // Since Batch 22 (D14): a real provider:setModelTier write, read back into the row, then restored by
    // resetting the tier to the default so later entries see the BRIEF baseline.
    reach: (page) => inDrawerTab(page, 'Moonshot', 'Models & Tiers', 'connection-models', async (panel) => {
      const before = getFixtureState(page).calls.length;
      await applyManualTierModel(panel, 'sonnet', 'moonshot/kimi-k2.7-code');
      await expectCall(page, before, 'provider:setModelTier', { providerId: 'moonshot', tier: 'sonnet', modelId: 'moonshot/kimi-k2.7-code', scope: 'mainAgent' });
      await expect(panel.locator('[data-testid="models-current-sonnet"]')).toContainText('moonshot/kimi-k2.7-code');
      await panel.locator('[data-testid="models-default-sonnet"]').click();
      await expect(panel.locator('[data-testid="models-current-sonnet"]')).toContainText('Provider default');
    }),
  },
  {
    id: '#35', capability: 'Custom model ID per tier ("Not listed? Enter a model ID")', status: 'present',
    // Since Batch 26 (Batch 28b: the compact model search): the list's last row "Enter a model ID…" → inline field.
    reach: async (page) => {
      const popover = await openMainAgentPopover(page);
      await chooseMainAgentModel(page, popover, 'Enter a model ID…');
      await visibleEnabled(popover.locator('[data-testid="main-agent-model-manual"]'));
      await closeMainAgentPopover(page);
    },
  },
  {
    id: '#36', capability: 'Clear a tier to provider default (drawer Default)', status: 'present',
    // Since Batch 22 (D14): sets a tier, then "Default" sends provider:clearModelTier and the row reads
    // "Provider default" again.
    reach: (page) => inDrawerTab(page, 'Moonshot', 'Models & Tiers', 'connection-models', async (panel) => {
      await applyManualTierModel(panel, 'haiku', 'kimi-lite');
      await expect(panel.locator('[data-testid="models-current-haiku"]')).toContainText('kimi-lite');
      const before = getFixtureState(page).calls.length;
      await panel.locator('[data-testid="models-default-haiku"]').click();
      await expectCall(page, before, 'provider:clearModelTier', { providerId: 'moonshot', tier: 'haiku', scope: 'mainAgent' });
      await expect(panel.locator('[data-testid="models-current-haiku"]')).toContainText('Provider default');
    }),
  },
  {
    id: '#37', capability: 'Current mapping / resolved model shown', status: 'present',
    // Since Batch 26: the resolved model on the routing map's Main Agent node (the old main-agent block is gone).
    reach: async (page) => {
      await providersTab(page);
      await expect(page.locator('[data-testid="routing-main-model"]')).toHaveText('Default (chosen by Claude)');
    },
  },
];

// ---------------------------------------------------------------------------
// Table 3: CLI agents (#42-71, present/partial only)
// ---------------------------------------------------------------------------

// Batch 34 (D14): the old Ptah CLI instance manager is gone. #39, #42, #45, #46, #48, #50-#52, #55-#57 and the delegated
// #59-#62 and #65-#69 moved with it to the CLI matrix and its modals and popovers: `settings-cli-matrix.entries.ts`.
const cliAgents: readonly ReachabilityEntry[] = [
  { id: '#58', capability: 'Deep link opens setup for a preselected provider', status: 'present',
    reach: (page) => throughCatalog(page, 'OpenRouter', async (p) => visibleEnabled(p.locator('[data-testid="wizard-title"]'))) },
];

// ---------------------------------------------------------------------------
// Table 4: Agent orchestration policy (#72-79)
// ---------------------------------------------------------------------------

/** Batch 33: the Orchestration tab's policy bar (`orchestration-policy-bar`). */
const policyBar = (page: Page): Locator => page.locator('[data-testid="orchestration-policy-bar"]');

const orchestrationPolicy: readonly ReachabilityEntry[] = [
  // Batch 33: #72-#74 and #79 are the policy bar; #75-#78 the CLI matrix (Batch 30), which replaced the old cards.
  { id: '#72', capability: 'Re-detect CLIs', status: 'present',
    reach: async (page) => {
      await orchestrationTab(page);
      const redetect = policyBar(page).getByRole('button', { name: 'Re-detect CLI agents' });
      await visibleEnabled(redetect);
      await redetect.click();
      await visibleEnabled(redetect);
      await expect(policyBar(page).locator('[data-testid="policy-redetect-error"]')).toHaveCount(0);
    } },
  { id: '#73', capability: 'Preferred agent order (up/down)', status: 'present',
    // Batch 33: the bar's chips open the order popover; ▲/▼ per row (24 px, deviation 5). One move writes the whole
    // order; Esc returns focus to the chips; the toast's Undo writes the previous order back.
    reach: async (page) => {
      await orchestrationTab(page);
      const trigger = policyBar(page).locator('[data-testid="policy-order-edit"]');
      await visibleEnabled(trigger);
      await trigger.click();
      const popover = page.locator('[data-testid="policy-order-popover"]');
      await expect(popover).toBeVisible();
      await expect(popover.getByRole('button', { name: 'Move Codex up' })).toBeDisabled();
      const before = getFixtureState(page).calls.length;
      const down = popover.getByRole('button', { name: 'Move Codex down' });
      await visibleEnabled(down);
      await down.click();
      await expectCall(page, before, 'agent:setConfig', { preferredAgentOrder: ['antigravity', 'codex', 'glm-instance-1', 'copilot', 'opencode'] });
      await expect(popover.getByRole('button', { name: 'Move Codex down' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.locator('[data-testid="settings-toast-undo"]').click();
      await expectCall(page, before, 'agent:setConfig', { preferredAgentOrder: ['codex', 'antigravity', 'glm-instance-1', 'copilot'] });
      await expect(policyBar(page).locator('[data-testid^="policy-order-chip-"]').first()).toHaveText('1. Codex');
    } },
  { id: '#74', capability: 'Max concurrent agents slider', status: 'present',
    reach: async (page) => {
      await orchestrationTab(page);
      const slider = page.locator('#agent-max-concurrent');
      await visibleEnabled(slider);
      const before = getFixtureState(page).calls.length;
      await slider.fill('5');
      await expectCall(page, before, 'agent:setConfig', { maxConcurrentAgents: 5 });
      await expect(policyBar(page).locator('[data-testid="policy-max-concurrent-value"]')).toHaveText('5');
      await page.locator('[data-testid="settings-toast-undo"]').click();
      await expectCall(page, before, 'agent:setConfig', { maxConcurrentAgents: 3 });
      await expect(policyBar(page).locator('[data-testid="policy-max-concurrent-value"]')).toHaveText('3');
    } },
  { id: '#75', capability: 'System CLI rows with detection badges', status: 'present',
    reach: async (page) => {
      await orchestrationTab(page);
      const codex = page.locator('[data-testid="cli-matrix-row-codex"]');
      await expect(codex).toContainText('v1.4.0');
      await expect(codex).toContainText('Ready');
    } },
  { id: '#76', capability: 'Enable/disable toggle per system CLI', status: 'present',
    reach: async (page) => { await orchestrationTab(page); await visibleEnabled(page.getByLabel('Codex enabled', { exact: true })); } },
  { id: '#77', capability: '"No CLI agents found" install help', status: 'present',
    // A second page where detection finds no CLI installed: each system CLI sits in the Uninstalled group with its
    // install guide (#71, #77 copy).
    reach: (page) => throughVariantBoot(
      page,
      { 'agent:getConfig': { ...AGENT_CONFIG_FIXTURE, detectedClis: AGENT_CONFIG_FIXTURE.detectedClis.map((cli) => ({ ...cli, installed: false })) } },
      'Agent Orchestration',
      async (variantPage) => {
        // Gate V 36 decision 1: the Uninstalled group opens from its disclosure first.
        await variantPage.locator('[data-testid="cli-matrix-uninstalled-toggle"]').click();
        const guide = variantPage.locator('[data-testid="cli-matrix-uninstalled"] [data-testid="cli-matrix-install-codex"]');
        await visibleEnabled(guide);
        await guide.click();
        await expect(variantPage.locator('[data-testid="cli-install-popover"]')).toContainText('npm install -g @openai/codex');
      },
    ) },
  { id: '#78', capability: 'Ptah CLI agents managed inside Orchestration (moved to Providers)', status: 'present',
    // V36-7: an instance's Edit sits in its "More actions" popover; Esc closes it again.
    reach: async (page) => {
      await orchestrationTab(page);
      await page.locator('[data-testid="cli-matrix-more-glm-instance-1"]').click();
      await visibleEnabled(page.locator('[data-testid="cli-matrix-edit-glm-instance-1"]'));
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="cli-matrix-more-menu"]')).toHaveCount(0);
    } },
  { id: '#79', capability: 'Loading and error states', status: 'present',
    // The harness RPC auto-responder always answers `success: true`, so the error branches (the container's
    // "… could not be loaded" + Retry per section, the bar's fixed Re-detect sentence) are pinned in the unit specs.
    // Here: the loaded state settles with no loading line and no error left, and the bar shows the read value.
    reach: async (page) => {
      await orchestrationTab(page);
      await expect(page.locator('[data-read-loading]')).toHaveCount(0);
      await expect(page.locator('[data-read-error]')).toHaveCount(0);
      await expect(policyBar(page).locator('[data-testid="policy-max-concurrent-value"]')).toHaveText('3');
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
    // A deep link raised while Settings is ALREADY open: the routing map's Background roles action on Providers
    // (`requestSettingsTab({tab:'orchestration', section:'background-models'})`). The routed tab becomes active, the
    // closed roles <details> opens (Batch 33, deviation 4) and the section takes focus. Closed again for later entries.
    reach: async (page) => {
      await providersTab(page);
      await page.locator('[data-testid="routing-node-background-roles"] [data-testid="routing-node-action"]').click();
      await expect(page.getByRole('button', { name: 'Agent Orchestration', exact: true })).toHaveClass(/tab-active/);
      const details = page.locator('[data-testid="background-roles-details"]');
      await expect(details).toHaveAttribute('open', '');
      await expect(page.locator('[data-focus="background-models"]')).toBeFocused();
      await page.locator('[data-testid="background-roles-summary"]').click();
      await expect(details).not.toHaveAttribute('open');
    } },
  { id: '#84', capability: 'VS Code LM model change triggers a CLI re-detect', status: 'present',
    reach: async (page) => { await advancedTab(page); await visibleEnabled(page.locator('ptah-vscode-lm-config')); } },
];

// ---------------------------------------------------------------------------
// The 17 restored items (parity-inventory.md "Missing capabilities", minus
// #21). Each started `pending` and flipped to `restored` in the batch that
// built it (plan D14 rule 3); since Batch 32 none is pending (confirmed at Batch 36).
// ---------------------------------------------------------------------------

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
  { id: '#25', capability: 'Delete a custom provider', status: 'restored',
    // Batch 22: Advanced -> Delete connection -> inline confirm -> provider:removeCustomEntry. The fixture
    // does not remove the entry, so the card (and later entries) stay.
    reach: (page) => inDrawerTab(page, 'sovereigneg', 'Advanced', 'connection-advanced', async (panel) => {
      const before = getFixtureState(page).calls.length;
      await panel.locator('[data-testid="advanced-delete"]').click();
      await panel.locator('[data-testid="advanced-delete-confirm-button"]').click();
      await expectCall(page, before, 'provider:removeCustomEntry', { id: 'sovereigneg' });
      await expect(panel.locator('[data-testid="advanced-commit"]')).toBeVisible();
    }) },
  { id: '#27', capability: 'Custom provider models endpoint', status: 'restored',
    // Batch 22 (D7): Save stays disabled until a check of the current address passes, then the write goes out.
    reach: (page) => inDrawerTab(page, 'sovereigneg', 'Advanced', 'connection-advanced', async (panel) => {
      const state = getFixtureState(page);
      const entry = state.customEntries.find((candidate) => candidate.id === 'sovereigneg');
      const stored = entry?.['modelsEndpoint'] ?? null;
      const before = state.calls.length;
      await panel.locator('[data-testid="advanced-models-endpoint"]').fill('/v2/models');
      const save = panel.locator('[data-testid="advanced-save-endpoint"]');
      await expect(save).toBeDisabled();
      await panel.locator('[data-testid="advanced-check"]').click();
      await expect(panel.locator('[data-testid="advanced-probe"]')).toContainText('Endpoint verified');
      await save.click();
      await expectCall(page, before, 'provider:updateCustomEntry', { id: 'sovereigneg', changes: { modelsEndpoint: '/v2/models' } });
      await expect(panel.locator('[data-testid="advanced-commit"]')).toContainText('Endpoint saved.');
      if (entry) entry['modelsEndpoint'] = stored;
    }) },
  { id: '#28', capability: 'Custom provider help URL', status: 'restored',
    reach: (page) => inDrawerTab(page, 'sovereigneg', 'Advanced', 'connection-advanced', async (panel) => {
      const before = getFixtureState(page).calls.length;
      await panel.locator('[data-testid="advanced-help-url"]').fill('https://docs.example.internal/ai');
      await panel.locator('[data-testid="advanced-save-help"]').click();
      await expectCall(page, before, 'provider:updateCustomEntry', { id: 'sovereigneg', changes: { helpUrl: 'https://docs.example.internal/ai' } });
      await expect(panel.locator('[data-testid="advanced-commit"]')).toContainText('Help URL saved.');
    }) },
  { id: '#30', capability: 'Custom provider pricing (input/output per 1M)', status: 'restored',
    reach: (page) => inDrawerTab(page, 'sovereigneg', 'Advanced', 'connection-advanced', async (panel) => {
      await expect(panel.locator('[data-testid="advanced-pricing-note"]'))
        .toHaveText('Stored for your reference; Ptah does not use it for cost estimates yet.');
      const before = getFixtureState(page).calls.length;
      await panel.locator('[data-testid="advanced-price-input"]').fill('0.5');
      await panel.locator('[data-testid="advanced-price-output"]').fill('1.5');
      await panel.locator('[data-testid="advanced-save-pricing"]').click();
      await expectCall(page, before, 'provider:updateCustomEntry', { id: 'sovereigneg', changes: { pricing: { inputPerMillion: 0.5, outputPerMillion: 1.5 } } });
      await expect(panel.locator('[data-testid="advanced-commit"]')).toContainText('Pricing saved.');
    }) },
  { id: '#34', capability: 'Searchable model autocomplete for tier mapping', status: 'restored',
    reach: (page) => inDrawerTab(page, 'Moonshot', 'Models & Tiers', 'connection-models', async (panel) => {
      await visibleEnabled(panel.locator('[data-tier="opus"] [data-testid="provider-model-picker-search"]'));
    }) },
  { id: '#38', capability: 'Tool-use compatibility indicators', status: 'restored',
    reach: (page) => inDrawerTab(page, 'Moonshot', 'Models & Tiers', 'connection-models', async (panel) => {
      await expect(panel.locator('[data-tier="sonnet"] [data-testid="provider-model-picker-tooluse-summary"]')).toContainText('support tool use');
    }) },
  // #43, #44, #54, #70 and #71 (Batch 30) and #47, #49 and #53 (Batch 32) are in `settings-cli-matrix.entries.ts`.
];

// ---------------------------------------------------------------------------
// Regressed UX (parity-inventory.md "Regressed UX"), added when the batch that fixes each one lands.
// ---------------------------------------------------------------------------

const regressedUx: readonly ReachabilityEntry[] = [
  { id: 'RUX-3', capability: 'Unconfigured providers shown up front (hint strip + catalog modal), not in a collapsed disclosure', status: 'restored',
    // Batch 27: the hint strip names them; the modal opens with its search focused and Esc returns focus to the
    // opener (`openCatalog` / `closeCatalog`). Batch 28 moved the Tab-trap and backdrop checks (Batch 14 finding 3)
    // to `settings-providers.e2e.spec.ts`.
    reach: async (page) => {
      await providersTab(page);
      await expect(page.locator('[data-testid="catalog-hint"]')).toContainText('OpenRouter');
      const dialog = await openCatalog(page);
      await expect(dialog.locator('[data-provider]')).not.toHaveCount(0);
      await dialog.locator('[data-testid="provider-catalog-search"]').fill('no-such-provider');
      await expect(dialog.locator('[data-testid="provider-catalog-empty"]')).toContainText('No matching providers.');
      await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
      await expect(dialog.locator('[data-provider]')).not.toHaveCount(0);
      await closeCatalog(page);
    } },
  { id: 'RUX-5', capability: 'Workspace save target offered in a visible Save-to list, not behind an override link', status: 'restored',
    // Batch 26: the popover's "Save to" lists every write scope, "This workspace" included, and re-saves the
    // current provider there through the D6 confirm (cancelled here). Batch 27b: App is named after the host.
    reach: async (page) => {
      const popover = await openMainAgentPopover(page);
      const target = popover.locator('[data-testid="main-agent-save-to"]');
      const label = await expectHostAppScope(page, popover, target.locator('option[value="app"]'));
      await expect(target.locator('option')).toHaveText(['Global · all apps', label, 'This workspace']);
      await target.selectOption('workspace');
      await popover.locator('[data-testid="main-agent-provider-rescope"]').click();
      await expect(popover.locator('[data-testid="main-agent-provider-confirm"]')).toContainText('Saved to: This workspace.');
      await popover.getByRole('button', { name: 'Cancel provider change' }).click();
      await expect(popover.locator('[data-testid="main-agent-provider-confirm"]')).toHaveCount(0);
      await closeMainAgentPopover(page);
    } },
  { id: 'RUX-6', capability: 'Main agent card shows scope only as badges for overridden fields (no 5 stacked rows)', status: 'restored',
    // Batch 23 (D16): no scope strip; one badge, for the one overridden field, naming it; inherited fields show nothing.
    reach: async (page) => {
      await providersTab(page);
      await expect(page.locator('[data-testid="setting-scope-row"]')).toHaveCount(0);
      const badges = page.locator('[data-testid="main-scope-badges"] [data-testid="scope-badge"]');
      await expect(badges).toHaveCount(1);
      await expect(badges.first()).toHaveAttribute('data-field', 'Reasoning effort');
      const popover = await openScopeBadge(page, 'Reasoning effort');
      await expect(popover.locator('[data-layer="workspace"]')).toHaveAttribute('aria-current', 'true');
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(page.locator('[data-testid="scope-badge"][data-field="Reasoning effort"]')).toBeFocused();
    } },
  { id: 'RUX-2', capability: 'Tier model edited in place, saved on selection, with Undo (no wizard, no re-verify)', status: 'restored',
    // Batch 22: the selection is one real write; Undo is a SECOND real write restoring the previous value.
    reach: (page) => inDrawerTab(page, 'Moonshot', 'Models & Tiers', 'connection-models', async (panel) => {
      const before = getFixtureState(page).calls.length;
      await applyManualTierModel(panel, 'opus', 'kimi-k2.5');
      await expectCall(page, before, 'provider:setModelTier', { providerId: 'moonshot', tier: 'opus', modelId: 'kimi-k2.5', scope: 'mainAgent' });
      const undo = panel.locator('[data-testid="models-undo"]');
      await visibleEnabled(undo);
      await undo.click();
      await expectCall(page, before, 'provider:clearModelTier', { providerId: 'moonshot', tier: 'opus', scope: 'mainAgent' });
      await expect(panel.locator('[data-testid="models-current-opus"]')).toContainText('Provider default');
    }) },
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
  { id: 'RUX-9', capability: 'No repeated "Manage … in Providers" links on Orchestration (the CLI node deep-links once)', status: 'restored',
    // Batch 33: the old per-CLI links went with the old policy body; the matrix edits in place.
    reach: async (page) => {
      await orchestrationTab(page);
      await expect(policyBar(page)).toBeVisible();
      await expect(page.getByText(/Manage .* in Providers/)).toHaveCount(0);
    } },
  { id: 'RUX-12', capability: 'Background role reassigned in place: a popover from its cell (or "Follows main agent →" chip), saved on selection', status: 'restored',
    // Batch 35: the roles table-xs. Judge lane's cell opens its popover; choosing "follow the main agent" (provider '')
    // writes `skillSynthesis:setLanes` at once. The fixture's `getLanes` is static, so the read-back cannot confirm the
    // write: the entry asserts the write and that the toast does not claim it saved (D15). Esc returns focus to the
    // cell; the roles are closed again for later entries.
    reach: async (page) => {
      await orchestrationTab(page);
      const details = page.locator('[data-testid="background-roles-details"]');
      // Batch 35 revise R3: #83's `background-models` deep link (earlier in this session) belongs to that visit only;
      // a later visit finds the roles closed.
      await expect(details).not.toHaveAttribute('open');
      await page.locator('[data-testid="background-roles-summary"]').click();
      await expect(details).toHaveAttribute('open', '');
      try {
        await expect(page.locator('[data-testid="consumer-table"]')).toBeVisible();
        await expect(page.locator('[data-testid="consumer-summary-archaeologist"]')).toHaveText('Follows main agent → Claude (Subscription)');
        // R1: one line, the full route in the cell's title.
        await expect(page.locator('[data-testid="consumer-edit-archaeologist"]')).toHaveAttribute('title', /^Follows main agent → Claude \(Subscription\)/);
        const cell = page.locator('[data-testid="consumer-edit-judge"]');
        await expect(cell).toHaveText(/Moonshot \(Kimi\) · kimi-k2\.5/);
        await visibleEnabled(cell);
        await cell.click();
        const popover = page.locator('[data-testid="consumer-editor-judge"]');
        await expect(popover).toBeVisible();
        const before = getFixtureState(page).calls.length;
        await popover.locator('[data-testid="provider-model-picker-provider"]').selectOption('');
        await expectCall(page, before, 'skillSynthesis:setLanes', { lanes: { judge: { provider: '' } } });
        await expect(page.locator('[data-testid="settings-toast-message"]')).toBeVisible();
        await expect(page.locator('[data-testid="settings-toast-message"]')).not.toContainText('Saved Judge lane');
        await popover.locator('[data-testid="provider-model-picker-provider"]').focus();
        await page.keyboard.press('Escape');
        await expect(popover).toHaveCount(0);
        await expect(cell).toBeFocused();
      } finally {
        if (await details.getAttribute('open') !== null) await page.locator('[data-testid="background-roles-summary"]').click();
      }
    } },
  // Gate V 28 follow-ups (Batch 28d, task.md "Gate V 28 (2026-10-01, user)"): the deviations the user did not accept.
  { id: 'GV28-1', capability: 'Stored key shown as its masked hint (bullets + last 4) in Credentials and Overview', status: 'restored',
    reach: async (page) => {
      try {
        const tab = await credentialsOf(page, 'Moonshot');
        await expect(tab.locator('[data-testid="credentials-key-mask"]')).toHaveText(MOONSHOT_KEY_HINT);
        await page.getByRole('tab', { name: 'Overview & Used By', exact: true }).click();
        await expect(page.locator('[data-testid="connection-key-hint"]')).toHaveText(MOONSHOT_KEY_HINT);
        await expect(page.locator('[data-testid="connection-credential-storage"]')).toContainText('(stored on this machine)');
      } finally {
        await closeConnectionDrawer(page);
      }
    } },
  { id: 'GV28-2', capability: 'Overview shows the latency and time of a connection check (auth:checkConnection)', status: 'restored',
    reach: (page) => inDrawerTab(page, 'sovereigneg', 'Overview & Used By', 'connection-overview', async (panel) => {
      const status = panel.locator('[data-testid="connection-status"]');
      await expect(status).toHaveText('Connected & verified');
      const before = getFixtureState(page).calls.length;
      const check = panel.locator('[data-testid="connection-check"]');
      await visibleEnabled(check);
      await check.click();
      await expectCall(page, before, 'auth:checkConnection', { providerId: 'sovereigneg' });
      await expect(status).toHaveText('Connected & verified (140ms)');
      await expect(panel.locator('[data-testid="connection-last-checked"]')).toHaveText('Checked just now');
    }) },
  { id: 'GV28-3', capability: 'Codex CLI listed under "Used by" for OpenAI Codex (Used by 2)', status: 'restored',
    reach: (page) => inDrawerTab(page, 'OpenAI Codex', 'Overview & Used By', 'connection-overview', async (panel) => {
      await expect(card(page, 'OpenAI Codex').locator('[data-testid="used-by-count"]')).toHaveText('Used by 2');
      await expect(panel.locator('[data-used-by="codex-cli"]')).toContainText('Codex CLI');
      await expect(panel.locator('[data-testid="connection-used-by-count"]')).toHaveText('2 active routes');
    }) },
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
  /** A control a user clicks first to show it (Batch 33: the roles are in a closed `<details>`). */
  readonly reveal?: string;
}

export const KEPT_SELECTORS: readonly KeptSelector[] = [
  { selector: '[data-testid="settings-back"]', tab: 'Providers' },
  { selector: '[data-testid="provider-connection-card"]', tab: 'Providers' },
  { selector: '#providers-connections-heading', tab: 'Providers' },
  // Moved with the background roles to Orchestration in Batch 18 (D14); inside the roles <details> since Batch 33.
  { selector: '[data-testid="assignments-heading"]', tab: 'Agent Orchestration', reveal: '[data-testid="background-roles-summary"]' },
];

/** Every parity-inventory entry this baseline covers, frozen in S4 (D14 rule 2/3). */
export const REACHABILITY_TABLE: readonly ReachabilityEntry[] = [
  ...providersAuth, ...mainAgentModel, ...cliAgents, ...orchestrationPolicy, ...other, ...restoredPending, ...regressedUx, ...ROUTING_MAP_ENTRIES, ...CLI_MATRIX_ENTRIES,
];

/**
 * Guard constant (D14 rule 2): S4 set it to 81; later batches may only grow it. Batch 21 added the
 * three regressed-UX entries it fixes (RUX-1, RUX-4, RUX-10): 84. Batch 22 added RUX-2: 85. Batch 23 added
 * RUX-5 and RUX-6: 87. Batch 27 added RUX-3: 88. Batch 28 added the routing-map node actions RM-1..3: 91.
 * Batch 28d added the Gate V 28 follow-ups GV28-1..3 (key hint, check latency, Codex CLI under "Used by"): 94.
 * Batch 30 added the CLI matrix's regressed-UX fixes RUX-8 (2-click model/effort) and RUX-11 (inline test result), in
 * `settings-cli-matrix.entries.ts` with the restored #43, #44, #54, #70 and #71 (moved there from the pending list): 96.
 * Batch 33 added RUX-9 (no repeated "Manage … in Providers" links): 97. Batch 35 added RUX-12 (a background role
 * reassigned in place from its table cell's popover): 98.
 */
export const EXPECTED_CAPABILITY_COUNT = 98;

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
