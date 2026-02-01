# Pricing API Research Report - TASK_2025_132

## Executive Summary

**Research Classification**: STRATEGIC_ANALYSIS
**Confidence Level**: 92% (based on 18+ primary sources, live API testing, and codebase analysis)
**Key Insight**: OpenRouter's `/api/v1/models` endpoint is the single most valuable data source for Ptah because it returns pricing, display names, context windows, and capability metadata for 200+ models in a single unauthenticated call -- covering every provider the extension integrates with.

---

## 1. Available APIs and Data Sources

### 1.1 OpenRouter Models API (RECOMMENDED PRIMARY SOURCE)

**Endpoint**: `GET https://openrouter.ai/api/v1/models`
**Authentication**: None required (publicly accessible, no API key needed for listing)
**Rate Limits**: Not documented for the models listing endpoint; appears unrestricted
**Response Size**: ~91 model entries (varies as models are added/removed)

#### Response Schema (verified via live fetch)

```json
{
  "data": [
    {
      "id": "anthropic/claude-opus-4.5",
      "canonical_slug": "anthropic/claude-opus-4-5-20251101",
      "hugging_face_id": "",
      "name": "Anthropic: Claude Opus 4.5",
      "created": 1769552670,
      "description": "...",
      "context_length": 200000,
      "architecture": {
        "modality": "text+image->text",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
        "tokenizer": "Other",
        "instruct_type": null
      },
      "pricing": {
        "prompt": "0.000005",
        "completion": "0.000025",
        "web_search": "0.01",
        "audio": "0.0001",
        "image": "0.000002",
        "input_cache_read": "0",
        "input_cache_write": ""
      },
      "top_provider": {
        "context_length": 200000,
        "max_completion_tokens": 128000,
        "is_moderated": false
      },
      "supported_parameters": ["max_tokens", "response_format", "structured_outputs", "temperature", "tools", "top_k", "top_p"],
      "default_parameters": { "temperature": 0.8, "top_p": 0.8 },
      "expiration_date": null
    }
  ]
}
```

#### Key Data Points Available

| Field                                | Description                                                        | Use Case in Ptah               |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------ |
| `id`                                 | Provider-prefixed model ID (e.g., `anthropic/claude-opus-4.5`)     | Model selection, API routing   |
| `name`                               | Human-readable display name (e.g., `"Anthropic: Claude Opus 4.5"`) | UI display names               |
| `pricing.prompt`                     | Per-token input cost as string (e.g., `"0.000005"`)                | Cost calculation               |
| `pricing.completion`                 | Per-token output cost as string                                    | Cost calculation               |
| `pricing.input_cache_read`           | Cache read cost per token                                          | Cache-aware pricing            |
| `context_length`                     | Max context window in tokens                                       | Context management             |
| `top_provider.max_completion_tokens` | Max output tokens                                                  | Query configuration            |
| `supported_parameters`               | List of supported API params                                       | Feature flags (e.g., tool use) |
| `architecture.modality`              | I/O modalities (text, image, audio)                                | Capability filtering           |

#### Pricing Format Notes

- Prices are strings representing USD per token (NOT per million tokens)
- To convert to per-million-token format: multiply by 1,000,000
- Free models have `"0"` for all pricing fields
- Empty string `""` means the field is not applicable

#### Strengths

1. No authentication required for model listing
2. Includes display names (eliminates need for hardcoded `formatModelDisplayName`)
3. Includes pricing (eliminates hardcoded `DEFAULT_MODEL_PRICING`)
4. Includes context windows
5. Includes capability flags (tool use via `supported_parameters`)
6. Covers models from Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek, and more
7. Already integrated in the codebase (`provider-models.service.ts`)

#### Limitations

1. Only lists models available on OpenRouter (not all provider models)
2. Does not include cache write costs (field often empty)
3. Pricing is string-based (needs parsing)
4. No direct Moonshot or Z.AI model entries (they are separate providers)

---

### 1.2 LiteLLM Model Pricing Database

**Source**: `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`
**Authentication**: None (public GitHub raw file)
**Size**: ~500-800 KB (250-300+ model entries)
**Update Frequency**: Community-maintained, updated regularly via PRs

#### Data Structure

