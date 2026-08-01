/**
 * Per-model field allowlists for the native admin dashboard.
 *
 * SECURITY CRITICAL: These lists are the ONLY allowlist between the HTTP query-string
 * and Prisma. Any field name (sort, search, edit) not in this config is rejected
 * with 400. This prevents field-name injection (Prisma does not sanitize keys).
 *
 * Mirrors the intent of the old AdminJS resource configs (commit 4170dfa1, since
 * deleted). To change admin UI columns, edit here and the corresponding frontend
 * mirror at apps/ptah-landing-page/src/app/pages/admin/admin-models.config.ts.
 */

export type AdminModelKey =
  | 'users'
  | 'licenses'
  | 'subscriptions'
  | 'failed-webhooks'
  | 'session-requests'
  | 'admin-audit-log'
  | 'marketing-campaigns'
  | 'marketing-campaign-templates'
  | 'waitlist';

/**
 * Descriptor for a single allowlisted `?filter=field:value` field.
 *
 * SECURITY: like `searchFields`/`sortableFields`, `filterableFields` is the
 * ONLY allowlist between the HTTP query-string and Prisma. A `filter` targeting
 * a field absent from this map is rejected with 400 — arbitrary field filtering
 * is never permitted.
 *
 * - `boolean`      → column is a Prisma `Boolean`; value must be `true`/`false`.
 * - `string`       → column is a Prisma `String`; value matched for equality
 *                    and, when `allowedValues` is set, constrained to that set.
 * - `datePresence` → column is a nullable `DateTime` exposed as a virtual
 *                    boolean: `true` → `{ not: null }`, `false` → `null`.
 *                    Lets `notified:true` mean "has a notifiedAt timestamp".
 */
export type AdminFilterFieldType = 'boolean' | 'string' | 'datePresence';

export interface AdminFilterField {
  type: AdminFilterFieldType;
  /** Actual Prisma column the (possibly virtual) filter field maps to. */
  column: string;
  /** Optional value allowlist for `string` filters (rejects anything else). */
  allowedValues?: readonly string[];
}

export interface AdminModelConfig {
  /** Prisma delegate name (the lower-case client property, e.g. prisma.user) */
  prismaModel:
    | 'user'
    | 'license'
    | 'subscription'
    | 'failedWebhook'
    | 'sessionRequest'
    | 'adminAuditLog'
    | 'marketingCampaign'
    | 'marketingCampaignTemplate'
    | 'waitlist';
  /** Columns shown on the list page */
  listFields: string[];
  /** Text-searchable string fields (contains, insensitive) */
  searchFields: string[];
  /** Fields allowed as sortBy */
  sortableFields: string[];
  /**
   * Fields the admin may filter on via `?filter=field:value`. Keyed by the
   * query-param field name (may be a virtual name such as `notified`). Absent =
   * the model supports no field filtering; any `filter` is then rejected 400.
   */
  filterableFields?: Record<string, AdminFilterField>;
  /** Fields the admin may PATCH. Empty array = read-only. */
  editableFields: string[];
  /** If true, PATCH endpoint returns 405 Method Not Allowed */
  readOnly: boolean;
  /** Default sort when none supplied */
  defaultSortBy: string;
  /** Optional relation includes (e.g. { user: true }) — hard-coded, never user-input */
  include?: Record<string, boolean>;
}

