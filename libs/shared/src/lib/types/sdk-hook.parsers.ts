/**
 * Zod-free parsers for the four SDK hook payloads that the webview validates
 * at its `postMessage` receive point.
 *
 * Each parser is the exact runtime twin of the schema of the same name in
 * `./sdk-hook.schemas.ts`: it accepts precisely what the schema accepts,
 * rejects precisely what the schema rejects, and returns precisely the value
 * the schema's `safeParse(...).data` would return (unknown keys stripped,
 * arrays frozen, key order preserved).
 *
 * That equivalence is **proven, not asserted** —
 * `wire-parsers.equivalence.spec.ts` runs both implementations over a shared
 * corpus and fails on any divergence.
 * The schemas remain the source of truth and are still used by the backend;
 * these exist so the frontend can enforce the same contract without pulling
 * the 304 kB Zod runtime into the initial bundle (TASK_2026_187 Unit 10).
 *
 * If you change a schema, change its parser and the corpus in the same edit.
 */

import type {
  SdkAssistantMessageError,
  SdkBackgroundTaskSummary,
  SdkCompactionCompletePayload,
  SdkSessionCronSummary,
  SdkSubagentEndedPayload,
  SdkTerminalReason,
  SdkTurnEndedPayload,
  SdkTurnFailedPayload,
} from './sdk-hook.types';
import {
  isNonEmptyWireString,
  isWireBoolean,
  isWireObject,
  isWireString,
  isWireTimestamp,
  parseWireReadonlyArray,
  readOptional,
  wireLiteralUnion,
} from './wire-guards.internal';

/** Mirrors `SdkTerminalReasonSchema`. */
const isTerminalReason = wireLiteralUnion([
  'blocking_limit',
  'rapid_refill_breaker',
  'prompt_too_long',
  'image_error',
  'model_error',
  'aborted_streaming',
  'aborted_tools',
  'stop_hook_prevented',
  'hook_stopped',
  'tool_deferred',
  'max_turns',
  'completed',
] as const) as (value: unknown) => value is SdkTerminalReason;

/** Mirrors `SdkAssistantMessageErrorSchema`. */
const isAssistantMessageError = wireLiteralUnion([
  'authentication_failed',
  'oauth_org_not_allowed',
  'billing_error',
  'rate_limit',
  'invalid_request',
  'model_not_found',
  'server_error',
  'unknown',
  'max_output_tokens',
] as const) as (value: unknown) => value is SdkAssistantMessageError;

/** Mirrors `<schema>.nullable()` over a literal union. */
function isNullableTerminalReason(
  value: unknown,
): value is SdkTerminalReason | null {
  return value === null || isTerminalReason(value);
}

/** Mirrors `z.string().nullable()`. */
function isNullableWireString(value: unknown): value is string | null {
  return value === null || isWireString(value);
}

/** Mirrors `SdkBackgroundTaskSummarySchema`. */
export function parseSdkBackgroundTaskSummary(
  payload: unknown,
): SdkBackgroundTaskSummary | null {
  if (!isWireObject(payload)) return null;
  if (!isWireString(payload['id'])) return null;
  if (!isWireString(payload['type'])) return null;
  if (!isWireString(payload['status'])) return null;
  if (!isWireString(payload['description'])) return null;

  const out: Record<string, unknown> = {
    id: payload['id'],
    type: payload['type'],
    status: payload['status'],
    description: payload['description'],
  };
  const ok = readOptional(payload, 'command', isWireString, (v) => {
    out['command'] = v;
  });
  if (!ok) return null;
  return out as unknown as SdkBackgroundTaskSummary;
}

/** Mirrors `SdkSessionCronSummarySchema`. */
export function parseSdkSessionCronSummary(
  payload: unknown,
): SdkSessionCronSummary | null {
  if (!isWireObject(payload)) return null;
  if (!isWireString(payload['id'])) return null;
  if (!isWireString(payload['schedule'])) return null;
  if (!isWireBoolean(payload['recurring'])) return null;
  if (!isWireString(payload['prompt'])) return null;
  return {
    id: payload['id'],
    schedule: payload['schedule'],
    recurring: payload['recurring'],
    prompt: payload['prompt'],
  };
}

/** Mirrors `SdkCompactionCompletePayloadSchema`. */
export function parseSdkCompactionCompletePayload(
  payload: unknown,
): SdkCompactionCompletePayload | null {
  if (!isWireObject(payload)) return null;
  if (!isNonEmptyWireString(payload['sessionId'])) return null;
  if (!isNonEmptyWireString(payload['cwd'])) return null;
  const trigger = payload['trigger'];
  if (trigger !== 'manual' && trigger !== 'auto') return null;
  if (!isWireString(payload['compactSummary'])) return null;
  if (!isWireTimestamp(payload['timestamp'])) return null;
  return {
    sessionId: payload['sessionId'],
    cwd: payload['cwd'],
    trigger,
    compactSummary: payload['compactSummary'],
    timestamp: payload['timestamp'],
  };
}

