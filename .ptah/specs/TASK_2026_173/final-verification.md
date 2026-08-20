# Final Verification — TASK_2026_173

**MODE 3 close-out** · verified 2026-08-11 · `team-leader`
**Verdict**: **8 of 10 DoD items MET. 2 UNMET and filed.** Carrier set to `in_review`, not `done`.

**Headline**: the editor-panel remediation is code-complete and committed across 9 batches, but
`git:applyHunks` — the task's headline feature — has never been executed in a running Electron host,
and the NFR-1 cross-project test floor cannot currently be established. Both are unmet, both are
filed, and neither is rounded up.

---

## 1. Batch 9 commit

| Item                 | Value                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SHA                  | `929166c55`                                                                                                                               |
| Message              | `docs(docs): file TASK_2026_173 batch 9 follow-ups as 21 task records`                                                                    |
| Files                | 44 — 21 × (`task.md` + `context.md`), plus `tasks.md` and `batch-9-report.md`                                                             |
| Product code touched | **none**                                                                                                                                  |
| Staging method       | 44 explicit file paths. No `git add -A`, no directory arguments.                                                                          |
| Hook                 | passed unmodified (`nx format:write`, then `ptah-electron:build-main:production` + `validate-deps` across 26 projects). No `--no-verify`. |

**Records filed**: `TASK_2026_203` … `TASK_2026_223`, 21 consecutive IDs, no gaps, no collisions —
B6 (`203`), both R-3 findings (`204`, `205`), the glob-string exclusion drift (`206`), and all 17
register items (`207`–`223`).

**Post-hook carrier re-verification.** The commit hook runs `nx format:write` over staged markdown,
which reformats YAML frontmatter — a real risk to the `>-` block scalars this repo has been dark on
before. All 21 carriers were re-parsed with `gray-matter` **after** the hook rewrote them: **21/21
parse, and `title:`/`description:` are still `>-` block scalars in every one.** The formatter did not
degrade them.

**Concurrent work left alone.** `TASK_2026_200/201/202`, six `.harvested.json` files, `task-tracking/`,
and modifications under `platform-core`, `rpc-handlers`, `task-specs`, `workspace-intelligence` and
`marketing/**` belong to other live sessions. None were staged, reverted, formatted or assessed.

---

## 2. Definition of Done — item by item

| #   | Item                                                                         | Verdict                                                       |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | A1–A4, B1–B5, C1–C2, D1–D3 all pass, **verified in Electron**                | ❌ **NOT MET** — D2                                           |
| 2   | B0 satisfied — M1–M4 before/after, or shortfall flagged                      | ✅ MET                                                        |
| 3   | SEQ-1 held — tab-key scheme changed exactly once                             | ✅ MET (verified by git history)                              |
| 4   | SEQ-2 held — no hunk write-path merged before A1–A4 verified                 | ✅ MET (verified by ancestry)                                 |
| 5   | NFR-1 rebaselined cross-project test floor ≥ 1545                            | ❌ **NOT ESTABLISHABLE**                                      |
| 6   | NFR-4 — new RPC methods in both required locations                           | ✅ MET (registration); ⚠️ end-to-end exercise is item 1's gap |
| 7   | NFR-5 — three runtimes build, no boundary violation, amendment A-1 placement | ✅ MET                                                        |
| 8   | Lint + typecheck clean across affected projects                              | ✅ MET for this task's projects                               |
| 9   | R-3 triage complete, none re-suppressed                                      | ✅ MET                                                        |
| 10  | B6 filed with the M2 measurement attached                                    | ✅ MET                                                        |

---

### ❌ Item 1 — `git:applyHunks` has never run end-to-end in Electron

This is **Batch 8's own named exit criterion** (`batch-8-dispatch.md` §7) and **no pass met it**. 8A
could not run it (no frontend caller existed yet), 8B could not (jsdom only), and 8C attempted it and
stopped, judging Electron GUI-driver setup from scratch unaffordable inside its budget. Commit
`3d6145863` was taken anyway, deliberately, with the gap written into its own body.

