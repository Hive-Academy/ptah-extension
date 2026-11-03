import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, parse, resolve } from 'node:path';
import { promisify } from 'node:util';

export const CODEX_MIN_SUPPORTED_VERSION = '0.165.0';
const PROBE_TIMEOUT_MS = 7_000;
const execFileAsync = promisify(execFile);
export type CodexExecutableOrigin = 'installed' | 'bundled';
export interface CodexExecutableSelection {
  readonly path: string;
  readonly version: string;
  readonly source: CodexExecutableOrigin;
  readonly reason: string;
}
export interface CodexExecutableProbes {
  installedCandidates(): Promise<readonly string[]>;
  bundledCandidate(): Promise<string | undefined>;
  canonicalNativePath(path: string): Promise<string | undefined>;
  readVersion(path: string, timeoutMs: number): Promise<string>;
}
export interface CodexSelection {
  readonly selected: CodexExecutableSelection;
  readonly bundledFallback?: CodexExecutableSelection;
}
export interface CodexSelectionSnapshotPort {
  selectForOpen(): Promise<CodexSelection>;
  current(): CodexExecutableSelection | undefined;
  activateFallback(failed: CodexExecutableSelection, method?: string): Promise<CodexExecutableSelection>;
}

const versionPattern = /(?:^|[^\w.])v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?=$|[^\w.+-])/;
function versionParts(value: string): { parts: readonly number[]; prerelease: boolean } | undefined {
  const match = versionPattern.exec(value.trim());
  if (!match) return undefined;
  if ([match[1], match[2], match[3]].some((part) => part.length > 1 && part.startsWith('0'))) return undefined;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (parts.some((part) => !Number.isSafeInteger(part))) return undefined;
  return { parts, prerelease: Boolean(match[4]) };
}
export function parseCodexVersion(output: string): string | undefined {
  const parsed = versionParts(output);
  return parsed?.parts.join('.');
}
export function isCodexVersionSupported(version: string, minimum = CODEX_MIN_SUPPORTED_VERSION): boolean {
  const candidate = versionParts(version);
  const floor = versionParts(minimum);
  if (!candidate || !floor) return false;
  for (let index = 0; index < 3; index++) {
    if (candidate.parts[index] !== floor.parts[index])
      return candidate.parts[index] > floor.parts[index];
  }
  return !candidate.prerelease || floor.prerelease;
}

export class CodexExecutableUnavailableError extends Error {
  constructor(minimum: string) {
    super(`No supported Codex is available. Install Codex ${minimum} or newer, or update Ptah's bundled Codex.`);
    this.name = 'CodexExecutableUnavailableError';
  }
}

export async function selectCodexExecutable(
  probes: CodexExecutableProbes,
  minimum = CODEX_MIN_SUPPORTED_VERSION,
): Promise<CodexSelection> {
  const seen = new Set<string>();
  let oldInstalled: string | undefined;
  const inspect = async (candidate: string, source: CodexExecutableOrigin): Promise<CodexExecutableSelection | undefined> => {
    try {
      const path = await probes.canonicalNativePath(candidate);
      if (!path || seen.has(path)) return undefined;
      seen.add(path);
      const output = await probes.readVersion(path, PROBE_TIMEOUT_MS);
      const version = parseCodexVersion(output);
      if (!version || !isCodexVersionSupported(output, minimum)) {
        if (source === 'installed' && version) oldInstalled ??= version;
        return undefined;
      }
      return { path, version, source, reason: source === 'installed'
        ? `Using installed Codex ${version}.`
        : oldInstalled
          ? `Installed Codex ${oldInstalled} is below the supported minimum ${minimum}; using bundled Codex ${version}.`
          : `Installed Codex was not found or could not be started; using bundled Codex ${version}.` };
    } catch {
      // degradation-audit: reported - an unreadable candidate is skipped; a supported bundle or terminal error reports the outcome.
      return undefined;
    }
  };
  let installed: readonly string[] = [];
  try {
    installed = await probes.installedCandidates();
  } catch {
    // degradation-audit: reported - a failed installed discovery is represented by the bundled selection reason.
  }
  const bundle = async (): Promise<string | undefined> => {
    try { return await probes.bundledCandidate(); }
    catch { return undefined; } // degradation-audit: reported - the selector raises a safe unavailable error when the bundle cannot be found.
  };
  for (const candidate of installed) {
    const selected = await inspect(candidate, 'installed');
    if (selected) {
      const bundledPath = await bundle();
      const bundledFallback = bundledPath ? await inspect(bundledPath, 'bundled') : undefined;
      return { selected, ...(bundledFallback ? { bundledFallback } : {}) };
    }
  }
  const bundledPath = await bundle();
  const selected = bundledPath ? await inspect(bundledPath, 'bundled') : undefined;
  if (!selected) throw new CodexExecutableUnavailableError(minimum);
  return { selected };
}

