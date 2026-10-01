/**
 * Session Organization RPC Handlers — the webview entry to session
 * organization (TASK_2026_580, plan component 5).
 *
 * Methods:
 *   - session:setOrganization - priority, workflow status and/or pin
 *   - session:linkTask        - link a task (`primary` demotes the old primary)
 *   - session:unlinkTask      - remove a task link
 *   - session:addPrLink       - add (or refresh) a PR link
 *   - session:removePrLink    - remove a PR link
 *   - session:listForTasks    - linked sessions grouped by task id
 *
 * Every method:
 *   1. Zod-parses params (session-organization-rpc.schema.ts) BEFORE any
 *      service call → RpcUserError('INVALID_PARAMS'), `null` included.
 *   2. Answers `organization-unavailable` (`{ available: false }` for the
 *      list) when the host has no organization service — VS Code — or its
 *      store is closed.
 *   3. Authorizes: a mutation's session must have metadata
 *      (`session-not-found` otherwise) whose workspace is an open folder; the
 *      list's `workspacePath` must be an open folder
 *      (RpcUserError('UNAUTHORIZED_WORKSPACE')).
 *   4. Sanitizes failures: `SessionOrganizationInputError` becomes
 *      `INVALID_PARAMS`; any other error is logged raw and surfaced as a
 *      generic message, so no SQL text or path reaches the client.
 *
 * The family is `requires: []`, so every host constructs this class. The
 * service, the task index and the webview manager are therefore optional
 * injections, and the constructor subscribes to `onDidChange` only when the
 * service exists. Each change is pushed as
 * `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED` (D14); a failed push is logged,
 * never thrown. The subscription lives as long as the host and is released by
 * the service's own `dispose()`.
 */
import { injectable, inject } from 'tsyringe';
import type { z } from 'zod';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type SessionMetadataStore,
  type SessionTurnStateRegistry,
} from '@ptah-extension/agent-sdk';
import {
  SESSION_ORGANIZATION_TOKENS,
  SessionOrganizationInputError,
  type SessionOrganizationChange,
  type SessionOrganizationService,
  type StoredSessionTaskLink,
} from '@ptah-extension/session-organization';
import {
  TASK_SPECS_TOKENS,
  type TaskIndexService,
} from '@ptah-extension/task-specs';
import {
  MESSAGE_TYPES,
  type RpcMethodName,
  type SessionListForTasksParams,
  type SessionListForTasksResult,
  type SessionOrganizationMutationResult,
  type SessionOrganizationSummary,
  type TaskLinkedSession,
} from '@ptah-extension/shared';
import {
  SessionAddPrLinkParamsSchema,
  SessionLinkTaskParamsSchema,
  SessionListForTasksParamsSchema,
  SessionRemovePrLinkParamsSchema,
  SessionSetOrganizationParamsSchema,
  SessionUnlinkTaskParamsSchema,
} from './session-organization-rpc.schema';
import { isAuthorizedWorkspace } from '../utils/workspace-authorization';

const LOG_PREFIX = '[SessionOrganization]';

const UNAVAILABLE: SessionOrganizationMutationResult = {
  ok: false,
  reason: 'organization-unavailable',
  message: 'Session organization is not available on this host',
};

const NOT_FOUND: SessionOrganizationMutationResult = {
  ok: false,
  reason: 'session-not-found',
  message: 'Session not found',
};

type MutationMethod =
  | 'session:setOrganization'
  | 'session:linkTask'
  | 'session:unlinkTask'
  | 'session:addPrLink'
  | 'session:removePrLink';

@injectable()
export class SessionOrganizationRpcHandlers {
  /** RPC methods owned by this handler (manifest coverage invariant). */
  static readonly METHODS = [
    'session:setOrganization',
    'session:linkTask',
    'session:unlinkTask',
    'session:addPrLink',
    'session:removePrLink',
    'session:listForTasks',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
    @inject(SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY)
    private readonly turnState: SessionTurnStateRegistry,
    /**
     * Registered only on hosts with the SQLite store (Electron, CLI). Absent
     * on VS Code, where every method answers `organization-unavailable`.
     */
    @inject(SESSION_ORGANIZATION_TOKENS.SERVICE, { isOptional: true })
    private readonly organization?: SessionOrganizationService,
    /** Task index, read once per mutation result for the `missing` flag. */
    @inject(TASK_SPECS_TOKENS.TASK_INDEX_SERVICE, { isOptional: true })
    private readonly taskIndex?: TaskIndexService,
    /** Absent in some harnesses; without it changes are not pushed. */
    @inject(TOKENS.WEBVIEW_MANAGER, { isOptional: true })
    private readonly webviewManager?: WebviewManager,
  ) {
    if (this.organization) {
      this.organization.onDidChange((change) => {
        void this.broadcastChanged(change);
      });
    }
  }

