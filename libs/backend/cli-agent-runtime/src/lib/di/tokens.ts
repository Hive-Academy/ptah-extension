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
} as const;

export type CliAgentRuntimeDIToken = keyof typeof CLI_AGENT_RUNTIME_TOKENS;
