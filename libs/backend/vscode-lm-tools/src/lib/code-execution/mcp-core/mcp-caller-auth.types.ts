/**
 * MCP caller authentication contracts shared by the HTTP gate and the dispatcher.
 *
 * The binding type itself lives on the platform-core port. This module holds
 * the HTTP result, the fixed failure strings, and the URL-to-binding compare.
 */

import { z } from 'zod';
import type {
  McpCallerBinding,
  McpCallerCapability,
  McpCallerToolProfile,
} from '@ptah-extension/platform-core';

export const MCP_AUTH_REQUIRED_CODE = -32001;
export const MCP_CALLER_FORBIDDEN_CODE = -32003;

export const MCP_AUTH_REQUIRED_MESSAGE = 'Authentication required';
export const MCP_CALLER_FORBIDDEN_MESSAGE =
  'Caller is not allowed to use this resource';
export const MCP_TOOL_DENIED_MESSAGE = 'Tool is not permitted for this caller';
export const MCP_CONTENT_TYPE_MESSAGE =
  'Content-Type must be application/json';

/** Values of `mcp.externalCallerAccess`. Anything else stays read-only. */
export type McpExternalAccess = 'read-only' | 'full';

const externalAccessSchema = z.enum(['read-only', 'full']);

/** Parse the setting. Invalid or missing values fail closed to read-only. */
export function parseExternalCallerAccess(value: unknown): McpExternalAccess {
  const parsed = externalAccessSchema.safeParse(value);
  return parsed.success ? parsed.data : 'read-only';
}

export interface McpAuthFailure {
  readonly httpStatus: 401 | 403;
  readonly jsonRpcCode: -32001 | -32003;
  readonly message: string;
}

export type McpRequestAuth =
  | {
      readonly ok: true;
      readonly binding: McpCallerBinding;
      readonly legacy: boolean;
    }
  | { readonly ok: false; readonly failure: McpAuthFailure };

/** Identity the HTTP gate already decoded from the credential-stripped URL. */
export interface McpHttpAuthInput {
  readonly token?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly workspaceRoot?: string;
  readonly toolProfile?: string;
}

export function authRequiredFailure(): McpAuthFailure {
  return {
    httpStatus: 401,
    jsonRpcCode: MCP_AUTH_REQUIRED_CODE,
    message: MCP_AUTH_REQUIRED_MESSAGE,
  };
}

export function callerForbiddenFailure(): McpAuthFailure {
  return {
    httpStatus: 403,
    jsonRpcCode: MCP_CALLER_FORBIDDEN_CODE,
    message: MCP_CALLER_FORBIDDEN_MESSAGE,
  };
}

function present(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === '') return undefined;
  return value;
}

function profileOf(value: string | undefined): McpCallerToolProfile | undefined {
  if (value === 'coding' || value === 'apps') return value;
  return undefined;
}

/**
 * True when every identity field on the binding equals the URL, and the
 * binding kind is one the URL shape is allowed to present.
 *
 * `internal-query` is allowed on `/workspace/{root}` and nowhere else.
 * `home` is allowed only on a URL with no agent, session, or workspace.
 * A profile on one side and not the other is a mismatch. An unknown profile
 * string never equals a binding profile.
 */
export function bindingMatchesUrl(
  binding: McpCallerBinding,
  url: McpHttpAuthInput,
): boolean {
  const agentId = present(url.agentId);
  const sessionId = present(url.sessionId);
  const workspaceRoot = present(url.workspaceRoot);
  const urlProfile = present(url.toolProfile);

  if ((binding.agentId ?? undefined) !== agentId) return false;
  if ((binding.sessionId ?? undefined) !== sessionId) return false;
  if ((binding.workspaceRoot ?? undefined) !== workspaceRoot) return false;
  if ((binding.toolProfile ?? undefined) !== profileOf(urlProfile)) {
    return false;
  }
  if (urlProfile !== undefined && profileOf(urlProfile) === undefined) {
    return false;
  }

  switch (binding.kind) {
    case 'agent':
      return agentId !== undefined && sessionId === undefined;
    case 'session':
      return sessionId !== undefined && agentId === undefined;
    case 'workspace':
      return (
        workspaceRoot !== undefined &&
        agentId === undefined &&
        sessionId === undefined
      );
    case 'home':
      return (
        agentId === undefined &&
        sessionId === undefined &&
        workspaceRoot === undefined
      );
    case 'internal-query':
      return (
        workspaceRoot !== undefined &&
        agentId === undefined &&
        sessionId === undefined
      );
    default:
      return false;
  }
}

/** One-release untokened caller. Capability is read-only for every URL kind. */
export function legacyReadOnlyBinding(url: McpHttpAuthInput): McpCallerBinding {
  const agentId = present(url.agentId);
  const sessionId = present(url.sessionId);
  const workspaceRoot = present(url.workspaceRoot);
  const toolProfile = profileOf(present(url.toolProfile));
  const kind = agentId
    ? 'agent'
    : sessionId
      ? 'session'
      : workspaceRoot
        ? 'workspace'
        : 'home';
  const capability: McpCallerCapability = 'read-only';
  return {
    kind,
    capability,
    ...(agentId === undefined ? {} : { agentId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    ...(toolProfile === undefined ? {} : { toolProfile }),
  };
}
