/**
 * The pure half of the capability resolver (TASK_2026_560, C4): the snapshot
 * model and every rule that turns one snapshot into an answer.
 *
 * Nothing here reads a file or awaits anything. `CapabilityResolverService`
 * does the I/O, builds one {@link PolicySnapshot}, and hands it to
 * {@link toEffectiveSet} (session builders) or {@link toInventory} (the
 * Marketplace); the two are built from the same rows, so they cannot disagree.
 */

import type { EffectivePluginConfig } from '@ptah-extension/agent-sdk';
import {
  PTAH_MCP_SERVER_NAME,
  capabilityKey,
  defaultEnabled,
  pluginConfigLayer,
  resolveEffective,
  type CapabilityDefault,
  type CapabilityEntry,
  type CapabilityExplicitItem,
  type CapabilityImportedValue,
  type CapabilityInventory,
  type CapabilityItemValue,
  type CapabilityKind,
  type CapabilityLayerValues,
  type CapabilityPolicyReason,
  type CapabilityScope,
  type CapabilitySourceRef,
  type EffectiveCapabilitySet,
  type PluginConfigState,
  type PluginSkillEntry,
  type PluginSource,
  type ResolvedCapability,
} from '@ptah-extension/shared';
import type { McpDeclarationInventory } from '../mcp-directory/mcp-install.service';
import type {
  CapabilityImportedLayerRead,
  CapabilityItemLayerSnapshot,
} from './capability-toggle-store';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface WorkspaceContext {
  physicalRoot: string;
  policyKey: string;
  wsKey: string;
  /**
   * The folder whose host storage holds the workspace skill/plugin config.
   * `physicalRoot` unless the host registered a sub-folder of it instead.
   */
  stateRoot: string;
}

/** One capability with every layer's say and the outcome. */
export interface CapabilityRow {
  kind: CapabilityKind;
  id: string;
  label: string;
  parentId?: string;
  sources: CapabilitySourceRef[];
  layers: CapabilityLayerValues;
  resolved: ResolvedCapability;
  /** MCP only. */
  scopes: CapabilityScope[];
  /** MCP only: ON by policy but held back by the back-off. */
  backingOff: boolean;
}

export interface PluginCatalogEntry {
  label: string;
  source?: PluginSource;
  scope: CapabilityScope;
  path?: string;
}

/** Every plugin and plugin skill on disk, enabled or not. */
export interface PluginCatalog {
  plugins: Map<string, PluginCatalogEntry>;
  skills: PluginSkillEntry[];
}

export type PluginPolicyRead =
  | { status: 'ok'; policy: EffectivePluginConfig }
  | { status: 'error'; reasons: CapabilityPolicyReason[] };

/** One read of every input, from which both `resolve` and `list` answer. */
export interface PolicySnapshot {
  ctx: WorkspaceContext;
  reasons: CapabilityPolicyReason[];
  mcp: CapabilityRow[];
  plugins: CapabilityRow[];
  skills: CapabilityRow[];
  catalog: PluginCatalog;
  /** `null` when the skill/plugin policy could not be read. */
  pluginPolicy: EffectivePluginConfig | null;
}

export const EMPTY_CATALOG: PluginCatalog = { plugins: new Map(), skills: [] };

const KIND_ORDER: Record<CapabilityKind, number> = {
  mcp: 0,
  plugin: 1,
  skill: 2,
};

/** The part of a `PluginConfigState` a workspace toggle saves. */
export type WorkspacePluginConfigPayload = Pick<
  PluginConfigState,
  'enabledPluginIds' | 'disabledSkillIds'
> &
  Partial<Pick<PluginConfigState, 'disabledPluginIds' | 'enabledSkillIds'>>;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * One row per MCP name anyone mentions — ptah, every declaration, every
 * explicit item and every imported entry — with its layers resolved.
 */
