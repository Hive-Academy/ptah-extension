/**
 * WorkspaceAwareStateStorage — IStateStorage proxy that delegates to
 * per-workspace ElectronStateStorage instances based on the active workspace.
 *
 * TASK_2025_208: Replaces child container approach. This proxy is registered
 * as PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, so all services that inject
 * workspace-scoped storage automatically get the active workspace's storage
 * without needing child containers.
 *
 * Key insight: RPC handler singletons inject WORKSPACE_STATE_STORAGE at
 * construction time. With child containers, they'd get the root container's
 * instance and never see workspace-specific data. This proxy solves that
 * by delegating at call-time to the active workspace's storage.
 */

import type { IStateStorage } from '@ptah-extension/platform-core';
import { ElectronStateStorage } from '@ptah-extension/platform-electron';

export class WorkspaceAwareStateStorage implements IStateStorage {
  private readonly workspaces = new Map<string, ElectronStateStorage>();
  private activeWorkspacePath: string | null = null;
  private readonly defaultStorage: ElectronStateStorage;

  constructor(defaultStoragePath: string) {
    this.defaultStorage = new ElectronStateStorage(
      defaultStoragePath,
      'workspace-state.json'
    );
  }

  /**
   * Add a workspace with its own ElectronStateStorage instance.
   * If the workspace already exists, this is a no-op.
   */
  addWorkspace(workspacePath: string, storageDirPath: string): void {
    if (this.workspaces.has(workspacePath)) {
      return;
    }
    this.workspaces.set(
      workspacePath,
      new ElectronStateStorage(storageDirPath, 'workspace-state.json')
    );
  }

  /**
   * Remove a workspace's storage instance, allowing it to be garbage collected.
   * If the removed workspace was active, resets to null (falls back to default).
   */
  removeWorkspace(workspacePath: string): void {
    this.workspaces.delete(workspacePath);
    if (this.activeWorkspacePath === workspacePath) {
      this.activeWorkspacePath = null;
    }
  }

  /**
   * Switch the active workspace. All subsequent get/update/keys calls
   * will delegate to this workspace's storage.
   */
  setActiveWorkspace(workspacePath: string): void {
    if (!this.workspaces.has(workspacePath)) {
      throw new Error(
        `Cannot set active workspace: no storage registered for "${workspacePath}". Call addWorkspace() first.`
      );
    }
    this.activeWorkspacePath = workspacePath;
  }

  /**
   * Get the currently active workspace path, or null if none is set.
   */
  getActiveWorkspacePath(): string | null {
    return this.activeWorkspacePath;
  }

  /**
   * Get all registered workspace paths.
   */
  getAllWorkspacePaths(): string[] {
    return Array.from(this.workspaces.keys());
  }

  /**
   * Get a value from the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.getActiveStorage().get<T>(key, defaultValue);
  }

  /**
   * Update a value in the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  async update(key: string, value: unknown): Promise<void> {
    await this.getActiveStorage().update(key, value);
  }

  /**
   * Get all keys from the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  keys(): readonly string[] {
    return this.getActiveStorage().keys();
  }

  /**
   * Get the storage instance for a specific workspace path.
   * Returns undefined if no storage is registered for that path.
   */
  getStorageForWorkspace(
    workspacePath: string
  ): ElectronStateStorage | undefined {
    return this.workspaces.get(workspacePath);
  }

  /**
   * Resolve the active storage delegate.
   * Returns the active workspace's storage if set, otherwise the default.
   */
  private getActiveStorage(): IStateStorage {
    if (this.activeWorkspacePath) {
      const storage = this.workspaces.get(this.activeWorkspacePath);
      if (storage) {
        return storage;
      }
    }
    return this.defaultStorage;
  }
}
