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
import {
  compactCoverage,
  type CompactCoverage,
  type IOutputChannel,
  type IWorkspaceProvider,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import type {
  CliDetectionResult,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';
import { formatAstAnalysisResult } from '@ptah-extension/workspace-intelligence';
import {
  countTokensPiecewise,
  fitsBudget,
  reduceOutput,
  type CodeOutliner,
  type ContentKind,
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
import {
  AgentWaitArgsSchema,
  HTTP_MAX_AGENT_WAIT_SEC,
  RunCheckArgsSchema,
  RunCheckWaitArgsSchema,
} from './wait-tools-args.schema';
import {
  AGENT_WAIT_TOOL_NAME,
  buildAgentWaitTool,
  runAgentWait,
} from './agent-wait.tool';
import {
  RUN_CHECK_TOOL_NAME,
  buildRunCheckTool,
  formatRunCheckRunning,
  runCheck,
} from './run-check.tool';
import { runCheckJobs, type RunCheckJob } from './run-check-jobs';
import {
  RUN_CHECK_WAIT_TOOL_NAME,
  buildRunCheckWaitTool,
} from './run-check-wait.tool';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type {
  PtahAPI,
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
  ExecuteCodeParams,
  ApprovalPromptParams,
  BrowserContentResult,
  GraphFileCoverage,
  GraphQueryCoverage,
  SymbolIndexPage,
} from '../types';
import { parseSymbolIndexQuery } from '../namespace-builders/symbol-index-query';
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
  buildCodeReindexTool,
  buildMemorySearchTool,
  buildRelevanceRankFilesTool,
  buildProjectDetectMonorepoTool,
  buildGetSymbolIndexTool,
  buildTaskCreateTool,
  buildTaskUpdateTool,
  buildTaskGetTool,
  buildTaskListTool,
  buildTaskCheckTool,
  SEARCH_FILES_DEFAULT_LIMIT,
  SEARCH_FILES_MAX_LIMIT,
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
import type { McpToolProfile } from '@ptah-extension/shared';
import {
  APPS_ONLY_TOOL_NAMES,
  appsOnlyToolMessage,
  resolveMcpToolProfile,
} from './mcp-tool-profile';
import {
  SESSION_LINK_TASK_TOOL_NAME,
  buildSessionLinkTaskTool,
  formatSessionLinkTaskResult,
} from './session-organization-tools';
import {
  SESSION_READ_TOOL_NAME,
  SESSION_SEND_TOOL_NAME,
  SESSION_START_TOOL_NAME,
  SESSION_STATUS_TOOL_NAME,
  SESSION_STOP_TOOL_NAME,
  buildSessionReadTool,
  buildSessionSendTool,
  buildSessionStartTool,
  buildSessionStatusTool,
  buildSessionStopTool,
} from './session-tools';
import { handleSessionToolCall } from './session-tool-handlers';
import { executeCode, serializeResult } from './code-execution.engine';
import { handleApprovalPrompt } from './approval-prompt.handler';
import { buildServerInstructions } from './server-instructions';
import {
  getCallerToolProfile,
  getCallerAgentId,
  getCallerSessionId,
  getCallerWorkspaceRoot,
  getRequestAbortSignal,
  isMcpRequestInFlight,
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
  spoolToolText,
  type SpoolOutcome,
  type ToolResultBudgetOutcome,
} from './tool-result-budget';
import { renderAgentRead } from './agent-read.view';
import { checkRepeatAgentStatus } from './agent-status-throttle';
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
import {
  formatSpawnLimitBlock,
  spawnRequestTarget,
} from './agent-limit.formatter';

/**
 * Lane limits for the agent tool text: for `rows` when given (the list
 * tool), else for a fresh roster (the spawn tool, after `agent.spawn` settled).
 * Enrichment only: any failure yields `undefined`, never a changed outcome.
 */
async function lookupAgentLimits(
  ptahAPI: PtahAPI,
  rows?: readonly CliDetectionResult[],
) {
  try {
    return await ptahAPI.agent.limits?.(rows ?? (await ptahAPI.agent.list()));
  } catch {
    // degradation-audit: optional-capability - limit fields only enrich the
    // tool result; LaneLimitLookupService logs its own lane failures, and the
    // result goes out without limits.
    return undefined;
  }
}

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
  /** Clock (epoch ms) of the `ptah_agent_status` repeat throttle. Default `Date.now`. */
  now?: () => number;
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
            callerToolProfile: resolveMcpToolProfile(request),
            signal: request._abortSignal,
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
 * - ptah_session_link_task (TASK_2026_580), beside the task tools.
 * - ptah_task_create/update/get/list/check (TASK_2026_179, step 17). These sit
 *   in the core set on purpose and have NO entry in the namespace-toggle list
 *   below: an agent that cannot rely on the task tools being present will fall
 *   back to hand-writing task metadata, which is the exact failure that makes
 *   task folders vanish from the board. There is no `set_section` tool — the
 *   carrier is machine-owned metadata, prose is agent-owned, and a
 *   section-writer would collapse that boundary.
 *
 * Apps-only profile group: ptah_dashboard_propose_spec, ptah_surface_update,
 * ptah_surface_get_state (never listed under coding).
 *
 * Namespace-toggleable tool groups (disabled via disabledMcpNamespaces):
 * - 'ide': ptah_lsp_references, ptah_lsp_definitions, ptah_get_dirty_files
 *          (also requires hasIDECapabilities === true)
 * - 'agent': ptah_agent_spawn/status/read/message/report/stop/list/wait,
 *            ptah_run_check, ptah_session_start/send/status/read/stop
 * - 'git': ptah_git_worktree_list/add/remove
 * - 'json': ptah_json_validate
 * - 'browser': all ptah_browser_* tools (12 tools)
 * - 'harness': ptah_harness_* tools
 * - 'code': ptah_ast_analyze, ptah_context_enrich_file, ptah_get_dependents,
 *           ptah_get_dependencies, ptah_get_symbol_index, ptah_code_search_symbols,
 *           ptah_code_reindex, ptah_memory_search, ptah_relevance_rank_files,
 *           ptah_project_detect_monorepo
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
  const profile = resolveMcpToolProfile(request);
  const tools = buildToolSet(resolveMcpCaller(request), profile, deps);

  markEagerTools(tools, deps, profile);
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
 * The profile keys the per-caller set: coding drops the Apps-only tools.
 * Every caller kind receives a byte-stable list within its profile, keeping
 * the order produced by buildToolDefinitions for prompt-cache stability.
 */
function buildToolSet(
  caller: McpCaller,
  profile: McpToolProfile,
  deps: Pick<
    ProtocolHandlerDependencies,
    'hasIDECapabilities' | 'disabledMcpNamespaces'
  >,
): MCPToolDefinition[] {
  const all = buildToolDefinitions(deps);
  return profile === 'apps'
    ? all
    : all.filter((tool) => !APPS_ONLY_TOOL_NAMES.has(tool.name));
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
    // Always-on beside the task tools (TASK_2026_580, D12): an agent that
    // cannot rely on it would leave its session unlinked from the task.
    buildSessionLinkTaskTool(),
    // Listed only under the apps profile (TASK_2026_595), filtered in buildToolSet.
    buildDashboardProposeSpecTool(),
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
          // Child chat sessions (TASK_2026_584): the same group, so the one
          // `agent` toggle governs every way to start delegated work.
          buildSessionStartTool(),
          buildSessionSendTool(),
          buildSessionStatusTool(),
          buildSessionReadTool(),
          buildSessionStopTool(),
          // Blocking waits (TASK_2026_597, D13): one call instead of a
          // ptah_agent_status loop, and an Nx check that blocks until it ends.
          // Both are orchestration steps, so the `agent` toggle governs them.
          buildAgentWaitTool(),
          buildRunCheckTool({ transport: 'http' }),
          buildRunCheckWaitTool(),
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
          buildCodeReindexTool(),
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

/**
 * `ptah_agent_read` arguments (TASK_2026_559 Batch 13). Not `strict()`: this
 * surface has always ignored unknown keys here. `readOutput` floors both
 * numbers, so a fraction is accepted; a string or a negative number is not,
 * where it used to be read as zero.
 */
const AgentReadArgsSchema = z.object({
  agentId: z.string().min(1),
  tail: z.number().finite().nonnegative().optional(),
  offset: z.number().finite().nonnegative().optional(),
});

/** Render a Zod failure as one readable line naming each offending field. */
function describeZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Stamp `_meta['anthropic/alwaysLoad'] = true` onto the runtime-aware eager
 * subset so the SDK loads them up front. Apps adds its three core tools.
 * Tools left untouched stay deferred.
 */
function markEagerTools(
  tools: MCPToolDefinition[],
  deps: ProtocolHandlerDependencies,
  profile: McpToolProfile,
): void {
  const eager = new Set<string>(ALWAYS_EAGER_TOOLS);
  if (profile === 'apps') {
    for (const name of APPS_ONLY_TOOL_NAMES) eager.add(name);
  }
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
  if (APPS_ONLY_TOOL_NAMES.has(name) && getCallerToolProfile() !== 'apps') {
    return toolErrorResponse(request, appsOnlyToolMessage(name));
  }
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
        // Validated here: an empty pattern used to reach the provider and
        // come back as its thrown "Patterns must be a string (non empty)".
        const { pattern, limit: rawLimit } = args as {
          pattern?: unknown;
          limit?: unknown;
        };
        if (typeof pattern !== 'string' || !pattern.trim()) {
          return missingStringArgResponse(request, 'pattern');
        }
        // The same rule the published schema states (buildSearchFilesTool).
        const limit = rawLimit ?? SEARCH_FILES_DEFAULT_LIMIT;
        if (
          typeof limit !== 'number' ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > SEARCH_FILES_MAX_LIMIT
        ) {
          return toolErrorResponse(
            request,
            `Error: "limit" must be an integer from 1 to ${SEARCH_FILES_MAX_LIMIT} (omit it for the default ${SEARCH_FILES_DEFAULT_LIMIT}).`,
          );
        }
        // One file past the limit tells a capped result apart from one that
        // matched exactly `limit` files.
        const files = await ptahAPI.search.findFiles(pattern, limit + 1);
        return await createToolSuccessResponse(
          request,
          formatSearchFiles(files.slice(0, limit), files.length > limit),
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
        // The report names its mechanism, so a host without a lookup answers
        // "not available on this host" instead of "Found: 0".
        const refs = await ptahAPI.ide.lsp.getReferencesReport(file, line, col);
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
        // `getDefinitionReport` starts the index freshness check itself (wired
        // in the API builder), as `getDefinition` does for `execute_code`.
        const defs = await ptahAPI.ide.lsp.getDefinitionReport(file, line, col);
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
          effort: spawnArgs.effort,
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
            effort: spawnArgs.effort,
          });
        } catch (error: unknown) {
          // Any other failure keeps its pre-existing path: re-thrown to the
          // generic tool error handler, with no limit lookup.
          if (
            !(error instanceof AgentRoleError) &&
            !(error instanceof CliCommandLineTooLongError)
          ) {
            throw error;
          }
          // The lane the request named, so a failed spawn shows the same
          // `Limit state` a successful spawn on that lane would (design §5.2).
          const limits = await lookupAgentLimits(ptahAPI);
          const limitBlock = limits
            ? `\n\n${formatSpawnLimitBlock(limits, spawnRequestTarget(spawnArgs), true)}`
            : '';
          if (error instanceof AgentRoleError) {
            return toolErrorResponse(
              request,
              `Error: ptah_agent_spawn role ${error.code}: ${error.message}${limitBlock}`,
            );
          }
          return toolErrorResponse(
            request,
            `Error: ptah_agent_spawn command line too long (${error.measured} against a limit of ${error.limit}): ${error.message}${limitBlock}`,
          );
        }

        logger.info('[MCP] ptah_agent_spawn result', 'CodeExecutionMCP', {
          agentId: result.agentId,
          cli: result.cli,
          status: result.status,
          cliSessionId: result.cliSessionId,
          role: result.role,
        });

        const limits = await lookupAgentLimits(ptahAPI);
        return await createToolSuccessResponse(
          request,
          formatAgentSpawn(
            result,
            { modelTier: ptahCliId ? (modelTier ?? 'sonnet') : undefined },
            limits,
          ),
          deps,
        );
      }

      case 'ptah_agent_status': {
        const { agentId } = args as { agentId?: string };
        const result = await ptahAPI.agent.status(agentId);
        return await createToolSuccessResponse(
          request,
          repeatAgentStatusLine(request, agentId, result, deps) ??
            formatAgentStatus(result),
          deps,
        );
      }

      case 'ptah_agent_read': {
        const parsed = AgentReadArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          return toolErrorResponse(
            request,
            `Error: invalid ptah_agent_read arguments — ${describeZodIssues(
              parsed.error,
            )}. Required: "agentId".`,
          );
        }
        const { agentId, tail, offset } = parsed.data;
        const result = await ptahAPI.agent.read(agentId, tail, offset);
        const view = await renderAgentRead(
          result,
          offset,
          getToolResultBudget('ptah_agent_read'),
          async (text) =>
            spoolToolText(text, await resolveSpoolRoot(deps), request.id),
        );
        return await createToolSuccessResponse(request, view.text, deps);
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
        //
        // A spawned agent (`/agent/{id}`) wins. Without one, a calling chat
        // session (`/session/{id}`) reports as a child session
        // (TASK_2026_584): the router delivers only when that session IS a
        // child started with ptah_session_start, and refuses any other
        // session itself. Neither id -> today's `unattributed-caller`.
        const callerAgentId = getCallerAgentId();
        const callerSessionId = getCallerSessionId()?.trim() || undefined;
        const { message, summary } = parsed.data;
        let reportInput: Parameters<PtahAPI['agent']['report']>[0];
        if (callerAgentId !== undefined) {
          reportInput = { agentId: callerAgentId, message, summary };
        } else if (callerSessionId !== undefined) {
          reportInput = { childSessionId: callerSessionId, message, summary };
        } else {
          return await createToolSuccessResponse(
            request,
            formatAgentReport({
              delivered: false,
              reason: 'unattributed-caller',
            }),
            deps,
          );
        }
        const delivery = await ptahAPI.agent.report(reportInput);
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
        const limits = await lookupAgentLimits(ptahAPI, agents);
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
          formatAgentList(agents, roles, limits),
          deps,
        );
      }

      case AGENT_WAIT_TOOL_NAME: {
        const parsed = AgentWaitArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          return toolErrorResponse(
            request,
            `Error: invalid ${AGENT_WAIT_TOOL_NAME} arguments — ${describeZodIssues(
              parsed.error,
            )}. Required: "agentIds".`,
          );
        }
        // The reply is self-bounded (WAIT_SUMMARY_MAX_CHARS, half the default
        // budget), so the budget step returns it unchanged.
        // A closed connection ends the wait (the lanes keep running).
        const requestedTimeoutSec = parsed.data.timeoutSec;
        const timeoutSec = Math.min(
          requestedTimeoutSec,
          HTTP_MAX_AGENT_WAIT_SEC,
        );
        const text = await runAgentWait(
          { ...parsed.data, timeoutSec },
          {
            waitForAgents: (ids, mode, timeoutMs, signal) =>
              ptahAPI.agent.waitForAgents(ids, mode, timeoutMs, signal),
            readOutput: (agentId, tail) => ptahAPI.agent.read(agentId, tail),
            signal: getRequestAbortSignal(),
            ...(timeoutSec < requestedTimeoutSec
              ? { cappedFromTimeoutSec: requestedTimeoutSec }
              : {}),
          },
        );
        return await createToolSuccessResponse(request, text, deps);
      }

      case RUN_CHECK_TOOL_NAME: {
        const parsed = RunCheckArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          return toolErrorResponse(
            request,
            `Error: invalid ${RUN_CHECK_TOOL_NAME} arguments — ${describeZodIssues(
              parsed.error,
            )}. Required: "project" and "targets".`,
          );
        }
        // The workspace root is never an argument: it is the caller's own
        // declared root, checked against the host's open folders. There is no
        // fallback folder — a check run in another tree reports a verdict for
        // code the caller never touched.
        const root = await resolveRunCheckRoot(deps);
        if ('error' in root) {
          return toolErrorResponse(request, root.error);
        }
        const ownerKey = runCheckOwnerKey(root.root);
        const started = runCheckJobs.start(
          parsed.data,
          root.root,
          ownerKey,
          (signal, onLogOpened) =>
            runCheck(parsed.data, {
              workspaceRoot: root.root,
              signal,
              onLogOpened,
            }),
        );
        if ('busy' in started) {
          return toolErrorResponse(
            request,
            formatRunCheckBusy(started.busy, started.external),
          );
        }
        // A closed HTTP connection ends only this collection wait. The job
        // owns its controller and keeps the process tree alive for a retry.
        const outcome = await runCheckJobs.waitFor(
          started.job,
          HTTP_MAX_AGENT_WAIT_SEC * 1000,
          getRequestAbortSignal(),
        );
        if (outcome !== undefined) {
          const response = outcome.isError
            ? toolErrorResponse(request, outcome.text)
            : await createToolSuccessResponse(request, outcome.text, deps);
          attachStructuredContent(response, outcome.structured);
          return response;
        }
        return await runCheckRunningResponse(request, started.job, deps);
      }

      case RUN_CHECK_WAIT_TOOL_NAME: {
        const parsed = RunCheckWaitArgsSchema.safeParse(
          args !== null && typeof args === 'object' ? args : {},
        );
        if (!parsed.success) {
          return toolErrorResponse(
            request,
            `Error: invalid ${RUN_CHECK_WAIT_TOOL_NAME} arguments — ${describeZodIssues(parsed.error)}. Required: "jobId".`,
          );
        }
        // Do not expose why a root could not be resolved: lookup denial must
        // be indistinguishable from a missing or another caller's job id.
        const root = await resolveRunCheckRoot(deps);
        if ('error' in root) return unknownRunCheckJobResponse(request);
        const job = runCheckJobs.get(
          parsed.data.jobId,
          runCheckOwnerKey(root.root),
        );
        if (job === undefined) return unknownRunCheckJobResponse(request);
        if (parsed.data.cancel) runCheckJobs.cancel(job);
        const requestedTimeoutSec = parsed.data.timeoutSec;
        const timeoutSec = Math.min(
          requestedTimeoutSec,
          HTTP_MAX_AGENT_WAIT_SEC,
        );
        const outcome = await runCheckJobs.waitFor(
          job,
          timeoutSec * 1000,
          getRequestAbortSignal(),
        );
        if (outcome !== undefined) {
          const response = outcome.isError
            ? toolErrorResponse(request, outcome.text)
            : await createToolSuccessResponse(request, outcome.text, deps);
          attachStructuredContent(response, outcome.structured);
          return response;
        }
        return await runCheckRunningResponse(
          request,
          job,
          deps,
          timeoutSec < requestedTimeoutSec ? requestedTimeoutSec : undefined,
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
        // No format given: a saveTo extension names it, so the bytes match the
        // file name; otherwise the namespace default (jpeg) applies.
        const screenshotResult = await ptahAPI.browser.screenshot({
          format: format ?? screenshotFormatForPath(saveTo),
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

          const captured = `Screenshot captured (${screenshotResult.format}, ~${Math.round((screenshotResult.data.length * 3) / 4 / 1024)}KB)`;
          // The transcript gets a bounded one-line summary, not a second copy
          // of the image; the response caption keeps the full saved path.
          runObserver(() =>
            deps.onToolResult?.(
              request.id.toString(),
              screenshotTranscriptSummary(captured, screenshotResult.filePath),
              false,
            ),
          );

          const savedNote = screenshotResult.filePath
            ? ` | Saved to: ${screenshotResult.filePath}`
            : '';
          // Only the text block is budgeted; the image block goes out as is.
          const caption = await budgetToolText(
            request,
            `${captured}${savedNote}`,
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
          await formatBrowserEvaluate(
            evalResult,
            getToolResultBudget(name),
            async (text) =>
              spoolToolText(text, await resolveSpoolRoot(deps), request.id),
          ),
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
        return await createBrowserContentResponse(request, contentResult, deps);
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

      // Child chat sessions (TASK_2026_584). The caller is the transport's
      // session id, read by the namespace from the request context; the
      // arguments never carry it.
      case SESSION_START_TOOL_NAME:
      case SESSION_SEND_TOOL_NAME:
      case SESSION_STATUS_TOOL_NAME:
      case SESSION_READ_TOOL_NAME:
      case SESSION_STOP_TOOL_NAME: {
        const reply = await handleSessionToolCall(
          name,
          args,
          ptahAPI.session,
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
        // Records as tables: the lossless form that meets the promised token saving.
        return await createToolSuccessResponse(
          request,
          formatAstAnalysisResult(withCompactCoverage(result)),
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
        // A file the graph can never hold is answered as such, not as an
        // empty list, and needs no graph build.
        const unsupported = ptahAPI.dependencies.unsupportedGraphLanguage(
          file.trim(),
        );
        if (unsupported !== undefined) {
          return await createToolSuccessResponse(
            request,
            JSON.stringify({ ...unsupported, file: file.trim() }),
            deps,
          );
        }
        const readiness = await ensureDependencyGraph(ptahAPI, deps);
        if (readiness.state !== 'ready') {
          return await graphNotReadyResponse(request, readiness, deps);
        }
        const resolvedFile = await resolveDependencyQueryPath(
          ptahAPI,
          file.trim(),
        );
        // Both read the graph service when invoked, in the same turn, so the
        // coverage is that of the graph which answered (not the session's).
        const [dependents, fileCoverage] = await Promise.all([
          ptahAPI.dependencies.getDependents(resolvedFile),
          ptahAPI.dependencies.getGraphCoverageForFile(resolvedFile),
        ]);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(
            graphFileAnswer(resolvedFile, fileCoverage, {
              dependents,
            }),
          ),
          deps,
        );
      }

      case 'ptah_get_dependencies': {
        const { file, depth } = args as { file: string; depth?: number };
        if (!file || typeof file !== 'string' || !file.trim()) {
          return missingStringArgResponse(request, 'file');
        }
        // As in ptah_get_dependents.
        const unsupported = ptahAPI.dependencies.unsupportedGraphLanguage(
          file.trim(),
        );
        if (unsupported !== undefined) {
          return await createToolSuccessResponse(
            request,
            JSON.stringify({ ...unsupported, file: file.trim() }),
            deps,
          );
        }
        const readiness = await ensureDependencyGraph(ptahAPI, deps);
        if (readiness.state !== 'ready') {
          return await graphNotReadyResponse(request, readiness, deps);
        }
        const resolvedFile = await resolveDependencyQueryPath(
          ptahAPI,
          file.trim(),
        );
        // Same graph for answer and coverage, as in ptah_get_dependents.
        const [dependencies, fileCoverage] = await Promise.all([
          ptahAPI.dependencies.getDependencies(resolvedFile, depth),
          ptahAPI.dependencies.getGraphCoverageForFile(resolvedFile),
        ]);
        return await createToolSuccessResponse(
          request,
          JSON.stringify(
            graphFileAnswer(resolvedFile, fileCoverage, {
              dependencies,
            }),
          ),
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
        // `searchSymbols` runs `ensureIndexFresh` itself (so `execute_code`
        // callers get it too) and returns its outcome as `index`; a second
        // call here would read freshness twice and report `reindexStarted`
        // from the call that did not start the run.
        const result = await ptahAPI.code.searchSymbols(query.trim(), {
          maxResults,
          filePath,
        });
        return await createToolSuccessResponse(
          request,
          JSON.stringify(
            'coverage' in result ? withCompactCoverage(result) : result,
          ),
          deps,
        );
      }

      case 'ptah_code_reindex': {
        if (!ptahAPI.code) {
          return toolErrorResponse(
            request,
            JSON.stringify({
              error: 'Code symbol index not available on this runtime.',
            }),
          );
        }
        const { filePath } = args as { filePath?: unknown };
        if (
          filePath !== undefined &&
          (typeof filePath !== 'string' || !path.isAbsolute(filePath.trim()))
        ) {
          return toolErrorResponse(
            request,
            'Error: "filePath" must be an absolute file path when provided.',
          );
        }
        const result = await ptahAPI.code.reindex(
          filePath === undefined ? {} : { filePath: filePath.trim() },
        );
        if ('error' in result) {
          return toolErrorResponse(request, JSON.stringify(result));
        }
        return await createToolSuccessResponse(
          request,
          JSON.stringify(
            'coverage' in result ? withCompactCoverage(result) : result,
          ),
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
        // Validate before the graph build: a cold build can take minutes.
        const parsed = parseSymbolIndexQuery(args);
        if (!parsed.ok) {
          return toolErrorResponse(request, `Error: ${parsed.error}`);
        }
        const readiness = await ensureDependencyGraph(ptahAPI, deps);
        if (readiness.state !== 'ready') {
          return await graphNotReadyResponse(request, readiness, deps);
        }
        const page = await ptahAPI.dependencies.getSymbolIndex(
          undefined,
          parsed.query,
        );
        // The index has no root (the merged index), so neither has its
        // coverage: every graph's, merged.
        const graphCoverage =
          await ptahAPI.dependencies.getGraphCoverage(undefined);
        return await createToolSuccessResponse(
          request,
          await renderSymbolIndexPage(
            page,
            getToolResultBudget(name),
            {
              ...graphCompleteness(graphCoverage),
              coverage: compactCoverage(graphCoverage.coverage),
            },
            async (text) =>
              spoolToolText(text, await resolveSpoolRoot(deps), request.id),
          ),
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
        // The page holds only whole rows that pass this tool's result budget
        // unchanged, so the budget step never cuts inside a row while
        // `nextCursor` points past it.
        const budget = getToolResultBudget(name);
        const result = await ptahAPI.tasks.list(args, {
          fits: (text) => fitsBudget(text, budget),
        });
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

      // -- Session organization (TASK_2026_580, D12) ----------------------
      //
      // The namespace validates the args and resolves the CALLER from the
      // request context, never from args. A refusal is data, as with the task
      // tools. `link-failed` carries the recorder's own message, which is
      // logged here and replaced by fixed text for the agent.
      case SESSION_LINK_TASK_TOOL_NAME: {
        const result = ptahAPI.sessionOrganization.linkTask(args);
        if (!result.ok && result.error === 'link-failed') {
          runObserver(() =>
            logger.warn(
              '[MCP] ptah_session_link_task: the recorder threw',
              'CodeExecutionMCP',
              { message: result.message },
            ),
          );
        }
        return await createToolSuccessResponse(
          request,
          formatSessionLinkTaskResult(result),
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
 * The HTTP wording of the repeat-status short answer, or `null` for the full
 * body (policy in {@link checkRepeatAgentStatus}). HTTP callers are the Ptah
 * sessions and lanes that receive `<agent-lane-completed>`.
 */
function repeatAgentStatusLine(
  request: MCPRequest,
  agentId: unknown,
  result: Awaited<ReturnType<PtahAPI['agent']['status']>>,
  deps: ProtocolHandlerDependencies,
): string | null {
  const unchanged = checkRepeatAgentStatus(
    deps.ptahAPI,
    resolveMcpCaller(request),
    agentId,
    result,
    (deps.now ?? Date.now)(),
  );
  return unchanged === null
    ? null
    : `Status unchanged since ${unchanged.since} (${unchanged.status}). ` +
        'Wait for <agent-lane-completed> instead of polling.';
}

/**
 * Longest a dependency tool waits on a graph build before it answers
 * `building`. A small workspace builds inside it and is answered on the first
 * call; a large one (225 s measured on this repository, TASK_2026_559 Task
 * 9.2) can never hold the call near a client's tool timeout.
 */
const GRAPH_BUILD_WAIT_MS = 1_500;

/** The retry hint a `building` answer carries. */
const GRAPH_BUILD_RETRY_AFTER_MS = 15_000;

/** One background graph build for one read root. */
interface GraphBuildJob {
  /** Settles when the build ends, however it ends; never rejects. */
  settled: Promise<void>;
  /**
   * The build generation reserved for this job before discovery. When it is
   * no longer the root's (an eviction, or a later build), the job is obsolete.
   */
  readonly generation: number;
  /** Source files discovery found, once discovery has run. */
  filesDiscovered?: number;
  /** Set when the build ended, however it ended. */
  done: boolean;
  /** Set when the build failed (not when it was superseded). */
  failed: boolean;
  /** Set once a call answered `ready` from this job's result. */
  delivered: boolean;
}

/**
 * The in-flight latch of one `PtahAPI` (one MCP server), keyed by the
 * normalized read root: concurrent cold calls share one build.
 */
interface GraphBuildLatch {
  readonly jobs: Map<string, GraphBuildJob>;
  /**
   * Roots whose last build failed and whose failure no call has reported yet,
   * with that build. The next call reports it and clears it (unless the build
   * was superseded since); the call after that rebuilds.
   */
  readonly failed: Map<string, GraphBuildJob>;
  /**
   * Roots whose last background build published an empty graph (discovery
   * found no source file), with that build. While no call has received it
   * and its generation is still the root's, the next call answers it; after
   * that each call rediscovers the root, and the snapshot answers only once
   * that rediscovery confirmed it, so a source file added since is not
   * hidden behind it.
   */
  readonly empty: Map<string, GraphBuildJob>;
}

/** Weak: a latch lives exactly as long as the `PtahAPI` it serves. */
const graphBuildLatches = new WeakMap<PtahAPI, GraphBuildLatch>();

/** Whether a dependency tool may answer now, and if not, why. */
type GraphReadiness =
  | { state: 'ready' }
  | { state: 'building'; filesDiscovered?: number }
  | { state: 'failed' };

/**
 * Make sure the workspace import graph is built or being built, without ever
 * holding the call longer than {@link GRAPH_BUILD_WAIT_MS}.
 *
 * The root is the caller-aware read root every other read tool uses
 * (`ptah.workspace.getInfo()`: declared root, then caller session, active
 * session, host folder), so an agent in a worktree the host did not open
 * gets that worktree's graph. Discovery and relative queries resolve against
 * the same root; spool writes keep their own host-owned rule.
 *
 * - A built graph answers at once (`ready`), as before.
 * - Otherwise one background build per root is started (the latch is set
 *   before this yields, so a concurrent call joins it), and this waits up to
 *   the bound for it: `ready` if it finished, else `building`.
 * - A job whose generation an eviction or a later build superseded is
 *   dropped at once, so it can neither hold the latch nor report its outcome;
 *   a call that was waiting on it is answered from the current state.
 * - A build that failed is reported once (`failed`) and its latch is already
 *   clear, so the next call starts a new build.
 * - An empty graph (no source files) answers only once a rediscovery by this
 *   call's refresh confirmed it; while that refresh or another build is
 *   pending the call is `building`, so the first source file added is found.
 *   An empty build that finished after its callers' wait is answered once,
 *   to the next call, while its generation is still the root's.
 * - No workspace open: `ready`, and the tool answers from whatever graph
 *   exists, as before.
 */
async function ensureDependencyGraph(
  ptahAPI: PtahAPI,
  deps: ProtocolHandlerDependencies,
): Promise<GraphReadiness> {
  const info = await ptahAPI.workspace.getInfo();
  const root = info?.path;
  if (!root) return { state: 'ready' };
  const key = graphRootKey(root);
  const latch = graphBuildLatchFor(ptahAPI);
  // Guard on THIS workspace's graph so a second open workspace still builds its
  // own graph rather than reusing the first workspace's cached result.
  const built = await ptahAPI.dependencies.isBuilt(root);
  const emptySnapshot =
    built && (await isEmptyGraphSnapshot(ptahAPI, latch, key, root));
  if (built && !emptySnapshot) {
    // A graph published after a failure (an explicit rebuild) supersedes it.
    latch.failed.delete(key);
    return { state: 'ready' };
  }
  const buildState = ptahAPI.dependencies.getGraphBuildState(root);
  // An empty build that finished after its callers stopped waiting: deliver
  // it once, while nothing superseded or is replacing it; the call after this
  // one rediscovers.
  const emptyJob = emptySnapshot ? latch.empty.get(key) : undefined;
  if (
    emptyJob !== undefined &&
    !emptyJob.delivered &&
    emptyJob.generation === buildState.generation &&
    !buildState.building &&
    !latch.jobs.has(key)
  ) {
    emptyJob.delivered = true;
    return { state: 'ready' };
  }
  // A failure that ended before this call arrived: report it, once, unless an
  // eviction or a later build superseded that build since.
  const failedJob = latch.failed.get(key);
  if (failedJob !== undefined) {
    latch.failed.delete(key);
    if (failedJob.generation === buildState.generation) {
      return { state: 'failed' };
    }
  }
  let job = latch.jobs.get(key);
  if (job !== undefined && job.generation !== buildState.generation) {
    // Obsolete: its root was evicted or rebuilt. Dropped now, it cannot hold
    // the latch while its I/O is stuck, and its late outcome touches nothing.
    latch.jobs.delete(key);
    job = undefined;
  }
  if (job === undefined) {
    if (buildState.building) {
      // The root's current build is someone else's (an awaited
      // `ptah.dependencies.buildGraph`): a new job would supersede it. An
      // empty snapshot does not answer either: that build may replace it.
      return { state: 'building' };
    }
    job = startGraphBuild(ptahAPI, latch, key, root, deps.logger);
  }
  await settledWithin(job.settled, GRAPH_BUILD_WAIT_MS);
  if (
    ptahAPI.dependencies.getGraphBuildState(root).generation !== job.generation
  ) {
    // An eviction or a later build superseded the job while this call
    // waited: its outcome says nothing about the current graph.
    return await currentGraphReadiness(ptahAPI, latch, key, root);
  }
  if (job.failed) {
    // Every call that waited on this build reports its failure; it is not
    // reported again to a later call, which rebuilds instead.
    if (latch.failed.get(key) === job) latch.failed.delete(key);
    return { state: 'failed' };
  }
  // The empty snapshot answers only once this refresh confirmed it: its
  // discovery found no file. While discovery is pending, or the files it
  // found are still parsing, the call is `building`, as a first build is.
  const refreshing = emptySnapshot && !job.done && job.filesDiscovered !== 0;
  if (!refreshing && (await ptahAPI.dependencies.isBuilt(root))) {
    // This call received the job's result; a later call rediscovers.
    job.delivered = true;
    return { state: 'ready' };
  }
  // Still running, or it ended without publishing (a later build or an
  // eviction overtook it): not ready, and the next call starts over.
  return job.filesDiscovered === undefined
    ? { state: 'building' }
    : { state: 'building', filesDiscovered: job.filesDiscovered };
}

/**
 * The readiness of `root` for a call whose job was superseded while it
 * waited, decided by the current state without a second wait: a built graph
 * answers, unless it is the empty snapshot and a build or a job of the
 * current generation may still replace it; no graph is `building` (the next
 * call starts over).
 */
async function currentGraphReadiness(
  ptahAPI: PtahAPI,
  latch: GraphBuildLatch,
  key: string,
  root: string,
): Promise<GraphReadiness> {
  if (!(await ptahAPI.dependencies.isBuilt(root))) return { state: 'building' };
  if (!(await isEmptyGraphSnapshot(ptahAPI, latch, key, root))) {
    return { state: 'ready' };
  }
  const current = ptahAPI.dependencies.getGraphBuildState(root);
  const currentJob = latch.jobs.get(key);
  const replacementPending =
    current.building ||
    (currentJob !== undefined &&
      currentJob.generation === current.generation &&
      !currentJob.done);
  return replacementPending ? { state: 'building' } : { state: 'ready' };
}

/** The latch of `ptahAPI`, created on first use. */
function graphBuildLatchFor(ptahAPI: PtahAPI): GraphBuildLatch {
  let latch = graphBuildLatches.get(ptahAPI);
  if (latch === undefined) {
    latch = { jobs: new Map(), failed: new Map(), empty: new Map() };
    graphBuildLatches.set(ptahAPI, latch);
  }
  return latch;
}

/**
 * A root's latch key, normalized as the graph service keys its graphs
 * (forward slashes, no trailing slash): `D:\ws` and `D:/ws/` share one job.
 */
function graphRootKey(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Whether the root's built graph is the empty one a background build of this
 * latch published and nothing has replaced since.
 */
async function isEmptyGraphSnapshot(
  ptahAPI: PtahAPI,
  latch: GraphBuildLatch,
  key: string,
  root: string,
): Promise<boolean> {
  if (!latch.empty.has(key)) return false;
  const coverage = await ptahAPI.dependencies.getGraphCoverage(root);
  if (coverage !== undefined && coverage.discoveredFiles === 0) return true;
  // An explicit build published files since: that graph answers.
  latch.empty.delete(key);
  return false;
}

/** Resolve on a later macrotask, after the caller's own timers are armed. */
function nextMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Start the build for `root` without awaiting it. Its generation is reserved
 * now, before discovery, so an eviction or a later build during discovery
 * already supersedes it. The work itself starts on a later macrotask, after
 * the calling tool has armed its bounded wait. The job is in the latch before
 * this returns; it leaves the latch when the build settles, after its outcome
 * is recorded, so no call ever sees neither. An outcome is recorded only while
 * the job is still the latch's, so an obsolete job never touches its
 * replacement's state. The chain never rejects.
 */
function startGraphBuild(
  ptahAPI: PtahAPI,
  latch: GraphBuildLatch,
  key: string,
  root: string,
  logger: Logger,
): GraphBuildJob {
  const job: GraphBuildJob = {
    settled: Promise.resolve(),
    generation: ptahAPI.dependencies.reserveGraphBuild(root),
    done: false,
    failed: false,
    delivered: false,
  };
  const isLatched = (): boolean => latch.jobs.get(key) === job;
  job.settled = nextMacrotask()
    .then(() => buildDependencyGraph(ptahAPI, root, job))
    .then((publishedFiles) => {
      if (publishedFiles === undefined || !isLatched()) return;
      if (publishedFiles === 0) latch.empty.set(key, job);
      else latch.empty.delete(key);
    })
    .catch((error: unknown) => {
      // degradation-audit: reported — a failed background build is recorded
      // and every call that waits on it, or the next one, answers an explicit
      // `failed` status, never an empty result; logged at warn with fixed text
      // (build errors can carry paths), so only the error name is kept. A
      // superseded job's failure is not recorded: a newer build owns the
      // root. (The generation read is a synchronous map lookup.)
      if (
        ptahAPI.dependencies.getGraphBuildState(root).generation ===
        job.generation
      ) {
        job.failed = true;
        if (isLatched()) latch.failed.set(key, job);
      }
      const errorName = error instanceof Error ? error.name : typeof error;
      runObserver(() =>
        logger.warn(
          '[MCP] background dependency-graph build failed',
          'CodeExecutionMCP',
          { errorName },
        ),
      );
    })
    .finally(() => {
      job.done = true;
      if (isLatched()) latch.jobs.delete(key);
    });
  latch.jobs.set(key, job);
  return job;
}

/**
 * Discover the workspace's source files and build their import graph under
 * `root` with the job's reserved generation, yielding to the host between
 * files. Resolves with the number of files discovered when the graph was
 * published, or `undefined` when the job was superseded (during discovery it
 * does not build at all). Rejects when the build reports an error. No files
 * builds an empty graph, which answers "nothing imports it" until a call
 * rediscovers the root.
 */
async function buildDependencyGraph(
  ptahAPI: PtahAPI,
  root: string,
  job: GraphBuildJob,
): Promise<number | undefined> {
  // Bounded, vendor trees excluded inside the walk; every recognised source
  // file, so the graph's coverage counts what it cannot analyse.
  const discovery = await ptahAPI.dependencies.discoverSourceFiles(root);
  const discovered = discovery.files.length;
  job.filesDiscovered = discovered;
  const isCurrent = (): boolean =>
    ptahAPI.dependencies.getGraphBuildState(root).generation === job.generation;
  // Evicted or rebuilt while discovering: this list must not become the graph.
  if (!isCurrent()) return undefined;
  // Every discovered file goes to the build: its own parse cap chooses the
  // graph-capable files fairly across languages and counts the rest.
  const result = await ptahAPI.dependencies.buildGraph(
    discovery.files,
    root,
    discovered,
    {
      yieldToForeground: true,
      generation: job.generation,
      ...(discovery.truncated ? { censusLimit: discovery.limit } : {}),
      // Part of the tree was unreadable: an unknown census, never clean.
      ...(discovery.unreadable === undefined ? {} : { censusUnknown: true }),
    },
  );
  if (result.error !== undefined) {
    // Fixed text: the namespace's message can carry a path.
    throw new Error('The dependency graph build reported an error.');
  }
  return isCurrent() ? discovered : undefined;
}

/** Wait for `settled`, but never longer than `ms`. */
async function settledWithin(
  settled: Promise<void>,
  ms: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The answer of a dependency tool whose graph is not ready. Status fields
 * first and no unbounded field, so the answer is small and survives any cut.
 * `building` is a successful answer with a retry hint; `failed` is a tool
 * error, never an empty result.
 */
async function graphNotReadyResponse(
  request: MCPRequest,
  readiness: Exclude<GraphReadiness, { state: 'ready' }>,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse> {
  switch (readiness.state) {
    case 'building':
      return await createToolSuccessResponse(
        request,
        JSON.stringify({
          status: 'building',
          retryAfterMs: GRAPH_BUILD_RETRY_AFTER_MS,
          ...(readiness.filesDiscovered === undefined
            ? {}
            : { filesDiscovered: readiness.filesDiscovered }),
          message:
            'The workspace dependency graph is being built in the background. Call this tool again after retryAfterMs; use Grep or ptah_search_files meanwhile.',
        }),
        deps,
      );
    case 'failed':
      return toolErrorResponse(
        request,
        JSON.stringify({
          status: 'failed',
          error:
            'The workspace dependency graph build failed. Call this tool again to start a new build.',
        }),
      );
  }
}

/**
 * The fields a dependency-tool result adds when its graph was built from
 * fewer files than were discovered (the file cap dropped some): an empty
 * answer may then be a file the graph never saw. Nothing when complete.
 */
function graphCompleteness(
  coverage: GraphQueryCoverage,
):
  | { incomplete: true; graphedFiles: number; discoveredFiles: number }
  | Record<string, never> {
  const { graphedFiles, discoveredFiles } = coverage;
  if (
    graphedFiles === undefined ||
    discoveredFiles === undefined ||
    discoveredFiles <= graphedFiles
  ) {
    return {};
  }
  return { incomplete: true, graphedFiles, discoveredFiles };
}

/**
 * The answer of `ptah_get_dependents` / `ptah_get_dependencies`. Field order
 * is the budget order (Decision 15, Batch 22): `count`, the Batch 9 cap
 * fields, `fileInGraph`, the graph's `coverage` (verdict first), and only
 * then the unbounded `file` and list, so a cut keeps every status field.
 * `fileInGraph: false` says the answering graph holds no node for the file,
 * so an empty list is not "nothing imports it". `file` is the graph's own
 * spelling of the file when it holds it.
 */
function graphFileAnswer(
  resolvedFile: string,
  fileCoverage: GraphFileCoverage,
  list: { dependents: string[] } | { dependencies: string[] },
): object {
  const items = 'dependents' in list ? list.dependents : list.dependencies;
  return {
    count: items.length,
    ...graphCompleteness(fileCoverage),
    fileInGraph: fileCoverage.nodePath !== undefined,
    coverage: compactCoverage(fileCoverage.coverage),
    file: fileCoverage.nodePath ?? resolvedFile,
    ...list,
  };
}

/**
 * A tool result with its `coverage` block in the compact wire form (Batch
 * 22c, {@link compactCoverage}). The key keeps its place, so the budget
 * order is unchanged.
 */
function withCompactCoverage<T extends { coverage: LanguageCoverage }>(
  result: T,
): Omit<T, 'coverage'> & { coverage: CompactCoverage } {
  return { ...result, coverage: compactCoverage(result.coverage) };
}

/**
 * A symbol-index file whose entry alone is over the result budget: its first
 * symbols, how many it has, and where the whole entry was saved (or why it
 * could not be).
 */
interface OversizedSymbolIndexEntry {
  file: string;
  symbols: string[];
  symbolCount: number;
  truncated: true;
  symbolsFile?: string;
  symbolsFileError?: string;
}

/**
 * The JSON text of a symbol-index page, always within the tool's result
 * budget (by the same test the budget step applies, so it is returned
 * unchanged) and always valid JSON:
 *
 * - the whole page when it fits;
 * - else the longest leading run of entries that fits, with `count` and
 *   `nextOffset` recomputed, so the next call continues where this one stopped;
 * - else (the first entry alone is over the budget) that entry by itself, as
 *   an {@link OversizedSymbolIndexEntry}: the whole entry is saved with
 *   `spool` and named in `symbolsFile` (`symbolsFileError` when the save
 *   failed), and `symbols` keeps as many leading names as fit. `nextOffset`
 *   moves past it, so the paging always advances;
 * - else (that entry's metadata alone is over the budget) no files, an
 *   `error` saying the entry was skipped, the saved file when it still fits,
 *   and `nextOffset` past the entry.
 *
 * `completeness` (the graph-cap fields and the graph's `coverage`) goes
 * between the paging fields and `files`. No page reaches the budget's cut.
 */
async function renderSymbolIndexPage(
  page: SymbolIndexPage,
  budget: TextBudget,
  completeness: object,
  spool: (text: string) => Promise<SpoolOutcome>,
): Promise<string> {
  const render = (files: readonly object[]): string => {
    const end = page.offset + files.length;
    return JSON.stringify({
      count: files.length,
      total: page.total,
      offset: page.offset,
      ...(end < page.total ? { nextOffset: end } : {}),
      ...completeness,
      files,
    });
  };
  const whole = render(page.files);
  if (page.files.length === 0 || fitsBudget(whole, budget)) {
    return whole;
  }
  const kept = largestFitting(page.files.length - 1, (count) =>
    fitsBudget(render(page.files.slice(0, count)), budget),
  );
  if (kept > 0) {
    return render(page.files.slice(0, kept));
  }

  const [entry] = page.files;
  const saved = await spool(JSON.stringify(entry));
  const savedTo =
    'path' in saved
      ? { symbolsFile: saved.path }
      : { symbolsFileError: saved.failure };
  const oversized = (shown: number): string =>
    render([
      {
        file: entry.file,
        symbolCount: entry.symbols.length,
        truncated: true,
        ...savedTo,
        symbols: entry.symbols.slice(0, shown),
      } satisfies OversizedSymbolIndexEntry,
    ]);
  if (fitsBudget(oversized(0), budget)) {
    return oversized(
      largestFitting(entry.symbols.length, (shown) =>
        fitsBudget(oversized(shown), budget),
      ),
    );
  }

  // Even the entry's metadata is over the budget (a path of thousands of
  // chars, or of many tokens): skip it with a fixed-size error. The saved
  // file is named when it still fits; `nextOffset` moves past the entry.
  const end = page.offset + 1;
  const skipped = (recovery: object): string =>
    JSON.stringify({
      count: 0,
      total: page.total,
      offset: page.offset,
      ...(end < page.total ? { nextOffset: end } : {}),
      ...completeness,
      files: [],
      error: SYMBOL_INDEX_ENTRY_TOO_LONG,
      ...recovery,
    });
  const withLocator = skipped(savedTo);
  return fitsBudget(withLocator, budget) ? withLocator : skipped({});
}

/** The error of a symbol-index page whose single entry cannot be shown at all. */
const SYMBOL_INDEX_ENTRY_TOO_LONG =
  'The file at "offset" was skipped: its path alone is over the result budget. Continue at "nextOffset".';

/** Largest `n` in `[0, max]` for which `fits(n)` holds, else 0 (`fits` monotone; `fits(0)` is not tested). */
function largestFitting(max: number, fits: (n: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
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
  hint?: ContentKind,
  languageHint?: string,
): Promise<MCPResponse> {
  const budgeted = await budgetToolText(
    request,
    text,
    deps,
    hint,
    languageHint,
  );
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
  hint?: ContentKind,
  languageHint?: string,
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
    hint,
    languageHint,
    outliner: deps.codeOutliner,
    output: budgetOutputChannel(deps.logger),
  });
}

/**
 * The `ptah_browser_content` success response (Batch 21p). Within the budget:
 * the formatted page (text and HTML sections), unchanged. Over it, the
 * formatted Markdown envelope would be sniffed as Markdown and its HTML block
 * dropped by the outline reducer, so the page's own uncut HTML goes through
 * the budget declared as HTML instead: the agent gets the extracted main
 * content (title, headings, paragraphs), the raw HTML is spooled byte-equal,
 * and the trailer names `html-extract` and the spool file.
 *
 * The extractor is asked first, without spooling, whether it extracts this
 * page. When it refuses (a shape it cannot model, input over the reducer cap)
 * or the HTML alone is within the budget, the formatted page takes the
 * ordinary path: its reducer, the cut and the spool. The accepted case
 * extracts twice (the budget step extracts again within its trailer window);
 * the work is linear and bounded by the reducer input cap.
 */
async function createBrowserContentResponse(
  request: MCPRequest,
  result: BrowserContentResult,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse> {
  const formatted = formatBrowserContent(result);
  const budget = getToolResultBudget(toolNameOf(request));
  if (
    result.error ||
    typeof result.html !== 'string' ||
    tokensWithinBudget(formatted, budget) !== null
  ) {
    return createToolSuccessResponse(request, formatted, deps);
  }
  const probe = await reduceOutput(result.html, {
    budgetTokens: budget.tokens,
    budgetChars: budget.chars,
    hint: 'html',
    output: budgetOutputChannel(deps.logger),
  });
  if (probe.reducer !== HTML_EXTRACT_REDUCER) {
    return createToolSuccessResponse(request, formatted, deps);
  }
  return createToolSuccessResponse(request, result.html, deps, 'html');
}

/** Reducer name the HTML main-content extractor reports when it extracted. */
const HTML_EXTRACT_REDUCER = 'html-extract';

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

/**
 * Where `ptah_run_check` runs: the caller's own declared workspace root, and
 * nothing else.
 *
 * - The declared root names an open folder: the host's record of it.
 * - The declared root is an existing directory INSIDE an open folder (a
 *   worktree lane declares the directory it runs in): that directory, real
 *   path. A UNC path is accepted only by the equality rule, never stat'd.
 * - No declared root: only off the MCP request path (stdio / internal), and
 *   only when exactly one folder is open, is that folder used.
 *
 * Every other case is an error: unlike the spool root there is no fallback to
 * the first open folder, because a check run there is a verdict on a tree the
 * caller never edited.
 */
function runCheckOwnerKey(root: string): string {
  return [root, getCallerSessionId() ?? '', getCallerAgentId() ?? ''].join('|');
}

function unknownRunCheckJobResponse(request: MCPRequest): MCPResponse {
  return toolErrorResponse(
    request,
    'unknown or expired job id; the full log stays under .ptah/tmp/checks',
  );
}

function formatRunCheckBusy(
  job: RunCheckJob | undefined,
  external: boolean,
): string {
  const elapsed =
    job === undefined ? 0 : Math.max(0, Date.now() - job.startedAt);
  const seconds = Math.round(elapsed / 1000);
  if (external || job === undefined) {
    return `ptah_run_check is busy: another check is running on this host, started ${seconds}s ago.`;
  }
  return (
    `ptah_run_check is busy with your job ${job.id}: ${job.args.project} ` +
    `[${job.args.targets.join(', ')}], started ${seconds}s ago. ` +
    'Call ptah_run_check_wait with that jobId.'
  );
}

async function runCheckRunningResponse(
  request: MCPRequest,
  job: RunCheckJob,
  deps: ProtocolHandlerDependencies,
  cappedFromTimeoutSec?: number,
): Promise<MCPResponse> {
  const text =
    formatRunCheckRunning({
      jobId: job.id,
      project: job.args.project,
      targets: job.args.targets,
      elapsedMs: Math.max(0, Date.now() - job.startedAt),
      logPath: job.logPath,
      cwd: job.root,
    }) +
    (cappedFromTimeoutSec === undefined
      ? ''
      : ` Requested timeoutSec ${cappedFromTimeoutSec} was capped at ${HTTP_MAX_AGENT_WAIT_SEC} s.`);
  const response = await createToolSuccessResponse(request, text, deps);
  attachStructuredContent(response, {
    cwd: job.root,
    project: job.args.project,
    targets: job.args.targets,
    verdict: 'running',
    exitCode: null,
    ...(job.logPath ? { logPath: job.logPath } : {}),
    jobId: job.id,
  });
  return response;
}

async function resolveRunCheckRoot(
  deps: ProtocolHandlerDependencies,
): Promise<{ readonly root: string } | { readonly error: string }> {
  const known = knownWorkspaceFolders(deps);
  const openList =
    known.length > 0
      ? `open folders: ${known.join(', ')}`
      : 'no folder is open';
  const declared = getCallerWorkspaceRoot()?.trim();
  if (declared !== undefined && declared !== '') {
    const match =
      (await findKnownWorkspaceFolder(declared, known)) ??
      (await findDirectoryInsideKnownFolder(declared, known));
    if (match !== undefined) {
      return { root: match };
    }
    return {
      error:
        `${RUN_CHECK_TOOL_NAME}: nothing was run. The caller declared workspace '${declared}', ` +
        `which is not an open folder of this host or an existing directory inside one (${openList}). ` +
        `Re-read the 'ptah' entry in .mcp.json of the tree you mean to check.`,
    };
  }
  if (!isMcpRequestInFlight() && known.length === 1) {
    return { root: known[0] };
  }
  return {
    error:
      `${RUN_CHECK_TOOL_NAME}: nothing was run. The caller declared no workspace root, so Ptah cannot ` +
      `tell which tree to check (${openList}). Call it through the workspace-scoped MCP URL of the ` +
      `tree you mean (the 'ptah' entry in that tree's .mcp.json).`,
  };
}

/**
 * The real path of `declared` when it is an existing directory strictly
 * inside one of `known` (compared by {@link canonicalFolderKey});
 * `undefined` otherwise. UNC paths are never touched.
 */
async function findDirectoryInsideKnownFolder(
  declared: string,
  known: readonly string[],
): Promise<string | undefined> {
  const plain = stripExtendedLengthPrefix(declared);
  if (known.length === 0 || !path.isAbsolute(plain) || isUncPath(plain)) {
    return undefined;
  }
  let real: string;
  try {
    real = stripExtendedLengthPrefix(
      await fs.promises.realpath(path.resolve(plain)),
    );
    if (!(await fs.promises.stat(real)).isDirectory()) {
      return undefined;
    }
  } catch {
    // degradation-audit: reported — a missing or unreadable directory is not
    // one this check can run in; `undefined` makes the caller refuse with an
    // error reply that names the declared root, so nothing runs silently.
    return undefined;
  }
  const target = await canonicalFolderKey(real);
  for (const folder of known) {
    if (target.startsWith(`${await canonicalFolderKey(folder)}${path.sep}`)) {
      return real;
    }
  }
  return undefined;
}

/** Adds `structuredContent` to a tool response's result, in place (keeps budget-outcome identity). */
function attachStructuredContent(
  response: MCPResponse,
  structured: object | undefined,
): void {
  if (
    structured !== undefined &&
    response.result !== null &&
    typeof response.result === 'object'
  ) {
    (response.result as Record<string, unknown>)['structuredContent'] = {
      ...structured,
    };
  }
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

/** Longest accepted `execute_code` `resultLanguage` (an id or extension). */
const MAX_RESULT_LANGUAGE_CHARS = 32;

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
  const { code, timeout = 15000, resultLanguage } = params;
  const { ptahAPI, logger } = deps;
  const actualTimeout = Math.min(timeout, 30000);
  const declaredLanguage =
    typeof resultLanguage === 'string' ? resultLanguage.trim() : undefined;
  if (
    resultLanguage !== undefined &&
    (declaredLanguage === undefined ||
      declaredLanguage.length === 0 ||
      declaredLanguage.length > MAX_RESULT_LANGUAGE_CHARS)
  ) {
    return createErrorResponse(
      request.id,
      -32602,
      `Invalid params: execute_code "resultLanguage" must be a non-empty string of at most ${MAX_RESULT_LANGUAGE_CHARS} chars (a language id or file extension, e.g. "tsx" or ".py")`,
    );
  }

  let textResult: string;
  let returnedSource = false;
  try {
    // The request signal ends the run, and `ptah.agent.waitFor`, when the
    // caller stops waiting (TASK_2026_614 Batch 23).
    const result = await executeCode(code, actualTimeout, {
      ptahAPI,
      logger,
      signal: getRequestAbortSignal(),
    });
    textResult = serializeResult(result);
    // Only a string result can be the source text the caller declared; an
    // object is serialised JSON, whatever the caller said.
    returnedSource = typeof result === 'string';
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
  // Budgeted like every other text result: `serializeResult` returns the
  // whole value (Batch 30 r1 R30-01), so this budget is what bounds the
  // answer and the spool holds the complete output. A string result
  // the caller declared as source (`resultLanguage`) is reduced as code with
  // that language, so an over-budget file reaches the outliner (Batch 29b r1
  // R29b-02); the language is the caller's declaration about the returned
  // text, never inferred from the executed code.
  return returnedSource && declaredLanguage !== undefined
    ? await createToolSuccessResponse(
        request,
        textResult,
        deps,
        'code',
        declaredLanguage,
      )
    : await createToolSuccessResponse(request, textResult, deps);
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

/** Longest transcript summary a screenshot hands to `onToolResult`. */
const SCREENSHOT_SUMMARY_MAX_CHARS = 299;

/**
 * One-line screenshot summary for the transcript, at most
 * {@link SCREENSHOT_SUMMARY_MAX_CHARS}. Control characters become `?`; a
 * saved path that does not fit loses its middle to `…`, keeping its start and
 * as much of its file name as fits.
 */
function screenshotTranscriptSummary(
  captured: string,
  filePath: string | undefined,
): string {
  const oneLine = (text: string): string => text.replace(/\p{Cc}/gu, '?');
  if (!filePath) {
    return oneLine(captured).slice(0, SCREENSHOT_SUMMARY_MAX_CHARS);
  }
  const prefix = oneLine(`${captured} | Saved to: `);
  const shown = oneLine(filePath);
  const room = SCREENSHOT_SUMMARY_MAX_CHARS - prefix.length;
  if (shown.length <= room) {
    return prefix + shown;
  }
  if (room < 2) {
    return prefix.slice(0, SCREENSHOT_SUMMARY_MAX_CHARS);
  }
  const tail = Math.min(
    room - 1,
    Math.max(path.basename(shown).length, Math.ceil((room - 1) / 2)),
  );
  const head = room - 1 - tail;
  return `${prefix}${shown.slice(0, head)}…${shown.slice(shown.length - tail)}`;
}

/**
 * The screenshot format a `saveTo` file extension names, or `undefined` when
 * there is no `saveTo` or its extension is not an image format we capture.
 */
function screenshotFormatForPath(
  saveTo: unknown,
): 'png' | 'jpeg' | 'webp' | undefined {
  if (typeof saveTo !== 'string') {
    return undefined;
  }
  switch (path.extname(saveTo.trim()).toLowerCase()) {
    case '.png':
      return 'png';
    case '.jpg':
    case '.jpeg':
      return 'jpeg';
    case '.webp':
      return 'webp';
    default:
      return undefined;
  }
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
