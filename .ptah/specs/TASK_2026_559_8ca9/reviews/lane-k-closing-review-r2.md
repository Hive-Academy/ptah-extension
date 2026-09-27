# Code Logic Review — TASK_2026_559_8ca9 — Lane K closing verification r2

## Summary

| Metric | Value |
| --- | --- |
| Overall score | **6/10** |
| Assessment | **NEEDS_REVISION** |
| Verdict | **REVISE** |
| Original Blocking findings still open | **0 of 4** |
| New Blocking findings | **1** |
| Serious issues | 0 |
| Moderate issues | 1, carried unchanged to Batch 38 |
| Failure modes reported | 2 |

The four original reproductions are fixed. A separate, demonstrated authorization race remains across the off-thread launch boundary: a process can start after a completed revoke. This is the author's recorded residual, now independently reproduced, not a reopening of the cached-storage finding. Under the user's process rule, **finding 1 below must go to the user**. The four substantive fixes justify improvement from 4/10; a demonstrated violation of the execution-consent boundary prevents the 7–8 band.

Reviewed current files at HEAD **9df0d81e4d8aedd7289265b71ed20ab2f877116d**, confirmed by reading the worktree HEAD/ref files. No git command or source edit was made. This verifies the current implementation; it does not independently attest the author's claim that 16 unrelated formatting changes were restored before commit. Reviewed the fix report, r1 review, O2, task context and language implementation plan, with the prior round's full lane trace as baseline. Read the complete new store and consent handler, complete membership implementation and card, checker flow, updated CLI/RPC contracts and production worker handoff. No approval is implied for unrelated spawner functionality.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`. **EC** = `libs/backend/workspace-intelligence/src/diagnostics/external-checkers`; **RH** = `libs/backend/rpc-handlers/src/lib/handlers`; **CLI** = `apps/ptah-cli/src/cli/commands`; **CARD** = `libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts`; **SP** = `libs/backend/agent-sdk/src/lib/helpers`. Every abbreviated anchor expands through these prefixes.

## Four original findings: verification

| r1 finding | Status | Evidence and independently observed result |
| --- | --- | --- |
| 1. Another process's revoke is invisible; unrelated state writes resurrect consent | **VERIFIED** | `EC/go-vet-consent-store.ts:178` reads the dedicated file every time; `:235` deletes it. A real second Node process revoked A's grant. The still-running A read `off`; its checker returned `unchecked/no-consent`, zero runner calls. A subsequent real `CliStateStorage.update('unrelated', true)` left the record absent and consent off. |
| 2. Failed grant persistence still authorizes a long-lived process | **VERIFIED** | `EC/go-vet-consent-store.ts:222` writes an exclusive temporary file; `:226` publishes by rename. Blocking the consent directory with a regular file made grant reject; subsequent read was off and checker made zero runner calls. An injected rename failure on a re-grant preserved the previous committed record, left no temporary files, and judged the changed binary stale. No in-memory grant exists. |
| 3. Go-excluded files receive clean vet coverage | **VERIFIED** | `EC/go-file-membership.ts:235`, `:252`, `:253`; checker consumes the result at `EC/go-vet-checker.ts:496`. Independent `UPPER.GO`, `Mixed.Go`, `package documentation`, and `//go:build ignore` fixtures each returned unchecked, zero runner calls, zero checked files, with `not-go-source`, `documentation-package`, or `build-constraints`. Ordinary `doc.go` with `package p` was credited after the injected successful runner. |
| 4. A grant accepts a different root/binary from the GET display | **VERIFIED** | `EC/go-vet-consent-store.ts:259` binds physical root identity and binary metadata; `RH/diagnostics-consent-rpc.handlers.ts:209` compares before writing. Replacing the physical root at the same pathname after GET returned `workspace-changed`; changing binary size returned `go-changed`; neither wrote a record. Changing binary identity during grant returned `go-changed` and removed the record (`:238`, `:244`). CLI sends the GET token at `CLI/config.ts:586`; card captures it at `CARD:446` and sends it at `:474`. This closes the original displayed-target reproduction; it does not close finding 1's later launch boundary. |

