import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import {
  MEMORY_CONTRACT_TOKENS,
  type ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import {
  SDK_TOKENS,
  type SessionActivityPayload,
  type SessionActivityRegistry,
  type SessionEndPayload,
  type SessionEndCallbackRegistry,
  type JsonlReaderService,
  type PostToolUseCallbackRegistry,
  type PostToolUsePayload,
  type PreToolUseCallbackRegistry,
  type PreToolUsePayload,
  type SessionStartCallbackRegistry,
  type SessionStartPayload,
  type UserPromptSubmitCallbackRegistry,
  type UserPromptSubmitPayload,
  type StopCallbackRegistry,
  type StopPayload,
  type SessionEndHookCallbackRegistry,
  type SessionEndHookPayload,
  type ToolFailureCallbackRegistry,
  type ToolFailurePayload,
  type CuratorRateLimitService,
} from '@ptah-extension/agent-sdk';
import { MEMORY_TOKENS } from '../di/tokens';
import { MemoryCuratorService } from '../memory-curator.service';
import {
  ObservationQueueStore,
  type ObservationQueueRow,
} from '../observation-queue.store';
import { deriveWorkspaceFingerprint } from '../workspace-fingerprint';
import { BootScanRunner } from './boot-scan-runner';
import { EpisodeTracker } from './episode-tracker';
import {
  MEMORY_TRIGGER_DEFAULTS,
  MEMORY_TRIGGER_KEYS,
  MEMORY_TRIGGER_SECTION,
} from './memory-trigger-config';

const COMMIT_PATTERN = /^\s*git\s+commit(?:\s|$)/;
const RATE_LIMIT_KEY = 'memory.curate';
const MAX_CUE_PATTERN_LENGTH = 200;
const COALESCE_WINDOW_MS = 5000;

type CurateSource =
  | 'idle'
  | 'turn'
  | 'turn-complete'
  | 'episode'
  | 'commit-detect'
  | 'session-end'
  | 'boot'
  | 'user-cue';

interface SessionState {
  readonly workspaceRoot: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  turnCount: number;
}

@injectable()
export class MemoryTriggerService {
  private started = false;
  private activityDisposer: (() => void) | null = null;
  private sessionEndDisposer: (() => void) | null = null;
  private userPromptSubmitDisposer: (() => void) | null = null;
  private postToolUseDisposer: (() => void) | null = null;
  private stopDisposer: (() => void) | null = null;
  private toolFailureDisposer: (() => void) | null = null;
  private sessionEndHookDisposer: (() => void) | null = null;
  private preToolUseDisposer: (() => void) | null = null;
  private sessionStartDisposer: (() => void) | null = null;
  private readonly sessions = new Map<string, SessionState>();
  private readonly episodes = new EpisodeTracker();
  private readonly inFlightCurates = new Set<string>();
  private readonly lastCurateAt = new Map<string, number>();
  private bootScanController: AbortController | null = null;
  private cueCache: {
    source: readonly string[];
    compiled: RegExp[];
  } | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly curator: MemoryCuratorService,
    @inject(SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY)
    private readonly activity: SessionActivityRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY)
    private readonly sessionEnd: SessionEndCallbackRegistry,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonl: JsonlReaderService,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY)
    private readonly userPromptSubmitRegistry: UserPromptSubmitCallbackRegistry,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly postToolUseRegistry: PostToolUseCallbackRegistry,
    @inject(SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY)
    private readonly stopRegistry: StopCallbackRegistry,
    @inject(SDK_TOKENS.SDK_TOOL_FAILURE_CALLBACK_REGISTRY)
    private readonly toolFailureRegistry: ToolFailureCallbackRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_END_HOOK_CALLBACK_REGISTRY)
    private readonly sessionEndHookRegistry: SessionEndHookCallbackRegistry,
    @inject(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT)
    private readonly rateLimiter: CuratorRateLimitService,
    @inject(MEMORY_TOKENS.OBSERVATION_QUEUE_STORE)
    private readonly observationQueue: ObservationQueueStore,
    @inject(SDK_TOKENS.SDK_PRE_TOOL_USE_CALLBACK_REGISTRY)
    private readonly preToolUseRegistry: PreToolUseCallbackRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_START_CALLBACK_REGISTRY)
    private readonly sessionStartRegistry: SessionStartCallbackRegistry,
    @inject(MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER)
    private readonly transcriptReader: ITranscriptReader,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.activityDisposer = this.activity.register((payload) => {
      this.onActivity(payload);
    });
    this.sessionEndDisposer = this.sessionEnd.register((payload) => {
      this.onSessionEnd(payload);
    });
    this.userPromptSubmitDisposer = this.userPromptSubmitRegistry.register(
      (payload) => {
        this.onUserPromptSubmit(payload);
      },
    );
    this.postToolUseDisposer = this.postToolUseRegistry.register((payload) => {
      this.onPostToolUse(payload);
    });
    this.stopDisposer = this.stopRegistry.register((payload) => {
      this.onStop(payload);
    });
    this.toolFailureDisposer = this.toolFailureRegistry.register((payload) => {
      this.onToolFailure(payload);
    });
    this.sessionEndHookDisposer = this.sessionEndHookRegistry.register(
      (payload) => {
        this.onSessionEndHook(payload);
      },
    );
    this.preToolUseDisposer = this.preToolUseRegistry.register((payload) => {
      this.onPreToolUseRead(payload);
    });
    this.sessionStartDisposer = this.sessionStartRegistry.register(
      (payload) => {
        this.onSessionStart(payload);
      },
    );

    if (this.readBootScanFlag()) {
      this.bootScanController = new AbortController();
      void this.runBootScan(this.bootScanController.signal);
    }

    this.logger.info('[memory-curator] trigger service started');
  }

  stop(): void {
    if (!this.started) return;
    this.activityDisposer?.();
    this.sessionEndDisposer?.();
    this.userPromptSubmitDisposer?.();
    this.postToolUseDisposer?.();
    this.stopDisposer?.();
    this.toolFailureDisposer?.();
    this.sessionEndHookDisposer?.();
    this.preToolUseDisposer?.();
    this.sessionStartDisposer?.();
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    this.userPromptSubmitDisposer = null;
    this.postToolUseDisposer = null;
    this.stopDisposer = null;
    this.toolFailureDisposer = null;
    this.sessionEndHookDisposer = null;
    this.preToolUseDisposer = null;
    this.sessionStartDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    this.sessions.clear();
    this.episodes.clear();
    this.inFlightCurates.clear();
    this.lastCurateAt.clear();
    this.bootScanController?.abort();
    this.bootScanController = null;
    this.started = false;
    this.logger.info('[memory-curator] trigger service stopped');
  }

  /**
   * Session activity drives the idle timer only. The authoritative
   * "turn complete" signal is the SDK `Stop` hook ({@link onStop}); the
   * legacy activity-based turn counter has been retired in favour of it.
   */
  private onActivity(payload: SessionActivityPayload): void {
    const idleMs = this.readIdleMs();
    if (idleMs <= 0) return;

    let state = this.sessions.get(payload.sessionId);
    if (!state) {
      state = {
        workspaceRoot: payload.workspaceRoot,
        idleTimer: null,
        turnCount: 0,
      };
      this.sessions.set(payload.sessionId, state);
    }

    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      this.fireIdle(payload.sessionId);
    }, idleMs);
  }

  private onSessionEnd(payload: SessionEndPayload): void {
    const state = this.sessions.get(payload.sessionId);
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    this.sessions.delete(payload.sessionId);
  }

  /** Real SDK `Stop` hook — the authoritative "assistant turn complete" signal. */
  private onStop(payload: StopPayload): void {
    if (!payload.sessionId || payload.sessionId.length === 0) return;
    this.observationQueue.insert({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'assistant-turn',
      assistantMessage: payload.lastAssistantMessage ?? null,
    });
    const turnCount = this.episodes.recordTurn(
      payload.sessionId,
      payload.lastAssistantMessage,
    );
    if (!this.readTurnCompleteEnabled()) return;
    if (payload.hasBackgroundWork) return;
    const threshold = this.readTurnThreshold();
    if (threshold > 0 && turnCount >= threshold) {
      this.tryEpisodeCurate(
        payload.sessionId,
        payload.workspaceRoot,
        'turn-complete',
        'turn-complete-trigger',
      );
    }
  }

  /** Real SDK `PostToolUseFailure` hook — buffer the failure for episode context. */
  private onToolFailure(payload: ToolFailurePayload): void {
    if (!payload.sessionId || payload.sessionId.length === 0) return;
    if (payload.isInterrupt) return;
    this.observationQueue.insert({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'tool-failure',
      toolName: payload.toolName,
      toolResponseText: payload.error,
    });
    this.episodes.recordFailure(
      payload.sessionId,
      payload.toolName,
      payload.error,
    );
    this.curator.pushEvent({
      kind: 'tool-failure',
      timestamp: payload.timestamp,
      sessionId: payload.sessionId,
      stats: { tool: payload.toolName },
    });
  }

  /** Real SDK `SessionEnd` hook — flush whatever the episode buffer holds. */
  private onSessionEndHook(payload: SessionEndHookPayload): void {
    if (payload.sessionId && payload.sessionId.length > 0) {
      if (this.readSessionEndEnabled()) {
        this.tryEpisodeCurate(
          payload.sessionId,
          payload.workspaceRoot,
          'session-end',
          'session-end-trigger',
        );
      }
      this.episodes.reset(payload.sessionId);
      const state = this.sessions.get(payload.sessionId);
      if (state?.idleTimer) clearTimeout(state.idleTimer);
      this.sessions.delete(payload.sessionId);
    }
  }

  private onUserPromptSubmit(payload: UserPromptSubmitPayload): void {
    if (payload.sessionId && payload.sessionId.length > 0) {
      this.observationQueue.insert({
        sessionId: payload.sessionId,
        workspaceRoot: payload.workspaceRoot,
        kind: 'user-prompt',
        userPrompt: payload.prompt,
      });
    }
    if (!this.readUserPromptSubmitEnabled()) return;
    if (!payload.sessionId || payload.sessionId.length === 0) {
      this.logger.warn(
        '[memory-curator] empty sessionId in onUserPromptSubmit, skipping',
        { workspaceRoot: payload.workspaceRoot },
      );
      return;
    }
    const minLength = this.readUserPromptSubmitMinPromptLength();
    if (payload.prompt.length < minLength) return;

    const source = this.readUserPromptSubmitCueList();
    const compiled = this.getCompiledCues(source);
    let matchedCue: string | null = null;
    for (let i = 0; i < compiled.length; i++) {
      if (compiled[i].test(payload.prompt)) {
        matchedCue = source[i] ?? null;
        break;
      }
    }
    if (!matchedCue) return;

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxCuratesPerHour(),
    );
    if (!decision.allowed) {
      this.curator.pushEvent({
        kind: 'rate-limited',
        timestamp: payload.timestamp,
        sessionId: payload.sessionId,
        stats: {
          source: 'user-cue',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    this.curator.pushEvent({
      kind: 'user-cue-trigger',
      timestamp: payload.timestamp,
      sessionId: payload.sessionId,
      stats: { cue: matchedCue },
    });
    void this.invokeCurate(
      payload.sessionId,
      payload.workspaceRoot,
      'user-cue',
    );
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    if (!payload.sessionId || payload.sessionId.length === 0) return;
    this.observationQueue.insert({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'tool-use',
      toolName: payload.toolName,
      toolInputJson: safeStringify(payload.toolInput),
      toolResponseText:
        typeof payload.toolOutput === 'string'
          ? payload.toolOutput
          : safeStringify(payload.toolOutput),
    });

    if (payload.success) {
      const recovered = this.episodes.recordToolSuccess(
        payload.sessionId,
        payload.toolName,
      );
      if (recovered && this.readEpisodeEnabled()) {
        const snap = this.episodes.snapshot(payload.sessionId);
        if (snap.hasCriticalLearning && snap.turnCount > 0) {
          this.tryEpisodeCurate(
            payload.sessionId,
            payload.workspaceRoot,
            'episode',
            'episode-trigger',
          );
        }
        return;
      }
    }

    // Commit detection — a committed work unit closes an episode.
    if (payload.toolName !== 'Bash') return;
    if (!payload.success || payload.exitCode !== 0) return;
    const command = this.extractBashCommand(payload.toolInput);
    if (!command || !COMMIT_PATTERN.test(command)) return;
    if (!this.readPostToolUseEnabled()) return;

    this.observationQueue.insert({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'commit',
    });
    this.episodes.recordCommit(payload.sessionId);
    this.tryEpisodeCurate(
      payload.sessionId,
      payload.workspaceRoot,
      'commit-detect',
      'commit-detect',
    );
  }

  private onPreToolUseRead(payload: PreToolUsePayload): void {
    if (!payload.sessionId || payload.sessionId.length === 0) return;
    if (payload.toolName !== 'Read') return;
    const filePath = extractFilePath(payload.toolInput);
    this.observationQueue.insert({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'file-read',
      filePath,
    });
  }

  private onSessionStart(_payload: SessionStartPayload): void {
    return;
  }

  private extractBashCommand(toolInput: unknown): string | null {
    if (
      typeof toolInput === 'object' &&
      toolInput !== null &&
      'command' in toolInput
    ) {
      const c = (toolInput as { command?: unknown }).command;
      return typeof c === 'string' ? c : null;
    }
    return null;
  }

  private getCompiledCues(source: readonly string[]): RegExp[] {
    if (this.cueCache && this.cueCache.source === source) {
      return this.cueCache.compiled;
    }
    const compiled: RegExp[] = [];
    for (const pattern of source) {
      if (pattern.length > MAX_CUE_PATTERN_LENGTH) {
        this.logger.warn('[memory-curator] cue pattern too long, skipping', {
          len: pattern.length,
        });
        compiled.push(/(?!x)x/);
        continue;
      }
      try {
        compiled.push(new RegExp(pattern, 'i'));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('[memory-curator] invalid cue regex, skipping', {
          pattern,
          error: message,
        });
        compiled.push(/(?!x)x/);
      }
    }
    this.cueCache = { source, compiled };
    return compiled;
  }

  private fireIdle(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.idleTimer = null;
    this.tryEpisodeCurate(
      sessionId,
      state.workspaceRoot,
      'idle',
      'idle-trigger',
    );
  }

  /**
   * Close the current episode for a session: rate-limit, assemble the buffered
   * transcript, curate with a salience boost, and reset the buffer. When the
   * episode is empty there is nothing to curate. When rate-limited the buffer
   * is preserved so the next boundary can retry.
   */
  private tryEpisodeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: CurateSource,
    eventKind:
      | 'idle-trigger'
      | 'turn-trigger'
      | 'turn-complete-trigger'
      | 'episode-trigger'
      | 'commit-detect'
      | 'session-end-trigger',
  ): void {
    if (this.shouldCoalesce(sessionId)) {
      this.logger.debug(
        '[memory-curator] curate trigger coalesced (in-flight or recent)',
        { sessionId, source },
      );
      return;
    }

    const snap = this.episodes.snapshot(sessionId);
    if (snap.isEmpty) {
      this.episodes.reset(sessionId);
      return;
    }

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxCuratesPerHour(),
    );
    if (!decision.allowed) {
      this.curator.pushEvent({
        kind: 'rate-limited',
        timestamp: Date.now(),
        sessionId,
        stats: {
          source,
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    const salienceBoost = this.episodes.salienceBoost(sessionId);
    this.curator.pushEvent({
      kind: eventKind,
      timestamp: Date.now(),
      sessionId,
      stats: {
        turns: snap.turnCount,
        failures: snap.failures.length,
        recovered: snap.recoveredTools.length,
        commits: snap.commits,
        critical: snap.hasCriticalLearning,
      },
    });
    const episodeSnap: EpisodeSummaryInput = {
      turnCount: snap.turnCount,
      failures: snap.failures.length,
      recovered: snap.recoveredTools.length,
      commits: snap.commits,
      hasCriticalLearning: snap.hasCriticalLearning,
    };
    this.episodes.reset(sessionId);
    this.inFlightCurates.add(sessionId);
    this.lastCurateAt.set(sessionId, Date.now());
    void this.invokeCurate(
      sessionId,
      workspaceRoot,
      source,
      salienceBoost,
      episodeSnap,
    );
  }

  private shouldCoalesce(sessionId: string): boolean {
    if (this.inFlightCurates.has(sessionId)) return true;
    const last = this.lastCurateAt.get(sessionId);
    if (last === undefined) return false;
    return Date.now() - last < COALESCE_WINDOW_MS;
  }

  private async invokeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: CurateSource,
    salienceBoost?: number,
    episodeSnap?: EpisodeSummaryInput,
  ): Promise<void> {
    const limit = this.readMaxObservationsPerCurate();
    let jsonlText = '';
    try {
      jsonlText = await this.transcriptReader.read(sessionId, workspaceRoot);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('[memory-curator] transcript read failed', {
        sessionId,
        source,
        error: message,
      });
      jsonlText = '';
    }
    const drainedRows = this.observationQueue.drainForSession(sessionId, limit);
    const transcript = composeTranscript(jsonlText, drainedRows, episodeSnap);
    try {
      await this.curator.curate({
        sessionId,
        workspaceRoot,
        transcript,
        salienceBoost,
      });
      const ids = drainedRows.map((r) => r.id);
      if (ids.length > 0) this.observationQueue.markProcessed(ids);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.curator.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        sessionId,
        error: message,
      });
      this.logger.warn('[memory-curator] trigger curate failed', {
        source,
        sessionId,
        error: message,
      });
    } finally {
      this.inFlightCurates.delete(sessionId);
    }
  }

  private async runBootScan(signal: AbortSignal): Promise<void> {
    const root = this.workspace.getWorkspaceRoot();
    if (!root) return;
    try {
      const { fp } = await deriveWorkspaceFingerprint(root, this.fs);
      const sessionsDir = await this.jsonl.findSessionsDirectory(root);
      const runner = new BootScanRunner();
      const result = await runner.run({
        pipeline: 'memory',
        workspaceRoot: root,
        workspaceFingerprint: fp,
        sessionsDirectory: sessionsDir,
        sqlite: this.sqlite,
        logger: this.logger,
        signal,
        run: async (scanSessionId, scanWorkspaceRoot, runSignal) => {
          let transcript = '';
          try {
            transcript = await this.transcriptReader.read(
              scanSessionId,
              scanWorkspaceRoot,
            );
          } catch (err: unknown) {
            this.logger.warn(
              '[memory-curator] boot-scan transcript read failed',
              {
                sessionId: scanSessionId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
          return this.curator.curate({
            sessionId: scanSessionId,
            workspaceRoot: scanWorkspaceRoot,
            transcript,
            signal: runSignal,
          });
        },
      });
      this.curator.pushEvent({
        kind: 'boot-scan',
        timestamp: Date.now(),
        stats: {
          scanned: result.scanned,
          succeeded: result.succeeded,
          skipped: result.skipped,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.curator.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        error: message,
      });
      this.logger.warn('[memory-curator] boot-scan failed', { error: message });
    }
  }

  private readIdleMs(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.idleMs,
      MEMORY_TRIGGER_DEFAULTS.idleMs,
    );
    return typeof v === 'number' ? v : MEMORY_TRIGGER_DEFAULTS.idleMs;
  }

  private readTurnThreshold(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.turnThreshold,
      MEMORY_TRIGGER_DEFAULTS.turnThreshold,
    );
    return typeof v === 'number' ? v : MEMORY_TRIGGER_DEFAULTS.turnThreshold;
  }

  private readBootScanFlag(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.bootScan,
      MEMORY_TRIGGER_DEFAULTS.bootScan,
    );
    return typeof v === 'boolean' ? v : MEMORY_TRIGGER_DEFAULTS.bootScan;
  }

  private readUserPromptSubmitEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.enabled,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled;
  }

  private readUserPromptSubmitCueList(): readonly string[] {
    const v = this.workspace.getConfiguration<readonly string[]>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.cueList,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList,
    );
    return Array.isArray(v)
      ? v
      : MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList;
  }

  private readUserPromptSubmitMinPromptLength(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.minPromptLength,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength,
    );
    return typeof v === 'number'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength;
  }

  private readPostToolUseEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.postToolUse.enabled,
      MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled;
  }

  private readTurnCompleteEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.turnComplete.enabled,
      MEMORY_TRIGGER_DEFAULTS.turnComplete.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.turnComplete.enabled;
  }

  private readEpisodeEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.episode.enabled,
      MEMORY_TRIGGER_DEFAULTS.episode.enabled,
    );
    return typeof v === 'boolean' ? v : MEMORY_TRIGGER_DEFAULTS.episode.enabled;
  }

  private readSessionEndEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.sessionEnd.enabled,
      MEMORY_TRIGGER_DEFAULTS.sessionEnd.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.sessionEnd.enabled;
  }

  private readMaxCuratesPerHour(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.maxCuratesPerHour,
      MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour,
    );
    return typeof v === 'number'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour;
  }

  private readMaxObservationsPerCurate(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.maxObservationsPerCurate,
      MEMORY_TRIGGER_DEFAULTS.maxObservationsPerCurate,
    );
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? Math.floor(v)
      : MEMORY_TRIGGER_DEFAULTS.maxObservationsPerCurate;
  }
}

