# TASK_2025_193: Codex Translation Proxy Support

## Task Type

FEATURE

## Strategy

Partial (Architect → Team-Leader → Developers → QA)

## User Request

Add OpenAI Codex as a translation proxy provider, reusing the existing Copilot translation proxy architecture. Extract shared OpenAI protocol translators into a reusable module, then create Codex-specific auth, proxy, and provider entry.

## Context from Current Conversation

### What exists (Copilot provider, TASK_2025_186):

- `copilot-translation-proxy.ts` — Local HTTP server translating Anthropic Messages API ↔ OpenAI Chat Completions
- `copilot-request-translator.ts` — Pure functions: Anthropic → OpenAI request translation
- `copilot-response-translator.ts` — Stateful: OpenAI SSE → Anthropic SSE response translation
- `copilot-auth.service.ts` — GitHub OAuth → Copilot bearer token lifecycle
- `copilot-provider-entry.ts` — Provider registry entry with static models
- `copilot-provider.types.ts` — All protocol types (OpenAI + Anthropic simplified)

### What can be reused directly (~80%):

- **Request translator** — Anthropic → OpenAI Chat Completions is protocol-level, not Copilot-specific
- **Response translator** — OpenAI SSE → Anthropic SSE is generic
- **Proxy HTTP server scaffolding** — Request routing, body parsing, streaming, error handling
- **Protocol types** — OpenAI/Anthropic type definitions are shared

### What's different (~20% new work):

1. **Auth service** — Codex uses `~/.codex/auth.json` token file, much simpler than Copilot's OAuth token exchange
2. **API endpoint** — Codex hits `chatgpt.com` backend (see existing `test-codex-models.ts` for endpoint details)
3. **Headers** — Different auth headers (no `Copilot-Integration-Id`, etc.)
4. **Model prefix** — May differ from `capi:` prefix discovered for Copilot, or may be none at all
5. **Provider entry** — New registry entry with Codex's static models (already defined in `copilot-sdk.adapter.ts`)

### Key discovery from this conversation:

- The Copilot REST API requires a `capi:` model prefix (e.g., `capi:claude-sonnet-4.6`)
- The Claude Agent SDK does NOT validate model IDs locally — it sends to the API and checks the response
- The SDK reads `ANTHROPIC_DEFAULT_*_MODEL` from the `env` option passed to `query()`
- Model IDs use dots not hyphens for Copilot (e.g., `claude-sonnet-4.6` not `claude-sonnet-4-6`)

### Existing Codex infrastructure:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts` — Has Codex model list
- `apps/infra-test/src/test-codex-models.ts` — Existing Codex model fetch test (reads `~/.codex/auth.json`)
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` — Existing Codex CLI adapter

### Recommended approach:

1. Extract `copilot-request-translator.ts` + `copilot-response-translator.ts` + shared types into a generic `openai-translation/` module
2. Refactor `CopilotTranslationProxy` to use the shared module
3. Create thin `CodexTranslationProxy` reusing shared translators with its own auth + endpoint config
4. Create `CodexAuthService` (read token from `~/.codex/auth.json`)
5. Add `CODEX_PROVIDER_ENTRY` to the Anthropic-compatible provider registry
6. Determine Codex API model prefix (test with infra-test)

## Complexity

Low-Medium (1-2 days for familiar developer)

## Created

2026-03-14
