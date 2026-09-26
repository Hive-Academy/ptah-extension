/**
 * MCP Protocol Handlers
 *
 * Implements MCP JSON-RPC 2.0 protocol methods:
 * - initialize: Server capability negotiation
 * - tools/list: List available tools
 * - tools/call: Execute a tool
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
import type {
  IOutputChannel,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { McpInstallTarget, McpServerConfig } from '@ptah-extension/shared';
import {
  countTokensPiecewise,
  type CodeOutliner,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
// Value import: `AgentMessageError` is narrowed with `instanceof` below so the
// three unroutable agent states stay distinguishable to the calling model.
// `vscode-lm-tools` already depends on this barrel (`ptah-api-builder`).
import {
  AgentMessageError,
  AgentRoleError,
  CliCommandLineTooLongError,
  MAX_AGENT_REPORT_LENGTH,
} from '@ptah-extension/cli-agent-runtime';
import { AgentSpawnArgsSchema } from './agent-spawn-args.schema';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type {
  PtahAPI,
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
  ExecuteCodeParams,
  ApprovalPromptParams,
} from '../types';
import {
  buildExecuteCodeTool,
  buildApprovalPromptTool,
  buildWorkspaceAnalyzeTool,
  buildSearchFilesTool,
  buildGetDiagnosticsTool,
  buildLspReferencesTool,
  buildLspDefinitionsTool,
  buildGetDirtyFilesTool,
  buildCountTokensTool,
  buildAgentSpawnTool,
  buildAgentStatusTool,
  buildAgentReadTool,
  buildAgentMessageTool,
  buildAgentReportTool,
  MAX_AGENT_MESSAGE_LENGTH,
  buildAgentListTool,
  buildAgentStopTool,
  buildWebSearchTool,
  buildWorktreeListTool,
  buildWorktreeAddTool,
  buildWorktreeRemoveTool,
  buildJsonValidateTool,
  buildBrowserNavigateTool,
  buildBrowserScreenshotTool,
  buildBrowserEvaluateTool,
  buildBrowserClickTool,
  buildBrowserTypeTool,
  buildBrowserContentTool,
  buildBrowserNetworkTool,
  buildBrowserCloseTool,
  buildBrowserStatusTool,
  buildBrowserRecordStartTool,
  buildBrowserRecordStopTool,
  buildHarnessSearchSkillsTool,
  buildHarnessCreateSkillTool,
  buildHarnessSearchMcpRegistryTool,
  buildHarnessListInstalledMcpTool,
  buildHarnessInstallMcpTool,
  buildHarnessProposeConfigTool,
  buildAstAnalyzeTool,
  buildContextEnrichFileTool,
  buildGetDependentsTool,
  buildGetDependenciesTool,
  buildCodeSearchSymbolsTool,
  buildMemorySearchTool,
  buildRelevanceRankFilesTool,
  buildProjectDetectMonorepoTool,
  buildGetSymbolIndexTool,
  buildTaskCreateTool,
  buildTaskUpdateTool,
  buildTaskGetTool,
  buildTaskListTool,
  buildTaskCheckTool,
} from './tool-description.builder';
import {
  DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
  buildDashboardProposeSpecTool,
} from './dashboard-propose-spec.tool';
import {
  SURFACE_GET_STATE_TOOL_NAME,
  SURFACE_UPDATE_TOOL_NAME,
  buildSurfaceGetStateTool,
  buildSurfaceUpdateTool,
} from './surface-tools';
import { handleSurfaceToolCall } from './surface-tool-handlers';
import { executeCode, serializeResult } from './code-execution.engine';
import { handleApprovalPrompt } from './approval-prompt.handler';
import { buildServerInstructions } from './server-instructions';
import {
  getCallerAgentId,
  getCallerSessionId,
  getCallerWorkspaceRoot,
  runWithMcpRequestContext,
} from './mcp-request-context';
import {
  resolveMcpCaller,
  type McpCaller,
  type McpCallerKind,
} from './mcp-caller';
import {
  applyToolResultBudget,
  getToolResultBudget,
  type ToolResultBudgetOutcome,
} from './tool-result-budget';
import {
  formatWorkspaceAnalysis,
  formatSearchFiles,
  formatDiagnostics,
  formatLspReferences,
  formatLspDefinitions,
  formatDirtyFiles,
  formatTokenCount,
  formatAgentSpawn,
  formatAgentStatus,
  formatAgentRead,
  formatAgentMessage,
  formatAgentReport,
  formatAgentStop,
  formatAgentList,
  formatWebSearch,
  formatWorktreeList,
  formatWorktreeAdd,
  formatWorktreeRemove,
  formatJsonValidate,
  formatBrowserNavigate,
  formatBrowserScreenshot,
  formatBrowserEvaluate,
  formatBrowserClick,
  formatBrowserType,
  formatBrowserContent,
  formatBrowserNetwork,
  formatBrowserClose,
  formatBrowserStatus,
  formatBrowserRecordStart,
  formatBrowserRecordStop,
} from './mcp-response-formatter';

/**
 * Callback invoked when a tool execution completes (success or error).
 * Used to broadcast tool results to the frontend for live transcript display.
 */
export type ToolResultCallback = (
  toolCallId: string,
  content: string,
  isError: boolean,
) => void;

/**
 * Dependencies for protocol handlers.
 *
 * webviewManager is optional: present in VS Code for user approval prompts,
 * absent in Electron where approval_prompt auto-allows (no webview UI).
 *
 * hasIDECapabilities indicates whether the host platform supports VS Code-exclusive
 * IDE features (LSP, editor state, code actions). When false (Electron), tools that
 * depend on these capabilities are excluded from the tools/list response.
 */
export interface ProtocolHandlerDependencies {
  ptahAPI: PtahAPI;
  permissionPromptService: PermissionPromptService;
  webviewManager?: WebviewManager;
  logger: Logger;
  onToolResult?: ToolResultCallback;
  hasIDECapabilities?: boolean;
  hasSqliteLayer?: boolean;
  disabledMcpNamespaces?: string[];
  /**
   * Tree-sitter outliner the tool-result budget uses to reduce over-budget
   * source code (`TreeSitterCodeOutliner`). Absent → over-budget code falls
   * back to the log reducer and the cut.
   */
  codeOutliner?: CodeOutliner;
  /**
   * The platform (host-owned, not session-aware) workspace provider — the
   * only authority for the tool-result spool root. A caller-declared
   * workspace root is used only when it IS one of these folders; otherwise
   * the first folder, else the system temp directory.
   */
  workspaceProvider?: Pick<IWorkspaceProvider, 'getWorkspaceFolders'>;
}

/**
 * Handle MCP JSON-RPC 2.0 request
 * Routes to appropriate handler based on method
 */
export async function handleMCPRequest(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse> {
  const { logger } = deps;

  // `debug`, not `info` (TASK_2026_323). Every agent turn produces a burst of
  // MCP requests, and at `info` this single line was the highest-volume writer
  // in the log — which is precisely the log an operator has to read to find a
  // stall. The interesting MCP signal is now the slow-tool warning below.
  runObserver(() =>
    logger.debug(`MCP Request: ${request.method}`, 'CodeExecutionMCP', {
      id: request.id,
    }),
  );

  try {
    switch (request.method) {
      case 'initialize':
        return handleInitialize(request, logger);

      case 'tools/list':
        return handleToolsList(request, deps);

      case 'tools/call': {
        const caller = resolveMcpCaller(request);
        // The session and workspace fields stay the transport's raw values:
        // the workspace resolvers and the spool root already judge them (a
        // declared root that is not open is refused by name, not dropped).
        // The agent id is the resolved one, so `ptah_agent_report` reads a
        // single, normalised source.
        return await runWithMcpRequestContext(
          {
            callerSessionId: request._callerSessionId,
            callerWorkspaceRoot: request._callerWorkspaceRoot,
            callerAgentId: caller.agentId,
          },
          () => handleToolsCall(request, deps, caller.kind),
        );
      }

      default:
        return createErrorResponse(
          request.id,
          -32601,
          `Method not found: ${request.method}`,
        );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    runObserver(() =>
      logger.error(
        `MCP request failed: ${request.method}`,
        error instanceof Error ? error : new Error(String(error)),
      ),
    );

    return createErrorResponse(request.id, -32603, errorMessage, errorStack);
  }
}

/**
 * Handle initialize request
 * Required by MCP protocol - must respond with server capabilities
 */
function handleInitialize(request: MCPRequest, logger: Logger): MCPResponse {
  logger.info('MCP initialize request received', 'CodeExecutionMCP', {
    clientInfo: request.params?.['clientInfo'],
  });

  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'ptah',
        version: '1.0.0',
      },
      // One variant for every caller: the handshake is byte-stable.
      instructions: buildServerInstructions(),
    },
  };
}

