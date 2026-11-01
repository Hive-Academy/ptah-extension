# Code Logic Review

## Batch 8n-1 review

Implementer family: OpenAI (codex CLI lane gpt-6-sol). Reviewer family: Anthropic (Claude).
Scope: uncommitted diff of `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts` and its spec.
Read-only review; no checks run.

**Verdict: APPROVED** (score 8/10). 0 Blocking, 0 Serious, 2 Moderate, 3 Minor.

### Verified
- Fields exist: `expectedManifestRow.pinnedVersion` (codex-protocol-manifest.ts:23,29; used process.ts:250); `CodexRuntimeLogger` has debug/info/warn/error with `Record<string, string|number|boolean>` metadata (codex-runtime-ports.ts:46-54). All metadata values are primitives.
- Timeout: `INITIALIZE_TIMEOUT_MS = 60_000` (process.ts:33) is passed at :218; ordinary requests use `REQUEST_TIMEOUT_MS = 30_000` (:266). The timer fires `fail('Codex request timed out', undefined, 'initialize')` (:279-282), which yields the same `CodexProcessFailureError` as before. The outer catch's second `fail('Codex initialization failed')` is a no-op because `failure ??=` keeps the first error, and `first` is false so the log is not duplicated.
- Abort: `onAbort` -> `fail` -> `close()` clears every pending timer (:578-581) and rejects pending requests, so abort during the long handshake rejects at once and leaves no 60 s timer behind.
- Start log fires once and only on success: it is the last statement of the try block (:247), after the home check, `initialized` write, `ready = true` and the notification flush. Home mismatch, flush failure, timeout and abort all throw earlier. `start()` is guarded by `assertOpen`/single-shot flow, so it cannot run twice per process.
- `startupDurationMs` runs from just before `spawnProcess` (:158) to the point the initialize response resumes the await (:221). That covers spawn plus handshake, as required. `pinVerification` is computed once before spawn and reused (no double verification).
- Debug-to-warn: only initialize timeouts are promoted; every other failure stays at debug. Grep of codex-runtime found no spec or caller asserting the old debug level for an initialize timeout. The only `Codex process failure` assertions are the thread/start case (spec:375-378) and the others at 215/442, all non-initialize, so they are unaffected. No `advanceTimersByTime(10_000)` remains in codex-runtime specs. `codex-runtime.spec.ts` and `codex-account-usage-client.spec.ts` contain no initialize-timeout expectations. The account-usage client (`CACHE_MS`/`MISS_MS` = 30_000 only) and `codex-runtime.ts` (30 s interrupt, 120 s compact) hard-code no 10 s wait; both go through `CodexAppServerProcess.start`.
- Specs: Jest modern fake timers (no legacy override found in jest.preset.js or the project config) mock `Date`, so `Date.now()` advances with `advanceTimersByTime`. The 15 s success test therefore sees `startupDurationMs: 15_000` and the timeout test sees `elapsedMs: 60_000`. The 59_999 test uses `advanceTimersByTimeAsync` and a `settled` flag attached before the timer fires, so there is no unhandled rejection. The negative check `logger.warn` not called at 59_999 is meaningful. `jest.replaceProperty(process,'env')` is undone by `restoreAllMocks` (spec:153). Secret redaction is asserted for env values and the `Bearer` token.

### Findings

#### Blocking
None.

#### Serious
None.

#### Moderate
1. process.ts:557-565 - The `stderrTail` is now emitted at warn level instead of debug. Redaction is pattern-based (`Bearer ...` and similar in codex-stderr-tail), so stderr text that does not match a pattern (file paths with user names, partial URLs) reaches a level that is more likely persisted or shown. Requirement 2 asks for a bounded tail, and it is capped at 2048 bytes, so this is acceptable. Confirm the redactor covers URLs and `key=value` forms, or log only the last N lines.
2. process.ts:247-252 - `logger?.info` runs inside the try block after `ready = true`. A throwing logger would reach the catch, call `fail('Codex initialization failed')` and tear down an otherwise healthy process. Wrap the log call in try/catch (or run it before `ready`) so telemetry cannot fail a start.

#### Minor
1. process.ts:158,221,556 - Uses `Date.now()` rather than the `Clock` port from codex-runtime-ports.ts:38. This is consistent with the file's existing direct `setTimeout`, but it makes time injection inconsistent across the package.
2. process.ts:555 - `elapsedMs` is `Date.now() - spawnStartedAt` at failure time, so it can slightly exceed 60_000 if the timer is late; it also includes the (synchronous, tiny) setup before `sendRequest`. Acceptable, and the spec pins exactly 60_000 under fake timers.
3. spec:749-784 - No test that a failed start (home mismatch, timeout) emits no `Codex process started` info log, and none that a non-initialize 30 s timeout stays at debug. Cheap to add: `expect(logger.info).not.toHaveBeenCalled()` in the timeout and abort tests, plus one assertion on the debug level for a `thread/start` timeout.

### Five logic questions (brief)
1. Silent failure: none new; initialize timeout is now louder (warn) and carries elapsed and stderr tail.
2. User action: abort during handshake rejects immediately (spec:807-821).
3. Wrong answer: `startupDurationMs` excludes home verification by design; matches "to initialize response".
4. Dependency failure: a slow or hung binary now yields a 60 s wait before failure; acceptable per GAP-1. Logger rejection is covered by Moderate 2.
5. Missing: no negative-path assertion for the info log (Minor 3).
