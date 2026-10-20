# B09 Setup Hub cards

## Delivered

| File | Change | Lines |
| --- | --- | --- |
| `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts` | Added agent and guidance cards to the existing grid, active-workspace launcher calls with independent origin, and safe failure copy. Kept analysis navigation. | 307–321, 381–423, 1252–1265, 1428–1452 |
| `libs/frontend/harness-builder/src/lib/components/setup-hub.component.spec.ts` | Added card, workspace, repeated-click, failure, cancellation, and analysis-entry coverage. | 110–164 |

## Acceptance

| Item | Result | File:line | Spec file:line |
| --- | --- | --- | --- |
| Agent and project-guidance starts use B04 launcher with active workspace and independent origin | met | `setup-hub.component.ts:1432` | `setup-hub.component.spec.ts:110` |
| Second click delegates to launcher; launcher focuses its existing same-workspace tab | met | `setup-hub.component.ts:1438` | `setup-hub.component.spec.ts:123`; `chat-ui/src/lib/services/generation-workflow-launcher.service.spec.ts:39` |
| Failed result has safe copy; cancelled result has no error | met | `setup-hub.component.ts:1444` | `setup-hub.component.spec.ts:135,145` |
| Analysis action keeps existing route | met | `setup-hub.component.ts:1428` | `setup-hub.component.spec.ts:157` |
| Running status line and Open running tab label | partial | `setup-hub.component.ts:381` | — |

## Checks

- `npx prettier --write` on both assigned files: passed.
- Focused Jest: 1 suite, 15 tests passed.
- Single-file ESLint: 0 errors, 40 warnings (existing explicit accessibility modifier convention plus the new method).
- Scoped `ptah_get_diagnostics`: unavailable after 45-second TypeScript check timeout; no compiler result returned.
- Module boundary: `harness-builder` and `chat-ui` both have `scope:webview`, `type:feature`; `eslint.config.mjs` permits `scope:webview` to depend on `scope:webview`. ESLint found no boundary error.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `WorkspaceScopeService.activeWorkspacePath()` for the launcher request | Workspace scope; app view state | Public core export and `prompt-enhancement.component.ts:303` use the active workspace signal. | Yes |
| Use `origin: 'independent-start'` for both new cards | Independent; analysis continuation | Launcher maps this origin to an independent intent; plan reserves continuation for analysis results. | Yes |
| Keep the Hub's current grid and card classes | Existing grid; new layout | B09 and design §2.6 require existing layout and card recipe. | Yes |

## Deviations

- The design's running-only status line and "Open running tab" label are not shown. The launcher exposes tab reuse but no verified run-state signal to this component; showing the label based only on tab existence would incorrectly call an idle tab running.

## Proposed Removals

None.
