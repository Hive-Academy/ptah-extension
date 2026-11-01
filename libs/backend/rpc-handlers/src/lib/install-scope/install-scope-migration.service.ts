/**
 * The one-time install-scope migration (TASK_2026_853 D-6, Requirement 5).
 *
 * Before this task every skills.sh install landed in the user-global
 * `~/.ptah/plugins/ptah-skillssh-*` and every MCP install was recorded
 * user-globally, so both reached every workspace. Workspace scope is now the
 * default; this service moves an existing machine onto it, once:
 *
 *   1. Retire. Every global `ptah-skillssh-*` root id goes into the retired
 *      registry (`~/.ptah/plugins/.ptah-skillssh-retired.json`, D-2). v1 MCP
 *      servers are already retired by the intent store's read mapping (D-1);
 *      they become ledger items here. Bundled plugins, `external/`,
 *      `ptah-harness-*` roots and the claude.ai-synced skills under
 *      `~/.claude/skills/synced` are never listed, so never touched (AC7).
 *   2. Global deletes with proof. A retired root is deleted only when
 *      `verifyOwnedRoot` says `owned` (v2 metadata, owner marker, every file
 *      hashed, nothing unlisted, no link). Every other root — every v1 root
 *      included — stays on disk and is counted `onDisk` (AC3). User-layer
 *      clones of retired roots go through `UserLayerOrphanReaper.reapRetired`,
 *      the one clone-deletion rule; this service has no second one.
 *   3. Workspace pass. Each known workspace (recent ∪ open, existing
 *      directories only) gets one full reconcile, which applies the D-2
 *      policy to its copies and to home-config entries (AC4) under the
 *      reconciler's own per-workspace lock.
 *   4. Ledger (D-D10). Every outcome is written to
 *      `~/.ptah/migrations/install-scope.json` atomically after each step that
 *      deletes or keeps something, before the next step starts. Counts derive
 *      from the persisted ledger only, so a retry never loses or recounts a
 *      path. A failure leaves the path in `failedPaths` (or the workspace
 *      without `passedAt`) and the next run retries only those.
 *
 * The notice the Marketplace shows (Batch 34's RPC) reads the same ledger via
 * {@link InstallScopeMigrationService.readNotice}.
 *
 * Failure behaviour: {@link InstallScopeMigrationService.run} never rejects.
 * Every error is logged and the run ends `incomplete` or `failed`; the app
 * start proceeds (AC5).
 */

import { inject, injectable } from 'tsyringe';
import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  HARNESS_SYNC_TOKENS,
  McpIntentStore,
  atomicWriteWithRetry,
  defaultMcpIntentPath,
  resolveHarnessWorkspaceRoot,
  type HarnessReconcileOptions,
} from '@ptah-extension/harness-sync';
import {
  UserLayerFsOps,
  UserLayerOrphanReaper,
  type ReapResult,
  type UserLayerRoots,
} from '@ptah-extension/agent-generation';
import {
  SKILLS_SH_RETIRED_FILE,
  USER_LAYER_AGENTS_DIR_NAME,
  harnessPathIdentity,
  mcpRetiredItemId,
  isRetiredSkillsShRoot,
  parseSkillsShRetiredRegistry,
  skillsShRetiredItemId,
  type HarnessHealth,
  type SkillsShRetiredRegistry,
} from '@ptah-extension/shared';

import { RecentWorkspacesService } from '../services/recent-workspaces.service';
import {
  isSkillsShRootId,
  readRootMetadata,
  verifyOwnedRoot,
} from '../skills-sh/skills-sh-source-root';

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** Reconcile reason label carried into health reports and logs. */
export const INSTALL_SCOPE_MIGRATION_REASON = 'install-scope-migration';

/**
 * The `keptPaths` reason for a user-layer clone whose removal had failed when
 * the user took its root back (Make global, global reinstall): the clone is
 * no longer the migration's to delete, so it stays where it is.
 */
export const KEPT_ROOT_UNRETIRED = 'root-no-longer-retired';

/** `~/.ptah/migrations/install-scope.json`. */
export function installScopeLedgerPath(homeDir: string): string {
  return path.join(homeDir, '.ptah', 'migrations', 'install-scope.json');
}

const ITEM_OUTCOMES = ['removed', 'kept', 'onDisk', 'retired'] as const;

export type InstallScopeItemOutcome = (typeof ITEM_OUTCOMES)[number];

const LedgerItemSchema = z.object({
  kind: z.enum(['skills-sh', 'mcp']),
  retired: z.boolean(),
  /** ISO-8601; the retired registry's / intent store's own `retiredAt`. */
  retiredAt: z.string().optional(),
  /** The global source root left on disk because it is not proven owned. */
  onDisk: z.string().optional(),
  /** `verifyOwnedRoot`'s reason for `onDisk`. */
  onDiskReason: z.string().optional(),
  /** Set once the item has no `failedPaths` (see {@link itemOutcome}). */
  outcome: z.enum(ITEM_OUTCOMES).optional(),
  /** Absolute path (or `~/` home-config fragment) → ISO removedAt. */
  removedPaths: z.record(z.string(), z.string()),
  /**
   * Path → why it was kept (`edited`, `git-tracked`, `diverged`,
   * {@link KEPT_ROOT_UNRETIRED}, …).
   */
  keptPaths: z.record(z.string(), z.string()),
  /** Path → last error. Retried by the next run. */
  failedPaths: z.record(z.string(), z.string()),
});

const LedgerWorkspaceSchema = z.object({
  /** The canonical root as resolved, for display and the reconcile call. */
  root: z.string(),
  passedAt: z.string().optional(),
  /** Last reconcile failure, cleared when the workspace passes. */
  lastError: z.string().optional(),
  /** Ledger path keys this workspace's last pass failed to remove. */
  failedPaths: z.array(z.string()).optional(),
  /** The directory no longer exists; it is no longer a known workspace. */
  missingAt: z.string().optional(),
});

