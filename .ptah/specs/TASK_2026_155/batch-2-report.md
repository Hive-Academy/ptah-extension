# Batch 2 Implementation Report — TASK_2026_155

**Scope**: gateway-chat-bridge — F1 consumption (Task 2.1), remove racy bypass flip (Task 2.2), F3 turn watchdog (Task 2.3), F4 premium parity via direct injection (Task 2.4). Batch 3 (new tests) NOT written.
**Status**: All four tasks IMPLEMENTED. Typecheck + lint + test + electron build-main all green. No commit.

---

## Files Changed

### `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts`

**Doc comment (class header, ~lines 8-12)** — replaced the "run with bypass permission … once the real SDK session UUID resolves" wording with a description of the initial `permissionLevel: 'yolo'` seed (auto-approve from turn one, no post-hoc flip).

**Imports** — vscode-core import expanded to `{ TOKENS, isPremiumTier, type Logger, type LicenseService }`. Added:
- `import { type CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';` (type-only — token comes from `TOKENS.CODE_EXECUTION_MCP`, so no runtime barrel load)
- `import { SDK_TOKENS, type PluginLoaderService } from '@ptah-extension/agent-sdk';`
- `import { AGENT_GENERATION_TOKENS, type EnhancedPromptsService } from '@ptah-extension/agent-generation';`

**Module constant** — `const TURN_WATCHDOG_MS = 10 * 60_000;` (doc-commented).

**New interface** — `PremiumSessionContext { isPremium; mcpServerRunning; enhancedPromptsContent?; pluginPaths?; }` (the once-per-turn resolved context threaded into start/resume).

**Constructor** — appended 4 injected deps (slots 7-10) after `modelSettings`:
- `@inject(TOKENS.LICENSE_SERVICE) licenseService: LicenseService`
- `@inject(TOKENS.CODE_EXECUTION_MCP) codeExecutionMcp: CodeExecutionMCP`
- `@inject(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE) enhancedPromptsService: EnhancedPromptsService`
- `@inject(SDK_TOKENS.SDK_PLUGIN_LOADER) pluginLoader: PluginLoaderService`

**`runTurn` (Task 2.3 + threading)** — the open→pump→catch/fallback body is now an inner `turnWork` async closure. It is raced against a `setTimeout(TURN_WATCHDOG_MS)` watchdog via `Promise.race([turnWork(), watchdog])`:
- On timeout (`timedOut` flag set inside the timer): logs a warn, calls `endSessionAfterTurn(sessionToEnd ?? tabId)` (internally try/catch-guarded — cannot throw uncaught), and sends exactly ONE `sendError(route, 'This request took too long and was stopped. Please try again.')` (its own `.catch` guard).
- `finally` always runs: clears the watchdog timer, seals exactly once via the existing `sealTurn` (`sealed` guard), and calls `endSessionAfterTurn`. A normal fast turn sets `timedOut=false`, so it never sends the watchdog reply and ends only once (the finally call); `endSessionAfterTurn`'s `isSessionActive` check keeps the timeout path's second end idempotent.
- Control always reaches `finally` after the race, so the `ConversationQueue` chain always settles.
- `resolvePremiumContext(workspaceRoot)` is awaited once, before the watchdog race, and the result threaded into `openStream`/`startNew`/`tryFallbackStart`.

**`resolvePremiumContext` (Task 2.4, new private method)** — mirrors `ChatSessionService`/`ChatPremiumContextService`:
- `isPremium = isPremiumTier(await licenseService.verifyLicense())`
- `mcpServerRunning = codeExecutionMcp.getPort() !== null`; if `isPremium && mcpServerRunning` → `codeExecutionMcp.ensureRegisteredForSubagents()`
- `enhancedPromptsContent = (await enhancedPromptsService.getEnhancedPromptContent(workspaceRoot)) ?? undefined` (premium-only)
- `pluginPaths` via new `resolvePluginPaths()` helper (premium-only; mirrors `ChatPremiumContextService.resolvePluginPaths` — `getWorkspacePluginConfig()` → `resolvePluginPaths(enabledPluginIds)`, undefined when empty).
- Every external call in its own `try/catch (error: unknown)` with `instanceof Error` narrowing, logged at `debug`, degrading to non-premium safe defaults. Never throws — a license/prompt/plugin failure cannot break the turn.

**`openStream` / `startNew` / `tryFallbackStart`** — each gained a `premium: PremiumSessionContext` parameter. Both `resumeSession` config objects (canResume fast path + try/catch resume) and the `startChatSession` config now carry `permissionLevel: 'yolo'` plus `isPremium`, `mcpServerRunning`, `enhancedPromptsContent`, `pluginPaths`. `tryFallbackStart` forwards `premium` into `startNew`.

