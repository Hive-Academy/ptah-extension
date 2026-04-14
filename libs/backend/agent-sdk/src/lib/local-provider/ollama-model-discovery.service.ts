/**
 * Ollama Model Discovery Service - TASK_2025_281
 *
 * Fetches models from Ollama's native /api/tags endpoint and enriches
 * metadata from /api/show for each model (context length, capabilities).
 *
 * Key differences from the old listModels() in LocalModelTranslationProxy:
 * - Uses /api/tags (native) instead of /v1/models (OpenAI compat)
 * - Fetches real context lengths from /api/show per model
 * - Infers tool use and thinking capabilities from model metadata
 * - Separates local vs cloud models (`:cloud` suffix detection)
 * - Caches /api/show results with TTL to avoid repeated calls
 */

import * as http from 'http';
import * as https from 'https';
import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import { getAnthropicProvider } from '../helpers/anthropic-provider-registry';

/** Ollama /api/version response shape */
interface OllamaVersionResponse {
  version: string; // e.g., "0.14.2"
}

/** Minimum Ollama version required for Anthropic Messages API (/v1/messages) */
const MIN_OLLAMA_VERSION = '0.14.0';

/** Ollama /api/tags response shape */
interface OllamaTagsResponse {
  models: OllamaModelTag[];
}

interface OllamaModelTag {
  name: string; // e.g., "llama3.3:latest", "kimi-k2.5:cloud"
  model: string; // e.g., "llama3.3:latest"
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

/** Ollama /api/show response shape (subset of fields we need) */
interface OllamaShowResponse {
  modelinfo?: Record<string, unknown>;
  template?: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
  };
}

/** Cached model metadata from /api/show */
interface ModelMetadataCache {
  contextLength: number;
  supportsToolUse: boolean;
  supportsThinking: boolean;
  supportsVision: boolean;
  timestamp: number;
  /** True if this was a fallback/error response — uses shorter TTL */
  isFallback?: boolean;
}

/** Known model families that support tool use */
const TOOL_USE_FAMILIES = new Set([
  'llama',
  'qwen2',
  'qwen3',
  'gemma2',
  'gemma3',
  'command-r',
  'mistral',
  'devstral',
  'phi3',
  'phi4',
]);

/** Cloud model capability metadata */
interface CloudModelMeta {
  contextLength: number;
  supportsToolUse: boolean;
  supportsThinking: boolean;
  supportsVision: boolean;
  /** Human-readable description for the model selector */
  description?: string;
}

/**
 * Comprehensive catalog of known Ollama Cloud models.
 * Source: https://ollama.com/search?c=cloud (last updated 2026-04-14)
 *
 * Ollama has NO API to list available cloud models — /api/tags only returns
 * locally pulled models. This static catalog is the primary source for the
 * model selector. It's merged with /api/tags results to pick up any models
 * the user has run that aren't in this list.
 *
 * Key is the base model name (without `:cloud` suffix).
 */
const KNOWN_CLOUD_MODELS: Record<string, CloudModelMeta> = {
  // --- Flagship / Large ---
  'kimi-k2.5': {
    contextLength: 256000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: true,
    description: '256K context \u2022 vision, tools, thinking',
  },
  'deepseek-v3.2': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '128K context \u2022 tools, thinking',
  },
  'devstral-2': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: false,
    description: '123B \u2022 128K context \u2022 tools',
  },
  'cogito-2.1': {
    contextLength: 128000,
    supportsToolUse: false,
    supportsThinking: false,
    supportsVision: false,
    description: '671B \u2022 128K context',
  },
  'nemotron-3-super': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '120B \u2022 128K context \u2022 tools, thinking',
  },
  'qwen3-next': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '80B \u2022 128K context \u2022 tools, thinking',
  },

  // --- Mid-size ---
  'glm-5.1': {
    contextLength: 200000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '200K context \u2022 tools, thinking',
  },
  'glm-5': {
    contextLength: 200000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '200K context \u2022 tools, thinking',
  },
  'glm-4.7': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '128K context \u2022 tools, thinking',
  },
  'minimax-m2.7': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '128K context \u2022 tools, thinking',
  },
  'minimax-m2.5': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '128K context \u2022 tools, thinking',
  },
  'minimax-m2': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '128K context \u2022 tools, thinking',
  },
  gemma4: {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: true,
    description:
      '26B/31B \u2022 128K context \u2022 vision, tools, thinking, audio',
  },
  'qwen3.5': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: true,
    description:
      'Up to 122B \u2022 128K context \u2022 vision, tools, thinking',
  },
  'qwen3-coder-next': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: false,
    description: '128K context \u2022 tools',
  },
  'gemini-3-flash-preview': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: true,
    description: '128K context \u2022 vision, tools, thinking',
  },

  // --- Small / Efficient ---
  'devstral-small-2': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: true,
    description: '24B \u2022 128K context \u2022 vision, tools',
  },
  'ministral-3': {
    contextLength: 128000,
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: true,
    description: '3B/8B/14B \u2022 128K context \u2022 vision, tools',
  },
  'nemotron-3-nano': {
    contextLength: 8192,
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    description: '4B/30B \u2022 8K context \u2022 tools, thinking',
  },
  'rnj-1': {
    contextLength: 32000,
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: false,
    description: '8B \u2022 32K context \u2022 tools',
  },
};