/**
 * Handle tools/list request
 * Returns available tools, filtering by namespace toggles and platform capabilities.
 *
 * Always-on core tools (never disabled by namespace toggles):
 * - workspace_analyze, search_files, get_diagnostics, count_tokens,
 *   web_search, execute_code, approval_prompt
 * - ptah_task_create/update/get/list/check (TASK_2026_179, step 17). These sit
 *   in the core set on purpose and have NO entry in the namespace-toggle list
 *   below: an agent that cannot rely on the task tools being present will fall
 *   back to hand-writing task metadata, which is the exact failure that makes
 *   task folders vanish from the board. There is no `set_section` tool — the
 *   carrier is machine-owned metadata, prose is agent-owned, and a
 *   section-writer would collapse that boundary.
 *
 * Namespace-toggleable tool groups (disabled via disabledMcpNamespaces):
 * - 'ide': ptah_lsp_references, ptah_lsp_definitions, ptah_get_dirty_files
 *          (also requires hasIDECapabilities === true)
 * - 'agent': ptah_agent_spawn/status/read/message/report/stop/list
 * - 'git': ptah_git_worktree_list/add/remove
 * - 'json': ptah_json_validate
 * - 'browser': all ptah_browser_* tools (12 tools)
 * - 'harness': ptah_harness_* tools
 * - 'code': ptah_ast_analyze, ptah_context_enrich_file, ptah_get_dependents,
 *           ptah_get_dependencies, ptah_get_symbol_index, ptah_code_search_symbols,
 *           ptah_memory_search, ptah_relevance_rank_files, ptah_project_detect_monorepo
 *           (ast/context/dependencies/relevance/project work on all runtimes; code/memory
 *           return a graceful "unavailable" result where the SQLite index is absent, e.g. VS Code)
 *
 * Platform-agnostic tools (always included):
 * - ptah_get_diagnostics: Uses IDiagnosticsProvider abstraction (works on both platforms)
 */
function handleToolsList(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies,
): MCPResponse {
  const tools = buildToolSet(resolveMcpCaller(request), deps);

  markEagerTools(tools, deps);
  declareResultBudgets(tools);

  return {
    jsonrpc: '2.0',
    id: request.id,
    result: { tools },
  };
}

/**
 * The ordered tool list for one caller — the single composition point for
 * per-caller tool sets.
 *
 * Every caller kind, `anonymous` included, gets the host's full set today (no
 * user decision licenses narrowing any caller's tools), so the list is
 * byte-identical across callers and stays prompt-cache stable. A per-caller
 * or per-workspace effective set layers on here, keyed on
 * `(caller.kind, caller.workspaceRoot, caller.agentId)`; it must keep the
 * order `buildToolDefinitions` produces.
 */
function buildToolSet(
  caller: McpCaller,
  deps: Pick<
    ProtocolHandlerDependencies,
    'hasIDECapabilities' | 'disabledMcpNamespaces'
  >,
): MCPToolDefinition[] {
  return buildToolDefinitions(deps);
}

/** The tool definitions this host lists, after namespace and capability gating. */
function buildToolDefinitions(
  deps: Pick<
    ProtocolHandlerDependencies,
    'hasIDECapabilities' | 'disabledMcpNamespaces'
  >,
): MCPToolDefinition[] {
  const disabled = new Set(deps.disabledMcpNamespaces ?? []);

  return [
    buildWorkspaceAnalyzeTool(),
    buildSearchFilesTool(),
    buildGetDiagnosticsTool(),
    buildCountTokensTool(),
    buildWebSearchTool(),
    buildExecuteCodeTool(),
    buildApprovalPromptTool(),
    // Always-on: deliberately NOT wrapped in a `disabled.has(...)` guard.
    buildTaskCreateTool(),
    buildTaskUpdateTool(),
    buildTaskGetTool(),
    buildTaskListTool(),
    buildTaskCheckTool(),
    // Always-on for the same reason as the task tools, and with no namespace
    // toggle (TASK_2026_493_9f58): the tool's success result is a plain-text
    // rendering of the dashboard, so it is the answer on a host with no
    // dashboard page rather than a dead end. An agent that cannot rely on it
    // being present writes a markdown table instead — the exact improvisation
    // `ptah_harness_propose_config` was added to remove.
    buildDashboardProposeSpecTool(),
    // Always-on for the same reason (TASK_2026_538): an anonymous or headless
    // caller still gets validation and a plain-text rendering.
    buildSurfaceUpdateTool(),
    buildSurfaceGetStateTool(),
    ...(deps.hasIDECapabilities === true && !disabled.has('ide')
      ? [
          buildLspReferencesTool(),
          buildLspDefinitionsTool(),
          buildGetDirtyFilesTool(),
        ]
      : []),
    ...(!disabled.has('agent')
      ? [
          buildAgentSpawnTool(),
          buildAgentStatusTool(),
          buildAgentReadTool(),
          buildAgentMessageTool(),
          buildAgentReportTool(),
          buildAgentStopTool(),
          buildAgentListTool(),
        ]
      : []),
    ...(!disabled.has('git')
      ? [
          buildWorktreeListTool(),
          buildWorktreeAddTool(),
          buildWorktreeRemoveTool(),
        ]
      : []),
    ...(!disabled.has('json') ? [buildJsonValidateTool()] : []),
    ...(!disabled.has('browser')
      ? [
          buildBrowserNavigateTool(),
          buildBrowserScreenshotTool(),
          buildBrowserEvaluateTool(),
          buildBrowserClickTool(),
          buildBrowserTypeTool(),
          buildBrowserContentTool(),
          buildBrowserNetworkTool(),
          buildBrowserCloseTool(),
          buildBrowserStatusTool(),
          buildBrowserRecordStartTool(),
          buildBrowserRecordStopTool(),
        ]
      : []),
    ...(!disabled.has('harness')
      ? [
          buildHarnessSearchSkillsTool(),
          buildHarnessCreateSkillTool(),
          buildHarnessSearchMcpRegistryTool(),
          buildHarnessListInstalledMcpTool(),
          buildHarnessInstallMcpTool(),
          buildHarnessProposeConfigTool(),
        ]
      : []),
    ...(!disabled.has('code')
      ? [
          buildAstAnalyzeTool(),
          buildContextEnrichFileTool(),
          buildGetDependentsTool(),
          buildGetDependenciesTool(),
          buildGetSymbolIndexTool(),
          buildCodeSearchSymbolsTool(),
          buildMemorySearchTool(),
          buildRelevanceRankFilesTool(),
          buildProjectDetectMonorepoTool(),
        ]
      : []),
  ];
}

/**
 * Every tool name the dispatcher serves (all namespaces and capabilities on).
 * Built on first use; the telemetry line logs only these names.
 */
let registeredToolNames: ReadonlySet<string> | undefined;

/** Label the telemetry uses for a requested name that is not a registered tool. */
const UNKNOWN_TOOL_LABEL = '<unknown>';

/**
 * The tool identity the telemetry may log: a registered tool name, else
 * {@link UNKNOWN_TOOL_LABEL}. A requested name is caller input — it can carry
 * a path or a secret — so an unregistered one is never logged verbatim.
 */
function telemetryToolName(requestedName: string): string {
  registeredToolNames ??= new Set(
    buildToolDefinitions({ hasIDECapabilities: true }).map((tool) => tool.name),
  );
  return registeredToolNames.has(requestedName)
    ? requestedName
    : UNKNOWN_TOOL_LABEL;
}

/** The permission-prompt tool (`buildApprovalPromptTool`). */
const APPROVAL_PROMPT_TOOL_NAME = 'approval_prompt';

/**
 * Tools that should load eagerly on every runtime instead of being deferred
 * behind the SDK's built-in tool-search tool.
 */
const ALWAYS_EAGER_TOOLS: ReadonlySet<string> = new Set([
  'ptah_search_files',
  'ptah_ast_analyze',
  'ptah_context_enrich_file',
  'ptah_get_diagnostics',
  'ptah_workspace_analyze',
]);

/** Eager only where VS Code IDE capabilities are present. */
const IDE_EAGER_TOOLS: readonly string[] = [
  'ptah_lsp_references',
  'ptah_lsp_definitions',
  'ptah_get_dirty_files',
];

/** Eager only where the SQLite symbol/memory layer is present (Electron). */
const SQLITE_EAGER_TOOLS: readonly string[] = [
  'ptah_code_search_symbols',
  'ptah_memory_search',
];

/**
 * `ptah_web_search` arguments, validated at this boundary.
 *
 * The `providers` override is the re-assessment path: after a `Provider status`
 * section names a provider that failed, the agent retries with the ones that
 * worked. An unvalidated override was worse than no override — a bare string
 * such as `providers: 'serper'` passed the old length test, was then iterated
 * character by character, emptied, and fell back to `['tavily']`, so the retry
 * ran the very provider that had just failed and the outcome list named Tavily
 * as though the agent had asked for it. The schema is `strict()` so a near-miss
 * key (the singular `provider`) is reported instead of being dropped.
 */
const WebSearchArgsSchema = z
  .object({
    query: z.string().min(1),
    providers: z
      .array(z.enum(['tavily', 'serper', 'exa']))
      .min(1)
      .optional(),
    maxResults: z.number().int().positive().optional(),
    timeout: z.number().int().positive().optional(),
  })
  .strict();

/**
 * `ptah_agent_message` arguments (TASK_2026_402).
 *
 * `strict()` for the same reason `WebSearchArgsSchema` is: the retired
 * `ptah_agent_steer` took an `instruction` key, so a model working from stale
 * guidance will send one. Reported as an error, that is a one-line correction;
 * dropped silently, it is a tool call that reports a mode for a message with
 * no body.
 */
