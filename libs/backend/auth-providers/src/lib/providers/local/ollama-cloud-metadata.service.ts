/**
 * Ollama Cloud Metadata Service
 *
 * When the user configures an OPTIONAL ollama.com API key (stored in
 * VS Code SecretStorage under `ptah.auth.provider.ollama-cloud` via
 * IAuthSecretsService — the same slot the auth UI writes to through
 * `auth:saveSettings`), this service:
 *
 *   1. Fetches `https://ollama.com/api/tags` with `Authorization: Bearer <key>`.
 *      This endpoint mirrors the local /api/tags shape and is the ONLY public
 *      list-models endpoint exposed by ollama.com. It returns the models the
 *      authenticated user has access to / has pulled — NOT the full public
 *      cloud catalog. The OllamaModelDiscoveryService uses this to add any
 *      cloud tags the user has touched on top of the static KNOWN_CLOUD_MODELS
 *      catalog.
 *
 *   2. Pricing fetch: sourced from OpenRouter's public model catalog
 *      (`https://openrouter.ai/api/v1/models`, no auth required). Ollama does
 *      not publish a pricing endpoint, but OpenRouter hosts the same
 *      open-source models (kimi, deepseek, glm, qwen, gpt-oss, …) and exposes
 *      per-token prices as strings of USD-per-token. We match Ollama tag IDs
 *      to OpenRouter model IDs via a multi-stage normalize/slug/prefix/family
 *      strategy and call `registerProviderPricing()` so the stats panel shows
 *      realistic cost figures. Unmatched Ollama tags are registered at $0
 *      (better than falling through to the $3/$15 default). Pricing is
 *      ESTIMATED — actual Ollama Cloud pricing may differ. See:
 *        https://openrouter.ai/api/v1/models
 *        https://ollama.com/pricing
 *
 * Cloud-tag suffix detection — important: ollama.com uses TWO conventions:
 *   - `:cloud`           e.g., `kimi-k2.6:cloud`, `kimi-k2.5:cloud`, `glm-5:cloud`
 *   - tag ending `-cloud` e.g., `gpt-oss:120b-cloud`, `qwen3-coder:480b-cloud`
 * We accept both via `isCloudTag()`.
 *
 * Tags + OpenRouter responses are cached in-memory with a 1-hour TTL. The
 * service is resilient: network errors NEVER throw to callers — they degrade
 * to `[]` and log a warning with the HTTP status + body snippet so failures
 * are visible in the output channel. Inference is unaffected because it
 * always proxies through local Ollama at localhost:11434; the API key is
 * metadata-only.
 *
 * @see https://docs.ollama.com/cloud
 * @see https://docs.ollama.com/api/authentication
 * @see https://docs.ollama.com/api/tags
 * @see https://openrouter.ai/api/v1/models
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  registerProviderPricing,
  type ModelPricing,
} from '@ptah-extension/shared';

/** TTL for cached tags response (ms) */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Network timeout for ollama.com requests (ms) */
const REQUEST_TIMEOUT_MS = 10_000;

/** Base host for the public ollama.com REST API */
const OLLAMA_CLOUD_API_BASE = 'https://ollama.com';

/** OpenRouter public model catalog endpoint (no auth). */
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Max chars of a failed response body we include in warn logs (avoid log flooding). */
const ERROR_BODY_SNIPPET_LEN = 200;

/** Default context window for cloud models we can't look up. */
const DEFAULT_CLOUD_CONTEXT = 128_000;

/**
 * `https://ollama.com/api/tags` response shape — mirrors the local daemon's
 * /api/tags. We only need `models[].name` (and optionally `models[].model`).
 * Other fields (size, digest, modified_at, details) are present but ignored.
 *
 * @see https://docs.ollama.com/api/tags
 */
interface OllamaCloudTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

/** Parsed cloud tag — fully validated, name guaranteed non-empty */
export interface OllamaCloudTag {
  /**
   * Full model id including cloud suffix. Suffix is one of:
   *   - `:cloud`                e.g., `kimi-k2.6:cloud`
   *   - tag ending in `-cloud`  e.g., `gpt-oss:120b-cloud`
   */
  readonly id: string;
}

