/**
 * Permission Description Helpers — pure functions.
 *
 * Extracted from `sdk-permission-handler.ts` as .
 * Contains:
 *   - `generateDescription()` — human-readable tool description for the UI prompt.
 *   - `sanitizeToolInput()` — redacts secrets from tool inputs before display.
 *   - `generateRequestId()` — unique request ID generator.
 *
 * Pure functions; no DI, no state. Library-internal.
 */

import {
  isBashToolInput,
  isEditToolInput,
  isGlobToolInput,
  isGrepToolInput,
  isNotebookEditToolInput,
  isReadToolInput,
  isWriteToolInput,
  isExitPlanModeToolInput,
} from '@ptah-extension/shared';
import { isMcpTool } from './permission-tool-classifier';

/**
 * Generate human-readable description for permission request
 *
 * Creates a meaningful description based on tool type and input parameters.
 * Used in the webview permission UI to help users understand what's being requested.
 */
export function generateDescription(
  toolName: string,
  input: Record<string, unknown>,
): string {
  // Handle MCP tools (format: mcp__server-name__tool-name)
  if (isMcpTool(toolName)) {
    const parts = toolName.split('__');
    if (parts.length >= 3) {
      const serverName = parts[1];
      const toolNameOnly = parts.slice(2).join('__');
      return `Execute MCP tool "${toolNameOnly}" from server "${serverName}"`;
    }
    return `Execute MCP tool: ${toolName}`;
  }

  switch (toolName) {
    case 'Bash': {
      if (isBashToolInput(input)) {
        const truncated =
          input.command.length > 100
            ? `${input.command.substring(0, 100)}...`
            : input.command;
        return `Execute bash command: ${truncated}`;
      }
      return 'Execute a bash command';
    }

    case 'Write': {
      if (isWriteToolInput(input)) {
        return `Write to file: ${input.file_path}`;
      }
      return 'Write to a file';
    }

    case 'Edit': {
      if (isEditToolInput(input)) {
        return `Edit file: ${input.file_path}`;
      }
      return 'Edit a file';
    }

    case 'NotebookEdit': {
      if (isNotebookEditToolInput(input)) {
        return `Edit notebook: ${input.notebook_path}`;
      }
      return 'Edit a Jupyter notebook';
    }

    case 'Read': {
      if (isReadToolInput(input)) {
        return `Read file: ${input.file_path}`;
      }
      return 'Read a file';
    }

    case 'Grep': {
      if (isGrepToolInput(input)) {
        return `Search for pattern: ${input.pattern}`;
      }
      return 'Search file contents';
    }

    case 'Glob': {
      if (isGlobToolInput(input)) {
        return `Find files matching: ${input.pattern}`;
      }
      return 'Find files';
    }

    case 'WebFetch': {
      const url = input['url'];
      if (typeof url === 'string') {
        const truncated = url.length > 80 ? `${url.substring(0, 80)}...` : url;
        return `Fetch web content from: ${truncated}`;
      }
      return 'Fetch content from a URL';
    }

    case 'WebSearch': {
      const query = input['query'];
      if (typeof query === 'string') {
        const truncated =
          query.length > 80 ? `${query.substring(0, 80)}...` : query;
        return `Web search: ${truncated}`;
      }
      return 'Perform a web search';
    }

    case 'ExitPlanMode': {
      if (isExitPlanModeToolInput(input)) {
        const planPreview =
          input.plan.length > 200
            ? `${input.plan.substring(0, 200)}...`
            : input.plan;
        return `Exit plan mode and execute plan: ${planPreview}`;
      }
      return 'Exit plan mode and clear context to begin execution';
    }

    default:
      return `Execute tool: ${toolName}`;
  }
}

/**
 * Sanitize tool input before showing to user
 *
 * Removes sensitive data like API keys, tokens, credentials.
 * Prevents accidental exposure of secrets in permission prompts.
 */
export function sanitizeToolInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const sanitized = { ...input };

  // Sanitize environment variables
  const env = sanitized['env'];
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    const envRecord = env as Record<string, unknown>;
    sanitized['env'] = Object.keys(envRecord).reduce(
      (acc, key) => {
        // Redact keys that likely contain secrets
        const isSecret =
          key.toUpperCase().includes('KEY') ||
          key.toUpperCase().includes('TOKEN') ||
          key.toUpperCase().includes('SECRET') ||
          key.toUpperCase().includes('PASSWORD') ||
          key.toUpperCase().includes('API');

        acc[key] = isSecret ? '***REDACTED***' : envRecord[key];
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  // Sanitize command strings that might contain secrets
  const command = sanitized['command'];
  if (command && typeof command === 'string') {
    // Simple heuristic: if command contains key-like patterns, warn user
    if (
      command.includes('KEY=') ||
      command.includes('TOKEN=') ||
      command.includes('PASSWORD=')
    ) {
      sanitized['_securityWarning'] =
        'Command may contain sensitive credentials';
    }
  }

  return sanitized;
}

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `perm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
