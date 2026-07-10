# Development Tasks — TASK_2026_155 (Gateway Turn Hang Fix)

**Total Tasks**: 11 | **Batches**: 3 | **Status**: 3/3 complete
**Type**: BUGFIX | **Branch/Worktree**: `fix/gateway-turn-hang`
**Worktree Root**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang`
**CLI delegation**: DISABLED — all batches run on the `backend-developer` sub-agent.

> ALL paths below are worktree-absolute. Never touch the main checkout at `D:/projects/ptah-extension`.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

Root cause was pre-diagnosed in `context.md`; I re-read every referenced source file to ground the breakdown. Findings:

### Assumptions Verified

- ✅ `SessionQueryExecutor.executeQuery` seeds `rec.permissionLevel` from the GLOBAL `permissionHandler.getPermissionLevel()` (session-query-executor.service.ts:141-146) and derives `initialPermissionMode` from that same `currentLevel` (lines 152-158). A caller-supplied level must override BOTH.
- ✅ `PERMISSION_MODE_MAP` maps `yolo → 'default'` (permission-mode-map.ts:22-30). The load-bearing comment confirms `bypassPermissions` must NOT be passed to the SDK for interactive sessions or `canUseTool` never runs. F1 keeps `permissionLevel: 'yolo'` which the executor maps to SDK `'default'`; `canUseTool` then auto-approves every tool via the `effectiveLevel === 'yolo'` branch (sdk-permission-handler.ts:351-359).
- ✅ `ExecuteQueryConfig` (session-lifecycle-manager.ts:99+) is the pass-through struct; it already carries `isPremium`/`mcpServerRunning`/`enhancedPromptsContent`/`pluginPaths` — `permissionLevel` follows the same threading pattern.
- ✅ `awaitResponse` (sdk-permission-handler.ts:714-744) only settles on user response or AbortSignal; `timeoutAt = 0` at line 500 means no timer. The routed-webview undelivered case already denies (lines 145-166); the gateway case gets `delivered=true` (Electron window exists) so that net never fires.
- ✅ `GatewayChatBridge.runTurn` (gateway-chat-bridge.ts:84-155) has a `finally` that seals + ends the session, but the `await this.pumpStream(...)` at line 124 can hang forever on an unsettled `canUseTool`, so the `finally` never runs → `ConversationQueue` (conversation-queue.ts) chain wedges.
- ✅ `bindSession` (gateway-chat-bridge.ts:305-333) does BOTH sessionId persistence AND the racy `setSessionPermissionLevel(uuid, 'bypassPermissions')` flip. F1 makes the flip redundant — remove ONLY the flip, keep persistence.
- ✅ `ChatPremiumContextService` (chat-premium-context.service.ts) depends on `Logger` (vscode-core), `CodeExecutionMCP` (vscode-lm-tools), `EnhancedPromptsService` (agent-generation), `PluginLoaderService` (agent-sdk) — none are rpc-handlers-only. `isPremiumTier` + `LicenseService` live in vscode-core. All are importable by a backend lib without touching rpc-handlers.

### Risks Identified

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| F2 could regress normally-routed webview permission prompts (users legitimately take minutes) if the timeout is applied unconditionally. | HIGH | Task 1.4 gates the timeout on an **unroutable** classification (tabId/sessionId not a valid UUID surface — the broadcast-fallback case). Routed webview requests keep `timeoutAt = 0` / infinite wait. Test 3.3 asserts a routed request is NOT auto-denied. |
| F1: overriding `rec.permissionLevel` might accidentally break mid-session toggle or leak across sessions. | MED | Seed with `config.permissionLevel ?? global`; the live `permissionLevelResolver = () => rec.permissionLevel` (session-query-executor.service.ts:147) is unchanged, so `setSessionPermissionLevel` still works. Test 3.1 asserts caller level seeds `rec.permissionLevel` and default falls back to global. |
| F1: passing SDK `'bypassPermissions'` anywhere for interactive sessions would kill `AskUserQuestion`/`ExitPlanMode` routing. | HIGH | Bridge passes the FRONTEND level `'yolo'` (not SDK `bypassPermissions`); executor maps via `PERMISSION_MODE_MAP` to SDK `'default'`. Test 3.1 asserts `initialPermissionMode === 'default'` when `permissionLevel: 'yolo'`. |
| F4: gateway-chat-bridge gaining imports on `vscode-lm-tools` / `agent-generation` / `agent-sdk` could introduce an Nx module-boundary/cycle issue. | MED | Verified acyclic (none of those libs import gateway-chat-bridge; bridge is Electron-only wiring). Task 2.4 updates `project.json`/tsconfig implicit deps; verification gate runs `nx graph`-affected typecheck + lint. If a boundary lint error appears, fall back to the shared-resolver alternative noted in Task 2.4. |
| Watchdog (F3) racing the normal `finally` seal → double-seal / double-endSession. | MED | Task 2.3 uses the existing `sealed` guard + a settled flag; watchdog and normal completion are mutually exclusive via `Promise.race` + a cleared timer. Test 3.4 asserts single seal + single endSession on timeout. |

### Edge Cases to Handle

- [ ] F2: request with a valid UUID sessionId but no tabId → treat as routable (no timeout). → Task 1.4
- [ ] F2: timer must be cleared when a real response/abort arrives first (no late deny, no leak). → Task 1.4
- [ ] F3: watchdog fires while the SDK stream is mid-emit → abort must not throw uncaught; wrap in try/catch. → Task 2.3
- [ ] F3: watchdog timer must be cleared on normal completion so a settled turn never later sends a spurious error reply. → Task 2.3
- [ ] F4: non-premium / no-workspace path must still work (isPremium=false, undefined prompts/plugins) exactly as today. → Task 2.4

### Blockers Found

None.

### F4 Placement Decision (hexagonal rules)

`gateway-chat-bridge` MUST NOT import `rpc-handlers` (app-layer-consumed). Two options were weighed:

1. **Extract a new shared `premium-context` lib** consumed by both rpc-handlers and the bridge — cleanest, but high blast radius (new lib + tsconfig paths + project.json + DI registration across 3 app containers + refactor rpc-handlers to delegate). Rejected for a bugfix.
2. **CHOSEN — direct injection into the bridge**: inject `LicenseService` + `isPremiumTier` (vscode-core, already a dep), `CodeExecutionMCP` (vscode-lm-tools), `EnhancedPromptsService` (agent-generation), `PluginLoaderService` (agent-sdk), and add a thin private `resolvePremiumContext()` mirroring `ChatPremiumContextService` + `chat-session.service.ts:335-395`. Small, local, verifiable, respects the "no rpc-handlers import" + "no platform-adapter import" rules. The replicated logic is three trivial resolvers.

If Task 2.4's boundary/lint gate flags the new inter-lib imports, escalate to option 1 (return to team-leader; do NOT force-suppress the lint rule).

---

## Batch 1: agent-sdk core — F1 permission-level threading + F2 unroutable timeout ✅ COMPLETE

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer` (re-spawn with reviewer feedback)
**Execution Mode**: sequential
**Rationale**: Tightly coupled cross-file thread (shared type → ExecuteQueryConfig → executor → adapter) plus a permission-handler change in the same lib boundary; one coherent mental model, must land in order. CLI delegation is disabled for this task.
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Add `permissionLevel` to the shared adapter config surface ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/shared/src/lib/types/agent-adapter.types.ts`
**Spec Reference**: context.md F1; agent-adapter.types.ts:94-134
**Pattern to Follow**: existing optional fields on `AgentSessionStartConfig` / `AgentSessionResumeConfig` (e.g. `isPremium?`, `mcpServerRunning?`).

**Change**:
- Add an optional field `permissionLevel?: AgentPermissionLevel;` to BOTH `AgentSessionStartConfig` and `AgentSessionResumeConfig`, with a doc comment: initial per-session permission level for the interactive session-start path; seeds `SessionRecord.permissionLevel` instead of the global default. Interactive callers pass a FRONTEND level (`'yolo'`), never the SDK `'bypassPermissions'` alias.
- Reuse the existing `AgentPermissionLevel` union already declared in this file (do NOT introduce a new type).

**Acceptance Criteria**:
- `AgentSessionStartConfig.permissionLevel` and `AgentSessionResumeConfig.permissionLevel` compile as optional `AgentPermissionLevel`.
- No change to any existing field.

**Validation Notes**: This is the F1 config entry point named in context.md. Keep it optional so all existing callers stay valid.

---

### Task 1.2: Thread `permissionLevel` through `ExecuteQueryConfig` and seed the session record ✅ COMPLETE

**Files**:
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (ExecuteQueryConfig, ~line 99)
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` (executeQuery, lines 75-158)

