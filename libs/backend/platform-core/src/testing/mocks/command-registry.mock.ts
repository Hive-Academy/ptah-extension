/**
 * `createMockCommandRegistry` — in-memory `jest.Mocked<ICommandRegistry>`.
 *
 * `registerCommand` stores the handler in a `Map` and returns a Disposable
 * that removes it. `executeCommand` looks the handler up and invokes it with
 * the supplied args so test-time wiring mirrors the real registry's contract.
 */

import type { ICommandRegistry } from '../../interfaces/command-registry.interface';
import type { IDisposable } from '../../types/platform.types';

export interface MockCommandRegistryState {
  readonly handlers: Map<string, (...args: unknown[]) => unknown>;
}

export type MockCommandRegistry = jest.Mocked<ICommandRegistry> & {
  readonly __state: MockCommandRegistryState;
};

export function createMockCommandRegistry(
  overrides?: Partial<ICommandRegistry>,
): MockCommandRegistry {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  const mock = {
    registerCommand: jest.fn(
      (id: string, handler: (...args: unknown[]) => unknown): IDisposable => {
        handlers.set(id, handler);
        return {
          dispose: jest.fn((): void => {
            handlers.delete(id);
          }),
        };
      },
    ),
    executeCommand: jest.fn(
      async <T = unknown>(id: string, ...args: unknown[]): Promise<T> => {
        const handler = handlers.get(id);
        if (!handler) {
          throw new Error(
            `MockCommandRegistry: no handler registered for '${id}'`,
          );
        }
        return (await handler(...args)) as T;
      },
    ),
    __state: { handlers },
  } as MockCommandRegistry;

  if (overrides) {
    for (const key of ['registerCommand', 'executeCommand'] as const) {
      const value = overrides[key];
      if (typeof value === 'function') {
        (mock as unknown as Record<string, unknown>)[key] = jest.fn(
          value as (...args: unknown[]) => unknown,
        );
      }
    }
  }

  return mock;
}
