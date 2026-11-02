# Code Logic Review: D9 fix 4+5 round 2 (Codex resume history)

Score: 8/10. Verdict: APPROVE. Blocking 0, Serious 0, Moderate 3, Minor 2. Static review only: no tests, tsc or lint were run.

## Round-1 follow-ups

| Item | Status | Evidence |
| --- | --- | --- |
| Serious 2: 1 MiB inbound cap on root-critical calls | FIXED | `codex-app-server-process.ts:26-28` splits OUTBOUND (1 MiB), INBOUND (16 MiB) and QUEUED_BYTES (4 x outbound). The outbound check at `:529` still uses the 1 MiB cap. The inbound check is at `:335-337`. Turns and items pages are cut from 100 to 25 rows (`codex-session-history.ts:55-56`, `:119`, `:133`). MAX_PAGES is raised to 400 to keep the 10,000-row ceiling. |
| Moderate: child `thread/read` failure aborted the whole history | FIXED | The `hydrateThread` child loop catches at `codex-session-history.ts` (child loop after `selected` closure). `assertOpen()` runs first in the catch, so aborts and close still propagate. `recordFailure` runs next. It breaks only on `processFailure`. Other children are still hydrated. |
| Moderate: double WARN and partial list | FIXED | One aggregated `logger.warn` runs after all list and child work, with `partialListing`, `completedLists` and `failedLists`. It is not a snapshot marker, but it is no longer ambiguous in the log. |
| Serious 1: ancestorThreadId not in the pinned schema | PARTIAL | Param added to `codex-protocol-methods.ts` `thread/list` strictObject. Fallback on rpcCode -32602 is correct in form (see below). The pinned JSON schema and manifest sha are still not regenerated. This was a documentation request, not a blocker. |
| Stale spec comment and source-shape coverage | FIXED | `codex-protocol-validator.spec.ts` adds synthetic `it.each` cases for an unseen string label and for `subAgent.thread_spawn`. |

## Specific checks

### Frame-cap split
- The oversize check runs before any allocation (`:335-337`). A single 16 MiB+1 chunk with no newline is rejected without growing the buffer. Good.
- Growth is by `Buffer.concat([buf], n)`, which zero-pads to n and copies the existing bytes. n is `min(16 MiB, max(byteSize, 2 x length))`, so growth is 1, 2, 4, 8, 16 MiB. The copy `chunk.copy(...)` always fits because n >= byteSize. Correct.
- The error is still clear: `CodexInboundFrameLimitError('Frame limit')` goes through `fail('Codex invalid protocol frame')`. The byteSize is added to the debug log only (`:593-595`). The spec asserts it.
- Memory (Moderate): `frameBuffer` never shrinks after one large frame. A process that saw one 10 MiB history page then keeps a 16 MiB buffer until close (`:646` resets it). Per process, bounded, acceptable. Option: reset to the 1 MiB buffer when `frameBytes` returns to 0 after growth beyond the initial size.
- Transient peak is about 2x (old + new buffer plus the decoded string, which is roughly 3 copies of one frame). It is bounded at 16 MiB, so fine.
- The new spec "accepts an inbound notification larger than the outbound frame cap" is meaningful: it sends a 2 MiB delta and asserts delivery and no kill.

### Page limit 25 and cursor paging
- `pages()` is unchanged: stalled cursor and empty cursor are detected, and the page ceiling is now 400 (`:54`). Turns and items both use `HISTORY_PAGE_LIMIT`. The spec "uses 25 row pages ... retaining cursor paging" covers it.
- Minor: a mis-indented line at the turns call (`:119`, one extra space). Style only.
- Cost note (Moderate): 4x as many round trips per long thread for items. It is a trade-off the lane chose. Acceptable.

### Child hydration degradation
- The root is hydrated before discovery (`const threads = [await hydrateThread(root)]`). A root failure still throws, which is correct.
- Aborts: `assertOpen()` is the first statement in each catch, and the spec "propagates an abort from the child failure catch" asserts that no warn is emitted. Good.
- A `processFailure` during child hydration breaks the loop and warns once, returning the root and the children hydrated so far. Correct.

### ancestorThreadId retry
- Detection walks the `cause` chain for `CodexRequestRejectedError` and checks `rpcCode === -32602`. `rpcCode` is `frame.error.code` (`codex-app-server-process.ts:475`, `:592`). `call()` wraps in `CodexSessionHistoryError` with `cause: error`, so the chain keeps the rejected error. Correct.
- Retry is once per `archived` value: the plain `listPages(archived, false)` is not inside another retry, so there is no loop. Listed results are pushed only after a full successful pass, so a failed targeted attempt leaves no duplicates.
- Moderate (unverifiable here): if the Codex server reports unknown or unsupported params as -32600 (invalid request) rather than -32602, the fallback never fires. The result is root-only history plus a WARN with `rpcCode`, not a crash. This is graceful but loses child cards. Consider retrying on -32600 too, or on any `requestRejected` from the targeted call (one extra call, still bounded).
- The unfiltered fallback relies on the parent-chain closure filter, which is already present.

### Synthetic specs
- Meaningful: they cover the aggregated warn count, both-list failure, process-close during list, the child failure variants, abort, and the retry (-32602 path asserts no warn). The ancestor retry spec does not cover the -32600 case (see above).

### TypeScript compile review
- `readCodexSessionHistory` gained a required 4th param. The only non-spec caller, `codex-runtime.ts:102-106`, passes `this.options.logger`. That is used non-optionally elsewhere in the same file (`:139`), so it is required. All spec calls pass `logger`. OK.
- `hydrateThread(listedThread: typeof root)`: list rows and the `thread/read` thread share the `thread` schema (`codex-protocol-methods.ts:76-80`), so assigning list rows should type-check. Low risk.
- `source` union widened to `string | {custom} | {subAgent}`. No consumer found in round 1. `CodexRequestParams<'thread/list'>` now includes `ancestorThreadId?: string | null`. Fine.
- `new CodexInboundFrameLimitError(...)` is a non-exported class used in `instanceof` in the same file. Fine. `Buffer.concat([buf], totalLength)` is a valid signature.
- No likely compile errors found.

## Remaining items (non-blocking)
1. Moderate: inbound buffer is never shrunk after growth.
2. Moderate: -32602-only fallback may miss -32600.
3. Moderate: pinned schema JSON and manifest sha still lack `ancestorThreadId`. Document or regenerate.
4. Minor: indent at `codex-session-history.ts:119`.
5. Minor: a live Electron resume remains the only proof of the sub-agent card path (not run).

## Verdict
APPROVE, confidence MEDIUM-HIGH (static only). No blocking issues.
