# Lane control model implementation plan

## Goals / non-goals

### Goals

1. Define one serializable capability manifest for every `CliAdapter` and the Ptah CLI provider path.
2. Expose potential capabilities before spawn and effective capabilities after session setup.
3. Route renderer and MCP messages through one backend coordinator and `AgentMessageRouter`.
4. Make Send predictable. Make Send now prefer steer and disclose every lossy interrupt-plus-resume fallback.
5. Replace premature `delivered` states with durable delivery receipts and renderer push updates.
6. Retain completion and report envelopes until parent delivery succeeds or the envelope expires.
7. Add per-spawn `permission` and `network` policy with fail-closed adapter validation.
8. Report `no-reliable-source` for Copilot, Cursor, and Pi limit status.
9. Align operator, parent, and child documentation with the implemented behavior.

### Non-goals

- MCP authentication and item 11. That work requires a separate PR.
- New limit readers based on guesses, CLI text scraping, or URL filtering.
- Network denial through disabled web search. That control does not deny process network access.
- New adapter implementations or unverified Cursor, Grok ACP, OpenCode, and Pi permission mappings.
- Visual design. The design lane owns layout, tokens, and prototypes.
- Changes to routing, learning, provider selection, or account admission.
- Workspace-wide refactors of `protocol-dispatcher.ts` or `agent-process-manager.service.ts`.
- A second legacy messaging stack. Existing entry points become thin compatibility delegates.

## Current state

### Messaging and capabilities

- `CliAdapter.capabilities()` declares only steer, interrupt, and continuation in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:225-283`.
- `SdkHandle` exposes live continuation, steer, and interrupt probes in the same file at `:156-215`.
- `AgentMessageRouter` rejects explicit steer unless `tracked.info.cli === 'codex'` in `agent-message-router.service.ts:151-165`. Pi's live `steer()` therefore remains unreachable.
- Default Send can interrupt before continuation in `agent-message-router.service.ts:167-277`. A continuation failure after a successful interrupt can return `unsupported`, although partial work is already lost.
- Queued messages become `delivered` immediately after `continueConversation()` resolves in `agent-message-router.service.ts:319-361`. The associated turn has not settled.
- Receipts are memory-only and bounded. An evicted ID becomes `unknown` in `agent-message-router.service.ts:378-393`.
- Detection uses adapter declarations in `cli-detection.service.ts:243`. The router uses live handle probes in `agent-message-router.service.ts:403-425`.
- Ptah CLI provider rows hard-code `messagingMode: 'queue'` in `agent-namespace.builder.ts:559-560`.
- `AgentProcessManager.sendToAgent()` guards the record and delegates to the router in `agent-process-manager.service.ts:2221-2258`.
- Turn settlement reaches `handleExit()`, which calls `flushPending()` in `agent-process-manager.service.ts:3001`.

### Renderer and RPC

- `agent:continue` calls `continueConversation()` directly in `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1545-1600`. It bypasses `AgentMessageRouter`.
- `agent:resumeCliSession` owns resume orchestration in `agent-rpc.handlers.ts:1603` onward.
- The renderer calls these RPC methods in `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:2780-2826`.
- `AgentFollowUpQueueService` owns a second queue and resume fallback in `libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.ts:87-197,212-280`.
- That service preserves failed text in `undelivered`. This behavior must remain.
- `agent:stop`, `agent:permissionResponse`, `agent:continue`, and `agent:resumeCliSession` are declared in `libs/shared/src/lib/types/rpc.types.ts:1732-1798`.
- The `agent:` prefix is already allowed by `libs/backend/vscode-core/src/messaging/rpc-handler.ts`. No new prefix is needed.

### Parent delivery

- `LaneCompletionNotifier.signal()` remembers its dedupe key before parent activity and delivery checks in `lane-completion-notifier.service.ts:340-445`.
- Inactive parents and send failures return `delivered: false` at `:406-430`. A later attempt can be suppressed as `already-signalled`.
- `AgentReportRouter.deliver()` returns `parent-session-not-active` or `delivery-failed` without a pending retry in `agent-report-router.service.ts:266-380`.
- `SessionActivityRegistry.register()` supplies the parent activity hook in `libs/backend/agent-sdk/src/lib/helpers/session-activity-registry.ts:26-56`.
- `SdkAgentAdapter.notifyActivity()` publishes activity at `sdk-agent-adapter.ts:2148-2168`. New and resumed sessions also publish session-ID resolution at `:1550-1554` and `:1725-1731`.
- `SdkAgentAdapter.sendMessageToSession()` already forwards `clientMessageId` in `sdk-agent-adapter.ts:1835-1857`.
- `IStateStorage` supplies host-neutral `get`, `update`, and `keys` operations in `libs/backend/platform-core/src/interfaces/state-storage.interface.ts`.

### Spawn policy and limits

- `SpawnAgentRequest` has no `permission` or `network` field in `libs/shared/src/lib/types/agent-process.types.ts:261-345`.
- `AgentSpawnArgsSchema` is strict and has neither field in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts`.
- `resolveAutoApprove()` owns current default behavior in `agent-spawn-environment.service.ts:149-157`.
- The verified native mappings and unsupported combinations are recorded in `.ptah/specs/TASK_2026_LANE_CONTROL/verification-tier1.md`.
- Copilot, Cursor, and Pi have no verified reliable plan-limit source. Their rows must not infer a limit state.

