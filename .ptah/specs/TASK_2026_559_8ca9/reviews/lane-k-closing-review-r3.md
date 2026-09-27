# Code Logic Review — TASK_2026_559_8ca9 — Lane K r3

## Summary

| Metric        | Value                                                   |
| ------------- | ------------------------------------------------------- |
| Verdict       | **REVISE**                                              |
| Assessment    | NEEDS_REVISION                                          |
| Score         | **6/10**                                                |
| Blocking      | **1, r2 finding 1 remains OPEN in a narrower interval** |
| Serious       | 0                                                       |
| Moderate      | 1, unchanged `_test` carry-to-38                        |
| Failure modes | 2 including the carried finding                         |

The new guard closes both original queued-worker probes. It does not establish ordering between a completed revoke and process creation: revoke can complete after the worker reads consent but before it finishes validation and creates the child. An additional controlled scheduling probe reproduced that remaining interval. This is the same r2 authorization-ordering finding, not an unrelated new requirement. The fixes are substantial, but the remaining violation of O2 prevents approval and the 7–8 band.

Reviewed HEAD **c5cab17fe49c2802e1252cda5086351ea3cd4131**, verified by reading the worktree HEAD/ref files, plus the fix report's “Revoke-race fix” section and the r2 report. No git commands or production source edits. This is a targeted verification, using the previous full lane review as baseline.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`. **EC** = `libs/backend/workspace-intelligence/src/diagnostics/external-checkers`; **SP** = `libs/backend/agent-sdk/src/lib/helpers`; **PC** = `libs/backend/platform-core/src`.

## r2 Blocking status and probe evidence

| Check                                                                    | Status             | Evidence                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revoke completes while worker message is queued, before guard evaluation | **VERIFIED fixed** | Real production worker program held before its message loop; revoke completed; release produced no PID, `unchecked/no-consent`, empty checkedFiles. Guard at `SP/off-thread-process-spawner-source.ts:238`; checker mapping at `EC/go-vet-checker.ts:677`.                                                                                           |
| Binary changes while worker message is queued                            | **VERIFIED fixed** | Same real-worker probe; append changed accepted binary size; release produced no PID, `unchecked/consent-stale`, staleReason `go-changed`, empty checkedFiles. Binary identity supplied at `EC/go-vet-checker.ts:652` and checked by worker at `SP/off-thread-process-spawner-source.ts:210`.                                                        |
| Completed revoke cannot be followed by a new process                     | **OPEN**           | Consent bytes are read first (`SP/off-thread-process-spawner-source.ts:203`), followed by independent identity checks (`:207`), then spawn (`:251`). Revoke uses uncoordinated removal (`EC/go-vet-consent-store.ts:255`). Post-read barrier probe: before release PID null and stored consent off; after release **real PID 28260**. See finding 1. |

The original probe was rerun as `C:/Users/abdal/AppData/Local/Temp/lane-k-r3-worker-probe.cjs`, derived from `lane-k-r2-worker-probe.cjs`. Two necessary fixture corrections: import the actual `LAUNCH_GUARD_REFUSED` constant from platform-core and preserve `error.code` when translating worker messages. The old fixture lacked both, so it could not reliably prove refusal-reason mapping. Timeout was increased to 30 seconds. The actual checker, runner and worker source execute; the executable is a harmless OS-temp copy of Node named `go.exe`, never an installed Go toolchain. Fixture: `C:/Users/abdal/AppData/Local/Temp/lane-k-worker-r3-zHvOz5`.

Additional probe: `C:/Users/abdal/AppData/Local/Temp/lane-k-r3-postread-probe.cjs`; fixture `C:/Users/abdal/AppData/Local/Temp/lane-k-worker-r3-jepyzK`. It inserts a scheduling barrier in the worker's in-memory source immediately after successful consent-content validation and before its identity loop. It changes no repository file and removes no check. The parent completes revoke/readback before releasing the barrier. Natural frequency or duration of this narrower race was not measured; the probe proves a possible interleaving, not an observed uninstrumented production incident.

## Guard trace and bypass review

