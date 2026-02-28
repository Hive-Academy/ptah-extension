/**
 * CLI Skill Sync Types
 * TASK_2025_160: Multi-CLI Plugin Sync and Agent Generation Architecture
 *
 * Shared type definitions for cross-CLI skill sync and agent transformation.
 * Used by llm-abstraction (skill sync) and agent-generation (agent transforms).
 *
 * Design: Pure TypeScript types, no runtime dependencies (shared library boundary).
 */

// ========================================
// CLI Target
// ========================================

/**
 * CLI targets that support Ptah skill/agent integration.
 * Excludes 'codex' (from CliType) since Codex does not support
 * user-level skill/agent directories.
 */
export type CliTarget = 'copilot' | 'gemini';

// ========================================
// Agent Transform Result
// ========================================

/**
 * Result of transforming a Claude-format agent to a CLI-specific format.
 * Produced by ICliAgentTransformer implementations.
 */
export interface CliAgentTransformResult {
  /** Which CLI this transform targets */
  readonly cli: CliTarget;
  /** Agent identifier (matches sourceTemplateId from GeneratedAgent) */
  readonly agentId: string;
  /** Transformed agent content in CLI-specific format */
  readonly content: string;
  /** Absolute file path where the agent should be written */
  readonly filePath: string;
}

// ========================================
// Skill Sync Status
// ========================================

/**
 * Status of skill sync for a single CLI.
 * Returned by ICliSkillInstaller.install() and CliPluginSyncService.syncOnActivation().
 */
export interface CliSkillSyncStatus {
  /** Which CLI this status is for */
  readonly cli: CliTarget;
  /** Whether sync completed successfully */
  readonly synced: boolean;
  /** Number of skill files synced */
  readonly skillCount: number;
  /** ISO timestamp of last successful sync */
  readonly lastSyncedAt?: string;
  /** Error message if sync failed */
  readonly error?: string;
}

// ========================================
// Plugin Sync State (Persistence)
// ========================================

/**
 * Overall plugin sync state persisted in VS Code globalState.
 * Stored under 'ptah.cliSkillSync' key.
 */
export interface CliPluginSyncState {
  readonly syncedClis: Record<
    string,
    {
      /** Content hash of plugin directories at last sync */
      readonly contentHash: string;
      /** ISO timestamp of last sync */
      readonly syncedAt: string;
      /** Plugin IDs that were synced */
      readonly pluginIds: string[];
    }
  >;
}

// ========================================
// Multi-CLI Generation Result
// ========================================

/**
 * Per-CLI agent generation/distribution result.
 * Returned by MultiCliAgentWriterService.writeForClis().
 * Aggregated into GenerationSummary.cliResults.
 */
export interface CliGenerationResult {
  /** Which CLI this result is for */
  readonly cli: CliTarget;
  /** Number of agents successfully written */
  readonly agentsWritten: number;
  /** Number of agents that failed to write */
  readonly agentsFailed: number;
  /** Absolute paths of successfully written agent files */
  readonly paths: string[];
  /** Error messages for failed agent writes */
  readonly errors: string[];
}
