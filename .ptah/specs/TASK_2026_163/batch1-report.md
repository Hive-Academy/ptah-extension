# Batch 1 Implementation Report — TASK_2026_163

**Executor**: backend-developer (sub-agent)
**Scope**: Core enforcement surgery (vscode-core + vscode-lm-tools + cli-agent-runtime + VS Code/Electron activation)
**Status**: COMPLETE — all 8 tasks IMPLEMENTED; production typecheck green on all 5 target projects.
**Git**: no commits made (team-leader owns commits).

---

## Per-Task Checklist

### B1.1 — Remove RPC license middleware ✅

`libs/backend/vscode-core/src/messaging/rpc-handler.ts`

- Deleted: `validateLicense()`, `isProOnlyMethod()`, `PRO_ONLY_METHOD_PREFIXES`, `PRO_ONLY_METHODS`, `LICENSE_EXEMPT_PREFIXES`, `RpcLicenseValidationResult` interface, the `LicenseService` constructor injection + `LicenseService`/`LicenseStatus` type imports, and the `validation` block inside `handleMessage()`.
- `ALLOWED_METHOD_PREFIXES` member tokens **byte-identical**; only the `'license:'` comment changed (`// License status for premium feature gating` → `// Ptah Builders membership status and key entry`).
- Class doc comment neutralized (removed "license middleware" description); constructor debug log `'Initialized with license middleware'` → `'Initialized'`.
- Barrel cleanup: removed `RpcLicenseValidationResult` type export from `src/messaging/index.ts` and `src/index.ts`.
- UNVERIFIED check: confirmed no additional tier branch inside `handleMessage()`.

### B1.2 — Delete FeatureGateService file ✅

Deleted `libs/backend/vscode-core/src/services/feature-gate.service.ts`.

### B1.3 — Remove FeatureGate registration/exports/token ✅

- `src/index.ts`: removed `FeatureGateService` export + `Feature`/`ProOnlyFeature` type export.
- `src/di/tokens.ts`: removed `FEATURE_GATE_SERVICE` symbol declaration + its entry in the `TOKENS` object.
- `src/di/register-platform-agnostic.ts`: removed the `FeatureGateService` import, the `registerSingleton(TOKENS.FEATURE_GATE_SERVICE, …)` call, and the `'FEATURE_GATE_SERVICE'` smoke-check log entry.

### B1.4 — Replace license-reactivity with license-free subsystem-bringup ✅

- Deleted directory `src/services/license-reactivity/` (`premium-subsystems.ts`, `license-reactivity-binder.ts`, `index.ts`).
- Created `src/services/subsystem-bringup.ts` exporting `bringUpSubsystems(deps)` + `SubsystemBringUpDeps`.
  - Kept MCP-server start + `ensureRegisteredForSubagents` + CLI skill/agent sync callbacks.
  - **Idempotency preserved**: `if (mcpService.getPort() !== null)` → "already running — skipping start".
  - **Per-subsystem non-fatal try/catch preserved** (MCP, skill sync, agent sync each isolated).
  - Removed: license re-verification, FeatureGate cache invalidation, teardown, event binding, `notify` callback.
- `src/index.ts`: replaced the 5 old reactivity exports with `bringUpSubsystems` + `SubsystemBringUpDeps`.

### B1.5 — Remove MCP tool-call license gate ✅

- Deleted `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/mcp-license-gate.ts` (`McpLicenseGate`, `MCP_LICENSE_GATE_TOKEN`, `evaluate`, `shouldGateAsPtahCli`, `PTAH_PRICING_URL`, `PRO_ONLY_MCP_TOOLS`, `GateResult`, `ProGate*`).
- `stdio-mcp-server.service.ts`: removed the gate import, the `licenseGate` constructor injection, the dispatch-time `evaluate()` call in `handleToolsCall()`, the `buildLicenseDeniedResponse()` method, and the `licenseGate` param of `createStdioMcpServer()`. Updated the "Phase 4 premium gate" header comment.
- `mcp-stdio/register.ts`: removed gate import + registration + re-export; also removed the now-unneeded `LICENSE_SERVICE` and `AGENT_PROCESS_MANAGER` prerequisite guards (they existed solely for the deleted gate); services log entry `['MCP_LICENSE_GATE','STDIO_MCP_SERVER']` → `['STDIO_MCP_SERVER']`.
- Barrels `mcp-stdio/index.ts` + `vscode-lm-tools/src/index.ts`: dropped all gate exports.

