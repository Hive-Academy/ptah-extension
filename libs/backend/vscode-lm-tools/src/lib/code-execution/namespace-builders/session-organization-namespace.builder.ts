/**
 * Session-organization namespace builder (TASK_2026_580, D12).
 *
 * Lets an agent link the session it runs in to a `.ptah/specs/` task folder.
 * The link is a per-user organization fact held by the session-organization
 * store; it never touches `task.md`.
 *
 * ## The caller is never an argument
 *
 * The session to link is the one that issued the MCP call. It is resolved by
 * the injected `resolveCallerSessionId`, which maps the request's tab id to
 * the SDK session id. An agent cannot name another session, and a tab id never
 * reaches the recorder.
 *
 * ## Degradation
 *
 * Every method returns a typed `{ ok: false, error }` result instead of
 * throwing:
 *   - `invalid-args` — the arguments failed validation;
 *   - `organization-unavailable` — no recorder on this host (VS Code today);
 *   - `unattributed-caller` — the caller has no SDK session id (no MCP caller,
 *     an unknown tab, or a session whose SDK id is not assigned yet);
 *   - `link-failed` — the recorder threw, which its contract forbids.
 *
 * The namespace is named `sessionOrganization`, not `session`: TASK_2026_584
 * owns `PtahAPI.session`.
 */

import { z } from 'zod';
import { TaskIdRefSchema } from '@ptah-extension/shared/schemas';
import {
  SESSION_TASK_LINK_ROLES,
  type SessionTaskLinkRole,
  type SessionTaskLinkSource,
} from '@ptah-extension/shared';

/**
 * The subset of the session-organization recorder port this namespace calls.
 * Structural, so the builder needs no DI container in tests. The port's
 * contract applies: `sessionId` is an SDK session id, and the call never throws
 * and drops a write it cannot apply.
 */
export interface SessionTaskLinkRecorderLike {
  linkTask(input: {
    sessionId: string;
    workspaceRootHint?: string;
    taskId: string;
    role: SessionTaskLinkRole;
    source: SessionTaskLinkSource;
  }): void;
}

export interface SessionOrganizationNamespaceDependencies {
  /**
   * SDK session id of the session that issued the current MCP call, or
   * `undefined` when it does not resolve. Must never return a webview tab id.
   */
  resolveCallerSessionId: () => string | undefined;
  /** The recorder, or `undefined` on a host that has none. */
  getRecorder: () => SessionTaskLinkRecorderLike | undefined;
  /** Workspace root of the calling session, used to locate the store. */
  getWorkspaceRootHint: () => string | undefined;
}

/** `ptah_session_link_task` arguments. Agent input, so untrusted. */
export const SessionLinkTaskArgsSchema = z
  .object({
    // A folder name under `.ptah/specs`; the shared guard keeps it one segment.
    taskId: TaskIdRefSchema,
    role: z.enum(SESSION_TASK_LINK_ROLES).optional(),
  })
  .strict();

export type SessionLinkTaskErrorCode =
  | 'invalid-args'
  | 'organization-unavailable'
  | 'unattributed-caller'
  | 'link-failed';

export type SessionLinkTaskResult =
  | {
      ok: true;
      /** SDK session id the link was recorded on. */
      sessionId: string;
      taskId: string;
      role: SessionTaskLinkRole;
    }
  | { ok: false; error: SessionLinkTaskErrorCode; message: string };

export interface SessionOrganizationNamespace {
  /**
   * Link the calling session to a task folder. `role` defaults to `primary`;
   * a second `primary` link demotes the existing one. A successful result
   * means the link was handed to the recorder, which logs and drops a write
   * it cannot apply.
   */
  linkTask(args: unknown): SessionLinkTaskResult;
}

const DEFAULT_LINK_ROLE: SessionTaskLinkRole = 'primary';

/** Render a Zod failure as one readable line for the agent. */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export function buildSessionOrganizationNamespace(
  deps: SessionOrganizationNamespaceDependencies,
): SessionOrganizationNamespace {
  return {
    linkTask(args: unknown): SessionLinkTaskResult {
      const parsed = SessionLinkTaskArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: 'invalid-args',
          message: formatZodError(parsed.error),
        };
      }

      const recorder = deps.getRecorder();
      if (!recorder) {
        return {
          ok: false,
          error: 'organization-unavailable',
          message: 'Session organization is not available on this host.',
        };
      }

      const sessionId = deps.resolveCallerSessionId();
      if (!sessionId) {
        return {
          ok: false,
          error: 'unattributed-caller',
          message:
            'The calling session has no SDK session id yet, so the link cannot be attributed. Retry after the session has started.',
        };
      }

      const { taskId } = parsed.data;
      const role = parsed.data.role ?? DEFAULT_LINK_ROLE;
      const workspaceRootHint = deps.getWorkspaceRootHint();
      try {
        recorder.linkTask({
          sessionId,
          ...(workspaceRootHint ? { workspaceRootHint } : {}),
          taskId,
          role,
          source: 'agent',
        });
      } catch (error: unknown) {
        return {
          ok: false,
          error: 'link-failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      return { ok: true, sessionId, taskId, role };
    },
  };
}
