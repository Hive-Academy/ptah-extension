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
 *      payload. Success text goes through the tool-result budget first —
 *      the same step, with the same per-tool budget, as the HTTP surface —
 *      and `structuredContent` is held to that budget too.
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
import type { IOutputChannel } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  MCPRequest,
  MCPResponse,
} from '../mcp-core/types/mcp-protocol.types';
import type { PtahAPI } from '../types';
import {
  formatAgentSpawn,
  formatAgentStatus,
  formatAgentMessage,
  formatAgentReport,
  formatAgentStop,
  formatAgentList,
} from '../mcp-core/mcp-response-formatter';
import { renderAgentRead } from '../mcp-core/agent-read.view';
import {
  AGENT_STATUS_REPEAT_WINDOW_MS,
  checkRepeatAgentStatus,
} from '../mcp-core/agent-status-throttle';
import {
  applyToolResultBudget,
  getToolResultBudget,
  spoolToolText,
} from '../mcp-core/tool-result-budget';
import { MAX_AGENT_MESSAGE_LENGTH } from '../mcp-core/tool-description.builder';
import {
  boundStructuredContent,
  structuredContentFits,
} from './bounded-structured-content';
import { agentToolBudgetName } from './tool-builders';
import { AgentSpawnArgsSchema } from '../mcp-core/agent-spawn-args.schema';
import {
  AgentMessageError,
  AgentRoleError,
  CliCommandLineTooLongError,
  MAX_AGENT_REPORT_LENGTH,
} from '@ptah-extension/cli-agent-runtime';

const AgentStatusSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .strict();

