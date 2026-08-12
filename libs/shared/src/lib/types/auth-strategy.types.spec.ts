/**
 * Auth strategy routing matrix — the pin.
 *
 * `resolveStrategy` is the single translation point between the persisted
 * config triad (`apiKey` | `claudeCli` | `thirdParty`) and the IAuthStrategy
 * that actually configures the Agent SDK. Every surface (Electron webview,
 * VS Code webview, TUI, `ptah auth`, `ptah doctor`) funnels through it, so a
 * one-line change here silently re-routes every provider on every platform.
 *
 * TASK_2026_172 Issue 1 changed exactly one cell of that matrix:
 *   thirdParty + `claude-cli` (nativeAuth): 'local-native' → 'cli'.
 *
 * These specs therefore do two things:
 *   1. Enumerate the FULL synthetic matrix (authType × requiresProxy ×
 *      nativeAuth × legacyMethod) so any future edit that moves a second cell
 *      fails loudly.
 *   2. Assert the resolved route for every REAL entry in ANTHROPIC_PROVIDERS
 *      by id, driving the assertion off the live registry. If someone adds a
 *      provider without deciding its route, the exhaustiveness check fails.
 */

import {
  resolveStrategy,
  normalizeAuthMethod,
  type AuthStrategyType,
  type LegacyAuthMethod,
} from './auth-strategy.types';
import {
  ANTHROPIC_PROVIDERS,
  getAnthropicProvider,
  type AnthropicProvider,
} from '../providers/provider-registry';

/**
 * `ANTHROPIC_PROVIDERS` is declared `as const satisfies readonly
 * AnthropicProvider[]`, so its element type is a union of literal shapes —
 * entries that omit `authType` entirely (moonshot, z-ai) have no property in
 * common with `resolveStrategy`'s all-optional parameter and trip TypeScript's
 * weak-type check. Widening to the declared interface (the same thing
 * production callers like `AuthManager` receive from `getAnthropicProvider`)
 * is what makes these specs exercise the real call shape.
 */
const REGISTRY: readonly AnthropicProvider[] = ANTHROPIC_PROVIDERS;

describe('resolveStrategy — legacy method short-circuits', () => {
  // `claudeCli` and `apiKey` never consult provider metadata: the provider
  // argument must not be able to change the outcome.
  const irrelevantProviders = [
    undefined,
    {},
    { authType: 'none' as const, requiresProxy: false },
    { authType: 'none' as const, requiresProxy: true },
    { authType: 'oauth' as const, requiresProxy: true },
    { authType: 'apiKey' as const, requiresProxy: false },
    { nativeAuth: true },
  ];

  it.each(irrelevantProviders)(
    "'claudeCli' resolves to 'cli' regardless of provider metadata (%j)",
    (provider) => {
      expect(resolveStrategy('claudeCli', provider)).toBe('cli');
    },
  );

  it.each(irrelevantProviders)(
    "'apiKey' resolves to 'api-key' regardless of provider metadata (%j)",
    (provider) => {
      expect(resolveStrategy('apiKey', provider)).toBe('api-key');
    },
  );

  it("'thirdParty' with no provider metadata falls back to 'api-key'", () => {
    expect(resolveStrategy('thirdParty')).toBe('api-key');
    expect(resolveStrategy('thirdParty', undefined)).toBe('api-key');
  });
});

describe('resolveStrategy — full thirdParty matrix (authType × proxy × nativeAuth)', () => {
  const authTypes = [
    undefined,
    'apiKey',
    'oauth',
    'none',
  ] as const satisfies readonly (undefined | 'apiKey' | 'oauth' | 'none')[];
  const proxyFlags = [undefined, false, true] as const;
  const nativeFlags = [undefined, false, true] as const;

  /**
   * Expected route per cell, written independently of the implementation so
   * the table is a specification rather than a transcription.
   */
  function expectedRoute(
    authType: (typeof authTypes)[number],
    requiresProxy: (typeof proxyFlags)[number],
    nativeAuth: (typeof nativeFlags)[number],
  ): AuthStrategyType {
    if (nativeAuth === true) return 'cli';
    if (authType === 'oauth' && requiresProxy === true) return 'oauth-proxy';
    if (authType === 'none')
      return requiresProxy === true ? 'local-proxy' : 'local-native';
    return 'api-key';
  }

  const cells: Array<{
    authType: (typeof authTypes)[number];
    requiresProxy: (typeof proxyFlags)[number];
    nativeAuth: (typeof nativeFlags)[number];
    expected: AuthStrategyType;
  }> = [];

  for (const authType of authTypes) {
    for (const requiresProxy of proxyFlags) {
      for (const nativeAuth of nativeFlags) {
        cells.push({
          authType,
          requiresProxy,
          nativeAuth,
          expected: expectedRoute(authType, requiresProxy, nativeAuth),
        });
      }
    }
  }

  it('enumerates every cell of the 4×3×3 matrix', () => {
    expect(cells).toHaveLength(36);
  });

  it.each(cells)(
    'thirdParty + authType=$authType proxy=$requiresProxy nativeAuth=$nativeAuth → $expected',
    ({ authType, requiresProxy, nativeAuth, expected }) => {
      expect(
        resolveStrategy('thirdParty', { authType, requiresProxy, nativeAuth }),
      ).toBe(expected);
    },
  );

  it("nativeAuth wins over every authType/proxy combination — a nativeAuth provider must NEVER reach 'local-native'", () => {
    for (const authType of authTypes) {
      for (const requiresProxy of proxyFlags) {
        expect(
          resolveStrategy('thirdParty', {
            authType,
            requiresProxy,
            nativeAuth: true,
          }),
        ).toBe('cli');
      }
    }
  });

  it('nativeAuth:false and nativeAuth:undefined are indistinguishable — only an explicit `true` opts in', () => {
    for (const authType of authTypes) {
      for (const requiresProxy of proxyFlags) {
        expect(
          resolveStrategy('thirdParty', {
            authType,
            requiresProxy,
            nativeAuth: false,
          }),
        ).toBe(
          resolveStrategy('thirdParty', {
            authType,
            requiresProxy,
            nativeAuth: undefined,
          }),
        );
      }
    }
  });
});

