export const CLI_AGENT_RUNTIME_TOKENS = {
  SDK_PTAH_CLI_CONFIG_PERSISTENCE: Symbol.for('SdkPtahCliConfigPersistence'),
  SDK_PTAH_CLI_SPAWN_OPTIONS: Symbol.for('SdkPtahCliSpawnOptions'),
  SDK_PTAH_CLI_REGISTRY: Symbol.for('SdkPtahCliRegistry'),
} as const;

export type CliAgentRuntimeDIToken = keyof typeof CLI_AGENT_RUNTIME_TOKENS;
