/**
 * Specs for the MCP request-scoped context (AsyncLocalStorage).
 *
 * The critical property is CONCURRENCY ISOLATION: two overlapping tool calls
 * from different sessions must each see their own caller id, never each
 * other's. This is what makes per-request workspace resolution safe when
 * multiple workspaces run agents at the same time.
 */

import {
  runWithMcpRequestContext,
  getCallerSessionId,
  getCallerWorkspaceRoot,
} from './mcp-request-context';

describe('mcp-request-context', () => {
  it('exposes the caller session id inside the context', () => {
    const seen = runWithMcpRequestContext({ callerSessionId: 'sess-A' }, () =>
      getCallerSessionId(),
    );
    expect(seen).toBe('sess-A');
  });

  it('returns undefined outside any context', () => {
    expect(getCallerSessionId()).toBeUndefined();
  });

  it('propagates the caller id across awaits within the same context', async () => {
    const seen = await runWithMcpRequestContext(
      { callerSessionId: 'sess-A' },
      async () => {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 1));
        return getCallerSessionId();
      },
    );
    expect(seen).toBe('sess-A');
  });

  it('isolates concurrent contexts from different sessions', async () => {
    const observe = (
      id: string,
      delayMs: number,
    ): Promise<string | undefined> =>
      runWithMcpRequestContext({ callerSessionId: id }, async () => {
        // Interleave: yield so both contexts are in flight simultaneously.
        await new Promise((r) => setTimeout(r, delayMs));
        return getCallerSessionId();
      });

    const [a, b] = await Promise.all([
      observe('sess-A', 5),
      observe('sess-B', 1),
    ]);

    expect(a).toBe('sess-A');
    expect(b).toBe('sess-B');
  });

  it('does not leak context after the callback settles', async () => {
    await runWithMcpRequestContext({ callerSessionId: 'sess-A' }, async () => {
      await Promise.resolve();
    });
    expect(getCallerSessionId()).toBeUndefined();
  });

  it('exposes the caller workspace root inside the context', () => {
    const seen = runWithMcpRequestContext(
      { callerWorkspaceRoot: 'D:\\projects\\ptah-extension' },
      () => getCallerWorkspaceRoot(),
    );
    expect(seen).toBe('D:\\projects\\ptah-extension');
  });

  it('returns undefined workspace root outside any context', () => {
    expect(getCallerWorkspaceRoot()).toBeUndefined();
  });

  it('carries session id and workspace root in the same context independently', () => {
    const seen = runWithMcpRequestContext(
      { callerSessionId: 'sess-A', callerWorkspaceRoot: 'D:\\ws-A' },
      () => ({
        session: getCallerSessionId(),
        workspace: getCallerWorkspaceRoot(),
      }),
    );
    expect(seen).toEqual({ session: 'sess-A', workspace: 'D:\\ws-A' });
  });

  it('isolates concurrent workspace roots from different callers', async () => {
    const observe = (
      root: string,
      delayMs: number,
    ): Promise<string | undefined> =>
      runWithMcpRequestContext({ callerWorkspaceRoot: root }, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        return getCallerWorkspaceRoot();
      });

    const [a, b] = await Promise.all([
      observe('D:\\ws-A', 5),
      observe('D:\\ws-B', 1),
    ]);

    expect(a).toBe('D:\\ws-A');
    expect(b).toBe('D:\\ws-B');
  });
});
