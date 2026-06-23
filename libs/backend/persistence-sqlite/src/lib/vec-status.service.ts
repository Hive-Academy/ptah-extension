import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import { SqliteConnectionService } from './sqlite-connection.service';
import type { VecLoadDiagnostic, VecLoadReason } from './vec-load-diagnostic';

export interface VecStatusSnapshot {
  readonly available: boolean;
  readonly reason: VecLoadReason;
  readonly diagnostic: VecLoadDiagnostic;
}

export interface VecStatusChangeListener {
  (snapshot: VecStatusSnapshot): void;
}

export interface Disposable {
  dispose(): void;
}

@injectable()
export class VecStatusService {
  private readonly listeners = new Set<VecStatusChangeListener>();
  private lastSnapshot: VecStatusSnapshot | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  get available(): boolean {
    return this.snapshot().available;
  }

  get reason(): VecLoadReason {
    return this.snapshot().reason;
  }

  get diagnostic(): VecLoadDiagnostic {
    return this.snapshot().diagnostic;
  }

  getStatus(): VecStatusSnapshot {
    return this.snapshot();
  }

  on(event: 'change', listener: VecStatusChangeListener): Disposable {
    if (event !== 'change') {
      throw new Error(
        `[persistence-sqlite] VecStatusService: unsupported event '${event}'`,
      );
    }
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  refresh(): void {
    const next = this.computeSnapshot();
    const prev = this.lastSnapshot;
    this.lastSnapshot = next;
    if (!prev || !this.snapshotsEqual(prev, next)) {
      for (const listener of this.listeners) {
        try {
          listener(next);
        } catch (error: unknown) {
          this.logger.warn(
            '[persistence-sqlite] VecStatusService listener threw',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    }
  }

  private snapshot(): VecStatusSnapshot {
    const next = this.computeSnapshot();
    this.lastSnapshot = next;
    return next;
  }

  private computeSnapshot(): VecStatusSnapshot {
    const diagnostic = this.connection.vecLoadDiagnostic;
    return {
      available: diagnostic.ok,
      reason: diagnostic.reason,
      diagnostic,
    };
  }

  private snapshotsEqual(a: VecStatusSnapshot, b: VecStatusSnapshot): boolean {
    return (
      a.available === b.available &&
      a.reason === b.reason &&
      a.diagnostic.attemptedPath === b.diagnostic.attemptedPath &&
      a.diagnostic.packageName === b.diagnostic.packageName &&
      (a.diagnostic.error?.message ?? null) ===
        (b.diagnostic.error?.message ?? null)
    );
  }
}
