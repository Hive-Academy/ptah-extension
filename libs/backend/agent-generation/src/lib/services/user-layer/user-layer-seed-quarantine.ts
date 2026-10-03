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
 * Anything else is kept and reported. Quarantine is a MOVE by rename: sidecar
 * and clone are renamed into the scoped root's `.history/<slug>/<ts>/` — the
 * store `revertFileClone` restores from — and the DETACHED clone is then
 * checked against the bytes that were classified. Nothing is ever unlinked at
 * the live paths, so an editor save that lands after the rename is a new file
 * that stays, and one that lands before it is caught by the check and put back
 * (TASK_2026_609 review F2). The flat base is never written.
 *
 * It runs once per workspace. Every verified move is first merged into a
 * journal (`user-layer-seed-quarantine-journal.ts`); a marker file in the
 * scoped root records a pass with zero failures, as the union of the journal
 * and that pass, so a clone moved by an earlier failed pass stays in the record
 * (review F3). A pass with any failure writes no marker and the next mirror
 * pass retries. Whole passes are serialised per scoped root. Neither file name
 * is `*.md`, and both start with `.`, so no clone listing, reaper walk or
 * harness source resolver reads them as clones.
 *
 * Accepted residual risk: a process exit between a clone's rename and its
 * journal write leaves the clone's bytes in `.history/<slug>/<ts>/` but not in
 * the record. The window is one atomic write; no bytes are lost.
 *
 * The marker is also the record the Agents tab lists from, and Restore puts a
 * quarantined agent back as a SOURCE file the workspace owns
 * (`{ws}/.claude/agents/<slug>.md`), copied from its quarantine snapshot. The
 * scoped clone is not the destination: the orphan reaper would reap a clone
 * whose workspace ships no source for it. The next mirror pass re-creates the
 * clone from that source, which is what takes the item off the list.
 */
import { basename, join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { constants as fsConstants } from 'fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import { DEFAULT_HISTORY_DIR } from './origin-sidecar.types';
import { isErrnoCode } from './source-hash';
import type { UserLayerFsOps } from './user-layer-fs-ops';
import {
  SeedQuarantineJournal,
  SeedQuarantinePassLock,
  isSafeAgentSlug,
  mergeSeedQuarantineLists,
} from './user-layer-seed-quarantine-journal';
import type { SeedQuarantineLists } from './user-layer-seed-quarantine-journal';

export { isSafeAgentSlug };

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

/** Written into the scoped agents root after a pass with zero failures. */
export const SEED_QUARANTINE_MARKER = '.ptah-seed-quarantine.json';

/** `<ms>` or `<ms>-<n>`, the names `makeUniqueHistoryDir` mints. */
const HISTORY_TS_PATTERN = /^(\d+)(?:-(\d+))?$/;

/** `link` errors that mean "this filesystem cannot hard-link here". */
const LINK_UNSUPPORTED_CODES = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'];

/** A marker that passed {@link validateSeedQuarantineMarker}. */
export interface SeedQuarantineMarker {
  readonly version: 1;
  readonly completedAt: string;
  /** `Date.parse(completedAt)`, always finite. */
  readonly completedAtMs: number;
  readonly quarantined: readonly string[];
  readonly keptWithLocalWork: readonly string[];
  readonly keptUnprovable: readonly string[];
}

export type SeedQuarantineMarkerValidation =
  | {
      readonly status: 'valid';
      readonly marker: SeedQuarantineMarker;
      /** Entries that failed the slug rule, dropped one by one. */
      readonly droppedSlugs: readonly string[];
    }
  | { readonly status: 'invalid'; readonly reason: string };

/**
 * Pure shape check of a parsed marker. The file is read back from disk, where
 * anything can have written it, so nothing about it is trusted: a wrong shape
 * makes the whole record unusable, and an unsafe slug drops only that entry.
 */
export function validateSeedQuarantineMarker(
  raw: unknown,
): SeedQuarantineMarkerValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { status: 'invalid', reason: 'marker is not an object' };
  }
  const record = raw as Record<string, unknown>;
  if (record['version'] !== 1) {
    return { status: 'invalid', reason: 'unsupported marker version' };
  }
  const completedAt = record['completedAt'];
  const completedAtMs =
    typeof completedAt === 'string' ? Date.parse(completedAt) : Number.NaN;
  if (typeof completedAt !== 'string' || !Number.isFinite(completedAtMs)) {
    return { status: 'invalid', reason: 'completedAt is not a valid date' };
  }

  const droppedSlugs: string[] = [];
  const lists: Record<
    'quarantined' | 'keptWithLocalWork' | 'keptUnprovable',
    string[]
  > = { quarantined: [], keptWithLocalWork: [], keptUnprovable: [] };
  for (const key of Object.keys(lists) as (keyof typeof lists)[]) {
    const value = record[key];
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      return { status: 'invalid', reason: `${key} is not a list of strings` };
    }
    const seen = new Set<string>();
    for (const slug of value as string[]) {
      if (!isSafeAgentSlug(slug)) {
        droppedSlugs.push(slug);
      } else if (!seen.has(slug)) {
        seen.add(slug);
        lists[key].push(slug);
      }
    }
  }

  return {
    status: 'valid',
    marker: { version: 1, completedAt, completedAtMs, ...lists },
    droppedSlugs,
  };
}

