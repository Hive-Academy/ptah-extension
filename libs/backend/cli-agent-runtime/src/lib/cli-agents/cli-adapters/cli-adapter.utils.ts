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
import { killProcessTree } from '@ptah-extension/platform-core';
import type {
  IProcessSpawner,
  ProcessErrorListener,
  ProcessExitListener,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import type {
  AgentRoleDefinition,
  CliTarget,
  CliType,
} from '@ptah-extension/shared';
import { transformAgentBody } from '@ptah-extension/harness-sync';
import type { CliCommandOptions } from './cli-adapter.interface';

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
    // degradation-audit: optional-capability - per the doc comment on this
    // function, a missing binary on PATH is the documented "not installed"
    // case; the null return is the intended contract, not a hidden failure.
    return null;
  }
}

/** `ChildProcess.on` accepts this; the port's typed listeners cast into it. */
type RawListener = (...args: unknown[]) => void;

/**
 * A `SpawnedProcessHandle` over a real `ChildProcess`.
 *
 * This is what `spawnCli` returns when no spawner is injected, so the
 * no-spawner path is the `cross-spawn` call it always was and only the wrapper
 * around it is new. `whenSpawned` is already settled here: an inline spawn
 * knows its pid by the time it returns.
 */
class ChildProcessHandle implements SpawnedProcessHandle {
  readonly whenSpawned: Promise<number | null>;

  constructor(private readonly child: ChildProcess) {
    this.whenSpawned = Promise.resolve(child.pid ?? null);
  }

  get stdin(): NodeJS.WritableStream | null {
    return this.child.stdin;
  }

  get stdout(): NodeJS.ReadableStream | null {
    return this.child.stdout;
  }

