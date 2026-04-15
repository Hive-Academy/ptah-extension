/**
 * MCP Server Directory Types
 *
 * Shared type definitions for MCP server discovery, installation, and management.
 * Provider: Official MCP Registry (registry.modelcontextprotocol.io)
 *
 * Design: Pure TypeScript types, no runtime dependencies (shared library boundary).
 */

// ========================================
// MCP Install Targets
// ========================================

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

// ========================================
// MCP Server Transport Configuration
// ========================================

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

// ========================================
// Official MCP Registry API Response Types
// ========================================

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
 * A single MCP server entry from the Official MCP Registry.
 * Maps to GET /v0.1/servers response items.
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
}

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

// ========================================
// Installation State Types
// ========================================

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

// ========================================
// RPC Method Types
// ========================================

/** Params for mcpDirectory:search */
export interface McpDirectorySearchParams {
  /** Search query string */
  query: string;
  /** Max results to return (default: 20) */
  limit?: number;
  /** Pagination cursor from previous response */
  cursor?: string;
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

/** Params for mcpDirectory:getPopular (no params needed) */
export type McpDirectoryGetPopularParams = Record<string, never>;

/** Result for mcpDirectory:getPopular */
export interface McpDirectoryGetPopularResult {
  servers: McpRegistryEntry[];
}
