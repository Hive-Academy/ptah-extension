import { createHash } from 'node:crypto';
import { normalizeCodexHomeKey } from './codex-home-path';
import type { CodexExecutionProfile } from './codex-runtime.types';
import type { IDisposable } from '@ptah-extension/platform-core';
import type {
  CodexAppServerHandlers,
  CodexAppServerProcess,
} from './codex-app-server-process';
import type {
  CodexAccountUsageResult,
  CodexUsageEligibility,
} from './codex-account-usage.types';
import type { CodexHomeAuthReader } from './codex-home-auth-reader';
import {
  codexNotificationSchemas,
  type CodexNotificationMethod,
  type CodexRequestResult,
} from './codex-protocol-validator';

const PROVIDER = 'openai-codex';
const CACHE_MS = 30_000;
const MISS_MS = 30_000;
const LIMITS_UPDATED =
  'account/rateLimits/updated' satisfies CodexNotificationMethod;

interface Flight {
  readonly refresh: boolean;
  readonly controller: AbortController;
  readonly promise: Promise<CodexAccountUsageResult>;
  waiters: number;
}

interface HomeState {
  generation: number;
  watcher?: IDisposable;
  cached?: CodexAccountUsageResult;
  ownerKey?: string;
  miss?: { readonly at: number; readonly result: CodexAccountUsageResult };
  flight?: Flight;
}

function unavailable(): CodexAccountUsageResult {
  return { status: 'service-unavailable', providerId: PROVIDER };
}

function abortError(): Error {
  const error = new Error('Codex usage read aborted');
  error.name = 'AbortError';
  return error;
}

