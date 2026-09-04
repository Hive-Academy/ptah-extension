# Batch 4 implementation report — TASK_2026_306 (defects D, E)

**Branch**: `ak/boot-blocker-quota-gate` (not switched, not committed — team-leader owns the commit)
**Tasks**: 4.1 ✅ · 4.2 ✅ · 4.3 ✅ (zero host edits needed; one stale comment corrected)

---

## Summary of what changed

| File                                                                                      | Task | Nature        |
| ----------------------------------------------------------------------------------------- | ---- | ------------- |
| `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`      | 4.1  | behaviour     |
| `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.spec.ts` | 4.1  | +10 cases     |
| `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts`                    | 4.2  | new API       |
| `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.spec.ts`               | 4.2  | +5 cases      |
| `libs/backend/task-specs/src/lib/di/start-index.ts`                                       | 4.2  | behaviour     |
| `libs/backend/task-specs/src/lib/di/start-index.spec.ts`                                  | 4.2  | +5 cases      |
| `libs/backend/task-specs/src/lib/task-index.service.ts`                                   | 4.2  | comments only |
| `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`                                  | 4.3  | comments only |

`git diff --stat`: 8 files, 728 insertions, 52 deletions.
`git diff -U0 -- '*.spec.ts' | grep '^-'` → **empty**. No existing spec line was removed or altered;
every spec change is purely additive except three constructor call sites that gained a seventh
argument (below).

---

## Task 4.1 — one `ENOENT` no longer aborts the whole workspace index

### What changed

Two module-level additions in `workspace-indexer.service.ts`:

- `MISSING_ENTRY_CODES` — `ENOENT`, `ENOTDIR`, `ELOOP`.
- `isMissingEntryError(error: unknown)` — walks the `cause` chain (bounded at depth 5) looking for
  a string `code` in that set.

Two instance additions:

- `statOrNull(filePath)` — the `try` / return-`null` wrapper. Codes outside the set still `throw`.
- `reportSkipped(operation, workspaceFolder, skipped, discovered)` — one `logger.warn` per run,
  suppressed when `skipped === 0`.

Both loops now use it: `indexWorkspaceStream` (the reported site) **and** `indexWorkspace`.

### Deviations from the literal brief — stated up front

1. **I fixed the non-streaming sibling too.** The brief scoped 4.1 to the `for` loop at `:232-274`.
   The identical unguarded `stat` sat in `indexWorkspace` at the old `:155`, in the same class, with
   three live production callers (`code-quality-assessment.service.ts:275`,
   `analysis-namespace.builders.ts:97,229,261`, `code-namespace.builder.ts:185`). Leaving it would
   have meant shipping the same crash under a different method name. One shared helper, two call
   sites — no second policy invented.

2. **The class gained a seventh constructor parameter** (`@inject(TOKENS.LOGGER) logger: Logger`).
   This was the only way to satisfy "surface the skipped count": a generator's `return` value is
   discarded by `for await`, and `FileIndex` has no field for it. Every production resolution is
   through the container (`di/register.ts:114-117`, `registerSingleton`), so the only affected call
   sites were the three direct `new WorkspaceIndexerService(...)` in the spec, which each gained a
   mock. **No assertion changed.**

3. **Three codes, not one.** `ENOTDIR` (an ancestor replaced by a file mid-scan) and `ELOOP` (a
   symlink cycle) are the same failure class as `ENOENT` — "this path does not resolve to a file" —
   and are equally per-entry. `EACCES` / `EMFILE` / `EIO` are deliberately **not** in the set: those
   describe the environment, not the entry, and aborting is the honest outcome. This is documented in
   the constant's docblock and pinned by a spec case.

### Reviewer checkpoints

- **Narrows on the code, not the message.** `FileSystemService.stat()` throws a `FileSystemError`
  whose message is always the fixed string `Failed to stat: <path>`; the errno lives only on the
  wrapped cause (`services/file-system.service.ts:69-78`). The spec's `statError()` helper builds
  exactly that wrapped shape, and one case asserts that an error whose _message_ contains `ENOENT`
  but which carries no `code` still propagates.
