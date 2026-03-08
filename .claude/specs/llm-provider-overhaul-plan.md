# LLM Provider Overhaul - Comprehensive Plan (v2)

**Date**: 2026-02-18
**Branch**: `feature/sdk-only-migration`
**Status**: Awaiting approval

---

## Vision

Remove ALL Langchain dependencies. Replace with native SDKs (`@google/genai` for Google, `openai` for OpenAI). Add subscription-based OAuth auth (OpenAI Codex, Google Gemini) alongside BYOK API keys. Create a settings UI for managing providers. Add image generation via Google Gemini/Imagen MCP tool.

**Two-layer architecture**:

- **Agent SDK layer** (existing): Claude Code main agent — routes through Anthropic-compatible providers (OpenRouter, Moonshot, Z.AI)
- **MCP tool layer** (new): Secondary providers for delegation — Google Gemini (text + image) and OpenAI (text), callable by Claude via MCP tools

---

## Phase 1: Remove ALL Langchain Packages

### Rationale

- `@langchain/anthropic` — redundant with Agent SDK
- `@langchain/google-genai` — built on deprecated SDK, replacing with `@google/genai`
- `@langchain/openai` — replacing with native `openai` package
- `@langchain/core`, `langchain` — no longer needed without provider packages

### npm Packages to Remove (6 total)

| Package                   | Current Version          |
| ------------------------- | ------------------------ |
| `@langchain/anthropic`    | ^0.3.33                  |
| `@langchain/google-genai` | ^0.2.18                  |
| `@langchain/openai`       | ^0.5.18                  |
| `@langchain/core`         | ^0.3.79                  |
| `langchain`               | ^0.3.36                  |
| `@google/generative-ai`   | (transitive, if present) |

### npm Packages to Add (2 total)

| Package         | Version | Purpose                               |
| --------------- | ------- | ------------------------------------- |
| `@google/genai` | ^1.41.0 | Google Gemini text + image generation |
| `openai`        | ^4.x    | OpenAI native SDK (text chat)         |

### Files to Delete

| File                                                                    | Why                              |
| ----------------------------------------------------------------------- | -------------------------------- |
| `libs/backend/llm-abstraction/src/lib/providers/anthropic.provider.ts`  | Langchain Anthropic — redundant  |
| `libs/backend/llm-abstraction/src/lib/providers/openrouter.provider.ts` | Langchain OpenRouter — redundant |
| `libs/backend/llm-abstraction/src/anthropic.ts`                         | Secondary entry point            |
| `libs/backend/llm-abstraction/src/openrouter.ts`                        | Secondary entry point            |

### Files to Rewrite (native SDK)

| File                                                                      | Change                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/providers/google-genai.provider.ts` | Replace `ChatGoogleGenerativeAI` (Langchain) → `GoogleGenAI` from `@google/genai` |
| `libs/backend/llm-abstraction/src/lib/providers/openai.provider.ts`       | Replace `ChatOpenAI` (Langchain) → `OpenAI` from `openai`                         |
| `libs/backend/llm-abstraction/src/lib/providers/base-llm.provider.ts`     | Remove Langchain base class deps if any                                           |

### Files to Update (type/registry cleanup)

| File                                | Change                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `provider-types.ts`                 | Remove `'anthropic'`, `'openrouter'` from `LlmProviderName`. Keep: `'google-genai' \| 'openai' \| 'vscode-lm'` |
| `provider-import-map.ts`            | Remove anthropic/openrouter entries, update factory types                                                      |
| `llm-secrets.service.ts`            | Remove anthropic/openrouter from `API_KEY_PROVIDERS` and validation                                            |
| `llm-rpc-handlers.ts` (vscode-core) | Update local `LlmProviderName` type                                                                            |
| `llm-namespace.builder.ts`          | Remove `anthropic`/`openrouter` namespaces                                                                     |
| `tsconfig.base.json`                | Remove `@ptah-extension/llm-abstraction/anthropic` and `/openrouter` path aliases                              |
| `src/index.ts` (llm-abstraction)    | Update comments/exports                                                                                        |

---

## Phase 2: Rewrite Google Provider with `@google/genai`

### Google GenAI Provider (Text + Image)

Replace `ChatGoogleGenerativeAI` with `GoogleGenAI` from `@google/genai`:

```typescript
import { GoogleGenAI, Modality } from '@google/genai';