## Contracts

### 1. Shared manifest and policy types

Place these types in `libs/shared/src/lib/types/agent-process.types.ts`. Keep them free of VS Code, Electron, SDK, and Node imports.

```ts
export type LanePermissionMode = 'plan' | 'ask' | 'auto-edit' | 'yolo';
export type LaneNetworkMode = 'allow' | 'deny';
export type LaneSupportState = 'supported' | 'unsupported';

export interface LaneCapabilitySupport {
  readonly state: LaneSupportState;
  /** Required for unsupported. Never infer support from this text. */
  readonly reason?: string;
}

export interface LanePermissionCapability extends LaneCapabilitySupport {
  /** Diagnostic native name, for example "workspace-write". */
  readonly nativeMode?: string;
  /** Network modes valid with this permission mode. */
  readonly networkModes: readonly LaneNetworkMode[];
}

export interface LaneLimitReaderCapability {
  readonly state: 'available' | 'no-reliable-source';
  /** Present only for an implemented reader. */
  readonly source?: string;
  readonly reason?: string;
}

export interface CliAdapterManifest {
  readonly messaging: {
    readonly steer: LaneCapabilitySupport;
    readonly interrupt: LaneCapabilitySupport;
    readonly continuation: LaneCapabilitySupport;
    readonly resume: LaneCapabilitySupport;
  };
  readonly roleChannel: AgentRoleChannel;
  readonly permissionModes: Readonly<
    Partial<Record<LanePermissionMode, LanePermissionCapability>>
  >;
  readonly networkModes: Readonly<
    Record<LaneNetworkMode, LaneCapabilitySupport>
  >;
  readonly limitReader: LaneLimitReaderCapability;
  readonly mcp: LaneCapabilitySupport;
}

export interface EffectiveLaneCapabilities {
  readonly agentId: AgentId;
  readonly resolvedAt: number;
  readonly source: 'live-handle' | 'restored-record';
  readonly messaging: CliAdapterManifest['messaging'];
  readonly mcp: LaneCapabilitySupport;
}

export interface EffectiveLanePolicy {
  /** Omitted means the adapter's pre-existing default. */
  readonly permission?: LanePermissionMode;
  readonly network?: LaneNetworkMode;
  readonly nativeDescription?: string;
}
```

Extend `CliAdapter.capabilities()` to return `CliAdapterManifest`. Do not add a parallel manifest method. The existing method remains the single adapter declaration point. Derive the old three-boolean `AgentMessagingCapabilities` view only for compatibility consumers such as `bestMessagingCapability()`.

Add these fields without removing existing DTO fields:

```ts
export interface CliDetectionResult {
  // Existing fields remain.
  readonly manifest?: CliAdapterManifest;
}

export interface AgentProcessInfo {
  // Existing fields remain.
  readonly potentialCapabilities?: CliAdapterManifest;
  readonly effectiveCapabilities?: EffectiveLaneCapabilities;
  readonly effectivePolicy?: EffectiveLanePolicy;
}

export interface SpawnAgentRequest {
  // Existing fields remain.
  readonly permission?: LanePermissionMode;
  readonly network?: LaneNetworkMode;
}
```

`CliCommandOptions` receives the same optional fields. Each adapter validates and translates them before it creates a process or SDK run. Omitted fields do not enter translation and preserve current defaults, including `resolveAutoApprove()` and OpenCode's current `--auto` behavior.

The initial manifest matrix is:

| Path | Explicit permission modes | `network: 'deny'` | Limit reader |
| --- | --- | --- | --- |
| Codex | `plan` = read-only; `auto-edit` = workspace-write; `yolo` = danger-full-access; `ask` unsupported | Supported with `plan` and `auto-edit`; refuse with `yolo` | Keep the verified existing source or `no-reliable-source` |
| Claude SDK | `plan`, `ask`, `auto-edit`, `yolo` through existing SDK permission handling | Unsupported | Keep the verified existing source or `no-reliable-source` |
| Ptah CLI providers | Same SDK modes as Claude | Unsupported | Use `PtahCliLanePlanLimits` only where implemented |
| Copilot | `plan`, narrowly scoped `auto-edit`, `yolo`; `ask` unsupported until approvals reach a Ptah session | Unsupported | `no-reliable-source` |
| Antigravity | `plan`, `auto-edit`, `yolo`; `ask` unsupported | Unsupported | Keep only a verified existing source |
| OpenCode | `plan` through the native Plan agent; other explicit modes unsupported | Unsupported | Keep only a verified existing source |
| Cursor | All explicit modes unsupported until SDK 1.0.31 bindings are verified | Unsupported | `no-reliable-source` |
| Grok ACP | All unverified explicit modes unsupported | Unsupported | Keep only a verified existing source |
| Pi | All explicit modes unsupported until native RPC scope is verified | Unsupported | `no-reliable-source` |

Use this structured refusal before any process creation:

```ts
export interface LaneSpawnPolicyRefusal {
  readonly code: 'UNSUPPORTED_LANE_POLICY';
  readonly field: 'permission' | 'network' | 'combination';
  readonly cli: CliType | 'ptah-cli';
  readonly requested: EffectiveLanePolicy;
  readonly reason: string;
}
```

