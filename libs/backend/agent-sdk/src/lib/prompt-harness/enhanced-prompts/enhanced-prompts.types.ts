/**
 * Enhanced Prompts Types
 *
 * Type definitions for the Enhanced Prompts feature (TASK_2025_137).
 * This premium feature generates project-specific guidance that is appended
 * to Anthropic's built-in claude_code system prompt.
 *
 * Key concepts:
 * - EnhancedPromptsState: Persistent state stored in VS Code globalState
 * - DetectedStack: Technology stack detected during wizard analysis
 * - EnhancedPromptsConfig: Configuration for prompt generation
 */

/**
 * Technology stack detected from workspace analysis.
 * Used to inform prompt generation with project-specific guidance.
 */
export interface DetectedStack {
  /**
   * Primary language(s) used in the project
   * e.g., ['TypeScript', 'JavaScript']
   */
  languages: string[];

  /**
   * Frameworks detected in the project
   * e.g., ['Angular', 'NestJS', 'Express']
   */
  frameworks: string[];

  /**
   * Build tools and package managers
   * e.g., ['Nx', 'Webpack', 'npm']
   */
  buildTools: string[];

  /**
   * Testing frameworks
   * e.g., ['Jest', 'Cypress', 'Playwright']
   */
  testingFrameworks: string[];

  /**
   * Additional tools and libraries
   * e.g., ['Prisma', 'TailwindCSS', 'DaisyUI']
   */
  additionalTools: string[];

  /**
   * Project type classification
   * e.g., 'vscode-extension', 'web-app', 'api-server', 'monorepo'
   */
  projectType: string;

  /**
   * Key configuration files found
   * e.g., ['package.json', 'nx.json', 'angular.json', 'tsconfig.json']
   */
  configFiles: string[];
}

/**
 * Persistent state for Enhanced Prompts feature.
 * Stored in VS Code globalState for cross-session persistence.
 */
export interface EnhancedPromptsState {
  /**
   * Whether Enhanced Prompts is enabled for this workspace.
   * When true, generated prompt is automatically applied to all sessions.
   */
  enabled: boolean;

  /**
   * ISO timestamp when the prompt was last generated.
   * Used for cache invalidation along with file hashes.
   */
  generatedAt: string | null;

  /**
   * The generated enhanced prompt content.
   * This is the project-specific guidance appended to the base system prompt.
   * SECURITY: Never exposed to users (IP protection).
   */
  generatedPrompt: string | null;

  /**
   * Technology stack detected during prompt generation.
   * Stored for display in settings and for regeneration context.
   */
  detectedStack: DetectedStack | null;

  /**
   * Hash of key config files at generation time.
   * Used for cache invalidation when project structure changes.
   */
  configHash: string | null;

  /**
   * Workspace folder path this state belongs to.
   * Used to handle multi-root workspaces correctly.
   */
  workspacePath: string;
}

/**
 * Configuration options for prompt generation.
 * Passed to PromptDesignerAgent during wizard execution.
 */
export interface EnhancedPromptsConfig {
  /**
   * Whether to include coding style guidelines
   * @default true
   */
  includeStyleGuidelines: boolean;

  /**
   * Whether to include project-specific terminology
   * @default true
   */
  includeTerminology: boolean;

  /**
   * Whether to include architecture patterns
   * @default true
   */
  includeArchitecturePatterns: boolean;

  /**
   * Whether to include testing guidelines
   * @default true
   */
  includeTestingGuidelines: boolean;

  /**
   * Maximum token count for generated prompt
   * Higher values = more detailed guidance but longer context
   * @default 2000
   */
  maxTokens: number;
}

/**
 * Default configuration for Enhanced Prompts generation
 */
export const DEFAULT_ENHANCED_PROMPTS_CONFIG: EnhancedPromptsConfig = {
  includeStyleGuidelines: true,
  includeTerminology: true,
  includeArchitecturePatterns: true,
  includeTestingGuidelines: true,
  maxTokens: 2000,
};

/**
 * Initial state for a workspace without Enhanced Prompts configured
 */
export function createInitialEnhancedPromptsState(
  workspacePath: string
): EnhancedPromptsState {
  return {
    enabled: false,
    generatedAt: null,
    generatedPrompt: null,
    detectedStack: null,
    configHash: null,
    workspacePath,
  };
}

/**
 * Summary of generated enhanced prompts sections.
 * Used by the frontend to display what was generated without exposing actual content (IP protection).
 */
export interface EnhancedPromptsSummary {
  /** Individual guidance sections with metadata */
  sections: Array<{
    /** Section display name (e.g., 'Project Context') */
    name: string;
    /** Approximate word count of the generated section */
    wordCount: number;
    /** Whether this section was successfully generated */
    generated: boolean;
  }>;
  /** Total token count across all sections */
  totalTokens: number;
  /** Quality score from code quality assessment (0-100), if available */
  qualityScore?: number;
  /** Whether template-based fallback guidance was used */
  usedFallback: boolean;
}

/**
 * Result of Enhanced Prompts wizard execution
 */
export interface EnhancedPromptsWizardResult {
  /**
   * Whether the wizard completed successfully
   */
  success: boolean;

  /**
   * Error message if wizard failed
   */
  error?: string;

  /**
   * Updated state after wizard completion
   */
  state?: EnhancedPromptsState;

  /**
   * Summary of what was generated (sections, token counts).
   * Available when success is true. Never includes actual prompt content.
   */
  summary?: EnhancedPromptsSummary;
}

/**
 * Status response for Enhanced Prompts feature
 * Used by RPC handlers to communicate current state to webview
 */
export interface EnhancedPromptsStatus {
  /**
   * Whether Enhanced Prompts is currently enabled
   */
  enabled: boolean;

  /**
   * Whether a prompt has been generated
   */
  hasGeneratedPrompt: boolean;

  /**
   * When the prompt was last generated (ISO timestamp)
   */
  generatedAt: string | null;

  /**
   * Detected technology stack summary (for display in settings)
   */
  detectedStack: DetectedStack | null;

  /**
   * Whether cache is valid or needs regeneration
   */
  cacheValid: boolean;

  /**
   * Reason for cache invalidation if invalid
   */
  invalidationReason?: string;
}

/**
 * Request payload for regenerating Enhanced Prompts
 */
export interface RegeneratePromptsRequest {
  /**
   * Force regeneration even if cache is valid
   */
  force?: boolean;

  /**
   * Custom configuration overrides
   */
  config?: Partial<EnhancedPromptsConfig>;
}

/**
 * Response from regenerate operation
 */
export interface RegeneratePromptsResponse {
  /**
   * Whether regeneration was successful
   */
  success: boolean;

  /**
   * Error message if failed
   */
  error?: string;

  /**
   * Updated status after regeneration
   */
  status?: EnhancedPromptsStatus;
}
