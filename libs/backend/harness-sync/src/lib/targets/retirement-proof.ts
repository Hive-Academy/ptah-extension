/**
 * The D-2 removal proof for copies of a RETIRED source, shared by every target.
 *
 * A retired skills.sh root or MCP server is no longer desired, so the copies
 * Ptah made of it become removals. Those removals are not ordinary: the user
 * may have edited a copy or committed it, and the source it came from is gone,
 * so a snapshot-and-delete would lose work nobody can regenerate. A retired
 * copy is therefore deleted only on proof — it still holds exactly what Ptah
 * wrote AND git proves it untracked — and every doubt keeps it on disk,
 * reported `keptRetired` so the reconciler disowns it.
 *
 * `WorkspaceHarnessTarget`, `ClaudeTarget` and the MCP facet planner all run
 * this same proof; it lives here so none of them imports another target.
 */

import { execFile } from 'child_process';
import type { Stats } from 'fs';
import { lstat } from 'fs/promises';
import { basename, isAbsolute, join, resolve } from 'path';
import {
  skillsShRetiredItemId,
  type HarnessRetiredItemId,
  type HarnessRetiredKeptReason,
} from '@ptah-extension/shared';
import { errorCode } from '../fs/windows-retry';
import { hashDir, hashFile } from '../hash/content-hash';
import type { ManagedEntries } from '../manifest-store/managed-manifest';
import { prepareOwnedOverwrite } from './artifact-retirement';
import { describeError } from './copy-engine';
import type {
  HarnessApplyResult,
  HarnessPlanRemove,
} from './harness-target.port';
import { isInsideRoot } from './link-ownership';

// ------------------------------------------------------------ result records

/** A retired copy deleted on proof: in `removed` AND `removedRetired`. */
export function recordRetiredRemoved(
  result: HarnessApplyResult,
  relPath: string,
  itemId: HarnessRetiredItemId,
): void {
  result.removed.push(relPath);
  (result.removedRetired ??= []).push({ relPath, itemId });
}

/**
 * A retired copy kept on disk and disowned: NOT in `removed`, never
 * snapshotted. The reconciler drops its manifest entry.
 */
export function recordRetiredKept(
  result: HarnessApplyResult,
  relPath: string,
  itemId: HarnessRetiredItemId,
  reason: HarnessRetiredKeptReason,
): void {
  (result.keptRetired ??= []).push({ relPath, itemId, reason });
}

/**
 * A retired removal that hit an I/O failure. Out of `removed` and
 * `keptRetired`, so the entry stays owned and the next pass retries.
 */
export function recordRetiredFailed(
  result: HarnessApplyResult,
  relPath: string,
  itemId: HarnessRetiredItemId,
  reason: string,
): void {
  result.writeFailed.push({ relPath, reason, itemId });
}

// ------------------------------------------------------------- retired ids

/**
 * The retired item a manifest source belongs to: the first retired skills.sh
 * root containing it, as `skillsShRetiredItemId(basename(root))`.
 */
export function retiredSourceItemId(
  source: string,
  retiredRoots: readonly string[],
): HarnessRetiredItemId | undefined {
  for (const root of retiredRoots) {
    // `resolve('')` is the process cwd, never a retired root.
    if (root === '') continue;
    const rootId = basename(resolve(root));
    if (rootId === '') continue;
    if (isInsideRoot(source, root)) return skillsShRetiredItemId(rootId);
  }
  return undefined;
}

// ---------------------------------------------------------------- git probe

/**
 * Whether git knows a workspace path (D-D7):
 * - `tracked`: `git ls-files --error-unmatch` exited 0;
 * - `untracked`: it exited 1 with git's "did not match any file(s)" message;
 * - `unverifiable`: anything else — git missing, timed out, not a repository
 *   (128), another exit or message, or a path that is not contained.
 */
export type GitTrackingState = 'tracked' | 'untracked' | 'unverifiable';

/** Answers {@link GitTrackingState} for a workspace-relative POSIX path. */
export type GitTrackingProbe = (
  workspaceRoot: string,
  relPath: string,
) => Promise<GitTrackingState>;

/** `git ls-files` bound for the retired-copy proof (D-D7). */
export const GIT_PROBE_TIMEOUT_MS = 5_000;

/** Git's message for a pathspec it does not track (LC_ALL=C). */
export const GIT_NO_MATCH_MESSAGE = 'did not match any file(s) known to git';