/**
 * History dir names under `.history/<slug>/` that may hold the quarantine
 * snapshot, newest first: only `<ms>[-<n>]` names whose `<ms>` is not later
 * than the marker's `completedAt`. A later dir was written after the pass (an
 * edit or reap of a re-created clone) and is never treated as quarantine
 * history.
 */
export function orderQuarantineSnapshotCandidates(
  names: readonly string[],
  completedAtMs: number,
): { name: string; ms: number }[] {
  const parsed: { name: string; ms: number; n: number }[] = [];
  for (const name of names) {
    const match = HISTORY_TS_PATTERN.exec(name);
    if (!match) continue;
    const ms = Number(match[1]);
    if (!Number.isSafeInteger(ms) || ms > completedAtMs) continue;
    parsed.push({ name, ms, n: match[2] === undefined ? 0 : Number(match[2]) });
  }
  parsed.sort((a, b) => b.ms - a.ms || b.n - a.n);
  return parsed.map(({ name, ms }) => ({ name, ms }));
}

/** The snapshot a quarantined agent is restored from. */
export interface QuarantineSnapshot {
  /** History dir name (`<ms>[-<n>]`). */
  readonly ts: string;
  readonly ms: number;
  /** `<scopedRoot>/.history/<slug>/<ts>/<slug>.md`, a regular file. */
  readonly file: string;
}

/**
 * - `quarantined`: in the record, no workspace source for it.
 * - `source-restored`: the source is back but the scoped clone is not, so
 *   propagation is pending, failed, or agent sync is off for the workspace.
 */
export type QuarantinedAgentState = 'quarantined' | 'source-restored';

export interface QuarantinedAgentItem {
  slug: string;
  state: QuarantinedAgentState;
  /** The selected snapshot's time as ISO, `null` when there is none. */
  quarantinedAt: string | null;
  hasSnapshot: boolean;
  /** `{ws}/.claude/agents/<slug>.md` — where Restore writes. */
  sourcePath: string;
}

export interface QuarantinedAgentsListing {
  /** The marker exists but could not be read or failed validation. */
  recordUnreadable: boolean;
  quarantined: QuarantinedAgentItem[];
  /** Kept foreign clones (local work / unprovable) still in the scoped root. */
  notOwned: string[];
}

export type QuarantineRestoreOutcome =
  | 'restored'
  | 'already-restored'
  | 'conflict'
  | 'not-quarantined'
  | 'no-snapshot'
  | 'copy-failed';

export interface QuarantineRestoreResult {
  outcome: QuarantineRestoreOutcome;
  /** The file the outcome is about (the source, or a conflicting clone). */
  path: string;
  reason?: string;
}

/** Where one workspace's quarantine record and agent source live. */
export interface QuarantineLocation {
  scopedAgentsRoot: string;
  /** `{ws}/.claude/agents`. */
  agentSourceDir: string;
}

export interface QuarantineRestoreArgs extends QuarantineLocation {
  slug: string;
  withSlugLock: AgentSlugLock;
}

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

/** `rename(from, to)`; injectable so specs can interleave a save with it. */
export type RenamePath = (from: string, to: string) => Promise<void>;

/** A clone (and its sidecar) renamed into `.history/<slug>/<ts>/`. */
interface DetachedClone {
  readonly historyDir: string;
  readonly clone: DetachedFile;
  sidecar: DetachedFile | null;
}

interface DetachedFile {
  readonly original: string;
  readonly staged: string;
}