### B1.6 — Remove per-spawn premium check in agent-process-manager ✅

`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`

- `resolveMcpPort()`: removed the `getCachedStatus/verifyLicense` + `isPremium` block and the `if (!isPremium) return undefined` early-out. MCP port is now gated on server **health only**.
- Removed the now-unused `LicenseService` constructor injection + import (dead after the check was removed — extended removal, see deltas).
- Neutralized the catch log ("… (license check error)" → "… failed") and the method doc comment.

### B1.7 — Rewrite VS Code activation paths ✅

- `activation/bootstrap.ts`: removed `handleLicenseBlocking` import + the `if (!licenseStatus.valid) { … blocked: true }` branch. Activation always proceeds. Removed the `blocked` field from `BootstrapResult`; kept `verifyLicense()` (membership identity) and the E2E wizard-seed logic (`previousUserContext` seed at ExtensionMode.Test — confirmed it is seed, not gating). Neutralized doc comment + "(licensed user)" log.
- Deleted `activation/license-gate.ts` (whole file).
- `main.ts`: removed the `if (boot.blocked) return …` early return + stale interface comment.
- `activation/post-init.ts`: replaced `bindLicenseReactivity({… notify …})` with a single unconditional `await bringUpSubsystems({…})` call (no disposable, no `context.subscriptions.push`); deleted both "premium features activated"/"license expired" notifications. Kept the 24h membership `revalidate()` interval. Updated doc comment.
- `commands/license-commands.ts`: prompt `'Enter your Ptah premium license key'` → `'Enter your Ptah Builders key'`; success message `'License activated! … enable premium features.'` → `'Membership activated! … refresh your Ptah Builders status.'`.

### B1.8 — Rewrite Electron activation paths ✅

- `activation/post-window.ts`: removed the license-driven `initialView = cached.valid ? null : 'welcome'` override in the `get-startup-config` IPC handler (initial view now comes from base startup config). Removed both `license:verified`/`license:expired` `dialog.showMessageBox` nags; kept the 24h membership `revalidate()` interval. Removed the now-unused `dialog` import and `getMainWindow` destructure. Neutralized watcher log copy.
- `activation/wire-runtime.ts`: replaced `bindLicenseReactivity({… notify …})` with unconditional `await bringUpSubsystems({…})`; removed the `licenseReactivityDisposable` ref field (type + init) and its console notices.
- `main.ts` (electron): removed the `licenseReactivityDisposable` variable, its assignment from `wired.refs`, and its will-quit `dispose()` block.
- `activation/cli-agent-sync.ts`: updated doc comment `Pro/trial_pro-only` → `Runs for everyone`. Confirmed via grep the body holds **no** tier check (only the stale comment).

---

## Acceptance Grep Outputs (final state)

```
[1] rg "FeatureGate|featureGate|FEATURE_GATE" --glob '!**/*.spec.ts' apps libs
    → none

[2] rg "FeatureGate|featureGate|FEATURE_GATE" libs/backend/vscode-core/src --glob '!**/*.spec.ts'
    → ZERO (pass)

[3] rg "McpLicenseGate|MCP_LICENSE_GATE" libs/backend/vscode-lm-tools/src --glob '!**/*.spec.ts'
    → ZERO (pass)

[4] rg "validateLicense|PRO_ONLY_|LICENSE_EXEMPT_|RpcLicenseValidationResult" .../rpc-handler.ts
    → ZERO (pass)

[5] ALLOWED_METHOD_PREFIXES member tokens (comments stripped), HEAD vs working tree
    → IDENTICAL — only the 'license:' comment changed (comment-only, R1 satisfied)

[6] license-reactivity/ directory
    → GONE

[7] agent-process-manager.service.ts: isPremium|premium|isProTier|hasValidLicense|tier === 'pro'
    → ZERO (no gate around the spawn path)

[8] rg "bringUpPremiumSubsystems|tearDownPremiumSubsystems|bindLicenseReactivity|LicenseReactivityOptions|PremiumSubsystemsDeps" (whole repo)
    → No matches (all old reactivity symbols fully removed, incl. docs)
```

Note: root `CLAUDE.md` still contains the word "FeatureGate" once, in the monorepo architecture tree annotation (line ~31: "Logger, RpcHandler, License, FeatureGate"). Left untouched — repo-wide overview doc, outside Batch 1 file scope; flagged for a later docs pass. All `apps/` + `libs/` code and lib CLAUDE.md references are clean.