/**
 * OpenRouter `/api/v1/models` entry. Prices are USD-per-token strings
 * (e.g., `"0.0000015"` = $1.50 per 1M tokens). Parse with `parseFloat`.
 * Undocumented optional fields are modeled as optional. See:
 *   https://openrouter.ai/api/v1/models
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

/**
 * Returns true when the given Ollama model id refers to a cloud-hosted model.
 * Accepts both ollama.com tag conventions:
 *   `kimi-k2.6:cloud`        (tag === 'cloud')
 *   `gpt-oss:120b-cloud`     (tag ends with '-cloud')
 */
export function isCloudTag(name: string): boolean {
  if (!name) return false;
  if (name.endsWith(':cloud')) return true;
  // Match `<base>:<...>-cloud` — `-cloud` must be in the tag portion (after ':')
  const colonIdx = name.indexOf(':');
  if (colonIdx < 0) return false;
  const tag = name.slice(colonIdx + 1);
  return tag.endsWith('-cloud');
}

/**
 * Strip `:cloud`/`-cloud` suffixes, lowercase, and remove dots so we can
 * match against OpenRouter's slug tails. Examples:
 *   `kimi-k2.5:cloud`       -> `kimi-k25`
 *   `deepseek-v3.2:cloud`   -> `deepseek-v32`
 *   `gpt-oss:120b-cloud`    -> `gpt-oss-120b`
 *   `qwen3-coder:480b-cloud`-> `qwen3-coder-480b`
 */
function normalizeOllamaId(ollamaId: string): string {
  let s = ollamaId.toLowerCase().trim();
  // Remove :cloud
  if (s.endsWith(':cloud')) s = s.slice(0, -':cloud'.length);
  // Remove trailing -cloud in any tag portion
  const colonIdx = s.indexOf(':');
  if (colonIdx >= 0) {
    const base = s.slice(0, colonIdx);
    let tag = s.slice(colonIdx + 1);
    if (tag.endsWith('-cloud')) tag = tag.slice(0, -'-cloud'.length);
    // Collapse `<base>:<tag>` into `<base>-<tag>` so slug tails line up.
    s = tag.length > 0 ? `${base}-${tag}` : base;
  }
  // Remove dots
  s = s.replace(/\./g, '');
  return s;
}

/** Take the tail after the last `/`, lowercase, remove dots. */
function normalizeOpenRouterSlug(id: string): string {
  const slash = id.lastIndexOf('/');
  const tail = slash >= 0 ? id.slice(slash + 1) : id;
  return tail.toLowerCase().replace(/\./g, '');
}

/**
 * Extract a model family from a normalized Ollama id by trimming any trailing
 * version/size segment (e.g., `kimi-k25` -> `kimi-k2`, `deepseek-v32` ->
 * `deepseek-v3`, `qwen3-coder-480b` -> `qwen3-coder`).
 *
 * Heuristic: walk segments right-to-left and drop the last one if it looks
 * like a version/size token (contains digits). Keep at least one segment.
 */
function extractFamily(normalizedOllama: string): string {
  const parts = normalizedOllama.split('-').filter(Boolean);
  if (parts.length <= 1) return normalizedOllama;
  // Drop trailing size suffixes (120b, 480b, 70b, 8b, etc.) then drop a
  // trailing version token (v32, k25, m27, etc.) — both contain digits.
  while (parts.length > 1 && /\d/.test(parts[parts.length - 1])) {
    parts.pop();
  }
  // If we ate everything with digits (e.g. kimi-k25 -> kimi), try keeping the
  // version-ish token with its digits stripped so we still have a usable stem.
  if (parts.length === 0) return normalizedOllama;
  return parts.join('-');
}

