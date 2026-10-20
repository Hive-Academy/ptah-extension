/**
 * Ollama Cloud response schemas and mapping.
 *
 * `/api/balance` carries the plan limits (legacy `included.session/weekly`
 * percent-REMAINING windows, or a credit allowance); `/api/usage` carries
 * request counts. `purchased.balance_usd` is an amount and never a window; a
 * percentage is never computed from request counts.
 */
import { z } from 'zod';
import type {
  PlanLimitWindow,
  PlanLocalUsage,
  PlanModelUsage,
} from '@ptah-extension/shared';

const MAX_MODELS = 10;
const MAX_BODY_BYTES = 256 * 1024;

/** Read at most 256 KiB from a streamed response and reject invalid JSON. */
export async function readJson(response: Response): Promise<unknown> {
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const timestamp = z
  .string()
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), 'invalid timestamp');
const LimitWindowSchema = z.object({
  remaining_percent: z.number().finite().min(0).max(100),
  resets_at: timestamp,
});
const usd = z.number().finite().nonnegative();
const IncludedSchema = z.object({
  session: LimitWindowSchema.optional(),
  weekly: LimitWindowSchema.optional(),
  balance_usd: usd.optional(),
  allowance_usd: usd.optional(),
  period: z
    .object({ from: timestamp.optional(), until: timestamp.optional() })
    .optional(),
});
/** Both documented `/api/balance` variants; unknown fields are ignored. */
const BalanceBodySchema = IncludedSchema.extend({
  included: IncludedSchema.optional(),
  purchased: z.object({ balance_usd: usd.optional() }).optional(),
}).refine(
  (body) =>
    [
      body.included,
      body.purchased,
      body.session,
      body.weekly,
      body.balance_usd,
      body.allowance_usd,
    ].some((field) => field !== undefined),
  'no recognised balance field',
);

/** The fields of `/api/usage` this reader relies on; the rest is ignored. */
const UsageBodySchema = z.object({
  range: z.string().optional(),
  totals: z.object({
    request_count: z.number().int().nonnegative(),
    // A malformed per-model list never discards the request total.
    groups: z
      .array(
        z.object({
          model: z.string().min(1).max(128),
          request_count: z.number().int().nonnegative(),
        }),
      )
      .max(100)
      .optional()
      .catch(undefined),
  }),
});

/** Ollama's fixed range codes, spelled the way the dashboard shows ranges. */
const RANGE_LABELS: Readonly<Record<string, string>> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
};

/**
 * Plan windows from a `/api/balance` body; `undefined` when it does not match
 * either documented variant. An empty list is a valid "no limits" answer.
 */
export function balanceWindows(
  json: unknown,
  observedAt: number,
): PlanLimitWindow[] | undefined {
  const parsed = BalanceBodySchema.safeParse(json);
  if (!parsed.success) return undefined;
  const source = parsed.data.included ?? parsed.data;
  const windows: PlanLimitWindow[] = [];
  if (source.session) {
    windows.push(
      percentWindow(
        'other:session',
        'other',
        'Session',
        source.session,
        observedAt,
      ),
    );
  }
  if (source.weekly) {
    windows.push(
      percentWindow('weekly', 'weekly', 'Weekly', source.weekly, observedAt),
    );
  }
  const { allowance_usd: allowance, balance_usd: balance } = source;
  // Balance USD is an amount; only a positive allowance yields a percentage.
  if (allowance !== undefined && allowance > 0 && balance !== undefined) {
    const until = source.period?.until;
    const from = source.period?.from;
    windows.push({
      key: 'monthly',
      kind: 'monthly',
      label: 'Monthly credit allowance',
      used: {
        kind: 'percent',
        percent: clampPercent(((allowance - balance) / allowance) * 100),
      },
      usedSource: 'provider-api',
      usedObservedAt: observedAt,
      ...(until && {
        resetsAt: Date.parse(until),
        resetSource: 'provider-api',
      }),
      ...(from && { lastResetAt: Date.parse(from) }),
      observedAt,
    });
  }
  return windows;
}

function percentWindow(
  key: 'other:session' | 'weekly',
  kind: 'other' | 'weekly',
  label: string,
  window: z.infer<typeof LimitWindowSchema>,
  observedAt: number,
): PlanLimitWindow {
  return {
    key,
    kind,
    label,
    ...(kind === 'weekly' && { durationMins: 10_080 }),
    // The API reports what is left; the dashboard shows what is used.
    used: {
      kind: 'percent',
      percent: clampPercent(100 - window.remaining_percent),
    },
    usedSource: 'provider-api',
    usedObservedAt: observedAt,
    resetsAt: Date.parse(window.resets_at),
    resetSource: 'provider-api',
    observedAt,
  };
}

function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

/**
 * The request count `/api/usage` reports, as a usage stat. `undefined` when
 * the body does not carry the expected totals.
 */
export function requestCountUsage(
  json: unknown,
  observedAt: number,
): PlanLocalUsage | undefined {
  const parsed = UsageBodySchema.safeParse(json);
  if (!parsed.success) return undefined;
  const range = parsed.data.range;
  const models: PlanModelUsage[] = (parsed.data.totals.groups ?? [])
    .map((group) => ({ model: group.model, requests: group.request_count }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, MAX_MODELS);
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
    ...(models.length > 0 && { models }),
  };
}
