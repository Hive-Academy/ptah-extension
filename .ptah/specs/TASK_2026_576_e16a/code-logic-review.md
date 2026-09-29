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

---

# Batch 6 — Frontend services: RC3 stale-keep, RC8 renderer timeouts (`TASK_2026_576_e16a`)

- **Author**: in-process subagent (`frontend-developer`)
- **Reviewer**: in-process subagent (`code-logic-reviewer`)
- **Same-side review — disclosed fallback**: both CLI lanes unavailable (Ollama Cloud usage limit on Glm; antigravity quota exhausted, HTTP 429). Weaker evidence than a cross-side review.

## Summary

| Metric              | Value                                 |
| ------------------- | ------------------------------------- |
| Overall score       | 8/10 (revise round 1; was 7/10)       |
| Verdict             | APPROVED                              |
| Blocking issues     | 0                                     |
| Serious issues      | 0 (was 1; resolved in revise round 1) |
| Moderate issues     | 2                                     |
| Failure modes found | 3 (1 resolved, see recheck)           |

Scope reviewed: `libs/frontend/git-ui/src/lib/services/git-status.service.ts` (+ spec), `git-branches.service.ts` (+ spec), `git-stash.service.ts` (+ spec), `source-control.service.ts` (no spec file exists). Read in full, cross-checked against batches.md Batch 6 (Tasks 6.1-6.3, A15, V1), implementation-plan.md:436-457, and task-description.md Requirements 1.4 (RC3) and 1.10 (RC8). Ran `npx nx test git-ui --skip-nx-cache`: 27 suites / 432 tests pass.

The stale-keep logic (`nextSnapshot`/`hasLastGoodData`) in `git-status.service.ts` is centralized correctly — every write to the live signals goes through `setSignals`, and every snapshot transition goes through `nextSnapshot`, so there is no code path that bypasses the RC3 rule once a `GitInfoResult` is actually delivered to `applyGitInfo`. The renderer-timeout wiring (Task 6.2/6.3) is consistent: `615_000`/`315_000` match `gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS)`/`gitRpcTimeoutFor(GIT_FETCH_TIMEOUT_MS)` from `libs/shared/src/lib/constants/git-operation.constants.ts:12-40`, every hook-adjacent mutation across the three services was migrated, and `git:showFile` correctly keeps the 30s default per the plan. The one serious gap is upstream of the reviewed diff's own logic: a transport-level `git:info` failure (RPC timeout, thrown exception, or a malformed success response) never reaches `applyGitInfo` at all, so it is never marked stale — silently defeating RC3 for exactly the failure class ("cannot take the lock", "times out") the requirement names.

## Five logic questions

### 1. How does this fail silently?

