# TASK_2025_019 Phase 2: Implementation Guide

**Task**: Complete Autocomplete System - Agents, MCPs, Commands
**Phase**: 2 of 2 (Phase 1: @ File Autocomplete - separate task)
**Estimated Duration**: 12-16 hours
**Prerequisites**: Phase 1 completed (FilePickerService integrated with RPC)

---

## Executive Summary

This guide provides step-by-step implementation instructions for Phase 2 of TASK_2025_019, which adds autocomplete support for:

- **@ Agent invocation**: `@code-reviewer`, `@test-generator`
- **@ MCP resources**: `@github:issue://123`, `@postgres:schema://users`
- **/ Slash commands**: `/help`, `/review`, `/fix-issue`

**Implementation Strategy**: Extend existing FilePickerService pattern with three new discovery services following the same RPC integration approach established in Phase 1.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Step-by-Step Implementation](#step-by-step-implementation)
   - [Backend: Discovery Services](#backend-discovery-services)
   - [Backend: RPC Handler Registration](#backend-rpc-handler-registration)
   - [Frontend: Discovery Facades](#frontend-discovery-facades)
   - [Frontend: UI Components](#frontend-ui-components)
   - [Frontend: Chat Input Integration](#frontend-chat-input-integration)
3. [Testing Strategy](#testing-strategy)
4. [Risk Assessment](#risk-assessment)
5. [Integration Checklist](#integration-checklist)

---

## Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│ FRONTEND (Angular Webview)                                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ChatInputAreaComponent                                             │
│         ↓                                                            │
│  detectAutocompleteContext()                                        │
│         ↓                                                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ @ Trigger → Determine type:                                  │  │
│  │   - @filename     → FilePickerService.searchFiles()         │  │
│  │   - @agent-name   → AgentDiscoveryFacade.searchAgents()     │  │
│  │   - @server:      → MCPDiscoveryFacade.searchResources()    │  │
│  │                                                               │  │
│  │ / Trigger:                                                    │  │
│  │   - /command      → CommandDiscoveryFacade.searchCommands()  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│         ↓                                                            │
│  UnifiedSuggestionsDropdownComponent                                │
│         ↓                                                            │
│  User selects suggestion → Insert into message                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                          ↕ RPC (VSCodeService)
┌─────────────────────────────────────────────────────────────────────┐
│ BACKEND (VS Code Extension)                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  RPC Handlers (ptah-extension.ts)                                   │
│  ├── 'autocomplete:agents'     → AgentDiscoveryService             │
│  ├── 'autocomplete:mcps'       → MCPDiscoveryService               │
│  └── 'autocomplete:commands'   → CommandDiscoveryService           │
│         ↓                                                            │
│  Discovery Services (workspace-intelligence)                        │
│  ├── AgentDiscoveryService                                         │
│  │      ↓                                                           │
│  │   Scan .claude/agents/*.md (project + user)                     │
│  │   Parse YAML frontmatter                                        │
│  │   Cache + watch for changes                                     │
│  │                                                                  │
│  ├── MCPDiscoveryService                                           │
│  │      ↓                                                           │
│  │   Read .mcp.json (project + user)                               │
│  │   Parse server configurations                                   │
│  │   Health check via `claude mcp list`                            │
│  │                                                                  │
│  └── CommandDiscoveryService                                       │
│         ↓                                                           │
│      Hardcoded builtins + scan .claude/commands/*.md               │
│      Parse templates + frontmatter                                 │
│      Query MCP servers for exposed prompts                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Reuse Phase 1 Patterns**: Follow exact same RPC integration approach as file autocomplete
2. **Separation of Concerns**: Discovery services in backend, facades in frontend
3. **File-Based Discovery**: No CLI RPC API - scan filesystem directly
4. **Real-Time Updates**: File watchers for instant cache invalidation
5. **Graceful Degradation**: Handle missing files, offline MCPs gracefully

---

## Step-by-Step Implementation

### Backend: Discovery Services

**Location**: `libs/backend/workspace-intelligence/src/autocomplete/`

#### Step 1.1: Create AgentDiscoveryService

**File**: `libs/backend/workspace-intelligence/src/autocomplete/agent-discovery.service.ts`

```typescript
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as matter from 'gray-matter';

/**
 * Agent information parsed from .md file
 */
export interface AgentInfo {
  readonly name: string;
  readonly description: string;
  readonly tools?: string[];
  readonly model?: string;
  readonly permissionMode?: string;
  readonly scope: 'project' | 'user';
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
  private cacheTimestamp: number = 0;
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor(@inject(TOKENS.CONTEXT) private context: vscode.ExtensionContext) {}

  /**
   * Discover all agents (project + user)
   */
  async discoverAgents(): Promise<AgentDiscoveryResult> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return { success: false, error: 'No workspace folder open' };
      }

      // Scan project agents
      const projectAgents = await this.scanAgentDirectory(path.join(workspaceRoot, '.claude/agents'));

      // Scan user agents
      const userAgents = await this.scanAgentDirectory(path.join(os.homedir(), '.claude/agents'));

      const allAgents = [...projectAgents.map((a) => ({ ...a, scope: 'project' as const })), ...userAgents.map((a) => ({ ...a, scope: 'user' as const }))];

      // Update cache
      this.cache = allAgents;
      this.cacheTimestamp = Date.now();

      return { success: true, agents: allAgents };
    } catch (error) {
      return {
        success: false,
        error: `Failed to discover agents: ${error.message}`,
      };
    }
  }

  /**
   * Search agents by query
   */
  async searchAgents(request: AgentSearchRequest): Promise<AgentDiscoveryResult> {
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
      const filtered = this.cache.filter((agent) => agent.name.toLowerCase().includes(lowerQuery) || agent.description.toLowerCase().includes(lowerQuery));

      return { success: true, agents: filtered.slice(0, maxResults) };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search agents: ${error.message}`,
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
    const projectWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, '.claude/agents/*.md'));

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

      const agents = await Promise.all(agentFiles.map((file) => this.parseAgentFile(path.join(dir, file))));

      return agents.filter(Boolean) as AgentInfo[];
    } catch (error) {
      // Directory doesn't exist or not accessible
      console.debug(`[AgentDiscovery] Directory ${dir} not accessible:`, error.message);
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
      if (!frontmatter.name || !frontmatter.description) {
        console.warn(`[AgentDiscovery] Invalid agent file (missing name/description): ${filePath}`);
        return null;
      }

      // Validate name format
      if (!/^[a-z0-9-]+$/.test(frontmatter.name)) {
        console.warn(`[AgentDiscovery] Invalid agent name format: ${frontmatter.name}`);
        return null;
      }

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        tools: frontmatter.tools?.split(',').map((t: string) => t.trim()),
        model: frontmatter.model,
        permissionMode: frontmatter.permissionMode,
        scope: 'project', // Will be overridden by caller
        filePath,
        prompt: prompt.trim(),
      };
    } catch (error) {
      console.error(`[AgentDiscovery] Failed to parse agent file ${filePath}:`, error);
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
```

#### Step 1.2: Create MCPDiscoveryService

**File**: `libs/backend/workspace-intelligence/src/autocomplete/mcp-discovery.service.ts`

```typescript
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * MCP server information
 */
export interface MCPServerInfo {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly type: 'stdio' | 'http' | 'sse';
  readonly url?: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  error?: string;
}

/**
 * MCP resource information
 */
export interface MCPResourceInfo {
  readonly serverName: string;
  readonly uri: string;
  readonly fullUri: string;
  readonly name: string;
  readonly description?: string;
}

/**
 * MCP discovery result
 */
export interface MCPDiscoveryResult {
  success: boolean;
  servers?: MCPServerInfo[];
  error?: string;
}

/**
 * MCP search request
 */
export interface MCPSearchRequest {
  query: string;
  maxResults?: number;
  includeOffline?: boolean;
}

/**
 * Discovers and manages MCP servers from .mcp.json configuration
 *
 * ARCHITECTURE:
 * - Reads .mcp.json from project + user directories
 * - Merges configurations with priority (project > user)
 * - Checks server health via `claude mcp list`
 * - Polls health every 30 seconds
 * - Watches config files for changes
 */
@injectable()
export class MCPDiscoveryService {
  private cache: MCPServerInfo[] = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor(@inject(TOKENS.CONTEXT) private context: vscode.ExtensionContext) {}

  /**
   * Discover all MCP servers
   */
  async discoverMCPServers(): Promise<MCPDiscoveryResult> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return { success: false, error: 'No workspace folder open' };
      }

      // Read all config files
      const configs = await this.readAllConfigs(workspaceRoot);

      // Merge configs (higher priority overrides)
      const merged = this.mergeConfigs(configs);

      // Parse server definitions
      const servers: MCPServerInfo[] = Object.entries(merged.mcpServers || {}).map(([name, config]: [string, any]) => ({
        name,
        command: config.command,
        args: config.args || [],
        env: this.expandEnvVars(config.env || {}),
        type: config.type || 'stdio',
        url: config.url,
        status: 'unknown' as const,
        error: undefined,
      }));

      // Update cache
      this.cache = servers;

      // Check server health (async, don't block)
      this.checkServerHealth();

      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: `Failed to discover MCP servers: ${error.message}`,
      };
    }
  }

  /**
   * Search MCP servers by query
   */
  async searchMCPServers(request: MCPSearchRequest): Promise<MCPDiscoveryResult> {
    try {
      // Ensure cache is populated
      if (this.cache.length === 0) {
        await this.discoverMCPServers();
      }

      const { query, maxResults = 20, includeOffline = false } = request;

      // Filter by online status
      let filtered = includeOffline ? this.cache : this.cache.filter((s) => s.status === 'running');

      // Filter by query
      if (query && query.trim() !== '') {
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter((server) => server.name.toLowerCase().includes(lowerQuery));
      }

      return { success: true, servers: filtered.slice(0, maxResults) };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search MCP servers: ${error.message}`,
      };
    }
  }

  /**
   * Initialize file watchers and health polling
   */
  initializeWatchers(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // Watch .mcp.json
    const mcpWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, '.mcp.json'));

    const refreshCache = () => {
      this.discoverMCPServers().catch((error) => {
        console.error('[MCPDiscovery] Failed to refresh cache:', error);
      });
    };

    mcpWatcher.onDidChange(refreshCache);
    mcpWatcher.onDidCreate(refreshCache);
    mcpWatcher.onDidDelete(refreshCache);

    this.watchers.push(mcpWatcher);
    this.context.subscriptions.push(mcpWatcher);

    // Health check polling (every 30s)
    this.healthCheckInterval = setInterval(() => {
      this.checkServerHealth();
    }, 30000);

    // Initial health check
    this.checkServerHealth();
  }

  /**
   * Read all MCP config files
   */
  private async readAllConfigs(workspaceRoot: string): Promise<any[]> {
    const configPaths = [path.join(workspaceRoot, '.mcp.json'), path.join(workspaceRoot, '.claude/settings.local.json'), path.join(os.homedir(), '.claude/settings.local.json')];

    const configs = await Promise.all(
      configPaths.map(async (p) => {
        try {
          const content = await fs.readFile(p, 'utf-8');
          return JSON.parse(content);
        } catch {
          return null;
        }
      })
    );

    return configs.filter(Boolean);
  }

  /**
   * Merge multiple configs (later configs override earlier)
   */
  private mergeConfigs(configs: any[]): any {
    return configs.reduce(
      (merged, config) => {
        return {
          ...merged,
          mcpServers: {
            ...merged.mcpServers,
            ...config.mcpServers,
          },
        };
      },
      { mcpServers: {} }
    );
  }

  /**
   * Expand environment variables in config
   */
  private expandEnvVars(env: Record<string, string>): Record<string, string> {
    const expanded: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      expanded[key] = value.replace(/\$\{([^}:]+)(?::- ([^}]+))?\}/g, (_, varName, defaultValue) => {
        return process.env[varName] || defaultValue || '';
      });
    }

    return expanded;
  }

  /**
   * Check health of all MCP servers via CLI
   */
  private async checkServerHealth(): Promise<void> {
    try {
      const result = await execAsync('claude mcp list --output-format json', {
        timeout: 5000,
      });

      const status = JSON.parse(result.stdout);

      for (const server of this.cache) {
        if (status[server.name]) {
          server.status = status[server.name].status || 'unknown';
          server.error = status[server.name].error;
        } else {
          server.status = 'unknown';
        }
      }
    } catch (error) {
      console.warn('[MCPDiscovery] Failed to check server health:', error.message);
      // Don't update status if health check fails
    }
  }

  /**
   * Cleanup on disposal
   */
  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}
