/**
 * Provider registry — user-defined ("custom") entry specs (TASK_2026_236).
 *
 * Surface under test: the merge layer that lets `~/.ptah/settings.json` add
 * provider entries the shipped registry has never heard of.
 *
 * What these lock in:
 *   - `getAllAnthropicProviders()` is the ONE list accessor. Built-ins first,
 *     custom after — surfaces that iterate `ANTHROPIC_PROVIDERS` directly are
 *     the bug this feature exists to remove.
 *   - A custom entry can NEVER shadow a built-in id. The settings file is
 *     hand-editable, so id collision is an attack surface, not a typo: without
 *     this rule a settings edit could silently repoint `openrouter` at any host.
 *   - `lane` → `requiresProxy` is a stored mapping, never re-derived from the
 *     URL shape (the two lanes are indistinguishable from a base URL alone).
 *   - One malformed entry must not take the whole list down — rejection is
 *     per-entry and non-throwing, because this data comes off disk at boot.
 *
 * Source-under-test: `libs/shared/src/lib/providers/provider-registry.ts`
 */

import {
  ANTHROPIC_PROVIDERS,
  CustomProviderEntrySchema,
  clearCustomProviderEntries,
  customEntryToAnthropicProvider,
  getAllAnthropicProviders,
  getAnthropicProvider,
  getCustomProviderEntries,
  getCustomProviderEntry,
  isCustomProviderId,
  isSubscriptionCoveredProvider,
  seedStaticModelPricing,
  setCustomProviderEntries,
  type CustomProviderEntry,
} from './provider-registry';
import { getPricingMap } from '../utils/pricing.utils';

/** Build a valid entry through the schema, so defaults are applied for real. */
function makeEntry(
  overrides: Record<string, unknown> = {},
): CustomProviderEntry {
  return CustomProviderEntrySchema.parse({
    id: 'my-vllm-box',
    name: 'My vLLM Box',
    baseUrl: 'http://192.168.1.50:8000',
    lane: 'openai',
    ...overrides,
  });
}