  register(): void {
    this.registerMutation(
      'session:setOrganization',
      SessionSetOrganizationParamsSchema,
      (organization, params) => organization.setOrganization(params),
    );
    this.registerMutation(
      'session:linkTask',
      SessionLinkTaskParamsSchema,
      (organization, params) => organization.linkSessionTask(params),
    );
    this.registerMutation(
      'session:unlinkTask',
      SessionUnlinkTaskParamsSchema,
      (organization, params) => organization.unlinkSessionTask(params),
    );
    this.registerMutation(
      'session:addPrLink',
      SessionAddPrLinkParamsSchema,
      (organization, params) =>
        organization.addSessionPrLink({ ...params, source: 'user' }),
    );
    this.registerMutation(
      'session:removePrLink',
      SessionRemovePrLinkParamsSchema,
      (organization, params) => organization.removeSessionPrLink(params),
    );
    this.registerListForTasks();

    this.logger.debug('Session organization RPC handlers registered', {
      methods: [...SessionOrganizationRpcHandlers.METHODS],
      available: this.organization !== undefined,
    });
  }

  /**
   * One mutation method: parse → unavailable → authorize → service call →
   * the real `missing` flag on the returned summary.
   */
  private registerMutation<TParams extends { sessionId: string }>(
    method: MutationMethod,
    schema: z.ZodType<TParams, unknown>,
    mutate: (
      organization: SessionOrganizationService,
      params: TParams,
    ) => Promise<SessionOrganizationMutationResult>,
  ): void {
    this.rpcHandler.registerMethod<unknown, SessionOrganizationMutationResult>(
      method,
      async (params) => {
        const parsed = this.parse(method, schema, params);
        const organization = this.organization;
        if (!organization) return UNAVAILABLE;
        try {
          const root = await this.authorizeSession(parsed.sessionId);
          if (root === null) return NOT_FOUND;
          const result = await mutate(organization, parsed);
          if (!result.ok) return result;
          return {
            ok: true,
            organization: await this.withMissingTasks(
              root,
              result.organization,
            ),
          };
        } catch (error: unknown) {
          throw this.sanitize(error, method);
        }
      },
    );
  }

  /**
   * session:listForTasks — links grouped by task id, each with the session's
   * name (metadata), live turn phase and PR links. A link whose session has
   * no metadata in this workspace (an orphan row, R-TL12) is left out.
   */
  private registerListForTasks(): void {
    const method = 'session:listForTasks';
    this.rpcHandler.registerMethod<
      SessionListForTasksParams,
      SessionListForTasksResult
    >(method, async (params) => {
      const parsed = this.parse(
        method,
        SessionListForTasksParamsSchema,
        params,
      );
      const organization = this.organization;
      if (!organization?.isAvailable()) {
        return { available: false };
      }
      if (!isAuthorizedWorkspace(parsed.workspacePath, this.workspace)) {
        throw new RpcUserError(
          'Access denied: workspace path is not an open folder.',
          'UNAUTHORIZED_WORKSPACE',
        );
      }
      try {
        const links = organization.listTaskLinks(
          parsed.workspacePath,
          parsed.taskIds,
        );
        if (links.length === 0) return { available: true, links: {} };
        const sessions = await this.metadataStore.getForWorkspace(
          parsed.workspacePath,
        );
        const names = new Map(sessions.map((s) => [s.sessionId, s.name]));
        const stored = organization.queryWorkspace(parsed.workspacePath);
        return {
          available: true,
          links: this.groupByTask(links, names, (sessionId) =>
            (stored.get(sessionId)?.prLinks ?? []).map((pr) => ({ ...pr })),
          ),
        };
      } catch (error: unknown) {
        throw this.sanitize(error, method);
      }
    });
  }

