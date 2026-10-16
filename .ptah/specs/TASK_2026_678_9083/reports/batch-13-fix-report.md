# Batch 13 fix report

## Changes and spec coverage

1. Renamed native-name outputs to `commandSubmit` and `resumeSession`, including their emit sites: `command-session-controls.component.ts:27,78-79,92`. No session-controls spec exists in this batch, and no in-scope template or spec consumes the old names.
2. Bound the answer draft to the pending request ID with `linkedSignal`, so a new ID starts with an empty answer: `command-pending-input.component.ts:163`. Spec: `clears a typed answer when the pending request id changes`, `command-pending-input.component.spec.ts:110`.
3. Added per-ID guards to ordinary responses and roster declines, and disabled answered buttons. Decline remains available after timeout: `command-pending-input.component.ts:56,78,95,112,118,133,141,168-169,202-216`. Specs: `emits an ordinary answer once despite duplicate clicks`, `command-pending-input.component.spec.ts:124`; `emits Decline once despite duplicate clicks, including after timeout`, `command-pending-input.component.spec.ts:138`.
4. Clamped the active work row after projection changes, used that index for tabindex and arrow navigation, and updated the index on click: `command-work-list.component.ts:42-43,81-84,115-137`. Spec: `keeps a row keyboard reachable after the projection shrinks`, `command-work-list.component.spec.ts:74`.
5. Replaced four non-null assertions with a narrowing button lookup helper: `command-pending-input.component.spec.ts:25-31`, used by the confirm, choice, and timeout cases.

## Verification

- `npx eslint libs/frontend/command-center/src/lib/components`: exit 0, no findings.
- `npx prettier --check` on the five edited files: `All matched files use Prettier code style!`
- Scoped diagnostics: no errors in the five requested files. Seven errors remain in sibling files outside this batch (`tribunal-run-coordinator.spec.ts` and `capability-id-codec.ts`). Jest/Nx were not run in this lane as instructed.
- No new catch sites were added; degradation-audit catch classification: not applicable.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `linkedSignal` keyed by pending ID | `linkedSignal` or `effect` | The input's ID alone determines when the draft resets; the draft stays writable. | Yes |
| Store answered and declined IDs in sets | Last ID signal or sets | A set enforces at-most-once emission even if an ID reappears. | Yes |
| Clamp the derived focus index | Mutate the stored index on every projection update or compute the effective index | A computed index keeps one row in the tab order as soon as the projection shrinks. | Yes |

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-pending-input.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-session-controls.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-13-fix-report.md`

## Needed changes outside the batch

None for this fix round. The seven sibling diagnostics are outside the authorized scope.
