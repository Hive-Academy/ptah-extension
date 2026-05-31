/**
 * MCP Server Directory Types
 *
 * Shared type definitions for MCP server discovery, installation, and management.
 * Provider: Official MCP Registry (registry.modelcontextprotocol.io)
 *
 * Design: Pure TypeScript types, no runtime dependencies (shared library boundary).
 */

/**
 * Targets where MCP server configs can be installed.
 *
 * Config file locations:
 *  - vscode:  .vscode/mcp.json           (workspace, root key: "servers")
 *  - claude:  .mcp.json                   (workspace, root key: "mcpServers") — shared with codex/ptah-cli
 *  - cursor:  .cursor/mcp.json            (workspace, root key: "mcpServers")
 *  - gemini:  ~/.gemini/settings.json     (user-global, root key: "mcpServers")
 *  - copilot: ~/.copilot/mcp-config.json  (user-global, root key: "mcpServers")
 */
export type McpInstallTarget =
  | 'vscode'
  | 'claude'
  | 'cursor'
  | 'gemini'
  | 'copilot';

/** Base fields shared by all transport types */
interface McpServerConfigBase {
  /** Optional environment variables required by the server */
  env?: Record<string, string>;
}

/** Local stdio-based MCP server (spawns a process) */
export interface McpStdioConfig extends McpServerConfigBase {
  type: 'stdio';
  /** Command to execute (e.g., "npx", "uvx", "docker", "node") */
  command: string;
  /** Command arguments */
  args?: string[];
}

/** Remote HTTP Streamable MCP server */
export interface McpHttpConfig extends McpServerConfigBase {
  type: 'http';
  /** HTTP endpoint URL */
  url: string;
  /** Optional HTTP headers (e.g., Authorization) */
  headers?: Record<string, string>;
}

/** Remote SSE-based MCP server (legacy, pre-Streamable HTTP) */
export interface McpSseConfig extends McpServerConfigBase {
  type: 'sse';
  /** SSE endpoint URL */
  url: string;
  /** Optional HTTP headers */
  headers?: Record<string, string>;
}

/** Discriminated union of all MCP server transport configs */
export type McpServerConfig = McpStdioConfig | McpHttpConfig | McpSseConfig;

/** Package deployment info from the registry */
export interface McpRegistryPackage {
  /** Package registry type (e.g., "npm", "pypi", "docker") */
  registry_name: string;
  /** Package name on that registry */
  name: string;
  /** Package version */
  version?: string;
  /** Runtime environment (e.g., "node", "python", "docker") */
  runtime?: string;
}

/** Transport info from the registry */
export interface McpRegistryTransport {
  /** Transport type: "stdio" | "http" | "sse" */
  type: string;
  /** For remote transports, the default URL template */
  url?: string;
}

/** Icon metadata from the registry */
export interface McpRegistryIcon {
  /** Icon URL */
  src: string;
  /** MIME type (e.g., "image/svg+xml") */
  mimeType?: string;
  /** Size hints (e.g., ["48x48", "any"]) */
  sizes?: string[];
}

/** Repository metadata from the registry */
export interface McpRegistryRepository {
  /** Repository URL */
  url: string;
  /** Source platform (e.g., "github") */
  source?: string;
  /** Repository identifier (e.g., "owner/repo") */
  id?: string;
}

/** A version detail from the registry */
export interface McpRegistryVersionDetail {
  /** Semantic version string */
  version: string;
  /** Release date ISO string */
  release_date?: string;
  /** Package deployment options */
  packages: McpRegistryPackage[];
  /** Supported transports */
  transports: McpRegistryTransport[];
}

/** Input argument that a server may require */
export interface McpRegistryArgument {
  /** Argument name (used as env var name typically) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Whether this argument is required */
  required?: boolean;
  /** Default value if not provided */
  default?: string;
}

/**
 * A single connection option carried on a registry entry detail.
 * Smithery-specific: carries a per-connection `configSchema` (JSON Schema)
 * describing the config that must be collected before a URL can be built.
 * The official registry has no equivalent and omits this field.
 */
export interface McpRegistryConnection {
  /** Transport type: "http" (Streamable HTTP) | "stdio". */
  type?: string;
  /** JSON Schema describing required per-server config (Smithery). */
  configSchema?: Record<string, unknown>;
  /** Hosted deployment URL template (Smithery), if present. */
  deploymentUrl?: string;
  /** Passthrough for any additional connection fields. */
  [key: string]: unknown;
}

/**
 * A single MCP server entry from an MCP registry source.
 * Maps to GET /v0.1/servers response items (official) and Smithery /servers.
 */
