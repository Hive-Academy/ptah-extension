import { MachinesService } from './machines-service';
import { MachineRegistry } from './machine-registry';
import { MachineTokenStore } from './machine-token-store';
import {
  MachineConnection,
  type MachineConnectionOptions,
} from './machine-connection';

describe('MachinesService', () => {
  it('serializes add and offline removal while deleting local credentials', async () => {
    let machines: { machineId: string; alias: string }[] = [];
    const registry = {
      read: async () => ({ machines }),
      write: async (value: { machines: typeof machines }) => {
        machines = value.machines;
      },
    } as unknown as MachineRegistry;
    const deleted: string[] = [];
    const tokens = {
      get: async () => undefined,
      delete: async (id: string) => {
        deleted.push(id);
      },
    } as unknown as MachineTokenStore;
    const service = new MachinesService({
      registry,
      tokens,
      ptahVersion: '1',
      webviewManager: { broadcastMessage: async () => undefined },
      sshAliases: async () => ['host'],
    });
    const added = await service.add('host');
    expect(added.machine.state).toBe('unpaired');
    expect(await service.remove(added.machine.machineId)).toEqual({
      removed: true,
      revokedOnWorker: false,
    });
    expect(machines).toEqual([]);
    expect(deleted).toEqual([added.machine.machineId]);
    service.dispose();
    service.dispose();
  });
});

