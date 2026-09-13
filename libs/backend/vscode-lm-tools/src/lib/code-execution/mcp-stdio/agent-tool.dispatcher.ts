/**
 * Agent tool dispatcher — Phase 3 of TASK_2026_128.
 *
 * Routes the seven 1:1 wrapper MCP tools (`agent_spawn`, `agent_status`,
 * `agent_read`, `agent_message`, `agent_report`, `agent_stop`, `agent_list`)
 * to the underlying
 * `PtahAPI.agent` namespace. Each route:
 *
 *   1. Parses the inbound `tools/call` arguments through a Zod schema.
 *   2. Delegates to the corresponding `PtahAPI.agent.*` method.
 *   3. Returns an MCP-compliant `{ content, isError?, structuredContent }`
 *      payload.
 *
 * On schema-validation failure, returns an MCP `result.isError: true` envelope
 * with `structuredContent.ptah_code = 'mcp_invalid_tool_args'` and the
 * `zod.flatten()` issues — keeps tool-level errors inside the MCP result shape
 * (per spec) rather than as JSON-RPC errors, which is the same convention the
 * HTTP server uses (`mcp-core/protocol-dispatcher.ts:1190-1201`).
 *
 * On underlying-call failure, returns the same envelope with the original
 * error message preserved so external hosts can surface it.
 *
 * Hexagonal: this file lives in the lib, depends only on the lib's own
 * `PtahAPI` + the shared types. It does NOT reach into `apps/ptah-cli/` —
 * `session_submit` lives in a sibling file that takes a CLI-supplied port.
 */

import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import type {
  MCPRequest,
  MCPResponse,
} from '../mcp-core/types/mcp-protocol.types';
import type { PtahAPI } from '../types';
import {
  formatAgentSpawn,
  formatAgentStatus,
  formatAgentRead,
  formatAgentMessage,
  formatAgentReport,
  formatAgentStop,
  formatAgentList,
} from '../mcp-core/mcp-response-formatter';
import { MAX_AGENT_MESSAGE_LENGTH } from '../mcp-core/tool-description.builder';
import {
  AgentMessageError,
  MAX_AGENT_REPORT_LENGTH,
} from '@ptah-extension/cli-agent-runtime';

const MAX_TASK_LENGTH = 100 * 1024;

const AgentSpawnSchema = z
  .object({
    task: z.string().min(1).max(MAX_TASK_LENGTH),
    cli: z.enum(SYSTEM_CLI_TYPES).optional(),
    ptahCliId: z.string().min(1).optional(),
    workingDirectory: z.string().optional(),
    // Inactivity window, not a wall clock: the watchdog is re-armed by every
    // output flush. `0` disables it. No upper bound — the old 1-hour ceiling
    // rejected the spawn a long-running job needed.
    timeout: z.number().int().nonnegative().optional(),
    files: z.array(z.string()).optional(),
    taskFolder: z.string().optional(),
    model: z.string().optional(),
    modelTier: z.enum(['opus', 'sonnet', 'haiku']).optional(),
    resume_session_id: z.string().optional(),
  })
  .strict();

const AgentStatusSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .strict();

const AgentReadSchema = z
  .object({
    agentId: z.string().min(1),
    tail: z.number().int().positive().optional(),
  })
  .strict();

/**
 * `agent_message` arguments. The SAME shape the HTTP surface validates — a
 * body accepted on one surface must be accepted on the other.
 *
 * `strict()` because the retired `agent_steer` took an `instruction` key: a
 * model working from stale guidance is told what changed instead of having its
 * message silently dropped.
 */
const AgentMessageSchema = z
  .object({
    agentId: z.string().min(1),
    message: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
  })
  .strict();

/**
 * `agent_report` arguments. Deliberately NO `agentId` — the reporting agent is
 * identified by the transport, and `strict()` makes an attempt to supply one a
 * visible rejection rather than a silent self-report.
 */
const AgentReportSchema = z
  .object({
    message: z.string().min(1).max(MAX_AGENT_REPORT_LENGTH),
    summary: z.string().min(1).max(200).optional(),
  })
  .strict();

const AgentStopSchema = z.object({ agentId: z.string().min(1) }).strict();

const AgentListSchema = z.object({}).strict();

/**
 * MCP-compliant tool-level error response.
 *
 * Per MCP spec, tool execution failures (invalid args, underlying-call errors)
 * stay inside the JSON-RPC `result` field with `isError: true`. JSON-RPC
 * `error` is reserved for protocol-level failures (`Method not found`,
 * malformed request).
 */
function toolError(
  request: MCPRequest,
  text: string,
  ptahCode: string,
  extra: Record<string, unknown> = {},
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [{ type: 'text', text }],
      isError: true,
      structuredContent: { ptah_code: ptahCode, ...extra },
    },
  };
}

function toolSuccess(
  request: MCPRequest,
  text: string,
  structuredContent?: Record<string, unknown>,
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [{ type: 'text', text }],
      ...(structuredContent !== undefined ? { structuredContent } : {}),
    },
  };
}

