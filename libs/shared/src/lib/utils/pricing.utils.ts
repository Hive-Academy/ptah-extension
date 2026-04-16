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
 * Default pricing for supported models (bundled fallback)
 *
 * Prices are in USD per token.
 * Updated: 2025-01-01 (from Anthropic pricing page and LiteLLM)
 *
 * @see https://www.anthropic.com/pricing
 * @see https://openai.com/pricing
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // ============================================================================
  // Anthropic Claude Models
  // ============================================================================

  // Claude 4.6 Opus (latest flagship — 1M context window)
  'claude-opus-4-6-20250623': {
    inputCostPerToken: 5e-6, // $5.00 per 1M tokens
    outputCostPerToken: 25e-6, // $25.00 per 1M tokens
    cacheReadCostPerToken: 5e-7, // $0.50 per 1M tokens
    cacheCreationCostPerToken: 6.25e-6, // $6.25 per 1M tokens
    maxTokens: 1_000_000,
    provider: 'anthropic',
  },

  // Claude 4.6 Opus (short alias)
  'claude-opus-4-6': {
    inputCostPerToken: 5e-6,
    outputCostPerToken: 25e-6,
    cacheReadCostPerToken: 5e-7,
    cacheCreationCostPerToken: 6.25e-6,
    maxTokens: 1_000_000,
    provider: 'anthropic',
  },

  // Claude 4.5 Opus (previous flagship)
  'claude-opus-4-5-20251101': {
    inputCostPerToken: 5e-6, // $5.00 per 1M tokens
    outputCostPerToken: 25e-6, // $25.00 per 1M tokens
    cacheReadCostPerToken: 5e-7, // $0.50 per 1M tokens
    cacheCreationCostPerToken: 6.25e-6, // $6.25 per 1M tokens
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 4.6 Sonnet (latest balanced)
  'claude-sonnet-4-6-20250514': {
    inputCostPerToken: 3e-6, // $3.00 per 1M tokens
    outputCostPerToken: 15e-6, // $15.00 per 1M tokens
    cacheReadCostPerToken: 3e-7, // $0.30 per 1M tokens
    cacheCreationCostPerToken: 3.75e-6, // $3.75 per 1M tokens
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 4.6 Sonnet (short alias — avoids O(n) partial scan on every lookup)
  'claude-sonnet-4-6': {
    inputCostPerToken: 3e-6,
    outputCostPerToken: 15e-6,
    cacheReadCostPerToken: 3e-7,
    cacheCreationCostPerToken: 3.75e-6,
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 4.5 Sonnet (balanced)
  'claude-sonnet-4-5-20250929': {
    inputCostPerToken: 3e-6, // $3.00 per 1M tokens
    outputCostPerToken: 15e-6, // $15.00 per 1M tokens
    cacheReadCostPerToken: 3e-7, // $0.30 per 1M tokens
    cacheCreationCostPerToken: 3.75e-6, // $3.75 per 1M tokens
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 3.5 Sonnet (previous gen)
  'claude-3-5-sonnet-20241022': {
    inputCostPerToken: 3e-6,
    outputCostPerToken: 15e-6,
    cacheReadCostPerToken: 3e-7,
    cacheCreationCostPerToken: 3.75e-6,
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 3 Opus
  'claude-3-opus-20240229': {
    inputCostPerToken: 15e-6, // $15.00 per 1M tokens
    outputCostPerToken: 75e-6, // $75.00 per 1M tokens
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 3.5 Haiku (fast & cheap)
  'claude-3-5-haiku-20241022': {
    inputCostPerToken: 0.8e-6, // $0.80 per 1M tokens
    outputCostPerToken: 4e-6, // $4.00 per 1M tokens
    cacheReadCostPerToken: 0.08e-6, // $0.08 per 1M tokens
    cacheCreationCostPerToken: 1e-6, // $1.00 per 1M tokens
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 4.5 Haiku (new fast model)
  'claude-haiku-4-5-20251001': {
    inputCostPerToken: 0.8e-6, // $0.80 per 1M tokens
    outputCostPerToken: 4e-6, // $4.00 per 1M tokens
    cacheReadCostPerToken: 0.08e-6, // $0.08 per 1M tokens
    cacheCreationCostPerToken: 1e-6, // $1.00 per 1M tokens
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // Claude 3 Haiku (legacy)
  'claude-3-haiku-20240307': {
    inputCostPerToken: 0.25e-6, // $0.25 per 1M tokens
    outputCostPerToken: 1.25e-6, // $1.25 per 1M tokens
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // ============================================================================
  // GitHub Copilot Model Aliases (subscription — $0)
  //
  // Copilot model IDs use dot notation (e.g., claude-sonnet-4.6) while the
  // Anthropic entries above use dash notation (e.g., claude-sonnet-4-6).
  // seedStaticModelPricing() seeds these at $0 during provider activation,
  // but if pricing is looked up before seeding completes, the partial-match
  // logic won't match dots against dashes and the default fallback ($3/$15)
  // would be returned — incorrectly showing cost for a free subscription model.
  // These entries act as a safety net so Copilot Claude models always resolve
  // to $0 regardless of initialization order.
  // ============================================================================
  'claude-sonnet-4.6': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    provider: 'github-copilot',
  },
  'claude-opus-4.6': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    provider: 'github-copilot',
  },
  'claude-opus-4.5': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    provider: 'github-copilot',
  },
  'claude-sonnet-4.5': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    provider: 'github-copilot',
  },
  'claude-haiku-4.5': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    provider: 'github-copilot',
  },

  // ============================================================================
  // OpenRouter Model ID Aliases
  // These map OpenRouter's naming convention to the same pricing
  // ============================================================================

  // OpenRouter Claude Haiku 4.5 alias
  'anthropic/claude-haiku-4.5': {
    inputCostPerToken: 0.8e-6, // Same as claude-3-5-haiku-20241022
    outputCostPerToken: 4e-6,
    cacheReadCostPerToken: 0.08e-6,
    cacheCreationCostPerToken: 1e-6,
    maxTokens: 200_000,
    provider: 'anthropic',
  },

  // ============================================================================
  // OpenAI Models (VS Code Copilot / LM API)
  // ============================================================================

  // GPT-4o (flagship)
  'gpt-4o': {
    inputCostPerToken: 2.5e-6, // $2.50 per 1M tokens
    outputCostPerToken: 10e-6, // $10.00 per 1M tokens
    maxTokens: 128_000,
    provider: 'openai',
  },

  // GPT-4o Mini (fast & cheap)
  'gpt-4o-mini': {
    inputCostPerToken: 0.15e-6, // $0.15 per 1M tokens
    outputCostPerToken: 0.6e-6, // $0.60 per 1M tokens
    maxTokens: 128_000,
    provider: 'openai',
  },

  // GPT-4 Turbo
  'gpt-4-turbo': {
    inputCostPerToken: 10e-6, // $10.00 per 1M tokens
    outputCostPerToken: 30e-6, // $30.00 per 1M tokens
    maxTokens: 128_000,
    provider: 'openai',
  },

  // GPT-4
  'gpt-4': {
    inputCostPerToken: 30e-6, // $30.00 per 1M tokens
    outputCostPerToken: 60e-6, // $60.00 per 1M tokens
    maxTokens: 8_192,
    provider: 'openai',
  },

  // GPT-3.5 Turbo
  'gpt-3.5-turbo': {
    inputCostPerToken: 0.5e-6, // $0.50 per 1M tokens
    outputCostPerToken: 1.5e-6, // $1.50 per 1M tokens
    maxTokens: 16_385,
    provider: 'openai',
  },

  // ============================================================================
  // Local Provider Models (Ollama, LM Studio — free inference)
  // ============================================================================
  local: {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    cacheReadCostPerToken: 0,
    cacheCreationCostPerToken: 0,
    provider: 'local',
  },

  // ============================================================================
  // Default Fallback (when model not found)
  // Uses Claude Sonnet 4.5 pricing as reasonable default
  // ============================================================================
  default: {
    inputCostPerToken: 3e-6,
    outputCostPerToken: 15e-6,
    cacheReadCostPerToken: 3e-7,
    cacheCreationCostPerToken: 3.75e-6,
    provider: 'unknown',
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
 * Get current pricing map (for debugging/testing)
 */
export function getPricingMap(): Record<string, ModelPricing> {
  return { ...modelPricingMap };
}

/**
 * Find pricing for a model by ID
 *
 * Matching strategy:
 * 1. Exact match (e.g., "claude-opus-4-5-20251101")
 * 2. Partial match (e.g., "claude-opus-4-5" matches "claude-opus-4-5-20251101")
 * 3. Fallback to default pricing
 *
 * @param modelId - Model identifier from Claude CLI or VS Code LM API
 * @returns Pricing for the model (never undefined)
 *
 * @example
 * ```typescript
 * const pricing = findModelPricing('claude-opus-4-5-20251101');
 * // Returns exact match for Opus 4.5
 *
 * const pricing2 = findModelPricing('gpt-4o-2024-08-06');
 * // Returns partial match for gpt-4o
 *
 * const pricing3 = findModelPricing('unknown-model');
 * // Returns default fallback pricing
 * ```
 */
export function findModelPricing(modelId: string): ModelPricing {
  if (!modelId) {
    return modelPricingMap['default'];
  }

  // SDK-internal model IDs (e.g., "<synthetic>") have no real pricing —
  // return default silently without logging a warning
  if (modelId.startsWith('<') && modelId.endsWith('>')) {
    return modelPricingMap['default'];
  }

  const normalizedId = modelId.toLowerCase();

  // 1. Exact match
  if (modelPricingMap[normalizedId]) {
    return modelPricingMap[normalizedId];
  }

  // 2. Partial match - find key that is contained in modelId or vice versa
  for (const [key, pricing] of Object.entries(modelPricingMap)) {
    if (key === 'default') continue;

    // Check if modelId contains the key (e.g., "claude-opus-4-5-20251101" contains "claude-opus-4-5")
    if (normalizedId.includes(key.toLowerCase())) {
      return pricing;
    }

    // Check if key contains modelId (less common but possible)
    if (key.toLowerCase().includes(normalizedId)) {
      return pricing;
    }
  }

  // 3. Fallback to default
  if (!warnedModelIds.has(modelId)) {
    warnedModelIds.add(modelId);
    console.warn(
      `[Pricing] Model '${modelId}' not found in pricing map, using default`,
    );
  }
  return modelPricingMap['default'];
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
): number {
  const pricing = findModelPricing(modelId);

  const inputCost = tokens.input * pricing.inputCostPerToken;
  const outputCost = tokens.output * pricing.outputCostPerToken;
  const cacheReadCost =
    (tokens.cacheHit ?? 0) * (pricing.cacheReadCostPerToken ?? 0);
  const cacheCreationCost =
    (tokens.cacheCreation ?? 0) * (pricing.cacheCreationCostPerToken ?? 0);

  const totalCost = inputCost + outputCost + cacheReadCost + cacheCreationCost;

  // Round to 6 decimal places for sub-cent accuracy
  return Math.round(totalCost * 1000000) / 1000000;
}

/**
 * Get the context window size for a model.
 *
 * Uses the `maxTokens` field from the pricing map as context window.
 * Returns 0 if unknown (the model isn't in the pricing map or has no maxTokens).
 *
 * @param modelId - Model identifier (e.g., "claude-sonnet-4-6-20250514")
 * @returns Context window size in tokens, or 0 if unknown
 */
export function getModelContextWindow(modelId: string): number {
  if (!modelId) return 0;
  const pricing = findModelPricing(modelId);
  return pricing.maxTokens ?? 0;
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

  const inputPer1M = (pricing.inputCostPerToken * 1000000).toFixed(2);
  const outputPer1M = (pricing.outputCostPerToken * 1000000).toFixed(2);

  return `Input: $${inputPer1M}/1M, Output: $${outputPer1M}/1M`;
}

/**
 * Format a full model ID to a human-readable display name.
 *
 * Maps model identifiers from the API to short readable names:
 * - "claude-sonnet-4-20250514" -> "Sonnet 4"
 * - "claude-opus-4-5-20251101" -> "Opus 4.5"
 * - "claude-haiku-4-5-20251001" -> "Haiku 4.5"
 * - "gpt-4o-2024-08-06" -> "GPT-4o"
 * - Unknown models -> truncated ID
 *
 * @param modelId - Full model identifier from API
 * @returns Human-readable model name
 */
export function formatModelDisplayName(modelId: string): string {
  if (!modelId) return 'Unknown';

  const lower = modelId.toLowerCase();

  // Strip date suffix (e.g., -20250514) to avoid digit collisions in version matching
  const withoutDate = lower.replace(/-\d{8}$/, '');

  // Anthropic Claude models
  if (withoutDate.includes('opus')) {
    if (withoutDate.includes('4.6') || withoutDate.includes('4-6'))
      return 'Opus 4.6';
    if (withoutDate.includes('4.5') || withoutDate.includes('4-5'))
      return 'Opus 4.5';
    if (withoutDate.includes('opus-4') || withoutDate.includes('opus 4'))
      return 'Opus 4';
    if (withoutDate.includes('3-opus') || withoutDate.includes('opus-3'))
      return 'Opus 3';
    return 'Opus';
  }

  if (withoutDate.includes('sonnet')) {
    if (withoutDate.includes('4.6') || withoutDate.includes('4-6'))
      return 'Sonnet 4.6';
    if (withoutDate.includes('4.5') || withoutDate.includes('4-5'))
      return 'Sonnet 4.5';
    if (withoutDate.includes('sonnet-4') || withoutDate.includes('sonnet 4'))
      return 'Sonnet 4';
    if (withoutDate.includes('3.5') || withoutDate.includes('3-5'))
      return 'Sonnet 3.5';
    return 'Sonnet';
  }

  if (withoutDate.includes('haiku')) {
    if (withoutDate.includes('4.5') || withoutDate.includes('4-5'))
      return 'Haiku 4.5';
    if (withoutDate.includes('3.5') || withoutDate.includes('3-5'))
      return 'Haiku 3.5';
    if (withoutDate.includes('3-haiku') || withoutDate.includes('haiku-3'))
      return 'Haiku 3';
    return 'Haiku';
  }

  // OpenAI models
  if (lower.includes('gpt-4o-mini')) return 'GPT-4o Mini';
  if (lower.includes('gpt-4o')) return 'GPT-4o';
  if (lower.includes('gpt-4-turbo')) return 'GPT-4 Turbo';
  if (lower.includes('gpt-4')) return 'GPT-4';
  if (lower.includes('gpt-3.5')) return 'GPT-3.5';

  // Google Gemini models
  if (lower.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro';
  if (lower.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (lower.includes('gemini-2.0-pro')) return 'Gemini 2.0 Pro';
  if (lower.includes('gemini-2.0-flash')) return 'Gemini 2.0 Flash';
  if (lower.includes('gemini-2')) return 'Gemini 2';
  if (lower.includes('gemini-1.5-pro')) return 'Gemini 1.5 Pro';
  if (lower.includes('gemini-1.5-flash')) return 'Gemini 1.5 Flash';
  if (lower.includes('gemini')) return 'Gemini';

  // Moonshot Kimi models
  if (lower.includes('kimi-k2.5')) return 'Kimi K2.5';
  if (lower.includes('kimi-k2-thinking')) return 'Kimi K2 Thinking';
  if (lower.includes('kimi-k2')) return 'Kimi K2';

  // Z.AI GLM models
  if (lower.includes('glm-5.1')) return 'GLM-5.1';
  if (lower.includes('glm-5-turbo')) return 'GLM-5 Turbo';
  if (lower.includes('glm-5-code')) return 'GLM-5 Code';
  if (lower.includes('glm-5')) return 'GLM-5';
  if (lower.includes('glm-4.7-flash') && !lower.includes('flashx'))
    return 'GLM-4.7 Flash';
  if (lower.includes('glm-4.7-flashx')) return 'GLM-4.7 FlashX';
  if (lower.includes('glm-4.7')) return 'GLM-4.7';
  if (lower.includes('glm-4.6')) return 'GLM-4.6';
  if (lower.includes('glm-4.5-x') && !lower.includes('air')) return 'GLM-4.5-X';
  if (lower.includes('glm-4.5-airx')) return 'GLM-4.5 AirX';
  if (lower.includes('glm-4.5-air')) return 'GLM-4.5 Air';
  if (lower.includes('glm-4.5-flash')) return 'GLM-4.5 Flash';
  if (lower.includes('glm-4.5')) return 'GLM-4.5';

  // Fallback: truncate long IDs
  if (modelId.length > 30) {
    return modelId.substring(0, 30) + '...';
  }
  return modelId;
}
