# Batch 31 report - rotation variant of session-budget-banner (D.3)

## Changed files (all under libs/frontend/chat/src/lib/components/)
- molecules/notifications/session-budget-banner.component.ts and .spec.ts - `rotation` stage, `rotate` output, local "Keep this session".
- templates/chat-view.component.ts, .html and .spec.ts - `onBudgetRotate()` handler and `(rotate)` binding.

## Behaviour
- Banner: `rotation` variant has `role="status"`, shows `contextTokens`, and has "Rotate session" and "Keep this session" buttons with aria-labels. Same classes as the other stages.
- Keep: dismissed locally, no RPC, keyed on `sessionId:threshold`. An effect drops that session's keys when `rotation` is absent from the state, so a later crossing shows the banner again.
- Priority: budget.stage `handoff` or `limit` hides rotation, even if the handoff stage was dismissed with "Keep working". No store change was needed.
- Rotate: the existing N8 handler (`onBudgetContinue`) auto-sends through `sendOrQueueMessage`, so I added a prefill-only `onBudgetRotate()`. It calls `session:budgetAction` `preview-handoff` (via `runBudgetAction`), creates a tab, handles grid adoption like N8, and calls `appState.requestComposerPrefill(seed, grid ? tabId : null)`. This is the same prefill path task-prompt-bridge uses. The user sends the seed. No second seed builder.

## Checks (exit codes)
- `nx run-many -t test,lint,typecheck -p @ptah-extension/chat`: 0
- `nx affected -t typecheck --files=libs/frontend/chat/src/index.ts`: 0
- `nx run di-lint:lint`: 0
- `nx run degradation-audit:lint`: 0
- No png files rewritten.

## Deviations and notes
- When rotation is present and the stage is `tighten`, rotation wins, so the tighten OK and Restore buttons are hidden until rotation clears or is kept. The brief only named handoff and limit for hiding. Say if tighten should win instead.
- The Keep set is held in the banner (one instance per chat-view), keyed per session, so switching tabs does not lose another session's dismissal.
- Not exercised: R-W2 (preview-handoff refusing when the budget is disabled) is a backend concern for 29a.
