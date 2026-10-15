# Mode 2 H7 report: batch R9x (verify only, no commit)

Task: TASK_2026_629_c0b3. Worktree W:
`D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
(branch `feat/task-629-canvas-board`, HEAD `916c0685f`). Contract: `batches-rail-r9.md:606-646`,
including the "Added by rows 105 and 106" block. Inputs: `lane-R9x-report.md`, `lane-R9x-fix-report.md`,
`codex-review-R9x.md` (REVISE 6/10), decision row 107, `codex-review-R9x-fix.md` (re-review).

**Verdict: PASS.** All seven scoped checks exit 0 with 0 errors. The canvas suite grows from 304
to 331 tests and every test passes. The codex re-review approves the fix round (8/10). Nothing
was committed (decision row 95). No source, spec or `batches.md` was edited.

## 1. Report vs disk

`git status --short libs apps` lists exactly the 8 R9x paths. No other path is changed under
`libs` or `apps`:

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts` + `.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` + `.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts` + `.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`

Diff: 8 files, +1050 / -54. The working tree also holds non-batch files: `context.md`,
`decisions.md` and three untracked TF reports. They stay out of the batch commit.

Marker scan of added lines (`TODO|FIXME|PLACEHOLDER|STUB|.only(|fit(|fdescribe(|xit(|xdescribe(|.skip(|test.fixme`):
**0 hits**. `HIDE_AGENT_SIDEBAR` across the 8 files: **0 hits** (decision 77 holds).

### Contract points checked against code

| Contract point | Evidence | Result |
| --- | --- | --- |
| Header void outputs `closeSplitRequested`, `closePaneRequested`, `swapPanesRequested` (+ `detailsRequested`), as menu buttons reachable by keyboard | `canvas-focus-header.component.ts` menu `role="menuitem"` buttons, shown only while split; outputs declared next to `closeRequested` | OK |
| Focus area forwards each output with its stable pane id | `canvas-focus-area.component.ts`: `(closeSplitRequested)="closeSplitRequested.emit(paneId())"` and the same for the other outputs; spec `it.each(['left','right'])` at `canvas-focus-area.component.spec.ts:263-297` | OK |
| Board consumes all outputs and owns the live region and focus return | `canvas-rail-board.component.ts`: `closeSplit()`, `closePane(side)`, `swapPanes()`, `openSplitDetails(side)`; each announces, then `restoreHeaderFocus()` | OK |
| Close active pane focuses the survivor; Close inactive pane leaves store focus alone | `closePane`: `focusTile(survivor)` only when `closingActive` | OK |
| Escape closes an open menu first and never closes a pane | Header `(keydown.escape)="escape($event)"` acts only while `menuOpen()`, consumes the event once and focuses the trigger. Board keydown is Tab-only | OK (fix-round finding 1) |
| Swap changes only `visualOrder` | `swapPanes()` only sets `visualOrder`; `@for (side of sides; track side)` keys are unchanged; `panelId` = `rail-${paneId}-lane-panel` | OK |
| B3 stacked Tab handler: skips hidden elements and overlays; inert side by side and in default order | `onTabKey`: early return unless `splitDisplayed() && splitStacked() && top !== 'left'`; `isTabbable` skips `[hidden]`, `[inert]`, `[role=dialog]`, `[role=menu]`, `ptah-display-dock.absolute` | OK |
| Collapse resets `visualOrder` | `collapseSplit()` sets `['left','right']` | OK |
| C1: `focusTile` repair gated on `SURFACE_ACTIVE` | `surfaceActive = visible() && parentActive()`; `writable` gates both repair writes | OK |
| C2: a hidden removal during split keeps the survivor | `if (!this.activeId() && ids.has(other)) this.lastFocusedId = other` before collapse | OK |
| C3: unreachable reorder failure branch deleted | `reorderPending` and "Session order could not be saved." removed; the neutral message remains | OK |
| NEW-3: Close split and Details moved into the header; no absolute control over the pane header or lane tabs | The old absolute `Close split` / `Details` buttons were removed from the board `<section>`; Details is an in-flow header button | OK |
| NEW-6: single focus may sit on the right | Selectors use `activeSide()` (`[data-pane-side="${this.activeSide()}"]`); spec "close inactive pane ... NEW-6 single focus on the right side works" | OK |
| Lane-tabs spec (R9f) not modified | Not in the diff | OK |

### Named cases present

