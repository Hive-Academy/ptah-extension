import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { sha256HexSchema } from './label-schemas';

export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  files: z.record(z.string().min(1), sha256HexSchema),
});
export type FixtureManifest = z.infer<typeof manifestSchema>;

export type ManifestMismatchKind = 'missing' | 'hash-mismatch' | 'unexpected';

export interface ManifestMismatch {
  readonly relPath: string;
  readonly kind: ManifestMismatchKind;
  /** sha256 recorded in the manifest; null when the file is not recorded. */
  readonly expected: string | null;
  /** sha256 of the file on disk; null when the file is gone. */
  readonly actual: string | null;
}

export interface ManifestVerification {
  readonly ok: boolean;
  readonly mismatches: readonly ManifestMismatch[];
}

/** Canonical JSON: object keys sorted at every depth, no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const members = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
  return `{${members.join(',')}}`;
}

/**
 * sha256 of canonical JSONL: every record serialized with
 * {@link canonicalJson} on its own LF-terminated line.
 */
export function canonicalJsonlHash(records: readonly unknown[]): string {
  return sha256Text(
    records.map((record) => `${canonicalJson(record)}\n`).join(''),
  );
}

/** sha256 of a file's raw bytes. */
export async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

const MANIFEST_FILE_NAME = 'MANIFEST.json';

/**
 * Hashes every file under the directory (excluding the manifest itself) into a
 * manifest. Paths are relative, `/`-separated and sorted.
 */
export async function buildManifest(
  directory: string,
): Promise<FixtureManifest> {
  const files: FixtureManifest['files'] = {};
  for (const relPath of await listFixtureFiles(directory))
    files[relPath] = await sha256File(join(directory, relPath));
  return { schemaVersion: 1, files };
}

export async function readManifest(
  directory: string,
): Promise<FixtureManifest> {
  const raw = JSON.parse(
    await readFile(join(directory, MANIFEST_FILE_NAME), 'utf8'),
  ) as unknown;
  return manifestSchema.parse(raw);
}

export async function writeManifest(
  directory: string,
  manifest: FixtureManifest,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, MANIFEST_FILE_NAME);
  await writeFile(
    path,
    `${JSON.stringify(manifestSchema.parse(manifest), null, 2)}\n`,
    'utf8',
  );
  return path;
}

/**
 * Compares the committed manifest with the directory's current contents and
 * returns every per-file mismatch. `ok` is false when any recorded file is gone
 * or changed, or any present file is unrecorded.
 */
export async function verifyManifest(
  directory: string,
): Promise<ManifestVerification> {
  const recorded = await readManifest(directory);
  const actual = await buildManifest(directory);
  const mismatches: ManifestMismatch[] = [];
  for (const [relPath, expected] of Object.entries(recorded.files)) {
    const onDisk: string | undefined = actual.files[relPath];
    if (onDisk === undefined)
      mismatches.push({ relPath, kind: 'missing', expected, actual: null });
    else if (onDisk !== expected)
      mismatches.push({
        relPath,
        kind: 'hash-mismatch',
        expected,
        actual: onDisk,
      });
  }
  for (const relPath of Object.keys(actual.files))
    if (!(relPath in recorded.files))
      mismatches.push({
        relPath,
        kind: 'unexpected',
        expected: null,
        actual: actual.files[relPath],
      });
  mismatches.sort((left, right) => compareStrings(left.relPath, right.relPath));
  return { ok: mismatches.length === 0, mismatches };
}

async function listFixtureFiles(
  directory: string,
  prefix: readonly string[] = [],
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const segments = [...prefix, entry.name];
    const relPath = segments.join('/');
    if (entry.isDirectory())
      files.push(
        ...(await listFixtureFiles(join(directory, entry.name), segments)),
      );
    else if (entry.isFile()) {
      if (relPath !== MANIFEST_FILE_NAME) files.push(relPath);
    } else throw new Error(`unsupported fixture entry: ${relPath}`);
  }
  return files.sort();
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
