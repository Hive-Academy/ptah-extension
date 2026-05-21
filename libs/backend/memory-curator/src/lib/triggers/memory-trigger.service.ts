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
  type CuratorRateLimitService,
} from '@ptah-extension/agent-sdk';
import { MEMORY_TOKENS } from '../di/tokens';
import { MemoryCuratorService } from '../memory-curator.service';
import { deriveWorkspaceFingerprint } from '../workspace-fingerprint';
import { BootScanRunner } from './boot-scan-runner';

const SECTION = 'ptah';
const KEYS = {
  preCompact: 'memory.triggers.preCompact',
  idleMs: 'memory.triggers.idleMs',
  turnThreshold: 'memory.triggers.turnThreshold',
  bootScan: 'memory.triggers.bootScan',
  userPromptSubmitEnabled: 'memory.triggers.userPromptSubmit.enabled',
  userPromptSubmitCueList: 'memory.triggers.userPromptSubmit.cueList',
  userPromptSubmitMinPromptLength:
    'memory.triggers.userPromptSubmit.minPromptLength',
  postToolUseEnabled: 'memory.triggers.postToolUse.enabled',
  maxCuratesPerHour: 'memory.triggers.maxCuratesPerHour',
} as const;

const DEFAULT_CUE_LIST: readonly string[] = [
  'remember (this|that)',
  '(important|critical)\\s+(point|note|fact|detail)',
  'from now on',
  'going forward',
  'keep in mind',
  'note that',
  'save to memory',
];

const DEFAULTS = {
  preCompact: true,
  idleMs: 600000,
  turnThreshold: 20,
  bootScan: true,
  userPromptSubmitEnabled: true,
  userPromptSubmitCueList: DEFAULT_CUE_LIST,
  userPromptSubmitMinPromptLength: 20,
  postToolUseEnabled: true,
  maxCuratesPerHour: 12,
} as const;

const COMMIT_PATTERN = /^\s*git\s+commit\b/;
const RATE_LIMIT_KEY = 'memory.curate';
const MAX_CUE_PATTERN_LENGTH = 200;

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
  private readonly sessions = new Map<string, SessionState>();
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
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    this.userPromptSubmitDisposer = null;
    this.postToolUseDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    this.sessions.clear();
    this.bootScanController?.abort();
    this.bootScanController = null;
    this.started = false;
    this.logger.info('[memory-curator] trigger service stopped');
  }

  private onActivity(payload: SessionActivityPayload): void {
    const idleMs = this.readIdleMs();
    const turnThreshold = this.readTurnThreshold();
    if (idleMs <= 0 && turnThreshold <= 0) return;

    let state = this.sessions.get(payload.sessionId);
    if (!state) {
      state = {
        workspaceRoot: payload.workspaceRoot,
        idleTimer: null,
        turnCount: 0,
      };
      this.sessions.set(payload.sessionId, state);
    }

    if (idleMs > 0) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      state.idleTimer = setTimeout(() => {
        this.fireIdle(payload.sessionId);
      }, idleMs);
    }

    if (payload.role === 'user' && turnThreshold > 0) {
      state.turnCount++;
      if (state.turnCount >= turnThreshold) {
        state.turnCount = 0;
        this.fireTurn(payload.sessionId);
      }
    }
  }

  private onSessionEnd(payload: SessionEndPayload): void {
    const state = this.sessions.get(payload.sessionId);
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    this.sessions.delete(payload.sessionId);
  }

  private onUserPromptSubmit(payload: UserPromptSubmitPayload): void {
    if (!this.readUserPromptSubmitEnabled()) return;
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
    if (payload.toolName !== 'Bash') return;
    if (!payload.success || payload.exitCode !== 0) return;
    const command = this.extractBashCommand(payload.toolInput);
    if (!command || !COMMIT_PATTERN.test(command)) return;
    if (!this.readPostToolUseEnabled()) return;

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
          source: 'commit-detect',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    this.curator.pushEvent({
      kind: 'commit-detect',
      timestamp: payload.timestamp,
      sessionId: payload.sessionId,
    });
    void this.invokeCurate(
      payload.sessionId,
      payload.workspaceRoot,
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
    const timestamp = Date.now();
    this.curator.pushEvent({
      kind: 'idle-trigger',
      timestamp,
      sessionId,
    });
    void this.invokeCurate(sessionId, state.workspaceRoot, 'idle');
  }

  private fireTurn(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const timestamp = Date.now();
    this.curator.pushEvent({
      kind: 'turn-trigger',
      timestamp,
      sessionId,
    });
    void this.invokeCurate(sessionId, state.workspaceRoot, 'turn');
  }

  private async invokeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: 'idle' | 'turn' | 'boot' | 'user-cue' | 'commit-detect',
    transcript?: string,
  ): Promise<void> {
    try {
      await this.curator.curate({ sessionId, workspaceRoot, transcript });
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
      SECTION,
      KEYS.idleMs,
      DEFAULTS.idleMs,
    );
    return typeof v === 'number' ? v : DEFAULTS.idleMs;
  }

  private readTurnThreshold(): number {
    const v = this.workspace.getConfiguration<number>(
      SECTION,
      KEYS.turnThreshold,
      DEFAULTS.turnThreshold,
    );
    return typeof v === 'number' ? v : DEFAULTS.turnThreshold;
  }

  private readBootScanFlag(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SECTION,
      KEYS.bootScan,
      DEFAULTS.bootScan,
    );
    return typeof v === 'boolean' ? v : DEFAULTS.bootScan;
  }

  private readUserPromptSubmitEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SECTION,
      KEYS.userPromptSubmitEnabled,
      DEFAULTS.userPromptSubmitEnabled,
    );
    return typeof v === 'boolean' ? v : DEFAULTS.userPromptSubmitEnabled;
  }

  private readUserPromptSubmitCueList(): readonly string[] {
    const v = this.workspace.getConfiguration<readonly string[]>(
      SECTION,
      KEYS.userPromptSubmitCueList,
      DEFAULTS.userPromptSubmitCueList,
    );
    return Array.isArray(v) ? v : DEFAULTS.userPromptSubmitCueList;
  }

  private readUserPromptSubmitMinPromptLength(): number {
    const v = this.workspace.getConfiguration<number>(
      SECTION,
      KEYS.userPromptSubmitMinPromptLength,
      DEFAULTS.userPromptSubmitMinPromptLength,
    );
    return typeof v === 'number' ? v : DEFAULTS.userPromptSubmitMinPromptLength;
  }

  private readPostToolUseEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SECTION,
      KEYS.postToolUseEnabled,
      DEFAULTS.postToolUseEnabled,
    );
    return typeof v === 'boolean' ? v : DEFAULTS.postToolUseEnabled;
  }

  private readMaxCuratesPerHour(): number {
    const v = this.workspace.getConfiguration<number>(
      SECTION,
      KEYS.maxCuratesPerHour,
      DEFAULTS.maxCuratesPerHour,
    );
    return typeof v === 'number' ? v : DEFAULTS.maxCuratesPerHour;
  }
}
