/**
 * VS Code Core — storage shims for hosts that have no real `vscode` runtime.
 *
 * Both functions here bridge `platform-core` storage PORTS onto `TOKENS` this
 * library owns, and both shipped as byte-identical copies in the Electron
 * composition root and the CLI one. They live here rather than in each host
 * because what they encode is a `vscode-core` fact — which token each port hangs
 * off, and what shape `TOKENS.EXTENSION_CONTEXT` has to be for `LicenseService`
 * and `AuthSecretsService` to read it — not a host policy. The VS Code host has
 * neither: there the real `vscode.ExtensionContext` and its storage are already
 * the thing being shimmed.
 *
 * COMPILER-ENFORCEABLE BOUNDARY, as in `register-platform-agnostic.ts`: this
 * file must NOT import `vscode` at runtime.
 */

import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
  type ISecretStorage,
} from '@ptah-extension/platform-core';
import type { Logger } from '../logging/logger';
import { TOKENS } from './tokens';

/** The two host paths the shim's URI-shaped fields are built from. */
export interface ExtensionContextShimPaths {
  /** Becomes `extensionUri.fsPath` and `extensionPath`. */
  readonly appPath: string;
  /** Becomes `globalStorageUri.fsPath`. */
  readonly userDataPath: string;
}

/**
 * Register `TOKENS.EXTENSION_CONTEXT` as a shim over the platform storage ports.
 *
 * Pre-conditions: `PLATFORM_TOKENS.STATE_STORAGE` and
 * `PLATFORM_TOKENS.SECRET_STORAGE` are registered — the shim resolves both
 * eagerly, so this must run after the host's platform phase.
 *
 * A failure is logged and swallowed rather than thrown: the shim's consumers
 * (`LicenseService`, `AuthSecretsService`, the SDK/LLM services) resolve it
 * lazily, so a host that could not build it degrades instead of failing to boot.
 */
export function registerExtensionContextShim(
  container: DependencyContainer,
  logger: Logger,
  paths: ExtensionContextShimPaths,
): void {
  try {
    const globalState = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    const secretStorage = container.resolve<ISecretStorage>(
      PLATFORM_TOKENS.SECRET_STORAGE,
    );
    container.register(TOKENS.EXTENSION_CONTEXT, {
      useValue: {
        globalState: {
          get: <T>(key: string): T | undefined => globalState.get<T>(key),
          update: async (key: string, value: unknown): Promise<void> => {
            await globalState.update(key, value);
          },
          keys: () => [] as readonly string[],
          setKeysForSync: () => {
            /* no-op outside VS Code: there is no settings-sync service */
          },
        },
        secrets: {
          get: async (key: string): Promise<string | undefined> =>
            secretStorage.get(key),
          store: async (key: string, value: string): Promise<void> =>
            secretStorage.store(key, value),
          delete: async (key: string): Promise<void> =>
            secretStorage.delete(key),
          onDidChange: (_listener: unknown) => ({
            dispose: () => {
              /* no-op outside VS Code: there are no secret change events */
            },
          }),
        },
        subscriptions: [] as { dispose: () => void }[],
        extensionUri: { fsPath: paths.appPath, scheme: 'file' },
        globalStorageUri: { fsPath: paths.userDataPath, scheme: 'file' },
        extensionPath: paths.appPath,
        extensionMode: process.env['NODE_ENV'] === 'development' ? 2 : 1,
      },
    });
    logger.info(
      '[VS Code Core] EXTENSION_CONTEXT shim registered (delegates to platform storage)',
    );
  } catch (error: unknown) {
    logger.error(
      '[VS Code Core] Failed to register EXTENSION_CONTEXT shim — agent-sdk/llm services may fail',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Register `TOKENS.STORAGE_SERVICE` and `TOKENS.GLOBAL_STATE` over the two
 * platform state-storage ports.
 *
 * Pre-conditions: `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` and
 * `PLATFORM_TOKENS.STATE_STORAGE` are registered. A host that overrides the
 * workspace storage (Electron's `WorkspaceAwareStateStorage`) must do so before
 * calling this — the adapter closes over the instance it resolves here.
 *
 * The two differ deliberately: `STORAGE_SERVICE` is an ADAPTER, because its
 * consumers pass a `defaultValue` that `IStateStorage.get` does not take, while
 * `GLOBAL_STATE` is the port registered straight through.
 */
export function registerStateStorageAdapters(
  container: DependencyContainer,
): void {
  const workspaceStateStorage = container.resolve<IStateStorage>(
    PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
  );
  container.register(TOKENS.STORAGE_SERVICE, {
    useValue: {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const value = workspaceStateStorage.get<T>(key);
        return value !== undefined ? value : defaultValue;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await workspaceStateStorage.update(key, value);
      },
    },
  });
  const globalStateStorage = container.resolve<IStateStorage>(
    PLATFORM_TOKENS.STATE_STORAGE,
  );
  container.register(TOKENS.GLOBAL_STATE, { useValue: globalStateStorage });
}
