import { injectable, inject } from 'tsyringe';
import { homedir } from 'os';
import { join, basename, isAbsolute } from 'path';
import { lstat, mkdir, readdir, readFile, stat } from 'fs/promises';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { formatSourceHash } from '@ptah-extension/platform-core';
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
  parseOriginSidecar,
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
import {
  UserLayerSeedQuarantine,
  readAgentSourceListing,
} from './user-layer-seed-quarantine';
import type {
  AgentSourceListing,
  QuarantinedAgentsListing,
  QuarantineRestoreResult,
} from './user-layer-seed-quarantine';
import {
  UserLayerPluginAgents,
  sharedPluginBasenames,
  sourceIdentityChanged,
  sourceOwnership,
  withSourceIdentity,
} from './user-layer-plugin-agents';
import type {
  MirrorPluginDescriptor,
  MirrorPluginDescriptors,
  PluginAgentPass,
  SourceOwnership,
} from './user-layer-plugin-agents';
import { readCloneEditStateIn } from './user-layer-clone-state';
import type { CloneEditState } from './user-layer-clone-state';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';
const RETIRED_MANAGED_SKILL_SLUGS = [
  'execute-phase-gated-task',
  'extract-and-relocate-angular-component-feature',
] as const;
const retiredManagedSkillSlugs: ReadonlySet<string> = new Set(RETIRED_MANAGED_SKILL_SLUGS);

export interface RetiredSkillPreserved {
  readonly slug: string;
  readonly reason: 'missing-sidecar' | 'modified' | 'invalid-origin' | 'unsafe-path';
}

export interface RetiredSkillsResult {
  readonly removed: string[];
  readonly preserved: RetiredSkillPreserved[];
  errors: number;
}

export type { UserLayerRoots } from './origin-sidecar.types';
export type {
  QuarantinedAgentItem,
  QuarantinedAgentState,
  QuarantinedAgentsListing,
  QuarantineRestoreOutcome,
  QuarantineRestoreResult,
} from './user-layer-seed-quarantine';
export type {
  OrphanedClone,
  ReapResult,
  UpstreamLiveness,
} from './user-layer-orphan-reaper';
export type {
  MirrorPluginDescriptor,
  MirrorPluginDescriptors,
} from './user-layer-plugin-agents';
export type { CloneEditState } from './user-layer-clone-state';

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
  /**
   * The harness-resolved root whose Library agent directory receives PLUGIN
   * agents (`<plugin>/agents/*.md`). Set by every host whenever a workspace is
   * open, independent of agent-sync consent: consent gates propagation
   * (`buildAgents`), not the Library copy. Absent means plugin agents are not
   * mirrored on this pass.
   */
  libraryScopeRoot?: string;
  /**
   * Durable identity and label per absolute plugin path (A28). A clone made
   * or reconciled from a described path records `sourceRef`/`sourceLabel`; a
   * path without a descriptor carries the existing values forward.
   */
  pluginDescriptors?: MirrorPluginDescriptors;
}

