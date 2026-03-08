# Task Context - TASK_2025_079

## User Intent

Implement conditional settings visibility and premium feature gating:

1. **Conditional Settings Visibility**: Settings sections (model selection, autopilot, MCP port) should only be visible after user has configured OAuth token or API key
2. **Premium Feature Gating**: MCP port setting and LLM provider configurations should only be visible for premium users (early_adopter tier)
3. **Key Binding**: Ensure LLM provider API keys are properly bound for MCP server calls and agent wizard functionality

## Conversation Summary

- Fixed DI registration error for `SetupRpcHandlers` and `LlmRpcHandlers` (changed to factory pattern)
- Identified security issue: OAuth token and API keys were showing in plain text in VS Code Settings UI
- Removed sensitive settings from `package.json`: `ptah.claudeOAuthToken`, `ptah.anthropicApiKey`, and all `ptah.llm.*` provider settings
- Backend services already exist for SecretStorage: `AuthSecretsService`, `LlmSecretsService`
- RPC handlers exist: `auth:getAuthStatus`, `llm:getProviderStatus`, `llm:setApiKey`, etc.
- License system exists with `free` and `early_adopter` tiers

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-16
- Type: FEATURE (Settings UI Enhancement + Premium Gating)
- Complexity: Medium (Multiple files, frontend + backend coordination)

## Current State Analysis

### Existing Components

1. **AuthSecretsService** (`libs/backend/vscode-core/src/services/auth-secrets.service.ts`)

   - Stores OAuth token and API key in SecretStorage
   - Exposes `hasCredential()` for boolean-only checks

2. **LlmSecretsService** (`libs/backend/llm-abstraction/src/lib/services/llm-secrets.service.ts`)

   - Stores LLM provider API keys in SecretStorage
   - Keys: `ptah.llm.<provider>.apiKey`

3. **LicenseService** (`libs/backend/vscode-core/src/services/license.service.ts`)

   - Verifies license with server
   - Tiers: `free` (default), `early_adopter` (premium)
   - Premium features: MCP Server (already gated in main.ts)

4. **AuthConfigComponent** (`libs/frontend/chat/src/lib/settings/auth-config.component.ts`)

   - Already uses `auth:getAuthStatus` RPC
   - Shows "Configured" badges for existing credentials

5. **SettingsComponent** (`libs/frontend/chat/src/lib/settings/settings.component.ts`)
   - Currently only contains AuthConfigComponent
   - Has TODO comments for Model Selection and Autopilot sections

### Missing Pieces

1. **License RPC Handler**: No RPC method to get license status from frontend
2. **Settings Visibility Logic**: No conditional rendering based on auth status
3. **LLM Settings Component**: No UI for LLM provider API key management
4. **Premium Feature Guards**: Need frontend checks for premium-only sections

## Execution Strategy

### Phase 1: Backend - Add License RPC Handler

- Add `license:getStatus` RPC method
- Return tier, validity, and feature flags

### Phase 2: Frontend - Add License Status Support

- Add license status to settings component
- Create computed signals for visibility

### Phase 3: Frontend - Conditional Settings Visibility

- Show Model Selection and Autopilot only after auth configured
- Show MCP port and LLM settings only for premium users

### Phase 4: Frontend - LLM Settings Component

- Create component for LLM provider API key management
- Use existing `llm:getProviderStatus`, `llm:setApiKey` RPC methods

### Phase 5: Verification

- Test with free tier (no premium sections)
- Test with premium tier (all sections visible)
- Verify MCP server uses LLM keys correctly

## Files to Modify

### Backend

- `libs/shared/src/lib/types/rpc.types.ts` - Add license RPC types
- `apps/ptah-extension-vscode/src/services/rpc/handlers/` - Add license RPC handler

### Frontend

- `libs/frontend/chat/src/lib/settings/settings.component.ts` - Add visibility logic
- `libs/frontend/chat/src/lib/settings/settings.component.html` - Conditional sections
- `libs/frontend/chat/src/lib/settings/llm-config.component.ts` - New component
- `libs/frontend/chat/src/lib/settings/llm-config.component.html` - New template
