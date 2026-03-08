import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import matter from 'gray-matter';

/**
 * Command information
 */
export interface CommandInfo {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
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
  private pluginPaths: string[] = [];

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext
  ) {}

  /**
   * Set plugin paths for command/skill discovery.
   * Called after PluginLoaderService is initialized (late initialization pattern).
   *
   * @param pluginPaths - Absolute paths to enabled plugin directories
   */
  setPluginPaths(pluginPaths: string[]): void {
    this.pluginPaths = pluginPaths;
    // Invalidate cache so next search picks up plugin commands
    this.cache = [];
  }

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

      // Plugin commands and skills
      const pluginCommands = await this.scanPluginDirectories();

      const allCommands = [
        ...builtins,
        ...projectCommands.map((c) => ({ ...c, scope: 'project' as const })),
        ...userCommands.map((c) => ({ ...c, scope: 'user' as const })),
        ...pluginCommands,
      ];

      // Update cache
      this.cache = allCommands;

      return { success: true, commands: allCommands };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to discover commands: ${errorMessage}`,
      };
    }
  }

  /**
   * Search commands by query
   */
  async searchCommands(
    request: CommandSearchRequest
  ): Promise<CommandDiscoveryResult> {
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
      const filtered = this.cache.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lowerQuery) ||
          cmd.description.toLowerCase().includes(lowerQuery)
      );

      return { success: true, commands: filtered.slice(0, maxResults) };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to search commands: ${errorMessage}`,
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
      this.discoverCommands().catch((error) => {
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
    // Only commands that work in SDK non-interactive mode (supportsNonInteractive=true)
    return [
      {
        name: 'compact',
        description: 'Compact conversation to reduce token usage',
        scope: 'builtin',
      },
      {
        name: 'review',
        description: 'Code review workflow',
        scope: 'builtin',
      },
      {
        name: 'memory',
        description: 'Manage long-term memory (CLAUDE.md)',
        scope: 'builtin',
      },
    ];
  }

  /**
   * Scan command directory for .md files
   */
  private async scanCommandDirectory(dir: string): Promise<CommandInfo[]> {
    try {
      const files = await this.getAllMarkdownFiles(dir);

      const commands = await Promise.all(
        files.map((file) => this.parseCommandFile(file))
      );

      return commands.filter(Boolean) as CommandInfo[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.debug(
        `[CommandDiscovery] Directory ${dir} not accessible:`,
        errorMessage
      );
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
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.debug(
          `[CommandDiscovery] Cannot scan ${currentDir}:`,
          errorMessage
        );
      }
    }

    await scan(dir);
    return files;
  }

  /**
   * Parse command .md file with YAML frontmatter
   */
  private async parseCommandFile(
    filePath: string
  ): Promise<CommandInfo | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter, content: template } = matter(content);

      // Extract description: prefer frontmatter, fallback to first paragraph in markdown
      let description = frontmatter['description'];
      if (!description) {
        description = this.extractDescriptionFromMarkdown(template);
      }

      return {
        name: path.basename(filePath, '.md'),
        description: description || 'No description',
        argumentHint: frontmatter['argument-hint'],
        scope: 'project', // Will be overridden by caller
        filePath,
        template,
        allowedTools: frontmatter['allowed-tools']
          ?.split(',')
          .map((t: string) => t.trim()),
        model: frontmatter['model'],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[CommandDiscovery] Failed to parse command file ${filePath}:`,
        errorMessage
      );
      return null;
    }
  }

  /**
   * Extract a description from markdown content when no frontmatter description exists.
   * Looks for the first non-heading, non-empty paragraph line after the heading.
   */
  private extractDescriptionFromMarkdown(
    markdownContent: string
  ): string | null {
    const lines = markdownContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, headings, code fences, and list items
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('```') ||
        trimmed.startsWith('- ') ||
        trimmed.startsWith('* ')
      ) {
        continue;
      }
      // Found first paragraph — use it as description (truncate at 120 chars)
      return trimmed.length > 120 ? trimmed.substring(0, 117) + '...' : trimmed;
    }
    return null;
  }

  /**
   * Scan plugin directories for commands and skills.
   * SDK automatically namespaces plugin commands as `plugin-name:command-name`,
   * so we mirror that format in autocomplete suggestions.
   */
  private async scanPluginDirectories(): Promise<CommandInfo[]> {
    if (this.pluginPaths.length === 0) return [];

    const commands: CommandInfo[] = [];

    for (const pluginPath of this.pluginPaths) {
      const pluginName = await this.readPluginName(pluginPath);

      // Scan plugin commands/ directory (same format as .claude/commands/)
      const pluginCommands = await this.scanCommandDirectory(
        path.join(pluginPath, 'commands')
      );
      commands.push(
        ...pluginCommands.map((c) => ({
          ...c,
          name: `${pluginName}:${c.name}`,
          scope: 'plugin' as const,
        }))
      );

      // Scan plugin skills/ directory (SKILL.md with frontmatter)
      const pluginSkills = await this.scanSkillsDirectory(pluginPath);
      commands.push(
        ...pluginSkills.map((s) => ({
          ...s,
          name: `${pluginName}:${s.name}`,
        }))
      );
    }

    return commands;
  }

  /**
   * Read plugin name from .claude-plugin/plugin.json manifest.
   * Falls back to directory name if manifest is missing.
   */
  private async readPluginName(pluginPath: string): Promise<string> {
    try {
      const manifestPath = path.join(
        pluginPath,
        '.claude-plugin',
        'plugin.json'
      );
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      if (manifest.name && typeof manifest.name === 'string') {
        return manifest.name;
      }
    } catch {
      // Manifest not readable — fall back to directory name
    }
    return path.basename(pluginPath);
  }

  /**
   * Scan a plugin's skills/ directory for skill definitions
   */
  private async scanSkillsDirectory(
    pluginPath: string
  ): Promise<CommandInfo[]> {
    const skillsDir = path.join(pluginPath, 'skills');
    const skills: CommandInfo[] = [];

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const { data: frontmatter } = matter(content);

          const name = frontmatter['name'] || entry.name;
          const description = frontmatter['description'] || 'Plugin skill';

          skills.push({
            name,
            description:
              typeof description === 'string'
                ? description.replace(/\s+/g, ' ').trim()
                : String(description),
            scope: 'plugin',
            filePath: skillMdPath,
          });
        } catch {
          // SKILL.md not readable — skip
        }
      }
    } catch {
      // skills/ directory not accessible — skip
    }

    return skills;
  }

  /**
   * Cleanup on disposal
   */
  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
  }
}
