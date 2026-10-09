# Shared session hand-over

## Current behavior

All findings below are verified in this worktree.

### a. Budget UI can appear during the closing turn

The adapter publishes budget statistics before the terminal stream event: result-stats are emitted at [stream-transformer.ts:944-980](libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:944) and observed at [sdk-agent-adapter.ts:1679-1692](libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1679), whereas the frontend completes the turn later. `ChatView` renders a banner whenever a budget exists, without an idle-phase guard ([chat-view.component.html:138-152](libs/frontend/chat/src/lib/components/templates/chat-view.component.html:138)); the banner itself also has no generating branch ([session-budget-banner.component.ts:263-280](libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts:263)).

### b. Queued user text is neither sent nor carried reliably

The streaming stats and terminal-state paths do not consistently return queued text ([streaming-handler.service.ts:607-634](libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:607), [streaming-handler.service.ts:209-211](libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:209)). A later `chat:continue` can be rejected by `refuseIfBudgetReached` ([chat-session.service.ts:459-484](libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:459)), after which the dispatcher restores it on the old tab ([message-dispatch.service.ts:247-258](libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:247)).

`continueInNewSession` writes a handoff, creates a tab, and sends only its seed ([session-budget-actions.service.ts:146-160](libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:146)); it does not coordinate `tab.queuedContent`, successor confirmation, or a backend transfer queue. The current builder is transcript-tail based, not composer-state based ([session-handoff-builder.ts:1-18](libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts:1)).

### c. Budget notices stack

Each mounted `ChatView` renders a banner ([chat-view.component.html:138-152](libs/frontend/chat/src/lib/components/templates/chat-view.component.html:138)). The single/grid layouts stay mounted ([app-shell.component.html:768-807](libs/frontend/chat/src/lib/components/templates/app-shell.component.html:768)) and canvas tiles mount further views ([canvas-tile.component.ts:564-576](libs/frontend/canvas/src/lib/canvas-tile.component.ts:564)). Stats install the same budget on every bound tab ([session-stats-aggregator.service.ts:117-160](libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:117)), with no display-owner guard in `TabManager` ([tab-manager.service.ts:2247-2271](libs/frontend/chat-state/src/lib/tab-manager.service.ts:2247)). Each view has only a local action-call lock ([session-budget-actions.service.ts:81-83](libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:81)), so each banner may invoke Continue.

### d. Inputs can create turns past the limit

The budget check currently exists only on `ChatSessionService.continueSession` ([chat-session.service.ts:163-180](libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:163), [chat-session.service.ts:459-484](libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:459)). The common pump marks active, creates an SDK message, and pushes `messageQueue` with no admission gate ([session-stream-pump.service.ts:218-250](libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:218)). `markTurnEnded` then wakes the queue ([sdk-agent-adapter.ts:1739-1742](libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1739)); the budget service explicitly permits the crossing turn plus one held follow-up ([session-budget.service.ts:30-34](libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:30)). A successful explicit interrupt has a second, independent release path: `SessionControlService` calls `registry.markTurnEnded` after `query.interrupt()` succeeds, outside the result hook ([session-control.service.ts:108-116](libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:108)). It can therefore wake and start a queued source turn while the crossing turn's budget has not yet armed a handover.

Lane completions and reports call the pump through `sendMessageToSession` without the chat-RPC guard ([lane-completion-notifier.service.ts:329,447](libs/backend/cli-agents/src/lib/lanes/lane-completion-notifier.service.ts:329), [agent-report-router.service.ts:341,502](libs/backend/cli-agents/src/lib/agent-reports/agent-report-router.service.ts:341)); peer relay does likewise ([peer-session-messenger.service.ts:128](libs/backend/cli-agents/src/lib/peer-session-messenger.service.ts:128)). Ptah CLI continue does too ([chat-ptah-cli.service.ts:274](libs/backend/rpc-handlers/src/lib/chat/chat-ptah-cli.service.ts:274)). Therefore those callers can start turns until some UI action explicitly begins a handover.

`ptah_session_send` in `steer` mode first calls `interruptCurrentTurn`, then sends ([session-spawner.service.ts:573-600](libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:573)); the interrupt bypasses the pump ([sdk-agent-adapter.ts:1472-1476](libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1472)). `if-idle` and surface submit take the `require-idle` refusal path ([session-spawner.service.ts:572-576](libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:572), [surface-submit-turn.service.ts:298](libs/backend/rpc-handlers/src/lib/chat/surface-submit-turn.service.ts:298), [session-stream-pump.service.ts:266-284](libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:266)); their text is not otherwise transferred. The composer stop-intent branch has the same loss mode: it sends the follow-up only if `interruptCurrentTurn` returns `true`, otherwise returning a retry error ([chat-session.service.ts:959-967](libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:959)).

