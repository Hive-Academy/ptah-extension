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
  type SubagentStopCallbackRegistry,
  type SubagentStopPayload,
  type PostToolUseCallbackRegistry,
  type PostToolUsePayload,
  type CuratorRateLimitService,
} from '@ptah-extension/agent-sdk';
import {
  BootScanRunner,
  deriveWorkspaceFingerprint,
} from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import { SkillSynthesisService } from '../skill-synthesis.service';
import {
  SKILL_TRIGGER_DEFAULTS,
  SKILL_TRIGGER_KEYS,
  SKILL_TRIGGER_SECTION,
} from './skill-trigger-config';

const TEST_PATTERN = /\b(npm|pnpm|yarn|jest|vitest|nx)\s+(test|run\s+test)\b/;
const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit']);
const EDIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_KEY = 'skill.analyze';

interface SessionState {
  readonly workspaceRoot: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface EditTestState {
  readonly workspaceRoot: string;
  editCount: number;
  lastEditAt: number;
  windowStartAt: number;
}

@injectable()
export class SkillTriggerService {
  private started = false;
  private activityDisposer: (() => void) | null = null;
  private sessionEndDisposer: (() => void) | null = null;
  private subagentStopDisposer: (() => void) | null = null;
  private postToolUseDisposer: (() => void) | null = null;
  private readonly sessions = new Map<string, SessionState>();
  private readonly editTestStates = new Map<string, EditTestState>();
  private bootScanController: AbortController | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE)
    private readonly synthesis: SkillSynthesisService,
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
    @inject(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY)
    private readonly subagentStopRegistry: SubagentStopCallbackRegistry,
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
    this.subagentStopDisposer = this.subagentStopRegistry.register(
      (payload) => {
        this.onSubagentStop(payload);
      },
    );
    this.postToolUseDisposer = this.postToolUseRegistry.register((payload) => {
      this.onPostToolUse(payload);
    });

    if (this.readBootScanFlag()) {
      this.bootScanController = new AbortController();
      void this.runBootScan(this.bootScanController.signal);
    }

