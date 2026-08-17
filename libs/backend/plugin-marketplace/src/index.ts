export { PLUGIN_MARKETPLACE_TOKENS } from './lib/di/tokens';
export {
  registerPluginMarketplaceServices,
  initializePluginMarketplace,
} from './lib/di/register';

export { MarketplaceRegistryService } from './lib/registry/marketplace-registry.service';
export type { ResolvedManifest } from './lib/registry/marketplace-registry.service';
export {
  MarketplaceManifestSchema,
  PluginMetadataSchema,
  PluginVersionFileSchema,
} from './lib/registry/marketplace-manifest.schema';
export type {
  MarketplaceManifest,
  MarketplaceManifestPlugin,
} from './lib/registry/marketplace-manifest.schema';

export { ExternalPluginInstallerService } from './lib/install/external-plugin-installer.service';
export { ExternalPluginStateStore } from './lib/install/external-plugin-state.store';
export type {
  InstalledExternalPlugin,
  StoredMarketplace,
} from './lib/install/external-plugin-state.store';

export {
  EXTERNAL_PLUGIN_ID_PREFIX,
  EXTERNAL_PLUGINS_DIRNAME,
  buildExternalPluginId,
  coordinateSource,
  externalPluginDir,
  externalRootDir,
  isExternalPluginId,
  parseExternalPluginId,
} from './lib/install/external-plugin-id';
export type { ExternalPluginCoordinate } from './lib/install/external-plugin-id';

export {
  GitHubContentClient,
  decodeUtf8Strict,
} from './lib/github/github-content.client';
export type {
  GitTreeEntry,
  FetchedBlob,
} from './lib/github/github-content.client';

export { PluginMarketplaceError } from './lib/errors';
export type { PluginMarketplaceErrorCode } from './lib/errors';
