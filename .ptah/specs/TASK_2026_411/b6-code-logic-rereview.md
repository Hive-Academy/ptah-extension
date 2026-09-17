# Code Logic Re-Review — TASK_2026_411 B6

Re-review of `b6-fixes-report.md` against `b6-code-logic-review.md`. Scope: the six B6 files (translation `index.ts`, `responses-stream-collector.ts`, `responses-stream-translator.ts`, `translation-proxy-base.ts`, `translation-proxy-base.spec.ts`, `codex-stream-parity.spec.ts`). Read in full; diffed against `main` for `translation-proxy-base.ts` and `index.ts` to separate B6 changes from pre-existing code.

## Verdict: DEFECTS (residual — non-blocking)

All five original findings are genuinely fixed with regression specs that fail without the fix. One residual gap survives the fix: forced-stream error handling is inconsistent for non-usage malformed content, and that inconsistency is untested. It does not reopen any of the five original findings, but it does undercut finding #5's "insufficient timing coverage... malformed Responses variants" claim of completeness.

## Finding-by-finding verification

### 1. SSE malformed usage → `invalid-response`, unchanged client SSE error frame — FIXED

- `responses-stream-translator.ts:139-142,458-481`: `ResponsesStreamTranslator` now takes `onUsage`/`onTranslationError` callbacks. `handleResponseCompleted`'s catch (467-478) calls `this.onTranslationError()` and still returns the same `sseEvent('error', {...})` frame as before — the callback is additive, not a change to emitted bytes.
- `translation-proxy-base.ts:892-908`: `handleResponsesStreamingResponse` wires the callbacks through, and the `proxyRes.on('end', ...)` handler adds `if (!translator.isFinalized()) onTranslationError();` for early EOF, with no new `res.write`.
- `translation-proxy-base.ts:794-807`: the outer `proxyRes.on('end')` now does `finishTiming(translationFailed ? 'invalid-response' : 'success')` instead of the old unconditional `resolve()`.
- Regression: `translation-proxy-base.spec.ts:629-646` (early SSE EOF → `invalid-response`, exactly one record) and `codex-stream-parity.spec.ts:143-172` (`malformed`/`early EOF` cases, both assert exactly one `invalid-response` timing record through the real Anthropic SDK consumer, and that the redacted usage value `'secret'` never reaches the log). Both specs would fail against the pre-fix code (no `finishTiming` call existed on this path at all).
- Event-listener ordering matters here and is correct: `handleResponsesStreamingResponse`'s own `'end'` listener is registered (inside `onStreamingSuccess(...)` at `translation-proxy-base.ts:796`) before the outer `proxyRes.on('end', ...)` at line 800, so `translationFailed` is set before it is read — verified by reading registration order, not just asserted.

### 2. Forced-stream malformed usage → `ResponsesStreamError('invalid_response')`, 502, one timing record — FIXED (for the usage-validation case)

- `responses-stream-collector.ts:174-176`: `onData`'s catch wraps any validation failure that occurs while parsing SSE lines (including `responseSchema.parse` inside `dispatch()`) as `ResponsesStreamError('invalid_response')` unless it already carries a more specific code.
- `translation-proxy-base.ts:813,817`: `onTranslationError()` is invoked unconditionally in the `catch` before the `instanceof ResponsesStreamError` branch, so `finishTiming('invalid-response')` fires via the `.catch` in `forwardToApi` (`translation-proxy-base.ts:822-825`) regardless of which error type surfaces.
- Regression: `translation-proxy-base.spec.ts:648-668` sends a malformed `usage.input_tokens` (string instead of number) through the forced-stream path and asserts `502` + exactly one `invalid-response` record. This is a real regression test — reverting `responses-stream-collector.ts:174-176` to the old plain-`Error` wrap makes the collector's error still generic, `forwardToResponsesApi`'s `!(error instanceof ResponsesStreamError)` branch would rethrow instead of sending 502, and the test would fail on both the status code and (previously) on a missing timing record.
- **Residual gap (see "New/residual issues" below):** this fix, and its only regression test, covers exactly one malformed-Responses shape — invalid `usage`. It does not cover malformed *content* (invalid `function_call` arguments, empty `refusal` text) reached through `collectOutputContent`, which is called only from `onEnd` (`responses-stream-collector.ts:187`), not from `dispatch()`/`onData`. Errors thrown there are still wrapped generically at `responses-stream-collector.ts:198-199` (`new Error('Incomplete or invalid Responses stream')`, not `ResponsesStreamError`), so they still bypass the 502 branch and fall through to a generic 500 in `handleMessages`'s outer catch (`translation-proxy-base.ts:392-408`). This is pre-existing behavior (confirmed via `git diff main` — `responses-stream-collector.ts` line 198's ternary is unchanged by B6), not a new defect, but the fix report's claim that "insufficient timing coverage" (finding #5) is now resolved for "malformed Responses variants" is broader than what is actually tested.

