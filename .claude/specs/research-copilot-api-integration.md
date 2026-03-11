# Research Report: GitHub Copilot API Integration

## Executive Summary

**Key Finding**: GitHub Copilot exposes an **OpenAI-compatible** API at `https://api.githubcopilot.com`, NOT an Anthropic-compatible one. The initial hypothesis that Copilot offers an Anthropic Messages API endpoint (like Moonshot's `https://api.moonshot.ai/anthropic/`) is **incorrect**. However, this API successfully serves Claude models (Sonnet 3.5, 3.7, 4) through the OpenAI chat completions format, meaning all models -- including Claude -- are accessed via OpenAI SDK protocol.

**Confidence Level**: 95% (based on actual source code from opencode-ai/opencode)

**Implication for Ptah**: You cannot simply set `ANTHROPIC_BASE_URL` to a Copilot endpoint and have the Claude Agent SDK work. Copilot requires a completely different integration approach using the OpenAI protocol.

---

## 1. How opencode Implements GitHub Copilot Support

**Repository**: https://github.com/opencode-ai/opencode (by opencode-ai, NOT sst/opencode)

### Architecture

opencode implements Copilot as a **first-class provider** using the **OpenAI Go SDK** (`github.com/openai/openai-go`). The key file is `internal/llm/provider/copilot.go`.

### API Endpoint

```
Base URL: https://api.githubcopilot.com
```

This endpoint accepts **OpenAI Chat Completions API format** requests. All models -- GPT, Claude, Gemini, o1/o3/o4 -- are accessed through the same OpenAI-compatible endpoint.

### Authentication Flow (Two-Step)

**Step 1**: Obtain a GitHub OAuth token from one of three sources:

1. `GITHUB_TOKEN` environment variable
2. API key from config (`providers.copilot.apiKey`)
3. Standard GitHub CLI/Copilot credential files:
   - `~/.config/github-copilot/hosts.json` (Linux/macOS)
   - `%LOCALAPPDATA%/github-copilot/hosts.json` (Windows)
   - `~/.config/github-copilot/apps.json`

The credential files contain `oauth_token` values under `github.com` keys.

**Step 2**: Exchange the GitHub OAuth token for a Copilot bearer token:

```
GET https://api.github.com/copilot_internal/v2/token
Authorization: Token <github_oauth_token>
User-Agent: OpenCode/1.0
```

**Response**:

```json
{
  "token": "<copilot_bearer_token>",
  "expires_at": 1710000000
}
```

**Step 3**: Use the bearer token as the API key for all subsequent requests to `api.githubcopilot.com`:

```
Authorization: Bearer <copilot_bearer_token>
Editor-Version: OpenCode/1.0
Editor-Plugin-Version: OpenCode/1.0
Copilot-Integration-Id: vscode-chat
```

### Token Refresh

The bearer token is short-lived. On 401 responses, the client automatically re-exchanges the GitHub token for a fresh bearer token and retries.

---

## 2. Available Models Through Copilot API

All models are accessed via the OpenAI Chat Completions format. The `APIModel` field shows what model ID is sent in the request:

| Display Name               | API Model ID                | Context Window | Notes             |
| -------------------------- | --------------------------- | -------------- | ----------------- |
| GPT-3.5-turbo              | `gpt-3.5-turbo`             | 16,384         |                   |
| GPT-4                      | `gpt-4`                     | 32,768         |                   |
| GPT-4o                     | `gpt-4o`                    | 128,000        |                   |
| GPT-4o Mini                | `gpt-4o-mini`               | 128,000        |                   |
| GPT-4.1                    | `gpt-4.1`                   | 128,000        | Reasoning support |
| Claude 3.5 Sonnet          | `claude-3.5-sonnet`         | 90,000         |                   |
| Claude 3.7 Sonnet          | `claude-3.7-sonnet`         | 200,000        |                   |
| Claude 3.7 Sonnet Thinking | `claude-3.7-sonnet-thought` | 200,000        | Reasoning support |
| Claude Sonnet 4            | `claude-sonnet-4`           | 128,000        |                   |
| o1                         | `o1`                        | 200,000        | Reasoning support |
| o3-mini                    | `o3-mini`                   | 200,000        | Reasoning support |
| o4-mini                    | `o4-mini`                   | 128,000        | Reasoning support |
| Gemini 2.0 Flash           | `gemini-2.0-flash-001`      | 1,000,000      |                   |
| Gemini 2.5 Pro             | `gemini-2.5-pro`            | 128,000        |                   |

**Pricing**: All models cost $0.00 -- included in GitHub Copilot subscription.

**Models endpoint**: `https://api.githubcopilot.com/models` (mentioned in code comments for dynamic model discovery).

---

## 3. Claude Models Through Copilot: Special Handling

opencode has a special `isAnthropicModel()` check and a "monkeypatch adapter" for Claude models accessed through Copilot:

```go
var CopilotAnthropicModels = []ModelID{
    CopilotClaude35,    // claude-3.5-sonnet
    CopilotClaude37,    // claude-3.7-sonnet
    CopilotClaude37Thought,  // claude-3.7-sonnet-thought
    CopilotClaude4,     // claude-sonnet-4
}
```

The monkeypatch handles **multi-tool-use streaming** for Claude models. When streaming responses from Claude (especially Sonnet 4), the tool call deltas are accumulated manually because the OpenAI-format streaming from Copilot's Claude adapter apparently has issues with multi-tool-use responses that need special accumulation logic.

---

## 4. Why This Cannot Work with Claude Agent SDK Directly

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) uses the **Anthropic Messages API format**, which is fundamentally different from OpenAI Chat Completions:

