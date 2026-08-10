# Development Tasks — TASK_2026_163

Purge premium feature gating (open-source move) + in-app Builders promotion.

**Total Tasks**: 34 | **Batches**: 5 | **Status**: 5/5 complete — B5.5 verification open, delegated to e2e coverage (Batch 1 ✅ 2026-07-18; Batch 2 ✅ incl. B2.3 residue commit `1f89d7c5d`; Batch 3 ✅ 2026-07-19 — commits `c11282e03`/`850cd979c`/`9cde48458`; Batch 4 ✅ 2026-07-19 — Lane 4a `a317d5aa3`, Lane 4b `e349b7f2b`; Batch 5 ✅ 2026-07-19 — commits `338ad25f3`/`025d1e83a`/`ea825970d`/`2d677e897`. Single open gate item: B5.5 verification — see "Close-out (2026-08-10)" at the end of this file)
**Source of truth**: `implementation-plan.md` (user-APPROVED as written) — this file adds per-task granularity only; it does not re-decide any ruling.
**Dependency order (strict)**: Batch 1 → Batch 2 → Batch 3 (3 parallel lanes) → Batch 4 (2 parallel lanes, after Batch 3 lands) → Batch 5 (last).

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS (all risks pre-identified by architect in §5 Risk Register; no BLOCKERs; no plan revision required).

### Assumptions Verified (by architect via Grep; bodies UNVERIFIED where noted)

- Premium gating is concentrated in 5 enforcement layers (RPC middleware, FeatureGateService, activation gates, MCP tool-call gate, `isPremium` plumbing) — cited `file:line` in §1.
- License server + WorkOS + Paddle stack is KEPT and repurposed as "Ptah Builders" membership identity — never deleted, only disconnected from enforcement (context.md, §2F).
- `isPremium` is consumed only in enable/disable style branches (`sdk-query-options-builder.ts`, `chat-premium-context.service.ts`), so deletion → unconditional behavior is safe (§2C).

### Risks Carried From §5 (tracked to Batch 5 resolution)

| #   | Risk                                                                                                    | Severity | Mitigation → Batch/Task                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `ALLOWED_METHOD_PREFIXES` (rpc-handler.ts:44) must stay byte-identical (injection guard, not gating)    | HIGH     | B1.1 acceptance pins it; reviewer diffs constant explicitly                                                                     |
| R2  | Frontend/CLI handlers of `LICENSE_REQUIRED`/`PRO_TIER_REQUIRED`/`license_required` become dead branches | MED      | B3a/B3b/B3c grep + delete branches; CLI keeps `license_required` only for invalid-key on `license set`                          |
| R3  | Unconditional subsystem bring-up (MCP + CLI syncs start for everyone)                                   | MED      | B1.4 preserves idempotency + per-subsystem non-fatal try/catch; B5 cold-profile smoke                                           |
| R4  | Gating-assertion tests go red mid-task                                                                  | MED      | B1–B4 gate on production typecheck ONLY; B5 owns full suite; no merge to main before B5 green                                   |
| R5  | VS Code Marketplace trademark rules (CLAUDE.md BLOCKING) must not be violated                           | HIGH     | Builders card TS-only + neutral copy; reviewer checklist on every batch touching apps/ptah-extension-vscode                     |
| R6  | TASK_2026_162 overlap on `app.routes.ts` + `pages/profile/*`                                            | MED      | B4b touches ONLY guard imports, canActivate arrays, `/trial-ended` route, trial-ended components; flag in PR, coordinate rebase |
| R8  | One-way door: a partial purge (e.g. `PRO_ONLY_METHOD_PREFIXES` left populated) breaks OSS promise       | HIGH     | Per-batch acceptance greps are the enforcement; code-review re-runs them                                                        |
| R9  | UNVERIFIED site bodies may hide extra enforcement branches                                              | HIGH     | UNVERIFIED-SITE PROTOCOL below — mandatory for every executor                                                                   |

### UNVERIFIED-SITE PROTOCOL (mandatory — applies to every task in every batch)

Direct `Read` was declined in the architect's session, so several site bodies are marked **UNVERIFIED**. Before editing ANY file, each executor MUST:

1. **Read/grep its own files first** — do not trust line numbers blindly; confirm the cited symbol/branch still exists at (or near) the cited line.
2. **Extend removal** to ANY additional gating branch found in the same file — any `isPremium | tier === 'pro' | trial | isProTier | hasValidLicense`-style enforcement branch — even if not enumerated here.
3. **Report deltas** back to team-leader in the implementation report: every site touched beyond this task list, and every UNVERIFIED assumption that turned out different from the plan.
4. **Removal means removal** (§2 legend): delete completely — no `_var` renames, no `// removed` comments, no compat shims.

UNVERIFIED sites flagged by §5/R9: `license.service.ts` full body, `welcome.component.ts`, `settings.component.ts:210` link mechanism, `stdio-mcp-server.service.ts` gate call sites, `cli-agent-sync.ts` tier check, `electron-shell.component.ts:267` gate target, profile-page trial-ended modal mount, `LicenseSection.tsx` content, `bootstrap.ts:61-65` wizard-seed shape.

---

## Batch 1 — Core enforcement surgery (vscode-core + activation, coupled) ✅ COMPLETE

**Verified by team-leader (MODE 2), 2026-07-18** — all acceptance greps re-run independently (file deletions confirmed; `ALLOWED_METHOD_PREFIXES` byte-identical except :59 comment; `subsystem-bringup.ts` idempotency + per-subsystem try/catch confirmed; no `bindLicenseReactivity` / `FeatureGate` production symbol). **Commit deferred** until user requests (not committed).
**Deltas accepted**: (a) `config-rpc.handlers.ts` FeatureGate removal pulled forward from B2.3 — REQUIRED (sole consumer; typecheck acceptance impossible without it) → B2.3 config-rpc portion is DONE, do not redo. (b) Electron `bootstrap.ts` welcome-lockout source removed per R9 protocol (plan cited only post-window.ts) — correct; `startupIsLicensed`/`startupInitialView` fields left for Batch 3a. Note: root `CLAUDE.md` retains one "FeatureGate" mention (architecture tree) — out of scope, deferred to a docs pass.

**Recommended Executor**: sub-agent `backend-developer`
**Fallback Executor**: sub-agent `software-architect` (if coupling across DI/RPC/activation needs re-planning)
**Execution Mode**: sequential (one developer, one commit-series)
**Rationale**: Coupled refactor across DI wiring, RPC middleware, and three activation paths on three runtimes — requires judgment about what is gating vs. legitimate membership/seed logic; not parallel-eligible (shared files, ordered dependencies).
**Tasks**: 8 | **Dependencies**: None

### Task B1.1: Remove RPC license middleware ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts`
**Spec Reference**: implementation-plan.md §2A row 1 (rpc-handler.ts:256-263, :111-128, :139-145, :153-163, :180-181, :393-453)
**Ruling**: REWRITE.

- DELETE `validateLicense` (:393-453), `PRO_ONLY_METHOD_PREFIXES` (:111-114), `PRO_ONLY_METHODS` (:128), `LICENSE_EXEMPT_PREFIXES` (:139-145), `RpcLicenseValidationResult` (:153-163), the `LicenseService` constructor dependency (:180-181), and the `validation` block inside `handle()` (:256-263).
- KEEP `ALLOWED_METHOD_PREFIXES` (:44) **byte-identical** — injection-attack guard, NOT gating (R1).
- KEEP the `'license:'` prefix (:59) but fix its comment (currently "for premium feature gating" → neutral membership wording).
  **Validation Notes**: R1 (do not touch `ALLOWED_METHOD_PREFIXES`), R8 (leave no populated PRO*ONLY*\* constant behind). UNVERIFIED: confirm no additional tier branch inside `handle()`.
  **Acceptance**: `ALLOWED_METHOD_PREFIXES` diff shows only the :59 comment change; no `validateLicense|PRO_ONLY_|LICENSE_EXEMPT_|RpcLicenseValidationResult` symbol remains in the file.

