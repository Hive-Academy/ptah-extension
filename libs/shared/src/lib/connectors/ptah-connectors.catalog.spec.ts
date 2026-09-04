import {
  PTAH_CONNECTORS,
  PTAH_CONNECTOR_CATEGORIES,
  ptahConnectorCategoryLabel,
  ptahConnectorKindHint,
  type PtahConnector,
  type PtahConnectorCategory,
  type PtahConnectorKind,
} from './ptah-connectors.catalog';

/**
 * Shape validation for the curated connectors catalog.
 *
 * These cases cannot prove a URL still answers — that is the live probe's job
 * (`ptah-connectors-catalog.live.spec.ts` in `cli-agent-runtime`). What they DO
 * prove is that a hand-edited entry cannot reach the Connectors surface in a
 * state the surface has no branch for: a duplicate id, a category with no chip,
 * an `oauth-*` entry with nothing to connect to, or a `smithery` entry with no
 * server to install.
 */
describe('PTAH_CONNECTORS', () => {
  const ALL_KINDS: readonly PtahConnectorKind[] = [
    'oauth-dcr',
    'oauth-app',
    'smithery',
  ];

  it('is not empty', () => {
    expect(PTAH_CONNECTORS.length).toBeGreaterThan(0);
  });

  it('has a unique id for every entry', () => {
    const ids = PTAH_CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case ids', () => {
    for (const connector of PTAH_CONNECTORS) {
      expect(connector.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('gives every entry a non-empty label and a one-sentence description', () => {
    for (const connector of PTAH_CONNECTORS) {
      expect(connector.label.trim().length).toBeGreaterThan(0);
      expect(connector.description.trim().length).toBeGreaterThan(0);
      // One sentence: at most one terminating period, at the very end.
      expect(connector.description.trim().endsWith('.')).toBe(true);
    }
  });

  it('only uses categories that have a chip', () => {
    const known = new Set<PtahConnectorCategory>(PTAH_CONNECTOR_CATEGORIES);
    for (const connector of PTAH_CONNECTORS) {
      expect(known.has(connector.category)).toBe(true);
    }
  });

  it('only uses the three known kinds', () => {
    for (const connector of PTAH_CONNECTORS) {
      expect(ALL_KINDS).toContain(connector.kind);
    }
  });

  it('gives every oauth-* entry an absolute https URL', () => {
    const oauth = PTAH_CONNECTORS.filter((c) => c.kind.startsWith('oauth-'));
    expect(oauth.length).toBeGreaterThan(0);
    for (const connector of oauth) {
      expect(typeof connector.url).toBe('string');
      expect(new URL(connector.url as string).protocol).toBe('https:');
    }
  });

  it('never gives an oauth-* entry a smitheryQualifiedName', () => {
    for (const connector of PTAH_CONNECTORS) {
      if (connector.kind.startsWith('oauth-')) {
        expect(connector.smitheryQualifiedName).toBeUndefined();
      }
    }
  });

  it('gives every smithery entry a qualified name and no URL', () => {
    const smithery = PTAH_CONNECTORS.filter((c) => c.kind === 'smithery');
    expect(smithery.length).toBeGreaterThan(0);
    for (const connector of smithery) {
      expect(
        connector.smitheryQualifiedName?.trim().length ?? 0,
      ).toBeGreaterThan(0);
      // The Connections API accepts `@scope/name` or a bare name only.
      expect(connector.smitheryQualifiedName as string).toMatch(
        /^@?[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)?$/,
      );
      expect(connector.url).toBeUndefined();
    }
  });

  it('never lists the same MCP server URL twice', () => {
    const urls = PTAH_CONNECTORS.map((c) => c.url).filter(
      (u): u is string => u !== undefined,
    );
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('never lists the same Smithery qualified name twice', () => {
    const names = PTAH_CONNECTORS.map((c) => c.smitheryQualifiedName).filter(
      (n): n is string => n !== undefined,
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('records verifiedAt as an ISO date that is a real day', () => {
    for (const connector of PTAH_CONNECTORS) {
      expect(connector.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        Number.isNaN(new Date(`${connector.verifiedAt}T00:00:00Z`).getTime()),
      ).toBe(false);
    }
  });

  it('gives every docsUrl, when present, an absolute https URL', () => {
    for (const connector of PTAH_CONNECTORS) {
      if (connector.docsUrl !== undefined) {
        expect(new URL(connector.docsUrl).protocol).toBe('https:');
      }
    }
  });

  it('excludes the candidates the live probe rejected', () => {
    // Cloudflare's docs server needs no authorization, so OAuth discovery finds
    // nothing. It belongs on the MCP Registry surface, not in this catalog.
    const urls = PTAH_CONNECTORS.map((c) => c.url ?? '');
    expect(urls).not.toContain('https://docs.mcp.cloudflare.com/mcp');
  });

  // ── setupSteps and scopes (TASK_2026_379 C1.5) ────────────────────────────

  it('gives every oauth-app entry a non-empty setupSteps list', () => {
    const apps = PTAH_CONNECTORS.filter((c) => c.kind === 'oauth-app');
    expect(apps.length).toBeGreaterThan(0);
    for (const connector of apps) {
      expect(Array.isArray(connector.setupSteps)).toBe(true);
      expect(connector.setupSteps?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('writes every setup step as a non-empty imperative sentence', () => {
    for (const connector of PTAH_CONNECTORS) {
      for (const step of connector.setupSteps ?? []) {
        expect(step.trim().length).toBeGreaterThan(0);
        expect(step.trim().endsWith('.')).toBe(true);
      }
    }
  });

  it('names {redirectUrl} in at least one step of every setupSteps list', () => {
    for (const connector of PTAH_CONNECTORS) {
      if (connector.setupSteps === undefined) {
        continue;
      }
      const named = connector.setupSteps.filter((step) =>
        step.includes('{redirectUrl}'),
      );
      expect(named.length).toBeGreaterThan(0);
    }
  });

  it('never gives an oauth-dcr or smithery entry setupSteps', () => {
    for (const connector of PTAH_CONNECTORS) {
      if (connector.kind !== 'oauth-app') {
        expect(connector.setupSteps).toBeUndefined();
      }
    }
  });

  it('gives scopes, when present, non-empty strings in a non-empty array', () => {
    const scoped = PTAH_CONNECTORS.filter((c) => c.scopes !== undefined);
    expect(scoped.length).toBeGreaterThan(0);
    for (const connector of scoped) {
      expect(Array.isArray(connector.scopes)).toBe(true);
      expect(connector.scopes?.length ?? 0).toBeGreaterThan(0);
      for (const scope of connector.scopes ?? []) {
        expect(typeof scope).toBe('string');
        expect(scope.trim().length).toBeGreaterThan(0);
        expect(scope).toBe(scope.trim());
      }
    }
  });

  it('never repeats a scope inside one entry', () => {
    for (const connector of PTAH_CONNECTORS) {
      const scopes = connector.scopes ?? [];
      expect(new Set(scopes).size).toBe(scopes.length);
    }
  });

  it('holds back the three services whose docs restrict custom clients', () => {
    // Square, Ahrefs and Semrush answer the metadata probe, but their
    // documentation restricts custom OAuth clients (TASK_2026_378 section 4).
    // They ship only after somebody connects each one once by hand.
    const heldBackIds = ['square', 'ahrefs', 'semrush'];
    const ids = PTAH_CONNECTORS.map((c) => c.id);
    for (const heldBack of heldBackIds) {
      expect(ids).not.toContain(heldBack);
    }
    const heldBackUrls = [
      'https://mcp.squareup.com/sse',
      'https://mcp.squareup.com/mcp',
      'https://api.ahrefs.com/mcp/mcp',
      'https://mcp.semrush.com/v2/mcp',
    ];
    const urls = PTAH_CONNECTORS.map((c) => c.url ?? '');
    for (const heldBackUrl of heldBackUrls) {
      expect(urls).not.toContain(heldBackUrl);
    }
  });
});

describe('ptahConnectorCategoryLabel', () => {
  it('returns a non-empty label for every category', () => {
    for (const category of PTAH_CONNECTOR_CATEGORIES) {
      expect(
        ptahConnectorCategoryLabel(category).trim().length,
      ).toBeGreaterThan(0);
    }
  });

  it('returns a distinct label per category', () => {
    const labels = PTAH_CONNECTOR_CATEGORIES.map(ptahConnectorCategoryLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('ptahConnectorKindHint', () => {
  it.each<[PtahConnectorKind, string]>([
    ['oauth-dcr', 'Signs in with your browser'],
    ['oauth-app', 'Needs an app you create with the provider'],
    ['smithery', 'Managed by Smithery'],
  ])('describes %s as "%s"', (kind, expected) => {
    expect(ptahConnectorKindHint(kind)).toBe(expected);
  });

  it('has a hint for every kind used in the catalog', () => {
    for (const connector of PTAH_CONNECTORS as readonly PtahConnector[]) {
      expect(ptahConnectorKindHint(connector.kind).length).toBeGreaterThan(0);
    }
  });
});