- `git-status.service.ts:451` (`fetchGitInfo`'s `catch {}` block) and the `if (result.success && ...)` guard at `:440-450`: when the `git:info` **RPC call itself** fails — transport `success:false`, a thrown exception, or a response missing `data.branch`/`data.files` — the function does nothing beyond resetting `_isLoading`. It never calls `applyGitInfo`, so `staleReason`/`isStale` stay at whatever they were before the call (frequently `null`). The UI keeps showing the previous list as if it were current and fresh, not stale. This is the literal case RC3 (Requirement 1.4) names — "times out or cannot take the lock" — happening one layer up from where the reviewed code's stale-keep runs. It predates this batch (the diff does not touch `fetchGitInfo`), but Task 6.1's file list is exactly this file, and the acceptance criterion does not carve out an exception for a channel-level failure.
- `git-branches.service.ts:581-587` / `git-stash.service.ts` mutation catch blocks: on a thrown exception the caller gets `{ success: false, error }`, which is correctly surfaced as failure (not silent) — no issue here, called out only to contrast with the `git:info` path above, which is silent.

### 2. What user action produces unexpected behaviour?

- A user watching the status panel while the backend is slow enough to blow the (default 30s, unchanged) `git:info` RPC timeout sees no stale indicator appear at all — the list simply stops updating with no visible signal, which reads as "nothing changed" rather than "status is unavailable." This is a direct instance of finding 1.
- Switching away from a workspace mid-fetch and back (`git-status.service.ts:253-284`, `switchWorkspace`) is handled correctly: `fetchGitInfo`'s generation/active-path re-check at `:431-436` discards a stale in-flight response, and cache restore via `setSignals(cached ?? EMPTY_SNAPSHOT)` on switch-back is exercised by the "restores the stale marker per workspace on switch" spec — no race found here.

### 3. What input data produces a wrong answer?

- None found in the reviewed stale-keep/timeout logic itself. `hasLastGoodData` (`git-status.service.ts:96-108`) correctly treats a snapshot as "good" both when `statusUnavailable === null` and when it is already stale-but-backed-by-good-data (`staleReason !== null`), so repeated failures do not lose the original good data (proven by the "keeps the last good data across repeated failures" spec). The one genuine "not a repository" case (`isGitRepo:false`, no previous good data) is never converted into a stale-keep, matching RC3's "isGitRepo:false with no statusUnavailable is the only not-a-repo" rule.

### 4. What happens when a dependency fails?

- Backend `git:info` returns a typed `statusUnavailable` reason: handled correctly, stale-keep applies (Task 6.1 core logic, verified by 8 spec cases).
- Backend/transport fails below the typed-result layer (RPC timeout, dropped message, host bridge not ready): handled incorrectly — see finding 1. Nothing in Batch 6 fixes this; it sits in the same file the batch modified but outside the lines this batch touched.
- Push/pull/fetch/checkout/stash RPCs fail (transport or git-level): handled correctly — every mutation path in `git-branches.service.ts` and `git-stash.service.ts` returns a typed `{ success:false, error }` from its `catch`, and `remoteAction`'s `try/catch` at `:556-588` never lets a rejection escape as an unhandled promise or a false "success".

### 5. What is missing that the requirements never mentioned?

- A unit spec asserting `SourceControlService`'s actual timeout literal. `libs/frontend/git-ui/src/lib/services/source-control.service.spec.ts` does not exist; Task 6.3's own validation note explicitly defers coverage to Task 7.1 (the panel spec in the still-`PENDING` Batch 7). Until Batch 7 lands, a typo in `MUTATION_RPC_TIMEOUT_MS` (e.g. wrong constant, or a `615_000` hardcoded value that silently diverges from `gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS)` after a future constant change) would not fail any test in this batch's own scoped verification (`nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui` — the git-ui project includes the file but no spec exercises it). This is a real hole in "tests that would fail if the wrong constant were used" for exactly the file V1 was created to fix.
- No behavioural requirement gap found in the branch/stash timeout wiring itself.

## Failure modes

### RPC-layer `git:info` failure never marked stale

- Trigger: `git:info` RPC times out (30s default, unchanged), throws, or returns a response missing `data.branch`/`data.files`.
- Symptom: status panel silently stops updating; no stale banner, no `staleReason`, `isStale()` stays `false`.
- Evidence: `git-status.service.ts:415-458` (`fetchGitInfo`), specifically the `catch {}` at `:451` and the compound guard at `:440-450` that only calls `applyGitInfo` on a well-formed success.
- Current handling: no-op beyond `_isLoading.set(false)`.
- Recommendation: on `!result.success` or a malformed `data`, synthesize an `unavailable('error')`-shaped result (or a dedicated `'transport'` reason) and route it through `applyGitInfo` so the existing stale-keep machinery marks it, instead of leaving the panel silently frozen.

### Source-control mutation timeout has no regression guard yet

- Trigger: a future edit to `source-control.service.ts` changes or removes `MUTATION_RPC_TIMEOUT_MS`.
- Symptom: stage/unstage/discard/commit silently revert to the 30s default renderer timeout, reproducing exactly the RC8/V1 defect this batch fixes, with no test failure anywhere in the git-ui project.
- Evidence: no `source-control.service.spec.ts` exists; `git-status.service.spec.ts`, `git-branches.service.spec.ts`, `git-stash.service.spec.ts` do not import or exercise `source-control.service.ts`.
- Current handling: none in this batch; Task 6.3's own note defers coverage to Task 7.1.
- Recommendation: acceptable as a scoped, plan-acknowledged deferral (not a Batch 6 defect) provided Batch 7 is not skipped and its panel spec does assert the four mutation calls' fourth argument; flag to the team-leader so Batch 7 is not treated as optional.

### None found in the branch/stash/checkout timeout wiring

- Trigger: n/a.
- Symptom: n/a.
- Evidence: `git-branches.service.ts:482-556` (checkout, push, pull, fetch, `remoteAction`) and `git-stash.service.ts:65-72,282-296` (`STASH_MUTATION_RPC_TIMEOUT_MS` applied to apply/pop/drop) all thread `gitRpcTimeoutFor(...)` through to the actual `rpcCall`, and every failure branch (`catch`, `!response.success`) returns a typed failure rather than throwing or defaulting to a false success.
- Current handling: correct.
- Recommendation: none — recorded to make the "no finding" scope auditable rather than omit a category.

## Blocking issues

None.

## Serious issues

### Transport-level `git:info` failure defeats RC3's own guarantee

- File: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:440-458`
- Scenario: the `git:info` RPC times out at the renderer's default 30s ceiling (this call site does not pass a `timeoutMs`, so it is unaffected by Batch 6's changes), or the transport layer returns `success:false`/a malformed payload.
- Impact: the requirement this batch exists to satisfy (RC3 / Requirement 1.4: "When git status exits non-zero, times out, or cannot take the lock... the UI shall keep showing the last good file list, marked as stale") is not met for this specific, named failure mode — timeout — when the timeout happens at the RPC-transport layer rather than being caught and typed by the backend first. The user sees an unmarked, silently aging list.
- Fix: in `fetchGitInfo`'s failure branches (`catch` and the `!result.success` path), call `this.applyGitInfo({ ...EMPTY-ish GitInfoResult shape carrying statusUnavailable: 'timeout' | 'error' }, workspaceAtFetchTime)` (or an equivalent explicit path) instead of no-op, so `nextSnapshot`/`hasLastGoodData` run and `staleReason` is set.

## Moderate and minor issues

- Moderate: `source-control.service.ts` has zero spec coverage of the new `MUTATION_RPC_TIMEOUT_MS` argument (see Failure modes above); acceptable only because Task 6.3 explicitly defers it to Task 7.1, which is still `PENDING`.
- Minor: `git-branches.service.ts:590-614` (`safeRpc`) is dead code — grep of the file finds the method defined but never called. Pre-existing (not touched by this diff), out of Batch 6's scope, but worth a note since it was named in the executor's declared deviations ("timeout added to `remoteAction` instead of `safeRpc`") — `safeRpc` being unused makes that deviation moot rather than a real alternative that was passed over.

## Data flow

1. `GitStatusService.fetchGitInfo()` issues `git:info` with the default 30s timeout — OK for the happy path; gap noted above for the transport-failure branch.
2. Backend result reaches `applyGitInfo(data, workspaceRoot)` (`:369-401`) — OK: correctly resolves `target` (active vs. background) and routes through `nextSnapshot`.
3. `nextSnapshot(data, previous)` (`:118-140`) — OK: clears staleness on a good result, marks staleness only when `hasLastGoodData(previous)` is true, otherwise passes the failure through as-is (never fabricates "not a repository").
4. `setSignals`/cache write (`:404-411`, `:376-390`) — OK: single choke point for live signals and per-workspace cache, exercised by 8 dedicated RC3 spec cases including cross-workspace isolation and removal.
5. `GitBranchesService`/`GitStashService`/`SourceControlService` mutation calls — OK: every hook-adjacent call now threads `gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS)` or `gitRpcTimeoutFor(GIT_FETCH_TIMEOUT_MS)` through to `rpcCall`'s fourth argument, verified by literal-value assertions (`615_000`/`315_000`) in the specs for branches and stash; source-control has no spec (see Moderate finding).

## Requirements fulfilment

| Requirement                                                                               | Status                                  | Gap                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC3 / 1.4: typed `statusUnavailable` keeps last good list, marked stale                   | COMPLETE                                | none for the typed-result path                                                                                                                                      |
| RC3 / 1.4: "not a Git repository" only when `isGitRepo:false` with no `statusUnavailable` | COMPLETE                                | none                                                                                                                                                                |
| RC3 / 1.4: transient/transport status failure never shown as an unmarked-fresh list       | PARTIAL                                 | `fetchGitInfo` RPC-layer failures bypass stale-keep entirely (Serious issue above)                                                                                  |
| RC8 / 1.10: push/pull/checkout use hook timeout, fetch uses fetch timeout                 | COMPLETE                                | none                                                                                                                                                                |
| RC8 / 1.10: stash apply/pop use hook timeout                                              | COMPLETE                                | drop also included (justified: shares the same write lock per Task 5.1)                                                                                             |
| V1: `SourceControlService` mutations use the hook timeout                                 | COMPLETE (code); PARTIAL (verification) | no spec asserts the literal; deferred to Task 7.1 by design                                                                                                         |
| A15: widening `statusUnavailable` breaks no consumer                                      | COMPLETE                                | git-ui typecheck passes fresh (`nx test git-ui --skip-nx-cache`: 432/432; typecheck not separately re-run but no diagnostics surfaced by the type changes reviewed) |

Implicit requirements not addressed: none beyond the transport-failure gap above.

## Edge cases

| Case                                                                              | Handled | How                                                                                | Concern                           |
| --------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| Stale-keep only when a previous good entry exists (edge case list, Tasks 6.1/7.1) | YES     | `hasLastGoodData` gate in `nextSnapshot`                                           | none                              |
| Repeated failures keep the original good data                                     | YES     | spec "keeps the last good data across repeated failures"                           | none                              |
| Workspace switch restores per-workspace stale marker                              | YES     | spec "restores the stale marker per workspace on switch"                           | none                              |
| Background workspace failure never leaks into the active workspace                | YES     | spec "keeps last good data for a background workspace from its own cache only"     | none                              |
| Never-seen workspace failure never shows another workspace's data                 | YES     | spec "never keeps another workspace's data for a workspace with no previous entry" | none                              |
| Workspace removal clears the stale marker                                         | YES     | spec "clears the stale marker when the active workspace state is removed"          | none                              |
| Transport failure (RPC timeout / thrown) on `git:info`                            | NO      | `fetchGitInfo` catch/guard no-ops                                                  | see Serious issue                 |
| Wrong timeout constant in `source-control.service.ts` goes undetected by tests    | NO      | no spec file                                                                       | see Moderate issue, plan-deferred |
| push/pull/checkout/stash timeouts use the correct literal                         | YES     | spec assertions on `615_000`/`315_000`                                             | none                              |

## Revise round 1 recheck

- **Scope of recheck**: only `libs/frontend/git-ui/src/lib/services/git-status.service.ts` and `git-status.service.spec.ts` changed since the round-0 review above (confirmed via `git diff` against this file pair only). All other Batch 6 files (`git-branches.service.ts`, `git-stash.service.ts`, `source-control.service.ts` and their specs) are unchanged from round 0 and their findings stand as originally recorded.
- **Same-side review — disclosed fallback (unchanged)**: both CLI lanes remain unavailable (Ollama Cloud usage limit on Glm; antigravity quota exhausted, HTTP 429). Weaker evidence than a cross-side review.

**Finding status: RESOLVED.** The Serious issue "Transport-level `git:info` failure defeats RC3's own guarantee" (round 0, `git-status.service.ts:440-458`) is fixed.

Verified by direct read of the new code and by execution, not by the author's summary alone:

- `readFailureReason(success, error)` (`git-status.service.ts:143-159`) classifies a failed `git:info` read as `'timeout'` only when `error` starts with `'RPC timeout'`, else `'error'`. Cross-checked against the actual producer: `libs/frontend/core/src/lib/services/rpc-call.util.ts:128-132` resolves a renderer-side timeout as `{ success: false, error: `RPC timeout: ${method}` }` — the literal prefix matches exactly (`RPC timeout: git:info`), so the classification is not a guess about wording that could silently drift; a rename of that error string on the producer side would silently reclassify every renderer timeout as `'error'` instead of `'timeout'` (both are valid `GitStatusUnavailableReason` values and both still trigger stale-keep, so this is a labelling risk, not a functional regression — noted as a new Minor finding below, not Serious).
- `fetchGitInfo` (`:439-479`) now has three failure exits — `!isCurrent()` early return, the malformed-payload `else` branch, and the `catch` block — and the malformed-payload and `catch` branches both call `markReadFailed(...)`, guarded by `isCurrent()` in the `catch` branch specifically (the malformed-payload branch is already inside the `isCurrent()`-gated block). This correctly prevents a late-arriving failure for an abandoned fetch (superseded generation, or a workspace the user switched away from) from corrupting the currently-active workspace's signals — proven by the new specs "discards a failure for a workspace the user has left" and "discards a thrown failure superseded by a newer same-workspace read", both of which I traced by hand against `isCurrent`'s two-part check (`_activeWorkspacePath() === workspaceAtFetchTime && generation === this.fetchGeneration`) and found sound.
- `markReadFailed(reason)` (`:483-506`) reuses `hasLastGoodData`/`currentSnapshot`/`setSignals` — the same choke points already audited in round 0 — rather than introducing a parallel code path, so the RC3 invariants proven in round 0 (never fabricate "not a repository", never lose the original good data across repeated failures) extend to this new caller for free. Confirmed by reading the function body: it is a no-op when `!active || !hasLastGoodData(previous)`, otherwise builds `stale` via a spread of `previous` (never `EMPTY_SNAPSHOT`) with `statusUnavailable`/`staleReason` set to `reason`.
- Cache/`fetchedAt` reasoning checked directly: `markReadFailed` writes `this._workspaceGitState.set(active, { ...stale, lastUpdated: Date.now() })` with no `fetchedAt` key. `GitWorkspaceState.fetchedAt` is `fetchedAt?: number` (`:49`, unchanged), and the freshness gate in `switchWorkspace` (`:286-289`) treats a `undefined` `fetchedAt` as not fresh (`fetchedAt !== undefined && Date.now() - fetchedAt < CACHE_TTL_MS`). So a workspace whose last read failed always re-fetches on switch-back rather than serving stale-looking-fresh cached data — verified against the "does not re-trust failed-read data as fresh on switch back" spec, which asserts `git:info` is called again with the correct `workspaceRoot` after a switch away and back.
- Ran `npx nx test git-ui --skip-nx-cache` myself (not reusing the author's number): 27 suites, **443 tests pass** (up from 432 at round 0). The +11 reconciles exactly against the new `describe('when the git:info read itself fails', ...)` block: timeout, transport failure, thrown exception, three malformed-payload cases (`it.each`), no-last-good-data, clears-on-recovery, switch-back re-read, left-workspace discard, and superseded-by-newer-read discard = 11 new `it` cases, none removed. Ran `ptah_get_diagnostics` scoped to both changed files: zero diagnostics in either file (the 14 errors reported are pre-existing, in unrelated sibling files — `diff-view.component.spec.ts`, `git-dock.component.spec.ts`, `monaco-loader.service.ts`, `source-control-file.component.spec.ts`, `capability-id-codec.ts` — none touched by this batch).
- No regression found: `nextSnapshot`/`hasLastGoodData`/`setSignals`/the per-workspace isolation proven in round 0 are untouched by this diff (only `isCurrent()` was extracted as a named helper from the same two-line check, and `applyGitInfo`'s body is unchanged apart from that extraction not applying to it at all — `isCurrent` is local to `fetchGitInfo`).

**New findings from the recheck:**

- Minor: `readFailureReason`'s `'timeout'` vs `'error'` classification depends on string-matching the literal `'RPC timeout'` prefix from `rpc-call.util.ts:132`, which is not a shared constant or exported symbol — the two files agree only by convention today (`git-status.service.ts:135-141` has a comment acknowledging this: "that prefix is the only signal it gives"). If the producer's error string ever changes, every renderer-level timeout on `git:info` would silently reclassify as `'error'` rather than `'timeout'`; both still correctly trigger stale-keep (no functional regression), so this is a labelling-accuracy risk only. No test would catch a coordinated rename of the string on both sides. File: `git-status.service.ts:135-141`, `libs/frontend/core/src/lib/services/rpc-call.util.ts:132`. Recommend exporting the prefix (or a type guard) from `rpc-call.util.ts` for the reverse dependency instead of duplicating the literal, but this does not block approval.
- No other new findings. The Moderate findings from round 0 (no `source-control.service.spec.ts` regression guard for `MUTATION_RPC_TIMEOUT_MS`, dead `safeRpc` in `git-branches.service.ts`) are unchanged, since neither file was touched in this revision round.

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: MEDIUM (same-side review only — no cross-vendor CLI lane was available, per the disclosed fallback)
- **Top risk** (updated): the round-0 Serious finding is resolved; the residual top risk is now the round-0 Moderate finding that `source-control.service.ts`'s `MUTATION_RPC_TIMEOUT_MS` has no spec asserting the literal, so a future typo there would not be caught until Task 7.1 (still `PENDING`) lands.
- **What a robust implementation would add**: (1) a `source-control.service.spec.ts` (or bringing Task 7.1 forward) asserting the fourth `rpcCall` argument on all four mutations; (2) export the `'RPC timeout'` prefix from `rpc-call.util.ts` as a shared symbol so `readFailureReason`'s classification cannot silently drift from its producer.

---

# Batch 2 — Pure collaborators: write lock and porcelain v2 status parser (`TASK_2026_576_e16a`)

- **Author**: in-process subagents (`backend-developer` x2, fallback after the antigravity lanes failed on quota)
- **Reviewer**: in-process subagent (`code-logic-reviewer`)
- **Same-side review — disclosed fallback**: both CLI lanes unavailable (Glm: Ollama Cloud usage limit; antigravity: quota exhausted, HTTP 429). Weaker evidence than a cross-side review.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Verdict             | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 3        |

Scope reviewed: `libs/backend/vscode-core/src/services/git/git-write-lock.ts` (+ spec, 13 tests) and `git-status-parser.ts` (+ spec, 33 tests), both read in full. Cross-checked against batches.md Batch 2 (Tasks 2.1/2.2, R4, V9), implementation-plan.md:252-323 (Components 3-4), `libs/shared/src/lib/constants/git-operation.constants.ts`, and the parser it replaces at `git-info.service.ts:3013-3162`. Ran `npx nx test vscode-core --testFile=git-write-lock.spec.ts` (13/13 pass) and `--testFile=git-status-parser.spec.ts` (33/33 pass).

Both modules are small, pure, and well-documented, and their specs are table-driven and genuinely adversarial (reentrance, chain-poisoning, Unicode paths, malformed records, missing NUL terminators). No blocking or serious defect was found. Two moderate gaps: the write lock's AsyncLocalStorage-based reentrance guard has an undocumented interaction with unawaited (fire-and-forget) work started inside a locked body, and the retry loop does not re-check an AbortSignal during the up-to-1.6s sleep between attempts, so a cancellation can be delayed (not lost) by as much as the longest single backoff step.

## Five logic questions

### 1. How does this fail silently?

- Neither module silently converts a real failure into a success-looking result. `execWrite` (git-write-lock.ts:139-155) returns a LOCKED result only after all five retries genuinely still see `isIndexLockFailure`, and any other failure (including a rejection) is returned or thrown unmodified on the first attempt, never coerced into COMPLETED.
- `parseStatusV2Z` (git-status-parser.ts:51-121) never throws and never fabricates a value for a record it cannot parse; it increments `skippedRecords` and moves on (verified by 7 malformed-record spec cases, all counted correctly). This matches the plan's own contract ("an unparseable record is skipped and counted... it never throws"), but it does mean a caller that ignores `skippedRecords` gets a status result that silently omits real files; the parser's contract makes that the caller's choice, not a defect in this module, and `computeGitInfo` (Batch 4, not yet wired) is documented as the place that must log the count once per workspace.

### 2. What user action produces unexpected behaviour?

- A caller of `execWrite` that does not itself watch for cancellation during the retry window: if a user cancels a mutating git operation while index.lock is contested, the cancellation is not observed until the next attempt is made (see Failure modes, "Cancellation not observed during retry sleep"). Worst case the user's cancel click has no visible effect for up to 1.6s (the largest single delay) instead of being nearly instant. This is a delay, not a lost cancellation: the next `this.exec(args, cwd, options)` call still receives the same `options.signal` and, per Batch 1's `execGitBuffer`, checks `signal.aborted` before spawning.
- Two application-level bugs would trip the reentrance guard rather than deadlock: any code path that calls a second locked `GitInfoService` method from inside a locked body's synchronous call chain gets `GitReentrantLockError` thrown synchronously, not a hang. This is the intended fail-loud behaviour (R4) and is proven by the "throws GitReentrantLockError synchronously" spec.

### 3. What input data produces a wrong answer?

- None found that produces a wrong (as opposed to skipped) parse result. The field-count constants (ORDINARY_FIELDS_BEFORE_PATH = 8, RENAME_FIELDS_BEFORE_PATH = 9, UNMERGED_FIELDS_BEFORE_PATH = 10) match the documented record shapes exactly, `pathStart` correctly treats the remainder of the record as the path verbatim (so a path containing spaces, café, CJK, Arabic, a"b, a\b, and leading/trailing spaces all round-trip untouched, proven by the table-driven spec), and the type-2 handler always consumes the origPath NUL field even when the record itself is malformed, so a bad rename record can never be misread as a second top-level record (proven by the dedicated "does not read a malformed rename origPath as its own record" case).
- One latent looseness: `readXy` (git-status-parser.ts:143-148) accepts `'U'` as a valid XY character for any record type, including type 1 and type 2 records, where git never actually emits U for those types. In practice this cannot produce a wrong answer today because git never emits that combination, but it is more permissive than the format actually allows for those record types; a defensive gap rather than a logic bug (folded into Minor issues below).

### 4. What happens when a dependency fails?

- `execWrite`'s underlying `exec` (the git spawn) rejecting outright, whether from a timeout, cancellation, or any other thrown error, is not retried and propagates immediately (git-write-lock.spec.ts "does not retry a rejected spawn"); this matches the plan ("Any other outcome... is returned or thrown after the first attempt, unretried").
- A non-lock, non-zero exit is returned as COMPLETED with the original exitCode/stderr intact and is not retried (spec: "does not retry a non-lock failure"); callers (Batch 5) get the real git error text for anything other than index.lock contention, which is correct since only index.lock is transient by design here.
- `run()`'s body rejecting does not poison the FIFO chain for the repository: the tail promise always settles via `.then(noop, noop)` regardless of the body's outcome, proven by "does not let a rejected body poison the chain," including a synchronous throw inside a non-async body.

### 5. What is missing that the requirements never mentioned?

- The plan and quality requirements never address what happens to AsyncLocalStorage's captured store when a locked body kicks off async work it does not await before returning (see Failure modes below). This is not tested and not documented as a constraint on the "locked body" contract, even though the no-deadlock rule already discusses what a locked body may and may not call.
- No spec exercises cancellation mid-retry-wait for `execWrite` (options.signal becoming aborted while `sleep(delay)` is pending), see Failure modes.
- The `!`-record handling in the parser (`pushUntrackedOrIgnored`, status `'!'`) is new relative to the parser it replaces, which silently dropped `!` lines entirely (git-info.service.ts:3056-3140 has no `'! '` branch at all). `GitFileStatus['status']` already includes `'!'` in its union (rpc-git.types.ts:10), so this is not a V9 violation; V9 only forbids adding `'U'`/`'T'` in P1. Whether `!` records can even appear depends on the flags `computeGitInfo` passes to `git status`: today's call (git-info.service.ts:603) uses `--untracked-files=all` and no `--ignored`, and git only emits `!` records when `--ignored` is passed, so under today's flags this code path is currently unreachable, dead but harmless. Recommendation: keep the `!` handling as written since it is correct and forward-compatible and matches the documented record grammar, but flag to whoever wires Batch 4/computeGitInfo that passing `--ignored` is what would actually activate it, and that doing so would need a separate decision on whether ignored files should leak into the dock (out of this batch's scope).

## Failure modes

### Fire-and-forget work inside a locked body escapes both FIFO ordering and reentrance detection

- Trigger: a locked body (passed to `GitRepoWriteLock.run`) starts an async operation and does not await it before returning (for example `void someExec(...)` or an unawaited `.then()` chain), and that detached operation later itself calls `lock.run()` for the same repository, or performs a git write directly.
- Symptom: two distinct failure shapes, neither exercised by the current spec. First, if the detached chain later calls `lock.run()` for the same key, Node's AsyncLocalStorage store is propagated forward through the async resource chain that was created while the store was active, not bounded by when the outer `run()`'s returned promise settles, so the detached call can see `heldKeys.has(key) === true` and throw `GitReentrantLockError` long after the real FIFO chain (`this.tails`) has already advanced to the next queued body: a spurious reentrance error for code that is not actually nested inside the current holder. Second, if the detached work performs a git mutation directly, bypassing `lock.run`/`execWrite`, it runs concurrently with whatever body the FIFO chain admits next for that repository, silently defeating the serialization R4 exists to guarantee.
- Evidence: git-write-lock.ts:114-131 (`run`); the FIFO tail (`this.tails`) advances based on when the body's returned promise settles, while the AsyncLocalStorage store (`this.held`) is scoped to the synchronous/awaited call graph of `body()`, not to the FIFO tail's lifetime; these are two different notions of "still inside the lock" that the code treats as equivalent.
- Current handling: none; not documented beyond the general no-deadlock rule (which covers calling another locked public method synchronously, not detached async work), and not covered by any spec case (git-write-lock.spec.ts always awaits everything inside its test bodies).
- Recommendation: document explicitly, in the class doc comment and the no-deadlock rule paragraph, that a locked body must await every async operation it starts before returning; no fire-and-forget writes. Given Batch 5's consumers (GitInfoService's stage/commit/checkout/applyHunks ladder) are expected to await every spawn already, the practical risk is low, but it is an unstated invariant on a primitive whose whole purpose is serialization correctness, so it belongs in the contract, not just in reviewer notes.

### Cancellation not observed during the retry backoff sleep

- Trigger: a caller passes options.signal to `execWrite`, the first attempt hits index.lock contention, and the caller aborts the signal while `this.sleep(delay)` (git-write-lock.ts:153) is pending; the longest such window is 1,600ms, the final retry delay.
- Symptom: the abort is not acted on until the sleep completes and the next `this.exec(args, cwd, options)` call is made; only then, assuming the injected exec (Batch 1's execGit) checks `signal.aborted` before spawning as the Batch 1 review confirmed for execGitBuffer, does the operation actually reject with GitCancelledError. The user's cancellation is delayed, not lost, by up to about 1.6s beyond whatever sleep's own timer resolution adds.
- Evidence: git-write-lock.ts:139-155 (`execWrite`); the for loop's only awaited call between retries is `await this.sleep(delay)`, which takes no signal and cannot be interrupted; `unrefSleep` (:59-65) has no abort wiring either.
- Current handling: none; the plan's verification seam for execWrite (implementation-plan.md:286-290) lists serialize/poison/reentrance/retry-schedule as the fake-timer coverage and does not mention cancellation during the wait, and no spec case exercises it.
- Recommendation: acceptable as written given the bound is small (at most 1.6s, and the total retry window is itself capped at 3.1s) and git mutations are not usually cancelled mid-retry in practice, but worth a one-line note in the class doc and, ideally, a spec asserting the bound rather than leaving it implicit. Not blocking for this batch.

### None found in the parser's record-boundary handling

- Trigger: n/a.
- Symptom: n/a.
- Evidence: git-status-parser.ts:63-118 (main loop) together with `nextNul`/`pathStart`: every record boundary is NUL-delimited and computed by index, never by regex or split; the type-2 origPath field is always consumed, even when malformed, so it can never be misread as its own record; the final record without a trailing NUL is handled by `nextNul` falling back to `output.length`; an empty or separator-less record is rejected before any field-specific parsing runs. All confirmed by dedicated spec cases, including a targeted "does not read a malformed rename origPath as its own record" test.
- Current handling: correct.
- Recommendation: none, recorded to make the "no finding" scope auditable.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: `GitRepoWriteLock`'s AsyncLocalStorage-based reentrance guard and its FIFO chain use two different lifetimes for "still holding the lock" (see Failure modes, fire-and-forget). No spec exercises a locked body that starts unawaited async work. Recommend documenting the "await everything" invariant before Batch 5 wires real GitInfoService methods through `run()`.
- Moderate: `execWrite`'s retry backoff (git-write-lock.ts:153) does not accept or re-check options.signal between attempts, so cancellation during the up-to-1.6s sleep is delayed rather than immediate. Bounded and low-impact; worth a doc note or a spec asserting the bound.
- Minor: `readXy` (git-status-parser.ts:143-148) accepts `'U'` as a valid XY character for type 1 and type 2 records, not just u (unmerged) records, which is more permissive than the actual git porcelain v2 grammar allows for those record types. Harmless today since git never emits that combination for those types, but a stricter per-type character set would be more defensive.
- Minor: the retry-count wording across documents is inconsistent, but this is not a code defect. git-operation.constants.ts:25 says "five retries, 3,100 ms in total" and implementation-plan.md:1616 says "index.lock retry of 5 attempts, 3.1 s total." The code implements 5 retries after 1 initial attempt (6 total spawns, matching GIT_INDEX_LOCK_RETRY_DELAYS_MS.length + 1 in the spec), which is exactly what the authoritative constants file, already reviewed and approved in Batch 1, specifies. The plan's "5 attempts" phrasing at line 1616 is loose terminology in the plan document, not a discrepancy in this batch's implementation.

## Data flow

### GitRepoWriteLock

1. `run(workspacePath, body)` folds the path via `repoKey` (case-insensitive, separator-normalized) and checks AsyncLocalStorage.getStore() for the folded key: OK, the synchronous reentrance check happens before any promise is created.
2. If not reentrant, `bodyKeys` is derived from the current store, supporting nested different-repo calls, and the new body is chained onto `this.tails.get(key)`: OK, proven to serialize same-repo calls and run different-repo calls concurrently.
3. The chain's tail is recorded via `.then(noop, noop)` so a rejection never propagates into the chain itself: OK, proven by the poison-chain spec.
4. Map cleanup deletes the tails entry once the tail it wrote is still the current one: OK, bounded memory, no leak across many sequential calls to the same repo.
5. `execWrite(args, cwd, options)` spawns via the injected exec, checks `isIndexLockFailure(result.stderr)` only on a non-zero exit, and either returns COMPLETED immediately or waits GIT_INDEX_LOCK_RETRY_DELAYS_MS[attempt] before retrying: OK for the happy and index-lock paths; gap noted above for signal responsiveness during the wait.
6. After all delays are exhausted, LOCKED is returned with only GIT_LOCKED_MESSAGE, never stderr: OK, proven by `JSON.stringify(result)).not.toContain('index.lock')`.

### parseStatusV2Z

1. Header records (# branch.*) are matched by prefix and update branch in place; unrecognised # headers, for example # branch.oid or # stash N, are accepted without being counted as skipped: OK, matches the plan's forward-compatibility intent.
2. Type 1/2 records: readXy validates the XY field, pathStart locates the path by counting exactly the fixed number of leading spaces, and the remainder of the record is taken verbatim as the path with no trim and no split: OK, proven across Unicode and special-character fixtures.
3. Type 2's extra NUL field (origPath) is always consumed via nextNul, even for a malformed record, so a subsequent record is never misaligned: OK, proven by a dedicated spec.
4. u records collapse to one unstaged M entry per V9's P1 scope: OK, matches the plan's explicit "P1 subset" instruction.
5. ?/! records strip a trailing path separator to flag directories and reject an empty path: OK; whether ! records ever actually appear depends on flags this batch does not control, see Q5 above.
6. Every unrecognised or malformed record increments skippedRecords and the loop continues: OK, proven by 7 distinct malformed-input spec cases plus the "does not read a malformed rename origPath as its own record" case.

## Requirements fulfilment

| Requirement                                                                                                             | Status   | Gap                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Task 2.1: FIFO per normalized repo path                                                                                 | COMPLETE | none                                                                                           |
| Task 2.1: AsyncLocalStorage reentrance leads to synchronous GitReentrantLockError                                       | COMPLETE | interaction with unawaited async work inside a body is undocumented and untested (Moderate)    |
| Task 2.1: rejected body never poisons the chain                                                                         | COMPLETE | none                                                                                           |
| Task 2.1: execWrite retries only index.lock, per GIT_INDEX_LOCK_RETRY_DELAYS_MS, LOCKED carries only GIT_LOCKED_MESSAGE | COMPLETE | none                                                                                           |
| Task 2.1: injectable clock/sleep, retry sleep unref'd, no timers left after settle                                      | COMPLETE | jest.getTimerCount() === 0 asserted after both LOCKED and retry-then-success paths             |
| Task 2.2: parseStatusV2Z over headers/type1/type2/u/?/! per plan grammar                                                | COMPLETE | none                                                                                           |
| Task 2.2: no trimming, O(n), no per-line regex, never throws                                                            | COMPLETE | none observed; no regex used anywhere in the module                                            |
| Task 2.2: unparseable records skipped and counted                                                                       | COMPLETE | none                                                                                           |
| Task 2.2 (V9): u records and T map to today's M/existing status values in P1                                            | COMPLETE | proven by "unmerged row maps to unstaged M (V9)" and "type change T maps to M (V9)" spec cases |
| Table-driven spec covering café/CJK/Arabic/a"b/a\b/leading-trailing space/rename/unmerged                               | COMPLETE | all present in git-status-parser.spec.ts                                                       |

Implicit requirements not addressed: documenting the "await everything" invariant for locked bodies; a spec bounding cancellation latency during the retry sleep.

## Edge cases

| Case                                                                             | Handled                                              | How                                                                               | Concern                                                                                                                            |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Two concurrent run calls for the same repo serialize in call order               | YES                                                  | spec "runs two concurrent bodies... one after another"                            | none                                                                                                                               |
| Case/separator/trailing-slash folding treats paths as the same repo              | YES                                                  | spec "folds case, separators and trailing slashes into one queue"                 | documented tradeoff: two case-distinct repos on a case-sensitive FS share a queue, needless serialization only, never a missed one |
| Different repos run concurrently                                                 | YES                                                  | spec "runs bodies for different repositories concurrently"                        | none                                                                                                                               |
| Rejected body does not poison the chain, including a synchronous throw           | YES                                                  | spec "does not let a rejected body poison the chain"                              | none                                                                                                                               |
| Reentrant run on the same repo throws synchronously                              | YES                                                  | spec "throws GitReentrantLockError synchronously..."                              | none                                                                                                                               |
| Nested run for a different repo is allowed                                       | YES                                                  | spec "allows a nested run for a different repository"                             | none                                                                                                                               |
| A queued (not nested) caller outside any body is not treated as reentrant        | YES                                                  | spec "does not treat a queued caller outside any body as reentrant"               | none                                                                                                                               |
| execWrite retries only on index.lock, per the documented schedule                | YES                                                  | spec "retries an index.lock failure on the configured schedule and then succeeds" | none                                                                                                                               |
| Persistent lock returns LOCKED with no stderr                                    | YES                                                  | spec "returns LOCKED with the fixed message and no stderr..."                     | none                                                                                                                               |
| Non-lock failure and rejected spawn are never retried                            | YES                                                  | two dedicated specs                                                               | none                                                                                                                               |
| Fire-and-forget async work inside a locked body                                  | NO                                                   | not addressed by code or spec                                                     | see Moderate finding above                                                                                                         |
| Cancellation during the retry backoff sleep                                      | NO                                                   | not addressed by code or spec                                                     | see Moderate finding above                                                                                                         |
| Unparseable status record: skipped and counted, never throws                     | YES                                                  | 7 malformed-record spec cases plus full-flow spec                                 | none                                                                                                                               |
| Paths with café/CJK/Arabic/a"b/a\b/leading-trailing space; staged rename discard | YES                                                  | table-driven spec, each as its own case                                           | none                                                                                                                               |
| !-record (ignored file) parsing                                                  | YES (parser); reachability depends on unbuilt caller | pushUntrackedOrIgnored handles it correctly                                       | currently unreachable given today's --untracked-files=all without --ignored at the unbuilt call site, see Q5                       |

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: MEDIUM (same-side review only, no cross-vendor CLI lane was available, per the disclosed fallback)
- **Top risk**: the AsyncLocalStorage reentrance guard's lifetime does not match the FIFO chain's lifetime once a locked body leaves async work unawaited. This is not a defect observed in this batch's own code, since its bodies in the specs always await, but it is an unstated invariant on a primitive whose only job is correctness under concurrency, and Batch 5 is about to wire real, more complex bodies (the applyHunks ladder) through it.
- **What a robust implementation would add**: (1) a doc-comment sentence on GitRepoWriteLock.run stating that a body must await every async operation before returning; (2) a spec that starts an unawaited async chain inside a body and asserts it does not falsely trip GitReentrantLockError for an unrelated later call, or alternatively asserts that it should trip it, making the current behaviour a documented, tested choice rather than an accident; (3) a spec bounding cancellation latency during execWrite's retry sleep.

---

# Batch 3 — Electron git watcher redesign (RC5) (`TASK_2026_576_e16a`)

- **Author**: in-process subagent (`backend-developer`)
- **Reviewer**: in-process subagent (`code-logic-reviewer`)
- **Same-side review — disclosed fallback**: the cross-side antigravity review attempt failed (quota exhausted, HTTP 429, reset ~31 min); Glm unavailable (Ollama Cloud usage limit). Weaker evidence than a cross-side review.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Verdict             | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 3        |

Scope reviewed: `apps/ptah-electron/src/services/git-watcher.service.ts` (+ `.spec.ts`, modified), `apps/ptah-electron/src/services/git-dir-change-classifier.ts` (+ `.spec.ts`, new), and `apps/ptah-electron/src/services/git-watcher.real-git.spec.ts` (new). All three source/spec pairs read in full. Cross-checked against batches.md Batch 3 / Task 3.1, implementation-plan.md:380-424 (Component 6), task-description.md Requirement 1.7 (RC5), and `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts` (the `IWorkspaceWatcher` contract the batch consumes, read in full to verify the exclusion-glob semantics and the overflow/degradation guarantees the batch relies on). Ran the batch's own scoped tests directly rather than trusting the executor's numbers: `npx jest -c apps/ptah-electron/jest.config.ts git-dir-change-classifier.spec.ts git-watcher.service.spec.ts` — 2 suites, 109/109 pass; `npx jest -c apps/ptah-electron/jest.config.ts git-watcher.real-git.spec.ts --runInBand` — 1 suite, 6/6 pass (33.8 s, real git binary and the real in-process `@parcel/watcher` host, on Windows). Confirmed `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` (R3's regression gate) has no uncommitted changes (`git status --porcelain` empty for that path).

The redesign replaces per-file `fs.watch` handles with one recursive `IWorkspaceWatcher` subscription rooted at the common git directory, routed through a new pure classifier (`classifyGitDirChange`). The architecture matches the plan closely: anchored exclude globs instead of `excludeDirNames` (correctly reasoned — a directory-name rule would hide a branch literally named `feature/logs` or `hooks`), one subscription released in `stop()`, no per-file timers, no poll, and the constructor signature is untouched. The four executor-declared deviations are each defensible and, for the ones capable of empirical proof, the real-git spec actually proves them rather than just asserting them by table. The one real gap is that the real-git spec's own acceptance list (HEAD, index, nested ref, packed-refs, MERGE_HEAD, linked-worktree commit) does not include a plain `HEAD` lock-and-rename (a branch checkout) — every `'head'`-cause test exercises `MERGE_HEAD` or a pseudo-ref, not `HEAD` itself, so the single most common git operation's own rename path is verified by classifier symmetry and code reading, not by the real-engine assertion the spec exists to provide for the file-list Requirement 1.7 names first.

## Five logic questions

### 1. How does this fail silently?

- `subscribeGitDir` (`git-watcher.service.ts:578-603`): a synchronous throw from `workspaceWatcher.watch(...)` is caught, warned, and leaves `gitDirSubscription` at `null` — the service then relies entirely on the workspace-root feed and explicit RPC reads for that workspace's whole lifetime, with no retry and no user-visible indicator beyond a log line. This is the documented degradation path (batches.md Task 3.1 validation note, "subscription failure → warn + existing degradation"), so it is not a hidden defect, but it is worth naming as the one failure mode in this batch that produces no telemetry a user or support engineer can see without log access.
- `resolveGitDirs` (`:423-447`): a `commondir` file that exists but resolves to a path that does not (yet) exist (`fs.existsSync(resolved)` false, e.g. a worktree mid-creation) silently falls back to `commonDir = ownGitDir` with no warning at all — only a genuine read error that is not `ENOENT` is logged. This under-covers shared refs for exactly the race window `git worktree add` creates, though it self-heals once the directory appears and `resolveGitDirs` re-runs on the next `start()`/`switchWorkspace()`.

### 2. What user action produces unexpected behaviour?

- A user runs `git worktree lock <this-worktree>` on the worktree Ptah is currently watching (not another one): `classifyGitDirChange` returns `null` for `worktrees/<own>/locked` and every other own-admin file (`commondir`, `gitdir`) because the own-branch check short-circuits before falling through to the common-dir "another worktree's administration" classification (`git-dir-change-classifier.ts:61-67`, proven by the spec's own-worktree `'commondir'/'gitdir'/'locked' → null` cases). This is consistent with Requirement 1.7, which never asks for a self-lock notification, so it is a scope observation rather than a defect.
- A user (or the agent's Bash) runs a plain `git checkout <branch>` in a terminal outside Ptah: this is the one Requirement-1.7-named operation (external HEAD change) the real-git spec never directly asserts — see Failure modes below.

### 3. What input data produces a wrong answer?

- None found in the classifier's own path-matching logic. The Windows drive-letter/UNC case-folding (`toKey`, `git-dir-change-classifier.ts:106-115`) and the offset-based segment split that preserves original spelling (`relativeSegments:122-136`) are each proven by dedicated specs (`d:\Work\Repo...` vs `D:/work/repo...`, `/Repo/.git/HEAD` staying case-sensitive on POSIX, `.git/../HEAD` rejected via the `..` segment check). Traced by hand against the table in `git-dir-change-classifier.spec.ts:21-101` and found consistent with the documented grammar (implementation-plan.md:399-404) in every row, including the two rows that are easy to get backwards: `refs/heads/stash` (a branch literally named `stash`) stays `'refs'`, and only bare `refs/stash` is `'refs-stash'`.
- One genuine looseness, not exercised by any spec: `classifyOwn` (`:70-81`) treats `REBASE_DIRS.has(top)` as a `'head'` match at any `segments.length`, including `segments.length > 2` (e.g. a hypothetical `rebase-merge/patch/0001` two levels deep) — harmless today since git's own rebase-state directory is never nested that deep, but the check is not bounded to `segments.length <= 2` the way the `refs`/`packed-refs` handling is bounded per record shape elsewhere in this task's other batches (Batch 2's status parser). Not a defect; flagged only because it is the one unbounded-depth branch in an otherwise depth-aware classifier.

### 4. What happens when a dependency fails?

- A native watch-engine failure _after_ a successful `watch()` call (not a synchronous throw) is the interface's own documented contract: `IWorkspaceWatcher` guarantees "an adapter failure surfaces as one `overflow` batch, followed by resubscription" (`workspace-watcher.interface.ts:158-162`). `onGitDirBatch` (`git-watcher.service.ts:614-644`) handles this correctly — `batch.overflow || batch.truncated` schedules all three causes plus one worktree re-list, proven by the "an overflow schedules one refresh with head, index and refs, and one worktree re-list" spec. This is the correct place for that handling; the try/catch around `watch()` itself only needs to cover the synchronous-construction-failure case, which it does.
- `git worktree list` (`gitInfo.getWorktrees`) failing inside `refreshNestedRepoRoots` is pre-existing code, unchanged by this diff, and out of this batch's scope; not re-reviewed here beyond confirming the diff does not touch it.

### 5. What is missing that the requirements never mentioned?

- Submodule state: excluding `modules/**` (this batch's own exclusion) compounds a pre-existing limitation rather than introducing a new one — `subscribeWorkspace`'s `nestedRepoDetection: true` (unchanged by this diff, `:538-569`) already treats any `.git` entry below the workspace root, including a submodule's own `.git` file, as a nested repository root and excludes it from the workspace feed for the life of the subscription. So an external `git checkout <sha>` run inside a submodule's own working tree was already invisible to the watcher before this batch; `modules/**` only prevents the superproject's own mirror of that state (`.git/modules/<name>/HEAD`) from leaking a _second_ silent gap through the new git-dir subscription. Requirement 1.7 does not name submodules, so this is not a requirements-fulfilment gap, but it is worth recording since the batch's own doc comment (`git-watcher.service.ts:105-114`) justifies `modules/**` only as "large or write-heavy," not as "already unreachable by design" — the stronger, correct justification.
- The real-git spec (Requirement 1.7's own verification seam) does not assert a `'head'` push for a plain branch checkout or `git symbolic-ref HEAD <ref>` — the two ordinary ways `HEAD` itself (not `MERGE_HEAD` or another pseudo-ref) changes via git's lock-and-rename. See Failure modes.

## Failure modes

### `HEAD`'s own lock-and-rename path is unverified by the real-engine spec

- Trigger: an external process runs `git checkout <branch>` (or any command that rewrites the `HEAD` symref via `HEAD.lock` → rename), which is explicitly one of Requirement 1.7's named examples ("a terminal `git add`, `git commit`, `git fetch`... HEAD, the index, a nested ref... packed-refs, MERGE_HEAD").
- Symptom: none observed — the classifier's `HEAD_FILES` set (`git-dir-change-classifier.ts:31-39`) includes `'HEAD'` and the pure-function spec proves `'HEAD' → 'head'` for a literal path. The gap is evidentiary, not behavioural: nothing in `git-watcher.real-git.spec.ts` performs a `git checkout` and asserts a `'head'`-cause push, so the one deviation this task most wants proven at the engine level — "does `**/*.lock` excluded still let the final-name rename fire an event on every OS" — is proven empirically for `index` (`git add`, test "git add pushes an index change") and for `refs` (`git commit`, `git branch`, `git pack-refs --all`), but for `'head'` the only real-engine assertion uses `MERGE_HEAD` creation via `git merge --no-ff --no-commit`, a different file written by a different code path than the `HEAD` symref update a checkout performs.
- Evidence: `apps/ptah-electron/src/services/git-watcher.real-git.spec.ts:279-292` (`MERGE_HEAD` test, the only `'head'`-cause case) vs. the classifier's `HEAD` handling at `git-dir-change-classifier.ts:31-39` (untested at the engine level) and implementation-plan.md:425 (the spec is supposed to run "a real `git add`, `git commit`, a nested ref write, a `packed-refs` rewrite, `MERGE_HEAD` creation and a linked-worktree commit" — this list, taken verbatim, indeed omits a plain checkout, so the executor implemented the plan's own test list exactly; the gap is in the plan's list, not a shortfall against it).
- Current handling: none; not a code defect, a verification-coverage gap inherited from the plan's own enumerated spec list.
- Recommendation: add one real-git case — `git checkout -b other && git checkout main` (or `git symbolic-ref HEAD refs/heads/other`) — asserting a `'head'`-cause push within 3 s, closing the one Requirement-1.7-named case the current suite does not exercise at the real-engine level. Given the mechanism (rename reports the final name) already holds for `index` and `refs` and `HEAD` is handled identically by the classifier, this is very likely to pass; it should still be added before this is the last word on RC5's cross-OS behaviour, since the whole point of a real-git spec here is not to trust that inference.

### Commondir race during worktree creation is silently absorbed, not logged

- Trigger: `resolveGitDirs` runs while `git worktree add` is still writing the new worktree's gitdir (the `commondir` file exists and names a target directory that, for a brief window, does not yet fully exist per `fs.existsSync`).
- Symptom: `commonDir` silently falls back to `ownGitDir` for that arm; shared refs (branches, tags, other worktrees) are not watched until the next `start()`/`switchWorkspace()` re-resolves it. No warning is logged for this specific case, unlike every other failure branch in the same function.
- Evidence: `git-watcher.service.ts:423-447`, specifically the `if (fs.existsSync(resolved)) commonDir = canonicalPath(resolved);` line with no `else` branch, contrasted with the `isMissingFileError` guard immediately below it that does warn on other read failures.
- Current handling: none beyond the existing-repo-open-tomorrow self-heal (the next arm resolves correctly once the race has passed).
- Recommendation: low priority — this is a narrow timing window (watching a workspace exactly as its own worktree is being created is not the common case Requirement 1.7 targets), but a one-line debug log here would make the degraded window visible instead of indistinguishable from "no `commondir` file, ordinary repository."

### None found in the overflow, disposal or generation-guard lifecycle

- Trigger: n/a.
- Symptom: n/a.
- Evidence: `onGitDirBatch`/`onWorkspaceBatch` both gate on `generation !== this.armGeneration` before acting (`:619`, `:678`), and `start()` calls `stop()` synchronously first, which increments `armGeneration` and clears every timer and the `pendingCauses` set before `subscribeGitDir` is ever called — there is no `await` between `stop()`'s teardown and the new subscription's creation inside `start()`, so no batch from a torn-down generation can be delivered between the old subscription's disposal and the new one's creation (`start:334-375`, `stop:483-523`). `stop()` releases both subscriptions (`workspaceSubscription` and the new `gitDirSubscription`) unconditionally, satisfying the "one subscription per armed workspace, released in stop()" requirement. The `IWorkspaceWatcher` contract itself guarantees `dispose()` is idempotent and that the listener is never called again after it, so a subscription created just before an immediate `stop()` cannot leak a stray callback even though `watch()`'s native subscribe is documented to complete asynchronously after `watch()` returns (per the real-git spec's own `waitUntilLive` comment) — the disposal races this raises are the interface's problem to solve once, not this batch's, and it inherits the same pattern the pre-existing `workspaceSubscription` already used.
- Current handling: correct.
- Recommendation: none, recorded to make the "no finding" scope auditable rather than omit a lifecycle category from a batch whose own quality requirements name it explicitly.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: the real-git spec (`git-watcher.real-git.spec.ts`) never exercises a plain `HEAD` lock-and-rename (a branch checkout), the one Requirement-1.7-named case whose real-engine behaviour is inferred from `index`/`refs` rather than directly proven; see Failure modes.
- Moderate: `resolveGitDirs`'s `commondir`-target-not-yet-existing branch degrades silently with no log line, unlike its sibling failure branches in the same function; see Failure modes.
- Minor: `classifyOwn`'s `REBASE_DIRS` check (`git-dir-change-classifier.ts:73`) matches at any depth under `rebase-merge`/`rebase-apply` rather than bounding it the way `refs` handling is depth-aware elsewhere; harmless today, noted for consistency only.
- Minor: the doc comment justifying `modules/**` (`git-watcher.service.ts:105-114`) cites size/write-volume only; the stronger reason — `nestedRepoDetection` already excludes a submodule's own worktree, so its mirrored state under `modules/**` was already unreachable by design — is not stated, which could mislead a future reader into thinking `modules/**` is the sole barrier to submodule visibility.

## Data flow

1. `start(workspacePath, broadcast)` calls `stop()` first (bumping `armGeneration`, clearing every timer and both subscriptions), then arms the workspace-root subscription unconditionally and, if a gitdir resolves, `resolveGitDirs` then `subscribeGitDir` — OK, matches "one subscription per armed workspace."
2. `resolveGitDirs` reads `<gitdir>/commondir`, canonicalising both `ownGitDir` and (when present and existing) `commonDir` via `realpathSync.native` — OK for the steady state; the narrow existence-race noted above degrades silently rather than failing loudly.
3. `subscribeGitDir` opens one recursive `IWorkspaceWatcher.watch` on `commonDir` with the anchored exclude globs, `excludeDirNames: []`, `nestedRepoDetection: false` — OK; a synchronous construction failure is caught, warned, and leaves the service on the workspace-feed-only degradation path.
4. Each batch reaches `onGitDirBatch`, generation-gated — OK. A complete batch classifies every changed path via the pure `classifyGitDirChange`, coalesces distinct kinds into a `Set`, and schedules one `scheduleGitOpsRefresh` per distinct kind plus at most one worktree re-list — OK, proven by the "one refresh carrying each cause" spec. An incomplete batch (`overflow`/`truncated`) schedules all three causes plus one re-list — OK, proven by its own spec and matching the plan's overflow contract, with the worktree re-list an executor-declared, spec-proven addition beyond the plan's literal wording.
5. `scheduleGitOpsRefresh`/`fetchAndPush` (unchanged by this diff, pre-existing debounce/burst-ceiling logic) drain `pendingCauses` and broadcast `git:status-update` — OK, not re-audited here beyond confirming the diff does not touch this path's internals.
6. `stop()` disposes both subscriptions unconditionally and clears every timer and pending set — OK, proven by the lifecycle specs and consistent with the pre-existing `workspaceSubscription` teardown this batch generalises via the new shared `disposeSubscription` helper.

## Requirements fulfilment

| Requirement                                                                                             | Status   | Gap                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One recursive `IWorkspaceWatcher` subscription on the common git dir, replacing `fs.watch` handles      | COMPLETE | none — all `watchFile`/`watchDirectory` machinery removed                                                                                                                                  |
| Pure `classifyGitDirChange(absPath, ownGitDir, commonDir)` per the plan's grammar                       | COMPLETE | none — table-driven spec matches implementation-plan.md:399-404 row for row                                                                                                                |
| `'worktree-admin'` → `scheduleNestedRootsRefresh()`                                                     | COMPLETE | none                                                                                                                                                                                       |
| Overflow → one refresh with causes `['head','index','refs']`                                            | COMPLETE | executor added one worktree re-list beyond the plan's literal wording; spec-proven and defensible (overflow can hide worktree-admin changes too), noted as a declared deviation, not a gap |
| Subscription failure → warn + existing degradation                                                      | COMPLETE | synchronous construction failure warns and falls back; runtime failure surfaces via the port's own `overflow` contract                                                                     |
| One subscription per armed workspace, released in `stop()`                                              | COMPLETE | none                                                                                                                                                                                       |
| No per-file timers, no poll                                                                             | COMPLETE | none — `GIT_DIR_BATCH_INTERVAL_MS` is one interval on one subscription                                                                                                                     |
| Constructor signature unchanged                                                                         | COMPLETE | none — `constructor(gitInfo, logger, workspaceWatcher)` identical                                                                                                                          |
| `apps/ptah-electron-e2e/.../git-watcher.spec.ts` passes unchanged (R3)                                  | COMPLETE | file has no uncommitted changes; not independently re-run in this review (out of the batch's own scoped verification command)                                                              |
| Real-git spec proves Requirement 1.7: HEAD, index, nested ref, packed-refs, MERGE_HEAD, linked-worktree | PARTIAL  | HEAD itself (as opposed to `MERGE_HEAD`) is not exercised via a real checkout/lock-rename; every other named case is proven                                                                |

Implicit requirements not addressed: none beyond the HEAD-checkout spec gap above.

## Edge cases

| Case                                                                        | Handled | How                                                                                       | Concern                                                                           |
| --------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `index.lock` → `index` rename reported as the target name                   | YES     | real-git "git add pushes an index change" test, real engine, real git                     | none                                                                              |
| `refs/heads/x.lock` → `x` / `packed-refs.lock` → `packed-refs`              | YES     | real-git "git commit"/"branch"/"pack-refs" tests, real engine                             | none                                                                              |
| `HEAD.lock` → `HEAD` rename (branch checkout)                               | NO      | classifier proves `'HEAD' → 'head'` in isolation only                                     | see Moderate finding                                                              |
| Files absent at watcher start (`MERGE_HEAD`, `packed-refs`, nested ref)     | YES     | real-git tests create each file after `waitUntilLive`                                     | none                                                                              |
| Linked-worktree common dir, own gitdir under `worktrees/<name>`             | YES     | real-git test adds a worktree, resolves `commondir`, watches through the common dir       | none                                                                              |
| Overflow/truncated batch                                                    | YES     | one refresh with all three causes plus one worktree re-list, both spec-proven             | none                                                                              |
| Subscription construction failure (sync throw)                              | YES     | caught, warned, `gitDirSubscription` stays null, workspace feed still degrades gracefully | none                                                                              |
| Native failure after successful subscribe (async)                           | YES     | handled generically by the `overflow` contract the port itself guarantees                 | none                                                                              |
| `commondir` target not yet existing (creation race)                         | PARTIAL | falls back to `ownGitDir` silently, self-heals on next arm                                | see Moderate finding (no log line for this branch)                                |
| Windows path separators and drive-letter case                               | YES     | dedicated spec cases for backslash/forward-slash and drive-letter case folding            | none                                                                              |
| Submodule internal commit change (external `git checkout` inside submodule) | NO      | excluded by pre-existing `nestedRepoDetection` and reinforced by `modules/**`             | pre-existing limitation, not a Requirement 1.7 case, doc comment could be clearer |

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: MEDIUM (same-side review only — the cross-side antigravity attempt failed on quota, Glm was unavailable; per the disclosed fallback)
- **Top risk**: Requirement 1.7's own verification seam (the real-git spec) does not directly prove the `HEAD` lock-and-rename case for a plain checkout — the single most common external git operation — even though it proves the mechanism for `index`, `refs` and `packed-refs`. The classifier logic itself is correct and symmetric; the gap is purely in what the new real-engine spec chose to assert, inherited verbatim from the plan's own enumerated test list.
- **What a robust implementation would add**: (1) one more real-git case asserting a `'head'`-cause push from a plain branch checkout, closing the last Requirement-1.7-named scenario the suite infers rather than proves; (2) a debug-level log line when `resolveGitDirs` falls back to `ownGitDir` because the `commondir` target does not yet exist, so that degraded window is distinguishable from an ordinary non-linked repository in the logs; (3) correcting the `modules/**` doc comment to state the stronger reason (submodules are already excluded by `nestedRepoDetection`) rather than only the weaker one (write volume).

## Round 2 recheck

**Same-side review — disclosed fallback (unchanged)**: the cross-side antigravity review attempt failed (quota exhausted, HTTP 429, reset ~31 min at round-0 time); Glm remained unavailable (Ollama Cloud usage limit). Weaker evidence than a cross-side review.

**Scope of recheck**: only the three files the team-leader's round-1 revision authorized — `git-watcher.real-git.spec.ts`, `git-watcher.service.ts`, `git-watcher.service.spec.ts` — confirmed via `git status --porcelain` / `git diff` limited to those paths; `git-dir-change-classifier.ts` and its spec are untouched since round 0. Ran the batch's three spec files directly rather than trusting the executor's numbers: `npx jest -c apps/ptah-electron/jest.config.ts --runInBand git-watcher.real-git.spec.ts git-watcher.service.spec.ts git-dir-change-classifier.spec.ts` — 3 suites, 119/119 pass. Ran the real-git suite two additional times in isolation to check for flakiness (`--runInBand`, no other flags): 9/9 pass both times (40.2 s, 50.5 s), no order-dependence or timing failures across three consecutive runs on Windows. Also ran `npx nx run-many -t typecheck,lint -p ptah-electron`: both pass (lint served from cache, typecheck fresh).

### Item-by-item verification

1. **Repeated HEAD writes (lock-and-rename each time) each push a head change** — VERIFIED. `git-watcher.real-git.spec.ts:274-284`: `git symbolic-ref HEAD refs/heads/feature/deep/x` (writes only `HEAD` through `HEAD.lock` and rename) asserted to push `'head'`, then a second `git symbolic-ref HEAD refs/heads/main` asserted to push `'head'` again — proving the subscription survives the first lock-and-rename and still reports the second, which is exactly the "repeated writes after git's lock-and-rename" clause task-description.md:198 names. Ends with `expect(git(['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/main')`, restoring state for later tests. Read the assertion by hand against `expectPush`'s implementation (`:198-216`) — it genuinely waits for a fresh push after the operation runs, not a pre-existing one, so this is not a false positive from an earlier test's residual push.
2. **A branch switch pushes a head change** — VERIFIED. `:286-299`: `git checkout -q feature/deep/x` asserted to push `'head'`, confirmed by reading `HEAD` back via `symbolic-ref`, then `git checkout -q main` asserted to push `'head'` again, with a `finally` block that re-checks-out `main` even if an assertion throws mid-test — the exact defensive cleanup the round-1 requirement implied ("switch back to main") plus one layer of extra safety the requirement did not explicitly ask for. Checkout is the most common real-world case Requirement 1.7 names first (task-description.md:192-198, "an external process changes HEAD... a terminal `git add`, `git commit`..."); this closes the round-0 top risk directly with a real `git checkout`, not an inferred-by-analogy case.
3. **A remote-tracking ref created after start pushes a refs change** — VERIFIED. `:301-309`: asserts `refs/remotes` does not exist yet, runs `git update-ref refs/remotes/origin/x HEAD`, asserts a `'refs'` push, then confirms the file now exists on disk. This matches task-description.md:193's explicit `refs/remotes/origin/x` example and the "files that did not exist when the watcher started" clause, closing the one requirement-named path (`refs/remotes/...`) that was previously proven only by the classifier's pure-function table (`git-dir-change-classifier.spec.ts:39`), not by the real engine.
4. **`resolveGitDirs` commondir-missing-target: one warning, plus a unit case** — VERIFIED, and it exceeds what was asked. Code: `git-watcher.service.ts:434-448` now logs `'[GitWatcher] commondir target is missing; watching the worktree own git dir instead'` with `{ commondirFile, commonDir: resolved, ownGitDir }` inside the `if (target.length > 0)` branch's new `else`, only when `fs.existsSync(resolved)` is false — the branch that round 0 flagged as silently degrading. Spec: `git-watcher.service.spec.ts` new case "a commondir naming a missing directory falls back to the own gitdir and says so once" (in the block following line 908) creates a worktree gitdir whose `commondir` names a directory that was never created, arms the watcher, asserts the subscription root is the _own_ gitdir (fallback confirmed structurally, not just by log inspection), filters `logger.warn` calls to exactly one matching the new message prefix, asserts the logged payload's `commonDir`/`ownGitDir` fields, and then fires a `HEAD` change against the fallback root and asserts it still produces a `'head'`-cause push — proving the degraded watcher is still functionally live, not just that a log line fired. This is a stronger test than the round-1 instruction required ("cover it... otherwise the log line alone").
5. **`modules/**` doc-comment correction** — VERIFIED. `git-watcher.service.ts:105-117`: the comment now leads with "`modules/` holds each submodule's own git directory. A submodule's working tree is a nested repository, which the workspace subscription already excludes through `nestedRepoDetection`; its git directory is excluded here for the same reason, so the submodule's own commits, fetches and gc — another repository's activity — do not drive refreshes of this one. What the superproject records about a submodule (its gitlink) changes in this repository's own index and refs, which stay watched." This states the primary reason (pre-existing `nestedRepoDetection` exclusion) ahead of the secondary one (size/write-volume, kept for the other six excluded directories), matching the round-0 finding's own recommended fix almost verbatim, and adds the previously-missing clarification that gitlink changes are still visible through the repository's own index/refs.

### New findings from the recheck

None that rise above Minor. Reviewed the full diff of all three changed files (not only the five required hunks) for regressions:

- The refactor from `workspaceWatcher.__state.subscriptions`/`.live()` to the new `workspaceSubs()`/`gitDirSubs()`/`liveWorkspaceSubs()`/`liveGitDirSubs()` helpers (`git-watcher.service.spec.ts:111-129`) is a mechanical, correct generalization now that the fake port carries two concurrently-live subscription families per workspace (`nestedRepoDetection: true` for the workspace root, `false` for the git directory) — every pre-existing assertion that used to read `__state.subscriptions`/`.live()` directly was migrated to filter by kind, and I traced three of the migrated assertions (worktree resubscribe count, live-subscription count after a failed listing, live-subscription count after a stale listing is dropped) against their pre-round-2 counterparts and found the filtered counts equivalent to what the unfiltered counts meant before the git-directory subscription existed — no assertion silently weakened.
- Minor (unchanged from round 0, not touched by round 2, still standing): `classifyOwn`'s `REBASE_DIRS` depth looseness — carried to Batch 14 per batches.md's own round-1 disposition, not this batch's responsibility to fix.
- Minor, new observation: the "a branch switch pushes a head change" test's `finally` block re-runs `git checkout -q main` unconditionally, including on the success path where the `try` block already checked out `main` as its last statement (`:294`) — a harmless no-op double-checkout, not a defect, noted only because it is slightly redundant with the try block's own last line.
- No regression found in the previously-passing 8 real-git cases, all 109 non-real-git unit tests, or the classifier's own 41 table rows — all still pass unmodified, and the classifier file itself has zero diff since round 0.

### Requirements fulfilment update

| Requirement (round-1 gap)                                               | Round-0 status            | Round-2 status | Evidence        |
| ----------------------------------------------------------------------- | ------------------------- | -------------- | --------------- |
| Real-git proof of `HEAD`'s own lock-and-rename (not just `MERGE_HEAD`)  | PARTIAL                   | COMPLETE       | Items 1-2 above |
| Real-git proof of `refs/remotes/origin/x` created after start           | PARTIAL (classifier-only) | COMPLETE       | Item 3 above    |
| `resolveGitDirs` commondir-missing-target degrades loudly, not silently | Moderate gap              | COMPLETE       | Item 4 above    |
| `modules/**` doc comment states the primary (correct) reason            | Minor gap                 | COMPLETE       | Item 5 above    |

Every gap the round-1 team-leader decision named is now closed with evidence read directly from the code and specs, not from the executor's summary. No new Requirement 1.7 gap was found while re-reading the full three-file diff.

### Updated verdict

- **Score**: 9/10 (was 8/10 at round 0)
- **Recommendation**: APPROVE
- **Confidence**: MEDIUM (same-side review only — no cross-vendor CLI lane was available at either round, per the disclosed fallback; this affects independence of judgment, not the strength of the direct code/spec/test evidence above)
- **Blocking issues**: 0. **Serious issues**: 0. **Moderate issues**: 0 (both round-0 moderates — the HEAD real-git gap and the silent commondir fallback — are resolved; the minor doc-comment finding is also resolved).
- **Top risk (updated)**: none rises to a reviewable risk against Requirement 1.7 for this batch's own scope. The residual, lowest-priority item is the pre-existing, explicitly-carried `REBASE_DIRS` depth looseness (owned by Batch 14) and the general observation that submodule-internal state changes remain invisible to the watcher by the pre-existing `nestedRepoDetection` design — correctly documented now, not a defect.
- **What a robust implementation would add**: nothing blocking; optionally, a CI note that the real-git suite (9 cases, ~40-50 s locally on Windows) should also be confirmed on the Linux/macOS legs of Batch 8's OS matrix before R3 is considered fully closed, since this review's evidence is Windows-only.
