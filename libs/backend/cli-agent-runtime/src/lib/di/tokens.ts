import { AGENT_MESSAGE_DISPATCH_JOURNAL } from '../cli-agents/messaging/agent-message-dispatch-journal.port';

export const CLI_AGENT_RUNTIME_TOKENS = {
  PARENT_DELIVERY_EVENT_SINK: Symbol.for('ParentDeliveryEventSink'),
  AGENT_MESSAGE_COORDINATOR: Symbol.for('AgentMessageCoordinator'),
  /** Durable lane message envelopes (`AgentMessageEnvelopeStore`). */
  AGENT_MESSAGE_ENVELOPE_STORE: Symbol.for('AgentMessageEnvelopeStore'),
  /** Old agent id → resumed agent id (`AgentIdAliasRegistry`). */
  AGENT_ID_ALIAS_REGISTRY: Symbol.for('AgentIdAliasRegistry'),
  /** One-timer cold inbox and retry scheduler (`AgentMessageDeliveryScheduler`). */
  AGENT_MESSAGE_SCHEDULER: Symbol.for('AgentMessageDeliveryScheduler'),
  /** Semantic acknowledgment of delivered messages (`AgentMessageAckService`). */
  AGENT_MESSAGE_ACK: Symbol.for('AgentMessageAck'),
  /** Limit-aware delivery gate (`LaneDeliveryLimitGate`, Component 14). */
  LANE_DELIVERY_LIMIT_GATE: Symbol.for('LaneDeliveryLimitGate'),
  /** Lane-to-lane authorization and per-sender rate limit (`LaneMessagePolicy`, Component 15). */
  LANE_MESSAGE_POLICY: Symbol.for('LaneMessagePolicy'),
  /**
   * `{ markDispatching }` over the envelope store. The same `Symbol.for` the
   * router injects optionally; register it before the router and manager.
   */
  AGENT_MESSAGE_DISPATCH_JOURNAL,
  /** Three-phase purge of a deleted parent session's messages (`ParentSessionPurge`). */
  PARENT_SESSION_PURGE: Symbol.for('ParentSessionPurge'),
  AGENT_LANE_RESUME: Symbol.for('AgentLaneResume'),
  AGENT_DELIVERY_RECEIPT_EVENT_SINK: Symbol.for('AgentDeliveryReceiptEventSink'),
  AGENT_SPAWN_TRUSTED_ROOTS: Symbol.for('AgentSpawnTrustedRoots'),
  CODEX_ADAPTER_FACTORY: Symbol.for('CodexAdapterFactory'),
  MCP_ATTACHMENT_PROBE: Symbol.for('McpAttachmentProbe'),
  SDK_PTAH_CLI_CONFIG_PERSISTENCE: Symbol.for('SdkPtahCliConfigPersistence'),
  SDK_PTAH_CLI_SPAWN_OPTIONS: Symbol.for('SdkPtahCliSpawnOptions'),
  SDK_PTAH_CLI_REGISTRY: Symbol.for('SdkPtahCliRegistry'),
  /**
   * Child → parent report delivery (TASK_2026_402). Resolved lazily by
   * `vscode-lm-tools`' PtahAPI builder, which owns the one
   * `buildAgentNamespace` call site.
   */
  AGENT_REPORT_ROUTER: Symbol.for('AgentReportRouter'),
  AGENT_ROLE_RESOLVER: Symbol.for('AgentRoleResolver'),
  /**
   * `ISessionSpawner` (TASK_2026_584): child chat sessions started with
   * `ptah_session_start`. Registered by this lib's `register.ts` once the
   * spawner exists; consumers resolve it optionally.
   */
  SESSION_SPAWNER: Symbol.for('SessionSpawner'),
  /**
   * `IChildChatSessionHost` (TASK_2026_584): the chat-path adapter a host
   * registers so the spawner can start a child session. Absent in a host
   * without a chat runtime.
   */
  CHILD_CHAT_SESSION_HOST: Symbol.for('ChildChatSessionHost'),
  /**
   * `ISessionHandoff` (TASK_2026_655): a session hands its work to a new
   * top-level session with `ptah_session_handoff`. Registered by this lib's
   * `register.ts`; consumers resolve it optionally.
   */
  SESSION_HANDOFF: Symbol.for('SessionHandoff'),
  /**
   * `IHandoffTurnFlush` on the same `SessionHandoffService` singleton as
   * `SESSION_HANDOFF`. The stream broadcaster calls it after a terminal flush.
   */
  HANDOFF_TURN_FLUSH: Symbol.for('HandoffTurnFlush'),
  /**
   * `ISessionHandoffChain` (TASK_2026_876): durable SDK-id edges for a
   * kept handoff. Optional for hosts that have not constructed the store.
   */
  SESSION_HANDOFF_CHAIN: Symbol.for('SessionHandoffChain'),
  /**
   * `CarryOverResolutionTags` (TASK_2026_865): the request ID of a provider
   * carry-over launch, stamped on its tab's `SESSION_ID_RESOLVED`. Bound by
   * the chat services; resolved optionally, so a host without it broadcasts
   * untagged resolutions.
   */
  CARRY_OVER_RESOLUTION_TAGS: Symbol.for('CarryOverResolutionTags'),
  /**
   * `LaneResumeGate` (TASK_2026_597, R9.1): decides whether a resume spawn
   * resumes the lane or starts a fresh one with a handoff. Injected by the
   * process manager.
   */
  LANE_RESUME_GATE: Symbol.for('LaneResumeGate'),
  LANE_TERMINAL_CHECKPOINT: Symbol.for('LaneTerminalCheckpoint'),
  LANE_INSTRUCTION_FILE_STORE: Symbol.for('LaneInstructionFileStore'),

  // Plan limits (TASK_2026_596). See `cli-agents/limits/`.
  /** Names the quota owner a lane runs on (`LaneOwnerResolver`). */
  LANE_OWNER_RESOLVER: Symbol.for('LaneOwnerResolver'),
  /** Per-lane limit state for the agent tools, bounded by a deadline. */
  LANE_LIMIT_LOOKUP: Symbol.for('LaneLimitLookup'),
  /** Which quota owners the dashboard and a session view show. */
  PLAN_LIMIT_OWNER_DISCOVERY: Symbol.for('PlanLimitOwnerDiscovery'),
} as const;

export type CliAgentRuntimeDIToken = keyof typeof CLI_AGENT_RUNTIME_TOKENS;

/**
 * Host-owned full `ClaudeLaneAccountPersistence` (registry, SDK attachment and
 * session metadata authorities, same as main chat). Kept outside
 * `CLI_AGENT_RUNTIME_TOKENS` because no host registers it until certification
 * (D7): it is resolved optionally, so an unregistered host keeps named lane
 * admission refused. Register `{ useFactory: () => null }`, never
 * `{ useValue: null }`, if an explicit null binding is ever needed.
 */
export const CLAUDE_LANE_ACCOUNT_PERSISTENCE = Symbol.for(
  'ClaudeLaneAccountPersistence',
);
