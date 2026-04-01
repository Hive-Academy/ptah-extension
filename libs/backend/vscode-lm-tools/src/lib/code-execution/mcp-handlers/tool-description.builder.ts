/**
 * MCP Tool Description Builder
 *
 * Generates comprehensive tool descriptions for the MCP protocol.
 * These descriptions help Claude understand all available capabilities.
 */

import { MCPToolDefinition } from '../types';
import { PTAH_SYSTEM_PROMPT } from '../ptah-system-prompt.constant';

/**
 * Build the execute_code tool definition
 */
export function buildExecuteCodeTool(): MCPToolDefinition {
  return {
    name: 'execute_code',
    description: buildExecuteCodeDescription(),
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'TypeScript/JavaScript code to execute. Has access to "ptah" global object with 14 namespaces. ' +
            'All methods are async. Code is auto-wrapped for execution - all patterns work:\n' +
            '• Simple: `await ptah.workspace.getInfo()` or `ptah.workspace.getInfo()`\n' +
            '• With variables: `const info = await ptah.workspace.getInfo(); return info;`\n' +
            '• IIFE (any style): `(async () => { return await ptah.workspace.getInfo(); })()`\n' +
            '• Direct return: `return "hello"`\n' +
            'Results are automatically extracted from Promises. No special syntax required.',
        },
        timeout: {
          type: 'number',
          description:
            'Execution timeout in milliseconds (default: 15000, max: 30000)',
          default: 15000,
        },
      },
      required: ['code'],
    },
  };
}

/**
 * Build the approval_prompt tool definition
 */
export function buildApprovalPromptTool(): MCPToolDefinition {
  return {
    name: 'approval_prompt',
    description:
      'Request user permission to execute a tool via VS Code dialog. ' +
      'Called by Claude CLI when permission is needed for tool execution. ' +
      'Returns approval decision with optional updated input parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'Name of the tool requesting permission',
        },
        input: {
          type: 'object',
          description: 'Input parameters for the tool',
        },
        tool_use_id: {
          type: 'string',
          description: 'Unique tool use request ID',
        },
      },
      required: ['tool_name', 'input'],
    },
  };
}

// ========================================
// Individual First-Class MCP Tools
// ========================================

/**
 * Build the ptah_workspace_analyze tool definition
 * One-call project understanding — replaces manual exploration
 */