export class UserLayerSeedQuarantine {
  private readonly passLock = new SeedQuarantinePassLock();

  constructor(
    private readonly logger: Logger,
    private readonly fs: UserLayerFsOps,
    /** Test seam for the detach step; production always uses `fs.rename`. */
    private readonly renamePath: RenamePath = rename,
  ) {}

  async run(args: SeedQuarantineArgs): Promise<SeedQuarantineResult> {
    const { workspaceRoot, scopedAgentsRoot, legacyAgentsRoot, source } = args;

    if (workspaceRoot === undefined) return emptySeedQuarantineResult();
    if (resolve(scopedAgentsRoot) === resolve(legacyAgentsRoot)) {
      return emptySeedQuarantineResult();
    }
    if (source.status !== 'ok') {
      this.logger.debug(
        '[UserLayerMirror] seed quarantine skipped: agent source not read',
        { workspaceRoot, agentSourceDir: source.dir, status: source.status },
      );
      return emptySeedQuarantineResult();
    }
    const ownedSlugs = source.slugs;
    return this.passLock.run(scopedAgentsRoot, () =>
      this.runPass(args, ownedSlugs),
    );
  }

  /**
   * One pass, from the marker check to the marker write, under the pass lock:
   * an overlapping second pass starts after this one and sees its marker.
   */
  private async runPass(
    args: SeedQuarantineArgs,
    ownedSlugs: ReadonlySet<string>,
  ): Promise<SeedQuarantineResult> {
    const result = emptySeedQuarantineResult();
    const { workspaceRoot, scopedAgentsRoot, legacyAgentsRoot } = args;
    const markerPath = join(scopedAgentsRoot, SEED_QUARANTINE_MARKER);
    if (await this.fs.fileExists(markerPath)) return result;

    const journal = await SeedQuarantineJournal.open(
      this.fs,
      this.logger,
      scopedAgentsRoot,
    );
    if (journal === null) return result;

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
      if (ownedSlugs.has(slug)) continue;
      const outcome = await args.withSlugLock(slug, () =>
        this.handleSlug(
          slug,
          scopedAgentsRoot,
          legacyAgentsRoot,
          ownedSlugs,
          journal,
        ),
      );
      if (outcome === 'quarantine') result.quarantined.push(slug);
      else if (outcome === 'kept-local-work')
        result.keptWithLocalWork.push(slug);
      else if (outcome === 'kept-unprovable') result.keptUnprovable.push(slug);
      else if (outcome === 'failed') result.failed.push(slug);
    }

