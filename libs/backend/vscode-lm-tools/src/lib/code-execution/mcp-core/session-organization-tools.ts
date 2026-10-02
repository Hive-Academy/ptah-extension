/**
 * `ptah_session_link_task` — the tool definition and its result text
 * (TASK_2026_580, D12).
 *
 * The tool links the session that issued the call to a `.ptah/specs/` task
 * folder. The arguments are validated by `SessionLinkTaskArgsSchema` in the
 * `sessionOrganization` namespace; the schema below mirrors it for the client
 * and takes the role list from the shared constant, so the two cannot drift
 * apart on the allowed roles. There is deliberately no session argument: the
 * caller is resolved from the request context, and an extra key is rejected.
 */

import { SESSION_TASK_LINK_ROLES } from '@ptah-extension/shared';
import type { SessionLinkTaskResult } from '../namespace-builders/session-organization-namespace.builder';
import type { MCPToolDefinition } from '../types';

export const SESSION_LINK_TASK_TOOL_NAME = 'ptah_session_link_task';

/** Build the `ptah_session_link_task` tool definition. */
export function buildSessionLinkTaskTool(): MCPToolDefinition {
  return {
    name: SESSION_LINK_TASK_TOOL_NAME,
    description:
      'Link the calling session (the chat session that makes this call; you never ' +
      'pass a session id) to a task folder under .ptah/specs. The link is stored ' +
      'per user, outside the repository, and does not edit task.md. role is ' +
      `${SESSION_TASK_LINK_ROLES.join(' or ')} (default primary); a new primary ` +
      'link demotes the existing one. The task folder is not checked: a missing ' +
      'task shows as missing in the UI. Errors: invalid-args, ' +
      'organization-unavailable (always in VS Code), unattributed-caller (the ' +
      'session has no SDK id yet; retry later), link-failed.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description:
            'Task folder name (one path segment), e.g. TASK_2026_580_9f77',
        },
        role: {
          type: 'string',
          enum: [...SESSION_TASK_LINK_ROLES],
          description: 'Link role; defaults to primary.',
        },
      },
      required: ['taskId'],
    },
    annotations: { destructiveHint: false },
  };
}

/** Fixed text for `link-failed`: the recorder's own message stays in the log. */
const LINK_FAILED_TEXT =
  'The link could not be recorded because the session-organization store failed. Retry later.';

/**
 * Render a `linkTask` result for the agent. A success means the link was
 * handed to the store for this session; it does not claim the task exists.
 */
export function formatSessionLinkTaskResult(
  result: SessionLinkTaskResult,
): string {
  if (result.ok) {
    return (
      `Link recorded for this session (${result.sessionId}): task ` +
      `${result.taskId}, role ${result.role}. The task folder is not ` +
      'checked; a missing task shows as missing in the UI.'
    );
  }
  const message =
    result.error === 'link-failed' ? LINK_FAILED_TEXT : result.message;
  return `Not linked (${result.error}): ${message}`;
}
