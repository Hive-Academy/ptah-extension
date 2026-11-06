/**
 * Worker method table: names, params and results (plan W2, W3, W5, W6).
 *
 * Three groups, by the connection state that may call them:
 *
 * - {@link PRE_AUTH_METHODS} — the only names accepted before
 *   authentication. Any other name closes 4403 without a handler (W2).
 * - {@link REMOTE_METHODS} — a paired client's methods after `auth { token }`.
 *   Resource checks against the token's grant happen in the worker (W6).
 * - {@link ADMIN_METHODS} — the local operator's methods after
 *   `auth { admin }` (W5): open the pairing window, list and extend grants,
 *   and read the worker's status. An admin connection may call nothing else.
 *
 * Params schemas are strict: an unknown key is `INVALID_PARAMS`, so a client
 * cannot smuggle options a worker silently ignores. Result schemas strip
 * unknown keys, so a client tolerates additive fields from the worker.
 *
 * Secrets have no format check here. A token, admin key or pairing code that
 * is malformed must take the same path as one that is wrong (W3, W4), so the
 * schemas accept any bounded string and the worker decides.
 */

import { z } from 'zod';
import { FlatStreamEventSchema } from './frames';
import {
  PAIRING_CODE_INPUT_MAX_LENGTH,
  PAIRING_TTL_MAX_SEC,
  PAIRING_TTL_MIN_SEC,
} from './pairing-code';
import { ProtocolRangeSchema } from './version';

const IdSchema = z.string().min(1).max(256);
const SecretSchema = z.string().min(1).max(512);
const EmptyParamsSchema = z.strictObject({});
const EmptyResultSchema = z.object({});

/** Who is connecting, as sent in `hello` (W2). */
export const ClientIdentitySchema = z.object({
  name: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
});

export type ClientIdentity = z.infer<typeof ClientIdentitySchema>;

/** Workspaces a token may use on one machine (W4 grant). */
export const WorkerGrantSchema = z.object({
  machineId: IdSchema,
  workspaceIds: z.array(IdSchema),
});

export type WorkerGrant = z.infer<typeof WorkerGrantSchema>;

export const WorkerIdentitySchema = z.object({
  machineId: IdSchema,
  displayName: z.string().min(1).max(256),
  ptahVersion: z.string().min(1).max(64),
});

export type WorkerIdentity = z.infer<typeof WorkerIdentitySchema>;

/** One readiness check row, as the worker's doctor reports it (C6). */
export const ReadinessCheckSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(256),
  status: z.enum(['pass', 'warn', 'fail']),
  detail: z.string().max(2048).optional(),
  fix: z.string().max(2048).optional(),
});

export const ReadinessReportSchema = z.object({
  ready: z.boolean(),
  checks: z.array(ReadinessCheckSchema),
});

export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;

/** Which process drives a session now. Only the kind and label leave the worker. */
export const SessionDriverSchema = z.object({
  kind: z.enum(['desktop', 'worker', 'cli']),
  label: z.string().min(1).max(256),
});

export const REMOTE_SESSION_STATES = [
  'running',
  'idle',
  'interrupted',
] as const;

export const RemoteSessionSummarySchema = z.object({
  sessionId: IdSchema,
  title: z.string().max(1024),
  state: z.enum(REMOTE_SESSION_STATES),
  driver: SessionDriverSchema.optional(),
  updatedAt: z.number(),
  provider: z.string().min(1).max(128),
  logged: z.boolean(),
});

export const RemoteWorkspaceSchema = z.object({
  workspaceId: IdSchema,
  name: z.string().max(512),
  path: z.string().min(1).max(4096),
});

export type SessionDriver = z.infer<typeof SessionDriverSchema>;
export type RemoteSessionState = (typeof REMOTE_SESSION_STATES)[number];
export type RemoteSessionSummary = z.infer<typeof RemoteSessionSummarySchema>;
export type RemoteWorkspace = z.infer<typeof RemoteWorkspaceSchema>;

// ---------------------------------------------------------------------------
// Pre-authentication methods (W2, W3, W4, W5).
// ---------------------------------------------------------------------------

const HelloParamsSchema = z.strictObject({
  protocol: ProtocolRangeSchema,
  client: ClientIdentitySchema,
});

