import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const resolvedExecutables = new Map<string, string>();

/** Resolves and validates git once, so invocations never delegate command lookup to PATH. */
export function getGitExecutable(): string {
  return resolveExecutable('git', 'GIT_PATH');
}

/** Resolves and validates GitHub CLI once, so invocations never delegate command lookup to PATH. */
export function getGhExecutable(): string {
  return resolveExecutable('gh', 'GH_PATH');
}

/** Resolves and validates an executable once, so invocations never delegate command lookup to PATH. */
export function resolveExecutable(name: string, envVar: string): string {
  const cached = resolvedExecutables.get(name);
  if (cached) return cached;

  const configured = process.env[envVar]?.trim();
  const candidate = configured
    ? normalizePath(configured)
    : findExecutableOnPath(name);
  if (!candidate)
    throw new Error(
      `Unable to find ${name}: set ${envVar} or make ${name} available on PATH.`,
    );
  const executable = isAbsolute(candidate) ? candidate : resolve(candidate);
  try {
    execFileSync(executable, ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to run ${name} at ${executable}: ${detail}.`, {
      cause: error,
    });
  }
  resolvedExecutables.set(name, executable);
  return executable;
}

function normalizePath(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function findExecutableOnPath(name: string): string | undefined {
  const candidates = findExecutablesOnPath(name);
  return process.platform === 'win32'
    ? candidates.find((candidate) => /\.exe$/iu.test(candidate))
    : candidates[0];
}

/** Looks up an executable on PATH. Command lookup is deliberately centralized here. */
export function findExecutablesOnPath(name: string): string[] {
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(lookup, [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