const LedgerSchema = z.object({
  version: z.literal(1),
  /** Step 1 finished: the item set is fixed from here on. */
  discoveredAt: z.string().optional(),
  /** The clone sweep finished with no failure. */
  clonesPassedAt: z.string().optional(),
  items: z.record(z.string(), LedgerItemSchema),
  workspaces: z.record(z.string(), LedgerWorkspaceSchema),
  completedAt: z.string().optional(),
  noticeSeenAt: z.string().optional(),
});

export type InstallScopeLedgerItem = z.infer<typeof LedgerItemSchema>;
export type InstallScopeLedgerWorkspace = z.infer<typeof LedgerWorkspaceSchema>;
export type InstallScopeLedger = z.infer<typeof LedgerSchema>;

/** The four numbers the notice shows (design spec §3). */
export interface InstallScopeMigrationCounts {
  /** Ledger items retired (skills.sh roots and v1 MCP servers). */
  retired: number;
  /** Union of every item's `removedPaths`. */
  removed: number;
  /** Union of `keptPaths` minus any path also in `removedPaths`. */
  kept: number;
  /** Global source roots left on disk. */
  onDisk: number;
}

export interface InstallScopeKeptPath {
  path: string;
  reason: string;
  itemId: string;
}

export interface InstallScopeOnDiskSource {
  itemId: string;
  path: string;
  reason?: string;
}

/** What `harness:get-install-migration-notice` returns when there is one. */
export interface InstallScopeMigrationNotice {
  completedAt: string;
  counts: InstallScopeMigrationCounts;
  keptPaths: InstallScopeKeptPath[];
  onDisk: InstallScopeOnDiskSource[];
}

export type InstallScopeMigrationRunStatus =
  /** This run wrote `completedAt`. */
  | 'completed'
  /** Nothing to do: an earlier run completed. Nothing was written. */
  | 'already-completed'
  /** Some path or workspace failed; the next run retries only those. */
  | 'incomplete'
  /** The ledger or the retired registry could not be read or written. */
  | 'failed';

export interface InstallScopeMigrationRunResult {
  status: InstallScopeMigrationRunStatus;
  /** From the persisted ledger; `null` when it could not be read. */
  counts: InstallScopeMigrationCounts | null;
}

function emptyLedger(): InstallScopeLedger {
  return { version: 1, items: {}, workspaces: {} };
}

