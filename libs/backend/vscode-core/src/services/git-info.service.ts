/**
 * Git Info Service
 *
 * Encapsulates all git CLI interactions for the Electron main process.
 * Uses cross-spawn for Windows compatibility. Zero new dependencies.
 */

import * as path from 'path';
import { readFile, stat as readStat } from 'fs/promises';
import { createHash } from 'crypto';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { Logger } from '../logging';
import {
  execGit,
  execGitBuffer,
  GitOutputLimitError,
  GitTimeoutError,
  isIndexLockFailure,
  GIT_STATUS_MAX_OUTPUT_BYTES,
  type ExecGitOptions,
  type ExecGitResult,
  type ExecGitBufferResult,
} from '../utils/exec-git';
import {
  type GitFileStatus,
  type GitInfoResult,
  type GitStatusUnavailableReason,
  type GitMutationFailureCode,
  GIT_LOCKED_MESSAGE,
  GIT_HOOK_TIMEOUT_MS,
  GIT_DIFF_MAX_SIDE_BYTES,
  type GitWorktreeInfo,
  type GitStageResult,
  type GitUnstageResult,
  type GitDiscardResult,
  type GitCommitResult,
  type GitShowFileResult,
  type GitPushResult,
  type GitPullResult,
  type GitFetchResult,
  type GitStashMutationResult,
  type GitStashShowResult,
  type GitStashFileEntry,
  type BranchRef,
  type GitBranchesResult,
  type GitCheckoutParams,
  type GitCheckoutResult,
  type StashEntry,
  type GitStashListResult,
  type TagRef,
  type GitTagsResult,
  type RemoteInfo,
  type GitRemotesResult,
  type GitLastCommitResult,
  type GitBlobRead,
  type GitReadErrorCode,
  type GitDiffComparison,
  type GitDiffFileResult,
  type DiffSideRef,
  type GitHunkRef,
  type GitApplyHunksOperation,
  type GitApplyHunksFailure,
  type GitApplyHunksResult,
  type GitReviewChangesResult,
  type GitReviewFileResult,
} from '@ptah-extension/shared';
import {
  GitReviewReaderService,
  type ReviewFileRequest,
} from './git-review-reader.service';
import { parseStatusV2Z } from './git/git-status-parser';
import { GitRepoWriteLock } from './git/git-write-lock';
import { GitCommitRunner } from './git/git-commit-runner';
import { GitRemoteSync } from './git/git-remote-sync';
import { AgentWorktreeAdmin } from './git/agent-worktree-admin';
import { GitRepoOperationReader } from './git/git-repo-operation.reader';
import { classifyBlobBytes } from './git/git-blob-classifier';
import { thrownOutcome, writeOutcome } from './git/git-mutation-outcome';
import { assertSafeRef, assertSafeRevision } from './git/git-ref-guard';
import {
  EMPTY_TREE_SHA,
  GitChangeSetNumstatReader,
  type ChangeSetLineCounts,
} from './git/git-change-set-numstat.reader';

/** Working-tree status: NUL-terminated, verbatim paths, no C-quoting. */
const STATUS_Z = ['status', '--porcelain=v2', '-z'] as const;
const STATUS_ARGS = [...STATUS_Z, '--branch', '--untracked-files=all'];

/**
 * Why a status read produced no answer. The watcher and the UI keep the last
 * good list on any of these; none of them means "not a repository".
 */
function unavailableReason(
  error: unknown,
  stderr = '',
): GitStatusUnavailableReason {
  if (error instanceof GitOutputLimitError) return 'output-too-large';
  if (error instanceof GitTimeoutError) return 'timeout';
  return isIndexLockFailure(stderr) ? 'locked' : 'error';
}

/** A diff side whose text is not shipped: no patch, no hunks (RC12). */
function isUnpatchable(side: GitBlobRead): boolean {
  return side.outcome === 'too-large' || side.outcome === 'lfs-pointer';
}

function statusUnavailable(reason: GitStatusUnavailableReason): GitInfoResult {
  return {
    isGitRepo: true,
    branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
    files: [],
    statusUnavailable: reason,
  };
}

/** Client-facing discard failure when git status could not be read. */
const DISCARD_STATUS_FAILED =
  'Could not read file status; nothing was discarded.';

/** `index.lock` stayed held by another process through every retry. */
class IndexLockedError extends Error {}

/** `probeRepo`'s answer: definite, or unknown with the reason git gave none. */
type RepoProbe =
  | { state: 'yes' | 'no' }
  | { state: 'unknown'; reason: GitStatusUnavailableReason };

/**
 * git's own binary heuristic: a NUL byte anywhere in the first 8000 bytes.
 */
const BINARY_SNIFF_BYTES = 8000;

/**
 * Untracked files whose line count `getGitInfo` reads from disk per status
 * run. Git has no numstat for an untracked file, so each one is a full file
 * read; a fresh `node_modules` or build output left untracked would otherwise
 * turn one status refresh into thousands of reads (TASK_2026_437, INV-4).
 * Files past this count report unknown (`null`) additions and deletions.
 */
const MAX_UNTRACKED_NUMSTAT_FILES = 200;

/** Largest untracked file whose lines are counted; larger reports unknown. */
const MAX_UNTRACKED_NUMSTAT_BYTES = 1024 * 1024;

/**
 * A unified-diff hunk header: `@@ -a[,b] +c[,d] @@[ section]`.
 *
 * Anchored at the start of a line. Every *body* line of a hunk is prefixed by
 * ' ', '+', '-' or '\', so a literal `@@` inside file content can never be
 * mistaken for a header.
 */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** git's marker for a diff it declined to render as text. */
const BINARY_PATCH_MARKER = /^Binary files .* differ$/m;

/**
 * `git apply --verbose` announces a hunk that matched away from its recorded
 * line number. Only emitted under `--verbose`; plain `git apply` is silent
 * about offsets, which is why the write path always passes it.
 */
const APPLY_OFFSET_RE = /\(offset (-?\d+) lines?\)/g;

/**
 * `git diff` flags shared by the read path and the write path. The explicit
 * prefixes override `diff.noprefix` / `diff.srcPrefix` / `diff.dstPrefix`, and
 * `--no-textconv` defeats textconv drivers: the patch must be one `git apply`
 * accepts, whatever the user's diff config says.
 */
const DIFF_FLAGS = [
  '-U3',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--src-prefix=a/',
  '--dst-prefix=b/',
] as const;

/**
 * Positional (non-flag) arguments after the git verb.
 *
 * The tell that separates a listing invocation from a writing one for the
 * verbs that are both: `git remote -v` and `git tag --sort=… --format=…` carry
 * none, `git remote add <name>` and `git tag <name>` carry one.
 */
function positionalArgs(args: readonly string[]): string[] {
  return args.slice(1).filter((a) => !a.startsWith('-'));
}

/**
 * Does this argv change anything the read cache holds?
 *
 * **The default answer is `true`.** Only verbs proven read-only answer `false`.
 * The two failure modes are not symmetric: mis-classifying a read costs one
 * dropped cache entry and one extra `for-each-ref`, while mis-classifying a
 * WRITE serves a stale branch list until the next watcher event. So a verb this
 * service does not use today — `branch`, `fetch`, `cherry-pick`, `revert`,
 * `am`, `merge`, `rebase`, `pull` — counts as a mutation, and a method added
 * later inherits invalidation by construction instead of by remembering to ask
 * for it. That is the promise {@link GitInfoService.execGit} makes.
 *
 * Read commands MUST answer `false` or they invalidate the very entry they were
 * about to populate — which is why the allowlist below is exactly the set of
 * verbs this service spawns on its read paths, plus the read-only plumbing
 * (`rev-list`, `cat-file`, `ls-files`, `ls-tree`, `merge-base`,
 * `check-ignore`) that has no writing form at all.
 *
 * Four verbs are read-only only in some forms and are told apart by their
 * arguments rather than being trusted wholesale:
 *
 * - `stash` — `list` and `show` read; `push`/`pop`/`apply`/`drop` write.
 * - `worktree` — `list` reads; `add`/`remove`/`prune` write.
 * - `remote` / `tag` — bare or all-flags is a listing; a positional is a write.
 * - `symbolic-ref` — `symbolic-ref --short HEAD` reads, but
 *   `symbolic-ref HEAD refs/heads/x` REPOINTS HEAD, which is precisely what the
 *   branch cache holds. Two positionals is the write form.
 *
 * Leading `-c <key>=<value>` config pairs are skipped before the verb is read,
 * so `git -c core.x=y commit` classifies as `commit`, not as `-c`.
 *
 * Exported for the classification table in `git-info.service.spec.ts`. It is
 * not re-exported from the lib barrel.
 */
export function isMutatingGitCommand(argv: readonly string[]): boolean {
  let verbAt = 0;
  while (argv[verbAt] === '-c' && verbAt + 2 < argv.length) verbAt += 2;
  const args = verbAt === 0 ? argv : argv.slice(verbAt);
  const [command, sub] = args;
  switch (command) {
    // Unconditionally read-only: these verbs have no writing form.
    case 'status':
    case 'show':
    case 'diff':
    case 'log':
    case 'rev-parse':
    case 'rev-list':
    case 'for-each-ref':
    case 'cat-file':
    case 'ls-files':
    case 'ls-tree':
    case 'merge-base':
    case 'check-ignore':
      return false;
    case 'stash':
      return sub !== 'list' && sub !== 'show';
    case 'worktree':
      return sub !== 'list';
    case 'remote':
    case 'tag':
      return positionalArgs(args).length > 0;
    case 'symbolic-ref':
      return positionalArgs(args).length > 1;
    default:
      return true;
  }
}

/** A usable `stash@{N}` ordinal: a non-negative safe integer. */
function isStashIndex(index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0;
}

function stashRef(index: number): string {
  return `stash@{${index}}`;
}

/** Why git refused a switch: the paths in the way, and whether any is untracked. */
interface SwitchRefusal {
  paths: string[];
  untracked: boolean;
}

/**
 * Paths git names when it refuses a switch because local files would be
 * overwritten. `execGit` pins `LC_ALL=C`, so the English text is stable.
 *
 * - List form (plain `switch`): a header ending "would be overwritten by
 *   <op>:" — "Your local changes to the following files…" for tracked files,
 *   "The following untracked working tree files…" for untracked ones — then
 *   one tab-indented path per line.
 * - Single-line form (`switch --discard-changes`, which discards tracked
 *   changes but still refuses an untracked file in the way): `error: Untracked
 *   working tree file '<path>' would be overwritten by <op>.` Git stops at the
 *   first such file, so only that one is named.
 */
function parseSwitchRefusal(stderr: string): SwitchRefusal {
  const paths: string[] = [];
  let untracked = false;
  let inList = false;
  for (const line of stderr.split(/\r?\n/)) {
    const single =
      /^error: Untracked working tree file '(.+)' would be overwritten by \S+\.$/.exec(
        line,
      );
    if (single) {
      paths.push(single[1]);
      untracked = true;
      inList = false;
    } else if (/would be overwritten by \S+:$/.test(line)) {
      inList = true;
      untracked ||= line.includes('untracked working tree files');
    } else if (inList && line.startsWith('\t')) {
      paths.push(line.slice(1));
    } else {
      inList = false;
    }
  }
  return { paths, untracked };
}

/** Shown when the installed git predates `git switch` / `--end-of-options`. */
const GIT_TOO_OLD_MESSAGE = 'Git 2.24 or later is required for this action.';

/**
 * Whether a failed `git switch` failed because git is older than 2.24:
 * `switch` arrived in 2.23 and `--end-of-options` in 2.24.
 */
function isGitTooOldForSwitch(stderr: string): boolean {
  return (
    stderr.includes("'switch' is not a git command") ||
    /unknown option .end-of-options'/.test(stderr)
  );
}

/**
 * Parse `git diff --name-status -z -M` output into stash file entries.
 *
 * Each record is a status token followed by one path, or two (source, then
 * destination) for a rename or copy. A copy is reported as an addition of its
 * destination and a type change as a modification, since the wire union
 * carries `A | M | D | R` only.
 */
export function parseStashNameStatus(output: string): GitStashFileEntry[] {
  const tokens = output.split('\0');
  const files: GitStashFileEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    i += 1;
    if (!status) continue;
    const code = status.charAt(0);
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[i];
      const newPath = tokens[i + 1];
      i += 2;
      if (!oldPath || !newPath) break;
      files.push(
        code === 'R'
          ? { path: newPath, status: 'R', oldPath }
          : { path: newPath, status: 'A' },
      );
      continue;
    }
    const filePath = tokens[i];
    i += 1;
    if (!filePath) break;
    if (code === 'A' || code === 'D') {
      files.push({ path: filePath, status: code });
    } else {
      files.push({ path: filePath, status: 'M' });
    }
  }
  return files;
}

/**
 * Read `%(upstream:track)` — the same field `git branch -vv` prints.
 *
 * git emits `[ahead 3, behind 2]`, `[ahead 3]`, `[behind 2]`, `[gone]`, or
 * the empty string. Empty means either "no upstream" or "in sync"; both are
 * 0/0, so the two need not be told apart here. `[gone]` (the upstream ref has
 * been deleted) is also 0/0 — there is nothing left to count against.
 *
 * The wording is stable because `exec-git` pins `LC_ALL=C` on every
 * invocation.
 */
