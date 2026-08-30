/**
 * The write half of a target: copy a source tree or file into the workspace,
 * survivable on Windows.
 *
 * Every write goes through {@link withWindowsRetry}. Antivirus scanners, the
 * Windows search indexer and an editor holding a file open all produce EBUSY or
 * EPERM on a copy that would succeed 50ms later (E21). Three attempts with
 * backoff turns the overwhelming majority of those into a success; the rest
 * become a reported `write-failed` for ONE entry instead of an exception that
 * aborts the pass and strands the manifest half-written.
 *
 * A managed skill directory is replaced wholesale rather than merged, so a file
 * deleted upstream does not linger in the target forever. The replacement is
 * `rm -r` + copy, and it is only ever aimed at a path the manifest owns — the
 * caller has already proven ownership and already unlinked any junction, so
 * `rm -r` cannot follow a link out of the workspace.
 *
 * {@link hashTransformedDir} lives here too, and only here: it answers "what
 * hash would {@link copyDirectoryTransformed} produce" and is therefore correct
 * only while it mirrors that function's traversal exactly.
 */

import {
  mkdir,
  readdir,
  lstat,
  copyFile,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'fs/promises';
import { extname, join } from 'path';
import {
  digestFileMap,
  hashContent,
  hashFile,
  isIgnoredEntry,
  listContentFiles,
  type ContentHashOptions,
} from '../hash/content-hash';
import { errorCode, withWindowsRetry } from '../fs/windows-retry';
import { isSkillManifestFile, transformSkillMarkdown } from './skill-transform';

const MAX_DEPTH = 20;

// Re-exported so the target files keep importing their write vocabulary from
// the copy engine. The rule itself lives in `fs/windows-retry.ts` because the
// persistence writers need the synchronous half of the same rule.
export { describeError, withWindowsRetry } from '../fs/windows-retry';

/**
 * Replace `targetDir` with a byte copy of `sourceDir`.
 *
 * Ignored entries (`.ptah-origin.json`, `.history/`, `_candidates`) are skipped,
 * which is what keeps the copy's content hash equal to the source's.
 */
export async function copyDirectory(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await withWindowsRetry(() => rm(targetDir, { recursive: true, force: true }));
  await copyTree(sourceDir, targetDir, 0);
}

async function copyTree(
  sourceDir: string,
  targetDir: string,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  await withWindowsRetry(() => mkdir(targetDir, { recursive: true }));

  const entries = await readdir(sourceDir);
  for (const entry of entries) {
    if (isIgnoredEntry(entry)) continue;
    const source = join(sourceDir, entry);
    const target = join(targetDir, entry);
    const stat = await lstat(source);
    // Skipped rather than resolved: a symlink inside a skill would either loop
    // or copy content from outside the source root.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await copyTree(source, target, depth + 1);
    } else if (stat.isFile()) {
      await withWindowsRetry(() => copyFile(source, target));
    }
  }
}

/**
 * Replace `targetDir` with a copy of `sourceDir` in which every `.md` file has
 * been rewritten for a rival CLI.
 *
 * The rival targets need this and the Claude target must not have it: Claude
 * reads the authoring format directly, so transforming for it would fork the
 * two copies of every skill for no gain. The consequence of transforming is
 * that a copy no longer hashes equal to its source — which is why a rival
 * target's manifest entry records the OUTPUT hash and carries the source hash
 * separately (`ManagedEntry.sourceHash`).
 */
export async function copyDirectoryTransformed(
  sourceDir: string,
  targetDir: string,
  folderName: string,
): Promise<void> {
  await withWindowsRetry(() => rm(targetDir, { recursive: true, force: true }));
  await copyTreeTransformed(sourceDir, targetDir, folderName, 0);
}

async function copyTreeTransformed(
  sourceDir: string,
  targetDir: string,
  folderName: string,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  await withWindowsRetry(() => mkdir(targetDir, { recursive: true }));

  const entries = await readdir(sourceDir);
  for (const entry of entries) {
    if (isIgnoredEntry(entry)) continue;
    const source = join(sourceDir, entry);
    const target = join(targetDir, entry);
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      await copyTreeTransformed(source, target, folderName, depth + 1);
      continue;
    }
    if (!stat.isFile()) continue;

    if (extname(entry).toLowerCase() !== '.md') {
      await withWindowsRetry(() => copyFile(source, target));
      continue;
    }
    // Only the skill's own SKILL.md gets its `name` forced to the folder;
    // nested reference docs keep whatever frontmatter their author wrote.
    const content = await readFile(source, 'utf-8');
    const rewritten = transformSkillMarkdown(content, {
      isSkillManifest: depth === 0 && isSkillManifestFile(entry),
      folderName,
    });
    await withWindowsRetry(() => writeFile(target, rewritten, 'utf-8'));
  }
}

/**
 * The hash {@link copyDirectoryTransformed} WOULD produce, without writing.
 *
 * Deliberately in this file and not in `hash/content-hash.ts`: it is only
 * correct as long as it mirrors `copyTreeTransformed` entry for entry — same
 * ignore rules, same symlink skip, same "only the top-level SKILL.md gets its
 * name forced" condition — so the two must be read together and changed
 * together.
 *
 * The one caller is the adoption check in `WorkspaceHarnessTarget.planEntry`: a
 * copy that exists on disk, is not in any manifest, and is byte-identical to
 * what this pass would write is Ptah's own work whose ownership record was lost,
 * not a stranger's file. Answering that question needs the OUTPUT hash, and for
 * a rival target the output is never equal to the source (`skill-transform.ts`).
 *
 * Returns `null` when the source directory cannot be read.
 */
export async function hashTransformedDir(
  sourceDir: string,
  folderName: string,
  options: ContentHashOptions = {},
): Promise<string | null> {
  let stat;
  try {
    stat = await lstat(sourceDir);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  // `digestFileMap` and not a loop of our own: the result is compared directly
  // against `hashDir` of the copy on disk, so the two MUST fold their file
  // maps identically. Spelling the fold out twice is how that stops being true.
  return digestFileMap(
    await listContentFiles(sourceDir, options),
    (relative, absolute) => hashTransformedFile(relative, absolute, folderName),
    options,
  );
}

/** One file's post-transform digest, matching what `copyTreeTransformed` writes. */
async function hashTransformedFile(
  relative: string,
  absolute: string,
  folderName: string,
): Promise<string> {
  if (extname(relative).toLowerCase() !== '.md') {
    return (await hashFile(absolute)) ?? 'unreadable';
  }
  let content: string;
  try {
    content = await readFile(absolute, 'utf-8');
  } catch {
    return 'unreadable';
  }
  const isTopLevel = !relative.includes('/');
  return hashContent(
    transformSkillMarkdown(content, {
      isSkillManifest: isTopLevel && isSkillManifestFile(relative),
      folderName,
    }),
  );
}

/** Copy a single file, creating its parent directory. */
export async function copySingleFile(
  sourceFile: string,
  targetFile: string,
  targetDir: string,
): Promise<void> {
  await withWindowsRetry(() => mkdir(targetDir, { recursive: true }));
  await withWindowsRetry(() => copyFile(sourceFile, targetFile));
}

/**
 * Remove a managed artifact.
 *
 * Directories use `rm -r`; files and links use `unlink`, which never follows a
 * link. Callers must only pass manifest-owned paths.
 */
export async function removeManaged(
  path: string,
  isDirectory: boolean,
): Promise<void> {
  if (isDirectory) {
    await withWindowsRetry(() => rm(path, { recursive: true, force: true }));
    return;
  }
  await withWindowsRetry(async () => {
    try {
      await unlink(path);
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
  });
}
