import { ParamMap, Params } from '@angular/router';
import { z } from 'zod';

export type WaitlistStage =
  | 'all'
  | 'new'
  | 'invited'
  | 'approved'
  | 'converted';

export const WAITLIST_STAGES: readonly WaitlistStage[] = [
  'all',
  'new',
  'invited',
  'approved',
  'converted',
] as const;

export type WaitlistSource =
  | 'landing'
  | 'pricing'
  | 'profile'
  | 'vscode'
  | 'early-adopter'
  | 'unknown';

export const WAITLIST_SOURCES: readonly WaitlistSource[] = [
  'landing',
  'pricing',
  'profile',
  'vscode',
  'early-adopter',
  'unknown',
] as const;

export type WaitlistSortField =
  | 'createdAt'
  | 'notifiedAt'
  | 'approvedAt'
  | 'convertedAt'
  | 'source';

export const WAITLIST_SORT_FIELDS: readonly WaitlistSortField[] = [
  'createdAt',
  'notifiedAt',
  'approvedAt',
  'convertedAt',
  'source',
] as const;

export type SortOrder = 'asc' | 'desc';

export const WAITLIST_PAGE_SIZES = [10, 25, 50, 100] as const;
export type WaitlistPageSize = (typeof WAITLIST_PAGE_SIZES)[number];

const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface WaitlistFilterQuery {
  stage?: WaitlistStage;
  search?: string;
  source?: WaitlistSource;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: WaitlistSortField;
  sortOrder?: SortOrder;
}

export interface WaitlistListQuery extends WaitlistFilterQuery {
  page?: number;
  pageSize?: WaitlistPageSize;
}

// --- Zod schemas for runtime response validation ---

export const waitlistListRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  source: z.string().nullable(),
  createdAt: z.string(),
  notifiedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  convertedAt: z.string().nullable(),
  stage: z.enum(['new', 'invited', 'approved', 'converted']),
  stageAt: z.string(),
  approvalEligible: z.boolean(),
});
export type WaitlistListRow = z.infer<typeof waitlistListRowSchema>;

export const waitlistStageCountsSchema = z.object({
  all: z.number(),
  pending: z.number(),
  new: z.number(),
  invited: z.number(),
  approved: z.number(),
  converted: z.number(),
});
export type WaitlistStageCounts = z.infer<typeof waitlistStageCountsSchema>;

export const waitlistListResponseSchema = z.object({
  data: z.array(waitlistListRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
  counts: waitlistStageCountsSchema,
});
export type WaitlistListResponse = z.infer<typeof waitlistListResponseSchema>;

export const waitlistEligibleIdsResponseSchema = z
  .object({
    ids: z
      .array(z.string())
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'ids must be unique',
      }),
    selected: z.number().int().nonnegative(),
    eligibleMatching: z.number().int().nonnegative(),
    limit: z.literal(50),
    truncated: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.selected !== value.ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['selected'],
        message: 'selected must equal ids.length',
      });
    }
    if (value.eligibleMatching < value.selected) {
      context.addIssue({
        code: 'custom',
        path: ['eligibleMatching'],
        message: 'eligibleMatching must be greater than or equal to selected',
      });
    }
    if (value.truncated !== value.eligibleMatching > value.selected) {
      context.addIssue({
        code: 'custom',
        path: ['truncated'],
        message:
          'truncated must reflect whether eligibleMatching exceeds selected',
      });
    }
  });
export type WaitlistEligibleIdsResponse = z.infer<
  typeof waitlistEligibleIdsResponseSchema
>;

export const waitlistUserDetailsSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  createdAt: z.string(),
  licenses: z.array(
    z.object({
      id: z.string(),
      plan: z.string(),
      status: z.string(),
      source: z.string(),
      expiresAt: z.string().nullable(),
      createdAt: z.string(),
      createdBy: z.string(),
    }),
  ),
  subscriptions: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      priceId: z.string(),
      currentPeriodEnd: z.string(),
      trialEnd: z.string().nullable(),
      canceledAt: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  groups: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      assignedAt: z.string(),
      source: z.string(),
    }),
  ),
});
export type WaitlistUserDetails = z.infer<typeof waitlistUserDetailsSchema>;

