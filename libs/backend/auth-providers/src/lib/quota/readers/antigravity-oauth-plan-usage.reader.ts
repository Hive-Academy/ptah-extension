/** Antigravity ACP profile quota. A missing profile leaves the local probe in charge. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { PlanLimitWindow, PlanWindowKind } from '@ptah-extension/shared';
import type { PlanUsageReading } from './plan-usage-reader.types';

const TokenSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  refresh_token: z.string().min(1),
  project_id: z.string().optional(),
});
const RefreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});
const QuotaSchema = z.object({
  remainingFraction: z.number().finite().min(0).max(1).optional(),
  resetTime: z.string().optional(),
});
const BucketSchema = QuotaSchema.extend({
  bucketId: z.string().min(1),
  window: z.string().optional(),
  displayName: z.string().optional(),
  disabled: z.boolean().optional(),
});
const SummarySchema = z.object({
  groups: z
    .array(
      z.object({
        displayName: z.string().optional(),
        buckets: z.array(BucketSchema).optional(),
      }),
    )
    .optional(),
  buckets: z.array(BucketSchema).optional(),
});
const ModelsSchema = z.object({
  models: z.record(
    z.string(),
    z.object({
      modelProvider: z.string().optional(),
      quotaInfo: QuotaSchema.optional(),
      weeklyQuotaInfo: QuotaSchema.optional(),
    }),
  ),
});
const unavailable = (): PlanUsageReading => ({
  status: 'service-unavailable',
  windowSetEstablished: false,
  windows: [],
});
const noPlan = (): PlanUsageReading => ({
  status: 'no-usage-source',
  windowSetEstablished: false,
  windows: [],
});
const ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];
const MAX_BODY_BYTES = 256 * 1024;
let cachedAccess:
  | {
      refreshToken: string;
      fetcher: typeof fetch;
      token: string;
      expiresAt: number;
    }
  | undefined;

async function boundedJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES)
    throw new Error('response too large');
  return JSON.parse(body);
}

export async function readAntigravityOAuthQuota(
  signal?: AbortSignal,
  now: () => number = Date.now,
  fetcher: typeof fetch = fetch,
  readAuth: typeof readFile = readFile,
  env: NodeJS.ProcessEnv = process.env,
  retryUnauthorized = true,
): Promise<PlanUsageReading | undefined> {
  if (signal?.aborted) return unavailable();
  const profile =
    env['ANTIGRAVITY_HOME']?.trim() ||
    join(env['HOME'] || env['USERPROFILE'] || homedir(), '.gemini');
  let raw: string;
  try {
    raw = await readAuth(
      join(profile, 'antigravity-acp', 'acp_token.json'),
      'utf8',
    );
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? undefined
      : unavailable();
  }
  let token: ReturnType<typeof TokenSchema.safeParse>;
  try {
    token = TokenSchema.safeParse(JSON.parse(raw));
  } catch {
    return unavailable();
  }
  if (!token.success) return unavailable();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    let accessToken =
      cachedAccess?.refreshToken === token.data.refresh_token &&
      cachedAccess.fetcher === fetcher
        ? cachedAccess
        : undefined;
    if (!accessToken || accessToken.expiresAt <= now()) {
      const params = new URLSearchParams({
        client_id: token.data.client_id,
        client_secret: token.data.client_secret,
        refresh_token: token.data.refresh_token,
        grant_type: 'refresh_token',
      });
      const refreshed = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: params,
        redirect: 'error',
        signal: controller.signal,
      });
      if (refreshed.status === 403) return noPlan();
      if (!refreshed.ok) {
        if (refreshed.status === 400) {
          const error = await boundedJson(refreshed);
          if (
            z.object({ error: z.string() }).safeParse(error).data?.error ===
            'invalid_grant'
          ) {
            cachedAccess = undefined;
            return {
              status: 'unsupported-auth',
              windowSetEstablished: false,
              windows: [],
            };
          }
        }
        return unavailable();
      }
      const access = RefreshSchema.safeParse(await boundedJson(refreshed));
      if (!access.success) return unavailable();
      accessToken = {
        refreshToken: token.data.refresh_token,
        fetcher,
        token: access.data.access_token,
        expiresAt: now() + access.data.expires_in * 1000 - 60_000,
      };
      cachedAccess = accessToken;
    }
    const observedAt = now();
    let forbidden = false;
    for (const operation of [
      'retrieveUserQuotaSummary',
      'fetchAvailableModels',
    ] as const) {
      for (const endpoint of ENDPOINTS) {
        try {
          const response = await fetcher(
            `${endpoint}/v1internal:${operation}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(
                token.data.project_id ? { project: token.data.project_id } : {},
              ),
              redirect: 'error',
              signal: controller.signal,
            },
          );
          if (response.status === 403) {
            forbidden = true;
            continue;
          }
          if (response.status === 401) {
            cachedAccess = undefined;
            return retryUnauthorized
              ? readAntigravityOAuthQuota(
                  signal,
                  now,
                  fetcher,
                  readAuth,
                  env,
                  false,
                )
              : unavailable();
          }
          if (!response.ok) continue;
          const body: unknown = await boundedJson(response);
          const windows =
            operation === 'retrieveUserQuotaSummary'
              ? summaryWindows(body, observedAt)
              : modelWindows(body, observedAt);
          if (windows.length)
            return {
              status: 'available',
              fetchedAt: observedAt,
              windowSetEstablished: true,
              windows,
            };
        } catch {
          if (controller.signal.aborted) return unavailable();
        }
      }
    }
    return forbidden ? noPlan() : unavailable();
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function quotaWindow(
  key: string,
  kind: PlanWindowKind,
  label: string,
  quota: z.infer<typeof QuotaSchema>,
  observedAt: number,
): PlanLimitWindow | undefined {
  if (quota.remainingFraction === undefined) return undefined;
  const resetsAt = Date.parse(quota.resetTime ?? '');
  return {
    key: `other:${key}`,
    kind,
    label,
    used: { kind: 'percent', percent: (1 - quota.remainingFraction) * 100 },
    usedSource: 'provider-unofficial',
    usedObservedAt: observedAt,
    ...(Number.isFinite(resetsAt) && {
      resetsAt,
      resetSource: 'provider-unofficial' as const,
    }),
    observedAt,
  };
}

function summaryWindows(body: unknown, observedAt: number): PlanLimitWindow[] {
  const parsed = SummarySchema.safeParse(body);
  if (!parsed.success) return [];
  const groups = parsed.data.groups?.some((group) => group.buckets?.length)
    ? parsed.data.groups
    : [{ buckets: parsed.data.buckets }];
  return groups.flatMap((group) =>
    (group.buckets ?? []).flatMap((bucket) => {
      if (bucket.disabled) return [];
      const kind =
        bucket.window === 'weekly'
          ? 'weekly'
          : bucket.window === '5h'
            ? 'five_hour'
            : 'other';
      const window = quotaWindow(
        bucket.bucketId,
        kind,
        bucket.displayName || bucket.bucketId,
        bucket,
        observedAt,
      );
      return window ? [window] : [];
    }),
  );
}

function modelWindows(body: unknown, observedAt: number): PlanLimitWindow[] {
  const parsed = ModelsSchema.safeParse(body);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.models).flatMap(([id, model]) => {
    const family = id.startsWith('gemini-')
      ? 'Gemini'
      : id.startsWith('claude-')
        ? 'Claude'
        : id.startsWith('gpt-')
          ? 'GPT'
          : undefined;
    if (!family) return [];
    return (
      [
        ['quota', 'other', model.quotaInfo],
        ['weekly', 'weekly', model.weeklyQuotaInfo],
      ] as const
    ).flatMap(([suffix, kind, quota]) => {
      if (!quota) return [];
      const window = quotaWindow(
        `${id}-${suffix}`,
        kind,
        `${family} · ${suffix}`,
        quota,
        observedAt,
      );
      return window ? [window] : [];
    });
  });
}
