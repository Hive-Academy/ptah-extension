# Mode 2 report: R9 phase fix round (Fix A + Fix B + Fix B correction) - TASK_2026_629_c0b3

## Verdict: PASS

The working tree has exactly the 10 expected paths. The fix code on disk matches the three lane
reports. Full test, typecheck and lint pass for canvas, chat and tribunal-panel, with 0 errors and
no new lint warnings. All four reviews of the round accept:

| Review | Verdict |
| --- | --- |
| Fix A re-review (`code-logic-review-R9-phase-fixA.md`) | APPROVE 8.5/10. F1 FIXED; N1-N3 Minor |
| Fix B review (`codex-review-R9-phase-fixB.md`) | REVISE 6/10. One new Serious, closed by the correction below |
| Fix B correction review (`codex-review-R9-phase-fixB-correction.md`) | On disk. APPROVE 8/10, finding FIXED, "New findings: None" |

Per decision row 95, nothing is committed. HEAD is still `b9b2bf678`. The commit command is ready
below.

## Step 1: report vs disk

`git status --short libs apps` lists exactly these 10 paths. There is no other path under `libs` or
`apps`.

| Path | State | Source |
| --- | --- | --- |
| libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts | M | Fix A |
| libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts | M | Fix A |
| libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts | M | Fix B correction |
| libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.spec.ts | M | Fix B correction |
| libs/frontend/chat/src/lib/components/templates/chat-view.component.ts | M | Fix B |
| libs/frontend/chat/src/lib/components/templates/chat-view.component.html | M | Fix B correction |
| libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts | M | Fix B + correction |
| libs/frontend/chat/src/lib/tokens/session-context.token.ts | M | Fix B (doc only) |
| libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts | M | Fix B (comment only) |
| libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.spec.ts | ?? (new) | Fix B |

Other modified or untracked paths are task-folder docs only (`context.md`, `decisions.md`, the
review and lane reports, and this report). Row 108 allowed Fix A to touch the Rail card. It did not:
`canvas-rail-card.component.ts` is unchanged, and the Fix A report explains why (Decisions, bullet
1). That is in scope and is not a finding.

On-disk verification (diff read):

- **Fix A** (`canvas-rail-board.component.ts`). `activatePane` now takes the vacated pane from the
  board-owned `lastFocusedId`, not from the store's `activeId()`, and guards
  `!current || current === id`. In `focus()`, the replacement announcement also compares against
  `lastFocusedId`. The spec adds one real `CanvasRailCardComponent` case that covers click, Enter and
  Space: +3 tests.
- **Fix B** (`chat-view.component.ts`). The `DisplayDockState` factory checks only `isElectron`.
  `sessionAgents` returns `[]` under `hideAgentSidebar`. The token doc and the conductor comment are
  updated, and the conductor provider is unchanged. The new conductor spec has 3 cases.
- **Correction** (`display-dock.component.ts`, `chat-view.component.html`):
  - The dock has a new `hideAgents = input(false)`. When it is true, the Agents tabpanel renders
    `display-dock-agents-hidden` and does not mount `ptah-agent-monitor-panel`.
  - ChatView binds `[hideAgents]="hideAgentSidebar"`.
  - The `@error` fallback monitor is wrapped in `@if (!hideAgentSidebar)`.
  - `agent-monitor-panel.component.ts` is unchanged, as the correction report says.

Grep check for `HIDE_AGENT_SIDEBAR` in non-spec files under `libs/` and `apps/`:

- The only provider is `conductor-tile.component.ts:222` (`useValue: true`). The conductor keeps
  its provider.
- No canvas or Rail host provides the token. There are 0 matches under `libs/frontend/canvas` and
  under `apps/`.
- The other matches are the declaration (`session-context.token.ts:21`), the barrel
  (`chat/src/lib/services/index.ts:101`), the ChatView consumer (`chat-view.component.ts:80,295`)
  and doc comments.

## Step 2: checks

All checks ran serially through `.ptah/tmp/check-run.mjs`, the machine-wide lock, from W. Logs are
in `%TEMP%\629-check-<label>.log`. Every run reported 0 `●` failure lines.

