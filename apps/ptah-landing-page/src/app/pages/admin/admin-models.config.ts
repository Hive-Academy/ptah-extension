/**
 * Frontend UI metadata for the native admin dashboard.
 *
 * This file is a MIRROR of the backend security config at
 * `apps/ptah-license-server/src/admin/admin-models.config.ts`. The backend
 * file is authoritative for security (field allowlists for sort/search/edit);
 * this one is authoritative for presentation (labels, input widgets, list
 * columns, placeholders, bulk-email affordances).
 *
 * Sync discipline:
 * - Every `editable: true` field here MUST also appear in backend
 *   `editableFields` — otherwise the UI exposes an edit widget whose PATCH
 *   is silently dropped server-side.
 * - `readOnly: true` on a model here MUST match `readOnly: true` in backend.
 * - Field `key` values MUST match the Prisma model attribute names.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'uuid'
  | 'json';

export interface FieldSpec {
  /** Prisma attribute name — MUST match backend model. */
  key: string;
  /** Human label shown in table header and detail view. */
  label: string;
  /** Drives input widget in detail view + cell rendering in list. */
  type: FieldType;
  /** Whether the detail view renders an editable input for this field. */
  editable?: boolean;
  /** Whether this field appears as a column on the list view. */
  listColumn?: boolean;
  /** Max pixel width for truncated cells (adds ellipsis). */
  truncate?: number;
}

export interface AdminModelSpec {
  /** URL slug — matches backend `AdminModelKey` EXACTLY. */
  key: string;
  /** Sidebar label. */
  label: string;
  /** Mirrors backend `readOnly` — hides Save button and edit widgets. */
  readOnly: boolean;
  /** Ordered field list — drives list columns AND detail view. */
  fields: FieldSpec[];
  /** Placeholder for the list-view search box. */
  searchPlaceholder: string;
  /** Enables the "Email Selected" bulk action on the list view. */
  supportsBulkEmail?: boolean;
}

