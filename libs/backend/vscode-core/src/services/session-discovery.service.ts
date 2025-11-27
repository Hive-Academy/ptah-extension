/**
 * Session Discovery Service
 *
 * Handles discovery and metadata extraction for Claude CLI sessions.
 * Extracted from RpcMethodRegistrationService for better separation of concerns.
 *
 * Responsibilities:
 * - Find sessions directory for a workspace
 * - List all user-initiated sessions (excluding internal/system sessions)
 * - Extract session metadata (title, message count, branch)
 * - Find linked agent sessions for hierarchical display
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import type { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';

/**
 * Session metadata extracted from JSONL files
 */
export interface SessionMetadata {
  title: string | null;
  messageCount: number;
  branch: string | null;
  isUserSession: boolean;
}

/**
 * Session summary for list display
 */
export interface SessionSummary {
  id: string;
  name: string;
  lastActivityAt: number;
  createdAt: number;
  messageCount: number;
  branch: string | null;
  isUserSession: boolean;
}

/**
 * Linked agent session data
 */
export interface LinkedAgentSession {
  agentId: string;
  messages: any[];
}

/**
 * Full session data with messages and linked agents
 */
export interface SessionData {
  sessionId: string;
  messages: any[];
  agentSessions: LinkedAgentSession[];
}

