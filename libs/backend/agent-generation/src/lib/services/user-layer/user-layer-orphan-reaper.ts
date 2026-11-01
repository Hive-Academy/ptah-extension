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
import { lstat, readdir } from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import { isRetiredSourceRef } from '@ptah-extension/shared';
import type { SkillsShRetiredRegistry } from '@ptah-extension/shared';
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

/**
 * Why a clone the sweep would otherwise delete was kept on disk.
 *
 * - `diverged`: the sidecar's explicit flag.
 * - `edited`: the live content hash no longer equals `sourceHash` (this is
 *   also how an enhanced clone shows up).
 * - `unhashable`: the hash could not be computed, or the clone tree is deeper
 *   than the hash walk reaches. Refusing on a read failure is the safe side.
 * - `symlink`: the clone, its sidecar or any entry inside the clone is a
 *   symbolic link. The content hash skips links, so a link is unproven content
 *   and the sweep never deletes through one.
 */
export type ReapKeptReason = 'diverged' | 'edited' | 'unhashable' | 'symlink';

/**
 * One clone the sweep acted on, keyed by its absolute path.
 *
 * `path` is the clone itself: the skill directory, or the `<slug>.md` file of a
 * command/agent clone. It is stable across runs, so a durable ledger can key
 * on it (TASK_2026_853 D-6). `sourceRef` is the sidecar's durable source
 * identity (`skills-sh:<rootId>` for a skills.sh clone, which equals the
 * ledger item id); `null` when the sidecar predates the field or was not read.
 */
export interface ReapClonePath {
  readonly kind: OriginKind;
  readonly slug: string;
  readonly path: string;
  readonly sourceRef: string | null;
}

export interface ReapedClonePath extends ReapClonePath {
  /**
   * Every path this deletion removed: the skill directory, or the `.md` file
   * plus its `.ptah-origin.json` sidecar. History snapshots are written to the
   * root-level `.history/` first and are not listed.
   */
  readonly removedPaths: readonly string[];
}

export interface KeptClonePath extends ReapClonePath {
  readonly reason: ReapKeptReason;
}

export interface FailedClonePath extends ReapClonePath {
  /** The failure message (never a stack). */
  readonly error: string;
}

export interface ReapResult {
  reaped: number;
  orphaned: number;
  errors: number;
  reapedClones: OrphanedClone[];
  orphanedClones: OrphanedClone[];
  /** Clones deleted this pass, one row per clone. */
  reapedPaths: ReapedClonePath[];
  /** Clones kept because they carry local work or cannot be proven. */
  keptPaths: KeptClonePath[];
  /**
   * Clones whose read, snapshot or delete threw. Each row is also counted in
   * `errors`. A root listing that fails has no clone path and is counted in
   * `errors` only.
   */
  failedPaths: FailedClonePath[];
}

export function emptyReapResult(): ReapResult {
  return {
    reaped: 0,
    orphaned: 0,
    errors: 0,
    reapedClones: [],
    orphanedClones: [],
    reapedPaths: [],
    keptPaths: [],
    failedPaths: [],
  };
}

/**
 * `'check-plugin-dir'` means "this clone names a plugin we did not scan" — it
 * could be disabled (keep) or uninstalled (reap), and only a disk probe can
 * tell the two apart. The classifier stays pure and hands that one case back.
 */
export type UpstreamVerdict =
  'live' | 'orphan' | 'unknown' | 'check-plugin-dir';

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

/**
 * How one sweep treats a clone that has a sidecar.
 *
 * - `live`: the upstream exists; a stale `orphaned` flag is cleared.
 * - `orphan`: delete the clone when it carries no local work, else keep it.
 * - `skip`: not this sweep's business; nothing is touched or reported.
 */
type SweepDecision = 'live' | 'orphan' | 'skip';

interface SweepPolicy {
  /** Log label for the summary line. */
  readonly label: string;
  /** Write `orphaned: true` on a kept clone and clear it on a live one. */
  readonly flagKept: boolean;
  decide(sidecar: OriginSidecar): Promise<SweepDecision>;
}

const MAX_LINK_SCAN_DEPTH = 20;

export class UserLayerOrphanReaper {
  constructor(
    private readonly logger: Logger,
    private readonly fs: UserLayerFsOps,
  ) {}

  /** Deleted-upstream sweep: the three rules in the file header. */
  async reap(
    roots: UserLayerRoots,
    live: UpstreamLiveness,
  ): Promise<ReapResult> {
    return this.sweep(roots, {
      label: 'deleted-upstream sweep',
      flagKept: true,
      decide: async (sidecar) => {
        const verdict = await this.resolveVerdict(sidecar, live);
        return verdict === 'unknown' ? 'skip' : verdict;
      },
    });
  }

