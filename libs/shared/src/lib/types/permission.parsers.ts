/**
 * Zod-free parsers for the two permission-surface payloads that the webview
 * validates at its `postMessage` receive point.
 *
 * Exact runtime twins of `PermissionRequestSchema` and
 * `AskUserQuestionRequestSchema` in `./permission.schemas.ts` — same accept
 * set, same reject set, same `safeParse(...).data` value. Equivalence is
 * proven by `permission.parsers.spec.ts`, which runs both implementations
 * over a shared corpus.
 *
 * Note the deliberate asymmetry inherited from the schemas: `id` is validated
 * with Zod's version-agnostic `.uuid()`, while `sessionId` and `tabId` are
 * validated with the v4-only `UUID_REGEX`. That is not a mistake in either
 * implementation — see `isWireUuid` in `./wire-guards.internal`.
 *
 * See TASK_2026_187 Unit 10 for why the frontend no longer ships Zod.
 */

import { UUID_REGEX } from './branded.types';
import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from './permission.types';
import {
  isNonEmptyWireString,
  isWireBoolean,
  isWireNumber,
  isWireObject,
  isWireString,
  isWireUuid,
  parseWireRecord,
  readOptional,
} from './wire-guards.internal';

/** Mirrors `z.string().refine((v) => UUID_REGEX.test(v))` — v4 UUIDs only. */
function isUuidV4String(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Mirrors `PermissionRequestSchema`.
 *
 * Property assignment follows the schema's declaration order so that
 * `Object.keys(...)` on the result matches Zod's output exactly, including
 * the two optionals (`toolUseId`, `agentToolCallId`) that sit mid-shape.
 */
export function parsePermissionRequest(
  payload: unknown,
): PermissionRequest | null {
  if (!isWireObject(payload)) return null;
  if (!isWireUuid(payload['id'])) return null;
  if (!isNonEmptyWireString(payload['toolName'])) return null;
  const toolInput = parseWireRecord(payload['toolInput']);
  if (toolInput === null) return null;

  const out: Record<string, unknown> = {
    id: payload['id'],
    toolName: payload['toolName'],
    toolInput,
  };

  if (
    !readOptional(payload, 'toolUseId', isWireString, (v) => {
      out['toolUseId'] = v;
    })
  ) {
    return null;
  }
  if (
    !readOptional(payload, 'agentToolCallId', isWireString, (v) => {
      out['agentToolCallId'] = v;
    })
  ) {
    return null;
  }

  if (!isWireNumber(payload['timestamp'])) return null;
  if (!isWireString(payload['description'])) return null;
  if (!isWireNumber(payload['timeoutAt'])) return null;
  out['timestamp'] = payload['timestamp'];
  out['description'] = payload['description'];
  out['timeoutAt'] = payload['timeoutAt'];

  if (
    !readOptional(payload, 'sessionId', isUuidV4String, (v) => {
      out['sessionId'] = v;
    })
  ) {
    return null;
  }
  if (
    !readOptional(payload, 'tabId', isUuidV4String, (v) => {
      out['tabId'] = v;
    })
  ) {
    return null;
  }
  if (
    !readOptional(payload, 'surfaceMode', isWireBoolean, (v) => {
      out['surfaceMode'] = v;
    })
  ) {
    return null;
  }

  return out as unknown as PermissionRequest;
}

/**
 * Mirrors `AskUserQuestionRequestSchema`.
 *
 * `questions` is `z.array(z.unknown())`: every element is accepted as-is, but
 * Zod returns a fresh array, so this copies rather than aliasing the input.
 * The array is **not** frozen — the schema has no `.readonly()`.
 */
export function parseAskUserQuestionRequest(
  payload: unknown,
): AskUserQuestionRequest | null {
  if (!isWireObject(payload)) return null;
  if (!isWireUuid(payload['id'])) return null;
  if (payload['toolName'] !== 'AskUserQuestion') return null;
  const rawQuestions = payload['questions'];
  if (!Array.isArray(rawQuestions)) return null;

  const out: Record<string, unknown> = {
    id: payload['id'],
    toolName: payload['toolName'],
    questions: [...rawQuestions],
  };

  if (
    !readOptional(payload, 'toolUseId', isWireString, (v) => {
      out['toolUseId'] = v;
    })
  ) {
    return null;
  }

  if (!isWireNumber(payload['timestamp'])) return null;
  if (!isWireNumber(payload['timeoutAt'])) return null;
  out['timestamp'] = payload['timestamp'];
  out['timeoutAt'] = payload['timeoutAt'];

  if (
    !readOptional(payload, 'sessionId', isUuidV4String, (v) => {
      out['sessionId'] = v;
    })
  ) {
    return null;
  }
  if (
    !readOptional(payload, 'tabId', isUuidV4String, (v) => {
      out['tabId'] = v;
    })
  ) {
    return null;
  }
  if (
    !readOptional(payload, 'surfaceMode', isWireBoolean, (v) => {
      out['surfaceMode'] = v;
    })
  ) {
    return null;
  }

  return out as unknown as AskUserQuestionRequest;
}