| Aspect         | Anthropic Messages API                                               | OpenAI Chat Completions                              |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Endpoint       | `/v1/messages`                                                       | `/v1/chat/completions`                               |
| Auth header    | `x-api-key` or `Authorization: Bearer`                               | `Authorization: Bearer`                              |
| Request format | `{ model, messages: [{role, content: [{type, text}]}], max_tokens }` | `{ model, messages: [{role, content}], max_tokens }` |
| Streaming      | Server-sent events with `message_start`, `content_block_delta`, etc. | Server-sent events with `choices[0].delta`           |
| Tool calls     | `tool_use` content blocks                                            | `tool_calls` array on message                        |
| System prompt  | Top-level `system` field                                             | System message in `messages` array                   |

Since `api.githubcopilot.com` speaks OpenAI protocol only, setting `ANTHROPIC_BASE_URL=https://api.githubcopilot.com` would result in protocol mismatch errors.

---

## 5. GitHub Copilot SDK (Official)

GitHub has an official **Copilot SDK** in Technical Preview: https://github.com/github/copilot-sdk

- Uses **JSON-RPC** protocol (not REST)
- Communicates with Copilot CLI running in server mode
- Available for Node.js/TypeScript, Python, Go, .NET
- Supports BYOK (Bring Your Own Key) for OpenAI, Azure, Anthropic
- Auth: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` env vars

This SDK is a completely different approach -- it wraps the Copilot CLI as a local server and communicates via JSON-RPC, rather than making direct HTTP calls to `api.githubcopilot.com`.

---

## 6. Claude Code + Copilot Integration (VS Code)

From Claude Code issue #31833, there is a separate integration path:

- Claude Code extension runs a **local Language Model Server** on `http://localhost:2573`
- This acts as a "Claude Copilot Proxy" bridging GitHub Copilot Chat to Claude's API
- Issues exist with model name mapping (`claude-opus-4.6` not recognized)
- This is a VS Code extension-level integration, not a direct API proxy

There is also issue #20761 requesting Copilot SDK support in Claude Code CLI, but it has no implementation yet.

---

## 7. Integration Options for Ptah Extension

### Option A: Direct OpenAI-Protocol Integration (Recommended)

Follow opencode's approach:

1. Get GitHub token from `github-copilot/hosts.json` or `GITHUB_TOKEN`
2. Exchange for Copilot bearer token via `https://api.github.com/copilot_internal/v2/token`
3. Create an OpenAI-compatible client pointing to `https://api.githubcopilot.com`
4. Send requests using OpenAI Chat Completions format
5. Add special handling for Claude model streaming (multi-tool-use monkeypatch)

**Pros**: Proven approach, access to all 14 models, zero cost
**Cons**: Requires a new provider implementation (OpenAI protocol), cannot reuse Claude Agent SDK directly

### Option B: VS Code Language Model API

Use the VS Code `vscode.lm` API to access Copilot models:

- `vscode.lm.selectChatModels()` to discover available models
- Proprietary VS Code API format (not OpenAI or Anthropic)
- Limited to `gpt-4o`, `gpt-4o-mini`, `o1`, `o1-mini`, `claude-3.5-sonnet`
- Already partially explored in Ptah's `llm-abstraction` library

**Pros**: Official VS Code integration, no token management
**Cons**: Limited model selection, proprietary API, no tool use support in the LM API

### Option C: Copilot SDK (JSON-RPC)

Use GitHub's official Copilot SDK:

- Requires Copilot CLI installed
- JSON-RPC communication with CLI server
- Technical Preview status

**Pros**: Official SDK, full feature support
**Cons**: Requires CLI binary, JSON-RPC adds complexity, preview status

---

## 8. Key URLs and References

| Resource                      | URL                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| opencode Copilot provider     | `https://github.com/opencode-ai/opencode/blob/main/internal/llm/provider/copilot.go` |
| opencode Copilot models       | `https://github.com/opencode-ai/opencode/blob/main/internal/llm/models/copilot.go`   |
| opencode GitHub token loading | `LoadGitHubToken()` in `internal/config/config.go`                                   |
| Copilot API base URL          | `https://api.githubcopilot.com`                                                      |
| Token exchange endpoint       | `https://api.github.com/copilot_internal/v2/token`                                   |
| Models discovery endpoint     | `https://api.githubcopilot.com/models`                                               |
| GitHub Copilot SDK            | `https://github.com/github/copilot-sdk`                                              |
| Claude Code Copilot issue     | `https://github.com/anthropics/claude-code/issues/20761`                             |
| Claude Code model mapping bug | `https://github.com/anthropics/claude-code/issues/31833`                             |

---

## 9. Token File Locations (for Auto-Detection)

```typescript
// GitHub Copilot stores OAuth tokens in these files:

// Linux/macOS:
// ~/.config/github-copilot/hosts.json
// ~/.config/github-copilot/apps.json

// Windows:
// %LOCALAPPDATA%/github-copilot/hosts.json
// %LOCALAPPDATA%/github-copilot/apps.json

// XDG override:
// $XDG_CONFIG_HOME/github-copilot/hosts.json
// $XDG_CONFIG_HOME/github-copilot/apps.json

// File format:
{
  "github.com": {
    "oauth_token": "gho_xxxxxxxxxxxx"
  }
}
```

---

## 10. Required HTTP Headers

```typescript
// Headers required for Copilot API requests:
{
  "Authorization": `Bearer ${copilotBearerToken}`,
  "Editor-Version": "Ptah/1.0",
  "Editor-Plugin-Version": "Ptah/1.0",
  "Copilot-Integration-Id": "vscode-chat",
  "Content-Type": "application/json"
}
```

---

## Conclusion

The hypothesis that GitHub Copilot exposes an Anthropic-compatible API is **disproven**. Copilot's API at `api.githubcopilot.com` uses the OpenAI Chat Completions protocol exclusively, even for Claude models. To integrate Copilot as a provider in Ptah, a new OpenAI-protocol provider implementation is needed, following the proven pattern from opencode. The authentication flow (GitHub token -> Copilot bearer token exchange) is well-documented in opencode's source code and can be directly adapted.
