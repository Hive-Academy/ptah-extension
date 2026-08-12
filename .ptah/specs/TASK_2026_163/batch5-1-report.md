# TASK_2026_163 — Batch 5, Lane B5.1 Report

Backend spec sweep after the premium-gating purge, plus the B2.9 production tail.
Scope: `libs\backend\{rpc-handlers,vscode-lm-tools,agent-sdk,gateway-chat-bridge,cli-agent-runtime,agent-generation,vscode-core}`.
No git commit was made (per instructions) — all changes are in the working tree.

## Method

Six independent backend-developer agents were run in parallel (one per library), each instructed to: read every spec fully before editing, delete tests whose subject was deleted from production, rewrite gating assertions into open-access assertions, never weaken unrelated assertions, sweep their whole project (not just the seed file list) for lingering references, and run that project's Jest suite green. After all six returned, the orchestrator (this session) performed the B2.9 production tail and a final cross-project verification pass, and caught two spec files the sweeps missed (see "Found during final verification" below).

## Per-file actions

### libs/backend/rpc-handlers

- `handlers/config-rpc.handlers.spec.ts` — **Rewrote.** Removed `FeatureGateService` import, `MockFeatureGate`/`createMockFeatureGate` helpers, `featureGate` harness field/ctor arg, `isPro` opt. Deleted "rejects YOLO mode for non-Pro users"; rewrote the isProTier-gated YOLO test into an open-access "allows YOLO for everyone" test; dropped `isPro:true` fixtures.
- `handlers/license-rpc.handlers.spec.ts` — **No change.** All tests assert status-shape/display mapping (isPremium/isCommunity/tier as DISPLAY fields, setKey/clearKey), none assert enforcement. Kept per the ruling (response shape KEPT).
- `handlers/setup-rpc.handlers.spec.ts` — **Rewrote.** "throws when license service / MCP cannot be resolved (free tier)" → "throws when the MCP server cannot be resolved" (matches new throw message); updated gating-describe header and trusted-fallback comment to MCP-only; removed dead `LicenseService` container registration in `seedHarness`.
- `chat/ptah-cli/chat-ptah-cli.service.spec.ts` — **Rewrote.** Import repointed `chat-premium-context.service` → `chat-sdk-context.service`, `ChatPremiumContextService` → `ChatSdkContextService`, `premiumContext` → `sdkContext`; also dropped a stray `licenseService` mock/ctor-arg (production ctor is 5 params, no LicenseService).
- `handlers/enhanced-prompts-rpc.handlers.spec.ts` — **Rewrote** (found via sweep, not in seed list). Production dropped its `LicenseService` param entirely. Removed `LicenseService`/`LicenseStatus` imports, mock helpers, harness field/ctor arg. Deleted the license-verification-timeout test and both "rejects non-premium tiers with upgrade message" tests; rewrote "on pro tier"/"accepts trial_pro" tests into open-access dispatch/failure-forwarding equivalents.
- `chat/session/chat-session-auth.spec.ts` — **Rewrote** (found via sweep). Was failing to compile ("Expected 20 arguments, got 21") — removed the extra `LicenseService` ctor arg + unused import.
- `chat/session/chat-session-resume-activate.spec.ts` — **Rewrote** (found via sweep). Same 21→20 ctor mismatch; removed `licenseService`; renamed leftover `premiumContext` mock → `sdkContext`.
- `handlers/corpus-rpc.handlers.ts` — **Rewrote** (production, doc-only). Removed a stale docblock line referencing the deleted `PRO_ONLY_METHOD_PREFIXES`.
- `CLAUDE.md` — **Rewrote** (docs). Removed the stale "add prefix to PRO_ONLY_METHOD_PREFIXES" guideline bullet.
- Test run: `nx test rpc-handlers` → **63 suites / 63, 1319 passed + 2 pre-existing skips / 1321.** Green.

### libs/backend/vscode-lm-tools

- `code-execution/mcp-stdio/mcp-license-gate.spec.ts` — **Deleted.** Entirely tested the deleted `McpLicenseGate` class (evaluate/shouldGateAsPtahCli/getGatedToolNames, PRO_ONLY_MCP_TOOLS, PTAH_PRICING_URL).
- `code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts` — **Rewrote.** Dropped `LICENSE_SERVICE`/`AGENT_PROCESS_MANAGER` mocks and the `cli-agent-runtime` jest.mock (existed only for the gate), the `McpLicenseGate` import, `makeAllowGate()` helper; simplified ctor calls to 2 args. Rewrote "license gate denial routing" → "unconditional tool availability (open source)": the two previously Pro-gated paths (`agent_spawn`, `session_submit`) now assert always-available.
- Test run: `nx test vscode-lm-tools` → **35 suites / 35, 638/638.** Green.

