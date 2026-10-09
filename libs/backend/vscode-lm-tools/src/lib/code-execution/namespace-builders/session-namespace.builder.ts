/**
 * Session namespace builder (TASK_2026_584, plan Component 7).
 *
 * `ptah.session` exposes the host's `ISessionSpawner` to the calling chat
 * session: start a child session in its own worktree and tab, steer it,
 * observe it, read its transcript and stop it.
 *
 * The caller is ALWAYS the session the MCP transport names
 * (`getCallerSessionId`), never an argument, so neither a tool call nor
 * `execute_code` can act on another session's children.
 *
 * The spawner is looked up on every call (`getSpawner`), not captured when
 * the namespace is built: the builder may be constructed before the
 * cli-agent-runtime services are, and a captured `undefined` would last for
 * the life of the process. Absent at call time is a NAMED error, never a
 * silent no-op (the rule `ptah-api-builder.service.ts` applies to the report
 * router).
 */
import type {
  ISessionSpawner,
  SessionChildCompletionEnvelope,
  SessionChildLookupRefusal,
  SessionChildReadResult,
  SessionChildSendResult,
  SessionChildSnapshot,
  SessionChildStartRequest,
  SessionSuccessorStartRequest,
  SessionChildStartResult,
  SessionSendMode,
} from '@ptah-extension/cli-agent-runtime';

export const SESSION_SPAWNER_UNAVAILABLE_MESSAGE =
  'Agent sessions are unavailable: the CLI agent runtime is not registered ' +
  'in this host, so there is no session spawner. Register cli-agent-runtime ' +
  'services during container setup.';

/** Start arguments; the caller is supplied by the namespace, never by the agent. */
export type SessionStartInput =
  | Omit<SessionChildStartRequest, 'callerSessionId'>
  | Omit<SessionSuccessorStartRequest, 'callerSessionId'>;

export interface SessionSendInput {
  readonly childSessionId: string;
  readonly message: string;
  /** Default `queue`. */
  readonly mode?: SessionSendMode;
}

export type SessionStatusOutcome =
  | { readonly ok: true; readonly children: readonly SessionChildSnapshot[] }
  | SessionChildLookupRefusal;

export type SessionReadOutcome =
  | { readonly ok: true; readonly result: SessionChildReadResult }
  | SessionChildLookupRefusal;

export type SessionStopOutcome =
  | { readonly ok: true; readonly child: SessionChildSnapshot }
  | SessionChildLookupRefusal;

export interface SessionNamespace {
  start(input: SessionStartInput): Promise<SessionChildStartResult>;
  send(input: SessionSendInput): Promise<SessionChildSendResult>;
  /** Omit the id for every child of the caller. */
  status(childSessionId?: string): Promise<SessionStatusOutcome>;
  read(childSessionId: string, tailKiB?: number): Promise<SessionReadOutcome>;
  stop(childSessionId: string): Promise<SessionStopOutcome>;
  /**
   * Completions of the caller's children held while the caller was not live,
   * returned ONCE (the spawner marks them delivered). Empty when the host has
   * no spawner: nothing can have been held.
   */
  takeHeldCompletions(): readonly SessionChildCompletionEnvelope[];
}

export interface SessionNamespaceDependencies {
  /** Resolved on every call; `undefined` when the host registered no spawner. */
  readonly getSpawner: () => ISessionSpawner | undefined;
  /** The transport-derived caller (`/session/{id}`). */
  readonly getCallerSessionId: () => string | undefined;
  /** Fired after a successful start, so the UI lists the new worktree. */
  readonly onWorktreeChanged?: (event: {
    action: 'created';
    worktreePath: string;
    branch: string;
  }) => void;
}

export function buildSessionNamespace(
  deps: SessionNamespaceDependencies,
): SessionNamespace {
  const requireSpawner = (): ISessionSpawner => {
    const spawner = deps.getSpawner();
    if (!spawner) throw new Error(SESSION_SPAWNER_UNAVAILABLE_MESSAGE);
    return spawner;
  };
  const caller = (): string | undefined => deps.getCallerSessionId();

  return {
    start: async (input) => {
      const result = await requireSpawner().start({
        ...input,
        callerSessionId: caller(),
      });
      if (result.ok && 'child' in result) {
        deps.onWorktreeChanged?.({
          action: 'created',
          worktreePath: result.child.worktreePath,
          branch: result.child.branch,
        });
      }
      return result;
    },

    send: async (input) =>
      requireSpawner().send({
        callerSessionId: caller(),
        childSessionId: input.childSessionId,
        message: input.message,
        mode: input.mode ?? 'queue',
      }),

    status: async (childSessionId) =>
      requireSpawner().status({ callerSessionId: caller(), childSessionId }),

    read: async (childSessionId, tailKiB) =>
      requireSpawner().read({
        callerSessionId: caller(),
        childSessionId,
        tailKiB,
      }),

    stop: async (childSessionId) =>
      requireSpawner().stop({ callerSessionId: caller(), childSessionId }),

    takeHeldCompletions: () =>
      deps.getSpawner()?.takeHeldCompletions(caller()) ?? [],
  };
}