export const ADMIN_MODELS: Record<AdminModelKey, AdminModelConfig> = {
  users: {
    prismaModel: 'user',
    listFields: [
      'id',
      'email',
      'firstName',
      'lastName',
      'workosId',
      'paddleCustomerId',
      'emailVerified',
      'createdAt',
      'updatedAt',
    ],
    searchFields: [
      'email',
      'firstName',
      'lastName',
      'workosId',
      'paddleCustomerId',
    ],
    sortableFields: ['createdAt', 'updatedAt', 'email', 'emailVerified'],
    editableFields: ['firstName', 'lastName', 'emailVerified'],
    readOnly: false,
    defaultSortBy: 'createdAt',
  },
  licenses: {
    prismaModel: 'license',
    listFields: [
      'id',
      'licenseKey',
      'userId',
      'plan',
      'status',
      'source',
      'expiresAt',
      'createdAt',
      'createdBy',
    ],
    searchFields: ['licenseKey', 'userId', 'plan', 'status', 'source'],
    sortableFields: ['createdAt', 'expiresAt', 'status', 'plan', 'source'],
    editableFields: ['plan', 'status', 'expiresAt'],
    readOnly: false,
    defaultSortBy: 'createdAt',
    include: { user: true },
  },
  subscriptions: {
    prismaModel: 'subscription',
    listFields: [
      'id',
      'userId',
      'paddleSubscriptionId',
      'paddleCustomerId',
      'status',
      'priceId',
      'currentPeriodEnd',
      'trialEnd',
      'canceledAt',
      'createdAt',
      'updatedAt',
    ],
    searchFields: [
      'paddleSubscriptionId',
      'paddleCustomerId',
      'userId',
      'status',
      'priceId',
    ],
    sortableFields: ['createdAt', 'updatedAt', 'currentPeriodEnd', 'status'],
    filterableFields: {
      // Prisma String column; values are the Paddle subscription lifecycle.
      status: {
        type: 'string',
        column: 'status',
        allowedValues: ['active', 'trialing', 'paused', 'canceled', 'past_due'],
      },
    },
    editableFields: [], // Paddle-managed, read-only
    readOnly: true,
    defaultSortBy: 'createdAt',
    include: { user: true },
  },
  'failed-webhooks': {
    prismaModel: 'failedWebhook',
    listFields: [
      'id',
      'eventId',
      'eventType',
      'errorMessage',
      'attemptedAt',
      'retryCount',
      'resolved',
      'resolvedAt',
    ],
    searchFields: ['eventId', 'eventType', 'errorMessage'],
    sortableFields: ['attemptedAt', 'retryCount', 'resolved'],
    filterableFields: {
      // Boolean column: `resolved:false` = the ops-triage "needs a human" queue.
      resolved: { type: 'boolean', column: 'resolved' },
    },
    editableFields: ['resolved', 'resolvedAt'],
    readOnly: false,
    defaultSortBy: 'attemptedAt',
  },
  'session-requests': {
    prismaModel: 'sessionRequest',
    listFields: [
      'id',
      'userId',
      'sessionTopicId',
      'isFreeSession',
      'status',
      'paymentStatus',
      'paddleTransactionId',
      'scheduledAt',
      'createdAt',
      'updatedAt',
    ],
    searchFields: [
      'userId',
      'sessionTopicId',
      'status',
      'paymentStatus',
      'paddleTransactionId',
    ],
    sortableFields: ['createdAt', 'updatedAt', 'scheduledAt', 'status'],
    filterableFields: {
      status: {
        type: 'string',
        column: 'status',
        allowedValues: ['pending', 'scheduled', 'completed', 'canceled'],
      },
      paymentStatus: {
        type: 'string',
        column: 'paymentStatus',
        allowedValues: ['none', 'pending', 'completed'],
      },
    },
    editableFields: ['status', 'paymentStatus', 'scheduledAt'],
    readOnly: false,
    defaultSortBy: 'createdAt',
    include: { user: true },
  },
  'admin-audit-log': {
    prismaModel: 'adminAuditLog',
    listFields: [
      'id',
      'actorEmail',
      'action',
      'targetType',
      'targetId',
      'createdAt',
    ],
    searchFields: ['actorEmail', 'action', 'targetType', 'targetId'],
    sortableFields: ['createdAt', 'action', 'actorEmail'],
    editableFields: [],
    readOnly: true,
    defaultSortBy: 'createdAt',
  },
  'marketing-campaigns': {
    prismaModel: 'marketingCampaign',
    listFields: [
      'id',
      'name',
      'subject',
      'segment',
      'recipientCount',
      'sentCount',
      'bouncedCount',
      'complainedCount',
      'createdBy',
      'createdAt',
      'completedAt',
    ],
    searchFields: ['name', 'subject', 'segment', 'createdBy'],
    sortableFields: ['createdAt', 'completedAt', 'sentCount', 'recipientCount'],
    editableFields: [],
    readOnly: true,
    defaultSortBy: 'createdAt',
  },
  'marketing-campaign-templates': {
    prismaModel: 'marketingCampaignTemplate',
    listFields: [
      'id',
      'name',
      'subject',
      'variables',
      'createdAt',
      'updatedAt',
    ],
    searchFields: ['name', 'subject'],
    sortableFields: ['createdAt', 'updatedAt', 'name'],
    editableFields: ['name', 'subject', 'htmlBody'],
    readOnly: false,
    defaultSortBy: 'createdAt',
  },
  waitlist: {
    prismaModel: 'waitlist',
    listFields: [
      'id',
      'email',
      'source',
      'createdAt',
      'notifiedAt',
      'convertedAt',
    ],
    searchFields: ['email', 'source'],
    sortableFields: ['createdAt', 'notifiedAt', 'convertedAt', 'source'],
    filterableFields: {
      // Waitlist has no literal `status` column — lifecycle is two nullable
      // timestamps. Expose them as virtual booleans so the pipeline tabs map
      // cleanly: New = notified:false, Invited = notified:true,
      // Converted = converted:true.
      notified: { type: 'datePresence', column: 'notifiedAt' },
      converted: { type: 'datePresence', column: 'convertedAt' },
    },
    editableFields: ['notifiedAt', 'convertedAt'],
    readOnly: false,
    defaultSortBy: 'createdAt',
  },
};

/**
 * Assert that `field` is a member of `allowlist`, throw otherwise.
 * Used to guard every field-name that flows from user input to Prisma.
 *
 * Callers (e.g. AdminService) should catch and re-throw as `BadRequestException`
 * with an HTTP-friendly message. This helper intentionally throws a plain Error
 * so it remains usable in non-HTTP contexts (tests, scripts).
 */
export function assertAllowedField(
  field: string,
  allowlist: readonly string[],
  context: string,
): void {
  if (!allowlist.includes(field)) {
    throw new Error(
      `Field '${field}' is not allowed in ${context}. Allowed: ${allowlist.join(', ')}`,
    );
  }
}
