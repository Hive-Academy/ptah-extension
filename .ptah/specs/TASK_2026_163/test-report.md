# TASK_2026_163 — Batch 5 Final Gate — Test Report (senior-tester)

Scope owned by this report: B5.2 (container smoke + integration spec sweep), B5.3
(frontend spec sweep), B5.6 (purge-completeness grep review), B5.5 (final
automated gate). B5.1 (backend spec sweep) and B5.4 (Electron e2e + showcase
sweep) were already completed by prior CLI lanes — see `batch5-1-report.md` and
`batch5-4-report.md`. No git commit was made (per instructions); all changes
are in the working tree, ready for team-leader to commit.

Housekeeping: deleted one stray untracked file left over from a prior session,
`D:\projects\ptah-extension\.ptah\specs\TASK_2026_163\typecheck-output.txt`,
which had been created with a literal-backslash filename (Windows path bug) at
the repo root — not a deliverable, pure debris.

---

## B5.2 — Container smoke + integration spec sweep

### `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`

### `apps/ptah-electron/src/di/container.smoke.spec.ts`

### `apps/ptah-cli/src/di/container.smoke.spec.ts`

**Finding**: none of the three files (nor their shared `expected-resolvable.ts`
siblings) contained a `FEATURE_GATE`/`FeatureGate` reference at HEAD — that
token was already fully removed by Batch 1 (B1.3) including the test-file
angle. The batch5-1-report.md grep that flagged these three files matched on
`isPremium`, not `FEATURE_GATE` — each file's `TOKENS.LICENSE_SERVICE` mock
carried a dead `isPremium: jest.fn(() => false)` field.

**Action**: verified zero production call sites of `.isPremium(` on
`LicenseService` anywhere in `libs`/`apps` (grep), confirming the field is
unused dead weight, then removed it from the mock in all three files:

```ts
// before
c.register(TOKENS.LICENSE_SERVICE, {
  useValue: { getStatus: jest.fn(), isPremium: jest.fn(() => false) },
});
// after
c.register(TOKENS.LICENSE_SERVICE, {
  useValue: { getStatus: jest.fn() },
});
```

Container-wiring assertions (the `it.each(EXPECTED_RESOLVABLE)` resolution
loop) were untouched.

### `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts`

Read `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`
(production) to confirm the current `wizard:deep-analyze` handler resolves
**only** `TOKENS.CODE_EXECUTION_MCP` and throws `'MCP server required for
workspace analysis.'` when it isn't running — no `LicenseService` resolution
remains anywhere in that path (matches the B2.3 ruling that removed the
premium-gating from this handler). The spec's harness registered a
`Symbol.for('LicenseService')` mock with `verifyLicense`/`plan.isPremium`/
`tier: 'pro'` that production never reads.

**Action**: removed the dead `LicenseService` container registration; kept the
`CodeExecutionMCP` registration (still required — the handler throws early
without it). Updated the adjacent comment from "Wire premium-gating services"
to "Wire the MCP service (required for wizard:deep-analyze to proceed)".

---

## B5.3 — Frontend spec sweep

### `libs/frontend/chat/src/lib/settings/settings.component.spec.ts`

This file only tests `navigateToSettingsTab`/deep-link routing — it never
contained premium-gating assertions to rewrite. It did carry dead cruft: a
`ChatStore` provider stub with `licenseStatus: signal({ isPremium: false })`
that `SettingsComponent` (post-B3a.4 rewrite) never injects or reads
(confirmed via grep — zero `ChatStore`/`licenseStatus`/`isPremium` references
in `settings.component.ts`). Removed the unused `ChatStore` import, stub, and
provider entry.

### `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.spec.ts`

The `WizardStep` union (`setup-wizard-state.types.ts`) has 7 members — no
`'premium-check'` — confirming B3b.1 already removed the step from
production types/computeds. One stale comment remained, describing an
`'enhance'` step-index rationale against an 8-step list that included
`premium-check(0)`. Cross-checked the real `activeStepConfig.steps` array in
`wizard-computeds.ts` (`welcome, scan, analysis, selection, generation,
enhance, completion` → `enhance` index 5) — the **assertion** (`toBe(5)`) was
already correct; only the comment was wrong. Fixed the comment to match the
real 7-step array; no assertion changed.

### Sweep of ALL of `libs/frontend` for specs referencing deleted subjects

