/**
 * `resolveEffectiveAuthRoute` — the "what would happen if I ran an agent right
 * now?" reporter behind `ptah doctor`, `ptah init`, and the settings panels.
 *
 * Its whole value is agreeing with `AuthManager`. TASK_2026_172 Issue 1 moved
 * `claude-cli` from `local-native` to `cli` inside `resolveStrategy`, but this
 * resolver could not follow: its `EffectiveRouteProvider.type` union is
 * probe-shaped (`apiKey | oauth | local-native | local-proxy | cli | unknown`)
 * and `ptah doctor` classifies `claude-cli` as `'unknown'` — the provider is
 * `authType: 'none'` WITHOUT `isLocal`, so it falls out of doctor's local
 * branch. `'unknown'` used to degrade to `'api-key'`, i.e. doctor reported a
 * route the runtime would never take. Reading `nativeAuth` from the registry
 * closes that gap.
 */

import { resolveEffectiveAuthRoute } from './effective-route';
import type {
  EffectiveRouteConfig,
  EffectiveRouteProvider,
} from './effective-route';

function config(
  overrides: Partial<EffectiveRouteConfig> = {},
): EffectiveRouteConfig {
  return {
    authMethod: 'thirdParty',
    defaultProvider: null,
    anthropicProviderId: null,
    ...overrides,
  };
}

describe('resolveEffectiveAuthRoute — claude-cli (nativeAuth)', () => {
  /**
   * Exactly what `ptah doctor`'s `probeProvider` emits for `claude-cli`:
   * neither the apiKey, oauth, nor `authType==='none' && isLocal` branch
   * matches, so it returns `{ type: 'unknown', status: 'unknown' }`.
   */
  const doctorClaudeCliEntry: EffectiveRouteProvider = {
    id: 'claude-cli',
    type: 'unknown',
    status: 'unknown',
  };

  it("reports 'cli' for the claude-cli tile even though the probe reports 'unknown'", () => {
    const result = resolveEffectiveAuthRoute(
      config({ anthropicProviderId: 'claude-cli' }),
      [doctorClaudeCliEntry],
    );

    expect(result.route).toBe('cli');
  });

  it("never reports 'local-native' for claude-cli, whatever the probe says", () => {
    const probeShapes: EffectiveRouteProvider['type'][] = [
      'unknown',
      'local-native',
      'local-proxy',
      'apiKey',
      'oauth',
      'cli',
    ];

    for (const type of probeShapes) {
      const result = resolveEffectiveAuthRoute(
        config({ anthropicProviderId: 'claude-cli' }),
        [{ id: 'claude-cli', type, status: 'connected' }],
      );
      expect(result.route).toBe('cli');
    }
  });

  it('agrees with the legacy claudeCli auth method, which also drives claude-cli', () => {
    const viaLegacy = resolveEffectiveAuthRoute(
      config({ authMethod: 'claude-cli' }),
      [{ id: 'claude-cli', type: 'cli', status: 'connected' }],
    );
    const viaTile = resolveEffectiveAuthRoute(
      config({ anthropicProviderId: 'claude-cli' }),
      [doctorClaudeCliEntry],
    );

    expect(viaLegacy.route).toBe('cli');
    expect(viaTile.route).toBe('cli');
  });
});

describe('resolveEffectiveAuthRoute — non-native providers are unchanged', () => {
  const cases: Array<{
    id: string;
    type: EffectiveRouteProvider['type'];
    expected: string;
  }> = [
    { id: 'openrouter', type: 'apiKey', expected: 'api-key' },
    { id: 'moonshot', type: 'apiKey', expected: 'api-key' },
    { id: 'z-ai', type: 'apiKey', expected: 'api-key' },
    { id: 'sakana', type: 'apiKey', expected: 'api-key' },
    { id: 'github-copilot', type: 'oauth', expected: 'oauth-proxy' },
    { id: 'openai-codex', type: 'oauth', expected: 'oauth-proxy' },
    { id: 'ollama', type: 'local-native', expected: 'local-native' },
    { id: 'ollama-cloud', type: 'local-native', expected: 'local-native' },
    { id: 'lm-studio', type: 'local-proxy', expected: 'local-proxy' },
  ];

  it.each(cases)('$id ($type) → $expected', ({ id, type, expected }) => {
    const result = resolveEffectiveAuthRoute(
      config({ anthropicProviderId: id }),
      [{ id, type, status: 'connected' }],
    );
    expect(result.route).toBe(expected);
  });

  it('still reports blockers for a provider that needs a key', () => {
    const result = resolveEffectiveAuthRoute(
      config({ anthropicProviderId: 'openrouter' }),
      [{ id: 'openrouter', type: 'apiKey', status: 'needs-key' }],
    );

    expect(result.route).toBe('api-key');
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      "provider 'openrouter' has no API key configured",
    ]);
  });

  it("returns 'unresolved' when authMethod is unrecognized", () => {
    const result = resolveEffectiveAuthRoute(
      config({ authMethod: 'nope' }),
      [],
    );
    expect(result.route).toBe('unresolved');
    expect(result.ready).toBe(false);
  });
});

describe('resolveEffectiveAuthRoute — raw un-normalised authMethod (pin 1)', () => {
  /**
   * The settings UI may hand the resolver a value exactly as the user or a
   * legacy file stored it. `effective-route.ts` normalises with
   * `trim().toLowerCase()` before matching, so case and whitespace must
   * never change the verdict — and the blocker must echo the value it was
   * actually given, not its normalised form.
   */
  it("normalises '  APIKEY  ' to the api-key route", () => {
    const result = resolveEffectiveAuthRoute(
      config({ authMethod: '  APIKEY  ' }),
      [],
    );
    expect(result.route).toBe('api-key');
    // No default provider pinned: the route falls back to the anthropic tile.
    expect(result.driverProviderId).toBe('anthropic');
  });

  it("normalises ' OAuth ' through to the oauth-proxy route", () => {
    const result = resolveEffectiveAuthRoute(
      config({ authMethod: ' OAuth ', anthropicProviderId: 'github-copilot' }),
      [{ id: 'github-copilot', type: 'oauth', status: 'connected' }],
    );
    expect(result.route).toBe('oauth-proxy');
    expect(result.ready).toBe(true);
  });

  it("echoes an unrecognized raw value verbatim in the blocker", () => {
    const result = resolveEffectiveAuthRoute(
      config({ authMethod: '  MoonWalk  ' }),
      [],
    );
    expect(result.route).toBe('unresolved');
    expect(result.blockers).toEqual([
      "authMethod is unset or unrecognized ('  MoonWalk  ')",
    ]);
  });
});
