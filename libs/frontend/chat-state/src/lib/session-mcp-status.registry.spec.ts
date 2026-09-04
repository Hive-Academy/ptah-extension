/**
 * `SessionMcpStatusRegistry` (frontend) specs — TASK_2026_375 B4.4.
 *
 * The two behaviours worth pinning are the dual-key read (a session pushed
 * under its tabId must still be findable once the tab knows the SDK id) and the
 * bound.
 */
import {
  MCP_STATUS_MAP_LIMIT,
  SessionMcpStatusRegistry,
} from './session-mcp-status.registry';

const NOTICE = {
  code: 'claude-ai-connectors-disabled',
  message: 'claude.ai connectors are disabled …',
} as const;

describe('SessionMcpStatusRegistry (frontend)', () => {
  let registry: SessionMcpStatusRegistry;

  beforeEach(() => {
    registry = new SessionMcpStatusRegistry();
  });

  it('answers null for an unknown session', () => {
    expect(registry.statusFor('nope')()).toBeNull();
    expect(registry.peek('nope')).toBeNull();
  });

  it('records and reads one session', () => {
    registry.record('s1', {
      servers: [{ name: 'a', status: 'connected' }],
      notices: [],
    });

    expect(registry.statusFor('s1')()).toEqual({
      servers: [{ name: 'a', status: 'connected' }],
      notices: [],
    });
  });

  it('REPLACES rather than merges — the backend already folded the record', () => {
    registry.record('s1', { servers: [], notices: [NOTICE] });
    registry.record('s1', {
      servers: [{ name: 'a', status: 'connected' }],
      notices: [],
    });

    expect(registry.peek('s1')).toEqual({
      servers: [{ name: 'a', status: 'connected' }],
      notices: [],
    });
  });

  it('ignores an empty session id', () => {
    registry.record('', { servers: [], notices: [] });

    expect(registry.sessions()).toEqual([]);
  });

  describe('dual-key read', () => {
    it('falls back to the tabId when the SDK id has no record', () => {
      registry.record('tab-1', { servers: [], notices: [NOTICE] });

      expect(registry.statusFor('real-1', 'tab-1')()).toEqual({
        servers: [],
        notices: [NOTICE],
      });
    });

    it('prefers the SDK id when BOTH hold a record', () => {
      registry.record('tab-1', { servers: [], notices: [NOTICE] });
      registry.record('real-1', {
        servers: [{ name: 'a', status: 'connected' }],
        notices: [],
      });

      expect(registry.statusFor('real-1', 'tab-1')()).toEqual({
        servers: [{ name: 'a', status: 'connected' }],
        notices: [],
      });
    });

    it('handles a null session id with only a tabId', () => {
      registry.record('tab-1', { servers: [], notices: [] });

      expect(registry.statusFor(null, 'tab-1')()).toEqual({
        servers: [],
        notices: [],
      });
    });

    it('answers null when neither id has a record', () => {
      expect(registry.statusFor('real-1', 'tab-1')()).toBeNull();
    });
  });

  it('is reactive — a later record updates an existing signal', () => {
    const status = registry.statusFor('s1');
    expect(status()).toBeNull();

    registry.record('s1', {
      servers: [{ name: 'a', status: 'needs-auth' }],
      notices: [],
    });

    expect(status()?.servers[0]?.status).toBe('needs-auth');
  });

  describe('bound', () => {
    it(`holds at most ${MCP_STATUS_MAP_LIMIT} sessions`, () => {
      for (let i = 0; i < MCP_STATUS_MAP_LIMIT + 10; i++) {
        registry.record(`s${i}`, { servers: [], notices: [] });
      }

      expect(registry.sessions()).toHaveLength(MCP_STATUS_MAP_LIMIT);
    });

    it('evicts the least-recently-WRITTEN session', () => {
      for (let i = 0; i < MCP_STATUS_MAP_LIMIT; i++) {
        registry.record(`s${i}`, { servers: [], notices: [] });
      }
      registry.record('s0', { servers: [], notices: [NOTICE] });
      registry.record('overflow', { servers: [], notices: [] });

      expect(registry.peek('s0')).not.toBeNull();
      expect(registry.peek('s1')).toBeNull();
    });
  });

  it('clear forgets one session and leaves the rest', () => {
    registry.record('s1', { servers: [], notices: [] });
    registry.record('s2', { servers: [], notices: [] });
    registry.clear('s1');

    expect(registry.peek('s1')).toBeNull();
    expect(registry.peek('s2')).not.toBeNull();
  });

  it('clear on an unknown session does not churn the map identity', () => {
    registry.record('s1', { servers: [], notices: [] });
    const before = registry.sessions();
    registry.clear('nope');

    expect(registry.sessions()).toEqual(before);
  });
});
