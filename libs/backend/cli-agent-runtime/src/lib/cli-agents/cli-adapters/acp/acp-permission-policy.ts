import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

/** Description used in human notes when a request carries no usable tool title. */
const FALLBACK_TOOL_TITLE = 'a tool call';

export interface AcpPermissionDecision {
  /** The result to answer `session/request_permission` with. */
  readonly response: RequestPermissionResponse;
  /** True when the answer refuses the request: a `reject_*` selection or cancelled. */
  readonly refused: boolean;
  /** Human note for an `info` segment, when one is required. */
  readonly info?: string;
  /** The request's tool call title, when present. */
  readonly toolTitle?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function selectedResponse(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: 'selected', optionId } };
}

function cancelledResponse(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}

/** The request's tool call title, or undefined when it is missing or empty. */
function toolTitleOf(request: RequestPermissionRequest): string | undefined {
  if (!isRecord(request)) return undefined;
  const toolCall = request.toolCall;
  if (!isRecord(toolCall)) return undefined;
  const title = toolCall.title;
  return typeof title === 'string' && title ? title : undefined;
}

/** The offered permission options, or an empty list when the request has none. */
function offeredOptions(request: RequestPermissionRequest): readonly unknown[] {
  return isRecord(request) && Array.isArray(request.options)
    ? request.options
    : [];
}

/** The optionId of the first option of `kind`, ignoring options without a usable id. */
function firstOptionIdOfKind(
  options: readonly unknown[],
  kind: string,
): string | undefined {
  for (const option of options) {
    if (
      isRecord(option) &&
      option.kind === kind &&
      typeof option.optionId === 'string' &&
      option.optionId
    ) {
      return option.optionId;
    }
  }
  return undefined;
}

/**
 * Decides an ACP `session/request_permission` request without a user prompt.
 *
 * Options are selected by `kind`, never by `optionId`: ids and ordering differ
 * per agent (Grok lists `always-allow`, an `allow_always`, first) so only the
 * kind ladder is stable. With auto-approve on the ladder is `allow_once`, then
 * `allow_always` (noted, because it grants beyond this turn), then
 * `reject_once`, then cancelled — every `reject_always` is ignored. With
 * auto-approve off nothing is approved: `reject_once` when offered, else
 * cancelled, since there is no UI to ask and waiting only hits the
 * inactivity watchdog.
 *
 * The requesting agent is an external process, so the request is treated as
 * untrusted even though the signature is typed: missing or malformed fields
 * are tolerated and the function never throws.
 */
export function decideAcpPermission(
  request: RequestPermissionRequest,
  options: { autoApprove?: boolean } = {},
): AcpPermissionDecision {
  try {
    const requestedTitle = toolTitleOf(request);
    const title = requestedTitle ?? FALLBACK_TOOL_TITLE;
    const offered = offeredOptions(request);

    if (options.autoApprove !== false) {
      const allowOnce = firstOptionIdOfKind(offered, 'allow_once');
      if (allowOnce !== undefined) {
        return {
          response: selectedResponse(allowOnce),
          refused: false,
          toolTitle: requestedTitle,
        };
      }

      const allowAlways = firstOptionIdOfKind(offered, 'allow_always');
      if (allowAlways !== undefined) {
        return {
          response: selectedResponse(allowAlways),
          refused: false,
          info: `${title}: the only allow option offered was a persistent grant`,
          toolTitle: requestedTitle,
        };
      }

      const rejectOnce = firstOptionIdOfKind(offered, 'reject_once');
      if (rejectOnce !== undefined) {
        return {
          response: selectedResponse(rejectOnce),
          refused: true,
          info: `Refused permission for ${title}: no allow option was offered`,
          toolTitle: requestedTitle,
        };
      }

      return {
        response: cancelledResponse(),
        refused: true,
        info: `Refused permission for ${title}: no offered option could be selected`,
        toolTitle: requestedTitle,
      };
    }

    const rejectOnce = firstOptionIdOfKind(offered, 'reject_once');
    if (rejectOnce !== undefined) {
      return {
        response: selectedResponse(rejectOnce),
        refused: true,
        info: `Refused permission for ${title}: auto-approve is off`,
        toolTitle: requestedTitle,
      };
    }

    return {
      response: cancelledResponse(),
      refused: true,
      info: `Refused permission for ${title}: auto-approve is off`,
      toolTitle: requestedTitle,
    };
  } catch {
    return { response: cancelledResponse(), refused: true };
  }
}
