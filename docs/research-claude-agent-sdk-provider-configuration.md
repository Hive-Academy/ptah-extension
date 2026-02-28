# Research Report: Claude Agent SDK Custom Provider Configuration

## Executive Summary

**SDK Package**: `@anthropic-ai/claude-agent-sdk` v0.2.42 (claudeCodeVersion: 2.1.42)
**Research Date**: 2026-02-28
**Confidence Level**: 95% (based on local SDK source analysis, official docs, and web sources)

**Key Finding**: The Claude Agent SDK **fully supports** custom API providers and base URLs through environment variables passed via the `env` option in the `query()` function. Each SDK instance can be independently configured with different API keys, base URLs, and model selections. This is NOT officially supported by Anthropic for non-Anthropic models, but it works technically and the Ptah extension already implements this pattern.

---

## 1. Custom Provider Support

### Does the SDK support custom API providers/base URLs?

**YES** - through environment variables, not through direct programmatic options.

The SDK's `query()` function accepts an `env` option that passes environment variables to the spawned Claude Code process. This is the mechanism for pointing the SDK at non-Anthropic endpoints.

**From the SDK type definitions** (`sdk.d.ts`, lines 532-545):

```typescript
/**
 * Environment variables to pass to the Claude Code process.
 * Defaults to `process.env`.
 */
env?: {
    [envVar: string]: string | undefined;
};
```

**Critical insight**: The SDK does NOT have a `baseUrl` or `apiKey` programmatic option. All provider configuration flows through environment variables.

### How custom providers work technically

The SDK spawns a Claude Code subprocess. That subprocess reads environment variables to determine:

1. Which API endpoint to call (`ANTHROPIC_BASE_URL`)
2. How to authenticate (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `CLAUDE_CODE_OAUTH_TOKEN`)
3. Which models to use (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`)

### Anthropic's official position

Per GitHub issue #5577, Anthropic collaborator (ant-kurt) stated:

> "Currently, using Claude Code with non-Anthropic models is unsupported."

However, the `ANTHROPIC_BASE_URL` is documented for "LLM gateway" usage (proxying through your own infrastructure), and providers like OpenRouter, Moonshot, and Z.AI have confirmed working integrations.

### Officially supported third-party providers

| Provider                | Env Var                     | Configuration       |
| ----------------------- | --------------------------- | ------------------- |
| AWS Bedrock             | `CLAUDE_CODE_USE_BEDROCK=1` | + AWS credentials   |
| Google Vertex AI        | `CLAUDE_CODE_USE_VERTEX=1`  | + GCP credentials   |
| Microsoft Azure Foundry | `CLAUDE_CODE_USE_FOUNDRY=1` | + Azure credentials |

### Community-proven Anthropic-compatible providers

| Provider        | Base URL                             | Auth Method                     |
| --------------- | ------------------------------------ | ------------------------------- |
| OpenRouter      | `https://openrouter.ai/api`          | `ANTHROPIC_AUTH_TOKEN` (Bearer) |
| Moonshot (Kimi) | `https://api.moonshot.ai/anthropic/` | `ANTHROPIC_AUTH_TOKEN` (Bearer) |
| Z.AI (GLM)      | `https://api.z.ai/api/anthropic`     | `ANTHROPIC_AUTH_TOKEN` (Bearer) |
| LiteLLM proxy   | `http://localhost:4000`              | `ANTHROPIC_API_KEY`             |
| Ollama          | `http://localhost:11434`             | `ANTHROPIC_API_KEY` (any value) |

---

## 2. Configuration Isolation (Per-Instance Configuration)

### Can you run multiple SDK instances with different configurations?

**YES** - Each `query()` call is independent and spawns its own Claude Code subprocess.

The `env` option on each `query()` call completely controls the environment for that specific invocation. You can run simultaneous queries with different providers:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Instance 1: Anthropic direct
const q1 = query({
  prompt: 'Hello',
  options: {
    env: {
      ANTHROPIC_API_KEY: 'sk-ant-api03-...',
      // No ANTHROPIC_BASE_URL = uses api.anthropic.com
    },
  },
});

// Instance 2: OpenRouter
const q2 = query({
  prompt: 'Hello',
  options: {
    model: 'anthropic/claude-sonnet-4',
    env: {
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: 'sk-or-v1-...',
      ANTHROPIC_API_KEY: '', // Must be empty to prevent conflicts
    },
  },
});

// Instance 3: Moonshot Kimi K2
const q3 = query({
  prompt: 'Hello',
  options: {
    model: 'sonnet', // alias - mapped by ANTHROPIC_DEFAULT_SONNET_MODEL
    env: {
      ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic/',
      ANTHROPIC_AUTH_TOKEN: '<moonshot-key>',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2',
    },
  },
});
```

### Per-session model selection

The `model` option on `Options` accepts a string:

```typescript
model?: string;  // e.g., 'claude-sonnet-4-5-20250929', 'sonnet', 'opus'
```

And the `Query` object has a runtime `setModel()` method:

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  setModel(model?: string): Promise<void>;
  // ...
}
```

### Fallback model support

```typescript
fallbackModel?: string;  // Model to use if primary fails
```

---

## 3. Environment Variables (Complete Reference)

### Authentication

| Variable                          | Purpose                            | Usage                      |
| --------------------------------- | ---------------------------------- | -------------------------- |
| `ANTHROPIC_API_KEY`               | Primary API key (x-api-key header) | Anthropic direct, LiteLLM  |
| `ANTHROPIC_AUTH_TOKEN`            | Bearer token authentication        | OpenRouter, Moonshot, Z.AI |
| `CLAUDE_CODE_OAUTH_TOKEN`         | OAuth token (subscription mode)    | Claude Max/Pro subscribers |
| `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` | Auto-renewing OAuth                | Subscription               |
| `ANTHROPIC_FOUNDRY_API_KEY`       | Azure Foundry key                  | Azure AI Foundry           |

### Endpoint Configuration

| Variable                                          | Purpose                | Default                     |
| ------------------------------------------------- | ---------------------- | --------------------------- |
| `ANTHROPIC_BASE_URL`                              | Custom API endpoint    | `https://api.anthropic.com` |
| `BEDROCK_BASE_URL` / `ANTHROPIC_BEDROCK_BASE_URL` | Bedrock endpoint       | AWS default                 |
| `VERTEX_BASE_URL`                                 | Vertex AI endpoint     | GCP default                 |
| `ANTHROPIC_FOUNDRY_BASE_URL`                      | Azure Foundry endpoint | Azure default               |

### Provider Selection

| Variable                  | Purpose                | Value |
| ------------------------- | ---------------------- | ----- |
| `CLAUDE_CODE_USE_BEDROCK` | Route to AWS Bedrock   | `1`   |
| `CLAUDE_CODE_USE_VERTEX`  | Route to Google Vertex | `1`   |
| `CLAUDE_CODE_USE_FOUNDRY` | Route to Azure Foundry | `1`   |

### Model Configuration

| Variable                         | Purpose                | Example                           |
| -------------------------------- | ---------------------- | --------------------------------- |
| `ANTHROPIC_MODEL`                | Override default model | `claude-opus-4-6`                 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | Map 'opus' alias       | `us.anthropic.claude-opus-4-6-v1` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Map 'sonnet' alias     | `claude-sonnet-4-6`               |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | Map 'haiku' alias      | `claude-haiku-3-5`                |
| `CLAUDE_CODE_SUBAGENT_MODEL`     | Model for subagents    | Any model ID                      |

### Behavior Configuration

| Variable                                | Purpose                      | Default     |
| --------------------------------------- | ---------------------------- | ----------- |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`         | Max response length          | SDK default |
| `MAX_THINKING_TOKENS`                   | Thinking budget (deprecated) | SDK default |
| `CLAUDE_CODE_EFFORT_LEVEL`              | Reasoning effort             | `high`      |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | Disable adaptive thinking    | `0`         |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT`        | Disable extended context     | `0`         |
| `API_TIMEOUT_MS`                        | Request timeout              | `600000`    |
| `ANTHROPIC_CUSTOM_HEADERS`              | Custom HTTP headers          | None        |
| `ANTHROPIC_BETAS`                       | Beta feature headers         | None        |
| `DISABLE_PROMPT_CACHING`                | Disable caching              | `0`         |

### Telemetry

| Variable                                   | Purpose           |
| ------------------------------------------ | ----------------- |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disable telemetry |

---

## 4. Programmatic Configuration Options

### Full `Options` interface (from SDK v0.2.42)

The `query()` function accepts these provider-relevant options:

```typescript
interface Options {
  // MODEL SELECTION
  model?: string; // Model ID or alias ('sonnet', 'opus', 'haiku')
  fallbackModel?: string; // Fallback if primary fails

  // ENVIRONMENT (provider config flows through here)
  env?: Record<string, string | undefined>; // Defaults to process.env

  // SETTINGS FILES (can contain provider config)
  settingSources?: ('user' | 'project' | 'local')[]; // Load from filesystem

  // PROCESS CONTROL
  executable?: 'bun' | 'deno' | 'node'; // JS runtime
  pathToClaudeCodeExecutable?: string; // Custom executable path
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess; // Custom spawn

  // THINKING/EFFORT
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' };
  effort?: 'low' | 'medium' | 'high' | 'max';

  // BUDGET
  maxBudgetUsd?: number;
  maxTurns?: number;

  // ... other options (tools, permissions, hooks, MCP, etc.)
}
```

### What you CANNOT configure programmatically

There is **no** direct programmatic option for:

- `apiKey` - Must go through `env.ANTHROPIC_API_KEY`
- `baseUrl` - Must go through `env.ANTHROPIC_BASE_URL`
- `provider` - Must go through `env.CLAUDE_CODE_USE_BEDROCK` etc.

Everything flows through the `env` dictionary.

### Settings file configuration

The SDK can also read provider config from settings files (when `settingSources` is set):

```json
// ~/.claude/settings.json (user) or .claude/settings.local.json (local)
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-..."
  },
  "model": "opus",
  "apiKeyHelper": "command-that-returns-api-key"
}
```

The `apiKeyHelper` field is a shell command that outputs an API key, useful for rotating credentials.

---

## 5. Ptah Extension's Current Implementation

The Ptah extension already implements multi-provider support using the exact patterns described above.

### Architecture

```
AuthManager (auth-manager.ts)
  |
  |--> Provider Registry (anthropic-provider-registry.ts)
  |      Defines: OpenRouter, Moonshot (Kimi), Z.AI (GLM)
  |
  |--> Sets process.env variables:
  |      ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.
  |
  v
SdkQueryOptionsBuilder (sdk-query-options-builder.ts)
  |
  |--> Passes env: process.env to SDK query()
  |--> Sets model from session config
  |--> Adds identity clarification for third-party models
  |
  v
SDK query() call with per-session config
```

### Key pattern: Environment mutation + passthrough

```typescript
// From sdk-query-options-builder.ts, line 358:
env: process.env as Record<string, string | undefined>,
```

The current implementation mutates `process.env` globally via `AuthManager.configureAuthentication()`, then passes the entire `process.env` to the SDK. This means:

- Provider switching is global (affects all sessions)
- The "Clean Slate" pattern ensures no stale variables leak between configurations

### Per-instance isolation (how to improve)

Instead of mutating global `process.env`, each query could construct an isolated env:

```typescript
// Better: per-session env construction
const sessionEnv: Record<string, string | undefined> = {
  ...process.env, // Base from OS
  ANTHROPIC_BASE_URL: providerBaseUrl, // Provider-specific
  ANTHROPIC_AUTH_TOKEN: providerApiKey, // Provider-specific
  ANTHROPIC_DEFAULT_SONNET_MODEL: modelId, // Model mapping
};

const config = {
  prompt: userMessageStream,
  options: {
    model: 'sonnet',
    env: sessionEnv, // Isolated per-session
  },
};
```

---

## 6. Limitations and Caveats

### Known limitations

1. **No native multi-provider**: The SDK has no concept of "providers" - it just reads env vars for Anthropic API calls. All routing through non-Anthropic endpoints relies on those endpoints being Anthropic-API-compatible.

2. **Model alias resolution**: When using `model: 'sonnet'`, the SDK maps this to a full model ID. For third-party providers, you MUST set `ANTHROPIC_DEFAULT_SONNET_MODEL` etc. to the provider's actual model ID.

3. **System prompt identity**: The `claude_code` preset includes "You are Claude" in the system prompt. Third-party models will claim to be Claude unless you add identity clarification (which Ptah already does).

4. **Unsupported by Anthropic**: Using non-Anthropic models through the SDK is explicitly "unsupported" per Anthropic. It works but could break with any SDK update.

5. **No OpenAI-compatible mode**: The SDK speaks Anthropic's API protocol (Messages API). It does NOT speak the OpenAI Chat Completions API. Providers must implement Anthropic-compatible endpoints.

6. **Process isolation overhead**: Each `query()` spawns a separate Node.js process. Running many concurrent instances has memory/CPU overhead.

### Error scenarios

- If `ANTHROPIC_BASE_URL` points to a non-Anthropic-compatible endpoint, the SDK will fail with network or parsing errors.
- If `ANTHROPIC_API_KEY` is empty AND `ANTHROPIC_AUTH_TOKEN` is empty, the SDK will fail with authentication errors.
- If model tier env vars don't match the provider's actual model IDs, the SDK may send invalid model names.

---

## 7. Architectural Recommendations for Ptah

### Current approach (process.env mutation) - WORKS but has risks

**Pros**: Simple, proven in production
**Cons**: Global state, no per-session isolation, race conditions with concurrent sessions

### Recommended improvement: Per-session env construction

```typescript
// In SdkQueryOptionsBuilder.build():
private buildSessionEnv(providerConfig: ProviderConfig): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    // Start with base process env (PATH, HOME, etc.)
    ...process.env,
  };

  // Clear any stale auth vars
  delete env['ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_AUTH_TOKEN'];
  delete env['ANTHROPIC_BASE_URL'];
  delete env['CLAUDE_CODE_OAUTH_TOKEN'];

  // Apply provider-specific configuration
  if (providerConfig.baseUrl) {
    env['ANTHROPIC_BASE_URL'] = providerConfig.baseUrl;
  }
  env[providerConfig.authEnvVar] = providerConfig.apiKey;

  // Apply model tier mappings
  if (providerConfig.modelMappings) {
    env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = providerConfig.modelMappings.opus;
    env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = providerConfig.modelMappings.sonnet;
    env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = providerConfig.modelMappings.haiku;
  }

  return env;
}
```

This would enable future capabilities like:

- Different users/sessions using different providers simultaneously
- A/B testing between providers
- Automatic failover to a different provider

---

## Sources

### Primary (official)

- [Agent SDK Overview - Anthropic](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Model Configuration - Claude Code Docs](https://code.claude.com/docs/en/model-config)
- [Claude Agent SDK GitHub](https://github.com/anthropics/claude-agent-sdk-typescript)

### Secondary (community/third-party)

- [OpenRouter Claude Code Integration Guide](https://openrouter.ai/docs/guides/guides/claude-code-integration)
- [GitHub Issue #5577 - ANTHROPIC_BASE_URL Clarification](https://github.com/anthropics/claude-code/issues/5577)
- [GitHub Issue #216 - Custom API Endpoint Support](https://github.com/anthropics/claude-code/issues/216)
- [Claude Code CLI Environment Variables Gist](https://gist.github.com/unkn0wncode/f87295d055dd0f0e8082358a0b5cc467)
- [LiteLLM Claude Agent SDK Integration](https://docs.litellm.ai/docs/tutorials/claude_agent_sdk)
- [Ollama Claude Code Blog](https://ollama.com/blog/claude)

### Local sources analyzed

- `D:\projects\ptah-extension\node_modules\@anthropic-ai\claude-agent-sdk\sdk.d.ts` - Full type definitions
- `D:\projects\ptah-extension\node_modules\@anthropic-ai\claude-agent-sdk\package.json` - Version info
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` - Current Ptah implementation
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\auth-manager.ts` - Current auth flow
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\anthropic-provider-registry.ts` - Provider definitions
