# Requirements Document - TASK_2025_076

## Introduction

The Angular frontend Settings component currently shows empty input fields for OAuth tokens and API keys, failing to reflect whether credentials are already configured in VS Code. Users have tokens installed (e.g., Claude OAuth token via `claude setup-token`) but the UI doesn't indicate this, causing confusion about authentication status.

**Business Value**: Users need immediate visual feedback about their authentication state to make informed decisions about whether to update credentials or troubleshoot connection issues. The security model must ensure tokens are never exposed to the frontend—only existence flags.

## Task Classification

- **Type**: FEATURE (enhancement to existing Settings component)
- **Priority**: P1-High (impacts user experience and onboarding)
- **Complexity**: Medium (backend RPC + frontend state management)
- **Estimated Effort**: 3-4 hours

## Workflow Dependencies

- **Research Needed**: No (patterns exist in `LlmRpcHandlers.getProviderStatus()`)
- **UI/UX Design Needed**: No (enhancement to existing component with clear requirements)

---

## Requirements

### Requirement 1: Secure Auth Status RPC Endpoint

**User Story**: As a VS Code extension developer, I want a secure RPC method that returns authentication status flags without exposing actual credentials, so that the frontend can display correct status while maintaining security.

#### Acceptance Criteria

1. WHEN `auth:getAuthStatus` RPC method is called THEN it SHALL return `{ hasOAuthToken: boolean, hasApiKey: boolean, authMethod: 'oauth' | 'apiKey' | 'auto' }` within 100ms
2. WHEN OAuth token exists in VS Code settings (`ptah.claudeOAuthToken`) THEN `hasOAuthToken` SHALL be `true`
3. WHEN Anthropic API key exists in VS Code settings (`ptah.anthropicApiKey`) THEN `hasApiKey` SHALL be `true`
4. WHEN neither credential is configured THEN both flags SHALL be `false`
5. WHEN RPC method executes THEN actual token/key values SHALL NEVER be included in response (security-critical)
6. WHEN VS Code settings include empty strings for credentials THEN existence flags SHALL be `false` (not truthy for empty)

---

### Requirement 2: Frontend Auth Status Display

**User Story**: As a Ptah extension user, I want the Settings page to show visual indicators when my credentials are already configured, so that I know my authentication is set up without having to test the connection.

#### Acceptance Criteria

1. WHEN `AuthConfigComponent` initializes THEN it SHALL call `auth:getAuthStatus` RPC method
2. WHEN `hasOAuthToken` is `true` THEN OAuth token input field SHALL display visual indicator (✓ checkmark badge or "Configured" placeholder)
3. WHEN `hasApiKey` is `true` THEN API key input field SHALL display visual indicator (✓ checkmark badge)
4. WHEN user clears an input field and saves THEN the visual indicator SHALL be removed
5. WHEN RPC call fails THEN component SHALL gracefully degrade (show empty state, no crash)
6. WHEN credentials exist THEN input placeholder SHALL show "Token configured - enter new value to replace"

---

### Requirement 3: Auth Method Sync from Backend

**User Story**: As a Ptah extension user, I want the Settings page to show my current authentication method preference, so that I don't have to remember what I previously selected.

#### Acceptance Criteria

1. WHEN `AuthConfigComponent` initializes THEN `authMethod` radio selection SHALL reflect value from `auth:getAuthStatus` response
2. WHEN user changes auth method and saves THEN selection SHALL persist and reload correctly on next visit
3. WHEN VS Code settings have no `authMethod` THEN default SHALL be `'auto'`

---

### Requirement 4: Clear/Remove Credential Action

**User Story**: As a Ptah extension user, I want to be able to clear my saved credentials from the Settings page, so that I can remove authentication without editing VS Code settings directly.

#### Acceptance Criteria

1. WHEN credential exists AND user submits empty value for that field THEN credential SHALL be cleared from SecretStorage
2. WHEN credential is cleared THEN visual indicator SHALL update to reflect "not configured" state
3. WHEN clear operation completes THEN success message SHALL confirm the action

---

### Requirement 5: SecretStorage Migration (Security Enhancement)

**User Story**: As a security-conscious user, I want my OAuth tokens and API keys stored in VS Code's encrypted SecretStorage instead of plain text settings.json, so that my credentials are protected even if someone accesses my VS Code settings file.

#### Acceptance Criteria

1. WHEN `auth:saveSettings` saves credentials THEN they SHALL be stored in SecretStorage (NOT ConfigManager)
2. WHEN `auth:getAuthStatus` checks for credentials THEN it SHALL check SecretStorage first, then fall back to ConfigManager for migration
3. WHEN credentials exist in old ConfigManager location THEN they SHALL be migrated to SecretStorage on first access
4. WHEN migration completes THEN old plain-text values SHALL be cleared from ConfigManager
5. WHEN checking credential existence THEN `hasOAuthToken`/`hasApiKey` SHALL use SecretStorage API (`context.secrets.get()`)
6. WHEN storing credentials THEN they SHALL use SecretStorage API (`context.secrets.store()`)

