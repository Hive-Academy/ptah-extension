/** Ollama Cloud's documented included-credit balance endpoint. */
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const OLLAMA_CLOUD_USAGE_URL = 'https://ollama.com/api/balance';
export const OLLAMA_CLOUD_USAGE_TIMEOUT_MS = 5_000;

const BalanceSchema = z.object({
  included: z.object({
    balance_usd: z.number().nonnegative(),
    allowance_usd: z.number().positive(),
    period: z.object({ until: z.string() }),
  }),
});

type FetchLike = typeof fetch;

export function createOllamaCloudPlanUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  fetcher: FetchLike = fetch,
): PlanUsageReader {
  return async ({ credential, signal }) => {
    if (!credential) return unavailable('unsupported-config');
    if (signal?.aborted) return unavailable('service-unavailable');
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
      // A rejected key is an auth state, not a transient failure to retry.
      if (response.status === 401 || response.status === 403) {
        return unavailable('unsupported-auth');
      }
      if (!response.ok) return unavailable('service-unavailable');
      const parsed = BalanceSchema.safeParse(await response.json());
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        logger.warn('[PlanUsage] provisional usage response rejected', {
          providerId: 'ollama-cloud',
          fieldPath: issue?.path.map(String).join('.') ?? '',
          reason: issue?.code ?? 'invalid',
        });
        return unavailable('service-unavailable');
      }
      const observedAt = now();
      return {
        status: 'available',
        fetchedAt: observedAt,
        windowSetEstablished: true,
        windows: [window(parsed.data.included, observedAt)],
      };
    } catch {
      return unavailable('service-unavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}

function window(
  value: {
    balance_usd: number;
    allowance_usd: number;
    period: { until: string };
  },
  observedAt: number,
): PlanLimitWindow {
  const reset = Date.parse(value.period.until);
  const percent = Math.min(
    100,
    Math.max(
      0,
      ((value.allowance_usd - value.balance_usd) / value.allowance_usd) * 100,
    ),
  );
  return {
    key: 'monthly',
    kind: 'monthly',
    label: 'Included credits',
    used: { kind: 'percent', percent },
    usedSource: 'provider-api',
    usedObservedAt: observedAt,
    ...(Number.isFinite(reset) && {
      resetsAt: reset,
      resetSource: 'provider-api',
    }),
    observedAt,
  };
}

function unavailable(
  status: 'unsupported-config' | 'unsupported-auth' | 'service-unavailable',
): PlanUsageReading {
  return { status, windowSetEstablished: false, windows: [] };
}
