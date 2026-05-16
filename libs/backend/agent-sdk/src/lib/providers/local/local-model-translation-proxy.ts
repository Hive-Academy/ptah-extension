/**
 * Local Model Translation Proxy
 *
 * Translation proxy for local OpenAI-compatible model servers (LM Studio).
 * LM Studio exposes /v1/chat/completions and /v1/models endpoints with
 * no authentication.
 *
 * Architecture:
 * - `LocalModelTranslationProxy` is the base class (NOT @injectable)
 *   containing all shared logic for local OpenAI-compat providers.
 * - `LmStudioTranslationProxy` is the thin @injectable subclass.
 *
 * Note: Ollama no longer uses this proxy. Ollama v0.14.0+
 * speaks Anthropic Messages API natively — see OllamaModelDiscoveryService.
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import * as http from 'http';
import * as https from 'https';
import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import { TranslationProxyBase } from '../_shared/translation';
import { SdkError } from '../../errors';
import { getAnthropicProvider } from '../_shared/provider-registry';

// ---------------------------------------------------------------------------
// Base class (NOT injectable -- subclasses provide DI)
// ---------------------------------------------------------------------------

/**
 * Base translation proxy for local OpenAI-compatible model servers.
 *
 * Handles endpoint resolution (custom URL from settings or provider default),
 * minimal headers (no auth), and dynamic model listing from the local server.
 *
 * NOT decorated with @injectable() -- the concrete subclass
 * (LmStudioTranslationProxy) handles DI registration.
 */
export class LocalModelTranslationProxy extends TranslationProxyBase {
  constructor(
    logger: Logger,
    private readonly configManager: ConfigManager,
    private readonly providerId: string,
  ) {
    super(logger, {
      name: 'LMStudio',
      modelPrefix: '',
      completionsPath: '/chat/completions',
    });
  }

  /**
   * Get the upstream API endpoint URL.
   * Checks for user-configured custom URL first, falls back to provider entry default.
   */
  protected async getApiEndpoint(): Promise<string> {
    const customUrl = this.configManager.get<string>(
      `provider.${this.providerId}.baseUrl`,
    );
    if (customUrl?.trim()) {
      return customUrl.trim();
    }

    const provider = getAnthropicProvider(this.providerId);
    if (!provider?.baseUrl) {
      throw new SdkError(
        `No base URL configured for provider '${this.providerId}'`,
      );
    }
    return provider.baseUrl;
  }

  /**
   * Local providers require no authentication headers.
   * Return minimal headers for OpenAI-compatible API.
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Local providers have no auth to refresh.
   * Always returns false (no recovery possible for 401).
   */
  protected async onAuthFailure(): Promise<boolean> {
    return false;
  }

  /**
   * Return empty static model list -- local providers use dynamic model fetching.
   * The ProviderModelsService uses the registered dynamic fetcher instead.
   */
  protected getStaticModels(): Array<{ id: string }> {
    return [];
  }

  /**
   * Fetch available models from the local server's /v1/models endpoint.
   * Used as a DynamicModelFetcher registered with ProviderModelsService.
   * Also serves as a health check -- if this succeeds, the server is running.
   */
  async listModels(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      contextLength: number;
      supportsToolUse: boolean;
    }>
  > {
    const endpoint = await this.getApiEndpoint();
    // Build /v1/models URL from the base endpoint
    const modelsUrl = new URL('/v1/models', endpoint.replace(/\/v1\/?$/, ''));

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const requestFn =
          modelsUrl.protocol === 'https:' ? https.request : http.request;
        const req = requestFn(
          modelsUrl,
          { method: 'GET', timeout: 5000 },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              if (
                res.statusCode &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                resolve(Buffer.concat(chunks).toString('utf8'));
              } else {
                reject(new Error(`/v1/models returned ${res.statusCode}`));
              }
            });
          },
        );
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('/v1/models request timed out'));
        });
        req.end();
      });

      const parsed = JSON.parse(response);
      const models = parsed.data ?? parsed.models ?? [];

      return models.map((m: { id: string; object?: string }) => ({
        id: m.id,
        name: this.formatModelName(m.id),
        description: '',
        contextLength: 4096,
        supportsToolUse: false,
      }));
    } catch (error) {
      this.logger.warn(
        `[${this.config.name}Proxy] Failed to list models: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /** Convert model ID slug to display name */
  private formatModelName(id: string): string {
    return id
      .replace(/:/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

// ---------------------------------------------------------------------------
// Injectable subclass (LM Studio only — Ollama uses OllamaModelDiscoveryService)
// ---------------------------------------------------------------------------

/**
 * LM Studio translation proxy.
 * Thin injectable subclass that passes 'lm-studio' as the provider ID.
 */
@injectable()
export class LmStudioTranslationProxy extends LocalModelTranslationProxy {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) configManager: ConfigManager,
  ) {
    super(logger, configManager, 'lm-studio');
  }
}
