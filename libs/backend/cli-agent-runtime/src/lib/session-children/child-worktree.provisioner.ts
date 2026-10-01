/**
 * Creates, verifies and rolls back one child session's git worktree
 * (TASK_2026_584). Nothing else: the spawner owns the session.
 *
 * Every git call is an argument array through `execGit` (no shell), with the
 * worktree timeout and, in Electron, the off-thread process spawner. The
 * directory name comes from `resolveWorktreePath` (hashed, no traversal) and
 * the created path is checked by realpath containment in the root.
 *
 * Rollback removes only what this call created and reports every step; it
 * never throws and never hides a failed step.
 */
import { promises as fs } from 'fs';
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
  type IOutputChannel,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';
import {
  WORKTREE_GIT_TIMEOUT_MS,
  execGit,
  resolveWorktreePath,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  SessionChildRollbackStep,
  SessionSpawnRefusalCode,
} from './session-spawner.port';

const LOG_PREFIX = '[ChildWorktreeProvisioner]';

/** A worktree this provisioner created. */
export interface ChildWorktree {
  /** The repository root the worktree was added from. */
  readonly root: string;
  readonly branch: string;
  /** The path git was given; also the path to remove on rollback. */
  readonly worktreePath: string;
  /** The commit the branch was created at. */
  readonly baseSha: string;
}

export type ChildWorktreeRefusal = Extract<
  SessionSpawnRefusalCode,
  | 'invalid-arguments'
  | 'branch-exists'
  | 'worktree-failed'
  | 'worktree-outside-workspace'
>;

export type ChildWorktreeCreateResult =
  | { readonly ok: true; readonly worktree: ChildWorktree }
  | {
      readonly ok: false;
      readonly refusal: ChildWorktreeRefusal;
      readonly detail: string;
      /** Present when this call created something and had to remove it. */
      readonly rollback?: readonly SessionChildRollbackStep[];
    };

@injectable()
export class ChildWorktreeProvisioner {
  constructor(
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
    /** Electron binds the off-thread spawner; elsewhere git runs inline. */
    @inject(SDK_TOKENS.SDK_PROCESS_SPAWNER, { isOptional: true })
    private readonly spawner: IProcessSpawner | null = null,
  ) {}

