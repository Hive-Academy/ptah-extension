/**
 * SessionLoaderService - Session List Management and Pagination
 *
 * Extracted from ChatStore to handle session-related operations:
 * - Loading sessions list from backend
 * - Pagination of sessions
 * - Switching sessions (loading details)
 * - Managing pending session resolutions
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 *
 * TASK_2025_086 FIX: Handles both legacy ExecutionNode format AND new
 * FlatStreamEventUnion format in stored messages. The backend stores raw
 * streaming events, which this service reconstructs into proper messages.
 */

import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ChatSessionSummary,
  SessionId,
  ExecutionChatMessage,
  ExecutionNode,
  createExecutionChatMessage,
  createExecutionNode,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { SessionManager } from '../session-manager.service';
import { TabManagerService } from '../tab-manager.service';

/**
 * StoredSessionMessage format from SDK backend storage
 * This is the format returned by session:load RPC when using SDK path
 *
 * IMPORTANT (TASK_2025_086):
 * The `content` field may contain EITHER:
 * - ExecutionNode[] (legacy format - has `type` field)
 * - FlatStreamEventUnion[] (SDK format - has `eventType` field)
 *
 * This happens because stream-transformer.ts stores raw streaming events.
 * The session loader must detect and handle both formats.
 */
interface StoredSessionMessage {
  readonly id: string;
  readonly parentId: string | null;
  readonly role: 'user' | 'assistant' | 'system';
  /** May be ExecutionNode[] or FlatStreamEventUnion[] depending on storage path */
  readonly content: (ExecutionNode | FlatStreamEventUnion)[];
  readonly timestamp: number;
  readonly model: string;
  readonly tokens?: { input: number; output: number };
  readonly cost?: number;
}

