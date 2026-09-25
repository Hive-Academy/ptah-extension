/**
 * The capability policy service (TASK_2026_560, C4), behind
 * `SDK_TOKENS.SDK_CAPABILITY_RESOLVER`.
 *
 * It combines four inputs into one answer per workspace:
 *
 * - the MCP declaration inventory (`McpInstallService.listDeclarations`, the
 *   same rows the Installed tab shows);
 * - the lock-free toggle store (explicit global and workspace items, plus the
 *   one-time IMPORTED layer of the user's own Claude approvals);
 * - the skill/plugin policy, read ONLY through
 *   `PluginLoaderService.getEffectivePluginConfig`, which already layers the
 *   global items under the workspace `PluginConfigState` from one snapshot;
 * - the MCP server back-off, which holds a failing server back.
 *
 * `resolve` answers session builders, `list` answers the Marketplace, and both
 * are built from the same snapshot function, so they cannot disagree.
 *
 * ## Identity
 *
 * `physicalRoot = realpath.native(resolveHarnessWorkspaceRoot(cwd))`, and every
 * file read, git call, facet call and plugin-storage call uses it. The store
 * key is `capabilityPolicyKey(physicalRoot)` — lower-cased on win32 only — so a
 * drive-letter alias is one workspace while `Repo` and `repo` on ext4 are two.
 *
 * ## Fail closed
 *
 * Any input that cannot be read — a store file or directory, `imported.json`,
 * a declaration source, the approval sources during an import, or the plugin
 * policy — makes the whole answer `unverified`, with every unreadable path in
 * `reasons`. Consumers then load ptah only and no skills. `resolve` and `list`
 * never throw; `set` and `setExplicit` reject when they cannot write.
 */

import { realpathSync } from 'fs';
import { basename, resolve as resolvePath } from 'path';
import { z } from 'zod';
import { resolveHarnessWorkspaceRoot } from '@ptah-extension/harness-sync';
import type {
  McpServerBackoffService,
  PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  defaultEnabled,
  isCapabilityPolicyUnknownError,
  nextWorkspaceValue,
  planApprovalImport,
  pluginConfigLayer,
  type CapabilityDefault,
  type CapabilityEntry,
  type CapabilityInventory,
  type CapabilityKind,
  type CapabilityPolicyReason,
  type CapabilityScope,
  type CapabilitySetRequest,
  type EffectiveCapabilitySet,
  type ICapabilityResolver,
  type PluginConfigState,
} from '@ptah-extension/shared';
import type { McpInstallService } from '../mcp-directory/mcp-install.service';
import {
  EMPTY_CATALOG,
  dedupeReasons,
  formatReasons,
  importedEntries,
  inventoryReasons,
  itemValues,
  layerItems,
  layerReasons,
  mcpRows,
  pluginAndSkillRows,
  pluginDefault,
  toEffectiveSet,
  toInventory,
  unverifiedSet,
  withWorkspaceValue,
  type CapabilityRow,
  type PluginCatalog,
  type PluginCatalogEntry,
  type PluginPolicyRead,
  type PolicySnapshot,
  type WorkspaceContext,
} from './capability-policy-model';
import {
  CapabilityToggleStoreError,
  capabilityPolicyKey,
  capabilityWorkspaceKey,
  type CapabilityToggleStore,
} from './capability-toggle-store';
import type { ClaudeApprovalReader } from './claude-approval.reader';

const LOG_PREFIX = '[CapabilityResolver]';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What the resolver needs from the plugin loader. */
export type CapabilityPluginSource = Pick<
  PluginLoaderService,
  | 'getEffectivePluginConfig'
  | 'getWorkspacePluginConfig'
  | 'saveWorkspacePluginConfig'
  | 'getAvailablePlugins'
  | 'resolvePluginPaths'
  | 'discoverWorkspaceHarnessPluginPaths'
  | 'discoverSkillsShPluginPaths'
  | 'discoverSkillsForPlugins'
>;

