/** Ollama Cloud usage endpoint. */
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const OLLAMA_CLOUD_USAGE_URL = 'https://ollama.com/api/usage';
export const OLLAMA_CLOUD_USAGE_TIMEOUT_MS = 5_000;

const UsageLimitSchema = z.object({
  usage: z.number().nonnegative(),
  period: z
    .object({ until: z.string().optional(), ending_at: z.string().optional() })
    .optional(),
});

const UsageSchema = z.object({
  limits: z
    .object({
      session: UsageLimitSchema.optional(),
      weekly: UsageLimitSchema.optional(),
    })
    .refine((limits) => limits.session !== undefined || limits.weekly !== undefined),
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
        logger.warn('[PlanUsage] Ollama Cloud usage response rejected', {
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
        windows: windows(parsed.data.limits, observedAt),
      };
    } catch (error: unknown) {
      logger.warn('[PlanUsage] Ollama Cloud usage request failed', {
        providerId: 'ollama-cloud',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return unavailable('service-unavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}

function windows(
  limits: {
    session?: z.infer<typeof UsageLimitSchema>;
    weekly?: z.infer<typeof UsageLimitSchema>;
  },
  observedAt: number,
): PlanLimitWindow[] {
  return ([
    ['session', 'five_hour', 'Session'],
    ['weekly', 'weekly', 'Weekly'],
  ] as const).flatMap(([key, kind, label]) => {
    const value = limits[key];
    if (!value) return [];
    const reset = Date.parse(
      value.period?.until ?? value.period?.ending_at ?? '',
    );
    return [
      {
        key: kind,
        kind,
        label,
        used: {
          kind: 'percent' as const,
          percent: Math.min(
            100,
            value.usage <= 1 ? value.usage * 100 : value.usage,
          ),
        },
        usedSource: 'provider-api' as const,
        usedObservedAt: observedAt,
        ...(Number.isFinite(reset) && {
          resetsAt: reset,
          resetSource: 'provider-api' as const,
        }),
        observedAt,
      },
    ];
  });
}

function unavailable(
  status: 'unsupported-config' | 'unsupported-auth' | 'service-unavailable',
): PlanUsageReading {
  return { status, windowSetEstablished: false, windows: [] };
}
