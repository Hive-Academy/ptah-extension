# Mode 2 (verify only, no commit) - session 12 fix round - TASK_2026_629_c0b3

Verdict: **PASS**. All 4 projects pass their full suites, typecheck and lint with 0 errors. Every
lint warning the round added is in an attributed spec or import. The working tree has 25 paths,
but they are not the 25 the prompt expected (see section 1).

- Worktree W: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
- Branch: `feat/task-629-canvas-board`
- HEAD: `51edd8644` (not moved)
- Decision rows: 110-119. The orchestrator commits (row 95). Nothing was staged, stashed,
  restored or edited.
- Inputs:
  - Lane reports: rail-actions-inside, agents-dedupe, split-headers, fix-d, fix-h.
  - C-card review: `codex-review-rail-actions-inside.md`, APPROVE 8/10.
  - C-dedupe reviews: `code-logic-review-agents-dedupe.md` REVISE 6/10, then
    `code-logic-review-fix-d.md` APPROVE 7/10.
  - C-headers reviews: `codex-review-split-headers.md` REVISE 6/10, then
    `codex-review-split-headers-fix.md` APPROVE 9/10.
- Every phase review is accepting. M1, M2 and m1-m4 from the Fix D review and Moderate 3 from
  the C-headers review are recorded, not fixed (rows 118-119).

## 1. Path check (`git status --short libs apps`)

`git status --short libs apps` lists 25 paths: 24 modified and 1 untracked. The count matches,
but the set does not match the expected one.

- **Missing from the expected set:**
  `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`
  - It is in the C-dedupe row of handoff-11 §3, but it is now identical to HEAD (no status
    entry, empty `git diff HEAD`).
  - Cause: C-dedupe only added the dock null assertion at former line 1289 (review finding 4).
    Fix D removed it (`lane-fix-d-report.md`, change 3), so the net change is zero.
  - Test count is the same: 37 cases at HEAD and now. Nothing to commit for this file.
- **In the tree but not in the "22 + 3" list:**
  `libs/frontend/chat/src/lib/components/organisms/execution/workflow-card.component.ts`
  (modified by Fix D, finding 1 Option A). The prompt already names it as a Fix D change.
- Net result: 22 - 1 + 3 + 1 = 25. The expected set with `workflow-card.component.ts` added
  would be 26, so the 25 is a coincidence of one dropped and one added path.
