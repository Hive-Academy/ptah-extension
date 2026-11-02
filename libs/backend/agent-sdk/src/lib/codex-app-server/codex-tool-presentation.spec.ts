import type {
  CodexApprovalRequest,
  CodexJsonValue,
} from '@ptah-extension/codex-runtime';
import {
  CODEX_DENIED_TOOL_RESULT_TEXT,
  presentCodexApproval,
  presentCodexTool,
  presentCodexToolResult,
} from './codex-tool-presentation';

function approval(
  kind: CodexApprovalRequest['kind'],
  details: Readonly<Record<string, CodexJsonValue>>,
  message = 'Codex requests approval',
): CodexApprovalRequest {
  return {
    contextId: 'context',
    processGeneration: 1,
    threadId: 'thread',
    turnId: 'turn',
    requestId: 1,
    normalizedHome: '/home',
    workspaceId: 'workspace',
    providerId: 'provider',
    kind,
    message,
    details,
  };
}

describe('presentCodexTool', () => {
  it.each([
    {
      case: 'command with cwd drops it (Claude BashToolInput)',
      toolName: 'commandExecution',
      input: { command: 'npm test', cwd: '/workspace' },
      expected: { toolName: 'Bash', toolInput: { command: 'npm test' } },
    },
    {
      case: 'command without cwd',
      toolName: 'commandExecution',
      input: { command: 'npm test' },
      expected: { toolName: 'Bash', toolInput: { command: 'npm test' } },
    },
    {
      case: 'command keeps a description like Claude',
      toolName: 'commandExecution',
      input: { command: 'npm test', description: 'Run the suite' },
      expected: {
        toolName: 'Bash',
        toolInput: { command: 'npm test', description: 'Run the suite' },
      },
    },
    {
      case: 'command drops every other native key',
      toolName: 'commandExecution',
      input: { command: 'npm test', cwd: '/w', timeoutMs: 5 },
      expected: { toolName: 'Bash', toolInput: { command: 'npm test' } },
    },
    {
      case: 'non-string command falls back to the raw name',
      toolName: 'commandExecution',
      input: { command: 42, cwd: '/workspace' },
      expected: {
        toolName: 'commandExecution',
        toolInput: { command: 42, cwd: '/workspace' },
      },
    },
    {
      case: 'web search',
      toolName: 'webSearch',
      input: { query: 'codex app server' },
      expected: {
        toolName: 'WebSearch',
        toolInput: { query: 'codex app server' },
      },
    },
    {
      case: 'single added file maps to Write and keeps the changes',
      toolName: 'fileChange',
      input: {
        changes: [
          { path: '/workspace/a.ts', diff: '+line', kind: { type: 'add' } },
        ],
      },
      expected: {
        toolName: 'Write',
        toolInput: {
          file_path: '/workspace/a.ts',
          changes: [
            { path: '/workspace/a.ts', diff: '+line', kind: { type: 'add' } },
          ],
        },
      },
    },
    {
      case: 'single updated file keeps the raw name',
      toolName: 'fileChange',
      input: {
        changes: [
          { path: '/workspace/a.ts', diff: '~line', kind: { type: 'update' } },
        ],
      },
      expected: {
        toolName: 'fileChange',
        toolInput: {
          changes: [
            { path: '/workspace/a.ts', diff: '~line', kind: { type: 'update' } },
          ],
        },
      },
    },
    {
      case: 'single deleted file keeps the raw name',
      toolName: 'fileChange',
      input: {
        changes: [
          { path: '/workspace/a.ts', diff: '-line', kind: { type: 'delete' } },
        ],
      },
      expected: {
        toolName: 'fileChange',
        toolInput: {
          changes: [
            { path: '/workspace/a.ts', diff: '-line', kind: { type: 'delete' } },
          ],
        },
      },
    },
    {
      case: 'multiple changes keep the raw name',
      toolName: 'fileChange',
      input: {
        changes: [
          { path: '/workspace/a.ts', diff: '+a', kind: { type: 'add' } },
          { path: '/workspace/b.ts', diff: '+b', kind: { type: 'add' } },
        ],
      },
      expected: {
        toolName: 'fileChange',
        toolInput: {
          changes: [
            { path: '/workspace/a.ts', diff: '+a', kind: { type: 'add' } },
            { path: '/workspace/b.ts', diff: '+b', kind: { type: 'add' } },
          ],
        },
      },
    },
    {
      case: 'change without a path keeps the raw name',
      toolName: 'fileChange',
      input: { changes: [{ diff: '+line', kind: { type: 'add' } }] },
      expected: {
        toolName: 'fileChange',
        toolInput: {
          changes: [{ diff: '+line', kind: { type: 'add' } }],
        },
      },
    },
    {
      case: 'changes that are not an array keep the raw name',
      toolName: 'fileChange',
      input: { changes: 'nope' },
      expected: { toolName: 'fileChange', toolInput: { changes: 'nope' } },
    },
    {
      case: 'native mcp name maps to the tree mcp name',
      toolName: 'orchestrator/ListAgents',
      input: { filter: 'all' },
      expected: {
        toolName: 'mcp__orchestrator__ListAgents',
        toolInput: { filter: 'all' },
      },
    },
    {
      case: 'mcp name splits at the first slash',
      toolName: 'server/sub/tool',
      input: { a: 1 },
      expected: { toolName: 'mcp__server__sub/tool', toolInput: { a: 1 } },
    },
    {
      case: 'mcp name without a server keeps the raw name',
      toolName: '/tool',
      input: { a: 1 },
      expected: { toolName: '/tool', toolInput: { a: 1 } },
    },
    {
      case: 'mcp name without a tool keeps the raw name',
      toolName: 'server/',
      input: { a: 1 },
      expected: { toolName: 'server/', toolInput: { a: 1 } },
    },
    {
      case: 'unknown name passes through',
      toolName: 'dynamicThing',
      input: { a: 1 },
      expected: { toolName: 'dynamicThing', toolInput: { a: 1 } },
    },
  ])('presents $case', ({ toolName, input, expected }) => {
    expect(presentCodexTool(toolName, input)).toEqual(expected);
  });

  it.each([
    { toolName: 'fileChange', input: undefined },
    { toolName: 'unknownTool', input: undefined },
  ])('omits the input when absent: $toolName', ({ toolName, input }) => {
    expect(presentCodexTool(toolName, input)).toEqual({ toolName });
  });
});

