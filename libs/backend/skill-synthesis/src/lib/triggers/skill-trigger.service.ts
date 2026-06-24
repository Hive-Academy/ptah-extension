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
  type UserPromptExpansionCallbackRegistry,
  type UserPromptExpansionPayload,
  type StopCallbackRegistry,
  type StopPayload,
} from '@ptah-extension/agent-sdk';
import {
  BootScanRunner,
  deriveWorkspaceFingerprint,
} from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import { SkillSynthesisService } from '../skill-synthesis.service';
import { SkillInvocationRecorder } from '../skill-invocation-recorder';
import {
  SKILL_TRIGGER_DEFAULTS,
  SKILL_TRIGGER_KEYS,
  SKILL_TRIGGER_SECTION,
} from './skill-trigger-config';

const TEST_PATTERN = /\b(npm|pnpm|yarn|jest|vitest|nx)\s+(test|run\s+test)\b/;
const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit']);
const EDIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_KEY = 'skill.analyze';
const TURN_COMPLETE_DEBOUNCE_MS = 90 * 1000;

interface SessionState {
  readonly workspaceRoot: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface TurnCompleteState {
  readonly workspaceRoot: string;
  timer: ReturnType<typeof setTimeout> | null;
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
  private userPromptExpansionDisposer: (() => void) | null = null;
  private stopDisposer: (() => void) | null = null;
  private readonly sessions = new Map<string, SessionState>();
  private readonly editTestStates = new Map<string, EditTestState>();
  private readonly turnCompleteStates = new Map<string, TurnCompleteState>();
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
    @inject(SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY)
    private readonly userPromptExpansionRegistry: UserPromptExpansionCallbackRegistry,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER)
    private readonly recorder: SkillInvocationRecorder,
    @inject(SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY)
    private readonly stopRegistry: StopCallbackRegistry,
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
    this.userPromptExpansionDisposer =
      this.userPromptExpansionRegistry.register((payload) => {
        this.onUserPromptExpansion(payload);
      });
    this.stopDisposer = this.stopRegistry.register((payload) => {
      this.onStop(payload);
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
    this.userPromptExpansionDisposer?.();
    this.stopDisposer?.();
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    this.subagentStopDisposer = null;
    this.postToolUseDisposer = null;
    this.userPromptExpansionDisposer = null;
    this.stopDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    for (const state of this.turnCompleteStates.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.sessions.clear();
    this.editTestStates.clear();
    this.turnCompleteStates.clear();
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
    const turnState = this.turnCompleteStates.get(payload.sessionId);
    if (turnState) {
      if (turnState.timer) clearTimeout(turnState.timer);
      this.turnCompleteStates.delete(payload.sessionId);
    }
  }

  private onStop(payload: StopPayload): void {
    if (!this.readTurnCompleteEnabled()) return;
    if (!payload.sessionId || payload.sessionId.length === 0) return;
    if (payload.hasBackgroundWork) return;

    let state = this.turnCompleteStates.get(payload.sessionId);
    if (!state) {
      state = { workspaceRoot: payload.workspaceRoot, timer: null };
      this.turnCompleteStates.set(payload.sessionId, state);
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      this.fireTurnComplete(payload.sessionId);
    }, TURN_COMPLETE_DEBOUNCE_MS);
  }

  private fireTurnComplete(sessionId: string): void {
    const state = this.turnCompleteStates.get(sessionId);
    if (!state) return;
    state.timer = null;
    this.turnCompleteStates.delete(sessionId);

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxAnalyzesPerHour(),
    );
    if (!decision.allowed) {
      this.synthesis.pushEvent({
        kind: 'rate-limited',
        timestamp: Date.now(),
        sessionId,
        stats: {
          source: 'turn-complete',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    void this.invokeAnalyze(sessionId, state.workspaceRoot, 'turn-complete');
  }

  private onSubagentStop(payload: SubagentStopPayload): void {
    // Record agent-invocation telemetry first, independent of the subagent-stop
    // *analyze* trigger below. A subagent completing IS an agent invocation, and
    // this is the only reliable seam to observe it: a subagent's Task tool-use
    // runs in its own nested SDK session and never surfaces back to the parent
    // session's PostToolUse hook, so onPostToolUse's `Task` branch never fires
    // for agent runs. Without this, every authored agent shows 0 invocations in
    // the Library tab no matter how many times it runs. Keyed on `agentType`
    // (the agent slug); the recorder's slug|session|2s-bucket dedup makes this
    // idempotent if a Task PostToolUse ever does fire for the same run.
    if (
      this.readSkillInvocationTelemetryEnabled() &&
      payload.agentType &&
      payload.subagentSessionId
    ) {
      void this.recordInvocation({
        slug: payload.agentType,
        sessionId: payload.parentSessionId || payload.subagentSessionId,
        workspaceRoot: payload.workspaceRoot,
        succeeded: true,
        invokedAt: payload.timestamp,
        source: 'subagent',
      });
    }

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
      payload.transcriptPath,
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

    if (payload.toolName === 'Skill') {
      if (this.readSkillInvocationTelemetryEnabled()) {
        const slug = this.extractSkillSlug(payload.toolInput);
        if (slug) {
          void this.recordInvocation({
            slug,
            sessionId: payload.sessionId,
            workspaceRoot: payload.workspaceRoot,
            succeeded: payload.success,
            invokedAt: payload.timestamp,
            source: 'tool-use',
          });
        }
      }
      return;
    }

    if (payload.toolName === 'Task') {
      if (this.readSkillInvocationTelemetryEnabled()) {
        const slug = this.extractSubagentType(payload.toolInput);
        if (slug) {
          void this.recordInvocation({
            slug,
            sessionId: payload.sessionId,
            workspaceRoot: payload.workspaceRoot,
            succeeded: payload.success,
            invokedAt: payload.timestamp,
            source: 'subagent',
          });
        }
      }
      return;
    }

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

  private onUserPromptExpansion(payload: UserPromptExpansionPayload): void {
    if (!this.readSkillInvocationTelemetryEnabled()) return;
    if (!payload.skillSlug || payload.skillSlug.length === 0) return;
    if (!payload.sessionId || payload.sessionId.length === 0) return;
    void this.recordInvocation({
      slug: payload.skillSlug,
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      succeeded: true,
      invokedAt: payload.timestamp,
      source: 'prompt-expansion',
    });
  }

  private async recordInvocation(input: {
    slug: string;
    sessionId: string;
    workspaceRoot: string;
    succeeded: boolean;
    invokedAt: number;
    source: 'tool-use' | 'prompt-expansion' | 'subagent';
  }): Promise<void> {
    try {
      let contextId: string | null = null;
      try {
        const { fp } = await deriveWorkspaceFingerprint(
          input.workspaceRoot,
          this.fs,
        );
        contextId = fp;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          '[skill-synthesis] fingerprint failed for skill event',
          { source: input.source, error: message },
        );
      }
      this.recorder.recordSkillEvent({
        slug: input.slug,
        sessionId: input.sessionId,
        workspaceRoot: input.workspaceRoot,
        contextId,
        succeeded: input.succeeded,
        invokedAt: input.invokedAt,
        source: input.source,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] recordInvocation failed', {
        source: input.source,
        error: message,
      });
    }
  }

  private extractSkillSlug(toolInput: unknown): string | null {
    if (
      typeof toolInput !== 'object' ||
      toolInput === null ||
      !('command' in toolInput)
    ) {
      return null;
    }
    const command = (toolInput as { command?: unknown }).command;
    if (typeof command !== 'string') return null;
    const first = command.trim().split(/\s+/)[0] ?? '';
    const slug = first.startsWith('/') ? first.slice(1) : first;
    return slug.length > 0 ? slug : null;
  }

  private extractSubagentType(toolInput: unknown): string | null {
    if (
      typeof toolInput !== 'object' ||
      toolInput === null ||
      !('subagent_type' in toolInput)
    ) {
      return null;
    }
    const raw = (toolInput as { subagent_type?: unknown }).subagent_type;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim();
    return slug.length > 0 ? slug : null;
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
    source:
      | 'idle'
      | 'boot'
      | 'subagent-stop'
      | 'edit-then-test'
      | 'turn-complete',
    transcriptPath?: string,
  ): Promise<void> {
    try {
      await this.synthesis.analyzeSession(sessionId, workspaceRoot, {
        force: false,
        transcriptPath,
        source,
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
            source: 'boot',
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

  private readTurnCompleteEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.turnComplete.enabled,
      SKILL_TRIGGER_DEFAULTS.turnComplete.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.turnComplete.enabled;
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

  private readSkillInvocationTelemetryEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.skillInvocationTelemetry.enabled,
      SKILL_TRIGGER_DEFAULTS.skillInvocationTelemetry.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.skillInvocationTelemetry.enabled;
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
