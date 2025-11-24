import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as matter from 'gray-matter';

/**
 * Command information
 */
export interface CommandInfo {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly scope: 'builtin' | 'project' | 'user' | 'mcp';
  readonly filePath?: string;
  readonly template?: string;
  readonly allowedTools?: string[];
  readonly model?: string;
}

/**
 * Command discovery result
 */
export interface CommandDiscoveryResult {
  success: boolean;
  commands?: CommandInfo[];
  error?: string;
}

/**
 * Command search request
 */
export interface CommandSearchRequest {
  query: string;
  maxResults?: number;
}

/**
 * Discovers and manages Claude CLI commands (built-in + custom)
 *
 * ARCHITECTURE:
 * - Hardcoded built-in commands (33 total)
 * - Scans .claude/commands/ directories (project + user)
 * - Parses YAML frontmatter for command metadata
 * - Watches for file changes (real-time invalidation)
 * - TODO: Query MCP servers for exposed prompts
 */
@injectable()
export class CommandDiscoveryService {
  private cache: CommandInfo[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor(
    @inject(TOKENS.CONTEXT) private context: vscode.ExtensionContext
  ) {}

  /**
   * Discover all commands (built-in + custom)
   */
  async discoverCommands(): Promise<CommandDiscoveryResult> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return { success: false, error: 'No workspace folder open' };
      }

      // Built-in commands
      const builtins = this.getBuiltinCommands();

      // Project commands
      const projectCommands = await this.scanCommandDirectory(
        path.join(workspaceRoot, '.claude/commands')
      );

      // User commands
      const userCommands = await this.scanCommandDirectory(
        path.join(os.homedir(), '.claude/commands')
      );

      const allCommands = [
        ...builtins,
        ...projectCommands.map(c => ({ ...c, scope: 'project' as const })),
        ...userCommands.map(c => ({ ...c, scope: 'user' as const }))
      ];

      // Update cache
      this.cache = allCommands;

      return { success: true, commands: allCommands };
    } catch (error) {
      return {
        success: false,
        error: `Failed to discover commands: ${error.message}`
      };
    }
  }

  /**
   * Search commands by query
   */
  async searchCommands(request: CommandSearchRequest): Promise<CommandDiscoveryResult> {
    try {
      // Ensure cache is populated
      if (this.cache.length === 0) {
        await this.discoverCommands();
      }

      const { query, maxResults = 20 } = request;

      if (!query || query.trim() === '') {
        return { success: true, commands: this.cache.slice(0, maxResults) };
      }

      const lowerQuery = query.toLowerCase();
      const filtered = this.cache.filter(cmd =>
        cmd.name.toLowerCase().includes(lowerQuery) ||
        cmd.description.toLowerCase().includes(lowerQuery)
      );

      return { success: true, commands: filtered.slice(0, maxResults) };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search commands: ${error.message}`
      };
    }
  }

  /**
   * Initialize file watchers
   */
  initializeWatchers(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // Watch project commands
    const projectWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '.claude/commands/**/*.md')
    );

    const refreshCache = () => {
      this.discoverCommands().catch(error => {
        console.error('[CommandDiscovery] Failed to refresh cache:', error);
      });
    };

    projectWatcher.onDidCreate(refreshCache);
    projectWatcher.onDidChange(refreshCache);
    projectWatcher.onDidDelete(refreshCache);

    this.watchers.push(projectWatcher);
    this.context.subscriptions.push(projectWatcher);
  }

  /**
   * Get hardcoded built-in commands (from CLI docs)
   */
  private getBuiltinCommands(): CommandInfo[] {
    return [
      { name: 'help', description: 'List all available commands', scope: 'builtin' },
      { name: 'clear', description: 'Clear conversation history', scope: 'builtin' },
      { name: 'compact', description: 'Compact conversation', scope: 'builtin' },
      { name: 'context', description: 'Monitor token usage', scope: 'builtin' },
      { name: 'cost', description: 'Show API cost estimates', scope: 'builtin' },
      { name: 'model', description: 'Switch model', scope: 'builtin' },
      { name: 'permissions', description: 'Manage tool permissions', scope: 'builtin' },
      { name: 'memory', description: 'Manage long-term memory', scope: 'builtin' },
      { name: 'sandbox', description: 'Toggle sandbox mode', scope: 'builtin' },
      { name: 'vim', description: 'Enable vim mode', scope: 'builtin' },
      { name: 'export', description: 'Export conversation', scope: 'builtin' },
      { name: 'doctor', description: 'Check CLI health', scope: 'builtin' },
      { name: 'status', description: 'Show session status', scope: 'builtin' },
      { name: 'mcp', description: 'Manage MCP servers', scope: 'builtin' },
      { name: 'review', description: 'Code review workflow', scope: 'builtin' },
      { name: 'init', description: 'Initialize project config', scope: 'builtin' }
      // TODO: Add remaining 17 built-in commands
    ];
  }

  /**
   * Scan command directory for .md files
   */
  private async scanCommandDirectory(dir: string): Promise<CommandInfo[]> {
    try {
      const files = await this.getAllMarkdownFiles(dir);

      const commands = await Promise.all(
        files.map(file => this.parseCommandFile(file))
      );

      return commands.filter(Boolean) as CommandInfo[];
    } catch (error) {
      console.debug(`[CommandDiscovery] Directory ${dir} not accessible:`, error.message);
      return [];
    }
  }

  /**
   * Recursively find all .md files
   */
  private async getAllMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function scan(currentDir: string) {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            await scan(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Directory not accessible
        console.debug(`[CommandDiscovery] Cannot scan ${currentDir}:`, error.message);
      }
    }

    await scan(dir);
    return files;
  }

  /**
   * Parse command .md file with YAML frontmatter
   */
  private async parseCommandFile(filePath: string): Promise<CommandInfo | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter, content: template } = matter(content);

      return {
        name: path.basename(filePath, '.md'),
        description: frontmatter.description || 'No description',
        argumentHint: frontmatter['argument-hint'],
        scope: 'project', // Will be overridden by caller
        filePath,
        template,
        allowedTools: frontmatter['allowed-tools']?.split(',').map((t: string) => t.trim()),
        model: frontmatter.model
      };
    } catch (error) {
      console.error(`[CommandDiscovery] Failed to parse command file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Cleanup on disposal
   */
  dispose(): void {
    this.watchers.forEach(w => w.dispose());
    this.watchers = [];
  }
}
