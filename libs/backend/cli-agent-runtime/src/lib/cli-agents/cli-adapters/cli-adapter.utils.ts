/**
 * Shared CLI Adapter Utilities
 *
 * Cross-platform foundation using:
 * - `cross-spawn`: Transparent .cmd wrapper handling on Windows (no shell: true needed)
 * - `which`: Library-based binary resolution (no subprocess, no \r issues)
 */
import crossSpawn from 'cross-spawn';
import whichLib from 'which';
import { readFile } from 'fs/promises';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import type { CliCommandOptions } from './cli-adapter.interface';

/**
 * Strip ANSI escape codes from CLI output.
 * Used by all CLI adapters to clean raw terminal output.
 */
export function stripAnsiCodes(str: string): string {
  /* eslint-disable no-control-regex */
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '');
  /* eslint-enable no-control-regex */
}

/**
 * Cross-platform binary resolution. Returns full path or null.
 * Uses `which` npm package — no subprocess, no \r issues.
 */
export async function resolveCliPath(binary: string): Promise<string | null> {
  try {
    return await whichLib(binary);
  } catch {
    return null;
  }
}

/**
 * Cross-platform spawn. Uses `cross-spawn` — transparent .cmd handling on Windows.
 * No shell: true needed, no argument mangling.
 *
 * @param options.needsConsole - When true, ensures the child process gets its own
 *   console window (hidden). Required for CLIs that use node-pty/ConPTY internally
 *   for shell command execution. Without a console, ConPTY's
 *   AttachConsole() fails on Windows, breaking shell command execution.
 */
export function spawnCli(
  binary: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; needsConsole?: boolean },
): ChildProcess {
  return crossSpawn(binary, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...CLI_CLEAN_ENV, ...options.env },
    ...(options.needsConsole && process.platform === 'win32'
      ? { windowsHide: false }
      : {}),
  });
}

/**
 * Environment variables to suppress ANSI escape codes and color output
 * at the source. Prevents noisy output from CLI tools.
 */
export const CLI_CLEAN_ENV: Record<string, string> = {
  FORCE_COLOR: '0',
  NO_COLOR: '1',
  NODE_NO_READLINE: '1',
};

/**
 * Cross-platform `--version` probe. Routes through `spawnCli` (cross-spawn)
 * so Windows .cmd/.bat/.ps1 wrappers work — Node 18.20+/Electron 30+ refuse
 * `execFile` on those (CVE-2024-27980). On macOS/Linux behaves identically
 * to a plain `child_process.spawn` of the binary.
 *
 * Never throws. Returns the first non-empty stdout line on success, or
 * `undefined` if the probe times out, errors, or produces no output.
 * Callers should treat presence of the binary on PATH as the source of
 * truth for "installed" and use the returned version as a best-effort
 * UX hint.
 */
export function probeCliVersion(
  binary: string,
  args: string[] = ['--version'],
  timeoutMs = 5000,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stdout = '';
    const child = spawnCli(binary, args, {});

    const timer = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => {
      stdout += data;
    });
    child.on('close', () => {
      clearTimeout(timer);
      const trimmed = stdout.trim().split(/\r?\n/)[0];
      resolve(trimmed || undefined);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

/**
 * Build a task prompt string from CLI command options.
 * Optionally prepends system prompt or project-specific guidance from enhanced prompts.
 * Prefers systemPrompt (full prompt harness) over projectGuidance when available.
 * Appends file context and task folder instructions to the base task.
 *
 * Adapters with native system prompt support (Copilot via systemMessage)
 * should strip both systemPrompt and projectGuidance
 * before calling this function to avoid duplication.
 */
export function buildTaskPrompt(options: CliCommandOptions): string {
  let taskPrompt = '';
  const systemContext = options.systemPrompt || options.projectGuidance;
  if (systemContext) {
    taskPrompt += systemContext + '\n\n---\n\n';
  }

  taskPrompt += options.task;

  if (options.files && options.files.length > 0) {
    taskPrompt += `\n\nFocus on these files:\n${options.files
      .map((f) => `- ${f}`)
      .join('\n')}`;
  }

  if (options.taskFolder) {
    taskPrompt += `\n\nWrite deliverable files to: ${options.taskFolder}`;
    taskPrompt += `\nUse convention: ${options.taskFolder}/agent-output-{agentId}.md for main deliverable.`;
  }

  return taskPrompt;
}

/**
 * On Windows, npm-installed CLIs are .cmd wrapper scripts that cannot be
 * executed by bare `spawn()` (results in EINVAL). This parses the .cmd
 * wrapper to extract the actual underlying script or binary path.
 *
 * npm .cmd wrappers reference the real target as `"%dp0%\<relative_path>"`.
 * We extract the last such reference (the actual binary/script invocation).
 *
 * Returns the original path unchanged on non-Windows or non-.cmd paths.
 */
export async function resolveWindowsCmd(binaryPath: string): Promise<string> {
  if (process.platform !== 'win32') return binaryPath;
  if (!binaryPath.toLowerCase().endsWith('.cmd')) return binaryPath;

  const content = await readFile(binaryPath, 'utf8');
  const dir = path.dirname(binaryPath);
  const regex = /"%(?:~dp0|dp0)%\\([^"]+)"/g;
  let lastMatch: string | null = null;
  let m;
  while ((m = regex.exec(content)) !== null) {
    lastMatch = m[1];
  }

  if (lastMatch) {
    return path.join(dir, lastMatch);
  }

  return binaryPath;
}

/**
 * Resolve a Windows `.cmd` npm wrapper to a direct `node <entrypoint>` spawn.
 *
 * `cross-spawn` runs `.cmd` wrappers through `cmd.exe /c`, which caps the whole
 * command line at 8,191 chars and re-tokenizes it on whitespace. Adapters that
 * pass the prompt via argv (Copilot's `-p <prompt>`) overflow that cap and fail
 * with "The command line is too long." Spawning the wrapper's node entrypoint
 * directly goes through CreateProcess instead (~32 KB limit) and preserves the
 * prompt as a single argv element.
 *
 * Returns `{ command, prefixArgs }` — prepend `prefixArgs` to the CLI's own
 * args. Falls back to the binary unchanged off-Windows, for non-`.cmd` paths,
 * or when the wrapper cannot be parsed.
 */
export async function resolveDirectSpawn(
  binaryPath: string,
): Promise<{ command: string; prefixArgs: string[] }> {
  if (
    process.platform !== 'win32' ||
    !binaryPath.toLowerCase().endsWith('.cmd')
  ) {
    return { command: binaryPath, prefixArgs: [] };
  }

  try {
    const target = await resolveWindowsCmd(binaryPath);
    if (target.toLowerCase().endsWith('.js')) {
      const node = (await resolveCliPath('node')) ?? 'node';
      return { command: node, prefixArgs: [target] };
    }
    return { command: target, prefixArgs: [] };
  } catch {
    return { command: binaryPath, prefixArgs: [] };
  }
}