const HelloResultSchema = z.object({
  protocol: z.number().int().min(1),
  worker: WorkerIdentitySchema,
  /** Fresh per connection; the admin channel answers it in `auth`. */
  adminChallenge: z.string().min(16).max(128).optional(),
});

const PairExchangeParamsSchema = z.strictObject({
  code: z.string().min(1).max(PAIRING_CODE_INPUT_MAX_LENGTH),
  clientName: z.string().min(1).max(128),
});

const PairExchangeResultSchema = z.object({
  token: SecretSchema,
  tokenId: IdSchema,
  grant: WorkerGrantSchema,
});

const AuthParamsSchema = z.union([
  z.strictObject({ token: SecretSchema }),
  /**
   * HMAC-SHA256(adminKey, adminChallenge + context), base64url. The admin key
   * itself never goes on the wire.
   */
  z.strictObject({ adminProof: SecretSchema }),
]);

const AuthResultSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('client'),
    tokenId: IdSchema,
    grant: WorkerGrantSchema,
  }),
  z.object({ role: z.literal('admin') }),
]);

// ---------------------------------------------------------------------------
// Remote methods (W6).
// ---------------------------------------------------------------------------

const MachineInfoResultSchema = WorkerIdentitySchema.extend({
  protocol: z.number().int().min(1),
  grant: WorkerGrantSchema,
  readiness: ReadinessReportSchema,
});

const SessionAttachParamsSchema = z.strictObject({
  sessionId: IdSchema,
  afterSeq: z.number().int().min(0).optional(),
  epoch: z.string().min(1).max(64).optional(),
});

const SessionAttachResultSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('log'),
    epoch: z.string().min(1).max(64),
    fromSeq: z.number().int().min(0),
    headSeq: z.number().int().min(0),
  }),
  z.object({
    mode: z.literal('snapshot'),
    events: z.array(FlatStreamEventSchema),
    live: z.literal(false),
    /** Holder label when another process drives the session now (W8 case 3). */
    drivenBy: z.string().min(1).max(256).optional(),
  }),
]);

const PromptSchema = z.string().min(1).max(200_000);

const PermissionRespondParamsSchema = z.strictObject({
  sessionId: IdSchema,
  requestId: IdSchema,
  // Phase 1 offers allow and deny only; `always_allow` is INVALID_PARAMS (design D4).
  decision: z.enum(['allow', 'deny']),
  reason: z.string().max(2048).optional(),
});

// ---------------------------------------------------------------------------
// Admin methods (W3, W5).
// ---------------------------------------------------------------------------

const AdminPairingOpenParamsSchema = z.strictObject({
  /** Subset of registered workspaces (id or path); omitted = all registered now. */
  workspaces: z.array(z.string().min(1).max(4096)).min(1).optional(),
  ttlSeconds: z
    .number()
    .int()
    .min(PAIRING_TTL_MIN_SEC)
    .max(PAIRING_TTL_MAX_SEC)
    .optional(),
});

const AdminPairingOpenResultSchema = z.object({
  code: z.string().min(1).max(16),
  expiresAt: z.number(),
  workspaces: z.array(RemoteWorkspaceSchema),
});

/**
 * One paired client as the operator sees it (W4 store row without
 * `secretHash`). The token secret never leaves the worker's store.
 */
export const TokenGrantSummarySchema = z.object({
  tokenId: IdSchema,
  clientName: z.string().min(1).max(128),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  grant: WorkerGrantSchema,
  revokedAt: z.number().optional(),
});

export type TokenGrantSummary = z.infer<typeof TokenGrantSummarySchema>;

const AdminGrantsAddParamsSchema = z.strictObject({
  tokenId: IdSchema,
  /** Registered workspaces to add (id or path), as `ptah worker grants add`. */
  workspaces: z.array(z.string().min(1).max(4096)).min(1),
});

const AdminGrantsRevokeParamsSchema = z.strictObject({ tokenId: IdSchema });

const AdminGrantsRevokeResultSchema = z.object({
  tokenId: IdSchema,
  revokedAt: z.number(),
  /** Live connections of the token the worker closed with REVOKED. */
  connectionsClosed: z.number().int().min(0),
});

