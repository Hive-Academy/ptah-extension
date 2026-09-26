/**
 * CapabilityRpcHandlers — unit specs (TASK_2026_560, Batch 10).
 *
 * The resolver is a mock of the shared `ICapabilityResolver`; nothing from
 * `@ptah-extension/cli-agent-runtime` is loaded. Locked in here:
 *
 *  - the three `capabilities:*` methods register under an allowed prefix;
 *  - the active workspace path is the `cwd` every resolver call receives, and
 *    no workspace is `WORKSPACE_NOT_OPEN` without touching the resolver;
 *  - zod at entry, including `explicit: true` with `scope: 'global'` refused;
 *  - an id missing from a verified inventory is refused before any write;
 *  - a rejected write is an RPC error naming the item with a safe reason and
 *    no internal text (AC-1.4);
 *  - no row carries `schemaTokens` yet, so the UI shows "size unknown" (AC-5.2).
 */

import 'reflect-metadata';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  ALLOWED_METHOD_PREFIXES,
  RpcUserError,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  CAPABILITY_POLICY_UNKNOWN_ERROR_NAME,
  type CapabilityEntry,
  type CapabilityInventory,
  type EffectiveCapabilitySet,
  type ICapabilityResolver,
  type RpcMethodName,
} from '@ptah-extension/shared';
import {
  CapabilitiesSetEnabledSchema,
  CapabilityRpcHandlers,
} from './capability-rpc.handlers';

type RegisteredHandler = (params: unknown) => Promise<unknown>;

const WORKSPACE = '/repo/project';

function createLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createRpcHandler(): {
  rpcHandler: RpcHandler;
  registered: Map<string, RegisteredHandler>;
} {
  const registered = new Map<string, RegisteredHandler>();
  const rpcHandler = {
    registerMethod: (method: string, handler: RegisteredHandler) => {
      const prefix = method.slice(0, method.indexOf(':') + 1);
      if (!(ALLOWED_METHOD_PREFIXES as readonly string[]).includes(prefix)) {
        throw new Error(`Method prefix not allowed: ${prefix}`);
      }
      registered.set(method, handler);
    },
  } as unknown as RpcHandler;
  return { rpcHandler, registered };
}

function entry(overrides: Partial<CapabilityEntry> = {}): CapabilityEntry {
  return {
    kind: 'mcp',
    id: 'github',
    label: 'github',
    sources: [{ scope: 'workspace', path: `${WORKSPACE}/.mcp.json` }],
    effectiveEnabled: true,
    inheritedFrom: 'default',
    ...overrides,
  } as CapabilityEntry;
}

function inventory(
  entries: CapabilityEntry[],
  status: CapabilityInventory['status'] = 'verified',
): CapabilityInventory {
  return { status, reasons: [], entries };
}

const EFFECTIVE: EffectiveCapabilitySet = {
  physicalRoot: WORKSPACE,
  policyKey: WORKSPACE,
  status: 'verified',
  reasons: [],
  ptahEnabled: true,
  deniedMcpServers: [],
  approvedProjectMcpServers: [],
  deniedSkillNames: [],
  disabledPluginIds: [],
  harnessFingerprint: 'fp',
};

function createResolver(
  inv: CapabilityInventory = inventory([
    entry(),
    entry({ kind: 'skill', id: 'review', label: 'review' }),
  ]),
): jest.Mocked<ICapabilityResolver> {
  return {
    resolve: jest.fn().mockResolvedValue(EFFECTIVE),
    list: jest.fn().mockResolvedValue(inv),
    set: jest
      .fn()
      .mockImplementation(async (request) =>
        entry({ kind: request.kind, id: request.id }),
      ),
    setExplicit: jest
      .fn()
      .mockImplementation(async (_cwd, kind, id) => entry({ kind, id })),
  };
}

function setup(
  options: {
    root?: string | undefined;
    resolver?: jest.Mocked<ICapabilityResolver>;
  } = {},
) {
  const logger = createLogger();
  const { rpcHandler, registered } = createRpcHandler();
  const root = 'root' in options ? options.root : WORKSPACE;
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn(() => root),
  } as unknown as IWorkspaceProvider;
  const resolver = options.resolver ?? createResolver();
  new CapabilityRpcHandlers(
    logger,
    rpcHandler,
    workspaceProvider,
    resolver,
  ).register();
  const call = (method: string, params?: unknown) => {
    const handler = registered.get(method);
    if (!handler) throw new Error(`${method} not registered`);
    return handler(params);
  };
  return { logger, resolver, registered, call };
}

