/**
 * CLI Plugin Sync Service
 *
 * Top-level orchestrator for rival-CLI skill/command propagation. Source is the
 * user layer (~/.ptah/user/); targets are WORKSPACE-level per-CLI directories
 * (decision #4). Called from:
 * 1. Extension activation (syncOnActivation)
 * 2. Setup wizard completion (syncForce)
 * `cleanupAll` removes all Ptah-managed skills/commands (currently unwired —
 * no caller since the license-reactivity teardown was removed).
 *
 * Pattern: @injectable() singleton following CliDetectionService pattern.
 *
 * All operations are non-fatal. Sync failures never block extension activation
 * or agent generation. Errors are logged and returned in status objects.
 */

import { injectable, inject } from 'tsyringe';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type { CliTarget, CliSkillSyncStatus } from '@ptah-extension/shared';
import { CliDetectionService } from '../cli-detection.service';
import type {
  CliSkillSyncSources,
  ICliSkillInstaller,
} from './cli-skill-installer.interface';
import { CodexSkillInstaller } from './codex-skill-installer';
import { CopilotSkillInstaller } from './copilot-skill-installer';
import { CursorSkillInstaller } from './cursor-skill-installer';
import { AntigravitySkillInstaller } from './antigravity-skill-installer';
import { CliSkillManifestTracker } from './cli-skill-manifest-tracker';

const SUPPORTED_CLIS: CliTarget[] = [
  'codex',
  'copilot',
  'cursor',
  'antigravity',
];

@injectable()
export class CliPluginSyncService {
  private readonly installers: Map<CliTarget, ICliSkillInstaller> = new Map();
  private readonly manifestTracker = new CliSkillManifestTracker();
  private initialized = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {
    this.installers.set('codex', new CodexSkillInstaller());
    this.installers.set('copilot', new CopilotSkillInstaller());
    this.installers.set('cursor', new CursorSkillInstaller());
    this.installers.set('antigravity', new AntigravitySkillInstaller());

    this.logger.debug('[CliPluginSync] Service created');
  }

  /**
   * Initialize with persistent state for manifest tracking.
   * Must be called once during extension activation.
   */
  initialize(globalState: IStateStorage): void {
    this.manifestTracker.initialize(globalState);
    this.initialized = true;
    this.logger.debug('[CliPluginSync] Initialized');
  }

  /**
   * Propagate user-layer skills/commands to all installed CLIs at the
   * workspace level. Skips workspace writes when no workspace is open.
   */
  async syncOnActivation(
    sources: CliSkillSyncSources,
    workspaceRoot: string | undefined,
  ): Promise<CliSkillSyncStatus[]> {
    if (!this.initialized) {
      this.logger.warn(
        '[CliPluginSync] Not initialized, skipping activation sync',
      );
      return [];
    }
    if (!workspaceRoot) {
      this.logger.debug(
        '[CliPluginSync] No workspace open, skipping rival workspace sync',
      );
      return [];
    }

    const installedClis = await this.getInstalledCliTargets();
    if (installedClis.length === 0) {
      this.logger.debug('[CliPluginSync] No supported CLIs installed');
      return [];
    }

    const results: CliSkillSyncStatus[] = [];
    for (const cli of installedClis) {
      try {
        results.push(await this.syncForCli(cli, sources, workspaceRoot));
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'CliPluginSyncService.syncOnActivation',
        });
        this.logger.warn(`[CliPluginSync] Sync failed for ${cli}`, {
          error: err.message,
        });
        results.push({ cli, synced: false, skillCount: 0, error: err.message });
      }
    }
    return results;
  }

  /**
   * Force sync for all installed CLIs. Called from setup wizard completion.
   */
  async syncForce(
    sources: CliSkillSyncSources,
    workspaceRoot: string | undefined,
  ): Promise<CliSkillSyncStatus[]> {
    return this.syncOnActivation(sources, workspaceRoot);
  }

  /**
   * Remove all Ptah-managed skills/commands from every CLI's workspace dirs.
   * Currently unwired (no caller) — kept as a utility for a future
   * deactivation/uninstall cleanup path.
   */
  async cleanupAll(workspaceRoot?: string): Promise<void> {
    this.logger.info('[CliPluginSync] Cleaning up all CLI skills');
    for (const [cli, installer] of this.installers) {
      try {
        await installer.uninstall(workspaceRoot);
        await this.manifestTracker.clearSyncHash(cli);
        this.logger.debug(`[CliPluginSync] Cleaned up ${cli} skills`);
      } catch (error: unknown) {
        this.logger.warn(`[CliPluginSync] Skill cleanup failed for ${cli}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async syncForCli(
    cli: CliTarget,
    sources: CliSkillSyncSources,
    workspaceRoot: string,
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
      workspaceRoot,
    });

    const status = await installer.install(sources, { workspaceRoot });

    this.logger.info(`[CliPluginSync] Sync result for ${cli}`, {
      synced: status.synced,
      skillCount: status.skillCount,
      error: status.error,
    });
    return status;
  }

  private async getInstalledCliTargets(): Promise<CliTarget[]> {
    try {
      const allClis = await this.cliDetection.detectAll();
      return allClis
        .filter(
          (result) =>
            result.installed &&
            SUPPORTED_CLIS.includes(result.cli as CliTarget),
        )
        .map((result) => result.cli as CliTarget);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sentryService.captureException(err, {
        errorSource: 'CliPluginSyncService.getInstalledCliTargets',
      });
      this.logger.warn('[CliPluginSync] CLI detection failed', {
        error: err.message,
      });
      return [];
    }
  }
}
