# Batch 5 report — TASK_2026_614_327a

Executor: backend-developer. No git was run. `batches.md` and `task.md` were not edited. Nothing in
`cli-agent-runtime` or `vscode-lm-tools` was touched.

## Tasks completed

- 5.1 PostCompact now rekeys the context-usage port and the subagent budget monitor, next to the
  coordinator rebind (D.12 A-m6).
- 5.2 The PostToolUse cap now has a time bound and honours the hook's abort signal (D.12 A-m8).

## Changed files

All paths are under `libs/backend/agent-sdk/src/lib/helpers/`.

- MODIFIED `compaction/context-usage.port.ts`
  - New `IContextUsagePort.rekey(from, to)` and its implementation. An equal or empty `to` is a no-op.
  - A value already held under `to` is newer, so it is kept and the old id's copy is dropped.
    This applies separately to `lastReadings` and to `turnReads`.
  - `TurnRead` now carries a mutable `sessionId`. The read's `.then` writes the reading under
    `read.sessionId`, and only if that read is still the current one for that id.
  - Result: a read in flight when the rekey happens lands under the new id. It never brings back
    the old id, and it never overwrites a read the new id already holds.
- MODIFIED `compaction-hook-handler.ts`
  - Two new optional constructor dependencies:
    - `@inject(SDK_TOKENS.SDK_CONTEXT_USAGE_PORT) contextUsagePort?`
    - `@inject(SDK_TOKENS.SDK_SUBAGENT_BUDGET_MONITOR) subagentBudgetMonitor?`
  - They follow the same pattern the handler already uses for the coordinator.
  - New private `rekeySessionState(from, to)`. It is called inside the existing
    `postFallbackSessionId && postPayloadSessionId` branch, right after `coordinator.onPostCompact`.
  - Each target is rekeyed independently and fails open. A failure logs one warn
    (`PostCompact rekey failed`, with `{ target, error }`) and does not affect the other target or
    the hook result.
- MODIFIED `post-tool-use-hook-handler.ts`
  - New exported constant `POST_TOOL_USE_CAP_TIMEOUT_MS = 10_000`. The SDK's hook timeout defaults
    to 60 s.
  - `capToolOutput` now takes `options.signal`:
    - If the signal is already aborted, the original output is returned straight away and the
      capper is not called.
    - Otherwise `capper.cap` races an unref'd timer and the abort listener. On a timeout or an
      abort, the original output is returned.
  - Logging: one warn on a timeout (with `toolName` and `timeoutMs`), one debug on an abort.
  - `finally` clears the timer and removes the abort listener.
  - A late result or rejection from the capper is ignored, because the race has already settled.
- Specs:
  - `compaction/context-usage.port.spec.ts`: new `rekey` block with 5 tests:
    - the reading moves to the new id
    - an in-flight old read lands under the new id, does not resurrect the old id, and the same
      turn is deduped
    - the new id's own reading is kept
    - an in-flight old read does not overwrite the new id's read
    - no-op cases
  - `compaction-hook-handler.spec.ts`: new describe block with 5 tests:
    - after PostCompact, `getLast(newId)` returns the last reading (real `ContextUsagePort`)
    - an in-flight read for the old id does not resurrect it
    - the monitor is rekeyed from the PreCompact id to the PostCompact id
    - nothing is rekeyed when PostCompact carries no `session_id`
    - a throwing port logs one warn, the monitor is still rekeyed, and the hook returns
      `{ continue: true }`
  - `post-tool-use-hook-handler.spec.ts`: new block with 4 tests:
    - a capper that never resolves returns the original output only at the bound (still pending
      at bound - 1 ms), logs one warn and leaves no timer
    - an already aborted signal returns the original output and never calls the capper
    - an abort mid-cap returns the original output and removes the listener
    - a fast cap clears its timer
  - `session-lifecycle/session-query-executor.service.spec.ts`: two hand-written
    `IContextUsagePort` mocks (around lines 757 and 1226) got `rekey: jest.fn()`. The interface
    change requires this. Only these two lines changed.

## Checks (run from the worktree)

| Command | Exit | Result |
| --- | --- | --- |
| `npx nx test agent-sdk --testPathPatterns="compaction-hook-handler\|context-usage.port\|post-tool-use-hook-handler\|session-query-executor"` | 0 after the mock fix | the first run hit TS2741 on the `session-query-executor` mock at line 757, which is now fixed |
| `npx nx run-many -t typecheck,lint,test -p agent-sdk --parallel=2` (first run) | 1 | 2986 passed, 1 failed: `session-handoff-writer.spec.ts` "never prunes the file it just wrote" hit the 5 s timeout and then ENOTEMPTY on a temp dir. This file was not touched; it is filesystem load from parallel executors. |
| `npx nx test agent-sdk --testPathPatterns="session-handoff-writer"` | 0 | 9/9 passed |
| `npx nx run-many -t typecheck,lint,test -p agent-sdk --parallel=2` (rerun) | 0 | all 3 targets passed; lint came from the cache of the first run, with identical inputs |
| `npx nx test ptah-electron --testPathPatterns="wire-runtime\|container.smoke"` | 0 | 3 suites, 56 tests passed (no DI cycle from the new handler dependencies) |
| `npx nx run di-lint:lint` | 0 | — |
| `npx nx run degradation-audit:lint` | 0 | — |

## Plan deviations

- "Refuse-overwrite like the coordinator". The coordinator does not actually refuse: `onPostCompact`
  replaces a record already held under the new id (`compaction-coordinator.ts:236`). I followed the
  plan's stated intent for the port and kept the new id's value. For the port this is the right
  choice, because a value under the new id comes from a later read. The monitor keeps its Batch 4
  rule, where `from` wins on a clash. I did not change it.
- The monitor and the port are constructor-injected into `CompactionHookHandler`, the same way the
  handler already gets the coordinator. This is safe for the cycle: the monitor factory
  (`di/register.ts:463-483`) still resolves the dispatcher lazily. Building the monitor resolves
  only Logger, the config provider and `SubagentRegistryService`. The electron container smoke and
  wire-runtime suites pass.
- I edited `session-query-executor.service.spec.ts` (2 lines), which is outside the listed files.
  The interface change forced it. Batches 3, 4 and 15 also touch this spec.

## Out-of-scope observations

- `session-handoff-writer.spec.ts` can time out under parallel filesystem load. It passes when run
  alone.
- The rekey runs only when PostCompact carries a `session_id`, the same condition as the
  coordinator. When PreCompact had no payload id, `from` is the closure id, just as for the
  coordinator.