**Spec Reference**: context.md F1; session-query-executor.service.ts:141-158
**Dependencies**: Task 1.1
**Pattern to Follow**: how `isPremium`/`mcpServerRunning` are declared on `ExecuteQueryConfig` and destructured in `executeQuery`.

**Change**:
- In `ExecuteQueryConfig`: add `permissionLevel?: PermissionLevel;` (import `PermissionLevel` from `@ptah-extension/shared` if not already imported) with a doc comment mirroring the field's purpose.
- In `executeQuery`: destructure `permissionLevel` from `config`.
- Replace the seed at line ~141-146 so the per-session level uses the caller value first:
  - `const currentLevel = permissionLevel ?? this.permissionHandler.getPermissionLevel();`
  - keep `rec.permissionLevel = currentLevel;` and the live `permissionLevelResolver = () => rec.permissionLevel;` unchanged.
- The `initialPermissionMode` computation (lines 152-158) already derives from `currentLevel` — no structural change needed, just confirm it now reflects the seeded level (e.g. `'yolo'` → SDK `'default'` via `PERMISSION_MODE_MAP`).

**Acceptance Criteria**:
- When `config.permissionLevel === 'yolo'`, `rec.permissionLevel === 'yolo'` and `initialPermissionMode === 'default'` (never `'bypassPermissions'`).
- When `config.permissionLevel` is omitted, behavior is byte-identical to today (falls back to `permissionHandler.getPermissionLevel()`).
- `catch (error: unknown)` narrowing preserved; no `any`.