  /**
   * Retired skills.sh roots (TASK_2026_853 D-6): the same per-clone rule as
   * {@link reap}, with "upstream gone" replaced by "the clone's `sourceRef` is
   * `skills-sh:<rootId>` and that root id is in the retired registry".
   *
   * - A clone whose live hash equals `sourceHash`, with `diverged` false, no
   *   symlink anywhere in it and a complete hash walk, is snapshotted to the
   *   root `.history/` and deleted.
   * - Every other retired clone is kept and reported in `keptPaths`. Its
   *   sidecar is NOT rewritten: the manifest builder already treats a retired
   *   clone as inactive, and the next deleted-upstream pass would clear an
   *   `orphaned` flag again while the retired root is still on disk.
   * - Only user-layer paths are deleted (`removePath` refuses anything outside
   *   `~/.ptah/user/` and anything under `~/.ptah/plugins/`), so the retired
   *   source root itself is never touched here; its deletion has its own proof.
   * - A clone with no sidecar, with no `sourceRef` or with any other ref is
   *   skipped. A `null` registry retires nothing.
   */
  async reapRetired(
    roots: UserLayerRoots,
    retired: SkillsShRetiredRegistry | null,
  ): Promise<ReapResult> {
    return this.sweep(roots, {
      label: 'retired-root clone sweep',
      flagKept: false,
      decide: async (sidecar) =>
        isRetiredSourceRef(sourceRefOf(sidecar), retired) ? 'orphan' : 'skip',
    });
  }

  private async sweep(
    roots: UserLayerRoots,
    policy: SweepPolicy,
  ): Promise<ReapResult> {
    const result = emptyReapResult();
    await this.reapSkillClones(roots.skills, policy, result);
    await this.reapFileClones('command', roots.commands, policy, result);
    await this.reapFileClones('agent', roots.agents, policy, result);

    if (result.reaped > 0 || result.orphaned > 0) {
      this.logger.info(`[UserLayerMirror] ${policy.label}`, {
        reaped: result.reaped,
        orphaned: result.orphaned,
        errors: result.errors,
      });
    }
    return result;
  }

  private async reapSkillClones(
    skillsRoot: string,
    policy: SweepPolicy,
    result: ReapResult,
  ): Promise<void> {
    let names: string[];
    try {
      names = await this.fs.listSubdirectories(skillsRoot);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - ENOENT means the skills root
      // does not exist yet, which is normal before the first mirror; a real
      // error still falls through to the warn + errors counter below.
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
      let sidecar: OriginSidecar | null = null;
      try {
        sidecar = await readSidecar(cloneDir);
        if (!sidecar) continue;
        const decision = await policy.decide(sidecar);
        if (decision === 'live') {
          if (policy.flagKept) await this.clearOrphanFlagDir(cloneDir, sidecar);
          continue;
        }
        if (decision !== 'orphan') continue;

        const row = clonePathRow(sidecar.kind, sidecar.slug, cloneDir, sidecar);
        const keptReason = await this.localWorkReason(cloneDir, sidecar);
        if (keptReason !== null) {
          if (policy.flagKept) await this.markOrphanedDir(cloneDir, sidecar);
          result.orphaned += 1;
          result.orphanedClones.push({
            kind: sidecar.kind,
            slug: sidecar.slug,
          });
          result.keptPaths.push({ ...row, reason: keptReason });
          continue;
        }

        await this.fs.snapshotDirToRootHistory(skillsRoot, name, cloneDir);
        await this.fs.removePath(cloneDir);
        result.reaped += 1;
        result.reapedClones.push({ kind: sidecar.kind, slug: sidecar.slug });
        result.reapedPaths.push({ ...row, removedPaths: [cloneDir] });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors += 1;
        result.failedPaths.push({
          ...clonePathRow('skill', name, cloneDir, sidecar),
          error: message,
        });
        this.logger.warn('[UserLayerMirror] reap failed for skill clone', {
          slug: name,
          error: message,
        });
      }
    }
  }

