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
 * (`serverKey`, `origin`, `configPath`, `scope`) and NOT by key alone: the same key
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
  type McpSourceStatus,
} from '@ptah-extension/harness-sync';
import {
  classifyMcpScope,
  type HarnessTargetHealth,
  type InstalledMcpServer,
  type McpInstallResult,
  type McpInstallTarget,
  type McpOAuthConnectedRecord,
  type McpServerConfig,
  type McpServerOrigin,
  type SmitheryInstalledRecord,
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

/** How reading one harness MCP config file went. */
export interface McpDeclarationSourceStatus {
  target: McpInstallTarget;
  /** Absolute path of the config file. */
  path: string;
  status: McpSourceStatus;
  /** Why the read failed. Present only when `status` is `error`. */
  error?: string;
}

/** The result of {@link McpInstallService.listDeclarations}. */
export interface McpDeclarationInventory {
  /** Every declaration from every source, each with its `scope` set. */
  declarations: InstalledMcpServer[];
  /** One entry per resolvable harness config file. */
  sourceStatus: McpDeclarationSourceStatus[];
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
   * each row flagged with where it came from, which scope declared it and how
   * it can be removed.
   *
   * A display list: a config file that cannot be read contributes no rows
   * here. The capability resolver reads the same inventory through
   * {@link listDeclarations}, where that failure is reported instead.
   */
  async listInstalled(workspaceRoot?: string): Promise<InstalledMcpServer[]> {
    const { declarations } = await this.listDeclarations(workspaceRoot);

    // Identity is (origin, configPath, serverKey, scope). NOT the key alone:
    // one server installed to five targets is five real rows in five real
    // files, and that is exactly how the Installed tab groups them today.
    const seen = new Set<string>();
    const deduped: InstalledMcpServer[] = [];
    for (const row of declarations) {
      const identity = JSON.stringify([
        row.origin,
        row.configPath,
        row.serverKey,
        row.scope,
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      deduped.push(row);
    }
    return deduped;
  }

  /**
   * The ONE declaration inventory (TASK_2026_560, C4): every row from the four
   * sources with its `scope`, plus the read status of every harness config
   * file.
   *
   * Both `listInstalled` and the capability resolver read it, so the
   * Installed tab and the session policy can never disagree about what is
   * declared. The harness files are read through the facets' status-bearing
   * `inspect`, so a file that exists but cannot be read is `error` in
   * `sourceStatus` rather than silently "declares nothing"; the resolver turns
   * that into an unverified policy. Never rejects.
   */
  async listDeclarations(
    workspaceRoot?: string,
  ): Promise<McpDeclarationInventory> {
    const harness = await this.harnessConfigRows(workspaceRoot);
    const declarations = [
      ...harness.rows,
      ...this.claudeUserRows(workspaceRoot),
      ...this.smitheryRows(),
      ...this.oauthRows(),
    ].map((row) => ({
      ...row,
      scope: classifyMcpScope({
        origin: row.origin,
        ...(row.target === undefined ? {} : { target: row.target }),
      }),
    }));
    return { declarations, sourceStatus: harness.sourceStatus };
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

  /**
   * The reconciler-owned config files, read in parallel through `inspect`,
   * with each file's read status.
   */
  private async harnessConfigRows(workspaceRoot?: string): Promise<{
    rows: InstalledMcpServer[];
    sourceStatus: McpDeclarationSourceStatus[];
  }> {
    const root = workspaceRoot ?? '';
    const reads = await Promise.all(
      [...this.facets].map(async ([target, facet]) => ({
        target,
        configPath: facet.configPath(root),
        inspection: await facet.inspect(root),
      })),
    );

    const rows: InstalledMcpServer[] = [];
    const sourceStatus: McpDeclarationSourceStatus[] = [];
    for (const { target, configPath, inspection } of reads) {
      // No resolvable file (a workspace-scoped target with no workspace)
      // declares nothing, and that is a fact, not a failure.
      if (configPath === null) continue;
      sourceStatus.push({
        target,
        path: configPath,
        status: inspection.status,
        ...(inspection.error === undefined ? {} : { error: inspection.error }),
      });

      for (const [serverKey, config] of inspection.servers) {
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
    return { rows, sourceStatus };
  }

  /** `~/.claude.json`, user scope and this workspace's project scope. */
  private claudeUserRows(workspaceRoot?: string): InstalledMcpServer[] {
    return readClaudeUserMcpServers(
      workspaceRoot,
      this.options.homeDir === undefined
        ? {}
        : { homeDir: this.options.homeDir },
    ).map((entry) => {
      const fixCommand = claudeUserRemovalCommand(entry.serverKey, entry.scope);
      return {
        serverKey: entry.serverKey,
        configPath: entry.configPath,
        config: entry.config,
        managedByPtah: false,
        origin: 'claude-user' as const,
        originLabel: ORIGIN_LABELS['claude-user'],
        // Read-only by design: this file belongs to the `claude` CLI and
        // carries far more than MCP servers, so Ptah never writes it.
        removal: 'none' as const,
        removalBlockedReason: claudeUserRemovalReason(
          entry.serverKey,
          entry.scope,
          entry.configPath,
        ),
        // Absent, not empty, when the key cannot be written safely: the UI
        // then shows the reason with no copy button.
        ...(fixCommand === null ? {} : { removalFixCommand: fixCommand }),
      };
    });
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

/**
 * The `claude mcp remove` scope flag for a `~/.claude.json` entry. One place,
 * so the prose reason and the copyable command cannot disagree about scope.
 */
function claudeUserScopeFlag(scope: ClaudeUserMcpScope): string {
  return scope === 'user' ? ' --scope user' : '';
}

/** Why a `~/.claude.json` row has no removal path here, and what does. */
function claudeUserRemovalReason(
  serverKey: string,
  scope: ClaudeUserMcpScope,
  configPath: string,
): string {
  return (
    `"${serverKey}" is declared in ${configPath}, which belongs to the Claude ` +
    `CLI — Ptah reads it and never writes it. Remove it with ` +
    `\`claude mcp remove ${serverKey}${claudeUserScopeFlag(scope)}\`.`
  );
}

/**
 * The copyable command that removes a `~/.claude.json` entry, or `null` when
 * the key cannot be put on a command line safely.
 */
function claudeUserRemovalCommand(
  serverKey: string,
  scope: ClaudeUserMcpScope,
): string | null {
  const arg = shellSafeArgument(serverKey);
  return arg === null
    ? null
    : `claude mcp remove ${arg}${claudeUserScopeFlag(scope)}`;
}

/** Characters that need no quoting in bash, zsh, PowerShell or cmd. */
const SHELL_BARE_ARGUMENT = /^[A-Za-z0-9_][A-Za-z0-9_./:+=-]*$/;

/**
 * Characters double quotes do NOT neutralise in at least one shell the user
 * may paste into: `"` ends the quote everywhere; `$` and `` ` `` expand inside
 * double quotes in bash, zsh and PowerShell; `\` escapes in bash and zsh; `!`
 * is history expansion in interactive bash; `%` expands `%VAR%` in cmd.
 */
const SHELL_UNQUOTABLE_PRINTABLE = new Set(['"', '$', '`', '\\', '!', '%']);

/**
 * Whether double quotes cannot make `value` safe. Besides the printable set
 * above, C0 and C1 control characters (newline, tab, escape…) and the Unicode
 * line and paragraph separators would split the pasted line, trigger shell
 * completion or hide what is actually being run.
 */
function hasUnquotableCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true;
    if (SHELL_UNQUOTABLE_PRINTABLE.has(char)) return true;
  }
  return false;
}

/**
 * A server key as one shell argument that means the same thing in every shell
 * the user is likely to paste it into, or `null` when no such spelling exists.
 *
 * Keys come from JSON object keys in a file another tool writes, so they can
 * hold anything. A plain key is passed bare; whitespace or any other shell
 * metacharacter (`;`, `&`, `|`, `<`, `(`, `*`, `#`, `~`, `,`, `@`…) is wrapped
 * in double quotes, inside which all of those are literal. A key double quotes
 * cannot protect gets no command at all, because a copy button that pastes
 * something other than what it shows is worse than no button. So does a key
 * starting with `-`: quoting does not stop `claude` reading it as an option.
 */
function shellSafeArgument(value: string): string | null {
  if (value === '' || value.startsWith('-')) return null;
  if (SHELL_BARE_ARGUMENT.test(value)) return value;
  if (hasUnquotableCharacter(value)) return null;
  return `"${value}"`;
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
