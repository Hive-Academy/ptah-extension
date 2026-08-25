# Task 4.4 — Silence the predictable offline write via `ITaskIndexStore.isReady()`

**Closes**: the one Batch 4 acceptance criterion left unmet — `[WARN] [task-specs] index
rebuild write failed: "Persistence is offline: SQLite connection has not been initialized
yet."` on every clean Electron/CLI boot.

**Branch**: `ak/boot-blocker-quota-gate`. Nothing committed, no branch created or switched.

---

## What changed

Three source files, two spec files. 39 net source lines (the bulk of them comments), 11 new
spec cases.

### 1. `libs/backend/task-specs/src/lib/task-index.store.ts`

- `ITaskIndexStore` gains `isReady(): boolean`, with a docblock stating what it is for and —
  more importantly — what it is _not_: a point-in-time answer, not a promise. A store may
  report `true` and still fail, and that failure is genuine and still warns.
- `SqliteTaskIndexStore.isReady()` → `return this.connection.isOpen;`. Forwarded, never
  cached: `openAndMigrate` runs hundreds of log lines after the store is constructed, so a
  constructor snapshot would be permanently `false` and the index would never be written at
  all. One of the new store cases pins exactly that.
- `InMemoryTaskIndexStore.isReady()` → `return true;`. A Map is writable from construction;
  there is no transition to wait for, and reporting anything else would make the VS Code host
  skip writes it can perform perfectly well.

### 2. `libs/backend/task-specs/src/lib/task-index.service.ts` — `rebuild`

The scan, `state.specsDirExists`, `ensureSpecsReadme` and the emit are all untouched. Only the
write is now conditional:

- `!this.store.isReady()` → skip `replaceWorkspace`, set `indexWritten = false`, log at
  **`debug`**.
- otherwise → the **existing** `try`/`catch` around `replaceWorkspace`, unchanged, still
  warning on failure.

The `ensureStarted` recovery latch at `:186` is byte-identical — `indexWritten: false` still
un-latches `state.started`, which is what makes the `onDidOpen` re-warm do real work.

### 3. `libs/backend/task-specs/src/lib/di/start-index.ts` — comments only

Two comments described the pre-4.4 behaviour and would have been wrong the moment this landed:

- the header's point 4 said the first attempt's "`replaceWorkspace` write hits an offline store
  and is lost" → it is now skipped rather than attempted;
- `subscribeToPersistenceOpen` said the latch fires "when the index write failed" → it fires
  when the index was **not written**, which now covers two routes (skipped-as-offline, or
  attempted-and-failed).

Also removed the stale line-number reference (`task-index.service.ts:181`) rather than
re-pointing it, since it had already drifted by five lines.

### Comment accuracy

The Batch 4 comment inside the `catch` — the one the team-leader corrected because a clean boot
_would_ reach that branch once — is gone. What replaced it makes a claim that is now true and
is proven below: reaching the `catch` means a store that reported READY failed anyway. The
skip branch carries the "why DEBUG not WARN" reasoning, and explicitly records that only the
write is skipped and why that keeps the README free.

---

## Spec-case counts, and how many fail against the pre-4.4 tree

**11 new cases**: 7 in `task-index.service.spec.ts`, 4 in `task-index.store.spec.ts`.
`task-specs` goes from 452 to 463 total (440 passed / 23 skipped — the 23 are the
`better-sqlite3` native suites this environment skips, unchanged from before).

**No existing assertion was touched.** `git diff -U0 -- '*.spec.ts'` contains exactly one
removed line, and it is an `import` statement widened to also pull in `type ITaskIndexStore`.

### Mutation check — service (7 cases)

Reverting the guard to the pre-4.4 shape (`if (false)`, keeping `isReady` on the store so the
spec still compiles) — **3 of 7 fail**:

| Case                                                                   | Pre-4.4  |
| ---------------------------------------------------------------------- | -------- |
| skips the write ENTIRELY when the store is not ready                   | **FAIL** |
| emits no WARN at all on the too-early first warm-up                    | **FAIL** |
| performs the real rebuild once the store reports ready                 | **FAIL** |
| still writes the specs README when the store is not ready              | pass     |
| still records specsDirExists from the scan when the store is not ready | pass     |
| writes without a skip log when the store is ready from the start       | pass     |
| still WARNs when a store that reported READY fails the write anyway    | pass     |

The 4 that pass either way are **deliberate regression guards on properties 4.4 promised to
PRESERVE**, and they are the reason this fix was chosen over deferring the warm-up: the README
must still land, `specsDirExists` must still be set from the scan, the ready path must be
unchanged, and the warn channel must survive. A guard that only worked in one direction would
be worthless here. They are not padding, but they are also not evidence the fix works — the
three above are.

