/**
 * Claude CLI Detector - Cross-platform CLI detection with WSL support
 * SOLID: Single Responsibility - Only handles CLI detection and health checks
 *
 * Every probe here goes through `cross-spawn` and `which`, and NEVER through
 * `child_process.spawn` with `shell: true`. The previous version computed a
 * `needsShell` flag for any bare command or `.cmd`/`.bat` path on Windows and
 * passed it alongside an args array, which is exactly the shape Node warns
 * about with `[DEP0190] Passing args to a child process with shell option true
 * can lead to security vulnerabilities` — the args are concatenated into a
 * `cmd.exe` command line unescaped. `where claude` at boot was the first such
 * call in the process, and since Node prints a deprecation code once, it also
 * masked every other offender (TASK_2026_348).
 *
 * `cross-spawn` gets the same Windows behaviour without a shell: it resolves
 * bare commands through PATH/PATHEXT and runs `.cmd`/`.bat` wrappers via
 * `cmd.exe /d /s /c` with each argument escaped for both cmd.exe and the
 * Windows command-line parser.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import crossSpawn from 'cross-spawn';
import whichLib from 'which';
import { injectable } from 'tsyringe';
import { ClaudeCliHealth } from '@ptah-extension/shared';
import { SdkError } from '../errors';
import { ClaudeCliPathResolver } from './claude-cli-path-resolver';

export interface ClaudeInstallation {
  readonly path: string;
  readonly version?: string;
  readonly source:
    | 'config'
    | 'path'
    | 'npm-global'
    | 'common-location'
    | 'user-home'
    | 'which-where'
    | 'wsl';
  readonly isWSL?: boolean;
  /** Resolved path to cli.js for direct Node.js execution (bypasses cmd.exe buffering on Windows) */
  readonly cliJsPath?: string;
  /** Whether to use direct Node.js execution instead of shell spawning */
  readonly useDirectExecution?: boolean;
}

interface CommandResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * How long a SUCCESSFUL `--version` result is reused for the same command.
 *
 * `child_process.spawn` is not asynchronous: libuv's `uv_spawn` runs
 * `CreateProcessW` inline on the calling thread and Windows scans the target
 * image while creating the process, so the cost tracks the executable's SIZE —
 * `claude.exe` is 253 MB and measures 1850-1975 ms on the reference machine
 * (TASK_2026_341). Every `--version` probe here is therefore a ~2 s freeze of
 * whichever loop calls it, which on Electron is the one owning every
 * `BrowserWindow`.
 *
 * This window is deliberately SHORT. It is not a health cache — callers that
 * want one keep their own (`AuthRpcHandlers` memoises the verdict for five
 * minutes). It exists to collapse the probes that a single boot fires within
 * seconds of each other, which was measured as four concurrent callers of one
 * singleton detector paying up to eight spawns for one answer.
 *
 * A FAILURE is never cached: a probe that failed is not evidence the CLI is
 * absent, and retrying costs exactly one spawn.
 */
const VERSION_PROBE_TTL_MS = 30_000;

/**
 * Claude CLI Detection Service with WSL-aware path resolution
 */
@injectable()
export class ClaudeCliDetector {
  private cachedInstallation: ClaudeInstallation | null = null;
  private readonly isWSLEnvironment: boolean;
  private configuredPath?: string;
  private enableWSL = true;
  private readonly pathResolver: ClaudeCliPathResolver;

  /**
   * The detection currently running, if any.
   *
   * `cachedInstallation` is only written when the whole strategy chain has
   * finished, so without this every concurrent caller ran the entire chain —
   * including its spawns — before any of them got to populate the cache. This
   * is a DI singleton with four boot-time consumers (`CliStrategy`,
   * `SdkAgentAdapter`, `SdkModuleLoader`, `AuthRpcHandlers.probeClaudeCli`),
   * and they all start within the same second.
   */
  private detectionInFlight: Promise<ClaudeInstallation | null> | null = null;

  /** Settled `--version` results, held for {@link VERSION_PROBE_TTL_MS}. */
  private readonly versionProbes = new Map<
    string,
    { readonly at: number; readonly result: CommandResult }
  >();

  /** `--version` probes currently running, keyed by command. */
  private readonly versionProbesInFlight = new Map<
    string,
    Promise<CommandResult>
  >();

  constructor() {
    this.isWSLEnvironment = this.detectWSLEnvironment();
    this.pathResolver = new ClaudeCliPathResolver();
  }

