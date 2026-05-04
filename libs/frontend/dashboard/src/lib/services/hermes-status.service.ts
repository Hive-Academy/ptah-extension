import { Injectable, computed, inject, signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MemoryRpcService } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisRpcService } from '@ptah-extension/skill-synthesis-ui';
import { CronRpcService } from '@ptah-extension/cron-scheduler-ui';
import { GatewayRpcService } from '@ptah-extension/messaging-gateway-ui';
import type {
  GatewayPlatformId,
  GatewayStatusResult,
} from '@ptah-extension/shared';

/**
 * Per-platform gateway state surfaced by the Hermes status card.
 *
 * `state` is a coarse-grained badge value:
 * - `'running'`   — adapter is started and healthy
 * - `'enabled'`   — adapter has token but is not currently running
 * - `'error'`     — adapter reported `lastError`
 * - `'disabled'`  — gateway not enabled / no adapter row
 */
export type HermesGatewayBadge = 'running' | 'enabled' | 'error' | 'disabled';

export interface HermesGatewayPlatformSummary {
  readonly platform: GatewayPlatformId;
  readonly state: HermesGatewayBadge;
  readonly lastError?: string;
}

export interface HermesMemorySummary {
  readonly available: true;
  readonly totalFacts: number;
  /**
   * Approximate count of items still to be processed by the curator. We do
   * not yet have a dedicated "queue length" RPC — surface the recall-tier
   * count as a stand-in (it represents memories that have not yet been
   * promoted into core).
   */
  readonly queueLength: number;
}

export interface HermesSkillsSummary {
  readonly available: true;
  readonly pendingCandidates: number;
}

export type HermesCronSummary =
  | {
      readonly available: true;
      readonly totalJobs: number;
      readonly nextRunAt: number | null;
    }
  | { readonly available: false; readonly reason: 'desktop-only' | 'error' };

export type HermesGatewaySummary =
  | {
      readonly available: true;
      readonly platforms: readonly HermesGatewayPlatformSummary[];
      readonly pendingBindings: number;
    }
  | { readonly available: false; readonly reason: 'desktop-only' | 'error' };

export type HermesUnavailable<T extends string> = {
  readonly available: false;
  readonly reason: T;
};

export interface HermesStatusSummary {
  readonly memory: HermesMemorySummary | HermesUnavailable<'error'>;
  readonly skills: HermesSkillsSummary | HermesUnavailable<'error'>;
  readonly cron: HermesCronSummary;
  readonly gateway: HermesGatewaySummary;
  readonly isLoading: boolean;
  readonly lastUpdatedAt: number | null;
  readonly errors: Readonly<
    Record<'memory' | 'skills' | 'cron' | 'gateway', string | null>
  >;
}

const PLATFORMS: readonly GatewayPlatformId[] = [
  'telegram',
  'discord',
  'slack',
];

/**
 * Aggregates the four Hermes pillars into a single computed signal that
 * powers the dashboard's `HermesStatusCardComponent`.
 *
 * Refresh strategy: lazy. The card component calls {@link refresh} on first
 * render. Cron and gateway calls are gated by `vscodeService.config().isElectron`
 * — VS Code surfaces `'desktop-only'` placeholders for those rows.
 *
 * No polling — re-call `refresh()` on user interaction (e.g. window focus).
 */
@Injectable({ providedIn: 'root' })
export class HermesStatusService {
  private readonly vscode = inject(VSCodeService);
  private readonly memoryRpc = inject(MemoryRpcService);
  private readonly skillsRpc = inject(SkillSynthesisRpcService);
  private readonly cronRpc = inject(CronRpcService);
  private readonly gatewayRpc = inject(GatewayRpcService);

  private readonly _isLoading = signal<boolean>(false);
  private readonly _lastUpdatedAt = signal<number | null>(null);
  private readonly _hasLoadedOnce = signal<boolean>(false);

  private readonly _memory = signal<
    HermesMemorySummary | HermesUnavailable<'error'> | null
  >(null);
  private readonly _skills = signal<
    HermesSkillsSummary | HermesUnavailable<'error'> | null
  >(null);
  private readonly _cron = signal<HermesCronSummary | null>(null);
  private readonly _gateway = signal<HermesGatewaySummary | null>(null);

  private readonly _errors = signal<{
    memory: string | null;
    skills: string | null;
    cron: string | null;
    gateway: string | null;
  }>({ memory: null, skills: null, cron: null, gateway: null });

  /** Single computed summary signal consumed by the status card. */
  readonly summary = computed<HermesStatusSummary>(() => {
    const isElectron = this.vscode.config()?.isElectron === true;

    const cronFallback: HermesCronSummary = isElectron
      ? { available: false, reason: 'error' }
      : { available: false, reason: 'desktop-only' };
    const gatewayFallback: HermesGatewaySummary = isElectron
      ? { available: false, reason: 'error' }
      : { available: false, reason: 'desktop-only' };

    return {
      memory: this._memory() ?? { available: false, reason: 'error' },
      skills: this._skills() ?? { available: false, reason: 'error' },
      cron: this._cron() ?? cronFallback,
      gateway: this._gateway() ?? gatewayFallback,
      isLoading: this._isLoading(),
      lastUpdatedAt: this._lastUpdatedAt(),
      errors: this._errors(),
    };
  });

