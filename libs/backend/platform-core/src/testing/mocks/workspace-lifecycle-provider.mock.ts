/**
 * `createMockWorkspaceLifecycleProvider` — seedable in-memory implementation
 * of `IWorkspaceLifecycleProvider` for use in contract self-specs and unit tests.
 *
 * Mirrors the behaviour of the CLI/Electron implementations:
 *   - Folder list managed in memory.
 *   - `addFolder` deduplicates by identity (`===`).
 *   - `removeFolder` no-ops for missing paths.
 *   - `setActiveFolder` no-ops for unknown paths.
 *   - Events wired through `createEvent` so tests subscribe via the real contract.
 */

import type { IWorkspaceLifecycleProvider } from '../../interfaces/workspace-lifecycle.interface';
import { createEvent } from '../../utils/event-emitter';
import type { IEvent, IDisposable } from '../../types/platform.types';

export interface MockWorkspaceLifecycleState {
  readonly folders: string[];
  /** Directly set the folder list (bypasses event firing). */
  setFolders(folders: string[]): void;
}

export type MockWorkspaceLifecycleProvider = IWorkspaceLifecycleProvider & {
  /** Exposed so tests can subscribe directly. */
  readonly onDidChangeWorkspaceFolders: IEvent<void>;
  readonly __state: MockWorkspaceLifecycleState;
};

export function createMockWorkspaceLifecycleProvider(
  initialFolders: string[] = [],
): MockWorkspaceLifecycleProvider {
  const folders: string[] = [...initialFolders];
  let activeFolder: string | undefined =
    initialFolders.length > 0 ? initialFolders[0] : undefined;

  const [onDidChangeWorkspaceFolders, fireFolders] = createEvent<void>();

  const provider: MockWorkspaceLifecycleProvider = {
    onDidChangeWorkspaceFolders,

    addFolder(folderPath: string): void {
      if (folders.includes(folderPath)) return;
      folders.push(folderPath);
      if (folders.length === 1) {
        activeFolder = folderPath;
      }
      fireFolders(undefined as unknown as void);
    },

    removeFolder(folderPath: string): void {
      const index = folders.indexOf(folderPath);
      if (index === -1) return;
      folders.splice(index, 1);
      if (activeFolder === folderPath) {
        activeFolder = folders[0];
      }
      fireFolders(undefined as unknown as void);
    },

    setActiveFolder(folderPath: string): void {
      if (!folders.includes(folderPath)) return;
      if (activeFolder === folderPath) return;
      activeFolder = folderPath;
      fireFolders(undefined as unknown as void);
    },

    getActiveFolder(): string | undefined {
      return activeFolder;
    },

    __state: {
      folders,
      setFolders(next: string[]): void {
        folders.splice(0, folders.length, ...next);
        activeFolder = folders.length > 0 ? folders[0] : undefined;
      },
    },
  };

  return provider;
}

/**
 * Helper for contract self-spec: returns an `IDisposable`-shaped object that
 * wraps the mock's `onDidChangeWorkspaceFolders` event subscription.
 */
export function subscribeMockLifecycleFolderChanges(
  mock: MockWorkspaceLifecycleProvider,
  fn: () => void,
): IDisposable {
  return mock.onDidChangeWorkspaceFolders(fn);
}