```

#### Step 1.3: Create CommandDiscoveryService

**File**: `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts`

```typescript
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

  constructor(@inject(TOKENS.CONTEXT) private context: vscode.ExtensionContext) {}

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
      const projectCommands = await this.scanCommandDirectory(path.join(workspaceRoot, '.claude/commands'));

      // User commands
      const userCommands = await this.scanCommandDirectory(path.join(os.homedir(), '.claude/commands'));

      const allCommands = [...builtins, ...projectCommands.map((c) => ({ ...c, scope: 'project' as const })), ...userCommands.map((c) => ({ ...c, scope: 'user' as const }))];

      // Update cache
      this.cache = allCommands;

      return { success: true, commands: allCommands };
    } catch (error) {
      return {
        success: false,
        error: `Failed to discover commands: ${error.message}`,
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
      const filtered = this.cache.filter((cmd) => cmd.name.toLowerCase().includes(lowerQuery) || cmd.description.toLowerCase().includes(lowerQuery));

      return { success: true, commands: filtered.slice(0, maxResults) };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search commands: ${error.message}`,
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
    const projectWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, '.claude/commands/**/*.md'));

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
      { name: 'init', description: 'Initialize project config', scope: 'builtin' },
      // TODO: Add remaining 17 built-in commands
    ];
  }

  /**
   * Scan command directory for .md files
   */
  private async scanCommandDirectory(dir: string): Promise<CommandInfo[]> {
    try {
      const files = await this.getAllMarkdownFiles(dir);

      const commands = await Promise.all(files.map((file) => this.parseCommandFile(file)));

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
        model: frontmatter.model,
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
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
  }
}
```

---

### Backend: RPC Handler Registration

**Location**: `apps/ptah-extension-vscode/src/core/ptah-extension.ts`

#### Step 2.1: Register Discovery Services

```typescript
// Add DI tokens
export const AUTOCOMPLETE_TOKENS = {
  AGENT_DISCOVERY: Symbol('AGENT_DISCOVERY'),
  MCP_DISCOVERY: Symbol('MCP_DISCOVERY'),
  COMMAND_DISCOVERY: Symbol('COMMAND_DISCOVERY'),
};

// Register services
container.register(AUTOCOMPLETE_TOKENS.AGENT_DISCOVERY, {
  useClass: AgentDiscoveryService,
});

container.register(AUTOCOMPLETE_TOKENS.MCP_DISCOVERY, {
  useClass: MCPDiscoveryService,
});

container.register(AUTOCOMPLETE_TOKENS.COMMAND_DISCOVERY, {
  useClass: CommandDiscoveryService,
});
```

#### Step 2.2: Register RPC Handlers

```typescript
// Register autocomplete RPC handlers
const agentDiscovery = container.resolve<AgentDiscoveryService>(AUTOCOMPLETE_TOKENS.AGENT_DISCOVERY);
const mcpDiscovery = container.resolve<MCPDiscoveryService>(AUTOCOMPLETE_TOKENS.MCP_DISCOVERY);
const commandDiscovery = container.resolve<CommandDiscoveryService>(AUTOCOMPLETE_TOKENS.COMMAND_DISCOVERY);

// Initialize watchers
agentDiscovery.initializeWatchers();
mcpDiscovery.initializeWatchers();
commandDiscovery.initializeWatchers();

// Agent autocomplete
rpcHandler.registerHandler('autocomplete:agents', async (data: { query: string; maxResults?: number }) => {
  return await agentDiscovery.searchAgents(data);
});

// MCP autocomplete
rpcHandler.registerHandler('autocomplete:mcps', async (data: { query: string; maxResults?: number; includeOffline?: boolean }) => {
  return await mcpDiscovery.searchMCPServers(data);
});

// Command autocomplete
rpcHandler.registerHandler('autocomplete:commands', async (data: { query: string; maxResults?: number }) => {
  return await commandDiscovery.searchCommands(data);
});
```

---

### Frontend: Discovery Facades

**Location**: `libs/frontend/core/src/lib/services/`

#### Step 3.1: Create AgentDiscoveryFacade

**File**: `libs/frontend/core/src/lib/services/agent-discovery.facade.ts`

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService } from './vscode.service';

export interface AgentSuggestion {
  readonly name: string;
  readonly description: string;
  readonly scope: 'project' | 'user';
  readonly icon: string; // For UI
}

@Injectable({
  providedIn: 'root',
})
export class AgentDiscoveryFacade {
  private readonly vscode = inject(VSCodeService);
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);

  readonly isLoading = this._isLoading.asReadonly();
  readonly agents = this._agents.asReadonly();

  /**
   * Fetch all agents from backend
   */
  async fetchAgents(): Promise<void> {
    this._isLoading.set(true);

    try {
      const result = await this.vscode.sendRequest<{
        success: boolean;
        agents?: Array<{
          name: string;
          description: string;
          scope: 'project' | 'user';
        }>;
        error?: string;
      }>({
        type: 'autocomplete:agents',
        data: { query: '', maxResults: 100 },
      });

      if (result.success && result.agents) {
        this._agents.set(
          result.agents.map((a) => ({
            ...a,
            icon: a.scope === 'project' ? '🤖' : '👤',
          }))
        );
      }
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Search agents by query
   */
  searchAgents(query: string): AgentSuggestion[] {
    if (!query) {
      return this._agents().slice(0, 10);
    }

    const lowerQuery = query.toLowerCase();
    return this._agents()
      .filter((a) => a.name.toLowerCase().includes(lowerQuery) || a.description.toLowerCase().includes(lowerQuery))
      .slice(0, 20);
  }
}
```

#### Step 3.2: Create MCPDiscoveryFacade

**File**: `libs/frontend/core/src/lib/services/mcp-discovery.facade.ts`

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService } from './vscode.service';

export interface MCPSuggestion {
  readonly name: string;
  readonly status: 'running' | 'stopped' | 'error' | 'unknown';
  readonly type: 'stdio' | 'http' | 'sse';
  readonly icon: string;
}

@Injectable({
  providedIn: 'root',
})
export class MCPDiscoveryFacade {
  private readonly vscode = inject(VSCodeService);
  private readonly _isLoading = signal(false);
  private readonly _servers = signal<MCPSuggestion[]>([]);

  readonly isLoading = this._isLoading.asReadonly();
  readonly servers = this._servers.asReadonly();

  /**
   * Fetch all MCP servers from backend
   */
  async fetchServers(): Promise<void> {
    this._isLoading.set(true);

    try {
      const result = await this.vscode.sendRequest<{
        success: boolean;
        servers?: Array<{
          name: string;
          status: 'running' | 'stopped' | 'error' | 'unknown';
          type: 'stdio' | 'http' | 'sse';
        }>;
        error?: string;
      }>({
        type: 'autocomplete:mcps',
        data: { query: '', maxResults: 50, includeOffline: false },
      });

      if (result.success && result.servers) {
        this._servers.set(
          result.servers.map((s) => ({
            ...s,
            icon: s.status === 'running' ? '🔌' : '⚠️',
          }))
        );
      }
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Search MCP servers by query
   */
  searchServers(query: string): MCPSuggestion[] {
    if (!query) {
      return this._servers().slice(0, 10);
    }

    const lowerQuery = query.toLowerCase();
    return this._servers()
      .filter((s) => s.name.toLowerCase().includes(lowerQuery))
      .slice(0, 20);
  }
}
```

#### Step 3.3: Create CommandDiscoveryFacade

**File**: `libs/frontend/core/src/lib/services/command-discovery.facade.ts`

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService } from './vscode.service';

export interface CommandSuggestion {
  readonly name: string;
  readonly description: string;
  readonly scope: 'builtin' | 'project' | 'user' | 'mcp';
  readonly argumentHint?: string;
  readonly icon: string;
}

@Injectable({
  providedIn: 'root',
})
export class CommandDiscoveryFacade {
  private readonly vscode = inject(VSCodeService);
  private readonly _isLoading = signal(false);
  private readonly _commands = signal<CommandSuggestion[]>([]);

  readonly isLoading = this._isLoading.asReadonly();
  readonly commands = this._commands.asReadonly();

  /**
   * Fetch all commands from backend
   */
  async fetchCommands(): Promise<void> {
    this._isLoading.set(true);

    try {
      const result = await this.vscode.sendRequest<{
        success: boolean;
        commands?: Array<{
          name: string;
          description: string;
          scope: 'builtin' | 'project' | 'user' | 'mcp';
          argumentHint?: string;
        }>;
        error?: string;
      }>({
        type: 'autocomplete:commands',
        data: { query: '', maxResults: 100 },
      });

      if (result.success && result.commands) {
        this._commands.set(
          result.commands.map((c) => ({
            ...c,
            icon: this.getCommandIcon(c.scope),
          }))
        );
      }
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Search commands by query
   */
  searchCommands(query: string): CommandSuggestion[] {
    if (!query) {
      return this._commands().slice(0, 10);
    }

    const lowerQuery = query.toLowerCase();
    return this._commands()
      .filter((c) => c.name.toLowerCase().includes(lowerQuery) || c.description.toLowerCase().includes(lowerQuery))
      .slice(0, 20);
  }

  private getCommandIcon(scope: string): string {
    switch (scope) {
      case 'builtin':
        return '⚡';
      case 'project':
        return '📦';
      case 'user':
        return '👤';
      case 'mcp':
        return '🔌';
      default:
        return '❓';
    }
  }
}
```

---

### Frontend: UI Components

**Location**: `libs/frontend/chat/src/lib/components/`

#### Step 4.1: Update FileSuggestionsDropdownComponent

Rename to `UnifiedSuggestionsDropdownComponent` to support all suggestion types.

**File**: `libs/frontend/chat/src/lib/components/unified-suggestions-dropdown/unified-suggestions-dropdown.component.ts`

```typescript
import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { FileSuggestion, AgentSuggestion, MCPSuggestion, CommandSuggestion } from '@ptah-extension/core';

export type SuggestionItem = ({ type: 'file' } & FileSuggestion) | ({ type: 'agent' } & AgentSuggestion) | ({ type: 'mcp' } & MCPSuggestion) | ({ type: 'command' } & CommandSuggestion);

@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dropdown-container" [style.top.px]="positionTop()" [style.left.px]="positionLeft()">
      @if (isLoading()) {
      <div class="loading">Loading suggestions...</div>
      } @else if (suggestions().length === 0) {
      <div class="empty">No suggestions found</div>
      } @else {
      <div class="suggestions-list">
        @for (suggestion of suggestions(); track trackBy($index, suggestion)) {
        <div class="suggestion-item" [class.selected]="$index === selectedIndex()" (click)="selectSuggestion(suggestion)" (mouseenter)="selectedIndex.set($index)">
          <span class="icon">{{ getIcon(suggestion) }}</span>
          <div class="content">
            <div class="name">{{ getName(suggestion) }}</div>
            <div class="description">{{ getDescription(suggestion) }}</div>
          </div>
        </div>
        }
      </div>
      }
    </div>
  `,
  styles: [
    `
      .dropdown-container {
        position: absolute;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 4px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        max-height: 300px;
        overflow-y: auto;
        z-index: 1000;
        min-width: 300px;
      }

      .loading,
      .empty {
        padding: 12px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
      }

      .suggestions-list {
        display: flex;
        flex-direction: column;
      }

      .suggestion-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        cursor: pointer;
        transition: background-color 0.1s;
      }

      .suggestion-item:hover,
      .suggestion-item.selected {
        background-color: var(--vscode-list-hoverBackground);
      }

      .icon {
        font-size: 18px;
        margin-right: 8px;
      }

      .content {
        flex: 1;
        overflow: hidden;
      }

      .name {
        font-weight: 500;
        color: var(--vscode-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .description {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ],
})
export class UnifiedSuggestionsDropdownComponent {
  // Inputs
  readonly suggestions = input.required<SuggestionItem[]>();
  readonly isLoading = input(false);
  readonly positionTop = input(0);
  readonly positionLeft = input(0);

  // Outputs
  readonly suggestionSelected = output<SuggestionItem>();
  readonly closed = output<void>();

  // State
  readonly selectedIndex = computed(() => 0);

  // Helper methods
  getIcon(item: SuggestionItem): string {
    return item.icon;
  }

  getName(item: SuggestionItem): string {
    return item.name;
  }

  getDescription(item: SuggestionItem): string {
    return item.description || '';
  }

  selectSuggestion(item: SuggestionItem): void {
    this.suggestionSelected.emit(item);
  }

  trackBy(index: number, item: SuggestionItem): string {
    return `${item.type}-${item.name}`;
  }
}
```

---

### Frontend: Chat Input Integration

**Location**: `libs/frontend/chat/src/lib/components/chat-input/chat-input-area.component.ts`

#### Step 5.1: Update ChatInputAreaComponent

```typescript
// Add imports
import {
  AgentDiscoveryFacade,
  MCPDiscoveryFacade,
  CommandDiscoveryFacade
} from '@ptah-extension/core';

// Inject facades
readonly agentDiscovery = inject(AgentDiscoveryFacade);
readonly mcpDiscovery = inject(MCPDiscoveryFacade);
readonly commandDiscovery = inject(CommandDiscoveryFacade);

// Update state signals
private readonly _suggestionType = signal<'file' | 'agent' | 'mcp' | 'command' | null>(null);
private readonly _unifiedSuggestions = signal<SuggestionItem[]>([]);

// Update handleAtSymbolInput
private handleAtSymbolInput(textarea: HTMLTextAreaElement): void {
  const cursorPos = textarea.selectionStart || 0;
  const text = textarea.value;
  const textBeforeCursor = text.substring(0, cursorPos);

  // Check for @ trigger
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
  if (lastAtIndex === -1) {
    this.hideSuggestions();
    return;
  }

  const searchText = textBeforeCursor.substring(lastAtIndex + 1);

  // Determine suggestion type
  if (searchText.includes(':')) {
    // MCP resource (e.g., @github:)
    const serverName = searchText.split(':')[0];
    const suggestions = this.mcpDiscovery.searchServers(serverName);
    this._suggestionType.set('mcp');
    this._unifiedSuggestions.set(suggestions.map(s => ({ type: 'mcp', ...s })));
  } else if (searchText.match(/^[a-z0-9-]+$/)) {
    // Could be agent or file - check both
    const agentSuggestions = this.agentDiscovery.searchAgents(searchText);
    const fileSuggestions = this.filePickerService.searchFiles(searchText);

    if (agentSuggestions.length > 0 && fileSuggestions.length > 0) {
      // Show both (agents first)
      this._suggestionType.set('file'); // Default to file
      this._unifiedSuggestions.set([
        ...agentSuggestions.map(s => ({ type: 'agent' as const, ...s })),
        ...fileSuggestions.map(s => ({ type: 'file' as const, ...s }))
      ]);
    } else if (agentSuggestions.length > 0) {
      this._suggestionType.set('agent');
      this._unifiedSuggestions.set(agentSuggestions.map(s => ({ type: 'agent', ...s })));
    } else {
      this._suggestionType.set('file');
      this._unifiedSuggestions.set(fileSuggestions.map(s => ({ type: 'file', ...s })));
    }
  } else {
    // File path (contains . or /)
    const fileSuggestions = this.filePickerService.searchFiles(searchText);
    this._suggestionType.set('file');
    this._unifiedSuggestions.set(fileSuggestions.map(s => ({ type: 'file', ...s })));
  }

  this._showFileSuggestions.set(true);
}

// Add handler for / trigger
private handleSlashTrigger(textarea: HTMLTextAreaElement): void {
  const cursorPos = textarea.selectionStart || 0;
  const text = textarea.value;
  const textBeforeCursor = text.substring(0, cursorPos);

  // Check if cursor is at start of line after /
  const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    return;
  }

  // Check if / is at line start
  const textBeforeSlash = textBeforeCursor.substring(0, lastSlashIndex);
  if (textBeforeSlash.trim() !== '') {
    return; // Not at line start
  }

  const searchText = textBeforeCursor.substring(lastSlashIndex + 1);

  // Search commands
  const commandSuggestions = this.commandDiscovery.searchCommands(searchText);
  this._suggestionType.set('command');
  this._unifiedSuggestions.set(commandSuggestions.map(s => ({ type: 'command', ...s })));
  this._showFileSuggestions.set(true);
}

// Update onInput to handle both @ and /
onInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  this.messageChange.emit(target.value);
  this.adjustTextareaHeight(target);

  // Check for @ or /
  this.handleAtSymbolInput(target);
  this.handleSlashTrigger(target);
}

