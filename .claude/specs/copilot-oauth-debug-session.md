# Copilot OAuth Provider - Debug Session Summary

**Date**: 2026-03-14
**Branch**: `feature/copilot-oauth-provider`
**Status**: Fixes applied, awaiting user testing

---

## Problem

The Copilot OAuth provider (TASK_2025_186) fails with "There's an issue with the selected model (gpt-5.4)" when trying to use non-default models through the translation proxy.

## Root Causes Found (3 bugs)

### Bug 1: `Invalid URL` crash in `getActiveProviderId` (FIXED)

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

**Cause**: `getActiveProviderId()` iterates ALL registered providers and calls `new URL(provider.baseUrl)`. The Copilot entry has `baseUrl: ''` (set dynamically at runtime via translation proxy). `new URL('')` throws `TypeError: Invalid URL`.

**Fix applied**:

1. Added early return for Copilot detection via `COPILOT_PROXY_TOKEN_PLACEHOLDER` auth token
2. Added guard to skip providers with empty `baseUrl` + try/catch for safety

### Bug 2: SDK reads `process.env` not `authEnv` for model resolution (FIXED)

**File**: `libs/backend/agent-sdk/src/lib/provider-models.service.ts`

**Cause**: The Claude Agent SDK's internal model resolution function reads `process.env.ANTHROPIC_DEFAULT_SONNET_MODEL` directly — NOT the `env` option passed to `query()`. Our `authEnv` object was only passed as `env` to the SDK query (used for subprocess environments), but the SDK's **in-process** model resolver reads from `process.env` which was never set.

**Evidence from SDK source** (minified `cli.js`):

```javascript
function jW() {
  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  return JH().sonnet45;
}
```

**Fix applied**: Sync `process.env` alongside `authEnv` in three places:

- `applyPersistedTiers()` — sets process.env when applying tier mappings
- `clearAllTierEnvVars()` — deletes from process.env when clearing
- `setModelTier()` — sets process.env on runtime tier changes

### Bug 3: Copilot API requires `capi:` model prefix (FIXED)

**File**: `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-request-translator.ts`

**Cause**: The Copilot REST API (`api.githubcopilot.com/chat/completions`) expects model IDs with a `capi:` prefix (e.g., `capi:claude-sonnet-4.6`). Our translation proxy was sending raw model IDs without the prefix.

**Evidence from Copilot CLI logs** (`~/.copilot/logs/`):

```json
"model": "capi:claude-sonnet-4.6:defaultReasoningEffort=high"
```

**Fix applied**: In `translateAnthropicToOpenAI()`, prefix model with `capi:` before forwarding:

```typescript
const model = anthropicRequest.model.startsWith('capi:') ? anthropicRequest.model : `capi:${anthropicRequest.model}`;
```

## Key Discoveries

### Copilot API Model Format

- Copilot REST API uses `capi:{model_id}` prefix
- Model IDs use **dots** not hyphens: `claude-sonnet-4.6` (not `claude-sonnet-4-6`)
- The Copilot CLI lists 29 models including `gpt-5.4` (note: NOT in the `--help` choices but IS in the API model list)
- Available models from API: claude-opus-4.6, claude-sonnet-4.6, gpt-5.4, gpt-5.3-codex, gpt-5.2, gemini-3-pro-preview, etc.

### Claude Agent SDK Behavior

- The SDK does NOT validate model IDs locally
- It sends the request to the API endpoint and checks the response for `not_found_error`
- Model resolution reads from `process.env` directly, not from the `env` option
- The `env` option passed to `query()` is only used for subprocess spawning

### Moonshot/Z.AI vs Copilot

- Moonshot and Z.AI work because they provide first-class Anthropic API compatibility — they accept model IDs directly at their endpoints
- Copilot does NOT speak Anthropic protocol — it only speaks OpenAI Chat Completions
- The translation proxy bridges this gap but needs the `capi:` prefix

## Files Modified

| File                                                                            | Change                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`           | Fixed `getActiveProviderId()` — Copilot detection + empty baseUrl guard            |
| `libs/backend/agent-sdk/src/lib/provider-models.service.ts`                     | Sync `process.env` in `applyPersistedTiers`, `clearAllTierEnvVars`, `setModelTier` |
| `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-request-translator.ts` | Add `capi:` model prefix in `translateAnthropicToOpenAI()`                         |

## Files Created

| File                                         | Purpose                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/infra-test/src/test-copilot-models.ts` | Test script for Copilot API model format (requires GITHUB_TOKEN env var) |

## Testing Checklist

After rebuilding (`npx nx build ptah-extension-vscode`) and reloading VS Code:

1. [ ] Set Copilot as active provider in Settings > Authentication
2. [ ] Set a non-Anthropic model as sonnet tier (e.g., `gpt-5.4`)
3. [ ] Send a message — should reach proxy, get `capi:gpt-5.4` prefix, and Copilot should respond
4. [ ] Set an Anthropic model as sonnet tier (e.g., `claude-sonnet-4.6`)
5. [ ] Send a message — should work with `capi:claude-sonnet-4.6`
6. [ ] Check log for proxy entries: `[CopilotProxy] Translating request for model: ...`
7. [ ] Verify no `Invalid URL` errors in logs

## What to Report if It Still Fails

If testing still fails, capture:

1. The new VS Code log file (`vscode-app-*.log`)
2. Look for these specific log lines:
   - `[SdkQueryOptionsBuilder] SDK call with model:` — shows what model/env vars the SDK sees
   - `[CopilotProxy]` — any proxy request/error entries (if absent, request never reached proxy)
   - `ERR` or `error` entries
3. The error message shown in the UI

## Related Work

- **TASK_2025_186**: Original Copilot OAuth provider implementation
- **TASK_2025_193**: Codex translation proxy support (architect plan complete at `.claude/specs/TASK_2025_193/implementation-plan.md`) — extracts shared OpenAI translators for reuse
