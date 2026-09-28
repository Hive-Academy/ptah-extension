/**
 * Specs for `resolveMcpCaller` (TASK_2026_559 Task 3.1).
 *
 * The caller is resolved only from the URL-derived `_caller*` fields. The
 * properties pinned here: kind precedence (agent > session > workspace >
 * anonymous), empty/whitespace/non-string fields count as absent, and a
 * malformed field only ever makes the caller less specific — it never picks up
 * an identity the request did not carry.
 */

import { resolveMcpCaller } from './mcp-caller';
import type { MCPRequest } from './types/mcp-protocol.types';

function request(overrides: Partial<MCPRequest> = {}): MCPRequest {
  return { jsonrpc: '2.0', id: 1, method: 'tools/list', ...overrides };
}

const WINDOWS_ROOT = 'D:\\projects\\ptah-extension';

describe('resolveMcpCaller', () => {
  describe('each kind', () => {
    it('resolves an /agent/{id} caller to agent', () => {
      expect(resolveMcpCaller(request({ _callerAgentId: 'agent-1' }))).toEqual({
        kind: 'agent',
        agentId: 'agent-1',
      });
    });

    it('resolves a /session/{id} caller to session', () => {
      expect(
        resolveMcpCaller(request({ _callerSessionId: 'tab-abc' })),
      ).toEqual({ kind: 'session', sessionId: 'tab-abc' });
    });

    it('resolves a /workspace/{root} caller to workspace', () => {
      expect(
        resolveMcpCaller(request({ _callerWorkspaceRoot: WINDOWS_ROOT })),
      ).toEqual({ kind: 'workspace', workspaceRoot: WINDOWS_ROOT });
    });

    it('resolves a request with no URL identity (bare URL, stdio/CLI, in-process) to anonymous', () => {
      expect(resolveMcpCaller(request())).toEqual({ kind: 'anonymous' });
    });

    it('resolves explicitly undefined fields (what the HTTP handler stamps for a bare URL) to anonymous', () => {
      expect(
        resolveMcpCaller(
          request({
            _callerAgentId: undefined,
            _callerSessionId: undefined,
            _callerWorkspaceRoot: undefined,
          }),
        ),
      ).toEqual({ kind: 'anonymous' });
    });
  });

  describe('precedence', () => {
    it('agent + workspace → agent, keeping the declared root', () => {
      expect(
        resolveMcpCaller(
          request({
            _callerAgentId: 'agent-1',
            _callerWorkspaceRoot: WINDOWS_ROOT,
          }),
        ),
      ).toEqual({
        kind: 'agent',
        agentId: 'agent-1',
        workspaceRoot: WINDOWS_ROOT,
      });
    });

    it('session + workspace → session, keeping the declared root', () => {
      expect(
        resolveMcpCaller(
          request({
            _callerSessionId: 'tab-abc',
            _callerWorkspaceRoot: WINDOWS_ROOT,
          }),
        ),
      ).toEqual({
        kind: 'session',
        sessionId: 'tab-abc',
        workspaceRoot: WINDOWS_ROOT,
      });
    });

    it('agent + session (not produced by the URL grammar) → agent', () => {
      expect(
        resolveMcpCaller(
          request({ _callerAgentId: 'agent-1', _callerSessionId: 'tab-abc' }),
        ).kind,
      ).toBe('agent');
    });
  });

  describe('empty, whitespace and malformed fields', () => {
    it.each(['', ' ', '\t', ' \n '])(
      'treats an agent id of %j as absent',
      (value) => {
        expect(resolveMcpCaller(request({ _callerAgentId: value }))).toEqual({
          kind: 'anonymous',
        });
      },
    );

    it.each(['', '   '])('treats a session id of %j as absent', (value) => {
      expect(resolveMcpCaller(request({ _callerSessionId: value }))).toEqual({
        kind: 'anonymous',
      });
    });

    it.each(['', '   '])('treats a workspace root of %j as absent', (value) => {
      expect(
        resolveMcpCaller(request({ _callerWorkspaceRoot: value })),
      ).toEqual({ kind: 'anonymous' });
    });

    it('treats a non-string field as absent', () => {
      const malformed = {
        _callerAgentId: 42,
        _callerSessionId: { id: 'tab-abc' },
        _callerWorkspaceRoot: ['D:\\ws'],
      } as unknown as Partial<MCPRequest>;

      expect(resolveMcpCaller(request(malformed))).toEqual({
        kind: 'anonymous',
      });
    });

    it('a whitespace agent id falls back to the request’s OWN session, never an agent identity', () => {
      expect(
        resolveMcpCaller(
          request({ _callerAgentId: '  ', _callerSessionId: 'tab-abc' }),
        ),
      ).toEqual({ kind: 'session', sessionId: 'tab-abc' });
    });

    it('never reads identity from params (caller-supplied body)', () => {
      expect(
        resolveMcpCaller(
          request({
            params: {
              _callerAgentId: 'forged-agent',
              _callerSessionId: 'forged-session',
              _callerWorkspaceRoot: 'D:\\forged',
              agentId: 'forged-agent',
            },
          }),
        ),
      ).toEqual({ kind: 'anonymous' });
    });

    it('keeps a present value verbatim (no trimming)', () => {
      expect(
        resolveMcpCaller(request({ _callerSessionId: ' tab one ' })),
      ).toEqual({ kind: 'session', sessionId: ' tab one ' });
    });
  });

  it('is stateless: a later anonymous request never inherits an earlier caller', () => {
    resolveMcpCaller(request({ _callerAgentId: 'agent-1' }));
    resolveMcpCaller(request({ _callerSessionId: 'tab-abc' }));

    expect(resolveMcpCaller(request())).toEqual({ kind: 'anonymous' });
  });
});
