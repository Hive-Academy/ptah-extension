# Code Logic Review - Batch 8 (limit failure + generic presentation)

Scope: diff read in full for codex-chat-events.ts, plan-limit-tiles.ts, agent-limit.formatter.ts; specs by name only. No checks were run, so compile and test status is unverified.

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REQUEST CHANGES |
| Blocking | 1 |
| Serious | 0 |
| Moderate | 3 |

## Blocking

### B1. Structured limit cause cannot occur in production (not wired end to end)
- `codex-chat-events.ts` `reachedCause(event.error)` expects `event.error.limitReached`. The batch report admits `CodexRuntimeError` has no such field and `codex-event-translator.ts` maps every native `turn.error` to generic `turnError`. So the only path that sets `limitReached` is the spec's hand-built error; real failures always take the generic message.
- Impact: the acceptance item "structured reached type and reset" is unmet outside tests; the spec proves a mapper nobody feeds. No regression (generic path unchanged).
- Fix: either land the upstream contract (`codex-runtime.types.ts` optional `limitReached`, translator mapping from `codexErrorInfo`, and the ledger consumer) in the same PR, or explicitly re-scope the criterion and record it as open. Do not mark it complete.

## Moderate
- Unit contract: `resetsAt` is formatted with `new Date(resetsAt)` (milliseconds, cap 8.64e15). Native Codex reports epoch seconds (`codex-protocol-schemas.ts` rateWindow/usageLimitExceeded; the reader runs them through `normaliseInstant`). The upstream mapper must normalize to ms or the message shows a 1970 date. Document or enforce it at the translator.
- `agent-limit.formatter.ts` `table()` does not escape cells and the new rows interpolate provider-supplied `allowance.label`, `balance`, `used`, `limit` (lines 340-380). A `|` or newline in a label breaks the table. Confirm the reader sanitizes these or escape in the formatter.
- `individual.remainingPercent` is rendered unclamped; an out-of-range provider value shows e.g. `140% remaining`. Clamp in the tile and formatter.

## Five questions (short)
1. Silent failure: B1 (always generic in production).
2. User action: hitting a real usage limit shows the generic "Codex reported a runtime error." with no reset time.
3. Wrong answer: seconds-vs-ms reset (moderate).
4. Dependency failure: malformed evidence falls back to generic via safeParse (OK, spec covers it).
5. Missing: ledger update from the error cause; upstream contract (per the report).

## Verdict
REQUEST CHANGES. UI and formatter changes look correct (legacy fallback, no duplicate tiles, order preserved, unlimited credits as a state). The failure mapping is inert until the runtime contract exists.