Ran the full sweep list from the task (`TrialEndedModal|TrialBanner|
CommunityUpgradeBanner|NotificationBell|WelcomeComponent|isLicensed|isPremium|
UNLICENSED_ALLOWED_METHODS|isLicenseError|isProRequired|
PremiumUpsellComponent|licenseState`) plus a broad `premium|trial|upgrade`
case-insensitive pass across every `*.spec.ts` under `libs/frontend`. Found a
significant additional cluster of stale specs in `libs/frontend/core` — none
were in the task's seed list, but all match the sweep mandate exactly
(**`isLicenseError`/`isProRequired` removed from `RpcResult`**, plus
`isLicensed` removed from `AppStateManager`/`AppState`).

Read the production sources first to confirm each was genuinely dead:

- `libs/frontend/core/src/lib/services/claude-rpc.service.ts` — `RpcResult`
  class now only has `isSuccess()`/`isError()`; `isLicenseError`/
  `isProRequired` do not exist. `call()` has zero license/`AppStateManager`
  gating — it always posts the RPC unless the `AbortSignal` fired.
- `libs/frontend/core/src/lib/services/app-state.service.ts` — `ViewType`
  has no `'welcome'` member; `AppState`/`getStateSnapshot()` have no
  `isLicensed` field; `initializeState()` never reads `ptahConfig.isLicensed`;
  `canSwitchViews` is `!isLoading && isConnected` (no license term).