- **The stream summary is in a `finally`.** `WorkspaceFileIndexService.build` `return`s out of its
  `for await` on a workspace-root change, closing the generator early. A trailing statement would
  have silently dropped the count on exactly that path.

---

## Task 4.2 — remedy chosen: **subscribe to connection-open**, implemented lib-side

### The choice, and why

`SqliteConnectionService` gained `onDidOpen(listener): { dispose() }`, fired once on a successful
open-and-migrate. `startTaskSpecsIndex` subscribes to it and calls its existing `warm()` again.

I picked this over "move the call after `openAndMigrate`" for three reasons:

1. **"Move the call" is not one remedy — it is two, in two different libs.** The two affected hosts
   open the connection from different places: Electron via `thoth-runtime/boot-thoth-runtime.ts:76`
   (reached from `wire-runtime.ts:373 → :145`), the CLI via
   `cli-engine/src/lib/bootstrap/thoth-runtime.ts:143` (`activateThoth`). Relocating the warm-up
   means one edit in `apps/ptah-electron` and another in `libs/backend/cli-engine`, at boot points
   that are reordered often — and the failure mode of getting it wrong is a silent lost write, which
   is how this defect survived in the first place.
2. **It is what the helper was built for.** `start-index.ts`'s own docblock already argues the case:
   _"ONE helper rather than three copies, because all three hosts need the same three guarantees and
   getting any of them wrong is silent."_ Guarantee 3 is already "re-attempt when the workspace
   appears", subscribed via `onDidChangeWorkspaceFolders`. Persistence-comes-online is the same
   shape of problem with a second signal; it is now guarantee 4, using the same mechanism and the
   same disposable.
3. **The signal belongs to the connection.** Registration and opening are deliberately separated —
   `registerPersistenceSqliteServices`'s own docblock says the connection "is opened lazily via a
   later `openAndMigrate()` call by the host". That separation had no announcement, so every
   consumer registered in the gap could only learn about the transition by writing and failing.
   `onDidOpen` is the missing edge, added by the lifecycle owner.

**Cost of the choice, stated plainly**: it grew `persistence-sqlite`'s public API. That is a
foundation lib and I did not take it lightly. The addition is ~50 lines, one concern, zero new
dependencies (a plain `Set<() => void>`, no `createEvent` import), and no change to any existing
path. `task-specs` already depended on `persistence-sqlite` (`di/register.ts:18`), so no new
Nx dependency edge was created.

### Contract of `onDidOpen` (documented on the method)

- Fires only on a **transition** to open, after migrations succeed.
- Does **not** fire on the already-open early return, and does not fire on a failed open.
- Fires again on a reopen (the database-reset RPC at `persistence-rpc.handlers.ts:453`), so
  subscribers must be idempotent — `ensureStarted` is.
- Does **not** fire for a subscriber that arrives when the connection is already open. It answers
  "tell me when it changes", not "tell me the current state"; late subscribers check `isOpen`.
- A throwing listener is caught, logged and swallowed. One bad subscriber cannot fail the open.

### Constraints the brief called out — how each is met

- **No new `await` on the boot path.** `startTaskSpecsIndex` still returns synchronously; `warm()`
  is still `void Promise.resolve().then(...)`; the `onDidOpen` callback is a plain `() => warm()`.
  Nothing in `openAndMigrate` awaits a listener. Verified by the pre-existing
  "does not block activation on the scan" case, which still passes.
- **The recovery latch survives.** `task-index.service.ts:181`'s `state.started = false` un-latch is
  untouched — it is precisely what makes the second `ensureStarted` do real work instead of joining
  a hollow first pass. Its comment now says so explicitly, and says not to remove it.
