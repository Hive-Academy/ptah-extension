# Fix round — end-to-end budget for `agent:getLanePlanLimits`

Round 1 of the review loop. Scope: the Serious finding only
(`code-logic-review.md` finding 1, REVISE 5/10). The Moderate finding
(renderer timeout rows can stay current-looking) is recorded as a follow-up
and is not touched. `git:info` is not touched.

## The finding, restated

The 8 s lookup deadline started AFTER the unbounded cold `agent.list()`
detection/registry listing. A list slower than about 2 s made the handler
exceed the renderer's 10 s RPC deadline even with a legal lookup, and a hung
list left the handler pending forever.

## Files and lines changed

Both files were already in the task diff; no other file was edited.

- `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts`
  - `:48-62` — the constant is renamed `LANE_PLAN_LIMITS_RPC_BUDGET_MS`
    (8 s) and its doc comment now states the end-to-end scope: entry clock,
    detection + listing + lookup + formatting, all inside the caller's 10 s.
  - `:108-111` — `startedAt = Date.now()` is the first statement of the read
    in `getLanePlanLimits`, before the API build, the list and the lookup.
  - `:122-147` — `lookup(startedAt)`: `agent.list()` is awaited through the
    new `bounded()` race; `agent.limits()` receives
    `Math.max(BUDGET - elapsed, 0)` — only the remaining time.
  - `:149-181` — new private `bounded(step, startedAt, stage)`: races one
    step against the remaining budget, clears its timer in `finally`,
    `unref`s it, and swallows a late rejection of the losing step.
- `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.deadline.spec.ts`
  - `:64-76` — hardcoded `HANDLER_BUDGET_MS` (8 s) and `UNAVAILABLE` text,
    with keep-in-sync comments (module-private constants).
  - `:128-184` — doubles: `apiWithSlowList(listMs)` (list consumes `listMs`
    before any row exists), `apiWithHungList()` (list never settles), and the
    shared `makeDeadlineHonoringLimits()` extracted from the old inline fake.
  - `:215-221` — `afterEach` now asserts `jest.getTimerCount() === 0` before
    restoring real timers: no timer leaks in any test of the describe block.
  - `:273-308` and `:310-333` — the two new tests (below).

## The budget mechanism

1. The clock starts at handler entry (`getLanePlanLimits`). One budget,
   8 s, covers the whole read. The renderer's deadline is 10 s, so the 2 s
   margin covers formatting and IPC.
2. `agent.list()` runs inside a race against the whole remaining budget
   (`bounded`). If the list misses it, the handler answers with the fixed
   `UNAVAILABLE` text through the existing error path — the same well-formed
   response a rejected list already produced, not a hang.
3. When the list wins, the lookup receives only `budget - elapsed`, with a
   floor of 0. The lookup service treats `deadlineMs: 0` as a real deadline
   (`options.deadlineMs ?? …` at
   `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:155`),
   so a list that consumed the whole budget still yields 'timeout' rows: a
   well-formed partial result, never a late reply.
4. The losing step keeps running behind the race. Cold CLI detection
   deduplicates its in-flight promise, so the next read reuses that work;
   a late rejection is swallowed in `bounded` so it cannot surface as an
   unhandled rejection after this read answered.
5. The response shape is unchanged: the success payload keeps
   `rows/lanes/atLimit/nearLimit/unknown/asOf`, and the failure path keeps
   the fixed text.

## New spec coverage

In `lane-plan-limits-rpc.deadline.spec.ts`, fake timers throughout:

- "gives the lookup only the budget a slow cold list leaves, so the reply
  still lands inside the renderer deadline" — a 6 s list, then the advance
  stops at 8 s: the reply is already there, `limits` received
  `deadlineMs <= 2_000`, and every lane is a partial 'timeout' row.
- "answers with the fixed unavailable text, inside the renderer deadline,
  when the lane list never settles" — a never-settling list: the handler
  rejects at 8 s with the fixed `UNAVAILABLE` message and never calls
  `limits`.
- The `afterEach` leak guard asserts `jest.getTimerCount() === 0` after
  every test in the block.

## Verification

`npx jest -c libs/backend/rpc-handlers/jest.config.ts lane-plan-limits-rpc --coverage=false --maxWorkers=1 | tail -20`:

```
Test Suites: 2 passed, 2 total
Tests:       34 passed, 34 total
Time:        16.746 s
```

34 = 29 handler contract tests + 5 deadline tests (3 before this round + the
2 new ones). Before this round the same command passed with 32: the two new
tests are the added coverage. No typecheck, lint or workspace-wide run was
executed (the orchestrator runs those). Electron was not launched; a peer
session's Electron announcement needed nothing from this lane.

## Not done

- The Moderate finding (stale timeout rows in the renderer) — follow-up.
- `git:info` — outside this round's scope by instruction.
- `rpc-timeout-investigation.md` still describes the round-1 lookup-only
  deadline by its old name; it is the previous lane's historical record and
  this report supersedes its "Fix" section.