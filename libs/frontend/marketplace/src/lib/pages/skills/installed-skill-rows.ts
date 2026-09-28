/**
 * View model of the installed-skills page (plan C9 `InstalledSkillsPage`) and
 * the lookup its detail route uses (`SkillDetail`).
 *
 * Pure: the three inventory slices go in, three grouped lists come out. The
 * page and the detail share this file so a row's ref, name and removal target
 * are derived once — the detail can never describe a different item than the
 * row the user opened.
 */

import {
  GraduationCap,
  Package,
  Puzzle,
  type LucideIconData,
} from 'lucide-angular';
import type { MarketplaceSkillSource } from '@ptah-extension/core';
import type {
  ExternalPluginListing,
  InstalledSkill,
  PluginInfo,
  PluginSource,
} from '@ptah-extension/shared';
import type {
  InventorySlice,
  InventorySliceId,
  InventorySliceState,
} from '../../data/marketplace-inventory.store';
import {
  encodeSkillRef,
  type MarketplaceSkillKind,
  type SkillRef,
} from '../../data/skill-ref';

/** The three grouped lists, in display order. */
export type InstalledSkillGroupId = Exclude<InventorySliceId, 'installed'>;

/** What a row's trailing action does. */
export type InstalledSkillAction = 'manage' | 'uninstall';

/** One installed skill, plugin or marketplace plugin. */
export interface InstalledSkillRow {
  /** The encoded `:skillRef`, also the removal id the store uses. */
  readonly ref: string;
  readonly kind: MarketplaceSkillKind;
  readonly id: string;
  readonly name: string;
  /** `null` when the source declares none. */
  readonly description: string | null;
  /** Where it came from: a Ptah plugin source label or an `owner/repo`. */
  readonly source: string;
  /** Installed (or advertised) version; `null` when none is declared. */
  readonly version: string | null;
  /** A short fact line (plugin skill and command counts), or `null`. */
  readonly detail: string | null;
  /** Ptah plugins are managed on their source page; the rest uninstall here. */
  readonly action: InstalledSkillAction;
}

/** One grouped list with its OWN load state (per-slice failure isolation). */
export interface InstalledSkillGroup {
  readonly id: InstalledSkillGroupId;
  readonly label: string;
  readonly state: InventorySliceState;
  /** The load failure, only in the `error` state. */
  readonly error: string | null;
  /** An inline removal failure; the rows stay. */
  readonly actionError: string | null;
  /** Rows after the search filter. */
  readonly rows: readonly InstalledSkillRow[];
  /** Rows before the search filter, so "no match" and "none" differ. */
  readonly total: number;
  /** The source page the empty state and "Browse" link lead to. */
  readonly browse: {
    readonly label: string;
    readonly source: MarketplaceSkillSource;
  };
}

/** The slices the page renders. */
export interface InstalledSkillSlices {
  readonly plugins: InventorySlice<PluginInfo>;
  readonly community: InventorySlice<InstalledSkill>;
  readonly marketplaces: InventorySlice<ExternalPluginListing>;
}

/** An installed item resolved from a `:skillRef`, with its raw record. */
export type InstalledSkillMatch =
  | {
      readonly kind: 'ptah-plugin';
      readonly row: InstalledSkillRow;
      readonly plugin: PluginInfo;
    }
  | {
      readonly kind: 'community-skill';
      readonly row: InstalledSkillRow;
      readonly skill: InstalledSkill;
    }
  | {
      readonly kind: 'marketplace-plugin';
      readonly row: InstalledSkillRow;
      readonly listing: ExternalPluginListing;
    };

/** The slice each kind is read from. */
export const SKILL_KIND_SLICE: Readonly<
  Record<MarketplaceSkillKind, InstalledSkillGroupId>
> = {
  'ptah-plugin': 'plugins',
  'community-skill': 'community',
  'marketplace-plugin': 'marketplaces',
};

/** Human name of each kind, for detail facts and aria labels. */
export const SKILL_KIND_LABELS: Readonly<Record<MarketplaceSkillKind, string>> =
  {
    'ptah-plugin': 'Ptah plugin',
    'community-skill': 'Community skill',
    'marketplace-plugin': 'Marketplace plugin',
  };

/** The tile icon of each kind, shared by the list rows and the detail. */
export const SKILL_KIND_ICONS: Readonly<
  Record<MarketplaceSkillKind, LucideIconData>
> = {
  'ptah-plugin': Puzzle,
  'community-skill': GraduationCap,
  'marketplace-plugin': Package,
};

const GROUP_META:Readonly<
  Record<
    InstalledSkillGroupId,
    Pick<InstalledSkillGroup, 'label' | 'browse'>
  >
