/**
 * `workspace-mcp-collector` — discovers workspace MCP servers + plugin skills
 * and projects them onto Anthropic-compatible tool definitions.
 *
 * Two RPC dependencies:
 *   - `mcpDirectory:listInstalled` → `{ servers: InstalledMcpServer[] }`
 *   - `plugins:list-skills` (optional)
 *
 * Caching: a 10-second TTL keeps repeated proxy requests from spamming the
 * RPC layer. The cache is invalidated on first failure so the proxy doesn't
 * keep serving stale tool lists past a workspace-config change. The cache
 * key is the workspace path — multiple workspaces in the same CLI host
 * (currently impossible but cheap to support) get isolated cache entries.
 *
 * The collector returns Anthropic-shaped tool definitions, NOT the raw RPC
 * responses. The proxy hands the result directly to the tool merger.
 *
 * Pure transformation — no DI in the constructor; the caller injects an RPC
 * `call` function so the collector is fully unit-testable.
 */

import type { AnthropicToolDefinition } from './anthropic-tool-merger.js';

/** Function signature matching `CliMessageTransport.call`. */
export type CollectorRpcCall = <TParams = unknown, TResult = unknown>(
  method: string,
  params: TParams,
) => Promise<{
  success: boolean;
  data?: TResult;
  error?: string;
  errorCode?: string;
}>;

/**
 * Minimal projection of `InstalledMcpServer` — only fields the collector
 * reads. Avoids importing the shared types (keeps the collector library-
 * agnostic for tests).
 */
interface InstalledMcpServerLike {
  serverKey?: string;
  config?: {
    type?: string;
    url?: string;
    command?: string;
  };
}

/** Minimal projection of `PluginSkillEntry`. */
interface PluginSkillEntryLike {
  skillId?: string;
  displayName?: string;
  description?: string;
  pluginId?: string;
}

interface CacheEntry {
  readonly tools: AnthropicToolDefinition[];
  readonly expiresAt: number;
}

/** Default TTL for cached collections (10 seconds). */
const DEFAULT_TTL_MS = 10_000;

/**
 * Collector instance — held as a singleton inside the proxy service so the
 * cache survives across requests.
 */
export class WorkspaceMcpCollector {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly rpcCall: CollectorRpcCall,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Collect Anthropic-shaped tool definitions for the given workspace.
   *
   * Returns an empty array on hard failure (RPC throws or returns
   * `success: false`) — the proxy treats workspace-tool exposure as a
   * best-effort feature and never lets it block a request.
   *
   * Workspace path is hashed into the cache key — passing the same path
   * within `ttlMs` returns the cached array.
   */
  async collect(workspacePath: string): Promise<AnthropicToolDefinition[]> {
    const cached = this.cache.get(workspacePath);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.tools;
    }

    const tools: AnthropicToolDefinition[] = [];

    // -- MCP servers ----------------------------------------------------
    try {
      const mcpResp = await this.rpcCall<
        Record<string, never>,
        { servers?: InstalledMcpServerLike[] }
      >('mcpDirectory:listInstalled', {});
      if (mcpResp.success && Array.isArray(mcpResp.data?.servers)) {
        for (const server of mcpResp.data.servers) {
          const tool = this.mcpServerToTool(server);
          if (tool !== null) tools.push(tool);
        }
      }
    } catch {
      // RPC threw — collector continues with skills-only.
      this.cache.delete(workspacePath);
    }

    // -- Plugin skills -------------------------------------------------
    try {
      const pluginsListResp = await this.rpcCall<
        Record<string, never>,
        { plugins?: Array<{ id?: string }> }
      >('plugins:list', {});
      const pluginIds: string[] = [];
      if (
        pluginsListResp.success &&
        Array.isArray(pluginsListResp.data?.plugins)
      ) {
        for (const plugin of pluginsListResp.data.plugins) {
          if (typeof plugin.id === 'string' && plugin.id.length > 0) {
            pluginIds.push(plugin.id);
          }
        }
      }

      if (pluginIds.length > 0) {
        const skillsResp = await this.rpcCall<
          { pluginIds: string[] },
          { skills?: PluginSkillEntryLike[] }
        >('plugins:list-skills', { pluginIds });
        if (skillsResp.success && Array.isArray(skillsResp.data?.skills)) {
          for (const skill of skillsResp.data.skills) {
            const tool = this.skillToTool(skill);
            if (tool !== null) tools.push(tool);
          }
        }
      }
    } catch {
      // Plugin RPCs may not be registered (e.g. minimal mode). Skip silently.
    }

    this.cache.set(workspacePath, {
      tools,
      expiresAt: this.now() + this.ttlMs,
    });
    return tools;
  }

  /** Drop all cached entries — useful for tests and after a config change. */
  invalidate(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------
  // Projection helpers
  // -------------------------------------------------------------------------

  /**
   * Transform an installed MCP server into an Anthropic tool placeholder.
   *
   * The proxy doesn't actually hand the tool's input over the wire — it's
   * surfaced to the caller's model as an opaque tool whose name encodes the
   * MCP server. The matching tool-call response is routed back through the
   * agent SDK's MCP plumbing in a follow-up phase. For the MVP we just emit
   * a discoverable name + description so the model knows the tool exists.
   */
  private mcpServerToTool(
    server: InstalledMcpServerLike,
  ): AnthropicToolDefinition | null {
    if (typeof server.serverKey !== 'string' || server.serverKey.length === 0) {
      return null;
    }
    const transport = server.config?.type ?? 'stdio';
    const target =
      transport === 'http' || transport === 'sse'
        ? server.config?.url
        : server.config?.command;
    return {
      name: `mcp__${server.serverKey}`,
      description: `MCP server "${server.serverKey}" (${transport}${
        target ? `: ${target}` : ''
      })`,
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    };
  }

  /** Transform a plugin skill into an Anthropic tool placeholder. */
  private skillToTool(
    skill: PluginSkillEntryLike,
  ): AnthropicToolDefinition | null {
    if (typeof skill.skillId !== 'string' || skill.skillId.length === 0) {
      return null;
    }
    const name = `skill__${skill.skillId}`;
    const description = skill.description ?? skill.displayName ?? skill.skillId;
    return {
      name,
      description: `Plugin skill: ${description}${
        skill.pluginId ? ` (from ${skill.pluginId})` : ''
      }`,
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    };
  }
}