  get stderr(): NodeJS.ReadableStream | null {
    return this.child.stderr;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get killed(): boolean {
    return this.child.killed;
  }

  get exitCode(): number | null {
    return this.child.exitCode;
  }

  kill(signal?: NodeJS.Signals): boolean {
    return this.child.kill(signal);
  }

  on(event: 'exit' | 'close', listener: ProcessExitListener): void;
  on(event: 'error', listener: ProcessErrorListener): void;
  on(
    event: 'exit' | 'close' | 'error',
    listener: ProcessExitListener | ProcessErrorListener,
  ): void {
    this.child.on(event as string, listener as unknown as RawListener);
  }

  once(event: 'exit' | 'close', listener: ProcessExitListener): void;
  once(event: 'error', listener: ProcessErrorListener): void;
  once(
    event: 'exit' | 'close' | 'error',
    listener: ProcessExitListener | ProcessErrorListener,
  ): void {
    this.child.once(event as string, listener as unknown as RawListener);
  }

  off(event: 'exit' | 'close', listener: ProcessExitListener): void;
  off(event: 'error', listener: ProcessErrorListener): void;
  off(
    event: 'exit' | 'close' | 'error',
    listener: ProcessExitListener | ProcessErrorListener,
  ): void {
    this.child.off(event as string, listener as unknown as RawListener);
  }
}

const WIN32_COMMAND_LINE_LIMIT = 32_767;
const WIN32_CMD_SHIM_COMMAND_LINE_LIMIT = 8_191;
const LINUX_ARG_BYTE_LIMIT = 131_071;
const DARWIN_ARGS_BYTE_LIMIT = 1_048_576 - 4_096;

export class CliCommandLineTooLongError extends Error {
  constructor(
    readonly measured: number,
    readonly limit: number,
    readonly largestArgIndex: number,
    largestArgSize: number,
    unit: 'UTF-16 units' | 'bytes',
  ) {
    super(
      `The command line is too long to start this agent: argument ${largestArgIndex} is ${largestArgSize} ${unit}, ` +
        `and the measured size is ${measured} ${unit} against a limit of ${limit}. ` +
        'Nothing was truncated and no process was started. ' +
        'To proceed, shorten the task, or use a lane whose role channel does not pass the prompt on the command line.',
    );
    this.name = 'CliCommandLineTooLongError';
  }
}

function libuvQuotedLength(arg: string): number {
  if (arg.length === 0) {
    return 2;
  }
  if (!/[\t "]/.test(arg)) {
    return arg.length;
  }
  if (!/["\\]/.test(arg)) {
    return arg.length + 2;
  }
  let length = 2;
  let quoteHit = true;
  for (let i = arg.length - 1; i >= 0; i--) {
    const ch = arg[i];
    length += 1;
    if (quoteHit && ch === '\\') {
      length += 1;
    } else if (ch === '"') {
      quoteHit = true;
      length += 1;
    } else {
      quoteHit = false;
    }
  }
  return length;
}

function indexOfLargest(sizes: readonly number[]): number {
  let largest = -1;
  for (let i = 0; i < sizes.length; i++) {
    if (largest === -1 || sizes[i] > sizes[largest]) {
      largest = i;
    }
  }
  return largest;
}

export function assertCommandLineWithinLimit(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32') {
    const argLengths = args.map(libuvQuotedLength);
    const measured =
      [libuvQuotedLength(command), ...argLengths].reduce(
        (total, length) => total + length,
        0,
      ) +
      args.length +
      1;
    const limit = /\.(cmd|bat)$/i.test(command)
      ? WIN32_CMD_SHIM_COMMAND_LINE_LIMIT
      : WIN32_COMMAND_LINE_LIMIT;
    if (measured > limit) {
      const largest = indexOfLargest(argLengths);
      throw new CliCommandLineTooLongError(
        measured,
        limit,
        largest,
        largest === -1 ? 0 : argLengths[largest],
        'UTF-16 units',
      );
    }
    return;
  }

  const argBytes = args.map((arg) => Buffer.byteLength(arg, 'utf8'));
  const largest = indexOfLargest(argBytes);
  const largestBytes = largest === -1 ? 0 : argBytes[largest];

  if (platform === 'darwin') {
    const measured = argBytes.reduce((total, bytes) => total + bytes, 0);
    if (measured > DARWIN_ARGS_BYTE_LIMIT) {
      throw new CliCommandLineTooLongError(
        measured,
        DARWIN_ARGS_BYTE_LIMIT,
        largest,
        largestBytes,
        'bytes',
      );
    }
    return;
  }

  if (largestBytes > LINUX_ARG_BYTE_LIMIT) {
    throw new CliCommandLineTooLongError(
      largestBytes,
      LINUX_ARG_BYTE_LIMIT,
      largest,
      largestBytes,
      'bytes',
    );
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
 * @param options.spawner - When supplied, the child is created on a worker
 *   thread instead of this one. `child_process.spawn` is a synchronous
 *   `CreateProcessW` on Windows whose cost tracks the binary's size, and the
 *   rival-CLI spawns measured 300-900 ms of event-loop lag each
 *   (TASK_2026_367). The spawner resolves the Windows `.cmd` wrapper itself,
 *   so the same `binary` is passed either way. Omitting it keeps today's
 *   inline `cross-spawn` behaviour exactly.
 */
export function spawnCli(
  binary: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    needsConsole?: boolean;
    detached?: boolean;
    spawner?: IProcessSpawner;
  },
): SpawnedProcessHandle {
  assertCommandLineWithinLimit(binary, args);
  const env = { ...process.env, ...CLI_CLEAN_ENV, ...options.env };
  // POSIX: make the child a process-group leader so killProcessTree() can
  // group-kill (process.kill(-pid)) its whole subtree. Opt-in — only the
  // long-lived main-run spawns request it; short-lived probes omit it to
  // avoid gaining orphan risk for no tree-kill benefit. No-op on Windows,
  // where taskkill /T walks real Win32 PID ancestry instead.
  const detached = process.platform !== 'win32' && options.detached === true;

  if (options.spawner) {
    return options.spawner.spawnProcess({
      command: binary,
      args,
      cwd: options.cwd,
      env,
      detached,
      needsConsole: options.needsConsole === true,
    });
  }

  return new ChildProcessHandle(
    crossSpawn(binary, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      detached,
      ...(options.needsConsole && process.platform === 'win32'
        ? { windowsHide: false }
        : {}),
    }),
  );
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
  spawner?: IProcessSpawner,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stdout = '';
    const child = spawnCli(binary, args, { spawner, detached: true });

    const timer = setTimeout(() => {
      void child.whenSpawned.then((pid) => {
        if (pid && !child.killed) {
          void killProcessTree(pid);
        }
      });
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

const NATIVE_AGENT_TOOL_POLICY =
  'Tool policy: prefer direct `ptah_*` tools over `execute_code`. `ptah.files` is read-only; use native CLI write/edit tools for file creation or edits, never `execute_code`.';

/**
 * What a SPAWNED agent is told about talking back to the session that spawned
 * it (TASK_2026_477). This is the CHILD half of the guidance; the parent half
 * is the agent-tool table in `vscode-lm-tools`'
 * `ptah-system-prompt.constant.ts`, and `.claude/skills/agent-lanes/SKILL.md`
 * is the operator-facing copy. All three must say the same things; this
 * constant is the one a spawned lane actually reads.
 *
 * Three rules bind the wording and none of them is stylistic:
 *
 * - **No vendor name.** A roster in a prompt goes stale between releases
 *   (`vendor-roster-drift.spec.ts`). The text points at `ptah_agent_list`.
 * - **No delivery mode described as available.** `ptah_agent_message` picks one
 *   of four modes per call from live capabilities, so the text tells the agent
 *   to read the mode it was returned rather than to expect one.
 * - **Bytes are argv.** This string is part of the command line on the
 *   task-prompt adapters and is measured against `assertCommandLineWithinLimit`
 *   (8,191 on the Windows `.cmd` fallback). Measured: it adds 826 bytes with
 *   its joining delimiter, pinned by `cli-adapter.utils.spec.ts`. Keep it
 *   short.
 *
 * It is emitted only when the run has BOTH an MCP port and an agent id, which
 * is the only condition under which the tools it names exist and a report can
 * be attributed.
 */
const TWO_WAY_MESSAGING_GUIDANCE =
  'Two-way messaging: you are a spawned agent and the session that spawned you can reach you.\n' +
  '- Report to it with `ptah_agent_report`. It takes no agent id. A `delivered: false` answer carries a reason and is a normal outcome — record it and carry on, do not retry in a loop.\n' +
  '- A message from that session can arrive between your turns. Treat it as an instruction from your caller; where it disagrees with the task text above, the message wins.\n' +
  '- You can spawn agents yourself with `ptah_agent_spawn`. Read `ptah_agent_list` for what exists on this machine: never assume a CLI, a provider or a messaging capability is present. Any name in a document is an illustration, never a guarantee.\n' +
  '- `ptah_agent_message` chooses its delivery mode per call and returns the mode it used. Read that returned mode; do not assume one.';

const PROMPT_SECTION_DELIMITER = '\n\n---\n\n';

const EMPTY_FRONTMATTER = '---\n\n---\n';

const ROLE_TRANSFORM_TARGETS: ReadonlySet<CliType> = new Set<CliTarget>([
  'codex',
  'copilot',
  'cursor',
  'antigravity',
]);

function isRoleTransformTarget(cli: CliType): cli is CliTarget {
  return ROLE_TRANSFORM_TARGETS.has(cli);
}

export function renderRoleBlock(
  role: AgentRoleDefinition,
  cli: CliType,
): string {
  const body = isRoleTransformTarget(cli)
    ? transformAgentBody(EMPTY_FRONTMATTER + role.body, cli)
    : role.body;
  return (
    `## Role: ${role.name}\n\n` +
    `You are running as the \`${role.name}\` role; the definition below governs this task and outranks any generic persona above.\n\n` +
    body
  );
}

/**
 * Build a task prompt string from CLI command options.
 * Optionally prepends system prompt or project-specific guidance from enhanced prompts.
 * Prefers systemPrompt (full prompt harness) over projectGuidance when available.
 * Appends the shared native-agent tool policy, file context, and task folder
 * instructions to the base task.
 *
 * Adapters with native system prompt support (Copilot via systemMessage)
 * should strip both systemPrompt and projectGuidance
 * before calling this function to avoid duplication.
 */
export function buildTaskPrompt(
  options: CliCommandOptions,
  cli?: CliType,
): string {
  let taskPrompt = '';
  const systemContext = options.systemPrompt || options.projectGuidance;
  if (systemContext) {
    taskPrompt += systemContext + PROMPT_SECTION_DELIMITER;
  }

  if (options.role) {
    if (!cli) {
      throw new Error(
        `buildTaskPrompt received role "${options.role.name}" without the CLI it is rendered for`,
      );
    }
    taskPrompt += renderRoleBlock(options.role, cli) + PROMPT_SECTION_DELIMITER;
  }

  taskPrompt += `${NATIVE_AGENT_TOOL_POLICY}\n\n${options.task}`;

  if (options.files && options.files.length > 0) {
    taskPrompt += `\n\nFocus on these files:\n${options.files
      .map((f) => `- ${f}`)
      .join('\n')}`;
  }

  if (options.taskFolder) {
    taskPrompt += `\n\nWrite deliverable files to: ${options.taskFolder}`;
    // The id is substituted here, and the line is omitted without one.
    // `agent-output-{agentId}.md` used to ship as a literal placeholder that
    // nothing ever filled: the spawned agent is not told its own id anywhere,
    // so it invented a value, and `agent-output-root.md` is the invention it
    // settled on (TASK_2026_477). The instruction is also subordinate to an
    // explicit filename in the task — the two used to compete, and a lane that
    // read both wrote both files.
    if (options.agentId) {
      taskPrompt += `\nIf the task above names no deliverable file, write the main deliverable to ${options.taskFolder}/agent-output-${options.agentId}.md. Do not invent another name.`;
    }
  }

  if (options.agentId && options.mcpPort !== undefined) {
    taskPrompt += PROMPT_SECTION_DELIMITER + TWO_WAY_MESSAGING_GUIDANCE;
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
 * Expand a native-binary candidate into the paths worth probing on disk.
 *
 * Electron packs app code into `app.asar`; `electron-builder`'s `asarUnpack`
 * copies native binaries into the sibling `app.asar.unpacked` tree. A path
 * inside `app.asar` still satisfies `existsSync` through the asar shim but
 * cannot be spawned, so any candidate landing there must also be probed as its
 * unpacked twin. Returns the candidate alone when it is not inside an asar.
 */
export function withAsarUnpackedTwin(candidate: string): string[] {
  const unpacked = candidate.replace(
    /app\.asar(?!\.unpacked)/,
    'app.asar.unpacked',
  );
  return unpacked === candidate ? [candidate] : [candidate, unpacked];
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
