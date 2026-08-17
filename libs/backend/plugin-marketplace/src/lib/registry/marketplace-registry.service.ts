/**
 * Registry of external plugin marketplaces.
 *
 * A marketplace is a GitHub repository exposing `.claude-plugin/marketplace.json`.
 * This service owns four things and nothing else: validating an `owner/repo`
 * slug, fetching and Zod-validating that manifest, caching it with a TTL, and
 * persisting which marketplaces the user registered.
 *
 * It deliberately does NOT install anything — `ExternalPluginInstallerService`
 * does, and asks this service for the validated manifest. Keeping the fetch
 * boundary in one class is what lets the installer assume its manifest input is
 * already trustworthy.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  parseSourceSlug,
  SUGGESTED_MARKETPLACES,
  type ExternalMarketplace,
  type ExternalMarketplaceBrowseResult,
  type ExternalPluginListing,
  type ListMarketplacesResult,
} from '@ptah-extension/shared';
import { GitHubContentClient } from '../github/github-content.client';
import { PluginMarketplaceError } from '../errors';
import {
  MarketplaceManifestSchema,
  type MarketplaceManifest,
  type MarketplaceManifestPlugin,
} from './marketplace-manifest.schema';
import { ExternalPluginStateStore } from '../install/external-plugin-state.store';
import { buildExternalPluginId } from '../install/external-plugin-id';

/**
 * How long a fetched manifest stays fresh.
 *
 * Long enough that browsing a marketplace, opening a consent dialog and
 * confirming it costs one fetch rather than three — which matters because the
 * install path pairs each fetch with a metered `api.github.com` call. Short
 * enough that a user who adds a plugin upstream and comes back sees it.
 */
const MANIFEST_TTL_MS = 15 * 60 * 1000;

interface CachedManifest {
  manifest: MarketplaceManifest;
  fetchedAt: number;
}

/** A manifest plus the marketplace identity it was fetched for. */
export interface ResolvedManifest {
  source: string;
  owner: string;
  repo: string;
  manifest: MarketplaceManifest;
  fromCache: boolean;
}