export function buildWorkspaceAnalyzeTool(): MCPToolDefinition {
  return {
    name: 'ptah_workspace_analyze',
    description:
      'Analyze the entire workspace in one call. Returns project type, frameworks, directory structure, and architecture overview. Use this FIRST when starting any task to understand the project.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_search_files tool definition
 * .gitignore-aware, workspace-indexed file discovery
 */
export function buildSearchFilesTool(): MCPToolDefinition {
  return {
    name: 'ptah_search_files',
    description:
      'Find files in the workspace by glob pattern. Respects .gitignore and is workspace-indexed. Faster and more accurate than Glob/find for file discovery.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Glob pattern (e.g., "**/*.ts", "src/**/auth*", "*.spec.ts")',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 50)',
        },
      },
      required: ['pattern'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_get_diagnostics tool definition
 * Live TypeScript errors without compiling
 */
export function buildGetDiagnosticsTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_diagnostics',
    description:
      'Get all TypeScript/JavaScript errors and warnings from VS Code diagnostics. Returns live results from the language server — no need to run a build command. Each diagnostic includes file path, line number, severity, and message.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['error', 'warning', 'all'],
          description:
            'Filter by severity level (default: "all"). Use "error" to see only errors.',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_lsp_references tool definition
 * LSP-accurate cross-file reference finding
 */
export function buildLspReferencesTool(): MCPToolDefinition {
  return {
    name: 'ptah_lsp_references',
    description:
      'Find all references to a symbol at a specific file position using VS Code LSP. More accurate than Grep for finding usages — handles renames, re-exports, and type references. Essential before refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
        line: {
          type: 'number',
          description: 'Line number (0-indexed)',
        },
        col: {
          type: 'number',
          description: 'Column number (0-indexed)',
        },
      },
      required: ['file', 'line', 'col'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_lsp_definitions tool definition
 * Go-to-definition via LSP
 */
export function buildLspDefinitionsTool(): MCPToolDefinition {
  return {
    name: 'ptah_lsp_definitions',
    description:
      'Go to definition for a symbol at a specific file position using VS Code LSP. Returns the source location where the symbol is defined. Works across files, through re-exports, and into node_modules.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
        line: {
          type: 'number',
          description: 'Line number (0-indexed)',
        },
        col: {
          type: 'number',
          description: 'Column number (0-indexed)',
        },
      },
      required: ['file', 'line', 'col'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_get_dirty_files tool definition
 * Unsaved VS Code buffers
 */
export function buildGetDirtyFilesTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_dirty_files',
    description:
      'Get all files with unsaved changes in VS Code. Unlike "git status", this shows files that have been modified in the editor but not yet saved to disk.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_count_tokens tool definition
 * Token count for files
 */
export function buildCountTokensTool(): MCPToolDefinition {
  return {
    name: 'ptah_count_tokens',
    description:
      'Count tokens in a file using the model-specific tokenizer. Use this instead of reading a file just to check its size. Returns the token count, which is more useful than byte count for context window planning.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true },
  };
}

// ========================================
// Agent Orchestration MCP Tools (TASK_2025_157)
// ========================================

/**
 * Build the ptah_agent_spawn tool definition
 * Spawn a CLI agent to work on a task in the background
 */
export function buildAgentSpawnTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_spawn',
    description:
      'Spawn a headless agent to work on a task in the background. ' +
      'Supports CLI agents (Gemini, Codex, Copilot) and Ptah CLI agents (OpenRouter, Moonshot, Z.AI). ' +
      'The agent runs while you continue working. ' +
      'Use ptah_agent_status to check progress and ptah_agent_read to get output. ' +
      'For Ptah CLI agents, pass ptahCliId (from ptah_agent_list). ' +
      'To resume a previous CLI session, pass resume_session_id with the CLI session ID. ' +
      'Ideal for delegating: code reviews, test generation, documentation, ' +
      'and other independent subtasks.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Task description for the agent. Be specific about what to do, ' +
            'which files to focus on, and what output to produce.',
        },
        cli: {
          type: 'string',
          enum: ['gemini', 'codex', 'copilot'],
          description:
            'Which CLI agent to use. Each requires its CLI installed on PATH. ' +
            'Omit to use the default (auto-detected or user-configured). ' +
            'Not needed when using ptahCliId.',
        },
        ptahCliId: {
          type: 'string',
          description:
            'ID of a Ptah CLI agent to use (from ptah_agent_list results where cli="ptah-cli"). ' +
            'Ptah CLI agents are user-configured Anthropic-compatible providers ' +
            '(OpenRouter, Moonshot, Z.AI, etc.). When set, cli parameter is ignored.',
        },
        workingDirectory: {
          type: 'string',
          description:
            'Working directory for the agent (must be within workspace). Defaults to workspace root.',
        },
        timeout: {
          type: 'number',
          description:
            'Timeout in milliseconds (default: 3600000 = 1hr, max: 3600000 = 1hr)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files the agent should focus on',
        },
        taskFolder: {
          type: 'string',
          description:
            'Task-tracking folder for shared workspace (e.g., ".ptah/specs/TASK_2025_157"). ' +
            'Agent will write deliverables here.',
        },
        model: {
          type: 'string',
          description:
            'Model override for the CLI agent (e.g., "gemini-2.5-pro" for Gemini, "claude-sonnet-4.6" for Copilot). ' +
            'Uses user-configured default if omitted.',
        },
        resume_session_id: {
          type: 'string',
          description:
            'Resume a previous CLI agent session by its CLI-native session ID. ' +
            'For Gemini, this is the UUID from the init event. ' +
            'The agent will continue from where the previous session left off.',
        },
      },
      required: ['task'],
    },
  };
}

/**
 * Build the ptah_agent_status tool definition
 * Check status of one or all agents
 */
export function buildAgentStatusTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_status',
    description:
      'Check the status of a specific agent or all agents. ' +
      'Returns agentId, status (running/completed/failed/timeout/stopped), ' +
      'cli, task, startedAt, duration, and exitCode.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to check. Omit to get status of ALL agents.',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_agent_read tool definition
 * Read agent output
 */
export function buildAgentReadTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_read',
    description:
      'Read the stdout/stderr output from an agent. ' +
      'For running agents, returns output captured so far. ' +
      'Use tail parameter to get only the last N lines.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to read output from',
        },
        tail: {
          type: 'number',
          description: 'Only return the last N lines of output',
        },
      },
      required: ['agentId'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_agent_steer tool definition
 * Send instruction to agent stdin
 */
export function buildAgentSteerTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_steer',
    description:
      'Send a steering instruction to a running agent via stdin. ' +
      'Only works if the CLI supports interactive input. ' +
      'Returns error if steering is not supported for the CLI type.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to steer',
        },
        instruction: {
          type: 'string',
          description: 'Instruction text to send to agent stdin',
        },
      },
      required: ['agentId', 'instruction'],
    },
  };
}

