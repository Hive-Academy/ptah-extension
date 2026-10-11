# Batch 4 report — TASK_2026_626_7b3e (Adapter port + callback registry)

Executor: backend-developer (sub-agent). No git commands run.

## Tasks

### Task 4.1 — `IAgentAdapter.setLiveStatsCallback` + registry — DONE

- `libs/shared/src/lib/types/agent-adapter.types.ts`: added
  `setLiveStatsCallback(cb: LiveStatsCallback): void` directly after `setResultStatsCallback` on
  `IAgentAdapter`, with a short doc comment saying it is provisional and has no footer, budget or activity side
  effects. `LiveStatsCallback` / `SessionStatsLivePayload` already existed from Batch 1 (same file, :98-119).
- `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.ts`: new
  `private liveStats: LiveStatsCallback | null = null`, `setLiveStats(cb)`, and `getLiveStats()`, which returns
  `undefined` when the slot is empty, the same as its siblings. `clear()` now also nulls `liveStats`. The type
  comes straight from `@ptah-extension/shared`, as `stream-transformer.ts:25` and `live-session-stats-publisher.ts:31`
  already do, so `helpers/index.ts` needed no re-export.
- `sdk-adapter-callback-registry.spec.ts` changes:
  - "starts empty" now also covers `getLiveStats()`.
  - "stores identity" covers set/get.
  - "clear() empties every slot" covers clear.
  - New case: the live-stats slot is independent of the result-stats slot.

### Task 4.2 — SdkAgentAdapter threads the callback — DONE

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`:
  - Added `type LiveStatsCallback` to the `@ptah-extension/shared` import.
  - Added `setLiveStatsCallback(callback)` right after `setResultStatsCallback`. It delegates to
    `this.callbacks.setLiveStats(callback)`, and its doc comment explains why it is not wrapped.
  - `onLiveStats: this.callbacks.getLiveStats()` is now passed at all four `streamTransformer.transform({...})`
    call sites:
    - :916 — `startChatSession`
    - :1075 — `resumeSession` active reuse
    - :1222 — `resumeSession` cold
    - :1583 — `executeSlashCommand`
  - The callback is NOT wrapped by `wrapResultStatsForActivity`.
  - No Stop/end-path production code was added. `interruptSession`, `endSession`, `endSessionIfTokenMatches`
    and workspace teardown are unchanged; the settle comes from `statsOwner.release`, which Batch 2 added.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`:
  - Imports and helpers:
    - New imports: `ModelPricing`, `SessionStatsLivePayload`, `LiveSessionStatsPublisher`, `LiveStatsClock`,
      `IModelResolver`.
    - New helpers: `ManualClock`, a `LiveStatsClock` whose timers never fire on their own and which exposes
      `pending`, and `liveAssistantFrame(...)`.
  - `callback wiring` describe:
    - "passes no live-stats callback when none is registered (publisher inert)": `onLiveStats` is `undefined`.
    - "threads the registered live-stats callback, unwrapped, into all four streams": it drives
      `startChatSession`, a cold `resumeSession`, an active-reuse `resumeSession` and `executeSlashCommand`.
      It asserts that every transform config's `onLiveStats` is the SAME function registered via
      `setLiveStatsCallback`, so it was not wrapped. It then invokes each one and asserts
      `sessionBudget.observe` was never called.
  - `session stats ownership` describe — "settles an open live estimate exactly once when Stop releases the owner".
    It follows the shape of "releases the owner when init binds the canonical id while the interrupt awaits": a
    real `SessionStatsOwnerService` and a mocked `streamTransformer.transform`. Steps:
    1. Register a spy with `setLiveStatsCallback`, then `startChatSession({ tabId: 'tab_stop' })`.
    2. `onSessionIdResolved('tab_stop', SESSION)` from the captured config.
    3. Build a real `LiveSessionStatsPublisher` from that config's `onLiveStats`, `statsGeneration`, `runToken`
       and `h.statsOwner`, using the manual clock.
    4. `setSessionKey(SESSION)`, then `observe` one assistant frame. Result: one `provisional: true` payload
       carrying `context`, at revision L.
    5. `endSession` returns a deferred, then `interruptSession(SESSION)`. Before it resolves, there is still only
       one payload.
    6. Resolve. Result: exactly one more payload with `sessionId === SESSION`, no `provisional`, revision > L and
       no `context` key. The owner is released.
    7. Check that this was not a new turn: `executeQuery` was called once, `readSessionUsagePrefix` was never
       called (no resume), and `transform` was called once.
    8. `publisher.dispose()`, which is the stream's late `finally`. Result: no further payload, `clock.pending === 0`,
       and `sessionBudget.observe` was never called.