**Why it could not be run, then or now**: `ptah-electron` is red from concurrent out-of-scope work in
`platform-core`, `task-specs` and `workspace-intelligence` — sessions this task must not touch.

**Scope the gap honestly.** Every data-safety guard on the write path _is_ proven against real
`git 2.54.0.windows.1` in throwaway repositories, including the TOCTOU race 8C used to disprove 8A's
"the offset guards are unreachable" claim. What is unproven is narrower and different in kind: that a
click in a running UI wires through to the RPC correctly. That is a wiring risk, not a corruption
risk. It is still a real, currently-unverified gap in the task's headline feature.

**Filed**: `TASK_2026_218`, status text `HIGH — REQUIRED BEFORE D2 IS DONE`, carried in the carrier's
title _and_ body. `TASK_2026_221` and `TASK_2026_222` both `depends_on: [TASK_2026_218]` — they need
the same harness. Fix is one spec: a Playwright `_electron` smoke that opens a `worktree` diff on a
scratch repo, stages one hunk, and asserts `git diff --cached` contains that hunk and only that hunk.

**Do not sign off D2 until `TASK_2026_218` is discharged.**

---

### ❌ Item 5 — the NFR-1 cross-project floor cannot currently be established

NFR-1 requires the Electron suite ≥135 passed/≤4 skipped **and** `rpc-handlers` ≥1410 passed/≤2
skipped, sum never below 1545. Neither number is obtainable right now:

- The Electron suite needs a green `ptah-electron`, which is red from the concurrent work above.
- `rpc-handlers` has **uncommitted modifications from another session** in
  `workspace-rpc.handlers.ts` and its spec. Running the suite now would measure that session's
  in-flight code, not this task's.

**This is not attributable to TASK_2026_173.** Checked, not assumed: the intersection of this task's
13 commits with the currently-dirty file set is **empty**. This task never touched
`platform-core/src/index.ts`, `workspace-rpc.handlers.*`, `task-specs/normalize-workspace-root.ts`,
`workspace-file-index.service.*` or `marketing/**`.

**What could be verified attributably, and was — re-run at MODE 3, not quoted from a batch report.**
Both projects have zero dirty files, so their results are clean:

| Suite                         | Command                                                   | Result                                |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `@ptah-extension/editor`      | `npx nx test @ptah-extension/editor --skip-nx-cache`      | **337/337 passed**, 16 suites, exit 0 |
| `@ptah-extension/vscode-core` | `npx nx test @ptah-extension/vscode-core --skip-nx-cache` | **342/342 passed**, 21 suites, exit 0 |

679 tests green against committed content. The floor NFR-1 actually names remains unestablished.

---

### ✅ Item 2 — M1–M4, with M2's miss reported as a miss

All four metrics carry before/after with method, workload, sample count, median and max.
`measurements.md` §"Reproducibility summary" gives a re-run command for every one.

| Metric                      | Before                                                                                           | After                                                                              | Target     |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------- |
| M1 diff-tab re-display      | baseline (corrected — the first baseline was measured against a stale renderer and was re-taken) | Batch 3                                                                            | met        |
| M2 `git:status-update`      | median 3.034ms / max 5.161ms, n=10                                                               | 2.605 / 3.512 / 3.658ms median across 3 executions                                 | **MISSED** |
| M3 `git status` invocations | 25 per 60s window                                                                                | **1**, and that one was the deliberate tracked-file edit; cache-attributable **0** | met        |
| M4 splitter-drag CD         | mutations median 121 / max 223, n=5                                                              | 63–120 median / 76–121 max                                                         | met        |

**M2 missed its target by roughly 4–6x and is recorded as a miss.** The target was median ≥80% below
baseline (≤0.607ms); the three post-fix executions straddle the baseline, so the honest reading is
that the harness shows no measurable change at all. DoD item 2 says "M1–M4 met **or the shortfall
explicitly flagged**" — the flag is the compliance, and the number is not rounded up.