/**
 * Build the ptah_agent_list tool definition
 * List all available agents (CLI and custom)
 */
export function buildAgentListTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_list',
    description:
      'List all available agents (CLI and Ptah CLI) that can be spawned. ' +
      'Returns agent type, installation status, and capabilities. ' +
      'Ptah CLI agents include ptahCliId needed for ptah_agent_spawn.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_agent_stop tool definition
 * Stop a running agent
 */
export function buildAgentStopTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_stop',
    description:
      'Stop a running agent. Sends SIGTERM, waits 5 seconds, then SIGKILL. ' +
      'If agent is already completed, returns its final status without error.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to stop',
        },
      },
      required: ['agentId'],
    },
  };
}

// ========================================
// Web Search MCP Tool (TASK_2025_189)
// ========================================

/**
 * Build the ptah_web_search tool definition
 * Multi-provider web search (Tavily, Serper, Exa)
 */
export function buildWebSearchTool(): MCPToolDefinition {
  return {
    name: 'ptah_web_search',
    description:
      'Search the web for current information using your configured search provider (Tavily, Serper, or Exa). ' +
      'Returns structured results with titles, URLs, and snippets, plus a narrative summary. ' +
      'Configure your provider and API key in Ptah Settings > Web Search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific for better results.',
        },
        maxResults: {
          type: 'number',
          description:
            'Maximum number of results to return (default: 5, max: 20)',
        },
        timeout: {
          type: 'number',
          description:
            'Search timeout in milliseconds (default: 30000, max: 60000)',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  };
}

// ========================================
// Git Worktree MCP Tools (TASK_2025_236)
// ========================================

/**
 * Build the ptah_git_worktree_list tool definition
 * List all git worktrees in the current repository
 */
export function buildWorktreeListTool(): MCPToolDefinition {
  return {
    name: 'ptah_git_worktree_list',
    description:
      'List all git worktrees in the current repository. Returns path, branch, HEAD commit, ' +
      'and whether each worktree is the main worktree.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_git_worktree_add tool definition
 * Create a new git worktree for parallel development
 */
export function buildWorktreeAddTool(): MCPToolDefinition {
  return {
    name: 'ptah_git_worktree_add',
    description:
      'Create a new git worktree for parallel development. Checks out a branch ' +
      'into a separate directory. Use createBranch to create and checkout a new branch.',
    inputSchema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'Branch name to checkout in the new worktree',
        },
        path: {
          type: 'string',
          description:
            'Custom path for the worktree directory (defaults to ../<branch>)',
        },
        createBranch: {
          type: 'boolean',
          description:
            'Create a new branch instead of checking out an existing one',
        },
      },
      required: ['branch'],
    },
  };
}

/**
 * Build the ptah_git_worktree_remove tool definition
 * Remove a git worktree
 */
export function buildWorktreeRemoveTool(): MCPToolDefinition {
  return {
    name: 'ptah_git_worktree_remove',
    description:
      'Remove a git worktree. The worktree directory will be deleted. ' +
      'Use force to remove even if there are uncommitted changes.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path of the worktree to remove',
        },
        force: {
          type: 'boolean',
          description: 'Force removal even with uncommitted changes',
        },
      },
      required: ['path'],
    },
    annotations: { destructiveHint: true },
  };
}

// ========================================
// JSON Validation MCP Tool (TASK_2025_240)
// ========================================

/**
 * Build the ptah_json_validate tool definition
 * Validate and repair JSON files written by AI agents (TASK_2025_240)
 */