- **Stale comments updated, not left contradicting the code.** Both `task-index.service.ts:175-181`
  (the un-latch rationale) and `:499-502` (the WARN rationale) now describe the post-fix ordering
  and name what the latch still covers.

---

## Task 4.3 — what I found in the other two hosts

I verified each host before touching anything. The result is **zero host edits**.

| Host                   | Store selected                                                                                             | SQLite open point                                                 | Affected?                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| **Electron**           | `SqliteTaskIndexStore` (registered at `phase-2-libraries.ts:297`, warm-up at `:332`)                       | `boot-thoth-runtime.ts:76`, via `wire-runtime.ts:373 → :145`      | **YES** — the reported defect                |
| **CLI (`cli-engine`)** | `SqliteTaskIndexStore` (registered at `register-thoth-libraries.ts:81`, warm-up at `:130` — same function) | `bootstrap/thoth-runtime.ts:143` (`activateThoth`), a later phase | **YES** — same shape, previously unconfirmed |
| **VS Code**            | `InMemoryTaskIndexStore`                                                                                   | never — the connection is never registered                        | **NO**                                       |

### The VS Code finding, and a stale comment corrected

`apps/ptah-extension-vscode` **never calls `registerPersistenceSqliteServices`**. A repo-wide grep
finds exactly two callers: `apps/ptah-electron/src/di/phase-2-libraries.ts:297` and
`libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:81` — and `cli-engine` is
structurally off-limits to the VS Code app (the Thoth-free invariant, lint-enforced per
`cli-engine/CLAUDE.md`). `wire-runtime.ts:194-197` _reads_ `PERSISTENCE_TOKENS.SQLITE_CONNECTION`
behind an `isRegistered` guard that is therefore always false.

So the `instanceCachingFactory` in `task-specs/src/lib/di/register.ts:73-79` always picks
`InMemoryTaskIndexStore` in VS Code. That store needs no open step, so the activation warm-up writes
successfully on its first attempt and defect E cannot occur there.

The comment at `phase-2-libraries.ts:74-78` claimed the opposite — _"VS Code registers the
connection later in wire-runtime"_. It is wrong and would have sent the next reader hunting for a
registration that does not exist. I corrected it in place and recorded why, along with a note that
this call site needs no change because the remedy is lib-side. **That file's diff is comments only.**

Both affected hosts are covered by the single `start-index.ts` change. No host got a bespoke remedy.

---

## Test coverage

**20 new cases across 3 spec files. 14 of the 20 fail against pre-fix source.**

Mutation method: I reverted only the _behavioural_ line(s) in each of the three source files
(restoring the unguarded `stat` in both loops; deleting the `subscribeToPersistenceOpen` push;
deleting the `fireDidOpen()` call), leaving signatures intact so the specs still compiled — a
whole-file revert would have broken compilation and inflated the count to a meaningless 61.
The `.bak` files were restored afterwards and the full suite re-run green.

### `workspace-indexer.service.spec.ts` — 13 → 23 cases (**+10**, 7 fail pre-fix)

New describe: `per-entry stat failures (TASK_2026_306 defect D)`.

Fail against pre-fix source (7):

1. yields every other entry when one is unstatable
2. yields nothing, without throwing, when every entry is unstatable
3. counts the skips and surfaces them once per run (`skipped: 2, discovered: 3`)
4. treats an **ENOENT** entry as a skip
5. treats an **ENOTDIR** entry as a skip
6. treats an **ELOOP** entry as a skip
7. applies the same skip to the non-streaming `indexWorkspace` sibling

Pass either way — regression guards on constraints the fix promised to preserve (3):

8. stays silent when nothing was skipped (no warn spam on a clean workspace)
9. still propagates a stat failure that is not about the entry (`EACCES`)
10. narrows on the wrapped code, never on the message text

I am flagging 8–10 as guards rather than counting them as proof of the fix. They are not padding —
9 and 10 are the two ways this fix could have been written wrong — but they would pass on unfixed
source and it would be dishonest to present them otherwise.