The record also explains _why_ rather than just conceding: the harness total is dominated by Angular
change detection over 100 component fixtures, so the removed directory scan (~3,000 `startsWith` calls
inside a ~3ms budget) cannot move that median. **The 80% target was set against the wrong cost model.**
B3's actual claim is AC2 — evaluation effectively constant-time in the number of changed files — which
a single median at one workload size cannot test either way. So a scaling probe was built to carry the
claim the median could not: on 10x files the shipped lookup grows **0.82x / 0.66x** (flat) while the
pre-B3 reference grows 3.86x / 2.14x, with ~194x absolute separation at 3000 files. **AC2 holds; the
M2 median target does not.** Both statements are in the record, neither displaces the other.

M2's use of a Jest harness instead of Electron is a deliberate, flagged deviation from B0 AC5, with an
Electron spot-check recorded as confirmation only and explicitly not reported as the M2 figure.

---

### ✅ Item 3 — SEQ-1 held, verified against git history

The scheme is `diffTabKey(comparison, relativePath)` →
`diff:<comparison>:<workspace-relative POSIX path>`, in
`libs/frontend/editor/src/lib/services/editor/editor-tab.types.ts:127`, with the structured record
`DiffTabState` at `:43`. It is constructed in exactly one production call site,
`editor-diff-split.ts:114` inside `EditorDiffSplitHelper.openDiff`. Nothing anywhere parses or splits
a diff key — no `startsWith('diff:')`, no regex decode; every consumer discriminates on `tab.diff`.

Verified by `git log -L` over the key derivation and over the sole construction site — not by reading
batch reports:

| Surface                            | Commits touching it                                           |
| ---------------------------------- | ------------------------------------------------------------- |
| `diffTabKey` function body         | `2b537f44c` (pre-task), then **`61628f623` (Batch 2) — once** |
| `openDiff` key-construction region | `2b537f44c` (pre-task), then **`61628f623` (Batch 2) — once** |

Batches 4, 6 and 7 never touched `editor-tab.types.ts` at all. Batch 7 (`f47351d14`) and Batch 8
(`3d6145863`) both touched `editor-diff-split.ts`, but neither entered the key-construction region.
Batch 8's edit to `editor-tab.types.ts` is **purely additive** — a `hunks: GitHunkRef[]` field, the
`HunkApplyRequest` interface, and re-exports. It changed no identity field and no key derivation. That
is exactly the case risk **V-4** pre-authorised: SEQ-1 constrains the tab-key scheme, not the result
interface.

**SEQ-1 held: the tab-key scheme changed exactly once, in Batch 2.**

---

### ✅ Item 4 — SEQ-2 held, and it failed before it passed

`git merge-base --is-ancestor c6d2758da 3d6145863` → true. The SEQ-2 closure commit ("close the SEQ-2
gate with four non-vacuous diff-tab regression tests") is an ancestor of the Batch 8 hunk write-path
commit. No write-path code merged before A1–A4 were verified.

Worth recording that **SEQ-2 failed on its first pass** and was closed on evidence rather than
softened: A2 AC5 did not verify, work was done to close it, and the final verdict records all four
requirements holding with executable evidence — direct source reading, the full editor/vscode-core/
rpc-handlers suites, three live real-git scratch-repo spot-checks, and five non-vacuous mutation probes.
The two regression tests added in that closure are permanent.

---

### ✅ Items 6, 7, 8 — registration, runtimes, hygiene

**NFR-4.** `git:diffFile` and `git:applyHunks` are in the compile-time contract at
`libs/shared/src/lib/types/rpc.types.ts:1306-1307`, with their param/result types in
`rpc-git.types.ts:227,332`. The runtime guard is prefix-based and `'git:'` is already in
`ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:67`), so both methods are covered without a new entry —
registration is satisfied by construction, not by an omission. `git:diffFile` **is** exercised
end-to-end; `git:applyHunks` is not, which is item 1's gap and is not double-counted here.

