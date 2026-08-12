# Batch 5 Implementation Report — TASK_2026_173 (B4, Watcher Exclusions)

**Executor**: `backend-developer` sub-agent
**Tasks**: 5.1, 5.2, 5.3 — all three implemented, in order
**Date**: 2026-08-10
**Decision honoured**: Task 5.0 **Option B** — `TREE_HIDDEN_DIRS ⊆ WATCH_IGNORED_DIRS`, two named sets, one shared predicate
**Verdict**: **COMPLETE. M3 target MET (0 invocations from excluded paths). B4 AC3 proved. All seven standing gates pass.**
**No git operations were performed.** Work is left in the working tree for the team-leader.

---

## 1. Files created / modified (absolute paths)

### Created

| Path                                                                                        | Purpose                                                                 |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\shared\src\lib\constants\workspace-scan.constants.ts`      | Task 5.1 — the two sets + the one predicate                             |
| `D:\projects\ptah-extension\libs\shared\src\lib\constants\workspace-scan.constants.spec.ts` | Task 5.1 — subset relation, R-9 guard, tree-visibility invariance proof |

### Modified

| Path                                                                                                  | Change                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\shared\src\index.ts`                                                 | +1 line barrel export (verified by `git diff`: exactly one added line, nothing else)        |
| `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.ts`                   | Task 5.2 — `watchWorkspaceRoot` uses the shared predicate via a one-line adapter            |
| `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.ts`      | Task 5.2 — `HIDDEN_SKIP` **deleted**; `buildFileTree` calls the shared predicate            |
| `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.spec.ts`              | Extended in place (not a parallel spec file); its hand-rolled copy of the predicate removed |
| `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\editor\perf-m3-watcher-churn.script.mjs` | Task 5.3 — harness copy of the exclusion list updated to the new set                        |
| `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md`                                | Task 5.3 — M3 after-figure **appended**; baseline untouched                                 |
| `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\tasks.md`                                       | Three status lines `🔄 IN PROGRESS` → `🔄 IMPLEMENTED`, via `Edit` on the exact lines       |

Scratch artifacts live **outside** the repository and were not committed anywhere:
`C:\temp\ptah-m3-scratch-after\` (measurement repo) and `C:\temp\m3-control-old-predicate.mjs` (paired control script).

---

## 2. The two sets, verbatim, and where `.angular` landed

```ts
export const TREE_HIDDEN_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn', // VCS metadata
  '.DS_Store',
  '.Trash', // OS / platform noise
  '.cache',
  '.tmp',
  '.temp', // generic caches and scratch
  '.nx', // tooling cache
  'node_modules',
  'dist', // dependency and output trees
]);