### libs/backend/agent-sdk

- `helpers/sdk-query-options-builder.spec.ts` — **Rewrote.** Dropped `isPremium: true` fixture; renamed `buildPremiumWith` → `buildSystemPromptWith` (5 call sites).
- `sdk-agent-adapter.spec.ts` — **Rewrote.** Removed `isPremium` from session-config fixture, cast type, and the `toMatchObject` assertion.
- `internal-query/internal-query.service.spec.ts` — **Rewrote.** Removed `isPremium` from `makeConfig`, the full-config literal, and the `toEqual` field-forwarding expectation (3 sites).
- `helpers/sdk-query-runner.service.spec.ts` — **Rewrote.** Removed 9 dead `isPremium: false` excess-property lines from `OneShotRunInput` literals (unrelated tests: health gating, unsafe-cwd rewrite, hook wiring, auth override, env strip — untouched).
- Test run: `nx test agent-sdk` → **61 suites / 61, 782/782.** Green.

### libs/backend/gateway-chat-bridge

- `gateway-chat-bridge.spec.ts` — **Rewrote.** Found and fixed a latent harness bug: the stale `licenseService` mock at ctor position 7 was shifting every subsequent positional ctor arg (codeExecutionMcp, enhancedPromptsService, pluginLoader, turnTracker) by one slot — this would have silently mis-wired all 39 tests once production dropped the `LicenseService` dependency. Removed it from the `Harness` interface, `setup()`, ctorArgs, and returned harness. Rewrote the "premium parity" describe block (~1286-1339) into "SDK context wiring (MCP + prompts/plugins)": deleted both `isPremium` true/false assertions and `licenseStatus` fixtures; kept both tests re-anchored on `mcpServerRunning`/prompts/plugins/`ensureRegisteredForSubagents`.
- Test run: `nx test gateway-chat-bridge` → **2 suites / 2, 39/39.** Green.

### libs/backend/cli-agent-runtime

- `cli-agents/agent-process-manager.service.spec.ts` — **Rewrote.** Removed `createMockLicenseService()` helper, `LICENSE_SERVICE` token/mock, `licenseService` ctor arg; reindexed the remaining `ConstructorParameters[...]` casts. No behavioral tests deleted (MCP-resolution tests assert health-check behavior, unchanged).
- `ptah-cli/ptah-cli-registry-spawn-model.spec.ts`, `ptah-cli-registry-lmstudio-proxy.spec.ts`, `ptah-cli-registry-sakana-proxy.spec.ts` — **Rewrote** (1 line each). Removed the stale `isPremium: false` field from `assembleSpawnOptions` mock fixtures (production `PtahSpawnAssembly` no longer declares it). No assertions touched.
- Test run: `nx test cli-agent-runtime` → **27 suites / 27, 398/398.** Green.

### libs/backend/agent-generation

- `services/content-generation.service.spec.ts` — **Rewrote.** Removed 15 dead `isPremium` fields from `sdkConfig` literals; deleted the one true gating assertion `expect(callArgs.isPremium).toBe(true)`.
- `services/enhanced-prompts/enhanced-prompts.service.spec.ts` — **Rewrote.** Removed dead `isPremium` field from 3 `runWizard` `sdkConfig` literals.
- `services/orchestrator.service.spec.ts` — **Rewrote.** Removed `isPremium: true` from `generateAgents` options input and from a `toMatchObject` sdkConfig assertion.
- Test run: `nx test agent-generation` → **23 suites / 23, 557/557.** Green.

### libs/backend/vscode-core (spec sweep + B2.9 production tail)

- Initial sweep (grep for `FeatureGate|FEATURE_GATE|validateLicense|PRO_ONLY_|bindLicenseReactivity|isPremiumTier|license-reactivity`) found **zero spec hits** — `license-reactivity/` is confirmed gone, replaced by `subsystem-bringup.ts` (`bringUpSubsystems`), which has no dedicated spec (none was required by task scope).
- **B2.9 tail (production):**
  - `services/license.service.ts` — **Deleted** the `isPremiumTier()` function (was ~line 50) and its docblock.
  - `src/index.ts` — **Removed** `isPremiumTier` from the `export { LicenseService, isPremiumTier } from './services/license.service'` barrel line (line 69).
  - `CLAUDE.md` — **Rewrote** two stale doc references to `isPremiumTier` (Public API + Key Files sections).
