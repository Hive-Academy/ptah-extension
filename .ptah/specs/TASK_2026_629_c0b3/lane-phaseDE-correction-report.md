# Phase DE correction report

## Summary

Fixed N1, N2, and N4 in `@ptah-extension/canvas`. The grid component is 874 lines after Prettier (limit 877).

## Per-item status

1. **N1 — fixed.** `canvas-detail/canvas-detail-transcript.component.ts:54` tracks only `tabId`; the visibility check and registration run under `untracked`, so the signal read inside `registerVisibleTab` cannot retrigger the effect. Cleanup still unregisters only a tab this component registered. `canvas-detail/canvas-detail-transcript.component.spec.ts:7` covers an initially absent tab with a signal-backed manager, one registration, no premature unregister, and one unregister on destroy.
2. **N2 — fixed.** `canvas-workspace-grid.component.ts:365,383,717,755,794` stores applied constraints and compares their fingerprint with the current view. `canvas-grid-release.ts:7` filters applied constraints to surviving ids during a locked or hidden release. `canvas-workspace-grid.component.spec.ts:453` verifies a same-flush close plus another tile's view-mode change still loads; the existing locked close test at `:488` verifies no load for a close alone.
3. **N4 — fixed.** `canvas-detail/canvas-detail-keyboard.ts:13,27` exempts lane tabs from arrow navigation only; Esc closes detail. Existing input, menu, popover, and `defaultPrevented` guards remain. `canvas-detail/canvas-detail-keyboard.spec.ts:4` covers Esc and ArrowRight from a tab.

## Checks run

- Prettier `--write` on all seven changed source/spec files: completed.
- Focused transcript spec: 2 passed. Initial attempt exposed a signal read inside the registration callback; the corrected implementation passed on rerun.
- Focused keyboard spec: 1 passed.
- Focused grid spec: 87 passed.
- Full canvas test target: 26 suites, 317 tests passed.
- Canvas typecheck: passed; one existing NG8107 warning in `peer-session-send-dialog.component.ts`.
- Canvas lint: passed with 12 warnings, 0 errors; no new lint errors.

## Decisions

- **Applied constraints instead of a fingerprint alone.** Options were storing the previous constraints or managing a separate deferred flag. The constraints let a release remove membership without adopting a pending view-mode change. This is reversible by replacing the stored representation while preserving that distinction.
- **Untracked registration transaction.** Options were untracking only `visibleTabIds()` or the visibility check plus registration. The signal-backed test showed registration itself reads the signal, so the whole transaction is untracked. This is reversible if the manager API guarantees no signal reads during registration.

## Open items

- None for N1, N2, or N4. Review findings N3, N5, and N6 were outside this correction scope.
- `ptah_agent_report` is unavailable in this lane's tool set, so the parent session must read this report directly.
