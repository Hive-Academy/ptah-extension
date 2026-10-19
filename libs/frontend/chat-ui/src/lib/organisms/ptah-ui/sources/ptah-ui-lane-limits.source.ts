import {
  Injectable,
  Injector,
  effect,
  inject,
  signal,
  untracked,
  type EffectRef,
  type Signal,
} from '@angular/core';
import { ClaudeRpcService, PlanLimitsStore } from '@ptah-extension/core';
import type {
  PtahUiLimitRow,
  PtahUiLimitsInput,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

/** 15 s exceeds the slowest lane deadline, SLOW_LIMIT_LOOKUP_DEADLINE_MS (12 s). */
export const LANE_PLAN_LIMITS_TIMEOUT_MS = 15_000;

const PENDING: PtahUiLimitsInput = { kind: 'pending' };
const UNAVAILABLE: PtahUiLimitsInput = { kind: 'unavailable' };

const RESULT_KEYS = [
  'asOf',
  'atLimit',
  'lanes',
  'nearLimit',
  'rows',
  'unknown',
] as const;
const ROW_KEYS = ['lane', 'reset', 'state', 'used', 'window'] as const;
const COUNT_KEYS = ['lanes', 'atLimit', 'nearLimit', 'unknown'] as const;

type LanePlanLimitsResult = Omit<
  Extract<PtahUiLimitsInput, { kind: 'available' }>,
  'kind'
>;

/**
 * PtahUiLaneLimitsSource - the `$limits` live source adapter (TASK_2026_623,
 * component 4a, R10.1, R10.6, R10.7).
 *
 * Reference-counted: blocks that name `$limits` `acquire()` while live and
 * `release()` when they stop. Nothing is read without a holder (R10.1).
 *
 * - The first acquire of a burst (count 0 -> 1) reads `agent:getLanePlanLimits`
 *   once. Later acquires share that read and its signal.
 * - While the count is above 0, an effect on `PlanLimitsStore.snapshot()`
 *   re-reads once per change (R10.6). Reads are single-flight: a change during
 *   a read queues exactly one follow-up read.
 * - The response is checked by a structural guard (exact keys, string cells,
 *   finite non-negative counts) and copied field by field, so no owner,
 *   account or session field can pass through (R10.4).
 * - A failed, timed-out or malformed read sets `{kind:'unavailable'}` and logs
 *   a warning without the payload. The watcher stays armed, so the next
 *   snapshot change re-reads once and a successful read restores "available"
 *   (R10.6). Nothing re-reads on its own: without a change, no further call.
 * - When the count reaches 0 the effect is destroyed. No timers: reads happen
 *   only on an acquire burst or a snapshot change, and the only bound on a
 *   read is the RPC call's own timeout.
 *
 * Lazy: only the lazy `ptah-ui` block reaches this file.
 */
@Injectable({ providedIn: 'root' })
export class PtahUiLaneLimitsSource {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly planLimits = inject(PlanLimitsStore);
  private readonly injector = inject(Injector);

  private readonly state = signal<PtahUiLimitsInput>(PENDING);
  private readonly view = this.state.asReadonly();
  private holders = 0;
  private watcher: EffectRef | null = null;
  private inFlight = false;
  private rereadQueued = false;

  /** Takes one reference; the first of a burst starts the read. */
  acquire(): Signal<PtahUiLimitsInput> {
    this.holders += 1;
    if (this.holders === 1) this.startBurst();
    return this.view;
  }

  /** Drops one reference; the last one stops watching for changes. */
  release(): void {
    if (this.holders === 0) return;
    this.holders -= 1;
    if (this.holders > 0) return;
    this.watcher?.destroy();
    this.watcher = null;
  }

  private startBurst(): void {
    // A previous burst's rows stay on screen until this burst's read lands.
    if (untracked(this.state).kind !== 'available') this.state.set(PENDING);
    // A read still in flight from the previous burst serves this one.
    if (!this.inFlight) void this.read();
    let seen = untracked(this.planLimits.snapshot);
    this.watcher = effect(
      () => {
        const snapshot = this.planLimits.snapshot();
        if (snapshot === seen) return;
        seen = snapshot;
        untracked(() => this.reread());
      },
      { injector: this.injector },
    );
  }

  private reread(): void {
    if (this.holders === 0) return;
    if (this.inFlight) {
      this.rereadQueued = true;
      return;
    }
    void this.read();
  }

  private async read(): Promise<void> {
    this.inFlight = true;
    this.rereadQueued = false;
    const next = await this.fetch();
    this.inFlight = false;
    this.state.set(next);
    // A change that arrived during this read (failed or not) gets its one read.
    if (this.rereadQueued) this.reread();
  }

  private async fetch(): Promise<PtahUiLimitsInput> {
    try {
      const result = await this.rpc.call(
        'agent:getLanePlanLimits',
        {},
        { timeout: LANE_PLAN_LIMITS_TIMEOUT_MS },
      );
      if (!result.isSuccess()) {
        console.warn(
          '[PtahUiLaneLimitsSource] agent:getLanePlanLimits failed; $limits is unavailable',
        );
        return UNAVAILABLE;
      }
      if (!isLanePlanLimitsResult(result.data)) {
        console.warn(
          '[PtahUiLaneLimitsSource] ignored a malformed agent:getLanePlanLimits result; $limits is unavailable',
        );
        return UNAVAILABLE;
      }
      return toLimitsInput(result.data);
    } catch (error) {
      // degradation-audit: reported - logged with console.warn (error name
      // only, never the payload), and the source renders "unavailable".
      console.warn(
        '[PtahUiLaneLimitsSource] agent:getLanePlanLimits threw; $limits is unavailable',
        error instanceof Error ? error.name : typeof error,
      );
      return UNAVAILABLE;
    }
  }
}

/** A fresh copy with only the allow-listed fields. */
function toLimitsInput(result: LanePlanLimitsResult): PtahUiLimitsInput {
  return {
    kind: 'available',
    rows: result.rows.map((row): PtahUiLimitRow => ({
      lane: row.lane,
      window: row.window,
      used: row.used,
      state: row.state,
      reset: row.reset,
    })),
    lanes: result.lanes,
    atLimit: result.atLimit,
    nearLimit: result.nearLimit,
    unknown: result.unknown,
    asOf: result.asOf,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  );
  return own.length === keys.length && own.every((key, i) => key === keys[i]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLimitRow(value: unknown): value is PtahUiLimitRow {
  return (
    isRecord(value) &&
    hasExactKeys(value, ROW_KEYS) &&
    ROW_KEYS.every((key) => typeof value[key] === 'string')
  );
}

/**
 * The webview-side R10.4 guard: exactly the six result keys and the five row
 * cells. An extra key (an owner, account or session field) rejects the whole
 * result rather than being dropped silently.
 */
function isLanePlanLimitsResult(value: unknown): value is LanePlanLimitsResult {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) return false;
  const rows = value['rows'];
  return (
    Array.isArray(rows) &&
    rows.every(isLimitRow) &&
    COUNT_KEYS.every((key) => {
      const count = value[key];
      return isFiniteNumber(count) && count >= 0;
    }) &&
    isFiniteNumber(value['asOf'])
  );
}
