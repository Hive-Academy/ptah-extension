# Batch 1 — Shared Git Contracts and exec-git Primitives (`TASK_2026_576_e16a`)

- **Author**: in-process subagent (`backend-developer`)
- **Reviewer**: CLI lane (`antigravity`)
- **Score**: 9/10
- **Verdict**: APPROVED

> [!NOTE]
> A Glm review attempt failed (Ollama Cloud usage limit, HTTP 429) and produced no review.

---

## Summary

| Metric              | Value                    |
| ------------------- | ------------------------ |
| Overall score       | 9/10                     |
| Assessment          | APPROVED                 |
| Blocking issues     | 0                        |
| Serious issues      | 0                        |
| Moderate issues     | 0                        |
| Minor issues        | 2                        |
| Failure modes found | 2 (both handled cleanly) |

The Batch 1 implementation fulfills the contract and primitive requirements for Task 1.1 and Task 1.2 cleanly. Concurrency management, gate slot lifecycle, cancellation via `AbortSignal`, streaming output with multi-byte boundary protection, and lock classification are designed without slot leaks, hangs, or race conditions. All backward-compatibility invariants (regex matching on timeout messages, optional fields on mutation results, union widening without breakage) are preserved.

---

## Five Logic Questions

### 1. How does this fail silently — where does a failure produce a success-looking result?

- **Streaming observer exceptions** ([`libs/backend/vscode-core/src/utils/exec-git.ts:783-792`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L783-L792)): If `onOutput` throws an error, `emitOutput` swallows the exception within a `try / catch` block. This intentionally allows the underlying git command to succeed without letting an observer defect crash the execution pipeline, adhering to the documented degradation policy.
- **Git non-zero exit codes** ([`libs/backend/vscode-core/src/utils/exec-git.ts:813-828`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L813-L828)): Non-zero exit codes from git (e.g. diff divergence, unmerged paths) resolve rather than reject `{ stdout, stderr, exitCode }`. This is the established contract across `vscode-core` so downstream callers can parse semantic exit states.

### 2. What user action produces unexpected behaviour?

- **Repeated or rapid cancellation triggers**: If a user cancels an operation before a gate slot is acquired, `acquireUnlessAborted` immediately rejects and ensures that whenever the slot is eventually granted, it is surrendered instantly via `release()`. If the user cancels mid-run, `terminate()` issues `SIGTERM`, escalates via `killProcessTree` on Windows, and holds the slot until the child process terminates or the 2,000 ms grace period expires. No slot leakage or deadlocks occur under rapid cancel cycles.

### 3. What input data produces a wrong answer rather than an error?

- **Lock failure classification** ([`libs/backend/vscode-core/src/utils/exec-git.ts:439-444`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L439-L444)): `isIndexLockFailure` matches `/Unable to create '.*index\.lock': File exists/`. Because `execGit` enforces `GIT_DETERMINISTIC_ENV` (`LC_ALL: 'C'`, `LANG: 'C'`), English error messages are deterministic. Non-index locks (such as `HEAD.lock` or `config.lock`) or permission errors (`Permission denied`) correctly evaluate to `false` and avoid false-positive retry loops.

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

- **Process timeout**: `GitTimeoutError` is thrown with the exact message format `git <subcommand> timed out after <timeoutMs>ms` and property `code: 'GIT_TIMEOUT'`. Callers relying on `/timed out after \d+ms/` (such as `git-info.service.ts:2103` and `git-review-reader.service.ts:449`) continue to match without regression.
- **Output exceeding buffer threshold**: When output exceeds `maxOutputBytes`, `runGitChild` terminates the process, aborts further chunk collection and decoding, and rejects with `GitOutputLimitError`.
- **Incomplete UTF-8 byte sequences**: Streaming through `TextDecoder({ stream: true })` buffers incomplete trailing multi-byte sequences until the next chunk arrives. On stream close, `TextDecoder.decode()` flushes any remaining buffer, preventing spurious `\uFFFD` replacement characters across chunk splits.

### 5. What is missing that the requirements never mentioned?

