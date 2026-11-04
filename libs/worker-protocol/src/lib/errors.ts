/**
 * Worker protocol errors and close codes (plan W1, W2, W12).
 *
 * Two rules shape this file:
 *
 * - **Fixed copy.** The `message` of every error that crosses the wire is the
 *   product sentence for its code, taken from {@link WORKER_ERROR_MESSAGES}.
 *   A raw in-process message can contain a path, a provider response or a
 *   token, so it never reaches a client. The worker logs the raw message
 *   locally under a random `ref` and sends only that `ref`.
 * - **Allow-listed detail.** `detail` carries structured fields only, and only
 *   the fields named in {@link WorkerErrorDetailSchema} (plus the handshake
 *   payload for `VERSION_MISMATCH`). `PAIRING_REJECTED` never carries detail,
 *   so every pairing rejection is byte-identical (S4).
 */

import { z } from 'zod';
import { ProtocolRangeSchema } from './version';

/** Every error code a worker may put on the wire (plan W1). */
export const WORKER_ERROR_CODES = [
  'NOT_FOUND_OR_FORBIDDEN',
  'INVALID_PARAMS',
  'TURN_IN_FLIGHT',
  'SESSION_DRIVEN_ELSEWHERE',
  'DRIVER_LOCK_UNAVAILABLE',
  'NO_PROVIDER_READY',
  'WORKER_BUSY',
  'ALREADY_ANSWERED',
  'TRANSCRIPT_UNAVAILABLE',
  'SESSION_LOG_FAILED',
  'VERSION_MISMATCH',
  'PAIRING_REJECTED',
  'INTERNAL',
] as const;

export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

export const WorkerErrorCodeSchema = z.enum(WORKER_ERROR_CODES);

export function isWorkerErrorCode(value: unknown): value is WorkerErrorCode {
  return WorkerErrorCodeSchema.safeParse(value).success;
}

/**
 * The only text a client ever receives as an error message. Each sentence says
 * what happened and what to do next (design-spec section 6), and none names
 * the machine: the client adds that context. The pairing sentence does not say
 * whether the code was wrong, expired or used, or whether a window was open.
 */
export const WORKER_ERROR_MESSAGES: Readonly<Record<WorkerErrorCode, string>> =
  {
    NOT_FOUND_OR_FORBIDDEN:
      'The item was not found, or the access granted on this machine does not include it. Check the access list on the machine.',
    INVALID_PARAMS:
      'The request was not understood. Update Ptah on both machines and try again.',
    TURN_IN_FLIGHT:
      'This session is still working on the previous message. Wait for it to finish or stop it, then send again.',
    SESSION_DRIVEN_ELSEWHERE:
      'Another Ptah app is using this session right now. Wait until it finishes, then try again.',
    DRIVER_LOCK_UNAVAILABLE:
      'This machine could not confirm that no one else is using this session, so it will not start or send anything. Try again, and if it keeps happening check the Ptah log on the machine.',
    NO_PROVIDER_READY:
      'No AI provider is signed in on this machine. Sign in on the machine, then try again.',
    WORKER_BUSY:
      'This machine is already running as many sessions as it allows. Wait for one to finish, then try again.',
    ALREADY_ANSWERED:
      'This request was already answered. The session continues with that answer.',
    TRANSCRIPT_UNAVAILABLE:
      'The transcript of this session could not be read. Check the Ptah log on the machine.',
    SESSION_LOG_FAILED:
      'This machine could not record the session, so it stopped it. Restart the Ptah worker on the machine, then continue.',
    VERSION_MISMATCH:
      'This app and the machine use incompatible Ptah versions. Update Ptah so both sides match, then connect again.',
    PAIRING_REJECTED:
      'The code was not accepted. It may be wrong, expired or already used. Check the pairing window on the machine and try again.',
    INTERNAL:
      'Something went wrong on the machine. Try again, and if it keeps happening check the Ptah log on the machine.',
  };

/**
 * `VERSION_MISMATCH` detail (plan W2): the worker's range and Ptah version,
 * and the client's own `hello` echoed back (its range, name and version).
 */
