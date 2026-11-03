import { z } from 'zod';
import {
  string,
  integer,
  json,
  reasoningSummaryTextDelta,
  reasoningTextDelta,
} from './codex-protocol-schemas';
import {
  codexRequestSchemas,
  codexServerRequestSchemas,
  codexNotificationSchemas as methodNotificationSchemas,
} from './codex-protocol-methods';
export {
  codexRequestSchemas,
  codexServerRequestSchemas,
} from './codex-protocol-methods';

// The reasoning delta notifications are registered here, not in
// codex-protocol-methods.ts (outside this batch's file set). Registering them
// removes the two methods from the unmodeled surface; the pinned allowlist
// below keeps the full manifest.
export const codexNotificationSchemas = {
  ...methodNotificationSchemas,
  'item/reasoning/summaryTextDelta': reasoningSummaryTextDelta,
  'item/reasoning/textDelta': reasoningTextDelta,
} as const;

const requests = { ...codexRequestSchemas, ...codexServerRequestSchemas };
export type CodexRequestMethod = keyof typeof requests;
export type CodexNotificationMethod = keyof typeof codexNotificationSchemas;
export type CodexProtocolMethod = CodexRequestMethod | CodexNotificationMethod;
export type CodexRequestParams<M extends CodexRequestMethod> = z.infer<
  (typeof requests)[M]['params']
>;
export type CodexRequestResult<M extends CodexRequestMethod> = z.infer<
  (typeof requests)[M]['result']
>;
export type CodexProtocolErrorCode =
  | 'unknownMethod'
  | 'invalidEnvelope'
  | 'invalidParams'
  | 'invalidResult'
  | 'missingResponseMethod';

const MAX_DIAGNOSTIC_ISSUES = 8;
const MAX_DIAGNOSTIC_PATH_DEPTH = 8;
const MAX_DIAGNOSTIC_SEGMENT_LENGTH = 64;

export interface CodexProtocolIssue {
  readonly path: readonly (string | number)[];
  readonly code: z.core.$ZodIssueCode;
}

function diagnosticPathSegment(segment: PropertyKey): string | number {
  if (typeof segment === 'number') return segment;
  if (
    typeof segment === 'string' &&
    segment.length <= MAX_DIAGNOSTIC_SEGMENT_LENGTH &&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(segment)
  ) {
    return segment;
  }
  return '[redacted]';
}

function classifyDiagnosticPath(
  schema: z.core.$ZodType,
  path: readonly PropertyKey[],
  schemaKeys: Set<number>,
  recordKeys: Set<number>,
  depth = 0,
): void {
  // String segments are retained only when an object schema declares them.
  // A record's key is always redacted, even if another union arm names it.
  if (depth >= Math.min(path.length, MAX_DIAGNOSTIC_PATH_DEPTH)) return;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable)
    return classifyDiagnosticPath(
      schema.unwrap(),
      path,
      schemaKeys,
      recordKeys,
      depth,
    );
  if (schema instanceof z.ZodPipe)
    return classifyDiagnosticPath(
      schema.out,
      path,
      schemaKeys,
      recordKeys,
      depth,
    );
  if (schema instanceof z.ZodUnion) {
    for (const option of schema.options)
      classifyDiagnosticPath(option, path, schemaKeys, recordKeys, depth);
    return;
  }
  if (schema instanceof z.ZodArray) {
    if (typeof path[depth] === 'number')
      classifyDiagnosticPath(
        schema.element,
        path,
        schemaKeys,
        recordKeys,
        depth + 1,
      );
    return;
  }
  if (schema instanceof z.ZodObject) {
    const key = path[depth];
    if (typeof key !== 'string' || !Object.hasOwn(schema.shape, key))
      return;
    const child = schema.shape[key];
    if (child === undefined) return;
    schemaKeys.add(depth);
    classifyDiagnosticPath(child, path, schemaKeys, recordKeys, depth + 1);
    return;
  }
  if (schema instanceof z.ZodRecord) {
    recordKeys.add(depth);
    classifyDiagnosticPath(
      schema.valueType,
      path,
      schemaKeys,
      recordKeys,
      depth + 1,
    );
  }
}

