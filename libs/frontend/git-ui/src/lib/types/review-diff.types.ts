import type {
  DiffSideRef,
  GitApplyHunksOperation,
  GitApplyHunksResult,
  GitDiffComparison,
  GitHunkRef,
  GitResolvedReviewRef,
} from '@ptah-extension/shared';

/**
 * Which two sides a diff compares: `staged` is HEAD ↔ index, `worktree` is
 * index ↔ working tree.
 *
 * Aliased to the shared RPC type rather than redeclared so the diff record and
 * the `git:diffFile` wire contract can never drift apart.
 */
export type DiffComparison = GitDiffComparison;

export type DiffProvenance =
  | { kind: 'mutable'; comparison: GitDiffComparison }
  | {
      kind: 'historical';
      base: GitResolvedReviewRef;
      head: GitResolvedReviewRef;
    };

/**
 * Freshness of a diff's content relative to the repository.
 *
 * - `fresh`      — content matches the last successful `git:diffFile` read
 * - `refreshing` — a revalidation is in flight; previous content still shown
 * - `stale`      — the last revalidation could not reach the backend at all
 * - `error`      — the backend answered but at least one side could not be read
 *
 * `refreshing`, `stale` and `error` all retain the previously-rendered content
 * (A1 AC6/AC7): a diff never flickers to empty and never silently shows a
 * failed read as an empty file.
 */
export type DiffTabStatus = 'fresh' | 'refreshing' | 'stale' | 'error';

/** A diff side whose content the backend read but did not ship. */
export interface DiffUnrenderable {
  side: 'original' | 'modified';
  reason: 'too-large' | 'lfs-pointer';
  /** Bytes: the blob for `too-large`, the real LFS object for `lfs-pointer`. */
  size: number;
}

/** Everything that identifies and describes one file's diff in the review canvas. */
export interface DiffTabState {
  /** Presentation origin; historical provenance can never carry mutation state. */
  provenance: DiffProvenance;
  comparison: DiffComparison;
  /** Workspace-relative path, modified side. */
  path: string;
  /**
   * Workspace-relative path, original side. Differs from {@link path} only for
   * renames, where the original side lives at the pre-rename path (A2 AC6 / N3).
   */
  originalPath: string;
  /** Original-side text. Empty string when the side is absent or binary. */
  original: string;
  /** Modified-side text. Empty string when the side is absent or binary. */
  modified: string;
  /**
   * What the original side actually resolved to. This — NOT
   * `original === ''` — is what drives the "(new file)" chrome, so a
   * genuinely-empty tracked file renders as an empty diff (A3 AC5).
   */
  originalRef: DiffSideRef;
  /** What the modified side actually resolved to. `absent` means deleted. */
  modifiedRef: DiffSideRef;
  /**
   * Backend-issued digest of exactly the bytes this diff was built from.
   *
   * Opaque to the frontend. An EMPTY token means the backend answered without
   * ever reaching a real repository read (invalid params, no workspace open,
   * rejected path) — such a response is never `fresh`.
   */
  snapshotToken: string;
  /**
   * git's own `@@` headers for this diff — POSITIONS ONLY, never hunk bodies.
   *
   * The client selects a hunk by {@link GitHunkRef.index} and sends that ordinal
   * back; the backend re-derives the patch from git and reassembles the selected
   * blocks verbatim. No diff text is ever constructed, held or replayed here.
   *
   * `GitDiffFileResult.patch` is DELIBERATELY not mirrored onto this record:
   * holding patch bytes across a state change is the staleness hazard the
   * always-regenerate backend design removes. The ordinals are safe to hold
   * because they are meaningless without {@link snapshotToken}, and every
   * consumer is required to pair them.
   *
   * Empty for a binary file, an untracked file, and any failed read — which is
   * what makes "hunk actions absent, not present-and-broken" (D2 AC10) fall out
   * of the data rather than out of a special case.
   */
  hunks: GitHunkRef[];
  /** True when either side is binary — suppresses textual diff rendering. */
  isBinary: boolean;
  /**
   * Set when a side's content was deliberately not shipped (`too-large`,
   * `lfs-pointer`), so its text is empty without being empty. A consumer that
   * sees it must label the file instead of rendering the empty text as a diff
   * (Requirement 6.10).
   */
  unrenderable?: DiffUnrenderable;
  status: DiffTabStatus;
  /** Sanitized, user-facing copy from the frontend string table (A3 AC4). */
  errorMessage?: string;
  /** Short backend-supplied detail. Already sanitized; never raw stderr. */
  errorDetail?: string;
  /** Stale-response protection, mirrors loadFileTree's requestId pattern. */
  requestId: number;
}

/** Normalize a workspace-relative path to the POSIX form used in diff keys. */
export function normalizeDiffPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/**
 * A hunk operation a diff surface asks the review diff cache to perform.
 *
 * `snapshotToken` is carried EXPLICITLY rather than re-read from the diff
 * record at the point of application. It is the token the user's selection was
 * made against, and the request is refused when the record has moved on.
 * Without it, a revalidation landing between the click and the RPC would
 * re-point the same ordinal at a different diff, and the backend could not
 * tell: its own AC6 check only asks whether the repository moved since the
 * token it was handed was issued.
 */
export interface HunkApplyRequest {
  /** The diff key the selection belongs to. */
  key: string;
  operation: GitApplyHunksOperation;
  /** Ordinals into the `hunks` array of the snapshot named by `snapshotToken`. */
  hunkIndices: number[];
  /** The token of the diff the user was looking at when they selected. */
  snapshotToken: string;
}

/** How a diff surface performs a hunk operation. */
export type HunkApplyFn = (
  request: HunkApplyRequest,
) => Promise<GitApplyHunksResult>;
