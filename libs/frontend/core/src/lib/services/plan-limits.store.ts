/**
 * PlanLimitsStore — the one webview source of plan-limit snapshots and the
 * shared clock the limit surfaces render against (TASK_2026_596, Component 13).
 *
 * Two inputs feed one signal:
 * - `load()` pulls `provider:getPlanLimits` (initial read, session change,
 *   explicit refresh). A generation guard drops a response that a newer
 *   `load()` superseded. Each chat surface registers its own scope
 *   (`registerScope`), and every load asks for the union of all live scopes
 *   plus the latest provider, so grid panes never erase each other's sessions.
 * - `planLimits:changed` pushes a full snapshot after the host's ledger saw new
 *   evidence. A push replaces the snapshot outright; no re-read follows.
 *
 * A snapshot older than the one already held (by its `generatedAt`) is
 * ignored, so a slow pull cannot overwrite a newer push.
 *
 * Failure behaviour: a failed or malformed RPC result sets `loadError()` and
 * keeps the last valid snapshot. Only when no snapshot is held does it
 * install an EMPTY one, so surfaces render "Usage / Unavailable" and never a
 * fabricated 0. That placeholder is stamped `generatedAt: 0`, never the browser
 * clock, so it cannot outrank host evidence. A failed pull therefore cannot
 * erase a newer pushed snapshot. A malformed push is logged and ignored, and
 * the last good snapshot stays.
 *
 * Runtime cost: ONE 30 s interval drives `now()` for every limit surface. It
 * starts on the first `load()` and is released through `DestroyRef`. Surfaces
 * must not start their own timers.
 */

import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MESSAGE_TYPES,
  type PlanLimitOwnerSnapshot,
  type PlanLimitSessionOwner,
  type PlanLimitsSnapshot,
  type ProviderGetPlanLimitsParams,
} from '@ptah-extension/shared';

import { ClaudeRpcService } from './claude-rpc.service';
import type { MessageHandler } from './message-router.types';

/** Period of the shared `now()` clock. */
export const PLAN_LIMITS_CLOCK_TICK_MS = 30_000;

/** The sessions and run owners one surface shows. */
export interface PlanLimitsSurfaceScope {
  readonly sessionIds: readonly string[];
  readonly ownerKeys: readonly string[];
}

/** One surface's registration in the shared request scope. */
export interface PlanLimitsScopeHandle {
  /** Stable for the surface's lifetime. */
  readonly id: number;
  /** Replaces this surface's scope and loads the union. No-op once released. */
  update(scope: PlanLimitsSurfaceScope): Promise<void>;
  /** Drops this surface's scope; also runs on its `DestroyRef`. */
  release(): void;
}

/** Load options; sessions and owners come only from registered scopes. */
export type PlanLimitsLoadParams = Pick<
  ProviderGetPlanLimitsParams,
  'providerId' | 'refresh'
>;

