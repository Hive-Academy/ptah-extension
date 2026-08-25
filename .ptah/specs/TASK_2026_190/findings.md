# TASK_2026_190 — Replace stderr-pattern provider-error abort with a no-activity timeout

## Memory invariants recovered and how they are honoured

`ptah_memory_search` returned the teardown-order invariants the spec required:

1. **`session-lifecycle-abort` / `ptah-session-teardown-order`** — On abort, the
   cleanup ORDER matters: `cleanupPendingPermissions` → `markAllInterrupted` →
   `query.interrupt()` → `abort()` → registry removal. Pending permissions must
   be resolved BEFORE the CLI stream closes.
2. **`stream-closed-abort-benign-teardown` / `streaming-error-handling`** — The
   CLI-internal `can_use_tool` / `Stream closed` rejection on abort is BENIGN
   teardown (Ptah already resolved its side); it must NOT be surfaced as a real
   error. It is only mislogged when Ptah fails to resolve its side first.
3. **`sdk-terminal-reasons-abort-vs-complete`** — user/SDK abort ends a turn as
   `aborted_streaming`/`aborted_tools`; the StreamTransformer catch treats any
   error message containing "abort"/"cancel" as a benign user abort (suppressed).

**How the timeout abort honours them:**

- The watchdog's `onTimeout` calls `permissionHandler.cleanupPendingPermissions(rec.tabId)`
  FIRST, then `abortController.abort(...)` — mirroring `endSession()`'s
  cleanup-first ordering, so an in-flight `can_use_tool` is resolved on the Ptah
  side before the stream closes and the "Stream closed" rejection stays benign
  (invariants 1 + 2). Strictly better than the old `onProviderError`, which
  aborted WITHOUT resolving pending permissions.
- The abort reason is worded deliberately WITHOUT "abort"/"cancel" ("No stream
  activity for Ns — no response from provider…"), so the StreamTransformer catch
  classifies it as a REAL error and surfaces it (invariant 3).
- The watchdog is `stop()`-ed in the StreamTransformer `finally` (every teardown
  path) and defensively on executor init-failure rollback, so it cannot leak or
  fire late.

## Watchdog design

- **New class `NoActivityWatchdog`** (`no-activity-watchdog.ts`): a resettable
  single-shot inactivity timer. `start()` arms, `kick()` resets the window,
  `stop()` disarms permanently. `fired`/`stopped` guards ensure at-most-once and
  never-after-stop.
- **Timer driven by `StreamTransformer.transform`** — the single stream consumer.
  `start()` before the `for await`, `kick()` at the TOP of every iteration so ANY
  event (message, partial/streaming delta, tool_use, tool_result, thinking)
  resets the window; `stop()` in `finally`.
- **Abort policy lives in `SessionQueryExecutor`** (exactly where `onProviderError`
  was): constructs the watchdog with the cleanup-then-abort closure, returns it in
  `ExecuteQueryResult.activityWatchdog`, threaded through the adapter into
  `transform`.
- **Chosen N = 180_000 ms (3 min)**, `NO_ACTIVITY_TIMEOUT_MS`. Because the timer
  resets on any event this bounds a FULLY SILENT gap, not a turn cap. 3 min clears
  p99 first-token latency (old first-response timeout was 90s for this alone),
  long tool calls whose only events are tool_use→tool_result (multi-minute
  builds), and extended thinking (streams deltas that keep kicking). Subsumes the
  old 90s first-response timeout.

## What was removed and why it was safe

- Deleted `isFatalUpstreamProviderError()` and its `onProviderError` stderr-match
  wiring (stderr callback now logs only). `ptah_lsp_references` + repo-wide grep
  confirmed the only references were the definition, its call site, and its spec —
  no external consumer.
- Removed `onProviderError` from `QueryOptionsInput` and the executor's `build()`
  call; removed the first-response-only timeout in `stream-transformer.ts`
  (`abortController` in config replaced by `activityWatchdog`).
- Repo-wide grep confirmed nothing else constructs `ExecuteQueryResult`; the one
  external `executeQuery` caller (memory-curator `knowledge-agent.service.ts`)
  ignores the return value, so the new required field is safe.

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.ts` — NEW (watchdog + constant)
- `.../helpers/no-activity-watchdog.spec.ts` — NEW (fake-timer unit tests)
- `.../helpers/session-lifecycle/session-query-executor.service.ts` — build watchdog (cleanup→abort), return it, defensive stop on rollback; removed `onProviderError` block
- `.../helpers/session-lifecycle-manager.ts` — `ExecuteQueryResult.activityWatchdog`
- `.../helpers/sdk-query-options-builder.ts` — deleted predicate + stderr abort wiring
- `.../helpers/stream-transformer.ts` — `activityWatchdog` replaces `abortController`; start/kick/stop
- `.../sdk-agent-adapter.ts:522,627,731` — thread `activityWatchdog` into the three `transform()` calls
- `.../helpers/index.ts` — export watchdog
- Specs updated: `session-query-executor.service.spec.ts`, `stream-transformer.spec.ts`, `sdk-agent-adapter.spec.ts`, `sdk-query-options-builder.spec.ts`

## Verification

- `npx nx typecheck agent-sdk` → Success. `npx nx typecheck memory-curator` → Success.
- `npx nx test agent-sdk` (clean env) → 65 suites, 846 tests passed.
- `npx nx lint agent-sdk` → 0 errors, 31 pre-existing warnings in untouched files.
- Caveat: with the dev shell's polluted `ANTHROPIC_AUTH_TOKEN=""`, one PRE-EXISTING
  unrelated test (`sdk-query-runner.service.spec.ts`, unmodified) fails; with the
  var unset all 846 pass.
