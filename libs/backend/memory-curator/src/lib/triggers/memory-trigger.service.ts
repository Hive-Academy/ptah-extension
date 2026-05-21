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
} as const;
const DEFAULTS = {
  preCompact: true,
  idleMs: 600000,
  turnThreshold: 20,
  bootScan: true,
} as const;

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
  private readonly sessions = new Map<string, SessionState>();
  private bootScanController: AbortController | null = null;

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

    this.logger.info('[memory-curator] trigger service started');
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
    source: 'idle' | 'turn' | 'boot',
  ): Promise<void> {
    try {
      await this.curator.curate({ sessionId, workspaceRoot });
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
        run: (sessionId, workspaceRoot) =>
          this.curator.curate({ sessionId, workspaceRoot }),
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
}