@Injectable({ providedIn: 'root' })
export class PlanLimitsStore implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);

  readonly handledMessageTypes = [MESSAGE_TYPES.PLAN_LIMITS_CHANGED] as const;

  /**
   * `null` until the first snapshot arrives; empty when the first read failed;
   * otherwise the last valid snapshot (a later failed read keeps it).
   */
  private readonly _snapshot = signal<PlanLimitsSnapshot | null>(null);
  private readonly _loading = signal(false);
  private readonly _loadError = signal(false);
  private readonly _now = signal<number>(Date.now());

  readonly snapshot = this._snapshot.asReadonly();
  readonly loading = this._loading.asReadonly();
  /**
   * `true` when the newest pull failed or was malformed. Cleared by a valid
   * pull or push.
   */
  readonly loadError = this._loadError.asReadonly();
  /** Shared wall clock for "resets in …" text; ticks every 30 s once loaded. */
  readonly now = this._now.asReadonly();

  private readonly ownersByKey = computed(() => {
    const map = new Map<string, PlanLimitOwnerSnapshot>();
    for (const owner of this._snapshot()?.owners ?? []) {
      map.set(owner.owner.key, owner);
    }
    return map;
  });

  private loadGeneration = 0;
  private clockHandle: ReturnType<typeof setInterval> | null = null;
  /**
   * Session and run-owner scope of every live surface, by handle id. Every
   * load sends the UNION, because all surfaces read this one snapshot and the
   * host's push repeats only the last request's scope: with one shared field,
   * a second grid pane (or a pane with no session) erased the first's.
   */
  private readonly surfaceScopes = new Map<number, PlanLimitsSurfaceScope>();
  private nextScopeId = 0;
  /** Latest provider any caller named; kept by loads that omit it. */
  private providerId: string | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopClock());
  }

  /** Owner snapshot by opaque owner key; `null` when the host listed none. */
  ownerByKey(key: string): PlanLimitOwnerSnapshot | null {
    return this.ownersByKey().get(key) ?? null;
  }

  /** Owner and model scope of one chat session; `null` when not reported. */
  sessionOwner(sessionId: string): PlanLimitSessionOwner | null {
    const owners = this._snapshot()?.sessionOwners;
    if (!owners || !Object.prototype.hasOwnProperty.call(owners, sessionId)) {
      return null;
    }
    return owners[sessionId];
  }

  /**
   * Registers one surface's scope. The surface names its sessions and run
   * owners through `update()` (which loads); the scope leaves the union on
   * `release()` or when `destroyRef` is destroyed. Release does not reload:
   * the next load from any surface sends the smaller union.
   */
  registerScope(destroyRef: DestroyRef): PlanLimitsScopeHandle {
    const id = ++this.nextScopeId;
    this.surfaceScopes.set(id, { sessionIds: [], ownerKeys: [] });
    const release = () => {
      this.surfaceScopes.delete(id);
    };
    destroyRef.onDestroy(release);
    return {
      id,
      update: (scope) => {
        if (!this.surfaceScopes.has(id)) return Promise.resolve();
        this.surfaceScopes.set(id, {
          sessionIds: [...scope.sessionIds],
          ownerKeys: [...scope.ownerKeys],
        });
        return this.load();
      },
      release,
    };
  }

  /**
   * Reads a snapshot for the union of registered surface scopes. `providerId`
   * replaces the remembered provider; omitting it keeps the last one.
   */
  async load(params: PlanLimitsLoadParams = {}): Promise<void> {
    this.startClock();
    if (params.providerId !== undefined) this.providerId = params.providerId;
    const generation = ++this.loadGeneration;
    this._loading.set(true);
    try {
      const request = this.request(params.refresh === true);
      const response = await this.rpc.call('provider:getPlanLimits', request);
      if (generation !== this.loadGeneration) return;
      if (response.isSuccess() && isPlanLimitsSnapshot(response.data)) {
        this.apply(response.data);
        return;
      }
      if (response.isSuccess()) {
        console.warn(
          '[PlanLimitsStore] provider:getPlanLimits returned a malformed snapshot; keeping the last snapshot',
        );
      }
      this.applyLoadFailure();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.warn(
        '[PlanLimitsStore] provider:getPlanLimits failed; keeping the last snapshot',
        error instanceof Error ? error.name : typeof error,
      );
      this.applyLoadFailure();
    } finally {
      if (generation === this.loadGeneration) this._loading.set(false);
    }
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== MESSAGE_TYPES.PLAN_LIMITS_CHANGED) return;
    if (!isPlanLimitsSnapshot(message.payload)) {
      console.warn(
        '[PlanLimitsStore] ignored a malformed planLimits:changed payload',
      );
      return;
    }
    this.apply(message.payload);
  }

  /**
   * The request scope: the remembered provider plus the union of surface
   * scopes. With no surface registered, sessions and owners are omitted (the
   * dashboard alone names only its provider).
   */
  private request(refresh: boolean): ProviderGetPlanLimitsParams {
    const request: ProviderGetPlanLimitsParams = {};
    if (this.providerId !== undefined) request.providerId = this.providerId;
    if (this.surfaceScopes.size > 0) {
      const sessionIds = new Set<string>();
      const ownerKeys = new Set<string>();
      for (const scope of this.surfaceScopes.values()) {
        scope.sessionIds.forEach((id) => sessionIds.add(id));
        scope.ownerKeys.forEach((key) => ownerKeys.add(key));
      }
      request.sessionIds = [...sessionIds];
      request.ownerKeys = [...ownerKeys];
    }
    if (refresh) request.refresh = true;
    return request;
  }

  /** A valid host snapshot (pull or push); older than the held one is ignored. */
  private apply(next: PlanLimitsSnapshot): void {
    this._loadError.set(false);
    const current = this._snapshot();
    if (current && next.generatedAt < current.generatedAt) return;
    this._snapshot.set(next);
    this._now.set(Date.now());
  }

  /**
   * A failed or malformed pull. Keeps any snapshot already held, including a
   * newer push. With none held, installs an empty placeholder, which is never
   * zero (surfaces render "Usage / Unavailable" from it). The placeholder's
   * `generatedAt` is 0, never the browser clock, so any host snapshot outranks it.
   */
  private applyLoadFailure(): void {
    this._loadError.set(true);
    if (this._snapshot() === null) {
      this._snapshot.set({ generatedAt: 0, owners: [], sessionOwners: {} });
    }
    this._now.set(Date.now());
  }

  private startClock(): void {
    if (this.clockHandle !== null) return;
    this.clockHandle = setInterval(
      () => this._now.set(Date.now()),
      PLAN_LIMITS_CLOCK_TICK_MS,
    );
  }

  private stopClock(): void {
    if (this.clockHandle === null) return;
    clearInterval(this.clockHandle);
    this.clockHandle = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isOwnerRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['key'] === 'string' &&
    typeof value['providerId'] === 'string' &&
    typeof value['identityKind'] === 'string' &&
    typeof value['label'] === 'string'
  );
}

function isWindow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['key'] === 'string' &&
    typeof value['kind'] === 'string' &&
    typeof value['label'] === 'string' &&
    isFiniteNumber(value['observedAt'])
  );
}

function isOwnerSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOwnerRef(value['owner']) &&
    typeof value['status'] === 'string' &&
    typeof value['windowSetEstablished'] === 'boolean' &&
    Array.isArray(value['windows']) &&
    value['windows'].every(isWindow) &&
    Array.isArray(value['ownerEvidence']) &&
    value['ownerEvidence'].every(
      (evidence) => isRecord(evidence) && isFiniteNumber(evidence['observedAt']),
    )
  );
}

function isSessionOwner(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringOrNull(value['ownerKey']) &&
    isStringOrNull(value['modelScope'])
  );
}

/**
 * Structural check of a host snapshot (no zod in frontend libs). Checks every
 * field a surface reads to choose a state; optional fields are left to the
 * view model, which already treats an absent value as unknown.
 */
function isPlanLimitsSnapshot(
  value: unknown,
): value is PlanLimitsSnapshot {
  return (
    isRecord(value) &&
    isFiniteNumber(value['generatedAt']) &&
    Array.isArray(value['owners']) &&
    value['owners'].every(isOwnerSnapshot) &&
    isRecord(value['sessionOwners']) &&
    Object.values(value['sessionOwners']).every(isSessionOwner)
  );
}