| Named case | Location |
| --- | --- |
| Each header output wired through the focus area to board state | `canvas-focus-area.component.spec.ts:263`; board spec `:1132`, `:1166`, `:1214`, `:1281`, `:1344` (stub emits) |
| Escape before close | header spec `:84`, plus fix case `:96` (Escape from the trigger) |
| Close active and inactive pane | board spec `:978`, `:1181`, plus the active-pane case around `:1166` |
| "stacked swap keeps hosts and top-before-bottom Tab order" | board spec `:1270` |
| "side-by-side swap keeps DOM Tab order (B3)" | board spec `:1354` |
| "collapse resets visualOrder" | board spec `:1258` |
| ChatView identity, drafts and docks unchanged after swap | board spec `:1380` (stateful child, fix-round finding 3) |
| Unique panel ids across panes | focus-area spec `:247`, `:263` |
| Contextual F5 drafts | chat-input spec `:384`, `:401`, `:420` |
| C1 / C2 / C3 | board spec `:1053`, `:1072`, `:1083` / `:1104` / `:962` |
| e2e split and reorder selectors and cases | `canvas.spec.ts:127-232` (5 cases) |

The e2e stacked case (`canvas.spec.ts:186-203`) **does not skip itself**. It resizes the Electron
window to 1280 x 900 through `BrowserWindow.setBounds`, asserts `flex-col`, and then asserts Tab
order. The spec contains no `test.skip`. The e2e suite was not run, by rule.

## 2. Checks

Each check ran through `node .ptah/tmp/check-run.mjs`, serially, from W. Every check got the lock
on its first try ("waited 0s"). Logs are `%TEMP%\629-check-<label>.log`.

| # | Label | Command | Result |
| --- | --- | --- | --- |
| 1 | `r9x-full` | `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. `Test Suites: 23 passed, 23 total`; `Tests: 331 passed, 331 total`; 0 `●` lines |
| 2 | `r9x-tc` | `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. 0 `error TS` |
| 3 | `r9x-lint` | `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. `28 problems (0 errors, 28 warnings)` |
| 4 | `r9x-chat-spec` | `npx nx test @ptah-extension/chat --testFile=chat-input.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. `Test Suites: 1 passed, 1 total`; `Tests: 78 passed, 78 total`; 0 `●` lines (the `console.error` output comes from error-path cases in the component, not from failures) |
| 5 | `r9x-chat-lint` | `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache` | exit 0. `40 problems (0 errors, 40 warnings)` |
| 6 | `r9x-e2e-tc` | `npx nx typecheck ptah-electron-e2e --parallel=1 --skip-nx-cache` | exit 0. 0 `error TS` |
| 7 | `r9x-e2e-lint` | `npx nx lint ptah-electron-e2e --parallel=1 --skip-nx-cache` | exit 0. `17 problems (0 errors, 17 warnings)` |

No e2e, build, serve, dev or package target was run. No run-many was used, and `--testPathPattern`
was not used.

### Deltas vs baselines

| Metric | Baseline (source) | Now | Delta |
| --- | --- | --- | --- |
| Canvas suites / tests | 23 / 304 (`mode2-h6-report.md:73`) | 23 / 331 | +27 tests, all in the three changed canvas specs (header, board, focus area). No other canvas spec changed |
| Canvas typecheck errors | 0 | 0 | 0 |
| Canvas lint errors / warnings | 0 / 16 (`mode2-h6-report.md:75`) | 0 / 28 | +12 warnings, 0 errors (details below) |
| Chat-input spec | 78 (lane report) | 78 passed | 0 |
| Chat lint errors / warnings | 0 / 40 (`mode2-h1-report.md:47`, given baseline) | 0 / 40 | 0. The two warnings in `chat-input.component.spec.ts` (`:342-343`, `any`) are on lines R9x did not change (its hunks are `:57` and `:363-435`). R9u Mode 2 had recorded 42 (`mode2-h4-report.md:38`); this run shows 40 |
| e2e typecheck errors | 0 (`mode2-h3-report.md`) | 0 | 0 |
| e2e lint errors / warnings | 0 / 17 (`mode2-h3-report.md:38`) | 0 / 17 | 0. No warning in `canvas.spec.ts` |

**Canvas lint +12 warnings. All are in R9x files, and none is an error.** The 16 baseline warnings
are unchanged: lane-tabs spec 3, lane-view spec 5, persistence spec 1, canvas-rail spec 3, and
header spec `:21`, `:27`, `:34`, `:36` (4, in lines R9x did not change, HEAD `1-42`). The new ones:

- `canvas-focus-header.component.spec.ts:54, :64, :77, :87, :121, :128`: 6 x `no-non-null-assertion` (new cases).
- `canvas-rail-board.component.spec.ts:1388, :1392, :1399, :1408`: 4 x `no-non-null-assertion` (fix-round case).
- `canvas-rail-board.component.spec.ts:99:99`: 1 x `@angular-eslint/template/no-any` (`$any($event.target)` in the `StatefulChatViewStub` template).
- `canvas-rail-board.component.ts:775`: 1 x `max-lines` ("File has too many lines (741). Maximum allowed is 700"). HEAD had 693 physical lines and no warning; the file now has 815 physical lines. This is the only new warning in production code.

