# Batch 9 Dispatch — Follow-Up Filing

**TASK_2026_173** · dispatched 2026-08-10 · gate commit `3d6145863` (Batch 8)
**This file is the executor's source of truth.** Where it disagrees with `tasks.md` Tasks 9.1–9.3,
**this file wins** — the register grew from eleven items to **seventeen** when Batch 8 landed.

**Shape**: 3 tasks · one pass · **ONE commit**
**Executor**: `senior-tester` · **Fallback**: `devops-engineer` · **Mode**: sequential
**CLI agent delegation is DISABLED** (user decision, Checkpoint 0.1, `tasks.md:7`).

---

## 0. THE ONE RULE THAT DEFINES THIS BATCH

# **THIS BATCH FILES. IT DOES NOT FIX.**

Every item below is here **because** a previous batch deliberately refused to fix it under NFR-9.
Several carry their exact fix, spelled out, in one line. **That is the trap.** An item whose fix
reads as a one-liner is the one you will be most tempted to just do — and doing it would silently
widen a task that has held scope discipline across nine batches.

The only artifacts this batch produces are:

1. New `.ptah/specs/TASK_YYYY_NNN/` records, and
2. Edits to `tasks.md` / `measurements.md` inside `TASK_2026_173`.

**No product code changes. None.** If you find yourself editing anything under `libs/` or `apps/`,
stop — you have left this batch.

---

## 1. ID allocation — scan folders, never `registry.md`

Per the root `CLAUDE.md`:

> **ID allocation**: folder scan of `.ptah/specs/TASK_*` — highest `NNN` for the current year + 1,
> zero-padded. **NEVER derive the ID from `registry.md`** (it is generated and can be stale).

```bash
ls -d .ptah/specs/TASK_2026_* | sed 's|.*/||' | sort | tail -5
```

**At dispatch time the highest folder is `TASK_2026_202`, so the first new record is
`TASK_2026_203`.**

**Re-scan immediately before you create each record — do not trust that number.** It moved by
**three** during Batch 8 alone: `TASK_2026_200`, `201` and `202` all appeared while the three passes
ran, and `TASK_2026_199` is the user's. Other sessions are creating folders on this branch right
now. A collision silently overwrites someone else's carrier.

### Carrier contract (root `CLAUDE.md`, non-negotiable)

Every new folder MUST contain `task.md` with YAML frontmatter — `status`, `type`, `title` — plus a
short body. **A folder without `task.md` is invisible to the Tasks board.** Prose goes in
`context.md`, never in the carrier.

> **`description` is ALWAYS a `>-` block scalar. Same for `title` when it contains a colon.**
> A plain YAML scalar ends at the first colon-space, so a description quoting code makes the whole
> carrier unparseable and the task **vanishes from the board**. Three carriers were dark for exactly
> this reason (repaired 2026-08-09). Several items below quote code containing colons — `readOnly:
true`, `glyphMargin: true`, `role="list"`, `@@ -a,b +c,d @@`. **Block-scalar them.**

Set `status: backlog` on every new record. `type` per the item's nature (`bugfix`, `feature`,
`refactor`, `docs`, `devops`).

---

## 2. Task 9.1 — File B6 (file-tree virtualization)

**Requirement**: DoD item 10.

B6 was ruled out of scope from the start: expanding a large directory renders every node with no
windowing, but virtualizing the tree drags in its own keyboard-navigation, screen-reader-tree,
scroll-restoration and drag-and-drop surface. B3 removed the sharper edge of the same problem.

**Attach the M2 measurement as the justification.** Read `measurements.md` and copy the actual
before/after M2 figures — median **and** max, workload, sample count, method — into the new record's
`context.md`. Do not paraphrase them and do not file B6 without them: "the tree might be slow" is a
hunch; "at N nodes the median is X ms and the max is Y ms, by this method" is a justification a
future planner can act on.

If the M2 after-figure shows the tree is **no longer** slow at scale, say so plainly in the record
and file it as a LOW-priority watch item rather than inflating it. **Report what the number
actually says.**

---

## 3. Task 9.2 — File the R-3 residue and B-group findings

**Requirement**: DoD item 9; task-description Out-of-Scope item 8.

`r3-triage.md` §"Follow-up findings" carries **exactly two**, both non-blocking, both correct-and-
safe behaviour with a less specific message than ideal:

1. **Directory rows produce a generic `unknown` error rather than a directory-specific message.**
   An untracked directory row in Source Control is clickable and resolves to a correct,
   non-crashing, persistent error overlay — but the copy reads "Git could not read this file"
   rather than "Cannot diff a directory". No data-integrity risk, no crash, no misrendering as
   content. **Fix: either hide the diff affordance on `isDirectory` rows in
   `SourceControlFileComponent`, or add a dedicated `is-a-directory` outcome to the
   `GitReadErrorCode` table.**
