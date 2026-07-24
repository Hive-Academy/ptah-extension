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
});
