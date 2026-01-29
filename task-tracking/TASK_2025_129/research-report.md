# Research Report: Authentication Settings Improvements (TASK_2025_129)

## Executive Summary

This report investigates three areas of the Ptah extension's authentication system:

1. **OpenRouter Premium Gating** - Currently gated as Pro-only, needs to be available to ALL users
2. **User Profile Display** - No mechanism exists to show the authenticated user's identity in the settings page
3. **Authentication Flow Architecture** - Complete mapping of the auth system end-to-end

**Key Finding**: OpenRouter gating is enforced at exactly **4 locations** across 3 files. Removing the gate requires changes to the feature-gate service, the RPC handler middleware, and the plans config. User profile display requires a new `license:getProfile` RPC endpoint that queries the license server's existing `/api/v1/licenses/me` endpoint (which already returns user data).

---

## 1. Current Authentication Architecture

### 1.1 Complete File Map

#### Backend Authentication Files

| File                                                                              | Purpose                                                                                                           | Lines |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----- |
| `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`                          | Core auth logic: configures env vars for OpenRouter, OAuth, API Key                                               | 349   |
| `libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts`                        | Watches `authMethod` config + SecretStorage credential changes, triggers re-init                                  | 135   |
| `libs/backend/vscode-core/src/services/auth-secrets.service.ts`                   | Encrypted credential storage (VS Code SecretStorage) for oauthToken, apiKey, openrouterKey                        | 233   |
| `libs/backend/vscode-core/src/services/license.service.ts`                        | License verification with server, 1-hour cache, offline grace period                                              | 641   |
| `libs/backend/vscode-core/src/services/feature-gate.service.ts`                   | Feature access control based on license tier (defines PRO_ONLY_FEATURES)                                          | 313   |
| `libs/backend/vscode-core/src/messaging/rpc-handler.ts`                           | RPC middleware: license validation + Pro-only method prefix blocking                                              | 433   |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts`       | RPC handlers: auth:getHealth, auth:getAuthStatus, auth:saveSettings, auth:testConnection                          | 267   |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/openrouter-rpc.handlers.ts` | RPC handlers: openrouter:listModels, openrouter:setModelTier, openrouter:getModelTiers, openrouter:clearModelTier | 227   |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts`    | RPC handler: license:getStatus (maps LicenseStatus to frontend response)                                          | 197   |
| `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`  | Orchestrates all RPC handler registration                                                                         | 435   |
| `apps/ptah-license-server/src/config/plans.config.ts`                             | Server-side plan definitions: community (free) and pro ($5/mo) features                                           | 95    |
| `apps/ptah-license-server/src/license/services/license.service.ts`                | Server license verification, trial creation, key generation                                                       | 401   |
| `apps/ptah-license-server/src/license/controllers/license.controller.ts`          | REST endpoints: POST /verify, GET /me (user profile + license)                                                    | 201   |

#### Frontend Authentication Files

| File                                                                         | Purpose                                                                           | Lines |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----- |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`                  | Settings container: fetches auth + license status, conditional section visibility | 247   |
| `libs/frontend/chat/src/lib/settings/settings.component.html`                | Settings template: license status card, auth section, premium sections            | 323   |
| `libs/frontend/chat/src/lib/settings/auth-config.component.ts`               | Auth form: method selection (oauth/apiKey/openrouter/auto), save & test           | 516   |
| `libs/frontend/chat/src/lib/settings/openrouter-model-selector.component.ts` | OpenRouter model tier configuration with autocomplete search                      | 457   |

### 1.2 DI Tokens Related to Authentication

| Token                              | Location                                         | Resolves To               |
| ---------------------------------- | ------------------------------------------------ | ------------------------- |
| `TOKENS.AUTH_SECRETS_SERVICE`      | `libs/backend/vscode-core/src/di/tokens.ts:105`  | `AuthSecretsService`      |
| `TOKENS.LICENSE_SERVICE`           | `libs/backend/vscode-core/src/di/tokens.ts:110`  | `LicenseService`          |
| `TOKENS.FEATURE_GATE_SERVICE`      | `libs/backend/vscode-core/src/di/tokens.ts:116`  | `FeatureGateService`      |
| `SDK_TOKENS.SDK_AUTH_MANAGER`      | `libs/backend/agent-sdk/src/lib/di/tokens.ts:20` | `AuthManager`             |
| `SDK_TOKENS.SDK_CONFIG_WATCHER`    | `libs/backend/agent-sdk/src/lib/di/tokens.ts:22` | `ConfigWatcher`           |
| `SDK_TOKENS.SDK_OPENROUTER_MODELS` | `libs/backend/agent-sdk/src/lib/di/tokens.ts:37` | `OpenRouterModelsService` |