describe('CapabilityRpcHandlers', () => {
  it('declares exactly the three capabilities methods', () => {
    const methods: readonly RpcMethodName[] = CapabilityRpcHandlers.METHODS;
    expect(methods).toEqual([
      'capabilities:getState',
      'capabilities:getEffective',
      'capabilities:setEnabled',
    ]);
  });

  it('registers every method under the allowed `capabilities:` prefix', () => {
    const { registered } = setup();
    expect([...registered.keys()].sort()).toEqual(
      [...CapabilityRpcHandlers.METHODS].sort(),
    );
  });

  describe('capabilities:getState', () => {
    it('lists the inventory for the active workspace', async () => {
      const inv = inventory([entry()]);
      const resolver = createResolver(inv);
      const { call } = setup({ resolver });

      await expect(call('capabilities:getState', {})).resolves.toEqual(inv);
      expect(resolver.list).toHaveBeenCalledWith(WORKSPACE);
    });

    it('answers with no params at all', async () => {
      const { call } = setup();
      await expect(
        call('capabilities:getState', undefined),
      ).resolves.toBeDefined();
    });

    it('omits schemaTokens on every row (size unknown)', async () => {
      const { call } = setup();
      const result = (await call(
        'capabilities:getState',
        {},
      )) as CapabilityInventory;
      for (const row of result.entries) {
        expect('schemaTokens' in row).toBe(false);
      }
    });

    it('refuses with WORKSPACE_NOT_OPEN when no workspace is open', async () => {
      const { call, resolver } = setup({ root: undefined });

      await expect(call('capabilities:getState', {})).rejects.toMatchObject({
        errorCode: 'WORKSPACE_NOT_OPEN',
      });
      expect(resolver.list).not.toHaveBeenCalled();
    });

    it('turns a list failure into a safe error without internal text', async () => {
      const resolver = createResolver();
      resolver.list.mockRejectedValue(
        new Error('EACCES: /home/user/.ptah/capabilities/secret'),
      );
      const { call } = setup({ resolver });

      const error = await call('capabilities:getState', {}).catch(
        (caught: unknown) => caught as Error,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        'Could not read the capability list',
      );
      expect((error as Error).message).not.toContain('EACCES');
    });
  });

  describe('capabilities:getEffective', () => {
    it('resolves the effective set for the active workspace', async () => {
      const { call, resolver } = setup();

      await expect(call('capabilities:getEffective', {})).resolves.toEqual(
        EFFECTIVE,
      );
      expect(resolver.resolve).toHaveBeenCalledWith(WORKSPACE);
    });

    it('refuses with WORKSPACE_NOT_OPEN when no workspace is open', async () => {
      const { call, resolver } = setup({ root: undefined });

      await expect(call('capabilities:getEffective', {})).rejects.toMatchObject(
        { errorCode: 'WORKSPACE_NOT_OPEN' },
      );
      expect(resolver.resolve).not.toHaveBeenCalled();
    });
  });

  describe('capabilities:setEnabled', () => {
    it('writes one ordinary toggle with the workspace as cwd', async () => {
      const { call, resolver } = setup();

      const result = await call('capabilities:setEnabled', {
        scope: 'workspace',
        kind: 'mcp',
        id: 'github',
        enabled: false,
      });

      expect(resolver.set).toHaveBeenCalledWith({
        cwd: WORKSPACE,
        scope: 'workspace',
        kind: 'mcp',
        id: 'github',
        enabled: false,
      });
      expect(resolver.setExplicit).not.toHaveBeenCalled();
      expect(result).toEqual({ entry: entry({ kind: 'mcp', id: 'github' }) });
    });

    it('routes explicit workspace MCP ON to setExplicit', async () => {
      const { call, resolver } = setup();

      await call('capabilities:setEnabled', {
        scope: 'workspace',
        kind: 'mcp',
        id: 'github',
        enabled: true,
        explicit: true,
      });

      expect(resolver.setExplicit).toHaveBeenCalledWith(
        WORKSPACE,
        'mcp',
        'github',
        true,
      );
      expect(resolver.set).not.toHaveBeenCalled();
    });

    it('rejects explicit: true with scope: global at the boundary', async () => {
      const { call, resolver } = setup();

      const error = await call('capabilities:setEnabled', {
        scope: 'global',
        kind: 'mcp',
        id: 'github',
        enabled: true,
        explicit: true,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RpcUserError);
      expect(error).toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect((error as Error).message).toContain('explicit');
      expect(resolver.list).not.toHaveBeenCalled();
      expect(resolver.set).not.toHaveBeenCalled();
      expect(resolver.setExplicit).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a non-MCP kind',
        { scope: 'workspace', kind: 'skill', id: 'x', enabled: true },
      ],
      [
        'an OFF value',
        { scope: 'workspace', kind: 'mcp', id: 'x', enabled: false },
      ],
    ])('rejects explicit: true with %s', (_label, base) => {
      expect(
        CapabilitiesSetEnabledSchema.safeParse({ ...base, explicit: true })
          .success,
      ).toBe(false);
    });

    it.each([
      ['an unknown scope', { scope: 'project' }],
      ['an unknown kind', { kind: 'agent' }],
      ['an empty id', { id: '' }],
      ['a control character in the id', { id: 'git\nhub' }],
      ['a non-boolean enabled', { enabled: 'yes' }],
    ])('rejects %s with INVALID_PARAMS', async (_label, patch) => {
      const { call, resolver } = setup();

      await expect(
        call('capabilities:setEnabled', {
          scope: 'workspace',
          kind: 'mcp',
          id: 'github',
          enabled: true,
          ...patch,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(resolver.set).not.toHaveBeenCalled();
    });

    it('refuses an id the verified inventory does not list', async () => {
      const { call, resolver } = setup();

      await expect(
        call('capabilities:setEnabled', {
          scope: 'workspace',
          kind: 'mcp',
          id: 'not-declared',
          enabled: true,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(resolver.set).not.toHaveBeenCalled();
    });

    it('defers the id check to the resolver when the inventory is unverified', async () => {
      const resolver = createResolver(inventory([], 'unverified'));
      const { call } = setup({ resolver });

      await call('capabilities:setEnabled', {
        scope: 'workspace',
        kind: 'plugin',
        id: 'from-an-unreadable-source',
        enabled: false,
      });

      expect(resolver.set).toHaveBeenCalled();
    });

    it('rejects a workspace toggle with WORKSPACE_NOT_OPEN when no workspace is open', async () => {
      const { call, resolver } = setup({ root: undefined });

      const error = await call('capabilities:setEnabled', {
        scope: 'workspace',
        kind: 'mcp',
        id: 'github',
        enabled: false,
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ errorCode: 'WORKSPACE_NOT_OPEN' });
      expect((error as Error).message).toContain('workspace');
      expect(resolver.list).not.toHaveBeenCalled();
      expect(resolver.set).not.toHaveBeenCalled();
    });

    it('rejects a global toggle with WORKSPACE_NOT_OPEN too (the resolver needs a cwd)', async () => {
      const { call, resolver } = setup({ root: undefined });

      await expect(
        call('capabilities:setEnabled', {
          scope: 'global',
          kind: 'skill',
          id: 'review',
          enabled: false,
        }),
      ).rejects.toMatchObject({ errorCode: 'WORKSPACE_NOT_OPEN' });
      expect(resolver.set).not.toHaveBeenCalled();
    });

    it('turns a store write failure into an RPC error naming the item (AC-1.4)', async () => {
      const resolver = createResolver();
      const storeError = new Error(
        'rename failed: EPERM C:\\Users\\me\\.ptah\\capabilities\\mcp__l_github.json',
      );
      storeError.name = 'CapabilityToggleStoreError';
      resolver.set.mockRejectedValue(storeError);
      const { call, logger } = setup({ resolver });

      const error = (await call('capabilities:setEnabled', {
        scope: 'workspace',
        kind: 'mcp',
        id: 'github',
        enabled: false,
      }).catch((caught: unknown) => caught)) as Error;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'Could not turn off MCP server "github" (workspace): the setting could not be saved.',
      );
      expect(error.message).not.toContain('EPERM');
      expect(error.message).not.toContain('.ptah');
      // The internal detail is kept in the host log.
      expect(logger.error).toHaveBeenCalledWith(
        'RPC: capabilities:setEnabled failed',
        expect.objectContaining({
          id: 'github',
          errorName: 'CapabilityToggleStoreError',
        }),
      );
    });

    it('names the policy as unreadable when the resolver fails closed', async () => {
      const resolver = createResolver();
      const policyError = new Error('plugin config unreadable');
      policyError.name = CAPABILITY_POLICY_UNKNOWN_ERROR_NAME;
      resolver.set.mockRejectedValue(policyError);
      const { call } = setup({ resolver });

      await expect(
        call('capabilities:setEnabled', {
          scope: 'global',
          kind: 'skill',
          id: 'review',
          enabled: true,
        }),
      ).rejects.toThrow(
        'Could not turn on skill "review" (global): the capability policy could not be read.',
      );
    });

    it('uses a generic safe reason for any other failure', async () => {
      const resolver = createResolver();
      resolver.set.mockRejectedValue(new TypeError('x is undefined'));
      const { call } = setup({ resolver });

      await expect(
        call('capabilities:setEnabled', {
          scope: 'workspace',
          kind: 'skill',
          id: 'review',
          enabled: true,
        }),
      ).rejects.toThrow(
        'Could not turn on skill "review" (workspace): the change was not applied.',
      );
    });
  });
});