const MAX_JSONL_BYTES = 32 * 1024;
const TOOL_INPUT_PREVIEW = 1000;
const TOOL_RESPONSE_PREVIEW = 2500;
const ASSISTANT_PREVIEW = 2000;
const USER_PROMPT_PREVIEW = 1000;

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeStringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function extractFilePath(toolInput: unknown): string | null {
  if (typeof toolInput !== 'object' || toolInput === null) return null;
  const input = toolInput as { file_path?: unknown; path?: unknown };
  if (typeof input.file_path === 'string' && input.file_path.length > 0) {
    return input.file_path;
  }
  if (typeof input.path === 'string' && input.path.length > 0) {
    return input.path;
  }
  return null;
}

function formatObservationRow(row: ObservationQueueRow): string {
  switch (row.kind) {
    case 'tool-use':
      return `- [tool] ${row.toolName ?? '?'} input=${truncate(
        row.toolInputJson,
        TOOL_INPUT_PREVIEW,
      )} response=${truncate(row.toolResponseText, TOOL_RESPONSE_PREVIEW)}`;
    case 'tool-failure':
      return `- [failure] ${row.toolName ?? '?'}: ${truncate(
        row.toolResponseText,
        TOOL_RESPONSE_PREVIEW,
      )}`;
    case 'assistant-turn':
      return `- [assistant] ${truncate(row.assistantMessage, ASSISTANT_PREVIEW)}`;
    case 'user-prompt':
      return `- [user] ${truncate(row.userPrompt, USER_PROMPT_PREVIEW)}`;
    case 'file-read':
      return `- [read] ${row.filePath ?? '?'}`;
    case 'commit':
      return '- [commit]';
    default:
      return `- [${row.kind as string}]`;
  }
}

interface EpisodeSummaryInput {
  readonly turnCount: number;
  readonly failures: number;
  readonly recovered: number;
  readonly commits: number;
  readonly hasCriticalLearning: boolean;
}

function composeTranscript(
  jsonlText: string,
  rows: readonly ObservationQueueRow[],
  snap: EpisodeSummaryInput | undefined,
): string {
  const sections: string[] = [];
  if (jsonlText && jsonlText.length > 0) {
    const trimmed =
      jsonlText.length > MAX_JSONL_BYTES
        ? jsonlText.slice(jsonlText.length - MAX_JSONL_BYTES)
        : jsonlText;
    sections.push(`# Session JSONL excerpt\n\n${trimmed}`);
  }
  if (rows.length > 0) {
    const bullets = rows.map(formatObservationRow).join('\n');
    sections.push(`# Structured observations from hooks\n\n${bullets}`);
  }
  if (snap && (snap.turnCount > 0 || snap.commits > 0 || snap.failures > 0)) {
    sections.push(
      `# Episode summary\n\nturns=${snap.turnCount} failures=${snap.failures} recovered=${snap.recovered} commits=${snap.commits} critical=${snap.hasCriticalLearning}`,
    );
  }
  return sections.join('\n\n');
}
