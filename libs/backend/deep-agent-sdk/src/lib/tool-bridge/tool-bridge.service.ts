/**
 * ToolBridgeService — Bridges external tools into LangChain format
 * for consumption by deepagents.
 *
 * Two tool sources:
 * 1. IToolRegistry (programmatic) — set via setToolRegistry()
 * 2. Ptah MCP HTTP server — connected via loadMcpTools() at session start
 *
 * Uses LangChain's `tool()` helper with JSON Schema directly.
 */

import { injectable, inject } from 'tsyringe';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { IToolRegistry, ToolDef } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';

export type BridgedTool = StructuredToolInterface;

interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

@injectable()
export class ToolBridgeService {
  private toolRegistry: IToolRegistry | null = null;
  private mcpTools: BridgedTool[] = [];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  setToolRegistry(registry: IToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * Load tools from the Ptah MCP HTTP server.
   * Fetches the tool list via MCP's tools/list endpoint and wraps each
   * tool in a LangChain StructuredTool that delegates calls back to
   * the MCP server via tools/call.
   */
  async loadMcpTools(mcpBaseUrl: string): Promise<void> {
    try {
      const response = await fetch(mcpBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });

      if (!response.ok) {
        this.logger.warn(
          `[DeepAgent.ToolBridge] MCP tools/list failed: ${response.status}`,
        );
        return;
      }

      const result = (await response.json()) as {
        result?: { tools?: McpToolSchema[] };
      };
      const mcpToolDefs = result?.result?.tools ?? [];

      if (mcpToolDefs.length === 0) {
        this.logger.info('[DeepAgent.ToolBridge] MCP server returned no tools');
        return;
      }

      this.mcpTools = mcpToolDefs
        .map((def) => this.bridgeMcpTool(def, mcpBaseUrl))
        .filter((t): t is BridgedTool => t !== null);

      this.logger.info(
        `[DeepAgent.ToolBridge] Loaded ${this.mcpTools.length} MCP tools from ${mcpBaseUrl}`,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.sentryService.captureException(error, {
        errorSource: 'ToolBridgeService.loadMcpTools',
      });
      this.logger.warn(
        '[DeepAgent.ToolBridge] Failed to load MCP tools',
        error,
      );
    }
  }

  async getTools(): Promise<BridgedTool[]> {
    const tools: BridgedTool[] = [...this.mcpTools];

    if (this.toolRegistry) {
      const defs = this.toolRegistry.listTools();
      for (const def of defs) {
        try {
          tools.push(this.bridgeRegistryTool(def));
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.sentryService.captureException(error, {
            errorSource: 'ToolBridgeService.getTools',
          });
          this.logger.warn(
            `[DeepAgent.ToolBridge] Failed to bridge tool '${def.name}'`,
            error,
          );
        }
      }
    }

    if (tools.length === 0) {
      this.logger.info(
        '[DeepAgent.ToolBridge] No external tools — using deepagents built-in tools only',
      );
    }

    return tools;
  }

  private bridgeMcpTool(
    def: McpToolSchema,
    mcpBaseUrl: string,
  ): BridgedTool | null {
    try {
      const schema = {
        type: 'object' as const,
        properties:
          (def.inputSchema?.properties as Record<string, unknown>) ?? {},
        required: def.inputSchema?.required
          ? [...def.inputSchema.required]
          : undefined,
      };

      return tool(
        async (input: Record<string, unknown>, config?: RunnableConfig) => {
          // Return errors as string content rather than throwing. Throwing
          // inside ToolNode's Promise.all can cascade-cancel sibling tool
          // calls (e.g. `task` subagents), leaving orphaned tool_use blocks
          // that cause the provider to synthesize "cancelled — another
          // message came in" errors on the next turn.
          try {
            const response = await fetch(mcpBaseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: { name: def.name, arguments: input },
              }),
              signal: config?.signal,
            });

            if (!response.ok) {
              return `Error: MCP tool '${def.name}' returned HTTP ${response.status}`;
            }

            const result = (await response.json()) as {
              result?: { content?: Array<{ text?: string }> };
              error?: { message?: string };
            };
            if (result?.error) {
              return `Error: ${result.error.message ?? 'MCP tool failed'}`;
            }
            const content = result?.result?.content ?? [];
            return content.map((c) => c.text ?? '').join('\n') || 'OK';
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return `Error: MCP tool '${def.name}' failed — ${message}`;
          }
        },
        {
          name: def.name,
          description: def.description ?? def.name,
          schema,
        },
      ) as unknown as BridgedTool;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.sentryService.captureException(error, {
        errorSource: 'ToolBridgeService.bridgeMcpTool',
      });
      this.logger.warn(
        `[DeepAgent.ToolBridge] Failed to bridge MCP tool '${def.name}'`,
        error,
      );
      return null;
    }
  }

  private bridgeRegistryTool(def: ToolDef): BridgedTool {
    const schema = {
      type: 'object' as const,
      properties: def.inputSchema.properties
        ? { ...(def.inputSchema.properties as Record<string, unknown>) }
        : {},
      required: def.inputSchema.required
        ? [...def.inputSchema.required]
        : undefined,
    };

    return tool(
      async (input: Record<string, unknown>) => {
        // See bridgeMcpTool: errors must return as string content, never
        // throw, so sibling tool_calls in a parallel ToolNode batch are
        // not cascade-cancelled.
        try {
          const result = await def.execute(input);
          return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error: tool '${def.name}' failed — ${message}`;
        }
      },
      {
        name: def.name,
        description: def.description,
        schema,
      },
    ) as unknown as BridgedTool;
  }
}