  private async reapFileClones(
    kind: Extract<OriginKind, 'command' | 'agent'>,
    rootDir: string,
    policy: SweepPolicy,
    result: ReapResult,
  ): Promise<void> {
    let files: string[];
    try {
      files = await this.fs.listMarkdownFiles(rootDir);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - ENOENT means this clone root
      // (commands/agents) does not exist yet, which is normal before the first
      // mirror; a real error still falls through to the warn + errors counter
      // below.
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
      let sidecar: OriginSidecar | null = null;
      try {
        sidecar = await readSidecarAt(sidecarPath);
        if (!sidecar) continue;
        const decision = await policy.decide(sidecar);
        if (decision === 'live') {
          if (policy.flagKept) {
            await this.clearOrphanFlagAt(sidecarPath, sidecar);
          }
          continue;
        }
        if (decision !== 'orphan') continue;

        const row = clonePathRow(sidecar.kind, slug, cloneFile, sidecar);
        const keptReason = await this.localWorkReason(
          cloneFile,
          sidecar,
          sidecarPath,
        );
        if (keptReason !== null) {
          if (policy.flagKept) await this.markOrphanedAt(sidecarPath, sidecar);
          result.orphaned += 1;
          result.orphanedClones.push({ kind: sidecar.kind, slug });
          result.keptPaths.push({ ...row, reason: keptReason });
          continue;
        }

        await this.fs.snapshotFileToHistory(rootDir, slug, cloneFile);
        await this.fs.removePath(cloneFile);
        await this.fs.removePath(sidecarPath);
        result.reaped += 1;
        result.reapedClones.push({ kind: sidecar.kind, slug });
        result.reapedPaths.push({
          ...row,
          removedPaths: [cloneFile, sidecarPath],
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors += 1;
        result.failedPaths.push({
          ...clonePathRow(kind, slug, cloneFile, sidecar),
          error: message,
        });
        this.logger.warn('[UserLayerMirror] reap failed for file clone', {
          kind,
          slug,
          error: message,
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
   * Does this clone carry work the user would lose? `null` means "no, it may
   * be deleted"; anything else is the reason it is kept.
   *
   * `diverged` is the explicit flag; the hash comparison catches the enhanced
   * clone, which is edited-by-Ptah-on-the-user's-behalf and is never flagged
   * diverged. The hash walk skips symbolic links and stops at a depth cap, so
   * a link anywhere in the clone (or a sidecar that is a link) and a truncated
   * walk both leave content the hash did not prove: kept. A hash that cannot be
   * computed is treated as "yes" — refusing to delete on a read failure is the
   * only safe direction here.
   */
  private async localWorkReason(
    clonePath: string,
    sidecar: OriginSidecar,
    sidecarPath?: string,
  ): Promise<ReapKeptReason | null> {
    if (sidecar.diverged) return 'diverged';
    try {
      const unproven = await findUnprovenEntry(clonePath, sidecarPath);
      if (unproven !== null) return unproven;
      const walk = { truncatedAtDepth: false };
      const liveHash = await computeSourceHash(clonePath, walk);
      if (walk.truncatedAtDepth) return 'unhashable';
      return liveHash === sidecar.sourceHash ? null : 'edited';
    } catch (error: unknown) {
      // degradation-audit: optional-capability - per the doc comment above, a
      // clone that cannot be inspected or hashed is treated as "yes, there is
      // local work", which keeps the clone instead of reaping it; the warn
      // below still surfaces the underlying read failure.
      this.logger.warn(
        '[UserLayerMirror] could not hash clone before reaping; keeping it',
        {
          clonePath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return 'unhashable';
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

/** The sidecar's `sourceRef` when it is a string; anything else is `null`. */
function sourceRefOf(sidecar: OriginSidecar | null): string | null {
  return typeof sidecar?.sourceRef === 'string' ? sidecar.sourceRef : null;
}

function clonePathRow(
  kind: OriginKind,
  slug: string,
  path: string,
  sidecar: OriginSidecar | null,
): ReapClonePath {
  return { kind, slug, path, sourceRef: sourceRefOf(sidecar) };
}

/**
 * `lstat` the clone (and a file clone's separate sidecar) and walk a clone
 * directory without following links. Returns `'symlink'` for the first link
 * found, `'unhashable'` when the tree is deeper than the scan reaches, and
 * `null` when every entry is a plain file or directory. Read errors propagate
 * to the caller, which keeps the clone.
 */
async function findUnprovenEntry(
  clonePath: string,
  sidecarPath?: string,
): Promise<'symlink' | 'unhashable' | null> {
  if (sidecarPath && (await lstat(sidecarPath)).isSymbolicLink()) {
    return 'symlink';
  }
  const stats = await lstat(clonePath);
  if (stats.isSymbolicLink()) return 'symlink';
  if (!stats.isDirectory()) return null;
  return scanDirForLinks(clonePath, 0);
}

async function scanDirForLinks(
  dir: string,
  depth: number,
): Promise<'symlink' | 'unhashable' | null> {
  if (depth > MAX_LINK_SCAN_DEPTH) return 'unhashable';
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return 'symlink';
    if (entry.isDirectory()) {
      const found = await scanDirForLinks(join(dir, entry.name), depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
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
