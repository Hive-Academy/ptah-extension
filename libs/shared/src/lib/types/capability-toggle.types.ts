/**
 * Capability toggles: the per-workspace and global on/off contract for MCP
 * servers, skills and plugins (TASK_2026_560).
 *
 * This file holds the TYPES and the PURE RULES only. The store that persists
 * toggles (`~/.ptah/capabilities/**`), the resolver that combines them with the
 * declaration inventory, and every enforcement point live in backend libs and
 * all call the rules below, so the Marketplace, the session builders and the
 * harness can never disagree about what "on" means.
 *
 * It lives in `shared` because the webview renders the same entries the
 * backend resolves, and a frontend lib cannot import a backend one. That also
 * means nothing here may import Node: `libs/shared` ships to the browser
 * bundle. The byte-level encodings the policy needs — the item-file codec,
 * TOML key segments and the harness fingerprint — live beside this file in
 * `capability-id-codec.ts`.
 *
 * ## Resolution
 *
 * `effective = explicit workspace ?? imported ?? global ?? default`, where an
 * explicit workspace `inherit` (the "follow global" tombstone) skips the
 * imported layer, and a skill whose parent plugin is off is off whatever its
 * own layers say.
 */

import type {
  CapabilityFingerprintEntry,
  CapabilityKind,
} from './capability-id-codec';
import type {
  CapabilityScope,
  McpServerOrigin,
  McpInstallTarget,
} from './mcp-directory.types';
import {
  isOptOutPluginSource,
  type PluginConfigState,
  type PluginSource,
} from './rpc/rpc-misc.types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * `${kind}:${id}` — the one identity every layer is keyed by. For MCP the id
 * is the server name as declared.
 */
export type CapabilityKey = `${CapabilityKind}:${string}`;

/** Build the identity key for one capability. */
export function capabilityKey(kind: CapabilityKind, id: string): CapabilityKey {
  return `${kind}:${id}`;
}

/**
 * The MCP server Ptah itself serves. ON by default in every workspace, and it
 * can be turned off (with a warning, because agent lanes, memory and the
 * browser tools go with it).
 */
export const PTAH_MCP_SERVER_NAME = 'ptah';

// ---------------------------------------------------------------------------
// Stored values
// ---------------------------------------------------------------------------

/**
 * One explicit decision.
 *
 * `inherit` is the tombstone a workspace toggle writes when the user's choice
 * equals what the workspace would inherit anyway (AC-1.3, "follows global").
 * It is a real value rather than a deleted file because it must beat the
 * imported layer: a clear made before, during or after an approval import
 * stays cleared.
 */
export type CapabilityItemValue = 'on' | 'off' | 'inherit';

/** An imported approval is always a concrete answer. */
export type CapabilityImportedValue = 'on' | 'off';

/** Who wrote an explicit item. `install` is the Marketplace install path. */
export type CapabilityItemSource = 'user' | 'install';

/** Content of one explicit item file (`<kind>__<enc>.json`). */
export interface CapabilityExplicitItem {
  v: 1;
  kind: CapabilityKind;
  id: string;
  value: CapabilityItemValue;
  source: CapabilityItemSource;
  /** ISO-8601. */
  at: string;
}

