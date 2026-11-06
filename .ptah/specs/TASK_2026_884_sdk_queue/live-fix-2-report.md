# Follow-up result cleanup correction

## Root cause

The prior edit moved `onTurnEnd` from the SDK result read to the end of the per-message body (`stream-transformer.ts:1150` before this correction). That preserved normal history order but made release contingent on reaching that line. A thrown error or generator close at the terminal yield could skip it. It also ran after `livePublisher.settle()` (`stream-transformer.ts:1087-1090` before this correction), so cache changes made by the turn-end callback were absent from the final live-stats payload. This caused the duplicate-result and empty-usage live-stats failures.

## Fix

At the result read, `stream-transformer.ts:783` records `turnEndPending` after identifying a non-late result. A `try/finally` around the remainder of that SDK message calls `onTurnEnd` once at `stream-transformer.ts:1156`. On the normal path it runs after the terminal `turn_state` yield; the `finally` also runs on `continue`, return, throw, and consumer close. A nested `finally` calls `livePublisher.settle()` afterward (`stream-transformer.ts:1160`), preserving the turn-end callback's owner cache update in the final live payload even if the callback throws. The existing `onResultStats` callback still precedes the live settle.

## Specs and verification

- `stream-transformer.live-stats.spec.ts:576-611`: duplicate and empty-usage results each release one held follow-up and publish the updated cache snapshot.
- `stream-transformer.spec.ts:2374-2395`: a consumer that closes immediately after receiving the result `turn_state` still releases the held follow-up.
- `npx jest --runInBand -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/stream-transformer --coverage=false --silent`: 3 suites, 153 tests passed.
- `npx jest --runInBand -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts --coverage=false --silent`: 1 suite, 26 tests passed.
- Scoped `ptah_get_diagnostics` for all changed source/spec files: zero errors.
- No Electron rerun, commit, push, or e2e edit.

## Decisions

- Keep the result read and release separate: the result identifies the boundary, while the per-message `finally` guarantees release after terminal event delivery on every exit. This is reversible.
- Settle live stats after the turn-end callback because the callback can update the session owner's cache. This restores the tested live-stats contract and is reversible.
