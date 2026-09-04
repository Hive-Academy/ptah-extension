/**
 * Specs for the `session:mcpStatus` contract (TASK_2026_375 B4.1).
 *
 * Two parsers exist for one payload — a hand-written one for the webview and a
 * Zod schema for the backend boundary — so the cases below run BOTH against the
 * same inputs wherever they are meant to agree, and name the one case where
 * they deliberately differ (an unknown notice code).
 */
import { MESSAGE_TYPES, parseSessionMcpStatusPayload } from '../../../index';
// Imported by relative path on purpose: `messages/schemas.ts` is NOT on the
// public barrel, and neither is `execution/schemas.ts`. Keeping the Zod runtime
// off `@ptah-extension/shared`'s entry point is what keeps it out of the
// webview's initial bundle (TASK_2026_187 Unit 10).
import { SessionMcpStatusPayloadSchema } from './schemas';

describe('session:mcpStatus contract', () => {
  const valid = {
    sessionId: 'ffb0b9b0-0000-4000-8000-000000000001',
    servers: [
      { name: 'smithery', status: 'needs-auth' },
      { name: 'oauth-mcp.sentry.dev-mcp', status: 'connected' },
    ],
    notices: [
      {
        code: 'claude-ai-connectors-disabled',
        message:
          'claude.ai connectors are disabled because ANTHROPIC_API_KEY or ' +
          'another auth source is set and takes precedence over your ' +
          'claude.ai login',
      },
    ],
  };

  it('registers the message type constant', () => {
    expect(MESSAGE_TYPES.SESSION_MCP_STATUS).toBe('session:mcpStatus');
  });

  describe('parseSessionMcpStatusPayload', () => {
    it('accepts a well-formed payload', () => {
      expect(parseSessionMcpStatusPayload(valid)).toEqual(valid);
    });

    it('accepts an empty server list and an empty notice list', () => {
      const empty = { sessionId: 'tab-1', servers: [], notices: [] };
      expect(parseSessionMcpStatusPayload(empty)).toEqual(empty);
    });

    it('passes an unknown server status through unchanged', () => {
      const parsed = parseSessionMcpStatusPayload({
        sessionId: 's1',
        servers: [{ name: 'x', status: 'reconnecting' }],
        notices: [],
      });
      expect(parsed?.servers[0]?.status).toBe('reconnecting');
    });

    it('drops an unknown notice code but keeps the servers', () => {
      const parsed = parseSessionMcpStatusPayload({
        sessionId: 's1',
        servers: [{ name: 'x', status: 'connected' }],
        notices: [{ code: 'something-new', message: 'hi' }],
      });
      expect(parsed).toEqual({
        sessionId: 's1',
        servers: [{ name: 'x', status: 'connected' }],
        notices: [],
      });
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'session:mcpStatus'],
      ['a missing sessionId', { servers: [], notices: [] }],
      ['an empty sessionId', { sessionId: '', servers: [], notices: [] }],
      ['a non-array servers', { sessionId: 's', servers: {}, notices: [] }],
      ['a non-array notices', { sessionId: 's', servers: [], notices: 0 }],
      [
        'a server without a name',
        { sessionId: 's', servers: [{ status: 'connected' }], notices: [] },
      ],
      [
        'a server without a status',
        { sessionId: 's', servers: [{ name: 'x' }], notices: [] },
      ],
      [
        'a notice without a message',
        {
          sessionId: 's',
          servers: [],
          notices: [{ code: 'claude-ai-connectors-disabled' }],
        },
      ],
    ])('rejects %s', (_label, input) => {
      expect(parseSessionMcpStatusPayload(input)).toBeNull();
    });
  });

  describe('SessionMcpStatusPayloadSchema', () => {
    it('accepts the same well-formed payload', () => {
      expect(SessionMcpStatusPayloadSchema.parse(valid)).toEqual(valid);
    });

    it('accepts an unknown server status', () => {
      expect(
        SessionMcpStatusPayloadSchema.safeParse({
          sessionId: 's1',
          servers: [{ name: 'x', status: 'reconnecting' }],
          notices: [],
        }).success,
      ).toBe(true);
    });

    it('REJECTS an unknown notice code — the backend is the producer', () => {
      expect(
        SessionMcpStatusPayloadSchema.safeParse({
          sessionId: 's1',
          servers: [],
          notices: [{ code: 'something-new', message: 'hi' }],
        }).success,
      ).toBe(false);
    });

    it('rejects an unknown top-level key', () => {
      expect(
        SessionMcpStatusPayloadSchema.safeParse({ ...valid, extra: 1 }).success,
      ).toBe(false);
    });

    it('rejects an empty sessionId', () => {
      expect(
        SessionMcpStatusPayloadSchema.safeParse({ ...valid, sessionId: '' })
          .success,
      ).toBe(false);
    });
  });
});
