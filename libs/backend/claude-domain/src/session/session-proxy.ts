/**
 * SessionProxy - Thin wrapper around .claude_sessions/ file system
 * Pattern: Follows ClaudeCliDetector file system operations (detector/claude-cli-detector.ts:120-180)
 *
 * **Responsibilities**:
 * - Read session metadata from .claude_sessions/ directory
 * - Parse session JSON files to extract SessionSummary
 * - No caching: Always read from file system (source of truth)
 * - Graceful error handling for missing/corrupt files
 *
 * **Design Principles**:
 * - Stateless: No internal caching
 * - Single source of truth: .claude_sessions/ is authoritative
 * - Performance: < 100ms for listing 50 sessions
 * - Resilience: Skip corrupt files, never throw on missing directory
 *
 * @example
 * ```typescript
 * const sessionProxy = container.resolve(SessionProxy);
 *
 * // List all sessions
 * const sessions = await sessionProxy.listSessions();
 * // Returns: SessionSummary[] sorted by lastActiveAt (newest first)
 *
 * // Get specific session details
 * const session = await sessionProxy.getSessionDetails('session-id-123');
 * // Returns: Full session JSON or null if not found
 * ```
 */

import { injectable } from 'tsyringe';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionSummary, SessionSummarySchema } from '@ptah-extension/shared';

/**
 * SessionProxy Service
 * Provides read-only access to Claude CLI session files
 */
@injectable()
export class SessionProxy {
  /**
   * List all sessions from .claude_sessions/ directory
   *
   * @param workspaceRoot - Optional workspace root to override default .claude_sessions/ location
   * @returns Array of SessionSummary sorted by lastActiveAt (newest first)
   *
   * Performance: < 100ms for 50 sessions
   * Error Handling: Returns [] if directory doesn't exist or is empty
   *
   * @example
   * ```typescript
   * const sessions = await sessionProxy.listSessions();
   * console.log(`Found ${sessions.length} sessions`);
   * ```
   */
  async listSessions(workspaceRoot?: string): Promise<SessionSummary[]> {
    try {
      const sessionsDir = this.getSessionsDirectory(workspaceRoot);

      // Check if directory exists
      try {
        await fs.access(sessionsDir);
      } catch {
        // Directory doesn't exist - return empty array (not an error)
        return [];
      }

      // Read all files in .claude_sessions/
      const files = await fs.readdir(sessionsDir);
      const sessionFiles = files.filter((f) => f.endsWith('.json'));

      if (sessionFiles.length === 0) {
        return [];
      }

      // Parse all session files
      const sessions = await this.parseSessionFiles(sessionFiles, sessionsDir);

      // Sort by lastActiveAt (newest first)
      return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    } catch (error) {
      // Log error but return empty array (graceful degradation)
      console.error('SessionProxy.listSessions failed:', error);
      return [];
    }
  }

  /**
   * Get detailed session data for a specific session
   *
   * @param sessionId - Session ID (filename without .json)
   * @param workspaceRoot - Optional workspace root
   * @returns Full session JSON or null if not found
   *
   * Error Handling: Returns null if file doesn't exist or is corrupt
   *
   * @example
   * ```typescript
   * const session = await sessionProxy.getSessionDetails('abc-123-def');
   * if (session) {
   *   console.log(`Session has ${session.messages.length} messages`);
   * }
   * ```
   */
  async getSessionDetails(
    sessionId: string,
    workspaceRoot?: string
  ): Promise<any | null> {
    try {
      const sessionsDir = this.getSessionsDirectory(workspaceRoot);
      const filePath = path.join(sessionsDir, `${sessionId}.json`);

      // Read file
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse JSON
      const session = JSON.parse(content);
      return session;
    } catch (error) {
      // File doesn't exist or is corrupt - return null
      return null;
    }
  }

  /**
   * Get .claude_sessions/ directory path
   *
   * @private
   * @param workspaceRoot - Optional workspace root (defaults to user home directory)
   * @returns Absolute path to .claude_sessions/ directory
   *
   * Pattern: Follows ClaudeCliDetector.findExecutable pattern (detector:120-180)
   *
   * @example
   * ```typescript
   * // Default: C:\Users\<user>\.claude_sessions\
   * const dir = this.getSessionsDirectory();
   *
   * // With workspace root: D:\projects\my-app\.claude_sessions\
   * const dir = this.getSessionsDirectory('D:\\projects\\my-app');
   * ```
   */
  private getSessionsDirectory(workspaceRoot?: string): string {
    if (workspaceRoot) {
      return path.join(workspaceRoot, '.claude_sessions');
    }

    // Default: user home directory
    const homeDir = os.homedir();
    return path.join(homeDir, '.claude_sessions');
  }

  /**
   * Parse session files and extract SessionSummary metadata
   *
   * @private
   * @param files - Array of filenames (e.g., ['session1.json', 'session2.json'])
   * @param sessionsDir - Absolute path to .claude_sessions/ directory
   * @returns Array of validated SessionSummary objects
   *
   * Error Handling: Skips corrupt files, logs warnings, never throws
   * Validation: Uses SessionSummarySchema for runtime validation
   *
   * @example
   * ```typescript
   * const files = ['session1.json', 'session2.json'];
   * const sessions = await this.parseSessionFiles(files, '/home/user/.claude_sessions');
   * // Returns: [{ id: 'session1', name: '...', ... }, { id: 'session2', ... }]
   * ```
   */
  private async parseSessionFiles(
    files: string[],
    sessionsDir: string
  ): Promise<SessionSummary[]> {
    const sessions: SessionSummary[] = [];

    // Process files in parallel for performance
    const promises = files.map(async (file) => {
      try {
        const filePath = path.join(sessionsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        // Extract metadata
        const sessionId = path.basename(file, '.json');
        const name = data.name || data.sessionName || 'Unnamed Session';
        const messageCount = Array.isArray(data.messages)
          ? data.messages.length
          : 0;
        const createdAt = data.createdAt || data.created_at || Date.now();

        // Calculate last active time
        let lastActiveAt = createdAt;
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          const lastMessage = data.messages[data.messages.length - 1];
          lastActiveAt =
            lastMessage.timestamp || lastMessage.created_at || createdAt;
        }

        // Build SessionSummary
        const summary: SessionSummary = {
          id: sessionId,
          name,
          messageCount,
          lastActiveAt,
          createdAt,
        };

        // Validate with Zod schema
        const validated = SessionSummarySchema.parse(summary);
        return validated;
      } catch (error) {
        // Skip corrupt files - log warning but don't throw
        console.warn(`SessionProxy: Skipping corrupt file ${file}:`, error);
        return null;
      }
    });

    const results = await Promise.all(promises);

    // Filter out nulls (corrupt files)
    return results.filter((s): s is SessionSummary => s !== null);
  }
}