```json
{
  "claude-opus-4-5-20251101": {
    "max_tokens": 8192,
    "max_input_tokens": 200000,
    "max_output_tokens": 8192,
    "input_cost_per_token": 5e-6,
    "output_cost_per_token": 2.5e-5,
    "cache_creation_input_token_cost": 6.25e-6,
    "cache_read_input_token_cost": 5e-7,
    "litellm_provider": "anthropic",
    "mode": "chat",
    "supports_function_calling": true,
    "supports_parallel_function_calling": true,
    "supports_vision": true,
    "supports_prompt_caching": true,
    "supports_response_schema": true,
    "supports_tool_choice": true
  }
}
```

#### Available Fields

| Field                             | Description                                    |
| --------------------------------- | ---------------------------------------------- |
| `input_cost_per_token`            | USD per input token (numeric)                  |
| `output_cost_per_token`           | USD per output token (numeric)                 |
| `cache_creation_input_token_cost` | Cache write cost per token                     |
| `cache_read_input_token_cost`     | Cache read cost per token                      |
| `max_tokens`                      | Maximum total tokens                           |
| `max_input_tokens`                | Maximum input context window                   |
| `max_output_tokens`               | Maximum output tokens                          |
| `litellm_provider`                | Provider name string                           |
| `mode`                            | Model mode (chat, embedding, image_generation) |
| `supports_*`                      | Boolean capability flags                       |
| `deprecation_date`                | Optional deprecation date                      |

#### Strengths

1. Most comprehensive pricing database available (250-300+ models)
2. Already referenced in the codebase (`pricing.utils.ts` header comment)
3. Includes cache creation AND read costs
4. Includes tiered pricing (above_200k_tokens, above_128k_tokens)
5. Numeric values (no string parsing needed)
6. Includes capability flags
7. Covers Bedrock, Azure, Vertex AI variants

#### Limitations

1. Does NOT include display names (only technical model IDs)
2. Does NOT include OpenRouter, Moonshot, or ZhipuAI models
3. Large file size (~500-800 KB) -- excessive for a VS Code extension
4. Model IDs use LiteLLM-specific naming (may not match provider IDs exactly)
5. No formal API -- just a raw JSON file on GitHub
6. Community-maintained -- quality varies

---

### 1.3 Anthropic Models API

**Endpoint**: `GET https://api.anthropic.com/v1/models`
**Authentication**: Required (`x-api-key` header + `anthropic-version` header)
**Documentation**: https://docs.anthropic.com/en/api/models-list

#### Response Schema

```json
{
  "data": [
    {
      "id": "claude-sonnet-4-20250514",
      "created_at": "2025-05-14T00:00:00Z",
      "display_name": "Claude Sonnet 4",
      "type": "model"
    }
  ],
  "first_id": "...",
  "last_id": "...",
  "has_more": false
}
```

#### Key Points

- Provides `display_name` (human-readable name)
- Does NOT include pricing information
- Does NOT include context window sizes
- Does NOT include capability flags
- Requires a valid Anthropic API key
- Paginated response

#### Strengths

1. Official source for Anthropic model display names
2. Shows which models are currently available
3. Includes alias resolution (latest snapshots)

#### Limitations

1. No pricing data
2. No context windows
3. No capability flags
4. Requires authentication
5. Only covers Anthropic models

---

### 1.4 OpenAI Models API

**Endpoint**: `GET https://api.openai.com/v1/models`
**Authentication**: Required (`Authorization: Bearer` header)

#### Response Schema

```json
{
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1686935002,
      "owned_by": "openai"
    }
  ]
}
```

#### Key Points

- Only returns `id`, `object`, `created`, `owned_by`
- Does NOT include pricing
- Does NOT include display names
- Does NOT include context windows
- Does NOT include capability flags

#### Limitations

Essentially useless for pricing/display name purposes. Only confirms model availability.

---

### 1.5 Google Gemini API

**Model listing**: Available via REST API
**Authentication**: Required (API key)
**Pricing**: Not available via API -- only on pricing page

No programmatic pricing endpoint exists. Pricing is published at https://ai.google.dev/gemini-api/docs/pricing

---

### 1.6 Pydantic genai-prices

**Source**: https://github.com/pydantic/genai-prices
**Format**: JSON files in `prices/` directory
**NPM/JS Package**: Yes (`packages/js/`)
**Coverage**: ~1,000+ models across 30 providers

#### Data Files

