/**
 * Installing (and uninstalling) the MCP servers an external marketplace plugin
 * DECLARES.
 *
 * The defect this closes: `MarketplaceManifestSchema` has accepted `mcpServers`
 * since the marketplace shipped, the installer renders them in the consent
 * dialog and persists them in the consent record — and nothing ever installed
 * them. The user was told "this plugin will install these MCP servers", said
 * yes, and not one byte reached `.mcp.json`, `~/.codex/config.toml`,
 * `~/.copilot/mcp-config.json`, `.cursor/mcp.json` or
 * `~/.gemini/config/mcp_config.json`. No intent was recorded, so the reconciler
 * never saw them.
 *
 * ## Why this lives in `rpc-handlers` and not in `plugin-marketplace`
 *
 * `McpInstallService` lives in `cli-agent-runtime`, and `plugin-marketplace`
 * depends on neither it nor `harness-sync` — its whole dependency set is
 * `shared` + `vscode-core`. Adding that edge to buy one call would put the
 * consent flow downstream of the CLI runtime. `PluginRpcHandlers` already sits
 * downstream of both and already reconciles the harness after an install, so
 * the seam was already here.
 *
 * ## The write path is the existing one, unchanged
 *
 * RECORD INTENT, then RECONCILE — the same two steps `mcp:install` takes.
 * Intent first is not a style choice: the reconciler's desired state IS
 * `~/.ptah/mcp-installed.json`, so reconciling before recording makes the pass
 * a no-op (`mcp-install.service.ts`). Everything downstream — ownership, the
 * per-target facets, the atomic writes, the locks — is the reconciler's, and
 * nothing here writes a config file.
 *
 * ## Collisions are REPORTED here and REFUSED there
 *
 * A `serverKey` an unowned server already occupies must not be overwritten.
 * That rule already exists and already holds: the target classifies the key as
 * `foreign`/`blocked` and leaves the user's entry exactly as it is. What was
 * missing is that nobody TOLD the user. So this service probes the config files
 * before recording anything and turns each occupied key into a warning on the
 * install result.
 *
 * The probe answers "should I warn", never "should I write". Re-deciding
 * ownership here would be a second copy of a rule that must have exactly one.
 */