@injectable()
export class MarketplaceRegistryService {
  private readonly cache = new Map<string, CachedManifest>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    private readonly github: GitHubContentClient,
    private readonly store: ExternalPluginStateStore,
  ) {}

  /**
   * Registered marketplaces plus the built-in suggestions the user has not
   * already added.
   *
   * A suggestion carries no privilege: adding one runs exactly the same
   * validation as a hand-typed slug. It exists so the `.NET` story has a
   * discoverable entry point instead of requiring the user to know a URL.
   */
  listMarketplaces(): ListMarketplacesResult {
    const stored = this.store.listMarketplaces();
    const registered = new Set(stored.map((entry) => entry.source));

    return {
      marketplaces: stored.map((entry) => ({ ...entry })),
      suggestions: SUGGESTED_MARKETPLACES.filter(
        (suggestion) => !registered.has(suggestion.source),
      ).map((suggestion) => ({ ...suggestion })),
      // Flat, and built from the consent records rather than from the
      // registered marketplaces — an install survives deregistering the
      // marketplace it came from, so anything derived from `stored` would hide
      // plugins that are still installed and still running.
      installed: this.store.listInstalled().map((record) => ({
        id: record.pluginId,
        name: record.plugin,
        description: record.displayName,
        source: record.source,
        path: '',
        version: record.version,
        installed: true,
        installedVersion: record.version,
      })),
    };
  }

  /**
   * Register `owner/repo` after proving it is a real marketplace.
   *
   * The manifest is fetched and validated BEFORE anything is persisted, so a
   * typo or a repo without `.claude-plugin/marketplace.json` never leaves a
   * broken entry in the user's list.
   */
  async addMarketplace(source: string): Promise<ExternalMarketplace> {
    const resolved = await this.resolveManifest(source, { forceRefresh: true });
    const existing = this.store.findMarketplace(resolved.source);

    const entry = {
      source: resolved.source,
      name: resolved.manifest.name,
      owner: normalizeOwner(resolved.manifest.owner) ?? resolved.owner,
      pluginCount: resolved.manifest.plugins.length,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      lastFetchedAt: new Date().toISOString(),
    };

    await this.store.upsertMarketplace(entry);

    this.logger.debug('[MarketplaceRegistryService] Marketplace registered', {
      source: entry.source,
      pluginCount: entry.pluginCount,
    });

    return { ...entry };
  }

  /**
   * Deregister a marketplace.
   *
   * Installed plugins survive: the user consented to each of those downloads
   * separately, so removing the catalogue they came from must not quietly
   * revoke them. Uninstall is its own explicit action.
   */
  async removeMarketplace(source: string): Promise<boolean> {
    const slug = this.requireSlug(source);
    this.cache.delete(slug.source);
    return this.store.removeMarketplace(slug.source);
  }

  /**
   * List the plugins a REGISTERED marketplace advertises.
   *
   * Requiring prior registration is not ceremony: it means `browse` and
   * `install` can only ever reach a repo the user explicitly named, so no
   * caller elsewhere in the app can turn an arbitrary string into a GitHub
   * fetch.
   */
  async browse(
    source: string,
    options: { refresh?: boolean } = {},
  ): Promise<ExternalMarketplaceBrowseResult> {
    const slug = this.requireSlug(source);
    const stored = this.store.findMarketplace(slug.source);
    if (!stored) {
      throw new PluginMarketplaceError(
        'marketplace-not-registered',
        `${slug.source} is not a registered marketplace. Add it first.`,
      );
    }

    const resolved = await this.resolveManifest(slug.source, {
      forceRefresh: options.refresh === true,
    });
    const installed = new Map(
      this.store.listInstalled().map((entry) => [entry.pluginId, entry]),
    );

    const plugins: ExternalPluginListing[] = resolved.manifest.plugins.map(
      (plugin) => {
        const id = buildExternalPluginId({
          owner: resolved.owner,
          repo: resolved.repo,
          plugin: plugin.name,
        });
        const record = installed.get(id);

        return {
          id,
          name: plugin.name,
          description: plugin.description ?? '',
          source: resolved.source,
          path: plugin.source,
          version: plugin.version,
          installed: record !== undefined,
          installedVersion: record?.version,
        };
      },
    );

    const marketplace: ExternalMarketplace = {
      ...stored,
      name: resolved.manifest.name,
      pluginCount: plugins.length,
      lastFetchedAt: new Date().toISOString(),
    };

    if (!resolved.fromCache) {
      await this.store.upsertMarketplace(marketplace);
    }

    return { marketplace, plugins, fromCache: resolved.fromCache };
  }

  /**
   * The validated manifest entry for one plugin.
   *
   * The installer's entry point. Throws `plugin-not-found` rather than
   * returning null so a bad `plugin` param cannot be mistaken for an empty
   * marketplace.
   */
  async resolvePlugin(
    source: string,
    plugin: string,
  ): Promise<{ resolved: ResolvedManifest; entry: MarketplaceManifestPlugin }> {
    const slug = this.requireSlug(source);
    if (!this.store.findMarketplace(slug.source)) {
      throw new PluginMarketplaceError(
        'marketplace-not-registered',
        `${slug.source} is not a registered marketplace. Add it first.`,
      );
    }

    const resolved = await this.resolveManifest(slug.source);
    const entry = resolved.manifest.plugins.find(
      (candidate) => candidate.name === plugin,
    );

    if (!entry) {
      throw new PluginMarketplaceError(
        'plugin-not-found',
        `${slug.source} does not advertise a plugin named "${plugin}".`,
      );
    }

    return { resolved, entry };
  }

  /** Drop the cached manifest for a source (used after an install). */
  invalidate(source: string): void {
    this.cache.delete(source);
  }

  /**
   * Fetch + validate a manifest, honouring the TTL cache.
   *
   * Validation failures are reported with the Zod issue path so a marketplace
   * author can fix their manifest, but never with the raw document — the
   * document is untrusted content and does not belong in a log line.
   */
  private async resolveManifest(
    source: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ResolvedManifest> {
    const slug = this.requireSlug(source);

    if (!options.forceRefresh) {
      const cached = this.cache.get(slug.source);
      if (cached && Date.now() - cached.fetchedAt < MANIFEST_TTL_MS) {
        return {
          source: slug.source,
          owner: slug.owner,
          repo: slug.repo,
          manifest: cached.manifest,
          fromCache: true,
        };
      }
    }

    const raw = await this.github.fetchMarketplaceManifest(
      slug.owner,
      slug.repo,
    );

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new PluginMarketplaceError(
        'manifest-invalid',
        `${slug.source}: .claude-plugin/marketplace.json is not valid JSON.`,
      );
    }

    const parsed = MarketplaceManifestSchema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');

      this.logger.warn(
        '[MarketplaceRegistryService] Rejected marketplace manifest',
        { source: slug.source, detail },
      );

      throw new PluginMarketplaceError(
        'manifest-invalid',
        `${slug.source}: .claude-plugin/marketplace.json failed validation — ${detail}`,
      );
    }

    this.cache.set(slug.source, {
      manifest: parsed.data,
      fetchedAt: Date.now(),
    });

    return {
      source: slug.source,
      owner: slug.owner,
      repo: slug.repo,
      manifest: parsed.data,
      fromCache: false,
    };
  }

  /** Parse `owner/repo` or throw a user-facing error. */
  private requireSlug(source: string): {
    source: string;
    owner: string;
    repo: string;
  } {
    const parsed = parseSourceSlug(source);
    if (!parsed) {
      throw new PluginMarketplaceError(
        'invalid-source',
        `"${source}" is not a valid GitHub source. Use the form owner/repo, for example dotnet/skills.`,
      );
    }
    return { source: `${parsed.owner}/${parsed.repo}`, ...parsed };
  }
}

/** `owner` is a string or an object; empty strings mean "not declared". */
function normalizeOwner(owner: string | undefined): string | undefined {
  if (owner === undefined) return undefined;
  const trimmed = owner.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
