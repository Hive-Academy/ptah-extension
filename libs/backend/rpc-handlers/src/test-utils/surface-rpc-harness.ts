/**
 * Harness for the `surface:*` RPC specs (TASK_2026_538).
 *
 * Wires the real `RpcHandler` (so `INVALID_PARAMS` is observed on the wire),
 * the real `SurfaceStateService` and the real `SurfaceSubmitTurnService` with a
 * fake agent adapter whose `sendMessageToSession` is spied, a fake lifecycle
 * record and a fake broadcaster. A turn is counted by that spy.
 *
 * Importing this module reaches the `@ptah-extension/vscode-lm-tools` barrel,
 * which reaches workspace-intelligence; each consuming spec mocks that package
 * with `heavy-module-mocks.ts` first.
 */

import { RpcHandler, type Logger } from '@ptah-extension/vscode-core';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import {
  SurfaceStateService,
  type DashboardSurfaceHost,
} from '@ptah-extension/vscode-lm-tools';
import type {
  IAgentAdapter,
  SurfaceComponent,
  SurfaceEnvelope,
  SurfaceUpdatedPayload,
} from '@ptah-extension/shared';
import { SURFACE_ACTIONS } from '@ptah-extension/shared/mcp-apps-contracts/surface';

import { SurfaceSubmitTurnService } from '../lib/chat/session/surface-submit-turn.service';
import type { ChatStreamBroadcaster } from '../lib/chat/streaming/chat-stream-broadcaster.service';
import { SurfaceRpcHandlers } from '../lib/handlers/surface-rpc.handlers';

export const SURFACE_RPC_NOW = 1_800_000_000_000;
export const SURFACE_RPC_TAB = 'tab-1';

let opCounter = 0;
/** A fresh, well-formed operation id issued at `SURFACE_RPC_NOW`. */
export function surfaceOpId(): string {
  opCounter += 1;
  return `op-${SURFACE_RPC_NOW}-test${String(opCounter).padStart(6, '0')}`;
}

/** Every retained `dashboard.*` action with no host behaviour (Req 6.8). */
export const UNSUPPORTED_SURFACE_ACTIONS = SURFACE_ACTIONS.filter(
  (action) => action !== 'surface.submit' && action !== 'dashboard.select',
);

const FORM: SurfaceComponent = {
  kind: 'card',
  id: 'form',
  title: { text: 'Profile' },
  actions: [{ id: 'send', action: 'surface.submit', label: { text: 'Send' } }],
  children: [
    {
      kind: 'text',
      id: 'name',
      label: 'Name',
      path: 'form.name',
      hints: { required: true },
    },
    { kind: 'checkbox', id: 'agree', label: 'Agree', path: 'form.agree' },
  ],
};
const OTHER: SurfaceComponent = {
  kind: 'section',
  id: 'other',
  title: { text: 'Other' },
  actions: [
    { id: 'send-other', action: 'surface.submit', label: { text: 'Other' } },
  ],
  children: [{ kind: 'text', id: 'note', label: 'Note', path: 'other.note' }],
};
/** A table whose only action is `dashboard.select` (action id `pick`). */
export const SURFACE_RPC_TABLE: SurfaceComponent = {
  kind: 'table',
  id: 'people',
  columns: [{ key: 'name', label: { text: 'Name' } }],
  rows: [['Ada'], ['Bob']],
  actions: [
    { id: 'pick', action: 'dashboard.select', label: { text: 'Pick' } },
  ],
};
/** Declares every unsupported action, as `act-<index>`. */
const STAT: SurfaceComponent = {
  kind: 'stat',
  id: 'count',
  value: 3,
  actions: UNSUPPORTED_SURFACE_ACTIONS.map((action, index) => ({
    id: `act-${index}`,
    action,
    label: { text: action },
    ...(action === 'dashboard.open-url'
      ? { url: 'https://example.com/docs' }
      : {}),
  })),
};

/**
 * Surface `profile`: submit `send` scopes `form` (name required, agree);
 * submit `send-other` scopes `other` (note).
 */
