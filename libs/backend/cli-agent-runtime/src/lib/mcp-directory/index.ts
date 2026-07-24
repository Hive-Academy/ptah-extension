/**
 * MCP Server Directory Module
 *
 * Provides MCP server discovery (via Official MCP Registry) and
 * installation to multiple CLI/IDE targets.
 */
export { McpRegistryProvider } from './mcp-registry.provider';
export { McpRegistrySourceRegistry } from './mcp-registry-source.registry';
export type {
  IMcpRegistrySource,
  McpRegistrySourceId,
} from './mcp-registry-source.interface';
export { SmitheryRegistrySource } from './smithery-registry.source';
export type {
  SmitheryLogger,
  SmitheryRegistrySourceOptions,
} from './smithery-registry.source';
export { PulseMcpRegistrySource } from './pulsemcp-registry.source';
export type {
  PulseMcpLogger,
  PulseMcpRegistrySourceOptions,
} from './pulsemcp-registry.source';
export {
  PULSEMCP_DEFAULT_REGISTRY_BASE,
  PULSEMCP_DEFAULT_PAGE_SIZE,
  PULSEMCP_CACHE_TTL_MS,
  PULSEMCP_REQUEST_TIMEOUT_MS,
  PULSEMCP_FIRST_OFFSET,
} from './pulsemcp-wire.constants';
export { SmitheryConnectionResolver } from './smithery-connection-resolver';
export type {
  SmitheryResolveInput,
  SmitheryConnectionResolverOptions,
} from './smithery-connection-resolver';
export {
  SmitheryKeyMissingError,
  SmitheryConfigInvalidError,
} from './smithery-errors';
export {
  buildSmitheryUrl,
  SMITHERY_DEFAULT_REGISTRY_BASE,
  SMITHERY_DEFAULT_CONNECTION_HOST,
} from './smithery-wire.constants';
export type {
  BuildSmitheryUrlInput,
  BuiltSmitheryUrl,
} from './smithery-wire.constants';
export {
  SmitheryInstalledManifestStore,
  createSmitheryConfigSecretStore,
  SMITHERY_CONFIG_SECRET_PREFIX,
} from './smithery-installed-manifest';
export type {
  SmitheryConfigSecretStore,
  SmitheryInstallInput,
} from './smithery-installed-manifest';
export { SmitheryOverrideResolver } from './smithery-override-resolver';
export type {
  SmitheryOverrideLogger,
  SmitheryOverrideResolverDeps,
} from './smithery-override-resolver';
export {
  McpOAuthService,
  deriveMcpOAuthServerKey,
} from './oauth/mcp-oauth.service';
export { LoopbackOAuthCallbackListener } from './oauth/loopback-oauth-callback-listener';
export type {
  McpOAuthServiceDeps,
  McpOAuthLogger,
  ConnectOptions,
} from './oauth/mcp-oauth.service';
export {
  createMcpOAuthTokenStore,
  MCP_OAUTH_TOKEN_SECRET_PREFIX,
} from './oauth/mcp-oauth-token-store';
export type {
  McpOAuthTokenStore,
  McpOAuthTokenRecord,
} from './oauth/mcp-oauth-token-store';
export { McpOAuthInstalledManifestStore } from './oauth/mcp-oauth-installed-manifest';
export { McpOAuthOverrideResolver } from './oauth/mcp-oauth-override-resolver';
export type {
  McpOAuthOverrideLogger,
  McpOAuthOverrideResolverDeps,
} from './oauth/mcp-oauth-override-resolver';
export { generatePkceChallenge } from './oauth/pkce';
export type { PkceChallenge } from './oauth/pkce';
export {
  discoverAuthorizationServer,
  discoverAuthServerMetadata,
  registerClient,
} from './oauth/mcp-oauth-metadata';
export type {
  FetchLike,
  AuthServerMetadata,
  RegisteredClient,
} from './oauth/mcp-oauth-metadata';
export { McpInstallService } from './mcp-install.service';
export { McpInstallManifestTracker } from './mcp-install-manifest';
export type { IMcpServerInstaller } from './mcp-installer.interface';
export { VscodeMcpInstaller } from './installers/vscode-mcp.installer';
export { ClaudeMcpInstaller } from './installers/claude-mcp.installer';
export { CursorMcpInstaller } from './installers/cursor-mcp.installer';
export { CopilotMcpInstaller } from './installers/copilot-mcp.installer';
