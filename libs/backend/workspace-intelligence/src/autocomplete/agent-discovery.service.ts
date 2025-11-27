import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import matter from 'gray-matter';

/**
 * Agent information parsed from .md file
 */
export interface AgentInfo {
  readonly name: string;
  readonly description: string;
  readonly tools?: string[];
  readonly model?: string;
  readonly permissionMode?: string;
  readonly scope: 'project' | 'user' | 'builtin';
  readonly filePath: string;
  readonly prompt: string;
}

/**
 * Agent discovery result
 */
export interface AgentDiscoveryResult {
  success: boolean;
  agents?: AgentInfo[];
  error?: string;
}

/**
 * Agent search request
 */
export interface AgentSearchRequest {
  query: string;
  maxResults?: number;
}

/**
 * Discovers and manages Claude CLI agents from .claude/agents/ directories
 *
 * ARCHITECTURE:
 * - Scans project + user agent directories
 * - Parses YAML frontmatter for agent metadata
 * - Watches for file changes (real-time invalidation)
 * - Caches results until file change detected
 */
@injectable()
export class AgentDiscoveryService {
  private cache: AgentInfo[] = [];
  private cacheTimestamp = 0;
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext
  ) {}

  /**
   * Get built-in Claude Code agents
   */
  private getBuiltinAgents(): AgentInfo[] {
    return [
      {
        name: 'general-purpose',
        description:
          'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks',
        tools: ['*'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'statusline-setup',
        description: 'Configure Claude Code status line setting',
        tools: ['Read', 'Edit'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'Explore',
        description:
          'Fast agent specialized for exploring codebases, finding files by patterns, searching code',
        tools: ['All tools'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'Plan',
        description: 'Fast agent for codebase exploration and planning',
        tools: ['All tools'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'claude-code-guide',
        description:
          'Agent for Claude Code documentation and SDK architecture questions',
        tools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
    ];
  }

  /**
   * Discover all agents (project + user)
   */
  async discoverAgents(): Promise<AgentDiscoveryResult> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      // Get built-in agents (always available)
      const builtinAgents = this.getBuiltinAgents();

      if (!workspaceRoot) {
        return { success: true, agents: builtinAgents };
      }

      // Scan project agents
      const projectAgents = await this.scanAgentDirectory(
        path.join(workspaceRoot, '.claude/agents')
      );

      // Scan user agents
      const userAgents = await this.scanAgentDirectory(
        path.join(os.homedir(), '.claude/agents')
      );

      const allAgents = [
        ...builtinAgents, // Add built-in agents first - show at top
        ...projectAgents.map((a) => ({ ...a, scope: 'project' as const })),
        ...userAgents.map((a) => ({ ...a, scope: 'user' as const })),
      ];

      // Update cache
      this.cache = allAgents;
      this.cacheTimestamp = Date.now();

      return { success: true, agents: allAgents };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to discover agents: ${errorMessage}`,
      };
    }
  }

  /**
   * Search agents by query
   */
  async searchAgents(
    request: AgentSearchRequest
  ): Promise<AgentDiscoveryResult> {
    try {
      // Ensure cache is populated
      if (this.cache.length === 0) {
        await this.discoverAgents();
      }

      const { query, maxResults = 20 } = request;

      if (!query || query.trim() === '') {
        return { success: true, agents: this.cache.slice(0, maxResults) };
      }

      const lowerQuery = query.toLowerCase();
      const filtered = this.cache.filter(
        (agent) =>
          agent.name.toLowerCase().includes(lowerQuery) ||
          agent.description.toLowerCase().includes(lowerQuery)
      );

      return { success: true, agents: filtered.slice(0, maxResults) };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to search agents: ${errorMessage}`,
      };
    }
  }

  /**
   * Initialize file watchers for real-time updates
   */
  initializeWatchers(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // Watch project agents
    const projectWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '.claude/agents/*.md')
    );

    const refreshCache = () => {
      this.discoverAgents().catch((error) => {
        console.error('[AgentDiscovery] Failed to refresh cache:', error);
      });
    };

    projectWatcher.onDidCreate(refreshCache);
    projectWatcher.onDidChange(refreshCache);
    projectWatcher.onDidDelete(refreshCache);

    this.watchers.push(projectWatcher);
    this.context.subscriptions.push(projectWatcher);
  }

  /**
   * Scan agent directory for .md files
   */
  private async scanAgentDirectory(dir: string): Promise<AgentInfo[]> {
    try {
      const files = await fs.readdir(dir);
      const agentFiles = files.filter((f) => f.endsWith('.md'));

      const agents = await Promise.all(
        agentFiles.map((file) => this.parseAgentFile(path.join(dir, file)))
      );

      return agents.filter(Boolean) as AgentInfo[];
    } catch (error) {
      // Directory doesn't exist or not accessible
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.debug(
        `[AgentDiscovery] Directory ${dir} not accessible:`,
        errorMessage
      );
      return [];
    }
  }

  /**
   * Parse agent .md file with YAML frontmatter
   */
  private async parseAgentFile(filePath: string): Promise<AgentInfo | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter, content: prompt } = matter(content);

      // Validate required fields
      if (!frontmatter['name'] || !frontmatter['description']) {
        console.warn(
          `[AgentDiscovery] Invalid agent file (missing name/description): ${filePath}`
        );
        return null;
      }

      // Validate name format
      if (!/^[a-z0-9-]+$/.test(frontmatter['name'])) {
        console.warn(
          `[AgentDiscovery] Invalid agent name format: ${frontmatter['name']}`
        );
        return null;
      }

      return {
        name: frontmatter['name'],
        description: frontmatter['description'],
        tools: frontmatter['tools']?.split(',').map((t: string) => t.trim()),
        model: frontmatter['model'],
        permissionMode: frontmatter['permissionMode'],
        scope: 'project', // Will be overridden by caller
        filePath,
        prompt: prompt.trim(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[AgentDiscovery] Failed to parse agent file ${filePath}:`,
        errorMessage
      );
      return null;
    }
  }

  /**
   * Cleanup watchers on disposal
   */
  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
  }
}
