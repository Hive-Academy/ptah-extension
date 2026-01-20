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
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
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
  JsonlMessageLine,
} from './helpers/history/history.types';

// ============================================================================
// SERVICE
// ============================================================================

@injectable()
export class SessionHistoryReaderService {
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
      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return [];
      }

      // Read main session file directly
      const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
      const messages: {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
      }[] = [];

      // Read file line by line using streaming for large files
      const fileStream = createReadStream(sessionFile, { encoding: 'utf-8' });
      const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

      try {
        for await (const line of rl) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line) as JsonlMessageLine;

            // Skip non-message lines (summary, meta)
            if (!parsed.message?.role) continue;

            const role = parsed.message.role;
            if (role !== 'user' && role !== 'assistant') continue;

            // Extract text content using event factory utility
            const content = this.eventFactory.extractTextContent(
              parsed.message.content
            );
            if (!content) continue;

            const timestamp = parsed.timestamp
              ? new Date(parsed.timestamp).getTime()
              : Date.now();

            messages.push({
              id: parsed.uuid || this.eventFactory.generateId(),
              role: role as 'user' | 'assistant',
              content,
              timestamp,
            });
          } catch {
            // Skip malformed lines
            continue;
          }
        }
      } finally {
        rl.close();
        fileStream.destroy();
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
