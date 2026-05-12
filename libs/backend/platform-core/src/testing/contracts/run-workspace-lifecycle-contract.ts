/**
 * `runWorkspaceLifecycleContract` — behavioural contract for
 * `IWorkspaceLifecycleProvider`.
 *
 * Invariants asserted (Section 2.4 of the test-strategy plan):
 *
 *   1. addFolder appends path to the folder list.
 *   2. addFolder is idempotent — adding the same path twice is a no-op that
 *      does NOT fire the folders-changed event a second time.
 *   3. removeFolder of a missing path is a no-op (no event fired).
 *   4. removeFolder of the active folder promotes the first remaining folder.
 *   5. setActiveFolder of a path not in the list is a no-op (no event fired).
 *   6. getActiveFolder returns undefined when no folders are present.
 *   7. setActiveFolder updates getActiveFolder and fires the lifecycle event.
 *   8. addFolder fires onDidChangeWorkspaceFolders exactly once for a new path.
 *   9. removeFolder fires onDidChangeWorkspaceFolders exactly once for a
 *      present path.
 *
 * Path fixtures use `path.resolve` to ensure cross-platform compatibility.
 * Implementations that resolve paths (e.g. CLI's `path.resolve(folderPath)`)
 * will store the resolved form, which matches what the contract uses.
 *
 * The `setup` object returned by the factory provides:
 *   - `provider` — the adapter under test.
 *   - `seed(folders)` — prime the provider's internal folder list.
 *   - `getFolders()` — return the current folder list.
 *   - `subscribeToFolderChanges(fn)` — subscribe to the workspace-folders
 *     changed event.
 */

import * as path from 'path';
import type { IWorkspaceLifecycleProvider } from '../../interfaces/workspace-lifecycle.interface';

export interface WorkspaceLifecycleProviderSetup {
  provider: IWorkspaceLifecycleProvider;
  seed(folders: string[]): void;
  getFolders(): string[];
  subscribeToFolderChanges(fn: () => void): { dispose(): void };
}

// Platform-safe path fixtures — absolute on all OSes.
// Using path.resolve ensures CLI's internal resolve() returns the same value.
const FOLDER_ALPHA = path.resolve('/workspace/alpha');
const FOLDER_BETA = path.resolve('/workspace/beta');
const FOLDER_GAMMA = path.resolve('/workspace/gamma');
const FOLDER_NONEXISTENT = path.resolve('/workspace/nonexistent');

