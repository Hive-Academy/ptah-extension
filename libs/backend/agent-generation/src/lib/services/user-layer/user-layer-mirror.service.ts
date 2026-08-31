import { injectable, inject } from 'tsyringe';
import { homedir } from 'os';
import { join, basename } from 'path';
import { mkdir, readdir, stat } from 'fs/promises';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import {
  USER_LAYER_AGENTS_DIR_NAME,
  userLayerAgentDirName,
} from '@ptah-extension/shared';
import type {
  OriginKind,
  OriginSidecar,
  UserLayerRoots,
} from './origin-sidecar.types';
import {
  DEFAULT_HISTORY_DIR,
  ORIGIN_SIDECAR_FILENAME,
} from './origin-sidecar.types';
import {
  computeSourceHash,
  writeSidecarAtomic,
  writeSidecarAtomicAt,
  readSidecar,
  readSidecarAt,
} from './source-hash';
import type { CollectFilesResult } from './source-hash';
import { UserLayerFsOps } from './user-layer-fs-ops';
import {
  UserLayerOrphanReaper,
  collectUpstreamLiveness,
  emptyReapResult,
} from './user-layer-orphan-reaper';
import type { OrphanedClone, ReapResult } from './user-layer-orphan-reaper';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

export type { UserLayerRoots } from './origin-sidecar.types';
export type {
  OrphanedClone,
  ReapResult,
  UpstreamLiveness,
} from './user-layer-orphan-reaper';

export interface MirrorSources {
  pluginPaths: string[];
  /**
   * `~/.ptah/plugins/ptah-harness-*` roots — the skill plugins the harness
   * builder writes.
   *
   * They are SEPARATE from `pluginPaths` because they come from a different
   * producer (`PluginLoaderService.discoverHarnessPluginPaths()`, not
   * `resolvePluginPaths(enabledIds)`) and were therefore missing from every
   * mirror call while being present in every junction call — defect 6. Once
   * inside this service they are treated identically to a bundled plugin: same
   * `skills/` + `commands/` layout, same sidecar, same `pluginId`
   * (`ptah-harness-<slug>`), same divergence tracking.
   */
  harnessPluginRoots?: string[];
  /**
   * Optional so a caller that only wants a single plugin mirrored (the harness
   * builder, right after it writes one) does not have to name a synth root it
   * has no opinion about. Absent means "not scanned", which also means synth
   * clones are never reaped on that pass.
   */
  synthesizedSkillsRoot?: string;
  agentSourceDir?: string;
  /**
   * The workspace {@link agentSourceDir} belongs to. Agent clones are keyed by
   * it — see {@link UserLayerMirrorService.getUserLayerRoots}.
   *
   * Optional and independent of `agentSourceDir` on purpose: a caller mirroring
   * only plugins has no workspace to name, and a caller that supplies the
   * source directory without the root lands in the unscoped base, which is what
   * every pass did before TASK_2026_365.
   */
  workspaceRoot?: string;
  /**
   * `~/.ptah/plugins`. Only the reap path needs it — to tell a DISABLED plugin
   * (dir still present, clones kept) from an UNINSTALLED one (dir gone, clones
   * reaped). Defaults to the parent of the first supplied plugin path.
   */
  pluginsBasePath?: string;
}

export interface MirrorResult {
  skillsMirrored: number;
  agentsMirrored: number;
  commandsMirrored: number;
  skipped: number;
  conflicts: number;
  errors: number;
}

export interface CloneEntry {
  slug: string;
  kind: OriginKind;
  pluginId: string | null;
  sourceHash: string;
  diverged: boolean;
  lastEnhancedAt: number | null;
  pendingSourceHash: string | null;
  /** Upstream is gone but the clone carried local work, so it was kept. */
  orphaned: boolean;
}

export interface DivergedClone {
  kind: OriginKind;
  slug: string;
  pendingSourceHash: string;
}

export interface ReconcileResult {
  noop: number;
  fastForwarded: number;
  diverged: number;
  missingSidecar: number;
  errors: number;
  divergedSlugs: DivergedClone[];
  /**
   * Clones whose upstream vanished and which carried no local work: snapshotted
   * to `.history/` and deleted. Always `0` from {@link
   * UserLayerMirrorService.reconcile}; only {@link
   * UserLayerMirrorService.reconcileAll} sweeps.
   */
  reaped: number;
  /** Clones whose upstream vanished but which were KEPT and flagged. */
  orphaned: number;
  reapedClones: OrphanedClone[];
  orphanedClones: OrphanedClone[];
}

/**
 * The workspace whose agent clones a single-clone operation addresses.
 *
 * Ignored for `skill` and `command`, whose roots are per-machine and flat. An
 * `agent` operation that omits it addresses the unscoped base, which holds only
 * the clones written before TASK_2026_365.
 */
interface WorkspaceScopedArgs {
  workspaceRoot?: string;
}

export interface RebaseCloneArgs extends WorkspaceScopedArgs {
  kind: OriginKind;
  slug: string;
  sourceDir: string;
}

export interface RebaseResult {
  kind: OriginKind;
  slug: string;
  sourceHash: string;
  snapshotPath: string | null;
  failed?: boolean;
  reason?: string;
}

export interface KeepCloneArgs extends WorkspaceScopedArgs {
  kind: OriginKind;
  slug: string;
}

export interface KeepResult {
  kind: OriginKind;
  slug: string;
  sourceHash: string;
}

export interface WriteEnhancedSkillArgs {
  slug: string;
  newBody: string;
}

export interface WriteEnhancedFileCloneArgs extends WorkspaceScopedArgs {
  kind: 'agent' | 'command';
  slug: string;
  newBody: string;
}

export interface WriteEnhancedResult {
  slug: string;
  historyTs: string | null;
  currentContentHash: string;
}

export interface RevertCloneArgs extends WorkspaceScopedArgs {
  kind: OriginKind;
  slug: string;
  historyTs: string;
}

export interface RevertResult {
  kind: OriginKind;
  slug: string;
  revertedFrom: string;
  newHistoryTs: string | null;
  restored: boolean;
}

export interface HistoryEntry {
  ts: string;
  path: string;
  hasSkillMd: boolean;
}