function parseUpstreamTrack(raw: string): { ahead: number; behind: number } {
  const aheadMatch = /ahead (\d+)/.exec(raw);
  const behindMatch = /behind (\d+)/.exec(raw);
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
  };
}

/**
 * Which operations are defined for each comparison.
 *
 * `worktree` compares index -> working tree: its changes can be promoted into
 * the index (stage) or thrown away (revert). `staged` compares HEAD -> index:
 * its only partial move is back out of the index (unstage). Discarding a
 * staged change outright is a two-step the user performs explicitly.
 */
const VALID_OPERATIONS: Readonly<
  Record<GitDiffComparison, readonly GitApplyHunksOperation[]>
> = {
  worktree: ['stage', 'revert'],
  staged: ['unstage'],
};

/**
 * The slice of `IFileSystemProvider` the worktree side of a diff needs.
 *
 * Declared structurally rather than importing the port so this service keeps
 * its narrow surface — hosts pass their registered
 * `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` straight through.
 */
export interface WorktreeFileReader {
  readFileBytes(filePath: string): Promise<Uint8Array>;
  exists(filePath: string): Promise<boolean>;
}

/**
 * The read *and write* slice of `IFileSystemProvider` the hunk-apply path
 * needs. Extends {@link WorktreeFileReader} with the one write used to restore
 * a worktree file after a failed reverse apply (AC7); nothing else on this
 * service ever writes through it.
 */
export interface WorktreeFileAccess extends WorktreeFileReader {
  writeFileBytes(filePath: string, content: Uint8Array): Promise<void>;
}

/** Request shape for {@link GitInfoService.diffFile}. */
export interface DiffFileRequest {
  /** Workspace-relative path, modified side. */
  path: string;
  comparison: GitDiffComparison;
  /** Pre-rename source path for staged renames; falls back to `path`. */
  originalPath?: string;
}

/** Request shape for {@link GitInfoService.applyHunks}. */
export interface ApplyHunksRequest extends DiffFileRequest {
  operation: GitApplyHunksOperation;
  /** Ordinals into the hunk array of the snapshot named by `snapshotToken`. */
  hunkIndices: number[];
  /** The token `diffFile` issued for the diff the user acted on. */
  snapshotToken: string;
}

/**
 * Single-flight state for one read key — see `GitInfoService.flights`.
 * `startedAtGeneration` is the invalidation counter when `running` started;
 * `trailing` is the one queued rerun, whose `compute` starts when `running`
 * settles and whose `promise` every post-invalidation caller shares.
 */
interface ReadFlight {
  running: Promise<unknown>;
  startedAtGeneration: number;
  trailing?: {
    readonly promise: Promise<unknown>;
    readonly compute: () => Promise<unknown>;
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason: unknown) => void;
  };
}

/**
 * **Every method on this service assumes `workspacePath` is the git repository
 * top level.** It is not merely the process cwd for the subprocess: `readBlob`
 * addresses objects with root-relative `rev:path` specs, `readWorktreeBlob`
 * joins `workspacePath + path`, and `applyHunks` hands `git apply` a patch
 * whose `a/`…`b/` names `git diff` emitted relative to the top level.
 *
 * Opening a **subdirectory** of a repository as the workspace folder is
 * therefore unsupported. It fails safely rather than corrupting: `git diff`
 * still emits root-relative paths while `git apply` resolves them against cwd,
 * so the patch simply does not apply and the guards in {@link
 * GitInfoService.applyHunks} refuse before writing. Undocumented, that safe
 * failure reads as a bug to whoever hits it — hence this note.
 *
 * Removing the assumption (rather than stating it) means resolving the top
 * level once via `git rev-parse --show-toplevel` and using it as the cwd for
 * every invocation. That is a larger change and is deliberately not made here.
 *
 * **Write lock (TASK_2026_576 RC6).** Stage, unstage, discard, commit,
 * checkout, applyHunks, stash apply/pop/drop and pull each run as ONE
 * `writeLock.run()` body per repository — its reads, its writes and its
 * rollback. Push, fetch and `worktree add`/`remove` are not locked;
 * `worktree prune` and the agent-worktree exclude write are (see
 * `AgentWorktreeAdmin`). Two invariants
 * every locked body keeps:
 * - it calls only private helpers and read methods, never another locked
 *   public method (a nested `run` throws `GitReentrantLockError`);
 * - it awaits everything it starts before returning — no `void` promise,
 *   timer or event callback that spawns git — or that work would run outside
 *   the FIFO while still carrying the lock's reentrance context.
 * Mutating spawns go through `writeLock.execWrite`, which absorbs a short
 * `index.lock` held by another process and otherwise reports `LOCKED`.
 */
export class GitInfoService {
  private readonly reviewReader: GitReviewReaderService;
  private readonly writeLock = new GitRepoWriteLock({
    exec: (args, cwd, options) => this.execGit(args, cwd, options),
  });
  private readonly commitRunner: GitCommitRunner;
  private readonly remoteSync: GitRemoteSync;
  private readonly worktreeAdmin: AgentWorktreeAdmin;
  private readonly operationReader: GitRepoOperationReader;
  private readonly changeSetNumstat: GitChangeSetNumstatReader;

  /**
   * @param spawner Optional `IProcessSpawner`. When a host supplies one, every
   * git invocation this service makes is launched on the spawner's thread
   * instead of the caller's — see the `spawner` field on `ExecGitOptions`.
   * Electron passes the `OffThreadProcessSpawner` it already binds under
   * `SDK_TOKENS.SDK_PROCESS_SPAWNER`; VS Code and the CLI pass nothing and keep
   * the inline `cross-spawn` path. Not injected via a decorator because this
   * service is constructed by hand in all three hosts.
   */
  constructor(
    private readonly logger: Logger,
    private readonly spawner?: IProcessSpawner,
    reviewReader?: GitReviewReaderService,
  ) {
    this.reviewReader =
      reviewReader ?? new GitReviewReaderService(logger, spawner);
    const deps = {
      exec: (args: string[], cwd: string, options?: ExecGitOptions) =>
        this.execGit(args, cwd, options),
      writeLock: this.writeLock,
      logger,
    };
    this.commitRunner = new GitCommitRunner(deps);
    this.remoteSync = new GitRemoteSync(deps);
    this.worktreeAdmin = new AgentWorktreeAdmin(deps);
    this.operationReader = new GitRepoOperationReader(deps);
    this.changeSetNumstat = new GitChangeSetNumstatReader({
      exec: deps.exec,
      logger,
      parseNumstat: (stdout) => this.parseNumstat(stdout),
      countUntracked: (workspacePath, relativePath) =>
        this.readUntrackedNumstat(workspacePath, relativePath),
      maxUntrackedFiles: MAX_UNTRACKED_NUMSTAT_FILES,
    });
  }

  /**
   * `${kind}|${workspacePath}` for status warnings already logged once (output
   * past the cap, unparseable records); bounded like `invalidatedAt`.
   */
  private readonly statusWarned = new Set<string>();

  /**
   * Settled results of the cheap-to-invalidate read methods, held until
   * {@link invalidateReadCache} drops them. Keys are
   * `${method}|${workspacePath}|${variant}`, so two workspace folders never
   * share an entry and invalidating one leaves the other intact.
   *
   * `getGitInfo` is deliberately NOT in here — it is the working-tree status
   * walk and the git watcher's own source of truth, so a settled entry would
   * make the watcher push status it had already superseded. It gets
   * single-flight only.
   */
  private readonly readCache = new Map<string, unknown>();

  /**
   * One flight record per read key (same keys as {@link readCache}): the
   * computation running now, plus at most one queued trailing run.
   *
   * Invalidation never deletes a record. Before TASK_2026_437 it did, so the
   * git watcher's invalidate-then-`getGitInfo` pair found no running entry to
   * join and every file-system event started its own `git status` pipeline
   * beside the ones still running (C8). Now a caller that arrives after an
   * invalidation is handed the single trailing run, which starts only when the
   * current run settles — never two runs per key (INV-3).
   */
  private readonly flights = new Map<string, ReadFlight>();

  /**
   * Monotonic counter bumped by every {@link invalidateReadCache}. A run
   * records the counter it started under; it is stale once an invalidation
   * covering its workspace carries a higher value. Same idiom as the
   * `auth:getAuthStatus` cache (TASK_2026_342).
   */
  private cacheGeneration = 0;

  /** Counter value of the last invalidation with no `workspacePath`. */
  private invalidatedAllAt = 0;

  /**
   * Counter value of the last invalidation per workspace. Tracked per root so
   * invalidating one workspace neither marks another's running flight stale
   * nor discards its write-back. One entry per workspace ever invalidated and
   * never evicted: bounded by the workspace roots opened in this process (a
   * handful of short strings), so no eviction policy is needed.
   */
  private readonly invalidatedAt = new Map<string, number>();

  /**
   * Drop cached git reads.
   *
   * Called by every repo-mutating method on this service. Bumps the
   * generation and drops SETTLED entries only: a run already in flight keeps
   * its slot, cannot write its now-stale value back, and callers arriving
   * after this point queue behind it for one fresh trailing run.
   *
   * With no `workspacePath`, every workspace is dropped.
   */
  invalidateReadCache(workspacePath?: string): void {
    this.cacheGeneration++;
    this.reviewReader.invalidate(workspacePath);
    if (!workspacePath) {
      this.invalidatedAllAt = this.cacheGeneration;
      this.readCache.clear();
      return;
    }
    this.invalidatedAt.set(workspacePath, this.cacheGeneration);
    const suffix = `|${workspacePath}|`;
    for (const key of [...this.readCache.keys()]) {
      if (key.includes(suffix)) this.readCache.delete(key);
    }
  }

  /**
   * Working-tree status after a change made outside Ptah (a `git checkout` in
   * a terminal, an agent editing files).
   *
   * Invalidates the read caches for `workspacePath` and resolves with the
   * status of a run that STARTED AFTER this call: the queued trailing run when
   * one is already running, otherwise a new run. Any number of calls during
   * one run share that single trailing run, so a burst of watcher events
   * costs at most two `git status` pipelines, one after the other.
   *
   * Nobody is waiting on this run — the watcher calls it — so a run it starts
   * spawns its git children at background OS priority. A `getGitInfo` caller
   * that joins such a run shares its priority.
   */
  refreshGitInfo(workspacePath: string): Promise<GitInfoResult> {
    this.invalidateReadCache(workspacePath);
    return this.singleFlight(`info|${workspacePath}|`, workspacePath, () =>
      this.computeGitInfo(workspacePath, 'background'),
    );
  }

  /** The newest invalidation counter that covers `workspacePath`. */
  private generationOf(workspacePath: string): number {
    return Math.max(
      this.invalidatedAllAt,
      this.invalidatedAt.get(workspacePath) ?? 0,
    );
  }

  /**
   * Single-flight with one trailing rerun. A caller joins the running
   * computation when no invalidation has covered it since it started;
   * otherwise it gets the queued trailing run (created on first need, shared
   * by every later caller until it starts).
   *
   * Priority follows the run, not the caller: a joiner shares the running
   * computation's priority, and the trailing run keeps the `compute` of
   * whoever queued it first. So a user `getGitInfo` that lands on a
   * watcher-started (or watcher-queued) run executes at background OS
   * priority — accepted, since the run is already underway or already owed.
   */
  private singleFlight<T>(
    key: string,
    workspacePath: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    const flight = this.flights.get(key);
    if (!flight) {
      return this.startFlight(key, workspacePath, compute) as Promise<T>;
    }
    if (flight.startedAtGeneration >= this.generationOf(workspacePath)) {
      return flight.running as Promise<T>;
    }
    if (!flight.trailing) {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      flight.trailing = { promise, compute, resolve, reject };
    }
    return flight.trailing.promise as Promise<T>;
  }

  /**
   * Start `compute` as the running flight for `key`. When it settles —
   * resolved OR rejected, so a timed-out git run never strands the callers
   * queued behind it — the trailing run (if any) starts in the same record;
   * otherwise the record is removed.
   */
  private startFlight(
    key: string,
    workspacePath: string,
    compute: () => Promise<unknown>,
  ): Promise<unknown> {
    const startedAtGeneration = this.cacheGeneration;
    // A synchronous throw must settle the flight like a rejection would, or the
    // record would never clear and the key would be wedged. The executor runs
    // synchronously, so `compute` still starts now (not a microtask later) and
    // a throw inside it becomes this promise's rejection.
    const running = new Promise<unknown>((resolve) => resolve(compute()));
    const flight: ReadFlight = this.flights.get(key) ?? {
      running,
      startedAtGeneration,
    };
    flight.running = running;
    flight.startedAtGeneration = startedAtGeneration;
    this.flights.set(key, flight);

    const onSettled = (): void => {
      if (this.flights.get(key) !== flight || flight.running !== running) {
        return;
      }
      const trailing = flight.trailing;
      if (!trailing) {
        this.flights.delete(key);
        return;
      }
      flight.trailing = undefined;
      this.startFlight(key, workspacePath, trailing.compute).then(
        trailing.resolve,
        trailing.reject,
      );
    };
    // Both handlers: this chain only sequences the flight. The rejection
    // itself reaches the callers through `running`, which they hold.
    running.then(onSettled, onSettled);
    return running;
  }

