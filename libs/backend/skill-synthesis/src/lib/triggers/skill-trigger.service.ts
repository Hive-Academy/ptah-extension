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
} from '@ptah-extension/agent-sdk';
import {
  BootScanRunner,
  deriveWorkspaceFingerprint,
} from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import { SkillSynthesisService } from '../skill-synthesis.service';

const SECTION = 'ptah';
const KEYS = {
  sessionEnd: 'skillSynthesis.triggers.sessionEnd',
  idleMs: 'skillSynthesis.triggers.idleMs',
  bootScan: 'skillSynthesis.triggers.bootScan',
} as const;
const DEFAULTS = {
  sessionEnd: true,
  idleMs: 600000,
  bootScan: true,
} as const;

interface SessionState {
  readonly workspaceRoot: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

@injectable()
export class SkillTriggerService {
  private started = false;
  private activityDisposer: (() => void) | null = null;
  private sessionEndDisposer: (() => void) | null = null;
  private readonly sessions = new Map<string, SessionState>();
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
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    this.sessions.clear();
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
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    this.sessions.delete(payload.sessionId);
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
    source: 'idle' | 'boot',
  ): Promise<void> {
    try {
      await this.synthesis.analyzeSession(sessionId, workspaceRoot);
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
      SECTION,
      KEYS.idleMs,
      DEFAULTS.idleMs,
    );
    return typeof v === 'number' ? v : DEFAULTS.idleMs;
  }

  private readBootScanFlag(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SECTION,
      KEYS.bootScan,
      DEFAULTS.bootScan,
    );
    return typeof v === 'boolean' ? v : DEFAULTS.bootScan;
  }
}
