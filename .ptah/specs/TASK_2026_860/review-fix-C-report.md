# Review fix C — sessions rail

## Findings

| Finding | Root cause | Change | Regression test |
| --- | --- | --- | --- |
| 2 — removal focus | The removed ID had index `-1` in the new displayed list, so recovery chose its first card. | `CanvasRailComponent` retains the prior visible IDs and chooses the next surviving displayed card, then the predecessor. | `canvas-rail.component.spec.ts`: removal from a regrouped list checks both successor and predecessor, including DOM focus. |
| 3 — close neighbour | `close()` chose a neighbour from stored tile order, including cards hidden by a collapsed Finished group. | It captures rendered card IDs before removal and uses the same visible neighbour for store selection and DOM focus. | `canvas-rail-board.component.spec.ts`: close across groups and close beside collapsed Finished cards. |
| 4 — anchor | The stored index and fixed card height omitted group headers and actual card geometry. | Every anchor measures the target card against the scroll container and scrolls only as needed. | `canvas-rail-board.component.spec.ts`: a group header shifts the target's measured bounds; the density anchor test also uses measured positions. |
| 5 — scroll restore | A rendered-card count mismatch returned before persisted scroll was restored. | Restoration now precedes the count guard; the guard applies only to geometry sampling. | `canvas-rail-board.component.spec.ts`: persisted scroll restores with four Finished cards collapsed. |

## Decisions

- **Visible close order:** Use the pre-close rendered cards. This matches the rail's display and collapse state without duplicating its expansion signal in the board. The choice is reversible.
- **Focus neighbour:** Share one small pure helper between removal and close. It searches surviving IDs after the old position, then before it. The choice is reversible.

## Verification

- `npm run verify -- -p @ptah-extension/canvas` — **passed** (3/3 tasks: lint, test, typecheck; exit code 0).
- `ptah_get_diagnostics` was attempted after edits but the TypeScript service timed out twice. The project verifier completed typecheck successfully.
- No rendered screenshot was taken because this task restricted verification to the canvas verifier and prohibited running a serve target.
- The `angular-frontend-patterns` skill was requested in project guidance, but this lane exposed no skill-loading tool or host skill catalogue. The implementation follows the repository's existing Angular signals and OnPush patterns.