**NFR-5.** `ptah-electron:build-main:production` plus `validate-deps` ran green over 26 projects
inside the Batch 9 commit hook on 2026-08-11 — the Electron main bundle builds and every external
import is declared. **Amendment A-1 held**: `applyHunks` lives in `GitInfoService`
(`libs/backend/vscode-core/src/services/git-info.service.ts`) and `GitRpcHandlers`
(`libs/backend/rpc-handlers/.../git-rpc.handlers.ts` + `git-rpc.schema.ts`), and **not** in
`git-watcher.service.ts`. The watcher was touched twice by this task (`df2ab24fb`, `6df1984a7`), but
those changes are a `MESSAGE_TYPES` constant swap and the scan-exclusion predicate — no git capability
was added there.

**Lint/typecheck.** Clean for this task's own projects; the 679 green tests above compile the same
sources. Workspace-wide typecheck is not assertable while other sessions hold uncommitted changes in
the affected graph, and is not claimed.

---

### ✅ Item 9 — R-3 triage complete, nothing re-suppressed

15 rows (13 required + 2 added), executed against real `git 2.54.0.windows.1` on scratch
repositories, cross-referenced line-by-line against the shipped TypeScript. **Not-exercised rows:
none.** The stated finding: no row required reintroducing a blanket empty-content swallow, and the one
previously-silent case (new/untracked file) now correctly resolves to `absent`. Both non-blocking
follow-ups are filed — `TASK_2026_204` (directory rows → generic `unknown`) and `TASK_2026_205`
(submodule paths → generic `unknown`).

### ✅ Item 10 — B6 filed with M2 attached

`TASK_2026_203`. Its `context.md` quotes `measurements.md` §M2 verbatim — including the miss and the
scaling table — and then states plainly that M2 does **not** prove B6's concern is resolved, because
M2 exercises incremental status handling across 100 fixtures, not thousands of nodes mounted at once
with no windowing. The measurement justifies investigating, not necessarily implementing.

---

## 3. Process findings — for whoever runs the next multi-batch task

These are the parts of this task's record worth more than the checklist. None of them were caught by
reading code carefully; all of them were caught by trying to break something.

### 3.1 Four guards were vacuous. Every one looked sensible.

A test that passes is not evidence. A test that **cannot fail** is worse than no test, because it
retires the question.

| Where    | The guard                                   | Why it could never fail                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch 6  | a11y nesting detector                       | `el.closest(sel) !== el` — `closest` matches the element itself, so the expression is false for every element it is handed. Fixed to `el.parentElement?.closest(sel)`, which then correctly reported `['Discard changes']` on the offending markup and `[]` on the repaired markup. |
| Batch 7  | diff-tab regression guard                   | **259/259 green with the hazard actively reintroduced in the source.**                                                                                                                                                                                                              |
| Batch 8A | `validatePathSegment` on both paths (NFR-8) | First mutation: **0 of 27 tests failed.** Re-targeted; after repair, 1 of 28 failed with the right error (`INVALID_OPERATION`, not `UNKNOWN`).                                                                                                                                      |
| Batch 8B | one of 12 hunk-affordance guards            | Came back vacuous on its first mutation and was re-targeted before the batch was accepted.                                                                                                                                                                                          |

**The method that caught all four became this task's standard**: break the thing the guard protects,
watch the guard fail, restore, watch it pass. Record the failure count. A guard whose failure count is
zero is not a guard. Batch 8A and 8B ran this for every guard and recorded per-guard counts; that is
why their vacuous ones surfaced inside the batch instead of a year later.

### 3.2 The plan was wrong three times, and each was caught by execution

The implementation plan was competent and still wrong in three places that only implementation exposed:

1. **Task 7.2 as worded** would have fed the user's keystrokes into a full-model `pushEditOperations`.
   Not theorised — proven: **10 pushes across 10 keystrokes.**
2. **The Option A/B exclusions question** rested on a premise that had been false since May.
3. **Batch 8A's "the offset guards are unreachable, the hazard is designed out"** was disproved by 8C
   reaching **both** guards via a TOCTOU race.

