# Round 2 independent logic review — `4ea4b0af0`

**Verdict: REVISE. Score: 6/10.** Both reported defects are fixed on their intended paths. A new path-alias gap still permits concurrent writes to one physical state file. This is a concrete correctness gap below the 7–8 band; the two effective repairs and reported passing scoped checks place it above the 3–4 band. Paths below are repository-relative.

## Prior defects

| # | Status | File:line evidence |
| --- | --- | --- |
| 1. Stale-owner takeover can move a live lock | **Fixed for a common endpoint name** | `libs/backend/worker-runtime/src/lib/file-lock.ts:60-69` derives one endpoint; `:95-126` binds it through `net.Server.listen`, retries only `EADDRINUSE`, and propagates other listen errors. `:86-92,129-132` waits for close before returning. There is no owner-record read/rename handoff. The remaining endpoint-name alias is a new defect below. |
| 2. Shutdown releases a lock for a start with no session ID | **Fixed** | `libs/backend/worker-runtime/src/lib/session-driver.ts:165-170` counts unresolved admissions; `libs/backend/worker-host/src/lib/commands/remote-sessions.ts:564-571` retains unattributable held locks while one exists. `session-driver.ts:218-230` retires a tab-only orphan on terminal event; `:515-523` checks whether an event already retired it before releasing. `:416-423,526-530` cancels admission waiters promptly on shutdown. `remote-sessions.ts:213-224` releases unattributable drive locks after the last unresolved admission ends. `libs/backend/platform-core/src/session-driver-lock/kernel-session-driver-lock.ts:296-303` shows `held()` is this instance's entries, not another process's locks. |

## New defects

1. **Serious — Symlink aliases obtain different locks for the same state file.** `libs/backend/worker-runtime/src/lib/file-lock.ts:60-68`; real callers are `libs/backend/worker-runtime/src/lib/token-store.ts:170-175` and `workspace-registry.ts:108-113`. The endpoint hash uses `path.resolve(file)`, which removes lexical `.` and `..` but does not resolve symlinks. If one process uses `/home/alice/.ptah/worker/tokens.json` and another uses `/mnt/home-alias/alice/.ptah/worker/tokens.json`, where the latter parent is a symlink to the former, both can bind distinct abstract sockets and enter the read/modify/write operation at once. One token or workspace change can overwrite the other. The old adjacent `.lock` directory was reached through the filesystem's symlink resolution, so this is a regression from the file-backed lock. **Fix:** canonicalize the existing parent directory with `realpath` before hashing, then append the basename; reject canonicalization failures rather than silently choosing another key. Add a two-process test with one real parent and one symlink alias.

## Five logic questions

1. **Silent success:** Two aliased paths can each bind successfully and return successful state mutations while one write is lost (`file-lock.ts:60-68`; `token-store.ts:171-175`).
2. **Unexpected user action:** Running the worker through a symlinked home path while an operator uses its real path creates different lock names for the same token file (`file-lock.ts:62-68`; `token-store.ts:171-175`).
3. **Wrong input rather than error:** A symlink alias is a valid path to the state file, but the hash treats it as a distinct resource (`file-lock.ts:61-65`).
4. **Dependency failure/timeout:** Non-`EADDRINUSE` listen errors propagate (`file-lock.ts:113-126`); a refused abort keeps its admission and shutdown lock (`session-driver.ts:515-523`; `remote-sessions.ts:564-571`). A failed close is reported while the operation outcome is preserved (`file-lock.ts:86-92,129-132`).
5. **Lifecycle/race:** The kernel arbitrates binds of the *same* endpoint (`file-lock.ts:109-126`); tab-only terminal cleanup waits until no unresolved admission remains and excludes running or attributable sessions (`session-driver.ts:220-230`; `remote-sessions.ts:213-224`). The alias defect is the remaining cross-process exclusion break.

## Verification and limits

Read `4ea4b0af0` and the round-2 implementer reports; traced the changed source and the local lock implementation. The implementer reports worker-runtime 141/141, worker-host 48/48 and worker-protocol 187/187 tests passing, with lint and typecheck green. I did not rerun tests. The existing file-lock tests use one lexical path (`libs/backend/worker-runtime/src/lib/file-lock.spec.ts:69-109`), so they do not exercise alias exclusion. This review does not establish behavior on Windows.

## Decisions

- **Decision:** Treat the two prior defects as fixed and the symlink alias as a new serious regression. **Options:** approve the new endpoint scheme as-is, or require canonical path identity. **Evidence:** `file-lock.ts:61-68` hashes `resolve(file)`; `token-store.ts:171-175` uses the result to guard a read/modify/write; `file-lock.spec.ts:69-109` covers only the same lexical path. **Reversible:** yes, inside endpoint derivation.
