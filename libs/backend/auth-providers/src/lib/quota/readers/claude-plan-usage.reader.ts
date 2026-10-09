/**
 * Claude plan-usage reader (TASK_2026_596, Component 6; Req 2.2).
 *
 * Reads the full `/usage` table of an open native Claude session through
 * `SessionQuotaProbe.readPlanUsage` (the SDK's experimental usage control
 * request, `sdk.d.ts` `SDKControlGetUsageResponse`). On demand only: the
 * plan-usage service calls it for an RPC refresh, a dashboard open or a tool
 * lookup, never per turn.
 *
 * - `rate_limits_available === false` (API key, Bedrock, Vertex) →
 *   `unsupported-auth`: the account has no plan windows.
 * - The probe returns `null` (no open session, timeout, rejection) →
 *   `service-unavailable` with `unavailableReason:'no-open-session'`; the
 *   service still attaches the ledger's stream-event evidence (Req 2.1 data).
 * - A response that does not match the validated shape throws
 *   {@link PlanUsageParseError} after a sanitised diagnostic
 *   (`{providerId, fieldPath, reason}`, Req 2.7); the service maps it to
 *   `service-unavailable`, or `stale` for an unchanged owner (Req 2.9).
 *
 * The API is experimental and may change, so the payload is validated here,
 * at the boundary where it enters, even though the SDK types it.
 */
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionQuotaProbe } from '@ptah-extension/agent-sdk';
import {
  normaliseInstant,
  type PlanLimitWindow,
  type PlanWindowKey,
  type PlanWindowKind,
} from '@ptah-extension/shared';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

const PROVIDER_ID = 'anthropic';
const FIVE_HOUR_MINS = 300;
const WEEK_MINS = 10_080;

/** A source payload did not match the shape the reader validates. */
export class PlanUsageParseError extends Error {
  constructor(
    readonly providerId: string,
    readonly fieldPath: string,
  ) {
    super('plan usage response did not match the expected shape');
    this.name = 'PlanUsageParseError';
  }
}

