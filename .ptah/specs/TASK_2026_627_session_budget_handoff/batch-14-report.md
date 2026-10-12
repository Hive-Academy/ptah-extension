# Batch 14 report — Frontend tab state carries the live stage (F1-part)

Executor: frontend-developer. No git operations run.

## Task 14.1: `TabState.liveBudgetStage` and its setter — implemented

Evidence:

- `TabState.liveBudgetStage?: 'handoff' | 'limit' | null` added directly after `sessionBudget`, with a
  doc comment (advisory, display only, counted only while streaming with a non-null `sessionBudget`;
  cleared at result, on disable, and on a new or rebound session). It lives in chat-types, not in
  tab-manager as the plan says (R-P2).
- `TabManagerService.setLiveBudgetStage(tabId, sessionId, stage)` sits beside
  `installSessionBudget` / `clearSessionBudget`. It follows `clearSessionBudget`'s guard: it writes
  nothing for an unknown tab or a tab bound to another session. It skips the write when the stage is
  unchanged (`(tab.liveBudgetStage ?? null) === stage`), so a run of live payloads does not rewrite
  the tab signal. It never touches `sessionBudget`. Its signature takes the decoded value only
  (`'handoff' | 'limit' | null`). The aggregator (Batch 15) handles "absent = no change" by not
  calling it.
- Reset at all three places where `sessionBudget` is reset for a new or rebound session:
  `resetTabToFresh` (`liveBudgetStage: null` beside `sessionBudget: null`), `rebindTabSession`
  (same), and `applyResumingSession` (cleared together with `sessionBudget` only when the session
  id changes).

Spec cases added (`tab-manager.service.spec.ts`, `describe('liveBudgetStage (TASK_2026_627)')`):
sets `handoff`/`limit` on the bound tab; `null` clears and leaves the budget untouched; no write for
another session or an unknown tab; no write when the stage is unchanged; no write for `null` on a tab
that never had a stage; `resetTabToFresh` clears; `rebindTabSession` clears; `applyResumingSession`
clears for another session and keeps the stage for the same session. No existing case was changed.

## Changed files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-types\src\lib\chat-types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-manager.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-manager.service.spec.ts`

## Risk handling

- R-P2: the field is in chat-types and the setter is in chat-state. Both projects were typechecked.
- D25 "clear when the budget is disabled": `clearSessionBudgets()` / `clearSessionBudget()` were
  deliberately left unchanged. Changing their patch breaks an exact-payload assertion
  (`{ sessionBudget: null }`) in `tab-manager.intent-mutators.spec.ts:1339-1342`, which Batch 14
  does not own. The display is still correct without it. The plan's `displayStage` rule (Task 15.3)
  counts the live stage only while `sessionBudget` is non-null, so clearing the budget hides the live
  stage at once. The aggregator then clears the stored value at the turn's result (Task 15.1).
  To also clear the stored value on disable, the team-leader should assign both the helper and that
  spec line to one batch.

## Verification (each run under the shared `.ptah/tmp-check-lock`)

- `npx jest -c libs/frontend/chat-state/jest.config.ts libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts --coverage=false --maxWorkers=2`:
  1 suite passed, 60 tests passed.
- `npx nx typecheck @ptah-extension/chat-types --parallel=1 --skip-nx-cache`: succeeded.
- `npx nx typecheck @ptah-extension/chat-state --parallel=1 --skip-nx-cache`: succeeded.
- `npx nx lint @ptah-extension/chat-types --parallel=1 --skip-nx-cache`: succeeded, 0 problems.
- `npx nx lint @ptah-extension/chat-state --parallel=1 --skip-nx-cache`: succeeded, 0 errors and
  2 warnings, both from before this batch: `no-non-null-assertion` in
  `tab-manager.cross-workspace.spec.ts:115` (not touched), and `max-lines` on
  `tab-manager.service.ts` (the file was already far over 700 lines). No new warning.

## Out-of-scope observations

- `projectTabForPersist` / `sanitizeRestoredTab` (`libs/frontend/chat-state/src/lib/tab-persistence.ts`)
  persist and restore the whole tab, so `liveBudgetStage` survives a reload. The streaming-only display
  rule hides it, and restored tabs come back `loaded`. A persisted stage could still show for a moment
  at the start of the next turn on that session, until a live payload or a result clears it. To
  close that gap, add `liveBudgetStage: null` to both functions. That file is not owned by Batch 14.
