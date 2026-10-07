/**
 * Copies a plan's fixtures into the bench host's isolated home before the
 * engine boots (benchmark-design.md 6.1, R-X2 step 3; runs inside
 * `beforeEngineBoot`). Fixtures are always copied, never opened in place: the
 * engine only ever sees files inside the temp home, so neither the snapshot
 * nor a bench-data file can gain `-wal`/`-shm` sidecars or be mutated.
 *
 * Refusals (each throws {@link FixtureSeedError} before anything is copied for
 * that fixture):
 *   - an isolated home that is, contains or lies in the real `~/.ptah` (or
 *     holds the real home), compared as given and with links resolved;
 *   - a source in the real `~/.ptah` (by path, and again after resolving the
 *     real path, so a junction or symlinked ancestor cannot reach it);
 *   - a source outside the allowed roots (bench data dir, committed fixtures);
 *   - a symbolic link anywhere in a copied tree (`bench-data.ts` does not
 *     follow junctions, so a link could escape every lexical check);
 *   - a database source with a non-empty `-wal` or any `-journal` sidecar
 *     (the copy would silently drop committed pages);
 *   - a target outside the isolated home, or one that already exists;
 *   - a source whose hash changed during the copy, or a copy whose hash
 *     differs from its source.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  type Stats,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { isPathInside, isSamePath } from '../../bench-data';
import type { IsolatedPaths } from '../../transport/bench-host-boot';
import { defaultRealpath, resolveRealPath } from '../runner/read-path-guard';
import type { MemorySkillsFixture } from './plan.schema';

export class FixtureSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureSeedError';
  }
}

/** One copied fixture, for the host's completion record. */
export interface SeededFixture {
  readonly kind: MemorySkillsFixture['kind'];
  readonly source: string;
  /** Absolute path inside the isolated home. */
  readonly target: string;
  readonly files: number;
  readonly bytes: number;
  /**
   * File: sha256 of its bytes. Directory: sha256 over the sorted lines
   * `<posix relative path>\0<file sha256>\n`.
   */
  readonly sha256: string;
}

export interface SeedFixturesInput {
  readonly fixtures: readonly MemorySkillsFixture[];
  readonly isolation: IsolatedPaths;
  /** The user's real home; nothing under its `.ptah` is ever opened. */
  readonly realHome: string;
  /** Roots a source must lie inside (bench data dir, committed fixtures). */
  readonly allowedRoots: readonly string[];
  readonly platform?: NodeJS.Platform;
  /** Resolves links; default `fs.realpathSync.native` on this platform (specs override). */
  readonly realpath?: (path: string) => string;
}

const HASH_CHUNK_BYTES = 1 << 20;

