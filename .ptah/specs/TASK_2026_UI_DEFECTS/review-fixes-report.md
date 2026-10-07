# Review fixes report

## Design

The shared stats contract now distinguishes three budget cases:

- a `SessionBudgetState` installs the current budget;
- omitted (`undefined`) means the observation had no usable update, including a
  degraded `observe` failure, so the client preserves its displayed budget;
- `null` is an explicit known-absent state and clears the stale card.

`SessionBudgetService` returns the explicit marker only when it knows a
released session has no new owner. Its degradation catch remains `undefined`.
The SDK adapter, CLI stats publisher, and resume reply preserve `null` instead
of dropping it during object construction. The tab manager only patches
`sessionBudget` for a present state or the explicit marker.

The turn-recap component uses a module-level monotonic counter to give every
instance a distinct body id, with the button's `aria-controls` retaining its
matching target.

## Changes

- `libs/shared/src/lib/types/agent-adapter.types.ts:81-86` — documented and
  typed the live result budget as `SessionBudgetState | null | undefined`.
- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:307-310` — aligned resume
  budget semantics.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:194-198,206-210,311-339`
  — exposes an explicit known-absent result for a released, unowned session;
  faults continue to yield no update.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1679-1716` and
  `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:400-421` —
  preserve explicit `null` in stats broadcasts while omitting only `undefined`.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1164-1168`
  — preserves the same distinction in resume responses.
- `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:53-62`
  and `libs/frontend/chat-state/src/lib/tab-manager.service.ts:142-155,2250-2332`
  — propagate the marker and retain the last card for an omitted budget.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:2124-2144` — covers
  explicit no-state publication and degraded absence.
- `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts:1197-1253`
  — covers degraded retention, explicit clearing, and clearing a budget restored
  from persisted tab state after reload.
- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts:39,133`
  and its spec at `:137-159` — unique ids and matching ARIA assertions.

## Verification

- PASS — `chat-state` focused Jest: 96/96 tests.
- PASS — `chat-ui` focused Jest: 15/15 tests.
- PASS — `npx nx typecheck agent-sdk --parallel=1`.
- PASS — `npx nx typecheck chat-state --parallel=1`.
- PASS — `npx nx typecheck chat-ui --parallel=1`.
- PASS — `npx nx typecheck shared --parallel=1`.

The first focused `agent-sdk` Jest attempt failed before tests ran; after the
type correction, its rerun produced no filtered result before the command
window ended. The passing `agent-sdk` typecheck verifies the corrected contract
types, but the focused Jest result is therefore not confirmed. The attempted
`chat` typecheck likewise produced no completion output before the command
window ended. Nx reported its disabled-cloud notice on successful checks; it
did not affect their local target results.
