import { Injectable, signal, computed, inject } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import {
  ExecutionNode,
  FlatStreamEventUnion,
  PermissionRequest,
  PermissionResponse,
  SessionId,
  MESSAGE_TYPES,
} from '@ptah-extension/shared';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResponse,
} from '@ptah-extension/shared';
import { SessionManager } from './session-manager.service';
import { TabManagerService } from './tab-manager.service';
import { StreamingHandlerService } from './chat-store/streaming-handler.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { ConversationService } from './chat-store/conversation.service';
import { PermissionHandlerService } from './chat-store/permission-handler.service';
import { CompactionLifecycleService } from './chat-store/compaction-lifecycle.service';
import { MessageDispatchService } from './chat-store/message-dispatch.service';
import { SessionStatsAggregatorService } from './chat-store/session-stats-aggregator.service';
import { ChatLifecycleService } from './chat-store/chat-lifecycle.service';
import { MessageSenderService } from './message-sender.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { TabState, SendMessageOptions } from '@ptah-extension/chat-types';

/**
 * ChatStore - Facade for chat state management.
 *
 * Provides a unified public API while delegating implementation to specialized
 * child services under `chat-store/`. Maintains backward compatibility (28
 * readonly signals + 36 public methods) while achieving separation of concerns.
 *
 * Child Services:
 * - StreamingHandlerService — Execution tree building
 * - CompletionHandlerService — Chat completion handling and auto-send
 * - SessionLoaderService — Session loading, pagination, switching
 * - ConversationService — New/continue conversation, message sending, abort
 * - PermissionHandlerService — Permission request management and correlation
 * - CompactionLifecycleService — SDK session-compaction state machine (Wave C7g)
 * - MessageDispatchService — Send/queue routing + slash-command guard (Wave C7g)
 * - SessionStatsAggregatorService — SESSION_STATS aggregation (Wave C7g)
 * - ChatLifecycleService — Bootstrap, license, agent-summary, ID resolution,
 *   error handling (Wave C7g)
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly _vscodeService = inject(VSCodeService);
  private readonly sessionManager = inject(SessionManager);
  private readonly tabManager = inject(TabManagerService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly conversation = inject(ConversationService);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly messageSender = inject(MessageSenderService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly compaction = inject(CompactionLifecycleService);
  private readonly messageDispatch = inject(MessageDispatchService);
  private readonly statsAggregator = inject(SessionStatsAggregatorService);
  private readonly lifecycle = inject(ChatLifecycleService);

  private readonly _servicesReady = signal(false);
  readonly servicesReady = this._servicesReady.asReadonly();

  constructor() {
    // ChatLifecycleService runs the bootstrap chain and flips _servicesReady
    // via this callback so the signal stays owned by the facade.
    this.lifecycle.bootstrap(() => this._servicesReady.set(true));
  }

  // ============================================================================
  // SIGNAL PASSTHROUGHS
  // ============================================================================

  readonly sessions = this.sessionLoader.sessions;
  readonly hasMoreSessions = this.sessionLoader.hasMoreSessions;
  readonly totalSessions = this.sessionLoader.totalSessions;
  readonly isLoadingMoreSessions = this.sessionLoader.isLoadingMoreSessions;
  readonly isStopping = this.conversation.isStopping;
  readonly queueRestoreContent = this.conversation.queueRestoreSignal;
  readonly permissionRequests = this.permissionHandler.permissionRequests;
  // permissionRequestsByToolId - DELETED in TASK_2025_078 (use getPermissionForTool() method)
  readonly unmatchedPermissions = this.permissionHandler.unmatchedPermissions;
  // TASK_2025_136: Question requests for AskUserQuestion tool
  readonly questionRequests = this.permissionHandler.questionRequests;
  readonly resumableSubagents = this.sessionLoader.resumableSubagents;
  readonly licenseStatus = this.lifecycle.licenseStatus;
  // Compaction state — per-tab via TabManagerService (TASK_2025_098)
  readonly isCompacting = this.tabManager.activeTabIsCompacting;

  readonly activeTab = computed(() => this.tabManager.activeTab());
  readonly currentSessionId = this.tabManager.activeTabSessionId;
  readonly messages = this.tabManager.activeTabMessages;

  /**
   * TASK_2025_096 FIX: Return ALL root nodes, not just the first one.
   * When Claude uses tools, the SDK sends multiple assistant messages in one turn,
   * each potentially adding a new root node. Returning only rootNodes[0] caused
   * subsequent messages to be lost. Tab-specific cache key enables per-tab memoization.
   */
  readonly currentExecutionTrees = computed((): ExecutionNode[] => {
    const streamingState = this.tabManager.activeTabStreamingState();
    if (!streamingState) return [];
    const tabId = this.tabManager.activeTabId();
    const cacheKey = `tab-${tabId}`;
    return this.treeBuilder.buildTree(streamingState, cacheKey);
  });

  /** @deprecated Use currentExecutionTrees for all root nodes. */
  readonly currentExecutionTree = computed((): ExecutionNode | null => {
    const trees = this.currentExecutionTrees();
    return trees.length > 0 ? trees[0] : null;
  });

  readonly isStreaming = computed(() => {
    const status = this.tabManager.activeTabStatus();
    return status === 'streaming' || status === 'resuming';
  });

  readonly preloadedStats = this.tabManager.activeTabPreloadedStats;
  readonly liveModelStats = this.tabManager.activeTabLiveModelStats;
  readonly modelUsageList = this.tabManager.activeTabModelUsageList;
  readonly compactionCount = this.tabManager.activeTabCompactionCount;
  readonly queuedContent = this.tabManager.activeTabQueuedContent;
  readonly activeStreamingState = this.tabManager.activeTabStreamingState;

  readonly currentSession = computed(() => {
    const sessionId = this.currentSessionId();
    return (
      this.sessionLoader.sessions().find((s) => s.id === sessionId) ?? null
    );
  });

  readonly messageCount = computed(() => this.messages().length);

  /**
   * Has existing session if active tab has a real Claude session ID and is in
   * 'loaded' state. Reads from active TAB state, not global SessionManager,
   * for correct multi-tab behaviour.
   */
  readonly hasExistingSession = computed(() => {
    const sessionId = this.tabManager.activeTabSessionId();
    const status = this.tabManager.activeTabStatus();
    return sessionId !== null && status === 'loaded';
  });

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  getPermissionForTool(
    toolCallId: string | undefined,
  ): PermissionRequest | null {
    return this.permissionHandler.getPermissionForTool(toolCallId);
  }

  /**
   * Clear current session state.
   * Only clears session state — UI components are responsible for creating tabs
   * before calling this (separation prevents duplicate tab creation bugs).
   */
  clearCurrentSession(): void {
    this.sessionManager.clearSession();
  }

  async loadSessions(): Promise<void> {
    return this.sessionLoader.loadSessions();
  }

  async loadMoreSessions(): Promise<void> {
    return this.sessionLoader.loadMoreSessions();
  }

  async switchSession(sessionId: string): Promise<void> {
    return this.sessionLoader.switchSession(sessionId);
  }

  removeSessionFromList(sessionId: SessionId): void {
    return this.sessionLoader.removeSessionFromList(sessionId);
  }

  updateSessionName(sessionId: SessionId, name: string): void {
    return this.sessionLoader.updateSessionName(sessionId, name);
  }

  async sendMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    return this.messageSender.send(content, options);
  }

  async sendOrQueueMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    return this.messageDispatch.sendOrQueueMessage(content, options);
  }

  async startNewConversation(content: string, files?: string[]): Promise<void> {
    return this.conversation.startNewConversation(content, files);
  }

  async continueConversation(content: string, files?: string[]): Promise<void> {
    return this.conversation.continueConversation(content, files);
  }

  // TASK_2025_213: Subagent resume signals/methods delegate to SessionLoader
  clearResumableSubagents(): void {
    this.sessionLoader.clearResumableSubagents();
  }

  removeResumableSubagent(toolCallId: string): void {
    this.sessionLoader.removeResumableSubagent(toolCallId);
  }

  // TASK_2025_109: handleSubagentResume removed — uses context injection in
  // chat:continue RPC. Users type "resume agent {agentId}" for natural resumption.

  /** TASK_2025_142: License status fetch with retry. Delegates to ChatLifecycleService. */
  async fetchLicenseStatus(retries = 3): Promise<void> {
    return this.lifecycle.fetchLicenseStatus(retries);
  }

  /** TASK_2025_098: Handle compaction start. Delegates to CompactionLifecycleService. */
  handleCompactionStart(sessionId: string): void {
    this.compaction.handleCompactionStart(sessionId);
  }

  /**
   * Public accessor for marking a tab idle from external handlers.
   * Used by ChatMessageHandler for CHAT_COMPLETE fallback. Only removes the
   * visual streaming indicator — full state reset is handled by
   * finalizeCurrentMessage / handleError / handleCompaction.
   */
  markTabIdle(tabId: string): void {
    this.tabManager.markTabIdle(tabId);
  }

  findTabBySessionId(sessionId: string): TabState | null {
    return this.tabManager.findTabBySessionId(sessionId);
  }

  getActiveTabId(): string | null {
    return this.tabManager.activeTabId();
  }

  clearCompactionStateForTab(tabId: string): void {
    this.compaction.clearCompactionStateForTab(tabId);
  }

  /** Route an agent-summary chunk to the correct tab. Delegates to ChatLifecycleService. */
  handleAgentSummaryChunk(payload: {
    toolUseId: string;
    summaryDelta: string;
    agentId: string;
    sessionId: string;
    contentBlocks?: Array<{
      type: 'text' | 'tool_ref';
      text?: string;
      toolUseId?: string;
      toolName?: string;
    }>;
  }): void {
    this.lifecycle.handleAgentSummaryChunk(payload);
  }

  async abortCurrentMessage(): Promise<void> {
    return this.conversation.abortCurrentMessage();
  }

  /**
   * TASK_2025_185: Abort with confirmation when sub-agents are running.
   * @returns true if aborted, false if user cancelled
   */
  async abortWithConfirmation(): Promise<boolean> {
    return this.conversation.abortWithConfirmation();
  }

  /** Clear queued content for a specific tab or the active tab. */
  clearQueuedContent(tabId?: string): void {
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;
    this.tabManager.updateTab(targetTabId, { queuedContent: null });
  }

  clearQueueRestoreSignal(): void {
    this.conversation.clearQueueRestoreSignal();
  }

  /**
   * Process flat streaming event from SDK. Three-branch result dispatch
   * delegates to specialized sub-services:
   * - compactionComplete → CompactionLifecycleService.handleCompactionComplete
   * - compactionSessionId (start) → CompactionLifecycleService.handleCompactionStart
   * - queuedContent → MessageDispatchService.sendQueuedMessage
   *
   * TASK_2025_092: tabId routes the event; sessionId stores the real SDK UUID.
   */
  processStreamEvent(
    event: FlatStreamEventUnion,
    tabId?: string,
    sessionId?: string,
  ): void {
    const result = this.streamingHandler.processStreamEvent(
      event,
      tabId,
      sessionId,
    );

    if (result && result.compactionComplete && result.compactionSessionId) {
      this.compaction.handleCompactionComplete({
        tabId: result.tabId,
        compactionSessionId: result.compactionSessionId,
      });
      return;
    }

    // TASK_2025_098: compaction start now flows through CHAT_CHUNK
    if (result && result.compactionSessionId) {
      this.handleCompactionStart(result.compactionSessionId);
      return;
    }

    // TASK_2025_100 / TASK_2025_185: re-steering via queued content on message_complete
    if (result && result.queuedContent) {
      const queuedContent = result.queuedContent;
      const resultTabId = result.tabId;
      this.messageDispatch.sendQueuedMessage(resultTabId, queuedContent);
    }
  }

  /** Finalize the current streaming message. Delegates to StreamingHandlerService. */
  private finalizeCurrentMessage(tabId?: string): void {
    this.streamingHandler.finalizeCurrentMessage(tabId);
  }

  // ============================================================================
  // PERMISSION REQUEST HANDLING (PermissionHandlerService delegation)
  // ============================================================================

  handlePermissionRequest(request: PermissionRequest): void {
    this.permissionHandler.handlePermissionRequest(request);
  }

  handlePermissionAutoResolved(payload: {
    id: string;
    toolName: string;
  }): void {
    this.permissionHandler.handlePermissionAutoResolved(payload);
  }

  /**
   * Cleanup all permission and question requests for a session.
   * Called on PERMISSION_SESSION_CLEANUP (session aborted).
   */
  cleanupPermissionSession(sessionId: string): void {
    this.permissionHandler.cleanupSession(sessionId);
  }

  handlePermissionResponse(response: PermissionResponse): void {
    this.permissionHandler.handlePermissionResponse(response);
  }

  /** TASK_2025_136: AskUserQuestion request from backend. */
  handleQuestionRequest(request: AskUserQuestionRequest): void {
    this.permissionHandler.handleQuestionRequest(request);
  }

  /** TASK_2025_136: User answer to AskUserQuestion. */
  handleQuestionResponse(response: AskUserQuestionResponse): void {
    this.permissionHandler.handleQuestionResponse(response);
  }

  public queueOrAppendMessage(
    content: string,
    options?: SendMessageOptions,
  ): void {
    this.conversation.queueOrAppendMessage(content, options);
  }

  /** Move queued content to input field. Posts CHAT_RESTORE_INPUT to webview. */
  public moveQueueToInput(): void {
    const queuedContent = this.conversation.queueRestoreSignal();
    if (queuedContent) {
      this._vscodeService.postMessage({
        type: MESSAGE_TYPES.CHAT_RESTORE_INPUT,
        content: queuedContent,
      });
    }
  }

  // ============================================================================
  // SESSION STATS / ID / ERROR HANDLING
  // ============================================================================
  // NOTE: handleChatComplete was removed — chat:complete is no longer used for
  // streaming state management. SESSION_STATS (from type=result) is the
  // authoritative completion signal (TASK_2025_101).

  /** Handle session stats update. Delegates to SessionStatsAggregatorService. */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
    };
    duration: number;
    modelUsage?: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      contextWindow: number;
      costUSD: number;
      cacheReadInputTokens?: number;
      lastTurnContextTokens?: number;
    }>;
  }): void {
    this.statsAggregator.handleSessionStats(stats);
  }

  /** Handle session ID resolution from backend. Delegates to ChatLifecycleService. */
  handleSessionIdResolved(data: {
    tabId: string;
    realSessionId: string;
  }): void {
    this.lifecycle.handleSessionIdResolved(data);
  }

  /** Handle chat error from backend. Delegates to ChatLifecycleService. */
  handleChatError(data: {
    tabId?: string;
    sessionId?: string;
    error: string;
  }): void {
    this.lifecycle.handleChatError(data);
  }
}