describe('presentCodexToolResult', () => {
  // Claude's tool_result event is content plus `is_error ?? false`
  // (user-message.transformer.ts:57-68); these cases pin the Codex shapes to
  // that contract, not to hand-written shapes.
  it.each([
    {
      case: 'a successful command with exit code 0 keeps the success shape',
      completed: {
        toolName: 'commandExecution',
        status: 'completed' as const,
        output: 'ok',
        exitCode: 0,
      },
      expected: { output: 'ok', isError: false },
    },
    {
      case: 'a failed command with output and exit code is Claude failed Bash',
      completed: {
        toolName: 'commandExecution',
        status: 'failed' as const,
        output: 'denied\n',
        exitCode: 1,
      },
      expected: {
        output: 'denied\nCommand failed with exit code 1',
        isError: true,
      },
    },
    {
      case: 'a failed command with empty output reports the exit code only',
      completed: {
        toolName: 'commandExecution',
        status: 'failed' as const,
        output: null,
        exitCode: 2,
      },
      expected: { output: 'Command failed with exit code 2', isError: true },
    },
    {
      case: 'a completed command that exited non-zero is a failure',
      completed: {
        toolName: 'commandExecution',
        status: 'completed' as const,
        output: 'access denied',
        exitCode: 1,
      },
      expected: {
        output: 'access denied\nCommand failed with exit code 1',
        isError: true,
      },
    },
    {
      case: 'a failed command with no exit code keeps the real output only',
      completed: {
        toolName: 'commandExecution',
        status: 'failed' as const,
        output: 'boom',
      },
      expected: { output: 'boom', isError: true },
    },
    {
      case: 'a declined command is Claude denial result',
      completed: {
        toolName: 'commandExecution',
        status: 'cancelled' as const,
        output: null,
      },
      expected: { output: CODEX_DENIED_TOOL_RESULT_TEXT, isError: true },
    },
    {
      case: 'an MCP error carries the server error text',
      completed: {
        toolName: 'orchestrator/ListAgents',
        status: 'failed' as const,
        output: { content: [] },
        errorText: 'server unreachable',
      },
      expected: { output: 'server unreachable', isError: true },
    },
    {
      case: 'a failed MCP call without error text passes the content through',
      completed: {
        toolName: 'orchestrator/ListAgents',
        status: 'failed' as const,
        output: { content: [{ type: 'text', text: 'partial' }] },
      },
      expected: {
        output: { content: [{ type: 'text', text: 'partial' }] },
        isError: true,
      },
    },
    {
      case: 'a completed MCP call keeps the success shape',
      completed: {
        toolName: 'orchestrator/ListAgents',
        status: 'completed' as const,
        output: { content: [{ type: 'text', text: 'ok' }] },
      },
      expected: {
        output: { content: [{ type: 'text', text: 'ok' }] },
        isError: false,
      },
    },
    {
      case: 'a failed call whose start was not seen passes the output through',
      completed: { toolName: undefined, status: 'failed' as const, output: 'x' },
      expected: { output: 'x', isError: true },
    },
  ])('presents $case', ({ completed, expected }) => {
    expect(presentCodexToolResult(completed)).toEqual(expected);
  });
});

