# TASK_2026_363 — Batch B report

Bound `SubagentMessageDispatcher.sendToSubagent` with a 10 s timeout that
reports a typed `SEND_TIMEOUT` error.

## Files changed

Three files, exactly the batch scope.

### 1. `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`

Added `| 'SEND_TIMEOUT'` to the `RpcUserErrorCode` union. One line, nothing else.

### 2. `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts`

- Exported `SUBAGENT_SEND_TIMEOUT_MS = 10_000` with a doc comment that cites the
  measured 180 018 ms `subagent:send-message` block of 2026-08-31 and states why
  the push is bounded here: the RPC caller cannot wait for the session watchdog,
  which measures stream silence in minutes.
- Inside the `serialisedPush` callback, `query.streamInput(single())` now races a
  `setTimeout` that rejects with
  `new RpcUserError('Message not accepted within 10s — the session did not read its input channel', 'SEND_TIMEOUT')`.
- The timer is cleared in a `finally` block, so a settled push never leaves a
  live timer behind.
- The existing catch keeps its `SESSION_ENDED` mapping, but rethrows an
  `error instanceof RpcUserError` unchanged. The timeout is therefore never
  re-wrapped.

`stopSubagent`, `backgroundTask`, `interruptSession`, `getSubagentTranscript`
and `normalizeTranscript` are unchanged.

### 3. `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.spec.ts`

New describe block `sendToSubagent — send timeout` with four cases, plus a
header docblock line. The block uses `jest.useFakeTimers()` in `beforeEach` and
`jest.useRealTimers()` in `afterEach`, so the other blocks keep real timers.

1. `streamInput` never settles → rejects with `RpcUserError`,
   `errorCode === 'SEND_TIMEOUT'`, after
   `await jest.advanceTimersByTimeAsync(SUBAGENT_SEND_TIMEOUT_MS)`.
2. `streamInput` resolves promptly → resolves and `jest.getTimerCount() === 0`.
3. `streamInput` rejects → still `SESSION_ENDED`, and no timer is left.
4. A stalled first push that times out does not wedge the per-session chain: a
   second `sendToSubagent` on the same session calls `streamInput` again
   (`toHaveBeenCalledTimes(2)`).

## Commands run

All four commands passed.

| Command                                                                                                | Result                                                         |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `npx nx test @ptah-extension/agent-sdk --skip-nx-cache --testPathPatterns subagent-message-dispatcher` | PASS — 1 suite, 23 tests passed, 0 failed (19 before, 4 added) |
| `npx nx run @ptah-extension/agent-sdk:typecheck --skip-nx-cache`                                       | PASS — exit 0                                                  |
| `npx nx run @ptah-extension/shared:typecheck --skip-nx-cache`                                          | PASS — exit 0                                                  |
| `npx nx run @ptah-extension/agent-sdk:lint --skip-nx-cache`                                            | PASS — exit 0, no finding on the two changed agent-sdk files   |

Note on the flag name: Jest 30 renamed `--testPathPattern` to
`--testPathPatterns`. With the old singular name Jest ignores the filter and
runs the whole project. That full run also passed: 82 suites passed, 1 skipped,
1354 tests passed, 1 skipped.

`npx prettier --write` was run on the spec file, because the added block did not
match the repository format. All three files now pass `prettier --check`.

## Left undone

- Nothing in the batch scope.
- Out of scope by instruction, and untouched: the watchdog holds in
  `session-registry.service.ts`, `session-query-executor.service.ts` and
  `subagent-hook-handler.ts` (the other two fixes of TASK_2026_363).
- The frontend does not map `SEND_TIMEOUT` to a specific message yet. It falls
  through to the generic RPC error path. No frontend file was in scope.