export const ADMIN_MODEL_SPECS: AdminModelSpec[] = [
  {
    key: 'users',
    label: 'Users',
    readOnly: false,
    supportsBulkEmail: true,
    searchPlaceholder: 'Search email, first/last name, WorkOS ID, Paddle ID…',
    fields: [
      { key: 'id', label: 'ID', type: 'uuid', listColumn: false },
      { key: 'email', label: 'Email', type: 'string', listColumn: true },
      {
        key: 'firstName',
        label: 'First Name',
        type: 'string',
        listColumn: true,
        editable: true,
      },
      {
        key: 'lastName',
        label: 'Last Name',
        type: 'string',
        listColumn: true,
        editable: true,
      },
      {
        key: 'emailVerified',
        label: 'Verified',
        type: 'boolean',
        listColumn: true,
        editable: true,
      },
      {
        key: 'workosId',
        label: 'WorkOS ID',
        type: 'string',
        listColumn: false,
      },
      {
        key: 'paddleCustomerId',
        label: 'Paddle Cust. ID',
        type: 'string',
        listColumn: false,
      },
      {
        key: 'createdAt',
        label: 'Created',
        type: 'datetime',
        listColumn: true,
      },
      {
        key: 'updatedAt',
        label: 'Updated',
        type: 'datetime',
        listColumn: false,
      },
    ],
  },
  {
    key: 'licenses',
    label: 'Licenses',
    readOnly: false,
    searchPlaceholder: 'Search license key, user ID, plan, status…',
    fields: [
      { key: 'id', label: 'ID', type: 'uuid', listColumn: false },
      // licenseKey is IMMUTABLE — never editable, regardless of UI toggles.
      {
        key: 'licenseKey',
        label: 'License Key',
        type: 'string',
        listColumn: true,
        truncate: 280,
      },
      { key: 'userId', label: 'User ID', type: 'uuid', listColumn: true },
      {
        key: 'plan',
        label: 'Plan',
        type: 'string',
        listColumn: true,
        editable: true,
      },
      {
        key: 'status',
        label: 'Status',
        type: 'string',
        listColumn: true,
        editable: true,
      },
      {
        key: 'source',
        label: 'Source',
        type: 'string',
        listColumn: true,
      },
      {
        key: 'expiresAt',
        label: 'Expires',
        type: 'datetime',
        listColumn: true,
        editable: true,
      },
      {
        key: 'createdAt',
        label: 'Created',
        type: 'datetime',
        listColumn: true,
      },
      {
        key: 'createdBy',
        label: 'Created By',
        type: 'string',
        listColumn: false,
      },
    ],
  },
  {
    key: 'subscriptions',
    label: 'Subscriptions',
    // Paddle is the system of record — admin UI is view-only.
    readOnly: true,
    searchPlaceholder:
      'Search Paddle sub ID, customer ID, user ID, status, price…',
    fields: [
      { key: 'id', label: 'ID', type: 'uuid', listColumn: false },
      { key: 'userId', label: 'User ID', type: 'uuid', listColumn: true },
      {
        key: 'paddleSubscriptionId',
        label: 'Paddle Sub ID',
        type: 'string',
        listColumn: true,
      },
      {
        key: 'paddleCustomerId',
        label: 'Paddle Customer',
        type: 'string',
        listColumn: false,
      },
      { key: 'status', label: 'Status', type: 'string', listColumn: true },
      { key: 'priceId', label: 'Price ID', type: 'string', listColumn: true },
      {
        key: 'currentPeriodEnd',
        label: 'Period End',
        type: 'datetime',
        listColumn: true,
      },
      {
        key: 'trialEnd',
        label: 'Trial End',
        type: 'datetime',
        listColumn: true,
      },
      {
        key: 'canceledAt',
        label: 'Canceled At',
        type: 'datetime',
        listColumn: false,
      },
      {
        key: 'createdAt',
        label: 'Created',
        type: 'datetime',
        listColumn: true,
      },
    ],
  },
  {
    key: 'failed-webhooks',
    label: 'Failed Webhooks',
    readOnly: false,
    searchPlaceholder: 'Search event ID, type, error message…',
    fields: [
      { key: 'id', label: 'ID', type: 'uuid', listColumn: false },
      { key: 'eventId', label: 'Event ID', type: 'string', listColumn: true },
      {
        key: 'eventType',
        label: 'Event Type',
        type: 'string',
        listColumn: true,
      },
      {
        key: 'errorMessage',
        label: 'Error',
        type: 'string',
        listColumn: true,
        truncate: 280,
      },
      {
        key: 'retryCount',
        label: 'Retries',
        type: 'number',
        listColumn: true,
      },
      {
        key: 'resolved',
        label: 'Resolved',
        type: 'boolean',
        listColumn: true,
        editable: true,
      },
      {
        key: 'resolvedAt',
        label: 'Resolved At',
        type: 'datetime',
        listColumn: true,
        editable: true,
      },
      {
        key: 'attemptedAt',
        label: 'Attempted',
        type: 'datetime',
        listColumn: true,
      },
      {
        key: 'stackTrace',
        label: 'Stack',
        type: 'string',
        listColumn: false,
      },
      {
        key: 'rawPayload',
        label: 'Payload',
        type: 'json',
        listColumn: false,
      },
    ],
  },
  {
    key: 'trial-reminders',
    label: 'Trial Reminders',
    // Historical audit log — never mutated from the UI.
    readOnly: true,
    searchPlaceholder: 'Search user ID, reminder type, email…',
    fields: [
      { key: 'id', label: 'ID', type: 'uuid', listColumn: false },
      { key: 'userId', label: 'User ID', type: 'uuid', listColumn: true },
      {
        key: 'reminderType',
        label: 'Type',
        type: 'string',
        listColumn: true,
      },
      {
        key: 'emailSentTo',
        label: 'Sent To',
        type: 'string',
        listColumn: true,
      },
      {
        key: 'sentAt',
        label: 'Sent At',
        type: 'datetime',
        listColumn: true,
      },
    ],
  },
  {
    key: 'session-requests',
    label: 'Session Requests',
    readOnly: false,
    searchPlaceholder: 'Search user ID, topic, status, payment, Paddle txn…',
    fields: [
      { key: 'id', label: 'ID', type: 'uuid', listColumn: false },
      { key: 'userId', label: 'User ID', type: 'uuid', listColumn: true },
      {
        key: 'sessionTopicId',
        label: 'Topic',
        type: 'string',
        listColumn: true,
      },
      {
        key: 'isFreeSession',
        label: 'Free?',
        type: 'boolean',
        listColumn: true,
      },
      {
        key: 'status',
        label: 'Status',
        type: 'string',
        listColumn: true,
        editable: true,
      },
      {
        key: 'paymentStatus',
        label: 'Payment',
        type: 'string',
        listColumn: true,
        editable: true,
      },
      {
        key: 'scheduledAt',
        label: 'Scheduled',
        type: 'datetime',
        listColumn: true,
        editable: true,
      },
      {
        key: 'paddleTransactionId',
        label: 'Paddle Txn',
        type: 'string',
        listColumn: false,
      },
      {
        key: 'additionalNotes',
        label: 'Notes',
        type: 'string',
        listColumn: false,
      },
      {
        key: 'createdAt',
        label: 'Created',
        type: 'datetime',
        listColumn: true,
      },
    ],
  },
  {
    key: 'admin-audit-log',
    label: 'Audit Log',
    readOnly: true,
    searchPlaceholder: 'Search actor email, action, target type/id…',
    fields: [
      { key: 'id', label: 'ID', type: 'uuid', listColumn: false },
      { key: 'actorEmail', label: 'Actor', type: 'string', listColumn: true },
      { key: 'action', label: 'Action', type: 'string', listColumn: true },
      {
        key: 'targetType',
        label: 'Target Type',
        type: 'string',
        listColumn: true,
      },
      { key: 'targetId', label: 'Target ID', type: 'uuid', listColumn: true },
      {
        key: 'targetSnapshot',
        label: 'Snapshot',
        type: 'json',
        listColumn: false,
      },
      { key: 'metadata', label: 'Metadata', type: 'json', listColumn: false },
      { key: 'ipAddress', label: 'IP', type: 'string', listColumn: false },
      {
        key: 'userAgent',
        label: 'User Agent',
        type: 'string',
        listColumn: false,
      },
      {
        key: 'createdAt',
        label: 'Created',
        type: 'datetime',
        listColumn: true,
      },
    ],
  },
];
