import * as fs from 'fs/promises';

/** Suffix of a transcript file that a `session:delete` has staged for removal. */
export const STAGED_TRANSCRIPT_SUFFIX = '.ptah-deleting';

/** One transcript file moved aside by {@link stageTranscripts}. */
export interface StagedTranscript {
  readonly original: string;
  readonly staged: string;
}

/** Node fs errors can come from another realm, so check the code, not the class. */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/**
 * Move each transcript aside so that the delete can be undone. A file that is
 * already gone is skipped. When a rename fails, the files already moved are
 * put back and the error is thrown, so nothing is lost.
 */
export async function stageTranscripts(
  files: readonly string[],
): Promise<StagedTranscript[]> {
  const staged: StagedTranscript[] = [];
  for (const original of files) {
    const entry = { original, staged: original + STAGED_TRANSCRIPT_SUFFIX };
    try {
      await fs.rename(entry.original, entry.staged);
      staged.push(entry);
    } catch (error: unknown) {
      if (isMissingFile(error)) continue;
      await restoreTranscripts(staged);
      throw error;
    }
  }
  return staged;
}

/**
 * Put staged transcripts back. Every file is tried; the first failure is
 * thrown after the others were restored.
 */
export async function restoreTranscripts(
  staged: readonly StagedTranscript[],
): Promise<void> {
  let firstError: unknown;
  for (const entry of staged) {
    try {
      await fs.rename(entry.staged, entry.original);
    } catch (error: unknown) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

/**
 * Remove staged transcripts for good. Returns the staged paths that could not
 * be removed; their content is out of the session's view but still on disk.
 */
export async function finalizeTranscripts(
  staged: readonly StagedTranscript[],
): Promise<string[]> {
  const leftovers: string[] = [];
  for (const entry of staged) {
    try {
      await fs.unlink(entry.staged);
    } catch (error: unknown) {
      if (!isMissingFile(error)) leftovers.push(entry.staged);
    }
  }
  return leftovers;
}