Throw a `LaneSpawnPolicyError` carrying this object. MCP formats it as a tool refusal. RPC spawn responses retain their existing transport shape and include the structured refusal in their error payload.

### 2. Preview and send arguments

Use one pure planner for preview and execution. Execution must run the planner again because live state can change after preview.

```ts
export type AgentMessageDelivery = 'queue' | 'now';
export type AgentMessagePreviewMode =
  | 'steer'
  | 'queue-next-turn'
  | 'interrupt-resume'
  | 'start-turn'
  | 'unsupported';

export interface AgentMessageRequest {
  readonly agentId: AgentId;
  readonly message: string;
  readonly delivery?: AgentMessageDelivery; // Default: queue.
  /** Required only when the selected plan is interrupt-resume. */
  readonly allowPartialTurnLoss?: boolean;
}

export interface AgentMessagePreviewRequest {
  readonly agentId: AgentId;
  readonly delivery?: AgentMessageDelivery;
}

export interface AgentMessagePreview {
  readonly agentId: AgentId;
  readonly delivery: AgentMessageDelivery;
  readonly mode: AgentMessagePreviewMode;
  readonly supported: boolean;
  readonly reason?: string;
  readonly usesResume: boolean;
  readonly lossDisclosure?: {
    readonly kind: 'partial-turn-work-lost';
    readonly confirmationRequired: true;
    readonly text: string;
  };
  readonly effectiveCapabilities: EffectiveLaneCapabilities;
}
```

Planning rules:

1. `queue` on a running lane selects `queue-next-turn` when continuation or resume can start a later turn.
2. `queue` on an idle live lane selects `start-turn` through continuation.
3. `queue` on a released or missing record selects `start-turn` through the shared resume service when a CLI session ID exists.
4. `now` on a running lane selects `steer` when the effective handle supports it. This enables Pi and keeps Codex steer.
5. Without steer, `now` selects `interrupt-resume` only when interrupt and continuation are both effective.
6. The interrupt-resume preview always contains `lossDisclosure`. Execution refuses it unless `allowPartialTurnLoss === true`.
7. Without an immediate capability, `now` returns `unsupported` with a reason. It does not silently queue.
8. No record, no usable session, or no continuation/resume path returns `unsupported` with a stable reason.

Keep MCP `delivery: 'steer'` as a compatibility input meaning true-steer-only. Do not let it select interrupt-resume. New callers use `queue` or `now`.

### 3. Delivery receipts

```ts
export type AgentDeliveryReceiptState =
  | 'accepted'
  | 'started'
  | 'settled'
  | 'failed'
  | 'expired'
  | 'interrupted-undelivered';

export interface AgentDeliveryReceipt {
  readonly id: string;
  readonly agentId: AgentId;
  readonly state: AgentDeliveryReceiptState;
  readonly mode: AgentMessagePreviewMode;
  readonly delivery: AgentMessageDelivery;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly turnSeq?: number;
  readonly cliSessionId?: string;
  readonly reason?: string;
  readonly partialTurnLost?: boolean;
  /** Turn outcome is separate from delivery outcome. */
  readonly turnOutcome?: 'completed' | 'failed' | 'stopped';
}

export interface AgentMessageOutcome {
  // Preserve the existing fields for MCP compatibility.
  readonly mode: AgentMessagingMode;
  readonly detail?: string;
  readonly messageId?: string;
  readonly receipt: AgentDeliveryReceipt;
}
```

Receipt invariants:

- Mint the ID before any adapter side effect.
- Persist `accepted` before queue insertion or immediate execution.
- Set `started` only after steer acceptance or after continuation/resume starts a turn.
- Bind `started` to `turnSeq`. Set `settled` only when that turn settles.
- `settled` means the message turn ended. `turnOutcome` says whether that turn completed, failed, or stopped.
- A failure before delivery sets `failed` without clearing the user's draft.
- A successful interrupt followed by failed continuation sets `interrupted-undelivered`, sets `partialTurnLost: true`, and retains `cliSessionId` for recovery.
- Store at most 8 accepted messages per agent and 64 terminal receipts per agent. Coalesce queued bodies only at turn start and link every coalesced receipt to the same `turnSeq`.
- Persist internal receipt records through `IStateStorage`. Public receipts exclude message bodies.
- Retain terminal records for seven days. A syntactically valid unknown receipt ID returns `expired`, not `unknown`.
- On host restart, restore accepted queue entries. Mark an unresumable `started` record as `failed` with `host-restarted`; never invent `settled`.

### 4. RPC and push events

Add these entries to `RpcMethodMap` in `libs/shared/src/lib/types/rpc.types.ts`:

```ts
'agent:previewMessage': {
  params: AgentMessagePreviewRequest;
  result: AgentMessagePreview;
};
'agent:sendMessage': {
  params: AgentMessageRequest;
  result: AgentMessageOutcome;
};
'agent:getMessageReceipt': {
  params: { agentId: AgentId; messageId: string };
  result: AgentDeliveryReceipt;
};
'agent:cancelMessage': {
  params: { agentId: AgentId; messageId: string };
  result: AgentDeliveryReceipt;
};
```

`agent:cancelMessage` preserves the current ability to withdraw a queued renderer message. It succeeds only in `accepted`. The terminal receipt uses `failed` with reason `cancelled-by-user`. Started messages cannot be cancelled through this method; Stop remains the separate control.

