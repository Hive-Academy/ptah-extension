/**
 * Ollama Cloud usage reader.
 *
 * Reality check (verified live against ollama.com, 2026-10-13): Ollama Cloud
 * exposes no plan-limit / quota-percentage API for an API key. The only
 * authenticated usage endpoint, `GET /api/usage`, returns request-count
 * buckets over a fixed range (`24h`/`7d`/`30d`) with no allowance, limit or
 * reset — not a session/weekly percent-of-quota. `/api/me` returns the account
 * and plan tier but no limits either.
 *
 * So this reader cannot produce plan windows. What it does instead:
 *
 * - `200` with the request-count body — `available` with a `localUsage`
 *   request count (`requests`) over the reported range. It carries no
 *   percentage or reset, and the dashboard labels it as such.
 * - `200` with a malformed, unexpected or oversized body — the endpoint is
 *   there and the key authenticates, but its answer cannot be read: a service
 *   or schema failure, `service-unavailable`. A working key is never reported
 *   as rejected, and an unreadable answer is never reported as "no source".
 * - The count is the provider's account-wide figure, so its source is
 *   `provider-api`, not local CLI accounting.
 * - `401` / `403` — the key is genuinely rejected: `unsupported-auth`.
 * - `404` — the endpoint is gone: `no-usage-source`.
 * - anything else, a network error, or a timeout — `service-unavailable`.
 *
 * The bearer is only ever sent to the exact URL; a redirect is refused so the
 * header cannot leak to another host.
 */
import { z } from 'zod';
import type { PlanLocalUsage } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanUsageReading } from './plan-usage-reader.types';
import type { PlanUsageReader } from './plan-usage-reader.types';

export const OLLAMA_CLOUD_USAGE_URL = 'https://ollama.com/api/usage';
export const OLLAMA_CLOUD_USAGE_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 256 * 1024;

/** The fields of `/api/usage` this reader relies on; the rest is ignored. */
const UsageBodySchema = z.object({
  range: z.string().optional(),
  totals: z.object({ request_count: z.number().int().nonnegative() }),
});

/** Ollama's fixed range codes, spelled the way the dashboard shows ranges. */
const RANGE_LABELS: Readonly<Record<string, string>> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
};

type FetchLike = typeof fetch;

export function createOllamaCloudPlanUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  fetcher: FetchLike = fetch,
): PlanUsageReader {
  return async ({ credential, signal }) => {
    if (!credential) return reading('unsupported-config');
    if (signal?.aborted) return reading('service-unavailable');
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      OLLAMA_CLOUD_USAGE_TIMEOUT_MS,
    );
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetcher(OLLAMA_CLOUD_USAGE_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${credential.reveal()}` },
        // A redirect would carry the bearer header to another URL; fail instead.
        redirect: 'error',
        signal: controller.signal,
      });
      // A rejected credential is an authentication failure; never "no source".
      if (response.status === 401 || response.status === 403) {
        return reading('unsupported-auth');
      }
      // 404 (endpoint gone): the key is not the problem; there is no source.
      if (response.status === 404) return reading('no-usage-source');
      if (response.ok) {
        const usage = await requestCountUsage(response, now());
        if (!usage) {
          logger.warn('[PlanUsage] Ollama Cloud usage response unreadable', {
            providerId: 'ollama-cloud',
          });
          return reading('service-unavailable');
        }
        return {
          status: 'available',
          fetchedAt: usage.observedAt,
          windowSetEstablished: false,
          windows: [],
          localUsage: usage,
        };
      }
      return reading('service-unavailable');
    } catch (error: unknown) {
      logger.warn('[PlanUsage] Ollama Cloud usage request failed', {
        providerId: 'ollama-cloud',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return reading('service-unavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
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

/**
 * The request count `/api/usage` reports, as a usage stat. `undefined` when
 * the body is oversized, not JSON, or does not carry the expected totals.
 */
async function requestCountUsage(
  response: Response,
  observedAt: number,
): Promise<PlanLocalUsage | undefined> {
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // degradation-audit: reported - an unreadable 200 body; the caller
    // reports it as service-unavailable.
    return undefined;
  }
  const parsed = UsageBodySchema.safeParse(json);
  if (!parsed.success) return undefined;
  const range = parsed.data.range;
  return {
    kind: 'local-usage',
    label: 'Ollama Cloud requests',
    // Ollama meters requests, not tokens or cost; `requests` carries the figure.
    tokens: 0,
    estimatedCostUsd: 0,
    requests: parsed.data.totals.request_count,
    observedAt,
    source: 'provider-api',
    ...(range && { range: RANGE_LABELS[range] ?? range }),
  };
}
