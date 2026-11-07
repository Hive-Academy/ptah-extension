/**
 * Tool privilege for an MCP caller.
 *
 * One table for `tools/list` and `tools/call`. A name that is not listed is
 * class `agent-control`, so a new tool stays denied to read-only callers
 * until it is added here. `privileged` permits every class.
 *
 * `MCP_LEGACY_UNTOKENED_READ_ONLY` is the grace-period switch. The release
 * after this one sets it to false; missing tokens then fail closed.
 */

import type { McpCallerCapability } from '@ptah-extension/platform-core';

/** Accept a POST with no token as read-only for one release. */
export const MCP_LEGACY_UNTOKENED_READ_ONLY = true;

export type McpToolClass =
  | 'read'
  | 'agent-control'
  | 'file-mutation'
  | 'task-git-mutation'
  | 'browser-control'
  | 'harness-mutation'
  | 'approval'
  | 'execute-code'
  | 'network';

/**
 * Read tools. `ptah_task_check` is included because its handler only lists
 * validation issues (`tasks-namespace.builder.ts` `check`); it does not write.
 */
const READ_TOOLS: ReadonlySet<string> = new Set([
  'ptah_workspace_analyze',
  'ptah_search_files',
  'ptah_get_diagnostics',
  'ptah_count_tokens',
  'ptah_ast_analyze',
  'ptah_context_enrich_file',
  'ptah_get_dependents',
  'ptah_get_dependencies',
  'ptah_get_symbol_index',
  'ptah_code_search_symbols',
  'ptah_memory_search',
  'ptah_relevance_rank_files',
  'ptah_project_detect_monorepo',
  'ptah_lsp_references',
  'ptah_lsp_definitions',
  'ptah_get_dirty_files',
  'ptah_json_validate',
  'ptah_task_get',
  'ptah_task_list',
  'ptah_task_check',
  'ptah_git_worktree_list',
  'ptah_agent_list',
  'ptah_agent_status',
  'ptah_agent_read',
  'ptah_agent_message_status',
  'ptah_session_status',
  'ptah_session_read',
  'ptah_harness_search_skills',
  'ptah_harness_search_mcp_registry',
  'ptah_harness_list_installed_mcp',
  'ptah_surface_get_state',
]);

const AGENT_CONTROL_TOOLS: ReadonlySet<string> = new Set([
  'ptah_agent_spawn',
  'ptah_agent_message',
  'ptah_agent_message_control',
  'ptah_agent_message_ack',
  'ptah_agent_report',
  'ptah_agent_stop',
  'ptah_agent_wait',
  'ptah_session_start',
  'ptah_session_send',
  'ptah_session_stop',
  'ptah_session_handoff',
  'ptah_route_decide',
  'ptah_outcome_report',
  'ptah_run_check',
  'ptah_run_check_wait',
]);

const TASK_GIT_TOOLS: ReadonlySet<string> = new Set([
  'ptah_task_create',
  'ptah_task_update',
  'ptah_session_link_task',
  'ptah_git_worktree_add',
  'ptah_git_worktree_remove',
]);

const HARNESS_TOOLS: ReadonlySet<string> = new Set([
  'ptah_harness_create_skill',
  'ptah_harness_install_mcp',
  'ptah_harness_propose_config',
  'ptah_code_reindex',
  'ptah_artifact_publish',
  'ptah_dashboard_propose_spec',
  'ptah_surface_update',
]);

/** Class of one tool name. Unknown names are `agent-control`. */
export function toolClass(name: string): McpToolClass {
  if (name.startsWith('ptah_browser_')) return 'browser-control';
  if (name === 'execute_code') return 'execute-code';
  if (name === 'approval_prompt') return 'approval';
  if (name === 'ptah_web_search') return 'network';
  if (READ_TOOLS.has(name)) return 'read';
  if (AGENT_CONTROL_TOOLS.has(name)) return 'agent-control';
  if (TASK_GIT_TOOLS.has(name)) return 'task-git-mutation';
  if (HARNESS_TOOLS.has(name)) return 'harness-mutation';
  return 'agent-control';
}

/**
 * Tools a `lane-report` caller may call beyond the read class: its own report,
 * message status, and the ack of a message delivered to it. Each one acts only
 * as the bound lane. Sending (`ptah_agent_message`) and retry or cancel
 * (`ptah_agent_message_control`) stay privileged.
 */
const LANE_REPORT_TOOLS: ReadonlySet<string> = new Set([
  'ptah_agent_report',
  'ptah_agent_message_status',
  'ptah_agent_message_ack',
]);

/**
 * Read-only permits class `read`. Lane-report also permits
 * `LANE_REPORT_TOOLS`. Privileged permits every class.
 */
export function isToolPermitted(
  name: string,
  capability: McpCallerCapability,
): boolean {
  if (capability === 'privileged') return true;
  if (toolClass(name) === 'read') return true;
  return capability === 'lane-report' && LANE_REPORT_TOOLS.has(name);
}