- **Defensive pre-check inside `acquireUnlessAborted`**: `acquireUnlessAborted` expects its caller to have checked `signal.aborted` beforehand (done at `execGitBuffer:645`). If invoked in isolation with an already-aborted signal, `addEventListener('abort', ...)` does not fire retroactively. (Documented as Minor Finding 1).
- **Promise rejection handling on `acquired`**: In `acquireUnlessAborted`, `void acquired.then(...)` does not supply a rejection handler because `GitProcessGate.acquire` only resolves; however, adding `.catch(reject)` would future-proof against custom spawner or gate changes. (Documented as Minor Finding 2).

---

## Failure Modes

### FM1: Abort Signal Arrives While Queued in GitProcessGate

- **Trigger**: Caller invokes `execGit` with an `AbortSignal` and aborts while the call is waiting in the FIFO queue for an available concurrency slot.
- **Symptom**: Without proper cleanup, the slot granted later could remain permanently held or unreleased, starving future git operations.
- **Evidence**: [`libs/backend/vscode-core/src/utils/exec-git.ts:658-675`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L658-L675)
- **Current handling**: `acquireUnlessAborted` sets `cancelled = true` upon abort and immediately rejects with `GitCancelledError`. When `acquired` resolves, `if (cancelled) release()` hands the slot back immediately.
- **Recommendation**: Retain current handling; add an entry check for `signal.aborted` inside `acquireUnlessAborted` for extra defensiveness.

### FM2: Throwing Output Observer During Streaming

- **Trigger**: Consumer provides an `onOutput` callback that throws an exception upon receiving a chunk.
- **Symptom**: Stream listener throws an unhandled error inside Node's event emitter, crashing the process or interrupting an otherwise healthy git command.
- **Evidence**: [`libs/backend/vscode-core/src/utils/exec-git.ts:783-792`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L783-L792)
- **Current handling**: Wrapped in `try / catch` in `emitOutput`, safely swallowing observer errors.
- **Recommendation**: Retain current implementation.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### Minor Finding 1: `acquireUnlessAborted` Lacks Entry Check for Pre-Aborted Signal

- **File**: [`libs/backend/vscode-core/src/utils/exec-git.ts:658-676`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L658-L676)
- **Scenario**: If `acquireUnlessAborted` is ever invoked directly with an already-aborted signal, `addEventListener('abort', ...)` does not fire for already-dispatched events under DOM/Node AbortSignal semantics.
- **Impact**: Currently protected by the synchronous caller check at `execGitBuffer:645`. However, as a standalone utility function, it should be self-contained.
- **Fix**: Add `if (signal.aborted) { return acquired.then((rel) => { rel(); throw new GitCancelledError(subcommand); }); }` at the top of `acquireUnlessAborted`.

### Minor Finding 2: `acquired.then` in `acquireUnlessAborted` Omits Rejection Handler

- **File**: [`libs/backend/vscode-core/src/utils/exec-git.ts:670-674`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L670-L674)
- **Scenario**: If `acquired` promise ever rejects, `void acquired.then(...)` does not handle the rejection.
- **Impact**: While `GitProcessGate.acquire` does not reject today, standard Promise practice requires `.then(..., reject)` to prevent potential unhandled promise rejections.
- **Fix**: Update `void acquired.then(..., reject)`.

---

## Data Flow

1. **Invocation**: `execGit` / `execGitBuffer` called with `(args, cwd, options)`. [OK]
2. **Signal Pre-check**: If `options.signal?.aborted`, immediately throws `GitCancelledError(args[0])` before requesting gate slot. [OK]
3. **Gate Acquisition**: `gitProcessGate().acquire(cwd, lane)` enqueues request; `acquireUnlessAborted` listens for `abort` event during wait. [OK]
4. **Post-Acquire Abort Guard**: If `signal.aborted` occurred right as slot was granted, slot is immediately released and `GitCancelledError` is thrown without spawning. [OK]
5. **Spawn**: `spawnGitChild` starts git process with deterministic environment (`LC_ALL=C`, `LANG=C`, `GIT_OPTIONAL_LOCKS=0`). [OK]
6. **Streaming & Accumulation**: Stdout/stderr chunks tracked against `maxOutputBytes`; decoded via streaming `TextDecoder` and emitted to `onOutput`. [OK]
7. **Settlement**:
   - On close: Remaining decoder buffers flushed to `onOutput`, timeout/abort listeners removed, slot released, resolved with `{ stdout, stderr, exitCode }`. [OK]
   - On timeout: `GitTimeoutError` thrown, process tree killed, slot held until exit or 2s grace expires. [OK]
   - On abort mid-run: `GitCancelledError` thrown, process tree killed, slot held until exit or 2s grace expires. [OK]

