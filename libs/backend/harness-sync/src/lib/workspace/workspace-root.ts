/**
 * Where a target's files must land: the workspace ROOT, not the caller's cwd.
 *
 * Every CLI Ptah populates discovers its harness directories by walking up from
 * the process cwd to the project root — `.agents/skills`, `.github/skills`,
 * `.cursor/skills`, `.claude/skills` are all root-relative. Ptah, however, is
 * frequently handed a cwd that is NOT the root: a spawned rival CLI inherits
 * the working directory of the task it was given, which in this monorepo is
 * routinely `apps/ptah-electron` or `libs/backend/agent-sdk`. Writing
 * `apps/ptah-electron/.agents/skills` there produced a directory no CLI ever
 * reads, which is defect E14 of the TASK_2026_278 inventory.
 *
 * So the reconciler normalizes ONCE, at its entry point, and every target below
 * it can assume `workspaceRoot` is the real root. Normalizing per target would
 * let two targets disagree about which workspace they are reconciling and give
 * them two different manifests for the same tree.
 *
 * The marker set is `.ptah/` first, then `.git/`. `.ptah/` wins because it is
 * the directory Ptah itself creates for the workspace it was opened on, so it
 * marks the root the user chose even inside a repository with submodules or
 * nested `.git` directories. Neither marker present means the caller's path is
 * already as good an answer as exists, and it is returned unchanged rather than
 * walked to the filesystem root.
 *
 * **The ascent stops below the home directory, and that is load-bearing.**
 * `~/.ptah` is the USER LAYER — the source every target reads from. A walk that
 * did not stop would resolve any workspace sitting under the home directory
 * without its own marker (a scratch folder, a system temp directory) to the
 * home directory itself, and the reconciler would then copy the user layer into
 * `~/.claude/skills` and record a manifest in `~/.ptah/harness`. The marker that
 * makes Ptah's own home directory look like a workspace is the one Ptah put
 * there.
 *
 * **The boundary test is platform-aware, and it has to be.** NTFS and APFS are
 * case-insensitive, and the two spellings of a home directory that reach this
 * function come from different places: `os.homedir()` returns `C:\Users\Abdallah`
 * while a cwd inherited from a spawned CLI, a terminal or a `cd` can arrive as
 * `c:\users\abdallah`. A case-sensitive `===` compares those unequal, the ascent
 * walks straight past the home directory, and the reconciler ends up copying the
 * user layer into `~/.claude/skills` — the exact accident the boundary exists to
 * prevent. Same rule, same reason, as `lock/workspace-lock.ts`'s `queueKey`.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

/** Directory names whose presence identifies a workspace root, in priority order. */
export const WORKSPACE_ROOT_MARKERS: readonly string[] = ['.ptah', '.git'];

/** Ascent cap. A workspace nested 40 directories deep is a bug, not a layout. */
const MAX_ASCENT = 40;

export interface ResolveWorkspaceRootOptions {
  /** Overridable so specs can place a fake home above their temp workspace. */
  homeDir?: string;
}

/**
 * Nearest ancestor of `cwd` (inclusive, exclusive of the home directory and
 * above) that contains `.ptah/` or `.git/`.
 *
 * Returns the resolved `cwd` unchanged when neither marker is found, and when
 * `cwd` is empty.
 */
export function resolveHarnessWorkspaceRoot(
  cwd: string,
  options: ResolveWorkspaceRootOptions = {},
): string {
  if (cwd === '') return cwd;
  const start = resolve(cwd);
  const home = resolve(options.homeDir ?? homedir());

  // The caller's own path is still honoured when it IS the home directory —
  // an explicitly chosen workspace is never second-guessed, only inherited
  // ones are.
  if (isSamePath(start, home)) return start;

  for (const marker of WORKSPACE_ROOT_MARKERS) {
    const found = findAncestorWith(start, marker, home);
    if (found !== null) return found;
  }
  return start;
}

function findAncestorWith(
  start: string,
  marker: string,
  home: string,
): string | null {
  let current = start;
  for (let depth = 0; depth < MAX_ASCENT; depth++) {
    if (isSamePath(current, home)) return null;
    if (existsSync(join(current, marker))) return current;
    const parent = dirname(current);
    // `dirname('/')` is `'/'` and `dirname('C:\\')` is `'C:\\'`, so the walk
    // ends when the parent stops changing.
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Do two already-resolved absolute paths name the same directory?
 *
 * Case-insensitive on Windows, byte-exact everywhere else — the same rule as
 * `queueKey` in `lock/workspace-lock.ts`, and for the same reason: comparing
 * `C:\Users\Abdallah` with `c:\users\abdallah` as different directories is a bug
 * on every filesystem Windows ships with.
 */
export function isSamePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
