import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  AppStateManager,
  VSCodeService,
  type MessageHandler,
  type ThothActiveTabId,
} from '@ptah-extension/core';
import { formatCompact } from '../utils/format.utils';
import { MemoryRpcService } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisRpcService } from '@ptah-extension/skill-synthesis-ui';
import { CronRpcService } from '@ptah-extension/cron-scheduler-ui';
import { GatewayRpcService } from '@ptah-extension/messaging-gateway-ui';
import {
  MESSAGE_TYPES,
  type GatewayPlatformId,
  type GatewayStatusChangedPayload,
  type GatewayStatusResult,
} from '@ptah-extension/shared';

/**
 * Per-platform gateway state surfaced by the Thoth status card.
 *
 * `state` is a coarse-grained badge value:
 * - `'running'`   — adapter is started and healthy
 * - `'enabled'`   — adapter has token but is not currently running
 * - `'error'`     — adapter reported `lastError`
 * - `'disabled'`  — no adapter row for the platform
 */
export type ThothGatewayBadge = 'running' | 'enabled' | 'error' | 'disabled';

export interface ThothGatewayPlatformSummary {
  readonly platform: GatewayPlatformId;
  readonly state: ThothGatewayBadge;
  readonly lastError?: string;
}

export interface ThothMemorySummary {
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

export interface ThothSkillsSummary {
  readonly available: true;
  readonly pendingCandidates: number;
}

export type ThothCronSummary =
  | {
      readonly available: true;
      readonly totalJobs: number;
      readonly nextRunAt: number | null;
    }
  | { readonly available: false; readonly reason: 'desktop-only' | 'error' };

export type ThothGatewaySummary =
  | {
      readonly available: true;
      readonly platforms: readonly ThothGatewayPlatformSummary[];
      readonly pendingBindings: number;
    }
  | { readonly available: false; readonly reason: 'desktop-only' | 'error' };

export type ThothUnavailable<T extends string> = {
  readonly available: false;
  readonly reason: T;
};

export interface ThothStatusSummary {
  readonly memory: ThothMemorySummary | ThothUnavailable<'error'>;
  readonly skills: ThothSkillsSummary | ThothUnavailable<'error'>;
  readonly cron: ThothCronSummary;
  readonly gateway: ThothGatewaySummary;
  readonly isLoading: boolean;
  readonly lastUpdatedAt: number | null;
  readonly errors: Readonly<
    Record<'memory' | 'skills' | 'cron' | 'gateway', string | null>
  >;
}

/**
 * A single Thoth pillar reduced to display-ready fields. Derived from
 * {@link ThothStatusSummary} by {@link ThothStatusService.pillars} and consumed
 * by the Thoth shell sidebar tiles (memory / skills / cron / gateway).
 */
export interface ThothPillarStatus {
  readonly id: ThothActiveTabId;
  /** Tailwind text-colour class for the headline value (e.g. `text-primary`). */
  readonly accent: string;
  /** Headline metric, already compacted (e.g. `6.5K`, `0`, `—`). */
  readonly value: string;
  /** Short unit label rendered next to the value (e.g. `facts`, `pending`). */
  readonly unit: string;
  /** Secondary detail line (e.g. `no upcoming runs`, `Desktop only`). */
  readonly desc: string;
  readonly available: boolean;
  readonly platforms: readonly ThothGatewayPlatformSummary[];
  readonly error: string | null;
}

const PILLAR_ACCENTS: Readonly<Record<ThothActiveTabId, string>> = {
  memory: 'text-primary',
  skills: 'text-secondary',
  cron: 'text-info',
  gateway: 'text-accent',
};

const PLATFORMS: readonly GatewayPlatformId[] = [
  'telegram',
  'discord',
  'slack',
];

/**
 * Aggregates the four Thoth pillars into a single computed `summary` signal,
 * plus a `pillars` computed of display-ready tiles consumed by the Thoth shell
 * sidebar.
 *
 * Refresh strategy: lazy. The Thoth shell calls {@link refreshIfNeeded} on first
 * render, and a constructor effect re-runs {@link refresh} whenever the active
 * workspace root changes (Electron workspace switcher) so the memory tile
 * tracks the workspace-scoped counts. Cron and gateway calls are gated by
 * `vscodeService.config().isElectron` — VS Code surfaces `'desktop-only'`
 * placeholders for those rows.
 *
 * No polling — re-call `refresh()` on user interaction (e.g. window focus).
 */
@Injectable({ providedIn: 'root' })
export class ThothStatusService implements MessageHandler {
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly memoryRpc = inject(MemoryRpcService);
  private readonly skillsRpc = inject(SkillSynthesisRpcService);
  private readonly cronRpc = inject(CronRpcService);
  private readonly gatewayRpc = inject(GatewayRpcService);

