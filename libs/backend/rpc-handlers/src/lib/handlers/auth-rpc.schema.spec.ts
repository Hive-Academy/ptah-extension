/**
 * AuthSettingsSchema — unit specs (TASK_2025_294 W2.B1.1).
 *
 * Surface under test: the Zod schema extracted from `auth-rpc.handlers.ts` in
 * W0.B6. This file locks in the shape/behaviour the handler depends on so
 * future edits to the schema cannot silently change what the saveSettings RPC
 * accepts or rejects.
 *
 * Coverage strategy:
 *   - authMethod literal union — only the three documented strategies parse.
 *   - anthropicProviderId z.enum — gated against the live `ANTHROPIC_PROVIDERS`
 *     registry (we sample the first one rather than hardcoding an id, so this
 *     spec survives provider-list churn).
 *   - Optional fields — absent AND empty-string both parse (empty string is a
 *     sentinel for "clear credential" at the handler layer).
 *   - Safe-parse error path — `success: false` with a ZodError containing the
 *     expected field path, so callers can map parse failures to UX messaging.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.schema.ts`
 */

import 'reflect-metadata';

import { ANTHROPIC_PROVIDERS } from '@ptah-extension/agent-sdk';

import { AuthSettingsSchema, parseAuthMethod } from './auth-rpc.schema';

describe('AuthSettingsSchema', () => {
  describe('authMethod', () => {
    it.each(['apiKey', 'claudeCli', 'thirdParty'] as const)(
      'accepts the "%s" auth method',
      (method) => {
        const result = AuthSettingsSchema.safeParse({ authMethod: method });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.authMethod).toBe(method);
        }
      },
    );

    it.each(['openrouter', 'vscode-lm', 'auto', '', 'APIKEY'])(
      'rejects unknown / legacy auth method "%s"',
      (method) => {
        const result = AuthSettingsSchema.safeParse({ authMethod: method });
        expect(result.success).toBe(false);
        if (!result.success) {
          const paths = result.error.issues.map((i) => i.path.join('.'));
          expect(paths).toContain('authMethod');
        }
      },
    );

    it('rejects payloads missing authMethod entirely', () => {
      const result = AuthSettingsSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('authMethod');
      }
    });
  });

  describe('anthropicProviderId', () => {
    it('accepts any id from the ANTHROPIC_PROVIDERS registry', () => {
      // The schema keys off the live provider list, so we assert against that
      // same list — any provider the registry knows about must parse.
      for (const provider of ANTHROPIC_PROVIDERS) {
        const result = AuthSettingsSchema.safeParse({
          authMethod: 'apiKey',
          anthropicProviderId: provider.id,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.anthropicProviderId).toBe(provider.id);
        }
      }
    });

    it('rejects ids that are not in the registry', () => {
      const unknownId = '__definitely-not-a-real-provider-id__';
      // Sanity-check our fake id doesn't collide with a real provider.
      expect(ANTHROPIC_PROVIDERS.map((p) => p.id)).not.toContain(unknownId);

      const result = AuthSettingsSchema.safeParse({
        authMethod: 'apiKey',
        anthropicProviderId: unknownId,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('anthropicProviderId');
      }
    });

    it('treats anthropicProviderId as optional (absent)', () => {
      const result = AuthSettingsSchema.safeParse({ authMethod: 'apiKey' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.anthropicProviderId).toBeUndefined();
      }
    });
  });

  describe('credential fields', () => {
    it('accepts empty-string credentials (sentinel for "clear credential")', () => {
      // The handler interprets empty string specially — it MUST pass schema
      // validation so the handler can run the deletion branch.
      const result = AuthSettingsSchema.safeParse({
        authMethod: 'apiKey',
        anthropicApiKey: '',
        providerApiKey: '',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.anthropicApiKey).toBe('');
        expect(result.data.providerApiKey).toBe('');
      }
    });

    it('accepts populated credential strings unchanged', () => {
      const result = AuthSettingsSchema.safeParse({
        authMethod: 'apiKey',
        anthropicApiKey: 'sk-ant-abc123',
        providerApiKey: 'pk-xyz-456',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.anthropicApiKey).toBe('sk-ant-abc123');
        expect(result.data.providerApiKey).toBe('pk-xyz-456');
      }
    });

    it.each([
      ['anthropicApiKey', 42],
      ['providerApiKey', { nested: 'object' }],
      ['anthropicApiKey', null],
    ] as const)('rejects non-string %s (%p)', (field, value) => {
      const result = AuthSettingsSchema.safeParse({
        authMethod: 'apiKey',
        [field]: value,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain(field);
      }
    });
  });

  describe('parseAuthMethod', () => {
    it('returns "apiKey" for null / undefined', () => {
      expect(parseAuthMethod(null)).toBe('apiKey');
      expect(parseAuthMethod(undefined)).toBe('apiKey');
    });

    it('returns "apiKey" for empty string', () => {
      expect(parseAuthMethod('')).toBe('apiKey');
    });

    it('passes through recognized methods unchanged', () => {
      expect(parseAuthMethod('apiKey')).toBe('apiKey');
      expect(parseAuthMethod('claudeCli')).toBe('claudeCli');
      expect(parseAuthMethod('thirdParty')).toBe('thirdParty');
    });

    it('normalizes legacy "openrouter" alias to "thirdParty"', () => {
      expect(parseAuthMethod('openrouter')).toBe('thirdParty');
    });

    it('normalizes CLI-written "claude-cli" spelling to "claudeCli"', () => {
      // The CLI bootstrap migration shim rewrites legacy `'claudeCli'` →
      // `'claude-cli'` on disk. Without this mapping, the auth-status badge
      // silently fell back to 'API Key' even though the SDK still used the
      // Claude CLI for actual auth (see auth-method.utils.ts in agent-sdk).
      expect(parseAuthMethod('claude-cli')).toBe('claudeCli');
    });

    it('normalizes CLI-written "oauth" spelling to "thirdParty"', () => {
      expect(parseAuthMethod('oauth')).toBe('thirdParty');
    });

    it.each(['vscode-lm', 'auto', 'APIKEY', 'unknown', '   '])(
      'defaults unrecognized value "%s" to "apiKey"',
      (value) => {
        expect(parseAuthMethod(value)).toBe('apiKey');
      },
    );
  });

  describe('full payload parsing', () => {
    it('round-trips a complete valid payload', () => {
      const firstProvider = ANTHROPIC_PROVIDERS[0];
      expect(firstProvider).toBeDefined();

      const input = {
        authMethod: 'thirdParty' as const,
        anthropicApiKey: 'sk-ant-full',
        providerApiKey: 'pk-full',
        anthropicProviderId: firstProvider.id,
      };

      const result = AuthSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it('strips unrelated fields via parse() default behaviour', () => {
      // Default Zod objects are passthrough-tolerant by default in v4 but the
      // schema uses plain z.object (no `.strict()` / `.passthrough()`), so
      // extra fields are dropped rather than causing failure. Lock in that
      // invariant — the handler relies on it to ignore future frontend fields.
      const result = AuthSettingsSchema.parse({
        authMethod: 'apiKey',
        unknownField: 'should be dropped',
      } as unknown as { authMethod: string });
      expect(result).toEqual({ authMethod: 'apiKey' });
    });
  });
});