### Task B1.2: Delete FeatureGateService file ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts`
**Spec Reference**: §2A row 2 (:30 `ProOnlyFeature`, :58 `PRO_ONLY_FEATURES`, :102 class)
**Ruling**: REMOVE file entirely.
**Dependencies**: none (do B1.3 in same pass to keep typecheck green).
**Acceptance**: file no longer exists.

### Task B1.3: Remove FeatureGate registration/exports/token ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts` (:81 export)
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (:91, :226)
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\register-platform-agnostic.ts` (:19 import, :68 registration, :98 smoke-check entry)
  **Spec Reference**: §2A row 3
  **Ruling**: REMOVE export, both token declarations, the registration, and the smoke-check entry.
  **Dependencies**: Task B1.2.
  **Validation Notes**: also remove `config-rpc.handlers.ts` FeatureGate dependency — but that lives in Batch 2 (§2C rpc-handlers cluster); here only remove the vscode-core-side registration/token/export.
  **Acceptance**: `grep -rn "FeatureGate\|featureGate\|FEATURE_GATE" libs/backend/vscode-core/src` → zero hits (spec files excluded, handled in Batch 5).

### Task B1.4: Replace license-reactivity directory with license-free `subsystem-bringup.ts` ✅ COMPLETE

**Files**:

- DELETE `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license-reactivity\` (premium-subsystems.ts, license-reactivity-binder.ts, index.ts)
- CREATE `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\subsystem-bringup.ts` exporting `bringUpSubsystems(deps)`
  **Spec Reference**: §2A row 4 (premium-subsystems.ts:85 `bringUpSubsystems`/re-verify :89-115, :118-176 MCP+CLI sync logic, :183-196 cache invalidation, :214 teardown; binder.ts:58 `bindLicenseReactivity`)
  **Ruling**: REWRITE → replace directory. Keep the MCP-server start + CLI skill/agent sync logic (premium-subsystems.ts:118-176) MINUS license re-verification (:89-115), MINUS FeatureGate cache invalidation (:183-196), MINUS teardown (:214), MINUS event binding. Called once, unconditionally, at activation on each platform. Delete `bindLicenseReactivity`, `tearDownPremiumSubsystems`, `LicenseReactivityOptions`.
  **Validation Notes**: R3 — PRESERVE idempotency ("already running — skipping", premium-subsystems.ts:128) and per-subsystem non-fatal try/catch in the new function. Update the vscode-core `src/index.ts` export to surface `bringUpSubsystems` instead of the old reactivity exports.
  **Acceptance**: new function has no license/tier/premium reference; idempotency + per-subsystem try/catch retained; `license-reactivity/` directory gone.

### Task B1.5: Remove MCP tool-call license gate ✅ COMPLETE

**Files**:

- DELETE `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\mcp-license-gate.ts` (:32 `MCP_LICENSE_GATE_TOKEN`, :70 class, :93 `evaluate`, :165 `shouldGateAsPtahCli`)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.ts` (dispatch-time evaluation call sites)
- DI registration wherever `MCP_LICENSE_GATE_TOKEN` is registered
  **Spec Reference**: §2A row 6
  **Ruling**: REMOVE file + token + all dispatch-time `evaluate` call sites + DI registration.
  **Validation Notes**: UNVERIFIED exact lines in `stdio-mcp-server.service.ts` — grep `McpLicenseGate|MCP_LICENSE_GATE` across `libs/backend/vscode-lm-tools` first, remove every hit. R9.
  **Acceptance**: `grep -rn "McpLicenseGate\|MCP_LICENSE_GATE" libs/backend/vscode-lm-tools/src` → zero hits (spec excluded).

### Task B1.6: Remove per-spawn premium check in agent-process-manager ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (:1351-1356)
**Spec Reference**: §2A row 7
**Ruling**: REMOVE the premium check before ptah-cli agent spawn; spawn allowed for everyone.
**Validation Notes**: confirm no companion tier branch nearby (R9).
**Acceptance**: no premium/tier/license gate remains around the spawn path in this file.

### Task B1.7: Rewrite VS Code activation paths ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\activation\bootstrap.ts` (:21 import, :61-82 verifyLicense + blocking branch)
- DELETE `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\activation\license-gate.ts` (whole file)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\activation\post-init.ts` (:7, :38-51 `bindLicenseReactivity` + notifications)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\commands\license-commands.ts` (:61, :87 copy)
  **Spec Reference**: §2B rows 1-4
  **Rulings**:
- bootstrap.ts REWRITE: delete the blocking branch + the `handleLicenseBlocking` import (:21). Activation always proceeds. **KEEP** wizard-seed logic at :61-65 (seed, not gating) — UNVERIFIED exact shape, preserve behavior.
- license-gate.ts REMOVE (file).
- post-init.ts REWRITE: replace with one unconditional `bringUpSubsystems(...)` call (from B1.4); delete both "premium features activated"/"license expired" notifications.
- license-commands.ts REPOINT: commands stay (membership key entry); reword copy → "Enter your Ptah Builders key", "Membership activated".
  **Validation Notes**: R5 (this app is marketplace-scanned — neutral copy only, no trademarked AI names in non-JS; do not touch `.vscodeignore` / `package.json contributes.configuration`). R9 (bootstrap seed shape).
  **Acceptance**: VS Code activates fully with no license key present; no lockout view reachable; `license-gate.ts` gone.

### Task B1.8: Rewrite Electron activation paths ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\post-window.ts` (:95-123 license-driven `initialView='welcome'`, :253-269 premium/expired dialogs)
- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts` (:842-853 `bindLicenseReactivity` + console notices)
- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\cli-agent-sync.ts` (:16 Pro/trial gating comment/behavior)
  **Spec Reference**: §2B rows 5-8
  **Rulings**:
- post-window.ts REMOVE the license branch (initialView always from base startup config) + REMOVE both dialogs (:253-269) and surrounding license-watcher dialog wiring (no nags). Keep any non-dialog cleanup only if not premium teardown.
- wire-runtime.ts REWRITE: unconditional `bringUpSubsystems(...)` at startup; delete notices.
- cli-agent-sync.ts REWRITE: sync runs for everyone; update doc comment. UNVERIFIED whether it holds its own tier check — grep `isPremium|tier` in that file and remove if present (R9).
  **Validation Notes**: R3 (bring-up idempotency), R9.
  **Acceptance**: Electron launches with no license key → full app, no welcome lockout, no premium/expiry dialogs.

**Commit plan (Batch 1)** — conventional commits, one series (team-leader commits after APPROVED review):

- `refactor(vscode-core): remove RPC license middleware and FeatureGateService`
- `refactor(vscode-core): replace license-reactivity with unconditional subsystem bring-up`
- `refactor(vscode-lm-tools): remove MCP tool-call license gate`
- `refactor(cli-agent-runtime): drop per-spawn premium check`
- `refactor(activation): remove license lockout from vscode + electron boot`

**Batch 1 Verification (run BEFORE marking complete)**:

- No `FeatureGate`/`featureGate` symbol outside spec files (specs → Batch 5).
- `ALLOWED_METHOD_PREFIXES` byte-identical except the :59 comment.
- All three runtimes activate fully with **no license key present** (MCP server + CLI syncs come up unconditionally); no lockout view reachable.
- Production typecheck green: `npx nx affected -t typecheck` for vscode-core, vscode-lm-tools, cli-agent-runtime, and both apps (spec failures tolerated until Batch 5).

