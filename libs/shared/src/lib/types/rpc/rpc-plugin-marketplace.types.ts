/**
 * Wire contract for EXTERNAL plugin marketplaces.
 *
 * An external marketplace is any GitHub repository that exposes
 * `.claude-plugin/marketplace.json` — the convention `dotnet/skills` and Ptah's
 * own plugin repo already follow. Registering one lets the user browse and
 * install its plugins into `~/.ptah/plugins/external/<owner>/<repo>/<plugin>/`.
 *
 * SECURITY MODEL (do not weaken any of these without a matching spec change):
 *
 * 1. Installing is a TWO-CALL protocol. `plugins:install-external` with no
 *    `consentToken` never writes anything — it returns an
 *    {@link ExternalInstallPlan} describing exactly what would land on disk.
 *    The second call must echo the plan's `consentToken` back. The token is
 *    derived from the plugin id, its resolved version and the exact file list,
 *    so a plan the user never saw cannot be consented to, and a plan for a
 *    DIFFERENT version of the same plugin will not validate.
 * 2. Declared `mcpServers` are shown verbatim in the plan and are NEVER
 *    registered by the install. Consent to install is not consent to run.
 * 3. Installing records the plugin id in a persisted store. That store — not
 *    the presence of a directory on disk — is what makes an external id
 *    resolvable by `PluginLoaderService`. A directory that appears under
 *    `external/` without a store entry stays unresolvable.
 */

/** An MCP server a plugin declares, rendered for the consent dialog. */
export interface ExternalPluginMcpServer {
  /** Server key from the manifest, e.g. `binlog`. */
  name: string;
  /** Executable, verbatim from the manifest, e.g. `dotnet`. */
  command: string;
  /** Arguments, verbatim from the manifest. */
  args: string[];
  /** Environment variables the manifest sets, verbatim. */
  env?: Record<string, string>;
  /**
   * `command` + `args` joined for display — the full command line exactly as
   * it would run, e.g.
   * `dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease`.
   * The consent dialog renders THIS string; it must never be abbreviated.
   */
  commandLine: string;
}

/** A marketplace the user has registered. */
export interface ExternalMarketplace {
  /** `owner/repo` slug. The canonical identity of a marketplace. */
  source: string;
  /** `name` from the manifest, e.g. `dotnet-agent-skills`. */
  name: string;
  /** `owner` from the manifest, normalized to a display string. */
  owner?: string;
  /** How many plugins the manifest advertised at last successful fetch. */
  pluginCount: number;
  /** ISO timestamp the user registered it. */
  addedAt: string;
  /** ISO timestamp of the last successful manifest fetch, when there was one. */
  lastFetchedAt?: string;
  /**
   * True for marketplaces Ptah ships as a suggestion (see
   * {@link SUGGESTED_MARKETPLACES}). Suggested entries are still not registered
   * until the user adds them.
   */
  suggested?: boolean;
}

/** One plugin advertised by a marketplace manifest. */
export interface ExternalPluginListing {
  /** Ptah plugin id: `external:<owner>/<repo>/<plugin>`. */
  id: string;
  /** `name` from the manifest entry. */
  name: string;
  /** `description` from the manifest entry, or an empty string. */
  description: string;
  /** `owner/repo` of the marketplace advertising it. */
  source: string;
  /** Repo-relative subtree, normalized from the manifest `source` field. */
  path: string;
  /** Version the marketplace advertises, when it declares one. */
  version?: string;
  /** True when this id has a consent record in the installed store. */
  installed: boolean;
  /** Version recorded at install time, when installed. */
  installedVersion?: string;
}

/** Result of `plugins:browse-marketplace`. */
export interface ExternalMarketplaceBrowseResult {
  marketplace: ExternalMarketplace;
  plugins: ExternalPluginListing[];
  /** True when the manifest came from the in-memory TTL cache. */
  fromCache: boolean;
}