export interface CapabilityResolverDependencies {
  output: IOutputChannel;
  store: CapabilityToggleStore;
  /** The one MCP declaration inventory. */
  inventory: Pick<McpInstallService, 'listDeclarations'>;
  approvals: Pick<ClaudeApprovalReader, 'read'>;
  plugins: CapabilityPluginSource;
  /** Absent in a host without the back-off service: nothing is held back. */
  backoff?: Pick<McpServerBackoffService, 'getBackingOffServers'>;
  /** The home directory the workspace-root walk stops below. Specs only. */
  homeDir?: string;
  /** Decides whether the policy key folds case. Specs only. */
  platform?: NodeJS.Platform;
  /** `realpathSync.native` by default. Specs only. */
  realpath?: (path: string) => string;
}

/** A toggle request that is malformed or names something that is not there. */
export class CapabilityRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityRequestError';
  }
}

const setRequestSchema = z.object({
  cwd: z.string().min(1),
  scope: z.enum(['global', 'workspace']),
  kind: z.enum(['mcp', 'skill', 'plugin']),
  id: z.string().min(1),
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * Not decorated for tsyringe: its collaborators come from three libraries and
 * two of them are optional, so `register.ts` builds it with a factory.
 */
export class CapabilityResolverService implements ICapabilityResolver {
  /** In-flight imports by workspace key (single-flight, R7). */
  private readonly imports = new Map<
    string,
    Promise<CapabilityPolicyReason[]>
  >();
  /** Workspace keys whose diagnostics `root.json` is known to be written. */
  private readonly recordedRoots = new Set<string>();
  /** Last reason set logged per workspace, so a steady failure logs once. */
  private readonly loggedReasons = new Map<string, string>();

  constructor(private readonly deps: CapabilityResolverDependencies) {}

  // ---- ICapabilityResolver -------------------------------------------------

  async resolve(cwd: string): Promise<EffectiveCapabilitySet> {
    let ctx: WorkspaceContext;
    try {
      ctx = this.contextFor(cwd);
    } catch (error: unknown) {
      return unverifiedSet(cwd, [{ path: cwd, error: describeError(error) }]);
    }
    try {
      return toEffectiveSet(await this.readSnapshot(ctx));
    } catch (error: unknown) {
      // Every expected failure is already a reason; this is the "never
      // throws" backstop, and it still fails closed.
      const reasons = [{ path: ctx.physicalRoot, error: describeError(error) }];
      this.logReasons(ctx, reasons);
      return unverifiedSet(ctx.physicalRoot, reasons, ctx.policyKey);
    }
  }

  async list(cwd: string): Promise<CapabilityInventory> {
    let ctx: WorkspaceContext;
    try {
      ctx = this.contextFor(cwd);
    } catch (error: unknown) {
      return {
        status: 'unverified',
        reasons: [{ path: cwd, error: describeError(error) }],
        entries: [],
      };
    }
    try {
      return toInventory(await this.readSnapshot(ctx));
    } catch (error: unknown) {
      const reasons = [{ path: ctx.physicalRoot, error: describeError(error) }];
      this.logReasons(ctx, reasons);
      return { status: 'unverified', reasons, entries: [] };
    }
  }

  async set(request: CapabilitySetRequest): Promise<CapabilityEntry> {
    const parsed = setRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new CapabilityRequestError('Invalid capability toggle request');
    }
    const { cwd, scope, kind, id, enabled } = parsed.data;
    const ctx = this.contextFor(cwd);
    await this.recordRoot(ctx);
    // N2: the import runs (or is joined) BEFORE the toggle is written. The
    // toggle is an explicit item and wins over the imported layer in any
    // order, so a failed import does not block it.
    await this.ensureImported(ctx);

    if (kind === 'mcp') {
      await this.setMcp(ctx, scope, id, enabled);
    } else if (scope === 'global') {
      await this.setPluginOrSkillGlobal(ctx, kind, id, enabled);
    } else {
      await this.setPluginOrSkillWorkspace(ctx, kind, id, enabled);
    }
    return this.entryFor(ctx, kind, id);
  }

  async setExplicit(
    cwd: string,
    kind: 'mcp',
    id: string,
    enabled: true,
  ): Promise<CapabilityEntry> {
    if (
      kind !== 'mcp' ||
      enabled !== true ||
      typeof id !== 'string' ||
      id === ''
    ) {
      throw new CapabilityRequestError('Invalid explicit capability request');
    }
    const ctx = this.contextFor(cwd);
    await this.recordRoot(ctx);
    await this.ensureImported(ctx);
    await this.deps.store.setExplicit(ctx.wsKey, 'mcp', id);
    return this.entryFor(ctx, 'mcp', id);
  }

  // ---- Identity ------------------------------------------------------------

  /** @throws CapabilityRequestError when there is no workspace to name. */
  private contextFor(cwd: string): WorkspaceContext {
    if (typeof cwd !== 'string' || cwd.trim() === '') {
      throw new CapabilityRequestError('No workspace folder is open');
    }
    const root = resolveHarnessWorkspaceRoot(
      cwd,
      this.deps.homeDir === undefined ? {} : { homeDir: this.deps.homeDir },
    );
    let physicalRoot: string;
    try {
      physicalRoot = (this.deps.realpath ?? realpathSync.native)(root);
    } catch {
      // A root that cannot be canonicalized (removed, no permission on an
      // ancestor) is still named by its resolved path; the reads below then
      // report what is wrong with it.
      physicalRoot = resolvePath(root);
    }
    const policyKey = capabilityPolicyKey(physicalRoot, this.deps.platform);
    return {
      physicalRoot,
      policyKey,
      wsKey: capabilityWorkspaceKey(policyKey),
    };
  }

  /**
   * Write the diagnostics-only `root.json`, best effort. It is never read for
   * policy, so a failure to write it is logged and nothing else: it must not
   * fail a resolve, a toggle or a session.
   */
  private async recordRoot(ctx: WorkspaceContext): Promise<void> {
    if (this.recordedRoots.has(ctx.wsKey)) return;
    try {
      await this.deps.store.recordWorkspaceRoot(
        ctx.wsKey,
        ctx.physicalRoot,
        ctx.policyKey,
      );
      this.recordedRoots.add(ctx.wsKey);
    } catch (error: unknown) {
      this.log(
        `Could not record the workspace root ${ctx.physicalRoot} (diagnostics only, continuing): ${describeError(error)}`,
      );
    }
  }

  // ---- Import (Q1, D1) -----------------------------------------------------

  /**
   * Publish the IMPORTED layer once per workspace. Concurrent callers in this
   * process join one run. Resolves to the reasons the import could not run,
   * or `[]`; never rejects. A failed run publishes nothing and is dropped from
   * the in-flight map, so the next call retries.
   */
  private ensureImported(
    ctx: WorkspaceContext,
  ): Promise<CapabilityPolicyReason[]> {
    const pending = this.imports.get(ctx.wsKey);
    if (pending !== undefined) return pending;
    const run = this.runImport(ctx).finally(() => {
      this.imports.delete(ctx.wsKey);
    });
    this.imports.set(ctx.wsKey, run);
    return run;
  }

  private async runImport(
    ctx: WorkspaceContext,
  ): Promise<CapabilityPolicyReason[]> {
    try {
      const current = await this.deps.store.readImported(ctx.wsKey);
      if (current.status === 'ok') return [];
      if (current.status === 'error') return current.reasons;

      const [approvals, inventory] = await Promise.all([
        this.deps.approvals.read(ctx.physicalRoot),
        this.deps.inventory.listDeclarations(ctx.physicalRoot),
      ]);
      if (approvals.status === 'error') {
        this.log(
          `Approval import for ${ctx.physicalRoot} deferred: ${formatReasons(approvals.reasons)}`,
        );
        return approvals.reasons;
      }
      const mcpJson = inventory.sourceStatus.find(
        (source) => source.target === 'claude',
      );
      if (mcpJson?.status === 'error') {
        const reasons = [
          { path: mcpJson.path, error: mcpJson.error ?? 'unreadable' },
        ];
        this.log(
          `Approval import for ${ctx.physicalRoot} deferred: ${formatReasons(reasons)}`,
        );
        return reasons;
      }

      const document = planApprovalImport({
        approvals: approvals.approvals,
        mcpJsonServerNames: inventory.declarations
          .filter(
            (row) => row.origin === 'harness-config' && row.target === 'claude',
          )
          .map((row) => row.serverKey),
        createdAt: new Date().toISOString(),
      });
      await this.deps.store.publishImport(ctx.wsKey, document);
      return [];
    } catch (error: unknown) {
      const reason =
        error instanceof CapabilityToggleStoreError
          ? { path: error.path, error: 'could not publish the import' }
          : { path: ctx.physicalRoot, error: describeError(error) };
      this.log(
        `Approval import for ${ctx.physicalRoot} failed: ${formatReasons([reason])}`,
      );
      return [reason];
    }
  }

  // ---- The snapshot --------------------------------------------------------

  private async readSnapshot(ctx: WorkspaceContext): Promise<PolicySnapshot> {
    await this.recordRoot(ctx);
    const importReasons = await this.ensureImported(ctx);
    const [inventory, globalRead, workspaceRead, importedRead, pluginRead] =
      await Promise.all([
        this.deps.inventory.listDeclarations(ctx.physicalRoot),
        this.deps.store.readGlobalLayer(),
        this.deps.store.readWorkspaceItems(ctx.wsKey),
        this.deps.store.readImported(ctx.wsKey),
        this.readPluginPolicy(ctx.physicalRoot),
      ]);

    const reasons: CapabilityPolicyReason[] = [
      ...importReasons,
      ...inventoryReasons(inventory),
      ...layerReasons(globalRead),
      ...layerReasons(workspaceRead),
      ...(importedRead.status === 'error' ? importedRead.reasons : []),
      ...(pluginRead.status === 'error' ? pluginRead.reasons : []),
    ];
    const globalItems = layerItems(globalRead);
    const mcp = mcpRows(
      inventory,
      globalItems,
      layerItems(workspaceRead),
      importedEntries(importedRead),
      this.backingOffServers(),
    );

    let catalog = EMPTY_CATALOG;
    let plugins: CapabilityRow[] = [];
    let skills: CapabilityRow[] = [];
    if (pluginRead.status === 'ok') {
      const catalogRead = this.readPluginCatalog(ctx.physicalRoot);
      if (catalogRead.status === 'ok') {
        catalog = catalogRead.catalog;
        ({ plugins, skills } = pluginAndSkillRows(
          catalog,
          pluginRead.policy.config,
          globalItems,
        ));
      } else {
        reasons.push(catalogRead.reason);
      }
    }

    const snapshot: PolicySnapshot = {
      ctx,
      reasons: dedupeReasons(reasons),
      mcp,
      plugins,
      skills,
      catalog,
      pluginPolicy: pluginRead.status === 'ok' ? pluginRead.policy : null,
    };
    this.logReasons(ctx, snapshot.reasons);
    return snapshot;
  }

  /** The skill/plugin policy, or why it is unknown. Never throws. */
  private async readPluginPolicy(root: string): Promise<PluginPolicyRead> {
    try {
      return {
        status: 'ok',
        policy: await this.deps.plugins.getEffectivePluginConfig(root),
      };
    } catch (error: unknown) {
      if (isCapabilityPolicyUnknownError(error)) {
        const reasons =
          error.reasons !== undefined && error.reasons.length > 0
            ? [...error.reasons]
            : [{ path: root, error: 'skill and plugin policy unreadable' }];
        return { status: 'error', reasons };
      }
      return {
        status: 'error',
        reasons: [{ path: root, error: describeError(error) }],
      };
    }
  }

  /**
   * Every plugin and plugin skill on disk, enabled or not — the children of
   * a disabled plugin must be known to be denied.
   */
  private readPluginCatalog(
    root: string,
  ):
    | { status: 'ok'; catalog: PluginCatalog }
    | { status: 'error'; reason: CapabilityPolicyReason } {
    try {
      const { plugins: loader } = this.deps;
      const plugins = new Map<string, PluginCatalogEntry>();
      for (const info of loader.getAvailablePlugins()) {
        plugins.set(info.id, {
          label: info.name,
          ...(info.source === undefined ? {} : { source: info.source }),
          scope: 'global',
        });
      }

      // skills.sh roots are not resolvable by id; they are listed below.
      const byId = [...plugins]
        .filter(([, entry]) => entry.source !== 'skillssh')
        .map(([id]) => id);
      const paths = new Set(loader.resolvePluginPaths(byId, root));
      for (const pluginPath of loader.discoverWorkspaceHarnessPluginPaths(
        root,
      )) {
        paths.add(pluginPath);
        const id = basename(pluginPath);
        plugins.set(id, {
          label: plugins.get(id)?.label ?? id,
          source: 'harness',
          scope: 'workspace',
        });
      }
      for (const pluginPath of loader.discoverSkillsShPluginPaths()) {
        paths.add(pluginPath);
      }
      for (const pluginPath of paths) {
        const entry = plugins.get(basename(pluginPath));
        if (entry !== undefined) entry.path = pluginPath;
      }

      return {
        status: 'ok',
        catalog: {
          plugins,
          skills: loader.discoverSkillsForPlugins([...paths]),
        },
      };
    } catch (error: unknown) {
      return {
        status: 'error',
        reason: {
          path: root,
          error: `plugin catalog: ${describeError(error)}`,
        },
      };
    }
  }

  /** Servers the back-off is holding back right now. */
  private backingOffServers(): ReadonlySet<string> {
    return new Set(this.deps.backoff?.getBackingOffServers() ?? []);
  }

  // ---- Writes --------------------------------------------------------------

  private async setMcp(
    ctx: WorkspaceContext,
    scope: CapabilityScope,
    id: string,
    enabled: boolean,
  ): Promise<void> {
    const [inventory, globalRead, workspaceRead, importedRead] =
      await Promise.all([
        this.deps.inventory.listDeclarations(ctx.physicalRoot),
        this.deps.store.readGlobalLayer(),
        this.deps.store.readWorkspaceItems(ctx.wsKey),
        this.deps.store.readImported(ctx.wsKey),
      ]);
    const row = mcpRows(
      inventory,
      layerItems(globalRead),
      layerItems(workspaceRead),
      importedEntries(importedRead),
      this.backingOffServers(),
    ).find((candidate) => candidate.id === id);
    if (row === undefined) {
      throw new CapabilityRequestError(`Unknown MCP server "${id}"`);
    }

    if (scope === 'global') {
      await this.deps.store.writeGlobal(
        'mcp',
        id,
        nextWorkspaceValue(enabled, { defaultValue: row.layers.defaultValue }),
      );
      return;
    }
    // With the global layer unreadable, "what the workspace inherits" is
    // unknown, so the toggle is written as the concrete value it is rather
    // than as a tombstone that might mean something else.
    const value =
      globalRead.status === 'ok'
        ? nextWorkspaceValue(enabled, row.layers)
        : nextWorkspaceValue(enabled, row.layers, { explicit: true });
    await this.deps.store.writeWorkspace(ctx.wsKey, 'mcp', id, value);
  }

  private async setPluginOrSkillGlobal(
    ctx: WorkspaceContext,
    kind: 'plugin' | 'skill',
    id: string,
    enabled: boolean,
  ): Promise<void> {
    const pluginRead = await this.readPluginPolicy(ctx.physicalRoot);
    const catalog = this.catalogOrThrow(ctx.physicalRoot);
    const config = pluginRead.status === 'ok' ? pluginRead.policy.config : null;
    const defaultValue = this.requireKnownPluginOrSkill(
      catalog,
      config,
      kind,
      id,
    );
    await this.deps.store.writeGlobal(
      kind,
      id,
      nextWorkspaceValue(enabled, { defaultValue }),
    );
  }

  /**
   * A workspace skill/plugin toggle goes to the workspace `PluginConfigState`
   * (AC-3.1), written from the STORED workspace config so a global item is
   * never copied into the workspace (P9 G7).
   */
  private async setPluginOrSkillWorkspace(
    ctx: WorkspaceContext,
    kind: 'plugin' | 'skill',
    id: string,
    enabled: boolean,
  ): Promise<void> {
    const globalRead = await this.deps.store.readGlobalLayer();
    const catalog = this.catalogOrThrow(ctx.physicalRoot);
    // Strict guard: rejects with CapabilityPolicyUnknownError when the global
    // layer or the workspace config cannot be read, so nothing is written over
    // a config nobody could read.
    const effective = await this.deps.plugins.getEffectivePluginConfig(
      ctx.physicalRoot,
    );
    // From here to the save there is no await, so the lenient read below sees
    // the same storage the strict guard just proved readable and valid.
    // `getWorkspacePluginConfig` is the WRITE PAYLOAD BASE only — it is the one
    // accessor for the stored workspace layer without the global items layered
    // in — and is never a resolution input (those come from
    // `getEffectivePluginConfig` alone).
    const stored = this.deps.plugins.getWorkspacePluginConfig(ctx.physicalRoot);
    const defaultValue = this.requireKnownPluginOrSkill(
      catalog,
      effective.config,
      kind,
      id,
    );
    const global = itemValues(layerItems(globalRead), kind).get(id);
    const value = nextWorkspaceValue(enabled, {
      ...(global === undefined ? {} : { global }),
      defaultValue,
    });
    await this.deps.plugins.saveWorkspacePluginConfig(
      withWorkspaceValue(stored, kind, id, value),
      ctx.physicalRoot,
    );
  }

  private catalogOrThrow(root: string): PluginCatalog {
    const read = this.readPluginCatalog(root);
    if (read.status === 'error') {
      throw new CapabilityRequestError(
        `Could not list plugins for ${root}: ${read.reason.error}`,
      );
    }
    return read.catalog;
  }

  /**
   * The default of a known plugin or skill.
   *
   * @throws CapabilityRequestError for an id neither on disk nor in the config.
   */
  private requireKnownPluginOrSkill(
    catalog: PluginCatalog,
    config: PluginConfigState | null,
    kind: 'plugin' | 'skill',
    id: string,
  ): CapabilityDefault {
    const layer = pluginConfigLayer(config);
    const known =
      kind === 'plugin'
        ? catalog.plugins.has(id) || layer.plugins.has(id)
        : catalog.skills.some((skill) => skill.skillId === id) ||
          layer.skills.has(id);
    if (!known) throw new CapabilityRequestError(`Unknown ${kind} "${id}"`);
    return kind === 'plugin'
      ? pluginDefault(catalog, id)
      : defaultEnabled({ kind: 'skill', id });
  }

  private async entryFor(
    ctx: WorkspaceContext,
    kind: CapabilityKind,
    id: string,
  ): Promise<CapabilityEntry> {
    const inventory = toInventory(await this.readSnapshot(ctx));
    const entry = inventory.entries.find(
      (candidate) => candidate.kind === kind && candidate.id === id,
    );
    if (entry === undefined) {
      throw new CapabilityRequestError(
        `The ${kind} "${id}" was written but could not be read back`,
      );
    }
    return entry;
  }

  // ---- Logging -------------------------------------------------------------

  private log(message: string): void {
    this.deps.output.appendLine(`${LOG_PREFIX} ${message}`);
  }

  /** Log an unverified policy once per distinct reason set per workspace. */
  private logReasons(
    ctx: WorkspaceContext,
    reasons: readonly CapabilityPolicyReason[],
  ): void {
    const signature = formatReasons(reasons);
    if (this.loggedReasons.get(ctx.wsKey) === signature) return;
    this.loggedReasons.set(ctx.wsKey, signature);
    if (reasons.length === 0) {
      this.log(`Capability policy for ${ctx.physicalRoot} is verified`);
    } else {
      this.log(
        `Capability policy for ${ctx.physicalRoot} is UNVERIFIED (fail closed): ${signature}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A narrowed, user-facing reason: the errno code or the error's name. */
function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  if (error instanceof CapabilityRequestError) return error.message;
  return error instanceof Error ? error.name : 'unexpected error';
}
