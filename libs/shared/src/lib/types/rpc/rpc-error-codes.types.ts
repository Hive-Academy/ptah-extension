/**
 * Single source of truth for the structured RPC error code union.
 *
 * Shared between backend (RpcUserError, RpcHandler) and frontend (ClaudeRpcService)
 * so the two never drift apart. {@link rpcUserErrorCodeSchema} parses a wire
 * value into this union; an unknown code is not a member.
 */
import { z } from 'zod';

export const RPC_USER_ERROR_CODES = [
  'WORKSPACE_NOT_OPEN',
  'UNAUTHORIZED_WORKSPACE',
  'MESSAGE_ID_NOT_FOUND',
  'MODEL_NOT_AVAILABLE',
  'AUTH_REQUIRED',
  'PERSISTENCE_UNAVAILABLE',
  'REVIEW_DISABLED',
  'SESSION_NOT_FOUND',
  /** The session exists but none of its saved folders is open, safe and present. */
  'SESSION_FOLDER_UNAVAILABLE',
  /**
   * A `git:*` call named a root that is not a registered workspace folder
   * and not a live worktree of one (directory absent, listed `prunable`, or
   * git says it is not this repository). Never falls back to the active
   * folder. A timeout or other probe failure is `GIT_ROOT_PROBE_FAILED`.
   */
  'GIT_ROOT_UNAVAILABLE',
  /**
   * The worktree probe did not finish (timeout, queue deadline, spawn or
   * cancellation). The root is not known to be gone; the caller retries.
   */
  'GIT_ROOT_PROBE_FAILED',
  'INVALID_PARAMS',
  'FOLLOW_UP_ID_CONFLICT',
  'TASK_NOT_FOUND',
  'SESSION_ENDED',
  /** Codex already has an operation in progress. */
  'CODEX_BUSY',
  /** A named chat option is unsupported by Codex. */
  'CODEX_UNSUPPORTED_OPTION',
  /** The Codex runtime or session is unavailable. */
  'CODEX_UNAVAILABLE',
  /** The Codex runtime could not complete the requested operation. */
  'CODEX_RUNTIME_FAILED',
  'SEND_TIMEOUT',
  'SESSION_ATTACHED_TO_GATEWAY',
  'OUTPUT_CURSOR_STALE',
  'HISTORY_CURSOR_STALE',
  'HISTORY_UNAVAILABLE',
  'HISTORY_BUSY',
  'HISTORY_TIMEOUT',
  'HISTORY_CANCELLED',
  'HISTORY_NOT_FOUND',
  /** A saved native history page failed protocol validation. */
  'HISTORY_MALFORMED',
  'HISTORY_FAILED',
  /** The connection is the main agent's current driver and cannot be removed. */
  'CONNECTION_IN_USE',
  /**
   * The feature's background-learning switch (`memory.enabled` or
   * `skillSynthesis.enabled`) is off, so a manual run that would do the same
   * model work is refused until the user resumes it.
   */
  'PAUSED',
  /**
   * Another process (the desktop app, a worker or the CLI) holds the
   * session's driver lock, so this one may watch but not drive it.
   */
  'SESSION_DRIVEN_ELSEWHERE',
  /**
   * The session driver lock could not be taken because the platform refused
   * the lock endpoint; turns are refused until it is fixed (readiness check).
   */
  'SESSION_DRIVER_LOCK_UNAVAILABLE',
  /** A `machines:*` call needs a connection the remote machine does not have now. */
  'MACHINE_UNREACHABLE',
  /** The remote worker shares no protocol version with this app. */
  'MACHINE_VERSION_MISMATCH',
  /**
   * The machine, or the workspace or session named on it, is not registered
   * here or is outside the machine's grant. One code for both, so a call
   * cannot probe what exists outside the grant.
   */
  'MACHINE_NOT_FOUND_OR_FORBIDDEN',
  /** The worker refused the pairing code (wrong, expired or window closed). */
  'MACHINE_PAIRING_REJECTED',
] as const;

export type RpcUserErrorCode = (typeof RPC_USER_ERROR_CODES)[number];

export const rpcUserErrorCodeSchema = z.enum(RPC_USER_ERROR_CODES);

/** A wire `errorCode` that is one of {@link RPC_USER_ERROR_CODES}, else undefined. */
export function parseRpcUserErrorCode(
  value: unknown,
): RpcUserErrorCode | undefined {
  const parsed = rpcUserErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