/** A skill this install would introduce that an existing skill already shadows. */
export interface ExternalSkillCollision {
  /** Skill directory name, e.g. `run-tests`. */
  skillName: string;
  /** Plugin id whose skill of that name is already junctioned and wins. */
  shadowedBy: string;
}

/**
 * Everything the consent dialog must show before a single byte is written.
 *
 * Produced by `plugins:install-external` when called WITHOUT a consent token.
 * Nothing in producing a plan touches the filesystem.
 */
export interface ExternalInstallPlan {
  /** Ptah plugin id the install would create. */
  pluginId: string;
  /** `owner/repo` of the marketplace. */
  source: string;
  /** Manifest plugin name. */
  plugin: string;
  /** Human-readable plugin name from `plugin.json`, falling back to `plugin`. */
  displayName: string;
  /** Resolved version, or `'unknown'` when the plugin declares none. */
  version: string;
  /** Version already installed, when this is a re-install / upgrade. */
  installedVersion?: string;
  /** Skill directory names found under the plugin's `skills/`. */
  skills: string[];
  /** Number of files the install would write. */
  fileCount: number;
  /** Total bytes the install would write. */
  totalBytes: number;
  /**
   * Files under a `scripts/` directory anywhere in the subtree — the
   * executable surface. Empty means the plugin ships no scripts.
   */
  scriptFiles: string[];
  /**
   * Files that will NOT be written because their bytes are not valid UTF-8
   * text. Ptah refuses binary plugin payloads rather than guessing; see
   * `ExternalPluginInstallerService` for the rationale.
   */
  skippedBinaryFiles: string[];
  /** MCP servers declared by the plugin. Shown, never registered. */
  mcpServers: ExternalPluginMcpServer[];
  /** Skills this plugin ships that an already-active skill would shadow. */
  collisions: ExternalSkillCollision[];
  /**
   * Opaque token bound to `pluginId`, `version` and the exact file list.
   * Echo it back in the second call to authorize the write. A token minted for
   * a different version of the same plugin will not validate — which is what
   * makes consent re-required on every version change.
   */
  consentToken: string;
}

/** Outcome of an authorized `plugins:install-external` call. */
export interface ExternalInstallResult {
  pluginId: string;
  displayName: string;
  installedVersion: string;
  filesWritten: number;
  /** Files refused as non-text. Repeated from the plan so the UI can report. */
  skippedBinaryFiles: string[];
  /** Skills that landed shadowed by an already-active skill of the same name. */
  collisions: ExternalSkillCollision[];
  /**
   * Keys of the declared MCP servers whose install intent was recorded.
   *
   * The consent dialog listed these servers before a byte was written, so
   * installing them at confirm is inside what the user approved — but until
   * TASK_2026_287 nothing installed them at all, and the dialog's promise was
   * simply untrue. Optional so existing consumers compile unchanged.
   */
  mcpServersInstalled?: string[];
  /**
   * Why a declared MCP server did not fully land: a key an unowned server
   * already occupies (never overwritten — see `ExternalPluginMcpService`), a
   * per-target write failure, or a declaration the schema rejected.
   *
   * These are advisory. The plugin itself installed; only some of its servers
   * did not.
   */
  mcpWarnings?: string[];
}

/**
 * Response of `plugins:install-external`.
 *
 * Discriminated so the caller cannot mistake "here is what I would do" for
 * "I did it".
 */
export type ExternalInstallResponse =
  | {
      status: 'consent-required';
      plan: ExternalInstallPlan;
      /** Why approval is being asked for. Lets the dialog explain itself. */
      reason: ExternalConsentReason;
    }
  | { status: 'installed'; result: ExternalInstallResult };

/**
 * Why the backend is asking for consent.
 *
 * - `not-yet-approved`: the ordinary first call, made without a token.
 * - `approval-expired`: a token WAS presented and did not validate — the plan
 *   timed out, the host restarted, or upstream changed and the payload no
 *   longer hashes to the approved one. The response carries a freshly built
 *   plan, so the dialog re-opens on current facts instead of erroring.
 */
