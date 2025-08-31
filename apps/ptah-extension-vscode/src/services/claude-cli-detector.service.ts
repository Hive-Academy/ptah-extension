import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { Logger } from '../core/logger';

export interface ClaudeInstallation {
  path: string;
  version?: string;
  source: 'config' | 'path' | 'npm-global' | 'common-location' | 'user-home' | 'which-where';
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Service responsible for detecting Claude Code CLI installations across different operating systems
 * Follows Single Responsibility Principle - only handles CLI detection logic
 */
export class ClaudeCliDetector {
  private detectedInstallation: ClaudeInstallation | null = null;

  /**
   * Main detection method that tries all available detection strategies
   */
  async detectClaudeInstallation(): Promise<ClaudeInstallation | null> {
    Logger.info('🔍 Starting comprehensive Claude Code CLI detection...');

    try {
      // Strategy 1: User-configured path (highest priority)
      const configuredInstallation = await this.detectFromUserConfig();
      if (configuredInstallation) {
        this.detectedInstallation = configuredInstallation;
        return configuredInstallation;
      }

      // Strategy 2-6: Automatic detection methods
      const detectionStrategies = [
        () => this.detectInSystemPath(),
        () => this.detectNpmGlobalInstallation(),
        () => this.detectCommonInstallationPaths(),
        () => this.detectUserHomeInstallation(),
        () => this.detectWithSystemCommands(),
      ];

      for (const strategy of detectionStrategies) {
        try {
          const installation = await strategy();
          if (installation && (await this.validateClaudeInstallation(installation.path))) {
            // Enrich with version information
            installation.version = await this.detectVersion(installation.path);
            this.detectedInstallation = installation;
            Logger.info(`✅ Claude CLI detected: ${installation.path} (${installation.source})`);
            return installation;
          }
        } catch (error) {
          Logger.warn(
            `Detection strategy failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      Logger.error('❌ Claude Code CLI not found in any location');
      return null;
    } catch (error) {
      Logger.error('Error during Claude CLI detection', error);
      return null;
    }
  }

  /**
   * Get the currently detected installation (cached result)
   */
  getDetectedInstallation(): ClaudeInstallation | null {
    return this.detectedInstallation;
  }

  /**
   * Force re-detection (clears cache)
   */
  async redetect(): Promise<ClaudeInstallation | null> {
    this.detectedInstallation = null;
    return this.detectClaudeInstallation();
  }

  /**
   * Strategy 1: Check user-configured path from VS Code settings
   */
  private async detectFromUserConfig(): Promise<ClaudeInstallation | null> {
    const configuredPath = vscode.workspace.getConfiguration('ptah').get<string>('claudeCliPath');

    if (!configuredPath) {
      return null;
    }

    Logger.info(`Checking user-configured path: ${configuredPath}`);

    if (await this.validateClaudeInstallation(configuredPath)) {
      return {
        path: configuredPath,
        source: 'config',
      };
    }

    Logger.warn(`User-configured path is invalid: ${configuredPath}`);
    return null;
  }

  /**
   * Strategy 2: Check system PATH for claude command
   */
  private async detectInSystemPath(): Promise<ClaudeInstallation | null> {
    Logger.info('🔍 Checking system PATH...');

    const commands = ['claude', 'claude-code', 'claude.cmd', 'claude.exe'];

    for (const cmd of commands) {
      try {
        const result = await this.executeCommand(cmd, ['--version'], { timeout: 5000 });
        if (result.success && this.isValidClaudeOutput(result.stdout + result.stderr)) {
          return {
            path: cmd,
            source: 'path',
          };
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  /**
   * Strategy 3: Check npm global installation
   */
  private async detectNpmGlobalInstallation(): Promise<ClaudeInstallation | null> {
    Logger.info('🔍 Checking npm global installation...');

    try {
      // Get npm global prefix
      const npmResult = await this.executeCommand('npm', ['config', 'get', 'prefix'], {
        timeout: 10000,
      });
      if (!npmResult.success) {
        return null;
      }

      const globalPrefix = npmResult.stdout.trim();
      const possiblePaths = this.buildNpmGlobalPaths(globalPrefix);

      for (const claudePath of possiblePaths) {
        if (fs.existsSync(claudePath)) {
          return {
            path: claudePath,
            source: 'npm-global',
          };
        }
      }

      return null;
    } catch (error) {
      Logger.warn('NPM global detection failed', error);
      return null;
    }
  }

  /**
   * Strategy 4: Check common installation locations by OS
   */
  private async detectCommonInstallationPaths(): Promise<ClaudeInstallation | null> {
    Logger.info('🔍 Checking common installation locations...');

    const commonPaths = this.getOSSpecificCommonPaths();

    for (const claudePath of commonPaths) {
      if (fs.existsSync(claudePath)) {
        return {
          path: claudePath,
          source: 'common-location',
        };
      }
    }

    return null;
  }

  /**
   * Strategy 5: Check user home directory installations
   */
  private async detectUserHomeInstallation(): Promise<ClaudeInstallation | null> {
    Logger.info('🔍 Checking user home directory...');

    const homeDir = os.homedir();
    const homePaths = this.buildUserHomePaths(homeDir);

    for (const claudePath of homePaths) {
      if (fs.existsSync(claudePath)) {
        return {
          path: claudePath,
          source: 'user-home',
        };
      }
    }

    return null;
  }

  /**
   * Strategy 6: Use system 'which' or 'where' commands
   */
  private async detectWithSystemCommands(): Promise<ClaudeInstallation | null> {
    Logger.info('🔍 Using system which/where commands...');

    try {
      const isWindows = os.platform() === 'win32';
      const command = isWindows ? 'where' : 'which';

      const result = await this.executeCommand(command, ['claude'], { timeout: 5000 });
      if (result.success) {
        const paths = result.stdout
          .trim()
          .split('\n')
          .map((p) => p.trim())
          .filter((p) => p);

        // On Windows, prefer .cmd/.exe files
        for (const claudePath of paths) {
          if (fs.existsSync(claudePath)) {
            // On Windows, prefer executable files
            if (isWindows) {
              if (
                claudePath.endsWith('.cmd') ||
                claudePath.endsWith('.exe') ||
                claudePath.endsWith('.bat')
              ) {
                return {
                  path: claudePath,
                  source: 'which-where',
                };
              }
            } else {
              return {
                path: claudePath,
                source: 'which-where',
              };
            }
          }
        }

        // If no preferred executable found on Windows, try the first valid path
        if (isWindows && paths.length > 0) {
          const firstPath = paths[0];
          if (fs.existsSync(firstPath)) {
            return {
              path: firstPath,
              source: 'which-where',
            };
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Build npm global paths based on operating system
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
          path.join(globalPrefix, 'node_modules', '.bin', 'claude.cmd'),
          path.join(globalPrefix, 'node_modules', '.bin', 'claude.exe')
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
          ),
          path.join(globalPrefix, 'lib', 'node_modules', '.bin', 'claude')
        );
        break;
    }

    return paths;
  }

  /**
   * Get OS-specific common installation paths
   */
  private getOSSpecificCommonPaths(): string[] {
    const platform = os.platform();
    const paths: string[] = [];

    switch (platform) {
      case 'win32':
        paths.push(
          'C:\\Program Files\\nodejs\\claude.cmd',
          'C:\\Program Files\\nodejs\\claude.exe',
          'C:\\Program Files (x86)\\nodejs\\claude.cmd',
          'C:\\ProgramData\\npm\\claude.cmd',
          'C:\\Users\\Public\\npm\\claude.cmd'
        );
        break;

      case 'darwin':
        paths.push(
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          '/usr/bin/claude',
          '/opt/local/bin/claude',
          '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.js'
        );
        break;

      case 'linux':
        paths.push(
          '/usr/local/bin/claude',
          '/usr/bin/claude',
          '/bin/claude',
          '/opt/node/bin/claude',
          '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.js'
        );
        break;
    }

    return paths;
  }

  /**
   * Build user home directory paths
   */
  private buildUserHomePaths(homeDir: string): string[] {
    const platform = os.platform();
    const paths: string[] = [
      // Cross-platform user paths
      path.join(homeDir, '.local', 'bin', 'claude'),
      path.join(homeDir, 'bin', 'claude'),
      path.join(homeDir, '.npm-global', 'bin', 'claude'),
      path.join(homeDir, 'npm-global', 'bin', 'claude'),
    ];

    switch (platform) {
      case 'win32':
        paths.push(
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude.exe'),
          path.join(homeDir, 'AppData', 'Local', 'Claude', 'claude.exe'),
          path.join(homeDir, '.npm-global', 'bin', 'claude.cmd'),
          path.join(homeDir, 'npm-global', 'bin', 'claude.cmd')
        );
        break;

      case 'darwin':
        paths.push(
          path.join(homeDir, '.npm', 'bin', 'claude'),
          path.join(homeDir, 'Library', 'Application Support', 'npm', 'bin', 'claude')
        );
        break;

      case 'linux':
        paths.push(
          path.join(homeDir, '.nvm', 'versions', 'node', '*', 'bin', 'claude'),
          path.join(homeDir, '.local', 'share', 'npm', 'bin', 'claude')
        );
        break;
    }

    return paths;
  }

  /**
   * Validate that a given path is a working Claude CLI installation
   */
  private async validateClaudeInstallation(claudePath: string): Promise<boolean> {
    try {
      const result = await this.executeCommand(claudePath, ['--version'], { timeout: 10000 });
      return result.success && this.isValidClaudeOutput(result.stdout + result.stderr);
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect version information from Claude CLI
   */
  private async detectVersion(claudePath: string): Promise<string> {
    try {
      const result = await this.executeCommand(claudePath, ['--version'], { timeout: 5000 });
      if (result.success) {
        // Extract version number from output (e.g., "1.2.3")
        const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
        return versionMatch ? versionMatch[1] : 'unknown';
      }
    } catch (error) {
      Logger.warn('Failed to detect Claude version:', error);
    }
    return 'unknown';
  }

  /**
   * Check if command output indicates valid Claude CLI
   */
  private isValidClaudeOutput(output: string): boolean {
    const lowerOutput = output.toLowerCase();
    return (
      lowerOutput.includes('claude') ||
      lowerOutput.includes('anthropic') ||
      lowerOutput.includes('@anthropic-ai/claude-code')
    );
  }

  /**
   * Execute a system command with timeout and proper error handling
   */
  private async executeCommand(
    command: string,
    args: string[],
    options: { timeout?: number } = {}
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const { timeout = 30000 } = options;

      // On Windows, use shell mode for .cmd, .bat files or if command doesn't have an extension
      const isWindows = os.platform() === 'win32';
      const needsShell =
        isWindows &&
        (command.endsWith('.cmd') ||
          command.endsWith('.bat') ||
          (!command.includes('\\') && !command.includes('/') && !command.includes('.')));

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
   * Validates an existing Claude installation
   */
  async validateInstallation(installation: ClaudeInstallation): Promise<boolean> {
    return this.validateClaudeInstallation(installation.path);
  }
}
