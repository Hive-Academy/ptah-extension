# Batch AF3 report (Phase A fix round)

Written by the orchestrator. The opencode lane finished both fixes but exited while its typecheck+lint run was still
pending, before writing this report (completion verdict `no-deliverable`). The orchestrator verified the work instead
of resuming the lane.

## Files

- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts`

## Fix 1: TurnTestsRowComponent (review findings d / style minor)

- `role="status"` removed; the row is a plain `<section>` with its `aria-label` (no live region on historical turns).
- The template method call `outcomeClass()` is replaced by a constant lookup `OUTCOME_CLASS`
  (`turn-tests-row.component.ts:28`) and a `rows()` computed (`:154`) consumed at `:87`.
- The spec asserts no `role="status"` / `aria-live`; class assertions match tokens, not order.

## Fix 2: A5 boundary spec uses the real injected services (review finding e)

- The sentinel change set is pushed through the real `ChangeSetStore.handleMessage` (`git:turnChangeSet`) at
  `message-sender.host-data.spec.ts:263`.
- Positive control: `changeSetStore.changeSetsFor(SESSION_ID)` returns the sentinel change set (`:296`).
- Boundary test: `keeps host-built recap data out of the serialized chat:continue request` (`:289`).
- Negative control: `fails the boundary assertion when a sentinel does leak` (`:316-329`, `toThrow`).
- The lane also corrected the usage fixture to the real `MessageTokenUsage` fields (`input`/`output`).

## Verification (observed by the orchestrator)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap/`:
  1 suite, 14 tests passed.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts`:
  1 suite, 2 tests passed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-ui --parallel=1`: both targets succeeded.