Add this push payload to `libs/shared/src/lib/types/messages/agent-monitor.ts`:

```ts
export interface AgentMonitorMessageReceiptPayload {
  readonly receipt: AgentDeliveryReceipt;
}
```

Register `MESSAGE_TYPES.AGENT_MONITOR_MESSAGE_RECEIPT` as `agent-monitor:message-receipt`. Add it to `payload-map.ts` and add a strict Zod schema to `messages/schemas.ts`. Validate at the backend push boundary and renderer message-handler boundary.

Keep `agent:continue` and `agent:resumeCliSession` for compatibility. Implement their bodies through the new coordinator and shared resume service. The renderer migrates to `agent:sendMessage`; external callers do not break.

### 5. Backend components

Add small components under `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/`:

- `agent-delivery-planner.ts`: pure potential/effective capability and policy decision function.
- `agent-message-coordinator.service.ts`: the only new send/preview/cancel facade for MCP and RPC.
- `agent-delivery-receipt-store.service.ts`: durable receipts, accepted queue persistence, and expiry.
- `agent-lane-resume.service.ts`: the extracted common resume spawn path.
- `agent-effective-capabilities.ts`: resolves adapter potential and live handle probes into effective capabilities.

`AgentProcessManager` only supplies record access, turn notifications, and existing process primitives. Move resume details and receipt coordination out rather than adding those responsibilities to it. `AgentMessageRouter` remains the mechanism executor. The coordinator owns planning, receipt transitions, and resume fallback.

Register new tokens in `di/tokens.ts` and implementations in `di/register.ts`. Use `CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_COORDINATOR`, `AGENT_DELIVERY_RECEIPT_STORE`, and `AGENT_LANE_RESUME`. Resolve the receipt store for push wiring in `wiring/agent-events.ts`.

### 6. Durable parent envelopes

Add `parent-delivery/` under `cli-agent-runtime/src/lib/cli-agents/`:

- `parent-envelope-store.service.ts`: serialized per-parent persistence and bounded retention.
- `parent-delivery-drainer.service.ts`: activity subscriptions, per-parent drain locks, and idempotent send.

```ts
export interface ParentDeliveryEnvelope {
  readonly id: `lane-delivery:${string}`;
  readonly parentSessionId: SessionId;
  readonly agentId: AgentId;
  readonly kind: 'report' | 'completion';
  /** completion: agentId + completedAt; report: agentId + turnSeq + body hash */
  readonly dedupeKey: string;
  readonly body: string;
  readonly createdAt: number;
  readonly state: 'pending' | 'delivered' | 'expired';
  readonly attempts: number;
  readonly lastError?: string;
}

export interface AgentReportDeliveryResult {
  readonly delivered: boolean;
  readonly recorded: boolean;
  readonly pending: boolean;
  readonly deliveryId?: string;
  readonly reason?: string;
  readonly parentSessionId?: SessionId;
}
```

Store at most 32 pending envelopes per parent and retain them for seven days. Serialize read-modify-write operations per parent because `IStateStorage` has no compare-and-swap operation. On overflow, expire the oldest report first. If no report can be evicted, refuse a new report with `pending-capacity-exceeded`. Never silently discard a new completion; expire the oldest completion and retain an expiry tombstone for status/read recovery.

Delivery rules:

1. Validate caller attribution, parent recording, rate limits, and duplicates before persistence.
2. Persist the envelope before the first send attempt.
3. Return `recorded: true, pending: true, delivered: false` when the parent is inactive. This is accepted durable work, not a refusal.
4. Pass `clientMessageId: envelope.id` and the existing origin metadata to `sendMessageToSession()`.
5. Mark delivered only after the parent session accepts the turn. Update report counts and tile notes only at this point.
6. Drain when `SessionActivityRegistry` reports parent activity and when the parent session ID resolves on new or resumed sessions.
7. Hold one asynchronous drain lock per parent. Delivery emits parent activity, so the lock must prevent recursive and concurrent drains.
8. Use no timer and no polling loop. The bounded status/read fallback remains.
9. Add a persistent, bounded `lane-delivery:` client-ID ledger at `SessionStreamPump.sendMessage()`. A retry with an accepted ID becomes a no-op. Scope this dedupe to the `lane-delivery:` prefix so ordinary human client IDs retain current behavior.
10. If the host stops between parent acceptance and envelope commit, the parent ledger suppresses the retry duplicate.

Completion computation and delivery become separate states. `completedAt` and the outcome recorder remain one-shot. The envelope store, not `signalledKeys`, determines whether delivery is complete. Extend `LaneCompletionDelivery` with `recorded`, `pending`, and `deliveryId` while retaining `delivered` and existing refusal reasons.

## Data flow

### List and spawn

1. `CliDetectionService` reads each adapter manifest and returns it on `CliDetectionResult`.
2. `PtahCliRegistry` supplies the same manifest shape for provider-backed SDK lanes. `agent-namespace.builder.ts` uses it instead of hard-coded queue mode.
3. `ptah_agent_list` derives legacy `messagingMode` from the manifest and exposes the full potential manifest. Limit status uses only `limitReader`.
4. Spawn validates `permission` and `network` against the selected manifest. Unsupported requests fail before `runSdk()` creates a process.
5. The adapter translates supported fields to native SDK options or arguments. Omitted fields follow existing defaults.
6. After handle creation and session setup, the effective resolver combines the adapter manifest with live handle probes and actual role/MCP channels.
7. The process record stores potential capabilities, effective capabilities, and effective policy. Spawned/list events carry them to the lane card.

