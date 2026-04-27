/**
 * `createMockWorkspaceProvider` — seedable `jest.Mocked<IWorkspaceProvider>`.
 *
 * Holds in-memory workspace folders + a two-level config map keyed by
 * `${section}.${key}`. Event emitters are wired through `createEvent` so tests
 * can subscribe via the real `IEvent<T>` subscription contract.
 */

import type { IWorkspaceProvider } from '../../interfaces/workspace-provider.interface';
import type { ConfigurationChangeEvent } from '../../types/platform.types';
import { createEvent } from '../../utils/event-emitter';

export interface MockWorkspaceProviderState {
  readonly folders: string[];
  readonly config: Map<string, unknown>;
  setFolders(folders: string[]): void;
  fireConfigurationChange(section: string): void;
  fireWorkspaceFoldersChange(): void;
}

export type MockWorkspaceProvider = jest.Mocked<IWorkspaceProvider> & {
  readonly __state: MockWorkspaceProviderState;
};

export interface MockWorkspaceProviderOverrides extends Partial<IWorkspaceProvider> {
  /** Seed the initial workspace folder list. */
  folders?: string[];
  /** Seed initial configuration values keyed by `section.key`. */
  config?: Record<string, unknown>;
}

function configKey(section: string, key: string): string {
  return `${section}.${key}`;
}

export function createMockWorkspaceProvider(
  overrides?: MockWorkspaceProviderOverrides,
): MockWorkspaceProvider {
  const folders: string[] = [...(overrides?.folders ?? [])];
  const config = new Map<string, unknown>();
  if (overrides?.config) {
    for (const [k, v] of Object.entries(overrides.config)) {
      config.set(k, v);
    }
  }

  const [onDidChangeConfiguration, fireConfig] =
    createEvent<ConfigurationChangeEvent>();
  const [onDidChangeWorkspaceFolders, fireFolders] = createEvent<void>();

  const mock = {
    getWorkspaceFolders: jest.fn((): string[] => [...folders]),
    getWorkspaceRoot: jest.fn((): string | undefined => folders[0]),
    getConfiguration: jest.fn(
      <T>(section: string, key: string, defaultValue?: T): T | undefined => {
        const stored = config.get(configKey(section, key));
        return (stored ?? defaultValue) as T | undefined;
      },
    ),
    setConfiguration: jest.fn(
      async (section: string, key: string, value: unknown): Promise<void> => {
        config.set(configKey(section, key), value);
        fireConfig({ affectsConfiguration: (s: string) => s === section });
      },
    ),
    onDidChangeConfiguration,
    onDidChangeWorkspaceFolders,
    __state: {
      folders,
      config,
      setFolders(next: string[]): void {
        folders.splice(0, folders.length, ...next);
        fireFolders();
      },
      fireConfigurationChange(section: string): void {
        fireConfig({ affectsConfiguration: (s: string) => s === section });
      },
      fireWorkspaceFoldersChange(): void {
        fireFolders();
      },
    },
  } as unknown as MockWorkspaceProvider;

  if (overrides) {
    for (const key of [
      'getWorkspaceFolders',
      'getWorkspaceRoot',
      'getConfiguration',
      'setConfiguration',
    ] as const) {
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
