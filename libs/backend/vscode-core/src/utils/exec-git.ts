import crossSpawn from 'cross-spawn';
import { spawn } from 'child_process';

export const DEFAULT_GIT_TIMEOUT_MS = 10_000;
export const WORKTREE_GIT_TIMEOUT_MS = 300_000;

export interface ExecGitOptions {
  timeoutMs?: number;
}

export interface ExecGitResult {
  stdout: string;
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

export function execGit(
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
): Promise<ExecGitResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = crossSpawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
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
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}
