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
 *
 * The marker is also the record the Agents tab lists from, and Restore puts a
 * quarantined agent back as a SOURCE file the workspace owns
 * (`{ws}/.claude/agents/<slug>.md`), copied from its quarantine snapshot. The
 * scoped clone is not the destination: the orphan reaper would reap a clone
 * whose workspace ships no source for it. The next mirror pass re-creates the
 * clone from that source, which is what takes the item off the list.
 */
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { constants as fsConstants } from 'fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import { DEFAULT_HISTORY_DIR } from './origin-sidecar.types';
import { isErrnoCode } from './source-hash';
import type { UserLayerFsOps } from './user-layer-fs-ops';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

/** Written into the scoped agents root after a pass with zero failures. */
export const SEED_QUARANTINE_MARKER = '.ptah-seed-quarantine.json';

/**
 * The clone slug rule of `skills-synthesis-rpc.schema.ts` (`SlugSchema`),
 * duplicated here because agent-generation does not import rpc-handlers. A
 * marker slug becomes a path segment, so anything else is dropped.
 */
const AGENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const AGENT_SLUG_MAX_LENGTH = 128;

/** `<ms>` or `<ms>-<n>`, the names `makeUniqueHistoryDir` mints. */
const HISTORY_TS_PATTERN = /^(\d+)(?:-(\d+))?$/;

/** `link` errors that mean "this filesystem cannot hard-link here". */
const LINK_UNSUPPORTED_CODES = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'];

export function isSafeAgentSlug(slug: string): boolean {
  return (
    slug.length <= AGENT_SLUG_MAX_LENGTH &&
    slug !== '.' &&
    slug !== '..' &&
    !slug.includes('..') &&
    AGENT_SLUG_PATTERN.test(slug)
  );
}

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

      return await this.copySnapshotToSource(bytes, agentSourceDir, slug, dest);
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
   * `COPYFILE_EXCL` copy that is verified and removed again on mismatch. The
   * temp is always removed, so a failure leaves neither a partial `dest` nor a
   * temp, and a retry is never blocked.
   */
  private async copySnapshotToSource(
    bytes: Buffer,
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
      if ((await placeExclusive(tmp, dest)) === 'exists') {
        // Created by someone else between the check and the link.
        return (
          (await this.compareExisting(dest, bytes)) ?? {
            outcome: 'copy-failed',
            path: dest,
            reason: 'restore destination changed during restore',
          }
        );
      }
      if (!(await readFile(dest)).equals(bytes)) {
        await this.removeOwnDest(dest);
        throw new Error('restored file does not match the snapshot; removed');
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
   * Remove a `dest` this call created (under the slug lock, after an exclusive
   * create), so a failed restore never leaves a partial file behind.
   */
  private async removeOwnDest(dest: string): Promise<void> {
    try {
      await unlink(dest);
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) return;
      throw new Error(
        `restored file does not match the snapshot and could not be removed: ${errorText(error)}`,
        { cause: error },
      );
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
 * Create `dest` from `tmp` without ever replacing an existing file. `'exists'`
 * when something is already there. A failed `COPYFILE_EXCL` copy can leave a
 * partial `dest` this call created, so it is removed before the error goes on.
 */
async function placeExclusive(
  tmp: string,
  dest: string,
): Promise<'placed' | 'exists'> {
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
    // degradation-audit: optional-capability - EXCL guarantees any `dest` now
    // present was created by this failed copy; removing it is best-effort
    // cleanup, and the copy error itself is what propagates.
    await unlink(dest).catch(() => undefined);
    throw error;
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
