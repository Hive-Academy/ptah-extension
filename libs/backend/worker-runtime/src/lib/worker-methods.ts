import {
  isWorkerErrorCode,
  REMOTE_METHODS,
  WORKER_METHOD_SCHEMAS,
  workerError,
  type RemoteMethod,
  type WorkerGrant,
  type WorkerError,
} from '@ptah-extension/worker-protocol';
import type { WorkerResource } from './worker-authorizer';
import { WorkerAuthorizer } from './worker-authorizer';

type MethodRow = {
  readonly method: RemoteMethod;
  readonly params: (typeof WORKER_METHOD_SCHEMAS)[RemoteMethod]['params'];
  readonly result: (typeof WORKER_METHOD_SCHEMAS)[RemoteMethod]['result'];
  readonly resources: (
    params: Record<string, unknown>,
  ) => readonly WorkerResource[];
  readonly handler: RemoteMethod;
};
const machine = (): readonly WorkerResource[] => [{ kind: 'machine' }];
const token = (): readonly WorkerResource[] => [{ kind: 'token' }];
const workspace = (
  params: Record<string, unknown>,
): readonly WorkerResource[] => [
  { kind: 'workspace', workspaceId: String(params.workspaceId) },
];
const session = (
  params: Record<string, unknown>,
): readonly WorkerResource[] => [
  { kind: 'session', sessionId: String(params.sessionId) },
];
function row<M extends RemoteMethod>(
  method: M,
  resources: MethodRow['resources'],
): MethodRow {
  return {
    method,
    ...WORKER_METHOD_SCHEMAS[method],
    resources,
    handler: method,
  };
}
/** The single source of truth for the remote callable surface. */
export const WORKER_METHODS = {
  'machine.info': row('machine.info', machine),
  'workspaces.list': row('workspaces.list', machine),
  'sessions.list': row('sessions.list', workspace),
  'session.attach': row('session.attach', session),
  'session.detach': row('session.detach', session),
  'session.start': row('session.start', workspace),
  'session.continue': row('session.continue', session),
  'session.stop': row('session.stop', session),
  'permission.respond': row('permission.respond', session),
  'token.revokeSelf': row('token.revokeSelf', token),
} as const satisfies Record<RemoteMethod, MethodRow>;

export type WorkerMethodHandler = (
  params: unknown,
  grant: WorkerGrant,
) => Promise<unknown>;
export type WorkerHandlers = Readonly<
  Record<RemoteMethod, WorkerMethodHandler>
>;
export type WorkerDispatchResult =
  { ok: true; value: unknown } | { ok: false; error: WorkerError };

/** Parse, authorize, invoke, validate. No handler can run before the grant check. */
export async function dispatchWorkerMethod(
  method: string,
  params: unknown,
  grant: WorkerGrant,
  authorizer: WorkerAuthorizer,
  handlers: WorkerHandlers,
): Promise<WorkerDispatchResult> {
  if (!Object.hasOwn(WORKER_METHODS, method))
    return { ok: false, error: workerError('INVALID_PARAMS') };
  const name = method as RemoteMethod;
  const row = WORKER_METHODS[name];
  const parsed = row.params.safeParse(params);
  if (!parsed.success)
    return { ok: false, error: workerError('INVALID_PARAMS') };
  const denied = await authorizer.check(
    grant,
    row.resources(parsed.data as Record<string, unknown>),
  );
  if (denied) return { ok: false, error: denied };
  try {
    const value = await handlers[row.handler](parsed.data, grant);
    const result = row.result.safeParse(value);
    if (!result.success) return { ok: false, error: workerError('INTERNAL') };
    return { ok: true, value: result.data };
  } catch (error) {
    // A typed refusal (TURN_IN_FLIGHT, WORKER_BUSY, ALREADY_ANSWERED, ...)
    // keeps its code and fixed copy; anything else stays INTERNAL.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    return {
      ok: false,
      error: workerError(isWorkerErrorCode(code) ? code : 'INTERNAL'),
    };
  }
}

// Compile-time parity and a runtime drift spec guard changes to the protocol list.
export const WORKER_REMOTE_METHOD_NAMES: readonly RemoteMethod[] =
  REMOTE_METHODS;
