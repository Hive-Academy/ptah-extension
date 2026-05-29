/**
 * Model Pricing Utilities
 *
 * Dynamic pricing support for multiple LLM models.
 * Pricing data is loaded from LiteLLM at extension startup and cached locally.
 *
 * Supports:
 * - Anthropic Claude models (Opus, Sonnet, Haiku)
 * - VS Code LM API models (GPT-4o, Copilot models)
 * - Automatic fallback to bundled pricing when offline
 *
 * @see https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
 */

/**
 * Pricing information for a single model
 */
export interface ModelPricing {
  /** Cost per input token in USD */
  readonly inputCostPerToken: number;
  /** Cost per output token in USD */
  readonly outputCostPerToken: number;
  /** Cost per cache read token in USD (optional) */
  readonly cacheReadCostPerToken?: number;
  /** Cost per cache creation token in USD (optional) */
  readonly cacheCreationCostPerToken?: number;
  /** Maximum context window size */
  readonly maxTokens?: number;
  /** Provider name (anthropic, openai, etc.) */
  readonly provider?: string;
}

/**
 * Token breakdown for cost calculation
 */
export interface TokenBreakdown {
  readonly input: number;
  readonly output: number;
  readonly cacheHit?: number; // cache read tokens
  readonly cacheCreation?: number; // cache write tokens
}

/**
 * Bundled pricing for known-zero-cost surfaces (Copilot subscription, local
 * Ollama / LM Studio) and a small Anthropic-direct table that ships with the
 * binary for the case where the OpenRouter catalog hasn't fetched yet.
 *
 * For every other model the runtime pricing map is hydrated from OpenRouter's
 * public `/api/v1/models` catalog at startup via {@link registerProviderPricing}.
 * If hydration hasn't happened (offline first-run, fetch failure), unknown
 * models return `null` from {@link findModelPricing} so the UI can render
 * "Pricing unavailable" instead of a fabricated dollar figure.
 *
 * @see https://www.anthropic.com/pricing
 * @see https://openrouter.ai/api/v1/models
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4.6': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    maxTokens: 200_000,
    provider: 'github-copilot',
  },
  'claude-opus-4.7': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    maxTokens: 1_000_000,
    provider: 'github-copilot',
  },
  'claude-opus-4.6': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    maxTokens: 1_000_000,
    provider: 'github-copilot',
  },
  'claude-opus-4.5': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    maxTokens: 200_000,
    provider: 'github-copilot',
  },
  'claude-sonnet-4.5': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    maxTokens: 200_000,
    provider: 'github-copilot',
  },
  'claude-haiku-4.5': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    maxTokens: 200_000,
    provider: 'github-copilot',
  },
  'gpt-4o': {
    inputCostPerToken: 2.5e-6, // $2.50 per 1M tokens
    outputCostPerToken: 10e-6, // $10.00 per 1M tokens
    maxTokens: 128_000,
    provider: 'openai',
  },
  'gpt-4o-mini': {
    inputCostPerToken: 0.15e-6, // $0.15 per 1M tokens
    outputCostPerToken: 0.6e-6, // $0.60 per 1M tokens
    maxTokens: 128_000,
    provider: 'openai',
  },
  'gpt-4-turbo': {
    inputCostPerToken: 10e-6, // $10.00 per 1M tokens
    outputCostPerToken: 30e-6, // $30.00 per 1M tokens
    maxTokens: 128_000,
    provider: 'openai',
  },
  'gpt-4': {
    inputCostPerToken: 30e-6, // $30.00 per 1M tokens
    outputCostPerToken: 60e-6, // $60.00 per 1M tokens
    maxTokens: 8_192,
    provider: 'openai',
  },
  'gpt-3.5-turbo': {
    inputCostPerToken: 0.5e-6, // $0.50 per 1M tokens
    outputCostPerToken: 1.5e-6, // $1.50 per 1M tokens
    maxTokens: 16_385,
    provider: 'openai',
  },
  local: {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    cacheReadCostPerToken: 0,
    cacheCreationCostPerToken: 0,
    provider: 'local',
  },
  ':cloud': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    cacheReadCostPerToken: 0,
    cacheCreationCostPerToken: 0,
    provider: 'ollama-cloud',
  },
};

/**
 * Set of model IDs that have already been warned about.
 * Prevents log spam when the same unknown model is looked up repeatedly
 * (e.g., during session resume processing hundreds of messages).
 */
