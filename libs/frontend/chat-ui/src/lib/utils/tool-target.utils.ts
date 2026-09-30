import type { ExecutionStatus } from '@ptah-extension/shared';
import {
  isBashToolInput,
  isEditToolInput,
  isGlobToolInput,
  isGrepToolInput,
  isReadToolInput,
  isWriteToolInput,
} from '@ptah-extension/shared';

/**
 * How a tool call is named and targeted in the UI. One definition shared by
 * the normal view's tool header and the compact session feed, so both read
 * a call the same way. Pure and total: unknown input shapes fall back to the
 * tool name and nothing here throws.
 */
export interface ToolTarget {
  /** Concise target for a one-line row (shortened path, pattern, command). */
  readonly short: string;
  /** Full target for a tooltip; empty when the input has no target. */
  readonly full: string;
  /**
   * What `short` names, before any cut: the Bash description when given,
   * else the command, path, pattern or summary. Empty when there is none.
   */
  readonly text: string;
  /** True when `full` is a file path (Read, Write, Edit). */
  readonly isPath: boolean;
}

export function describeToolTarget(
  toolName: string,
  toolInput: Readonly<Record<string, unknown>> | undefined,
): ToolTarget {
  if (
    isReadToolInput(toolInput) ||
    isWriteToolInput(toolInput) ||
    isEditToolInput(toolInput)
  ) {
    return {
      short: shortenToolPath(toolInput.file_path) || '...',
      full: toolInput.file_path,
      text: toolInput.file_path,
      isPath: true,
    };
  }
  if (isBashToolInput(toolInput)) {
    const command = toolInput.command;
    return {
      short:
        toolInput.description ||
        (command ? truncateToolText(command, 40) : '...'),
      full: command,
      text: toolInput.description || command,
      isPath: false,
    };
  }
  if (isGrepToolInput(toolInput) || isGlobToolInput(toolInput)) {
    return {
      short: truncateToolText(toolInput.pattern, 30) || '...',
      full: toolInput.pattern,
      text: toolInput.pattern,
      isPath: false,
    };
  }
  const summary = toolInput?.['__summary'];
  if (typeof summary === 'string') {
    return {
      short: truncateToolText(summary, 40) || toolName,
      full: summary,
      text: summary,
      isPath: false,
    };
  }
  return { short: toolName, full: '', text: '', isPath: false };
}

/**
 * Ptah MCP server tool, in both naming conventions: `mcp__ptah*` (ptah-cli)
 * and `ptah-ptah_*` (Copilot).
 */
export function isPtahMcpToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__ptah') || toolName.startsWith('ptah-ptah_');
}

/**
 * The name a user reads for a tool. Ptah MCP tools show their short name
 * (`mcp__ptah__workspace_analyze` -> `workspace analyze`,
 * `ptah-ptah_search_files` -> `search files`); others are unchanged.
 */
export function displayToolName(toolName: string): string {
  const mcpMatch = toolName.match(/^mcp__ptah__(.+)$/);
  if (mcpMatch) return mcpMatch[1].replace(/_/g, ' ');
  const cliMatch = toolName.match(/^ptah-\w+?_(.+)$/);
  if (cliMatch) return cliMatch[1].replace(/_/g, ' ');
  return toolName;
}

/** DaisyUI badge colour for a tool call's status, as in the normal view. */
export function toolStatusBadgeClass(status: ExecutionStatus): string {
  if (status === 'complete') return 'badge-success';
  if (status === 'streaming') return 'badge-info';
  if (status === 'error') return 'badge-error';
  return 'badge-ghost';
}

/** `a/b/c/d.ts` -> `.../c/d.ts`; paths of two segments or fewer unchanged. */
export function shortenToolPath(path: string | undefined): string {
  if (!path) return '';
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return path;
  return '.../' + parts.slice(-2).join('/');
}

/** Cut to `maxLen` characters with a trailing `...` when longer. */
export function truncateToolText(
  value: string | undefined,
  maxLen: number,
): string {
  if (!value) return '';
  return value.length > maxLen ? value.substring(0, maxLen) + '...' : value;
}