## Other IAgentAdapter implementors / test doubles

I searched with Grep for `IAgentAdapter` and for `implements|satisfies|: IAgentAdapter = {|jest.Mocked<IAgentAdapter>|as IAgentAdapter`
across `libs/` and `apps/`:

- `SdkAgentAdapter` (`sdk-agent-adapter.ts:121`) is the only `implements IAgentAdapter`.
- Every test double is an `as unknown as IAgentAdapter` cast. The files are `surface-rpc-harness.ts:187`,
  `peer-session-messenger.service.spec.ts:52`, `gateway-chat-bridge.spec.ts:442`,
  `chat-stream-broadcaster.service.spec.ts:157`, and several `chat-session*.spec.ts` and `surface-submit-turn*.spec.ts`
  files. These casts are not checked against the new member, so none of these files fail typecheck.
- No other project needed a change, so no extra typecheck was required.
- The runtime-side mock in `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts` (`setResultStatsCallback: jest.fn()`
  at :63, :243, :454, :512, :638) will need `setLiveStatsCallback` once Batch 5 calls it. That is in Batch 5's
  scope (Task 5.2, as the plan-validation assumptions note), so I did not touch it.

## Risks handled

| Risk | Handling |
| ---- | -------- |
| Stop releases the owner before stream disposal and strands an estimate (HIGH) | Integration case above. The settle arrives from `release` after the teardown await (and not before it), only once, with a higher revision, no `provisional` and no `context`. The late `dispose()` emits nothing and leaves no timer. No Stop-specific production code. |
| Live path triggers result-path side effects / budget (HIGH) | The callback is passed unwrapped. The spec asserts the transform config's `onLiveStats` is the exact registered function at all four sites, and that invoking it (and the Stop flow) never calls `sessionBudget.observe`. |
| A required `IAgentAdapter` member breaks agent-sdk typecheck (MEDIUM) | The port member and its only implementor landed together. Typecheck passes for shared and agent-sdk. No other class implementors exist. |
| Callback absent → publisher inert | The spec asserts `onLiveStats` is `undefined` when nothing is registered. The publisher is inert in that case (`live-session-stats-publisher.ts` constructor). |

## Verification (serial, one at a time, output tailed)

I created a temporary junction from `node_modules` to `D:/projects/ptah-extension/node_modules` and removed it
afterwards (link only, with `cmd /c rmdir`; the target was confirmed intact).

1. `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts --coverage=false --maxWorkers=2`
   → `Test Suites: 2 passed, 2 total` / `Tests: 120 passed, 120 total`
2. `npx nx typecheck @ptah-extension/shared --parallel=1 --skip-nx-cache`
   → `Successfully ran target typecheck for project @ptah-extension/shared`
3. `npx nx typecheck @ptah-extension/agent-sdk --parallel=1 --skip-nx-cache`
   → `Successfully ran target typecheck for project @ptah-extension/agent-sdk` (no `error TS`)
4. `npx nx lint @ptah-extension/agent-sdk --parallel=1 --skip-nx-cache`
   → `✖ 52 problems (0 errors, 52 warnings)`, which matches the Batch 2/3 baseline. The only entries for Batch 4
   files are two warnings in `sdk-agent-adapter.ts` that were already there: `max-lines` and an unrelated
   `no-useless-assignment` at :317. There are none for the registry or the specs.

Not run (by rule): build/serve/e2e/package and workspace-wide checks.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/shared/src/lib/types/agent-adapter.types.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/.ptah/specs/TASK_2026_626_7b3e/batch-4-report.md`

## Plan deviations

None. The `IAgentAdapter` member landing in Batch 4 rather than Batch 1 was already recorded in batches.md
(Execution defaults).

## Out-of-scope observations

- `sdk-callbacks.spec.ts` adapter mocks lack `setLiveStatsCallback`. Batch 5 must add it, otherwise the wiring
  call throws inside `wireSdkCallbacks`' try block (already flagged in batches.md assumptions).
