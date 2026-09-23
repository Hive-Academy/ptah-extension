/**
 * Which brand mark stands for what: MCP servers, CLI install targets and
 * provider-settings ids, mapped to the slugs of the vendored artwork table
 * (`brand-marks.generated.ts`).
 *
 * THE TABLES ARE THE ALLOWLIST. No component branches on a server, target or
 * provider id; adding a mark is a one-row edit here (plus vendoring the slug
 * through `scripts/brand-icons.manifest.json` when it is new). Every slug named
 * below is either vendored artwork or a declared monogram — the spec pins that.
 *
 * This file holds slugs, not artwork, so importing it pulls no logo into a
 * bundle. The connector catalogue and the server-identity rules come from
 * `@ptah-extension/shared`, the same rules the Marketplace uses to merge rows,
 * so a server matches here exactly when it matches there.
 */
import {
  PTAH_CONNECTORS,
  normalizeMcpServerUrl,
  normalizeServerKey,
  type McpInstallTarget,
} from '@ptah-extension/shared';

/**
 * Well-known MCP servers that are not catalogue connectors, keyed by their
 * `normalizeServerKey` form (`node_repl` is looked up as `node-repl`).
 */
export const KNOWN_SERVER_BRANDS: Readonly<Record<string, string>> = {
  'angular-cli': 'angular',
  'chrome-devtools': 'google-chrome',
  daisyui: 'daisyui',
  'davinci-resolve': 'davinci-resolve',
  firecrawl: 'firecrawl',
  'node-repl': 'nodedotjs',
  sentry: 'sentry',
  'shopify-dev-mcp': 'shopify',
  sonarqube: 'sonarqube',
};

/**
 * The mark of one CLI install target.
 *
 * - `brand`: a slug for `ptah-brand-mark`.
 * - `provider-mark`: an id of the hand-authored provider glyph table
 *   (`PROVIDER_MARKS`), rendered by `ptah-provider-mark`. OpenCode has no
 *   vendored logo, and its hand-authored glyph beats a monogram.
 */
export type CliTargetBrand =
  | { readonly kind: 'brand'; readonly brandSlug: string }
  | { readonly kind: 'provider-mark'; readonly providerId: string };

/**
 * Real vendor marks for the CLI install targets (R1), one per
 * `McpInstallTarget`. `vscode` names the VS Code slug, which the vendoring run
 * could not draw and declared a monogram; it renders as one until artwork is
 * available, with no change here.
 */
export const CLI_TARGET_BRANDS: Readonly<
  Record<McpInstallTarget, CliTargetBrand>
> = {
  vscode: { kind: 'brand', brandSlug: 'visual-studio-code' },
  claude: { kind: 'brand', brandSlug: 'claude' },
  cursor: { kind: 'brand', brandSlug: 'cursor' },
  copilot: { kind: 'brand', brandSlug: 'github-copilot' },
  codex: { kind: 'brand', brandSlug: 'openai' },
  antigravity: { kind: 'brand', brandSlug: 'google' },
  opencode: { kind: 'provider-mark', providerId: 'opencode' },
};

/**
 * Provider-settings ids that show a vendored mark, keyed by provider id.
 * Batch 7c wires `ProviderMarkComponent` to draw these from the small
 * `PROVIDER_BRAND_ART` subset, never from the full table.
 */
export const PROVIDER_BRAND_SLUGS: Readonly<Record<string, string>> = {
  anthropic: 'anthropic',
  'claude-cli': 'claude',
};

/**
 * Registry namespaces that a vendor controls, mapped to its brand. A listing
 * in one of these namespaces may show the vendor's mark on its name alone.
 *
 * Keys are case-folded namespaces: everything before the last `/` of a
 * registry name. Every entry needs an evidence comment naming the vendor's
 * official repository or registry page. Without one, a namespace does not go
 * in: a publisher chooses its own listing name, so an unproven entry would
 * let anyone wear the vendor's logo.
 */
export const LISTING_NAMESPACE_BRANDS: Readonly<Record<string, string>> = {
  // Sentry's official MCP server, https://github.com/getsentry/sentry-mcp.
  // The MCP Registry grants `io.github.<org>` only to publishers who
  // authenticate as that GitHub organisation, here `getsentry`.
  'io.github.getsentry': 'sentry',
};

/**
 * A row the user configured or connected (installed servers, Custom URL's
 * connected servers). The key is the user's own label, so matching it by name
 * is safe.
 *
 * The listing fields are typed `never` so that a discovery listing's query
 * cannot be passed here by mistake.
 */
export interface InstalledBrandQuery {
  /** The server's key as configured or reported (`io.github.user/server`). */
  readonly serverKey: string;
  /** The server's remote URL, when it has one. */
  readonly serverUrl?: string | null;
  readonly registryName?: never;
  readonly remoteUrls?: never;
}