    this.logger.info('[skill-synthesis] trigger service started');
  }

  stop(): void {
    if (!this.started) return;
    this.activityDisposer?.();
    this.sessionEndDisposer?.();
    this.subagentStopDisposer?.();
    this.postToolUseDisposer?.();
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    this.subagentStopDisposer = null;
    this.postToolUseDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    this.sessions.clear();
    this.editTestStates.clear();
    this.bootScanController?.abort();
    this.bootScanController = null;
    this.started = false;
    this.logger.info('[skill-synthesis] trigger service stopped');
  }

  private onActivity(payload: SessionActivityPayload): void {
    const idleMs = this.readIdleMs();
    if (idleMs <= 0) return;

    let state = this.sessions.get(payload.sessionId);
    if (!state) {
      state = {
        workspaceRoot: payload.workspaceRoot,
        idleTimer: null,
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
    if (state) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      this.sessions.delete(payload.sessionId);
    }
    this.editTestStates.delete(payload.sessionId);
  }

  private onSubagentStop(payload: SubagentStopPayload): void {
    if (!this.readSubagentStopEnabled()) return;
    if (!payload.subagentSessionId || payload.subagentSessionId.length === 0) {
      this.logger.warn(
        '[skill-synthesis] empty sessionId in onSubagentStop, skipping',
        { workspaceRoot: payload.workspaceRoot },
      );
      return;
    }

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxAnalyzesPerHour(),
    );
    if (!decision.allowed) {
      this.synthesis.pushEvent({
        kind: 'rate-limited',
        timestamp: payload.timestamp,
        sessionId: payload.subagentSessionId,
        stats: {
          source: 'subagent-stop',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    this.synthesis.pushEvent({
      kind: 'subagent-stop',
      timestamp: payload.timestamp,
      sessionId: payload.subagentSessionId,
    });
    void this.invokeAnalyze(
      payload.subagentSessionId,
      payload.workspaceRoot,
      'subagent-stop',
    );
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    if (!this.readPostToolUseEnabled()) return;
    if (!payload.sessionId || payload.sessionId.length === 0) {
      this.logger.warn(
        '[skill-synthesis] empty sessionId in onPostToolUse, skipping',
        { workspaceRoot: payload.workspaceRoot },
      );
      return;
    }
    const minEditCount = this.readPostToolUseMinEditCount();
    const now = payload.timestamp;

    if (EDIT_TOOL_NAMES.has(payload.toolName)) {
      let state = this.editTestStates.get(payload.sessionId);
      if (!state || now - state.windowStartAt > EDIT_WINDOW_MS) {
        state = {
          workspaceRoot: payload.workspaceRoot,
          editCount: 0,
          lastEditAt: now,
          windowStartAt: now,
        };
        this.editTestStates.set(payload.sessionId, state);
      }
      state.editCount++;
      state.lastEditAt = now;
      return;
    }

    if (payload.toolName !== 'Bash') return;
    if (!payload.success || payload.exitCode !== 0) return;
    const cmd = this.extractBashCommand(payload.toolInput);
    if (!cmd || !TEST_PATTERN.test(cmd)) return;

    const state = this.editTestStates.get(payload.sessionId);
    if (!state) return;
    if (now - state.windowStartAt > EDIT_WINDOW_MS) {
      this.editTestStates.delete(payload.sessionId);
      return;
    }
    if (state.editCount < minEditCount) return;

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxAnalyzesPerHour(),
    );
    if (!decision.allowed) {
      this.synthesis.pushEvent({
        kind: 'rate-limited',
        timestamp: now,
        sessionId: payload.sessionId,
        stats: {
          source: 'edit-then-test',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      this.editTestStates.delete(payload.sessionId);
      return;
    }

    this.synthesis.pushEvent({
      kind: 'edit-then-test',
      timestamp: now,
      sessionId: payload.sessionId,
      stats: { editCount: state.editCount },
    });
    void this.invokeAnalyze(
      payload.sessionId,
      state.workspaceRoot,
      'edit-then-test',
    );
    this.editTestStates.delete(payload.sessionId);
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

  private fireIdle(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.idleTimer = null;
    const timestamp = Date.now();
    this.synthesis.pushEvent({
      kind: 'idle-trigger',
      timestamp,
      sessionId,
    });
    void this.invokeAnalyze(sessionId, state.workspaceRoot, 'idle');
  }

  private async invokeAnalyze(
    sessionId: string,
    workspaceRoot: string,
    source: 'idle' | 'boot' | 'subagent-stop' | 'edit-then-test',
  ): Promise<void> {
    try {
      await this.synthesis.analyzeSession(sessionId, workspaceRoot, {
        force: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.synthesis.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        sessionId,
        error: message,
      });
      this.logger.warn('[skill-synthesis] trigger analyze failed', {
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
        pipeline: 'skills',
        workspaceRoot: root,
        workspaceFingerprint: fp,
        sessionsDirectory: sessionsDir,
        sqlite: this.sqlite,
        logger: this.logger,
        signal,
        run: (sessionId, workspaceRoot, runSignal) =>
          this.synthesis.analyzeSession(sessionId, workspaceRoot, {
            signal: runSignal,
          }),
      });
      this.synthesis.pushEvent({
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
      this.synthesis.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        error: message,
      });
      this.logger.warn('[skill-synthesis] boot-scan failed', {
        error: message,
      });
    }
  }

  private readIdleMs(): number {
    const v = this.workspace.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.idleMs,
      SKILL_TRIGGER_DEFAULTS.idleMs,
    );
    return typeof v === 'number' ? v : SKILL_TRIGGER_DEFAULTS.idleMs;
  }

  private readBootScanFlag(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.bootScan,
      SKILL_TRIGGER_DEFAULTS.bootScan,
    );
    return typeof v === 'boolean' ? v : SKILL_TRIGGER_DEFAULTS.bootScan;
  }

  private readSubagentStopEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.subagentStop.enabled,
      SKILL_TRIGGER_DEFAULTS.subagentStop.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.subagentStop.enabled;
  }

  private readPostToolUseEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.postToolUse.enabled,
      SKILL_TRIGGER_DEFAULTS.postToolUse.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.postToolUse.enabled;
  }

  private readPostToolUseMinEditCount(): number {
    const v = this.workspace.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.postToolUse.minEditCount,
      SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount,
    );
    return typeof v === 'number'
      ? v
      : SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount;
  }

  private readMaxAnalyzesPerHour(): number {
    const v = this.workspace.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.maxAnalyzesPerHour,
      SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour,
    );
    return typeof v === 'number'
      ? v
      : SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour;
  }
}