function waitForEligibility(
  pending: Promise<CodexUsageEligibility>,
  signal: AbortSignal,
): Promise<CodexUsageEligibility> {
  return new Promise((resolveEligibility, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void pending
      .then(resolveEligibility, () =>
        reject(new Error('Codex usage eligibility unavailable')),
      )
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** No activity counters or identifiers are inferred from quota information. */
function usageResult(
  response: CodexRequestResult<'account/rateLimits/read'>,
  fetchedAt: number,
): CodexAccountUsageResult {
  const limits = response.rateLimitsByLimitId?.['codex'] ?? response.rateLimits;
  const quota = {
    ...(limits.primary
      ? { primary: Object.freeze({ ...limits.primary }) }
      : {}),
    ...(limits.secondary
      ? { secondary: Object.freeze({ ...limits.secondary }) }
      : {}),
    ...(limits.rateLimitReachedType != null
      ? { rateLimitReachedType: limits.rateLimitReachedType }
      : {}),
  };
  return Object.freeze({
    status: 'available',
    providerId: PROVIDER,
    fetchedAt,
    ...(limits.planType != null
      ? { account: Object.freeze({ planType: limits.planType }) }
      : {}),
    ...(Object.keys(quota).length > 0 ? { quota: Object.freeze(quota) } : {}),
  });
}

/**
 * Composition supplies a fresh usage-profile process for each normalized home.
 * The process owns pin verification, home verification and request timeouts.
 * Homes supplied by composition should already have filesystem aliases resolved,
 * as they are in the execution profile. Lexical aliases are normalized here.
 */
export class CodexAccountUsageClient {
  private readonly homes = new Map<string, HomeState>();
  private readonly active = new Set<Promise<CodexAccountUsageResult>>();
  private closed = false;

  /** Profile identity belongs at the usage boundary, not in host DI wiring. */
  static fromProfiles(
    auth: CodexHomeAuthReader,
    profileForHome: (home: string) => CodexExecutionProfile,
    createProcess: (
      profile: CodexExecutionProfile,
      handlers: CodexAppServerHandlers,
    ) => CodexAppServerProcess,
    now: () => number = Date.now,
  ): CodexAccountUsageClient {
    return new CodexAccountUsageClient(
      auth,
      (home, handlers) => {
        const profile = profileForHome(home);
        if (
          profile.consumer !== 'usage' ||
          normalizeCodexHomeKey(profile.normalizedHome, process.platform) !==
            home
        ) {
          throw new Error('Codex usage profile identity mismatch');
        }
        return createProcess({ ...profile, normalizedHome: home }, handlers);
      },
      now,
    );
  }

  constructor(
    private readonly auth: CodexHomeAuthReader,
    private readonly createProcess: (
      normalizedHome: string,
      handlers: CodexAppServerHandlers,
    ) => CodexAppServerProcess,
    private readonly now: () => number = Date.now,
  ) {}

  async read(
    home: string,
    options: { readonly refresh?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<CodexAccountUsageResult> {
    if (options.signal?.aborted) throw abortError();
    if (this.closed) return unavailable();
    let key: string;
    let state: HomeState;
    try {
      key = normalizeCodexHomeKey(home, process.platform);
      state = this.stateFor(key);
    } catch {
      return unavailable();
    }
    let flight = state.flight;
    if (flight && options.refresh && !flight.refresh) {
      await this.join(state, flight, options.signal);
      return this.read(key, options);
    }
    if (!flight) {
      const controller = new AbortController();
      const generation = state.generation;
      const promise = this.performRead(
        key,
        state,
        generation,
        !!options.refresh,
        controller.signal,
      ).then(
        (result) =>
          !this.closed &&
          !controller.signal.aborted &&
          state.generation === generation
            ? result
            : unavailable(),
        () => unavailable(),
      );
      flight = { controller, promise, waiters: 0, refresh: !!options.refresh };
      state.flight = flight;
      this.active.add(promise);
      const current = flight;
      void promise.finally(() => {
        this.active.delete(promise);
        if (state.flight === current) state.flight = undefined;
      });
    }
    return this.join(state, flight, options.signal);
  }

  clearCache(home: string): void {
    const state = this.homes.get(normalizeCodexHomeKey(home, process.platform));
    if (!state) return;
    state.generation++;
    state.cached = undefined;
    state.ownerKey = undefined;
    state.miss = undefined;
    const flight = state.flight;
    state.flight = undefined;
    flight?.controller.abort();
  }

  /** Opaque, per-home identity only. Raw server account identifiers never escape. */
  currentOwnerKey(home: string): string | null {
    return (
      this.homes.get(normalizeCodexHomeKey(home, process.platform))?.ownerKey ??
      null
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [home, state] of this.homes) {
      this.clearCache(home);
      state.watcher?.dispose();
    }
    this.homes.clear();
    await Promise.all(this.active);
  }

  private stateFor(home: string): HomeState {
    const existing = this.homes.get(home);
    if (existing) return existing;
    const state: HomeState = { generation: 0 };
    this.homes.set(home, state);
    try {
      state.watcher = this.auth.watch(home, (event) => {
        if (normalizeCodexHomeKey(event.home, process.platform) === home)
          this.clearCache(home);
      });
    } catch {
      this.homes.delete(home);
      throw new Error('Codex usage watcher unavailable');
    }
    return state;
  }

  private async performRead(
    home: string,
    state: HomeState,
    generation: number,
    refresh: boolean,
    signal: AbortSignal,
  ): Promise<CodexAccountUsageResult> {
    let child: CodexAppServerProcess | undefined;
    const current = () =>
      !this.closed && !signal.aborted && state.generation === generation;
    try {
      const eligibility = await waitForEligibility(
        this.auth.getUsageEligibility(home),
        signal,
      );
      if (!current()) return unavailable();
      if (eligibility !== 'supported') {
        state.cached = undefined;
        state.ownerKey = undefined;
        state.miss = undefined;
        return { status: eligibility, providerId: PROVIDER };
      }
      if (!refresh && state.miss && this.now() - state.miss.at < MISS_MS)
        return state.miss.result;
      if (
        !refresh &&
        state.cached?.fetchedAt !== undefined &&
        this.now() - state.cached.fetchedAt < CACHE_MS
      )
        return state.cached;

      child = this.createProcess(home, {
        onNotification: (frame) => {
          if (frame.method !== LIMITS_UPDATED || !current()) return;
          // Use the shared notification contract. The read response remains the
          // authoritative snapshot; an update makes the previous cache obsolete.
          if (
            !codexNotificationSchemas[LIMITS_UPDATED].safeParse(frame.params)
              .success
          )
            throw new Error('Invalid Codex usage notification');
          state.cached = undefined;
          state.miss = undefined;
        },
        onRequest: async () => {
          throw new Error('Unexpected Codex usage server request');
        },
      });
      await child.start(signal);
      if (
        !current() ||
        child.verifiedCodexHome === undefined ||
        normalizeCodexHomeKey(child.verifiedCodexHome, process.platform) !==
          home
      )
        return unavailable();
      const response = await child.request('account/rateLimits/read', {});
      // Complete process cleanup before publishing a result into the cache.
      await child.close();
      if (!current()) return unavailable();
      const owner =
        response.accountId == null
          ? undefined
          : `${PROVIDER}#account:${createHash('sha256').update(`${home}\0${response.accountId}`).digest('hex')}`;
      const result = usageResult(response, this.now());
      state.cached = result;
      state.ownerKey = owner;
      state.miss = undefined;
      return result;
    } catch {
      if (!current()) return unavailable();
      const result: CodexAccountUsageResult = state.cached
        ? Object.freeze({
            ...state.cached,
            status: 'stale',
            staleSince: this.now(),
          })
        : Object.freeze(unavailable());
      state.miss = { at: this.now(), result };
      return result;
    } finally {
      // Shared process close is idempotent and resolves after stdio has closed.
      await child?.close();
    }
  }

  private join(
    state: HomeState,
    flight: Flight,
    signal?: AbortSignal,
  ): Promise<CodexAccountUsageResult> {
    flight.waiters++;
    return new Promise((resolveResult, reject) => {
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        flight.waiters--;
        if (flight.waiters === 0) {
          if (state.flight === flight) state.flight = undefined;
          flight.controller.abort();
        }
        complete();
      };
      const onAbort = () => finish(() => reject(abortError()));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      void flight.promise.then(
        (value) => finish(() => resolveResult(value)),
        () => finish(() => resolveResult(unavailable())),
      );
    });
  }
}
