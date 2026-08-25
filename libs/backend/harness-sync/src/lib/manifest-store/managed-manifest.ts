/**
 * The one managed-manifest format, and the only thing that can say "Ptah owns
 * this path".
 *
 * Two things this replaces, and why the replacement is shaped the way it is:
 *
 * - **Two formats became one.** `SkillJunctionService` wrote
 *   `{filename: {source, size, mtimeMs}}` into `.claude/commands/`, while the
 *   rival-CLI installers wrote `{skills: [], commands: []}` into each target
 *   dir. Neither could describe the other's entries, so the two fan-outs could
 *   not share ownership reasoning. One `{relPath: {hash, source, kind}}` map
 *   describes every artifact of every kind for one target.
 *
 * - **The manifest left the target directory.** It now lives at
 *   `{ws}/.ptah/harness/<target>.manifest.json`, NOT inside `.claude/commands/`.
 *   A foreign tool reading `.claude/commands/*` used to see Ptah's bookkeeping
 *   file as a slash command, and `.claude/skills/` had nowhere to put one at
 *   all. Keeping manifests in `.ptah/harness/` also means a target directory
 *   can be deleted wholesale by a user without destroying the ownership record
 *   that lets the next reconcile restore it.
 *
 * Writes are atomic (temp + rename) AND retried, because a manifest torn by a
 * crash reads as corrupt and a manifest that never landed reads as absent —
 * and both mean every Ptah-written file in the workspace becomes "foreign" and
 * freezes. `save` therefore reports whether it succeeded instead of logging and
 * returning void; see its doc comment.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import type { HarnessEntryKind, HarnessTargetId } from '@ptah-extension/shared';
import { atomicWriteWithRetry } from '../fs/atomic-write';

/** Directory holding every per-target manifest plus the workspace lock. */
export const HARNESS_STATE_DIR = join('.ptah', 'harness');

export const MANAGED_MANIFEST_VERSION = 1;

const ManagedEntrySchema = z.object({
  /** Content hash of what Ptah wrote, at the moment it wrote it. */
  hash: z.string().min(1),
  /**
   * Hash of the SOURCE the entry was derived from, when it differs from
   * {@link hash}.
   *
   * The Claude target copies bytes, so the two are equal and this is omitted.
   * A rival target transforms markdown on the way out (`skill-transform.ts`),
   * so its copy never hashes equal to its source — and both numbers are needed
   * to tell the two kinds of drift apart:
   *
   * - `sourceHash` differs from the desired hash → the SOURCE changed, rewrite.
   * - `hash` differs from what is on disk → someone hand-edited the COPY,
   *   rewrite and report it (E10).
   *
   * Optional so manifests written by Batch 1 keep parsing.
   */
  sourceHash: z.string().optional(),
  /** Absolute source path the entry was derived from. Diagnostic only. */
  source: z.string(),
  kind: z.enum(['skill', 'command', 'agent', 'mcp']),
});

export const ManagedManifestSchema = z.object({
  version: z.literal(MANAGED_MANIFEST_VERSION),
  owner: z.literal('ptah'),
  target: z.string().min(1),
  /** Workspace-relative POSIX path -> ownership record. */
  entries: z.record(z.string(), ManagedEntrySchema),
});

export type ManagedEntry = z.infer<typeof ManagedEntrySchema>;
export type ManagedManifest = z.infer<typeof ManagedManifestSchema>;
export type ManagedEntries = Record<string, ManagedEntry>;

export function emptyManifest(target: HarnessTargetId): ManagedManifest {
  return {
    version: MANAGED_MANIFEST_VERSION,
    owner: 'ptah',
    target,
    entries: {},
  };
}

/** Build an ownership record. Narrow helper so callers cannot forget a field. */
export function managedEntry(
  hash: string,
  source: string,
  kind: HarnessEntryKind,
  sourceHash?: string,
): ManagedEntry {
  return {
    hash,
    source,
    kind,
    ...(sourceHash === undefined || sourceHash === hash ? {} : { sourceHash }),
  };
}

/**
 * The hash to compare against the DESIRED hash for this entry.
 *
 * Falls back to `hash` for byte-copy targets and for Batch 1 manifests written
 * before `sourceHash` existed.
 */
export function entrySourceHash(entry: ManagedEntry): string {
  return entry.sourceHash ?? entry.hash;
}

/** Reads and writes `{ws}/.ptah/harness/<target>.manifest.json`. */
export class ManagedManifestStore {
  constructor(
    private readonly warn: (message: string, detail?: unknown) => void = () =>
      undefined,
  ) {}

  manifestPath(workspaceRoot: string, target: HarnessTargetId): string {
    return join(workspaceRoot, HARNESS_STATE_DIR, `${target}.manifest.json`);
  }

  /**
   * The same path as {@link manifestPath}, workspace-relative and POSIX.
   *
   * Health reports address everything by workspace-relative path, and a failed
   * manifest write is reported there like any other write failure — so the two
   * spellings of this path have to come from one place.
   */
  manifestRelPath(target: HarnessTargetId): string {
    return `${HARNESS_STATE_DIR.split(/[\\/]/).join('/')}/${target}.manifest.json`;
  }

  /**
   * Load the manifest for a target.
   *
   * A missing file is the normal first-run state and returns an empty manifest
   * silently. A file that exists but does not parse is logged and ALSO returns
   * empty — which deliberately re-classifies every previously-owned path as
   * foreign. That is the safe direction: the reconciler will refuse to touch
   * files it can no longer prove it wrote, instead of overwriting user work on
   * the strength of a damaged record.
   */
  load(workspaceRoot: string, target: HarnessTargetId): ManagedManifest {
    const path = this.manifestPath(workspaceRoot, target);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch {
      return emptyManifest(target);
    }

    try {
      const parsed = ManagedManifestSchema.parse(JSON.parse(raw));
      return { ...parsed, target };
    } catch (error: unknown) {
      this.warn(
        '[harness-sync] Managed manifest unreadable, treating as empty',
        {
          path,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return emptyManifest(target);
    }
  }

  /**
   * Atomic, retried write: temp file in the same directory, then rename over
   * the target (`fs/atomic-write.ts`).
   *
   * @returns `false` when the manifest did not land. The caller MUST NOT report
   *   a clean pass on `false`: the copies were written but nothing records that
   *   Ptah owns them, so the next pass reads an empty (or stale) manifest and
   *   classifies its own files as foreign. That failure used to be a log line
   *   nobody saw — the reconciler now surfaces it in `writeFailed`, which makes
   *   the badge and `ptah harness doctor` say so out loud.
   */
  save(
    workspaceRoot: string,
    target: HarnessTargetId,
    entries: ManagedEntries,
  ): boolean {
    const path = this.manifestPath(workspaceRoot, target);
    const manifest: ManagedManifest = {
      version: MANAGED_MANIFEST_VERSION,
      owner: 'ptah',
      target,
      entries: sortEntries(entries),
    };

    try {
      atomicWriteWithRetry(path, `${JSON.stringify(manifest, null, 2)}\n`);
      return true;
    } catch (error: unknown) {
      this.warn('[harness-sync] Failed to persist managed manifest', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/** Deterministic key order so a no-op reconcile produces a byte-identical file. */
function sortEntries(entries: ManagedEntries): ManagedEntries {
  const sorted: ManagedEntries = {};
  for (const key of Object.keys(entries).sort()) {
    sorted[key] = entries[key];
  }
  return sorted;
}
