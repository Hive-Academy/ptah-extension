/**
 * McpCallerWorkspaceResolver — the ICallerWorkspaceResolver implementation
 * (TASK_2026_364 Batch C).
 *
 * Pins the failure behaviour of plan section 4 for the agent surface:
 * - request context absent (UI RPC, CLI stdio) → undefined, so consumers keep
 *   the platform-provider fallback;
 * - declared workspace open (or inside an open folder — the worktree case) →
 *   returned;
 * - declared workspace NOT open → refused, naming it — never another root;
 * - anonymous caller with a session id → that session's workspace.
 */
import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { McpCallerWorkspaceResolver } from './mcp-caller-workspace-resolver';
import { runWithMcpRequestContext } from './mcp-core/mcp-request-context';

const OPEN_A = 'D:\\projects\\ptah-extension';
const OPEN_B = 'D:\\projects\\property-hub';
const CLOSED = 'D:\\projects\\somewhere-else';

function makeWorkspaceProvider(folders: string[]): IWorkspaceProvider {
  return {
    getWorkspaceFolders: jest.fn().mockReturnValue(folders),
    getWorkspaceRoot: jest.fn().mockReturnValue(folders[0]),
    getConfiguration: jest.fn(),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function makeResolver(
  folders: string[],
  sessionWorkspace?: Record<string, string>,
): McpCallerWorkspaceResolver {
  const sessionManager = sessionWorkspace
    ? {
        getSessionWorkspace: (id: string): string | undefined =>
          sessionWorkspace[id],
      }
    : undefined;
  return new McpCallerWorkspaceResolver(
    makeWorkspaceProvider(folders),
    sessionManager,
  );
}

describe('McpCallerWorkspaceResolver', () => {
  it('returns undefined outside any MCP request context (UI RPC, CLI stdio)', () => {
    const resolver = makeResolver([OPEN_A]);
    expect(resolver.resolveCallerWorkspaceRoot()).toBeUndefined();
  });

  it('returns undefined for an anonymous call (no declared root, no session id)', () => {
    const resolver = makeResolver([OPEN_A, OPEN_B]);
    const result = runWithMcpRequestContext({}, () =>
      resolver.resolveCallerWorkspaceRoot(),
    );
    expect(result).toBeUndefined();
  });

  it('returns the declared workspace when it is an open folder', () => {
    const resolver = makeResolver([OPEN_A, OPEN_B]);
    const result = runWithMcpRequestContext(
      { callerWorkspaceRoot: OPEN_B },
      () => resolver.resolveCallerWorkspaceRoot(),
    );
    expect(result).toBe(OPEN_B);
  });

  it('accepts a declared root INSIDE an open folder — the worktree case', () => {
    const worktree = `${OPEN_A}\\.claude-worktrees\\native-loop`;
    const resolver = makeResolver([OPEN_A]);
    const result = runWithMcpRequestContext(
      { callerWorkspaceRoot: worktree },
      () => resolver.resolveCallerWorkspaceRoot(),
    );
    expect(result).toBe(worktree);
  });

  it('refuses a declared workspace that is not open, naming it — never answers with another root', () => {
    const resolver = makeResolver([OPEN_A, OPEN_B]);
    expect(() =>
      runWithMcpRequestContext({ callerWorkspaceRoot: CLOSED }, () =>
        resolver.resolveCallerWorkspaceRoot(),
      ),
    ).toThrow(/somewhere-else.*not open/s);
  });

  it('refuses a declared workspace when no folder is open at all', () => {
    const resolver = makeResolver([]);
    expect(() =>
      runWithMcpRequestContext({ callerWorkspaceRoot: CLOSED }, () =>
        resolver.resolveCallerWorkspaceRoot(),
      ),
    ).toThrow(/no folder is open/);
  });

  it('resolves the caller session workspace when no root was declared', () => {
    const resolver = makeResolver([OPEN_A, OPEN_B], {
      'session-1': OPEN_B,
    });
    const result = runWithMcpRequestContext(
      { callerSessionId: 'session-1' },
      () => resolver.resolveCallerWorkspaceRoot(),
    );
    expect(result).toBe(OPEN_B);
  });

  it('a declared root outranks the caller session workspace', () => {
    const resolver = makeResolver([OPEN_A, OPEN_B], {
      'session-1': OPEN_B,
    });
    const result = runWithMcpRequestContext(
      { callerSessionId: 'session-1', callerWorkspaceRoot: OPEN_A },
      () => resolver.resolveCallerWorkspaceRoot(),
    );
    expect(result).toBe(OPEN_A);
  });

  it('returns undefined when the caller session has no known workspace', () => {
    const resolver = makeResolver([OPEN_A], {});
    const result = runWithMcpRequestContext(
      { callerSessionId: 'unknown-session' },
      () => resolver.resolveCallerWorkspaceRoot(),
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for a session id when no session manager is registered', () => {
    const resolver = makeResolver([OPEN_A]);
    const result = runWithMcpRequestContext(
      { callerSessionId: 'session-1' },
      () => resolver.resolveCallerWorkspaceRoot(),
    );
    expect(result).toBeUndefined();
  });
});
