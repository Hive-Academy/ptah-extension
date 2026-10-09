# Session settings follow-up fixes

## 1. Lane guards visibility

- Classification: real UI defect. Lane guards was in a separate `@defer (on immediate)` block, but that still made its rendered card dependent on deferred-block scheduling. In practice it could remain absent while the preceding viewport-deferred Session budget card was unresolved, matching the reported hidden card.
- Fix: rendered Lane guards directly at `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:198`, so it has no viewport or defer-trigger dependency. The focused test now asserts the direct rendering while Session budget is held at its placeholder at `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts:242-255`.

## 2. Background-role summary contrast (corrected)

- Classification: stale assertion. History shows the prohibition was Batch 35's pre-token visual revision for a tinted muted colour; it was unrelated to deviation 4, which is solely the closed-details fold budget. The project now defines `text-base-content-muted` as a per-theme, contrast-tested secondary-text token (TASK_2026_186).
- Fix: restored `text-base-content-muted` for the summary helper at `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:161` and changed the test to require that semantic token at `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts:295`.

## 3. Tighten-window help copy

- Classification: stale brittle test. The concise help text still contained the requested words, but began the sentence with an uppercase `Advisory`.
- Fix: made the phrase assertion case-insensitive at `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts:365`, retaining the shorter component copy.

## Verification

Ran the prescribed focused Jest command once through Git Bash. Result: **67 passed, 67 total** across the lane guards, orchestration settings, and session budget settings specs. `git diff --check` reported no whitespace errors in the edited files.
