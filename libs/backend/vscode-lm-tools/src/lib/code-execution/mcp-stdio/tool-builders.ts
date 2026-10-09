/**
 * MCP-wire tool definitions for the stdio surface.
 *
 * Per TASK_2026_128 Architecture Validation, the stdio MCP surface drops the
 * `ptah_` prefix that the internal HTTP server uses. External MCP hosts
 * namespace tools by server name (e.g. `ptah:agent_spawn`), so the prefix
 * would be redundant on the wire.
 *
 * Phase 2 ships the MVP tool definitions (schemas only — `tools/call` dispatch
 * lands in Phase 3). Each builder rewrites the canonical
 * `tool-description.builder.ts` definition with a clean MCP-native name; the
 * input schema is preserved so external hosts see the same contract the
 * internal subagents already consume over HTTP.
 *
 * The last tool, `session_submit`, is unique to the stdio surface — it
 * fires the full Team Leader harness in Phase 3. Phase 2 returns a stable
 * schema definition so external hosts can see it advertised on `tools/list`
 * before dispatch logic ships.
 */

import {
  buildAgentSpawnTool,
  buildAgentStatusTool,
  buildAgentReadTool,
  buildAgentMessageTool,
  buildAgentReportTool,
  buildAgentStopTool,
  buildAgentListTool,
} from '../mcp-core/tool-description.builder';
import { buildAgentWaitTool } from '../mcp-core/agent-wait.tool';
import { buildRunCheckTool } from '../mcp-core/run-check.tool';
import { getToolResultBudget } from '../mcp-core/tool-result-budget';
import type { MCPToolDefinition } from '../mcp-core/types/mcp-protocol.types';

/** The `_meta` key a tool's result ceiling is declared under (as on HTTP). */
const MAX_RESULT_SIZE_META = 'anthropic/maxResultSizeChars';

/**
 * Largest `session_submit` result text, in chars: the aggregate text cap its
 * handler keeps (`AGGREGATE_BUFFER_CAP`, 1024 * 1024, in
 * `apps/ptah-cli/src/services/mcp/session-submit.service.ts`, measured as
 * string length). The handler lives in the app, which this lib must not
 * import, so the value is restated here; the tool is not held to the agent
 * tools' budget and must not declare it.
 */
const SESSION_SUBMIT_MAX_RESULT_CHARS = 1024 * 1024;

/**
 * The name a stdio agent tool's budget is kept under: its HTTP counterpart's
 * (`agent_spawn` → `ptah_agent_spawn`), so both surfaces declare and enforce
 * the same `getToolResultBudget` entry.
 */
export function agentToolBudgetName(tool: string): string {
  return `ptah_${tool}`;
}

/** MCP-wire tool names as advertised on `tools/list`. */
export const MCP_MVP_TOOL_NAMES = [
  'agent_spawn',
  'agent_status',
  'agent_read',
  'agent_message',
  'agent_report',
  'agent_stop',
  'agent_list',
  'agent_wait',
  'run_check',
  'session_submit',
] as const;

export type McpMvpToolName = (typeof MCP_MVP_TOOL_NAMES)[number];

/**
 * The canonical definition under its MCP-wire name, declaring the result
 * ceiling the stdio dispatcher holds this tool's text to.
 */
function rename(
  def: MCPToolDefinition,
  name: McpMvpToolName,
): MCPToolDefinition {
  return {
    ...def,
    name,
    _meta: {
      ...def._meta,
      [MAX_RESULT_SIZE_META]: getToolResultBudget(agentToolBudgetName(name))
        .chars,
    },
  };
}

export function buildMcpAgentSpawnTool(): MCPToolDefinition {
  return rename(buildAgentSpawnTool({ transport: 'stdio' }), 'agent_spawn');
}

export function buildMcpAgentStatusTool(): MCPToolDefinition {
  return rename(buildAgentStatusTool(), 'agent_status');
}

export function buildMcpAgentReadTool(): MCPToolDefinition {
  return rename(buildAgentReadTool(), 'agent_read');
}

export function buildMcpAgentMessageTool(): MCPToolDefinition {
  return rename(buildAgentMessageTool(), 'agent_message');
}

export function buildMcpAgentReportTool(): MCPToolDefinition {
  return rename(buildAgentReportTool(), 'agent_report');
}

export function buildMcpAgentStopTool(): MCPToolDefinition {
  return rename(buildAgentStopTool(), 'agent_stop');
}

export function buildMcpAgentListTool(): MCPToolDefinition {
  return rename(buildAgentListTool(), 'agent_list');
}

export function buildMcpAgentWaitTool(): MCPToolDefinition {
  return rename(buildAgentWaitTool({ transport: 'stdio' }), 'agent_wait');
}

export function buildMcpRunCheckTool(): MCPToolDefinition {
  return rename(buildRunCheckTool(), 'run_check');
}

/**
 * Builder for the composite `session_submit` tool. Wraps the Team Leader
 * harness as a single MCP tool: the supplied task is decomposed into a
 * Team Leader prompt, executed through the configured agent SDK session,
 * and aggregated into a single MCP result. Sub-agent fan-out happens via
 * the agent SDK's Task tool when `allowSubagents` is true; cost + token
 * deltas stream as `notifications/message` frames during execution.
 */
export function buildMcpSessionSubmitTool(): MCPToolDefinition {
  return {
    name: 'session_submit',
    description:
      "Delegate an entire coding task to Ptah's Team Leader. Builds a Team " +
      'Leader prompt from the supplied task text, runs it through the ' +
      'configured agent SDK session, and aggregates the result. When ' +
      'allowSubagents is true (default), the Team Leader fans out work to ' +
      'sub-agents via the SDK Task tool and aggregates their results ' +
      'before reporting back. Mid-flight progress streams as MCP ' +
      '`notifications/progress` (when the host supplies a progressToken) ' +
      'and `notifications/message` frames covering agent.thought, ' +
      'agent.tool_use, agent.tool_result, text_delta, session.cost, and ' +
      'a final mcp.session.summary. Use for high-level delegation; use ' +
      'agent_spawn for direct CLI agent invocations.',
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
    _meta: { [MAX_RESULT_SIZE_META]: SESSION_SUBMIT_MAX_RESULT_CHARS },
  };
}

/**
 * Build the full 10-tool MVP list advertised by `tools/list`. Order is
 * deterministic so external hosts that fingerprint the catalog see stable
 * output across `mcp-serve` boots.
 */
export function buildMcpMvpTools(): readonly MCPToolDefinition[] {
  return [
    buildMcpAgentSpawnTool(),
    buildMcpAgentStatusTool(),
    buildMcpAgentReadTool(),
    buildMcpAgentMessageTool(),
    buildMcpAgentReportTool(),
    buildMcpAgentStopTool(),
    buildMcpAgentListTool(),
    buildMcpAgentWaitTool(),
    buildMcpRunCheckTool(),
    buildMcpSessionSubmitTool(),
  ];
}
