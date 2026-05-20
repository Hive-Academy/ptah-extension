/**
 * Unit tests for `WorkspaceMcpCollector`.
 *
 * Covers:
 *   1. Collects MCP servers from `mcpDirectory:listInstalled`.
 *   2. Collects plugin skills via `plugins:list` + `plugins:list-skills`.
 *   3. 10s TTL caching — repeated calls within the window do not re-invoke
 *      the RPC.
 *   4. Cache expiry — calls past the TTL re-invoke RPC.
 *   5. RPC failure (success: false) returns whatever subset succeeded.
 *   6. RPC throw is swallowed.
 *   7. invalidate() clears the cache.
 */

import { WorkspaceMcpCollector } from './workspace-mcp-collector.js';

interface RpcCall {
  method: string;
  params: unknown;
}

function makeRpc(
  responses: Record<
    string,
    { success: boolean; data?: unknown; error?: string }
  >,
): {
  call: jest.Mock;
  history: RpcCall[];
} {
  const history: RpcCall[] = [];
  const call = jest.fn(async (method: string, params: unknown) => {
    history.push({ method, params });
    const resp = responses[method];
    if (resp === undefined) {
      return { success: false, error: 'no stub' };
    }
    return resp;
  });
  return { call, history };
}

describe('WorkspaceMcpCollector', () => {
  it('projects MCP servers and plugin skills onto Anthropic tool definitions', async () => {
    const { call } = makeRpc({
      'mcpDirectory:listInstalled': {
        success: true,
        data: {
          servers: [
            {
              serverKey: 'github',
              config: { type: 'http', url: 'https://example.com' },
            },
            {
              serverKey: 'filesystem',
              config: { type: 'stdio', command: 'npx fs-mcp' },
            },
          ],
        },
      },
      'plugins:list': {
        success: true,
        data: { plugins: [{ id: 'ptah-core' }] },
      },
      'plugins:list-skills': {
        success: true,
        data: {
          skills: [
            {
              skillId: 'orchestration',
              displayName: 'Orchestration',
              description: 'Coordinate multi-agent flows',
              pluginId: 'ptah-core',
            },
          ],
        },
      },
    });

    const collector = new WorkspaceMcpCollector(call);
    const tools = await collector.collect('/ws');
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'mcp__github',
      'mcp__filesystem',
      'skill__orchestration',
    ]);
    const githubTool = tools.find((t) => t.name === 'mcp__github');
    expect(githubTool?.description).toContain('http');
    expect(githubTool?.description).toContain('https://example.com');
  });

  it('caches results within the TTL window', async () => {
    let now = 1_000;
    const { call } = makeRpc({
      'mcpDirectory:listInstalled': {
        success: true,
        data: { servers: [{ serverKey: 'g', config: { type: 'stdio' } }] },
      },
      'plugins:list': { success: true, data: { plugins: [] } },
    });
    const collector = new WorkspaceMcpCollector(call, 10_000, () => now);
    await collector.collect('/ws');
    now = 5_000;
    await collector.collect('/ws');
    expect(call).toHaveBeenCalledTimes(2); // mcpDirectory + plugins:list once.
  });

  it('re-invokes RPC after the TTL elapses', async () => {
    let now = 0;
    const { call } = makeRpc({
      'mcpDirectory:listInstalled': {
        success: true,
        data: { servers: [] },
      },
      'plugins:list': { success: true, data: { plugins: [] } },
    });
    const collector = new WorkspaceMcpCollector(call, 1_000, () => now);
    await collector.collect('/ws');
    now = 2_000; // past TTL
    await collector.collect('/ws');
    expect(call).toHaveBeenCalledTimes(4); // 2x mcpDirectory + 2x plugins:list
  });

  it('returns empty array when both RPCs fail (no throw)', async () => {
    const { call } = makeRpc({
      'mcpDirectory:listInstalled': { success: false, error: 'boom' },
      'plugins:list': { success: false, error: 'boom' },
    });
    const collector = new WorkspaceMcpCollector(call);
    const tools = await collector.collect('/ws');
    expect(tools).toEqual([]);
  });

  it('swallows RPC throws', async () => {
    const call = jest.fn(async () => {
      throw new Error('rpc-down');
    });
    const collector = new WorkspaceMcpCollector(call);
    const tools = await collector.collect('/ws');
    expect(tools).toEqual([]);
  });

  it('invalidate() clears the cache', async () => {
    const { call } = makeRpc({
      'mcpDirectory:listInstalled': {
        success: true,
        data: { servers: [{ serverKey: 'g', config: { type: 'stdio' } }] },
      },
      'plugins:list': { success: true, data: { plugins: [] } },
    });
    const collector = new WorkspaceMcpCollector(call);
    await collector.collect('/ws');
    collector.invalidate();
    await collector.collect('/ws');
    expect(call.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