export function buildJsonValidateTool(): MCPToolDefinition {
  return {
    name: 'ptah_json_validate',
    description:
      'Validate and repair a JSON file. Reads the file, extracts JSON from raw ' +
      'agent output (strips markdown fences, prose, fixes trailing commas, ' +
      'unquoted keys, single quotes), validates against an optional schema, ' +
      'and overwrites the file with clean formatted JSON. Returns errors for ' +
      'self-correction if repair fails. Call this after writing any JSON file.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description:
            'Workspace-relative path to the JSON file to validate ' +
            '(e.g., ".ptah/analysis/01-project-profile.json")',
        },
        schema: {
          type: 'object',
          description:
            'Optional JSON Schema to validate against. Use { required: ["key1", "key2"], ' +
            'properties: { key1: { type: "string" } } } for basic validation.',
        },
      },
      required: ['file'],
    },
    annotations: { idempotentHint: true },
  };
}

// ========================================
// Browser Automation MCP Tools (TASK_2025_244)
// ========================================

/**
 * Build the ptah_browser_navigate tool definition
 * Navigate to a URL, lazily starting a browser session
 */
export function buildBrowserNavigateTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_navigate',
    description:
      'Navigate the browser to a URL. Lazily starts a browser session if none exists. ' +
      'Returns the final URL and page title after load. Only http/https URLs are allowed. ' +
      'Localhost is blocked by default (enable via ptah.browser.allowLocalhost setting).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to (http/https only)',
        },
        waitForLoad: {
          type: 'boolean',
          description:
            'Wait for the page load event before returning (default: true)',
        },
      },
      required: ['url'],
    },
  };
}

/**
 * Build the ptah_browser_screenshot tool definition
 * Capture a screenshot of the current page
 */
export function buildBrowserScreenshotTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_screenshot',
    description:
      'Take a screenshot of the current browser page. Returns the image as base64-encoded data. ' +
      'Use this for visual verification of UI changes, layout inspection, or capturing test evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['png', 'jpeg', 'webp'],
          description: 'Image format (default: "png")',
        },
        quality: {
          type: 'number',
          description:
            'Image quality 0-100 for jpeg/webp (default: 80). Ignored for png.',
        },
        fullPage: {
          type: 'boolean',
          description:
            'Capture the full scrollable page instead of just the viewport (default: false)',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_browser_evaluate tool definition
 * Execute JavaScript in the browser page context
 */
export function buildBrowserEvaluateTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_evaluate',
    description:
      'Execute JavaScript in the browser page context. Returns the result value and type. ' +
      'Use for data extraction, DOM manipulation, form filling, or testing page behavior. ' +
      'Async expressions (await) are supported. Max expression size: 64KB.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'JavaScript expression to evaluate in the page context. Async expressions supported.',
        },
      },
      required: ['expression'],
    },
  };
}

/**
 * Build the ptah_browser_click tool definition
 * Click an element by CSS selector
 */
export function buildBrowserClickTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_click',
    description:
      'Click an element on the page by CSS selector. Returns success or an error if the element was not found. ' +
      'Use ptah_browser_content first to discover available selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector of the element to click (e.g., "#submit-btn", ".nav-link", "button[type=submit]")',
        },
      },
      required: ['selector'],
    },
  };
}

/**
 * Build the ptah_browser_type tool definition
 * Type text into an input element
 */
export function buildBrowserTypeTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_type',
    description:
      'Type text into an input element on the page. Focuses the element first, then types the text. ' +
      'Use for form filling, search inputs, and text editing.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector of the input element (e.g., "#email", "input[name=search]")',
        },
        text: {
          type: 'string',
          description: 'Text to type into the element',
        },
      },
      required: ['selector', 'text'],
    },
  };
}

/**
 * Build the ptah_browser_content tool definition
 * Read page content as HTML and text
 */
export function buildBrowserContentTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_content',
    description:
      'Read the current page content. Returns both HTML and extracted text. ' +
      'Optionally scope to a specific element via CSS selector. ' +
      'Use to understand page structure, find selectors, and extract data.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'Optional CSS selector to scope content extraction (e.g., "#main", ".article-body"). Omit for full page.',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_browser_network tool definition
 * Read captured network requests
 */
export function buildBrowserNetworkTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_network',
    description:
      'Read captured network requests from the browser session. Returns URL, method, status, type, and size ' +
      'for each request. Useful for debugging API calls, checking resource loading, and monitoring AJAX requests.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description:
            'Maximum number of requests to return (default: 50, max: 500)',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_browser_close tool definition
 * Close the browser session
 */
export function buildBrowserCloseTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_close',
    description:
      'Close the browser session and release resources. The session will also auto-close after ' +
      '5 minutes of inactivity or 30 minutes total lifetime.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

/**
 * Build the ptah_browser_status tool definition
 * Get browser session status
 */
