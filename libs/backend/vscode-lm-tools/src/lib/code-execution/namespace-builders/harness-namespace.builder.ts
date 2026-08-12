/**
 * Harness Namespace Builder
 *
 * Harness-specific MCP tools for the harness builder agent.
 * Provides the tools the harness builder agent uses during its multi-turn
 * execution to search skills, create skills, search the MCP registry, list
 * installed MCP servers, install an MCP server, and propose configuration
 * updates to the surface via proposeConfig.
 *
 * Pattern: namespace-builders/json-namespace.builder.ts
 */

import * as path from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile, readFile } from 'fs/promises';
import * as os from 'os';
import { z } from 'zod';
import { HarnessConfigUpdatesSchema } from '@ptah-extension/shared/schemas';
import {
  HARNESS_DEFAULT_MCP_TARGETS,
  MESSAGE_TYPES,
  type HarnessConfig,
  type McpInstallResult,
  type McpInstallTarget,
  type McpServerConfig,
  type SkillShEntry,
} from '@ptah-extension/shared';

/**
 * Minimal skills.sh client surface the harness namespace consumes.
 */
export interface HarnessSkillsDirectory {
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
 * Minimal MCP install surface the harness namespace consumes.
 *
 * Structurally satisfied by `McpInstallService` from
 * `@ptah-extension/cli-agent-runtime` — declared here as a narrow interface so
 * this builder stays unit-testable and does not bind to the concrete installer
 * (same shape rule as `HarnessMcpRegistrySource` / `HarnessSkillsDirectory`).
 */
export interface HarnessMcpInstaller {
  install(
    serverName: string,
    serverKey: string,
    config: McpServerConfig,
    targets: McpInstallTarget[],
    workspaceRoot?: string,
  ): Promise<McpInstallResult[]>;
}

/**
 * Outcome of installMcpServer: the resolved identity of the install, the raw
 * per-target results, the deduped set of config files written, and any
 * per-target failures surfaced as warnings rather than a hard throw.
 */
export interface HarnessMcpInstallOutcome {
  serverName: string;
  serverKey: string;
  targets: McpInstallTarget[];
  installedPaths: string[];
  results: McpInstallResult[];
  warnings: string[];
}

/** Environment / header maps carried on an MCP transport config. */
const McpStringMapSchema = z.record(z.string(), z.string());

/**
 * Boundary schema for the transport config the agent hands to installMcpServer.
 * Mirrors the `McpServerConfig` discriminated union in
 * `libs/shared/src/lib/types/mcp-directory.types.ts`.
 */
const McpServerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: McpStringMapSchema.optional(),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string().url(),
    headers: McpStringMapSchema.optional(),
    env: McpStringMapSchema.optional(),
  }),
  z.object({
    type: z.literal('sse'),
    url: z.string().url(),
    headers: McpStringMapSchema.optional(),
    env: McpStringMapSchema.optional(),
  }),
]);

/** Boundary schema for the optional install-target list. */
const McpInstallTargetsSchema = z
  .array(z.enum(['vscode', 'claude', 'cursor', 'copilot']))
  .nonempty();

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
  source: 'official' | 'smithery' | 'pulsemcp';
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
  pulseMcpRegistry?: HarnessMcpRegistrySource;
  /**
   * Optional — when absent, installMcpServer degrades to a clear error instead
   * of crashing the namespace.
   */
  mcpInstaller?: HarnessMcpInstaller;
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
  installMcpServer(
    serverName: string,
    config: McpServerConfig,
    serverKey?: string,
    targets?: McpInstallTarget[],
  ): Promise<HarnessMcpInstallOutcome>;
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

/**
 * Derive a config-file key from a fully qualified registry server name.
 * "io.github.user/server-name" -> "server-name".
 */
function deriveServerKey(serverName: string): string {
  const lastSegment = serverName.split('/').pop() ?? serverName;
  return sanitizeName(lastSegment);
}

/**
 * Build the harness namespace with 6 MCP-accessible methods.
 *
 * @param deps - Dependencies containing plugin loader, MCP registry, installer, workspace root, and logger
 * @returns HarnessNamespace with searchSkills, createSkill, searchMcpRegistry, listInstalledMcpServers, installMcpServer, proposeConfig
 */
