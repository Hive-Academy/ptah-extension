/**
 * UserLayerOrphanReaper — closes defect 7 of TASK_2026_278.
 *
 * `mirrorAll` and `reconcile` both iterate SOURCE slugs, so a skill/command/
 * agent deleted upstream stays in `~/.ptah/user/` forever and keeps being
 * propagated to every CLI target. This walks the other direction: every CLONE,
 * asking "does your upstream still exist?".
 *
 * ## Three rules, and the third is the one that matters
 *
 * 1. **No sidecar ⇒ never touched.** A directory or `.md` in the user layer with
 *    no `.ptah-origin.json` beside it is USER-AUTHORED. It has no upstream, so
 *    it can never be orphaned, and reaping it would delete work Ptah never
 *    created. This is why the reaper keys off the sidecar and not off a
 *    directory listing.
 * 2. **Upstream gone + no local work ⇒ reaped.** Snapshot to the root-level
 *    `.history/<slug>/<ts>/` FIRST (never inside the clone — that snapshot would
 *    be deleted along with it), then remove clone + sidecar.
 * 3. **Upstream gone + local work ⇒ kept, `orphaned: true`.** "Local work" is
 *    `diverged`, OR a live content hash that no longer matches `sourceHash`.
 *    The second half is not redundant: an ENHANCED clone (`writeEnhancedSkill`)
 *    carries a fresh `currentContentHash` and `diverged: false`, so a
 *    diverged-only test would silently delete every auto-enhanced clone whose
 *    plugin was updated to drop the slug.
 *
 * A clone whose upstream comes BACK (plugin re-enabled, content re-downloaded)
 * has `orphaned` cleared on the next pass. Nothing user-visible has to be
 * dismissed for the flag to heal.
 *
 * ## "Unknown" is not "gone"
 *
 * A plugin that is merely DISABLED still exists on disk and its clones must
 * survive — the user is expected to re-enable it. Likewise, a host with no
 * workspace open supplies no `agentSourceDir`, and a cold first run has no
 * `~/.ptah/skills` yet. Each of those is "we did not look", which
 * {@link classifyUpstream} answers `'unknown'` to, and `'unknown'` never reaps.
 * Conflating it with `'orphan'` would empty the user layer on the exact runs
 * that know the least.
 */
import { basename, dirname, join } from 'path';
import { readdir } from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
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
  readSidecar,
  readSidecarAt,
  writeSidecarAtomic,
  writeSidecarAtomicAt,
} from './source-hash';
import type { UserLayerFsOps } from './user-layer-fs-ops';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

/** What the mirror pass actually observed on the source side. */
export interface UpstreamLiveness {
  /** Plugin ids (directory basenames) whose sources were walked this pass. */
  readonly scannedPluginIds: ReadonlySet<string>;
  /** `~/.ptah/plugins`, or `null` when no plugin path was supplied at all. */
  readonly pluginsBasePath: string | null;
  readonly skillSlugs: ReadonlySet<string>;
  readonly commandSlugs: ReadonlySet<string>;
  readonly agentSlugs: ReadonlySet<string>;
  /** The synthesized-skill root existed and was walked. */
  readonly synthScanned: boolean;
  /** An `agentSourceDir` was supplied and walked. */
  readonly agentSourceScanned: boolean;
}

export interface OrphanedClone {
  readonly kind: OriginKind;
  readonly slug: string;
}

export interface ReapResult {
  reaped: number;
  orphaned: number;
  errors: number;
  reapedClones: OrphanedClone[];
  orphanedClones: OrphanedClone[];
}

export function emptyReapResult(): ReapResult {
  return {
    reaped: 0,
    orphaned: 0,
    errors: 0,
    reapedClones: [],
    orphanedClones: [],
  };
}

/**
 * `'check-plugin-dir'` means "this clone names a plugin we did not scan" — it
 * could be disabled (keep) or uninstalled (reap), and only a disk probe can
 * tell the two apart. The classifier stays pure and hands that one case back.
 */
export type UpstreamVerdict =
  | 'live'
  | 'orphan'
  | 'unknown'
  | 'check-plugin-dir';

export function classifyUpstream(
  sidecar: OriginSidecar,
  live: UpstreamLiveness,
): UpstreamVerdict {
  const slugsForKind =
    sidecar.kind === 'skill'
      ? live.skillSlugs
      : sidecar.kind === 'command'
        ? live.commandSlugs
        : live.agentSlugs;

  if (sidecar.pluginId !== null) {
    if (!live.scannedPluginIds.has(sidecar.pluginId)) {
      return live.pluginsBasePath === null ? 'unknown' : 'check-plugin-dir';
    }
    return slugsForKind.has(sidecar.slug) ? 'live' : 'orphan';
  }

  // No plugin origin: a synthesized skill, or a workspace-authored agent.
  if (sidecar.kind === 'skill') {
    if (!live.synthScanned) return 'unknown';
    return slugsForKind.has(sidecar.slug) ? 'live' : 'orphan';
  }
  if (sidecar.kind === 'agent') {
    if (!live.agentSourceScanned) return 'unknown';
    return slugsForKind.has(sidecar.slug) ? 'live' : 'orphan';
  }
  // A command with no plugin id has no upstream anyone can name.
  return 'unknown';
}