This meant several of these specs were **currently failing** at HEAD (calling
methods that don't exist, or asserting fields/behavior that were deleted) —
a real, un-flagged purge gap, not just cosmetic residue.

#### `libs/frontend/core/src/lib/services/app-state.service.spec.ts` — REWROTE (was failing)

- Removed `isLicensed` from the local `AppStoreState`/`PtahTestWindow` test
  interfaces and from every fixture/assertion (3 sites, incl. the
  `getStateSnapshot()` `toEqual`).
- **Deleted** two tests whose subject no longer exists: `'blocks view
switches when on "welcome" (license-gate enforcement)'` and `'openViews
computed excludes the "welcome" view'` — `'welcome'` is not a `ViewType`
  member and there is no license-gate branch in `canSwitchViews` any more.
  (`harness.signal('isLicensed')` in the untouched file would throw —
  `signal-store-harness.ts` throws for any name that isn't a live signal on
  the store — so this suite was broken before my edit.)

#### `libs/frontend/core/src/lib/services/claude-rpc.service.spec.ts` — REWROTE (was failing)

- Removed unused `AppStateManager` import/provider (never injected by
  `ClaudeRpcService`).
- Removed dead `isLicensed: true` from the `ptahConfig` window mock.
- Rewrote `'propagates errorCode for license-related failures'` (asserted
  `result.isLicenseError()`/`result.isProRequired()`, both nonexistent
  methods → `TypeError` at runtime) into a generic errorCode-passthrough
  assertion (`result.errorCode).toBe('PRO_TIER_REQUIRED')`).
- **Deleted** `'blocks unlicensed callers from non-whitelisted methods
without posting anything'` — asserted a call-blocking gate keyed off
  `AppStateManager._isLicensed`, a field that no longer exists on
  `AppStateManager` and a gate that `ClaudeRpcService.call()` no longer
  implements.

#### `libs/frontend/core/src/lib/services/claude-rpc-augment.spec.ts` — REWROTE

- Removed unused `AppStateManager` import/provider (2 `TestBed` configs) and
  the dead `isLicensed: true` field. No assertions were gating-related; this
  file only needed cruft removal.

#### `libs/frontend/core/src/testing/mock-rpc-service.spec.ts` — REWROTE (was failing)

- `'rpcError produces a failed RpcResult carrying error + errorCode'` called
  `result.isLicenseError()` (nonexistent) → rewrote to assert
  `result.errorCode).toBe('LICENSE_REQUIRED')` directly (still a valid
  `RpcUserErrorCode` per `libs/shared/.../rpc-error-codes.types.ts` — kept
  for the CLI's invalid-key case per R2).

#### `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.spec.ts` and `.service.spec.ts` — REWROTE

- Both local `makeRpcResult()` test helpers carried dead
  `isLicenseError()`/`isProRequired()` methods (never called by
  `WorkspaceIndexingService`/`WorkspaceIndexingComponent`). Removed both from
  each helper.

#### `libs/frontend/setup-wizard/src/lib/components/welcome.component.spec.ts` — NO CHANGE (false positive)

This is the setup-wizard's own first-step `WelcomeComponent` (still a live,
non-gated step per `setup-wizard/CLAUDE.md` step order) — unrelated to the
**deleted** `libs/frontend/chat/.../templates/welcome.component.ts`
license-lockout view from B3a.3. Grepped for
`isLicensed|isPremium|premium|license` — zero hits. Left untouched.

**Final verification** — re-ran the full sweep after all edits:

```
$ grep -rliE "TrialEndedModal|TrialBanner|CommunityUpgradeBanner|NotificationBell|isLicensed|isPremium|UNLICENSED_ALLOWED_METHODS|isLicenseError|isProRequired|PremiumUpsellComponent|licenseState" libs/frontend --include=*.spec.ts
(zero hits)
$ grep -rliE "premium|trial|upgrade.{0,15}pro" libs/frontend --include=*.spec.ts
(zero hits)
$ grep -rn "'welcome'" libs/frontend --include=*.spec.ts
(only setup-wizard-state.service.spec.ts — legitimate wizard step, not the deleted lockout view)
```

---

## B5.6 — Purge-completeness grep review

Command: `grep -riE "trialEnded|trial_ended|Upgrade to Pro|premium" apps libs --include=*.ts --include=*.html` (node_modules/dist excluded). Every hit reviewed below, grouped by disposition.

| #   | File(s)                                                                                                                                                                                                                                                                                                    | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Action                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `apps/ptah-license-server/**` (plans.config.ts, email.service.ts, license.controller.ts(+.spec), license.service.ts, paddle-webhook.service.ts, paddle.service.ts, subscription/paddle-sync.service.ts, trial-reminder.service.ts)                                                                         | KEEP — explicit scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | `apps/ptah-license-server-e2e/src/license-verify.e2e-spec.ts`                                                                                                                                                                                                                                              | KEEP — tests the KEPT license-server `/verify` endpoint's own `trial_ended` reason field, not app-side gating                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | `libs/shared/.../rpc-misc.types.ts`, `libs/backend/vscode-core/.../license-types.ts`                                                                                                                                                                                                                       | KEEP — explicit scope (license wire types)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | `libs/backend/rpc-handlers/.../license-rpc.handlers.ts` + `.spec.ts` (`isPremium` response shape, `trial_ended` reason mapping)                                                                                                                                                                            | KEEP — explicit scope (response shape)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | `libs/backend/vscode-core/.../license.service.ts`, `license/license-cache.ts`                                                                                                                                                                                                                              | KEEP — KEPT `LicenseService` membership-identity logic (status/grace-period mapping over `license-types.ts`'s `reason` field), not enforcement                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | `apps/ptah-landing-page/.../pricing/components/community-plan-card.component.ts` (`isTrialEnded()`, "Upgrade to Pro" copy)                                                                                                                                                                                 | KEEP — explicitly pre-ruled carry-over (`batch4-verification.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | `apps/ptah-landing-page/.../profile/components/profile-details.component.ts`, `profile-header.component.ts` (`isTrialEnded()`)                                                                                                                                                                             | KEEP — explicitly pre-ruled carry-over                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | `apps/ptah-landing-page/.../pricing/components/pro-plan-card.component.ts`, `pricing/utils/plan-card-state.utils.ts`, `pricing/models/pricing-plan.interface.ts`, `profile/components/profile-features.component.ts`, `profile/models/license-data.interface.ts`, `services/subscription-state.service.ts` | KEEP — same class as #6/#7: the landing-page's own commerce/pricing/profile surface, consuming the KEPT license-server API's `trial_ended`/plan-tier values for display. This is the SaaS pricing/account surface (kept per context.md — "license server ... repurposed as Ptah Builders membership"), not in-app feature gating                                                                                                                                                                                                                                                                                      | none, informational only                                                                                                                                                                                                                                                                                                                                                                                                 |
| 9   | `libs/backend/vscode-core/src/services/webview-message-handler.service.ts:312` — doc: `"Handle MCP permission responses (Premium only - Code Execution MCP)"`                                                                                                                                              | STALE COMMENT — MCP is unconditional now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **FIXED**: reworded to `"(Code Execution MCP)"`                                                                                                                                                                                                                                                                                                                                                                          |
| 10  | `libs/backend/vscode-lm-tools/.../http-mcp-server.service.ts:124` — doc on `ensureRegisteredForSubagents()`: `"Call this ONLY after confirming premium status — free/community users must not have Ptah MCP tools injected"`                                                                               | STALE + MISLEADING — verified all 4 call sites (`gateway-chat-bridge.ts`, `chat-ptah-cli.service.ts` x2, `chat-session.service.ts` x2) gate this call ONLY on `mcpServerRunning`, no license check anywhere                                                                                                                                                                                                                                                                                                                                                                                                           | **FIXED**: reworded to describe the real (MCP-only) gate                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | `libs/frontend/chat/.../pro-features/enhanced-prompts-config.component.ts:77,108` — comment `"(only show for premium with enhanced prompts)"` and **user-facing copy** `"Both presets include MCP documentation for premium users."`                                                                       | STALE — real condition is `hasGeneratedPrompt() && enhancedPromptsEnabled()` (no premium term); the copy was still visibly shown to end users implying a premium tier exists                                                                                                                                                                                                                                                                                                                                                                                                                                          | **FIXED**: comment reworded; user copy changed to `"...when the MCP server is running."`                                                                                                                                                                                                                                                                                                                                 |
| 12  | `libs/backend/agent-generation/.../orchestrator.service.ts:127`, `cli-agent-transforms/multi-cli-agent-writer.service.ts:46` — doc comments `"(premium only)"` / `"(filtered by detection + premium)"` on `targetClis`                                                                                     | STALE — B2.4 removed the `isPremium` requirement; `targetClis` filtering is detection-only now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **FIXED**: reworded                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | `libs/backend/agent-generation/.../enhanced-prompts/{enhanced-prompts.service.ts,index.ts}`, `types/enhanced-prompts.types.ts` — "This premium feature..."                                                                                                                                                 | STALE — feature is unconditional (B2.4/B3a.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **FIXED**: "premium feature" → "feature"                                                                                                                                                                                                                                                                                                                                                                                 |
| 14  | `libs/backend/agent-sdk/.../sdk-query-options-builder.ts:289` — `"appended as a premium top-up"`                                                                                                                                                                                                           | STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **FIXED**: "premium top-up" → "top-up"                                                                                                                                                                                                                                                                                                                                                                                   |
| 15  | `libs/backend/agent-sdk/.../sdk-query-runner.service.ts:12` — `"appended for premium"`                                                                                                                                                                                                                     | STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **FIXED**                                                                                                                                                                                                                                                                                                                                                                                                                |
| 16  | `libs/backend/agent-sdk/.../session-lifecycle-manager.ts:193` — `"Only used for premium users with a non-empty query"`                                                                                                                                                                                     | STALE — memory-recall injection has no tier check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **FIXED**: "for premium users" → "when non-empty"                                                                                                                                                                                                                                                                                                                                                                        |
| 17  | `libs/backend/cli-agent-runtime/.../cli-adapters/cli-adapter.interface.ts:36` — `"Replaces projectGuidance for premium users"`                                                                                                                                                                             | STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **FIXED**                                                                                                                                                                                                                                                                                                                                                                                                                |
| 18  | `libs/backend/vscode-lm-tools/.../ptah-system-prompt.constant.ts:3` — `"Appended...for premium+MCP users"`                                                                                                                                                                                                 | STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **FIXED**: "premium+MCP" → "when the MCP server is running"                                                                                                                                                                                                                                                                                                                                                              |
| 19  | `libs/backend/vscode-lm-tools/.../namespace-builders/agent-namespace.builder.ts:93,95` — `"for premium users (async)"` (x2)                                                                                                                                                                                | STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **FIXED**                                                                                                                                                                                                                                                                                                                                                                                                                |
| 20  | `libs/shared/.../agent-process.types.ts:111,114`, `ai-provider.types.ts:136`, `rpc/rpc-setup.types.ts:78` — `"for premium users"`, `"Premium-gated"`, `"(premium + MCP required)"`                                                                                                                         | STALE — `WizardDeepAnalyzeResponse` is MCP-only gated now (verified in `setup-rpc.handlers.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **FIXED**: all reworded to drop the premium term                                                                                                                                                                                                                                                                                                                                                                         |
| 21  | `libs/backend/rpc-handlers/.../enhanced-prompts-rpc.handlers.ts:177,181,408` — `"Requires premium license"`, `"1. Verify premium license"`                                                                                                                                                                 | STALE — B2.3 removed the `LicenseService` param from this handler entirely (confirmed by `batch5-1-report.md`'s note on the handler's constructor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **FIXED**                                                                                                                                                                                                                                                                                                                                                                                                                |
| 22  | `libs/backend/rpc-handlers/.../chat-session.service.ts:817,861` — `"premium-gated config"` (x2)                                                                                                                                                                                                            | STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **FIXED**: "premium-gated" → dropped                                                                                                                                                                                                                                                                                                                                                                                     |
| 23  | `libs/backend/cli-agent-runtime/.../cli-plugin-sync.service.ts:9,128`, `cli-skill-sync/cli-skill-manifest-tracker.ts:102` — `"Premium expiry (cleanupAll)"` / `"called on premium expiry"`                                                                                                                 | STALE, AND a **finding**: `cleanupAll()`/`clearSyncHash()` have **zero production call sites** anywhere in `apps/*` (grepped) — orphaned since the license-reactivity teardown that used to invoke them was removed in B1.4. Not deleting the methods themselves (out of scope for a comment sweep; could be an intentional future-cleanup utility) — flagging as a **finding** for a future cleanup task                                                                                                                                                                                                             | **FIXED comments**; **FINDING**: dead/unwired `cleanupAll()` + `clearSyncHash()`, candidate for removal in a follow-up                                                                                                                                                                                                                                                                                                   |
| 24  | `libs/backend/rpc-handlers/.../session-rpc.handlers.spec.ts:1582` — fixture string `error: 'workspace not premium'`                                                                                                                                                                                        | Cosmetic — generic error-passthrough test, arbitrary fixture text, not an assertion about gating                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **FIXED**: renamed fixture to `'SDK process failed to start'` to remove noise from future greps                                                                                                                                                                                                                                                                                                                          |
| 25  | `apps/ptah-cli/src/cli/commands/analyze.ts:19`, `router.ts:2184` — `"Premium licence + MCP server are required by the backend"` / `"Premium licence gated by the backend"`                                                                                                                                 | STALE — `wizard:deep-analyze` is MCP-only gated now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **FIXED**: both reworded to "MCP server required"                                                                                                                                                                                                                                                                                                                                                                        |
| 26  | `apps/ptah-cli/src/cli/commands/analyze.spec.ts:301` — fixture `error: 'premium licence required', errorCode: 'license_required'` on a generic RPC-failure-bubbles test                                                                                                                                    | Cosmetic/unrealistic fixture (backend can no longer return this for this endpoint)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **FIXED**: replaced with the real current error message, dropped the now-impossible `errorCode`                                                                                                                                                                                                                                                                                                                          |
| 27  | `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts:228-273` — **`mcp_agent_spawn_ptah_cli_denied`** and **`mcp_session_submit_denied_community`**, each asserting `structuredContent.ptah_code).toBe('license_required')` for a Community-tier `agent_spawn`/`session_submit` call                             | **REAL FINDING — production logic (removed), test asserting removed gating.** Confirmed zero `license_required` emitters anywhere in the `ptah-cli` MCP tool-dispatch path (`mcp-serve.ts`, `session-submit.service.ts` — grepped, zero hits for license/premium/tier/gate). B1.5/B1.6 removed the shared MCP tool-call gate and the per-spawn premium check; these two CLI e2e tests were never updated and were asserting a `license_required` denial that production can no longer produce — i.e. they would fail if run (this suite is `nx e2e ptah-cli`, not part of `npm run test`, so it was silently rotting) | **FIXED**: rewrote both into open-access tests (`mcp_agent_spawn_ptah_cli_community_allowed`, `mcp_session_submit_community_streams`), mirroring the existing `mcp_agent_spawn_free_cli`/`mcp_session_submit_pro_streams` non-license-outcome assertion pattern already used elsewhere in the same file. Verified: `nx e2e ptah-cli --testPathPatterns=mcp-serve` → **21/21 passing** (was previously unverified/broken) |
| 28  | `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts:910` — `expect(errorCodes).toContain('license_required')` in `mcp_session_describe_includes_error_codes`                                                                                                                                                    | KEEP — `license_required` remains a legitimate member of the `PTAH_ERROR_CODES` wire taxonomy (`jsonrpc/types.ts`) per R2 (CLI `license set` invalid-key case); this test asserts the taxonomy is intact, not that a gate exists                                                                                                                                                                                                                                                                                                                                                                                      | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 29  | `apps/ptah-cli/tests/e2e/utils/fake-mcp-host.ts:38,76` — doc: `"...leave the cache empty (so the gate denies all premium tools)"`                                                                                                                                                                          | STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **FIXED**: reworded to state there is no tool-call gate; `licenseStatus` now documented as membership-display-only                                                                                                                                                                                                                                                                                                       |
| 30  | `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts:183,211` — comments `"The community license MUST NOT trigger the premium gate here"` / `"Goal: prove the premium gate did NOT block..."`                                                                                                                    | Historical framing, still accurate (explains the regression the test guards against)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | none — left as-is                                                                                                                                                                                                                                                                                                                                                                                                        |
| 31  | VS Code extension **downloadable plugin/skill template assets** (`apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-gsap-animation-crafter/assets/sections/*.component.ts` — "premium hero section", "Premium Visual Design", "Premium floating metrics")                              | FALSE POSITIVE — "premium" used as a marketing/design-quality adjective in generated Angular template content shipped to end users' own projects, unrelated to Ptah's own license gating. Same class the CLAUDE.md marketplace rules treat as content, not code                                                                                                                                                                                                                                                                                                                                                       | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 32  | `libs/frontend/chat/.../setup-plugins/chat-empty-state.component.ts:68` — doc: `"Premium Responsive Design with Tabbed Navigation"`                                                                                                                                                                        | FALSE POSITIVE — design-quality adjective in a file-header comment, no license/gating meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 33  | `libs/frontend/harness-builder/.../setup-hub.component.ts:4` — doc: `"Premium configuration dashboard"`                                                                                                                                                                                                    | FALSE POSITIVE — same as #32                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 34  | `libs/frontend/chat/.../settings.component.html:193` — comment: `"Web Search Config (free for all users, not premium-gated)"`                                                                                                                                                                              | Already correctly states non-gating; no change needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 35  | `libs/frontend/chat/.../settings/license/license-status-card.component.ts` — `isPremium()` computed off `chatStore.licenseStatus()?.isPremium`, `Membership`/`Builder`/`Community` badge, `openPricing()`/`openSignup()`/`enterLicenseKey()` buttons                                                       | KEEP — this IS the B3a.4-repointed "Builders membership card": read the full template, confirmed **zero** "Upgrade to Pro" CTAs (buttons say "Manage Membership" / "Create Account" / "Enter Membership Key" / "Explore Ptah Builders"); `isPremium` sourced from the KEPT `rpc-misc.types.ts` display field, used only to pick "Builder" vs "Community" badge text — same class as #6/#7's `isTrialEnded()`                                                                                                                                                                                                          | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 36  | `libs/backend/cli-agent-runtime/.../cli-adapters/copilot-sdk.adapter.ts` (`premiumRequests`), `libs/shared/.../copilot-provider-entry.ts:188`                                                                                                                                                              | FALSE POSITIVE — GitHub Copilot's own "premium requests" billing/quota terminology (a real third-party API concept), unrelated to Ptah's license tiers                                                                                                                                                                                                                                                                                                                                                                                                                                                                | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 37  | `libs/shared/.../provider-registry.ts:385` — `description: 'Premium extended thinking (128K context)'`                                                                                                                                                                                                     | FALSE POSITIVE — marketing description of a specific third-party LLM model (GLM-4.5-X), unrelated to Ptah licensing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 38  | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts:1280-1281`                                                                                                                                                                                                                           | Already-correct comment explaining the purge itself (added by B5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Net B5.6 result**: 38 hit-groups reviewed. 0 remaining out-of-scope hits requiring further code changes. 15 stale-comment/doc groups fixed, 1 stale user-facing UI copy fixed, 2 real e2e test regressions found and fixed (item 27 — the most significant finding), 1 dead-code finding flagged for a future cleanup task (item 23), several false-positive "premium"-as-adjective hits confirmed unrelated and left alone.

---

## B5.5 — Final automated gate

### 1. `npm run typecheck:all` (`nx affected -t typecheck`)

**Result: GREEN.** `Successfully ran target typecheck for 51 projects`. Zero
errors. One pre-existing Angular template warning (NG8102, unrelated —
`confirmation-dialog.component.ts:33`, a redundant `??` — present before any
of my edits, not a compile error).

### 2. `npm run lint:all` (`nx run-many -t lint`)

**Result: GREEN.** `Successfully ran target lint for 56 projects`. `0 errors`
across every linted project; warnings only (pre-existing
`no-non-null-assertion`/`explicit-member-accessibility` style warnings,
unrelated to this task).

### 3. `npm run test` (`nx run-many -t test -p ptah-extension-vscode

ptah-extension-webview shared`) — literal instructed command

**Result: GREEN.**

```
@ptah-extension/shared:test      — 23 suites / 23, 403/403 tests
ptah-extension-webview:test      — 1 suite / 1, 1/1 tests
ptah-extension-vscode:test       — 2 suites / 2, 5/5 tests
Successfully ran target test for 3 projects
```

The `ptah-extension-vscode` 5/5 covers exactly the two files I edited under
B5.2 (`container.smoke.spec.ts`, `wizard-seed-noop.spec.ts`).

### Supplementary verification (beyond the literal `npm run test` scope)

`npm run test`'s scope is narrow by design (per root `CLAUDE.md`: "Jest across
extension/webview/shared") and does not exercise most of the libs I edited
under B5.2/B5.3/B5.6 (frontend `core`/`chat`/`setup-wizard`/
`workspace-indexing`, `ptah-electron`, `ptah-cli`, and the backend libs I
touched with comment-only fixes). To avoid under-testing, I additionally ran
`nx run-many -t test --skip-nx-cache` targeted at every project touched in
this session:

```
npx nx run-many -t test --skip-nx-cache -p core chat setup-wizard \
  workspace-indexing ptah-cli ptah-electron vscode-core vscode-lm-tools \
  agent-generation agent-sdk rpc-handlers cli-agent-runtime gateway-chat-bridge
```

| Project               | Suites                          | Tests                | Result                               |
| --------------------- | ------------------------------- | -------------------- | ------------------------------------ |
| `core`                | 22/22                           | 465/465              | PASS                                 |
| `vscode-core`         | 19/19                           | 281/281              | PASS                                 |
| `agent-sdk`           | 60/61                           | 781/782              | **1 FAIL — pre-existing, see below** |
| `cli-agent-runtime`   | 27/27                           | 398/398              | PASS                                 |
| `agent-generation`    | 23/23                           | 557/557              | PASS                                 |
| `vscode-lm-tools`     | 35/35                           | 638/638              | PASS                                 |
| `workspace-indexing`  | 2/2                             | 34/34                | PASS                                 |
| `rpc-handlers`        | 63/63                           | 1319 + 2 skip / 1321 | PASS                                 |
| `gateway-chat-bridge` | 2/2                             | 39/39                | PASS                                 |
| `chat`                | 45/45                           | 600 + 2 skip / 602   | PASS                                 |
| `ptah-electron`       | 13/14 (1 conditionally skipped) | 140 + 4 skip / 144   | PASS                                 |
| `setup-wizard`        | 10/10                           | 271/271              | PASS                                 |
| `ptah-cli` (unit)     | 61/62 (1 skip)                  | 832 + 3 skip / 835   | PASS                                 |

The `ptah-electron` skipped suite is `integration/wizard-seed.integration.spec.ts`,
gated by `nativeAvailable ? describe : describe.skip` (native-module
availability check, unrelated to licensing — confirmed via grep, zero
license/premium terms in that file).

Additionally ran `apps/ptah-cli`'s e2e suite for the file I substantively
rewrote under B5.6 (item 27):

```
npx nx e2e ptah-cli --testPathPatterns=mcp-serve
→ Test Suites: 1 passed, 1 total
→ Tests: 21 passed, 21 total
```

This is NOT part of any of the three mandated gate commands (`nx e2e` is a
separate target, `jest.e2e.config.cjs`), but I ran it anyway since I made
non-trivial rewrites to two of its tests and wanted first-party confirmation
they're correct, not just "type-checks."

### Pre-existing failure — evidence

**`@ptah-extension/agent-sdk` → `sdk-query-runner.service.spec.ts` →
`SdkQueryRunner › runOneShot — one-shot auth override (input.auth) › derives
env / settingSources / beta flag from the override, not this.authEnv`**

```
expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
Received: ""
```

Root cause: the sandbox/CI shell this task ran in has `ANTHROPIC_AUTH_TOKEN`
set to an **empty string** in the ambient environment:

```
$ env | grep -i ANTHROPIC
ANTHROPIC_AUTH_TOKEN=[]
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
ANTHROPIC_AUTH_TOKEN=
```

Production code at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:285`
does `env: { ...process.env, ... }` when building the one-shot query's env —
so the ambient (empty-string, not unset) `ANTHROPIC_AUTH_TOKEN` leaks through
into the captured `options.env`, and the test's `toBeUndefined()` assertion
fails on an env value the test author never anticipated the host shell to
have.

Evidence this is pre-existing and unrelated to the purge (not a bisect via
`git stash` — used git history instead, per instructions):

- `git diff` on this file shows my **only** change is a one-word doc-comment
  edit inside a `/** ... */` block ("appended for premium" → "appended"),
  nowhere near the `env` builder at line 285.
- `git log -L 275,295:...sdk-query-runner.service.ts` shows the
  `...process.env` spread was introduced in commit `9ade5e1f1`
  ("feat(electron): route the memory curator on its own independent
  provider"), dated **2026-06-04** — six weeks before this task
  (`TASK_2026_163`) started (2026-07-18), and unrelated to license/premium
  gating.
- `batch5-1-report.md` (run earlier in this same task, on the same working
  tree state for this file) reports this exact suite green: "agent-sdk ...
  Test run: `nx test agent-sdk` → 61 suites / 61, 782/782." — confirming the
  test passes cleanly in an environment without the ambient
  `ANTHROPIC_AUTH_TOKEN` leak; the flakiness is purely a function of the
  invoking shell's environment, not the code.

No code or test change was made for this — it is out of scope for this gate
(a latent env-isolation gap in a one-shot auth-override test, unrelated to
TASK_2026_163) and is documented here as required.

### Overall B5.5 verdict

All three mandated gate commands (`typecheck:all`, `lint:all`, `test`) are
**GREEN** with zero errors. The one test failure surfaced by my supplementary
(non-mandated) broader verification is confirmed pre-existing/environmental
with hard evidence, not caused by this purge or by any Batch 5 change.

---

## Manual smoke checklist (USER'S step — not attempted by this agent)

Per instructions, launching the Electron GUI is out of scope for this agent.
The following must be run manually before final merge:

- [ ] Launch Electron with **no license key configured** (fresh/cold profile,
      R3 cold-profile check).
- [ ] Confirm the app boots directly into the chat view — no "welcome"
      lockout screen, no blocking modal.
- [ ] Chat: send a message, confirm a session starts (MCP/enhanced-prompts/
      plugins should all be available unconditionally).
- [ ] Setup Wizard: open it, confirm it starts at the real first step (no
      `premium-check`/license gate step).
- [ ] Marketplace: open it, confirm the provider hub loads without any
      `license:getStatus` call blocking it.
- [ ] Dashboard: confirm the new **Ptah Builders card** renders (below the
      Analytics card), shows neutral open-source copy (no countdowns/
      comparison tables), and the "Dismiss" button persists across reload
      (`localStorage['ptah.builders-card.dismissed']`).
- [ ] Settings → Membership card: confirm it shows "Community" status with
      "Create Account" / "Enter Membership Key" / "Explore Ptah Builders"
      actions — no "Upgrade to Pro" CTA text anywhere.
- [ ] (R7) With a **pre-existing valid license key** loaded, confirm the
      membership card correctly flips to "Builder" status display (this is
      the one place `isPremium` legitimately still renders — as a status
      badge, not a gate).

---

## Files touched by this agent (B5.2/B5.3/B5.6 — not B5.1/B5.4, already committed-ready by prior lanes)

**B5.2**:

- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`
- `apps/ptah-electron/src/di/container.smoke.spec.ts`
- `apps/ptah-cli/src/di/container.smoke.spec.ts`
- `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts`

**B5.3**:

- `libs/frontend/chat/src/lib/settings/settings.component.spec.ts`
- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.spec.ts`
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts`
- `libs/frontend/core/src/lib/services/claude-rpc.service.spec.ts`
- `libs/frontend/core/src/lib/services/claude-rpc-augment.spec.ts`
- `libs/frontend/core/src/testing/mock-rpc-service.spec.ts`
- `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.spec.ts`
- `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.spec.ts`

**B5.6** (comment/copy/test fixes):

- `libs/backend/vscode-core/src/services/webview-message-handler.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`
- `libs/frontend/chat/src/lib/settings/pro-features/enhanced-prompts-config.component.ts`
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`
- `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/multi-cli-agent-writer.service.ts`
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/index.ts`
- `libs/backend/agent-generation/src/lib/types/enhanced-prompts.types.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-skill-sync/cli-plugin-sync.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-skill-sync/cli-skill-manifest-tracker.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`
- `libs/shared/src/lib/types/agent-process.types.ts`
- `libs/shared/src/lib/types/ai-provider.types.ts`
- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`
- `apps/ptah-cli/src/cli/commands/analyze.ts`
- `apps/ptah-cli/src/cli/commands/analyze.spec.ts`
- `apps/ptah-cli/src/cli/router.ts`
- `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts` (substantive — item 27)
- `apps/ptah-cli/tests/e2e/utils/fake-mcp-host.ts`

**Deleted** (housekeeping, not a deliverable):

- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_163\typecheck-output.txt` (garbled literal-backslash filename, stray debris from a prior session)

## Findings for follow-up (not fixed — out of scope for a spec/comment sweep)

- `libs/backend/cli-agent-runtime/.../cli-skill-sync/cli-plugin-sync.service.ts`
  `cleanupAll()` and `cli-skill-manifest-tracker.ts` `clearSyncHash()` are
  orphaned (zero production callers) since the license-reactivity teardown
  that used to invoke them was removed in Batch 1 (B1.4). Comments updated
  to stop describing a "premium expiry" trigger that no longer exists;
  actual removal of the dead methods is a candidate for a future cleanup
  task, not this gate.
