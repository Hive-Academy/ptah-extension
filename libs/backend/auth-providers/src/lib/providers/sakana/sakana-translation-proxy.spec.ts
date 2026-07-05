/**
 * SakanaTranslationProxy — unit specs.
 *
 * The proxy is a thin Chat Completions subclass of TranslationProxyBase
 * (mirrors OpenRouterTranslationProxy). HTTP/translation/streaming are covered
 * by translation-proxy-base.spec.ts; here we only assert the Sakana-specific
 * configuration hooks:
 *   - getApiEndpoint() → https://api.sakana.ai/v1
 *   - getHeaders()     → delegates to the injected auth service
 *   - onAuthFailure()  → false (user-provided key, not refreshable)
 *   - normalizeModelId → tier aliases mapped via SAKANA_DEFAULT_TIERS, else pass-through
 *   - shouldUseResponsesApi → false (Chat Completions for v1)
 *   - getStaticModels  → fugu / fugu-ultra from the registry entry
 */

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { SAKANA_DEFAULT_TIERS } from '@ptah-extension/shared';
import { SakanaTranslationProxy } from './sakana-translation-proxy';
import type { ISakanaAuthService } from './sakana-provider.types';

// Expose the protected hooks for assertion.
class TestableSakanaProxy extends SakanaTranslationProxy {
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

function makeProxy(auth?: Partial<ISakanaAuthService>): TestableSakanaProxy {
  const logger = createMockLogger();
  const sakanaAuth: ISakanaAuthService = {
    isAuthenticated: jest.fn(async () => true),
    getApiKey: jest.fn(async () => 'sakana-key'),
    getHeaders: jest.fn(async () => ({
      Authorization: 'Bearer sakana-key',
      'Content-Type': 'application/json',
    })),
    ...auth,
  };
  return new TestableSakanaProxy(logger as unknown as Logger, sakanaAuth);
}

describe('SakanaTranslationProxy', () => {
  it('exposes the static Sakana API endpoint', async () => {
    await expect(makeProxy().getApiEndpointPublic()).resolves.toBe(
      'https://api.sakana.ai/v1',
    );
  });

  it('delegates header construction to the auth service', async () => {
    const getHeaders = jest.fn(async () => ({
      Authorization: 'Bearer from-auth',
      'Content-Type': 'application/json',
    }));
    const proxy = makeProxy({ getHeaders });

    const headers = await proxy.getHeadersPublic();

    expect(getHeaders).toHaveBeenCalledTimes(1);
    expect(headers['Authorization']).toBe('Bearer from-auth');
  });

  it('fails the retry on auth failure (key is not refreshable)', async () => {
    await expect(makeProxy().onAuthFailurePublic()).resolves.toBe(false);
  });

  it('routes through Chat Completions (never the Responses API)', () => {
    const proxy = makeProxy();
    expect(proxy.shouldUseResponsesApiPublic('fugu')).toBe(false);
    expect(proxy.shouldUseResponsesApiPublic('fugu-ultra')).toBe(false);
  });

  describe('normalizeModelId', () => {
    it('maps the opus alias to fugu-ultra', () => {
      expect(makeProxy().normalizeModelIdPublic('opus')).toBe(
        SAKANA_DEFAULT_TIERS.opus,
      );
    });

    it('maps default/sonnet to fugu', () => {
      const proxy = makeProxy();
      expect(proxy.normalizeModelIdPublic('default')).toBe(
        SAKANA_DEFAULT_TIERS.sonnet,
      );
      expect(proxy.normalizeModelIdPublic('sonnet')).toBe(
        SAKANA_DEFAULT_TIERS.sonnet,
      );
    });

    it('maps the haiku alias to fugu', () => {
      expect(makeProxy().normalizeModelIdPublic('haiku')).toBe(
        SAKANA_DEFAULT_TIERS.haiku,
      );
    });

    it('passes literal Fugu model ids through unchanged', () => {
      const proxy = makeProxy();
      expect(proxy.normalizeModelIdPublic('fugu')).toBe('fugu');
      expect(proxy.normalizeModelIdPublic('fugu-ultra')).toBe('fugu-ultra');
      expect(proxy.normalizeModelIdPublic('fugu-ultra-20260615')).toBe(
        'fugu-ultra-20260615',
      );
    });
  });

  it('returns the static fugu / fugu-ultra model list', () => {
    const ids = makeProxy()
      .getStaticModelsPublic()
      .map((m) => m.id);
    expect(ids).toContain('fugu');
    expect(ids).toContain('fugu-ultra');
  });
});