### 3. `overlapCount` — live per-instance in-flight counter — FIXED

- `translation-proxy-base.ts:103` (`private inFlightAttempts = 0`), `630` (`overlapCount: this.inFlightAttempts` captured before increment), `632` (`this.inFlightAttempts++`), `634-641` (`finishTiming` decrements exactly once behind the `timingFinished` guard).
- Every terminal branch (`authentication-error` 653, `network-error` 668/848, `retry` 704, `rate-limited` 733, `upstream-error` 767, `success`/`invalid-response` 801/819, `timeout` 831, `cancelled` 856/863) routes through the same `finishTiming` closure, so the decrement is genuinely centralized rather than duplicated per branch — a single idempotency guard covers all of them, including the two different cancellation entry points (`cancel()` on `res.close` and the synchronous `res.destroyed` check).
- Regression: `translation-proxy-base.spec.ts:761-785` drives two real overlapping loopback requests, asserts `overlapCount` values `[0, 1]` across the two resulting records and both settle as `success`. This would fail against the original always-zero field.
- Retry semantics are correct: a 401 retry calls `finishTiming('retry')` (decrementing) before `retryFn(true)` recurses into a fresh `forwardToApi` call that builds a new `timingRecord` and re-increments — so a retried attempt is not double-counted as concurrently in flight with itself.

### 4. Pre-write disconnect → `cancelled` exactly once — FIXED

- `translation-proxy-base.ts:855-867`: the `cancel()` closure (fired on `res.once('close', ...)`) and the synchronous `res.destroyed` fallback both call `finishTiming('cancelled')` before `proxyReq.destroy()`. `proxyReq.once('close', () => res.off('close', cancel))` prevents a stale listener from firing `cancel()` after a normal successful completion.
- Regression: `translation-proxy-base.spec.ts:711-733` stalls `getHeaders()`, destroys the client mid-wait, then releases headers — proving the pre-write race (client closes before `proxyReq` exists) still finalizes exactly one `cancelled` record. `:735-759` proves the ordinary mid-stream close still works. Both assert `toHaveLength(1)`, which is the property that would fail if `cancel()` and the `res.destroyed` fallback both fired for the same request.

### 5. Timing coverage — MOSTLY FIXED, with the gap noted under finding #2

- New coverage for: stream success (with/without usage, `:604-627`), early SSE EOF (`:629-646`), forced-stream malformed usage (`:648-668`), rate-limited (`:670-681`), timeout with production-default pin (`:683-696`), network-error (`:698-709`), pre-write cancellation (`:711-733`), mid-stream cancellation (`:735-759`), overlap (`:761-785`), plus the real-SDK-consumer parity cases in `codex-stream-parity.spec.ts`.
- Every one of the nine terminal `status` values in `ProxyPhaseTimingRecord` (`success`, `retry` — exercised in the pre-existing 401-retry describe block, not re-verified here since untouched — `authentication-error`, `rate-limited`, `upstream-error`, `invalid-response`, `timeout`, `network-error`, `cancelled`) now has at least one exercising spec. Confirmed by reading the full 786-line spec file, not by trusting the fixes report's count.
- Gap: no forced-stream test exercises a malformed *content* shape (bad `function_call` arguments/refusal on a `completed` status) — see finding #2 above. `responses-stream-collector.spec.ts:89-93` (unchanged, out of B6 scope) already accepts a generic rejection for exactly this case without asserting a `ResponsesStreamError` code, which is the earliest evidence this gap predates B6 and was not introduced by it.

## New defects check

