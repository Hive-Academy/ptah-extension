/**
 * Whose symlink is this?
 *
 * `SkillJunctionService` (deleted in TASK_2026_278) filled
 * `{ws}/.claude/skills/<slug>` with NTFS junctions and directory symlinks, and
 * the Claude target has to unlink those before it can write a copy at the same
 * path — otherwise the copy lands INSIDE the source directory the junction
 * points at.
 *
 * The dangerous version of that rule is "unlink any symlink at a desired path".
 * A user who symlinks `{ws}/.claude/skills/orchestration` at their own checkout
 * of a skill they are authoring has a link at a desired path, and deleting it is
 * data loss committed by a tool that was only supposed to be copying files.
 *
 * So the test is the target, not the shape: a symlink is Ptah's to migrate ONLY
 * when it resolves inside a directory the current sources declare
 * (`HarnessDesiredState.sourceRoots` — the user layer, the plugin overlay and
 * `HarnessSourceLayout.legacyLinkRoots`). Everything else is `foreign`, which is
 * the same answer this lib gives to every file it cannot prove it wrote, and it
 * matches what `workspace-target.ts` already does for the rival directories.
 *
 * A link whose target cannot be read at all is foreign too. It cannot be shown
 * to be Ptah's, and the safe direction is always "leave it alone and report it".
 */

import { readlinkSync, realpathSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';

/**
 * Where a symlink or junction actually points, absolute. `null` when the link
 * cannot be read.
 *
 * `realpathSync` first because it resolves chains and the `..` a relative link
 * may contain; `readlinkSync` as the fallback because `realpathSync` throws on a
 * DANGLING link, and a junction whose source directory was deleted is exactly
 * the leftover most worth migrating.
 */
export function resolveLinkTarget(linkPath: string): string | null {
  try {
    return realpathSync(linkPath);
  } catch {
    /* dangling, or a permission error — fall through to the raw target */
  }
  try {
    const raw = readlinkSync(linkPath);
    return isAbsolute(raw) ? resolve(raw) : resolve(dirname(linkPath), raw);
  } catch {
    return null;
  }
}

/** Is `candidate` `root` itself, or anything beneath it? */
export function isInsideRoot(candidate: string, root: string): boolean {
  // `path.relative` is case-insensitive on win32, which is the behaviour this
  // needs: `C:\Users\A\.ptah` and `c:\users\a\.ptah` are one directory.
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * True when the symlink at `linkPath` was written by Ptah's pre-reconciler
 * junction layer and may therefore be unlinked.
 *
 * An empty `sourceRoots` answers `false` for everything, which is the correct
 * degenerate behaviour: with no declared sources there is nothing Ptah can prove
 * it produced.
 */
export function isMigratableLink(
  linkPath: string,
  sourceRoots: readonly string[],
): boolean {
  if (sourceRoots.length === 0) return false;
  const target = resolveLinkTarget(linkPath);
  if (target === null) return false;
  return sourceRoots.some((root) => isInsideRoot(target, root));
}