@Injectable({ providedIn: 'root' })
export class SessionLoaderService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  private readonly _sessions = signal<readonly ChatSessionSummary[]>([]);
  private readonly _hasMoreSessions = signal(false);
  private readonly _totalSessions = signal(0);
  private readonly _sessionsOffset = signal(0);
  private readonly _isLoadingMoreSessions = signal(false);

  // Page size constant
  private static readonly SESSIONS_PAGE_SIZE = 10;

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly sessions = this._sessions.asReadonly();
  readonly hasMoreSessions = this._hasMoreSessions.asReadonly();
  readonly totalSessions = this._totalSessions.asReadonly();
  readonly isLoadingMoreSessions = this._isLoadingMoreSessions.asReadonly();

  // ============================================================================
  // SESSION LOADING & PAGINATION
  // ============================================================================

  /**
   * Load sessions from backend via RPC (with pagination)
   * Resets pagination and loads first page
   */
  async loadSessions(): Promise<void> {
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // Reset pagination state
      this._sessionsOffset.set(0);

      const result = await this.claudeRpcService.call('session:list', {
        workspacePath,
        limit: SessionLoaderService.SESSIONS_PAGE_SIZE,
        offset: 0,
      });

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(result.data.sessions.length);
        console.log(
          '[SessionLoaderService] Loaded sessions:',
          result.data.sessions.length,
          'of',
          result.data.total
        );
      } else {
        console.error(
          '[SessionLoaderService] Failed to load sessions:',
          result.error
        );
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to load sessions:', error);
    }
  }

  /**
   * Load more sessions (pagination)
   */
  async loadMoreSessions(): Promise<void> {
    if (!this._hasMoreSessions() || this._isLoadingMoreSessions()) {
      return;
    }

    try {
      this._isLoadingMoreSessions.set(true);

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      const currentOffset = this._sessionsOffset();

      const result = await this.claudeRpcService.call('session:list', {
        workspacePath,
        limit: SessionLoaderService.SESSIONS_PAGE_SIZE,
        offset: currentOffset,
      });

      if (result.success && result.data) {
        // Append new sessions to existing
        this._sessions.update((current) => [
          ...current,
          ...result.data!.sessions,
        ]);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(currentOffset + result.data.sessions.length);
        console.log(
          '[SessionLoaderService] Loaded more sessions:',
          result.data.sessions.length,
          ', total now:',
          this._sessions().length
        );
      } else {
        console.error(
          '[SessionLoaderService] Failed to load more sessions:',
          result.error
        );
      }
    } catch (error) {
      console.error(
        '[SessionLoaderService] Failed to load more sessions:',
        error
      );
    } finally {
      this._isLoadingMoreSessions.set(false);
    }
  }

  // ============================================================================
  // SESSION REMOVAL (TASK_2025_086)
  // ============================================================================

  /**
   * Remove a session from the local list (UI only)
   * Called after successful backend deletion to update UI state
   */
  removeSessionFromList(sessionId: SessionId): void {
    this._sessions.update((current) =>
      current.filter((s) => s.id !== sessionId)
    );
    this._totalSessions.update((count) => Math.max(0, count - 1));
    console.log('[SessionLoaderService] Removed session from list:', sessionId);
  }

  // ============================================================================
  // SESSION SWITCHING
  // ============================================================================

  /**
   * Switch to a different session and load its messages via RPC
   *
   * Uses SDK storage format (StoredSessionMessage[]) which contains
   * already processed ExecutionNodes. This is the only supported format
   * since the SDK migration - the old JSONL format is no longer used.
   */
  async switchSession(sessionId: string): Promise<void> {
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // Load messages for this session via RPC
      // SDK storage returns StoredSessionMessage[] format
      // Note: workspacePath is not needed for session:load, session ID is sufficient
      const result = await this.claudeRpcService.call('session:load', {
        sessionId: sessionId as SessionId,
      });

      if (result.success && result.data) {
        // Cast messages from unknown[] to StoredSessionMessage[]
        const storedMessages = result.data.messages as StoredSessionMessage[];
        console.log(
          '[SessionLoaderService] Loaded session:',
          storedMessages.length,
          'messages'
        );

        // Convert SDK storage format to UI display format
        const messages = this.convertStoredMessages(storedMessages, sessionId);

        // Get session name from the sessions list (global store)
        // This preserves the user-set or auto-generated session name
        const session = this._sessions().find((s) => s.id === sessionId);
        const title = session?.name || sessionId.substring(0, 50);

        const activeTabId = this.tabManager.openSessionTab(sessionId, title);

        // Update tab with loaded messages
        this.tabManager.updateTab(activeTabId, {
          messages,
          streamingState: null,
          status: 'loaded',
          // Use session.name for both title and name to ensure consistency
          title,
          name: title,
        });

        // Update SessionManager state (no node maps needed for SDK storage format)
        this.sessionManager.setNodeMaps({
          agents: new Map(),
          tools: new Map(),
        });
        this.sessionManager.setSessionId(sessionId);
        this.sessionManager.setStatus('loaded');

        console.log(
          '[SessionLoaderService] Loaded',
          messages.length,
          'chat messages'
        );
      } else {
        console.error(
          '[SessionLoaderService] Failed to load session:',
          result.error
        );
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to switch session:', error);
    }
  }

  /**
   * Convert StoredSessionMessage[] to ExecutionChatMessage[]
   *
   * TASK_2025_086 + TASK_2025_088 FIX: Handles storage format issues:
   *
   * OLD BUG: Each streaming event was stored as a SEPARATE message, causing:
   * - 71 messages instead of 2-3
   * - FlatStreamEventUnion format with single event per message
   * - Fragmented display in UI
   *
   * DETECTION: If we have many messages where each contains a single FlatStreamEventUnion,
   * we need to AGGREGATE all events by messageId FIRST, then build proper messages.
   *
   * FORMATS:
   * - ExecutionNode format: Has 'type' field (legacy, correctly stored)
   * - FlatStreamEventUnion format: Has 'eventType' field (may be fragmented)
   */
  private convertStoredMessages(
    storedMessages: StoredSessionMessage[],
    sessionId: string
  ): ExecutionChatMessage[] {
    console.log(
      '[SessionLoaderService] Converting',
      storedMessages.length,
      'stored messages'
    );

    // Filter to chat messages only
    const chatMessages = storedMessages.filter(
      (msg) => msg.role === 'user' || msg.role === 'assistant'
    );

    if (chatMessages.length === 0) {
      return [];
    }

    // TASK_2025_088: Detect if we have fragmented flat events that need aggregation
    // Fragmented = many messages where each contains a single FlatStreamEventUnion
    const flatEventMessages = chatMessages.filter((msg) => {
      if (!msg.content || msg.content.length === 0) return false;
      return 'eventType' in msg.content[0];
    });

    const executionNodeMessages = chatMessages.filter((msg) => {
      if (!msg.content || msg.content.length === 0) return false;
      return 'type' in msg.content[0] && !('eventType' in msg.content[0]);
    });

    // Heuristic: If >10 flat event messages and most have single event = fragmented
    const isFragmented =
      flatEventMessages.length > 10 &&
      flatEventMessages.filter((m) => m.content.length === 1).length >
        flatEventMessages.length * 0.7;

    console.log(
      `[SessionLoaderService] Format analysis: ${flatEventMessages.length} flat event msgs, ${executionNodeMessages.length} execution node msgs, fragmented=${isFragmented}`
    );

    if (isFragmented) {
      // AGGREGATION PATH: Old corrupted data - aggregate all flat events by messageId
      console.log(
        '[SessionLoaderService] Using AGGREGATION path for fragmented flat events'
      );
      const aggregatedMessages = this.convertFlatEventsToMessages(
        flatEventMessages,
        sessionId
      );

      // Also convert any ExecutionNode messages
      const legacyMessages: ExecutionChatMessage[] = [];
      for (const stored of executionNodeMessages) {
        const nodes = stored.content as ExecutionNode[];
        const converted = this.convertSingleLegacyMessage(
          stored,
          nodes,
          sessionId
        );
        if (converted) {
          legacyMessages.push(converted);
        }
      }

      const allMessages = [...aggregatedMessages, ...legacyMessages];
      allMessages.sort((a, b) => a.timestamp - b.timestamp);

      console.log(
        `[SessionLoaderService] Aggregated ${flatEventMessages.length} fragmented messages into ${aggregatedMessages.length} proper messages`
      );
      return allMessages;
    }

    // NORMAL PATH: Process each message individually (new correct format)
    const messages: ExecutionChatMessage[] = [];

    for (const stored of chatMessages) {
      if (!stored.content || stored.content.length === 0) {
        continue;
      }

      // Detect format for THIS message by checking its content
      const firstContent = stored.content[0];
      const isFlatEventFormat = 'eventType' in firstContent;

      if (isFlatEventFormat) {
        // FlatStreamEventUnion format - convert events to ExecutionNode tree
        const events = stored.content as FlatStreamEventUnion[];
        const converted = this.convertSingleFlatEventMessage(
          stored,
          events,
          sessionId
        );
        if (converted) {
          messages.push(converted);
        }
      } else {
        // ExecutionNode format - use directly
        const nodes = stored.content as ExecutionNode[];
        const converted = this.convertSingleLegacyMessage(
          stored,
          nodes,
          sessionId
        );
        if (converted) {
          messages.push(converted);
        }
      }
    }

    // Sort by timestamp
    messages.sort((a, b) => a.timestamp - b.timestamp);

    console.log(
      '[SessionLoaderService] Converted to',
      messages.length,
      'chat messages'
    );
    return messages;
  }

  /**
   * Convert a single message with FlatStreamEventUnion[] content
   */
  private convertSingleFlatEventMessage(
    stored: StoredSessionMessage,
    events: FlatStreamEventUnion[],
    sessionId: string
  ): ExecutionChatMessage | null {
    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    // Find message_complete for metrics
    const completeEvent = sortedEvents.find(
      (e) => e.eventType === 'message_complete'
    );
    const tokens =
      completeEvent && 'tokenUsage' in completeEvent
        ? completeEvent.tokenUsage
        : stored.tokens;
    const cost =
      completeEvent && 'cost' in completeEvent
        ? (completeEvent.cost as number)
        : stored.cost;

    if (stored.role === 'user') {
      // User messages: aggregate text_delta events
      const textDeltas = sortedEvents.filter(
        (e) => e.eventType === 'text_delta'
      );
      const rawContent = textDeltas
        .map((e) => ('delta' in e ? e.delta : ''))
        .join('');

      return createExecutionChatMessage({
        id: stored.id,
        role: 'user',
        rawContent: rawContent || '(user message)',
        sessionId,
        timestamp: stored.timestamp,
      });
    } else {
      // Assistant messages: build ExecutionNode tree from events
      const children = this.buildExecutionNodesFromEvents(sortedEvents);

      // Only create message if there's content
      if (children.length === 0) {
        console.log(
          '[SessionLoaderService] Skipping empty assistant message:',
          stored.id
        );
        return null;
      }

      const streamingState = createExecutionNode({
        id: stored.id,
        type: 'message',
        status: 'complete',
        children,
      });

      return createExecutionChatMessage({
        id: stored.id,
        role: 'assistant',
        streamingState,
        sessionId,
        timestamp: stored.timestamp,
        tokens,
        cost,
      });
    }
  }

  /**
   * Convert a single message with ExecutionNode[] content (legacy format)
   */
  private convertSingleLegacyMessage(
    stored: StoredSessionMessage,
    content: ExecutionNode[],
    sessionId: string
  ): ExecutionChatMessage | null {
    if (stored.role === 'user') {
      // User message: extract text content from ExecutionNode[]
      const textContent = content
        .filter((node) => node.type === 'text')
        .map((node) => node.content || '')
        .join('\n');

      return createExecutionChatMessage({
        id: stored.id,
        role: 'user',
        rawContent: textContent || '(user message)',
        sessionId,
        timestamp: stored.timestamp,
      });
    } else {
      // Assistant message: filter out system type nodes from content
      const filteredContent = content.filter((node) => node.type !== 'system');

      // Only create message if there's actual content
      if (filteredContent.length === 0) {
        return null;
      }

      // Wrap ExecutionNode[] in a root node
      const streamingState = createExecutionNode({
        id: stored.id,
        type: 'message',
        status: 'complete',
        children: filteredContent,
      });

      return createExecutionChatMessage({
        id: stored.id,
        role: 'assistant',
        streamingState,
        sessionId,
        timestamp: stored.timestamp,
        tokens: stored.tokens,
        cost: stored.cost,
      });
    }
  }

  /**
   * Convert FlatStreamEventUnion format to ExecutionChatMessage[]
   *
   * The backend stores each streaming event as a separate "message".
   * We need to:
   * 1. Group events by messageId
   * 2. Aggregate text_delta into full text
   * 3. Build proper ExecutionNode trees
   */
  private convertFlatEventsToMessages(
    storedMessages: StoredSessionMessage[],
    sessionId: string
  ): ExecutionChatMessage[] {
    // Collect all flat events from all stored messages
    const allEvents: FlatStreamEventUnion[] = [];
    for (const stored of storedMessages) {
      for (const item of stored.content) {
        if ('eventType' in item) {
          allEvents.push(item as FlatStreamEventUnion);
        }
      }
    }

    console.log(
      '[SessionLoaderService] Collected',
      allEvents.length,
      'flat events'
    );

    // Group events by messageId
    const eventsByMessage = new Map<string, FlatStreamEventUnion[]>();
    for (const event of allEvents) {
      const msgId = event.messageId;
      if (!eventsByMessage.has(msgId)) {
        eventsByMessage.set(msgId, []);
      }
      eventsByMessage.get(msgId)!.push(event);
    }

    console.log(
      '[SessionLoaderService] Grouped into',
      eventsByMessage.size,
      'messages'
    );

    // Convert each message group to ExecutionChatMessage
    const messages: ExecutionChatMessage[] = [];

    for (const [messageId, events] of eventsByMessage) {
      // Sort events by timestamp
      events.sort((a, b) => a.timestamp - b.timestamp);

      // Find message_start to determine role
      const startEvent = events.find((e) => e.eventType === 'message_start');
      const role =
        startEvent && 'role' in startEvent
          ? startEvent.role
          : ('assistant' as const);

      // Get timestamp from first event
      const timestamp = events[0]?.timestamp || Date.now();

      // Find message_complete for metrics
      const completeEvent = events.find(
        (e) => e.eventType === 'message_complete'
      );
      const tokens =
        completeEvent && 'tokenUsage' in completeEvent
          ? completeEvent.tokenUsage
          : undefined;
      const cost =
        completeEvent && 'cost' in completeEvent
          ? (completeEvent.cost as number)
          : undefined;

      if (role === 'user') {
        // User messages: aggregate text_delta events
        const textDeltas = events.filter((e) => e.eventType === 'text_delta');
        const rawContent = textDeltas
          .map((e) => ('delta' in e ? e.delta : ''))
          .join('');

        messages.push(
          createExecutionChatMessage({
            id: messageId,
            role: 'user',
            rawContent: rawContent || '(user message)',
            sessionId,
            timestamp,
          })
        );
      } else {
        // Assistant messages: build ExecutionNode tree from events
        const children = this.buildExecutionNodesFromEvents(events);

        // Only create message if there's content
        if (children.length === 0) {
          console.log(
            '[SessionLoaderService] Skipping empty assistant message:',
            messageId
          );
          continue;
        }

        const streamingState = createExecutionNode({
          id: messageId,
          type: 'message',
          status: 'complete',
          children,
        });

        messages.push(
          createExecutionChatMessage({
            id: messageId,
            role: 'assistant',
            streamingState,
            sessionId,
            timestamp,
            tokens,
            cost,
          })
        );
      }
    }

    // Sort by timestamp
    messages.sort((a, b) => a.timestamp - b.timestamp);

    console.log(
      '[SessionLoaderService] Converted to',
      messages.length,
      'chat messages'
    );
    return messages;
  }

  /**
   * Build ExecutionNode[] from flat events for a single message
   */
  private buildExecutionNodesFromEvents(
    events: FlatStreamEventUnion[]
  ): ExecutionNode[] {
    const nodes: ExecutionNode[] = [];

    // Aggregate text by blockIndex
    const textBlocks = new Map<number, string>();
    const thinkingBlocks = new Map<number, string>();
    const toolNodes = new Map<string, ExecutionNode>();

    for (const event of events) {
      switch (event.eventType) {
        case 'text_delta': {
          const idx = event.blockIndex ?? 0;
          const existing = textBlocks.get(idx) || '';
          textBlocks.set(idx, existing + event.delta);
          break;
        }
        case 'thinking_start': {
          const idx = event.blockIndex ?? 0;
          if (!thinkingBlocks.has(idx)) {
            thinkingBlocks.set(idx, '');
          }
          break;
        }
        case 'thinking_delta': {
          const idx = event.blockIndex ?? 0;
          const existing = thinkingBlocks.get(idx) || '';
          thinkingBlocks.set(idx, existing + event.delta);
          break;
        }
        case 'tool_start': {
          const toolId = event.toolCallId;
          toolNodes.set(
            toolId,
            createExecutionNode({
              id: toolId,
              type: event.isTaskTool ? 'agent' : 'tool',
              status: 'streaming',
              toolName: event.toolName,
              toolInput: event.toolInput,
              toolCallId: toolId,
              agentType: event.agentType,
              agentDescription: event.agentDescription,
            })
          );
          break;
        }
        case 'tool_result': {
          const toolId = event.toolCallId;
          const existing = toolNodes.get(toolId);
          if (existing) {
            toolNodes.set(toolId, {
              ...existing,
              status: event.isError ? 'error' : 'complete',
              toolOutput: event.output,
              error: event.isError ? String(event.output) : undefined,
              isPermissionRequest: event.isPermissionRequest,
            });
          }
          break;
        }
        // Skip other event types (message_start, message_complete handled above)
      }
    }

    // Build thinking nodes first
    for (const [idx, content] of thinkingBlocks) {
      if (content) {
        nodes.push(
          createExecutionNode({
            id: `thinking-${idx}`,
            type: 'thinking',
            status: 'complete',
            content,
          })
        );
      }
    }

    // Build text nodes
    for (const [idx, content] of textBlocks) {
      if (content) {
        nodes.push(
          createExecutionNode({
            id: `text-${idx}`,
            type: 'text',
            status: 'complete',
            content,
          })
        );
      }
    }

    // Add tool nodes
    for (const [, node] of toolNodes) {
      nodes.push(node);
    }

    return nodes;
  }

  /**
   * Convert legacy ExecutionNode format to ExecutionChatMessage[]
   * (Original implementation for backwards compatibility)
   */
  private convertLegacyNodesToMessages(
    storedMessages: StoredSessionMessage[],
    sessionId: string
  ): ExecutionChatMessage[] {
    // Filter out system role messages (metadata, not chat content)
    const chatMessages = storedMessages.filter(
      (msg) => msg.role === 'user' || msg.role === 'assistant'
    );

    return chatMessages
      .map((stored) => {
        // Type assertion for legacy format
        const content = stored.content as ExecutionNode[];

        if (stored.role === 'user') {
          // User message: extract text content from ExecutionNode[]
          const textContent = content
            .filter((node) => node.type === 'text')
            .map((node) => node.content || '')
            .join('\n');

          return createExecutionChatMessage({
            id: stored.id,
            role: 'user',
            rawContent: textContent,
            sessionId,
            timestamp: stored.timestamp,
          });
        } else {
          // Assistant message: filter out system type nodes from content
          const filteredContent = content.filter(
            (node) => node.type !== 'system'
          );

          // Only create message if there's actual content
          if (filteredContent.length === 0) {
            return null;
          }

          // Wrap ExecutionNode[] in a root node
          const streamingState = createExecutionNode({
            id: stored.id,
            type: 'message',
            status: 'complete',
            children: filteredContent,
          });

          return createExecutionChatMessage({
            id: stored.id,
            role: 'assistant',
            streamingState,
            sessionId,
            timestamp: stored.timestamp,
            tokens: stored.tokens,
            cost: stored.cost,
          });
        }
      })
      .filter((msg): msg is ExecutionChatMessage => msg !== null);
  }

  // ============================================================================
  // SESSION ID RESOLUTION
  // ============================================================================
}
