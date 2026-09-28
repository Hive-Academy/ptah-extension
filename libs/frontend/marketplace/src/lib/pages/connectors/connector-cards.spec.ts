import {
  PTAH_CONNECTORS,
  PTAH_CONNECTOR_CATEGORIES,
  type PtahConnector,
} from '@ptah-extension/shared';

import type { ConnectorLink } from '../../data/connector-links.store';
import {
  CLI_TILE_ID,
  REDIRECT_URL_FALLBACK,
  connectorDetailPlacement,
  connectorSetupSteps,
  connectorStackTiles,
  filterConnectors,
  formatConnectorDate,
  isTypingTarget,
  parseConnectorCategory,
  placeActionError,
  safeDocsUrl,
  usedConnectorCategories,
  type TrackedActionError,
} from './connector-cards';

function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY = connectorById('sentry'); // oauth-dcr, devops
const GITHUB = connectorById('github'); // oauth-app
const HUBSPOT_SMITHERY = connectorById('hubspot-smithery'); // smithery

describe('connector cards (page rules)', () => {
  describe('connectorDetailPlacement', () => {
    it.each([
      ['compact', 'drawer'],
      ['regular', 'drawer'],
      ['wide', 'page'],
    ] as const)('%s â†’ %s', (tier, placement) => {
      expect(connectorDetailPlacement(tier)).toBe(placement);
    });
  });

  describe('parseConnectorCategory', () => {
    it('accepts every catalogue category', () => {
      for (const category of PTAH_CONNECTOR_CATEGORIES) {
        expect(parseConnectorCategory(category)).toBe(category);
      }
    });

    it.each([null, undefined, '', '   ', 'nope', 'CODE'])(
      'treats %p as "All"',
      (raw) => {
        expect(parseConnectorCategory(raw)).toBeNull();
      },
    );
  });

  describe('usedConnectorCategories', () => {
    it('lists only the categories in use, in catalogue category order', () => {
      const used = usedConnectorCategories([HUBSPOT_SMITHERY, SENTRY]);
      const order = PTAH_CONNECTOR_CATEGORIES.filter((c) =>
        [HUBSPOT_SMITHERY.category, SENTRY.category].includes(c),
      );
      expect(used).toEqual(order);
    });
  });

  describe('filterConnectors', () => {
    it('returns the whole catalogue for a blank query and no category', () => {
      expect(filterConnectors(PTAH_CONNECTORS, '  ', null)).toEqual([
        ...PTAH_CONNECTORS,
      ]);
    });

    it('matches label, description and id case-insensitively', () => {
      expect(filterConnectors(PTAH_CONNECTORS, 'SENTRY', null)).toContain(
        SENTRY,
      );
      expect(
        filterConnectors(PTAH_CONNECTORS, 'issues, events and releases', null),
      ).toEqual([SENTRY]);
    });

    it('matches the category label', () => {
      const devops = filterConnectors(PTAH_CONNECTORS, 'devops', null);
      expect(devops).toContain(SENTRY);
    });

    it('applies the category before the query and keeps catalogue order', () => {
      const result = filterConnectors(PTAH_CONNECTORS, '', 'devops');
      expect(result.every((c) => c.category === 'devops')).toBe(true);
      expect(result).toEqual(
        PTAH_CONNECTORS.filter((c) => c.category === 'devops'),
      );
    });

    it('returns nothing for a query nothing matches', () => {
      expect(filterConnectors(PTAH_CONNECTORS, 'zzz-no-match', null)).toEqual(
        [],
      );
    });
  });

  describe('placeActionError', () => {
    const error = (
      origin: TrackedActionError['origin'],
      connectorId = 'sentry',
    ): TrackedActionError => ({ connectorId, message: 'boom', origin });
    const surfaces = (
      featured: string[],
      grid: string[],
      detailId: string | null = null,
    ) => ({
      featuredIds: new Set(featured),
      gridIds: new Set(grid),
      detailId,
    });

    it('prefers the open detail of that connector', () => {
      expect(
        placeActionError(
          error('grid'),
          surfaces(['sentry'], ['sentry'], 'sentry'),
        ),
      ).toBe('detail');
    });

    it('stays on the featured card it was pressed on', () => {
      expect(
        placeActionError(error('featured'), surfaces(['sentry'], ['sentry'])),
      ).toBe('featured');
    });

    it('stays on the grid card it was pressed on', () => {
      expect(
        placeActionError(error('grid'), surfaces(['sentry'], ['sentry'])),
      ).toBe('grid');
    });

    it('moves to the grid when the connector left the featured row', () => {
      expect(
        placeActionError(error('featured'), surfaces([], ['sentry'])),
      ).toBe('grid');
    });

    it('moves to the featured card when the grid filtered it out', () => {
      expect(placeActionError(error('grid'), surfaces(['sentry'], []))).toBe(
        'featured',
      );
    });

    it('falls back to the page when no card of it is on screen', () => {
      expect(placeActionError(error('featured'), surfaces([], []))).toBe(
        'page',
      );
      expect(
        placeActionError(error('detail'), surfaces([], [], 'linear')),
      ).toBe('page');
    });
  });

  describe('connectorStackTiles', () => {
    const links = new Map<string, ConnectorLink>([
      ['a', { status: 'connected' }],
      ['b', { status: 'connected' }],
      ['c', { status: 'needs-auth' }],
      ['d', { status: 'error' }],
      ['e', { status: 'not-connected' }],
    ]);

    it('counts connected and need-sign-in links from real data', () => {
      const tiles = connectorStackTiles('ready', links, 40, {
        state: 'ready',
        count: 3,
      });
      expect(tiles.map((t) => [t.id, t.state, t.count])).toEqual([
        ['connected', 'ready', 2],
        ['needs-sign-in', 'ready', 2],
        ['catalogue', 'ready', 40],
        [CLI_TILE_ID, 'ready', 3],
      ]);
    });

    it.each([
      ['idle', 'loading'],
      ['loading', 'loading'],
      ['error', 'error'],
    ] as const)('maps store state %s to tile state %s', (state, tile) => {
      const tiles = connectorStackTiles(state, links, 40, {
        state: 'ready',
        count: 0,
      });
      expect(tiles[0].state).toBe(tile);
      expect(tiles[1].state).toBe(tile);
      expect(tiles[2].state).toBe('ready');
    });

    it('carries the CLI tile state through on its own (harness failure)', () => {
      const tiles = connectorStackTiles('ready', links, 40, {
        state: 'error',
        count: null,
      });
      expect(tiles[3]).toEqual(
        expect.objectContaining({ id: CLI_TILE_ID, state: 'error' }),
      );
      expect(tiles[0].state).toBe('ready');
    });
  });

  describe('connectorSetupSteps', () => {
    it('replaces every {redirectUrl} with the host URL', () => {
      const steps = connectorSetupSteps(GITHUB, 'https://host/callback');
      expect(steps.length).toBe(GITHUB.setupSteps?.length);
      expect(steps.join('\n')).not.toContain('{redirectUrl}');
      expect(steps.join('\n')).toContain('https://host/callback');
    });

    it('points at the form when the host has no redirect URL', () => {
      const steps = connectorSetupSteps(GITHUB, null);
      expect(steps.join('\n')).toContain(REDIRECT_URL_FALLBACK);
    });

    it('is empty for kinds without provider setup', () => {
      expect(connectorSetupSteps(SENTRY, 'https://host/callback')).toEqual([]);
    });
  });

  describe('formatConnectorDate and safeDocsUrl', () => {
    it('formats an ISO date in UTC and keeps an unparseable value', () => {
      expect(formatConnectorDate('2026-09-04')).toBe('Sep 4, 2026');
      expect(formatConnectorDate('not a date')).toBe('not a date');
    });

    it('keeps only http(s) documentation links', () => {
      expect(safeDocsUrl('https://docs.example/x')).toBe(
        'https://docs.example/x',
      );
      expect(safeDocsUrl('javascript:alert(1)')).toBeNull();
      expect(safeDocsUrl('relative/path')).toBeNull();
      expect(safeDocsUrl(undefined)).toBeNull();
    });
  });

  describe('isTypingTarget', () => {
    it('is true for fields and contenteditable content, false otherwise', () => {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      editable.appendChild(child);

      expect(isTypingTarget(document.createElement('input'))).toBe(true);
      expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
      expect(isTypingTarget(document.createElement('select'))).toBe(true);
      expect(isTypingTarget(child)).toBe(true);
      expect(isTypingTarget(document.createElement('button'))).toBe(false);
      expect(isTypingTarget(null)).toBe(false);
    });
  });
});
