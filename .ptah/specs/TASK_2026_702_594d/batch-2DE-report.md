# Batch 2D + 2E selector migration, Gate 2 N1

## Changed files

| File | Migration and branch reason |
| --- | --- |
| `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` | The `addRailSessions` helper uses `canvas-hero-new-session` for its first empty-board creation and `canvas-footer-new-session` for later populated-board creations. The three independent first-creation specs use the hero. Replaced all four `canvas-new-session-anchor` calls. |
| `apps/ptah-electron-e2e/src/specs/harness/new-project-question-routing.spec.ts` | Both fresh-board setup flows use hero instead of `canvas-new-session-anchor`. |
| `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts` | Replaced `canvas-new-session-anchor` with the separate `canvas-interactive` ready-viewport marker; updated the measurement comment. |
| `apps/ptah-electron-e2e/src/support/ui-driver.ts` | Replaced `canvas-new-session-anchor` with the always-present footer because the helper can run regardless of board state; updated the dock comment. |
| `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts` | Replaced `title="Add new session tile"` with footer; the first session already exists. |
| `apps/ptah-electron-e2e/src/specs/task-370-concurrent-session-isolation.spec.ts` | Replaced `title="Add new session tile"` with footer; this creates the second session. |
| `apps/ptah-electron-e2e/src/docs-screenshots/sessions.shot.ts` | The first screenshot creation uses hero; the second replaces the title selector with footer. Preserved the loop's empty/populated branch. |
| `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts` | Replaced the old title-selector/FAB branch with a visible-hero check: hero on empty board, footer when populated. |
| `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts` | Replaced the old title-selector/FAB branch with a visible-hero check: hero on empty board, footer when populated. |
| `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts` | Waits for the always-present footer, then chooses the visible hero on an empty board or footer when populated. Replaced the old title selector and stale dock comment. |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-servers.e2e.spec.ts` | Renamed the test title and accessible button selector from `Open Marketplace Skills` to `Open Library`. |
| `apps/ptah-docs/src/content/docs/canvas/index.md` | Replaced the toolbar instruction with empty-board hero and populated-board rail-footer instructions; updated the cap note to refer to New session buttons. |

## Source contract and final search

The source currently declares `canvas-hero-new-session` in `canvas-rail-board.component.ts:169` and `canvas-footer-new-session` in `canvas-rail.component.ts:236`. `canvas-interactive` was not present in the current `orchestra-canvas.component.ts` or `canvas-rail-board.component.ts` at inspection time; batch 2C must add that ready-viewport marker for the updated TTI spec to run.

Final worktree `rg -n -F` search for `canvas-new-session-anchor`, `Add new session tile`, and `Open Marketplace Skills`, excluding `node_modules`, `dist`, `.ptah`, and `.git`, found only these three out-of-scope hits:

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:822` — `canvas-new-session-anchor` in a dock-absence assertion.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:204` — `Open Marketplace Skills` in a stub template.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:1136` — `Open Marketplace Skills` in an expectation.

No assigned file retained any of the three old strings. Those spec files were not edited because they are outside this lane's ownership.

## Verification

- Scoped `ptah_get_diagnostics`: no diagnostics in requested changed TypeScript files; six diagnostics in unrelated webview harness sibling files.
- `npx nx typecheck ptah-electron-e2e --parallel=1`: passed.
- `npx nx run-many -t lint -p ptah-electron-e2e @ptah-extension/webview-e2e-harness --parallel=1`: passed for both projects, zero errors; output reported 44 warnings.
- Nx Cloud returned a disabled-organization 401 warning after the local targets succeeded. No e2e, test, build, or Playwright run was performed, per task instruction.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the hero for the first creation in `addRailSessions`, then the footer | Hero always; footer always; branch by creation count | The helper starts with zero cards and asserts each newly created card; the hero exists only at zero tiles, while the footer always exists. | Yes |
| Use the footer in `ensureCanvasChatTile` | Hero; footer | The helper can run with an empty board or an existing session without a visible input; the footer is always present. | Yes |
| Preserve scene branching by hero visibility | Check hero; count tiles; use footer always | Existing scenes branch on visible controls; hero presence directly tracks the empty-board UI and keeps that flow intact. | Yes |

## Not done

The three out-of-scope spec references and the absent `canvas-interactive` source marker remain for their owning canvas lane. Runtime e2e behavior was not exercised because e2e execution was explicitly prohibited.
