/**
 * SessionHistoryReaderService - Facade for session history reading
 *
 * This service provides the public API for reading session history from Claude JSONL files
 * and converting them to FlatStreamEventUnion format. It delegates to specialized child
 * services for the actual work:
 *
 * - JsonlReaderService: File I/O operations (find directory, read JSONL, load agents)
 * - SessionReplayService: Event conversion and sequencing
 * - HistoryEventFactory: Event creation and content extraction (used for readHistoryForCuration)
 *
 * Architecture: Facade pattern with injected child services
 * The frontend ExecutionTreeBuilder processes these events exactly as it would
 * live streaming events - no UI changes required.
 *
 * Public API:
 * - readSessionHistory(sessionId, workspacePath, options?): Promise<{events, stats, staleSnapshot?}>
 *   — the `chat:resume` transcript (events only; TASK_2026_437 C15)
 * - readHistoryForCuration(sessionId, workspacePath, options?): Promise<{id, role, content, timestamp}[]>
 *   — the memory curator's tool-aware text projection
 *
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import type {
  FlatStreamEventUnion,
  AuthEnv,
  MessageAnchorHint,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { extractTokenUsage } from './helpers/usage-extraction.utils';
import {
  getModelContextWindow,
  isDirectAnthropic,
  registerProviderPricing,
  findModelPricing,
  type SessionStatsEntry,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from './di/tokens';
import { aggregateSessionUsage } from './session-stats/session-usage-aggregator';
import {
  SessionUsageLedgerBuilder,
  type SessionUsageLedger,
} from './session-stats/session-usage-ledger';
import {
  parseSavedCostState,
  type SavedCostState,
  type SessionStatsOwnerService,
  type SessionStatsPrefix,
} from './session-stats/session-stats-owner.service';
import { isHiddenTranscriptRecord } from './message-transform/message-transform-helpers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { SdkError } from './errors';
import type { IModelResolver } from './auth-env.port';
import type { IPricingProvider } from './pricing.port';
import type { LiveUsageTracker } from './helpers/live-usage-tracker';
import type {
  CompactionBoundaryGenerationRegistry,
  ExpectationOutcome,
  PendingExpectation,
} from './helpers/compaction-boundary-generation-registry';
import type { JsonlReaderService } from './helpers/history/jsonl-reader.service';
import type { SessionReplayService } from './helpers/history/session-replay.service';
import type { HistoryEventFactory } from './helpers/history/history-event-factory';
import {
  SessionHistoryReadTiming,
  type HistoryReadStopwatch,
} from './helpers/history/session-history-read-timing';
import type {
  SessionHistoryMessage,
  AgentSessionData,
  UnreadableAgentMember,
} from './helpers/history/history.types';

const MAX_COMPACTION_RETRIES = 5;
const MISSING_SESSION_LOG = '[SessionHistoryReader] Session file not found';

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Phrase used in the SdkError thrown by resolveNativeMessageId() when
 * upToMessageId cannot be matched in the JSONL transcript. Referenced at the
 * throw site and in the session-rpc fork-session catch block so both stay in
 * sync if the message ever changes.
 */
export const MESSAGE_ID_NOT_FOUND_PHRASE =
  'not found in session history' as const;

/**
 * Bounds a history read to the END of the transcript.
 *
 * Absent `tailBytes` the whole transcript is read, which is what every UI and
 * replay path wants. A caller that then throws most of it away — the memory
 * curator keeps 32 KB — must pass a window instead, because the discarded
 * work is a synchronous parse on the backend main thread that grows with the
 * session (TASK_2026_323, B4).
 */
export interface TranscriptWindowOptions {
  /** Read only the last N bytes of the JSONL. Omit to read everything. */
  readonly tailBytes?: number;
  /** Aborts the read between parse batches. */
  readonly signal?: AbortSignal;
}

