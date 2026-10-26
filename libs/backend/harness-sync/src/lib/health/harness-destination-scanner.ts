/**
 * The destination scanner (TASK_2026_701, B9 part 2).
 *
 * Answers one question for a caller about to offer a replace: for each item
 * (a skill, command or agent slug), what is at the path every detected target
 * would write it to, and what is its CURRENT content digest?
 *
 * The digest is the content on disk now — `hashDir` for a directory, `hashFile`
 * for a file — never the manifest's ownership hash. A replace approved against
 * it is re-checked by `HarnessBlockedRepairService` under the workspace lock
 * (A21), and the two compare equal only through {@link probeDestination},
 * which both of them use.
 *
 * READ-ONLY AND NEVER THROWS. It writes nothing, takes no lock and runs no
 * pass. A target that cannot be detected or probed contributes nothing and is
 * logged; one failing target never hides the others.
 *
 * NO LAYOUT STRINGS OF ITS OWN (A-paths). A skill or command path comes from
 * the target's own `preflightKeys` over a one-item desired state, and an agent
 * path from `harnessAgentRelPath`, which `agent-rel-path.guard.spec.ts` pins
 * to the transformers. A target that does not carry the facet yields no path
 * and no entry.
 */

import type { Stats } from 'fs';
import { lstat, readdir } from 'fs/promises';
import { join } from 'path';
import {
  harnessAgentRelPath,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { errorCode } from '../fs/windows-retry';
import { hashDir, hashFile } from '../hash/content-hash';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import type {
  ManagedEntry,
  ManagedManifestStore,
} from '../manifest-store/managed-manifest';
import type { IHarnessTarget } from '../targets/harness-target.port';

/** The artifact families a destination can hold. */
export type HarnessDestinationKind = 'skill' | 'command' | 'agent';

/** One item a caller wants the destinations of. */
export interface HarnessDestinationItem {
  kind: HarnessDestinationKind;
  slug: string;
}

/**
 * What sits at one destination path.
 *
 * - `absent` — nothing at the path.
 * - `unowned` — something no Ptah manifest claims (or a link, which Ptah never
 *   follows).
 * - `owned-unmodified` — a manifest claims it and the content matches what
 *   Ptah wrote.
 * - `owned-edited` — a manifest claims it and the content differs: a kept
 *   local edit (D8).
 * - `unreadable` — something is there, but its content could not be read.
 */
export type HarnessDestinationState =
  'absent' | 'unowned' | 'owned-unmodified' | 'owned-edited' | 'unreadable';

/** One item on one detected target. */
export interface HarnessDestination {
  kind: HarnessDestinationKind;
  slug: string;
  target: HarnessTargetId;
  /** Workspace-relative POSIX path, as health reports and repair use it. */
  relPath: string;
  state: HarnessDestinationState;
  /** Current content digest; `null` when absent, a link, or unreadable. */
  digest: string | null;
}

/** What {@link probeDestination} saw at one absolute path. */
export interface DestinationProbe {
  presence: 'absent' | 'link' | 'present';
  /** Current content digest; `null` unless `presence` is `present` and readable. */
  digest: string | null;
}

/**
 * The current content digest at `absolute`, judged by what is on disk rather
 * than by what was expected there: a directory hashes with `hashDir`, a file
 * with `hashFile`. A link is reported but never followed.
 *
 * Shared by the scanner and the digest-checked repair so an approval digest
 * and its re-check can only differ when the content does. Never throws.
 */
export async function probeDestination(
  absolute: string,
): Promise<DestinationProbe> {
  let stat: Stats;
  try {
    stat = await lstat(absolute);
  } catch (error: unknown) {
    // Not found is "absent"; any other refusal means something is there that
    // cannot be read, which the caller must never mistake for a vacant path.
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { presence: 'absent', digest: null }
      : { presence: 'present', digest: null };
  }
  if (stat.isSymbolicLink()) return { presence: 'link', digest: null };
  if (stat.isDirectory()) {
    // `hashDir` folds an unlistable directory into the empty-tree digest, which
    // would make an unreadable directory look like an empty one. Probe the
    // listing first so it reads as unreadable instead.
    try {
      await readdir(absolute);
    } catch {
      // A directory that cannot be listed has no comparable content: reported
      // as present with no digest, which callers treat as unreadable.
      return { presence: 'present', digest: null };
    }
    return { presence: 'present', digest: await hashDir(absolute) };
  }
  return { presence: 'present', digest: await hashFile(absolute) };
}

export class HarnessDestinationScanner {
  constructor(
    private readonly logger: Logger,
    private readonly targets: readonly IHarnessTarget[],
    private readonly manifestStore: ManagedManifestStore,
  ) {}

  /**
   * One entry per item per detected target that carries the item's facet, in
   * item order then target order.
   *
   * @param harnessRoot The workspace (harness) root the targets write under.
   */
  async scan(
    harnessRoot: string,
    items: readonly HarnessDestinationItem[],
  ): Promise<HarnessDestination[]> {
    const valid = items.filter((item) => isPlainSlug(item.slug));
    if (valid.length < items.length) {
      this.logger.warn(
        '[harness-sync] Destination scan ignored slugs that are not a single path segment',
        {
          slugs: items
            .filter((item) => !isPlainSlug(item.slug))
            .map((item) => item.slug),
        },
      );
    }
    if (valid.length === 0) return [];

    const detected = await this.detectedTargets(harnessRoot);
    const owners = this.ownershipIndex(harnessRoot);

    const out: HarnessDestination[] = [];
    for (const item of valid) {
      for (const target of detected) {
        const relPath = destinationRelPath(target, item);
        if (relPath === null) continue;
        const probe = await probeDestination(toAbsolute(harnessRoot, relPath));
        out.push({
          ...item,
          target: target.id,
          relPath,
          ...classify(probe, owners.get(relPath)),
        });
      }
    }
    return out;
  }

  private async detectedTargets(
    harnessRoot: string,
  ): Promise<IHarnessTarget[]> {
    const detected: IHarnessTarget[] = [];
    for (const target of this.targets) {
      try {
        if (await target.detect(harnessRoot)) detected.push(target);
      } catch (error: unknown) {
        // Logged and skipped: one target whose detection fails must not hide
        // the destinations every other target reports.
        this.logger.warn(
          '[harness-sync] Destination scan could not detect a target; skipping it',
          {
            target: target.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    return detected;
  }

  /**
   * Every manifest entry across every target, keyed by relPath.
   *
   * Across targets rather than per target because co-owning targets (Codex and
   * Antigravity share `.agents/skills`) each count the other's manifest as
   * proof of ownership; one path is written by one of them and owned for both.
   * `load` already degrades a missing or malformed manifest to an empty one.
   */
  private ownershipIndex(
    harnessRoot: string,
  ): ReadonlyMap<string, ManagedEntry> {
    const owners = new Map<string, ManagedEntry>();
    for (const target of this.targets) {
      const manifest = this.manifestStore.load(harnessRoot, target.id);
      for (const [relPath, entry] of Object.entries(manifest.entries)) {
        if (!owners.has(relPath)) owners.set(relPath, entry);
      }
    }
    return owners;
  }
}

function classify(
  probe: DestinationProbe,
  owned: ManagedEntry | undefined,
): Pick<HarnessDestination, 'state' | 'digest'> {
  if (probe.presence === 'absent') return { state: 'absent', digest: null };
  if (probe.presence === 'link') return { state: 'unowned', digest: null };
  if (probe.digest === null) return { state: 'unreadable', digest: null };
  if (owned === undefined) return { state: 'unowned', digest: probe.digest };
  return {
    state: probe.digest === owned.hash ? 'owned-unmodified' : 'owned-edited',
    digest: probe.digest,
  };
}

/** The path `target` writes `item` to, or `null` when it carries no such facet. */
function destinationRelPath(
  target: IHarnessTarget,
  item: HarnessDestinationItem,
): string | null {
  if (item.kind === 'agent') return harnessAgentRelPath(target.id, item.slug);
  const keys = target.preflightKeys(probeState(item));
  const [first] = keys.keys();
  return first ?? null;
}

/**
 * A desired state holding only `item`, so `preflightKeys` answers with that
 * item's path alone. The source fields are never read: `preflightKeys` maps
 * slugs to paths, and skills and commands carry no transform at that step.
 */
function probeState(item: HarnessDestinationItem): HarnessDesiredState {
  const entry = { slug: item.slug, contentHash: '' };
  return {
    skills: item.kind === 'skill' ? [{ ...entry, sourceDir: '' }] : [],
    commands: item.kind === 'command' ? [{ ...entry, sourceFile: '' }] : [],
    agents: [],
    mcp: [],
    collisions: [],
    sources: 'ok',
    sourceRoots: [],
  };
}

/** A slug is one path segment: no separator, no traversal, not empty. */
function isPlainSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug !== '.' &&
    slug !== '..' &&
    !slug.includes('/') &&
    !slug.includes('\\') &&
    !slug.includes('\u0000')
  );
}

/** Workspace-relative POSIX path -> absolute path. */
function toAbsolute(harnessRoot: string, relPath: string): string {
  return join(harnessRoot, ...relPath.split('/'));
}