  /** Group links by task: primary first, then the newest link first. */
  private groupByTask(
    links: readonly StoredSessionTaskLink[],
    names: ReadonlyMap<string, string>,
    prLinksOf: (sessionId: string) => TaskLinkedSession['prLinks'],
  ): Record<string, TaskLinkedSession[]> {
    const ordered = [...links].sort(
      (a, b) =>
        Number(b.role === 'primary') - Number(a.role === 'primary') ||
        b.createdAt - a.createdAt,
    );
    const grouped: Record<string, TaskLinkedSession[]> = {};
    for (const link of ordered) {
      const name = names.get(link.sessionId);
      if (name === undefined) continue;
      grouped[link.taskId] ??= [];
      grouped[link.taskId].push({
        sessionId: link.sessionId,
        name,
        role: link.role,
        source: link.source,
        livePhase: this.turnState.get(link.sessionId)?.phase ?? null,
        prLinks: prLinksOf(link.sessionId),
      });
    }
    return grouped;
  }

  /**
   * The `authorizeSessionAccess` semantics of `SessionRpcHandlers`: the
   * session's metadata must exist (null = not found) and its workspace must
   * be an open folder. Returns that workspace.
   */
  private async authorizeSession(sessionId: string): Promise<string | null> {
    const metadata = await this.metadataStore.get(sessionId);
    if (!metadata) return null;
    const workspacePath = metadata.workspaceId;
    if (
      !workspacePath ||
      !isAuthorizedWorkspace(workspacePath, this.workspace)
    ) {
      throw new RpcUserError(
        "Access denied: the session's workspace is not an open folder.",
        'UNAUTHORIZED_WORKSPACE',
      );
    }
    return workspacePath;
  }

  /**
   * Replace the service's `missing: false` with the real value: one
   * `taskIndex.list(root)` read, and only when the summary has task links.
   */
  private async withMissingTasks(
    workspaceRoot: string,
    summary: SessionOrganizationSummary,
  ): Promise<SessionOrganizationSummary> {
    if (summary.tasks.length === 0 || !this.taskIndex) return summary;
    let known: ReadonlySet<string>;
    try {
      const index = await this.taskIndex.list(workspaceRoot);
      known = new Set<string>([
        ...index.tasks.map((t) => t.id),
        // An excluded folder still exists on disk; its link is not missing.
        ...index.excluded.map((e) => e.folderName),
      ]);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the missing flag is a label
      // on a task chip; an unreadable index marks no task missing rather than
      // failing a mutation that has already been committed.
      this.logger.warn(`${LOG_PREFIX} could not read the task index`, {
        workspaceRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      return summary;
    }
    return {
      ...summary,
      tasks: summary.tasks.map((task) => ({
        ...task,
        missing: !known.has(task.taskId),
      })),
    };
  }

  /** Zod-parse or throw INVALID_PARAMS naming the offending fields only. */
  private parse<T>(
    method: string,
    schema: z.ZodType<T, unknown>,
    params: unknown,
  ): T {
    const result = schema.safeParse(params);
    if (!result.success) {
      const fields = result.error.issues
        .map((issue) => issue.path.join('.') || 'params')
        .join(', ');
      throw new RpcUserError(
        `Invalid ${method} params (${fields})`,
        'INVALID_PARAMS',
      );
    }
    return result.data;
  }

  /**
   * Keep typed user errors, map the service's input error to
   * `INVALID_PARAMS`, and replace anything else (SQL, I/O) with a generic
   * message after logging the raw error server-side.
   */
  private sanitize(error: unknown, method: string): Error {
    if (error instanceof RpcUserError) return error;
    if (error instanceof SessionOrganizationInputError) {
      return new RpcUserError(error.message, 'INVALID_PARAMS');
    }
    this.logger.error(
      `${LOG_PREFIX} ${method} failed`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return new Error(`${method} failed`);
  }

  private broadcastChanged(change: SessionOrganizationChange): Promise<void> {
    if (!this.webviewManager) return Promise.resolve();
    return this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED, {
        workspaceRoot: change.workspaceRoot,
        sessionIds: [...change.sessionIds],
        reason: change.reason,
      })
      .catch((error: unknown) => {
        // degradation-audit: reported - a failed push is logged as an error;
        // the change is committed and the next session:list read shows it.
        this.logger.error(
          `${LOG_PREFIX} Failed to broadcast ${MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED}`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }
}
