/**
 * Ollama Cloud's undocumented usage endpoint. Its payload is provisional and
 * is intentionally rejected conservatively when it changes.
 */
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const OLLAMA_CLOUD_USAGE_URL = 'https://ollama.com/api/usage';
export const OLLAMA_CLOUD_USAGE_TIMEOUT_MS = 5_000;

const UsageSchema = z.object({
  session: z.object({
    percentage: z.number().min(0).max(100),
    resets_at: z.string().nullable().optional(),
  }),
  weekly: z.object({
    percentage: z.number().min(0).max(100),
    resets_at: z.string().nullable().optional(),
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
      const parsed = UsageSchema.safeParse(await response.json());
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
        windows: [
          window('session', 'Session', parsed.data.session, observedAt),
          window('weekly', 'Weekly', parsed.data.weekly, observedAt),
        ],
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
  key: 'session' | 'weekly',
  label: string,
  value: { percentage: number; resets_at?: string | null },
  observedAt: number,
): PlanLimitWindow {
  const reset = value.resets_at ? Date.parse(value.resets_at) : Number.NaN;
  return {
    key: key === 'session' ? 'other:ollama-session' : 'weekly',
    kind: key === 'session' ? 'other' : 'weekly',
    label,
    used: { kind: 'percent', percent: value.percentage },
    usedSource: 'provider-unofficial',
    usedObservedAt: observedAt,
    ...(Number.isFinite(reset) && {
      resetsAt: reset,
      resetSource: 'provider-unofficial',
    }),
    observedAt,
  };
}

function unavailable(
  status: 'unsupported-config' | 'unsupported-auth' | 'service-unavailable',
): PlanUsageReading {
  return { status, windowSetEstablished: false, windows: [] };
}