/**
 * A third-party discovery listing (Smithery, MCP Registry, Custom URL
 * suggestions). Its name is chosen by whoever publishes it, so the name alone
 * never earns a vendor mark.
 *
 * The installed-row fields are typed `never` so that an installed row's query
 * cannot be passed here by mistake.
 */
export interface ListingBrandQuery {
  /** Registry name (`io.github.getsentry/sentry`); absent for a bare URL. */
  readonly registryName?: string | null;
  /**
   * Every remote URL the listing connects to: MCP Registry
   * `version_detail.transports[].url` and Smithery
   * `connections[].deploymentUrl`.
   */
  readonly remoteUrls: readonly string[];
  readonly serverKey?: never;
  readonly serverUrl?: never;
}

interface ConnectorIndex {
  /** Catalogue `brandSlug` by `normalizeMcpServerUrl(url)`. */
  readonly byUrl: ReadonlyMap<string, string>;
  /** Catalogue `brandSlug` by `normalizeServerKey(id)`. */
  readonly byId: ReadonlyMap<string, string>;
}

let connectorIndex: ConnectorIndex | null = null;

/**
 * The catalogue indexed once, on first use. Built lazily so importing this
 * file does no work. The first entry wins when two share a URL or an id.
 */
function connectors(): ConnectorIndex {
  if (connectorIndex !== null) return connectorIndex;
  const byUrl = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const connector of PTAH_CONNECTORS) {
    if (connector.url !== undefined) {
      const url = normalizeMcpServerUrl(connector.url);
      if (!byUrl.has(url)) byUrl.set(url, connector.brandSlug);
    }
    const id = normalizeServerKey(connector.id);
    if (!byId.has(id)) byId.set(id, connector.brandSlug);
  }
  connectorIndex = { byUrl, byId };
  return connectorIndex;
}

/** A catalogue id, then a known server, for one already-normalised key. */
function slugForKey(key: string): string | null {
  if (key.length === 0) return null;
  const fromCatalogue = connectors().byId.get(key);
  if (fromCatalogue !== undefined) return fromCatalogue;
  return Object.hasOwn(KNOWN_SERVER_BRANDS, key)
    ? KNOWN_SERVER_BRANDS[key]
    : null;
}

/** The catalogue brand whose URL equals `url`, or `null`. Blank URLs miss. */
function slugForUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? '';
  if (trimmed.length === 0) return null;
  return connectors().byUrl.get(normalizeMcpServerUrl(trimmed)) ?? null;
}

/**
 * The brand slug for a server the user configured or connected, or `null`
 * when nothing names it (the caller then shows a monogram). Tried in order:
 *
 * 1. `serverUrl` equal to a catalogue connector's URL (`normalizeMcpServerUrl`)
 * 2. `normalizeServerKey(serverKey)` equal to a catalogue connector id
 * 3. `normalizeServerKey(serverKey)` in `KNOWN_SERVER_BRANDS`
 * 4. checks 2 and 3 on the last `/` segment of the key, for registry names
 *    such as `io.github.user/server`
 * 5. `null`
 *
 * Installed rows only: steps 2-4 trust the name. Discovery listings use
 * `resolveListingBrandSlug`. Total: never throws, whatever the input.
 */
export function resolveInstalledBrandSlug(
  query: InstalledBrandQuery,
): string | null {
  const fromUrl = slugForUrl(query.serverUrl);
  if (fromUrl !== null) return fromUrl;

  const fromKey = slugForKey(normalizeServerKey(query.serverKey));
  if (fromKey !== null) return fromKey;

  const segments = query.serverKey.split('/').filter((s) => s.trim() !== '');
  if (segments.length < 2) return null;
  return slugForKey(normalizeServerKey(segments[segments.length - 1]));
}

/**
 * The brand slug for a third-party discovery listing, or `null` (the caller
 * then shows a monogram). Tried in order:
 *
 * 1. any of `remoteUrls` equal to a catalogue connector's URL
 *    (`normalizeMcpServerUrl`): the mark then says truthfully which vendor
 *    endpoint the listing connects to
 * 2. the registry namespace (before the last `/`, case-folded) in
 *    `LISTING_NAMESPACE_BRANDS`
 * 3. `null`
 *
 * A listing's name never matches a catalogue id, a known server or a last
 * segment, so `attacker/github` and even a bare `github` get a monogram.
 * `verified`, `scanPassed` and `repository` are not branding signals: they
 * speak for the server, not for who published it.
 *
 * Total: never throws, whatever the input.
 */
export function resolveListingBrandSlug(
  query: ListingBrandQuery,
): string | null {
  for (const url of query.remoteUrls) {
    const fromUrl = slugForUrl(url);
    if (fromUrl !== null) return fromUrl;
  }

  const name = query.registryName?.trim() ?? '';
  const slash = name.lastIndexOf('/');
  if (slash <= 0) return null;
  const namespace = name.slice(0, slash).toLowerCase();
  return Object.hasOwn(LISTING_NAMESPACE_BRANDS, namespace)
    ? LISTING_NAMESPACE_BRANDS[namespace]
    : null;
}