### Mutation check — store (4 cases)

The literal pre-4.4 tree has no `isReady` at all, so these cases do not compile against it;
there is no honest "how many fail" number for that comparison and I am not inventing one.
Against the plausible wrong implementation instead (`SqliteTaskIndexStore.isReady()` hardcoded
to `true`) — **2 of 4 fail**:

| Case                                                              | Always-true impl |
| ----------------------------------------------------------------- | ---------------- |
| is false while the SQLite connection has not opened               | **FAIL**         |
| tracks the connection rather than snapshotting it at construction | **FAIL**         |
| is true once the SQLite connection is open                        | pass             |
| is unconditionally true for the in-memory store                   | pass             |

The two store cases that need no native module do so on purpose: `isReady` reads
`connection.isOpen` and never touches `db`, so the fake connection in those cases has **no
`db` property at all** — reaching for one would be the bug.

---

## Can the `Persistence is offline` WARN still fire on a clean boot?

**No, and this is a proof rather than an observation.**

That message has exactly one producer: `SqliteConnectionService`'s `db` getter
(`sqlite-connection.service.ts:347-355`), which throws when `!this.database || !this.database.open`.
`isOpen` (`:435-437`) is `Boolean(this.database?.open)` — the exact negation of the same
two-term predicate. So `isReady() === true` ⟺ the `db` getter does not throw
`Persistence is offline`.

`SqliteTaskIndexStore.replaceWorkspace` reaches `db` on its first statement, and it is only
called when `isReady()` returned `true`. The check-then-act window is closed by construction:
`isReady()` and `replaceWorkspace()` are both synchronous and adjacent inside `rebuild`, with
no `await` between them, so nothing can close the connection in between on a single thread.

The remaining `WARN` is therefore reachable only from a store that reported open and then
failed for some other reason — `SQLITE_FULL`, a corrupt page, a connection closed by the reset
RPC on a later rebuild. That is the unpredicted class the channel exists for, and the last
spec case pins it.

**What replaces it on a clean boot**: one `DEBUG` line,
`[task-specs] index rebuild write skipped — store not ready yet`, followed moments later by the
real rebuild once `onDidOpen` fires. The README still lands on the first warm-up, including on
a host where `openAndMigrate` never succeeds at all (ABI mismatch, missing native binary) —
which is precisely the trade the rejected alternative would have lost.

---

## Verification

All three commands run as `run-many` with explicit `-p`, as specified.

```
npx nx run-many -t test -p task-specs,persistence-sqlite,cli-engine
  task-specs          16/16 suites   440 passed,  23 skipped, 463 total
  persistence-sqlite  20/28 suites   197 passed,  69 skipped, 266 total   (8 native suites skipped)
  cli-engine          15/15 suites   145 passed,             145 total
  NX  Successfully ran target test for 3 projects

npx nx run-many -t lint -p task-specs,persistence-sqlite
  task-specs          0 errors, 1 warning
  persistence-sqlite  clean
  NX  Successfully ran target lint for 2 projects

npx nx run-many -t build -p ptah-electron,ptah-extension-vscode
  NX  Successfully ran target build for 2 projects and 34 tasks they depend on
```

The single lint warning is `'MockFileSystemProvider' is defined but never used` in a file this
task does not touch. **Proven pre-existing**: stashing every change and re-running
`nx lint task-specs --skip-nx-cache` reproduces it identically.

Additionally, unprompted but cheap insurance — `rpc-handlers` is the one out-of-lib consumer
that passes `ITaskIndexStore` around in its own specs:

```
npx nx test rpc-handlers    87/87 suites   2407 passed, 31 skipped, 2438 total
```

The skipped counts in `persistence-sqlite` and `task-specs` are the known `better-sqlite3`
`NODE_MODULE_VERSION` mismatch in this environment (`143 vs 137`), documented in the store
spec's own header and unchanged by this task.

---

## One thing the reviewer should know about the working tree

Two files were **already modified and uncommitted** when this task started, and are not mine:

- `apps/ptah-electron/src/activation/plugin-activation.ts` (+59)
- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts` (+22)

They look like in-progress Batch 5 / defect F work (the `14/27` vs `106/119` denominator
mismatch). I did not touch, revert or stage them. I did briefly `git stash`/`git stash pop` the
whole tree while proving the lint warning pre-existing — both files came back intact and
`git status` confirms it — but flagging it since it moved files I do not own.

## Files changed

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.store.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.service.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\di\start-index.ts` (comments only)
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.service.spec.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.store.spec.ts`