describe('presentCodexApproval', () => {
  it.each([
    {
      case: 'command with reason',
      request: approval('command', {
        command: 'rm -rf /workspace/build',
        cwd: '/workspace',
        reason: 'Clean the build output',
      }),
      expected: {
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /workspace/build' },
        description: 'Clean the build output',
      },
    },
    {
      case: 'command without reason names the command',
      request: approval('command', { command: 'echo hi', cwd: '/workspace' }),
      expected: {
        toolName: 'Bash',
        toolInput: { command: 'echo hi' },
        description: 'Run: echo hi',
      },
    },
    {
      case: 'command without a usable command falls back to the raw name',
      request: approval('command', {}),
      expected: {
        toolName: 'commandExecution',
        toolInput: {},
        description: 'Run a command',
      },
    },
    {
      case: 'file change with reason and grant root',
      request: approval('fileChange', {
        reason: 'Writes outside the workspace',
        grantRoot: '/outside',
      }),
      expected: {
        toolName: 'fileChange',
        toolInput: { grantRoot: '/outside' },
        description: 'Writes outside the workspace (/outside)',
      },
    },
    {
      case: 'file change without details',
      request: approval('fileChange', {}),
      expected: {
        toolName: 'fileChange',
        toolInput: {},
        description: 'Apply file changes',
      },
    },
    {
      case: 'file change with only a grant root',
      request: approval('fileChange', { grantRoot: '/outside' }),
      expected: {
        toolName: 'fileChange',
        toolInput: { grantRoot: '/outside' },
        description: 'Apply file changes (/outside)',
      },
    },
    {
      case: 'permissions with reason and cwd',
      request: approval('permissions', {
        cwd: '/workspace',
        permissions: { network: { enabled: true } },
        reason: 'Needs network access',
      }),
      expected: {
        toolName: 'Permissions',
        toolInput: {
          cwd: '/workspace',
          permissions: { network: { enabled: true } },
        },
        description: 'Needs network access (in /workspace)',
      },
    },
    {
      case: 'permissions with only cwd',
      request: approval('permissions', { cwd: '/workspace' }),
      expected: {
        toolName: 'Permissions',
        toolInput: { cwd: '/workspace' },
        description: 'Grant permissions in /workspace',
      },
    },
    {
      case: 'permissions without details',
      request: approval('permissions', {}),
      expected: {
        toolName: 'Permissions',
        toolInput: {},
        description: 'Grant requested permissions',
      },
    },
    {
      case: 'elicitation with a server name',
      request: approval('mcpElicitation', {
        serverName: 'orchestrator',
        message: 'Pick a model',
      }),
      expected: {
        toolName: 'mcp__orchestrator__elicitation',
        toolInput: {},
        description: 'Pick a model',
      },
    },
    {
      case: 'elicitation without a server name',
      request: approval('mcpElicitation', { message: 'Pick a model' }),
      expected: {
        toolName: 'mcpElicitation',
        toolInput: {},
        description: 'Pick a model',
      },
    },
    {
      case: 'elicitation falls back to the bridge message',
      request: approval('mcpElicitation', {}, 'Approve the request'),
      expected: {
        toolName: 'mcpElicitation',
        toolInput: {},
        description: 'Approve the request',
      },
    },
    {
      case: 'user input carries its questions',
      request: approval('userInput', {
        questions: [{ id: 'q', header: 'Model', question: 'Which model?' }],
      }),
      expected: {
        toolName: 'userInput',
        toolInput: {
          questions: [{ id: 'q', header: 'Model', question: 'Which model?' }],
        },
        description: 'Codex requests approval',
      },
    },
    {
      case: 'user input without questions',
      request: approval('userInput', {}, 'Answer the question'),
      expected: {
        toolName: 'userInput',
        toolInput: {},
        description: 'Answer the question',
      },
    },
  ])('presents $case', ({ request, expected }) => {
    expect(presentCodexApproval(request)).toEqual(expected);
  });

  it('never puts a protocol id in the description', () => {
    const presented = presentCodexApproval(
      approval('fileChange', {
        itemId: 'item-7',
        threadId: 'thread',
        turnId: 'turn',
        startedAtMs: 1,
        reason: 'Apply the patch',
      }),
    );
    expect(presented.description).toBe('Apply the patch');
    expect(presented.description).not.toContain('item-7');
    expect(presented.description).not.toContain('thread');
  });

  it('caps descriptions at 500 characters', () => {
    const presented = presentCodexApproval(
      approval('command', {
        command: 'echo hi',
        reason: 'y'.repeat(600),
      }),
    );
    expect(presented.description.length).toBe(500);
    expect(presented.description.endsWith('…')).toBe(true);
  });
});