describe('MachinesService removal and pairing', () => {
  function fixture(
    state: 'connected' | 'unpaired',
    revoke: () => Promise<object>,
  ) {
    let machines = [{ machineId: 'm', alias: 'host' }];
    const order: string[] = [];
    const connection = {
      machineId: 'm',
      alias: 'host',
      state,
      call: jest.fn(async (method: string) => {
        order.push(method);
        return revoke();
      }),
      dispose: jest.fn(() => order.push('dispose')),
      exchange: jest.fn(async () => ({
        token: 'secret-token',
        workerMachineId: 'm',
        tokenId: 't',
        grant: { machineId: 'm', workspaceIds: [] },
      })),
      setToken: jest.fn(() => {
        connection.state = 'connected';
      }),
      clearToken: jest.fn(),
      setWorkerMachineId: jest.fn(),
      connect: jest.fn(async () => undefined),
    };
    const registry = {
      read: async () => ({ machines }),
      write: async (value: { machines: typeof machines }) => {
        machines = value.machines;
        order.push('registry');
      },
    } as unknown as MachineRegistry;
    const tokens = {
      get: async () => undefined,
      set: jest.fn(async () => {
        order.push('token.set');
      }),
      delete: jest.fn(async () => {
        order.push('token.delete');
      }),
    } as unknown as MachineTokenStore;
    const service = new MachinesService({
      registry,
      tokens,
      ptahVersion: '1',
      webviewManager: { broadcastMessage: async () => undefined },
      createConnection: () => connection as unknown as MachineConnection,
    });
    return {
      service,
      connection,
      tokens,
      order,
      registry,
      machines: () => machines,
    };
  }
  it('revokes before deleting token, registry and transport', async () => {
    const f = fixture('connected', async () => ({}));
    await f.service.list();
    expect(await f.service.remove('m')).toEqual({
      removed: true,
      revokedOnWorker: true,
    });
    expect(f.order).toEqual([
      'token.revokeSelf',
      'registry',
      'token.delete',
      'dispose',
    ]);
    expect(f.machines()).toEqual([]);
    expect(f.connection.dispose).toHaveBeenCalledTimes(1);
  });
  it('finishes local removal after a five-second revoke timeout', async () => {
    jest.useFakeTimers();
    try {
      const f = fixture('connected', () => new Promise(() => undefined));
      await f.service.list();
      const removal = f.service.remove('m');
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5000);
      expect(await removal).toEqual({ removed: true, revokedOnWorker: false });
      expect(f.order).toContain('token.delete');
      expect(f.connection.dispose).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it('persists the token only after authenticated connect succeeds', async () => {
    const f = fixture('unpaired', async () => ({}));
    await f.service.list();
    const result = await f.service.pair('m', 'code');
    expect(result.machine.state).toBe('connected');
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(f.connection.exchange).toHaveBeenCalledWith('code');
    expect(f.connection.connect).toHaveBeenCalledTimes(1);
    expect(f.tokens.set).toHaveBeenCalledWith('m', 'secret-token');
    expect(f.order).toEqual(['token.set', 'registry']);
  });
});

describe('MachinesService lifecycle regressions', () => {
  it('creates one connection for concurrent lists', async () => {
    let releases: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releases = resolve;
    });
    const registry = {
      read: async () => ({ machines: [{ machineId: 'm', alias: 'host' }] }),
    } as unknown as MachineRegistry;
    const tokens = {
      get: async () => {
        await gate;
        return undefined;
      },
    } as unknown as MachineTokenStore;
    const createConnection = jest.fn(
      () =>
        ({
          machineId: 'm',
          alias: 'host',
          state: 'unpaired',
          dispose: jest.fn(),
        }) as unknown as MachineConnection,
    );
    const service = new MachinesService({
      registry,
      tokens,
      ptahVersion: '1',
      webviewManager: { broadcastMessage: async () => undefined },
      createConnection,
    });
    const first = service.list();
    const second = service.list();
    releases?.();
    await Promise.all([first, second]);
    expect(createConnection).toHaveBeenCalledTimes(1);
    service.dispose();
  });
  it('disposes a connection when credential deletion fails', async () => {
    const connection = {
      machineId: 'm',
      alias: 'host',
      state: 'unpaired',
      dispose: jest.fn(),
    } as unknown as MachineConnection;
    const registry = {
      read: async () => ({ machines: [{ machineId: 'm', alias: 'host' }] }),
      write: async () => undefined,
    } as unknown as MachineRegistry;
    const tokens = {
      get: async () => undefined,
      delete: async () => {
        throw new Error('keyring');
      },
    } as unknown as MachineTokenStore;
    const service = new MachinesService({
      registry,
      tokens,
      ptahVersion: '1',
      webviewManager: { broadcastMessage: async () => undefined },
      createConnection: () => connection,
    });
    await service.list();
    await expect(service.remove('m')).rejects.toThrow('keyring');
    expect(connection.dispose).toHaveBeenCalledTimes(1);
  });
  it('rejects a grant whose worker identity differs from hello without storing a token', async () => {
    const connection = {
      machineId: 'local',
      alias: 'host',
      state: 'unpaired',
      exchange: async () => ({
        token: 'secret',
        workerMachineId: 'worker-a',
        grant: { machineId: 'worker-b', workspaceIds: [] },
      }),
      dispose: jest.fn(),
    } as unknown as MachineConnection;
    const registry = {
      read: async () => ({ machines: [{ machineId: 'local', alias: 'host' }] }),
      write: jest.fn(),
    } as unknown as MachineRegistry;
    const tokens = {
      get: async () => undefined,
      set: jest.fn(),
    } as unknown as MachineTokenStore;
    const service = new MachinesService({
      registry,
      tokens,
      ptahVersion: '1',
      webviewManager: { broadcastMessage: async () => undefined },
      createConnection: () => connection,
    });
    await service.list();
    await expect(service.pair('local', 'code')).rejects.toThrow(
      'different worker',
    );
    expect(tokens.set).not.toHaveBeenCalled();
    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe('MachinesService failure regressions', () => {
  function setup(
    connection: Record<string, unknown>,
    tokenSet: () => Promise<void> = async () => undefined,
    broadcastMessage: (
      type: string,
      payload: unknown,
    ) => Promise<unknown> = async () => undefined,
  ) {
    const registry = {
      read: jest.fn(async () => ({
        machines: [{ machineId: 'local', alias: 'host' }],
      })),
      write: jest.fn(async () => undefined),
    };
    const tokens = {
      get: jest.fn(async () => undefined),
      set: jest.fn(tokenSet),
      delete: jest.fn(async () => undefined),
    };
    const options: MachineConnectionOptions[] = [];
    const service = new MachinesService({
      registry: registry as unknown as MachineRegistry,
      tokens: tokens as unknown as MachineTokenStore,
      ptahVersion: '1',
      webviewManager: { broadcastMessage },
      createConnection: (value) => {
        options.push(value);
        return connection as unknown as MachineConnection;
      },
    });
    return { service, registry, tokens, options };
  }
  it('L9 rejects pairing a connected machine and preserves its live link', async () => {
    const connection = {
      machineId: 'local',
      alias: 'host',
      state: 'connected',
      exchange: jest.fn(),
      close: jest.fn(),
      clearToken: jest.fn(),
      dispose: jest.fn(),
    };
    const h = setup(connection);
    await h.service.list();
    await expect(h.service.pair('local', 'code')).rejects.toThrow(
      'Disconnect before pairing again',
    );
    expect(connection.exchange).not.toHaveBeenCalled();
    expect(connection.clearToken).not.toHaveBeenCalled();
    expect(connection.dispose).not.toHaveBeenCalled();
    expect(connection.state).toBe('connected');
    expect(h.tokens.set).not.toHaveBeenCalled();
  });
  it('L9 revokes a new worker token if keyring persistence fails', async () => {
    const connection = {
      machineId: 'local',
      alias: 'host',
      state: 'unpaired',
      exchange: jest.fn(async () => ({
        token: 'new-secret',
        workerMachineId: 'worker',
        grant: { machineId: 'worker', workspaceIds: [] },
      })),
      setWorkerMachineId: jest.fn(),
      setToken: jest.fn(() => {
        connection.state = 'offline';
      }),
      connect: jest.fn(async () => {
        connection.state = 'connected';
      }),
      call: jest.fn(async () => ({ revoked: true })),
      clearToken: jest.fn(() => {
        connection.state = 'unpaired';
      }),
      dispose: jest.fn(),
    };
    const h = setup(connection, async () => {
      throw new Error('keyring refused');
    });
    await h.service.list();
    await expect(h.service.pair('local', 'code')).rejects.toThrow(
      'keyring refused',
    );
    expect(connection.call).toHaveBeenCalledWith('token.revokeSelf', {});
    expect(connection.clearToken).toHaveBeenCalledTimes(1);
    expect(h.registry.write).not.toHaveBeenCalled();
    expect(h.tokens.delete).toHaveBeenCalledWith('local');
    expect(connection.state).toBe('unpaired');
  });
  it('L10 returns local readiness when remote machine.info rejects', async () => {
    const connection = {
      machineId: 'local',
      alias: 'host',
      state: 'connected',
      call: jest.fn(async () => {
        throw new Error('offline');
      }),
      dispose: jest.fn(),
    };
    const h = setup(connection);
    await h.service.list();
    const result = await h.service.readiness('local');
    expect(result.remote).toBeNull();
    expect(result.local.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'driver-lock' })]),
    );
  });
  it('L13 handles rejecting event and state broadcasts', async () => {
    const rejected = jest.fn(async () => {
      throw new Error('broadcast failed');
    });
    const connection = {
      machineId: 'local',
      alias: 'host',
      state: 'unpaired',
      dispose: jest.fn(),
    };
    const h = setup(connection, undefined, rejected);
    await h.service.list();
    const hooks = h.options[0];
    hooks.onEvent?.({
      machineId: 'local',
      sessionId: 's',
      epoch: 'e',
      seq: 1,
      type: 'chat:chunk',
      payload: {},
    });
    hooks.onState?.({ machineId: 'local', state: 'unpaired' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(rejected).toHaveBeenCalledTimes(2);
  });
});
