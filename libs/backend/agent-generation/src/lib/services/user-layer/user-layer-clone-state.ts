/**
 * Read the edit state of ONE Library clone (TASK_2026_701, B10).
 *
 * Callers that offer to replace or overwrite something need two answers the
 * sidecar alone cannot give: has the user changed this clone since Ptah wrote
 * it, and what are its bytes right now. The second is the approval digest
 * (A21): a consumer records it when it shows the user a plan and recomputes it
 * under its own mutation lock, so an edit made after the plan is never
 * replaced.
 *
 * `edited` compares the LIVE content hash with `sidecar.sourceHash`, the hash
 * of the upstream bytes the clone was last made from. `currentContentHash` is
 * deliberately not used: it is bookkeeping a save or an enhance writes, and a
 * hand edit in an editor never updates it.
 *
 * Read-only. Never takes a slug lock: a reader that needs the digest to hold
 * still re-reads it under the lock of the write it guards.
 */
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { OriginKind, UserLayerRoots } from './origin-sidecar.types';
import {
  ORIGIN_SIDECAR_FILENAME,
  parseOriginSidecar,
} from './origin-sidecar.types';
import { computeSourceHash, isErrnoCode } from './source-hash';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

/**
 * The clone slug rule of `skills-synthesis-rpc.schema.ts` (`SlugSchema`). A
 * slug becomes a path segment, so anything else addresses no clone.
 */
const CLONE_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const CLONE_SLUG_MAX_LENGTH = 128;

export interface CloneEditState {
  /** The clone body (file, or skill directory) is on disk. */
  readonly exists: boolean;
  /**
   * The live body no longer matches the upstream bytes it was made from. Also
   * `true` when the body exists but cannot be read: refusing to treat an
   * unreadable clone as untouched is the only safe direction for a caller that
   * is about to replace it.
   */
  readonly edited: boolean;
  readonly pluginId: string | null;
  readonly sourceRef?: string;
  readonly sourceLabel?: string;
  /**
   * Live content digest of the clone body (`sha256:` form, the same hash the
   * sidecar records), or `null` when the body is absent or unreadable.
   */
  readonly contentDigest: string | null;
}

/**
 * The edit state of the clone `kind`/`slug` under `roots`, or `null` when that
 * slug has no origin sidecar — no clone at all, or a user-authored file that
 * Ptah never cloned. A malformed sidecar reads as no sidecar, as everywhere
 * else in the user layer.
 *
 * Throws only when the sidecar exists but cannot be read (permissions, I/O):
 * answering "not a clone" then would hide a Library copy from the caller.
 */
export async function readCloneEditStateIn(
  roots: UserLayerRoots,
  kind: OriginKind,
  slug: string,
): Promise<CloneEditState | null> {
  if (!isSafeCloneSlug(slug)) return null;

  const { bodyPath, sidecarPath } = clonePaths(roots, kind, slug);
  let rawSidecar: string;
  try {
    rawSidecar = await readFile(sidecarPath, 'utf8');
  } catch (error: unknown) {
    if (isErrnoCode(error, 'ENOENT')) return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSidecar);
  } catch {
    // degradation-audit: optional-capability - unparseable JSON is a malformed
    // sidecar, which the user layer reads as "no sidecar" (user-authored) by
    // rule; see `parseOriginSidecar`.
    return null;
  }
  const sidecar = parseOriginSidecar(parsed);
  if (sidecar === null || sidecar.kind !== kind) return null;

  const identity = {
    pluginId: sidecar.pluginId,
    ...(sidecar.sourceRef !== undefined ? { sourceRef: sidecar.sourceRef } : {}),
    ...(sidecar.sourceLabel !== undefined
      ? { sourceLabel: sidecar.sourceLabel }
      : {}),
  };

  let contentDigest: string;
  try {
    contentDigest = await computeSourceHash(bodyPath);
  } catch (error: unknown) {
    if (isErrnoCode(error, 'ENOENT')) {
      return { exists: false, edited: false, contentDigest: null, ...identity };
    }
    // An unreadable body is reported as edited with no digest rather than
    // thrown, so a replace plan keeps the clone; the caller re-reads under its
    // lock before any write.
    return { exists: true, edited: true, contentDigest: null, ...identity };
  }

  return {
    exists: true,
    edited: contentDigest !== sidecar.sourceHash,
    contentDigest,
    ...identity,
  };
}

function clonePaths(
  roots: UserLayerRoots,
  kind: OriginKind,
  slug: string,
): { bodyPath: string; sidecarPath: string } {
  if (kind === 'skill') {
    const cloneDir = join(roots.skills, slug);
    return {
      bodyPath: cloneDir,
      sidecarPath: join(cloneDir, ORIGIN_SIDECAR_FILENAME),
    };
  }
  const rootDir = kind === 'agent' ? roots.agents : roots.commands;
  return {
    bodyPath: join(rootDir, `${slug}.md`),
    sidecarPath: join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`),
  };
}

function isSafeCloneSlug(slug: string): boolean {
  return (
    slug.length <= CLONE_SLUG_MAX_LENGTH &&
    !slug.includes('..') &&
    CLONE_SLUG_PATTERN.test(slug)
  );
}
