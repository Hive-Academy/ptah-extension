# TASK_2025_133: Settings/Auth Provider Architecture Refactoring

## Task Type: REFACTORING

## Strategy: Architect → Team-Leader → QA

## Created: 2026-02-02

---

## User Intent

Refactor the settings/auth provider architecture to fix scattered state management between SettingsComponent, AuthConfigComponent, and ProviderModelSelectorComponent. The code logic review scored the current architecture 4/10 with 13 issues (4 critical, 5 serious, 4 moderate).

The root cause is **duplicated auth state ownership** between SettingsComponent and AuthConfigComponent — both independently call `auth:getAuthStatus`, store results in separate signals, and communicate only through a single `authStatusChanged` event.

---

## Code Logic Review Findings (Score: 4/10)

### Critical Issues (4)

1. **Delete targets wrong provider** — `deleteOpenRouterKey()` doesn't send `anthropicProviderId`, so backend deletes the persisted provider's key, not the UI-selected one (data loss risk)
2. **Dual independent state** — Both SettingsComponent and AuthConfigComponent fetch and cache the same auth data independently, drifting out of sync between refreshes
3. **`showProviderModels` ignores auth method** — Provider Model Mapping section visible even when user switches to OAuth/API Key (should only show for provider auth method)
4. **Provider switch blindly resets key badge** — `onProviderChange()` sets `hasExistingOpenRouterKey = false` without checking if the new provider already has a key stored

### Serious Issues (5)

5. Connection test uses hardcoded 1-second delay (unreliable)
6. No concurrent guard on `saveAndTest()` (double-click race condition)
7. Inner `fetchAuthStatus()` catch silently degrades (no user error feedback)
8. Shared `searchQuery` across all three tier inputs in model selector
9. No error feedback for `selectModel`/`clearTier` failures in model selector

### Moderate Issues (4)

10. Misleading signal names — `openrouterKey`, `hasExistingOpenRouterKey`, `hasOpenRouterKey` used for ALL providers
11. SettingsComponent does not track `authMethod` at all
12. No input validation for provider keys using `keyPrefix` from registry
13. Memory leak potential in ProviderModelSelector effect (no AbortController)

---

## User's Specific Pain Points

- Switching provider dropdown causes UI to snap back to persisted state
- "Configured" badge shows incorrectly for providers without keys
- Model selector loads wrong provider's models (347 OpenRouter models for Z.AI)
- Provider model mapping section visible when using OAuth auth method
- Delete key operation could target wrong provider (data loss)

---

## Recommended Architecture (from Review)

Introduce a **shared `AuthStateService`** (injectable, providedIn: 'root') to be the single source of truth for all auth state:

- Maintain `Map<string, boolean>` of per-provider key status
- Both SettingsComponent and AuthConfigComponent read from this service
- All mutations go through this service
- Service handles RPC calls to backend

---

## Files Involved

### Frontend (Primary)

- `libs/frontend/chat/src/lib/settings/auth-config.component.ts` + `.html`
- `libs/frontend/chat/src/lib/settings/settings.component.ts` + `.html`
- `libs/frontend/chat/src/lib/settings/provider-model-selector.component.ts`
- NEW: `libs/frontend/core/src/lib/services/auth-state.service.ts` (shared service)

### Backend (Supporting)

- `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/provider-rpc.handlers.ts`

### Shared Types

- `libs/shared/src/lib/types/rpc.types.ts`

---

## Constraints

- Angular 20+ with zoneless change detection, signals (no RxJS)
- Atomic Design pattern for components
- ChangeDetectionStrategy.OnPush on all components
- DaisyUI + Tailwind for styling
- Must support 3 providers: OpenRouter, Moonshot, Z.AI
- Must support 3 auth methods: OAuth, API Key, Provider Key
- VS Code SecretStorage for per-provider API key storage (`ptah.auth.provider.{providerId}`)
- VS Code configuration API for model tier settings (`ptah.provider.{id}.modelTier.{tier}`)
