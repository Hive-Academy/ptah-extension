/**
 * Prompt Harness Type Definitions (TASK_2025_135)
 *
 * Type definitions for the Prompt Harness System - a layered prompt assembly
 * mechanism that enables user-configurable "power-ups" extracted from
 * existing agent patterns.
 *
 * @see implementation-plan.md for full architecture documentation
 */

// ============================================================
// Category Types
// ============================================================

/**
 * Power-up category for UI grouping and organization
 */
export type PowerUpCategory =
  | 'investigation'
  | 'code-quality'
  | 'workflow'
  | 'mcp'
  | 'custom';

/**
 * Prompt layer type for assembled prompt breakdown
 */
export type PromptLayerType = 'base' | 'project' | 'agent' | 'user' | 'premium';

/**
 * Warning type for prompt assembly issues
 */
export type PromptWarningType = 'token_budget' | 'conflict' | 'deprecated';

/**
 * Warning severity level
 */
export type PromptWarningSeverity = 'info' | 'warning' | 'error';

// ============================================================
// Power-Up Definition Types
// ============================================================

/**
 * Static definition of a power-up (stored in code, not user data)
 *
 * Power-ups are pre-defined prompt enhancements that can be toggled on/off
 * by users to customize Claude's behavior.
 *
 * @see PowerUpRegistry for the registry of all power-ups
 */
export interface PowerUpDefinition {
  /**
   * Unique identifier for the power-up
   * @example 'investigation-first', 'anti-hallucination'
   */
  id: string;

  /**
   * Human-readable name for display in UI
   * @example 'Investigation-First Protocol'
   */
  name: string;

  /**
   * Brief description of what this power-up does
   * @example 'Systematically investigate codebase before proposing solutions'
   */
  description: string;

  /**
   * Category for UI grouping
   */
  category: PowerUpCategory;

  /**
   * Source agent this was extracted from (for attribution)
   * @example 'software-architect', 'code-logic-reviewer'
   */
  sourceAgent?: string;

  /**
   * Whether this power-up requires premium tier
   */
  isPremium: boolean;

  /**
   * Semantic version for tracking changes
   * @example '1.0.0'
   */
  version: string;

  /**
   * The actual prompt content to inject
   */
  content: string;

  /**
   * Default priority (lower = earlier in assembly, 0-100)
   */
  defaultPriority: number;

  /**
   * IDs of other power-ups that conflict with this one
   */
  conflictsWith?: string[];

  /**
   * Estimated token count for this power-up's content
   */
  tokenCount: number;
}

// ============================================================
// User State Types
// ============================================================

/**
 * User's enable/disable state for a power-up (stored in globalState)
 */
export interface PowerUpState {
  /**
   * Power-up ID this state applies to
   */
  powerUpId: string;

  /**
   * Whether the power-up is enabled by user
   */
  enabled: boolean;

  /**
   * User-overridden priority (optional, defaults to definition)
   */
  priority?: number;

  /**
   * Timestamp when user last modified this state
   */
  lastModified: number;
}

/**
 * User-created custom prompt section (stored in SecretStorage due to
 * potential sensitive content)
 */
export interface UserPromptSection {
  /**
   * Unique identifier
   */
  id: string;

  /**
   * User-provided name
   */
  name: string;

  /**
   * The prompt content (markdown)
   */
  content: string;

  /**
   * Whether this section is enabled
   */
  enabled: boolean;

  /**
   * Priority for ordering (lower = earlier, 0-100)
   */
  priority: number;

  /**
   * Created timestamp (ms since epoch)
   */
  createdAt: number;

  /**
   * Last modified timestamp (ms since epoch)
   */
  updatedAt: number;
}

// ============================================================
// Configuration Types
// ============================================================

/**
 * Complete configuration for prompt assembly
 * Retrieved from storage and sent to assemblePrompt()
 */
export interface PromptHarnessConfig {
  /**
   * Version for migration support
   */
  version: string;

  /**
   * Power-up states (map for O(1) lookup)
   * Key is power-up ID, value is the state
   */
  powerUpStates: Map<string, PowerUpState>;

  /**
   * User custom sections
   */
  customSections: UserPromptSection[];

  /**
   * Whether to show recommendations (user preference)
   */
  showRecommendations: boolean;

  /**
   * Last workspace type used for recommendations
   */
  lastWorkspaceType?: string;
}

// ============================================================
// Assembly Result Types
// ============================================================

/**
 * Individual layer in an assembled prompt
 */
export interface PromptLayer {
  /**
   * Layer name for display
   */
  name: string;

  /**
   * Layer type for styling
   */
  type: PromptLayerType;

  /**
   * Content of this layer
   */
  content: string;

  /**
   * Token count for this layer
   */
  tokenCount: number;

  /**
   * Source attribution (power-up ID or 'custom')
   */
  source?: string;
}

/**
 * Warning from prompt assembly process
 */
export interface PromptWarning {
  /**
   * Warning type
   */
  type: PromptWarningType;

  /**
   * Human-readable warning message
   */
  message: string;

  /**
   * Severity level
   */
  severity: PromptWarningSeverity;
}

/**
 * Result of prompt assembly with layer annotations for preview
 */
export interface AssembledPrompt {
  /**
   * The complete assembled prompt text
   */
  text: string;

  /**
   * Total estimated token count
   */
  totalTokens: number;

  /**
   * Breakdown by layer for preview UI
   */
  layers: PromptLayer[];

  /**
   * Warnings (e.g., token budget, conflicts)
   */
  warnings: PromptWarning[];
}
