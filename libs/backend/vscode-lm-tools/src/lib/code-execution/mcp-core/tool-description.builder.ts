/**
 * MCP Tool Description Builder
 *
 * Generates comprehensive tool descriptions for the MCP protocol.
 * These descriptions help Claude understand all available capabilities.
 */

import { MCPToolDefinition } from '../types';
import {
  CONTEXT_FILE,
  MAX_LABEL_LENGTH,
  MAX_LABELS_PER_TASK,
  SYSTEM_CLI_TYPES,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Task specs (TASK_2026_179, step 17) — ALWAYS-ON core tools
// ---------------------------------------------------------------------------
//
// These five are built unconditionally in `handleToolsList` and are never
// filtered by `disabledMcpNamespaces`. There is deliberately no sixth tool for
// writing prose into the carrier: the carrier is machine-owned metadata and
// the prose doc is agent-owned, and a section-writer would put agent narrative
// onto the very file the Tasks board also mutates. Agents write prose with
// their ordinary file tools.
//
// The status/type enums are spread from the shared canonical lists rather than
// hand-listed, so a new status cannot become describable to the agent without
// also being real.

/** Shared tail so every task tool teaches the same ownership rule. */
const CARRIER_OWNERSHIP_NOTE =
  `The carrier holds metadata only. Write background, plans and discussion to ` +
  `${CONTEXT_FILE} in the same folder using your normal file tools — never into ` +
  `the carrier, which Ptah rewrites.`;

/** Build the ptah_task_create tool definition. */
export function buildTaskCreateTool(): MCPToolDefinition {
  return {
    name: 'ptah_task_create',
    description:
      `Create a task under .ptah/specs/. Allocates the next TASK_YYYY_NNN id, ` +
      `claims the folder atomically, and writes a valid carrier — use this ` +
      `instead of creating the folder and its metadata by hand, which is how ` +
      `task folders end up invisible to the Tasks board. ${CARRIER_OWNERSHIP_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative title' },
        type: {
          type: 'string',
          enum: [...TASK_TYPES],
          description: 'Task type',
        },
        description: {
          type: 'string',
          description: 'One-line summary. Long-form context does NOT go here.',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task folder names this task depends on',
        },
        executor: {
          type: 'string',
          description: 'Agent expected to execute it',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Free-text labels. Matching is case- and whitespace-insensitive, ' +
            'so reuse an existing label rather than inventing a variant of it. ' +
            'Omit entirely when there are none.',
        },
        estimate: {
          type: 'string',
          enum: [...TASK_ESTIMATES],
          description:
            'Relative size, smallest first. It is a rough signal, not a ' +
            'duration, and nothing sums it.',
        },
        parent: {
          type: 'string',
          description:
            'Folder name of the parent task. Parentage is ONE level deep: a ' +
            'parent that itself has a parent is reported as invalid rather ' +
            'than nested further.',
        },
        duplicates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task folder names this task duplicates',
        },
        relatesTo: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Loosely-related task folder names. Declare the relation on ONE ' +
            'side only — the other direction is derived, and writing both ' +
            'sides is how the two disagree later.',
        },
      },
      required: ['title', 'type'],
    },
  };
}

/** Build the ptah_task_update tool definition. */
export function buildTaskUpdateTool(): MCPToolDefinition {
  return {
    name: 'ptah_task_update',
    description:
      `Change a task's status and/or its metadata in one write. Give at least ` +
      `one field besides taskId. Rewrites only the frontmatter, and refuses ` +
      `the write with a retryable TASK_CONFLICT if the carrier changed on disk ` +
      `since it was read — so a concurrent edit is reported rather than ` +
      `silently discarded. On TASK_CONFLICT, re-read with ptah_task_get and retry. ` +
      `EVERY field is a FULL REPLACEMENT, never a merge: to add one label, read ` +
      `the task first and send the complete new array. An empty array or null ` +
      `REMOVES the field (dependsOn is the exception — [] clears it in place).`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task folder name, e.g. TASK_2026_179',
        },
        status: {
          type: 'string',
          enum: [...TASK_STATUSES],
          description: 'New status',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description:
            `Complete replacement label set (max ${MAX_LABELS_PER_TASK}, each ` +
            `at most ${MAX_LABEL_LENGTH} characters, no newlines). [] removes ` +
            `all labels. Call ptah_task_list first and reuse an existing label ` +
            `rather than inventing a near-duplicate.`,
        },
        estimate: {
          type: ['string', 'null'],
          enum: [...TASK_ESTIMATES, null],
          description: 'T-shirt size. null removes the field.',
        },
        parent: {
          type: ['string', 'null'],
          description:
            'Folder name of the parent task. Parentage is ONE level deep — a ' +
            'parent that itself has a parent is rejected. null removes it.',
        },
        duplicates: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Complete replacement list of task folders this one duplicates. ' +
            '[] removes the field.',
        },
        relatesTo: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Complete replacement list of loosely-related task folders. [] ' +
            'removes the field.',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Complete replacement dependency list. There is no "blocks" ' +
            "field: to record that A blocks B, add A to B's dependsOn.",
        },
      },
      required: ['taskId'],
    },
  };
}