### `start-index.spec.ts` — 8 → 13 cases (**+5**, 4 fail pre-fix)

New describe: `re-warms when persistence comes online (TASK_2026_306 defect E)`.

Fail against pre-fix source (4):

1. warms again once the connection opens
2. warms again on a REOPEN, not only the first open
3. survives a connection that refuses the subscription
4. unsubscribes from the connection when disposed

Passes either way (1):

5. is a no-op on a host that registers no connection (VS Code) — asserts one warm and **no**
   `logger.warn`, i.e. an absent connection is normal, not a degradation.

The harness gained an optional `connection: 'present' | 'throwing'` and a `fireConnectionOpen()`;
the default is no connection, which is the VS Code shape, so every pre-existing case is untouched.

### `sqlite-connection.service.spec.ts` — 28 → 33 cases (**+5**, 3 fail pre-fix)

New describe: `onDidOpen`.

Fail against pre-fix source (3):

1. fires once the connection is open and migrated (and asserts `isOpen === true` _inside_ the
   listener, i.e. it fires after migrations, not before)
2. does not fire on the already-open no-op call
3. survives a throwing listener without failing the open

Pass either way — contract guards, since a never-firing event trivially satisfies them (2):

4. does not fire for a subscriber that arrives after the open
5. stops firing after dispose

### Specs the brief named as "must keep passing"

- `workspace-file-index.service.spec.ts` — passes, unmodified.
- `task-index.service.spec.ts` — passes, unmodified.
- `task-index.store.spec.ts` — passes, unmodified.

Nothing forced a change to an existing assertion, so there was nothing to stop and report on that
front.

### 4.2 / 4.3 host wiring — not contorted into specs

Because I chose the lib-side remedy, the ordering fix _is_ unit-testable and is covered above at the
`start-index` and `SqliteConnectionService` level. What remains untestable in a unit spec — that
Electron's and the CLI's real boot sequences register the connection before this helper runs — I
verified by reading the call sites (table in Task 4.3) rather than by writing a spec around a host
bootstrap. No spec was contorted to reach a host.

---

## Verification output

```
npx nx run-many -t test -p workspace-intelligence,task-specs,cli-engine,persistence-sqlite --skip-nx-cache
  workspace-intelligence  36 suites,  896 passed / 896
  task-specs              16 suites,  429 passed, 23 skipped / 452
  persistence-sqlite      20 of 28 suites (8 skipped: real-native-binary),
                                      197 passed, 69 skipped / 266
  cli-engine              15 suites,  145 passed / 145
  → Successfully ran target test for 4 projects

npx nx run-many -t lint -p workspace-intelligence,task-specs,cli-engine,persistence-sqlite,ptah-extension-vscode --skip-nx-cache
  → Successfully ran target lint for 5 projects.  0 errors.
    Warnings are all pre-existing kinds (no-empty-function / no-unused-vars) in files I did not touch.

npx nx affected --target=lint --max-warnings=-1        # the pre-commit gate
  → Successfully ran target lint for 29 projects.  0 errors across the whole affected set.
    Run explicitly because touching persistence-sqlite widens the affected set the way
    Batch 3's blocked commit did. No @nx/dependency-checks failure this time.

npx nx run-many -t typecheck -p cli-engine,task-specs,persistence-sqlite,workspace-intelligence
  → Successfully ran target typecheck for 4 projects

npx nx run-many -t build -p ptah-electron,ptah-extension-vscode --skip-nx-cache
  → Successfully ran target build for 2 projects and 34 tasks they depend on

npx prettier --check <all 8 changed files>
  → clean (one file needed --write during development; re-checked clean)
```

---

## Acceptance criteria — honest status

