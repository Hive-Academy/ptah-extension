/**
 * Claude CLI Detector - Cross-platform CLI detection with WSL support
 * SOLID: Single Responsibility - Only handles CLI detection and health checks
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { injectable } from 'tsyringe';
import { ClaudeCliHealth } from '@ptah-extension/shared';

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
}

interface CommandResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Claude CLI Detection Service with WSL-aware path resolution
 */
@injectable()
export class ClaudeCliDetector {
  private cachedInstallation: ClaudeInstallation | null = null;
  private readonly isWSLEnvironment: boolean;
  private configuredPath?: string;
  private enableWSL = true;

  constructor() {
    this.isWSLEnvironment = this.detectWSLEnvironment();
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
      // Check for WSL-specific files/environment variables
      if (process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']) {
        return true;
      }

      // Check /proc/version for Microsoft/WSL
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
   * Main entry point: Find Claude CLI installation
   */
  async findExecutable(): Promise<ClaudeInstallation | null> {
    if (this.cachedInstallation) {
      return this.cachedInstallation;
    }

    try {
      // Priority order: config → system paths → WSL (if enabled)
      const strategies = [
        () => this.detectFromConfig(),
        () => this.detectInSystemPath(),
        () => this.detectNpmGlobal(),
        () => this.detectCommonPaths(),
        () => this.detectUserHome(),
        () => this.detectWithWhichWhere(),
      ];

      if (this.enableWSL && os.platform() === 'win32') {
        strategies.push(() => this.detectInWSL());
      }

      for (const strategy of strategies) {
        const installation = await strategy();
        if (installation && (await this.verifyInstallation(installation))) {
          this.cachedInstallation = installation;
          return installation;
        }
      }

      return null;
    } catch (error) {
      throw new Error(
        `Claude CLI detection failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Verify installation and get version
   */
  async verifyInstallation(installation: ClaudeInstallation): Promise<boolean> {
    try {
      const result = await this.executeCommand(
        installation.path,
        ['--version'],
        {
          timeout: 10000,
          isWSL: installation.isWSL,
        }
      );

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
   * Perform comprehensive health check
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

      const result = await this.executeCommand(
        installation.path,
        ['--version'],
        {
          timeout: 5000,
          isWSL: installation.isWSL,
        }
      );

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
   * Clear cached installation
   */
  clearCache(): void {
    this.cachedInstallation = null;
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
        const result = await this.executeCommand(cmd, ['--version'], {
          timeout: 5000,
        });
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
        }
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
   * Strategy: which/where commands
   */
  private async detectWithWhichWhere(): Promise<ClaudeInstallation | null> {
    const isWindows = os.platform() === 'win32';
    const command = isWindows ? 'where' : 'which';

    try {
      const result = await this.executeCommand(command, ['claude'], {
        timeout: 5000,
      });
      if (result.success) {
        const paths = result.stdout
          .trim()
          .split('\n')
          .map((p) => p.trim())
          .filter((p) => p);

        for (const claudePath of paths) {
          if (fs.existsSync(claudePath)) {
            return { path: claudePath, source: 'which-where' };
          }
        }
      }
    } catch {
      // Silently fail
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

    try {
      // Try to execute 'which claude' in WSL
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
    } catch {
      // WSL not available or claude not found
    }

    return null;
  }

  /**
   * Execute command with proper shell handling
   */
  private async executeCommand(
    command: string,
    args: string[],
    options: { timeout?: number; isWSL?: boolean } = {}
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const { timeout = 30000, isWSL = false } = options;

      const isWindows = os.platform() === 'win32';
      const needsShell =
        isWindows &&
        !isWSL &&
        (command.endsWith('.cmd') ||
          command.endsWith('.bat') ||
          (!command.includes('\\') && !command.includes('/')));

      const child = spawn(command, args, {
        stdio: 'pipe',
        windowsHide: true,
        shell: needsShell,
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
            'claude.js'
          ),
          path.join(globalPrefix, 'node_modules', '.bin', 'claude.cmd')
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
            'claude.js'
          )
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
          'C:\\ProgramData\\npm\\claude.cmd'
        );
        break;

      case 'darwin':
        paths.push(
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.js'
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
          path.join(homeDir, '.npm-global', 'bin', 'claude.cmd')
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
            'claude'
          )
        );
        break;

      case 'linux':
        paths.push(
          path.join(homeDir, '.local', 'share', 'npm', 'bin', 'claude')
        );
        break;
    }

    return paths;
  }
}