| Boundary                  | Result and anchor                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store → checker           | Same bytes are parsed, judged and hashed (`EC/go-vet-consent-store.ts:189`, `:200`); no separate read can bind an unrelated record hash.                                                                                                                                                                                                                                                 |
| Checker → runner          | The one production Go vet invocation always supplies launchGuard (`EC/go-vet-checker.ts:646`, `:674`) with record digest, binary metadata, root realpath/dev:ino, and module-directory realpath. The command remains the verified absolute binary path (`:667`). No alternate unguarded Go vet invocation was found by source search.                                                    |
| Runner → spawner → worker | Guard forwarded at `EC/checker-runner.ts:215`, `SP/off-thread-process-spawner.ts:735`, and `:312`. No drop at the asynchronous boundary.                                                                                                                                                                                                                                                 |
| Worker                    | Missing/changed consent, changed identity or unreadable facts refuse before spawn (`SP/off-thread-process-spawner-source.ts:196`, `:238`). The module-directory fact binds canonical path only, not inode; root inode is separately bound.                                                                                                                                               |
| Inline fallback           | Environment override, pool-cap fallback and worker-construction failure all route to spawnInline (`SP/off-thread-process-spawner.ts:747`, `:754`, `:769`). It calls the same evaluator before `childProcess.spawn` (`:800`, `:808`) and throws ELAUNCHGUARD. There is no inline guard omission. It retains the same cross-process read-to-create race as the worker.                     |
| Refusal mapping           | Worker error code survives reconstruction (`SP/off-thread-process-spawner.ts:179`); synchronous throws and asynchronous error events map to refused (`EC/checker-runner.ts:226`, `:233`). Checker returns notRun with no-consent, consent-stale or launch-refused (`EC/go-vet-checker.ts:677`). Ordinary errors still map to spawn-failed; refusal never enters the clean-output parser. |
| Worker resource handling  | Refusal sends error then stdout/stderr end (`SP/off-thread-process-spawner-source.ts:239`); host fail settles whenSpawned and teardown (`SP/off-thread-process-spawner.ts:471`). No refusal resource leak was found.                                                                                                                                                                     |

The interface requires implementations to honor a guard or refuse (`PC/interfaces/process-spawner.interface.ts:76`). All production Go vet wiring uses this guarded implementation; injected fake runners are test seams, not user-selectable bypasses.

## Other callers: unguarded behavior