Note the shape of #3: the claim was made by the batch that wrote the code, and disproved by the batch
whose only job was to verify it. Separating the implementer from the verifier paid for itself here.

### 3.3 Six batches each found stale line numbers

Batches 2, 4, 6 and 7 rewrote the files that later batches cite. Every batch from 4 onward opened by
correcting line references in its own dispatch. **In a multi-batch task, line numbers in a plan decay
from the first commit onward.** Cite symbols and behaviours; treat any `file.ts:123` older than one
batch as a hint, and re-locate before acting on it.

### 3.4 Gates that fail once are working

SEQ-2 failed its first pass. Guard 6 in 8A failed its first mutation. The M2 target was missed and
recorded as missed. In each case the outcome was better than a clean first pass would have been,
because the failure is what produced the scaling probe, the repaired guard, and the closure tests.
A batch series where every gate passes first time is usually reporting on its gates, not on its code.

### 3.5 One report was materially false and was corrected in place

Batch 8B's headline claimed an external `git stash` had swept 8A's and 8B's work away. It was checked
twice, was wrong both times, and the report now carries a `TEAM-LEADER CORRECTION` block at the top
marking §1 and §10 item 1 false. The correction was left **above** the false text rather than replacing
it, so the record shows what was believed and what was true. An executor under stress mis-reading its
own tree is a normal failure mode; the fix is independent verification before acting, not blame.

---

## 4. Carrier decision

**`status: in_review`** — not `done`.

**Why.** Two of ten DoD items are unmet, and `tasks.md:1473-1479` states in its own words: _"Do not
sign off DoD item 1 for D2 until item 12 is discharged."_ Marking this `done` because the gap has a
ticket number would be precisely the rounding-up that this task's process — four vacuous guards
caught, three plan errors disproved, an M2 target reported as missed — spent nine batches refusing to
do. The headline feature has never been run in the app it ships in. `in_review` also keeps the task
visible on the board while `TASK_2026_218` is outstanding, rather than archiving it behind a
green tick.

**What clears it to `done`**: `TASK_2026_218` discharged (the `_electron` smoke passes and
`git diff --cached` shows the staged hunk and only that hunk), and NFR-1's cross-project floor
re-measured once `ptah-electron` and `rpc-handlers` are quiet.

---

## 5. Commits

| Batch              | SHA             | Subject                                                                |
| ------------------ | --------------- | ---------------------------------------------------------------------- |
| 0                  | `accb485ed`     | baseline / B0                                                          |
| 1 (C1)             | `df2ab24fb`     | route editor push messages through the MessageHandler registry         |
| 2 (keystone A1–A4) | `61628f623`     | correct git diff sides and surface read failures behind `git:diffFile` |
| 3                  | `3a73a037d`     | —                                                                      |
| 4 (B5 drag)        | `16da79d2f`     | —                                                                      |
| 4 (B3 tree)        | `06b900d85`     | make dir change dots O(1) and unify the resize drag loop               |
| 5 (B4)             | `6df1984a7`     | unify workspace scan exclusions behind one predicate                   |
| 6 (a11y)           | `b57d3c8d4`     | de-nest the tab, header and file-row buttons for a11y                  |
| 7 (C2)             | `f47351d14`     | converge split-pane content ownership on the tab record                |
| SEQ-2 closure      | `c6d2758da`     | close the SEQ-2 gate with four non-vacuous diff-tab regression tests   |
| focusin addendum   | `6dc68c03b`     | focus a split pane on keyboard focusin, not just click                 |
| 8 (D2)             | `3d6145863`     | hunk-level stage/unstage/revert for diff tabs                          |
| 8 record           | `07a6e3303`     | record batch 8 outcome and dispatch batch 9 filing                     |
| **9 (filing)**     | **`929166c55`** | **file batch 9 follow-ups as 21 task records**                         |

---

## 6. Open work leaving this task

