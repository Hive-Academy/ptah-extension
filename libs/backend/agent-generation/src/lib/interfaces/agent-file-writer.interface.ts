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
 * - Create backup of existing files before overwriting
 * - Atomic batch operations (all succeed or all rollback)
 * - Directory creation if missing
 * - File permission management
 * - Rollback support on write failures
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
   * 2. Backup existing file if present (with .backup extension and timestamp)
   * 3. Write new content to target path
   * 4. Verify write succeeded
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
   * Writes all agents in a single transaction. If any write fails, all previous
   * writes are rolled back to maintain consistency. Backup files are created
   * for all existing files before any writes occur.
   *
   * Write order:
   * 1. Validate all agents (paths, content)
   * 2. Create all necessary directories
   * 3. Backup all existing files
   * 4. Write all new files
   * 5. Verify all writes
   * 6. On failure: restore all backups, delete partial writes
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

  /**
   * Create backup of existing agent file.
   *
   * Creates a backup copy with timestamp before overwriting. Backup filename
   * format: `{original-name}.backup-{timestamp}.md`
   *
   * Example: `backend-developer.md` → `backend-developer.backup-20231210-143022.md`
   *
   * If the file doesn't exist, returns success with empty string.
   *
   * @param filePath - Absolute path to file to backup
   * @returns Result containing backup file path, or Error if backup fails
   *
   * @example
   * ```typescript
   * const result = await service.backupExisting('/workspace/.claude/agents/backend-developer.md');
   * if (result.isOk()) {
   *   const backupPath = result.value;
   *   if (backupPath) {
   *     console.log(`Backup created: ${backupPath}`);
   *   } else {
   *     console.log('No existing file to backup');
   *   }
   * }
   * ```
   */
  backupExisting(filePath: string): Promise<Result<string, Error>>;
}
