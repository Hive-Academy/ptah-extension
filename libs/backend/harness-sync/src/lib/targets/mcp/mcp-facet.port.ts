/**
 * The MCP half of a target.
 *
 * Every AI tool Ptah populates reads MCP servers from its own config file, in
 * its own dialect, at its own scope — `{ws}/.mcp.json`, `{ws}/.cursor/mcp.json`,
 * `{ws}/.vscode/mcp.json`, `~/.copilot/mcp-config.json`, `~/.codex/config.toml`.
 * A facet is the narrow adapter for exactly one of those files, and the target
 * that owns it is the thing that knows the file exists.
 *
 * The split matters because MCP entries break two assumptions the skill and
 * command paths rest on:
 *
 * 1. **An entry is not a path.** Five servers share one config file. So a
 *    manifest key is `<configRelPath>#<serverKey>` — a FRAGMENT key — and the
 *    reconciler must not `stat` it (see {@link isMcpFragmentKey}).
 * 2. **Two of the files live outside the workspace.** Copilot and Codex read
 *    user-global configs. Ptah still records ownership in the per-workspace
 *    manifest, because the intent that produced the entry is per-workspace and
 *    the desired state is global — every workspace agrees on the same set, so
 *    the two never fight.
 *
 * The user's OTHER servers in those files are never in the desired state, are
 * never manifest-owned, and are therefore never touched (E18).
 */

import type {
  HarnessTargetId,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';

/**
 * True when a manifest key addresses an entry INSIDE a config file rather than
 * a file or directory of its own.
 *
 * The reconciler's preflight checks that every owned path still exists on disk.
 * Applied to `.mcp.json#github` that check would fail forever, because no such
 * path exists — the fragment is a key in a JSON object. Preflight therefore
 * compares hashes for these keys and leaves existence to the full pass.
 */
export function isMcpFragmentKey(relPath: string): boolean {
  return relPath.includes('#');
}

/** Build the manifest key for one server inside one config file. */
export function mcpEntryKey(configRelPath: string, serverKey: string): string {
  return `${configRelPath}#${serverKey}`;
}

export interface IHarnessMcpFacet {
  /** The harness target this facet belongs to. */
  readonly target: HarnessTargetId;

  /**
   * The public `McpInstallTarget` id the marketplace and `ptah mcp` speak.
   *
   * Identical to {@link target} for every facet today. Kept as a separate field
   * because the two unions have different reasons to change: one tracks harness
   * surfaces, the other tracks what the install RPC offers.
   */
  readonly mcpTarget: McpInstallTarget;

  /**
   * Manifest-key prefix for this config file, e.g. `.mcp.json` or
   * `~/.codex/config.toml`. A leading `~/` means user-global; such a key is
   * still recorded in the workspace manifest (see the file header).
   */
  configRelPath(): string;

  /** Absolute path of the config file, or `null` when it cannot be resolved. */
  configPath(workspaceRoot: string): string | null;

  /**
   * Every server currently declared in the config file, Ptah's and the user's
   * alike. Must never throw — a missing or malformed file reads as empty.
   */
  readAll(workspaceRoot: string): Map<string, McpServerConfig>;

  /** Create or replace one server entry, leaving every other byte alone. */
  write(
    workspaceRoot: string,
    serverKey: string,
    config: McpServerConfig,
  ): Promise<void>;

  /** Remove one server entry. A no-op when it is already absent. */
  remove(workspaceRoot: string, serverKey: string): Promise<void>;
}
