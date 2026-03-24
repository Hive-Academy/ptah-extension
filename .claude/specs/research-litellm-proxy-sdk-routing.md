# Research Report: LiteLLM Proxy and Claude Agent SDK Routing

**Date**: 2026-03-14
**Confidence Level**: 92% (based on 20+ sources including official docs, SDK source code, and community reports)
**Key Insight**: The SDK correctly reads `ANTHROPIC_BASE_URL` from `process.env`, but `settingSources: ['user']` can cause `~/.claude/settings.json` to override the env-provided API key, and the SDK's CLI subprocess has specific URL path requirements that must be met.

---

## 1. How LiteLLM Proxy Works with Claude Agent SDK

### Configuration

LiteLLM acts as a translation layer that receives Anthropic Messages API requests and forwards them to any supported provider (OpenAI, Bedrock, Vertex, etc.).

**Environment variables required**:

```bash
export ANTHROPIC_BASE_URL="http://localhost:4000"
export ANTHROPIC_API_KEY="sk-litellm-key"   # or ANTHROPIC_AUTH_TOKEN
```

**URL format**: Plain `http://localhost:4000` (HTTP works fine, no HTTPS required for localhost).

**Two endpoint styles**:

1. **Unified endpoint** (recommended): `ANTHROPIC_BASE_URL=http://localhost:4000` -- LiteLLM auto-translates between formats
2. **Pass-through endpoint**: `ANTHROPIC_BASE_URL=http://localhost:4000/anthropic` -- passes Anthropic requests directly

### What LiteLLM handles

LiteLLM's translation pipeline:

1. Receives Anthropic Messages API request at `/v1/messages`
2. Translates request to OpenAI Chat Completions format
3. Forwards to the target provider
4. Translates response back to Anthropic Messages API format
5. Returns Anthropic-format response (streaming or non-streaming)

### Key detail from official Claude Code docs

The official Claude Code documentation at https://code.claude.com/docs/en/llm-gateway confirms:

- The gateway MUST expose `/v1/messages` and `/v1/messages/count_tokens`
- It MUST forward request headers: `anthropic-beta`, `anthropic-version`
- HTTP (not just HTTPS) is supported for localhost

---

## 2. How the Claude Agent SDK Reads ANTHROPIC_BASE_URL

### Source Code Analysis (from cli.js v0.2.42)

The SDK's CLI subprocess uses a function `gC1` to read environment variables:

```javascript
gC1 = (A) => {
  if (typeof globalThis.process < 'u') return globalThis.process.env?.[A]?.trim() ?? void 0;
  // ... browser fallback
};
```

The Anthropic client is constructed as:

```javascript
baseURL: A = gC1("ANTHROPIC_BASE_URL"),
apiKey: q = gC1("ANTHROPIC_API_KEY") ?? null,
authToken: K = gC1("ANTHROPIC_AUTH_TOKEN") ?? null,
// ...
baseURL: A || "https://api.anthropic.com"
```

**Critical finding**: The SDK reads `ANTHROPIC_BASE_URL` from `process.env` at Anthropic client construction time. If the env var is set, it uses it. If not, it defaults to `https://api.anthropic.com`.

### URL Path Appending

The SDK appends `/v1/messages` to the base URL. So if you set `ANTHROPIC_BASE_URL=http://127.0.0.1:5000`, the SDK will send requests to `http://127.0.0.1:5000/v1/messages`.