| Criterion (Batch 4)                                                                                               | Status                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Broken symlink / deleted-mid-scan produces a complete index minus that entry, skip counted and visible            | ⏳ Proven at spec level (both cases, plus `ELOOP`). Not run against a real workspace with a real broken link.     |
| `[WARN] [task-specs] index rebuild write failed: Persistence is offline` does not appear on a clean Electron boot | ⚠️ **NOT satisfied as literally written — read this section**                                                     |
| `[Ptah Electron] WorkspaceFileIndex.start failed (non-fatal)` does not appear for a single-entry `ENOENT`         | ⏳ Proven at spec level. Not observed in a real boot log.                                                         |
| All three hosts either fixed or explicitly verified as not affected                                               | ✅ Table in Task 4.3. Electron + CLI fixed lib-side; VS Code verified unaffected and its stale comment corrected. |
| `startTaskSpecsIndex` still fire-and-forget, no new `await` on the boot path                                      | ✅                                                                                                                |
| The `ensureStarted` retry latch at `task-index.service.ts:181` survives                                           | ✅ Preserved and its docblock strengthened.                                                                       |
| One remedy across hosts, not three                                                                                | ✅ One lib-side change; zero host edits.                                                                          |

### The one I did not satisfy, and why

**The `Persistence is offline` WARN will still appear once on a clean Electron and CLI boot.**

My remedy makes the _second_ warm-up succeed; it does not stop the _first_ one from being attempted
too early. The sequence after the fix is: activation warm-up runs → store write fails → WARN → latch
un-set → `openAndMigrate` completes → `onDidOpen` fires → second warm-up runs → index written. The
defect's _consequence_ (the index silently lost for the whole session) is closed. The _log line_ is
not.

I considered deferring the first warm-up entirely when a connection is registered but not yet open,
which would satisfy the criterion literally. **I rejected it**, and I want that decision reviewed
rather than assumed:

- The initial warm-up does two things — the index rebuild **and** `ensureSpecsReadme`. The README is
  guarantee 1 of the whole helper (it is the only channel that states the carrier contract to a
  user). Gating it on `onDidOpen` means that on a host where `openAndMigrate` genuinely **fails** —
  ABI mismatch and missing native module are documented, real failure modes in
  `persistence-sqlite/CLAUDE.md` — the event never fires and `.ptah/specs/README.md` never lands.
  Trading a permanent lost README for a removed log line is a bad trade.
- The alternatives that keep the README (a `quiet` flag through `rebuild`, or an
  `isReady()` predicate on `ITaskIndexStore`) are respectively "hide a genuine failure" and "a
  contract change across both store implementations" — both larger than this task, and the second is
  a reasonable follow-up rather than something to slip in here.

**Recommendation**: accept the residual WARN for now and, if the noise matters, file a follow-up to
add `ITaskIndexStore.isReady()` so `rebuild` can skip the write and log at `debug` when the store is
known-unavailable. I have left the WARN's docblock at `task-index.service.ts` accurate about this —
it now says a clean boot "should not reach this branch" for the _index-is-lost_ reason and names the
paths that still can.

### Not attempted

No `nx serve ptah-electron` cold start was run, so the three ⏳ criteria above remain unobserved in a
real boot log — same posture Batch 3 recorded. All three lines appear early in the output; one cold
start closes them.

---

## What the reviewer should check

1. `isMissingEntryError` reads `code`, never the message — and the `EACCES` and
   "ENOENT-in-text-only" spec cases prove it does not over-swallow.
2. `reportSkipped` for the stream is in a `finally`, so an early-`return`ing consumer still gets the
   count.
3. `startTaskSpecsIndex` returns synchronously; nothing on any boot path awaits `warm()` or a
   listener.
4. `task-index.service.ts:181`'s un-latch is intact — it is what makes the `onDidOpen` re-warm do
   real work.
5. `fireDidOpen()` sits after the `openAndMigrate` success log and inside the `try`, but cannot throw
   (each listener is individually guarded), so it cannot be mistaken for a migration failure.
6. `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` is a comments-only diff.
