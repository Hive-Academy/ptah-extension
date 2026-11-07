/**
 * Classifies why a queued continuation was refused (Component 7).
 *
 * Only a refusal the lane can recover from by itself is transient: the
 * manager's `AgentContinueError` with code `busy` (the previous turn has not
 * torn down yet). Every other code — and every error this file does not
 * recognise — is permanent, the safe default: a permanent rejection keeps the
 * body for a manual Retry, while a wrongly-transient one would be re-sent
 * automatically.
 *
 * The error is matched by shape, not `instanceof`, so this file does not import
 * the manager module at runtime (the manager imports the router, which imports
 * this classifier).
 */
import type { AgentContinueErrorCode } from '../agent-process-manager.service';

export type ContinuationFailureReason =
  | 'continuation_transient'
  | 'continuation_rejected';

const KNOWN_CODES: ReadonlySet<string> = new Set<AgentContinueErrorCode>([
  'not_found', 'invalid_params', 'unsupported', 'busy', 'released', 'account_refused', 'unknown',
]);

const TRANSIENT_CODES: ReadonlySet<AgentContinueErrorCode> = new Set<AgentContinueErrorCode>([
  'busy',
]);

function isContinueErrorCode(value: unknown): value is AgentContinueErrorCode {
  return typeof value === 'string' && KNOWN_CODES.has(value);
}

function continueErrorCode(error: unknown): AgentContinueErrorCode | undefined {
  if (!(error instanceof Error) || error.name !== 'AgentContinueError') return undefined;
  if (!('code' in error)) return undefined;
  return isContinueErrorCode(error.code) ? error.code : undefined;
}

export function classifyContinuationFailure(error: unknown): ContinuationFailureReason {
  const code = continueErrorCode(error);
  return code !== undefined && TRANSIENT_CODES.has(code)
    ? 'continuation_transient'
    : 'continuation_rejected';
}
