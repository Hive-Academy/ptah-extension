# Code Logic Re-review 5F: TASK_2026_627

Scope: `git diff 6cb27e3e4..44eba9fc3 -- libs/` (coordinator + builder). Read only; no tests run.

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 | FIXED | `session-handover-coordinator.service.ts:307-318` converts a waiting `budget-auto` op to `budget-limit` in place (same id, `waitingFor`/`waitingSince` cleared, revision bumped). The gate at `:325-330` also has `!atBlockingLimit`. The op then follows the existing armed -> `awaiting-confirmation` path (`:353-358`), so the user gets the confirmation. |
| S2 | FIXED | `WORK_IN_FLIGHT_WAIT_LIMIT_MS = 900_000` (`:144`). `waitingSince ??= now` is stamped on the first wait (`:344`). At `:333-338`, an elapsed time at or above the limit sets `waitLimitReached`, which escalates to `awaiting-confirmation` and keeps `budget-auto` (`:352-358`). It runs at each terminal, with no timer. A WARN line is logged next to real logic. Accepted gap (D6): no terminal means no check. |
| M3 | FIXED | `:655-665`. When `previousId` is defined but not found, only the last non-empty assistant message is used. `previousId === undefined` still takes all messages, which is correct for the first request. |
| M4 | FIXED | `capHeadAndTail` (builder `:225-271`) is used by `quoteWithin` (`:714`). It keeps the tail from the last `## Still running` or `## Next action` heading when that tail fits in half the budget. Otherwise it keeps the last half from a line start. The surrogate-pair guards are correct. The cap is applied before `blockQuote`, so a quote is never split. The prompt length line is at coordinator `:156`. |

## New defects introduced

None Blocking or Serious.

- `waitingSince` is cleared at every exit from the wait: the arm (`:351`), the conversion, and the `proceed` path (`:489`). Cancel and restart create a new op, because `isRestartable` ops are not `live`, so the stamp cannot go stale.
- The `budget-auto` to `budget-limit` conversion reuses the existing `budget-limit` confirm path. `userConfirmed` is untouched.

Minor, not blocking: the fallback tail cut can start inside a fenced code block. It is only a display cut.

Verdict: APPROVED
