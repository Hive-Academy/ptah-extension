import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BENCH_DATA_DIR_ENV,
  resolveBenchDataDir,
  type ResolveBenchDataDirOptions,
} from '../../bench-data';

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
  /** Dirs (at any depth) whose subtree holds no regular file. */
  emptyDirs: string[];
  /** Entries that are neither a regular file nor a directory; reported, not followed. */
  nonRegular: string[];
  problems: string[];
}

export interface VerifyCandidateManifestOptions {
  /** Bench data root; validated by 619's `resolveBenchDataDir` rules. */
  benchDataDir: string;
  /** Folder under `<benchDataDir>/snapshots/`; the manifest is `<name>.manifest.json` beside it. */
  snapshotName?: string;
  /** Expected `manifestSha256`; `null` skips the pin (synthetic specs pass their own). */
  expectedManifestSha256?: string | null;
  /** Overrides for the bench-data rules (specs only). */
  benchDataRules?: BenchDataRules;
}

/** The `resolveBenchDataDir` inputs a caller may override; the dir itself is explicit. */
export type BenchDataRules = Pick<
  ResolveBenchDataDirOptions,
  'realHome' | 'repoRoot' | 'platform'
>;

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
  const benchDataDir = resolveBenchDataDir({
    ...options.benchDataRules,
    env: { [BENCH_DATA_DIR_ENV]: options.benchDataDir },
  });
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

  const walked = await walkCopy(copyDir);
  const onDisk = walked.files;
  const dirsOnDisk = walked.topLevelDirs.length;
  if (walked.emptyDirs.length > 0) {
    problems.push(
      `${walked.emptyDirs.length} dir(s) hold no file: ${walked.emptyDirs.slice(0, 5).join(', ')}`,
    );
  }
  if (walked.nonRegular.length > 0) {
    problems.push(
      `${walked.nonRegular.length} non-regular entr(y/ies) (link, junction, device): ${walked.nonRegular.slice(0, 5).join(', ')}`,
    );
  }
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
    emptyDirs: walked.emptyDirs,
    nonRegular: walked.nonRegular,
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

interface CopyWalk {
  files: string[];
  topLevelDirs: string[];
  emptyDirs: string[];
  nonRegular: string[];
}

/**
 * Walks the copy: regular files as `/`-separated relative paths, every
 * top-level dir (including empty ones), dirs whose subtree holds no file, and
 * non-regular entries, which are reported instead of followed.
 */
async function walkCopy(root: string): Promise<CopyWalk> {
  const result: CopyWalk = {
    files: [],
    topLevelDirs: [],
    emptyDirs: [],
    nonRegular: [],
  };
  const walk = async (dir: string, prefix: string): Promise<number> => {
    let filesBelow = 0;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (prefix === '') result.topLevelDirs.push(rel);
        const below = await walk(join(dir, entry.name), rel);
        if (below === 0) result.emptyDirs.push(rel);
        filesBelow += below;
      } else if (entry.isFile()) {
        result.files.push(rel);
        filesBelow += 1;
      } else {
        result.nonRegular.push(rel);
      }
    }
    return filesBelow;
  };
  await walk(root, '');
  result.emptyDirs.sort(compareCodePoints);
  result.nonRegular.sort(compareCodePoints);
  return result;
}

const BACKSLASH = String.fromCharCode(0x5c);

function pythonJsonString(value: string): string {
  // JSON.stringify escapes quotes, backslashes and control characters as
  // Python does; Python additionally escapes every non-ASCII UTF-16 code unit.
  const json = JSON.stringify(value);
  let out = '';
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    out +=
      code > 0x7f
        ? BACKSLASH + 'u' + code.toString(16).padStart(4, '0')
        : json.charAt(i);
  }
  return out;
}
