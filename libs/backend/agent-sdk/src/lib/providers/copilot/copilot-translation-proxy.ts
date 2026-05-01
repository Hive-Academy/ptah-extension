/**
 * Copilot Translation Proxy - TASK_2025_193 Batch 2
 *
 * Thin subclass of TranslationProxyBase that provides Copilot-specific
 * configuration: auth headers, API endpoint, model prefix, and completions path.
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import * as https from 'https';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import { TranslationProxyBase } from '../_shared/translation';
import type { ICopilotAuthService } from './copilot-provider.types';
import { COPILOT_PROVIDER_ENTRY } from './copilot-provider-entry';
import { SDK_TOKENS } from '../../di/tokens';

/** Default Copilot API endpoint (used when auth state has no override) */
const DEFAULT_COPILOT_API_ENDPOINT = 'https://api.githubcopilot.com';

@injectable()
export class CopilotTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(SDK_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: ICopilotAuthService,
  ) {
    super(logger, {
      name: 'Copilot',
      modelPrefix: '',
      completionsPath: '/chat/completions',
    });
  }

  /**
   * Get the Copilot API base URL from the current auth state.
   * Falls back to the default endpoint if no auth state or no override.
   */
  protected async getApiEndpoint(): Promise<string> {
    const authState = await this.copilotAuth.getAuthState();
    return authState?.apiEndpoint ?? DEFAULT_COPILOT_API_ENDPOINT;
  }

  /**
   * Get Copilot-specific auth and request headers from the auth service.
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return this.copilotAuth.getHeaders();
  }

  /**
   * On 401, attempt to re-login via GitHub OAuth to refresh the Copilot token.
   */
  protected async onAuthFailure(): Promise<boolean> {
    return this.copilotAuth.login();
  }

  /**
   * Return the static model list from the Copilot provider entry.
   * Used by the base class for the /v1/models proxy endpoint.
   */
  protected getStaticModels(): Array<{ id: string }> {
    return COPILOT_PROVIDER_ENTRY.staticModels ?? [];
  }

  // ---------------------------------------------------------------------------
  // Copilot-specific model and routing overrides
  // ---------------------------------------------------------------------------

  /**
   * Normalize Anthropic-format Claude model IDs to Copilot format.
   *
   * The SDK's resolveModelId() returns Anthropic API IDs with hyphens
   * (e.g., 'claude-opus-4-6', 'claude-haiku-4-5-20251001'), but the
   * Copilot API expects dot notation (e.g., 'claude-opus-4.6', 'claude-haiku-4.5').
   *
   * Non-Claude models (GPT, Gemini) pass through unchanged.
   */
  protected override normalizeModelId(modelId: string): string {
    if (!modelId.startsWith('claude-')) {
      return modelId;
    }

    // Match: claude-{family}-{major}-{minor}[-{anything}]
    // e.g., 'claude-opus-4-6' → 'claude-opus-4.6'
    // e.g., 'claude-haiku-4-5-20251001' → 'claude-haiku-4.5'
    // e.g., 'claude-sonnet-5-0-preview-20261001' → 'claude-sonnet-5.0'
    // Strips everything after major.minor — Copilot uses short model names.
    const match = modelId.match(
      /^(claude-(?:opus|sonnet|haiku)-\d+)-(\d+)(?:-.+)?$/,
    );
    if (match) {
      return `${match[1]}.${match[2]}`;
    }

    return modelId;
  }

  /**
   * Copilot uses Chat Completions (/chat/completions) for all models.
   *
   * The Copilot API at api.githubcopilot.com does not reliably support the
   * Responses API (/responses) for all GPT-5+ models — sending unsupported
   * models there results in "model_not_supported" errors. Chat Completions
   * is the known-working endpoint for all Copilot models.
   */
  protected override shouldUseResponsesApi(_modelId: string): boolean {
    return false;
  }

  /**
   * Fetch available models from the Copilot REST API's /models endpoint.
   * Returns only chat-type models with full metadata (context window, tool support, etc.).
   * Falls back to static models if the API call fails.
   */
  async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const apiEndpoint = await this.getApiEndpoint();
      const headers = await this.getHeaders();
      const url = new URL('/models', apiEndpoint);

      const response = await this.fetchJson<CopilotModelsResponse>(
        url,
        headers,
      );

      if (!response?.data?.length) {
        this.logger.warn(
          '[CopilotProxy] /models returned no data, using static models',
        );
        return this.staticModelsAsFull();
      }

      // Filter to chat models only (exclude embeddings)
      const chatModels = response.data.filter(
        (m) => m.capabilities?.type === 'chat',
      );

      this.logger.info(
        `[CopilotProxy] Fetched ${chatModels.length} chat models from Copilot API (${response.data.length} total)`,
      );

      return chatModels.map((m) => ({
        id: m.id,
        name: m.name || this.formatModelName(m.id),
        description: m.capabilities?.family ?? '',
        contextLength: m.capabilities?.limits?.max_context_window_tokens ?? 0,
        supportsToolUse: m.capabilities?.supports?.tool_calls ?? false,
      }));
    } catch (error) {
      this.logger.warn(
        `[CopilotProxy] Failed to fetch /models: ${
          error instanceof Error ? error.message : String(error)
        }. Using static models.`,
      );
      return this.staticModelsAsFull();
    }
  }

  /** Convert static models to ProviderModelInfo format */
  private staticModelsAsFull(): ProviderModelInfo[] {
    return (COPILOT_PROVIDER_ENTRY.staticModels ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? '',
      contextLength: m.contextLength ?? 0,
      supportsToolUse: m.supportsToolUse ?? false,
    }));
  }

  /** Convert model ID slug to display name: "gpt-5.3-codex" → "GPT 5.3 Codex" */
  private formatModelName(id: string): string {
    return id
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  }

  /** Fetch JSON from a URL using HTTPS */
  private fetchJson<T>(url: URL, headers: Record<string, string>): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: 'GET',
          headers: { ...headers, Accept: 'application/json' },
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
              } catch {
                reject(new Error('Invalid JSON from /models'));
              }
            } else {
              reject(new Error(`/models returned ${res.statusCode}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('/models request timed out'));
      });
      req.end();
    });
  }
}

/** Shape of the Copilot /models API response */
interface CopilotModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    capabilities?: {
      family?: string;
      type?: string;
      limits?: {
        max_context_window_tokens?: number;
        max_output_tokens?: number;
        max_prompt_tokens?: number;
      };
      supports?: {
        tool_calls?: boolean;
        streaming?: boolean;
        vision?: boolean;
        structured_outputs?: boolean;
        parallel_tool_calls?: boolean;
        reasoning_effort?: string[];
        adaptive_thinking?: boolean;
      };
    };
  }>;
}
