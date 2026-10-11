# Batch 2 report — TASK_2026_626_7b3e

Executor: backend-developer (sub-agent). Status: both tasks implemented. The batch's scoped checks
(jest / typecheck / lint) still have to be run serially by the team-leader. The executor was told
not to run them.

## Tasks

### Task 2.1 — SessionStatsOwnerService provisional run, live snapshot, watchers, release settle: IMPLEMENTED

- `RunState.provisional: readonly RunModelUsage[] | null` (initialised `null` in `createRun`).
- Exported `OwnerWatcher { onAgentRecorded(); onReleased(settled) }`; `OwnerState.watchers: Set<OwnerWatcher>`
  (initialised in `createState`).
- `publishLive(sessionKey, generation, runToken, estimate)`: returns `null` when the generation is stale or
  absent, or while `pending !== null`. Invalid rows are dropped through the new `isValidModelUsage`, which
  `isValidResult` now also uses, so the rules are not duplicated. With valid rows it sets the run's
  `provisional`, calls `touch`, and returns a frozen live build marked `provisional: true` that is not cached.
  With `null`, or no valid rows, it changes nothing: it returns a live build without a touch while any run
  holds an estimate, and otherwise the cached `publish()` object.
- `publish()` now only handles caching. The contribution and aggregation code moved into one private
  `build(sessionId, state, live)`, so the arithmetic is shared. Estimates are added as
  `runContribution(estimateResult(rows))`: `costSource: 'unreported'`, and the total is the sum of the
  rows, or `null` if any row is unpriced.
- `clearProvisional(sessionKey, generation, runToken)`: clears the estimate and calls `touch` only when the
  run exists and holds one. It never creates a run or an owner.
- `watch(sessionKey, generation, watcher)`: returns a detach function bound to that state object, so it
  still works after `rebind`, or `null` when the generation is stale.
- `recordAgent`: notifies `onAgentRecorded` after the add and touch, only on its `true` path. The return
  value is unchanged.
- `release(lease)`: the signature, the boolean result and the lease rule are unchanged. Only on the branch
  where both generation and epoch match: when no prefix read is pending, it clears every run's
  `provisional`, touches if any was set, and builds `settled = publish(key, state)`; otherwise
  `settled = null`. It then deletes the state, clears its watcher set, and calls `onReleased(settled)` on a
  copy of the set. The `false` branches notify nobody. `startNew` and `clearAll` notify nobody either; the
  doc comment on `clearAll` now says so.
- Each watcher call is wrapped in try/catch by `notifyWatchers`, with a `degradation-audit` comment. The
  owner still logs nothing.
- `snapshot()` is unchanged and never includes an estimate.

### Task 2.2 — LiveSessionStatsPublisher: IMPLEMENTED

- Exports `LIVE_STATS_INTERVAL_MS = 1000`, `LiveStatsClock`, `MainContextReading`,
  `LiveSessionStatsPublisherOptions` and `LiveSessionStatsPublisher`.
- The default clock calls `unref`, following the `turn-state-foreground-source.ts` precedent.
- Inert (no watcher, no timer, no owner call) when `onLiveStats` is absent or `statsGeneration === null`.
- `setSessionKey(id)` attaches the owner watcher and detaches any previous one first. It stays silent when
  `watch` returns `null`. Frames seen before `init` are published by the first flush.
- `observe(message)` parses `assistant` frames with a module-level Zod schema. Each counter becomes absent
  on its own when malformed (`.optional().catch(undefined)`, as in the ledger). It skips frames with no id,
  a `<…>` model, or all-zero or absent counters. Per `message.id` it keeps the max of each counter.
  `task_started`, or any `parent_tool_use_id`, requests a flush. The whole body is wrapped in try/catch.
- Throttle: at most one flush per interval. The first change flushes immediately; later changes go into
  one trailing timer. There is never more than one timer per stream.
- `onAgentRecorded` never flushes synchronously. It arms the timer with delay 0, or for the trailing slot.
- `flush()` aggregates rows per raw model and prices them with `resolveForCost` and `calculateMessageCost`.
  The cost is `null` when there is no pricing or the resolver throws. It passes rows only when the usage
  map changed, otherwise `null`, so an agent-count flush keeps the run's estimate. `context` is attached
  only when `sessionStats.provisional === true`, with the model mapped through `resolveForCost(...).modelId`.
- One `emitAuthoritative(snapshot)` is used by `settle`, `onOwnerReleased` and `dispose`. It never attaches
  `context`, and it always resets `estimateShown`.
- `onResult` cancels the timer, clears the map, calls `clearProvisional` and enters `settling`. `settle`
  leaves `settling` and emits only when an estimate was shown.
- `onOwnerReleased` cancels the timer, drops the detach function, marks the publisher `released`, and
  emits synchronously. It is honoured during `settling`.