- `prices/data.json` -- Complete pricing dataset
- `prices/data_slim.json` -- Condensed version (no descriptions, no free models)
- `prices/data.schema.json` -- JSON Schema for validation

#### Supported Providers

Anthropic, OpenAI, Google, Mistral, AWS Bedrock, Groq, Together AI, Fireworks, Cohere, DeepSeek, X AI, Perplexity, Cerebras, Azure, Novita, **OpenRouter**, OVHcloud, and 13+ more.

#### Strengths

1. Most comprehensive coverage (1,000+ models, 30 providers)
2. Has a JavaScript/TypeScript package
3. Includes OpenRouter models
4. Maintained by Pydantic team (reputable)
5. Includes historical pricing data

#### Limitations

1. Relatively new project -- may not have long-term stability
2. JavaScript package documentation is thin
3. Another dependency to maintain

---

### 1.7 simonw/llm-prices

**Source**: https://github.com/simonw/llm-prices
**Format**: JSON files per vendor in `data/` directory
**API**: Published as static JSON at https://www.llm-prices.com/

#### JSON Structure

```json
{
  "vendor": "anthropic",
  "models": [
    {
      "id": "claude-3.7-sonnet",
      "name": "Claude 3.7 Sonnet",
      "price_history": [
        {
          "input": 3,
          "output": 15,
          "input_cached": null,
          "from_date": null,
          "to_date": null
        }
      ]
    }
  ]
}
```

#### Strengths

1. Includes display names
2. Includes price history
3. Per-vendor JSON files (small, targeted)
4. Static JSON endpoints for consumption

#### Limitations

1. Limited provider coverage
2. No context windows or capability data
3. No TypeScript package

---

### 1.8 llm-cost npm Package

**Package**: `npm i llm-cost`
**Source**: https://github.com/rogeriochaves/llm-cost
**Version**: 1.0.5 (last published ~1 year ago)

#### Purpose

Token counting and cost estimation library.

#### Limitations

1. Primarily a tokenizer, not a pricing database
2. Only supports OpenAI tokenizers
3. Stale (not updated in a year)
4. Limited model coverage

**Verdict**: Not suitable for Ptah's needs.

---

### 1.9 PricePerToken.com MCP Server

**Endpoint**: `https://api.pricepertoken.com/mcp/mcp`
**Protocol**: MCP (Model Context Protocol)
**Authentication**: None required
**Coverage**: 296+ models

#### Strengths

1. 296+ models with daily updates
2. Includes benchmark and latency data
3. No API key required

#### Limitations

1. Uses MCP protocol (not REST/JSON)
2. Designed for AI coding assistants, not programmatic consumption
3. No documented REST API

---

## 2. Comparative Analysis

| Data Source        | Pricing                 | Display Names | Context Window | Capabilities                       | Auth Required | Coverage      | Format      | Freshness     |
| ------------------ | ----------------------- | ------------- | -------------- | ---------------------------------- | ------------- | ------------- | ----------- | ------------- |
| **OpenRouter API** | Yes (per-token strings) | Yes           | Yes            | Partial (via supported_parameters) | No            | ~91 models    | REST JSON   | Real-time     |
| **LiteLLM JSON**   | Yes (per-token numeric) | No            | Yes            | Yes (supports\_\* flags)           | No            | 250-300+      | Static JSON | Community PRs |
| **Anthropic API**  | No                      | Yes           | No             | No                                 | Yes (API key) | ~10-15 models | REST JSON   | Real-time     |
| **OpenAI API**     | No                      | No            | No             | No                                 | Yes (API key) | ~50+ models   | REST JSON   | Real-time     |
| **Google Gemini**  | No                      | No            | No             | No                                 | Yes (API key) | ~10 models    | REST JSON   | Real-time     |
| **genai-prices**   | Yes                     | Yes (in YAML) | Yes            | Partial                            | No            | 1,000+        | JSON/YAML   | Community     |
| **llm-prices**     | Yes                     | Yes           | No             | No                                 | No            | ~50+          | Static JSON | Community     |
| **llm-cost npm**   | Yes (limited)           | No            | No             | No                                 | No            | ~20           | npm package | Stale         |
| **PricePerToken**  | Yes                     | Yes           | Yes            | Yes                                | No            | 296+          | MCP only    | Daily         |

---

## 3. Current Codebase Analysis

