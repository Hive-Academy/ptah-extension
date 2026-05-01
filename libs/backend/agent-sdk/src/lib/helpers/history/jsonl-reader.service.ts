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
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  JsonlMessageLine,
  SessionHistoryMessage,
  AgentSessionData,
} from './history.types';
import { SdkError } from '../../errors';

/**
 * Service for reading JSONL session files.
 *
 * Pattern: Injectable service with Logger dependency
 * @see libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158-164
 */
@injectable()
export class JsonlReaderService {
  /**
   * Maximum session file size allowed for reading (50MB).
   * Prevents memory exhaustion from extremely large session files.
   */
  private readonly MAX_SESSION_FILE_SIZE = 50 * 1024 * 1024;

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
      this.logger.warn('[JsonlReader] Projects directory does not exist', {
        projectsDir,
      });
      return null;
    }

    // Generate the escaped path pattern
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    this.logger.debug('[JsonlReader] findSessionsDirectory', {
      workspacePath,
      escapedPath,
      dirCount: dirs.length,
      sampleDirs: dirs.slice(0, 10),
    });

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

    // Try normalized match: treat hyphens and underscores as equivalent.
    // Claude CLI may normalize path separators differently (e.g., replacing _ with -)
    // so "d--projects-brand_force" should match "d--projects-brand-force" on disk.
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
    const normalizedEscaped = normalize(escapedPath);
    const normalizedMatch = dirs.find(
      (d) => normalize(d) === normalizedEscaped,
    );
    if (normalizedMatch) {
      return path.join(projectsDir, normalizedMatch);
    }

    // Try partial match (workspace name only)
    const workspaceName = path.basename(workspacePath);
    const normalizedWorkspaceName = normalize(workspaceName);
    const partialMatch = dirs.find(
      (d) =>
        d.toLowerCase().includes(workspaceName.toLowerCase()) ||
        normalize(d).includes(normalizedWorkspaceName),
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    this.logger.warn(
      '[JsonlReader] Sessions directory not found after all match attempts',
      {
        workspacePath,
        escapedPath,
        lowerEscaped,
        workspaceName,
      },
    );

    return null;
  }

  /**
   * Read all messages from a JSONL file.
   *
   * Uses streaming to handle large files efficiently.
   * Skips malformed lines instead of throwing.
   * Enforces a maximum file size limit to prevent memory exhaustion.
   *
   * @param filePath - Absolute path to the JSONL file
   * @returns Array of parsed session history messages
   * @throws Error if file exceeds maximum size limit
   */
  async readJsonlMessages(filePath: string): Promise<SessionHistoryMessage[]> {
    // Check file size before reading to prevent memory exhaustion
    const stats = await fs.stat(filePath);
    if (stats.size > this.MAX_SESSION_FILE_SIZE) {
      const sizeMB = Math.round(stats.size / 1024 / 1024);
      const limitMB = Math.round(this.MAX_SESSION_FILE_SIZE / 1024 / 1024);
      this.logger.warn(
        `[JsonlReader] Session file exceeds size limit: ${stats.size} bytes`,
        { filePath, sizeMB, limitMB },
      );
      throw new SdkError(
        `Session file too large (${sizeMB}MB). Max: ${limitMB}MB`,
      );
    }

    // Read the entire file as a string and split by newline.
    // We avoid createReadStream + readline because VS Code extension host's
    // Node.js environment has a broken StringDecoder constructor that crashes
    // when createReadStream uses encoding: 'utf8'. File size is already
    // bounded by the 50MB check above, so this is safe.
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const messages: SessionHistoryMessage[] = [];

    for (const line of lines) {
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
    line: JsonlMessageLine,
  ): SessionHistoryMessage {
    return {
      type: (line.type ||
        line.message?.role ||
        'unknown') as SessionHistoryMessage['type'],
      subtype: line.subtype,
      uuid: line.uuid,
      sessionId: line.sessionId,
      timestamp: line.timestamp,
      isMeta: line.isMeta,
      slug: line.slug,
      message: line.message as SessionHistoryMessage['message'],
      // Preserve model from system init messages for dashboard display
      model: line.model,
      // Preserve usage stats for later aggregation
      usage: line.message?.usage,
    };
  }

  /**
   * Load agent session files (agent-*.jsonl) for a parent session.
   *
   * Agent files can be stored in two locations (SDK version dependent):
   * 1. Legacy: {sessionsDir}/agent-{id}.jsonl (flat, same directory as main session)
   * 2. Current: {sessionsDir}/{parentSessionId}/subagents/agent-{id}.jsonl (nested)
   *
   * Each agent file contains messages from a subagent spawned by Task tool.
   * Files are filtered to only include agents belonging to the parent session.
   *
   * @param sessionsDir - Path to the sessions directory
   * @param parentSessionId - ID of the parent session to filter by
   * @returns Array of agent session data
   */
  async loadAgentSessions(
    sessionsDir: string,
    parentSessionId: string,
  ): Promise<AgentSessionData[]> {
    const agentSessions: AgentSessionData[] = [];

    // Collect agent files from both legacy flat layout and current nested layout
    const agentFilePaths: { filePath: string; agentId: string }[] = [];

    // 1. Check nested layout: {sessionsDir}/{parentSessionId}/subagents/
    const subagentsDir = path.join(sessionsDir, parentSessionId, 'subagents');
    try {
      const subagentFiles = await fs.readdir(subagentsDir);
      const agentFiles = subagentFiles.filter(
        (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
      );
      for (const file of agentFiles) {
        agentFilePaths.push({
          filePath: path.join(subagentsDir, file),
          agentId: file.replace('.jsonl', ''),
        });
      }
    } catch {
      // Nested subagents directory doesn't exist - try legacy layout
    }

    // 2. Check legacy flat layout: {sessionsDir}/agent-*.jsonl
    if (agentFilePaths.length === 0) {
      try {
        const files = await fs.readdir(sessionsDir);
        const agentFiles = files.filter(
          (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
        );
        for (const file of agentFiles) {
          agentFilePaths.push({
            filePath: path.join(sessionsDir, file),
            agentId: file.replace('.jsonl', ''),
          });
        }
      } catch {
        // Directory not readable
      }
    }

    this.logger.info('[JsonlReader] Scanning for agent files', {
      sessionsDir,
      parentSessionId,
      agentFilesFound: agentFilePaths.length,
      source:
        agentFilePaths.length > 0 &&
        agentFilePaths[0].filePath.includes('subagents')
          ? 'nested'
          : 'legacy',
    });

    for (const { filePath, agentId } of agentFilePaths) {
      try {
        const messages = await this.readJsonlMessages(filePath);

        // For nested layout, all files in the session's subagents dir belong to it.
        // For legacy layout, check sessionId in first message.
        const isNested = filePath.includes(
          path.join(parentSessionId, 'subagents'),
        );
        const firstMsg = messages[0];

        if (isNested || firstMsg?.sessionId === parentSessionId) {
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

    return agentSessions;
  }
}
