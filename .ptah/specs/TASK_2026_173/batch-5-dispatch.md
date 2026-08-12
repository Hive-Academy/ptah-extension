# Batch 5 Dispatch — TASK_2026_173

**Batch**: 5 — Watcher Exclusions (B4)
**Executor**: `backend-developer` sub-agent (Recommended Executor per `tasks.md`)
**Fallback**: `devops-engineer`
**Execution Mode**: sequential — 5.1, then 5.2, then 5.3. Do not reorder.
**Tasks**: 5.1, 5.2, 5.3. **Task 5.0 is a decision gate and is already RESOLVED — see §1.**
**Predecessor**: Batch 4 committed as `06b900d85`, `code-logic-reviewer` APPROVED (8/10, 0 critical, 0 serious).
**CLI agent delegation**: **DISABLED** for this task (user decision, Checkpoint 0.1, `tasks.md:7`). Do not spawn CLI agents.

**Task folder**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\`
Read before writing any code: `tasks.md` (Batch 5 section + Standing Per-Batch Gates), `implementation-plan.md` §6, `measurements.md` §M3 (`:252-279` — the FINDING there is load-bearing for Task 5.3).

---

## 1. Task 5.0 is RESOLVED — Option B. Read this before touching anything.

The user was consulted at the batch 4→5 boundary, as risk V-1 required, and chose **Option B**.

> **Two named sets behind one shared predicate: `TREE_HIDDEN_DIRS ⊆ WATCH_IGNORED_DIRS`.**

What this means concretely, in the terms you will be judged against:

- **The file tree KEEPS its current visibility, exactly.** Not one directory that is visible in the
  tree today may disappear, and not one that is hidden today may appear. If your change alters what
  the user sees in the file explorer, you have implemented **Option A**, which this task explicitly
  declined, and you are **not done**.
- B4 AC2's "single source of truth" is satisfied by the **mechanism** — one predicate, one module —
  **not** by the two sets being identical. They are deliberately not identical.
- Task 5.2's rule still binds in full: **`HIDDEN_SKIP` is deleted**, both consumers call the one
  shared predicate, and reintroducing a second hand-maintained list SHALL be treated as not-done.
  After this batch a second list must be _structurally impossible_, not merely absent.
- **R-9 stands.** An over-broad exclusion set is a correctness defect and is worse than the churn it
  fixes. The only addition beyond the union of the two current lists is **`.angular`**.
  **Do NOT speculatively add `out`, `build`, `coverage`, `.next`, `.turbo`.** Those are plausible
  source directories in real projects; missing a real change is a defect, churn is an annoyance.

Do not re-open this decision, and do not "improve" on it.

---

## 2. Line numbers — verified against the current tree on 2026-08-10

Batch 4 proved that the older planning documents' offsets have drifted. I re-verified every citation
Batch 5 depends on. Use the corrected column.

| Cited in                    | Old citation                     | Status            | Correct today                                                                                                |
| --------------------------- | -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `editor-rpc.handlers.ts`    | `:70` `HIDDEN_SKIP`              | ✅ still resolves | `:70-80` (the nine-name `Set`)                                                                               |
| `editor-rpc.handlers.ts`    | `:858` tree skip                 | ✅ still resolves | `:855` (node_modules/dist) **and** `:858` (dot + HIDDEN_SKIP)                                                |
| `git-watcher.service.ts`    | `:378-393` exclusion block       | ❌ **DRIFTED**    | **`:382-405`**, method `watchWorkspaceRoot`. `:378-393` now lands on the method's doc comment and signature. |
| `git-watcher.service.ts`    | `:102` `WORKSPACE_DEBOUNCE_MS`   | ❌ **DRIFTED**    | **`:114`** (value still `2000`)                                                                              |
| `measurements.md:257` cites | `git-watcher.service.ts:376-393` | ❌ **DRIFTED**    | same correction — `:382-405`                                                                                 |

If any of these have moved again by the time you read the files, correct them and say so in your
report. Do not silently implement against a stale offset.

---

## 3. ⚠️ A FALSE PREMISE IN THE PLAN — verified, and you must not act on it

`tasks.md` Task 5.0 and risk V-1 both assert that **"the watcher ignores `node_modules`/`dist` which
the tree SHOWS"**, and Option A's stated consequence is that unification would make the tree stop
showing them.

**This is false against the current tree.** `editor-rpc.handlers.ts:855` already skips both:

```ts
if (entry.name === 'node_modules' || entry.name === 'dist') {
  continue;
}
```

`git log -L` dates that line to `80d26911d` (2026-05-21), which is _before_ the plan was written. So
the tree builder hides `node_modules` and `dist` today, and the only genuine disagreement between the
two consumers is the **other** direction: the tree hides `.git .hg .svn .DS_Store .Trash .cache .tmp
.temp .nx`, and the watcher does not.

**Why this does not change your instructions**: the user's Option B decision governs regardless, and
Option B is the conservative choice either way. What it _does_ change is your success criterion —
"the tree keeps showing `node_modules` and `dist`" is **not** something you can verify, because the
tree never showed them. **Verify the actual invariant instead: the set of directories the tree
renders is byte-identical before and after your change.** Record in your report that you checked this
premise and found it stale.

---

## 4. Task 5.1 — Shared exclusion constants

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\constants\workspace-scan.constants.ts` (**NEW**)
**Also**: `D:\projects\ptah-extension\libs\shared\src\index.ts` — add the barrel export. The
constants directory currently holds exactly one file and its export sits at `index.ts:50`
(`export * from './lib/constants/environment.constants';`). Follow that pattern.
**Requirement**: B4 AC2