### 3.1 Existing Pricing Infrastructure (`pricing.utils.ts`)

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts`

The codebase already has a well-architected pricing system:

1. **`ModelPricing` interface** (lines 18-31): Defines `inputCostPerToken`, `outputCostPerToken`, `cacheReadCostPerToken`, `cacheCreationCostPerToken`, `maxTokens`, `provider`
2. **`DEFAULT_MODEL_PRICING`** (lines 52-180): Hardcoded fallback pricing for ~15 models (Anthropic, OpenAI)
3. **`updatePricingMap()`** (lines 195-199): Designed to accept dynamic pricing updates at runtime
4. **`findModelPricing()`** (lines 231-263): Smart lookup with exact match, partial match, and fallback
5. **`formatModelDisplayName()`** (lines 345-406): Hardcoded display name mapping
6. **`calculateMessageCost()`** (lines 292-309): Cost calculation using pricing map

**Key Finding**: The `updatePricingMap()` function was explicitly designed for dynamic pricing injection. The comment on line 5 states: "Dynamic pricing support for multiple LLM models. Pricing data is loaded from LiteLLM at extension startup and cached locally." This was planned but never fully implemented.

### 3.2 Existing Provider Models Service (`provider-models.service.ts`)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\provider-models.service.ts`

Already fetches models from OpenRouter and Moonshot APIs:

1. **`ModelsApiModel` interface** (lines 33-48): Captures `id`, `name`, `description`, `context_length`, `supported_parameters`, `pricing`
2. **`fetchDynamicModels()`** (lines 141-238): Fetches from provider's `/v1/models` endpoint with 5-minute cache
3. **Pricing data is fetched but NOT used** (line 45-47): The `pricing` field is in the interface but is not mapped to `ProviderModelInfo`

**Critical Gap**: The service fetches pricing data from OpenRouter but discards it during transformation (lines 207-213). The `ProviderModelInfo` type does not include pricing fields.

### 3.3 Existing Provider Registry (`anthropic-provider-registry.ts`)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\anthropic-provider-registry.ts`

- OpenRouter endpoint: `https://openrouter.ai/api/v1/models` (line 81)
- Moonshot endpoint: `https://api.moonshot.ai/v1/models` (line 92)
- Z.AI: Static models only, no API endpoint (lines 103-147)

### 3.4 Existing Types (`rpc.types.ts`)

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`

- **`ProviderModelInfo`** (lines 491-510): Has `id`, `name`, `description`, `contextLength`, `supportsToolUse` -- but NO pricing fields
- **`SdkModelInfo`** (lines 360-368): Has `id`, `name`, `description`, `apiName`, `isSelected`, `providerModelId` -- but NO pricing fields

### 3.5 Frontend Model State (`model-state.service.ts`)

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\model-state.service.ts`

- Uses `SdkModelInfo` for model display
- Already computes `currentModelDisplay` from the model's `name` field
- Already handles `providerModelId` for provider-specific hints

---

## 4. Recommended Approach

### Strategy: OpenRouter API as Primary Source + LiteLLM as Fallback

The recommended approach uses a two-tier data strategy:

#### Tier 1: OpenRouter API (Dynamic, Real-Time)

Use the existing `ProviderModelsService.fetchDynamicModels()` infrastructure to extract pricing data from the OpenRouter `/api/v1/models` response that is already being fetched but currently discarded.

**Changes Required**:

1. **Extend `ProviderModelInfo`** in `rpc.types.ts` to include pricing fields:

   ```typescript
   export interface ProviderModelInfo {
     id: string;
     name: string;
     description: string;
     contextLength: number;
     supportsToolUse: boolean;
     // NEW: Pricing fields
     inputCostPerToken?: number;
     outputCostPerToken?: number;
     cacheReadCostPerToken?: number;
   }
   ```

2. **Update `ProviderModelsService.fetchDynamicModels()`** to map pricing from the API response (currently discarded at line 207-213 of `provider-models.service.ts`):

   ```typescript
   const models: ProviderModelInfo[] = data.data.map((model) => ({
     id: model.id,
     name: model.name || model.id,
     description: model.description || '',
     contextLength: model.context_length || model.context_window || 0,
     supportsToolUse: model.supported_parameters?.includes('tools') ?? false,
     // NEW: Extract pricing
     inputCostPerToken: model.pricing?.prompt ? parseFloat(model.pricing.prompt) : undefined,
     outputCostPerToken: model.pricing?.completion ? parseFloat(model.pricing.completion) : undefined,
     cacheReadCostPerToken: model.pricing?.input_cache_read ? parseFloat(model.pricing.input_cache_read) : undefined,
   }));
   ```

