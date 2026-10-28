# P2 A2 completion report: shared destination lock for Ptah writers

Finding: A2 replacement race (`reviews/p2-fix-rereview.md`, "Remaining original blocker").
Worktree: `.claude-worktrees/wizard-library-alignment` (HEAD dcbfee9ac, uncommitted).

## What changed

Paths are relative to the worktree.

| File | Change |
| --- | --- |
| `libs/backend/platform-core/src/utils/destination-write-lock.ts` (new) | `destinationLockKey(path)` (:29) resolves to an absolute path and case-folds on win32. `DestinationWriteLock` (:46) is a FIFO async mutex per key. `run()` releases in `finally`, so a holder that throws or rejects still hands the key to the next waiter. A key is removed once its last holder ends. `pendingCount()` exists for tests and diagnostics. `destinationWriteLock` (:88) is the single shared instance for the module. The header documents the scope: it coordinates Ptah writers within one process, it does not cover editors or other processes, and it is not reentrant. |
| `libs/backend/platform-core/src/index.ts:226-230` | Exports `DestinationWriteLock`, `destinationLockKey` and `destinationWriteLock` through the public barrel. |
| `libs/backend/platform-core/src/agent-pack-download.service.ts` | Imports at :44-47. The duplicate `canonicalDirKey` is deleted, and the per-directory queue now uses `destinationLockKey` (:292). `installOne` runs its mutation inside `destinationWriteLock.run(destPath, …)` (:352). That covers both the no-clobber create path and `replaceIfBaseline`, whose baseline re-read and rename now happen under the lock. The mutation moved into the new `commitItem` (:364). The header (:16-26) and `replaceIfBaseline` doc (~:531-540) now say that Ptah writers are coordinated. The external-process limitation stays documented ("Remaining guarantee", :537). |
| `libs/backend/agent-generation/src/lib/services/file-writer.service.ts` | Imports `destinationWriteLock` from `@ptah-extension/platform-core` (:19). In `writeAgent`, the final step (`createContent` or `replaceContent`, including the re-read in `replaceContent`) runs inside `destinationWriteLock.run(absolutePath, …)` (:150). The `writeAgent` step 5 doc and the `replaceContent` doc (:272-280) state that Ptah writers are coordinated and keep the external editor/process limitation. |

### Design notes

- **Lock home and dependency direction.** The lock lives in platform-core. agent-generation already imports `@ptah-extension/platform-core` values such as `PLATFORM_TOKENS`, so the dependency direction is unchanged and no new tag or edge was added.
- **Shared instance instead of DI.** `AgentPackDownloadService` is a decorator-free class constructed with `new` (many specs do this) and registered with `registerSingleton` (rpc-handlers). Injecting the lock would have changed its constructor and every construction site, and it would have needed registration in three adapters plus `expected-resolvable.ts`.
  - A module-level instance is the same object for every importer in one host process (Electron main, VS Code extension host, CLI), with no registration and no DI guard spec changes.
  - Reversible: the class is exported, so it can later be bound to a token.
- **No deadlock.** The lock is per file and is only taken innermost, after the initial read and guard check. No code waits on the pack's per-directory queue while holding the lock, and no holder takes the same key again. `replaceContent` falls back to `createContent` and `replaceIfBaseline` falls back to `commitNoClobber`; both run inside the one existing hold rather than acquiring the lock again.
- **What the lock covers.** The initial read and guard stay outside the lock, because the final re-read inside the lock decides the outcome. Create-only paths are inside the lock as well. They stay no-clobber (`wx` or link) against other processes.

## Specs

- `libs/backend/platform-core/src/utils/destination-write-lock.spec.ts` (unit spec for the lock):
  - `runs holders of one destination one after another, in arrival order`
  - `runs holders of different destinations concurrently`
  - `releases the destination when a holder throws or rejects`
  - `a waiter queued behind a failing holder still runs`
  - `treats differently spelled paths to one file as one destination`
  - `destinationLockKey › resolves relative segments to one absolute key`
  - `destinationLockKey › case-folds on win32 only`
  - `exports one shared process-wide instance`
- Wizard + wizard, in `libs/backend/agent-generation/src/lib/services/file-writer.service.spec.ts` (in-memory port):
  - `two replace writers with the same baseline: exactly one writes, the other is changed-since-preview`
  - Both initial reads are held, then released together so both guards pass.
  - It asserts one `written` and one `changed-since-preview`, exactly one `writeFile`, and that the file holds the winner's bytes.
- Pack + pack, in `libs/backend/platform-core/src/agent-pack-download.service.spec.ts` (mkdtemp root):
  - `two replace installers with the same baseline: exactly one writes, the other is changed-since-preview`
  - It uses two service instances, so their queues are separate and only the shared lock orders them.
- Wizard + pack through the shared lock, in the new file `libs/backend/agent-generation/src/lib/services/file-writer.shared-lock.spec.ts` (mkdtemp root, removed in `afterEach`; the wizard port delegates to real `fs/promises`):
  - `a wizard replace and a pack replace with the same baseline: exactly one writes`
    - An external holder keeps the shared lock until both writers have passed their guards and queued (the test waits for `pendingCount === 3`).
    - It asserts one `written` and one `changed-since-preview`, that the file holds the winner's bytes, that no temp files are left, and that the lock queue is empty.
    - If either writer did not take the shared lock, the queue would never reach 3 and the test would fail.
  - `wizard first: the pack replace that follows keeps the wizard bytes`

## Verification

Command, one foreground run, which was moved to the background at the 600 s tool limit and ran to completion:

```
npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers,ptah-cli,ptah-electron,ptah-extension-vscode,ptah-tui 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Running target|tasks:|✖|error TS|FAIL|●" | head -60
```

Filtered output:

```
 NX   68 tasks: 68 succeeded, 2 cached
```

The command exited with code 0. No `✖`, `error TS`, `FAIL` or `●` lines appeared. No other project was changed.

After the run, `prettier --write` was applied to the changed files. It changed whitespace and line wrapping only, including the wrapping of some existing long lines in the two touched spec files. The checks were not re-run after that formatting pass.

## Decisions

- **Lock form: a module-level shared instance in platform-core.** The alternatives were a DI singleton behind a `PLATFORM_TOKENS` entry, or a lock inside agent-generation. Evidence: `AgentPackDownloadService` is not decorator-injected, and agent-generation already depends on platform-core while the reverse is not allowed. Reversible: yes.
- **Lock scope: the final re-read and mutation only.** The alternative was to hold the lock for the whole `writeAgent` or `installOne`. The final in-lock re-read decides the outcome, so a shorter hold is enough and gives less contention. Reversible: yes.

## Out of scope

- `agent-pack-download.service.ts` still uses `console.warn` in `fetchPackInfo`. This predates this change and was not touched.
