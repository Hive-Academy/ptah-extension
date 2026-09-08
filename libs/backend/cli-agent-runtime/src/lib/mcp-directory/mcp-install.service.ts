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
 *
 * ## `listInstalled` reads FOUR sources, not one
 *
 * It used to read the six harness MCP facets alone, so the Installed tab
 * reported eight servers on a machine running about eleven. A Smithery install,
 * an in-app OAuth connection and anything the user added with `claude mcp add`
 * were each real, connected, and invisible. Every row now carries its
 * {@link McpServerOrigin}, a display label, and the {@link McpRemovalKind} that
 * says how — or whether — it can be removed. Rows are deduplicated by
 * (`serverKey`, `origin`, `configPath`) and NOT by key alone: the same key
 * legitimately lives in several config files, and each of those is its own row.
 *
 * claude.ai ACCOUNT connectors (Gmail, Calendar, Drive, Canva) are deliberately
 * absent. They exist nowhere on disk; the frontend derives those rows from live
 * session status, and this service stops at disk and manifest stores.
 *
 * ## The uninstall that reported success and removed nothing
 *
 * The reconciler deletes only manifest-owned keys — a key the user wrote by
 * hand is `foreign` and is never touched, which is CORRECT and did not change.
 * What was wrong is that `reconcileTargets` reported `success: true` for it,
 * because it only fails a target when a write for that exact key failed, and no
 * write was attempted. Two halves fix it: an ordinary uninstall now re-reads the
 * config and reports `success: false` when the key survived, and `force: true`
 * removes an unowned key through the facet — the same lock and the same format
 * the reconciler uses, never a hand-rolled read-modify-write.
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
  McpOAuthConnectedRecord,
  McpServerConfig,
  McpServerOrigin,
  SmitheryInstalledRecord,
} from '@ptah-extension/shared';
import {
  readClaudeUserMcpServers,
  type ClaudeUserMcpScope,
} from './claude-user-mcp.reader';
import {
  buildSmitheryNamespaceUrl,
  SMITHERY_DEFAULT_CONNECTION_HOST,
} from './smithery-wire.constants';

/** Every target the install surface offers, for a bare `uninstall` sweep. */
const ALL_TARGETS: McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'copilot',
  'codex',
  'antigravity',
];

/** Display label per origin. One place, so the four readers cannot disagree. */
const ORIGIN_LABELS: Record<McpServerOrigin, string> = {
  'harness-config': 'Config file',
  'claude-user': 'Claude CLI',
  smithery: 'Smithery',
  oauth: 'OAuth',
  'claude-connector': 'Claude account',
};

/**
 * The Smithery half of `listInstalled`, narrowed to the one method it needs.
 *
 * Structural rather than a class import so the RPC handler passes the store it
 * ALREADY owns — `SmitheryInstalledManifestStore` re-reads its file per call,
 * and a second instance built here would be a parallel reader of the same
 * manifest with its own staleness.
 */
export interface SmitheryInstalledReader {
  /** Absolute path of the manifest, reported as the row's `configPath`. */
  readonly filePath: string;
  list(): SmitheryInstalledRecord[];
}

/** The OAuth half of `listInstalled`. See {@link SmitheryInstalledReader}. */
export interface McpOAuthInstalledReader {
  readonly filePath: string;
  list(): McpOAuthConnectedRecord[];
}

export interface McpInstallServiceOptions {
  /** Overridable so a spec never reaches the developer's real home. */
  homeDir?: string;
  /** The handler's own Smithery manifest store. Omitted = no Smithery rows. */
  smithery?: SmitheryInstalledReader;
  /** The handler's own OAuth manifest store. Omitted = no OAuth rows. */
  oauth?: McpOAuthInstalledReader;
}

/** Options for {@link McpInstallService.uninstall}. */
export interface McpUninstallOptions {
  /**
   * Remove a key Ptah does not own, directly through the target's facet.
   *
   * Only ever true behind an explicit user confirm: the entry belongs to the
   * user, not to Ptah, and deleting it is not something a routine uninstall
   * gets to decide.
   */
  force?: boolean;
}

export class McpInstallService {
  private readonly facets: Map<McpInstallTarget, IHarnessMcpFacet>;
  private readonly options: McpInstallServiceOptions;

