/**
 * Shared CLI Adapter Utilities
 * TASK_2025_157: Common functions extracted from individual CLI adapters
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
  // Strip CSI sequences (e.g., colors, cursor moves) and ESC()/ESC[/ charset
  // selection codes (e.g., `\x1b(B`, `\x1b)0`) emitted by some terminals on
  // Linux/macOS that would otherwise show up as garbled `(B` text in output.
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
 *   (e.g., Gemini CLI's run_shell_command). Without a console, ConPTY's
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
    // On Windows, CLIs that use node-pty/ConPTY for shell execution (Gemini)
    // need a console. Piped stdio with CREATE_NO_WINDOW prevents this.
    // windowsHide: false ALLOCATES (rather than hides) a console for the
    // child process. Despite the name reading as "show the window", Node's
    // semantics are: `false` = do NOT pass CREATE_NO_WINDOW, so the child
    // inherits/allocates a console. The console is still hidden from the user
    // because we don't connect stdio to a TTY — node-pty's ConPTY can then
    // call AttachConsole() successfully. On Unix this option is ignored, so
    // the gating on win32 is purely for documentation.
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
 * Build a task prompt string from CLI command options.
 * Optionally prepends system prompt or project-specific guidance from enhanced prompts.
 * Prefers systemPrompt (full prompt harness) over projectGuidance when available.
 * Appends file context and task folder instructions to the base task.
 *
 * Adapters with native system prompt support (Gemini via GEMINI_SYSTEM_MD,
 * Copilot via systemMessage) should strip both systemPrompt and projectGuidance
 * before calling this function to avoid duplication.
 */
export function buildTaskPrompt(options: CliCommandOptions): string {
  let taskPrompt = '';

  // Prepend system prompt (full harness, premium) or project guidance (fallback)
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

  try {
    const content = await readFile(binaryPath, 'utf8');
    const dir = path.dirname(binaryPath);

    // npm .cmd wrappers use %~dp0 or %dp0% as the wrapper's directory.
    // The actual target is the last "%~dp0\<path>" or "%dp0%\<path>" reference.
    const regex = /"%(?:~dp0|dp0)%\\([^"]+)"/g;
    let lastMatch: string | null = null;
    let m;
    while ((m = regex.exec(content)) !== null) {
      lastMatch = m[1];
    }

    if (lastMatch) {
      return path.join(dir, lastMatch);
    }
  } catch {
    // Can't read/parse .cmd file — fall through to original
  }

  return binaryPath;
}
