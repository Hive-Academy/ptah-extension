import type {
  GitHistoryCommit,
  GitLogMode,
  GitLogResult,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import type { GitWriteRunner } from './git-write-lock';
import { assertSafeRef } from './git-ref-guard';

/** Most commits listed for `since-base` (plan Component 33). */
export const HISTORY_SINCE_BASE_MAX = 200;

/** Most commits listed for `recent` (plan Component 33). */
export const HISTORY_RECENT_MAX = 50;

/** Remote whose `HEAD` symref names the default branch. */
const DEFAULT_REMOTE = 'origin';

/** Default branch names tried, in order, after `origin/HEAD`. */
const BASE_BRANCH_CANDIDATES = ['main', 'master'] as const;

/**
 * Most bytes `git log` may print here. At most {@link HISTORY_SINCE_BASE_MAX}
 * + 1 records of six short fields: this only stops a pathological subject
 * from holding the default 64 MiB; past it the read is `git-failed`.
 */
export const HISTORY_LOG_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * `git log` fields, NUL-separated: SHA, short SHA, parent SHAs (space
 * separated), author name, strict-ISO author date, subject. The subject is
 * last and git never puts NUL in a commit message, so every field is
 * delimited unambiguously; with `-z` each record ends with one more NUL.
 */
const LOG_FORMAT = '--format=%H%x00%h%x00%P%x00%an%x00%aI%x00%s';
const LOG_FIELDS = 6;

/** git's exit code for "not a git repository" and other fatal errors. */
const GIT_FATAL_EXIT = 128;

export interface GitHistoryReaderDeps {
  /** The service's read runner. */
  readonly exec: GitWriteRunner;
  readonly logger: Logger;
}

interface ResolvedBase {
  /** Display name: `origin/main`, `main` or `master`. */
  readonly name: string;
  /**
   * The full ref (`refs/remotes/origin/main`, `refs/heads/main`) used in the
   * log range, so a tag or branch of the same short name cannot shadow it.
   */
  readonly ref: string;
  /** The branch name the base stands for (`main` for `origin/main`). */
  readonly branchName: string;
}

/** A git step that failed, carried up to {@link GitHistoryReader.read}. */
class HistoryReadError extends Error {
  constructor(readonly reason: 'not-a-repository' | 'git-failed') {
    super(reason);
    this.name = 'HistoryReadError';
  }
}

/**
 * The task history (TASK_2026_576 Component 33): the commits on HEAD since it
 * left its base, newest first.
 *
 * Base resolution order: `refs/remotes/origin/HEAD` (when it points at a
 * commit), else `origin/main`, `origin/master`, then local `main`, `master`.
 * A remote-tracking branch comes before the local one of the same name: the
 * local branch may lag behind, and every commit it lacks would be listed as
 * the task's own. With a base and HEAD not
 * on the base branch itself, the list is `<base>..HEAD` capped at
 * {@link HISTORY_SINCE_BASE_MAX}; otherwise (no base, or HEAD is the base
 * branch) it is the last {@link HISTORY_RECENT_MAX} commits of HEAD.
 *
 * Never throws: every failure becomes `{ status: 'unavailable' }`.
 */
export class GitHistoryReader {
  constructor(private readonly deps: GitHistoryReaderDeps) {}

  async read(workspacePath: string): Promise<GitLogResult> {
    try {
      const branch = await this.readBranch(workspacePath);
      const base = await this.resolveBase(workspacePath);
      const hasHead = await this.revisionExists(workspacePath, 'HEAD');
      const mode: GitLogMode =
        base !== null && base.branchName !== branch ? 'since-base' : 'recent';
      const baseName = base === null ? null : base.name;
      if (!hasHead) {
        // Unborn branch: nothing committed yet.
        return {
          status: 'ok',
          mode,
          base: baseName,
          branch,
          commits: [],
          truncated: false,
        };
      }
      const max =
        mode === 'since-base' ? HISTORY_SINCE_BASE_MAX : HISTORY_RECENT_MAX;
      const range =
        mode === 'since-base' && base !== null
          ? [`${base.ref}..HEAD`]
          : ['HEAD'];
      const commits = await this.readLog(workspacePath, range, max + 1);
      return {
        status: 'ok',
        mode,
        base: baseName,
        branch,
        commits: commits.slice(0, max),
        truncated: commits.length > max,
      };
    } catch (error: unknown) {
      if (error instanceof HistoryReadError) {
        return { status: 'unavailable', reason: error.reason };
      }
      this.deps.logger.warn('[GitHistoryReader] history read failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'unavailable', reason: 'git-failed' };
    }
  }

  /** The current branch, or null when HEAD is detached. */
  private async readBranch(workspacePath: string): Promise<string | null> {
    const { stdout, stderr, exitCode } = await this.deps.exec(
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      workspacePath,
    );
    if (exitCode === 0) return stdout.trim() || null;
    if (exitCode === 1) return null;
    this.fail('symbolic-ref HEAD', workspacePath, exitCode, stderr);
  }

  /**
   * `origin/HEAD`'s target, else the first of `origin/main`,
   * `origin/master`, `main`, `master` that names a commit; null when none.
   */
  private async resolveBase(
    workspacePath: string,
  ): Promise<ResolvedBase | null> {
    const remoteDefault = await this.readRemoteDefault(workspacePath);
    if (remoteDefault !== null) return remoteDefault;
    const candidates: ResolvedBase[] = [
      ...BASE_BRANCH_CANDIDATES.map((branchName) => ({
        name: `${DEFAULT_REMOTE}/${branchName}`,
        ref: `refs/remotes/${DEFAULT_REMOTE}/${branchName}`,
        branchName,
      })),
      ...BASE_BRANCH_CANDIDATES.map((branchName) => ({
        name: branchName,
        ref: `refs/heads/${branchName}`,
        branchName,
      })),
    ];
    for (const candidate of candidates) {
      if (await this.revisionExists(workspacePath, candidate.ref)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * `refs/remotes/origin/HEAD` as `origin/<branch>`, when it exists and
   * points at a commit (a dangling symref falls through to the candidates).
   */
  private async readRemoteDefault(
    workspacePath: string,
  ): Promise<ResolvedBase | null> {
    const { stdout, exitCode } = await this.deps.exec(
      [
        'symbolic-ref',
        '--quiet',
        '--short',
        `refs/remotes/${DEFAULT_REMOTE}/HEAD`,
      ],
      workspacePath,
    );
    if (exitCode !== 0) return null;
    const name = stdout.trim();
    const prefix = `${DEFAULT_REMOTE}/`;
    if (!name.startsWith(prefix) || name.length === prefix.length) return null;
    try {
      assertSafeRef(name);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - an unusable remote default
      // falls back to the other candidates, as if origin/HEAD were absent.
      this.deps.logger.warn('[GitHistoryReader] unusable origin/HEAD target', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    const ref = `refs/remotes/${name}`;
    if (!(await this.revisionExists(workspacePath, ref))) return null;
    return { name, ref, branchName: name.slice(prefix.length) };
  }

  /** True when `revision` names a commit. */
  private async revisionExists(
    workspacePath: string,
    revision: string,
  ): Promise<boolean> {
    const { stderr, exitCode } = await this.deps.exec(
      [
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        `${revision}^{commit}`,
      ],
      workspacePath,
    );
    if (exitCode === 0) return true;
    if (exitCode === 1) return false;
    this.fail('rev-parse --verify', workspacePath, exitCode, stderr);
  }

  /** At most `maxCount` commits of `range`, newest first. */
  private async readLog(
    workspacePath: string,
    range: readonly string[],
    maxCount: number,
  ): Promise<GitHistoryCommit[]> {
    const { stdout, stderr, exitCode } = await this.deps.exec(
      [
        'log',
        LOG_FORMAT,
        '-z',
        '--no-show-signature',
        `--max-count=${maxCount}`,
        '--end-of-options',
        ...range,
      ],
      workspacePath,
      { maxOutputBytes: HISTORY_LOG_MAX_OUTPUT_BYTES },
    );
    if (exitCode !== 0) this.fail('log', workspacePath, exitCode, stderr);
    return parseLog(stdout, (detail) =>
      this.deps.logger.warn('[GitHistoryReader] unparseable git log output', {
        workspacePath,
        detail,
      }),
    );
  }

  private fail(
    step: string,
    workspacePath: string,
    exitCode: number,
    stderr: string,
  ): never {
    this.deps.logger.warn(`[GitHistoryReader] git ${step} failed`, {
      workspacePath,
      exitCode,
      stderr: stderr.trim(),
    });
    const notARepository =
      exitCode === GIT_FATAL_EXIT && stderr.includes('not a git repository');
    throw new HistoryReadError(
      notARepository ? 'not-a-repository' : 'git-failed',
    );
  }
}

/**
 * Split `git log -z` output in {@link LOG_FORMAT} into commits. A record
 * whose field count is wrong drops the whole output (reported once through
 * `onMalformed`) rather than misaligning every later commit.
 */
function parseLog(
  stdout: string,
  onMalformed: (detail: string) => void,
): GitHistoryCommit[] {
  if (stdout.length === 0) return [];
  const body = stdout.endsWith('\0') ? stdout.slice(0, -1) : stdout;
  const fields = body.split('\0');
  if (fields.length % LOG_FIELDS !== 0) {
    onMalformed(
      `field count ${fields.length} is not a multiple of ${LOG_FIELDS}`,
    );
    return [];
  }
  const commits: GitHistoryCommit[] = [];
  for (let index = 0; index < fields.length; index += LOG_FIELDS) {
    const [sha, shortSha, parents, authorName, authorDate, subject] =
      fields.slice(index, index + LOG_FIELDS);
    const parentCount = parents.split(' ').filter(Boolean).length;
    commits.push({
      sha,
      shortSha,
      subject,
      authorName,
      authorDate,
      parentCount,
      isRoot: parentCount === 0,
    });
  }
  return commits;
}