/** One snapshot per host scope. selectForOpen always probes again. */
export class CodexSelectionSnapshot implements CodexSelectionSnapshotPort {
  private selection?: CodexSelection;
  private generation = 0;
  private readonly fallbackByInstalled = new WeakMap<CodexExecutableSelection, CodexExecutableSelection>();
  constructor(private readonly probes: CodexExecutableProbes) {}
  async selectForOpen(): Promise<CodexSelection> {
    const generation = ++this.generation;
    const resolved = await selectCodexExecutable(this.probes);
    const selection: CodexSelection = Object.freeze({
      selected: Object.freeze(resolved.selected),
      ...(resolved.bundledFallback
        ? { bundledFallback: Object.freeze(resolved.bundledFallback) } : {}),
    });
    if (selection.selected.source === 'installed' && selection.bundledFallback)
      this.fallbackByInstalled.set(selection.selected, selection.bundledFallback);
    if (generation === this.generation) this.selection = selection;
    return selection;
  }
  current(): CodexExecutableSelection | undefined { return this.selection?.selected; }
  async activateFallback(failed: CodexExecutableSelection, method?: string): Promise<CodexExecutableSelection> {
    const bundledFallback = this.fallbackByInstalled.get(failed);
    if (failed.source !== 'installed' || !bundledFallback)
      throw new CodexExecutableUnavailableError(CODEX_MIN_SUPPORTED_VERSION);
    this.fallbackByInstalled.delete(failed);
    const fallback = { ...bundledFallback,
      reason: `Installed Codex ${failed.version} lacks required method ${method ?? 'unknown'}; using bundled Codex ${bundledFallback.version}.` };
    if (this.selection?.selected === failed)
      this.selection = { selected: fallback };
    return fallback;
  }
}

/** Host supplies its bundled native path through a callback; no package dependency enters this library. */
export function createNodeCodexExecutableProbes(
  bundledCandidate: () => Promise<string | undefined>,
): CodexExecutableProbes {
  const windows = process.platform === 'win32';
  const nativeName = windows ? 'codex.exe' : 'codex';
  const target = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const triple = windows ? `${target}-pc-windows-msvc`
    : process.platform === 'darwin' ? `${target}-apple-darwin`
      : process.platform === 'linux' ? `${target}-unknown-linux-musl` : undefined;
  const packageName = triple ? `codex-${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}` : undefined;
  const nativePackageCandidates = (cliPath: string): string[] => {
    if (!triple || !packageName) return [];
    const cliDir = dirname(cliPath);
    const roots = [
      join(cliDir, 'node_modules', '@openai', packageName),
      join(cliDir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', packageName),
      join(dirname(cliDir), 'lib', 'node_modules', '@openai', packageName),
    ];
    if (basename(cliDir) === 'bin' && basename(dirname(cliDir)) === 'codex') {
      const scopeDir = dirname(dirname(cliDir));
      roots.push(join(scopeDir, packageName));
      roots.push(join(dirname(scopeDir), 'node_modules', '@openai', packageName));
    }
    return roots.flatMap((root) => ['bin', 'codex'].map((layout) =>
      join(root, 'vendor', triple, layout, nativeName)));
  };
  return {
    async installedCandidates() {
      const home = homedir();
      const pathDirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
      const dirs = [...pathDirs, join(home, '.codex', 'bin'), join(home, '.local', 'bin'),
        join(home, '.npm-global', 'bin'), '/usr/local/bin', '/usr/bin',
        '/opt/homebrew/bin', '/home/linuxbrew/.linuxbrew/bin',
        ...(process.env['NVM_BIN'] ? [process.env['NVM_BIN']] : []),
        ...(windows ? [join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'npm')] : [])];
      const names = windows ? ['codex.exe', 'codex.cmd', 'codex.ps1'] : ['codex'];
      return dirs.flatMap((dir) => names.map((name) => join(dir, name)));
    },
    bundledCandidate,
    async canonicalNativePath(candidate) {
      const ext = parse(candidate).ext.toLowerCase();
      let resolvedCandidate: string;
      try {
        if (!(await stat(candidate)).isFile()) return undefined;
        resolvedCandidate = await realpath(resolve(candidate));
      } catch {
        // degradation-audit: reported - an absent or unreadable candidate is skipped; selection reports the eventual outcome.
        return undefined;
      }
      const resolvedExt = parse(resolvedCandidate).ext.toLowerCase();
      const shim = ext === '.cmd' || ext === '.ps1' || ext === '.js' ||
        resolvedExt === '.cmd' || resolvedExt === '.ps1' || resolvedExt === '.js';
      const candidates = shim
        ? [join(dirname(candidate), nativeName), ...nativePackageCandidates(candidate),
          ...nativePackageCandidates(resolvedCandidate)]
        : [resolvedCandidate];
      for (const item of candidates) {
        try {
          const path = await realpath(resolve(item));
          const info = await stat(path);
          if (!info.isFile() || (windows && parse(path).ext.toLowerCase() !== '.exe') ||
              ['.cmd', '.ps1', '.js'].includes(parse(path).ext.toLowerCase())) continue;
          await access(path, windows ? constants.F_OK : constants.X_OK);
          return path;
        } catch {
          // degradation-audit: reported - continue to the next native candidate; selector reports exhaustion.
        }
      }
      return undefined;
    },
    async readVersion(path, timeoutMs) {
      const { stdout, stderr } = await execFileAsync(path, ['--version'], {
        timeout: timeoutMs, windowsHide: true, shell: false, maxBuffer: 16 * 1024,
      });
      return stdout || stderr;
    },
  };
}