### Depth refusal

The start schema presently requires child task/branch fields ([session-tool-args.schema.ts:32-53](libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts:32)), and the spawner refuses a child caller with `depth-exceeded` ([session-spawner.service.ts:273-279](libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:273)). That correctly protects concurrent nested children, but also prevents a child from handing off to a replacement.

## Design

### One coordinator and operation state machine

Create `SessionHandoverCoordinator` in `libs/backend/agent-sdk`, registered in the agent-sdk DI container. It is the sole per-source-session authority for budget handover and MCP successor handover; frontend code reaches it only through shared typed RPC. Its map is keyed by source session ID and is a single-flight compare-and-set operation ID.

`idle -> waiting-for-turn-end -> armed -> awaiting-confirmation -> compacting -> writing-handoff -> starting-successor -> successor-confirmed -> closing -> closed` is the normal path. A budget limit enters `armed -> awaiting-confirmation`; an explicit budget Continue confirms it, and an explicit MCP successor is already confirmed once valid. A request made during a turn is `waiting-for-turn-end`, not a compaction start. Any request/limit race returns the existing operation and never creates a second target. `failed` and `cancelled` restore the source; only cancellation before compaction is allowed.

At either terminal release, the adapter/lifecycle manager must calculate the latest observed budget decision and synchronously call `armAtTerminal` / `onTurnTerminal` before `markTurnEnded` releases the pump. This applies both to the normal result hook and to `SessionControlService`'s successful-interrupt path; the latter must not call `registry.markTurnEnded` directly. If `stage === 'limit' && blockAtLimit`, the gate atomically creates the budget operation and drains any already-queued source items into the transfer FIFO. If a handover was requested while active, it atomically arms that existing request. Only after this transition may either terminal path call `markTurnEnded`. This is the required auto-arm: the banner decides **confirm or cancel**, never whether the gate first closes.

The coordinator publishes a revisioned handover snapshot with the budget/session state. The snapshot is not displayed until frontend terminal `turn_state` establishes idle. Continue moves an armed budget operation into compaction; cancel is paired with the existing extend/restore/keep-working budget action, disarms the operation, and releases the FIFO to the source in original order. A cancellation at a still-blocked limit must return a budget action that permits continued work; it cannot silently release blocked input.

### Admission, FIFO, and source behavior

Replace queued prepared SDK messages with a validated, source-neutral `QueuedSessionInput` envelope (text, files/images, origin, intent). The SDK message is constructed only at dequeue, because its session identity cannot be moved safely before then.

`SessionStreamPump.sendMessage` calls coordinator admission **before** `markActive` and before queue `push` ([session-stream-pump.service.ts:224-250](libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:224)). Its queue-drain path makes the same check. Consequently every `sendMessageToSession` caller is covered: composer, lane completion, agent report, peer message, Ptah CLI, default MCP queue sends, session spawner, and direct chat service callers. When a terminal operation arms, existing `messageQueue` entries are synchronously moved to the transfer FIFO; later inputs append to that FIFO. No source turn can start from `armed` through `closing`.

Every source-interrupt caller runs `admitInterrupt` before invoking the existing `interruptCurrentTurn(): Promise<boolean>` adapter/control call. From `waiting-for-turn-end` through `closing`, that admission returns `SESSION_HANDOVER_IN_PROGRESS`; the caller does not interrupt the source and the boolean adapter contract is unchanged. `steer` validates and enqueues its text on the transfer FIFO before returning that clear code/held result; it must never then make the idle send. During handover, `require-idle`, `if-idle`, and surface submit are deliberately **held**, not normally refused: their validated payload is appended to the FIFO and their caller receives `SESSION_HANDOVER_HELD` (`held: true`, operation ID). That code is terminal for the caller, so it neither retries nor drops text. Outside handover, today's `require-idle` refusal remains unchanged.

