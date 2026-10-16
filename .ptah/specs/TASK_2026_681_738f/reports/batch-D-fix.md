# Batch D fix report

## Changes

- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:332,357`: CLI tokens prefer a numeric `totalTokens`, otherwise sum numeric input and output counts. Missing, nonfinite, and zero totals suppress the badge.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:200,278`: CLI cost now uses the existing `formatEstimatedCost` output in a neutral badge with the title "Reported or estimated cost". The exact green cost badge is no longer used for CLI rows.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.spec.ts:39-71`: cover the estimate marker, total-only tokens, input plus output, input-only absence, zero suppression, and absent cost.

## Verification

- Focused Jest command: 1 suite passed, 6 tests passed.
- Scoped `ptah_get_diagnostics`: no diagnostics in either edited file. It reported 266 errors in sibling files outside this batch; those files were not edited.

## Decisions

- Used a neutral local badge for CLI cost. Options were the shared `ptah-cost-badge` or local markup. Evidence: the shared badge has no provisional input and applies success styling with an exact USD title, while the lane already uses `formatEstimatedCost` and "Reported or estimated cost". Reversible.
- A numeric reported total takes precedence over input plus output, including a reported zero. Evidence: M4 calls for the reported total first and the adjacent non-CLI row suppresses zero. Reversible.