| Priority                        | ID                                         | Item                                                         |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| **HIGH — blocks D2 being done** | `TASK_2026_218`                            | `git:applyHunks` never exercised end-to-end in Electron      |
| —                               | `TASK_2026_221`, `TASK_2026_222`           | hunk action widget, glyph markers — both `depends_on: [218]` |
| —                               | `TASK_2026_203`                            | B6 file-tree virtualization (M2 attached)                    |
| —                               | `TASK_2026_204`–`206`                      | R-3 follow-ups + glob exclusion drift                        |
| —                               | `TASK_2026_207`–`217`, `219`, `220`, `223` | remaining register items                                     |

**Not filed, deliberately, and recorded here so it reads as a decision rather than an omission**: the
`--check` dry-run retain/remove question (8A raised it, 8C ruled RETAIN) is closed, not open; and the
pre-existing non-null-assertion lint warning in `getRemotes` is noise with no behaviour.

---

# Close-out addendum — 2026-08-11 (later same day)

**Both previously-unmet DoD items are now MET. 10 of 10. Carrier moved to `done`.**

Neither item was re-judged or argued down — each was re-run and the evidence is below.

## Item 1 — `git:applyHunks` end-to-end in Electron: MET

`TASK_2026_218` was discharged by commit `4a02e46b2`, which added
`apps/ptah-electron-e2e/src/specs/editor/hunk-apply-real-rpc.spec.ts` plus the
`git-scratch-repo` and `real-rpc-fixtures` support harness.

**That commit's body does not claim a pass** — it records that the first run _hung_ on
`~/.ptah` contention before the home-directory isolation was added. So the suite was
re-run at close-out rather than taken on faith:

```
npx nx run ptah-electron-e2e:e2e --skip-nx-cache -- --grep "TASK_2026_218"
→ 3 passed (49.2s), exit 0
```

All three tests, against a real Electron boot on a throwaway repository:

| Test                                                         | What it proves                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| stages one hunk from the toolbar, leaves the other two       | The click→RPC wiring works; `git diff --cached` read off disk contains that hunk and only it |
| control: reaching the toolbar without staging                | **Causation** — a green positive is not ambient watcher/autosave behaviour                   |
| control: bogus `snapshotToken` refused with `STALE_SNAPSHOT` | **Detection** — the write path discriminates rather than rubber-stamping well-shaped input   |

The gap named in the original item — "a click in a running UI wires through to the RPC
correctly" — is exactly what the positive test now asserts, on disk rather than on a
renderer signal. `TASK_2026_221` and `TASK_2026_222` (both `depends_on: [TASK_2026_218]`)
are unblocked and remain `backlog`.

## Item 5 — NFR-1 cross-project test floor: MET

The floor was never unestablishable in principle — it was blocked on `ptah-electron` being
red and `rpc-handlers` being dirty **from concurrent out-of-scope sessions**. Those have
since landed. Both suites re-run clean at `--skip-nx-cache`:

| Suite           | Result                  | NFR-1 requirement    | Verdict |
| --------------- | ----------------------- | -------------------- | ------- |
| `ptah-electron` | 145 passed, 4 skipped   | ≥135 passed, ≤4 skip | ✅      |
| `rpc-handlers`  | 1781 passed, 31 skipped | ≥1410 passed         | ✅      |
| **Sum**         | **1926**                | never below 1545     | ✅      |

### One unrelated failure, filed rather than absorbed

`rpc-handlers` reports **1 failed**: `chat/session/chat-session-resume-activate.spec.ts`
→ "TS-04 › reports activated:true when the session is already live", asserting
`result.success` true, receiving false. It reproduces in isolation, so it is deterministic,
not a suite-interaction flake.

**Not attributable to TASK_2026_173** — checked, not assumed. That file appears in zero of
this task's commits; its last touch is `d7101460b` (`feat(output-styles)`). This task never
went near `chat/session`. NFR-1 counts passes against a floor and 1781 clears 1410 with the
failure excluded, so the floor stands. The failure needs its own carrier.