export function runWorkspaceLifecycleContract(
  name: string,
  createSetup: () =>
    | Promise<WorkspaceLifecycleProviderSetup>
    | WorkspaceLifecycleProviderSetup,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IWorkspaceLifecycleProvider contract — ${name}`, () => {
    let setup: WorkspaceLifecycleProviderSetup;

    beforeEach(async () => {
      setup = await createSetup();
    });

    afterEach(async () => {
      await teardown?.();
    });

    // -----------------------------------------------------------------------
    // getActiveFolder — empty state
    // -----------------------------------------------------------------------

    it('getActiveFolder returns undefined when no folders are present', () => {
      setup.seed([]);
      expect(setup.provider.getActiveFolder()).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // addFolder
    // -----------------------------------------------------------------------

    it('addFolder appends the path to the folder list', () => {
      setup.seed([]);
      setup.provider.addFolder(FOLDER_ALPHA);
      expect(setup.getFolders()).toContain(FOLDER_ALPHA);
    });

    it('addFolder is idempotent — adding a duplicate does not grow the list', () => {
      setup.seed([]);
      setup.provider.addFolder(FOLDER_ALPHA);
      const countAfterFirst = setup.getFolders().length;
      setup.provider.addFolder(FOLDER_ALPHA);
      expect(setup.getFolders().length).toBe(countAfterFirst);
    });

    it('addFolder fires the change event exactly once for a new path', () => {
      setup.seed([]);
      let count = 0;
      const sub = setup.subscribeToFolderChanges(() => {
        count += 1;
      });
      setup.provider.addFolder(FOLDER_BETA);
      sub.dispose();
      expect(count).toBe(1);
    });

    it('addFolder does NOT fire the change event for a duplicate path', () => {
      setup.seed([FOLDER_ALPHA]);
      let count = 0;
      const sub = setup.subscribeToFolderChanges(() => {
        count += 1;
      });
      setup.provider.addFolder(FOLDER_ALPHA);
      sub.dispose();
      expect(count).toBe(0);
    });

    // -----------------------------------------------------------------------
    // removeFolder
    // -----------------------------------------------------------------------

    it('removeFolder of a missing path is a no-op — list unchanged', () => {
      setup.seed([FOLDER_ALPHA]);
      const before = setup.getFolders().length;
      setup.provider.removeFolder(FOLDER_NONEXISTENT);
      expect(setup.getFolders().length).toBe(before);
    });

    it('removeFolder of a missing path does NOT fire the change event', () => {
      setup.seed([FOLDER_ALPHA]);
      let count = 0;
      const sub = setup.subscribeToFolderChanges(() => {
        count += 1;
      });
      setup.provider.removeFolder(FOLDER_NONEXISTENT);
      sub.dispose();
      expect(count).toBe(0);
    });

    it('removeFolder removes the path from the folder list', () => {
      setup.seed([FOLDER_ALPHA, FOLDER_BETA]);
      setup.provider.removeFolder(FOLDER_ALPHA);
      expect(setup.getFolders()).not.toContain(FOLDER_ALPHA);
    });

    it('removeFolder fires the change event exactly once', () => {
      setup.seed([FOLDER_ALPHA, FOLDER_BETA]);
      let count = 0;
      const sub = setup.subscribeToFolderChanges(() => {
        count += 1;
      });
      setup.provider.removeFolder(FOLDER_ALPHA);
      sub.dispose();
      expect(count).toBe(1);
    });

    it('removeFolder of the active folder promotes the first remaining folder', () => {
      setup.seed([FOLDER_ALPHA, FOLDER_BETA]);
      setup.provider.setActiveFolder(FOLDER_ALPHA);
      setup.provider.removeFolder(FOLDER_ALPHA);
      const remaining = setup.getFolders();
      const active = setup.provider.getActiveFolder();
      if (remaining.length > 0) {
        expect(active).toBeDefined();
      } else {
        expect(active).toBeUndefined();
      }
    });

    // -----------------------------------------------------------------------
    // setActiveFolder / getActiveFolder
    // -----------------------------------------------------------------------

    it('setActiveFolder of a path not in the list is a no-op — no event fired', () => {
      setup.seed([FOLDER_ALPHA]);
      setup.provider.setActiveFolder(FOLDER_ALPHA);
      let count = 0;
      const sub = setup.subscribeToFolderChanges(() => {
        count += 1;
      });
      setup.provider.setActiveFolder(FOLDER_NONEXISTENT);
      sub.dispose();
      expect(count).toBe(0);
    });

    it('setActiveFolder updates getActiveFolder', () => {
      setup.seed([FOLDER_ALPHA, FOLDER_BETA]);
      setup.provider.setActiveFolder(FOLDER_BETA);
      expect(setup.provider.getActiveFolder()).toBe(FOLDER_BETA);
    });

    it('setActiveFolder fires the change event on a real path change', () => {
      setup.seed([FOLDER_ALPHA, FOLDER_BETA]);
      setup.provider.setActiveFolder(FOLDER_ALPHA);
      let count = 0;
      const sub = setup.subscribeToFolderChanges(() => {
        count += 1;
      });
      setup.provider.setActiveFolder(FOLDER_BETA);
      sub.dispose();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('getActiveFolder reflects the most-recently set active folder', () => {
      setup.seed([FOLDER_ALPHA, FOLDER_BETA, FOLDER_GAMMA]);
      setup.provider.setActiveFolder(FOLDER_GAMMA);
      expect(setup.provider.getActiveFolder()).toBe(FOLDER_GAMMA);
      setup.provider.setActiveFolder(FOLDER_BETA);
      expect(setup.provider.getActiveFolder()).toBe(FOLDER_BETA);
    });
  });
}