@injectable()
export class OllamaModelDiscoveryService {
  /** Cache for /api/show metadata per model */
  private readonly metadataCache = new Map<string, ModelMetadataCache>();
  private readonly METADATA_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly FALLBACK_CACHE_TTL_MS = 60 * 1000; // 1 minute for error fallbacks
  private readonly MAX_CONCURRENT_ENRICHMENTS = 5;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
  ) {}

  /**
   * Get the Ollama server base URL.
   * Checks for user-configured custom URL first, falls back to provider entry default.
   * Shared by both ollama and ollama-cloud providers.
   */
  private getBaseUrl(providerId: string): string {
    const customUrl = this.configManager.get<string>(
      `provider.${providerId}.baseUrl`,
    );
    if (customUrl?.trim()) {
      return customUrl.trim().replace(/\/+$/, '');
    }

    const provider = getAnthropicProvider(providerId);
    if (!provider?.baseUrl) {
      return 'http://localhost:11434';
    }
    return provider.baseUrl.replace(/\/+$/, '');
  }

  /**
   * Check if the Ollama server version supports the Anthropic Messages API.
   * Ollama v0.14.0+ is required for /v1/messages.
   *
   * @returns Object with version info and whether it meets the minimum requirement.
   * @throws If the server is not reachable.
   */
  async checkVersion(
    providerId = 'ollama',
  ): Promise<{ version: string; supported: boolean }> {
    const baseUrl = this.getBaseUrl(providerId);
    const response = await this.httpGet<OllamaVersionResponse>(
      `${baseUrl}/api/version`,
    );
    const version = response.version;
    const supported = this.isVersionAtLeast(version, MIN_OLLAMA_VERSION);

    this.logger.debug(`[OllamaModelDiscovery] Version check`, {
      version,
      minRequired: MIN_OLLAMA_VERSION,
      supported,
    });

    return { version, supported };
  }

  /**
   * Compare semver strings: is `actual` >= `minimum`?
   */
  private isVersionAtLeast(actual: string, minimum: string): boolean {
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const a = parse(actual);
    const m = parse(minimum);
    for (let i = 0; i < Math.max(a.length, m.length); i++) {
      const av = a[i] ?? 0;
      const mv = m[i] ?? 0;
      if (av > mv) return true;
      if (av < mv) return false;
    }
    return true; // equal
  }

  /**
   * Fetch models for the 'ollama' (local) provider.
   * Returns only non-cloud models.
   */
  async listLocalModels(): Promise<ProviderModelInfo[]> {
    return this.listModels('ollama', (name) => !name.endsWith(':cloud'));
  }

  /**
   * Fetch models for the 'ollama-cloud' provider.
   *
   * Ollama has no API to list available cloud models — /api/tags only returns
   * locally pulled/used models. We use the static KNOWN_CLOUD_MODELS catalog
   * as the primary source, then merge any additional :cloud models from /api/tags
   * that aren't in our catalog (e.g., newly released models the user has tried).
   */
  async listCloudModels(): Promise<ProviderModelInfo[]> {
    // Step 1: Build the base list from the static catalog
    const staticModels: ProviderModelInfo[] = Object.entries(
      KNOWN_CLOUD_MODELS,
    ).map(([baseName, meta]) => ({
      id: `${baseName}:cloud`,
      name: this.formatModelName(`${baseName}:cloud`),
      description: meta.description ?? this.buildCloudDescription(meta),
      contextLength: meta.contextLength,
      supportsToolUse: meta.supportsToolUse,
    }));

    // Step 2: Try to fetch dynamic models from /api/tags and merge any extras
    try {
      const dynamicModels = await this.listModels('ollama-cloud', (name) =>
        name.endsWith(':cloud'),
      );

      // Merge: add any dynamic models not already in the static catalog
      const staticIds = new Set(staticModels.map((m) => m.id));
      const extras = dynamicModels.filter((m) => !staticIds.has(m.id));

      if (extras.length > 0) {
        this.logger.debug(
          `[OllamaModelDiscovery] Found ${extras.length} additional cloud models from /api/tags`,
          { extras: extras.map((m) => m.id) },
        );
      }

      return [...staticModels, ...extras];
    } catch {
      // /api/tags failed — return static catalog only (still useful)
      this.logger.debug(
        `[OllamaModelDiscovery] /api/tags unavailable, returning ${staticModels.length} known cloud models`,
      );
      return staticModels;
    }
  }

  /**
   * Build description string from CloudModelMeta (fallback when no explicit description).
   */
  private buildCloudDescription(meta: CloudModelMeta): string {
    const parts: string[] = [];
    if (meta.contextLength >= 1000) {
      parts.push(`${Math.round(meta.contextLength / 1000)}K context`);
    }
    const caps: string[] = [];
    if (meta.supportsToolUse) caps.push('tools');
    if (meta.supportsVision) caps.push('vision');
    if (meta.supportsThinking) caps.push('thinking');
    if (caps.length > 0) parts.push(caps.join(', '));
    return parts.join(' \u2022 ');
  }

  /**
   * Core model listing logic.
   * Fetches from /api/tags and enriches with /api/show metadata.
   */
  private async listModels(
    providerId: string,
    filter: (name: string) => boolean,
  ): Promise<ProviderModelInfo[]> {
    const baseUrl = this.getBaseUrl(providerId);

    try {
      // Step 1: Fetch all models from /api/tags
      const tagsResponse = await this.httpGet<OllamaTagsResponse>(
        `${baseUrl}/api/tags`,
      );

      if (!tagsResponse?.models?.length) {
        this.logger.debug(
          `[OllamaModelDiscovery] No models returned from /api/tags`,
        );
        return [];
      }

      // Step 2: Filter by local/cloud
      const filtered = tagsResponse.models.filter((m) => filter(m.name));

      // Step 3: Enrich each model with /api/show metadata (batched to avoid flooding)
      const enriched: ProviderModelInfo[] = [];
      for (
        let i = 0;
        i < filtered.length;
        i += this.MAX_CONCURRENT_ENRICHMENTS
      ) {
        const batch = filtered.slice(i, i + this.MAX_CONCURRENT_ENRICHMENTS);
        const results = await Promise.all(
          batch.map(async (model) => this.enrichModel(baseUrl, model)),
        );
        enriched.push(...results);
      }

      this.logger.debug(
        `[OllamaModelDiscovery] Discovered ${enriched.length} models for ${providerId}`,
        { total: tagsResponse.models.length, filtered: enriched.length },
      );

      return enriched;
    } catch (error) {
      this.logger.warn(
        `[OllamaModelDiscovery] Failed to list models: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * Enrich a single model with metadata from /api/show.
   * Uses cached results when available.
   */
  private async enrichModel(
    baseUrl: string,
    model: OllamaModelTag,
  ): Promise<ProviderModelInfo> {
    const metadata = await this.getModelMetadata(baseUrl, model.name);

    return {
      id: model.name,
      name: this.formatModelName(model.name),
      description: this.buildDescription(model, metadata),
      contextLength: metadata.contextLength,
      supportsToolUse: metadata.supportsToolUse,
    };
  }

  /**
   * Get metadata for a model, from cache or /api/show.
   */
  private async getModelMetadata(
    baseUrl: string,
    modelName: string,
  ): Promise<ModelMetadataCache> {
    // Check cache (error fallbacks use shorter TTL)
    const cached = this.metadataCache.get(modelName);
    if (cached) {
      const ttl = cached.isFallback
        ? this.FALLBACK_CACHE_TTL_MS
        : this.METADATA_CACHE_TTL_MS;
      if (Date.now() - cached.timestamp < ttl) {
        return cached;
      }
    }

    // For cloud models, use known catalog (saves HTTP round-trip)
    if (modelName.endsWith(':cloud')) {
      const baseName = modelName.replace(/:cloud$/, '');
      const known = KNOWN_CLOUD_MODELS[baseName];
      if (known) {
        const metadata: ModelMetadataCache = {
          contextLength: known.contextLength,
          supportsToolUse: known.supportsToolUse,
          supportsThinking: known.supportsThinking,
          supportsVision: known.supportsVision,
          timestamp: Date.now(),
        };
        this.metadataCache.set(modelName, metadata);
        return metadata;
      }
    }

    // Fetch from /api/show
    try {
      const showResponse = await this.httpPost<OllamaShowResponse>(
        `${baseUrl}/api/show`,
        { model: modelName },
      );

      const metadata = this.parseShowResponse(showResponse, modelName);
      this.metadataCache.set(modelName, metadata);
      return metadata;
    } catch {
      // Fallback: conservative defaults with shorter cache TTL
      const fallback: ModelMetadataCache = {
        contextLength: 8192,
        supportsToolUse: this.inferToolUseFromFamily(modelName),
        supportsThinking: false,
        supportsVision: false,
        timestamp: Date.now(),
        isFallback: true,
      };
      this.metadataCache.set(modelName, fallback);
      return fallback;
    }
  }

  /**
   * Parse /api/show response to extract model capabilities.
   */
  private parseShowResponse(
    response: OllamaShowResponse,
    modelName: string,
  ): ModelMetadataCache {
    const modelinfo = response.modelinfo ?? {};

    // Context length: look for general.context_length in modelinfo
    const contextLength =
      (modelinfo['general.context_length'] as number) ??
      (modelinfo['llama.context_length'] as number) ??
      8192;

    // Tool use: infer from template or family
    const template = response.template ?? '';
    const families = response.details?.families ?? [];
    const supportsToolUse =
      template.includes('tool') ||
      template.includes('function') ||
      families.some((f) => TOOL_USE_FAMILIES.has(f)) ||
      this.inferToolUseFromFamily(modelName);

    // Vision: infer from families
    const supportsVision =
      families.includes('clip') || families.includes('mllama');

    // Thinking: infer from model name or template
    const supportsThinking =
      modelName.includes('thinking') ||
      template.includes('thinking') ||
      template.includes('<think>');

    return {
      contextLength,
      supportsToolUse,
      supportsThinking,
      supportsVision,
      timestamp: Date.now(),
    };
  }

  /**
   * Infer tool use support from model name as a last-resort fallback.
   */
  private inferToolUseFromFamily(modelName: string): boolean {
    const lower = modelName.toLowerCase().split(':')[0]; // base name only
    return Array.from(TOOL_USE_FAMILIES).some(
      (family) => lower === family || lower.startsWith(`${family}-`),
    );
  }

  /**
   * Convert model name to display name.
   * "llama3.3:latest" -> "Llama3.3"
   * "kimi-k2.5:cloud" -> "Kimi K2.5 (Cloud)"
   */
  private formatModelName(name: string): string {
    const isCloud = name.endsWith(':cloud');
    const baseName = name.replace(/:latest$/, '').replace(/:cloud$/, '');
    const display = baseName
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return isCloud ? `${display} (Cloud)` : display;
  }

  /**
   * Build a short description from model metadata.
   */
  private buildDescription(
    model: OllamaModelTag,
    metadata: ModelMetadataCache,
  ): string {
    const parts: string[] = [];

    // Parameter size from tags response
    if (model.details?.parameter_size) {
      parts.push(model.details.parameter_size);
    }

    // Context length
    if (metadata.contextLength >= 1000) {
      parts.push(`${Math.round(metadata.contextLength / 1000)}K context`);
    }

    // Capabilities
    const caps: string[] = [];
    if (metadata.supportsToolUse) caps.push('tools');
    if (metadata.supportsVision) caps.push('vision');
    if (metadata.supportsThinking) caps.push('thinking');
    if (caps.length > 0) parts.push(caps.join(', '));

    return parts.join(' \u2022 ');
  }

  /**
   * Clear all cached metadata.
   */
  clearCache(): void {
    this.metadataCache.clear();
  }

  // -----------------------------------------------------------------------
  // HTTP helpers (lightweight, no axios dependency)
  // -----------------------------------------------------------------------

  private httpGet<T>(url: string): Promise<T> {
    return this.httpRequest<T>(url, 'GET');
  }

  private httpPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return this.httpRequest<T>(url, 'POST', JSON.stringify(body));
  }

  private httpRequest<T>(
    url: string,
    method: string,
    body?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const requestFn =
        parsedUrl.protocol === 'https:' ? https.request : http.request;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body).toString();
      }

      const req = requestFn(
        parsedUrl,
        { method, headers, timeout: 5000 },
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
                reject(new Error(`Invalid JSON response from ${url}`));
              }
            } else {
              reject(new Error(`${url} returned ${res.statusCode}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`${url} request timed out`));
      });
      if (body) req.write(body);
      req.end();
    });
  }
}