function parseArgs<T>(
  schema: z.ZodType<T>,
  args: unknown,
):
  | { ok: true; data: T }
  | { ok: false; issues: ReturnType<z.ZodError['flatten']> } {
  const candidate = args !== null && typeof args === 'object' ? args : {};
  const result = schema.safeParse(candidate);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, issues: result.error.flatten() };
}

function describeIssues(issues: ReturnType<z.ZodError['flatten']>): string {
  const fieldEntries = Object.entries(
    issues.fieldErrors as Record<string, string[] | undefined>,
  );
  const fields = fieldEntries
    .map(([field, errs]) => `${field}: ${(errs ?? []).join('; ')}`)
    .join(' | ');
  const top = (issues.formErrors as string[]).join('; ');
  if (fields.length > 0 && top.length > 0) return `${top} | ${fields}`;
  if (fields.length > 0) return fields;
  if (top.length > 0) return top;
  return 'invalid tool arguments';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Dispatch a single MCP `tools/call` invocation for one of the six agent
 * wrapper tools. Returns `null` when the tool name is not handled by this
 * dispatcher so the caller can try other dispatchers (e.g. `session_submit`).
 */
export class AgentToolDispatcher {
  constructor(
    private readonly ptahAPI: PtahAPI,
    private readonly logger: Logger,
    private readonly callerSessionId?: string,
    /**
     * The agent this stdio server is serving, when the host that launched
     * `mcp-serve` declared one. The HTTP surface reads the equivalent off the
     * `/agent/{id}` URL segment; stdio has no URL, so the launching process
     * states it instead — same trust level as {@link callerSessionId}, and
     * equally not something the calling model can set.
     *
     * Absent is the normal case for an ordinary external host, and it makes
     * `agent_report` refuse with `unattributed-caller` rather than guess.
     */
    private readonly callerAgentId?: string,
  ) {}

  static readonly TOOL_NAMES: readonly string[] = [
    'agent_spawn',
    'agent_status',
    'agent_read',
    'agent_message',
    'agent_report',
    'agent_stop',
    'agent_list',
  ];

  handles(name: string): boolean {
    return AgentToolDispatcher.TOOL_NAMES.includes(name);
  }

  async dispatch(
    name: string,
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse | null> {
    switch (name) {
      case 'agent_spawn':
        return this.handleSpawn(request, args);
      case 'agent_status':
        return this.handleStatus(request, args);
      case 'agent_read':
        return this.handleRead(request, args);
      case 'agent_message':
        return this.handleMessage(request, args);
      case 'agent_report':
        return this.handleReport(request, args);
      case 'agent_stop':
        return this.handleStop(request, args);
      case 'agent_list':
        return this.handleList(request, args);
      default:
        return null;
    }
  }

  private async handleSpawn(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentSpawnSchema, args);
    if (!parsed.ok) {
      return toolError(
        request,
        `Invalid arguments for agent_spawn: ${describeIssues(parsed.issues)}`,
        'mcp_invalid_tool_args',
        { tool: 'agent_spawn', issues: parsed.issues },
      );
    }
    const p = parsed.data;
    this.logger.info('[McpStdio] agent_spawn invoked', {
      cli: p.cli ?? (p.ptahCliId ? 'ptah-cli' : 'auto-detect'),
      ptahCliId: p.ptahCliId,
      task: p.task.substring(0, 80) + (p.task.length > 80 ? '...' : ''),
    });
    try {
      const result = await this.ptahAPI.agent.spawn({
        task: p.task,
        cli: p.cli,
        ptahCliId: p.ptahCliId,
        workingDirectory: p.workingDirectory,
        timeout: p.timeout,
        files: p.files,
        taskFolder: p.taskFolder,
        model: p.model,
        modelTier: p.modelTier,
        resumeSessionId: p.resume_session_id,
        parentSessionId: this.callerSessionId,
      });
      return toolSuccess(
        request,
        formatAgentSpawn(result, {
          modelTier: p.ptahCliId ? (p.modelTier ?? 'sonnet') : undefined,
        }),
        {
          agentId: result.agentId,
          cli: result.cli,
          status: result.status,
          startedAt: result.startedAt,
          ...(result.cliSessionId ? { cliSessionId: result.cliSessionId } : {}),
          ...(result.ptahCliId ? { ptahCliId: result.ptahCliId } : {}),
          ...(result.ptahCliName ? { ptahCliName: result.ptahCliName } : {}),
        },
      );
    } catch (err) {
      this.logger.error('[McpStdio] agent_spawn failed', {
        error: errorMessage(err),
      });
      return toolError(
        request,
        `agent_spawn failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_spawn' },
      );
    }
  }

  private async handleStatus(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentStatusSchema, args);
    if (!parsed.ok) {
      return toolError(
        request,
        `Invalid arguments for agent_status: ${describeIssues(parsed.issues)}`,
        'mcp_invalid_tool_args',
        { tool: 'agent_status', issues: parsed.issues },
      );
    }
    try {
      const result = await this.ptahAPI.agent.status(parsed.data.agentId);
      return toolSuccess(request, formatAgentStatus(result), {
        agents: Array.isArray(result) ? result : [result],
      });
    } catch (err) {
      return toolError(
        request,
        `agent_status failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_status' },
      );
    }
  }

  private async handleRead(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentReadSchema, args);
    if (!parsed.ok) {
      return toolError(
        request,
        `Invalid arguments for agent_read: ${describeIssues(parsed.issues)}`,
        'mcp_invalid_tool_args',
        { tool: 'agent_read', issues: parsed.issues },
      );
    }
    try {
      const result = await this.ptahAPI.agent.read(
        parsed.data.agentId,
        parsed.data.tail,
      );
      return toolSuccess(request, formatAgentRead(result), {
        agentId: result.agentId,
        lineCount: result.lineCount,
        truncated: result.truncated,
      });
    } catch (err) {
      return toolError(
        request,
        `agent_read failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_read' },
      );
    }
  }

  private async handleMessage(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentMessageSchema, args);
    if (!parsed.ok) {
      return toolError(
        request,
        `Invalid arguments for agent_message: ${describeIssues(parsed.issues)}`,
        'mcp_invalid_tool_args',
        { tool: 'agent_message', issues: parsed.issues },
      );
    }
    try {
      const outcome = await this.ptahAPI.agent.message(
        parsed.data.agentId,
        parsed.data.message,
      );
      return toolSuccess(
        request,
        formatAgentMessage({ agentId: parsed.data.agentId, ...outcome }),
        {
          agentId: parsed.data.agentId,
          mode: outcome.mode,
          ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        },
      );
    } catch (err: unknown) {
      // `not_found` / `restored` / `not_running` are three different next
      // actions for the calling model, so the code travels with the message
      // instead of being flattened into one failure string.
      if (err instanceof AgentMessageError) {
        return toolError(
          request,
          `agent_message could not reach agent ${parsed.data.agentId} — ${err.code}: ${err.message}`,
          'mcp_tool_failed',
          { tool: 'agent_message', state: err.code },
        );
      }
      return toolError(
        request,
        `agent_message failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_message' },
      );
    }
  }

  private async handleReport(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentReportSchema, args);
    if (!parsed.ok) {
      return toolError(
        request,
        `Invalid arguments for agent_report: ${describeIssues(
          parsed.issues,
        )}. There is no "agentId" argument — the reporting agent is identified by the connection it calls on.`,
        'mcp_invalid_tool_args',
        { tool: 'agent_report', issues: parsed.issues },
      );
    }
    // Identity from the transport, never from the arguments. No id means the
    // report is refused, not attributed to a guess.
    const callerAgentId = this.callerAgentId;
    if (callerAgentId === undefined || callerAgentId.length === 0) {
      const refusal = {
        delivered: false,
        reason: 'unattributed-caller' as const,
      };
      return toolSuccess(request, formatAgentReport(refusal), refusal);
    }
    try {
      const delivery = await this.ptahAPI.agent.report({
        agentId: callerAgentId,
        message: parsed.data.message,
        summary: parsed.data.summary,
      });
      return toolSuccess(request, formatAgentReport(delivery), {
        delivered: delivery.delivered,
        ...(delivery.reason !== undefined ? { reason: delivery.reason } : {}),
        ...(delivery.parentSessionId !== undefined
          ? { parentSessionId: delivery.parentSessionId }
          : {}),
      });
    } catch (err: unknown) {
      return toolError(
        request,
        `agent_report failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_report' },
      );
    }
  }

  private async handleStop(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentStopSchema, args);
    if (!parsed.ok) {
      return toolError(
        request,
        `Invalid arguments for agent_stop: ${describeIssues(parsed.issues)}`,
        'mcp_invalid_tool_args',
        { tool: 'agent_stop', issues: parsed.issues },
      );
    }
    try {
      const result = await this.ptahAPI.agent.stop(parsed.data.agentId);
      return toolSuccess(request, formatAgentStop(result), {
        agentId: result.agentId,
        cli: result.cli,
        status: result.status,
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      });
    } catch (err) {
      return toolError(
        request,
        `agent_stop failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_stop' },
      );
    }
  }

  private async handleList(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentListSchema, args);
    if (!parsed.ok) {
      return toolError(
        request,
        `Invalid arguments for agent_list: ${describeIssues(parsed.issues)}`,
        'mcp_invalid_tool_args',
        { tool: 'agent_list', issues: parsed.issues },
      );
    }
    try {
      const agents = await this.ptahAPI.agent.list();
      return toolSuccess(request, formatAgentList(agents), {
        agents,
        total: agents.length,
      });
    } catch (err) {
      return toolError(
        request,
        `agent_list failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_list' },
      );
    }
  }
}
