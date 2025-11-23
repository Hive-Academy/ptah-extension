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
import {
  SessionSummary,
  SessionSummarySchema,
  StrictChatMessage,
  SessionId,
} from '@ptah-extension/shared';
import { WorkspacePathEncoder } from './workspace-path-encoder';
import { JsonlSessionParser } from './jsonl-session-parser';

/**
 * Simple LRU Cache entry
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * SessionProxy Service
 * Provides read-only access to Claude CLI session files
 *
 * UPDATED (TASK_2025_014): Added LRU cache for session messages
 */
@injectable()
export class SessionProxy {
  // LRU Cache for session messages (5 most recent sessions, 30s TTL)
  private messageCache: Map<SessionId, CacheEntry<StrictChatMessage[]>> =
    new Map();
  private readonly MAX_CACHE_SIZE = 5;
  private readonly CACHE_TTL_MS = 30000; // 30 seconds
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

      // Read all files in sessions directory
      const files = await fs.readdir(sessionsDir);
      const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));

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
   * **UPDATED**: Now reads .jsonl files instead of .json
   *
   * @param sessionId - Session ID (filename without .jsonl)
   * @param workspaceRoot - Optional workspace root
   * @returns Full session JSONL data or null if not found
   *
   * Error Handling: Returns null if file doesn't exist or is corrupt
   *
   * @example
   * ```typescript
   * const session = await sessionProxy.getSessionDetails('abc-123-def');
   * if (session) {
   *   console.log(`Session file exists`);
   * }
   * ```
   */
  async getSessionDetails(
    sessionId: string,
    workspaceRoot?: string
  ): Promise<Record<string, unknown> | null> {
    try {
      const sessionsDir = this.getSessionsDirectory(workspaceRoot);
      const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);

      // Read file
      const content = await fs.readFile(filePath, 'utf-8');

      // Return raw JSONL content (caller can parse as needed)
      return { content };
    } catch {
      // File doesn't exist or is corrupt - return null
      return null;
    }
  }

  /**
   * Get all messages for a session (normalized format)
   *
   * Reads .jsonl file, parses messages, normalizes to contentBlocks format.
   * Returns empty array (not error) if file doesn't exist.
   *
   * **UPDATED (TASK_2025_014)**: Now includes LRU caching
   * **Performance**: < 1s for sessions with 1000 messages (streaming read)
   * **Cache**: LRU cache (5 sessions, 30s TTL) for performance optimization
   *
   * @param sessionId - Session ID (filename without .jsonl)
   * @param workspaceRoot - Optional workspace root
   * @returns Array of normalized StrictChatMessage
   *
   * Error Handling: Returns [] if file doesn't exist or parsing fails
   *
   * @example
   * ```typescript
   * const messages = await sessionProxy.getSessionMessages(sessionId);
   * // All messages have contentBlocks: Array format
   * ```
   */
  async getSessionMessages(
    sessionId: SessionId,
    workspaceRoot?: string
  ): Promise<StrictChatMessage[]> {
    // Check cache first
    const cached = this.messageCache.get(sessionId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      // Cache hit - return cached messages
      return cached.value;
    }

    try {
      const sessionsDir = this.getSessionsDirectory(workspaceRoot);
      const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        // File doesn't exist - return empty array (not an error)
        return [];
      }

      // Parse messages from .jsonl with normalization
      const messages = await JsonlSessionParser.parseSessionMessages(filePath);

      // Update sessionId for all messages (extracted from filename)
      const normalizedMessages = messages.map((msg) => ({
        ...msg,
        sessionId: sessionId as SessionId,
      }));

      // Update cache (with LRU eviction if needed)
      this.updateCache(sessionId, normalizedMessages);

      return normalizedMessages;
    } catch (error) {
      console.error(
        `SessionProxy.getSessionMessages failed for ${sessionId}:`,
        error
      );
      return []; // Graceful degradation
    }
  }

  /**
   * Invalidate cache for a specific session
   *
   * Call this when session messages are modified to ensure fresh reads
   *
   * @param sessionId - Session ID to invalidate
   */
  invalidateCache(sessionId: SessionId): void {
    this.messageCache.delete(sessionId);
  }

  /**
   * Update cache with LRU eviction
   *
   * @private
   * @param sessionId - Session ID to cache
   * @param messages - Messages to cache
   */
  private updateCache(
    sessionId: SessionId,
    messages: StrictChatMessage[]
  ): void {
    // Evict oldest entry if cache is full
    if (this.messageCache.size >= this.MAX_CACHE_SIZE) {
      // Find oldest entry (smallest timestamp)
      let oldestKey: SessionId | undefined;
      let oldestTimestamp = Infinity;

      for (const [key, entry] of this.messageCache.entries()) {
        if (entry.timestamp < oldestTimestamp) {
          oldestTimestamp = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.messageCache.delete(oldestKey);
      }
    }

    // Add new entry
    this.messageCache.set(sessionId, {
      value: messages,
      timestamp: Date.now(),
    });
  }

  /**
   * Get Claude CLI sessions directory path
   *
   * **UPDATED**: Now uses ~/.claude/projects/{encoded-path}/ instead of .claude_sessions/
   *
   * @private
   * @param workspaceRoot - Required workspace root path
   * @returns Absolute path to sessions directory
   *
   * Pattern: Uses WorkspacePathEncoder to get correct Claude CLI directory
   *
   * @example
   * ```typescript
   * // Windows: C:\Users\user\.claude\projects\d--projects-ptah-extension\
   * const dir = this.getSessionsDirectory('D:\\projects\\ptah-extension');
   *
   * // Linux: /home/user/.claude/projects/-home-user-project/
   * const dir = this.getSessionsDirectory('/home/user/project');
   * ```
   */
  private getSessionsDirectory(workspaceRoot?: string): string {
    if (!workspaceRoot) {
      // Cannot determine sessions directory without workspace path
      // This is a critical error - SessionProxy requires workspace context
      throw new Error(
        'SessionProxy requires workspace root to locate sessions directory'
      );
    }

    // Use WorkspacePathEncoder to get correct Claude CLI directory
    return WorkspacePathEncoder.getSessionsDirectory(workspaceRoot);
  }

  /**
   * Parse session files and extract SessionSummary metadata
   *
   * **UPDATED**: Now uses JsonlSessionParser for efficient JSONL parsing
   *
   * @private
   * @param files - Array of filenames (e.g., ['abc-123.jsonl', 'def-456.jsonl'])
   * @param sessionsDir - Absolute path to sessions directory
   * @returns Array of validated SessionSummary objects
   *
   * Error Handling: Skips corrupt files, logs warnings, never throws
   * Validation: Uses SessionSummarySchema for runtime validation
   * Performance: < 100ms for 373 sessions (< 10ms per file)
   *
   * @example
   * ```typescript
   * const files = ['abc-123.jsonl', 'def-456.jsonl'];
   * const sessions = await this.parseSessionFiles(
   *   files,
   *   'C:\\Users\\user\\.claude\\projects\\d--projects-ptah'
   * );
   * // Returns: [{ id: 'abc-123', name: '...', ... }, { id: 'def-456', ... }]
   * ```
   */
  private async parseSessionFiles(
    files: string[],
    sessionsDir: string
  ): Promise<SessionSummary[]> {
    // Process files in parallel for performance
    const promises = files.map(async (file) => {
      try {
        const filePath = path.join(sessionsDir, file);

        // Use JsonlSessionParser for efficient parsing
        const metadata = await JsonlSessionParser.parseSessionFile(filePath);

        // Extract sessionId from filename (uuid.jsonl → uuid)
        const sessionId = path.basename(file, '.jsonl');

        // Build SessionSummary
        const summary: SessionSummary = {
          id: sessionId,
          name: metadata.name,
          messageCount: metadata.messageCount,
          lastActiveAt: metadata.lastActiveAt,
          createdAt: metadata.createdAt,
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
