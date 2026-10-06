import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

/** Frozen candidate copy taken on 2026-10-06 (context.md, Status). */
export const FROZEN_CANDIDATES_NAME = 'skill-candidates-20261006';
/** `manifestSha256` recorded when the copy was frozen (context.md, Status). */
export const FROZEN_CANDIDATES_MANIFEST_SHA256 =
  '73a184c53aa976ce58f28f527f2d8290ec8a80f4bb242897bfe4f0c24b6745f3';

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** Manifest format written at freeze time: `{source, dirs, files, manifestSha256, files_sha256}`. */
export const CandidateManifestSchema = z.object({
  source: z.string().min(1),
  dirs: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  manifestSha256: sha256Hex,
  files_sha256: z.record(z.string().min(1), sha256Hex),
});
export type CandidateManifest = z.infer<typeof CandidateManifestSchema>;

export interface ChangedFile {
  relPath: string;
  expected: string;
  actual: string;
}

export interface CandidateManifestReport {
  ok: boolean;
  copyDir: string;
  manifestPath: string;
  /** sha256 of the manifest file bytes (identifies the manifest file itself). */
  manifestFileSha256: string;
  declaredManifestSha256: string;
  recomputedManifestSha256: string;
  expectedManifestSha256: string | null;
  manifestHashOk: boolean;
  dirsDeclared: number;
  filesDeclared: number;
  dirsOnDisk: number;
  filesOnDisk: number;
  filesVerified: number;
  missing: string[];
  extra: string[];
  changed: ChangedFile[];
  problems: string[];
}

export interface VerifyCandidateManifestOptions {
  /** Bench data root (`PTAH_MCP_BENCH_DATA_DIR`); explicit until 619's `resolveBenchDataDir()` lands. */
  benchDataDir: string;
  /** Folder under `<benchDataDir>/snapshots/`; the manifest is `<name>.manifest.json` beside it. */
  snapshotName?: string;
  /** Expected `manifestSha256`; `null` skips the pin (synthetic specs pass their own). */
  expectedManifestSha256?: string | null;
  /** Guard overrides (specs only). */
  guard?: BenchDataDirGuardOptions;
}

export interface BenchDataDirGuardOptions {
  /** Home directory whose `.ptah` is the real product state. Defaults to `os.homedir()`. */
  homeDir?: string;
  /** Repository root. Defaults to the nearest ancestor of `process.cwd()` holding `.git`. */
  repoRoot?: string | null;
}

/**
 * Returns the absolute bench data dir, or throws when it sits under the real
 * `~/.ptah` or inside the repository (benchmarks never touch product state and
 * private data is never written where git can pick it up). Replaced by 619's
 * `resolveBenchDataDir()` in Batch 16.
 */
export function assertSafeBenchDataDir(
  dir: string,
  options: BenchDataDirGuardOptions = {},
): string {
  if (dir.trim() === '') throw new Error('Bench data dir is empty');
  if (!isAbsolute(dir)) {
    throw new Error(`Bench data dir must be an absolute path: ${dir}`);
  }
  const target = canonicalPath(dir);
  const realPtah = canonicalPath(join(options.homeDir ?? homedir(), '.ptah'));
  if (isWithin(target, realPtah)) {
    throw new Error(
      `Refusing bench data dir under the real ~/.ptah: ${target} (${realPtah})`,
    );
  }
  const repoRoot =
    options.repoRoot === undefined
      ? findRepoRoot(process.cwd())
      : options.repoRoot;
  if (repoRoot !== null && isWithin(target, canonicalPath(repoRoot))) {
    throw new Error(
      `Refusing bench data dir inside the repository: ${target} (${repoRoot})`,
    );
  }
  return target;
}

/**
 * `manifestSha256` as the freeze script computed it: sha256 of Python's
 * `json.dumps(files_sha256, sort_keys=True)` (`", "` / `": "` separators,
 * non-ASCII escaped). Verified against the 2026-10-06 manifest.
 */
export function computeManifestSha256(
  filesSha256: Readonly<Record<string, string>>,
): string {
  const body = Object.keys(filesSha256)
    .sort(compareCodePoints)
    .map(
      (key) =>
        `${pythonJsonString(key)}: ${pythonJsonString(filesSha256[key] ?? '')}`,
    )
    .join(', ');
  return sha256(`{${body}}`);
}

