import type { CodexApprovalRequest } from '@ptah-extension/codex-runtime';

/**
 * How a native Codex App Server tool call or approval request is presented to
 * the chat tree, which renders Claude tool names. Pure and total: unknown
 * names and shapes pass through unchanged, and nothing here throws, mutates
 * its input, or performs I/O.
 *
 * Every mapping follows what the tree's renderers actually read:
 * - `Bash` renders from `command` alone (isBashToolInput, shared
 *   type-guards/guards/exec.ts:178-185): the header shows the description or
 *   the command's first line (tool-call-header.component.ts:350-358) and the
 *   body a "Command" block (tool-input-display.component.ts:277-285).
 * - A `Write`/`Edit` header shows a clickable `file_path` from the name-based
 *   fallback alone (tool-call-header.component.ts:413-426), but only `Write`
 *   also renders its input in the body: an `Edit` card suppresses its input
 *   (tool-input-display.component.ts:441-444) and renders its diff only from
 *   `old_string`/`new_string` (tool-output-display.component.ts:181-186 via
 *   isEditToolInput, shared type-guards/guards/fs.ts:198-209), which a Codex
 *   change (a unified diff) cannot supply.
 * - `mcp__server__tool` renders a `server ·` prefix
 *   (tool-call-header.component.ts:124-133 via splitMcpToolName,
 *   tool-target.utils.ts:336-349).
 */

/** Longest approval description presented; longer text is cut. */
const DESCRIPTION_MAX_CHARS = 500;

/** A non-empty string value, or undefined. */
function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** An object's own fields; anything else reads as empty. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Cut a description to the presentation cap, marking the cut. */
function cap(description: string): string {
  return description.length > DESCRIPTION_MAX_CHARS
    ? description.slice(0, DESCRIPTION_MAX_CHARS - 1) + '…'
    : description;
}

/** A call under a new name; the input passes through unchanged. */
function named(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined,
): { toolName: string; toolInput?: Record<string, unknown> } {
  return input === undefined ? { toolName } : { toolName, toolInput: input };
}

/**
 * Present a native tool call with the tool name and input the chat tree
 * renders for the equivalent Claude tool. Unknown names and shapes pass
 * through unchanged.
 */
export function presentCodexTool(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined,
): { toolName: string; toolInput?: Record<string, unknown> } {
  if (toolName === 'commandExecution') {
    const command = input?.['command'];
    if (typeof command !== 'string') return named(toolName, input);
    const cwd = input?.['cwd'];
    return {
      toolName: 'Bash',
      toolInput: { command, ...(cwd ? { cwd } : {}) },
    };
  }
  if (toolName === 'webSearch') {
    // The header target renders the query (isWebSearchToolInput,
    // tool-target.utils.ts:102-110); the icon falls to the default terminal
    // (tool-icon.component.ts:85-87), exactly as the raw name would.
    return { toolName: 'WebSearch', toolInput: { query: input?.['query'] } };
  }
  if (toolName === 'fileChange') return presentFileChange(input);
  // An mcpToolCall arrives as `server/tool`; the tree's MCP name is
  // `mcp__server__tool`. Both split parts must be non-empty.
  const separator = toolName.indexOf('/');
  if (separator > 0 && separator < toolName.length - 1) {
    return named(
      `mcp__${toolName.slice(0, separator)}__${toolName.slice(separator + 1)}`,
      input,
    );
  }
  return named(toolName, input);
}

/**
 * Present a file change. A single `add` maps to a Claude `Write`: the header
 * shows the clickable path (tool-call-header.component.ts:413-426) and the
 * body lists `file_path` and `changes` as argument rows
 * (tool-input-display.component.ts:322-341). An `update` does not map: an
 * `Edit` card hides its input body and renders its diff only from
 * `old_string`/`new_string`, so it keeps the raw `fileChange` name.
 */
function presentFileChange(
  input: Readonly<Record<string, unknown>> | undefined,
): { toolName: string; toolInput?: Record<string, unknown> } {
  const changes = input?.['changes'];
  if (!Array.isArray(changes) || changes.length !== 1)
    return named('fileChange', input);
  const change = record(changes[0]);
  const path = nonEmptyText(change['path']);
  if (record(change['kind'])['type'] !== 'add' || path === undefined)
    return named('fileChange', input);
  return { toolName: 'Write', toolInput: { file_path: path, changes } };
}

/**
 * Present an approval request with the tool name, input and description the
 * permission card renders. Descriptions carry no protocol ids and are capped.
 */
export function presentCodexApproval(request: CodexApprovalRequest): {
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
} {
  const details = request.details;
  switch (request.kind) {
    case 'command': {
      const tool = presentCodexTool('commandExecution', {
        command: details['command'],
        cwd: details['cwd'],
      });
      const reason = nonEmptyText(details['reason']);
      const command =
        typeof details['command'] === 'string' ? details['command'] : undefined;
      return {
        toolName: tool.toolName,
        toolInput: tool.toolInput ?? {},
        description: cap(
          reason ?? (command !== undefined ? `Run: ${command}` : 'Run a command'),
        ),
      };
    }
    case 'fileChange': {
      // The approval carries no change details, so it takes the name the
      // fileChange tool maps to for an unknown single change: raw
      // `fileChange`, because only `add` maps and never to `Edit`.
      const reason = nonEmptyText(details['reason']);
      const grantRoot = nonEmptyText(details['grantRoot']);
      return {
        toolName: 'fileChange',
        toolInput: grantRoot === undefined ? {} : { grantRoot },
        description: cap(
          `${reason ?? 'Apply file changes'}` +
            (grantRoot === undefined ? '' : ` (${grantRoot})`),
        ),
      };
    }
    case 'permissions': {
      const reason = nonEmptyText(details['reason']);
      const cwd = nonEmptyText(details['cwd']);
      return {
        toolName: 'Permissions',
        toolInput: {
          ...(cwd === undefined ? {} : { cwd }),
          ...(details['permissions'] === undefined
            ? {}
            : { permissions: details['permissions'] }),
        },
        description: cap(
          reason === undefined
            ? cwd === undefined
              ? 'Grant requested permissions'
              : `Grant permissions in ${cwd}`
            : cwd === undefined
              ? reason
              : `${reason} (in ${cwd})`,
        ),
      };
    }
    case 'mcpElicitation': {
      const server = nonEmptyText(details['serverName']);
      return {
        toolName:
          server === undefined
            ? 'mcpElicitation'
            : `mcp__${server}__elicitation`,
        // An elicitation asks a question, not a tool input; its message is
        // the description and its server is in the name.
        toolInput: {},
        description: cap(
          nonEmptyText(details['message']) ??
            nonEmptyText(details['reason']) ??
            request.message,
        ),
      };
    }
    case 'userInput':
      return {
        toolName: 'userInput',
        toolInput:
          details['questions'] === undefined
            ? {}
            : { questions: details['questions'] },
        description: cap(request.message),
      };
  }
}