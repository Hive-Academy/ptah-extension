# TASK_2025_076: Settings VS Code Secrets Sync

**Created**: 2025-12-15
**Type**: FEATURE (enhancement)
**Priority**: P1 - High

## User Request

The Angular frontend settings component should reflect the existence of current VS Code secrets without exposing any sensitive values. Currently, the settings show empty input fields even when the user has a Claude OAuth token installed.

**Key Requirements:**

1. **Show secrets existence status** - Display flag indicators (true/false) for whether sensitive tokens are configured
2. **Never expose actual token values** - Backend only returns existence flags for sensitive data
3. **Sync with VS Code configuration** - Synchronize non-sensitive VS Code settings with frontend
4. **Security-first approach** - Only allow saving tokens (not reading them back), return only boolean flags for sensitive options

## Current State Analysis

### Frontend Components

- `libs/frontend/chat/src/lib/settings/settings.component.ts` - Main settings container
- `libs/frontend/chat/src/lib/settings/auth-config.component.ts` - Authentication configuration form
  - Currently shows empty input fields for OAuth token and API key
  - No mechanism to check if secrets already exist
  - Uses RPC calls: `auth:saveSettings`, `auth:testConnection`

### Backend Services

- `libs/backend/llm-abstraction/src/lib/services/llm-secrets.service.ts` - Manages API keys in VS Code SecretStorage
  - Has `hasApiKey(provider)` method that returns boolean
  - Has `getConfiguredProviders()` method
- `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` - RPC handlers for LLM operations
  - Has `getProviderStatus()` returning `isConfigured` boolean per provider
- `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts` - Handles Claude OAuth token configuration
  - Reads from `ptah.claudeOAuthToken` VS Code setting

### Key Secrets/Tokens to Track

1. **Claude OAuth Token** (`ptah.claudeOAuthToken`) - For Claude Max/Pro subscription
2. **Anthropic API Key** (`ptah.anthropicApiKey`) - For pay-per-token usage
3. **LLM Provider API Keys** - Via `LlmSecretsService` (anthropic, openai, google-genai, openrouter)

## Technical Approach

### Security Model

- **Write-only for secrets**: Frontend can save tokens to backend
- **Boolean flags for existence**: Backend returns only `hasOAuthToken: boolean`, `hasApiKey: boolean`
- **Non-sensitive config is readable**: Settings like `authMethod` can be synced bidirectionally

### Required Changes

1. **New RPC Method**: `settings:getAuthStatus`

   - Returns: `{ hasOAuthToken: boolean, hasApiKey: boolean, authMethod: string }`
   - Never returns actual token values

2. **Frontend Enhancement**:

   - On component init, call `settings:getAuthStatus`
   - Show visual indicators when tokens are configured (✓ checkmark, badge, etc.)
   - Input fields show placeholder "Token configured" when exists

3. **Settings Sync Pattern**:
   - Sensitive: Write-only (save), Read-only existence flag
   - Non-sensitive: Full bidirectional sync

## Related Tasks

- TASK_2025_056: Settings UI Component (planned)
- TASK_2025_057: SDK Initialization & Auth Flow

## Files to Modify

- `libs/frontend/chat/src/lib/settings/auth-config.component.ts`
- `libs/frontend/chat/src/lib/settings/auth-config.component.html`
- `libs/backend/vscode-core/src/rpc/` (new auth status RPC handler)
- `libs/shared/src/lib/types/` (new types for auth status)
