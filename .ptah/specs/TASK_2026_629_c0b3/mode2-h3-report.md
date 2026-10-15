# Mode 2 — Wave H3, batch R9l (TASK_2026_629_c0b3)

Verdict: **PASS**. All five Mode 2 checks for the contract plus the three spec re-runs exit 0 with no errors, and
the three rg checks are clean. The R9l header in `batches-rail-r9.md` is now "VERIFIED (commit pending, row 95)".
Team-leader did not commit; the orchestrator commits (decision 95) when no writer lane is running in W.

Inputs read: batches-rail-r9.md "Batch R9l" (contract and Mode 2 line), lane-R9l-report.md,
code-logic-review-R9l.md (APPROVE-WITH-FIXES 6/10), lane-R9l-fix-report.md, decisions rows 90, 95, 96, 99.

## Scope check

`git status --short libs apps` lists exactly the 8 R9l paths and nothing else:

- M `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
- M `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts`
- M `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-board-mode.ts`
- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts`
- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts`
- M `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`

Outside libs/apps the only changes are task-folder documents (context.md, decisions.md, the R9l lane/fix reports,
the R9l review, this report, batches-rail-r9.md). They are not part of the R9l commit. `packaged-deps.spec.ts` is
untouched. The working copies show CRLF because `core.autocrlf=true`; `.gitattributes` (`* text=auto eol=lf`)
normalises them on add.

## Checks (run from W, one at a time, through the machine-wide lock; logs in %TEMP%)

| # | Label | Command (abridged) | Result |
| --- | --- | --- | --- |
| 1a | r9l-m2-s1 | `nx test @ptah-extension/canvas --testFile=canvas-detail.service.spec.ts` | exit 0; Test Suites 1 passed, Tests 5 passed |
| 1b | r9l-m2-s2 | `nx test @ptah-extension/canvas --testFile=orchestra-canvas.component.spec.ts` | exit 0; Test Suites 1 passed, Tests 30 passed |
| 1c | r9l-m2-s3 | `nx test @ptah-extension/canvas --testFile=canvas-layout-persistence.service.spec.ts` | exit 0; Test Suites 1 passed, Tests 25 passed (console output from the spec's own error-path cases only) |
| 2 | r9l-tc | `nx typecheck @ptah-extension/canvas` | exit 0; 0 `error TS` |
| 3 | r9l-lint | `nx lint @ptah-extension/canvas` | exit 0; 16 problems (0 errors, 16 warnings) |
| 4 | r9l-e2e-tc | `nx typecheck ptah-electron-e2e` | exit 0; 0 `error TS` |
| 5 | r9l-e2e-lint | `nx lint ptah-electron-e2e` | exit 0; 17 problems (0 errors, 17 warnings) |

All runs used `--parallel=1 --skip-nx-cache`; the spec runs also `--coverage=false --maxWorkers=2`. Each waited 0 s
for the lock. E2e was not run.

### Warnings in R9l files (all pre-existing at HEAD, none introduced)

- `canvas-layout-persistence.service.spec.ts:67:31` no-non-null-assertion. HEAD had two such assertions at `:55`
  and `:77`; R9l deleted the case holding `:55`, so `:77` moved to `:67`. Net one warning fewer.
- `hunk-revert-top-layer.spec.ts:120:7` no-useless-assignment (`let last = ''`) and `:201:16`, `:201:28`
  no-non-null-assertion (`overlaps(canvasBox!, boxBox!)`). Both lines are identical at HEAD (`:120`, `:202`);
  R9l's hunk is lines 187-199 only.

The other warnings are in files R9l does not touch (`canvas-lane-tabs.component.spec.ts`,
`canvas-lane-view.component.spec.ts`, `canvas-focus-header.component.spec.ts`, `canvas-rail.component.spec.ts`,
`hunk-widget-mouse.spec.ts` and other e2e specs). No pre-existing failures.

## rg results

1. `CanvasBoardMode` grid: `rg "mode ?=== ?'grid'|mode ?!== ?'grid'|'rail' ?\| ?'grid'|'grid' ?\| ?'rail'|mode: ?'grid'|CanvasBoardMode.*'grid'|\"mode\":\"grid\"" libs apps`
   - `canvas-layout-persistence.service.spec.ts:51` raw stored v3 JSON (`"mode":"grid"`), allowed (raw spec input).
   - `apps/ptah-extension-vscode/assets/plugins/ptah-react/.../client-components.md:140`, unrelated React skill doc.
   - Wider `rg "'grid'"`: `canvas-layout-persistence.service.ts:47` zod `z.enum(['rail','grid']).catch('rail')
     .transform(() => 'rail')` (persistence, allowed); `orchestra-canvas.rail.spec.ts:156,290-291` raw mock map
     (allowed, Minor 5); all other hits are AppState `layoutMode()` (`'single' | 'grid'`), a different type outside
     the board mode. Clean.
2. `CanvasDetailService.toggle/next/prev`: `rg "detail\.(toggle|next|prev)\(" libs apps` → no hits; the service
   (`canvas-detail.service.ts:1-59`) no longer declares them. Clean.
3. `rg "Create new session" apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` → no hits (exit 1). The three
   creation cases click `[data-testid="canvas-new-session-anchor"]` (`canvas.spec.ts:26,43,74`), rendered at
   `orchestra-canvas.component.ts:165`, then the popover `Create` button (`:214-221`). Clean.

## Fix round verification (row 99)

- S1 fixed: see rg 3.
- Moderate 3 fixed: the duplicate "focuses and selects a lane without opening detail" case and the trivial
  `laneKey()` assertion are gone (`canvas-detail.service.spec.ts:35-75`, 5 cases, all pass).
- Moderate 4 fixed: `canvas.spec.ts:33` asserts the `Sessions` complementary region, rendered outside the
  collapse branch at `canvas-rail.component.ts:65-66`; no `Dense cards` assertion remains.
- Test-only fixes, so no re-review (row 99); the phase review covers them.

## Recorded, not fixed (row 99; for the PR body)

- Moderate 1: stale `[data-testid="canvas-tile"]` locators in `specs/git/change-set-card.spec.ts:138`,
  `specs/chat/tile-load-older-history.spec.ts:43`, `specs/chat/tile-open-longtask-budget.perf.spec.ts:367`,
  `specs/chat/compaction-duplicate-session.spec.ts:152,302,306`, `support/perf-session-fixture.ts:466`,
  `support/perf-page-capture.ts:230+` and showcase scenes. R11 sweep.
- Moderate 2: dead `detailTabId` / `laneKey` / `selectLane` / `close` in `canvas-detail.service.ts:11,15-16,47,50-57`
  (`open()` always writes `null`) and the mock assertion in `canvas-needs-you-queue.component.spec.ts:114-127`,
  which is outside R9l.
- Minor 5: `orchestra-canvas.rail.spec.ts:156,290-291` feeds raw `'grid'` through a mock `boardFor`.
- Minor 6: stale wording "binds the tile" at `task-337-agent-card-refresh.spec.ts:199`; blank line before the class
  close at `canvas-detail.service.ts:58` (lint-staged `nx format:write` removes it on commit).
- Dropped e2e guarantees (not new removals, row 99): Gridstack geometry and gesture counters (row 80); workspace
  card DOM identity (gone since R6, `canvas-rail-board.component.ts:51` `@if (visible())`), so the workspace
  round-trip case asserts the card count only.
- Unproven until an e2e run: the hunk-revert overlap probe is now the Rail empty-board section, narrower than the old
  full-width panel; fallback probe `ptah-canvas-rail-board:visible` if it flakes.

## Commit command for the orchestrator (only when no writer lane is running in W, row 95)

Run from W in the foreground:

```bash
git add \
  libs/frontend/canvas/src/lib/canvas-board-mode.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts \
  libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts \
  libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts \
  apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts \
  apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts \
  apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts
git commit -F - <<'EOF'
refactor(canvas,e2e): batch R9l - narrow board mode, Rail e2e selectors

Narrow CanvasBoardMode to 'rail'. Only the persistence schema still
reads a stored v3 'grid' value, and it opens that board as Rail.
Drop the Grid-only detail overlay path and toggle/next/prev from
CanvasDetailService, which have no production caller (decision 90c).
Rail lane memory and the close prune are unchanged.

Remove the stale CanvasLayoutService mock members from the
orchestra-canvas spec (decision 96) and the persistence case for a
Grid snapshot, which the narrowed type can no longer express.

Rewrite the canvas e2e spec for the Rail board: empty board, dock
anchor and Create, card focus and the Sessions aside, settings and
workspace round-trips. Point task-337 at the Focused session region
and the hunk-revert overlap probe at the Rail empty board (90a).
E2e was not run.

Recorded, not fixed: Moderate 1-2 and Minors 5-6 of the R9l review
(decision 99, see mode2-h3-report.md).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Message check: type `refactor` and scopes `canvas` and `e2e` are all in `.commitlintrc.json`; a comma multi-scope
subject is allowed. The subject is 71 chars, starts lower-case, no full stop. The longest body line is 68 chars (at most
72). The pre-commit hook (lint-staged) runs `nx format:write` on the staged files
and `nx affected --target=lint`.