/**
 * What running git produced: an exit code with its stderr, or no exit at all
 * (not spawned, killed by the timeout, ended by a signal, output overflow).
 */
export type GitRunOutcome =
  | { kind: 'exited'; exitCode: number; stderr: string }
  | { kind: 'failed'; reason: string };

/** Runs git with an argument array in `cwd`. Never rejects. */
export type GitRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<GitRunOutcome>;

/** Variables that would point git at a repository other than `cwd`'s. */
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

/**
 * `execFile` with an argument array — no shell, so a manifest path cannot be
 * read as a command — a {@link GIT_PROBE_TIMEOUT_MS} bound, the C locale (so
 * {@link GIT_NO_MATCH_MESSAGE} is not translated) and no inherited repository
 * location, so `cwd` alone decides which repository answers.
 */
const execGit: GitRunner = (args, cwd) =>
  new Promise((settle) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LC_ALL: 'C',
      LANGUAGE: 'C',
    };
    for (const name of GIT_LOCATION_ENV) delete env[name];
    execFile(
      'git',
      [...args],
      {
        cwd,
        env,
        timeout: GIT_PROBE_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, _stdout, stderr) => {
        if (error === null) {
          settle({ kind: 'exited', exitCode: 0, stderr });
          return;
        }
        if (
          typeof error.code === 'number' &&
          error.killed !== true &&
          (error.signal === undefined || error.signal === null)
        ) {
          settle({ kind: 'exited', exitCode: error.code, stderr });
          return;
        }
        settle({
          kind: 'failed',
          reason:
            error.killed === true
              ? 'timed out'
              : String(error.code ?? error.signal ?? error.message),
        });
      },
    );
  });

/**
 * Map one `git ls-files --error-unmatch` run to a {@link GitTrackingState}.
 * Only exit 1 together with git's no-match message proves "untracked"; every
 * other outcome — exit 128 outside a repository, a missing git, a timeout,
 * another message — is `unverifiable`, because only proof may delete.
 */
export function classifyGitLsFiles(outcome: GitRunOutcome): GitTrackingState {
  if (outcome.kind === 'failed') return 'unverifiable';
  if (outcome.exitCode === 0) return 'tracked';
  if (outcome.exitCode === 1 && outcome.stderr.includes(GIT_NO_MATCH_MESSAGE)) {
    return 'untracked';
  }
  return 'unverifiable';
}

/**
 * The git-tracking probe a target uses: validates the path, then runs
 * `git --literal-pathspecs ls-files --error-unmatch -- <relPath>` in the
 * workspace root. `--literal-pathspecs` stops a `*` or `:` in a manifest path
 * being read as a pattern that matches some other, tracked file.
 */
export function createGitTrackingProbe(
  run: GitRunner = execGit,
): GitTrackingProbe {
  return async (workspaceRoot, relPath) => {
    if (containedTargetPath(workspaceRoot, relPath) === null) {
      return 'unverifiable';
    }
    return classifyGitLsFiles(
      await run(
        ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relPath],
        workspaceRoot,
      ),
    );
  };
}

// ------------------------------------------------------------ path checks

/**
 * The absolute path of a manifest relPath, or `null` when it is not a plain
 * workspace-relative POSIX path strictly inside the root: empty, absolute, a
 * drive or `~/` prefix, a backslash, an empty, `.` or `..` segment.
 */
export function containedTargetPath(
  workspaceRoot: string,
  relPath: string,
): string | null {
  if (
    relPath === '' ||
    relPath.includes('\\') ||
    relPath.includes('\0') ||
    isAbsolute(relPath) ||
    /^[A-Za-z]:/.test(relPath)
  ) {
    return null;
  }
  const segments = relPath.split('/');
  if (segments[0] === '~') return null;
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  const absolute = join(workspaceRoot, ...segments);
  if (resolve(absolute) === resolve(workspaceRoot)) return null;
  return isInsideRoot(absolute, workspaceRoot) ? absolute : null;
}

/**
 * `lstat` every segment below the workspace root, so a link anywhere on the
 * way — not only at the leaf — is seen and nothing is followed out of the
 * workspace. A missing segment means the path is absent.
 */
async function lstatWithoutLinks(
  workspaceRoot: string,
  relPath: string,
): Promise<
  | { kind: 'present'; stat: Stats }
  | { kind: 'absent' }
  | { kind: 'link' }
  | { kind: 'failed'; reason: string }
