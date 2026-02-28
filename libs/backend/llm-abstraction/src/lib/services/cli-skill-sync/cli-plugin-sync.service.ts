/**
 * CLI Plugin Sync Service
 * TASK_2025_160: Orchestrates plugin/skill sync across CLI targets
 *
 * Top-level orchestrator for CLI skill sync. Called from:
 * 1. Extension activation (syncOnActivation) - conditional on content hash
 * 2. Setup wizard completion (syncForce) - always re-copies
 * 3. Premium expiry (cleanupAll) - removes all synced content
 *
 * Pattern: @injectable() singleton following CliDetectionService pattern.
 *
 * All operations are non-fatal. Sync failures never block extension activation
 * or agent generation. Errors are logged and returned in status objects.
 */

import { injectable, inject } from 'tsyringe';
import { readdir, rm } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type * as vscode from 'vscode';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { CliTarget, CliSkillSyncStatus } from '@ptah-extension/shared';
import { CliDetectionService } from '../cli-detection.service';
import type { ICliSkillInstaller } from './cli-skill-installer.interface';
import { CopilotSkillInstaller } from './copilot-skill-installer';
import { GeminiSkillInstaller } from './gemini-skill-installer';
import { CliSkillManifestTracker } from './cli-skill-manifest-tracker';

/** Prefix used for all Ptah-generated agent files in CLI directories */
const PTAH_AGENT_PREFIX = 'ptah-';

@injectable()
export class CliPluginSyncService {
  /** Skill installers indexed by CLI target */
  private readonly installers: Map<CliTarget, ICliSkillInstaller> = new Map();

  /** Content hash tracker for incremental sync */
  private readonly manifestTracker = new CliSkillManifestTracker();

  /** Extension assets path (set during initialize) */
  private extensionPath: string | null = null;

