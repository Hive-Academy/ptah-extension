# Batch C report — session handoff frontend

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat.store.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `libs/frontend/chat/src/lib/services/index.ts`
- `libs/frontend/chat/src/lib/services/session-handover-client.service.ts`
- `libs/frontend/chat/src/lib/services/session-handover-client.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`
- `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts`
- `libs/frontend/chat/src/lib/services/session-budget-actions.service.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts`

## Tests

- `npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts --coverage=false --maxWorkers=2` — passed: 1 suite, 43 tests.
- `npx jest -c libs/frontend/chat/jest.config.ts [7 changed/new chat specs] --coverage=false --maxWorkers=2` — 6 suites passed; 245 tests passed. One unrelated existing assertion failed: `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1418`, `resolvedResumableSubagents() scoping` includes the other session's subagent. It is outside the handoff changes. The session-loader test harness also logs its existing mocked-RPC warning.
- `npx nx typecheck @ptah-extension/chat --parallel=1` — passed. Existing warning only: `peer-session-send-dialog.component.ts:181` NG8107.
- `npx nx typecheck @ptah-extension/chat-streaming --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/shared --parallel=1` — passed.
- `npx nx lint @ptah-extension/chat --parallel=1` — passed with 32 existing warnings (mostly non-null assertions and known max-lines files).
- `npx nx lint @ptah-extension/chat-streaming --parallel=1` — passed with 2 existing warnings: `agent-monitor.store.ts:1241` max-lines and `streaming-event-cascade-clean.spec.ts:8` unused type.
- Scoped editor diagnostics were unavailable: the TypeScript diagnostic worker was still running after 45 seconds. The successful Nx typechecks above cover the affected projects.

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts --coverage=false --maxWorkers=2` — passed: 1 suite, 11 tests (automatic handover fallback, progress and cancellation included).
- `npx nx typecheck @ptah-extension/chat --parallel=1` — passed after the single-notification update.
- `npx nx lint @ptah-extension/chat --parallel=1` — failed on 2 pre-existing errors and 32 existing warnings. The filtered final 40 lines identify only unchanged warning locations (including `chat-view.component.spec.ts:1357`, `chat-view.component.ts:1082`, `session-loader.service.ts:1040`, `provider-setup-wizard.component.ts:809`, and `cli-orchestration-matrix.component.ts:732`); the edited banner files were not listed. The command was not rerun solely to recover earlier output.
- Scoped diagnostics found no diagnostics in the edited banner files. The diagnostic service also reports existing sibling test errors, including `agent-card-truncation.spec.ts:135`, `compact-session-card.component.spec.ts:232`, and `execution-node.send-message.spec.ts:70`; none were changed.

## Decisions

- `session:stats` records revisioned handover state immediately, while `ChatViewComponent` renders the one owner banner only when its resolved tab has terminal `status: 'loaded'` and is the active tab. This prevents a stats-first notification during generation and suppresses duplicate mounted views.
- A terminal `turn_state` snapshots every affected tab's queue before state application, applies the terminal state, then emits a flush only if that revision was accepted. `ChatStore` dispatches that flush synchronously in the same stream-processing path, before Angular can render the idle budget banner.
- Queue content remains in its composer until `continueExistingSessionForQueueFlush` succeeds or returns the typed `SESSION_HANDOVER_HELD` FIFO acknowledgement. Refusal/error preserves it; a concurrent newer queue entry is merged rather than overwriting either message.
- The client consumes backend-armed automatic handover state in the same single banner. Before that state arrives, handoff shows a neutral “Preparing to continue in a new session…” fallback with only `Continue now`; active progress has only `Cancel (keep working)`, and failed handovers offer Retry and Keep working. No toast stack is introduced.
- `session:successorReplacement` is revision/operation guarded, rebinds and focuses the source slot, applies model and effort, then sends the exact `session:successorBound` acknowledgement. Stale replacements are ignored.
- `permissionLevel` and `workspacePath` are deliberately not re-applied in the webview: the backend already starts the successor with copied configuration. The frontend applies only model and effort.
- 40M single-notification rule: implemented (user confirmed it belongs to this task)
- The client renders the backend-provided `handoff` stage rather than a token literal, so the default 40M threshold remains 80% of the configured session limit. `installSessionBudget` only updates that state; it cannot create a second notification.

## Contract gaps

None actionable for Batch C. `SESSION_HANDOVER_HELD` is now represented in the shared `RpcUserErrorCode` union.

## Not done

The unrelated resumable-subagent assertion at `chat-view.component.spec.ts:1418` remains failing and was not changed. No backend files were edited.
The chat lint target remains blocked by its two pre-existing errors; the edited banner files have no scoped diagnostics.
