/**
 * MCP Protocol Handlers
 *
 * Implements MCP JSON-RPC 2.0 protocol methods:
 * - initialize: Server capability negotiation
 * - tools/list: List available tools
 * - tools/call: Execute a tool
 */

import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
import type { CliType } from '@ptah-extension/shared';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type {
  PtahAPI,
  MCPRequest,
  MCPResponse,
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
  buildAgentSteerTool,
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
} from './tool-description.builder';
import { executeCode, serializeResult } from './code-execution.engine';
import { handleApprovalPrompt } from './approval-prompt.handler';
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
  formatAgentSteer,
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
  disabledMcpNamespaces?: string[];
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

  logger.info(`MCP Request: ${request.method}`, 'CodeExecutionMCP', {
    id: request.id,
  });

  try {
    switch (request.method) {
      case 'initialize':
        return handleInitialize(request, logger);

      case 'tools/list':
        return handleToolsList(request, deps);

      case 'tools/call':
        return await handleToolsCall(request, deps);

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

    logger.error(
      `MCP request failed: ${request.method}`,
      error instanceof Error ? error : new Error(String(error)),
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
 *
 * Namespace-toggleable tool groups (disabled via disabledMcpNamespaces):
 * - 'ide': ptah_lsp_references, ptah_lsp_definitions, ptah_get_dirty_files
 *          (also requires hasIDECapabilities === true)
 * - 'agent': ptah_agent_spawn/status/read/steer/stop/list
 * - 'git': ptah_git_worktree_list/add/remove
 * - 'json': ptah_json_validate
 * - 'browser': all ptah_browser_* tools (12 tools)
 *
 * Platform-agnostic tools (always included):
 * - ptah_get_diagnostics: Uses IDiagnosticsProvider abstraction (works on both platforms)
 */
function handleToolsList(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies,
): MCPResponse {
  const disabled = new Set(deps.disabledMcpNamespaces ?? []);

  const tools = [
    // === Always-on core tools (not toggleable) ===
    buildWorkspaceAnalyzeTool(),
    buildSearchFilesTool(),
    buildGetDiagnosticsTool(),
    buildCountTokensTool(),
    buildWebSearchTool(),
    buildExecuteCodeTool(),
    buildApprovalPromptTool(),

    // === IDE / LSP namespace (requires IDE capabilities AND not disabled) ===
    ...(deps.hasIDECapabilities === true && !disabled.has('ide')
      ? [
          buildLspReferencesTool(),
          buildLspDefinitionsTool(),
          buildGetDirtyFilesTool(),
        ]
      : []),

    // === Agent orchestration namespace ===
    ...(!disabled.has('agent')
      ? [
          buildAgentSpawnTool(),
          buildAgentStatusTool(),
          buildAgentReadTool(),
          buildAgentSteerTool(),
          buildAgentStopTool(),
          buildAgentListTool(),
        ]
      : []),

    // === Git worktree namespace ===
    ...(!disabled.has('git')
      ? [
          buildWorktreeListTool(),
          buildWorktreeAddTool(),
          buildWorktreeRemoveTool(),
        ]
      : []),

    // === JSON validation namespace ===
    ...(!disabled.has('json') ? [buildJsonValidateTool()] : []),

    // === Browser automation namespace ===
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

    // === Harness builder namespace (TASK_2025_285) ===
    ...(!disabled.has('harness')
      ? [
          buildHarnessSearchSkillsTool(),
          buildHarnessCreateSkillTool(),
          buildHarnessSearchMcpRegistryTool(),
          buildHarnessListInstalledMcpTool(),
        ]
      : []),
  ];

  return {
    jsonrpc: '2.0',
    id: request.id,
    result: { tools },
  };
}

/**
 * Handle tools/call request
 * Routes to individual ptah_* tools, execute_code, or approval_prompt
 */
async function handleToolsCall(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies,
): Promise<MCPResponse> {
  const params = request.params as
    | { name: string; arguments?: Record<string, unknown> }
    | undefined;
  const { name, arguments: args } = params!;

  // Individual first-class tools — direct API calls, no sandbox
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

  if (name === 'approval_prompt') {
    // When WebviewManager is absent (Electron), auto-allow all approval prompts.
    // Electron has no webview UI for user interaction, so permissions are granted automatically.
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
        return createToolSuccessResponse(
          request,
          formatWorkspaceAnalysis(result),
          deps,
        );
      }

      case 'ptah_search_files': {
        const { pattern, limit } = args as { pattern: string; limit?: number };
        const files = await ptahAPI.search.findFiles(pattern, limit ?? 50);
        return createToolSuccessResponse(
          request,
          formatSearchFiles(files),
          deps,
        );
      }

      case 'ptah_get_diagnostics': {
        const { severity } = args as { severity?: 'error' | 'warning' | 'all' };
        let result;
        if (severity === 'error') {
          result = await ptahAPI.diagnostics.getErrors();
        } else if (severity === 'warning') {
          result = await ptahAPI.diagnostics.getWarnings();
        } else {
          result = await ptahAPI.diagnostics.getAll();
        }
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
          request,
          formatLspDefinitions(defs),
          deps,
        );
      }

      case 'ptah_get_dirty_files': {
        const dirtyFiles = await ptahAPI.ide.editor.getDirtyFiles();
        return createToolSuccessResponse(
          request,
          formatDirtyFiles(dirtyFiles),
          deps,
        );
      }

      case 'ptah_count_tokens': {
        const { file } = args as { file: string };
        const fileContent = await ptahAPI.files.read(file);
        const tokenCount = await ptahAPI.context.countTokens(fileContent);
        return createToolSuccessResponse(
          request,
          formatTokenCount({ file, tokens: tokenCount }),
          deps,
        );
      }

      // Agent orchestration tools (TASK_2025_157)
      case 'ptah_agent_spawn': {
        const MAX_TASK_LENGTH = 100 * 1024; // 100KB

        const {
          cli,
          ptahCliId,
          workingDirectory,
          timeout,
          files,
          taskFolder,
          model,
          modelTier,
          resume_session_id,
        } = args as {
          task: string;
          cli?: string;
          ptahCliId?: string;
          workingDirectory?: string;
          timeout?: number;
          files?: string[];
          taskFolder?: string;
          model?: string;
          modelTier?: 'opus' | 'sonnet' | 'haiku';
          resume_session_id?: string;
        };

        // Validate task parameter: must be a non-empty string within size limits
        const task = (args as Record<string, unknown>)?.['task'];
        if (!task || typeof task !== 'string') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "task" parameter is required and must be a string.',
                },
              ],
              isError: true,
            },
          };
        }
        if (task.length > MAX_TASK_LENGTH) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: "task" exceeds maximum length of ${MAX_TASK_LENGTH} bytes.`,
                },
              ],
              isError: true,
            },
          };
        }

        logger.info('[MCP] ptah_agent_spawn invoked', 'CodeExecutionMCP', {
          cli: cli ?? (ptahCliId ? 'ptah-cli' : 'auto-detect'),
          ptahCliId,
          model: model ?? 'default',
          modelTier: modelTier ?? 'sonnet',
          task: task.substring(0, 100) + (task.length > 100 ? '...' : ''),
          timeout,
          files: files?.length ?? 0,
          taskFolder,
          resumeSessionId: resume_session_id,
        });

        const result = await ptahAPI.agent.spawn({
          task,
          cli: cli as CliType | undefined,
          ptahCliId,
          workingDirectory,
          timeout,
          files,
          taskFolder,
          model,
          modelTier,
          resumeSessionId: resume_session_id,
          // parentSessionId from MCP URL path (session-specific endpoint)
          // Falls back to getActiveSessionId() in buildAgentNamespace if not present
          parentSessionId: request._callerSessionId,
        });

        logger.info('[MCP] ptah_agent_spawn result', 'CodeExecutionMCP', {
          agentId: result.agentId,
          cli: result.cli,
          status: result.status,
          cliSessionId: result.cliSessionId,
        });

        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
          request,
          formatAgentRead(result),
          deps,
        );
      }

      case 'ptah_agent_steer': {
        const { agentId, instruction } = args as {
          agentId: string;
          instruction: string;
        };
        await ptahAPI.agent.steer(agentId, instruction);
        return createToolSuccessResponse(
          request,
          formatAgentSteer({ agentId, steered: true }),
          deps,
        );
      }

      case 'ptah_agent_stop': {
        const { agentId } = args as { agentId: string };
        const result = await ptahAPI.agent.stop(agentId);
        return createToolSuccessResponse(
          request,
          formatAgentStop(result),
          deps,
        );
      }

      case 'ptah_agent_list': {
        logger.info('[MCP] ptah_agent_list called', 'CodeExecutionMCP');
        const agents = await ptahAPI.agent.list();
        return createToolSuccessResponse(
          request,
          formatAgentList(agents),
          deps,
        );
      }

      case 'ptah_web_search': {
        const { query, maxResults, timeout } = args as {
          query: string;
          maxResults?: number;
          timeout?: number;
        };
        if (!deps.ptahAPI.webSearch) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Web search service not available.',
                },
              ],
              isError: true,
            },
          };
        }
        const result = await deps.ptahAPI.webSearch.search(query, {
          maxResults,
          timeout,
        });
        return createToolSuccessResponse(
          request,
          formatWebSearch(result),
          deps,
        );
      }

      // Git worktree tools (TASK_2025_236)
      case 'ptah_git_worktree_list': {
        const result = await ptahAPI.git.worktreeList();
        return createToolSuccessResponse(
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

        // Validate required branch parameter
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
        return createToolSuccessResponse(
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

        // Validate required path parameter
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
        return createToolSuccessResponse(
          request,
          formatWorktreeRemove(removeResult),
          deps,
        );
      }

      // JSON validation tool (TASK_2025_240)
      case 'ptah_json_validate': {
        const { file, schema } = args as {
          file: string;
          schema?: Record<string, unknown>;
        };

        // Validate required file parameter
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
        return createToolSuccessResponse(
          request,
          formatJsonValidate(jsonResult),
          deps,
        );
      }

      // Browser automation tools (TASK_2025_244)
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
        return createToolSuccessResponse(
          request,
          formatBrowserNavigate(navResult),
          deps,
        );
      }

      case 'ptah_browser_screenshot': {
        const { format, quality, fullPage } = args as {
          format?: 'png' | 'jpeg' | 'webp';
          quality?: number;
          fullPage?: boolean;
        };
        const screenshotResult = await ptahAPI.browser.screenshot({
          format,
          quality,
          fullPage,
        });

        // Return as MCP image content type so the AI model can visually inspect
        if (screenshotResult.data && !screenshotResult.error) {
          const mimeType =
            screenshotResult.format === 'jpeg'
              ? 'image/jpeg'
              : screenshotResult.format === 'webp'
                ? 'image/webp'
                : 'image/png';

          const text = formatBrowserScreenshot(screenshotResult);
          deps.onToolResult?.(request.id.toString(), text, false);

          return {
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
                  text: `Screenshot captured (${screenshotResult.format}, ~${Math.round((screenshotResult.data.length * 3) / 4 / 1024)}KB)`,
                },
              ],
            },
          };
        }

        // Error case — return as text
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
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
        return createToolSuccessResponse(
          request,
          formatBrowserNetwork(networkResult),
          deps,
        );
      }

      case 'ptah_browser_close': {
        const closeResult = await ptahAPI.browser.close();
        return createToolSuccessResponse(
          request,
          formatBrowserClose(closeResult),
          deps,
        );
      }

      case 'ptah_browser_status': {
        const statusResult = await ptahAPI.browser.status();
        return createToolSuccessResponse(
          request,
          formatBrowserStatus(statusResult),
          deps,
        );
      }

      // Browser enhancement tools (TASK_2025_254)
      case 'ptah_browser_record_start': {
        const { maxFrames, frameDelay } = args as {
          maxFrames?: number;
          frameDelay?: number;
        };
        const recordStartResult = await ptahAPI.browser.recordStart({
          maxFrames,
          frameDelay,
        });
        return createToolSuccessResponse(
          request,
          formatBrowserRecordStart(recordStartResult),
          deps,
        );
      }

      case 'ptah_browser_record_stop': {
        const recordStopResult = await ptahAPI.browser.recordStop();
        return createToolSuccessResponse(
          request,
          formatBrowserRecordStop(recordStopResult),
          deps,
        );
      }

      // Harness builder tools (TASK_2025_285)
      case 'ptah_harness_search_skills': {
        if (!ptahAPI.harness) {
          return createToolSuccessResponse(
            request,
            JSON.stringify({
              skills: [],
              error: 'Harness namespace not available',
            }),
            deps,
          );
        }
        const { query: skillQuery } = args as { query?: string };
        const skills = await ptahAPI.harness.searchSkills(skillQuery);
        return createToolSuccessResponse(
          request,
          JSON.stringify({ skills, count: skills.length }),
          deps,
        );
      }

      case 'ptah_harness_create_skill': {
        if (!ptahAPI.harness) {
          return createToolSuccessResponse(
            request,
            JSON.stringify({ error: 'Harness namespace not available' }),
            deps,
          );
        }
        const {
          name: skillName,
          description: skillDescription,
          content: skillContent,
          allowedTools,
        } = args as {
          name: string;
          description: string;
          content: string;
          allowedTools?: string[];
        };

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
        );
        return createToolSuccessResponse(
          request,
          JSON.stringify(createResult),
          deps,
        );
      }

      case 'ptah_harness_search_mcp_registry': {
        if (!ptahAPI.harness) {
          return createToolSuccessResponse(
            request,
            JSON.stringify({
              servers: [],
              error: 'Harness namespace not available',
            }),
            deps,
          );
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
        return createToolSuccessResponse(
          request,
          JSON.stringify(registryResult),
          deps,
        );
      }

      case 'ptah_harness_list_installed_mcp': {
        if (!ptahAPI.harness) {
          return createToolSuccessResponse(
            request,
            JSON.stringify({
              servers: [],
              error: 'Harness namespace not available',
            }),
            deps,
          );
        }
        const installedServers =
          await ptahAPI.harness.listInstalledMcpServers();
        return createToolSuccessResponse(
          request,
          JSON.stringify({
            servers: installedServers,
            count: installedServers.length,
          }),
          deps,
        );
      }

      default:
        return null;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      `Individual tool ${name} failed: ${errorMessage}`,
      error instanceof Error ? error : new Error(String(error)),
    );

    deps.onToolResult?.(request.id.toString(), errorMessage, true);

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
 * Create a successful tool response with callback notification
 */
function createToolSuccessResponse(
  request: MCPRequest,
  text: string,
  deps: ProtocolHandlerDependencies,
): MCPResponse {
  deps.onToolResult?.(request.id.toString(), text, false);
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [{ type: 'text', text }],
    },
  };
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

  // Validate timeout (cap at 30000ms)
  const actualTimeout = Math.min(timeout, 30000);

  try {
    const result = await executeCode(code, actualTimeout, { ptahAPI, logger });
    const textResult = serializeResult(result);

    // Notify callback for live transcript streaming
    deps.onToolResult?.(request.id.toString(), textResult, false);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: textResult,
          },
        ],
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Log full stack trace server-side for debugging
    if (error instanceof Error && error.stack) {
      logger.error('Code execution failed', error);
    }

    // Build agent-friendly error message with recovery hints
    const agentMessage = buildAgentFriendlyError(errorMessage);

    // Notify callback for live transcript streaming
    deps.onToolResult?.(request.id.toString(), agentMessage, true);

    // Per MCP spec: return tool errors as successful response with isError flag
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

  // File not found errors - guide to use search/discovery first
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

  // Directory not found errors
  if (errorMessage.includes('Directory not found:')) {
    return `${errorMessage}

SOLUTION: Use ptah.workspace.analyze() to see project structure, then ptah.files.list() to explore directories.`;
  }

  // Proxy-generated errors already include available methods — pass through with minimal wrapping
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
