import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { IPricingProvider } from '@ptah-extension/agent-sdk';
import {
  registerProviderPricing,
  type ModelPricing,
} from '@ptah-extension/shared';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const CACHE_TTL_MS = 5 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 10_000;

const ERROR_BODY_SNIPPET_LEN = 200;

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

interface Catalog {
  readonly models: OpenRouterModel[];
  readonly pricingByKey: Map<string, ModelPricing>;
}

@injectable()
export class OpenRouterPricingService implements IPricingProvider {
  private cache: Catalog | null = null;
  private cacheTime = 0;
  private pending: Promise<Catalog> | null = null;
  private warmupPromise: Promise<OpenRouterModel[]> | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async getPricing(modelId: string): Promise<ModelPricing | null> {
    if (typeof modelId !== 'string' || modelId.length === 0) return null;
    const catalog = await this.ensureCatalog();
    const map = catalog.pricingByKey;
    const direct = map.get(modelId);
    if (direct) return direct;
    const lower = map.get(modelId.toLowerCase());
    if (lower) return lower;
    const stripped = this.stripPrefix(modelId);
    if (stripped !== modelId) {
      const strippedHit = map.get(stripped) ?? map.get(stripped.toLowerCase());
      if (strippedHit) return strippedHit;
    }
    return null;
  }

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

  async fetchAndRegister(): Promise<OpenRouterModel[]> {
    const catalog = await this.ensureCatalog();
    if (catalog.models.length === 0) return [];

    const entries: Record<string, ModelPricing> = {};
    let registered = 0;

    for (const m of catalog.models) {
      const pricing = catalog.pricingByKey.get(m.id);
      if (!pricing) continue;
      entries[m.id] = pricing;
      const tail = this.stripPrefix(m.id);
      if (tail !== m.id && !entries[tail]) {
        entries[tail] = pricing;
      }
      registered++;
    }

    registerProviderPricing(entries);
    this.logger.info(
      `[OpenRouterPricing] Registered ${registered} model(s) from OpenRouter ` +
        `(${Object.keys(entries).length} key variants).`,
    );
    return catalog.models;
  }

  async getCatalog(): Promise<OpenRouterModel[]> {
    const catalog = await this.ensureCatalog();
    return catalog.models;
  }

  clearCache(): void {
    this.cache = null;
    this.cacheTime = 0;
    this.pending = null;
    this.warmupPromise = null;
  }

  private async ensureCatalog(): Promise<Catalog> {
    if (this.cache && Date.now() - this.cacheTime < CACHE_TTL_MS) {
      return this.cache;
    }
    if (this.pending) return this.pending;
    this.pending = this.fetchCatalog()
      .then((catalog) => {
        this.cache = catalog;
        this.cacheTime = Date.now();
        return catalog;
      })
      .catch(() => emptyCatalog())
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async fetchCatalog(): Promise<Catalog> {
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
          `[OpenRouterPricing] ${OPENROUTER_MODELS_URL} response missing "data" array.`,
        );
        return emptyCatalog();
      }
      const models: OpenRouterModel[] = [];
      const pricingByKey = new Map<string, ModelPricing>();
      for (const m of raw) {
        if (!m || typeof m.id !== 'string' || m.id.length === 0) continue;
        models.push(m);
        const pricing = parseModelPricing(m);
        if (!pricing) continue;
        pricingByKey.set(m.id, pricing);
        const lower = m.id.toLowerCase();
        if (!pricingByKey.has(lower)) pricingByKey.set(lower, pricing);
        const tail = stripPrefix(m.id);
        if (tail !== m.id) {
          if (!pricingByKey.has(tail)) pricingByKey.set(tail, pricing);
          const tailLower = tail.toLowerCase();
          if (!pricingByKey.has(tailLower)) {
            pricingByKey.set(tailLower, pricing);
          }
        }
      }
      this.logger.info(
        `[OpenRouterPricing] Cached ${models.length} model entries, ${pricingByKey.size} pricing key variants.`,
      );
      return { models, pricingByKey };
    } catch (error) {
      this.logger.warn(
        `[OpenRouterPricing] ${OPENROUTER_MODELS_URL} fetch failed — pricing will be unavailable. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  private stripPrefix(id: string): string {
    return stripPrefix(id);
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

function emptyCatalog(): Catalog {
  return { models: [], pricingByKey: new Map() };
}

function stripPrefix(id: string): string {
  const slash = id.lastIndexOf('/');
  if (slash >= 0 && slash < id.length - 1) {
    return id.slice(slash + 1);
  }
  return id;
}

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
