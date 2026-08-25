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
  HARNESS_PLUGIN_ID_PREFIX,
  MESSAGE_TYPES,
  buildSkillDescriptorId,
  workspacePluginsDir,
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
  /**
   * Optional paged form. Present on `SkillsShApiClient`; declared optional so a
   * host wiring a narrower client still gets the unpaged first window rather
   * than a crash.
   */
  searchPage?(
    query: string,
    limit?: number,
    offset?: number,
  ): Promise<{
    skills: SkillShEntry[];
    offset: number;
    limit: number;
    hasMore: boolean;
    total?: number;
    limitedByUpstream: boolean;
  }>;
}

/**
 * Per-source outcome carried on every harness search result.
 *
 * This exists because of one defect class: a caught upstream failure that came
 * back as `{ skills: [], count: 0 }` is INDISTINGUISHABLE from "the marketplace
 * has nothing". An agent read that as a true negative, told the user so, and
 * authored replacements for skills that already existed. Any tool whose failure
 * mode looks like a valid answer produces that error again and again, so the
 * three states — results, genuinely empty, failed — are now spelled out.
 */
export interface HarnessSourceReport {
  /** Which catalogue this line describes. */
  source: string;
  /** `ok` answered, `unavailable` not configured on this host, `failed` threw. */
  status: 'ok' | 'unavailable' | 'failed';
  /** Rows this source contributed to the merged list. */
  count: number;
  /** Present only when `status` is `failed`. */
  error?: string;
  /** Window applied to this source, when it is paged at all. */
  offset?: number;
  limit?: number;
  /** True when this source holds further rows past the returned window. */
  hasMore?: boolean;
  /** Present ONLY when the source's full result set was seen. Never estimated. */
  total?: number;
  /** True when the source's own result ceiling was hit, so `total` is unknowable. */
  limitedByUpstream?: boolean;
}

/** Rolled-up call status: `degraded` means at least one source failed. */
export type HarnessSearchStatus = 'ok' | 'degraded';

/**
 * Where an authored skill lives, and therefore where it loads.
 *
 * - `user` — `~/.ptah/plugins`, every workspace on this machine.
 * - `workspace` — `{ws}/.ptah/plugins`, this project only, and committable
 *   alongside `.ptah/specs` so it travels with the repository.
 */
export type HarnessSkillScope = 'user' | 'workspace';

/** What `searchSkills` returns — never a bare array, see `HarnessSourceReport`. */
export interface HarnessSkillsSearchResult {
  skills: HarnessSkillResult[];
  count: number;
  status: HarnessSearchStatus;
  sources: HarnessSourceReport[];
  /**
   * The marketplace window applied. Local plugin results are NOT paged — they
   * are a complete on-disk inventory and every match is always returned — so
   * these describe the skills.sh half only.
   */
  offset: number;
  limit: number;
  /** True when the marketplace holds further rows; re-call with a bigger offset. */
  hasMore: boolean;
  /** Marketplace total, present only when the full result set was seen. */
  total?: number;
}