`tab.queuedContent` is not a server queue, so it must not depend on a Begin payload. On terminal `turn_state`, and again when the revisioned handover-state broadcast transitions to armed, the frontend session-state consumer asks `MessageDispatchService` to flush that source tab through ordinary `chat:continue`. In `ChatSessionService`, after preserving the existing `/compact` and `/clear` exemption, coordinator/pump admission runs before both the Ptah CLI branch and `refuseIfBudgetReached`: an existing operation or coordinator-armed blocking limit returns `SESSION_HANDOVER_HELD` and never reaches either rejection/diversion path. `refuseIfBudgetReached` remains the no-operation, no-admission fallback. Thus the armed pump admits the flush as `SESSION_HANDOVER_HELD`; only that accepted response clears `queuedContent` (and its options). This makes an MCP-armed successor transfer composer text as well as a banner-armed one; duplicate terminal/broadcast attempts are idempotent by tab content revision. On failure/cancel the coordinator restores backend FIFO inputs and the frontend retains/restores composer text. The successor receives deterministic handoff seed first, then this FIFO in stable arrival order.

The same early handover check precedes the composer stop-intent branch. When an operation is in progress, `ChatSessionService` puts the validated follow-up on the transfer FIFO and returns `SESSION_HANDOVER_HELD`; it does not call `interruptCurrentTurn` and never returns a retry error. The adapter's `interruptCurrentTurn(): Promise<boolean>` contract stays unchanged for non-handover use; its caller, rather than the adapter result, checks coordinator state first.

### Compaction and handoff content

On confirmation, coordinator sends its owned `/compact` exemption while source admission stays closed. It records the prior compact-boundary identity and waits, using the durable boundary wait in [session-history-reader.service.ts:502-516](libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:502), for a **new** `compact_boundary`. Only then can it write the handoff document.

Change `SessionHandoffBuilder` to parse that boundary rather than skip it: take its summary, and ignore every transcript line at or before the new boundary when deriving changed files, todos, and last assistant text. This replaces the current whole-tail extraction ([session-handoff-builder.ts:312-338](libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts:312)) and one-shot read ([session-handoff-builder.ts:576-579](libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts:576)). It prevents the present “No compaction summary” result at [session-handoff-builder.ts:447](libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts:447).

Both `session:beginHandover` and MCP `mode: 'successor'` accept optional agent-written `handoff`. Validate/truncate it according to `SESSION_HANDOFF_LIMITS`; after the durable compacted builder output is produced, prepend this text to the successor seed. It is supplemental context, not a bypass of the durable document. Task, branch, worktree, label, and model remain forbidden in successor mode.

### UI and successor lifecycle

Show the budget banner only on the focused display owner for a session, keyed by session ID plus state revision, and only after terminal idle. Hidden/unfocused views do not mount it. `SessionBudgetActionsService` becomes the one RPC caller: it reserves one pending target tab after accepted begin and never directly writes a document, opens a second tab, or sends a seed. Preview remains read-only.

Successor start is a strict `mode: 'successor'` variant. A top-level source creates a top-level successor with no link to the closing source. A child source creates a sibling: copy the source child’s inherited parent IDs, never set a parent/session/registry link to the closing child, and retain the real-child depth check unchanged for `mode: 'child'` only.

`startSuccessorSession` adopts the child source's `worktreePath` and MCP-root retention before confirming live successor registration. It also preserves inherited-parent ownership. Source shutdown then uses a handover-close resource disposition: no rollback, no `releaseMcpRoot` for that shared path, and no inherited-parent-owner release ([session-spawner.service.ts:936-942,1278-1288](libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:936)). Before `endSessionIfTokenMatches`, bind the successor into the source tab slot (or bind and focus the reserved target tab) and move focus there. Confirmation is therefore both a live backend registration and an interactive replacement; only then may the source close.

## Contracts