- No other paths are modified. No stray files exist under `apps`.
- **Line endings:** 8 files written by the codex lane have CRLF in the working copy. Git warns
  "CRLF will be replaced by LF" and normalizes them when they are staged. `git diff` is already
  normalized, so it shows no whole-file churn. The files:
  - `display-dock.component.ts` and `.spec.ts`
  - `chat-view.component.ts`, `.html`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`
  - `session-context.token.ts`
  - `conductor-tile.component.ts`

### Code check

I read the production diffs on disk (spot check), not only the reports.

- `canvas-detail.service.ts` `open()` now returns `boolean`. It returns `false` when the tile or
  lane is missing, and it checks ownership against `AgentMonitorStore` and
  `BackgroundAgentStore`.
- `workflow-card.component.ts` shows a static label in Electron and keeps the panel request in
  VS Code (`@if (!isElectron)`).
- No changed file has TODO, FIXME, PLACEHOLDER or STUB markers.
- The new import from `canvas` to `@ptah-extension/chat-streaming` passes lint, including the
  module-boundary rule.

## 2. Checks

Each command ran on its own, one at a time, through
`node .ptah/tmp/check-run.mjs <label> --`, with `--parallel=1 --skip-nx-cache`. Tests also used
`--coverage=false --maxWorkers=2`. Logs are in `%TEMP%\629-check-s12-<label>.log`. Every
command exited with code 0.

### Tests (full suite per project)

| Project | Suites | Passed | Failed | Skipped | Baseline (201175e0e) | Delta |
|---|---|---|---|---|---|---|
| canvas | 23 / 23 | 345 | 0 | 0 | 23 / 334 | +11 tests |
| chat | 204 / 204 | 3715 | 0 | 2 | 203 / 3728 + 2 skipped | +1 suite, -13 tests |
| chat-ui | 72 / 72 | 1424 | 0 | 0 | not recorded; this run is the baseline | n/a |
| tribunal-panel | 17 / 17 | 336 | 0 | 0 | 17 / 336 | 0 |

**Canvas, +11 tests.** I counted `it(` cases in each changed spec, HEAD against working tree.
The total is exactly +11:

| Spec | Change | Cases |
|---|---|---|
| `canvas-focus-header.component.spec.ts` | C-headers | +5 |
| `canvas-rail-board.component.spec.ts` | C-headers | +4 |
| `canvas-focus-area.component.spec.ts` | C-headers | +1 |
| `canvas-detail.service.spec.ts` | Fix D | +1 |
| `canvas-detail-transcript.component.spec.ts` | C-dedupe / Fix D | 1 added, 1 removed |
| `canvas-rail-card.component.spec.ts` | C-card | 1 added, 1 removed |

**Chat, -13 tests.** The total is exactly -13. Every removed case covered the Agents tab, which
the user approved removing (row 112).

| Spec | Change | Cases |
|---|---|---|
| `display-dock.component.spec.ts` | C-dedupe | 24 → 14, so -10. HEAD's 23 cases include a 2-row `it.each` (former line 246), which runs as 24 tests. |
| `chat-view.dock.spec.ts` | C-dedupe | 28 → 23, so -5 |
| `workflow-card.component.spec.ts` | Fix D, new file | +2, and +1 suite |

### Typecheck

| Project | Errors | Baseline |
|---|---|---|
| canvas | 0 | 0 |
| chat | 0 | 0 |
| chat-ui | 0 | 0 |
| tribunal-panel | 0 | 0 |

### Lint

| Project | Errors | Warnings | Baseline warnings | New warnings |
|---|---|---|---|---|
| canvas | 0 | 31 | 28 | +3 |
| chat | 0 | 42 | 40 | +2 |
| chat-ui | 0 | 7 | not recorded; 7 is the baseline | none in changed files |
| tribunal-panel | 0 | 0 | 0 | 0 |

I found the new warnings with `git blame` on the working copy. Blame marks lines that are not
yet committed, and lines whose meaning the change altered are checked by hand. Canvas +3 and
chat +2 match the deltas exactly.

| # | File:line | Rule | Owner |
|---|---|---|---|
| 1 | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts:151` | no-non-null-assertion | C-headers / Fix H (new spec lines) |
| 2 | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts:153` | no-non-null-assertion | C-headers / Fix H |
| 3 | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts:200` | no-non-null-assertion | C-headers / Fix H |
| 4 | `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:98` | no-unused-vars, `AgentMonitorPanelComponent` | C-dedupe (the import is old; its only use was removed with the Agents tab) |
| 5 | `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts:88` | no-unused-vars, `AgentMonitorPanelComponent` | C-dedupe (same cause) |

All 5 are warnings in spec files only, so they do not block. Warnings 4 and 5 are 2 dead
imports that can be deleted in one line each. They are recorded here, not fixed (lean rule 4,
Minor). The orchestrator can drop them while committing C-dedupe if it wants the chat count back
at 40.

Other warnings in changed files were already present at HEAD and are in the baseline counts:

- the remaining non-null assertions in the focus-header spec, from commits `f43b0356c` and
  `4cf6d4f83`;
- the board spec non-null assertions and `$any` at line 120, from `4cf6d4f83`;
- max-lines warnings in `canvas-rail-board.component.ts` (754 lines) and
  `chat-view.component.ts` (1346 lines). Both are the existing R9 cleanup item (row 108).

## 3. Proposed commit split (for the orchestrator)

- Scopes `canvas`, `chat`, `chat-ui` and `tribunal-panel` are all in the `scope-enum` of
  `W\.commitlintrc.json`.
- `subject-case` rejects sentence case, so each subject starts with a lowercase word.
- Every subject is 72 characters or fewer.
- Paths are relative to W.

**Commit order: C-dedupe + Fix D, then C-headers + Fix H, then C-card.** The shared board spec
needs this order (see the board spec row under "Files shared between groups").

### Commit 1: C-dedupe + Fix D (rows 112, 116, 117, 119), 14 paths

`fix(chat,canvas,tribunal-panel): dedupe agents, fix sub-agent click` (67 characters)

- `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`
- `libs/frontend/chat/src/lib/tokens/session-context.token.ts`
- `libs/frontend/chat/src/lib/components/organisms/execution/workflow-card.component.ts` (Fix D)
- `libs/frontend/chat/src/lib/components/organisms/execution/workflow-card.component.spec.ts`
  (Fix D, untracked, so `git add` it explicitly)
- `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`
  (C-dedupe + Fix D)
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`
  (C-dedupe + Fix D)
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts` (Fix D)
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts` (Fix D)

The body should name the user-approved removal of the dock Agents tab (row 112) and record M1,
M2 and m1-m4 as not fixed (row 119).

### Commit 2: C-headers + Fix H (rows 113, 117, 118, 119), 6 paths

`feat(canvas): split pane divider, active header accent and 1/2 markers` (70 characters)

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
  (the whole file, including the C-card stub line; see below)

The body should record Moderate 3 (contrast is checked after the test run) as not fixed.

### Commit 3: C-card (rows 110, 111), 5 paths

`feat(canvas,chat-ui,chat): rail card actions inside, focused highlight` (70 characters)

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`
  (one-line input passthrough)

The three commits list 14 + 6 + 5 = 25 paths, which equals the tree.

### Files shared between groups

- **`canvas-rail-board.component.spec.ts`: C-headers specs plus the C-card stub line.**
  - The C-card part is line 103, `readonly reserveActionCorner = input(false);` in
    `SelectCardStub` (row 117). Everything else in that file's diff is C-headers / Fix H (the 4
    "row 113" cases).
  - Without the stub line, the real `canvas-rail-card.component.ts:133` binds
    `[reserveActionCorner]="true"` onto the stub, which fails with NG0303 in 3 board cases.
  - The extra stub input does nothing while the card does not bind it, so the file is safe to
    commit before C-card.
  - **Commit 2 takes the whole file**, and Commit 3 follows, so every commit should stay green.
    This is reasoned only: per-commit checks were not run, because that would need a checkout.
  - If the orchestrator wants C-card first instead, it has to stage that one hunk with C-card.
    `git add -p` is interactive and unsupported here, so it would need
    `git diff -U0 <file>` → keep only the line-103 hunk → `git apply --cached --unidiff-zero`.
    That path is more fragile, so I do not recommend it.