Deliver two named sets and one predicate:

- **`TREE_HIDDEN_DIRS`** — exactly what the tree builder hides **today**, so tree visibility is
  provably unchanged: `.git`, `.hg`, `.svn`, `.DS_Store`, `.Trash`, `.cache`, `.tmp`, `.temp`, `.nx`
  (the current `HIDDEN_SKIP`) **plus** `node_modules` and `dist` (the current `:855` check).
- **`WATCH_IGNORED_DIRS`** — a **superset**: `TREE_HIDDEN_DIRS ∪ { '.angular' }`.
- **`isExcludedWorkspacePath(relativePath: string, dirs: ReadonlySet<string>): boolean`** — splits on
  `[\\/]` and returns true if **any segment** is in `dirs`. Both Windows and POSIX separators; Windows
  is this project's primary development platform.

**Ruling on `.angular`, which the user decision left implicit — flag it in your report so the
reviewer can check my call**: `.angular` goes in **`WATCH_IGNORED_DIRS` only**, not in
`TREE_HIDDEN_DIRS`. The tree does not hide `.angular` today (it starts with `.` but is not in
`HIDDEN_SKIP`), and Option B's entire purpose is that tree visibility does not change. Putting
`.angular` in `TREE_HIDDEN_DIRS` would hide a directory the user can see today — a visibility change,
i.e. Option A by the back door.

**Express the subset relation in code, not in a comment.** Derive `WATCH_IGNORED_DIRS` from
`TREE_HIDDEN_DIRS` (e.g. `new Set([...TREE_HIDDEN_DIRS, '.angular'])`) so `TREE_HIDDEN_DIRS ⊆
WATCH_IGNORED_DIRS` cannot drift. Add a unit spec asserting the subset relation holds — that
assertion is what makes B4 AC2's "structurally impossible" claim true rather than aspirational.

`libs/shared` is zero-dependency and consumed by all three runtimes. No Node imports, no `path`, no
`fs` — pure string handling only.

---

## 5. Task 5.2 — Both consumers use the shared predicate

