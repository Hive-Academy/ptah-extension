/**
 * PlanLimitsStore — the one webview source of plan-limit snapshots and the
 * shared clock the limit surfaces render against (TASK_2026_596, Component 13).
 *
 * Two inputs feed one signal:
 * - `load()` pulls `provider:getPlanLimits` (initial read, session change,
 *   explicit refresh). A generation guard drops a response that a newer
 *   `load()` superseded.
 * - `planLimits:changed` pushes a full snapshot after the host's ledger saw new
 *   evidence. A push replaces the snapshot outright; no re-read follows.
 *
 * A snapshot older than the one already held (by its `generatedAt`) is
 * ignored, so a slow pull cannot overwrite a newer push.
 *
 * Failure behaviour: a failed or malformed RPC result sets an EMPTY snapshot,
 * so every surface renders "Usage / Unavailable" — never a fabricated 0. A
 * malformed push is logged and ignored, keeping the last good snapshot.
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

@Injectable({ providedIn: 'root' })
export class PlanLimitsStore implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);

  readonly handledMessageTypes = [MESSAGE_TYPES.PLAN_LIMITS_CHANGED] as const;

  /** `null` until the first snapshot arrives; empty after a failed read. */
  private readonly _snapshot = signal<PlanLimitsSnapshot | null>(null);
  private readonly _loading = signal(false);
  private readonly _now = signal<number>(Date.now());

  readonly snapshot = this._snapshot.asReadonly();
  readonly loading = this._loading.asReadonly();
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
   * The view scope the host is asked about. Each `load()` replaces only the
   * fields it names, so the dashboard asking about its provider does not drop
   * the sessions the chat view asked about (both read this one snapshot, and
   * the host's push repeats the last request's scope).
   */
  private scope: Omit<ProviderGetPlanLimitsParams, 'refresh'> = {};

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

  async load(params: ProviderGetPlanLimitsParams = {}): Promise<void> {
    this.startClock();
    const { refresh, ...fields } = params;
    this.scope = { ...this.scope, ...definedFields(fields) };
    const generation = ++this.loadGeneration;
    this._loading.set(true);
    try {
      const request: ProviderGetPlanLimitsParams = refresh
        ? { ...this.scope, refresh: true }
        : { ...this.scope };
      const response = await this.rpc.call('provider:getPlanLimits', request);
      if (generation !== this.loadGeneration) return;
      if (response.isSuccess() && isPlanLimitsSnapshot(response.data)) {
        this.apply(response.data);
        return;
      }
      if (response.isSuccess()) {
        console.warn(
          '[PlanLimitsStore] provider:getPlanLimits returned a malformed snapshot; showing limits as unavailable',
        );
      }
      this.applyEmpty();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.warn(
        '[PlanLimitsStore] provider:getPlanLimits failed; showing limits as unavailable',
        error instanceof Error ? error.name : typeof error,
      );
      this.applyEmpty();
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

  private apply(next: PlanLimitsSnapshot): void {
    const current = this._snapshot();
    if (current && next.generatedAt < current.generatedAt) return;
    this._snapshot.set(next);
    this._now.set(Date.now());
  }

  /** Empty, never zero: surfaces render "Usage / Unavailable" from this. */
  private applyEmpty(): void {
    const now = Date.now();
    this._snapshot.set({ generatedAt: now, owners: [], sessionOwners: {} });
    this._now.set(now);
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

function definedFields(
  fields: Omit<ProviderGetPlanLimitsParams, 'refresh'>,
): Omit<ProviderGetPlanLimitsParams, 'refresh'> {
  const out: Omit<ProviderGetPlanLimitsParams, 'refresh'> = {};
  if (fields.providerId !== undefined) out.providerId = fields.providerId;
  if (fields.sessionIds !== undefined) out.sessionIds = [...fields.sessionIds];
  if (fields.ownerKeys !== undefined) out.ownerKeys = [...fields.ownerKeys];
  return out;
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
