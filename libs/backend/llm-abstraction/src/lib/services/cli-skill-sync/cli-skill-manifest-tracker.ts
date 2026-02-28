/**
 * CLI Skill Manifest Tracker
 * TASK_2025_160: Track synced plugin state per CLI using globalState
 *
 * Uses VS Code globalState (Memento) for persistence, similar to
 * PluginLoaderService's use of workspaceState (plugin-loader.service.ts:163-171).
 *
 * Content hashing uses relative file paths + file sizes for change detection.
 * Uses crypto.createHash('sha256') for collision-resistant hashing.
 *
 * Design decisions:
 * - Relative paths (from plugin root) make hashes portable across reinstalls
 * - File size (not mtime) avoids false positives from git operations
 * - SHA-256 eliminates collision risk of DJB2's 32-bit space
 */

import { createHash } from 'crypto';
import { readdir, lstat } from 'fs/promises';
import { join, relative } from 'path';
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
   * Uses relative file paths + file sizes for stable hashing:
   * - Relative paths: hash doesn't change on extension reinstall
   * - File size only (no mtime): git operations don't invalidate hash
   * - SHA-256: collision-resistant (vs DJB2's 32-bit space)
   */
  async computeContentHash(pluginPaths: string[]): Promise<string> {
    const entries: string[] = [];

    for (const pluginPath of pluginPaths.sort()) {
      try {
        const skillsDir = join(pluginPath, 'skills');
        await this.collectFileEntries(skillsDir, pluginPath, entries);
      } catch {
        // Plugin path doesn't exist or not accessible, skip
      }
    }

    // SHA-256 hash for collision resistance
    return createHash('sha256')
      .update(entries.join('|'))
      .digest('hex')
      .substring(0, 16); // 16 hex chars = 64 bits, more than sufficient
  }

  /**
   * Recursively collect file metadata entries for hashing.
   * Uses lstat() to avoid following symlinks.
   * Uses relative paths from pluginRoot for portability.
   */
  private async collectFileEntries(
    dirPath: string,
    pluginRoot: string,
    entries: string[]
  ): Promise<void> {
    let dirEntries: string[];
    try {
      dirEntries = await readdir(dirPath);
    } catch {
      return; // Directory doesn't exist
    }

    for (const entry of dirEntries.sort()) {
      const fullPath = join(dirPath, entry);
      try {
        // Use lstat() to detect symlinks without following them
        const fileStat = await lstat(fullPath);

        if (fileStat.isSymbolicLink()) {
          continue; // Skip symlinks
        }

        if (fileStat.isDirectory()) {
          await this.collectFileEntries(fullPath, pluginRoot, entries);
        } else if (fileStat.isFile()) {
          // Use relative path + size (no mtime) for stable hashing
          const relPath = relative(pluginRoot, fullPath);
          entries.push(`${relPath}:${fileStat.size}`);
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
