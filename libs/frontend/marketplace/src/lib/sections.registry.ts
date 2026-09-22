import {
  Blocks,
  KeyRound,
  Plug,
  Puzzle,
  Server,
  Sparkles,
  Store,
  type LucideIconData,
} from 'lucide-angular';
import type {
  MarketplaceSection,
  MarketplaceSourceId,
} from '@ptah-extension/core';

/**
 * The Marketplace section registry (TASK_2026_524).
 *
 * Replaces the seven-tile `MARKETPLACE_PROVIDERS` registry with three sections,
 * each owning a strip of source chips. Deliberately carries NO `surface` ref:
 * each of the three sections needs bespoke child bindings (`connectorServers`,
 * `serverInstalled`, `skillInstalled`, `saved`), which a generic
 * `NgComponentOutlet` mount cannot express — the old registry's `surface` field
 * was already bypassed by hand-wiring for three of six entries.
 *
 * The id unions come from `@ptah-extension/core` so that `chat` can deep-link
 * into a section without importing this library.
 */

/** One source chip inside a section. */
export interface MarketplaceSourceSpec {
  readonly id: MarketplaceSourceId;
  readonly label: string;
  readonly icon: LucideIconData;
}

/** One section of the Marketplace hub. */
export interface MarketplaceSectionSpec {
  readonly id: MarketplaceSection;
  readonly label: string;
  readonly icon: LucideIconData;
  /** Empty for `connected`, which aggregates every source and has no chips. */
  readonly sources: readonly MarketplaceSourceSpec[];
}

/** The three sections, in the order the tab strip renders them. */
export const MARKETPLACE_SECTIONS: readonly MarketplaceSectionSpec[] = [
  {
    id: 'connected',
    label: 'Connected',
    icon: Store,
    sources: [],
  },
  {
    id: 'apps',
    label: 'Apps',
    icon: Plug,
    sources: [
      { id: 'connectors', label: 'Connectors', icon: Plug },
      { id: 'smithery', label: 'Smithery', icon: Blocks },
      { id: 'mcp-registry', label: 'MCP Registry', icon: Server },
      { id: 'custom-url', label: 'Custom URL', icon: KeyRound },
    ],
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: Sparkles,
    sources: [
      { id: 'ptah-plugins', label: 'Ptah Plugins', icon: Puzzle },
      { id: 'community', label: 'Community', icon: Sparkles },
      { id: 'marketplaces', label: 'Marketplaces', icon: Blocks },
    ],
  },
];

/**
 * The chips belonging to one section, or `[]` for a section with none.
 *
 * Total: an id that is not in the registry yields `[]` rather than throwing, so
 * a stale persisted section can only ever cost the chip strip, never the view.
 */
export function marketplaceSourcesOf(
  section: MarketplaceSection,
): readonly MarketplaceSourceSpec[] {
  return MARKETPLACE_SECTIONS.find((s) => s.id === section)?.sources ?? [];
}
