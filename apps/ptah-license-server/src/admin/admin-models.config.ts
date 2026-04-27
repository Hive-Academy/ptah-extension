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
  | 'trial-reminders'
  | 'session-requests';

export interface AdminModelConfig {
  /** Prisma delegate name (the lower-case client property, e.g. prisma.user) */
  prismaModel:
    | 'user'
    | 'license'
    | 'subscription'
    | 'failedWebhook'
    | 'trialReminder'
    | 'sessionRequest';
  /** Columns shown on the list page */
  listFields: string[];
  /** Text-searchable string fields (contains, insensitive) */
  searchFields: string[];
  /** Fields allowed as sortBy */
  sortableFields: string[];
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
    // licenseKey IMMUTABLE per spec. userId not editable (FK safety).
    // `source` is system-set (paddle | complimentary | manual) — NOT editable.
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
    editableFields: ['resolved', 'resolvedAt'],
    readOnly: false,
    defaultSortBy: 'attemptedAt',
  },
  'trial-reminders': {
    prismaModel: 'trialReminder',
    listFields: ['id', 'userId', 'reminderType', 'sentAt', 'emailSentTo'],
    searchFields: ['userId', 'reminderType', 'emailSentTo'],
    sortableFields: ['sentAt', 'reminderType'],
    editableFields: [], // read-only tracking records
    readOnly: true,
    defaultSortBy: 'sentAt',
    include: { user: true },
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
    editableFields: ['status', 'paymentStatus', 'scheduledAt'],
    readOnly: false,
    defaultSortBy: 'createdAt',
    include: { user: true },
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
