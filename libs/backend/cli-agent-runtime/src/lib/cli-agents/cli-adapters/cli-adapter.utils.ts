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
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ChildProcess } from 'child_process';
import type { CliCommandOptions } from './cli-adapter.interface';
import { KILL_GRACE_PERIOD } from '../agent-process-manager-helpers';

const execFileAsync = promisify(execFile);

/**
 * Cross-platform best-effort process-tree kill.
 * Windows: `taskkill /T /F` walks real Win32 PID ancestry (reaches the real
 *   agent even when `pid` is a cross-spawn `cmd.exe` shim).
 * POSIX: `process.kill(-pid)` group-kill (requires `detached:true` at spawn),
 *   escalating to SIGKILL after KILL_GRACE_PERIOD; falls back to a single-process
 *   kill if no process group exists (ESRCH).
 *
 * The helper is best-effort — "already exited" is the success case in disguise.
 * Callers that need to record the failure (e.g. the manager's Sentry capture)
 * pass an `onError` callback; the helper never throws.
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM',
  onError?: (err: unknown) => void,
): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F']);
    } catch (err) {
      onError?.(err); // usually "already exited" — best-effort
    }
    return;
  }

  const killGroup = (sig: NodeJS.Signals): void => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        /* already exited */
      }
    }
  };

  killGroup(signal);

  // Poll liveness so we resolve near-instantly when the process dies (the common
  // case) instead of always blocking the full grace period. The helper only has
  // a pid, so it can't listen on a specific child's `exit` — `process.kill(pid, 0)`
  // is the bare-pid equivalent (throws ESRCH once the process is gone). Escalate
  // to SIGKILL only if it's still alive after KILL_GRACE_PERIOD.
  await new Promise<void>((resolve) => {
    const POLL_MS = 100;
    let waited = 0;
    const tick = (): void => {
      try {
        process.kill(pid, 0); // liveness probe — throws ESRCH once gone
      } catch {
        resolve();
        return;
      }
      waited += POLL_MS;
      if (waited >= KILL_GRACE_PERIOD) {
        try {
          killGroup('SIGKILL');
        } catch (err) {
          onError?.(err);
        }
        resolve();
        return;
      }
      setTimeout(tick, POLL_MS).unref?.();
    };
    setTimeout(tick, POLL_MS).unref?.();
  });
}

/**
 * A buffer-until-first-subscriber emitter. Items emitted before any
 * subscriber attaches are buffered and flushed (in order) to the first
 * subscriber; thereafter each emit fans out to all subscribers live. This is
 * the shared shape every CLI adapter uses for its `onOutput`/`onSegment`
 * channels so early output isn't dropped before the manager subscribes.
 */
export function createBufferedEmitter<T>(): {
  subscribe: (callback: (item: T) => void) => void;
  emit: (item: T) => void;
} {
  const buffer: T[] = [];
  const callbacks: Array<(item: T) => void> = [];
  const subscribe = (callback: (item: T) => void): void => {
    callbacks.push(callback);
    if (buffer.length > 0) {
      for (const buffered of buffer) callback(buffered);
      buffer.length = 0;
    }
  };
  const emit = (item: T): void => {
    if (callbacks.length === 0) {
      buffer.push(item);
    } else {
      for (const cb of callbacks) cb(item);
    }
  };
  return { subscribe, emit };
}

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
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    needsConsole?: boolean;
    detached?: boolean;
  },
): ChildProcess {
  return crossSpawn(binary, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...CLI_CLEAN_ENV, ...options.env },
    // POSIX: make the child a process-group leader so killProcessTree() can
    // group-kill (process.kill(-pid)) its whole subtree. Opt-in — only the
    // long-lived main-run spawns request it; short-lived probes omit it to
    // avoid gaining orphan risk for no tree-kill benefit. No-op on Windows,
    // where taskkill /T walks real Win32 PID ancestry instead.
    detached: process.platform !== 'win32' && options.detached === true,
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
