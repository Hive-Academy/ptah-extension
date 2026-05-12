/**
 * Provider RPC schemas — unit specs (TASK_2025_294 W2.B2).
 *
 * Surface under test: the four Zod schemas extracted from
 * `provider-rpc.handlers.ts` in W2.B2. These specs lock in the shape /
 * behaviour the handler depends on so future edits cannot silently change
 * what the `provider:*` RPC methods accept or reject.
 *
 * Coverage strategy:
 *   - tier literal union — only `sonnet` / `opus` / `haiku` parse; legacy
 *     tier names (`default`, `fast`, `reasoning`) must be rejected.
 *   - modelId — required, non-empty; empty string is rejected because the
 *     handler relies on a set-or-clear dichotomy (`setModelTier` sets,
 *     `clearModelTier` clears — an empty `modelId` on `set` is nonsense).
 *   - providerId — optional on every schema; the handler resolves undefined
 *     via `resolveProviderId()` which consults persisted config.
 *   - Safe-parse error path — `success: false` with a ZodError containing
 *     the expected field path, so callers can map parse failures to UX
 *     messaging.
 *   - Full-payload round-trip — complete valid payloads survive parse
 *     unchanged.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.schema.ts`
 */

import 'reflect-metadata';

import {
  ProviderListModelsSchema,
  ProviderSetModelTierSchema,
  ProviderGetModelTiersSchema,
  ProviderClearModelTierSchema,
} from './provider-rpc.schema';

describe('ProviderListModelsSchema', () => {
  it('accepts an empty object (both fields optional)', () => {
    const result = ProviderListModelsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolUseOnly).toBeUndefined();
      expect(result.data.providerId).toBeUndefined();
    }
  });

  it('round-trips a populated payload unchanged', () => {
    const input = { toolUseOnly: true, providerId: 'openrouter' };
    const result = ProviderListModelsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it.each([
    ['toolUseOnly', 'true'],
    ['toolUseOnly', 1],
    ['toolUseOnly', null],
    ['providerId', 42],
    ['providerId', {}],
  ] as const)('rejects non-typed %s (%p)', (field, value) => {
    const result = ProviderListModelsSchema.safeParse({ [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain(field);
    }
  });

  it('strips unknown fields via default parse behaviour', () => {
    // The schema is a plain z.object (no .strict() / .passthrough()), so
    // extra fields are dropped. The handler relies on this to tolerate
    // future frontend fields arriving on wire.
    const result = ProviderListModelsSchema.parse({
      toolUseOnly: false,
      extra: 'dropped',
    } as unknown as { toolUseOnly: boolean });
    expect(result).toEqual({ toolUseOnly: false });
  });
});

describe('ProviderSetModelTierSchema', () => {
  describe('tier', () => {
    it.each(['sonnet', 'opus', 'haiku'] as const)('accepts "%s"', (tier) => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier,
        modelId: 'some-model',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tier).toBe(tier);
      }
    });

    it.each(['default', 'fast', 'reasoning', 'SONNET', ''])(
      'rejects unknown tier "%s"',
      (tier) => {
        const result = ProviderSetModelTierSchema.safeParse({
          tier,
          modelId: 'some-model',
          scope: 'mainAgent',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const paths = result.error.issues.map((i) => i.path.join('.'));
          expect(paths).toContain('tier');
        }
      },
    );

    it('rejects payloads missing tier entirely', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        modelId: 'some-model',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('tier');
      }
    });
  });

  describe('modelId', () => {
    it('rejects empty-string modelId (set-vs-clear invariant)', () => {
      // An empty modelId on `set` is nonsense — clearing is the
      // `provider:clearModelTier` RPC, not a special-case empty string.
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'sonnet',
        modelId: '',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('modelId');
      }
    });

    it('rejects missing modelId', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'sonnet',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('modelId');
      }
    });

    it('accepts any non-empty string modelId', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'opus',
        modelId: 'anthropic/claude-3.5-sonnet',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelId).toBe('anthropic/claude-3.5-sonnet');
      }
    });
  });

  describe('providerId', () => {
    it('is optional', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'haiku',
        modelId: 'm',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.providerId).toBeUndefined();
      }
    });

    it('passes through a string providerId unchanged', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'haiku',
        modelId: 'm',
        providerId: 'moonshot',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.providerId).toBe('moonshot');
      }
    });
  });

  describe('scope', () => {
    it('accepts "mainAgent"', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'sonnet',
        modelId: 'model-x',
        scope: 'mainAgent',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe('mainAgent');
      }
    });

    it('accepts "cliAgent"', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'haiku',
        modelId: 'kimi-k2',
        scope: 'cliAgent',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe('cliAgent');
      }
    });

    it('rejects unknown scope values', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'sonnet',
        modelId: 'm',
        scope: 'globalAgent',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('scope');
      }
    });

    it('rejects missing scope', () => {
      const result = ProviderSetModelTierSchema.safeParse({
        tier: 'sonnet',
        modelId: 'm',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('scope');
      }
    });
  });

  it('round-trips a complete valid payload', () => {
    const input = {
      tier: 'sonnet' as const,
      modelId: 'anthropic/claude-3.5-sonnet',
      providerId: 'openrouter',
      scope: 'mainAgent' as const,
    };
    const result = ProviderSetModelTierSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });
});

