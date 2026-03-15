# Copilot & Codex Translation Proxy — Current Status

**Date**: 2026-03-15
**Branch**: `feature/copilot-oauth-provider`
**Session**: fix-copilot-codex-oauth
**Status**: Copilot proxy functional (awaiting user test of Responses API), Codex proxy untested

---

## Architecture Overview

Both Copilot and Codex providers use a **translation proxy** pattern:

```
Claude Agent SDK  →  Anthropic Messages API  →  Translation Proxy (localhost)
                                                      ↓
                                              Translate to OpenAI format
                                                      ↓
                                              Upstream API (Copilot / Codex)
                                                      ↓
                                              Translate response back
                                                      ↓
                                              Anthropic SSE stream to SDK
```

### Shared Module: `openai-translation/`

```
libs/backend/agent-sdk/src/lib/openai-translation/
├── openai-translation.types.ts          # All protocol types
├── request-translator.ts                # Anthropic → OpenAI Chat Completions
├── response-translator.ts              # OpenAI SSE → Anthropic SSE (Chat Completions)
├── responses-request-translator.ts     # Anthropic → OpenAI Responses API (NEW)
├── responses-stream-translator.ts      # Responses SSE → Anthropic SSE (NEW)
├── translation-proxy-base.ts           # Abstract base class with dual routing
└── index.ts                            # Barrel exports
```

### Provider Modules

```
copilot-provider/                       codex-provider/
├── copilot-auth.service.ts             ├── codex-auth.service.ts
├── copilot-translation-proxy.ts        ├── codex-translation-proxy.ts
├── copilot-provider-entry.ts           ├── codex-provider-entry.ts
├── copilot-provider.types.ts           ├── codex-provider.types.ts
└── index.ts                            └── index.ts
```

---

## Copilot Provider — Current State

### What Works

- GitHub OAuth sign-in via VS Code auth provider
- Token exchange (GitHub token → Copilot bearer token via `/copilot_internal/v2/token`)
- Token auto-refresh (30min expiry, 5min refresh buffer)
- Translation proxy starts on `http://127.0.0.1:<random-port>`
- `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` synced to both `authEnv` and `process.env`
- SDK subprocess receives correct env, routes to proxy
- `settingSources` excludes `'user'` when proxy is active (prevents `~/.claude/settings.json` override)
- `NO_PROXY=127.0.0.1,localhost` prevents corporate proxy interception
- Proxy URL query strings handled (`?beta=true`)
- Dynamic model fetching from Copilot API `GET /models` endpoint (42 models with metadata)
- Provider detection in `getActiveProviderId()` via `CODEX_PROXY_TOKEN_PLACEHOLDER` / `COPILOT_PROXY_TOKEN_PLACEHOLDER`

### Dual-Endpoint Routing (TASK_2025_199)

The Copilot API has TWO endpoints for different model generations:

| Endpoint            | Models                                                | Format                  |
| ------------------- | ----------------------------------------------------- | ----------------------- |
| `/chat/completions` | Claude, Gemini, GPT-5-mini, GPT-5.1, GPT-5.2, GPT-4.x | OpenAI Chat Completions |
| `/responses`        | GPT-5.3+, GPT-5.4, codex variants                     | OpenAI Responses API    |

