/**
 * IWorkspaceScopedStateStorage — an `IStateStorage` that also holds a storage
 * per OPEN WORKSPACE, addressable by root.
 *
 * The plain {@link IStateStorage} contract has one implicit scope, and the
 * multi-root hosts satisfy it with a proxy that delegates to whichever workspace
 * is ACTIVE. That is the right default for a caller acting on the user's behalf
 * — an RPC handler answering a click belongs to the window the user is looking
 * at. It is the wrong answer for a caller reconciling a root it was HANDED:
 * `harness-sync` builds a desired state per workspace root, and reading the
 * active workspace's state while reconciling a different one wrote one folder's
 * plugin overlay into the other's target directories and reaped it again on the
 * way back (TASK_2026_346).
 *
 * So a caller that already knows which root it means asks for that root's
 * storage instead of the ambient one. The capability is OPTIONAL by design:
 * single-workspace hosts (the CLI, the VS Code extension) have exactly one
 * storage which IS the answer for every root, and they must keep satisfying
 * `IStateStorage` with nothing added.
 *
 * Structural, and deliberately not a new `PLATFORM_TOKENS` entry: the same
 * object is already registered under `WORKSPACE_STATE_STORAGE`, and a second
 * token would let one host register two objects that disagree about the same
 * state. `WorkspaceAwareStateStorage` (`vscode-core`) satisfies this as-is, with
 * no import either way — `isWorkspaceScopedStateStorage` is how a consumer asks.
 */

import type { IStateStorage } from './state-storage.interface';

export interface IWorkspaceScopedStateStorage extends IStateStorage {
  /**
   * The storage for one workspace root, or `undefined` when that root has no
   * storage registered.
   *
   * `undefined` is a real answer and must not be papered over with the active
   * workspace's storage: a root nobody registered is a root this host knows
   * nothing about, and answering with somebody else's state is the defect this
   * interface exists to close.
   */
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined;

  /**
   * Every registered workspace root, as the keys `getStorageForWorkspace`
   * accepts.
   *
   * Part of the contract rather than an implementation detail because the keys
   * are host-normalized paths and a consumer holding a differently-spelled
   * absolute path (a Windows drive letter in the other case) has no other way
   * to find the match.
   */
  getAllWorkspacePaths(): string[];
}

/**
 * Does this storage hold a scope per workspace root?
 *
 * A structural probe, not an `instanceof`: the implementation lives in
 * `vscode-core` and this lib is a leaf that imports nothing.
 */
export function isWorkspaceScopedStateStorage(
  storage: IStateStorage,
): storage is IWorkspaceScopedStateStorage {
  const candidate = storage as Partial<IWorkspaceScopedStateStorage>;
  return (
    typeof candidate.getStorageForWorkspace === 'function' &&
    typeof candidate.getAllWorkspacePaths === 'function'
  );
}
