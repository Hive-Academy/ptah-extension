import { execFileSync, spawn } from 'node:child_process';

import { normalizePath } from '../metrics/retrieval-metrics';

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
  lookup?: (command: string) => string | undefined;
}

/** Resolves rg deterministically so benchmark invocations remain reproducible. */
export function resolveRg(options: ResolveRgOptions = {}): string {
  const configured = (options.env ?? process.env)['RG_PATH'];
  if (configured?.trim()) return configured.trim();

  const lookup = options.lookup ?? lookupOnPath;
  const resolved = lookup('rg');
  if (resolved?.trim()) return resolved.trim();

  throw new Error(
    'Unable to find ripgrep: set RG_PATH or make rg available on PATH.',
  );
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

function lookupOnPath(command: string): string | undefined {
  try {
    const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
    const output = execFileSync(lookupCommand, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return output
      .split(/\r?\n/u)
      .find((line) => line.trim())
      ?.trim();
  } catch {
    return undefined;
  }
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
