/**
 * CustomOpenAiTranslationProxy — unit specs.
 *
 * The generic, base-URL-driven Chat Completions subclass of
 * TranslationProxyBase backing user-defined `lane: 'openai'` entries.
 * HTTP/translation/streaming are covered by translation-proxy-base.spec.ts;
 * here we assert only the configuration hooks that make it generic:
 *   - normalizeOpenAiApiRoot() — the /v1 normalization + URL validation
 *   - getApiEndpoint()  → the normalized root from construction
 *   - getHeaders()      → Bearer key read from SecretStorage under the entry id
 *   - onAuthFailure()   → false, message names the endpoint (+ helpUrl if any)
 *   - getStaticModels() → the entry's models, else empty
 */

import 'reflect-metadata';
import type { Logger, IAuthSecretsService } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { createMockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import {
  CustomOpenAiTranslationProxy,
  normalizeOpenAiApiRoot,
} from './custom-openai-translation-proxy';
import type { CustomOpenAiProxyConfig } from './custom-provider.types';

// Expose the protected hooks for assertion.
class TestableCustomProxy extends CustomOpenAiTranslationProxy {
  public getApiEndpointPublic(): Promise<string> {
    return this.getApiEndpoint();
  }
  public getHeadersPublic(): Promise<Record<string, string>> {
    return this.getHeaders();
  }
  public onAuthFailurePublic(): Promise<boolean> {
    return this.onAuthFailure();
  }
  public normalizeModelIdPublic(modelId: string): string {
    return this.normalizeModelId(modelId);
  }
  public shouldUseResponsesApiPublic(modelId: string): boolean {
    return this.shouldUseResponsesApi(modelId);
  }
  public getStaticModelsPublic(): Array<{ id: string }> {
    return this.getStaticModels();
  }
}

const BASE_CONFIG: CustomOpenAiProxyConfig = {
  providerId: 'my-vllm-box',
  name: 'My vLLM Box',
  baseUrl: 'http://192.168.1.50:8000',
};

function makeProxy(
  overrides: Partial<CustomOpenAiProxyConfig> = {},
  providerKeys: Record<string, string> = { 'my-vllm-box': 'vllm-secret-key' },
): { proxy: TestableCustomProxy; logger: MockLogger } {
  const logger = createMockLogger();
  const authSecrets = createMockAuthSecretsService({ providerKeys });
  const proxy = new TestableCustomProxy(
    logger as unknown as Logger,
    authSecrets as unknown as IAuthSecretsService,
    { ...BASE_CONFIG, ...overrides },
  );
  return { proxy, logger };
}

describe('normalizeOpenAiApiRoot', () => {
  it('appends /v1 when the base URL carries no version segment', () => {
    expect(normalizeOpenAiApiRoot('http://192.168.1.50:8000')).toBe(
      'http://192.168.1.50:8000/v1',
    );
  });

  it('preserves an existing version segment rather than forcing /v1', () => {
    expect(normalizeOpenAiApiRoot('https://router.requesty.ai/v1')).toBe(
      'https://router.requesty.ai/v1',
    );
    expect(normalizeOpenAiApiRoot('https://gateway.example.com/v2')).toBe(
      'https://gateway.example.com/v2',
    );
  });

  it('strips trailing slashes before normalizing', () => {
    expect(normalizeOpenAiApiRoot('https://gateway.example.com///')).toBe(
      'https://gateway.example.com/v1',
    );
    expect(normalizeOpenAiApiRoot('https://router.requesty.ai/v1/')).toBe(
      'https://router.requesty.ai/v1',
    );
  });

  it('reproduces the built-in OpenRouter endpoint from its registry base URL', () => {
    // Load-bearing: the registry stores 'https://openrouter.ai/api' while
    // OpenRouterTranslationProxy hardcodes 'https://openrouter.ai/api/v1'.
    // The normalization must bridge exactly that gap.
    expect(normalizeOpenAiApiRoot('https://openrouter.ai/api')).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  it('rejects an unparseable URL at construction time', () => {
    expect(() => normalizeOpenAiApiRoot('not a url')).toThrow(
      /not a valid URL/,
    );
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => normalizeOpenAiApiRoot('ftp://files.example.com')).toThrow(
      /must use http or https/,
    );
  });

  it('rejects an empty base URL', () => {
    expect(() => normalizeOpenAiApiRoot('   ')).toThrow(/empty/);
  });
});

describe('CustomOpenAiTranslationProxy', () => {
  it('exposes the normalized endpoint built from the configured base URL', async () => {
    const { proxy } = makeProxy();
    await expect(proxy.getApiEndpointPublic()).resolves.toBe(
      'http://192.168.1.50:8000/v1',
    );
    expect(proxy.apiEndpoint).toBe('http://192.168.1.50:8000/v1');
  });

  it('surfaces the provider id it is bound to', () => {
    expect(makeProxy().proxy.providerId).toBe('my-vllm-box');
  });

  it('builds a Bearer header from the key stored under its own provider id', async () => {
    const { proxy } = makeProxy();

    const headers = await proxy.getHeadersPublic();

    expect(headers['Authorization']).toBe('Bearer vllm-secret-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('reads the key under the entry id, not a built-in id', async () => {
    // A key stored for OpenRouter must never satisfy a custom entry.
    const { proxy } = makeProxy({}, { openrouter: 'sk-or-v1-not-mine' });

    await expect(proxy.getHeadersPublic()).rejects.toThrow(
      /My vLLM Box API key is not configured/,
    );
  });

  it('throws when the key is missing or blank', async () => {
    await expect(
      makeProxy({}, { 'my-vllm-box': '   ' }).proxy.getHeadersPublic(),
    ).rejects.toThrow(/not configured/);
  });

  it('never logs the key itself, only its length', async () => {
    const { proxy, logger } = makeProxy();

    await proxy.getHeadersPublic();

    const logged = logger.debug.mock.calls.flat().join(' ');
    expect(logged).not.toContain('vllm-secret-key');
    expect(logged).toContain('key length: 15');
  });

  it('fails the retry on auth failure and names the endpoint', async () => {
    const { proxy, logger } = makeProxy();

    await expect(proxy.onAuthFailurePublic()).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('http://192.168.1.50:8000/v1'),
    );
  });

  it('quotes the entry help URL in the 401 message when one is configured', async () => {
    const { proxy, logger } = makeProxy({
      helpUrl: 'https://gateway.example.com/keys',
    });

    await proxy.onAuthFailurePublic();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Get a new key at https://gateway.example.com/keys',
      ),
    );
  });

  it('omits the key hint when the entry has no help URL', async () => {
    const { proxy, logger } = makeProxy();

    await proxy.onAuthFailurePublic();

    expect(logger.error).toHaveBeenCalledWith(
      expect.not.stringContaining('Get a new key at'),
    );
  });

  it('advertises no static models by default', () => {
    expect(makeProxy().proxy.getStaticModelsPublic()).toEqual([]);
  });

  it('advertises the entry static models when it declares them', () => {
    const { proxy } = makeProxy({
      staticModels: [{ id: 'llama-3.1-70b' }, { id: 'qwen-2.5-coder' }],
    });

    expect(proxy.getStaticModelsPublic().map((m) => m.id)).toEqual([
      'llama-3.1-70b',
      'qwen-2.5-coder',
    ]);
  });

  it('passes model ids through untouched (a custom gateway has no known aliases)', () => {
    const { proxy } = makeProxy();
    expect(proxy.normalizeModelIdPublic('sonnet')).toBe('sonnet');
    expect(proxy.normalizeModelIdPublic('meta-llama/llama-3.1-70b')).toBe(
      'meta-llama/llama-3.1-70b',
    );
  });

  it('always routes through Chat Completions, never the Responses API', () => {
    const { proxy } = makeProxy();
    expect(proxy.shouldUseResponsesApiPublic('gpt-4o')).toBe(false);
  });
});