### Preview and Send

1. A renderer composer calls `agent:previewMessage` on focus, delivery-mode change, and relevant agent state change. It does not poll.
2. The RPC handler validates input and calls `AgentMessageCoordinator.preview()`.
3. The coordinator obtains the current record and effective capabilities, then calls the pure planner.
4. The composer shows the returned mode and any loss disclosure before execution.
5. Send calls `agent:sendMessage`. MCP calls the same coordinator through `PtahAPI.agent.message`.
6. The coordinator validates, replans, mints and persists a receipt, then invokes `AgentMessageRouter` or the shared resume service.
7. A running default Send stays queued. An idle default Send starts the next turn. Send now uses steer when available.
8. An interrupt-resume plan without explicit loss confirmation returns `failed` before interrupt. No partial work is lost in that refusal.
9. The router reports mechanism start to the receipt store. The process manager's turn-settlement notification completes the receipt.
10. Every committed receipt change broadcasts `agent-monitor:message-receipt` through shared host wiring.
11. `AgentMonitorStore` merges the receipt into a bounded signal map. Components render the receipt without another RPC call.

### Resume fallback

1. The planner returns `start-turn` with `usesResume: true` for a released or expired record with a CLI session ID.
2. `AgentLaneResumeService` executes the same resume gate and spawn path as explicit Resume.
3. The coordinator binds the original receipt to the resumed `agentId` and new `turnSeq`. The public receipt retains the original ID and records the replacement agent ID in its detail metadata if needed.
4. `agent:resumeCliSession` calls the same service for the explicit Resume control.
5. Renderer code no longer performs a separate resume send after a failed `agent:continue`.

### Completion and report

1. Completion computes its verdict and records the outcome once.
2. Report and completion paths create durable envelopes with stable dedupe keys.
3. An active parent accepts delivery immediately. An inactive parent leaves the envelope pending.
4. Parent activity or session-ID resolution triggers one drain per parent.
5. Parent-side `lane-delivery:` dedupe makes retries idempotent.
6. Delivered envelopes update counts and notes. Pending envelopes remain available to bounded status/read recovery.

## Failure behaviour

| Condition | Required behavior |
| --- | --- |
| Explicit steer requested without effective steer | Return `unsupported` before side effects. Never branch on `cli === 'codex'`. |
| Send now requires interrupt-resume but confirmation is absent | Refuse before interrupt and show the loss disclosure. |
| Interrupt succeeds and continuation fails | Return `interrupted-undelivered`; preserve session ID and state that partial turn work is lost. |
| Queue capacity exceeds 8 per agent | Refuse the new message with `failed` and retain the renderer draft. Do not evict an accepted message silently. |
| Agent stops with accepted messages | Mark them `failed` with `agent_stopped`; retain existing dropped-message counts. |
| Started turn stops | Mark `settled` with `turnOutcome: 'stopped'`. Do not equate settlement with successful work. |
| Process or host restarts | Restore accepted messages; fail unresumable started receipts with `host-restarted`. |
| Receipt retention expires | Return explicit `expired`. Never return a misleading `unknown`. |
| Parent inactive | Persist report/completion and return `pending: true`. Drain on later activity. |
| Parent send throws | Keep the envelope pending, increment attempts, retain a sanitized error, and wait for the next activity trigger. |
| Parent accepts then host stops before commit | Suppress the retry through the stable `lane-delivery:` client ID. |
| Pending parent queue overflows | Apply the documented eviction/refusal rule and emit an injected logger warning. |
| Permission or network mode unsupported | Return `UNSUPPORTED_LANE_POLICY` before process creation. |
| `yolo` plus `deny` on Codex | Refuse the combination before process creation. |
| Network denial requested on an adapter without native enforcement | Refuse. Do not substitute disabled web search or URL filters. |
| Copilot, Cursor, or Pi limit query | Return `no-reliable-source`. Do not infer `AT LIMIT`, available quota, or reset time. |
| Live handle differs from adapter potential | Use effective capabilities for control planning and show the difference in diagnostics. |
| Preview becomes stale | Replan at execution and return the actual receipt mode. Never execute the stale plan blindly. |

All external errors use sanitized messages. Do not log message bodies, credentials, auth environment values, or MCP URLs with embedded secrets.

## UX contract

The design lane owns visual treatment. Implementation must supply these functional states in Electron first:

### Before spawn

- `ptah_agent_list` and lane pickers show potential steer, interrupt, continuation, resume, role channel, permission, network, MCP, and limit-reader support.
- Label these values as adapter potential, not live guarantees.
- Show “No reliable limit source” for Copilot, Cursor, and Pi. Do not show a false available or exhausted state.
- Disable unsupported explicit policy choices or show the manifest reason before spawn.

### Lane card

- Show effective capabilities after setup. Show potential-only values with a pending label until setup completes.
- Show effective `permission` and `network`, including “adapter default” when omitted.
- Keep Stop, Resume, permission response, output, status, and existing account controls in their current workflows.
- Use the same composer contract on the background strip, subagent lane, agent card, and session inspector.

### Composer