export const WATCH_IGNORED_DIRS: ReadonlySet<string> = new Set([...TREE_HIDDEN_DIRS, '.angular']);
```

- **`TREE_HIDDEN_DIRS` = 12 names** — the exact union of the two checks that stood in `editor-rpc.handlers.ts` before this batch: the nine-name `HIDDEN_SKIP` set plus the separate `node_modules`/`dist` test.
- **`WATCH_IGNORED_DIRS` = 13 names** — `TREE_HIDDEN_DIRS ∪ {'.angular'}`. `.angular` is **the only addition**, exactly as R-9 and the dispatch require.
- **`out`, `build`, `coverage`, `.next`, `.turbo` were NOT added.** A unit test asserts their absence from both sets so a future contributor cannot quietly add them.

**`.angular` placement — I concur with the dispatch's ruling and adopted it.** `.angular` goes in `WATCH_IGNORED_DIRS` only. It is not in today's `HIDDEN_SKIP`, so the tree renders it today; putting it in `TREE_HIDDEN_DIRS` would remove a directory the user can currently see — a visibility change, i.e. Option A by the back door. Excluding it from the watcher is safe on the other axis too: `.angular/` is gitignored, so `git status` can never report on it, and skipping it cannot cause a real change to be missed.

**The subset relation is expressed in code, not in a comment** — `WATCH_IGNORED_DIRS` is literally derived from `TREE_HIDDEN_DIRS`, so it cannot drift. Two unit tests lock it:

```
✓ TREE_HIDDEN_DIRS is a subset of WATCH_IGNORED_DIRS
✓ the watch set adds exactly one name beyond the tree set: .angular
```

---

## 3. The plan's false premise — checked myself, confirmed stale

The dispatch (§3) warned that `tasks.md` Task 5.0 and risk V-1 assert _"the watcher ignores `node_modules`/`dist` which the tree **SHOWS**"_. **I verified this independently and it is false.**

`editor-rpc.handlers.ts` skipped both before this batch, ungated by any dot check:

```ts
if (entry.name === 'node_modules' || entry.name === 'dist') {
  continue;
}
```

`git log -L 854,858:apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts` returns:

```
80d26911d 2026-05-21 Code purshing (#292)
2b537f44c 2026-05-15 chore(release): extension v0.2.32 (#290)
```

and the `80d26911d` hunk shows the `node_modules`/`dist` check as **context, not an addition** (only two comment lines were removed) — so the check is at least as old as `2b537f44c`, 2026-05-15. Either way it predates the plan. The tree has not shown `node_modules` or `dist` for months.

The genuine disagreement between the two consumers ran only in the _other_ direction: the tree hid `.git .hg .svn .DS_Store .Trash .cache .tmp .temp .nx` and the watcher did not.

### The real invariant, verified instead

Because the plan's stated success criterion is unverifiable, I verified the one the dispatch specified: **the set of directories the tree renders is byte-identical before and after.**

This is provable exhaustively rather than by inspection, because `buildFileTree`'s filter is a **pure function of `entry.name`** and is the only thing in that method I changed. So identical rendering ⟺ the old and new predicates agree on every possible name. The spec encodes the pre-batch-5 filter verbatim as a frozen oracle and asserts agreement across a 30-name corpus (every name in either legacy check, the dot-directories the tree deliberately still shows, ordinary source directories, prefix-collision traps, and the empty string):

```
✓ renders '.git' identically under old and new filters
✓ renders 'node_modules' identically under old and new filters
✓ renders '.angular' identically under old and new filters
✓ renders '.claude' identically under old and new filters
… 30 cases, all passing
✓ TREE_HIDDEN_DIRS is exactly the union of the two pre-batch-5 tree checks
```

**Result: tree visibility is unchanged. Option B satisfied; Option A not implemented.**

---

## 4. The three traps — all checked

### Trap 1 — the dedicated `.git` watchers were NOT touched ✅

The predicate is applied **only** inside `watchWorkspaceRoot`. `watchFile` (`.git/HEAD`, `.git/index`, `.git/packed-refs`, `.git/ORIG_HEAD`, `.git/FETCH_HEAD`) and `watchDirectory` (`.git/refs/`) are byte-identical to before — confirmed by reading both methods after the edit. A doc comment now states the invariant at the call site so a future editor cannot "helpfully" unify them.

Regression guard added to the spec:

```
✓ arms the dedicated .git watchers unfiltered (git ops still detected)
```

It asserts `watchers.length === 4` on a `.git` fixture (1 recursive root + HEAD + index + refs). A leak of the predicate into `watchFile`/`watchDirectory` would drop that to 1 and fail the test loudly.

### Trap 2 — the `startsWith('.')` gate did NOT survive ✅

The gate is **gone**, and `node_modules`/`dist` remain skipped. Proof that dropping it is a no-op rather than an assertion:

> All nine names in the legacy `HIDDEN_SKIP` set — `.git .hg .svn .DS_Store .Trash .cache .tmp .temp .nx` — begin with `.`. Therefore `entry.name.startsWith('.') && HIDDEN_SKIP.has(entry.name)` was logically identical to `HIDDEN_SKIP.has(entry.name)` for every possible input.

This is machine-checked rather than eyeballed:

```
✓ the dot gate was a no-op: every legacy HIDDEN_SKIP name starts with "."
```

Had I kept the gate while collapsing to one call, `node_modules` and `dist` (neither of which starts with `.`) would have reappeared in the tree. The 30-case invariance suite above would have caught it.

### Trap 3 — `HIDDEN_SKIP` deleted, not aliased ✅

The declaration is deleted outright. No `const HIDDEN_SKIP = TREE_HIDDEN_DIRS`, no re-export, no alias. Repo-wide grep for the identifier, excluding `.ptah/` planning docs:

```
apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.ts:849:  // test and the dot-gated `HIDDEN_SKIP` test — so tree visibility is
libs\shared\src\lib\constants\workspace-scan.constants.ts:38:  * and drifting, inside `editor-rpc.handlers.ts`: the nine-name `HIDDEN_SKIP`
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:8:   * The exact nine names that lived in `HIDDEN_SKIP` in
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:12:const LEGACY_HIDDEN_SKIP = new Set([
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:30:   * if (entry.name.startsWith('.') && HIDDEN_SKIP.has(entry.name)) continue;
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:40:  if (entryName.startsWith('.') && LEGACY_HIDDEN_SKIP.has(entryName)) {
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:66:        ...LEGACY_HIDDEN_SKIP,
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:96:      ...LEGACY_HIDDEN_SKIP,
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:131:    it('the dot gate was a no-op: every legacy HIDDEN_SKIP name starts with "."', () => {
libs\shared\src\lib\constants\workspace-scan.constants.spec.ts:132:      for (const name of LEGACY_HIDDEN_SKIP) {
```

**Zero occurrences in product code.** Two comment references (harmless, they document the migration) and one test-only symbol.

> ### ⚠️ FLAGGED FOR THE REVIEWER — `LEGACY_HIDDEN_SKIP` is a judgment call, please rule on it
>
> `workspace-scan.constants.spec.ts` contains `LEGACY_HIDDEN_SKIP`, a **frozen historical copy** of the nine names. I want this ruled on explicitly rather than discovered.
>
> **Why I believe it is not the "second hand-maintained list" AC2 forbids**: it lives in a spec, no product code can reach it, and it is not maintained — it is a snapshot of what the tree hid _before_ this batch, existing solely as the oracle for the visibility-invariance proof in §3 and for the "`TREE_HIDDEN_DIRS` is exactly the union" assertion. It makes drift **detectable**; removing it would remove the only executable evidence that tree visibility is unchanged, which is this batch's central claim. Its correct future behaviour is to stay frozen forever — if someone legitimately adds a name to `TREE_HIDDEN_DIRS` later, those two tests are _supposed_ to fail and force a deliberate decision.
>
> **If the reviewer disagrees**, the fix is to delete `LEGACY_HIDDEN_SKIP` and the two tests that consume it. I recommend against it, and I am not making that call unilaterally.

---

## 5. Task 5.2 — the intentional behavioural delta, in full

The watcher's exclusion changed along **two axes**. Both are stated plainly; the second is a judgment call I want reviewed.

### Axis 1 — more names (authorised, this is B4 AC1)

`watchWorkspaceRoot` previously excluded only `.git`, `node_modules/`, `dist/`. It now additionally drops events under:

| Newly-excluded | Reason                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `.nx/`         | the named M3 churner; the tree already hid it                          |
| `.angular/`    | the second named M3 churner; gitignored, so git can never report on it |
| `.cache/`      | tree already hid it                                                    |
| `.tmp/`        | tree already hid it                                                    |
| `.temp/`       | tree already hid it                                                    |
| `.hg/`         | tree already hid it                                                    |
| `.svn/`        | tree already hid it                                                    |
| `.Trash/`      | tree already hid it                                                    |
| `.DS_Store`    | tree already hid it                                                    |

Every one except `.angular` was already invisible in the file tree, so the watcher was scheduling `git status` for paths the user cannot even see.

### Axis 2 — segment-level instead of prefix-level ⚠️ FLAGGED

The old watcher predicate tested `filename.startsWith('node_modules/')`, so it matched **only at the workspace root**. The shared predicate tests **every path segment**, so `packages/foo/node_modules/bar/index.js` and `libs/shared/dist/index.js` are now excluded too.

**This is a widening beyond the literal "union of the two current lists" and was not explicitly authorised, so I am flagging it rather than burying it.** My reasoning for adopting it:

1. **It is what makes B4 AC2 true.** The tree builder has always been segment-level — `buildFileTree` recurses and applies the filter to _every_ directory's children at every depth, so a nested `node_modules` has never been rendered. A prefix-only watcher would have left the two consumers still disagreeing, which is the exact defect B4 exists to close.
2. **It cannot hide anything the user can see.** Every name matched at depth is already invisible in the file explorer, so consistency with tree visibility — Option B's governing rule — is preserved, not violated.
3. **Monorepo churn is mostly nested.** In this very repository the churn lives under `libs/*/dist` and `packages/*/node_modules`, not at the root.

R-9 risk of the widening is contained: a prefix-collision test asserts `distribution/`, `node_modules_backup/` and `src/distant.ts` are **not** matched, so only exact segment names are affected. If the reviewer judges Axis 2 out of scope, reverting it means changing the shared predicate to prefix-only for the watch policy — a change I would rather have directed than assume.

### B4 AC4 — user-opened ignored paths: verified, unchanged, and one pre-existing inconsistency reported

I checked what happens when a user explicitly reaches a path under an ignored directory, before and after:

- **`editor:openFile` / `file:open`** (`handleFileOpen`) — validates only that the path is inside the workspace. It applies **no** exclusion filter, so explicitly opening `node_modules/foo/index.js` succeeds and returns content. **I did not touch this method; behaviour is identical before and after.**
- **`editor:getFileTree` with an explicit `rootPath`** — `buildFileTree(root, 6)` filters the _children_ of `root` but never tests `root` itself. Pointing the tree directly at `node_modules` therefore lists its contents. **Identical before and after** — the filter sits in the same position in the same loop.
- **`editor:getDirectoryChildren`** — same shape, same conclusion.

**Pre-existing inconsistency, REPORTED NOT FIXED (NFR-9):** an explicitly-targeted ignored directory is enumerable even though the same directory is unreachable by navigation from the root. That asymmetry predates this batch and is arguably the correct "user asked for it explicitly" behaviour, but it is not written down anywhere. **I made it no worse and left it alone.**

---

## 6. Task 5.3 — M3 after-measurement

### Headline: target MET, and met for the right reason

| Metric                                              | Baseline (recorded) | Paired control (same session, old predicate) | **After (B4)**     |
| --------------------------------------------------- | ------------------- | -------------------------------------------- | ------------------ |
| `git status` invocations / 60 s                     | 25                  | 26                                           | **1**              |
| GIT_TRACE stderr lines                              | 25                  | 26                                           | **1**              |
| Qualifying (non-excluded) fs events                 | 734 (live repo)     | 170                                          | **2**              |
| **Invocations from excluded/cache paths**           | 25                  | 26                                           | **0 — TARGET MET** |
| Mid-window tracked-file change fired its own status | Yes                 | Yes (2923 ms)                                | **Yes**            |

**Sample count**: 2 after-runs of 60 s, both returning exactly 1 invocation and 2 qualifying events — median 1, max 1, zero spread. Plus one 60 s paired control run.

### Methodology, and why I added a paired control

`measurements.md:263-279` is load-bearing and I read it before running anything: Batch 0's live-monorepo attempt returned "0 invocations" **for the wrong reason** — 734 qualifying events kept the 2000 ms debounce continuously re-armed, so it never fired. A live-repo run would have reported a flattering "0" even if my change did nothing. I therefore used the scratch-repo methodology, identical to the baseline: isolated `git init` repo, one tracked file `src/file.ts`, empty `.nx/cache` + `.angular/cache`, probe writes into both every 2200 ms (28 each over 60 s), `WORKSPACE_DEBOUNCE_MS` unchanged at 2000 ms.

**Beyond the required procedure I added a paired control**: I re-ran the _pre-batch-5_ predicate on the same scratch repo, same machine, same session, immediately before the after-run. The recorded baseline (25) was captured on a different day under unknown ambient load; without a control, a quiet machine alone could explain a drop. The control reproduced **26** against the recorded **25** — a 4% delta. The environment is stable, and the fall from 26 → 1 is attributable to the exclusion change and nothing else.

### B4 AC3 — genuine changes still surface (direct R-9 mitigation)

This is the half that distinguishes a fix from a broken watcher, and it passes on the strongest evidence available: **the single invocation in the after-window was triggered by the tracked source file, by name.**

```json
"statusInvocations": 1,
"midWindowProbeFired": true,
"midWindowProbeConfirmedByStatusCall": true,
"invocationLog": [
  { "t": 1786368874011, "trigger": "change:src\\file.ts", "traceLineCount": 1 }
]
```

The mid-window edit to `src/file.ts` produced its own `git status` inside the unchanged 2000 ms debounce window; nothing else did. **An after-figure of literal "0" would have been a failure signal here, not a better result** — it would have meant the tracked-file edit was swallowed too. That is exactly the R-9 defect this proof exists to catch.

Additionally covered by unit tests, so this does not depend on a one-off manual run: a real-`fs.watch` integration test writes 5 probe files each into `.nx/cache` and `.angular/cache` (asserts **zero** `file:tree-changed` pushes past the debounce window), then writes `src/real.ts` and asserts the push **does** arrive. The positive control is in the same test, so a silently-dead watcher fails it.

### The e2e harness's hand-maintained copy — could NOT import the shared constant

The dispatch asked me to import from `libs/shared` if safely possible and to say so plainly if not. **It is not possible.**

`perf-m3-watcher-churn.script.mjs` is plain `.mjs` executed by bare `node`, while `workspace-scan.constants.ts` is TypeScript behind the `@ptah-extension/shared` path mapping with no node-resolvable build artifact at a stable location. Importing it would require a TypeScript execution step or a build step for the harness — which would drag it into the build graph and forfeit the "zero product-code change" property that makes the before/after numbers comparable in the first place.

So it remains a **third hand-maintained copy**, now updated to the new 13-name set and segment-level semantics, and carrying an explicit warning banner:

```
⚠️ THE EXCLUSION LIST BELOW IS A HAND-MAINTAINED COPY. It cannot import the
shared constant: … **If you change `workspace-scan.constants.ts`, update
`IGNORED_DIRS` below.**
```

Flagged as a known follow-up, not silently accepted.

---

## 7. Standing gates (§7) — all seven, with verbatim results

### Gate 1 — NFR-1 cross-project invariant ✅

```
npx nx test ptah-electron --skip-nx-cache
  Test Suites: 1 skipped, 13 passed, 13 of 14 total
  Tests:       4 skipped, 145 passed, 149 total

npx nx test rpc-handlers --skip-nx-cache
  Test Suites: 74 passed, 74 total
  Tests:       31 skipped, 1718 passed, 1749 total
```

- `ptah-electron` **145 passed** ≥ 135 floor ✅ (was 135 at rebaseline; +10 from this batch's new cases)
- `rpc-handlers` **1718 passed** ≥ 1410 floor ✅
- **Sum = 1863**, against the 1545 floor and Batch 4's measured 1860 — **increased, did not decrease** ✅
- No test was converted to skipped.

**Known pre-existing drift, reported not chased (as instructed):** `rpc-handlers` reports **31 skipped** against the gate's stated "≤2". Batch 4 already confirmed this is pre-existing on this branch and unrelated. `ptah-electron`'s 4 skipped is within its ≤4 allowance.

**Also pre-existing, confirmed not mine:** Jest prints _"A worker process has failed to exit gracefully"_ for `ptah-electron`. I isolated it — running the suite with `--testPathIgnorePatterns=git-watcher` (i.e. with my spec excluded entirely) still emits it. Not introduced by this batch.

```
npx nx test shared --skip-nx-cache
  Test Suites: 30 passed, 30 total
  Tests:       690 passed, 690 total
```

### Gate 2 — Typecheck ✅

```
npx nx typecheck @ptah-extension/shared --skip-nx-cache
  NX   Successfully ran target typecheck for project @ptah-extension/shared

npx nx typecheck ptah-electron --skip-nx-cache
  NX   Successfully ran target typecheck for project ptah-electron
```

### Gate 3 — Lint, standalone per project (no `run-many`) ✅

```
npx nx lint @ptah-extension/shared --skip-nx-cache
  NX   Successfully ran target lint for project @ptah-extension/shared    (0 problems)

npx nx lint ptah-electron --skip-nx-cache
  ✖ 3 problems (0 errors, 3 warnings)      ← pre-existing no-empty-function, not my files
  NX   Successfully ran target lint for project ptah-electron

npx nx lint ptah-electron-e2e --skip-nx-cache
  ✖ 1 problem (0 errors, 1 warning)        ← pre-existing
  NX   Successfully ran target lint for project ptah-electron-e2e
```

**0 errors everywhere.** As the dispatch predicted, a repo-wide `nx affected -t lint` is unreliable right now because of the concurrent TASK_2026_177 work; every project was linted individually.

### Gate 4 — Affected unit tests, `git-watcher.service.spec.ts` extended in place ✅

```
npx nx test ptah-electron --testPathPatterns=git-watcher --skip-nx-cache
  Test Suites: 1 passed, 1 total
  Tests:       23 passed, 23 total
```

Extended the existing spec; **no parallel spec file created**. Added: excluded-directory table (pre-existing + new + nested), R-9 keep-list including `out`/`build`/`coverage`/`.next`/`.turbo` and prefix-collision traps, null-filename handling, the Trap-1 dedicated-`.git`-watcher guard, and the real-`fs.watch` end-to-end wiring proof.

### Gate 5 — Three-runtime build (NFR-5) — REQUIRED for this batch ✅

```
npx nx build ptah-extension-vscode --skip-nx-cache
  NX   Successfully ran target build for project ptah-extension-vscode and 28 tasks it depends on

npx nx build ptah-cli --skip-nx-cache
  NX   Successfully ran target build for project ptah-cli and 23 tasks it depends on

npx nx build-main ptah-electron --skip-nx-cache
  NX   Successfully ran target build-main for project ptah-electron and 25 tasks it depends on
```

### Gate 6 — Scope discipline (NFR-9) ✅

Work confined to the files in §1. Nothing outside the batch was reverted, reformatted or "cleaned up". **`--no-verify` was not used** (no commits were made at all).

### Gate 7 — NFR-2 ✅ (checked, not applicable)

**I checked.** No Angular surface is touched by this batch — the changes are `libs/shared` (pure TypeScript, no framework), `apps/ptah-electron` main-process services, and an `.mjs` measurement script. No component was added or modified, so there is no `ChangeDetectionStrategy.OnPush` obligation to discharge.

---

## 8. B4 AC5 — VS Code and CLI exercised, no regression

The watcher is Electron-only but the exclusion set now compiles into all three runtimes, so absence must be a clean no-op rather than a crash (NFR-5).

**Absence is structural, not accidental.** A repo-wide grep for `TREE_HIDDEN_DIRS`, `WATCH_IGNORED_DIRS` and `isExcludedWorkspacePath` finds consumers in exactly two product files, both under `apps/ptah-electron/` (plus the shared module itself, its spec, and the e2e harness's documented copy). **No VS Code or CLI code path reaches these symbols**, so there is nothing that can throw — the capability is simply not wired, which is the intended clean no-op.

Exercised anyway:

```
node dist/apps/ptah-cli/main.mjs --version   → 0.2.6      (exit 0)
node dist/apps/ptah-cli/main.mjs --help      → full usage  (exit 0)

npx nx test ptah-extension-vscode --skip-nx-cache
  Test Suites: 3 passed, 3 total
  Tests:       30 passed, 30 total
```

Both hosts boot and their suites are green. No regression.

---

## 9. Line numbers — one further drift found and corrected

Every citation in the dispatch's §2 table was re-verified against the working tree. **All were accurate as given**, including the two the dispatch itself had already corrected. One additional stale citation was found in a document the dispatch did not audit:

| Cited in                                                                                                                       | Old citation | Status                                                | Correct today                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------- | ------------------------------------ |
| `editor-rpc.handlers.ts` `:70-80` `HIDDEN_SKIP`                                                                                | as given     | ✅ exact                                              | (now deleted)                        |
| `editor-rpc.handlers.ts` `:855` / `:858` tree skip                                                                             | as given     | ✅ exact                                              | (now one call at `:853`)             |
| `git-watcher.service.ts` `:382-405` `watchWorkspaceRoot`                                                                       | as given     | ✅ exact                                              | (now `:397-...`)                     |
| `git-watcher.service.ts` `:114` `WORKSPACE_DEBOUNCE_MS`                                                                        | as given     | ✅ exact, value `2000`                                | unchanged                            |
| **`perf-m3-watcher-churn.md:7`** cites `git-watcher.service.ts:370-422` and **`:12`** cites `:376-393`, **`:16`** cites `:102` | —            | ❌ **DRIFTED** (same drift `measurements.md:257` had) | `:382-405` and `:114` before my edit |

The procedure doc's stale offsets are **reported, not rewritten** — it is a Batch 0 artifact and editing its historical description of the pre-B4 code would be scope creep. The `.script.mjs` header, which I did have to touch for Task 5.3, has been corrected to cite the shared constant rather than the old line ranges.

---

## 10. Out of scope — found, reported, NOT fixed

1. **`libs\backend\workspace-intelligence\src\workspace\workspace.service.ts:718`** — the third `node_modules` exclusion list the dispatch pre-flagged. Confirmed still present. Untouched.

2. **NEW FINDING — two more hand-maintained exclusion lists in `editor-rpc.handlers.ts` itself**, which the plan does not mention anywhere:

   ```
   editor-rpc.handlers.ts:487:  const excludePattern = ['**/{node_modules,dist,.git,.nx,.cache}/**'];
   editor-rpc.handlers.ts:736:  const excludePattern = ['**/{node_modules,dist,.git,.nx,.cache}/**'];
   ```

   These serve `editor:searchInFiles` and `editor:listAllFiles` via `IFileSystemProvider.findFiles`. They are **glob strings**, a different mechanism from the boolean predicate, and both sites are outside Task 5.2's named scope, so I left them alone per NFR-9.

   **They matter to the reviewer for a precise reason**: they are _already drifted_. Their 5 names are a strict subset of `TREE_HIDDEN_DIRS` — missing `.hg`, `.svn`, `.DS_Store`, `.Trash`, `.tmp`, `.temp` — and they do not carry `.angular`. So B4 AC2's "single source of truth" is now true of the **predicate mechanism** (the watcher and the tree builder), which is what Option B scoped, but it is **not** true of every exclusion decision in the file. A follow-up task should convert the glob sites to derive their pattern from `TREE_HIDDEN_DIRS`. **Filing this as an observation, not smuggling it into this batch.**

---

## 11. Concurrency compliance

- **Zero git operations performed.** No `add`, `commit`, `stash`, `checkout`, `reset`, `restore`, `clean`. The only git commands run were read-only: `git status --short`, `git diff -- libs/shared/src/index.ts`, and `git log -L` for the §3 premise check.
- `git status` confirms the concurrent TASK_2026_177 session is actively editing `apps/ptah-license-server/**`, `libs/api/**`, `libs/api-contracts/**` and `tsconfig.base.json`. **None of its files were touched.**
- `libs/shared` is inside 177's blast radius; my only edit there is `src/index.ts`, verified by `git diff` to be **exactly one added line** with no other hunk, plus two new files that collide with nothing.
- Lint was run scoped per project rather than repo-wide, per §8 of the dispatch.

---

## 12. Batch 5 acceptance criteria

| Criterion                                                              | Status                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Task 5.0 decision recorded before any code written                     | ✅ recorded in `tasks.md`, Option B, honoured exactly                           |
| B4 AC1: M3 = 0 invocations from already-excluded paths                 | ✅ **0** (1 total, and it was the tracked-file edit)                            |
| B4 AC2: single source of truth; second list structurally impossible    | ✅ for the predicate mechanism — see §10.2 for the glob-string caveat, reported |
| B4 AC3: genuine change still fires within the existing debounce window | ✅ proved by name in the trace, plus a permanent unit test                      |
| B4 AC4: user-opened ignored directories behave consistently            | ✅ unchanged; one pre-existing asymmetry reported, not fixed                    |
| B4 AC5: VS Code and CLI exercised, no regression; all three build      | ✅                                                                              |
| `measurements.md` carries the M3 after-figure                          | ✅ appended; baseline untouched                                                 |
| Standing gates 1–7                                                     | ✅ all pass                                                                     |

**No target was missed, so nothing required a B0 AC4 shortfall flag.** Three judgment calls are flagged for the reviewer instead: `LEGACY_HIDDEN_SKIP` in the spec (§4, Trap 3), the segment-level widening (§5, Axis 2), and the two surviving glob exclusion lists (§10.2).