function sha256File(path: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const fd = openSync(path, 'r');
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, HASH_CHUNK_BYTES, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

class Seeder {
  private readonly platform: NodeJS.Platform;
  private readonly realPtah: string;
  /** `realPtah` with links resolved. */
  private readonly realPtahReal: string;
  /** The allowed roots with links resolved, for checking a resolved source. */
  private readonly allowedRootsReal: readonly string[];

  constructor(private readonly input: SeedFixturesInput) {
    this.platform = input.platform ?? process.platform;
    const realpath =
      input.realpath === undefined
        ? defaultRealpath(this.platform)
        : input.realpath;
    const real = (path: string): string =>
      resolveRealPath(path, this.platform, realpath);
    this.realPtah = join(input.realHome, '.ptah');
    this.realPtahReal = real(this.realPtah);
    this.allowedRootsReal = input.allowedRoots.map(real);
    const atOrUnder = (path: string, root: string): boolean =>
      isSamePath(path, root, this.platform) ||
      isPathInside(path, root, this.platform);
    const home = input.isolation.home;
    const homeReal = real(home);
    // The isolated home must neither be nor lie in the real ~/.ptah, nor hold
    // the real home (and with it ~/.ptah), compared as given and as resolved.
    const overlaps = [
      [home, this.realPtah],
      [homeReal, this.realPtahReal],
      [homeReal, this.realPtah],
    ].some(
      ([isolated, ptah]) =>
        atOrUnder(isolated, ptah) ||
        atOrUnder(ptah, isolated) ||
        atOrUnder(input.realHome, isolated),
    );
    if (overlaps || atOrUnder(real(input.realHome), homeReal)) {
      throw new FixtureSeedError(
        `refusing to seed: the real home ${input.realHome} and the isolated home ${home} overlap`,
      );
    }
    if (input.allowedRoots.length === 0) {
      throw new FixtureSeedError('refusing to seed: no allowed source root');
    }
  }

  seed(fixture: MemorySkillsFixture): SeededFixture {
    this.assertSourcePath(fixture.source);
    const stats = lstatOrNull(fixture.source);
    if (stats === null) {
      throw new FixtureSeedError(`fixture source ${fixture.source} is missing`);
    }
    if (stats.isSymbolicLink()) {
      throw new FixtureSeedError(
        `fixture source ${fixture.source} is a symbolic link`,
      );
    }
    // A junction or symlinked ancestor: check where the bytes really are,
    // against the resolved roots.
    this.assertSourcePath(realpathSync.native(fixture.source), true);

    if (fixture.kind === 'directory') {
      if (!stats.isDirectory()) {
        throw new FixtureSeedError(
          `fixture source ${fixture.source} is not a directory`,
        );
      }
      return this.copyDirectory(fixture.source, this.target(fixture.target));
    }
    if (!stats.isFile()) {
      throw new FixtureSeedError(
        `fixture source ${fixture.source} is not a file`,
      );
    }
    if (fixture.kind === 'database') {
      this.assertNoSidecars(fixture.source);
      const target = this.input.isolation.dbPath;
      this.assertFreshTarget(target);
      return {
        kind: 'database',
        source: fixture.source,
        target,
        ...this.copyFile(fixture.source, target),
      };
    }
    const target = this.target(fixture.target);
    this.assertFreshTarget(target);
    return {
      kind: 'file',
      source: fixture.source,
      target,
      ...this.copyFile(fixture.source, target),
    };
  }

  /** `resolved`: `path` is a real path, so compare it with the resolved roots too. */
  private assertSourcePath(path: string, resolved = false): void {
    const ptahRoots = resolved
      ? [this.realPtah, this.realPtahReal]
      : [this.realPtah];
    if (
      ptahRoots.some(
        (root) =>
          isSamePath(path, root, this.platform) ||
          isPathInside(path, root, this.platform),
      )
    ) {
      throw new FixtureSeedError(
        `refusing fixture source ${path}: it lies in the real ${this.realPtah}`,
      );
    }
    const roots = resolved ? this.allowedRootsReal : this.input.allowedRoots;
    const allowed = roots.some((root) =>
      isPathInside(path, root, this.platform),
    );
    if (!allowed) {
      throw new FixtureSeedError(
        `refusing fixture source ${path}: outside ${this.input.allowedRoots.join(', ')}`,
      );
    }
  }

  private assertNoSidecars(source: string): void {
    const wal = lstatOrNull(`${source}-wal`);
    if (wal !== null && wal.size > 0) {
      throw new FixtureSeedError(
        `database fixture ${source} has a non-empty -wal sidecar; checkpoint it before seeding`,
      );
    }
    if (lstatOrNull(`${source}-journal`) !== null) {
      throw new FixtureSeedError(
        `database fixture ${source} has a -journal sidecar; it is not a closed database`,
      );
    }
  }

  private target(relativeTarget: string): string {
    const home = this.input.isolation.home;
    const target = join(home, relativeTarget);
    if (!isPathInside(target, home, this.platform)) {
      throw new FixtureSeedError(
        `fixture target ${relativeTarget} resolves outside the isolated home`,
      );
    }
    return target;
  }

  private assertFreshTarget(target: string): void {
    if (lstatOrNull(target) !== null) {
      throw new FixtureSeedError(`fixture target ${target} already exists`);
    }
  }

  /** Copy one file (never overwriting) and prove both ends hash the same. */
  private copyFile(
    source: string,
    target: string,
  ): { files: number; bytes: number; sha256: string } {
    const before = sha256File(source);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    const after = sha256File(source);
    if (after !== before) {
      throw new FixtureSeedError(
        `fixture source ${source} changed while it was copied`,
      );
    }
    const copied = sha256File(target);
    if (copied !== before) {
      throw new FixtureSeedError(`copy of ${source} does not match its source`);
    }
    return { files: 1, bytes: lstatSync(target).size, sha256: before };
  }

  private copyDirectory(source: string, target: string): SeededFixture {
    this.assertFreshTarget(target);
    const lines: string[] = [];
    let files = 0;
    let bytes = 0;
    const walk = (from: string, to: string): void => {
      mkdirSync(to, { recursive: true });
      const entries = readdirSync(from, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      for (const entry of entries) {
        const fromPath = join(from, entry.name);
        const toPath = join(to, entry.name);
        if (entry.isSymbolicLink()) {
          throw new FixtureSeedError(
            `fixture tree ${source} contains a symbolic link: ${fromPath}`,
          );
        }
        if (entry.isDirectory()) {
          walk(fromPath, toPath);
        } else if (entry.isFile()) {
          const copied = this.copyFile(fromPath, toPath);
          files += 1;
          bytes += copied.bytes;
          const rel = relative(source, fromPath).split(sep).join('/');
          lines.push(`${rel}\0${copied.sha256}\n`);
        } else {
          throw new FixtureSeedError(
            `fixture tree ${source} contains a non-regular entry: ${fromPath}`,
          );
        }
      }
    };
    walk(source, target);
    lines.sort();
    const sha256 = createHash('sha256')
      .update(lines.join(''), 'utf8')
      .digest('hex');
    return { kind: 'directory', source, target, files, bytes, sha256 };
  }
}

/**
 * Copy every fixture into the isolated home, in plan order. Throws
 * {@link FixtureSeedError} on the first refusal; the host then aborts the boot
 * and the launcher removes the temp home.
 */
export function seedFixtures(input: SeedFixturesInput): SeededFixture[] {
  const seeder = new Seeder(input);
  return input.fixtures.map((fixture) => seeder.seed(fixture));
}
