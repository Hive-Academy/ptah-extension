/**
 * Where inside the Marketplace a caller wants to go, as a value.
 *
 * ## Why this lives in `core` (TASK_2026_533)
 *
 * The Marketplace is a routed tree (`/marketplace/overview`,
 * `/marketplace/servers/smithery`, ...). The callers that deep-link into it —
 * `McpStatusChipComponent` and `ChatEmptyStateComponent` in `chat` — cannot
 * import `marketplace`, and `AppStateManager`, which remembers the last page
 * per workspace, lives here. `core` is the shared ancestor, so the route union
 * and its mapping to router commands live here once.
 *
 * Only the PAGE and the SOURCE are modelled. Detail refs (`:serverRef`,
 * `:connectorId`, `:skillRef`) are not: no library outside `marketplace` needs
 * them, and a remembered route that pointed at a server which has since been
 * removed would restore onto a "Not found" page.
 *
 * Nothing here is Angular: no decorator, no injection, no signal. The router
 * speaks commands and segments; this module speaks `MarketplaceRoute`; the two
 * functions below are the only translation between them.
 */

/** A server source page under `/marketplace/servers/<source>`. */
export type MarketplaceServerSource = 'smithery' | 'registry' | 'custom-url';

/** A skill source page under `/marketplace/skills/<source>`. */
export type MarketplaceSkillSource =
  'ptah-plugins' | 'community' | 'marketplaces';

/**
 * One addressable Marketplace page.
 *
 * A `servers` or `skills` route without a `source` is the installed list of
 * that kind; with a `source` it is that source's browse page.
 */
export type MarketplaceRoute =
  | { readonly page: 'overview' }
  | { readonly page: 'connectors' }
  | { readonly page: 'servers'; readonly source?: MarketplaceServerSource }
  | { readonly page: 'skills'; readonly source?: MarketplaceSkillSource };

/**
 * Every server source, as the route path segment it is addressed by.
 *
 * `satisfies` makes a missing or misspelt member a compile error rather than a
 * source whose URL silently never parses back.
 */
const SERVER_SOURCES = [
  'smithery',
  'registry',
  'custom-url',
] as const satisfies readonly MarketplaceServerSource[];

/** Every skill source, as the route path segment it is addressed by. */
const SKILL_SOURCES = [
  'ptah-plugins',
  'community',
  'marketplaces',
] as const satisfies readonly MarketplaceSkillSource[];

/**
 * Router commands for `route`, relative to `/marketplace`.
 *
 * `{ page: 'servers', source: 'smithery' }` → `['servers', 'smithery']`, so a
 * caller builds the full URL with `['/', 'marketplace', ...commands]` and the
 * router does the encoding.
 */
export function marketplaceRouteCommands(route: MarketplaceRoute): string[] {
  switch (route.page) {
    case 'overview':
      return ['overview'];
    case 'connectors':
      return ['connectors'];
    case 'servers':
      return route.source === undefined
        ? ['servers']
        : ['servers', route.source];
    case 'skills':
      return route.source === undefined ? ['skills'] : ['skills', route.source];
    default:
      return assertNever(route);
  }
}

/**
 * The Marketplace page a URL addresses, from its path segments relative to
 * `/marketplace` (`UrlSegment.path` values, so matrix parameters are already
 * gone). Total — never throws.
 *
 * Accepts exactly the shapes the Marketplace route tree matches:
 *
 * - `overview`, `overview/<serverRef>` → overview
 * - `connectors`, `connectors/<connectorId>` → connectors
 * - `servers`, `servers/<serverRef>` → servers (installed list)
 * - `servers/<source>` → that server source
 * - `skills`, `skills/<skillRef>` → skills (installed list)
 * - `skills/<source>` → that skill source
 *
 * A detail id is DROPPED: the page it sits on is what gets remembered. A
 * detail ref can never be mistaken for a source, because every ref carries a
 * `:` (`<origin>:<key>`, `<kind>:<id>`) and no source id does.
 *
 * Everything else is `null`: no segments at all, an unknown page, an empty
 * segment, or a path deeper than the tree goes. The caller treats `null` as
 * "nothing to remember" and the default redirect lands on overview.
 */
export function marketplaceRouteFromSegments(
  segments: readonly string[],
): MarketplaceRoute | null {
  if (segments.length === 0 || segments.length > 2) return null;
  if (segments.some((segment) => segment === '')) return null;

  const [page, second] = segments;
  switch (page) {
    case 'overview':
      return { page: 'overview' };
    case 'connectors':
      return { page: 'connectors' };
    case 'servers':
      return second !== undefined && isServerSource(second)
        ? { page: 'servers', source: second }
        : { page: 'servers' };
    case 'skills':
      return second !== undefined && isSkillSource(second)
        ? { page: 'skills', source: second }
        : { page: 'skills' };
    default:
      return null;
  }
}

function isServerSource(value: string): value is MarketplaceServerSource {
  return (SERVER_SOURCES as readonly string[]).includes(value);
}

function isSkillSource(value: string): value is MarketplaceSkillSource {
  return (SKILL_SOURCES as readonly string[]).includes(value);
}

/** Compile-time exhaustiveness for {@link marketplaceRouteCommands}. */
function assertNever(value: never): never {
  throw new Error(`Unhandled marketplace route: ${JSON.stringify(value)}`);
}