**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.ts` — `:382-405`, `watchWorkspaceRoot`
- `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.ts` — `:70-80` (`HIDDEN_SKIP`, **delete it**), `:855` and `:858` in `buildFileTree`

**Requirement**: B4 AC1, AC2, AC4

The watcher does a **path-level** test against the `fs.watch` filename (which arrives as a
workspace-relative path, possibly multi-segment). The tree builder does a **segment-level** test
against a single `entry.name`. Same predicate, two call shapes — that is fine and is the point.

### Three traps. Each one is a shipped regression if you get it wrong.

**Trap 1 — do NOT apply the predicate to the dedicated `.git` watchers.**
`GitWatcherService` runs two distinct watching strategies. `watchFile` (`:313`) and `watchDirectory`
(`:343`) watch `.git/HEAD`, `.git/index` and `.git/refs/` — _that is where every commit, stage,
checkout and branch switch is detected_. Only `watchWorkspaceRoot` (`:382`) carries the exclusion
filter, and it excludes `.git` precisely because the dedicated watchers already own it. If you route
the shared predicate through `watchFile`/`watchDirectory`, `.git` becomes excluded there too and
**git status updates stop firing entirely**. Touch `watchWorkspaceRoot` only.

**Trap 2 — the `startsWith('.')` gate at `:858` must NOT survive a naive merge.**
Today the tree runs two separate checks: `:855` for `node_modules`/`dist` (no dot gate) and `:858`
for `HIDDEN_SKIP` (dot gate). If you collapse them into one call and keep the dot gate,
`node_modules` and `dist` stop being skipped and both appear in the tree — a user-visible
regression, and the exact thing §1 forbids.
The gate is safe to drop: all nine current `HIDDEN_SKIP` names (`.git .hg .svn .DS_Store .Trash
.cache .tmp .temp .nx`) begin with `.`, so `entry.name.startsWith('.')` is a **no-op** against that
set today. State that proof in your report rather than asserting it.

**Trap 3 — `HIDDEN_SKIP` must be deleted, not re-exported or aliased.**
`const HIDDEN_SKIP = TREE_HIDDEN_DIRS` is a second name for the same list and defeats the purpose.
Delete the declaration; call the shared predicate at the use site. Confirm with a repo-wide grep that
no `HIDDEN_SKIP` identifier remains and paste the grep result in your report.

### Behavioral delta this batch DOES introduce, and it is the point of B4

After this change, `watchWorkspaceRoot` stops scheduling `git status` for writes under `.nx/`,
`.angular/`, `.cache/`, `.tmp/`, `.temp/`, `.hg/`, `.svn/`, `.Trash/` — where today it only skips
`.git/`, `node_modules/` and `dist/`. That is B4 AC1. It is expected. Name it in your report as an
intentional delta, with the full list of newly-excluded prefixes.

**B4 AC4** — a directory the user explicitly opens from an ignored path must behave consistently with
the tree's own visibility rules. Verify what happens today when a user opens a file under an ignored
directory and confirm you have not made it worse; if the existing behavior is already inconsistent,
**report it, do not fix it** (NFR-9).

---

## 6. Task 5.3 — M3 after-measurement + genuine-change proof

**File**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md`
**Harness**: `apps\ptah-electron-e2e\src\specs\editor\perf-m3-watcher-churn.md` (procedure) and
`perf-m3-watcher-churn.script.mjs` (the runner)
**Requirement**: B4 AC1, AC3, AC5; B0

**Baseline to beat**: **25 invocations** over a 60-second window (`measurements.md:254`).
**Target**: **0 invocations** attributable to paths the exclusion set now covers.

### Read `measurements.md:263-279` before you run anything

Batch 0 already ran this against the live monorepo and got **0 invocations — for the wrong reason**.
734 qualifying file-system events fired, and the 2000 ms debounce timer never went quiet once,
because this dev machine has enough ambient background churn (Nx daemon, editor autosave) to keep
re-arming it continuously. **A live-repo run would report a perfect "0" even if your fix did
nothing.** That is why the baseline used an isolated scratch git repository, and why your after-figure
must use the same scratch-repo methodology on a quiet machine. Same workload, same window length,
same counting method — otherwise the two numbers are not comparable and the measurement is worthless.

**The script hardcodes a copy of the watcher's predicate.** `perf-m3-watcher-churn.script.mjs`
replicates `watchWorkspaceRoot`'s exclusion list (`.git/`, `node_modules/`, `dist/` — explicitly
"NOT `.nx/` or `.angular/`", per `measurements.md:257`) so it can run standalone with zero
product-code change. **You must update that copy to the new set**, or the after-figure measures the
old behavior. Note in your report that this is a third hand-maintained copy of the list living in an
e2e harness; if you can have it import the shared constant from `libs/shared` without dragging the
harness into the build graph, do so and say why it is safe — if you cannot, say that plainly and
leave a comment in the script pointing at `workspace-scan.constants.ts`.

**B4 AC3 is not optional and is the direct mitigation for R-9.** Within the same 60-second window,
modify a **tracked source file** and confirm the change still produces a status invocation and
reaches Source Control inside the existing debounce window. The baseline run did exactly this and
confirmed it (`measurements.md:260`). An after-figure of "0 invocations" without this proof is
indistinguishable from a watcher you broke.

**B4 AC5** — exercise VS Code and CLI; neither may regress. The watcher is Electron-only, but the
exclusion set now lives in `libs/shared` and is compiled into all three. Where the capability cannot
exist in a runtime, absence must be a **clean no-op, not a crash** (NFR-5).

Record in `measurements.md`: workload, sample count, median/count, machine, method — enough for a
third party to reproduce. **Append new rows; never overwrite the baseline.** If the target is missed,
**flag the shortfall explicitly per B0 AC4 — a flagged miss passes, a rounded-up pass does not.**
Batch 4's M2 miss was reported honestly and the batch was approved; the same standard applies here.

