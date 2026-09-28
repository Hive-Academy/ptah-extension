/**
 * Bounded, identity-checked reading of one root manifest for the resolver
 * context (TASK_2026_559 implementation-plan-languages.md, "Bounds":
 * manifests; Batch 32b review r1 R32B-03, R32B-04, R32B-06).
 *
 * The file is opened once, and everything is decided on that handle: its
 * identity (device and inode) must be the one the pre-open lookup saw, and
 * after the open the path must still resolve to the same real path inside
 * the root. The read is bounded by the per-file limit and the build's
 * remaining byte budget (plus one sentinel byte that detects a file larger
 * than the bound), and every byte read is charged to the budget, whether the
 * content is then accepted or not. The build's generation is re-checked
 * after every await, so a superseded build starts no further I/O.
 */
import * as fs from 'fs';
import type { ResolverContextGap } from './resolver-context';

/** Plan "Bounds": manifests. */
export const MANIFEST_LIMITS = {
  /** Most manifest files one build reads. */
  maxFiles: 64,
  /** Largest manifest read, in bytes. */
  maxFileBytes: 256 * 1024,
  /** Most manifest bytes one build reads in total. */
  maxTotalBytes: 2 * 1024 * 1024,
} as const;

/** The identity and shape of a file, as a lookup or an open handle sees it. */
export interface ManifestStat {
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
  isFile(): boolean;
}