/** Mirrors `SdkTurnEndedPayloadSchema`. */
export function parseSdkTurnEndedPayload(
  payload: unknown,
): SdkTurnEndedPayload | null {
  if (!isWireObject(payload)) return null;
  if (!isNonEmptyWireString(payload['sessionId'])) return null;
  if (!isNonEmptyWireString(payload['cwd'])) return null;
  if (!isNullableWireString(payload['lastAssistantMessage'])) return null;
  const backgroundTasks = parseWireReadonlyArray(
    payload['backgroundTasks'],
    parseSdkBackgroundTaskSummary,
  );
  if (backgroundTasks === null) return null;
  const sessionCrons = parseWireReadonlyArray(
    payload['sessionCrons'],
    parseSdkSessionCronSummary,
  );
  if (sessionCrons === null) return null;
  if (!isNullableTerminalReason(payload['terminalReason'])) return null;
  if (!isWireTimestamp(payload['timestamp'])) return null;
  return {
    sessionId: payload['sessionId'],
    cwd: payload['cwd'],
    lastAssistantMessage: payload['lastAssistantMessage'],
    backgroundTasks,
    sessionCrons,
    terminalReason: payload['terminalReason'],
    timestamp: payload['timestamp'],
  };
}

/** Mirrors `SdkTurnFailedPayloadSchema`. */
export function parseSdkTurnFailedPayload(
  payload: unknown,
): SdkTurnFailedPayload | null {
  if (!isWireObject(payload)) return null;
  if (!isNonEmptyWireString(payload['sessionId'])) return null;
  if (!isNonEmptyWireString(payload['cwd'])) return null;
  if (!isNullableWireString(payload['lastAssistantMessage'])) return null;
  if (!isAssistantMessageError(payload['error'])) return null;
  if (!isNullableWireString(payload['errorDetails'])) return null;
  if (!isNullableTerminalReason(payload['terminalReason'])) return null;
  if (!isWireTimestamp(payload['timestamp'])) return null;
  return {
    sessionId: payload['sessionId'],
    cwd: payload['cwd'],
    lastAssistantMessage: payload['lastAssistantMessage'],
    error: payload['error'],
    errorDetails: payload['errorDetails'],
    terminalReason: payload['terminalReason'],
    timestamp: payload['timestamp'],
  };
}

/**
 * Mirrors `<schema>.optional().catch(undefined)` on an object property.
 *
 * The difference from {@link readOptional} is the failure posture, and it is
 * the whole point: an invalid value on a present key is NOT fatal to the
 * payload. Zod's contract, verified against zod 4.3.6:
 * - key absent from input → key absent from output
 * - key present, value valid → key present with that value
 * - key present, value `undefined` or invalid → key present with `undefined`
 *
 * There is no counterpart in `wire-guards.internal.ts` because
 * `SdkSubagentEndedPayloadSchema` is the only schema using the combinator.
 * Promote it there when a second schema needs it.
 */
function readOptionalCaught<T>(
  source: Record<string, unknown>,
  key: string,
  check: (value: unknown) => value is T,
  assign: (value: T | undefined) => void,
): void {
  if (!(key in source)) return;
  const raw = source[key];
  assign(check(raw) ? raw : undefined);
}

/** Mirrors `SdkSubagentEndedPayloadSchema`. */
export function parseSdkSubagentEndedPayload(
  payload: unknown,
): SdkSubagentEndedPayload | null {
  if (!isWireObject(payload)) return null;
  if (!isNonEmptyWireString(payload['sessionId'])) return null;
  if (!isNonEmptyWireString(payload['cwd'])) return null;
  if (!isNonEmptyWireString(payload['agentId'])) return null;
  if (!isNonEmptyWireString(payload['agentType'])) return null;
  if (!isNullableWireString(payload['lastAssistantMessage'])) return null;
  const backgroundTasks = parseWireReadonlyArray(
    payload['backgroundTasks'],
    parseSdkBackgroundTaskSummary,
  );
  if (backgroundTasks === null) return null;
  if (!isWireTimestamp(payload['timestamp'])) return null;
  const out: Record<string, unknown> = {
    sessionId: payload['sessionId'],
    cwd: payload['cwd'],
    agentId: payload['agentId'],
    agentType: payload['agentType'],
  };
  readOptionalCaught(payload, 'toolCallId', isNonEmptyWireString, (v) => {
    out['toolCallId'] = v;
  });
  out['lastAssistantMessage'] = payload['lastAssistantMessage'];
  out['backgroundTasks'] = backgroundTasks;
  out['timestamp'] = payload['timestamp'];
  return out as unknown as SdkSubagentEndedPayload;
}
