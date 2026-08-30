/**
 * Unit tests for `shutdownHostRuntime` — the one host-runtime teardown helper
 * (TASK_2026_326 finding 1).
 *
 * Two things make this worth pinning rather than trusting by inspection:
 *
 *   - The ORDER is a correctness property, not a style choice. An agent
 *     subprocess talks to its provider through a ptah-cli proxy lease, so
 *     stopping the proxy first strands a live child on a dead endpoint.
 *   - `PtahCliRegistry.disposeAll()` was called from NOWHERE in the CLI or the
 *     TUI before this helper existed, so the proxy half is new surface with no
 *     prior coverage anywhere in the graph.
 */

import type { DependencyContainer } from 'tsyringe';

import {
  shutdownAgentProcesses,
  shutdownHostRuntime,
  shutdownPtahCliProxies,
} from './shutdown-host-runtime.js';

const AGENT_PROCESS_MANAGER_TOKEN = Symbol.for('AgentProcessManager');
const PTAH_CLI_REGISTRY_TOKEN = Symbol.for('SdkPtahCliRegistry');

interface FakeSubsystems {
  agentDisposeAll: jest.Mock;
  proxyDisposeAll: jest.Mock;
  /** Ordered log of which half ran, appended by the two mocks above. */
  order: string[];
}

/**
 * Build a container double registering the two teardown tokens.
 *
 * `registered` selects which tokens answer `isRegistered === true`; anything
 * outside it behaves exactly like a `mode: 'minimal'` bootstrap, where neither
 * subsystem was ever registered.
 */
function makeContainer(
  registered: symbol[] = [AGENT_PROCESS_MANAGER_TOKEN, PTAH_CLI_REGISTRY_TOKEN],
  overrides: {
    agentDisposeAll?: jest.Mock;
    proxyDisposeAll?: jest.Mock;
  } = {},
): { container: DependencyContainer; fakes: FakeSubsystems } {
  const order: string[] = [];
  const agentDisposeAll =
    overrides.agentDisposeAll ??
    jest.fn(async () => {
      order.push('agents');
    });
  const proxyDisposeAll =
    overrides.proxyDisposeAll ??
    // Deliberately synchronous — this mirrors the real
    // `PtahCliRegistry.disposeAll()`, which returns void, not a promise.
    jest.fn(() => {
      order.push('proxies');
    });

  const registeredSet = new Set<symbol>(registered);
  const container = {
    isRegistered: jest.fn((token: symbol) => registeredSet.has(token)),
    resolve: jest.fn((token: symbol) => {
      if (token === AGENT_PROCESS_MANAGER_TOKEN) {
        return { disposeAll: agentDisposeAll };
      }
      if (token === PTAH_CLI_REGISTRY_TOKEN) {
        return { disposeAll: proxyDisposeAll };
      }
      throw new Error(`unexpected token: ${String(token)}`);
    }),
  } as unknown as DependencyContainer;

  return { container, fakes: { agentDisposeAll, proxyDisposeAll, order } };
}

