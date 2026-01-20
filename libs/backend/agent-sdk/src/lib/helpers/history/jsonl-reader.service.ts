/**
 * JSONL Reader Service
 *
 * Handles all JSONL file I/O operations for session history processing.
 * Extracted from SessionHistoryReaderService for single responsibility.
 *
 * Responsibilities:
 * - Find sessions directory for a workspace path
 * - Read JSONL messages from session files
 * - Load linked agent session files
 * - Convert raw JSONL lines to SessionHistoryMessage format
 *
 * @see TASK_2025_106 - Session History Reader Refactoring
 */

import { injectable, inject } from 'tsyringe';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  JsonlMessageLine,
  SessionHistoryMessage,
  AgentSessionData,
} from './history.types';

/**
 * Service for reading JSONL session files.
 *
 * Pattern: Injectable service with Logger dependency
 * @see libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158-164
 */
@injectable()
export class JsonlReaderService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Find the sessions directory for a workspace.
   *
   * Claude stores sessions in ~/.claude/projects/{escaped-workspace-path}/
   * The workspace path is escaped by replacing : and / with -
   *
   * @param workspacePath - The absolute path to the workspace
   * @returns The sessions directory path, or null if not found
   */
  async findSessionsDirectory(workspacePath: string): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    try {
      await fs.access(projectsDir);
    } catch {
      // Projects directory doesn't exist
      return null;
    }

    // Generate the escaped path pattern
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    // Try exact match first
    if (dirs.includes(escapedPath)) {
      return path.join(projectsDir, escapedPath);
    }

    // Try lowercase match (case-insensitive file systems)
    const lowerEscaped = escapedPath.toLowerCase();
    const match = dirs.find((d) => d.toLowerCase() === lowerEscaped);
    if (match) {
      return path.join(projectsDir, match);
    }

    // Try partial match (workspace name only)
    const workspaceName = path.basename(workspacePath);
    const partialMatch = dirs.find((d) =>
      d.toLowerCase().includes(workspaceName.toLowerCase())
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    return null;
  }

  /**
   * Read all messages from a JSONL file.
   *
   * Uses streaming to handle large files efficiently.
   * Skips malformed lines instead of throwing.
   *
   * @param filePath - Absolute path to the JSONL file
   * @returns Array of parsed session history messages
   */
  async readJsonlMessages(filePath: string): Promise<SessionHistoryMessage[]> {
    const messages: SessionHistoryMessage[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const reader = createInterface({ input: stream });

    try {
      for await (const line of reader) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line) as JsonlMessageLine;
          // Convert to SessionHistoryMessage format (preserves extra fields)
          messages.push(this.convertToSessionHistoryMessage(parsed));
        } catch {
          // Skip malformed lines - don't throw
          this.logger.debug('[JsonlReader] Skipping malformed JSONL line', {
            filePath,
            linePreview: line.substring(0, 100),
          });
        }
      }
    } finally {
      // Always close streams to prevent resource leaks
      reader.close();
      stream.destroy();
    }

    return messages;
  }

  /**
   * Convert JsonlMessageLine to SessionHistoryMessage format.
   *
   * Maps the raw JSONL structure to the extended JSONLMessage format
   * used throughout the history processing pipeline.
   *
   * @param line - Raw JSONL message line
   * @returns Converted session history message
   */
  private convertToSessionHistoryMessage(
    line: JsonlMessageLine
  ): SessionHistoryMessage {
    return {
      type: (line.type ||
        line.message?.role ||
        'unknown') as SessionHistoryMessage['type'],
      uuid: line.uuid,
      sessionId: line.sessionId,
      timestamp: line.timestamp,
      isMeta: line.isMeta,
      slug: line.slug,
      message: line.message as SessionHistoryMessage['message'],
      // Preserve usage stats for later aggregation
      usage: line.message?.usage,
    };
  }

  /**
   * Load agent session files (agent-*.jsonl) for a parent session.
   *
   * Agent files are stored in the same directory as the main session file.
   * Each agent file contains messages from a subagent spawned by Task tool.
   * Files are filtered to only include agents belonging to the parent session
   * by checking the sessionId in the first message.
   *
   * @param sessionsDir - Path to the sessions directory
   * @param parentSessionId - ID of the parent session to filter by
   * @returns Array of agent session data
   */
  async loadAgentSessions(
    sessionsDir: string,
    parentSessionId: string
  ): Promise<AgentSessionData[]> {
    const agentSessions: AgentSessionData[] = [];

    try {
      const files = await fs.readdir(sessionsDir);
      const agentFiles = files.filter(
        (f) => f.startsWith('agent-') && f.endsWith('.jsonl')
      );

      this.logger.info('[JsonlReader] Scanning for agent files', {
        sessionsDir,
        parentSessionId,
        agentFilesFound: agentFiles.length,
      });

      for (const file of agentFiles) {
        const filePath = path.join(sessionsDir, file);
        const agentId = file.replace('.jsonl', '');

        try {
          const messages = await this.readJsonlMessages(filePath);

          // Check if this agent belongs to parent session by checking sessionId in first message
          // Agent files have sessionId pointing to their parent main session
          const firstMsg = messages[0];

          if (firstMsg?.sessionId === parentSessionId) {
            agentSessions.push({
              agentId,
              filePath,
              messages,
            });
          }
        } catch {
          // Skip unreadable agent files
          this.logger.debug('[JsonlReader] Skipping unreadable agent file', {
            filePath,
          });
        }
      }
    } catch {
      // No agent files found or directory not readable
      this.logger.debug('[JsonlReader] Could not read sessions directory', {
        sessionsDir,
      });
    }

    return agentSessions;
  }
}