@injectable()
export class OllamaCloudMetadataService {
  private tagsCache: CacheEntry<OllamaCloudTag[]> | null = null;
  private openRouterCache: CacheEntry<OpenRouterModel[]> | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Fetch live cloud model tags from `https://ollama.com/api/tags`. Cached
   * for 1 hour. Returns `[]` on any error (logged as a warning with HTTP
   * status + body snippet).
   *
   * NOTE: This endpoint returns models the AUTHENTICATED USER has access to
   * (typically what they have pulled or run via `ollama pull`/`ollama run`).
   * It is NOT the full public catalog at https://ollama.com/search?c=cloud.
   * Callers should treat the result as a supplement to a static catalog, not
   * as the canonical source of all cloud models.
   *
   * @param apiKey - ollama.com API key (sent as `Authorization: Bearer <key>`)
   */
  async fetchCloudTags(apiKey: string): Promise<OllamaCloudTag[]> {
    if (!apiKey?.trim()) {
      return [];
    }

    if (this.tagsCache && this.isFresh(this.tagsCache)) {
      this.logger.debug(
        `[OllamaCloudMetadata] Returning ${this.tagsCache.value.length} cached cloud tags (cache age: ${
          Date.now() - this.tagsCache.fetchedAt
        }ms)`,
      );
      return this.tagsCache.value;
    }

    const url = `${OLLAMA_CLOUD_API_BASE}/api/tags`;
    this.logger.info(
      `[OllamaCloudMetadata] Fetching cloud model catalog: GET ${url}`,
    );

    try {
      const data = await this.httpJson<OllamaCloudTagsResponse>(url, apiKey);

      const models = Array.isArray(data?.models) ? data.models : null;
      if (!models) {
        this.logger.warn(
          `[OllamaCloudMetadata] ${url} response missing top-level "models" array. ` +
            `Got keys: [${data ? Object.keys(data).join(', ') : 'null'}]. Falling back to static catalog.`,
        );
        this.tagsCache = { value: [], fetchedAt: Date.now() };
        return [];
      }

      const tags: OllamaCloudTag[] = [];
      let skippedNonCloud = 0;
      const allNames: string[] = [];

      for (const m of models) {
        const name =
          typeof m?.name === 'string' && m.name.length > 0
            ? m.name
            : typeof m?.model === 'string' && m.model.length > 0
              ? m.model
              : null;
        if (!name) continue;
        allNames.push(name);
        if (!isCloudTag(name)) {
          skippedNonCloud++;
          continue;
        }
        tags.push({ id: name });
      }

      this.tagsCache = { value: tags, fetchedAt: Date.now() };

      // Emit the FULL list of tag names so users can audit their Output
      // channel to verify exactly what ollama.com/api/tags returned — this is
      // the only way to tell whether the endpoint exposes the full cloud
      // catalog or just the user's pulled models for a given account.
      this.logger.info(
        `[OllamaCloudMetadata] ollama.com/api/tags returned ${models.length} model entries. ` +
          `Full tag list: [${allNames.join(', ')}]`,
      );

      if (tags.length === 0) {
        this.logger.warn(
          `[OllamaCloudMetadata] ${url} returned ${models.length} model(s) but ` +
            `0 matched the cloud-tag pattern (':cloud' or '-cloud' suffix). ` +
            `Skipped ${skippedNonCloud} non-cloud entries. ` +
            `The model picker will fall back to the bundled static catalog. ` +
            `Note: ollama.com/api/tags returns only models the signed-in user has pulled — ` +
            `it is NOT the full public cloud catalog.`,
        );
      } else {
        this.logger.info(
          `[OllamaCloudMetadata] Discovered ${tags.length} live cloud model tag(s) from ollama.com ` +
            `(${models.length} total returned, ${skippedNonCloud} non-cloud skipped). ` +
            `Cloud tags: [${tags.map((t) => t.id).join(', ')}]`,
        );
      }

      return tags;
    } catch (error) {
      // httpJson() formats the error with HTTP status + body snippet already.
      this.logger.warn(
        `[OllamaCloudMetadata] ${url} fetch failed — will fall back to bundled static catalog. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Cache the empty result briefly so we don't hammer the endpoint on
      // every subsequent listCloudModels() call within the TTL.
      this.tagsCache = { value: [], fetchedAt: Date.now() };
      return [];
    }
  }

  /**
   * Fetch the OpenRouter public model catalog. No auth required. Cached for
   * 1 hour. Returns `[]` on any failure (logged with HTTP status + body
   * snippet). Used as our pricing source-of-truth because OpenRouter lists
   * the same open-source models Ollama Cloud hosts, with per-token prices.
   */
  async fetchOpenRouterPricing(): Promise<OpenRouterModel[]> {
    if (this.openRouterCache && this.isFresh(this.openRouterCache)) {
      this.logger.debug(
        `[OllamaCloudMetadata] Returning ${this.openRouterCache.value.length} cached OpenRouter models (cache age: ${
          Date.now() - this.openRouterCache.fetchedAt
        }ms)`,
      );
      return this.openRouterCache.value;
    }

    this.logger.info(
      `[OllamaCloudMetadata] Fetching OpenRouter pricing catalog: GET ${OPENROUTER_MODELS_URL}`,
    );

    try {
      const data = await this.httpJson<OpenRouterResponse>(
        OPENROUTER_MODELS_URL,
        // No auth — explicitly pass null so we skip the Authorization header.
        null,
      );

      const raw = Array.isArray(data?.data) ? data.data : null;
      if (!raw) {
        this.logger.warn(
          `[OllamaCloudMetadata] ${OPENROUTER_MODELS_URL} response missing "data" array. ` +
            `Got keys: [${data ? Object.keys(data).join(', ') : 'null'}]. Skipping pricing overlay.`,
        );
        this.openRouterCache = { value: [], fetchedAt: Date.now() };
        return [];
      }

      // Defensive filter: keep only entries with a usable id string.
      const models: OpenRouterModel[] = [];
      for (const m of raw) {
        if (m && typeof m.id === 'string' && m.id.length > 0) {
          models.push(m);
        }
      }

      this.openRouterCache = { value: models, fetchedAt: Date.now() };
      this.logger.info(
        `[OllamaCloudMetadata] Cached ${models.length} OpenRouter model entries for pricing lookup.`,
      );
      return models;
    } catch (error) {
      this.logger.warn(
        `[OllamaCloudMetadata] ${OPENROUTER_MODELS_URL} fetch failed — cloud pricing will default to $0. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.openRouterCache = { value: [], fetchedAt: Date.now() };
      return [];
    }
  }

  /**
   * Pick the best OpenRouter entry for a given Ollama model id. Returns null
   * when no credible match can be found (caller registers $0 in that case —
   * better than falling through to the $3/$15 anthropic default).
   *
   * Match strategy (first hit wins):
   *   1. Exact slug match — normalized Ollama id equals an OpenRouter slug tail.
   *   2. Prefix match — find OpenRouter slugs whose tail starts with the
   *      normalized Ollama id; pick the lexicographically largest suffix
   *      (approximates "newest version").
   *   3. Family match — strip trailing size/version tokens from the Ollama id
   *      and find OpenRouter slugs in the same family; pick the lexicographically
   *      largest entry.
   *   4. No match — null.
   */
  private matchOllamaToOpenRouter(
    ollamaId: string,
    openRouterModels: OpenRouterModel[],
  ): OpenRouterModel | null {
    if (openRouterModels.length === 0) return null;
    const normalized = normalizeOllamaId(ollamaId);
    if (!normalized) return null;

    // Pre-compute slug tails once.
    const withSlug: Array<{ model: OpenRouterModel; slug: string }> =
      openRouterModels.map((m) => ({
        model: m,
        slug: normalizeOpenRouterSlug(m.id),
      }));

    // 1. Exact slug match
    const exact = withSlug.find((x) => x.slug === normalized);
    if (exact) return exact.model;

    // 2. Prefix match — pick the largest suffix lexicographically (likely
    //    corresponds to the newest dated/versioned revision).
    const prefixes = withSlug.filter((x) => x.slug.startsWith(normalized));
    if (prefixes.length > 0) {
      prefixes.sort((a, b) => b.slug.localeCompare(a.slug));
      return prefixes[0].model;
    }

    // 3. Family match
    const family = extractFamily(normalized);
    if (family && family !== normalized) {
      const fam = withSlug.filter((x) => x.slug.startsWith(family));
      if (fam.length > 0) {
        fam.sort((a, b) => b.slug.localeCompare(a.slug));
        return fam[0].model;
      }
    }

    return null;
  }

  /**
   * Build a pricing map for the given Ollama cloud tags using OpenRouter as
   * the source-of-truth, register it via `registerProviderPricing()`, and log
   * a full per-model match table. Unmatched tags get $0 entries so they don't
   * fall through to the $3/$15 default fallback.
   */
  private registerPricingForTags(
    tags: OllamaCloudTag[],
    openRouterModels: OpenRouterModel[],
  ): { matched: number; unmatched: number } {
    if (tags.length === 0) {
      return { matched: 0, unmatched: 0 };
    }

    const entries: Record<string, ModelPricing> = {};
    const matchedLines: string[] = [];
    const unmatchedIds: string[] = [];

    for (const tag of tags) {
      const or = this.matchOllamaToOpenRouter(tag.id, openRouterModels);
      if (!or) {
        // Register $0 so the stats panel shows $0.0000 instead of the default.
        entries[tag.id] = {
          inputCostPerToken: 0,
          outputCostPerToken: 0,
          cacheReadCostPerToken: 0,
          cacheCreationCostPerToken: 0,
          maxTokens: DEFAULT_CLOUD_CONTEXT,
          provider: 'ollama-cloud',
        };
        unmatchedIds.push(tag.id);
        continue;
      }

      const promptStr = or.pricing?.prompt;
      const completionStr = or.pricing?.completion;
      const inputCostPerToken =
        typeof promptStr === 'string' ? parseFloat(promptStr) : NaN;
      const outputCostPerToken =
        typeof completionStr === 'string' ? parseFloat(completionStr) : NaN;

      // If OpenRouter returned an entry without parseable pricing, treat it
      // as unmatched (register $0). Better than NaN everywhere.
      if (
        !Number.isFinite(inputCostPerToken) ||
        !Number.isFinite(outputCostPerToken)
      ) {
        entries[tag.id] = {
          inputCostPerToken: 0,
          outputCostPerToken: 0,
          cacheReadCostPerToken: 0,
          cacheCreationCostPerToken: 0,
          maxTokens: or.context_length ?? DEFAULT_CLOUD_CONTEXT,
          provider: 'ollama-cloud',
        };
        unmatchedIds.push(
          `${tag.id} (OpenRouter ${or.id} had unparseable pricing)`,
        );
        continue;
      }

      const cacheReadStr = or.pricing?.input_cache_read;
      const cacheReadParsed =
        typeof cacheReadStr === 'string' ? parseFloat(cacheReadStr) : NaN;
      const cacheReadCostPerToken = Number.isFinite(cacheReadParsed)
        ? cacheReadParsed
        : undefined;

      const pricing: ModelPricing = {
        inputCostPerToken,
        outputCostPerToken,
        ...(cacheReadCostPerToken !== undefined
          ? { cacheReadCostPerToken }
          : {}),
        maxTokens: or.context_length ?? DEFAULT_CLOUD_CONTEXT,
        provider: 'ollama-cloud',
      };
      entries[tag.id] = pricing;

      const inPer1M = (inputCostPerToken * 1_000_000).toFixed(2);
      const outPer1M = (outputCostPerToken * 1_000_000).toFixed(2);
      matchedLines.push(
        `${tag.id} → ${or.id} ($${inPer1M} in / $${outPer1M} out per 1M)`,
      );
    }

    registerProviderPricing(entries);

    // Emit a single info log with the full match table so users can audit in
    // the Output channel exactly which Ollama tag mapped to which OpenRouter
    // entry (and what it will cost).
    const matchedSection =
      matchedLines.length > 0
        ? `Price matches: ${matchedLines.join(', ')}`
        : 'Price matches: (none)';
    const unmatchedSection =
      unmatchedIds.length > 0
        ? ` UNMATCHED (registered at $0): [${unmatchedIds.join(', ')}]`
        : '';
    this.logger.info(
      `[OllamaCloudMetadata] ${matchedSection}${unmatchedSection}`,
    );

    return { matched: matchedLines.length, unmatched: unmatchedIds.length };
  }

  /**
   * Kept for backwards compatibility with OllamaModelDiscoveryService callers
   * that may still invoke it directly. The real pricing work happens in
   * {@link refresh()} via OpenRouter; this method is a thin wrapper that
   * ensures pricing was registered for whatever tags are currently cached.
   *
   * Never throws — pricing fetch is best-effort metadata.
   */
  async fetchAndRegisterPricing(
    apiKey: string,
  ): Promise<Record<string, ModelPricing>> {
    if (!apiKey?.trim()) {
      return {};
    }
    const [tags, openRouterModels] = await Promise.all([
      this.fetchCloudTags(apiKey),
      this.fetchOpenRouterPricing(),
    ]);
    if (tags.length === 0) {
      return {};
    }
    this.registerPricingForTags(tags, openRouterModels);
    // We intentionally return {} — callers only use this for logging counts;
    // the pricing is already globally registered via registerProviderPricing().
    return {};
  }

  /**
   * Force-refresh cached tags AND OpenRouter pricing, then register per-tag
   * prices. Logs start + summary so the user can verify in the output channel
   * that discovery and pricing overlay actually ran.
   */
  async refresh(apiKey: string): Promise<void> {
    this.tagsCache = null;
    this.openRouterCache = null;
    if (!apiKey?.trim()) {
      this.logger.debug(
        `[OllamaCloudMetadata] refresh() skipped — no API key configured`,
      );
      return;
    }
    this.logger.info(`[OllamaCloudMetadata] refresh() started`);

    const [tags, openRouterModels] = await Promise.all([
      this.fetchCloudTags(apiKey),
      this.fetchOpenRouterPricing(),
    ]);

    const { matched, unmatched } = this.registerPricingForTags(
      tags,
      openRouterModels,
    );

    this.logger.info(
      `[OllamaCloudMetadata] Refresh complete: ${tags.length} tags discovered, ` +
        `${matched} matched with OpenRouter pricing, ${unmatched} unmatched (registered as $0). ` +
        `OpenRouter catalog size: ${openRouterModels.length}.`,
    );
  }

  /** Clear all caches (e.g., on auth teardown) */
  clearCache(): void {
    this.tagsCache = null;
    this.openRouterCache = null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private isFresh<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }

  /**
   * Lightweight JSON GET using Node 18+ global `fetch`. When `apiKey` is a
   * non-empty string we attach `Authorization: Bearer <key>`; when null we
   * skip auth entirely (for endpoints like OpenRouter's public catalog).
   * Throws on non-2xx or invalid JSON; the error message includes the HTTP
   * status code and a short body snippet for debugging. Callers catch to
   * degrade.
   */
  private async httpJson<T>(url: string, apiKey: string | null): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'ptah-extension',
      };
      if (apiKey && apiKey.trim().length > 0) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        const snippet = this.truncate(text);
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
          `Non-JSON body from ${url} (HTTP ${res.status}) — first ${ERROR_BODY_SNIPPET_LEN} chars: ${this.truncate(
            text,
          )}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private truncate(s: string): string {
    if (!s) return '';
    const trimmed = s.replace(/\s+/g, ' ').trim();
    return trimmed.length > ERROR_BODY_SNIPPET_LEN
      ? `${trimmed.slice(0, ERROR_BODY_SNIPPET_LEN)}…`
      : trimmed;
  }
}