| # | Label | Command | Result | Baseline | Delta |
| --- | --- | --- | --- | --- | --- |
| 1 | pf-canvas-full | `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. Suites 23 passed / 23. Tests 334 passed / 334 | 23 / 331 (`mode2-h7-report.md:76`) | +3 tests, all from the Fix A regression in `canvas-rail-board.component.spec.ts` (1 new case: click, Enter, Space) |
| 2 | pf-canvas-tc | `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. 0 `error TS` | 0 errors | none |
| 3 | pf-canvas-lint | `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. 28 problems (0 errors, 28 warnings) | 0 / 28 (`mode2-h7-report.md:78`) | none |
| 4 | pf-chat-full | `npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. Suites 203 passed / 203. Tests 3728 passed, 2 skipped, 3730 total. Waited 40 s for the lock | 203 suites, 3719 passed / 2 skipped (`mode2-h4-report.md:36`) | +9 passed. +4 are from this round: the dock spec has +2 cases, and `chat-view.dock.spec.ts` has +3 / -1. The other +5 come from R9 batches committed after H4 (R9v-R9x). Not a failure |
| 5 | pf-chat-tc | `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache` | exit 0. 0 `error TS` | 0 errors | none |
| 6 | pf-chat-lint | `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache` | exit 0. 40 problems (0 errors, 40 warnings) | 0 / 40 (`mode2-h7-report.md:80`; 40 also at H1) | none. The warnings listed under `chat-view.component.ts` keep the total at 40, so they existed before |
| 7 | pf-tribunal-full | `npx nx test @ptah-extension/tribunal-panel --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. Suites 17 passed / 17. Tests 336 passed / 336 | No baseline in the task folder | The new `conductor-tile.component.spec.ts` adds 1 suite and 3 tests, so HEAD has 16 / 333 by reading. No failures, so nothing failed at HEAD either |
| 8 | pf-tribunal-tc | `npx nx typecheck @ptah-extension/tribunal-panel --parallel=1 --skip-nx-cache` | exit 0. 0 `error TS` | n/a | n/a |
| 9 | pf-tribunal-lint | `npx nx lint @ptah-extension/tribunal-panel --parallel=1 --skip-nx-cache` | exit 0. 0 problems (no warning or error lines) | n/a | n/a |

Project name: `@ptah-extension/tribunal-panel` (`libs/frontend/tribunal-panel/project.json`).

The rules were followed:

- one project per command, one heavy check at a time;
- no `run-many`, no `--testPathPattern`, no build, serve, e2e or package target, and no install;
- no stash or checkout;
- git was used read-only.

## Step 3: no commit

Per decision row 95, nothing was committed. No source or spec was edited. HEAD is `b9b2bf678`.

## Step 4: ready commit command (foreground, explicit paths)

`canvas`, `chat` and `tribunal-panel` are all in the `.commitlintrc.json` scope enum, and `fix` is
in the type enum. The subject is 68 characters, and every body line is at most 72 characters.

```bash
cd "D:/projects/ptah-extension/.claude-worktrees/feat-task-629-canvas-board-697f422f00f5"
git add \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts \
  libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts \
  libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.spec.ts \
  libs/frontend/chat/src/lib/components/templates/chat-view.component.ts \
  libs/frontend/chat/src/lib/components/templates/chat-view.component.html \
  libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts \
  libs/frontend/chat/src/lib/tokens/session-context.token.ts \
  libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts \
  libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.spec.ts
git commit -F - <<'EOF'
fix(canvas,chat,tribunal-panel): keep split panes and conductor dock

R9 phase fix round (decisions 108, 109).

Fix A (logic F1): a Rail card writes store focus before the board
handles focusRequested, so activatePane read the moved focus and put
the same tab in both split panes. The board now takes the vacated
pane from its own lastFocusedId. Regression mounts the real Rail card
(click, Enter, Space).

Fix B (logic F2, decision 77(d)): HIDE_AGENT_SIDEBAR removed the
display dock from the Tribunal conductor ChatView. The token now hides
only the Agents list: the dock and its display ports stay, and
sessionAgents is empty. Under the token the dock's Agents tab shows
an empty state and never mounts the store-reading monitor; the
chunk-load fallback monitor is skipped too. New conductor-tile spec.

Checks: canvas 23/334, chat 203/3728 (2 skipped), tribunal-panel
17/336; typecheck 0 errors; lint 0 errors (28/40/0 warnings).
Reviews: fix A APPROVE 8.5, fix B correction APPROVE 8.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Stage only these 10 paths. The task-folder docs go in the orchestrator's separate `docs(canvas)`
commit, as in earlier rounds. Run the commit in the foreground; the pre-commit hook is lint-staged.