@injectable()
export class SessionDiscoveryService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * List all user-initiated sessions for a workspace
   *
   * Filters out:
   * - Agent sessions (agent-*.jsonl files)
   * - Empty sessions (0 messages)
   * - Internal/system sessions (isMeta=true or Caveat: prefix)
   *
   * @param workspacePath - The workspace path from VS Code
   * @param limit - Maximum number of sessions to return (default: 10)
   * @param offset - Number of sessions to skip for pagination (default: 0)
   * @returns Object with sessions array, total count, and hasMore flag
   */
  async listSessions(
    workspacePath: string,
    limit = 10,
    offset = 0
  ): Promise<{ sessions: SessionSummary[]; total: number; hasMore: boolean }> {
    const sessionsDir = await this.findSessionsDirectory(workspacePath);

    if (!sessionsDir) {
      this.logger.debug('No sessions directory found for workspace', {
        workspacePath,
      });
      return { sessions: [], total: 0, hasMore: false };
    }

    try {
      const files = await fs.readdir(sessionsDir);

      // Filter to only main sessions (UUID format), exclude agent-* files
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
      const mainSessionFiles = files.filter((f) => uuidPattern.test(f));

      this.logger.debug('Session files filtered', {
        total: files.filter((f) => f.endsWith('.jsonl')).length,
        mainSessions: mainSessionFiles.length,
        agentSessions: files.filter((f) => f.startsWith('agent-')).length,
      });

      // Extract metadata for all sessions
      const allSessions = await Promise.all(
        mainSessionFiles.map(async (file) => {
          const sessionId = path.basename(file, '.jsonl');
          const filePath = path.join(sessionsDir, file);
          const stats = await fs.stat(filePath);
          const sessionMeta = await this.extractSessionMetadata(filePath);

          return {
            id: sessionId,
            name: sessionMeta.title || `Session ${sessionId.substring(0, 8)}`,
            lastActivityAt: stats.mtime.getTime(),
            createdAt: stats.birthtime.getTime(),
            messageCount: sessionMeta.messageCount,
            branch: sessionMeta.branch,
            isUserSession: sessionMeta.isUserSession,
          };
        })
      );

      // Filter out empty and internal sessions
      const sessions = allSessions.filter(
        (s) => s.messageCount > 0 && s.isUserSession
      );

      // Sort by last activity (most recent first)
      const sortedSessions = sessions.sort(
        (a, b) => b.lastActivityAt - a.lastActivityAt
      );

      // Apply pagination
      const total = sortedSessions.length;
      const paginatedSessions = sortedSessions.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      this.logger.debug('Sessions filtered and paginated', {
        total: allSessions.length,
        withMessages: allSessions.filter((s) => s.messageCount > 0).length,
        userSessions: sessions.length,
        filtered: allSessions.length - sessions.length,
        offset,
        limit,
        returned: paginatedSessions.length,
        hasMore,
      });

      return { sessions: paginatedSessions, total, hasMore };
    } catch (error) {
      this.logger.debug('Error reading sessions directory', {
        sessionsDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return { sessions: [], total: 0, hasMore: false };
    }
  }

  /**
   * Load a session with its messages and linked agent sessions
   *
   * @param sessionId - The session UUID
   * @param workspacePath - The workspace path from VS Code
   * @returns Session data with messages and agent sessions
   */
  async loadSession(
    sessionId: string,
    workspacePath: string
  ): Promise<SessionData> {
    const sessionsDir = await this.findSessionsDirectory(workspacePath);

    if (!sessionsDir) {
      throw new Error('Sessions directory not found for workspace');
    }

    const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

    // Read and parse main session JSONL file
    const content = await fs.readFile(sessionFile, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    const mainMessages = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Find all agent sessions that belong to this main session
    const agentSessions = await this.findLinkedAgentSessions(
      sessionsDir,
      sessionId
    );

    this.logger.debug('Session loaded with agent sessions', {
      sessionId,
      mainMessageCount: mainMessages.length,
      linkedAgentCount: agentSessions.length,
    });

    return {
      sessionId,
      messages: mainMessages,
      agentSessions,
    };
  }

  /**
   * Find the Claude CLI sessions directory for a workspace
   *
   * Claude CLI stores sessions in ~/.claude/projects/<escaped-path>/
   * The path escaping algorithm has varied between versions and may have
   * inconsistent casing. This method uses a robust matching strategy.
   *
   * @param workspacePath - The workspace path from VS Code
   * @returns The full path to the sessions directory, or null if not found
   */
  async findSessionsDirectory(workspacePath: string): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    // Check if projects directory exists
    try {
      await fs.access(projectsDir);
    } catch {
      this.logger.debug('Claude projects directory does not exist', {
        projectsDir,
      });
      return null;
    }

    // Generate the escaped path pattern (replace : and /\ with -)
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

    // List all project directories
    const dirs = await fs.readdir(projectsDir);

    // Try exact match first (case-sensitive)
    if (dirs.includes(escapedPath)) {
      return path.join(projectsDir, escapedPath);
    }

    // Try lowercase match
    const lowerEscaped = escapedPath.toLowerCase();
    const lowerMatch = dirs.find((d) => d.toLowerCase() === lowerEscaped);
    if (lowerMatch) {
      return path.join(projectsDir, lowerMatch);
    }

    // Try without leading hyphen (some paths may start differently)
    const withoutLeading = escapedPath.replace(/^-+/, '');
    const withoutLeadingLower = withoutLeading.toLowerCase();
    const partialMatch = dirs.find(
      (d) =>
        d.toLowerCase() === withoutLeadingLower ||
        d.toLowerCase().endsWith(withoutLeadingLower)
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    this.logger.debug('No matching sessions directory found', {
      workspacePath,
      escapedPath,
      availableDirs: dirs.slice(0, 10),
    });

    return null;
  }

  /**
   * Extract metadata from a session JSONL file
   *
   * @param filePath - Full path to the .jsonl session file
   */
  async extractSessionMetadata(filePath: string): Promise<SessionMetadata> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      let title: string | null = null;
      let branch: string | null = null;
      let messageCount = 0;
      let isUserSession = true;
      let foundFirstUserMessage = false;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);

          // Count user and assistant messages
          if (msg.type === 'user' || msg.type === 'assistant') {
            messageCount++;
          }

          // Check if first user message is a meta/system message
          if (!foundFirstUserMessage && msg.type === 'user') {
            foundFirstUserMessage = true;

            // Check for isMeta flag - indicates system-generated message
            if (msg.isMeta === true) {
              isUserSession = false;
            }

            // Also check if content starts with known system prefixes
            const msgContent = msg.message?.content;
            const textContent =
              typeof msgContent === 'string'
                ? msgContent
                : Array.isArray(msgContent)
                ? msgContent
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text)
                    .join(' ')
                : '';

            if (textContent.startsWith('Caveat:')) {
              isUserSession = false;
            }
          }

          // Extract title from first REAL user message
          if (
            !title &&
            msg.type === 'user' &&
            msg.message?.content &&
            msg.isMeta !== true
          ) {
            const content = msg.message.content;
            const textContent =
              typeof content === 'string'
                ? content
                : Array.isArray(content)
                ? content
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text)
                    .join(' ')
                : '';

            if (!textContent.startsWith('Caveat:')) {
              title = textContent.split('\n')[0].substring(0, 100);
              if (textContent.length > 100) {
                title += '...';
              }
            }
          }

          // Extract branch from gitStatus in system message
          if (!branch && msg.type === 'system' && msg.gitStatus) {
            const branchMatch = msg.gitStatus.match(
              /(?:On branch|branch[:\s]+)([^\s\n]+)/i
            );
            if (branchMatch) {
              branch = branchMatch[1];
            }
          }
        } catch {
          // Skip malformed JSON lines
        }
      }

      return { title, messageCount, branch, isUserSession };
    } catch (error) {
      this.logger.debug('Failed to extract session metadata', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        title: null,
        messageCount: 0,
        branch: null,
        isUserSession: false,
      };
    }
  }

  /**
   * Find all agent sessions linked to a main session
   *
   * @param sessionsDir - Directory containing session files
   * @param mainSessionId - The main session UUID to find agents for
   * @returns Array of agent sessions with their messages
   */
  async findLinkedAgentSessions(
    sessionsDir: string,
    mainSessionId: string
  ): Promise<LinkedAgentSession[]> {
    try {
      const files = await fs.readdir(sessionsDir);
      const agentFiles = files.filter((f) => f.startsWith('agent-'));

      const linkedAgents: LinkedAgentSession[] = [];

      for (const agentFile of agentFiles) {
        try {
          const agentPath = path.join(sessionsDir, agentFile);
          const content = await fs.readFile(agentPath, 'utf-8');
          const lines = content.split('\n').filter((line) => line.trim());

          if (lines.length === 0) continue;

          const firstMsg = JSON.parse(lines[0]);

          // Agent sessions have sessionId pointing to parent main session
          if (firstMsg.sessionId === mainSessionId) {
            const agentId =
              firstMsg.agentId ||
              agentFile.replace('agent-', '').replace('.jsonl', '');

            const messages = lines
              .map((line) => {
                try {
                  return JSON.parse(line);
                } catch {
                  return null;
                }
              })
              .filter(Boolean);

            linkedAgents.push({ agentId, messages });

            this.logger.debug('Found linked agent session', {
              agentId,
              mainSessionId,
              messageCount: messages.length,
            });
          }
        } catch {
          // Skip files that can't be parsed
        }
      }

      return linkedAgents;
    } catch (error) {
      this.logger.debug('Error finding linked agent sessions', {
        mainSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