### 1.3 Authentication Flow: Settings UI to Backend to SDK

```
[Settings UI]                    [RPC Layer]                      [Backend Services]

AuthConfigComponent              auth:saveSettings                AuthSecretsService
  |                               |                                  (SecretStorage)
  |-- onAuthMethodChange() -->    |-- validate params (Zod)          |
  |-- saveAndTest() ---------->   |-- configManager.set('authMethod')
  |                               |-- authSecretsService.setCredential()
  |                               |                                  |
  |                               |                              [SecretStorage change detected]
  |                               |                                  |
  |                               |                              ConfigWatcher
  |                               |                                  |
  |                               |                              handleConfigChange()
  |                               |                                  |
  |                               |                              reinitCallback() -> SdkAgentAdapter
  |                               |                                  |
  |                               |                              AuthManager.configureAuthentication()
  |                               |                                  |
  |                               |                              [Sets env vars]:
  |                               |                              - OpenRouter: ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN
  |                               |                              - OAuth: CLAUDE_CODE_OAUTH_TOKEN
  |                               |                              - API Key: ANTHROPIC_API_KEY
  |                               |                                  |
  |                           auth:testConnection --------> sdkAdapter.getHealth()
  |<------ success/error ---------|                                  |

SettingsComponent                license:getStatus                LicenseService
  |                               |                                  |
  |-- fetchLicenseStatus() --->   |-- licenseService.verifyLicense() |
  |<-- {tier, isPremium, ...} ----|<-- POST /api/v1/licenses/verify -|
  |                               |                                  |
  |-- showPremiumSections() = isAuthenticated() && isPremium()       |
```

### 1.4 Authentication Priority Logic (AuthManager)

The `AuthManager.configureAuthentication()` method follows a strict priority:

1. **Priority 1 - OpenRouter** (if authMethod = 'openrouter' or 'auto'): Sets `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=key`, clears `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`
2. **Priority 2 - OAuth** (if authMethod = 'oauth' or 'auto'): Sets `CLAUDE_CODE_OAUTH_TOKEN`, removes `ANTHROPIC_API_KEY`
3. **Priority 3 - API Key** (if authMethod = 'apiKey' or 'auto', and no OAuth token): Sets `ANTHROPIC_API_KEY`

### 1.5 ConfigWatcher Re-initialization Flow

The `ConfigWatcher` watches two sources:

1. **VS Code Configuration**: `authMethod` key via `ConfigManager.watch()`
2. **SecretStorage**: Keys `ptah.auth.claudeOAuthToken`, `ptah.auth.anthropicApiKey`, `ptah.auth.openrouterApiKey`

When any watched key changes, `handleConfigChange()` invokes the `reinitCallback` (which calls `SdkAgentAdapter.initialize()`), which in turn calls `AuthManager.configureAuthentication()` with the current auth method.

---

## 2. OpenRouter Gating Analysis

### 2.1 All Gating Locations (Exhaustive)

OpenRouter is gated as a Pro-only feature in **4 locations across 3 files**:

#### Location 1: Feature Gate Service - Pro-Only Feature List

**File**: `libs/backend/vscode-core/src/services/feature-gate.service.ts`
**Lines 29-35** (type definition):

```typescript
export type ProOnlyFeature =
  | 'mcp_server'
  | 'workspace_intelligence'
  | 'openrouter_proxy' // <-- THIS MUST BE REMOVED
  | 'custom_tools'
  | 'setup_wizard'
  | 'cost_tracking';
```

**Lines 59-66** (runtime array):

```typescript
const PRO_ONLY_FEATURES: readonly ProOnlyFeature[] = [
  'mcp_server',
  'workspace_intelligence',
  'openrouter_proxy', // <-- THIS MUST BE REMOVED
  'custom_tools',
  'setup_wizard',
  'cost_tracking',
] as const;
```

#### Location 2: RPC Handler - Pro-Only Method Prefix Blocking

**File**: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
**Lines 83-88**:

```typescript
const PRO_ONLY_METHOD_PREFIXES = [
  'setup-status:', // setup_wizard feature
  'setup-wizard:', // setup_wizard feature
  'wizard:', // setup_wizard feature
  'openrouter:', // openrouter_proxy feature  <-- THIS MUST BE REMOVED
] as const;
```