function own<T>(record: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * `removed` if any path was removed, else `kept` if any path was kept, else
 * `onDisk` or `retired`. `undefined` while any path is still failed.
 */
export function itemOutcome(
  item: InstallScopeLedgerItem,
): InstallScopeItemOutcome | undefined {
  if (Object.keys(item.failedPaths).length > 0) return undefined;
  if (Object.keys(item.removedPaths).length > 0) return 'removed';
  if (Object.keys(item.keptPaths).length > 0) return 'kept';
  return item.onDisk !== undefined ? 'onDisk' : 'retired';
}

/** The notice counts, from the persisted ledger only. */
export function installScopeMigrationCounts(
  ledger: InstallScopeLedger,
): InstallScopeMigrationCounts {
  const removed = new Set<string>();
  const kept = new Set<string>();
  let retired = 0;
  let onDisk = 0;
  for (const item of Object.values(ledger.items)) {
    if (item.retired) retired += 1;
    if (item.onDisk !== undefined) onDisk += 1;
    for (const p of Object.keys(item.removedPaths)) removed.add(p);
    for (const p of Object.keys(item.keptPaths)) kept.add(p);
  }
  for (const p of removed) kept.delete(p);
  return { retired, removed: removed.size, kept: kept.size, onDisk };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return toError(error).message;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** True when `candidate` is `base` or inside it (plain string work). */
function isWithin(base: string, candidate: string): boolean {
  const root = base.replace(/\\/g, '/').replace(/\/+$/, '');
  const target = candidate.replace(/\\/g, '/');
  return target === root || target.startsWith(`${root}/`);
}

// ---------------------------------------------------------------------------
// Collaborator ports — structural, so the spec builds the service without a
// container and without the developer's real home directory.
// ---------------------------------------------------------------------------

/** The slice of `HarnessReconcilerService` the workspace pass uses. */
export interface InstallScopeReconciler {
  reconcile(
    cwd: string,
    options: HarnessReconcileOptions,
  ): Promise<HarnessHealth>;
}

/** The slice of `RecentWorkspacesService` used to find known workspaces. */
export interface InstallScopeRecentWorkspaces {
  list(): Promise<ReadonlyArray<{ path: string }>>;
}

/** The slice of `UserLayerOrphanReaper` the clone pass uses. */
export interface InstallScopeCloneReaper {
  reapRetired(
    roots: UserLayerRoots,
    retired: SkillsShRetiredRegistry | null,
  ): Promise<ReapResult>;
}

/** The slice of `McpIntentStore` the retire step uses. */
export interface InstallScopeRetiredMcpSource {
  listRetired(): ReadonlyArray<{ serverKey: string; retiredAt: string }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@injectable()
export class InstallScopeMigrationService {
  private readonly homeDir: string;
  private readonly reaper: InstallScopeCloneReaper;
  private readonly mcpIntents: InstallScopeRetiredMcpSource;

  /**
   * Every ledger read-modify-write (a run, a dismissal) runs one at a time in
   * this process. Across processes the migration is invoked only from the
   * Electron heavy boot (single instance); the reconcile pass itself takes
   * the reconciler's per-workspace lock.
   */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(HARNESS_SYNC_TOKENS.RECONCILER)
    private readonly reconciler: InstallScopeReconciler,
    @inject(RecentWorkspacesService)
    private readonly recentWorkspaces: InstallScopeRecentWorkspaces,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: Pick<
      IWorkspaceProvider,
      'getWorkspaceFolders'
    >,
    /**
     * Overrides for specs, as plain DEFAULTED parameters (the
     * `SkillsShSourceRootService` precedent): no host registers a token for
     * them, so container resolution omits them and the defaults apply. A spec
     * passes a temp home so nothing touches the real `~/.ptah`.
     */
    homeDir: string | null = null,
    reaper: InstallScopeCloneReaper | null = null,
    mcpIntents: InstallScopeRetiredMcpSource | null = null,
  ) {
    this.homeDir = homeDir ?? os.homedir();
    this.reaper = reaper ?? createCloneReaper(logger);
    this.mcpIntents =
      mcpIntents ?? createMcpIntentSource(defaultMcpIntentPath(this.homeDir));
  }

  /** `~/.ptah/migrations/install-scope.json`. */
  get ledgerPath(): string {
    return installScopeLedgerPath(this.homeDir);
  }

  private get pluginsBasePath(): string {
    return path.join(this.homeDir, '.ptah', 'plugins');
  }

  private get userLayerBase(): string {
    return path.join(this.homeDir, '.ptah', 'user');
  }

  private rootDirOf(rootId: string): string {
    return path.join(this.pluginsBasePath, rootId);
  }

  /**
   * Run (or resume) the migration. Idempotent: after completion it reads the
   * ledger and returns without writing. Never rejects.
   */
  run(): Promise<InstallScopeMigrationRunResult> {
    return this.enqueue(() => this.runOnce());
  }

  /**
   * The notice, or `null` unless the migration completed, the notice was not
   * dismissed and some count is above zero. Never rejects; an unreadable
   * ledger is `null`.
   */
  async readNotice(): Promise<InstallScopeMigrationNotice | null> {
    let ledger: InstallScopeLedger | null;
    try {
      ledger = await this.readLedger();
    } catch (error: unknown) {
      // degradation-audit: reported - logged here; a notice that cannot be
      // read is simply not shown, and the next start tries again.
      this.logger.warn('[install-scope] Could not read the migration ledger', {
        error: errorMessage(error),
      });
      return null;
    }
    if (
      ledger === null ||
      ledger.completedAt === undefined ||
      ledger.noticeSeenAt !== undefined
    ) {
      return null;
    }
    const counts = installScopeMigrationCounts(ledger);
    if (counts.retired + counts.removed + counts.kept + counts.onDisk === 0) {
      return null;
    }
    return {
      completedAt: ledger.completedAt,
      counts,
      keptPaths: keptPathRows(ledger),
      onDisk: Object.entries(ledger.items)
        .filter(([, item]) => item.onDisk !== undefined)
        .map(([itemId, item]) => ({
          itemId,
          path: item.onDisk as string,
          ...(item.onDiskReason !== undefined
            ? { reason: item.onDiskReason }
            : {}),
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  /**
   * Record that the user saw the notice. Returns `false` when there is no
   * ledger yet. Rejects only when the ledger cannot be read or written, so
   * the RPC layer can report it.
   */
  dismissNotice(): Promise<boolean> {
    return this.enqueue(async () => {
      const ledger = await this.readLedger();
      if (ledger === null) return false;
      if (ledger.noticeSeenAt === undefined) {
        ledger.noticeSeenAt = new Date().toISOString();
        this.writeLedger(ledger);
      }
      return true;
    });
  }

  /**
   * The persisted ledger, or `null` when there is none. Throws when the file
   * exists but cannot be read; a malformed file reads as `null` (and is set
   * aside by the next run).
   */
  async readLedger(): Promise<InstallScopeLedger | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf8');
    } catch (error: unknown) {
      if (isEnoent(error)) return null;
      throw error;
    }
    return parseLedger(raw);
  }

  // ------------------------------------------------------------------- run

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    // degradation-audit: reported - the caller receives this rejection through
    // `run`; the chain itself must stay resolved so later calls still run.
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async runOnce(): Promise<InstallScopeMigrationRunResult> {
    let ledger: InstallScopeLedger;
    try {
      ledger = await this.loadLedgerForRun();
    } catch (error: unknown) {
      // degradation-audit: reported - logged at error level; the app start
      // proceeds and the next start retries the whole run (AC5).
      this.logger.error(
        '[install-scope] Migration skipped: the ledger could not be read',
        toError(error),
      );
      return { status: 'failed', counts: null };
    }
    if (ledger.completedAt !== undefined) {
      return {
        status: 'already-completed',
        counts: installScopeMigrationCounts(ledger),
      };
    }

    try {
      if (ledger.discoveredAt === undefined) {
        await this.retire(ledger);
      }
      const rootsSettled = await this.deleteProvenRoots(ledger);
      const clonesSettled = await this.reapRetiredClones(ledger);
      const allWorkspacesKnown = await this.reconcileWorkspaces(ledger);
      const status = this.finish(
        ledger,
        allWorkspacesKnown,
        rootsSettled && clonesSettled,
      );
      return { status, counts: installScopeMigrationCounts(ledger) };
    } catch (error: unknown) {
      // degradation-audit: reported - a ledger or registry write failed, so no
      // later step may run (its outcome could not be recorded). Logged; the
      // app start proceeds and the next start resumes from the last write.
      this.logger.error(
        '[install-scope] Migration stopped; it resumes on the next start',
        toError(error),
      );
      return { status: 'failed', counts: installScopeMigrationCounts(ledger) };
    }
  }

  /**
   * The ledger to resume from. Absent → fresh. Malformed → set aside as
   * `install-scope.json.corrupt-<ts>` (kept for diagnosis) and started fresh;
   * nothing a fresh run does is unsafe, because every delete re-proves itself.
   */
  private async loadLedgerForRun(): Promise<InstallScopeLedger> {
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf8');
    } catch (error: unknown) {
      if (isEnoent(error)) return emptyLedger();
      throw error;
    }
    const parsed = parseLedger(raw);
    if (parsed !== null) return parsed;
    const aside = `${this.ledgerPath}.corrupt-${Date.now()}`;
    await fs.rename(this.ledgerPath, aside);
    this.logger.warn('[install-scope] Ledger was malformed; set aside', {
      path: aside,
    });
    return emptyLedger();
  }

  /** Recompute outcomes and write the ledger atomically. Throws on failure. */
  private writeLedger(ledger: InstallScopeLedger): void {
    for (const item of Object.values(ledger.items)) {
      const outcome = itemOutcome(item);
      if (outcome === undefined) delete item.outcome;
      else item.outcome = outcome;
    }
    atomicWriteWithRetry(
      this.ledgerPath,
      `${JSON.stringify(ledger, null, 2)}\n`,
    );
  }

  // ------------------------------------------------------- step 1: retire

  /**
   * Fix the item set: every global skills.sh root and every retired MCP
   * server. The registry is written BEFORE the ledger names an item retired,
   * so a crash in between re-runs this step (both writes are merges).
   *
   * Every read that can throw (the MCP intent store, the plugin listing) runs
   * BEFORE the registry write: a corrupt intent file stops the run with no
   * skills.sh root retired and no ledger, so nothing changed (decision #85).
   */
  private async retire(ledger: InstallScopeLedger): Promise<void> {
    const retiredMcp = this.mcpIntents.listRetired();
    const rootIds = await this.listGlobalSkillsShRoots();
    const registry = await this.writeRetiredRegistry(rootIds);

    for (const rootId of rootIds) {
      const itemId = skillsShRetiredItemId(rootId);
      if (own(ledger.items, itemId)) continue;
      ledger.items[itemId] = {
        kind: 'skills-sh',
        retired: true,
        retiredAt: registry.roots[rootId]?.retiredAt,
        removedPaths: {},
        keptPaths: {},
        failedPaths: {},
      };
    }
    for (const server of retiredMcp) {
      const itemId = mcpRetiredItemId(server.serverKey);
      if (own(ledger.items, itemId)) continue;
      ledger.items[itemId] = {
        kind: 'mcp',
        retired: true,
        retiredAt: server.retiredAt,
        removedPaths: {},
        keptPaths: {},
        failedPaths: {},
      };
    }
    ledger.discoveredAt = new Date().toISOString();
    this.writeLedger(ledger);
    this.logger.info('[install-scope] Retired legacy global installs', {
      skillsShRoots: rootIds.length,
      items: Object.keys(ledger.items).length,
    });
  }

  /**
   * `ptah-skillssh-*` entries directly under `~/.ptah/plugins` that are
   * directories or links (a linked root is retired, then refused by the
   * proof). Staging dirs (`.staging-ptah-skillssh-*`), bundled plugins,
   * `external/` and `ptah-harness-*` never match.
   *
   * A root whose v2 metadata says `scope: 'global'` is NOT legacy: it is an
   * explicit global install (or Make global) written by this release, possibly
   * by another host before this one first migrated. It is never retired, so
   * the proof cannot delete it.
   *
   * A metadata read error other than "missing" or "invalid" (EACCES, EIO, …)
   * leaves its scope unknown: the root may be a new global install, so it is
   * NOT retired (it stays active and on disk) and discovery continues with
   * the other roots (decision #85).
   */
  private async listGlobalSkillsShRoots(): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.pluginsBasePath, { withFileTypes: true });
    } catch (error: unknown) {
      if (isEnoent(error)) return [];
      throw error;
    }
    const rootIds: string[] = [];
    for (const entry of entries) {
      if (!isSkillsShRootId(entry.name)) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      let read: Awaited<ReturnType<typeof readRootMetadata>>;
      try {
        read = await readRootMetadata(this.rootDirOf(entry.name));
      } catch (error: unknown) {
        // degradation-audit: reported - logged; an unknown scope is never
        // retired (it may be global), and one unreadable root must not block
        // every other root's migration.
        this.logger.warn(
          '[install-scope] Skipped a skills.sh root whose metadata could not be read',
          { rootId: entry.name, error: errorMessage(error) },
        );
        continue;
      }
      if (
        read.status === 'ok' &&
        read.metadata.version === 2 &&
        read.metadata.scope === 'global'
      ) {
        continue;
      }
      rootIds.push(entry.name);
    }
    return rootIds.sort();
  }

  /**
   * The retired registry as it is NOW. Make global and a global reinstall
   * clear a root's mark after discovery, so every delete and reap checks this,
   * not the ledger.
   *
   * `null` means the registry gives no trustworthy answer, and the caller must
   * HOLD: decide, release and reap nothing, so no ledger item is dropped and
   * the run stays incomplete (retried next start). That is the case for a
   * malformed or unreadable file, and for a missing file while the ledger
   * holds skills.sh items (discovery wrote it and nothing in Ptah deletes it).
   * Only a valid registry without a root's mark means the user took that
   * root back (decision #85). With no skills.sh item a missing file is
   * simply an empty registry.
   */
  private async readLiveRetiredRegistry(
    ledger: InstallScopeLedger,
  ): Promise<SkillsShRetiredRegistry | null> {
    const registryPath = path.join(
      this.pluginsBasePath,
      SKILLS_SH_RETIRED_FILE,
    );
    let raw: string;
    try {
      raw = await fs.readFile(registryPath, 'utf8');
    } catch (error: unknown) {
      // degradation-audit: reported - a missing file with no skills.sh item
      // is an empty registry; otherwise logged, the caller holds every
      // skills.sh step and the run stays incomplete until a readable registry
      // answers.
      if (isEnoent(error) && sortedItems(ledger, 'skills-sh').length === 0) {
        return { version: 1, roots: {} };
      }
      this.logger.warn(
        '[install-scope] Retired registry could not be read; skills.sh cleanup waits for the next start',
        { path: registryPath, error: errorMessage(error) },
      );
      return null;
    }
    const registry = parseRegistry(raw);
    if (registry === null) {
      this.logger.warn(
        '[install-scope] Retired registry is malformed; skills.sh cleanup waits for the next start',
        { path: registryPath },
      );
    }
    return registry;
  }

  /**
   * Merge `rootIds` into the retired registry, keeping every existing entry
   * and its `retiredAt`. A malformed registry retires nothing (D-2) and is
   * replaced; any other read error throws and stops the run.
   */
  private async writeRetiredRegistry(
    rootIds: readonly string[],
  ): Promise<SkillsShRetiredRegistry> {
    const registryPath = path.join(
      this.pluginsBasePath,
      SKILLS_SH_RETIRED_FILE,
    );
    let existing: SkillsShRetiredRegistry | null = null;
    try {
      const raw = await fs.readFile(registryPath, 'utf8');
      existing = parseRegistry(raw);
      if (existing === null) {
        this.logger.warn(
          '[install-scope] Retired registry was malformed; rewriting it',
          { path: registryPath },
        );
      }
    } catch (error: unknown) {
      if (!isEnoent(error)) throw error;
    }

    const roots: SkillsShRetiredRegistry['roots'] = {
      ...(existing?.roots ?? {}),
    };
    const retiredAt = new Date().toISOString();
    let changed = existing === null && rootIds.length > 0;
    for (const rootId of rootIds) {
      if (own(roots, rootId)) continue;
      roots[rootId] = { retiredAt };
      changed = true;
    }
    const registry: SkillsShRetiredRegistry = { version: 1, roots };
    if (changed) {
      atomicWriteWithRetry(
        registryPath,
        `${JSON.stringify(registry, null, 2)}\n`,
      );
    }
    return registry;
  }

  // -------------------------------------------- step 2a: proven root deletes

  /**
   * One proof and one ledger write per root. A root already removed or
   * already counted `onDisk` is final and never re-proved; only roots never
   * decided and roots whose deletion failed are processed.
   *
   * A root no longer in the LIVE retired registry (Make global or a global
   * reinstall cleared its mark after discovery) is not the migration's any
   * more: it is never deleted, and EVERY item for it, decided or not, gets the
   * live-state correction of {@link releaseUnretiredRoot}.
   *
   * Returns `false` when the live registry could not answer (see
   * {@link readLiveRetiredRegistry}): nothing was decided or released, and the
   * run must stay incomplete.
   */
  private async deleteProvenRoots(
    ledger: InstallScopeLedger,
  ): Promise<boolean> {
    const live = await this.readLiveRetiredRegistry(ledger);
    if (live === null) return false;
    let settled = true;
    for (const [itemId, item] of sortedItems(ledger, 'skills-sh')) {
      const rootId = itemId.slice('skills-sh:'.length);
      const rootDir = this.rootDirOf(rootId);
      if (!isRetiredSkillsShRoot(rootId, live)) {
        if (this.releaseUnretiredRoot(ledger, itemId, item, rootDir)) {
          this.writeLedger(ledger);
        }
        continue;
      }
      if (own(item.removedPaths, rootDir) || item.onDisk !== undefined) {
        continue;
      }
      const decided = await this.decideRoot(ledger, itemId, item, rootDir);
      if (!decided) settled = false;
      this.writeLedger(ledger);
    }
    return settled;
  }

  /**
   * The user took this root back (it is no longer retired). Its ledger item is
   * corrected to the live state; nothing on disk is touched:
   *
   *   - a pending failure for the root itself is dropped (it will never be
   *     deleted now);
   *   - a pending failure for a user-layer clone moves to `keptPaths`: the
   *     reaper never visits an un-retired root's clones again, so the failure
   *     could never resolve, and the clone stays where it is;
   *   - an item that recorded nothing (no row, no `onDisk`) is dropped, so the
   *     notice neither counts it retired nor reports a path it never touched;
   *   - any other item keeps its removed / kept / `onDisk` evidence and is no
   *     longer counted retired.
   *
   * Returns whether the ledger changed (so a settled item is not rewritten on
   * every start).
   */
  private releaseUnretiredRoot(
    ledger: InstallScopeLedger,
    itemId: string,
    item: InstallScopeLedgerItem,
    rootDir: string,
  ): boolean {
    let changed = false;
    if (own(item.failedPaths, rootDir)) {
      delete item.failedPaths[rootDir];
      changed = true;
    }
    for (const p of Object.keys(item.failedPaths)) {
      if (!isWithin(this.userLayerBase, p)) continue;
      if (!own(item.removedPaths, p)) item.keptPaths[p] = KEPT_ROOT_UNRETIRED;
      delete item.failedPaths[p];
      changed = true;
    }
    const recorded =
      item.onDisk !== undefined ||
      Object.keys(item.removedPaths).length > 0 ||
      Object.keys(item.keptPaths).length > 0 ||
      Object.keys(item.failedPaths).length > 0;
    if (!recorded) {
      delete ledger.items[itemId];
      changed = true;
    } else if (item.retired) {
      item.retired = false;
      changed = true;
    }
    if (changed) {
      this.logger.info(
        '[install-scope] Released a skills.sh root that is no longer retired',
        { rootDir },
      );
    }
    return changed;
  }

  /**
   * Prove and delete (or keep) one root. The live registry is read again
   * right before `fs.rm`, so a root the user took back while this pass ran is
   * released, not deleted. Returns `false` when that read could not answer:
   * the root is left undecided for the next start.
   */
  private async decideRoot(
    ledger: InstallScopeLedger,
    itemId: string,
    item: InstallScopeLedgerItem,
    rootDir: string,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const proof = await verifyOwnedRoot(rootDir);
    if (proof.status === 'owned') {
      const live = await this.readLiveRetiredRegistry(ledger);
      if (live === null) return false;
      if (!isRetiredSkillsShRoot(itemId.slice('skills-sh:'.length), live)) {
        this.releaseUnretiredRoot(ledger, itemId, item, rootDir);
        return true;
      }
      try {
        // `rm` removes a link inside the tree, never its target; the proof
        // above has already refused any link.
        await fs.rm(rootDir, { recursive: true, force: true });
        item.removedPaths[rootDir] = now;
        delete item.failedPaths[rootDir];
        this.logger.info('[install-scope] Deleted proven skills.sh root', {
          rootDir,
        });
      } catch (error: unknown) {
        // degradation-audit: reported - logged and kept in failedPaths; the
        // next start retries this root only.
        item.failedPaths[rootDir] = errorMessage(error);
        this.logger.warn('[install-scope] Could not delete a proven root', {
          rootDir,
          error: errorMessage(error),
        });
      }
      return true;
    }
    if (proof.reason === 'root-missing') {
      // Gone since discovery. If an earlier deletion of ours "failed" but the
      // root is now absent, it was removed after all.
      if (own(item.failedPaths, rootDir)) {
        item.removedPaths[rootDir] = now;
        delete item.failedPaths[rootDir];
      }
      return true;
    }
    item.onDisk = rootDir;
    item.onDiskReason = proof.reason;
    delete item.failedPaths[rootDir];
    this.logger.info('[install-scope] Kept unproven skills.sh root on disk', {
      rootDir,
      reason: proof.reason,
    });
    return true;
  }

  // ----------------------------------------------- step 2b: retired clones

  /**
   * Hand the retired ids to the reaper — the one clone-deletion rule — and
   * file its per-clone rows under their items. Skipped once a sweep passed
   * with no failure; otherwise retried until one does.
   *
   * Returns `false` when the live registry could not answer: no sweep ran,
   * nothing was recorded, and the run must stay incomplete.
   */
  private async reapRetiredClones(
    ledger: InstallScopeLedger,
  ): Promise<boolean> {
    const skillsItems = sortedItems(ledger, 'skills-sh');
    const failedClone = skillsItems.some(([, item]) =>
      Object.keys(item.failedPaths).some((p) =>
        isWithin(this.userLayerBase, p),
      ),
    );
    if (ledger.clonesPassedAt !== undefined && !failedClone) return true;

    const live = await this.readLiveRetiredRegistry(ledger);
    if (live === null) return false;

    // A clone whose earlier deletion "failed" but is gone now was removed.
    for (const [, item] of skillsItems) {
      for (const p of Object.keys(item.failedPaths)) {
        if (!isWithin(this.userLayerBase, p)) continue;
        if (await pathIsAbsent(p)) {
          item.removedPaths[p] = new Date().toISOString();
          delete item.failedPaths[p];
        }
      }
    }

    // Only this ledger's roots, so the sweep never acts on an id retired by
    // some other path and never counts a clone the migration did not own —
    // and only those STILL retired, so the clones of a root the user took
    // back (Make global, global reinstall) are never reaped.
    const registry: SkillsShRetiredRegistry = { version: 1, roots: {} };
    for (const [itemId, item] of skillsItems) {
      const rootId = itemId.slice('skills-sh:'.length);
      if (!isRetiredSkillsShRoot(rootId, live)) continue;
      registry.roots[rootId] = {
        retiredAt: item.retiredAt ?? ledger.discoveredAt ?? '',
      };
    }

    let result: ReapResult;
    try {
      result = await this.reaper.reapRetired(this.userLayerRoots(), registry);
    } catch (error: unknown) {
      // degradation-audit: reported - logged; clonesPassedAt stays unset so
      // the next start sweeps again. Nothing was recorded as done.
      this.logger.warn('[install-scope] Retired-clone sweep failed', {
        error: errorMessage(error),
      });
      delete ledger.clonesPassedAt;
      this.writeLedger(ledger);
      return true;
    }

    const now = new Date().toISOString();
    for (const row of result.reapedPaths) {
      const item = this.itemForRef(ledger, row.sourceRef);
      if (!item) continue;
      item.removedPaths[row.path] = now;
      delete item.failedPaths[row.path];
    }
    for (const row of result.keptPaths) {
      const item = this.itemForRef(ledger, row.sourceRef);
      if (!item || own(item.removedPaths, row.path)) continue;
      item.keptPaths[row.path] = row.reason;
      delete item.failedPaths[row.path];
    }
    for (const row of result.failedPaths) {
      const item = this.itemForRef(ledger, row.sourceRef);
      if (!item || own(item.removedPaths, row.path)) continue;
      item.failedPaths[row.path] = row.error;
    }
    // A root listing that failed is counted in `errors` with no row.
    const unlistedErrors = result.errors - result.failedPaths.length;
    if (result.failedPaths.length === 0 && unlistedErrors <= 0) {
      ledger.clonesPassedAt = now;
    } else {
      delete ledger.clonesPassedAt;
    }
    this.writeLedger(ledger);
    return true;
  }

  private userLayerRoots(): UserLayerRoots {
    return {
      skills: path.join(this.userLayerBase, 'skills'),
      commands: path.join(this.userLayerBase, 'commands'),
      agents: path.join(this.userLayerBase, USER_LAYER_AGENTS_DIR_NAME),
    };
  }

  private itemForRef(
    ledger: InstallScopeLedger,
    sourceRef: string | null,
  ): InstallScopeLedgerItem | undefined {
    if (sourceRef === null || !own(ledger.items, sourceRef)) return undefined;
    return ledger.items[sourceRef];
  }

  // --------------------------------------------------- step 3: workspaces

  /**
   * One full reconcile per known workspace without `passedAt`, each followed
   * by a ledger write before the next workspace starts. Returns `false` when
   * the set of known workspaces could not be read completely, in which case
   * the run cannot complete.
   */
  private async reconcileWorkspaces(
    ledger: InstallScopeLedger,
  ): Promise<boolean> {
    const { roots, complete } = await this.knownWorkspaceRoots();

    // A workspace an earlier run did not finish stays known while its
    // directory exists, even if it dropped off the recent list since.
    for (const [key, workspace] of Object.entries(ledger.workspaces)) {
      if (workspace.passedAt !== undefined || roots.has(key)) continue;
      const probe = await probeDirectory(workspace.root);
      if (probe === 'directory') {
        roots.set(key, workspace.root);
      } else if (probe === 'unreadable') {
        // Not proven gone: it keeps no passedAt/missingAt, so the run stays
        // incomplete and the next start retries it.
        this.logger.warn('[install-scope] Workspace could not be checked', {
          root: workspace.root,
        });
      } else if (workspace.missingAt === undefined) {
        this.forgetMissingWorkspace(ledger, key, workspace);
        this.writeLedger(ledger);
      }
    }

    for (const [key, root] of roots) {
      const previous = own(ledger.workspaces, key)
        ? ledger.workspaces[key]
        : undefined;
      if (previous?.passedAt !== undefined) continue;
      const workspace: InstallScopeLedgerWorkspace = { root };
      if (previous?.failedPaths !== undefined) {
        workspace.failedPaths = previous.failedPaths;
      }
      ledger.workspaces[key] = workspace;

      let health: HarnessHealth;
      try {
        health = await this.reconciler.reconcile(root, {
          mode: 'full',
          reason: INSTALL_SCOPE_MIGRATION_REASON,
        });
      } catch (error: unknown) {
        // degradation-audit: reported - logged and recorded on the workspace;
        // it has no passedAt, so the next start reconciles it again.
        workspace.lastError = errorMessage(error);
        this.logger.warn('[install-scope] Workspace reconcile failed', {
          root,
          error: workspace.lastError,
        });
        this.writeLedger(ledger);
        continue;
      }

      const failedKeys = this.mergeHealth(ledger, health);
      if (failedKeys.length === 0) {
        this.clearStaleFailures(ledger, workspace);
        delete workspace.failedPaths;
        workspace.passedAt = new Date().toISOString();
      } else {
        workspace.failedPaths = failedKeys;
        workspace.lastError = `${failedKeys.length} retired cop${failedKeys.length === 1 ? 'y' : 'ies'} could not be removed`;
      }
      this.writeLedger(ledger);
    }
    return complete;
  }

  /**
   * A path this workspace failed on an earlier run that its passing retry no
   * longer reports is not the reconciler's to remove any more (it reports
   * every absent or kept retired copy, so silence means it is not owned):
   * nothing is left to retry or to count, so the failure is dropped.
   */
  private clearStaleFailures(
    ledger: InstallScopeLedger,
    workspace: InstallScopeLedgerWorkspace,
  ): void {
    for (const key of workspace.failedPaths ?? []) {
      for (const item of Object.values(ledger.items)) {
        if (own(item.failedPaths, key)) {
          delete item.failedPaths[key];
          this.logger.info('[install-scope] Dropped a stale failure', { key });
        }
      }
    }
  }

  /**
   * Recent workspaces ∪ open folders, existing directories only, keyed by the
   * canonical harness root (the key the reconciler locks on). A candidate
   * whose stat fails for any reason other than absence (EACCES, EIO, …) makes
   * the set incomplete, so the run cannot complete without visiting it.
   */
  private async knownWorkspaceRoots(): Promise<{
    roots: Map<string, string>;
    complete: boolean;
  }> {
    let complete = true;
    const candidates: string[] = [];
    try {
      candidates.push(
        ...(await this.recentWorkspaces.list()).map((entry) => entry.path),
      );
    } catch (error: unknown) {
      // degradation-audit: reported - logged; the run cannot complete without
      // the full list, so the next start tries again.
      complete = false;
      this.logger.warn('[install-scope] Could not list recent workspaces', {
        error: errorMessage(error),
      });
    }
    try {
      candidates.push(...this.workspaceProvider.getWorkspaceFolders());
    } catch (error: unknown) {
      // degradation-audit: reported - as above, the run stays incomplete.
      complete = false;
      this.logger.warn('[install-scope] Could not list open folders', {
        error: errorMessage(error),
      });
    }

    const roots = new Map<string, string>();
    for (const candidate of candidates) {
      if (!candidate || !path.isAbsolute(candidate)) continue;
      const probe = await probeDirectory(candidate);
      if (probe === 'unreadable') {
        complete = false;
        this.logger.warn('[install-scope] Workspace could not be checked', {
          root: candidate,
        });
        continue;
      }
      if (probe === 'absent') continue;
      const root = resolveHarnessWorkspaceRoot(candidate);
      if (!roots.has(root)) roots.set(root, root);
    }
    return { roots, complete };
  }

  /**
   * Merge one pass into the ledger. Paths are keyed by `harnessPathIdentity`,
   * so a home-config fragment counts once however many workspaces reached
   * it. A removed path never leaves `removedPaths`; a later success moves a
   * failed path there. Returns the keys of the retired copies that failed.
   */
  private mergeHealth(
    ledger: InstallScopeLedger,
    health: HarnessHealth,
  ): string[] {
    const now = new Date().toISOString();
    const failed: string[] = [];
    for (const target of health.targets) {
      for (const row of target.removedRetired ?? []) {
        const item = this.itemFor(ledger, row.itemId);
        const key = harnessPathIdentity(health.workspaceRoot, row.relPath);
        item.removedPaths[key] = item.removedPaths[key] ?? now;
        delete item.failedPaths[key];
      }
      for (const row of target.keptRetired ?? []) {
        const item = this.itemFor(ledger, row.itemId);
        const key = harnessPathIdentity(health.workspaceRoot, row.relPath);
        if (own(item.removedPaths, key)) continue;
        item.keptPaths[key] = row.reason;
        delete item.failedPaths[key];
      }
      for (const row of target.writeFailed) {
        if (row.itemId === undefined) continue;
        const item = this.itemFor(ledger, row.itemId);
        const key = harnessPathIdentity(health.workspaceRoot, row.relPath);
        if (own(item.removedPaths, key)) continue;
        item.failedPaths[key] = row.reason;
        failed.push(key);
      }
    }
    return failed;
  }

  /**
   * The ledger item for a reconciler row. A retired id the discovery step did
   * not see (retired later by another path) still gets an item, so a path the
   * reconciler deleted is never lost from the record.
   */
  private itemFor(
    ledger: InstallScopeLedger,
    itemId: string,
  ): InstallScopeLedgerItem {
    if (!own(ledger.items, itemId)) {
      ledger.items[itemId] = {
        kind: itemId.startsWith('mcp:') ? 'mcp' : 'skills-sh',
        retired: true,
        removedPaths: {},
        keptPaths: {},
        failedPaths: {},
      };
    }
    return ledger.items[itemId];
  }

  /**
   * A workspace that failed earlier and no longer exists as a directory: no
   * pass can run there again, so the failures only it recorded are dropped
   * (nothing is left to retry or to count) and it stops being a known
   * workspace.
   */
  private forgetMissingWorkspace(
    ledger: InstallScopeLedger,
    key: string,
    workspace: InstallScopeLedgerWorkspace,
  ): void {
    workspace.missingAt = new Date().toISOString();
    this.clearStaleFailures(ledger, workspace);
    delete workspace.failedPaths;
    this.logger.info('[install-scope] Workspace no longer exists', { key });
  }

  // -------------------------------------------------------- step 4: finish

  /**
   * `registryAnswered` is `false` when the live retired registry could not be
   * read this run: the skills.sh steps held, so the run cannot complete.
   */
  private finish(
    ledger: InstallScopeLedger,
    allWorkspacesKnown: boolean,
    registryAnswered: boolean,
  ): InstallScopeMigrationRunStatus {
    const itemsDone = Object.values(ledger.items).every(
      (item) => itemOutcome(item) !== undefined,
    );
    const workspacesDone = Object.values(ledger.workspaces).every(
      (ws) => ws.passedAt !== undefined || ws.missingAt !== undefined,
    );
    if (
      ledger.discoveredAt === undefined ||
      ledger.clonesPassedAt === undefined ||
      !registryAnswered ||
      !allWorkspacesKnown ||
      !itemsDone ||
      !workspacesDone
    ) {
      this.logger.info('[install-scope] Migration incomplete; will retry', {
        clonesPassed: ledger.clonesPassedAt !== undefined,
        registryAnswered,
        allWorkspacesKnown,
        itemsDone,
        workspacesDone,
      });
      return 'incomplete';
    }
    ledger.completedAt = new Date().toISOString();
    this.writeLedger(ledger);
    this.logger.info('[install-scope] Migration completed', {
      counts: installScopeMigrationCounts(ledger),
    });
    return 'completed';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCloneReaper(logger: Logger): InstallScopeCloneReaper {
  return new UserLayerOrphanReaper(logger, new UserLayerFsOps(logger));
}

function createMcpIntentSource(
  intentPath: string,
): InstallScopeRetiredMcpSource {
  return new McpIntentStore(intentPath);
}

function parseLedger(raw: string): InstallScopeLedger | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // degradation-audit: optional-capability - malformed JSON is reported to
    // the caller as `null`, which sets the file aside and starts fresh.
    return null;
  }
  const parsed = LedgerSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function parseRegistry(raw: string): SkillsShRetiredRegistry | null {
  try {
    return parseSkillsShRetiredRegistry(JSON.parse(raw));
  } catch {
    // degradation-audit: optional-capability - a malformed registry retires
    // nothing by contract (D-2); the caller logs it and rewrites the file.
    return null;
  }
}

function sortedItems(
  ledger: InstallScopeLedger,
  kind: InstallScopeLedgerItem['kind'],
): Array<[string, InstallScopeLedgerItem]> {
  return Object.entries(ledger.items)
    .filter(([, item]) => item.kind === kind)
    .sort(([a], [b]) => a.localeCompare(b));
}

function keptPathRows(ledger: InstallScopeLedger): InstallScopeKeptPath[] {
  const removed = new Set<string>();
  for (const item of Object.values(ledger.items)) {
    for (const p of Object.keys(item.removedPaths)) removed.add(p);
  }
  const rows = new Map<string, InstallScopeKeptPath>();
  for (const [itemId, item] of Object.entries(ledger.items)) {
    for (const [p, reason] of Object.entries(item.keptPaths)) {
      if (removed.has(p) || rows.has(p)) continue;
      rows.set(p, { path: p, reason, itemId });
    }
  }
  return [...rows.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function pathIsAbsent(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return false;
  } catch (error: unknown) {
    // degradation-audit: optional-capability - only ENOENT proves absence;
    // any other error leaves the path failed for the next retry.
    return isEnoent(error);
  }
}

/**
 * `absent` only when the path is proven not to be a directory (ENOENT,
 * ENOTDIR, or a non-directory entry); any other stat failure is `unreadable`
 * and must not count as absent.
 */
async function probeDirectory(
  target: string,
): Promise<'directory' | 'absent' | 'unreadable'> {
  try {
    return (await fs.stat(target)).isDirectory() ? 'directory' : 'absent';
  } catch (error: unknown) {
    // degradation-audit: optional-capability - only ENOENT/ENOTDIR prove a
    // workspace is gone; any other error is reported as unreadable so the
    // caller keeps the run incomplete and retries it.
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unreadable';
  }
}
