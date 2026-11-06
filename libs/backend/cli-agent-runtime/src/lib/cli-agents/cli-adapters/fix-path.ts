/**
 * Fix process.env.PATH on Linux/macOS when the host (Electron app or
 * VS Code) was launched from a GUI launcher (Activities, dock, Finder,
 * Spotlight). GUI-launched processes inherit a minimal PATH from the
 * desktop session — they do NOT source ~/.bashrc, ~/.zshrc, etc.
 *
 * This means npm global bin (~/.nvm/versions/node/*\/bin,
 * ~/.npm-global/bin, ~/.local/bin, ~/.bun/bin, ~/.volta/bin, …) is
 * missing, and `which codex` / `which copilot` all
 * fail. CLI detection then reports every CLI as "Not Found".
 *
 * The fix mirrors the standard Electron pattern (used by Atom, Hyper,
 * VS Code itself, and the `fix-path`/`shell-path` npm packages):
 *   1. Spawn the user's login shell in interactive+login mode so it
 *      sources its rc files.
 *   2. Echo $PATH back through stdout.
 *   3. Prepend the captured PATH to process.env.PATH.
 *   4. Also union in a curated list of common npm-global locations as
 *      a belt-and-braces fallback in case the shell probe fails.
 *
 * ## Never on the main loop's clock
 *
 * The shell probe used to be a `spawnSync` with a 5 s timeout: a slow rc file
 * froze the Electron main loop for up to 5 s. It is now an async `execFile`
 * started once by {@link fixPath}; the curated fallback directories are
 * applied synchronously at once, and the shell's PATH is prepended when the
 * probe answers. CLI detection gives its first scan a short bounded head start
 * on {@link fixPathReady} (async, never on the main loop's clock), which shares
 * the single probe and never re-runs it, and drops its cached scan once if the
 * shell's PATH lands later and differs from the PATH that scan used.
 *
 * No-op on Windows (PATH inheritance works correctly there).
 */
import { execFile } from 'child_process';
import { homedir } from 'os';
import * as path from 'path';
import * as fs from 'fs';

/** Upper bound on the login-shell probe. */
export const SHELL_PATH_PROBE_TIMEOUT_MS = 5_000;

const PATH_MARKER = '__PTAH_PATH_MARKER__';

let applied = false;
let ready: Promise<string> | undefined;
let shellProbePending = false;

function getCommonFallbackDirs(): string[] {
  const home = homedir();
  const dirs = [
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.deno', 'bin'),
  ];
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node');

  // One small directory listing, once per process at boot — not a request
  // path, so it stays synchronous and the fallback is in place immediately.
  try {
    const entries = fs.readdirSync(nvmRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(path.join(nvmRoot, entry.name, 'bin'));
      }
    }
  } catch {
    // degradation-audit: optional-capability — no ~/.nvm (or it is unreadable)
    // means there are no nvm node versions to add; the other fallback dirs stand.
  }
  dirs.push(path.join(home, 'n', 'bin'));

  return dirs;
}

/** Extract the marked PATH from the shell's stdout, or `null`. */
export function parseShellPathOutput(stdout: string): string | null {
  const match = stdout.match(
    new RegExp(`${PATH_MARKER}([^\\n]*?)${PATH_MARKER}`),
  );
  if (!match || !match[1]) return null;
  return match[1].trim() || null;
}

/** Ask the login shell for its PATH, asynchronously. */
function readShellPath(shell: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      const child = execFile(
        shell,
        ['-ilc', `echo "${PATH_MARKER}$PATH${PATH_MARKER}"`],
        {
          encoding: 'utf8',
          timeout: SHELL_PATH_PROBE_TIMEOUT_MS,
          windowsHide: true,
        },
        (error, stdout) => {
          // Best-effort probe of the user's login-shell PATH: a non-zero
          // exit, timeout or parse failure skips the PATH repair from this
          // source, which is the documented null result. The fallback
          // directories are already applied.
          if (error) resolve(null);
          else resolve(parseShellPathOutput(stdout));
        },
      );
      // EOF on stdin at once, as the old `spawnSync` gave with
      // `stdio: 'ignore'`: an rc file that reads stdin (an update prompt,
      // `read`, `ssh-add`) must see end-of-input, not block until the timeout.
      child.stdin?.end();
    } catch {
      // A spawn that throws synchronously (bad shell path) is the same
      // skipped probe.
      resolve(null);
    }
  });
}

/** Ordered union of PATH segment lists, first occurrence wins. */
function mergePath(...lists: string[][]): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const dir of list) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      segments.push(dir);
    }
  }
  return segments.join(path.delimiter);
}

function currentPathSegments(): string[] {
  return (process.env['PATH'] || '').split(path.delimiter);
}

/**
 * Repair process.env.PATH so child processes (and `which()` lookups) can
 * find user-installed CLIs. Idempotent — safe to call multiple times, and it
 * never blocks: the login-shell probe runs in the background.
 *
 * @returns The PATH as set now (fallback directories merged; the shell's
 *   PATH is prepended later, see {@link fixPathReady}).
 */
export function fixPath(): string {
  if (applied) {
    return process.env['PATH'] || '';
  }
  applied = true;

  if (process.platform === 'win32') {
    ready = Promise.resolve(process.env['PATH'] || '');
    return process.env['PATH'] || '';
  }

  process.env['PATH'] = mergePath(
    currentPathSegments(),
    getCommonFallbackDirs(),
  );

  const shell = process.env['SHELL'];
  shellProbePending = Boolean(shell);
  ready = shell
    ? readShellPath(shell).then((shellPath) => {
        shellProbePending = false;
        if (shellPath) {
          process.env['PATH'] = mergePath(
            shellPath.split(path.delimiter),
            currentPathSegments(),
          );
        }
        return process.env['PATH'] || '';
      })
    : Promise.resolve(process.env['PATH'] || '');
  return process.env['PATH'] || '';
}

/**
 * Resolves once the login-shell PATH has been merged (or the probe gave up).
 * Never starts the repair itself: only the host that called {@link fixPath}
 * (Electron boot) opted into rewriting PATH. Without that call it resolves
 * at once with the PATH as it is.
 */
export function fixPathReady(): Promise<string> {
  return ready ?? Promise.resolve(process.env['PATH'] || '');
}

/**
 * True only while the login-shell probe started by {@link fixPath} has not
 * answered yet. Lets a caller skip waiting on {@link fixPathReady} without an
 * extra tick when there is nothing to wait for (Windows, no `SHELL`, a host
 * that never called `fixPath`, or a probe that already answered).
 */
export function isShellPathPending(): boolean {
  return shellProbePending;
}