/** An open manifest. */
export interface ManifestHandle {
  stat(): Promise<ManifestStat>;
  /** Reads into `buffer` from `offset`, at most `length` bytes, at `position`. */
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** The file-system calls manifest reading makes (injected by tests). */
export interface ManifestFileSystem {
  readdir(dir: string): Promise<string[]>;
  realpath(filePath: string): Promise<string>;
  stat(filePath: string): Promise<ManifestStat>;
  open(filePath: string): Promise<ManifestHandle>;
}

export const NODE_MANIFEST_FILE_SYSTEM: ManifestFileSystem = {
  readdir: (dir) => fs.promises.readdir(dir),
  realpath: (filePath) => fs.promises.realpath(filePath),
  stat: (filePath) => fs.promises.stat(filePath),
  open: (filePath) => fs.promises.open(filePath, 'r'),
};

/** What reading one manifest produced, and what it cost. */
export type ManifestRead =
  | { readonly kind: 'text'; readonly text: string; readonly bytesRead: number }
  | {
      readonly kind: 'gap';
      readonly gap: ResolverContextGap;
      readonly bytesRead: number;
    }
  | { readonly kind: 'skipped'; readonly bytesRead: 0 }
  /** The build was superseded; nothing more is read. */
  | { readonly kind: 'superseded'; readonly bytesRead: number };

export interface ManifestReadRequest {
  readonly fileSystem: ManifestFileSystem;
  /** The manifest's path under the root (forward slashes). */
  readonly filePath: string;
  /** The root's real path (forward slashes). */
  readonly realRoot: string;
  /** Bytes the build may still read. */
  readonly remainingBytes: number;
  readonly isCurrent: () => boolean;
}

const CASE_INSENSITIVE_PATHS = process.platform === 'win32';

const SUPERSEDED = (bytesRead: number): ManifestRead => ({
  kind: 'superseded',
  bytesRead,
});

/** Read one manifest within the bounds (see the module comment). */
export async function readManifest(
  request: ManifestReadRequest,
): Promise<ManifestRead> {
  let outcome: ManifestRead;
  try {
    outcome = await lookUpAndRead(request);
  } catch {
    // A manifest that cannot be looked up, opened or read is the
    // `manifest-unreadable` gap (context `partial`).
    outcome = { kind: 'gap', gap: 'manifest-unreadable', bytesRead: 0 };
  }
  return !request.isCurrent() && outcome.kind !== 'superseded'
    ? SUPERSEDED(outcome.bytesRead)
    : outcome;
}

async function lookUpAndRead(
  request: ManifestReadRequest,
): Promise<ManifestRead> {
  const { fileSystem, filePath, realRoot, isCurrent } = request;
  const realFile = toForwardSlashes(await fileSystem.realpath(filePath));
  if (!isCurrent()) return SUPERSEDED(0);
  if (!isInside(realFile, realRoot)) {
    return { kind: 'gap', gap: 'manifest-outside-root', bytesRead: 0 };
  }
  const looked = await fileSystem.stat(realFile);
  if (!isCurrent()) return SUPERSEDED(0);
  if (!looked.isFile()) return { kind: 'skipped', bytesRead: 0 };
  const sizeGap = limitGap(looked.size, request.remainingBytes);
  if (sizeGap !== undefined) return { kind: 'gap', gap: sizeGap, bytesRead: 0 };

  const handle = await fileSystem.open(realFile);
  try {
    if (!isCurrent()) return SUPERSEDED(0);
    const opened = await handle.stat();
    if (!isCurrent()) return SUPERSEDED(0);
    // The handle must be the file the lookup saw, and the path must still
    // lead there, inside the root (no swapped file, directory or link).
    const again = toForwardSlashes(await fileSystem.realpath(filePath));
    if (!isCurrent()) return SUPERSEDED(0);
    if (
      !opened.isFile() ||
      opened.dev !== looked.dev ||
      opened.ino !== looked.ino ||
      !samePath(again, realFile) ||
      !isInside(again, realRoot)
    ) {
      return { kind: 'gap', gap: 'manifest-changed', bytesRead: 0 };
    }
    return await boundedRead(handle, request);
  } finally {
    await handle.close();
  }
}

/**
 * Read at most `min(maxFileBytes, remainingBytes)` bytes plus one sentinel
 * byte, whatever size the file now has; the bytes read are always reported.
 */
async function boundedRead(
  handle: ManifestHandle,
  request: ManifestReadRequest,
): Promise<ManifestRead> {
  const bound = Math.max(
    0,
    Math.min(MANIFEST_LIMITS.maxFileBytes, request.remainingBytes),
  );
  const buffer = new Uint8Array(bound + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.length) {
    if (!request.isCurrent()) return SUPERSEDED(bytesRead);
    const { bytesRead: chunk } = await handle.read(
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      bytesRead,
    );
    if (chunk <= 0) break;
    bytesRead += chunk;
  }
  if (bytesRead > bound) {
    const gap = limitGap(bytesRead, request.remainingBytes);
    return {
      kind: 'gap',
      gap: gap ?? 'manifests-over-total',
      bytesRead,
    };
  }
  const text = decodeText(buffer.subarray(0, bytesRead));
  return text === undefined
    ? { kind: 'gap', gap: 'manifest-not-text', bytesRead }
    : { kind: 'text', text, bytesRead };
}

function limitGap(
  size: number,
  remainingBytes: number,
): ResolverContextGap | undefined {
  if (size > MANIFEST_LIMITS.maxFileBytes) return 'manifest-too-large';
  if (size > remainingBytes) return 'manifests-over-total';
  return undefined;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** UTF-8 text without a BOM, or `undefined` for binary or invalid bytes. */
function decodeText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  let text: string | undefined;
  try {
    text = UTF8.decode(bytes);
  } catch {
    // Invalid UTF-8: the caller's `manifest-not-text` gap.
    text = undefined;
  }
  return text?.startsWith('﻿') ? text.slice(1) : text;
}

function fold(value: string): string {
  return CASE_INSENSITIVE_PATHS ? value.toLowerCase() : value;
}

function samePath(a: string, b: string): boolean {
  return fold(a) === fold(b);
}

/** Whether `filePath` lies strictly under `dir` (both forward slashes). */
export function isInside(filePath: string, dir: string): boolean {
  const parent = fold(dir);
  return fold(filePath).startsWith(
    parent.endsWith('/') ? parent : `${parent}/`,
  );
}

export function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}