**`bindSession` (Task 2.2)** — removed the `setSessionPermissionLevel(uuid, 'bypassPermissions')` try/catch block. Kept the `setPtahSessionId` persistence unchanged. Method is now synchronous (`: void`) since nothing else awaited; the `pumpStream` call site changed from `await this.bindSession(...)` to `this.bindSession(...)` (avoids an `await`-of-non-thenable lint hit). `SessionId` import still used elsewhere; no dangling imports (lint clean).

### `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` (existing spec kept green — NOT new Batch 3 cases)

- Added top-of-file `jest.mock('@ptah-extension/workspace-intelligence', () => ({ ... }))` stub (verbatim shape from `rpc-handlers/.../chat-session-auth.spec.ts`). Required because the new `AGENT_GENERATION_TOKENS` value import loads agent-generation's barrel, which transitively pulls `workspace-intelligence`'s `wasm-bundle-dir.ts` top-level `import.meta.url` — a construct ts-jest's CJS transform cannot parse. This is the established repo pattern (10+ specs use the same stub); it does not touch production code.
- `setup()` now builds 4 additional mocked deps (licenseService/codeExecutionMcp/enhancedPromptsService/pluginLoader, non-premium defaults) and constructs the bridge with the full 10-arg list; the `Harness` type and `setup` options type were extended accordingly.
- The old `'auto-approves by setting bypass permission…'` test (which asserted `setSessionPermissionLevel(SDK_UUID, 'bypassPermissions')`) was rewritten to the new behavior: asserts `setSessionPermissionLevel` is NOT called and `startChatSession` receives `permissionLevel: 'yolo'`. This is the behavior change we own.

### project.json / tsconfig — NO EDIT NEEDED

Sibling backend libs (e.g. `rpc-handlers`) declare inter-lib deps **implicitly** — Nx infers the graph from the `import` statements + `tsconfig.base.json` path mappings; neither `project.json` nor `tsconfig.json` lists sibling `@ptah-extension/*` deps. The successful `ptah-electron:build-main:development` run (which pulled `@ptah-extension/gateway-chat-bridge:build` as one of its 20 dependent tasks and compiled it against the new agent-sdk/agent-generation/vscode-lm-tools deps) confirms Nx auto-resolved the new edges. The bridge `build` target's `external: ["vscode", "tsyringe"]` was sufficient — the build reported only the pre-existing non-fatal `import.meta` empty-warning (identical to `rpc-handlers:build`), not an error. No project.json/tsconfig change was made.

---

## DI Tokens / Service names actually used (verified against reference impls)

| Dependency | Token | Type | Source lib | Reference |
| --- | --- | --- | --- | --- |
| License | `TOKENS.LICENSE_SERVICE` | `LicenseService` (+ `isPremiumTier`) | `@ptah-extension/vscode-core` | chat-session.service.ts:24-25,122-123,335-336 |
| Code-exec MCP | `TOKENS.CODE_EXECUTION_MCP` | `CodeExecutionMCP` | `@ptah-extension/vscode-lm-tools` | chat-premium-context.service.ts:22-23,37; chat-session.service.ts:347 |
| Enhanced prompts | `AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE` | `EnhancedPromptsService` | `@ptah-extension/agent-generation` | chat-premium-context.service.ts:24-25,60 |
| Plugin loader | `SDK_TOKENS.SDK_PLUGIN_LOADER` | `PluginLoaderService` | `@ptah-extension/agent-sdk` | chat-premium-context.service.ts:26-27,90-94 |

APIs used (all confirmed against the reference source, not assumed):
- `licenseService.verifyLicense()` → `isPremiumTier(status)`
- `codeExecutionMcp.getPort()` (non-null ⇒ running), `codeExecutionMcp.ensureRegisteredForSubagents()`
- `enhancedPromptsService.getEnhancedPromptContent(workspacePath): Promise<string | null>`
- `pluginLoader.getWorkspacePluginConfig().enabledPluginIds`, `pluginLoader.resolvePluginPaths(ids): string[]`

## Electron container registration findings

Confirmed all four injected tokens are registered in the same Electron tsyringe container that constructs the bridge, so the new constructor injections resolve:
- `TOKENS.LICENSE_SERVICE` — registered in `apps/ptah-electron/src/activation` (phase-1 infra; `register-platform-agnostic.ts:86` in vscode-core).
- `TOKENS.CODE_EXECUTION_MCP` — registered via `registerVsCodeLmToolsServices` in `apps/ptah-electron/src/di/phase-3-storage.ts:143`.
- `AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE` — registered in `apps/ptah-electron/src/activation/wire-runtime.ts:178`.
- `SDK_TOKENS.SDK_PLUGIN_LOADER` — registered via agent-sdk registration (referenced in `apps/ptah-electron/src/activation/plugin-activation.ts`).

