/**
 * Harness Namespace Builder
 *
 * Harness-specific MCP tools for the harness builder agent.
 * Provides 4 tools that the harness builder agent can use during its multi-turn
 * execution to search skills, create skills, search the MCP registry, and
 * list installed MCP servers.
 *
 * Pattern: namespace-builders/json-namespace.builder.ts
 */

import * as path from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile, readFile } from 'fs/promises';
import * as os from 'os';

/**
 * Dependencies required to build the harness namespace.
 */
export interface HarnessNamespaceDependencies {
  pluginLoader: {
    resolveCurrentPluginPaths(): string[];
    discoverSkillsForPlugins(pluginPaths: string[]): Array<{
      skillId: string;
      displayName: string;
      description: string;
      pluginId: string;
    }>;
    getDisabledSkillIds(): string[];
  };
  mcpRegistry: {
    listServers(options?: { query?: string; limit?: number }): Promise<{
      servers: Array<{ name: string; description?: string }>;
      next_cursor?: string;
    }>;
  };
  getWorkspaceRoot: () => string;
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

/**
 * Harness namespace shape exposed on ptah.harness
 */
export interface HarnessNamespace {
  searchSkills(query?: string): Promise<
    Array<{
      skillId: string;
      displayName: string;
      description: string;
      pluginId: string;
      isDisabled: boolean;
    }>
  >;
  createSkill(
    name: string,
    description: string,
    content: string,
    allowedTools?: string[],
  ): Promise<{ skillId: string; skillPath: string }>;
  searchMcpRegistry(
    query: string,
    limit?: number,
  ): Promise<{
    servers: Array<{ name: string; description?: string }>;
    next_cursor?: string;
  }>;
  listInstalledMcpServers(): Promise<
    Array<{ name: string; config: Record<string, unknown>; source: string }>
  >;
}

/**
 * Sanitize a name for use as a directory/file identifier.
 * Lowercases, removes non-alphanumeric except hyphens, replaces spaces with hyphens.
 */
function sanitizeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unnamed'
  );
}

/**
 * Build the harness namespace with 4 MCP-accessible methods.
 *
 * @param deps - Dependencies containing plugin loader, MCP registry, workspace root, and logger
 * @returns HarnessNamespace with searchSkills, createSkill, searchMcpRegistry, listInstalledMcpServers
 */
export function buildHarnessNamespace(
  deps: HarnessNamespaceDependencies,
): HarnessNamespace {
  const { pluginLoader, mcpRegistry, getWorkspaceRoot, logger } = deps;

  return {
    async searchSkills(query?: string) {
      const pluginPaths = pluginLoader.resolveCurrentPluginPaths();
      const allSkills = pluginLoader.discoverSkillsForPlugins(pluginPaths);
      const disabledIds = new Set(pluginLoader.getDisabledSkillIds());

      const results = allSkills.map((skill) => ({
        skillId: skill.skillId,
        displayName: skill.displayName,
        description: skill.description,
        pluginId: skill.pluginId,
        isDisabled: disabledIds.has(skill.skillId),
      }));

      if (!query || query.trim().length === 0) {
        return results;
      }

      const lowerQuery = query.toLowerCase();
      return results.filter(
        (skill) =>
          skill.skillId.toLowerCase().includes(lowerQuery) ||
          skill.displayName.toLowerCase().includes(lowerQuery) ||
          skill.description.toLowerCase().includes(lowerQuery),
      );
    },

    async createSkill(
      name: string,
      description: string,
      content: string,
      allowedTools?: string[],
    ) {
      const sanitizedName = sanitizeName(name);

      if (sanitizedName.length === 0 || sanitizedName === 'unnamed') {
        throw new Error(
          'Invalid skill name: must contain at least one alphanumeric character',
        );
      }

      const ptahHome = path.join(os.homedir(), '.ptah');
      const pluginDir = path.join(
        ptahHome,
        'plugins',
        `ptah-harness-${sanitizedName}`,
      );
      const skillDir = path.join(pluginDir, 'skills', sanitizedName);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      // Check for existing skill to prevent silent overwrite
      if (existsSync(skillMdPath)) {
        throw new Error(
          `Skill "${name}" already exists at ${skillMdPath}. Use a different name or delete the existing skill first.`,
        );
      }

      // Create directory structure
      await mkdir(skillDir, { recursive: true });

      // Escape values for YAML frontmatter
      const escapedName = name.replace(/"/g, '\\"');
      const escapedDesc = description
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');

      const toolsSection =
        allowedTools && allowedTools.length > 0
          ? `\nallowed_tools:\n${allowedTools.map((t) => `  - ${t}`).join('\n')}`
          : '';

      const skillContent = [
        '---',
        `name: "${escapedName}"`,
        `description: "${escapedDesc}"`,
        `source: harness${toolsSection}`,
        '---',
        '',
        content,
        '',
      ].join('\n');

      await writeFile(skillMdPath, skillContent, 'utf-8');

      logger.info(`[Harness] Created skill "${name}" at ${skillMdPath}`);

      return { skillId: sanitizedName, skillPath: skillMdPath };
    },

    async searchMcpRegistry(query: string, limit?: number) {
      const result = await mcpRegistry.listServers({
        query,
        limit: limit ?? 10,
      });
      return result;
    },

    async listInstalledMcpServers() {
      const servers: Array<{
        name: string;
        config: Record<string, unknown>;
        source: string;
      }> = [];

      // Read .vscode/mcp.json from workspace
      const wsRoot = getWorkspaceRoot();
      const vscodeMcpPath = path.join(wsRoot, '.vscode', 'mcp.json');
      try {
        if (existsSync(vscodeMcpPath)) {
          const raw = await readFile(vscodeMcpPath, 'utf-8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const mcpServers =
            (parsed['servers'] as Record<string, unknown>) ??
            (parsed['mcpServers'] as Record<string, unknown>) ??
            {};

          for (const [name, config] of Object.entries(mcpServers)) {
            servers.push({
              name,
              config:
                typeof config === 'object' && config !== null
                  ? (config as Record<string, unknown>)
                  : {},
              source: '.vscode/mcp.json',
            });
          }
        }
      } catch (err) {
        logger.warn(
          `[Harness] Failed to read .vscode/mcp.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Read .mcp.json from workspace root
      const rootMcpPath = path.join(wsRoot, '.mcp.json');
      try {
        if (existsSync(rootMcpPath)) {
          const raw = await readFile(rootMcpPath, 'utf-8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const mcpServers =
            (parsed['servers'] as Record<string, unknown>) ??
            (parsed['mcpServers'] as Record<string, unknown>) ??
            {};

          for (const [name, config] of Object.entries(mcpServers)) {
            servers.push({
              name,
              config:
                typeof config === 'object' && config !== null
                  ? (config as Record<string, unknown>)
                  : {},
              source: '.mcp.json',
            });
          }
        }
      } catch (err) {
        logger.warn(
          `[Harness] Failed to read .mcp.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return servers;
    },
  };
}
