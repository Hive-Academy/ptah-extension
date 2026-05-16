/**
 * Permission Tool Classifier — pure tool-category tables and classification helpers.
 *
 * Extracted from `sdk-permission-handler.ts` as .
 * These are stateless constants + pure functions; they have no DI surface and are
 * library-internal. See `permission-description.ts` for description generation.
 */

/**
 * Safe tools that are auto-approved without user prompt
 * These are read-only operations that cannot modify system state
 */
export const SAFE_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'TodoWrite',
  'EnterPlanMode',
  'KillShell',
  'TaskStop',
  'ListMcpResources',
  'ReadMcpResource',
  'TaskOutput',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'Skill',
  'ToolSearch',
];

/**
 * Dangerous tools that require user approval
 * These can modify files, execute code, or perform destructive operations
 */
export const DANGEROUS_TOOLS = ['Write', 'Edit', 'Bash', 'NotebookEdit'];

/**
 * Network tools that require user approval
 * These make external network requests
 */
export const NETWORK_TOOLS = ['WebFetch', 'WebSearch'];

/**
 * Subagent tools that are auto-approved
 * The Task tool spawns subagents - auto-approve since the user initiated the session
 */
export const SUBAGENT_TOOLS = ['Task'];

/**
 * File editing tools that are auto-approved in 'auto-edit' mode
 * and for background sub-agents (matching SDK acceptEdits semantics)
 */
export const AUTO_EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

/**
 * Check if a tool name is an MCP tool (prefixed with "mcp__")
 * MCP tools should always require user approval as they can execute arbitrary code
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}
