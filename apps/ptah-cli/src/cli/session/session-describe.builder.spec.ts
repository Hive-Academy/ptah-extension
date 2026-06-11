/**
 * Unit tests for {@link buildSessionDescribe} (TASK_2026_128 Phase 5).
 *
 * The helper is the pure assembly layer behind the inbound `session.describe`
 * request. It is exercised end-to-end through `interact.spec.ts` and
 * `mcp-serve.spec.ts`; these specs pin its shape contract in isolation so a
 * regression localizes to one file.
 */

import {
  buildSessionDescribe,
  INTERACT_CAPABILITIES,
  MCP_SERVE_CAPABILITIES,
} from './session-describe.builder.js';
import { JSONRPC_SCHEMA_VERSION, PTAH_ERROR_CODES } from '../jsonrpc/types.js';

const INTERACT_METHODS = [
  'task.submit',
  'task.cancel',
  'session.shutdown',
  'session.history',
  'rpc.call',
  'session.describe',
  'session.methods',
] as const;

const MCP_SERVE_METHODS = [
  'initialize',
  'tools/list',
  'tools/call',
  'notifications/cancelled',
  'session.describe',
  'session.methods',
] as const;

const MCP_TOOLS = [
  { name: 'agent_spawn', description: 'Spawn a rival CLI agent.' },
  { name: 'agent_status', description: 'Report agent status.' },
  { name: 'agent_read', description: 'Read agent stdout.' },
  { name: 'agent_steer', description: 'Steer a running agent.' },
  { name: 'agent_stop', description: 'Stop an agent.' },
  { name: 'agent_list', description: 'List available rival CLIs.' },
  { name: 'session_submit', description: 'Submit a full task to Ptah.' },
] as const;

describe('buildSessionDescribe', () => {
  describe('interact mode', () => {
    it('returns serverName=ptah, mode=interact, and the supplied version/schemaVersion', () => {
      const result = buildSessionDescribe({
        mode: 'interact',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: INTERACT_METHODS,
      });

      expect(result.serverName).toBe('ptah');
      expect(result.mode).toBe('interact');
      expect(result.version).toBe('0.1.5');
      expect(result.schemaVersion).toBe(JSONRPC_SCHEMA_VERSION);
    });

    it('emits the registered methods verbatim in the catalog', () => {
      const result = buildSessionDescribe({
        mode: 'interact',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: INTERACT_METHODS,
      });

      expect(result.catalog.methods).toEqual(INTERACT_METHODS);
    });

    it('returns an empty tool catalog for interact mode', () => {
      const result = buildSessionDescribe({
        mode: 'interact',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: INTERACT_METHODS,
        mcpTools: MCP_TOOLS,
      });

      expect(result.catalog.tools).toEqual([]);
    });

    it('defaults capabilities to the four interact-mode advertisements', () => {
      const result = buildSessionDescribe({
        mode: 'interact',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: INTERACT_METHODS,
      });

      expect(result.capabilities).toEqual([
        'chat',
        'session',
        'permission',
        'question',
      ]);
      expect(result.capabilities).toEqual(INTERACT_CAPABILITIES);
    });
  });

  describe('mcp-serve mode', () => {
    it('returns mode=mcp-serve with the supplied MCP tool catalog', () => {
      const result = buildSessionDescribe({
        mode: 'mcp-serve',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: MCP_SERVE_METHODS,
        mcpTools: MCP_TOOLS,
      });

      expect(result.mode).toBe('mcp-serve');
      expect(result.catalog.tools).toHaveLength(7);
      expect(result.catalog.tools.map((t) => t.name)).toEqual([
        'agent_spawn',
        'agent_status',
        'agent_read',
        'agent_steer',
        'agent_stop',
        'agent_list',
        'session_submit',
      ]);
    });

    it('falls back to an empty tool catalog when mcpTools is omitted', () => {
      const result = buildSessionDescribe({
        mode: 'mcp-serve',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: MCP_SERVE_METHODS,
      });

      expect(result.catalog.tools).toEqual([]);
    });

    it("defaults capabilities to ['mcp']", () => {
      const result = buildSessionDescribe({
        mode: 'mcp-serve',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: MCP_SERVE_METHODS,
        mcpTools: MCP_TOOLS,
      });

      expect(result.capabilities).toEqual(['mcp']);
      expect(result.capabilities).toEqual(MCP_SERVE_CAPABILITIES);
    });

    it('preserves descriptions in catalog entries', () => {
      const result = buildSessionDescribe({
        mode: 'mcp-serve',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: MCP_SERVE_METHODS,
        mcpTools: MCP_TOOLS,
      });

      expect(result.catalog.tools[0]).toEqual({
        name: 'agent_spawn',
        description: 'Spawn a rival CLI agent.',
      });
    });
  });

  describe('errorCodes enumeration', () => {
    it('lists every PtahErrorCode value (single source of truth)', () => {
      const result = buildSessionDescribe({
        mode: 'interact',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: INTERACT_METHODS,
      });

      expect(result.errorCodes).toEqual(PTAH_ERROR_CODES);
    });

    it('includes the MCP-specific codes introduced in Phases 2 + 4', () => {
      const result = buildSessionDescribe({
        mode: 'mcp-serve',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: MCP_SERVE_METHODS,
        mcpTools: MCP_TOOLS,
      });

      expect(result.errorCodes).toEqual(
        expect.arrayContaining([
          'mcp_handshake_failed',
          'mcp_tool_not_found',
          'mcp_invalid_tool_args',
          'mcp_tool_denied',
          'license_required',
        ]),
      );
    });
  });

  describe('capabilities override', () => {
    it('honors an explicit capabilities list when supplied', () => {
      const result = buildSessionDescribe({
        mode: 'interact',
        version: '0.1.5',
        schemaVersion: JSONRPC_SCHEMA_VERSION,
        methods: INTERACT_METHODS,
        capabilities: ['custom-cap', 'chat'],
      });

      expect(result.capabilities).toEqual(['custom-cap', 'chat']);
    });
  });
});