- `dispose` is idempotent. It cancels the timer, detaches the watcher and clears the map. Unless the
  publisher was released, it calls `clearProvisional`, and emits the settle when an estimate was shown.
- Callback failures (thrown, or a rejected promise) are logged with `warn` once per failure kind per stream.
  Only the error name is logged, never the message, as `runGuardedCallback` does. Later publishes continue.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts` (new `describe('SessionStatsOwnerService live estimate (TASK_2026_626)')`, appended)
- CREATED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts`

`helpers/index.ts` is not touched: the plan names `StreamTransformer` as the only consumer.

## Evidence

- Spec coverage: the owner spec has every case listed in plan C2 :441-475. That includes `it.each` over
  the six result exits (accepted, duplicate, non-monotonic, invalid, incomplete, no-call), the two-run
  case, rebind and detach, stale-epoch and replaced-generation releases, `startNew` and `clearAll` with no
  watcher call, and a throwing watcher. The publisher spec has every case listed in plan C3 :593-628, run
  against the real owner with a `FakeClock`.
- `mcp__ptah__ptah_get_diagnostics` reported 0 errors and 0 warnings on all four files. It returned
  `analyzed: null`, so how far it actually checked the spec files is unknown.
- Not run, on instruction (one heavy check at a time across the machine). The team-leader runs these:
  - `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`, then `npx nx lint @ptah-extension/agent-sdk --parallel=1`

## Risks and edge cases

| Risk / edge case | Handling |
| --- | --- |
| A live estimate overwrites the authoritative figures | `publishLive` with rows always calls `touch`, and `clearProvisional`, settle and release clearing call `touch` too, so every authoritative snapshot built after a live one has a strictly greater revision. Covered by `it.each` over the 6 exits and the release-settle tests. The publisher attaches `context` only to provisional payloads. |
| Stop releases the owner before the stream is disposed | `release` settles through `onReleased(settled)` after the delete. `onOwnerReleased` emits once and sets `released`, so a later `settle`, `dispose`, frame, timer or `recordAgent` emits nothing. Tested in the release-first, release-mid-result and dispose-then-release cases. |
| Exactly one authoritative payload per shown estimate, whichever of release or dispose runs first | `emitAuthoritative` resets `estimateShown` on every path. A dispose that runs first detaches the watcher, so the later release finds none. A release that runs first sets `released`, so dispose skips. |
| Nothing is emitted after dispose | `disposed` blocks every path; `onOwnerReleased` returns when disposed; the watcher is detached. Tested by "dispose ... detaches", "idempotent, no timer" and "dispose first, then release". |
| No callback means no effect | The publisher is inert: no `watch`, no `publishLive`, no timer. The spec checks this with spies. A null generation is also inert. |
| The throttle timer leaks | One timer at most. It is cancelled by `onResult`, `onOwnerReleased` and `dispose`; the spec checks `clock.pending === 0`. |
| A throwing watcher breaks `release` or `recordAgent` | `notifyWatchers` catches each call separately, so later watchers still run. The publisher's own watcher bodies also catch. Tested by the throwing-watcher test and by "a throwing callback inside the release". |
| `task_started` is seen before the hook records the agent | `onAgentRecorded` arms a trailing flush and never flushes synchronously. The two-ordering spec (a)/(b) checks exactly one or two payloads, never a third. |
| Bind refused, or the owner is still under the tab key | `watch` returns `null`, so `sessionId` stays `null` and nothing is published. Covered by the "stays silent" spec. |
| `startNew` replacement or `clearAll` | No notification; tested. |

## Deviations and notes (for review)

1. **Identical payloads are not resent.** When a flush would emit a snapshot with the same revision and the
   same provisional kind as the last payload, it is skipped. Without this, repeated subagent frames with
   no usage change would resend the cached authoritative snapshot every interval. Payloads from
   `emitAuthoritative` are never skipped.
2. **`settle()` and `dispose()` clear the estimate again** before `publishLive(null)`. When `onResult` has
   already run, this is a no-op with no touch. It guarantees that a `settle` without a preceding `onResult`
   still yields an authoritative snapshot rather than this run's provisional one.
3. **Concurrent run on the same owner.** If another run of the same owner still holds an estimate, the
   settle payload is that run's provisional build (`provisional: true`, no `context`). This follows the
   plan's `publishLive(null)` rule, and the other stream settles its own estimate later.
4. **Frames seen before `setSessionKey`** are kept. If any were kept, `setSessionKey` requests a flush, so
   they publish with the first flush instead of waiting for the next frame.
5. **`setSessionKey` takes a `SessionId`**, not a plain string, so the payload's `sessionId` is typed
   without a cast. In Batch 3 the transformer passes `realSessionId as SessionId`, as it already does
   (`stream-transformer.ts:575`).
6. **Constructor options.** Options are passed as one object. `statsOwner` and `modelResolver` are typed as
   `Pick<…>` of the members actually used.

Out of scope: none observed.