  /**
   * Workspace root the effect below last observed. `undefined` means "no
   * emission seen yet" — the first observation only records the value so the
   * effect's initial run doesn't duplicate the shell's `refreshIfNeeded()`.
   */
  private lastWorkspaceRoot: string | null | undefined;

  public constructor() {
    effect(() => {
      const root = this.appState.workspaceInfo()?.path ?? null;
      const prev = this.lastWorkspaceRoot;
      this.lastWorkspaceRoot = root;
      if (prev === undefined || prev === root) return;
      untracked(() => void this.refresh());
    });
  }

  public readonly handledMessageTypes = [
    MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
  ] as const;

  private readonly _isLoading = signal<boolean>(false);
  private readonly _lastUpdatedAt = signal<number | null>(null);
  private readonly _hasLoadedOnce = signal<boolean>(false);

  private readonly _memory = signal<
    ThothMemorySummary | ThothUnavailable<'error'> | null
  >(null);
  private readonly _skills = signal<
    ThothSkillsSummary | ThothUnavailable<'error'> | null
  >(null);
  private readonly _cron = signal<ThothCronSummary | null>(null);
  private readonly _gateway = signal<ThothGatewaySummary | null>(null);

  private readonly _errors = signal<{
    memory: string | null;
    skills: string | null;
    cron: string | null;
    gateway: string | null;
  }>({ memory: null, skills: null, cron: null, gateway: null });