**Validation Notes**: DO NOT pass SDK `'bypassPermissions'`. The whole fix hinges on `canUseTool` still running so it can auto-approve for yolo (permission-mode-map.ts load-bearing comment).

---

### Task 1.3: Pass `permissionLevel` through `SdkAgentAdapter.startChatSession` / `resumeSession` ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (startChatSession ~414-481, resumeSession ~517-585)
**Spec Reference**: context.md F1; sdk-agent-adapter.ts config threading
**Dependencies**: Task 1.1, Task 1.2
**Pattern to Follow**: how `isPremium`/`enhancedPromptsContent`/`pluginPaths` are destructured from `config` and forwarded into `this.sessionLifecycle.executeQuery({...})`.

**Change**:
- Add `permissionLevel?: AgentPermissionLevel;` to the inline config object literal types of BOTH `startChatSession` and `resumeSession`.
- Destructure `permissionLevel` from `config` and forward it as `permissionLevel` in the `executeQuery({...})` call in both methods.
- In `resumeSession`, the "already active, returning existing stream" early-return branch (lines 533-549) needs no permission change (session already seeded) — leave it.

**Acceptance Criteria**:
- `startChatSession({ ..., permissionLevel: 'yolo' })` forwards `permissionLevel: 'yolo'` into `executeQuery`.
- `resumeSession(id, { ..., permissionLevel: 'yolo' })` forwards it into `executeQuery`.
- Omitting `permissionLevel` behaves exactly as before.

**Validation Notes**: The bridge (Batch 2) is the only planned caller passing `'yolo'`; the webview chat path omits it and keeps global-default behavior.

---

### Task 1.4: F2 — deny-timeout for UNROUTABLE permission requests in `SdkPermissionHandler` ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (requestUserPermission ~484-559, awaitResponse ~714-744)
**Spec Reference**: context.md F2; sdk-permission-handler.ts:500, 714-744
**Dependencies**: none functionally (independent of 1.1-1.3) but keep in this batch/lib.
**Pattern to Follow**: existing undelivered-webview deny path (lines 145-166) for the cleanup + resolve-as-deny shape.

