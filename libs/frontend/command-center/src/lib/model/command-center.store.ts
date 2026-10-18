import { Injectable, signal } from '@angular/core';

export type CommandSessionStatus =
  'idle' | 'starting' | 'running' | 'stopped' | 'error';

export type CommandVoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'stopped'
  | 'error';

export type CommandWorkState =
  | 'idle'
  | 'unknown'
  | 'queued'
  | 'starting'
  | 'running'
  | 'awaiting input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CommandWorkNode {
  readonly id: string;
  readonly kind: 'root' | 'child' | 'agent' | 'tribunal' | 'lane' | 'phase';
  readonly agentKind?: 'cli' | 'sdk';
  readonly parentId: string | null;
  readonly label: string;
  readonly providerId: string | null;
  readonly state: CommandWorkState;
  readonly updatedAt?: number;
  readonly task?: string;
  readonly tabId?: string;
}

export interface CommandWorkEdge {
  readonly fromId: string;
  readonly toId: string;
}

export interface CommandPendingInput {
  readonly id: string;
  readonly kind: 'question' | 'approval';
  readonly title: string;
  readonly description: string;
}

export interface CommandProviderReadiness {
  readonly transcription: boolean;
  readonly synthesis: boolean;
  readonly stt?: CommandProviderDirection | null;
  readonly tts?: CommandProviderDirection | null;
}

export interface CommandProviderDirection {
  readonly providerId: 'local' | 'elevenlabs';
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly ready: boolean;
  readonly status: 'Ready' | 'Not downloaded' | 'No key';
}

export interface CommandToast {
  readonly message: string;
  readonly tone: 'info' | 'success' | 'warning' | 'error';
  readonly action?: 'retry-speech' | 'retry-decline';
}

export type CommandVoiceErrorKind =
  | 'mic-denied'
  | 'mic-unavailable'
  | 'worklet'
  | 'stt'
  | 'tts'
  | 'playback'
  | 'chat';

export interface CommandVoiceError {
  readonly kind: CommandVoiceErrorKind;
  readonly message: string;
}

export type CommandTheme = 'light' | 'dark';

/** Page-scoped store provided by CommandCenterPageComponent; the scene renderer owns mutable frame state. */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped, provided by the Command Center page component; see the class note.
@Injectable()
export class CommandCenterStore {
  private readonly _markedTabId = signal<string | null>(null);
  public readonly markedTabId = this._markedTabId.asReadonly();

  private readonly _sessionId = signal<string | null>(null);
  public readonly sessionId = this._sessionId.asReadonly();

  private readonly _workspace = signal<string | null>(null);
  public readonly workspace = this._workspace.asReadonly();

  private readonly _sessionStatus = signal<CommandSessionStatus>('idle');
  public readonly sessionStatus = this._sessionStatus.asReadonly();

  private readonly _voiceState = signal<CommandVoiceState>('idle');
  public readonly voiceState = this._voiceState.asReadonly();

  private readonly _voiceError = signal<CommandVoiceError | null>(null);
  public readonly voiceError = this._voiceError.asReadonly();

  private readonly _inputLevel = signal(0);
  public readonly inputLevel = this._inputLevel.asReadonly();

  private readonly _outputLevel = signal(0);
  public readonly outputLevel = this._outputLevel.asReadonly();

  private readonly _muted = signal(false);
  public readonly muted = this._muted.asReadonly();

  private readonly _nodes = signal<readonly CommandWorkNode[]>([]);
  public readonly nodes = this._nodes.asReadonly();

  private readonly _edges = signal<readonly CommandWorkEdge[]>([]);
  public readonly edges = this._edges.asReadonly();

  private readonly _selectedId = signal<string | null>(null);
  public readonly selectedId = this._selectedId.asReadonly();

  private readonly _pendingInput = signal<CommandPendingInput | null>(null);
  public readonly pendingInput = this._pendingInput.asReadonly();

  private readonly _provider = signal<CommandProviderReadiness>({
    transcription: false,
    synthesis: false,
  });
  public readonly provider = this._provider.asReadonly();

  private readonly _toast = signal<CommandToast | null>(null);
  public readonly toast = this._toast.asReadonly();