Probe code: `C:/Users/abdal/AppData/Local/Temp/lane-k-r2-probe.cjs`. Real Windows fixtures were confined to `C:/Users/abdal/AppData/Local/Temp/lane-k-r2-C3dckX`. The checker used its actual implementation with a successful fake runner for coverage tests; **no real Go analysis was claimed**.

## Security surfaces

| Item | Assessment | Evidence / limit |
| --- | --- | --- |
| Fresh stored consent | PASS | `EC/go-vet-consent-store.ts:171`; observed cross-process revoke and absence after unrelated writes. |
| Grant publication and failed write | PASS | `EC/go-vet-consent-store.ts:218`, `:222`, `:226`, `:228`; failed-first-grant and failed-regrant probes above. Atomic publication is established; no fsync/power-loss durability guarantee is claimed. |
| Windows rename over an existing target | PASS on this filesystem | Actual second grant replaced an existing JSON record and read on for the new identity; only one `.json` remained. Rename rejection preserved the prior bytes. Code uses a same-directory temporary file (`:220`), without an unlink-then-rename absence window. Sharing violations can reject the operation and are handled as failure. This does not certify every Windows/network filesystem. |
| Hash-derived pathname / traversal | PASS | `EC/go-vet-consent-store.ts:294` resolves/case-folds the registered root and uses 32 hexadecimal SHA-256 characters as the filename (`:298`). No root substring becomes a directory segment. The implementation uses a 128-bit truncated filename hash, not the full digest. |
| Permissions | Host-directory trust boundary; no demonstrated default-ACL bypass | `EC/go-vet-consent-store.ts:218` and `:222` specify no private directory/file mode or ACL: they inherit the host directory's protection (and platform defaults/umask). The real Windows probe directory inherited current-user, SYSTEM and administrator control, a sandbox SID with Modify, and CodexSandboxUsers ReadAndExecute. It did not expose an Everyone/Users write ACL. This is not an assurance for a deliberately shared/writable user-data directory or a permissive POSIX umask. The store assumes the host-owned directory is trusted; it is not tamper-proof against that user or an existing host-directory writer. |
| Concurrent grant/revoke, separate processes | Last filesystem commit wins; original resurrection fixed | A real child process paused its grant before rename. Parent revoked and read off/absent; releasing the child committed its explicit grant, and parent then read on. `EC/go-vet-consent-store.ts:226`, `:235` have no interprocess lock; handler `RH/diagnostics-consent-rpc.handlers.ts:108` serializes only one handler instance. Overlapping explicit grant/revoke has a valid last-commit ordering. Do not describe it as revoke-wins or cancellation of pending grants. O2 does not specify that stronger ordering, so this observation is not promoted to another defect. An unrelated state write never recreates consent. |
| Confirmation binding | PASS for stale-target guard | `EC/go-vet-consent-store.ts:281`, `:377`, `:385`: two 96-bit truncated hashes; root = folded realpath plus dev:ino (or no-id), binary = path, size and mtime. Missing token refused invalid-params; arbitrary zero token refused workspace-changed. Replaced root/binary probes refused as above. |
| Token forgery / replay | Not an authentication credential | Hashes have no secret, nonce, expiry or issuance registry. A caller knowing the metadata can compute a current token without GET; a previously issued token passes again while identities are unchanged, including after revoke (independently observed). A stale token for changed metadata fails. This is appropriate only as an identity comparison for an already-authorized RPC caller; it does not prove a human viewed/approved anything. The existing RPC authorization/capability boundary remains responsible for who can call SET. No new repo-file or CLI-flag enable path was found. |
| Token logging | PASS in examined paths | Consent audits at `RH/diagnostics-consent-rpc.handlers.ts:230`, `:246`, `:255`, `:262` contain fixed messages, workspace hash and operation metadata, not token. `libs/backend/vscode-core/src/messaging/rpc-handler.ts:198` and `:218` log method/correlation ID, not payload. CLI status and success payloads omit the token (`CLI/config.ts:608`, `:638`). The token travels in RPC data as required; no blanket assurance about external transport capture is made. |
| Launch after revoke / identity change | **FAIL — finding 1** | Only the checker reads consent (`EC/go-vet-checker.ts:604`); worker receives no consent/root/binary identity assertion (`SP/off-thread-process-spawner.ts:295`) and starts the command at `SP/off-thread-process-spawner-source.ts:181`. |
| File coverage / honest skipped files | PASS for the four requested exclusions | Membership reasons reach skippedFiles/notChecked (`EC/go-vet-checker.ts:496`, `:777`). Real doc.go remains a member. Real Go integration remains untested because Go is absent. |

