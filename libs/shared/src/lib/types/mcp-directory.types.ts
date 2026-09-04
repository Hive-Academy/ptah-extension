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
 *  - vscode:      .vscode/mcp.json              (workspace, root key: "servers")
 *  - claude:      .mcp.json                      (workspace, root key: "mcpServers") — shared with ptah-cli
 *  - cursor:      .cursor/mcp.json               (workspace, root key: "mcpServers")
 *  - copilot:     ~/.copilot/mcp-config.json     (user-global, root key: "mcpServers")
 *  - codex:       ~/.codex/config.toml           (user-global, TOML `[mcp_servers.<name>]`)
 *  - antigravity: ~/.gemini/config/mcp_config.json (user-global, root key: "mcpServers",
 *                 remote servers keyed `serverUrl` rather than `url`)
 *
 * Codex joined in TASK_2026_278 Batch 2. It was the one CLI Ptah could spawn
 * but never configure: `.mcp.json` is not a file Codex reads, so every server
 * "installed for codex" landed in a config Codex ignores.
 *
 * Antigravity joined in TASK_2026_285. Its absence was circular: the install
 * surface offered no `agy` option because this union could not express one, and
 * the missing option was then cited as the reason no facet was needed. `agy`
 * reads a real MCP config file that Ptah already writes at spawn time, so the
 * only thing missing was the ability to say so.
 */
export type McpInstallTarget =
  | 'vscode'
  | 'claude'
  | 'cursor'
  | 'copilot'
  | 'codex'
  | 'antigravity';

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
  /** Friendly display name (Smithery `displayName`), preferred for card titles. */
  displayName?: string;
  /** Human-readable description */
  description?: string;
  /** Server icons */
  icons?: McpRegistryIcon[];
  /** Popularity signal — number of recorded uses (Smithery `useCount`). */
  useCount?: number;
  /** Whether the server is managed/hosted by Smithery (Smithery `bySmithery`). */
  bySmithery?: boolean;
  /** Server homepage URL, when published (Smithery `homepage`). */
  homepage?: string;
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
   * Smithery namespace that owns the connection (Connections API).
   *
   * A record that carries BOTH `namespace` and `connectionId` is a
   * Connections-API record: the session reaches it through the one namespace
   * endpoint `https://mcp.smithery.run/<namespace>`. A record without them is
   * a legacy record and keeps the per-server URL until the user reconnects.
   */
  namespace?: string;
  /** Connection id inside {@link SmitheryInstalledRecord.namespace}. */
  connectionId?: string;
  /**
   * Whether an encrypted per-server config blob exists in the secret store for
   * this record. The config values themselves are NOT in this manifest.
   */
  hasEncryptedConfig: boolean;
  /** ISO timestamp of installation. */
  installedAt: string;
}

/**
 * Connection state reported by the Smithery Connections API.
 *
 * The wire carries these as `status.state` on a connection object. `'unknown'`
 * is Ptah's own value for "no connection record was read" (legacy install, API
 * error, or a state Smithery added after this build).
 */
export type SmitheryConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'auth_required'
  | 'input_required'
  | 'error'
  | 'unknown';

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
  /**
   * Connection state right after the install. `'unknown'` means the record was
   * written but the Connections API could not be reached — `error` says why and
   * the install is NOT lost.
   */
  status?: SmitheryConnectionStatus;
  /**
   * Browser URL the user must open to finish the upstream authorization.
   * Present when `status` is `'auth_required'` or `'input_required'`.
   *
   * SECURITY: treat as a one-time credential. Never log it.
   */
  setupUrl?: string;
  /** Smithery namespace the connection was created in. */
  namespace?: string;
  /** Connection id inside {@link McpDirectoryInstallSmitheryResult.namespace}. */
  connectionId?: string;
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

/** Params for mcpDirectory:smitheryAccount (no params needed). */
export type McpDirectorySmitheryAccountParams = Record<string, never>;

/**
 * Result for mcpDirectory:smitheryAccount.
 *
 * SECURITY: reports namespace NAMES only. The API key never crosses this
 * boundary.
 */
export interface McpDirectorySmitheryAccountResult {
  /** Whether a Smithery API key is stored. */
  configured: boolean;
  /** Namespace names the key can reach, in the order the API returned them. */
  namespaces: string[];
  /** The namespace Ptah installs into — the first entry, or null. */
  activeNamespace: string | null;
  error?: string;
}

