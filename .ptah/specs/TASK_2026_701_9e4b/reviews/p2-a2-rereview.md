# P2 A2 re-review — TASK_2026_701_9e4b

## Summary

**A2: FIXED. Score: 8/10.** Remaining A2 findings: **0 Blocking, 0 Serious, 0 Moderate; 0 new failure modes**. No new Blocking/Serious defect identified in the supplied A2 diff.

Scope: `reviews/p2-a2-diff.patch`, attributed by the handoff to completion commit `6bba1367a`, and the current eight files named by that patch. This is an A2-only verdict, not approval of unrelated P2 work. No git commands were used, so commit identity was not independently verified.

Paths below are repository-relative. `AG` means `libs/backend/agent-generation/src/lib/services`; `PC` means `libs/backend/platform-core/src`.

## Required checks

### 1. One shared instance in each host process — satisfied

`PC/utils/destination-write-lock.ts:88` constructs the production singleton. `PC/index.ts:226` re-exports that binding, rather than constructing another lock. The wizard imports it through the package at `AG/file-writer.service.ts:19`; the downloader imports the same source module directly at `PC/agent-pack-download.service.ts:44`. Neither service constructor creates a lock, so separate service instances and DI containers do not divide the mutex.

Host resolution evidence:

- Electron maps platform-core to its source barrel at `apps/ptah-electron/tsconfig.build.json:33` and agent-generation at `:6`; its main bundle uses that configuration at `apps/ptah-electron/project.json:27` and enables bundling at `:31`.
- CLI maps platform-core to that same barrel at `apps/ptah-cli/tsconfig.build.json:30` and agent-generation at `:9`; the main bundle selects it at `apps/ptah-cli/project.json:28` and enables bundling at `:32`.
- VS Code selects `tsconfig.app.json` at `apps/ptah-extension-vscode/project.json:28` and enables bundling at `:32`. That configuration extends `tsconfig.json` at `apps/ptah-extension-vscode/tsconfig.app.json:2`, which extends the root configuration at `apps/ptah-extension-vscode/tsconfig.json:2`. Root aliases map platform-core and agent-generation to the same source entries at `tsconfig.base.json:141` and `:23`.

Thus the configured host module graphs resolve both imports to one module instance per host process. This is source/configuration evidence, not a runtime inspection of packaged applications. Separate processes intentionally have separate locks.

### 2. Final baseline read and mutation are inside the lock — satisfied

Wizard flow: initial read/guard, directory preparation, then `destinationWriteLock.run` at `AG/file-writer.service.ts:150`. Its callback returns the complete replacement promise. `replaceContent` reads at `:287`, checks the guard at `:297`, and awaits the mutation at `:306`. An absent re-read falls back to exclusive creation at `:289`, still inside the existing hold; `createContent` uses `writeFileExclusive` at `:245` and maps an existence collision at `:247`.

Pack flow: the directory queue invokes sequential installation at `PC/agent-pack-download.service.ts:296`; each item passes its initial guard and enters the shared lock at `:354`. The callback returns `commitItem`, which awaits `replaceIfBaseline` at `:385`. That method stages a temporary sibling, reads the destination at `:551`, checks its baseline at `:557`, and awaits rename at `:561`. Temporary cleanup at `:585` is also awaited before the hold ends. The absent case uses no-clobber publication at `:553`; it does not bypass the lock or rename over a newly created destination.

The initial reads outside the lock cannot authorize a stale replacement: replacement always revalidates within the hold. An initially absent target uses exclusive creation, so a stale absence cannot clobber a winner.

### 3. Queue ordering and non-reentrancy — satisfied

`PC/agent-pack-download.service.ts:294` acquires the instance-local directory queue before the destination hold at `:354`. Its item loop awaits each item at `:315`, releasing one destination before proceeding to the next. No destination callback enters `installFiles` or waits for the directory queue. Wizard callbacks enter only creation/replacement helpers (`AG/file-writer.service.ts:150`); the deleted-target fallback calls `createContent` directly (`:289`). The pack fallback calls `commitNoClobber` directly (`PC/agent-pack-download.service.ts:553`). Neither fallback reacquires the same key.

The mutex appends an independent, non-rejecting release promise before awaiting the previous holder (`PC/utils/destination-write-lock.ts:57`). It awaits the callback at `:66`, releases in `finally` at `:68`, and removes an idle queue at `:70`. A thrown/rejected callback cannot poison the next holder's tail. Unit coverage exercises FIFO ordering, independent destinations, rejection release and a queued successor at `PC/utils/destination-write-lock.spec.ts:31`, `:58`, `:80`, and `:96`.

### 4. Same-baseline replacement specs — satisfied, with stated evidence limits