const AgentMessageArgsSchema = z
  .object({
    agentId: z.string().min(1),
    message: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
  })
  .strict();

/**
 * `ptah_agent_report` arguments (TASK_2026_402).
 *
 * There is deliberately NO `agentId`: the reporting agent is taken from the
 * `/agent/{id}` segment of the URL it connected on. `strict()` is what makes
 * that refusal visible — an `agentId` key is REJECTED rather than ignored, so
 * a model that tries to report as another agent is told so instead of quietly
 * reporting as itself.
 */
const AgentReportArgsSchema = z
  .object({
    message: z.string().min(1).max(MAX_AGENT_REPORT_LENGTH),
    summary: z.string().min(1).max(200).optional(),
  })
  .strict();

/** Render a Zod failure as one readable line naming each offending field. */
function describeZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Stamp `_meta['anthropic/alwaysLoad'] = true` onto the runtime-aware eager
 * subset so the SDK loads them up front. Tools left untouched stay deferred.
 */
function markEagerTools(
  tools: MCPToolDefinition[],
  deps: ProtocolHandlerDependencies,
): void {
  const eager = new Set<string>(ALWAYS_EAGER_TOOLS);
  if (deps.hasIDECapabilities === true) {
    for (const name of IDE_EAGER_TOOLS) eager.add(name);
  }
  if (deps.hasSqliteLayer === true) {
    for (const name of SQLITE_EAGER_TOOLS) eager.add(name);
  }

  for (const tool of tools) {
    if (eager.has(tool.name)) {
      tool._meta = { ...tool._meta, 'anthropic/alwaysLoad': true };
    }
  }
}

/**
 * Stamp `_meta['anthropic/maxResultSizeChars']` onto every tool: the char
 * ceiling {@link createToolSuccessResponse} holds that tool's text result to
 * (`getToolResultBudget`, the same table the budget reads, so the declaration
 * and the enforcement cannot drift). Existing `_meta` keys are kept; the value
 * depends only on the tool name, so the list stays byte-stable across calls.
 *
 * The one exception is `approval_prompt`: its result is a machine-control
 * response (`{ behavior, updatedInput }`) read by the permission machinery,
 * not text for the model. Reducing it or appending a trailer would corrupt the
 * `updatedInput` the approved tool then runs with, so it is returned whole and
 * therefore declares no ceiling it does not keep.
 */
function declareResultBudgets(tools: MCPToolDefinition[]): void {
  for (const tool of tools) {
    if (tool.name === APPROVAL_PROMPT_TOOL_NAME) {
      continue;
    }
    tool._meta = {
      ...tool._meta,
      'anthropic/maxResultSizeChars': getToolResultBudget(tool.name).chars,
    };
  }
}

export const MCP_SLOW_TOOL_WARN_MS_ENV = 'PTAH_MCP_SLOW_WARN_MS';

/**
 * 2000 ms — the same bar as the slow-RPC warning, for the same reason.
 *
 * MCP tool calls are the other way work reaches the backend, and on the
 * Electron host they are the more dangerous one: a Codex or Copilot agent
 * calling `ptah_get_diagnostics` over the HTTP MCP server makes the ELECTRON
 * MAIN THREAD run `ts.createProgram`, which is tens of seconds of fully
 * synchronous work with the UI frozen behind it (TASK_2026_323, blocker B3).
 * Nothing logged that cost before this warning existed.
 */
export const DEFAULT_MCP_SLOW_TOOL_WARN_MS = 2000;

/**
 * Resolved once at module load.
 *
 * The identical parse lives in `vscode-core`'s `diagnostics/env-thresholds.ts`,
 * and importing it would be the DRY-correct move — except that pulling a VALUE
 * out of the `@ptah-extension/vscode-core` barrel drags in `error-handling`,
 * which does `import * as vscode from 'vscode'`. In the CLI and Electron hosts
 * that is shimmed at build time, but in this lib's Jest environment it is a
 * `.d.ts` that Node tries to execute, and `protocol-dispatcher.spec.ts` dies on
 * `SyntaxError: Unexpected identifier 'module'`. Six lines duplicated across a
 * boundary that cannot be crossed at runtime beats a barrel dependency that
 * breaks the suite.
 */
const mcpSlowToolWarnMs = ((): number => {
  const raw = process.env[MCP_SLOW_TOOL_WARN_MS_ENV];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MCP_SLOW_TOOL_WARN_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MCP_SLOW_TOOL_WARN_MS;
})();

/**
 * Time every `tools/call`, log one `debug` telemetry line for it, and warn on
 * the slow ones.
 *
 * A wrapper rather than inline timing because {@link dispatchToolsCall} has a
 * dozen return statements across three tool families; bracketing at the single
 * entry point is the only way to be sure no path escapes measurement, and
 * `finally` covers the throwing paths too.
 *
 * The telemetry line is `debug`, never `info`: it fires on every tool call,
 * and an `info` line per MCP request was once the highest-volume writer in the
 * log (see `handleMCPRequest`). It is derived from the RETURNED response, so
 * tool errors, JSON-RPC errors and a throw (no response) are logged as well.
 */
async function handleToolsCall(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies,
  callerKind: McpCallerKind,
): Promise<MCPResponse> {
  const toolName = telemetryToolName(toolNameOf(request));
  const startedAt = performance.now();
  let response: MCPResponse | undefined;
  try {
    response = await dispatchToolsCall(request, deps);
    return response;
  } finally {
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    runObserver(() =>
      deps.logger.debug(
        '[MCP] tool result',
        'CodeExecutionMCP',
        toolResultTelemetry(toolName, callerKind, durationMs, response),
      ),
    );
    if (durationMs >= mcpSlowToolWarnMs) {
      runObserver(() =>
        deps.logger.warn('[MCP] slow tool', {
          tool: toolName,
          durationMs,
        }),
      );
    }
  }
}

/** The `tools/call` tool name, or `'unknown'` when the params carry none. */
function toolNameOf(request: MCPRequest): string {
  const name = (request.params as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'unknown';
}

/** One `tools/call` telemetry record (the `debug` line's metadata). */
interface ToolResultTelemetry {
  readonly tool: string;
  /**
   * The caller KIND only. Caller ids and the declared workspace root are
   * URL-supplied values (a root is a local path), so they are never logged.
   */
  readonly callerKind: McpCallerKind;
  readonly durationMs: number;
  /** Total length of the text content blocks returned to the model. */
  readonly resultChars: number;
  /** Budget counts; `null` for a response that did not pass the budget (errors, approval). */
  readonly rawTokens: number | null;
  readonly returnedTokens: number | null;
  readonly reducer: string;
  readonly truncated: boolean;
  readonly isError: boolean;
}

/**
 * The telemetry of one returned response. Token counts are read from the
 * budget outcome recorded by {@link createToolSuccessResponse}, never counted
 * again here. `undefined` means the call threw before a response existed.
 */
function toolResultTelemetry(
  tool: string,
  callerKind: McpCallerKind,
  durationMs: number,
  response: MCPResponse | undefined,
): ToolResultTelemetry {
  const result = response?.result as
    { content?: unknown; isError?: unknown } | undefined;
  const content = Array.isArray(result?.content) ? result.content : [];
  let resultChars = 0;
  for (const block of content as Array<{ type?: unknown; text?: unknown }>) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      resultChars += block.text.length;
    }
  }
  const budget =
    response === undefined ? undefined : budgetOutcomes.get(response);
  return {
    tool,
    callerKind,
    durationMs,
    resultChars,
    rawTokens: budget?.rawTokens ?? null,
    returnedTokens: budget?.returnedTokens ?? null,
    reducer: budget?.reducer ?? 'none',
    truncated: budget?.truncated ?? false,
    isError:
      response === undefined ||
      response.error !== undefined ||
      result?.isError === true,
  };
}

/**
 * Handle tools/call request
 * Routes to individual ptah_* tools, execute_code, or approval_prompt
 */
async function dispatchToolsCall(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse> {
  const params = request.params as
    { name: string; arguments?: Record<string, unknown> } | undefined;
  if (params === null || params === undefined) {
    return createErrorResponse(
      request.id,
      -32602,
      'Invalid params: tools/call requires a params object with a "name" field',
    );
  }
  if (typeof params.name !== 'string' || params.name.length === 0) {
    return createErrorResponse(
      request.id,
      -32602,
      'Invalid params: tools/call requires a non-empty "name" string',
    );
  }

  const { name, arguments: args } = params;
  const individualResult = await handleIndividualTool(
    name,
    args || {},
    request,
    deps,
  );
  if (individualResult) return individualResult;

  if (name === 'execute_code') {
    return await handleExecuteCodeCall(
      request,
      args as unknown as ExecuteCodeParams,
      deps,
    );
  }

  // Not budgeted: a machine-control response (see `declareResultBudgets`).
  if (name === APPROVAL_PROMPT_TOOL_NAME) {
    if (!deps.webviewManager) {
      const approvalParams = args as unknown as ApprovalPromptParams;
      deps.logger.info(
        'approval_prompt auto-allowed (no WebviewManager — Electron mode)',
        {
          tool: approvalParams.tool_name,
        },
      );
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                behavior: 'allow',
                updatedInput: approvalParams.input,
              }),
            },
          ],
        },
      };
    }

    return await handleApprovalPrompt(
      request,
      args as unknown as ApprovalPromptParams,
      {
        permissionPromptService: deps.permissionPromptService,
        webviewManager: deps.webviewManager,
        logger: deps.logger,
      },
    );
  }

  return createErrorResponse(request.id, -32602, `Unknown tool: ${name}`);
}