---

## 7. Standing gates (all seven, from `tasks.md:74-92`)

1. **NFR-1 cross-project invariant** — `nx test ptah-electron` ≥135 passed and `nx test rpc-handlers`
   ≥1410 passed; the **sum must not decrease** (floor 1545; Batch 4 measured 1860). Converting a
   failing test to skipped is a regression, not a fix.
   _Known pre-existing_: `rpc-handlers` reports **31 skipped** against the gate's stated "≤2". Batch 4
   confirmed this is pre-existing drift on this branch and unrelated to `libs/frontend`. Report it
   again if you see it; do not chase it.
2. **Typecheck** — `nx typecheck` clean for every changed project.
3. **Lint, standalone per project** — `nx lint <project>` individually for `@ptah-extension/shared`
   and `ptah-electron`. Do not rely on a batched `run-many`.
4. **Affected unit tests** — including `git-watcher.service.spec.ts`, which already exists at
   `apps\ptah-electron\src\services\git-watcher.service.spec.ts`. **Extend it** with the exclusion
   cases; do not create a parallel spec file.
5. **Three-runtime build (NFR-5)** — **REQUIRED for this batch.** Task 5.1 touches `libs/shared`, so
   VS Code, Electron and CLI must all build. This gate did not apply to Batch 4; it applies to you.
6. **Scope discipline (NFR-9)** — confine work to the files listed above. Failures originating
   outside this task's scope are **reported and the batch stopped**, never fixed opportunistically.
   **`--no-verify` is forbidden.**
7. **NFR-2** — not applicable (no Angular surface in this batch), but state that you checked.

**Known out-of-scope observation, already logged — report if you see it, do NOT fix**:
`libs\backend\workspace-intelligence\src\workspace\workspace.service.ts:718` holds a _third_
`node_modules` exclusion list. B4 scopes the watcher and the tree builder only. Folding a third
consumer in is scope creep and will be rejected.

---

## 8. ⚠️ The branch is shared — concurrency rules

**Another session is concurrently working TASK_2026_177 on this same branch
(`ak/license-server-validation-pipe`).** Its uncommitted work spans `apps/ptah-license-server/**`,
`libs/api/**`, `libs/api-contracts/**`, `tsconfig.base.json`, `marketing/**`, and several
`.ptah/specs/TASK_2026_1{77,79,84}` files. `libs/shared/**` is inside that session's blast radius and
**you are editing it.**

- **You perform NO git operations.** No `add`, `commit`, `stash`, `checkout`, `reset`, `restore`,
  `clean`. The team-leader stages and commits after `code-logic-reviewer` returns a verdict. This is
  not a formality — a `git checkout` or `stash` here would destroy another session's uncommitted work.
- Never revert, reformat, or "clean up" a file outside your own task's list, even if it looks broken.
- `nx affected --target=lint` across the whole repo may fail from the concurrent 177 work. That is not
  yours to fix. **Run lint scoped per project** (gate 3) and report the scoped result.
- If a test outside `libs/shared` / `apps/ptah-electron` fails, check whether it is 177's before
  assuming it is yours. Report either way; fix neither.

---

## 9. Deliverables and return format

1. Implement 5.1, 5.2, 5.3 in order. **Real code only** — no stubs, no `TODO`, no placeholders.
2. Update each task's status line in `tasks.md` from `🔄 IN PROGRESS` to `🔄 IMPLEMENTED` using
   `Edit` on that exact line. **Never `Write` the whole file** — it is a shared carrier and another
   session's status edits live in adjacent task folders.
3. Write `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\batch-5-report.md`.

Your report must contain, at minimum:

- Absolute paths of every file created or modified.
- The exact contents of both sets, and where `.angular` landed, with your reasoning.
- Proof that **tree visibility is unchanged** — the §3 invariant, not the plan's stale premise.
- Confirmation that all three traps in §5 were checked, with the `HIDDEN_SKIP` grep output pasted.
- The full list of newly-excluded path prefixes the watcher now skips (the intentional delta).
- The M3 after-figure with methodology, alongside the 25-invocation baseline, and the B4 AC3
  genuine-change proof. **If the target is missed, flag it — do not round it up.**
- Every gate from §7 with its command and verbatim result, including the three-runtime build.
- Any line number that had drifted again, corrected.
- Anything out of scope you found: reported, not fixed.

**You do NOT create git commits.** Focus entirely on code quality; the team-leader owns git.