| Target | New or changed contract |
| --- | --- |
| `libs/shared/src/lib/types/session-handover.types.ts` (new) | `SessionHandoverReason`, phases, revisioned state, `BeginSessionHandoverParams { sourceSessionId, sourceTabId, handoff? }`, cancel params/result, and response codes `SESSION_HANDOVER_HELD` / `SESSION_HANDOVER_IN_PROGRESS`. `handoff` is bounded by `SESSION_HANDOFF_LIMITS`; frontend may not specify origin/internal FIFO fields. |
| `libs/shared/src/lib/types/session-budget.types.ts` | Add optional revisioned `handover` state to `SessionBudgetState`; retain preview/write action contracts and limits. |
| `libs/shared/src/lib/types/rpc.types.ts` and shared index | Add `session:beginHandover` and `session:cancelHandover` to `RpcMethods`/`RPC_METHODS`; Begin returns accepted operation state, progress arrives in existing session state/stats broadcasts. |
| `session-handover-rpc.handlers.ts` (new) | Validate the shared request, resolve host/source, call coordinator, return no-partial-close errors, and use the source tab only for binding/flush correlation. |
| `session-handover-coordinator.service.ts` (new) | `request`, `armAtTerminal`, `admitOrHold`, `admitInterrupt`, `confirm`, `cancel`, durable compact/write, `releaseToSuccessor`, restore, and token-safe close. Owns operation map and FIFO. |
| agent-sdk lifecycle registry/pump/manager/adapter/control | `QueuedSessionInput`, admission result, atomic terminal hook, queue drain/move, and no result-hook or successful-interrupt release before arm decision. |
| `chat-session.service.ts` | Preserve `/compact` and `/clear`; before Ptah CLI, budget refusal, or stop-intent interruption, use coordinator admission to return `SESSION_HANDOVER_HELD` for an operation/armed limit. |
| `session-handoff-builder.ts` | Accept compact-boundary context and optional bounded agent handoff; wait for new durable boundary, summarize it, exclude lines at/before it, prepend agent handoff to seed. |
| MCP `session-tool-args.schema.ts` | Discriminated union: current child shape remains required; `{ mode: 'successor', handoff?: string }` forbids task, branch, worktree, label, and model. |
| session-spawner port/service and child host port | Successor request/result and `startSuccessorSession(source snapshot, seed, resource lease, confirmation identity)`; child depth check applies only to `child`; handover close disposition transfers worktree/MCP-root/inherited-parent leases. |

## Batches

Run **A first, then B; C and D may run in parallel after A**. B, C, and D have no overlapping files. The port is intentionally in A so B compiles when it adds the adapter implementation.

### A. Shared contracts, terminal gate, compaction builder, and host port — backend

Files:

- `libs/shared/src/lib/types/session-handover.types.ts` (new)
- `libs/shared/src/lib/types/session-budget.types.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/shared/src/index.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts` (new)
- `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts` (new)
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.spec.ts`
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.spec.ts` (new)

Implement and DI-register the coordinator; atomically auto-arm at terminal limit/request before `markTurnEnded`; transfer all queue entries; enforce pump admission before `markActive`/push; guard interrupts; wait for and consume the compact boundary; and add the successor-host port/resource-lease contract. Route `SessionControlService`'s successful-interrupt release through the same terminal gate with the latest observed budget before it marks the turn ended, and refuse source interrupts from `waiting-for-turn-end` onward. Tests cover normal-result and successful-interrupt auto-arm before pump wake, every origin envelope, FIFO/cancel restore, steer/require-idle holds, interrupt refusal, boundary-derived seed, bounded agent handoff, writer/start failure, and stale close token.

### B. RPC mount and host adapter — backend

Files:

- `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.ts` (new)
- `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts` (new)
- `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.schema.ts` (new)
- `libs/backend/rpc-handlers/src/lib/handlers/index.ts`
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
- `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.spec.ts` (new)
- `libs/backend/rpc-handlers/src/lib/chat/di.ts`

Mount and export the handover handler through the host-profile manifest, assert both new methods in the allowlist, and implement the A port. The adapter creates/binds/focuses exactly one successor tab before confirmation and exposes a no-partial-close failure. In `continueSession`, after the existing `/compact`/`/clear` exemption, inspect coordinator state before `ptahCli.handleContinue` and before `refuseIfBudgetReached`; an existing operation or armed blocking limit is admitted/held on the transfer FIFO and returns `SESSION_HANDOVER_HELD`. This deliberately covers Ptah CLI prompts by preventing the CLI branch from consuming or starting a source turn during handover; with no operation, its existing branch and then ordinary budget refusal remain unchanged. For a composer stop-intent, inspect coordinator state before calling `sdkAdapter.interruptCurrentTurn`; an in-progress handover holds the prompt and returns `SESSION_HANDOVER_HELD`, while the adapter's `Promise<boolean>` contract remains unchanged outside handover. Test handler registration, validation, duplicate begin, unavailable host, confirmation-after-bind/focus, no premature close, blocked composer flush acknowledgement, Ptah CLI prompt hold, no-operation budget refusal, and stop-intent hold without interrupt/retry error.

### C. State consumer, composer flush, and focused banner — frontend

Files:

- `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts`
- `libs/frontend/chat/src/lib/services/session-budget-actions.service.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts`

