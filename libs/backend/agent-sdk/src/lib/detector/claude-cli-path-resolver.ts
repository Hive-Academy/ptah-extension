/**
 * Claude CLI Path Resolver - Resolves wrapper scripts to actual cli.js for direct execution
 * SOLID: Single Responsibility - Only handles path resolution from wrapper to actual Node.js script
 *
 * Purpose: Bypass Windows cmd.exe buffering by executing cli.js directly with node.exe
 * instead of spawning the .cmd wrapper with shell:true
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ResolvedClaudeCliPath {
  /** Resolved path to cli.js that can be executed with node */
  readonly cliJsPath: string;
  /** Original wrapper path that was resolved */
  readonly wrapperPath: string;
  /** How the path was resolved */
  readonly resolvedVia: 'wrapper-parse' | 'npm-structure' | 'fallback';
  /** Whether this requires direct Node.js execution */
  readonly requiresDirectExecution: boolean;
}

/**
 * Resolves Claude CLI wrapper scripts to the actual cli.js file for direct Node.js execution.
 *
 * This solves the Windows cmd.exe buffering issue by allowing us to spawn:
 *   node.exe "C:\...\cli.js" args
 * instead of:
 *   cmd.exe /c "claude.cmd" args  (which buffers stdout)
 */
export class ClaudeCliPathResolver {
  /**
   * Resolve a Claude CLI installation path to the actual cli.js file
   *
   * @param installationPath - Path from ClaudeCliDetector (e.g., 'claude.cmd', '/usr/local/bin/claude')
   * @returns Resolved path info or null if cannot resolve
   */
  async resolve(
    installationPath: string,
  ): Promise<ResolvedClaudeCliPath | null> {
    const platform = os.platform();

    // Strategy 1: Parse wrapper script (Windows .cmd, Unix bash)
    if (this.isWrapperScript(installationPath)) {
      const parsed = await this.parseWrapperScript(installationPath);
      if (parsed) {
        return {
          cliJsPath: parsed,
          wrapperPath: installationPath,
          resolvedVia: 'wrapper-parse',
          requiresDirectExecution: platform === 'win32',
        };
      }
    }

    // Strategy 2: Infer from npm installation structure
    const inferred = this.inferFromNpmStructure(installationPath);
    if (inferred && fs.existsSync(inferred)) {
      return {
        cliJsPath: inferred,
        wrapperPath: installationPath,
        resolvedVia: 'npm-structure',
        requiresDirectExecution: platform === 'win32',
      };
    }

    // Strategy 3: Fallback - use wrapper as-is (shell spawning required)
    // This is for Unix systems or when we can't resolve
    if (fs.existsSync(installationPath)) {
      return {
        cliJsPath: installationPath,
        wrapperPath: installationPath,
        resolvedVia: 'fallback',
        requiresDirectExecution: false,
      };
    }

    return null;
  }

  /**
   * Check if path is a wrapper script that needs parsing
   */
  private isWrapperScript(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
      lower.endsWith('.cmd') ||
      lower.endsWith('.bat') ||
      lower.endsWith('.sh') ||
      (!lower.includes('\\') && !lower.includes('/') && lower === 'claude')
    );
  }

  /**
   * Parse a wrapper script to extract the actual cli.js path
   * Handles both Windows .cmd and Unix bash wrappers
   */
  private async parseWrapperScript(
    wrapperPath: string,
  ): Promise<string | null> {
    try {
      // If it's a command name (not a path), try to resolve it
      if (!wrapperPath.includes('\\') && !wrapperPath.includes('/')) {
        const resolved = await this.resolveCommandPath(wrapperPath);
        if (!resolved) {
          return null;
        }
        wrapperPath = resolved;
      }

      if (!fs.existsSync(wrapperPath)) {
        return null;
      }

      const content = fs.readFileSync(wrapperPath, 'utf8');
      const platform = os.platform();

      if (platform === 'win32') {
        return this.parseWindowsCmd(content, wrapperPath);
      } else {
        return this.parseUnixBash(content, wrapperPath);
      }
    } catch {
      return null;
    }
  }

  /**
   * Parse Windows .cmd wrapper
   * Example: "%_prog%" "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
   */
  private parseWindowsCmd(content: string, wrapperPath: string): string | null {
    // Look for patterns like:
    // "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js"
    // "%dp0%\..\lib\node_modules\@anthropic-ai\claude-code\cli.js"

    const patterns = [
      /%dp0%\\(.+?\.js)/, // %dp0%\path\to\cli.js
      /"([^"]+\.js)"/, // "full\path\to\cli.js"
      /'([^']+\.js)'/, // 'full\path\to\cli.js'
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const relativePath = match[1];
        const wrapperDir = path.dirname(wrapperPath);

        // Replace %dp0% with wrapper directory
        const resolvedPath = path.resolve(wrapperDir, relativePath);

        if (fs.existsSync(resolvedPath)) {
          return resolvedPath;
        }
      }
    }

    return null;
  }

  /**
   * Parse Unix bash wrapper
   * Example: exec node "$basedir/../lib/node_modules/@anthropic-ai/claude-code/cli.js" "$@"
   */
  private parseUnixBash(content: string, wrapperPath: string): string | null {
    // Look for patterns like:
    // "$basedir/../lib/node_modules/@anthropic-ai/claude-code/cli.js"
    // "${basedir}/../lib/node_modules/@anthropic-ai/claude-code/cli.js"

    const patterns = [
      /\$\{?basedir\}?\/(.+?\.js)/, // $basedir/path/to/cli.js
      /"([^"]+\.js)"/, // "full/path/to/cli.js"
      /'([^']+\.js)'/, // 'full/path/to/cli.js'
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const relativePath = match[1];
        const wrapperDir = path.dirname(wrapperPath);

        // Replace basedir with wrapper directory
        const resolvedPath = path.resolve(wrapperDir, relativePath);

        if (fs.existsSync(resolvedPath)) {
          return resolvedPath;
        }
      }
    }

    return null;
  }

  /**
   * Infer cli.js path from npm installation structure
   * Works when we know the wrapper location but can't parse it
   */
  private inferFromNpmStructure(wrapperPath: string): string | null {
    const platform = os.platform();

    // Windows: C:\Users\<user>\AppData\Roaming\npm\claude.cmd
    // Expect: C:\Users\<user>\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js
    if (platform === 'win32' && wrapperPath.endsWith('.cmd')) {
      const npmDir = path.dirname(wrapperPath);
      return path.join(
        npmDir,
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'cli.js',
      );
    }

    // Unix: /usr/local/bin/claude
    // Expect: /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js
    if (platform !== 'win32') {
      const binDir = path.dirname(wrapperPath);
      const baseDir = path.dirname(binDir); // /usr/local
      return path.join(
        baseDir,
        'lib',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'cli.js',
      );
    }

    return null;
  }

  /**
   * Resolve a command name to its full path
   * Uses 'where' on Windows, 'which' on Unix
   */
  private async resolveCommandPath(
    commandName: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const isWindows = os.platform() === 'win32';
      const command = isWindows ? 'where' : 'which';

      const child = spawn(command, [commandName], {
        stdio: 'pipe',
        shell: false,
      });

      let stdout = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.on('close', (code: number) => {
        if (code === 0) {
          const paths = stdout.trim().split(/\r?\n/);
          resolve(paths[0]?.trim() || null);
        } else {
          resolve(null);
        }
      });

      child.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Get the path to node.exe/node binary
   * Used for spawning with direct execution
   */
  getNodeBinaryPath(): string {
    // process.execPath gives us the current Node.js binary
    // This is reliable across platforms and node versions
    return process.execPath;
  }
}