  /** Single-flight plus a settled entry held until invalidation. */
  private cachedRead<T>(
    key: string,
    workspacePath: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    if (this.readCache.has(key)) {
      return Promise.resolve(this.readCache.get(key) as T);
    }
    return this.singleFlight(key, workspacePath, async () => {
      // Captured when the run actually starts — a trailing run starts later
      // than the caller that queued it.
      const startedAt = this.cacheGeneration;
      const value = await compute();
      if (startedAt >= this.generationOf(workspacePath)) {
        this.readCache.set(key, value);
      }
      return value;
    });
  }

  async getGitInfo(workspacePath: string): Promise<GitInfoResult> {
    return this.singleFlight(`info|${workspacePath}|`, workspacePath, () =>
      this.computeGitInfo(workspacePath),
    );
  }

  private async computeGitInfo(
    workspacePath: string,
    priority: ExecGitOptions['priority'] = 'normal',
  ): Promise<GitInfoResult> {
    const probe = await this.probeRepo(workspacePath, priority);
    if (probe.state === 'no') {
      return {
        isGitRepo: false,
        branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
        files: [],
      };
    }
    // Git could not say whether this is a repository (slow, missing, broken):
    // report status as unavailable, never as "not a repository".
    if (probe.state === 'unknown') {
      this.logger.warn(
        `[GitInfoService] repository probe for ${workspacePath} gave no answer (${probe.reason})`,
      );
      return statusUnavailable(probe.reason);
    }

    try {
      const { stdout, stderr, exitCode } = await this.execGit(
        [...STATUS_ARGS],
        workspacePath,
        { priority, maxOutputBytes: GIT_STATUS_MAX_OUTPUT_BYTES },
      );

      if (exitCode !== 0) {
        this.logger.warn(
          `[GitInfoService] git status exited with code ${exitCode} for ${workspacePath}`,
        );
        return statusUnavailable(unavailableReason(undefined, stderr));
      }

      const parsed = parseStatusV2Z(stdout);
      if (parsed.skippedRecords > 0) {
        this.warnOnce(
          `skipped|${workspacePath}`,
          `[GitInfoService] git status for ${workspacePath} had ` +
            `${parsed.skippedRecords} unparseable record(s); they were left out`,
        );
      }
      const branch = parsed.branch;
      // `!` (ignored) records are never changes, whatever flags produced them.
      const files = parsed.files.filter((file) => file.status !== '!');
      const [stagedStats, worktreeStats, operation] = await Promise.all([
        this.readNumstat(workspacePath, true, priority),
        this.readNumstat(workspacePath, false, priority),
        this.operationReader.readRepoOperation(workspacePath, files, priority),
      ]);
      let untrackedRead = 0;
      for (const file of files) {
        const stat = (file.staged ? stagedStats : worktreeStats).get(file.path);
        if (stat) Object.assign(file, stat);
        else if (!file.staged && file.status === '??' && !file.isDirectory) {
          Object.assign(
            file,
            untrackedRead++ < MAX_UNTRACKED_NUMSTAT_FILES
              ? await this.readUntrackedNumstat(workspacePath, file.path)
              : { additions: null, deletions: null },
          );
        }
      }

      return {
        isGitRepo: true,
        branch,
        files,
        ...(operation && { operation }),
      };
    } catch (error: unknown) {
      if (error instanceof GitOutputLimitError) {
        // Not a failure to retry and not a clean tree: the repository's own
        // status is too large to read. Said once per workspace, because the
        // watcher would otherwise repeat it on every refresh.
        this.warnOnce(
          `limit|${workspacePath}`,
          `[GitInfoService] git status output for ${workspacePath} passed ` +
            `${error.limitBytes} bytes; status is unavailable for this repository`,
        );
        return statusUnavailable('output-too-large');
      }
      // INLINE, not context. `Logger.error`'s console transport renders only
      // `context.error` (the slot for a real `Error` instance) and
      // `context.metadata`; a plain object passed as context is dropped whole.
      // This line read `[ERROR] [GitInfoService] getGitInfo failed` with
      // nothing after it in the 2026-08-29 smoke log — naming neither the
      // folder nor the failure, so a `git status` timeout and a spawn error
      // were indistinguishable after the fact.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[GitInfoService] getGitInfo failed for ${workspacePath}: ${message}`,
        error instanceof Error ? error : undefined,
      );
      return statusUnavailable(unavailableReason(error));
    }
  }

  private warnOnce(key: string, message: string): void {
    if (this.statusWarned.has(key)) return;
    this.statusWarned.add(key);
    this.logger.warn(message);
  }

  /** Read a PR-style comparison without checking out either ref. */
  async reviewChanges(
    workspacePath: string,
    baseName: string,
    headName: string,
  ): Promise<GitReviewChangesResult> {
    return this.reviewReader.reviewChanges(workspacePath, baseName, headName);
  }

  /** Read two immutable blobs from a comparison previously issued above. */
  async reviewFile(
    workspacePath: string,
    request: ReviewFileRequest,
  ): Promise<GitReviewFileResult> {
    return this.reviewReader.reviewFile(workspacePath, request);
  }

  /**
   * `git worktree list`, with each entry's `locked`/`prunable` labels. See
   * {@link AgentWorktreeAdmin}.
   */
  async getWorktrees(workspacePath: string): Promise<GitWorktreeInfo[]> {
    return this.worktreeAdmin.list(workspacePath);
  }

  /**
   * `git worktree add`. A target under `<workspace>/.claude-worktrees/` also
   * gets that directory excluded in `info/exclude` (once; a failure there is
   * warned and does not fail the add).
   */
  async addWorktree(
    workspacePath: string,
    params: { branch: string; path?: string; createBranch?: boolean },
  ): Promise<{ success: boolean; worktreePath?: string; error?: string }> {
    return this.worktreeAdmin.add(workspacePath, params);
  }

  /**
   * `git worktree remove [--force] -- <path>`. A forced removal of a locked
   * worktree is refused.
   */
  async removeWorktree(
    workspacePath: string,
    worktreePath: string,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    return this.worktreeAdmin.remove(workspacePath, worktreePath, force);
  }

  /** `git worktree prune`: drop the admin entries of vanished worktrees. */
  async pruneWorktrees(workspacePath: string): Promise<{
    success: boolean;
    error?: string;
    code?: GitMutationFailureCode;
  }> {
    return this.worktreeAdmin.prune(workspacePath);
  }

  /**
   * Stage files in the git index.
   * Runs: git add -- <paths...>
   */
  async stageFiles(
    workspacePath: string,
    paths: string[],
  ): Promise<GitStageResult> {
    try {
      this.validatePaths(paths);
      return await this.writeLock.run(workspacePath, async () =>
        writeOutcome(
          await this.writeLock.execWrite(
            ['add', '--', ...paths],
            workspacePath,
          ),
          'Failed to stage files',
        ),
      );
    } catch (error) {
      const outcome = thrownOutcome(error);
      this.logger.error('[GitInfoService] stageFiles failed', {
        workspacePath,
        paths,
        error: outcome.error,
      } as unknown as Error);
      return outcome;
    }
  }

  /**
   * Unstage files from the git index.
   * Runs: git reset HEAD -- <paths...>
   */
  async unstageFiles(
    workspacePath: string,
    paths: string[],
  ): Promise<GitUnstageResult> {
    try {
      this.validatePaths(paths);
      return await this.writeLock.run(workspacePath, async () =>
        writeOutcome(
          await this.writeLock.execWrite(
            ['reset', 'HEAD', '--', ...paths],
            workspacePath,
          ),
          'Failed to unstage files',
        ),
      );
    } catch (error) {
      const outcome = thrownOutcome(error);
      this.logger.error('[GitInfoService] unstageFiles failed', {
        workspacePath,
        paths,
        error: outcome.error,
      } as unknown as Error);
      return outcome;
    }
  }

  /**
   * Discard working tree changes for files, classified by the same `-z`
   * status parser as `getGitInfo` (verbatim paths, never trimmed):
   * - staged rename: `git restore --staged --worktree --source=HEAD -- <origPath> <path>`
   * - other tracked: `git checkout -- <paths...>`
   * - untracked: `git clean -f -- <paths...>`
   *
   * WARNING: This is a destructive operation that cannot be undone.
   */
  async discardChanges(
    workspacePath: string,
    paths: string[],
  ): Promise<GitDiscardResult> {
    try {
      this.validatePaths(paths);
      // One lock scope for the two status reads AND the writes: a write
      // landing between classification and discard would be discarded blind.
      return await this.writeLock.run(workspacePath, () =>
        this.discardClassified(workspacePath, paths),
      );
    } catch (error) {
      const outcome = thrownOutcome(error);
      this.logger.error('[GitInfoService] discardChanges failed', {
        workspacePath,
        paths,
        error: outcome.error,
      } as unknown as Error);
      return outcome;
    }
  }

  /** `discardChanges`' locked body: classify, then checkout/restore/clean. */
  private async discardClassified(
    workspacePath: string,
    paths: string[],
  ): Promise<GitDiscardResult> {
    const classified = await this.classifyForDiscard(workspacePath, paths);
    if ('error' in classified) return { success: false, ...classified };
    const { trackedPaths, renamePaths, untrackedPaths } = classified;

    const steps: Array<[string[], string[], string]> = [
      [['checkout'], trackedPaths, 'Failed to discard tracked file changes'],
      [
        ['restore', '--staged', '--worktree', '--source=HEAD'],
        renamePaths,
        'Failed to discard staged renames',
      ],
      [['clean', '-f'], untrackedPaths, 'Failed to remove untracked files'],
    ];
    if (untrackedPaths.length > 0) {
      this.logger.warn(
        '[GitInfoService] Removing untracked files via git clean (irreversible)',
        { workspacePath, paths: untrackedPaths } as unknown as Error,
      );
    }
    for (const [command, stepPaths, fallback] of steps) {
      if (stepPaths.length === 0) continue;
      const outcome = writeOutcome(
        await this.writeLock.execWrite(
          [...command, '--', ...stepPaths],
          workspacePath,
        ),
        fallback,
      );
      if (!outcome.success) return outcome;
    }
    return { success: true };
  }

  /**
   * Split `paths` into checkout, staged-rename (`origPath, path` pairs) and
   * clean sets. A pathspec hides a rename whose other side it does not name —
   * the UI sends only the new path, which then reads as a staged add — so a
   * staged add is looked up once in the unfiltered, tracked-only status.
   * Either read failing fails the whole discard before anything is touched:
   * without the rename's source, `checkout` would "succeed" doing nothing.
   */
  private async classifyForDiscard(
    workspacePath: string,
    paths: string[],
  ): Promise<
    | {
        trackedPaths: string[];
        renamePaths: string[];
        untrackedPaths: string[];
      }
    | { error: string; code: GitMutationFailureCode }
  > {
    const readFailure = (stderr: string, exitCode: number) => {
      this.logger.warn(
        `[GitInfoService] discard status read failed for ${workspacePath} (exit ${exitCode}): ${stderr.trim()}`,
      );
      return isIndexLockFailure(stderr)
        ? { code: 'LOCKED' as const, error: GIT_LOCKED_MESSAGE }
        : { code: 'GIT_ERROR' as const, error: DISCARD_STATUS_FAILED };
    };
    const status = await this.execGit(
      [...STATUS_Z, '--untracked-files=all', '--', ...paths],
      workspacePath,
    );
    if (status.exitCode !== 0) {
      return readFailure(status.stderr, status.exitCode);
    }
    const tracked = new Set<string>();
    const untracked = new Set<string>();
    const stagedAdds = new Set<string>();
    for (const file of parseStatusV2Z(status.stdout).files) {
      if (file.status === '!') continue; // ignored: never a change
      if (file.status === '??') untracked.add(file.path);
      else tracked.add(file.path);
      if (file.staged && (file.status === 'A' || file.status === 'R')) {
        stagedAdds.add(file.path);
      }
    }
    const renamePaths: string[] = [];
    if (stagedAdds.size > 0) {
      const all = await this.execGit(
        [...STATUS_Z, '--untracked-files=no'],
        workspacePath,
        { maxOutputBytes: GIT_STATUS_MAX_OUTPUT_BYTES },
      );
      if (all.exitCode !== 0) return readFailure(all.stderr, all.exitCode);
      for (const file of parseStatusV2Z(all.stdout).files) {
        if (
          file.staged &&
          file.status === 'R' &&
          file.origPath &&
          stagedAdds.has(file.path)
        ) {
          renamePaths.push(file.origPath, file.path);
          // `restore` also resets any worktree edit on the renamed path.
          tracked.delete(file.path);
          tracked.delete(file.origPath);
        }
      }
    }
    return {
      trackedPaths: [...tracked],
      renamePaths,
      untrackedPaths: [...untracked],
    };
  }

  /**
   * Create a commit: `git commit -m <message>`, hooks included, with
   * {@link GIT_HOOK_TIMEOUT_MS} to finish. A non-zero exit with a commit hook
   * installed is `HOOK_FAILED` carrying the hook's output verbatim; a commit
   * Ptah stopped is `TIMEOUT` / `CANCELLED`, after which its own leftover
   * `index.lock` is recovered (see `GitCommitRunner`). The hash and
   * subject are read back from git, never parsed from its chatter.
   */
  async commit(
    workspacePath: string,
    message: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<GitCommitResult> {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return { success: false, error: 'Commit message cannot be empty' };
    }
    if (options.signal?.aborted) {
      return { success: false, code: 'CANCELLED', error: 'Commit cancelled.' };
    }
    try {
      return await this.writeLock.run(workspacePath, () =>
        this.commitRunner.run(workspacePath, trimmedMessage, options.signal),
      );
    } catch (error) {
      const outcome = thrownOutcome(error);
      this.logger.error('[GitInfoService] commit failed', {
        workspacePath,
        error: outcome.error,
      } as unknown as Error);
      return outcome;
    }
  }

  /** Push, pull and fetch: see {@link GitRemoteSync} (pull is locked). */
  push(workspacePath: string): Promise<GitPushResult> {
    return this.remoteSync.push(workspacePath);
  }

  pull(workspacePath: string): Promise<GitPullResult> {
    return this.remoteSync.pull(workspacePath);
  }

  fetch(workspacePath: string): Promise<GitFetchResult> {
    return this.remoteSync.fetch(workspacePath);
  }

  /**
   * Show file content from HEAD.
   * Runs: git show HEAD:<relativePath>
   * Returns empty content for new/untracked files.
   */
  async showFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<GitShowFileResult> {
    try {
      if (!relativePath || !relativePath.trim()) {
        return { content: '' };
      }

      this.validatePathSegment(relativePath);

      const { stdout, exitCode } = await this.execGit(
        ['show', `HEAD:${relativePath}`],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { content: '' };
      }

      return { content: stdout };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] showFile failed', {
        workspacePath,
        relativePath,
        error: message,
      } as unknown as Error);
      return { content: '' };
    }
  }

  /**
   * Read one side of a diff — the blob at `<rev>:<relativePath>`.
   *
   * `rev` is the revision half of a git object spec: `'HEAD'` for the last
   * commit, `''` for the index.
   *
   * Unlike {@link showFile}, a failed read is never flattened to empty
   * content. "The path does not exist at this revision" (`absent`) and "the
   * read could not be performed" (`error`) are distinct outcomes, because
   * rendering the second as the first is what makes a genuinely-empty tracked
   * file indistinguishable from a brand-new one.
   *
   * Classification is by exit code, never by message text — git's stderr
   * wording is localized, and `git show` exits 128 both for a missing path and
   * for a broken repository.
   *
   * ```
   * git show <rev>:<path>        (stopped past GIT_DIFF_MAX_SIDE_BYTES)
   *   past cap  -> 'too-large', size from `git cat-file -s`
   *   exit 0    -> classifyBlobBytes: 'lfs-pointer', 'binary' or 'content'
   *   exit 128  -> git rev-parse --verify --quiet <rev>:<path>
   *                  exit 0     -> 'error'/'submodule' (a gitlink: the spec
   *                                resolves, but to a commit, not a blob)
   *                  exit 1     -> 'absent'
   *                  otherwise  -> 'error', classified by pre-flight probes
   *   other     -> git rev-parse --verify --quiet <rev>:<path>
   *                  exit 1     -> 'absent'
   *                  otherwise  -> 'error', classified by pre-flight probes
   * ```
   *
   * Note on the probe command: the plan specified `git cat-file -e`, but that
   * exits **128** (not 1) for a missing path on current git — it only reports
   * 1 for a bare object name. `rev-parse --verify --quiet` yields the exact
   * 0 / 1 / 128 partition the ladder needs.
   *
   * Costs zero extra spawns on the happy path.
   */
  async readBlob(
    workspacePath: string,
    rev: string,
    relativePath: string,
  ): Promise<GitBlobRead> {
    this.validatePathSegment(relativePath);
    const spec = `${rev}:${relativePath}`;

    try {
      // Capped at the per-side limit: a bigger blob is never shipped, so its
      // bytes are not worth reading. Past the cap git is stopped and the side
      // becomes `too-large`.
      const show = await this.execGitBuffer(['show', spec], workspacePath, {
        maxOutputBytes: GIT_DIFF_MAX_SIDE_BYTES,
      });

      if (show.exitCode === 0) return classifyBlobBytes(show.stdout);

      const probe = await this.execGit(
        ['rev-parse', '--verify', '--quiet', spec],
        workspacePath,
      );

      if (probe.exitCode === 1) {
        return { outcome: 'absent' };
      }

      // A gitlink. `git show` exits 128 because the entry resolves to a commit
      // object rather than a blob, while `rev-parse --verify` on the very same
      // spec exits 0 because that commit is a perfectly good object. That pair
      // is what separates a submodule from a missing or unreadable blob, and
      // the ladder already has both halves — no extra spawn, no message
      // sniffing.
      if (show.exitCode === 128 && probe.exitCode === 0) {
        return this.gitReadError('submodule', relativePath);
      }

      // Raw stderr and the absolute workspace path stay in the log; only a
      // code and a workspace-relative message cross the RPC boundary.
      this.logger.error('[GitInfoService] readBlob failed', {
        workspacePath,
        rev,
        relativePath,
        showExitCode: show.exitCode,
        revParseExitCode: probe.exitCode,
        stderr: show.stderr,
      } as unknown as Error);

      return this.gitReadError(
        await this.probeReadErrorCode(workspacePath),
        relativePath,
      );
    } catch (error: unknown) {
      if (error instanceof GitOutputLimitError) {
        return {
          outcome: 'too-large',
          byteLength: await this.blobSize(
            workspacePath,
            spec,
            error.limitBytes,
          ),
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] readBlob threw', {
        workspacePath,
        rev,
        relativePath,
        error: message,
      } as unknown as Error);
      return this.gitReadError(this.classifyExecError(error), relativePath);
    }
  }

  /**
   * The HEAD side of a file for a read-only diff view: `git show
   * <HEAD sha>:<path>`, capped at `GIT_DIFF_MAX_SIDE_BYTES` like
   * {@link readBlob} (past it the side is `too-large`). On an unborn branch
   * HEAD is the empty tree, so every path is `absent`. Rejects an invalid
   * path before spawning git, as {@link readBlob} does.
   */
  async readHeadText(
    workspacePath: string,
    relativePath: string,
  ): Promise<GitBlobRead> {
    this.validatePathSegment(relativePath);
    let head: string | null;
    try {
      head = await this.resolveHeadSha(workspacePath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        '[GitInfoService] readHeadText could not resolve HEAD',
        {
          workspacePath,
          relativePath,
          error: message,
        } as unknown as Error,
      );
      return this.gitReadError(this.classifyExecError(error), relativePath);
    }
    return this.readBlob(workspacePath, head ?? EMPTY_TREE_SHA, relativePath);
  }

  /**
   * Line counts against HEAD (the empty tree on an unborn branch) for the
   * paths one agent turn changed, untracked files included. Every requested
   * path gets an entry; a count git could not produce is `null` with `binary`
   * unset, which the change-set recorder reports as counts unavailable. Pass
   * a rename's `origPath` too, or git sees only the added side.
   */
  readChangeSetNumstat(
    workspacePath: string,
    paths: readonly string[],
  ): Promise<Map<string, ChangeSetLineCounts>> {
    return this.changeSetNumstat.read(workspacePath, paths);
  }

  /**
   * Byte size of the blob at `spec`, read only after `git show` passed the
   * per-side cap. When git cannot say, `atLeast` (the cap that was passed) is
   * the honest lower bound.
   */
  private async blobSize(
    workspacePath: string,
    spec: string,
    atLeast: number,
  ): Promise<number> {
    try {
      const { stdout, exitCode } = await this.execGit(
        ['cat-file', '-s', spec],
        workspacePath,
      );
      const size = Number(stdout.trim());
      return exitCode === 0 && Number.isSafeInteger(size) && size > atLeast
        ? size
        : atLeast;
    } catch {
      // degradation-audit: optional-capability - only the reported size is
      // less precise; the side is still refused as too large.
      return atLeast;
    }
  }

  /**
   * Resolve both sides of a file diff for one of the two Source Control rows.
   *
   * Side resolution is derived from whether each side's object actually
   * exists, not from a parsed status code, so every row of the design's
   * resolution table falls out of the same two reads:
   *
   * | status        | comparison | originalRef      | modifiedRef |
   * |---------------|------------|------------------|-------------|
   * | `M` unstaged  | worktree   | index            | worktree    |
   * | `M` staged    | staged     | commit(HEAD)     | index       |
   * | `??` untracked| worktree   | absent           | worktree    |
   * | `A` staged    | staged     | absent           | index       |
   * | `D` unstaged  | worktree   | index            | absent      |
   * | `D` staged    | staged     | commit(HEAD)     | absent      |
   * | `R` staged    | staged     | commit @ origPath| index       |
   * | no commits    | staged     | absent           | index       |
   *
   * `HEAD ↔ worktree` is deliberately not offered: it maps to no UI row.
   * A worktree deletion's original side is the **index**, not HEAD — the two
   * coincide only when nothing is staged.
   */
  async diffFile(
    workspacePath: string,
    request: DiffFileRequest,
    fileReader: WorktreeFileReader,
  ): Promise<GitDiffFileResult> {
    const modifiedPath = request.path;
    const originalPath = request.originalPath ?? request.path;

    this.validatePathSegment(modifiedPath);
    this.validatePathSegment(originalPath);

    const comparison = request.comparison;

    try {
      let original: GitBlobRead;
      let originalRef: DiffSideRef;
      let modified: GitBlobRead;
      let modifiedRef: DiffSideRef;

      if (comparison === 'staged') {
        const headSha = await this.resolveHeadSha(workspacePath);
        if (headSha === null) {
          // Repository with zero commits: HEAD does not resolve, so the
          // original side is genuinely absent rather than unreadable.
          original = { outcome: 'absent' };
          originalRef = { kind: 'absent' };
        } else {
          original = await this.readBlob(workspacePath, 'HEAD', originalPath);
          originalRef =
            original.outcome === 'absent'
              ? { kind: 'absent' }
              : { kind: 'commit', sha: headSha };
        }

        modified = await this.readBlob(workspacePath, '', modifiedPath);
        modifiedRef =
          modified.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'index' };
      } else {
        original = await this.readBlob(workspacePath, '', originalPath);
        originalRef =
          original.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'index' };

        modified = await this.readWorktreeBlob(
          workspacePath,
          modifiedPath,
          fileReader,
        );
        modifiedRef =
          modified.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'worktree' };
      }

      // Read after both sides, so the token below covers the patch bytes that
      // were current at the *end* of this read rather than the start of it.
      // A side that is too large or a Git LFS pointer has no patch: its text
      // is not shipped, so there are no hunks to show or apply.
      const patch =
        isUnpatchable(original) || isUnpatchable(modified)
          ? null
          : await this.readPatch(
              workspacePath,
              comparison,
              modifiedPath,
              originalPath,
            );

      return {
        path: modifiedPath,
        originalPath,
        comparison,
        original,
        modified,
        originalRef,
        modifiedRef,
        patch,
        hunks: this.parseHunkRefs(patch),
        snapshotToken: this.computeSnapshotToken({
          comparison,
          path: modifiedPath,
          originalPath,
          originalRef,
          modifiedRef,
          original,
          modified,
          patch,
        }),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] diffFile failed', {
        workspacePath,
        path: modifiedPath,
        originalPath,
        comparison,
        error: message,
      } as unknown as Error);

      const failure = this.gitReadError(
        this.classifyExecError(error),
        modifiedPath,
      );
      const absent: DiffSideRef = { kind: 'absent' };

      return {
        path: modifiedPath,
        originalPath,
        comparison,
        original: failure,
        modified: failure,
        originalRef: absent,
        modifiedRef: absent,
        patch: null,
        hunks: [],
        snapshotToken: this.computeSnapshotToken({
          comparison,
          path: modifiedPath,
          originalPath,
          originalRef: absent,
          modifiedRef: absent,
          original: failure,
          modified: failure,
          patch: null,
        }),
      };
    }
  }

  /**
   * git's own unified diff for one comparison of one path, verbatim.
   *
   * Returns `null` when git produced nothing — an untracked file (which
   * `git diff` does not report at all), an unchanged path, or a failed
   * invocation. `null` is what makes "there are no hunks to select" a first
   * class outcome instead of an empty-string special case.
   *
   * **A staged rename must be asked for by BOTH paths.** With only the
   * post-rename pathspec, git loses the rename pairing and emits a
   * `new file mode` block whose every line is an addition — the exact
   * "fabricated whole-file addition" hazard A3 exists to prevent, except
   * arriving through the patch rather than through a failed read. Verified
   * against git 2.54.0.
   */
  private async readPatch(
    workspacePath: string,
    comparison: GitDiffComparison,
    modifiedPath: string,
    originalPath: string,
  ): Promise<string | null> {
    const pathspec =
      originalPath === modifiedPath
        ? [modifiedPath]
        : [originalPath, modifiedPath];

    const args = [
      'diff',
      ...(comparison === 'staged' ? ['--cached'] : []),
      ...DIFF_FLAGS,
      '--',
      ...pathspec,
    ];

    const { stdout, stderr, exitCode } = await this.execGit(
      args,
      workspacePath,
    );

    if (exitCode !== 0) {
      this.logger.error('[GitInfoService] readPatch failed', {
        workspacePath,
        comparison,
        modifiedPath,
        originalPath,
        exitCode,
        stderr,
      } as unknown as Error);
      return null;
    }

    return stdout.length > 0 ? stdout : null;
  }

  /**
   * Split a patch into its file-header block and its hunk blocks, preserving
   * every byte.
   *
   * Segments retain their `\n` terminator, so concatenating any subset of them
   * yields a well-formed patch. Splitting on `\n` and re-joining does NOT:
   * the terminator of every block except the last is silently dropped, and
   * `git apply` answers `corrupt patch at <stdin>:N`. That failure was
   * reproduced against real git before this helper was written.
   *
   * A trailing `\n` is added when absent so the invariant holds unconditionally.
   * This never changes meaning: "the file has no final newline" is carried by
   * the `\ No newline at end of file` marker line, not by the patch stream's
   * own termination.
   */
  private splitPatch(patch: string): { header: string; hunks: string[] } {
    const normalized = patch.endsWith('\n') ? patch : `${patch}\n`;
    const segments = normalized.match(/[^\n]*\n/g) ?? [];

    const header: string[] = [];
    const hunks: string[][] = [];
    let current: string[] | null = null;

    for (const segment of segments) {
      if (HUNK_HEADER_RE.test(segment)) {
        current = [segment];
        hunks.push(current);
      } else if (current) {
        // Body lines, and any `\ No newline at end of file` marker, belong to
        // the hunk they follow.
        current.push(segment);
      } else {
        header.push(segment);
      }
    }

    return {
      header: header.join(''),
      hunks: hunks.map((lines) => lines.join('')),
    };
  }

  /** Parse the `@@` headers of a patch. Positions only — never the bodies. */
  private parseHunkRefs(patch: string | null): GitHunkRef[] {
    if (patch === null) return [];

    return this.splitPatch(patch).hunks.map((block, index) => {
      const headerLine = block.slice(0, block.indexOf('\n'));
      const match = HUNK_HEADER_RE.exec(headerLine);
      // Unreachable: splitPatch only opens a block on a line this matches.
      /* istanbul ignore next */
      if (!match) {
        throw new Error(`Unparseable hunk header: ${headerLine}`);
      }
      return {
        index,
        originalStart: Number(match[1]),
        // git omits `,b` when the side spans exactly one line.
        originalLines: match[2] === undefined ? 1 : Number(match[2]),
        modifiedStart: Number(match[3]),
        modifiedLines: match[4] === undefined ? 1 : Number(match[4]),
        header: headerLine,
      };
    });
  }

  /**
   * Apply a selection of hunks from the diff the user is looking at.
   *
   * **git generates the patch and git consumes the patch.** Nothing here
   * composes diff text: the selected `@@` blocks are copied byte for byte out
   * of `git diff`'s own output, hunk headers included. Later hunks therefore
   * carry `+`-side start lines that are stale relative to a partially applied
   * file; that is correct and deliberate — `git apply` resolves them by
   * context, exactly as `git add -p` does. `--recount` and `--unidiff-zero`
   * are consequently NOT passed, and there is no line-ending code of our own:
   * `git diff` emits in index (LF) space and `git apply` converts back on the
   * way out, which is what makes this safe under `core.autocrlf`.
   *
   * | comparison | operation | apply invocation          |
   * | ---------- | --------- | ------------------------- |
   * | `worktree` | `stage`   | `git apply --cached -`    |
   * | `worktree` | `revert`  | `git apply -R -`          |
   * | `staged`   | `unstage` | `git apply --cached -R -` |
   *
   * Every refusal below happens before the user's selection is written, and
   * every failure path from the restore point onwards puts the pre-operation
   * state back (AC7) — including the pre-write offset guard, which is only
   * reachable when someone else wrote to the repository in the meantime.
   */
  async applyHunks(
    workspacePath: string,
    request: ApplyHunksRequest,
    fileSystem: WorktreeFileAccess,
  ): Promise<GitApplyHunksResult> {
    try {
      // The whole ladder — snapshot, restore point, check, apply, verify,
      // rollback — is one lock scope; every step is awaited inside it.
      return await this.writeLock.run(workspacePath, () =>
        this.applyHunksLocked(workspacePath, request, fileSystem),
      );
    } catch (error: unknown) {
      this.logger.error('[GitInfoService] applyHunks could not take the lock', {
        workspaceRoot: workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.applyFailure(
        'UNKNOWN',
        'The selected changes could not be applied.',
      );
    }
  }

  private async applyHunksLocked(
    workspacePath: string,
    request: ApplyHunksRequest,
    fileSystem: WorktreeFileAccess,
  ): Promise<GitApplyHunksResult> {
    const modifiedPath = request.path;
    const originalPath = request.originalPath ?? request.path;
    const { comparison, operation } = request;

    try {
      // [NFR-8] Both paths, not just the modified one — a staged rename is
      // read and applied under its pre-rename path as well.
      this.validatePathSegment(modifiedPath);
      this.validatePathSegment(originalPath);

      // [AC12] The matrix is enforced here, not only in the Zod schema: the
      // schema can prove `operation` is one of three strings, but only this
      // check knows that `unstage` is meaningless against a worktree diff.
      if (!VALID_OPERATIONS[comparison].includes(operation)) {
        return this.applyFailure(
          'INVALID_OPERATION',
          `"${operation}" is not available for ${comparison} changes.`,
        );
      }

      if (!(await this.isGitRepo(workspacePath))) {
        return this.applyFailure(
          'NOT_A_REPO',
          'This folder is not a git repository.',
        );
      }

      // [AC6] The one guard this whole batch turns on.
      //
      // The snapshot is re-derived by calling `diffFile` — the very method
      // that issued the client's token — so there is no second hashing
      // implementation that could drift from the first and quietly certify a
      // stale diff. The client's token is compared, never trusted, and never
      // cached: two calls to `diffFile` a millisecond apart re-read git both
      // times.
      const before = await this.diffFile(
        workspacePath,
        {
          path: modifiedPath,
          comparison,
          originalPath: request.originalPath,
        },
        fileSystem,
      );

      if (before.snapshotToken !== request.snapshotToken) {
        this.logger.warn(
          '[GitInfoService] applyHunks refused a stale snapshot',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            clientToken: request.snapshotToken,
            currentToken: before.snapshotToken,
          },
        );
        return this.applyFailure(
          'STALE_SNAPSHOT',
          'This file changed since the diff was opened. Nothing was changed — reload the diff and try again.',
        );
      }

      if (before.patch === null || before.hunks.length === 0) {
        // [AC10] Binary is the expected reason for a hunkless diff, but not
        // the only one: an untracked file produces no `git diff` output at
        // all, and calling that "binary" would be a user-visible lie.
        // A side too large to ship, or a Git LFS pointer, is refused the
        // same way: there is no text to select hunks from.
        if (isUnpatchable(before.original) || isUnpatchable(before.modified)) {
          return this.applyFailure(
            'BINARY_UNSUPPORTED',
            'Files that are too large or stored in Git LFS have no hunks to stage or revert.',
          );
        }
        const isBinary =
          before.original.outcome === 'binary' ||
          before.modified.outcome === 'binary' ||
          (before.patch !== null && BINARY_PATCH_MARKER.test(before.patch));

        return isBinary
          ? this.applyFailure(
              'BINARY_UNSUPPORTED',
              'Binary files have no hunks to stage or revert.',
            )
          : this.applyFailure(
              'APPLY_FAILED',
              'git reports no applicable changes for this file.',
            );
      }

      const selection = this.normalizeHunkSelection(
        request.hunkIndices,
        before.hunks.length,
      );
      if (selection === null) {
        return this.applyFailure(
          'APPLY_FAILED',
          'The selected hunks are not part of this diff.',
        );
      }

      const { header, hunks } = this.splitPatch(before.patch);

      // A pathspec naming one file (or a rename's two names) yields exactly
      // one `diff --git` block. Anything else means the patch is not the shape
      // the reassembly assumes, so refuse rather than guess which block the
      // ordinals index into.
      const fileBlocks = header.match(/^diff --git /gm)?.length ?? 0;
      if (fileBlocks !== 1) {
        this.logger.error(
          '[GitInfoService] applyHunks got an unexpected patch shape',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            originalPath,
            comparison,
            fileBlocks,
          },
        );
        return this.applyFailure(
          'UNKNOWN',
          'This diff cannot be applied hunk by hunk.',
        );
      }

      // Ascending order is required by `git apply`, and `normalizeHunkSelection`
      // guarantees it.
      const patch = header + selection.map((index) => hunks[index]).join('');
      const applyArgs = this.applyArgsFor(operation);
      const worktreeFile = path.join(workspacePath, modifiedPath);

      // [AC7] Establish the restore point BEFORE the dry run, so there is no
      // ordering in which a write can happen without one.
      let indexRestoreTree: string | null = null;
      let worktreeRestoreBytes: Uint8Array | null = null;

      if (operation === 'revert') {
        if (!(await fileSystem.exists(worktreeFile))) {
          return this.applyFailure(
            'APPLY_FAILED',
            'This file is no longer in the working tree.',
          );
        }
        worktreeRestoreBytes = await fileSystem.readFileBytes(worktreeFile);
      } else {
        indexRestoreTree = await this.writeIndexTree(workspacePath);
        if (indexRestoreTree === null) {
          return this.applyFailure(
            'APPLY_FAILED',
            'Could not create a restore point for the index. Nothing was changed.',
          );
        }
      }

      // [AC7] Dry run first. `--verbose` is not cosmetic: it is the only mode
      // in which git reports the line offset a hunk matched at, and that
      // report is the next guard.
      const check = await this.execGit(
        [...applyArgs, '--check', '--verbose', '-'],
        workspacePath,
        { stdin: patch },
      );

      if (check.exitCode !== 0) {
        this.logger.error(
          '[GitInfoService] applyHunks --check refused the patch',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            exitCode: check.exitCode,
            stderr: check.stderr,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          'git could not apply the selected changes. Nothing was changed.',
        );
      }

      // The catastrophic case this batch exists to prevent is not a patch that
      // FAILS to apply — it is one that applies cleanly at a shifted offset,
      // moving lines the user never looked at. `--check` alone returns 0 for
      // exactly that case (reproduced against git 2.54.0). With the snapshot
      // token verified above, a non-zero offset is impossible; if one appears
      // anyway, an invariant has broken and the only safe move is to refuse
      // before writing the user's selection.
      //
      // `--check` is a dry run, so *this service* has written nothing — but the
      // only way to reach here is an external write landing between the token
      // match and the dry run, and that write is still on disk. Restoring is
      // what makes the message below true about the FILE and not merely about
      // our own actions; guard 3 below has always done the same.
      const checkOffsets = this.parseApplyOffsets(check.stderr);
      if (checkOffsets.some((offset) => offset !== 0)) {
        const restored = await this.restoreAfterFailedApply(
          workspacePath,
          worktreeFile,
          indexRestoreTree,
          worktreeRestoreBytes,
          fileSystem,
        );
        this.logger.error(
          '[GitInfoService] applyHunks refused an offset match',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            offsets: checkOffsets,
            stderr: check.stderr,
            restored,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          restored
            ? 'The selected changes no longer line up with this file. The previous state was restored.'
            : 'The selected changes no longer line up with this file, and restoring the previous state also failed. Check the repository before continuing.',
        );
      }

      const applied = await this.applyWrite(
        [...applyArgs, '--verbose', '-'],
        workspacePath,
        { stdin: patch },
      );

      if (applied.exitCode !== 0) {
        const restored = await this.restoreAfterFailedApply(
          workspacePath,
          worktreeFile,
          indexRestoreTree,
          worktreeRestoreBytes,
          fileSystem,
        );
        this.logger.error(
          '[GitInfoService] applyHunks failed after --check passed',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            exitCode: applied.exitCode,
            stderr: applied.stderr,
            restored,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          restored
            ? 'git could not apply the selected changes. The file was restored to its previous state.'
            : 'git could not apply the selected changes, and restoring the previous state also failed. Check the repository before continuing.',
        );
      }

      // The dry run inspected the pre-image a moment ago; this re-checks the
      // one it was actually written against. An offset appearing only here
      // means the repository moved between the two invocations, so the write
      // landed somewhere the user never saw — undo it.
      const appliedOffsets = this.parseApplyOffsets(applied.stderr);
      if (appliedOffsets.some((offset) => offset !== 0)) {
        const restored = await this.restoreAfterFailedApply(
          workspacePath,
          worktreeFile,
          indexRestoreTree,
          worktreeRestoreBytes,
          fileSystem,
        );
        this.logger.error(
          '[GitInfoService] applyHunks rolled back an offset apply',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            offsets: appliedOffsets,
            stderr: applied.stderr,
            restored,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          restored
            ? 'The selected changes no longer line up with this file. The previous state was restored.'
            : 'The selected changes no longer line up with this file, and restoring the previous state also failed. Check the repository before continuing.',
        );
      }

      const after = await this.diffFile(
        workspacePath,
        {
          path: modifiedPath,
          comparison,
          originalPath: request.originalPath,
        },
        fileSystem,
      );

      // [R-1] Enough to reconstruct exactly what was applied, to which
      // snapshot, and what git said about it.
      this.logger.info('[GitInfoService] applyHunks applied', {
        workspaceRoot: workspacePath,
        path: modifiedPath,
        originalPath,
        comparison,
        operation,
        hunkIndices: selection,
        hunkCount: before.hunks.length,
        snapshotToken: request.snapshotToken,
        nextSnapshotToken: after.snapshotToken,
        patchSha256: createHash('sha256').update(patch, 'utf8').digest('hex'),
        patchByteLength: Buffer.byteLength(patch, 'utf8'),
        exitCode: applied.exitCode,
        offsets: appliedOffsets,
        stderr: applied.stderr,
      });

      return { success: true, snapshotToken: after.snapshotToken };
    } catch (error: unknown) {
      if (error instanceof IndexLockedError) {
        return this.applyFailure(
          'APPLY_FAILED',
          `${GIT_LOCKED_MESSAGE} Nothing was changed.`,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] applyHunks threw', {
        workspaceRoot: workspacePath,
        path: modifiedPath,
        originalPath,
        comparison,
        operation,
        error: message,
      });
      return this.applyFailure(
        'UNKNOWN',
        'The selected changes could not be applied.',
      );
    }
  }

  /**
   * One index write of the applyHunks ladder. A lock another process kept
   * past every retry throws {@link IndexLockedError}: git took no lock, so
   * that write changed nothing (a rollback's `read-tree` reports it as a
   * failed restore instead).
   */
  private async applyWrite(
    args: string[],
    workspacePath: string,
    options?: ExecGitOptions,
  ): Promise<ExecGitResult> {
    const run = await this.writeLock.execWrite(args, workspacePath, options);
    if (run.code === 'LOCKED') throw new IndexLockedError(run.message);
    return run;
  }

  /** A refusal. Never carries a snapshot token — see {@link GitApplyHunksResult}. */
  private applyFailure(
    code: GitApplyHunksFailure,
    message: string,
  ): GitApplyHunksResult {
    return { success: false, code, message };
  }

  /** The `git apply` invocation for one cell of the operation matrix. */
  private applyArgsFor(operation: GitApplyHunksOperation): string[] {
    switch (operation) {
      case 'stage':
        return ['apply', '--cached'];
      case 'unstage':
        return ['apply', '--cached', '-R'];
      case 'revert':
        return ['apply', '-R'];
    }
  }

  /**
   * De-duplicate and order a hunk selection, or reject it.
   *
   * Ascending order is a hard requirement of `git apply`, not a tidiness
   * preference. An out-of-range ordinal cannot occur once the snapshot token
   * has matched — the patch is provably the same one the client indexed — so
   * it is treated as an incoherent request and refused.
   */
  private normalizeHunkSelection(
    indices: number[],
    total: number,
  ): number[] | null {
    if (indices.length === 0) return null;
    const unique = [...new Set(indices)];
    if (
      unique.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= total,
      )
    ) {
      return null;
    }
    return unique.sort((a, b) => a - b);
  }

  /**
   * Capture the current index as a tree object, for use as a rollback target.
   *
   * `git write-tree` writes tree objects only — it never moves a ref, never
   * touches the working tree, and fails outright on an unmerged index, which
   * is the case where a rollback could not be honoured anyway.
   */
  private async writeIndexTree(workspacePath: string): Promise<string | null> {
    const { stdout, stderr, exitCode } = await this.applyWrite(
      ['write-tree'],
      workspacePath,
    );

    if (exitCode !== 0) {
      this.logger.error('[GitInfoService] write-tree failed', {
        workspacePath,
        exitCode,
        stderr,
      });
      return null;
    }

    const tree = stdout.trim();
    return /^[0-9a-f]{40,64}$/.test(tree) ? tree : null;
  }

  /** Restore the pre-operation state after a write that failed mid-flight. */
  private async restoreAfterFailedApply(
    workspacePath: string,
    worktreeFile: string,
    indexRestoreTree: string | null,
    worktreeRestoreBytes: Uint8Array | null,
    fileSystem: WorktreeFileAccess,
  ): Promise<boolean> {
    try {
      if (indexRestoreTree !== null) {
        const { exitCode, stderr } = await this.applyWrite(
          ['read-tree', indexRestoreTree],
          workspacePath,
        );
        if (exitCode !== 0) {
          this.logger.error('[GitInfoService] index rollback failed', {
            workspacePath,
            tree: indexRestoreTree,
            exitCode,
            stderr,
          });
          return false;
        }
        return true;
      }

      if (worktreeRestoreBytes !== null) {
        await fileSystem.writeFileBytes(worktreeFile, worktreeRestoreBytes);
        return true;
      }

      return false;
    } catch (error: unknown) {
      this.logger.error('[GitInfoService] rollback threw', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Every line offset `git apply --verbose` reported, in order.
   *
   * Plain `git apply` says nothing about offsets, so a forensic log that never
   * passes `--verbose` records an empty list forever and proves nothing.
   */
  private parseApplyOffsets(stderr: string): number[] {
    return [...stderr.matchAll(APPLY_OFFSET_RE)].map((match) =>
      Number(match[1]),
    );
  }

  /**
   * Read the working-tree side of a diff through the platform file system
   * port. A missing file is `absent` — that is what makes a deleted file
   * render as a diff instead of raising an error.
   */
  private async readWorktreeBlob(
    workspacePath: string,
    relativePath: string,
    fileReader: WorktreeFileReader,
  ): Promise<GitBlobRead> {
    const absolutePath = path.join(workspacePath, relativePath);

    try {
      if (!(await fileReader.exists(absolutePath))) {
        return { outcome: 'absent' };
      }

      // Stat first so an oversized file is never read into memory.
      const size = await readStat(absolutePath).then(
        (stats) => (stats.isFile() ? stats.size : null),
        // A path node cannot stat (a virtual file system behind the port):
        // it is read through the port and classified by its bytes instead.
        () => null,
      );
      if (size !== null && size > GIT_DIFF_MAX_SIDE_BYTES) {
        return { outcome: 'too-large', byteLength: size };
      }

      const bytes = await fileReader.readFileBytes(absolutePath);
      return classifyBlobBytes(
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] worktree read failed', {
        workspacePath,
        relativePath,
        error: message,
      } as unknown as Error);
      return this.gitReadError(this.classifyExecError(error), relativePath);
    }
  }

  /**
   * Full SHA of HEAD, or null when HEAD does not resolve (repository with no
   * commits, or an unborn branch). Rejections propagate — a missing git binary
   * must not be misreported as "no commits".
   */
  private async resolveHeadSha(workspacePath: string): Promise<string | null> {
    const { stdout, exitCode } = await this.execGit(
      ['rev-parse', '--verify', '--quiet', 'HEAD'],
      workspacePath,
    );
    if (exitCode !== 0) return null;
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  }

  /**
   * Pre-flight probes, run only once a read has already failed, to turn an
   * opaque non-zero exit into a specific cause.
   */
  private async probeReadErrorCode(
    workspacePath: string,
  ): Promise<GitReadErrorCode> {
    try {
      if (!(await this.isGitRepo(workspacePath))) return 'not-a-repo';
      if ((await this.resolveHeadSha(workspacePath)) === null) {
        return 'no-commits';
      }
      return 'unknown';
    } catch (error: unknown) {
      return this.classifyExecError(error);
    }
  }

  /** Map a thrown spawn/timeout failure onto a read error code. */
  private classifyExecError(error: unknown): GitReadErrorCode {
    if (!(error instanceof Error)) return 'unknown';
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'git-missing';
    // An untracked *directory* row is clickable in Source Control, and its
    // worktree side reads the directory itself. Node answers `EISDIR`; the VS
    // Code file-system port answers `FileIsADirectory` for the same thing.
    // Without this the row reports only that the read failed, never why.
    if (code === 'EISDIR' || code === 'FileIsADirectory') {
      return 'is-a-directory';
    }
    if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
    if (/timed out after \d+ms/.test(error.message)) return 'timeout';
    return 'unknown';
  }

  /**
   * Build the user-facing failure payload. The message carries the
   * workspace-relative path and the code and nothing else — never stderr,
   * never an absolute path.
   */
  private gitReadError(
    code: GitReadErrorCode,
    relativePath: string,
  ): GitBlobRead {
    return {
      outcome: 'error',
      code,
      message: `Could not read "${relativePath}" from git (${code}).`,
    };
  }

  /**
   * sha256 over the exact content of both sides, their ref identity, and the
   * patch bytes derived from them.
   *
   * Every component is length-prefixed so no combination of paths or content
   * can be rearranged into the same digest. Opaque to the client; it exists so
   * a later write can prove it applies to the snapshot the user was shown.
   *
   * **There is exactly one implementation and it has exactly two call sites,
   * both inside {@link diffFile}.** `applyHunks` establishes its "is this
   * still the snapshot the user saw?" answer by calling `diffFile` itself, not
   * by recomputing the digest alongside it — so the two can never drift, which
   * is the failure that would silently defeat AC6.
   *
   * The patch field is what closes the residual window between reading the two
   * sides and asking git for the diff: without it a token could certify blobs
   * from time T while the patch was generated at T+delta, and a write landing
   * in that gap would be applied from bytes the user never saw.
   */
  private computeSnapshotToken(input: {
    comparison: GitDiffComparison;
    path: string;
    originalPath: string;
    originalRef: DiffSideRef;
    modifiedRef: DiffSideRef;
    original: GitBlobRead;
    modified: GitBlobRead;
    patch: string | null;
  }): string {
    const hash = createHash('sha256');
    const field = (value: string): void => {
      hash.update(`${Buffer.byteLength(value, 'utf8')}\0`, 'utf8');
      hash.update(value, 'utf8');
    };

    field(input.comparison);
    field(input.originalPath);
    field(input.path);
    field(this.describeRef(input.originalRef));
    field(this.describeRef(input.modifiedRef));
    field(this.describeBlob(input.original));
    field(this.describeBlob(input.modified));
    field(input.patch === null ? 'patch:absent' : `patch:${input.patch}`);

    return hash.digest('hex');
  }

  private describeRef(ref: DiffSideRef): string {
    return ref.kind === 'commit' ? `commit:${ref.sha}` : ref.kind;
  }

  private describeBlob(blob: GitBlobRead): string {
    switch (blob.outcome) {
      case 'content':
        return `content:${blob.content}`;
      case 'binary':
        return `binary:${blob.byteLength}`;
      case 'too-large':
        return `too-large:${blob.byteLength}`;
      case 'lfs-pointer':
        return `lfs-pointer:${blob.oid}:${blob.size}`;
      case 'absent':
        return 'absent';
      case 'error':
        return `error:${blob.code}`;
    }
  }

  /**
   * Validate an array of paths: must be non-empty, no path traversal.
   * Throws on invalid input.
   */
  private validatePaths(paths: string[]): void {
    if (!paths || paths.length === 0) {
      throw new Error('paths must be a non-empty array');
    }

    for (const p of paths) {
      this.validatePathSegment(p);
    }
  }

  /**
   * Validate a single path: must be non-empty, no '..' segments.
   * Throws on invalid input.
   *
   * A traversal check only: it does not stop a value being read as a git
   * option (`-b`, `--output=/tmp/x` pass it). Paths go after `--`; refs go
   * through `assertSafeRef`/`assertSafeRevision` and `--end-of-options`.
   */
  private validatePathSegment(filePath: string): void {
    if (!filePath || !filePath.trim()) {
      throw new Error('path must be a non-empty string');
    }
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (segments.some((s) => s === '..')) {
      throw new Error(
        `Path traversal detected: "${filePath}" contains '..' segments`,
      );
    }
  }

  /**
   * List local (and optionally remote) branches with ahead/behind counts.
   *
   * **One `for-each-ref` invocation, whatever the branch count.** Local and
   * remote refs are listed by the same command (told apart by `%(refname)`,
   * not by which command produced them), the current branch comes from
   * `%(HEAD)`, and ahead/behind come from `%(upstream:track)`.
   *
   * This replaced a per-branch `git rev-list --left-right --count` fan-out
   * (TASK_2026_343). The old code carried `%09%09` where it meant to carry
   * `%(ahead-behind:upstream)`, so that field was ALWAYS empty and every
   * upstream-tracking branch took the fallback — sequentially. Measured in
   * this repository (156 local branches, 113 with an upstream), 20 of those
   * spawns cost 4.1 s against 0.29 s for the single `for-each-ref` that now
   * replaces all of them.
   *
   * **`%(ahead-behind:upstream)` is deliberately NOT used.** Verified against
   * git 2.54: if any ref in the result set lacks an upstream, git aborts the
   * whole command with `fatal: failed to find 'upstream'`, and wrapping it in
   * `%(if)%(upstream)%(then)…%(end)` does not help because the atom resolves
   * before the conditional. `%(upstream:track)` is empty rather than fatal for
   * an untracked branch, and `exec-git` pins `LC_ALL=C` so its wording is
   * stable.
   *
   * Results are cached per `(workspacePath, includeRemote)` until
   * {@link invalidateReadCache} fires; concurrent identical calls share one
   * invocation.
   */
  async getBranches(
    workspacePath: string,
    includeRemote = false,
  ): Promise<GitBranchesResult> {
    return this.cachedRead(
      `branches|${workspacePath}|${includeRemote ? 'remote' : 'local'}`,
      workspacePath,
      () => this.computeBranches(workspacePath, includeRemote),
    );
  }

  /**
   * Tab-separated `for-each-ref` fields, in order.
   *
   * `%(HEAD)` is placed in the INTERIOR on purpose: it renders as a single
   * space for every non-current ref, and a leading or trailing space would be
   * eaten by the per-line `trim()`, silently shifting every field.
   */
  private static readonly BRANCH_REF_FORMAT = [
    '%(refname)',
    '%(refname:short)',
    '%(HEAD)',
    '%(objectname:short)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(creatordate:unix)',
  ].join('%09');

  private async computeBranches(
    workspacePath: string,
    includeRemote: boolean,
  ): Promise<GitBranchesResult> {
    const empty: GitBranchesResult = { current: '', local: [], remote: [] };
    try {
      const patterns = includeRemote
        ? ['refs/heads/', 'refs/remotes/']
        : ['refs/heads/'];
      const { stdout, exitCode } = await this.execGit(
        [
          'for-each-ref',
          `--format=${GitInfoService.BRANCH_REF_FORMAT}`,
          ...patterns,
        ],
        workspacePath,
      );

      if (exitCode !== 0) {
        return empty;
      }

      const local: BranchRef[] = [];
      const remote: BranchRef[] = [];
      let current = '';

      for (const line of stdout.split('\n')) {
        const parsed = this.parseBranchRefLine(line);
        if (!parsed) continue;
        if (parsed.isRemote) {
          remote.push(parsed);
        } else {
          local.push(parsed);
          if (parsed.isCurrent) current = parsed.name;
        }
      }

      // No ref carries `*` on an unborn branch (nothing to list yet) or a
      // detached HEAD. `symbolic-ref` answers the first and exits non-zero on
      // the second, which is the correct empty answer either way. One extra
      // spawn, only in those two states.
      if (!current) {
        const { stdout: symRefOut, exitCode: symRefCode } = await this.execGit(
          ['symbolic-ref', '--short', 'HEAD'],
          workspacePath,
        );
        if (symRefCode === 0) current = symRefOut.trim();
      }

      return { current, local, remote };
    } catch (error) {
      this.logger.error('[GitInfoService] getBranches failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return empty;
    }
  }

  /**
   * Parse one {@link GitInfoService.BRANCH_REF_FORMAT} line into a `BranchRef`.
   *
   * Local vs remote is decided by the FULL `%(refname)`, never by the short
   * name: a local branch may legitimately be called `origin/foo`, whose short
   * form is indistinguishable from a remote-tracking ref.
   */
  private parseBranchRefLine(line: string): BranchRef | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const parts = trimmed.split('\t');
    const fullRef = parts[0] ?? '';
    const name = parts[1] ?? '';
    const headMarker = parts[2] ?? '';
    const lastCommitHash = parts[3] ?? '';
    const upstream = parts[4] ?? '';
    const trackRaw = parts[5] ?? '';
    const creatorDateRaw = parts[6] ?? '';

    if (!name) return null;

    const isRemote = fullRef.startsWith('refs/remotes/');
    // `refs/remotes/<remote>/HEAD` is a symref onto the remote's default
    // branch, not a branch of its own.
    if (isRemote && name.endsWith('/HEAD')) return null;

    const { ahead, behind } = parseUpstreamTrack(trackRaw);

    const lastCommitTime = creatorDateRaw
      ? parseInt(creatorDateRaw, 10) * 1000
      : undefined;

    const ref: BranchRef = {
      name,
      isCurrent: !isRemote && headMarker === '*',
      isRemote,
      upstream: upstream || undefined,
      ahead,
      behind,
      lastCommitHash: lastCommitHash || undefined,
      lastCommitTime: isNaN(lastCommitTime ?? NaN) ? undefined : lastCommitTime,
    };

    if (isRemote) {
      const slashIdx = name.indexOf('/');
      if (slashIdx !== -1) {
        ref.remote = name.substring(0, slashIdx);
      }
    }

    return ref;
  }

  /**
   * Switch branches with `git switch` semantics (TASK_2026_576 RC9).
   *
   * - `createNew`: `switch -c <branch>` — local changes, untracked files
   *   included, are carried onto the new branch.
   * - otherwise git itself decides whether local changes block the switch
   *   (no `status --porcelain` pre-check). A refusal is reported as
   *   `{ dirty: true, conflictingPaths }` parsed from git's own list.
   * - `force`: `switch --discard-changes` (takes precedence over `stash`).
   * - `options.stash`: `stash push --include-untracked`, then switch. On
   *   success the entry's SHA is returned as `stashRef`; if the switch fails
   *   the entry is popped back, and if that pop fails too both errors are
   *   reported and the entry is kept.
   * - `options.track` with a remote-tracking ref `origin/x`: switch to local
   *   `x` when it exists, else `switch --track origin/x`. `git switch` never
   *   detaches HEAD without `--detach`, which is never passed.
   *
   * Security: `assertSafeRef(branch)` runs before any git operation, and the
   * branch is either `-c`'s bound value or follows `--end-of-options`.
   */
  async checkout(
    workspacePath: string,
    branch: string,
    createNew?: boolean,
    force?: boolean,
    options: Pick<GitCheckoutParams, 'stash' | 'track'> = {},
  ): Promise<GitCheckoutResult> {
    try {
      try {
        assertSafeRef(branch);
      } catch {
        return { success: false, error: 'Invalid branch name' };
      }

      return await this.writeLock.run(workspacePath, async () => {
        if (createNew) {
          return this.runSwitch(workspacePath, ['switch', '-c', branch]);
        }
        const target = options.track
          ? await this.resolveTrackTarget(workspacePath, branch)
          : ['--end-of-options', branch];
        if (force) {
          return this.runSwitch(
            workspacePath,
            ['switch', '--discard-changes', ...target],
            true,
          );
        }
        if (options.stash) {
          return this.stashAndSwitch(workspacePath, branch, target);
        }
        return this.runSwitch(workspacePath, ['switch', ...target]);
      });
    } catch (error) {
      const outcome = thrownOutcome(error);
      this.logger.error('[GitInfoService] checkout failed', {
        workspacePath,
        branch,
        error: outcome.error,
      } as unknown as Error);
      return outcome;
    }
  }

  /**
   * One `git switch`; an overwrite refusal becomes `dirty` + paths. After
   * `--discard-changes` (`discarding`) only untracked files can still be in
   * the way; they are never deleted, so the error asks the user to move them.
   * A git too old for `switch` / `--end-of-options` gets a clear message.
   */
  private async runSwitch(
    workspacePath: string,
    args: string[],
    discarding = false,
  ): Promise<GitCheckoutResult> {
    const run = await this.writeLock.execWrite(args, workspacePath, {
      timeoutMs: GIT_HOOK_TIMEOUT_MS,
    });
    const outcome: GitCheckoutResult = writeOutcome(run, 'git switch failed');
    if (outcome.success || run.code !== 'COMPLETED') return outcome;
    if (isGitTooOldForSwitch(run.stderr)) {
      return { ...outcome, error: GIT_TOO_OLD_MESSAGE };
    }
    const { paths: conflictingPaths, untracked } = parseSwitchRefusal(
      run.stderr,
    );
    if (conflictingPaths.length === 0) return outcome;
    const error =
      discarding && untracked
        ? `Untracked files block this switch: ${conflictingPaths.join(', ')}. ` +
          'Move or delete them, then try again.'
        : outcome.error;
    return { ...outcome, error, dirty: true, conflictingPaths };
  }

  /**
   * The `switch` arguments for `track`: a remote-tracking ref `origin/x`
   * becomes local `x` when that branch exists, otherwise `--track origin/x`
   * (git names the new branch `x`). Anything else is switched to as given,
   * which `git switch` refuses for a remote ref rather than detaching.
   */
  private async resolveTrackTarget(
    workspacePath: string,
    branch: string,
  ): Promise<string[]> {
    const slash = branch.indexOf('/');
    const remote = await this.execGit(
      ['rev-parse', '--verify', '--quiet', `refs/remotes/${branch}`],
      workspacePath,
    );
    if (slash <= 0 || remote.exitCode !== 0) {
      return ['--end-of-options', branch];
    }
    const local = branch.slice(slash + 1);
    const existing = await this.execGit(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${local}`],
      workspacePath,
    );
    return existing.exitCode === 0
      ? ['--end-of-options', local]
      : ['--track', '--end-of-options', branch];
  }

  /**
   * `stash push --include-untracked`, then switch. A clean tree creates no
   * entry (git exits 0 with "No local changes to save"), so the entry is
   * recognised by `refs/stash` moving, never by parsing git's message.
   */
  private async stashAndSwitch(
    workspacePath: string,
    branch: string,
    target: string[],
  ): Promise<GitCheckoutResult> {
    const before = await this.readStashTip(workspacePath);
    const pushed = writeOutcome(
      await this.writeLock.execWrite(
        [
          'stash',
          'push',
          '--include-untracked',
          '-m',
          `ptah: before switching to ${branch}`,
        ],
        workspacePath,
        { timeoutMs: GIT_HOOK_TIMEOUT_MS },
      ),
      'git stash push failed',
    );
    if (!pushed.success) return pushed;
    const after = await this.readStashTip(workspacePath);
    const saved = after !== undefined && after !== before ? after : undefined;

    const switched = await this.runSwitch(workspacePath, ['switch', ...target]);
    if (switched.success) {
      return saved ? { ...switched, stashRef: saved } : switched;
    }
    if (!saved) return switched;

    const restored = await this.popStashEntry(workspacePath, saved);
    if (restored.success) return switched;
    this.logger.warn(
      '[GitInfoService] switch failed and the stash could not be restored',
      {
        workspacePath,
        branch,
        stash: saved,
        error: restored.error,
      } as unknown as Error,
    );
    return {
      ...switched,
      error:
        `${switched.error ?? 'git switch failed'}\n` +
        `Restoring your stashed changes also failed: ${restored.error ?? 'git stash pop failed'}\n` +
        `Your changes are kept in the stash (${saved.slice(0, 7)}).`,
      stashRef: saved,
    };
  }

  /** SHA of `refs/stash`, or undefined when there is no stash. */
  private async readStashTip(
    workspacePath: string,
  ): Promise<string | undefined> {
    const tip = await this.execGit(
      ['rev-parse', '--verify', '--quiet', 'refs/stash'],
      workspacePath,
    );
    const sha = tip.stdout.trim();
    return tip.exitCode === 0 && sha ? sha : undefined;
  }

  /**
   * Pop the entry whose commit is `sha`, found by position at pop time: the
   * stash stack is shared with every other git client of this repository.
   */
  private async popStashEntry(
    workspacePath: string,
    sha: string,
  ): Promise<GitCheckoutResult> {
    const list = await this.execGit(
      ['stash', 'list', '--format=%H'],
      workspacePath,
    );
    const index = list.stdout.split(/\r?\n/).indexOf(sha);
    if (list.exitCode !== 0 || index < 0) {
      return { success: false, error: 'The stash entry was not found' };
    }
    return writeOutcome(
      await this.writeLock.execWrite(
        ['stash', 'pop', stashRef(index)],
        workspacePath,
        { timeoutMs: GIT_HOOK_TIMEOUT_MS },
      ),
      'git stash pop failed',
    );
  }

  /**
   * List all stash entries.
   * Runs: git stash list --format=%gd%x09%H%x09%ct%x09%s
   * Fixed fields come before the variable-length message, so a tab in the
   * message cannot displace the commit hash or timestamp.
   * Not cached so external stash mutations (e.g. `git stash drop`) are immediately visible.
   */
  async stashList(workspacePath: string): Promise<GitStashListResult> {
    return this.computeStashList(workspacePath);
  }

  private async computeStashList(
    workspacePath: string,
  ): Promise<GitStashListResult> {
    try {
      const { stdout, exitCode } = await this.execGit(
        ['stash', 'list', '--format=%gd%x09%H%x09%ct%x09%s'],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { count: 0, entries: [] };
      }

      const entries: StashEntry[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split('\t');
        const ref = parts[0] ?? '';
        const hash = parts[1] ?? '';
        const timeRaw = parts[2] ?? '';
        const message = parts.slice(3).join('\t');
        const indexMatch = ref.match(/stash@\{(\d+)\}/);
        const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;
        const time = timeRaw ? parseInt(timeRaw, 10) * 1000 : undefined;

        entries.push({ index, hash, message, time });
      }

      return { count: entries.length, entries };
    } catch (error) {
      this.logger.error('[GitInfoService] stashList failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return { count: 0, entries: [] };
    }
  }

  /** Runs: git stash apply stash@{index} — the entry is kept. */
  async stashApply(
    workspacePath: string,
    index: number,
    expectedHash?: string,
  ): Promise<GitStashMutationResult> {
    return this.runStashMutation(workspacePath, 'apply', index, expectedHash);
  }

  /**
   * Runs: git stash pop stash@{index}. On a conflict git applies what it can
   * and KEEPS the entry, exiting non-zero; that is reported as a failure.
   */
  async stashPop(
    workspacePath: string,
    index: number,
    expectedHash?: string,
  ): Promise<GitStashMutationResult> {
    return this.runStashMutation(workspacePath, 'pop', index, expectedHash);
  }

  /** Runs: git stash drop stash@{index} (destructive). */
  async stashDrop(
    workspacePath: string,
    index: number,
    expectedHash?: string,
  ): Promise<GitStashMutationResult> {
    return this.runStashMutation(workspacePath, 'drop', index, expectedHash);
  }

  private async runStashMutation(
    workspacePath: string,
    verb: 'apply' | 'pop' | 'drop',
    index: number,
    expectedHash?: string,
  ): Promise<GitStashMutationResult> {
    if (!isStashIndex(index)) {
      return { success: false, error: 'Invalid stash index' };
    }
    const ref = stashRef(index);
    try {
      return await this.writeLock.run(workspacePath, async () => {
        if (expectedHash) {
          const verify = await this.execGit(
            ['rev-parse', '--verify', ref],
            workspacePath,
          );
          if (
            verify.exitCode !== 0 ||
            verify.stdout.trim() !== expectedHash.trim()
          ) {
            return {
              success: false,
              error: 'The stash list changed. Refresh and try again.',
            };
          }
        }
        return writeOutcome(
          await this.writeLock.execWrite(['stash', verb, ref], workspacePath, {
            timeoutMs: GIT_HOOK_TIMEOUT_MS,
          }),
          `git stash ${verb} failed`,
        );
      });
    } catch (error) {
      const outcome = thrownOutcome(error);
      this.logger.error(`[GitInfoService] stash ${verb} failed`, {
        workspacePath,
        index,
        error: outcome.error,
      } as unknown as Error);
      return outcome;
    }
  }

  /**
   * Files one stash entry changed, relative to the commit it was made on.
   *
   * Runs: git diff --name-status -z -M stash@{N}^1 stash@{N}
   *
   * `git diff` rather than `git stash show`, so `stash.showStat` /
   * `stash.showIncludeUntracked` config cannot change the output shape. The
   * listed paths are exactly what `git:reviewChanges` with base
   * `stash@{N}^1` and head `stash@{N}` issues for `git:reviewFile`. Untracked
   * files stored in a `-u` stash (the third parent) are added as status 'A'.
   */
  async stashShow(
    workspacePath: string,
    index: number,
    expectedHash?: string,
  ): Promise<GitStashShowResult> {
    if (!isStashIndex(index)) {
      return { success: false, files: [], error: 'Invalid stash index' };
    }
    const ref = stashRef(index);
    try {
      if (expectedHash) {
        const verify = await this.execGit(
          ['rev-parse', '--verify', ref],
          workspacePath,
        );
        if (
          verify.exitCode !== 0 ||
          verify.stdout.trim() !== expectedHash.trim()
        ) {
          return {
            success: false,
            files: [],
            error: 'The stash list changed. Refresh and try again.',
          };
        }
      }

      const exists = await this.execGit(
        ['rev-parse', '--verify', '--quiet', ref],
        workspacePath,
      );
      if (exists.exitCode !== 0) {
        return { success: false, files: [], error: 'Stash entry not found' };
      }

      const { stdout, exitCode, stderr } = await this.execGit(
        [
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--name-status',
          '-z',
          '-M',
          `${ref}^1`,
          ref,
        ],
        workspacePath,
      );
      if (exitCode !== 0) {
        this.logger.error('[GitInfoService] stashShow diff failed', {
          workspacePath,
          index,
          stderr,
        } as unknown as Error);
        return {
          success: false,
          files: [],
          error: 'The stash contents could not be read',
        };
      }
      const files = parseStashNameStatus(stdout);

      const hasUntracked = await this.execGit(
        ['rev-parse', '--verify', '--quiet', `${ref}^3`],
        workspacePath,
      );
      if (hasUntracked.exitCode === 0) {
        const untracked = await this.execGit(
          ['ls-tree', '-r', '--name-only', '-z', `${ref}^3`],
          workspacePath,
        );
        if (untracked.exitCode === 0 && untracked.stdout) {
          for (const untrackedPath of untracked.stdout.split('\0')) {
            if (untrackedPath) {
              files.push({ path: untrackedPath, status: 'A' });
            }
          }
        }
      }

      return { success: true, files };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] stashShow failed', {
        workspacePath,
        index,
        error: message,
      } as unknown as Error);
      return {
        success: false,
        files: [],
        error: 'The stash contents could not be read',
      };
    }
  }

  /**
   * List tags sorted by creation date (newest first), limited to `limit` entries.
   * Runs: git tag --sort=-creatordate --format=...
   */
  async getTags(workspacePath: string, limit = 20): Promise<GitTagsResult> {
    return this.cachedRead(
      `tags|${workspacePath}|${limit}`,
      workspacePath,
      () => this.computeTags(workspacePath, limit),
    );
  }

  private async computeTags(
    workspacePath: string,
    limit: number,
  ): Promise<GitTagsResult> {
    try {
      const fmt =
        '%(refname:short)%09%(objectname:short)%09%(*objectname:short)%09%(creatordate:unix)';
      const { stdout, exitCode } = await this.execGit(
        ['tag', '--sort=-creatordate', `--format=${fmt}`],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { tags: [] };
      }

      const tags: TagRef[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split('\t');
        const name = parts[0] ?? '';
        const objectHash = parts[1] ?? '';
        const derefHash = parts[2] ?? ''; // non-empty only for annotated tags
        const creatorDateRaw = parts[3] ?? '';

        if (!name) continue;
        const annotated = derefHash !== '' && derefHash !== objectHash;
        const commit = annotated ? derefHash : objectHash;
        const time = creatorDateRaw
          ? parseInt(creatorDateRaw, 10) * 1000
          : undefined;

        tags.push({
          name,
          commit,
          annotated,
          time: isNaN(time ?? NaN) ? undefined : time,
        });

        if (tags.length >= limit) break;
      }

      return { tags };
    } catch (error) {
      this.logger.error('[GitInfoService] getTags failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return { tags: [] };
    }
  }

  /**
   * List all configured remotes with their fetch and push URLs.
   * Runs: git remote -v
   */
  async getRemotes(workspacePath: string): Promise<GitRemotesResult> {
    return this.cachedRead(`remotes|${workspacePath}|`, workspacePath, () =>
      this.computeRemotes(workspacePath),
    );
  }

  private async computeRemotes(
    workspacePath: string,
  ): Promise<GitRemotesResult> {
    try {
      const { stdout, exitCode } = await this.execGit(
        ['remote', '-v'],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { remotes: [] };
      }

      const remoteMap = new Map<string, RemoteInfo>();

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const tabIdx = trimmed.indexOf('\t');
        if (tabIdx === -1) continue;

        const remoteName = trimmed.substring(0, tabIdx);
        const rest = trimmed.substring(tabIdx + 1);

        const fetchMatch = rest.match(/^(.+)\s+\(fetch\)$/);
        const pushMatch = rest.match(/^(.+)\s+\(push\)$/);

        if (!remoteMap.has(remoteName)) {
          remoteMap.set(remoteName, {
            name: remoteName,
            fetchUrl: '',
            pushUrl: '',
          });
        }

        const info = remoteMap.get(remoteName)!;
        if (fetchMatch) {
          info.fetchUrl = fetchMatch[1].trim();
        } else if (pushMatch) {
          info.pushUrl = pushMatch[1].trim();
        }
      }

      return { remotes: Array.from(remoteMap.values()) };
    } catch (error) {
      this.logger.error('[GitInfoService] getRemotes failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return { remotes: [] };
    }
  }

  /**
   * Get the last commit for a given ref (defaults to HEAD).
   * Runs: git log -1 --format='%H%n%h%n%s%n%an%n%ae%n%ct%n%b' --end-of-options <ref>
   *
   * Security: `ref` must pass `assertSafeRevision` (no leading `-`, so no
   * `--output=...` from a crafted frontend request) and follows
   * `--end-of-options`; a refused ref gets the empty result.
   */
  async getLastCommit(
    workspacePath: string,
    ref = 'HEAD',
  ): Promise<GitLastCommitResult> {
    return this.cachedRead(
      `lastCommit|${workspacePath}|${ref}`,
      workspacePath,
      () => this.computeLastCommit(workspacePath, ref),
    );
  }

  private async computeLastCommit(
    workspacePath: string,
    ref: string,
  ): Promise<GitLastCommitResult> {
    const emptyResult: GitLastCommitResult = {
      hash: '',
      shortHash: '',
      subject: '',
      body: '',
      author: '',
      authorEmail: '',
      time: 0,
    };
    try {
      assertSafeRevision(ref);
    } catch {
      return emptyResult;
    }

    try {
      const { stdout, exitCode } = await this.execGit(
        [
          'log',
          '-1',
          '--format=%H%n%h%n%s%n%an%n%ae%n%ct%n%b',
          '--end-of-options',
          ref,
        ],
        workspacePath,
      );

      if (exitCode !== 0 || !stdout.trim()) {
        return emptyResult;
      }
      const lines = stdout.split('\n');
      const hash = lines[0]?.trim() ?? '';
      const shortHash = lines[1]?.trim() ?? '';
      const subject = lines[2]?.trim() ?? '';
      const author = lines[3]?.trim() ?? '';
      const authorEmail = lines[4]?.trim() ?? '';
      const ctRaw = lines[5]?.trim() ?? '';
      const body = lines.slice(6).join('\n').trim();

      const time = ctRaw ? parseInt(ctRaw, 10) * 1000 : 0;

      return {
        hash,
        shortHash,
        subject,
        body,
        author,
        authorEmail,
        time: isNaN(time) ? 0 : time,
      };
    } catch (error) {
      this.logger.error('[GitInfoService] getLastCommit failed', {
        workspacePath,
        ref,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return emptyResult;
    }
  }

  async isGitRepo(
    workspacePath: string,
    priority: ExecGitOptions['priority'] = 'normal',
  ): Promise<boolean> {
    return (await this.probeRepo(workspacePath, priority)).state === 'yes';
  }

  /**
   * Tri-state repository probe. Only git's own "not a git repository" (exit
   * 128) or an explicit `false` is a `no`; a timeout, a missing binary, a
   * spawn error or any other exit is `unknown`, which callers must never
   * report as "not a repository".
   */
  private async probeRepo(
    workspacePath: string,
    priority: ExecGitOptions['priority'],
  ): Promise<RepoProbe> {
    try {
      const { stdout, stderr, exitCode } = await this.execGit(
        ['rev-parse', '--is-inside-work-tree'],
        workspacePath,
        { priority },
      );
      if (exitCode === 0) {
        return { state: stdout.trim() === 'true' ? 'yes' : 'no' };
      }
      if (exitCode === 128 && /not a git repository/i.test(stderr)) {
        return { state: 'no' };
      }
      return { state: 'unknown', reason: unavailableReason(undefined, stderr) };
    } catch (error: unknown) {
      // degradation-audit: optional-capability - git could not answer at all;
      // the caller reports status as unavailable with this reason.
      return { state: 'unknown', reason: unavailableReason(error) };
    }
  }

  /**
   * The one place this service spawns git for text output — and therefore the
   * one place cache invalidation has to live.
   *
   * Deriving "did that change the repository?" from the argv, rather than
   * asking each mutating method to remember to invalidate, is what keeps a
   * future method from silently serving a stale branch list: a new call site
   * gets the behaviour by construction. See {@link isMutatingGitCommand}.
   */
  private async execGit(
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ): Promise<ExecGitResult> {
    const result = await execGit(args, cwd, this.withSpawner(options));
    if (isMutatingGitCommand(args)) this.invalidateReadCache(cwd);
    return result;
  }

  private async execGitBuffer(
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ): Promise<ExecGitBufferResult> {
    const result = await execGitBuffer(args, cwd, this.withSpawner(options));
    if (isMutatingGitCommand(args)) this.invalidateReadCache(cwd);
    return result;
  }

  /**
   * Attach the host's spawner to a caller's options.
   *
   * The two private seams above are the only places this service reaches
   * `exec-git`, so threading the spawner here covers every git invocation
   * without touching the ~30 call sites. A caller that already named a
   * `spawner` keeps it — nothing does today, and the override costs nothing.
   */
  private withSpawner(options?: ExecGitOptions): ExecGitOptions | undefined {
    if (!this.spawner) return options;
    return { ...options, spawner: options?.spawner ?? this.spawner };
  }

  private async readNumstat(
    workspacePath: string,
    staged: boolean,
    priority: ExecGitOptions['priority'],
  ): Promise<
    Map<string, Pick<GitFileStatus, 'additions' | 'deletions' | 'binary'>>
  > {
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--numstat', '-z', '--find-renames', '--find-copies', '--');
    const result = await this.execGit(args, workspacePath, { priority });
    return result.exitCode === 0 ? this.parseNumstat(result.stdout) : new Map();
  }

  private async readUntrackedNumstat(
    workspacePath: string,
    relativePath: string,
  ): Promise<Pick<GitFileStatus, 'additions' | 'deletions' | 'binary'>> {
    const absolutePath = path.resolve(workspacePath, relativePath);
    const relative = path.relative(workspacePath, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { additions: null, deletions: null };
    }
    try {
      const stats = await readStat(absolutePath);
      if (!stats.isFile() || stats.size > MAX_UNTRACKED_NUMSTAT_BYTES) {
        return { additions: null, deletions: null };
      }
      const bytes = await readFile(absolutePath);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        return { additions: null, deletions: null, binary: true };
      }
      const text = bytes.toString('utf8');
      const additions =
        text === ''
          ? 0
          : text.split(/\r\n|\r|\n/).length -
            (/(?:\r\n|\r|\n)$/.test(text) ? 1 : 0);
      return { additions, deletions: 0, binary: false };
    } catch {
      return { additions: null, deletions: null };
    }
  }

  private parseNumstat(
    output: string,
  ): Map<
    string,
    { additions: number | null; deletions: number | null; binary: boolean }
  > {
    const result = new Map<
      string,
      { additions: number | null; deletions: number | null; binary: boolean }
    >();
    const fields = output.split('\0');
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      if (!field) continue;
      const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(field);
      if (!match) continue;
      let filePath = match[3];
      if (!filePath) {
        index += 2; // skip original path and consume the new path
        filePath = fields[index] ?? '';
      }
      if (!filePath) continue;
      const binary = match[1] === '-' || match[2] === '-';
      result.set(filePath, {
        additions: binary ? null : Number.parseInt(match[1], 10),
        deletions: binary ? null : Number.parseInt(match[2], 10),
        binary,
      });
    }
    return result;
  }
}
