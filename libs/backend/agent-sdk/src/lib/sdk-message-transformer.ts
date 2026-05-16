/**
 * SDK Message Transformer - Converts SDK messages to flat stream events
 *
 * Transforms messages from the official Claude Agent SDK into flat streaming events
 * that contain relationship IDs instead of nested children trees.
 *
 * Emits FlatStreamEventUnion[]; the frontend builds ExecutionNode trees at
 * render time from these flat events.
 */

import { injectable, inject } from 'tsyringe';
import {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingStartEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  AgentStartEvent,
  MessageCompleteEvent,
  MessageDeltaEvent,
  SignatureDeltaEvent,
  CompactionCompleteEvent,
  BackgroundAgentStartedEvent,
  AgentProgressEvent,
  AgentStatusEvent,
  AgentCompletedEvent,
  SessionId,
  HarnessStreamId,
  WizardPhaseId,
  calculateMessageCost,
  EventSource,
  AuthEnv,
  isAgentDispatchTool,
} from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from './di/tokens';
import type { ModelResolver } from './auth/model-resolver';
import type { SessionLifecycleManager } from './helpers/session-lifecycle-manager';
import type { LiveUsageTracker } from './helpers/live-usage-tracker';
import {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKPartialAssistantMessage,
  TextBlock,
  ToolResultBlock,
  isTextBlock,
  isThinkingBlock,
  isToolUseBlock,
  isToolResultBlock,
  isResultMessage,
  isSystemInit,
  isStreamEvent,
  isUserMessage,
  isAssistantMessage,
  isCompactBoundary,
  isLocalCommandOutput,
  isTaskStarted,
  isTaskProgress,
  isTaskUpdated,
  isTaskNotification,
} from './types/sdk-types/claude-sdk.types';
import {
  generateEventId,
  isSkillOrMetaContent,
  userMessageHasToolResult,
} from './message-transform/message-transform-helpers';

// Re-export isResultMessage for backward compatibility with stream-transformer.ts
export { isResultMessage as isSDKResultMessage };

/**
 * SdkMessageTransformer - Transforms SDK messages to flat stream events.
 *
 * - Returns FlatStreamEventUnion[] (no tree building, no children field manipulation)
 * - Emits events with relationship IDs (messageId, toolCallId, parentToolUseId)
 * - Per-context message ID tracking: main agent and subagent streams interleave,
 *   so we track messageId separately for each context (parentToolUseId).
 *   Without this, subagent text_delta events would be associated with the wrong
 *   messageId when the main agent continues streaming.
 */
@injectable()
export class SdkMessageTransformer {
  /**
   * Per-context message ID tracking.
   * Key: parentToolUseId (or '' for root messages)
   * Value: current messageId for that context
   *
   * This prevents main agent and subagent streams from interfering.
   * When subagent sends message_start with parentToolUseId='tool-xyz',
   * its messageId is stored under 'tool-xyz' key, separate from root.
   */
  private currentMessageIdByContext: Map<string, string> = new Map();

  /**
   * Per-context model tracking for streaming.
   * Captures model from message_start event so it can be included
   * in the message_complete event at message_stop time.
   * Key: parentToolUseId || '' (same as currentMessageIdByContext)
   */
  private currentModelByContext: Map<string, string> = new Map();

  /**
   * Maps blockIndex to real contentBlock.id from tool_use blocks.
   * Used to associate tool_delta events with correct toolCallId.
   * Cleared on message boundaries. Per-context tracking.
   * Key: `${context}:${blockIndex}` where context = parentToolUseId || ''
   */
  private toolCallIdByContextAndBlock: Map<string, string> = new Map();

  /**
   * Tracks Task tool_use IDs that have run_in_background: true.
   * When the corresponding tool_result arrives, we know this was a background agent
   * and can emit BackgroundAgentStartedEvent.
   * Set: toolCallId values
   */
  private backgroundTaskToolUseIds: Set<string> = new Set();

  /**
   * Maps SDK task_id → parent tool_use_id for task_* message routing.
   * Populated when task_started fires; used by task_progress, task_updated,
   * and task_notification to recover the parentToolUseId for event emission.
   */
  private taskIdToParentToolUseId: Map<string, string> = new Map();

  /**
   * Tracks which parentToolUseIds have already had an AgentStartEvent
   * emitted via the authoritative task_started path. Used to suppress the
   * legacy tool_result correlation path for those agents, preventing duplicates.
   */
  private taskStartedEmitted: Set<string> = new Set();

  /**
   * Tracks Skill tool_use IDs that are currently executing.
   * When a Skill tool is active, subsequent non-tool-result user messages
   * are skill .md content injections that must be filtered from the UI.
   *
   * The SDK wraps newMessages as {message: o} during tool execution, which
   * causes the isMeta flag to be lost during emission (SDK bug). This tracking
   * provides a reliable alternative to flag-based detection.
   *
   * Flow:
   * 1. Assistant message has tool_use(name='Skill') → add toolCallId
   * 2. User message with tool_result matching toolCallId → mark as seen
   * 3. User messages without tool_result while set is non-empty → FILTER (skill content)
   * 4. Next assistant message_start → clear the set (skill loading complete)
   */
  private activeSkillToolUseIds: Set<string> = new Set();

  /**
   * Per-session live cumulative token tracker.
   *
   * The snapshot map lives in `LiveUsageTracker` to break a DI cycle introduced
   * by injecting the transformer into the PreCompact hook handler. The
   * transformer remains the sole writer (from `message_start.message.usage`
   * and `message_delta.usage`); the `CompactionHookHandler` is the sole reader
   * at PreCompact firing time.
   *
   * The transformer keeps thin pass-through methods (`getCumulativeTokens`,
   * `clearSessionTokenSnapshot`) that delegate to the tracker so existing
   * callers and unit tests continue to work unchanged.
   */

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(SDK_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
    // Active session correlator for compact_boundary fallback.
    // The SDK occasionally omits session_id on SDKSystemMessage{compact_boundary},
    // which causes compaction_complete to ship with sessionId='' and break
    // frontend banner dismissal. Prefer the lifecycle manager's
    // most-recently-active session id over sdkMessage.session_id.
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager,
    // Shared writer-side tracker used by the PreCompact hook handler
    // at compaction firing time.
    @inject(SDK_TOKENS.SDK_LIVE_USAGE_TRACKER)
    private readonly usageTracker: LiveUsageTracker,
  ) {}