export function buildHarnessNamespace(
  deps: HarnessNamespaceDependencies,
): HarnessNamespace {
  const {
    pluginLoader,
    mcpRegistry,
    skillsDirectory,
    smitheryRegistry,
    pulseMcpRegistry,
    mcpInstaller,
    getWorkspaceRoot,
    broadcast,
    logger,
  } = deps;

  return {
    async searchSkills(query?: string): Promise<HarnessSkillResult[]> {
      // resolveCurrentPluginPaths() already unions the enabled bundled plugins
      // with every harness-authored ptah-harness-* directory, so no ad-hoc
      // merge is needed here.
      const pluginPaths = pluginLoader.resolveCurrentPluginPaths();
      const allSkills = pluginLoader.discoverSkillsForPlugins(pluginPaths);
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

      let pulseMcpServers: HarnessMcpServerResult[] = [];
      if (pulseMcpRegistry) {
        try {
          const pulse = await pulseMcpRegistry.listServers({
            query,
            limit: effectiveLimit,
          });
          pulseMcpServers = pulse.servers.map((server) => ({
            name: server.name,
            description: server.description,
            source: 'pulsemcp',
          }));
        } catch (error: unknown) {
          logger.warn(
            `[Harness] PulseMCP registry search failed, returning other results only: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return {
        servers: [...officialServers, ...smitheryServers, ...pulseMcpServers],
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

    async installMcpServer(
      serverName: string,
      config: McpServerConfig,
      serverKey?: string,
      targets?: McpInstallTarget[],
    ): Promise<HarnessMcpInstallOutcome> {
      if (!mcpInstaller) {
        throw new Error(
          'MCP installation is unavailable: no MCP installer is wired into the harness namespace on this host. ' +
            'Record the server on the harness config via proposeConfig instead — it is installed when the harness is applied.',
        );
      }

      const trimmedName = serverName?.trim() ?? '';
      if (trimmedName.length === 0) {
        throw new Error(
          'Invalid serverName: expected a non-empty registry server name (e.g. "io.github.owner/server").',
        );
      }

      const parsedConfig = McpServerConfigSchema.safeParse(config);
      if (!parsedConfig.success) {
        const issues = parsedConfig.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new Error(
          `Invalid config: ${issues}. Expected {type:"stdio",command,args?,env?} or {type:"http"|"sse",url,headers?,env?}.`,
        );
      }

      const resolvedKey =
        serverKey && serverKey.trim().length > 0
          ? sanitizeName(serverKey)
          : deriveServerKey(trimmedName);
      if (resolvedKey.length === 0 || resolvedKey === 'unnamed') {
        throw new Error(
          `Invalid serverKey: "${serverKey ?? trimmedName}" sanitizes to an empty key. Pass an explicit serverKey.`,
        );
      }

      // Copied — HARNESS_DEFAULT_MCP_TARGETS is a shared mutable array and this
      // list is handed back to the caller in the outcome.
      let resolvedTargets: McpInstallTarget[] = [
        ...HARNESS_DEFAULT_MCP_TARGETS,
      ];
      if (targets !== undefined) {
        const parsedTargets = McpInstallTargetsSchema.safeParse(targets);
        if (!parsedTargets.success) {
          throw new Error(
            'Invalid targets: expected a non-empty array of "vscode" | "claude" | "cursor" | "copilot".',
          );
        }
        resolvedTargets = [...parsedTargets.data];
      }

      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error(
          'No workspace folder is open. Workspace-scoped MCP configs cannot be written — open a folder and retry.',
        );
      }

      const results = await mcpInstaller.install(
        trimmedName,
        resolvedKey,
        parsedConfig.data,
        resolvedTargets,
        workspaceRoot,
      );

      const installedPaths: string[] = [];
      const warnings: string[] = [];
      for (const result of results) {
        if (result.success) {
          installedPaths.push(result.configPath);
        } else {
          warnings.push(
            `Failed to install "${trimmedName}" to ${result.target}: ${result.error ?? 'unknown error'}`,
          );
        }
      }

      logger.info(
        `[Harness] installMcpServer "${trimmedName}" as "${resolvedKey}" -> ${resolvedTargets.join(', ')} ` +
          `(${installedPaths.length} written, ${warnings.length} failed)`,
      );

      return {
        serverName: trimmedName,
        serverKey: resolvedKey,
        targets: resolvedTargets,
        installedPaths: Array.from(new Set(installedPaths)),
        results,
        warnings,
      };
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