The token uses metadata identity, matching O2's existing contract, not an executable content digest. A same-path, same-size replacement with restored mtime is outside what that identity detects (`EC/go-binary-resolver.ts:259`). Likewise O2's documented no-inode limitation remains. Neither is presented as a newly introduced fix-round defect.

## Numbered findings

### 1. Blocking — queued worker launch can execute after revoke completed

- **Disposition: fix-now. OPEN; escalate to the user under the process rule.**
- **Primary anchor:** `EC/go-vet-checker.ts:604`. The authorized identity is checked here, then only `binary.path` is passed at `:639`.
- **Boundary evidence:** `SP/off-thread-process-spawner.ts:295` posts the command to another thread; `SP/off-thread-process-spawner-source.ts:267` consumes that later message and `:181` calls `spawn` without checking the consent record or binary identity. `EC/checker-runner.ts:186` has no authorization callback/metadata to pass across that boundary. Both production hosts resolve this spawner (`libs/backend/cli-engine/src/lib/container.ts:633`; `apps/ptah-electron/src/di/phase-2-libraries.ts:186`).
- **Concrete failing scenario:** diagnostics reads an on record and queues launch while the worker is starting or delayed. Another CLI process completes `off`, deleting the record and reading off. The worker later consumes the already-posted command and creates the process. No user re-enable is needed. A normal toolchain updater can similarly replace the accepted absolute binary path during the asynchronous gap; the worker still executes that pathname. A malicious replacement requires write access to the accepted toolchain location; this is not a demonstrated repository-only arbitrary-code-execution primitive.
- **Independent evidence:** first used the real checker and runner with a delayed adapter: no process existed when revoke read off; after releasing the adapter, the check started and returned checked with `a.go` credited. Then used the **actual production worker program** (`OFF_THREAD_SPAWNER_WORKER_SOURCE`), with a scheduling barrier before its message loop and a harmless OS-temp copy of Node named `go.exe`. Before releasing the worker: PID null, consent off. After release: real child **PID 13416**, proving process creation after revoke. Its result was failed/unparseable because Node is not Go; that failure does not undo unauthorized execution. The barrier widens a real asynchronous scheduling interval; the normal window's frequency was not benchmarked.
- **Probe:** `C:/Users/abdal/AppData/Local/Temp/lane-k-r2-worker-probe.cjs`; fixture `C:/Users/abdal/AppData/Local/Temp/lane-k-worker-r2-kAHfcr`. A separate binary-change attempt reached stale/go-changed before release but timed out without an observed PID, so it is **not** counted as a successful binary-swap exploit. The source establishes the missing identity revalidation; the successful execution proof is the revoke case.
- **Impact:** O2 permits an already-spawned run to finish, but says revoke stops the next run. At completed revoke this child had not spawned. The existing 30-second timeout bounds it; it does not restore consent.
- **Fix:** perform consent/root/binary validation on the thread that actually creates the process, immediately at launch; refuse stale or missing records without a child. Pass the expected identity and the verified absolute executable path through the adapter. The code **already passes an absolute path**, so merely making it absolute again is insufficient. To guarantee ordering with a completed revoke across processes, coordinate revoke and launch through a per-root interprocess lease/lock or equivalent generation/acknowledgment protocol, including queued-request invalidation. Re-verify binary metadata and root/cwd identity at the launch boundary. A last-moment metadata check removes the broad queue gap but alone cannot eliminate an external filesystem replacement between stat and the OS execution syscall; claiming complete protection against a hostile executable-directory writer would require stronger OS-level execution identity handling.
- **Required regression:** delay the real worker before process creation, finish revoke in a second host, then release it; assert no PID and an unchecked consent reason. Separately change root/binary identity during delay and assert no execution. Do not silently redefine “spawned” as “request posted” to satisfy the test; that changes the user-approved consent rule.

