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
// Services-only subpaths, NOT the wide barrels. This service is eager (it is a
// MESSAGE_HANDLERS entry, and the dashboard is a startup-reachable view via the
// `ptah.openDashboard` command), so importing the wide barrels here would drag
// all four Thoth tab libs into the initial bundle and defeat the @defer on
// ThothShellComponent. See TASK_2026_187 Unit 4.
import {
  MemoryDiagnosticsRpcService,
  MemoryRpcService,
} from '@ptah-extension/memory-curator-ui/services';
import { SkillSynthesisRpcService } from '@ptah-extension/skill-synthesis-ui/services';
import { CronRpcService } from '@ptah-extension/cron-scheduler-ui/services';
import { GatewayRpcService } from '@ptah-extension/messaging-gateway-ui/services';
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
  /**
   * The Memory / Skills master switches are paused (`memory.enabled` /
   * `skillSynthesis.enabled` is `false`). Desktop only; always `false` in
   * VS Code, where neither runs.
   */
  readonly paused: Readonly<Record<'memory' | 'skills', boolean>>;
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
  /** The pillar's master switch is paused; the shell shows a "Paused" badge. */
  readonly paused: boolean;
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
 * render and {@link refresh} on every tab switch, and a constructor effect
 * re-runs {@link refresh} whenever the active workspace root changes (Electron
 * workspace switcher) so the workspace-scoped tiles follow it. Overlapping
 * refreshes are ordered by a generation token: only the newest one writes.
 * Cron and gateway calls are gated by `vscodeService.config().isElectron` —
 * VS Code surfaces `'desktop-only'` placeholders for those rows.
 *
 * No polling — re-call `refresh()` on user interaction.
 */
@Injectable({ providedIn: 'root' })
export class ThothStatusService implements MessageHandler {
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly memoryRpc = inject(MemoryRpcService);
  private readonly memoryDiagnosticsRpc = inject(MemoryDiagnosticsRpcService);
  private readonly skillsRpc = inject(SkillSynthesisRpcService);
  private readonly cronRpc = inject(CronRpcService);
  private readonly gatewayRpc = inject(GatewayRpcService);

  /**
   * Workspace root the effect below last observed. `undefined` means "no
   * emission seen yet" — the first observation only records the value so the
   * effect's initial run doesn't duplicate the shell's `refreshIfNeeded()`.
   */
  private lastWorkspaceRoot: string | null | undefined;

  /** Generation of the newest {@link refresh}; older ones drop their results. */
  private refreshGeneration = 0;

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

  private readonly _paused = signal<{ memory: boolean; skills: boolean }>({
    memory: false,
    skills: false,
  });
  /** Newest {@link refreshPaused}; an older one drops its answer. */
  private pausedGeneration = 0;

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
      paused: this._paused(),
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
    // Refreshes overlap (a tab switch, then a workspace switch while the first
    // is still in flight). Each one claims a generation; a loader writes its
    // result only while its generation is still the newest, so a slow response
    // for the previous workspace cannot overwrite the newer one.
    const generation = ++this.refreshGeneration;
    const isCurrent = (): boolean => generation === this.refreshGeneration;

    this._isLoading.set(true);

    const isElectron = this.vscode.config()?.isElectron === true;

    const memoryPromise = this.loadMemory(isCurrent);
    const skillsPromise = this.loadSkills(isCurrent);
    // Pause badges are supplementary state. Do not let an unavailable or slow
    // pause RPC delay the primary status load: callers rely on hasLoadedOnce()
    // to avoid re-fetching a gateway push on a quick close/reopen.
    void this.refreshPaused();
    const cronPromise = isElectron
      ? this.loadCron(isCurrent)
      : Promise.resolve(this.markDesktopOnly('cron'));
    const gatewayPromise = isElectron
      ? this.loadGateway(isCurrent)
      : Promise.resolve(this.markDesktopOnly('gateway'));

    await Promise.all([
      memoryPromise,
      skillsPromise,
      cronPromise,
      gatewayPromise,
    ]);

    // A superseded refresh leaves the loading flag and timestamp to the newer
    // one, which is still running and will settle them itself.
    if (!isCurrent()) return;