describe('resolveStrategy — live ANTHROPIC_PROVIDERS registry', () => {
  /**
   * The contract, keyed by real provider id. Any registry entry missing from
   * this map fails the exhaustiveness assertion below, so a new provider
   * cannot ship without an explicit routing decision.
   */
  const EXPECTED_ROUTE_BY_PROVIDER_ID: Record<string, AuthStrategyType> = {
    // API-key providers — unchanged by TASK_2026_172.
    openrouter: 'api-key', // authType 'apiKey' + requiresProxy true
    moonshot: 'api-key', // authType undefined (defaults to key)
    'z-ai': 'api-key', // authType undefined (defaults to key)
    sakana: 'api-key', // apiKey + requiresProxy true → proxy started inside ApiKeyStrategy
    requesty: 'api-key', // apiKey + requiresProxy FALSE → native Messages passthrough (TASK_2026_236)
    // OAuth + translation proxy — unchanged.
    'github-copilot': 'oauth-proxy',
    'openai-codex': 'oauth-proxy',
    // Local providers — unchanged. These are the routes claude-cli must NOT share.
    ollama: 'local-native',
    'ollama-cloud': 'local-native',
    'lm-studio': 'local-proxy',
    // The fix: ambient `~/.claude` subscription credentials.
    'claude-cli': 'cli',
  };

  it('covers every provider in the registry (no unrouted entries)', () => {
    const registryIds = REGISTRY.map((p) => p.id).sort();
    const pinnedIds = Object.keys(EXPECTED_ROUTE_BY_PROVIDER_ID).sort();
    expect(registryIds).toEqual(pinnedIds);
  });

  it.each(Object.entries(EXPECTED_ROUTE_BY_PROVIDER_ID))(
    "thirdParty + '%s' resolves to '%s'",
    (providerId, expected) => {
      const provider = getAnthropicProvider(providerId);
      expect(provider).toBeDefined();
      expect(resolveStrategy('thirdParty', provider)).toBe(expected);
    },
  );

  it("'claude-cli' never sets up a local endpoint: it is the only registry entry with nativeAuth", () => {
    const nativeAuthProviders = REGISTRY.filter(
      (p) => 'nativeAuth' in p && p.nativeAuth === true,
    ).map((p) => p.id);
    expect(nativeAuthProviders).toEqual(['claude-cli']);
  });

  it('the API-key provider set is exactly {openrouter, moonshot, z-ai, sakana, requesty} — regression guard for acceptance criterion 2', () => {
    const apiKeyRouted = REGISTRY.filter(
      (p) => resolveStrategy('thirdParty', p) === 'api-key',
    )
      .map((p) => p.id)
      .sort();
    expect(apiKeyRouted).toEqual([
      'moonshot',
      'openrouter',
      'requesty',
      'sakana',
      'z-ai',
    ]);
  });

  it('the local-* provider set is exactly {ollama, ollama-cloud, lm-studio} — claude-cli is no longer among them', () => {
    const localRouted = REGISTRY.filter((p) => {
      const route = resolveStrategy('thirdParty', p);
      return route === 'local-native' || route === 'local-proxy';
    })
      .map((p) => p.id)
      .sort();
    expect(localRouted).toEqual(['lm-studio', 'ollama', 'ollama-cloud']);
  });
});

describe('normalizeAuthMethod → resolveStrategy end-to-end', () => {
  const cases: Array<{ raw: unknown; method: LegacyAuthMethod }> = [
    { raw: 'apiKey', method: 'apiKey' },
    { raw: 'claudeCli', method: 'claudeCli' },
    { raw: 'claude-cli', method: 'claudeCli' },
    { raw: 'thirdParty', method: 'thirdParty' },
    { raw: 'oauth', method: 'thirdParty' },
    { raw: 'openrouter', method: 'thirdParty' },
    { raw: 'nonsense', method: 'apiKey' },
    { raw: undefined, method: 'apiKey' },
    { raw: 42, method: 'apiKey' },
  ];

  it.each(cases)('normalizes %j → $method', ({ raw, method }) => {
    expect(normalizeAuthMethod(raw)).toBe(method);
  });

  it("the persisted claude-cli tile state (authMethod 'thirdParty' + provider 'claude-cli') resolves to 'cli'", () => {
    const method = normalizeAuthMethod('thirdParty');
    const provider = getAnthropicProvider('claude-cli');
    expect(resolveStrategy(method, provider)).toBe('cli');
  });
});