Routing logic (matches [OpenCode](https://github.com/sst/opencode)):

```typescript
static shouldUseResponsesApi(modelId: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelId);
  if (!match) return false;
  return Number(match[1]) >= 5 && !modelId.startsWith('gpt-5-mini');
}
```

### Awaiting User Test

- **Responses API path**: `gpt-5.4` should now route through `/responses` instead of `/chat/completions`
- **Chat Completions path**: `claude-sonnet-4.6` confirmed working end-to-end
- User needs to test both paths and share logs

### Known Issues (Copilot)

1. **DEBUG logging still enabled** — `DEBUG_CLAUDE_AGENT_SDK=1` in env option, debug bearer token logging in auth service. **MUST be removed before release.**
2. **Diagnostic logging in session-lifecycle-manager.ts** — `process.env auth state before SDK query` log. **Remove before release.**
3. **Debug logging in translation-proxy-base.ts** — Request model/auth header info logs. **Downgrade to debug level before release.**

---

## Codex Provider — Current State

### What's Implemented

- `CodexAuthService` — reads `~/.codex/auth.json`, API key priority (both `openai_api_key` and `OPENAI_API_KEY`), OAuth refresh, atomic file writes, cache with invalidation
- `CodexTranslationProxy` — extends `TranslationProxyBase`, **uses Responses API exclusively** (all models → `/responses`)
- Auth-mode-dependent endpoint:
  - **API Key mode**: `https://api.openai.com/v1/responses`
  - **ChatGPT OAuth mode**: `https://chatgpt.com/backend-api/codex/responses`
- `CODEX_PROVIDER_ENTRY` — 6 static models (gpt-5.4, gpt-5.3-codex, etc.), registered in provider registry
- DI tokens (`SDK_CODEX_AUTH`, `SDK_CODEX_PROXY`) registered in container
- Auth manager `configureCodexOAuth()` — starts proxy, sets env vars, syncs `process.env`
- Provider switching stops the OTHER provider's proxy (prevents cross-contamination)
- UI: Codex-specific auth panel showing "Authenticated via `~/.codex/auth.json`" with `codex login` instructions
- `package.json`: `ptah.provider.openai-codex.modelTier.{sonnet,opus,haiku}` settings

### Key Differences from Copilot

| Aspect           | Copilot                                    | Codex                                   |
| ---------------- | ------------------------------------------ | --------------------------------------- |
| API format       | Dual: `/chat/completions` + `/responses`   | Responses API only (`/responses`)       |
| Endpoint routing | Model-based (GPT-5+ → Responses)           | ALL models → Responses API              |
| Auth             | GitHub OAuth → Copilot bearer token        | `~/.codex/auth.json` (API key or OAuth) |
| Endpoint URL     | `https://api.individual.githubcopilot.com` | Auth-mode dependent (see above)         |
| Model fetching   | Dynamic via `GET /models`                  | Static list                             |

### NOT YET TESTED

- End-to-end message flow through Codex proxy
- Token refresh lifecycle
- Model tier persistence
- Dynamic model fetching for Codex (currently uses static list — should fetch from Codex API if available)

### Testing Checklist for Codex

1. [ ] Verify `~/.codex/auth.json` exists (run `codex login` if not)
2. [ ] Select "OpenAI Codex" provider in Settings
3. [ ] UI should show "CLI Auth" badge, NOT GitHub OAuth flow
4. [ ] Set model tiers (e.g., sonnet → gpt-5.3-codex)
5. [ ] Send a message — check log for `[CodexProxy]` entries
6. [ ] Verify proxy starts at localhost, forwards to correct endpoint based on auth mode
7. [ ] Verify model IDs sent correctly (no prefix)
8. [ ] Test with streaming enabled
9. [ ] Verify all models route through `/responses` (NOT `/chat/completions`)
10. [ ] Switch back to Copilot — verify no cross-contamination (other proxy stopped, correct endpoint)

---

## Commits in This Session

| Commit       | Description                                                            |
| ------------ | ---------------------------------------------------------------------- |
| `912f49ac`   | Extract shared OpenAI translation module                               |
| `6181777a`   | Refactor Copilot provider to use shared module                         |
| `3794cfc6`   | Add Codex translation proxy provider                                   |
| `b4722208`   | Wire Codex into DI, registry, auth manager                             |
| `cc847038`   | Fix QA review issues (8 issues: cache, retry, null checks, interfaces) |
| `f4eacb25`   | Detect Codex proxy provider in getActiveProviderId                     |
| `5e3c9b16`   | Sync auth env vars to process.env for SDK compatibility                |
| `22dc91f7`   | Add Codex provider settings and differentiate auth UI                  |
| _(unstaged)_ | Responses API translators + dual-endpoint routing (TASK_2025_199)      |
| _(unstaged)_ | Dynamic model fetching from Copilot API /models endpoint               |
| _(unstaged)_ | Translation proxy query string fix (?beta=true)                        |
| _(unstaged)_ | settingSources exclusion + NO_PROXY for proxy providers                |
| _(unstaged)_ | Remove capi: model prefix (not needed for Copilot REST API)            |

---

## Key Bugs Fixed in This Session

| Bug                                          | Root Cause                                                    | Fix                                                         |
| -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| SDK ignores proxy URL                        | `~/.claude/settings.json` auth overrides env vars             | Exclude `'user'` from `settingSources` when proxy active    |
| Proxy returns 404                            | SDK sends `?beta=true` query string, proxy exact-matches path | Strip query string before route matching                    |
| "Model not supported"                        | `capi:` prefix not needed for Copilot REST API                | Removed model prefix (empty string)                         |
| "Model not accessible via /chat/completions" | GPT-5.3+/5.4 require Responses API endpoint                   | Dual-endpoint routing (`/responses` vs `/chat/completions`) |
| process.env not synced                       | SDK subprocess reads process.env directly, not env option     | Sync process.env in all auth config paths                   |

---

## Files to Clean Up Before Release

1. **Remove debug logging:**

   - `sdk-query-options-builder.ts` — Remove `DEBUG_CLAUDE_AGENT_SDK: '1'` from env
   - `copilot-auth.service.ts` — Remove `DEBUG BEARER TOKEN` log line
   - `translation-proxy-base.ts` — Downgrade Request model/Auth header logs to `debug` level
   - `session-lifecycle-manager.ts` — Remove `process.env auth state` diagnostic log

2. **Commit unstaged changes** — Several fixes are applied but not yet committed

3. **Consider:** Should the `shouldUseResponsesApi()` routing also apply to Codex? Need to test Codex's API to find out.

---

## Architecture Decisions

1. **Shared translation module** — Both Copilot and Codex reuse `openai-translation/` (types, translators, base class). ~1,700 lines removed from Copilot monolith.
2. **Abstract base class** — `TranslationProxyBase` handles all HTTP server logic, subclasses only provide auth/endpoint/config.
3. **Dual-endpoint routing** — Model-based routing in the base class, not per-provider. Both providers benefit.
4. **Dynamic model fetching** — Copilot uses `GET /models` API. Codex still uses static list (needs investigation).
5. **No model prefix** — Neither Copilot nor Codex need model ID prefixes. Raw model IDs work.
6. **settingSources guard** — Critical for proxy providers: `~/.claude/settings.json` must not override `ANTHROPIC_BASE_URL`.

---

## Next Session Tasks

1. **Test Copilot Responses API** — Verify `gpt-5.4` works through `/responses` endpoint
2. **Test Codex end-to-end** — Full message flow through Codex proxy
3. **Investigate Codex API** — Does it also have `/responses` vs `/chat/completions` split? Does it have a `/models` listing endpoint?
4. **Commit all unstaged changes** — Group logically, proper commitlint format
5. **Remove debug logging** — Clean up before any release
6. **Dynamic model fetching for Codex** — If Codex API has a models endpoint, wire it up like Copilot
7. **Error handling UX** — When a model fails (e.g., "not accessible via /chat/completions"), show a user-friendly message suggesting compatible models instead of raw API error JSON