- **Timeout seam is genuinely test-only.** `getUpstreamTimeoutMs()` (`translation-proxy-base.ts:144-147`) is `protected`, returns the literal `600_000`, and is overridden only by the spec's `FakeTranslationProxy` (`translation-proxy-base.spec.ts:93-95`). `grep` across `libs/backend/auth-providers/src` confirms no production subclass (`CodexTranslationProxy`, `CopilotTranslationProxy`, etc.) overrides it, so there is no path from user/workspace configuration to a non-default timeout. The regression at `:683-696` additionally instantiates a fresh `FakeTranslationProxy` and asserts its default is `600_000`.
- **Terminal-state propagation does not alter wire output.** Verified for both the translator's `onTranslationError()` call sites (existing error SSE frame reused, not a new one) and the collector's callback threading (`onUsage` is invoked with the same `translateResponsesUsage(...)` result that was already being sent to the client in `resolve({...})`, `responses-stream-collector.ts:190-197`).
- **Idempotent finalizer.** `finishTiming`'s `timingFinished` boolean guard (`translation-proxy-base.ts:634-641`) is shared by every settle path in a given `forwardToApi` invocation (timeout, error, cancel, success/invalid-response), so no concurrent-event scenario can double-decrement `inFlightAttempts` or double-`record()`. No test forces literally simultaneous `'timeout'` + `'error'` + `'close'` events, but the guard's correctness does not depend on ordering — first caller wins, structurally.
- **No secret/body/prompt/malformed-fragment leakage.** `assertSafeTiming` (`translation-proxy-base.spec.ts:583-593`) greps the serialized record set for `'Bearer fake'`, `'private-upstream-value'`, `'Keep this prompt'`, `'read_file'` across every timing scenario, and `codex-stream-parity.spec.ts:167` does the same for the literal malformed `'secret'` usage value. `ProxyPhaseTimingRecord`'s own shape (`translation-proxy-base.ts:64-87`) carries only counters/timestamps/enums — no field could hold a body or header fragment even if one were assigned to it.
- **`catch (error: unknown)`.** Every new `catch` block introduced by this diff is correctly typed (`translation-proxy-base.ts:667`, `responses-stream-collector.ts:174,198`, `responses-stream-translator.ts:206,466`). The five untyped `catch (error)` blocks that remain in `translation-proxy-base.ts` (lines 392, 423, 652, 987, 1167 in the current file) all predate this diff — confirmed via `git diff main`, none of them appear in the B6 changeset — so they are not a B6 regression, though they remain a standing style gap the repo's own coding standard (`catch (error: unknown)`) would flag if anyone touches those lines next.
- **No unbounded state.** `inFlightAttempts` is a single number, incremented/decremented in lockstep; no new collection, map, or array was added that isn't bounded by a single request's lifetime.

## Residual issue

### Forced-stream content-validation errors return an inconsistent, untested status

- Severity: **Moderate**
- File: `libs/backend/auth-providers/src/lib/translation/responses-stream-collector.ts:187-199`, consumed at `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:537-556,813-825`
- Trigger: a forced-stream (`requiresResponsesStream() === true`) upstream terminal event that passes `responseSchema` (valid `usage`, valid top-level shape) but whose `output` contains a `function_call` item with unparsable/absent arguments on a `'completed'` status, or a `refusal` content part with empty text. `collectOutputContent` (called only from `onEnd`, not from `dispatch()`/`onData`) throws a plain `Error`.
- Symptom: `onEnd`'s catch (`responses-stream-collector.ts:198-199`) wraps it as `new Error('Incomplete or invalid Responses stream')` — not a `ResponsesStreamError`. `forwardToResponsesApi`'s `catch` (`translation-proxy-base.ts:544-549`) then rethrows (`!(error instanceof ResponsesStreamError)` is true), which propagates through `forwardToApi`'s `.catch` up to `handleMessages`'s outer `try/catch` (`translation-proxy-base.ts:392-408`), producing a generic `500 "Failed to communicate with {name} API"` instead of the `502 "invalid_response: ..."` shape the malformed-usage sibling case produces.
- Current handling: timing is still correctly recorded as `invalid-response` exactly once (the `.catch` at `translation-proxy-base.ts:822-825` runs regardless of error type), so this is not a silent-success regression and there is no data leak in the 500 message — but the client-facing contract is inconsistent between two "malformed Responses payload" cases that should behave the same way, and this specific shape has zero regression coverage anywhere in the B6 diff (the one pre-existing collector-only spec for it, `responses-stream-collector.spec.ts:89-93`, doesn't assert a status code or error type, and isn't exercised end-to-end through `translation-proxy-base.ts` at all).
- Recommendation: either (a) have `onEnd`'s catch also wrap non-`ResponsesStreamError` failures as `ResponsesStreamError('invalid_response')` for parity with `onData`'s handling, since both are "the upstream sent a shape we can't translate" failures, or (b) if the 500-vs-502 distinction is intentional (e.g., to separate "stream-level corruption" from "response-content corruption"), add a regression test in `translation-proxy-base.spec.ts` pinning the 500 status and the timing record for this case, so a future change to `collectOutputContent` doesn't silently flip the client-visible status code.

## Data flow (forced-stream / Responses API path)

