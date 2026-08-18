import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService, type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  summarizeHarnessHealth,
  type HarnessHealth,
  type HarnessHealthChangedPayload,
  type HarnessHealthSummary,
  type HarnessTargetId,
} from '@ptah-extension/shared';

/**
 * Timeout budget for the two `harness:*` health calls.
 *
 * `health` is a cached read or one directory walk; `reconcile` copies files
 * across up to six targets and retries on Windows lock contention (E21), so it
 * gets a much longer leash than the 30s default.
 */
const HARNESS_RPC_TIMEOUTS = {
  HEALTH_MS: 15_000,
  RECONCILE_MS: 90_000,
} as const;

/** Zeroed summary for "we have not asked yet". Matches the shared reducer's own `null` case. */
const UNKNOWN_SUMMARY: HarnessHealthSummary = summarizeHarnessHealth(null);

/**
 * HarnessHealthStore — signal state for the Marketplace harness badge.
 *
 * Reads `harness:health`, writes `harness:reconcile`, and adopts the
 * `harness:healthChanged` push. It holds the last report and its summary; it
 * does NOT decide what "healthy" means — the summary is whatever the backend
 * sent, produced by the one shared reducer that also drives
 * `ptah harness doctor`'s exit code. When a payload arrives without a summary
 * (an older host), the store re-derives it with that same shared function
 * rather than inventing a local rule.
 *
 * `providedIn: 'root'` because the badge and the Plugins surface are siblings:
 * the badge renders the state, the surface refreshes it after a config save,
 * and both must see one report.
 *
 * ### Why the push matters
 *
 * Every other write here is user-initiated, so without it the badge is only
 * ever as fresh as the last time someone opened the Plugins page. The
 * reconciler runs a full pass at activation and a preflight on every session
 * start, and any of those can turn the harness amber while the user is looking
 * at some other surface. The store is registered in `MESSAGE_HANDLERS` at
 * bootstrap (see `src/services.ts`), so the badge is correct on first paint
 * even though `MarketplaceHubComponent` is lazy — the push that changed the
 * state may well have arrived before the surface was ever imported.
 *
 * Complexity Level: 2 — two RPC calls, one push, five signals, two derived
 * views. No container/presentational split: there is one consumer and no
 * branching UI logic to lift.
 */
@Injectable({ providedIn: 'root' })
export class HarnessHealthStore implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);

  private readonly _health = signal<HarnessHealth | null>(null);
  private readonly _summary = signal<HarnessHealthSummary>(UNKNOWN_SUMMARY);
  private readonly _loading = signal(false);
  private readonly _reconciling = signal(false);
  private readonly _error = signal<string | null>(null);

  /** Message types this store handles via `MessageRouterService`. */
  public readonly handledMessageTypes = [
    MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
  ] as const;

  /** Last report received, or `null` when no pass has run / no workspace is open. */
  public readonly health = this._health.asReadonly();
  /** Severity + flattened counts for {@link health}. Never null — `unknown` covers the empty case. */
  public readonly summary = this._summary.asReadonly();
  /** True while `harness:health` is in flight. */
  public readonly loading = this._loading.asReadonly();
  /** True while `harness:reconcile` is in flight. Separate so the badge does not flicker. */
  public readonly reconciling = this._reconciling.asReadonly();
  /** Last transport/handler error, cleared at the start of the next call. */
  public readonly error = this._error.asReadonly();

  /** Targets in the order the backend reported them; empty until the first report. */
  public readonly targets = computed(() => this._health()?.targets ?? []);

  /** True while either call is in flight — the panel disables its actions on this. */
  public readonly busy = computed(() => this._loading() || this._reconciling());

  /**
   * Fetch the current report.
   *
   * Defaults to the backend's cached report: the reconciler already ran a full
   * pass at activation, and re-walking every target each time the Plugins page
   * mounts would spend real filesystem work to redraw a badge that cannot have
   * changed. `{ refresh: true }` forces a fresh pass and is what the panel's
   * explicit refresh uses.
   */
  public async refresh(options?: { refresh?: boolean }): Promise<void> {
    if (this._loading()) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      const params =
        options?.refresh === true ? { refresh: true } : ({} as const);
      const result = await this.rpc.call('harness:health', params, {
        timeout: HARNESS_RPC_TIMEOUTS.HEALTH_MS,
      });
      if (result.isSuccess() && result.data) {
        this.applyReport(result.data.health, result.data.summary);
      } else {
        this._error.set(result.error ?? 'Failed to read harness health');
      }
    } catch (error: unknown) {
      this._error.set(messageOf(error, 'Failed to read harness health'));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Run a reconcile pass and adopt the report it returns.
   *
   * Always `mode: 'full'` — this is only reachable from a button labelled
   * "Reconcile now", and a preflight that only hash-checks would leave the user
   * staring at the same amber badge they just pressed a button to clear.
   *
   * The returned report IS the new state, so there is no follow-up
   * `harness:health` call. Re-reading would be a second filesystem walk that
   * can only agree with the answer already in hand.
   */
  public async reconcile(targets?: readonly HarnessTargetId[]): Promise<void> {
    if (this._reconciling()) {
      return;
    }
    this._reconciling.set(true);
    this._error.set(null);
    try {
      const params: { mode: 'full'; targets?: HarnessTargetId[] } = {
        mode: 'full',
      };
      if (targets !== undefined && targets.length > 0) {
        params.targets = [...targets];
      }
      const result = await this.rpc.call('harness:reconcile', params, {
        timeout: HARNESS_RPC_TIMEOUTS.RECONCILE_MS,
      });
      if (result.isSuccess() && result.data) {
        this.applyReport(result.data.health, result.data.summary);
      } else {
        this._error.set(result.error ?? 'Failed to reconcile the harness');
      }
    } catch (error: unknown) {
      this._error.set(messageOf(error, 'Failed to reconcile the harness'));
    } finally {
      this._reconciling.set(false);
    }
  }

  /**
   * Adopt a `harness:healthChanged` push.
   *
   * The backend edge-triggers this: it only broadcasts when the SUMMARY it
   * would render differs from the last one pushed, so anything arriving here is
   * newer than whatever the store is holding. It is therefore adopted
   * unconditionally, including while a call is in flight — an in-flight
   * `refresh` cannot return an older answer than the pass that just fired, and
   * a `reconcile` resolves with the very report this push carries.
   *
   * A push is not a call, so it touches neither `loading`/`reconciling` nor
   * `error`: a background pass succeeding is not a reason to clear the error
   * text from the button the user last pressed.
   *
   * The payload is narrowed rather than trusted. It crosses `postMessage` from
   * a host whose version is not pinned to this bundle's, and a malformed one
   * must leave the last good report standing rather than blank the badge.
   */
  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== MESSAGE_TYPES.HARNESS_HEALTH_CHANGED) {
      return;
    }
    const payload = message.payload as
      | Partial<HarnessHealthChangedPayload>
      | undefined;
    const health = payload?.health;
    if (!health || !Array.isArray(health.targets)) {
      return;
    }
    this.applyReport(health, payload?.summary);
  }

  /**
   * Adopt a report plus its summary.
   *
   * The summary is recomputed from the report when the payload omitted one, so
   * a host that predates the summary field still lights the badge correctly
   * instead of pinning it to `unknown`. Both paths run the SAME shared reducer,
   * so the two can never disagree.
   */
  private applyReport(
    health: HarnessHealth | null,
    summary: HarnessHealthSummary | undefined,
  ): void {
    this._health.set(health);
    this._summary.set(summary ?? summarizeHarnessHealth(health));
  }
}

/** Narrow an unknown throwable to a displayable message. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}