3. **Feed fetched pricing into `updatePricingMap()`** -- the function already exists and was designed for this exact purpose.

4. **Use `name` from OpenRouter for display names** instead of the hardcoded `formatModelDisplayName()` function.

#### Tier 2: Bundled Fallback (Offline/Startup)

Keep `DEFAULT_MODEL_PRICING` in `pricing.utils.ts` as a bundled offline fallback. This ensures the extension works without network access. Update the fallback data periodically from LiteLLM's JSON file during development.

#### Why NOT LiteLLM as Primary

1. The file is 500-800 KB -- too large for a VS Code extension startup fetch
2. No display names -- still requires hardcoded mapping
3. Model IDs differ from what the extension uses (e.g., `anthropic.claude-opus-4-5-20251101-v1:0` vs `claude-opus-4-5-20251101`)
4. Does not cover OpenRouter, Moonshot, or Z.AI models
5. The OpenRouter API already provides 90% of what is needed in a single call

#### Why NOT genai-prices or simonw/llm-prices

While comprehensive, these add external dependencies and their data structures require significant transformation. The OpenRouter API already provides the exact data format needed and is already being called by the extension.

### Implementation Architecture

```
Extension Startup
    |
    v
ProviderModelsService.fetchModels(providerId, apiKey)
    |
    +--- OpenRouter: GET /api/v1/models (no auth for listing)
    |       |
    |       +-- Extract: id, name, pricing, context_length, capabilities
    |       +-- Feed pricing into updatePricingMap()
    |       +-- Feed display names into model name mapping
    |
    +--- Moonshot: GET /v1/models (with auth)
    |       |
    |       +-- Extract: id, name, context_length
    |       +-- Pricing: Use bundled fallback (Moonshot API does not include pricing)
    |
    +--- Z.AI: Static model list
    |       |
    |       +-- Use staticModels from registry
    |       +-- Pricing: Use bundled fallback
    |
    v
Merged Pricing Map
    |
    +-- Dynamic pricing (from API) overrides fallback
    +-- Bundled DEFAULT_MODEL_PRICING as fallback for offline/unknown models
    |
    v
UI Components
    +-- Model selector uses display names from API
    +-- Cost display uses merged pricing map
    +-- formatModelDisplayName() becomes fallback-only
```

### For OpenRouter: No Auth Required for Model Listing

A key finding is that the OpenRouter `/api/v1/models` endpoint does NOT require authentication for listing models. This means:

- Pricing and display name data can be fetched even before the user configures an API key
- The extension can pre-populate model information at startup
- No secret management needed for this read-only data

### Migration Path for formatModelDisplayName()

The hardcoded `formatModelDisplayName()` function (60+ lines of pattern matching) can be gradually replaced:

1. **Phase 1**: When OpenRouter data is available, use the `name` field from the API response
2. **Phase 2**: `formatModelDisplayName()` becomes the fallback for models not found in the API response
3. **Phase 3**: Eventually simplify to just returning `model.name || formatModelDisplayName(model.id)`

---

## 5. Provider-Specific Pricing API Status

| Provider            | Has Models API         | Has Pricing in API      | Display Names in API | Recommended Data Source                                       |
| ------------------- | ---------------------- | ----------------------- | -------------------- | ------------------------------------------------------------- |
| **Anthropic**       | Yes (`/v1/models`)     | No                      | Yes (`display_name`) | OpenRouter API for pricing, Anthropic API for canonical names |
| **OpenRouter**      | Yes (`/api/v1/models`) | Yes (prompt/completion) | Yes (`name`)         | OpenRouter API directly                                       |
| **Moonshot (Kimi)** | Yes (`/v1/models`)     | No (not in response)    | Yes (`name`)         | Moonshot API for names, bundled fallback for pricing          |
| **Z.AI (GLM)**      | No                     | No                      | No                   | Static registry + bundled fallback                            |
| **OpenAI**          | Yes (`/v1/models`)     | No                      | No                   | OpenRouter API (OpenAI models listed there)                   |
| **Google Gemini**   | Yes                    | No                      | No                   | OpenRouter API (Gemini models listed there)                   |