    this._lastUpdatedAt.set(Date.now());
    this._hasLoadedOnce.set(true);
    this._isLoading.set(false);
  }

  /**
   * Refresh once, only on the first call. Subsequent calls are no-ops. Used for
   * the shell's first render; a tab switch calls {@link refresh} directly.
   */
  async refreshIfNeeded(): Promise<void> {
    if (this._hasLoadedOnce()) return;
    await this.refresh();
  }

  /**
   * Re-read only the two pause flags behind the sidebar "Paused" badges
   * (`memory:getTriggers` → `enabled`, `skillSynthesis:getSettings` →
   * `enabled`). Cheap enough for the shell to call on window focus and when a
   * tab reports that its switch flipped. A read that fails keeps the last
   * known flag rather than blinking the badge off.
   */
  async refreshPaused(): Promise<void> {
    const generation = ++this.pausedGeneration;
    if (this.vscode.config()?.isElectron !== true) {
      this._paused.set({ memory: false, skills: false });
      return;
    }
    const [memory, skills] = await Promise.allSettled([
      this.memoryDiagnosticsRpc.getTriggers(),
      this.skillsRpc.getSettings(),
    ]);
    if (generation !== this.pausedGeneration) return;
    this._paused.update((current) => ({
      memory:
        memory.status === 'fulfilled'
          ? memory.value.enabled === false
          : current.memory,
      skills:
        skills.status === 'fulfilled'
          ? skills.value.enabled === false
          : current.skills,
    }));
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

  private async loadMemory(isCurrent: () => boolean): Promise<void> {
    try {
      // Scope to the active workspace so the sidebar tile matches the memory
      // tab's workspace-filtered stats; null falls back to global counts.
      const workspaceRoot = this.appState.workspaceInfo()?.path ?? null;
      const stats = await this.memoryRpc.stats(workspaceRoot);
      if (!isCurrent()) return;
      const totalFacts = stats.core + stats.recall + stats.archival;
      this._memory.set({
        available: true,
        totalFacts,
        queueLength: stats.recall,
      });
      this.clearError('memory');
    } catch (err) {
      if (isCurrent()) {
        this._memory.set({ available: false, reason: 'error' });
        this.setError('memory', err);
      }
    }
  }

  private async loadSkills(isCurrent: () => boolean): Promise<void> {
    try {
      // Same query as the Skills tab's default list, so the tile and the list
      // agree. `scope: 'workspace'` is the backend's own active workspace (it
      // resolves the root itself; on a workspace switch the webview changes
      // `workspaceInfo` only after `workspace:switch` has moved it), PLUS
      // the rows whose origin was never recorded (`workspace_root IS NULL`):
      // the store keeps those visible in every workspace on purpose, so the
      // tile counts them too. `limit: 1000` is the handler's clamp ceiling;
      // a workspace with more than 1000 pending candidates reads as 1000.
      const candidates = await this.skillsRpc.listCandidates({
        status: 'candidate',
        scope: 'workspace',
        limit: 1000,
      });
      if (!isCurrent()) return;
      this._skills.set({
        available: true,
        pendingCandidates: candidates.length,
      });
      this.clearError('skills');
    } catch (err) {
      if (isCurrent()) {
        this._skills.set({ available: false, reason: 'error' });
        this.setError('skills', err);
      }
    }
  }

  private async loadCron(isCurrent: () => boolean): Promise<void> {
    try {
      // Scope to the active workspace so the pillar counts this workspace's
      // schedules, matching the Schedules tab's default 'workspace' view.
      const workspaceRoot = this.appState.workspaceInfo()?.path;
      const result = await this.cronRpc.list(
        workspaceRoot ? { workspaceRoot } : {},
      );
      if (!isCurrent()) return;
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
      if (isCurrent()) {
        this._cron.set({ available: false, reason: 'error' });
        this.setError('cron', err);
      }
    }
  }

  private async loadGateway(isCurrent: () => boolean): Promise<void> {
    try {
      const [statusResult, bindings] = await Promise.all([
        this.gatewayRpc.status(),
        this.gatewayRpc.listBindings({ status: 'pending' }),
      ]);
      if (!isCurrent()) return;

      const platforms = this.derivePlatformSummaries(statusResult);
      this._gateway.set({
        available: true,
        platforms,
        pendingBindings: bindings.bindings.length,
      });
      this.clearError('gateway');
    } catch (err) {
      if (isCurrent()) {
        this._gateway.set({ available: false, reason: 'error' });
        this.setError('gateway', err);
      }
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
): Pick<ThothPillarStatus, 'id' | 'accent' | 'platforms' | 'error' | 'paused'> {
  return {
    id,
    accent: PILLAR_ACCENTS[id],
    platforms: [],
    error: s.errors[id],
    paused: id === 'memory' || id === 'skills' ? s.paused[id] : false,
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
