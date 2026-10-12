# Batch 5F report: Phase 1 fix round (S1, S2, M3, M4)

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`
(branch `fix/session-budget-handoff`). No git write commands were run, and `batches.md` was not edited.

## Files modified

- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-handoff-builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-handoff-builder.spec.ts`

## Task 5F.1: coordinator

### S1: the blocking limit beats the work gate

- `Operation.reason` is no longer `readonly`. A doc comment gives the reason.
- In `armAtTerminal`, when `atBlockingLimit` is true and the live operation is `budget-auto` in
  `waiting-for-turn-end`, the operation is converted in place. It becomes `reason = 'budget-limit'`
  with the same id. `waitingFor` and `waitingSince` are cleared and the revision goes up by one.
- The gate condition now reads `!atBlockingLimit` as well as `reason === 'budget-auto'`.
- After that, the existing path handles the operation:
  - The phase moves from `waiting-for-turn-end` to `armed`.
  - It then moves to `awaiting-confirmation`. If `userConfirmed` is set, `startAutomatic` runs
    instead and the phase becomes `writing-handoff`.
  - Held inputs move in under `HELD_SOURCE_PHASES`.
- A converted operation is `budget-limit`, so cancelling it does not add the source to
  `cancelledAutomaticSources`. The hard limit stays unsuppressed.

### S2: the work-in-flight wait is bounded

- Added `export const WORK_IN_FLIGHT_WAIT_LIMIT_MS = 900_000`. Its doc comment ties it to
  `MAX_AGENT_WAIT_MS` in cli-agent-runtime `agent-process-manager.service.ts` and explains why it is
  not imported (agent-sdk must not depend on cli-agent-runtime).
- Added a private `Operation.waitingSince?: number`. The gate stamps it with `Date.now()` the first
  time it finds work in flight (`??=`), so later terminals do not reset it.
- At each gate check where work is still in flight on a live operation and
  `Date.now() - waitingSince >= WORK_IN_FLIGHT_WAIT_LIMIT_MS`:
  - One WARN line is logged: `[SessionHandover] Work-in-flight wait limit reached; asking the user`,
    with `{ operationId, waitingFor, elapsedMs }`. `waitingFor` is the count read at this terminal,
    which is the latest value.
  - A local `waitLimitReached` sends the operation down the shared path: `waiting-for-turn-end`
    → `armed`, clearing `waitingFor` and `waitingSince`, then → `awaiting-confirmation`. The reason
    stays `budget-auto`. Queued inputs move in under `HELD_SOURCE_PHASES`, and the state is published
    once.
  - `userConfirmed` is always false on this path, because the gate requires it. So
    `startAutomatic` is never called, and running work is never cut off without a click.
- No timer, interval or poll was added. `armHandoverIfIdle` (in `session-lifecycle-manager.ts`)
  reaches the same check through `armAtTerminal`.
- `waitingSince` is cleared wherever an operation can leave `waiting-for-turn-end` and still be
  reused:
  - the move to `armed` in `armAtTerminal`
  - the S1 conversion
  - `confirmBudgetOperation`'s idle start

  As the validation notes require, `cancel`, `fail` and `sourceEnded` were not changed. They move the
  operation to a phase where it can be restarted, and an operation in that phase is never reused, so
  the leftover private stamp cannot be read again.
- `cancelledAutomaticSources` behaves as before. If an escalated `budget-auto` operation is cancelled,
  it stays suppressed until the hard limit (covered by a spec).

### M3: safe handoff window

In `requestAgentHandoff`:

- When `previousId` is undefined, every assistant message after the request is joined, as before
  (`slice(0)`).
- When `previousId` is found in the second read, the messages after it are used, as before.
- When `previousId` is set but missing from the second read (for example, a compaction trimmed it),
  only the last assistant message that has text is used. One DEBUG line is logged:
  `Handoff anchor not found; using the last assistant message`.

### M4 support: prompt length line

`'Keep the whole handoff under 5,000 characters.'` was added to `HANDOFF_REQUEST_PROMPT` just before
"Do not call tools". All seven headings are kept, in the same order.

### New coordinator specs

- S1: a waiting `budget-auto` operation reaches the blocking limit. Expected result: same
  operationId, `budget-limit`, `awaiting-confirmation`, no `waitingFor`, the held input moved in, no
  successor start.
- S1 variant: with a mid-turn `begin('successor', true)` first, the operation goes straight to
  `writing-handoff` as `budget-limit`.
- S2 (`jest.spyOn(Date, 'now')`):
  - At t0 the operation is waiting.
  - At t0 + limit - 1 it is still waiting, with no WARN. The stamp is not reset; the next step only
    escalates because of the t0 stamp.
  - At t0 + limit it is `awaiting-confirmation`, still `budget-auto`, with no `waitingFor`, the held
    input moved in, no `startSuccessorSession` or `queueOwnedHandoff` call, and exactly one WARN with
    `elapsedMs = limit`.
  - Then a single `begin('successor')` moves it to `writing-handoff`.
- S2: if the work drops to 0 before the limit, the handover still starts automatically, with no WARN.
- S2: an escalated operation that is then cancelled stays suppressed at the handoff stage. The
  blocking limit still produces a `budget-limit` confirmation.
- M3: when the anchor is missing from the second read, the handoff is the last assistant text only,
  with one DEBUG line. When there is no assistant before the request, all assistants are joined, with
  no DEBUG line.