export const VersionMismatchDetailSchema = z.object({
  worker: z.object({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
    ptahVersion: z.string().min(1).max(64),
  }),
  client: z.object({
    protocol: ProtocolRangeSchema,
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
  }),
});

export type VersionMismatchDetail = z.infer<typeof VersionMismatchDetailSchema>;

/**
 * Allow-listed structured detail (plan W12): `holder.label`, `turnId`,
 * `providerId`, `sessionId`. Unknown keys are stripped by the schema, so a
 * holder's pid or hostname cannot leak through `detail`.
 */
export const WorkerErrorDetailSchema = z.object({
  holder: z.object({ label: z.string().max(256) }).optional(),
  turnId: z.string().max(128).optional(),
  providerId: z.string().max(128).optional(),
  sessionId: z.string().max(256).optional(),
});

export type WorkerErrorDetail = z.infer<typeof WorkerErrorDetailSchema>;

export const WorkerErrorSchema = z.object({
  code: WorkerErrorCodeSchema,
  message: z.string().max(1024),
  ref: z.string().min(1).max(64).optional(),
  detail: z.unknown().optional(),
});

export type WorkerError = z.infer<typeof WorkerErrorSchema>;

export interface WorkerErrorOptions {
  /** Random reference under which the worker logged the raw cause. */
  readonly ref?: string;
  /** Structured detail; filtered through the allow list for the code. */
  readonly detail?: unknown;
}

/**
 * Keep only the detail a code may carry. Returns `undefined` when nothing
 * allowed is left, so the wire never carries an empty `detail: {}`.
 */
export function sanitizeErrorDetail(
  code: WorkerErrorCode,
  detail: unknown,
): WorkerErrorDetail | VersionMismatchDetail | undefined {
  if (detail === undefined || code === 'PAIRING_REJECTED') {
    return undefined;
  }
  if (code === 'VERSION_MISMATCH') {
    const parsed = VersionMismatchDetailSchema.safeParse(detail);
    return parsed.success ? parsed.data : undefined;
  }
  const parsed = WorkerErrorDetailSchema.safeParse(detail);
  if (!parsed.success) {
    return undefined;
  }
  const kept = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as WorkerErrorDetail;
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Build the error object for a `res` frame: fixed copy for the code, an
 * optional `ref`, and allow-listed detail. `PAIRING_REJECTED` drops both `ref`
 * and `detail` so that all rejections are identical on the wire.
 */
export function workerError(
  code: WorkerErrorCode,
  options: WorkerErrorOptions = {},
): WorkerError {
  const error: WorkerError = { code, message: WORKER_ERROR_MESSAGES[code] };
  if (code === 'PAIRING_REJECTED') {
    return error;
  }
  if (options.ref !== undefined) {
    error.ref = options.ref;
  }
  const detail = sanitizeErrorDetail(code, options.detail);
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
}

/**
 * WebSocket close codes (plan W1). `reason` is the short machine-readable
 * string sent with the close frame; it never contains user data.
 */
export const WORKER_CLOSE_CODES = {
  PROTOCOL_ERROR: 4400,
  NOT_AUTHENTICATED: 4401,
  METHOD_NOT_ALLOWED: 4403,
  VERSION_MISMATCH: 4409,
  REVOKED: 4410,
  THROTTLED: 4429,
} as const;

export type WorkerCloseCode =
  (typeof WORKER_CLOSE_CODES)[keyof typeof WORKER_CLOSE_CODES];

export const WORKER_CLOSE_REASONS: Readonly<Record<WorkerCloseCode, string>> = {
  4400: 'protocol-error',
  4401: 'not-authenticated',
  4403: 'method-not-allowed',
  4409: 'version-mismatch',
  4410: 'revoked',
  4429: 'throttled',
};

export interface WorkerClose {
  readonly code: WorkerCloseCode;
  readonly reason: string;
}

export function workerClose(code: WorkerCloseCode): WorkerClose {
  return { code, reason: WORKER_CLOSE_REASONS[code] };
}

export function isWorkerCloseCode(value: unknown): value is WorkerCloseCode {
  return (
    typeof value === 'number' &&
    Object.prototype.hasOwnProperty.call(WORKER_CLOSE_REASONS, value)
  );
}
