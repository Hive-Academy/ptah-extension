import * as os from 'node:os';
import * as path from 'node:path';
import type { EditorTarget } from '../interfaces/editor-launcher.interface';
import type {
  IProcessSpawner,
  ProcessErrorListener,
  ProcessExitListener,
  SpawnedProcessHandle,
} from '../interfaces/process-spawner.interface';

/** Display name of the `terminal` editor target on every host. */
export const TERMINAL_DISPLAY_NAME = 'Terminal';

/** The command the PATH pass of detection looks for, per host OS. */
export function terminalCommand(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'git-bash';
  if (platform === 'darwin') return 'open';
  return 'x-terminal-emulator';
}

/**
 * Where an external terminal launcher may live, in preference order.
 *
 * Windows: Git Bash beside the git install found on PATH (`Git\cmd`,
 * `Git\bin`, `Git\mingw64\bin` all sit under the folder holding
 * `git-bash.exe`), then the conventional Git for Windows install folders, then
 * Windows Terminal's app alias, then `cmd.exe`. macOS: `open` (which starts
 * Terminal.app). Linux: the Debian alternatives link, then common emulators.
 *
 * Detection probes each path; only an existing executable becomes a target.
 */
export function terminalExecutableCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly string[] {
  if (platform === 'darwin') return ['/usr/bin/open'];
  if (platform !== 'win32') {
    return [
      '/usr/bin/x-terminal-emulator',
      '/usr/bin/gnome-terminal',
      '/usr/bin/konsole',
      '/usr/bin/xfce4-terminal',
      '/usr/bin/xterm',
    ];
  }

  const win = path.win32;
  const localAppData =
    env['LOCALAPPDATA'] ?? win.join(homeDir, 'AppData', 'Local');
  const candidates: string[] = [];

  const pathValue = env['PATH'] ?? env['Path'] ?? '';
  for (const directory of pathValue.split(';').filter(Boolean)) {
    const name = win.basename(directory).toLowerCase();
    if (name !== 'cmd' && name !== 'bin') continue;
    const parent = win.dirname(directory);
    const gitRoot =
      win.basename(parent).toLowerCase() === 'mingw64'
        ? win.dirname(parent)
        : parent;
    candidates.push(win.join(gitRoot, 'git-bash.exe'));
  }

  for (const programFiles of [
    env['ProgramFiles'] ?? 'C:\\Program Files',
    env['ProgramW6432'],
    env['ProgramFiles(x86)'],
  ]) {
    if (programFiles)
      candidates.push(win.join(programFiles, 'Git', 'git-bash.exe'));
  }
  candidates.push(win.join(localAppData, 'Programs', 'Git', 'git-bash.exe'));
  candidates.push(win.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe'));
  candidates.push(
    env['ComSpec'] ??
      win.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe'),
  );

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = win.normalize(candidate).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The argv, cwd and console mode one terminal launch uses. */
export interface TerminalLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly detached: boolean;
  readonly needsConsole: boolean;
}

function launcherName(executablePath: string): string {
  const base = executablePath.split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/\.exe$/, '');
}

/**
 * Build the launch for a detected terminal.
 *
 * Every argument is an argv element — nothing is joined into a shell string.
 * `wt.exe` and `cmd.exe` receive NO path at all: both start in `cwd`, which
 * keeps the root away from `wt`'s `;` sub-command parser and from `cmd`'s own
 * command-line re-parsing.
 *
 * Windows GUI launchers (`git-bash.exe`, `wt.exe`) get `needsConsole` so the
 * spawner does not start them hidden; the `cmd.exe /c start` trampoline stays
 * hidden and `start` opens the visible console.
 */
export function prepareTerminalLaunch(
  target: EditorTarget,
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): TerminalLaunch {
  if (target.id !== 'terminal')
    throw new Error(`${target.displayName} is not a terminal`);
  if (!target.executablePath)
    throw new Error(`${target.displayName} has no executable launch path`);
  if (!path.isAbsolute(workspaceRoot))
    throw new Error('Workspace root must be absolute');
  if (!path.isAbsolute(target.executablePath))
    throw new Error('Terminal executable must be absolute');

  const cwd = path.normalize(workspaceRoot);
  const command = path.normalize(target.executablePath);
  const detached = platform !== 'win32';
  const base = { command, cwd, detached };

  switch (launcherName(command)) {
    case 'git-bash':
      return { ...base, args: [`--cd=${cwd}`], needsConsole: true };
    case 'wt':
      return { ...base, args: ['-d', '.'], needsConsole: true };
    case 'cmd':
      return {
        ...base,
        args: ['/d', '/c', 'start', '', 'cmd.exe'],
        needsConsole: false,
      };
    case 'open':
      return { ...base, args: ['-a', 'Terminal', cwd], needsConsole: false };
    case 'gnome-terminal':
    case 'xfce4-terminal':
      return {
        ...base,
        args: [`--working-directory=${cwd}`],
        needsConsole: false,
      };
    case 'konsole':
      return { ...base, args: ['--workdir', cwd], needsConsole: false };
    default:
      // x-terminal-emulator, xterm and anything else start in their cwd.
      return { ...base, args: [], needsConsole: false };
  }
}

