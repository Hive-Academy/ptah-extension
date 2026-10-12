## Files changed

- `libs/shared/src/lib/types/session-handover.types.ts`, `rpc.types.ts`, and `types/messages/{agent-session,message-constants,payload-map}.ts` — added bounded composer input, successor-bound RPC contracts, and the typed `session:successorReplacement` host-to-webview event.
- `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts`, its spec, and `session-lifecycle-manager.ts` — carry an operation id plus explicit source model, effort, permission level, and workspace configuration into the successor host.
- `libs/backend/cli-agent-runtime/src/lib/session-children/{child-chat-session-host.port,index}.ts` — extended the successor-host port and its public type export with the acknowledgement operation.
- `libs/backend/rpc-handlers/src/lib/chat/session/{child-chat-session-host.adapter,chat-session}.ts` — starts a registered replacement, seeds then delivers the FIFO once, waits for a correlated bind/focus acknowledgement when a webview exists, cleans up an unacknowledged successor, and holds handover prompts before CLI/budget/interrupt paths.
- `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.{handlers,schema,handlers.spec}.ts` — added validated begin, cancel, and successor-bound RPC methods and revisioned state broadcasting.
- `libs/backend/rpc-handlers/src/lib/{handlers/index.ts,host-profile/manifest.ts,rpc-allowlist.spec.ts}` — exported and mounted the handover handler, and asserted its registry ownership.
- `libs/backend/rpc-handlers/src/lib/chat/session/{child-chat-session-host.adapter.spec,chat-session.service.spec,chat-session-budget.spec}.ts` — added successor registration/FIFO, acknowledgement, prompt hold, and stop-intent coverage.

`chat/di.ts` already bound `ChildChatSessionHostAdapter` under the required `Symbol.for('ChildChatSessionHost')` token, so it required no change. The existing budget handler/schema keep `preview-handoff` read-only and `write-handoff` unchanged; Batch C's continue action is contractually routed through `session:beginHandover` instead of repurposing either budget action.

## Tests

- `npx nx typecheck rpc-handlers --parallel=1` — passed (run after the final production edits).
- `npx nx typecheck agent-sdk --parallel=1` — passed.
- `npx nx typecheck shared --parallel=1` — passed.
- `npx nx typecheck cli-agent-runtime --parallel=1` — passed.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff --coverage=false --maxWorkers=2` — passed: 1 suite, 10 tests.
- Scoped TypeScript diagnostics for all edited RPC production/spec files — clean, 0 errors and 0 warnings.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts ... --coverage=false --maxWorkers=2` — blocked by the workspace test environment before five suites ran: the inherited Jest resolver maps `marked` to `node_modules/marked/lib/marked.umd.js`, which is absent in this worktree. Jest reported 1 passing suite / 10 passing tests and 5 setup failures. This is not a test assertion failure; no package/configuration mutation was made outside the batch scope.

## Contract for batch C

- Host event: `session:successorReplacement` (`MESSAGE_TYPES.SESSION_SUCCESSOR_REPLACEMENT`), typed by `SessionSuccessorReplacementPayload` in `libs/shared/src/lib/types/messages/agent-session.ts`.
- Event payload: `{ operationId, sourceSessionId, sourceTabId, successorSessionId, successorTabId, config: { model?, effort?, permissionLevel?, workspacePath } }`. The successor id is the backend-minted replacement tab/stream UUID until the SDK resolves its persistent session UUID.
- On this event, bind the successor into the source tab's slot and focus it. Do not give a top-level successor a parent link. Once both operations succeed, invoke `session:successorBound` with `{ operationId, sourceTabId, successorTabId }`.
- `session:successorBound` returns `{ acknowledged: boolean }`. The host accepts only the current operation and exact source/successor tab pair; a mismatch is not an acknowledgement.
- `startSuccessorSession` waits at most `SUCCESSOR_BIND_TIMEOUT_MS` (15,000 ms) after live registration and event delivery. A matching acknowledgement returns `{ started: true }`; a timeout leaves the source open, restores its FIFO through the coordinator, and interrupts the already-started replacement so no orphan remains. A host with `getActiveWebviews().length === 0` is headless and confirms immediately after live registration.
- Begin handover with `session:beginHandover`: `{ sourceSessionId, sourceTabId, handoff?: string, queuedInput?: string }`; each optional text field is trimmed and limited to 12,000 characters. It returns `{ accepted: true, state }` or `{ accepted: false, error: 'unavailable' }`.
- Cancel with `session:cancelHandover`: `{ sourceSessionId, operationId }`, returning `{ cancelled, state? }`.
- Each coordinator revision is pushed through the existing `session:stats` channel as `{ sessionId: state.sourceSessionId, handover: state }`. Consume `handover.revision` monotonically; no polling is involved.

## Decisions

- A webview acknowledgement, rather than completion of `broadcastMessage`, is the close safety boundary. The adapter uses the concrete host implementations' existing `getActiveWebviews()` capability to distinguish interactive hosts from CLI/headless hosts.
- Configuration is copied from the lifecycle record explicitly, not inferred from current defaults. The successor runs on the lease's existing worktree path; its parent/MCP lease fields remain available on the port for Batch D's child-successor dispatch.
- The adapter projects queued inputs to content/files/images before passing them to the trusted chat service. It deliberately does not propagate an untrusted port `origin` field into SDK messages.
- The common handover admission runs after the exact `/compact` and `/clear` exemptions but before Ptah CLI and budget refusal. Stop intent checks the same coordinator before `interruptCurrentTurn`, preserving its `Promise<boolean>` contract outside handover.

## Not done

- Batch C must consume the event/state contracts, replace/focus the tab, and send the acknowledgement RPC.
- Batch D owns nested-child successor dispatch, including applying inherited parent ids and MCP-root lease lifecycle rules. Batch B forwards the existing resource lease and uses its worktree path but does not create or release child resources.
- The focused rpc-handlers Jest suite needs the missing `marked` UMD artifact (or its repository-approved Jest resolver update) before its five setup-blocked suites can execute.
