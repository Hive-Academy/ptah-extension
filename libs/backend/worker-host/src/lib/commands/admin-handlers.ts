import type * as WorkerProtocol from '@ptah-extension/worker-protocol';
import type {
  AdminMethod,
  HeldLock,
  ReadinessReport,
  TokenGrantSummary,
  WorkerGrant,
  WorkerIdentity,
  WorkerMethodParams,
  WorkerMethodResult,
} from '@ptah-extension/worker-protocol';
import type {
  PairingWindow,
  RegisteredWorkspace,
  TokenStore,
  WorkspaceRegistry,
} from '@ptah-extension/worker-runtime';
import { RemoteMethodError } from './remote-sessions';

/** The pairing window as `admin.status` reports it. */
export class AdminPairingStatus {
  private open: { expiresAt: number; attemptsLeft: number } | undefined;

  opened(expiresAt: number, attemptsLeft: number): void {
    this.open = { expiresAt, attemptsLeft };
  }

  /** Wire into the `PairingWindow` state callback. */
  readonly changed = (state: {
    windowOpen: boolean;
    attemptsLeft: number;
  }): void => {
    if (this.open)
      this.open = state.windowOpen
        ? { ...this.open, attemptsLeft: state.attemptsLeft }
        : undefined;
  };

  snapshot(
    now: number = Date.now(),
  ): WorkerMethodResult<'admin.status'>['pairing'] {
    return this.open && now < this.open.expiresAt
      ? { open: true, ...this.open }
      : { open: false };
  }
}

/** What the admin methods change on the live service's connections. */
export interface AdminConnections {
  /** Closes every live connection of the token; returns how many. */
  closeToken(tokenId: string): number;
  refreshGrant(tokenId: string, grant: WorkerGrant): void;
}

export interface AdminHandlerDeps {
  /** The lazily imported protocol module: method names and param schemas. */
  protocol: Pick<
    typeof WorkerProtocol,
    'isAdminMethod' | 'parseParams' | 'PROTOCOL_VERSION'
  >;
  registry: WorkspaceRegistry;
  tokens: TokenStore;
  pairing: PairingWindow;
  pairingStatus: AdminPairingStatus;
  identity: WorkerIdentity;
  readiness: () => ReadinessReport;
  locks: () => Promise<HeldLock[]>;
  connections: AdminConnections;
}

export type AdminHandler = (
  method: string,
  params: unknown,
) => Promise<unknown>;

type Handlers = {
  readonly [M in AdminMethod]: (
    params: WorkerMethodParams<M>,
  ) => Promise<WorkerMethodResult<M>>;
};

/**
 * The admin channel's methods (`state === 'admin'` only). Every handler gets
 * params parsed with its `WORKER_METHOD_SCHEMAS` row; bad params answer
 * INVALID_PARAMS and an unknown token or workspace NOT_FOUND_OR_FORBIDDEN.
 */
export function createAdminHandler(deps: AdminHandlerDeps): AdminHandler {
  const { registry, tokens } = deps;
  const resolveIds = (values: readonly string[]): string[] => {
    try {
      return registry.resolveIds(values);
    } catch (error) {
      if (hasCode(error, 'UNKNOWN_WORKSPACE'))
        throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
      throw error;
    }
  };
  const grantsList = (): TokenGrantSummary[] =>
    tokens.list().map((item) => ({
      tokenId: item.tokenId,
      clientName: item.clientName,
      createdAt: Date.parse(item.createdAt),
      lastUsedAt: item.lastUsedAt ? Date.parse(item.lastUsedAt) : null,
      grant: item.grant,
      ...(item.revokedAt ? { revokedAt: Date.parse(item.revokedAt) } : {}),
    }));
  const summary = (item: RegisteredWorkspace) => ({
    workspaceId: item.workspaceId,
    name: item.name,
    path: item.path,
  });

  const handlers: Handlers = {
    'admin.pairing.open': async (input) => {
      const available = registry.list();
      const ids = input.workspaces && resolveIds(input.workspaces);
      const opened = deps.pairing.open(input.ttlSeconds, ids);
      deps.pairingStatus.opened(opened.expiresAt, 5);
      return {
        ...opened,
        workspaces: available
          .filter((item) => opened.workspaces.includes(item.workspaceId))
          .map(summary),
      };
    },
    'admin.grants.list': async () => grantsList(),
    'admin.grants.add': async (input) => {
      const ids = resolveIds(input.workspaces);
      const record = await tokens.addWorkspaces(input.tokenId, ids);
      if (!record) throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
      // Live connections of the token use the new grant from their next call.
      deps.connections.refreshGrant(record.tokenId, record.grant);
      return { tokenId: record.tokenId, grant: record.grant };
    },
    'admin.grants.revoke': async (input) => {
      const record = await tokens.revoke(input.tokenId);
      if (!record?.revokedAt)
        throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
      return {
        tokenId: record.tokenId,
        revokedAt: Date.parse(record.revokedAt),
        connectionsClosed: deps.connections.closeToken(record.tokenId),
      };
    },
    'admin.workspace.add': async (input) => {
      try {
        return summary(await registry.register(input.path));
      } catch (error) {
        if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR'))
          throw new RemoteMethodError('INVALID_PARAMS');
        throw error;
      }
    },
    'admin.workspace.remove': async (input) => {
      const removed = await registry.unregister(input.workspace);
      if (!removed) throw new RemoteMethodError('NOT_FOUND_OR_FORBIDDEN');
      return summary(removed);
    },
    'admin.status': async () => ({
      ...deps.identity,
      protocol: deps.protocol.PROTOCOL_VERSION,
      readiness: deps.readiness(),
      pairing: deps.pairingStatus.snapshot(),
      grants: grantsList(),
      locks: await deps.locks(),
    }),
  };

  const { isAdminMethod, parseParams } = deps.protocol;
  const invoke = <M extends AdminMethod>(
    method: M,
    params: unknown,
  ): Promise<WorkerMethodResult<M>> => {
    const parsed = parseParams(method, params);
    if (!parsed.ok) throw new RemoteMethodError('INVALID_PARAMS');
    // `Handlers` pairs each method with its own params and result, so the
    // generic lookup is exact; TypeScript cannot correlate the two indexes.
    const handler = handlers[method] as (
      params: WorkerMethodParams<M>,
    ) => Promise<WorkerMethodResult<M>>;
    return handler(parsed.value);
  };
  return async (method, params) => {
    if (!isAdminMethod(method)) throw new RemoteMethodError('INVALID_PARAMS');
    return invoke(method, params);
  };
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
