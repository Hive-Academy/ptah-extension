import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

let resolvedGit: string | undefined;

/** Resolves and validates git once, so invocations never delegate command lookup to PATH. */
export function getGitExecutable(): string {
  resolvedGit ??= resolveGitExecutable();
  return resolvedGit;
}

function resolveGitExecutable(): string {
  const configured = process.env['GIT_PATH']?.trim();
  const candidate = configured ? normalizePath(configured) : findGitOnPath();
  if (!candidate)
    throw new Error('Unable to find git: set GIT_PATH or make git available on PATH.');
  const executable = isAbsolute(candidate) ? candidate : resolve(candidate);
  try {
    execFileSync(executable, ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to run git at ${executable}: ${detail}.`, {
      cause: error,
    });
  }
  return executable;
}

function normalizePath(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function findGitOnPath(): string | undefined {
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    const candidates = execFileSync(lookup, ['git'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return process.platform === 'win32'
      ? candidates.find((candidate) => /\.exe$/iu.test(candidate))
      : candidates[0];
  } catch {
    return undefined;
  }
}