This is the most critical gate. It blocks ALL `openrouter:*` RPC calls (listModels, setModelTier, getModelTiers, clearModelTier) for Community tier users with error code `PRO_TIER_REQUIRED`. The `validateLicense()` method at line 327-418 checks `isProOnlyMethod()` (line 430-432) which matches method names against these prefixes.

#### Location 3: Plans Config - Server-Side Feature List

**File**: `apps/ptah-license-server/src/config/plans.config.ts`
**Lines 34-48**:

```typescript
pro: {
  name: 'Pro',
  features: [
    'all_community_features',
    'mcp_server',
    'workspace_intelligence',
    'openrouter_proxy',    // <-- MOVE TO community.features
    'custom_tools',
    'setup_wizard',
    'cost_tracking',
    'priority_support',
  ],
```

The Community plan (lines 17-31) does NOT list `openrouter_proxy` in its features. To un-gate OpenRouter, `openrouter_proxy` should be added to `community.features[]` and kept in `pro.features[]`.

#### Location 4: Comments/Documentation in rpc-handler.ts

**File**: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
**Lines 66-88**: Multiple comments reference `openrouter_proxy -> openrouter:` mapping as a Pro feature. These comments must be updated.

### 2.2 What Does NOT Gate OpenRouter

The following locations reference OpenRouter but do **NOT** gate it:

- **AuthManager** (`auth-manager.ts`): Configures OpenRouter auth environment variables. No tier check.
- **AuthSecretsService** (`auth-secrets.service.ts`): Stores/retrieves `openrouterKey`. No tier check.
- **AuthRpcHandlers** (`auth-rpc.handlers.ts`): `auth:saveSettings` and `auth:getAuthStatus` handle OpenRouter keys. These are `auth:` prefixed, which is LICENSE_EXEMPT (line 100-103 of rpc-handler.ts). No tier check.
- **ConfigWatcher** (`config-watcher.ts`): Watches OpenRouter key changes. No tier check.
- **Settings template** (`settings.component.html`): Shows OpenRouter section based on `hasOpenRouterKey()` signal (line 202), NOT based on premium status.
- **AuthConfigComponent** (`auth-config.component.ts`): OpenRouter tab is always visible in the auth method selector, regardless of tier.

### 2.3 Frontend Gating (Indirect)

The frontend does NOT directly gate OpenRouter. However:

- The `OpenRouterModelSelectorComponent` calls `openrouter:listModels` and other `openrouter:*` RPC methods
- These RPC calls are blocked at the RPC middleware level for Community users (returns `PRO_TIER_REQUIRED`)
- The component would show an error when RPC calls fail

So the primary gating is at the RPC middleware level. The frontend shows the OpenRouter section whenever the key is configured, but the model tier configuration fails for non-Pro users.

### 2.4 Summary of Required Changes for Un-gating

| #   | File                                                            | Change                                                                               | Risk                                    |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | `libs/backend/vscode-core/src/services/feature-gate.service.ts` | Remove `'openrouter_proxy'` from `ProOnlyFeature` type and `PRO_ONLY_FEATURES` array | LOW - Type narrowing only               |
| 2   | `libs/backend/vscode-core/src/messaging/rpc-handler.ts`         | Remove `'openrouter:'` from `PRO_ONLY_METHOD_PREFIXES`; update comments              | **MEDIUM** - Core RPC middleware change |
| 3   | `apps/ptah-license-server/src/config/plans.config.ts`           | Add `'openrouter_proxy'` to `community.features[]`                                   | LOW - Server config                     |
| 4   | `libs/backend/vscode-core/src/messaging/rpc-handler.ts`         | Update JSDoc comments referencing openrouter as Pro-only                             | LOW - Documentation                     |

---

## 3. User Profile / Identity Analysis

### 3.1 Available User Data from License Server

The license server's `GET /api/v1/licenses/me` endpoint (requires JWT auth) already returns rich user data:

```typescript
// From license.controller.ts lines 136-199
{
  user: {
    email: string;           // e.g., "user@example.com"
    firstName: string | null; // e.g., "John"
    lastName: string | null;  // e.g., "Doe"
    memberSince: string;     // ISO 8601 timestamp
    emailVerified: boolean;  // Whether email is verified
  },
  plan: string;              // "community" | "pro"
  planName: string;          // "Community" | "Pro"
  planDescription: string;   // "Free visual editor for Claude Code"
  status: string;            // "active" | "none"
  expiresAt: string | null;
  daysRemaining: number | undefined;
  licenseCreatedAt: string;
  features: string[];
  subscription: {
    status: string;          // "active" | "trialing" | "canceled"
    currentPeriodEnd: string;
    canceledAt: string | null;
  } | null
}
```

