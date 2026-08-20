# Batch 9 Report — Follow-Up Filing

**TASK_2026_173** · executed 2026-08-10 · executor `senior-tester` · dispatch `batch-9-dispatch.md`

**This batch files. It does not fix.** No file under `libs/` or `apps/` was read for the purpose of
editing, and none was modified — confirmed by `git status --porcelain -- libs apps` before and after
this session's writes (the pre-existing modifications there — `platform-core`, `rpc-handlers`,
`task-specs`, `workspace-intelligence` — belong to other concurrent sessions per the dispatch's own
warning, and are untouched by this batch).

---

## 1. ID map

All 21 new records carry `status: backlog`, parseable YAML frontmatter, and a `>-` block-scalar
`title`/`description` throughout (used unconditionally, not only where a colon appears, to eliminate
any parse risk).

| #      | Item filed                                                                                         | Task ID             |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------- |
| —      | **Task 9.1** — B6 (file-tree virtualization), M2 attached                                          | `TASK_2026_203`     |
| —      | **Task 9.2** — R-3 finding 1: directory rows → generic `unknown` error                             | `TASK_2026_204`     |
| —      | **Task 9.2** — R-3 finding 2: submodule paths → generic `unknown` error                            | `TASK_2026_205`     |
| —      | **Task 9.2** (validation notes) — glob-string exclusion drift, `editor-rpc.handlers.ts:487`/`:736` | `TASK_2026_206`     |
| 1      | M3 harness `IGNORED_DIRS` copy has no drift detection                                              | `TASK_2026_207`     |
| 2      | Undocumented B4 AC4 asymmetry (explicit access vs. navigation)                                     | `TASK_2026_208`     |
| 3      | Pointer capture hardening for editor-panel resize handles                                          | `TASK_2026_209`     |
| 4      | `aria-required-children` on `role="tablist"` — accepted by user decision                           | `TASK_2026_210`     |
| 5      | Empty-state `role="list"` ownership violation (confirmed defect)                                   | `TASK_2026_211`     |
| 6      | `closeSplit`'s leftover `stopPropagation()`                                                        | `TASK_2026_212`     |
| 7      | Pre-existing right-pane self-echo in `updateSplitContent`                                          | `TASK_2026_213`     |
| 8      | No "panes disagree" affordance after save-conflict Cancel                                          | `TASK_2026_214`     |
| 9      | `axe-core` not a declared dependency                                                               | `TASK_2026_215`     |
| 10     | Delete-confirm / name-input modals lack accessible dialog shape                                    | `TASK_2026_216`     |
| 11     | Flaky perf assertion — "perf M2 scaling" (B3 AC2)                                                  | `TASK_2026_217`     |
| **12** | **`git:applyHunks` never exercised end-to-end in Electron — `HIGH — REQUIRED BEFORE D2 IS DONE`**  | **`TASK_2026_218`** |
| 13     | Pre-write offset guard doesn't call `restoreAfterFailedApply`                                      | `TASK_2026_219`     |
| 14     | `applyHunks` inherits undocumented `workspacePath === repo top level` assumption                   | `TASK_2026_220`     |
| 15     | No in-editor floating hunk action widget                                                           | `TASK_2026_221`     |
| 16     | Glyph-margin hunk markers never visually verified                                                  | `TASK_2026_222`     |
| 17     | `applyInFlight` mid-await guard untested                                                           | `TASK_2026_223`     |

`tasks.md` was also updated in place: the top status line, Task 9.1/9.2/9.3 status markers
(`🔄 IN PROGRESS` → `🔄 IMPLEMENTED`), and a copy of this ID map inserted directly above the Batch 9
Acceptance Criteria, so the mapping is auditable from the task's own tracking file without cross-
referencing this report. No task status was set to `done`/`✅ COMPLETE` — that is `team-leader`'s call
per the Status Legend.

---

## 2. Confirmation by number

- **B6**: filed — `TASK_2026_203`. ✅
- **R-3 finding 1** (directory rows → `unknown`): filed — `TASK_2026_204`. ✅
- **R-3 finding 2** (submodule → `unknown`): filed — `TASK_2026_205`. ✅
- **Glob drift** (`editor-rpc.handlers.ts:487`/`:736`): filed — `TASK_2026_206`. ✅
- **Register items 1–17**: all filed — `TASK_2026_207` through `TASK_2026_223`, one-to-one, in table
  order. ✅ **None silently dropped, none fixed in-task.**

**Total new records: 21.** Nothing was re-suppressed anywhere in this filing.

