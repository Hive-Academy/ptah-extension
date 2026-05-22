/**
 * OpenRouter Pricing Service
 *
 * Single source of truth for per-token pricing across every model Ptah
 * surfaces in the stats panel — regardless of which provider the user
 * actually authed against (Anthropic direct, GitHub Copilot, Codex bridge,
 * Z.AI / Moonshot, Ollama Cloud, OpenRouter, …).
 *
 * Why OpenRouter as the catalog source:
 *   - Lists the same models that every Anthropic-compatible proxy serves
 *     (Anthropic, OpenAI, Google, Meta, Moonshot, Zhipu, DeepSeek, Qwen, …).
 *   - Public `/api/v1/models` endpoint — no auth required.
 *   - Per-token prices published as USD strings, refreshed by OpenRouter.
 *   - Cache-friendly: ~300 models in a single response.
 *
 * The "retail" price shown to a user on a free subscription (Copilot, Ollama
 * local, …) is not their actual bill — it's a "what would this cost on the
 * open market" signal. That's intentional: it lets users understand the value
 * of the subscription they're on.
 *
 * @see https://openrouter.ai/api/v1/models
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  registerProviderPricing,
  type ModelPricing,
} from '@ptah-extension/shared';

/** OpenRouter public model catalog endpoint (no auth required). */
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** In-memory cache TTL for the catalog (ms). */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Network timeout for catalog fetch (ms). */
const REQUEST_TIMEOUT_MS = 10_000;

/** Max chars of a failed response body we include in warn logs. */
const ERROR_BODY_SNIPPET_LEN = 200;

/**
 * OpenRouter `/api/v1/models` entry. Prices are USD-per-token strings
 * (e.g., `"0.0000015"` = $1.50 per 1M tokens). Parse with `parseFloat`.
 */
export interface OpenRouterModel {
  readonly id: string;
  readonly name?: string;
  readonly context_length?: number;
  readonly pricing?: {
    readonly prompt?: string;
    readonly completion?: string;
    readonly request?: string;
    readonly image?: string;
    readonly input_cache_read?: string;
    readonly input_cache_write?: string;
  };
}

interface OpenRouterResponse {
  data?: OpenRouterModel[];
}

interface CacheEntry<T> {
  readonly value: T;
  readonly fetchedAt: number;
}

