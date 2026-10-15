# R9f bounded correction report

| Finding | Fix | File:line | Spec case | Result |
| --- | --- | --- | --- | --- |
| N1 | Capture opener and focus Back only on a same-tab orchestrator-to-lane edge with focus inside the host; reset opener and kind on tabId change. | `canvas-lane-view.component.ts:261-285` | `keeps one transcript and draft while covering it, and focuses Back then restores the opener`; `keeps focus outside the lane view when a lane opens from the tab strip`; `does not focus Back when tabId swaps to an already open lane`; `does not focus Back on first mount with a lane already open` | PASS |
| N2 | Resolve an unlisted `sub:<id>` to its listed `bg:<id>` tab and emit that key; unresolved keys still emit `orchestrator`. | `canvas-lane-tabs.component.ts:164-175` | `migrates a selected sub-agent tab to its background tab`; `excludes foreign and unresolved owners and falls back for an unknown key`; `keeps the migrated background lane open and labels it with the background tab` | PASS |
| N3 | Count all rendered lane buttons whose text or aria label starts with Stop; require exactly one. | `canvas-lane-view.component.spec.ts:456-458` | `mounts the real execution node in full mode and routes Stop through its inline bubble` | PASS |

## Checks

From `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`, each command ran through the machine-wide lock, one at a time. Logs were written under `%TEMP%`.

- `node .ptah/tmp/check-run.mjs r9f-corr-1 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — initial assertion matched the permission button's aria label; `Test Suites: 1 failed, 1 total`; `Tests: 1 failed, 15 passed, 16 total`.
- `node .ptah/tmp/check-run.mjs r9f-corr-2 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — `Test Suites: 1 passed, 1 total`; `Tests: 16 passed, 16 total`.
- `node .ptah/tmp/check-run.mjs r9f-corr-3 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-tabs.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — `Test Suites: 1 passed, 1 total`; `Tests: 7 passed, 7 total`.

Scoped `ptah_get_diagnostics` reported zero errors in the four changed files and seven pre-existing errors in sibling files.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Migrate the selected `sub:` key to `bg:` when the same record becomes backgrounded. | Migrate key; retain the old key as selected; reset to orchestrator. | The tab list changes the key for the same `parentToolUseId`; the view accepts `bg:` and labels the panel using that key. | Yes |
| Focus Back only when a new lane opens from within the current view host. | Focus every opening; focus only an inside-host opening. | The tab strip is outside the view host and keeps keyboard focus after selection; tabId swaps are separate context changes. | Yes |
| Match Stop buttons by leading accessible text or aria label. | Any occurrence of Stop; leading Stop. | A permission button includes “stop execution” in its aria label but is a Deny action. | Yes |

## Changed files

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`
- `.ptah/specs/TASK_2026_629_c0b3/lane-R9f-correction-report.md` (this deliverable)

Existing uncommitted changes in other paths were not touched.