> = {
  plugins: {
    label: 'Ptah plugins',
    browse: { label: 'Browse Ptah plugins', source: 'ptah-plugins' },
  },
  community: {
    label: 'Community skills',
    browse: { label: 'Browse community skills', source: 'community' },
  },
  marketplaces: {
    label: 'Marketplace plugins',
    browse: { label: 'Add a marketplace', source: 'marketplaces' },
  },
};

/** Where a Ptah plugin comes from. Absent on legacy payloads → bundled. */
const PLUGIN_SOURCE_LABELS: Readonly<Record<PluginSource, string>> = {
  bundled: 'Ptah',
  harness: 'Your harness',
  external: 'External marketplace',
  skillssh: 'skills.sh',
};

export function pluginSourceLabel(source: PluginSource | undefined): string {
  return PLUGIN_SOURCE_LABELS[source ?? 'bundled'] ?? String(source);
}

/** `1 skill`, `3 skills`. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function textOrNull(value: string | undefined | null): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}

function refOf(kind: MarketplaceSkillKind, id: string): string {
  return encodeSkillRef({ kind, id });
}

export function pluginRow(plugin: PluginInfo): InstalledSkillRow {
  return {
    ref: refOf('ptah-plugin', plugin.id),
    kind: 'ptah-plugin',
    id: plugin.id,
    name: plugin.name,
    description: textOrNull(plugin.description),
    source: pluginSourceLabel(plugin.source),
    version: null,
    detail: `${plural(plugin.skillCount, 'skill', 'skills')} · ${plural(
      plugin.commandCount,
      'command',
      'commands',
    )}`,
    action: 'manage',
  };
}

/**
 * Community skills are keyed by `name`: `skillsSh:uninstall` takes the name,
 * and the store's removal id is built from it, so the row, the detail and the
 * pending state all agree on one id.
 */
export function communityRow(skill: InstalledSkill): InstalledSkillRow {
  return {
    ref: refOf('community-skill', skill.name),
    kind: 'community-skill',
    id: skill.name,
    name: skill.name,
    description: textOrNull(skill.description),
    source: textOrNull(skill.source) ?? 'local',
    version: null,
    detail: null,
    action: 'uninstall',
  };
}

export function marketplaceRow(
  listing: ExternalPluginListing,
): InstalledSkillRow {
  return {
    ref: refOf('marketplace-plugin', listing.id),
    kind: 'marketplace-plugin',
    id: listing.id,
    name: listing.name,
    description: textOrNull(listing.description),
    source: listing.source,
    version: textOrNull(listing.installedVersion) ?? textOrNull(listing.version),
    detail: null,
    action: 'uninstall',
  };
}

function group<T>(
  id: InstalledSkillGroupId,
  slice: InventorySlice<T>,
  toRow: (item: T) => InstalledSkillRow,
): InstalledSkillGroup {
  const rows = slice.data.map(toRow);
  return {
    id,
    ...GROUP_META[id],
    state: slice.state,
    error: slice.state === 'error' ? (slice.error ?? null) : null,
    actionError: slice.actionError ?? null,
    rows,
    total: rows.length,
  };
}

/** The three groups, in display order, unfiltered. */
export function installedSkillGroups(
  slices: InstalledSkillSlices,
): readonly InstalledSkillGroup[] {
  return [
    group('plugins', slices.plugins, pluginRow),
    group('community', slices.community, communityRow),
    group('marketplaces', slices.marketplaces, marketplaceRow),
  ];
}

/**
 * Keep the rows whose name, description or source contains every word of
 * `query` (case-insensitive). A blank query keeps everything; `total` is
 * never changed, so a group can tell "nothing installed" from "no match".
 */
export function filterInstalledSkillGroups(
  groups: readonly InstalledSkillGroup[],
  query: string,
): readonly InstalledSkillGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups.map((current) => ({
    ...current,
    rows: current.rows.filter((row) => {
      const haystack = [row.name, row.description ?? '', row.source]
        .join(' ')
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    }),
  }));
}

/**
 * The installed item a decoded ref names, or `null` when the slice holds no
 * such item (never installed, removed, or gone after a workspace switch).
 */
export function findInstalledSkill(
  ref: SkillRef,
  slices: InstalledSkillSlices,
): InstalledSkillMatch | null {
  switch (ref.kind) {
    case 'ptah-plugin': {
      const plugin = slices.plugins.data.find((item) => item.id === ref.id);
      return plugin
        ? { kind: ref.kind, row: pluginRow(plugin), plugin }
        : null;
    }
    case 'community-skill': {
      const skill = slices.community.data.find((item) => item.name === ref.id);
      return skill ? { kind: ref.kind, row: communityRow(skill), skill } : null;
    }
    case 'marketplace-plugin': {
      const listing = slices.marketplaces.data.find(
        (item) => item.id === ref.id,
      );
      return listing
        ? { kind: ref.kind, row: marketplaceRow(listing), listing }
        : null;
    }
  }
}