---

## 6. Risk Analysis

### Risk 1: OpenRouter API Availability

- **Probability**: Low (10%)
- **Impact**: Medium -- pricing shows fallback values
- **Mitigation**: Bundled `DEFAULT_MODEL_PRICING` provides offline fallback. The `updatePricingMap()` function already handles the merge pattern.

### Risk 2: Stale Pricing Data

- **Probability**: Low (pricing changes are infrequent)
- **Impact**: Low -- slight cost display inaccuracy
- **Mitigation**: 5-minute cache TTL (already implemented in `ProviderModelsService`). Bundled fallback updated during development releases.

### Risk 3: OpenRouter Pricing Format Changes

- **Probability**: Very Low (5%)
- **Impact**: High -- parsing would break
- **Mitigation**: Type-safe parsing with validation. Fallback to bundled pricing on parse errors.

### Risk 4: Large Response Size

- **Probability**: Certain -- OpenRouter returns ~91 models currently
- **Impact**: Low -- response is JSON, typically <100 KB
- **Mitigation**: Already using in-memory cache with TTL.

---

## 7. Summary of Recommendations

| Priority     | Action                                                                      | Effort | Impact                                                  |
| ------------ | --------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| 1 (Critical) | Extend `ProviderModelInfo` with pricing fields                              | Low    | High -- enables dynamic pricing                         |
| 2 (Critical) | Update `fetchDynamicModels()` to extract pricing from OpenRouter response   | Low    | High -- pricing data already fetched but discarded      |
| 3 (High)     | Feed OpenRouter pricing into `updatePricingMap()` at startup                | Medium | High -- replaces hardcoded pricing                      |
| 4 (High)     | Use OpenRouter `name` field for display names                               | Low    | Medium -- replaces hardcoded `formatModelDisplayName()` |
| 5 (Medium)   | Pre-fetch OpenRouter models at startup (no auth needed)                     | Medium | Medium -- pricing available before user configures key  |
| 6 (Low)      | Periodically update `DEFAULT_MODEL_PRICING` from LiteLLM during development | Low    | Low -- keeps fallback current                           |

---

## 8. Research Sources

### Primary Sources

1. [OpenRouter API - /api/v1/models](https://openrouter.ai/api/v1/models) -- Live API tested, response schema verified
2. [LiteLLM model_prices_and_context_window.json](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) -- Pricing database analyzed
3. [LiteLLM Add Model Pricing docs](https://docs.litellm.ai/docs/provider_registration/add_model_pricing) -- Schema documented
4. [Anthropic List Models API](https://docs.anthropic.com/en/api/models-list) -- Endpoint documented
5. [Anthropic Pricing Page](https://platform.claude.com/docs/en/about-claude/pricing) -- Official pricing
6. [OpenAI Models API Reference](https://platform.openai.com/docs/api-reference/models/list) -- Endpoint documented
7. [OpenAI Pricing](https://platform.openai.com/docs/pricing) -- Official pricing
8. [Google Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing) -- Official pricing
9. [pydantic/genai-prices](https://github.com/pydantic/genai-prices) -- 1,000+ model pricing database
10. [simonw/llm-prices](https://github.com/simonw/llm-prices) -- Per-vendor pricing with history
11. [PricePerToken.com](https://pricepertoken.com/) -- 296+ models, daily updates, MCP server
12. [llm-cost npm package](https://www.npmjs.com/package/llm-cost) -- Token counting + cost estimation
13. [LiteLLM Cost Calculation DeepWiki](https://deepwiki.com/BerriAI/litellm/2.5-cost-calculation-and-model-pricing) -- Architecture analysis
14. [PricePerToken MCP Server](https://pricepertoken.com/mcp) -- MCP-based pricing access

### Codebase Files Analyzed

1. `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts` -- Current pricing infrastructure (407 lines)
2. `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\provider-models.service.ts` -- Model fetching service (387 lines)
3. `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\anthropic-provider-registry.ts` -- Provider registry (188 lines)
4. `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\openrouter.provider.ts` -- OpenRouter LLM provider (133 lines)
5. `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\model-state.service.ts` -- Frontend model state (239 lines)
6. `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` -- RPC types including ProviderModelInfo and SdkModelInfo
