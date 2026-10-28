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
  CloneSummary,
  ExternalPluginListing,
  InstalledSkill,
  LibraryProvenance,
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

/** What a plugin ships: the count line and the names behind it. */
export interface InstalledSkillContents {
  /** `3 skills · 1 command · 2 agents` (agents only when the host counts them). */
  readonly summary: string;
  readonly skills: readonly string[];
  readonly commands: readonly string[];
  readonly agents: readonly string[];
}

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
  /** A short fact line (plugin skill, command and agent counts), or `null`. */
  readonly detail: string | null;
  /** Ptah plugins are managed on their source page; the rest uninstall here. */
  readonly action: InstalledSkillAction;
  /** Recorded origin for the provenance badge (`provenanceLabel`). */
  readonly provenance: LibraryProvenance;
  /** What the item ships, or `null` when the host sent no counts for it. */
  readonly contents: InstalledSkillContents | null;
  /**
   * Agents of this plugin that a Library copy with ANOTHER recorded origin
   * shadows (F7f). Empty outside Electron, where no clone list is read.
   */
  readonly shadowedAgents: readonly string[];
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
  /**
   * The Library copies of this workspace (Electron only), for the agent
   * shadow state and the orphaned line. Absent or empty: nothing is shadowed.
   */
  readonly libraryClones?: readonly CloneSummary[];
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

const GROUP_META: Readonly<
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

/** The count line and names a plugin ships. Agents only when counted. */
export function pluginContents(plugin: PluginInfo): InstalledSkillContents {
  const agents = plugin.agentNames ?? [];
  const agentCount =
    plugin.agentCount ?? (agents.length > 0 ? agents.length : null);
  const parts = [
    plural(plugin.skillCount, 'skill', 'skills'),
    plural(plugin.commandCount, 'command', 'commands'),
  ];
  if (agentCount !== null) parts.push(plural(agentCount, 'agent', 'agents'));
  return {
    summary: parts.join(' · '),
    skills: plugin.skillNames ?? [],
    commands: plugin.commandNames ?? [],
    agents,
  };
}

/**
 * The plugin's agents that a Library agent copy with another recorded origin
 * shadows (F7f): same slug, and a provenance that is not this plugin. A copy
 * whose provenance the host did not resolve is not counted, so an unknown
 * origin never shows a false "Shadowed".
 */
export function shadowedAgentNames(
  pluginId: string,
  agentNames: readonly string[],
  clones: readonly CloneSummary[],
): readonly string[] {
  return agentNames.filter((name) =>
    clones.some(
      (clone) =>
        clone.kind === 'agent' &&
        clone.slug === name &&
        clone.provenance !== undefined &&
        !(
          clone.provenance.kind === 'plugin' &&
          clone.provenance.pluginId === pluginId
        ),
    ),
  );
}

function pluginProvenance(id: string, name: string): LibraryProvenance {
  return { kind: 'plugin', pluginId: id, name, state: 'active' };
}

export function pluginRow(
  plugin: PluginInfo,
  clones: readonly CloneSummary[] = [],
): InstalledSkillRow {
  const contents = pluginContents(plugin);
  return {
    ref: refOf('ptah-plugin', plugin.id),
    kind: 'ptah-plugin',
    id: plugin.id,
    name: plugin.name,
    description: textOrNull(plugin.description),
    source: pluginSourceLabel(plugin.source),
    version: null,
    detail: contents.summary,
    action: 'manage',
    provenance: pluginProvenance(plugin.id, plugin.name),
    contents,
    shadowedAgents: shadowedAgentNames(plugin.id, contents.agents, clones),
  };
}

/**
 * Community skills are keyed by `name`: `skillsSh:uninstall` takes the name,
 * and the store's removal id is built from it, so the row, the detail and the
 * pending state all agree on one id.
 */
export function communityRow(skill: InstalledSkill): InstalledSkillRow {
  const source = textOrNull(skill.source);
  return {
    ref: refOf('community-skill', skill.name),
    kind: 'community-skill',
    id: skill.name,
    name: skill.name,
    description: textOrNull(skill.description),
    source: source ?? 'local',
    version: null,
    detail: null,
    action: 'uninstall',
    provenance:
      source === null || source === 'local'
        ? { kind: 'workspace' }
        : { kind: 'skills-sh', source },
    contents: null,
    shadowedAgents: [],
  };
}

/**
 * `plugin` is the catalogue entry with the same id, when the host lists the
 * installed marketplace plugin there: it carries the contents the listing
 * does not.
 */
export function marketplaceRow(
  listing: ExternalPluginListing,
  plugin?: PluginInfo,
  clones: readonly CloneSummary[] = [],
): InstalledSkillRow {
  const contents = plugin === undefined ? null : pluginContents(plugin);
  return {
    ref: refOf('marketplace-plugin', listing.id),
    kind: 'marketplace-plugin',
    id: listing.id,
    name: listing.name,
    description: textOrNull(listing.description),
    source: listing.source,
    version: textOrNull(listing.installedVersion) ?? textOrNull(listing.version),
    detail: contents?.summary ?? null,
    action: 'uninstall',
    provenance: pluginProvenance(listing.id, listing.name),
    contents,
    shadowedAgents:
      contents === null
        ? []
        : shadowedAgentNames(listing.id, contents.agents, clones),
  };
}

function catalogEntry(
  slices: InstalledSkillSlices,
  id: string,
): PluginInfo | undefined {
  return slices.plugins.data.find((plugin) => plugin.id === id);
}

/**
 * Library copies kept after their plugin was uninstalled, as
 * `legacy-linter (plugin "Former Helper")`, for the page's orphaned line.
 */
export function orphanedCopyNames(
  clones: readonly CloneSummary[],
): readonly string[] {
  return clones.flatMap((clone) =>
    clone.provenance?.kind === 'plugin' &&
    clone.provenance.state === 'uninstalled'
      ? [`${clone.slug} (plugin "${clone.provenance.name}")`]
      : [],
  );
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
  const clones = slices.libraryClones ?? [];
  return [
    group('plugins', slices.plugins, (plugin) => pluginRow(plugin, clones)),
    group('community', slices.community, communityRow),
    group('marketplaces', slices.marketplaces, (listing) =>
      marketplaceRow(listing, catalogEntry(slices, listing.id), clones),
    ),
  ];
}

/**
 * Keep the rows whose name, description, source or kind contains every word
 * of `query` (case-insensitive), so `acme/skills` finds a community skill by
 * its source and `marketplace lint` a marketplace plugin by kind and name. A blank query keeps everything; `total` is
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
      const haystack = [
        row.name,
        row.description ?? '',
        row.source,
        SKILL_KIND_LABELS[row.kind],
      ]
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
        ? {
            kind: ref.kind,
            row: pluginRow(plugin, slices.libraryClones),
            plugin,
          }
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
        ? {
            kind: ref.kind,
            row: marketplaceRow(
              listing,
              catalogEntry(slices, listing.id),
              slices.libraryClones,
            ),
            listing,
          }
        : null;
    }
  }
}