export function mcpRows(
  inventory: McpDeclarationInventory,
  globalItems: readonly CapabilityExplicitItem[],
  workspaceItems: readonly CapabilityExplicitItem[],
  imported: Readonly<Record<string, CapabilityImportedValue>>,
  backingOff: ReadonlySet<string>,
): CapabilityRow[] {
  const declared = new Map<
    string,
    { sources: CapabilitySourceRef[]; scopes: Set<CapabilityScope> }
  >();
  for (const row of inventory.declarations) {
    const entry = declared.get(row.serverKey) ?? {
      sources: [],
      scopes: new Set<CapabilityScope>(),
    };
    const scope = row.scope ?? 'workspace';
    entry.scopes.add(scope);
    if (
      !entry.sources.some(
        (source) => source.path === row.configPath && source.scope === scope,
      )
    ) {
      entry.sources.push({
        scope,
        path: row.configPath,
        label: row.originLabel,
      });
    }
    declared.set(row.serverKey, entry);
  }

  const globalValues = itemValues(globalItems, 'mcp');
  const workspaceValues = itemValues(workspaceItems, 'mcp');
  const names = new Set<string>([
    PTAH_MCP_SERVER_NAME,
    ...declared.keys(),
    ...globalValues.keys(),
    ...workspaceValues.keys(),
    ...Object.keys(imported)
      .filter((key) => key.startsWith('mcp:'))
      .map((key) => key.slice('mcp:'.length)),
  ]);

  return [...names].sort(compareCodeUnits).map((name) => {
    const declaration = declared.get(name);
    const scopes = [...(declaration?.scopes ?? [])].sort(compareCodeUnits);
    const workspace = workspaceValues.get(name);
    const importedValue = imported[capabilityKey('mcp', name)];
    const global = globalValues.get(name);
    const layers: CapabilityLayerValues = {
      ...(workspace === undefined ? {} : { workspace }),
      ...(importedValue === undefined ? {} : { imported: importedValue }),
      ...(global === undefined ? {} : { global }),
      defaultValue: defaultEnabled({ kind: 'mcp', id: name, scopes }),
    };
    return {
      kind: 'mcp' as const,
      id: name,
      label: name,
      sources: declaration?.sources ?? [],
      layers,
      resolved: resolveEffective(layers),
      scopes,
      backingOff: name !== PTAH_MCP_SERVER_NAME && backingOff.has(name),
    };
  });
}

/** Plugin and skill rows, from the layered config alone (P9). */
export function pluginAndSkillRows(
  catalog: PluginCatalog,
  config: PluginConfigState,
  globalItems: readonly CapabilityExplicitItem[],
): { plugins: CapabilityRow[]; skills: CapabilityRow[] } {
  const layered = pluginConfigLayer(config);
  const globalPlugins = itemValues(globalItems, 'plugin');
  const globalSkills = itemValues(globalItems, 'skill');

  const pluginIds = new Set([
    ...catalog.plugins.keys(),
    ...layered.plugins.keys(),
  ]);
  const plugins = [...pluginIds].sort(compareCodeUnits).map((id) => {
    const entry = catalog.plugins.get(id);
    return layeredRow({
      kind: 'plugin',
      id,
      label: entry?.label ?? id,
      sources:
        entry?.path === undefined
          ? []
          : [{ scope: entry.scope, path: entry.path, label: entry.label }],
      layered: layered.plugins.get(id),
      global: globalPlugins.get(id),
      defaultValue: pluginDefault(catalog, id),
    });
  });
  const pluginEnabled = new Map(
    plugins.map((row) => [row.id, row.resolved.enabled]),
  );

  const providers = new Map<string, PluginSkillEntry[]>();
  for (const skill of catalog.skills) {
    providers.set(skill.skillId, [
      ...(providers.get(skill.skillId) ?? []),
      skill,
    ]);
  }
  const skillIds = new Set([...providers.keys(), ...layered.skills.keys()]);
  const skills = [...skillIds].sort(compareCodeUnits).map((id) => {
    const provided = providers.get(id) ?? [];
    const first = provided[0];
    return layeredRow({
      kind: 'skill',
      id,
      label: first?.displayName ?? id,
      ...(first === undefined ? {} : { parentId: first.pluginId }),
      sources: [],
      layered: layered.skills.get(id),
      global: globalSkills.get(id),
      defaultValue: defaultEnabled({ kind: 'skill', id }),
      ...(provided.length === 0
        ? {}
        : {
            parentEnabled: provided.some(
              (skill) => pluginEnabled.get(skill.pluginId) ?? false,
            ),
          }),
    });
  });
  return { plugins, skills };
}

/**
 * One skill/plugin row. The effective value is `layered ?? default` — exactly
 * what `getEffectivePluginConfig` says. The store's global item only
 * ATTRIBUTES a layered value to the global layer for display, when it says the
 * same thing; a workspace entry that happens to equal the global one therefore
 * shows as following global.
 */