**User Model Fields** (from Prisma schema `User.ts`):

- `id: string` (UUID)
- `workosId: string | null` (WorkOS SSO integration)
- `paddleCustomerId: string | null` (Paddle payment)
- `email: string` (required)
- `firstName: string | null`
- `lastName: string | null`
- `emailVerified: boolean`
- `createdAt: Date`
- `updatedAt: Date`
- Relations: `licenses[]`, `subscriptions[]`

### 3.2 Current License Verification Flow (What Gets Returned to Extension)

The current `license:getStatus` RPC method calls `LicenseService.verifyLicense()` which uses `POST /api/v1/licenses/verify`. This endpoint returns:

```typescript
// LicenseVerificationResponse (server-side)
{
  valid: boolean;
  tier: 'community' | 'pro' | 'trial_pro' | 'expired';
  plan?: { name, features, expiresAfterDays, isPremium, description };
  expiresAt?: string;
  daysRemaining?: number;
  trialActive?: boolean;
  trialDaysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
}
```

**Critically, this does NOT include any user identity data** (email, name). The `/verify` endpoint is a public endpoint that takes a license key and returns plan status. It does not return the user who owns the license.

### 3.3 What the SDK Provides After Auth

The Claude Agent SDK authentication (`AuthManager`) only manages environment variables for API access. It does NOT provide any user identity information. The SDK authenticates with:

- OpenRouter: API key (no user identity)
- OAuth token: Claude subscription token (no user email/name exposed)
- API key: Anthropic console key (no user identity)

**Conclusion**: The SDK provides zero user identity data.

### 3.4 Current Settings Page Structure

The settings page (`settings.component.html`) has this structure:

1. **Header** - "Settings" title + tier badge (Pro/Free)
2. **License Status Card** - Tier badge, validity, trial info, action buttons
3. **Authentication Section** - AuthConfigComponent (always visible)
4. **Model Selection** - (after auth configured)
5. **OpenRouter Models** - (after OpenRouter key configured)
6. **Autopilot Mode** - (after auth configured)
7. **Pro Features Section** - MCP Port, LLM Providers (Pro-only)
8. **Premium Upsell** - (for free users after auth)

**There is NO user profile section** anywhere in the current settings page.

### 3.5 Approach for Adding User Profile Display

#### Option A: Extend license:getStatus Response (Recommended)

Modify the license verification to also return user data when a license key is present. This requires:

1. **Server-side**: The `/api/v1/licenses/verify` endpoint already queries the user (line 101-113 in `license.service.ts` - `include: { user: { include: { subscriptions } } }`). Add user email/name to the response.

2. **Client-side LicenseService** (`libs/backend/vscode-core/src/services/license.service.ts`): Parse the additional `user` field from the server response and include it in `LicenseStatus`.

3. **License RPC Handler** (`license-rpc.handlers.ts`): Forward the user data in `LicenseGetStatusResponse`.

4. **Settings UI** (`settings.component.ts` + `.html`): Display user profile in the License Status Card.

**Pros**: Single API call (verify already happens), no new auth flow needed, works with existing license key.
**Cons**: Community users without a license key won't have profile data (they never registered).

#### Option B: Add Separate Profile Endpoint (Not Recommended)

Create a new `license:getProfile` RPC method that calls `GET /api/v1/licenses/me` with JWT auth.

**Pros**: Richer data, separate concern.
**Cons**: Requires JWT auth token management in the extension, new authentication flow complexity, the extension currently only stores the license key (not a JWT).

#### Option C: Store Email Locally on Signup (Simplest for Community)

When a user signs up or enters a license key, also store their email in VS Code globalState. Display this in settings.

**Pros**: Works offline, no additional API call.
**Cons**: Data could become stale, doesn't get firstName/lastName, requires explicit capture.

### 3.6 Recommended Approach

**Use Option A (extend verify response)** for Pro/trial users who have license keys, combined with a lightweight version of Option C for Community users.

Implementation plan:

