/**
 * One file watcher PER OPEN WORKSPACE FOLDER, re-armed when the folder set
 * changes.
 *
 * ## The problem this replaces
 *
 * `AgentDiscoveryService` and `CommandDiscoveryService` each armed a single
 * unscoped watcher at activation and, on any event, re-ran discovery for
 * whatever folder `IWorkspaceProvider.getWorkspaceRoot()` reported at that
 * moment. With two folders open that is the wrong folder half the time: editing
 * `.claude/agents/x.md` in folder B rescanned folder A and republished the cache
 * under A's key, so B's own edit never invalidated B's entry. The read path was
 * safe — the root-keyed cache forces a rescan on a key mismatch (TASK_2026_200)
 * — but the refresh itself was aimed at whichever folder happened to be active.
 *
 * The old code carried a "DELIBERATELY NOT root-parameterized … please do not
 * fix this" note, and its reasoning was sound: threading ONE root through would
 * pin the watcher to whichever folder was active at activation time, which is
 * worse than tracking the active folder. This does neither. It watches EVERY
 * folder, and the folder is captured in the closure that arms it — so the
 * callback is told which folder changed instead of having to ask, and no root
 * is pinned. The constraint is met rather than removed.
 *
 * ## Why the folder is closed over rather than parsed back out of the path
 *
 * The adapters emit absolute paths, and mapping one back to an open folder
 * means prefix-matching against the folder list with Windows case rules — a
 * second place for the answer to be wrong. The watcher already knows: it was
 * created for exactly one folder.
 */

import type {
  IDisposable,
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

/**
 * Arm `pattern` under every open workspace folder.
 *
 * @param pattern Glob RELATIVE to each folder (e.g. `.claude/agents/*.md`).
 *   Passed with the folder as `cwd`, which is what lets each adapter resolve it
 *   exactly — a `RelativePattern` in VS Code, a concrete directory in the
 *   chokidar-backed adapters (see `planGlobWatch` in platform-core).
 * @param onFolderChanged Called with the folder whose tree changed. Fired for
 *   create, change and delete alike: every consumer here only needs "this
 *   folder's answer is stale", not which file moved.
 * @param onError Reports a folder whose watcher could not be created. A host
 *   without a real watcher must degrade to "no live invalidation", never to a
 *   failed activation.
 */
export function watchWorkspaceFolders(
  workspaceProvider: IWorkspaceProvider,
  fsProvider: IFileSystemProvider,
  pattern: string,
  onFolderChanged: (folderRoot: string) => void,
  onError: (folderRoot: string, error: unknown) => void,
): IDisposable {
  let armed: IDisposable[] = [];

  const disarm = (): void => {
    for (const disposable of armed) {
      try {
        disposable.dispose();
      } catch {
        // A watcher that fails to close must not strand the rest of the set.
      }
    }
    armed = [];
  };

  const armFolder = (folder: string): void => {
    try {
      const watcher = fsProvider.createFileWatcher(pattern, { cwd: folder });
      const notify = (): void => onFolderChanged(folder);
      armed.push(
        watcher,
        watcher.onDidCreate(notify),
        watcher.onDidChange(notify),
        watcher.onDidDelete(notify),
      );
    } catch (error: unknown) {
      onError(folder, error);
    }
  };

  const arm = (): void => {
    disarm();
    for (const folder of workspaceProvider.getWorkspaceFolders()) {
      armFolder(folder);
    }
  };

  arm();
  // A folder added after activation gets a watcher; a folder removed loses one.
  // Without this the set is frozen at activation time — the exact pinning the
  // old single-watcher code was written to avoid.
  const foldersChanged = workspaceProvider.onDidChangeWorkspaceFolders(arm);

  return {
    dispose(): void {
      foldersChanged.dispose();
      disarm();
    },
  };
}
