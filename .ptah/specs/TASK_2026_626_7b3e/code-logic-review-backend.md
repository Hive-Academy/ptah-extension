# Code Logic Review — TASK_2026_626_7b3e (backend phase)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

The single demonstrated gap is a concurrent-run settle that remains provisional. This separates 7 from 8: the implementation handles the ordinary single-run paths, but fails an explicit settle invariant when two streams share an owner. It does not merit 6 because the owner generation checks, result replacement, timer teardown, and release ordering are present in the reviewed paths. `ptah_*` tools, including `ptah_get_diagnostics`, were not exposed in this session; native reads were used. No tests or builds were run by this reviewer, as requested. Existing batch reports record the targeted checks.

## Five logic questions

### 1. How does this fail silently?

With two runs on one owner, a result for run A clears only A's estimate (`live-session-stats-publisher.ts:432-436`), while `publishLive(null)` still sees B's estimate and returns a provisional snapshot (`session-stats-owner.service.ts:624-626`). `emitAuthoritative` sends it and clears A's `estimateShown` flag (`live-session-stats-publisher.ts:461-468`). There is no warning, and A cannot emit a later authoritative settle for that shown estimate. The session may appropriately remain estimated because B is active, but the promised *per-shown-estimate authoritative settle* did not happen.

### 2. What user action produces unexpected behaviour?

Run two overlapping turns against the same session owner and let one finish while the other is still generating. The first result's `SESSION_STATS` payload comes from `replaceRun`'s authoritative snapshot (`stream-transformer.ts:911-954, 995-999`), then its live settle can publish a provisional snapshot including the second run (`stream-transformer.ts:1002-1005`; `session-stats-owner.service.ts:624-626`). The header can return to an estimated value immediately after that result, and the first stream's settle is not authoritative.

### 3. What input data produces a wrong answer?

Two distinct run tokens with simultaneous provisional rows trigger the case. Owner live aggregation includes every run's estimate (`session-stats-owner.service.ts:805-820`), so A's settle reports A's accepted result plus B's estimate, rather than a final-only snapshot for A. Distinct assistant `message.id`s are otherwise deduped by per-counter maximum (`live-session-stats-publisher.ts:300-337`), and a later accepted cumulative result replaces its run state (`session-stats-owner.service.ts:530-556`), so the normal multi-turn route does not double count.

### 4. What happens when a dependency fails?

Unknown pricing produces `costUSD: null` (`live-session-stats-publisher.ts:495-515`); an unpriced row makes the estimate total unknown (`session-stats-owner.service.ts:883-897`) and coverage partial through aggregation (`session-stats-owner.service.ts:1034-1058`). A throwing or rejecting live callback is contained and logged by error name (`live-session-stats-publisher.ts:541-570`); broadcast rejection is also observed by the wiring (`sdk-callbacks.ts:168-179`). A failed broadcast can leave a provisional UI reading until a later live update or result; there is no delivery acknowledgement or retry on this channel (`sdk-callbacks.ts:153-160`). That is the documented best-effort behaviour, not a second finding.

### 5. What is missing that the requirements never mentioned?

The requirements do not define whether a session with two active runs should have a per-run settle payload or remain provisional until the last run settles. The current implementation chooses the latter in owner aggregation (`session-stats-owner.service.ts:624-626`), while the publisher and plan describe every shown estimate as receiving an authoritative settle (`live-session-stats-publisher.ts:218-228, 456-468`). The contract needs one explicit concurrency rule.

## Failure modes

### Concurrent stream settles with another estimate still active

- Trigger: Runs A and B share an owner; both show estimates; A receives a result before B.
- Symptom: A emits one context-free settle payload, but its snapshot still has `provisional: true`; no authoritative settle follows for A's shown estimate.
- Evidence: `session-stats-owner.service.ts:624-626, 805-820`; `live-session-stats-publisher.ts:444-468`; `stream-transformer.ts:1002-1005`.
- Current handling: `publishLive(null)` reflects B's active estimate, and `emitAuthoritative` clears A's shown flag regardless of the snapshot kind.
- Recommendation: Decide and enforce the session-level concurrency contract. If every shown estimate must receive an authoritative payload, obtain an owner snapshot that excludes all provisional rows for A's settle, with a revision strictly above A's last live payload; if the live channel should remain provisional while B runs, change the stated invariant to a session-level settle and test the two possible completion orders and revision admission after `SESSION_STATS`.

## Blocking issues

None found in the reviewed paths.

## Serious issues

None found in the reviewed paths.

## Moderate and minor issues

1. **Moderate — A concurrent settle can be provisional.** `live-session-stats-publisher.ts:444-468` and `session-stats-owner.service.ts:624-626`. Impact: the promised authoritative completion for a shown estimate is absent until all other runs settle, and the live payload after A's result can put the session back into an estimated state. Fix: define and implement the concurrent-run settle rule described above.