// Update initialization (fetch all suggestions on load)
async ngOnInit() {
  await Promise.all([
    this.agentDiscovery.fetchAgents(),
    this.mcpDiscovery.fetchServers(),
    this.commandDiscovery.fetchCommands()
  ]);
}
```

---

## Testing Strategy

### Unit Tests

**Backend Services**:

- `AgentDiscoveryService.spec.ts`:

  - Test agent file parsing (valid frontmatter, missing fields, invalid format)
  - Test directory scanning (project vs user)
  - Test search functionality (name, description)
  - Test file watching (create, modify, delete)

- `MCPDiscoveryService.spec.ts`:

  - Test config file reading (.mcp.json, settings.local.json)
  - Test config merging (priority order)
  - Test environment variable expansion
  - Test health checking (mock `claude mcp list`)

- `CommandDiscoveryService.spec.ts`:
  - Test built-in command list
  - Test custom command parsing
  - Test subdirectory scanning
  - Test search functionality

**Frontend Facades**:

- Test RPC call formatting
- Test signal state management
- Test search filtering logic

### Integration Tests

**Backend → Frontend**:

- Test RPC handler registration
- Test file watcher triggering cache refresh
- Test health polling for MCPs

**End-to-End**:

- User types `@` → dropdown shows files + agents
- User types `@github:` → dropdown shows MCP resources
- User types `/` → dropdown shows commands
- User selects suggestion → correct syntax inserted

### Manual Testing Checklist

- [ ] Create `.claude/agents/test-agent.md` → appears in dropdown
- [ ] Modify agent file → cache refreshes automatically
- [ ] Delete agent file → removed from dropdown
- [ ] Create `.mcp.json` with server → appears in dropdown
- [ ] Offline MCP server → hidden from dropdown (or marked offline)
- [ ] Create `.claude/commands/test.md` → appears in dropdown
- [ ] Type `@agent-name` → agent suggestion shown first
- [ ] Type `@filename` → file suggestions shown
- [ ] Type `/help` → built-in command shown
- [ ] Type `/custom` → custom command shown

---

## Risk Assessment

### High Risk

1. **File Watching Performance** (Risk: 7/10):

   - **Issue**: Watching large directories (1000+ files) may impact performance
   - **Mitigation**: Use VS Code FileSystemWatcher (optimized), limit to `.claude/` directory only
   - **Fallback**: Poll for changes every 5 seconds if watching fails

2. **MCP Health Checking** (Risk: 6/10):
   - **Issue**: `claude mcp list` may hang or timeout
   - **Mitigation**: 5 second timeout, catch errors, mark as 'unknown' status
   - **Fallback**: Skip health check if CLI unavailable, show all servers as 'unknown'

### Medium Risk

3. **Agent File Parsing** (Risk: 5/10):

   - **Issue**: Malformed YAML frontmatter may crash parser
   - **Mitigation**: Try/catch + validation, skip invalid files, log warnings
   - **Fallback**: Show notification to user about invalid file

4. **RPC Type Safety** (Risk: 4/10):
   - **Issue**: Frontend/backend type mismatch
   - **Mitigation**: Share types via `@ptah-extension/shared`, use strict TypeScript
   - **Fallback**: Runtime validation with Zod schemas

### Low Risk

5. **Cache Staleness** (Risk: 3/10):

   - **Issue**: Cache not refreshed after file changes
   - **Mitigation**: File watchers trigger immediate refresh
   - **Fallback**: User can restart extension to force refresh

6. **UI Performance** (Risk: 2/10):
   - **Issue**: Dropdown rendering 100+ items may lag
   - **Mitigation**: Limit to 20 results, virtual scrolling if needed
   - **Fallback**: Paginate results client-side

---

## Integration Checklist

### Backend Setup

- [ ] Install dependencies: `gray-matter` (for YAML frontmatter parsing)
- [ ] Create `libs/backend/workspace-intelligence/src/autocomplete/` directory
- [ ] Implement `AgentDiscoveryService`
- [ ] Implement `MCPDiscoveryService`
- [ ] Implement `CommandDiscoveryService`
- [ ] Register services in DI container
- [ ] Register RPC handlers in `ptah-extension.ts`
- [ ] Initialize file watchers on activation
- [ ] Export services from `libs/backend/workspace-intelligence/src/index.ts`

### Frontend Setup

- [ ] Create `libs/frontend/core/src/lib/services/` directory
- [ ] Implement `AgentDiscoveryFacade`
- [ ] Implement `MCPDiscoveryFacade`
- [ ] Implement `CommandDiscoveryFacade`
- [ ] Export facades from `libs/frontend/core/src/index.ts`
- [ ] Create `UnifiedSuggestionsDropdownComponent`
- [ ] Update `ChatInputAreaComponent` to handle @ and /
- [ ] Add icon assets for different suggestion types
- [ ] Update chat component to fetch suggestions on init

### Testing

- [ ] Write unit tests for all discovery services
- [ ] Write unit tests for all facades
- [ ] Write integration tests for RPC handlers
- [ ] Test file watching (create, modify, delete)
- [ ] Test MCP health polling
- [ ] Manual testing with real `.claude/` files

### Documentation

- [ ] Update library CLAUDE.md files
- [ ] Add usage examples for developers
- [ ] Document RPC message formats
- [ ] Create troubleshooting guide for common issues

---

## Timeline Estimate

| Phase                       | Duration        | Tasks                                             |
| --------------------------- | --------------- | ------------------------------------------------- |
| **Backend Implementation**  | 4-5 hours       | Discovery services, RPC handlers, file watchers   |
| **Frontend Implementation** | 3-4 hours       | Facades, unified dropdown, chat input integration |
| **Testing**                 | 3-4 hours       | Unit tests, integration tests, manual testing     |
| **Bug Fixes & Polish**      | 2-3 hours       | Handle edge cases, improve UX, performance tuning |
| **Total**                   | **12-16 hours** |                                                   |

---

## Next Steps

1. **Review Research Report**: Read `CLAUDE_CLI_AUTOCOMPLETE_RESEARCH.md` for detailed context
2. **Review Quick Reference**: Read `AUTOCOMPLETE_QUICK_REFERENCE.md` for syntax cheat sheet
3. **Backend First**: Implement all three discovery services
4. **Test Backend**: Verify RPC handlers work with test data
5. **Frontend Next**: Implement facades and UI components
6. **Integration**: Wire up chat input to use all suggestion types
7. **Testing**: Comprehensive testing (unit + integration + E2E)
8. **Documentation**: Update CLAUDE.md files and user docs

---

**End of Implementation Guide**