const warnedModelIds = new Set<string>();

/**
 * Model pricing map - can be updated dynamically at runtime
 * Initialized with default bundled pricing
 */
let modelPricingMap: Record<string, ModelPricing> = {
  ...DEFAULT_MODEL_PRICING,
};

/**
 * Merge new pricing entries into the runtime pricing map.
 *
 * Uses additive merge: new entries override existing ones, but previously
 * added dynamic entries from other providers are preserved. The bundled
 * DEFAULT_MODEL_PRICING is always the base layer (set at initialization).
 *
 * @param newPricing - New pricing data to merge into the existing map
 */
export function updatePricingMap(
  newPricing: Record<string, ModelPricing>,
): void {
  modelPricingMap = { ...modelPricingMap, ...newPricing };
}

/**
 * Register provider-supplied pricing into the runtime pricing map.
 *
 * Semantic alias for {@link updatePricingMap} — lets providers (e.g. Ollama
 * Cloud's metadata service after fetching ollama.com/api/usage) seed real
 * per-token costs that {@link calculateMessageCost} will then surface in the
 * stats panel. Both exact and lowercase keys are added so partial-match lookup
 * still works regardless of caller casing.
 *
 * @param entries - Map of model ID → pricing
 */
export function registerProviderPricing(
  entries: Record<string, ModelPricing>,
): void {
  if (!entries || Object.keys(entries).length === 0) {
    return;
  }
  const normalized: Record<string, ModelPricing> = {};
  for (const [id, pricing] of Object.entries(entries)) {
    normalized[id] = pricing;
    const lower = id.toLowerCase();
    if (lower !== id) {
      normalized[lower] = pricing;
    }
  }
  updatePricingMap(normalized);
}

/**
 * Get current pricing map (for debugging/testing)
 */
export function getPricingMap(): Record<string, ModelPricing> {
  return { ...modelPricingMap };
}

/**
 * Find pricing for a model by ID.
 *
 * Matching strategy:
 * 1. Exact match (e.g., "claude-opus-4-5-20251101", "gpt-5.4", "kimi-k2.5")
 * 2. Partial match (e.g., "claude-opus-4-5" matches "claude-opus-4-5-20251101")
 * 3. Returns `null` — pricing genuinely unknown.
 *
 * @param modelId - Model identifier from the SDK or third-party proxy.
 * @returns Pricing entry, or `null` when no match is found. Callers should
 *   render "Pricing unavailable" / "—" rather than fabricating a fallback.
 *
 * @example
 * ```typescript
 * findModelPricing('claude-opus-4-7'); // Exact match
 * findModelPricing('gpt-4o-2024-08-06'); // Partial match → gpt-4o
 * findModelPricing('unknown-model'); // null
 * ```
 */
export function findModelPricing(modelId: string): ModelPricing | null {
  if (!modelId) {
    return null;
  }
  if (modelId.startsWith('<') && modelId.endsWith('>')) {
    return null;
  }

  const normalizedId = modelId.toLowerCase();
  if (modelPricingMap[normalizedId]) {
    return modelPricingMap[normalizedId];
  }
  for (const [key, pricing] of Object.entries(modelPricingMap)) {
    if (normalizedId.includes(key.toLowerCase())) {
      return pricing;
    }
    if (key.toLowerCase().includes(normalizedId)) {
      return pricing;
    }
  }
  if (!warnedModelIds.has(modelId)) {
    warnedModelIds.add(modelId);
    console.warn(
      `[Pricing] Model '${modelId}' not found in pricing map — cost will render as unavailable`,
    );
  }
  return null;
}

