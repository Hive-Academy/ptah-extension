import { execFile, spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { RepoIdentitySchema, type RepoIdentity } from '@ptah-extension/review-contracts';
import type { IReviewCommandRunner, ReviewCommandResult, ReviewRoots } from '@ptah-extension/review-core';

const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_INDEX_OUTPUT_BYTES = 16_000_000;
const execFileAsync = promisify(execFile);
const invocationSchema = z.object({
  command: z.string().min(1).max(260),
  args: z.array(z.string().max(4096)).max(200),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().min(1).max(600_000),
}).strict();

/**
 * Read-only or self-limiting git commands the worktree service runs from the
 * repository root before it creates an attempt tree: probe the PR head, fetch
 * the PR ref when the head is missing, and prune a failed worktree record.
 */
function isRepositoryRootGitCommand(command: string, args: readonly string[]): boolean {
  if (command !== 'git') return false;
  if (args.length === 3 && args[0] === 'cat-file' && args[1] === '-e')
    return /^[a-f0-9]{40}\^\{commit\}$/i.test(args[2]);
  if (args.length === 4 && args[0] === 'fetch' && args[1] === '--no-tags' && args[2] === 'origin')
    return /^\+refs\/pull\/[1-9][0-9]{0,9}\/head$/.test(args[3]);
  return args.length === 2 && args[0] === 'worktree' && args[1] === 'prune';
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Runs review commands only from the repository checkout or an attempt's src tree. */
export class ReviewCommandScopeError extends Error {
  readonly code = 'review-command-cwd-outside-roots';
  constructor() { super('Review command cwd is outside claim roots'); }
}

export class ReviewCommandRunner implements IReviewCommandRunner {
  constructor(private readonly roots: (repo: RepoIdentity) => Promise<ReviewRoots>) {}

  /** Bootstrap probe: the resolver supplies the active workspace root before claim roots are trusted. */
  static async inspectCheckout(cwd: string): Promise<{ topLevel: string; origin: string }> {
    const directory = await realpath(cwd);
    const [{ stdout: topLevel }, { stdout: origin }] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--show-toplevel'],
        { cwd: directory, timeout: 15_000, maxBuffer: 16_384, windowsHide: true, shell: false }),
      execFileAsync('git', ['remote', 'get-url', 'origin'],
        { cwd: directory, timeout: 15_000, maxBuffer: 16_384, windowsHide: true, shell: false }),
    ]);
    return { topLevel, origin };
  }

  async run(repo: RepoIdentity, command: string, args: readonly string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ReviewCommandResult> {
    if (signal?.aborted) throw new Error('Review command aborted');
    const identity = RepoIdentitySchema.safeParse(repo);
    if (!identity.success) throw new ReviewCommandScopeError();
    const input = invocationSchema.parse({ command, args: [...args], cwd, timeoutMs });
    const roots = await this.roots(identity.data);
    let repository: string;
    let attempts: string;
    let directory: string;
    try {
      [repository, attempts, directory] = await Promise.all([
        realpath(roots.repoRoot), realpath(roots.attemptsRoot), realpath(input.cwd),
      ]);
    } catch { throw new ReviewCommandScopeError(); }
    const worktreeCommand = command === 'git' && args[0] === 'worktree' &&
      (args[1] === 'add' || args[1] === 'remove');
    if (worktreeCommand) {
      const add = args[1] === 'add';
      const target = add && args.length === 5 && args[2] === '--detach' && /^[a-f0-9]{40}$/i.test(args[4])
        ? args[3] : !add && args.length === 4 && args[2] === '--force' ? args[3] : null;
      if (!target || !isAbsolute(target) || basename(target) !== 'src' || resolve(target) !== target)
        throw new ReviewCommandScopeError();
      let parent: string;
      try { parent = await realpath(dirname(target)); } catch { throw new ReviewCommandScopeError(); }
      const attemptId = relative(attempts, parent);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(attemptId) || !inside(attempts, parent)) throw new ReviewCommandScopeError();
      if (!add) {
        try { if (await realpath(target) !== target) throw new ReviewCommandScopeError(); }
        catch { throw new ReviewCommandScopeError(); }
      }
    }
    const attemptRelative = relative(attempts, directory).split(sep);
    const attemptSrc = inside(attempts, directory) && attemptRelative.length >= 2 &&
      /^[A-Za-z0-9_-]{1,64}$/.test(attemptRelative[0]) && attemptRelative[1] === 'src';
    const repositoryRootCommand = directory === repository &&
      (worktreeCommand || isRepositoryRootGitCommand(input.command, input.args));
    if (!repositoryRootCommand && !attemptSrc)
      throw new ReviewCommandScopeError();
    if (resolve(input.cwd) !== directory) throw new ReviewCommandScopeError();

    if (signal?.aborted) throw new Error('Review command aborted');
    return new Promise<ReviewCommandResult>((settle) => {
      const maxOutputBytes = input.command === 'git' && input.args.length === 3 &&
        input.args[0] === 'ls-files' && input.args[1] === '-s' && input.args[2] === '-z'
        ? MAX_INDEX_OUTPUT_BYTES : MAX_OUTPUT_BYTES;
      const child = spawn(input.command, input.args, { cwd: directory, shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      let timedOut = false;
      let finished = false;
      const abort = (): void => { timedOut = true; child.kill(); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(() => {
        if (child.exitCode !== null) return;
        timedOut = true;
        child.kill();
      }, input.timeoutMs);
      child.once('exit', () => clearTimeout(timer));
      const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        const value = (target === 'stdout' ? stdoutDecoder : stderrDecoder).write(chunk);
        if (target === 'stdout') stdout = (stdout + value).slice(0, maxOutputBytes);
        else stderr = (stderr + value).slice(0, maxOutputBytes);
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >= maxOutputBytes || Buffer.byteLength(value) > maxOutputBytes) {
          timedOut = true;
          child.kill();
        }
      };
      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
      child.once('error', (error: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        settle({ exitCode: null, stdout, stderr, timedOut, unavailable: error.message });
      });
      child.once('close', (exitCode) => {
        if (finished) return;
        finished = true;
        stdout += stdoutDecoder.end();
        stderr += stderrDecoder.end();
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        settle({ exitCode, stdout, stderr, timedOut });
      });
    });
  }
}