const AdminWorkspaceAddParamsSchema = z.strictObject({
  /** Absolute path; the worker registers its `realpath`. */
  path: z.string().min(1).max(4096),
});

const AdminWorkspaceRemoveParamsSchema = z.strictObject({
  /** Registered workspace ID or path. */
  workspace: z.string().min(1).max(4096),
});

/**
 * Pairing window state for the SSH-authenticated `ptah worker status --json`
 * (W3). The unauthenticated protocol never carries this.
 */
export const PairingWindowStateSchema = z.discriminatedUnion('open', [
  z.object({
    open: z.literal(true),
    expiresAt: z.number(),
    attemptsLeft: z.number().int().min(0),
  }),
  z.object({ open: z.literal(false) }),
]);

export type PairingWindowState = z.infer<typeof PairingWindowStateSchema>;

/** One driver lock this worker process holds (W10 `held()`). */
export const HeldLockSchema = z.object({
  sessionId: IdSchema,
  state: z.enum(['held', 'releasing', 'stranded']),
  label: z.string().max(256),
  acquiredAt: z.number(),
});

export type HeldLock = z.infer<typeof HeldLockSchema>;

const AdminStatusResultSchema = WorkerIdentitySchema.extend({
  protocol: z.number().int().min(1),
  readiness: ReadinessReportSchema,
  pairing: PairingWindowStateSchema,
  grants: z.array(TokenGrantSummarySchema),
  locks: z.array(HeldLockSchema),
});

export type AdminStatus = z.infer<typeof AdminStatusResultSchema>;

// ---------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------

export const WORKER_METHOD_SCHEMAS = {
  hello: { params: HelloParamsSchema, result: HelloResultSchema },
  'pair.exchange': {
    params: PairExchangeParamsSchema,
    result: PairExchangeResultSchema,
  },
  auth: { params: AuthParamsSchema, result: AuthResultSchema },

  'machine.info': {
    params: EmptyParamsSchema,
    result: MachineInfoResultSchema,
  },
  'workspaces.list': {
    params: EmptyParamsSchema,
    result: z.array(RemoteWorkspaceSchema),
  },
  'sessions.list': {
    params: z.strictObject({ workspaceId: IdSchema }),
    result: z.array(RemoteSessionSummarySchema),
  },
  'session.attach': {
    params: SessionAttachParamsSchema,
    result: SessionAttachResultSchema,
  },
  'session.detach': {
    params: z.strictObject({ sessionId: IdSchema }),
    result: EmptyResultSchema,
  },
  'session.start': {
    params: z.strictObject({
      workspaceId: IdSchema,
      prompt: PromptSchema,
      name: z.string().min(1).max(256).optional(),
    }),
    result: z.object({ sessionId: IdSchema, turnId: IdSchema }),
  },
  'session.continue': {
    params: z.strictObject({ sessionId: IdSchema, prompt: PromptSchema }),
    // `queued` is set when the local backend enqueued the prompt (W12 step 5).
    result: z.object({ turnId: IdSchema, queued: z.literal(true).optional() }),
  },
  'session.stop': {
    params: z.strictObject({ sessionId: IdSchema }),
    result: z.object({ stopped: z.boolean() }),
  },
  'permission.respond': {
    params: PermissionRespondParamsSchema,
    result: z.object({ applied: z.literal(true) }),
  },
  'token.revokeSelf': { params: EmptyParamsSchema, result: EmptyResultSchema },

  'admin.pairing.open': {
    params: AdminPairingOpenParamsSchema,
    result: AdminPairingOpenResultSchema,
  },
  'admin.grants.list': {
    params: EmptyParamsSchema,
    result: z.array(TokenGrantSummarySchema),
  },
  'admin.grants.add': {
    params: AdminGrantsAddParamsSchema,
    result: z.object({ tokenId: IdSchema, grant: WorkerGrantSchema }),
  },
  'admin.grants.revoke': {
    params: AdminGrantsRevokeParamsSchema,
    result: AdminGrantsRevokeResultSchema,
  },
  'admin.workspace.add': {
    params: AdminWorkspaceAddParamsSchema,
    result: RemoteWorkspaceSchema,
  },
  'admin.workspace.remove': {
    params: AdminWorkspaceRemoveParamsSchema,
    result: RemoteWorkspaceSchema,
  },
  'admin.status': {
    params: EmptyParamsSchema,
    result: AdminStatusResultSchema,
  },
} as const satisfies Record<string, { params: z.ZodType; result: z.ZodType }>;

