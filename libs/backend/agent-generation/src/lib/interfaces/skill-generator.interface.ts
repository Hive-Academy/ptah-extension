/**
 * Skill Generator Interface
 *
 * Service interface for generating orchestration skills with project customization.
 * Generates SKILL.md and reference files tailored to the specific project context.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import * as vscode from 'vscode';
import { AgentProjectContext } from '../types/core.types';

/**
 * Options for skill generation configuration.
 */
export interface SkillGenerationOptions {
  /**
   * URI to the workspace root directory.
   * Skills will be generated to .claude/skills/orchestration/ under this path.
   */
  workspaceUri: vscode.Uri;

  /**
   * Project context from workspace analysis.
   * Used for template variable substitution and customization.
   */
  projectContext: AgentProjectContext;

  /**
   * List of selected agent IDs to include in the skill.
   * Used to customize agent-catalog.md with relevant agents.
   */
  selectedAgents: string[];

  /**
   * Whether to overwrite existing skill files.
   * If false, existing files will be preserved and skipped.
   */
  overwriteExisting: boolean;
}

/**
 * Result of skill generation operation.
 */
export interface SkillGenerationResult {
  /**
   * List of file paths that were successfully created.
   * Relative to workspace root (e.g., '.claude/skills/orchestration/SKILL.md').
   */
  filesCreated: string[];

  /**
   * List of file paths that were skipped (already exist and overwrite=false).
   */
  filesSkipped: string[];

  /**
   * Map of file names to customizations applied.
   * Key is the relative file path, value is array of customization descriptions.
   */
  customizations: Map<string, string[]>;
}

/**
 * Service for generating orchestration skills with project customization.
 *
 * Responsibilities:
 * - Generate SKILL.md with project-specific customizations
 * - Generate reference files (agent-catalog.md, strategies.md, etc.)
 * - Handle template variable substitution
 * - Support overwrite protection for existing files
 * - Track customizations applied to each file
 *
 * @example
 * ```typescript
 * const result = await skillGenerator.generateOrchestrationSkill({
 *   workspaceUri: vscode.workspace.workspaceFolders![0].uri,
 *   projectContext: context,
 *   selectedAgents: ['backend-developer', 'frontend-developer'],
 *   overwriteExisting: false
 * });
 *
 * if (result.isOk()) {
 *   console.log(`Created ${result.value.filesCreated.length} files`);
 * }
 * ```
 */
export interface ISkillGeneratorService {
  /**
   * Generate the complete orchestration skill structure.
   *
   * Creates the following files:
   * - .claude/skills/orchestration/SKILL.md (main skill file)
   * - .claude/skills/orchestration/references/agent-catalog.md
   * - .claude/skills/orchestration/references/strategies.md
   * - .claude/skills/orchestration/references/team-leader-modes.md
   * - .claude/skills/orchestration/references/task-tracking.md
   * - .claude/skills/orchestration/references/checkpoints.md
   * - .claude/skills/orchestration/references/git-standards.md
   *
   * Template variables are substituted with project-specific values:
   * - {{PROJECT_TYPE}} - Detected project type
   * - {{PROJECT_PATH}} - Absolute workspace path
   * - {{MONOREPO_CONFIG}} - Monorepo tool configuration if applicable
   * - {{AGENTS_LIST}} - Selected agents for the project
   * - {{BRANCH_PREFIX}} - Git branch prefix convention
   *
   * @param options - Configuration options for skill generation
   * @returns Result containing generation summary, or Error if generation fails
   *
   * @example
   * ```typescript
   * const options: SkillGenerationOptions = {
   *   workspaceUri: vscode.workspace.workspaceFolders![0].uri,
   *   projectContext: analysisResult,
   *   selectedAgents: ['project-manager', 'backend-developer'],
   *   overwriteExisting: false
   * };
   *
   * const result = await service.generateOrchestrationSkill(options);
   * if (result.isOk()) {
   *   const { filesCreated, filesSkipped, customizations } = result.value;
   *   console.log(`Created: ${filesCreated.join(', ')}`);
   *   console.log(`Skipped: ${filesSkipped.join(', ')}`);
   * }
   * ```
   */
  generateOrchestrationSkill(
    options: SkillGenerationOptions
  ): Promise<Result<SkillGenerationResult, Error>>;

  /**
   * Check if orchestration skill already exists in the workspace.
   *
   * Checks for the presence of SKILL.md in .claude/skills/orchestration/.
   *
   * @param workspaceUri - URI to the workspace root directory
   * @returns true if skill files exist, false otherwise
   */
  skillExists(workspaceUri: vscode.Uri): Promise<boolean>;

  /**
   * Get the list of files that would be generated.
   *
   * Returns the complete list of file paths that will be created,
   * useful for showing users what will be generated before confirmation.
   *
   * @returns Array of relative file paths
   */
  getGeneratedFilePaths(): string[];
}
