/**
 * MCP Install Service — the public install surface, now a thin wrapper over the
 * harness reconciler.
 *
 * The RPC contract is unchanged: `install`, `uninstall`, `listInstalled` and
 * `getConfigPath` still behave as the marketplace, `ptah mcp` and the harness
 * apply path expect. What changed is what happens underneath.
 *
 * It used to own four installers that each wrote a config file directly, plus a
 * manifest recording what had been written so an uninstall knew where to look.
 * That made MCP a fifth, parallel fan-out alongside skills, commands, agents
 * and junctions — with its own idea of ownership, no reconciliation, and no
 * Codex writer at all, so every server "installed for codex" landed in a config
 * Codex does not read (defect 12).
 *
 * Now the write path is: RECORD INTENT, then RECONCILE. The intent store
 * (`~/.ptah/mcp-installed.json`, the same file the old tracker wrote) becomes
 * the desired state, and the reconciler's per-target MCP facets do the writing
 * under the same manifest that owns every other artifact. Two consequences
 * worth stating:
 *
 * - An install is now IDEMPOTENT and SELF-HEALING. A config file the user
 *   deletes is restored by the next reconcile, which happens at every host
 *   activation, rather than staying missing until they reinstall the server.
 * - The user's own entries in those files are safe by construction. They are
 *   not in the manifest, so nothing here can rewrite or delete them.
 *
 * Without a reconciler the service degrades to intent-recording only, reporting
 * a clear error per target instead of writing anything. That is the state in a
 * bare container, and it is preferable to falling back to a second write path.
 */

import {
  createAllMcpFacets,
  McpIntentStore,
  type HarnessReconcilerService,
  type IHarnessMcpFacet,
} from '@ptah-extension/harness-sync';
import type {
  HarnessTargetHealth,
  InstalledMcpServer,
  McpInstallResult,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';

/** Every target the install surface offers, for a bare `uninstall` sweep. */
const ALL_TARGETS: McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'copilot',
  'codex',
];

export class McpInstallService {
  private readonly facets: Map<McpInstallTarget, IHarnessMcpFacet>;

  constructor(
    /**
     * `null` in containers that never registered `harness-sync`. Install and
     * uninstall then record intent and report the failure per target; they do
     * not write, because a second write path is exactly what this change
     * removes.
     */
    private readonly reconciler: HarnessReconcilerService | null = null,
    private readonly intents: McpIntentStore = new McpIntentStore(),
  ) {
    this.facets = createAllMcpFacets();
  }

  /**
   * Install an MCP server to one or more targets.
   *
   * @param serverName - Registry name for tracking (e.g. `io.github.user/server`)
   * @param serverKey - Config key (e.g. `github`, `filesystem`)
   * @param config - Transport configuration
   * @param targets - Which targets to install to
   * @param workspaceRoot - Needed by the workspace-scoped targets
   */
  async install(
    serverName: string,
    serverKey: string,
    config: McpServerConfig,
    targets: McpInstallTarget[],
    workspaceRoot?: string,
  ): Promise<McpInstallResult[]> {
    // Intent first: the reconciler's desired state IS this file, so recording
    // after reconciling would make the pass a no-op.
    this.intents.record(serverKey, serverName, targets, config);
    return this.reconcileTargets(
      targets,
      workspaceRoot,
      serverKey,
      'mcp:install',
    );
  }

  /**
   * Uninstall an MCP server from one or more targets. With no targets given,
   * every target the server was recorded against is visited.
   */
  async uninstall(
    serverKey: string,
    targets?: McpInstallTarget[],
    workspaceRoot?: string,
  ): Promise<McpInstallResult[]> {
    const recorded = this.intents.targetsFor(serverKey);
    const requested =
      targets !== undefined && targets.length > 0 ? targets : recorded;
    const visited = requested.length > 0 ? requested : ALL_TARGETS;

    this.intents.forget(serverKey, targets);
    return this.reconcileTargets(
      visited,
      workspaceRoot,
      serverKey,
      'mcp:uninstall',
    );
  }

  /**
   * Every MCP server declared in every target's config file, Ptah's and the
   * user's alike, flagged by whether Ptah recorded an intent for it.
   */
  async listInstalled(workspaceRoot?: string): Promise<InstalledMcpServer[]> {
    await Promise.resolve();
    const servers: InstalledMcpServer[] = [];

    for (const [target, facet] of this.facets) {
      const configPath = facet.configPath(workspaceRoot ?? '');
      if (configPath === null) continue;

      for (const [serverKey, config] of facet.readAll(workspaceRoot ?? '')) {
        servers.push({
          serverKey,
          target,
          configPath,
          config,
          managedByPtah: this.intents.has(serverKey),
        });
      }
    }
    return servers;
  }

  /** Absolute config path for a target, or `null` when it cannot be resolved. */
  getConfigPath(
    target: McpInstallTarget,
    workspaceRoot?: string,
  ): string | null {
    const facet = this.facets.get(target);
    if (facet === undefined) return null;
    try {
      return facet.configPath(workspaceRoot ?? '');
    } catch {
      return null;
    }
  }

  /**
   * Run one reconcile pass restricted to the affected targets and translate the
   * health report back into the per-target results the RPC contract returns.
   */
  private async reconcileTargets(
    targets: McpInstallTarget[],
    workspaceRoot: string | undefined,
    serverKey: string,
    reason: string,
  ): Promise<McpInstallResult[]> {
    if (this.reconciler === null) {
      return targets.map((target) => ({
        target,
        configPath: this.getConfigPath(target, workspaceRoot) ?? '',
        success: false,
        error: 'Harness reconciler is not available in this host',
      }));
    }

    if (workspaceRoot === undefined || workspaceRoot === '') {
      return targets.map((target) => ({
        target,
        configPath: this.getConfigPath(target, workspaceRoot) ?? '',
        success: false,
        error: 'No workspace folder open',
      }));
    }

    let health: HarnessTargetHealth[];
    try {
      const report = await this.reconciler.reconcile(workspaceRoot, {
        mode: 'full',
        targets,
        reason,
      });
      health = report.targets;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return targets.map((target) => ({
        target,
        configPath: this.getConfigPath(target, workspaceRoot) ?? '',
        success: false,
        error: message,
      }));
    }

    return targets.map((target) => {
      const configPath = this.getConfigPath(target, workspaceRoot) ?? '';
      const reported = health.find((entry) => entry.target === target);
      // A failure is attributed to THIS server only when its own key failed to
      // write; another server's problem must not make this call look broken.
      const failure = reported?.writeFailed.find((entry) =>
        entry.relPath.endsWith(`#${serverKey}`),
      );
      return failure === undefined
        ? { target, configPath, success: true }
        : { target, configPath, success: false, error: failure.reason };
    });
  }
}