const AgentReadSchema = z
  .object({
    agentId: z.string().min(1),
    tail: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
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

/** Budget-step diagnostics go to the dispatcher's logger at warn. */
function budgetOutputChannel(logger: Logger): IOutputChannel {
  const write = (line: string): void => {
    logger.warn(line);
  };
  return {
    name: 'McpStdio',
    appendLine: write,
    append: write,
    clear: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
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
    /** Clock (epoch ms) of the `agent_status` repeat throttle. */
    private readonly now: () => number = () => Date.now(),
    /**
     * Root of the result spool (`<root>/.ptah/tmp/mcp-out`): the full text of
     * an over-budget result and `agent_read`'s saved line ranges. The host
     * process's working directory: set by whoever launched `mcp-serve`, not
     * by the calling model — the stdio counterpart of the HTTP surface's
     * host-owned workspace folder.
     */
    private readonly spoolRoot: () => string = () => process.cwd(),
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

  /**
   * A success result held to the tool's declared budget. The text goes
   * through the step the HTTP surface applies to every success
   * (`protocol-dispatcher.ts` `createToolSuccessResponse`): within the
   * budget it is returned byte-for-byte and nothing is spooled; over it the
   * text is cut to a prefix (the agent tools are hinted `preformatted`), the
   * raw text is spooled under {@link spoolRoot}, and a trailer names the
   * reducer and the spool file.
   *
   * `structuredContent` is held to the same budget, because a host may show
   * it to the model instead of the text: a value whose JSON fits is returned
   * unchanged; a larger one is saved whole as JSON and replaced by a bounded
   * object ({@link boundStructuredContent}). Error results are not budgeted,
   * as on the HTTP surface.
   */
  private async toolSuccess(
    request: MCPRequest,
    tool: string,
    text: string,
    structuredContent?: Record<string, unknown>,
  ): Promise<MCPResponse> {
    const toolName = agentToolBudgetName(tool);
    const budgeted = await applyToolResultBudget({
      text,
      toolName,
      requestId: request.id,
      spoolRoot: this.spoolRoot(),
      output: budgetOutputChannel(this.logger),
    });
    const structured =
      structuredContent === undefined
        ? undefined
        : await this.budgetStructured(
            request,
            toolName,
            structuredContent,
            budgeted.spoolPath,
          );
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [{ type: 'text', text: budgeted.text }],
        ...(structured !== undefined ? { structuredContent: structured } : {}),
      },
    };
  }

  /** `value` when its JSON fits the tool's budget; else the bounded object. */
  private async budgetStructured(
    request: MCPRequest,
    toolName: string,
    value: Record<string, unknown>,
    textSpoolPath: string | undefined,
  ): Promise<Record<string, unknown>> {
    const budget = getToolResultBudget(toolName);
    if (structuredContentFits(value, budget)) {
      return value;
    }
    const spoolRoot = this.spoolRoot();
    const saved = await spoolToolText(
      JSON.stringify(value),
      spoolRoot,
      request.id,
    );
    return boundStructuredContent(value, budget, {
      structured: saved,
      spoolRoot,
      ...(textSpoolPath !== undefined ? { textSpoolPath } : {}),
    });
  }

  private async handleSpawn(
    request: MCPRequest,
    args: unknown,
  ): Promise<MCPResponse> {
    const parsed = parseArgs(AgentSpawnArgsSchema, args);
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
      role: p.role,
      effort: p.effort,
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
        deliverables: p.deliverables,
        model: p.model,
        modelTier: p.modelTier,
        resumeSessionId: p.resume_session_id,
        parentSessionId: this.callerSessionId,
        role: p.role,
        effort: p.effort,
      });
      return await this.toolSuccess(
        request,
        'agent_spawn',
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
          ...(result.role ? { role: result.role } : {}),
          ...(result.roleDelivery ? { roleDelivery: result.roleDelivery } : {}),
          ...(result.roleChannel ? { roleChannel: result.roleChannel } : {}),
        },
      );
    } catch (err: unknown) {
      this.logger.error('[McpStdio] agent_spawn failed', {
        error: errorMessage(err),
      });
      if (err instanceof AgentRoleError) {
        return toolError(
          request,
          `agent_spawn role ${err.code}: ${err.message}`,
          'mcp_tool_failed',
          {
            tool: 'agent_spawn',
            state: err.code,
            availableRoles: err.availableRoles,
          },
        );
      }
      if (err instanceof CliCommandLineTooLongError) {
        return toolError(
          request,
          `agent_spawn command line too long (${err.measured} against a limit of ${err.limit}): ${err.message}`,
          'mcp_tool_failed',
          {
            tool: 'agent_spawn',
            state: 'command_line_too_long',
            measured: err.measured,
            limit: err.limit,
          },
        );
      }
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
      const now = this.now();
      const unchanged = checkRepeatAgentStatus(
        this.ptahAPI,
        { agentId: this.callerAgentId, sessionId: this.callerSessionId },
        parsed.data.agentId,
        result,
        now,
      );
      if (unchanged !== null) {
        // A stdio host does not receive `<agent-lane-completed>`; it is told
        // when a repeat call returns the full status again.
        const fullAgain = new Date(
          Date.parse(unchanged.since) + AGENT_STATUS_REPEAT_WINDOW_MS,
        ).toISOString();
        return await this.toolSuccess(
          request,
          'agent_status',
          `Status unchanged since ${unchanged.since} (${unchanged.status}). ` +
            `Repeat calls return this line until ${fullAgain}; a status ` +
            'change is reported at once.',
          {
            agentId: unchanged.agentId,
            status: unchanged.status,
            unchangedSince: unchanged.since,
          },
        );
      }
      return await this.toolSuccess(
        request,
        'agent_status',
        formatAgentStatus(result),
        { agents: Array.isArray(result) ? result : [result] },
      );
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
        parsed.data.offset,
      );
      // The same budgeted window the HTTP surface returns. It already fits
      // the budget, so the budget step below returns it unchanged.
      const view = await renderAgentRead(
        result,
        parsed.data.offset,
        getToolResultBudget('ptah_agent_read'),
        (text) => spoolToolText(text, this.spoolRoot(), request.id),
      );
      return await this.toolSuccess(request, 'agent_read', view.text, {
        agentId: result.agentId,
        lineCount: view.shownLines,
        totalLines: result.totalLines,
        omittedLines: result.totalLines - view.shownLines,
        stdout: view.stdout,
        stderr: view.stderr,
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
      return await this.toolSuccess(
        request,
        'agent_message',
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
      return this.toolSuccess(
        request,
        'agent_report',
        formatAgentReport(refusal),
        refusal,
      );
    }
    try {
      const delivery = await this.ptahAPI.agent.report({
        agentId: callerAgentId,
        message: parsed.data.message,
        summary: parsed.data.summary,
      });
      return await this.toolSuccess(
        request,
        'agent_report',
        formatAgentReport(delivery),
        {
          delivered: delivery.delivered,
          ...(delivery.reason !== undefined ? { reason: delivery.reason } : {}),
          ...(delivery.parentSessionId !== undefined
            ? { parentSessionId: delivery.parentSessionId }
            : {}),
        },
      );
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
      return await this.toolSuccess(
        request,
        'agent_stop',
        formatAgentStop(result),
        {
          agentId: result.agentId,
          cli: result.cli,
          status: result.status,
          ...(result.exitCode !== undefined
            ? { exitCode: result.exitCode }
            : {}),
        },
      );
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
      const roles = await this.listRolesOrEmpty();
      return await this.toolSuccess(
        request,
        'agent_list',
        formatAgentList(agents, roles),
        { agents, total: agents.length, roles },
      );
    } catch (err) {
      return toolError(
        request,
        `agent_list failed: ${errorMessage(err)}`,
        'mcp_tool_failed',
        { tool: 'agent_list' },
      );
    }
  }

  private async listRolesOrEmpty(): Promise<string[]> {
    try {
      return await this.ptahAPI.agent.listRoles();
    } catch (err: unknown) {
      // degradation-audit: optional-capability - the role roster is an
      // enrichment on top of the agent list, which still rejects the whole
      // call on failure; an unreadable roster logs a warning and lists no roles.
      this.logger.warn('[McpStdio] agent_list could not list roles', {
        error: errorMessage(err),
      });
      return [];
    }
  }
}
