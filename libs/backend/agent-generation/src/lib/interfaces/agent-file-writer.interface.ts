/**
 * Agent File Writer Interface
 *
 * Service interface for the guarded agent writer: the only place a wizard
 * agent file is written. Every write carries the decision the user made for
 * that file, and the writer re-checks the file on disk before acting on it.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../types/core.types';

/**
 * What the file looked like when the user decided to replace it.
 *
 * - `missing`: there was no file; a file that appears since then was not
 *   part of the decision.
 * - `present`: the file existed with this `hashContent` hash; any other
 *   content now on disk was not part of the decision.
 */
export type AgentWriteBaseline =
  | { state: 'missing' }
  | { state: 'present'; hash: string };

/**
 * The write permission for one agent file.
 *
 * - `create-only`: write only when no file exists; never touch an existing one.
 * - `replace-allowed`: replace the file, but only while it still matches the
 *   `baseline` the decision was made against.
 */
export type AgentWriteGuard =
  | { mode: 'create-only' }
  | { mode: 'replace-allowed'; baseline: AgentWriteBaseline };

/**
 * Terminal status of one guarded write that did not fail.
 *
 * - `written`: the file now holds the new content.
 * - `unchanged`: the file already held exactly the new content.
 * - `kept`: an existing file was left alone (create-only, or it could not be
 *   read, so nothing is known about what replacing it would destroy).
 * - `changed-since-preview`: replace was allowed, but the file no longer
 *   matches the baseline, so it was left alone.
 *
 * A write error is not a status: it is `Result.err`.
 */
export type AgentWriteStatus =
  | 'written'
  | 'unchanged'
  | 'kept'
  | 'changed-since-preview';

/** Outcome of one guarded agent write. */
export interface AgentWriteResult {
  /** Absolute, normalized path of the target file. */
  filePath: string;
  status: AgentWriteStatus;
}

/**
 * Service for writing generated agents to the filesystem.
 *
 * Responsibilities:
 * - Re-read the target and apply the write guard before any write
 * - Skip the write when the existing bytes already match (`unchanged`)
 * - Directory creation if missing
 * - Path traversal protection
 *
 * @example
 * ```typescript
 * const result = await fileWriter.writeAgent(generatedAgent, {
 *   mode: 'create-only',
 * });
 * if (result.isOk() && result.value.status === 'kept') {
 *   // the user's existing file was left alone
 * }
 * ```
 */
export interface IAgentFileWriterService {
  /**
   * Write a generated agent to its target path under a write guard.
   *
   * 1. Validate content and path (absolute, inside `.claude/`, no traversal)
   * 2. Read the target: not found → absent; any other read error → `kept`
   * 3. Equal bytes → `unchanged`, nothing written
   * 4. Apply the guard (`kept` / `changed-since-preview` leave the file alone)
   * 5. Create the parent directory and write → `written`
   *
   * @param agent - Generated agent with content and absolute target path
   * @param guard - The write permission the user's decision grants
   * @returns The target path and its status, or the validation/write error
   */
  writeAgent(
    agent: GeneratedAgent,
    guard: AgentWriteGuard,
  ): Promise<Result<AgentWriteResult, Error>>;
}