  /**
   * Create an isolated transformer instance with fresh state.
   * Use this for concurrent streams that must not share mutable tracking maps
   * (e.g., each Ptah CLI headless agent needs its own state scope).
   */
  createIsolated(): SdkMessageTransformer {
    return new SdkMessageTransformer(
      this.logger,
      this.authEnv,
      this.subagentRegistry,
      this.modelResolver,
      this.sessionLifecycle,
      this.usageTracker,
    );
  }

  /**
   * Read the most recent cumulative pre-compaction tokens observed for the
   * given session, summing input + output + cache_read + cache_creation.
   * Returns 0 when no usage has been observed yet (empty sessions, or
   * compaction firing before the first assistant turn).
   *
   * Used by `CompactionHookHandler` at PreCompact firing time to enrich the
   * `compaction_start` event broadcast.
   */
  getCumulativeTokens(sessionId: string): number {
    return this.usageTracker.getCumulativeTokens(sessionId);
  }

  /**
   * Clear the cached token snapshot for a session.
   * Should be called on session deletion to avoid unbounded growth across
   * long-lived extension sessions. Currently called from session lifecycle
   * cleanup; safe to no-op if the session was never tracked.
   */
  clearSessionTokenSnapshot(sessionId: string): void {
    this.usageTracker.clearSessionTokenSnapshot(sessionId);
  }