2. **Submodule paths surface as the generic `unknown` error code**, not a `submodule`/`gitlink`-
   specific one. Same shape as (1). **Fix: add a `submodule` outcome to `GitReadErrorCode` and
   classify on the `git show` exit-128 + `rev-parse --verify` exit-0 pair that already
   distinguishes it.**

**Nothing was re-suppressed and nothing may be** — discovering these failures is the entire point of
A3 (task-description R-3). Also carry forward, per `tasks.md` Batch 9 Validation Notes, the **two
glob-string exclusion lists** at `editor-rpc.handlers.ts:487` and `:736` (serving
`editor:searchInFiles` and `editor:listAllFiles`), which carry only 5 of `TREE_HIDDEN_DIRS`' 12
names and are **already drifted**. B4 AC2's "single source of truth" is true of the predicate
_mechanism_, which is what Option B scoped — it is not true of every exclusion decision in that
file. **Fix: point both glob lists at `TREE_HIDDEN_DIRS` and derive the globs, so the drift cannot
recur.**

---

## 4. Task 9.3 — The SEVENTEEN-item register

Items **1–11** are in the `tasks.md` Task 9.3 table, unaltered since the R-7 cut line, each already
carrying a concrete one-line fix verified item by item by the Batch 7 reviewer in Round 2. Items
**12–17** were added by Batch 8 and are in the same table. **Read the table — it is the
authoritative text; this section only tells you what changed and what to watch for.**

### 4.1 Item 12 is not like the others — do not flatten it

> ⛔ **`git:applyHunks` has NEVER been exercised end-to-end in Electron. That was a NAMED BATCH 8
> EXIT CRITERION (`batch-8-dispatch.md` §7) and NO PASS MET IT. D2 IS NOT DONE UNTIL IT IS RUN.**

This is the one item on the register that is **not** discretionary. File it with its
`HIGH — REQUIRED BEFORE D2 IS DONE` status **in the carrier's `title` and body**, not buried in a
table row alongside the LOW-severity polish.

The honest framing, which belongs in its `context.md` verbatim, is 8C's:

> _every corruption-risk guard is proven; the UI's live wiring is not._

Why it was committed anyway, so the record does not read as negligence:

- **AC2–AC7, AC9, AC10, AC12 and both halves of AC6** are proven against **real git
  2.54.0.windows.1** in throwaway repositories. Not mocked git.
- The unmet criterion is **UI wiring in a live host, not data safety**. Real, different class.
- It **could not be run**: `ptah-electron` was red from deliberate concurrent work in
  `cli-agent-runtime`, `agent-sdk`, `vscode-lm-tools` and `tribunal-panel` on this branch.
- The work sat **uncommitted in a tree other sessions were writing to**, and 8B had already misread
  a `lint-staged` hide-window as catastrophic loss. **Committing was the safer state.**

**A branch commit is not a release.** The commit body of `3d6145863` says all of this plainly. Your
record must too.

**Fix (one line, as required): add a Playwright `_electron` smoke under
`apps/ptah-electron-e2e/src/specs/editor/` that opens a `worktree` diff on a scratch repo, stages
one hunk via the keyboard toolbar, and asserts `git diff --cached` contains that hunk and only that
hunk.** Items 15 and 16 should be verified in the same harness — say so in all three records so
whoever picks up item 12 knows they are building infrastructure two other items depend on.

### 4.2 Item 13 exists because 8A's design claim was disproved — carry that correction

8A disclosed, in good faith, that it could not reach either of its two offset guards and concluded
**"the offset hazard is designed out rather than guarded"**, keeping both only as canaries. It
invited the check explicitly: _"if you can reach one, that is a finding about the design, not the
test."_

**8C reached both.** The window is not a stale client patch — it is a **TOCTOU race internal to a
single `applyHunks` call**, between the fresh `before = await this.diffFile(...)` re-read and the
`--check`/apply a few lines later. Milliseconds wide, but real on any filesystem shared with another
process. Against real git, the pre-write guard refused on a genuine
`Hunk #1 succeeded at 32 (offset 5 lines)`, and the post-write guard's `read-tree` rollback left
`git diff --cached` empty.

**Both guards are load-bearing, not decorative.** Item 13's record must say so, because anyone
reading `batch-8a-report.md` §7.2 in isolation would conclude they are dead code and delete them.
This is also the reason item 13 exists at all: reaching guard 2 is what exposed that its branch
never calls `restoreAfterFailedApply`.

### 4.3 One candidate was ruled CLOSED — do not re-file it