Consume the revisioned handover state from the session stats/RPC client boundary, make the terminal/broadcast flush use `chat:continue`, preserve `queuedContent` until a `held` acceptance, dedupe by tab content revision, and support source-slot replacement/focus. Replace direct write/open/send with begin/cancel RPC, render once for the focused idle owner, and preserve/restore composer state. Test no banner while generating, one banner across mounted layouts, MCP-armed composer flush, held acknowledgement before clear, cancellation/failure restoration, focus replacement, and repeated-click dedupe.

### D. MCP successor mode and child lifetime — backend

Files:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.spec.ts`

Implement successor dispatch with optional handoff, unchanged real-child rejection, inherited-parent sibling creation, resource-lease transfer, and source close that cannot rollback/release the shared child worktree or MCP root. Test top-level and child successor parent fields, forbidden fields, agent handoff forwarding, no child depth bypass, retained MCP root, no inherited-owner release, and close only after B confirms binding/focus.

## Verification

Planning only; do not run until implementation.

    npx nx test @ptah-extension/shared --parallel=1
    npx nx typecheck @ptah-extension/shared

    npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts --coverage=false --maxWorkers=2
    npx nx typecheck @ptah-extension/agent-sdk

    npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.spec.ts --coverage=false --maxWorkers=2
    npx nx typecheck @ptah-extension/rpc-handlers

    npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/session-budget-actions.service.spec.ts libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts libs/frontend/chat/src/lib/services/message-sender.service.spec.ts --coverage=false --maxWorkers=2
    npx nx typecheck @ptah-extension/chat

    npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts --coverage=false --maxWorkers=2
    npx nx typecheck @ptah-extension/chat-streaming

    npx jest -c libs/frontend/chat-state/jest.config.ts libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts --coverage=false --maxWorkers=2
    npx nx typecheck @ptah-extension/chat-state

    npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.spec.ts --coverage=false --maxWorkers=2
    npx nx typecheck @ptah-extension/vscode-lm-tools

    npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.spec.ts libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.spec.ts --coverage=false --maxWorkers=2
    npx nx typecheck @ptah-extension/cli-agent-runtime

## Risks

| Risk | Mitigation / seam |
| --- | --- |
| Terminal/result or successful-interrupt race starts or duplicates work. | Route both release paths through `onTurnTerminal` and atomically arm before `markTurnEnded`; interleaving tests assert exactly-once FIFO transfer. |
| Hold response is mistaken for a failed send. | Shared `SESSION_HANDOVER_HELD` response has `held: true`; sender preserves UI text until acknowledgement and does not retry. |
| A chat/RPC pre-pump branch rejects or consumes held composer text. | Test coordinator admission ahead of Ptah CLI and budget refusal, plus stop-intent hold before adapter interruption. |
| Compaction/write/start failure loses context. | Do not close source; retain/restore FIFO and composer state; one failure state, no auto-retry. |
| New boundary never becomes durable. | Bounded wait fails operation without close; existing source and held inputs are restored. |
| Child successor loses MCP access. | Transfer resource lease before confirmation; source close explicitly suppresses `releaseMcpRoot`, rollback, and inherited-owner release. |
| User loses active tab at source close. | Bind and focus successor before token-safe close; test focus order. |
| Multiple mounted views act on same state. | Session/revision display ownership permits one banner and one pending target. |

## Decisions

| Decision | Options | Evidence / choice | Reversible |
| --- | --- | --- |
| Auto-arm at terminal limit | wait for banner; arm before pump release | Both result and successful-interrupt `markTurnEnded` paths wake work and non-chat sources bypass `canSend`; arm before either release. | Yes |
| Pump as universal admission point | per-caller checks; pump gate | All queue-mode sources call `sendMessageToSession`; check before `markActive` and `push`. | Yes |
| Interrupt policy during handover | allow steer interrupt; reject interrupt/hold text | Interrupt bypasses pump; refuse it from `waiting-for-turn-end` onward and transfer the validated steer text. | Yes |
| `chat:continue` handover ordering | let Ptah CLI/budget refusal run; coordinator admission first | Composer flush and CLI-originated prompts must reach the FIFO before a pre-pump rejection/diversion; preserve `/compact` and `/clear`. | Yes |
| Composer transfer | Begin payload only; state-broadcast terminal flush | MCP can arm without a webview Begin payload; accepted `chat:continue` supplies backend FIFO; an active handover holds stop-intent without changing the adapter boolean contract. | Yes |
| Compacted handoff source | old transcript tail; durable new boundary | Builder currently skips boundary and reads once; wait and parse boundary summary. | Yes |
| Successor topology | child-of-child; inherited-parent sibling | Preserve depth rule for concurrent children while avoiding a link to a closing source. | Yes |
| Close after focus/bind | close after backend registration only; after UI bind/focus | Registration alone can strand the user on a closing tab; require both confirmation parts. | No, safety contract |

## Preserve list

| Capability today | Destination in this design |
| --- | --- |
| Budget settings/defaults, stage rules, and `blockAtLimit` | Unchanged; terminal evaluation now auto-arms the coordinator at a blocking limit. |
| In-memory budget state/release | Retained; revisioned coordinator companion state is published with it. |
| Preview handoff | Remains read-only and never arms an operation. |
| Write handoff | Retained through coordinator-owned durable compact/builder/write sequence. |
| Deterministic seed and `SESSION_HANDOFF_LIMITS` | Retained; builder uses new compact boundary and prepends bounded agent `handoff`. |
| Open/adopt handoff tab | Retained as one reserved successor target, bound/focused before source close. |
| Banner actions: dismiss, extend, restore, rotation, preview, keep working | Retained; Continue confirms; cancel pairs with existing permit-to-continue action and releases FIFO. |
| `refuseIfBudgetReached` | Retained for ordinary sends; handover admission is the earlier common gate. |
| Ptah CLI `chat:continue` branch | Retained when no handover operation exists; during a handover the earlier coordinator admission holds its prompt instead of allowing a source turn. |
| `/compact` and `/clear` exemption | Retained; coordinator owns its compact while source inputs remain held. |
| `interruptCurrentTurn(): Promise<boolean>` adapter contract | Retained; `ChatSessionService` checks coordinator state before calling it and holds active-handover stop-intent locally. |
| `require-idle` behavior outside handover | Retained; during handover valid payload is held with explicit `SESSION_HANDOVER_HELD`. |
| Real nested-child depth limit | Retained for `mode: 'child'`; successor is a replacement, not a nested child. |
| Child worktree persistence | Retained and strengthened: successor adopts the existing worktree/MCP root rather than provisioning/removing one. |

## Proposed Removals

- Remove the documented crossing-turn plus one-held-follow-up allowance in `session-budget.service.ts:30-34`; a terminal auto-arm transfers work instead.
- Remove `continueInNewSession`'s direct write-handoff/open-tab/send-seed sequence. Its preview, write, target-tab, and seed capabilities move to the coordinator/confirmed host flow.

## Revision 1

1. Added terminal auto-arm before `markTurnEnded`, universal pre-`markActive`/pre-push pump admission, and cancel/keep-working FIFO release.
2. Added interrupt refusal, held steer/require-idle/surface payload policy with explicit response codes, and terminal/broadcast composer flush semantics.
3. Added optional bounded agent `handoff`, durable new `compact_boundary` wait, boundary-summary extraction, and pre-boundary exclusion.
4. Ordered batches A -> B then C/D; moved the child host port to A; added DI registration, manifest, handler export, allowlist, builder/history, correct `cli-agents` paths, and frontend state-consumer files.
5. Specified child worktree/MCP-root/inherited-parent lease transfer and successor tab bind/focus before token-safe source close.

## Revision 2

1. **Interrupt release path:** Added `SessionControlService` and its spec to backend batch A; its successful-interrupt `markTurnEnded` release now goes through `onTurnTerminal`/`armAtTerminal` with the latest observed budget, and source interrupts are refused from `waiting-for-turn-end` through close.
2. **`chat:continue` ordering:** Added `ChatSessionService` and its spec to the file-disjoint backend batch B. After `/compact`/`/clear` exemptions, coordinator admission precedes both the Ptah CLI branch and `refuseIfBudgetReached`, so an operation or armed blocking limit holds the prompt on the transfer FIFO as `SESSION_HANDOVER_HELD`.
3. **Composer stop-intent:** Batch B checks coordinator state before the adapter interrupt call; active-handover stop-intent is held on the FIFO with `SESSION_HANDOVER_HELD`, never retried as an interrupt error, while the adapter's `Promise<boolean>` contract is unchanged.
4. **Plan coverage:** Updated contracts, batch scopes, verification commands, risks, decisions, and the preserve list for the new interrupt and `ChatSessionService` paths without changing the resolved agent-handoff, batch-registration, or child-lifetime design.
