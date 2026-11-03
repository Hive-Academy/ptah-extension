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
  SYSTEM_PROMPT_MAX_LENGTH,
  ChatStartParamsSchema,
  ChatContinueParamsSchema,
  ChatResumeParamsSchema,
  ChatSetStreamViewportParamsSchema,
  ChatAbortParamsSchema,
  ChatPendingQuestionsParamsSchema,
  ChatHistoryPageParamsSchema,
} from './chat-rpc.schema';

// UUID v4 fixtures — these PASS the shared `UUID_REGEX` (see
// `libs/shared/src/lib/types/branded.types.ts`).
const VALID_TAB_UUID = '11111111-2222-4333-8444-555555555555';
const VALID_SESSION_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const LEGACY_TAB_ID = 'tab_1778939573732_w43e75q'; // the original Sentry crash payload

describe('chat-rpc.schema', () => {
  it('accepts a native Codex UUID v7 session id for history paging', () => {
    const sessionId = '0190b6a8-3c4e-7a1b-8c2d-1e2f3a4b5c6d';
    expect(
      ChatHistoryPageParamsSchema.parse({ sessionId, cursor: 'page' })
        .sessionId,
    ).toBe(sessionId);
  });
  it.each([
    ChatContinueParamsSchema,
    ChatResumeParamsSchema,
    ChatAbortParamsSchema,
    ChatPendingQuestionsParamsSchema,
  ])('accepts a native Codex UUID v7 session id', (schema) => {
    const sessionId = '0190b6a8-3c4e-7a1b-8c2d-1e2f3a4b5c6d';
    expect(schema.parse({ sessionId, tabId: VALID_TAB_UUID }).sessionId).toBe(
      sessionId,
    );
  });
  it.each([
    ['continue', ChatContinueParamsSchema],
    ['resume', ChatResumeParamsSchema],
  ])(
    'bounds %s systemPrompt without stripping other fields',
    (_name, schema) => {
      const base = {
        tabId: VALID_TAB_UUID,
        sessionId: VALID_SESSION_UUID,
        other: 1,
      };
      expect(schema.parse(base)).not.toHaveProperty('systemPrompt');
      expect(
        schema.parse({
          ...base,
          systemPrompt: 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH),
        }),
      ).toMatchObject({
        systemPrompt: 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH),
        other: 1,
      });
      expect(() =>
        schema.parse({
          ...base,
          systemPrompt: 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH + 1),
        }),
      ).toThrow('systemPrompt exceeds maximum length');
      expect(() => schema.parse({ ...base, systemPrompt: 4 })).toThrow(
        'systemPrompt must be a string',
      );
    },
  );
  describe('ChatStartParamsSchema', () => {
    it('bounds options.systemPrompt and preserves other options', () => {
      const prompt = 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH);
      expect(
        ChatStartParamsSchema.parse({
          tabId: VALID_TAB_UUID,
          options: { systemPrompt: prompt, model: 'custom', files: ['a.ts'] },
          other: 1,
        }),
      ).toMatchObject({
        options: { systemPrompt: prompt, model: 'custom', files: ['a.ts'] },
        other: 1,
      });
      expect(() =>
        ChatStartParamsSchema.parse({
          tabId: VALID_TAB_UUID,
          options: { systemPrompt: 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH + 1) },
        }),
      ).toThrow('systemPrompt exceeds maximum length');
      expect(() =>
        ChatStartParamsSchema.parse({
          tabId: VALID_TAB_UUID,
          options: { systemPrompt: 4 },
        }),
      ).toThrow('systemPrompt must be a string');
    });

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
    it('accepts only literal true for the history ownership opt-in', () => {
      const params = { sessionId: VALID_SESSION_UUID, tabId: VALID_TAB_UUID };
      expect(
        ChatResumeParamsSchema.parse({ ...params, historyBlockOwners: true })
          .historyBlockOwners,
      ).toBe(true);
      expect(() =>
        ChatResumeParamsSchema.parse({ ...params, historyBlockOwners: false }),
      ).toThrow(ZodError);
    });
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

    it('no longer declares resumeSessionAt in its known-keys shape (TASK_2026_135 fork-and-switch pivot)', () => {
      const known = Object.keys(ChatResumeParamsSchema.shape);
      expect(known).not.toContain('resumeSessionAt');
      expect(known).toEqual(expect.arrayContaining(['tabId', 'sessionId']));
    });
  });

  describe('ChatSetStreamViewportParamsSchema', () => {
    it('accepts a distinct resync tab list', () => {
      expect(
        ChatSetStreamViewportParamsSchema.parse({
          protocolVersion: 2,
          visibleTabIds: [],
          resyncTabIds: [VALID_TAB_UUID],
        }).resyncTabIds,
      ).toEqual([VALID_TAB_UUID]);
    });

    it.each([
      [VALID_TAB_UUID, VALID_TAB_UUID],
      ['not-a-tab-id'],
      Array.from(
        { length: 129 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    ])('rejects an invalid resync tab list %#', (...resyncTabIds) => {
      expect(() =>
        ChatSetStreamViewportParamsSchema.parse({
          protocolVersion: 2,
          visibleTabIds: [],
          resyncTabIds,
        }),
      ).toThrow(ZodError);
    });

    it('rejects other unknown viewport keys', () => {
      expect(() =>
        ChatSetStreamViewportParamsSchema.parse({
          protocolVersion: 2,
          visibleTabIds: [],
          unexpected: true,
        }),
      ).toThrow(ZodError);
    });
    it('accepts a distinct v2 focused/visible viewport', () => {
      expect(
        ChatSetStreamViewportParamsSchema.parse({
          protocolVersion: 2,
          focusedTabId: VALID_TAB_UUID,
          visibleTabIds: [VALID_TAB_UUID],
        }),
      ).toMatchObject({ protocolVersion: 2, visibleTabIds: [VALID_TAB_UUID] });
    });

    it.each([
      { protocolVersion: 1, visibleTabIds: [] },
      { protocolVersion: 2, visibleTabIds: [VALID_TAB_UUID, VALID_TAB_UUID] },
      { protocolVersion: 2, visibleTabIds: ['not-a-tab-id'] },
    ])('rejects an invalid v2 viewport %#', (params) => {
      expect(() => ChatSetStreamViewportParamsSchema.parse(params)).toThrow(
        ZodError,
      );
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

  describe('ChatPendingQuestionsParamsSchema', () => {
    it('accepts a payload with a valid sessionId UUID', () => {
      const parsed = ChatPendingQuestionsParamsSchema.parse({
        sessionId: VALID_SESSION_UUID,
      });
      expect(parsed.sessionId).toBe(VALID_SESSION_UUID);
    });

    it('rejects a non-UUID sessionId', () => {
      expect(() =>
        ChatPendingQuestionsParamsSchema.parse({ sessionId: LEGACY_TAB_ID }),
      ).toThrow(ZodError);
    });

    it('rejects when sessionId is missing', () => {
      expect(() => ChatPendingQuestionsParamsSchema.parse({})).toThrow(
        ZodError,
      );
    });

    it('rejects when sessionId is the wrong type', () => {
      expect(() =>
        ChatPendingQuestionsParamsSchema.parse({ sessionId: 42 }),
      ).toThrow(ZodError);
    });
  });
});

describe.each([ChatStartParamsSchema, ChatContinueParamsSchema])(
  'MCP tool profile validation',
  (schema) => {
    const required = { tabId: VALID_TAB_UUID, sessionId: VALID_SESSION_UUID };

    it.each(['apps', 'coding'])('accepts %s', (mcpToolProfile) => {
      expect(schema.parse({ ...required, mcpToolProfile }).mcpToolProfile).toBe(
        mcpToolProfile,
      );
    });

    it('keeps an absent profile absent', () => {
      expect(schema.parse(required)).not.toHaveProperty('mcpToolProfile');
    });

    it.each(['admin', 42])('rejects %s', (mcpToolProfile) => {
      expect(() => schema.parse({ ...required, mcpToolProfile })).toThrow(
        ZodError,
      );
    });
  },
);

describe.each([
  [
    'start',
    ChatStartParamsSchema,
    { tabId: VALID_TAB_UUID },
    [
      'tabId',
      'options',
      'surfaceMode',
      'mcpToolProfile',
      'ptahUiFence',
      'accountSelection',
    ],
  ],
  [
    'continue',
    ChatContinueParamsSchema,
    { tabId: VALID_TAB_UUID, sessionId: VALID_SESSION_UUID },
    [
      'clientMessageId',
      'systemPrompt',
      'tabId',
      'sessionId',
      'surfaceMode',
      'mcpToolProfile',
      'ptahUiFence',
      'accountSelection',
    ],
  ],
] as const)(
  'ptahUiFence validation for %s',
  (_method, schema, required, expectedKeys) => {
    it.each([true, false])('accepts %s', (ptahUiFence) => {
      expect(schema.parse({ ...required, ptahUiFence }).ptahUiFence).toBe(
        ptahUiFence,
      );
    });

    it('keeps an absent flag absent', () => {
      expect(schema.parse(required)).not.toHaveProperty('ptahUiFence');
    });

    it.each(['yes', 1])('rejects %s', (ptahUiFence) => {
      expect(() => schema.parse({ ...required, ptahUiFence })).toThrow(
        ZodError,
      );
    });

    it('declares only the base keys plus ptahUiFence and accountSelection', () => {
      expect(Object.keys(schema.shape)).toEqual(expectedKeys);
    });
  },
);

describe.each([
  ['start', ChatStartParamsSchema, { tabId: VALID_TAB_UUID }],
  [
    'continue',
    ChatContinueParamsSchema,
    { tabId: VALID_TAB_UUID, sessionId: VALID_SESSION_UUID },
  ],
  [
    'resume',
    ChatResumeParamsSchema,
    { tabId: VALID_TAB_UUID, sessionId: VALID_SESSION_UUID },
  ],
] as const)(
  'accountSelection validation for %s',
  (_method, schema, required) => {
    it.each([
      [{ kind: 'named', profileId: 'profile_01' }],
      [{ kind: 'ambient' }],
      [{ kind: 'omitted' }],
    ])('accepts %j', (accountSelection) => {
      expect(
        schema.parse({ ...required, accountSelection }).accountSelection,
      ).toEqual(accountSelection);
    });

    it('keeps an absent selection absent and still validates the request', () => {
      const parsed = schema.parse(required);
      expect(parsed).not.toHaveProperty('accountSelection');
      expect(parsed.tabId).toBe(VALID_TAB_UUID);
    });

    it.each([
      ['a string', 'named'],
      ['null', null],
      ['an unknown kind', { kind: 'default' }],
      ['named without a profile id', { kind: 'named' }],
      ['named with an empty profile id', { kind: 'named', profileId: '' }],
      ['named with a numeric profile id', { kind: 'named', profileId: 7 }],
      [
        'named with a path-shaped profile id',
        { kind: 'named', profileId: '../profiles/a' },
      ],
      [
        'ambient with an extra key',
        { kind: 'ambient', profileId: 'profile_01' },
      ],
      [
        'named with an extra key',
        { kind: 'named', profileId: 'profile_01', configDir: 'x' },
      ],
    ])('rejects %s', (_label, accountSelection) => {
      expect(() => schema.parse({ ...required, accountSelection })).toThrow(
        ZodError,
      );
    });
  },
);
