import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  DriverHolder,
  ISessionDriverLock,
  IWorkspaceLifecycleProvider,
} from '@ptah-extension/platform-core';
import type {
  ISdkPermissionHandler,
  PermissionRequest,
  RpcMethodResult,
} from '@ptah-extension/shared';
import type {
  ControlFrame,
  RemoteMethod,
  RemoteSessionSummary,
  WorkerErrorCode,
  WorkerGrant,
  WorkerMethodParams,
  WorkerMethodResult,
} from '@ptah-extension/worker-protocol';
import type * as WorkerRuntime from '@ptah-extension/worker-runtime';
import type {
  CapturedEvent,
  HistoryReader,
  RpcHandlerPort,
  RpcSpec,
  SessionLogWriter,
  SessionMetadataReader,
  WorkerHandlers,
  WorkerMethodHandler,
  WorkerPeer,
  WorkspaceRegistry,
} from '@ptah-extension/worker-runtime';

/** Routing key for an event of a worker tab whose session ID is not known yet. */
const TAB_KEY = 'tab:';
const TURN_END_EVENTS = new Set([
  'session:turnEnded',
  'session:turnFailed',
  'chat:sessionEnded',
]);
/** W6: `session.start` answers after `session:id-resolved` or fails. */
const RESOLUTION_TIMEOUT_MS = 30_000;
const SESSION_LIST_LIMIT = 500;

/** A refusal whose code the connection maps to fixed wire copy. */
export class RemoteMethodError extends Error {
  constructor(readonly code: WorkerErrorCode) {
    super(code);
    this.name = 'RemoteMethodError';
  }
}

/** The session log store; `WorkerService` implements it once it exists. */
export interface RemoteSessionLogs {
  openSession(sessionId: string): Promise<SessionLogWriter>;
  findWriter(sessionId: string): SessionLogWriter | undefined;
}

export interface RemoteSessionDeps {
  runtime: typeof WorkerRuntime;
  machineId: string;
  maxActiveTurns: number;
  registry: WorkspaceRegistry;
  logs: RemoteSessionLogs;
  rpc: RpcHandlerPort;
  history: HistoryReader;
  metadata: SessionMetadataReader;
  permissions: ISdkPermissionHandler;
  lock: ISessionDriverLock;
  workspaces: Pick<IWorkspaceLifecycleProvider, 'addFolder'>;
  providerReady: () => boolean;
  machineInfo: (grant: WorkerGrant) => WorkerMethodResult<'machine.info'>;
  /** `WORKER_CLOSE_CODES.REVOKED`, sent after `token.revokeSelf`. */
  revokedCloseCode: number;
  clientName: (tokenId: string) => string | undefined;
  revokeToken: (tokenId: string) => Promise<void>;
  requestRelease: (sessionId: string) => Promise<string>;
  log: (message: string) => void;
}

