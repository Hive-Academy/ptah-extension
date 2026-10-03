/**
 * UserLayerSeedQuarantine — one-time cleanup of agent clones the TASK_2026_365
 * legacy seed copied into a workspace that never owned them (TASK_2026_609).
 *
 * The seed used to copy EVERY flat `~/.ptah/user/agents/*.md` into a workspace's
 * new scoped directory. The flat base is the interleaved record of every
 * project on the machine, so a workspace received other projects' agents
 * (`video-director`, `figma-designer`, ...) and the reconciler fanned them into
 * its `.codex`, `.github`, `.cursor` and `.opencode` agent directories. The
 * seed now copies only slugs the workspace owns; this pass removes what the old
 * seed already left behind.
 *
 * The orphan reaper does not catch these clones, which is why this pass exists.
 * The reaper keys off the origin sidecar: a clone with no sidecar is
 * user-authored and never touched (its rule 1), and a clone whose live hash
 * differs from its sidecar's `sourceHash` is kept as `orphaned` (its rule 3).
 * Flat-base clones commonly carry one of those two states — a pre-sidecar clone,
 * or an enhanced one — and the seed copied that state verbatim.
 *
 * So the test here ignores the sidecar and asks for proof by BYTES. A scoped
 * clone is quarantined only when all three hold:
 *
 * 1. the workspace's agent source directory was read successfully (absent or
 *    unreadable is "we did not look", which never removes anything);
 * 2. its slug is not among that source's `*.md` files;
 * 3. its bytes equal the flat-base file of the same name, which proves it came
 *    out of the seed and that nobody has worked on it in this workspace since.
 *
 * Anything else is kept and reported. Quarantine is a MOVE: clone and sidecar
 * are copied into the scoped root's `.history/<slug>/<ts>/` — the store
 * `revertFileClone` restores from — the copy is verified, and only then are the
 * originals removed. The flat base is never written.
 *
 * It runs once per workspace. A marker file in the scoped root records a pass
 * with zero failures; a pass with any failure writes no marker and the next
 * mirror pass retries. The marker name starts with `.` and is not `*.md`, so no
 * clone listing, reaper walk or harness source resolver reads it as a clone.
 */
import { join, resolve } from 'path';
import { readFile } from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import { isErrnoCode } from './source-hash';
import type { UserLayerFsOps } from './user-layer-fs-ops';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

/** Written into the scoped agents root after a pass with zero failures. */
export const SEED_QUARANTINE_MARKER = '.ptah-seed-quarantine.json';

/**
 * What one read of a workspace's agent source directory found.
 *
 * `absent` and `unreadable` are kept apart from an EMPTY `ok` on purpose: an
 * empty directory is a real answer ("this workspace owns no agents"), while the
 * other two are "unknown", and unknown must never seed or quarantine.
 */
export type AgentSourceListing =
  | {
      readonly status: 'ok';
      readonly dir: string;
      readonly slugs: ReadonlySet<string>;
    }
  | { readonly status: 'absent'; readonly dir: string }
  | {
      readonly status: 'unreadable';
      readonly dir: string;
      readonly error: string;
    };