/**
 * One connection in the active Smithery namespace, as shown by the Marketplace
 * surfaces.
 */
export interface SmitheryConnectionSummary {
  /** Connection id inside the namespace. */
  connectionId: string;
  /** Human-readable name reported by Smithery. */
  name: string;
  /** Smithery registry qualified name, when it can be determined. */
  server?: string;
  status: SmitheryConnectionStatus;
  iconUrl?: string;
  /** ISO timestamp reported by Smithery. */
  createdAt?: string;
  /** True when a Ptah install record points at this connection id. */
  managedByPtah: boolean;
  /** The Ptah serverKey, when `managedByPtah` is true. */
  serverKey?: string;
}

/** Params for mcpDirectory:listSmitheryConnections (no params needed). */
export type McpDirectoryListSmitheryConnectionsParams = Record<string, never>;

/** Result for mcpDirectory:listSmitheryConnections. */
export interface McpDirectoryListSmitheryConnectionsResult {
  connections: SmitheryConnectionSummary[];
  /** The namespace the list came from, or null when none could be resolved. */
  namespace: string | null;
  error?: string;
}

/** Params for mcpDirectory:smitheryConnectionStatus. */
export interface McpDirectorySmitheryConnectionStatusParams {
  /** The serverKey of the Ptah install record to report on. */
  serverKey: string;
}

/**
 * Result for mcpDirectory:smitheryConnectionStatus.
 *
 * SECURITY: `setupUrl` is a one-time credential. Never log it.
 */
export interface McpDirectorySmitheryConnectionStatusResult {
  status: SmitheryConnectionStatus;
  setupUrl?: string;
  error?: string;
}

/** Params for mcpDirectory:openSmitherySetup. */
export interface McpDirectoryOpenSmitherySetupParams {
  /** The serverKey of the Ptah install record to authorize. */
  serverKey: string;
}

/**
 * Result for mcpDirectory:openSmitherySetup.
 *
 * The handler re-creates the connection to obtain a FRESH `setupUrl` and opens
 * it through `IUserInteraction.openExternal`. `opened` is false when there is
 * no setup step to run (already connected) or the API call failed.
 */
export interface McpDirectoryOpenSmitherySetupResult {
  opened: boolean;
  setupUrl?: string;
  error?: string;
}

/**
 * A remote MCP server connected via in-app OAuth, persisted (non-secret
 * metadata only) to `~/.ptah/mcp-oauth-installed.json`.
 *
 * SECURITY: this record holds ONLY non-secret metadata. The OAuth tokens
 * (access/refresh) and client credentials live in the encrypted secret store
 * and are rebuilt into an `Authorization: Bearer` header at query time. No token
 * is ever persisted to disk config.
 */
export interface McpOAuthConnectedRecord {
  /** Stable key used in the session `mcpServersOverride` map. */
  serverKey: string;
  /** Friendly display name. */
  name: string;
  /** The MCP server URL the agent connects to (non-secret). */
  serverUrl: string;
  /** ISO timestamp of the connection. */
  connectedAt: string;
}

/**
 * On-disk manifest of OAuth-connected MCP servers
 * (`~/.ptah/mcp-oauth-installed.json`). Contains no secrets.
 */
export interface McpOAuthInstalledManifest {
  /** Schema version for forward compat. */
  version: 1;
  /** Map of serverKey → connection record. */
  servers: Record<string, McpOAuthConnectedRecord>;
}

/** Connection state for an OAuth MCP server (never carries a token). */
export type McpOAuthConnectionState = 'connected' | 'expired' | 'disconnected';

/**
 * Params for mcpDirectory:connectOAuth.
 *
 * Kicks off the interactive OAuth 2.0 authorization-code + PKCE flow: opens the
 * system browser, catches the loopback redirect, exchanges the code, and stores
 * the tokens encrypted. Returns once the token is stored (or on failure).
 */
