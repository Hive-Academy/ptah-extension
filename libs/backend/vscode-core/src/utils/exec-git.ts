import crossSpawn from 'cross-spawn';
import { spawn } from 'child_process';

export const DEFAULT_GIT_TIMEOUT_MS = 10_000;
export const WORKTREE_GIT_TIMEOUT_MS = 300_000;

/**
 * Environment forced on every git invocation.
 *
 * - `LC_ALL` / `LANG` pin git's diagnostics to the C locale so callers may
 *   classify failures without parsing localized message text.
 * - `GIT_OPTIONAL_LOCKS=0` stops read-only commands (notably `git status`)
 *   from taking `.git/index.lock`, which otherwise feeds the file watcher a
 *   change event for every status poll.
 *
 * Caller-supplied `env` entries win, so a call site that genuinely needs a
 * different locale can still ask for one.
 */
const GIT_DETERMINISTIC_ENV: Readonly<Record<string, string>> = {
  LC_ALL: 'C',
  LANG: 'C',
  GIT_OPTIONAL_LOCKS: '0',
};

export interface ExecGitOptions {
  timeoutMs?: number;
  /**
   * Payload written to the child's stdin before the pipe is closed. Required
   * by subcommands that read a patch or blob from standard input
   * (`git apply -`, `git hash-object --stdin`).
   *
   * When omitted, stdin is closed immediately: git subcommands that read
   * stdin would otherwise block forever on a pipe nobody ever ends.
   */
  stdin?: string | Buffer;
  /** Extra environment entries merged over {@link GIT_DETERMINISTIC_ENV}. */
  env?: NodeJS.ProcessEnv;
}

export interface ExecGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecGitBufferResult {
  /** Raw stdout bytes — never decoded, so binary blobs survive intact. */
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        /* taskkill not available; child.kill above is best-effort */
      });
    } catch {
      /* swallow — child.kill() was already attempted by caller */
    }
  }
}

/**
 * Run git and return stdout as raw bytes.
 *
 * Chunks are accumulated and concatenated once at close rather than decoded
 * per chunk: a multi-byte UTF-8 sequence split across a stream chunk boundary
 * (which node's 64 KiB pipe reads make routine on files above ~64 KiB) would
 * otherwise decode to replacement characters on both sides of the split.
 *
 * Use this for blob reads (NUL-byte binary detection, exact byte lengths) and
 * content hashing. For text output prefer {@link execGit}.
 */
export function execGitBuffer(
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
): Promise<ExecGitBufferResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = crossSpawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...GIT_DETERMINISTIC_ENV, ...options?.env },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      killProcessTree(child.pid);
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000).unref?.();
      reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (data: Buffer) => {
      stdoutChunks.push(data);
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrChunks.push(data);
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? 1,
      });
    });

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    // Always close stdin. Git exiting before it drains the pipe raises EPIPE
    // on the writable side; that is expected and must not become an unhandled
    // error, so it is swallowed here — the exit code is the real signal.
    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', () => {
        /* EPIPE / ECONNRESET when git exits before reading its input */
      });
      if (options?.stdin !== undefined) {
        stdin.end(options.stdin);
      } else {
        stdin.end();
      }
    }
  });
}

/**
 * Run git and return stdout decoded as UTF-8.
 *
 * Thin wrapper over {@link execGitBuffer} — the decode happens once, over the
 * complete output, so chunk boundaries cannot corrupt multi-byte characters.
 */
export async function execGit(
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
): Promise<ExecGitResult> {
  const { stdout, stderr, exitCode } = await execGitBuffer(args, cwd, options);
  return { stdout: stdout.toString('utf8'), stderr, exitCode };
}
