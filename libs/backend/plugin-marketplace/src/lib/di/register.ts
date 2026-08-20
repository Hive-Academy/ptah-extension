/**
 * plugin-marketplace DI registration helper.
 *
 * Pre-conditions (caller responsibility):
 *  - `TOKENS.LOGGER` is registered (vscode-core).
 *
 * Post-conditions: every `PLUGIN_MARKETPLACE_TOKENS.*` binding resolves as a
 * singleton. Both stateful services still need `initialize(pluginsBasePath)`
 * from the host once `ContentDownloadService.getPluginsPath()` is known — the
 * same late-initialization contract `PluginLoaderService` has, and for the same
 * reason: the path is not available at container-build time.
 *
 * Until `initialize` runs, the state store reports an EMPTY allowlist. That is
 * the safe direction: an uninitialized host resolves no external plugins rather
 * than resolving all of them.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { PLUGIN_MARKETPLACE_TOKENS } from './tokens';
import { GitHubContentClient } from '../github/github-content.client';
import { ExternalPluginStateStore } from '../install/external-plugin-state.store';
import { MarketplaceRegistryService } from '../registry/marketplace-registry.service';
import { ExternalPluginInstallerService } from '../install/external-plugin-installer.service';

export function registerPluginMarketplaceServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[plugin-marketplace] registering services');

  container.registerSingleton(GitHubContentClient);
  container.registerSingleton(ExternalPluginStateStore);
  container.registerSingleton(MarketplaceRegistryService);
  container.registerSingleton(ExternalPluginInstallerService);

  container.register(PLUGIN_MARKETPLACE_TOKENS.GITHUB_CONTENT_CLIENT, {
    useToken: GitHubContentClient,
  });
  container.register(PLUGIN_MARKETPLACE_TOKENS.STATE_STORE, {
    useToken: ExternalPluginStateStore,
  });
  container.register(PLUGIN_MARKETPLACE_TOKENS.REGISTRY, {
    useToken: MarketplaceRegistryService,
  });
  container.register(PLUGIN_MARKETPLACE_TOKENS.INSTALLER, {
    useToken: ExternalPluginInstallerService,
  });

  logger.info('[plugin-marketplace] services registered');
}

/**
 * Bind both stateful services to `~/.ptah/plugins`.
 *
 * Hosts call this immediately after `pluginLoader.initialize(...)` with the
 * same path. Split from registration because the path only exists after
 * `ContentDownloadService` has resolved it.
 */
export function initializePluginMarketplace(
  container: DependencyContainer,
  pluginsBasePath: string,
): void {
  container
    .resolve<ExternalPluginStateStore>(PLUGIN_MARKETPLACE_TOKENS.STATE_STORE)
    .initialize(pluginsBasePath);
  container
    .resolve<ExternalPluginInstallerService>(
      PLUGIN_MARKETPLACE_TOKENS.INSTALLER,
    )
    .initialize(pluginsBasePath);
}
