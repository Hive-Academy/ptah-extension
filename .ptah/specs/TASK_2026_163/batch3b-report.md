# TASK_2026_163 Batch 3 Lane 3b — Premium Gating Purge (setup-wizard + marketplace)

## Files touched

### setup-wizard

- `libs/frontend/setup-wizard/src/lib/components/premium-upsell.component.ts` — **deleted**.
- `libs/frontend/setup-wizard/src/index.ts` — removed `PremiumUpsellComponent` export.
- `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts` — removed the `licenseState`/`licenseError` signals, `premiumFeatures` list, `checkLicense()` RPC flow, the `LicenseState` type, the `ClaudeRpcService` injection, and the `@if (licenseState() === ...)` template branches. The component now renders the step-progress + step-switch content unconditionally; class doc comment updated to drop the license-gating description.
- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.types.ts` — removed the `'premium-check'` member from the `WizardStep` union (and its doc comment).
- `libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-computeds.ts` — removed the `'premium-check'` case from `canProceed`'s switch, the `'premium-check': 0` entry from the `stepProgress` record, and the stale "Excludes 'premium-check'" doc comment on `stepIndex`.
- `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts` — removed the `isPremiumError` string-sniffing branch (`.includes('premium')` / `.includes('upgrade')`) in the `enhancedPrompts:runWizard` failure path; all failures now go through the plain `error` status instead of silently downgrading to `skipped`.
- `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` — fixed the stale `deepAnalyze()` doc comment ("premium + MCP required" → "MCP required").
- `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts` — fixed a stale "primary path for premium users" doc comment (beyond the original file list, found via the acceptance grep).
- `libs/frontend/setup-wizard/CLAUDE.md` — updated module doc: dropped premium-gating from Purpose, Step Order, Public API (removed `PremiumUpsellComponent`), Key Files, and Guidelines sections (not in the original instruction list, but left stale/incorrect otherwise).

### marketplace

- `libs/frontend/marketplace/src/lib/marketplace-hub.component.ts` — removed the `ngOnInit` pro-gate (`license:getStatus` call), the `_isPremium`/`isPremium`/`isLicenseResolved` signals, the `implements OnInit` clause, the now-unused `ClaudeRpcService`/`signal`/`computed`/`OnInit` imports, and the `LockIcon`/`SparklesIcon` icon refs (only used by the deleted gate template). Class doc comment's "Pro-gated" paragraph removed.
- `libs/frontend/marketplace/src/lib/marketplace-hub.component.html` — removed the `!isLicenseResolved()` loading branch and the `!isPremium()` upgrade-affordance block; the `@if` chain now starts directly at `selectedProvider(); as provider`. Fixed a stale "(premium, no provider selected)" comment.
- `libs/frontend/marketplace/src/lib/smithery-surface.component.ts` — updated the stale class doc comment referencing "the hub already gates the whole view on premium."

### Beyond the listed scope (found via the mandatory gating-branch sweep)

Every entry in `MARKETPLACE_PROVIDERS` had `proGated: true` — a blanket per-provider tier gate that drove a "Pro" badge in the same HTML file targeted by 2a. Since the whole-hub license gate was removed and Ptah is going fully open source, this field was dead weight expressing the same removed concept:

- `libs/frontend/marketplace/src/lib/provider-spec.ts` — removed the `proGated?: boolean` field from `MarketplaceProviderSpec`.
- `libs/frontend/marketplace/src/lib/providers.registry.ts` — removed all 5 `proGated: true` lines.
- `libs/frontend/marketplace/src/lib/marketplace-hub.component.html` — removed the `@if (provider.proGated)` "Pro" badge block from the provider-list card.

No other `isPremium` / `tier === 'pro'` / `trial` / `isProTier` / `hasValidLicense` style branches were found in either lib's production code.

## Acceptance grep outputs

```
$ grep -riE "premium|upgrade" libs/frontend/setup-wizard/src libs/frontend/marketplace/src --include=*.ts --include=*.html | grep -v '\.spec\.ts'
(no output — zero hits)

$ grep -rn "'premium-check'" libs/frontend/setup-wizard/src
(no output — zero hits; the only remaining reference repo-wide is
 setup-wizard-state.service.spec.ts, a spec file, out of scope per instructions)
```

## Typecheck results

```
$ npx nx run @ptah-extension/setup-wizard:typecheck
✅ Successfully ran target typecheck for project @ptah-extension/setup-wizard
(one pre-existing NG8102 warning in libs/frontend/chat, unrelated to this change)

$ npx nx run @ptah-extension/marketplace:typecheck
✅ Successfully ran target typecheck for project @ptah-extension/marketplace
```

## Behavior verification (static/read-through, no running app)

- Wizard: `WizardViewComponent` no longer has any `checking`/`invalid` branch — `currentStep()` (from `SetupWizardStateService`, defaulting to `'welcome'` now that `'premium-check'` is gone from the step type) is rendered unconditionally at mount. Confirmed no remaining production reference to the deleted `'premium-check'` step or `PremiumUpsellComponent`.
- Marketplace: `MarketplaceHubComponent` has no constructor/`ngOnInit` side effects left at all — `selectedProvider()` / provider-list template renders immediately; provider surfaces (`McpDirectoryBrowserComponent`, `SkillShBrowserComponent`, `SmitherySurfaceComponent`, etc.) mount and fire their own RPCs with no preceding `license:getStatus` call.

## Notes / follow-ups

- Left untouched per instructions: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` and `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (pre-existing unstaged modifications from a sibling task/lane — not part of this batch).
- No `*.spec.ts` files were modified, per protocol. `setup-wizard-state.service.spec.ts` still references `'premium-check'` and will need updating in a later test-focused pass (spec-file failures are tolerated per this task's acceptance criteria).

LANE 3B DONE