/** Build the ptah_task_get tool definition. */
export function buildTaskGetTool(): MCPToolDefinition {
  return {
    name: 'ptah_task_get',
    description:
      'Read one task: its metadata, its carrier body, and the documents present ' +
      'in its folder. Metadata includes labels, estimate, parent, duplicates ' +
      'and relatesTo. Returns TASK_NOT_FOUND when the folder has no carrier.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task folder name, e.g. TASK_2026_179',
        },
      },
      required: ['taskId'],
    },
    annotations: { readOnlyHint: true },
  };
}

/** Build the ptah_task_list tool definition. */
export function buildTaskListTool(): MCPToolDefinition {
  return {
    name: 'ptah_task_list',
    description:
      'List tasks, optionally filtered by status and/or type. Every task ' +
      'carries its labels, estimate, parent, duplicates and relatesTo, so use ' +
      'this to discover which labels a workspace already uses instead of ' +
      'inventing new ones. Use it to find the highest existing id too, rather ' +
      'than reading a generated registry, which can be stale.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'array',
          items: { type: 'string', enum: [...TASK_STATUSES] },
          description: 'Only include these statuses',
        },
        type: {
          type: 'array',
          items: { type: 'string', enum: [...TASK_TYPES] },
          description: 'Only include these types',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/** Build the ptah_task_check tool definition. */
export function buildTaskCheckTool(): MCPToolDefinition {
  return {
    name: 'ptah_task_check',
    description:
      'Health-check the whole task tree. Names every SKIPPED folder with the ' +
      'typed reason it was skipped, plus every included task carrying a ' +
      'validation warning. Run this when a task folder you expect is missing ' +
      'from the board.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  };
}

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
            'TypeScript/JavaScript code to execute. Has access to "ptah" global object with 21 namespaces. ' +
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
 * True filesystem glob discovery (not a fuzzy index)
 */
export function buildSearchFilesTool(): MCPToolDefinition {
  return {
    name: 'ptah_search_files',
    description:
      'Find files in the workspace by glob pattern. Searches the real filesystem (not a fuzzy index). Returns workspace-relative paths. Respects default workspace excludes (node_modules, dist, .git, etc.).',
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
 * Runtime-agnostic TypeScript/JS diagnostics with honest available/unavailable status
 */
export function buildGetDiagnosticsTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_diagnostics',
    description:
      'Get TypeScript/JavaScript errors and warnings from the workspace diagnostics provider. Returns an honest available/unavailable result with source, status, and flattened diagnostics. Each diagnostic includes file path, line number, severity, and message. PASS `files` WITH THE FILES YOU CHANGED: on a large monorepo an unscoped call type-checks every project and can exceed the call timeout, while a scoped one checks only the projects owning those files and returns in seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['error', 'warning', 'all'],
          description:
            'Filter by severity level (default: "all"). Use "error" to see only errors.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Absolute paths of the files you care about. Narrows the check to the projects that own them, which is dramatically faster on a monorepo. Diagnostics from sibling files in the same project are still reported, so a break your edit caused elsewhere is not hidden. Omit to check the whole workspace.',
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

/**
 * Build the ptah_agent_spawn tool definition
 * Spawn a CLI agent to work on a task in the background
 */
export function buildAgentSpawnTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_spawn',
    description:
      'Spawn a headless agent to work on a task in the background. ' +
      `Supports system CLI agents (${SYSTEM_CLI_TYPES.join(', ')}) and Ptah CLI ` +
      'agents, which are user-configured Anthropic-compatible providers. ' +
      'WHICH of either family exists on this machine is a runtime fact — call ' +
      'ptah_agent_list; do not assume a provider from any list you have read. ' +
      'The agent runs while you continue working. ' +
      'Use ptah_agent_status to check progress and ptah_agent_read to get output. ' +
      'For Ptah CLI agents, pass ptahCliId (from ptah_agent_list). ' +
      'Use modelTier to control capability level: "opus" for complex/architectural tasks, ' +
      '"sonnet" (default) for balanced work, "haiku" for fast/simple tasks. Only applies to Ptah CLI agents. ' +
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
          enum: [...SYSTEM_CLI_TYPES],
          description:
            'Which system CLI agent to use. The enum above is the complete set ' +
            'of adapters this build ships; it is NOT the set installed here. ' +
            'Only CLIs actually installed on this machine will spawn — check ' +
            'ptah_agent_list first; naming an uninstalled CLI fails at spawn time. ' +
            'Omit to use the default (auto-detected or user-configured). ' +
            'Not needed when using ptahCliId.',
        },
        ptahCliId: {
          type: 'string',
          description:
            'ID of a Ptah CLI agent to use (from ptah_agent_list results where cli="ptah-cli"). ' +
            'Ptah CLI agents are user-configured Anthropic-compatible providers. ' +
            'The set is per-user and per-machine, so ptah_agent_list is the only ' +
            'way to know which exist here. When set, cli parameter is ignored.',
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
            'Task-spec folder for shared workspace (e.g., ".ptah/specs/TASK_2026_157"). ' +
            'Agent will write deliverables here.',
        },
        model: {
          type: 'string',
          description:
            'Model override for the CLI agent, as a model id that CLI accepts. ' +
            'Valid ids are per-CLI and change between vendor releases — read them ' +
            'from that agent rather than from any list. ' +
            'Uses user-configured default if omitted.',
        },
        modelTier: {
          type: 'string',
          enum: ['opus', 'sonnet', 'haiku'],
          description:
            'Model capability tier for Ptah CLI agents. Controls which model tier the spawned agent uses. ' +
            '"opus" = most capable (complex architecture, deep analysis), ' +
            '"sonnet" = balanced (default, general coding tasks), ' +
            '"haiku" = fastest (simple tasks, quick lookups). ' +
            "The tier maps to a concrete model through the chosen provider's own " +
            'tier mappings, so the same tier resolves differently per provider — ' +
            'you pick the tier, never the model id. ' +
            'Only applies when ptahCliId is set. Ignored for standard CLI agents.',
        },
        resume_session_id: {
          type: 'string',
          description:
            'Resume a previous CLI agent session by its CLI-native session ID. ' +
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
      'cli, task, startedAt, duration, exitCode, and — when the adapter reports ' +
      'one — the CLI Session ID. That session id is what ptah_agent_spawn takes ' +
      'as resume_session_id, so its presence here is the signal to resume a ' +
      'timed-out agent rather than respawn it and lose its context.',
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

/**
 * Build the ptah_json_validate tool definition
 * Validate and repair JSON files written by AI agents
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
      'Localhost is blocked by default (enable via ptah.browser.allowLocalhost setting). ' +
      'You can control headless mode and viewport size — these take effect when creating a new session.',
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
        headless: {
          type: 'boolean',
          description:
            'Run browser in headless mode — no visible window (default: false). ' +
            'Set to true for background scraping/testing. Set to false (default) for visual verification ' +
            'or when the user needs to interact (login, 2FA, CAPTCHA).',
        },
        viewport: {
          type: 'object',
          description:
            'Browser viewport dimensions (default: 1920x1080 desktop). ' +
            'Common presets: desktop 1920x1080, tablet 768x1024, mobile 375x812.',
          properties: {
            width: {
              type: 'integer',
              description: 'Viewport width in pixels',
              minimum: 1,
              maximum: 7680,
            },
            height: {
              type: 'integer',
              description: 'Viewport height in pixels',
              minimum: 1,
              maximum: 7680,
            },
          },
          required: ['width', 'height'],
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
      'Optionally saves the screenshot to disk in the workspace. ' +
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
        saveTo: {
          type: 'string',
          description:
            'Save screenshot to disk. Use a filename (e.g. "homepage.png") to save under .ptah/screenshots/ in the workspace, ' +
            'or an absolute path. The file extension determines the format if not specified. ' +
            'Omit to return base64 data only without saving.',
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
      'page title, uptime, time until auto-close, headless mode, and viewport dimensions. ' +
      'Use to check if a browser session exists before starting one.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

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
 * Build the ptah_harness_search_skills tool definition
 * Search the installed plugin skill inventory (harness-builder tool)
 */
export function buildHarnessSearchSkillsTool(): MCPToolDefinition {
  return {
    name: 'ptah_harness_search_skills',
    description:
      'Harness-builder tool: search both the locally installed Ptah plugin skills ' +
      '(SKILL.md files under ~/.ptah/plugins, including harness-authored ptah-harness-* plugins) ' +
      'AND the skills.sh marketplace. Each result is tagged with source: "local" or "skills.sh"; ' +
      'skills.sh entries carry their install source (owner/repo), installs count and marketplace url. ' +
      'Returns skill IDs, names, descriptions, plugin IDs, and per-skill enabled/disabled status. ' +
      'Use this when authoring or configuring a harness to discover which skills exist. NOTE: local ' +
      'results are the on-disk plugin inventory, NOT the set of skills you can invoke right now via ' +
      'the Skill tool. A query is required to reach skills.sh; omit it to list only local plugin skills. ' +
      'To install a skills.sh skill, run `npx skills add <owner/repo> --skill <id> -y` via Bash — it ' +
      'lands in ~/.claude/skills and is then natively discovered.\n\n' +
      'READING THE RESULT — the payload carries "status" ("ok" | "degraded") and a per-source ' +
      '"sources" array of {source, status, count, error?}. An empty "skills" list means the ' +
      'marketplace genuinely has nothing ONLY when status is "ok". When status is "degraded" a ' +
      'source failed (network, rate limit, upstream 5xx, already retried three times) and the tool ' +
      'result is flagged as an error — do NOT report "no such skill exists" or start authoring a ' +
      'replacement on the strength of it. Retry, or say the marketplace was unreachable.\n\n' +
      "Descriptions for skills.sh entries are read from each skill's SKILL.md frontmatter on a " +
      'best-effort basis; a blank description means that lookup failed, not that the skill is ' +
      'undocumented — open its url.\n\n' +
      'PAGING — "offset" and "limit" page the skills.sh half; local plugin results are a complete ' +
      'on-disk inventory and are never paged. The result echoes "offset"/"limit" and carries ' +
      '"hasMore" (fetch the next page with offset += limit) and "total" — present ONLY when the ' +
      'whole marketplace result set was seen, never estimated. The skills.sh source entry adds ' +
      '"limitedByUpstream": true when the marketplace\'s own 200-result ceiling was reached, at ' +
      'which point no further page is reachable and the query must be narrowed instead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional search query to filter skills by name or description',
        },
        limit: {
          type: 'number',
          description:
            'skills.sh rows per page (1-200, default 50). Local results are never capped.',
        },
        offset: {
          type: 'number',
          description:
            'skills.sh rows to skip (default 0). Use with hasMore to page; the marketplace caps a query at 200 rows total.',
        },
      },
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_harness_create_skill tool definition
 * Author a new plugin skill on disk (harness-builder tool)
 */
export function buildHarnessCreateSkillTool(): MCPToolDefinition {
  return {
    name: 'ptah_harness_create_skill',
    description:
      'Harness-builder tool: author a new plugin skill on disk. Writes a SKILL.md with YAML ' +
      'frontmatter and the provided markdown content, then returns the skill ID, file path, ' +
      'plugin ID and scope. Use this to persist a reusable skill while building a harness.\n\n' +
      'SCOPE — choose deliberately, because it decides where the skill loads:\n' +
      '- scope:"user" (the DEFAULT) writes ~/.ptah/plugins/ptah-harness-{name}/skills/{name}/SKILL.md ' +
      'and loads in EVERY workspace on this machine.\n' +
      '- scope:"workspace" writes {workspace}/.ptah/plugins/ptah-harness-{name}/skills/{name}/SKILL.md ' +
      'and loads in THIS project only. It sits beside .ptah/specs, so it can be committed and ' +
      'travels with the repository to the whole team. Prefer it for anything that names this ' +
      'codebase, its conventions or its domain. It requires an open workspace folder and fails ' +
      'clearly without one.\n' +
      'The two scopes share one plugin ID, so the same name cannot be used in both — the call is ' +
      'refused rather than letting the workspace copy silently shadow the global one.\n\n' +
      'AVAILABILITY — harness-authored (ptah-harness-*) plugins are active on discovery and need no ' +
      'separate enable step, so the skill is normally invocable from the next turn of this session ' +
      'onward; copies reach the other CLI harness directories at the next harness reconcile. Call ' +
      'ptah_harness_search_skills to confirm rather than assuming either way.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Skill name (will be sanitized to kebab-case for file paths)',
        },
        description: {
          type: 'string',
          description: 'Brief description of what this skill does',
        },
        content: {
          type: 'string',
          description:
            'Full markdown content for the SKILL.md body (instructions, examples, constraints)',
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of tools this skill is allowed to use',
        },
        scope: {
          type: 'string',
          enum: ['user', 'workspace'],
          description:
            '"user" (default) loads everywhere on this machine; "workspace" loads only in this project and can be committed with it.',
        },
      },
      required: ['name', 'description', 'content'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  };
}

/**
 * Build the ptah_harness_search_mcp_registry tool definition
 *
 * Searches the three catalogue sources. The description deliberately tells the
 * agent what this tool CANNOT see — vendors that host their own remote MCP
 * endpoint are usually absent from all three — and points it at web search as
 * the fallback, so the user is never asked to paste an official URL by hand.
 */
export function buildHarnessSearchMcpRegistryTool(): MCPToolDefinition {
  return {
    name: 'ptah_harness_search_mcp_registry',
    description:
      'Harness-builder tool: search the official MCP Server Registry ' +
      '(registry.modelcontextprotocol.io), the PulseMCP directory (a trusted ' +
      'online catalogue of vendor/community servers — e.g. Autodesk, IFC, ' +
      'Procore — not present in the official registry), AND, when a Smithery ' +
      'API key is configured, the Smithery registry for servers matching a ' +
      'query. Each result is tagged with source: "official", "pulsemcp", or ' +
      '"smithery". Returns server names and descriptions. Use specific ' +
      'technology or vendor keywords (e.g., "github", "postgresql", "autodesk") ' +
      'for best results. Pair with ptah_harness_list_installed_mcp to see which ' +
      'servers are already configured before adding more, and install a chosen ' +
      'server with ptah_harness_install_mcp_server.\n\n' +
      'COVERAGE LIMIT — these three sources are catalogues of PUBLISHED ' +
      'packages. A vendor that hosts its own remote MCP endpoint is usually in ' +
      'NONE of them (Apollo, HubSpot, Zernio, Sentry, Notion and Linear all ' +
      'return nothing here). So when the user names a specific product and this ' +
      'tool returns no relevant hit, do NOT conclude the server does not exist ' +
      'and do NOT ask the user for a link. Fall back to ptah_web_search — query ' +
      'the vendor\'s own documentation (e.g. "<vendor> MCP server endpoint ' +
      'docs") and the official Claude connectors directory at ' +
      'claude.com/connectors, which lists vendor-hosted remote servers. Remote ' +
      'servers need only their HTTPS endpoint URL: Ptah connects them via OAuth ' +
      'with dynamic client registration (RFC 9728 / 8414 / 7591), so no API key ' +
      'or manual client setup is required.\n\n' +
      "TRUST RULE — only accept an endpoint URL published on the vendor's own " +
      'domain or in the official connectors directory. Never connect a URL ' +
      'scraped from a blog, forum or third-party listicle: OAuth dynamic client ' +
      "registration would hand that server the user's real credentials. If you " +
      'cannot confirm the endpoint from an authoritative source, say so and ' +
      'stop rather than guessing a URL.\n\n' +
      'READING THE RESULT — "limit" bounds the MERGED list, which is drawn ' +
      'round-robin from the three sources so none can starve the others, and ' +
      'duplicate server names are dropped. The payload carries "status" ("ok" | ' +
      '"degraded") and a per-source "sources" array of {source, status, count, ' +
      'error?}; when a source fails the others are still returned, status is ' +
      '"degraded" and the tool result is flagged as an error, so an empty list ' +
      'is only a true negative while status is "ok".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — use specific technology or tool names',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of results in the merged list across all sources (default: 10)',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  };
}

/**
 * Build the ptah_harness_list_installed_mcp tool definition
 * List MCP servers configured in the workspace
 */
export function buildHarnessListInstalledMcpTool(): MCPToolDefinition {
  return {
    name: 'ptah_harness_list_installed_mcp',
    description:
      'Harness-builder tool: list the MCP servers already configured in the workspace. ' +
      'Reads from .vscode/mcp.json and .mcp.json in the workspace root and returns each ' +
      "server's name, config, and source file. Use this to check what is already available " +
      'before searching the registry with ptah_harness_search_mcp_registry.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_harness_install_mcp_server tool definition
 * Write an MCP server entry into the workspace/CLI config files
 */
export function buildHarnessInstallMcpTool(): MCPToolDefinition {
  return {
    name: 'ptah_harness_install_mcp_server',
    description:
      'Harness-builder tool: install an MCP server into the workspace by writing its transport ' +
      'config to the selected target config files (claude -> .mcp.json, vscode -> .vscode/mcp.json, ' +
      'cursor -> .cursor/mcp.json, copilot -> ~/.copilot/mcp-config.json). Defaults to ' +
      '["claude","vscode"]. Discover a server first with ptah_harness_search_mcp_registry and check ' +
      'ptah_harness_list_installed_mcp so you do not re-install one that is already configured. ' +
      'You must supply the transport config yourself — the registry entry tells you the package/URL. ' +
      'Returns the resolved server key, the config files written, and per-target warnings. NOTE: the ' +
      'server becomes available to a NEW agent session, not the current one.',
    inputSchema: {
      type: 'object',
      properties: {
        serverName: {
          type: 'string',
          description:
            'Fully qualified registry name used for install tracking (e.g. "io.github.owner/server").',
        },
        config: {
          type: 'object',
          description:
            'Transport config. stdio: {"type":"stdio","command":"npx","args":["-y","pkg"],"env":{}}. ' +
            'Remote: {"type":"http"|"sse","url":"https://...","headers":{}}.',
        },
        serverKey: {
          type: 'string',
          description:
            'Optional config key (e.g. "github"). Defaults to the last path segment of serverName, sanitized.',
        },
        targets: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'vscode',
              'claude',
              'cursor',
              'copilot',
              'codex',
              'antigravity',
            ],
          },
          description:
            'Optional install targets. Defaults to ["claude","vscode"].',
        },
      },
      required: ['serverName', 'config'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  };
}

/**
 * Build the ptah_harness_propose_config tool definition
 *
 * The sixth harness method, and the one that closes the loop: the other five
 * discover and install, this one hands the assembled configuration back to the
 * surface for the user to review. It was reachable only from `execute_code`
 * (`ptah.harness.proposeConfig`), so an agent working from the MCP tool list
 * finished a long build with nowhere to put the result and improvised a
 * markdown file instead.
 */
export function buildHarnessProposeConfigTool(): MCPToolDefinition {
  return {
    name: 'ptah_harness_propose_config',
    description:
      'Harness-builder tool: propose harness configuration to the surface for user review. ' +
      'Call it repeatedly as decisions firm up — each call is a partial update, merged into the ' +
      'configuration the user sees, so send only the fields you have settled. Call it a final ' +
      'time with isConfigComplete=true when the harness is finished. Fields (all optional): ' +
      'name, persona {label, description, goals[], templateId?}, agents {enabledAgents, ' +
      'harnessSubagents[]}, skills {selectedSkills[], selectedSkillRefs[], createdSkills[]}, ' +
      'prompt {systemPrompt, enhancedSections}, mcp {servers[], enabledTools}, claudeMd ' +
      '{generateProjectClaudeMd, customSections, previewContent}. A skill ref is ' +
      '{skillId, source?: "local"|"skills.sh", installSource?} — copy installSource verbatim from ' +
      'the ptah_harness_search_skills result so Apply can install it. Unknown keys are rejected: ' +
      'the error names the offending path, so fix and re-send rather than writing the config to a ' +
      'file. This is the ONLY way to hand a structured harness config to the user for approval.',
    inputSchema: {
      type: 'object',
      properties: {
        configUpdates: {
          type: 'object',
          description:
            'Partial harness configuration. Only the fields listed in the tool description are accepted.',
        },
        isConfigComplete: {
          type: 'boolean',
          description:
            'Set true on the final call to mark the harness ready for the user to apply. Defaults to false.',
        },
      },
      required: ['configUpdates'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  };
}

/**
 * Build the ptah_ast_analyze tool definition
 * Tree-sitter structural analysis — functions/classes/imports/exports
 */
export function buildAstAnalyzeTool(): MCPToolDefinition {
  return {
    name: 'ptah_ast_analyze',
    description:
      'Analyze a JavaScript/TypeScript file with Tree-sitter and return its structure — functions, classes, imports, and exports with line ranges — WITHOUT reading the full file (40-60% fewer tokens). Use this before reading a file to understand its shape and decide what to read. Prefer an absolute file path; when multiple workspaces are open, either pass an absolute path or set workspaceRoot so a relative path resolves against the intended workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description:
            'File path. Absolute is safest. A relative path resolves against workspaceRoot when provided, otherwise the active workspace root.',
        },
        workspaceRoot: {
          type: 'string',
          description:
            'Optional absolute workspace root to resolve a relative file path against. Omit to use the active workspace. Set this to disambiguate when multiple workspaces are open (ignored when file is already absolute).',
        },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_context_enrich_file tool definition
 * .d.ts-style structural summary of a file
 */
export function buildContextEnrichFileTool(): MCPToolDefinition {
  return {
    name: 'ptah_context_enrich_file',
    description:
      "Generate a .d.ts-style structural summary of a file — imports, class outlines, and function signatures without bodies — for a large token reduction over reading the whole file. Use when you need a file's API surface, not its implementation.",
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
        language: {
          type: 'string',
          enum: ['typescript', 'javascript'],
          description: 'Optional language hint',
        },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_get_dependents tool definition
 * Reverse import edges — what imports this file (refactor blast radius)
 */
export function buildGetDependentsTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_dependents',
    description:
      'List the files that import the given file (reverse dependency edges). Essential for assessing blast radius before changing or renaming a module. Builds the workspace import graph on first use, then answers from cache.',
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

/**
 * Build the ptah_get_dependencies tool definition
 * Forward import edges — what this file imports
 */
export function buildGetDependenciesTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_dependencies',
    description:
      'List the files that the given file imports (forward dependency edges). Use to understand what a module depends on. Builds the workspace import graph on first use, then answers from cache.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (absolute or relative to workspace root)',
        },
        depth: {
          type: 'number',
          description: 'Transitive traversal depth, 1-3 (default: 1)',
        },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_code_search_symbols tool definition
 * Hybrid BM25 + vector search over the indexed workspace symbol table
 */
export function buildCodeSearchSymbolsTool(): MCPToolDefinition {
  return {
    name: 'ptah_code_search_symbols',
    description:
      'Search indexed workspace code symbols (functions, classes, methods) by semantic description using hybrid BM25 + vector search. Prefer this over Grep to find a symbol by what it does across files. Returns symbol hits with file path, kind, name, and score. NOTE: backed by the SQLite symbol index — returns an "index unavailable" result on runtimes without it (e.g. VS Code); fall back to ptah_search_files or Grep in that case.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural-language description of the symbol to find (e.g. "validate auth token")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum hits to return (default: 20)',
        },
        filePath: {
          type: 'string',
          description:
            'Optional: restrict results to symbols in this file path',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_memory_search tool definition
 * Hybrid search over persistent cross-session memory
 */
export function buildMemorySearchTool(): MCPToolDefinition {
  return {
    name: 'ptah_memory_search',
    description:
      'Search persistent memory from past sessions (facts, preferences, prior decisions) using hybrid BM25 + vector search. Call this when the user references past work ("last time", "previously", "the X we set up") or when prior context would help. Defaults to the active workspace scope. NOTE: backed by the memory store — returns a "not available" result on runtimes without it (e.g. VS Code).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to recall (natural language)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum memory hits to return (default: 10, max: 50)',
        },
        global: {
          type: 'boolean',
          description:
            'Search across all workspaces instead of just the active one (default: false)',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_relevance_rank_files tool definition
 * Semantic file triage — rank files by relevance to a query
 */
export function buildRelevanceRankFilesTool(): MCPToolDefinition {
  return {
    name: 'ptah_relevance_rank_files',
    description:
      'Rank workspace files by relevance to a natural-language query, each with a 0-100 score and the reasons behind it. Use to triage which files to open first for a task instead of guessing — prefer over scanning many files with Read/Grep.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you are looking for (natural language)',
        },
        limit: {
          type: 'number',
          description: 'Maximum files to return (default: 20)',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_project_detect_monorepo tool definition
 * Identify monorepo tooling and layout
 */
export function buildProjectDetectMonorepoTool(): MCPToolDefinition {
  return {
    name: 'ptah_project_detect_monorepo',
    description:
      'Detect whether the workspace is a monorepo and identify the tool (nx, lerna, turborepo, pnpm/yarn workspaces). Returns isMonorepo, type, the config files that indicated it, and package count when detectable. Use to understand workspace layout before navigating a multi-package repo.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the ptah_get_symbol_index tool definition
 * Map of file -> exported symbol names from the import graph
 */
export function buildGetSymbolIndexTool(): MCPToolDefinition {
  return {
    name: 'ptah_get_symbol_index',
    description:
      'List the exported symbols for every file in the workspace import graph (a map of file path to exported symbol names). Use to discover where a symbol is exported from, or to get an at-a-glance map of the public surface. Builds the workspace import graph on first use, then answers from cache.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  };
}

/**
 * Build the concise execute_code description. Tool-specific details stay here;
 * discover the complete API at runtime with ptah.help().
 */
function buildExecuteCodeDescription(): string {
  return `Execute TypeScript/JavaScript against the global \`ptah\` API for multi-step workflows only.

Prefer direct \`ptah_*\` tools: they are more focused and have lower overhead. Use \`ptah.help(topic)\` to discover APIs when execute_code is necessary.

\`ptah.files\` is read-only. Never use execute_code to create or edit files; use the native CLI write/edit tools instead.

Examples:
\`const info = await ptah.workspace.getInfo(); return info;\`
\`const files = await ptah.search.findFiles('**/*.ts', 20); return files;\``;
}
