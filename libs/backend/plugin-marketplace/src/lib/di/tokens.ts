/**
 * DI tokens for the external plugin marketplace.
 *
 * `Symbol.for(...)` (global registry) so the same token resolves across
 * separately-bundled hosts, matching every other lib in the workspace.
 */
export const PLUGIN_MARKETPLACE_TOKENS = {
  /** `GitHubContentClient` — the only outbound HTTP in this lib. */
  GITHUB_CONTENT_CLIENT: Symbol.for('PluginMarketplaceGithubClient'),
  /** `ExternalPluginStateStore` — registered marketplaces + the allowlist. */
  STATE_STORE: Symbol.for('PluginMarketplaceStateStore'),
  /** `MarketplaceRegistryService`. */
  REGISTRY: Symbol.for('PluginMarketplaceRegistry'),
  /** `ExternalPluginInstallerService`. */
  INSTALLER: Symbol.for('PluginMarketplaceInstaller'),
} as const;
