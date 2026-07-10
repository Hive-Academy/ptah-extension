# Test Report — TASK_2026_155 Batch 3 (tests & verification gates)

**Scope**: Tasks 3.1–3.3 only — unit tests proving Batch 1 (agent-sdk: F1 permission-level threading, F2 unroutable deny-timeout) and Batch 2 (gateway-chat-bridge: F1 consumption, F2 removal of the racy flip, F3 turn watchdog, F4 premium parity) behave as specified, plus the three final verification-gate commands. No production code was permanently changed (two temporary sanity-check breakages were applied and reverted — see below; diffs confirmed byte-identical to the Batch 1/2 state afterward).

---

## New/updated spec files

### 1. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts` (NEW)

No spec existed for `SessionQueryExecutor` before this batch. Follows the sibling `session-registry.service.spec.ts` pattern: uses the **real** `SessionRegistry` (not a mock) so `rec.permissionLevel` is observed via actual mutation, plus mocked `SdkModuleLoader` / `SdkQueryOptionsBuilder` / `SdkMessageFactory` / `SdkQueryRunner` / `ISdkPermissionHandler`. No real SDK is invoked. `import 'reflect-metadata'` added at the top (required because the executor's dependency chain pulls in tsyringe-decorated classes).

| Test | Proves |
| --- | --- |
| `config.permissionLevel = "yolo"` seeds `rec.permissionLevel` and maps to SDK `permissionMode "default"` (never `bypassPermissions`) | The caller-supplied level wins, `rec.permissionLevel === 'yolo'`, and the options builder receives `permissionMode: 'default'` — explicitly asserts `!== 'bypassPermissions'`, the load-bearing invariant from `permission-mode-map.ts`. |
| `config.permissionLevel` omitted falls back to the GLOBAL `permissionHandler.getPermissionLevel()` (global = `'auto-edit'`) | `getPermissionLevel()` is called exactly once, `rec.permissionLevel === 'auto-edit'`, builder receives `permissionMode: 'acceptEdits'` — byte-identical to pre-F1 behavior. |
| `config.permissionLevel` omitted, global = `'ask'` | Fallback also correctly seeds `'ask'` (the special-case branch in `executeQuery` for the ask→default mapping). |
| `config.permissionLevel = "auto-edit"` maps to SDK `permissionMode "acceptEdits"` | Caller-supplied level wins over the global getter, which is asserted **not called** at all in this case. |

**Sanity check (reasoned, not re-run)**: if the seed line were reverted to `const currentLevel = this.permissionHandler.getPermissionLevel();` (ignoring `config.permissionLevel`), test 1 would seed `rec.permissionLevel` from the global mock (`'ask'`) instead of `'yolo'`, failing the `rec?.permissionLevel).toBe('yolo')` assertion. This is a straightforward, deterministic seam (no timers/races involved), so an actual break-and-revert was judged unnecessary; the instruction singled out the watchdog and timeout tests for the mandatory actual sanity check, which were performed (see below).

### 2. `libs/backend/agent-sdk/src/lib/sdk-permission-handler.spec.ts` (UPDATED — appended one new `describe` block)

New block: `SdkPermissionHandler - F2 unroutable deny-timeout (TASK_2026_155, Task 1.4)`. Uses `jest.useFakeTimers()` / `jest.useRealTimers()` scoped per-test (`try/finally`), matching the existing `pending-response-registry.spec.ts` convention in this repo. Internal `pendingRequests`/`pendingRequestContext` maps are inspected via cast, the same white-box technique already used in `session-registry.service.spec.ts` to check private `Map` state.

| Test | Proves |
| --- | --- |
| Unroutable request (non-UUID `sessionId`, no `tabId`), no response → after `jest.advanceTimersByTimeAsync(60_000)` resolves `deny`, `pendingRequests`/`pendingRequestContext` no longer contain the id, a "timed out" warn was logged, exactly one timer was armed pre-advance and zero remain after | Full F2 acceptance criterion: unroutable + silent → deny-after-60s + cleanup + log. |
| Routed request (valid UUID `sessionId`), no response → after `jest.advanceTimersByTimeAsync(120_000)` the request is still in `pendingRequests` (never denied) | No timer is armed at all for routable requests (`jest.getTimerCount() === 0` immediately after the request is sent) — routable webview prompts keep the pre-F2 infinite wait. |
| A real `handleResponse('allow')` arrives before the 60s window on an unroutable request | Resolves `allow`, and `jest.getTimerCount()` returns to `0` — proves `clearTimer()` actually ran in the resolve wrapper (no leaked timer, no double-resolve). |

**Sanity check (actually performed)**: temporarily replaced `isRoutablePermissionRequest` with `return true;` (forcing every request to be classified routable) in `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`, then ran `npx nx test agent-sdk -t "unroutable deny-timeout"`. Result: **2 of 3 new tests failed** — the "unroutable...resolves deny" test failed (`jest.getTimerCount()` was `0` instead of `1`, since no timer was ever armed) and the "timer-cleared" test failed the same way; the "routable...never denied" test still passed (expected, since it asserts the no-timer case). This confirms the tests genuinely exercise the production guard, not a tautology. The file was reverted via `cp` from a pre-edit backup and diffed byte-identical to the Batch 1 state before re-running the full suite (all green again).

### 3. `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` (UPDATED — appended three new `describe` blocks)

Reuses the existing `setup()` harness (already wired for premium collaborators by Batch 2) and the file's `scriptedStream` / `makeEvent` / `flushUntil` helpers. New watchdog tests use `jest.useFakeTimers()` / `jest.advanceTimersByTimeAsync(...)`, scoped via a `describe`-local `afterEach(() => jest.useRealTimers())` so they don't affect the other (real-timer, `flushUntil`-based) tests in the file.

**Block: `GatewayChatBridge — F1 resume permissionLevel + bindSession (Task 2.1/2.2/3.3)`**

| Test | Proves |
| --- | --- |
| `resumeSession` receives `permissionLevel: "yolo"` on the canResume fast path | F1 on the `isSessionActive === true` resume branch. |
| `resumeSession` receives `permissionLevel: "yolo"` on the try/catch resume-recovery path (`isSessionActive === false`, persisted id still attempted first) | F1 on the second resume call site tasks.md explicitly calls out. |
| `bindSession` never calls `setSessionPermissionLevel`, still calls `setPtahSessionId` with the resolved UUID | F1/F2's "racy flip removed" — consolidates the two assertions the existing `'auto-approves via the initial yolo...'` test already partially covers, phrased to match the acceptance criteria literally. |

**Block: `GatewayChatBridge — turn watchdog (Task 2.3/3.3)`**

| Test | Proves |
| --- | --- |
| A stream that never settles (async iterator awaiting a promise that never resolves) is force-terminated after `TURN_WATCHDOG_MS` (10 min, hardcoded to match the production module constant, which is not exported): `endSession` called exactly once (idempotency proven via a **stateful** `isSessionActive`/`endSession` mock pair — `isSessionActive` flips to `false` only once `endSession` is actually invoked, mirroring real adapter semantics rather than relying on a static mock default), exactly one `"This request took too long..."` error chunk appended, and — the core F3 guarantee — a second turn enqueued behind the first on the same conversation key actually runs to completion (`startChatSession` called twice, `completeOutboundTurn` called twice) | The whole point of F3: a wedged turn cannot permanently wedge the `ConversationQueue`. |
| A fast (immediately-resolving) turn under fake timers: after completing, advancing time by `TURN_WATCHDOG_MS + 60s` produces no additional error reply and `jest.getTimerCount() === 0` | The watchdog timer is cleared in the `finally` on normal completion — a settled turn never later fires the timeout reply. |

**Sanity check (actually performed)**: temporarily replaced `await Promise.race([turnWork(), watchdog]);` with `await turnWork();` in `gateway-chat-bridge.ts` (removing the watchdog race entirely, while leaving the `timedOut`/`watchdog` timer setup in place so the change is minimal and surgical), then ran `npx nx test gateway-chat-bridge -t force-terminated`. Result: **test failed** — `h.adapter.endSession` received 0 calls instead of 1, because `runTurn` now hangs forever on `await turnWork()` (the hanging stream never settles) and the `finally`/timeout-handling code is never reached within the test's fake-timer window. This confirms the watchdog test genuinely depends on the `Promise.race` guard. Reverted via `cp` from a pre-edit backup; `diff` against the backup confirmed byte-identical to the Batch 2 state before re-running the full suite (all green again).

**Block: `GatewayChatBridge — premium parity (Task 2.4/3.3)`**

| Test | Proves |
| --- | --- |
| Premium license (`{ valid: true, tier: 'pro' }`) + live MCP port (`getPort()` non-null) → `startChatSession` config carries `isPremium: true`, `mcpServerRunning: true`, the resolved `enhancedPromptsContent`, and the resolved `pluginPaths`; `codeExecutionMcp.ensureRegisteredForSubagents()` was called | F4 parity for the premium path, matching `chat-session.service.ts`'s behavior. |
| Non-premium license (`{ valid: false, tier: 'free' }`, `getPort()` returns `null`) → `startChatSession` config carries `isPremium: false`, `mcpServerRunning: false`, `enhancedPromptsContent`/`pluginPaths` both `undefined`, `ensureRegisteredForSubagents` never called, and the turn still completes (`completeOutboundTurn` called once, no throw) | F4's defensive-degrade requirement: a non-premium/failed resolution never breaks the turn. |

A one-line lint fix was required in the new hanging-stream generator (`require-yield`): added an unreachable `yield` after the never-resolving `await`, matching the existing pattern used at the top of the same file for the "mid-stream boom" test's `AsyncIterable`.

---

## Full gate outputs (run from worktree root `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang`)

### `npx nx run-many -t test --projects=agent-sdk,gateway-chat-bridge,messaging-gateway --skip-nx-cache`

```
> nx run @ptah-extension/agent-sdk:test
Test Suites: 59 passed, 59 total
Tests:       697 passed, 697 total   (baseline before Batch 3: 690 — +7 new: 4 executor + 3 permission-handler)

> nx run @ptah-extension/messaging-gateway:test
Test Suites: 1 skipped, 11 passed, 11 of 12 total
Tests:       22 skipped, 112 passed, 134 total   (untouched by Batch 3, unaffected)

> nx run @ptah-extension/gateway-chat-bridge:test
Test Suites: 2 passed, 2 total
Tests:       30 passed, 30 total   (baseline before Batch 3: 23 — +7 new)

NX   Successfully ran target test for 3 projects
```

**PASS** — all three projects, 0 failures.

### `npx nx run-many -t typecheck --projects=agent-sdk,gateway-chat-bridge,messaging-gateway,shared --skip-nx-cache`

```
> nx run @ptah-extension/shared:typecheck              (tsc --noEmit) — clean
> nx run @ptah-extension/messaging-gateway:typecheck    (tsc --noEmit) — clean
> nx run @ptah-extension/agent-sdk:typecheck            (tsc --noEmit) — clean
> nx run @ptah-extension/gateway-chat-bridge:typecheck  (tsc --noEmit) — clean

NX   Successfully ran target typecheck for 4 projects
```

**PASS** — all four projects, 0 errors.

### `npx nx run-many -t lint --projects=agent-sdk,gateway-chat-bridge --skip-nx-cache`

```
> nx run @ptah-extension/gateway-chat-bridge:lint
✔ All files pass linting

> nx run @ptah-extension/agent-sdk:lint
✖ 31 problems (0 errors, 31 warnings)
  - all pre-existing @typescript-eslint/no-non-null-assertion warnings in
    already-established spec files (session-lifecycle-manager.spec.ts,
    ask-user-question.service.spec.ts, exit-plan-mode.service.spec.ts,
    sdk-permission-handler.spec.ts — same `broadcast!.payload` pattern the
    new F2 tests reuse) plus one pre-existing warning in sdk-model-service.ts.
    None introduced by Batch 3; the new session-query-executor.service.spec.ts
    produces zero lint output.

NX   Successfully ran target lint for 2 projects
```

**PASS** — 0 errors on both projects (agent-sdk has only pre-existing warnings, none newly introduced; the `require-yield` error initially introduced by the watchdog test's hanging-stream generator was fixed by adding an unreachable `yield`).

---

## tasks.md updates

Batch 3 markers updated: Task 3.1, 3.2, 3.3 → `🔄 IMPLEMENTED`. No commit made (per instructions — team-leader owns commits after review).

## Files touched

- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts` (new)
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/agent-sdk/src/lib/sdk-permission-handler.spec.ts` (appended)
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` (appended)
- `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/.ptah/specs/TASK_2026_155/tasks.md` (Batch 3 markers)

No production source files have any net changes from this batch — both sanity-check breakages (`sdk-permission-handler.ts`, `gateway-chat-bridge.ts`) were reverted and diff-confirmed byte-identical to the pre-breakage (Batch 1/2) state.