import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IHarnessCliDetector } from '@ptah-extension/harness-sync';
import type {
  ExternalPluginMcpServer,
  InstalledMcpServer,
  McpInstallResult,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';

/**
 * The slice of `McpInstallService` this service uses.
 *
 * A structural port rather than the concrete class so the service is
 * constructible — and therefore testable — without a container and without
 * `McpIntentStore`'s default path, which is the developer's real
 * `~/.ptah/mcp-installed.json`. `McpInstallService` satisfies it as-is.
 */
export interface ExternalMcpInstaller {
  install(
    serverName: string,
    serverKey: string,
    config: McpServerConfig,
    targets: McpInstallTarget[],
    workspaceRoot?: string,
  ): Promise<McpInstallResult[]>;
  uninstall(
    serverKey: string,
    targets?: McpInstallTarget[],
    workspaceRoot?: string,
  ): Promise<McpInstallResult[]>;
  listInstalled(workspaceRoot?: string): Promise<InstalledMcpServer[]>;
}

/**
 * Optional container override for {@link ExternalPluginMcpService}.
 *
 * Unregistered in every shipping host — `PluginRpcHandlers` builds the service
 * from the reconciler and the CLI detector it can already resolve, so no host
 * has to remember a registration line. A host (or a spec) that registers this
 * token gets its instance used instead, which is the only way to substitute the
 * installer: `McpInstallService`'s default `McpIntentStore` points at the real
 * `~/.ptah/mcp-installed.json`, and no spec may write there.
 */
export const EXTERNAL_PLUGIN_MCP_TOKEN = Symbol.for('ExternalPluginMcpService');

/** What one install or uninstall sweep did, and what the user should know. */
export interface ExternalMcpOutcome {
  /** Server keys whose intent was recorded (install) or dropped (uninstall). */
  serverKeys: string[];
  /** Collisions, per-target failures and skipped declarations. */
  warnings: string[];
}

/**
 * Targets every install reaches regardless of what is installed on the machine.
 *
 * Not a policy choice — it mirrors the two targets the reconciler itself never
 * gates: `ClaudeTarget.detect()` is unconditionally `true` (Claude Code reads
 * `{ws}/.claude` in any workspace, and the SDK adapter, `ptah tui` and the
 * gateway all rely on `.mcp.json`), and the VS Code target hardcodes
 * `isInstalled: () => true` because VS Code is the host, not a binary to probe.
 */
const ALWAYS_INSTALLED_TARGETS: readonly McpInstallTarget[] = [
  'claude',
  'vscode',
];

/** Targets that only make sense when the CLI is actually on this machine. */
const DETECTED_TARGETS: readonly McpInstallTarget[] = [
  'codex',
  'copilot',
  'cursor',
  'antigravity',
];

/**
 * The consent record is a FILE, and a file another process can edit, so its
 * MCP entries are re-validated here rather than trusted because they were valid
 * when written. Mirrors `McpServerSchema` in `marketplace-manifest.schema.ts`:
 * a declaration that would not pass the manifest gate must not pass this one.
 */
const DeclaredMcpServerSchema = z.object({
  name: z.string().min(1).max(128),
  command: z.string().min(1).max(512),
  args: z.array(z.string().max(512)).max(64).optional(),
  env: z.record(z.string(), z.string().max(2048)).optional(),
});

type DeclaredMcpServer = z.infer<typeof DeclaredMcpServerSchema>;

export class ExternalPluginMcpService {
  constructor(
    private readonly logger: Logger,
    private readonly installer: ExternalMcpInstaller,
    private readonly detector: IHarnessCliDetector,
  ) {}

  /**
   * Record an intent for every server the plugin declared, then let the
   * reconciler write them.
   *
   * @param pluginId Carried into the intent store as the entry's registry name,
   *   so `~/.ptah/mcp-installed.json` says WHERE a server came from. Everything
   *   else in that file is a directory install named after a registry.
   */
  async install(
    pluginId: string,
    servers: readonly ExternalPluginMcpServer[],
    workspaceRoot: string | undefined,
  ): Promise<ExternalMcpOutcome> {
    const outcome: ExternalMcpOutcome = { serverKeys: [], warnings: [] };
    const declared = this.validate(servers, outcome.warnings);
    if (declared.length === 0) return outcome;

    if (workspaceRoot === undefined || workspaceRoot === '') {
      outcome.warnings.push(
        'No workspace folder is open, so this plugin’s MCP servers were not installed. Open the folder and reinstall the plugin.',
      );
      return outcome;
    }

    // BEFORE any intent is recorded: recording flips `managedByPtah` to true
    // for the very key we are asking about, which would hide the collision.
    const occupied = await this.findOccupiedKeys(declared, workspaceRoot);
    const targets = await this.resolveTargets();

    for (const server of declared) {
      const conflicts = occupied.get(server.name);
      if (conflicts !== undefined && conflicts.length > 0) {
        outcome.warnings.push(
          `MCP server "${server.name}" is already defined by you in ${conflicts.join(', ')}. Ptah never overwrites an entry it does not own, so your version stays. Rename or remove it if you want the plugin’s server instead.`,
        );
      }

      try {
        const results = await this.installer.install(
          pluginId,
          server.name,
          toServerConfig(server),
          [...targets],
          workspaceRoot,
        );
        outcome.serverKeys.push(server.name);
        this.collectFailures(server.name, results, outcome.warnings);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        outcome.warnings.push(
          `MCP server "${server.name}" could not be installed: ${message}`,
        );
        this.logger.warn('External plugin MCP install failed', {
          pluginId,
          serverKey: server.name,
          error: message,
        });
      }
    }

    return outcome;
  }

  /**
   * Drop the intent for every server the plugin declared, so its servers do not
   * outlive it.
   *
   * Called with the servers read from the consent record BEFORE the record is
   * deleted — after that there is nothing left to say which keys were the
   * plugin's, and its entries would sit in every config file forever.
   *
   * Runs even with no workspace open. The intent store is user-global, so
   * forgetting always lands; only the config-file rewrite needs a workspace,
   * and the next reconcile in any workspace performs it.
   */
  async uninstall(
    pluginId: string,
    servers: readonly ExternalPluginMcpServer[],
    workspaceRoot: string | undefined,
  ): Promise<ExternalMcpOutcome> {
    const outcome: ExternalMcpOutcome = { serverKeys: [], warnings: [] };
    const declared = this.validate(servers, outcome.warnings);

    for (const server of declared) {
      try {
        const results = await this.installer.uninstall(
          server.name,
          undefined,
          workspaceRoot,
        );
        outcome.serverKeys.push(server.name);
        if (workspaceRoot !== undefined && workspaceRoot !== '') {
          this.collectFailures(server.name, results, outcome.warnings);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        outcome.warnings.push(
          `MCP server "${server.name}" could not be removed: ${message}`,
        );
        this.logger.warn('External plugin MCP uninstall failed', {
          pluginId,
          serverKey: server.name,
          error: message,
        });
      }
    }

    return outcome;
  }

  /**
   * `claude` + `vscode` + whichever rival CLIs are actually installed.
   *
   * Deliberately NOT `HARNESS_DEFAULT_MCP_TARGETS` (`['claude','vscode']`).
   * That default exists for the harness BUILDER, where an AI-designed preset
   * names servers with no knowledge of the machine it will land on and two
   * universally-writable surfaces are the honest floor. Here the install is a
   * real user action on a real machine, and the same detector the reconciler
   * uses is already injected — so a user whose day job is Codex or Cursor gets
   * the plugin's servers in the tool they actually use, instead of only in the
   * two files Ptah can always write.
   *
   * It is also not "all six": an undetected target is skipped by the reconciler
   * anyway, so asking for one would make `McpInstallService` report a cheerful
   * success for a file it never touched.
   */
  private async resolveTargets(): Promise<readonly McpInstallTarget[]> {
    const detected: McpInstallTarget[] = [];
    for (const target of DETECTED_TARGETS) {
      try {
        if (await this.detector.isInstalled(target)) detected.push(target);
      } catch (error: unknown) {
        // A detector that throws means "unknown", which is not "installed".
        this.logger.debug('CLI detection failed while resolving MCP targets', {
          target,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return [...ALWAYS_INSTALLED_TARGETS, ...detected];
  }

  /**
   * Config files that already carry one of these keys under an entry Ptah does
   * not manage — keyed by server key, valued by config path.
   *
   * `managedByPtah` is "an intent exists for this key", which is exactly the
   * question: with no intent, whatever is in the file is the user's, and the
   * target will refuse to touch it.
   */
  private async findOccupiedKeys(
    declared: readonly DeclaredMcpServer[],
    workspaceRoot: string,
  ): Promise<Map<string, string[]>> {
    const occupied = new Map<string, string[]>();
    const wanted = new Set(declared.map((server) => server.name));

    let installed: InstalledMcpServer[];
    try {
      installed = await this.installer.listInstalled(workspaceRoot);
    } catch (error: unknown) {
      // A probe that fails costs a warning nobody sees; it must never cost the
      // install itself, which the reconciler will handle correctly regardless.
      this.logger.debug('Could not probe MCP configs for key collisions', {
        error: error instanceof Error ? error.message : String(error),
      });
      return occupied;
    }

    for (const entry of installed) {
      if (entry.managedByPtah) continue;
      if (!wanted.has(entry.serverKey)) continue;
      const paths = occupied.get(entry.serverKey) ?? [];
      if (!paths.includes(entry.configPath)) paths.push(entry.configPath);
      occupied.set(entry.serverKey, paths);
    }
    return occupied;
  }

  /** Zod at the record boundary; a malformed declaration is skipped, not thrown. */
  private validate(
    servers: readonly ExternalPluginMcpServer[],
    warnings: string[],
  ): DeclaredMcpServer[] {
    const declared: DeclaredMcpServer[] = [];
    for (const server of servers) {
      const parsed = DeclaredMcpServerSchema.safeParse(server);
      if (!parsed.success) {
        warnings.push(
          `A declared MCP server was skipped because its definition is not usable: ${parsed.error.issues[0]?.message ?? 'invalid definition'}.`,
        );
        continue;
      }
      declared.push(parsed.data);
    }
    return declared;
  }

  /** Per-target failures for ONE key, phrased for a user reading a dialog. */
  private collectFailures(
    serverKey: string,
    results: readonly McpInstallResult[],
    warnings: string[],
  ): void {
    for (const result of results) {
      if (result.success) continue;
      warnings.push(
        `MCP server "${serverKey}" could not be written to ${result.target}: ${result.error ?? 'unknown error'}`,
      );
    }
  }
}

/**
 * A marketplace declaration is always a stdio server — the manifest schema has
 * `command`/`args`/`env` and no URL form, because a plugin describes a process
 * it ships instructions for, not a remote endpoint.
 */
function toServerConfig(server: DeclaredMcpServer): McpServerConfig {
  return {
    type: 'stdio',
    command: server.command,
    args: server.args ?? [],
    ...(server.env === undefined ? {} : { env: server.env }),
  };
}
