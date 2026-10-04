export const CLI_AGENT_RUNTIME_TOKENS = {
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

  // Plan limits (TASK_2026_596). See `cli-agents/limits/`.
  /** Names the quota owner a lane runs on (`LaneOwnerResolver`). */
  LANE_OWNER_RESOLVER: Symbol.for('LaneOwnerResolver'),
  /** Per-lane limit state for the agent tools, bounded by a deadline. */
  LANE_LIMIT_LOOKUP: Symbol.for('LaneLimitLookup'),
  /** Which quota owners the dashboard and a session view show. */
  PLAN_LIMIT_OWNER_DISCOVERY: Symbol.for('PlanLimitOwnerDiscovery'),
} as const;

export type CliAgentRuntimeDIToken = keyof typeof CLI_AGENT_RUNTIME_TOKENS;
