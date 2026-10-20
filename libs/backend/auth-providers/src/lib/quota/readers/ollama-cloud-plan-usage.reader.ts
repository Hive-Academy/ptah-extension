/**
 * Ollama Cloud usage reader.
 *
 * Two authenticated endpoints, read independently with the same Bearer key:
 *
 * - `GET /api/balance` â€” the plan-limit source (windows).
 * - `GET /api/usage?range=7d&group_by=model` â€” request counts and per-model
 *   detail, carried as secondary `localUsage`; never turned into a percentage.
 *
 * One endpoint failing never discards the other's valid data, and the cause is
 * exposed through `statusReason` on the `available` reading:
 *
 * - balance `401`/`403` with usage OK â€” `balance-auth-rejected`;
 * - balance other failure with usage OK â€” `balance-unavailable`;
 * - usage `401`/`403` with windows OK â€” `usage-auth-rejected`.
 *
 * With no data at all: `401`/`403` on either endpoint is `unsupported-auth`,
 * `404` on both is `no-usage-source`, anything else `service-unavailable`.
 *
 * Ollama allows 10 requests/min/user across both endpoints, so each endpoint's
 * outcome is cached per owner for at least 60 s (a `429` backs only that
 * endpoint off by `Retry-After`), and concurrent reads of one owner share one
 * in-flight request pair. An explicit refresh does not bypass either.
 *
 * The bearer is only ever sent to the exact URL; a redirect is refused so the
 * header cannot leak to another host.
 */
import type { PlanLimitStatusReason } from '@ptah-extension/shared';
import type { PlanLimitWindow, PlanLocalUsage } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';
import {
  balanceWindows,
  readJson,
  requestCountUsage,
} from './ollama-cloud-usage.parsers';

export const OLLAMA_CLOUD_BALANCE_URL = 'https://ollama.com/api/balance';
export const OLLAMA_CLOUD_USAGE_URL =
  'https://ollama.com/api/usage?range=7d&group_by=model';
export const OLLAMA_CLOUD_USAGE_TIMEOUT_MS = 5_000;
/** Ollama allows 10 requests/min/user; two are made per read. */
export const OLLAMA_CLOUD_CACHE_MS = 60_000;
const MAX_RETRY_AFTER_MS = 10 * 60_000;
const MAX_CACHED_OWNERS = 32;

type FetchLike = typeof fetch;
type FailureStatus =
  'no-usage-source' | 'service-unavailable' | 'unsupported-auth';
type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly status: FailureStatus;
      readonly retryAfterMs?: number;
    };

interface EndpointEntry<T> {
  readonly outcome: Outcome<T>;
  readonly expiresAt: number;
}

interface OwnerState {
  balance?: EndpointEntry<PlanLimitWindow[]>;
  usage?: EndpointEntry<PlanLocalUsage>;
  inflight?: Promise<PlanUsageReading>;
}

export function createOllamaCloudPlanUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  fetcher: FetchLike = fetch,
): PlanUsageReader {
  // Keyed by the hashed owner key; never by the credential.
  const owners = new Map<string, OwnerState>();

  async function load(
    state: OwnerState,
    key: string,
  ): Promise<PlanUsageReading> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      OLLAMA_CLOUD_USAGE_TIMEOUT_MS,
    );
    try {
      const at = now();
      const [balance, usage] = await Promise.all([
        state.balance && state.balance.expiresAt > at
          ? state.balance
          : fetchBody(
              fetcher,
              OLLAMA_CLOUD_BALANCE_URL,
              key,
              controller.signal,
              balanceWindows,
              now,
              logger,
            ).then((outcome) => entry(outcome, now)),
        state.usage && state.usage.expiresAt > at
          ? state.usage
          : fetchBody(
              fetcher,
              OLLAMA_CLOUD_USAGE_URL,
              key,
              controller.signal,
              requestCountUsage,
              now,
              logger,
            ).then((outcome) => entry(outcome, now)),
      ]);
      state.balance = balance;
      state.usage = usage;
      return combine(balance.outcome, usage.outcome, now());
    } finally {
      clearTimeout(timeout);
    }
  }

  return async ({ credential, signal, target }) => {
    if (!credential) return reading('unsupported-config');
    if (signal?.aborted) return reading('service-unavailable');
    const ownerKey = target.ownerRef.key;
    let state = owners.get(ownerKey);
    if (!state) {
      state = {};
      owners.set(ownerKey, state);
      while (owners.size > MAX_CACHED_OWNERS) {
        const oldest = owners.keys().next().value;
        if (oldest === undefined) break;
        owners.delete(oldest);
      }
    }
    const current = state;
    // Concurrent reads of one owner share the request pair (10 req/min limit).
    current.inflight ??= load(current, credential.reveal()).finally(() => {
      current.inflight = undefined;
    });
    const result = await current.inflight;
    // A cancelled caller learns nothing about the account.
    return signal?.aborted ? reading('service-unavailable') : result;
  };
}

