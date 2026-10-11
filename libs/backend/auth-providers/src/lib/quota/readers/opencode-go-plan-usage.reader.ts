/** OpenCode Go subscription quota, separate from local `opencode stats`. */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import { readOpenCodeGoKey } from '../opencode-go-credential';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const WindowSchema = z.object({
  percent: z.number().finite(),
  resetsAt: z.string().datetime({ offset: true }),
});
const UsageSchema = z.object({
  usage: z.object({
    rolling: WindowSchema,
    weekly: WindowSchema,
    monthly: WindowSchema,
  }),
});
const noPlan = (): PlanUsageReading => ({
  status: 'no-usage-source',
  windowSetEstablished: false,
  windows: [],
});
const unavailable = (): PlanUsageReading => ({
  status: 'service-unavailable',
  windowSetEstablished: false,
  windows: [],
});

export function createOpenCodeGoPlanUsageReader(
  now: () => number = Date.now,
  fetcher: typeof fetch = fetch,
  readAuth: typeof readFile = readFile,
  env: NodeJS.ProcessEnv = process.env,
): PlanUsageReader {
  return async ({ signal, target, credential }) => {
    if (signal?.aborted) return unavailable();
    let key: string | undefined;
    if (target.ownerRef.identityKind === 'credential') {
      key = credential?.reveal().trim();
      if (!key)
        return {
          status: 'unsupported-config',
          windowSetEstablished: false,
          windows: [],
        };
    } else if (target.ownerRef.identityKind === 'cli-store') {
      try {
        key = await readOpenCodeGoKey(env, readAuth);
      } catch {
        return unavailable();
      }
    } else return noPlan();
    if (!key) return noPlan();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetcher(OPENCODE_GO_USAGE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 403) return noPlan();
      if (!response.ok) return unavailable();
      const parsed = UsageSchema.safeParse(await response.json());
      if (!parsed.success) return unavailable();
      const observedAt = now();
      const windows: PlanLimitWindow[] = (
        [
          ['rolling', 'five_hour', 'Go · 5-hour', 300],
          ['weekly', 'weekly', 'Go · Weekly', 10080],
          ['monthly', 'monthly', 'Go · Monthly', undefined],
        ] as const
      ).map(([source, kind, label, durationMins]) => ({
        key: kind,
        kind,
        label,
        ...(durationMins && { durationMins }),
        used: {
          kind: 'percent',
          percent: Math.max(
            0,
            Math.min(100, parsed.data.usage[source].percent),
          ),
        },
        usedSource: 'provider-api',
        usedObservedAt: observedAt,
        resetsAt: Date.parse(parsed.data.usage[source].resetsAt),
        resetSource: 'provider-api',
        observedAt,
      }));
      return {
        status: 'available',
        fetchedAt: observedAt,
        windowSetEstablished: true,
        windows,
      };
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}