1. Server: Add `user: { email, firstName, lastName }` to the `LicenseVerificationResponse` from `/api/v1/licenses/verify`
2. Extension `LicenseStatus` interface: Add optional `user?: { email: string; firstName?: string; lastName?: string }`
3. `LicenseGetStatusResponse` RPC type: Add the user field
4. `license-rpc.handlers.ts`: Forward user data
5. `settings.component.ts`: Add user profile signals
6. `settings.component.html`: Add user profile section in the License Status Card

### 3.7 Where User Profile Would Fit in Settings UI

The most natural location is **inside the existing License Status Card** (lines 52-162 of `settings.component.html`). After the tier badge and before the action buttons, add:

```html
<!-- User Profile (if available) -->
@if (userEmail()) {
<div class="flex items-center gap-2 mb-2">
  <!-- User avatar (initials or icon) -->
  <div class="avatar placeholder">
    <div class="bg-neutral text-neutral-content rounded-full w-6">
      <span class="text-xs">{{ userInitials() }}</span>
    </div>
  </div>
  <div>
    <div class="text-xs font-medium">{{ userDisplayName() }}</div>
    <div class="text-xs text-base-content/50">{{ userEmail() }}</div>
  </div>
</div>
}
```

---

## 4. Authentication Flow Review

### 4.1 How OpenRouter Authentication Works

1. User enters OpenRouter API key in AuthConfigComponent (openrouter tab)
2. `auth:saveSettings` RPC stores key in SecretStorage via `AuthSecretsService.setCredential('openrouterKey', value)`
3. ConfigWatcher detects `ptah.auth.openrouterApiKey` change in SecretStorage
4. ConfigWatcher calls reinit callback -> `SdkAgentAdapter.initialize()`
5. `AuthManager.configureAuthentication('openrouter')` sets:
   - `ANTHROPIC_BASE_URL = 'https://openrouter.ai/api'`
   - `ANTHROPIC_AUTH_TOKEN = openRouterKey`
   - `ANTHROPIC_API_KEY = ''` (cleared)
   - `CLAUDE_CODE_OAUTH_TOKEN` deleted
6. SDK uses these env vars to route through OpenRouter's "Anthropic Skin"

### 4.2 How OAuth Authentication Works

1. User runs `claude setup-token` in terminal to get OAuth token
2. User pastes token in AuthConfigComponent (oauth tab)
3. `auth:saveSettings` stores in SecretStorage as `ptah.auth.claudeOAuthToken`
4. ConfigWatcher triggers reinit
5. `AuthManager.configureOAuthToken()` sets:
   - `CLAUDE_CODE_OAUTH_TOKEN = oauthToken`
   - Deletes `ANTHROPIC_API_KEY` (forces subscription auth)

### 4.3 How API Key Authentication Works

1. User gets API key from console.anthropic.com
2. User pastes key in AuthConfigComponent (apiKey tab)
3. `auth:saveSettings` stores in SecretStorage as `ptah.auth.anthropicApiKey`
4. ConfigWatcher triggers reinit
5. `AuthManager.configureAPIKey()` sets:
   - `ANTHROPIC_API_KEY = apiKey`

### 4.4 Settings UI <-> Backend Communication

The auth settings UI communicates via 4 RPC methods:

| RPC Method            | Direction     | Purpose                                                              |
| --------------------- | ------------- | -------------------------------------------------------------------- |
| `auth:getAuthStatus`  | UI -> Backend | Get boolean flags for which credentials exist + current authMethod   |
| `auth:saveSettings`   | UI -> Backend | Save authMethod + credentials to ConfigManager/SecretStorage         |
| `auth:testConnection` | UI -> Backend | Test if SDK is healthy after re-init (1-sec delay for ConfigWatcher) |
| `auth:getHealth`      | UI -> Backend | Get SDK health status                                                |

### 4.5 Relationship Between License Tier and Authentication

**License tier does NOT affect basic authentication capabilities.** Any user (Community or Pro) can configure:

- OAuth token
- API key
- OpenRouter key (stored and configured, but **model tier management** is Pro-gated)

The license tier affects:

1. Which RPC methods can be called (via `PRO_ONLY_METHOD_PREFIXES`)
2. Which UI sections are visible (via `showPremiumSections` computed signal)
3. Which features are enabled (via `FeatureGateService.isFeatureEnabled()`)

**Currently**: A Community user CAN save an OpenRouter key and use it for basic routing (AuthManager will configure it), but CANNOT call `openrouter:listModels` or `openrouter:setModelTier` to configure model overrides. This is the gating that needs to be removed.

---

## 5. Recommended Changes

