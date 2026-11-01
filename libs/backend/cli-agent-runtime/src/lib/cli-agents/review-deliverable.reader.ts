/**
 * Reads a finished review lane's deliverables for host review capture
 * (TASK_2026_857 Req 7).
 *
 * Only this run's work is read: a deliverable must exist, be non-empty and
 * not be older than the run (`writtenAfterSpawn !== false`). Its REAL path,
 * after every symlink is resolved, must sit inside one of the lane's real
 * roots, so a link inside the worktree cannot point the read outside it. One
 * bad file is skipped with a reason; it never discards the files beside it.
 *
 * The text goes to the strict review parser only. It is never logged or
 * stored, and the skip reasons are codes.
 */
import { promises as fsPromises } from 'fs';
import {
  isPathWithinRoots,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import {
  REVIEW_DELIVERABLE_MAX_CHARS,
  REVIEW_DELIVERABLE_MAX_FILES,
  REVIEW_DELIVERABLE_MAX_FILE_CHARS,
} from '@ptah-extension/lane-outcomes';
import type { LaneDeliverableCheck } from '@ptah-extension/shared';

/** Why one declared review deliverable was not read. */
export type ReviewDeliverableSkip =
  'not-fresh' | 'too-large' | 'outside-root' | 'unreadable';

export interface ReviewDeliverableRead {
  /** The files read, joined by a newline; empty when none was read. */
  readonly text: string;
  readonly filesRead: number;
  /** One code per skipped deliverable, in declared order. */
  readonly skipped: readonly ReviewDeliverableSkip[];
}

export interface ReviewDeliverableReaderDeps {
  readonly fileSystem: Pick<IFileSystemProvider, 'readFile'>;
  /** `fs.promises.realpath` by default. Specs only. */
  readonly realpath?: (path: string) => Promise<string>;
}

/**
 * Reads at most {@link REVIEW_DELIVERABLE_MAX_FILES} fresh deliverables of
 * at most {@link REVIEW_DELIVERABLE_MAX_FILE_CHARS} each, contained in
 * `roots` by real path. `checks` carry absolute paths, as the completion
 * signal reports them.
 */
export async function readReviewDeliverables(
  checks: readonly LaneDeliverableCheck[],
  roots: readonly string[],
  deps: ReviewDeliverableReaderDeps,
): Promise<ReviewDeliverableRead> {
  const realpath = deps.realpath ?? fsPromises.realpath;
  const realRoots = await realRootsOf(roots, realpath);
  const texts: string[] = [];
  const skipped: ReviewDeliverableSkip[] = [];
  let length = 0;

  for (const check of checks) {
    if (texts.length >= REVIEW_DELIVERABLE_MAX_FILES) break;
    const bytes = check.bytes ?? 0;
    if (!check.exists || bytes === 0 || check.writtenAfterSpawn === false) {
      skipped.push('not-fresh');
      continue;
    }
    if (bytes > REVIEW_DELIVERABLE_MAX_FILE_CHARS) {
      skipped.push('too-large');
      continue;
    }
    const realPath = await realPathOf(check.path, realpath);
    if (realPath === null) {
      skipped.push('unreadable');
      continue;
    }
    if (!isPathWithinRoots(realPath, realRoots)) {
      skipped.push('outside-root');
      continue;
    }
    const text = await readText(deps.fileSystem, realPath);
    if (text === null) {
      skipped.push('unreadable');
      continue;
    }
    const joined = length + (texts.length > 0 ? 1 : 0) + text.length;
    // The file may have grown since the completion check measured it.
    if (
      text.length > REVIEW_DELIVERABLE_MAX_FILE_CHARS ||
      joined > REVIEW_DELIVERABLE_MAX_CHARS
    ) {
      skipped.push('too-large');
      continue;
    }
    texts.push(text);
    length = joined;
  }

  return { text: texts.join('\n'), filesRead: texts.length, skipped };
}

async function realRootsOf(
  roots: readonly string[],
  realpath: (path: string) => Promise<string>,
): Promise<string[]> {
  const resolved = await Promise.all(
    roots.map((root) => realPathOf(root, realpath)),
  );
  return resolved.filter((root): root is string => root !== null);
}

async function realPathOf(
  path: string,
  realpath: (path: string) => Promise<string>,
): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    // degradation-audit: reported - a path that cannot be resolved cannot be proven contained; the caller logs the skip code
    return null;
  }
}

async function readText(
  fileSystem: Pick<IFileSystemProvider, 'readFile'>,
  path: string,
): Promise<string | null> {
  try {
    return await fileSystem.readFile(path);
  } catch {
    // degradation-audit: reported - an unreadable review file is skipped; the caller logs the skip code
    return null;
  }
}