- Send previews `queue-next-turn` or `start-turn` before execution.
- Send now previews `steer`, `interrupt-resume`, or `unsupported` with a reason.
- For interrupt-resume, require a separate confirmation that names partial turn loss. Do not use a generic confirmation.
- Disable only unsupported actions. Do not disable Pi steer because of a vendor check.
- Show accepted, started, settled, failed, expired, and interrupted-undelivered receipt labels from push updates.
- Keep failed or cancelled text available as a draft. Do not clear the composer until the backend returns `accepted` or `started`.
- Allow an accepted queued message to return to the draft through `agent:cancelMessage`.
- Do not add timers, per-card polling, or infinite receipt animations.

### Recovery

- `interrupted-undelivered` offers Resume with the preserved CLI session ID and keeps the text available.
- Cold resume displays `start-turn` and identifies that it resumes the saved conversation.
- Receipt expiry does not remove agent output or the existing status/read recovery path.

## Preserve list

- `agent:stop` and every Stop button retain current teardown and timeout behavior.
- Explicit `agent:resumeCliSession`, the resume gate, handoff threshold, account checks, and card replacement remain available.
- `agent:continue` remains a compatibility delegate for existing callers.
- Existing `agent-steer-input.component.ts` remains the shared presentational input.
- Codex Send now continues to use true app-server steer.
- Legacy MCP `delivery: 'steer'` remains true-steer-only.
- Pi RPC steer becomes reachable without changing its adapter protocol.
- Default queue size, stop dropping, turn sequencing, and CLI session binding remain enforced in the backend.
- Renderer draft recovery, queued-message editing, coalescing, and cold-resume recovery remain available.
- `agent:permissionResponse`, Copilot permission routing, auto-resolution, and unroutable-deny behavior remain unchanged.
- Background strip, subagent composer, lane grid, agent card, and inspector retain all current actions.
- Spawn role delivery, policy channel, `PTAH_LANE_POLICY`, deliverables, task folder, account selection, effort, and model-tier behavior remain unchanged.
- Omitted permission/network fields preserve current adapter defaults and native arguments.
- Completion verdict computation, deliverable checks, outcome recording, and stop reasons remain unchanged.
- Report attribution remains transport-derived. No caller-supplied agent ID is accepted.
- Bounded status/read recovery remains documented and functional for stdio and inactive-parent cases.
- Electron, VS Code, and headless CLI continue to use host-neutral backend libraries. `cli-engine` and `platform-cli` keep their existing entry points.
- No current control is renamed or removed only because its implementation moves behind a facade.

## Batches

Run batches in order. Each file appears in one batch only. Each implementation batch uses the listed executor and adds or updates the listed tests. Use `npm run verify -- -p <projects>` for each batch. Do not run workspace-wide checks.

### Batch 1 — shared contracts

**Executor:** backend-developer  
**Nx projects:** `shared`

Files:

- `libs/shared/src/lib/types/agent-process.types.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/shared/src/lib/types/messages/message-constants.ts`
- `libs/shared/src/lib/types/messages/agent-monitor.ts`
- `libs/shared/src/lib/types/messages/payload-map.ts`
- `libs/shared/src/lib/types/messages/schemas.ts`
- `libs/shared/src/lib/types/messages/index.ts`
- `libs/shared/src/lib/types/messages/agent-monitor.spec.ts` (new)

Tests:

- Manifest and receipt compile-time contract cases.
- Push payload schema accepts every receipt terminal state and rejects unknown fields.
- RPC map covers preview, send, receipt read, and cancel.
- Existing RPC and message contracts remain assignable.

### Batch 2 — adapter manifests and policy translation

**Executor:** backend-developer  
**Nx projects:** `cli-agent-runtime`

Files:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/grok-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts`
- Existing adapter specs beside those files, including `codex/codex-app-server-lane.adapter.spec.ts`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts` (new pure validation helpers)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.spec.ts` (new)

Tests:

- Every adapter returns a complete manifest with an explicit unsupported reason.
- Policy translation produces verified native options and fails before spawner invocation.
- Codex `yolo + deny` fails. Claude-family network denial fails. URL filters never count as denial.
- Omitted fields produce byte-identical existing command/options fixtures.
- Copilot, Cursor, and Pi return `no-reliable-source`.
- Detection and Ptah CLI provider rows expose the same manifest shape.

### Batch 3 — unified delivery and receipts

**Executor:** backend-developer  
**Nx projects:** `cli-agent-runtime`

Files:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- Relevant existing `agent-process-manager.service.*.spec.ts` files only for moved wiring assertions.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-delivery-planner.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-delivery-planner.spec.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-message-coordinator.service.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-message-coordinator.service.spec.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-delivery-receipt-store.service.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-delivery-receipt-store.service.spec.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-effective-capabilities.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-effective-capabilities.spec.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-lane-resume.service.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-lane-resume.service.spec.ts` (new)

Tests:

- The planner covers every Send/Send now branch without a CLI-name condition.
- Codex and Pi steer use the live handle. Unsupported steer has no side effects.
- Interrupt-resume requires confirmation and returns `interrupted-undelivered` after continuation failure.
- Queue receipts transition accepted → started → settled only after the bound `turnSeq` settles.
- Cold resume uses the shared resume service and preserves the original receipt ID.
- Receipt persistence restores accepted work, expires old records, and survives restart tests.
- Stop, cancellation, coalescing, queue bounds, and turn outcomes retain existing behavior.
- `AgentProcessManager` loses resume/receipt responsibility rather than gaining new policy code.

