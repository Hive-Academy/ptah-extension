# Batch 9b-7 fix2 report

Review: `.ptah/specs/TASK_2026_714_c8a2/review-9b-7-fix.md` (REVISE 8/10). Two findings. Coordinator edits kept: `flushUntil` uses `new Promise<void>`, and `gateway-chat-bridge/package.json` does not list `zod`.

## Finding 1 — malformed binding took the new-session branch

`readBoundSessionIdentity` returned no identity for every id that failed `SessionId.validate`, including a non-empty one. With native gateway startup that is the fresh-conversation branch, so `tryFallbackStart` could call `startNew` and overwrite the binding.

What changed:

- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:1012-1034` — absent identity only when `sessionId` is `null`, `undefined`, or `''`. A non-empty id that fails `SessionId.validate` returns `{ ok: false, error: new Error('Bound gateway session id is not a valid session id') }`. The message does not include the stored id.
- `gateway-chat-bridge.ts:515-529` — that result already stops the turn through `failTurnBeforeSession`: one generic reply, injected `logger.error` with the `Error`, no `prepareTurn`, no `resolveExecutionProfile`, no `resumeSession`, no `startChatSession`, binding not written. `openStream` (`:933`) and `tryFallbackStart` (`:1126`) are unchanged; this turn returns before them.

New spec: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.native.spec.ts:914` (`fails closed when a non-empty bound session id is not a valid session id`). Native gateway startup is on (`nativeCodexGateway: true`). A stored native lookup is installed so a mistaken resume would be visible. Asserts no `resolveExecutionProfile`, no `resumeSession`, no `startChatSession`, one `appendOutboundChunk` with the generic failure, `setPtahSessionId` not called, and `conversation.ptahSessionId` still `'not-a-session-id'`.

`gateway-chat-bridge.spec.ts` was not edited. Every `ptahSessionId` there is `SDK_UUID` or `null`. None binds a non-UUID id and expects resume or fallback.

## Finding 2 — forbidden casts in the new spec

Removed both `as unknown as` assertions from `gateway-chat-bridge.native.spec.ts` (previously the logger at the old line 91 and the constructor tuple at the old line 409). No `as any`, `as never`, `as unknown as`, or `as X` on an object literal.

What changed:

- `gateway-chat-bridge.native.spec.ts:84-152` — `ConsumedLogger` is `Pick` of `debug` / `info` / `warn` / `error` on constructor parameter 0. The object is annotated with that pick. `AssertAssignable` checks the real `Logger` still covers it.
- `gateway-chat-bridge.native.spec.ts:154-167` — workspace double is a full `IWorkspaceProvider` (`BridgeDeps[4]`). No brand step.
- `gateway-chat-bridge.native.spec.ts:169-184` — model settings implement `{ selectedModel: { get(): string } }`, checked against `ModelSettings` by `AssertAssignable`, then branded because `selectedModel` is a `ComputedSettingHandle` class.
- `gateway-chat-bridge.native.spec.ts:455-607` — agent, conversations, MCP, prompts, and the profile resolver are annotated `Pick`s of the constructor parameter at that index, so each method is contextually typed. Gateway outbound methods are the same kind of `Pick`; `on` / `off` delegate to the `EventEmitter` harness. Permission `onPromptLifecycle` is a `Pick` of parameter 9 and still writes the harness listener. The tuple is `satisfies ConstructorParameters<typeof GatewayChatBridge>`, then passed to `new GatewayChatBridge(...)`.
- `ConversationTurnTracker` is `new ConversationTurnTracker()`. `RuntimeHostCapabilities` and `SessionRuntimeIdentityLookup` are the real interfaces.

Class instance types with private fields are not assignable from object literals: `Logger`, `GatewayService`, `ConversationStore`, `ModelSettings`, `CodeExecutionMCP`, `EnhancedPromptsService`, `SdkPermissionHandler`, and `WorkspaceProviderProfileResolver`. `IAgentAdapter` is an interface, but the double implements only the five methods this bridge calls, not `IAIProvider`'s other required members. Those nine values cross that gap with `hasConsumedMethods` (`:106-122`) or `hasModelSettings` (`:169-173`): the consumed methods are checked first, then a type predicate brands the same object. There is no assertion operator.

## Decisions

### Non-empty invalid bindings fail closed

- Decision: only `null`, `undefined`, and `''` carry no identity. Any other id that fails `SessionId.validate` is `{ ok: false, error }` and uses the existing pre-session failure path. This replaces the earlier decision "Non-UUID bindings are unchanged" in `batch-9b-7-fix-report.md`. That file was left as written; this round's edit scope does not include it.
- Options: keep treating an invalid id as a fresh conversation; fail closed before profile resolution.
- Evidence: `review-9b-7-fix.md` finding 1. `ConversationStore.setPtahSessionId` stores an arbitrary string, so a non-UUID binding is representable. A fresh conversation is an absent binding. Failing before `prepareTurn` keeps `openStream` and `tryFallbackStart` from seeing `boundIdentity === undefined` for this case.
- Reversible: the `SessionId.validate` branch in `readBoundSessionIdentity`.

### Nominal constructor parameters stay branded, not asserted

- Decision: check each double against the consumed `Pick` or the full interface, then brand class-typed arguments with a method-presence predicate. The constructor call sees `ConstructorParameters<typeof GatewayChatBridge>`.
- Options: `as unknown as` (rejected by the review); implement every class's private state; change production constructor parameters to structural types (out of scope for this defect).
- Evidence: those classes declare private instance fields, so an object literal is not a `Logger` or a `GatewayService`. The predicate does not use `as`.
- Reversible: if the constructor parameters become interfaces, the predicate can go away and the `Pick` objects can be passed directly.

## Not done

- Jest, `tsc`, lint, Nx, and diagnostics were not run. The lane rules forbid them, so the spec is unexecuted.
- No commit, push, or PR.
- `gateway-chat-bridge.spec.ts` was not edited. No existing case there binds a non-UUID id and expects resume or fallback.
- `batch-9b-7-fix-report.md` was not edited. The superseded "Non-UUID bindings are unchanged" decision is recorded above.
- No matching skill for this host-bridge defect was in the session skill list. `search_tool` returned no `ptah_*` tools. The connected MCP server shown to this session is `tasks`. Reads and edits used the native file tools.
