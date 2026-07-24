import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  BackgroundTaskSummary,
  SessionCronSummary,
  SDKAssistantMessageError,
  TerminalReason,
} from '../types/sdk-types/claude-sdk.types';

export interface SdkAdapterInitializedEvent {
  readonly success: boolean;
  readonly timestamp: number;
}

export interface SdkAdapterDisposedEvent {
  readonly timestamp: number;
}

export interface SdkAdapterConfigChangedEvent {
  readonly key: string;
  readonly timestamp: number;
}

export interface SdkAdapterAuthFileChangedEvent {
  /** Provider whose external credential file changed (e.g. 'openai-codex'). */
  readonly providerId: string;
  readonly timestamp: number;
}

export interface SdkAdapterCompactionCompleteEvent {
  readonly sessionId: string;
  readonly cwd: string;
  readonly trigger: 'manual' | 'auto';
  readonly compactSummary: string;
  readonly timestamp: number;
}

export interface SdkAdapterTurnEndedEvent {
  readonly sessionId: string;
  readonly cwd: string;
  readonly lastAssistantMessage: string | null;
  readonly backgroundTasks: readonly BackgroundTaskSummary[];
  readonly sessionCrons: readonly SessionCronSummary[];
  readonly terminalReason: TerminalReason | null;
  readonly timestamp: number;
}

export interface SdkAdapterTurnFailedEvent {
  readonly sessionId: string;
  readonly cwd: string;
  readonly lastAssistantMessage: string | null;
  readonly error: SDKAssistantMessageError;
  readonly errorDetails: string | null;
  readonly terminalReason: TerminalReason | null;
  readonly timestamp: number;
}

export interface SdkAdapterSubagentEndedEvent {
  readonly sessionId: string;
  readonly cwd: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly lastAssistantMessage: string | null;
  readonly backgroundTasks: readonly BackgroundTaskSummary[];
  readonly timestamp: number;
}

/**
 * Emitted when the SDK fires the `TeammateIdle` hook — a named in-SDK teammate
 * has gone idle and is awaiting steering. Keyed on the human-legible
 * `teammateName` (never on `team_name`, which the SDK is deprecating toward a
 * single implicit team). A future UI can use this to show "agent idle, awaiting
 * steering" affordances.
 */
export interface SdkAdapterTeammateIdleEvent {
  readonly sessionId: string;
  readonly cwd: string;
  readonly teammateName: string;
  readonly timestamp: number;
}

interface SdkAdapterEventMap {
  initialized: (event: SdkAdapterInitializedEvent) => void;
  disposed: (event: SdkAdapterDisposedEvent) => void;
  configChanged: (event: SdkAdapterConfigChangedEvent) => void;
  authFileChanged: (event: SdkAdapterAuthFileChangedEvent) => void;
  compactionComplete: (event: SdkAdapterCompactionCompleteEvent) => void;
  turnEnded: (event: SdkAdapterTurnEndedEvent) => void;
  turnFailed: (event: SdkAdapterTurnFailedEvent) => void;
  subagentEnded: (event: SdkAdapterSubagentEndedEvent) => void;
  teammateIdle: (event: SdkAdapterTeammateIdleEvent) => void;
}

export type SdkAdapterEventName = keyof SdkAdapterEventMap;

@injectable()
export class SdkAdapterEvents {
  private readonly emitter = new EventEmitter<SdkAdapterEventMap>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  emitInitialized(event: SdkAdapterInitializedEvent): void {
    this.safeEmit('initialized', event);
  }

  emitDisposed(event: SdkAdapterDisposedEvent): void {
    this.safeEmit('disposed', event);
  }

  emitConfigChanged(event: SdkAdapterConfigChangedEvent): void {
    this.safeEmit('configChanged', event);
  }

  emitAuthFileChanged(event: SdkAdapterAuthFileChangedEvent): void {
    this.safeEmit('authFileChanged', event);
  }

  emitCompactionComplete(event: SdkAdapterCompactionCompleteEvent): void {
    this.safeEmit('compactionComplete', event);
  }

  emitTurnEnded(event: SdkAdapterTurnEndedEvent): void {
    this.safeEmit('turnEnded', event);
  }

  emitTurnFailed(event: SdkAdapterTurnFailedEvent): void {
    this.safeEmit('turnFailed', event);
  }

  emitSubagentEnded(event: SdkAdapterSubagentEndedEvent): void {
    this.safeEmit('subagentEnded', event);
  }

  emitTeammateIdle(event: SdkAdapterTeammateIdleEvent): void {
    this.safeEmit('teammateIdle', event);
  }

  onInitialized(
    listener: (event: SdkAdapterInitializedEvent) => void,
  ): () => void {
    this.emitter.on('initialized', listener);
    return () => this.emitter.off('initialized', listener);
  }

  onDisposed(listener: (event: SdkAdapterDisposedEvent) => void): () => void {
    this.emitter.on('disposed', listener);
    return () => this.emitter.off('disposed', listener);
  }

  onConfigChanged(
    listener: (event: SdkAdapterConfigChangedEvent) => void,
  ): () => void {
    this.emitter.on('configChanged', listener);
    return () => this.emitter.off('configChanged', listener);
  }

  onAuthFileChanged(
    listener: (event: SdkAdapterAuthFileChangedEvent) => void,
  ): () => void {
    this.emitter.on('authFileChanged', listener);
    return () => this.emitter.off('authFileChanged', listener);
  }

  onCompactionComplete(
    listener: (event: SdkAdapterCompactionCompleteEvent) => void,
  ): () => void {
    this.emitter.on('compactionComplete', listener);
    return () => this.emitter.off('compactionComplete', listener);
  }

  onTurnEnded(listener: (event: SdkAdapterTurnEndedEvent) => void): () => void {
    this.emitter.on('turnEnded', listener);
    return () => this.emitter.off('turnEnded', listener);
  }

  onTurnFailed(
    listener: (event: SdkAdapterTurnFailedEvent) => void,
  ): () => void {
    this.emitter.on('turnFailed', listener);
    return () => this.emitter.off('turnFailed', listener);
  }

  onSubagentEnded(
    listener: (event: SdkAdapterSubagentEndedEvent) => void,
  ): () => void {
    this.emitter.on('subagentEnded', listener);
    return () => this.emitter.off('subagentEnded', listener);
  }

  onTeammateIdle(
    listener: (event: SdkAdapterTeammateIdleEvent) => void,
  ): () => void {
    this.emitter.on('teammateIdle', listener);
    return () => this.emitter.off('teammateIdle', listener);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  listenerCount(event: SdkAdapterEventName): number {
    return this.emitter.listenerCount(event);
  }

  private safeEmit<E extends SdkAdapterEventName>(
    event: E,
    payload: Parameters<SdkAdapterEventMap[E]>[0],
  ): void {
    try {
      this.emitter.emit(
        event,
        payload as unknown as SdkAdapterInitializedEvent &
          SdkAdapterDisposedEvent &
          SdkAdapterConfigChangedEvent &
          SdkAdapterAuthFileChangedEvent &
          SdkAdapterCompactionCompleteEvent &
          SdkAdapterTurnEndedEvent &
          SdkAdapterTurnFailedEvent &
          SdkAdapterSubagentEndedEvent &
          SdkAdapterTeammateIdleEvent,
      );
    } catch (err) {
      this.logger.warn(
        `[SdkAdapterEvents] '${event}' listener threw`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
