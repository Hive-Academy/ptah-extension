import { spawn } from 'node:child_process';

import { normalizePath } from '../metrics/retrieval-metrics';
import { findExecutablesOnPath } from '../utils/git-executable';

const MAX_BUFFER_BYTES = 512 * 1024 * 1024;

export interface RgRunOptions {
  cwd: string;
  timeoutMs: number;
}

export interface RgRunResult {
  stdout: string;
  exitCode: number;
  latencyMs: number;
  commandLine: string;
}

export type RgRunner = (
  args: readonly string[],
  options: RgRunOptions,
) => Promise<RgRunResult>;

export interface ResolveRgOptions {
  env?: NodeJS.ProcessEnv;
  lookup?: (command: string) => string | readonly string[] | undefined;
  /** Injected by tests; production always uses {@link process.platform}. */
  platform?: NodeJS.Platform;
}

export type RgPreflightRun = (
  executable: string,
  args: readonly string[],
) => Promise<void>;

/** Resolves rg deterministically so benchmark invocations remain reproducible. */
export function resolveRg(options: ResolveRgOptions = {}): string {
  const configured = (options.env ?? process.env)['RG_PATH'];
  if (configured?.trim()) {
    const value = configured.trim();
    return value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  }

  const lookup = options.lookup ?? findExecutablesOnPath;
  const found = lookup('rg');
  const candidates = (typeof found === 'string' ? [found] : (found ?? [])).map(
    (candidate) => candidate.trim(),
  );
  const resolved =
    (options.platform ?? process.platform) === 'win32'
      ? candidates.find((candidate) => /\.exe$/iu.test(candidate))
      : candidates.find((candidate) => candidate.length > 0);
  if (resolved !== undefined) return resolved;

  throw new Error(
    'Unable to find ripgrep: set RG_PATH or make rg available on PATH.',
  );
}

/** Verifies that the resolved executable can start before any benchmark host does. */
export async function assertRgRuns(
  executable: string,
  run: RgPreflightRun = runRgVersion,
): Promise<void> {
  try {
    await run(executable, ['--version']);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to run ripgrep at ${executable}: ${detail}. Set RG_PATH to a working executable.`,
      { cause: error },
    );
  }
}

/** Resolves, validates, and constructs the runner before benchmark hosts start. */
export async function createCheckedRgRunner(): Promise<RgRunner> {
  const executable = resolveRg();
  await assertRgRuns(executable);
  return createRgRunner(executable);
}

export function createRgRunner(executable = resolveRg()): RgRunner {
  return async (args, options) => {
    const startedAt = performance.now();
    const resolvedArgs = ensureSearchPath(args);
    const commandLine = [executable, ...resolvedArgs]
      .map(quoteForDisplay)
      .join(' ');

    return new Promise<RgRunResult>((resolve, reject) => {
      const child = spawn(executable, resolvedArgs, {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };
      const timeout = setTimeout(() => {
        child.kill();
        settle(() =>
          reject(new Error(`ripgrep timed out after ${options.timeoutMs}ms`)),
        );
      }, options.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      const appendOutput = (chunk: string, target: 'stdout' | 'stderr') => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > MAX_BUFFER_BYTES) {
          child.kill();
          settle(() =>
            reject(
              new Error(`ripgrep output exceeded 512 MiB: ${commandLine}`),
            ),
          );
          return;
        }
        if (target === 'stdout') stdout += chunk;
        else stderr += chunk;
      };
      child.stdout.on('data', (chunk: string) => appendOutput(chunk, 'stdout'));
      child.stderr.on('data', (chunk: string) => appendOutput(chunk, 'stderr'));
      child.on('error', (error) => settle(() => reject(error)));
      child.on('close', (exitCode) => {
        settle(() => {
          const latencyMs = performance.now() - startedAt;
          if (exitCode === 0 || exitCode === 1) {
            resolve({ stdout, exitCode, latencyMs, commandLine });
            return;
          }
          const detail = stderr.trim() || 'no stderr output';
          reject(new Error(`ripgrep exited with code ${exitCode}: ${detail}`));
        });
      });
    });
  };
}

/** Convenience entry point for callers that do not need to retain a runner. */
export async function runRg(
  args: readonly string[],
  options: RgRunOptions,
): Promise<RgRunResult> {
  return createRgRunner()(args, options);
}

/** Extracts stable workspace-relative match keys from ripgrep's JSON event stream. */
export function parseRgJsonMatchLines(
  stdout: string,
  workspaceRoot: string,
): string[] {
  const matches: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/u)) {
    if (!rawLine) continue;
    try {
      const event = JSON.parse(rawLine) as {
        type?: string;
        data?: { path?: { text?: string }; line_number?: number };
      };
      if (
        event.type === 'match' &&
        event.data?.path?.text !== undefined &&
        event.data.line_number !== undefined
      ) {
        matches.push(
          `${normalizePath(event.data.path.text, { workspaceRoot })}:${event.data.line_number}`,
        );
      }
    } catch {
      // rg can emit non-JSON diagnostics on stderr; stdout parsing stays best-effort.
    }
  }
  return matches;
}

function runRgVersion(
  executable: string,
  args: readonly string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };
    const timeout = setTimeout(() => {
      child.kill();
      settle(() => reject(new Error('timed out')));
    }, 5_000);
    child.on('error', (error) => settle(() => reject(error)));
    child.on('close', (exitCode) => {
      settle(() => {
        if (exitCode === 0) resolve();
        else reject(new Error(`exited with code ${exitCode}`));
      });
    });
  });
}

function quoteForDisplay(value: string): string {
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value;
}

function ensureSearchPath(args: readonly string[]): string[] {
  if (hasExplicitSearchPath(args)) return [...args];
  return [...args, '.'];
}

function hasExplicitSearchPath(args: readonly string[]): boolean {
  let positionalCount = 0;
  let patternProvidedByOption = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '-e' || argument === '--regexp') {
      patternProvidedByOption = true;
      index += 1;
      continue;
    }
    if (!argument.startsWith('-')) positionalCount += 1;
  }
  return patternProvidedByOption ? positionalCount >= 1 : positionalCount >= 2;
}
