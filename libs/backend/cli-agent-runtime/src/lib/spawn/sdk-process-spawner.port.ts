import type {
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Structural port for off-thread process spawning in the Claude Agent SDK.
 *
 * Reuses the existing `SDK_TOKENS.SDK_PROCESS_SPAWNER` bound in `agent-sdk`
 * without creating a coupling to `agent-sdk` internals or modifying the public barrel.
 * Matches `OffThreadProcessSpawner.spawn` structurally.
 */
export interface ISdkProcessSpawner {
  spawn(
    options: SpawnOptions,
    hooks?: { onStderr?: (data: string) => void },
  ): SpawnedProcess;
}
