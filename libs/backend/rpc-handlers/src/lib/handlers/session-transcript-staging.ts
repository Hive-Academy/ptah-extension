import * as fs from 'fs/promises';
import * as path from 'path';

/** Suffix of a transcript file that a `session:delete` has staged for removal. */
export const STAGED_TRANSCRIPT_SUFFIX = '.ptah-deleting';

/** One transcript file moved aside by {@link stageTranscripts}. */
export interface StagedTranscript {
  readonly original: string;
  readonly staged: string;
}

/** Node fs errors can come from another realm, so check the code, not the class. */
function isMissingFile(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
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
 * Undo an interrupted or half-undone delete of a session that is still
 * listed: rename back every staged transcript of the session whose original
 * name is free. A staged file whose original exists again is left alone, so
 * no content is overwritten. Returns the paths that were restored.
 *
 * Covered layouts: `{dir}/{id}.jsonl`, `{dir}/{id}/subagents/agent-*.jsonl`
 * and legacy flat `{dir}/agent-*.jsonl` (owned when `ownsFlatFile` says so).
 */
export async function recoverStagedTranscripts(
  sessionsDir: string,
  sessionId: string,
  ownsFlatFile: (stagedPath: string) => Promise<boolean>,
): Promise<string[]> {
  const candidates = [path.join(sessionsDir, `${sessionId}.jsonl`)];
  const subagentsDir = path.join(sessionsDir, sessionId, 'subagents');
  for (const name of await listStaged(subagentsDir)) {
    candidates.push(path.join(subagentsDir, unstagedName(name)));
  }
  for (const name of await listStaged(sessionsDir)) {
    if (!name.startsWith('agent-')) continue;
    const original = path.join(sessionsDir, unstagedName(name));
    if (await ownsFlatFile(original + STAGED_TRANSCRIPT_SUFFIX)) {
      candidates.push(original);
    }
  }
  const restored: string[] = [];
  for (const original of candidates) {
    if (await restoreOne(original)) restored.push(original);
  }
  return restored;
}

function unstagedName(stagedName: string): string {
  return stagedName.slice(0, -STAGED_TRANSCRIPT_SUFFIX.length);
}

/** Staged `*.jsonl` transcript names in a directory; a missing one is empty. */
async function listStaged(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error: unknown) {
    if (isMissingFile(error) || hasCode(error, 'ENOTDIR')) return [];
    throw error;
  }
  return names.filter((n) => n.endsWith(`.jsonl${STAGED_TRANSCRIPT_SUFFIX}`));
}

/** Rename `original + suffix` back when it exists and `original` does not. */
async function restoreOne(original: string): Promise<boolean> {
  const staged = original + STAGED_TRANSCRIPT_SUFFIX;
  if (!(await exists(staged)) || (await exists(original))) return false;
  await fs.rename(staged, original);
  return true;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error: unknown) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  );
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