---

## Batch 2 — `isPremium` plumbing removal (shared-type ripple, coupled) ✅ COMPLETE

**Verified by team-leader (MODE 2), 2026-07-19** — batch2-verification.md: 7/8 tasks clean at first pass; B2.3 rejected on doc/naming residue (`chat-rpc.handlers.ts:7` doc, `gateway-chat-bridge.ts:313` doc, `resolvePremiumContext`/`PremiumSessionContext` naming). Residue swept by orchestrator same day (renamed → `resolveSdkContext`/`SdkSessionContext`); step-3 grep re-run → zero production hits; diagnostics clean. B2.9 DEFERRED to Batch 5. **B2.3 residue committed 2026-07-19 as `1f89d7c5d`** (rode with the Batch 3 commit series); step-3 grep confirmed zero non-spec hits before commit.

**Team-leader verification 2026-07-19 (MODE 2)** — all acceptance greps re-run independently. B2.1/B2.2/B2.4/B2.5/B2.6/B2.7/B2.8 verified clean; B2.9 confirmed DEFERRED-TO-B5 (only `isPremiumTier` definition at `license.service.ts:50` + export at `index.ts:69`; no production caller). **B2.3 REJECTED**: rename is functionally complete (symbols/token/file all renamed, no `PREMIUM_CONTEXT`), but two stale `ChatPremiumContextService` doc-comment references remain (`chat-rpc.handlers.ts:7` — an explicitly enumerated B2.3 doc edit — and `gateway-chat-bridge.ts:313`), plus premium-named method `resolvePremiumContext(` at `gateway-chat-bridge.ts:317`. See `batch2-verification.md`. Batch NOT complete until B2.3 doc/naming residue cleared.

**⚠️ Pre-done in Batch 1**: the `config-rpc.handlers.ts` portion of Task B2.3 (FeatureGateService import + `TOKENS.FEATURE_GATE_SERVICE` injection removed; `isProTier()` gate on `config:autopilot-toggle`/YOLO mode deleted → YOLO now unconditional, DANGEROUS-mode warning log kept) was already applied and typecheck-verified in Batch 1 (delta a). **Do NOT redo the config-rpc handler.** All other B2.3 sites (the `ChatPremiumContextService`→`ChatSdkContextService` rename and remaining handler/caller edits) are still PENDING.

**Recommended Executor**: sub-agent `backend-developer`
**Fallback Executor**: sub-agent `software-architect`
**Execution Mode**: sequential
**Rationale**: One shared-type change (`isPremium?` fields in `agent-adapter.types.ts`) ripples through 7 backend libs — must be one coherent compiler-driven pass; not parallel-eligible (shared type is the hub, all lanes converge on it).
**Tasks**: 9 | **Dependencies**: Batch 1 (removes `isPremiumTier` consumers in vscode-core so the tail delete is clean)

### Task B2.1: Delete shared `isPremium` fields ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-adapter.types.ts` (:102, :146, :171)
**Spec Reference**: §2C shared-types cluster
**Ruling**: REWRITE — delete all three `isPremium?: boolean` fields. This is the hub change; do it first, then let the compiler surface every downstream site.
**Acceptance**: no `isPremium` field in this file; downstream compile errors enumerate the ripple set.

### Task B2.2: Purge `isPremium` from agent-sdk (8 files) ✅ COMPLETE