**Change**:
- Add a private helper to classify a request as **unroutable**: true when NEITHER `sessionId` NOR `tabId` resolves to a valid UUID surface (i.e. the broadcast-fallback case — a `gw-<id>` tabId is not a UUID and there is no UUID sessionId). Use a strict UUID check (reuse `uuid`'s validate, or a local RFC-4122 regex). A request with a valid UUID `sessionId` is routable even if `tabId` is absent (edge case above).
- Introduce a constant `const UNROUTABLE_PERMISSION_TIMEOUT_MS = 60_000;` (60s default; documented as the deny window for unroutable requests only).
- In `requestUserPermission`: when the request is unroutable, set `timeoutAt = startTime + UNROUTABLE_PERMISSION_TIMEOUT_MS` (instead of `0`) and pass the timeout into `awaitResponse`. When routable, keep `timeoutAt = 0` (no timer) exactly as today.
- In `awaitResponse`: when a positive timeout is supplied, arm a `setTimeout` that, if the request is still pending, deletes it from `pendingRequests` + `pendingRequestContext`, logs a clear warn line (requestId, toolName, "unroutable permission request timed out — denying"), and resolves a `PermissionResponse` with `decision: 'deny'` and a descriptive `reason`. The timer MUST be cleared in the existing `resolve` wrapper AND in `onAbort` so a real response/abort arriving first cancels it (no late deny, no leak).
- Do NOT change the timing behavior for routed webview requests: when no timeout is supplied, `awaitResponse` behaves byte-identically to today.

**Acceptance Criteria**:
- An unroutable request (no UUID sessionId, `gw-*` or undefined tabId) that receives no response resolves as `deny` after ~60s, with `pendingRequests`/`pendingRequestContext` cleaned up and a warn logged. The denied `PermissionResult` propagates so `canUseTool` returns deny and the SDK stream can complete.
- A routed request (valid UUID `sessionId` or a real UUID `tabId`) is NEVER auto-denied by this path — no timer armed; can wait indefinitely.
- A real response or abort arriving before the timeout clears the timer (assert no double-resolve, no leaked timer).
- `catch (error: unknown)`; no `any`.

**Validation Notes**: This is the HIGH-severity regression guard — the timeout is strictly scoped to the unroutable/broadcast-fallback case per context.md F2.

---

**Batch 1 Verification** (developer self-check before returning; team-leader owns the commit):
- Files above exist with real edits (no stubs/TODOs).
- `npx nx typecheck agent-sdk` and `npx nx typecheck shared` pass.
- Existing suites stay green: `npx nx test agent-sdk`.
- Edge cases from validation (routable-with-UUID-sessionId, timer-cleared-on-response) addressed.

**Commit (team-leader, after APPROVED review)**: `fix(agent-sdk): thread per-session permission level and deny-timeout unroutable permission requests`

---

## Batch 2: gateway-chat-bridge — F1 consumption + remove racy flip + F3 watchdog + F4 parity ✅ COMPLETE

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer` (re-spawn with reviewer feedback)
**Execution Mode**: sequential
**Rationale**: All four sub-changes touch the same file (`gateway-chat-bridge.ts`) + its DI/project wiring; they must be reasoned about together (watchdog interacts with the seal/finally; premium injection changes the constructor). Single-file coupling → sequential sub-agent, not parallel CLI. Depends on Batch 1's `permissionLevel` config field.
**Tasks**: 4 | **Dependencies**: Batch 1 (needs `permissionLevel` on the adapter config)

### Task 2.1: F1 — pass `permissionLevel: 'yolo'` on start + resume ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` (openStream ~179-215, startNew ~217-230)
**Spec Reference**: context.md F1; gateway-chat-bridge.ts:190-229
**Dependencies**: Batch 1
**Pattern to Follow**: existing config objects passed to `resumeSession` / `startChatSession` in `openStream` / `startNew`.

**Change**:
- In `startNew`, add `permissionLevel: 'yolo'` to the `startChatSession({...})` config.
- In `openStream`, add `permissionLevel: 'yolo'` to BOTH `resumeSession(...)` config objects (the `canResume` fast path and the try/catch resume path).
- Import type not needed if passing a string literal accepted by the (now-updated) config union.

**Acceptance Criteria**:
- Every gateway session start/resume passes `permissionLevel: 'yolo'`.
- The value is the FRONTEND `'yolo'` literal (mapped to SDK `'default'` downstream), never SDK `'bypassPermissions'`.

**Validation Notes**: With this in place, the very first tool call in a gateway turn hits `effectiveLevel === 'yolo'` and auto-approves — no permission prompt is ever emitted for gateway sessions.

---

### Task 2.2: F1 — remove the racy post-hoc bypass flip in `bindSession` ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` (bindSession ~305-333)
**Spec Reference**: context.md F1; gateway-chat-bridge.ts:305-333
**Dependencies**: Task 2.1
**Change**:
- Remove the `try { await this.agentAdapter.setSessionPermissionLevel(SessionId.from(sessionUuid), 'bypassPermissions'); } catch { ... }` block (lines ~319-332).
- KEEP the sessionId-persistence block (`setPtahSessionId`, lines ~309-318) unchanged.
- `bindSession` may become synchronous if nothing else awaits — keep the signature `async` only if the caller still `await`s it (it does at pumpStream line ~255); simplest is to keep `async` and just drop the flip. Do not change the call site semantics.
- Update the class doc-comment (lines 8-10, "run with bypass permission ... once the real SDK session UUID resolves") to reflect that auto-approve now comes from the initial `permissionLevel: 'yolo'` seed, not a post-hoc flip.

**Acceptance Criteria**:
- `bindSession` no longer calls `setSessionPermissionLevel`.
- sessionId persistence via `setPtahSessionId` is preserved.
- No dangling unused imports.

**Validation Notes**: The flip was racy (tool calls before the first real-sessionId event hit `'ask'`). It is now redundant AND harmful to remove the race — this is the correctness win.

---

### Task 2.3: F3 — turn watchdog around the stream pump in `runTurn` ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` (runTurn ~84-155, endSessionAfterTurn ~165-177)
**Spec Reference**: context.md F3; gateway-chat-bridge.ts:84-155
**Dependencies**: none within batch (independent of 2.1/2.2 logically) but same file — keep sequential.
**Pattern to Follow**: the existing `sealTurn` idempotent guard + `finally` seal pattern already in `runTurn`.

**Change**:
- Introduce a module constant `const TURN_WATCHDOG_MS = 10 * 60_000;` (10 min default; a plain constant is acceptable — settings-backed is optional and out of scope).
- Wrap the turn's work (the `openStream` → `pumpStream` sequence, plus the catch/fallback) so that if the turn does not settle within `TURN_WATCHDOG_MS`, the watchdog:
  1. aborts/ends the SDK session via the existing `endSessionAfterTurn(sessionToEnd ?? tabId)` (idempotent guard already present) — wrap in try/catch so an abort mid-emit cannot throw uncaught;
  2. sends a short platform error reply via `sendError(route, ...)` (e.g. "This request took too long and was stopped. Please try again.");
  3. lets the `finally` seal run exactly once (respect the existing `sealed` guard).
- Implement via `Promise.race([turnWork, watchdogPromise])` where the watchdog is a `setTimeout`; CLEAR the timer as soon as `turnWork` settles (normal completion, error, or fallback) so a completed turn never later triggers the watchdog error reply.
- Ensure the `ConversationQueue` chain always settles: after the race, control must always reach the existing `finally` (seal + endSession).

**Acceptance Criteria**:
- A turn whose stream never settles is force-terminated after `TURN_WATCHDOG_MS`: session ended, one error reply sent, turn sealed exactly once, and the `runTurn` promise resolves (so `ConversationQueue.enqueue` settles and the next inbound message can run).
- A normal (fast) turn clears the timer and NEVER sends the watchdog error reply nor double-seals/double-ends.
- Watchdog-triggered `endSession`/abort cannot throw uncaught (wrapped).

**Validation Notes**: This is the ultimate safety net — even if F1/F2 miss a case, the queue always unwedges. Guard against double-seal (existing `sealed` flag) and double-endSession (existing `isSessionActive` check in `endSessionAfterTurn`).

---

### Task 2.4: F4 — premium parity (isPremium, enhanced prompts, plugins, mcp) for gateway sessions ✅ COMPLETE

**Files**:
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` (constructor, startNew, openStream)
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/project.json` (implicit/build deps) and, if present, the lib's `tsconfig.*.json` references
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/src/lib/di/register.ts` (only if new tokens must be resolvable — most collaborators use existing global `TOKENS`/lib tokens)

**Spec Reference**: context.md F4 + "F4 Placement Decision" above; chat-session.service.ts:335-395; chat-premium-context.service.ts
**Dependencies**: Task 2.1 (same config objects), Task 2.3 (same file)
**Pattern to Follow**: `ChatSessionService` premium block (chat-session.service.ts:335-395) + `ChatPremiumContextService` resolvers.

**Change** (per chosen option 2 — direct injection, NO rpc-handlers import):
- Inject into `GatewayChatBridge` constructor:
  - `LicenseService` + use `isPremiumTier` from `@ptah-extension/vscode-core`;
  - `CodeExecutionMCP` from `@ptah-extension/vscode-lm-tools` (via `TOKENS.CODE_EXECUTION_MCP`);
  - `EnhancedPromptsService` from `@ptah-extension/agent-generation` (via `AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE`);
  - `PluginLoaderService` from `@ptah-extension/agent-sdk` (via `SDK_TOKENS.SDK_PLUGIN_LOADER`).
- Add a private `async resolvePremiumContext(workspaceRoot: string): Promise<{ isPremium: boolean; mcpServerRunning: boolean; enhancedPromptsContent?: string; pluginPaths?: string[]; }>` that mirrors the chat path:
  - `isPremium = isPremiumTier(await licenseService.verifyLicense())`;
  - `mcpServerRunning = codeExecutionMcp.getPort() !== null`;
  - if `isPremium && mcpServerRunning` → `codeExecutionMcp.ensureRegisteredForSubagents()`;
  - `enhancedPromptsContent = await enhancedPromptsService.getEnhancedPromptContent(workspaceRoot)` guarded (undefined on non-premium/error);
  - `pluginPaths = pluginLoader...` resolved only when premium (mirror `ChatPremiumContextService.resolvePluginPaths`), undefined otherwise.
  - `catch (error: unknown)` on each external call; log at debug and fall back to safe defaults.
- Call `resolvePremiumContext(workspaceRoot)` once per turn in `runTurn` (before `openStream`) and pass `isPremium`, `mcpServerRunning`, `enhancedPromptsContent`, `pluginPaths` into `startChatSession` (in `startNew`) and both `resumeSession` calls (in `openStream`). Thread the resolved context into `openStream`/`startNew` via parameters.
- Update `project.json` (and tsconfig references if the workspace uses them) so the new inter-lib deps are declared; run the boundary/lint gate.

**Acceptance Criteria**:
- A premium gateway session starts with `isPremium: true`, `mcpServerRunning` reflecting the live port, resolved `enhancedPromptsContent`, and resolved `pluginPaths` — matching what `chat-session.service.ts` passes on the webview path.
- A non-premium or no-license session starts with `isPremium: false` and `undefined` prompts/plugins, and still runs (no throw).
- `gateway-chat-bridge` imports NONE of: `rpc-handlers`, `platform-{cli,electron,vscode}`.
- `nx graph`/boundary lint passes with the new deps declared. If a boundary rule blocks the imports, STOP and escalate to team-leader (option 1: shared lib) — do not suppress the rule.
- `catch (error: unknown)`; no `any`.

**Validation Notes**: Parity gap is separate from the hang but in-scope. Keep the resolver defensive so a license/prompt/plugin failure degrades to non-premium rather than breaking the turn (which F3 would otherwise have to catch).

---

**Batch 2 Verification** (developer self-check):
- `gateway-chat-bridge.ts` compiles; `npx nx typecheck gateway-chat-bridge` passes.
- `npx nx lint gateway-chat-bridge` passes (module boundaries OK with new deps).
- Existing suite green: `npx nx test gateway-chat-bridge`.
- Manual reasoning trace: unsettled turn → watchdog settles queue; first tool call auto-approved; premium flags present.

**Commit (team-leader, after APPROVED review)**: `fix(gateway): auto-approve from turn one, add turn watchdog, and grant premium parity`

---

## Batch 3: tests & verification gates ✅ COMPLETE

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer` (re-spawn with reviewer feedback)
**Execution Mode**: sequential
**Rationale**: Test authoring spans both libs and must reflect the exact behavior landed in Batches 1-2; a single developer with full context writes coherent specs and runs the final gate. CLI delegation disabled.
**Tasks**: 3 | **Dependencies**: Batch 1, Batch 2

### Task 3.1: Unit tests — executor seeds caller-supplied permission level ✅ COMPLETE

**File (new/updated)**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts`
**Spec Reference**: Task 1.2
**Pattern to Follow**: existing agent-sdk specs, e.g. `session-registry.service.spec.ts` and `sdk-permission-handler.spec.ts` (Jest, mocked collaborators).

**Tests to prove**:
- Given `config.permissionLevel = 'yolo'` → `rec.permissionLevel === 'yolo'` AND the SDK options `permissionMode === 'default'` (assert via the mocked `queryOptionsBuilder.build` receiving `permissionMode: 'default'`), never `'bypassPermissions'`.
- Given `config.permissionLevel` omitted → `rec.permissionLevel === permissionHandler.getPermissionLevel()` (global fallback) — byte-identical to prior behavior.
- Given `config.permissionLevel = 'auto-edit'` → `permissionMode === 'acceptEdits'`.

**Acceptance Criteria**: All three cases pass; `SessionQueryExecutor` is exercised with mocked `moduleLoader`/`queryOptionsBuilder`/`streamPump`/`permissionHandler` (no real SDK).

---

### Task 3.2: Unit tests — unroutable permission timeout denies + cleans up; routed does not ✅ COMPLETE

**File (updated)**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/sdk-permission-handler.spec.ts`
**Spec Reference**: Task 1.4
**Pattern to Follow**: existing `sdk-permission-handler.spec.ts` (fake timers via `jest.useFakeTimers()`).

**Tests to prove**:
- Unroutable request (no UUID sessionId, `gw-*` / undefined tabId) with no response → after advancing timers by 60s resolves `deny`, and `pendingRequests`/`pendingRequestContext` no longer contain the id; a warn was logged.
- Routed request (valid UUID sessionId) with no response → advancing timers by 60s (and beyond) does NOT resolve/deny; still pending.
- A real `handleResponse('allow')` arriving before 60s on an unroutable request → resolves allow and the timer is cleared (advancing timers afterwards does not double-resolve; no leaked timer — assert `jest.getTimerCount()` returns to 0).

**Acceptance Criteria**: All cases pass with fake timers; no regression to existing permission-handler tests.

---

### Task 3.3: Unit tests — gateway bridge (yolo seed, no post-hoc flip, watchdog settles queue, premium flags) + full gate ✅ COMPLETE

**File (updated)**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts`
**Spec Reference**: Tasks 2.1-2.4
**Pattern to Follow**: existing `gateway-chat-bridge.spec.ts` (mocked `IAgentAdapter`, `GatewayService`, `ConversationStore`); `conversation-queue.spec.ts` for queue-settlement style.

**Tests to prove**:
- `startNew`/resume calls receive `permissionLevel: 'yolo'` in their config (assert on the mocked `agentAdapter.startChatSession` / `resumeSession` args).
- `bindSession` does NOT call `agentAdapter.setSessionPermissionLevel` (assert mock never called), but DOES call `conversations.setPtahSessionId`.
- Watchdog: a stream that never settles (mock returns an async iterable that hangs) → after advancing timers by `TURN_WATCHDOG_MS` the turn seals once, `endSession` is called, one error reply is sent, and the `runTurn`/`enqueue` promise resolves so a subsequent enqueued turn runs (assert the second turn executes). A fast turn does NOT trigger the error reply and clears the timer.
- Premium parity: with a mocked premium `LicenseService` + `CodeExecutionMCP.getPort()` non-null, `startChatSession` receives `isPremium: true`, `mcpServerRunning: true`, and the resolved `enhancedPromptsContent`/`pluginPaths`. With non-premium license → `isPremium: false`, undefined prompts/plugins, turn still completes.
- **Final verification gate** (run and paste results in the return report):
  - `npx nx run-many -t test --projects=agent-sdk,gateway-chat-bridge,messaging-gateway`
  - `npx nx run-many -t typecheck --projects=agent-sdk,gateway-chat-bridge,messaging-gateway,shared`
  - `npx nx run-many -t lint --projects=agent-sdk,gateway-chat-bridge`

**Acceptance Criteria**: All new tests pass; the three gate commands are green; no `any`, `catch (error: unknown)` throughout new test helpers where applicable.

---

**Batch 3 Verification** (developer self-check):
- New/updated spec files present and passing.
- All three gate commands green (output captured).

**Commit (team-leader, after APPROVED review)**: `test(gateway): cover permission-level seeding, unroutable deny-timeout, turn watchdog, and premium parity`

---

## Executor & Review Protocol (advisory — orchestrator spawns)

- Every batch runs on the `backend-developer` sub-agent, sequential. CLI delegation is DISABLED for TASK_2026_155.
- After each batch the developer returns an implementation report; team-leader verifies files, returns `NEEDS REVIEW` for `code-logic-reviewer`, and commits ONLY after an APPROVED verdict.
- Batch order is strict: Batch 1 → Batch 2 → Batch 3 (Batch 2 depends on Batch 1's `permissionLevel` config field; Batch 3 depends on both).

## Status Legend

`⏸️ PENDING` → `🔄 IN PROGRESS` → `🔄 IMPLEMENTED` (developer) → `✅ COMPLETE` (team-leader, committed).