export type WorkerMethod = keyof typeof WORKER_METHOD_SCHEMAS;

export type WorkerMethodParams<M extends WorkerMethod> = z.infer<
  (typeof WORKER_METHOD_SCHEMAS)[M]['params']
>;

export type WorkerMethodResult<M extends WorkerMethod> = z.infer<
  (typeof WORKER_METHOD_SCHEMAS)[M]['result']
>;

export const PRE_AUTH_METHODS = [
  'hello',
  'pair.exchange',
  'auth',
] as const satisfies readonly WorkerMethod[];

export const REMOTE_METHODS = [
  'machine.info',
  'workspaces.list',
  'sessions.list',
  'session.attach',
  'session.detach',
  'session.start',
  'session.continue',
  'session.stop',
  'permission.respond',
  'token.revokeSelf',
] as const satisfies readonly WorkerMethod[];

export const ADMIN_METHODS = [
  'admin.pairing.open',
  'admin.grants.list',
  'admin.grants.add',
  'admin.grants.revoke',
  'admin.workspace.add',
  'admin.workspace.remove',
  'admin.status',
] as const satisfies readonly WorkerMethod[];

export type PreAuthMethod = (typeof PRE_AUTH_METHODS)[number];
export type RemoteMethod = (typeof REMOTE_METHODS)[number];
export type AdminMethod = (typeof ADMIN_METHODS)[number];

const PRE_AUTH_SET: ReadonlySet<string> = new Set(PRE_AUTH_METHODS);
const REMOTE_SET: ReadonlySet<string> = new Set(REMOTE_METHODS);
const ADMIN_SET: ReadonlySet<string> = new Set(ADMIN_METHODS);

export function isWorkerMethod(value: unknown): value is WorkerMethod {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(WORKER_METHOD_SCHEMAS, value)
  );
}

export function isPreAuthMethod(value: unknown): value is PreAuthMethod {
  return typeof value === 'string' && PRE_AUTH_SET.has(value);
}

export function isRemoteMethod(value: unknown): value is RemoteMethod {
  return typeof value === 'string' && REMOTE_SET.has(value);
}

export function isAdminMethod(value: unknown): value is AdminMethod {
  return typeof value === 'string' && ADMIN_SET.has(value);
}

export type MethodParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'INVALID_PARAMS' };

/**
 * Validate params for a method name taken off the wire. An unknown method and
 * bad params give the same `INVALID_PARAMS` answer, and no handler runs (W6).
 */
export function parseMethodParams(
  method: string,
  params: unknown,
): MethodParse<unknown> {
  if (!isWorkerMethod(method)) {
    return { ok: false, code: 'INVALID_PARAMS' };
  }
  const parsed = WORKER_METHOD_SCHEMAS[method].params.safeParse(params);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, code: 'INVALID_PARAMS' };
}

/** Typed variant for a caller that already holds a known method name. */
export function parseParams<M extends WorkerMethod>(
  method: M,
  params: unknown,
): MethodParse<WorkerMethodParams<M>> {
  const parsed = WORKER_METHOD_SCHEMAS[method].params.safeParse(params);
  return parsed.success
    ? { ok: true, value: parsed.data as WorkerMethodParams<M> }
    : { ok: false, code: 'INVALID_PARAMS' };
}

/**
 * Validate a worker's result on the client. A result that does not match is a
 * broken worker, not a user error; the caller reports it as `INTERNAL`.
 */
export function parseResult<M extends WorkerMethod>(
  method: M,
  result: unknown,
):
  | { readonly ok: true; readonly value: WorkerMethodResult<M> }
  | { readonly ok: false } {
  const parsed = WORKER_METHOD_SCHEMAS[method].result.safeParse(result);
  return parsed.success
    ? { ok: true, value: parsed.data as WorkerMethodResult<M> }
    : { ok: false };
}