const UsageWindowSchema = z
  .object({
    utilization: z.number().nullable().optional(),
    resets_at: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const RateLimitsSchema = z.object({
  five_hour: UsageWindowSchema,
  seven_day: UsageWindowSchema,
  seven_day_oauth_apps: UsageWindowSchema,
  seven_day_opus: UsageWindowSchema,
  seven_day_sonnet: UsageWindowSchema,
  model_scoped: z
    .array(
      z.object({
        display_name: z.string(),
        utilization: z.number().nullable().optional(),
        resets_at: z.string().nullable().optional(),
      }),
    )
    .optional(),
  extra_usage: z
    .object({
      is_enabled: z.boolean(),
      monthly_limit: z.number().nullable().optional(),
      used_credits: z.number().nullable().optional(),
      utilization: z.number().nullable().optional(),
      currency: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const PlanUsageSchema = z.object({
  subscription_type: z.string().nullable().optional(),
  rate_limits_available: z.boolean(),
  rate_limits: RateLimitsSchema.nullable(),
});

type UsageWindow = z.infer<typeof UsageWindowSchema>;
type RateLimits = z.infer<typeof RateLimitsSchema>;

interface FixedWindow {
  readonly field: keyof Pick<
    RateLimits,
    | 'five_hour'
    | 'seven_day'
    | 'seven_day_opus'
    | 'seven_day_sonnet'
    | 'seven_day_oauth_apps'
  >;
  readonly key: PlanWindowKey;
  readonly kind: PlanWindowKind;
  readonly label: string;
  readonly durationMins: number;
  readonly modelScope?: string;
}

/** Labels match the ledger's for the same keys (stream-event windows). */
const FIXED_WINDOWS: readonly FixedWindow[] = [
  {
    field: 'five_hour',
    key: 'five_hour',
    kind: 'five_hour',
    label: '5-hour',
    durationMins: FIVE_HOUR_MINS,
  },
  {
    field: 'seven_day',
    key: 'weekly',
    kind: 'weekly',
    label: 'Weekly',
    durationMins: WEEK_MINS,
  },
  {
    field: 'seven_day_opus',
    key: 'weekly_model:opus',
    kind: 'weekly_model',
    label: 'Weekly · Opus',
    durationMins: WEEK_MINS,
    modelScope: 'opus',
  },
  {
    field: 'seven_day_sonnet',
    key: 'weekly_model:sonnet',
    kind: 'weekly_model',
    label: 'Weekly · Sonnet',
    durationMins: WEEK_MINS,
    modelScope: 'sonnet',
  },
  {
    field: 'seven_day_oauth_apps',
    key: 'other:oauth_apps',
    kind: 'other',
    label: 'Weekly · OAuth apps',
    durationMins: WEEK_MINS,
  },
];

/** The probe surface this reader needs. */
export type ClaudePlanUsageProbe = Pick<SessionQuotaProbe, 'readPlanUsage'>;

/**
 * The Claude reader. `target.sessionHandle` picks the session whose query is
 * asked; without one the probe uses the most recently active native session.
 */
export function createClaudePlanUsageReader(
  probe: ClaudePlanUsageProbe,
  logger: Logger,
  now: () => number = Date.now,
): PlanUsageReader {
  return async ({ target }) => {
    const usage = await probe.readPlanUsage(target.sessionHandle?.sessionId);
    if (usage === null) {
      return {
        status: 'service-unavailable',
        unavailableReason: 'no-open-session',
        windowSetEstablished: false,
        windows: [],
      };
    }
    return mapClaudePlanUsage(usage, now(), logger);
  };
}

/** Map one `/usage` answer observed at `observedAt`. Throws on a bad shape. */
export function mapClaudePlanUsage(
  usage: unknown,
  observedAt: number,
  logger: Logger,
): PlanUsageReading {
  const parsed = PlanUsageSchema.safeParse(usage);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw parseFailure(
      logger,
      issue ? issue.path.map(String).join('.') : '',
      issue?.code ?? 'invalid',
    );
  }
  const { rate_limits_available, rate_limits, subscription_type } = parsed.data;
  if (!rate_limits_available) {
    return {
      status: 'unsupported-auth',
      windowSetEstablished: false,
      windows: [],
    };
  }
  if (rate_limits === null) {
    throw parseFailure(logger, 'rate_limits', 'missing');
  }
  return {
    status: 'available',
    fetchedAt: observedAt,
    windowSetEstablished: true,
    windows: uniqueByKey([
      ...fixedWindows(rate_limits, observedAt),
      ...modelScopedWindows(rate_limits, observedAt),
      ...overageWindow(rate_limits, observedAt),
    ]),
    ...(subscription_type ? { account: { planType: subscription_type } } : {}),
  };
}

function fixedWindows(
  limits: RateLimits,
  observedAt: number,
): PlanLimitWindow[] {
  const windows: PlanLimitWindow[] = [];
  for (const spec of FIXED_WINDOWS) {
    const entry = limits[spec.field];
    if (!entry) continue;
    windows.push({
      key: spec.key,
      kind: spec.kind,
      label: spec.label,
      durationMins: spec.durationMins,
      ...(spec.modelScope !== undefined && { modelScope: spec.modelScope }),
      ...usageFields(entry, observedAt),
      observedAt,
    });
  }
  return windows;
}

function modelScopedWindows(
  limits: RateLimits,
  observedAt: number,
): PlanLimitWindow[] {
  const windows: PlanLimitWindow[] = [];
  for (const entry of limits.model_scoped ?? []) {
    const name = entry.display_name.trim();
    if (name.length === 0) continue;
    const scope = name.toLowerCase();
    windows.push({
      key: `weekly_model:${scope}`,
      kind: 'weekly_model',
      label: `Weekly · ${name}`,
      modelScope: scope,
      durationMins: WEEK_MINS,
      ...usageFields(entry, observedAt),
      observedAt,
    });
  }
  return windows;
}

/** Extra usage: credits used of the monthly limit, else a percentage. */
function overageWindow(
  limits: RateLimits,
  observedAt: number,
): PlanLimitWindow[] {
  const extra = limits.extra_usage;
  if (!extra?.is_enabled) return [];
  const hasAmount =
    typeof extra.used_credits === 'number' &&
    typeof extra.monthly_limit === 'number';
  const used = hasAmount
    ? {
        kind: 'amount' as const,
        amount: extra.used_credits as number,
        limit: extra.monthly_limit as number,
        unit: extra.currency?.trim() || 'credits',
      }
    : typeof extra.utilization === 'number'
      ? { kind: 'percent' as const, percent: extra.utilization }
      : undefined;
  return [
    {
      key: 'overage',
      kind: 'overage',
      label: 'Extra usage',
      ...(used && {
        used,
        usedSource: 'provider-api' as const,
        usedObservedAt: observedAt,
      }),
      observedAt,
    },
  ];
}

/** `used` and `resetsAt` of one window; an absent value stays unknown. */
function usageFields(
  entry: NonNullable<UsageWindow>,
  observedAt: number,
): Partial<PlanLimitWindow> {
  const resetsAt = normaliseInstant(entry.resets_at);
  return {
    ...(typeof entry.utilization === 'number' && {
      used: { kind: 'percent', percent: entry.utilization },
      usedSource: 'provider-api',
      usedObservedAt: observedAt,
    }),
    ...(resetsAt !== undefined && {
      resetsAt,
      resetSource: 'provider-api',
    }),
  };
}

/** The first window per key wins (a `model_scoped` row repeating Opus). */
function uniqueByKey(windows: PlanLimitWindow[]): PlanLimitWindow[] {
  const seen = new Set<string>();
  return windows.filter((window) => {
    if (seen.has(window.key)) return false;
    seen.add(window.key);
    return true;
  });
}

function parseFailure(
  logger: Logger,
  fieldPath: string,
  reason: string,
): PlanUsageParseError {
  logger.warn('[PlanUsage] usage response rejected', {
    providerId: PROVIDER_ID,
    fieldPath,
    reason,
  });
  return new PlanUsageParseError(PROVIDER_ID, fieldPath);
}
