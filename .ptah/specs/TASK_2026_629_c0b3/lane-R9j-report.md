# Lane R9j report — Delete Grid detail panel, detail geometry, canvas tile, tile agent indicator

Batch R9j of TASK_2026_629_c0b3 (phase R9, Rail only). Contract: `batches-rail-r9.md` "## Batch R9j"
(lines 271-280); parity rows 56-58 of `parity-inventory-layout.md` (lines 142-144). Grid removal is
user-approved (decision 80; rows sanction the deletion under decision 73).

W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`. All
canvas paths below are under `W\libs\frontend\canvas\src\lib\`.

## Files deleted (7/7 confirmed on disk first, then `rm` — not git rm)

| # | Path | Status |
| --- | --- | --- |
| 1 | `canvas-detail\canvas-detail-panel.component.ts` | deleted |
| 2 | `canvas-detail\canvas-detail-panel.component.spec.ts` | deleted |
| 3 | `canvas-detail-geometry.ts` | deleted |
| 4 | `canvas-detail-geometry.spec.ts` | deleted |
| 5 | `canvas-tile.component.ts` | deleted |
| 6 | `canvas-tile.component.spec.ts` | deleted |
| 7 | `tile-agent-indicator.component.ts` | deleted |

No other file was created, edited or deleted. (PowerShell `rm` rejected bare positional multi-path
args; retried as `rm -Path <array>` — still `rm`, not git rm.)

## Preserved (contract list) — verified untouched, zero imports of deleted code

- `canvas-detail\canvas-detail.service.ts` + `.spec.ts` (`CanvasDetailService`)
- `canvas-session-overrides.ts`
- `canvas-detail\canvas-lane-tabs.component.ts` + `.spec.ts`
- `canvas-detail\canvas-lane-view.component.ts` + `.spec.ts`
- Also untouched in `canvas-detail\`: `lane-owner.ts`, `canvas-session-details.component.ts` + spec,
  `canvas-detail-transcript.component.ts` + spec (R9f's), `canvas-detail-keyboard.ts` + spec
  (R9m deletes later), and `canvas\src\index.ts` (R9i had already dropped the doomed exports
  `CanvasTileComponent`/`TileAgentIndicatorComponent` — no deleted name remains there).

Pre-deletion blocker check (task step 2): rg over `libs` + `apps` for every deleted basename,
exported symbol and selector found TS imports ONLY inside the seven deleted files themselves
(`canvas-tile.component.ts` imports `tile-agent-indicator.component`; each spec imports its own
subject). No kept file imports a deleted file, type, constant or selector → no blocker, nothing
needed to move. The `canvas-detail\` folder has no barrel file to update.

## rg zero-importer proof (post-deletion, run from W over `libs` and `apps`)

Basenames (patterns also cover the `.spec.ts` variants as prefixes): `canvas-detail-panel.component`,
`canvas-detail-geometry`, `canvas-tile.component`, `tile-agent-indicator.component` — **0 hits**
(exit 1, no matches anywhere in `libs` or `apps`).

Exported symbols (`CanvasDetailPanelComponent`, `CanvasDetailGeometry`, `canvasDetailGeometry`,
`TileAgentIndicatorComponent`, `CanvasTileComponent` — the specs export nothing) and the three
component selectors (`ptah-canvas-detail-panel`, `ptah-tile-agent-indicator`, `ptah-canvas-tile`):
**5 hits, every one a non-import string literal**:

| Hit | Name | Kind | Owning batch / disposition |
| --- | --- | --- | --- |
| `apps\ptah-electron-e2e\src\showcase\lane-console-review.scene.ts:181` | `ptah-tile-agent-indicator` | Playwright locator string | no R9 batch file list owns `src/showcase/*`; R9l owns the e2e selector rewrite (its list: `src/specs/canvas/canvas.spec.ts`, `src/specs/task-337-agent-card-refresh.spec.ts`) → risk 1 |
| `apps\ptah-electron-e2e\src\showcase\lane-console-review.scene.ts:256` | `ptah-tile-agent-indicator` | Playwright locator string | same as above → risk 1 |
| `apps\ptah-electron-e2e\src\showcase\chat-code-edit.scene.ts:161` | `ptah-tile-agent-indicator` | Playwright locator string | same → risk 1 |
| `apps\ptah-electron-e2e\src\showcase\canvas-orchestra.scene.ts:166` | `ptah-tile-agent-indicator` | Playwright locator string | same → risk 1 |
| `libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts:906` | `ptah-canvas-detail-panel` | querySelector string inside a `toBeNull()` absence assertion | risk R11, pre-recorded at `batches-rail-r9.md:52` ("Recorded, not fixed (lean rule 4); no later batch owns these files; the phase-diff review lists them"); file is R9b's (COMPLETE); the null-assertion stays green after deletion |

Zero live importers. This matches R9i's Mode 2 precedent (batches-rail-r9.md:257: "hits only in
... R9l e2e selectors, two non-import selector strings, risk R11").

## Decisions

- Deleted exactly the seven contracted files; nothing else touched (task step 2 "do not modify any
  other file" and execution rule 74 both hold — no file with a live import was deleted).
- Ran the pre-deletion blocker check before `rm` (importers could have been a stop-and-report
  blocker); it came back clean, so no code was moved and no reference fixed outside the batch.
- Interpreted "each exported symbol" as the five public exports of the four source files, and also
  proofed the three component selectors: templates select components by string, not by import, so
  a stale selector string is the template-level equivalent of a stale import.
- Ran the proof as one alternation per group (basenames; symbols + selectors) instead of 12
  separate rg invocations — same match set from W over `libs apps`; per-name attribution is
  tabled above. Basename patterns cover `.spec.ts` variants because the `.component` string is a
  prefix of the spec basename.
- No spec/typecheck/lint run: the R9j contract's writer step is "rg zero-importer" only
  (batches-rail-r9.md:278), my task says no spec run is required, and Wave 3's FULL(canvas),
  TC(canvas), LINT(canvas) belong to Mode 2 after all Wave 3 writers (R9p, R9j, R9q) return
  (execution rule 4). The lock runner was therefore not needed.

## Risks

1. **Unowned stale `ptah-tile-agent-indicator` locators in four e2e showcase scenes** (hits above).
   No R9 batch file list includes `apps/ptah-electron-e2e/src/showcase/*`. `TC`/`LINT` of
   `ptah-electron-e2e` stay green (valid string literals, no imports), but a future showcase run
   would never find the indicator element — the Grid tile that hosted it is gone. R9i's Mode 2
   already accepted "R9l e2e selectors" as a hit category; R9l's declared file list does not cover
   the showcase folder, so this needs R9l's selector-rewrite scope or the phase-diff review to pick
   it up.
2. **Risk R11 stands** (batches-rail-r9.md:52): the stale selector string at
   `orchestra-canvas.component.spec.ts:906` (plus `orchestra-canvas.rail.spec.ts:296`, R9i's names)
   is recorded, not fixed; the null-assertion stays green after this deletion.
3. **Downstream batches depend on this tree**: R9m (grid release, mini-panel, detail keyboard),
   R9k (layout slim) and R9r list R9j in their dependencies (batches-rail-r9.md:109-110). The rg
   proof here reflects the post-R9j tree only; Mode 2 re-runs the wave-3 rg and the full canvas
   suite on the combined tree after all Wave 3 writers return.