- Prompt: the seven headings appear in order, and the length line comes after `## Next action` and
  before "Do not call tools".
- The harness logger gained `debug: jest.fn()`.

## Task 5F.2: builder (M4)

- New `capHeadAndTail(value, max)` and `lastHeadingStart(value, heading)` in
  `session-handoff-builder.ts`. `quoteWithin` calls `capHeadAndTail` where it used to call `capText`.
  `capText` itself is unchanged, so every other caller still keeps the head only.
- How `capHeadAndTail` cuts:
  - Text at or under `max` is returned unchanged.
  - Otherwise the tail is the text from the last line that starts with `## Still running`. If that
    heading is absent, it is the text from the last `## Next action`. The tail is used only when it
    fits in `floor(max / 2)`.
  - If it does not fit, or neither heading is present, the tail is the last `floor(max / 2)`
    characters, moved forward to a line start when one falls inside that window.
  - The head fills `max - tail - '\n[truncated]\n'.length`.
  - The result is `head.trimEnd() + '\n' + TRUNCATED_MARKER + '\n' + tail`, with `cut: true`.
- Surrogate pairs: the head end steps back off a high surrogate. A tail start that does not fall on
  a line start steps forward off a low surrogate.
- Termination: for `max < 2 * 13` (below any real budget), the function falls back to
  `capText(value, max, '\n')`. With that fallback, the output never exceeds `max`, and the
  `quoteWithin` shrink loop (strictly decreasing, with a floor at `minBudget`) still ends. The quoted
  section stays within `SESSION_HANDOFF_LIMITS.agentHandoffChars` (6,000).
- Spec changes:
  - New: a 9,000-character handoff with all seven headings, where `## Still running` and
    `## Next action` come last. The quoted section is at most 6,000 characters, has exactly one
    marker, starts with `## Goal`, and ends with the marker followed by the full quoted
    `## Still running` and `## Next action` text.
  - New: over the cap with no headings, both the head (`HEAD-START`) and the tail (`TAIL-END`)
    survive, in the order head, marker, tail, and the tail starts at a line start.
  - New: for two emoji inputs whose cut points fall on opposite parities, there is no lone surrogate
    at either cut.
  - Kept: R8, where a 5,000-character handoff is kept in full. That test was not changed.
  - Updated to the new shape: the 7,000-character test is still truncated with one marker, but the
    marker is now in the middle (`\n> [truncated]\n> b`), not at the end. The "caps the quoted form"
    test now checks that the marker is present rather than that it ends the section.
  - Added two small helpers inside the spec's `describe`: `agentSection` and `blockQuoted`.

## Verification

Each command was run from the worktree root, in the foreground, with its output filtered.

1. `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.spec.ts --coverage=false --maxWorkers=2`
   - PASS: `Test Suites: 2 passed, 2 total` / `Tests: 84 passed, 84 total`.
   - The first run failed for two reasons. The builder spec had a quoting error from my own edit
     script, and the old "captures every assistant text" spec now hit the M3 path (see Deviations).
     Both were fixed. The run above is the final one, made after the last source edit.
2. `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`
   - PASS: `Successfully ran target typecheck for project @ptah-extension/agent-sdk`.
3. `npx nx lint @ptah-extension/agent-sdk --parallel=1`
   - PASS on errors: `✖ 53 problems (0 errors, 53 warnings)`, `Successfully ran target lint`.
   - No warning is on a changed line. `session-handoff-builder.ts` has none.
   - `session-handover-coordinator.service.ts` has two warnings:
     - `:740 no-useless-assignment`: pre-existing, in the untouched `deliverLateInputs`.
     - `:811 max-lines`: "File has too many lines (726). Maximum allowed is 700". This one is new and
       caused by this batch (see Deviations).

## Deviations

1. **The `max-lines` warning is new.** By the `skipBlankLines`/`skipComments` count, the coordinator
   was at about 697 counted lines before this batch and is at 726 now. The warning sits on the file's
   last line, not on a changed line, but this batch causes it. I compacted the M3 block and the WARN
   call; the rest of the growth is the S1 conversion and the S2 bound. Getting back under 700 would
   mean extracting code into a new file, which this batch does not own. That needs a team-leader
   decision: either a follow-up that pulls the work-in-flight gate (`workInFlight`, the wait bound
   and the S1 conversion) out into a collaborator, or accepting the warning.
2. **M3 picks the last assistant message that has text.** The task says "the last assistant
   message". Without the text filter, a trailing tool-only assistant entry (empty content, as in the
   existing fixtures) would be picked, and the agent's handoff would be lost again. That would
   reintroduce M3 in a different form.
3. **One existing coordinator spec changed.** In "captures every assistant text after the owned
   handoff request", the anchor `before` was missing from the second read, which is exactly the M3
   case. The spec now includes `before` in the second read, so it still tests the normal
   "every assistant message after the anchor" path. The missing-anchor case has its own new spec.
4. **Two existing builder specs were updated** to the head-and-tail shape (marker in the middle), as
   described above. The R8 5,000-character spec was not changed.
5. **The WARN logs the current `waitingFor`.** It uses the value read at the escalating terminal,
   which is the latest count, rather than the one stored on the operation.

## Out of scope (not touched)

- M2, stale `waitingFor` in cancelled and failed snapshots: deferred under D8, and `cancel`, `fail`
  and `sourceEnded` were not changed.