---

## Typecheck Result

```
npx nx run-many -t typecheck -p vscode-core vscode-lm-tools cli-agent-runtime ptah-extension-vscode ptah-electron
→ Successfully ran target typecheck for 5 projects  (GREEN)
```

Production code compiles on all five targets. (tsconfig.{lib,app}.json exclude `*.spec.ts`, so gating-assertion spec failures are naturally deferred to Batch 5 as intended.)

---

## Deltas Beyond the Task List (extended removals + UNVERIFIED confirmations)

1. **`libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts` (nominally B2.3) — done now, REQUIRED.**
   Removing the vscode-core `FeatureGateService` export/token (B1.2/B1.3) breaks its **only external consumer**, and both apps typecheck-compile `rpc-handlers` transitively — so the Batch 1 "5-project typecheck green" acceptance is impossible without this edit. Applied the exact B2.3 config-rpc ruling: removed the `FeatureGateService` import + `TOKENS.FEATURE_GATE_SERVICE` injection, and deleted the `isProTier()` gate on YOLO mode (`config:autopilot-toggle`). **YOLO mode is now unconditional; the DANGEROUS-mode warning log is kept.** Confirmed by re-running the full 5-project typecheck → green. Team-leader/Batch 2: this file's config-rpc portion is DONE; do not re-do it in B2.3.

2. **`apps/ptah-electron/src/activation/bootstrap.ts:203-234` — the SOURCE of the Electron welcome lockout.**
   The plan cited only `post-window.ts:95-123`, but the base `startupInitialView='welcome'` is computed here (`if (!licenseStatus.valid) { startupIsLicensed=false; startupInitialView='welcome' }`). Extended removal: kept `verifyLicense()` (primes the membership cache for the membership card) but deleted the welcome-lockout assignment; `startupIsLicensed`/`startupInitialView` are now `const true`/`const null`. Signed-out Electron now boots straight to the app (webview default `'chat'`). The `startupIsLicensed`/`startupInitialView` **fields** remain on the plumbing for Batch 3a to remove.

3. **`agent-process-manager.service.ts` — removed the now-unused `LicenseService` injection + import** (not just the check). It became dead code once the premium gate was deleted; removal-means-removal.

4. **`mcp-stdio/register.ts` — removed the `LICENSE_SERVICE` + `AGENT_PROCESS_MANAGER` prerequisite guards.** They existed only to satisfy the deleted `McpLicenseGate`'s dependencies; the stdio MCP server now needs only `LOGGER` + `PTAH_API_BUILDER`.

5. **`blocked` / `licenseReactivityDisposable` plumbing removed** from both apps' `main.ts` + `BootstrapResult`/`WireRuntimeResult` (dead after the reactivity binder and blocking branch were deleted).

6. **Stale doc/comment cleanup (no runtime impact):** `libs/backend/vscode-core/CLAUDE.md` (public-API/structure/key-files lists), and the `FEATURE_GATE_SERVICE` mentions in `apps/ptah-extension-vscode/src/di/phase-1-infra.ts` + `apps/ptah-electron/src/di/phase-1-infra.ts` doc comments.

### UNVERIFIED sites — confirmations

- **`license.service.ts` full body**: NOT touched (kept per plan). `isPremiumTier()` still exported (Batch 2 removes it). No enforcement branch removed here.
- **`bootstrap.ts:61-65` wizard-seed shape (VS Code)**: confirmed it is the E2E `previousUserContext` seed (gated on `ExtensionMode.Test && PTAH_E2E==='1'`) — seed, not gating. Preserved verbatim.
- **`stdio-mcp-server.service.ts` gate call sites**: located at `handleToolsCall()` (dispatch `evaluate` + denied-response) + constructor + `createStdioMcpServer`; all removed.
- **`cli-agent-sync.ts` (Electron) tier check**: confirmed NO tier logic in the body — only a stale doc comment, now updated.

### Out-of-scope consumers verified safe (not in typecheck target list)

- `apps/ptah-cli/src/cli/commands/mcp-serve.ts` uses only `registerMcpStdioServices` + `STDIO_MCP_SERVER_TOKEN` (both still exported) — unaffected by the gate removal.
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/SKILL.md` mentions `PTAH_PRICING_URL`/`PRO_ONLY_MCP_TOOLS` — runtime-downloaded plugin markdown asset (not compiled); left untouched (out of Batch 1 scope).