export type ExternalConsentReason = 'not-yet-approved' | 'approval-expired';

/** Params for `plugins:install-external`. */
export interface ExternalInstallParams {
  /** `owner/repo` of a REGISTERED marketplace. */
  source: string;
  /** Manifest plugin name. */
  plugin: string;
  /**
   * Consent token from a previously returned plan. Omit to request a plan.
   * Present and valid ⇒ the install proceeds.
   */
  consentToken?: string;
}

/** Params for `plugins:uninstall-external`. */
export interface ExternalUninstallParams {
  /** Ptah plugin id (`external:<owner>/<repo>/<plugin>`). */
  pluginId: string;
}

/** Result of `plugins:uninstall-external`. */
export interface ExternalUninstallResult {
  pluginId: string;
  /**
   * True when the plugin was actually removed — BOTH its directory and its
   * consent record. Uninstall deletes the tree first and drops the record
   * last, so a `true` here means nothing is left on disk and the id is no
   * longer resolvable. `false` means there was no consent record to begin
   * with, and nothing was touched.
   */
  removed: boolean;
  /**
   * Keys of the plugin's declared MCP servers whose install intent was dropped.
   *
   * Read from the consent record BEFORE it is deleted — afterwards nothing
   * records which keys were this plugin's, and its servers would sit in every
   * MCP config file forever. Optional so existing consumers compile unchanged.
   */
  mcpServersRemoved?: string[];
  /** Why a server could not be fully removed. Advisory, like the install side. */
  mcpWarnings?: string[];
}

/** Params for `plugins:add-marketplace` / `plugins:remove-marketplace`. */
export interface MarketplaceSourceParams {
  /** `owner/repo` slug. */
  source: string;
}

/** Params for `plugins:browse-marketplace`. */
export interface MarketplaceBrowseParams {
  /** `owner/repo` slug. */
  source: string;
  /**
   * Bypass the manifest TTL cache. Set by an explicit user Retry/Refresh, so
   * that action can actually change the answer; leave unset for ordinary
   * browsing, which should not spend a fetch per click.
   */
  refresh?: boolean;
}

/** Result of `plugins:list-marketplaces`. */
export interface ListMarketplacesResult {
  /** Marketplaces the user has registered. */
  marketplaces: ExternalMarketplace[];
  /** Known-good marketplaces Ptah suggests but has NOT registered. */
  suggestions: SuggestedMarketplace[];
  /**
   * Every external plugin with a consent record, regardless of whether its
   * marketplace is still registered.
   *
   * Deregistering a marketplace deliberately does NOT uninstall its plugins.
   * Without this list those plugins would stay installed, resolvable and
   * completely invisible — the user would have no surface left to remove
   * something that is still running. So installed state is reported flat, not
   * only per-marketplace.
   */
  installed: ExternalPluginListing[];
}

/** A marketplace Ptah recommends out of the box. */
export interface SuggestedMarketplace {
  /** `owner/repo` slug. */
  source: string;
  /** Display name. */
  name: string;
  /** Why Ptah suggests it. */
  description: string;
}

/**
 * Marketplaces Ptah offers as one-click suggestions.
 *
 * A suggestion is a starting point in the UI, nothing more: it carries no
 * privilege, and adding one runs the exact same fetch + Zod validation as a
 * hand-typed `owner/repo`.
 */
export const SUGGESTED_MARKETPLACES: readonly SuggestedMarketplace[] = [
  {
    source: 'dotnet/skills',
    name: '.NET Agent Skills',
    description:
      'Microsoft-maintained agent skills for .NET — build, test, data, MSBuild, NuGet, ASP.NET Core, Blazor, MAUI, diagnostics and upgrades. MIT licensed.',
  },
] as const;