1. `handleMessages` parses body, computes `requestTiming` — OK.
2. `forwardToResponsesApi` builds the Responses request, resolves `forceStream` — OK.
3. `forwardToApi` builds `timingRecord` with `overlapCount = inFlightAttempts` (pre-increment snapshot), increments, defines the idempotent `finishTiming` — OK.
4. Upstream response headers arrive; byte/first-byte counters populated on `'data'` — OK.
5. Non-2xx branches (401/429/4xx) all reach `finishTiming` with the correct status before responding — OK.
6. 2xx + `stream: false` (client) + `forceStream: true` (upstream) → `collectResponsesStream` drains the SSE body.
   - Valid terminal usage → `onUsage` → `captureUsage` populates `terminalInputTokens`/`terminalOutputTokens`/`terminalCacheReadTokens`, `resolve(...)` sends 200 — OK, timing `success`.
   - Malformed `usage` (schema failure in `dispatch()`, reached via `onData`) → `ResponsesStreamError('invalid_response')` → 502 + `invalid-response` timing — OK, regression-tested.
   - Malformed content (`collectOutputContent`, reached via `onEnd`) → plain `Error` → 500 + `invalid-response` timing — inconsistent status code, untested (residual issue above).
7. `finishTiming` fires exactly once per attempt across every branch — OK, guarded.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| SSE malformed usage → `invalid-response`, unchanged client frame | COMPLETE | none |
| Forced-stream malformed usage → `ResponsesStreamError`, 502, one timing record | COMPLETE | scoped to usage-shape failures only; content-shape failures (function-call args, refusal) still fall through to a generic 500 and are untested |
| `overlapCount` live, exactly-once decrement, no negative/leak | COMPLETE | none found |
| Pre-write disconnect → `cancelled` exactly once | COMPLETE | none |
| Coverage for all timing statuses | PARTIAL | all 9 statuses covered at least once; malformed-content (non-usage) forced-stream variant absent |
| No production-reachable timeout override | COMPLETE | confirmed no subclass overrides `getUpstreamTimeoutMs()` |
| No PII/secret/prompt/malformed-fragment in timing/log records | COMPLETE | asserted across all new specs |
| `catch (error: unknown)` in new/changed code | COMPLETE | pre-existing untyped catches elsewhere in the file are out of scope for this diff |

Implicit requirements not addressed: none beyond the residual issue above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Duplicate `response.completed` (SSE relay) | YES | `finalized` guard short-circuits `handleEvent`/`emitFinalEvents` | none |
| Concurrent overlapping requests | YES | per-instance counter, spec asserts `[0,1]` | single-instance only — cross-instance/process overlap is out of scope by design (per-proxy-instance counter, matches fix report's stated intent) |
| Pre-write client disconnect | YES | dual guard (`cancel()` + `res.destroyed` check) | none |
| Mid-stream client disconnect | YES | `res.once('close', cancel)` | none |
| Upstream timeout | YES | `proxyReq.on('timeout')` → `finishTiming('timeout')`, 504 to client | none |
| Malformed terminal usage (SSE relay) | YES | `onTranslationError` → `invalid-response`, error SSE frame | none |
| Malformed terminal usage (forced-stream) | YES | `ResponsesStreamError('invalid_response')` → 502 | none |
| Malformed terminal content, non-usage (forced-stream) | NO (falls back to generic 500) | generic `Error` bypasses `ResponsesStreamError` branch | inconsistent status code, no regression test — Moderate finding above |
| Early EOF (SSE relay) | YES | `!translator.isFinalized()` check on `'end'` | none |
| Early EOF (forced-stream) | PARTIAL | `onEnd`'s own incomplete-stream check also falls through the same generic-`Error` path as the content-validation gap | same Moderate finding covers it; not separately tested through `translation-proxy-base.ts` |

## Verdict

- Recommendation: **APPROVE with a follow-up** — none of the five original findings are open, and the fixes are each backed by a regression test that demonstrably fails without the corresponding production change (verified by tracing, not by trusting the fix report). The one residual issue is a real but Moderate-severity inconsistency that was not part of the original findings and does not regress client-visible success/failure signaling or timing accuracy.
- Confidence: HIGH — every claim above is traced to specific line numbers in the current worktree and, where relevant, to `git diff main` to separate B6 changes from pre-existing code.
- Top risk: a future upstream payload with malformed `function_call` arguments or empty `refusal` text on a forced-stream (Responses-API-relay) provider will surface as a generic 500 "Failed to communicate" instead of the more informative 502 `invalid_response` the sibling malformed-usage case produces — functionally fails closed, but inconsistent and unverified by any test.
- What a robust implementation would add: (1) route `onEnd`'s catch through the same `ResponsesStreamError('invalid_response')` wrapping as `onData`'s catch, or explicitly document the 500/502 split and pin it with a test; (2) a `translation-proxy-base.spec.ts` case for forced-stream malformed `function_call` arguments/refusal content, mirroring the existing malformed-usage case at `:648-668`.