export class GoogleGenAIProvider extends BaseLlmProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string, modelName: string) {
    super();
    this.ai = new GoogleGenAI({ apiKey });
  }

  // Text chat
  async getCompletion(systemPrompt: string, userPrompt: string): Promise<Result<string, Error>> {
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: userPrompt,
      config: { systemInstruction: systemPrompt },
    });
    return Result.ok(response.text);
  }

  // Image generation (NEW)
  async generateImage(prompt: string, options?: ImageGenOptions): Promise<Result<ImageGenResult, Error>> {
    if (options?.model?.startsWith('imagen-')) {
      // Imagen 4 dedicated API
      return this.generateWithImagen(prompt, options);
    }
    // Gemini native (Nano Banana)
    return this.generateWithGeminiNative(prompt, options);
  }

  // Structured output via Gemini JSON mode
  async getStructuredCompletion<T>(prompt, schema): Promise<Result<T, Error>> {
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });
    return Result.ok(JSON.parse(response.text));
  }
}
```

### Image Generation Models

| Model                                          | API Method                                              | Best For                           |
| ---------------------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `gemini-2.5-flash-image` (Nano Banana)         | `generateContent` + `responseModalities: [TEXT, IMAGE]` | Fast, conversational image editing |
| `gemini-3-pro-image-preview` (Nano Banana Pro) | Same                                                    | High quality                       |
| `imagen-4.0-fast-generate-001`                 | `generateImages`                                        | Cheapest ($0.02/img)               |
| `imagen-4.0-generate-001`                      | `generateImages`                                        | Best balance ($0.04/img)           |
| `imagen-4.0-ultra-generate-001`                | `generateImages`                                        | Max photorealism ($0.06/img)       |

### Updated Default Models

```typescript
export const DEFAULT_MODELS = {
  'google-genai': 'gemini-2.5-flash', // was gemini-1.5-pro
  openai: 'gpt-4o', // unchanged
  'vscode-lm': 'copilot/gpt-4o', // unchanged
};
```

---

## Phase 3: Rewrite OpenAI Provider with Native `openai` SDK

Replace `ChatOpenAI` (Langchain) with the native `openai` package:

```typescript
import OpenAI from 'openai';

export class OpenAIProvider extends BaseLlmProvider {
  private client: OpenAI;

  constructor(apiKey: string, modelName: string) {
    super();
    this.client = new OpenAI({ apiKey });
  }

  async getCompletion(systemPrompt: string, userPrompt: string): Promise<Result<string, Error>> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return Result.ok(response.choices[0].message.content);
  }

  // Structured output via OpenAI JSON mode
  async getStructuredCompletion<T>(prompt, schema): Promise<Result<T, Error>> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: schema },
    });
    return Result.ok(JSON.parse(response.choices[0].message.content));
  }
}
```

### OpenAI Auth: API Key vs Codex Subscription (Phase 5)

The `OpenAI` client supports both:

- **API key**: `new OpenAI({ apiKey: 'sk-...' })` — pay-per-token
- **Bearer token**: `new OpenAI({ apiKey: '<access_token>', baseURL: '<codex_backend>' })` — subscription via OAuth

This mirrors exactly how the Agent SDK's `AuthManager` handles Anthropic auth (API key vs OAuth token vs provider key).

---

## Phase 4: Fix Wizard Hardcoded Model

### Problem

`VsCodeLmService` hardcodes `{ family: 'gpt-4o' }`:

```typescript
// libs/backend/agent-generation/src/lib/services/vscode-lm.service.ts line 95
this.provider = new VsCodeLmProvider({ family: 'gpt-4o' });
```

### Fix

Inject `LlmConfigurationService` to read the user's configured default:

```typescript
constructor(
  @inject(TOKENS.LLM_CONFIGURATION_SERVICE) private configService: LlmConfigurationService,
  // ... existing deps
) {}