    await journal.recordKept(result);
    if (result.failed.length === 0) {
      result.markerWritten = await this.writeMarker(
        markerPath,
        mergeSeedQuarantineLists(journal.lists, result),
      );
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
   * Classify and, when proven, move ONE clone, under the slug lock. The slug
   * lock does not stop an editor save, so the move itself re-proves the bytes
   * on the detached file; a move counts only once it is in the journal.
   */
  private async handleSlug(
    slug: string,
    scopedAgentsRoot: string,
    legacyAgentsRoot: string,
    ownedSlugs: ReadonlySet<string>,
    journal: SeedQuarantineJournal,
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

      const detached = await this.detachToHistory(
        slug,
        scopedAgentsRoot,
        cloneFile,
        cloneBytes,
      );
      try {
        await journal.recordMove(slug);
      } catch (error: unknown) {
        // Unrecorded, the move would vanish from the list Restore reads; put
        // the clone back so the next pass moves and records it again.
        if (!(await this.undoDetach(detached))) {
          this.logger.error(
            '[UserLayerMirror] seed quarantine not recorded and clone not put back; its bytes stay in history',
            { slug, historyFile: detached.clone.staged },
          );
        }
        throw new Error(`not recorded: ${errorText(error)}`, { cause: error });
      }
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
   * DETACH the clone, then decide on the detached bytes (TASK_2026_609 review
   * F2). Sidecar, then clone, are RENAMED into a fresh `.history/<slug>/<ts>/`;
   * nothing is copied and nothing at the live paths is ever unlinked. The
   * renamed clone is then compared with the bytes that were classified: a save
   * that landed before the rename makes them differ, and that file is user
   * work, so it is put back without clobbering anything and the slug fails
   * this pass. A save after the rename creates a new file at the live path,
   * which this code never touches again. A failed rename leaves the clone where
   * it was, returns the sidecar and removes the empty `<ts>` dir.
   */
  private async detachToHistory(
    slug: string,
    scopedAgentsRoot: string,
    cloneFile: string,
    cloneBytes: Buffer,
  ): Promise<DetachedClone> {
    const sidecarPath = join(
      scopedAgentsRoot,
      `${slug}${ORIGIN_SIDECAR_SUFFIX}`,
    );
    const historyDir = await this.fs.makeUniqueHistoryDir(
      join(scopedAgentsRoot, DEFAULT_HISTORY_DIR, slug),
      String(Date.now()),
    );
    const detached: DetachedClone = {
      historyDir,
      clone: { original: cloneFile, staged: join(historyDir, `${slug}.md`) },
      sidecar: null,
    };
    try {
      if (await this.fs.fileExists(sidecarPath)) {
        const sidecar = {
          original: sidecarPath,
          staged: join(historyDir, basename(sidecarPath)),
        };
        await this.move(sidecar.original, sidecar.staged);
        detached.sidecar = sidecar;
      }
      await this.move(detached.clone.original, detached.clone.staged);
    } catch (error: unknown) {
      await this.putBack(detached.sidecar);
      await this.removeEmptyDir(historyDir);
      throw error;
    }

    if (!(await this.stagedMatches(detached.clone.staged, cloneBytes))) {
      if (!(await this.undoDetach(detached))) {
        this.logger.warn(
          '[UserLayerMirror] agent changed during seed quarantine and its path is taken; the changed file is kept in history',
          { slug, historyFile: detached.clone.staged },
        );
      }
      throw new Error(
        `${slug} changed between classification and detach; kept as local work`,
      );
    }
    return detached;
  }

  /** `false` when the staged file is missing, unreadable or different. */
  private async stagedMatches(staged: string, bytes: Buffer): Promise<boolean> {
    try {
      return (await readFile(staged)).equals(bytes);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - bytes that cannot be read
      // back are unproven, which is handled exactly like changed bytes: the
      // detach is undone and the slug fails this pass.
      this.logger.warn('[UserLayerMirror] detached agent unreadable', {
        staged,
        error: errorText(error),
      });
      return false;
    }
  }

  /**
   * Put a detached clone (and then its sidecar) back at the live paths without
   * replacing anything there. `false` when the clone could not go back; it and
   * its sidecar then stay together in `historyDir`.
   */
  private async undoDetach(detached: DetachedClone): Promise<boolean> {
    if (!(await this.putBack(detached.clone))) return false;
    await this.putBack(detached.sidecar);
    await this.removeEmptyDir(detached.historyDir);
    return true;
  }

  /**
   * No-clobber move back to the live path. `false` (warned) when the path is
   * taken or the move fails; the file then stays in history. A sidecar left
   * there makes its clone sidecar-less, which every pass re-proves by bytes.
   *
   * Nothing at the live path is ever unlinked here, not even after a failed
   * fallback copy: by then an editor may own that path (code-logic re-review
   * #1). The warning names the history file as the complete copy to recover.
   */
  private async putBack(file: DetachedFile | null): Promise<boolean> {
    if (file === null) return true;
    let failure: 'exists' | Error | null;
    try {
      this.fs.assertUnderUserLayer(file.original);
      const placed = await placeExclusive(file.staged, file.original);
      if (placed === 'placed') failure = null;
      else if (placed === 'exists') failure = 'exists';
      else failure = placed.copyFailed;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - reported below; the bytes
      // stay in history, and the caller names that file.
      failure = error instanceof Error ? error : new Error(String(error));
    }
    if (failure !== null) {
      this.logger.warn('[UserLayerMirror] detached file not put back', {
        staged: file.staged,
        livePath: file.original,
        reason:
          failure === 'exists'
            ? 'live path taken'
            : `${failure.message}; the live path may hold an incomplete copy, the complete file is the staged one`,
      });
      return false;
    }
    await unlink(file.staged).catch((error: unknown) => {
      // degradation-audit: optional-capability - the file is back at its live
      // path; a leftover copy in history is harmless and is never in the
      // quarantine record, because this slug failed the pass.
      this.logger.warn('[UserLayerMirror] history copy not removed', {
        staged: file.staged,
        error: errorText(error),
      });
    });
    return true;
  }

  private async move(from: string, to: string): Promise<void> {
    this.fs.assertUnderUserLayer(from);
    this.fs.assertUnderUserLayer(to);
    await this.renamePath(from, to);
  }

  /** Non-recursive: a `<ts>` dir that still holds anything stays. */
  private async removeEmptyDir(dir: string): Promise<void> {
    this.fs.assertUnderUserLayer(dir);
    await rmdir(dir).catch((error: unknown) => {
      // degradation-audit: optional-capability - an empty `<ts>` dir left
      // behind holds no `<slug>.md`, so `selectSnapshot` never picks it.
      if (!isErrnoCode(error, 'ENOENT') && !isErrnoCode(error, 'ENOTEMPTY')) {
        this.logger.warn('[UserLayerMirror] empty history dir not removed', {
          dir,
          error: errorText(error),
        });
      }
    });
  }

  private async writeMarker(
    markerPath: string,
    lists: SeedQuarantineLists,
  ): Promise<boolean> {
    try {
      await this.fs.writeTextAtomic(
        markerPath,
        JSON.stringify(
          {
            version: 1,
            completedAt: new Date().toISOString(),
            quarantined: lists.quarantined,
            keptWithLocalWork: lists.keptWithLocalWork,
            keptUnprovable: lists.keptUnprovable,
          },
          null,
          2,
        ),
      );
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - without the marker the next
      // pass runs again; every clone it could move has already moved and is
      // in the journal, so the rerun only re-reports the kept ones.
      this.logger.warn('[UserLayerMirror] seed quarantine marker not written', {
        markerPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * The quarantine record as the Agents tab shows it. State is derived from
   * disk on every call and never stored: an item leaves the list only once its
   * scoped clone exists again, i.e. once propagation actually succeeded.
   * Read-only.
   */
  async listQuarantined(
    location: QuarantineLocation,
  ): Promise<QuarantinedAgentsListing> {
    const { scopedAgentsRoot, agentSourceDir } = location;
    const read = await this.readValidatedMarker(scopedAgentsRoot);
    const listing: QuarantinedAgentsListing = {
      recordUnreadable: read.unreadable,
      quarantined: [],
      notOwned: [],
    };
    const marker = read.marker;
    if (marker === null) return listing;

    for (const slug of marker.quarantined) {
      if (await pathExists(join(scopedAgentsRoot, `${slug}.md`))) continue;
      const sourcePath = join(agentSourceDir, `${slug}.md`);
      const snapshot = await this.selectSnapshot(
        scopedAgentsRoot,
        slug,
        marker.completedAtMs,
      );
      listing.quarantined.push({
        slug,
        state: (await pathExists(sourcePath))
          ? 'source-restored'
          : 'quarantined',
        quarantinedAt:
          snapshot === null ? null : new Date(snapshot.ms).toISOString(),
        hasSnapshot: snapshot !== null,
        sourcePath,
      });
    }

    const kept = new Set([
      ...marker.keptWithLocalWork,
      ...marker.keptUnprovable,
    ]);
    for (const slug of kept) {
      if (await pathExists(join(scopedAgentsRoot, `${slug}.md`))) {
        listing.notOwned.push(slug);
      }
    }
    return listing;
  }

  /**
   * Put ONE quarantined agent back as a workspace source file, from its
   * quarantine snapshot, under the agent slug lock.
   *
   * It only ever creates `{ws}/.claude/agents/<slug>.md`. It never overwrites
   * an existing file, never deletes the snapshot or any other file, and never
   * turns agent sync on: whether the restored source propagates is the
   * workspace's existing consent, decided elsewhere.
   */
  async restore(args: QuarantineRestoreArgs): Promise<QuarantineRestoreResult> {
    // An unsafe slug is refused before it is joined into any path.
    const result: QuarantineRestoreResult = isSafeAgentSlug(args.slug)
      ? await args.withSlugLock(args.slug, () => this.restoreUnderLock(args))
      : {
          outcome: 'not-quarantined',
          path: args.agentSourceDir,
          reason: 'invalid agent slug',
        };
    this.logger.info('[UserLayerMirror] quarantined agent restore', {
      slug: args.slug,
      outcome: result.outcome,
      path: result.path,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    });
    return result;
  }

  private async restoreUnderLock(
    args: QuarantineRestoreArgs,
  ): Promise<QuarantineRestoreResult> {
    const { slug, scopedAgentsRoot, agentSourceDir } = args;
    const dest = join(agentSourceDir, `${slug}.md`);
    try {
      const { marker } = await this.readValidatedMarker(scopedAgentsRoot);
      if (marker === null || !marker.quarantined.includes(slug)) {
        return {
          outcome: 'not-quarantined',
          path: dest,
          reason:
            marker === null
              ? 'no readable quarantine record for this workspace'
              : 'agent is not in the quarantine record',
        };
      }

      const snapshot = await this.selectSnapshot(
        scopedAgentsRoot,
        slug,
        marker.completedAtMs,
      );
      if (snapshot === null) {
        return {
          outcome: 'no-snapshot',
          path: dest,
          reason: 'no quarantine snapshot found',
        };
      }

      const clonePath = join(scopedAgentsRoot, `${slug}.md`);
      if (await pathExists(clonePath)) {
        return {
          outcome: 'conflict',
          path: clonePath,
          reason: 'a clone of this agent already exists for this workspace',
        };
      }

      const bytes = await readFile(snapshot.file);
      const existing = await this.compareExisting(dest, bytes);
      if (existing !== null) return existing;

      return await this.copySnapshotToSource(
        bytes,
        snapshot.file,
        agentSourceDir,
        slug,
        dest,
      );
    } catch (error: unknown) {
      return { outcome: 'copy-failed', path: dest, reason: errorText(error) };
    }
  }

  /**
   * `null` when `dest` does not exist. Otherwise identical bytes are the retry
   * of an earlier Restore (`already-restored`, no write) and anything else is
   * the user's file (`conflict`, untouched).
   */
  private async compareExisting(
    dest: string,
    bytes: Buffer,
  ): Promise<QuarantineRestoreResult | null> {
    let destStat;
    try {
      destStat = await lstat(dest);
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) return null;
      throw error;
    }
    if (destStat.isFile() && (await readFile(dest)).equals(bytes)) {
      return { outcome: 'already-restored', path: dest };
    }
    return {
      outcome: 'conflict',
      path: dest,
      reason: 'a different file already exists at the restore destination',
    };
  }

  /**
   * Write the snapshot bytes to a temp file beside `dest`, prove them, then
   * place the temp at `dest` exclusively: a hard link (atomic, `EEXIST` if
   * anything got there first) or, where the filesystem refuses links, a
   * `COPYFILE_EXCL` copy. The temp is always removed.
   *
   * Once `dest` is published it is never unlinked (code-logic review B-2a):
   * another writer may have replaced it after the link. A published `dest`
   * that does not hold the snapshot bytes, or a fallback copy that failed
   * part-way, is a `conflict` that keeps `dest` and names the snapshot, which
   * stays in history as the complete copy.
   */
  private async copySnapshotToSource(
    bytes: Buffer,
    snapshotFile: string,
    agentSourceDir: string,
    slug: string,
    dest: string,
  ): Promise<QuarantineRestoreResult> {
    const tmp = join(
      agentSourceDir,
      `.${slug}.md.ptah-restore-${randomBytes(6).toString('hex')}.tmp`,
    );
    try {
      await mkdir(agentSourceDir, { recursive: true });
      await writeFile(tmp, bytes, { flag: 'wx' });
      if (!(await readFile(tmp)).equals(bytes)) {
        throw new Error('temporary copy does not match the snapshot');
      }
      const placed = await placeExclusive(tmp, dest);
      if (placed === 'exists') {
        // Created by someone else between the check and the link.
        return (
          (await this.compareExisting(dest, bytes)) ?? {
            outcome: 'copy-failed',
            path: dest,
            reason: 'restore destination changed during restore',
          }
        );
      }
      if (placed !== 'placed') {
        return {
          outcome: 'conflict',
          path: dest,
          reason: `copying the snapshot failed (${placed.copyFailed.message}); ${dest} may hold an incomplete copy and was kept; the complete snapshot is ${snapshotFile}`,
        };
      }
      if (!(await readFile(dest)).equals(bytes)) {
        return {
          outcome: 'conflict',
          path: dest,
          reason: `${dest} does not hold the snapshot bytes after it was published (changed by another writer, or an incomplete copy) and was kept; the complete snapshot is ${snapshotFile}`,
        };
      }
      return { outcome: 'restored', path: dest };
    } catch (error: unknown) {
      return { outcome: 'copy-failed', path: dest, reason: errorText(error) };
    } finally {
      await unlink(tmp).catch((error: unknown) => {
        // degradation-audit: optional-capability - ENOENT means the temp was
        // never created; any other failure leaves a dot-prefixed `.tmp` that
        // is not `*.md`, so no agent listing reads it. Reported, not thrown,
        // because the restore outcome is already decided.
        if (!isErrnoCode(error, 'ENOENT')) {
          this.logger.warn('[UserLayerMirror] restore temp file not removed', {
            tmp,
            error: errorText(error),
          });
        }
      });
    }
  }

  /**
   * The marker, validated. `unreadable` is true when a marker file exists but
   * cannot be read, parsed or validated; an absent marker is not unreadable.
   */
  private async readValidatedMarker(
    scopedAgentsRoot: string,
  ): Promise<{ marker: SeedQuarantineMarker | null; unreadable: boolean }> {
    const markerPath = join(scopedAgentsRoot, SEED_QUARANTINE_MARKER);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(markerPath, 'utf8'));
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) {
        return { marker: null, unreadable: false };
      }
      this.logger.warn('[UserLayerMirror] seed quarantine marker unreadable', {
        markerPath,
        error: errorText(error),
      });
      return { marker: null, unreadable: true };
    }

    const validation = validateSeedQuarantineMarker(raw);
    if (validation.status === 'invalid') {
      this.logger.warn('[UserLayerMirror] seed quarantine marker malformed', {
        markerPath,
        reason: validation.reason,
      });
      return { marker: null, unreadable: true };
    }
    if (validation.droppedSlugs.length > 0) {
      this.logger.warn(
        '[UserLayerMirror] seed quarantine marker: unsafe slugs dropped',
        {
          markerPath,
          droppedSlugs: validation.droppedSlugs.map((s) =>
            JSON.stringify(s.slice(0, 80)),
          ),
        },
      );
    }
    return { marker: validation.marker, unreadable: false };
  }

  /**
   * The newest `.history/<slug>/<ts>/` not later than `completedAt` that holds
   * a regular `<slug>.md`. A missing or unreadable history dir is "no
   * snapshot", never an error.
   */
  private async selectSnapshot(
    scopedAgentsRoot: string,
    slug: string,
    completedAtMs: number,
  ): Promise<QuarantineSnapshot | null> {
    const parent = join(scopedAgentsRoot, DEFAULT_HISTORY_DIR, slug);
    let dirNames: string[];
    try {
      dirNames = (await readdir(parent, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - no readable history means no
      // snapshot to restore from; the item is listed with `hasSnapshot:false`
      // and Restore refuses with `no-snapshot` instead of writing anything.
      if (!isErrnoCode(error, 'ENOENT')) {
        this.logger.warn('[UserLayerMirror] quarantine history unreadable', {
          slug,
          historyDir: parent,
          error: errorText(error),
        });
      }
      return null;
    }

    for (const candidate of orderQuarantineSnapshotCandidates(
      dirNames,
      completedAtMs,
    )) {
      const file = join(parent, candidate.name, `${slug}.md`);
      if (await isRegularFile(file)) {
        return { ts: candidate.name, ms: candidate.ms, file };
      }
    }
    return null;
  }
}

/**
 * `copy-failed`: the `COPYFILE_EXCL` fallback failed after it may have created
 * `dest`, so `dest` may hold an incomplete copy.
 */
type ExclusivePlacement = 'placed' | 'exists' | { copyFailed: Error };

/**
 * Create `dest` from `tmp` without ever replacing an existing file. `'exists'`
 * when something is already there.
 *
 * Nothing at `dest` is ever unlinked, not even after a failed fallback copy:
 * once the path has been published another writer may own it (an editor's
 * save, a rename onto it), and the caller still holds the complete bytes.
 * A link failure other than "unsupported" throws; `dest` was not created.
 */
async function placeExclusive(
  tmp: string,
  dest: string,
): Promise<ExclusivePlacement> {
  try {
    await link(tmp, dest);
    return 'placed';
  } catch (error: unknown) {
    if (isErrnoCode(error, 'EEXIST')) return 'exists';
    if (!LINK_UNSUPPORTED_CODES.some((code) => isErrnoCode(error, code))) {
      throw error;
    }
  }
  try {
    await copyFile(tmp, dest, fsConstants.COPYFILE_EXCL);
    return 'placed';
  } catch (error: unknown) {
    if (isErrnoCode(error, 'EEXIST')) return 'exists';
    return {
      copyFailed: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/** Any entry at `path` (file, dir or link), without following links. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isErrnoCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    // degradation-audit: optional-capability - a snapshot file that cannot be
    // stat'ed is not a usable snapshot; the caller tries the next candidate.
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
