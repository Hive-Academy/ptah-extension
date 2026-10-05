# Batch 28c report — Component 10.3 backend (F11)

## Verdict
DONE. A-W1 holds. Subagent `message_complete` events now carry `tokenUsage.contextTokens`. This is computed at the emit point from the same request's usage, so it needs no lookup, no poll and no new message type.

## A-W1 check
- Event: `MessageCompleteEvent`, declared in `libs/shared/src/lib/types/execution/stream.ts:219`.
- Emit point: `AssistantMessageTransformer.transform`, in `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts` (the `tokenUsage` literal at about line 363). It already had `cacheRead` and `cacheCreation`, so the monitor snapshot was not needed.
- Delivery: `accumulator-core.service.ts:530-539` (`message_complete` with `parentToolUseId`) calls `agentMonitorStore.onSubagentMessageComplete(event)` (`agent-monitor.store.ts:1862`).
- The stream-path `message_complete` (`stream-event.transformer.ts:317`) carries no `tokenUsage`, and that is unchanged.

## Field path for 28e
`MessageCompleteEvent.tokenUsage.contextTokens?: number`
- Present only when `event.parentToolUseId` is set.
- Value = `input + (cacheRead ?? 0) + (cacheCreation ?? 0)` for that request. This is the same definition as the monitor's `lastRequestContextTokens`.
- Absent on main-session messages.

## Changed files
- MODIFIED `libs/shared/src/lib/types/execution/stream.ts`: added an optional `contextTokens` (with a doc comment) to `MessageCompleteEvent.tokenUsage`. There is no spec for this file.
- MODIFIED `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts`: the subagent-only `contextTokens` spread in `tokenUsage`.
- MODIFIED `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts`: new `describe('subagent contextTokens (F11)')` with 3 tests. A subagent message gets 1500 = 100 + 1000 + 400. Missing cache fields count as 0 (gets 120). A main-session message gets no `contextTokens`. The existing main-session `toEqual` tokenUsage tests still pass unchanged.

## Checks
- `jest assistant-message.transformer.spec.ts`: 30/30 passed.
- `nx run-many -t test,lint,typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk`:
  - shared: lint and test passed.
  - agent-sdk: lint passed. Test: 2938 passed and 1 failed. The failure was `session-handoff-writer.spec.ts`, a known load flake; re-run alone it passed 9/9.
  - Typecheck in that first run failed only because I wrongly passed `-- --maxWorkers=2` through to tsc (TS5023). Re-run without it: `nx run-many -t typecheck -p shared agent-sdk` exit 0.
- `nx run di-lint:lint`: exit 0.
- `nx run degradation-audit:lint`: exit 0.
- Affected typecheck (`run-many -t typecheck --exclude='api-*,ptah-license-server,ptah-landing-page-e2e'`): exit 0, no `error TS`. `shared` is a root dependency, so this covers every typecheck project except the excluded ones.

## Deviations
None. `cacheRead` and `cacheCreation` are still not declared on the shared `tokenUsage` type, as before. Only the one field was added, and the store keeps reading them structurally.

## PNGs
No `*.png` was touched by this batch.