  /** Single computed summary signal consumed by the status card. */
  readonly summary = computed<ThothStatusSummary>(() => {
    const isElectron = this.vscode.config()?.isElectron === true;

    const cronFallback: ThothCronSummary = isElectron
      ? { available: false, reason: 'error' }
      : { available: false, reason: 'desktop-only' };
    const gatewayFallback: ThothGatewaySummary = isElectron
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

  /**
   * The summary reduced to per-pillar display tiles, keyed by pillar id.
   * Single source of truth for both the dashboard status surface and the
   * Thoth shell sidebar tiles — keep all value/unit/desc derivation here.
   */
  readonly pillars = computed<Record<ThothActiveTabId, ThothPillarStatus>>(() =>
    deriveThothPillars(this.summary()),
  );

  readonly hasLoadedOnce = this._hasLoadedOnce.asReadonly();

  /**
   * Trigger a one-shot refresh of all four pillars in parallel.
   *
   * Failures on individual RPCs are isolated — one pillar failing does not
   * cancel the others. Each pillar's error message is surfaced via
   * {@link ThothStatusSummary.errors}.
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

  public handleMessage(msg: { type: string; payload?: unknown }): void {
    const payload = msg.payload as GatewayStatusChangedPayload | undefined;
    if (!payload?.status) return;

    const platforms = this.derivePlatformSummaries(payload.status);
    const current = this._gateway();
    const pendingBindings =
      current?.available === true ? current.pendingBindings : 0;

    this._gateway.set({ available: true, platforms, pendingBindings });
    this.clearError('gateway');
  }

  private async loadMemory(): Promise<void> {
    try {
      // Scope to the active workspace so the sidebar tile matches the memory
      // tab's workspace-filtered stats; null falls back to global counts.
      const workspaceRoot = this.appState.workspaceInfo()?.path ?? null;
      const stats = await this.memoryRpc.stats(workspaceRoot);
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
      // Scope to the active workspace so the pillar counts this workspace's
      // schedules, matching the Schedules tab's default 'workspace' view.
      const workspaceRoot = this.appState.workspaceInfo()?.path;
      const result = await this.cronRpc.list(
        workspaceRoot ? { workspaceRoot } : {},
      );
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
  ): readonly ThothGatewayPlatformSummary[] {
    if (!Array.isArray(status?.adapters)) {
      return PLATFORMS.map((platform) => ({
        platform,
        state: 'disabled' as ThothGatewayBadge,
      }));
    }
    const adaptersByPlatform = new Map(
      status.adapters.map((a) => [a.platform, a]),
    );

    return PLATFORMS.map((platform) => {
      const adapter = adaptersByPlatform.get(platform);
      if (!adapter) {
        return { platform, state: 'disabled' as ThothGatewayBadge };
      }
      if (adapter.lastError) {
        return {
          platform,
          state: 'error' as ThothGatewayBadge,
          lastError: adapter.lastError,
        };
      }
      return {
        platform,
        state: adapter.running
          ? ('running' as ThothGatewayBadge)
          : ('enabled' as ThothGatewayBadge),
      };
    });
  }

  private markDesktopOnly(pillar: 'cron' | 'gateway'): void {
    const value: ThothUnavailable<'desktop-only'> = {
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

/**
 * Reduce a {@link ThothStatusSummary} to display-ready pillar tiles keyed by
 * pillar id. Pure and side-effect free — the single source of truth for the
 * Thoth shell sidebar tiles and any future status surface.
 */
export function deriveThothPillars(
  s: ThothStatusSummary,
): Record<ThothActiveTabId, ThothPillarStatus> {
  return {
    memory: deriveMemory(s),
    skills: deriveSkills(s),
    cron: deriveCron(s),
    gateway: deriveGateway(s),
  };
}

function pillarBase(
  id: ThothActiveTabId,
  s: ThothStatusSummary,
): Pick<ThothPillarStatus, 'id' | 'accent' | 'platforms' | 'error'> {
  return {
    id,
    accent: PILLAR_ACCENTS[id],
    platforms: [],
    error: s.errors[id],
  };
}

function deriveMemory(s: ThothStatusSummary): ThothPillarStatus {
  const base = pillarBase('memory', s);
  const m = s.memory;
  if (!m.available) {
    return {
      ...base,
      value: '—',
      unit: '',
      desc: 'Unavailable',
      available: false,
    };
  }
  return {
    ...base,
    value: formatCompact(m.totalFacts),
    unit: m.totalFacts === 1 ? 'fact' : 'facts',
    desc:
      m.queueLength > 0
        ? `${formatCompact(m.queueLength)} queued for curation`
        : 'All curated',
    available: true,
  };
}

function deriveSkills(s: ThothStatusSummary): ThothPillarStatus {
  const base = pillarBase('skills', s);
  const sk = s.skills;
  if (!sk.available) {
    return {
      ...base,
      value: '—',
      unit: '',
      desc: 'Unavailable',
      available: false,
    };
  }
  return {
    ...base,
    value: formatCompact(sk.pendingCandidates),
    unit: 'pending',
    desc:
      sk.pendingCandidates > 0
        ? `candidate${sk.pendingCandidates === 1 ? '' : 's'} to review`
        : 'No skills awaiting review',
    available: true,
  };
}

function deriveCron(s: ThothStatusSummary): ThothPillarStatus {
  const base = pillarBase('cron', s);
  const c = s.cron;
  if (!c.available) {
    return {
      ...base,
      value: '—',
      unit: '',
      desc: c.reason === 'desktop-only' ? 'Desktop only' : 'Unavailable',
      available: false,
    };
  }
  return {
    ...base,
    value: formatCompact(c.totalJobs),
    unit: c.totalJobs === 1 ? 'job' : 'jobs',
    desc:
      c.nextRunAt !== null
        ? `next run ${formatRelativeFuture(c.nextRunAt)}`
        : 'no upcoming runs',
    available: true,
  };
}

function deriveGateway(s: ThothStatusSummary): ThothPillarStatus {
  const base = pillarBase('gateway', s);
  const g = s.gateway;
  if (!g.available) {
    return {
      ...base,
      value: '—',
      unit: '',
      desc: g.reason === 'desktop-only' ? 'Desktop only' : 'Unavailable',
      available: false,
    };
  }
  const runningCount = g.platforms.filter((p) => p.state === 'running').length;
  return {
    ...base,
    value: formatCompact(runningCount),
    unit: 'running',
    desc:
      g.pendingBindings > 0
        ? `${formatCompact(g.pendingBindings)} pending approval`
        : 'no pending approvals',
    available: true,
    platforms: g.platforms,
  };
}

function formatRelativeFuture(timestamp: number): string {
  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return 'now';
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
