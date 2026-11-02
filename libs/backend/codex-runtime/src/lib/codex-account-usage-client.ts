import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizeCodexHomeKey } from './codex-home-path';
import type { CodexExecutionProfile } from './codex-runtime.types';
import type { IDisposable } from '@ptah-extension/platform-core';
import type {
  CodexAppServerHandlers,
  CodexAppServerProcess,
} from './codex-app-server-process';
import type {
  CodexAccountUsageResult,
  CodexRateLimitBucket,
  CodexUsageEligibility,
} from './codex-account-usage.types';
import type { CodexHomeAuthReader } from './codex-home-auth-reader';
import {
  codexNotificationSchemas,
  type CodexNotificationMethod,
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

const fields = z.object({
  primary: z.unknown().optional(),
  secondary: z.unknown().optional(),
  planType: z.unknown().optional(),
  rateLimitReachedType: z.unknown().optional(),
  spendControlReached: z.unknown().optional(),
  individualLimit: z.unknown().optional(),
  credits: z.unknown().optional(),
});
const responseFields = z.object({
  rateLimits: z.unknown().optional(),
  rateLimitsByLimitId: z.unknown().optional(),
  rateLimitResetCredits: z.unknown().optional(),
  rateLimitUpsell: z.unknown().optional(),
});
const windowFields = z.object({
  usedPercent: z.unknown(),
  windowDurationMins: z.unknown().optional(),
  resetsAt: z.unknown().optional(),
});
const individualFields = z.object({
  limit: z.unknown(),
  used: z.unknown(),
  remainingPercent: z.unknown(),
  resetsAt: z.unknown(),
});
const creditsFields = z.object({
  balance: z.unknown().optional(),
  hasCredits: z.unknown(),
  unlimited: z.unknown(),
});
const code = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);
const decimal = z.string().regex(/^\d{1,18}(?:\.\d{1,6})?$/);
const finite = z.number().finite().nonnegative();
const instant = z.number().int().nonnegative();
const duration = z.number().int().nonnegative();

function window(value: unknown) {
  const parsed = windowFields.safeParse(value);
  if (!parsed.success) return undefined;
  const usedPercent = finite.safeParse(parsed.data.usedPercent);
  if (!usedPercent.success) return undefined;
  const windowDurationMins = parsed.data.windowDurationMins;
  const resetsAt = parsed.data.resetsAt;
  const validDuration = duration.safeParse(windowDurationMins);
  const validReset = instant.safeParse(resetsAt);
  return Object.freeze({
    usedPercent: usedPercent.data,
    ...(windowDurationMins === null
      ? { windowDurationMins: null }
      : validDuration.success
        ? { windowDurationMins: validDuration.data }
        : {}),
    ...(resetsAt === null
      ? { resetsAt: null }
      : validReset.success
        ? { resetsAt: validReset.data }
        : {}),
  });
}