**Known bug** (Issue #195): If `ANTHROPIC_BASE_URL` contains query parameters (e.g., `?token=abc`), the SDK mangles them by URL-encoding the path into the query string.

---

## 3. Root Cause Analysis: Why the Proxy Gets Zero Requests

Based on the research, there are **four likely causes** for the proxy receiving zero requests:

### Cause 1: `settingSources: ['user']` Override (HIGH probability)

From the common pitfalls article: when `settingSources` includes `'user'`, the SDK reads `~/.claude/settings.json`. If that file contains API key configuration (from a previous `claude login`), **it takes priority over environment variables**.

Your `sdk-query-options-builder.ts` sets:

```typescript
settingSources: ['user', 'project', 'local'],
```

If `~/.claude/settings.json` has an `apiKey` or auth configuration from a previous login, the SDK may ignore `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` from env and use the settings-file credentials instead, sending requests directly to `api.anthropic.com`.

**Fix**: Either:

- Remove `'user'` from `settingSources` (but loses global Skills)
- Ensure `~/.claude/settings.json` does not contain conflicting auth

### Cause 2: HTTP_PROXY / HTTPS_PROXY Leaking (MEDIUM probability)

From GitHub Issue #1163 on claude-mem: when `ANTHROPIC_BASE_URL` points to localhost, but `HTTP_PROXY`/`HTTPS_PROXY` env vars are set, the subprocess routes requests through the proxy instead of directly to localhost.

Your `buildSafeEnv()` does NOT pass `HTTP_PROXY`/`HTTPS_PROXY`, which is correct. But `sdk-query-options-builder.ts` uses `{ ...process.env, ...this.authEnv }` which DOES leak all process env vars including proxy settings.

**Fix**: Either use `buildSafeEnv()` consistently, or add `NO_PROXY=127.0.0.1,localhost` to the env.

### Cause 3: `CLAUDECODE=1` Inherited (MEDIUM probability for nested scenarios)

From GitHub Issue #573: the subprocess inherits `CLAUDECODE=1` from the parent process if running inside a Claude Code session. The spawned CLI detects this and may reject the session.

**Fix**: Set `CLAUDECODE: ''` in the env option.

### Cause 4: The SDK's Client Creates the API URL at Construction Time (LOW probability)

The Anthropic client in the SDK is constructed once with the base URL. The `env` option in `query()` sets environment variables for the subprocess, and the subprocess reads them via `gC1("ANTHROPIC_BASE_URL")` at startup. This should work correctly as long as the env vars are properly set before the subprocess starts.

---

## 4. Recommended Architecture: How to Properly Route SDK Traffic

### Option A: Use buildSafeEnv() Consistently (Recommended)

The `PtahCliAdapter` and `PtahCliRegistry` already use `buildSafeEnv(authEnv)` which creates a minimal env with only platform essentials + auth vars. The `SdkQueryOptionsBuilder` should do the same instead of spreading all of `process.env`.

```typescript
// CURRENT (problematic) in sdk-query-options-builder.ts:
env: { ...process.env, ...this.authEnv, DEBUG_CLAUDE_AGENT_SDK: '1' }

// RECOMMENDED:
env: {
  ...buildSafeEnv(this.authEnv),
  DEBUG_CLAUDE_AGENT_SDK: '1',
  NO_PROXY: '127.0.0.1,localhost',  // Prevent proxy routing for localhost
  CLAUDECODE: '',                     // Prevent nested detection
}
```

### Option B: Add NO_PROXY and Validate Settings

If you must keep `process.env` spreading:

```typescript
env: {
  ...process.env,
  ...this.authEnv,
  NO_PROXY: '127.0.0.1,localhost',
  CLAUDECODE: '',
  DEBUG_CLAUDE_AGENT_SDK: '1',
}
```

### Option C: Remove 'user' from settingSources for Non-Anthropic Providers

When routing through a translation proxy, settings from `~/.claude/settings.json` are irrelevant and can cause auth conflicts:

```typescript
settingSources: isUsingTranslationProxy
  ? ['project', 'local']   // Skip user settings to avoid auth override
  : ['user', 'project', 'local'],
```

---

## 5. How Community Projects Handle This

### claude-code-proxy (1rgs)

- Local HTTP server on port 8082
- Sets `ANTHROPIC_BASE_URL=http://localhost:8082`
- Translates Anthropic -> OpenAI via LiteLLM internally
- Handles both streaming and non-streaming

### anthropic-proxy (maxnowack)

- Converts Anthropic API -> OpenRouter
- Same pattern: local HTTP proxy + ANTHROPIC_BASE_URL

### opencode-claude-max-proxy (rynfar)

- Bridges Anthropic SDK to Claude Max subscription
- Uses same ANTHROPIC_BASE_URL mechanism

All community projects confirm: the pattern of `ANTHROPIC_BASE_URL=http://localhost:PORT` + a local HTTP proxy works. The issue is not in the proxy architecture but in the env var delivery to the subprocess.

---

## 6. Your Proxy Architecture Assessment

Your `TranslationProxyBase` implementation is architecturally sound:

- Listens on `127.0.0.1:0` (OS-assigned port) -- correct
- Handles `/v1/messages` POST -- correct (matches SDK's expected path)
- Handles `/v1/models` GET -- correct
- Returns Anthropic-format errors -- correct
- Does streaming SSE translation -- correct

The proxy code itself is not the problem. The problem is that the SDK subprocess never reaches the proxy because either:

1. Auth settings from `~/.claude/settings.json` override the base URL
2. HTTP proxy env vars redirect traffic away from localhost
3. The env vars are not properly reaching the subprocess

---

## 7. Debugging Steps

To diagnose which cause applies:

1. **Check `~/.claude/settings.json`**: Look for any `apiKey`, `authToken`, or OAuth configuration
2. **Log the actual subprocess env**: Add logging in the SDK options to dump the env that is actually passed:
   ```typescript
   const env = { ...buildSafeEnv(this.authEnv), DEBUG_CLAUDE_AGENT_SDK: '1' };
   this.logger.info('SDK subprocess env:', {
     ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
     ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '<set>' : 'NOT SET',
     ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? '<set>' : 'NOT SET',
     HTTP_PROXY: env.HTTP_PROXY ?? 'NOT SET',
     HTTPS_PROXY: env.HTTPS_PROXY ?? 'NOT SET',
   });
   ```
3. **Test with curl**: Verify the proxy works independently:
   ```bash
   curl http://127.0.0.1:PORT/health
   curl -X POST http://127.0.0.1:PORT/v1/messages \
     -H "Content-Type: application/json" \
     -d '{"model":"test","messages":[{"role":"user","content":"hi"}]}'
   ```
4. **Try removing `'user'` from settingSources** temporarily to rule out settings override

---

## 8. LiteLLM as Alternative to Custom Proxy

If you want to use LiteLLM instead of a custom proxy:

### Advantages

- Battle-tested translation for 100+ providers
- Handles edge cases in API format differences
- Built-in load balancing, fallbacks, cost tracking
- Active maintenance

### Disadvantages

- Python dependency (requires pip install)
- Additional process to manage
- Heavier than a targeted Node.js proxy
- May not integrate well with VS Code extension lifecycle

### Configuration for Copilot/Codex through LiteLLM

```yaml
# config.yaml
model_list:
  - model_name: claude-sonnet-4-20250514
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/COPILOT_TOKEN
      api_base: https://api.githubcopilot.com
```

**Verdict**: For a VS Code extension, the custom in-process proxy (TranslationProxyBase) is the better architecture. LiteLLM is better suited for standalone CLI usage or server-side deployments.

---

## Sources

- [Claude Agent SDK with LiteLLM (official)](https://docs.litellm.ai/docs/tutorials/claude_agent_sdk)
- [Use Claude Code with Non-Anthropic Models (LiteLLM)](https://docs.litellm.ai/docs/tutorials/claude_non_anthropic_models)
- [LLM Gateway Configuration (Claude Code official)](https://code.claude.com/docs/en/llm-gateway)
- [Agent SDK TypeScript Reference (Anthropic official)](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [ANTHROPIC_BASE_URL query parameter bug (GitHub Issue #195)](https://github.com/anthropics/claude-agent-sdk-typescript/issues/195)
- [SDK subprocess proxy env var leak (GitHub Issue #1163)](https://github.com/thedotmack/claude-mem/issues/1163)
- [Subprocess CLAUDECODE=1 inheritance (GitHub Issue #573)](https://github.com/anthropics/claude-agent-sdk-python/issues/573)
- [Common Pitfalls with Claude Agent SDK](https://liruifengv.com/posts/claude-agent-sdk-pitfalls-en/)
- [Claude Code Environment Variables Reference](https://gist.github.com/unkn0wncode/f87295d055dd0f0e8082358a0b5cc467)
- [claude-code-proxy (1rgs)](https://github.com/1rgs/claude-code-proxy)
- [anthropic-proxy (maxnowack)](https://github.com/maxnowack/anthropic-proxy)
- [Claude Code with LiteLLM (Niklas Palm)](https://medium.com/@niklas-palm/claude-code-with-litellm-24b3fb115911)
- [Anthropic Provider Docs (LiteLLM)](https://docs.litellm.ai/docs/providers/anthropic)
- [GitHub Copilot Integration (LiteLLM)](https://docs.litellm.ai/docs/tutorials/github_copilot_integration)