- **Found during final verification (not in the seed list, missed by symbol-literal grep because they don't reference `isPremiumTier`/`FeatureGate` by name — they only broke via `RpcHandler`'s constructor arity changing from 3 args to 2 when license enforcement was removed from `rpc-handler.ts`):**
  - `messaging/rpc-handler-license.spec.ts` — **Deleted.** Entire file's subject was a `validateLicense`-style enforcement mechanism inside `RpcHandler` (license-status gating, `PRO_TIER_REQUIRED`/`LICENSE_REQUIRED` blocking) that no longer exists in production — `RpcHandler`'s constructor is now `(logger, sentryService)` only, with no license check in `handleMessage`.
  - `messaging/rpc-handler.spec.ts` — **Rewrote.** Removed the `licenseService` mock/field and fixed 3 `new RpcHandler(...)` call sites down to 2 ctor args (was TS2554 compile error: "Expected 2 arguments, but got 3"). Rewrote "exempts 'db:' methods from license check" → "handles 'db:' prefixed methods", dropping the now-nonexistent license-bypass premise while keeping the regression coverage for the `db:` prefix. All unrelated RpcUserError-passthrough tests (including the errorCode-string cases `LICENSE_REQUIRED`/`PRO_TIER_REQUIRED`, which are just generic error-code passthrough, not enforcement) were left untouched.
- Test run: `nx test vscode-core` → **19 suites / 19, 281/281.** Green (was 2 suites / 18 tests failing to compile before this fix).

## Acceptance checks

```
$ grep -rn "isPremiumTier" libs apps --include=*.ts
(zero hits in source; residual hits only in gitignored apps/*/dist/**/*.cjs build artifacts — confirmed via `git check-ignore`, not source)

$ grep -rn "ChatPremiumContext|PREMIUM_CONTEXT|McpLicenseGate|MCP_LICENSE_GATE|FeatureGate|FEATURE_GATE|bindLicenseReactivity|PRO_ONLY_" libs\backend
(zero hits)

$ grep -rln "FeatureGate|FEATURE_GATE|isPremium|PRO_ONLY_" apps --include=*.ts
apps/ptah-cli/src/di/container.smoke.spec.ts
apps/ptah-electron/src/di/container.smoke.spec.ts
apps/ptah-extension-vscode/src/di/container.smoke.spec.ts
apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts
apps/ptah-license-server/src/config/plans.config.ts
(noted per instructions — separate lane, not edited)
```

## Test run results

Individual: rpc-handlers 63/63 suites green (1319 passed + 2 pre-existing skips / 1321); vscode-lm-tools 35/35 suites (638/638); agent-sdk 61/61 suites (782/782); gateway-chat-bridge 2/2 suites (39/39); cli-agent-runtime 27/27 suites (398/398); agent-generation 23/23 suites (557/557); vscode-core 19/19 suites (281/281, after the rpc-handler.spec.ts fix).

Combined run: `npx nx run-many -t test -p rpc-handlers vscode-lm-tools agent-sdk gateway-chat-bridge cli-agent-runtime agent-generation vscode-core --skip-nx-cache` → **"Successfully ran target test for 7 projects"**, no failed tasks.

No pre-existing/unrelated failures were found in this scope. The 2 skipped tests in rpc-handlers are pre-existing `it.skip` markers unrelated to this purge.

## Out-of-scope notes (not edited, flagged only)

- `apps/*/container.smoke.spec.ts` (ptah-cli, ptah-electron, ptah-extension-vscode) and `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` reference `FeatureGate`/`FEATURE_GATE` — per instructions, apps/ is a separate lane and was not touched.
- `apps/ptah-license-server/src/config/plans.config.ts` references `isPremium`/`PRO_ONLY_` — license server plan config, separate lane, not touched.
- Unrelated uncommitted changes were observed under `apps/ptah-electron-e2e/**` and a stray malformed-path output file in the repo root at session start — these belong to a concurrent lane (B5.4, evidenced by `.ptah/specs/TASK_2026_163/batch5-4-report.md` already present) and were left untouched.
- `libs/shared/src/lib/types/rpc/rpc-misc.types.ts` still declares `isPremium: boolean` on the license-status response type — intentionally left as-is; it mirrors the KEPT `license-rpc.handlers.ts` response shape (a display convenience flag, not enforcement).

LANE B5.1 DONE