## Step 5: recorded, not fixed (for the PR body)

### Named later task "R9 cleanup follow-up" (decision row 108)

- Logic F3 (Moderate): about 650 lines of unreferenced Grid projection and drag code in
  `canvas-layout-intent.ts`, plus the store's `commitDragIntent` and `toggleLayoutFocus`. It has no
  runtime effect.
- Style F1: `canvas-rail-board.component.ts` crossed `max-lines`. Split out the two pure-DOM seams.
- Style F2: `RAIL_MIN_CONTENT_WIDTH` is declared in the component file instead of `tokens/`.
- Style F3: the Rail cap of 4 is defined twice, in two files.
- Style F4: the Rail layout literals 360, 400 and 1440 are repeated across five files.
- Style F5: the focus-header overflow menu is hand-rolled. The card uses `NativePopover`.

### Phase review Minors (`code-logic-review-R9-phase.md`)

- F4: `close()` acts after `await removeTile` without re-checking the active workspace.
- F5: the focus-repair effect can call `switchTab` when the store focus is null (above the 20-tile
  hydrate bound).
- F6: `focus-area.stop()` relies on `focusin` running before `click`. A programmatic or AT
  activation could reproduce the F1 pattern. The Fix A `lastFocusedId` change covers the
  `activatePane` side.
- F7: `assertDistinct` throws after the state was mutated (dev mode).
- F8: stale references to the deleted Grid code:
  - `app-shell.component.ts:118` and `lazy-view-components.token.ts:38` (comments);
  - the `sessions.shot.ts:68` locator, which always counts 0.

### Phase style Minors (`code-style-review-R9-phase.md`)

- F6: `distinctRetainedCount` has no production consumer.
- F7: the header and focus-area outputs emit a payload the board ignores.
- F8: `chat-transcript.component.ts` grew from 1021 to 1231 lines.
- F9: details in `subagent-tile.component.ts`.
- F10: the focus header uses glyph controls instead of `lucide-angular`.
- F11: `TranscriptRetentionService` and the coordinator are coupled to each other through public
  methods.
- F12: the token names `RAIL_TRANSCRIPT_RETENTION` and `RAIL_MIN_CONTENT_WIDTH` put a canvas concept
  in the `chat` lib.

### Fix A re-review Minors (`code-logic-review-R9-phase-fixA.md`)

- N1: the guard `if (!current || current === id) return;` (board :513-514) is a silent no-op with no
  self-heal. It is unreachable under the current invariants.
- N2: there is a transient window. If an external focus write to a third tab and `activatePane`
  happen in the same task, C is dropped and A is kept. The result is cosmetic and still a valid,
  distinct state.
- N3: coverage gaps:
  - the regression stubs the Rail and the compact child, so the full Rail DOM chain is not covered;
  - the lane-action path (`CanvasDetailService.open`) and the focus-area `stop` path have no case of
    their own;
  - there is no negative test for the N1 guard.

### Fix B correction review (`codex-review-R9-phase-fixB-correction.md`, APPROVE 8/10)

It has no new findings. It names two coverage notes:

- The mounted ChatView test starts at `setSurfaces`. The fenced `ptah-ui display` path from parser
  to dock is not exercised end to end.
- Keyboard navigation with `hideAgents` set is inferred from unchanged code, not tested together.

The Fix B review (`codex-review-R9-phase-fixB.md`, Scoped answer 3) also notes that the conductor
spec reads Angular's internal `__annotations__` and may fail falsely after a compiler change. The
reviewer accepted this as a bounded trade-off.

### Next action: orchestrator runs the ready commit command

All three reviews of this round accept: Fix A APPROVE 8.5, the Fix B correction APPROVE 8, and the
Fix B REVISE is closed by that correction. The orchestrator:

1. Runs the commit command above in the foreground from W, with the 10 paths staged explicitly.
2. Commits the task-folder docs separately as `docs(canvas)`.
3. Records the SHA and this report in `decisions.md`.
4. Re-invokes team-leader in Mode 3 for the R9 phase completion checks:
   - parity against `parity-inventory-layout.md`;
   - rendered dark and light visual evidence;
   - the persisted-focus write-path trace.

The items in Step 5 go into the PR body under "Recorded, not fixed".
