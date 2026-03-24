/**
 * WorkspaceContextManager — Manages per-workspace storage isolation
 * via WorkspaceAwareStateStorage proxy.
 *
 * TASK_2025_208: Simplified from child-container approach. Instead of creating
 * tsyringe child containers (which don't work because RPC handler singletons
 * inject workspace-scoped services at construction time), this manager
 * delegates to WorkspaceAwareStateStorage which routes get/update calls
 * to the correct workspace's storage at call-time.
 *
 * Responsibilities:
 * - Create per-workspace storage directories and register them with the proxy
 * - Track the active workspace for storage routing
 * - Validate workspace folder paths exist on disk
 * - Restore workspaces from persisted paths at startup
 * - Clean up workspace storage references on removal
 */

import * as path from 'path';
import * as fs from 'fs';
import type { WorkspaceAwareStateStorage } from './workspace-aware-state-storage';

/**
 * Check if a path exists on disk using async fs.promises.access.
 * Returns true if accessible, false otherwise.
 */
async function pathExists(filePath: string): Promise<boolean> {
  return fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

/**
 * Create a filesystem-safe workspace identifier from a folder path.
 * Uses base64url encoding to avoid special characters in directory names.
 * Matches the pattern in platform-electron/src/registration.ts.
 */
function encodeWorkspacePath(folderPath: string): string {
  return Buffer.from(folderPath).toString('base64url');
}

export class WorkspaceContextManager {
  constructor(
    private readonly userDataPath: string,
    private readonly workspaceAwareStorage: WorkspaceAwareStateStorage
  ) {}

  /**
   * Create a new workspace: registers an ElectronStateStorage instance
   * in the proxy for the given workspace path.
   *
   * Returns the encoded path (base64url) for the workspace, or null if
   * the folder does not exist on disk.
   */
  async createWorkspace(
    workspacePath: string
  ): Promise<
    { success: true; encodedPath: string } | { success: false; error: string }
  > {
    const normalizedPath = path.resolve(workspacePath);

    // Check if already registered
    if (
      this.workspaceAwareStorage.getAllWorkspacePaths().includes(normalizedPath)
    ) {
      return {
        success: true,
        encodedPath: encodeWorkspacePath(normalizedPath),
      };
    }

    // Validate folder exists on disk (async to avoid blocking event loop)
    if (!(await pathExists(normalizedPath))) {
      return {
        success: false,
        error: `Workspace folder does not exist: ${normalizedPath}`,
      };
    }

    const encodedPath = encodeWorkspacePath(normalizedPath);
    const storageDirPath = path.join(
      this.userDataPath,
      'workspace-storage',
      encodedPath
    );

    this.workspaceAwareStorage.addWorkspace(normalizedPath, storageDirPath);

    return { success: true, encodedPath };
  }

  /**
   * Remove a workspace's storage registration.
   * If the removed workspace was active, the proxy falls back to default storage.
   */
  removeWorkspace(workspacePath: string): void {
    const normalizedPath = path.resolve(workspacePath);
    this.workspaceAwareStorage.removeWorkspace(normalizedPath);
  }

  /**
   * Switch the active workspace. All WORKSPACE_STATE_STORAGE reads/writes
   * will now route to this workspace's storage.
   *
   * Creates the workspace lazily if not yet registered.
   * Returns the encoded path on success, or undefined on failure.
   */
  async switchWorkspace(workspacePath: string): Promise<string | undefined> {
    const normalizedPath = path.resolve(workspacePath);

    // Lazy creation if not yet registered
    if (
      !this.workspaceAwareStorage
        .getAllWorkspacePaths()
        .includes(normalizedPath)
    ) {
      const result = await this.createWorkspace(normalizedPath);
      if (!result.success) {
        return undefined;
      }
    }

    this.workspaceAwareStorage.setActiveWorkspace(normalizedPath);
    return encodeWorkspacePath(normalizedPath);
  }

  /**
   * Get the currently active workspace path, or null if none is set.
   */
  getActiveWorkspacePath(): string | null {
    return this.workspaceAwareStorage.getActiveWorkspacePath();
  }

  /**
   * Get all registered workspace paths.
   */
  getAllWorkspacePaths(): string[] {
    return this.workspaceAwareStorage.getAllWorkspacePaths();
  }

  /**
   * Get the encoded path for a workspace folder.
   */
  getEncodedPath(workspacePath: string): string {
    return encodeWorkspacePath(path.resolve(workspacePath));
  }

  /**
   * Restore workspaces from persisted state at startup.
   * Creates storage for all valid paths, then sets the active workspace.
   *
   * @param paths - Array of workspace folder paths to restore
   * @param activePath - The path that should be set as active (optional)
   */
  async restoreWorkspaces(paths: string[], activePath?: string): Promise<void> {
    for (const folderPath of paths) {
      const normalizedPath = path.resolve(folderPath);

      if (!(await pathExists(normalizedPath))) {
        continue;
      }

      await this.createWorkspace(normalizedPath);
    }

    // Set active workspace
    if (activePath) {
      const normalizedActive = path.resolve(activePath);
      if (
        this.workspaceAwareStorage
          .getAllWorkspacePaths()
          .includes(normalizedActive)
      ) {
        this.workspaceAwareStorage.setActiveWorkspace(normalizedActive);
      }
    } else if (paths.length > 0) {
      // Activate the first valid workspace
      const allPaths = this.workspaceAwareStorage.getAllWorkspacePaths();
      if (allPaths.length > 0) {
        this.workspaceAwareStorage.setActiveWorkspace(allPaths[0]);
      }
    }
  }

  /**
   * Dispose all workspace storage references. Called on app shutdown.
   */
  disposeAll(): void {
    const allPaths = this.workspaceAwareStorage.getAllWorkspacePaths();
    for (const workspacePath of allPaths) {
      this.workspaceAwareStorage.removeWorkspace(workspacePath);
    }
  }
}