function bucket(
  id: string,
  label: string,
  limits: unknown,
): CodexRateLimitBucket {
  const data = fields.safeParse(limits);
  const raw = data.success ? data.data : undefined;
  const primary = window(raw?.primary);
  const secondary = window(raw?.secondary);
  const reachedType = code.safeParse(raw?.rateLimitReachedType);
  const spendControlReached = z.boolean().safeParse(raw?.spendControlReached);
  const individual = individualFields.safeParse(raw?.individualLimit);
  const individualLimit = individual.success ? individual.data : undefined;
  const individualAmount = individualLimit &&
    decimal.safeParse(individualLimit.limit);
  const individualUsed = individualLimit && decimal.safeParse(individualLimit.used);
  const individualPercent = individualLimit &&
    finite.safeParse(individualLimit.remainingPercent);
  const individualReset = individualLimit &&
    instant.safeParse(individualLimit.resetsAt);
  const credits = creditsFields.safeParse(raw?.credits);
  const hasCredits = credits.success && z.boolean().safeParse(credits.data.hasCredits);
  const unlimited = credits.success && z.boolean().safeParse(credits.data.unlimited);
  const balance = credits.success ? decimal.safeParse(credits.data.balance) : undefined;
  return Object.freeze({
    id,
    label,
    ...(primary && { primary }),
    ...(secondary && { secondary }),
    ...(reachedType.success && {
      rateLimitReachedType: reachedType.data,
    }),
    ...(spendControlReached.success && {
      spendControlReached: spendControlReached.data,
    }),
    ...(individualAmount?.success && individualUsed?.success &&
      individualPercent?.success && individualReset?.success && {
        individualLimit: Object.freeze({
          limit: individualAmount.data,
          used: individualUsed.data,
          remainingPercent: individualPercent.data,
          resetsAt: individualReset.data,
        }),
      }),
    ...(hasCredits && unlimited && hasCredits.success && unlimited.success && {
      credits: Object.freeze({
        hasCredits: hasCredits.data,
        unlimited: unlimited.data,
        ...(!unlimited.data && balance?.success && { balance: balance.data }),
      }),
    }),
  });
}

/** No activity counters or native identifiers are inferred from quota information. */
export function usageResult(
  response: unknown,
  fetchedAt: number,
): CodexAccountUsageResult {
  const parsed = responseFields.safeParse(response);
  const data = parsed.success ? parsed.data : undefined;
  const nativeBuckets = z.record(z.string(), z.unknown()).safeParse(
    data?.rateLimitsByLimitId,
  );
  const byId = nativeBuckets.success ? nativeBuckets.data : undefined;
  const orderedIds = byId
    ? Object.keys(byId).sort((a, b) =>
        a === 'codex' ? -1 : b === 'codex' ? 1 : a < b ? -1 : a > b ? 1 : 0,
      )
    : [];
  const buckets = orderedIds.map((nativeId) => {
    const id = nativeId === 'codex'
      ? 'codex'
      : `bucket-${createHash('sha256')
          .update(nativeId)
          .digest('hex')
          .slice(0, 16)}`;
    // The hash is stable across bucket insertions and reveals no native ID.
    return bucket(
      id,
      id === 'codex' ? 'Codex' : `Limit ${id.slice(-6)}`,
      byId?.[nativeId],
    );
  }).filter((entry) => Object.keys(entry).length > 2);
  const defaultBucket = bucket('codex', 'Codex', data?.rateLimits);
  if (
    !buckets.some((entry) => entry.id === 'codex') &&
    Object.keys(defaultBucket).length > 2
  )
    buckets.unshift(defaultBucket);
  const active = buckets.find((entry) => entry.id === 'codex');
  const activeFields = fields.safeParse(byId?.['codex']);
  const fallbackFields = fields.safeParse(data?.rateLimits);
  const planType = code.safeParse(
    activeFields.success ? activeFields.data.planType : undefined,
  );
  const fallbackPlanType = code.safeParse(
    fallbackFields.success ? fallbackFields.data.planType : undefined,
  );
  const quotaPlan = planType.success
    ? planType.data
    : fallbackPlanType.success ? fallbackPlanType.data : undefined;
  const quota = {
    ...(active?.primary && { primary: active.primary }),
    ...(active?.secondary && { secondary: active.secondary }),
    ...(active?.rateLimitReachedType && {
      rateLimitReachedType: active.rateLimitReachedType,
    }),
  };
  return Object.freeze({
    status: 'available',
    providerId: PROVIDER,
    fetchedAt,
    ...(buckets.length > 0 && { buckets: Object.freeze(buckets) }),
    ...(z.record(z.string(), z.unknown()).safeParse(
      data?.rateLimitResetCredits,
    ).success && {
      resetCreditsAvailable: true,
    }),
    ...(data?.rateLimitUpsell != null && { upsellAvailable: true }),
    ...(quotaPlan
      ? { account: Object.freeze({ planType: quotaPlan }) }
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
