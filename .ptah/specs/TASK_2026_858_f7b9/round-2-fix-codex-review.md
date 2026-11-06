# Final bounded logic review — `b6caff64b`

**Verdict: APPROVED. Score: 8/10.** The reported symlink-parent alias now uses one kernel lock name. I found no new defect in the changed behavior of the two state writers. The score is above the 5–6 band because their path is covered by the new cross-process test and their directory is created before locking; it remains below 9–10 because the generic missing-parent fallback is not covered by that test. Paths below are repository-relative.

## Prior defect

| Defect | Status | File:line evidence |
| --- | --- | --- |
| Symlinked parent gives the same state file a second lock name | **Fixed for the worker state files** | `libs/backend/worker-runtime/src/lib/file-lock.ts:66-89` resolves the parent with `realpath` before hashing; `:99-101,130-148` uses that hash for the kernel-arbitrated bind. `libs/backend/worker-runtime/src/lib/file-lock.spec.ts:91-101` holds the real path's endpoint in a child and confirms that the symlinked path is busy. |

## New defects

None identified in the changed paths. `file-lock.ts:45-54` still queues only identical raw strings, so two aliases in one process can wait on the endpoint instead of the in-process queue; `:83-89,99-101,130-148` nevertheless bind the same name and preserve exclusion. This queue behavior predates this commit.

## Five logic questions

1. **Silent success:** The parent alias no longer permits two successful binds (`file-lock.ts:66-89,130-148`; `file-lock.spec.ts:91-101`).
2. **Unexpected user action:** Using a symlinked worker home resolves the same parent as its real path (`file-lock.ts:66-69`); both state writers lock paths under the ensured worker directory (`token-store.ts:170-175`; `workspace-registry.ts:108-113`).
3. **Wrong input:** A non-`ENOENT` canonicalization failure propagates before the operation runs (`file-lock.ts:70-79,99-104`).
4. **Dependency failure/timeout:** `ENOENT` falls back to a lexical path (`file-lock.ts:70-77`). Both current callers first create the parent (`token-store.ts:170-171`; `workspace-registry.ts:108-109`; `paths.ts:26-28`), so this fallback is outside their normal write path. A future caller that creates an absent parent inside its operation would need a stronger canonicalization rule to retain alias exclusion.
5. **Lifecycle/race:** Endpoint derivation completes before the bind (`file-lock.ts:99-101`), and a same-process alias still contends for the kernel endpoint (`:45-54,83-89,130-148`). The deadline begins after canonicalization (`:99-101`), consistent with the documented timeout for waiting on another holder (`:11-12`).

## Verification and limits

Reviewed `git show b6caff64b -- libs/`, the changed file and spec, and the state-writer call sites. The implementer reports worker-runtime 142/142, lint and typecheck green, and worker-host typecheck green. I did not rerun tests. Scoped `ptah_get_diagnostics` remained unavailable after its 45-second TypeScript check timeout, so I relied on the reported typechecks. The new test covers an existing symlinked parent on Linux (`file-lock.spec.ts:91-101`); it does not cover the `ENOENT` fallback or Windows. No source files were changed.

## Decisions

- **Decision:** Accept the fix for current worker state files. **Options:** require further canonicalization for missing parents, or rely on the current callers' `ensureWorkerDirectory` precondition. **Evidence:** `file-lock.ts:70-77`; `token-store.ts:170-171`; `workspace-registry.ts:108-109`; `paths.ts:26-28`. **Reversible:** yes.