@injectable()
export class OpenRouterPricingService {
  private catalogCache: CacheEntry<OpenRouterModel[]> | null = null;
  private warmupPromise: Promise<OpenRouterModel[]> | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Fire-and-forget bootstrap. Called once at app startup from
   * registerAuthProvidersServices. Resolves silently on failure — pricing
   * just remains unavailable until a manual refresh or the next process.
   */
  warmup(): void {
    if (this.warmupPromise) return;
    this.warmupPromise = this.fetchAndRegister().catch((err) => {
      this.logger.warn(
        `[OpenRouterPricing] Warmup failed — costs will read as "unknown" until next refresh. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    });
  }

  /**
   * Fetch the catalog and register every entry into the shared pricing map.
   * Returns the parsed catalog so callers (Ollama Cloud matcher) can reuse it
   * for their own slug-matching without re-hitting the network.
   *
   * Each model is registered under multiple keys so {@link findModelPricing}
   * exact-matches whatever the runtime reports:
   *   - Full OpenRouter ID:  `anthropic/claude-sonnet-4.6`
   *   - Tail after slash:    `claude-sonnet-4.6`
   *
   * `registerProviderPricing` already adds lowercase variants automatically.
   */
  async fetchAndRegister(): Promise<OpenRouterModel[]> {
    const catalog = await this.fetchCatalog();
    if (catalog.length === 0) return [];

    const entries: Record<string, ModelPricing> = {};
    let registered = 0;
    let skipped = 0;

    for (const m of catalog) {
      const pricing = parseModelPricing(m);
      if (!pricing) {
        skipped++;
        continue;
      }
      entries[m.id] = pricing;
      const slash = m.id.lastIndexOf('/');
      if (slash >= 0 && slash < m.id.length - 1) {
        const tail = m.id.slice(slash + 1);
        if (!entries[tail]) {
          entries[tail] = pricing;
        }
      }
      registered++;
    }

    registerProviderPricing(entries);
    this.logger.info(
      `[OpenRouterPricing] Registered ${registered} model(s) from OpenRouter ` +
        `(${Object.keys(entries).length} key variants; ${skipped} entries skipped for missing/unparseable prices).`,
    );
    return catalog;
  }

  /**
   * Return the cached catalog or refetch if stale. Used by callers that need
   * the raw catalog (e.g., Ollama Cloud's slug-matching for `:cloud` tags).
   */
  async getCatalog(): Promise<OpenRouterModel[]> {
    return this.fetchCatalog();
  }

  /** Drop the cache. The next `getCatalog()` / `fetchAndRegister()` refetches. */
  clearCache(): void {
    this.catalogCache = null;
    this.warmupPromise = null;
  }

  private async fetchCatalog(): Promise<OpenRouterModel[]> {
    if (this.catalogCache && this.isFresh(this.catalogCache)) {
      return this.catalogCache.value;
    }
    this.logger.info(
      `[OpenRouterPricing] Fetching catalog: GET ${OPENROUTER_MODELS_URL}`,
    );
    try {
      const data = await this.httpJson<OpenRouterResponse>(
        OPENROUTER_MODELS_URL,
      );
      const raw = Array.isArray(data?.data) ? data.data : null;
      if (!raw) {
        this.logger.warn(
          `[OpenRouterPricing] ${OPENROUTER_MODELS_URL} response missing "data" array. ` +
            `Got keys: [${data ? Object.keys(data).join(', ') : 'null'}]. Pricing will be unavailable.`,
        );
        this.catalogCache = { value: [], fetchedAt: Date.now() };
        return [];
      }
      const models: OpenRouterModel[] = [];
      for (const m of raw) {
        if (m && typeof m.id === 'string' && m.id.length > 0) {
          models.push(m);
        }
      }
      this.catalogCache = { value: models, fetchedAt: Date.now() };
      this.logger.info(
        `[OpenRouterPricing] Cached ${models.length} model entries.`,
      );
      return models;
    } catch (error) {
      this.logger.warn(
        `[OpenRouterPricing] ${OPENROUTER_MODELS_URL} fetch failed — pricing will be unavailable. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.catalogCache = { value: [], fetchedAt: Date.now() };
      return [];
    }
  }

  private isFresh<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }

  private async httpJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ptah-extension',
        },
        signal: controller.signal,
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        const snippet = truncate(text);
        throw new Error(
          `HTTP ${res.status} ${res.statusText} from ${url}` +
            (snippet ? ` — body: ${snippet}` : ''),
        );
      }
      if (!text) {
        throw new Error(`Empty body from ${url} (HTTP ${res.status})`);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(
          `Non-JSON body from ${url} (HTTP ${res.status}) — first ${ERROR_BODY_SNIPPET_LEN} chars: ${truncate(text)}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Parse an OpenRouter catalog entry into ModelPricing. Returns null when the
 * required prompt/completion prices are missing or unparseable — callers
 * should skip the entry rather than register a zero/fake price.
 */
function parseModelPricing(m: OpenRouterModel): ModelPricing | null {
  const promptStr = m.pricing?.prompt;
  const completionStr = m.pricing?.completion;
  const inputCostPerToken =
    typeof promptStr === 'string' ? parseFloat(promptStr) : NaN;
  const outputCostPerToken =
    typeof completionStr === 'string' ? parseFloat(completionStr) : NaN;
  if (
    !Number.isFinite(inputCostPerToken) ||
    !Number.isFinite(outputCostPerToken)
  ) {
    return null;
  }
  const cacheReadStr = m.pricing?.input_cache_read;
  const cacheReadParsed =
    typeof cacheReadStr === 'string' ? parseFloat(cacheReadStr) : NaN;
  const cacheReadCostPerToken = Number.isFinite(cacheReadParsed)
    ? cacheReadParsed
    : undefined;
  const cacheWriteStr = m.pricing?.input_cache_write;
  const cacheWriteParsed =
    typeof cacheWriteStr === 'string' ? parseFloat(cacheWriteStr) : NaN;
  const cacheCreationCostPerToken = Number.isFinite(cacheWriteParsed)
    ? cacheWriteParsed
    : undefined;

  const pricing: ModelPricing = {
    inputCostPerToken,
    outputCostPerToken,
    ...(cacheReadCostPerToken !== undefined ? { cacheReadCostPerToken } : {}),
    ...(cacheCreationCostPerToken !== undefined
      ? { cacheCreationCostPerToken }
      : {}),
    ...(typeof m.context_length === 'number' && m.context_length > 0
      ? { maxTokens: m.context_length }
      : {}),
    provider: 'openrouter',
  };
  return pricing;
}

function truncate(s: string): string {
  if (!s) return '';
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > ERROR_BODY_SNIPPET_LEN
    ? `${trimmed.slice(0, ERROR_BODY_SNIPPET_LEN)}…`
    : trimmed;
}