---

## Requirements Fulfilment

| Requirement                                                                           | Status   | Gap                                                                       |
| ------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Task 1.1: `GitMutationFailureCode` union with 5 codes                                 | COMPLETE | None. Defined and asserted in spec.                                       |
| Task 1.1: 9 mutation result interfaces carry optional `code?: GitMutationFailureCode` | COMPLETE | None. Present on all 9 interfaces.                                        |
| Task 1.1: `GitCommitResult` gains `hookOutput?`, `exitCode?`, `subject?`              | COMPLETE | None. All present and optional.                                           |
| Task 1.1: `GitStatusUnavailableReason` exported replacing inline literal              | COMPLETE | None. Replaced in `rpc-git.types.ts` and barrel exported.                 |
| Task 1.1: `git-operation.constants.ts` timing & lock constants                        | COMPLETE | None. Constants and `gitRpcTimeoutFor` match specification.               |
| Task 1.1: Shared barrel re-export                                                     | COMPLETE | None. Added to `libs/shared/src/index.ts`.                                |
| Task 1.2: `signal?: AbortSignal` & `onOutput?: (...)` on `ExecGitOptions`             | COMPLETE | None. Added with accurate JSDoc.                                          |
| Task 1.2: `GitTimeoutError` and `GitCancelledError` exported                          | COMPLETE | None. Exported classes with error codes and compliant message formats.    |
| Task 1.2: Pure `isIndexLockFailure(stderr)`                                           | COMPLETE | None. Exported and tested against real-world stderr variants.             |
| Task 1.2: `exec-git.spec.ts` test coverage                                            | COMPLETE | None. Cancellation, streaming multibyte, lock classification all covered. |

---

## Edge Cases

| Case                                 | Handled | How                                                                                              | Concern |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ | ------- |
| Abort before spawn                   | YES     | Rejects with `GitCancelledError`; gate slot never requested or immediately released.             | None    |
| Abort while queued                   | YES     | `acquireUnlessAborted` catches `abort`, rejects immediately; releases slot when gate grants it.  | None    |
| Abort mid-run                        | YES     | Child process tree terminated; slot held until exit or kill grace timer (2s) expires.            | None    |
| Abort after exit                     | YES     | `finish()` removes abort event listener; `settled` flag guards against duplicate termination.    | None    |
| Multi-byte UTF-8 split across chunks | YES     | Decoded chunk-by-chunk with `{ stream: true }`; incomplete characters preserved until completed. | None    |
| Observer throws exception            | YES     | `emitOutput` catches and swallows observer errors without interrupting git execution.            | None    |
| Output exceeds `maxOutputBytes`      | YES     | Child terminated, rejects with `GitOutputLimitError`, no further data emitted to `onOutput`.     | None    |
| Windows path in lock failure         | YES     | Regex `.*index\.lock` matches both forward and backward slashes and worktree paths.              | None    |

---

## Verified

- `libs/shared/src/lib/types/rpc/rpc-git.types.ts`: Clean type definitions with backward compatibility intact.
- `libs/shared/src/lib/constants/git-operation.constants.ts`: All constants match plan lines 195–201.
- `libs/shared/src/lib/constants/git-operation.constants.spec.ts`: 6/6 tests passing.
- `libs/backend/vscode-core/src/utils/exec-git.ts`: Concurrency and supervision invariants preserved; zero diagnostics reported.
- `libs/backend/vscode-core/src/utils/exec-git.spec.ts`: 67/67 tests passing (including cancellation, streaming, and lock classification).
- Typecheck `@ptah-extension/git-ui:typecheck`: 0 errors (validating A15).

---

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: Downstream consumers in future batches must ensure they propagate `code` and `hookOutput` faithfully through the RPC layer without swallowing them.
- **What a robust implementation would add**: Add defensive `if (signal.aborted)` check inside `acquireUnlessAborted` for self-contained robustness.
