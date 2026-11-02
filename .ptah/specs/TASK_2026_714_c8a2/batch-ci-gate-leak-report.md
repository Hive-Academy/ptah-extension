## Root cause

`InternalQueryService` constructs its own gate (`libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:64-84`). `execute()` waits for admission before starting the runner (`:115-140`). The gate uses a 60,000 ms default (`internal-query-concurrency-gate.ts:132`), arms a real `setTimeout` for an eligible queued waiter (`:343-378`), and rejects it with `InternalQueryQueueTimeoutError` when that timer fires (`:368-371`, `:404-409`). `unref()` prevents the timer from keeping a process alive; it does not prevent it from firing in a live Jest worker.

The service spec's gated runner returns a stream that waits for its `finish` callback (`internal-query.service.spec.ts:225-235`). A slot stays held until the stream ends or its handle is closed or aborted (`internal-query.service.ts:220-253`). Before this change, five service tests acquired all applicable slots, started one more `execute()`, asserted that it remained queued, then ended with `void fifth`, `void fourth`, or `void queued`: configured global limit (`internal-query.service.spec.ts`, original lines 429-444), same-lane limit (original 463-473), global limit across lanes (original 475-487), normalized lane name (original 526-540), and blank default lane (original 542-552). They supplied neither a signal nor `queueTimeoutMs`, so each left an unhandled default-timeout rejection for a later suite.

Two direct gate tests had the same real-timer path: `internal-query-concurrency-gate.spec.ts`, original lines 75-88 and 157-170. Both retained their slot holders and ended with `void queued`. Their `acquire()` helper forwarded an undefined `queueTimeoutMs` (lines 20-37).

The other candidates do not create a queued real-gate waiter: the curator spec mocks `execute` (`curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts:159-202`); the commit-message spec also mocks `execute` (`commit-message/commit-message-generator.service.spec.ts:48-59`); and the DI smoke spec only resolves the service, without executing it (`di/register.compaction-boundary-registry.smoke.spec.ts:354-368`).

## Changes

- `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.spec.ts`: Give each of the five intentionally queued calls an `AbortController`, abort after the queue assertion, and await its `AbortError` rejection (current lines 429-446, 465-479, 481-497, 536-552, 554-568).
- `libs/backend/agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.spec.ts`: Release the holders, await the queued admission, and release that slot in the two real-timer cases (current lines 75-90 and 159-187). Also await and release the deferral-ceiling admission, and abort and await every waiter in the fake-timer backlog test (current lines 533-555 and 557-603).
- `.ptah/specs/TASK_2026_714_c8a2/batch-ci-gate-leak-report.md`: Record the leak path, edits, and limits of this investigation.

## Decisions

This is test hygiene: production admission, timeout, and rejection behavior is consistent with its contract, so no production code changed. Aborting the service waiters preserves the assertions that they stayed queued while deterministically removing their timers. The direct gate cases release slots to exercise their normal admission path. Fake-timer cleanup is included so those tests also finish with no outstanding waiters.

## Not done

No verify, test, lint, typecheck, build, Nx command, or diagnostics call was run, as instructed. Runtime confirmation is left to the coordinator's checks.
