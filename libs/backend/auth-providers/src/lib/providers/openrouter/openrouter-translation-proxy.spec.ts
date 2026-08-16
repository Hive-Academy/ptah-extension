/**
 * OpenRouterTranslationProxy — the last link in the chat path, and the one
 * that repairs nothing.
 *
 * TASK_2026_262 Batch 2, task 2.3. `normalizeModelId` is the IDENTITY function
 * here (`translation-proxy-base.ts:266` applies it to `anthropicRequest.model`
 * and nothing else touches the id afterwards), so whatever reaches this class
 * is exactly what OpenRouter is asked for. That is the reason the fix had to
 * land upstream: there is no downstream to fix it in.
 *
 * The end-to-end case below runs the chat path's own literal — the `'default'`
 * that `chat-session.service.ts:418` and `:1009` substitute for an empty
 * `selectedModel` — through the real `ProviderModelsService`, the real
 * `ModelResolver` and this proxy's real `normalizeModelId`, and asserts the id
 * that would go on the wire is one OpenRouter's own catalogue contains.
 *
 * `'default'` is restated as a literal rather than imported: `rpc-handlers`
 * depends on `auth-providers`, so importing it back would invert the graph.
 * The two sites are cited by line so the restatement is checkable.
 */

import 'reflect-metadata';

import type { ConfigManager, Logger } from '@ptah-extension/vscode-core';
import { createMockConfigManager } from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { AuthEnv } from '@ptah-extension/shared';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';

import { OpenRouterTranslationProxy } from './openrouter-translation-proxy';
import type { IOpenRouterAuthService } from './openrouter-provider.types';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from './openrouter-provider.types';
import { ProviderModelsService } from '../../provider-models.service';
import { ModelResolver } from '../../auth/model-resolver';
import { ActiveProviderResolver } from '../../auth/active-provider-resolver';

/** Expose the protected hook, as the sibling proxy specs do. */
class TestableOpenRouterProxy extends OpenRouterTranslationProxy {
  public normalizeModelIdPublic(modelId: string): string {
    return this.normalizeModelId(modelId);
  }
}

function makeProxy(): TestableOpenRouterProxy {
  const auth = {
    isAuthenticated: jest.fn(async () => true),
    getHeaders: jest.fn(async () => ({
      Authorization: 'Bearer sk-or-test',
      'Content-Type': 'application/json',
    })),
  } as unknown as IOpenRouterAuthService;
  return new TestableOpenRouterProxy(
    createMockLogger() as unknown as Logger,
    auth,
  );
}

/** The literal `chat-session.service.ts:418` and `:1009` substitute. */
const CHAT_EMPTY_SELECTION = 'default';

const CATALOG = [
  {
    id: 'anthropic/claude-opus-4.5',
    name: 'Claude Opus 4.5',
    description: 'Frontier model',
    contextLength: 200_000,
    supportsToolUse: true,
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    description: 'Fast model',
    contextLength: 200_000,
    supportsToolUse: true,
  },
];

describe('OpenRouterTranslationProxy.normalizeModelId', () => {
  it('passes a provider-prefixed id through untouched', () => {
    const proxy = makeProxy();
    expect(proxy.normalizeModelIdPublic('anthropic/claude-opus-4.5')).toBe(
      'anthropic/claude-opus-4.5',
    );
    expect(proxy.normalizeModelIdPublic('openai/gpt-5.3-codex')).toBe(
      'openai/gpt-5.3-codex',
    );
  });

  it('repairs nothing — a tier word arrives and leaves as a tier word', () => {
    // Not a defect in this class; it is the CONTRACT. OpenRouter expects full
    // provider-prefixed ids and this proxy has no catalogue of its own, so
    // inventing a mapping here would be exactly the "wrong-but-servable model"
    // TASK_2026_262 exists to avoid. It also means an unresolved tier cannot be
    // caught late: the upstream fix is the only fix.
    const proxy = makeProxy();
    for (const tier of ['opus', 'sonnet', 'haiku', CHAT_EMPTY_SELECTION]) {
      expect(proxy.normalizeModelIdPublic(tier)).toBe(tier);
    }
  });
});

describe("OpenRouter chat path — the chat's 'default' to the id on the wire", () => {
  /**
   * @param withCatalog whether OpenRouter has ever returned a model list.
   */
  function runChatPath(withCatalog: boolean): string {
    const configValues = withCatalog
      ? {
          'provider.openrouter.modelCatalog': { models: CATALOG, timestamp: 1 },
        }
      : {};
    const config = createMockConfigManager({ values: configValues });
    const scope = {
      read: <T>(key: string): T | undefined =>
        (configValues as Record<string, unknown>)[key] as T | undefined,
    } as unknown as WorkspaceScopeResolver;

    // The auth env as the OpenRouter proxy strategy leaves it: pointed at the
    // local proxy, with the placeholder token and no tier vars. ONE object,
    // shared between the two services exactly as `di/register.ts:37-40` binds
    // it with `registerInstance`.
    const env: AuthEnv = {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:51003',
      ANTHROPIC_AUTH_TOKEN: OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
    } as AuthEnv;

    const models = new ProviderModelsService(
      createMockLogger() as unknown as Logger,
      config as unknown as ConfigManager,
      env,
      new ActiveProviderResolver(scope),
    );
    const resolver = new ModelResolver(
      createMockLogger() as unknown as Logger,
      env,
    );

    models.applyPersistedTiers('openrouter');

    // `SdkModelService.resolveModelId` → `ModelResolver.resolve`, then the SDK
    // subprocess puts that string on the request the proxy receives.
    const resolved = resolver.resolve(CHAT_EMPTY_SELECTION);
    return makeProxy().normalizeModelIdPublic(resolved);
  }

  afterEach(() => {
    for (const tier of ['OPUS', 'SONNET', 'HAIKU']) {
      delete process.env[`ANTHROPIC_DEFAULT_${tier}_MODEL`];
      delete process.env[`ANTHROPIC_DEFAULT_${tier}_MODEL_NAME`];
      delete process.env[`ANTHROPIC_DEFAULT_${tier}_MODEL_DESCRIPTION`];
    }
  });

  it('sends a real catalogue id once OpenRouter has returned a model list', () => {
    // The whole carrier, in one line: the chat path's empty-selection literal
    // reaches OpenRouter as a model OpenRouter itself listed. `rpc-handlers`
    // needed no change for this — the substitution site still writes
    // `'default'`, and `'default'` is now resolvable.
    const onTheWire = runChatPath(true);

    expect(onTheWire).toBe('anthropic/claude-opus-4.5');
    expect(CATALOG.map((m) => m.id)).toContain(onTheWire);
  });

  it('still sends the bare tier word when no catalogue has ever landed', () => {
    // The residual, measured rather than hidden: before the first fetch (or
    // after a failed one) there is nothing to resolve through, and this is the
    // 404 the user sees. Q2 declined to convert it into a failure channel; the
    // one-time warn in `ModelResolver` is the signal instead.
    expect(runChatPath(false)).toBe('opus');
  });
});
