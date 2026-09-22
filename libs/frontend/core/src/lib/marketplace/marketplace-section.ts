/**
 * The grammar of the `marketplaceActiveProvider` storage field.
 *
 * ## Why this lives in `core` (TASK_2026_524)
 *
 * The Marketplace hub collapses seven drill-in tiles into three sections. The
 * selection is persisted through `AppStateManager.marketplaceActiveProvider`
 * (`app-state.service.ts:390-391,676-680`), and the callers that deep-link into
 * a section — `McpStatusChipComponent` in `chat`, `ChatEmptyStateComponent` in
 * `chat`, `MarketplaceStateService` in `marketplace` — sit in libraries that
 * cannot import each other. `core` is the one library all three already depend
 * on, so the encode/parse pair lives here rather than being re-derived three
 * times from a string literal.
 *
 * Nothing here is Angular: no decorator, no injection, no signal. It is a pure
 * module so that the parsing rule can be tested without a TestBed, and so that
 * `AppStateManager` stays the owner of the storage while this stays the owner
 * of the *meaning* of what is stored.
 */

/** The three sections the hub can show. `connected` is the default. */
export type MarketplaceSection = 'connected' | 'apps' | 'skills';

/** A source chip inside a section. Not persisted — deep links only. */
export type MarketplaceSourceId =
  | 'connectors'
  | 'smithery'
  | 'mcp-registry'
  | 'custom-url'
  | 'ptah-plugins'
  | 'community'
  | 'marketplaces';

/**
 * Every section id, in the order the segmented control renders them.
 *
 * The first entry is also the fallback for anything unparsable, so the two can
 * never disagree.
 */
export const MARKETPLACE_SECTION_IDS = [
  'connected',
  'apps',
  'skills',
] as const satisfies readonly MarketplaceSection[];

/**
 * Which chips belong to which section.
 *
 * Exhaustive over {@link MarketplaceSourceId} by construction: the `satisfies`
 * clause makes a chip id with no union member — and a union member filed under
 * no section — a compile error rather than a chip that silently never matches.
 */
const SECTION_SOURCES = {
  // The Connected view aggregates every source; it has no chips of its own.
  connected: [],
  apps: ['connectors', 'smithery', 'mcp-registry', 'custom-url'],
  skills: ['ptah-plugins', 'community', 'marketplaces'],
} as const satisfies Record<MarketplaceSection, readonly MarketplaceSourceId[]>;

/** The chips that are legal inside one section, as a type. */
type SourceOf<S extends MarketplaceSection> =
  (typeof SECTION_SOURCES)[S][number];

/** A parsed deep-link target. `source` is `null` when none was named. */
export interface MarketplaceTarget {
  section: MarketplaceSection;
  source: MarketplaceSourceId | null;
}

const DEFAULT_TARGET: MarketplaceTarget = {
  section: 'connected',
  source: null,
};

const SEPARATOR = ':';

/**
 * Encode a section, optionally with a source chip, as a storable string.
 *
 * `encodeMarketplaceTarget('apps')` → `'apps'`;
 * `encodeMarketplaceTarget('apps', 'smithery')` → `'apps:smithery'`.
 *
 * Strict on a literal section: `encodeMarketplaceTarget('apps', 'community')`
 * does not compile, because `community` is a Skills chip. When the section is
 * only known as the widened union the check cannot fire, so the source is also
 * dropped at RUNTIME if it does not belong — the alternative is emitting a
 * string that {@link parseMarketplaceTarget} would decode back without the
 * source, which is the same outcome reached less obviously.
 */
export function encodeMarketplaceTarget<S extends MarketplaceSection>(
  section: S,
  source?: SourceOf<S> | null,
): string {
  if (source === undefined || source === null) return section;
  return belongsTo(section, source)
    ? `${section}${SEPARATOR}${source}`
    : section;
}

/**
 * Decode whatever was persisted or passed in. Total — never throws.
 *
 * Everything that is not a live section id degrades to
 * `{ section: 'connected', source: null }`: `null`, the empty string, and each
 * of the seven retired provider ids (`connectors`, `plugins`, `official-mcp`,
 * `skills-sh`, `smithery`, `oauth-mcp`, `composio`) that a previous release
 * left in storage. That degradation is AC5 — an old persisted id must open the
 * Connected section, not a blank page.
 *
 * A live section with an unknown source, an empty source, or a source that
 * belongs to a DIFFERENT section keeps the section and drops the source, so a
 * stale chip in a link never costs the user the section they asked for.
 */
export function parseMarketplaceTarget(raw: string | null): MarketplaceTarget {
  if (raw === null) return { ...DEFAULT_TARGET };

  const separatorAt = raw.indexOf(SEPARATOR);
  const sectionPart = (
    separatorAt === -1 ? raw : raw.slice(0, separatorAt)
  ).trim();
  if (!isMarketplaceSection(sectionPart)) return { ...DEFAULT_TARGET };

  if (separatorAt === -1) return { section: sectionPart, source: null };

  const sourcePart = raw.slice(separatorAt + SEPARATOR.length).trim();
  return {
    section: sectionPart,
    source: belongsTo(sectionPart, sourcePart) ? sourcePart : null,
  };
}

function isMarketplaceSection(value: string): value is MarketplaceSection {
  return (MARKETPLACE_SECTION_IDS as readonly string[]).includes(value);
}

function belongsTo(
  section: MarketplaceSection,
  source: string,
): source is MarketplaceSourceId {
  return (SECTION_SOURCES[section] as readonly string[]).includes(source);
}
