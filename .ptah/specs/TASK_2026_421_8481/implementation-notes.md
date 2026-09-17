# Implementation notes — TASK_2026_421_8481

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-421-codex-agent-completion`
(branch `fix/task-421-codex-agent-completion`). Staged, not committed.

## Change

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`
In `runSdk` → `runTurn`, the `for await` loop now returns right after
`handleStreamEvent` processes a terminal event:

- `turn.completed` → `return 0`
- `turn.failed` → `return 1`

A short comment above the two checks explains why the loop returns early.
Nothing else changed: iterator end (0), abort (1), the startup watchdog and
error summarization all work as before. `agent-process-manager` is unchanged.

### Why returning early kills the child (verified in `@openai/codex-sdk` 0.147.0 `dist/index.js`)

- `Thread.runStreamed` returns `{ events: runStreamedInternal(...) }`
  (lines 51-53). That generator loops over `CodexExec.run` (lines 77-94).
- If the consumer leaves the loop, it calls `return()` on the outer generator.
  The outer generator is paused at `yield parsed`, so its inner `for await`
  exits. That calls `return()` on `CodexExec.run`, which is paused at
  `yield line`.
- `CodexExec.run`'s `finally` (lines 296-303) runs `rl.close()`,
  `child.removeAllListeners()` and `child.kill()`. Then
  `runStreamedInternal`'s `finally` runs `cleanup()`, which does nothing
  because no output schema is passed.

### Continuation after an early return

`continue()` calls `runTurn(message)` again on the same `thread`. The SDK starts
a **new** child process for each `runStreamed`: `CodexExec.run` spawns per call
and pushes `resume <threadId>` when `_id` is set (lines 225-227). `Thread._id`
is set from `thread.started` (line 86) or from the `resumeThread` id, before the
consumer receives the event. So killing the previous child cannot affect the
next turn. The thread state lives in `~/.codex/sessions`, not in the process.
The new spec "runs a continuation after an early return, on the same thread"
tests this.

### `error` stream event — left non-terminal on purpose

- The `.d.ts` comment on `ThreadErrorEvent` says "unrecoverable error emitted
  directly by the event stream". That comment alone does not prove the turn
  ends there.
- The SDK's own non-streaming consumer, `Thread.run` (lines 97-120), ignores
  `error`. It `break`s only on `turn.failed`, and `turn.failed` is the only
  failure it turns into a thrown error. That is local evidence that the SDK
  expects a turn-level event after `error`.
- Recalled from outside this repository, not checked here: `codex exec` also
  sends `error` for retryable stream errors ("Reconnecting... n/5"). It then
  ends the turn with `turn.failed` or `turn.completed`.
- Returning on `error` could therefore cut off a turn that is retrying. The
  adapter does not return on it. A spec pins this: an `error` event on a stream
  that never ends leaves `done` pending and does not call `return()`.

## Other SDK-based adapters (reported only, not changed)

- **Cursor** (`cursor-cli.adapter.ts` ~347): same shape. The `for await` loop
  over `run.stream()` returns 0 only when the iterator ends. `@cursor/sdk` runs
  in-process: `Agent.create`/`send`, no `codex exec`-style child owned by the
  iterator. Its `SDKMessage` union has a `status` message whose status can be
  `FINISHED | ERROR | CANCELLED | EXPIRED` (`messages.d.ts:62-68`).
  `LocalRunStreamResultEvent` / `LocalRunStreamDoneEvent` and
  `isTerminalLocalRunStreamEvent` exist at the transport layer. Whether
  `stream()` reliably ends after a terminal status was not measured. If Cursor
  agents are ever seen stuck in `running`, apply the same fix: return on a
  terminal `status` message.
- **Copilot** (`copilot-sdk.adapter.ts` ~402): despite the file name, it spawns
  the CLI and resolves on the child `close` event. There is no vendor iterator.
  It has a related risk: a grandchild that holds stdio open delays `close`.
  That is outside this task.
- **antigravity / opencode / pi**: they spawn through `spawnCli`. There is no
  in-process vendor event iterator, so they are not affected by this pattern.

## Specs (`codex-cli.adapter.spec.ts`)

- New helper `createNeverEndingEventSource(events)`. It yields the events, then
  returns a promise that never settles from `next()`, and records whether
  `return()` was called.
- New helper `settleWithin(promise, ms)`. It races the promise against a
  cleared timer, so a regression fails as an assertion, not as a Jest timeout.
- New describe block "terminal turn events on a stream that never ends":
  1. `done` → 0 after `turn.completed`, `return()` called, usage line emitted,
     session id captured.
  2. `done` → 1 after `turn.failed`, `return()` called, `[Turn Failed]` emitted.
  3. An `error` event is not terminal: after 50 ms `done` is still pending and
     `return()` was not called.
  4. A continuation after an early return runs on the same thread and
     resolves 0. Both sources are returned, `startThread` is called once,
     `runStreamed` is called twice, and the second turn's output is emitted.
- The existing specs are unchanged and still pass.

## Verification (worktree root unless stated)

- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache`
  - Header: `Running target test for project @ptah-extension/cli-agent-runtime`
    (1 project).
  - Result: `Test Suites: 51 passed, 51 total`;
    `Tests: 1 skipped, 672 passed, 673 total`; "Successfully ran target test".
  - The run also printed Jest's "A worker process has failed to exit
    gracefully". The codex spec run alone (below) did not print this warning,
    so it does not come from the new tests. A baseline without this change was
    not measured.
- `npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime --skip-nx-cache`
  - EXIT=0, `tsc --noEmit --project libs/backend/cli-agent-runtime/tsconfig.lib.json`,
    "Successfully ran target typecheck".
  - The first attempt ran at the same time as the tests and printed nothing, so
    it was run again.
- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json`
  - EXIT=0, no errors. `tsconfig.lib.json` does not cover the spec file, so
    this check was added.
- From `libs/backend/cli-agent-runtime`:
  `npx jest -c jest.config.ts src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`
  - EXIT=0, `Tests: 52 passed, 52 total`.
- Same command with `-t "never ends"`: EXIT=0,
  `Tests: 48 skipped, 4 passed, 52 total`. This proves the 4 new tests ran.
- `npx prettier --check` on both changed files:
  "All matched files use Prettier code style!"
- Not done: a mutation run to show the new specs fail without the fix. If the
  fix is removed, specs 1, 2 and 4 would get `'still-running'` from
  `settleWithin`, because the fake source never ends.

## Out-of-scope observations

- On Windows, the SDK's `child.kill()` terminates only `codex.exe`. The
  long-lived `powershell.exe` grandchild seen in the measurement can outlive it
  as an orphan. That needs a tree kill, which the SDK does not do.
- `Thread.run` in the SDK (not used by Ptah) also waits for the iterator to end
  on success. It is the same defect upstream.