  /**
   * Configure the detector with optional settings
   * Call this after construction if you need custom configuration
   */
  configure(options?: { configuredPath?: string; enableWSL?: boolean }): void {
    if (options?.configuredPath) {
      this.configuredPath = options.configuredPath;
    }
    if (options?.enableWSL !== undefined) {
      this.enableWSL = options.enableWSL;
    }
  }

  /**
   * Detect if running in WSL environment
   */
  private detectWSLEnvironment(): boolean {
    if (os.platform() !== 'linux') {
      return false;
    }

    try {
      if (process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']) {
        return true;
      }
      if (fs.existsSync('/proc/version')) {
        const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
        return version.includes('microsoft') || version.includes('wsl');
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Main entry point: Find Claude CLI installation.
   *
   * Single-flight: concurrent callers share one detection rather than each
   * running the strategy chain and its spawns. See {@link detectionInFlight}.
   */
  async findExecutable(): Promise<ClaudeInstallation | null> {
    if (this.cachedInstallation) {
      return this.cachedInstallation;
    }

    const running = this.detectionInFlight;
    if (running) {
      return running;
    }

    const pending = this.runDetection().finally(() => {
      // By identity: a `clearCache()` during detection may already have let a
      // newer run claim the slot, and evicting that one un-coalesces the very
      // burst this exists to absorb.
      if (this.detectionInFlight === pending) {
        this.detectionInFlight = null;
      }
    });
    this.detectionInFlight = pending;
    return pending;
  }

  private async runDetection(): Promise<ClaudeInstallation | null> {
    try {
      const strategies = [
        () => this.detectFromConfig(),
        () => this.detectWithWhichWhere(), // ← MOVED UP (was priority #6)
        () => this.detectNpmGlobal(),
        () => this.detectCommonPaths(),
        () => this.detectUserHome(),
        () => this.detectInSystemPath(), // ← MOVED DOWN (fallback for bare commands)
      ];

      if (this.enableWSL && os.platform() === 'win32') {
        strategies.push(() => this.detectInWSL());
      }

      for (const strategy of strategies) {
        const installation = await strategy();
        if (installation && (await this.verifyInstallation(installation))) {
          const resolved = await this.pathResolver.resolve(installation.path);
          if (resolved) {
            this.cachedInstallation = {
              ...installation,
              cliJsPath: resolved.cliJsPath,
              useDirectExecution: resolved.requiresDirectExecution,
            };
            return this.cachedInstallation;
          }
          this.cachedInstallation = installation;
          return installation;
        }
      }

      return null;
    } catch (error) {
      throw new SdkError(
        `Claude CLI detection failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Verify installation and get version
   */
  async verifyInstallation(installation: ClaudeInstallation): Promise<boolean> {
    try {
      const result = await this.probeVersion(installation.path, 10000);

      if (!result.success) {
        return false;
      }

      const output = result.stdout + result.stderr;
      return this.isValidClaudeOutput(output);
    } catch {
      return false;
    }
  }

  /**
   * Perform comprehensive health check.
   *
   * `findExecutable()` reaches this same binary through `verifyInstallation`,
   * which runs `--version` and parses its output — so on a cold call this used
   * to spawn the 253 MB `claude.exe` TWICE to answer one question. Both sides
   * now go through {@link probeVersion}, so the second one is free.
   */
  async performHealthCheck(): Promise<ClaudeCliHealth> {
    const startTime = Date.now();

    try {
      const installation = await this.findExecutable();

      if (!installation) {
        return {
          available: false,
          error: 'Claude CLI not found in system',
          platform: os.platform(),
          isWSL: this.isWSLEnvironment,
        };
      }

      const result = await this.probeVersion(installation.path, 5000);

      const responseTime = Date.now() - startTime;

      if (!result.success) {
        return {
          available: false,
          path: installation.path,
          error: `Health check failed: ${result.stderr || 'Unknown error'}`,
          responseTime,
          platform: os.platform(),
          isWSL: installation.isWSL || false,
        };
      }

      const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : undefined;

      return {
        available: true,
        path: installation.path,
        version,
        responseTime,
        platform: os.platform(),
        isWSL: installation.isWSL || false,
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Health check failed',
        responseTime: Date.now() - startTime,
        platform: os.platform(),
        isWSL: this.isWSLEnvironment,
      };
    }
  }

  /**
   * Clear cached installation.
   *
   * Also drops the `--version` results, which are what "the CLI at this path
   * works" is derived from: keeping them would let a caller that asked for a
   * fresh detection be answered from the evidence it asked to discard.
   */
  clearCache(): void {
    this.cachedInstallation = null;
    this.detectionInFlight = null;
    this.versionProbes.clear();
    this.versionProbesInFlight.clear();
  }

  /**
   * Run `<command> --version`, sharing the result with any caller that asked
   * for the same command in the last {@link VERSION_PROBE_TTL_MS}, and sharing
   * the SPAWN with any caller asking while one is already running.
   *
   * Both halves matter and they cover different cases: the in-flight map
   * collapses the concurrent boot fan-out, the settled map collapses the
   * sequential `findExecutable()` -> `performHealthCheck()` pair.
   */
  private async probeVersion(
    command: string,
    timeout: number,
  ): Promise<CommandResult> {
    const cached = this.versionProbes.get(command);
    if (cached && Date.now() - cached.at < VERSION_PROBE_TTL_MS) {
      return cached.result;
    }

    const running = this.versionProbesInFlight.get(command);
    if (running) {
      return running;
    }

    const pending = this.executeCommand(command, ['--version'], { timeout })
      .then((result) => {
        // Successes only — see VERSION_PROBE_TTL_MS.
        if (result.success) {
          this.versionProbes.set(command, { at: Date.now(), result });
        }
        return result;
      })
      .finally(() => {
        if (this.versionProbesInFlight.get(command) === pending) {
          this.versionProbesInFlight.delete(command);
        }
      });
    this.versionProbesInFlight.set(command, pending);
    return pending;
  }

  /**
   * Strategy: User-configured path
   */
  private async detectFromConfig(): Promise<ClaudeInstallation | null> {
    if (!this.configuredPath) {
      return null;
    }

    if (fs.existsSync(this.configuredPath)) {
      return {
        path: this.configuredPath,
        source: 'config',
      };
    }

    return null;
  }

  /**
   * Strategy: System PATH
   */
  private async detectInSystemPath(): Promise<ClaudeInstallation | null> {
    const commands = ['claude', 'claude-code', 'claude.cmd', 'claude.exe'];

    for (const cmd of commands) {
      try {
        const result = await this.probeVersion(cmd, 5000);
        if (
          result.success &&
          this.isValidClaudeOutput(result.stdout + result.stderr)
        ) {
          return { path: cmd, source: 'path' };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Strategy: NPM global installation
   */
  private async detectNpmGlobal(): Promise<ClaudeInstallation | null> {
    try {
      const npmResult = await this.executeCommand(
        'npm',
        ['config', 'get', 'prefix'],
        {
          timeout: 10000,
        },
      );

      if (!npmResult.success) {
        return null;
      }

      const globalPrefix = npmResult.stdout.trim();
      const possiblePaths = this.buildNpmGlobalPaths(globalPrefix);

      for (const claudePath of possiblePaths) {
        if (fs.existsSync(claudePath)) {
          return { path: claudePath, source: 'npm-global' };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Strategy: Common OS-specific paths
   */
  private async detectCommonPaths(): Promise<ClaudeInstallation | null> {
    const commonPaths = this.getOSCommonPaths();

    for (const claudePath of commonPaths) {
      if (fs.existsSync(claudePath)) {
        return { path: claudePath, source: 'common-location' };
      }
    }

    return null;
  }

  /**
   * Strategy: User home directory
   */
  private async detectUserHome(): Promise<ClaudeInstallation | null> {
    const homeDir = os.homedir();
    const homePaths = this.buildUserHomePaths(homeDir);

    for (const claudePath of homePaths) {
      if (fs.existsSync(claudePath)) {
        return { path: claudePath, source: 'user-home' };
      }
    }

    return null;
  }

  /**
   * Strategy: PATH lookup
   *
   * Returns the FULL PATH to the Claude CLI (e.g. C:\Users\...\npm\claude.cmd).
   * This avoids ENOENT errors because:
   * 1. Full paths can be spawned directly without shell resolution
   * 2. No ambiguity about which executable to run
   * 3. Works with paths containing spaces (no shell escaping needed)
   *
   * Resolved with the `which` library rather than by spawning `where`/`which`:
   * same PATH/PATHEXT semantics, one fewer subprocess on every boot, and no
   * `\r` handling of another process's stdout. The `which-where` source label is
   * kept because it is part of `ClaudeInstallation` and reaches the UI and logs.
   */
  private async detectWithWhichWhere(): Promise<ClaudeInstallation | null> {
    try {
      const matches = await whichLib('claude', { all: true, nothrow: true });
      if (!matches) {
        return null;
      }

      for (const match of matches) {
        const claudePath = match.trim();
        if (claudePath && fs.existsSync(claudePath)) {
          return { path: claudePath, source: 'which-where' };
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * Strategy: WSL detection (Windows only)
   */
  private async detectInWSL(): Promise<ClaudeInstallation | null> {
    if (os.platform() !== 'win32') {
      return null;
    }

    const result = await this.executeCommand('wsl', ['which', 'claude'], {
      timeout: 5000,
    });

    if (result.success) {
      const wslPath = result.stdout.trim();
      if (wslPath) {
        return {
          path: 'wsl',
          version: undefined,
          source: 'wsl',
          isWSL: true,
        };
      }
    }

    return null;
  }

  /**
   * Execute a command and capture its output.
   *
   * Routed through `cross-spawn`, which handles Windows `.cmd`/`.bat` wrappers
   * and bare command names itself. No `shell` option is passed here — see the
   * file header for why that must stay true.
   */
  private async executeCommand(
    command: string,
    args: string[],
    options: { timeout?: number } = {},
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const { timeout = 30000 } = options;

      const child = crossSpawn(command, args, {
        stdio: 'pipe',
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let finished = false;

      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true;
          child.kill();
          resolve({
            success: false,
            stdout: '',
            stderr: 'Command timeout',
            exitCode: -1,
          });
        }
      }, timeout);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          resolve({
            success: code === 0,
            stdout,
            stderr,
            exitCode: code || 0,
          });
        }
      });

      child.on('error', (error) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          resolve({
            success: false,
            stdout: '',
            stderr: error.message,
            exitCode: -1,
          });
        }
      });
    });
  }

  /**
   * Validate Claude CLI output
   */
  private isValidClaudeOutput(output: string): boolean {
    const lower = output.toLowerCase();
    return (
      lower.includes('claude') ||
      lower.includes('anthropic') ||
      lower.includes('@anthropic-ai/claude-code')
    );
  }

  /**
   * Build NPM global paths
   */
  private buildNpmGlobalPaths(globalPrefix: string): string[] {
    const platform = os.platform();
    const paths: string[] = [];

    switch (platform) {
      case 'win32':
        paths.push(
          path.join(globalPrefix, 'claude.cmd'),
          path.join(globalPrefix, 'claude.exe'),
          path.join(
            globalPrefix,
            'node_modules',
            '@anthropic-ai',
            'claude-code',
            'bin',
            'claude.js',
          ),
          path.join(globalPrefix, 'node_modules', '.bin', 'claude.cmd'),
        );
        break;

      case 'darwin':
      case 'linux':
        paths.push(
          path.join(globalPrefix, 'bin', 'claude'),
          path.join(
            globalPrefix,
            'lib',
            'node_modules',
            '@anthropic-ai',
            'claude-code',
            'bin',
            'claude.js',
          ),
        );
        break;
    }

    return paths;
  }

  /**
   * Get OS-specific common paths
   */
  private getOSCommonPaths(): string[] {
    const platform = os.platform();
    const paths: string[] = [];

    switch (platform) {
      case 'win32':
        paths.push(
          'C:\\Program Files\\nodejs\\claude.cmd',
          'C:\\ProgramData\\npm\\claude.cmd',
        );
        break;

      case 'darwin':
        paths.push(
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.js',
        );
        break;

      case 'linux':
        paths.push('/usr/local/bin/claude', '/usr/bin/claude', '/bin/claude');
        break;
    }

    return paths;
  }

  /**
   * Build user home paths
   */
  private buildUserHomePaths(homeDir: string): string[] {
    const platform = os.platform();
    const paths: string[] = [
      path.join(homeDir, '.local', 'bin', 'claude'),
      path.join(homeDir, 'bin', 'claude'),
      path.join(homeDir, '.npm-global', 'bin', 'claude'),
    ];

    switch (platform) {
      case 'win32':
        paths.push(
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(homeDir, '.npm-global', 'bin', 'claude.cmd'),
        );
        break;

      case 'darwin':
        paths.push(
          path.join(homeDir, '.npm', 'bin', 'claude'),
          path.join(
            homeDir,
            'Library',
            'Application Support',
            'npm',
            'bin',
            'claude',
          ),
        );
        break;

      case 'linux':
        paths.push(
          path.join(homeDir, '.local', 'share', 'npm', 'bin', 'claude'),
        );
        break;
    }

    return paths;
  }
}
