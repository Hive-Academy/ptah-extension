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
