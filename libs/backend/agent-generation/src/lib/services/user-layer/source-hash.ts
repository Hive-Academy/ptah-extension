import { createHash } from 'crypto';
import {
  readFile,
  writeFile,
  readdir,
  stat,
  rename,
  mkdir,
  unlink,
} from 'fs/promises';
import { join, relative, dirname } from 'path';
import type { OriginSidecar } from './origin-sidecar.types';
import {
  DEFAULT_HISTORY_DIR,
  ORIGIN_SIDECAR_FILENAME,
} from './origin-sidecar.types';

const MAX_HASH_RECURSION_DEPTH = 20;

export interface CollectFilesResult {
  truncatedAtDepth: boolean;
}

function normalizeCrlf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

async function hashFile(filePath: string): Promise<string> {
  const raw = await readFile(filePath, 'utf8');
  return sha256Hex(normalizeCrlf(raw));
}

async function collectFiles(
  rootDir: string,
  currentDir: string,
  depth: number,
  out: Map<string, string>,
  signal: CollectFilesResult,
): Promise<void> {
  if (depth > MAX_HASH_RECURSION_DEPTH) {
    signal.truncatedAtDepth = true;
    return;
  }
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.name === ORIGIN_SIDECAR_FILENAME) {
      continue;
    }
    if (entry.isDirectory() && entry.name === DEFAULT_HISTORY_DIR) {
      continue;
    }
    const absPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(rootDir, absPath, depth + 1, out, signal);
    } else if (entry.isFile()) {
      const relPath = relative(rootDir, absPath).split('\\').join('/');
      out.set(relPath, await hashFile(absPath));
    }
  }
}

export async function computeSourceHash(
  rootDir: string,
  signal?: CollectFilesResult,
): Promise<string> {
  const stats = await stat(rootDir);
  if (stats.isFile()) {
    return `sha256:${await hashFile(rootDir)}`;
  }

  const fileHashes = new Map<string, string>();
  const localSignal: CollectFilesResult = signal ?? {
    truncatedAtDepth: false,
  };
  await collectFiles(rootDir, rootDir, 0, fileHashes, localSignal);

  const sortedRelPaths = Array.from(fileHashes.keys()).sort();
  const manifest: Record<string, string> = {};
  for (const relPath of sortedRelPaths) {
    manifest[relPath] = fileHashes.get(relPath) as string;
  }
  return `sha256:${sha256Hex(JSON.stringify(manifest))}`;
}

async function writeFileAtomicInternal(
  targetPath: string,
  data: string,
): Promise<void> {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(targetPath), { recursive: true });
  let renamed = false;
  try {
    await writeFile(tempPath, data, 'utf8');
    await rename(tempPath, targetPath);
    renamed = true;
  } finally {
    if (!renamed) {
      await unlink(tempPath).catch(() => undefined);
    }
  }
}

export async function writeSidecarAtomic(
  dir: string,
  sidecar: OriginSidecar,
): Promise<void> {
  const targetPath = join(dir, ORIGIN_SIDECAR_FILENAME);
  await writeFileAtomicInternal(targetPath, JSON.stringify(sidecar, null, 2));
}

export async function writeSidecarAtomicAt(
  filePath: string,
  sidecar: OriginSidecar,
): Promise<void> {
  await writeFileAtomicInternal(filePath, JSON.stringify(sidecar, null, 2));
}

export async function readSidecar(dir: string): Promise<OriginSidecar | null> {
  return readSidecarAt(join(dir, ORIGIN_SIDECAR_FILENAME));
}

export async function readSidecarAt(
  filePath: string,
): Promise<OriginSidecar | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as OriginSidecar;
  } catch (error: unknown) {
    if (isErrnoCode(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

export function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}