### Batch 4 — durable parent delivery

**Executor:** backend-developer  
**Nx projects:** `cli-agent-runtime`, `agent-sdk`

Files:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/parent-delivery/parent-envelope-store.service.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/parent-delivery/parent-envelope-store.service.spec.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/parent-delivery/parent-delivery-drainer.service.ts` (new)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/parent-delivery/parent-delivery-drainer.service.spec.ts` (new)
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts`

Tests:

- Inactive-parent completion is recorded once and delivered after later activity.
- Failed sends remain pending and duplicate calls return the existing envelope.
- Report count and tile notes change only after actual parent acceptance.
- Activity caused by delivery does not recurse. Concurrent notifications use one parent drain.
- Restart between parent acceptance and commit does not duplicate a parent turn.
- Per-parent bounds, expiry, overflow, and missing-attribution refusal are explicit.
- Ordinary non-`lane-delivery:` client IDs retain current behavior.

### Batch 5 — RPC, MCP, DI, and push wiring

**Executor:** backend-developer  
**Nx projects:** `rpc-handlers`, `vscode-lm-tools`, `cli-agent-runtime`, `vscode-core`

Files:

- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-message-rpc.handlers.ts` (new)
- `libs/backend/rpc-handlers/src/lib/handlers/agent-message-rpc.handlers.spec.ts` (new)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- Relevant existing protocol dispatcher agent tool specs.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts`
- Relevant existing stdio dispatcher agent tool specs.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`
- `libs/backend/cli-agent-runtime/src/lib/di/register.ts`
- `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.spec.ts`
- `libs/backend/vscode-core/src/messaging/rpc-handler.spec.ts`

Tests:

- Renderer RPC and both MCP dispatch paths call the same coordinator.
- `delivery: 'now'`, loss confirmation, and legacy `steer` validate identically across transports.
- Spawn policy reaches both ordinary CLI and Ptah CLI requests; strict schemas reject unknown values.
- Response formatting distinguishes accepted, pending, settled, failed, expired, and interrupted-undelivered.
- DI resolves each new singleton with host-neutral dependencies and no duplicate registration.
- Push wiring emits only after durable receipt commit.
- RPC guard tests retain the existing `agent:` prefix and validate all new methods.

### Batch 6 — renderer store and outbox migration

**Executor:** frontend-developer  
**Nx projects:** `chat-streaming`, `chat`

