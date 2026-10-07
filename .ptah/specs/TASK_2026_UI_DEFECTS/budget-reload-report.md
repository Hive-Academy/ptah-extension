# Budget reload fix report

## Root cause

`SessionBudgetService` keeps `BudgetEntry` objects in process memory. After a host reload, an action against a restored session reaches `noState()` at `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:919` and used to return only the human-readable error.

The visible stale card was retained by the client: `budgetPatch()` in `libs/frontend/chat-state/src/lib/tab-manager.service.ts:148` previously made an accepted restored stats snapshot with no matching budget leave `sessionBudget` untouched. The stored stats can survive a reload while the backend budget entry cannot.

## Fix

- Added `SessionBudgetActionErrorCode` and optional `errorCode` to the shared result at `libs/shared/src/lib/types/session-budget.types.ts:303` and `:324`.
- Backend `noState()` now returns `NO_SESSION_BUDGET_STATE` at `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:923`.
- An accepted stats snapshot without a matching budget now explicitly clears `sessionBudget` in `budgetPatch()` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:148`). This is the smaller correct choice over rebuilding an in-memory policy entry from historical stats: it avoids asserting a fresh backend policy/configuration or dismissed-stage state that cannot be recovered truthfully.
- `SessionBudgetActionsService` treats that typed response as a successful stale-card dismissal: no error banner is shown, action state is cleared, and the still-matching tab budget is cleared (`libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:292`).
- Added regression coverage in the action service, backend budget service, and tab-manager snapshot specs.

## Part 2 status

The interrupted lane had already completed the requested UI functionality before this pass:

- Budget banner sparkline input/rendering and Compact output are present at `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts:155`, `:393`, and `:411`; the action service records the bounded usage series and sends `/compact` through the composer path.
- Chat view wiring for usage, compacting state, and Compact action was already present in `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`.
- `ptah-compaction-notification` had already been restyled as the compact card with stage tones, progress, and before/after/freed stats at `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-notification.component.ts:15`, `:149`, and `:164`.

I inspected these changes, confirmed their focused tests, and did not overwrite the lane's existing UI work.

## Verification

Passed:

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 64 tests.
- `npx jest -c libs/frontend/chat-state/jest.config.ts libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 94 tests.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/session-budget-actions.service.spec.ts libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts --coverage=false --maxWorkers=2` — 2 suites, 62 tests.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-notification.component.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 4 tests.
- `npx nx typecheck @ptah-extension/agent-sdk` — passed.
- `npx nx typecheck @ptah-extension/chat-state` — passed.
- `git diff --check` — passed.

Not completed because of unrelated existing type errors outside this work:

- `npx nx typecheck @ptah-extension/chat` fails at `chat-view.component.ts:173` (TS1206) and `cli-model-effort-popover.component.ts:497` (TS2322).
- `npx nx typecheck @ptah-extension/chat-ui` fails at `turn-recap/turn-tests-row.component.ts:109` (TS2339: `TurnTestRow.project`).

No workspace-wide checks, builds, or destructive git operations were run.
