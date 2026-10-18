# B10 Chat project setup card

## Delivered

| File | Change | Lines |
| --- | --- | --- |
| `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts` | Keeps the skills warning, marketplace action, and one embedded setup status widget. The widget owns both generation actions. | 36-64, 108, 138-153 |
| `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.spec.ts` | Mounts the real widget and tests single action instances, launcher requests, and existing skills behavior. | 1-112 |

## Acceptance

| Item | Met/partial | File:line | Spec file:line |
| --- | --- | --- | --- |
| Exactly one agent and one guidance action in the card | Met | `project-setup-card.component.ts:108`; `setup-status-widget.component.ts:126-145` | `project-setup-card.component.spec.ts:75-80` |
| Both actions use the lower-layer launcher for the active workspace | Met | `setup-status-widget.component.ts:245-267` | `project-setup-card.component.spec.ts:82-95` |
| Same-workspace repeat focuses existing tab | Met through widget and launcher | `setup-status-widget.component.ts:245-267`; `generation-workflow-launcher.service.ts:47-55` | `setup-status-widget.component.spec.ts:86-95` |
| Failed landing shows short safe copy; cancelled landing stays silent | Met through widget | `setup-status-widget.component.ts:245-267` | `setup-status-widget.component.spec.ts:106-123` |
| Skills warning and marketplace action remain | Met | `project-setup-card.component.ts:36-64,138-153` | `project-setup-card.component.spec.ts:98-112` |
| Independent starts do not set combined origin | Met through widget | `setup-status-widget.component.ts:256-259` | `project-setup-card.component.spec.ts:89-95` |

## Checks

- `npx prettier --write` on both files: passed.
- Focused Jest with `--coverage=false --maxWorkers=1`: 1 suite, 4 tests passed.
- `npx eslint` on both files: passed.
- Scoped `ptah_get_diagnostics`: unavailable after its 45-second compiler timeout; neither file was checked by that tool.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Let the embedded widget own generation actions | Keep card actions too; delegate to widget | B11 widget now renders both buttons; retaining card buttons duplicated each action. The widget uses the public launcher and active workspace. | Yes |
| Exercise the real widget in the card spec | Stub widget; mount real widget | Duplicate buttons only surface when the real widget renders. Its RPC and launcher dependencies are mocked at the boundary. | Yes |

## Deviations

- Scoped TypeScript diagnostics did not complete within the tool timeout. Focused Jest and ESLint passed.

## Proposed Removals

None.

## Revision 1

- **Defect:** The card's direct buttons duplicated the agent and guidance buttons added to its embedded status widget.
- **Fix:** Removed the card's direct buttons, error block, launcher state/method, and unused imports. The card retains its original skills warning, marketplace action, and widget at `project-setup-card.component.ts:36-64,108,138-153`.
- **Spec:** The real widget renders exactly one of each generation button (`project-setup-card.component.spec.ts:75-80`); clicks call the launcher with the chosen workflow and active workspace (`:82-95`); skills behavior remains (`:98-112`).
- **Checks:** Prettier, focused Jest (4 tests), and ESLint passed. Scoped diagnostics timed out.
