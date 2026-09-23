/**
 * TASK_2026_533 — the Marketplace route model.
 *
 * The D2 table of the implementation plan maps every deep link that exists
 * today onto a routed page. It is walked row by row here, in both directions:
 * route → commands must build the new path, and the new path's segments must
 * parse back to the same route, so the remembered route and the URL can never
 * disagree.
 */

import {
  marketplaceRouteCommands,
  marketplaceRouteFromSegments,
  type MarketplaceRoute,
} from './marketplace-route';

interface D2Row {
  /** The value the old `marketplaceActiveProvider` grammar stored. */
  readonly oldValue: string;
  readonly route: MarketplaceRoute;
  /** The new path, relative to `/marketplace`. */
  readonly path: string;
}

/** implementation-plan.md, D2 table, one entry per row that names a route. */
const D2_TABLE: readonly D2Row[] = [
  { oldValue: 'connected', route: { page: 'overview' }, path: 'overview' },
  {
    oldValue: 'apps:connectors',
    route: { page: 'connectors' },
    path: 'connectors',
  },
  { oldValue: 'apps', route: { page: 'connectors' }, path: 'connectors' },
  {
    oldValue: 'apps:smithery',
    route: { page: 'servers', source: 'smithery' },
    path: 'servers/smithery',
  },
  {
    oldValue: 'apps:mcp-registry',
    route: { page: 'servers', source: 'registry' },
    path: 'servers/registry',
  },
  {
    oldValue: 'apps:custom-url',
    route: { page: 'servers', source: 'custom-url' },
    path: 'servers/custom-url',
  },
  {
    oldValue: 'skills:ptah-plugins',
    route: { page: 'skills', source: 'ptah-plugins' },
    path: 'skills/ptah-plugins',
  },
  {
    oldValue: 'skills:community',
    route: { page: 'skills', source: 'community' },
    path: 'skills/community',
  },
  {
    oldValue: 'skills:marketplaces',
    route: { page: 'skills', source: 'marketplaces' },
    path: 'skills/marketplaces',
  },
  { oldValue: 'skills', route: { page: 'skills' }, path: 'skills' },
];

/**
 * The provider tile ids shipped before TASK_2026_524
 * (`marketplace-state.service.spec.ts`, "retired ids (AC5)"), plus the two
 * TASK_2026_524 section ids that no longer name a page.
 */
const RETIRED_IDS = [
  'plugins',
  'official-mcp',
  'skills-sh',
  'smithery',
  'oauth-mcp',
  'composio',
  'connected',
  'apps',
] as const;

describe('marketplaceRouteCommands — D2 table', () => {
  it.each(D2_TABLE)('$oldValue → /marketplace/$path', ({ route, path }) => {
    expect(marketplaceRouteCommands(route)).toEqual(path.split('/'));
  });

  it('builds the installed server list without a source segment', () => {
    expect(marketplaceRouteCommands({ page: 'servers' })).toEqual(['servers']);
  });

  it('returns a fresh array each call, so a caller may spread or mutate it', () => {
    const route: MarketplaceRoute = { page: 'skills', source: 'community' };
    const first = marketplaceRouteCommands(route);
    first.push('mutated');

    expect(marketplaceRouteCommands(route)).toEqual(['skills', 'community']);
  });
});

describe('marketplaceRouteFromSegments — D2 table', () => {
  it.each(D2_TABLE)(
    '/marketplace/$path parses back to its route',
    ({ route, path }) => {
      expect(marketplaceRouteFromSegments(path.split('/'))).toEqual(route);
    },
  );

  it('round-trips every route it can build', () => {
    const routes: readonly MarketplaceRoute[] = [
      { page: 'overview' },
      { page: 'connectors' },
      { page: 'servers' },
      { page: 'servers', source: 'smithery' },
      { page: 'servers', source: 'registry' },
      { page: 'servers', source: 'custom-url' },
      { page: 'skills' },
      { page: 'skills', source: 'ptah-plugins' },
      { page: 'skills', source: 'community' },
      { page: 'skills', source: 'marketplaces' },
    ];

    for (const route of routes) {
      expect(
        marketplaceRouteFromSegments(marketplaceRouteCommands(route)),
      ).toEqual(route);
    }
  });
});

describe('marketplaceRouteFromSegments — detail ids are dropped', () => {
  it.each([
    [['overview', 'claude-user:sentry'], { page: 'overview' }],
    [['connectors', 'github'], { page: 'connectors' }],
    [['servers', 'claude-user:sentry'], { page: 'servers' }],
    [['servers', 'harness:node_repl'], { page: 'servers' }],
    [['skills', 'plugin:ptah-core'], { page: 'skills' }],
    // An external plugin id keeps its `/` inside ONE segment; the router
    // decodes `%2F` back before the shell hands the segment over.
    [['skills', 'external:owner/repo/plugin'], { page: 'skills' }],
  ] as const)('%j → %j', (segments, route) => {
    expect(marketplaceRouteFromSegments(segments)).toEqual(route);
  });

  it('never mistakes a ref for the source it starts with', () => {
    // `smithery` is a source; `smithery:foo` is a server ref on the installed
    // list. The first `:` is what tells them apart.
    expect(marketplaceRouteFromSegments(['servers', 'smithery:foo'])).toEqual({
      page: 'servers',
    });
  });

  it('does not accept a source filed under the other kind', () => {
    // `community` is a skill source, so under `servers` it can only be a
    // (not-found) server ref — the installed list, not a source page.
    expect(marketplaceRouteFromSegments(['servers', 'community'])).toEqual({
      page: 'servers',
    });
    expect(marketplaceRouteFromSegments(['skills', 'smithery'])).toEqual({
      page: 'skills',
    });
  });
});

describe('marketplaceRouteFromSegments — unknown is null (→ overview)', () => {
  it('returns null for no segments', () => {
    expect(marketplaceRouteFromSegments([])).toBeNull();
  });

  it.each(RETIRED_IDS)('returns null for the retired id %s', (id) => {
    expect(marketplaceRouteFromSegments([id])).toBeNull();
  });

  it('parses the retired tile ids that are now live page names as those pages', () => {
    // `connectors` was a retired tile id and `skills` a section id; both are
    // pages of the routed tree now. Only a URL reaches this parser — the old
    // stored strings are never fed to it — so this is the live page, not a
    // resurrected legacy value.
    expect(marketplaceRouteFromSegments(['connectors'])).toEqual({
      page: 'connectors',
    });
    expect(marketplaceRouteFromSegments(['skills'])).toEqual({
      page: 'skills',
    });
  });

  it.each([
    [['Overview']],
    [['nonsense']],
    [['']],
    [['servers', '']],
    [['', 'servers']],
    [['servers', 'smithery', 'extra']],
    [['overview', 'claude-user:sentry', 'extra']],
    [['apps:smithery']],
    [['skills:ptah-plugins']],
  ])('returns null for %j', (segments) => {
    expect(marketplaceRouteFromSegments(segments)).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    for (const segments of [[], [''], [':'], ['::'], new Array(50).fill('x')]) {
      expect(() => marketplaceRouteFromSegments(segments)).not.toThrow();
    }
  });
});