8A asked whether the `--check` dry run earns its place, having found that removing it fails **0 of
28** tests. **8C ruled in §4: RETAIN.** `--check` is not load-bearing for final-state correctness —
guard 3 is a comprehensive backstop, which is exactly why 8A saw 0/28 — but it eliminates the window
in which a real working-tree or index write exists in a **transiently wrong state**, observable by a
concurrently open editor or by Electron's own `.git/index` watcher.

**That question is closed. Do not file it, and do not let a future reviewer delete `--check` as
redundant** — record the ruling in `tasks.md` if you think it needs a louder home than
`batch-8c-verification.md` §4.

Also considered and **not** filed: the pre-existing forbidden-non-null-assertion lint warning in
`getRemotes` (`git-info.service.ts`), which 8A only moved by line number. Pre-existing noise, no
behaviour attached, correctly untouched under NFR-9.

### 4.4 Items you will be tempted to fix — the file-not-fix rule binds hardest here

- **Item 5** (empty-state `role="list"`) — a confirmed live critical axe violation with a known
  one-line fix, and it hits the common case since most working trees have nothing staged.
- **Item 6** (`closeSplit`'s `stopPropagation`) — one line, ten lines from where Batch 7 worked.
- **Item 13** — `restoreAfterFailedApply` is already imported and the restore point is already
  captured; it is a single call.

**File all three. Fix none of them.** Each was held out of two consecutive batches by explicit
instruction and confirmed untouched by reviewers both times.

### 4.5 Item 4 is settled by user decision — do not re-litigate

The `aria-required-children` violation on `role="tablist"` was **introduced by Batch 6 and accepted
by user decision on 2026-08-10**. File it. **Do not propose `role="toolbar"` + `aria-current`,
`aria-owns`, or hoisting the buttons — all three were evaluated and ruled out.**

---

## 5. Standing constraints

1. **Never `git add -A`, never `git add .`, never `git commit -a`.** Stage by explicit path, whole
   files only. The tree is busy: other sessions are deliberately working in `libs/backend/
platform-core/**`, `libs/backend/task-specs/**`, `libs/backend/workspace-intelligence/**`,
   `libs/backend/rpc-handlers/**/workspace-rpc.handlers.*`, `marketing/**`, `task-tracking/` and
   `.ptah/specs/TASK_2026_199..202/`. **That work is intentional. Do not stage, revert, format or
   report on it.**
2. **`--no-verify` is forbidden.** If the pre-commit hook fails, **stop and report**. It runs a full
   electron `validate-deps` build and takes **well over two minutes** — budget for it and do not
   mistake a timeout for a failure.
3. **Do not `git reset`, `git stash`, or `git checkout --`** anything. If you find staged content
   you did not create, leave it and report it.
4. **`git stash list` shows one unrelated pre-existing marketing entry. Leave it alone.**
   `batch-8b-report.md` §10 instructs a `git stash pop`; that instruction is **false and void** and
   the report is annotated in place saying so.
5. **NFR-9 scope discipline.** This batch touches `.ptah/specs/` only.

---

## 6. Exit criteria

- B6 filed **with the actual M2 median/max/workload/sample-count/method** attached (DoD 10)
- **Both** `r3-triage.md` follow-up findings filed; **none re-suppressed** (DoD 9)
- The **glob-string exclusion drift** at `editor-rpc.handlers.ts:487` / `:736` filed
- **All seventeen** Task 9.3 candidates filed as their own records — none silently dropped, **none
  fixed in-task**
- **Item 12 filed with `HIGH — REQUIRED BEFORE D2 IS DONE` intact**, in the carrier title and body
- Every record carries a **concrete one-line fix**, not an open question
- Every ID from a **fresh folder scan**; every carrier has parseable frontmatter with `>-` block
  scalars where a colon appears; every carrier is visible on the Tasks board
- `measurements.md` complete: M1–M4, before and after, each with workload, sample count, method,
  **median and max**
- **ONE commit**, staged by explicit path

---

## 7. Report back

Do **not** commit. `team-leader` owns git. Return:

1. **The ID map** — every new `TASK_2026_NNN` against the register item or finding it files, so the
   mapping is auditable and no item can be silently dropped
2. Confirmation that **each of the seventeen** register items, **both** R-3 findings, **B6**, and
   the **glob drift** has a record — by number, not by summary
3. **Item 12's record path**, called out separately, with its status text quoted
4. Which IDs you scanned and what the highest folder was **at the moment you allocated**, plus any
   collision you had to route around
5. Anything you could not file, and why — disclosed plainly in its own section
6. Confirmation that **no file under `libs/` or `apps/` was modified**
