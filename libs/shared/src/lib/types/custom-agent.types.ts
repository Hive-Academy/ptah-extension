/**
 * Custom Agent Type Definitions (TASK_2025_167)
 *
 * Types for user-configured custom agent instances that connect to
 * Anthropic-compatible providers (OpenRouter, Moonshot, Z.AI, etc.)
 * via the Claude Agent SDK's query() function.
 */

/**
 * Persisted configuration for a single custom agent instance.
 * Stored in VS Code workspace settings under ptah.customAgents[].
 */
export interface CustomAgentConfig {
  /** Unique instance ID (UUID, generated on creation) */
  readonly id: string;
  /** User-facing display name (e.g., "My Kimi Agent") */
  readonly name: string;
  /** Provider ID from the Anthropic-compatible registry (e.g., 'openrouter', 'moonshot', 'z-ai') */
  readonly providerId: string;
  /** Whether this agent is enabled (appears in agent selector) */
  readonly enabled: boolean;
  /** Model tier mappings */
  readonly tierMappings?: {
    readonly sonnet?: string;
    readonly opus?: string;
    readonly haiku?: string;
  };
  /** Selected model ID for direct selection (overrides tier if set) */
  readonly selectedModel?: string;
  /** Timestamp of last configuration change */
  readonly updatedAt: number;
}

/**
 * Runtime state for a custom agent (not persisted).
 */
export interface CustomAgentState {
  readonly initialized: boolean;
  readonly status: 'available' | 'error' | 'initializing' | 'unconfigured';
  readonly errorMessage?: string;
}

/**
 * Summary information sent to the frontend for agent selection.
 */
export interface CustomAgentSummary {
  readonly id: string;
  readonly name: string;
  readonly providerName: string;
  readonly providerId: string;
  readonly hasApiKey: boolean;
  readonly status: CustomAgentState['status'];
  readonly enabled: boolean;
  readonly modelCount: number;
}