/** What `searchMcpRegistry` returns — same three-state contract. */
export interface HarnessMcpSearchResult {
  servers: HarnessMcpServerResult[];
  count: number;
  status: HarnessSearchStatus;
  sources: HarnessSourceReport[];
  next_cursor?: string;
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
  .array(
    z.enum(['vscode', 'claude', 'cursor', 'copilot', 'codex', 'antigravity']),
  )
  .nonempty();

/** The same list as prose, so the error message cannot drift from the schema. */
const MCP_INSTALL_TARGET_NAMES = McpInstallTargetsSchema.element.options
  .map((option) => `"${option}"`)
  .join(' | ');

/** Marketplace rows requested when the caller names no limit. */
const DEFAULT_SKILLS_LIMIT = 50;

/**
 * Largest single window. The upstream ceiling is 200 rows for a whole query, so
 * a page bigger than that could never be filled; asking for one page of
 * everything is allowed, paging past 200 is not (the API offers no way).
 */
const MAX_SKILLS_LIMIT = 200;

/** Registry rows returned when the caller names no limit. */
const DEFAULT_MCP_LIMIT = 10;

/**
 * A skill returned by searchSkills, tagged with its origin.
 */
export interface HarnessSkillResult {
  /** Existing bare directory slug; retained for selection and invocation. */
  skillId: string;
  /** Stable descriptor identity, qualified by the supplying source. */
  descriptorId: string;
  /** Native invocation name; always the bare local directory slug when known. */
  invocationName: string;
  displayName: string;
  description: string;
  /** Stable parent/source identifier. Local entries use their canonical plugin ID. */
  pluginId: string;
  /** Stable provenance identifier used to derive descriptorId. */
  sourceId: string;
  isDisabled: boolean;
  source: 'local' | 'skills.sh';
  /** Whether invocation can be verified from the result's source. */
  invocability: 'invocable' | 'not-invocable' | 'unknown';
  installSource?: string;
  installs?: number;
  /** Marketplace page for a skills.sh entry; absent for local skills. */
  url?: string;
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
      descriptorId: string;
      invocationName: string;
      displayName: string;
      description: string;
      pluginId: string;
      sourceId: string;
      invocability: 'invocable' | 'not-invocable' | 'unknown';
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
  searchSkills(
    query?: string,
    limit?: number,
    offset?: number,
  ): Promise<HarnessSkillsSearchResult>;
  createSkill(
    name: string,
    description: string,
    content: string,
    allowedTools?: string[],
    scope?: HarnessSkillScope,
  ): Promise<{
    skillId: string;
    skillPath: string;
    scope: HarnessSkillScope;
    pluginId: string;
  }>;
  searchMcpRegistry(
    query: string,
    limit?: number,
  ): Promise<HarnessMcpSearchResult>;
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
 * Round-robin the per-source lists into one window of at most `limit` rows,
 * dropping any server name already taken.
 *
 * Round-robin rather than concatenation is the point: every source gets an
 * equal share of a scarce window, so no source can starve the others however
 * many rows it returns.
 */
function interleaveUnique(
  lists: HarnessMcpServerResult[][],
  limit: number,
): HarnessMcpServerResult[] {
  const merged: HarnessMcpServerResult[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((list) => list.length));

  for (let index = 0; index < longest && merged.length < limit; index++) {
    for (const list of lists) {
      if (merged.length >= limit) break;
      const server = list[index];
      if (!server || seen.has(server.name)) continue;
      seen.add(server.name);
      merged.push(server);
    }
  }

  return merged;
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
    async searchSkills(
      query?: string,
      limit?: number,
      offset?: number,
    ): Promise<HarnessSkillsSearchResult> {
      const remoteLimit = Math.min(
        Math.max(Math.trunc(limit ?? DEFAULT_SKILLS_LIMIT), 1),
        MAX_SKILLS_LIMIT,
      );
      const remoteOffset = Math.max(Math.trunc(offset ?? 0), 0);
      // resolveCurrentPluginPaths() already unions the enabled bundled plugins
      // with every harness-authored ptah-harness-* directory, so no ad-hoc
      // merge is needed here.
      const pluginPaths = pluginLoader.resolveCurrentPluginPaths();
      const allSkills = pluginLoader.discoverSkillsForPlugins(pluginPaths);
      const disabledIds = new Set(pluginLoader.getDisabledSkillIds());

      const localResults: HarnessSkillResult[] = allSkills.map((skill) => ({
        skillId: skill.skillId,
        descriptorId: skill.descriptorId,
        invocationName: skill.invocationName,
        displayName: skill.displayName,
        description: skill.description,
        pluginId: skill.pluginId,
        sourceId: skill.sourceId,
        isDisabled: disabledIds.has(skill.skillId),
        source: 'local',
        invocability: skill.invocability,
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

      const sources: HarnessSourceReport[] = [
        { source: 'local', status: 'ok', count: filteredLocal.length },
      ];

      if (trimmedQuery.length === 0 || !skillsDirectory) {
        sources.push({
          source: 'skills.sh',
          status: 'unavailable',
          count: 0,
          error:
            trimmedQuery.length === 0
              ? 'Not consulted: a non-empty query is required to reach the marketplace.'
              : 'No skills.sh client is wired into the harness namespace on this host.',
        });
        return {
          skills: filteredLocal,
          count: filteredLocal.length,
          // A source that was never consulted is not a failure — the caller
          // asked for local skills and got every one of them.
          status: 'ok',
          sources,
          offset: remoteOffset,
          limit: remoteLimit,
          hasMore: false,
          total: 0,
        };
      }

      let remoteResults: HarnessSkillResult[] = [];
      let remoteFailure: string | null = null;
      let page: {
        skills: SkillShEntry[];
        offset: number;
        limit: number;
        hasMore: boolean;
        total?: number;
        limitedByUpstream: boolean;
      } | null = null;
      try {
        // The paged form when the wired client has one; the flat form is the
        // first window and reports no further pages, which is exactly what a
        // client that cannot page can honestly claim.
        page = skillsDirectory.searchPage
          ? await skillsDirectory.searchPage(
              trimmedQuery,
              remoteLimit,
              remoteOffset,
            )
          : {
              skills: await skillsDirectory.search(trimmedQuery, remoteLimit),
              offset: 0,
              limit: remoteLimit,
              hasMore: false,
              limitedByUpstream: false,
            };
        remoteResults = page.skills.map((entry) => ({
          skillId: entry.skillId,
          descriptorId: buildSkillDescriptorId(entry.source, entry.skillId),
          invocationName: entry.skillId,
          displayName: entry.name,
          description: entry.description,
          pluginId: entry.source,
          sourceId: entry.source,
          isDisabled: false,
          source: 'skills.sh',
          // A marketplace entry is not installed, so it cannot be invoked —
          // which is a fact, unlike the 'unknown' this used to report on every
          // single row.
          invocability: 'not-invocable',
          installSource: entry.source,
          installs: entry.installs,
          ...(entry.url ? { url: entry.url } : {}),
        }));
      } catch (error: unknown) {
        remoteFailure = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[Harness] skills.sh search failed: ${remoteFailure}. Local skills are still returned, and the result is marked degraded.`,
        );
      }

      sources.push(
        remoteFailure === null && page !== null
          ? {
              source: 'skills.sh',
              status: 'ok',
              count: remoteResults.length,
              offset: page.offset,
              limit: page.limit,
              hasMore: page.hasMore,
              ...(page.total === undefined ? {} : { total: page.total }),
              limitedByUpstream: page.limitedByUpstream,
            }
          : {
              source: 'skills.sh',
              status: 'failed',
              count: 0,
              error: remoteFailure ?? 'skills.sh search produced no page',
            },
      );

      const skills = [...filteredLocal, ...remoteResults];
      return {
        skills,
        count: skills.length,
        status: remoteFailure === null ? 'ok' : 'degraded',
        sources,
        offset: page?.offset ?? remoteOffset,
        limit: page?.limit ?? remoteLimit,
        hasMore: page?.hasMore ?? false,
        ...(page?.total === undefined ? {} : { total: page.total }),
      };
    },

    async createSkill(
      name: string,
      description: string,
      content: string,
      allowedTools?: string[],
      scope?: HarnessSkillScope,
    ) {
      const sanitizedName = sanitizeName(name);

      if (sanitizedName.length === 0 || sanitizedName === 'unnamed') {
        throw new Error(
          'Invalid skill name: must contain at least one alphanumeric character',
        );
      }

      const resolvedScope: HarnessSkillScope = scope ?? 'user';
      if (resolvedScope !== 'user' && resolvedScope !== 'workspace') {
        throw new Error(
          `Invalid scope: "${String(scope)}". Expected "user" or "workspace".`,
        );
      }

      const pluginId = `${HARNESS_PLUGIN_ID_PREFIX}${sanitizedName}`;
      const userPluginsDir = path.join(os.homedir(), '.ptah', 'plugins');
      const workspacePluginsDirPath = workspacePluginsDir(getWorkspaceRoot());

      if (resolvedScope === 'workspace' && workspacePluginsDirPath === null) {
        throw new Error(
          'Cannot create a workspace-scoped skill: no workspace folder is open. ' +
            'Open a folder, or pass scope:"user" to write it to ~/.ptah/plugins instead.',
        );
      }

      const targetPluginsDir =
        resolvedScope === 'workspace'
          ? (workspacePluginsDirPath as string)
          : userPluginsDir;

      const pluginDir = path.join(targetPluginsDir, pluginId);
      const skillDir = path.join(pluginDir, 'skills', sanitizedName);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (existsSync(skillMdPath)) {
        throw new Error(
          `Skill "${name}" already exists at ${skillMdPath}. Use a different name or delete the existing skill first.`,
        );
      }

      // A slug taken in the OTHER scope is refused rather than shadowed. Both
      // roots produce the same plugin id, and the loader resolves that clash
      // workspace-wins — so writing the second copy would silently stop the
      // first from loading, in the other direction than whoever ran this
      // expects.
      const otherPluginsDir =
        resolvedScope === 'workspace'
          ? userPluginsDir
          : workspacePluginsDirPath;
      if (otherPluginsDir !== null) {
        const clashPath = path.join(
          otherPluginsDir,
          pluginId,
          'skills',
          sanitizedName,
          'SKILL.md',
        );
        if (existsSync(clashPath)) {
          throw new Error(
            `Skill "${name}" already exists in the ${resolvedScope === 'workspace' ? 'user' : 'workspace'} scope at ${clashPath}. ` +
              'Both scopes produce the plugin id ' +
              `"${pluginId}", and the workspace copy would shadow the user-global one. ` +
              'Pick a different name, or edit the existing skill.',
          );
        }
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

      logger.info(
        `[Harness] Created ${resolvedScope}-scoped skill "${name}" at ${skillMdPath}`,
      );

      // `scope` is echoed on the result because the two write to different
      // roots and the caller cannot otherwise tell which it got — a default
      // that silently went user-global is what made an agent believe it had
      // scoped a project-specific skill to one project.
      return {
        skillId: sanitizedName,
        skillPath: skillMdPath,
        scope: resolvedScope,
        pluginId,
      };
    },

    async searchMcpRegistry(
      query: string,
      limit?: number,
    ): Promise<HarnessMcpSearchResult> {
      const effectiveLimit = Math.max(
        Math.trunc(limit ?? DEFAULT_MCP_LIMIT),
        1,
      );

      /**
       * Ask each source for a full window, then merge — `limit` describes the
       * MERGED set, which is what the parameter name promises. Concatenating
       * per-source windows instead meant a caller asking for 20 got 20 official
       * rows and never saw PulseMCP at all, so raising the limit made the
       * results worse.
       */
      const consult = async (
        source: HarnessMcpServerResult['source'],
        registry: HarnessMcpRegistrySource | undefined,
      ): Promise<{
        servers: HarnessMcpServerResult[];
        report: HarnessSourceReport;
        next_cursor?: string;
      }> => {
        if (!registry) {
          return {
            servers: [],
            report: {
              source,
              status: 'unavailable',
              count: 0,
              error: `No ${source} registry is configured on this host.`,
            },
          };
        }
        try {
          const result = await registry.listServers({
            query,
            limit: effectiveLimit,
          });
          return {
            servers: result.servers.map((server) => ({
              name: server.name,
              description: server.description,
              source,
            })),
            report: { source, status: 'ok', count: result.servers.length },
            next_cursor: result.next_cursor,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(
            `[Harness] ${source} registry search failed: ${message}. Remaining sources are still returned, and the result is marked degraded.`,
          );
          return {
            servers: [],
            report: { source, status: 'failed', count: 0, error: message },
          };
        }
      };

      // The official source used to be awaited unguarded, so a registry outage
      // took the other two down with it.
      const [official, smithery, pulse] = await Promise.all([
        consult('official', mcpRegistry),
        consult('smithery', smitheryRegistry),
        consult('pulsemcp', pulseMcpRegistry),
      ]);

      const servers = interleaveUnique(
        [official.servers, smithery.servers, pulse.servers],
        effectiveLimit,
      );

      const contributed = new Map<string, number>();
      for (const server of servers) {
        contributed.set(
          server.source,
          (contributed.get(server.source) ?? 0) + 1,
        );
      }

      const sources = [official.report, smithery.report, pulse.report].map(
        (report) =>
          report.status === 'ok'
            ? { ...report, count: contributed.get(report.source) ?? 0 }
            : report,
      );

      return {
        servers,
        count: servers.length,
        status: sources.some((report) => report.status === 'failed')
          ? 'degraded'
          : 'ok',
        sources,
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
            `Invalid targets: expected a non-empty array of ${MCP_INSTALL_TARGET_NAMES}.`,
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
