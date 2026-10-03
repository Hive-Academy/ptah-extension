import type { GitHunkRef } from '@ptah-extension/shared';

/**
 * Pure hunk-index mapping between git's `@@` blocks and the hunks
 * `@pierre/diffs` parsed from the same patch.
 *
 * Kept free of any runtime import of `@pierre/diffs` so it can be exercised
 * against real `git diff` output without loading the renderer (the package is
 * ESM-only and lazy-loaded in the app).
 *
 * Contract (implementation-plan Component 17): Pierre hunk `i` IS git hunk `i`
 * because both parsers keep `@@` order. That is verified, never assumed: the
 * counts and every start/count pair must agree, otherwise the file is shown
 * read-only. Pierre silently "repairs" a hunk whose declared line counts do
 * not match its body (`parsePatchFiles.ts`, count-mismatch branch), so a
 * start/count disagreement is exactly the signal that the two views of the
 * patch have diverged.
 */

/** The subset of Pierre's `Hunk` the mapping reads. */
export interface PierreHunkPosition {
  readonly additionStart: number;
  readonly additionCount: number;
  readonly deletionStart: number;
  readonly deletionCount: number;
}

export type PierreHunkMappingErrorReason =
  | 'parse-failed'
  | 'file-count'
  | 'hunk-count'
  | 'hunk-position'
  | 'duplicate-anchor'
  | 'slot-missing';

export interface PierreHunkMappingError {
  readonly reason: PierreHunkMappingErrorReason;
  /** Developer-facing detail; never shown verbatim to the user. */
  readonly detail: string;
}

/** Where a hunk's toolbar is anchored when no separator slot exists. */
export interface PierreHunkAnchor {
  readonly side: 'additions' | 'deletions';
  readonly lineNumber: number;
}

/** One light-DOM toolbar host: the git hunk ordinal and the slot it fills. */
export interface PierreHunkHost {
  readonly index: number;
  readonly slotName: string;
}

/**
 * Verify that Pierre's parse of a patch lines up one-to-one with git's hunk
 * refs for the same bytes. Returns `null` when every hunk agrees.
 */
export function verifyHunkMapping(
  pierreHunks: readonly PierreHunkPosition[],
  gitHunks: readonly GitHunkRef[],
): PierreHunkMappingError | null {
  if (pierreHunks.length !== gitHunks.length) {
    return {
      reason: 'hunk-count',
      detail: `renderer parsed ${pierreHunks.length} hunks, git reported ${gitHunks.length}`,
    };
  }
  for (let i = 0; i < gitHunks.length; i++) {
    const git = gitHunks[i];
    const pierre = pierreHunks[i];
    if (
      git.index !== i ||
      pierre.additionStart !== git.modifiedStart ||
      pierre.additionCount !== git.modifiedLines ||
      pierre.deletionStart !== git.originalStart ||
      pierre.deletionCount !== git.originalLines
    ) {
      return {
        reason: 'hunk-position',
        detail:
          `hunk ${i}: git ${git.header} vs renderer ` +
          `-${pierre.deletionStart},${pierre.deletionCount} ` +
          `+${pierre.additionStart},${pierre.additionCount}`,
      };
    }
  }
  return null;
}

/**
 * The line a hunk's toolbar annotation hangs from: the first line of the hunk
 * on the modified side, or on the original side for a pure deletion (git's
 * `+c,0` names the line BEFORE the hunk, which is not rendered as part of it).
 */
export function hunkAnchor(hunk: GitHunkRef): PierreHunkAnchor {
  return hunk.modifiedLines > 0
    ? { side: 'additions', lineNumber: hunk.modifiedStart }
    : { side: 'deletions', lineNumber: hunk.originalStart };
}

/**
 * Pick exactly one slot per hunk from what the renderer actually rendered.
 *
 * - `separatorSlotNames(i)`: the separator slot names hunk `i` could own for
 *   the current layout, in preference order.
 * - `annotationSlotName(i)`: the annotation slot registered for hunk `i`.
 * - `renderedSlots`: every `<slot name>` present in the renderer's shadow tree.
 *
 * A hunk takes its separator slot when one was rendered, otherwise its
 * annotation slot. When neither exists the hunk has nowhere to host controls
 * and the whole file falls back to read-only rather than guess.
 */
export function resolveHunkHosts(
  hunkCount: number,
  separatorSlotNames: (index: number) => readonly string[],
  annotationSlotName: (index: number) => string,
  renderedSlots: ReadonlySet<string>,
):
  | { readonly hosts: readonly PierreHunkHost[]; readonly error: null }
  | { readonly hosts: readonly []; readonly error: PierreHunkMappingError } {
  const hosts: PierreHunkHost[] = [];
  const used = new Set<string>();
  for (let index = 0; index < hunkCount; index++) {
    const slotName =
      separatorSlotNames(index).find((name) => renderedSlots.has(name)) ??
      (renderedSlots.has(annotationSlotName(index))
        ? annotationSlotName(index)
        : null);
    if (slotName === null) {
      return {
        hosts: [],
        error: {
          reason: 'slot-missing',
          detail: `hunk ${index}: no rendered slot to host its controls`,
        },
      };
    }
    if (used.has(slotName)) {
      return {
        hosts: [],
        error: {
          reason: 'duplicate-anchor',
          detail: `hunk ${index}: slot ${slotName} already hosts another hunk`,
        },
      };
    }
    used.add(slotName);
    hosts.push({ index, slotName });
  }
  return { hosts, error: null };
}