  /**
   * Create `branch` at `baseRef` (default `HEAD`) in a fresh worktree under
   * `root`. Every refusal leaves the repository as it was.
   */
  async create(
    root: string,
    branch: string,
    baseRef?: string,
  ): Promise<ChildWorktreeCreateResult> {
    // A leading '-' would reach git as an option, never as a name.
    if (!branch.trim() || branch.startsWith('-')) {
      return refuse('invalid-arguments', `invalid branch name "${branch}"`);
    }
    const base = baseRef?.trim() || 'HEAD';
    if (base.startsWith('-')) {
      return refuse('invalid-arguments', `invalid base ref "${base}"`);
    }

    try {
      const format = await this.git(
        ['check-ref-format', '--branch', branch],
        root,
      );
      if (format.exitCode !== 0) {
        return refuse(
          'invalid-arguments',
          `"${branch}" is not a valid branch name${stderrSuffix(format.stderr)}`,
        );
      }

      const existing = await this.git(
        ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
        root,
      );
      if (existing.exitCode === 0) {
        return refuse(
          'branch-exists',
          `branch "${branch}" already exists; pick a new branch name`,
        );
      }

      const resolved = await this.git(
        ['rev-parse', '--verify', '--quiet', `${base}^{commit}`],
        root,
      );
      const baseSha = resolved.stdout.trim();
      if (resolved.exitCode !== 0 || !baseSha) {
        return refuse(
          'invalid-arguments',
          `base ref "${base}" does not name a commit`,
        );
      }

      const worktreePath = resolveWorktreePath(root, branch);
      if (await pathExists(worktreePath)) {
        return refuse(
          'worktree-failed',
          `the worktree directory ${worktreePath} already exists`,
        );
      }

      const worktree: ChildWorktree = { root, branch, worktreePath, baseSha };
      return await this.addAndVerify(worktree);
    } catch (error: unknown) {
      // degradation-audit: reported - the git failure (timeout, spawn error)
      // is returned to the caller as `worktree-failed` with its message.
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`git failed before the worktree existed: ${detail}`);
      return refuse('worktree-failed', detail);
    }
  }

  /**
   * Remove a worktree and its branch, both created by {@link create}. Each
   * step runs even when the previous one failed, and each is reported.
   */
  async rollback(
    worktree: ChildWorktree,
  ): Promise<readonly SessionChildRollbackStep[]> {
    const steps: SessionChildRollbackStep[] = [];
    steps.push(
      await this.step(
        'remove-worktree',
        ['worktree', 'remove', '--force', worktree.worktreePath],
        worktree.root,
      ),
    );
    steps.push(
      await this.step(
        'delete-branch',
        ['branch', '-D', worktree.branch],
        worktree.root,
      ),
    );
    return steps;
  }

  private async addAndVerify(
    worktree: ChildWorktree,
  ): Promise<ChildWorktreeCreateResult> {
    const { root, branch, worktreePath, baseSha } = worktree;
    let added: { exitCode: number; stderr: string };
    try {
      added = await this.git(
        ['worktree', 'add', '-b', branch, worktreePath, baseSha],
        root,
      );
    } catch (error: unknown) {
      // degradation-audit: reported - a timed-out add may have left a
      // partial branch or directory; both were verified absent before the
      // call, so they are this call's and are rolled back and reported.
      const detail = error instanceof Error ? error.message : String(error);
      return this.failAfterAdd(worktree, 'worktree-failed', detail);
    }
    if (added.exitCode !== 0) {
      return this.failAfterAdd(
        worktree,
        'worktree-failed',
        added.stderr.trim() || `git worktree add exited ${added.exitCode}`,
      );
    }

    let contained = false;
    try {
      const [realPath, realRoot] = await Promise.all([
        fs.realpath(worktreePath),
        fs.realpath(root),
      ]);
      contained = isPathWithinRoots(realPath, [realRoot]);
    } catch (error: unknown) {
      // degradation-audit: reported - an unresolvable path cannot be proven
      // inside the root, so it is rolled back and refused below.
      this.log(
        `could not resolve ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!contained) {
      return this.failAfterAdd(
        worktree,
        'worktree-outside-workspace',
        `the worktree ${worktreePath} does not resolve inside ${root}`,
      );
    }

    this.log(`created ${worktreePath} on ${branch} at ${baseSha}`);
    return { ok: true, worktree };
  }

  /** Roll back whatever the add left behind, then refuse with the steps. */
  private async failAfterAdd(
    worktree: ChildWorktree,
    refusal: ChildWorktreeRefusal,
    detail: string,
  ): Promise<ChildWorktreeCreateResult> {
    this.log(`${refusal} for ${worktree.worktreePath}: ${detail}`);
    const rollback = await this.rollbackPartial(worktree);
    return { ok: false, refusal, detail, rollback };
  }

  /**
   * After a failed add only what exists is removed: the directory and the
   * branch were both absent before this call, so anything there now is ours.
   */
  private async rollbackPartial(
    worktree: ChildWorktree,
  ): Promise<readonly SessionChildRollbackStep[]> {
    const steps: SessionChildRollbackStep[] = [];
    if (await pathExists(worktree.worktreePath)) {
      steps.push(
        await this.step(
          'remove-worktree',
          ['worktree', 'remove', '--force', worktree.worktreePath],
          worktree.root,
        ),
      );
    }
    if (await this.branchExists(worktree)) {
      steps.push(
        await this.step(
          'delete-branch',
          ['branch', '-D', worktree.branch],
          worktree.root,
        ),
      );
    }
    return steps;
  }

  /** Unknown (git failed) counts as present, so the delete is attempted and reported. */
  private async branchExists(worktree: ChildWorktree): Promise<boolean> {
    try {
      const result = await this.git(
        ['rev-parse', '--verify', '--quiet', `refs/heads/${worktree.branch}`],
        worktree.root,
      );
      return result.exitCode === 0;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - an unknown answer degrades
      // to attempting the delete, whose own outcome is reported.
      this.log(
        `could not check branch ${worktree.branch}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
  }

  private async step(
    name: SessionChildRollbackStep['step'],
    args: string[],
    cwd: string,
  ): Promise<SessionChildRollbackStep> {
    try {
      const result = await this.git(args, cwd);
      if (result.exitCode === 0) return { step: name, ok: true };
      const detail =
        result.stderr.trim() || `git ${args[0]} exited ${result.exitCode}`;
      this.log(`rollback ${name} failed: ${detail}`);
      return { step: name, ok: false, detail };
    } catch (error: unknown) {
      // degradation-audit: reported - a rollback step never throws; its
      // failure is returned in the step list the caller shows the user.
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`rollback ${name} failed: ${detail}`);
      return { step: name, ok: false, detail };
    }
  }

  private git(args: string[], cwd: string) {
    return execGit(args, cwd, {
      timeoutMs: WORKTREE_GIT_TIMEOUT_MS,
      ...(this.spawner ? { spawner: this.spawner } : {}),
    });
  }

  private log(message: string): void {
    this.output.appendLine(`${LOG_PREFIX} ${message}`);
  }
}

function refuse(
  refusal: ChildWorktreeRefusal,
  detail: string,
): ChildWorktreeCreateResult {
  return { ok: false, refusal, detail };
}

function stderrSuffix(stderr: string): string {
  const text = stderr.trim();
  return text ? `: ${text}` : '';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (error: unknown) {
    // degradation-audit: optional-capability - only ENOENT means "absent";
    // any other error is treated as "present" so nothing is overwritten.
    return (error as NodeJS.ErrnoException)?.code !== 'ENOENT';
  }
}
