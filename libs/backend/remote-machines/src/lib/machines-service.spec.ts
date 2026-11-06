import { MachinesService } from './machines-service';
import { MachineRegistry } from './machine-registry';
import { MachineTokenStore } from './machine-token-store';
import { MachineConnection } from './machine-connection';

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
        tokenId: 't',
        grant: { machineId: 'm', workspaceIds: [] },
      })),
      setToken: jest.fn(() => {
        connection.state = 'connected';
      }),
      clearToken: jest.fn(),
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
      'token.delete',
      'registry',
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
    expect(f.order).toEqual(['token.set']);
  });
});
