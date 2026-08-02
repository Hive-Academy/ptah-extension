/**
 * Provider tile form resolution — specs.
 *
 * Driven off the REAL shared provider registry rather than hand-written
 * fixtures, because both defects under test were disagreements between what
 * the registry says and what the TUI assumed:
 *
 *   Issue 3 — Ollama Cloud's `supportsOptionalApiKey` was unreachable behind
 *   the `authType: 'none'` test, so the optional key had no input.
 *   Issue 4 — every non-Ollama tile displayed LM Studio's `localhost:1234`.
 *
 * Feeding the registry through the same projection `auth:getAuthStatus`
 * performs means a registry edit that breaks a tile fails here.
 */

import { ANTHROPIC_PROVIDERS } from '@ptah-extension/shared';
import type { AnthropicProviderInfo } from '@ptah-extension/shared';
import {
  CLAUDE_TILE_ID,
  formAcceptsApiKey,
  formKeyIsOptional,
  resolveProviderEndpoint,
  resolveProviderFormKind,
  type ProviderFormKind,
} from './provider-form.js';

/**
 * Mirror of the `availableProviders` projection in
 * `AuthRpcHandlers.registerGetAuthStatus` — the exact payload the TUI sees.
 */
function asStatusPayload(id: string): AnthropicProviderInfo {
  const p = ANTHROPIC_PROVIDERS.find((entry) => entry.id === id);
  if (!p) throw new Error(`unknown provider in registry: ${id}`);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    helpUrl: p.helpUrl,
    keyPrefix: p.keyPrefix,
    keyPlaceholder: p.keyPlaceholder,
    maskedKeyDisplay: p.maskedKeyDisplay,
    authType: 'authType' in p ? p.authType : undefined,
    isLocal: 'isLocal' in p ? p.isLocal : undefined,
    baseUrl: p.baseUrl,
    supportsOptionalApiKey:
      'supportsOptionalApiKey' in p ? p.supportsOptionalApiKey : undefined,
    nativeAuth: 'nativeAuth' in p ? p.nativeAuth : undefined,
  };
}

describe('resolveProviderFormKind', () => {
  it('maps the synthetic Claude tile to the direct API-key form', () => {
    expect(resolveProviderFormKind(CLAUDE_TILE_ID, null)).toBe('claude');
  });

  const expected: Record<string, ProviderFormKind> = {
    'github-copilot': 'copilot',
    'openai-codex': 'codex',
    'claude-cli': 'ambient',
    ollama: 'local',
    'lm-studio': 'local',
    'ollama-cloud': 'local-optional-key',
    openrouter: 'api-key',
    moonshot: 'api-key',
    'z-ai': 'api-key',
    sakana: 'api-key',
  };

  it('covers every registry provider (a new provider must pick a form)', () => {
    expect(ANTHROPIC_PROVIDERS.map((p) => p.id).sort()).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it.each(Object.entries(expected))('%s → %s form', (id, kind) => {
    expect(resolveProviderFormKind(id, asStatusPayload(id))).toBe(kind);
  });

  /**
   * Issue 3. `ollama-cloud` is `authType: 'none'`, so the old
   * `authType === 'none' → local` short-circuit hid its optional key. It must
   * NOT be classified as a plain local provider.
   */
  it('routes Ollama Cloud to the optional-key form, not the keyless local form', () => {
    const kind = resolveProviderFormKind(
      'ollama-cloud',
      asStatusPayload('ollama-cloud'),
    );

    expect(kind).toBe('local-optional-key');
    expect(kind).not.toBe('local');
    expect(formAcceptsApiKey(kind)).toBe(true);
    expect(formKeyIsOptional(kind)).toBe(true);
  });

  it('keeps plain Ollama and LM Studio keyless', () => {
    for (const id of ['ollama', 'lm-studio']) {
      const kind = resolveProviderFormKind(id, asStatusPayload(id));
      expect(kind).toBe('local');
      expect(formAcceptsApiKey(kind)).toBe(false);
    }
  });

  /**
   * Issue 1's TUI face: the Claude Subscription tile is `authType: 'none'`
   * too, so it also fell into the local form and was offered as a localhost
   * server with an API-key-free "endpoint".
   */
  it('gives the Claude Subscription tile the ambient form — no endpoint, no key', () => {
    const provider = asStatusPayload('claude-cli');
    const kind = resolveProviderFormKind('claude-cli', provider);

    expect(kind).toBe('ambient');
    expect(formAcceptsApiKey(kind)).toBe(false);
    expect(resolveProviderEndpoint(provider)).toBeNull();
  });

  it('falls back to the api-key form when provider metadata is missing', () => {
    expect(resolveProviderFormKind('mystery', undefined)).toBe('api-key');
    expect(resolveProviderFormKind('mystery', null)).toBe('api-key');
  });
});

describe('resolveProviderEndpoint', () => {
  /**
   * Issue 4. The old ternary returned `http://localhost:1234` for everything
   * that was not literally `ollama`. These are the registry's real values.
   */
  const expectedEndpoints: Record<string, string | null> = {
    ollama: 'http://127.0.0.1:11434',
    'ollama-cloud': 'http://127.0.0.1:11434',
    'lm-studio': 'http://localhost:1234/v1',
    'claude-cli': null,
  };

  it.each(Object.entries(expectedEndpoints))('%s → %s', (id, endpoint) => {
    expect(resolveProviderEndpoint(asStatusPayload(id))).toBe(endpoint);
  });

  it('never reports LM Studio’s port for a non-LM-Studio provider', () => {
    for (const id of ['ollama', 'ollama-cloud', 'claude-cli']) {
      // `claude-cli` resolves to null (no endpoint at all), which is also a
      // pass — the assertion is "never LM Studio's port", not "always a URL".
      expect(resolveProviderEndpoint(asStatusPayload(id)) ?? '').not.toContain(
        ':1234',
      );
    }
  });

  it('uses the registry’s IPv4 literal for Ollama, not `localhost`', () => {
    // `localhost` resolves to ::1 first on Windows, where an unrelated
    // listener can shadow the daemon — the registry pins 127.0.0.1 for this
    // reason and the TUI must display what it will actually talk to.
    expect(resolveProviderEndpoint(asStatusPayload('ollama'))).toBe(
      'http://127.0.0.1:11434',
    );
  });

  it('returns null for an absent or blank base url', () => {
    expect(resolveProviderEndpoint(null)).toBeNull();
    expect(resolveProviderEndpoint(undefined)).toBeNull();
    expect(
      resolveProviderEndpoint({
        ...asStatusPayload('ollama'),
        baseUrl: '   ',
      }),
    ).toBeNull();
  });
});