## Data flow

1. The adapter passes the live callback separately from the wrapped result callback at all four transform call sites (`sdk-agent-adapter.ts:912-916, 1071-1075, 1218-1222, 1579-1583`): **OK**, live activity and budget effects are bypassed.
2. The transformer binds on init and observes assistant and task frames (`stream-transformer.ts:607-615, 651-653`): **OK**. `recordAgent` touches the owner and notifies watchers (`session-stats-owner.service.ts:585-592`): **OK** for either hook/task order after binding.
3. The publisher dedupes by message id, prices rows, and throttles to one trailing timer (`live-session-stats-publisher.ts:300-337, 354-376, 391-425, 470-515`): **OK** on inspected paths. Timer cancellation and watcher detach occur on dispose (`:236-255`).
4. The owner adds each run's estimate only to live snapshots and excludes it from `snapshot()` (`session-stats-owner.service.ts:610-626, 670-674, 793-845`): **OK** for single-run accounting and unknown-price coverage.
5. At result, the transformer clears this run's estimate before result processing and settles in `finally` (`stream-transformer.ts:695-706, 1002-1005`): **GAP** when another run still has an estimate, because the returned live snapshot stays provisional (`session-stats-owner.service.ts:624-626`).
6. On release, the owner clears all estimates and advances the revision before notifying watchers (`session-stats-owner.service.ts:696-718`); the publisher silences later work (`live-session-stats-publisher.ts:284-297`): **OK** for release-first. On dispose, the timer and watcher are removed before a one-time settle (`live-session-stats-publisher.ts:236-255`): **OK** for dispose-first. Generation checking prevents stale writes (`session-stats-owner.service.ts:616-617, 728-730`).
7. The wiring sends only `SESSION_STATS_LIVE` from the live callback (`sdk-callbacks.ts:162-179`); the result callback alone uses `sendStatsWithRetry` and `SESSION_STATS` (`sdk-callbacks.ts:133-149, 432-453`): **OK**.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Per-message dedupe, result replacement, multi-turn | COMPLETE | `live-session-stats-publisher.ts:300-337`; `session-stats-owner.service.ts:530-556`; `stream-transformer.ts:699-701` |
| Exactly one authoritative settle per shown estimate | PARTIAL | Concurrent run retains `provisional: true` at settle; `session-stats-owner.service.ts:624-626` |
| Agent count under hook/task ordering | COMPLETE | Watcher notification and deferred flush; `session-stats-owner.service.ts:585-592`; `live-session-stats-publisher.ts:262-275` |
| Throttle, trailing timer, teardown | COMPLETE | `live-session-stats-publisher.ts:354-383, 236-255` |
| Live/result channel separation | COMPLETE | `sdk-agent-adapter.ts:912-916`; `sdk-callbacks.ts:139-179` |
| Generation safety | COMPLETE | `session-stats-owner.service.ts:616-617, 728-730`; `live-session-stats-publisher.ts:340-348` |
| Unknown price as partial coverage | COMPLETE | `live-session-stats-publisher.ts:495-515`; `session-stats-owner.service.ts:883-897, 1034-1058` |
| Failure isolation and no placeholders | COMPLETE in reviewed paths | `live-session-stats-publisher.ts:541-570`; `sdk-callbacks.ts:168-179`; no stub markers found in the scoped files |

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Empty or malformed assistant usage | YES | Individual malformed counters degrade to absent by design (`live-session-stats-publisher.ts:101-122, 300-315`). |
| Repeated assistant frame | YES | Per-id counter maxima prevent double counting (`live-session-stats-publisher.ts:310-337`). |
| Unknown model pricing | YES | Unknown cost stays null (`live-session-stats-publisher.ts:495-515`). |
| Stop before/after stream disposal | YES | Release and dispose each clear the other route's opportunity to emit (`session-stats-owner.service.ts:696-718`; `live-session-stats-publisher.ts:236-255, 284-297`). |
| Two concurrent runs on one owner | NO | Settle remains provisional (`session-stats-owner.service.ts:624-626`). |
| Callback rejection | YES | Logged by session id and error name (`live-session-stats-publisher.ts:549-570`; `sdk-callbacks.ts:168-179`). |

## Verdict

- Recommendation: **REVISE** the concurrent-run settle contract and its implementation or documented invariant.
- Confidence: **MEDIUM**. Core paths and existing verification reports were reviewed, but this reviewer did not execute diagnostics or tests and did not read the full large adapter/transformer files beyond the relevant control paths. The batch reports record targeted Jest, typecheck, and lint passes; those happy-path checks do not establish the concurrent-run invariant.
- Top risk: one stream can clear its shown-estimate flag after emitting a still-provisional settle while another stream remains active (`live-session-stats-publisher.ts:461-468`; `session-stats-owner.service.ts:624-626`).