- **Wizard/wizard:** `AG/file-writer.service.spec.ts:476` creates two service instances over one filesystem. `holdReads` captures the actual initial read result before pausing (`:387`, `:393`). Both matching baseline reads are released together at `:494`. Assertions require exactly one `written`, one `changed-since-preview` (`:499`), exactly one `writeFile` (`:507`), and winner bytes (`:508`). This directly counts the destination mutation.
- **Pack/pack:** `PC/agent-pack-download.service.spec.ts:912` uses two service instances, so the old per-instance directory queue cannot explain success (`:918`). The barrier holds both initial reads and releases them together (`:939`). Assertions require the two distinct outcomes (`:948`), winner bytes (`:950`), and no remaining temporary sibling (`:951`). This verifies one successful destination replacement; it does not count staging writes or directly spy on rename. The reviewed implementation returns `written` only after a successful publication (`PC/agent-pack-download.service.ts:561`).
- **Wizard/pack:** `AG/file-writer.shared-lock.spec.ts:124` uses real disk and distinct incoming payloads. An external holder occupies the exported singleton (`:128`); the test waits for three holders/waiters at `:149` before releasing it. With a private lock or a missing acquisition in either writer, that condition cannot be reached. Assertions require one winner and one stale-baseline result (`:160`), winner bytes (`:165`), no temp files (`:166`), and an empty lock queue (`:167`). The sequential follow-up at `:170` is supplementary, not the concurrency proof.

The lock unit test named “exports one shared process-wide instance” only checks `instanceof` (`PC/utils/destination-write-lock.spec.ts:162`); it alone would not prove shared identity. The mixed-writer barrier and host resolution evidence above supply that missing proof. The pack-only test does not force both final reads to overlap in a hypothetical implementation without the lock; the mixed-writer queue barrier is the decisive acquisition check. Specs were inspected, not executed in this re-review.

## Five logic questions

1. **How can failure look successful?** The reported A2 case—both same-baseline replacements reporting success while losing the first result—is closed by the lock around wizard `:287`/`:306` and downloader `:551`/`:561`. No new silent-success path was found in the extracted `commitItem` logic (`PC/agent-pack-download.service.ts:366`).
2. **What user action produces unexpected behavior?** Overlapping wizard and pack replacements now preserve one winner and return a stale-baseline outcome to the other, as asserted at `AG/file-writer.shared-lock.spec.ts:160`. External editor/process writes still can race after the final read; this is explicitly documented at wizard `:278` and downloader `:539`, and is outside the accepted in-process guarantee.
3. **What input can yield a wrong answer?** Lock keys resolve lexical path segments and fold Windows case (`PC/utils/destination-write-lock.ts:29`). They do not establish filesystem-object identity across symlink aliases or all case-insensitive non-Windows volumes. The reviewed same-destination guarantee is for matching normalized keys; the specs do not certify arbitrary filesystem aliases. No new malformed-data regression was identified in this diff.
4. **What happens when a dependency fails or stalls?** Settled filesystem failures release the lock in `finally` (`PC/utils/destination-write-lock.ts:67`); wizard write errors become an error result (`AG/file-writer.service.ts:307`), and pack commit errors become `failed` (`PC/agent-pack-download.service.ts:357`). A filesystem promise that never settles retains its destination lock (`PC/utils/destination-write-lock.ts:66`); there is no timeout/cancellation contract here. Network fetching occurs outside this write lock (`PC/agent-pack-download.service.ts:430`).
5. **What is missing from the requirements?** Cross-process exclusion, filesystem alias identity, cancellation of stalled filesystem operations, and crash-atomic wizard replacement are not established by this mutex (`PC/utils/destination-write-lock.ts:29`, `:66`; `AG/file-writer.service.ts:306`). These limits are not reopened as new Blocking/Serious findings in this narrowly requested A2 completion review.

## Verification and decisions

Read the changed production files and specs in full, including the barrel export, and traced both commit paths and their failure exits. Consulted the task context, requested behavior, relevant plan text, prior A2 finding/re-review, P2 style review and completion report. No style findings are duplicated.

Scoped `ptah_get_diagnostics` for the lock and the two writers returned TypeScript compiler diagnostics with **0 errors, 0 warnings; coverage clean**. No tests, builds, installs or git operations were run. The completion report's earlier “68 tasks succeeded” is author-supplied evidence, not a run performed here; it also records formatting after that run. `ptah_code_search_symbols` returned zero hits with an empty index, so a native `rg` fallback located lock uses.

Decision: accept A2 closure for coordinated replacements by these two writers within each configured host process. Alternative: retain the blocker until runtime host-bundle verification. Evidence: one exported instance, host aliases to one source module, both complete critical sections inside it, and the mixed-writer queue barrier. Reversible if host packaging or a new writer introduces a second module/lock or bypasses acquisition. No scope expansion or source change was made.

The **8/10** score reflects a sound, bounded fix with inspectable concurrency tests. It is above the 5–6 band because the original lost-update gap is closed and release/error paths are handled; below 9–10 because packaged-host identity was not exercised, pack mutation counts are indirect, and alias/stalled-I/O behavior is not covered by these tests.

Verdict: APPROVED — 8/10