**Files** (all under `D:\projects\ptah-extension\libs\backend\agent-sdk\src\`):

- `sdk-query-options-builder.ts` (:192,242,250,256,297,523,588,638-639,663,972-1044,1071-1099 — remove param + all `if (isPremium)` branches; `mcpEnabled` governed ONLY by `mcpServerRunning`)
- `sdk-agent-adapter.ts` (:430-707), `sdk-query-runner.service.ts` (:78,152,256,340,400-404), `session-lifecycle-manager.ts` (:133,216,501), `session-lifecycle/session-query-executor.service.ts` (:84,174), `internal-query/internal-query.types.ts` (:47) + `internal-query.service.ts` (:23), `curator-llm-adapter/sdk-internal-query.curator-llm.ts` (:154)
  **Spec Reference**: §2C agent-sdk cluster
  **Ruling**: REWRITE — remove param/field + branches; formerly-premium behavior becomes unconditional.
  **Validation Notes**: R9 — confirm every branch is enable/disable style; if a branch does real gating beyond MCP/prompt/plugin, report before flattening.
  **Acceptance**: `grep -rn "isPremium" libs/backend/agent-sdk/src` → zero hits (specs excluded).

### Task B2.3: Rename ChatPremiumContextService → ChatSdkContextService + purge rpc-handlers (~14 files) ✅ COMPLETE (residue swept 2026-07-19: doc refs + `resolveSdkContext`/`SdkSessionContext` rename; acceptance grep zero)

**Files** (under `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\`):

- RENAME `chat/session/chat-premium-context.service.ts` → `chat-sdk-context.service.ts` / `ChatSdkContextService` (drop `isPremium` params :52-54, :84-85; service keeps enhanced-prompt + plugin-path resolution + MCP probe)
- `chat/di.ts` (:26,:38), `chat/tokens.ts` (:11 `PREMIUM_CONTEXT`→`SDK_CONTEXT`), `chat/session/index.ts` (:7), `handlers/chat-rpc.handlers.ts` (:7 doc)
- Callers: `chat/session/chat-session.service.ts` (:342-361,475-477,896-936), `chat/session/chat-slash-command-router.service.ts` (:120-141), `chat/ptah-cli/chat-ptah-cli.service.ts` (:83-154) — delete `isPremiumTier` computation, resolve prompts/plugins unconditionally
- `handlers/enhanced-prompts-rpc.handlers.ts` (:229-236,481-488 — delete "upgrade to Pro" errors)
- `handlers/setup-rpc.handlers.ts` (:127-130,282-345 — delete `isPremium` resolution + `resolvePluginPaths` guard; error :316 → "MCP server required…" only)
- `handlers/wizard-generation-rpc.handlers.ts` (:147-150,335-420)
- ~~`handlers/config-rpc.handlers.ts` (:14,:86,:301 — remove FeatureGateService dependency + `isProTier()` branch; pro path unconditional)~~ ✅ DONE in Batch 1 (delta a) — do NOT redo
- `handlers/license-rpc.handlers.ts` — **KEEP** handler + response shape (:320-358) so portal/CLI/TUI keep compiling; update doc comments (:48,:67,:311) only
  **Spec Reference**: §2C rpc-handlers cluster
  **Ruling**: RENAME + REWRITE as above.
  **Validation Notes**: R2 (delete "upgrade to Pro" error branches), R8 (no leftover pro path), R9.
  **Acceptance**: no `isPremium`/`isProTier`/"upgrade to Pro" in rpc-handlers except `license-rpc.handlers.ts` response shape; rename complete (no `ChatPremiumContext`/`PREMIUM_CONTEXT` symbol left).

### Task B2.4: Purge `isPremium` from agent-generation (9 files) ✅ COMPLETE

**Files** (under `D:\projects\ptah-extension\libs\backend\agent-generation\src\`):

- `services/wizard/multi-phase-analysis.service.ts` (:126-142,379-433), `agentic-analysis.service.ts` (:145-183) — drop `isPremium` requirement, KEEP `mcpServerRunning` requirement
- `orchestrator.service.ts` (:97,193,257,730), `content-generation.service.ts` (:271), `enhanced-prompts/enhanced-prompts.service.ts` (:67,296,676,710), `interfaces/content-generation.interface.ts` (:22), `types/multi-phase.types.ts` (:63), `agent-customization.service.ts` (:183) — delete field/param
  **Spec Reference**: §2C agent-generation cluster
  **Ruling**: REWRITE.
  **Acceptance**: `grep -rn "isPremium" libs/backend/agent-generation/src` → zero hits (specs excluded); analysis still gated on `mcpServerRunning` only.

### Task B2.5: Purge `isPremium` from gateway-chat-bridge ✅ COMPLETE (isPremium/isPremiumTier gone; NOTE: stale `ChatPremiumContextService` doc + `resolvePremiumContext` method name flagged under B2.3 residue sweep)

**File**: `D:\projects\ptah-extension\libs\backend\messaging-gateway\...\gateway-chat-bridge.ts` (:24,83,325-376,445-494)
**Spec Reference**: §2C gateway-chat-bridge cluster
**Ruling**: REWRITE — delete `isPremiumTier` import, `isPremium` field + resolution; resolve enhanced prompts/plugins unconditionally.
**Validation Notes**: confirm exact path via grep (plan cites bare filename). R9.
**Acceptance**: no `isPremium`/`isPremiumTier` in the bridge file.

### Task B2.6: Purge `isPremium` from cli-agent-runtime (2 files) ✅ COMPLETE

**Files** (under `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\`):

- `ptah-cli/helpers/ptah-cli-spawn-options.service.ts` (:15,43,88-216 — delete license check; resolve prompts/plugins unconditionally)
- `ptah-cli/ptah-cli-registry.ts` (:591 passthrough — delete)
  **Spec Reference**: §2C cli-agent-runtime cluster
  **Ruling**: REWRITE.
  **Acceptance**: `grep -rn "isPremium" libs/backend/cli-agent-runtime/src` → zero hits (specs excluded).

### Task B2.7: Remove `isPremium` field via skill-synthesis interface change (5 files) ✅ COMPLETE

**Files** (under `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\`):

- `internal-query.interface.ts` (:16), and field-deletion ripple in `skill-judge.service.ts` (:102), `skill-enhancer.service.ts` (:430), `skill-curator.service.ts` (:259), `skill-synthesizer.service.ts` (:122)
  **Spec Reference**: §2C skill-synthesis cluster
  **Ruling**: REWRITE — delete field from interface; downstream sites drop the field.
  **Acceptance**: no `isPremium` in skill-synthesis src (specs excluded).

### Task B2.8: Remove `isPremium` from cron-scheduler ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\cron-scheduler\...\job-runner.ts` (:216 `isPremium: false`)
**Spec Reference**: §2C cron-scheduler cluster
**Ruling**: REWRITE — delete the field (falls out with the type change).
**Acceptance**: no `isPremium` in job-runner.ts.

### Task B2.9: Delete `isPremiumTier()` tail from vscode-core ⏸️ DEFERRED → Batch 5 (spec files still consume it; only definition `license.service.ts:50` + export `index.ts:69` remain, no production caller — verified 2026-07-19)

**Files**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts` (:50 `isPremiumTier()`)
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts` (its export)
  **Spec Reference**: §2C vscode-core (tail) + §2A row 5
  **Ruling**: REMOVE `isPremiumTier()` + its export ONCE all consumers (B2.2-B2.8) are gone. **KEEP** the rest of LicenseService (membership identity: status/key entry, verify, events, broadcaster). KEEP `license:verified`/`license:expired` events.
  **Validation Notes**: R9 — UNVERIFIED full body; confirm no other enforcement branch beyond :215 reason mapping (which is status reporting → KEEP). Do this task LAST in the batch.
  **Acceptance**: `grep -rn "isPremiumTier" libs/backend libs/shared` → zero hits; LicenseService still compiles and exposes status/key APIs.

**Commit plan (Batch 2)**:

- `refactor(shared): drop isPremium fields from agent-adapter types`
- `refactor(agent-sdk): make MCP/prompt/plugin wiring unconditional`
- `refactor(rpc-handlers): rename ChatPremiumContext to ChatSdkContext, remove tier gates`
- `refactor(agent-generation): gate analysis on mcpServerRunning only`
- `refactor(gateway,cli-agent-runtime,skill-synthesis,cron-scheduler): drop isPremium plumbing`
- `refactor(vscode-core): remove isPremiumTier from license service`

**Batch 2 Verification**:

- `grep -r "isPremium" libs/backend libs/shared` returns **only** `license-rpc.handlers.ts` (response shape), license wire types (`plan?.isPremium`), and license-server files.
- `grep -r "isPremiumTier" libs libs/shared` → zero hits.
- Enhanced prompts, plugin paths, MCP wiring, wizard analysis all run with no tier input.
- No backend error message containing "premium"/"upgrade to Pro".
- Production typecheck green across affected projects.

---

## Batch 3 — Frontend purge + repoint (three parallel lanes, file-disjoint) ✅ COMPLETE

**Verified + committed by team-leader (MODE 2), 2026-07-19** — all lane acceptance greps re-run independently (specs excluded per R4); every remaining `'welcome'`/`isLicensed`/`premium`/`upgrade`/`LICENSE_REQUIRED`/`PRO_TIER_REQUIRED`/`ChatPremiumContext` hit is in a `.spec.ts` file (Batch 5). R5 spot-check clean (no trademarked names added to vscode non-JS). `license.ts` + `license_required` wire enum untouched. Pre-commit hook (lint-staged + `ptah-electron:validate-deps` full backend build) passed on every commit. See `batch3-verification.md`.
**Commits**: B2.3 residue `1f89d7c5d` · Lane 3a `c11282e03` · Lane 3b `850cd979c` · Lane 3c `9cde48458`.

**Execution Mode**: parallel (3 lanes, file-disjoint per §4).
**Dependencies**: Batch 2 (backend no longer emits premium errors/fields the frontend keys off).
**Parallel-eligibility check**: PASS — 3a (chat/chat-ui/webview shells) · 3b (setup-wizard/marketplace) · 3c (CLI/TUI copy) write to disjoint file trees, no shared mutable state, each self-describable.
**Orchestrator note**: 3a is a sub-agent lane; 3b and 3c are CLI-agent lanes — spawn all three concurrently; CLI agents do NOT commit (team-leader commits after review).

### Lane 3a — chat / chat-ui / webview shells (coupled) ✅ COMPLETE (commit `c11282e03`)

**Recommended Executor**: sub-agent `frontend-developer`
**Rationale**: Coupled Angular refactor across shells + webview view-plumbing; needs judgment on what each `@if (isPremium())` gate protects.

#### Task B3a.1: Delete trial/upsell chat-ui components + exports ✅ COMPLETE

**Files**:

- DELETE `libs\frontend\chat-ui\src\lib\molecules\trial-ended-modal.component.ts` (:148), `trial-banner.component.ts` (:73), `community-upgrade-banner.component.ts` (:93)
- `libs\frontend\chat-ui\src\index.ts` (:40,:43,:44 exports), `libs\frontend\chat\src\lib\components\index.ts` (:122-124 re-exports), `libs\frontend\chat-ui\CLAUDE.md` (:18 mention)
  **Ruling**: REMOVE all three components + exports + re-exports; update CLAUDE.md mention.
  **Acceptance**: components + exports gone; no dangling import.

#### Task B3a.2: Rewrite app-shell + electron-shell (remove modal/banner/gates) ✅ COMPLETE

**Files**:

- `libs\frontend\chat\src\lib\components\templates\app-shell.component.html` (:9-11 modal, :576-580 banner, :506 `@if (isPremium())`), `app-shell.component.ts` (:38,110 imports, :289-293 `licenseReason`/`isPremium` computeds)
- `libs\frontend\chat\...\electron-shell.component.ts` (:267 nav gate, :301-305 banner, :554-555 computed)
  **Ruling**: REWRITE — delete modal/banner usage + imports + computeds; **un-gate** the :506 and :267 blocks (render unconditionally). UNVERIFIED what :506/:267 gate — confirm premium-only affordance, then make unconditional (R9).
  **Acceptance**: no trial/banner/modal usage; former gated blocks render unconditionally.

#### Task B3a.3: Delete license-blocked welcome view + view plumbing ripple ✅ COMPLETE

**Files**:

- DELETE `libs\frontend\chat\src\lib\components\templates\welcome.component.ts` + `.html` (:47,93-105,228-238 license lockout)
- `apps\ptah-extension-webview\src\app\app.ts` (:97-119 VALID_VIEWS)
- `apps\ptah-extension-vscode\src\services\webview-html-generator.ts` (:13,:124-126,:426-427 VALID_VIEWS/`isLicensed`)
- `apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts` (:109-167)
- `apps\ptah-electron\src\preload.ts` (:19,:47 welcome/`isLicensed`)
- view routing in `libs\frontend\core` app-state
  **Ruling**: REMOVE welcome view (its only purpose is lockout); remove every `'welcome'` routing branch + `isLicensed` config. UNVERIFIED — grep `'welcome'` across webview + `libs/frontend/core` and remove each branch (R9).
  **Validation Notes**: R5 (vscode app is marketplace-scanned — neutral only), R9.
  **Acceptance**: `grep -rn "'welcome'\|isLicensed" apps\ptah-extension-webview apps\ptah-extension-vscode apps\ptah-electron libs\frontend\core` → no lockout routing/config remains; webview boots with no `isLicensed` dependency.

#### Task B3a.4: Rewrite settings + repoint license-status-card to membership card ✅ COMPLETE

**Files**:

- `libs\frontend\chat\src\lib\settings\settings.component.ts` (:110-136 `isPremium` computed, :210 openPricing) + `.html` (:35,:122,:192-266 upsell blocks)
- `libs\frontend\chat\src\lib\settings\license\license-status-card.component.ts` (:105-328 trial/CTA, :440-553 computeds)
  **Ruling**:
- settings REWRITE: delete `isPremium` gating; provider config + enhanced-prompts sections render for everyone; delete both upsell blocks (html:192-266). Keep the `openPricing`-style method (:210) ONLY if reused by the membership card / Builders link (Batch 4 reuses it — preserve the external-open mechanism); otherwise delete.
- license-status-card REPOINT → **Builders membership card**: keep sign-in/status/key-entry/user identity; delete trial-countdown UI, `trial_ended` lockout messaging, all "Upgrade to Pro" CTAs; link target → Builders/membership page; delete trial computeds that lose all consumers.
  **Validation Notes**: R2, R9 (UNVERIFIED :210 link mechanism — Batch 4 Builders card must reuse it, so preserve/document the exact command/RPC path).
  **Acceptance**: settings shows all sections signed-out; membership card shows status with no upgrade CTAs.

#### Task B3a.5: Rewrite chat-empty-state (remove upgrade badge/gate) ✅ COMPLETE

**File**: `libs\frontend\chat\...\setup-plugins\chat-empty-state.component.ts` (:179-190,207,374-410)
**Ruling**: REWRITE — delete `isPremium` computed + upgrade badge; setup/skills affordances available to everyone. KEEP `chat-lifecycle.service.ts:46-120` `licenseStatus` signal + `chat.store.ts:98` (feeds membership card) per §2D.
**Acceptance**: no upgrade badge / premium gate; empty-state actions unconditional.

**Lane 3a Acceptance**: no trial/upgrade/lockout surface renders; settings shows all sections signed-out; membership card shows status without upgrade CTAs; webview boots with no `isLicensed` dependency; `grep -rn "LICENSE_REQUIRED\|PRO_TIER_REQUIRED" libs\frontend` → zero handling branches left (R2).

### Lane 3b — setup-wizard + marketplace (mechanical) ✅ COMPLETE (commit `850cd979c`) — team-leader verified 2026-07-19: acceptance greps zero (non-spec), full backend build green via pre-commit; delta accepted: `proGated` field removed from provider-spec/registry/hub badge

**Recommended Executor**: CLI agent `ptah-cli "claude cli"` (pc-45aa18a4-d3a1-4809-acae-e6eba6d2f95c)
**Rationale**: Mechanical, file-disjoint deletions/rewrites with clear rulings — well-suited to a self-contained CLI prompt with absolute paths.

#### Task B3b.1: Purge premium from setup-wizard ✅ COMPLETE

**Files** (under `libs\frontend\setup-wizard\`):

- `index.ts` (:19 PremiumUpsellComponent export), DELETE `components\premium-upsell.component.ts`
- `components\wizard-view.component.ts` (:5-28,101-119,233-288 licenseState gating) — REWRITE always render wizard; delete `licenseState`/`licenseError` signals, verify flow, `premiumFeatures` list
- `services\setup-wizard-state.types.ts` (:19 `'premium-check'` step), `services\setup-wizard\wizard-computeds.ts` (:51,116,141) — delete step from types + computeds
- `components\prompt-enhancement.component.ts` (:303-307 isPremiumError) — treat former premium errors as generic
- `services\wizard-rpc.service.ts` (:170 comment)
  **Ruling**: REMOVE premium-upsell + export; REWRITE wizard-view/computeds/prompt-enhancement.
  **Validation Notes**: R2, R9.
  **Acceptance**: wizard opens directly at first real step signed-out; `'premium-check'` absent from types/computeds.

#### Task B3b.2: Purge premium from marketplace ✅ COMPLETE

**Files** (under `libs\frontend\marketplace\`):

- `marketplace-hub.component.ts` (:42-96 pro gate on mount + `_isPremium` + `license:getStatus` call) + `.html` (:55-71 upgrade affordance)
- `smithery-surface.component.ts` (:71-72 comments/defensive gate)
  **Ruling**: REWRITE — delete `_isPremium` signal, the `license:getStatus` mount call, and the upgrade block; hub loads providers for everyone; update smithery-surface comments/defensive gate.
  **Acceptance**: hub fires provider RPCs without any license call.

**Lane 3b Acceptance**: wizard opens directly at first real step signed-out; `'premium-check'` absent from types/computeds; marketplace hub fires provider RPCs without any license call; `grep -riE "premium|upgrade" libs\frontend\setup-wizard\src libs\frontend\marketplace\src` → zero production hits.

### Lane 3c — CLI/TUI copy repoint (mechanical) ✅ COMPLETE (commit `9cde48458`) — team-leader verified 2026-07-19: prohibited-phrase grep zero, license command family + `license_required` wire enum untouched, build green via pre-commit

**Recommended Executor**: CLI agent `ptah-cli "ollama cloud"` (pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9)
**Rationale**: Pure copy/wording repoint across CLI + TUI; disjoint from 3a/3b; self-contained prompt.

#### Task B3c.1: Repoint CLI/TUI license copy ✅ COMPLETE

**Files**:

- `apps\ptah-cli\src\cli\router.ts` (:1488-1533 "premium-gated" descriptions)
- `apps\ptah-cli\src\...\commands\prompts.ts` (:2,:12 gating comments), `commands\doctor.ts` (:357-358 license hint), `commands\init.ts` (license step copy — step KEPT), `commands\license.ts` (status/set/clear — KEPT)
- `apps\ptah-tui\src\components\settings\LicenseSection.tsx` (isPremium display)
  **Ruling**: REPOINT — license commands, init step, doctor license section all STAY (membership identity). Remove "premium-gated" wording from descriptions/comments; doctor hint :358 → neutral membership mention or delete. **KEEP** `license_required` in `jsonrpc/types.ts:300` (wire enum still legitimately returned for invalid key on `license set`) — R2. TUI LicenseSection REPOINT: keep membership status/key entry; remove premium/upgrade framing (UNVERIFIED content — R9).
  **Acceptance**: no "premium-gated"/"Pro-only" wording in CLI help; `ptah license` family functionally unchanged.

**Commit plan (Batch 3)** — one commit per lane after review:

- `refactor(chat): remove trial/upsell surfaces and license-blocked welcome view`
- `refactor(setup-wizard,marketplace): remove premium gating from wizard and hub`
- `refactor(cli,tui): repoint license copy from premium-gating to membership`

---

## Batch 4 — Builders card + landing-page lockout removal (parallel lanes) ✅ COMPLETE

**Verified + committed by team-leader (MODE 2), 2026-07-19** — both lane acceptance criteria re-run independently. Lane 4a: BuildersCardComponent (standalone/OnPush/signals, no license RPC, neutral R5 copy, `command:execute`+`ptah.openPricing` link-out, localStorage dismiss key `ptah.builders-card.dismissed`) mounted after analytics card + registered in grid `imports` + exported; dashboard typecheck green. Lane 4b: all three acceptance greps zero (`TrialStatusGuard|trial-ended|trialEnded`, `proYearlyPlan`, `100-day|free trial` outside legal pages); R6 confirmed (no hero/sections files touched); landing `tsc --noEmit --project tsconfig.app.json` exit 0. Pre-commit hook (lint-staged + `ptah-electron:validate-deps` full backend build) passed on both commits. See `batch4-verification.md`.
**Commits**: Lane 4a `a317d5aa3` · Lane 4b `e349b7f2b`.
**B5 carry-overs recorded** (pre-ruled for B5.6 purge grep): (1) `CommunityPlanCardComponent` "Trial Ended Alert" block + `profile-details`/`profile-header` `isTrialEnded()` (key off snake_case `trial_ended` license API values — status reporting, not guard machinery); (2) `apps/ptah-landing-page/CLAUDE.md` stale `TrialStatusGuard` docs; (3) `terms-page.component.ts`/`refund-page.component.ts` legal copy (deferred pending business sign-off). All three are KEEP-scope/docs-pass, not out-of-scope purge misses.

**Execution Mode**: parallel (2 lanes, file-disjoint).
**Dependencies**: Batch 3 lanes landed (4a reuses the settings external-open mechanism repointed in B3a.4).
**Parallel-eligibility check**: PASS — 4a (dashboard lib) · 4b (landing-page guards) disjoint.

### Lane 4a — Builders dashboard card ✅ COMPLETE (commit `a317d5aa3`)

**Recommended Executor**: sub-agent `frontend-developer`
**Rationale**: New UI component per §3 — needs Angular signal/OnPush/a11y judgment and pattern-cloning from `AnalyticsCardComponent`.

#### Task B4a.1: Create BuildersCardComponent ✅ COMPLETE

**File**: CREATE `libs\frontend\dashboard\src\lib\components\builders-card\builders-card.component.ts` (+ sibling `.html` if analytics card uses one — match its layout)
**Spec Reference**: §3
**Ruling**: CREATE. Selector `ptah-builders-card`. Clone `AnalyticsCardComponent` structure (standalone, `ChangeDetectionStrategy.OnPush`, signals + `inject()`, `LucideAngularModule`, Tailwind/daisyui classes).

- Content (static, tasteful): community icon + heading "Ptah is open source" + one sentence promoting Ptah Builders (community + training + priority support) + single "Explore Ptah Builders" link button + ghost "Dismiss" button. No countdowns, no comparison tables, no "upgrade" verbs.
- Dismissal: `dismissed = signal(...)` seeded from `globalThis.localStorage?.getItem('ptah.builders-card.dismissed')` (pattern: `conversation-registry.service.ts:326,355`); dismiss sets `'1'`, hides permanently (`@if (!dismissed())`); no re-nag.
- Link-out: reuse the exact external-open mechanism from `settings.component.ts:210` (repointed in B3a.4) pointing at the landing-page Builders/community URL; URL lives wherever the current pricing URL constant lives — repoint it, coordinate final path with TASK_2026_162.
  **Validation Notes**: R5 (TS-only, neutral copy — no trademarked AI names in non-JS), R9 (UNVERIFIED :210 mechanism — confirm from B3a.4 delta report). Quality: OnPush, no `[innerHTML]`, keyboard-accessible dismiss (`aria-label`), fully functional signed-out (no license RPC), zero network calls when dismissed.
  **Acceptance**: component compiles; dismiss reads/writes localStorage key `ptah.builders-card.dismissed`.

#### Task B4a.2: Mount + export Builders card ✅ COMPLETE (delta: also registered in dashboard-grid `imports` array — required for standalone component)

**Files**:

- `libs\frontend\dashboard\src\lib\components\dashboard-grid\dashboard-grid.component.html` (add `<ptah-builders-card />` after :48, under the analytics card)
- `libs\frontend\dashboard\src\index.ts` (:1 export)
  **Ruling**: mount + export (dashboard grid already mounted in both shells via `app-shell.component.html:54`, so card auto-appears in VS Code webview + Electron).
  **Acceptance**: card renders in both shells.

**Lane 4a Acceptance**: card renders in both shells; dismiss persists across reload via localStorage; link opens external Builders URL; no modal; OnPush; a11y labels present.

### Lane 4b — landing-page guards ✅ COMPLETE (commit `e349b7f2b`)

**Recommended Executor**: CLI agent `ptah-cli "claude cli"`
**Rationale**: Mechanical guard/route removal; disjoint from 4a. R6 overlap risk with TASK_2026_162 — strictly scoped to guard/route/trial-ended logic.

#### Task B4b.1: Remove trial lockout guards + routes ✅ COMPLETE (incl. deferred 162 pricing cleanups: yearly SKU + billing toggle + dead PlanCardComponent removed)

**Files** (under `apps\ptah-landing-page\src\app\`):

- DELETE `guards\trial-status.guard.ts` (:42 `TrialStatusGuard`)
- `app.routes.ts` (:6,:21,:53,:77,:109-114 guard usage + `/trial-ended` route) — REWRITE remove guard import/usages + `/trial-ended` route
- `app.routes.server.ts` (:8 trial-ended SSR entry) — REWRITE remove entry
- DELETE `pages\trial-ended\` directory (trial-ended-page.component.ts:19)
- DELETE `pages\profile\components\trial-ended-modal.component.ts` + `index.ts` (:13) + its mount site in the profile page (UNVERIFIED — grep `ptah-trial-ended-modal` under pages/profile, R9)
  **Ruling**: REMOVE files/dir/modal; REWRITE routes.
  **Validation Notes**: R6 — **touch ONLY** guard imports, `canActivate` arrays, the `/trial-ended` route, and trial-ended components. **DO NOT** touch hero/sections/pricing copy files (TASK_2026_162's scope). Flag in PR; coordinate merge/rebase order with 162.
  **Acceptance**: `/trial-ended` route gone; no `TrialStatusGuard` symbol; profile renders without lockout modal; SSR route list clean.

**Commit plan (Batch 4)** — one commit per lane after review:

- `feat(dashboard): add Ptah Builders open-source promotion card`
- `refactor(landing-page): remove trial-status guard and trial-ended route`

---

## Batch 5 — Test/e2e sweep + verification gate ✅ COMPLETE

**Verified + committed by team-leader (MODE 2/3), 2026-07-19** — spot-verify greps re-run independently: `isPremiumTier` zero source hits; `ChatPremiumContext|PREMIUM_CONTEXT|McpLicenseGate|FeatureGate|FEATURE_GATE|bindLicenseReactivity|PRO_ONLY_` zero hits INCLUDING all spec files; `ALLOWED_METHOD_PREFIXES` intact incl. `'license:'` (R1 final check passes). Smoke suite `nx test vscode-core` → 19/19 suites, 281/281 green. Three lane reports (`batch5-1-report.md`, `batch5-4-report.md`, `test-report.md`) confirm typecheck:all (51 projects) + lint:all (56 projects) + npm test + supplementary 13-project run all green (one documented pre-existing env-leak flake in agent-sdk, unrelated to the purge). Pre-commit hook (lint-staged incl. di-lint + `ptah-electron:validate-deps` full backend build) passed on all four commits; commitlint valid. Working tree fully clean after commit. See `batch5-verification.md`.
**Commits**: B5.1 `338ad25f3` · B5.4 `025d1e83a` · B5.2+B5.3 `ea825970d` · B5.6 `2d677e897`.
**Single open gate item**: B5.5 verification. The manual cold-profile smoke was superseded on 2026-08-10 — checklist items 1/2/4/5 are now proven by a completed e2e run, and items 3/6/7/8 are delegated to dedicated e2e coverage rather than a one-off human pass. See "Close-out (2026-08-10)" at the end of this file.

**Recommended Executor**: sub-agent `senior-tester` (owns the gate) + CLI agents (≤2 parallel) for mechanical per-project spec updates
**Fallback Executor**: sub-agent `senior-tester` handles all lanes sequentially if CLI agents unavailable
**Execution Mode**: parallel per project, then sequential final gate
**Dependencies**: Batches 1-4 all complete. **No merge to main before this batch is green** (R4).
**Tasks**: 6 | **Rationale**: Delete tests whose subject was deleted; rewrite lockout assertions into open-access assertions; then run the full suite as the single merge gate.

### Task B5.1: Backend spec sweep ✅ COMPLETE (commit `338ad25f3`)

**Files**: rpc-handlers `config-rpc.handlers.spec.ts` (featureGate), `license-rpc.handlers.spec.ts` (keep status-shape tests, drop enforcement), `setup-rpc.handlers.spec.ts`; vscode-lm-tools `mcp-license-gate.spec.ts` (DELETE), `stdio-mcp-server.service.spec.ts`; agent-sdk `sdk-query-options-builder.spec.ts`, `sdk-agent-adapter.spec.ts`, `sdk-query-runner.service.spec.ts`, `internal-query.service.spec.ts`, session-lifecycle specs; `gateway-chat-bridge.spec.ts`; cli-agent-runtime `agent-process-manager.service.spec.ts`, `ptah-cli-registry-{lmstudio-proxy,sakana-proxy,spawn-model}.spec.ts`; agent-generation `orchestrator.service.spec.ts`, `enhanced-prompts.service.spec.ts`, `content-generation.service.spec.ts`.
**Ruling**: delete tests whose subject was deleted; rewrite gating assertions → open-access assertions.
**Recommended sub-executor**: CLI agent lane (mechanical).

### Task B5.2: Container smoke + integration spec sweep ✅ COMPLETE (commit `ea825970d`)

**Files**: `apps\ptah-extension-vscode\src\di\container.smoke.spec.ts`, `apps\ptah-electron\src\di\container.smoke.spec.ts`, `apps\ptah-cli\src\di\container.smoke.spec.ts` (FEATURE_GATE assertions); `apps\ptah-extension-vscode\src\integration\wizard-seed-noop.spec.ts`.
**Ruling**: remove FEATURE_GATE assertions; keep container-wiring assertions for surviving tokens.

### Task B5.3: Frontend spec sweep ✅ COMPLETE (commit `ea825970d`)

**Files**: `libs\frontend\chat\src\lib\settings\settings.component.spec.ts`.
**Ruling**: rewrite premium-gating assertions → all-sections-visible assertions.

### Task B5.4: Electron e2e + showcase-scene sweep ✅ COMPLETE (commit `025d1e83a`)

**Files**: `apps\ptah-electron-e2e\src\specs\license-watcher.spec.ts` (rewrite: license RPC still answers; drop 'welcome' routing :78-83 + premium-tier assertion :189), `startup-config.spec.ts` (:66-74), `setup-wizard\wizard-dom.spec.ts` (:6,:22 `isPremium: true` mocks), `support\ui-driver.ts` (:24-40,117-118 `isLicensed`); showcase scenes `marketplace-tour.scene.ts` (:31,182-231 trial-ended narration), `canvas-orchestra.scene.ts` (:190 modal-clear step), `dashboard-tour.scene.ts`, `chat-code-edit.scene.ts`, `showcase\_harness\director.ts`.
**Ruling**: rewrite lockout/`isPremium`-mock assertions into open-access; remove trial-ended narration/modal-clear steps.
**Recommended sub-executor**: CLI agent lane (mechanical), second parallel lane.

### Task B5.5: Final verification gate ✅ AUTOMATED GATE COMPLETE — ⏸️ MANUAL SMOKE OPEN (USER)

**Ruling**: run sequentially after B5.1-B5.4:

- `npm run typecheck:all` → GREEN (51 projects, per `test-report.md`)
- `npm run lint:all` → GREEN (56 projects)
- `npm run test` → GREEN (shared 403, webview 1, vscode 5)
- Manual smoke: launch Electron with **no license** → full chat + wizard + marketplace + dashboard incl. Builders card (R3 cold-profile check; R7 — a pre-existing key still shows membership status). **← ONLY OPEN GATE ITEM: USER step, not runnable by agents. Full checklist in `test-report.md`.**
  **Acceptance**: all three commands green (✅ met; re-run 2026-08-10 against the post-close-out HEAD); smoke coverage (🔄 items 1/2/4/5 proven by e2e 2026-08-10, items 3/6/7/8 delegated to e2e coverage — see "Close-out (2026-08-10)").

### Task B5.6: Purge-completeness grep review ✅ COMPLETE (commit `2d677e897`)

**Ruling**: `grep -riE "trialEnded|trial_ended|Upgrade to Pro|premium" apps libs --include=*.ts --include=*.html` — review every remaining hit; each MUST be in KEEP scope (license server, wire types `rpc-misc.types.ts`/`rpc.types.ts`, `plans.config.ts`, `trial.constants.ts`, TASK_2026_162-owned landing files). Any hit outside KEEP scope → back to the owning batch (R8 one-way-door enforcement).
**Acceptance**: zero out-of-scope hits.

**Commit plan (Batch 5)**:

- `test: rewrite gating specs into open-access assertions and delete removed-subject tests`
- `test(e2e): drop welcome-routing and premium-tier expectations from electron suite`
- `chore: green typecheck/lint/test gate for premium-gating purge`

**Batch 5 Verification (final merge gate)**:

- `npm run typecheck:all`, `npm run lint:all`, `npm run test` all green.
- Manual Electron no-license smoke passes (chat + wizard + marketplace + dashboard + Builders card).
- Purge-completeness grep (B5.6) shows only KEEP-scope hits.
- No merge to main before this gate is green (R4).

---

## Carried-over findings (future cleanup — NOT blocking this task)

Recorded at Batch 5 close-out (team-leader MODE 3, 2026-07-19). None of these gate the OSS purge; all are follow-up candidates.

1. **Orphaned dead code in cli-agent-runtime** — `cli-plugin-sync.service.ts` `cleanupAll()` and `cli-skill-manifest-tracker.ts` `clearSyncHash()` have zero production callers, dead since the license-reactivity teardown that used to invoke them was removed in B1.4. Comments already de-referenced from "premium expiry" (B5.6). Actual method removal deferred to a dedicated cleanup task (out of scope for a comment/spec sweep).
2. **Landing-page legal copy** — `terms-page.component.ts` / `refund-page.component.ts` still reference a "100-day free trial"; deferred pending business sign-off (pre-ruled in `batch4-verification.md`).
3. **Stale docs pass** — `apps/ptah-landing-page/CLAUDE.md` still documents `TrialStatusGuard`; root `CLAUDE.md` retains one "FeatureGate" mention in the architecture tree (noted since Batch 1). Both are docs-only; a consolidated docs pass is recommended.
4. **Pre-existing agent-sdk test flake** — `sdk-query-runner.service.spec.ts` › one-shot auth-override › `ANTHROPIC_AUTH_TOKEN` assertion fails ONLY when the invoking shell has an empty-string `ANTHROPIC_AUTH_TOKEN` in ambient env (`env: { ...process.env }` leak at `sdk-query-runner.service.ts:285`). Introduced in commit `9ade5e1f1` (2026-06-04), six weeks before this task; unrelated to the purge. Same suite runs green in a clean-env shell (per `batch5-1-report.md`). Candidate: harden env isolation in that test.

**Registry note**: `.ptah/specs/registry.md` is auto-generated (`DO NOT HAND-EDIT`, derived from `TASK_*/task.md` frontmatter) and does not currently track TASK_2026_163 (this task uses `tasks.md`, not a frontmatter `task.md`). It was intentionally NOT hand-edited to avoid violating the generator contract; regenerate via `tasks:generateRegistry` if TASK_2026_163 should appear.

---

## Status Icons

⏸️ PENDING · 🔄 IN PROGRESS / IMPLEMENTED · ✅ COMPLETE · ❌ FAILED

---

## Close-out (2026-08-10)

A stale-status audit re-opened this task's close-out. Two purge leftovers were found that B5.6 could not have caught, both now fixed, plus one follow-up and one e2e triage.

### Leftovers found and fixed

1. **Dead Pro-gate branch in shipped CLI source** — `apps/ptah-cli/src/cli/commands/config.ts` `runAutopilotSet` still caught RPC errors and regex-matched them for `pro subscription|pro tier|pro-?required`, emitting `proRequired: true` and returning `ExitCode.Success`. Its backend counterpart `registerAutopilotToggle` (`config-rpc.handlers.ts:274-361`) has no license/tier check left — its only throw is the invalid-permission-level message — so the branch was unreachable, and where it did match it converted a real failure into exit 0. Deleted with the now-pointless try/catch. Commit `349119639`.
2. **Premium-gating claims in the published npm README** — `apps/ptah-cli/README.md` ships inside `@hive-academy/ptah-cli` and still advertised `analyze`, `prompts`, `session start` and `setup` as premium-gated (lines 33, 114, 300, 306, 410, 490). Verified against source: `analyze.ts`, `prompts.ts`, `session.ts`, `setup.ts` carry no license/tier check. `license.ts` `runSet()` (:107-114) is the only remaining producer of `license_required`, and only on a server-rejected key — so the exit-code table and `ptah_code` taxonomy references were deliberately KEPT. Commit `1e2f1bb23`.

**Why B5.6's acceptance was unsound**: its grep regex was `trialEnded|trial_ended|Upgrade to Pro|premium`, which cannot match the string `pro tier`. Its "zero out-of-scope hits" result was therefore a false negative, not a clean bill. Any future purge sweep should grep for the tier vocabulary, not only the marketing phrases.

### Follow-up completed

3. **Dead codes in the shared error-code union** — `RpcUserErrorCode` still declared `LICENSE_REQUIRED` and `PRO_TIER_REQUIRED`. Enumerating every `RpcUserError` construction site found none passing either code, and `license-rpc.handlers.ts` never touches the `errorCode` channel at all (it maps failures through `mapLicenseStatusToResponse` into its own status payload), so the kept membership-key flow does not depend on them. Both removed along with the `vscode-core` docblock and its `showLicensePrompt`/`showUpgradePrompt` `@example`. Four fixtures repointed at live codes rather than deleted — they prove the union round-trips backend→frontend. Commit `5a92761d3`. This retires carried-over finding candidate territory but NOT items 1-4 below, which remain open.

### B5.5 verification state

**Automated gate re-run 2026-08-10 against post-close-out HEAD** (the 2026-07-19 run predates five commits):

- `npm run typecheck:all` → GREEN, 88 projects
- `npm run lint:all` → GREEN, 68 projects, 0 errors / 25 warnings
- `npm run test` → GREEN, 3 projects (shared, webview, vscode)

**Full Electron e2e run**: 95 passed, 1 failed, 13 skipped (109 total, 20.4 min). All four B5.5-relevant specs green — `license-watcher.spec.ts`, `startup-config.spec.ts`, `setup-wizard/wizard-dom.spec.ts`, `marketplace/marketplace.spec.ts` (the last committed in `05ec1ed50`). Live main-process evidence of a genuinely cold profile on every launch:

```
[Ptah Electron] Membership status resolved (valid: false, tier: community)
RPC: license:getStatus success: {"tier":"community","isPremium":false,"isCommunity":true}
```

The single failure — `editor/editor.spec.ts:73` Monaco visibility — was triaged and fixed in commit `5cb4caa7e`. Root cause was the spec, not the product: `3a73a037d` made the diff view and code editor permanently-mounted siblings, so an unscoped `.monaco-editor` + `.first()` resolved onto the diff view's intentionally-invisible instance. Deterministic (same hidden node on all 32 polls), not a flake. **This is NOT the TASK_2026_196 defect** — that one is paint-order bleed of a _visible_ surface over the terminal. Same commit changed the DOM shape behind both; separate bugs.

**Manual smoke superseded.** Checklist items 1, 2, 4, 5 are proven by the completed e2e run above. Items 3 (chat send → session starts), 6 (Builders card + `localStorage` dismiss persistence), 7 (Membership card copy/CTAs) and 8 (valid key → "Builder" badge) have no spec coverage and are delegated to dedicated e2e work rather than a one-off human pass, per user decision 2026-08-10.

Coverage checked directly: `dashboard/dashboard.spec.ts` asserts only `'status cards render'`; `settings/settings.spec.ts` asserts only `'settings renders'` and `'toggle persists (round-trip)'`. Neither touches the Builders or Membership card. Item 8 is structurally un-automatable in the current harness — `ui-driver.ts:51-107` `installFakeRpcListener` intercepts the RPC channel before `license.service.ts`'s real fetch path executes.

**Remaining to close this task**: e2e coverage for items 3, 6, 7, 8. Items 6 and 7 are the cheap ones (`ui.goto()` exists at `ui-driver.ts:237`; both components expose stable hooks — `ptah-builders-card`, the `ptah.builders-card.dismissed` key, and `license-status-card`'s three CTAs), but they ride on `app-shell.component.html`'s `@switch` view dispatch and on `ui-driver.ts`, both under active refactor by TASK_2026_187. Sequence that work after 187 settles.

### Sequencing update (2026-08-10, stale-status audit)

**The 187 blocker has cleared.** TASK_2026_187 is `done` (webview bundle 3.63 MB → 2.20 MB,
closed at `4b0313783`), so `app-shell.component.html`'s `@switch` view dispatch and
`ui-driver.ts` are no longer under active refactor. The remaining B5.5 work — e2e coverage
for items 3, 6 and 7 — is unblocked and can be picked up now.

Item 8 is unchanged and still structurally un-automatable in the current harness
(`ui-driver.ts:51-107` `installFakeRpcListener` intercepts the RPC channel before
`license.service.ts`'s real fetch path runs). Closing this task means either extending the
harness to allow a real-fetch lane, or accepting item 8 as manual and saying so here.

This carrier stays `in_review` — the work above is real and open, not bookkeeping.
