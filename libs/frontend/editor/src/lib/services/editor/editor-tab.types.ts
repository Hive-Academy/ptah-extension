import type {
  DiffSideRef,
  GitApplyHunksOperation,
  GitApplyHunksResult,
  GitDiffComparison,
  GitDiffFileResult,
  GitHunkRef,
} from '@ptah-extension/shared';

/**
 * Which two sides a diff tab compares. Mirrors the two Source Control rows —
 * `staged` is HEAD ↔ index, `worktree` is index ↔ working tree.
 *
 * Aliased to the shared RPC type rather than redeclared so the tab record and
 * the `git:diffFile` wire contract can never drift apart.
 */
export type DiffComparison = GitDiffComparison;

export type { DiffSideRef };

/**
 * Freshness of a diff tab's content relative to the repository.
 *
 * - `fresh`      — content matches the last successful `git:diffFile` read
 * - `refreshing` — a revalidation is in flight; previous content still shown
 * - `stale`      — the last revalidation could not reach the backend at all
 * - `error`      — the backend answered but at least one side could not be read
 *
 * `refreshing`, `stale` and `error` all retain the previously-rendered content
 * (A1 AC6/AC7): a diff tab never flickers to empty and never silently shows a
 * failed read as an empty file.
 */
export type DiffTabStatus = 'fresh' | 'refreshing' | 'stale' | 'error';

/**
 * Everything that identifies and describes an open diff tab.
 *
 * Presence of this record on an {@link EditorTab} is the discriminant for
 * "this tab is a diff" — there is no `isDiff` boolean and no string parsing of
 * `filePath` anywhere. The typed descriptor exists precisely so the tab key
 * never has to be decoded.
 */
export interface DiffTabState {
  comparison: DiffComparison;
  /** Workspace-relative path, modified side. */
  path: string;
  /**
   * Workspace-relative path, original side. Differs from {@link path} only for
   * staged renames, where the original side lives at the pre-rename path
   * (A2 AC6 / N3).
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
   * `GitDiffFileResult.patch` is DELIBERATELY not mirrored onto this record.
   * Holding patch bytes across a state change is precisely the staleness hazard
   * the always-regenerate backend design removes (batch-8a-report.md §7.2): a
   * cached patch is the one thing that could make the server's offset guards
   * reachable again. The ordinals are safe to hold because they are meaningless
   * without {@link snapshotToken}, and every consumer is required to pair them.
   *
   * Empty for a binary file, an untracked file, and any failed read — which is
   * what makes "hunk actions absent, not present-and-broken" (D2 AC10) fall out
   * of the data rather than out of a special case.
   */
  hunks: GitHunkRef[];
  /** True when either side is binary — suppresses textual diff rendering. */
  isBinary: boolean;
  status: DiffTabStatus;
  /** Sanitized, user-facing copy from the frontend string table (A3 AC4). */
  errorMessage?: string;
  /** Short backend-supplied detail. Already sanitized; never raw stderr. */
  errorDetail?: string;
  /** Stale-response protection, mirrors loadFileTree's requestId pattern. */
  requestId: number;
}

/** Represents an open editor tab */
export interface EditorTab {
  filePath: string;
  fileName: string;
  /**
   * The editable text for a file tab; the MODIFIED side for a diff tab. Keeping
   * this role means `switchTab`/`closeTab` need no diff-awareness at all.
   */
  content: string;
  isDirty: boolean;
  /** Present iff this tab is a diff view. Presence is the discriminant. */
  diff?: DiffTabState;
}

/**
 * THE diff-tab key scheme. Defined here, in one place, and never re-derived
 * or parsed anywhere else in the codebase.
 *
 *   diff:<comparison>:<workspace-relative path>
 *
 * Collision-safe against real file tabs, which are keyed by ABSOLUTE paths.
 * Including the comparison is what lets the same file be open simultaneously
 * as a staged diff and a working-tree diff (A2 AC3).
 */
export function diffTabKey(
  comparison: DiffComparison,
  relativePath: string,
): string {
  return `diff:${comparison}:${normalizeDiffPath(relativePath)}`;
}

/** Normalize a workspace-relative path to the POSIX form used in diff keys. */
export function normalizeDiffPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/** Human label for a comparison, used in tab titles and the diff header. */
export function diffComparisonLabel(comparison: DiffComparison): string {
  return comparison === 'staged' ? 'staged' : 'working tree';
}

/**
 * Tab title for a diff tab, derived once at creation (A2 AC4 — the comparison
 * must be readable without hovering).
 *
 *   modified side absent -> `foo.ts (deleted, staged)`
 *   original side absent -> `foo.ts (new)` / `foo.ts (new, staged)`
 *   otherwise            -> `foo.ts (staged)` / `foo.ts (working tree)`
 *
 * An untracked file exists only in the working-tree row, so `(new)` alone is
 * unambiguous there; a staged addition keeps its comparison suffix because the
 * same path can also appear as a working-tree row.
 */
export function diffTabLabel(
  fileName: string,
  comparison: DiffComparison,
  originalRef: DiffSideRef,
  modifiedRef: DiffSideRef,
): string {
  const where = diffComparisonLabel(comparison);
  if (modifiedRef.kind === 'absent') return `${fileName} (deleted, ${where})`;
  if (originalRef.kind === 'absent') {
    return comparison === 'staged'
      ? `${fileName} (new, staged)`
      : `${fileName} (new)`;
  }
  return `${fileName} (${where})`;
}

/**
 * A request to open (or re-open) a diff tab.
 *
 * The comparison is part of the request because the two Source Control rows
 * mean genuinely different things: *Staged Changes* compares HEAD to the index,
 * *Changes* compares the index to the working tree. Before A2 both rows emitted
 * the same bare path and therefore produced the same diff.
 *
 * Declared here rather than in the service so presentational components can
 * emit it without importing anything from the editor coordinator.
 */
export interface OpenDiffRequest {
  /** Workspace-relative path of the modified side. */
  path: string;
  comparison: DiffComparison;
  /** Pre-rename source path for a staged rename (N3). */
  origPath?: string;
}

/** Re-export so consumers of a diff tab need only one import site. */
export type {
  GitApplyHunksOperation,
  GitApplyHunksResult,
  GitDiffFileResult,
  GitHunkRef,
};

/**
 * A hunk operation the diff view asks the editor coordinator to perform.
 *
 * `snapshotToken` is carried EXPLICITLY rather than re-read from the tab record
 * at the point of application. It is the token the user's selection was made
 * against, and the coordinator refuses the request when the tab record has
 * moved on — see `EditorDiffSplitHelper.applyHunks`. Without it, a
 * revalidation landing between the click and the RPC would re-point the same
 * ordinal at a different diff, and the backend could not tell: its own AC6
 * check only asks whether the repository moved since the token it was handed
 * was issued, and that token would be a perfectly fresh one.
 */
export interface HunkApplyRequest {
  /** The diff tab key the selection belongs to. */
  key: string;
  operation: GitApplyHunksOperation;
  /** Ordinals into the `hunks` array of the snapshot named by `snapshotToken`. */
  hunkIndices: number[];
  /** The token of the diff the user was looking at when they selected. */
  snapshotToken: string;
}

/**
 * How the diff view performs a hunk operation.
 *
 * Supplied to {@link DiffViewComponent} as an input rather than injected, so
 * the view keeps no dependency on the editor coordinator and a consumer that
 * reuses the Monaco diff surface for two in-memory bodies (the Skills library's
 * enhancement preview) gets no git actions at all simply by not supplying one.
 */
export type HunkApplyFn = (
  request: HunkApplyRequest,
) => Promise<GitApplyHunksResult>;
