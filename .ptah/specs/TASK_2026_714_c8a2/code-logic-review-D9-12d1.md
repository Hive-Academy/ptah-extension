# Code Logic Review — D9 12d-1 (Electron native Codex history port)

Static review only; nothing was executed (verify running elsewhere).

## Summary

| Metric | Value |
| --- | --- |
| Score | 6.5/10 |
| Assessment | NEEDS_REVISION (small) |
| Blocking | 0 |
| Moderate | 4 |
| Minor | 4 |

## Moderate findings

1. **M-A: timeout/abort leaves the child process running.** `codex-runtime-composition.ts:598` races `runtime.readHistory` against `cancelled`, then `finally` (`:599-603`) disposes the scope. `CodexRuntime.readHistory` (`codex-runtime.ts:58-89`) owns the `CodexAppServerProcess` and only calls `process.close()` in its own `finally`, after the awaited request settles. `CodexRuntime.close()` (`:201`) only sets `closed`, which the reader checks between requests (`:82`). A hung `thread/read` (the exact timeout case) keeps the process alive until the per-request timeout in `codex-app-server-process.ts` (not confirmed how long). The scope is disposed, but the child is not killed on every path. The listed requirement is "child process / scope disposed on every path"; the scope half is met, the process half is not. Fix: thread an AbortSignal into `readHistory` (or track processes in `CodexRuntime` and close them in `close()`), see M3 below.
2. **M-B: `scope.dispose()` in `finally` can mask a successful read or the real error** (`:602`). If dispose rejects, a successfully read history is lost and surfaces as `runtimeFailed` via the outer catch (`:613`); a timeout error is replaced by the dispose error. Wrap dispose in try/catch with a `// degradation-audit:` log, keep the primary outcome. No spec covers it.
3. **M-C: no bound on concurrent reads.** Each read spawns a full App Server process (plus the user's `CODEX_HOME` MCP servers, since the profile deliberately keeps config). Rapid session switching or retry loops can stack N processes, and per M-A timed-out ones linger. Add a small semaphore or per-session in-flight dedupe.
4. **M-D: spec does not prove the real behavior it claims.** `codex-runtime-composition.spec.ts:121-128` mocks `readHistory`, so none of: `verifiedCodexHome` equality against the lowercased win32 key (`normalizeCodexHomeKey` lowercases, `codex-home-path.ts:21`), process kill, or lazy `useValue` resolution is exercised. The timeout test (`:223-236`) asserts dispose count only, not that the underlying call was cancelled. Missing cases: dispose throws, `createScope` throws, `resolveRuntime` throws or returns a runtime without `readHistory`, already-aborted signal, live profile with a different home (must not copy MCP). The home check uses real `normalizeCodexHomeKey` and drive-letter-safe `process.platform`, so it should pass on Windows; branded `SessionId.create()` is used; fine.

## Minor findings

- `:560-561` `realpathSync` is synchronous and throws raw `ENOENT` for a deleted workspace or home; it is mapped to generic `runtimeFailed` (`:613`) rather than `invalidIdentity`/`binaryUnavailable`-style code. No leak of text, but unhelpful. Also blocks the main thread briefly.
- `:589` `let timer` never reassigned (lint prefer-const) and `timer` is assigned after `signal.addEventListener`; harmless ordering.
- `:583,:584-586` the `cancelled` promise can reject before `Promise.race` attaches a handler only if code between `:594` and `:598` awaits; it does not today, but `resolveRuntime` throwing after an `onAbort()` call would leave an unhandled rejection. Add `cancelled.catch(() => undefined)`.
- `:552` model `'history-read'` and `permissionLevel` default are placeholders baked into a profile fingerprint; `resume.profileFingerprint` falls back to the freshly computed one (`:573`), so the profile-fingerprint comparison in the runtime is vacuous when `codexThread` is absent. Acceptable for read, note it.

## Checks that pass

- Binding is `useValue` (`:782-784`); runtime resolved lazily per read via `adapterPorts.resolveRuntime` (`:824-828`). Home resolved lazily. VS Code and CLI untouched; port not required there.
- Home check: saved `codexExecution.codex.normalizedHome` vs current resolver, both normalized (`:542-545`), live-profile MCP reuse additionally requires same home and workspace (`:552-554`). `CODEX_HOME` config is not rewritten; MCP never stripped.
- Missing `codexThread` handled (`:546`, `:566-574`, uses `execution.sessionId`).
- Errors are fixed text and coded (`:496-510`); `CodexSessionHistoryError` mapped; raw errors from `verifyBinary` dropped (the `catch {}` at `:577` swallows into a typed error, which is not a silent swallow; adding a `degradation-audit` comment would satisfy the rule literally).
- Scope disposed in `finally` for timeout, abort, reader throw, and missing `readHistory` (`:596-603`); `createScope` throw happens before any resource exists. Binary check precedes scope allocation.
- DI guard: `expected-resolvable.ts:128` adds the token; `surface-composition.spec.ts` 6 to 7; the failure-case spec correctly excludes the token from the "defaults" snapshot because the parent has no default binding (asserts `isRegistered(token, true)` is false, which confirms rollback unregisters it).

## M1-M4 judgment

M1-M4 are r1 moderate follow-ups in `code-logic-review-D9-12ab-r1.md:25-28`: M1 child-vs-root `threadNotFound` (reader), M2 key-order-sensitive JSON equality (reader), M3 `CodexRuntime.close()` not tracking or aborting in-flight history (`codex-runtime.ts`), M4 O(candidates x depth) closure and full corpus listing (reader). The plan row 12d-1 file scope is only the Electron composition and spec, so M1, M2, M4 being out of scope is acceptable (correctness-neutral or perf, and M1 errs toward a wrong label, not data loss).

**M3 is not acceptable to defer silently.** The lane itself admits the child may run until its own timeout; that is the timeout/abort resource requirement of 12d-1. Either (a) accept it as a tracked known gap with an owner (a small `codex-runtime.ts` change before 12d-2/release gate), or (b) pull `codex-runtime.ts` into scope. Recommend (b): small fix, and it determines whether M-A is closed. M1/M2/M4 can ride to a later hardening batch, but record them in the release gate list.

## Verdict

REVISE (minor). Confidence MEDIUM: not executed; unconfirmed whether scope disposal closes the runtime and the per-request timeout length. Top risk: timed-out or cancelled reads leave the App Server child alive (M-A/M3), compounded by unbounded concurrency (M-C). Add: abortable `readHistory`, tolerant dispose, concurrency cap, specs for dispose-throw/createScope-throw/missing-reader/pre-aborted.

---

## Re-review (after fixes report batch-D9-12d1-fixes-report.md)

Static only; nothing executed.

| Metric | Value |
| --- | --- |
| Score | 8.5/10 |
| Verdict | APPROVE (conditional on green verify) |
| Blocking / Moderate | 0 / 0 |
| Minor | 3 |

### Prior findings

- M-A (child survives timeout/abort): FIXED. `codex-runtime.ts` `readHistory` derives its own AbortController from the caller signal and passes it to `CodexAppServerProcess.start(signal)`. The process registers `onAbort -> fail()` (`codex-app-server-process.ts:216-217`, pre-spawn check `:159`), which rejects pending requests and starts close/kill; the `finally` still awaits `process.close()`. `onAbort` is removed on close (`:619`), and close is guarded by `closing`/`closePromise`, so abort followed by the `finally` close is not a double-close. The Electron side aborts its controller on timeout, abort, and in `finally` (so also after normal completion, harmless), then disposes the scope.
- `close()` (M3): FIXED. It aborts every tracked controller and awaits the tracked read promises, which are wrapped `.then(noop, noop)` so they never reject `Promise.all`. A read after close throws before spawning. Live chat paths are unchanged: only `historyReads` entries were added to the awaited set, and the context close path is untouched.
- M-B (dispose masking): FIXED. Dispose is wrapped, logs via `deps.logger.error` with a `// degradation-audit:` comment, and the read outcome (success, timeout, thrown error) is preserved. Spec covers it (dispose called, outcome kept).
- M-C (concurrency): FIXED as a fail-fast cap of 2 (`activeReads`, incremented only after the check, decremented in the outermost `finally`, so every path releases). No queue means no deadlock or starvation. Trade-off below.
- M-D (spec): FIXED. Runtime specs use `FakeChild` and assert the process is killed on signal abort and on `close()`, that a post-close read spawns nothing, and that a mismatched verified home never issues `thread/read`. Electron specs assert the signal passed to the reader is aborted on timeout and abort, pre-aborted signal, `createScope` throw, missing reader, busy cap, and the live-profile-from-another-home case. These now exercise real behavior rather than only dispose counts.
- Minor items: `pathUnavailable` code added for `realpathSync` failures; `cancelled.catch` guards unhandled rejection; `timer.unref()` added.

### MCP conversion

`codex-runtime-composition.ts:595-599` spreads each server and re-copies the only mutable nested members (`args`, `envReferences`, `headerReferences`). Every field of both union members (`name`, `transport`, `command`, `url`, `urlReference`, `authReference`, `toolTimeoutSec`) survives through the spread; no server is dropped or filtered. Secrets are references only, and `CodexMcpSecrets` are not passed to a history read, so an authenticated MCP server may not authenticate in the read process. That was already the design and does not affect history reading.

### Narrowed runtime type

`resolveRuntime` now returns `Pick<CodexRuntime,'open'> & Partial<CodexHistoryReader>`, used only inside `ElectronCodexHistoryDeps`; the production wrapper forwards `adapterPorts.resolveRuntime`, whose real `CodexRuntime` satisfies it. Chat wiring types are unchanged, so nothing weakens. `hasHistoryReader` is now a real runtime check.

### Remaining minor findings

1. Fail-fast `busy` (cap 2): rapid older-page requests across 3+ sessions will get an error rather than queue. 12d-2 must map `busy` (and `pathUnavailable`) to user-safe RPC codes and let the frontend retry; otherwise a transient user-visible failure.
2. The slot is released only after `scope.dispose()` settles; if disposal hangs (bounded today by process kill timer), the slot is held. Acceptable.
3. `readHistory` in the runtime has a redundant second `signal?.aborted` check after the listener is attached (harmless).

### Verdict

APPROVE, confidence MEDIUM-HIGH: process kill on every path is traced through code and FakeChild specs but not executed; the Jest worker-exit warning is UNCONFIRMED until verify runs. Record M1, M2 and M4 (reader correctness/perf) on the release-gate list; they remain deferred.