/**
 * Calculate message cost in USD for a specific model
 *
 * @param modelId - Model identifier (e.g., "claude-opus-4-5-20251101")
 * @param tokens - Token breakdown from message
 * @returns Cost in USD (e.g., 0.0042 for $0.0042), rounded to 6 decimal places
 *
 * @example
 * ```typescript
 * const cost = calculateMessageCost('claude-opus-4-5-20251101', {
 *   input: 1000,
 *   output: 500,
 *   cacheHit: 200
 * });
 * // Returns cost based on Opus 4.5 pricing
 * ```
 *
 * @example
 * ```typescript
 * // Zero tokens returns 0
 * const cost = calculateMessageCost('gpt-4o', {
 *   input: 0,
 *   output: 0
 * });
 * // Returns: 0
 * ```
 */
export function calculateMessageCost(
  modelId: string,
  tokens: TokenBreakdown,
): number | null {
  const pricing = findModelPricing(modelId);
  if (!pricing) return null;

  const inputCost = tokens.input * pricing.inputCostPerToken;
  const outputCost = tokens.output * pricing.outputCostPerToken;
  const cacheReadCost =
    (tokens.cacheHit ?? 0) * (pricing.cacheReadCostPerToken ?? 0);
  const cacheCreationCost =
    (tokens.cacheCreation ?? 0) * (pricing.cacheCreationCostPerToken ?? 0);

  const totalCost = inputCost + outputCost + cacheReadCost + cacheCreationCost;
  return Math.round(totalCost * 1000000) / 1000000;
}

export function getModelContextWindow(modelId: string): number {
  if (!modelId) return 0;
  const pricing = findModelPricing(modelId);
  if (pricing?.maxTokens) return pricing.maxTokens;

  const stripped = modelId
    .replace(/^(?:anthropic|openrouter|google|openai|moonshot|zai)\//i, '')
    .toLowerCase();

  const claudeModern = stripped.match(
    /^claude-(opus|sonnet|haiku)-(\d+)[-.](\d+)/,
  );
  if (claudeModern) {
    const family = claudeModern[1];
    const major = Number.parseInt(claudeModern[2], 10);
    const minor = Number.parseInt(claudeModern[3], 10);
    if (family === 'opus' && (major > 4 || (major === 4 && minor >= 6))) {
      return 1_000_000;
    }
    return 200_000;
  }

  if (/^claude-3/.test(stripped)) return 200_000;

  return 0;
}

/**
 * Get a human-readable description of model pricing
 *
 * @param modelId - Model identifier
 * @returns Pricing description string
 *
 * @example
 * ```typescript
 * const desc = getModelPricingDescription('claude-opus-4-5-20251101');
 * // Returns: "Input: $5.00/1M, Output: $25.00/1M"
 * ```
 */
export function getModelPricingDescription(modelId: string): string {
  const pricing = findModelPricing(modelId);
  if (!pricing) return 'Pricing unavailable';

  const inputPer1M = (pricing.inputCostPerToken * 1000000).toFixed(2);
  const outputPer1M = (pricing.outputCostPerToken * 1000000).toFixed(2);

  return `Input: $${inputPer1M}/1M, Output: $${outputPer1M}/1M`;
}

export function formatModelDisplayName(modelId: string): string {
  if (!modelId) return 'Unknown';
  const stripped = modelId.replace(
    /^(?:anthropic|openrouter|google|openai|moonshot|zai)\//i,
    '',
  );
  const noDate = stripped
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const modern = noDate.match(
    /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-(.+))?$/i,
  );
  if (modern) {
    const [, family, maj, min, suffix] = modern;
    const cap = family[0].toUpperCase() + family.slice(1).toLowerCase();
    return suffix ? `${cap} ${maj}.${min} (${suffix})` : `${cap} ${maj}.${min}`;
  }
  const legacy = noDate.match(/^claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)$/i);
  if (legacy) {
    const [, gen, sub, family] = legacy;
    const cap = family[0].toUpperCase() + family.slice(1).toLowerCase();
    return sub ? `${cap} ${gen}.${sub}` : `${cap} ${gen}`;
  }
  if (noDate.length > 30) return noDate.slice(0, 30) + '...';
  return noDate;
}

export function resolveModelDisplayName(
  modelId: string,
  availableModels?: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (!modelId) return 'Unknown';
  if (availableModels) {
    const match = availableModels.find((m) => m.id === modelId);
    if (match) return match.name;
  }
  return formatModelDisplayName(modelId);
}