export interface McpRegistryEntry {
  /** Fully qualified server name (e.g., "io.github.user/server-name") */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Server icons */
  icons?: McpRegistryIcon[];
  /** Source code repository */
  repository?: McpRegistryRepository;
  /** Latest version detail (populated on detail fetch) */
  version_detail?: McpRegistryVersionDetail;
  /** Server creation timestamp */
  created_at?: string;
  /** Last update timestamp */
  updated_at?: string;
  /** Provenance of this entry (drives the UI source badge). */
  source?: McpRegistrySourceKind;
  /** Trust signal (Smithery `verified`). */
  verified?: boolean;
  /** Security scan signal (Smithery `security.scanPassed`). */
  scanPassed?: boolean;
  /** Connection options carried on detail fetch (Smithery configSchema). */
  connections?: McpRegistryConnection[];
}

/** Provenance discriminator for an MCP registry entry / query. */
export type McpRegistrySourceKind = 'official' | 'smithery';

/** Paginated list response from the registry */
export interface McpRegistryListResponse {
  /** Server entries for this page */
  servers: McpRegistryEntry[];
  /** Cursor for fetching the next page (undefined = last page) */
  next_cursor?: string;
  /** Response metadata */
  metadata?: {
    /** Total servers in registry (if provided) */
    total?: number;
  };
}

/** Result of installing an MCP server to a single target */
export interface McpInstallResult {
  /** Which target was written to */
  target: McpInstallTarget;
  /** Whether the install succeeded */
  success: boolean;
  /** Absolute path of the config file that was written */
  configPath: string;
  /** Error message if install failed */
  error?: string;
}

/** An MCP server that is currently installed (read from config files) */
export interface InstalledMcpServer {
  /** Server key as it appears in the config file (e.g., "github", "filesystem") */
  serverKey: string;
  /** Which target config this was read from */
  target: McpInstallTarget;
  /** Absolute path of the config file */
  configPath: string;
  /** The server's transport config */
  config: McpServerConfig;
  /** Whether this server was installed by Ptah (tracked in manifest) */
  managedByPtah: boolean;
}

/** Tracks which MCP servers Ptah has installed (persisted to ~/.ptah/mcp-installed.json) */
export interface McpInstallManifest {
  /** Schema version for forward compat */
  version: 1;
  /** Map of server name → install metadata */
  servers: Record<
    string,
    {
      /** Registry name of the server */
      registryName: string;
      /** Targets this server was installed to */
      targets: McpInstallTarget[];
      /** ISO timestamp of installation */
      installedAt: string;
      /** The config that was written */
      config: McpServerConfig;
    }
  >;
}

/**
 * A Smithery server installed by Ptah, persisted to
 * `~/.ptah/smithery-installed.json`.
 *
 * SECURITY: this record holds ONLY non-secret metadata. The per-server `config`
 * (which may contain credentials) is NEVER stored here — it lives in the
 * encrypted secret store and is rebuilt into a session-time URL at query time.
 * No secret-bearing connection URL is ever persisted to disk.
 */
export interface SmitheryInstalledRecord {
  /** Always 'smithery' — discriminates from official disk installs. */
  source: 'smithery';
  /** Fully qualified Smithery server name (e.g., "@owner/server"). */
  qualifiedName: string;
  /** Stable key used in the session `mcpServersOverride` map. */
  serverKey: string;
  /** Optional saved Smithery profile id (non-secret). */
  profile?: string;
  /**
   * Whether an encrypted per-server config blob exists in the secret store for
   * this record. The config values themselves are NOT in this manifest.
   */
  hasEncryptedConfig: boolean;
  /** ISO timestamp of installation. */
  installedAt: string;
}

/**
 * On-disk manifest of Smithery-installed servers
 * (`~/.ptah/smithery-installed.json`). Contains no secrets.
 */
export interface SmitheryInstalledManifest {
  /** Schema version for forward compat. */
  version: 1;
  /** Map of serverKey → install record. */
  servers: Record<string, SmitheryInstalledRecord>;
}

/**
 * Params for mcpDirectory:installSmithery.
 *
 * Records a Smithery install WITHOUT writing a secret-bearing URL to disk. The
 * `config` is routed to the encrypted secret store; only non-secret metadata is
 * persisted to the manifest.
 */
export interface McpDirectoryInstallSmitheryParams {
  /** Fully qualified Smithery server name (e.g., "@owner/server"). */
  qualifiedName: string;
  /** Stable key for the session override map (defaults to a slug of the name). */
  serverKey?: string;
  /** Per-server config collected from the connection configSchema form. */
  config: Record<string, unknown>;
  /** Optional saved Smithery profile id. */
  profile?: string;
}

/** Result for mcpDirectory:installSmithery. */
export interface McpDirectoryInstallSmitheryResult {
  success: boolean;
  /** The serverKey the record was stored under (echoed for the caller). */
  serverKey?: string;
  error?: string;
}

/** Params for mcpDirectory:uninstallSmithery. */
export interface McpDirectoryUninstallSmitheryParams {
  /** The serverKey of the record to remove. */
  serverKey: string;
}