### 2. Moderate — legitimate package names ending `_test` are misattributed (unchanged)

- **Disposition: carry-to-38**, as instructed; this is r1 finding 5, not a new regression.
- **Anchor:** `EC/go-vet-output.ts:184`, `:186`.
- **Scenario:** the real package `example.com/m/foo_test` has an unmapped finding. Removing `_test` unconditionally maps it to `foo`; the wrong package's files may be withheld while the actual package is credited. Global unmapped-findings count/outcome remains visible (`EC/go-vet-checker.ts:677`, `:705`), limiting the impact.
- **Recommendation:** distinguish synthetic test-package IDs from actual import paths; cover a real `_test` directory and external test variants in Batch 38.

## Five logic questions

### 1. How does this fail silently?

Queued launch retains old authorization after completed revoke (finding 1, checker `:604`, worker `:181`). Dedicated disk reads eliminate the previous long-lived snapshot problem; they do not extend into the worker. A synthetic successful runner demonstrated that this can still produce a clean checked answer after revocation. Ordinary not-run paths retain explicit reasons (`EC/go-vet-checker.ts:763`).

### 2. What user action produces unexpected behaviour?

Turning go vet off while a request waits for worker startup can still be followed by a new process (finding 1). Turning it on from an old display after replacing the root or binary is now refused with the proper identity error (`RH/diagnostics-consent-rpc.handlers.ts:209`). Concurrent explicit on/off commands are ordered by filesystem commit, not invocation time (`EC/go-vet-consent-store.ts:226`, `:235`).

### 3. What input data produces a wrong answer?

The former `.GO`, `.Go`, documentation-package and ignore-tag fixtures are no longer credited (`EC/go-file-membership.ts:235`, `:252`, `:253`). The unchanged real `_test` package attribution edge remains finding 2. Tokens bind metadata rather than file contents (`EC/go-vet-consent-store.ts:385`).

### 4. What happens when a dependency fails?

Unreadable/malformed consent reads fail closed (`EC/go-vet-consent-store.ts:178`, `:182`). Failed write/rename publishes no new record and maps to persist-failed in RPC (`RH/diagnostics-consent-rpc.handlers.ts:220`). Revoke readback requires actual absence plus off (`:309`). Missing/changed Go is refused (`:207`, `:217`); mid-write identity change triggers rollback (`:244`). Timeout/error/overflow remains a failed check, with no checkedFiles (`EC/go-vet-checker.ts:648`, `:782`). Post-grant rollback failure is warned and the operation refused; the record is still judged against current identities, not trusted solely because it exists.

### 5. What is missing that the requirements never mentioned?

O2 does not define revoke-wins ordering for overlapping explicit grants, token single-use/expiry, or a private ACL policy for arbitrary user-data directories. Those are stated limitations of the new surfaces, not invented Blocking findings. The worker gap is different: O2 explicitly distinguishes already-spawned runs from future runs. Its implementation requires an authorization boundary at actual creation (finding 1).

## Data flow and requirements fulfilment

1. **OK:** GET reads the active registered root, resolves Go and returns token (`RH/diagnostics-consent-rpc.handlers.ts:157`). CLI forwards it and card freezes it for confirmation (`CLI/config.ts:586`; `CARD:446`). Success displays the committed binary (`CLI/config.ts:614`; `CARD:488`).
2. **OK:** SET validates the DTO, active root and confirmation identity before grant (`RH/diagnostics-consent-rpc.handlers.ts:189`, `:209`). File grant publishes by same-directory rename; handler rechecks and reads back (`:238`, `:254`). Revoke deletes and verifies absence (`:309`).
3. **OK:** the checker resolves files/packages and Go, then freshly reads the stored grant (`EC/go-vet-checker.ts:572`, `:590`, `:604`). DI uses the same host globalStoragePath (`libs/backend/workspace-intelligence/src/di/register.ts:140`; handler `:124`).
4. **GAP:** identity is discarded at the asynchronous worker handoff; only path, args, cwd and env arrive at spawn (finding 1).
5. **OK with carried edge:** output failures/skip reasons do not claim Go type-checking or erased work; `_test` attribution remains finding 2.