/** A fresh outcome with its own cooldown: 60 s, or the endpoint's Retry-After. */
function entry<T>(outcome: Outcome<T>, now: () => number): EndpointEntry<T> {
  const retryAfter = outcome.ok ? 0 : (outcome.retryAfterMs ?? 0);
  return {
    outcome,
    expiresAt:
      now() +
      Math.min(Math.max(OLLAMA_CLOUD_CACHE_MS, retryAfter), MAX_RETRY_AFTER_MS),
  };
}

/**
 * One GET with the shared timeout/abort. Failure is data, never a throw, so
 * the other endpoint's outcome survives it.
 */
async function fetchBody<T>(
  fetcher: FetchLike,
  url: string,
  key: string,
  signal: AbortSignal,
  parse: (json: unknown, observedAt: number) => T | undefined,
  now: () => number,
  logger: Logger,
): Promise<Outcome<T>> {
  const endpoint = url.includes('/api/balance') ? 'balance' : 'usage';
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      // A redirect would carry the bearer header to another URL; fail instead.
      redirect: 'error',
      signal,
    });
    // A rejected credential is an authentication failure; never "no source".
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 'unsupported-auth' };
    }
    // 404 (endpoint gone): the key is not the problem; there is no source.
    if (response.status === 404)
      return { ok: false, status: 'no-usage-source' };
    if (response.status === 429) {
      return {
        ok: false,
        status: 'service-unavailable',
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
      };
    }
    if (!response.ok) return { ok: false, status: 'service-unavailable' };
    const json = await readJson(response);
    const value = json === undefined ? undefined : parse(json, now());
    if (value === undefined) {
      logger.warn('[PlanUsage] Ollama Cloud response unreadable', {
        providerId: 'ollama-cloud',
        endpoint,
      });
      return { ok: false, status: 'service-unavailable' };
    }
    return { ok: true, value };
  } catch (error: unknown) {
    logger.warn('[PlanUsage] Ollama Cloud request failed', {
      providerId: 'ollama-cloud',
      endpoint,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { ok: false, status: 'service-unavailable' };
  }
}

function combine(
  balance: Outcome<PlanLimitWindow[]>,
  usage: Outcome<PlanLocalUsage>,
  observedAt: number,
): PlanUsageReading {
  const windows = balance.ok ? balance.value : [];
  const localUsage = usage.ok ? usage.value : undefined;
  if (windows.length > 0 || localUsage) {
    const statusReason = availableReason(balance, usage);
    return {
      status: 'available',
      fetchedAt: observedAt,
      // Only a balance body that declared windows establishes the window set.
      windowSetEstablished: windows.length > 0,
      windows,
      ...(localUsage && { localUsage }),
      ...(statusReason && { statusReason }),
    };
  }
  const failures = [balance, usage].flatMap((outcome) =>
    outcome.ok ? [] : [outcome.status],
  );
  if (failures.includes('unsupported-auth')) return reading('unsupported-auth');
  if (failures.length === 2 && failures.every((s) => s === 'no-usage-source')) {
    return reading('no-usage-source');
  }
  // A readable balance with no limit and no counts: nothing to show.
  if (failures.length === 0) return reading('no-usage-source');
  return reading('service-unavailable');
}

/** Why an `available` reading is missing one endpoint's data, if it is. */
function availableReason(
  balance: Outcome<PlanLimitWindow[]>,
  usage: Outcome<PlanLocalUsage>,
): PlanLimitStatusReason | undefined {
  if (!balance.ok) {
    if (balance.status === 'unsupported-auth') return 'balance-auth-rejected';
    return balance.status === 'service-unavailable'
      ? 'balance-unavailable'
      : undefined;
  }
  return !usage.ok && usage.status === 'unsupported-auth'
    ? 'usage-auth-rejected'
    : undefined;
}

function reading(
  status:
    | 'no-usage-source'
    | 'service-unavailable'
    | 'unsupported-config'
    | 'unsupported-auth',
): PlanUsageReading {
  return { status, windowSetEstablished: false, windows: [] };
}

/** `Retry-After` in seconds (HTTP-date form is ignored); 0 when absent. */
function retryAfterMs(header: string | null): number {
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : 0;
}
