/**
 * Pure rules of the Connectors pages (plan C9): the filter, where an action
 * error renders, the detail frame, the hero tiles and the setup steps.
 *
 * The card state itself (pill, actions, locks) is shared with the featured
 * row and lives in `ui/connector-card-state.ts` (`connectorCardState`).
 */

import {
  PTAH_CONNECTOR_CATEGORIES,
  ptahConnectorCategoryLabel,
  type PtahConnector,
  type PtahConnectorCategory,
} from '@ptah-extension/shared';

import type {
  ConnectorLink,
  ConnectorLinksState,
} from '../../data/connector-links.store';
import type { MarketplaceTier } from '../../layout/marketplace-layout';
import type { ConnectorActionErrorView } from '../../ui/featured-connectors.component';
import type {
  StackTileState,
  StorefrontStackTile,
} from '../../ui/storefront-hero.component';

/** The route parameter of `connectors/:connectorId` (bound to the detail input). */
export const CONNECTOR_ID_PARAM = 'connectorId';

/** The hero tile of detected CLIs; its Retry re-reads harness health. */
export const CLI_TILE_ID = 'clis';

/** Where the connector detail renders: a drawer, or the whole page at wide. */
export type ConnectorDetailPlacement = 'drawer' | 'page';

/** Overlay drawer at compact and regular, a full page at wide (plan C9). */
export function connectorDetailPlacement(
  tier: MarketplaceTier,
): ConnectorDetailPlacement {
  return tier === 'wide' ? 'page' : 'drawer';
}

/**
 * The `?category=` value as a category, or `null` (the "All" filter) for a
 * missing, blank or unknown value — a hand-edited URL never filters the grid
 * down to nothing.
 */
export function parseConnectorCategory(
  raw: string | null | undefined,
): PtahConnectorCategory | null {
  const value = raw?.trim() ?? '';
  return (
    PTAH_CONNECTOR_CATEGORIES.find((category) => category === value) ?? null
  );
}

/** The categories the catalogue actually uses, in `PTAH_CONNECTOR_CATEGORIES` order. */
export function usedConnectorCategories(
  connectors: readonly PtahConnector[],
): PtahConnectorCategory[] {
  const used = new Set(connectors.map((connector) => connector.category));
  return PTAH_CONNECTOR_CATEGORIES.filter((category) => used.has(category));
}

/**
 * The catalogue after the search box and the category filter, in catalogue
 * order. The query matches the label, the description, the id and the
 * category label, case-insensitively; a blank query matches everything.
 */
export function filterConnectors(
  connectors: readonly PtahConnector[],
  query: string,
  category: PtahConnectorCategory | null,
): PtahConnector[] {
  const needle = query.trim().toLowerCase();
  return connectors.filter((connector) => {
    if (category !== null && connector.category !== category) return false;
    if (needle.length === 0) return true;
    return [
      connector.label,
      connector.description,
      connector.id,
      ptahConnectorCategoryLabel(connector.category),
    ].some((text) => text.toLowerCase().includes(needle));
  });
}

/** Where an action was started from. */
export type ConnectorActionOrigin = 'featured' | 'grid' | 'detail';

/** A failed action, pinned to its connector and the place it was pressed. */
export interface TrackedActionError extends ConnectorActionErrorView {
  readonly origin: ConnectorActionOrigin;
}

/** Where an action error is drawn; exactly one place per error. */
export type ActionErrorPlacement = 'featured' | 'grid' | 'detail' | 'page';

/** What is on screen, for {@link placeActionError}. */
export interface ActionErrorSurfaces {
  /** Connector ids of the featured cards on screen (empty when not shown). */
  readonly featuredIds: ReadonlySet<string>;
  /** Connector ids of the grid cards on screen (empty when not shown). */
  readonly gridIds: ReadonlySet<string>;
  /** The connector the open detail shows, or null. */
  readonly detailId: string | null;
}

/**
 * Pick the one place an action error renders, so it is announced once:
 * the open detail of that connector first; then the card it was pressed on;
 * then any card of that connector on screen; otherwise a page-level alert
 * (the connector left the featured row, or a search filtered it out — the
 * Batch 11 follow-up).
 */
export function placeActionError(
  error: TrackedActionError,
  surfaces: ActionErrorSurfaces,
): ActionErrorPlacement {
  const id = error.connectorId;
  if (surfaces.detailId === id) return 'detail';
  if (error.origin === 'featured' && surfaces.featuredIds.has(id)) {
    return 'featured';
  }
  if (surfaces.gridIds.has(id)) return 'grid';
  if (surfaces.featuredIds.has(id)) return 'featured';
  return 'page';
}

/** The detected-CLI count for the hero, from the harness health store. */
export interface CliTileInput {
  readonly state: StackTileState;
  readonly count: number | null;
}

/**
 * The hero's "Your stack" tiles on the Connectors page: connected apps and
 * apps that need sign-in (links store), the catalogue size, and the CLIs
 * the harness detected (with its own error state and Retry).
 */
export function connectorStackTiles(
  state: ConnectorLinksState,
  links: ReadonlyMap<string, ConnectorLink>,
  catalogueSize: number,
  clis: CliTileInput,
): StorefrontStackTile[] {
  const tileState =
    state === 'ready' ? 'ready' : state === 'error' ? 'error' : 'loading';
  let connected = 0;
  let needsSignIn = 0;
  for (const link of links.values()) {
    if (link.status === 'connected') connected += 1;
    else if (link.status === 'needs-auth' || link.status === 'error') {
      needsSignIn += 1;
    }
  }
  return [
    { id: 'connected', label: 'Connected', state: tileState, count: connected },
    {
      id: 'needs-sign-in',
      label: 'Need sign-in',
      state: tileState,
      count: needsSignIn,
    },
    {
      id: 'catalogue',
      label: 'In the catalogue',
      state: 'ready',
      count: catalogueSize,
    },
    {
      id: CLI_TILE_ID,
      label: 'CLIs detected',
      state: clis.state,
      count: clis.count,
    },
  ];
}

/** Said in a setup step when the host has no interactive redirect URL. */
export const REDIRECT_URL_FALLBACK = 'the redirect URL shown in the form below';

/**
 * An `oauth-app` connector's provider steps with `{redirectUrl}` replaced by
 * the host's real redirect URL, or a pointer to the form when it is unknown.
 */
export function connectorSetupSteps(
  connector: PtahConnector,
  redirectUrl: string | null,
): string[] {
  if (connector.kind !== 'oauth-app') return [];
  const url = redirectUrl?.trim() ?? '';
  const replacement = url.length > 0 ? url : REDIRECT_URL_FALLBACK;
  return (connector.setupSteps ?? []).map((step) =>
    step.replaceAll('{redirectUrl}', replacement),
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** An ISO date or timestamp as "Sep 4, 2026"; an unparseable value is shown as given. */
export function formatConnectorDate(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : DATE_FORMAT.format(time);
}

/** Only an `http(s)` documentation link is rendered as a link. */
export function safeDocsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    // degradation-audit: not an absolute URL — the fact is simply omitted.
    return null;
  }
}

/**
 * True when a keystroke belongs to a field the user is typing into, so the
 * page's Esc and arrow keys leave it alone.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  const editable = target.closest('[contenteditable]');
  return (
    editable !== null && editable.getAttribute('contenteditable') !== 'false'
  );
}