export function buildBrowserStatusTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_status',
    description:
      'Get the current browser session status. Returns whether a session is active, the current URL, ' +
      'page title, uptime, and time until auto-close. Use to check if a browser session exists before starting one.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

// ========================================
// Browser Enhancement MCP Tools (TASK_2025_254)
// ========================================

/**
 * Build the ptah_browser_record_start tool definition
 * Start recording the browser session as a GIF
 */
export function buildBrowserRecordStartTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_record_start',
    description:
      'Start recording the browser session as a GIF. Captures frames via CDP Page.startScreencast. ' +
      'A browser session is lazily initialized if none exists. ' +
      'Stop recording with ptah_browser_record_stop to get the GIF file.',
    inputSchema: {
      type: 'object',
      properties: {
        maxFrames: {
          type: 'number',
          description:
            'Maximum frames to capture before ring buffer wraps (default: 500, ~2.5 minutes)',
        },
        frameDelay: {
          type: 'number',
          description:
            'Delay between frames in milliseconds for GIF playback (default: 200ms = ~5fps)',
        },
      },
    },
  };
}

/**
 * Build the ptah_browser_record_stop tool definition
 * Stop recording and return the GIF file path
 */
export function buildBrowserRecordStopTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_record_stop',
    description:
      'Stop recording the browser session. Assembles captured frames into an animated GIF file. ' +
      'Returns the file path, frame count, duration, and file size.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

/**
 * Build the ptah_browser_wait_for_user tool definition
 * Pause agent and prompt user to perform manual actions in visible browser
 */
export function buildBrowserWaitForUserTool(): MCPToolDefinition {
  return {
    name: 'ptah_browser_wait_for_user',
    description:
      'Pause the agent and prompt the user to perform manual actions in the visible browser window ' +
      '(e.g., login, 2FA, CAPTCHA). The agent resumes when the user clicks Ready. ' +
      'Requires visible browser mode (ptah.browser.headless = false). ' +
      'The browser session inactivity timer is paused during the wait.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'Message shown to the user explaining what action to take ' +
            '(e.g., "Please log in to GitHub in the browser window, then click Ready when done")',
        },
        timeout: {
          type: 'number',
          description:
            'Maximum time to wait in milliseconds (default: 300000 = 5 minutes)',
        },
      },
      required: ['message'],
    },
    annotations: { idempotentHint: false },
  };
}

/**
 * Build comprehensive execute_code tool description with full API reference.
 * Uses progressive disclosure: top namespaces inline, rest via ptah.help().
 */
