# B11 VS Code setup status widget

## Delivered

| File | Change | Lines |
| --- | --- | --- |
| `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts` | Added agent and project guidance actions through the generation launcher, with independent origin and safe failure handling; retained the existing wizard action and status display. | 4-9, 74, 126-145, 157-159, 246-270 |
| `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.spec.ts` | Added focused component and launcher integration coverage. | 1-154 |

## Acceptance

| Item | Result | File:line | Spec file:line |
| --- | --- | --- | --- |
| Both generation actions use active workspace and distinct workflow tabs | met | `setup-status-widget.component.ts:126`, `setup-status-widget.component.ts:246` | `setup-status-widget.component.spec.ts:80`, `setup-status-widget.component.spec.ts:117` |
| Second click focuses existing owner | met | `setup-status-widget.component.ts:254` | `setup-status-widget.component.spec.ts:106` |
| Failed launch shows short safe copy; cancellation stays silent | met | `setup-status-widget.component.ts:260` | `setup-status-widget.component.spec.ts:125`, `setup-status-widget.component.spec.ts:134` |
| Independent starts never set combined origin | met | `setup-status-widget.component.ts:257` | `setup-status-widget.component.spec.ts:101` |
| Existing analysis wizard action remains | met | `setup-status-widget.component.ts:117`, `setup-status-widget.component.ts:221` | `setup-status-widget.component.spec.ts:144` |

## Checks

- Focused Jest: 1 suite passed, 7 tests passed (`--coverage=false --maxWorkers=1`).
- ESLint on both scoped files: passed.
- Prettier applied to both scoped files.
- `ptah_get_diagnostics` scoped to both files: unavailable twice because the TypeScript check exceeded 45 seconds; orchestrator's serial checks remain necessary.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the existing Configure/Update wizard action and add two generation buttons below the status row | Replace old action; add direct generation actions | B11 requires both generation actions and analysis preservation; original widget used `setup-wizard:launch`; launcher accepts distinct workflow names. | yes |
| Use `TabManagerService.activeWorkspacePath` and `independent-start` origin | Derive workspace from status RPC; use combined origin | Tab manager exposes active path; launcher maps only `analysis-result-continue` to combined origin. | yes |
| Let the launcher own tab reuse and focus | Duplicate tab management in widget | Launcher finds the workspace/workflow owner and switches to it after navigation. | yes |

## Deviations

- Scoped TypeScript diagnostics were unavailable after two 45-second attempts; Jest and ESLint passed.

## Proposed Removals

None.