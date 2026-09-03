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
export {
  LoopbackOAuthCallbackListener,
  MCP_OAUTH_LOOPBACK_PORT,
} from './oauth/loopback-oauth-callback-listener';
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
  OAuthDiscoveryError,
  OAUTH_DISCOVERY_ERROR_NAME,
} from './oauth/mcp-oauth-metadata';
export type {
  FetchLike,
  AuthServerMetadata,
  RegisteredClient,
} from './oauth/mcp-oauth-metadata';
/**
 * The install surface. The per-target installers, their manifest tracker and
 * the JSON config helpers were deleted in TASK_2026_278 Batch 2 — writing MCP
 * config files is now the reconciler's MCP facet
 * (`@ptah-extension/harness-sync`), and `McpInstallService` records intent and
 * asks it to reconcile.
 */
export { McpInstallService } from './mcp-install.service';
