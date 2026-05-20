/**
 * ChatRpcSchema — unit specs.
 *
 * Locks the NODE-NESTJS-3Y hardening contract: every chat RPC method that
 * carries a `tabId` or `sessionId` rejects non-UUID inputs at the boundary
 * via the schemas exported from `chat-rpc.schema.ts`. The frontend root
 * cause was fixed in commit `955dbc18`; these specs ensure the backend
 * never crashes deep in the SDK if a non-UUID id ever appears again from
 * any caller (CLI, MCP proxy, IPC, an outdated webview).
 *
 * Source-under-test: `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
 */

import { ZodError } from 'zod';

import {
  ChatStartParamsSchema,
  ChatContinueParamsSchema,
  ChatResumeParamsSchema,
  ChatAbortParamsSchema,
} from './chat-rpc.schema';

// UUID v4 fixtures — these PASS the shared `UUID_REGEX` (see
// `libs/shared/src/lib/types/branded.types.ts`).
const VALID_TAB_UUID = '11111111-2222-4333-8444-555555555555';
const VALID_SESSION_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const LEGACY_TAB_ID = 'tab_1778939573732_w43e75q'; // the original Sentry crash payload

describe('chat-rpc.schema', () => {
  describe('ChatStartParamsSchema', () => {
    it('accepts a payload with a valid UUID v4 tabId', () => {
      const parsed = ChatStartParamsSchema.parse({
        tabId: VALID_TAB_UUID,
        prompt: 'hello',
      });
      expect(parsed.tabId).toBe(VALID_TAB_UUID);
    });

    it('rejects the legacy `tab_<ts>_<id>` format that caused NODE-NESTJS-3Y', () => {
      expect(() =>
        ChatStartParamsSchema.parse({ tabId: LEGACY_TAB_ID, prompt: 'hi' }),
      ).toThrow(ZodError);
    });

    it('rejects when tabId is missing entirely', () => {
      expect(() => ChatStartParamsSchema.parse({ prompt: 'hi' })).toThrow(
        ZodError,
      );
    });

    it('rejects when tabId is the wrong type', () => {
      expect(() =>
        ChatStartParamsSchema.parse({ tabId: 42, prompt: 'hi' }),
      ).toThrow(ZodError);
    });

    it('passes through unrelated fields untouched (model selection, files, …)', () => {
      const parsed = ChatStartParamsSchema.parse({
        tabId: VALID_TAB_UUID,
        workspacePath: '/repo',
        options: { model: 'claude-sonnet-4', preset: 'enhanced' },
      });
      // The schema is structural-only — extra fields survive parse().
      const projected = parsed as Record<string, unknown>;
      expect(projected['workspacePath']).toBe('/repo');
      expect(projected['options']).toEqual({
        model: 'claude-sonnet-4',
        preset: 'enhanced',
      });
    });
  });

  describe('ChatContinueParamsSchema', () => {
    it('accepts a payload with both UUIDs', () => {
      const parsed = ChatContinueParamsSchema.parse({
        tabId: VALID_TAB_UUID,
        sessionId: VALID_SESSION_UUID,
        prompt: 'more',
      });
      expect(parsed.tabId).toBe(VALID_TAB_UUID);
      expect(parsed.sessionId).toBe(VALID_SESSION_UUID);
    });

    it('rejects a non-UUID tabId', () => {
      expect(() =>
        ChatContinueParamsSchema.parse({
          tabId: LEGACY_TAB_ID,
          sessionId: VALID_SESSION_UUID,
          prompt: 'more',
        }),
      ).toThrow(ZodError);
    });

    it('rejects a non-UUID sessionId (e.g. an opaque "sid" string)', () => {
      expect(() =>
        ChatContinueParamsSchema.parse({
          tabId: VALID_TAB_UUID,
          sessionId: 'sid',
          prompt: 'more',
        }),
      ).toThrow(ZodError);
    });

    it('rejects when sessionId is missing', () => {
      expect(() =>
        ChatContinueParamsSchema.parse({
          tabId: VALID_TAB_UUID,
          prompt: 'more',
        }),
      ).toThrow(ZodError);
    });
  });

  describe('ChatResumeParamsSchema', () => {
    it('accepts a payload with both UUIDs', () => {
      const parsed = ChatResumeParamsSchema.parse({
        sessionId: VALID_SESSION_UUID,
        tabId: VALID_TAB_UUID,
      });
      expect(parsed.sessionId).toBe(VALID_SESSION_UUID);
      expect(parsed.tabId).toBe(VALID_TAB_UUID);
    });

    it('rejects a non-UUID sessionId', () => {
      expect(() =>
        ChatResumeParamsSchema.parse({
          sessionId: 'old-session-handle',
          tabId: VALID_TAB_UUID,
        }),
      ).toThrow(ZodError);
    });

    it('rejects a non-UUID tabId (regression for the original NODE-NESTJS-3Y payload)', () => {
      expect(() =>
        ChatResumeParamsSchema.parse({
          sessionId: VALID_SESSION_UUID,
          tabId: LEGACY_TAB_ID,
        }),
      ).toThrow(ZodError);
    });

    it('rejects when tabId is missing', () => {
      expect(() =>
        ChatResumeParamsSchema.parse({ sessionId: VALID_SESSION_UUID }),
      ).toThrow(ZodError);
    });
  });

  describe('ChatAbortParamsSchema', () => {
    it('accepts a payload with a valid sessionId UUID', () => {
      const parsed = ChatAbortParamsSchema.parse({
        sessionId: VALID_SESSION_UUID,
      });
      expect(parsed.sessionId).toBe(VALID_SESSION_UUID);
    });

    it('rejects a non-UUID sessionId', () => {
      expect(() => ChatAbortParamsSchema.parse({ sessionId: 'sid' })).toThrow(
        ZodError,
      );
    });

    it('rejects when sessionId is missing', () => {
      expect(() => ChatAbortParamsSchema.parse({})).toThrow(ZodError);
    });
  });
});