function layeredRow(input: {
  kind: 'plugin' | 'skill';
  id: string;
  label: string;
  parentId?: string;
  sources: CapabilitySourceRef[];
  layered: CapabilityImportedValue | undefined;
  global: CapabilityItemValue | undefined;
  defaultValue: CapabilityDefault;
  parentEnabled?: boolean;
}): CapabilityRow {
  const { layered, global } = input;
  const followsGlobal = layered !== undefined && global === layered;
  const layers: CapabilityLayerValues = {
    ...(layered === undefined || followsGlobal ? {} : { workspace: layered }),
    ...(global === undefined ? {} : { global }),
    defaultValue: input.defaultValue,
    ...(input.parentEnabled === undefined
      ? {}
      : { parentEnabled: input.parentEnabled }),
  };
  const own: ResolvedCapability =
    layered === undefined
      ? { enabled: input.defaultValue.enabled, origin: 'default' }
      : {
          enabled: layered === 'on',
          origin: followsGlobal ? 'global' : 'workspace',
        };
  const resolved: ResolvedCapability =
    input.parentEnabled === false && own.enabled
      ? { enabled: false, origin: 'parent-plugin' }
      : own;
  return {
    kind: input.kind,
    id: input.id,
    label: input.label,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    sources: input.sources,
    layers,
    resolved,
    scopes: [],
    backingOff: false,
  };
}

export function pluginDefault(
  catalog: PluginCatalog,
  id: string,
): CapabilityDefault {
  const source = catalog.plugins.get(id)?.source;
  return defaultEnabled({
    kind: 'plugin',
    id,
    ...(source === undefined ? {} : { source }),
  });
}

/**
 * A workspace config with one id's entry replaced by `value`, built from the
 * STORED workspace config. Lists the edit does not touch are omitted, so
 * `saveWorkspacePluginConfig` keeps them as stored.
 */
export function withWorkspaceValue(
  stored: PluginConfigState,
  kind: 'plugin' | 'skill',
  id: string,
  value: CapabilityItemValue,
): WorkspacePluginConfigPayload {
  const without = (list: readonly string[] | undefined): string[] =>
    (list ?? []).filter((entry) => entry !== id);

  if (kind === 'plugin') {
    const enabledPluginIds = without(stored.enabledPluginIds);
    const disabledPluginIds = without(stored.disabledPluginIds);
    if (value === 'on') enabledPluginIds.push(id);
    if (value === 'off') disabledPluginIds.push(id);
    return {
      enabledPluginIds,
      disabledSkillIds: [...stored.disabledSkillIds],
      disabledPluginIds,
    };
  }

  const disabledSkillIds = without(stored.disabledSkillIds);
  const enabledSkillIds = without(stored.enabledSkillIds);
  if (value === 'on') enabledSkillIds.push(id);
  if (value === 'off') disabledSkillIds.push(id);
  return {
    enabledPluginIds: [...stored.enabledPluginIds],
    disabledSkillIds,
    // Absent stays absent unless this edit needs the list (AC-3.2).
    ...(stored.enabledSkillIds !== undefined || value === 'on'
      ? { enabledSkillIds }
      : {}),
  };
}

export function toEffectiveSet(
  snapshot: PolicySnapshot,
): EffectiveCapabilitySet {
  const { ctx, reasons, mcp } = snapshot;
  const ptah = mcp.find((row) => row.id === PTAH_MCP_SERVER_NAME);
  const deniedMcpServers: string[] = [];
  const approvedProjectMcpServers: string[] = [];
  for (const row of mcp) {
    if (row.id === PTAH_MCP_SERVER_NAME) continue;
    const on = row.resolved.enabled && !row.backingOff;
    if (!on) {
      deniedMcpServers.push(row.id);
      continue;
    }
    // Approved only by a decision about THIS workspace, never by a default, a
    // repository file, or a global value set for a same-name user server.
    if (
      row.scopes.includes('workspace') &&
      (row.resolved.origin === 'workspace' ||
        row.resolved.origin === 'imported')
    ) {
      approvedProjectMcpServers.push(row.id);
    }
  }

  return {
    physicalRoot: ctx.physicalRoot,
    policyKey: ctx.policyKey,
    status: reasons.length === 0 ? 'verified' : 'unverified',
    reasons,
    ptahEnabled: ptah?.resolved.enabled ?? true,
    deniedMcpServers,
    approvedProjectMcpServers,
    deniedSkillNames: deniedSkillNames(snapshot),
    disabledPluginIds: snapshot.plugins
      .filter((row) => !row.resolved.enabled)
      .map((row) => row.id),
    harnessFingerprint: snapshot.pluginPolicy?.fingerprint ?? '',
  };
}