/** Recomputes every file hash and the manifest hash of the frozen candidate copy. */
export async function verifyCandidateManifest(
  options: VerifyCandidateManifestOptions,
): Promise<CandidateManifestReport> {
  const benchDataDir = assertSafeBenchDataDir(
    options.benchDataDir,
    options.guard,
  );
  const name = options.snapshotName ?? FROZEN_CANDIDATES_NAME;
  const snapshotsDir = join(benchDataDir, 'snapshots');
  const copyDir = join(snapshotsDir, name);
  const manifestPath = join(snapshotsDir, `${name}.manifest.json`);
  const expected =
    options.expectedManifestSha256 === undefined
      ? FROZEN_CANDIDATES_MANIFEST_SHA256
      : options.expectedManifestSha256;

  const manifestBytes = await readFile(manifestPath);
  const manifest = CandidateManifestSchema.parse(
    JSON.parse(manifestBytes.toString('utf8')),
  );
  const recomputed = computeManifestSha256(manifest.files_sha256);
  const problems: string[] = [];
  if (recomputed !== manifest.manifestSha256) {
    problems.push(
      `manifestSha256 mismatch: declared ${manifest.manifestSha256}, recomputed ${recomputed}`,
    );
  }
  if (expected !== null && manifest.manifestSha256 !== expected) {
    problems.push(
      `manifestSha256 ${manifest.manifestSha256} is not the frozen value ${expected}`,
    );
  }
  const declaredFiles = Object.keys(manifest.files_sha256);
  if (declaredFiles.length !== manifest.files) {
    problems.push(
      `manifest declares files=${manifest.files} but lists ${declaredFiles.length} hashes`,
    );
  }

  const onDisk = await listFiles(copyDir);
  const dirsOnDisk = new Set(onDisk.map((p) => p.split('/')[0])).size;
  if (dirsOnDisk !== manifest.dirs) {
    problems.push(
      `copy has ${dirsOnDisk} top-level dirs, manifest declares ${manifest.dirs}`,
    );
  }
  const onDiskSet = new Set(onDisk);
  const missing = declaredFiles
    .filter((p) => !onDiskSet.has(p))
    .sort(compareCodePoints);
  const extra = onDisk
    .filter((p) => manifest.files_sha256[p] === undefined)
    .sort(compareCodePoints);
  const changed: ChangedFile[] = [];
  let filesVerified = 0;
  for (const relPath of declaredFiles.sort(compareCodePoints)) {
    if (!onDiskSet.has(relPath)) continue;
    const actual = sha256(await readFile(join(copyDir, ...relPath.split('/'))));
    const expectedHash = manifest.files_sha256[relPath] ?? '';
    if (actual === expectedHash) filesVerified += 1;
    else changed.push({ relPath, expected: expectedHash, actual });
  }
  if (missing.length > 0) problems.push(`${missing.length} file(s) missing`);
  if (extra.length > 0) problems.push(`${extra.length} unlisted file(s)`);
  if (changed.length > 0) problems.push(`${changed.length} file(s) changed`);

  return {
    ok: problems.length === 0,
    copyDir,
    manifestPath,
    manifestFileSha256: sha256(manifestBytes),
    declaredManifestSha256: manifest.manifestSha256,
    recomputedManifestSha256: recomputed,
    expectedManifestSha256: expected,
    manifestHashOk:
      recomputed === manifest.manifestSha256 &&
      (expected === null || expected === manifest.manifestSha256),
    dirsDeclared: manifest.dirs,
    filesDeclared: manifest.files,
    dirsOnDisk,
    filesOnDisk: onDisk.length,
    filesVerified,
    missing,
    extra,
    changed,
    problems,
  };
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Code-point order (Python's default string sort), independent of locale. */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff =
      (left[i]?.codePointAt(0) ?? 0) - (right[i]?.codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

/** Every regular file under `root`, as `/`-separated paths relative to it. */
async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
      else throw new Error(`Unexpected non-regular entry in copy: ${rel}`);
    }
  };
  await walk(root, '');
  return out;
}

function pythonJsonString(value: string): string {
  // JSON.stringify escapes quotes, backslashes and control characters as
  // Python does; Python additionally escapes every non-ASCII code unit.
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function canonicalPath(path: string): string {
  let resolved = resolve(path);
  // Resolve the deepest existing ancestor so a junction or symlink cannot hide
  // a path under ~/.ptah or the repository.
  let probe = resolved;
  const tail: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    tail.unshift(probe.slice(parent.length).replace(/^[\\/]/, ''));
    probe = parent;
  }
  if (existsSync(probe)) resolved = join(realpathSync.native(probe), ...tail);
  return resolved;
}

function isWithin(target: string, root: string): boolean {
  const fold = (p: string): string =>
    process.platform === 'win32' ? p.toLowerCase() : p;
  const rel = relative(fold(root), fold(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function findRepoRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