export interface RemoteSessions {
  /** The synchronous push tap (W7): classify, route and enqueue only. */
  tap(type: string, payload: unknown): void;
  handle(
    method: string,
    params: unknown,
    grant: WorkerGrant,
    peer: WorkerPeer,
  ): Promise<unknown>;
  /** Interrupts every turn this worker drives, while the logs are still open. */
  abortTurns(): Promise<void>;
  /** Frees every driver lock this process holds. */
  releaseLocks(): Promise<void>;
  /** Wire into `SessionLogWriterOptions.onAppendFailed`. */
  onAppendFailed(sessionId: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function isPermissionRequest(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PermissionRequest {
  return typeof value.id === 'string' && typeof value.toolName === 'string';
}

function isCapturedEvent(value: unknown): value is CapturedEvent {
  return (
    isRecord(value) && typeof value.type === 'string' && 'payload' in value
  );
}

/**
 * Binds a handler to its method's parsed params. `dispatchWorkerMethod`
 * parses `params` with this method's schema before any handler runs, so the
 * narrowing is the schema's own output type.
 */
function method<M extends RemoteMethod>(
  handler: (
    params: WorkerMethodParams<M>,
    grant: WorkerGrant,
  ) => Promise<WorkerMethodResult<M>>,
): WorkerMethodHandler {
  return (params, grant) => handler(params as WorkerMethodParams<M>, grant);
}

/** Composes the worker-runtime session pieces behind the remote method table. */
export function createRemoteSessions(deps: RemoteSessionDeps): RemoteSessions {
  const { runtime } = deps;
  const rpc = new runtime.InProcessRpc(deps.rpc, (ref, error) =>
    deps.log(`[ptah-worker] in-process RPC failed (ref ${ref}): ${error}`),
  );
  const owner: DriverHolder = {
    kind: 'worker',
    hostname: hostname(),
    pid: process.pid,
    label: `Ptah worker on ${hostname()}`,
    acquiredAt: new Date().toISOString(),
    responding: true,
  };
  const writerOf = (sessionId: string): SessionLogWriter => {
    const writer = deps.logs.findWriter(sessionId);
    if (!writer) throw new runtime.SessionLogFailedError();
    return writer;
  };
  const transcript = new runtime.Transcript(deps.history, deps.lock, owner);
  const driver = new runtime.SessionDriver(
    rpc,
    transcript,
    deps.metadata,
    writerOf,
    deps.providerReady,
    deps.maxActiveTurns,
  );
  const workspaceById = (workspaceId: string) =>
    deps.registry.list().find((item) => item.workspaceId === workspaceId);
  const listSessions = async (workspaceId: string) => {
    const workspace = workspaceById(workspaceId);
    if (!workspace) throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
    // The engine authorizes session reads and turns against its own folders.
    deps.workspaces.addFolder(workspace.path);
    const result = await rpc.call(
      'session:list',
      { workspacePath: workspace.path, limit: SESSION_LIST_LIMIT },
      runtime.IN_PROCESS_SPECS['session:list'] as unknown as RpcSpec<
        RpcMethodResult<'session:list'>
      >,
    );
    if (!result.ok) throw new RemoteMethodError(result.error.code);
    return result.value.sessions;
  };
  const sessionIndex = new runtime.WorkerSessionIndex(async (workspaceId) =>
    (await listSessions(workspaceId)).map((session) => session.id),
  );
  const authorizer = new runtime.WorkerAuthorizer(deps.machineId, sessionIndex);
  const pending = new runtime.PendingPermissionIndex(deps.permissions);
  /** requestId → sessionId, so `permission:auto-resolved` reaches its log. */
  const permissionSessions = new Map<string, string>();
  const tabsBySession = new Map<string, string>();
  const startingTabs = new Set<string>();
  const resolvedTabs = new Map<string, string>();
  const waiters = new Map<string, (sessionId: string) => void>();
  /** peer id → session id → unsubscribe. */
  const subscriptions = new Map<string, Map<string, () => void>>();

  const deliver = (sessionId: string, event: unknown): void => {
    if (!isCapturedEvent(event)) return;
    // Only sessions this worker drives have a log; other events are not ours.
    const writer = deps.logs.findWriter(sessionId);
    if (!writer) return;
    // degradation-audit: reported - an append failure degrades the writer,
    // which aborts the turn and sends subscribers ctl session-state.
    writer.enqueue(event.type, event.payload).catch(() => undefined);
  };

  const routeKey = (payload: unknown): string | null => {
    const record = isRecord(payload) ? payload : undefined;
    const tabId = text(record, 'tabId');
    if (tabId) {
      const fromTab = driver.sessionForTab(tabId);
      if (fromTab) return fromTab;
      if (startingTabs.has(tabId)) return `${TAB_KEY}${tabId}`;
    }
    const sessionId = text(record, 'sessionId');
    if (sessionId) return sessionId;
    const requestId = text(record, 'id');
    return (requestId && permissionSessions.get(requestId)) || null;
  };

  const capture = new runtime.WorkerEventCapture(routeKey, (key, event) => {
    if (key.startsWith(TAB_KEY))
      driver.route(key.slice(TAB_KEY.length), event, deliver);
    else deliver(key, event);
  });

  const waitForSession = (tabId: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const known = resolvedTabs.get(tabId);
      if (known) {
        resolve(known);
        return;
      }
      const timer = setTimeout(() => {
        waiters.delete(tabId);
        reject(new RemoteMethodError('INTERNAL'));
      }, RESOLUTION_TIMEOUT_MS);
      waiters.set(tabId, (sessionId) => {
        clearTimeout(timer);
        waiters.delete(tabId);
        resolve(sessionId);
      });
    });

  const unsubscribe = (peerId: string, sessionId: string): void => {
    const peerSubscriptions = subscriptions.get(peerId);
    peerSubscriptions?.get(sessionId)?.();
    peerSubscriptions?.delete(sessionId);
  };

  const subscribe = (
    peer: WorkerPeer,
    sessionId: string,
    writer: SessionLogWriter,
    fromSeq: number,
  ): void => {
    // After the attach result is sent: read the head, register with the
    // fan-out and replay up to it in one synchronous step (W7), so no live
    // frame can fall between the replay and the subscription.
    peer.afterReply(() => {
      unsubscribe(peer.id, sessionId);
      let peerSubscriptions = subscriptions.get(peer.id);
      if (!peerSubscriptions) {
        const created = new Map<string, () => void>();
        peerSubscriptions = created;
        subscriptions.set(peer.id, created);
        peer.onClose(() => {
          for (const stop of created.values()) stop();
          subscriptions.delete(peer.id);
        });
      }
      const replayTo = writer.head;
      const subscription = writer.fanOut.subscribe(
        (frame) => peer.send(frame),
        replayTo,
      );
      peerSubscriptions.set(sessionId, subscription.unsubscribe);
      for (const frame of writer.log.replay(fromSeq, replayTo))
        peer.send(frame);
      subscription.finishReplay();
    });
  };

  const holderOf = async (sessionId: string) => {
    try {
      return await deps.lock.holder(sessionId);
    } catch (error) {
      // degradation-audit: reported - the list omits the driver; attach and
      // continue still decide on the lock itself and fail closed.
      deps.log(
        `[ptah-worker] driver lock holder read failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return null;
    }
  };

  const handlersFor = (peer: WorkerPeer): WorkerHandlers => ({
    'machine.info': method<'machine.info'>(async (_params, grant) =>
      deps.machineInfo(grant),
    ),
    'workspaces.list': method<'workspaces.list'>(async (_params, grant) =>
      deps.registry
        .list()
        .filter((item) => grant.workspaceIds.includes(item.workspaceId))
        .map((item) => ({
          workspaceId: item.workspaceId,
          name: item.name,
          path: item.path,
        })),
    ),
    'sessions.list': method<'sessions.list'>(async ({ workspaceId }) => {
      const sessions = await listSessions(workspaceId);
      return Promise.all(
        sessions.map(async (session): Promise<RemoteSessionSummary> => {
          sessionIndex.remember(session.id, workspaceId);
          const driving = driver.driving(session.id);
          const holder = driving ? null : await holderOf(session.id);
          const driverInfo = driving
            ? { kind: owner.kind, label: owner.label }
            : holder
              ? { kind: holder.kind, label: holder.label }
              : undefined;
          return {
            sessionId: session.id,
            title: session.name.slice(0, 1024),
            state: driverInfo ? 'running' : 'idle',
            ...(driverInfo ? { driver: driverInfo } : {}),
            updatedAt: session.lastActivityAt,
            provider: session.providerId || 'claude',
            logged: !!deps.logs.findWriter(session.id)?.latestMark,
          };
        }),
      );
    }),
    'session.attach': method<'session.attach'>(
      async ({ sessionId, afterSeq, epoch }) => {
        const writer = deps.logs.findWriter(sessionId) ?? null;
        const log = writer?.log ?? null;
        // Another epoch is another log: answer as a fresh attach, whose
        // result carries the current epoch (W7 resync).
        const from =
          epoch !== undefined && log && epoch !== log.epoch
            ? undefined
            : afterSeq;
        const result = await driver.attach(sessionId, log, writer, from);
        if (result.mode === 'log' && writer)
          subscribe(peer, sessionId, writer, result.fromSeq);
        return result;
      },
    ),
    'session.detach': method<'session.detach'>(async ({ sessionId }) => {
      unsubscribe(peer.id, sessionId);
      return {};
    }),
    'session.start': method<'session.start'>(
      async ({ workspaceId, prompt, name }) => {
        const workspace = workspaceById(workspaceId);
        if (!workspace) throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
        deps.workspaces.addFolder(workspace.path);
        const tabId = `worker-${randomUUID()}`;
        startingTabs.add(tabId);
        try {
          const turn = await driver.start(
            { tabId, prompt, workspacePath: workspace.path, name },
            async () => {
              const sessionId = await waitForSession(tabId);
              await deps.logs.openSession(sessionId);
              sessionIndex.remember(sessionId, workspaceId);
              tabsBySession.set(sessionId, tabId);
              return sessionId;
            },
            deliver,
          );
          return { sessionId: turn.sessionId, turnId: turn.turnId };
        } catch (error) {
          driver.forgetTab(tabId);
          throw error;
        } finally {
          startingTabs.delete(tabId);
          resolvedTabs.delete(tabId);
          waiters.delete(tabId);
        }
      },
    ),
    'session.continue': method<'session.continue'>(
      async ({ sessionId, prompt }, grant) => {
        if (deps.logs.findWriter(sessionId)?.degraded)
          throw new runtime.SessionLogFailedError();
        const workspaceId = await sessionIndex.workspaceOf(sessionId, grant);
        const workspace = workspaceId ? workspaceById(workspaceId) : undefined;
        if (!workspace) throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
        deps.workspaces.addFolder(workspace.path);
        await deps.logs.openSession(sessionId);
        const tabId = tabsBySession.get(sessionId) ?? `worker-${randomUUID()}`;
        tabsBySession.set(sessionId, tabId);
        const turn = await driver.continue(sessionId, tabId, prompt);
        return { turnId: turn.turnId };
      },
    ),
    'session.stop': method<'session.stop'>(async ({ sessionId }) => {
      if (!driver.driving(sessionId)) return { stopped: false };
      await driver.abort(sessionId);
      return { stopped: true };
    }),
    'permission.respond': method<'permission.respond'>(
      async ({ sessionId, requestId, decision, reason }) => {
        const writer = deps.logs.findWriter(sessionId);
        if (!writer) throw new runtime.PermissionAnswerError();
        const by =
          (peer.tokenId && deps.clientName(peer.tokenId)) || 'Remote client';
        await pending.answer(
          sessionId,
          { id: requestId, decision, ...(reason ? { reason } : {}) },
          by.slice(0, 128),
          writer,
        );
        permissionSessions.delete(requestId);
        return { applied: true };
      },
    ),
    'token.revokeSelf': method<'token.revokeSelf'>(async () => {
      if (!peer.tokenId) throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
      await deps.revokeToken(peer.tokenId);
      peer.afterReply(() => {
        const goodbye: ControlFrame = {
          v: 1,
          kind: 'ctl',
          type: 'goodbye',
          payload: { reason: 'revoked' },
        };
        peer.send(goodbye);
        peer.close(deps.revokedCloseCode);
      });
      return {};
    }),
  });

  return {
    onAppendFailed: driver.onAppendFailed,
    tap(type, payload) {
      const record = isRecord(payload) ? payload : undefined;
      if (
        type === 'permission:request' &&
        record &&
        isPermissionRequest(record)
      ) {
        const tabId = text(record, 'tabId');
        const tabSession = tabId ? driver.sessionForTab(tabId) : undefined;
        pending.add(record, tabSession);
        const sessionId = text(record, 'sessionId') ?? tabSession;
        if (sessionId) permissionSessions.set(record.id, sessionId);
      } else if (type === 'permission:auto-resolved') {
        const requestId = text(record, 'id');
        if (requestId) pending.remove(requestId);
      } else if (type === 'permission:session-cleanup') {
        const sessionId = text(record, 'sessionId');
        if (sessionId) pending.clearSession(sessionId);
      } else if (type === 'session:id-resolved') {
        const tabId = text(record, 'tabId');
        const sessionId = text(record, 'realSessionId');
        if (tabId && sessionId && startingTabs.has(tabId)) {
          resolvedTabs.set(tabId, sessionId);
          waiters.get(tabId)?.(sessionId);
        }
      }
      capture.capture(type, payload);
      if (type === 'permission:auto-resolved') {
        const requestId = text(record, 'id');
        if (requestId) permissionSessions.delete(requestId);
      }
      if (TURN_END_EVENTS.has(type)) {
        const sessionId = routeKey(payload);
        if (sessionId && driver.driving(sessionId))
          driver
            .end(sessionId)
            .catch((error: unknown) =>
              deps.log(
                `[ptah-worker] turn end record failed: ${error instanceof Error ? error.name : 'unknown'}`,
              ),
            );
      }
    },

    async handle(name, params, grant, peer) {
      const outcome = await runtime.dispatchWorkerMethod(
        name,
        params,
        grant,
        authorizer,
        handlersFor(peer),
      );
      if (!outcome.ok) throw new RemoteMethodError(outcome.error.code);
      return outcome.value;
    },

    async abortTurns() {
      for (const sessionId of tabsBySession.keys()) {
        if (!driver.driving(sessionId)) continue;
        try {
          await driver.abort(sessionId);
        } catch (error) {
          deps.log(
            `[ptah-worker] turn abort failed: ${error instanceof Error ? error.name : 'unknown'}`,
          );
        }
      }
    },

    async releaseLocks() {
      // The operator path first: it goes through the chat coordinator's
      // release gate, as `ptah-worker locks release` does.
      for (const held of deps.lock.held()) {
        try {
          await deps.requestRelease(held.sessionId);
        } catch (error) {
          deps.log(
            `[ptah-worker] lock release request failed: ${error instanceof Error ? error.name : 'unknown'}`,
          );
        }
      }
      // The process is stopping: a lock still held now would be stranded.
      for (const held of deps.lock.held()) {
        try {
          await deps.lock.release(held.sessionId, held.nonce);
        } catch (error) {
          deps.log(
            `[ptah-worker] lock release failed: ${error instanceof Error ? error.name : 'unknown'}`,
          );
        }
      }
    },
  };
}
