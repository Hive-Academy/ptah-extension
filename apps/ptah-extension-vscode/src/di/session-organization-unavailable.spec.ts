/**
 * Session organization on the VS Code host — the feature reports itself
 * unavailable (TASK_2026_580 A5.2, plan component 9, D5, AC7 narrowed).
 *
 * The `sessionOrganization` manifest family is `requires: []`, so this host
 * constructs `SessionOrganizationRpcHandlers` and serves all six methods. Its
 * DI phases never call `registerSessionOrganizationServices` (no SQLite here),
 * so `SESSION_ORGANIZATION_TOKENS.SERVICE` stays unbound and the handler —
 * whose service injection is optional — answers every mutation with
 * `organization-unavailable` and `session:listForTasks` with
 * `{ available: false }`, without subscribing to change events.
 *
 * The handler class is the one `resolveRpcHandlerPlan(createVscodeRpcHostProfile())`
 * plans (the same derivation `registerRpcSurface` executes), resolved from a
 * container built with the real vscode-core registrations and called through
 * the real `RpcHandler.handleMessage` (pattern: `surface-composition.spec.ts`).
 */

import 'reflect-metadata';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import {
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { SESSION_ORGANIZATION_TOKENS } from '@ptah-extension/session-organization';
import {
  SessionOrganizationRpcHandlers,
  deriveRpcSurface,
  resolveRpcHandlerPlan,
} from '@ptah-extension/rpc-handlers';

import { createVscodeRpcHostProfile } from '../rpc-host-profile';

const WORKSPACE = '/fake/workspace';
const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const TASK_ID = 'TASK_2026_580_9f77';
const PR_URL = 'https://github.com/acme/repo/pull/7';

const MUTATIONS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['session:setOrganization', { sessionId: SESSION_ID, priority: 'high' }],
  [
    'session:linkTask',
    { sessionId: SESSION_ID, taskId: TASK_ID, role: 'primary' },
  ],
  ['session:unlinkTask', { sessionId: SESSION_ID, taskId: TASK_ID }],
  ['session:addPrLink', { sessionId: SESSION_ID, url: PR_URL }],
  ['session:removePrLink', { sessionId: SESSION_ID, url: PR_URL }],
];

interface Composed {
  container: DependencyContainer;
  logger: Logger;
  rpc: RpcHandler;
  metadataStore: { get: jest.Mock; getForWorkspace: jest.Mock };
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
}

/**
 * A VS Code-shaped container: real vscode-core registrations (including the
 * real `RpcHandler`), the handler's required collaborators as fakes, and —
 * like this host's DI phases — no session-organization registration.
 */
function compose(): Composed {
  const logger = makeLogger();
  const c = rootContainer.createChildContainer();
  c.register(TOKENS.LOGGER, { useValue: logger });
  registerVsCodeCorePlatformAgnostic(c, logger, {
    includeLicensingAndAuth: false,
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceRoot: jest.fn(() => WORKSPACE),
      getWorkspaceFolders: jest.fn(() => [WORKSPACE]),
    },
  });
  const metadataStore = {
    get: jest.fn(async () => undefined),
    getForWorkspace: jest.fn(async () => []),
  };
  c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
    useValue: metadataStore,
  });
  c.register(SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY, {
    useValue: { get: jest.fn(() => undefined) },
  });

  const profile = createVscodeRpcHostProfile(logger);
  const step = resolveRpcHandlerPlan(profile).find(
    (s) => s.key === 'sessionOrganization',
  );
  if (!step) {
    throw new Error(
      "resolveRpcHandlerPlan(createVscodeRpcHostProfile(...)) has no 'sessionOrganization' step",
    );
  }
  c.resolve(step.ctor).register();

  return {
    container: c,
    logger,
    rpc: c.resolve<RpcHandler>(TOKENS.RPC_HANDLER),
    metadataStore,
  };
}

describe('VS Code — session organization is planned and served', () => {
  const profile = createVscodeRpcHostProfile(makeLogger());

  it('plans SessionOrganizationRpcHandlers as a library-owned handler', () => {
    const step = resolveRpcHandlerPlan(profile).find(
      (s) => s.key === 'sessionOrganization',
    );
    expect(step).toEqual({
      key: 'sessionOrganization',
      ctor: SessionOrganizationRpcHandlers,
      libOwned: true,
    });
  });

  it('serves all six organization methods', () => {
    const { registered } = deriveRpcSurface(profile);
    expect(registered).toEqual(
      expect.arrayContaining([...SessionOrganizationRpcHandlers.METHODS]),
    );
  });
});

describe('VS Code — session organization reports itself unavailable', () => {
  it('resolves the handler with no organization service or recorder bound', () => {
    const { container: c, logger, rpc } = compose();

    expect(c.isRegistered(SESSION_ORGANIZATION_TOKENS.SERVICE, true)).toBe(
      false,
    );
    expect(
      c.isRegistered(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, true),
    ).toBe(false);
    expect(rpc.getRegisteredMethods()).toEqual(
      expect.arrayContaining([...SessionOrganizationRpcHandlers.METHODS]),
    );
    // Without a service the constructor has nothing to subscribe to; the
    // handler records that it registered in the unavailable shape.
    expect(logger.debug).toHaveBeenCalledWith(
      'Session organization RPC handlers registered',
      expect.objectContaining({ available: false }),
    );
  });

  it.each(MUTATIONS)(
    '%s answers organization-unavailable without reading session metadata',
    async (method, params) => {
      const { rpc, metadataStore } = compose();

      const response = await rpc.handleMessage({
        method,
        params,
        correlationId: `c-${method}`,
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: false,
        reason: 'organization-unavailable',
        message: expect.any(String),
      });
      expect(metadataStore.get).not.toHaveBeenCalled();
    },
  );

  it('session:listForTasks answers { available: false }', async () => {
    const { rpc, metadataStore } = compose();

    const response = await rpc.handleMessage({
      method: 'session:listForTasks',
      params: { workspacePath: WORKSPACE, taskIds: [TASK_ID] },
      correlationId: 'c-listForTasks',
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ available: false });
    expect(metadataStore.getForWorkspace).not.toHaveBeenCalled();
  });

  it('still validates params before answering unavailable', async () => {
    const { rpc } = compose();

    const response = await rpc.handleMessage({
      method: 'session:setOrganization',
      params: { sessionId: SESSION_ID },
      correlationId: 'c-invalid',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('INVALID_PARAMS');
  });
});

/**
 * The reason the service is absent: no production file in this app wires the
 * session-organization lib. Wiring it here (without SQLite) would turn the
 * feature on against a store that cannot open.
 */
describe('VS Code — no session-organization registration in the host', () => {
  it('never imports or registers the session-organization services', () => {
    const srcRoot = path.join(__dirname, '..');
    const sources = (
      fs.readdirSync(srcRoot, { recursive: true }) as string[]
    ).filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));
    expect(sources).toContain('main.ts');

    const offenders = sources.filter((file) => {
      const source = fs.readFileSync(path.join(srcRoot, file), 'utf8');
      return (
        source.includes('@ptah-extension/session-organization') ||
        source.includes('registerSessionOrganizationServices') ||
        source.includes('startSessionOrganization')
      );
    });

    expect(offenders).toEqual([]);
  });
});
