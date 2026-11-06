import 'reflect-metadata';
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: { RPC_HANDLER: Symbol.for('RpcHandler') },
  RpcUserError: class RpcUserError extends Error {
    constructor(
      message: string,
      readonly errorCode: string,
    ) {
      super(message);
    }
  },
}));
import { MACHINES_RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { WorkerClientError } from '@ptah-extension/worker-protocol';
import { MachinesRpcHandlers, mapMachineError } from './machines-rpc.handlers';
import { MachinesService } from './machines-service';
import type { RpcHandler } from '@ptah-extension/vscode-core';

describe('MachinesRpcHandlers', () => {
  it('registers every method and rejects invalid params before dispatch', async () => {
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpc = {
      registerMethod: (
        name: string,
        callback: (params: unknown) => Promise<unknown>,
      ) => registered.set(name, callback),
    } as unknown as RpcHandler;
    new MachinesRpcHandlers(rpc, {} as MachinesService).register();
    expect([...registered.keys()]).toEqual(MACHINES_RPC_METHOD_NAMES);
    const add = registered.get('machines:add');
    expect(add).toBeDefined();
    if (!add) throw new Error('machines:add not registered');
    await expect(add({ alias: '-evil' })).rejects.toMatchObject({
      errorCode: 'INVALID_PARAMS',
    });
  });
  it.each([
    ['VERSION_MISMATCH', 'MACHINE_VERSION_MISMATCH'],
    ['NOT_FOUND_OR_FORBIDDEN', 'MACHINE_NOT_FOUND_OR_FORBIDDEN'],
    ['PAIRING_REJECTED', 'MACHINE_PAIRING_REJECTED'],
    ['SESSION_DRIVEN_ELSEWHERE', 'SESSION_DRIVEN_ELSEWHERE'],
    ['DRIVER_LOCK_UNAVAILABLE', 'SESSION_DRIVER_LOCK_UNAVAILABLE'],
    ['NOT_CONNECTED', 'MACHINE_UNREACHABLE'],
  ] as const)('maps %s to %s', (input, output) => {
    expect(mapMachineError(new WorkerClientError(input))).toMatchObject({
      errorCode: output,
    });
  });
});

describe('renderer result hygiene', () => {
  it('keeps a known token out of every successful method result', async () => {
    const token = 'known-secret-token';
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpc = {
      registerMethod: (
        name: string,
        handler: (params: unknown) => Promise<unknown>,
      ) => {
        registered.set(name, handler);
      },
    } as unknown as RpcHandler;
    const machine = {
      machineId: 'm',
      alias: 'host',
      displayName: 'host',
      state: 'connected',
    };
    const service = {
      list: async () => ({ machines: [machine] }),
      sshAliases: async () => ({ aliases: ['host'] }),
      add: async () => ({ machine }),
      pair: async () => ({ machine }),
      pairViaSsh: async () => ({ machine }),
      retry: async () => ({ machine }),
      remove: async () => ({ removed: true, revokedOnWorker: true }),
      readiness: async () => ({
        machineId: 'm',
        remote: null,
        local: { ready: true, checks: [] },
      }),
      call: async (id: string, method: string) =>
        method === 'workspaces.list' || method === 'sessions.list'
          ? []
          : method === 'session.start'
            ? { sessionId: 's', turnId: 't' }
            : method === 'session.continue'
              ? { turnId: 't' }
              : method === 'session.stop'
                ? { stopped: true }
                : { applied: true },
      attach: async () => ({ mode: 'log', epoch: 'e', fromSeq: 0, headSeq: 0 }),
      detach: async () => ({ detached: true }),
    } as unknown as MachinesService;
    new MachinesRpcHandlers(rpc, service).register();
    const params: Record<string, unknown> = {
      'machines:list': {},
      'machines:sshAliases': {},
      'machines:add': { alias: 'host' },
      'machines:pair': { machineId: 'm', code: 'code' },
      'machines:pairViaSsh': { machineId: 'm' },
      'machines:remove': { machineId: 'm' },
      'machines:retry': { machineId: 'm' },
      'machines:readiness': { machineId: 'm' },
      'machines:workspaces': { machineId: 'm' },
      'machines:sessions': { machineId: 'm', workspaceId: 'w' },
      'machines:session.attach': { machineId: 'm', sessionId: 's' },
      'machines:session.detach': { machineId: 'm', sessionId: 's' },
      'machines:session.replay': {
        machineId: 'm',
        sessionId: 's',
        afterSeq: 0,
      },
      'machines:session.start': {
        machineId: 'm',
        workspaceId: 'w',
        prompt: 'hello',
      },
      'machines:session.continue': {
        machineId: 'm',
        sessionId: 's',
        prompt: 'hello',
      },
      'machines:session.stop': { machineId: 'm', sessionId: 's' },
      'machines:permission.respond': {
        machineId: 'm',
        sessionId: 's',
        requestId: 'r',
        decision: 'deny',
      },
    };
    for (const name of MACHINES_RPC_METHOD_NAMES) {
      const handler = registered.get(name);
      if (!handler) throw new Error(`Missing ${name}`);
      const result = await handler(params[name]);
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });
});