The bridge is registered as a singleton in `phase-2-libraries.ts:176` (`registerGatewayChatBridge`) but only **resolved/constructed** in `apps/ptah-electron/src/activation/post-window.ts:218` (`bridge.start()`), which runs after every DI phase completes — so all four tokens exist at construction time. These are the exact same collaborators `ChatSessionService`/`ChatPremiumContextService` inject in this container, so availability was already proven by the working webview chat path. No new registration was required; `registerGatewayChatBridge` and the electron DI phases were left unchanged.

## Watchdog design

- Constant `TURN_WATCHDOG_MS = 10 * 60_000` (10 min).
- The turn's open→pump→catch/fallback work is an inner `turnWork()` closure; `Promise.race([turnWork(), watchdog])` where `watchdog` resolves from a `setTimeout` that also sets a `timedOut` flag.
- Timeout path: warn log → idempotent `endSessionAfterTurn` (its internal try/catch + `isSessionActive` guard means it cannot throw and cannot double-end an already-ended session) → single `sendError` (own `.catch` guard).
- Timer is cleared in `finally` (`clearTimeout`) so a settled turn never later fires the watchdog reply.
- `finally` seals once via the existing `sealed` guard and calls `endSessionAfterTurn` — always reached after the race, guaranteeing the per-conversation `ConversationQueue` link settles and the next inbound message runs.
- Normal fast turn: `timedOut` stays false ⇒ no watchdog reply, no double-seal, single end (verified by the full existing spec suite staying green, including the serialized-turns and seal-once cases).

## Layering / boundary compliance

`gateway-chat-bridge` imports (post-change): `vscode-core`, `platform-core`, `messaging-gateway`, `shared`, `settings-core`, `vscode-lm-tools` (type-only), `agent-sdk`, `agent-generation`. It imports NONE of `rpc-handlers`, `platform-cli`, `platform-electron`, `platform-vscode`. `nx lint gateway-chat-bridge` (which runs `@nx/enforce-module-boundaries`) passed — the option-2 direct-injection placement introduced no boundary violation, so no escalation to option 1 was needed.

---

## Verification (run from worktree root)

- `npx nx run-many -t typecheck --projects=gateway-chat-bridge --skip-nx-cache` → **PASS** (`Successfully ran target typecheck`).
- `npx nx lint gateway-chat-bridge --skip-nx-cache` → **PASS** (`All files pass linting`).
- `npx nx test gateway-chat-bridge --skip-nx-cache` → **PASS** (`Test Suites: 2 passed`, `Tests: 23 passed`). The "worker failed to exit gracefully" line is the pre-existing Jest teardown warning.
- `npx nx run ptah-electron:build-main:development --skip-nx-cache` → **PASS** (`Successfully ran target build-main for project ptah-electron and 20 tasks it depends on`; only the pre-existing non-fatal `import.meta` empty-warning, identical to `rpc-handlers:build`).

Batch 2 task markers in `tasks.md` set to `🔄 IMPLEMENTED` (Tasks 2.1-2.4). No commit made (team-leader owns commits).

---

## Fix-Pass (post-review)

Addresses the `NEEDS_REVISION` verdict in `code-logic-review.md` (Critical Issue 1, Moderate Issue 1, Minor Issue 2 / Failure Mode 4). Minor Issue 1 (`resolvePremiumContext` outside watchdog) accepted as-is per coordinator; tasks.md batch-header markers left to team-leader.

### 1. Critical Issue 1 — cancellation of the abandoned turn (cross-turn corruption)

Root problem: `Promise.race([turnWork(), watchdog])` settled `runTurn`'s promise on timeout but never stopped the losing `turnWork()`, so an abandoned turn could later unblock (real SDK `endSession → query.interrupt()` unwedges the `for await`), throw the zero-events sentinel → `tryFallbackStart` → a stray `startChatSession` under the SAME `tabId`, and `appendOutboundChunk`/`setPtahSessionId` into the state the NEXT dequeued turn already owns.

**Design — per-turn cancellation flag** (`gateway-chat-bridge.ts`):
- New module-level `interface TurnCancellation { cancelled: boolean }`.
- `runTurn` creates `const cancellation: TurnCancellation = { cancelled: false }` alongside the watchdog. The watchdog `setTimeout` callback now sets `cancellation.cancelled = true` (in addition to `timedOut = true`) before resolving, so the flag trips the instant the watchdog fires — before `endSessionAfterTurn`/`sendError` run and before the queue advances.
- The flag is threaded into `pumpStream` and `tryFallbackStart` (both gained a `cancellation` param).