export function surfaceRpcEnvelope(
  components: readonly SurfaceComponent[] = [
    FORM,
    OTHER,
    SURFACE_RPC_TABLE,
    STAT,
  ],
): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId: 'profile',
    title: { text: 'Profile' },
    components,
    dataModel: { form: { name: 'Ada' }, other: { note: 'hidden-note' } },
  };
}

export interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

export function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets queued pushes and promise continuations run. */
export const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

export interface SurfaceRpcHarnessOptions {
  readonly withState?: boolean;
  readonly withSubmitTurn?: boolean;
  /** Passed to `SurfaceSubmitTurnService`; omitted means the default. */
  readonly dispatchDeadlineMs?: number;
}

export function setupSurfaceRpc({
  withState = true,
  withSubmitTurn = true,
  dispatchDeadlineMs,
}: SurfaceRpcHarnessOptions = {}) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const pushes: SurfaceUpdatedPayload[] = [];
  const host: DashboardSurfaceHost = {
    getActiveWebviews: () => ['ptah.main'],
    sendMessage: async (_view: string, _type: string, payload: unknown) => {
      pushes.push(payload as SurfaceUpdatedPayload);
      return true;
    },
  };
  const state = new SurfaceStateService(
    logger,
    { getHost: () => host },
    {
      clock: () => SURFACE_RPC_NOW,
      createNonce: () => 'nonce-0123456789abcdef',
    },
  );

  const record = {
    tabId: SURFACE_RPC_TAB,
    realSessionId: null,
    turnInFlight: false,
    messageQueue: [] as unknown[],
  };
  const sendMessageToSession = jest.fn(
    async (_id: string, _content: string, _options?: unknown): Promise<void> =>
      undefined,
  );
  const adapter = {
    isSessionActive: jest.fn(() => true),
    sendMessageToSession,
  } as unknown as IAgentAdapter;
  const lifecycle = {
    find: jest.fn((id: string) =>
      id === SURFACE_RPC_TAB ? record : undefined,
    ),
  } as unknown as SessionLifecycleManager;
  const broadcaster = {
    isStreaming: jest.fn((id: string) => id === SURFACE_RPC_TAB),
  } as unknown as ChatStreamBroadcaster;
  const submitTurn = new SurfaceSubmitTurnService(
    logger,
    adapter,
    lifecycle,
    broadcaster,
    dispatchDeadlineMs === undefined ? undefined : { dispatchDeadlineMs },
  );

  const rpc = new RpcHandler(logger, undefined, undefined);
  new SurfaceRpcHandlers(
    logger,
    rpc,
    withState ? state : undefined,
    withSubmitTurn ? submitTurn : undefined,
  ).register();

  const call = async (method: string, params: unknown) =>
    rpc.handleMessage({ method, params, correlationId: `c-${method}` });
  /** The `data` of a successful call; throws otherwise. */
  const ok = async (method: string, params: unknown) => {
    const response = await call(method, params);
    if (!response.success)
      throw new Error(`${method} failed: ${String(response.error)}`);
    return response.data as Record<string, unknown>;
  };
  /** Agent-creates `profile`; returns its revision. */
  const create = (surface: SurfaceEnvelope = surfaceRpcEnvelope()) => {
    const result = state.applyAgentUpdate(
      SURFACE_RPC_TAB,
      { operation: 'create', surface },
      'call-create',
    );
    if (result.status !== 'applied') throw new Error('create failed');
    return result.revision;
  };
  /** The stored view of `profile`, or undefined when absent. */
  const view = () => {
    const read = state.read(SURFACE_RPC_TAB, 'profile');
    return read.status === 'found' ? read.surfaces[0] : undefined;
  };
  /** Mutation params for `profile` at `revision`, with a fresh operation id. */
  const base = (revision: number) => ({
    routingId: SURFACE_RPC_TAB,
    surfaceId: 'profile',
    revision,
    operationId: surfaceOpId(),
  });
  return {
    state,
    logger,
    pushes,
    record,
    sendMessageToSession,
    call,
    ok,
    create,
    view,
    base,
  };
}