Files:

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`
- `libs/frontend/chat-streaming/src/lib/agent-monitor.retention.spec.ts`
- `libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.ts`
- `libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.spec.ts`

Tests:

- Store preview/send/cancel methods call the new RPC contracts through `ClaudeRpcService`.
- `agent-monitor:message-receipt` merges immutable receipt signals and remains bounded.
- The follow-up service delegates delivery to the backend and removes its independent idle-send/resume transport.
- Failed, cancelled, and interrupted-undelivered text returns to `undelivered`.
- Existing coalescing and edit-before-start behavior call the backend queue/cancel contract.
- Legacy `resumeAgentWithMessage()` remains only as an explicit Resume compatibility delegate until callers migrate.

### Batch 7 — lane surfaces

**Executor:** frontend-developer  
**Nx projects:** `chat-ui`, `chat`

Files:

- `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts`
- Its existing component spec.
- `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts`
- Its existing component spec.
- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane-composer.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane-composer.component.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts`
- Relevant existing agent card specs.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-actions-menu.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-panel.spec.ts`

Tests:

- Every surface previews Send and Send now through the same store methods.
- Loss confirmation appears only for interrupt-resume and names discarded partial work.
- Receipt states render from push updates without timers or polling.
- Effective policy and potential/effective capabilities render their distinct labels.
- Stop, Resume, permission response, and other existing actions retain their event flows.
- Standalone components remain OnPush and signal-driven.

Verification:

- Run the scoped project checks.
- Perform the separate design and visual reviews in Electron with dark and light themes. Source inspection and type checks do not replace screenshots.

### Batch 8 — documentation alignment

**Executor:** technical-content-writer  
**Nx projects:** none

Files and exact edits:

- `README.md:95`: replace the ACP transport claim with manifest-based capability behavior. State that list rows show potential support and live lanes resolve effective support.
- `.claude/skills/agent-lanes/SKILL.md:112-159` (§4): document durable pending completion/report delivery, activity drain, idempotent retry, and the retained bounded status/read fallback. Replace “delivered signal” queue wording with receipt states.
- `.claude/skills/agent-lanes/SKILL.md:232-257` (§7): replace “probed per run” with potential manifest versus effective handle capabilities. Add `start-turn`, `delivery: 'now'`, loss confirmation, receipt IDs, `interrupted-undelivered`, and explicit expiry. Document `permission`, `network`, and `no-reliable-source` without listing unverified vendor guarantees.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:73-86`: add the short bounded status/read recovery rule to the parent delegation pattern.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:113-122`: replace immediate-delivery wording with manifest, preview, receipt, and durable pending semantics. Keep the no-polling rule.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:465-471`: update `TWO_WAY_MESSAGING_GUIDANCE` for receipt IDs, accepted versus settled, pending report delivery, and no retry loop. Preserve the Windows argv budget and update `cli-adapter.utils.spec.ts` byte/canary assertions. Keep resume preamble behavior at `:519-629` accurate.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract.ts:56-64`: replace “reaches the parent immediately” with recorded/pending/delivered semantics and distinguish durable pending acceptance from refusal.
- Related prompt/reporting specs: update exact text assertions without weakening vendor-roster drift or command-line budget guards.

Do not add a hand-maintained capability table to the README. The manifest and `ptah_agent_list` remain the runtime source. A generated documentation table is optional follow-up work only if it is produced directly from adapter manifests and checked by a test.

## Risks

| Risk | Mitigation |
| --- | --- |
| Receipt settlement binds to the wrong turn after coalescing or resume | Bind every receipt to an explicit `turnSeq`; test two queued messages and cold resume. |
| Activity notifications recursively drain the same parent | Use a per-parent asynchronous lock and test send-triggered activity. |
| Exactly-once delivery fails across a host stop | Use stable envelope IDs and parent-side persistent `lane-delivery:` dedupe. Document that the ledger is bounded. |
| Durable storage retains sensitive message bodies | Store only necessary bodies, enforce bounds/TTL, exclude bodies from public receipts and logs, and use host-local `IStateStorage`. |
| Manifest claims exceed native adapter support | Encode only verified mappings; refuse all others before process creation. |
| Network deny gives a false security boundary | Support it only where native enforcement exists. Web-search toggles and URL filters do not qualify. |
| Legacy callers depend on default Send interrupting | Make the behavior change explicit in release notes and docs. Preserve legacy `steer`, but use predictable queue semantics for new Send. |
| Shared type changes break `cli-engine` or `platform-cli` | Keep fields additive, retain compatibility delegates, and run affected checks for those projects when dependency analysis includes them. |
| Central process manager grows again | Put planning, receipts, resume orchestration, and parent drain in separate services. Leave only record/turn primitives in the manager. |
| Renderer and backend queues diverge | Make backend receipts authoritative. Renderer state contains drafts and receipt projections only. |
| Push schema drift reaches the renderer | Validate strict shared Zod contracts and update message/RPC guard specs. |
| Prompt growth exceeds Windows argv limits | Keep child guidance short and retain measured byte-budget specs. |
| Ptah CLI provider rows diverge again | Supply manifests at `PtahCliRegistry` and derive list messaging mode from the same shape. |
| Unsupported policy defaults change existing lanes | Add byte-identical command/options regression fixtures with both fields omitted. |

## Decisions

- **Extend `capabilities()` instead of adding a second manifest API.** Options: parallel `manifest()` or widen the existing required declaration. The existing method already feeds detection and routing (`cli-adapter.interface.ts:225-283`). One method prevents drift. Reversible: yes.
- **Use serializable shared manifest types.** Options: backend-only interfaces or shared DTOs. List, RPC, and renderer all need the same data. Shared types respect host boundaries. Reversible: yes.
- **Resolve effective capabilities from live handles after setup.** Options: trust adapter declarations or trust probes alone. Defect 6 proves either source alone diverges. Store both and plan from effective state. Reversible: yes.
- **Make default Send queue while running.** Options: retain implicit interruption or use explicit delivery semantics. The current hidden loss is shown at `agent-message-router.service.ts:195-234`. Explicit Send now owns immediate delivery. Reversible: yes, with a documented behavior change.
- **Require confirmation for interrupt-resume.** Options: always interrupt, never offer it, or disclose and confirm. The operation discards partial work. Preview plus `allowPartialTurnLoss` makes consent explicit. Reversible: yes.
- **Use one pure planner for preview and execution.** Options: separate UI hints and router branches or one decision function. Separate branches would recreate mode drift. Replan at execution handles stale state. Reversible: yes.
- **Persist receipts and accepted queue entries with `IStateStorage`.** Options: memory-only or host-specific stores. Defects 5 and 7 require durable explicit states, and `IStateStorage` is host-neutral. Reversible: yes, behind a store port.
- **Use activity-driven parent drain without polling.** Options: timers, read-only fallback, or activity subscriptions. `SessionActivityRegistry` supplies the required hook and avoids runtime cost. Reversible: yes.
- **Use stable `clientMessageId` values for parent idempotency.** Options: best-effort retry or parent dedupe. The adapter already forwards this field. A prefixed persistent ledger addresses the stop-after-accept race without changing human message behavior. Reversible: yes.
- **Move resume orchestration into a shared backend service.** Options: keep renderer-only fallback or extract one path. Renderer-only behavior caused sender divergence. Explicit Resume and message fallback can share the same gate. Reversible: yes.
- **Refuse unverified native policy mappings.** Options: optimistic flags or fail closed. Verification found no reliable support for several adapters. Refusal is safer and testable. Reversible: add support after verification.
- **Do not generate a documentation table in the initial implementation.** Options: generated table or runtime manifest only. The generator adds a second documentation pipeline without a current consumer. `ptah_agent_list` already exposes the source. Reversible: yes.
- **Keep MCP authentication out of this plan.** The task explicitly reserves item 11 for a separate PR. Reversible: no action required here.

## Clarifications Needed

None. The task supplies the product decisions for Send now disclosure, durable parent delivery, fail-closed policy, and explicit limit-reader status. Implementation can proceed with the decisions above.