**Storage Keys**:

- OAuth Token: `ptah.auth.claudeOAuthToken`
- API Key: `ptah.auth.anthropicApiKey`

---

## Non-Functional Requirements

### Performance

- RPC Response Time: `auth:getAuthStatus` completes in <100ms (95th percentile)
- Component Init: Settings page loads with status indicators in <500ms

### Security

- **Critical**: Token/key values NEVER transmitted from backend to frontend
- **Critical**: Only boolean existence flags returned via RPC
- **Critical**: Logging NEVER includes actual credential values (mask with `***`)
- Input fields use `type="password"` to hide entered values

### Reliability

- Graceful degradation: If RPC fails, show empty state (no crash)
- Error handling: Display user-friendly error message on connection failure

### Accessibility

- ARIA labels for status indicators (`aria-label="OAuth token configured"`)
- Visual indicators have sufficient color contrast

---

## Stakeholder Analysis

- **End Users**: VS Code users configuring authentication for first time or troubleshooting
- **Security-conscious Users**: Need assurance that credentials aren't exposed in webview
- **Developers**: Need clear patterns for secure credential handling

---

## Risk Analysis

### Technical Risks

**Risk 1**: ~~Existing `auth:saveSettings` stores tokens in plain VS Code settings (not SecretStorage)~~

**CLARIFICATION**: After investigation, there are **two credential systems**:

- ✅ **LLM Provider API Keys** (`LlmSecretsService`) - Uses SecretStorage (encrypted)
- ❌ **SDK Auth Credentials** (`ptah.claudeOAuthToken`, `ptah.anthropicApiKey`) - Uses ConfigManager (plain text in settings.json)

**Decision**: Migrate SDK auth credentials to SecretStorage for consistency and security.

- Probability: N/A (design decision)
- Impact: High (security improvement)
- Implementation: Extend `LlmSecretsService` or create dedicated `AuthSecretsService`
- Migration: Read from old ConfigManager location, store in SecretStorage, clear old value

**Risk 2**: Race condition between status fetch and settings save

- Probability: Low
- Impact: Low (UI shows stale state temporarily)
- Mitigation: Refetch status after successful save
- Contingency: User can manually refresh

---

## Dependencies

### Technical Dependencies

- `ConfigManager` from `@ptah-extension/vscode-core` - Already available, used by `auth:saveSettings`
- `RpcHandler` from `@ptah-extension/vscode-core` - Already registered in DI

### Existing Patterns to Follow

- `LlmRpcHandlers.getProviderStatus()` - Returns `isConfigured: boolean` per provider
- `auth:saveSettings` RPC handler - Validates and saves credentials
- `LlmSecretsService.hasApiKey()` - Pattern for checking existence without returning value

---

## Success Metrics

1. **Metric 1**: Settings page correctly shows "Configured" indicator when OAuth token exists
2. **Metric 2**: Settings page correctly shows "Configured" indicator when API key exists
3. **Metric 3**: Zero credential values appear in RPC responses or frontend logs
4. **Metric 4**: Auth method selection persists across Settings page visits
5. **Metric 5**: Credentials stored in SecretStorage (not visible in settings.json)

---

## Implementation Scope

### Files to Modify

| File                                                                         | Change                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/types/rpc.types.ts`                                     | Add `AuthGetStatusParams`, `AuthGetStatusResponse` types                                |
| `libs/backend/vscode-core/src/services/auth-secrets.service.ts`              | **[NEW]** SecretStorage wrapper for OAuth/API key (following LlmSecretsService pattern) |
| `libs/backend/vscode-core/src/di/tokens.ts`                                  | Add `AUTH_SECRETS_SERVICE` token                                                        |
| `libs/backend/vscode-core/src/di/register.ts`                                | Register `AuthSecretsService`                                                           |
| `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts` | Update `auth:saveSettings` to use SecretStorage, add `auth:getAuthStatus`               |
| `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`                     | Read OAuth token from SecretStorage instead of ConfigManager                            |
| `libs/frontend/chat/src/lib/settings/auth-config.component.ts`               | Add status fetch on init, status signals                                                |
| `libs/frontend/chat/src/lib/settings/auth-config.component.html`             | Add visual indicators for configured status                                             |

### Implementation Order

1. Create `AuthSecretsService` in vscode-core (following `LlmSecretsService` pattern)
2. Add RPC types to shared library
3. Update `auth:saveSettings` to store in SecretStorage
4. Implement `auth:getAuthStatus` RPC handler with migration logic
5. Update `AuthManager` to read from SecretStorage
6. Update frontend component to fetch and display status
7. Add visual indicators to template
8. Test end-to-end flow including migration from old settings

---

## Out of Scope

- LLM provider API key status (covered by existing `LlmRpcHandlers.getProviderStatus()`)
- Token validation/format checking on status endpoint (only existence check)