/**
 * How long a freshly started terminal candidate is watched for an early exit.
 *
 * The window has to cover the stub's error print (`wt.exe`'s app alias with an
 * uninstalled package starts, prints and exits within a few hundred
 * milliseconds), and it is the price every healthy GUI terminal adds to the
 * launch call. 1.5 s keeps both inside budget.
 */
export const TERMINAL_EXIT_PROBE_MS = 1500;

/**
 * Launch a detected external terminal at `workspaceRoot`.
 *
 * Goes through the host's `IProcessSpawner` like every editor launch. POSIX
 * launches are detached (own process group), so closing Ptah leaves the
 * terminal open. The port exposes no `unref`; the spawner owns the child's
 * lifetime bookkeeping.
 *
 * The detected executable is only the FIRST candidate. Every platform's
 * built-in list ({@link terminalExecutableCandidates}) supplies the rest, and
 * a candidate that never starts, reports an `error`, or exits non-zero inside
 * {@link TERMINAL_EXIT_PROBE_MS} hands the launch to the next one — the
 * broken `WindowsApps\wt.exe` app-alias stub is exactly such a start-then-die.
 * Every candidate is watched, including the last one: a process that starts
 * and then dies inside the probe window is still a failed launch even when no
 * fallback remains.
 * This is the ONE fallback location; the RPC layer does not retry candidates.
 */
export async function spawnTerminalProcess(
  spawner: IProcessSpawner,
  target: EditorTarget,
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const candidatePaths: string[] = [];
  const executablePath = target.executablePath;
  if (executablePath) {
    candidatePaths.push(executablePath);
    const all = terminalExecutableCandidates(
      platform,
      process.env,
      os.homedir(),
    );
    const targetIndex = all.findIndex(
      (candidate) =>
        normalizeForComparison(candidate, platform) ===
        normalizeForComparison(executablePath, platform),
    );
    const fallbackStart = targetIndex >= 0 ? targetIndex + 1 : 0;
    for (let i = fallbackStart; i < all.length; i++) {
      const nextCandidate = all[i];
      if (!candidatePaths.includes(nextCandidate)) {
        candidatePaths.push(nextCandidate);
      }
    }
  }

  if (candidatePaths.length === 0) {
    const launch = prepareTerminalLaunch(target, workspaceRoot, platform);
    const handle = spawner.spawnProcess({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: process.env,
      detached: launch.detached,
      needsConsole: launch.needsConsole,
    });
    if ((await handle.whenSpawned) === null)
      throw new Error(`Failed to launch ${target.displayName}`);
    return;
  }

  let lastError: Error | undefined;
  for (const candidatePath of candidatePaths) {
    try {
      const candidateTarget: EditorTarget = {
        ...target,
        executablePath: candidatePath,
      };
      const launch = prepareTerminalLaunch(
        candidateTarget,
        workspaceRoot,
        platform,
      );
      const handle = spawner.spawnProcess({
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        env: process.env,
        detached: launch.detached,
        needsConsole: launch.needsConsole,
      });
      const pid = await handle.whenSpawned;
      if (pid !== null && !(await exitsInsideProbeWindow(handle))) {
        return;
      }
      lastError = new Error(`Failed to launch ${target.displayName}`);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`Failed to launch ${target.displayName}`);
}

/**
 * One candidate path compared the way the built-in list is compared: Windows
 * paths case-insensitively through `path.win32`, POSIX paths through
 * `path.posix`.
 */
function normalizeForComparison(
  candidatePath: string,
  platform: NodeJS.Platform,
): string {
  const normalized = (platform === 'win32' ? path.win32 : path.posix).normalize(
    candidatePath,
  );
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Watch a freshly started candidate for {@link TERMINAL_EXIT_PROBE_MS} and
 * decide whether it died inside the window.
 *
 * Resolves `true` (failed, next candidate) on an `error` or an exit with any
 * code but `0`. Resolves `false` (stable) once the window passes with the
 * child alive, or the child exits `0`: `git-bash.exe`, the `cmd.exe /c start`
 * trampoline and a healthy `wt.exe` app alias all exit `0` at once on purpose
 * once the terminal they hand the request to owns it, and that is a working
 * launch. A `WindowsApps` alias whose package is missing exits NON-zero, so
 * the exit code alone separates the two — inferring breakage from the alias
 * path would send a good Windows Terminal launch on to `cmd.exe` and open two
 * windows.
 *
 * Everything comes off the `IProcessSpawner`'s handle — `exitCode` covers the
 * child that died between `whenSpawned` and the listeners, the listeners
 * cover the rest, and the timer never keeps the host alive past a quit.
 */
function exitsInsideProbeWindow(
  handle: SpawnedProcessHandle,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handle.off('exit', onExit);
      handle.off('error', onError);
      resolve(failed);
    };
    const onExit: ProcessExitListener = (code) => {
      finish(code !== 0);
    };
    const onError: ProcessErrorListener = () => finish(true);
    const timer = setTimeout(() => finish(false), TERMINAL_EXIT_PROBE_MS);
    timer.unref();
    handle.once('exit', onExit);
    handle.once('error', onError);
    if (handle.exitCode !== null) {
      finish(handle.exitCode !== 0);
    }
  });
}
