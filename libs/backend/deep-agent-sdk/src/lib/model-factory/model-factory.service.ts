/**
 * ModelFactoryService — Create LangChain ChatModel instances using the
 * provider registry from agent-sdk.
 *
 * Instead of hardcoding base URLs per provider, this reads provider metadata
 * from the same AnthropicProvider registry that AuthManager uses. For providers
 * that need a translation proxy (Copilot, Codex, LM Studio), it reads the
 * proxy URL directly.
 *
 * All providers use ChatOpenAI since LangChain speaks OpenAI Chat Completions.
 * Ollama exposes this at {baseUrl}/v1/chat/completions.
 */

import { injectable, inject } from 'tsyringe';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  Logger,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  getAnthropicProvider,
  type AnthropicProviderId,
} from '@ptah-extension/agent-sdk';

interface ITranslationProxyLike {
  isRunning(): boolean;
  getUrl(): string | null;
  start(): Promise<{ url: string }>;
}

const OLLAMA_PLACEHOLDER_TOKEN = 'ollama';

/** Providers where no real API key is needed (local servers). */
const NO_AUTH_PROVIDERS = new Set<string>([
  'ollama',
  'ollama-cloud',
  'lm-studio',
]);

/**
 * OpenAI-compatible base URLs for cloud API providers.
 *
 * The provider registry stores Anthropic Messages API URLs (used by the SDK).
 * LangChain's ChatOpenAI needs OpenAI Chat Completions endpoints instead.
 */
const OPENAI_COMPAT_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  'z-ai': 'https://api.z.ai/api/coding/paas/v4',
};

@injectable()
export class ModelFactoryService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_COPILOT_PROXY)
    private readonly copilotProxy: ITranslationProxyLike,
    @inject(SDK_TOKENS.SDK_CODEX_PROXY)
    private readonly codexProxy: ITranslationProxyLike,
    @inject(SDK_TOKENS.SDK_LM_STUDIO_PROXY)
    private readonly lmStudioProxy: ITranslationProxyLike,
  ) {}

  async createChatModel(
    providerId: AnthropicProviderId,
    modelId: string,
  ): Promise<BaseChatModel> {
    this.logger.info('[DeepAgent.ModelFactory] Creating chat model', {
      providerId,
      modelId,
    });

    const baseURL = await this.resolveBaseUrl(providerId);
    const apiKey = await this.resolveApiKey(providerId);

    this.logger.info('[DeepAgent.ModelFactory] Resolved connection', {
      providerId,
      baseURL,
      hasApiKey: !!apiKey,
    });

    return new ChatOpenAI({
      model: modelId,
      apiKey,
      configuration: { baseURL },
      streaming: true,
    });
  }

  /**
   * Resolve the OpenAI-compatible base URL for a provider.
   *
   * - Proxy providers (Copilot, Codex, LM Studio): URL from the running proxy
   * - Ollama/Ollama Cloud: {registryBaseUrl}/v1 (OpenAI-compat endpoint)
   * - Cloud providers (OpenRouter, Moonshot, Z.AI): registry baseUrl directly
   *   (already includes /v1 or equivalent)
   */
  private async resolveBaseUrl(
    providerId: AnthropicProviderId,
  ): Promise<string> {
    // Proxy-based providers — URL comes from the translation proxy
    if (providerId === 'github-copilot') {
      return (
        this.copilotProxy.getUrl() ?? (await this.copilotProxy.start()).url
      );
    }
    if (providerId === 'openai-codex') {
      return this.codexProxy.getUrl() ?? (await this.codexProxy.start()).url;
    }
    if (providerId === 'lm-studio') {
      return (
        this.lmStudioProxy.getUrl() ?? (await this.lmStudioProxy.start()).url
      );
    }

    // Ollama — OpenAI-compatible endpoint at {host}/v1
    if (providerId === 'ollama' || providerId === 'ollama-cloud') {
      const provider = getAnthropicProvider(providerId);
      const customHost = process.env['OLLAMA_HOST'];
      const host =
        customHost?.trim() || provider?.baseUrl || 'http://localhost:11434';
      return `${host}/v1`;
    }

    // Cloud API providers — use OpenAI-compatible URLs (registry stores Anthropic URLs)
    const openaiUrl = OPENAI_COMPAT_URLS[providerId];
    if (openaiUrl) {
      return openaiUrl;
    }

    throw new Error(
      `[ModelFactoryService] No OpenAI-compatible URL mapping for provider: ${providerId}`,
    );
  }

  /**
   * Resolve the API key for a provider.
   *
   * - No-auth providers (Ollama, LM Studio): placeholder token
   * - Proxy providers (Copilot, Codex): proxy placeholder token
   * - Cloud providers: read from AuthSecretsService
   */
  private async resolveApiKey(
    providerId: AnthropicProviderId,
  ): Promise<string> {
    if (NO_AUTH_PROVIDERS.has(providerId)) {
      return OLLAMA_PLACEHOLDER_TOKEN;
    }
    if (providerId === 'github-copilot' || providerId === 'openai-codex') {
      return COPILOT_PROXY_TOKEN_PLACEHOLDER;
    }

    // Cloud providers — read API key from secure storage
    const key = await this.authSecrets.getProviderKey(providerId);
    if (!key) {
      this.logger.warn(
        `[DeepAgent.ModelFactory] No API key found for provider: ${providerId}`,
      );
    }
    return key ?? '';
  }
}
