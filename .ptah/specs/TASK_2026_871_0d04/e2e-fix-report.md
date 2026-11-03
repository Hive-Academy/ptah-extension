# Electron Tasks e2e selector update

## Scope and evidence

Updated the Electron Tasks visual spec for the full-page detail layout and current folder-file rows. The detail page keeps the list mounted but hidden, provides Back navigation, and displays a file in `task-doc-panel`. The root folder rows are derived from the `tasks:get` detail fixture's `artifacts`; no new RPC fixture or component test ID was needed. Other specs under `apps/ptah-electron-e2e/src/specs/tasks/` had no removed side-panel or old file-row selectors.

## Locator changes by test

| Test | Old locator / assertion | New locator / assertion | Reason |
| --- | --- | --- | --- |
| `a row is far shorter than a card` | `ptah-task-card > div` | Select `tasks-view-mode-kanban`, then measure `task-card-body` | The card exposes a stable test ID; explicitly choosing Kanban prevents persisted view mode from leaving cards absent. The row/card height comparison remains. |
| `opening a task ...` | `ptah-task-detail aside`; list shrinks to a rail and drops description/metadata | `task-detail-page`, `task-folder-files`, `task-detail-metadata`, `task-detail-back`; assert detail uses available width, list is hidden, and Back restores the same task row | The side rail was removed. This checks the equivalent user journey on the full-page detail without requiring a removed layout. |
| `the implementation plan renders ...` | `task-doc-read-implementation-plan.md`, `task-doc-read-task-description.md` | `task-folder-row-implementation-plan.md[data-action="read"]`, `task-folder-row-task-description.md[data-action="read"]` | Files are opened from the folder list. Markdown, on-screen visibility, content, and missing-file assertions remain. |
| same document test | `task-doc-absent` | `task-doc-missing` | The reader now names the missing state `missing` while preserving the explicit “does not contain” message. |

The document test still checks that the selected plan renders as markdown in the on-screen reader and that a requested but unavailable body reports its missing state. `tasks:getArtifact` returns `null` for `task-description.md` in this fixture, while the file remains listed, so the read path exercises that state.

## Files changed

- `apps/ptah-electron-e2e/src/specs/tasks/tasks-list-visual.spec.ts` — updated three tests. No assertions were deleted; the obsolete rail assertions were replaced with full-page and Back assertions.
- `.ptah/specs/TASK_2026_871_0d04/e2e-fix-report.md` — this report.

No tasks-ui component or data-testid changes.

## Verification

- `ptah_get_diagnostics` on the changed spec: 0 errors, 0 warnings.
- `npm run verify -- -t typecheck,lint -p ptah-electron-e2e`: **could not run** because Nx plugin loading failed with `spawn EPERM` (the default Nx plugins and `@nx/eslint/plugin` / `@nx/jest/plugin`).
- Required fallback `npx tsc --noEmit -p apps/ptah-electron-e2e/tsconfig.spec.json`: passed (exit 0).
- E2e, build, and serve were not run as instructed; CI must exercise the Electron runtime assertions.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Test full-page detail and Back instead of the removed rail | Keep rail measurements; measure page and restoration | `tasks-view.component.ts` hides the mounted board during detail, and `task-detail.component.ts` renders `task-detail-page` with folder files and metadata | Yes |
| Use the existing file-row test IDs | Add new test IDs; use `task-folder-row-*` | `task-folder-files.component.ts` exposes `task-folder-row-<name>` and `data-action="read"` | Yes |