export interface MirrorResult {
  retiredSkills: RetiredSkillsResult;
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
  retiredSkills: RetiredSkillsResult;
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
 * Every per-file failure a mirror or reconcile pass counted instead of
 * throwing, the managed-skill retirement included. A pass that resolves with
 * a nonzero count kept going past those files, so the Library may be missing
 * or holding stale items: a host reports it as a failed step, not a refresh.
 */
export function userLayerPassFailures(
  result: Pick<MirrorResult | ReconcileResult, 'errors' | 'retiredSkills'>,
): number {
  return result.errors + result.retiredSkills.errors;
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

export interface SaveCloneBodyArgs extends WorkspaceScopedArgs {
  kind: OriginKind;
  slug: string;
  /** Full replacement body. Not a patch — the clone file is overwritten. */
  body: string;
  /** Hash of the exact user-layer body seen when the draft was generated. */
  expectedSourceHash?: string;
}

export interface SaveCloneBodyResult {
  kind: OriginKind;
  slug: string;
  /** Snapshot stamp; `null` only when `written` is false. */
  historyTs: string | null;
  written: boolean;
  /** `'clone-missing'` or `'stale-source'` when no write occurred. */
  reason: string | null;
  /** Post-write content hash, or `null` when no write occurred or re-hashing failed. */
  currentContentHash: string | null;
  /**
   * `true` when the body IS on disk but a post-write bookkeeping step (the
   * content re-hash, or the sidecar read/write that carries it) failed.
   *
   * `written` stays `true` in that case, because it is true: the atomic rename
   * already happened. Reporting the save as a failure would tell the user their
   * edit was not saved while it sits committed on disk, and the only field left
   * stale is `currentContentHash`, which no control path reads — the reconciler
   * decides on `sourceHash` and two live hashes.
   *
   * The alternative — restoring the body from the snapshot taken one step
   * earlier — was rejected: it is a second destructive write, it has no
   * snapshot of its own, and if it fails the user has neither the old body nor
   * the new one. A committed write with incomplete bookkeeping is strictly the
   * better of the two end states.
   */
  metadataIncomplete: boolean;
  /**
   * `true` when the saved body is protected against the next reconcile pass,
   * i.e. the clone HAS an origin sidecar. The reconciler then sees
   * `liveCloneHash !== sidecar.sourceHash` and marks the clone diverged rather
   * than fast-forwarding over the edit.
   *
   * `false` means the clone has NO sidecar. The save correctly mints none — its
   * absence is the "user-authored, hands off" marker — but if the slug is also
   * shipped by a plugin, synth or agent source, `reconcileMissingSidecar` mints
   * one from the user's OWN content on the next pass, and the pass after that
   * fast-forwards over the saved body. That reconciler rule is pre-existing and
   * out of this surface's scope to change; what this flag buys is that the
   * editor can stop claiming an unqualified success for a write it cannot
   * promise will survive.
   */
  reconcileProtected: boolean;
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

/** What a fresh sidecar is minted from, before its hash is known. */
interface SidecarBase {
  kind: OriginKind;
  slug: string;
  pluginId: string | null;
  /** The plugin source's identity; absent for synth skills and workspace agents. */
  descriptor?: MirrorPluginDescriptor;
}

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
  private readonly seedQuarantine: UserLayerSeedQuarantine;
  private readonly pluginAgents: UserLayerPluginAgents;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.fsOps = new UserLayerFsOps(logger);
    this.reaper = new UserLayerOrphanReaper(logger, this.fsOps);
    this.seedQuarantine = new UserLayerSeedQuarantine(logger, this.fsOps);
    this.pluginAgents = new UserLayerPluginAgents(logger, this.fsOps);
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
      retiredSkills: await this.retireManagedSkills(),
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
      const descriptor = sources.pluginDescriptors?.[pluginPath];
      await this.mirrorPluginSkills(
        pluginPath,
        pluginId,
        descriptor,
        roots.skills,
        seenSkillSlugs,
        result,
      );
      await this.mirrorPluginCommands(
        pluginPath,
        descriptor,
        roots.commands,
        result,
      );
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
      // Read once: the seed and the quarantine must agree on which slugs this
      // workspace owns.
      const agentSource = await readAgentSourceListing(
        sources.agentSourceDir,
        this.fsOps,
      );
      await this.seedLegacyAgents(
        sources.workspaceRoot,
        roots.agents,
        agentSource,
      );
      const quarantine = await this.seedQuarantine.run({
        workspaceRoot: sources.workspaceRoot,
        scopedAgentsRoot: roots.agents,
        legacyAgentsRoot: this.legacyAgentsRoot(),
        source: await this.withPluginAgentSlugs(agentSource, roots.agents),
        withSlugLock: (slug, fn) => this.withSlugLock('agent', slug, fn),
      });
      result.errors += quarantine.failed.length;
      await this.mirrorAgents(sources.agentSourceDir, roots.agents, result);
    }

    // After the workspace agents: the legacy seed runs only while the scoped
    // directory is absent, and a workspace agent owns its slug (A8).
    const pluginAgentPass = this.pluginAgentPass(sources, result);
    if (pluginAgentPass) await this.pluginAgents.mirror(pluginAgentPass, result);

    this.logger.info('[UserLayerMirror] mirrorAll complete', {
      ...result,
    });
    return result;
  }

  /**
   * The agents the one-time seed quarantine moved out of this workspace's
   * scoped root, with their derived state. `workspaceRoot` is the root the
   * mirror pass keys the scoped agents dir by (the harness-resolved root), and
   * its `.claude/agents` is the source a Restore writes into. Read-only.
   */
  async listQuarantinedAgents(
    workspaceRoot: string,
  ): Promise<QuarantinedAgentsListing> {
    return this.seedQuarantine.listQuarantined(
      this.quarantineLocation(workspaceRoot),
    );
  }

  /**
   * Restore one quarantined agent as the workspace source file
   * `{workspaceRoot}/.claude/agents/<slug>.md`, from its quarantine snapshot,
   * under the same agent slug lock every other agent write takes. Never
   * overwrites, never deletes, never changes agent-sync consent.
   */
  async restoreQuarantinedAgent(
    workspaceRoot: string,
    slug: string,
  ): Promise<QuarantineRestoreResult> {
    return this.seedQuarantine.restore({
      ...this.quarantineLocation(workspaceRoot),
      slug,
      withSlugLock: (lockSlug, fn) => this.withSlugLock('agent', lockSlug, fn),
    });
  }