async initialize(): Promise<Result<void, Error>> {
  const defaultModel = this.configService.getDefaultModel('vscode-lm');
  const family = defaultModel.split('/')[1] || defaultModel;
  this.provider = new VsCodeLmProvider({ family });
}
```

### Files to Modify

| File                                                                  | Change                           |
| --------------------------------------------------------------------- | -------------------------------- |
| `libs/backend/agent-generation/src/lib/services/vscode-lm.service.ts` | Inject config, use dynamic model |
| `apps/ptah-extension-vscode/src/di/container.ts`                      | Ensure DI wiring                 |

---

## Phase 5: Subscription-Based Auth (OAuth) for MCP Providers

### Inspiration: OpenCode's Auth Plugin Pattern

OpenCode lets users authenticate with their **existing subscriptions** instead of API keys by:

1. Running OAuth 2.0 + PKCE flow via local callback server
2. Storing tokens in a local auth store
3. Intercepting API requests to rewrite base URL + inject Bearer tokens

### Implementation for Ptah

Add OAuth as an **alternative auth method** alongside BYOK API keys for MCP providers.

#### OpenAI Codex Subscription Auth

Mirrors OpenAI's official Codex CLI OAuth flow:

- **What it uses**: User's ChatGPT Plus ($20/mo) or Pro ($200/mo) subscription
- **OAuth flow**: PKCE via browser → local callback server → token exchange
- **Request rewrite**: Standard `api.openai.com` → Codex backend endpoint
- **Token storage**: VS Code SecretStorage (encrypted, same as existing keys)

#### Google Gemini Subscription Auth

Mirrors Google's official Gemini CLI OAuth flow:

- **What it uses**: User's Google account (Free/Pro/Ultra tier)
- **OAuth flow**: Standard Google OAuth 2.0 via browser → local callback
- **Endpoint**: Google Cloud Code Assist endpoints
- **Token storage**: VS Code SecretStorage

### MCP Provider Auth Registry

Create a new registry (mirroring `anthropic-provider-registry.ts`):

**New file**: `libs/backend/llm-abstraction/src/lib/registry/mcp-provider-auth-registry.ts`

```typescript
export interface McpProviderAuth {
  id: string; // 'google-genai', 'openai'
  name: string; // 'Google Gemini', 'OpenAI'
  authMethods: AuthMethod[]; // ['apiKey', 'oauth'] or ['apiKey']
  oauthConfig?: {
    authorizationUrl: string;
    tokenUrl: string;
    clientId: string;
    scopes: string[];
    callbackPort: number;
    usePKCE: boolean;
  };
  apiKeyConfig: {
    keyPrefix: string; // 'sk-' for OpenAI, '' for Google
    helpUrl: string;
    placeholder: string;
  };
}
```

### Auth Priority (per provider)

1. OAuth token (subscription) — if configured
2. API key (BYOK) — if configured
3. Not available

### Files to Create

| File                                                                          | Purpose                       |
| ----------------------------------------------------------------------------- | ----------------------------- |
| `libs/backend/llm-abstraction/src/lib/registry/mcp-provider-auth-registry.ts` | Provider auth definitions     |
| `libs/backend/llm-abstraction/src/lib/services/oauth-flow.service.ts`         | OAuth 2.0 + PKCE flow handler |

### Files to Modify

| File                                     | Change                                        |
| ---------------------------------------- | --------------------------------------------- |
| `llm-secrets.service.ts`                 | Add OAuth token storage alongside API keys    |
| `llm-rpc-handlers.ts`                    | Add RPC methods for OAuth initiation/callback |
| `libs/shared/src/lib/types/rpc.types.ts` | Add OAuth-related RPC types                   |

---

## Phase 6: Settings UI for LLM Provider Management

### New Component: `LlmProvidersConfigComponent`

**Location**: `libs/frontend/chat/src/lib/settings/llm-providers-config.component.ts`

**UI Layout**:

```
┌───────────────────────────────────────────────────────┐
│  AI Providers (MCP Tools Layer)                        │
│  Configure providers for image generation & delegation │
│                                                        │
│  ┌────────────────────────────────────────────────────┐│
│  │ Google Gemini                       [Configured ✓] ││
│  │                                                    ││
│  │ Auth: ○ API Key  ● Google Account (OAuth)          ││
│  │ [Connected as user@gmail.com]  [Disconnect]        ││
│  │                                                    ││
│  │ Text Model: gemini-2.5-flash                       ││
│  │ Image Model: gemini-2.5-flash-image (Nano Banana)  ││
│  │ Capabilities: ✓ Text Chat  ✓ Image Generation      ││
│  └────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────┐│
│  │ OpenAI                          [Not Configured]   ││
│  │                                                    ││
│  │ Auth: ● API Key  ○ Codex Subscription (OAuth)      ││
│  │ API Key: [sk-...                    ] [Save]       ││
│  │                                                    ││
│  │ Text Model: gpt-4o                                 ││
│  │ Capabilities: ✓ Text Chat                          ││
│  └────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────┐│
│  │ VS Code Language Model              [Available ✓]  ││
│  │ No API key needed — uses Copilot subscription      ││
│  │ Models: copilot/gpt-4o, copilot/gpt-4o-mini       ││
│  └────────────────────────────────────────────────────┘│
│                                                        │
│  Default Provider: [Google Gemini ▼]                   │
└───────────────────────────────────────────────────────┘
```

### RPC Calls

| RPC Method               | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| `llm:getProviderStatus`  | Load initial state                        |
| `llm:setApiKey`          | Store API key                             |
| `llm:removeApiKey`       | Remove API key                            |
| `llm:initiateOAuth`      | **NEW** — Start OAuth flow for a provider |
| `llm:getOAuthStatus`     | **NEW** — Check if OAuth token exists     |
| `llm:disconnectOAuth`    | **NEW** — Remove OAuth token              |
| `llm:setDefaultProvider` | **NEW** — Set default MCP provider        |

### Frontend State: `LlmProviderStateService`

**Location**: `libs/frontend/core/src/lib/services/llm-provider-state.service.ts`

```typescript
readonly providers = signal<LlmProviderStatus[]>([]);
readonly defaultProvider = signal<string>('vscode-lm');
```

### Files to Create

| File                                                                      | Purpose       |
| ------------------------------------------------------------------------- | ------------- |
| `libs/frontend/chat/src/lib/settings/llm-providers-config.component.ts`   | Settings UI   |
| `libs/frontend/chat/src/lib/settings/llm-providers-config.component.html` | Template      |
| `libs/frontend/core/src/lib/services/llm-provider-state.service.ts`       | State service |

### Files to Modify

| File                                     | Change                                    |
| ---------------------------------------- | ----------------------------------------- |
| `settings.component.ts/html`             | Include new `<ptah-llm-providers-config>` |
| `libs/shared/src/lib/types/rpc.types.ts` | Add new RPC types                         |

---

## Phase 7: `ptah_generate_image` MCP Tool + `ptah.image` Namespace

### New MCP Tool (#10)

```json
{
  "name": "ptah_generate_image",
  "description": "Generate images using Google Gemini (Nano Banana) or Imagen models.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": { "type": "string" },
      "model": { "type": "string", "default": "gemini-2.5-flash-image" },
      "aspectRatio": { "type": "string", "default": "1:1" },
      "numberOfImages": { "type": "number", "default": 1 }
    },
    "required": ["prompt"]
  }
}
```

### `ptah.image` Namespace (16th)

```typescript
ptah.image.generate(prompt, options?)   // Generate image(s)
ptah.image.listModels()                  // Available image models
ptah.image.isAvailable()                 // Check if Google key/OAuth configured
```

### Implementation Flow

1. Check Google auth (OAuth token or API key from SecretStorage)
2. Create `GoogleGenAI` instance with credentials
3. Route: `gemini-*` → `generateContent` with image modalities, `imagen-*` → `generateImages`
4. Save base64 images to `.ptah/generated-images/{timestamp}-{index}.png`
5. Return file paths in tool result

### Files to Create

| File                                                                             | Purpose                  |
| -------------------------------------------------------------------------------- | ------------------------ |
| `libs/backend/vscode-lm-tools/.../services/image-generation.service.ts`          | Image generation service |
| `libs/backend/vscode-lm-tools/.../namespace-builders/image-namespace.builder.ts` | `ptah.image` namespace   |

### Files to Modify

| File                          | Change                           |
| ----------------------------- | -------------------------------- |
| `tool-description.builder.ts` | Add `ptah_generate_image` schema |
| `protocol-handlers.ts`        | Add tool handler routing         |
| `ptah-api-builder.service.ts` | Add `ptah.image` namespace (#16) |

---

## Phase 8: Intelligent MCP Provider Routing

### Smart `ptah.llm.chat()` with Fallback

Update the LLM namespace builder to add intelligent fallback:

```
User requests chat → check specified provider
  → if available, use it
  → if not, try default provider
  → if not, try vscode-lm (always available)
  → if all fail, return error with setup instructions