/** One unreadable policy input, named for the user. */
export interface CapabilityPolicyReason {
  /** Absolute path that could not be read or did not validate. */
  path: string;
  /** Narrowed, user-facing reason (`EACCES`, `invalid JSON`, …). Never a stack. */
  error: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Why a capability has the default it has, for the UI badge.
 *
 * - `ptah` — Ptah's own server: ON.
 * - `user-scope` — declared in at least one user-scope source: ON.
 * - `repository-only` — declared only in repository files (`.mcp.json`,
 *   `.vscode/mcp.json`, …): OFF, because a cloned repository must not be able
 *   to start a server on its own say-so.
 * - `undeclared` — no declaration is known: OFF.
 * - `skill` — skills are ON.
 * - `plugin-opt-out` / `plugin-opt-in` — {@link isOptOutPluginSource}.
 */
export type CapabilityDefaultReason =
  | 'ptah'
  | 'user-scope'
  | 'repository-only'
  | 'undeclared'
  | 'skill'
  | 'plugin-opt-out'
  | 'plugin-opt-in';

/** A default value and its reason. */
export interface CapabilityDefault {
  enabled: boolean;
  reason: CapabilityDefaultReason;
}

/** What {@link defaultEnabled} needs to know about one capability. */
export type CapabilityDefaultInput =
  | {
      kind: 'mcp';
      id: string;
      /** The scope of every declaration of this name (see {@link classifyMcpScope}). */
      scopes: readonly CapabilityScope[];
    }
  | { kind: 'skill'; id: string }
  | { kind: 'plugin'; id: string; source?: PluginSource };

/** The value a capability has when no layer says anything about it. */
export function defaultEnabled(
  input: CapabilityDefaultInput,
): CapabilityDefault {
  switch (input.kind) {
    case 'mcp':
      if (input.id === PTAH_MCP_SERVER_NAME) {
        return { enabled: true, reason: 'ptah' };
      }
      if (input.scopes.includes('global')) {
        return { enabled: true, reason: 'user-scope' };
      }
      return {
        enabled: false,
        reason: input.scopes.length > 0 ? 'repository-only' : 'undeclared',
      };
    case 'skill':
      return { enabled: true, reason: 'skill' };
    case 'plugin':
      return isOptOutPluginSource(input.source)
        ? { enabled: true, reason: 'plugin-opt-out' }
        : { enabled: false, reason: 'plugin-opt-in' };
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Which layer decided the effective value. */
export type CapabilityValueOrigin =
  'workspace' | 'imported' | 'global' | 'default' | 'parent-plugin';

/** Every layer's say about one capability. Absent means "nothing recorded". */
export interface CapabilityLayerValues {
  /** Explicit workspace item, or the skill/plugin `PluginConfigState` layer. */
  workspace?: CapabilityItemValue;
  /** The one-time import of the user's own Claude approvals (MCP only). */
  imported?: CapabilityImportedValue;
  /** Explicit global item. `inherit` there means "use the default". */
  global?: CapabilityItemValue;
  defaultValue: CapabilityDefault;
  /** Skills only: whether the plugin the skill ships in is effectively on. */
  parentEnabled?: boolean;
}

/** The outcome of {@link resolveEffective}. */
export interface ResolvedCapability {
  enabled: boolean;
  origin: CapabilityValueOrigin;
}

/**
 * `explicit workspace ?? imported ?? global ?? default`, with the workspace
 * `inherit` tombstone skipping the imported layer, and a parent plugin that is
 * off switching its skills off.
 */
export function resolveEffective(
  layers: CapabilityLayerValues,
): ResolvedCapability {
  const resolved = resolveOwnLayers(layers);
  if (layers.parentEnabled === false && resolved.enabled) {
    return { enabled: false, origin: 'parent-plugin' };
  }
  return resolved;
}

function resolveOwnLayers(layers: CapabilityLayerValues): ResolvedCapability {
  const { workspace, imported } = layers;
  if (workspace === 'on' || workspace === 'off') {
    return { enabled: workspace === 'on', origin: 'workspace' };
  }
  if (workspace !== 'inherit' && imported !== undefined) {
    return { enabled: imported === 'on', origin: 'imported' };
  }
  return inheritedValue(layers);
}

/** `global ?? default` — what a workspace inherits when it records nothing. */
function inheritedValue(
  layers: Pick<CapabilityLayerValues, 'global' | 'defaultValue'>,
): ResolvedCapability {
  const { global } = layers;
  if (global === 'on' || global === 'off') {
    return { enabled: global === 'on', origin: 'global' };
  }
  return { enabled: layers.defaultValue.enabled, origin: 'default' };
}

/**
 * The item a workspace toggle to `desired` writes.
 *
 * An ordinary toggle normalizes: choosing what the workspace inherits
 * (`global ?? default`) writes `inherit`, so the item follows global again
 * (AC-1.3). The imported layer is deliberately NOT part of "inherited" — the
 * tombstone skips it, so turning an imported OFF back on to match an ON global
 * yields ON.
 *
 * `explicit` (install only, N6) always writes a concrete value, even when it
 * equals the inherited one, so a later global change cannot undo the install.
 */
export function nextWorkspaceValue(
  desired: boolean,
  layers: Pick<CapabilityLayerValues, 'global' | 'defaultValue'>,
  options: { explicit?: boolean } = {},
): CapabilityItemValue {
  const concrete: CapabilityItemValue = desired ? 'on' : 'off';
  if (options.explicit === true) return concrete;
  return inheritedValue(layers).enabled === desired ? 'inherit' : concrete;
}

// ---------------------------------------------------------------------------
// The skill/plugin workspace layer (`PluginConfigState`)
// ---------------------------------------------------------------------------

/** Per-id workspace values read out of a `PluginConfigState`. */
export interface PluginConfigLayer {
  plugins: ReadonlyMap<string, CapabilityImportedValue>;
  skills: ReadonlyMap<string, CapabilityImportedValue>;
}

/**
 * Read a `PluginConfigState` as the workspace layer for plugins and skills.
 *
 * Legacy semantics are preserved (AC-3.2): `enabledPluginIds` → on,
 * `disabledPluginIds` → off, `disabledSkillIds` → off, and a deny beats an
 * enable for the same id — exactly the filter `resolveCurrentPluginPaths`
 * applies today. `enabledSkillIds` is new and optional. Every list is
 * optional at runtime, because configs persisted before a field existed lack
 * it; a missing or non-array list contributes nothing.
 */
export function pluginConfigLayer(
  state: Partial<PluginConfigState> | null | undefined,
): PluginConfigLayer {
  return {
    plugins: layerFromLists(state?.enabledPluginIds, state?.disabledPluginIds),
    skills: layerFromLists(state?.enabledSkillIds, state?.disabledSkillIds),
  };
}

function layerFromLists(
  enabled: readonly string[] | undefined,
  disabled: readonly string[] | undefined,
): ReadonlyMap<string, CapabilityImportedValue> {
  const layer = new Map<string, CapabilityImportedValue>();
  for (const id of stringList(enabled)) layer.set(id, 'on');
  for (const id of stringList(disabled)) layer.set(id, 'off');
  return layer;
}

function stringList(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ---------------------------------------------------------------------------
// MCP declarations
// ---------------------------------------------------------------------------

/** Harness targets whose config file is a USER-scope file. */
const USER_SCOPE_TARGETS: ReadonlySet<McpInstallTarget> = new Set([
  'copilot',
  'codex',
  'antigravity',
]);

/**
 * The scope a declaration belongs to (AC-2.1).
 *
 * - `global`: `~/.claude.json` (both of its maps — both are per-user files the
 *   repository cannot author), `~/.codex/config.toml`, `~/.copilot`,
 *   `~/.gemini`, Smithery, OAuth and claude.ai connectors.
 * - `workspace`: repository files — `.mcp.json`, `.vscode/mcp.json`,
 *   `.cursor/mcp.json`, `opencode.json`.
 *
 * A `harness-config` row with no target cannot be placed, and is classed
 * `workspace`: that is the restrictive answer (default OFF), so an unplaceable
 * declaration never starts a server by itself.
 */
export function classifyMcpScope(declaration: {
  origin: McpServerOrigin;
  target?: McpInstallTarget;
}): CapabilityScope {
  if (declaration.origin !== 'harness-config') return 'global';
  return declaration.target !== undefined &&
    USER_SCOPE_TARGETS.has(declaration.target)
    ? 'global'
    : 'workspace';
}

/**
 * Where Claude Code reads a server definition from, highest precedence first.
 *
 * - `local` — `~/.claude.json` `projects[<root>].mcpServers` (what
 *   `claude mcp add` writes by default; the reader calls it `project`).
 * - `project` — the repository's `.mcp.json`.
 * - `user` — `~/.claude.json` top-level `mcpServers` (`--scope user`).
 */
export type ClaudeMcpDefinitionLayer = 'local' | 'project' | 'user';

const CLAUDE_DEFINITION_PRECEDENCE: readonly ClaudeMcpDefinitionLayer[] = [
  'local',
  'project',
  'user',
];

/**
 * Which of several same-name declarations Claude actually runs (AC-2.5).
 *
 * Claude Code's own rule, pinned: `local` beats `project` beats `user`. Within
 * one layer the first declaration in input order wins, so the answer never
 * depends on anything but its input. `null` when there is nothing to choose.
 */
export function definitionInEffect<
  T extends { layer: ClaudeMcpDefinitionLayer },
>(declarations: readonly T[]): T | null {
  for (const layer of CLAUDE_DEFINITION_PRECEDENCE) {
    const winner = declarations.find(
      (declaration) => declaration.layer === layer,
    );
    if (winner !== undefined) return winner;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Approval import (Q1)
// ---------------------------------------------------------------------------

/** Where an imported approval came from. */
export type CapabilityImportSourceKind = 'claude-project' | 'settings-local';

/**
 * The user-authored approval fields of one trusted Claude source: a
 * `~/.claude.json` project entry, or an untracked, git-ignored
 * `.claude/settings.local.json`.
 */
export interface ClaudeApprovalRecord {
  path: string;
  kind: CapabilityImportSourceKind;
  enableAllProjectMcpServers?: boolean;
  enabledMcpjsonServers?: readonly string[];
  disabledMcpjsonServers?: readonly string[];
}

/** Content of `workspaces/<wsKey>/imported.json`. */
export interface CapabilityImportDocument {
  v: 1;
  /** ISO-8601. */
  createdAt: string;
  sources: { path: string; kind: CapabilityImportSourceKind }[];
  /** Keyed by {@link CapabilityKey}; MCP keys only. */
  entries: Record<string, CapabilityImportedValue>;
}

/**
 * Turn the user's own Claude approvals into the IMPORTED layer.
 *
 * `enableAllProjectMcpServers: true` → every `.mcp.json` name known at import
 * time ON; each `enabledMcpjsonServers` name ON; each `disabledMcpjsonServers`
 * name OFF, and an OFF from any source wins over an ON from any source. A
 * server added to `.mcp.json` later is not in the document, so it keeps its
 * repository-only default (OFF).
 */
export function planApprovalImport(input: {
  approvals: readonly ClaudeApprovalRecord[];
  mcpJsonServerNames: readonly string[];
  createdAt: string;
}): CapabilityImportDocument {
  const enabled = new Set<string>();
  const disabled = new Set<string>();
  for (const approval of input.approvals) {
    if (approval.enableAllProjectMcpServers === true) {
      for (const name of input.mcpJsonServerNames) enabled.add(name);
    }
    for (const name of stringList(approval.enabledMcpjsonServers))
      enabled.add(name);
    for (const name of stringList(approval.disabledMcpjsonServers))
      disabled.add(name);
  }

  const values = new Map<string, CapabilityImportedValue>();
  for (const name of enabled) values.set(capabilityKey('mcp', name), 'on');
  for (const name of disabled) values.set(capabilityKey('mcp', name), 'off');

  return {
    v: 1,
    createdAt: input.createdAt,
    sources: input.approvals.map(({ path, kind }) => ({ path, kind })),
    entries: Object.fromEntries(
      // Code-unit order, independent of locale. Map keys are unique, so no
      // two entries ever compare equal.
      [...values.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
}

// ---------------------------------------------------------------------------
// The effective set
// ---------------------------------------------------------------------------

/**
 * `verified` — every policy input was read. `unverified` — at least one could
 * not be, and every consumer fails closed: ptah only, `skills: []`, a frozen
 * harness, rival lanes refused.
 */
export type CapabilityPolicyStatus = 'verified' | 'unverified';

/** What a session builder needs for one workspace. */
export interface EffectiveCapabilitySet {
  /** `realpath.native` of the workspace root; used for every file operation. */
  physicalRoot: string;
  /** The store and comparison key: `physicalRoot`, lower-cased on win32 only. */
  policyKey: string;
  status: CapabilityPolicyStatus;
  /** Empty when `verified`. */
  reasons: CapabilityPolicyReason[];
  ptahEnabled: boolean;
  /** Every declared server that is effectively OFF (ptah excluded). */
  deniedMcpServers: string[];
  /**
   * Repository-declared servers that are ON by an explicit or imported
   * decision — never by a default or a repository file.
   */
  approvedProjectMcpServers: string[];
  /** Disabled skills plus every skill of a disabled plugin, bare and `plugin:skill`. */
  deniedSkillNames: string[];
  disabledPluginIds: string[];
  /** {@link harnessPolicyFingerprint} of the snapshot this set was built from. */
  harnessFingerprint: string;
}

/**
 * Whether a session for this policy may load `name`.
 *
 * ptah follows `ptahEnabled` in both states. Under an `unverified` policy
 * every other server is off, because an unreadable policy must never widen
 * the set. Under a verified one a server is on unless it is denied.
 */
export function isMcpServerEnabled(
  policy: Pick<
    EffectiveCapabilitySet,
    'status' | 'ptahEnabled' | 'deniedMcpServers'
  >,
  name: string,
): boolean {
  if (name === PTAH_MCP_SERVER_NAME) return policy.ptahEnabled;
  if (policy.status !== 'verified') return false;
  return !policy.deniedMcpServers.includes(name);
}

// ---------------------------------------------------------------------------
// Display entries and service contracts
// ---------------------------------------------------------------------------

/** One place a capability is declared. */
export interface CapabilitySourceRef {
  scope: CapabilityScope;
  /** Absolute path of the declaring file, or the manifest for a store-backed row. */
  path: string;
  /** Short human label for the source (`~/.claude.json`, `Smithery`, …). */
  label?: string;
}

/** One row of the capability list, as the Marketplace renders it. */
export interface CapabilityEntry {
  kind: CapabilityKind;
  id: string;
  label: string;
  /** Skills only: the plugin the skill ships in. */
  parentId?: string;
  sources: CapabilitySourceRef[];
  /** The explicit global value, when one is recorded. */
  globalEnabled?: boolean;
  /** The explicit workspace value, when one is recorded (absent for `inherit`). */
  workspaceEnabled?: boolean;
  /** `null` when the policy is unverified and the value cannot be known. */
  effectiveEnabled: boolean | null;
  inheritedFrom: CapabilityValueOrigin;
  defaultReason?: CapabilityDefaultReason;
  /** The value came from the one-time import of the user's Claude approvals. */
  importedFromClaude?: boolean;
  /** ON by policy, but held back by the server back-off (AC-4.7). */
  suppressedByBackoff?: boolean;
  /** Tool-schema size estimate. Absent means "size unknown", never zero. */
  schemaTokens?: number;
}

/** The inventory plus the policy state it was resolved under. */
export interface CapabilityInventory {
  status: CapabilityPolicyStatus;
  reasons: CapabilityPolicyReason[];
  entries: CapabilityEntry[];
}

/** One toggle, as the RPC layer asks for it. */
export interface CapabilitySetRequest {
  cwd: string;
  scope: CapabilityScope;
  kind: CapabilityKind;
  id: string;
  enabled: boolean;
}

/**
 * The policy service every enforcement point and the RPC layer depend on
 * (`SDK_TOKENS.SDK_CAPABILITY_RESOLVER`).
 */
export interface ICapabilityResolver {
  /** The effective set for the workspace containing `cwd`. Never throws. */
  resolve(cwd: string): Promise<EffectiveCapabilitySet>;
  /** The same inputs as {@link resolve}, as display entries. */
  list(cwd: string): Promise<CapabilityInventory>;
  /** One ordinary toggle; rejects when the item cannot be written or is unknown. */
  set(request: CapabilitySetRequest): Promise<CapabilityEntry>;
  /** Install path (N6): a workspace ON that is kept even when it equals the inherited value. */
  setExplicit(
    cwd: string,
    kind: 'mcp',
    id: string,
    enabled: true,
  ): Promise<CapabilityEntry>;
}

/** A read of the global layer, taken once and used whole. */
export type CapabilityGlobalLayerSnapshot =
  | {
      status: 'ok';
      items: readonly CapabilityExplicitItem[];
      /** Skill and plugin items only; MCP items do not reach the harness. */
      fingerprintEntries: readonly CapabilityFingerprintEntry[];
    }
  | { status: 'error'; reasons: CapabilityPolicyReason[] };

/**
 * The global layer the plugin loader layers under `PluginConfigState`
 * (`SDK_TOKENS.SDK_CAPABILITY_GLOBAL_LAYER`).
 */
export interface ICapabilityGlobalLayer {
  /** Never throws; an unreadable layer is `status: 'error'`. */
  readGlobalLayer(): Promise<CapabilityGlobalLayerSnapshot>;
}

// ---------------------------------------------------------------------------
// Fail-closed error discriminator
// ---------------------------------------------------------------------------

/**
 * `name` of the error the plugin loader throws when the policy cannot be read.
 *
 * harness-sync must detect that error without importing agent-sdk (its port
 * forbids the dependency), so the contract is structural: the error's `name`
 * equals this constant.
 */
export const CAPABILITY_POLICY_UNKNOWN_ERROR_NAME =
  'CapabilityPolicyUnknownError';

/** Structural shape of the policy-unknown error. */
export interface CapabilityPolicyUnknownErrorLike extends Error {
  name: typeof CAPABILITY_POLICY_UNKNOWN_ERROR_NAME;
  reasons?: readonly CapabilityPolicyReason[];
}

/** Whether `error` is the loader's policy-unknown error, from any realm. */
export function isCapabilityPolicyUnknownError(
  error: unknown,
): error is CapabilityPolicyUnknownErrorLike {
  return (
    error instanceof Error &&
    error.name === CAPABILITY_POLICY_UNKNOWN_ERROR_NAME
  );
}

// ---------------------------------------------------------------------------
// Enforcement table (AC-4.8)
// ---------------------------------------------------------------------------

/** Every surface a capability policy is (or is not yet) applied to. */
export type CapabilityProvider =
  | 'claude'
  | 'ptah-cli'
  | 'codex'
  | 'opencode'
  | 'antigravity'
  | 'ptah-cli-proxy';

export type CapabilityEnforcementStatus = 'enforced' | 'not-enforced';

/** One provider × kind row. The UI renders labels from this table only. */
export interface CapabilityEnforcementRow {
  provider: CapabilityProvider;
  label: string;
  kind: CapabilityKind;
  status: CapabilityEnforcementStatus;
}

type EnforcementByKind = Partial<
  Record<CapabilityKind, CapabilityEnforcementStatus>
>;

const EVERY_KIND_ENFORCED: EnforcementByKind = {
  mcp: 'enforced',
  skill: 'enforced',
  plugin: 'enforced',
};

/** Skills and plugins arrive through the harness sync; MCP does not yet. */
const MCP_NOT_ENFORCED: EnforcementByKind = {
  mcp: 'not-enforced',
  skill: 'enforced',
  plugin: 'enforced',
};

const ENFORCEMENT_KIND_ORDER: readonly CapabilityKind[] = [
  'mcp',
  'skill',
  'plugin',
];

/** One row per kind the provider has a status for, in `mcp, skill, plugin` order. */
function enforcementRows(
  provider: CapabilityProvider,
  label: string,
  byKind: EnforcementByKind,
): CapabilityEnforcementRow[] {
  return ENFORCEMENT_KIND_ORDER.flatMap((kind) => {
    const status = byKind[kind];
    return status === undefined ? [] : [{ provider, label, kind, status }];
  });
}

/**
 * Where each kind of toggle is honoured today.
 *
 * The rival CLI lanes (Codex, OpenCode, Antigravity) and the `ptah` CLI proxy
 * do not yet receive an explicit MCP set, so those rows say `not-enforced`
 * until their lanes enforce (the follow-up PR flips them here, and the UI
 * follows with no edit). Skills and plugins reach those lanes through the
 * harness sync, which already honours the toggles.
 */
export const CAPABILITY_ENFORCEMENT: readonly CapabilityEnforcementRow[] = [
  ...enforcementRows('claude', 'Claude', EVERY_KIND_ENFORCED),
  ...enforcementRows('ptah-cli', 'Ptah CLI agents', EVERY_KIND_ENFORCED),
  ...enforcementRows('codex', 'Codex', MCP_NOT_ENFORCED),
  ...enforcementRows('opencode', 'OpenCode', MCP_NOT_ENFORCED),
  ...enforcementRows('antigravity', 'Antigravity', MCP_NOT_ENFORCED),
  ...enforcementRows('ptah-cli-proxy', 'Ptah CLI proxy', {
    mcp: 'not-enforced',
  }),
];
