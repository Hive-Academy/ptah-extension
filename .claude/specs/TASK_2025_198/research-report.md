# Research Report: OpenCode Copilot Integration Analysis

## Executive Summary

**Research Goal**: Understand how OpenCode (github.com/sst/opencode) handles GitHub Copilot proxy integration to fix two bugs in Ptah's Copilot proxy:

1. `claude-opus-4.6-fast` returns "model not supported" from Copilot API
2. `gpt-5.4` via `/responses` returns "Missing required parameter: 'tools[0].name'"

**Key Finding**: Both bugs stem from differences between how OpenCode and Ptah handle the Copilot proxy. OpenCode uses a fundamentally different architecture (AI SDK provider pattern) while Ptah uses an Anthropic-to-OpenAI translation proxy. The two bugs have clear, fixable root causes identified below.

---

## 1. How OpenCode Fetches and Filters Available Models

OpenCode does NOT fetch models from the Copilot `/models` API endpoint at runtime. Instead:

- Models come from **models.dev** (`https://models.dev/api.json`), an external model registry that provides metadata for all providers including `github-copilot`.
- The models.dev database is fetched once, cached locally, and refreshed hourly.
- Model metadata includes: capabilities, context limits, cost, tool support, reasoning support, and a critical `api` field that specifies the npm package and model API ID.
- There is no runtime model filtering from the Copilot API. The model list is static from models.dev.

**Implication for Ptah**: Our `listModels()` approach of fetching from `/models` is fine but we need to be careful about which model IDs we actually send to the Copilot API versus what we display to users.

---

## 2. How OpenCode Decides Chat Completions vs Responses API

OpenCode has a simple, critical function:

```typescript
function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID);
  if (!match) return false;
  return Number(match[1]) >= 5 && !modelID.startsWith('gpt-5-mini');
}
```

**Rules**:

- Only models starting with `gpt-` followed by a version number >= 5 use the Responses API
- `gpt-5-mini` is explicitly excluded (uses Chat Completions)
- ALL non-GPT models (Claude, Gemini, etc.) use Chat Completions
- ALL GPT-4 and below use Chat Completions

The routing happens in the custom loader:

```typescript
"github-copilot": async () => ({
  autoload: false,
  async getModel(sdk, modelID) {
    return shouldUseCopilotResponsesApi(modelID)
      ? sdk.responses(modelID)
      : sdk.chat(modelID);
  },
  options: {},
})
```

**Ptah's implementation matches this logic** (same regex in `TranslationProxyBase.shouldUseResponsesApi`). This is correct.

---

## 3. How OpenCode Translates Anthropic Requests to OpenAI Format (Tool Definitions)

This is where Bug #2's root cause lies.

### Chat Completions tools format (used for non-GPT-5+ models):

OpenCode wraps tools in the standard Chat Completions format:

```typescript
{
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }
}
```

### Responses API tools format (used for GPT-5+ models):

OpenCode uses a DIFFERENT format for the Responses API. From `openai-responses-prepare-tools.ts`:

```typescript
{
  type: "function",
  name: tool.name,           // <-- NAME IS AT TOP LEVEL, NOT NESTED
  description: tool.description,
  parameters: tool.inputSchema,
  strict: strictJsonSchema,
}
```

**CRITICAL DIFFERENCE**: In the Responses API, the `name` field is at the top level of the tool object, NOT nested inside a `function` property. The Responses API tool format is:

```json
{
  "type": "function",
  "name": "tool_name",
  "description": "...",
  "parameters": { ... }
}
```

While Chat Completions format is:

```json
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "...",
    "parameters": { ... }
  }
}
```

**This is the root cause of Bug #2.** Ptah's `responses-request-translator.ts` reuses `translateTools()` from `request-translator.ts`, which outputs the Chat Completions nested format (`{ type: "function", function: { name, description, parameters } }`). But the Responses API expects the flat format (`{ type: "function", name, description, parameters }`).

The error "Missing required parameter: 'tools[0].name'" occurs because the Responses API is looking for `tools[0].name` at the top level, but our translation puts it at `tools[0].function.name`.

---

## 4. Model ID Handling - Suffixes Like `-fast`

**OpenCode does NOT strip any suffixes like `-fast` from model IDs.** There is no code anywhere in the OpenCode codebase that manipulates model IDs by removing suffixes.

Model IDs are passed through as-is from the models.dev registry to the Copilot API. The models.dev registry provides the exact model IDs that the Copilot API accepts.

**This means `claude-opus-4.6-fast` is likely NOT a valid model ID for the Copilot API.** The valid Copilot model IDs from models.dev would be something like `claude-opus-4.6` (without the `-fast` suffix). The `-fast` suffix is likely a Ptah-internal concept or a user-facing label, not an actual Copilot API model ID.

**Root cause of Bug #1**: The model ID `claude-opus-4.6-fast` is being sent directly to the Copilot API, but the Copilot API does not recognize this model ID. We need to either:

- Strip the `-fast` suffix before sending to Copilot
- Map it to the correct Copilot model ID
- Only present valid Copilot model IDs to the user

---

## 5. Headers Sent to the Copilot API

