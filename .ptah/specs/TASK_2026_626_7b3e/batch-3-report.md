# Batch 3 report — TASK_2026_626_7b3e (StreamTransformer wiring)

Executor: backend-developer (resumed after an interrupted run). No git command was run.

## Task 3.1 — status: IMPLEMENTED, awaiting team-leader verification run

Note: no jest, typecheck or lint run happened in this batch, as the brief instructed. The only checks
were `ptah_get_diagnostics` and prettier.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts`

No other file was touched. `libs/frontend/**` was not touched; the frontend diffs in `git diff --stat` belong to
the parallel executor.

## How the partial work was handled

I read the uncommitted diff with `git diff -w`. It is +56 lines and contains only additions: the rest of
`+332/−276` is re-indentation. That re-indentation is unavoidable because the plan (C4, `:647-656`)
requires the result branch body to sit inside `try { … } finally { livePublisher.settle(); }`.
I checked the partial work against plan C4 and the publisher API (`live-session-stats-publisher.ts`) and
found it correct and complete, so I **kept it as is** and made only two fixes:

- I re-wrapped two lines that the re-indentation had pushed past prettier's width (the `costUSD` ternary and the
  `totalCost:` property inside `replaceRun`). After this, prettier reports only one difference in the file. It is
  at `runGuardedCallback`, `callbackError instanceof Error ? …`, and it is already present at HEAD (`git show HEAD:` line 350).
  I left it alone.
- Nothing else was rewritten.

Final whitespace-insensitive size: `git diff -w --stat` → `stream-transformer.ts | 63 +++++++-` (additions plus the 2 re-wraps).

### Wiring, checked against the plan

| Plan C4 requirement | Where |
| --- | --- |
| Optional `onLiveStats?: LiveStatsCallback` in `StreamTransformConfig`, with a doc comment (provisional, throttled, not a completion signal, the budget never sees it) | config interface, after `onResultStats` |
| The publisher is constructed after `messageTransformer`. `readMainContext` closes over `currentStreamModel` / `lastTurnContextByModel` and returns `input + cacheRead + cacheCreation` or `null` | top of the async iterator, after the per-turn tracker state; it is per stream, so it is built inside the iterator, as the trackers are |
| `setSessionKey(realSessionId as SessionId)` after `onSessionIdResolved` | `isSystemInit` block |
| `observe(sdkMessage)` once per message, after the context-tracking block and after `init` | before the plan-limit block |
| `onResult()` right after `onTurnEnd?.()`, before any `await` | top of the single `isResultMessage` branch (the only result branch: `grep isResultMessage` → the branch plus the forward filter) |
| `try { … } finally { settle() }` around the rest of the branch, ending after the `onResultStats` block and before `isCompactBoundary` | as specified |
| `dispose()` in the stream's `finally`, after `activityWatchdog?.stop()` and before `onStreamEnd` | as specified |

`ptah_get_diagnostics` on both files reported 0 errors and 0 warnings.

## Risk handling

- **`onResultStats` on the same branches as before.** The `try/finally` only wraps the existing code. No
  condition, call or ordering in the branch changed (the `-w` diff shows no changed line inside it). Spec: every
  result exit runs twice, with and without `onLiveStats`, and asserts that the `onResultStats` payloads are equal
  once `sessionStats.revision` is removed. The revision is the only field estimates can change, because they
  advance the owner's counter. The spec also asserts the expected call count per exit.
- **No behaviour change without `onLiveStats`.** The publisher is inert in that case (`inert = !onLiveStats ||
  statsGeneration === null`): no timer, no watcher, no owner calls. Spec "without onLiveStats" asserts
  `jest.getTimerCount() === 0`, no live payloads, a non-provisional `sessionStats`, and the same `onResultStats`
  as a live stream.
- **Live after authoritative (HIGH).** `onResult()` runs before any await. The spec asserts that the `onResultStats`
  revision is greater than the last live revision, and that nothing but the single settle payload is emitted after
  the result, even after advancing 5 intervals.
- **Settle on every exit.** One `it.each` row per exit: accepted (the settle snapshot equals the `onResultStats`
  snapshot), duplicate, rejected-non-monotonic, rejected-invalid, empty usage, `markRunIncomplete`, and a
  `validateStats` rejection (`duration_ms: -1`). Each row asserts exactly one settle payload, no `provisional`,
  no `context`, and a revision greater than L.
- **Stop before dispose (HIGH).** This is the integration case, using the real owner from `startNew` and the
  `rebind` in `onSessionIdResolved`. Steps: show an estimate, arm a trailing timer, call
  `owner.release(owner.leaseOf(SESSION))` while the stream is open, then end the stream. Asserted: exactly one
  settle payload (above L, no context), nothing from `dispose`, `onStreamEnd` called once, and
  `jest.getTimerCount() === 0`. The mirror order is also covered: the stream ends first, then `release`, giving
  exactly one payload, from `dispose`.
- **Timer leaks.** The test checks `jest.getTimerCount() === 0` after the stream end, stream error and Stop cases.
- **A throw still propagates.** The stream-throw case resolves the consumer to the original error. It produces
  one settle payload from `dispose` and calls `onStreamEnd` once.

## Spec coverage (`stream-transformer.live-stats.spec.ts`)

The spec uses a scripted, held-open `sdkQuery`. Its `feed` resolves when the transformer asks for the next message.
Jest fake timers are on, with `nextTick`, `queueMicrotask` and `setImmediate` left real. The owner is the real
`SessionStatsOwnerService`. Cost source is `reported`, so the result path awaits nothing. It covers the following
cases:

- Main-loop and subagent frames are summed into `tokenCount`, with per-`message.id` dedupe on a grown frame.
  `stream_event` frames are not counted, and the throttle coalesces frames.
- Agent count, with the hook late (`task_started`, then `recordAgent`) and early (`recordAgent`, then
  `task_started`): `agentSessionCount` is 1 within one interval, before any result.
- Result supersedes the estimate, and no payload follows except the settle.
- The 7 result exits described above.
- A turn with no estimate produces no settle payload.
- Stream end and stream throw after an estimate each settle once.
- Second turn: live total = authoritative result-1 + turn-2 estimate.
- `context` appears on provisional payloads after `message_start`. It is absent after `compact_boundary` and on
  the settle payload of a result whose `modelUsage` context differs.
- Stop integration in both orders.
- Without `onLiveStats`.

These expectations depend on owner behaviour that I read from source but have not yet seen run. The serial
verification run should confirm them:

- The canonical subagent id `agent-a1` counts as 1 agent.
- `replaceRun` returns a snapshot on `rejected-invalid` (`-1` input tokens).
- Jest's fake `setTimeout` handle supports `unref()`, which the publisher's `REAL_CLOCK` calls.

## Verification for the team-leader (from batches.md, run serially)

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts libs/backend/agent-sdk/src/lib/helpers/stream-transformer.plan-limits.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`; then `npx nx lint @ptah-extension/agent-sdk --parallel=1`

## Plan deviations

None. The publisher is built inside the async iterator rather than right beside `messageTransformer`, because
`readMainContext` must close over the per-stream tracker state that is declared there. The plan's intent is a
closure over those variables, so this placement is required to follow it.

## Out-of-scope observations

- `stream-transformer.ts` has prettier drift at HEAD in `runGuardedCallback` (`callbackError instanceof Error ? …`).
  It predates this batch and was not touched.