| Requirement | Status | Gap |
| --- | --- | --- |
| Four original Blocking reproductions fixed | COMPLETE | All VERIFIED above |
| Cross-process fresh consent / failed-write atomic publication | COMPLETE | Explicit overlapping grants are last-commit-wins |
| Displayed root and binary preserved across confirmation | COMPLETE for requested probes | Token is an identity guard, not authentication |
| Current consent when process is created | PARTIAL | New finding 1 |
| New record permissions, traversal and Windows replacement assessed | COMPLETE review | Inherited host ACL assumptions described; no cross-platform private-mode guarantee |
| Electron visible layout equivalence | UNVERIFIED visually | Needs visual re-check |
| Real Go hostile integration | MISSING on this machine | Go is not installed |

## Electron visual scope

The token is private component state (`CARD:302`) and is passed through the existing confirmation/submit path (`:429`, `:474`); no token is rendered. The existing card markup is at `CARD:78`, and the new go-changed refusal reuses the existing error panel (`:44`, `:221`). This source inspection suggests the normal layout is unaffected, but **a visual re-check is still needed**: no fresh browser screenshots or rendered comparison were taken, and the new refusal text can wrap differently. Prior visual sign-off is not represented as proof of the new state. Preserve the r1 keyboard/focus verification limitation.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Another process revokes; original process reads next time | YES | Real child-process probe; store `:178` |
| Unrelated workspace-state write after revoke | YES | Record stays absent; store owns separate file `:293` |
| Initial write fails / re-grant rename fails | YES | No new authorization; old commit preserved |
| Existing target replaced by rename on this Windows volume | YES | Real re-grant probe read new identity on |
| Missing/arbitrary token | YES | invalid-params / workspace-changed refusals |
| Old token after revoke, unchanged identities | ACCEPTED BY DESIGN | Deterministic identity guard; not one-time proof |
| Root replaced or binary changes after GET | YES | Identity refusals and no grant |
| Binary changes mid-grant | YES in probe | Refusal and deletion |
| Revocation while worker has not created process | NO | Real worker starts PID after off |
| Actual `_test` package name | NO | Carried attribution edge |

## Verification results

Executed the requested five-project `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/chat ptah-cli --skip-nx-cache` once (PowerShell equivalent of the requested tail pipeline, full output redirected to the OS temp directory). It finished in **6m 54s**, exit **1**. Nx reported **46 successful tasks** and one failed target: `@ptah-extension/rpc-handlers:test`. The failing suite was the known `harness-skill-selection-rpc.service.spec.ts:113`; its target reported 112 passed suites / 1 failed. All selected lint/typecheck targets and the other selected test targets passed. Dependencies were scheduled by Nx; no workspace-wide verification command was issued. No failed suite was re-run.

Full captured log: `C:/Users/abdal/AppData/Local/Temp/lane-k-r2-nx.log`; exit marker: `C:/Users/abdal/AppData/Local/Temp/lane-k-r2-nx.exit`. The first completion observation was early; I then joined the existing process once and read its final tail, without rerunning the command or using a polling loop. The run is **not** reported as entirely green. Go is absent, so passing unit tests do not establish the real-Go hostile fixture.

Scoped `ptah_get_diagnostics` was requested for store and handler. It returned **Unavailable: TypeScript check still running after 45s**, not an empty-success result. No diagnostic retry loop was used. Native PowerShell reads/writes were used because no direct Ptah file-read/write tool is listed. Temporary probe programs/fixtures were confined to the OS temp directory. No production source was changed. Only this requested review and the role-required `code-logic-review.md` companion were written.

## Verdict

**REVISE, 6/10.** Confidence **HIGH** in the four original closures and the reproduced post-revoke worker launch; normal-window frequency is unmeasured. One **new Blocking** remains OPEN and must be escalated; the original four are VERIFIED. Carry only the existing `_test` Moderate to Batch 38. Closing the launch authorization boundary and its real-worker regressions is necessary before approval; real-Go hostile execution and a fresh visual check remain explicit verification limits.
