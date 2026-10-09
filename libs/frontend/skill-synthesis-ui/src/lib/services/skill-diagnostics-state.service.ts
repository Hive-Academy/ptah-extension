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
import { SkillsPausedError } from './skill-synthesis-rpc.service';
import { SKILLS_PAUSED_NOTICE } from './skill-synthesis-state.service';

const POLL_INTERVAL_MS = 30_000;

/**
 * How many recent skill-synthesis events the webview keeps: the cap on the
 * live list and the `eventLimit` requested with every diagnostics snapshot, so
 * a refresh and the live push show the same window. The feed groups repeated
 * events, so the window must be wider than the rows it displays.
 */
export const SKILL_EVENT_WINDOW = 50;

/**
 * Newest-first order: later `timestamp` first; within one millisecond the
 * greater ULID first (the backend's ids are monotonic in recording order).
 */
function compareNewestFirst(
  a: SkillSynthesisEventWire,
  b: SkillSynthesisEventWire,
): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** Copy of `events` in newest-first order with repeated ids dropped. */
function normalizeEvents(
  events: readonly SkillSynthesisEventWire[],
): SkillSynthesisEventWire[] {
  const seen = new Set<string>();
  const unique: SkillSynthesisEventWire[] = [];
  for (const ev of events) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    unique.push(ev);
  }
  return unique.sort(compareNewestFirst).slice(0, SKILL_EVENT_WINDOW);
}

function latest(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.max(current, candidate);
}

/** Inserts `event` at its newest-first position in an already sorted list. */
function insertNewestFirst(
  list: readonly SkillSynthesisEventWire[],
  event: SkillSynthesisEventWire,
): SkillSynthesisEventWire[] {
  const index = list.findIndex((ev) => compareNewestFirst(event, ev) < 0);
  const next = [...list];
  next.splice(index === -1 ? next.length : index, 0, event);
  return next.slice(0, SKILL_EVENT_WINDOW);
}

const DEFAULT_TRIGGERS: SkillTriggersDto = {
  idleMs: 600_000,
  bootScan: true,
  turnComplete: { enabled: true },
};

const DEFAULT_HISTOGRAM: EligibilityHistogramDto = {
  prefilterTooThin: 0,
  prefilterRejected: 0,
  accepted: 0,
};

export interface SkillByStatusCounts {
  readonly totalCandidates: number;
  readonly totalPromoted: number;
  readonly totalRejected: number;
  readonly activeSkills: number;
  readonly totalInvocations: number;
  readonly totalMerged: number;
  readonly totalRetired: number;
  readonly totalDormant: number;
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
    totalMerged: 0,
    totalRetired: 0,
    totalDormant: 0,
  });
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _pausedNotice = signal<string | null>(null);
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
  public readonly pausedNotice = this._pausedNotice.asReadonly();

  public readonly sessionsAnalyzedToday = computed<number>(() => {
    const h = this._eligibilityHistogram();
    return h.prefilterTooThin + h.prefilterRejected + h.accepted;
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
      const snapshot = await this.rpc.diagnostics({
        workspaceRoot,
        eventLimit: SKILL_EVENT_WINDOW,
      });
      this.applySnapshot(snapshot);
    } catch (err: unknown) {
      this._error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Analyze the active session now. Resolves `'paused'` when the host refused
   * because Skills is paused, so the caller can update the switch; that
   * refusal is shown as {@link pausedNotice}, not as an error.
   */
  public async analyzeNow(): Promise<'paused' | 'done'> {
    const workspaceRoot = this.appState.workspaceInfo()?.path ?? null;
    if (!workspaceRoot) {
      this._error.set('No active workspace');
      return 'done';
    }
    const sessionId = this.tabManager.activeTab()?.claudeSessionId ?? null;
    if (!sessionId) {
      this._error.set('No active session to analyze.');
      return 'done';
    }
    this._loading.set(true);
    this._error.set(null);
    this._pausedNotice.set(null);
    let outcome: 'paused' | 'done' = 'done';
    try {
      await this.rpc.analyzeNow({
        sessionId: String(sessionId),
        workspaceRoot,
        force: true,
      });
      await this.refresh();
    } catch (err: unknown) {
      if (err instanceof SkillsPausedError) {
        outcome = 'paused';
        this._pausedNotice.set(SKILLS_PAUSED_NOTICE);
      } else {
        this._error.set(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this._loading.set(false);
    }
    return outcome;
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

  /**
   * Record a live skill-synthesis event pushed from the backend.
   *
   * `recentEvents` is newest-first: the event is inserted at its position by
   * (timestamp desc, id desc), so a late-delivered older event does not jump
   * to the top, and the list stays capped at {@link SKILL_EVENT_WINDOW}. An
   * event whose id is already listed (the snapshot fetched it first, or the
   * push was delivered twice) is ignored entirely: the backend sends the same
   * payload for one id on both paths, and the histogram must not count it
   * twice. For a new event, bumps the matching last-run timestamp and, for
   * ineligible events, the eligibility histogram bucket when the reason is
   * derivable. The periodic poll/refresh corrects any remaining drift.
   */
  public pushLiveEvent(event: SkillSynthesisEventWire): void {
    if (this._recentEvents().some((ev) => ev.id === event.id)) return;
    this._recentEvents.update((list) => insertNewestFirst(list, event));

    // A late-delivered older event must not move "last run" backwards.
    if (event.kind === 'analyze-run') {
      this._lastAnalyzeRunAt.update((at) => latest(at, event.timestamp));
    } else if (event.kind === 'curator-pass') {
      this._lastCuratorPassAt.update((at) => latest(at, event.timestamp));
    } else if (event.kind === 'ineligible') {
      const reason = event.stats?.['reason'];
      if (reason === 'prefilterTooThin' || reason === 'prefilterRejected') {
        this._eligibilityHistogram.update((h) => ({
          ...h,
          [reason]: h[reason] + 1,
        }));
      }
    }
  }

  private applySnapshot(snapshot: SkillDiagnosticsResult): void {
    this._lastAnalyzeRunAt.set(snapshot.lastAnalyzeRunAt ?? null);
    this._lastCuratorPassAt.set(snapshot.lastCuratorPassAt ?? null);
    // The backend already sends newest-first; normalising here keeps the
    // webview's order (and id uniqueness) independent of that contract.
    this._recentEvents.set(normalizeEvents(snapshot.recentEvents ?? []));
    this._eligibilityHistogram.set(
      snapshot.eligibilityHistogram ?? DEFAULT_HISTOGRAM,
    );
    this._triggers.set(snapshot.triggers ?? DEFAULT_TRIGGERS);
    this._byStatus.set({
      totalCandidates: snapshot.totalCandidates ?? 0,
      totalPromoted: snapshot.totalPromoted ?? 0,
      totalRejected: snapshot.totalRejected ?? 0,
      activeSkills: snapshot.activeSkills ?? 0,
      totalInvocations: snapshot.totalInvocations ?? 0,
      totalMerged: snapshot.totalMerged ?? 0,
      totalRetired: snapshot.totalRetired ?? 0,
      totalDormant: snapshot.totalDormant ?? 0,
    });
  }
}