export interface McpDirectoryConnectOAuthParams {
  /** The remote MCP server URL to connect to. */
  serverUrl: string;
  /** Optional friendly name (defaults to the server host). */
  name?: string;
  /** Optional stable key for the override map (defaults to a slug of the URL). */
  serverKey?: string;
  /** Optional space-delimited scope string requested from the auth server. */
  scope?: string;
  /**
   * Pre-registered OAuth client credentials, used when the authorization server
   * does not support dynamic client registration (no `registration_endpoint`).
   *
   * SECURITY: `clientSecret` is a secret supplied by the user for confidential
   * pre-registered clients; it is used only in-memory during the flow and stored
   * in the encrypted token record — never in the plaintext manifest.
   */
  clientId?: string;
  /** Pre-registered client secret (confidential clients only). See `clientId`. */
  clientSecret?: string;
}

/**
 * Why a connectOAuth attempt failed.
 *
 * `'no-oauth-discovery'` means the server published no authorization-server
 * metadata — in practice it wants an API key, not OAuth, and the UI says so.
 * Absent on success and on unclassified failures.
 */
export type McpOAuthFailureReason = 'no-oauth-discovery' | 'other';

/** Result for mcpDirectory:connectOAuth. */
export interface McpDirectoryConnectOAuthResult {
  success: boolean;
  /** The serverKey the connection was stored under (echoed for the caller). */
  serverKey?: string;
  /** Sanitized error message on failure (never carries a token). */
  error?: string;
  /** Present only when `success` is false. */
  reason?: McpOAuthFailureReason;
}

/**
 * Params for mcpDirectory:probeOAuthDiscovery — the advisory pre-submit probe.
 *
 * The probe runs the discovery fetches only. It never opens a browser and never
 * registers a client, so it is safe to call while the user is still typing.
 */
export interface McpDirectoryProbeOAuthDiscoveryParams {
  /** The remote MCP server URL to probe. */
  serverUrl: string;
}

/** Result for mcpDirectory:probeOAuthDiscovery. */
export interface McpDirectoryProbeOAuthDiscoveryResult {
  /** True when authorization and token endpoints were discovered. */
  supported: boolean;
  /**
   * Present only when `supported` is true. False means the authorization
   * server publishes no `registration_endpoint` (RFC 7591), so the user must
   * create an app with the provider, register Ptah's redirect URL there, and
   * supply the client ID (HubSpot is the canonical example).
   */
  dynamicRegistration?: boolean;
  /** Present only when `supported` is false. */
  reason?: McpOAuthFailureReason;
}

/** Params for mcpDirectory:getOAuthRedirectUri (no params needed). */
export type McpDirectoryGetOAuthRedirectUriParams = Record<string, never>;

/**
 * Result for mcpDirectory:getOAuthRedirectUri.
 *
 * The redirect URL the host will hand to an authorization server on the next
 * connect. Shown in the UI so the user can register it with a provider that
 * does not support dynamic client registration. Host-dependent: the VS Code
 * URI handler yields a `vscode://…/oauth-callback` deep link; Electron and CLI
 * yield the fixed loopback `http://127.0.0.1:<port>/callback`.
 */
export interface McpDirectoryGetOAuthRedirectUriResult {
  /** Null when the host cannot run an interactive OAuth flow. */
  redirectUri: string | null;
  /** Sanitized error message when `redirectUri` is null. */
  error?: string;
}

/** Params for mcpDirectory:oauthStatus. */
export interface McpDirectoryOAuthStatusParams {
  /** The serverKey to report status for. */
  serverKey: string;
}

/** Result for mcpDirectory:oauthStatus (boolean-ish state only, no token). */
export interface McpDirectoryOAuthStatusResult {
  state: McpOAuthConnectionState;
}

/** Params for mcpDirectory:disconnectOAuth. */
export interface McpDirectoryDisconnectOAuthParams {
  /** The serverKey to disconnect (deletes tokens + manifest record). */
  serverKey: string;
}

/** Result for mcpDirectory:disconnectOAuth. */
export interface McpDirectoryDisconnectOAuthResult {
  success: boolean;
  error?: string;
}

/** Params for mcpDirectory:listOAuthConnected (no params needed). */
export type McpDirectoryListOAuthConnectedParams = Record<string, never>;

/**
 * Result for mcpDirectory:listOAuthConnected.
 *
 * SECURITY: returns non-secret metadata only (never tokens).
 */
export interface McpDirectoryListOAuthConnectedResult {
  servers: McpOAuthConnectedRecord[];
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