function diagnosticIssues(
  schema: z.ZodType,
  issues: readonly z.core.$ZodIssue[],
): readonly CodexProtocolIssue[] {
  return issues.slice(0, MAX_DIAGNOSTIC_ISSUES).map((issue) => {
    const schemaKeys = new Set<number>();
    const recordKeys = new Set<number>();
    classifyDiagnosticPath(schema, issue.path, schemaKeys, recordKeys);
    return {
      path: issue.path
        .slice(0, MAX_DIAGNOSTIC_PATH_DEPTH)
        .map((segment, index) =>
          recordKeys.has(index) ||
          (typeof segment === 'string' && !schemaKeys.has(index))
            ? '[redacted]'
            : diagnosticPathSegment(segment),
        ),
      code: issue.code,
    };
  });
}

export class CodexProtocolError extends Error {
  constructor(
    readonly code: CodexProtocolErrorCode,
    readonly method?: string,
    readonly issues: readonly CodexProtocolIssue[] = [],
  ) {
    // Do not retain wire payloads, validation values or remote error text.
    super(`Codex protocol validation failed: ${code}`);
    this.name = 'CodexProtocolError';
  }
}

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  code: CodexProtocolErrorCode,
  method?: string,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new CodexProtocolError(
      code,
      method,
      diagnosticIssues(schema, result.error.issues),
    );
  return result.data;
}
function isRequest(method: string): method is CodexRequestMethod {
  return Object.hasOwn(requests, method);
}
function isNotification(method: string): method is CodexNotificationMethod {
  return Object.hasOwn(codexNotificationSchemas, method);
}

// Pinned 0.165.0 ServerNotification methods; specs compare this surface with both artifacts.
const pinnedServerNotifications = new Set<string>([
  'account/gatewayOAuth/changed',
  'account/login/completed',
  'account/rateLimits/updated',
  'account/updated',
  'app/list/updated',
  'autoApprovalReview/strictReviewRequired',
  'command/exec/outputDelta',
  'configWarning',
  'deprecationNotice',
  'error',
  'externalAgentConfig/import/completed',
  'externalAgentConfig/import/progress',
  'fs/changed',
  'fuzzyFileSearch/sessionCompleted',
  'fuzzyFileSearch/sessionUpdated',
  'guardianWarning',
  'hook/completed',
  'hook/started',
  'item/agentMessage/delta',
  'item/autoApprovalReview/completed',
  'item/autoApprovalReview/started',
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/completed',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'item/plan/delta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/started',
  'mcpServer/event/stream/notification',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'model/rerouted',
  'model/safetyBuffering/updated',
  'model/verification',
  'modelProvider/authRecoveryCompleted',
  'modelProvider/authRecoveryStarted',
  'process/exited',
  'process/outputDelta',
  'project/changed',
  'remoteControl/status/changed',
  'serverRequest/resolved',
  'skills/changed',
  'thread/archived',
  'thread/attachment/updated',
  'thread/closed',
  'thread/compacted',
  'thread/deleted',
  'thread/environment/connected',
  'thread/environment/disconnected',
  'thread/goal/cleared',
  'thread/goal/updated',
  'thread/name/updated',
  'thread/project/updated',
  'thread/prediction/updated',
  'thread/queue/changed',
  'thread/readState/changed',
  'thread/realtime/closed',
  'thread/realtime/error',
  'thread/realtime/item/completed',
  'thread/realtime/item/started',
  'thread/realtime/item/transcript/delta',
  'thread/realtime/itemAdded',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/started',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/reverted',
  'thread/settings/updated',
  'thread/started',
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'thread/unarchived',
  'turn/completed',
  'turn/diff/updated',
  'turn/moderationMetadata',
  'turn/plan/updated',
  'turn/started',
  'warning',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
]);
const unmodeledParams = z.record(string, z.unknown());

