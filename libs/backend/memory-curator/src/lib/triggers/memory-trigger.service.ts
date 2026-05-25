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
  SDK_TOKENS,
  type SessionActivityPayload,
  type SessionActivityRegistry,
  type SessionEndPayload,
  type SessionEndCallbackRegistry,
  type JsonlReaderService,
  type PostToolUseCallbackRegistry,
  type PostToolUsePayload,
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
  private readonly sessions = new Map<string, SessionState>();
  private readonly episodes = new EpisodeTracker();
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
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    this.userPromptSubmitDisposer = null;
    this.postToolUseDisposer = null;
    this.stopDisposer = null;
    this.toolFailureDisposer = null;
    this.sessionEndHookDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    this.sessions.clear();
    this.episodes.clear();
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
      payload.prompt,
    );
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    if (!payload.sessionId || payload.sessionId.length === 0) return;

    // Error→recovery detection: a previously-failed tool now succeeds. This is
    // the highest-value "critical learning" episode boundary.
    if (payload.success) {
      const recovered = this.episodes.recordToolSuccess(
        payload.sessionId,
        payload.toolName,
      );
      if (recovered && this.readEpisodeEnabled()) {
        this.tryEpisodeCurate(
          payload.sessionId,
          payload.workspaceRoot,
          'episode',
          'episode-trigger',
        );
        return;
      }
    }

    // Commit detection — a committed work unit closes an episode.
    if (payload.toolName !== 'Bash') return;
    if (!payload.success || payload.exitCode !== 0) return;
    const command = this.extractBashCommand(payload.toolInput);
    if (!command || !COMMIT_PATTERN.test(command)) return;
    if (!this.readPostToolUseEnabled()) return;

    this.episodes.recordCommit(payload.sessionId);
    this.tryEpisodeCurate(
      payload.sessionId,
      payload.workspaceRoot,
      'commit-detect',
      'commit-detect',
    );
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

    const transcript = this.episodes.buildTranscript(sessionId);
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
    this.episodes.reset(sessionId);
    void this.invokeCurate(
      sessionId,
      workspaceRoot,
      source,
      transcript,
      salienceBoost,
    );
  }

  private async invokeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: CurateSource,
    transcript?: string,
    salienceBoost?: number,
  ): Promise<void> {
    try {
      await this.curator.curate({
        sessionId,
        workspaceRoot,
        transcript,
        salienceBoost,
      });
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
        run: (sessionId, workspaceRoot, runSignal) =>
          this.curator.curate({ sessionId, workspaceRoot, signal: runSignal }),
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
}