- **`canvas-detail-transcript.component.ts` and `.spec.ts`: C-dedupe plus Fix D.** Both go in
  Commit 1 with no split.
- **`chat-view.component.ts`: C-dedupe plus the Fix D sentence fix.** Commit 1.
- **`display-dock.component.ts`: C-dedupe plus the Fix D import cleanup.** Commit 1.
- No file is shared between C-card and C-dedupe.

### Notes for committing

- Commit in the foreground. Lint-staged (pre-commit) will normalize the 8 CRLF files and may
  run Prettier on them. Run `git diff --cached --stat` afterwards and expect the same line counts
  as section 1.
- Read the `.commitlintrc.json` body rules: lines at most 100 characters (CLAUDE.md asks for
  72 wrap).

## 4. Verdict

**PASS.**

- Tests:
  - canvas: 23 suites, 345 tests.
  - chat: 204 suites, 3715 tests, 2 skipped.
  - chat-ui: 72 suites, 1424 tests.
  - tribunal-panel: 17 suites, 336 tests.
- Typecheck: 0 errors.
- Lint: 0 errors.
- Every test-count delta is accounted for by named added or removed cases.
- Lint warnings: +3 in canvas specs (C-headers) and +2 dead imports in chat specs (C-dedupe).
  All are Minor and recorded, not fixed.
- The path set differs from the expected set as described in section 1 (one path dropped by a
  net-zero edit, one Fix D path added). That is not a defect.

Still due after the commits (row 95 and handoff-8 step 7, not part of this Mode 2):

- the renderer rebuild;
- the user's Electron re-test;
- the dark and light contrast re-check for C-card and C-headers.

The final "before/after" visual evidence and Mode 3 come after that.
