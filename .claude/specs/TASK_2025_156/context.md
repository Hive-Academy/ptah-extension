# Task Context - TASK_2025_156

## User Request

Replace custom Google OAuth (own client ID/secret requiring Google Cloud app publishing) with CLI-based auth for Gemini and OpenAI Codex. Integrate subscription-based CLI tools as auth providers, matching the existing Claude Agent SDK pattern where the user already has a subscription and Ptah reuses their credentials.

### Key Requirements

1. **Gemini CLI Auth**: Use `@google/gemini-cli-core` to read `~/.gemini/oauth_creds.json` (authType: 'oauth-personal', PKCE, no client secret needed)
2. **OpenAI Codex CLI Auth**: Use `@openai/codex-sdk` to read `~/.codex/auth.json` (ChatGPT OAuth)
3. **Keep BYOK API Key**: As parallel fallback for both providers
4. **Remove Custom Google OAuth**: Delete `GoogleOAuthService` with own client ID/secret and `PtahGoogleAuthProvider`
5. **No Google Cloud App**: Avoid needing to publish/verify a Google Cloud OAuth application
6. **Route Through MCP**: Use existing ptah.ai.chat() and ptah.image.generate() infrastructure
7. **ESM Handling**: Both packages are ESM-only, use dynamic import + caching (like google-genai-loader.ts, sdk-module-loader.ts)

### Research Findings (from conversation)

- Gemini CLI stores OAuth tokens at `~/.gemini/oauth_creds.json`
- Gemini CLI uses Google's public OAuth client ID (681255809395-...) with PKCE (no client secret)
- `@google/gemini-cli-core` supports authType: 'oauth-personal' for reusing cached credentials
- OpenAI Codex stores tokens at `~/.codex/auth.json` (or OS keyring)
- `@openai/codex-sdk` supports "external auth mode" accepting ChatGPT auth tokens
- Community providers (ai-sdk-provider-gemini-cli, Roo-Code) demonstrate the pattern
- Both use `cloudcode-pa.googleapis.com` (Gemini) and ChatGPT OAuth (Codex) respectively

### Architecture Goal

```
Claude Agent SDK  ← Claude Pro/Max subscription
@google/gemini-cli-core ← Google One AI Pro Plan (Gemini CLI auth)
@openai/codex-sdk ← ChatGPT Plus/Pro (Codex CLI auth)
VS Code LM API   ← Copilot subscription
  ↓
Ptah Provider Abstraction (ILlmProvider)
  ↓
Ptah MCP Server (ptah.ai.chat, ptah.image.generate)
```

## Task Type

FEATURE

## Complexity Assessment

Complex (multi-library auth rewrite, 2 new SDK integrations, frontend UI changes)

## Strategy Selected

FEATURE: PM -> Architect -> Team-Leader -> QA

## Conversation Summary

- User observed `this.apiKey.startsWith is not a function` error in image generation (fixed in prior work)
- User explained vision: piggyback off CLI auth (Gemini CLI, Codex CLI) instead of custom OAuth apps
- Research confirmed Gemini CLI uses public PKCE client (no secret), tokens at ~/.gemini/oauth_creds.json
- Research confirmed Codex CLI stores tokens at ~/.codex/auth.json with external auth mode support
- Current GoogleOAuthService has custom client ID/secret (google-oauth.service.ts:19-21) — to be removed
- Pattern should match existing Claude Agent SDK integration (subscription CLI provides auth, Ptah orchestrates)

## Related Tasks

- TASK_2025_155: SDK-only migration (current branch, Google GenAI provider rewrite)
- TASK_2025_091: OpenRouter Integration & Model Selection
- TASK_2025_073: LLM Abstraction Remediation
- TASK_2025_076: Settings VS Code Secrets Sync

## Created

2026-02-20