  constructor(
    /**
     * `null` in containers that never registered `harness-sync`. Install and
     * uninstall then record intent and report the failure per target; they do
     * not write, because a second write path is exactly what this change
     * removes.
     */
    private readonly reconciler: HarnessReconcilerService | null = null,
    private readonly intents: McpIntentStore = new McpIntentStore(),
    options: McpInstallServiceOptions = {},
  ) {
    this.options = options;
    this.facets = createAllMcpFacets(
      options.homeDir === undefined ? {} : { homeDir: options.homeDir },
    );
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
   *
   * Two paths, chosen by ownership rather than by the caller:
   *
   * - The key is manifest-owned, or `force` is false: drop the intent and
   *   reconcile, exactly as before. The result is then VERIFIED against the
   *   config file, so a key the reconciler correctly refused to touch is
   *   reported as a refusal instead of a success.
   * - `force` is true and the key is not Ptah's: delete it through the target's
   *   facet, which owns the file's format and holds its lock.
   */
  async uninstall(
    serverKey: string,
    targets?: McpInstallTarget[],
    workspaceRoot?: string,
    options: McpUninstallOptions = {},
  ): Promise<McpInstallResult[]> {
    const recorded = this.intents.targetsFor(serverKey);
    const requested =
      targets !== undefined && targets.length > 0 ? targets : recorded;
    const visited = requested.length > 0 ? requested : ALL_TARGETS;
    const managed = this.intents.has(serverKey);

    if (options.force === true && !managed) {
      return this.removeUnowned(visited, workspaceRoot, serverKey);
    }

    this.intents.forget(serverKey, targets);
    const results = await this.reconcileTargets(
      visited,
      workspaceRoot,
      serverKey,
      'mcp:uninstall',
    );
    return results.map((result) =>
      this.verifyRemoved(result, serverKey, workspaceRoot),
    );
  }

  /**
   * Every MCP server this machine has, from all four disk/manifest sources,
   * each row flagged with where it came from and how it can be removed.
   */
  async listInstalled(workspaceRoot?: string): Promise<InstalledMcpServer[]> {
    await Promise.resolve();
    const rows = [
      ...this.harnessConfigRows(workspaceRoot),
      ...this.claudeUserRows(workspaceRoot),
      ...this.smitheryRows(),
      ...this.oauthRows(),
    ];

    // Identity is (serverKey, origin, configPath). NOT the key alone: one
    // server installed to five targets is five real rows in five real files,
    // and that is exactly how the Installed tab groups them today.
    const seen = new Set<string>();
    const deduped: InstalledMcpServer[] = [];
    for (const row of rows) {
      const identity = `${row.origin} ${row.configPath} ${row.serverKey}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      deduped.push(row);
    }
    return deduped;
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
      // degradation-audit: optional-capability - per the doc comment on this
      // method, an unresolvable config path is the documented null return, not
      // a hidden failure.
    } catch {
      return null;
    }
  }

  /** The six reconciler-owned config files. */
  private harnessConfigRows(workspaceRoot?: string): InstalledMcpServer[] {
    const rows: InstalledMcpServer[] = [];
    for (const [target, facet] of this.facets) {
      const configPath = facet.configPath(workspaceRoot ?? '');
      if (configPath === null) continue;

      for (const [serverKey, config] of facet.readAll(workspaceRoot ?? '')) {
        const managedByPtah = this.intents.has(serverKey);
        rows.push({
          serverKey,
          target,
          configPath,
          config,
          managedByPtah,
          origin: 'harness-config',
          originLabel: ORIGIN_LABELS['harness-config'],
          // An unowned key IS removable — but only deliberately, because
          // deleting it is deleting something the user wrote.
          removal: managedByPtah ? 'ptah-managed' : 'direct',
        });
      }
    }
    return rows;
  }

  /** `~/.claude.json`, user scope and this workspace's project scope. */
  private claudeUserRows(workspaceRoot?: string): InstalledMcpServer[] {
    return readClaudeUserMcpServers(
      workspaceRoot,
      this.options.homeDir === undefined
        ? {}
        : { homeDir: this.options.homeDir },
    ).map((entry) => ({
      serverKey: entry.serverKey,
      configPath: entry.configPath,
      config: entry.config,
      managedByPtah: false,
      origin: 'claude-user' as const,
      originLabel: ORIGIN_LABELS['claude-user'],
      // Read-only by design: this file belongs to the `claude` CLI and carries
      // far more than MCP servers, so Ptah never writes it.
      removal: 'none' as const,
      removalBlockedReason: claudeUserRemovalReason(
        entry.serverKey,
        entry.scope,
        entry.configPath,
      ),
    }));
  }

  /** `~/.ptah/smithery-installed.json`, when the caller supplied its store. */
  private smitheryRows(): InstalledMcpServer[] {
    const reader = this.options.smithery;
    if (reader === undefined) return [];

    let records: SmitheryInstalledRecord[];
    try {
      records = reader.list();
    } catch {
      // degradation-audit: optional-capability - the Smithery rows are one of
      // several sources the Installed tab concatenates, so an unreadable
      // store costs that section and leaves every other source rendered.
      // One unreadable store must not empty the whole Installed tab.
      return [];
    }

    return records.map((record) => ({
      serverKey: record.serverKey,
      configPath: reader.filePath,
      // SECURITY: the endpoint only, never the secret-bearing session URL —
      // the API key and per-server config live in the encrypted store and are
      // rebuilt at query time.
      config: smitheryDisplayConfig(record),
      managedByPtah: true,
      origin: 'smithery' as const,
      originLabel: ORIGIN_LABELS.smithery,
      removal: 'smithery' as const,
    }));
  }

  /** `~/.ptah/mcp-oauth-installed.json`, when the caller supplied its store. */
  private oauthRows(): InstalledMcpServer[] {
    const reader = this.options.oauth;
    if (reader === undefined) return [];

    let records: McpOAuthConnectedRecord[];
    try {
      records = reader.list();
    } catch {
      // degradation-audit: optional-capability - same contract as the
      // Smithery rows above: the OAuth section drops out of the Installed
      // tab, the sections backed by readable stores still render.
      return [];
    }

    return records.map((record) => ({
      serverKey: record.serverKey,
      configPath: reader.filePath,
      // SECURITY: the server URL is non-secret; the tokens are in the
      // encrypted store and never cross this boundary.
      config: { type: 'http' as const, url: record.serverUrl },
      managedByPtah: true,
      origin: 'oauth' as const,
      originLabel: ORIGIN_LABELS.oauth,
      removal: 'oauth' as const,
    }));
  }

  /**
   * Delete an unowned key from each requested target, through the facet.
   *
   * Never a hand-rolled read-modify-write: the facet owns the dialect (`agy`
   * spells a remote endpoint `serverUrl`) and holds the per-config-file lock
   * that stops two writers losing each other's entry.
   */
  private async removeUnowned(
    targets: McpInstallTarget[],
    workspaceRoot: string | undefined,
    serverKey: string,
  ): Promise<McpInstallResult[]> {
    const results: McpInstallResult[] = [];
    for (const target of targets) {
      const facet = this.facets.get(target);
      const configPath = this.getConfigPath(target, workspaceRoot) ?? '';
      if (facet === undefined || configPath === '') {
        results.push({
          target,
          configPath,
          success: false,
          error: `No MCP config file could be resolved for target "${target}"`,
        });
        continue;
      }

      try {
        await facet.remove(workspaceRoot ?? '', serverKey);
        results.push({ target, configPath, success: true });
      } catch (error: unknown) {
        results.push({
          target,
          configPath,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /**
   * Turn a reconcile that removed nothing into an observable refusal.
   *
   * The reconciler reports a target healthy when no write for this key failed,
   * and a key it declined to touch produced no write at all — so a hand-written
   * entry survived an uninstall that returned `success: true`. Re-reading the
   * config is the only thing that can tell "removed" from "refused".
   */
  private verifyRemoved(
    result: McpInstallResult,
    serverKey: string,
    workspaceRoot: string | undefined,
  ): McpInstallResult {
    if (!result.success) return result;

    const facet = this.facets.get(result.target);
    if (facet === undefined) return result;

    let stillPresent = false;
    try {
      stillPresent = facet.readAll(workspaceRoot ?? '').has(serverKey);
    } catch {
      // `readAll` promises never to throw; if it somehow does, the honest
      // answer is the reconciler's, not a fabricated failure.
      return result;
    }
    if (!stillPresent) return result;

    return {
      ...result,
      success: false,
      error:
        `"${serverKey}" is still declared in ${result.configPath}: that entry ` +
        'is user-owned, not managed by Ptah, so the reconciler left it alone. ' +
        'Removing it needs an explicit confirmation.',
    };
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

/** Why a `~/.claude.json` row has no removal path here, and what does. */
function claudeUserRemovalReason(
  serverKey: string,
  scope: ClaudeUserMcpScope,
  configPath: string,
): string {
  const flag = scope === 'user' ? ' --scope user' : '';
  return (
    `"${serverKey}" is declared in ${configPath}, which belongs to the Claude ` +
    `CLI — Ptah reads it and never writes it. Remove it with ` +
    `\`claude mcp remove ${serverKey}${flag}\`.`
  );
}

/**
 * The non-secret endpoint to SHOW for a Smithery record.
 *
 * A Connections-API record is reached through the one namespace endpoint; a
 * legacy record keeps its per-server URL, and the base of it is the part with
 * no credentials in it. Neither spelling carries the API key or the per-server
 * config — both of those live in the encrypted store.
 */
function smitheryDisplayConfig(
  record: SmitheryInstalledRecord,
): McpServerConfig {
  const url =
    record.namespace === undefined
      ? `${SMITHERY_DEFAULT_CONNECTION_HOST}/${record.qualifiedName}/mcp`
      : buildSmitheryNamespaceUrl(record.namespace);
  return { type: 'http', url };
}