describe('custom provider entries', () => {
  afterEach(() => {
    // Module-level cache — leaking it would make sibling specs order-dependent.
    clearCustomProviderEntries();
  });

  describe('CustomProviderEntrySchema', () => {
    it('applies defaults for the optional metadata fields', () => {
      const entry = makeEntry();
      expect(entry.authEnvVar).toBe('ANTHROPIC_AUTH_TOKEN');
      expect(entry.keyPrefix).toBe('');
      expect(entry.helpUrl).toBe('');
    });

    it('accepts the documented storage shape verbatim', () => {
      const result = CustomProviderEntrySchema.safeParse({
        id: 'custom-requesty-eu',
        name: 'Requesty (EU)',
        baseUrl: 'https://router.eu.requesty.ai',
        lane: 'anthropic',
        authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
        keyPrefix: '',
        helpUrl: 'https://app.requesty.ai/api-keys',
        modelsEndpoint: null,
        defaultTiers: {
          sonnet: 'vendor/model-sonnet',
          opus: 'vendor/model-opus',
          haiku: 'vendor/model-haiku',
        },
        pricing: null,
        createdAt: '2026-08-12T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('accepts an optional manual per-1M price pair', () => {
      const entry = makeEntry({
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      });
      expect(entry.pricing).toEqual({
        inputPerMillion: 3,
        outputPerMillion: 15,
      });
    });

    it.each(['ftp://host/api', 'not-a-url', 'file:///etc/passwd'])(
      'rejects a base URL with a non-http(s) scheme: %s',
      (baseUrl) => {
        const result = CustomProviderEntrySchema.safeParse({
          id: 'x',
          name: 'X',
          baseUrl,
          lane: 'openai',
        });
        expect(result.success).toBe(false);
      },
    );

    it.each(['Upper-Case', 'has space', '-leading-dash', 'dots.in.id'])(
      'rejects an id outside the settings-key character class: %s',
      (id) => {
        const result = CustomProviderEntrySchema.safeParse({
          id,
          name: 'X',
          baseUrl: 'https://example.test',
          lane: 'openai',
        });
        expect(result.success).toBe(false);
      },
    );
  });

  describe('customEntryToAnthropicProvider', () => {
    it('maps lane "openai" to requiresProxy: true', () => {
      const provider = customEntryToAnthropicProvider(
        makeEntry({ lane: 'openai' }),
      );
      expect(provider.requiresProxy).toBe(true);
    });

    it('maps lane "anthropic" to requiresProxy: false', () => {
      const provider = customEntryToAnthropicProvider(
        makeEntry({ lane: 'anthropic' }),
      );
      expect(provider.requiresProxy).toBe(false);
    });

    it('flags the projection as custom and keeps apiKey auth', () => {
      const provider = customEntryToAnthropicProvider(makeEntry());
      expect(provider.isCustom).toBe(true);
      expect(provider.authType).toBe('apiKey');
    });

    it('omits modelsEndpoint / defaultTiers when the entry stores null', () => {
      const provider = customEntryToAnthropicProvider(
        makeEntry({ modelsEndpoint: null, defaultTiers: null }),
      );
      expect(provider.modelsEndpoint).toBeUndefined();
      expect(provider.defaultTiers).toBeUndefined();
    });

    it('carries modelsEndpoint / defaultTiers through when present', () => {
      const provider = customEntryToAnthropicProvider(
        makeEntry({
          modelsEndpoint: 'http://192.168.1.50:8000/v1/models',
          defaultTiers: { sonnet: 's', opus: 'o', haiku: 'h' },
        }),
      );
      expect(provider.modelsEndpoint).toBe(
        'http://192.168.1.50:8000/v1/models',
      );
      expect(provider.defaultTiers).toEqual({
        sonnet: 's',
        opus: 'o',
        haiku: 'h',
      });
    });
  });

  describe('getAllAnthropicProviders', () => {
    it('returns exactly the built-ins when nothing is registered', () => {
      expect(getAllAnthropicProviders().map((p) => p.id)).toEqual(
        ANTHROPIC_PROVIDERS.map((p) => p.id),
      );
    });

    it('appends custom entries after the built-ins', () => {
      setCustomProviderEntries([makeEntry()]);

      const ids = getAllAnthropicProviders().map((p) => p.id);
      expect(ids).toHaveLength(ANTHROPIC_PROVIDERS.length + 1);
      expect(ids.slice(0, ANTHROPIC_PROVIDERS.length)).toEqual(
        ANTHROPIC_PROVIDERS.map((p) => p.id),
      );
      expect(ids[ids.length - 1]).toBe('my-vllm-box');
    });

    it('replaces (not merges) the previous set on each call', () => {
      setCustomProviderEntries([makeEntry({ id: 'first' })]);
      setCustomProviderEntries([makeEntry({ id: 'second' })]);

      const ids = getAllAnthropicProviders().map((p) => p.id);
      expect(ids).toContain('second');
      expect(ids).not.toContain('first');
    });

    it('returns a fresh array callers cannot use to mutate the registry', () => {
      const list = getAllAnthropicProviders();
      list.length = 0;
      expect(getAllAnthropicProviders().length).toBe(
        ANTHROPIC_PROVIDERS.length,
      );
    });
  });

  describe('id collision with a built-in', () => {
    it.each(ANTHROPIC_PROVIDERS.map((p) => p.id))(
      'refuses to let a custom entry shadow the built-in "%s"',
      (builtInId) => {
        const result = setCustomProviderEntries([
          makeEntry({ id: builtInId, name: 'Impostor' }),
        ]);

        expect(result.accepted).toHaveLength(0);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].id).toBe(builtInId);
        expect(result.rejected[0].reason).toMatch(/built-in/i);
      },
    );

    it('leaves the built-in definition untouched after a collision attempt', () => {
      const before = getAnthropicProvider('openrouter');
      setCustomProviderEntries([
        makeEntry({ id: 'openrouter', baseUrl: 'https://evil.test' }),
      ]);

      const after = getAnthropicProvider('openrouter');
      expect(after).toBe(before);
      expect(after?.baseUrl).not.toBe('https://evil.test');
      expect(after?.isCustom).toBeUndefined();
    });

    it('rejects the virtual direct-Anthropic id as well', () => {
      const result = setCustomProviderEntries([makeEntry({ id: 'anthropic' })]);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected[0].reason).toMatch(/built-in/i);
    });

    it('keeps the valid entries when only one of several collides', () => {
      const result = setCustomProviderEntries([
        makeEntry({ id: 'good-one' }),
        makeEntry({ id: 'openrouter' }),
        makeEntry({ id: 'good-two' }),
      ]);

      expect(result.accepted.map((e) => e.id)).toEqual([
        'good-one',
        'good-two',
      ]);
      expect(result.rejected.map((e) => e.id)).toEqual(['openrouter']);
    });
  });

  describe('duplicate and malformed entries', () => {
    it('keeps the first of two entries sharing an id', () => {
      const result = setCustomProviderEntries([
        makeEntry({ id: 'dupe', name: 'First' }),
        makeEntry({ id: 'dupe', name: 'Second' }),
      ]);

      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].name).toBe('First');
      expect(result.rejected[0].reason).toMatch(/duplicate/i);
    });

    it('skips a malformed entry without throwing or dropping its siblings', () => {
      // Settings JSON is hand-editable — a bad entry must not break boot.
      const malformed = {
        id: 'BAD ID',
        name: '',
        baseUrl: 'ftp://nope',
        lane: 'openai',
      } as unknown as CustomProviderEntry;

      const result = setCustomProviderEntries([malformed, makeEntry()]);

      expect(result.accepted.map((e) => e.id)).toEqual(['my-vllm-box']);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].id).toBe('BAD ID');
      expect(result.rejected[0].reason).toContain('baseUrl');
    });

    it.each([
      ['a string', 'not-an-entry'],
      ['null', null],
      ['a number', 42],
      ['an array', []],
    ])(
      'reports %s as <unknown> rather than crashing on the id read',
      (_label, candidate) => {
        // A hand-edited `providers: ["oops"]` reaches here as a bare string.
        // Reading `.id` off it must not throw during boot.
        const result = setCustomProviderEntries([
          candidate as unknown as CustomProviderEntry,
          makeEntry(),
        ]);

        expect(result.accepted.map((e) => e.id)).toEqual(['my-vllm-box']);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].id).toBe('<unknown>');
        // The reason must still say something — a blank reason is a rejection
        // the user cannot act on.
        expect(result.rejected[0].reason.length).toBeGreaterThan(0);
      },
    );

    it('labels a whole-entry schema failure as `entry` rather than an empty path', () => {
      const result = setCustomProviderEntries([
        'not-an-entry' as unknown as CustomProviderEntry,
      ]);

      // Zod reports a top-level type error with an EMPTY path; without the
      // fallback the reason would read `: expected object...`.
      expect(result.rejected[0].reason).toMatch(/^entry: /);
    });

    it('keeps an object entry’s declared id in the rejection even when malformed', () => {
      const result = setCustomProviderEntries([
        { id: 123 } as unknown as CustomProviderEntry,
      ]);

      // `String(...)` on a non-string id — the user still gets a handle on
      // which line of their settings file is at fault.
      expect(result.rejected[0].id).toBe('123');
    });
  });

  describe('getAnthropicProvider', () => {
    it('resolves a registered custom entry by id', () => {
      setCustomProviderEntries([makeEntry({ id: 'my-box', name: 'My Box' })]);

      const provider = getAnthropicProvider('my-box');
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('My Box');
      expect(provider?.isCustom).toBe(true);
      expect(provider?.requiresProxy).toBe(true);
    });

    it('still resolves built-ins unchanged', () => {
      setCustomProviderEntries([makeEntry()]);
      expect(getAnthropicProvider('openrouter')?.name).toBe('OpenRouter');
    });

    it('returns undefined for an id nobody registered', () => {
      expect(getAnthropicProvider('never-registered')).toBeUndefined();
    });

    it('stops resolving an entry once the cache is cleared', () => {
      setCustomProviderEntries([makeEntry({ id: 'transient' })]);
      expect(getAnthropicProvider('transient')).toBeDefined();

      clearCustomProviderEntries();
      expect(getAnthropicProvider('transient')).toBeUndefined();
      expect(getAllAnthropicProviders()).toHaveLength(
        ANTHROPIC_PROVIDERS.length,
      );
    });
  });

  describe('entry accessors', () => {
    it('exposes the raw stored entry, lane and pricing included', () => {
      setCustomProviderEntries([
        makeEntry({
          id: 'priced',
          lane: 'anthropic',
          pricing: { inputPerMillion: 1, outputPerMillion: 2 },
        }),
      ]);

      const entry = getCustomProviderEntry('priced');
      expect(entry?.lane).toBe('anthropic');
      expect(entry?.pricing).toEqual({
        inputPerMillion: 1,
        outputPerMillion: 2,
      });
      expect(getCustomProviderEntries()).toHaveLength(1);
    });

    it('distinguishes custom ids from built-in ids', () => {
      setCustomProviderEntries([makeEntry({ id: 'mine' })]);
      expect(isCustomProviderId('mine')).toBe(true);
      expect(isCustomProviderId('openrouter')).toBe(false);
      expect(isCustomProviderId('unknown')).toBe(false);
    });
  });
});

describe('subscription-billed providers', () => {
  it('flags the two flat-fee providers and nothing else', () => {
    expect(isSubscriptionCoveredProvider('openai-codex')).toBe(true);
    expect(isSubscriptionCoveredProvider('github-copilot')).toBe(true);
    expect(isSubscriptionCoveredProvider('openrouter')).toBe(false);
    expect(isSubscriptionCoveredProvider(null)).toBe(false);
    expect(isSubscriptionCoveredProvider('unknown')).toBe(false);
  });

  it('never publishes their $0 rates under a bare model id', () => {
    // `gpt-5.4` is a Codex static model AND an OpenRouter usage-billed model.
    // Seeding it at $0 would make the next OpenRouter session read as free —
    // and would zero out the Codex session's own reference figure.
    seedStaticModelPricing('openai-codex');
    seedStaticModelPricing('github-copilot');

    const map = getPricingMap();
    for (const model of getAnthropicProvider('openai-codex')?.staticModels ??
      []) {
      expect(map[model.id]).toBeUndefined();
    }
  });
});
