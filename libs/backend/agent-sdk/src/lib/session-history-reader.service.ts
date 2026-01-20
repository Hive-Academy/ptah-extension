/**
 * SessionHistoryReaderService - Facade for session history reading
 *
 * This service provides the public API for reading session history from Claude JSONL files
 * and converting them to FlatStreamEventUnion format. It delegates to specialized child
 * services for the actual work:
 *
 * - JsonlReaderService: File I/O operations (find directory, read JSONL, load agents)
 * - SessionReplayService: Event conversion and sequencing
 * - HistoryEventFactory: Event creation (used for readHistoryAsMessages)
 *
 * Architecture: Facade pattern with injected child services
 * The frontend ExecutionTreeBuilder processes these events exactly as it would
 * live streaming events - no UI changes required.
 *
 * CRITICAL: Public API must remain unchanged:
 * - readSessionHistory(sessionId, workspacePath): Promise<{events, stats}>
 * - readHistoryAsMessages(sessionId, workspacePath): Promise<{id, role, content, timestamp}[]>
 *
 * @see TASK_2025_106 - Session History Reader Refactoring
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  extractTokenUsage,
  estimateCostFromTokens,
} from './helpers/usage-extraction.utils';
import { SDK_TOKENS } from './di/tokens';
import type { JsonlReaderService } from './helpers/history/jsonl-reader.service';
import type { SessionReplayService } from './helpers/history/session-replay.service';
import type { HistoryEventFactory } from './helpers/history/history-event-factory';
import type {
  SessionHistoryMessage,
  AgentSessionData,
} from './helpers/history/history.types';

// ============================================================================
// SERVICE
// ============================================================================

@injectable()
export class SessionHistoryReaderService {
  /**
   * Regex pattern for valid session IDs.
   * Session IDs should only contain alphanumeric characters, underscores, and hyphens.
   * This prevents path traversal attacks (e.g., "../../../etc/passwd").
   */
  private readonly SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonlReader: JsonlReaderService,
    @inject(SDK_TOKENS.SDK_SESSION_REPLAY)
    private readonly replayService: SessionReplayService,
    @inject(SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY)
    private readonly eventFactory: HistoryEventFactory
  ) {}

  /**
   * Validate sessionId to prevent path traversal attacks.
   *
   * @param sessionId - Session identifier to validate
   * @throws Error if sessionId is invalid or contains path traversal characters
   */
  private validateSessionId(sessionId: string): void {
    if (!sessionId || !this.SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error(`Invalid sessionId format: ${sessionId}`);
    }
  }

  /**
   * Read session history and convert to FlatStreamEventUnion events with stats
   *
   * Returns both events for UI rendering and aggregated usage stats from JSONL.
   *
   * @param sessionId - Session identifier
   * @param workspacePath - Workspace path for locating session files
   * @returns Object with events and aggregated stats
   */
  async readSessionHistory(
    sessionId: string,
    workspacePath: string
  ): Promise<{
    events: FlatStreamEventUnion[];
    stats: {
      totalCost: number;
      tokens: {
        input: number;
        output: number;
        cacheRead: number;
        cacheCreation: number;
      };
      messageCount: number;
    } | null;
  }> {
    try {
      // 0. Validate sessionId to prevent path traversal
      this.validateSessionId(sessionId);

      // 1. Find the sessions directory (delegate to jsonlReader)
      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return { events: [], stats: null };
      }

      // 2. Find and verify the session file
      const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
      let mainMessages: SessionHistoryMessage[];
      try {
        mainMessages = await this.jsonlReader.readJsonlMessages(sessionPath);
      } catch {
        this.logger.warn('[SessionHistoryReader] Session file not found', {
          sessionId,
        });
        return { events: [], stats: null };
      }

      // 3. Load agent sessions (delegate to jsonlReader)
      const agentSessions = await this.jsonlReader.loadAgentSessions(
        sessionsDir,
        sessionId
      );

      // 4. Replay and convert to stream events (delegate to replayService)
      const events = this.replayService.replayToStreamEvents(
        sessionId,
        mainMessages,
        agentSessions
      );

      // 5. Aggregate usage stats from all messages (kept in facade - simple utility logic)
      const stats = this.aggregateUsageStats(mainMessages, agentSessions);

      this.logger.info('[SessionHistoryReader] Loaded session with stats', {
        sessionId,
        eventCount: events.length,
        hasStats: !!stats,
        totalCost: stats?.totalCost,
        totalTokens: (stats?.tokens?.input ?? 0) + (stats?.tokens?.output ?? 0),
      });

      return { events, stats };
    } catch (error) {
      this.logger.error(
        '[SessionHistoryReader] Failed to read session history',
        error instanceof Error ? error : new Error(String(error))
      );
      return { events: [], stats: null };
    }
  }

  /**
   * Read session history as simple message objects (for RPC response)
   *
   * This is a simpler method that returns complete messages directly,
   * suitable for returning in the RPC response instead of streaming events.
   *
   * @param sessionId - Session identifier
   * @param workspacePath - Workspace path for locating session files
   * @returns Array of simple message objects
   */
  async readHistoryAsMessages(
    sessionId: string,
    workspacePath: string
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    try {
      // Validate sessionId to prevent path traversal
      this.validateSessionId(sessionId);

      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return [];
      }

      // Delegate JSONL reading to JsonlReaderService
      const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
      const rawMessages = await this.jsonlReader.readJsonlMessages(sessionFile);

      // Transform SessionHistoryMessage to simple message format
      const messages: {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
      }[] = [];

      for (const msg of rawMessages) {
        // Skip non-message lines (summary, meta)
        if (!msg.message?.role) continue;

        const role = msg.message.role;
        if (role !== 'user' && role !== 'assistant') continue;

        // Extract text content using event factory utility
        const content = this.eventFactory.extractTextContent(
          msg.message.content
        );
        if (!content) continue;

        const timestamp = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();

        messages.push({
          id: msg.uuid || this.eventFactory.generateId(),
          role: role as 'user' | 'assistant',
          content,
          timestamp,
        });
      }

      return messages;
    } catch (error) {
      this.logger.error(
        '[SessionHistoryReader] Failed to read history as messages',
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Aggregate usage stats from all session messages
   *
   * Kept in facade because:
   * - Uses existing usage-extraction.utils (not history-specific)
   * - Simple aggregation logic doesn't warrant a separate service
   * - Needs access to both main messages and agent sessions
   */
  private aggregateUsageStats(
    mainMessages: SessionHistoryMessage[],
    agentSessions: AgentSessionData[]
  ): {
    totalCost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    messageCount: number;
  } | null {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let messageCount = 0;
    let hasAnyUsage = false;

    // Aggregate from main session messages
    for (const msg of mainMessages) {
      if (msg.usage) {
        hasAnyUsage = true;
        const tokens = extractTokenUsage(msg.usage);
        if (tokens) {
          totalInput += tokens.input;
          totalOutput += tokens.output;
          totalCacheRead += tokens.cacheRead ?? 0;
          totalCacheCreation += tokens.cacheCreation ?? 0;
        }
      }
      if (msg.type === 'assistant') {
        messageCount++;
      }
    }

    // Aggregate from agent sessions
    for (const agent of agentSessions) {
      for (const msg of agent.messages) {
        if (msg.usage) {
          hasAnyUsage = true;
          const tokens = extractTokenUsage(msg.usage);
          if (tokens) {
            totalInput += tokens.input;
            totalOutput += tokens.output;
            totalCacheRead += tokens.cacheRead ?? 0;
            totalCacheCreation += tokens.cacheCreation ?? 0;
          }
        }
      }
    }

    if (!hasAnyUsage) {
      return null;
    }

    // Estimate cost from tokens
    const totalCost = estimateCostFromTokens({
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheCreation: totalCacheCreation,
    });

    return {
      totalCost,
      tokens: {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheCreation: totalCacheCreation,
      },
      messageCount,
    };
  }
}
