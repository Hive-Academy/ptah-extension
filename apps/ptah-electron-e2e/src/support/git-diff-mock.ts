import type {
  DiffSideRef,
  GitDiffComparison,
  GitDiffFileResult,
  GitHunkRef,
} from '@ptah-extension/shared';

/**
 * A contract-typed builder for mocked `git:diffFile` replies.
 *
 * WHY THIS EXISTS (TASK_2026_231, and the repeat found right after it).
 *
 * Two specs hand-wrote their `git:diffFile` mock as an inline object literal.
 * `patch` and `hunks` are REQUIRED fields of `GitDiffFileResult`, so a real
 * backend always sends them and only a hand-written mock can leave them out —
 * and both hand-written mocks did, because they were written before the hunk
 * work added those fields and no type ever checked them again.
 * `EditorDiffSplitHelper.toDiffState` copies `result.hunks` straight through
 * (`editor-diff-split.ts:647`), so the tab record ends up with `hunks:
 * undefined`, and `DiffViewComponent.hunkActionsAvailable`
 * (`diff-view.component.ts:961`) then reads `.length` off it. That read is
 * DELIBERATELY unguarded: `hunks` is contract-required, and a guard there would
 * only hide the next mock that drifts.
 *
 * The fix is therefore on this side of the wire. The return type is
 * `GitDiffFileResult` itself, so `nx run ptah-electron-e2e:typecheck` fails the
 * day another required field is added and this builder does not supply it —
 * which is the whole point of routing the mock through a function rather than
 * writing a third object literal.
 *
 * The `patch` and `hunks` are DERIVED from the two content strings rather than
 * hard-coded, so they cannot drift away from the text they describe the way the
 * literals drifted away from the interface.
 */

/** Unified-diff context lines either side of a change, as git emits by default. */
const DIFF_CONTEXT = 3;

export interface GitDiffMockOptions {
  /** Repo-relative path, e.g. `src/big-file.ts`. */
  path: string;
  /** Defaults to {@link path} (no rename). */
  originalPath?: string;
  comparison: GitDiffComparison;
  /** Full text of the original side. */
  original: string;
  /** Full text of the modified side. */
  modified: string;
  /** Defaults to `{ kind: 'index' }` — the `M unstaged` row's original side. */
  originalRef?: DiffSideRef;
  /** Defaults to `{ kind: 'worktree' }`. */
  modifiedRef?: DiffSideRef;
  /**
   * MUST be non-empty. An empty token means "the backend never reached a real
   * repository read", and `toDiffState` then drops the hunks and marks the diff
   * `error` — which would make the mock describe a failure rather than a diff.
   */
  snapshotToken: string;
}

/**
 * Build a `git:diffFile` reply for a single contiguous, same-line-count edit.
 *
 * That is the only shape the mocking specs need, and it is the only shape this
 * derivation is honest about: it locates the first and last differing lines and
 * emits ONE hunk spanning them plus {@link DIFF_CONTEXT} lines either side,
 * exactly as git does for a replacement block. Specs that need multi-hunk or
 * length-changing diffs use the real scratch repo (`git-scratch-repo.ts`)
 * instead of a mock, so widening this would be inventing a case nobody has.
 */
export function gitDiffFileMock(
  options: GitDiffMockOptions,
): GitDiffFileResult {
  const originalPath = options.originalPath ?? options.path;
  const originalLines = options.original.split('\n');
  const modifiedLines = options.modified.split('\n');

  if (originalLines.length !== modifiedLines.length) {
    throw new Error(
      'gitDiffFileMock: the two sides must have the same line count — ' +
        `got ${originalLines.length} vs ${modifiedLines.length}. Use the real ` +
        'scratch repo for diffs that add or remove lines.',
    );
  }
  if (options.snapshotToken === '') {
    throw new Error(
      'gitDiffFileMock: snapshotToken must be non-empty, or the client treats ' +
        'the reply as an unvalidated read and drops the hunks.',
    );
  }

  const { patch, hunks } = derivePatch(
    options.path,
    originalLines,
    modifiedLines,
  );

  return {
    path: options.path,
    originalPath,
    comparison: options.comparison,
    original: { outcome: 'content', content: options.original },
    modified: { outcome: 'content', content: options.modified },
    originalRef: options.originalRef ?? { kind: 'index' },
    modifiedRef: options.modifiedRef ?? { kind: 'worktree' },
    patch,
    hunks,
    snapshotToken: options.snapshotToken,
  };
}

function derivePatch(
  path: string,
  originalLines: readonly string[],
  modifiedLines: readonly string[],
): { patch: string | null; hunks: GitHunkRef[] } {
  let first = 0;
  while (
    first < originalLines.length &&
    originalLines[first] === modifiedLines[first]
  ) {
    first++;
  }
  // Identical sides: git produces no patch at all, and `patch: null` is the
  // contract's own way of saying so.
  if (first === originalLines.length) return { patch: null, hunks: [] };

  let last = originalLines.length - 1;
  while (last > first && originalLines[last] === modifiedLines[last]) last--;

  // 1-based, git's own numbering.
  const start = Math.max(1, first + 1 - DIFF_CONTEXT);
  const end = Math.min(originalLines.length, last + 1 + DIFF_CONTEXT);
  const span = end - start + 1;
  const header = `@@ -${start},${span} +${start},${span} @@`;

  const body: string[] = [];
  for (let l = start; l <= first; l++) body.push(` ${originalLines[l - 1]}`);
  for (let l = first + 1; l <= last + 1; l++) {
    body.push(`-${originalLines[l - 1]}`);
  }
  for (let l = first + 1; l <= last + 1; l++) {
    body.push(`+${modifiedLines[l - 1]}`);
  }
  for (let l = last + 2; l <= end; l++) body.push(` ${originalLines[l - 1]}`);

  return {
    patch:
      [
        `diff --git a/${path} b/${path}`,
        'index 1111111..2222222 100644',
        `--- a/${path}`,
        `+++ b/${path}`,
        header,
        ...body,
      ].join('\n') + '\n',
    hunks: [
      {
        index: 0,
        originalStart: start,
        originalLines: span,
        modifiedStart: start,
        modifiedLines: span,
        header,
      },
    ],
  };
}
