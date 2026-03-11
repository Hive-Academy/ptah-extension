# TASK_2025_091 Context

## User Request

Investigate and implement OpenRouter integration for Claude Agent SDK, allowing OpenRouter API key to take precedence over both OAuth token and Anthropic API key. Include model selection in the Settings UI.

## Task Type

FEATURE - New capability for alternative LLM provider routing

## Priority

High - Enables model flexibility and cost optimization

## Key Requirements

1. **OpenRouter API Key Precedence**: When OpenRouter key is configured, route requests through OpenRouter instead of directly to Anthropic
2. **Environment Variable Configuration**: Set `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` per OpenRouter docs
3. **Model Selection UI**: Display and allow selection of available models in Settings
4. **Existing Provider Reuse**: Evaluate if `llm-abstraction/openrouter.provider.ts` can be leveraged

## Technical Context

### Current Auth Flow (Discovered)

1. `AuthSecretsService` stores `oauthToken` and `apiKey` in VS Code SecretStorage
2. `AuthManager` configures `process.env` with `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
3. `SdkAgentAdapter` passes `env: process.env` to SDK query options
4. SDK uses environment variables for authentication

### OpenRouter Integration Pattern (From OpenRouter Docs)

```bash
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN=<openrouter_api_key>
ANTHROPIC_API_KEY=""  # Must be empty to prevent conflicts
```

### Affected Files

- `libs/backend/vscode-core/src/services/auth-secrets.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.ts`
- `libs/frontend/chat/src/lib/settings/auth-config.component.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts`
- `libs/shared/src/lib/types/rpc.types.ts`

### Existing OpenRouter Provider

The `libs/backend/llm-abstraction/src/openrouter.ts` and `openrouter.provider.ts` use Langchain's ChatOpenAI for structured completions - separate concern from Claude SDK routing.

## Created

2025-12-26