/**
 * Handle individual ptah_* tool calls.
 * Returns MCPResponse if the tool name matches, null otherwise.
 * Each handler directly calls deps.ptahAPI — no sandbox, no code execution.
 */
async function handleIndividualTool(
  name: string,
  args: Record<string, unknown>,
  request: MCPRequest,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse | null> {
  const { ptahAPI, logger } = deps;

  try {
    switch (name) {
      case 'ptah_workspace_analyze': {
        const result = await ptahAPI.workspace.analyze();
        return await createToolSuccessResponse(
          request,
          formatWorkspaceAnalysis(result),
          deps,
        );
      }

      case 'ptah_search_files': {
        const { pattern, limit } = args as { pattern: string; limit?: number };
        const files = await ptahAPI.search.findFiles(pattern, limit ?? 50);
        return await createToolSuccessResponse(
          request,
          formatSearchFiles(files),
          deps,
        );
      }

      case 'ptah_get_diagnostics': {
        const { severity, files } = args as {
          severity?: 'error' | 'warning' | 'all';
          files?: string[];
        };
        let result;
        if (severity === 'error') {
          result = await ptahAPI.diagnostics.getErrors(files);
        } else if (severity === 'warning') {
          result = await ptahAPI.diagnostics.getWarnings(files);
        } else {
          result = await ptahAPI.diagnostics.getAll(files);
        }
        // The payload carries the scope, resolved against the session root, as
        // `requestedFiles`: the formatter lists diagnostics in those files
        // first and in full, and caps the sibling files around them.
        return await createToolSuccessResponse(
          request,
          formatDiagnostics(result),
          deps,
        );
      }

      case 'ptah_lsp_references': {
        const { file, line, col } = args as {
          file: string;
          line: number;
          col: number;
        };
        const refs = await ptahAPI.ide.lsp.getReferences(file, line, col);
        return await createToolSuccessResponse(
          request,
          formatLspReferences(refs),
          deps,
        );
      }

      case 'ptah_lsp_definitions': {
        const { file, line, col } = args as {
          file: string;
          line: number;
          col: number;
        };
        const defs = await ptahAPI.ide.lsp.getDefinition(file, line, col);
        return await createToolSuccessResponse(
          request,
          formatLspDefinitions(defs),
          deps,
        );
      }

      case 'ptah_get_dirty_files': {
        const dirtyFiles = await ptahAPI.ide.editor.getDirtyFiles();
        return await createToolSuccessResponse(
          request,
          formatDirtyFiles(dirtyFiles),
          deps,
        );
      }

      case 'ptah_count_tokens': {
        const { file } = args as { file: string };
        const readPath = await toWorkspaceReadPath(file.trim(), ptahAPI);
        const fileContent = await ptahAPI.files.read(readPath);
        const tokenCount = await ptahAPI.context.countTokens(fileContent);
        return await createToolSuccessResponse(
          request,
          formatTokenCount({ file, tokens: tokenCount }),
          deps,
        );
      }
      case 'ptah_agent_spawn': {
        const parsed = AgentSpawnArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          return toolErrorResponse(
            request,
            `Error: invalid ptah_agent_spawn arguments — ${describeZodIssues(
              parsed.error,
            )}. Required: "task".`,
          );
        }
        const spawnArgs = parsed.data;
        const { task, ptahCliId, modelTier } = spawnArgs;

        logger.info('[MCP] ptah_agent_spawn invoked', 'CodeExecutionMCP', {
          cli: spawnArgs.cli ?? (ptahCliId ? 'ptah-cli' : 'auto-detect'),
          ptahCliId,
          model: spawnArgs.model ?? 'default',
          modelTier: modelTier ?? 'sonnet',
          task: task.substring(0, 100) + (task.length > 100 ? '...' : ''),
          timeout: spawnArgs.timeout,
          files: spawnArgs.files?.length ?? 0,
          taskFolder: spawnArgs.taskFolder,
          resumeSessionId: spawnArgs.resume_session_id,
          role: spawnArgs.role,
        });

        let result: Awaited<ReturnType<PtahAPI['agent']['spawn']>>;
        try {
          result = await ptahAPI.agent.spawn({
            task,
            cli: spawnArgs.cli,
            ptahCliId,
            workingDirectory: spawnArgs.workingDirectory,
            timeout: spawnArgs.timeout,
            files: spawnArgs.files,
            taskFolder: spawnArgs.taskFolder,
            deliverables: spawnArgs.deliverables,
            model: spawnArgs.model,
            modelTier,
            resumeSessionId: spawnArgs.resume_session_id,
            parentSessionId: request._callerSessionId,
            role: spawnArgs.role,
          });
        } catch (error: unknown) {
          if (error instanceof AgentRoleError) {
            return toolErrorResponse(
              request,
              `Error: ptah_agent_spawn role ${error.code}: ${error.message}`,
            );
          }
          if (error instanceof CliCommandLineTooLongError) {
            return toolErrorResponse(
              request,
              `Error: ptah_agent_spawn command line too long (${error.measured} against a limit of ${error.limit}): ${error.message}`,
            );
          }
          throw error;
        }

        logger.info('[MCP] ptah_agent_spawn result', 'CodeExecutionMCP', {
          agentId: result.agentId,
          cli: result.cli,
          status: result.status,
          cliSessionId: result.cliSessionId,
          role: result.role,
        });

        return await createToolSuccessResponse(
          request,
          formatAgentSpawn(result, {
            modelTier: ptahCliId ? (modelTier ?? 'sonnet') : undefined,
          }),
          deps,
        );
      }

      case 'ptah_agent_status': {
        const { agentId } = args as { agentId?: string };
        const result = await ptahAPI.agent.status(agentId);
        return await createToolSuccessResponse(
          request,
          formatAgentStatus(result),
          deps,
        );
      }

      case 'ptah_agent_read': {
        const { agentId, tail } = args as {
          agentId: string;
          tail?: number;
        };
        const result = await ptahAPI.agent.read(agentId, tail);
        return await createToolSuccessResponse(
          request,
          formatAgentRead(result),
          deps,
        );
      }

      case 'ptah_agent_message': {
        const parsed = AgentMessageArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          return toolErrorResponse(
            request,
            `Error: invalid ptah_agent_message arguments — ${describeZodIssues(
              parsed.error,
            )}. Required: "agentId" and "message".`,
          );
        }
        try {
          const outcome = await ptahAPI.agent.message(
            parsed.data.agentId,
            parsed.data.message,
          );
          return await createToolSuccessResponse(
            request,
            formatAgentMessage({ agentId: parsed.data.agentId, ...outcome }),
            deps,
          );
        } catch (error: unknown) {
          // The three unroutable record states carry a machine-readable code
          // and must stay distinguishable — `not_found`, `restored` (resume it
          // with its resume_session_id) and `not_running` are three different
          // things for the calling model to do next.
          if (error instanceof AgentMessageError) {
            return toolErrorResponse(
              request,
              `Error: ptah_agent_message could not reach agent ${parsed.data.agentId} — ${error.code}: ${error.message}`,
            );
          }
          throw error;
        }
      }

      case 'ptah_agent_report': {
        const parsed = AgentReportArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          return toolErrorResponse(
            request,
            `Error: invalid ptah_agent_report arguments — ${describeZodIssues(
              parsed.error,
            )}. Required: "message". There is no "agentId" argument — the ` +
              'reporting agent is identified by the connection it calls on.',
          );
        }
        // Identity comes from the transport, NEVER from the arguments. An
        // absent id is reported as an honest refusal rather than guessed at:
        // guessing would deliver one agent's report into another's session.
        // Read from the request context only: `resolveMcpCaller` already
        // treats an empty or whitespace-only id as absent.
        const callerAgentId = getCallerAgentId();
        if (callerAgentId === undefined) {
          return await createToolSuccessResponse(
            request,
            formatAgentReport({
              delivered: false,
              reason: 'unattributed-caller',
            }),
            deps,
          );
        }
        const delivery = await ptahAPI.agent.report({
          agentId: callerAgentId,
          message: parsed.data.message,
          summary: parsed.data.summary,
        });
        return await createToolSuccessResponse(
          request,
          formatAgentReport(delivery),
          deps,
        );
      }

      case 'ptah_agent_stop': {
        const { agentId } = args as { agentId: string };
        const result = await ptahAPI.agent.stop(agentId);
        return await createToolSuccessResponse(
          request,
          formatAgentStop(result),
          deps,
        );
      }

      case 'ptah_agent_list': {
        logger.info('[MCP] ptah_agent_list called', 'CodeExecutionMCP');
        const agents = await ptahAPI.agent.list();
        let roles: string[] = [];
        try {
          roles = await ptahAPI.agent.listRoles();
        } catch (error: unknown) {
          logger.warn(
            '[MCP] ptah_agent_list could not list roles',
            'CodeExecutionMCP',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        return await createToolSuccessResponse(
          request,
          formatAgentList(agents, roles),
          deps,
        );
      }

      case 'ptah_web_search': {
        if (!deps.ptahAPI.webSearch) {
          return toolErrorResponse(
            request,
            'Web search service not available.',
          );
        }
        const parsed = WebSearchArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          // Never fall back to a different provider set than the one asked
          // for: a discarded override is invisible to the agent, an error is
          // not.
          return toolErrorResponse(
            request,
            `Error: invalid ptah_web_search arguments — ${describeZodIssues(
              parsed.error,
            )}. "providers" must be an array of ${JSON.stringify([
              'tavily',
              'serper',
              'exa',
            ])}.`,
          );
        }
        const { query, maxResults, timeout, providers } = parsed.data;
        const result = await deps.ptahAPI.webSearch.search(query, {
          maxResults,
          timeout,
          providers,
        });
        return await createToolSuccessResponse(
          request,
          formatWebSearch(result),
          deps,
        );
      }
      case 'ptah_git_worktree_list': {
        const result = await ptahAPI.git.worktreeList();
        return await createToolSuccessResponse(
          request,
          formatWorktreeList(result),
          deps,
        );
      }

      case 'ptah_git_worktree_add': {
        const { branch, path, createBranch } = args as {
          branch: string;
          path?: string;
          createBranch?: boolean;
        };
        if (!branch || typeof branch !== 'string' || !branch.trim()) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "branch" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }

        const addResult = await ptahAPI.git.worktreeAdd({
          branch: branch.trim(),
          path: path && typeof path === 'string' ? path.trim() : undefined,
          createBranch,
        });
        return await createToolSuccessResponse(
          request,
          formatWorktreeAdd(addResult),
          deps,
        );
      }

      case 'ptah_git_worktree_remove': {
        const { path: worktreePath, force } = args as {
          path: string;
          force?: boolean;
        };
        if (
          !worktreePath ||
          typeof worktreePath !== 'string' ||
          !worktreePath.trim()
        ) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "path" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }

        const removeResult = await ptahAPI.git.worktreeRemove({
          path: worktreePath.trim(),
          force,
        });
        return await createToolSuccessResponse(
          request,
          formatWorktreeRemove(removeResult),
          deps,
        );
      }
      case 'ptah_json_validate': {
        const { file, schema } = args as {
          file: string;
          schema?: Record<string, unknown>;
        };
        if (!file || typeof file !== 'string' || !file.trim()) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "file" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }

        const jsonResult = await ptahAPI.json.validate({
          file: file.trim(),
          schema,
        });
        return await createToolSuccessResponse(
          request,
          formatJsonValidate(jsonResult),
          deps,
        );
      }
      case 'ptah_browser_navigate': {
        const { url, waitForLoad, headless, viewport } = args as {
          url: string;
          waitForLoad?: boolean;
          headless?: boolean;
          viewport?: { width: number; height: number }; // MCP JSON input; validated in namespace builder
        };

        if (!url || typeof url !== 'string' || !url.trim()) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "url" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }

        const navResult = await ptahAPI.browser.navigate({
          url: url.trim(),
          waitForLoad,
          headless,
          viewport,
        });
        return await createToolSuccessResponse(
          request,
          formatBrowserNavigate(navResult),
          deps,
        );
      }

      case 'ptah_browser_screenshot': {
        const { format, quality, fullPage, saveTo } = args as {
          format?: 'png' | 'jpeg' | 'webp';
          quality?: number;
          fullPage?: boolean;
          saveTo?: string;
        };
        const screenshotResult = await ptahAPI.browser.screenshot({
          format,
          quality,
          fullPage,
        });
        if (saveTo && screenshotResult.data && !screenshotResult.error) {
          try {
            const filePath = await resolveScreenshotPath(
              saveTo,
              screenshotResult.format,
              ptahAPI,
            );
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(
              filePath,
              Buffer.from(screenshotResult.data, 'base64'),
            );
            screenshotResult.filePath = filePath;
          } catch (saveError) {
            deps.logger.warn(
              `Failed to save screenshot: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
              'ProtocolHandlers',
            );
          }
        }
        if (screenshotResult.data && !screenshotResult.error) {
          const mimeType =
            screenshotResult.format === 'jpeg'
              ? 'image/jpeg'
              : screenshotResult.format === 'webp'
                ? 'image/webp'
                : 'image/png';

          const text = formatBrowserScreenshot(screenshotResult);
          runObserver(() =>
            deps.onToolResult?.(request.id.toString(), text, false),
          );

          const savedNote = screenshotResult.filePath
            ? ` | Saved to: ${screenshotResult.filePath}`
            : '';
          // Only the text block is budgeted; the image block goes out as is.
          const caption = await budgetToolText(
            request,
            `Screenshot captured (${screenshotResult.format}, ~${Math.round((screenshotResult.data.length * 3) / 4 / 1024)}KB)${savedNote}`,
            deps,
          );

          const response: MCPResponse = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'image',
                  data: screenshotResult.data,
                  mimeType,
                },
                {
                  type: 'text',
                  text: caption.text,
                },
              ],
            },
          };
          budgetOutcomes.set(response, caption);
          return response;
        }
        return await createToolSuccessResponse(
          request,
          formatBrowserScreenshot(screenshotResult),
          deps,
        );
      }

      case 'ptah_browser_evaluate': {
        const { expression } = args as { expression: string };

        if (!expression || typeof expression !== 'string') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "expression" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }

        const evalResult = await ptahAPI.browser.evaluate({
          expression,
        });
        return await createToolSuccessResponse(
          request,
          formatBrowserEvaluate(evalResult),
          deps,
        );
      }

      case 'ptah_browser_click': {
        const { selector } = args as { selector: string };

        if (!selector || typeof selector !== 'string' || !selector.trim()) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "selector" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }

        const clickResult = await ptahAPI.browser.click({
          selector: selector.trim(),
        });
        return await createToolSuccessResponse(
          request,
          formatBrowserClick(clickResult),
          deps,
        );
      }

      case 'ptah_browser_type': {
        const { selector, text } = args as {
          selector: string;
          text: string;
        };

        if (!selector || typeof selector !== 'string' || !selector.trim()) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "selector" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }
        if (text === undefined || text === null) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "text" is required.',
                },
              ],
              isError: true,
            },
          };
        }

        const typeResult = await ptahAPI.browser.type({
          selector: selector.trim(),
          text: String(text),
        });
        return await createToolSuccessResponse(
          request,
          formatBrowserType(typeResult),
          deps,
        );
      }

      case 'ptah_browser_content': {
        const { selector } = args as { selector?: string };
        const contentResult = await ptahAPI.browser.getContent(
          selector ? { selector } : undefined,
        );
        return await createToolSuccessResponse(
          request,
          formatBrowserContent(contentResult),
          deps,
        );
      }

      case 'ptah_browser_network': {
        const { limit } = args as { limit?: number };
        const networkResult = await ptahAPI.browser.networkRequests({
          limit,
        });
        return await createToolSuccessResponse(
          request,
          formatBrowserNetwork(networkResult),
          deps,
        );
      }

      case 'ptah_browser_close': {
        const closeResult = await ptahAPI.browser.close();
        return await createToolSuccessResponse(
          request,
          formatBrowserClose(closeResult),
          deps,
        );
      }

      case 'ptah_browser_status': {
        const statusResult = await ptahAPI.browser.status();
        return await createToolSuccessResponse(
          request,
          formatBrowserStatus(statusResult),
          deps,
        );
      }
      case 'ptah_browser_record_start': {
        const { maxFrames, frameDelay } = args as {
          maxFrames?: number;
          frameDelay?: number;
        };
        const recordStartResult = await ptahAPI.browser.recordStart({
          maxFrames,
          frameDelay,
        });
        return await createToolSuccessResponse(
          request,
          formatBrowserRecordStart(recordStartResult),
          deps,
        );
      }

      case 'ptah_browser_record_stop': {
        const recordStopResult = await ptahAPI.browser.recordStop();
        return await createToolSuccessResponse(
          request,
          formatBrowserRecordStop(recordStopResult),
          deps,
        );
      }
      case 'ptah_harness_search_skills': {
        if (!ptahAPI.harness) {
          return harnessUnavailableResponse(request, { skills: [] });
        }
        const {
          query: skillQuery,
          limit: skillLimit,
          offset: skillOffset,
        } = args as {
          query?: string;
          limit?: number;
          offset?: number;
        };
        const skillsResult = await ptahAPI.harness.searchSkills(
          skillQuery,
          skillLimit,
          skillOffset,
        );
        // A degraded search is surfaced as a TOOL ERROR, not as data. An empty
        // list that reads like a valid negative is the one failure mode this
        // whole contract exists to prevent.
        return skillsResult.status === 'degraded'
          ? toolErrorResponse(request, JSON.stringify(skillsResult))
          : await createToolSuccessResponse(
              request,
              JSON.stringify(skillsResult),
              deps,
            );
      }

      case 'ptah_harness_create_skill': {
        if (!ptahAPI.harness) {
          return harnessUnavailableResponse(request, {});
        }
        const {
          name: skillName,
          description: skillDescription,
          content: skillContent,
          allowedTools,
          scope: skillScope,
        } = args as {
          name: string;
          description: string;
          content: string;
          allowedTools?: string[];
          scope?: 'user' | 'workspace';
        };

        if (
          skillScope !== undefined &&
          !['user', 'workspace'].includes(skillScope)
        ) {
          return toolErrorResponse(
            request,
            `Error: "scope" must be "user" or "workspace" (got ${JSON.stringify(skillScope)}).`,
          );
        }

        if (!skillName || !skillDescription || !skillContent) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "name", "description", and "content" are required.',
                },
              ],
              isError: true,
            },
          };
        }

        const createResult = await ptahAPI.harness.createSkill(
          skillName,
          skillDescription,
          skillContent,
          allowedTools,
          skillScope,
        );
        return await createToolSuccessResponse(
          request,
          JSON.stringify(createResult),
          deps,
        );
      }

      case 'ptah_harness_search_mcp_registry': {
        if (!ptahAPI.harness) {
          return harnessUnavailableResponse(request, { servers: [] });
        }
        const { query: registryQuery, limit: registryLimit } = args as {
          query: string;
          limit?: number;
        };

        if (!registryQuery || typeof registryQuery !== 'string') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "query" is required and must be a non-empty string.',
                },
              ],
              isError: true,
            },
          };
        }

        const registryResult = await ptahAPI.harness.searchMcpRegistry(
          registryQuery,
          registryLimit,
        );
        return registryResult.status === 'degraded'
          ? toolErrorResponse(request, JSON.stringify(registryResult))
          : await createToolSuccessResponse(
              request,
              JSON.stringify(registryResult),
              deps,
            );
      }

      case 'ptah_harness_list_installed_mcp': {
        if (!ptahAPI.harness) {
          return harnessUnavailableResponse(request, { servers: [] });
        }
        const installedServers =
          await ptahAPI.harness.listInstalledMcpServers();
        return await createToolSuccessResponse(
          request,
          JSON.stringify({
            servers: installedServers,
            count: installedServers.length,
          }),
          deps,
        );
      }

      case 'ptah_harness_install_mcp_server': {
        if (!ptahAPI.harness) {
          return harnessUnavailableResponse(request, { results: [] });
        }
        const {
          serverName: mcpServerName,
          config: mcpConfig,
          serverKey: mcpServerKey,
          targets: mcpTargets,
        } = args as {
          serverName?: string;
          config?: McpServerConfig;
          serverKey?: string;
          targets?: McpInstallTarget[];
        };

        if (
          typeof mcpServerName !== 'string' ||
          mcpServerName.trim().length === 0
        ) {
          return missingStringArgResponse(request, 'serverName');
        }
        if (
          mcpConfig === null ||
          typeof mcpConfig !== 'object' ||
          Array.isArray(mcpConfig)
        ) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "config" is required and must be an MCP transport config object ({"type":"stdio"|"http"|"sse", ...}).',
                },
              ],
              isError: true,
            },
          };
        }

        // Argument shapes beyond this point are validated by the namespace
        // (zod) — a rejection surfaces as an isError tool result.
        const installOutcome = await ptahAPI.harness.installMcpServer(
          mcpServerName,
          mcpConfig,
          mcpServerKey,
          mcpTargets,
        );
        return await createToolSuccessResponse(
          request,
          JSON.stringify(installOutcome),
          deps,
        );
      }

      case 'ptah_harness_propose_config': {
        if (!ptahAPI.harness) {
          return harnessUnavailableResponse(request, {});
        }
        const { configUpdates, isConfigComplete } = args as {
          configUpdates?: unknown;
          isConfigComplete?: boolean;
        };

        if (
          configUpdates === null ||
          typeof configUpdates !== 'object' ||
          Array.isArray(configUpdates)
        ) {
          return toolErrorResponse(
            request,
            'Error: "configUpdates" is required and must be a partial harness config object.',
          );
        }

        // Field-level shape is settled by zod inside the namespace; a rejection
        // arrives here as a throw and is reported with the offending path.
        const proposeAck = await ptahAPI.harness.proposeConfig(
          configUpdates as Parameters<
            NonNullable<typeof ptahAPI.harness>['proposeConfig']
          >[0],
          isConfigComplete,
        );
        return await createToolSuccessResponse(
          request,
          JSON.stringify({
            ok: true,
            isConfigComplete: isConfigComplete ?? false,
            message: proposeAck,
          }),
          deps,
        );
      }

      case DASHBOARD_PROPOSE_SPEC_TOOL_NAME: {
        // `spec` is forwarded UNTOUCHED. The dispatcher deliberately does not
        // pre-check its shape — not even that it is an object — because every
        // such check would be a second, weaker copy of the zod contract, and a
        // near-miss rejected here would report a worse reason than the one the
        // validator produces. See `validateDashboardSpec`.
        const { spec } = args as { spec?: unknown };

        const outcome = await ptahAPI.dashboard.proposeSpec(spec, {
          sessionId: getCallerSessionId(),
          toolCallId: request.id.toString(),
        });

        // A validation rejection is an `isError` tool result carrying the
        // plain-text reason, and NO push message was sent — the namespace
        // guarantees the ordering (validate, then dispatch), not this branch.
        if (outcome.status === 'rejected') {
          return toolErrorResponse(request, outcome.reason);
        }

        // A DELIVERY failure is a different answer from a validation rejection
        // and must not be reported as success (TASK_2026_493 revision 1,
        // finding 2). It still carries the dashboard text, because losing the
        // content over a transport problem helps nobody, and the reason says
        // how many surfaces did receive it — one of them may already be on
        // screen.
        if (outcome.status === 'delivery-failed') {
          return toolErrorResponse(
            request,
            `${outcome.reason}\n\n${outcome.text}`,
          );
        }

        // Success content is the plain-text dashboard, not JSON: the hosts
        // without a dashboard page need to be able to SHOW this, and the UI
        // never parses it — it reads `dashboard:spec-proposed` instead
        // (`context.md`, "Transport contract"). A host with NO surface at all
        // reaches here too, and deliberately so.
        return await createToolSuccessResponse(request, outcome.text, deps);
      }

      case SURFACE_UPDATE_TOOL_NAME:
      case SURFACE_GET_STATE_TOOL_NAME: {
        // Scope comes ONLY from the trusted request context, never from args.
        const reply = await handleSurfaceToolCall(
          name,
          args,
          ptahAPI.surface,
          {
            sessionId: getCallerSessionId(),
            toolCallId: request.id.toString(),
          },
          logger,
        );
        return reply.isError
          ? toolErrorResponse(request, reply.text)
          : await createToolSuccessResponse(request, reply.text, deps);
      }

      case 'ptah_ast_analyze': {
        const { file, workspaceRoot } = args as {
          file: string;
          workspaceRoot?: string;
        };
        if (!file || typeof file !== 'string' || !file.trim()) {
          return missingStringArgResponse(request, 'file');
        }
        const result = await ptahAPI.ast.analyze(
          file.trim(),
          typeof workspaceRoot === 'string' ? workspaceRoot.trim() : undefined,
        );
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_context_enrich_file': {
        const { file, language } = args as { file: string; language?: string };
        if (!file || typeof file !== 'string' || !file.trim()) {
          return missingStringArgResponse(request, 'file');
        }
        const result = await ptahAPI.context.enrichFile(file.trim(), language);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_get_dependents': {
        const { file } = args as { file: string };
        if (!file || typeof file !== 'string' || !file.trim()) {
          return missingStringArgResponse(request, 'file');
        }
        await ensureDependencyGraphBuilt(ptahAPI);
        const resolvedFile = await resolveDependencyQueryPath(
          ptahAPI,
          file.trim(),
        );
        const dependents =
          await ptahAPI.dependencies.getDependents(resolvedFile);
        return await createToolSuccessResponse(
          request,
          JSON.stringify({
            file: resolvedFile,
            dependents,
            count: dependents.length,
          }),
          deps,
        );
      }

      case 'ptah_get_dependencies': {
        const { file, depth } = args as { file: string; depth?: number };
        if (!file || typeof file !== 'string' || !file.trim()) {
          return missingStringArgResponse(request, 'file');
        }
        await ensureDependencyGraphBuilt(ptahAPI);
        const resolvedFile = await resolveDependencyQueryPath(
          ptahAPI,
          file.trim(),
        );
        const dependencies = await ptahAPI.dependencies.getDependencies(
          resolvedFile,
          depth,
        );
        return await createToolSuccessResponse(
          request,
          JSON.stringify({
            file: resolvedFile,
            dependencies,
            count: dependencies.length,
          }),
          deps,
        );
      }

      case 'ptah_code_search_symbols': {
        if (!ptahAPI.code) {
          return await createToolSuccessResponse(
            request,
            JSON.stringify({
              hits: [],
              error:
                'Code symbol index not available on this runtime. Use ptah_search_files or Grep instead.',
            }),
            deps,
          );
        }
        const { query, maxResults, filePath } = args as {
          query: string;
          maxResults?: number;
          filePath?: string;
        };
        if (!query || typeof query !== 'string' || !query.trim()) {
          return missingStringArgResponse(request, 'query');
        }
        const result = await ptahAPI.code.searchSymbols(query.trim(), {
          maxResults,
          filePath,
        });
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_memory_search': {
        if (!ptahAPI.memory) {
          return await createToolSuccessResponse(
            request,
            JSON.stringify({
              hits: [],
              error: 'Memory store not available on this runtime.',
            }),
            deps,
          );
        }
        const {
          query,
          maxResults,
          global: globalScope,
        } = args as {
          query: string;
          maxResults?: number;
          global?: boolean;
        };
        if (!query || typeof query !== 'string' || !query.trim()) {
          return missingStringArgResponse(request, 'query');
        }
        const result = await ptahAPI.memory.search(
          query.trim(),
          globalScope === true
            ? { maxResults }
            : { workspace: true, maxResults },
        );
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_relevance_rank_files': {
        const { query, limit } = args as { query: string; limit?: number };
        if (!query || typeof query !== 'string' || !query.trim()) {
          return missingStringArgResponse(request, 'query');
        }
        const result = await ptahAPI.relevance.rankFiles(query.trim(), limit);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_project_detect_monorepo': {
        const result = await ptahAPI.project.detectMonorepo();
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_get_symbol_index': {
        await ensureDependencyGraphBuilt(ptahAPI);
        const index = await ptahAPI.dependencies.getSymbolIndex();
        return await createToolSuccessResponse(
          request,
          JSON.stringify({ files: index, count: index.length }),
          deps,
        );
      }

      // -- Task specs (TASK_2026_179, step 17) ----------------------------
      //
      // Each of these returns its namespace result verbatim. The namespace
      // validates its own arguments with Zod and converts every failure into a
      // typed `{ ok: false, error }` object, so these cases stay thin and the
      // agent gets a machine-readable refusal rather than a thrown string.
      case 'ptah_task_create': {
        const result = await ptahAPI.tasks.create(args);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_task_update': {
        const result = await ptahAPI.tasks.update(args);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_task_get': {
        const result = await ptahAPI.tasks.get(args);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_task_list': {
        const result = await ptahAPI.tasks.list(args);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      case 'ptah_task_check': {
        const result = await ptahAPI.tasks.check();
        return await createToolSuccessResponse(
          request,
          JSON.stringify(result),
          deps,
        );
      }

      default:
        return null;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    runObserver(() =>
      logger.error(
        `Individual tool ${name} failed: ${errorMessage}`,
        error instanceof Error ? error : new Error(String(error)),
      ),
    );

    runObserver(() =>
      deps.onToolResult?.(request.id.toString(), errorMessage, true),
    );

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          { type: 'text', text: `Tool ${name} failed: ${errorMessage}` },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Build a JSON-RPC tool error for a missing/empty required string argument.
 */
/**
 * Report a tool failure as an MCP tool error.
 *
 * Per the MCP spec this is still a successful JSON-RPC response carrying
 * `isError: true` — the distinction that matters is that the agent sees an
 * error rather than data it could mistake for an answer.
 */
function toolErrorResponse(request: MCPRequest, text: string): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [{ type: 'text', text }],
      isError: true,
    },
  };
}

/**
 * The harness namespace is absent on this host.
 *
 * Reported as an ERROR carrying an empty collection of the shape the caller
 * expected, never as a successful empty result: "the harness tools are not
 * wired here" and "there is nothing to find" are different answers and were
 * previously indistinguishable.
 */
function harnessUnavailableResponse(
  request: MCPRequest,
  shape: Record<string, unknown>,
): MCPResponse {
  return toolErrorResponse(
    request,
    JSON.stringify({
      ...shape,
      count: 0,
      status: 'error',
      error:
        'Harness namespace not available on this host — this is a tool failure, not an empty result.',
    }),
  );
}

function missingStringArgResponse(
  request: MCPRequest,
  field: string,
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [
        {
          type: 'text',
          text: `Error: "${field}" is required and must be a non-empty string.`,
        },
      ],
      isError: true,
    },
  };
}

/**
 * Build the workspace import graph on first dependency query; reuse thereafter.
 */
async function ensureDependencyGraphBuilt(ptahAPI: PtahAPI): Promise<void> {
  const info = await ptahAPI.workspace.getInfo();
  const workspaceRoot = info?.path;
  if (!workspaceRoot) return;
  // Guard on THIS workspace's graph so a second open workspace still builds its
  // own graph rather than reusing the first workspace's cached result.
  if (await ptahAPI.dependencies.isBuilt(workspaceRoot)) return;
  const files = await ptahAPI.search.findFiles('**/*.{ts,tsx,js,jsx}', 5000);
  if (files.length === 0) return;
  // findFiles yields workspace-relative paths; the graph must be keyed by
  // ABSOLUTE paths so its nodes match absolute-path queries (and so the graph
  // reads real files rather than resolving relative paths against process.cwd).
  const absoluteFiles = files.map((f) =>
    toAbsoluteWorkspacePath(workspaceRoot, f),
  );
  await ptahAPI.dependencies.buildGraph(absoluteFiles, workspaceRoot);
}

/** Join a workspace-relative path to its root; pass absolute paths through. */
function toAbsoluteWorkspacePath(workspaceRoot: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
}

/**
 * Resolve a dependency-tool `file` argument to an absolute path against the same
 * workspace root the graph is built under, so a relative arg from the agent
 * matches the graph's absolute node keys. Absolute args pass through unchanged.
 */
async function resolveDependencyQueryPath(
  ptahAPI: PtahAPI,
  file: string,
): Promise<string> {
  if (path.isAbsolute(file)) return file;
  const info = await ptahAPI.workspace.getInfo();
  const workspaceRoot = info?.path;
  return workspaceRoot ? path.join(workspaceRoot, file) : file;
}

/** The budget fields of a success response, read back by the telemetry line. */
type BudgetTelemetry = Pick<
  ToolResultBudgetOutcome,
  'text' | 'rawTokens' | 'returnedTokens' | 'reducer' | 'truncated'
>;

/**
 * Budget outcome of every response {@link createToolSuccessResponse} built,
 * keyed by the response object so {@link handleToolsCall} reads the counts
 * without the MCP wire shape carrying them. Weak: an entry lives exactly as
 * long as its response.
 */
const budgetOutcomes = new WeakMap<MCPResponse, BudgetTelemetry>();

/**
 * Create a successful tool response with callback notification.
 *
 * The text goes through the tool-result budget first (the tool name comes
 * from `request.params.name`), and the transcript callback receives exactly
 * the text the model gets. Never rejects: the budget never throws and the
 * spool-root lookup is guarded.
 */
async function createToolSuccessResponse(
  request: MCPRequest,
  text: string,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse> {
  const budgeted = await budgetToolText(request, text, deps);
  runObserver(() =>
    deps.onToolResult?.(request.id.toString(), budgeted.text, false),
  );
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [{ type: 'text', text: budgeted.text }],
    },
  };
  budgetOutcomes.set(response, budgeted);
  return response;
}

/**
 * `text` held to its tool's budget.
 *
 * Text within the budget is returned as is, measured the same way
 * `applyToolResultBudget` measures it (char ceiling first, then the bounded
 * piece-wise count), so the outcome is identical to the one it would return —
 * but the spool root, which can cost a workspace lookup, is only resolved for
 * text that actually has to be reduced or cut.
 */
async function budgetToolText(
  request: MCPRequest,
  text: string,
  deps: ProtocolHandlerDependencies,
): Promise<BudgetTelemetry> {
  const toolName = toolNameOf(request);
  const tokens = tokensWithinBudget(text, getToolResultBudget(toolName));
  if (tokens !== null) {
    return {
      text,
      rawTokens: tokens,
      returnedTokens: tokens,
      reducer: 'none',
      truncated: false,
    };
  }
  return applyToolResultBudget({
    text,
    toolName,
    requestId: request.id,
    spoolRoot: await resolveSpoolRoot(deps),
    outliner: deps.codeOutliner,
    output: budgetOutputChannel(deps.logger),
  });
}

/** Token count of `text` when it fits both limits of `budget`, else `null` (also when counting throws). */
function tokensWithinBudget(text: string, budget: TextBudget): number | null {
  if (text.length > budget.chars) {
    return null;
  }
  try {
    const tokens = countTokensPiecewise(text, budget.tokens);
    return tokens <= budget.tokens ? tokens : null;
  } catch {
    // degradation-audit: optional-capability — the fast path is optional:
    // `null` routes the text to `applyToolResultBudget`, which never throws,
    // falls back to a cut, and reports its own failures on the output channel.
    return null;
  }
}

/**
 * Where an over-budget result is spooled. The root always comes from a
 * host-owned record: the platform workspace provider's open folders
 * (`deps.workspaceProvider`, never the session-aware `ptahAPI.workspace`,
 * which resolves the caller's declared root first and so cannot vouch for
 * it). The caller-declared workspace root (a URL segment, so caller input) is
 * used only when it canonicalizes to exactly one of those folders, and then
 * the host's own record of that folder is returned. Otherwise the host's
 * first open folder, else the system temp directory. No workspace analysis
 * runs here, so nothing is looked up under an unvalidated declared root.
 */
async function resolveSpoolRoot(
  deps: ProtocolHandlerDependencies,
): Promise<string> {
  const known = knownWorkspaceFolders(deps);
  const declared = getCallerWorkspaceRoot();
  if (declared !== undefined && declared.trim() !== '') {
    const match = await findKnownWorkspaceFolder(declared, known);
    if (match !== undefined) {
      return match;
    }
  }
  return known[0] ?? os.tmpdir();
}

/** The host's open workspace folders; none (logged) when the provider is absent or fails. */
function knownWorkspaceFolders(deps: ProtocolHandlerDependencies): string[] {
  try {
    return (deps.workspaceProvider?.getWorkspaceFolders() ?? []).filter(
      (folder) => typeof folder === 'string' && folder.trim() !== '',
    );
  } catch (error: unknown) {
    // degradation-audit: reported — the provider failure is logged at warn
    // here; the result is still spooled, under the system temp directory.
    // The message is fixed text: provider errors can carry paths.
    void error;
    runObserver(() =>
      deps.logger.warn(
        '[MCP] workspace provider failed; spooling under the system temp directory',
        'CodeExecutionMCP',
      ),
    );
    return [];
  }
}

/**
 * The entry of `known` that `declared` names, compared canonically
 * ({@link canonicalFolderKey}); `undefined` when it names none. Equality, not
 * containment: the spool root must be a folder the host itself recorded.
 */
async function findKnownWorkspaceFolder(
  declared: string,
  known: readonly string[],
): Promise<string | undefined> {
  const plain = stripExtendedLengthPrefix(declared);
  if (known.length === 0 || !path.isAbsolute(plain)) {
    return undefined;
  }
  const target = await canonicalFolderKey(plain);
  for (const folder of known) {
    if ((await canonicalFolderKey(folder)) === target) {
      return folder;
    }
  }
  return undefined;
}

/**
 * A comparison key for a folder path: the win32 extended-length prefix
 * removed ({@link stripExtendedLengthPrefix}), `path.resolve` (collapses
 * `..`), then `realpath` where the folder exists (follows links and
 * junctions, so a link under a known folder keys as its target), trailing
 * separators stripped, case folded on win32. A UNC path is never passed to
 * `realpath`: touching a caller-named network share would itself be the
 * side effect this check exists to prevent, so UNC paths compare lexically.
 */
async function canonicalFolderKey(folder: string): Promise<string> {
  let resolved = path.resolve(stripExtendedLengthPrefix(folder));
  if (!isUncPath(resolved)) {
    try {
      resolved = stripExtendedLengthPrefix(
        await fs.promises.realpath(resolved),
      );
    } catch {
      // Does not exist (yet): the lexical form is the key.
    }
  }
  const trimmed = resolved.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * `p` without a win32 extended-length / device prefix: `\\?\D:\x` (or
 * `\\.\D:\x`) is the local path `D:\x`; `\\?\UNC\server\share` is the UNC
 * path `\\server\share`. Any other path is returned unchanged.
 */
function stripExtendedLengthPrefix(p: string): string {
  const unc = /^[\\/]{2}[?.][\\/]UNC[\\/]/i.exec(p);
  if (unc !== null) {
    return `\\\\${p.slice(unc[0].length)}`;
  }
  const local = /^[\\/]{2}[?.][\\/](?=[A-Za-z]:)/.exec(p);
  return local === null ? p : p.slice(local[0].length);
}

/** Whether `p` is a UNC (`\\server\share`) or `//server/share` path. */
function isUncPath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

/**
 * The budget helper reports a throwing reducer or a failed budget step as one
 * line on an output channel; here that line goes to the logger at `warn` (it
 * is rare and means a reducer is broken, not a per-call event).
 */
function budgetOutputChannel(logger: Logger): IOutputChannel {
  const write = (line: string): void => {
    logger.warn(line, 'CodeExecutionMCP');
  };
  return {
    name: 'CodeExecutionMCP',
    appendLine: write,
    append: write,
    clear: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  };
}

/**
 * Run a logging or result-notification observer so that its failure can never
 * replace the response it observes (TASK_2026_538 review F3): a committed
 * surface write must keep its revision and "do not resend" guidance even when
 * the output channel or transcript callback throws.
 */
function runObserver(observe: () => void): void {
  try {
    observe();
  } catch (error: unknown) {
    // Dropped on purpose: the observer failed, the tool result did not, and
    // there is no other channel to report it on without the same risk.
    void error;
  }
}

/**
 * Handle execute_code tool call
 *
 * Per MCP spec, tool execution errors are returned as successful responses
 * with isError: true content, not as JSON-RPC error objects.
 */
async function handleExecuteCodeCall(
  request: MCPRequest,
  params: ExecuteCodeParams,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse> {
  const { code, timeout = 15000 } = params;
  const { ptahAPI, logger } = deps;
  const actualTimeout = Math.min(timeout, 30000);

  let textResult: string;
  try {
    const result = await executeCode(code, actualTimeout, { ptahAPI, logger });
    textResult = serializeResult(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof Error && error.stack) {
      runObserver(() => logger.error('Code execution failed', error));
    }
    const agentMessage = buildAgentFriendlyError(errorMessage);
    // Observers only: a throwing callback must not replace this actionable error.
    runObserver(() =>
      deps.onToolResult?.(request.id.toString(), agentMessage, true),
    );
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: agentMessage,
          },
        ],
        isError: true,
      },
    };
  }
  // Budgeted like every other text result: `serializeResult`'s own 50 KB cap
  // is far above the default budget, so without this an `execute_code` result
  // was the one text path that could still flood the context.
  return await createToolSuccessResponse(request, textResult, deps);
}

/**
 * Build agent-friendly error message with recovery hints.
 * Removes raw stack traces and adds actionable guidance.
 *
 * The runtime proxy now includes available methods directly in TypeError messages,
 * so "is not available" errors from the proxy are already actionable.
 */
function buildAgentFriendlyError(errorMessage: string): string {
  if (errorMessage.includes('Execution timeout')) {
    return `${errorMessage}. Try breaking the operation into smaller steps or increasing the timeout parameter.`;
  }
  if (errorMessage.includes('File not found:')) {
    const filePath = errorMessage.split('File not found:')[1]?.trim() || '';
    return `File not found: ${filePath}

SOLUTION: Don't guess file paths. Use discovery methods first:
1. Use ptah.search.findFiles('**/*.ts') to find files by pattern
2. Use ptah.files.list('directory') to list directory contents
3. Use ptah.workspace.analyze() to understand project structure

Example:
  const tsFiles = await ptah.search.findFiles('**/*.ts', 100);
  const packageFiles = tsFiles.filter(f => f.includes('package'));`;
  }
  if (errorMessage.includes('Directory not found:')) {
    return `${errorMessage}

SOLUTION: Use ptah.workspace.analyze() to see project structure, then ptah.files.list() to explore directories.`;
  }
  if (errorMessage.includes('is not available. Available')) {
    return `API Error: ${errorMessage}`;
  }
  if (errorMessage.includes('namespace does not exist. Available')) {
    return `API Error: ${errorMessage}`;
  }

  if (
    errorMessage.includes('is not a function') ||
    errorMessage.includes('is not defined')
  ) {
    return `${errorMessage}. Use ptah.help('namespace') to see available methods. Common mistakes: ptah.files is read-only (no write/delete), use ptah.project.detectMonorepo() not getMonorepoInfo().`;
  }
  if (errorMessage.includes('Cannot read properties of')) {
    return `${errorMessage}. A method returned null/undefined. Use optional chaining (?.) or check the return value before accessing properties.`;
  }
  return `Code execution failed: ${errorMessage}. Try wrapping in try-catch for more details.`;
}

/**
 * Create a JSON-RPC error response
 */
function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: string,
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data && { data }),
    },
  };
}