OpenCode's Copilot provider is created via `createOpenaiCompatible()` which sets these headers:

```typescript
const headers = {
  Authorization: `Bearer ${options.apiKey}`, // Copilot bearer token
  ...options.headers, // Any additional headers from config
};
// Plus user-agent suffix: "ai-sdk/openai-compatible/0.1.0"
```

**Ptah's headers** (from `copilot-auth.service.ts`):

```typescript
{
  Authorization: `Bearer ${state.bearerToken}`,
  'Content-Type': 'application/json',
  'Openai-Intent': 'conversation-edits',
  'User-Agent': `ptah-extension/${version}`,
  'Editor-Version': `vscode/${vscode.version}`,
  'Editor-Plugin-Version': `ptah/${version}`,
  'Copilot-Integration-Id': 'vscode-chat',
  'x-initiator': 'user',
}
```

**Ptah sends MORE headers than OpenCode.** OpenCode only sends `Authorization` and a user-agent. The additional Copilot-specific headers (`Openai-Intent`, `Copilot-Integration-Id`, etc.) that Ptah sends are actually good practice and should help with Copilot API compatibility. These are not causing the bugs.

---

## 6. Responses API Request Format in Detail

OpenCode's Responses API request structure (from `openai-responses-language-model.ts`):

```typescript
{
  model: modelId,               // Passed as-is, no transformation
  input: [...],                 // Array of input items (messages, function calls, etc.)
  temperature: ...,
  top_p: ...,
  max_output_tokens: ...,
  tools: [                      // FLAT format tools
    {
      type: "function",
      name: "tool_name",        // TOP-LEVEL name
      description: "...",
      parameters: { ... },
      strict: true/false,
    }
  ],
  tool_choice: ...,
  stream: true/false,
  store: false,                 // For copilot/openai providers
  // ... other optional fields
}
```

Ptah's current Responses API request (from `responses-request-translator.ts`):

```typescript
{
  model: prefixedModel,
  input: [...],
  max_output_tokens: ...,
  stream: true/false,
  tools: [                      // NESTED format (BUG!)
    {
      type: "function",
      function: {               // <-- This nesting is WRONG for Responses API
        name: "tool_name",
        description: "...",
        parameters: { ... },
      }
    }
  ],
}
```

---

## Fix Recommendations

### Bug #1: `claude-opus-4.6-fast` "model not supported"

**Root Cause**: Invalid model ID sent to Copilot API. The `-fast` suffix is not recognized.

**Fix Options**:

1. Ensure the model list shown to users only contains model IDs that the Copilot `/models` API returns as valid.
2. If `-fast` is a Ptah concept, strip it before forwarding to the Copilot API.
3. Check where the model ID `claude-opus-4.6-fast` originates in the Ptah codebase and correct it.

### Bug #2: `gpt-5.4` "Missing required parameter: 'tools[0].name'"

**Root Cause**: Wrong tool definition format for Responses API. Tools are wrapped in Chat Completions nested format instead of Responses API flat format.

**Fix**: Create a separate `translateToolsForResponses()` function in `responses-request-translator.ts`:

```typescript
function translateToolsForResponses(tools: AnthropicToolDefinition[]): ResponsesToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    ...(tool.description != null ? { description: tool.description } : {}),
    ...(tool.input_schema != null ? { parameters: tool.input_schema } : {}),
  }));
}
```

And update the `OpenAIResponsesRequest` interface to use the correct tool type:

```typescript
interface ResponsesToolDefinition {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface OpenAIResponsesRequest {
  // ...
  tools?: ResponsesToolDefinition[]; // NOT OpenAIToolDefinition[]
}
```

---

## Source Files Analyzed

### OpenCode Repository (sst/opencode, dev branch)

1. `packages/opencode/src/provider/provider.ts` - Provider loading, SDK creation, `shouldUseCopilotResponsesApi()`
2. `packages/opencode/src/provider/models.ts` - models.dev integration for model metadata
3. `packages/opencode/src/provider/transform.ts` - Message/temperature/option transforms per provider
4. `packages/opencode/src/provider/sdk/copilot/copilot-provider.ts` - Copilot SDK factory (`createOpenaiCompatible()`)
5. `packages/opencode/src/provider/sdk/copilot/responses/openai-responses-prepare-tools.ts` - **KEY FILE**: Flat tool format for Responses API
6. `packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts` - Request construction for Responses API
7. `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-prepare-tools.ts` - Nested tool format for Chat Completions

### Ptah Files Analyzed

1. `libs/backend/agent-sdk/src/lib/openai-translation/translation-proxy-base.ts` - Proxy routing logic
2. `libs/backend/agent-sdk/src/lib/openai-translation/responses-request-translator.ts` - Responses API request translation (has bug)
3. `libs/backend/agent-sdk/src/lib/openai-translation/responses-stream-translator.ts` - Responses API stream translation
4. `libs/backend/agent-sdk/src/lib/openai-translation/request-translator.ts` - Chat Completions request translation (reused incorrectly for Responses)
5. `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-translation-proxy.ts` - Copilot proxy subclass
6. `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts` - Auth and headers