None of these is new at error level, and they do not break the gate (the lint exits 0). They go to
the PR body as recorded items, not to a fix round (fix-round rule: Minor recorded, not fixed).

## 3. Reviews

- `codex-review-R9x.md`: **REVISE 6/10**. Finding 1 (Serious, Escape from the trigger), finding 2
  (Moderate, stacked e2e skips itself) and finding 3 (Moderate, swap preservation was proven only
  through an empty stub) were routed by decision row 107 to one fix round.
- `codex-review-R9x-fix.md`: **APPROVE 8/10**. All three findings are FIXED, each with a check
  that would catch a revert. No new findings.

## 4. Recorded, not fixed (for the PR body)

From the reviews (neither review lists Minors; these are the residual limits they and the lanes stated):

1. Electron behaviour is not executed. The e2e cases in `canvas.spec.ts:127-232` (stacked Tab
   order, the NEW-3 bounding box, host markers) passed typecheck and lint only. The phase Electron
   re-check is the real geometry and keyboard check (`codex-review-R9x-fix.md` Q4, lane report notes).
2. The board-level swap proof uses a stateful stand-in, not the real `ChatView` internals.
   Transcript-transfer and cold-mount counters are not asserted directly in the unit specs
   (`codex-review-R9x.md` named-case audit; `codex-review-R9x-fix.md` Q5).
3. Excluding an open menu or dock overlay from the B3 Tab handler is checked by reading the code
   only. The stub does not render those overlays (`codex-review-R9x.md` contract audit, B3 row).
4. Repeated `writeFailed()` while it stays true does not announce again (previously recorded C4;
   `codex-review-R9x.md` Q1/Q4).
5. A visible but inactive surface still sets "Split closed because a session was removed." in a
   hidden live region (`canvas-rail-board.component.ts:369` area). Nothing is spoken, and the
   lane report records it.
6. Lint (this run): `canvas-rail-board.component.ts` crosses `max-lines` (741 > 700). 11 new spec
   lint warnings (10 non-null assertions, 1 `$any`) in the header and board specs. All are
   warnings, 0 errors.
7. Recorded trade-off B3: side by side, Tab follows DOM order after a swap (contract
   `batches-rail-r9.md:622-623`).

## 5. Ready commit command (foreground, from W; not run)

Scopes `canvas`, `chat` and `e2e` are all in `.commitlintrc.json` `scope-enum`. The subject is 70
characters, and every body line is 72 characters or fewer.

```bash
cd "D:/projects/ptah-extension/.claude-worktrees/feat-task-629-canvas-board-697f422f00f5"
git add -- \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts \
  libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts \
  apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts
git diff --cached --name-only   # must list exactly the 8 paths above
git commit -F - <<'EOF'
feat(canvas,chat,e2e): batch R9x - split actions, pane swap, Tab order

The focus header menu now offers Swap panes, Close pane and Close
split, and an in-flow Details button while split (NEW-3). The focus
area forwards each action with its stable pane id. The board owns
the polite announcements and returns focus to the surviving header.
Escape closes an open header menu first and never closes a pane.

Swap changes only visualOrder (CSS order of the two stable hosts).
Tab ids, @for keys, lane panel ids and ChatView subtrees stay put.
Stacked and swapped, a board Tab handler moves focus top pane first;
side by side keeps DOM Tab order (recorded B3 trade-off).

Fixes R9w C1-C3: focus repair waits for SURFACE_ACTIVE, a hidden
removal during split keeps the survivor, and the unreachable reorder
failure branch is gone. Single focus may sit on the right (NEW-6).
Adds contextual F5 draft specs and e2e split and reorder cases.

Canvas: 23 suites, 331 tests; typecheck 0 errors; lint 0 errors,
28 warnings. Chat lint 0/40; e2e typecheck 0, lint 0/17.
Review: codex REVISE 6/10, fix round APPROVE 8/10.

Refs: TASK_2026_629_c0b3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

After the commit, record its SHA on the R9x header in `batches-rail-r9.md` and set R9x and
Task R9x.1 to COMPLETE (the team-leader does this in the commit invocation).

### Next action:

The orchestrator runs the ready commit command above in the foreground. It then records the SHA
and marks R9x COMPLETE. R9x is the last R9 batch, so the phase review is due next
(`batches-rail-r9.md:649-668`). Request one phase-diff code-logic review, plus a style review for
the new public API (`subagent-tile`, `single-chat-subagent-view`, Rail token,
`RAIL_MIN_CONTENT_WIDTH`, retention coordinator). Then run the visual-reviewer on the Electron
re-check list (dark + light, before/after Rail shots). That run must execute the e2e cases
recorded above as never run, and check recorded items 1-3.
