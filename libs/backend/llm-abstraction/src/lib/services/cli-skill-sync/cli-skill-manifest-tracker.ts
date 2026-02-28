/**
 * CLI Skill Manifest Tracker
 * TASK_2025_160: Track synced plugin state per CLI using globalState
 *
 * Uses VS Code globalState (Memento) for persistence, similar to
 * PluginLoaderService's use of workspaceState (plugin-loader.service.ts:163-171).
 *
 * Content hashing uses file paths + sizes + mtimes for fast comparison
 * without reading file contents. This is sufficient to detect when
 * plugin files have changed (extension updates, plugin additions/removals).
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type * as vscode from 'vscode';
import type { CliTarget, CliPluginSyncState } from '@ptah-extension/shared';

/** GlobalState key for CLI skill sync state */
const SYNC_STATE_KEY = 'ptah.cliSkillSync';

/**
 * Tracks which plugins have been synced to which CLIs.
 *
 * Uses content hashing to avoid redundant re-syncs during extension
 * activation. Only re-copies skills when plugin content has changed.
 *
 * Late-initialized with globalState from extension context.
 */
export class CliSkillManifestTracker {
  private globalState: vscode.Memento | null = null;

  /**
   * Initialize with VS Code globalState.
   * Must be called before any sync operations.
   */
  initialize(globalState: vscode.Memento): void {
    this.globalState = globalState;
  }

  /**
   * Check if a CLI needs skill re-sync based on content hash comparison.
   *
   * @param cli - CLI target to check
   * @param pluginPaths - Current plugin paths to hash
   * @returns true if sync is needed (hash changed or never synced)
   */
  async needsSync(cli: CliTarget, pluginPaths: string[]): Promise<boolean> {
    const lastHash = this.getLastSyncHash(cli);
    if (!lastHash) {
      return true; // Never synced
    }

    const currentHash = await this.computeContentHash(pluginPaths);
    return currentHash !== lastHash;
  }

  /**
   * Get the content hash from the last successful sync for a CLI.
   */
  getLastSyncHash(cli: CliTarget): string | undefined {
    const state = this.getState();
    return state.syncedClis[cli]?.contentHash;
  }

  /**
   * Update the sync hash after a successful sync.
   */
  async updateSyncHash(
    cli: CliTarget,
    pluginPaths: string[],
    pluginIds: string[]
  ): Promise<void> {
    const hash = await this.computeContentHash(pluginPaths);
    const state = this.getState();

    const updated: CliPluginSyncState = {
      syncedClis: {
        ...state.syncedClis,
        [cli]: {
          contentHash: hash,
          syncedAt: new Date().toISOString(),
          pluginIds,
        },
      },
    };

    await this.setState(updated);
  }

  /**
   * Clear sync hash for a CLI (called on premium expiry or uninstall).
   */
  async clearSyncHash(cli: CliTarget): Promise<void> {
    const state = this.getState();
    const { [cli]: _, ...rest } = state.syncedClis;

    await this.setState({ syncedClis: rest });
  }

  /**
   * Clear all sync state (called on full cleanup).
   */
  async clearAll(): Promise<void> {
    await this.setState({ syncedClis: {} });
  }

  /**
   * Compute a content hash for plugin directories.
   *
   * Uses file paths + sizes + modification times for fast hashing
   * without reading file contents. This detects:
   * - Files added or removed
   * - Files modified (size or mtime change)
   * - Directory structure changes
   */
  async computeContentHash(pluginPaths: string[]): Promise<string> {
    const entries: string[] = [];

    for (const pluginPath of pluginPaths.sort()) {
      try {
        const skillsDir = join(pluginPath, 'skills');
        await this.collectFileEntries(skillsDir, entries);
      } catch {
        // Plugin path doesn't exist or not accessible, skip
      }
    }

    // Simple hash: sort entries and compute a numeric hash
    // This is not cryptographic, just a fast fingerprint for change detection
    return simpleHash(entries.join('|'));
  }

  /**
   * Recursively collect file metadata entries for hashing.
   */
  private async collectFileEntries(
    dirPath: string,
    entries: string[]
  ): Promise<void> {
    let dirEntries;
    try {
      dirEntries = await readdir(dirPath);
    } catch {
      return; // Directory doesn't exist
    }

    for (const entry of dirEntries.sort()) {
      const fullPath = join(dirPath, entry);
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.isDirectory()) {
          await this.collectFileEntries(fullPath, entries);
        } else if (fileStat.isFile()) {
          // Include path, size, and mtime in hash input
          entries.push(`${fullPath}:${fileStat.size}:${fileStat.mtimeMs}`);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  private getState(): CliPluginSyncState {
    if (!this.globalState) {
      return { syncedClis: {} };
    }
    return (
      this.globalState.get<CliPluginSyncState>(SYNC_STATE_KEY) ?? {
        syncedClis: {},
      }
    );
  }

  private async setState(state: CliPluginSyncState): Promise<void> {
    if (!this.globalState) {
      return;
    }
    await this.globalState.update(SYNC_STATE_KEY, state);
  }
}

/**
 * Simple non-cryptographic hash for change detection.
 * Produces a hex string from a string input.
 *
 * Uses DJB2 hash algorithm -- fast and produces good distribution
 * for file path strings. Not suitable for security, but perfect
 * for content change detection.
 */
function simpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // Convert to unsigned 32-bit and then to hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}
