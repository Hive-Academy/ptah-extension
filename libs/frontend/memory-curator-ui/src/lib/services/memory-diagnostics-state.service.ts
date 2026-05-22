import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  MemoryCuratorEventWire,
  MemoryDbHealthDto,
  MemoryTriggersDto,
} from '@ptah-extension/shared';

import { MemoryDiagnosticsRpcService } from './memory-diagnostics-rpc.service';

export interface LastRunSnapshot {
  readonly at: number;
  readonly stats: Readonly<
    Record<string, number | string | boolean | null>
  > | null;
}

export const DIAGNOSTICS_POLL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class MemoryDiagnosticsStateService {
  private readonly rpc = inject(MemoryDiagnosticsRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);

  private readonly _triggers = signal<MemoryTriggersDto | null>(null);
  private readonly _lastRun = signal<LastRunSnapshot | null>(null);
  private readonly _lastDecay = signal<LastRunSnapshot | null>(null);
  private readonly _recentEvents = signal<readonly MemoryCuratorEventWire[]>(
    [],
  );
  private readonly _dbHealth = signal<MemoryDbHealthDto | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  public readonly triggers = this._triggers.asReadonly();
  public readonly lastRun = this._lastRun.asReadonly();
  public readonly lastDecay = this._lastDecay.asReadonly();
  public readonly recentEvents = this._recentEvents.asReadonly();
  public readonly dbHealth = this._dbHealth.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  public readonly hasActiveSession = computed<boolean>(() => {
    const tab = this.tabManager.activeTab();
    return tab !== null && tab.claudeSessionId !== null;
  });

  private subscriberCount = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  public async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const workspaceRoot = this.appState.workspaceInfo()?.path ?? null;
      const snapshot = await this.rpc.diagnostics(workspaceRoot);
      this._triggers.set(snapshot.triggers);
      this._lastRun.set(
        snapshot.lastRunAt !== null
          ? { at: snapshot.lastRunAt, stats: snapshot.lastRunStats }
          : null,
      );
      this._lastDecay.set(
        snapshot.lastDecayAt !== null
          ? { at: snapshot.lastDecayAt, stats: snapshot.lastDecayStats }
          : null,
      );
      this._recentEvents.set(snapshot.recentEvents);
      this._dbHealth.set(snapshot.dbHealth);
    } catch (err) {
      this._error.set(toErrorMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  public async runNow(): Promise<void> {
    const root = this.appState.workspaceInfo()?.path;
    if (!root) {
      this._error.set('No workspace is open.');
      return;
    }
    const sessionId = this.tabManager.activeTab()?.claudeSessionId ?? null;
    if (!sessionId) {
      this._error.set('No active session to curate.');
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      await this.rpc.runNow({
        sessionId: String(sessionId),
        workspaceRoot: root,
      });
      await this.refresh();
    } catch (err) {
      this._error.set(toErrorMessage(err));
      this._loading.set(false);
    }
  }

  public async setTriggers(patch: Partial<MemoryTriggersDto>): Promise<void> {
    this._error.set(null);
    try {
      const res = await this.rpc.setTriggers({ triggers: patch });
      this._triggers.set(res.triggers);
    } catch (err) {
      this._error.set(toErrorMessage(err));
    }
  }

  public startPolling(): void {
    this.subscriberCount += 1;
    if (this.subscriberCount === 1) {
      void this.refresh();
      this.scheduleNextPoll();
    }
  }

  public stopPolling(): void {
    if (this.subscriberCount === 0) return;
    this.subscriberCount -= 1;
    if (this.subscriberCount === 0) {
      this.clearPollTimer();
    }
  }

  private scheduleNextPoll(): void {
    this.clearPollTimer();
    this.pollTimer = setTimeout(() => {
      void this.refresh().finally(() => {
        if (this.subscriberCount > 0) {
          this.scheduleNextPoll();
        }
      });
    }, DIAGNOSTICS_POLL_MS);
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown diagnostics error';
}