/** Only the pinned server-notification allowlist may bypass payload modeling. */
export function isUnmodeledCodexNotification(method: string): boolean {
  return pinnedServerNotifications.has(method) && !isNotification(method);
}

export function validateCodexParams<M extends CodexRequestMethod>(
  method: M,
  value: unknown,
): CodexRequestParams<M>;
export function validateCodexParams<M extends CodexNotificationMethod>(
  method: M,
  value: unknown,
): z.infer<(typeof codexNotificationSchemas)[M]>;
export function validateCodexParams(method: string, value: unknown): unknown;
export function validateCodexParams(method: string, value: unknown): unknown {
  if (isRequest(method))
    return parse(requests[method].params, value, 'invalidParams', method);
  if (isNotification(method))
    return parse(
      codexNotificationSchemas[method],
      value,
      'invalidParams',
      method,
    );
  if (isUnmodeledCodexNotification(method))
    return parse(unmodeledParams, value, 'invalidParams', method);
  throw new CodexProtocolError('unknownMethod', method);
}
export function validateCodexResult<M extends CodexRequestMethod>(
  method: M,
  value: unknown,
): CodexRequestResult<M>;
export function validateCodexResult(method: string, value: unknown): unknown;
export function validateCodexResult(method: string, value: unknown): unknown {
  if (!isRequest(method)) throw new CodexProtocolError('unknownMethod', method);
  return parse(requests[method].result, value, 'invalidResult', method);
}

const id = z.union([string, integer]);
const header = {
  jsonrpc: z.literal('2.0').optional(),
  emittedAtMs: integer.nonnegative().optional(),
};
// Routing fields are mutually exclusive even though server extension keys are stripped.
const envelope = z
  .record(string, z.unknown())
  .refine((frame) => {
    if ('id' in frame && !id.safeParse(frame['id']).success) return false;
    if ('method' in frame) return !('result' in frame) && !('error' in frame);
    return !('params' in frame) && 'result' in frame !== 'error' in frame;
  })
  .pipe(
    z.union([
      z.object({ ...header, id, method: string, params: json.optional() }),
      z.object({ ...header, method: string, params: json.optional() }),
      z.object({ ...header, id, result: json }),
      z.object({
        ...header,
        id,
        error: z.object({
          code: integer,
          message: string,
          data: json.optional(),
        }),
      }),
    ]),
  );
export type CodexProtocolFrame =
  | (z.infer<typeof envelope> & { readonly modeled?: true })
  | {
      readonly method: string;
      readonly params: Record<string, unknown>;
      readonly modeled: false;
      readonly jsonrpc?: '2.0';
      readonly emittedAtMs?: number;
    };

/** Supply the pending method for responses, before settling correlation or dispatching. */
export function validateCodexFrame(
  value: unknown,
  responseMethod?: string,
): CodexProtocolFrame {
  const frame = parse(envelope, value, 'invalidEnvelope');
  if ('method' in frame) {
    if (isUnmodeledCodexNotification(frame.method)) {
      if ('id' in frame)
        throw new CodexProtocolError('invalidEnvelope', frame.method);
      return {
        ...frame,
        params: parse(
          unmodeledParams,
          frame.params,
          'invalidParams',
          frame.method,
        ),
        modeled: false,
      };
    }
    if (!isRequest(frame.method) && !isNotification(frame.method))
      throw new CodexProtocolError('unknownMethod', frame.method);
    if (isRequest(frame.method) !== 'id' in frame)
      throw new CodexProtocolError('invalidEnvelope', frame.method);
    validateCodexParams(frame.method, frame.params);
  } else {
    if (responseMethod === undefined)
      throw new CodexProtocolError('missingResponseMethod');
    if (!isRequest(responseMethod))
      throw new CodexProtocolError('unknownMethod', responseMethod);
    if ('result' in frame) validateCodexResult(responseMethod, frame.result);
  }
  return frame;
}