  /** Whether the service has been initialized */
  private initialized = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService
  ) {
    // Register installers (one per supported CLI target)
    this.installers.set('copilot', new CopilotSkillInstaller());
    this.installers.set('gemini', new GeminiSkillInstaller());

    this.logger.debug('[CliPluginSync] Service created');
  }

  /**
   * Initialize with extension context values.
   * Must be called once during extension activation.
   *
   * @param globalState - VS Code Memento for persistent sync state
   * @param extensionPath - Absolute path to extension directory (context.extensionPath)
   */
  initialize(globalState: vscode.Memento, extensionPath: string): void {
    this.manifestTracker.initialize(globalState);
    this.extensionPath = extensionPath;
    this.initialized = true;

    this.logger.debug('[CliPluginSync] Initialized', { extensionPath });
  }

  /**
   * Sync skills for all installed CLIs, skipping if content hasn't changed.
   *
   * Called during extension activation for premium users.
   * Uses content hashing to skip re-copy when plugins haven't changed.
   *
   * @param enabledPluginIds - Plugin IDs enabled in workspace config
   * @returns Per-CLI sync status array
   */
  async syncOnActivation(
    enabledPluginIds: string[]
  ): Promise<CliSkillSyncStatus[]> {
    if (!this.initialized || !this.extensionPath) {
      this.logger.warn(
        '[CliPluginSync] Not initialized, skipping activation sync'
      );
      return [];
    }

    if (enabledPluginIds.length === 0) {
      this.logger.debug(
        '[CliPluginSync] No enabled plugins, skipping activation sync'
      );
      return [];
    }

    const pluginPaths = this.resolvePluginPaths(enabledPluginIds);
    if (pluginPaths.length === 0) {
      return [];
    }

    // Detect installed CLIs
    const installedClis = await this.getInstalledCliTargets();
    if (installedClis.length === 0) {
      this.logger.debug('[CliPluginSync] No supported CLIs installed');
      return [];
    }

    const results: CliSkillSyncStatus[] = [];

    for (const cli of installedClis) {
      try {
        // Check if sync is needed (content hash comparison)
        const needsSync = await this.manifestTracker.needsSync(
          cli,
          pluginPaths
        );
        if (!needsSync) {
          this.logger.debug(`[CliPluginSync] ${cli} already up-to-date`);
          results.push({
            cli,
            synced: true,
            skillCount: 0,
            lastSyncedAt: this.manifestTracker.getLastSyncHash(cli)
              ? new Date().toISOString()
              : undefined,
          });
          continue;
        }

        // Perform sync
        const status = await this.syncForCli(
          cli,
          pluginPaths,
          enabledPluginIds
        );
        results.push(status);
      } catch (error) {
        this.logger.warn(`[CliPluginSync] Sync failed for ${cli}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          cli,
          synced: false,
          skillCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Force sync for all installed CLIs, regardless of content hash.
   * Called from setup wizard completion to ensure fresh state.
   *
   * @param enabledPluginIds - Plugin IDs enabled in workspace config
   * @returns Per-CLI sync status array
   */
  async syncForce(enabledPluginIds: string[]): Promise<CliSkillSyncStatus[]> {
    if (!this.initialized || !this.extensionPath) {
      this.logger.warn('[CliPluginSync] Not initialized, skipping force sync');
      return [];
    }

    if (enabledPluginIds.length === 0) {
      return [];
    }

    const pluginPaths = this.resolvePluginPaths(enabledPluginIds);
    if (pluginPaths.length === 0) {
      return [];
    }

    const installedClis = await this.getInstalledCliTargets();
    const results: CliSkillSyncStatus[] = [];

    for (const cli of installedClis) {
      try {
        const status = await this.syncForCli(
          cli,
          pluginPaths,
          enabledPluginIds
        );
        results.push(status);
      } catch (error) {
        results.push({
          cli,
          synced: false,
          skillCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Remove all Ptah skills and agents from all CLIs.
   * Called on premium expiry or extension deactivation.
   */
  async cleanupAll(): Promise<void> {
    this.logger.info('[CliPluginSync] Cleaning up all CLI skills and agents');

    for (const [cli, installer] of this.installers) {
      try {
        await installer.uninstall();
        await this.manifestTracker.clearSyncHash(cli);
        this.logger.debug(`[CliPluginSync] Cleaned up ${cli} skills`);
      } catch (error) {
        this.logger.warn(`[CliPluginSync] Skill cleanup failed for ${cli}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Remove Ptah-generated agent files from CLI directories
    await this.removeCliAgents(['copilot', 'gemini']);
  }

  /**
   * Remove Ptah-generated agent files from CLI user-level directories.
   *
   * Uses the `ptah-` filename prefix convention to identify Ptah-generated
   * agent files without needing a manifest. Only deletes files that start
   * with `ptah-` to avoid touching user-created agents.
   *
   * @param clis - CLI targets to clean up
   */
  async removeCliAgents(clis: CliTarget[]): Promise<void> {
    const homeDir = homedir();

    for (const cli of clis) {
      try {
        const agentsDir = join(homeDir, `.${cli}`, 'agents');
        let entries: string[];
        try {
          entries = await readdir(agentsDir);
        } catch {
          continue; // Directory doesn't exist
        }

        // Remove only Ptah-generated files (identified by ptah- prefix)
        let removedCount = 0;
        for (const entry of entries) {
          if (entry.startsWith(PTAH_AGENT_PREFIX)) {
            try {
              await rm(join(agentsDir, entry), { force: true });
              removedCount++;
            } catch {
              // Best-effort deletion
            }
          }
        }

        this.logger.debug(
          `[CliPluginSync] Agent cleanup for ${cli}: removed ${removedCount} of ${entries.length} files`
        );
      } catch (error) {
        this.logger.warn(`[CliPluginSync] Agent cleanup failed for ${cli}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Sync skills for a single CLI target.
   */
  private async syncForCli(
    cli: CliTarget,
    pluginPaths: string[],
    enabledPluginIds: string[]
  ): Promise<CliSkillSyncStatus> {
    const installer = this.installers.get(cli);
    if (!installer) {
      return {
        cli,
        synced: false,
        skillCount: 0,
        error: `No installer found for ${cli}`,
      };
    }

    this.logger.info(`[CliPluginSync] Syncing skills to ${cli}`, {
      pluginCount: pluginPaths.length,
    });

    const status = await installer.install(pluginPaths);

    if (status.synced) {
      // Update manifest tracker with new hash
      await this.manifestTracker.updateSyncHash(
        cli,
        pluginPaths,
        enabledPluginIds
      );
    }

    this.logger.info(`[CliPluginSync] Sync result for ${cli}`, {
      synced: status.synced,
      skillCount: status.skillCount,
      error: status.error,
    });

    return status;
  }

  /**
   * Resolve absolute plugin paths from plugin IDs.
   */
  private resolvePluginPaths(pluginIds: string[]): string[] {
    const extPath = this.extensionPath;
    if (!extPath) {
      return [];
    }

    return pluginIds.map((id) => join(extPath, 'assets', 'plugins', id));
  }

  /**
   * Get installed CLI targets (copilot/gemini only, not codex).
   */
  private async getInstalledCliTargets(): Promise<CliTarget[]> {
    try {
      const allClis = await this.cliDetection.detectAll();
      return allClis
        .filter(
          (result) =>
            result.installed &&
            (result.cli === 'copilot' || result.cli === 'gemini')
        )
        .map((result) => result.cli as CliTarget);
    } catch (error) {
      this.logger.warn('[CliPluginSync] CLI detection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
