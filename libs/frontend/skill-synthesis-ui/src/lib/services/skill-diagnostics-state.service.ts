import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  EligibilityHistogramDto,
  SkillDiagnosticsResult,
  SkillSynthesisEventWire,
  SkillTriggersDto,
} from '@ptah-extension/shared';

import { SkillDiagnosticsRpcService } from './skill-diagnostics-rpc.service';

const POLL_INTERVAL_MS = 30_000;

const DEFAULT_TRIGGERS: SkillTriggersDto = {
  sessionEnd: true,
  idleMs: 600_000,
  bootScan: true,
  turnComplete: { enabled: true },
};

const DEFAULT_HISTOGRAM: EligibilityHistogramDto = {
  tooFewTurns: 0,
  lowFidelity: 0,
  insufficientAbstraction: 0,
  accepted: 0,
};

export interface SkillByStatusCounts {
  readonly totalCandidates: number;
  readonly totalPromoted: number;
  readonly totalRejected: number;
  readonly activeSkills: number;
  readonly totalInvocations: number;
}

@Injectable({ providedIn: 'root' })
export class SkillDiagnosticsStateService {
  private readonly rpc = inject(SkillDiagnosticsRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);

  private readonly _triggers = signal<SkillTriggersDto>(DEFAULT_TRIGGERS);
  private readonly _lastAnalyzeRunAt = signal<number | null>(null);
  private readonly _lastCuratorPassAt = signal<number | null>(null);
  private readonly _recentEvents = signal<readonly SkillSynthesisEventWire[]>(
    [],
  );
  private readonly _eligibilityHistogram =
    signal<EligibilityHistogramDto>(DEFAULT_HISTOGRAM);
  private readonly _byStatus = signal<SkillByStatusCounts>({
    totalCandidates: 0,
    totalPromoted: 0,
    totalRejected: 0,
    activeSkills: 0,
    totalInvocations: 0,
  });
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _subscriberCount = signal<number>(0);

  public readonly triggers = this._triggers.asReadonly();
  public readonly lastAnalyzeRunAt = this._lastAnalyzeRunAt.asReadonly();
  public readonly lastCuratorPassAt = this._lastCuratorPassAt.asReadonly();
  public readonly recentEvents = this._recentEvents.asReadonly();
  public readonly eligibilityHistogram =
    this._eligibilityHistogram.asReadonly();
  public readonly byStatus = this._byStatus.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  public readonly sessionsAnalyzedToday = computed<number>(() => {
    const h = this._eligibilityHistogram();
    return (
      h.tooFewTurns + h.lowFidelity + h.insufficientAbstraction + h.accepted
    );
  });

  public readonly hasActiveSession = computed<boolean>(() => {
    const tab = this.tabManager.activeTab();
    return tab !== null && tab.claudeSessionId !== null;
  });

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  public async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const workspaceRoot = this.appState.workspaceInfo()?.path ?? null;
      const snapshot = await this.rpc.diagnostics({ workspaceRoot });
      this.applySnapshot(snapshot);
    } catch (err: unknown) {
      this._error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this._loading.set(false);
    }
  }

  public async analyzeNow(): Promise<void> {
    const workspaceRoot = this.appState.workspaceInfo()?.path ?? null;
    if (!workspaceRoot) {
      this._error.set('No active workspace');
      return;
    }
    const sessionId = this.tabManager.activeTab()?.claudeSessionId ?? null;
    if (!sessionId) {
      this._error.set('No active session to analyze.');
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      await this.rpc.analyzeNow({
        sessionId: String(sessionId),
        workspaceRoot,
        force: true,
      });
      await this.refresh();
    } catch (err: unknown) {
      this._error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this._loading.set(false);
    }
  }

  public async setTriggers(triggers: Partial<SkillTriggersDto>): Promise<void> {
    this._error.set(null);
    try {
      const result = await this.rpc.setTriggers(triggers);
      this._triggers.set(result.triggers);
      await this.refresh();
    } catch (err: unknown) {
      this._error.set(err instanceof Error ? err.message : String(err));
    }
  }

  public startPolling(): void {
    const next = this._subscriberCount() + 1;
    this._subscriberCount.set(next);
    if (next === 1 && this.pollHandle === null) {
      this.pollHandle = setInterval(() => {
        void this.refresh();
      }, POLL_INTERVAL_MS);
    }
  }

  public stopPolling(): void {
    const current = this._subscriberCount();
    if (current <= 0) return;
    const next = current - 1;
    this._subscriberCount.set(next);
    if (next === 0 && this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private applySnapshot(snapshot: SkillDiagnosticsResult): void {
    this._lastAnalyzeRunAt.set(snapshot.lastAnalyzeRunAt);
    this._lastCuratorPassAt.set(snapshot.lastCuratorPassAt);
    this._recentEvents.set(snapshot.recentEvents);
    this._eligibilityHistogram.set(snapshot.eligibilityHistogram);
    this._triggers.set(snapshot.triggers);
    this._byStatus.set({
      totalCandidates: snapshot.totalCandidates,
      totalPromoted: snapshot.totalPromoted,
      totalRejected: snapshot.totalRejected,
      activeSkills: snapshot.activeSkills,
      totalInvocations: snapshot.totalInvocations,
    });
  }
}