/**
 * Every skill that is off, bare, plus `plugin:skill` for every copy of a skill
 * whose own value or providing plugin is off.
 */
function deniedSkillNames(snapshot: PolicySnapshot): string[] {
  const skillEnabled = new Map(
    snapshot.skills.map((row) => [row.id, row.resolved.enabled]),
  );
  const pluginEnabled = new Map(
    snapshot.plugins.map((row) => [row.id, row.resolved.enabled]),
  );
  const denied = new Set<string>();
  for (const row of snapshot.skills) {
    if (!row.resolved.enabled) denied.add(row.id);
  }
  for (const skill of snapshot.catalog.skills) {
    const own = skillEnabled.get(skill.skillId) ?? true;
    const parent = pluginEnabled.get(skill.pluginId) ?? false;
    if (!own || !parent) denied.add(`${skill.pluginId}:${skill.skillId}`);
  }
  return [...denied].sort(compareCodeUnits);
}

export function toInventory(snapshot: PolicySnapshot): CapabilityInventory {
  const verified = snapshot.reasons.length === 0;
  const entries = [...snapshot.mcp, ...snapshot.plugins, ...snapshot.skills]
    .map((row) => toEntry(row, verified))
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareCodeUnits(a.id, b.id),
    );
  return {
    status: verified ? 'verified' : 'unverified',
    reasons: snapshot.reasons,
    entries,
  };
}

function toEntry(row: CapabilityRow, verified: boolean): CapabilityEntry {
  const { layers, resolved } = row;
  const effective = row.resolved.enabled && !row.backingOff;
  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    ...(row.parentId === undefined ? {} : { parentId: row.parentId }),
    sources: row.sources,
    ...(layers.global === 'on' || layers.global === 'off'
      ? { globalEnabled: layers.global === 'on' }
      : {}),
    ...(layers.workspace === 'on' || layers.workspace === 'off'
      ? { workspaceEnabled: layers.workspace === 'on' }
      : {}),
    // An unverified policy cannot say what is on: every value is unknown.
    effectiveEnabled: verified ? effective : null,
    inheritedFrom: resolved.origin,
    defaultReason: layers.defaultValue.reason,
    ...(resolved.origin === 'imported' ? { importedFromClaude: true } : {}),
    ...(row.backingOff && resolved.enabled
      ? { suppressedByBackoff: true }
      : {}),
  };
}

/** The fail-closed answer when nothing could be read. */
export function unverifiedSet(
  physicalRoot: string,
  reasons: CapabilityPolicyReason[],
  policyKey: string = physicalRoot,
): EffectiveCapabilitySet {
  return {
    physicalRoot,
    policyKey,
    status: 'unverified',
    reasons,
    // ptah goes only when a READABLE store says so.
    ptahEnabled: true,
    deniedMcpServers: [],
    approvedProjectMcpServers: [],
    deniedSkillNames: [],
    disabledPluginIds: [],
    harnessFingerprint: '',
  };
}

export function inventoryReasons(
  inventory: McpDeclarationInventory,
): CapabilityPolicyReason[] {
  return inventory.sourceStatus
    .filter((source) => source.status === 'error')
    .map((source) => ({
      path: source.path,
      error: source.error ?? 'unreadable',
    }));
}

export function layerReasons(
  read: CapabilityItemLayerSnapshot,
): CapabilityPolicyReason[] {
  return read.status === 'error' ? read.reasons : [];
}

export function layerItems(
  read: CapabilityItemLayerSnapshot,
): readonly CapabilityExplicitItem[] {
  return read.status === 'ok' ? read.items : [];
}

export function importedEntries(
  read: CapabilityImportedLayerRead,
): Readonly<Record<string, CapabilityImportedValue>> {
  return read.status === 'ok' ? read.document.entries : {};
}

export function itemValues(
  items: readonly CapabilityExplicitItem[],
  kind: CapabilityKind,
): Map<string, CapabilityItemValue> {
  return new Map(
    items
      .filter((item) => item.kind === kind)
      .map((item) => [item.id, item.value]),
  );
}

export function dedupeReasons(
  reasons: readonly CapabilityPolicyReason[],
): CapabilityPolicyReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = JSON.stringify([reason.path, reason.error]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatReasons(
  reasons: readonly CapabilityPolicyReason[],
): string {
  return reasons.map((reason) => `${reason.path} (${reason.error})`).join(', ');
}

/** Code-unit order, independent of locale. */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
