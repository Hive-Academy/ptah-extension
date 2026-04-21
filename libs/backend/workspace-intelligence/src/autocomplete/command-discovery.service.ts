import { injectable, inject } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import matter from 'gray-matter';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  IDisposable,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';

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
 * - Hardcoded built-in commands (6 total)
 * - Scans .claude/commands/ directories (project + user)
 * - Scans .claude/skills/ directory (junctioned by SkillJunctionService)
 * - Parses YAML frontmatter for command metadata
 * - Watches for file changes (real-time invalidation)
 *
 * Commands and skills are discovered from the workspace .claude/ directory
 * (the source of truth) — NOT from plugin source directories. The
 * SkillJunctionService copies commands to .claude/commands/ and junctions
 * skills to .claude/skills/ at activation time. This avoids plugin-namespaced
 * entries (e.g. ptah-core:orchestrate) that the SDK can't resolve since
 * plugins are not passed via the SDK query option.
 */
@injectable()
export class CommandDiscoveryService {
  private cache: CommandInfo[] = [];
  private watchers: IDisposable[] = [];

  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fsProvider: IFileSystemProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Invalidate the command cache.
   * Called when plugin configuration changes so the next search
   * picks up newly junctioned skills and copied commands.
   */
  invalidateCache(): void {
    this.cache = [];
  }

  /**
   * Discover all commands (built-in + custom + skills)
   */
  async discoverCommands(): Promise<CommandDiscoveryResult> {
    try {
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return { success: false, error: 'No workspace folder open' };
      }

      // Built-in commands
      const builtins = this.getBuiltinCommands();

      // Project commands (includes plugin commands copied by SkillJunctionService)
      const projectCommands = await this.scanCommandDirectory(
        path.join(workspaceRoot, '.claude/commands'),
      );

      // User commands
      const userCommands = await this.scanCommandDirectory(
        path.join(os.homedir(), '.claude/commands'),
      );

      // Workspace skills (junctioned from plugins by SkillJunctionService)
      const workspaceSkills = await this.scanWorkspaceSkills(
        path.join(workspaceRoot, '.claude/skills'),
      );

      const allCommands = [
        ...builtins,
        ...projectCommands.map((c) => ({ ...c, scope: 'project' as const })),
        ...userCommands.map((c) => ({ ...c, scope: 'user' as const })),
        ...workspaceSkills,
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
    request: CommandSearchRequest,
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
          cmd.description.toLowerCase().includes(lowerQuery),
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
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) return;

    // Watch project commands using platform file watcher
    const projectWatcher = this.fsProvider.createFileWatcher(
      '.claude/commands/**/*.md',
    );

    const refreshCache = () => {
      this.discoverCommands().catch((error) => {
        console.error('[CommandDiscovery] Failed to refresh cache:', error);
      });
    };

    const createDisposable = projectWatcher.onDidCreate(refreshCache);
    const changeDisposable = projectWatcher.onDidChange(refreshCache);
    const deleteDisposable = projectWatcher.onDidDelete(refreshCache);

    this.watchers.push(
      projectWatcher,
      createDisposable,
      changeDisposable,
      deleteDisposable,
    );
  }

  /**
   * Get hardcoded built-in commands (from CLI docs)
   */
  private getBuiltinCommands(): CommandInfo[] {
    // SDK commands (supportsNonInteractive=true) + natively handled commands
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
      {
        name: 'clear',
        description: 'Clear conversation and start fresh',
        scope: 'builtin',
      },
      {
        name: 'context',
        description: 'Show current context and token usage',
        scope: 'builtin',
      },
      {
        name: 'cost',
        description: 'Show API cost for current session',
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
        files.map((file) => this.parseCommandFile(file)),
      );

      return commands.filter(Boolean) as CommandInfo[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.debug(
        `[CommandDiscovery] Directory ${dir} not accessible:`,
        errorMessage,
      );
      return [];
    }
  }

  /**
   * Recursively find all .md files
   */
  private async getAllMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const sentryService = this.sentryService;

    const scan = async (currentDir: string): Promise<void> => {
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
          errorMessage,
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'CommandDiscoveryService.getAllMarkdownFiles' },
        );
      }
    };

    await scan(dir);
    return files;
  }

  /**
   * Parse command .md file with YAML frontmatter
   */
  private async parseCommandFile(
    filePath: string,
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
        errorMessage,
      );
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'CommandDiscoveryService.parseCommandFile' },
      );
      return null;
    }
  }

  /**
   * Extract a description from markdown content when no frontmatter description exists.
   * Looks for the first non-heading, non-empty paragraph line after the heading.
   */
  private extractDescriptionFromMarkdown(
    markdownContent: string,
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
      // Found first paragraph -- use it as description (truncate at 120 chars)
      return trimmed.length > 120 ? trimmed.substring(0, 117) + '...' : trimmed;
    }
    return null;
  }

  /**
   * Scan workspace .claude/skills/ directory for junctioned skill definitions.
   *
   * SkillJunctionService creates junctions/symlinks from .claude/skills/{name}/
   * to the plugin's skills directory. Each skill directory contains a SKILL.md
   * with YAML frontmatter (name, description). Skills are listed without a
   * plugin namespace prefix so they resolve correctly when invoked as /skill-name.
   */
  private async scanWorkspaceSkills(skillsDir: string): Promise<CommandInfo[]> {
    const skills: CommandInfo[] = [];

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        // Skills are directories (or junctions/symlinks to directories)
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const { data: frontmatter } = matter(content);

          const name = frontmatter['name'] || entry.name;
          const description = frontmatter['description'] || 'Skill';

          skills.push({
            name,
            description:
              typeof description === 'string'
                ? description.replace(/\s+/g, ' ').trim()
                : String(description),
            scope: 'plugin',
            filePath: skillMdPath,
          });
        } catch (error) {
          console.debug(
            `[CommandDiscovery] Cannot read SKILL.md at ${skillMdPath}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } catch (error) {
      console.debug(
        `[CommandDiscovery] Skills directory not accessible at ${skillsDir}:`,
        error instanceof Error ? error.message : String(error),
      );
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'CommandDiscoveryService.scanWorkspaceSkills' },
      );
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