The source search found unguarded port calls in Codex account usage (`libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:181`), Git (`libs/backend/vscode-core/src/utils/exec-git.ts:494`), rival CLI adapters (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:316`), terminal launch (`PC/utils/terminal-launch.ts:235`, `:260`) and editor launch (`PC/utils/editor-launcher-detection.ts:558`). None supplies launchGuard.

SDK `.spawn()` callers include `SP/sdk-query-runner.service.ts:209`, `SP/sdk-model-service.ts:840` and `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:829`. Their spawn plan still has no guard (`SP/off-thread-process-spawner.ts:691`).

For these paths, evaluator returns null immediately without filesystem reads (`PC/utils/launch-guard.ts:29`; worker twin `SP/off-thread-process-spawner-source.ts:197`). Existing command parsing, arguments, environment, detached/console flags and streams are retained. The real-spawner suite includes existing inline stdio coverage alongside guarded tests (`SP/off-thread-process-spawner.spec.ts:961`). The requested full agent-sdk and platform-core test targets passed. No functional regression to unguarded callers was found; this is source/test evidence, not live execution of every editor and external CLI.

## Numbered findings

### 1. Blocking — r2 revoke ordering remains open after the worker's consent read

- **Disposition:** **fix-now**, carried from r2 finding 1; escalate under the user's process rule. No additional Blocking count is added for the already-fixed queue interval.
- **Anchors:** `SP/off-thread-process-spawner-source.ts:203`, `:207`, `:251`; inline twin `PC/utils/launch-guard.ts:33`, `:37`; revoke `EC/go-vet-consent-store.ts:255`.
- **Scenario:** worker validates the consent-file digest, then is descheduled or delayed during the subsequent realpath/stat checks. Another host deletes the consent record and confirms off. Worker resumes; binary/root/module identities still match, so it starts the process. The guard never re-reads consent after these checks and there is no shared launch/revoke lease. A second process is independent of the worker's synchronous JavaScript turn.
- **Observed:** the post-read barrier probe had no PID and consent off before release; after release actual PID 28260 existed. Node failed with unparseable Go output, as expected for the harmless substitute. The failure result does not undo execution after revoke. This reproduction needs no change to the executable, root or toolchain directory.
- **Impact:** O2 `o2-go-vet-consent-surface.md:165` says revoke stops the next run; `:167` permits only already-spawned runs to continue. The child was not yet created when revoke completed. Moving the check into the worker narrows the interval but does not provide that ordering.
- **Fix:** coordinate launch authorization/process creation and revoke with a per-root interprocess lease/lock or equivalent acknowledgment protocol. If launch acquires first, revoke must not report completion until creation/refusal is resolved; if revoke wins, queued launch must fail. Handle lease-owner death and bound waits. A generation value or another final read alone merely moves the remaining check/use interval. R2 already called for this coordination. Alternatively, an explicit user decision could weaken the contract to allow a launch whose final authorization check preceded revoke; the reviewer cannot silently make that change.
- **Regression:** hold the worker after its consent read, complete revoke from another host, then release. With proper coordination, either revoke cannot yet report completion because launch owns the lease, or the child is refused. Assert the ordering rather than only testing deletion before the worker consumes its message.

### 2. Moderate — unchanged real `_test` package attribution

- **Disposition:** **carry-to-38**, as previously directed. Not a new finding.
- **Anchor:** `EC/go-vet-output.ts:186`.
- **Scenario:** real import path `example.com/m/foo_test` is reduced to `foo`, misassigning an unmapped finding's affected package. Global finding disclosure remains, limiting the impact.
- **Fix:** distinguish synthetic test package IDs from actual import paths in Batch 38.

No other new anchored finding survived this verification.

## Threat-model judgment: final binary check → OS creation

The author's stated binary-directory residual is **outside a reasonable hostile-repository threat model** for an opt-in trusted installed toolchain. A principal who can rewrite that installed executable can already make future `go` executions malicious; the metadata identity is not an executable-signature or content-trust guarantee. The launch-time metadata check is a meaningful defense against ordinary replacement during queue delay. The remaining stat-to-CreateProcess interval is honestly documented in `PC/interfaces/process-spawner.interface.ts:34`; I do not raise another Blocking finding for it or require OS execution-by-handle protection against that principal.

That reasoning does **not** dispose of finding 1. An authorized user revoking consent from a second host does not control or modify the toolchain. The consent-ordering invariant is separate from executable trust. Saying checks occur “in the same turn” does not serialize a filesystem delete from another process. The author correctly discloses no interprocess lease; the review therefore does not certify absolute completed-revoke ordering.

## Five logic questions

1. **Silent success:** guard refusal no longer produces a checked answer (`EC/go-vet-checker.ts:677`). A post-read revoke can still permit execution, because the guard already accepted the bytes (finding 1).
2. **Unexpected user action:** off in another host during worker validation can complete before that worker creates a child (`EC/go-vet-consent-store.ts:255`). Off while the message is still queued is now handled correctly.
3. **Wrong input result:** changed record bytes or binary metadata refuse correctly (`SP/off-thread-process-spawner-source.ts:205`, `:214`). The existing `_test` attribution edge remains finding 2.
4. **Dependency failure:** unreadable facts refuse (`PC/utils/launch-guard.ts:62`); inline refusal throws the fixed code (`SP/off-thread-process-spawner.ts:805`); worker refusal maps to unchecked. Unguarded callers retain their prior paths.
5. **Missing requirement:** no new authentication or hostile-toolchain trust guarantee is inferred. Cross-process launch/revoke ordering is already required by O2 and was explicitly identified in r2; its synchronization is still missing.

## Verification and edge cases

Ran once:

`node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/agent-sdk @ptah-extension/platform-core --skip-nx-cache`

**PASS: exit 0, all nine targets, 2m 38s.** Full output retained in `C:/Users/abdal/AppData/Local/Temp/lane-k-r3-nx.log`, final 20 lines read after one completion join. No suite rerun or polling loop. Scoped Ptah diagnostics for launch-guard.ts: **typescript-compiler, 0 errors / 0 warnings**.

| Case                                          | Result                                                                |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Consent deleted before worker evaluates guard | No child; unchecked/no-consent                                        |
| Binary changed before worker evaluates guard  | No child; unchecked/consent-stale/go-changed                          |
| Consent deleted after worker content check    | Child created after off; OPEN                                         |
| Inline refusal                                | Guard is present; fixed error mapping; real-spawner regression passed |
| Missing guard for other callers               | Immediate no-op evaluator; prior execution behavior retained          |
| Unreadable fact                               | Fail closed                                                           |
| Real installed Go hostile integration         | Not run: Go remains absent                                            |

No fresh visual review was needed for this backend-only correction; the r2 visual verification limitation is not cleared by it. All probes and harmless executables stayed in OS temp. Only this review and the role-required code-logic-review.md companion were written in the worktree.

## Verdict

**REVISE, 6/10.** The original queue-boundary reproductions are fixed, and the requested checks are green. The overall r2 Blocking remains **OPEN** because the reproduced post-read revoke interleaving still violates completed-revoke ordering. Confidence is **HIGH** in the controlled reproduction and guard propagation; normal race frequency is unmeasured. Escalate finding 1 under the existing user process; retain the `_test` Moderate for Batch 38.