type SessionEventData = {
  readonly events: FlatStreamEventUnion[];
  readonly mainMessages: SessionHistoryMessage[];
  readonly agentSessions: AgentSessionData[];
  /** Member transcripts that could not be read (TASK_2026_533). */
  readonly unreadableAgents: readonly UnreadableAgentMember[];
  readonly staleSnapshot?: true;
};
@injectable()
export class SessionHistoryReaderService {
  /**
   * Regex pattern for valid session IDs.
   * Session IDs should only contain alphanumeric characters, underscores, and hyphens.
   * This prevents path traversal attacks (e.g., "../../../etc/passwd").
   */
  private readonly SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  private readonly readTiming: SessionHistoryReadTiming;

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
    @inject(SDK_TOKENS.SDK_LIVE_USAGE_TRACKER)
    private readonly usageTracker: LiveUsageTracker,
    @inject(SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY)
    private readonly compactionBoundaryRegistry: CompactionBoundaryGenerationRegistry,
    /** Single authority for session stats; a history read seeds its prefix. */
    @inject(SDK_TOKENS.SDK_SESSION_STATS_OWNER)
    private readonly statsOwner: SessionStatsOwnerService,
  ) {
    this.readTiming = new SessionHistoryReadTiming(logger);
  }

  /**
   * Validate sessionId to prevent path traversal attacks.
   *
   * @param sessionId - Session identifier to validate
   * @throws Error if sessionId is invalid or contains path traversal characters
   */
  private validateSessionId(sessionId: string): void {
    if (!this.isValidSessionId(sessionId)) {
      throw new SdkError(`Invalid sessionId format: ${sessionId}`);
    }
  }

  /**
   * Non-throwing form of {@link validateSessionId}, for callers that treat a
   * bad id as "no history" rather than as an error.
   */
  private isValidSessionId(sessionId: string): boolean {
    return !!sessionId && this.SESSION_ID_PATTERN.test(sessionId);
  }

  /**
   * Read session history and convert to FlatStreamEventUnion events with stats.
   *
   * Returns a single immutable snapshot containing events and aggregated
   * usage stats from one JSONL parse. It builds no `{ id, role, content }`
   * projection: `chat:resume` replays `events` and nothing else
   * (TASK_2026_437 C15). When `options.checkCompactionBoundary`
   * is true the reader verifies the expected compact-boundary generation with a
   * small bounded number of event-loop yields; if the expected count is not
   * observed the snapshot carries `staleSnapshot: true`.
   *
   * @param sessionId - Session identifier
   * @param workspacePath - Workspace path for locating session files
   * @param options - Optional read controls
   * @returns Object with events, aggregated stats, and optional stale flag
   */
  async readSessionHistory(
    sessionId: string,
    workspacePath: string,
    options?: { checkCompactionBoundary?: boolean },
  ): Promise<{
    events: FlatStreamEventUnion[];
    /**
     * The session's lifetime accounting snapshot (TASK_2026_533): the stats
     * owner's snapshot when the session already has a running owner,
     * otherwise this transcript's aggregate. `null` when the transcript has
     * no usage at all.
     */
    stats: SessionStatsEntry | null;
    staleSnapshot?: true;
  }> {
    const checkCompactionBoundary = options?.checkCompactionBoundary ?? false;
    let expectation: PendingExpectation | undefined;
    let staleSnapshot: true | undefined;
    // Slow-read attribution (TASK_2026_437 C13) — see session-history-read-timing.ts.
    const timing = this.readTiming.begin(sessionId);

    try {
      if (checkCompactionBoundary) {
        expectation =
          this.compactionBoundaryRegistry.capturePendingExpectation(sessionId);
      }
      const loaded = await this.loadSessionEventData(
        sessionId,
        workspacePath,
        (sessionPath) =>
          this.readMainMessagesWithOptionalCompactionCheck(
            sessionId,
            sessionPath,
            expectation,
          ),
        timing,
      );
      if (!loaded) {
        this.consumeCompactionExpectation(
          sessionId,
          checkCompactionBoundary,
          expectation ? 'stale' : 'none',
        );
        return {
          events: [],
          stats: null,
          staleSnapshot:
            checkCompactionBoundary && expectation !== undefined
              ? true
              : undefined,
        };
      }
      const { events, mainMessages, agentSessions, unreadableAgents } = loaded;
      staleSnapshot = loaded.staleSnapshot;
      if (isDirectAnthropic(this.authEnv)) {
        timing.begin('pricing');
        await this.hydrateMissingPricing(mainMessages, agentSessions);
      }
      timing.begin('project');
      const stats = this.publishHistoryStats(
        sessionId,
        mainMessages,
        agentSessions,
        unreadableAgents,
      );
      this.seedLiveUsageBaseline(sessionId, mainMessages);
      timing.finish(false);

      this.consumeCompactionExpectation(
        sessionId,
        checkCompactionBoundary,
        staleSnapshot ? 'stale' : expectation ? 'satisfied' : 'none',
      );

      this.logger.info('[SessionHistoryReader] Loaded session with stats', {
        sessionId,
        eventCount: events.length,
        hasStats: !!stats,
        totalCost: stats?.totalCost,
        totalTokens: (stats?.tokens?.input ?? 0) + (stats?.tokens?.output ?? 0),
        staleSnapshot,
      });

      return { events, stats, staleSnapshot };
    } catch (error) {
      timing.finish(true);
      this.consumeCompactionExpectation(
        sessionId,
        checkCompactionBoundary,
        expectation ? 'stale' : 'none',
      );
      this.logger.error(
        '[SessionHistoryReader] Failed to read session history',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        events: [],
        stats: null,
        staleSnapshot:
          checkCompactionBoundary && expectation !== undefined
            ? (staleSnapshot ?? true)
            : undefined,
      };
    }
  }

  /**
   * The fixed history prefix for a cold-resumed query run: the transcript's
   * lifetime usage aggregate, its subagent identities and its last saved SDK
   * `cost-state`. Reads the transcripts but replays nothing.
   *
   * Returns `null` when the transcript cannot be read (invalid id, no
   * sessions directory, missing file, I/O failure) — the caller's owner then
   * reports the prefix as unknown, never as an empty zero.
   */
  async readSessionUsagePrefix(
    sessionId: string,
    workspacePath: string,
  ): Promise<SessionStatsPrefix | null> {
    if (!this.isValidSessionId(sessionId)) {
      this.logger.warn(
        '[SessionHistoryReader] Invalid sessionId, skipping usage prefix read',
        { sessionId },
      );
      return null;
    }
    try {
      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) return null;
      let mainMessages: SessionHistoryMessage[];
      try {
        mainMessages = await this.jsonlReader.readJsonlMessages(
          path.join(sessionsDir, `${sessionId}.jsonl`),
        );
      } catch (error: unknown) {
        if (!isMissingFileError(error)) throw error;
        this.logger.warn(MISSING_SESSION_LOG, { sessionId });
        return null;
      }
      const unreadableAgents: UnreadableAgentMember[] = [];
      const agentSessions = await this.jsonlReader.loadAgentSessions(
        sessionsDir,
        sessionId,
        (member) => unreadableAgents.push(member),
      );
      if (isDirectAnthropic(this.authEnv)) {
        await this.hydrateMissingPricing(mainMessages, agentSessions);
      }
      return this.buildUsagePrefix(
        sessionId,
        mainMessages,
        agentSessions,
        unreadableAgents,
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionHistoryReader] Could not read the usage prefix for resume',
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  /**
   * The main transcript's LAST `cost-state` entry — the raw SDK running
   * totals a process about to start can restore from. Re-read before every
   * later query run of an owner, so the restore candidate is what is on disk
   * now; the owner's frozen prefix is never rebuilt from it.
   *
   * Streams the file and parses only `cost-state` lines. `null` when there is
   * none, the last one is malformed, or the transcript cannot be read.
   */
  async readLastSavedCostState(
    sessionId: string,
    workspacePath: string,
  ): Promise<SavedCostState | null> {
    if (!this.isValidSessionId(sessionId)) return null;
    try {
      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) return null;
      let last: SavedCostState | null = null;
      await this.jsonlReader.projectJsonlLines(
        path.join(sessionsDir, `${sessionId}.jsonl`),
        (line) => {
          if (!line.includes('"cost-state"')) return;
          const raw = parseJsonObject(line);
          if (raw?.['type'] === 'cost-state') {
            last = parseSavedCostState(raw);
          }
        },
      );
      return last;
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionHistoryReader] Could not read the saved cost state for a new run',
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  async readSessionEvents(
    sessionId: string,
    workspacePath: string,
  ): Promise<FlatStreamEventUnion[]> {
    const loaded = await this.loadSessionEventData(
      sessionId,
      workspacePath,
      async (sessionPath) => ({
        messages: await this.jsonlReader.readJsonlMessages(sessionPath),
      }),
    );
    return loaded?.events ?? [];
  }

  private async loadSessionEventData(
    sessionId: string,
    workspacePath: string,
    readMainMessages: (
      sessionPath: string,
    ) => Promise<{ messages: SessionHistoryMessage[]; staleSnapshot?: true }>,
    timing?: HistoryReadStopwatch,
  ): Promise<SessionEventData | null> {
    this.validateSessionId(sessionId);
    const sessionsDir =
      await this.jsonlReader.findSessionsDirectory(workspacePath);
    if (!sessionsDir) {
      this.logger.warn('[SessionHistoryReader] Sessions directory not found');
      return null;
    }
    let main:
      | { messages: SessionHistoryMessage[]; staleSnapshot?: true }
      | undefined;
    try {
      main = await readMainMessages(
        path.join(sessionsDir, `${sessionId}.jsonl`),
      );
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
      this.logger.warn(MISSING_SESSION_LOG, { sessionId });
    }
    if (!main) return null;
    const { messages: mainMessages, staleSnapshot } = main;
    const unreadableAgents: UnreadableAgentMember[] = [];
    const agentSessions = await this.jsonlReader.loadAgentSessions(
      sessionsDir,
      sessionId,
      (member) => unreadableAgents.push(member),
    );
    timing?.readDone(mainMessages.length, agentSessions.length);
    timing?.begin('project');
    const events = this.replayService.replayToStreamEvents(
      sessionId,
      mainMessages,
      agentSessions,
    );
    timing?.events(events.length);
    return {
      events,
      mainMessages,
      agentSessions,
      unreadableAgents,
      staleSnapshot,
    };
  }

  /**
   * Read the main transcript, optionally verifying that the expected
   * compact-boundary generation is present. Captures the pending expectation
   * before observing the count, records the observed count on every parse,
   * and yields to the event loop a bounded number of times when the expectation
   * is unmet.
   */
  private async readMainMessagesWithOptionalCompactionCheck(
    sessionId: string,
    sessionPath: string,
    expectation: PendingExpectation | undefined,
  ): Promise<{
    messages: SessionHistoryMessage[];
    staleSnapshot: true | undefined;
  }> {
    let mainMessages = await this.jsonlReader.readJsonlMessages(sessionPath);
    let observedBoundaryCount = this.countCompactBoundaries(mainMessages);
    this.compactionBoundaryRegistry.observeBoundaryCount(
      sessionId,
      observedBoundaryCount,
      this.latestCompactBoundaryId(mainMessages),
    );

    if (expectation === undefined) {
      return { messages: mainMessages, staleSnapshot: undefined };
    }

    if (expectation.kind === 'unverified') {
      // A baseline-absent expectation can never be satisfied by the current
      // parse: we do not know what the next boundary count should be.
      return { messages: mainMessages, staleSnapshot: true };
    }

    if (observedBoundaryCount >= expectation.expectedCount) {
      return { messages: mainMessages, staleSnapshot: undefined };
    }

    for (let attempt = 1; attempt <= MAX_COMPACTION_RETRIES; attempt++) {
      await yieldToEventLoop();
      mainMessages = await this.jsonlReader.readJsonlMessages(sessionPath);
      observedBoundaryCount = this.countCompactBoundaries(mainMessages);
      this.compactionBoundaryRegistry.observeBoundaryCount(
        sessionId,
        observedBoundaryCount,
        this.latestCompactBoundaryId(mainMessages),
      );
      if (observedBoundaryCount >= expectation.expectedCount) {
        return { messages: mainMessages, staleSnapshot: undefined };
      }
    }

    return { messages: mainMessages, staleSnapshot: true };
  }

  private countCompactBoundaries(
    mainMessages: readonly SessionHistoryMessage[],
  ): number {
    return mainMessages.filter(
      (m) => m.type === 'system' && m.subtype === 'compact_boundary',
    ).length;
  }

  private latestCompactBoundaryId(
    mainMessages: readonly SessionHistoryMessage[],
  ): string | undefined {
    for (let index = mainMessages.length - 1; index >= 0; index--) {
      const message = mainMessages[index];
      if (
        message.type === 'system' &&
        message.subtype === 'compact_boundary' &&
        message.uuid
      ) {
        return message.uuid;
      }
    }
    return undefined;
  }

  private consumeCompactionExpectation(
    sessionId: string,
    checkCompactionBoundary: boolean,
    outcome: ExpectationOutcome,
  ): void {
    if (checkCompactionBoundary) {
      this.compactionBoundaryRegistry.consumeExpectation(sessionId, outcome);
    }
  }

  /**
   * Project raw JSONL messages to the simple `{ id, role, content, timestamp }`
   * shape returned by {@link readHistoryForCuration} (via {@link readHistoryMessages}).
   * Drops everything before the last `compact_boundary` and skips non-user/
   * non-assistant roles, empty content, and task-notification content.
   */
  private projectHistoryMessages(
    rawMessages: readonly SessionHistoryMessage[],
    extractContent: (content: unknown) => string,
  ): {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }[] {
    let startIndex = 0;
    for (let i = rawMessages.length - 1; i >= 0; i--) {
      if (
        rawMessages[i].type === 'system' &&
        rawMessages[i].subtype === 'compact_boundary'
      ) {
        startIndex = i + 1;
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
      // Meta and synthetic records are an internal cue, not conversation.
      // Replay suppresses both through the SAME predicate, so projecting either
      // here broke event/message parity: the projected messages showed
      // artifacts replay hides (PR #493 review C; the `isMeta` half was left
      // open by the first fix and is round-2 verification Moderate-2).
      if (isHiddenTranscriptRecord(msg)) continue;
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
  }

  /**
   * Hand `LiveUsageTracker` a starting figure for a session this process has
   * not seen stream (TASK_2026_374).
   *
   * ## Why the write is here
   *
   * `CompactionHookHandler` samples `getCumulativeTokens` on the SDK's
   * transport path: it may not do file I/O and may not throw, so it cannot go
   * and find this number itself, and for a session resumed from JSONL the
   * tracker had nothing — a manual `/compact` published `preTokens: 0` and the
   * frontend's pre/post delta had no baseline. This method is the only place in
   * `agent-sdk` that has already parsed the transcript for exactly these
   * fields, so the seed costs no extra read and no extra syscall. `chat:resume`
   * calls `readSessionHistory` before the user can type `/compact`, which is
   * what makes the baseline present when the hook needs it.
   *
   * ## Why the LAST frame and not the aggregate
   *
   * The tracker holds one request's usage frame (`recordSessionUsage` keeps a
   * per-field max of `message_start` / `message_delta` counts), so the seed has
   * to be the same shape. {@link aggregateUsageStats} SUMS every message: with
   * prompt caching its `cacheRead` total runs into the millions on a long
   * session, and publishing that as `preTokens` would be a confidently wrong
   * answer where 0 was merely an empty one. The last frame before the end of
   * the transcript is the session's context size — the quantity
   * `compact_metadata.pre_tokens` reports at the boundary.
   *
   * Messages before the last `compact_boundary` are not evidence about the
   * CURRENT context, so a scan that reaches one stops and seeds nothing: after
   * a compaction with no assistant turn since, "unknown" is the honest answer
   * and 0 is the correct published value.
   */
  private seedLiveUsageBaseline(
    sessionId: string,
    mainMessages: readonly SessionHistoryMessage[],
  ): void {
    for (let i = mainMessages.length - 1; i >= 0; i--) {
      const msg = mainMessages[i];
      if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
        return;
      }
      const tokens = extractTokenUsage(msg.usage);
      if (!tokens) continue;
      this.usageTracker.seedResumedSession(
        sessionId,
        tokens.input +
          tokens.output +
          (tokens.cacheRead ?? 0) +
          (tokens.cacheCreation ?? 0),
      );
      return;
    }
  }

  /**
   * Text projection of the transcript that includes `tool_use`/`tool_result`
   * blocks (via {@link HistoryEventFactory.extractContentForCuration}). Used by
   * the memory curator's transcript reader so curation — including the
   * boot-scan over historical sessions, whose only data source is this JSONL —
   * captures tool inputs/outputs, not just assistant text. NOT for UI use: the
   * UI replays `readSessionHistory` events (TASK_2026_437 C15).
   */
  async readHistoryForCuration(
    sessionId: string,
    workspacePath: string,
    options?: TranscriptWindowOptions,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    return this.readHistoryMessages(
      sessionId,
      workspacePath,
      (content) => this.eventFactory.extractContentForCuration(content),
      options,
    );
  }

  /**
   * Implementation of {@link readHistoryForCuration}: read the session JSONL,
   * drop everything before the last compaction boundary, and map each
   * user/assistant message to `{ id, role, content, timestamp }` using the
   * supplied content extractor.
   */
  private async readHistoryMessages(
    sessionId: string,
    workspacePath: string,
    extractContent: (content: unknown) => string,
    options?: TranscriptWindowOptions,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    // A malformed id is a soft miss here, not an error: every caller of this
    // method treats `[]` as "no history". Logging it at ERROR with a stack —
    // as the shared catch below does — made an empty id look like a failed
    // read of a real session, which is how TASK_2026_293 stayed hidden.
    if (!this.isValidSessionId(sessionId)) {
      this.logger.warn(
        '[SessionHistoryReader] Invalid sessionId, skipping history read',
        { sessionId },
      );
      return [];
    }

    try {
      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return [];
      }
      const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
      const tailBytes = options?.tailBytes;
      // A caller that only wants the end of the transcript must say so, and
      // then only the end is read and parsed. Reading 50 MB to keep the last
      // 32 KB is what blocked the backend main thread per turn per session
      // (TASK_2026_323, B4).
      const rawMessages =
        typeof tailBytes === 'number' && tailBytes > 0
          ? await this.jsonlReader.readJsonlTail(sessionFile, {
              maxBytes: tailBytes,
              signal: options?.signal,
            })
          : await this.jsonlReader.readJsonlMessages(sessionFile, {
              signal: options?.signal,
            });

      return this.projectHistoryMessages(rawMessages, extractContent);
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
    hint?: MessageAnchorHint,
  ): Promise<string> {
    if (this.LINE_UUID_PATTERN.test(upToMessageId)) {
      return upToMessageId;
    }

    this.logger.info(
      '[SessionHistoryReader] Non-line-UUID upToMessageId - resolving via JSONL scan',
      { sessionId, upToMessageId, hasTextHint: !!hint?.text },
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

    // Primary: the anchor is itself a known id in the transcript (an Anthropic
    // `message.id` or a line `uuid`). Walk back to the nearest line UUID.
    let matchIndex = messages.findIndex((m) => m.message?.id === upToMessageId);
    if (matchIndex === -1) {
      matchIndex = messages.findIndex((m) => m.uuid === upToMessageId);
    }
    if (matchIndex !== -1) {
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
    }

    // Fallback: the anchor is a client-only optimistic id (`msg_<ts>_<rand>`)
    // that was never persisted to the transcript — the common live-session
    // case. Recover the real line UUID by matching the user prompt text the
    // frontend supplied. Every user line in the transcript carries a UUID, so
    // this resolves whenever the text is found.
    if (hint?.text) {
      const resolved = this.resolveAnchorByPromptText(messages, hint);
      if (resolved) {
        this.logger.info(
          '[SessionHistoryReader] Resolved upToMessageId via prompt-text hint',
          {
            sessionId,
            upToMessageId,
            resolvedId: resolved,
            occurrence: hint.occurrence ?? 0,
          },
        );
        return resolved;
      }
    }

    throw new SdkError(
      `upToMessageId '${upToMessageId}' ${MESSAGE_ID_NOT_FOUND_PHRASE} for session '${sessionId}'. ` +
        'The message may belong to a different session or the history may have been compacted.',
    );
  }

  /**
   * Locate the transcript line UUID of the user prompt whose verbatim text
   * matches {@link MessageAnchorHint.text}. Used to recover a fork/rewind
   * anchor when the frontend supplied a client-only optimistic id that never
   * reached the transcript. Sidechain (subagent) lines and tool_result-only
   * user lines are excluded — the SDK fork matcher only accepts main-chain
   * line UUIDs. Identical duplicate prompts are disambiguated by
   * {@link MessageAnchorHint.occurrence}.
   */
  private resolveAnchorByPromptText(
    messages: SessionHistoryMessage[],
    hint: MessageAnchorHint,
  ): string | null {
    const target = hint.text.trim();
    if (!target) return null;
    const matches: string[] = [];
    for (const msg of messages) {
      if (msg.type !== 'user') continue;
      if ((msg as { isSidechain?: boolean }).isSidechain) continue;
      const uuid = msg.uuid;
      if (!uuid || !this.LINE_UUID_PATTERN.test(uuid)) continue;
      const content = msg.message?.content;
      const isToolResultOnly =
        Array.isArray(content) &&
        content.every(
          (block) => (block as { type?: string })?.type === 'tool_result',
        );
      if (isToolResultOnly) continue;
      const text = this.eventFactory.extractTextContent(content).trim();
      if (text && text === target) matches.push(uuid);
    }
    if (matches.length === 0) return null;
    const occurrenceFromEnd = hint.occurrenceFromEnd;
    if (
      typeof occurrenceFromEnd === 'number' &&
      Number.isInteger(occurrenceFromEnd) &&
      occurrenceFromEnd >= 0
    ) {
      return matches[matches.length - 1 - occurrenceFromEnd] ?? null;
    }
    const occurrence = hint.occurrence ?? 0;
    return matches[occurrence] ?? matches[matches.length - 1];
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
          // degradation-audit: optional-capability - hydrating pricing for one
          // unknown model is per-model and best effort; null is the same as
          // "no pricing published" and the other models still hydrate.
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
   * The resume stats for a transcript that was just read.
   *
   * A session with a live stats owner answers with the OWNER's snapshot: the
   * transcript has grown by the owner's own runs, and counting it again would
   * double-count. Any other session — one merely browsed — answers with this
   * transcript's aggregate directly; browsing never creates an owner (an
   * owner is created only when a query run is prepared). Either way the reply
   * carries this read's context frame and backend-known context windows.
   */
  private publishHistoryStats(
    sessionId: string,
    mainMessages: readonly SessionHistoryMessage[],
    agentSessions: readonly AgentSessionData[],
    unreadableAgents: readonly UnreadableAgentMember[],
  ): SessionStatsEntry | null {
    const snapshot =
      this.statsOwner.snapshot(sessionId) ??
      this.buildUsagePrefix(
        sessionId,
        mainMessages,
        agentSessions,
        unreadableAgents,
      ).stats;
    if (snapshot.status === 'empty') return null;
    const contextSnapshot = this.extractContextSnapshot(mainMessages);
    return {
      ...snapshot,
      ...(snapshot.modelUsageList && {
        modelUsageList: snapshot.modelUsageList.map((row) => ({
          ...row,
          ...knownContextWindow(row.model),
        })),
      }),
      ...(contextSnapshot && { contextSnapshot }),
    };
  }

  /**
   * The transcript's lifetime usage as a stats-owner prefix.
   *
   * Parent and subagent transcripts go through the SAME ledger rules as the
   * sessions list (one record per API message id, last counters win) and the
   * same `aggregateSessionUsage`, with lifetime `session` scope: compaction
   * shrinks the context, not what the session consumed. Each model is priced
   * by its own id through the resolver's rate card. Subagent identity is the
   * transcript file name, never the number of files. An owned member that
   * could not be read keeps its file-name identity and makes the total
   * unknown; a flat file of unknown owner only makes coverage partial.
   */
  private buildUsagePrefix(
    sessionId: string,
    mainMessages: readonly SessionHistoryMessage[],
    agentSessions: readonly AgentSessionData[],
    unreadableAgents: readonly UnreadableAgentMember[],
  ): SessionStatsPrefix {
    const subagentIds = [
      ...agentSessions.map((agent) => agent.agentId),
      ...unreadableAgents.flatMap((member) =>
        member.owned && member.agentId !== null ? [member.agentId] : [],
      ),
    ];
    const stats = aggregateSessionUsage(
      {
        sessionId,
        parent: ledgerFromMessages(mainMessages),
        subagents: agentSessions.map((agent) =>
          ledgerFromMessages(agent.messages),
        ),
        unreadableSubagents: unreadableAgents.length,
        subagentIds,
        scope: { kind: 'session' },
      },
      (model) => this.modelResolver.resolveForCost(model).pricing,
    );
    let savedCostState: SavedCostState | null = null;
    for (let i = mainMessages.length - 1; i >= 0; i--) {
      const costState = mainMessages[i].costState;
      if (costState) {
        savedCostState = parseSavedCostState(costState);
        break;
      }
    }
    return { stats, subagentIds, savedCostState };
  }

  /**
   * The latest valid main-session context frame after the last compaction —
   * the context gauge's figure, kept separate from lifetime accounting.
   */
  private extractContextSnapshot(
    mainMessages: readonly SessionHistoryMessage[],
  ): SessionStatsEntry['contextSnapshot'] {
    let detectedModel: string | undefined;
    for (const msg of mainMessages) {
      if (msg.type === 'system' && msg.subtype === 'init' && msg.model) {
        detectedModel = String(msg.model);
        break;
      }
    }
    for (let i = mainMessages.length - 1; i >= 0; i--) {
      const msg = mainMessages[i];
      if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
        return undefined;
      }
      if (msg.type !== 'assistant' || !msg.usage) continue;
      const tokens = extractTokenUsage(msg.usage);
      const rawModel = msg.message?.model || detectedModel || '';
      if (!tokens || !rawModel) continue;
      const modelKey =
        this.modelResolver.resolveForCost(rawModel).modelId || rawModel;
      return {
        model: modelKey,
        contextTokens:
          tokens.input + (tokens.cacheRead ?? 0) + (tokens.cacheCreation ?? 0),
        ...knownContextWindow(modelKey),
      };
    }
    return undefined;
  }
}

/**
 * Carry the window on the wire so the renderer never reverse-resolves it from
 * a name its bundled table cannot know (discovered proxy models).
 */
function knownContextWindow(model: string): { contextWindow?: number } {
  const contextWindow = getModelContextWindow(model);
  return contextWindow > 0 ? { contextWindow } : {};
}

/**
 * Project already-parsed transcript messages into a usage ledger through the
 * shared builder, so resume and the sessions list count identically.
 */
function ledgerFromMessages(
  messages: readonly SessionHistoryMessage[],
): SessionUsageLedger {
  const builder = new SessionUsageLedgerBuilder();
  for (const msg of messages) {
    builder.visitRecord({
      type: msg.type,
      subtype: msg.subtype,
      sessionId: msg.sessionId,
      timestamp: msg.timestamp,
      model: msg.model,
      message: {
        role: msg.message?.role,
        id: msg.message?.id,
        model: msg.message?.model,
        usage: msg.message?.usage ?? msg.usage,
      },
    });
  }
  return builder.build();
}

/** A JSON object line, or `null` for anything else. Never throws. */
function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    // degradation-audit: optional-capability - a malformed line (commonly a
    // half-flushed final line) is skipped, as every transcript reader does.
    return null;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