export const waitlistAuditItemSchema = z.object({
  id: z.string(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.literal('Waitlist'),
  targetId: z.string(),
  createdAt: z.string(),
  metadata: z.object({
    userId: z.string().optional(),
    userWasCreated: z.boolean().optional(),
    licenseId: z.string().optional(),
    durationPreset: z.string().optional(),
    expiresAt: z.string().nullable().optional(),
    groupKey: z.string().optional(),
    wasNotified: z.boolean().optional(),
    cohortAlreadyAssigned: z.boolean().optional(),
  }),
});
export type WaitlistAuditItem = z.infer<typeof waitlistAuditItemSchema>;

export const waitlistDetailsResponseSchema = z.object({
  entry: waitlistListRowSchema,
  user: waitlistUserDetailsSchema.nullable(),
  audit: z.array(waitlistAuditItemSchema),
});
export type WaitlistDetailsResponse = z.infer<
  typeof waitlistDetailsResponseSchema
>;

/** Default sort order: asc for new (oldest waiting first), desc otherwise. */
export function defaultSortOrder(stage: WaitlistStage): SortOrder {
  return stage === 'new' ? 'asc' : 'desc';
}

function getQueryParam(
  rawParams: ParamMap | Params,
  key: string,
): string | null {
  if ('get' in rawParams && typeof rawParams.get === 'function') {
    return rawParams.get(key);
  }
  const value = (rawParams as Params)[key];
  return value != null ? String(value) : null;
}

function parseAllowlistedValue<T extends string>(
  value: string | null,
  allowedValues: readonly T[],
): T | undefined {
  return value !== null && (allowedValues as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function parseIsoDate(value: string | null): string | undefined {
  const isIsoFormat =
    value !== null &&
    (ISO_DATE_ONLY_PATTERN.test(value) || ISO_DATE_TIME_PATTERN.test(value));
  return value && isIsoFormat && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

function parsePage(value: string | null): number {
  const parsed = value && /^\d+$/.test(value) ? Number(value) : 1;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function parsePageSize(value: string | null): WaitlistPageSize {
  const parsed = value && /^\d+$/.test(value) ? Number(value) : 25;
  return (WAITLIST_PAGE_SIZES as readonly number[]).includes(parsed)
    ? (parsed as WaitlistPageSize)
    : 25;
}

/**
 * Normalizes router query params into a type-safe WaitlistListQuery object.
 * Invalid values fall back to defaults.
 */
export function parseWaitlistQuery(
  rawParams: ParamMap | Params,
): WaitlistListQuery {
  // Support both canonical ?stage= and legacy ?tab=
  const rawStage =
    getQueryParam(rawParams, 'stage') ?? getQueryParam(rawParams, 'tab');
  const stage = parseAllowlistedValue(rawStage, WAITLIST_STAGES) ?? 'new';

  const rawSearch = getQueryParam(rawParams, 'search');
  const search =
    rawSearch && rawSearch.trim().length > 0
      ? rawSearch.trim().slice(0, 256)
      : undefined;

  const source = parseAllowlistedValue(
    getQueryParam(rawParams, 'source'),
    WAITLIST_SOURCES,
  );
  const createdFrom = parseIsoDate(getQueryParam(rawParams, 'createdFrom'));
  const createdTo = parseIsoDate(getQueryParam(rawParams, 'createdTo'));
  const sortBy =
    parseAllowlistedValue(
      getQueryParam(rawParams, 'sortBy'),
      WAITLIST_SORT_FIELDS,
    ) ?? 'createdAt';
  const sortOrder =
    parseAllowlistedValue(getQueryParam(rawParams, 'sortOrder'), [
      'asc',
      'desc',
    ] as const) ?? defaultSortOrder(stage);
  const page = parsePage(getQueryParam(rawParams, 'page'));
  const pageSize = parsePageSize(getQueryParam(rawParams, 'pageSize'));

  return {
    stage,
    search,
    source,
    createdFrom,
    createdTo,
    sortBy,
    sortOrder,
    page,
    pageSize,
  };
}

/**
 * Serializes query parameters for router navigation.
 * Omits defaults and empty values to keep the URL clean.
 */
export function serializeWaitlistQuery(
  query: WaitlistListQuery,
): Record<string, string | number | null> {
  const params: Record<string, string | number | null> = {};

  // stage
  params['stage'] = query.stage && query.stage !== 'new' ? query.stage : null;
  // clean up legacy tab if present
  params['tab'] = null;

  // optional filters
  params['search'] = query.search ? query.search : null;
  params['source'] = query.source ? query.source : null;
  params['createdFrom'] = query.createdFrom ? query.createdFrom : null;
  params['createdTo'] = query.createdTo ? query.createdTo : null;

  // sort
  const defaultOrder = defaultSortOrder(query.stage ?? 'new');
  params['sortBy'] =
    query.sortBy && query.sortBy !== 'createdAt' ? query.sortBy : null;
  params['sortOrder'] =
    query.sortOrder && query.sortOrder !== defaultOrder
      ? query.sortOrder
      : null;

  // pagination
  params['page'] = query.page && query.page > 1 ? query.page : null;
  params['pageSize'] =
    query.pageSize && query.pageSize !== 25 ? query.pageSize : null;

  return params;
}

/**
 * Checks whether the given raw router query parameters require canonicalization
 * to match the serialized canonical form of the parsed query state.
 */
export function needsWaitlistQueryCanonicalization(
  rawParams: ParamMap | Params,
  parsed: WaitlistListQuery,
): boolean {
  // Legacy tab parameter always triggers canonicalization
  if (getQueryParam(rawParams, 'tab') !== null) {
    return true;
  }

  const serialized = serializeWaitlistQuery(parsed);

  const keys = [
    'stage',
    'search',
    'source',
    'createdFrom',
    'createdTo',
    'sortBy',
    'sortOrder',
    'page',
    'pageSize',
  ] as const;

  for (const key of keys) {
    const rawVal = getQueryParam(rawParams, key);
    const canonicalVal =
      serialized[key] != null ? String(serialized[key]) : null;
    if (rawVal !== canonicalVal) {
      return true;
    }
  }

  return false;
}
