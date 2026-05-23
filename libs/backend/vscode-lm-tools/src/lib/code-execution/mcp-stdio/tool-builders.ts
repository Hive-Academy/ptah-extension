/**
 * MCP-wire tool definitions for the stdio surface.
 *
 * Per TASK_2026_128 Architecture Validation, the stdio MCP surface drops the
 * `ptah_` prefix that the internal HTTP server uses. External MCP hosts
 * namespace tools by server name (e.g. `ptah:agent_spawn`), so the prefix
 * would be redundant on the wire.
 *
 * Phase 2 ships 7 MVP tool definitions (schemas only — `tools/call` dispatch
 * lands in Phase 3). Each builder rewrites the canonical
 * `tool-description.builder.ts` definition with a clean MCP-native name; the
 * input schema is preserved so external hosts see the same contract the
 * internal subagents already consume over HTTP.
 *
 * The seventh tool, `session_submit`, is unique to the stdio surface — it
 * fires the full Team Leader harness in Phase 3. Phase 2 returns a stable
 * schema definition so external hosts can see it advertised on `tools/list`
 * before dispatch logic ships.
 */

import {
  buildAgentSpawnTool,
  buildAgentStatusTool,
  buildAgentReadTool,
  buildAgentSteerTool,
  buildAgentStopTool,
  buildAgentListTool,
} from '../mcp-core/tool-description.builder';
import type { MCPToolDefinition } from '../mcp-core/types/mcp-protocol.types';

/** MCP-wire tool names as advertised on `tools/list`. */
export const MCP_MVP_TOOL_NAMES = [
  'agent_spawn',
  'agent_status',
  'agent_read',
  'agent_steer',
  'agent_stop',
  'agent_list',
  'session_submit',
] as const;

export type McpMvpToolName = (typeof MCP_MVP_TOOL_NAMES)[number];

function rename(
  def: MCPToolDefinition,
  name: McpMvpToolName,
): MCPToolDefinition {
  return { ...def, name };
}

export function buildMcpAgentSpawnTool(): MCPToolDefinition {
  return rename(buildAgentSpawnTool(), 'agent_spawn');
}

export function buildMcpAgentStatusTool(): MCPToolDefinition {
  return rename(buildAgentStatusTool(), 'agent_status');
}

export function buildMcpAgentReadTool(): MCPToolDefinition {
  return rename(buildAgentReadTool(), 'agent_read');
}

export function buildMcpAgentSteerTool(): MCPToolDefinition {
  return rename(buildAgentSteerTool(), 'agent_steer');
}

export function buildMcpAgentStopTool(): MCPToolDefinition {
  return rename(buildAgentStopTool(), 'agent_stop');
}

export function buildMcpAgentListTool(): MCPToolDefinition {
  return rename(buildAgentListTool(), 'agent_list');
}

/**
 * Placeholder builder for the composite `session_submit` tool. Full dispatch
 * (Team Leader prompt synthesis, progress streaming, abort handling) lands in
 * Phase 3; the definition is advertised in Phase 2 so external hosts can
 * discover the tool and ship `.mcp.json` configurations against a stable
 * schema.
 */
export function buildMcpSessionSubmitTool(): MCPToolDefinition {
  return {
    name: 'session_submit',
    description:
      'Delegate an entire task to Ptah. Builds a Team Leader prompt from ' +
      'the supplied task text, runs it through the configured agent SDK ' +
      'session, and aggregates the result. Mid-flight progress streams as ' +
      'MCP `notifications/progress` / `notifications/message` frames. ' +
      'Phase 2 advertises this tool only; full dispatch ships in Phase 3.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Free-form task description. May be a single sentence or a ' +
            'multi-paragraph specification.',
        },
        cwd: {
          type: 'string',
          description:
            'Absolute working directory. Defaults to the cwd `mcp-serve` ' +
            'was launched with.',
        },
        allowSubagents: {
          type: 'boolean',
          description:
            'When true (default), the Team Leader is instructed to fan ' +
            'out subtasks via the agent SDK Task tool. When false, the ' +
            'task runs in a single session.',
        },
        profile: {
          type: 'string',
          enum: ['claude_code', 'enhanced'],
          description:
            'Optional preset profile forwarded to the agent SDK session.',
        },
      },
      required: ['task'],
    },
  };
}

/**
 * Build the full 7-tool MVP list advertised by `tools/list`. Order is
 * deterministic so external hosts that fingerprint the catalog see stable
 * output across `mcp-serve` boots.
 */
export function buildMcpMvpTools(): readonly MCPToolDefinition[] {
  return [
    buildMcpAgentSpawnTool(),
    buildMcpAgentStatusTool(),
    buildMcpAgentReadTool(),
    buildMcpAgentSteerTool(),
    buildMcpAgentStopTool(),
    buildMcpAgentListTool(),
    buildMcpSessionSubmitTool(),
  ];
}
