## Files changed

- `libs/shared/src/lib/types/session-handover.types.ts` — revisioned handover state and unavailable begin result.
- `libs/shared/src/lib/types/session-budget.types.ts` — exposes handover state with budget state.
- `libs/shared/src/lib/types/rpc.types.ts` and `libs/shared/src/index.ts` — shared handover contract registration and export.
- `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts` — single-flight coordinator, durable compact wait, FIFO transfer/restore, token-safe close, host gate, and state listeners.
- `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts` — covers single-flight, origin holding, FIFO, failures, stale close, unavailable host, and state revisions.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts` and `.spec.ts` — source-neutral enqueueing, admission gate before activity, and SDK message construction only on dequeue.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts` and `.spec.ts` — neutral queue type and exact-order source restoration.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` — initial input now joins the neutral queue instead of prebuilding an SDK message.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts` and `.spec.ts` — terminal callback on successful interrupt and refusal while handover owns the source.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` — wires runtime callbacks, budget-aware terminal arming, interrupt gate, compact enqueue, restore, and token-safe close.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` and `.spec.ts` — captures a durable compact checkpoint and waits for a new persisted `compact_boundary`.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts` and `.spec.ts` — uses the selected compact boundary and bounded agent handoff seed text.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts` — removes the crossing-turn-plus-one follow-up allowance.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — invokes terminal handover arming before releasing a normal result turn.
- `libs/backend/agent-sdk/src/lib/di/register.ts` and `libs/backend/agent-sdk/src/index.ts` — coordinator registration and public exports.
- `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts` — successor-start contract with source snapshot, FIFO inputs, and resource lease.

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts` — completes the budget mock and asserts blocking-limit arming precedes turn release.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts` — reuses the harness's complete message factory for the dequeue-time pump regression.

## Tests

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.spec.ts --coverage=false --maxWorkers=2` — PASS: 7 suites, 263 tests, 0 failures. Tail: `Test Suites: 7 passed, 7 total; Tests: 263 passed, 263 total`.
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` — PASS. Tail: `Successfully ran target typecheck for project @ptah-extension/agent-sdk`.
- `npx nx typecheck @ptah-extension/shared --parallel=1` — PASS. Tail: `Successfully ran target typecheck for project @ptah-extension/shared`.
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1` — PASS. Tail: `Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime`.

Jest printed its existing ESM-config warning. Each Nx command also printed the disabled Nx Cloud organization warning after the local compiler completed successfully.

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff libs/backend/agent-sdk/src/lib/helpers/session-lifecycle libs/backend/agent-sdk/src/lib/helpers/session-budget libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts --coverage=false --maxWorkers=2` — PASS: 20 suites, 679 tests, 0 failures. PowerShell has no `tail`; the required output cap used the equivalent `| Select-Object -Last 40`. Jest printed its existing ESM-config warning and a worker graceful-exit warning after the passing result.
- `npx nx typecheck agent-sdk --parallel=1` — PASS. PowerShell output cap used `| Select-Object -Last 20`; `Successfully ran target typecheck for project @ptah-extension/agent-sdk`. Nx then reported its existing disabled Nx Cloud organization warning.

## Cross-lib impact

- `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:131,252` reads `messageQueue.length` only; it does not create or push `SDKUserMessage` values.
- `libs/backend/rpc-handlers/src/test-utils/surface-rpc-harness.ts:178` and surface-submit specs use `unknown[]` test queue fixtures; `surface-submit-turn.service.spec.ts:220` pushes a generic `{ type: 'user' }` fixture, not an SDK message.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-prompt-mailbox.ts:10-41` owns an independent `SDKUserMessage[]` prompt mailbox, not a session `messageQueue`. No `SessionQueueItem` references were found in either library.

## Hooks for batch B/D

- Subscribe with `SessionHandoverCoordinator.onStateChange(listener)`. The listener receives every revisioned `SessionHandoverState`; the returned function unsubscribes. Batch B can bridge this to the session-state RPC broadcast.
- Bind the optional host under `Symbol.for('ChildChatSessionHost')`. It must implement `IChildChatSessionHost.startSuccessorSession`, register and bind/focus the successor before returning `{ started: true }`; only then does the coordinator close the token-matched source.
- The host receives the durable builder seed, exactly-once ordered source-neutral transfer FIFO, source identity, and inherited resource lease. A `{ started: false }` outcome restores the FIFO to the source and leaves it open.

## Decisions

- The lifecycle manager evaluates `SessionBudgetService.canSend` before an interrupt terminal release, so both normal result and successful-interrupt paths arm handover before `markTurnEnded` wakes the queue.
- The coordinator owns `/compact`, records the prior durable boundary, and waits for a different persisted `compact_boundary`; the builder receives that exact boundary id, so pre-boundary transcript facts are ignored.
- Queue entries retain only source-neutral user-input data. `SessionStreamPump` creates SDK messages at dequeue time, allowing a failed/cancelled handover to restore exactly the original FIFO.
- `SESSION_SUCCESSOR_HOST` is optional. Without a bound host, external begin returns `unavailable` and does not arm, hold, compact, or close the source.

- The query-executor failure was an incomplete isolated test factory: production `SessionQueryExecutor` wiring already receives the concrete `SdkMessageFactory`; the regression now reuses its harness factory rather than adding a production fallback.

## Not done

- Batch B/D: provide and bind the real `IChildChatSessionHost` implementation, including live registration plus bind/focus confirmation, and forward the state-listener hook over the approved RPC path.
