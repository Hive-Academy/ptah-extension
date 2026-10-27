import {
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type { LoggingService, RpcResult } from '@ptah-extension/core';

/**
 * Load state of one vitals source. `empty` means the source answered but has
 * nothing to show (or does not apply on this host); `error` carries no detail
 * because the screens only render a fixed sentence.
 */
export type VitalsLoad<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'empty' }
  | { readonly status: 'error' };

/** How long a `ready` or `empty` answer is served before the next read refetches. */
export const VITALS_READY_TTL_MS = 60_000;
/**
 * A failed fetch is never served as an answer, but the next fetch waits this
 * long after the failure. Without the floor, an effect that reads the state
 * re-runs on `error`, reads again and retries at once: a hot loop against a
 * failing host.
 */
export const VITALS_ERROR_RETRY_MS = 5_000;
/** Timeout for every vitals RPC except the usage scan. */
export const VITALS_RPC_TIMEOUT_MS = 10_000;

export const VITALS_LOADING: VitalsLoad<never> = { status: 'loading' };
export const VITALS_EMPTY: VitalsLoad<never> = { status: 'empty' };
export const VITALS_ERROR: VitalsLoad<never> = { status: 'error' };

export function vitalsReady<T>(value: T): VitalsLoad<T> {
  return { status: 'ready', value };
}

function isSettledAnswer(load: VitalsLoad<unknown>): boolean {
  return load.status === 'ready' || load.status === 'empty';
}

/**
 * One cached source: a signal plus the bookkeeping that keeps at most one
 * fetch in flight.
 *
 * - A `ready` or `empty` answer is served for {@link VITALS_READY_TTL_MS}.
 * - The last good answer stays visible while it is refetched, and stays when
 *   the refetch fails: stale data beats an error. `error` is shown only when
 *   there has never been a good answer.
 * - After a failure the next read retries, no sooner than
 *   {@link VITALS_ERROR_RETRY_MS} after it.
 *
 * Fetches are bounded by their RPC timeout: `ClaudeRpcService.call` resolves
 * with a failed result when its timer fires, so `inFlight` always clears.
 *
 * `read()` runs untracked, so it is safe in an effect. It writes the signal
 * when it starts a fetch, so it must not run inside `computed()`.
 */
export class VitalsLoadCache<T> {
  private readonly state: WritableSignal<VitalsLoad<T>> = signal(VITALS_LOADING);
  private inFlight: Promise<void> | null = null;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;

  /** The cached state, without starting a fetch; `loading` until the first one settles. */
  readonly value: Signal<VitalsLoad<T>> = this.state.asReadonly();

  /** `fetch` must resolve with the settled state; a rejection becomes `error`. */
  constructor(private readonly fetch: () => Promise<VitalsLoad<T>>) {}

  /** The cached state; starts a fetch when nothing fresh is cached. */
  read(): Signal<VitalsLoad<T>> {
    untracked(() => {
      if (this.isDue()) void this.start();
    });
    return this.value;
  }

  /** Refetches regardless of age; joins a fetch already in flight. */
  refresh(): Promise<void> {
    return untracked(() => this.start());
  }

  private isDue(): boolean {
    if (this.inFlight !== null) return false;
    const now = Date.now();
    if (this.lastFailureAt !== null) {
      return now - this.lastFailureAt >= VITALS_ERROR_RETRY_MS;
    }
    return (
      this.lastSuccessAt === null ||
      now - this.lastSuccessAt >= VITALS_READY_TTL_MS
    );
  }

  private start(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    if (!isSettledAnswer(this.state())) this.state.set(VITALS_LOADING);
    const run = this.settle();
    this.inFlight = run;
    return run;
  }

  private async settle(): Promise<void> {
    let next: VitalsLoad<T>;
    try {
      next = await this.fetch();
    } catch {
      // degradation-audit: reported - each fetch logs its own failure before
      // it resolves; a rejection that escapes it still ends as `error`, which
      // the screen renders as a fixed sentence and a later read retries.
      next = VITALS_ERROR;
    }
    if (next.status === 'error') {
      this.lastFailureAt = Date.now();
      if (!isSettledAnswer(this.state())) this.state.set(VITALS_ERROR);
    } else {
      this.lastFailureAt = null;
      this.lastSuccessAt = Date.now();
      this.state.set(next);
    }
    this.inFlight = null;
  }
}

/** Where a vitals fetch logs, and what it calls the source in its messages. */
export interface VitalsRpcSource {
  readonly logger: Pick<LoggingService, 'error'>;
  readonly context: string;
  readonly label: string;
}

/**
 * Runs one vitals RPC and maps its answer. A failed call, a rejection, or an
 * answer `map` rejects (returns `null`) is logged and becomes `error`. Logs
 * carry only an error code or an error name, never paths or values.
 */
export async function settleVitalsRpc<R, T>(
  source: VitalsRpcSource,
  call: () => Promise<RpcResult<R>>,
  map: (data: R) => VitalsLoad<T> | null,
): Promise<VitalsLoad<T>> {
  const { logger, context, label } = source;
  try {
    const result = await call();
    if (!result.isSuccess()) {
      logger.error(context, `${label} RPC failed`, {
        errorCode: result.errorCode,
      });
      return VITALS_ERROR;
    }
    const mapped = map(result.data);
    if (mapped === null) {
      logger.error(context, `${label} result is invalid`);
      return VITALS_ERROR;
    }
    return mapped;
  } catch (error: unknown) {
    logger.error(context, `${label} RPC rejected`, {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return VITALS_ERROR;
  }
}