**Guard sites (a tripped flag makes the abandoned continuation an inert no-op):**
1. `turnWork`, after `openStream()` resolves, before `pumpStream`: `if (cancellation.cancelled) return;` — a turn cancelled during session-open never pumps.
2. `pumpStream`, top of the `for await` loop body: `if (cancellation.cancelled) break;` — stops consuming, so no `bindSession`/`appendOutboundChunk` fires for a cancelled turn.
3. `pumpStream`, after the loop, before the zero-events throw: `if (cancellation.cancelled) return resolvedSessionId;` — a cancelled turn NEVER throws the sentinel, so it can't drive the caller into `tryFallbackStart`.
4. `tryFallbackStart`, first line: `if (cancellation.cancelled) return { ok: false, sessionId: null };` — silent bail, no log, no `startNew`. Plus a second check after `startNew()` resolves, and `pumpStream` (called from the fallback) receives the same flag.
5. `turnWork` catch, error branch: changed `else {` → `else if (!cancellation.cancelled) {` so a cancelled turn's fallback-failure path skips the error log + `sendError`.

Defense-in-depth: sites 3 and 4 are independent — removing either alone still blocks the stray fallback (the other catches it); the regression only reappears if BOTH are removed (verified in the sanity check below).

### 2. Moderate Issue 1 — un-guarded non-watchdog `sendError`

The normal turn-failure `await this.sendError(route, 'Ptah could not complete this request...')` was un-wrapped while the watchdog path's identical call had a `.catch`. Wrapped it in the same `.catch((sendErr: unknown) => this.logger.warn(...))` pattern (`instanceof Error` narrowing), so a `drainOutbound` rejection there can no longer surface as an unhandled rejection out of `runTurn`/`ConversationQueue.enqueue`'s returned `run` promise.

### 3. Minor Issue 2 / Failure Mode 4 — the missing behavioral test

Added test to `gateway-chat-bridge.spec.ts` (`turn watchdog` describe): **"an abandoned (watchdog-terminated) turn that later unblocks does NOT retry, append, or re-bind into the next turn."**
- The first turn has a persisted `ptahSessionId` (so `tryFallbackStart` can actually reach `startNew` — a fresh/null-session turn would bail before `startNew` and make the sanity-check inert).
- Its stream is a hand-written async iterator (not a generator → no `require-yield` issue) whose first `next()` awaits a gate and then completes with ZERO events. The gate is released by the mocked `endSession` (which also flips `isSessionActive` via a session Set) — mirroring production, where the watchdog-dispatched interrupt is what unblocks the real stream.
- Drives fake timers past `TURN_WATCHDOG_MS`, then flushes the now-unblocked abandoned continuation, and asserts: `startChatSession` was NEVER called (no stray fallback session — the only reachable path to it is the abandoned turn), the outbound bucket never saw the fallback's `'STRAY'` debris (only the watchdog error + the second turn's `'second'`), and `setPtahSessionId` was written exactly once for the second turn's `SDK_UUID_B` (never overwritten by the abandoned turn).

### Sanity check (break-and-revert)

Temporarily commented out guard sites 3 (`pumpStream` cancelled-return) and 4 (`tryFallbackStart` cancelled-return) and ran the new test in isolation:

```
npx nx test gateway-chat-bridge -- --testNamePattern="abandoned"
→ FAIL: expect(startChatSession).not.toHaveBeenCalled()
  Expected 0, Received 1
  1: { ..., prompt: "first (hangs)", tabId: "gw-conv-x", permissionLevel: "yolo", ... }
```

The abandoned turn's zero-event resume threw the sentinel → `tryFallbackStart` → a stray `startChatSession` replaying the original prompt into the second turn's `tabId` — exactly Critical Issue 1's failure. Restored both guards → the test passes again. This is real evidence, not theater.

### Verification (from worktree root, `--skip-nx-cache`)

- `npx nx run-many -t typecheck --projects=gateway-chat-bridge` → **PASS**.
- `npx nx lint gateway-chat-bridge` → **PASS** (`All files pass linting`; module boundaries still clean — no new imports added in the fix pass).
- `npx nx run-many -t test --projects=agent-sdk,gateway-chat-bridge,messaging-gateway` → **PASS**: agent-sdk `697 passed / 59 suites`; messaging-gateway `112 passed, 22 skipped` (pre-existing skips); gateway-chat-bridge `31 passed / 2 suites` (was 30 — the new abandoned-turn test brings it to 31).

No production imports changed in the fix pass (only intra-file control flow + the cancellation flag), so the earlier electron `build-main` result stands. No commit made.
