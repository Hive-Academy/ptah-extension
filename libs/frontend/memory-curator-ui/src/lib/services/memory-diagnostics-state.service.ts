import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  MemoryCuratorEventWire,
  MemoryDbHealthDto,
  MemoryStorageHealthDto,
  MemoryTriggersDto,
} from '@ptah-extension/shared';

import {
  MemoryDiagnosticsRpcService,
  MemoryPausedError,
} from './memory-diagnostics-rpc.service';

export interface LastRunSnapshot {
  readonly at: number;
  readonly stats: Readonly<
    Record<string, number | string | boolean | null>
  > | null;
}

export const DIAGNOSTICS_POLL_MS = 30_000;

/** Tooltip and hint on a manual run that the Memory switch blocks (plan 3.6). */
export const MEMORY_PAUSED_REASON = 'Paused — resume Memory to run';
/** Shown when the host refused a run because Memory was paused elsewhere. */
export const MEMORY_PAUSED_NOTICE =
  'Memory is paused, so the curator did not run. Turn Memory on at the top of this tab to run it.';
const MEMORY_SWITCH_WRITE_ERROR =
  'Could not change the Memory switch. It shows the saved setting.';
const MEMORY_SWITCH_READ_ERROR = 'Could not read whether Memory is paused.';

@Injectable({ providedIn: 'root' })
export class MemoryDiagnosticsStateService {
  private readonly rpc = inject(MemoryDiagnosticsRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);

  private readonly _triggers = signal<MemoryTriggersDto | null>(null);
  private readonly _lastRun = signal<LastRunSnapshot | null>(null);
  private readonly _recentEvents = signal<readonly MemoryCuratorEventWire[]>(
    [],
  );
  private readonly _dbHealth = signal<MemoryDbHealthDto | null>(null);
  private readonly _storage = signal<MemoryStorageHealthDto | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  public readonly triggers = this._triggers.asReadonly();
  public readonly lastRun = this._lastRun.asReadonly();
  public readonly recentEvents = this._recentEvents.asReadonly();
  public readonly dbHealth = this._dbHealth.asReadonly();
  public readonly storage = this._storage.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  public readonly hasActiveSession = computed<boolean>(() => {
    const tab = this.tabManager.activeTab();
    return tab !== null && tab.claudeSessionId !== null;
  });

  /** `memory.enabled` as the host last reported it; `null` until first read. */
  private readonly _memoryEnabled = signal<boolean | null>(null);
  /** The switch position while a write is in flight; `null` otherwise. */
  private readonly _memoryEnabledPending = signal<boolean | null>(null);
  private readonly _memorySwitchSaving = signal<boolean>(false);
  private readonly _memorySwitchError = signal<string | null>(null);
  private readonly _pausedNotice = signal<string | null>(null);

  /** The host's committed value. Drives `pausedChange`, never the optimistic one. */
  public readonly memoryEnabledCommitted = this._memoryEnabled.asReadonly();
  /** What the switch shows: the pending write, else the committed value. */
  public readonly memoryEnabled = computed<boolean | null>(
    () => this._memoryEnabledPending() ?? this._memoryEnabled(),
  );
  /** Manual runs are greyed out while this is true. */
  public readonly memoryPaused = computed<boolean>(
    () => this.memoryEnabled() === false,
  );
  public readonly memorySwitchSaving = this._memorySwitchSaving.asReadonly();
  public readonly memorySwitchError = this._memorySwitchError.asReadonly();
  public readonly pausedNotice = this._pausedNotice.asReadonly();

  /**
   * Bumped by every switch read and write. A read applies its answer only if
   * no newer read or write started meanwhile, so a slow GET can never put back
   * a value the user has just changed.
   */
  private switchSeq = 0;

  private subscriberCount = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Re-read `memory.enabled` (tab shown, window focus, page visible). Skipped
   * while a write is in flight: that write's read-back is the newer answer.
   */
  public async loadMemoryEnabled(): Promise<void> {
    if (this._memorySwitchSaving()) return;
    const seq = ++this.switchSeq;
    try {
      const res = await this.rpc.getTriggers();
      if (seq === this.switchSeq) {
        this.applyMemoryEnabled(res.enabled);
        // A write failure stays until the next toggle; only a read error is
        // answered by a successful read.
        if (this._memorySwitchError() === MEMORY_SWITCH_READ_ERROR) {
          this._memorySwitchError.set(null);
        }
      }
    } catch {
      // Shown under the switch, which stays disabled until a read succeeds.
      if (seq === this.switchSeq) {
        this._memorySwitchError.set(MEMORY_SWITCH_READ_ERROR);
      }
    }
  }

  /**
   * Turn Memory on or off. Sends `{ triggers: {}, enabled }` only — never the
   * cached trigger DTO, which could be stale (plan 3.7). Optimistic: the switch
   * moves at once and rolls back to the committed value on failure, which is
   * then re-read from the host.
   */
  public async setMemoryEnabled(enabled: boolean): Promise<void> {
    if (this._memorySwitchSaving()) return;
    ++this.switchSeq;
    this._memorySwitchSaving.set(true);
    this._memoryEnabledPending.set(enabled);
    this._memorySwitchError.set(null);
    let failed = false;
    try {
      const res = await this.rpc.setTriggers({ triggers: {}, enabled });
      ++this.switchSeq;
      this.applyMemoryEnabled(res.enabled);
    } catch {
      // Shown under the switch; the committed value is re-read below.
      failed = true;
      this._memorySwitchError.set(MEMORY_SWITCH_WRITE_ERROR);
    } finally {
      this._memoryEnabledPending.set(null);
      this._memorySwitchSaving.set(false);
    }
    if (failed) await this.loadMemoryEnabled();
  }

  private applyMemoryEnabled(value: unknown): void {
    // A missing or non-boolean answer is unknown, not "on".
    const enabled = typeof value === 'boolean' ? value : null;
    this._memoryEnabled.set(enabled);
    if (enabled === true) this._pausedNotice.set(null);
  }

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
      this._recentEvents.set(snapshot.recentEvents);
      this._dbHealth.set(snapshot.dbHealth);
      this._storage.set(snapshot.storage);
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
    if (this.memoryPaused()) {
      this._pausedNotice.set(MEMORY_PAUSED_NOTICE);
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this._pausedNotice.set(null);
    try {
      await this.rpc.runNow({
        sessionId: String(sessionId),
        workspaceRoot: root,
      });
      await this.refresh();
    } catch (err) {
      if (err instanceof MemoryPausedError) {
        // Paused elsewhere (tray, settings file) after this tab last read the
        // switch: show the paused state, not a failure.
        ++this.switchSeq;
        this._memoryEnabled.set(false);
        this._pausedNotice.set(MEMORY_PAUSED_NOTICE);
      } else {
        this._error.set(toErrorMessage(err));
      }
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