  private quarantineLocation(workspaceRoot: string): {
    scopedAgentsRoot: string;
    agentSourceDir: string;
  } {
    // A relative root would resolve the restore destination against the
    // process cwd, and an empty one would address the unscoped flat base.
    if (!isAbsolute(workspaceRoot)) {
      throw new Error(
        `[UserLayerMirror] quarantine needs an absolute workspace root: ${JSON.stringify(workspaceRoot)}`,
      );
    }
    return {
      scopedAgentsRoot: this.getUserLayerRoots(workspaceRoot).agents,
      agentSourceDir: join(workspaceRoot, '.claude', 'agents'),
    };
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

  /**
   * Whether ONE clone carries local edits, with its live content digest (the
   * approval digest of A21) and source identity. `scopeRoot` keys the agent
   * root exactly as `getUserLayerRoots` does; it is ignored for skills and
   * commands. `null` when the slug has no origin sidecar.
   */
  async readCloneEditState(
    kind: OriginKind,
    slug: string,
    scopeRoot?: string,
  ): Promise<CloneEditState | null> {
    return readCloneEditStateIn(this.getUserLayerRoots(scopeRoot), kind, slug);
  }

  /**
   * The plugin-agent pass for these sources, or `null` when no Library scope
   * root was supplied. A relative root would key the agent directory off the
   * process cwd, so it is refused and counted.
   */
  private pluginAgentPass(
    sources: MirrorSources,
    result: { errors: number },
  ): PluginAgentPass | null {
    const scopeRoot = sources.libraryScopeRoot;
    if (scopeRoot === undefined) return null;
    if (!isAbsolute(scopeRoot)) {
      result.errors += 1;
      this.logger.warn(
        '[UserLayerMirror] plugin agents not mirrored: library scope root is not absolute',
        { libraryScopeRoot: scopeRoot },
      );
      return null;
    }
    return {
      pluginPaths: allPluginRoots(sources),
      agentsRoot: this.getUserLayerRoots(scopeRoot).agents,
      descriptors: sources.pluginDescriptors,
      withSlugLock: (slug, fn) => this.withSlugLock('agent', slug, fn),
    };
  }

  async reconcile(sources: MirrorSources): Promise<ReconcileResult> {
    const result = emptyReconcileResult();
    result.retiredSkills = await this.retireManagedSkills();
    const roots = this.getUserLayerRoots(sources.workspaceRoot);
    const pluginRoots = allPluginRoots(sources);
    const sharedBasenames = sharedPluginBasenames(
      pluginRoots,
      sources.pluginDescriptors,
    );

    for (const pluginPath of pluginRoots) {
      const pluginId = basename(pluginPath);
      const descriptor = sources.pluginDescriptors?.[pluginPath];
      await this.reconcilePluginSkills(
        pluginPath,
        pluginId,
        descriptor,
        sharedBasenames.has(pluginId),
        roots.skills,
        result,
      );
      await this.reconcilePluginCommands(
        pluginPath,
        pluginId,
        descriptor,
        sharedBasenames.has(pluginId),
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

    const pluginAgentPass = this.pluginAgentPass(sources, result);
    if (pluginAgentPass) {
      await this.pluginAgents.reconcile(pluginAgentPass, result, (clone) =>
        this.reconcileFileClone(
          'agent',
          clone.slug,
          clone.pluginId,
          clone.sourceFile,
          clone.cloneFile,
          clone.agentsRoot,
          result,
          clone.descriptor,
          clone.basenameShared,
        ),
      );
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

  /** Retire only untouched mirror-owned copies of the two removed pipeline skills. */
  async retireManagedSkills(): Promise<RetiredSkillsResult> {
    const result: RetiredSkillsResult = { removed: [], preserved: [], errors: 0 };
    const skillsRoot = this.getUserLayerRoots().skills;
    this.fsOps.excludeSubdirectoriesFromListing(skillsRoot, retiredManagedSkillSlugs);
    try {
      const rootStat = await lstat(skillsRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        this.logger.warn('[UserLayerMirror] retired skills root is not a real directory', { skillsRoot });
        return result;
      }
    } catch (error: unknown) {
      if (this.isEnoent(error)) return result;
      this.logger.warn('[UserLayerMirror] failed to inspect retired skills root', {
        skillsRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      result.errors += 1;
      return result;
    }

    for (const slug of RETIRED_MANAGED_SKILL_SLUGS) {
      await this.withSlugLock('skill', slug, async () => {
        const cloneDir = join(skillsRoot, slug);
        try {
          this.fsOps.assertUnderUserLayer(cloneDir);
          const cloneStat = await lstat(cloneDir);
          if (!cloneStat.isDirectory() || cloneStat.isSymbolicLink()) {
            result.preserved.push({ slug, reason: 'unsafe-path' });
          } else {
            const sidecarPath = join(cloneDir, ORIGIN_SIDECAR_FILENAME);
            let sidecarStat;
            try {
              sidecarStat = await lstat(sidecarPath);
            } catch (error: unknown) {
              if (!this.isEnoent(error)) throw error;
            }
            if (!sidecarStat) {
              result.preserved.push({ slug, reason: 'missing-sidecar' });
            } else if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink()) {
              result.preserved.push({ slug, reason: 'unsafe-path' });
            } else {
              const sidecar = parseOriginSidecar(await readSidecar(cloneDir));
              if (sidecar?.kind !== 'skill' || sidecar.slug !== slug || !sidecar.sourceHash) {
                result.preserved.push({ slug, reason: 'invalid-origin' });
              } else if (await computeSourceHash(cloneDir) !== sidecar.sourceHash) {
                result.preserved.push({ slug, reason: 'modified' });
              } else {
                await this.fsOps.snapshotDirToRootHistory(skillsRoot, slug, cloneDir);
                await this.fsOps.removePath(cloneDir);
                result.removed.push(slug);
              }
            }
          }
          const preserved = result.preserved.find((item) => item.slug === slug);
          if (preserved) {
            this.logger.info('[UserLayerMirror] retired skill preserved', preserved);
          }
        } catch (error: unknown) {
          // degradation-audit: optional-capability - ENOENT means the retired
          // skill folder is already gone, which is the goal; every other error
          // is counted in result.errors and logged below.
          if (this.isEnoent(error)) return;
          result.errors += 1;
          this.logger.warn('[UserLayerMirror] retired skill removal failed', {
            slug,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
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
        this.getUserLayerRoots(reapAgentScope(sources)),
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

  /**
   * Replace one clone's body with content the USER typed, under the per-slug
   * lock, snapshotting first.
   *
   * This is deliberately NOT `writeEnhancedSkill` / `writeEnhancedFileClone`:
   * those `mkdir` a missing clone and stamp `lastEnhancedAt`. A manual edit is
   * not an enhancement, and this method never creates a clone that is not
   * already on disk — an absent target returns `written: false`.
   *
   * THE SIDECAR RULE. `currentContentHash` is the ONLY field written.
   * `sourceHash` in particular is NEVER written: setting it to the fresh
   * content hash makes `liveCloneHash === sidecar.sourceHash` true, which arms
   * the fast-forward branch in `reconcileDirClone` / `reconcileFileClone` and
   * lets the next upstream move silently overwrite the edit that was just
   * saved. `diverged`, `pendingSourceHash` and `lastEnhancedAt` stay untouched
   * for the same reason they exist: editing a body does not resolve "upstream
   * moved and you have local changes" — the Rebase and Keep-mine buttons do.
   *
   * A clone with NO sidecar does not get one minted here. Its absence is the
   * marker for "user-authored, hands off"; writing one would enrol the file
   * into classification and orphan reaping. The body write still succeeds, and
   * the result reports `reconcileProtected: false` so the caller can tell the
   * user the write is not protected against the reconciler's missing-sidecar
   * mint.
   *
   * The body write is the COMMIT POINT. A failure in the bookkeeping that
   * follows it comes back as `written: true, metadataIncomplete: true`, never
   * as a failure — the edit is on disk and the user must not be told otherwise.
   *
   * Result-shaped rather than throwing, matching {@link RebaseResult}. This
   * service must not mint RPC error types; its caller does the mapping.
   */
  async saveCloneBody(args: SaveCloneBodyArgs): Promise<SaveCloneBodyResult> {
    return this.withSlugLock(args.kind, args.slug, async () => {
      const roots = this.getUserLayerRoots(args.workspaceRoot);
      if (args.kind === 'skill') {
        return this.saveDirCloneBody(
          args.slug,
          args.body,
          roots.skills,
          args.expectedSourceHash,
        );
      }
      const root = args.kind === 'agent' ? roots.agents : roots.commands;
      return this.saveFileCloneBody(
        args.kind,
        args.slug,
        args.body,
        root,
        args.expectedSourceHash,
      );
    });
  }

  private async saveDirCloneBody(
    slug: string,
    body: string,
    skillsRoot: string,
    expectedSourceHash?: string,
  ): Promise<SaveCloneBodyResult> {
    const cloneDir = join(skillsRoot, slug);
    const skillFile = join(cloneDir, 'SKILL.md');
    this.assertUnderUserLayer(cloneDir);
    this.assertUnderUserLayer(skillFile);

    if (!(await this.fileExists(skillFile))) {
      return {
        kind: 'skill',
        slug,
        historyTs: null,
        written: false,
        reason: 'clone-missing',
        currentContentHash: null,
        metadataIncomplete: false,
        reconcileProtected: false,
      };
    }

    if (await this.isStaleSource(skillFile, expectedSourceHash)) {
      return {
        kind: 'skill',
        slug,
        historyTs: null,
        written: false,
        reason: 'stale-source',
        currentContentHash: null,
        metadataIncomplete: false,
        reconcileProtected: false,
      };
    }

    const historyTs = basename(await this.snapshotDirToHistory(cloneDir));
    await this.writeTextAtomic(skillFile, body);

    // THE COMMIT POINT. Everything below is bookkeeping over a body that is
    // already on disk, so a failure here may never be reported as a failed
    // save — see `SaveCloneBodyResult.metadataIncomplete`.
    const meta = await this.refreshSavedSidecarDir(cloneDir, slug);

    return {
      kind: 'skill',
      slug,
      historyTs,
      written: true,
      reason: null,
      ...meta,
    };
  }

  /**
   * Post-commit bookkeeping for a directory clone: re-hash the tree and carry
   * the new hash into an EXISTING sidecar. Never mints one.
   *
   * Isolated so its failure cannot be confused with a failure of the body
   * write. `reconcileProtected` reports whether a sidecar was found, which is
   * what decides whether the next reconcile marks the clone diverged or may
   * eventually fast-forward over the edit.
   */
  private async refreshSavedSidecarDir(
    cloneDir: string,
    slug: string,
  ): Promise<
    Pick<SaveCloneBodyResult, 'currentContentHash' | 'metadataIncomplete' | 'reconcileProtected'>
  > {
    let reconcileProtected = false;
    let currentContentHash: string | null = null;
    try {
      currentContentHash = await computeSourceHash(cloneDir);
      const existing = await readSidecar(cloneDir);
      if (!existing) {
        return { currentContentHash, metadataIncomplete: false, reconcileProtected: false };
      }
      // The sidecar exists, so the divergence rule already protects the body
      // regardless of whether the hash write below lands.
      reconcileProtected = true;
      await writeSidecarAtomic(cloneDir, { ...existing, currentContentHash });
      return { currentContentHash, metadataIncomplete: false, reconcileProtected };
    } catch (error: unknown) {
      this.logger.warn(
        '[UserLayerMirror] clone body saved but sidecar bookkeeping failed',
        {
          kind: 'skill',
          slug,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return { currentContentHash, metadataIncomplete: true, reconcileProtected };
    }
  }

  private async saveFileCloneBody(
    kind: OriginKind,
    slug: string,
    body: string,
    rootDir: string,
    expectedSourceHash?: string,
  ): Promise<SaveCloneBodyResult> {
    const cloneFile = join(rootDir, `${slug}.md`);
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(cloneFile);
    this.assertUnderUserLayer(sidecarPath);

    if (!(await this.fileExists(cloneFile))) {
      return {
        kind,
        slug,
        historyTs: null,
        written: false,
        reason: 'clone-missing',
        currentContentHash: null,
        metadataIncomplete: false,
        reconcileProtected: false,
      };
    }

    if (await this.isStaleSource(cloneFile, expectedSourceHash)) {
      return {
        kind,
        slug,
        historyTs: null,
        written: false,
        reason: 'stale-source',
        currentContentHash: null,
        metadataIncomplete: false,
        reconcileProtected: false,
      };
    }

    const historyTs = basename(
      await this.snapshotFileToHistory(rootDir, slug, cloneFile),
    );
    await this.writeTextAtomic(cloneFile, body);

    // THE COMMIT POINT — see the twin comment in `saveDirCloneBody`.
    const meta = await this.refreshSavedSidecarFile(
      kind,
      slug,
      cloneFile,
      sidecarPath,
    );

    return { kind, slug, historyTs, written: true, reason: null, ...meta };
  }

  /** Flat-file twin of {@link refreshSavedSidecarDir}. */
  private async isStaleSource(
    bodyPath: string,
    expectedSourceHash?: string,
  ): Promise<boolean> {
    if (expectedSourceHash === undefined) return false;
    const currentBody = await readFile(bodyPath, 'utf8');
    return formatSourceHash(currentBody) !== expectedSourceHash;
  }

  private async refreshSavedSidecarFile(
    kind: OriginKind,
    slug: string,
    cloneFile: string,
    sidecarPath: string,
  ): Promise<
    Pick<SaveCloneBodyResult, 'currentContentHash' | 'metadataIncomplete' | 'reconcileProtected'>
  > {
    let reconcileProtected = false;
    let currentContentHash: string | null = null;
    try {
      currentContentHash = await computeSourceHash(cloneFile);
      const existing = await readSidecarAt(sidecarPath);
      if (!existing) {
        return { currentContentHash, metadataIncomplete: false, reconcileProtected: false };
      }
      reconcileProtected = true;
      await writeSidecarAtomicAt(sidecarPath, {
        ...existing,
        currentContentHash,
      });
      return { currentContentHash, metadataIncomplete: false, reconcileProtected };
    } catch (error: unknown) {
      this.logger.warn(
        '[UserLayerMirror] clone body saved but sidecar bookkeeping failed',
        {
          kind,
          slug,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return { currentContentHash, metadataIncomplete: true, reconcileProtected };
    }
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
    descriptor: MirrorPluginDescriptor | undefined,
    basenameShared: boolean,
    skillsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    const sourceSkillsDir = join(pluginPath, 'skills');
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(sourceSkillsDir);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - ENOENT means this plugin ships
      // no `skills/` directory, which is a normal, optional plugin layout; a
      // real error still falls through to the warn + errors counter below.
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
      if (retiredManagedSkillSlugs.has(slug)) continue;
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
          descriptor,
          basenameShared,
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
      // degradation-audit: optional-capability - ENOENT means no synthesized
      // skill has ever been promoted for this workspace yet, which is normal; a
      // real error still falls through to the warn + errors counter below.
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
      if (slug === SYNTH_CANDIDATES_DIR || slug === DEFAULT_HISTORY_DIR || retiredManagedSkillSlugs.has(slug)) {
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
          undefined,
          false,
        );
      });
    }
  }

  private async reconcilePluginCommands(
    pluginPath: string,
    pluginId: string,
    descriptor: MirrorPluginDescriptor | undefined,
    basenameShared: boolean,
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
      // degradation-audit: optional-capability - ENOENT means this plugin ships
      // no `commands/` directory, which is a normal, optional plugin layout; a
      // real error still falls through to the warn + errors counter below.
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
          descriptor,
          basenameShared,
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
      // degradation-audit: optional-capability - ENOENT means the workspace has
      // no agent source directory yet (nothing generated); a real error still
      // falls through to the warn + errors counter below rather than being
      // swallowed.
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
          undefined,
          false,
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
    descriptor: MirrorPluginDescriptor | undefined,
    basenameShared: boolean,
  ): Promise<void> {
    try {
      if (!(await this.dirExists(cloneDir))) {
        return;
      }
      this.assertUnderUserLayer(cloneDir);

      const stored = await readSidecar(cloneDir);
      if (!stored) {
        await this.reconcileMissingSidecar(cloneDir, sourceDir, {
          kind,
          slug,
          pluginId: expectedPluginId,
          descriptor,
        });
        result.missingSidecar += 1;
        return;
      }
      if (
        !this.ownsForReconcile(
          kind,
          slug,
          sourceOwnership(stored, expectedPluginId, descriptor, basenameShared),
        )
      ) {
        return;
      }
      const sidecar = withSourceIdentity(stored, descriptor);

      const liveSourceHash = await computeSourceHash(sourceDir);
      if (liveSourceHash === sidecar.sourceHash) {
        if (sourceIdentityChanged(stored, descriptor)) {
          await writeSidecarAtomic(cloneDir, sidecar);
        }
        result.noop += 1;
        return;
      }

      const liveCloneHash = await computeSourceHash(cloneDir);
      if (liveCloneHash === sidecar.sourceHash) {
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
    descriptor: MirrorPluginDescriptor | undefined,
    basenameShared: boolean,
  ): Promise<void> {
    try {
      if (!(await this.fileExists(cloneFile))) {
        return;
      }
      this.assertUnderUserLayer(cloneFile);

      const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
      const stored = await readSidecarAt(sidecarPath);
      if (!stored) {
        await this.reconcileMissingFileSidecar(rootDir, cloneFile, slug, {
          kind,
          slug,
          pluginId,
          descriptor,
        });
        result.missingSidecar += 1;
        return;
      }
      if (
        !this.ownsForReconcile(
          kind,
          slug,
          sourceOwnership(stored, pluginId, descriptor, basenameShared),
        )
      ) {
        return;
      }
      const sidecar = withSourceIdentity(stored, descriptor);

      const liveSourceHash = await computeSourceHash(sourceFile);
      if (liveSourceHash === sidecar.sourceHash) {
        if (sourceIdentityChanged(stored, descriptor)) {
          this.assertUnderUserLayer(sidecarPath);
          await writeSidecarAtomicAt(sidecarPath, sidecar);
        }
        result.noop += 1;
        return;
      }

      const liveCloneHash = await computeSourceHash(cloneFile);
      if (liveCloneHash === sidecar.sourceHash) {
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

  /**
   * Whether a reconcile may act on a clone. An `ambiguous` legacy clone is
   * kept exactly as it is and reported, never fast-forwarded or re-identified
   * from whichever same-named plugin the pass met first.
   */
  private ownsForReconcile(
    kind: OriginKind,
    slug: string,
    ownership: SourceOwnership,
  ): boolean {
    if (ownership === 'ambiguous') {
      this.logger.warn(
        '[UserLayerMirror] clone kept: its legacy sidecar matches more than one plugin with this directory name',
        { kind, slug },
      );
    }
    return ownership === 'owned';
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
    // degradation-audit: optional-capability - this only waits for the PRIOR
    // holder of the same slug lock to settle before this call proceeds; that
    // prior call's own failure was already reported at its own call site, so
    // re-surfacing it here would be a duplicate, unrelated to this caller's
    // operation.
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
    descriptor: MirrorPluginDescriptor | undefined,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    const sourceSkillsDir = join(pluginPath, 'skills');
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(sourceSkillsDir);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - ENOENT means this plugin ships
      // no `skills/` directory, which is a normal, optional plugin layout; a
      // real error still falls through to the warn + errors counter below.
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
        descriptor,
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
      // degradation-audit: optional-capability - ENOENT means no synthesized
      // skill has ever been promoted for this workspace yet, which is normal; a
      // real error still falls through to the warn + errors counter below.
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
        undefined,
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
    descriptor: MirrorPluginDescriptor | undefined,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    if (retiredManagedSkillSlugs.has(slug)) return;
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
          descriptor,
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
        descriptor,
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
    base: SidecarBase,
  ): Promise<void> {
    try {
      const sourceHash = await computeSourceHash(targetDir);
      await this.writeOriginSidecar(targetDir, { ...base, sourceHash });
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
    descriptor: MirrorPluginDescriptor | undefined,
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
      // degradation-audit: optional-capability - ENOENT means this plugin ships
      // no `commands/` directory, which is a normal, optional plugin layout; a
      // real error still falls through to the warn + errors counter below.
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
          descriptor,
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
          descriptor,
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
   * Carry the pre-key clones of the agents THIS workspace owns into its own
   * directory, once.
   *
   * The flat `~/.ptah/user/agents` predates the workspace key, so it holds the
   * interleaved clones of every project on the machine. Copying all of it — the
   * TASK_2026_365 rule — handed each newly scoped workspace the other projects'
   * agents, and the reconciler then fanned those into this workspace's
   * `.codex`, `.github`, `.cursor` and `.opencode` agent directories: the
   * cross-workspace leak of TASK_2026_609. A slug is therefore seeded only when
   * the workspace's agent source (`{ws}/.claude/agents`) has a `<slug>.md`.
   *
   * The seed still exists for the owned slugs because a flat clone can carry
   * work the source does not — an enhancement, a hand edit — and the mirror and
   * reconcile that run right after converge it onto the source the normal way
   * (fast-forward, or diverged and offered for rebase) instead of discarding it.
   *
   * Limits:
   *
   * - It runs only while the scoped directory holds no workspace agent clone
   *   (one without a plugin id). Plugin agents are mirrored there without
   *   consent (TASK_2026_701), so a directory that holds only those has not
   *   been seeded yet. Once the workspace has a clone of its own, the flat base
   *   is never read again. A slug a clone already holds is never overwritten.
   * - An agent source that is absent or unreadable seeds NOTHING and is logged
   *   with the number of flat clones left behind. Unknown ownership is not
   *   ownership; the flat originals stay on disk and the rival copies are
   *   derivatives, so nothing is lost by waiting for a source.
   * - It copies `.md` clones and their sidecars, and NOT `.history`. That
   *   history is the record of every workspace on the machine, so copying it
   *   into one project would assert an edit trail that project never had.
   * - It never deletes the flat originals.
   */
  private async seedLegacyAgents(
    workspaceRoot: string | undefined,
    scopedAgentsRoot: string,
    agentSource: AgentSourceListing,
  ): Promise<void> {
    const legacyRoot = this.legacyAgentsRoot();
    if (workspaceRoot === undefined || scopedAgentsRoot === legacyRoot) return;
    if (await this.hasWorkspaceAgentClones(scopedAgentsRoot)) return;

    let names: string[];
    try {
      names = (await readdir(legacyRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name);
    } catch {
      return;
    }
    if (names.length === 0) return;

    if (agentSource.status !== 'ok') {
      this.logger.info(
        '[UserLayerMirror] legacy agent seed skipped: agent source not readable',
        {
          workspaceRoot,
          agentSourceDir: agentSource.dir,
          sourceStatus: agentSource.status,
          flatClonesNotSeeded: names.length,
        },
      );
      return;
    }

    const owned = names.filter((fileName) =>
      agentSource.slugs.has(fileName.replace(/\.md$/, '')),
    );
    const notOwned = names.length - owned.length;
    if (owned.length === 0) {
      this.logger.info(
        '[UserLayerMirror] legacy agent seed skipped: no flat clone is owned by this workspace',
        { workspaceRoot, flatClonesNotSeeded: notOwned },
      );
      return;
    }

    this.assertUnderUserLayer(scopedAgentsRoot);
    let seeded = 0;
    for (const fileName of owned) {
      const slug = fileName.replace(/\.md$/, '');
      const sidecarName = `${slug}${ORIGIN_SIDECAR_SUFFIX}`;
      // A plugin agent clone can already hold the slug; the seed never
      // overwrites a clone.
      if (await this.fileExists(join(scopedAgentsRoot, fileName))) continue;
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
      flatClonesNotSeeded: notOwned,
    });
  }

  /**
   * The workspace's agent source listing plus every plugin agent clone in the
   * scoped root, for the seed quarantine. A plugin agent is held there on
   * purpose (TASK_2026_701), so the quarantine must neither move it nor list it
   * as "not owned". A listing that is not `ok` is returned unchanged: the
   * quarantine skips those, and unknown must stay unknown.
   */
  private async withPluginAgentSlugs(
    listing: AgentSourceListing,
    scopedAgentsRoot: string,
  ): Promise<AgentSourceListing> {
    if (listing.status !== 'ok') return listing;
    let files: string[];
    try {
      files = await this.fsOps.listMarkdownFiles(scopedAgentsRoot);
    } catch {
      // degradation-audit: optional-capability - an absent or unreadable
      // scoped root holds no plugin agent clone; the quarantine reads the same
      // root itself and reports a real read error there.
      return listing;
    }
    const slugs = new Set(listing.slugs);
    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      if (slugs.has(slug)) continue;
      try {
        const sidecar = await readSidecarAt(
          join(scopedAgentsRoot, `${slug}${ORIGIN_SIDECAR_SUFFIX}`),
        );
        if (sidecar !== null && sidecar.pluginId !== null) slugs.add(slug);
      } catch {
        // degradation-audit: optional-capability - an unreadable sidecar names
        // no plugin, so the slug keeps the quarantine's own byte-proof test.
        continue;
      }
    }
    return { ...listing, slugs };
  }

  /**
   * Does the scoped agents root hold a clone that is not a plugin agent? A
   * sidecar-less file counts: it is user-authored work in this directory. An
   * absent or unreadable root holds none.
   */
  private async hasWorkspaceAgentClones(
    scopedAgentsRoot: string,
  ): Promise<boolean> {
    let files: string[];
    try {
      files = await this.fsOps.listMarkdownFiles(scopedAgentsRoot);
    } catch {
      // degradation-audit: optional-capability - an absent or unreadable
      // scoped root holds no workspace clone; the seed then reads the flat base
      // and skips every slug a clone already holds, so nothing is overwritten.
      return false;
    }
    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      try {
        const sidecar = await readSidecarAt(
          join(scopedAgentsRoot, `${slug}${ORIGIN_SIDECAR_SUFFIX}`),
        );
        if (sidecar === null || sidecar.pluginId === null) return true;
      } catch {
        // degradation-audit: optional-capability - an unreadable sidecar is
        // not a plugin agent's, so it is counted as workspace work and the
        // seed stays done, which is the non-copying side.
        return true;
      }
    }
    return false;
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
      // degradation-audit: optional-capability - ENOENT means the workspace has
      // no agent source directory yet (nothing generated); a real error still
      // falls through to the warn + errors counter below rather than being
      // swallowed.
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
    base: SidecarBase & { sourceHash: string },
  ): Promise<void> {
    await writeSidecarAtomic(dir, this.newSourcedSidecar(base));
  }

  private async reconcileMissingFileSidecar(
    rootDir: string,
    targetFile: string,
    slug: string,
    base: SidecarBase,
  ): Promise<void> {
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    const existing = await readSidecarAt(sidecarPath);
    if (existing) {
      return;
    }
    try {
      const sourceHash = await computeSourceHash(targetFile);
      await this.writeFileSidecar(rootDir, slug, { ...base, sourceHash });
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
    base: SidecarBase & { sourceHash: string },
  ): Promise<void> {
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, this.newSourcedSidecar(base));
  }

  /** A fresh sidecar, with `sourceRef`/`sourceLabel` when the source is described. */
  private newSourcedSidecar(
    base: SidecarBase & { sourceHash: string },
  ): OriginSidecar {
    return withSourceIdentity(
      this.buildSidecar(base.kind, base.slug, base.pluginId, base.sourceHash),
      base.descriptor,
    );
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

/** Bundled plugins and harness-authored plugins, in that order. */
function allPluginRoots(sources: MirrorSources): string[] {
  return [...sources.pluginPaths, ...(sources.harnessPluginRoots ?? [])];
}

/**
 * The root whose agent clones the deleted-upstream sweep walks.
 *
 * The workspace root when one is named. Without one — agent sync off — plugin
 * agents still have clones under `libraryScopeRoot`, so the sweep walks that
 * directory instead. It does so only when no `agentSourceDir` was supplied, so
 * every workspace agent clone there reads `'unknown'` and only plugin-owned
 * clones are judged.
 */
function reapAgentScope(sources: MirrorSources): string | undefined {
  if (sources.workspaceRoot !== undefined) return sources.workspaceRoot;
  if (sources.agentSourceDir !== undefined) return undefined;
  return sources.libraryScopeRoot !== undefined &&
    isAbsolute(sources.libraryScopeRoot)
    ? sources.libraryScopeRoot
    : undefined;
}

function emptyReconcileResult(): ReconcileResult {
  return {
    retiredSkills: { removed: [], preserved: [], errors: 0 },
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