/** Result for mcpDirectory:uninstallSmithery. */
export interface McpDirectoryUninstallSmitheryResult {
  success: boolean;
  error?: string;
}

/** Params for mcpDirectory:listSmitheryInstalled (no params needed). */
export type McpDirectoryListSmitheryInstalledParams = Record<string, never>;

/**
 * Result for mcpDirectory:listSmitheryInstalled.
 *
 * SECURITY: returns non-secret metadata only (never the config or URL).
 */
export interface McpDirectoryListSmitheryInstalledResult {
  servers: SmitheryInstalledRecord[];
}

/** Params for mcpDirectory:search */
export interface McpDirectorySearchParams {
  /** Search query string */
  query: string;
  /** Max results to return (default: 20) */
  limit?: number;
  /** Pagination cursor from previous response */
  cursor?: string;
  /** Registry source to query (default: 'official'). */
  source?: McpRegistrySourceKind;
}

/** Result for mcpDirectory:search */
export interface McpDirectorySearchResult {
  servers: McpRegistryEntry[];
  nextCursor?: string;
}

/** Params for mcpDirectory:getDetails */
export interface McpDirectoryGetDetailsParams {
  /** Fully qualified server name */
  name: string;
  /** Registry source to query (default: 'official'). */
  source?: McpRegistrySourceKind;
}

/** Result for mcpDirectory:getDetails */
export type McpDirectoryGetDetailsResult = McpRegistryEntry;

/** Params for mcpDirectory:install */
export interface McpDirectoryInstallParams {
  /** Server name (for manifest tracking) */
  serverName: string;
  /** Server key to use in config files (e.g., "github", "filesystem") */
  serverKey: string;
  /** Server transport configuration */
  config: McpServerConfig;
  /** Which targets to install to */
  targets: McpInstallTarget[];
}

/** Result for mcpDirectory:install */
export interface McpDirectoryInstallResult {
  results: McpInstallResult[];
}

/** Params for mcpDirectory:uninstall */
export interface McpDirectoryUninstallParams {
  /** Server key as it appears in config files */
  serverKey: string;
  /** Which targets to uninstall from (empty = all) */
  targets?: McpInstallTarget[];
}

/** Result for mcpDirectory:uninstall */
export interface McpDirectoryUninstallResult {
  results: McpInstallResult[];
}

/** Params for mcpDirectory:listInstalled (no params needed) */
export type McpDirectoryListInstalledParams = Record<string, never>;

/** Result for mcpDirectory:listInstalled */
export interface McpDirectoryListInstalledResult {
  servers: InstalledMcpServer[];
}

/** Params for mcpDirectory:getPopular */
export interface McpDirectoryGetPopularParams {
  /** Registry source to query (default: 'official'). */
  source?: McpRegistrySourceKind;
}

/** Result for mcpDirectory:getPopular */
export interface McpDirectoryGetPopularResult {
  servers: McpRegistryEntry[];
}

/**
 * Params for mcpDirectory:setSmitheryApiKey.
 *
 * SECURITY: the key travels webview → backend on write only. It is stored in
 * encrypted secret storage and is NEVER returned to the renderer. An empty /
 * whitespace-only value clears the stored key.
 */
export interface McpDirectorySetSmitheryApiKeyParams {
  /** The Smithery API key to store, or '' to clear it. */
  apiKey: string;
}

/** Result for mcpDirectory:setSmitheryApiKey */
export interface McpDirectorySetSmitheryApiKeyResult {
  success: boolean;
  error?: string;
}

/** Params for mcpDirectory:getSmitheryKeyStatus (no params needed) */
export type McpDirectoryGetSmitheryKeyStatusParams = Record<string, never>;

/**
 * Result for mcpDirectory:getSmitheryKeyStatus.
 *
 * SECURITY: boolean presence only — the key value never crosses this boundary.
 */
export interface McpDirectoryGetSmitheryKeyStatusResult {
  configured: boolean;
}

/**
 * Params for mcpDirectory:resolveSmithery.
 *
 * Resolves a Smithery server + config into a session-time `McpHttpConfig`.
 * SECURITY: the API key is read backend-side; it is NOT part of these params.
 */
export interface McpDirectoryResolveSmitheryParams {
  /** Fully qualified Smithery server name (e.g., "@owner/server"). */
  qualifiedName: string;
  /** Per-server config collected from the connection configSchema form. */
  config: Record<string, unknown>;
  /** Optional saved Smithery profile id. */
  profile?: string;
}

/**
 * Result for mcpDirectory:resolveSmithery.
 *
 * SECURITY: `config.url` carries the secret-bearing query string. The renderer
 * must treat it as sensitive and never persist it to plaintext config files.
 */
export interface McpDirectoryResolveSmitheryResult {
  config?: McpHttpConfig;
  error?: string;
}