### 5.1 Priority 1: Remove OpenRouter Pro Gating (LOW RISK)

**4 file changes required:**

| #   | File                                                            | Specific Change                                                                                                                                    |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `libs/backend/vscode-core/src/services/feature-gate.service.ts` | Remove `'openrouter_proxy'` from `ProOnlyFeature` type union and `PRO_ONLY_FEATURES` array. Move to a new community-level list or remove entirely. |
| 2   | `libs/backend/vscode-core/src/messaging/rpc-handler.ts`         | Remove `'openrouter:'` from `PRO_ONLY_METHOD_PREFIXES` array (line 87). Update all related comments (lines 72, 82, 87, 382, 425).                  |
| 3   | `apps/ptah-license-server/src/config/plans.config.ts`           | Add `'openrouter_proxy'` to `community.features[]` array (line 18-26). Keep it in `pro.features[]` too (Pro inherits all community features).      |
| 4   | Documentation comments                                          | Update JSDoc in `feature-gate.service.ts` (lines 19-27) and `rpc-handler.ts` (lines 66-88) to reflect OpenRouter is now a community feature.       |

**Risk Assessment**: LOW

- No architectural changes
- No new code paths
- Only removes restrictions
- Easy to test: Community user should be able to call `openrouter:*` methods

### 5.2 Priority 2: User Profile Display (MEDIUM RISK)

**Required changes (6 files):**

| #   | File                                                                           | Change                                                                                                                                        |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/ptah-license-server/src/license/services/license.service.ts`             | Add `user?: { email, firstName, lastName }` to `LicenseVerificationResponse`. Include user data when license is found (data already queried). |
| 2   | `libs/backend/vscode-core/src/services/license.service.ts`                     | Add `user?: { email: string; firstName?: string; lastName?: string }` to `LicenseStatus` interface. Parse from server response.               |
| 3   | `libs/shared/src/lib/types/rpc.types.ts`                                       | Add `user?` field to `LicenseGetStatusResponse` type.                                                                                         |
| 4   | `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts` | Forward `user` field in `mapLicenseStatusToResponse()`.                                                                                       |
| 5   | `libs/frontend/chat/src/lib/settings/settings.component.ts`                    | Add `userEmail`, `userFirstName`, `userLastName`, `userDisplayName`, `userInitials` signals. Populate from `fetchLicenseStatus()`.            |
| 6   | `libs/frontend/chat/src/lib/settings/settings.component.html`                  | Add user profile section inside the License Status Card (after tier badge, before action buttons).                                            |

**Risk Assessment**: MEDIUM

- Server API response change (additive, non-breaking)
- New UI section (visual-only, no logic impact)
- Community users without license keys will have no user data to display (acceptable - they haven't registered)

### 5.3 Priority 3: Authentication Architecture Documentation (LOW RISK)

No code changes required. This research report serves as the documentation.

---

## 6. Risk Analysis

### 6.1 OpenRouter Un-gating Risks

| Risk                                            | Probability | Impact | Mitigation                                                                                                |
| ----------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Community users overwhelm OpenRouter API        | LOW         | LOW    | OpenRouter has its own rate limiting per API key                                                          |
| Breaking change in FeatureGateService consumers | LOW         | LOW    | No code currently calls `isFeatureEnabled('openrouter_proxy')` directly (it's only in the RPC middleware) |
| RPC middleware regression                       | LOW         | MEDIUM | Verify other Pro-only methods (setup-status, wizard) still gate correctly                                 |

### 6.2 User Profile Display Risks

| Risk                              | Probability | Impact | Mitigation                                                     |
| --------------------------------- | ----------- | ------ | -------------------------------------------------------------- |
| Privacy: email displayed in UI    | LOW         | LOW    | User explicitly registered; only their own email shown         |
| Server response size increase     | LOW         | LOW    | Adding 3 small string fields                                   |
| Community users see empty profile | MEDIUM      | LOW    | Conditionally hide profile section when no user data available |
| Stale user data                   | LOW         | LOW    | License cache refreshes every 1 hour                           |

---

## 7. Files Referenced in This Report

All paths are absolute from project root `D:\projects\ptah-extension\`:

### Backend Core

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\auth-manager.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\config-watcher.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\auth-secrets.service.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`

### RPC Handlers

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\openrouter-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`

### License Server

- `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\generated-prisma-client\models\User.ts`

### Frontend

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\openrouter-model-selector.component.ts`

### Shared Types

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