describe('shutdownHostRuntime', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('both subsystems registered', () => {
    it('disposes agent processes BEFORE ptah-cli proxies', async () => {
      const { container, fakes } = makeContainer();

      await shutdownHostRuntime(container);

      expect(fakes.order).toEqual(['agents', 'proxies']);
    });

    it('disposes each subsystem exactly once', async () => {
      const { container, fakes } = makeContainer();

      await shutdownHostRuntime(container);

      expect(fakes.agentDisposeAll).toHaveBeenCalledTimes(1);
      expect(fakes.proxyDisposeAll).toHaveBeenCalledTimes(1);
    });

    it('waits for an async agent disposal to settle before starting the proxies', async () => {
      const order: string[] = [];
      const agentDisposeAll = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('agents');
      });
      const proxyDisposeAll = jest.fn(() => {
        order.push('proxies');
      });
      const { container } = makeContainer(
        [AGENT_PROCESS_MANAGER_TOKEN, PTAH_CLI_REGISTRY_TOKEN],
        { agentDisposeAll, proxyDisposeAll },
      );

      await shutdownHostRuntime(container);

      expect(order).toEqual(['agents', 'proxies']);
    });
  });

  describe('missing registrations', () => {
    it('does not throw and disposes nothing when neither token is registered', async () => {
      const { container, fakes } = makeContainer([]);

      await expect(shutdownHostRuntime(container)).resolves.toBeUndefined();

      expect(fakes.agentDisposeAll).not.toHaveBeenCalled();
      expect(fakes.proxyDisposeAll).not.toHaveBeenCalled();
      expect(container.resolve).not.toHaveBeenCalled();
    });

    it('still disposes the proxies when the agent manager is missing', async () => {
      const { container, fakes } = makeContainer([PTAH_CLI_REGISTRY_TOKEN]);

      await expect(shutdownHostRuntime(container)).resolves.toBeUndefined();

      expect(fakes.agentDisposeAll).not.toHaveBeenCalled();
      expect(fakes.proxyDisposeAll).toHaveBeenCalledTimes(1);
    });

    it('still disposes the agents when the ptah-cli registry is missing', async () => {
      const { container, fakes } = makeContainer([AGENT_PROCESS_MANAGER_TOKEN]);

      await expect(shutdownHostRuntime(container)).resolves.toBeUndefined();

      expect(fakes.agentDisposeAll).toHaveBeenCalledTimes(1);
      expect(fakes.proxyDisposeAll).not.toHaveBeenCalled();
    });

    /**
     * Pins the `typeof isRegistered === 'function'` guard: the SDK-init-failure
     * teardown runs against partial container doubles, and a `TypeError` there
     * would mask `sdk_init_failed` (see `with-engine.spec.ts`).
     */
    it('does not throw when the container has no isRegistered at all', async () => {
      const partial = {
        resolve: jest.fn(),
      } as unknown as DependencyContainer;

      await expect(shutdownHostRuntime(partial)).resolves.toBeUndefined();
      expect(partial.resolve).not.toHaveBeenCalled();
    });

    it('does not throw when there is no container at all', async () => {
      await expect(shutdownHostRuntime(undefined)).resolves.toBeUndefined();
    });
  });

  describe('failure isolation', () => {
    it('runs proxy disposal even when agent disposal rejects', async () => {
      const agentDisposeAll = jest.fn(async () => {
        throw new Error('agent teardown exploded');
      });
      const { container, fakes } = makeContainer(
        [AGENT_PROCESS_MANAGER_TOKEN, PTAH_CLI_REGISTRY_TOKEN],
        { agentDisposeAll },
      );

      await expect(shutdownHostRuntime(container)).resolves.toBeUndefined();

      expect(fakes.proxyDisposeAll).toHaveBeenCalledTimes(1);
      const written = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(
        written.some((line) => line.includes('agent process disposal failed')),
      ).toBe(true);
      expect(
        written.some((line) => line.includes('agent teardown exploded')),
      ).toBe(true);
    });

    it('runs proxy disposal even when agent disposal throws synchronously', async () => {
      const agentDisposeAll = jest.fn(() => {
        throw new Error('sync agent boom');
      });
      const { container, fakes } = makeContainer(
        [AGENT_PROCESS_MANAGER_TOKEN, PTAH_CLI_REGISTRY_TOKEN],
        { agentDisposeAll },
      );

      await expect(shutdownHostRuntime(container)).resolves.toBeUndefined();

      expect(fakes.proxyDisposeAll).toHaveBeenCalledTimes(1);
    });

    it('absorbs a proxy disposal failure without disturbing the agent half', async () => {
      const proxyDisposeAll = jest.fn(() => {
        throw new Error('proxy teardown exploded');
      });
      const { container, fakes } = makeContainer(
        [AGENT_PROCESS_MANAGER_TOKEN, PTAH_CLI_REGISTRY_TOKEN],
        { proxyDisposeAll },
      );

      await expect(shutdownHostRuntime(container)).resolves.toBeUndefined();

      expect(fakes.agentDisposeAll).toHaveBeenCalledTimes(1);
      const written = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(
        written.some((line) => line.includes('ptah-cli proxy disposal failed')),
      ).toBe(true);
    });

    it('absorbs a resolve() failure for either subsystem', async () => {
      const container = {
        isRegistered: jest.fn(() => true),
        resolve: jest.fn(() => {
          throw new Error('resolution failed');
        }),
      } as unknown as DependencyContainer;

      await expect(shutdownHostRuntime(container)).resolves.toBeUndefined();

      // Both halves were attempted — one failure does not skip the other.
      expect(container.resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe('individual halves', () => {
    it('shutdownAgentProcesses touches only the agent manager', async () => {
      const { container, fakes } = makeContainer();

      await shutdownAgentProcesses(container);

      expect(fakes.agentDisposeAll).toHaveBeenCalledTimes(1);
      expect(fakes.proxyDisposeAll).not.toHaveBeenCalled();
    });

    it('shutdownPtahCliProxies touches only the ptah-cli registry', async () => {
      const { container, fakes } = makeContainer();

      await shutdownPtahCliProxies(container);

      expect(fakes.proxyDisposeAll).toHaveBeenCalledTimes(1);
      expect(fakes.agentDisposeAll).not.toHaveBeenCalled();
    });
  });
});
