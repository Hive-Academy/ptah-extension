/**
 * Fix process.env.PATH on Linux/macOS when the host (Electron app or
 * VS Code) was launched from a GUI launcher (Activities, dock, Finder,
 * Spotlight). GUI-launched processes inherit a minimal PATH from the
 * desktop session — they do NOT source ~/.bashrc, ~/.zshrc, etc.
 *
 * This means npm global bin (~/.nvm/versions/node/*\/bin,
 * ~/.npm-global/bin, ~/.local/bin, ~/.bun/bin, ~/.volta/bin, …) is
 * missing, and `which gemini` / `which codex` / `which copilot` all
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
 * No-op on Windows (PATH inheritance works correctly there).
 */
import { spawnSync } from 'child_process';
import { homedir } from 'os';
import * as path from 'path';
import * as fs from 'fs';

let applied = false;

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

  // ~/.nvm/versions/node/<version>/bin — pick all installed versions.
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
  try {
    const entries = fs.readdirSync(nvmRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(path.join(nvmRoot, entry.name, 'bin'));
      }
    }
  } catch {
    // nvm not installed — ignore
  }

  // ~/n/bin — the `n` Node version manager
  dirs.push(path.join(home, 'n', 'bin'));

  return dirs;
}

function readShellPath(): string | null {
  const shell = process.env['SHELL'];
  if (!shell) return null;

  try {
    // -ilc: interactive + login + run command. Sources rc + profile files.
    // Marker delimits PATH so we can ignore any motd/banner output.
    const marker = '__PTAH_PATH_MARKER__';
    const result = spawnSync(
      shell,
      ['-ilc', `echo "${marker}$PATH${marker}"`],
      {
        encoding: 'utf8',
        timeout: 5000,
        // Detach from any stdin to avoid hanging on prompts in some setups.
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    if (result.error || result.status !== 0) return null;

    const stdout = result.stdout || '';
    const match = stdout.match(new RegExp(`${marker}([^\\n]*?)${marker}`));
    if (!match || !match[1]) return null;

    return match[1].trim() || null;
  } catch {
    return null;
  }
}

/**
 * Repair process.env.PATH so child processes (and `which()` lookups) can
 * find user-installed CLIs. Idempotent — safe to call multiple times.
 *
 * @returns The final PATH that was set on process.env.PATH.
 */
export function fixPath(): string {
  if (applied) {
    return process.env['PATH'] || '';
  }
  applied = true;

  if (process.platform === 'win32') {
    return process.env['PATH'] || '';
  }

  const original = process.env['PATH'] || '';
  const segments: string[] = [];
  const seen = new Set<string>();

  const push = (dir: string) => {
    if (!dir) return;
    if (seen.has(dir)) return;
    seen.add(dir);
    segments.push(dir);
  };

  // 1. Shell-derived PATH (highest priority — reflects user intent)
  const shellPath = readShellPath();
  if (shellPath) {
    for (const dir of shellPath.split(path.delimiter)) push(dir);
  }

  // 2. Original inherited PATH (preserve anything the OS gave us)
  for (const dir of original.split(path.delimiter)) push(dir);

  // 3. Common fallback locations (catch missing npm-globals)
  for (const dir of getCommonFallbackDirs()) push(dir);

  const merged = segments.join(path.delimiter);
  process.env['PATH'] = merged;
  return merged;
}