One item was **deliberately NOT filed**, per the dispatch's own instruction, and is recorded here so
it reads as an explicit decision rather than an omission: the `--check` dry-run retain/remove question
(8A raised it; **8C ruled RETAIN** in `batch-8c-verification.md` §4). That ruling is closed, not open.
It is not a new task record — it is called out in the `tasks.md` ID-map block I added, pointing back
to its existing loud home in that file's Task 9.3 intro. I judged that existing home sufficient and did
not add a further one. Likewise the pre-existing forbidden-non-null-assertion lint warning in
`getRemotes` (noise, no behaviour, already correctly untouched) — not filed, not new information.

---

## 3. Item 12's record, called out separately

**Path**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_218\task.md` (+ `context.md` in the same
folder).

**Status text, quoted verbatim from the carrier**:

- `task.md` frontmatter `title`: `HIGH -- REQUIRED BEFORE D2 IS DONE: git:applyHunks has NEVER been exercised end-to-end in Electron`
- `task.md` body opens with the heading `# HIGH — REQUIRED BEFORE D2 IS DONE` and closes with
  `**Status: HIGH — REQUIRED BEFORE D2 IS DONE.**`
- `context.md` opens with `# STATUS: HIGH — REQUIRED BEFORE D2 IS DONE`

The status is in the carrier's **title and body**, not buried in a table row, per dispatch §4.1.
`context.md` carries the full 8A/8B/8C provenance, the honest "every corruption-risk guard is proven;
the UI's live wiring is not" framing verbatim, and the one-line fix (Playwright `_electron` smoke).
Items 15 (`TASK_2026_221`) and 16 (`TASK_2026_222`) both `depends_on: [TASK_2026_218]` and their
records state they should be verified in the same harness this item builds.

---

## 4. IDs scanned, highest folder, collisions

**Method**: for each of the 21 records, a fresh `ls -d .ptah/specs/TASK_2026_* | sort | tail` scan
determined the next ID immediately before an atomic `mkdir` (which itself fails if the folder already
exists, so a same-instant collision with another session would have been caught and retried — none
occurred).

- **Highest folder at the start of this session's scan**: `TASK_2026_202` (confirmed independently by
  the initial scan before reading the dispatch, and again immediately before allocation).
- **First new record**: `TASK_2026_203`, matching the dispatch's own prediction.
- **IDs allocated, in order**: `TASK_2026_203` through `TASK_2026_223` (21 consecutive IDs, no gaps).
- **Collisions encountered**: **none.** The 21-iteration allocation loop ran to completion without any
  `mkdir` failure, meaning no other session claimed a folder in the `TASK_2026_20x` range during this
  batch's execution window.

---

## 5. What could not be filed

**Nothing.** All 21 required records (B6, both R-3 findings, the glob drift, and all seventeen
register items) were filed successfully, each with parseable frontmatter (verified — see §6) and a
concrete one-line fix (or, for items 7 and 13, an explicit statement of why a naive one-line fix is
insufficient and what the real fix requires, per the register's own text for those two items).

`measurements.md` was already complete (M1–M4, before/after, median/max/workload/sample-count/method)
from prior batches — no edit was needed there to satisfy the Batch 9 Acceptance Criteria's
`measurements.md` line.

---

## 6. Carrier verification (no product code touched)

Every one of the 21 `task.md` files was parsed with the same `gray-matter` library the codebase's own
`task-frontmatter.ts` uses, and checked against `TaskFrontmatterSchema`'s essential constraints
(`status` in `TASK_STATUSES`, `type` in `TASK_TYPES` when present, non-empty `title`, `description` a
plain string). **All 21 parsed and validated successfully; all 21 have a sibling `context.md`.** Full
per-record output is in this session's tool transcript, not reproduced here.

**Confirmation that no file under `libs/` or `apps/` was modified**: `git status --porcelain -- libs
apps`, run both before drafting and again after all writes, shows only pre-existing modifications in
`platform-core`, `rpc-handlers/workspace-rpc.handlers.*`, `task-specs/normalize-workspace-root.ts`, and
`workspace-intelligence` — all belonging to the other concurrent sessions the dispatch names explicitly
in its Standing Constraints §5.1. This session performed **zero** `Edit`/`Write` calls under `libs/` or
`apps/`; all reads of files under those trees (e.g. `editor-rpc.handlers.ts`,
`workspace-scan.constants.ts`, `r3-triage.md`) were read-only, for quoting exact content into the new
records' `context.md` files.

**No commit was made.** No `git add`, `git stash`, `git checkout`, or `git reset` was run. `team-leader`
owns git per the dispatch's constraints §7.