  readonly hasLoadedOnce = this._hasLoadedOnce.asReadonly();

  /**
   * Trigger a one-shot refresh of all four pillars in parallel.
   *
   * Failures on individual RPCs are isolated — one pillar failing does not
   * cancel the others. Each pillar's error message is surfaced via
   * {@link HermesStatusSummary.errors}.
   */
  async refresh(): Promise<void> {
    this._isLoading.set(true);

    const isElectron = this.vscode.config()?.isElectron === true;

    const memoryPromise = this.loadMemory();
    const skillsPromise = this.loadSkills();
    const cronPromise = isElectron
      ? this.loadCron()
      : Promise.resolve(this.markDesktopOnly('cron'));
    const gatewayPromise = isElectron
      ? this.loadGateway()
      : Promise.resolve(this.markDesktopOnly('gateway'));

    await Promise.all([
      memoryPromise,
      skillsPromise,
      cronPromise,
      gatewayPromise,
    ]);

    this._lastUpdatedAt.set(Date.now());
    this._hasLoadedOnce.set(true);
    this._isLoading.set(false);
  }

  /** Refresh once, only on the first call. Subsequent calls are no-ops. */
  async refreshIfNeeded(): Promise<void> {
    if (this._hasLoadedOnce()) return;
    await this.refresh();
  }

  private async loadMemory(): Promise<void> {
    try {
      const stats = await this.memoryRpc.stats();
      const totalFacts = stats.core + stats.recall + stats.archival;
      this._memory.set({
        available: true,
        totalFacts,
        queueLength: stats.recall,
      });
      this.clearError('memory');
    } catch (err) {
      this._memory.set({ available: false, reason: 'error' });
      this.setError('memory', err);
    }
  }

  private async loadSkills(): Promise<void> {
    try {
      const candidates = await this.skillsRpc.listCandidates({
        status: 'candidate',
      });
      this._skills.set({
        available: true,
        pendingCandidates: candidates.length,
      });
      this.clearError('skills');
    } catch (err) {
      this._skills.set({ available: false, reason: 'error' });
      this.setError('skills', err);
    }
  }

  private async loadCron(): Promise<void> {
    try {
      const result = await this.cronRpc.list({});
      const jobs = result.jobs ?? [];
      const nextRunAt = jobs
        .map((job) => job.nextRunAt)
        .filter((ts): ts is number => typeof ts === 'number')
        .reduce<number | null>(
          (min, ts) => (min === null || ts < min ? ts : min),
          null,
        );
      this._cron.set({ available: true, totalJobs: jobs.length, nextRunAt });
      this.clearError('cron');
    } catch (err) {
      this._cron.set({ available: false, reason: 'error' });
      this.setError('cron', err);
    }
  }

  private async loadGateway(): Promise<void> {
    try {
      const [statusResult, bindings] = await Promise.all([
        this.gatewayRpc.status(),
        this.gatewayRpc.listBindings({ status: 'pending' }),
      ]);

      const platforms = this.derivePlatformSummaries(statusResult);
      this._gateway.set({
        available: true,
        platforms,
        pendingBindings: bindings.bindings.length,
      });
      this.clearError('gateway');
    } catch (err) {
      this._gateway.set({ available: false, reason: 'error' });
      this.setError('gateway', err);
    }
  }

  private derivePlatformSummaries(
    status: GatewayStatusResult,
  ): readonly HermesGatewayPlatformSummary[] {
    const adaptersByPlatform = new Map(
      status.adapters.map((a) => [a.platform, a]),
    );

    return PLATFORMS.map((platform) => {
      const adapter = adaptersByPlatform.get(platform);
      if (!status.enabled || !adapter) {
        return { platform, state: 'disabled' as HermesGatewayBadge };
      }
      if (adapter.lastError) {
        return {
          platform,
          state: 'error' as HermesGatewayBadge,
          lastError: adapter.lastError,
        };
      }
      return {
        platform,
        state: adapter.running
          ? ('running' as HermesGatewayBadge)
          : ('enabled' as HermesGatewayBadge),
      };
    });
  }

  private markDesktopOnly(pillar: 'cron' | 'gateway'): void {
    const value: HermesUnavailable<'desktop-only'> = {
      available: false,
      reason: 'desktop-only',
    };
    if (pillar === 'cron') this._cron.set(value);
    else this._gateway.set(value);
    this.clearError(pillar);
  }

  private setError(
    pillar: 'memory' | 'skills' | 'cron' | 'gateway',
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    this._errors.update((current) => ({ ...current, [pillar]: message }));
  }

  private clearError(pillar: 'memory' | 'skills' | 'cron' | 'gateway'): void {
    this._errors.update((current) => ({ ...current, [pillar]: null }));
  }
}