/**
 * Normalize a tool-supplied file path for the sandboxed `files.read` primitive,
 * which accepts workspace-relative paths only. An absolute path inside the
 * workspace is rewritten to its relative form; a relative path or any path that
 * escapes the workspace is returned unchanged (and rejected by the sandbox if it
 * escapes). Lets read-only tools accept either an absolute or relative path.
 */
async function toWorkspaceReadPath(
  file: string,
  ptahAPI: PtahAPI,
): Promise<string> {
  const isAbsolute =
    file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.startsWith('\\\\');
  if (!isAbsolute) {
    return file;
  }
  const info = await ptahAPI.workspace.getInfo();
  const workspaceRoot = info?.path;
  if (!workspaceRoot) {
    return file;
  }
  const relative = path.relative(workspaceRoot, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : file;
}

/**
 * Resolve the screenshot file path from the saveTo parameter.
 * - Absolute paths are used as-is.
 * - Relative paths / filenames are placed under {workspace}/.ptah/screenshots/
 * - If no extension, the format is appended.
 */
async function resolveScreenshotPath(
  saveTo: string,
  format: string,
  ptahAPI: PtahAPI,
): Promise<string> {
  let filePath = saveTo.trim();

  const ext = path.extname(filePath);
  if (!ext) {
    filePath = `${filePath}.${format}`;
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  const info = await ptahAPI.workspace.getInfo();
  const workspaceRoot = info?.path;

  return path.join(
    workspaceRoot || process.cwd(),
    '.ptah',
    'screenshots',
    filePath,
  );
}
