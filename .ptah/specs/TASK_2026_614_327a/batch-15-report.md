# Batch 15 report — TASK_2026_614_327a (D.11, option b)

Status: Task 15.1 done. The hidden watchdog→tap coupling has been replaced with explicit `onMessage` and `onStreamEnd`
callbacks on `StreamTransformer`. `CompactionObservingWatchdog` is deleted. No git was run. `batches.md` and `task.md`
were not touched. No TASK_2026_609 file, `vscode-lm-tools` or `cli-engine` was touched.

## Changed files (all under `D:/projects/ptah-extension/.claude-worktrees/task-614-d-e/libs/backend/agent-sdk/src/lib/`)

### Source

- `helpers/stream-transformer.ts`
  - `StreamTransformConfig` gets two optional fields:
    - `onMessage?: (message: SDKMessage) => void`
    - `onStreamEnd?: () => void`
  - `onMessage` runs for every SDK message (main loop and subagent), right after `activityWatchdog?.observe()` and
    before any transformation. If it throws, the transformer logs one `warn` (sessionId, message type, error name) and
    keeps streaming.
  - `onStreamEnd` runs once in the `finally`, after `activityWatchdog?.stop()`. That covers a normal end, an error and
    an abort or early `return()`. If it throws, the transformer logs a `warn` and does not rethrow, so the stream's
    own outcome (a clean end or the original error) is kept.
- `helpers/session-lifecycle-manager.ts`: `ExecuteQueryResult` (the record) gets two required fields, `onMessage` and
  `onStreamEnd`, with a doc comment saying both must be passed to `transform()`. They are required so a caller cannot
  silently leave them out, which was the coupling D.11 complained about.
- `helpers/session-lifecycle/session-query-executor.service.ts`
  - `CompactionObservingWatchdog` is deleted, along with its `observe` and `stop` overrides.
  - The run now builds a plain `NoActivityWatchdog`. The dwell predicate `() => compactionTap.controlsSession()` is
    passed as its 4th constructor argument, so TASK_2026_597 S1 behaves as before.
  - The result returns `onMessage: (m) => compactionTap.observe(m)` and `onStreamEnd: () => compactionTap.release()`.
    This moves the D.2 normal-end release from the old `stop()` override to the end callback.
  - The abort listener `() => compactionTap.release()` stays, because a run whose stream never reached the transformer
    still has to release. `release()` is still the one idempotent entry point, and its doc comment is updated.
  - The unused `WatchdogTimeoutCause` import is removed.
- `sdk-agent-adapter.ts`: all three `executeQuery`/`executeSlashCommandQuery` call sites (`startChatSession`, the
  `resumeSession` new-query path, `executeSlashCommand`) destructure `onMessage` and `onStreamEnd` and forward them
  to `streamTransformer.transform()`.

### Regression specs

- `helpers/stream-transformer.spec.ts`: new describe "onMessage / onStreamEnd (TASK_2026_614 D.11)" with 4 tests:
  - `status: 'compacting'`, `compact_boundary` and `result` all reach `onMessage` in order, after the watchdog
    observes them. `onStreamEnd` fires once, after `watchdog.stop()`.
  - On a stream error, `onStreamEnd` fires exactly once and the original error is rethrown unchanged.
  - A throwing `onMessage` (TypeError) is called for all 3 messages. The stream still resolves, `onTurnEnd` and
    `onStreamEnd` still fire, and the warn is logged.
  - A throwing `onStreamEnd` replaces neither a clean end nor the stream error, and the warn is logged.
- `helpers/session-lifecycle/session-query-executor.service.spec.ts`
  - New describe "stream callbacks through a real StreamTransformer (TASK_2026_614 D.11)". It builds a real
    `StreamTransformer` with typed mocks and passes it the executor's real `ExecuteQueryResult`
    (`activityWatchdog`, `onMessage`, `onStreamEnd`). It has 3 tests:
    - The real coordinator receives `register(REAL)`, `onStatusCompacting`, `onCompactBoundary(170k→30k)` and
      `onTurnEnd`, and the port is read once. On a normal end with no abort, `onStreamEnd` fires once, the record is
      gone and `port.release` is called once. A later abort releases nothing again.
    - A stream error releases once, and the error still reaches the consumer.
    - The plain watchdog no longer feeds the tap; only `onMessage` does.
  - The existing tests used to drive the tap through `run.activityWatchdog.observe(...)`. They now use a
    `feed(run, m)` helper that mirrors the transformer (watchdog observe, then `onMessage`). The D.2 test's double
    `activityWatchdog.stop()` is now a double `run.onStreamEnd()`.
- `sdk-agent-adapter.spec.ts`: the three "threads the watchdog" tests now also assert that `transformArg.onMessage` and
  `transformArg.onStreamEnd` are the executor's callbacks. The `queryResult()` fixture gets the two new required fields.

## Checks (run from the worktree)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p agent-sdk --parallel=2` | 0 (Tests: 2959 passed, 3 skipped; lint 0 errors, 48 warnings, the same count as Batch 3) |
| `npx nx run-many -t typecheck -p ptah-electron,ptah-cli,ptah-extension-vscode` (exported `ExecuteQueryResult` gained required fields) | 0 |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

`prettier --write` was applied to all 7 touched files.

## Notes

- Plan deviations: none. `onMessage` and `onStreamEnd` are required on `ExecuteQueryResult`. That record has only one
  producer (the executor), so making them required turns "forgot to wire the tap" into a compile error.
- Behaviour preserved:
  - The tap sees every message the transformer iterates, the same set the watchdog saw.
  - Release happens on normal end, error and abort, and it is idempotent.
  - The dwell bound still applies only to coordinator-controlled sessions.
- Out-of-scope observation: if a consumer never starts iterating the transformed stream, its `finally` never runs. This
  is the same as before the change, and the abort listener covers that case.