  private readonly _theme = signal<CommandTheme>('dark');
  public readonly theme = this._theme.asReadonly();

  private readonly _reducedMotion = signal(false);
  public readonly reducedMotion = this._reducedMotion.asReadonly();

  private lastLevelUpdateAt: number | null = null;

  public setSession(
    markedTabId: string | null,
    sessionId: string | null,
    workspace: string | null,
  ): void {
    if (markedTabId !== this._markedTabId()) {
      this._voiceError.set(null);
      this._toast.set(null);
    }
    this._markedTabId.set(markedTabId);
    this._sessionId.set(sessionId);
    this._workspace.set(workspace);
  }

  public setSessionStatus(status: CommandSessionStatus): void {
    this._sessionStatus.set(status);
  }

  public setVoiceState(state: CommandVoiceState): void {
    this._voiceState.set(state);
    if (state === 'listening') this._voiceError.set(null);
  }

  public setVoiceError(error: CommandVoiceError | null): void {
    this._voiceError.set(error === null ? null : { ...error });
  }

  public setMuted(muted: boolean): void {
    this._muted.set(muted);
    if (muted) {
      this._inputLevel.set(0);
    }
  }

  /** Meter snapshots are sampled at most twice per second, including when frames arrive faster. */
  public updateLevels(input: number, output: number): void {
    const now = Date.now();
    if (this.lastLevelUpdateAt !== null && now - this.lastLevelUpdateAt < 500) {
      return;
    }
    this.lastLevelUpdateAt = now;
    this._inputLevel.set(this._muted() ? 0 : this.clampLevel(input));
    this._outputLevel.set(this.clampLevel(output));
  }

  public resetLevels(): void {
    this._inputLevel.set(0);
    this._outputLevel.set(0);
    this.lastLevelUpdateAt = null;
  }

  /** Keep only the dedicated root and its descendants, regardless of input order. */
  public setProjection(
    rootId: string,
    nodes: readonly CommandWorkNode[],
    edges: readonly CommandWorkEdge[],
  ): void {
    const included = new Set([rootId]);
    let changed: boolean;
    do {
      changed = false;
      for (const node of nodes) {
        if (
          node.parentId !== null &&
          included.has(node.parentId) &&
          !included.has(node.id)
        ) {
          included.add(node.id);
          changed = true;
        }
      }
    } while (changed);

    this._nodes.set(
      nodes
        .filter((node) => included.has(node.id))
        .map((node) => ({ ...node })),
    );
    this._edges.set(
      edges
        .filter((edge) => included.has(edge.fromId) && included.has(edge.toId))
        .map((edge) => ({ ...edge })),
    );
    const selectedId = this._selectedId();
    if (selectedId !== null && !included.has(selectedId)) {
      this._selectedId.set(null);
    }
  }

  public select(id: string | null): void {
    this._selectedId.set(
      id !== null && this._nodes().some((node) => node.id === id) ? id : null,
    );
  }

  public setPendingInput(input: CommandPendingInput | null): void {
    this._pendingInput.set(input === null ? null : { ...input });
  }

  public setProvider(readiness: CommandProviderReadiness): void {
    this._provider.update((current) => ({
      ...current,
      ...readiness,
      stt:
        readiness.stt === undefined
          ? current.stt && {
              ...current.stt,
              ready: readiness.transcription,
              status: readiness.transcription
                ? ('Ready' as const)
                : current.stt.providerId === 'local'
                  ? ('Not downloaded' as const)
                  : ('No key' as const),
            }
          : readiness.stt,
      tts:
        readiness.tts === undefined
          ? current.tts && {
              ...current.tts,
              ready: readiness.synthesis,
              status: readiness.synthesis
                ? ('Ready' as const)
                : current.tts.providerId === 'local'
                  ? ('Not downloaded' as const)
                  : ('No key' as const),
            }
          : readiness.tts,
    }));
  }

  public setToast(toast: CommandToast | null): void {
    this._toast.set(toast === null ? null : { ...toast });
  }

  public setTheme(theme: CommandTheme): void {
    this._theme.set(theme);
  }

  public setReducedMotion(reduced: boolean): void {
    this._reducedMotion.set(reduced);
  }

  private clampLevel(level: number): number {
    return Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  }
}
