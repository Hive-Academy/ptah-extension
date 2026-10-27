import { z } from 'zod';
import { string, integer, json } from './codex-protocol-schemas';
import {
  codexRequestSchemas,
  codexServerRequestSchemas,
  codexNotificationSchemas,
} from './codex-protocol-methods';
export {
  codexRequestSchemas,
  codexServerRequestSchemas,
  codexNotificationSchemas,
} from './codex-protocol-methods';

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

export class CodexProtocolError extends Error {
  constructor(
    readonly code: CodexProtocolErrorCode,
    readonly method?: string,
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
  if (!result.success) throw new CodexProtocolError(code, method);
  return result.data;
}
function isRequest(method: string): method is CodexRequestMethod {
  return Object.hasOwn(requests, method);
}
function isNotification(method: string): method is CodexNotificationMethod {
  return Object.hasOwn(codexNotificationSchemas, method);
}

// Pinned 0.155.1 ServerNotification methods; specs compare this surface with both artifacts.
const pinnedServerNotifications = new Set<string>([
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
  'thread/queue/changed',
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