const SYNTH_CANDIDATES_DIR = '_candidates';

@injectable()
export class UserLayerMirrorService {
  private readonly inflight = new Map<string, Promise<void>>();
  /**
   * The two extracted collaborators (TASK_2026_278). They are constructed here
   * rather than injected because both are pure internal machinery with a single
   * owner — the DI token, class name and every public signature on this facade
   * are unchanged, which is the whole point of the split.
   */
  private readonly fsOps: UserLayerFsOps;
  private readonly reaper: UserLayerOrphanReaper;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.fsOps = new UserLayerFsOps(logger);
    this.reaper = new UserLayerOrphanReaper(logger, this.fsOps);
  }

  /**
   * The three user-layer roots, with `agents` scoped to ONE workspace.
   *
   * Skills and commands are per-machine content and keep a flat root. Agents do
   * not: the setup wizard tailors each one to a project's stack and names it
   * after the ROLE, so two projects write two different `backend-developer.md`.
   * A flat root gave them one destination, and `reconcileFileClone`'s
   * fast-forward then flipped it back and forth on every activation — with the
   * reconciler rewriting `.codex/agents` and `.github/agents` behind it in
   * whichever workspace ran last (TASK_2026_365).
   *
   * This is the ONE place the scope is applied. Every method below reads its
   * agent root from here, so a caller that forgets to pass the workspace lands
   * in the unscoped base rather than in another project's directory.
   */
  getUserLayerRoots(workspaceRoot?: string): UserLayerRoots {
    const base = join(homedir(), '.ptah', 'user');
    const agentsBase = join(base, USER_LAYER_AGENTS_DIR_NAME);
    return {
      skills: join(base, 'skills'),
      agents:
        workspaceRoot === undefined
          ? agentsBase
          : join(agentsBase, userLayerAgentDirName(workspaceRoot)),
      commands: join(base, 'commands'),
    };
  }

  /** The unscoped `~/.ptah/user/agents`, which holds the pre-key clones. */
  private legacyAgentsRoot(): string {
    return join(homedir(), '.ptah', 'user', USER_LAYER_AGENTS_DIR_NAME);
  }

  async mirrorAll(sources: MirrorSources): Promise<MirrorResult> {
    const result: MirrorResult = {
      skillsMirrored: 0,
      agentsMirrored: 0,
      commandsMirrored: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    };
    const roots = this.getUserLayerRoots(sources.workspaceRoot);
    const seenSkillSlugs = new Map<string, string>();

    for (const pluginPath of allPluginRoots(sources)) {
      const pluginId = basename(pluginPath);
      await this.mirrorPluginSkills(
        pluginPath,
        pluginId,
        roots.skills,
        seenSkillSlugs,
        result,
      );
      await this.mirrorPluginCommands(pluginPath, roots.commands, result);
    }

    if (sources.synthesizedSkillsRoot) {
      await this.mirrorSynthesizedSkills(
        sources.synthesizedSkillsRoot,
        roots.skills,
        seenSkillSlugs,
        result,
      );
    }

    if (sources.agentSourceDir) {
      await this.seedLegacyAgents(sources.workspaceRoot, roots.agents);
      await this.mirrorAgents(sources.agentSourceDir, roots.agents, result);
    }

    this.logger.info('[UserLayerMirror] mirrorAll complete', {
      ...result,
    });
    return result;
  }

  async listClones(workspaceRoot?: string): Promise<CloneEntry[]> {
    const roots = this.getUserLayerRoots(workspaceRoot);
    const entries: CloneEntry[] = [];
    const scanRoots: string[] = [roots.skills, roots.agents, roots.commands];

    for (const root of scanRoots) {
      let dirEntries: string[];
      try {
        dirEntries = await readdir(root);
      } catch (error: unknown) {
        if (this.isEnoent(error)) {
          continue;
        }
        throw error;
      }

      for (const name of dirEntries) {
        if (name === ORIGIN_SIDECAR_FILENAME) {
          continue;
        }
        const entryPath = join(root, name);
        let entryStat;
        try {
          entryStat = await stat(entryPath);
        } catch {
          continue;
        }

        let sidecar: OriginSidecar | null = null;
        if (entryStat.isDirectory()) {
          sidecar = await readSidecar(entryPath);
        } else if (name.endsWith(ORIGIN_SIDECAR_SUFFIX)) {
          sidecar = await readSidecarAt(entryPath);
        }

        if (!sidecar) {
          continue;
        }
        entries.push(toCloneEntry(sidecar));
      }
    }
    return entries;
  }

  /**
   * The origin record of ONE clone, or `null` when the clone has no sidecar
   * (user-authored) or does not exist.
   *
   * `listClones()` walks all three roots; a single-clone UI read (`getClone`)
   * should not pay for that, and asking the mirror keeps the sidecar format
   * behind this class exactly as `listClones` does.
   */
  async readCloneOrigin(
    kind: OriginKind,
    slug: string,
    workspaceRoot?: string,
  ): Promise<CloneEntry | null> {
    const roots = this.getUserLayerRoots(workspaceRoot);
    const sidecar =
      kind === 'skill'
        ? await readSidecar(join(roots.skills, slug))
        : await readSidecarAt(
            join(
              kind === 'agent' ? roots.agents : roots.commands,
              `${slug}${ORIGIN_SIDECAR_SUFFIX}`,
            ),
          );
    return sidecar ? toCloneEntry(sidecar) : null;
  }

  async reconcile(sources: MirrorSources): Promise<ReconcileResult> {
    const result = emptyReconcileResult();
    const roots = this.getUserLayerRoots(sources.workspaceRoot);

    for (const pluginPath of allPluginRoots(sources)) {
      const pluginId = basename(pluginPath);
      await this.reconcilePluginSkills(
        pluginPath,
        pluginId,
        roots.skills,
        result,
      );
      await this.reconcilePluginCommands(
        pluginPath,
        pluginId,
        roots.commands,
        result,
      );
    }

    if (sources.synthesizedSkillsRoot) {
      await this.reconcileSynthesizedSkills(
        sources.synthesizedSkillsRoot,
        roots.skills,
        result,
      );
    }

    if (sources.agentSourceDir) {
      await this.reconcileAgents(sources.agentSourceDir, roots.agents, result);
    }

    this.logger.info('[UserLayerMirror] reconcile complete', {
      noop: result.noop,
      fastForwarded: result.fastForwarded,
      diverged: result.diverged,
      missingSidecar: result.missingSidecar,
      errors: result.errors,
    });
    return result;
  }

  /**
   * The call every host activation should make, unconditionally.
   *
   * `reconcile()` alone was gated on `!result.fromCache` — a divergence check
   * that only ran when a download happened, which is defect 8: a clone the user
   * edited between two cached activations was never noticed, and a slug deleted
   * upstream was never reaped at all. This is the full source-side sweep:
   * three-way reconcile, then the deleted-upstream pass.
   *
   * It is cheap by construction — both halves are a directory walk plus a
   * content hash per artifact, with no network and no LLM — so running it on
   * every activation is the intended usage, not a fallback.
   */
  async reconcileAll(sources: MirrorSources): Promise<ReconcileResult> {
    const result = await this.reconcile(sources);
    const reap = await this.reapDeletedUpstream(sources);
    result.reaped = reap.reaped;
    result.orphaned = reap.orphaned;
    result.reapedClones = reap.reapedClones;
    result.orphanedClones = reap.orphanedClones;
    result.errors += reap.errors;
    return result;
  }

  /**
   * Visit every clone whose sidecar names an upstream that no longer exists.
   * Exposed on its own so a caller that already reconciled (or that only wants
   * the sweep after an uninstall) does not have to re-run the three-way pass.
   */
  async reapDeletedUpstream(sources: MirrorSources): Promise<ReapResult> {
    try {
      const live = await collectUpstreamLiveness({
        pluginPaths: allPluginRoots(sources),
        ...(sources.synthesizedSkillsRoot
          ? { synthesizedSkillsRoot: sources.synthesizedSkillsRoot }
          : {}),
        ...(sources.agentSourceDir
          ? { agentSourceDir: sources.agentSourceDir }
          : {}),
        ...(sources.pluginsBasePath
          ? { pluginsBasePath: sources.pluginsBasePath }
          : {}),
        synthCandidatesDirName: SYNTH_CANDIDATES_DIR,
        fs: this.fsOps,
      });
      return await this.reaper.reap(
        this.getUserLayerRoots(sources.workspaceRoot),
        live,
      );
    } catch (error: unknown) {
      this.logger.warn('[UserLayerMirror] deleted-upstream sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      const failed = emptyReapResult();
      failed.errors = 1;
      return failed;
    }
  }

  async rebaseClone(args: RebaseCloneArgs): Promise<RebaseResult> {
    return this.withSlugLock(args.kind, args.slug, async () => {
      const roots = this.getUserLayerRoots(args.workspaceRoot);
      if (args.kind === 'skill') {
        return this.rebaseDirClone(args.slug, args.sourceDir, roots.skills);
      }
      const root = args.kind === 'agent' ? roots.agents : roots.commands;
      return this.rebaseFileClone(args.kind, args.slug, args.sourceDir, root);
    });
  }

  async keepClone(args: KeepCloneArgs): Promise<KeepResult> {
    return this.withSlugLock(args.kind, args.slug, async () => {
      const roots = this.getUserLayerRoots(args.workspaceRoot);
      if (args.kind === 'skill') {
        return this.keepDirClone(args.slug, roots.skills);
      }
      const root = args.kind === 'agent' ? roots.agents : roots.commands;
      return this.keepFileClone(args.kind, args.slug, root);
    });
  }

  async writeEnhancedSkill(
    args: WriteEnhancedSkillArgs,
  ): Promise<WriteEnhancedResult> {
    return this.withSlugLock('skill', args.slug, async () => {
      const roots = this.getUserLayerRoots();
      const cloneDir = join(roots.skills, args.slug);
      this.assertUnderUserLayer(cloneDir);

      let historyTs: string | null = null;
      if (await this.dirExists(cloneDir)) {
        historyTs = basename(await this.snapshotDirToHistory(cloneDir));
      } else {
        await mkdir(cloneDir, { recursive: true });
      }

      const skillFile = join(cloneDir, 'SKILL.md');
      this.assertUnderUserLayer(skillFile);
      await this.writeTextAtomic(skillFile, args.newBody);

      const currentContentHash = await computeSourceHash(cloneDir);
      await this.refreshEnhancedSidecarDir(
        cloneDir,
        args.slug,
        currentContentHash,
      );

      return { slug: args.slug, historyTs, currentContentHash };
    });
  }

  async writeEnhancedFileClone(
    args: WriteEnhancedFileCloneArgs,
  ): Promise<WriteEnhancedResult> {
    return this.withSlugLock(args.kind, args.slug, async () => {
      const roots = this.getUserLayerRoots(args.workspaceRoot);
      const rootDir = args.kind === 'agent' ? roots.agents : roots.commands;
      const cloneFile = join(rootDir, `${args.slug}.md`);
      const sidecarPath = join(rootDir, `${args.slug}${ORIGIN_SIDECAR_SUFFIX}`);
      this.assertUnderUserLayer(cloneFile);
      this.assertUnderUserLayer(sidecarPath);

      let historyTs: string | null = null;
      if (await this.fileExists(cloneFile)) {
        this.assertUnderUserLayer(cloneFile);
        historyTs = basename(
          await this.snapshotFileToHistory(rootDir, args.slug, cloneFile),
        );
      }

      await this.writeTextAtomic(cloneFile, args.newBody);

      const currentContentHash = await computeSourceHash(cloneFile);
      const existing = await readSidecarAt(sidecarPath);
      const sidecar: OriginSidecar = existing
        ? {
            ...existing,
            currentContentHash,
            lastEnhancedAt: Date.now(),
          }
        : {
            ...this.buildSidecar(
              args.kind,
              args.slug,
              null,
              currentContentHash,
            ),
            lastEnhancedAt: Date.now(),
          };
      await writeSidecarAtomicAt(sidecarPath, sidecar);

      return { slug: args.slug, historyTs, currentContentHash };
    });
  }

  async revert(args: RevertCloneArgs): Promise<RevertResult> {
    return this.withSlugLock(args.kind, args.slug, async () => {
      const roots = this.getUserLayerRoots(args.workspaceRoot);
      if (args.kind === 'skill') {
        return this.revertDirClone(args.slug, args.historyTs, roots.skills);
      }
      const root = args.kind === 'agent' ? roots.agents : roots.commands;
      return this.revertFileClone(args.kind, args.slug, args.historyTs, root);
    });
  }

  async listHistory(
    kind: OriginKind,
    slug: string,
    workspaceRoot?: string,
  ): Promise<HistoryEntry[]> {
    const roots = this.getUserLayerRoots(workspaceRoot);
    const historyParent =
      kind === 'skill'
        ? join(roots.skills, slug, DEFAULT_HISTORY_DIR)
        : join(
            kind === 'agent' ? roots.agents : roots.commands,
            DEFAULT_HISTORY_DIR,
            slug,
          );

    let names: string[];
    try {
      names = await this.listSubdirectories(historyParent);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return [];
      }
      throw error;
    }

    const entries: HistoryEntry[] = [];
    const fileName = kind === 'skill' ? 'SKILL.md' : `${slug}.md`;
    for (const ts of names) {
      const tsDir = join(historyParent, ts);
      entries.push({
        ts,
        path: tsDir,
        hasSkillMd: await this.fileExists(join(tsDir, fileName)),
      });
    }
    entries.sort((a, b) => b.ts.localeCompare(a.ts));
    return entries;
  }

  private async revertDirClone(
    slug: string,
    historyTs: string,
    skillsRoot: string,
  ): Promise<RevertResult> {
    const cloneDir = join(skillsRoot, slug);
    const historyDir = join(cloneDir, DEFAULT_HISTORY_DIR, historyTs);
    this.assertUnderUserLayer(cloneDir);
    this.assertUnderUserLayer(historyDir);

    if (!(await this.dirExists(historyDir))) {
      this.logger.warn('[UserLayerMirror] revert skipped: history missing', {
        slug,
        historyTs,
      });
      return {
        kind: 'skill',
        slug,
        revertedFrom: historyTs,
        newHistoryTs: null,
        restored: false,
      };
    }

    let newHistoryTs: string | null = null;
    if (await this.dirExists(cloneDir)) {
      newHistoryTs = basename(await this.snapshotDirToHistory(cloneDir));
      await this.clearCloneTrackedContent(cloneDir);
    } else {
      await mkdir(cloneDir, { recursive: true });
    }

    await this.copyTree(historyDir, cloneDir);
    const currentContentHash = await computeSourceHash(cloneDir);
    await this.refreshEnhancedSidecarDir(cloneDir, slug, currentContentHash);

    return {
      kind: 'skill',
      slug,
      revertedFrom: historyTs,
      newHistoryTs,
      restored: true,
    };
  }

  private async revertFileClone(
    kind: OriginKind,
    slug: string,
    historyTs: string,
    rootDir: string,
  ): Promise<RevertResult> {
    const cloneFile = join(rootDir, `${slug}.md`);
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    const historyDir = join(rootDir, DEFAULT_HISTORY_DIR, slug, historyTs);
    const historyFile = join(historyDir, `${slug}.md`);
    this.assertUnderUserLayer(cloneFile);
    this.assertUnderUserLayer(historyDir);

    if (!(await this.fileExists(historyFile))) {
      this.logger.warn('[UserLayerMirror] revert skipped: history missing', {
        kind,
        slug,
        historyTs,
      });
      return {
        kind,
        slug,
        revertedFrom: historyTs,
        newHistoryTs: null,
        restored: false,
      };
    }

    let newHistoryTs: string | null = null;
    if (await this.fileExists(cloneFile)) {
      newHistoryTs = basename(
        await this.snapshotFileToHistory(rootDir, slug, cloneFile),
      );
    }
    await mkdir(rootDir, { recursive: true });
    await this.copyFileAtomic(historyFile, cloneFile);

    const currentContentHash = await computeSourceHash(cloneFile);
    const existing = await readSidecarAt(sidecarPath);
    const sidecar: OriginSidecar = existing
      ? {
          ...existing,
          currentContentHash,
          lastEnhancedAt: Date.now(),
        }
      : {
          ...this.buildSidecar(kind, slug, null, currentContentHash),
          lastEnhancedAt: Date.now(),
        };
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, sidecar);

    return {
      kind,
      slug,
      revertedFrom: historyTs,
      newHistoryTs,
      restored: true,
    };
  }

  private async refreshEnhancedSidecarDir(
    cloneDir: string,
    slug: string,
    currentContentHash: string,
  ): Promise<void> {
    const existing = await readSidecar(cloneDir);
    const sidecar: OriginSidecar = existing
      ? {
          ...existing,
          lastEnhancedAt: Date.now(),
          currentContentHash,
        }
      : {
          ...this.buildSidecar('skill', slug, null, currentContentHash),
          lastEnhancedAt: Date.now(),
        };
    this.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, sidecar);
  }

  private async writeTextAtomic(
    targetFile: string,
    content: string,
  ): Promise<void> {
    await this.fsOps.writeTextAtomic(targetFile, content);
  }

  private async rebaseDirClone(
    slug: string,
    sourceDir: string,
    skillsRoot: string,
  ): Promise<RebaseResult> {
    const cloneDir = join(skillsRoot, slug);
    this.assertUnderUserLayer(cloneDir);
    if (!(await this.dirExists(sourceDir))) {
      this.logger.warn(
        '[UserLayerMirror] rebase skipped: source backup missing',
        { slug, sourceDir },
      );
      return {
        kind: 'skill',
        slug,
        sourceHash: '',
        snapshotPath: null,
        failed: true,
        reason: 'source-missing',
      };
    }
    let snapshotPath: string | null = null;
    if (await this.dirExists(cloneDir)) {
      snapshotPath = await this.snapshotDirToHistory(cloneDir);
      await this.clearCloneTrackedContent(cloneDir);
    }
    await this.copyTree(sourceDir, cloneDir);
    const newSourceHash = await computeSourceHash(sourceDir);
    const existing = await readSidecar(cloneDir);
    const sidecar: OriginSidecar = existing
      ? {
          ...existing,
          sourceHash: newSourceHash,
          clonedAt: Date.now(),
          currentContentHash: newSourceHash,
          diverged: false,
          pendingSourceHash: undefined,
        }
      : this.buildSidecar('skill', slug, null, newSourceHash);
    this.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, sidecar);
    return { kind: 'skill', slug, sourceHash: newSourceHash, snapshotPath };
  }

  private async rebaseFileClone(
    kind: OriginKind,
    slug: string,
    sourceFile: string,
    rootDir: string,
  ): Promise<RebaseResult> {
    const cloneFile = join(rootDir, `${slug}.md`);
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(cloneFile);
    if (!(await this.fileExists(sourceFile))) {
      this.logger.warn(
        '[UserLayerMirror] rebase skipped: source backup missing',
        { kind, slug, sourceFile },
      );
      return {
        kind,
        slug,
        sourceHash: '',
        snapshotPath: null,
        failed: true,
        reason: 'source-missing',
      };
    }
    let snapshotPath: string | null = null;
    if (await this.fileExists(cloneFile)) {
      snapshotPath = await this.snapshotFileToHistory(rootDir, slug, cloneFile);
    }
    await mkdir(rootDir, { recursive: true });
    await this.copyFileAtomic(sourceFile, cloneFile);
    const newSourceHash = await computeSourceHash(sourceFile);
    const existing = await readSidecarAt(sidecarPath);
    const sidecar: OriginSidecar = existing
      ? {
          ...existing,
          sourceHash: newSourceHash,
          clonedAt: Date.now(),
          currentContentHash: newSourceHash,
          diverged: false,
          pendingSourceHash: undefined,
        }
      : this.buildSidecar(kind, slug, null, newSourceHash);
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, sidecar);
    return { kind, slug, sourceHash: newSourceHash, snapshotPath };
  }

  private async keepDirClone(
    slug: string,
    skillsRoot: string,
  ): Promise<KeepResult> {
    const cloneDir = join(skillsRoot, slug);
    this.assertUnderUserLayer(cloneDir);
    const sidecar = await readSidecar(cloneDir);
    if (!sidecar) {
      return { kind: 'skill', slug, sourceHash: '' };
    }
    const liveCloneHash = await computeSourceHash(cloneDir);
    const newSourceHash = sidecar.pendingSourceHash ?? sidecar.sourceHash;
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      currentContentHash: liveCloneHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    await writeSidecarAtomic(cloneDir, updated);
    return { kind: 'skill', slug, sourceHash: newSourceHash };
  }

  private async keepFileClone(
    kind: OriginKind,
    slug: string,
    rootDir: string,
  ): Promise<KeepResult> {
    const cloneFile = join(rootDir, `${slug}.md`);
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(sidecarPath);
    const sidecar = await readSidecarAt(sidecarPath);
    if (!sidecar) {
      return { kind, slug, sourceHash: '' };
    }
    const liveCloneHash = await computeSourceHash(cloneFile);
    const newSourceHash = sidecar.pendingSourceHash ?? sidecar.sourceHash;
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      currentContentHash: liveCloneHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    await writeSidecarAtomicAt(sidecarPath, updated);
    return { kind, slug, sourceHash: newSourceHash };
  }

  private buildSidecar(
    kind: OriginKind,
    slug: string,
    pluginId: string | null,
    sourceHash: string,
  ): OriginSidecar {
    return {
      kind,
      slug,
      pluginId,
      version: null,
      sourceHash,
      clonedAt: Date.now(),
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: sourceHash,
    };
  }

  private async reconcilePluginSkills(
    pluginPath: string,
    pluginId: string,
    skillsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    const sourceSkillsDir = join(pluginPath, 'skills');
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(sourceSkillsDir);
    } catch (error: unknown) {
      if (!this.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn(
          '[UserLayerMirror] reconcile failed to read plugin skills',
          {
            sourceSkillsDir,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return;
    }

    for (const slug of slugs) {
      const sourceDir = join(sourceSkillsDir, slug);
      const cloneDir = join(skillsRoot, slug);
      await this.withSlugLock('skill', slug, async () => {
        await this.reconcileDirClone(
          'skill',
          slug,
          pluginId,
          sourceDir,
          cloneDir,
          result,
        );
      });
    }
  }

  /**
   * The pass that did not exist.
   *
   * `reconcile` walked plugin skills, plugin commands and workspace agents —
   * never `<skillsRoot>/<slug>`. A promoted synthesized skill therefore had a
   * clone that was created once and then frozen: an upstream re-promotion never
   * fast-forwarded it, and a user edit was never flagged diverged, which is why
   * "rebase a synth clone" looked like a missing RPC resolution when the
   * divergence it would act on was never detected either.
   *
   * `_candidates` is skipped for the same reason `mirrorSynthesizedSkills`
   * skips it: it is a staging area, not a skill.
   */
  private async reconcileSynthesizedSkills(
    synthesizedSkillsRoot: string,
    skillsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(synthesizedSkillsRoot);
    } catch (error: unknown) {
      if (!this.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn(
          '[UserLayerMirror] reconcile failed to read synth skills',
          {
            synthesizedSkillsRoot,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return;
    }

    for (const slug of slugs) {
      if (slug === SYNTH_CANDIDATES_DIR || slug === DEFAULT_HISTORY_DIR) {
        continue;
      }
      const sourceDir = join(synthesizedSkillsRoot, slug);
      const cloneDir = join(skillsRoot, slug);
      await this.withSlugLock('skill', slug, async () => {
        await this.reconcileDirClone(
          'skill',
          slug,
          null,
          sourceDir,
          cloneDir,
          result,
        );
      });
    }
  }

  private async reconcilePluginCommands(
    pluginPath: string,
    pluginId: string,
    commandsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    const sourceCommandsDir = join(pluginPath, 'commands');
    let files: string[];
    try {
      files = (await readdir(sourceCommandsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (!this.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn(
          '[UserLayerMirror] reconcile failed to read plugin commands',
          {
            sourceCommandsDir,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(sourceCommandsDir, fileName);
      const cloneFile = join(commandsRoot, fileName);
      await this.withSlugLock('command', slug, async () => {
        await this.reconcileFileClone(
          'command',
          slug,
          pluginId,
          sourceFile,
          cloneFile,
          commandsRoot,
          result,
        );
      });
    }
  }

  private async reconcileAgents(
    agentSourceDir: string,
    agentsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(agentSourceDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (!this.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn(
          '[UserLayerMirror] reconcile failed to read agent source',
          {
            agentSourceDir,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(agentSourceDir, fileName);
      const cloneFile = join(agentsRoot, fileName);
      await this.withSlugLock('agent', slug, async () => {
        await this.reconcileFileClone(
          'agent',
          slug,
          null,
          sourceFile,
          cloneFile,
          agentsRoot,
          result,
        );
      });
    }
  }

  private async reconcileDirClone(
    kind: OriginKind,
    slug: string,
    expectedPluginId: string | null,
    sourceDir: string,
    cloneDir: string,
    result: ReconcileResult,
  ): Promise<void> {
    try {
      if (!(await this.dirExists(cloneDir))) {
        return;
      }
      this.assertUnderUserLayer(cloneDir);

      const sidecar = await readSidecar(cloneDir);
      if (!sidecar) {
        await this.reconcileMissingSidecar(cloneDir, sourceDir, {
          kind,
          slug,
          pluginId: expectedPluginId,
        });
        result.missingSidecar += 1;
        return;
      }
      if (!ownsClone(sidecar, expectedPluginId)) {
        return;
      }

      const liveSourceHash = await computeSourceHash(sourceDir);
      if (liveSourceHash === sidecar.sourceHash) {
        result.noop += 1;
        return;
      }

      const liveCloneHash = await computeSourceHash(cloneDir);
      if (liveCloneHash === sidecar.sourceHash) {
        await this.snapshotDirToHistory(cloneDir);
        await this.clearCloneTrackedContent(cloneDir);
        await this.copyTree(sourceDir, cloneDir);
        await this.refreshSidecarDir(cloneDir, sidecar, liveSourceHash);
        result.fastForwarded += 1;
        return;
      }

      await this.markDivergedDir(cloneDir, sidecar, liveSourceHash);
      result.diverged += 1;
      result.divergedSlugs.push({
        kind,
        slug,
        pendingSourceHash: liveSourceHash,
      });
    } catch (error: unknown) {
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] reconcile failed for skill', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileFileClone(
    kind: OriginKind,
    slug: string,
    pluginId: string | null,
    sourceFile: string,
    cloneFile: string,
    rootDir: string,
    result: ReconcileResult,
  ): Promise<void> {
    try {
      if (!(await this.fileExists(cloneFile))) {
        return;
      }
      this.assertUnderUserLayer(cloneFile);

      const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
      const sidecar = await readSidecarAt(sidecarPath);
      if (!sidecar) {
        await this.reconcileMissingFileSidecar(rootDir, cloneFile, slug, {
          kind,
          slug,
          pluginId,
        });
        result.missingSidecar += 1;
        return;
      }
      if (!ownsClone(sidecar, pluginId)) {
        return;
      }

      const liveSourceHash = await computeSourceHash(sourceFile);
      if (liveSourceHash === sidecar.sourceHash) {
        result.noop += 1;
        return;
      }

      const liveCloneHash = await computeSourceHash(cloneFile);
      if (liveCloneHash === sidecar.sourceHash) {
        await this.snapshotFileToHistory(rootDir, slug, cloneFile);
        await this.copyFileAtomic(sourceFile, cloneFile);
        await this.refreshSidecarAt(sidecarPath, sidecar, liveSourceHash);
        result.fastForwarded += 1;
        return;
      }

      await this.markDivergedAt(sidecarPath, sidecar, liveSourceHash);
      result.diverged += 1;
      result.divergedSlugs.push({
        kind,
        slug,
        pendingSourceHash: liveSourceHash,
      });
    } catch (error: unknown) {
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] reconcile failed for file clone', {
        kind,
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async refreshSidecarDir(
    cloneDir: string,
    sidecar: OriginSidecar,
    newSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      clonedAt: Date.now(),
      currentContentHash: newSourceHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    this.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, updated);
  }

  private async refreshSidecarAt(
    sidecarPath: string,
    sidecar: OriginSidecar,
    newSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      clonedAt: Date.now(),
      currentContentHash: newSourceHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, updated);
  }

  private async markDivergedDir(
    cloneDir: string,
    sidecar: OriginSidecar,
    pendingSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      diverged: true,
      pendingSourceHash,
    };
    this.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, updated);
  }

  private async markDivergedAt(
    sidecarPath: string,
    sidecar: OriginSidecar,
    pendingSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      diverged: true,
      pendingSourceHash,
    };
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, updated);
  }

  private async snapshotDirToHistory(cloneDir: string): Promise<string> {
    return this.fsOps.snapshotDirToHistory(cloneDir);
  }

  private async makeUniqueHistoryDir(
    parentDir: string,
    ts: string,
  ): Promise<string> {
    return this.fsOps.makeUniqueHistoryDir(parentDir, ts);
  }

  private async snapshotFileToHistory(
    rootDir: string,
    slug: string,
    cloneFile: string,
  ): Promise<string> {
    return this.fsOps.snapshotFileToHistory(rootDir, slug, cloneFile);
  }

  private async withSlugLock<T>(
    kind: OriginKind,
    slug: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = `${kind}/${slug}`;
    const prior = this.inflight.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    this.inflight.set(key, gate);
    await prior.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.inflight.get(key) === gate) {
        this.inflight.delete(key);
      }
    }
  }

  private async mirrorPluginSkills(
    pluginPath: string,
    pluginId: string,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    const sourceSkillsDir = join(pluginPath, 'skills');
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(sourceSkillsDir);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read plugin skills', {
        sourceSkillsDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const slug of slugs) {
      await this.mirrorSkillSlug(
        join(sourceSkillsDir, slug),
        slug,
        pluginId,
        skillsRoot,
        seenSkillSlugs,
        result,
      );
    }
  }

  private async mirrorSynthesizedSkills(
    synthesizedSkillsRoot: string,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(synthesizedSkillsRoot);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read synth skills', {
        synthesizedSkillsRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const slug of slugs) {
      if (slug === SYNTH_CANDIDATES_DIR) {
        continue;
      }
      await this.mirrorSkillSlug(
        join(synthesizedSkillsRoot, slug),
        slug,
        null,
        skillsRoot,
        seenSkillSlugs,
        result,
      );
    }
  }

  private async mirrorSkillSlug(
    sourceDir: string,
    slug: string,
    pluginId: string | null,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    const targetDir = join(skillsRoot, slug);
    this.assertUnderUserLayer(targetDir);

    if (seenSkillSlugs.has(slug)) {
      const ownerSource = seenSkillSlugs.get(slug) as string;
      await this.recordConflict(targetDir, ownerSource, sourceDir);
      result.conflicts += 1;
      this.logger.warn('[UserLayerMirror] slug collision; first-write wins', {
        slug,
        owner: ownerSource,
        loser: sourceDir,
      });
      return;
    }

    if (await this.dirExists(targetDir)) {
      const existingSidecar = await readSidecar(targetDir);
      if (!existingSidecar) {
        await this.reconcileMissingSidecar(targetDir, sourceDir, {
          kind: 'skill',
          slug,
          pluginId,
        });
      }
      seenSkillSlugs.set(slug, sourceDir);
      result.skipped += 1;
      return;
    }

    try {
      await this.copyTree(sourceDir, targetDir);
      const hashSignal: CollectFilesResult = { truncatedAtDepth: false };
      const sourceHash = await computeSourceHash(sourceDir, hashSignal);
      if (hashSignal.truncatedAtDepth) {
        this.logger.warn(
          '[UserLayerMirror] source hash truncated at recursion depth; skill tree too deep',
          { slug, sourceDir },
        );
      }
      await this.writeOriginSidecar(targetDir, {
        kind: 'skill',
        slug,
        pluginId,
        sourceHash,
      });
      seenSkillSlugs.set(slug, sourceDir);
      result.skillsMirrored += 1;
    } catch (error: unknown) {
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to mirror skill', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileMissingSidecar(
    targetDir: string,
    sourceDir: string,
    base: { kind: OriginKind; slug: string; pluginId: string | null },
  ): Promise<void> {
    try {
      const sourceHash = await computeSourceHash(targetDir);
      await this.writeOriginSidecar(targetDir, {
        kind: base.kind,
        slug: base.slug,
        pluginId: base.pluginId,
        sourceHash,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[UserLayerMirror] failed to reconcile missing sidecar',
        {
          slug: base.slug,
          sourceDir,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async mirrorPluginCommands(
    pluginPath: string,
    commandsRoot: string,
    result: MirrorResult,
  ): Promise<void> {
    const sourceCommandsDir = join(pluginPath, 'commands');
    let files: string[];
    try {
      files = (await readdir(sourceCommandsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read plugin commands', {
        sourceCommandsDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(sourceCommandsDir, fileName);
      const targetFile = join(commandsRoot, fileName);
      this.assertUnderUserLayer(targetFile);

      if (await this.fileExists(targetFile)) {
        await this.reconcileMissingFileSidecar(commandsRoot, targetFile, slug, {
          kind: 'command',
          slug,
          pluginId: basename(pluginPath),
        });
        result.skipped += 1;
        continue;
      }

      try {
        await mkdir(commandsRoot, { recursive: true });
        await this.copyFileAtomic(sourceFile, targetFile);
        const sourceHash = await computeSourceHash(sourceFile);
        await this.writeFileSidecar(commandsRoot, slug, {
          kind: 'command',
          slug,
          pluginId: basename(pluginPath),
          sourceHash,
        });
        result.commandsMirrored += 1;
      } catch (error: unknown) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] failed to mirror command', {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Carry the pre-key clones into a workspace's own directory, once.
   *
   * Agents are MANIFEST-OWNED downstream, so a desired state that goes empty is
   * a deletion of every `.codex/agents/*.toml` and `.github/agents/*.agent.md`
   * the workspace has. Introducing the key without this step would empty the
   * scoped directory on the first pass after the upgrade and reap all of them,
   * silently, reported as an ordinary clean pass — the same failure mode the
   * `agentSyncEnabled` and `skillSyncMode` migrations exist to avoid.
   *
   * So the flat clones are copied in as a SEED. The mirror and reconcile that
   * run immediately after converge that seed onto the workspace's own
   * `{ws}/.claude/agents`, which is the truth for this project. A workspace with
   * no `.claude/agents` keeps exactly what it has today, now private to it.
   *
   * Three deliberate limits:
   *
   * - It runs only when the scoped directory does not exist. Once the workspace
   *   has one, the flat base is never read again.
   * - It copies `.md` clones and their sidecars, and NOT `.history`. That
   *   history is the interleaved record of every workspace on the machine, so
   *   copying it into one project would assert an edit trail that project never
   *   had.
   * - It never deletes the flat originals. Cleanup of a user's files is not
   *   automatic here, on the quarantine precedent.
   */
  private async seedLegacyAgents(
    workspaceRoot: string | undefined,
    scopedAgentsRoot: string,
  ): Promise<void> {
    const legacyRoot = this.legacyAgentsRoot();
    if (workspaceRoot === undefined || scopedAgentsRoot === legacyRoot) return;
    if (await this.dirExists(scopedAgentsRoot)) return;

    let names: string[];
    try {
      names = (await readdir(legacyRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name);
    } catch {
      return;
    }
    if (names.length === 0) return;

    this.assertUnderUserLayer(scopedAgentsRoot);
    let seeded = 0;
    for (const fileName of names) {
      const slug = fileName.replace(/\.md$/, '');
      const sidecarName = `${slug}${ORIGIN_SIDECAR_SUFFIX}`;
      try {
        await mkdir(scopedAgentsRoot, { recursive: true });
        await this.copyFileAtomic(
          join(legacyRoot, fileName),
          join(scopedAgentsRoot, fileName),
        );
        if (await this.fileExists(join(legacyRoot, sidecarName))) {
          await this.copyFileAtomic(
            join(legacyRoot, sidecarName),
            join(scopedAgentsRoot, sidecarName),
          );
        }
        seeded += 1;
      } catch (error: unknown) {
        // Reported and skipped rather than thrown: a seed that copies fourteen
        // of fifteen leaves one agent to be re-mirrored from the workspace's own
        // source, while a throw would abandon the whole mirror pass.
        this.logger.warn('[UserLayerMirror] failed to seed legacy agent', {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.logger.info('[UserLayerMirror] seeded agent clones from legacy root', {
      workspaceRoot,
      scopedAgentsRoot,
      seeded,
    });
  }

  private async mirrorAgents(
    agentSourceDir: string,
    agentsRoot: string,
    result: MirrorResult,
  ): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(agentSourceDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read agent source', {
        agentSourceDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(agentSourceDir, fileName);
      const targetFile = join(agentsRoot, fileName);
      this.assertUnderUserLayer(targetFile);

      if (await this.fileExists(targetFile)) {
        await this.reconcileMissingFileSidecar(agentsRoot, targetFile, slug, {
          kind: 'agent',
          slug,
          pluginId: null,
        });
        result.skipped += 1;
        continue;
      }

      try {
        await mkdir(agentsRoot, { recursive: true });
        await this.copyFileAtomic(sourceFile, targetFile);
        const sourceHash = await computeSourceHash(sourceFile);
        await this.writeFileSidecar(agentsRoot, slug, {
          kind: 'agent',
          slug,
          pluginId: null,
          sourceHash,
        });
        result.agentsMirrored += 1;
      } catch (error: unknown) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] failed to mirror agent', {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async recordConflict(
    targetDir: string,
    ownerSource: string,
    loserSource: string,
  ): Promise<void> {
    const sidecar = await readSidecar(targetDir);
    if (!sidecar) {
      return;
    }
    if (sidecar.conflictsWith) {
      return;
    }
    sidecar.conflictsWith = loserSource;
    await writeSidecarAtomic(targetDir, sidecar);
  }

  private async writeOriginSidecar(
    dir: string,
    base: {
      kind: OriginKind;
      slug: string;
      pluginId: string | null;
      sourceHash: string;
    },
  ): Promise<void> {
    const now = Date.now();
    const sidecar: OriginSidecar = {
      kind: base.kind,
      slug: base.slug,
      pluginId: base.pluginId,
      version: null,
      sourceHash: base.sourceHash,
      clonedAt: now,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: base.sourceHash,
    };
    await writeSidecarAtomic(dir, sidecar);
  }

  private async reconcileMissingFileSidecar(
    rootDir: string,
    targetFile: string,
    slug: string,
    base: { kind: OriginKind; slug: string; pluginId: string | null },
  ): Promise<void> {
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    const existing = await readSidecarAt(sidecarPath);
    if (existing) {
      return;
    }
    try {
      const sourceHash = await computeSourceHash(targetFile);
      await this.writeFileSidecar(rootDir, slug, {
        kind: base.kind,
        slug: base.slug,
        pluginId: base.pluginId,
        sourceHash,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[UserLayerMirror] failed to reconcile missing file sidecar',
        {
          slug,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async writeFileSidecar(
    rootDir: string,
    slug: string,
    base: {
      kind: OriginKind;
      slug: string;
      pluginId: string | null;
      sourceHash: string;
    },
  ): Promise<void> {
    const now = Date.now();
    const sidecar: OriginSidecar = {
      kind: base.kind,
      slug: base.slug,
      pluginId: base.pluginId,
      version: null,
      sourceHash: base.sourceHash,
      clonedAt: now,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: base.sourceHash,
    };
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, sidecar);
  }

  private assertUnderUserLayer(targetPath: string): void {
    this.fsOps.assertUnderUserLayer(targetPath);
  }

  private async clearCloneTrackedContent(cloneDir: string): Promise<void> {
    await this.fsOps.clearCloneTrackedContent(cloneDir);
  }

  private async copyTree(sourceDir: string, targetDir: string): Promise<void> {
    await this.fsOps.copyTree(sourceDir, targetDir);
  }

  private async copyFileAtomic(
    sourceFile: string,
    targetFile: string,
  ): Promise<void> {
    await this.fsOps.copyFileAtomic(sourceFile, targetFile);
  }

  private async listSubdirectories(dir: string): Promise<string[]> {
    return this.fsOps.listSubdirectories(dir);
  }

  private async dirExists(dir: string): Promise<boolean> {
    return this.fsOps.dirExists(dir);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    return this.fsOps.fileExists(filePath);
  }

  private isEnoent(error: unknown): boolean {
    return this.fsOps.isEnoent(error);
  }
}

/**
 * Does this source own this clone?
 *
 * Slugs are global across the user layer but sources are not: two plugins can
 * ship the same slug, and `mirrorSkillSlug`'s first-write-wins rule picks ONE
 * owner and records `conflictsWith` on the loser. Reconciling the clone against
 * the loser's bytes would flag a divergence that is really just "the other
 * plugin's copy differs", and the user would be offered a rebase onto content
 * their clone was never made from.
 *
 * It is also what makes the synthesized-skill pass safe to add beside the
 * plugin pass: both walk `<skills>/<slug>`, and only the sidecar says which one
 * the clone came from.
 */
function ownsClone(
  sidecar: OriginSidecar,
  expectedPluginId: string | null,
): boolean {
  return sidecar.pluginId === expectedPluginId;
}

/** Bundled plugins and harness-authored plugins, in that order. */
function allPluginRoots(sources: MirrorSources): string[] {
  return [...sources.pluginPaths, ...(sources.harnessPluginRoots ?? [])];
}

function emptyReconcileResult(): ReconcileResult {
  return {
    noop: 0,
    fastForwarded: 0,
    diverged: 0,
    missingSidecar: 0,
    errors: 0,
    divergedSlugs: [],
    reaped: 0,
    orphaned: 0,
    reapedClones: [],
    orphanedClones: [],
  };
}

function toCloneEntry(sidecar: OriginSidecar): CloneEntry {
  return {
    slug: sidecar.slug,
    kind: sidecar.kind,
    pluginId: sidecar.pluginId,
    sourceHash: sidecar.sourceHash,
    diverged: sidecar.diverged,
    lastEnhancedAt: sidecar.lastEnhancedAt,
    pendingSourceHash: sidecar.pendingSourceHash ?? null,
    orphaned: sidecar.orphaned === true,
  };
}