export class UserLayerOrphanReaper {
  constructor(
    private readonly logger: Logger,
    private readonly fs: UserLayerFsOps,
  ) {}

  async reap(
    roots: UserLayerRoots,
    live: UpstreamLiveness,
  ): Promise<ReapResult> {
    const result = emptyReapResult();
    await this.reapSkillClones(roots.skills, live, result);
    await this.reapFileClones('command', roots.commands, live, result);
    await this.reapFileClones('agent', roots.agents, live, result);

    if (result.reaped > 0 || result.orphaned > 0) {
      this.logger.info('[UserLayerMirror] deleted-upstream sweep', {
        reaped: result.reaped,
        orphaned: result.orphaned,
        errors: result.errors,
      });
    }
    return result;
  }

  private async reapSkillClones(
    skillsRoot: string,
    live: UpstreamLiveness,
    result: ReapResult,
  ): Promise<void> {
    let names: string[];
    try {
      names = await this.fs.listSubdirectories(skillsRoot);
    } catch (error: unknown) {
      if (!this.fs.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] reap failed to read skills root', {
          skillsRoot,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    for (const name of names) {
      if (name === DEFAULT_HISTORY_DIR) continue;
      const cloneDir = join(skillsRoot, name);
      try {
        const sidecar = await readSidecar(cloneDir);
        if (!sidecar) continue;
        const verdict = await this.resolveVerdict(sidecar, live);
        if (verdict === 'live') {
          await this.clearOrphanFlagDir(cloneDir, sidecar);
          continue;
        }
        if (verdict !== 'orphan') continue;

        if (await this.hasLocalWork(cloneDir, sidecar)) {
          await this.markOrphanedDir(cloneDir, sidecar);
          result.orphaned += 1;
          result.orphanedClones.push({
            kind: sidecar.kind,
            slug: sidecar.slug,
          });
          continue;
        }

        await this.fs.snapshotDirToRootHistory(skillsRoot, name, cloneDir);
        await this.fs.removePath(cloneDir);
        result.reaped += 1;
        result.reapedClones.push({ kind: sidecar.kind, slug: sidecar.slug });
      } catch (error: unknown) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] reap failed for skill clone', {
          slug: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async reapFileClones(
    kind: Extract<OriginKind, 'command' | 'agent'>,
    rootDir: string,
    live: UpstreamLiveness,
    result: ReapResult,
  ): Promise<void> {
    let files: string[];
    try {
      files = await this.fs.listMarkdownFiles(rootDir);
    } catch (error: unknown) {
      if (!this.fs.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] reap failed to read clone root', {
          kind,
          rootDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const cloneFile = join(rootDir, fileName);
      const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
      try {
        const sidecar = await readSidecarAt(sidecarPath);
        if (!sidecar) continue;
        const verdict = await this.resolveVerdict(sidecar, live);
        if (verdict === 'live') {
          await this.clearOrphanFlagAt(sidecarPath, sidecar);
          continue;
        }
        if (verdict !== 'orphan') continue;

        if (await this.hasLocalWork(cloneFile, sidecar)) {
          await this.markOrphanedAt(sidecarPath, sidecar);
          result.orphaned += 1;
          result.orphanedClones.push({ kind: sidecar.kind, slug });
          continue;
        }

        await this.fs.snapshotFileToHistory(rootDir, slug, cloneFile);
        await this.fs.removePath(cloneFile);
        await this.fs.removePath(sidecarPath);
        result.reaped += 1;
        result.reapedClones.push({ kind: sidecar.kind, slug });
      } catch (error: unknown) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] reap failed for file clone', {
          kind,
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Resolve the one classifier verdict that needs a disk probe. */
  private async resolveVerdict(
    sidecar: OriginSidecar,
    live: UpstreamLiveness,
  ): Promise<Exclude<UpstreamVerdict, 'check-plugin-dir'>> {
    const verdict = classifyUpstream(sidecar, live);
    if (verdict !== 'check-plugin-dir') return verdict;
    const pluginId = sidecar.pluginId;
    if (pluginId === null || live.pluginsBasePath === null) return 'unknown';
    if (
      pluginId.includes('/') ||
      pluginId.includes('\\') ||
      pluginId.includes('..')
    ) {
      return 'unknown';
    }
    const pluginDir = join(live.pluginsBasePath, pluginId);
    // Present but not scanned ⇒ disabled ⇒ keep. Absent ⇒ uninstalled ⇒ reap.
    return (await this.fs.dirExists(pluginDir)) ? 'unknown' : 'orphan';
  }

  /**
   * Does this clone carry work the user would lose?
   *
   * `diverged` is the explicit flag; the hash comparison catches the enhanced
   * clone, which is edited-by-Ptah-on-the-user's-behalf and is never flagged
   * diverged. A hash that cannot be computed is treated as "yes" — refusing to
   * delete on a read failure is the only safe direction here.
   */
  private async hasLocalWork(
    clonePath: string,
    sidecar: OriginSidecar,
  ): Promise<boolean> {
    if (sidecar.diverged) return true;
    try {
      const liveHash = await computeSourceHash(clonePath);
      return liveHash !== sidecar.sourceHash;
    } catch (error: unknown) {
      this.logger.warn(
        '[UserLayerMirror] could not hash clone before reaping; keeping it',
        {
          clonePath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return true;
    }
  }

  private async markOrphanedDir(
    cloneDir: string,
    sidecar: OriginSidecar,
  ): Promise<void> {
    if (sidecar.orphaned === true) return;
    this.fs.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, { ...sidecar, orphaned: true });
    this.logger.info(
      '[UserLayerMirror] upstream deleted; keeping edited clone as orphaned',
      { kind: sidecar.kind, slug: sidecar.slug, pluginId: sidecar.pluginId },
    );
  }

  private async markOrphanedAt(
    sidecarPath: string,
    sidecar: OriginSidecar,
  ): Promise<void> {
    if (sidecar.orphaned === true) return;
    this.fs.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, { ...sidecar, orphaned: true });
    this.logger.info(
      '[UserLayerMirror] upstream deleted; keeping edited clone as orphaned',
      { kind: sidecar.kind, slug: sidecar.slug, pluginId: sidecar.pluginId },
    );
  }

  private async clearOrphanFlagDir(
    cloneDir: string,
    sidecar: OriginSidecar,
  ): Promise<void> {
    if (sidecar.orphaned !== true) return;
    this.fs.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, { ...sidecar, orphaned: false });
  }

  private async clearOrphanFlagAt(
    sidecarPath: string,
    sidecar: OriginSidecar,
  ): Promise<void> {
    if (sidecar.orphaned !== true) return;
    this.fs.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, { ...sidecar, orphaned: false });
  }
}

/**
 * Walk the SOURCE side once and record what exists, so the reaper can answer
 * "is this clone's upstream still there?" without re-walking per clone.
 *
 * Slug sets are deliberately GLOBAL across plugins rather than per-plugin: if
 * plugin A drops `deep-research` while plugin B still ships it, the clone still
 * has an upstream and must not be reaped. Attributing it to the right plugin is
 * the mirror's first-write-wins conflict rule, not the reaper's job.
 */
export async function collectUpstreamLiveness(args: {
  readonly pluginPaths: readonly string[];
  readonly synthesizedSkillsRoot?: string;
  readonly agentSourceDir?: string;
  readonly pluginsBasePath?: string;
  readonly synthCandidatesDirName: string;
  readonly fs: UserLayerFsOps;
}): Promise<UpstreamLiveness> {
  const { fs } = args;
  const scannedPluginIds = new Set<string>();
  const skillSlugs = new Set<string>();
  const commandSlugs = new Set<string>();
  const agentSlugs = new Set<string>();

  for (const pluginPath of args.pluginPaths) {
    scannedPluginIds.add(basename(pluginPath));
    await addSubdirNames(fs, join(pluginPath, 'skills'), skillSlugs);
    await addMarkdownSlugs(fs, join(pluginPath, 'commands'), commandSlugs);
    await addMarkdownSlugs(fs, join(pluginPath, 'agents'), agentSlugs);
  }

  let synthScanned = false;
  if (
    args.synthesizedSkillsRoot &&
    (await fs.dirExists(args.synthesizedSkillsRoot))
  ) {
    synthScanned = true;
    const synthSlugs = new Set<string>();
    await addSubdirNames(fs, args.synthesizedSkillsRoot, synthSlugs);
    synthSlugs.delete(args.synthCandidatesDirName);
    for (const slug of synthSlugs) skillSlugs.add(slug);
  }

  let agentSourceScanned = false;
  if (args.agentSourceDir && (await fs.dirExists(args.agentSourceDir))) {
    agentSourceScanned = true;
    await addMarkdownSlugs(fs, args.agentSourceDir, agentSlugs);
  }

  const pluginsBasePath =
    args.pluginsBasePath ??
    (args.pluginPaths.length > 0 ? dirname(args.pluginPaths[0]) : null);

  return {
    scannedPluginIds,
    pluginsBasePath,
    skillSlugs,
    commandSlugs,
    agentSlugs,
    synthScanned,
    agentSourceScanned,
  };
}

async function addSubdirNames(
  fs: UserLayerFsOps,
  dir: string,
  out: Set<string>,
): Promise<void> {
  try {
    for (const name of await fs.listSubdirectories(dir)) {
      if (name === DEFAULT_HISTORY_DIR) continue;
      out.add(name);
    }
  } catch (error: unknown) {
    if (!fs.isEnoent(error)) throw error;
  }
}

async function addMarkdownSlugs(
  fs: UserLayerFsOps,
  dir: string,
  out: Set<string>,
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === ORIGIN_SIDECAR_FILENAME) continue;
      if (!entry.name.endsWith('.md')) continue;
      out.add(entry.name.replace(/\.md$/, ''));
    }
  } catch (error: unknown) {
    if (!fs.isEnoent(error)) throw error;
  }
}
