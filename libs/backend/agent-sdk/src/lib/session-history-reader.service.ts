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
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import type { FlatStreamEventUnion, AuthEnv } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { extractTokenUsage } from './helpers/usage-extraction.utils';
import {
  calculateMessageCost,
  pickPrimaryModel,
  isDirectAnthropic,
  registerProviderPricing,
  findModelPricing,
  type ModelUsageEntry,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from './di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { SdkError } from './errors';
import type { IModelResolver } from './auth-env.port';
import type { IPricingProvider } from './pricing.port';
import type { JsonlReaderService } from './helpers/history/jsonl-reader.service';
import type { SessionReplayService } from './helpers/history/session-replay.service';
import type { HistoryEventFactory } from './helpers/history/history-event-factory';
import type {
  SessionHistoryMessage,
  AgentSessionData,
} from './helpers/history/history.types';

/**
 * Phrase used in the SdkError thrown by resolveNativeMessageId() when
 * upToMessageId cannot be matched in the JSONL transcript. Referenced at the
 * throw site and in the session-rpc fork-session catch block so both stay in
 * sync if the message ever changes.
 */
export const MESSAGE_ID_NOT_FOUND_PHRASE =
  'not found in session history' as const;

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
    private readonly eventFactory: HistoryEventFactory,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: IModelResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.PRICING_PROVIDER)
    private readonly pricingProvider: IPricingProvider,
  ) {}

  /**
   * Validate sessionId to prevent path traversal attacks.
   *
   * @param sessionId - Session identifier to validate
   * @throws Error if sessionId is invalid or contains path traversal characters
   */
  private validateSessionId(sessionId: string): void {
    if (!sessionId || !this.SESSION_ID_PATTERN.test(sessionId)) {
      throw new SdkError(`Invalid sessionId format: ${sessionId}`);
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
    workspacePath: string,
  ): Promise<{
    events: FlatStreamEventUnion[];
    stats: {
      totalCost: number | null;
      tokens: {
        input: number;
        output: number;
        cacheRead: number;
        cacheCreation: number;
      };
      messageCount: number;
      model?: string;
      /** Number of agent/subagent JSONL files found for this session */
      agentSessionCount?: number;
      /** Per-model token and cost breakdown for multi-model sessions */
      modelUsageList?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        costUSD: number | null;
      }>;
    } | null;
  }> {
    try {
      this.validateSessionId(sessionId);
      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return { events: [], stats: null };
      }
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
      const agentSessions = await this.jsonlReader.loadAgentSessions(
        sessionsDir,
        sessionId,
      );
      const events = this.replayService.replayToStreamEvents(
        sessionId,
        mainMessages,
        agentSessions,
      );
      if (isDirectAnthropic(this.authEnv)) {
        await this.hydrateMissingPricing(mainMessages, agentSessions);
      }
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
        error instanceof Error ? error : new Error(String(error)),
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
    workspacePath: string,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    return this.readHistoryMessages(sessionId, workspacePath, (content) =>
      this.eventFactory.extractTextContent(content),
    );
  }

  /**
   * Like {@link readHistoryAsMessages} but includes `tool_use`/`tool_result`
   * blocks (via {@link HistoryEventFactory.extractContentForCuration}). Used by
   * the memory curator's transcript reader so curation — including the
   * boot-scan over historical sessions, whose only data source is this JSONL —
   * captures tool inputs/outputs, not just assistant text. NOT for UI use: the
   * UI history view must stay text-only via {@link readHistoryAsMessages}.
   */
  async readHistoryForCuration(
    sessionId: string,
    workspacePath: string,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    return this.readHistoryMessages(sessionId, workspacePath, (content) =>
      this.eventFactory.extractContentForCuration(content),
    );
  }

  /**
   * Shared implementation for {@link readHistoryAsMessages} and
   * {@link readHistoryForCuration}: read the session JSONL, drop everything
   * before the last compaction boundary, and map each user/assistant message
   * to `{ id, role, content, timestamp }` using the supplied content extractor.
   * The extractor is the ONLY behavioural difference between the two public
   * variants (text-only vs tool-aware).
   */
  private async readHistoryMessages(
    sessionId: string,
    workspacePath: string,
    extractContent: (content: unknown) => string,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    try {
      this.validateSessionId(sessionId);

      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return [];
      }
      const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
      const rawMessages = await this.jsonlReader.readJsonlMessages(sessionFile);
      let startIndex = 0;
      for (let i = rawMessages.length - 1; i >= 0; i--) {
        if (
          rawMessages[i].type === 'system' &&
          rawMessages[i].subtype === 'compact_boundary'
        ) {
          startIndex = i + 1;
          this.logger.info(
            `[SessionHistoryReader] Found compact_boundary at index ${i}, skipping pre-compaction messages`,
          );
          break;
        }
      }
      const effectiveMessages =
        startIndex > 0 ? rawMessages.slice(startIndex) : rawMessages;
      const messages: {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
      }[] = [];

      for (const msg of effectiveMessages) {
        if (!msg.message?.role) continue;

        const role = msg.message.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const content = extractContent(msg.message.content);
        if (!content) continue;
        if (content.trimStart().startsWith('<task-notification>')) continue;

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
        error instanceof Error ? error : new Error(String(error)),
      );
      return [];
    }
  }

  /**
   * Regex matching a Claude Agent SDK transcript line UUID — the value the
   * SDK's `forkSession()` accepts as `upToMessageId`. The SDK matches it
   * against each transcript line's `uuid` field and validates it with this
   * exact shape (a standard UUID). It REJECTS Anthropic `msg_...` message ids
   * and Ptah-generated `msg_<timestamp>_<random>` fallbacks.
   */
  private readonly LINE_UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Resolve a message ID sent by the frontend to the transcript line UUID that
   * the Claude Agent SDK's `forkSession()` will accept.
   *
   * The SDK fork anchor is a transcript LINE uuid (standard UUID), matched via
   * `entry.uuid === upToMessageId`. The frontend may send one of:
   *   - A line UUID (history view sources `id = msg.uuid`, and live streaming
   *     can carry the SDK message `uuid`). This is already valid → return as-is.
   *   - An Anthropic message id (`msg_01...`, from a live assistant
   *     `message.id`). Map it to the owning line's `uuid`.
   *   - A Ptah-generated fallback (`msg_<timestamp>_<random>`, assigned during
   *     replay when a JSONL line had no `uuid`). No valid anchor of its own →
   *     walk backward to the nearest preceding line that has a real line UUID.
   *
   * @param sessionId - Session to search in
   * @param workspacePath - Workspace root for locating the JSONL file
   * @param upToMessageId - ID provided by the frontend
   * @returns Resolved transcript line UUID accepted by `forkSession()`
   * @throws SdkError if the ID cannot be resolved
   */
  async resolveNativeMessageId(
    sessionId: string,
    workspacePath: string,
    upToMessageId: string,
  ): Promise<string> {
    if (this.LINE_UUID_PATTERN.test(upToMessageId)) {
      return upToMessageId;
    }

    this.logger.info(
      '[SessionHistoryReader] Non-line-UUID upToMessageId â€” resolving via JSONL scan',
      { sessionId, upToMessageId },
    );
    this.validateSessionId(sessionId);
    const sessionsDir =
      await this.jsonlReader.findSessionsDirectory(workspacePath);
    if (!sessionsDir) {
      throw new SdkError(
        `upToMessageId '${upToMessageId}' cannot be resolved: sessions directory not found for workspace '${workspacePath}'`,
      );
    }
    const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
    let messages: SessionHistoryMessage[];
    try {
      messages = await this.jsonlReader.readJsonlMessages(sessionPath);
    } catch {
      throw new SdkError(
        `upToMessageId '${upToMessageId}' cannot be resolved: session file not found for session '${sessionId}'`,
      );
    }
    let matchIndex = messages.findIndex((m) => m.message?.id === upToMessageId);
    if (matchIndex === -1) {
      matchIndex = messages.findIndex((m) => m.uuid === upToMessageId);
    }
    if (matchIndex === -1) {
      throw new SdkError(
        `upToMessageId '${upToMessageId}' ${MESSAGE_ID_NOT_FOUND_PHRASE} for session '${sessionId}'. ` +
          'The message may belong to a different session or the history may have been compacted.',
      );
    }
    for (let i = matchIndex; i >= 0; i--) {
      const candidate = messages[i].uuid;
      if (candidate && this.LINE_UUID_PATTERN.test(candidate)) {
        this.logger.info(
          '[SessionHistoryReader] Resolved upToMessageId to transcript line UUID',
          {
            sessionId,
            upToMessageId,
            resolvedId: candidate,
            matchIndex,
            resolvedIndex: i,
          },
        );
        return candidate;
      }
    }
    throw new SdkError(
      `upToMessageId '${upToMessageId}' found in session history at index ${matchIndex} ` +
        `but no native SDK UUID exists at or before that position in session '${sessionId}'. ` +
        'Fork is not supported at this checkpoint.',
    );
  }

  private async hydrateMissingPricing(
    mainMessages: SessionHistoryMessage[],
    agentSessions: AgentSessionData[],
  ): Promise<void> {
    const models = new Set<string>();
    let detectedModel: string | undefined;
    for (const msg of mainMessages) {
      if (
        !detectedModel &&
        msg.type === 'system' &&
        msg.subtype === 'init' &&
        msg.model
      ) {
        detectedModel = String(msg.model);
      }
      if (msg.type === 'assistant' && msg.message?.model) {
        models.add(String(msg.message.model));
      }
    }
    for (const agent of agentSessions) {
      for (const msg of agent.messages) {
        if (msg.type === 'assistant' && msg.message?.model) {
          models.add(String(msg.message.model));
        }
      }
    }
    if (detectedModel) {
      models.add(detectedModel);
    }
    const missing: string[] = [];
    for (const rawModel of models) {
      const resolved = this.modelResolver.resolveForPricing(rawModel);
      if (!findModelPricing(resolved)) {
        missing.push(resolved);
      }
    }
    if (missing.length === 0) {
      return;
    }
    const results = await Promise.all(
      missing.map(async (modelId) => {
        try {
          const pricing = await this.pricingProvider.getPricing(modelId);
          return pricing ? ([modelId, pricing] as const) : null;
        } catch {
          return null;
        }
      }),
    );
    const hydrated: Record<string, ReturnType<typeof findModelPricing>> = {};
    let hits = 0;
    for (const entry of results) {
      if (entry) {
        hydrated[entry[0]] = entry[1];
        hits++;
      }
    }
    if (hits > 0) {
      registerProviderPricing(
        hydrated as Parameters<typeof registerProviderPricing>[0],
      );
      this.logger.info(
        '[SessionHistoryReader] Hydrated historical pricing via IPricingProvider',
        { hydratedCount: hits, missingCount: missing.length },
      );
    }
  }

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
    agentSessions: AgentSessionData[],
  ): {
    totalCost: number | null;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    messageCount: number;
    model?: string;
    agentSessionCount?: number;
    modelUsageList?: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number | null;
    }>;
  } | null {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let messageCount = 0;
    let hasAnyUsage = false;
    let detectedModel: string | undefined;
    const perModelUsage = new Map<
      string,
      {
        input: number;
        output: number;
        cost: number;
        hasCostContribution: boolean;
      }
    >();

    const accumulatePerModel = (
      rawModel: string,
      input: number,
      output: number,
      cacheRead: number,
      cacheCreation: number,
    ): void => {
      const resolvedModel = this.modelResolver.resolveForPricing(rawModel);
      const modelKey = resolvedModel || rawModel || 'unknown';
      const existing = perModelUsage.get(modelKey) || {
        input: 0,
        output: 0,
        cost: 0,
        hasCostContribution: false,
      };
      existing.input += input;
      existing.output += output;
      const contribution = calculateMessageCost(resolvedModel, {
        input,
        output,
        cacheHit: cacheRead,
        cacheCreation,
      });
      if (contribution !== null) {
        existing.cost += contribution;
        existing.hasCostContribution = true;
      }
      perModelUsage.set(modelKey, existing);
    };
    let statsStartIndex = 0;
    for (let i = mainMessages.length - 1; i >= 0; i--) {
      if (
        mainMessages[i].type === 'system' &&
        mainMessages[i].subtype === 'compact_boundary'
      ) {
        statsStartIndex = i + 1;
        break;
      }
    }
    const effectiveStatsMessages =
      statsStartIndex > 0 ? mainMessages.slice(statsStartIndex) : mainMessages;
    for (const msg of mainMessages) {
      if (
        !detectedModel &&
        msg.type === 'system' &&
        msg.subtype === 'init' &&
        msg.model
      ) {
        detectedModel = String(msg.model);
        break;
      }
    }
    for (const msg of effectiveStatsMessages) {
      if (msg.usage) {
        hasAnyUsage = true;
        const tokens = extractTokenUsage(msg.usage);
        if (tokens) {
          totalInput += tokens.input;
          totalOutput += tokens.output;
          totalCacheRead += tokens.cacheRead ?? 0;
          totalCacheCreation += tokens.cacheCreation ?? 0;
          const msgModel =
            msg.type === 'assistant'
              ? msg.message?.model || detectedModel || ''
              : detectedModel || '';
          if (msgModel) {
            accumulatePerModel(
              msgModel,
              tokens.input,
              tokens.output,
              tokens.cacheRead ?? 0,
              tokens.cacheCreation ?? 0,
            );
          }
        }
      }
      if (msg.type === 'assistant') {
        messageCount++;
      }
    }
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
            const agentMsgModel =
              msg.type === 'assistant'
                ? msg.message?.model || detectedModel || ''
                : detectedModel || '';
            if (agentMsgModel) {
              accumulatePerModel(
                agentMsgModel,
                tokens.input,
                tokens.output,
                tokens.cacheRead ?? 0,
                tokens.cacheCreation ?? 0,
              );
            }
          }
        }
      }
    }

    if (!hasAnyUsage) {
      return null;
    }
    const modelUsageList: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number | null;
    }> = Array.from(perModelUsage.entries())
      .map(([model, usage]) => ({
        model,
        inputTokens: usage.input,
        outputTokens: usage.output,
        costUSD: usage.hasCostContribution ? usage.cost : null,
      }))
      .sort((a, b) => (b.costUSD ?? -1) - (a.costUSD ?? -1));
    const primaryModelEntries: ModelUsageEntry[] = modelUsageList.map((m) => ({
      model: m.model,
      totalCost: m.costUSD ?? 0,
      tokens: { input: m.inputTokens, output: m.outputTokens },
    }));
    const primaryModel = pickPrimaryModel(primaryModelEntries) ?? detectedModel;
    let totalCost: number | null;
    if (modelUsageList.length > 0) {
      const contributors = modelUsageList.filter((m) => m.costUSD !== null);
      totalCost =
        contributors.length > 0
          ? contributors.reduce((sum, entry) => sum + (entry.costUSD ?? 0), 0)
          : null;
    } else {
      totalCost = calculateMessageCost(
        this.modelResolver.resolveForPricing(detectedModel || ''),
        {
          input: totalInput,
          output: totalOutput,
          cacheHit: totalCacheRead,
          cacheCreation: totalCacheCreation,
        },
      );
    }

    return {
      totalCost,
      tokens: {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheCreation: totalCacheCreation,
      },
      messageCount,
      model: primaryModel,
      agentSessionCount: agentSessions.length,
      ...(modelUsageList.length > 0 && { modelUsageList }),
    };
  }
}