export async function readAgentSourceListing(
  dir: string,
  fs: UserLayerFsOps,
): Promise<AgentSourceListing> {
  try {
    const files = await fs.listMarkdownFiles(dir);
    return {
      status: 'ok',
      dir,
      slugs: new Set(files.map((name) => name.replace(/\.md$/, ''))),
    };
  } catch (error: unknown) {
    if (fs.isEnoent(error)) return { status: 'absent', dir };
    return {
      status: 'unreadable',
      dir,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type SeededCloneVerdict =
  /** The workspace's source ships this slug. Not a candidate. */
  | 'owned'
  /** Foreign and byte-identical to the flat file: provably a seed copy. */
  | 'quarantine'
  /** Foreign but changed since the seed (enhanced or hand-edited). */
  | 'kept-local-work'
  /** Foreign, and the flat file is gone, so seed origin cannot be proven. */
  | 'kept-unprovable';

/** Pure decision for one scoped clone. No filesystem access. */
export function classifySeededClone(args: {
  readonly slug: string;
  readonly ownedSlugs: ReadonlySet<string>;
  readonly cloneBytes: Buffer;
  readonly flatBytes: Buffer | null;
}): SeededCloneVerdict {
  if (args.ownedSlugs.has(args.slug)) return 'owned';
  if (args.flatBytes === null) return 'kept-unprovable';
  return args.cloneBytes.equals(args.flatBytes)
    ? 'quarantine'
    : 'kept-local-work';
}

export interface SeedQuarantineResult {
  /** `false` when a precondition skipped the pass; every list is then empty. */
  ran: boolean;
  quarantined: string[];
  keptWithLocalWork: string[];
  keptUnprovable: string[];
  failed: string[];
  markerWritten: boolean;
}

/** Serialises work on one agent slug with every other user-layer operation. */
export type AgentSlugLock = <T>(
  slug: string,
  fn: () => Promise<T>,
) => Promise<T>;

export interface SeedQuarantineArgs {
  workspaceRoot: string | undefined;
  scopedAgentsRoot: string;
  legacyAgentsRoot: string;
  source: AgentSourceListing;
  withSlugLock: AgentSlugLock;
}

type SlugOutcome = Exclude<SeededCloneVerdict, 'owned'> | 'failed' | 'gone';

export class UserLayerSeedQuarantine {
  constructor(
    private readonly logger: Logger,
    private readonly fs: UserLayerFsOps,
  ) {}

  async run(args: SeedQuarantineArgs): Promise<SeedQuarantineResult> {
    const result = emptySeedQuarantineResult();
    const { workspaceRoot, scopedAgentsRoot, legacyAgentsRoot, source } = args;

    if (workspaceRoot === undefined) return result;
    if (resolve(scopedAgentsRoot) === resolve(legacyAgentsRoot)) return result;
    if (source.status !== 'ok') {
      this.logger.debug(
        '[UserLayerMirror] seed quarantine skipped: agent source not read',
        { workspaceRoot, agentSourceDir: source.dir, status: source.status },
      );
      return result;
    }

    const markerPath = join(scopedAgentsRoot, SEED_QUARANTINE_MARKER);
    if (await this.fs.fileExists(markerPath)) return result;

    let files: string[];
    try {
      files = await this.fs.listMarkdownFiles(scopedAgentsRoot);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - ENOENT means this workspace has
      // no scoped clones yet, so nothing can be foreign; no marker is written,
      // and the pass after the first mirror checks again. A real read error is
      // reported and also leaves the marker unwritten, so it is retried.
      if (!this.fs.isEnoent(error)) {
        this.logger.warn(
          '[UserLayerMirror] seed quarantine could not read the scoped agents root',
          {
            scopedAgentsRoot,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return result;
    }

    result.ran = true;
    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      if (source.slugs.has(slug)) continue;
      const outcome = await args.withSlugLock(slug, () =>
        this.handleSlug(slug, scopedAgentsRoot, legacyAgentsRoot, source.slugs),
      );
      if (outcome === 'quarantine') result.quarantined.push(slug);
      else if (outcome === 'kept-local-work')
        result.keptWithLocalWork.push(slug);
      else if (outcome === 'kept-unprovable') result.keptUnprovable.push(slug);
      else if (outcome === 'failed') result.failed.push(slug);
    }

    if (result.failed.length === 0) {
      result.markerWritten = await this.writeMarker(markerPath, result);
    }

    this.logger.info('[UserLayerMirror] seed quarantine pass', {
      workspaceRoot,
      quarantined: result.quarantined.length,
      keptWithLocalWork: result.keptWithLocalWork.length,
      keptUnprovable: result.keptUnprovable.length,
      failed: result.failed.length,
      quarantinedSlugs: result.quarantined,
      keptWithLocalWorkSlugs: result.keptWithLocalWork,
      keptUnprovableSlugs: result.keptUnprovable,
      failedSlugs: result.failed,
      markerWritten: result.markerWritten,
    });
    return result;
  }

  /**
   * Classify and, when proven, move ONE clone. Runs under the slug lock, so the
   * bytes it compares are the bytes it moves.
   */
  private async handleSlug(
    slug: string,
    scopedAgentsRoot: string,
    legacyAgentsRoot: string,
    ownedSlugs: ReadonlySet<string>,
  ): Promise<SlugOutcome> {
    const cloneFile = join(scopedAgentsRoot, `${slug}.md`);
    try {
      const cloneBytes = await readBytesOrNull(cloneFile);
      // Removed by a concurrent operation since the directory listing.
      if (cloneBytes === null) return 'gone';
      const flatBytes = await readBytesOrNull(
        join(legacyAgentsRoot, `${slug}.md`),
      );
      const verdict = classifySeededClone({
        slug,
        ownedSlugs,
        cloneBytes,
        flatBytes,
      });
      if (verdict === 'owned') return 'gone';
      if (verdict !== 'quarantine') return verdict;

      await this.moveToHistory(slug, scopedAgentsRoot, cloneFile, cloneBytes);
      return 'quarantine';
    } catch (error: unknown) {
      this.logger.warn('[UserLayerMirror] seed quarantine failed for agent', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  }

  /**
   * Copy clone + sidecar into `.history/<slug>/<ts>/`, prove the copy holds the
   * clone's bytes, then remove the originals. The sidecar goes first so a
   * failure between the two removals leaves a sidecar-less clone — which the
   * next pass quarantines again — rather than a sidecar pointing at nothing.
   */
  private async moveToHistory(
    slug: string,
    scopedAgentsRoot: string,
    cloneFile: string,
    cloneBytes: Buffer,
  ): Promise<void> {
    const sidecarName = `${slug}${ORIGIN_SIDECAR_SUFFIX}`;
    const sidecarPath = join(scopedAgentsRoot, sidecarName);
    const hasSidecar = await this.fs.fileExists(sidecarPath);

    const historyDir = await this.fs.snapshotFileToHistory(
      scopedAgentsRoot,
      slug,
      cloneFile,
    );
    if (hasSidecar) {
      await this.fs.copyFileAtomic(sidecarPath, join(historyDir, sidecarName));
    }

    const snapshot = await readBytesOrNull(join(historyDir, `${slug}.md`));
    if (snapshot === null || !snapshot.equals(cloneBytes)) {
      throw new Error(
        `snapshot of ${slug} in ${historyDir} does not match the clone; clone kept`,
      );
    }
    if (
      hasSidecar &&
      !(await this.fs.fileExists(join(historyDir, sidecarName)))
    ) {
      throw new Error(
        `sidecar snapshot of ${slug} missing in ${historyDir}; clone kept`,
      );
    }

    await this.fs.removePath(sidecarPath);
    await this.fs.removePath(cloneFile);
  }

  private async writeMarker(
    markerPath: string,
    result: SeedQuarantineResult,
  ): Promise<boolean> {
    try {
      await this.fs.writeTextAtomic(
        markerPath,
        JSON.stringify(
          {
            version: 1,
            completedAt: new Date().toISOString(),
            quarantined: result.quarantined,
            keptWithLocalWork: result.keptWithLocalWork,
            keptUnprovable: result.keptUnprovable,
          },
          null,
          2,
        ),
      );
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - without the marker the next
      // pass runs again; every clone it could move has already moved, so the
      // rerun only re-reports the kept ones.
      this.logger.warn('[UserLayerMirror] seed quarantine marker not written', {
        markerPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

export function emptySeedQuarantineResult(): SeedQuarantineResult {
  return {
    ran: false,
    quarantined: [],
    keptWithLocalWork: [],
    keptUnprovable: [],
    failed: [],
    markerWritten: false,
  };
}

/** File bytes, or `null` when the file does not exist. Other errors throw. */
async function readBytesOrNull(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (error: unknown) {
    if (isErrnoCode(error, 'ENOENT')) return null;
    throw error;
  }
}
