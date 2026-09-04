/**
 * `SessionMcpStatusRegistry` specs (TASK_2026_375 B4.3).
 *
 * The three behaviours worth pinning are the ones a naive map would get wrong:
 * the two writers must not overwrite each other, `rekey` must merge rather than
 * drop, and the map must stay bounded with write-recency eviction.
 */
import 'reflect-metadata';

import {
  MCP_STATUS_MAP_LIMIT,
  SessionMcpStatusRegistry,
} from './session-mcp-status.registry';

const NOTICE = {
  code: 'claude-ai-connectors-disabled',
  message: 'claude.ai connectors are disabled because ANTHROPIC_API_KEY …',
} as const;

describe('SessionMcpStatusRegistry', () => {
  let registry: SessionMcpStatusRegistry;

  beforeEach(() => {
    registry = new SessionMcpStatusRegistry();
  });

  it('returns null for a session it never heard of', () => {
    expect(registry.get('nope')).toBeNull();
  });

  it('records the server list from the init message', () => {
    registry.recordServers('s1', [{ name: 'smithery', status: 'needs-auth' }]);

    expect(registry.get('s1')).toMatchObject({
      servers: [{ name: 'smithery', status: 'needs-auth' }],
      notices: [],
    });
  });

  it('stamps updatedAt on every write', () => {
    const before = Date.now();
    registry.recordServers('s1', []);
    const after = Date.now();
    const record = registry.get('s1');

    expect(record?.updatedAt).toBeGreaterThanOrEqual(before);
    expect(record?.updatedAt).toBeLessThanOrEqual(after);
  });

  it('ignores an empty session id rather than creating a phantom record', () => {
    expect(registry.recordServers('', [])).toBeNull();
    expect(registry.recordNotice('', NOTICE)).toBeNull();
    expect(registry.size).toBe(0);
  });

  describe('the two writers do not overwrite each other', () => {
    it('keeps the notice when servers arrive afterwards', () => {
      registry.recordNotice('s1', NOTICE);
      registry.recordServers('s1', [{ name: 'a', status: 'connected' }]);

      expect(registry.get('s1')).toMatchObject({
        servers: [{ name: 'a', status: 'connected' }],
        notices: [NOTICE],
      });
    });

    it('keeps the servers when a notice arrives afterwards', () => {
      registry.recordServers('s1', [{ name: 'a', status: 'connected' }]);
      registry.recordNotice('s1', NOTICE);

      expect(registry.get('s1')).toMatchObject({
        servers: [{ name: 'a', status: 'connected' }],
        notices: [NOTICE],
      });
    });

    it('REPLACES the server list on a second init — a later init is a later truth', () => {
      registry.recordServers('s1', [
        { name: 'a', status: 'needs-auth' },
        { name: 'b', status: 'connected' },
      ]);
      registry.recordServers('s1', [{ name: 'a', status: 'connected' }]);

      expect(registry.get('s1')?.servers).toEqual([
        { name: 'a', status: 'connected' },
      ]);
    });

    it('folds repeated notices by code, keeping the latest message', () => {
      registry.recordNotice('s1', NOTICE);
      registry.recordNotice('s1', { ...NOTICE, message: 'reworded' });

      expect(registry.get('s1')?.notices).toEqual([
        { code: NOTICE.code, message: 'reworded' },
      ]);
    });
  });

  describe('rekey', () => {
    it('migrates a tabId record onto the real session id', () => {
      registry.recordNotice('tab-1', NOTICE);
      registry.rekey('tab-1', 'real-1');

      expect(registry.get('tab-1')).toBeNull();
      expect(registry.get('real-1')?.notices).toEqual([NOTICE]);
    });

    it('MERGES when both ids hold a record', () => {
      // The stderr notice lands under the tabId while the `init` message has
      // already created the real-id entry. Neither half may be dropped.
      registry.recordNotice('tab-1', NOTICE);
      registry.recordServers('real-1', [{ name: 'a', status: 'connected' }]);
      registry.rekey('tab-1', 'real-1');

      expect(registry.get('tab-1')).toBeNull();
      expect(registry.get('real-1')).toMatchObject({
        servers: [{ name: 'a', status: 'connected' }],
        notices: [NOTICE],
      });
    });

    it("keeps the placeholder's servers when the real id recorded none", () => {
      registry.recordServers('tab-1', [{ name: 'a', status: 'connected' }]);
      registry.recordNotice('real-1', NOTICE);
      registry.rekey('tab-1', 'real-1');

      expect(registry.get('real-1')).toMatchObject({
        servers: [{ name: 'a', status: 'connected' }],
        notices: [NOTICE],
      });
    });

    it("prefers the real id's server list when it has one", () => {
      registry.recordServers('tab-1', [{ name: 'stale', status: 'pending' }]);
      registry.recordServers('real-1', [{ name: 'a', status: 'connected' }]);
      registry.rekey('tab-1', 'real-1');

      expect(registry.get('real-1')?.servers).toEqual([
        { name: 'a', status: 'connected' },
      ]);
    });

    it.each([
      ['an empty placeholder', '', 'real-1'],
      ['an empty real id', 'tab-1', ''],
      ['identical ids', 'tab-1', 'tab-1'],
    ])('is a no-op for %s', (_label, from, to) => {
      registry.recordNotice('tab-1', NOTICE);
      registry.rekey(from, to);

      expect(registry.get('tab-1')?.notices).toEqual([NOTICE]);
    });

    it('is a no-op when the placeholder holds nothing', () => {
      registry.recordServers('real-1', [{ name: 'a', status: 'connected' }]);
      registry.rekey('tab-1', 'real-1');

      expect(registry.get('real-1')?.servers).toEqual([
        { name: 'a', status: 'connected' },
      ]);
      expect(registry.size).toBe(1);
    });
  });

  describe('bound', () => {
    it(`holds at most ${MCP_STATUS_MAP_LIMIT} sessions`, () => {
      for (let i = 0; i < MCP_STATUS_MAP_LIMIT + 20; i++) {
        registry.recordServers(`s${i}`, []);
      }

      expect(registry.size).toBe(MCP_STATUS_MAP_LIMIT);
    });

    it('evicts the least-recently-WRITTEN entry, not the oldest key', () => {
      for (let i = 0; i < MCP_STATUS_MAP_LIMIT; i++) {
        registry.recordServers(`s${i}`, []);
      }
      // Touch the oldest key so it becomes the most recent write.
      registry.recordServers('s0', [{ name: 'a', status: 'connected' }]);
      registry.recordServers('overflow', []);

      expect(registry.get('s0')).not.toBeNull();
      expect(registry.get('s1')).toBeNull();
      expect(registry.size).toBe(MCP_STATUS_MAP_LIMIT);
    });

    it('an update never evicts — re-inserting an existing key shrinks the map first', () => {
      for (let i = 0; i < MCP_STATUS_MAP_LIMIT; i++) {
        registry.recordServers(`s${i}`, []);
      }
      registry.recordNotice('s5', NOTICE);

      expect(registry.size).toBe(MCP_STATUS_MAP_LIMIT);
      expect(registry.get('s0')).not.toBeNull();
    });
  });

  it('clear forgets one session', () => {
    registry.recordServers('s1', []);
    registry.clear('s1');

    expect(registry.get('s1')).toBeNull();
  });
});