> {
  let current = workspaceRoot;
  let stat: Stats | null = null;
  for (const segment of relPath.split('/')) {
    current = join(current, segment);
    try {
      stat = await lstat(current);
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent' };
      return {
        kind: 'failed',
        reason: `cannot inspect ${relPath}: ${describeError(error)}`,
      };
    }
    if (stat.isSymbolicLink()) return { kind: 'link' };
  }
  return stat === null ? { kind: 'absent' } : { kind: 'present', stat };
}

// ----------------------------------------------------------------- removal

/** One retired file or directory copy to remove on proof. */
export interface RetiredCopyRemoval {
  /** The root the removal's relPath is relative to. */
  workspaceRoot: string;
  removal: HarnessPlanRemove;
  itemId: HarnessRetiredItemId;
  /** The target's plan-time manifest entries; supply the recorded hash. */
  baseEntries: ManagedEntries;
  probeGitTracking: GitTrackingProbe;
  /** The apply result the outcome is recorded into. */
  result: HarnessApplyResult;
}

/**
 * Remove one manifest-owned copy of a RETIRED source only on proof (D-2).
 * Every rule keeps on doubt, and a kept copy is never touched or
 * snapshotted — it is reported `keptRetired` and the reconciler disowns it:
 *
 * 1. The path must be relative, contained in the workspace and reached
 *    without a symbolic link at any level — else kept `unverifiable`. A path
 *    already gone leaves nothing to remove and counts as removed.
 * 2. The copy must be the kind recorded and hash to the manifest hash — else
 *    kept `edited`.
 * 3. Git must prove it untracked ({@link GitTrackingState}) — else kept
 *    `git-tracked` or `unverifiable`.
 * 4. Only then is it deleted, through the same detach-and-decide gate an
 *    overwrite uses: an edit saved since step 2 is put back and kept
 *    `edited`, never snapshot-removed.
 *
 * An I/O failure at any step lands in `writeFailed` with the item id: the
 * entry stays owned, and the next pass retries.
 */
export async function removeRetiredCopy({
  workspaceRoot,
  removal,
  itemId,
  baseEntries,
  probeGitTracking,
  result,
}: RetiredCopyRemoval): Promise<void> {
  const { relPath, isDirectory } = removal;
  const owned = baseEntries[relPath];
  const absolute = containedTargetPath(workspaceRoot, relPath);
  if (owned === undefined || absolute === null) {
    recordRetiredKept(result, relPath, itemId, 'unverifiable');
    return;
  }

  const found = await lstatWithoutLinks(workspaceRoot, relPath);
  if (found.kind === 'failed') {
    recordRetiredFailed(result, relPath, itemId, found.reason);
    return;
  }
  if (found.kind === 'absent') {
    recordRetiredRemoved(result, relPath, itemId);
    return;
  }
  if (found.kind === 'link') {
    recordRetiredKept(result, relPath, itemId, 'unverifiable');
    return;
  }
  const kindMatches = isDirectory
    ? found.stat.isDirectory()
    : found.stat.isFile();
  if (!kindMatches) {
    recordRetiredKept(result, relPath, itemId, 'edited');
    return;
  }

  const actual = isDirectory
    ? await hashDir(absolute)
    : await hashFile(absolute);
  if (actual === null) {
    recordRetiredFailed(
      result,
      relPath,
      itemId,
      `cannot read ${relPath} to prove it unchanged`,
    );
    return;
  }
  if (actual !== owned.hash) {
    recordRetiredKept(result, relPath, itemId, 'edited');
    return;
  }

  const tracking = await probeGitTracking(workspaceRoot, relPath);
  if (tracking !== 'untracked') {
    recordRetiredKept(
      result,
      relPath,
      itemId,
      tracking === 'tracked' ? 'git-tracked' : 'unverifiable',
    );
    return;
  }

  const gate = await prepareOwnedOverwrite({
    workspaceRoot,
    relPath,
    isDirectory,
    ownedHash: owned.hash,
  });
  if (gate.kind === 'failed') {
    recordRetiredFailed(result, relPath, itemId, gate.reason);
    return;
  }
  if (gate.kind === 'kept-local-edit') {
    recordRetiredKept(result, relPath, itemId, 'edited');
    return;
  }
  recordRetiredRemoved(result, relPath, itemId);
}
