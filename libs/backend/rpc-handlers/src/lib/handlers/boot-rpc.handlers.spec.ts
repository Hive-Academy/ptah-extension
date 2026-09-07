import 'reflect-metadata';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core';
import type {
  BootGetReadinessResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import type { IBootReadinessProvider } from '@ptah-extension/platform-core';
import { BootRpcHandlers } from './boot-rpc.handlers';

type RegisteredHandler = (
  params: Record<string, never> | undefined,
) => BootGetReadinessResult | Promise<BootGetReadinessResult>;

function createLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/**
 * Stands in for the real `RpcHandler` and enforces the one thing that makes
 * this method reachable at runtime: the prefix allowlist. Registering a method
 * whose prefix is missing throws in production, which crashes activation
 * rather than 404-ing — so the double here throws too.
 */
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

const SNAPSHOT: BootGetReadinessResult = {
  readiness: 'warming',
  phase: 'harness',
  detail: 'Syncing skills and agents',
  startedAt: 1_700_000_000_000,
};

describe('BootRpcHandlers', () => {
  it('declares exactly the boot methods the registry knows', () => {
    const methods: readonly RpcMethodName[] = BootRpcHandlers.METHODS;
    expect(methods).toEqual(['boot:getReadiness']);
  });

  it('registers under the `boot:` prefix without throwing', () => {
    const { rpcHandler, registered } = createRpcHandler();
    const port: IBootReadinessProvider = { getReadiness: () => SNAPSHOT };

    const handlers = new BootRpcHandlers(createLogger(), rpcHandler, port);

    expect(() => handlers.register()).not.toThrow();
    expect(registered.has('boot:getReadiness')).toBe(true);
  });

  it('returns the port snapshot verbatim', async () => {
    const { rpcHandler, registered } = createRpcHandler();
    const port: IBootReadinessProvider = { getReadiness: () => SNAPSHOT };
    new BootRpcHandlers(createLogger(), rpcHandler, port).register();

    const result = await registered.get('boot:getReadiness')?.({});

    expect(result).toEqual(SNAPSHOT);
  });

  it('falls back to ready/settled when the port throws', async () => {
    const { rpcHandler, registered } = createRpcHandler();
    const logger = createLogger();
    const port: IBootReadinessProvider = {
      getReadiness: () => {
        throw new Error('coordinator is gone');
      },
    };
    new BootRpcHandlers(logger, rpcHandler, port).register();

    const result = await registered.get('boot:getReadiness')?.({});

    // Fails OPEN: a renderer that cannot learn the boot state must not sit
    // behind a boot screen for the rest of the session.
    expect(result?.readiness).toBe('ready');
    expect(result?.phase).toBe('settled');
    expect(typeof result?.startedAt).toBe('number');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('answers when called with no params at all', async () => {
    const { rpcHandler, registered } = createRpcHandler();
    const port: IBootReadinessProvider = { getReadiness: () => SNAPSHOT };
    new BootRpcHandlers(createLogger(), rpcHandler, port).register();

    const result = await registered.get('boot:getReadiness')?.(undefined);

    expect(result).toEqual(SNAPSHOT);
  });

  it('still answers — and warns — when the payload carries unexpected fields', async () => {
    const { rpcHandler, registered } = createRpcHandler();
    const logger = createLogger();
    const port: IBootReadinessProvider = { getReadiness: () => SNAPSHOT };
    new BootRpcHandlers(logger, rpcHandler, port).register();

    const result = await registered.get('boot:getReadiness')?.({
      unexpected: 'field',
    } as unknown as Record<string, never>);

    expect(result).toEqual(SNAPSHOT);
    expect(logger.warn).toHaveBeenCalled();
  });
});
