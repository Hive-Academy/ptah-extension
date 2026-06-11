/**
 * Harness Namespace Builder
 *
 * Harness-specific MCP tools for the harness builder agent.
 * Provides the tools the harness builder agent uses during its multi-turn
 * execution to search skills, create skills, search the MCP registry, list
 * installed MCP servers, and propose configuration updates to the surface via
 * proposeConfig.
 *
 * Pattern: namespace-builders/json-namespace.builder.ts
 */

import * as path from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile, readFile, readdir, stat } from 'fs/promises';
import * as os from 'os';
import {
  HarnessConfigUpdatesSchema,
  MESSAGE_TYPES,
  type HarnessConfig,
  type SkillShEntry,
} from '@ptah-extension/shared';

/**
 * Minimal skills.sh client surface the harness namespace consumes.
 */
export interface HarnessSkillsDirectory {
  hasKey(): Promise<boolean>;
  search(query: string, limit?: number): Promise<SkillShEntry[]>;
}

/**
 * Minimal MCP registry source surface (official or Smithery).
 */
export interface HarnessMcpRegistrySource {
  listServers(options?: { query?: string; limit?: number }): Promise<{
    servers: Array<{ name: string; description?: string }>;
    next_cursor?: string;
  }>;
}

/**
 * A skill returned by searchSkills, tagged with its origin.
 */
export interface HarnessSkillResult {
  skillId: string;
  displayName: string;
  description: string;
  pluginId: string;
  isDisabled: boolean;
  source: 'local' | 'skills.sh';
  installSource?: string;
  installs?: number;
}

/**
 * An MCP server returned by searchMcpRegistry, tagged with its registry source.
 */
export interface HarnessMcpServerResult {
  name: string;
  description?: string;
  source: 'official' | 'smithery';
}

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
  mcpRegistry: HarnessMcpRegistrySource;
  skillsDirectory?: HarnessSkillsDirectory;
  smitheryRegistry?: HarnessMcpRegistrySource;
  getWorkspaceRoot: () => string;
  broadcast: (type: string, payload: unknown) => void;
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
  searchSkills(query?: string): Promise<HarnessSkillResult[]>;
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
    servers: HarnessMcpServerResult[];
    next_cursor?: string;
  }>;
  listInstalledMcpServers(): Promise<
    Array<{ name: string; config: Record<string, unknown>; source: string }>
  >;
  proposeConfig(
    configUpdates: Partial<HarnessConfig>,
    isConfigComplete?: boolean,
  ): Promise<string>;
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

async function discoverHarnessPluginPaths(logger: {
  warn(msg: string): void;
}): Promise<string[]> {
  const pluginsBase = path.join(os.homedir(), '.ptah', 'plugins');
  let entries: string[];
  try {
    entries = await readdir(pluginsBase);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(
        `[Harness] Failed to read plugins directory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith('ptah-harness-')) continue;
    const pluginPath = path.join(pluginsBase, entry);
    try {
      if ((await stat(pluginPath)).isDirectory()) {
        paths.push(pluginPath);
      }
    } catch (error: unknown) {
      logger.warn(
        `[Harness] Skipping unreadable harness plugin dir ${pluginPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return paths;
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
  const {
    pluginLoader,
    mcpRegistry,
    skillsDirectory,
    smitheryRegistry,
    getWorkspaceRoot,
    broadcast,
    logger,
  } = deps;

  return {
    async searchSkills(query?: string): Promise<HarnessSkillResult[]> {
      const enabledPaths = pluginLoader.resolveCurrentPluginPaths();
      const harnessPaths = await discoverHarnessPluginPaths(logger);
      const mergedPaths = Array.from(
        new Set([...enabledPaths, ...harnessPaths]),
      );
      const allSkills = pluginLoader.discoverSkillsForPlugins(mergedPaths);
      const disabledIds = new Set(pluginLoader.getDisabledSkillIds());

      const localResults: HarnessSkillResult[] = allSkills.map((skill) => ({
        skillId: skill.skillId,
        displayName: skill.displayName,
        description: skill.description,
        pluginId: skill.pluginId,
        isDisabled: disabledIds.has(skill.skillId),
        source: 'local',
      }));

      const trimmedQuery = query?.trim() ?? '';
      const filteredLocal =
        trimmedQuery.length === 0
          ? localResults
          : localResults.filter((skill) => {
              const lowerQuery = trimmedQuery.toLowerCase();
              return (
                skill.skillId.toLowerCase().includes(lowerQuery) ||
                skill.displayName.toLowerCase().includes(lowerQuery) ||
                skill.description.toLowerCase().includes(lowerQuery)
              );
            });

      if (trimmedQuery.length === 0 || !skillsDirectory) {
        return filteredLocal;
      }

      let remoteResults: HarnessSkillResult[] = [];
      try {
        const entries = await skillsDirectory.search(trimmedQuery);
        remoteResults = entries.map((entry) => ({
          skillId: entry.skillId,
          displayName: entry.name,
          description: entry.description,
          pluginId: entry.source,
          isDisabled: false,
          source: 'skills.sh',
          installSource: entry.source,
          installs: entry.installs,
        }));
      } catch (error: unknown) {
        logger.warn(
          `[Harness] skills.sh search failed, returning local skills only: ${error instanceof Error ? error.message : String(error)}`,
        );
        return filteredLocal;
      }

      return [...filteredLocal, ...remoteResults];
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
      if (existsSync(skillMdPath)) {
        throw new Error(
          `Skill "${name}" already exists at ${skillMdPath}. Use a different name or delete the existing skill first.`,
        );
      }
      await mkdir(skillDir, { recursive: true });
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
      const effectiveLimit = limit ?? 10;

      const official = await mcpRegistry.listServers({
        query,
        limit: effectiveLimit,
      });
      const officialServers: HarnessMcpServerResult[] = official.servers.map(
        (server) => ({
          name: server.name,
          description: server.description,
          source: 'official',
        }),
      );

      let smitheryServers: HarnessMcpServerResult[] = [];
      if (smitheryRegistry) {
        try {
          const smithery = await smitheryRegistry.listServers({
            query,
            limit: effectiveLimit,
          });
          smitheryServers = smithery.servers.map((server) => ({
            name: server.name,
            description: server.description,
            source: 'smithery',
          }));
        } catch (error: unknown) {
          logger.warn(
            `[Harness] Smithery registry search failed, returning official results only: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return {
        servers: [...officialServers, ...smitheryServers],
        next_cursor: official.next_cursor,
      };
    },

    async listInstalledMcpServers() {
      const servers: Array<{
        name: string;
        config: Record<string, unknown>;
        source: string;
      }> = [];
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

    async proposeConfig(
      configUpdates: Partial<HarnessConfig>,
      isConfigComplete?: boolean,
    ) {
      const parsed = HarnessConfigUpdatesSchema.safeParse(configUpdates);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new Error(`Invalid configUpdates: ${issues}`);
      }

      broadcast(MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED, {
        configUpdates: parsed.data,
        isConfigComplete: isConfigComplete ?? false,
      });

      const fieldCount = Object.keys(parsed.data).length;
      logger.info(
        `[Harness] proposeConfig applied ${fieldCount} field(s), complete=${isConfigComplete ?? false}`,
      );

      return isConfigComplete
        ? 'Configuration marked complete and pushed to the surface.'
        : `Proposed ${fieldCount} configuration field(s) to the surface.`;
    },
  };
}