function buildExecuteCodeDescription(): string {
  return `IDE access tool — execute TypeScript/JavaScript code with access to VS Code APIs via the global "ptah" object. Use this for code structure analysis (AST), dependency graphs, LSP operations, and multi-step API workflows.

${PTAH_SYSTEM_PROMPT}

## Top Namespaces (14 total — use ptah.help(topic) for full details)

### ptah.workspace - Workspace Analysis
- analyze(): Promise<{info, structure}> - Full workspace analysis
- getInfo(): Promise<WorkspaceInfo> - Project metadata
- getProjectType(): Promise<string> - Detected type (React, Angular, Node, etc.)
- getFrameworks(): Promise<string[]> - Detected frameworks

### ptah.search - File Discovery
- findFiles(pattern: string, limit?: number): Promise<string[]> - Glob pattern search (returns file paths)
- getRelevantFiles(query: string, maxFiles?: number): Promise<string[]> - Semantic file search (returns file paths)

### ptah.diagnostics - Errors & Warnings
- getErrors(): Promise<{file, message, line}[]> - All error-level diagnostics
- getWarnings(): Promise<{file, message, line}[]> - All warning-level diagnostics
- getAll(): Promise<{file, message, line, severity}[]> - All diagnostics with severity

### ptah.ide - VS Code IDE Superpowers (exclusive to VS Code)
- ide.lsp.getDefinition(file, line, col) - Go to definition
- ide.lsp.getReferences(file, line, col) - Find all references
- ide.lsp.getHover(file, line, col) - Get type info and docs
- ide.editor.getActive() - Active file, cursor, selection
- ide.editor.getOpenFiles() - All open file paths
- ide.actions.rename(file, line, col, newName) - Rename symbol workspace-wide
- ide.actions.organizeImports(file) - Clean imports
- ide.testing.run(options?) - Run tests

### ptah.files - File Operations (READ-ONLY)
- read(path: string): Promise<string> - Read file (path can be relative like 'package.json' or absolute)
- readJson(path: string): Promise<any> - Read and parse JSON (handles comments/trailing commas)
- list(directory: string): Promise<{name, type}[]> - List directory contents

Relative paths are resolved from workspace root. Absolute paths work as-is.
⚠️ IMPORTANT: Use ptah.search.findFiles() to discover files before reading.
⚠️ NO write, delete, exists, or rename methods. This namespace is read-only.

### ptah.json - JSON Validation & Repair
- validate({file, schema?}): Promise<JsonValidateResult> - Validate/repair JSON file, overwrite with clean JSON

Call after writing any JSON file. Extracts JSON from agent output (strips markdown fences, prose),
repairs common issues (trailing commas, single quotes, unquoted keys, comments), and overwrites.

### ptah.project - Project Analysis
- detectMonorepo(): Promise<{isMonorepo, type, workspaceFiles}> - Detect monorepo
- detectType(): Promise<string> - Detect project type (React, Angular, Node, etc.)
- analyzeDependencies(): Promise<{name, version, isDev}[]> - Analyze package dependencies
⚠️ NO getMonorepoInfo(). Use detectMonorepo() instead.

### ptah.ast - Code Structure Analysis (Tree-Sitter) — PREFER OVER FULL FILE READS
- analyze(file): Promise<{functions, classes, imports, exports}> - Full structural analysis with line ranges
- queryFunctions(file): Promise<{name, parameters, startLine, endLine}[]> - All functions
- queryClasses(file): Promise<{name, startLine, endLine}[]> - All classes
- queryImports(file): Promise<{source, importedSymbols}[]> - All imports
- queryExports(file): Promise<{name, kind}[]> - All exports
- parse(file): Promise<{ast, nodeCount}> - Raw AST tree
- getSupportedLanguages(): Promise<string[]> - Supported languages (JS/TS)

Use ptah.ast BEFORE reading files to understand structure at 40-60% token savings.

### ptah.dependencies - Import-Based Dependency Graph
- buildGraph(filePaths, workspaceRoot): Promise<void> - Build the graph (call once)
- getDependencies(file): Promise<string[]> - What this file imports
- getDependents(file): Promise<string[]> - What imports this file
- getSymbolIndex(): Promise<Record<string, string[]>> - Exported symbols per file
- isBuilt(): Promise<boolean> - Check if graph exists

### Other Namespaces (use ptah.help('topic') for details)
- ptah.context.* - Token budget optimization, enrichFile() for structural summaries (40-60% token reduction)
- ptah.relevance.* - File relevance scoring
- ptah.orchestration.* - Workflow state management
- ptah.agent.* - Agent orchestration (spawn, monitor Gemini CLI / Codex SDK / VS Code LM)

## Error Handling
If a call fails, it returns an error message. Use try-catch for robustness:
\`\`\`typescript
try { const files = await ptah.search.findFiles('**/*.ts'); } catch(e) { return 'Error: ' + e.message; }
\`\`\`

## Usage Examples

\`\`\`typescript
// BEST: Discover files FIRST, then read them
const tsFiles = await ptah.search.findFiles('**/*.ts', 100);
const packageFiles = tsFiles.filter(f => f.includes('package'));
if (packageFiles.length > 0) {
  const packageJson = await ptah.files.readJson(packageFiles[0]); // Absolute path from search
  return packageJson.dependencies;
}

// OK: If you KNOW the file exists, use relative path from workspace root
const pkg = await ptah.files.readJson('package.json'); // Resolved to workspace root
return pkg.version;

// Get workspace overview
const {info, structure} = await ptah.workspace.analyze();
return {projectType: info.projectType, frameworks: info.frameworks};

// Find files and filter (findFiles returns string paths)
const files = await ptah.search.findFiles('**/*', 500);
return files.filter(f => f.endsWith('.ts'));

// Find references before refactoring
const refs = await ptah.ide.lsp.getReferences('src/app.ts', 10, 5);
return refs.map(r => r.file + ':' + r.line);

// Check for TypeScript errors
const errors = await ptah.diagnostics.getErrors();
return errors.filter(e => e.file.endsWith('.ts'));

// Analyze code structure (AST)
const insights = await ptah.ast.analyze('src/services/auth.service.ts');
return { functions: insights.functions.map(f => f.name), classes: insights.classes.map(c => c.name) };
\`\`\``;
}