  /**
   * Internal — record an observed cumulative usage frame for a session.
   * Cumulative semantics: each field overwrites the previous value when the
   * new value is greater (Anthropic API delivers monotonic cumulative counts
   * within a turn; cross-turn aggregation is handled by downstream stats
   * services, not here).
   */
  private recordSessionUsage(
    sessionId: string,
    fields: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheCreation?: number;
    },
  ): void {
    this.usageTracker.recordSessionUsage(sessionId, fields);
  }

  /**
   * Transform SDK message to flat stream events
   *
   * A single SDK message may produce multiple flat events:
   * - SDKAssistantMessage → message_start + content events + message_complete
   * - SDKUserMessage → message_start + text_delta + message_complete
   * - stream_event → various streaming events
   *
   * @param sdkMessage - SDK message to transform (uses structural typing to match SDK types)
   * @param sessionId - Optional session ID for event correlation. Accepts the
   *   real SDK SessionId (UUID v4) OR the synthetic harness/wizard brands —
   *   harness streams and wizard phases mint non-UUID ids that flow through
   *   the same transform but must never reach UUID-validating consumers.
   * @returns Array of FlatStreamEventUnion (flat events with relationship IDs)
   */
  transform(
    sdkMessage: SDKMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    try {
      // Use type guards for discriminated union narrowing
      if (isAssistantMessage(sdkMessage)) {
        return this.transformAssistantToFlatEvents(sdkMessage, sessionId);
      }

      if (isUserMessage(sdkMessage)) {
        // Skip synthetic/meta messages (skill .md content, reminders, etc.).
        // These are conversation context for Claude but should not be displayed in the UI.
        //
        // MULTI-LAYER FILTER with defense-in-depth:
        //   1. isSynthetic flag - SDK maps internal isMeta → isSynthetic on emission
        //   2. isMeta flag (LEGACY) - may be set directly on some code paths
        //   3. Skill tool tracking - filters user messages during active Skill execution
        //   4. Content-based detection for known SDK meta patterns (LAST RESORT)
        //
        // WHY LAYER 3 EXISTS: The SDK has a bug where newMessages from tool execution
        // are wrapped as {message: o} before emission, causing isMeta to be read from
        // the wrapper (undefined) instead of the inner message. This means isSynthetic
        // is NOT reliably set for skill content. Tracking active Skill tool_use IDs
        // provides a deterministic alternative.
        if (sdkMessage.isSynthetic === true) {
          this.logger.debug(
            '[SdkMessageTransformer] Skipping synthetic user message (skill/meta content)',
          );
          return [];
        }

        // LAYER 3: Skill tool tracking.
        // When a Skill tool is active, non-tool-result user messages are skill
        // .md content injections. The tool_result itself is handled separately
        // (transformUserToFlatEvents returns tool_result events before reaching here).
        if (this.activeSkillToolUseIds.size > 0) {
          // Check if this user message contains tool_result blocks — those are legitimate
          const hasToolResult = userMessageHasToolResult(sdkMessage);
          if (!hasToolResult) {
            this.logger.info(
              '[SdkMessageTransformer] Skipping user message during active Skill tool execution (skill content injection)',
              { activeSkillTools: [...this.activeSkillToolUseIds] },
            );
            return [];
          }
        }

        // LAYER 4: Content-based detection as last resort.
        if (isSkillOrMetaContent(sdkMessage)) {
          this.logger.info(
            '[SdkMessageTransformer] Skipping user message detected as skill/meta content by pattern',
          );
          return [];
        }

        return this.transformUserToFlatEvents(sdkMessage, sessionId);
      }

      if (isSystemInit(sdkMessage)) {
        // Skip system messages (init, etc.) - they contain metadata
        // that shouldn't be displayed as chat messages in the UI.
        return [];
      }

      if (isCompactBoundary(sdkMessage)) {
        // Compact boundary signals compaction is complete.
        // Reset internal streaming state (ID tracking maps) since
        // pre-compaction messages are no longer relevant.
        this.logger.info(
          '[SdkMessageTransformer] Compact boundary received, resetting streaming state',
          { trigger: sdkMessage.compact_metadata.trigger },
        );
        this.clearStreamingState();

        // Resolve session correlator with strict priority.
        // Prefer caller-provided sessionId (StreamTransformer threads the active
        // tracking id), then SessionLifecycleManager's most-recently-active id,
        // and finally sdkMessage.session_id. NEVER fall back to '' — emitting a
        // compaction_complete with empty sessionId routes nowhere and leaves the
        // banner stuck on the 120s safety timeout.
        const activeIds = this.sessionLifecycle.getActiveSessionIds();
        const resolvedSessionId =
          sessionId ||
          activeIds[0] ||
          (sdkMessage.session_id as SessionId | undefined);

        if (!resolvedSessionId) {
          this.logger.warn(
            '[SdkMessageTransformer] compact_boundary received without resolvable sessionId — skipping compaction_complete emission. Banner will rely on safety timeout.',
            {
              callerSessionId: sessionId,
              sdkSessionId: sdkMessage.session_id,
              activeSessionCount: activeIds.length,
              trigger: sdkMessage.compact_metadata.trigger,
              preTokens: sdkMessage.compact_metadata.pre_tokens,
            },
          );
          return [];
        }

        // Prune subagent entries and the live token snapshot for this session
        // at the compaction boundary. Post-boundary tool-use ID space is fresh —
        // stale entries would otherwise drift the AGENTS header counter and
        // re-poison cumulative token tracking. `clearStreamingState()` above
        // already clears the local `backgroundTaskToolUseIds` set
        // (transformer-internal), so late tool_results matching pre-boundary
        // IDs are harmless no-ops.
        this.subagentRegistry.pruneSession(resolvedSessionId);
        this.clearSessionTokenSnapshot(resolvedSessionId);

        const compactionCompleteEvent: CompactionCompleteEvent = {
          id: generateEventId(),
          eventType: 'compaction_complete',
          timestamp: Date.now(),
          sessionId: resolvedSessionId,
          messageId: `compaction-${Date.now()}`,
          trigger: sdkMessage.compact_metadata.trigger,
          preTokens: sdkMessage.compact_metadata.pre_tokens,
        };

        return [compactionCompleteEvent];
      }

      if (isLocalCommandOutput(sdkMessage)) {
        // Local slash command output (e.g., /cost, /context).
        // Emit as an assistant message with the command output text.
        this.logger.info(
          '[SdkMessageTransformer] Local command output received',
          { contentLength: sdkMessage.content.length },
        );
        const messageId = `cmd_${generateEventId()}`;
        const events: FlatStreamEventUnion[] = [
          {
            id: generateEventId(),
            eventType: 'message_start',
            timestamp: Date.now(),
            sessionId: sessionId || sdkMessage.session_id || '',
            messageId,
            role: 'assistant',
          } as MessageStartEvent,
          {
            id: generateEventId(),
            eventType: 'text_delta',
            timestamp: Date.now(),
            sessionId: sessionId || sdkMessage.session_id || '',
            messageId,
            delta: sdkMessage.content,
            blockIndex: 0,
          } as TextDeltaEvent,
          {
            id: generateEventId(),
            eventType: 'message_complete',
            timestamp: Date.now(),
            sessionId: sessionId || sdkMessage.session_id || '',
            messageId,
          } as MessageCompleteEvent,
        ];
        return events;
      }

      if (isResultMessage(sdkMessage)) {
        // Skip result messages - they contain session summary metadata
        // (cost, duration, tokens) that shouldn't appear as chat bubbles.
        // This data is handled via callback in StreamTransformer.
        return [];
      }

      if (isStreamEvent(sdkMessage)) {
        // Process partial streaming events for real-time UI updates
        return this.transformStreamEventToFlatEvents(sdkMessage, sessionId);
      }

      // SDK task_* messages — subagent visibility surface.
      // These system messages carry authoritative lifecycle state for
      // subagents tracked via `agentProgressSummaries: true` Option.

      if (isTaskStarted(sdkMessage)) {
        return this.transformTaskStarted(sdkMessage, sessionId);
      }

      if (isTaskProgress(sdkMessage)) {
        return this.transformTaskProgress(sdkMessage, sessionId);
      }

      if (isTaskUpdated(sdkMessage)) {
        return this.transformTaskUpdated(sdkMessage, sessionId);
      }

      if (isTaskNotification(sdkMessage)) {
        return this.transformTaskNotification(sdkMessage, sessionId);
      }

      // Unknown message type
      this.logger.warn(
        '[SdkMessageTransformer] Unknown message type',
        sdkMessage,
      );
      return [];
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        '[SdkMessageTransformer] Transformation failed',
        errorObj,
      );
      return [];
    }
  }

  /**
   * Transform SDK stream_event to flat events
   *
   * stream_event messages contain real-time streaming content from the API.
   * The event field contains RawMessageStreamEvent with various event types:
   * - message_start: Initialize streaming with message.id (UUID)
   * - content_block_start: New content block beginning
   * - content_block_delta: Partial text/json/thinking content
   * - content_block_stop: Content block finished
   * - message_delta: Top-level changes (stop_reason, cumulative token usage)
   * - message_stop: Final completion event
   * - ping: Keep-alive (ignored)
   * - error: Stream error
   */
  private transformStreamEventToFlatEvents(
    sdkMessage: SDKPartialAssistantMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    const { event, parent_tool_use_id } = sdkMessage;

    // Skip non-content events
    if (!event || typeof event !== 'object') {
      return [];
    }

    const eventType = (event as { type?: string }).type;
    const blockIndex = (event as { index?: number }).index ?? 0;

    // Capture parent_tool_use_id for nested agent messages
    const parentToolUseId = parent_tool_use_id ?? undefined;

    switch (eventType) {
      // ========== MESSAGE LIFECYCLE ==========

      case 'message_start': {
        // Use Anthropic API's message.id for stable message correlation.
        //
        // message.id (like "gen-1766961093-H9nAcWY4jRlYPHnMLdIi") is
        // CONSISTENT across stream_event AND assistant messages for the same
        // response. The SDK's uuid is DIFFERENT for each SDK message, which
        // breaks:
        // 1. Tool linking: tool_start and tool_result end up with different messageIds
        // 2. Deduplication: same content gets added twice with different messageIds
        // 3. Tree building: events for same message scattered across multiple messageIds
        //
        // Priority: Anthropic message.id > SDK uuid > generated fallback
        const message = (
          event as {
            message?: {
              id?: string;
              model?: string;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              };
            };
          }
        ).message;
        const messageId =
          message?.id || sdkMessage.uuid || `stream-msg-${Date.now()}`;

        // Capture initial cumulative usage from message_start (carries
        // input_tokens + cache fields). Output tokens arrive later via
        // message_delta.
        if (sessionId && message?.usage) {
          this.recordSessionUsage(sessionId, {
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
            cacheRead: message.usage.cache_read_input_tokens,
            cacheCreation: message.usage.cache_creation_input_tokens,
          });
        }

        // Track current message ID per context.
        // Context = parentToolUseId (for nested agent messages) or '' (for root messages).
        // This prevents main agent and subagent streams from interfering with each other.
        const context = parentToolUseId || '';
        this.currentMessageIdByContext.set(context, messageId);

        // Track model for this context so message_complete includes it
        if (message?.model) {
          this.currentModelByContext.set(context, message.model);
        }

        // Clear tool call ID tracking for this context's new message
        // Only clear entries for this context, not all entries
        for (const key of this.toolCallIdByContextAndBlock.keys()) {
          if (key.startsWith(`${context}:`)) {
            this.toolCallIdByContextAndBlock.delete(key);
          }
        }

        // Clear Skill tool tracking on new assistant message_start.
        // When Claude starts a new response after skill loading, the injected
        // skill content messages are done. Safe to stop filtering.
        if (this.activeSkillToolUseIds.size > 0) {
          this.logger.info(
            '[SdkMessageTransformer] Clearing activeSkillToolUseIds on assistant message_start',
            { clearedIds: [...this.activeSkillToolUseIds] },
          );
          this.activeSkillToolUseIds.clear();
        }

        // Emit message_start event
        const messageStartEvent: MessageStartEvent = {
          id: generateEventId(),
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'stream' as EventSource,
          messageId,
          role: 'assistant',
          parentToolUseId,
        };

        return [messageStartEvent];
      }

      case 'message_delta': {
        // Emit message_delta event with cumulative token usage
        const usage = (
          event as {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          }
        ).usage;

        // Record cumulative usage for PreCompact hook.
        // message_delta carries the running cumulative token counts; capture
        // the latest snapshot so the compaction_start event can ship with
        // accurate pre-compaction tokens.
        if (sessionId && usage) {
          this.recordSessionUsage(sessionId, {
            input: usage.input_tokens,
            output: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens,
            cacheCreation: usage.cache_creation_input_tokens,
          });
        }

        // Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        if (!usage || !currentMessageId) {
          return [];
        }

        const messageDeltaEvent: MessageDeltaEvent = {
          id: generateEventId(),
          eventType: 'message_delta',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'stream' as EventSource,
          messageId: currentMessageId,
          tokenUsage: {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
          },
        };

        return [messageDeltaEvent];
      }

      case 'message_stop': {
        // Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        // Emit message_complete when stream ends.
        // CRITICAL: without this, StreamTransformer never stores the message
        // because it waits for message_complete to finalize the accumulator.
        const events: FlatStreamEventUnion[] = [];

        if (currentMessageId) {
          // Include model captured from message_start
          const contextModel = this.currentModelByContext.get(context);
          const messageCompleteEvent: MessageCompleteEvent = {
            id: generateEventId(),
            eventType: 'message_complete',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'stream' as EventSource,
            messageId: currentMessageId,
            // Note: token usage comes from message_delta events, not message_stop
            parentToolUseId,
            ...(contextModel && { model: contextModel }),
          };
          events.push(messageCompleteEvent);
        }

        // Clear tracking for this context only
        this.currentMessageIdByContext.delete(context);
        this.currentModelByContext.delete(context);
        for (const key of this.toolCallIdByContextAndBlock.keys()) {
          if (key.startsWith(`${context}:`)) {
            this.toolCallIdByContextAndBlock.delete(key);
          }
        }

        return events;
      }

      // ========== CONTENT BLOCK LIFECYCLE ==========

      case 'content_block_start': {
        const contentBlock = (
          event as {
            content_block?: {
              type?: string;
              text?: string;
              id?: string;
              name?: string;
            };
          }
        ).content_block;

        const blockType = contentBlock?.type || 'text';

        // Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        if (!currentMessageId) {
          this.logger.warn(
            `[SdkMessageTransformer] content_block_start but no active message for context: ${
              context || 'root'
            }`,
          );
          return [];
        }

        // Emit thinking_start for thinking blocks
        if (blockType === 'thinking') {
          const thinkingStartEvent: ThinkingStartEvent = {
            id: generateEventId(),
            eventType: 'thinking_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'stream' as EventSource,
            messageId: currentMessageId,
            blockIndex,
            parentToolUseId,
          };

          return [thinkingStartEvent];
        }

        // Emit tool_start for tool_use blocks
        if (
          blockType === 'tool_use' &&
          contentBlock?.id &&
          contentBlock?.name
        ) {
          const isTaskTool = isAgentDispatchTool(contentBlock.name);

          // Track Skill tool_use IDs for filtering injected skill content messages
          if (contentBlock.name === 'Skill') {
            this.activeSkillToolUseIds.add(contentBlock.id);
            this.logger.info(
              '[SdkMessageTransformer] Tracking Skill tool_use (streaming) for content filtering',
              { toolCallId: contentBlock.id },
            );
          }

          // Track real toolCallId per context
          const blockKey = `${context}:${blockIndex}`;
          this.toolCallIdByContextAndBlock.set(blockKey, contentBlock.id);

          const toolStartEvent: ToolStartEvent = {
            id: generateEventId(),
            eventType: 'tool_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'stream' as EventSource,
            messageId: currentMessageId,
            toolCallId: contentBlock.id,
            toolName: contentBlock.name,
            isTaskTool,
            parentToolUseId,
          };

          // Only emit tool_start during streaming.
          // DO NOT emit agent_start here - we don't have the agentType yet.
          // agent_start will be emitted when the complete message arrives
          // (in transformCompleteAssistantMessage) with the correct agentType.
          // Emitting agent_start here with 'unknown' causes duplicate agents.
          return [toolStartEvent];
        }

        // Text blocks don't emit on start (wait for delta)
        return [];
      }

      case 'content_block_delta': {
        const delta = (
          event as {
            delta?: {
              type?: string;
              text?: string;
              partial_json?: string;
              thinking?: string;
              signature?: string;
            };
          }
        ).delta;

        // Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        if (!delta || !currentMessageId) {
          return [];
        }

        switch (delta.type) {
          case 'text_delta': {
            if (!delta.text) return [];

            const textDeltaEvent: TextDeltaEvent = {
              id: generateEventId(),
              eventType: 'text_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              source: 'stream' as EventSource,
              messageId: currentMessageId,
              delta: delta.text,
              blockIndex,
              parentToolUseId,
            };

            return [textDeltaEvent];
          }

          case 'input_json_delta': {
            if (delta.partial_json === undefined) return [];

            // Get real toolCallId per context
            const blockKey = `${context}:${blockIndex}`;
            const realToolCallId =
              this.toolCallIdByContextAndBlock.get(blockKey) ||
              `tool-block-${blockIndex}`;

            const toolDeltaEvent: ToolDeltaEvent = {
              id: generateEventId(),
              eventType: 'tool_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              source: 'stream' as EventSource,
              messageId: currentMessageId,
              toolCallId: realToolCallId,
              delta: delta.partial_json,
              parentToolUseId,
            };

            return [toolDeltaEvent];
          }

          case 'thinking_delta': {
            if (!delta.thinking) return [];

            const thinkingDeltaEvent: ThinkingDeltaEvent = {
              id: generateEventId(),
              eventType: 'thinking_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              source: 'stream' as EventSource,
              messageId: currentMessageId,
              delta: delta.thinking,
              blockIndex,
              signature: delta.signature,
              parentToolUseId,
            };

            return [thinkingDeltaEvent];
          }

          case 'signature_delta': {
            // Extended thinking signature validation
            // Emitted after thinking block to provide cryptographic verification
            if (!delta.signature) return [];

            const signatureDeltaEvent: SignatureDeltaEvent = {
              id: generateEventId(),
              eventType: 'signature_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              source: 'stream' as EventSource,
              messageId: currentMessageId,
              blockIndex,
              signature: delta.signature,
              parentToolUseId,
            };

            return [signatureDeltaEvent];
          }

          default:
            this.logger.debug(
              `[SdkMessageTransformer] Unknown delta type: ${delta.type}`,
            );
            return [];
        }
      }

      case 'content_block_stop': {
        // Content block finished - no event needed (frontend accumulates deltas)
        return [];
      }

      // ========== SPECIAL EVENTS ==========

      case 'ping':
        // Keep-alive event, ignore
        return [];

      case 'error': {
        const error = (event as { error?: { type?: string; message?: string } })
          .error;
        this.logger.error(
          `[SdkMessageTransformer] Stream error: ${error?.type} - ${error?.message}`,
        );
        // Could emit error event if needed
        return [];
      }

      default:
        this.logger.debug(
          `[SdkMessageTransformer] Unknown event type: ${eventType}`,
        );
        return [];
    }
  }

  /**
   * Transform complete assistant message to flat events
   *
   * Emits:
   * - message_start
   * - text_delta events for text blocks
   * - tool_start events for tool_use blocks
   * - tool_result events for tool_result blocks
   * - message_complete
   */
  private transformAssistantToFlatEvents(
    sdkMessage: SDKAssistantMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    const { uuid, message, parent_tool_use_id } = sdkMessage;

    const events: FlatStreamEventUnion[] = [];

    // BetaContentBlock is a broad union from the SDK. JSONL history replay
    // can include tool_result blocks in assistant messages which aren't in
    // BetaContentBlock. We iterate using type guards that check block.type.
    const content = (message.content || []) as unknown as Array<{
      type: string;
      [key: string]: unknown;
    }>;

    // Use Anthropic API's message.id for stable message correlation.
    //
    // message.id is CONSISTENT across stream_event AND assistant. Using uuid
    // would cause tool_start and tool_result to have DIFFERENT messageIds,
    // breaking tree builder tool collection (collectTools filters by messageId).
    //
    // Priority: Anthropic message.id > SDK uuid
    const messageId = message?.id || uuid;

    // Clear Skill tool tracking on new assistant message (complete path).
    // Same logic as message_start in streaming path — skill loading is done.
    if (this.activeSkillToolUseIds.size > 0) {
      this.logger.info(
        '[SdkMessageTransformer] Clearing activeSkillToolUseIds on complete assistant message',
        { clearedIds: [...this.activeSkillToolUseIds] },
      );
      this.activeSkillToolUseIds.clear();
    }

    // 1. Emit message_start
    const messageStartEvent: MessageStartEvent = {
      id: generateEventId(),
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId,
      role: 'assistant',
      parentToolUseId: parent_tool_use_id ?? undefined,
    };
    events.push(messageStartEvent);

    // 2. Emit content events (text, tools)
    // Use the actual content array index (matching the Anthropic API's event.index)
    // NOT a text-only counter. The streaming path uses event.index which counts ALL
    // content blocks (thinking, text, tool_use). Using a text-only counter here causes
    // blockIndex mismatch: stream text_delta has blockIndex=1 (after thinking at 0),
    // but complete text_delta has blockIndex=0 (text-only counter). This creates
    // duplicate text accumulators in the frontend (msgId-block-1 AND msgId-block-0).

    for (let contentIndex = 0; contentIndex < content.length; contentIndex++) {
      const block = content[contentIndex];
      if (isThinkingBlock(block)) {
        // Emit thinking_delta event for thinking blocks in complete messages.
        // Without this, thinking accumulators populated by stream events get
        // cleared (via deferred clearing) but never repopulated from the
        // complete path, causing thinking blocks to vanish from the UI.
        if (block.thinking) {
          const thinkingDeltaEvent: ThinkingDeltaEvent = {
            id: generateEventId(),
            eventType: 'thinking_delta',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'complete' as EventSource,
            messageId,
            delta: block.thinking,
            blockIndex: contentIndex,
            parentToolUseId: parent_tool_use_id ?? undefined,
          };
          events.push(thinkingDeltaEvent);
        }
      } else if (isTextBlock(block)) {
        // Emit text_delta event
        const textDeltaEvent: TextDeltaEvent = {
          id: generateEventId(),
          eventType: 'text_delta',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'complete' as EventSource,
          messageId,
          delta: block.text,
          blockIndex: contentIndex,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };
        events.push(textDeltaEvent);
      } else if (isToolUseBlock(block)) {
        // Emit tool_start event
        const isTaskTool = isAgentDispatchTool(block.name);

        // Extract agent-specific fields for Task tools using safe property access
        // block.input is Record<string, unknown>, so we check properties exist
        let agentType: string | undefined;
        let agentDescription: string | undefined;
        let agentPrompt: string | undefined;

        if (isTaskTool && block.input) {
          // Use bracket notation for index signature properties (TS4111)
          agentType =
            'subagent_type' in block.input &&
            typeof block.input['subagent_type'] === 'string'
              ? block.input['subagent_type']
              : undefined;
          agentDescription =
            'description' in block.input &&
            typeof block.input['description'] === 'string'
              ? block.input['description']
              : undefined;
          agentPrompt =
            'prompt' in block.input && typeof block.input['prompt'] === 'string'
              ? block.input['prompt']
              : undefined;

          // Track background Task tool_use IDs for correlation with tool_result
          const isBackground =
            'run_in_background' in block.input &&
            block.input['run_in_background'] === true;
          if (isBackground) {
            this.backgroundTaskToolUseIds.add(block.id);
            // Pre-mark in registry so register() auto-sets isBackground.
            // This eliminates the race condition where the agent starts executing tools
            // before the background_agent_started stream event arrives.
            this.subagentRegistry.markPendingBackground(block.id);
            this.logger.info(
              '[SdkMessageTransformer] Detected background Task tool_use',
              {
                toolCallId: block.id,
                agentType,
                agentDescription,
              },
            );
          }
        }

        // Track Skill tool_use IDs for filtering injected skill content messages
        if (block.name === 'Skill') {
          this.activeSkillToolUseIds.add(block.id);
          this.logger.info(
            '[SdkMessageTransformer] Tracking Skill tool_use for content filtering',
            { toolCallId: block.id },
          );
        }

        const toolStartEvent: ToolStartEvent = {
          id: generateEventId(),
          eventType: 'tool_start',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'complete' as EventSource,
          messageId,
          toolCallId: block.id,
          toolName: block.name,
          toolInput: block.input,
          isTaskTool,
          agentType,
          agentDescription,
          agentPrompt,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };

        // Emit agent_start event for Task tools.
        // Dedupe: if the SDK-authoritative task_started path already emitted
        // an agent_start for this tool_use_id, skip the legacy emission so the
        // frontend never sees two agent_start events for the same agent.
        // The SDK path is authoritative (it carries taskId); this legacy path
        // only fires when the SDK path has NOT already covered this toolCallId.
        if (isTaskTool && !this.taskStartedEmitted.has(block.id)) {
          const agentStartEvent: AgentStartEvent = {
            id: generateEventId(),
            eventType: 'agent_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'complete' as EventSource,
            messageId,
            toolCallId: block.id,
            agentType: agentType || 'unknown',
            agentDescription,
            agentPrompt,
            parentToolUseId: block.id, // Link to parent Task tool
          };
          events.push(agentStartEvent);
        }

        events.push(toolStartEvent);
      } else if (isToolResultBlock(block)) {
        // Emit tool_result event
        const toolResultEvent: ToolResultEvent = {
          id: generateEventId(),
          eventType: 'tool_result',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'complete' as EventSource,
          messageId,
          toolCallId: block.tool_use_id,
          output: block.content,
          isError: block.is_error ?? false,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };
        events.push(toolResultEvent);

        // Check if this tool_result is for a background Task tool_use
        // If so, emit BackgroundAgentStartedEvent with the output file path
        if (this.backgroundTaskToolUseIds.has(block.tool_use_id)) {
          this.backgroundTaskToolUseIds.delete(block.tool_use_id);

          // Extract output file path from the SDK placeholder result
          const outputText =
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          const outputFileMatch = outputText?.match(
            /output_file:\s*(.+?)(?:\n|$)/i,
          );

          const bgEvent: BackgroundAgentStartedEvent = {
            id: generateEventId(),
            eventType: 'background_agent_started',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'complete' as EventSource,
            messageId,
            toolCallId: block.tool_use_id,
            agentType: 'unknown', // Will be enriched by SubagentHookHandler
            outputFilePath: outputFileMatch?.[1]?.trim(),
            parentToolUseId: parent_tool_use_id ?? undefined,
          };
          events.push(bgEvent);

          this.logger.info(
            '[SdkMessageTransformer] Emitted background_agent_started event',
            {
              toolCallId: block.tool_use_id,
              outputFilePath: bgEvent.outputFilePath,
            },
          );
        }
      }
    }

    // 3. Emit message_complete with metadata
    const tokenUsage =
      message.usage &&
      'input_tokens' in message.usage &&
      'output_tokens' in message.usage
        ? {
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
          }
        : undefined;

    // Pass authEnv for provider-aware model resolution
    const cost = tokenUsage
      ? calculateMessageCost(
          this.modelResolver.resolveForPricing(message.model || ''),
          tokenUsage,
        )
      : undefined;

    const messageCompleteEvent: MessageCompleteEvent = {
      id: generateEventId(),
      eventType: 'message_complete',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId,
      stopReason: message.stop_reason ?? undefined,
      tokenUsage,
      cost,
      model: message.model,
      parentToolUseId: parent_tool_use_id ?? undefined,
    };
    events.push(messageCompleteEvent);

    return events;
  }

  /**
   * Transform user message to flat events
   *
   * Emits:
   * - message_start
   * - text_delta (with full text)
   * - tool_result events (for tool_result content blocks)
   * - message_complete
   *
   * Skips empty user messages (SDK sends these for tool result confirmations).
   * Extracts tool_result blocks from user messages.
   */
  private transformUserToFlatEvents(
    sdkMessage: SDKUserMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    const { uuid, message, parent_tool_use_id } = sdkMessage;

    const events: FlatStreamEventUnion[] = [];
    const messageId = uuid || `user-${Date.now()}`;

    // First, check for tool_result blocks in user messages.
    // SDK sends tool execution results as user messages with tool_result content blocks.
    // We MUST emit these as tool_result events, otherwise tools remain in streaming state.
    //
    // Note: UserMessageContent type is different from ContentBlock - it includes image blocks
    // but excludes ThinkingBlock. We use inline type check instead of isToolResultBlock guard.
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        // Inline type check for tool_result (UserMessageContent != ContentBlock)
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'tool_result' &&
          'tool_use_id' in block
        ) {
          const toolResultBlock = block as ToolResultBlock;
          const toolResultEvent: ToolResultEvent = {
            id: generateEventId(),
            eventType: 'tool_result',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'complete' as EventSource,
            messageId,
            toolCallId: toolResultBlock.tool_use_id,
            output: toolResultBlock.content,
            isError: toolResultBlock.is_error ?? false,
            parentToolUseId: parent_tool_use_id ?? undefined,
          };
          events.push(toolResultEvent);

          // Check if this tool_result is for a background Task tool_use
          if (this.backgroundTaskToolUseIds.has(toolResultBlock.tool_use_id)) {
            this.backgroundTaskToolUseIds.delete(toolResultBlock.tool_use_id);

            const outputText =
              typeof toolResultBlock.content === 'string'
                ? toolResultBlock.content
                : JSON.stringify(toolResultBlock.content);
            const outputFileMatch = outputText?.match(
              /output_file:\s*(.+?)(?:\n|$)/i,
            );

            const bgEvent: BackgroundAgentStartedEvent = {
              id: generateEventId(),
              eventType: 'background_agent_started',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              source: 'complete' as EventSource,
              messageId,
              toolCallId: toolResultBlock.tool_use_id,
              agentType: 'unknown',
              outputFilePath: outputFileMatch?.[1]?.trim(),
              parentToolUseId: parent_tool_use_id ?? undefined,
            };
            events.push(bgEvent);
          }
        }
      }

      // If we found tool_result blocks, return them without creating empty user message bubbles
      if (events.length > 0) {
        return events;
      }
    }

    // Extract text content from user message
    let textContent = '';
    if (typeof message.content === 'string') {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      // Concatenate text blocks
      // Filter for text blocks using inline check (UserMessageContent doesn't include ThinkingBlock)
      textContent = message.content
        .filter(
          (block): block is TextBlock =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'text' &&
            'text' in block,
        )
        .map((block) => block.text)
        .join('\n');
    }

    // Skip empty user messages (no text content AND no tool_result blocks).
    // This prevents empty "You" bubbles from appearing in the UI.
    if (!textContent || !textContent.trim()) {
      this.logger.debug('[SdkMessageTransformer] Skipping empty user message', {
        uuid,
      });
      return [];
    }

    // Include parentToolUseId on user message events.
    // When SDK invokes an agent, it sends a user message with the agent's prompt.
    // This message has parent_tool_use_id set, linking it to the parent Task tool.
    // We MUST include parentToolUseId so frontend filters these as nested messages.
    // Without this, the agent's internal prompt appears as a separate user bubble.
    const parentToolUseId = parent_tool_use_id ?? undefined;

    // 1. Emit message_start
    const messageStartEvent: MessageStartEvent = {
      id: generateEventId(),
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId: uuid || `user-${Date.now()}`,
      role: 'user',
      parentToolUseId,
    };
    events.push(messageStartEvent);

    // 2. Emit text_delta with full text
    const textDeltaEvent: TextDeltaEvent = {
      id: generateEventId(),
      eventType: 'text_delta',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId: uuid || `user-${Date.now()}`,
      delta: textContent,
      blockIndex: 0,
      parentToolUseId,
    };
    events.push(textDeltaEvent);

    // 3. Emit message_complete
    const messageCompleteEvent: MessageCompleteEvent = {
      id: generateEventId(),
      eventType: 'message_complete',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId: uuid || `user-${Date.now()}`,
      parentToolUseId,
    };
    events.push(messageCompleteEvent);

    return events;
  }

  /**
   * Clear streaming state - called for reset scenarios.
   * Clears all per-context tracking.
   */
  clearStreamingState(): void {
    this.currentMessageIdByContext.clear();
    this.currentModelByContext.clear();
    this.toolCallIdByContextAndBlock.clear();
    this.backgroundTaskToolUseIds.clear();
    this.activeSkillToolUseIds.clear();
    this.taskIdToParentToolUseId.clear();
    this.taskStartedEmitted.clear();
  }

  // ==========================================================================
  // SDK task_* message handlers
  // ==========================================================================

  /**
   * Handle SDK task_started — authoritative agent spawn notification.
   *
   * Registers the taskId → parentToolUseId mapping in the local registry.
   * Emits an AgentStartEvent enriched with taskId if one hasn't been emitted
   * yet for this parentToolUseId (dedupe guard against the legacy tool_result
   * correlation path). The existing tool_result path remains for non-Task agents.
   */
  private transformTaskStarted(
    msg: import('./types/sdk-types/claude-sdk.types').SDKTaskStartedMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    const toolUseId = msg.tool_use_id;

    // Register task_id → tool_use_id mapping for later messages
    if (toolUseId) {
      this.taskIdToParentToolUseId.set(msg.task_id, toolUseId);
      // Associate the SDK task_id with the registry record so that
      // SubagentMessageDispatcher can resolve stopSubagent calls by taskId.
      // SubagentRecord.taskId drives the Stop button guard in the UI
      // (canStop = status === 'running' && !!taskId).
      this.subagentRegistry.setTaskId(toolUseId, msg.task_id);
    }

    // Skip transcript-only tasks that should not appear in the chat UI
    if (msg.skip_transcript) {
      this.logger.debug(
        '[SdkMessageTransformer] task_started skip_transcript=true — skipping',
        { taskId: msg.task_id, toolUseId },
      );
      return [];
    }

    if (!toolUseId) {
      this.logger.debug(
        '[SdkMessageTransformer] task_started has no tool_use_id — skipping AgentStartEvent',
        { taskId: msg.task_id },
      );
      return [];
    }

    // Dedupe: if the legacy tool_result path already emitted an agent_start for
    // this toolUseId, do NOT emit a second one. Mark it as SDK-authoritative so
    // the tool_result path is suppressed from now on for this agent.
    if (this.taskStartedEmitted.has(toolUseId)) {
      return [];
    }
    this.taskStartedEmitted.add(toolUseId);

    const resolvedSession = sessionId ?? (msg.session_id as SessionId);
    const messageId =
      this.currentMessageIdByContext.get('') ?? `task_${msg.task_id}`;

    const event: AgentStartEvent = {
      id: generateEventId(),
      eventType: 'agent_start',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId,
      parentToolUseId: toolUseId,
      toolCallId: toolUseId,
      agentType: msg.task_type ?? 'Task',
      agentDescription: msg.description,
      agentPrompt: msg.prompt,
      taskId: msg.task_id,
    };

    this.logger.debug('[SdkMessageTransformer] task_started → agent_start', {
      taskId: msg.task_id,
      toolUseId,
    });

    return [event];
  }

  /**
   * Handle SDK task_progress — rolling progress update with optional summary.
   */
  private transformTaskProgress(
    msg: import('./types/sdk-types/claude-sdk.types').SDKTaskProgressMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    const parentToolUseId =
      msg.tool_use_id ?? this.taskIdToParentToolUseId.get(msg.task_id);

    if (!parentToolUseId) {
      this.logger.debug(
        '[SdkMessageTransformer] task_progress: no parentToolUseId, skipping',
        { taskId: msg.task_id },
      );
      return [];
    }

    const resolvedSession = sessionId ?? (msg.session_id as SessionId);

    const event: AgentProgressEvent = {
      id: generateEventId(),
      eventType: 'agent_progress',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId:
        this.currentMessageIdByContext.get('') ?? `task_${msg.task_id}`,
      parentToolUseId,
      taskId: msg.task_id,
      description: msg.description,
      summary: msg.summary,
      lastToolName: msg.last_tool_name,
      totalTokens: msg.usage.total_tokens,
      toolUses: msg.usage.tool_uses,
      durationMs: msg.usage.duration_ms,
    };

    return [event];
  }

  /**
   * Handle SDK task_updated — status patch for a running subagent.
   */
  private transformTaskUpdated(
    msg: import('./types/sdk-types/claude-sdk.types').SDKTaskUpdatedMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    const parentToolUseId = this.taskIdToParentToolUseId.get(msg.task_id);

    if (!parentToolUseId) {
      this.logger.debug(
        '[SdkMessageTransformer] task_updated: no parentToolUseId, skipping',
        { taskId: msg.task_id },
      );
      return [];
    }

    const patch = msg.patch;
    if (!patch.status) {
      // No status change — nothing useful for the frontend right now
      return [];
    }

    const resolvedSession = sessionId ?? (msg.session_id as SessionId);

    const event: AgentStatusEvent = {
      id: generateEventId(),
      eventType: 'agent_status',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId:
        this.currentMessageIdByContext.get('') ?? `task_${msg.task_id}`,
      parentToolUseId,
      taskId: msg.task_id,
      status: patch.status,
      description: patch.description,
      errorMessage: patch.error,
    };

    return [event];
  }

  /**
   * Handle SDK task_notification — definitive subagent completion.
   *
   * Cleans up the taskId registry entry and emits AgentCompletedEvent.
   */
  private transformTaskNotification(
    msg: import('./types/sdk-types/claude-sdk.types').SDKTaskNotificationMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    const parentToolUseId =
      msg.tool_use_id ?? this.taskIdToParentToolUseId.get(msg.task_id);

    // Clean up registry regardless of whether we emit
    this.taskIdToParentToolUseId.delete(msg.task_id);

    if (msg.skip_transcript) {
      return [];
    }

    if (!parentToolUseId) {
      this.logger.debug(
        '[SdkMessageTransformer] task_notification: no parentToolUseId, skipping',
        { taskId: msg.task_id, status: msg.status },
      );
      return [];
    }

    const resolvedSession = sessionId ?? (msg.session_id as SessionId);

    const event: AgentCompletedEvent = {
      id: generateEventId(),
      eventType: 'agent_completed',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId:
        this.currentMessageIdByContext.get('') ?? `task_${msg.task_id}`,
      parentToolUseId,
      taskId: msg.task_id,
      status: msg.status,
      summary: msg.summary,
      outputFile: msg.output_file,
      totalTokens: msg.usage?.total_tokens,
      toolUses: msg.usage?.tool_uses,
      durationMs: msg.usage?.duration_ms,
    };

    this.logger.debug(
      '[SdkMessageTransformer] task_notification → agent_completed',
      { taskId: msg.task_id, status: msg.status },
    );

    return [event];
  }
}