describe('ProviderGetModelTiersSchema', () => {
  it('accepts scope without providerId', () => {
    const result = ProviderGetModelTiersSchema.safeParse({
      scope: 'mainAgent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providerId).toBeUndefined();
      expect(result.data.scope).toBe('mainAgent');
    }
  });

  it('accepts a populated providerId alongside scope', () => {
    const result = ProviderGetModelTiersSchema.safeParse({
      providerId: 'z-ai',
      scope: 'cliAgent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providerId).toBe('z-ai');
      expect(result.data.scope).toBe('cliAgent');
    }
  });

  it.each([42, null, {}, true])('rejects non-string providerId (%p)', (bad) => {
    const result = ProviderGetModelTiersSchema.safeParse({
      providerId: bad,
      scope: 'mainAgent',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('providerId');
    }
  });

  it('accepts both scope enum values', () => {
    for (const scope of ['mainAgent', 'cliAgent'] as const) {
      const result = ProviderGetModelTiersSchema.safeParse({ scope });
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown scope values', () => {
    const result = ProviderGetModelTiersSchema.safeParse({ scope: 'other' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('scope');
    }
  });

  it('rejects missing scope', () => {
    const result = ProviderGetModelTiersSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('scope');
    }
  });
});

describe('ProviderClearModelTierSchema', () => {
  it.each(['sonnet', 'opus', 'haiku'] as const)('accepts tier "%s"', (tier) => {
    const result = ProviderClearModelTierSchema.safeParse({
      tier,
      scope: 'mainAgent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tier).toBe(tier);
    }
  });

  it.each(['default', 'fast', ''])('rejects unknown tier "%s"', (tier) => {
    const result = ProviderClearModelTierSchema.safeParse({
      tier,
      scope: 'mainAgent',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('tier');
    }
  });

  it('rejects missing tier', () => {
    const result = ProviderClearModelTierSchema.safeParse({
      scope: 'mainAgent',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('tier');
    }
  });

  it('accepts both scope enum values', () => {
    for (const scope of ['mainAgent', 'cliAgent'] as const) {
      const result = ProviderClearModelTierSchema.safeParse({
        tier: 'haiku',
        scope,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown scope values', () => {
    const result = ProviderClearModelTierSchema.safeParse({
      tier: 'sonnet',
      scope: 'allAgents',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('scope');
    }
  });

  it('rejects missing scope', () => {
    const result = ProviderClearModelTierSchema.safeParse({ tier: 'sonnet' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('scope');
    }
  });

  it('round-trips a full valid payload', () => {
    const input = {
      tier: 'opus' as const,
      providerId: 'openrouter',
      scope: 'mainAgent' as const,
    };
    const result = ProviderClearModelTierSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });
});
