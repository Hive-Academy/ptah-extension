/**
 * Agent File Writer Interface
 *
 * Service interface for writing generated agents to the filesystem.
 * Implements atomic operations with rollback support for reliability.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import { GeneratedAgent } from '../types/core.types';

/**
 * Service for writing generated agents to the filesystem.
 *
 * Responsibilities:
 * - Write agent files to .claude/agents/ directory
 * - Overwrite existing files in place (no backup — avoids duplicate agent .md files)
 * - Directory creation if missing
 * - Path traversal protection
 *
 * @example
 * ```typescript
 * const result = await fileWriter.writeAgent(generatedAgent);
 * if (result.isOk()) {
 *   const filePath = result.value;
 *   console.log(`Agent written to: ${filePath}`);
 * }
 * ```
 */
export interface IAgentFileWriterService {
  /**
   * Write a generated agent to its target path.
   *
   * Performs the following operations atomically:
   * 1. Create target directory if it doesn't exist
   * 2. Write new content to target path (overwrites existing)
   * 3. Verify write succeeded
   *
   * If any step fails, previous steps are rolled back and error is returned.
   *
   * @param agent - Generated agent with content and target file path
   * @returns Result containing absolute file path where agent was written, or Error
   *
   * @example
   * ```typescript
   * const result = await service.writeAgent(generatedAgent);
   * if (result.isErr()) {
   *   console.error('Failed to write agent:', result.error);
   *   return;
   * }
   *
   * const filePath = result.value;
   * console.log(`Agent successfully written to: ${filePath}`);
   * ```
   */
  writeAgent(agent: GeneratedAgent): Promise<Result<string, Error>>;

  /**
   * Write multiple agents atomically.
   *
   * Writes all agents sequentially. If any write fails, previously written
   * files in this batch are cleaned up. Existing files are overwritten in place.
   *
   * Write order:
   * 1. Validate all agents (paths, content)
   * 2. Create all necessary directories
   * 3. Write all new files (overwrite existing)
   * 4. On failure: delete partial writes
   *
   * @param agents - Array of generated agents to write
   * @returns Result containing array of absolute file paths written, or Error
   *
   * @example
   * ```typescript
   * const result = await service.writeAgentsBatch(generatedAgents);
   * if (result.isErr()) {
   *   console.error('Batch write failed (rolled back):', result.error);
   *   return;
   * }
   *
   * const filePaths = result.value;
   * console.log(`Successfully wrote ${filePaths.length} agents:`);
   * filePaths.forEach(path => console.log(`- ${path}`));
   * ```
   */
  writeAgentsBatch(agents: GeneratedAgent[]): Promise<Result<string[], Error>>;
}