```

### MCP-Level Task Delegation

The main Claude agent (via Agent SDK) can delegate tasks to MCP providers:

```
Claude Code (main agent, via Agent SDK)
  ├── "Generate an image" → ptah_generate_image → Google Gemini
  ├── "Analyze this with GPT" → ptah.llm.openai.chat() → OpenAI (API or Codex sub)
  ├── "Quick analysis" → ptah.llm.vscodeLm.chat() → Copilot models
  └── "Use Gemini for this" → ptah.llm.google.chat() → Google Gemini
```

---

## Summary: Package Changes

### Remove (6 packages)

```
@langchain/anthropic
@langchain/google-genai
@langchain/openai
@langchain/core
langchain
```

### Add (2 packages)

```
@google/genai     ^1.41.0   (Google Gemini text + image)
openai            ^4.x      (OpenAI native SDK)
```

---

## Summary: Provider Architecture After Migration

### Agent SDK Layer (Main Claude Agent — unchanged)

| Auth Method  | Provider                     | Purpose                      |
| ------------ | ---------------------------- | ---------------------------- |
| OAuth token  | Anthropic (direct)           | Claude Max/Pro subscription  |
| API key      | Anthropic (direct)           | Pay-per-token                |
| Provider key | OpenRouter / Moonshot / Z.AI | Anthropic-compatible routing |

### MCP Tool Layer (Secondary Providers — new)

| Provider      | SDK             | Auth Options                        | Capabilities                |
| ------------- | --------------- | ----------------------------------- | --------------------------- |
| Google Gemini | `@google/genai` | API key, Google OAuth               | Text chat, Image generation |
| OpenAI        | `openai`        | API key, Codex OAuth (subscription) | Text chat                   |
| VS Code LM    | VS Code API     | None needed (Copilot)               | Text chat                   |

---

## Implementation Order

1. **Phase 1** — Remove all Langchain packages (clean slate)
2. **Phase 2** — Rewrite Google provider with `@google/genai` (text + image)
3. **Phase 3** — Rewrite OpenAI provider with native `openai` SDK
4. **Phase 4** — Fix wizard hardcoded model (quick win)
5. **Phase 6** — Settings UI for API key management (BYOK first)
6. **Phase 7** — Image generation MCP tool
7. **Phase 5** — OAuth subscription auth (enhancement on top of BYOK)
8. **Phase 8** — Intelligent MCP routing (polish)

---

## Open Questions

1. **OAuth scope**: Should we implement OpenAI Codex OAuth right away, or ship BYOK first and add OAuth as a follow-up? (Recommend: BYOK first, OAuth follow-up)
2. **Ethical consideration**: OpenAI Codex OAuth uses the same flow as their official CLI. Is this acceptable for a third-party extension? (Note: Anthropic blocked this for Claude Max)
3. **Image storage**: Workspace `.ptah/generated-images/` or OS temp dir?
4. **OpenAI DALL-E**: Add to `ptah_generate_image` alongside Google? (Recommend: Google-only first, DALL-E later)

---

## Reference: OpenCode's OAuth Implementation

For future OAuth work, OpenCode's patterns are documented in our research:

### OpenAI Codex OAuth Flow

- OAuth 2.0 + PKCE via local callback server (port 1455)
- Browser → ChatGPT auth → code exchange → token storage
- Request interception: rewrites `api.openai.com` → Codex backend
- Plugin: `opencode-openai-codex-auth`

### Google Gemini OAuth Flow

- Standard Google OAuth 2.0 via browser
- Mirrors official Gemini CLI flow (Code Assist endpoints)
- Works with Free/Pro/Ultra Google account tiers
- Plugin: `opencode-gemini-auth`
