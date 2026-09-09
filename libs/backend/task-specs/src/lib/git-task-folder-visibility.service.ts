/**
 * The git-backed implementation of {@link ITaskFolderVisibility} — the ONLY
 * place in the task-spec subsystem that talks to git (TASK_2026_403).
 *
 * It answers "which `TASK_*` folder names exist outside this checkout?" from
 * two independent sources:
 *
 *  1. **Sibling worktrees** — `git worktree list --porcelain`, then one
 *     `readDirectory` on each worktree's `.ptah/specs`. `.ptah/**` is
 *     gitignored, so a sibling worktree's folders exist only on disk and the
 *     remote half below cannot see them.
 *  2. **`origin/main`** — a best-effort `git fetch` followed by `git ls-tree`.
 *     A task filed on a branch that was pushed but never merged into this
 *     checkout is invisible any other way.
 *
 * ## Nothing here throws
 *
 * This runs on the `create` path. Every step is independently guarded and
 * contributes NOTHING on failure, because a degraded view costs a contended id
 * (which the exclusive-`mkdir` claim then resolves) while a thrown error costs
 * the user their task. The five branches, each pinned by a spec:
 *
 *  - `worktree list` fails → no worktree contribution AND the remote steps are
 *    skipped, since a directory that is not a repository cannot have
 *    `origin/main` either.
 *  - `fetch` fails or times out (offline, no `origin`, a credential prompt) →
 *    CONTINUE to `ls-tree` against whatever `origin/main` already points at. A
 *    stale remote view is strictly better than none.
 *  - `ls-tree` fails (no `origin/main` ref) → no remote contribution.
 *  - One worktree's `readDirectory` fails (a deleted worktree still listed, a
 *    permission error) → that worktree alone contributes nothing.
 */
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import {
  FileType,
  PLATFORM_TOKENS,
  type IFileSystemProvider,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';
import {
  DEFAULT_GIT_TIMEOUT_MS,
  TOKENS,
  execGit,
  type DegradationReporter,
  type ExecGitOptions,
  type ExecGitResult,
  type Logger,
} from '@ptah-extension/vscode-core';
import { parseWorktreeList } from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import type { ITaskFolderVisibility } from './task-folder-visibility.port';

/** How long one workspace's union is reused before git is consulted again. */
export const VISIBILITY_CACHE_TTL_MS = 60_000;

/**
 * The fetch gets its own, shorter budget than the other two steps.
 *
 * It is the only step that touches the network and the only one that can hang
 * on a credential prompt, and its result is optional by construction — the
 * `ls-tree` that follows reads whatever `origin/main` already points at.
 */
export const FETCH_TIMEOUT_MS = 5_000;

/**
 * Mirror of `SDK_TOKENS.SDK_PROCESS_SPAWNER`
 * (`libs/backend/agent-sdk/src/lib/di/tokens.ts`), referenced by symbol
 * description so `task-specs` gains no `agent-sdk` dependency edge.
 *
 * Injected `{isOptional: true}`: only the Electron host binds a spawner
 * (`apps/ptah-electron/src/di/phase-4-handlers.ts`), and VS Code and the CLI
 * take `execGit`'s documented inline path unchanged.
 *
 * **A typo here does NOT fail loudly** — the optional injection resolves `null`
 * and every git call silently runs `CreateProcessW` inline on the Electron main
 * thread, which is exactly the freeze the off-thread spawner exists to prevent.
 * `git-task-folder-visibility.service.spec.ts` pins this description as a
 * string literal for that reason.
 */
export const SDK_PROCESS_SPAWNER_TOKEN = Symbol.for('SdkProcessSpawner');

/**
 * Test seam for the git invocation.
 *
 * Nothing registers this token in any host, so `{isOptional: true}` resolves
 * `null` and the constructor falls back to the imported {@link execGit}. It
 * exists as a token rather than a bare defaulted parameter because tsyringe
 * reads `design:paramtypes` for EVERY constructor parameter and would try to
 * resolve an undecorated function-typed one as a class.
 */
export const VISIBILITY_EXEC_GIT_TOKEN = Symbol.for(
  'TaskSpecsVisibilityExecGit',
);

/** The one shape this service needs from {@link execGit}. */
export type ExecGitFn = (
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
) => Promise<ExecGitResult>;

/**
 * Every degradation this service can report.
 *
 * A closed union rather than a bare `string`, so an interpolated code — the one
 * thing `DegradationReporter`'s contract forbids, because it mints a fresh
 * bucket per failure — is a compile error rather than a convention.
 */
type VisibilityDegradationCode =
  | 'task-visibility.worktree-list-failed'
  | 'task-visibility.fetch-failed'
  | 'task-visibility.ls-tree-failed'
  | 'task-visibility.worktree-scan-failed';

interface CacheEntry {
  readonly at: number;
  readonly names: readonly string[];
}

/**
 * `git ls-tree --name-only -z origin/main .ptah/specs/` → the task folder names.
 *
 * `-z` is NUL-separated, not newline-separated, so a path is safe to split on
 * regardless of what it contains. The pathspec is non-recursive, so every entry
 * is `.ptah/specs/<name>` — the segment after the last `/` is the folder name.
 * Entries that are not task folders (a `registry.md` sitting beside them) are
 * dropped by the `TASK_` prefix test.
 */
export function specFolderNamesFromLsTree(stdout: string): string[] {
  const names: string[] = [];
  for (const entry of stdout.split('\0')) {
    if (entry.length === 0) continue;
    const name = entry.slice(entry.lastIndexOf('/') + 1);
    if (name.startsWith('TASK_')) names.push(name);
  }
  return names;
}

/**
 * `git worktree list --porcelain` → each worktree's `.ptah/specs` directory.
 *
 * Parsing is delegated to `parseWorktreeList` in `@ptah-extension/shared` —
 * there must not be a second porcelain parser in this repository. Git prints
 * forward-slashed Windows paths (`worktree D:/projects/ptah-extension`);
 * `path.join` normalises them to the separator the file-system provider uses.
 */
export function specDirsFromWorktreeList(stdout: string): string[] {
  const dirs = new Set<string>();
  for (const worktree of parseWorktreeList(stdout)) {
    if (!worktree.path) continue;
    dirs.add(path.join(worktree.path, '.ptah', 'specs'));
  }
  return [...dirs];
}

@injectable()
export class GitTaskFolderVisibility implements ITaskFolderVisibility {
  private readonly exec: ExecGitFn;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(SDK_PROCESS_SPAWNER_TOKEN, { isOptional: true })
    private readonly spawner: IProcessSpawner | null = null,
    /**
     * Optional because `registerTaskSpecsServices` does not register it — the
     * reporter is bound by `vscode-core`'s platform-agnostic registration,
     * which a bare test container will not have run.
     */
    @inject(TOKENS.DEGRADATION_REPORTER, { isOptional: true })
    private readonly degradation: DegradationReporter | null = null,
    @inject(VISIBILITY_EXEC_GIT_TOKEN, { isOptional: true })
    exec: ExecGitFn | null = null,
  ) {
    this.exec = exec ?? execGit;
  }

  async listBeyondWorkspace(
    workspaceRoot: string,
  ): Promise<readonly string[]> {
    const root = normalizeWorkspaceRoot(workspaceRoot);

    const cached = this.cache.get(root);
    if (cached && Date.now() - cached.at < VISIBILITY_CACHE_TTL_MS) {
      return cached.names;
    }

    const names = new Set<string>();
    const specDirs = await this.worktreeSpecDirs(root);

    // `null` means the directory is not a git worktree at all, so both the
    // per-worktree scan and the `origin/main` read below are unreachable.
    if (specDirs !== null) {
      const ownSpecs = path.resolve(root, '.ptah', 'specs');
      for (const dir of specDirs) {
        // `path.relative` is case-insensitive on win32, which is what makes
        // this comparison safe against git's own path casing.
        if (path.relative(path.resolve(dir), ownSpecs) === '') continue;
        for (const name of await this.scanSpecsDir(dir)) names.add(name);
      }

      // Best effort, and deliberately unchecked: a failed fetch still leaves a
      // usable (if stale) `origin/main` for `ls-tree` to read.
      await this.fetchOriginMain(root);
      for (const name of await this.remoteSpecFolderNames(root)) {
        names.add(name);
      }
    }

    const result = [...names];
    this.cache.set(root, { at: Date.now(), names: result });
    return result;
  }

  /**
   * @returns the sibling `.ptah/specs` directories, or `null` when git could
   *   not answer at all — which is also the signal to skip the remote steps.
   */
  private async worktreeSpecDirs(root: string): Promise<string[] | null> {
    try {
      const result = await this.exec(
        ['worktree', 'list', '--porcelain'],
        root,
        this.gitOptions(DEFAULT_GIT_TIMEOUT_MS),
      );
      if (result.exitCode === 0) return specDirsFromWorktreeList(result.stdout);
      this.degrade(
        'task-visibility.worktree-list-failed',
        'Could not list git worktrees; task ids see this checkout only.',
        `exit ${result.exitCode}: ${result.stderr.trim()}`,
      );
      return null;
    } catch (error: unknown) {
      // degradation-audit: reported — task-visibility.worktree-list-failed; git
      // is absent or this workspace is not a repository, so no cross-checkout
      // view exists and allocation falls back to the local folder scan.
      this.degrade(
        'task-visibility.worktree-list-failed',
        'Could not list git worktrees; task ids see this checkout only.',
        describe(error),
      );
      return null;
    }
  }

  /** Best effort — the caller continues against the stale ref either way. */
  private async fetchOriginMain(root: string): Promise<void> {
    try {
      const result = await this.exec(
        ['fetch', '--quiet', 'origin', 'main'],
        root,
        this.gitOptions(FETCH_TIMEOUT_MS),
      );
      if (result.exitCode === 0) return;
      this.degrade(
        'task-visibility.fetch-failed',
        'Could not refresh origin/main; reading the task folders it last pointed at.',
        `exit ${result.exitCode}: ${result.stderr.trim()}`,
      );
    } catch (error: unknown) {
      // degradation-audit: reported — task-visibility.fetch-failed; offline, no
      // `origin`, or a credential prompt timed the fetch out. The `ls-tree`
      // that follows still reads the ref this checkout already has.
      this.degrade(
        'task-visibility.fetch-failed',
        'Could not refresh origin/main; reading the task folders it last pointed at.',
        describe(error),
      );
    }
  }

  private async remoteSpecFolderNames(root: string): Promise<string[]> {
    try {
      const result = await this.exec(
        ['ls-tree', '--name-only', '-z', 'origin/main', '.ptah/specs/'],
        root,
        this.gitOptions(DEFAULT_GIT_TIMEOUT_MS),
      );
      if (result.exitCode === 0) return specFolderNamesFromLsTree(result.stdout);
      this.degrade(
        'task-visibility.ls-tree-failed',
        'Could not read the task folders on origin/main.',
        `exit ${result.exitCode}: ${result.stderr.trim()}`,
      );
      return [];
    } catch (error: unknown) {
      // degradation-audit: reported — task-visibility.ls-tree-failed; there is
      // no `origin/main` ref in this repository, so the remote half of the
      // union contributes nothing and allocation uses the worktrees alone.
      this.degrade(
        'task-visibility.ls-tree-failed',
        'Could not read the task folders on origin/main.',
        describe(error),
      );
      return [];
    }
  }

  /** One worktree's `.ptah/specs`. A failure isolates to that worktree. */
  private async scanSpecsDir(specsDir: string): Promise<string[]> {
    try {
      if (!(await this.fs.exists(specsDir))) return [];
      const entries = await this.fs.readDirectory(specsDir);
      return entries
        .filter((entry) => entry.type === FileType.Directory)
        .map((entry) => entry.name);
    } catch (error: unknown) {
      // degradation-audit: reported — task-visibility.worktree-scan-failed; a
      // listed-but-deleted worktree or an unreadable directory contributes
      // nothing while every other worktree in the list is unaffected.
      this.degrade(
        'task-visibility.worktree-scan-failed',
        'Could not read a sibling worktree\u2019s task folders.',
        `${specsDir}: ${describe(error)}`,
      );
      return [];
    }
  }

  private gitOptions(timeoutMs: number): ExecGitOptions {
    return { timeoutMs, spawner: this.spawner ?? undefined };
  }

  /**
   * One `logger.warn` naming the step, plus ONE degradation report.
   *
   * `code` is typed as {@link VisibilityDegradationCode}, so every caller
   * passes a string literal and an interpolated code cannot compile.
   */
  private degrade(
    code: VisibilityDegradationCode,
    summary: string,
    detail: string,
  ): void {
    this.logger.warn(`[task-specs] ${code}`, { detail });
    this.degradation?.report({
      source: 'workspace',
      code,
      severity: 'degraded',
      summary,
      detail,
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
