# Implementation Plan - TASK_2025_129: Authentication Settings Improvements

## Codebase Investigation Summary

### Libraries Analyzed

- **vscode-core** (`libs/backend/vscode-core/`): Feature gate service, RPC handler middleware, license service
- **shared** (`libs/shared/`): RPC type definitions (`rpc.types.ts`)
- **chat** (`libs/frontend/chat/`): Settings UI components
- **ptah-license-server** (`apps/ptah-license-server/`): Server-side plans config, license verification, controller
- **ptah-extension-vscode** (`apps/ptah-extension-vscode/`): RPC handler registration

### Patterns Identified

- **Feature gating**: `ProOnlyFeature` type + `PRO_ONLY_FEATURES` array in feature-gate.service.ts, `PRO_ONLY_METHOD_PREFIXES` in rpc-handler.ts
- **RPC response mapping**: `LicenseRpcHandlers.mapLicenseStatusToResponse()` maps internal `LicenseStatus` to `LicenseGetStatusResponse`
- **Signal-based state**: Settings component uses Angular signals for all state, populated from `fetchLicenseStatus()` RPC call
- **Server verify endpoint**: `POST /api/v1/licenses/verify` already queries user with subscriptions via Prisma `include` but does NOT return user data

### Integration Points Verified

- `LicenseStatus` interface (vscode-core/services/license.service.ts:62) - internal license state
- `LicenseGetStatusResponse` interface (shared/types/rpc.types.ts:575) - frontend-facing RPC type
- `LicenseVerificationResponse` interface (license-server/license/services/license.service.ts:26) - server API response
- `mapLicenseStatusToResponse()` (license-rpc.handlers.ts:146) - maps internal to frontend format
- `fetchLicenseStatus()` (settings.component.ts:218) - frontend fetches and populates signals

---

## Batch 1: Remove OpenRouter Pro Gating

**Priority**: 1 (HIGH)
**Risk**: LOW
**Developer Type**: backend-developer
**Estimated Effort**: 30 minutes

### Rationale

OpenRouter authentication is currently gated as a Pro-only feature across 4 locations in 3 files. Community (free) users can save an OpenRouter API key and the `AuthManager` will configure it, but all `openrouter:*` RPC methods (listModels, setModelTier, getModelTiers, clearModelTier) are blocked by the RPC middleware returning `PRO_TIER_REQUIRED`. This effectively prevents Community users from using OpenRouter model tier configuration.

The gating should be removed so OpenRouter is available to ALL users.

### Changes Required

#### File 1: `libs\backend\vscode-core\src\services\feature-gate.service.ts`

**Evidence**: Lines 29-35 (type), lines 59-66 (array), lines 18-27 (JSDoc)

**Change 1a**: Remove `'openrouter_proxy'` from the `ProOnlyFeature` type union.

```typescript
// BEFORE (lines 29-35):
export type ProOnlyFeature = 'mcp_server' | 'workspace_intelligence' | 'openrouter_proxy' | 'custom_tools' | 'setup_wizard' | 'cost_tracking';

// AFTER:
export type ProOnlyFeature = 'mcp_server' | 'workspace_intelligence' | 'custom_tools' | 'setup_wizard' | 'cost_tracking';
```

**Change 1b**: Remove `'openrouter_proxy'` from the `PRO_ONLY_FEATURES` runtime array.

```typescript
// BEFORE (lines 59-66):
const PRO_ONLY_FEATURES: readonly ProOnlyFeature[] = ['mcp_server', 'workspace_intelligence', 'openrouter_proxy', 'custom_tools', 'setup_wizard', 'cost_tracking'] as const;

// AFTER:
const PRO_ONLY_FEATURES: readonly ProOnlyFeature[] = ['mcp_server', 'workspace_intelligence', 'custom_tools', 'setup_wizard', 'cost_tracking'] as const;
```

**Change 1c**: Update JSDoc comment (lines 18-27) to remove `openrouter_proxy` from the Pro-only list.

```typescript
// BEFORE (lines 18-27):
/**
 * Pro-only features that require Pro tier subscription
 *
 * These features are NOT available to Community tier users:
 * - mcp_server: Code Execution MCP server
 * - workspace_intelligence: Advanced workspace analysis (13+ project types)
 * - openrouter_proxy: OpenRouter proxy for 200+ models
 * - custom_tools: Custom tool creation and management
 * - setup_wizard: Intelligent setup wizard with agent generation
 * - cost_tracking: Real-time cost tracking and analytics
 */

// AFTER:
/**
 * Pro-only features that require Pro tier subscription
 *
 * These features are NOT available to Community tier users:
 * - mcp_server: Code Execution MCP server
 * - workspace_intelligence: Advanced workspace analysis (13+ project types)
 * - custom_tools: Custom tool creation and management
 * - setup_wizard: Intelligent setup wizard with agent generation
 * - cost_tracking: Real-time cost tracking and analytics
 *
 * Community features (available to ALL users):
 * - openrouter_proxy: OpenRouter proxy for 200+ models (TASK_2025_129)
 */
```

**Change 1d**: Update the `isProTier()` method JSDoc (lines 200-210) to remove "OpenRouter Proxy" from the Pro-only list.

```typescript
// BEFORE (lines 200-210):
/**
 * ...
 * Pro tier includes all Community features plus:
 * - MCP Server
 * - Workspace Intelligence
 * - OpenRouter Proxy
 * - Custom Tools
 * - Setup Wizard
 * - Cost Tracking
 * ...
 */

// AFTER:
/**
 * ...
 * Pro tier includes all Community features plus:
 * - MCP Server
 * - Workspace Intelligence
 * - Custom Tools
 * - Setup Wizard
 * - Cost Tracking
 * ...
 */
```

#### File 2: `libs\backend\vscode-core\src\messaging\rpc-handler.ts`

**Evidence**: Lines 66-88 (PRO_ONLY_METHOD_PREFIXES and JSDoc), lines 381-382 (comment), lines 420-425 (comment)

**Change 2a**: Remove `'openrouter:'` from `PRO_ONLY_METHOD_PREFIXES` array.

```typescript
// BEFORE (lines 83-88):
const PRO_ONLY_METHOD_PREFIXES = [
  'setup-status:', // setup_wizard feature
  'setup-wizard:', // setup_wizard feature
  'wizard:', // setup_wizard feature (deep-analyze, recommend-agents)
  'openrouter:', // openrouter_proxy feature
] as const;

// AFTER:
const PRO_ONLY_METHOD_PREFIXES = [
  'setup-status:', // setup_wizard feature
  'setup-wizard:', // setup_wizard feature
  'wizard:', // setup_wizard feature (deep-analyze, recommend-agents)
] as const;
```

**Change 2b**: Update JSDoc block for `PRO_ONLY_METHOD_PREFIXES` (lines 65-82).

```typescript
// BEFORE (lines 65-82):
/**
 * RPC methods requiring Pro tier subscription (TASK_2025_124)
 *
 * Prefix matching: 'setup-status:' matches 'setup-status:get-status'
 *
 * Mapping from PRO_ONLY_FEATURES (FeatureGateService) to RPC prefixes:
 * - setup_wizard      -> setup-status:, setup-wizard:, wizard:
 * - openrouter_proxy  -> openrouter:
 *
 * Other Pro features WITHOUT RPC endpoints (gated via FeatureGateService):
 * - mcp_server            -> Backend-only, no RPC (uses MCP protocol)
 * - workspace_intelligence -> Internal service, no direct RPC
 * - custom_tools          -> Not yet implemented
 * - cost_tracking         -> Backend analytics, no direct RPC
 *
 * IMPORTANT: When adding new Pro features with RPC endpoints, add their
 * prefixes here to enforce Pro tier gating at the RPC layer.
 */

// AFTER:
/**
 * RPC methods requiring Pro tier subscription (TASK_2025_124)
 *
 * Prefix matching: 'setup-status:' matches 'setup-status:get-status'
 *
 * Mapping from PRO_ONLY_FEATURES (FeatureGateService) to RPC prefixes:
 * - setup_wizard      -> setup-status:, setup-wizard:, wizard:
 *
 * Community features with RPC endpoints (available to ALL users):
 * - openrouter_proxy  -> openrouter: (un-gated in TASK_2025_129)
 *
 * Other Pro features WITHOUT RPC endpoints (gated via FeatureGateService):
 * - mcp_server            -> Backend-only, no RPC (uses MCP protocol)
 * - workspace_intelligence -> Internal service, no direct RPC
 * - custom_tools          -> Not yet implemented
 * - cost_tracking         -> Backend analytics, no direct RPC
 *
 * IMPORTANT: When adding new Pro features with RPC endpoints, add their
 * prefixes here to enforce Pro tier gating at the RPC layer.
 */
```

**Change 2c**: Update inline comment at line 129 in class JSDoc.

```typescript
// BEFORE (line 129):
 * - Pro-only methods (setup-*, wizard:*, openrouter:*) require Pro tier

// AFTER:
 * - Pro-only methods (setup-*, wizard:*) require Pro tier
```

**Change 2d**: Update comment at line 382.

```typescript
// BEFORE (line 382):
// Pro-only methods: setup-status:*, setup-wizard:*, wizard:*, openrouter:*

// AFTER:
// Pro-only methods: setup-status:*, setup-wizard:*, wizard:*
```

**Change 2e**: Update `isProOnlyMethod()` JSDoc (lines 420-428).

```typescript
// BEFORE:
/**
 * Check if RPC method requires Pro tier subscription (TASK_2025_124)
 *
 * Pro-only methods are derived from PRO_ONLY_FEATURES in FeatureGateService:
 * - setup_wizard feature: setup-status:*, setup-wizard:*, wizard:*
 * - openrouter_proxy feature: openrouter:*
 *
 * @param method - RPC method name to check
 * @returns True if method requires Pro tier
 */

// AFTER:
/**
 * Check if RPC method requires Pro tier subscription (TASK_2025_124)
 *
 * Pro-only methods are derived from PRO_ONLY_FEATURES in FeatureGateService:
 * - setup_wizard feature: setup-status:*, setup-wizard:*, wizard:*
 *
 * Community methods (TASK_2025_129):
 * - openrouter:* - Available to all users
 *
 * @param method - RPC method name to check
 * @returns True if method requires Pro tier
 */
```

#### File 3: `apps\ptah-license-server\src\config\plans.config.ts`

**Evidence**: Lines 15-50 (PLANS object)

**Change 3a**: Add `'openrouter_proxy'` to the community plan's features array.

```typescript
// BEFORE (lines 16-26):
  community: {
    name: 'Community',
    features: [
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'sdk_access',
      'real_time_streaming',
      'basic_workspace_context',
    ],

// AFTER:
  community: {
    name: 'Community',
    features: [
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'sdk_access',
      'real_time_streaming',
      'basic_workspace_context',
      'openrouter_proxy', // TASK_2025_129: Available to all users
    ],
```

Keep `'openrouter_proxy'` in the Pro plan features as well (Pro inherits `all_community_features` plus its own).

### Batch 1 Testing Strategy

1. **Type check**: Run `npx nx typecheck vscode-core` to verify `ProOnlyFeature` type change propagates cleanly. No code outside these 3 files references `'openrouter_proxy'` as a `ProOnlyFeature` literal value.
2. **RPC middleware verification**: Start extension as a Community user and call `openrouter:listModels` -- it should return successfully (not `PRO_TIER_REQUIRED`).
3. **Pro feature regression**: Verify `setup-status:get-status` and `wizard:*` still return `PRO_TIER_REQUIRED` for Community users (these remain gated).
4. **Lint check**: Run `npx nx lint vscode-core` and `npx nx lint ptah-license-server`.

### Batch 1 Risk Mitigation

| Risk                                    | Probability | Impact | Mitigation                                                                                                                                |
| --------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Type compilation breaks                 | LOW         | LOW    | `ProOnlyFeature` is only used within feature-gate.service.ts and by rpc-handler.ts (checked via grep). Removing one union member is safe. |
| Other Pro methods accidentally un-gated | LOW         | MEDIUM | Only removing `'openrouter:'` from `PRO_ONLY_METHOD_PREFIXES`. Other prefixes remain. Verify with test.                                   |
| Server-side feature check mismatch      | LOW         | LOW    | Adding to community features is additive. Pro plan has `all_community_features` which conceptually includes community features.           |

---

## Batch 2: Add User Profile Display in Settings

**Priority**: 2 (MEDIUM)
**Risk**: MEDIUM (crosses server + extension + frontend boundaries)
**Developer Type**: backend-developer (for server + extension changes), then frontend touches are minimal
**Estimated Effort**: 1-2 hours

### Rationale

There is no way to display the currently authenticated user's identity in the settings page. The license server's `verifyLicense()` method already queries the `user` object (via Prisma `include: { user: { include: { subscriptions } } }`), but the `LicenseVerificationResponse` interface does not include user data. The frontend settings page has no signals or template sections for user information.

The approach is to extend the verify response (Option A from research): add user data to the existing `/api/v1/licenses/verify` response, propagate through the extension's `LicenseStatus` interface and `LicenseGetStatusResponse` RPC type, and display in the settings UI inside the License Status Card.

### Changes Required (6 files, back-to-front)

#### File 1: `apps\ptah-license-server\src\license\services\license.service.ts`

**Evidence**: Lines 26-35 (LicenseVerificationResponse), lines 100-113 (Prisma query), lines 212-222 (return statement)

**Change 1a**: Add optional `user` field to `LicenseVerificationResponse` interface.

```typescript
// BEFORE (lines 26-35):
export interface LicenseVerificationResponse {
  valid: boolean;
  tier: LicenseTier;
  plan?: (typeof PLANS)[keyof typeof PLANS];
  expiresAt?: string;
  daysRemaining?: number;
  trialActive?: boolean;
  trialDaysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
}

// AFTER:
export interface LicenseVerificationResponse {
  valid: boolean;
  tier: LicenseTier;
  plan?: (typeof PLANS)[keyof typeof PLANS];
  expiresAt?: string;
  daysRemaining?: number;
  trialActive?: boolean;
  trialDaysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
  /** User profile data (only present for valid licenses) - TASK_2025_129 */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}
```

**Change 1b**: Include `user` data in the valid license response at lines 212-222.

The Prisma query at line 101 already includes `user` in its `include` clause. The `license.user` object has `email`, `firstName`, `lastName` fields (verified from license.controller.ts lines 139-141 which accesses these same fields).

```typescript
// BEFORE (lines 212-222):
// Step 10: Return valid license with full details
return {
  valid: true,
  tier,
  plan: planConfig,
  expiresAt: license.expiresAt?.toISOString(),
  daysRemaining,
  trialActive: isInTrial,
  trialDaysRemaining,
};

// AFTER:
// Step 10: Return valid license with full details
return {
  valid: true,
  tier,
  plan: planConfig,
  expiresAt: license.expiresAt?.toISOString(),
  daysRemaining,
  trialActive: isInTrial,
  trialDaysRemaining,
  // TASK_2025_129: Include user profile data
  user: {
    email: license.user.email,
    firstName: license.user.firstName,
    lastName: license.user.lastName,
  },
};
```

No additional Prisma query needed -- `license.user` is already populated by the existing `include` clause at line 101-113.

#### File 2: `libs\backend\vscode-core\src\services\license.service.ts`

**Evidence**: Lines 62-85 (LicenseStatus interface), lines 260 (server response parsing)

**Change 2a**: Add optional `user` field to the `LicenseStatus` interface.

```typescript
// BEFORE (lines 62-85):
export interface LicenseStatus {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** Current license tier (community, pro, trial_pro, or expired) */
  tier: LicenseTierValue;
  /** Plan details (if applicable) */
  plan?: {
    name: string;
    features: string[];
    expiresAfterDays: number | null;
    isPremium: boolean;
    description: string;
  };
  /** Subscription/trial expiration timestamp (ISO 8601) */
  expiresAt?: string;
  /** Days remaining before subscription expires */
  daysRemaining?: number;
  /** Whether user is currently in trial period */
  trialActive?: boolean;
  /** Days remaining in trial period (only set during trial) */
  trialDaysRemaining?: number;
  /** Reason for invalid status */
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
}

// AFTER:
export interface LicenseStatus {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** Current license tier (community, pro, trial_pro, or expired) */
  tier: LicenseTierValue;
  /** Plan details (if applicable) */
  plan?: {
    name: string;
    features: string[];
    expiresAfterDays: number | null;
    isPremium: boolean;
    description: string;
  };
  /** Subscription/trial expiration timestamp (ISO 8601) */
  expiresAt?: string;
  /** Days remaining before subscription expires */
  daysRemaining?: number;
  /** Whether user is currently in trial period */
  trialActive?: boolean;
  /** Days remaining in trial period (only set during trial) */
  trialDaysRemaining?: number;
  /** Reason for invalid status */
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
  /** User profile data from license server (TASK_2025_129) */
  user?: {
    email: string;
    firstName?: string;
    lastName?: string;
  };
}
```

No changes needed to `verifyLicense()` method itself -- the server response is parsed with `const status: LicenseStatus = await response.json();` at line 260. Since the server will now include a `user` field and `LicenseStatus` declares it as optional, it will be parsed automatically. The Community fallback paths (no license key, error cases) will correctly not have a `user` field.

#### File 3: `libs\shared\src\lib\types\rpc.types.ts`

**Evidence**: Lines 575-598 (LicenseGetStatusResponse interface)

**Change 3a**: Add optional `user` field to `LicenseGetStatusResponse`.

```typescript
// BEFORE (lines 575-598):
export interface LicenseGetStatusResponse {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** License tier (community, pro, trial_pro, or expired) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled (Pro tier) */
  isPremium: boolean;
  /** Whether the user has Community tier (convenience flag) */
  isCommunity: boolean;
  /** Days remaining before subscription expires (null if not applicable) */
  daysRemaining: number | null;
  /** Whether user is currently in trial period */
  trialActive: boolean;
  /** Days remaining in trial period (null if not in trial) */
  trialDaysRemaining: number | null;
  /** Plan details (if has valid license) */
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  /** Reason for invalid license (for context-aware welcome messaging) */
  reason?: 'expired' | 'trial_ended' | 'no_license';
}

// AFTER:
export interface LicenseGetStatusResponse {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** License tier (community, pro, trial_pro, or expired) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled (Pro tier) */
  isPremium: boolean;
  /** Whether the user has Community tier (convenience flag) */
  isCommunity: boolean;
  /** Days remaining before subscription expires (null if not applicable) */
  daysRemaining: number | null;
  /** Whether user is currently in trial period */
  trialActive: boolean;
  /** Days remaining in trial period (null if not in trial) */
  trialDaysRemaining: number | null;
  /** Plan details (if has valid license) */
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  /** Reason for invalid license (for context-aware welcome messaging) */
  reason?: 'expired' | 'trial_ended' | 'no_license';
  /** User profile data (TASK_2025_129) - only present for licensed users */
  user?: {
    email: string;
    firstName?: string;
    lastName?: string;
  };
}
```

#### File 4: `apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`

**Evidence**: Lines 146-196 (mapLicenseStatusToResponse method)

**Change 4a**: Forward the `user` field from `LicenseStatus` to `LicenseGetStatusResponse`.

```typescript
// BEFORE (lines 179-196):
return {
  valid: status.valid,
  tier: status.tier as LicenseTier,
  isPremium,
  isCommunity, // RENAMED from isBasic
  daysRemaining: status.daysRemaining ?? null,
  trialActive,
  trialDaysRemaining: status.trialDaysRemaining ?? null,
  plan: status.plan
    ? {
        name: status.plan.name,
        description: status.plan.description,
        features: status.plan.features,
      }
    : undefined,
  reason,
};

// AFTER:
return {
  valid: status.valid,
  tier: status.tier as LicenseTier,
  isPremium,
  isCommunity,
  daysRemaining: status.daysRemaining ?? null,
  trialActive,
  trialDaysRemaining: status.trialDaysRemaining ?? null,
  plan: status.plan
    ? {
        name: status.plan.name,
        description: status.plan.description,
        features: status.plan.features,
      }
    : undefined,
  reason,
  // TASK_2025_129: Forward user profile data
  user: status.user
    ? {
        email: status.user.email,
        firstName: status.user.firstName,
        lastName: status.user.lastName,
      }
    : undefined,
};
```

#### File 5: `libs\frontend\chat\src\lib\settings\settings.component.ts`

**Evidence**: Lines 74-96 (signals), lines 97-136 (computed), lines 218-246 (fetchLicenseStatus)

**Change 5a**: Add user profile signals (after the existing license status card signals at line 95).

```typescript
// ADD after line 95 (after `readonly isCommunity = signal(false);`):

  // User profile signals (TASK_2025_129)
  readonly userEmail = signal<string | null>(null);
  readonly userFirstName = signal<string | null>(null);
  readonly userLastName = signal<string | null>(null);
```

**Change 5b**: Add computed signals for display name and initials (after the existing computed signals, around line 136).

```typescript
// ADD after the `showTrialInfo` computed (after line 143):

  /**
   * Computed: User display name (first + last name, or email)
   * TASK_2025_129
   */
  readonly userDisplayName = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first || last) {
      return [first, last].filter(Boolean).join(' ');
    }
    return this.userEmail();
  });

  /**
   * Computed: User initials for avatar (e.g., "JD" for John Doe)
   * TASK_2025_129
   */
  readonly userInitials = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first && last) {
      return `${first[0]}${last[0]}`.toUpperCase();
    }
    if (first) {
      return first[0].toUpperCase();
    }
    const email = this.userEmail();
    if (email) {
      return email[0].toUpperCase();
    }
    return '?';
  });
```

**Change 5c**: Populate user signals in `fetchLicenseStatus()` method (inside the success block, after line 233).

```typescript
// BEFORE (lines 221-234):
if (result.isSuccess() && result.data) {
  const data = result.data as LicenseGetStatusResponse;
  this.isPremium.set(data.isPremium);
  this.licenseTier.set(data.tier);
  this.licenseValid.set(data.valid);
  this.trialActive.set(data.trialActive);
  this.trialDaysRemaining.set(data.trialDaysRemaining);
  this.daysRemaining.set(data.daysRemaining);
  this.isCommunity.set(data.isCommunity);
  this.planName.set(data.plan?.name ?? null);
  this.planDescription.set(data.plan?.description ?? null);
}

// AFTER:
if (result.isSuccess() && result.data) {
  const data = result.data as LicenseGetStatusResponse;
  this.isPremium.set(data.isPremium);
  this.licenseTier.set(data.tier);
  this.licenseValid.set(data.valid);
  this.trialActive.set(data.trialActive);
  this.trialDaysRemaining.set(data.trialDaysRemaining);
  this.daysRemaining.set(data.daysRemaining);
  this.isCommunity.set(data.isCommunity);
  this.planName.set(data.plan?.name ?? null);
  this.planDescription.set(data.plan?.description ?? null);
  // TASK_2025_129: User profile data
  this.userEmail.set(data.user?.email ?? null);
  this.userFirstName.set(data.user?.firstName ?? null);
  this.userLastName.set(data.user?.lastName ?? null);
}
```

#### File 6: `libs\frontend\chat\src\lib\settings\settings.component.html`

**Evidence**: Lines 51-161 (License Status Card section)

**Change 6a**: Add user profile section inside the License Status Card, after the tier badge/validity section (after line 84) and before the trial info section (line 87).

Insert this block between the tier badge div (line 63-84) and the trial info section (line 87):

```html
<!-- User Profile (TASK_2025_129) -->
@if (userEmail()) {
<div class="flex items-center gap-2 mb-2 py-1.5 px-2 bg-base-300/30 rounded">
  <!-- User avatar (initials) -->
  <div class="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">{{ userInitials() }}</div>
  <div class="min-w-0">
    @if (userDisplayName() && userDisplayName() !== userEmail()) {
    <div class="text-xs font-medium truncate">{{ userDisplayName() }}</div>
    }
    <div class="text-xs text-base-content/50 truncate">{{ userEmail() }}</div>
  </div>
</div>
}
```

This renders:

- A small circle with the user's initials (styled with primary color)
- The user's display name (first + last) on the first line (if available and different from email)
- The user's email on the second line (always shown)
- Conditionally hidden when no user data exists (Community users without license key)

### Batch 2 File Dependency Order

Changes MUST be implemented in this order (server-to-frontend data flow):

1. **Server response** (`license.service.ts` on license server) -- adds `user` to verify response
2. **Extension internal type** (`license.service.ts` in vscode-core) -- adds `user` to `LicenseStatus`
3. **RPC type** (`rpc.types.ts` in shared) -- adds `user` to `LicenseGetStatusResponse`
4. **RPC handler** (`license-rpc.handlers.ts`) -- forwards `user` data
5. **Frontend component** (`settings.component.ts`) -- signals + computed
6. **Frontend template** (`settings.component.html`) -- display

All changes are additive (optional fields). No existing functionality is broken if any layer is missing the user data -- it simply won't display.

### Batch 2 Testing Strategy

1. **Server unit test**: Call `verifyLicense()` with a valid license key and verify the response includes `user: { email, firstName, lastName }`.
2. **Type check**: Run `npx nx typecheck vscode-core`, `npx nx typecheck shared`, `npx nx typecheck ptah-extension-vscode`, `npx nx typecheck chat`.
3. **Integration test (manual)**:
   - As a Pro user with license key: Settings should show user email and name in the License Status Card.
   - As a Community user (no license key): No user profile section should appear.
   - As a trial_pro user: User profile should appear.
4. **Lint check**: Run `npx nx run-many --target=lint --projects=vscode-core,shared,chat,ptah-extension-vscode,ptah-license-server`.
5. **Visual check**: Verify the user profile fits well within the License Status Card on the VS Code sidebar width (~300px).

### Batch 2 Risk Mitigation

| Risk                                     | Probability | Impact | Mitigation                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server response size increase            | LOW         | LOW    | Adding 3 small string fields (email + 2 nullable names). Negligible.                                                                                                                                                          |
| Community users see empty profile        | EXPECTED    | LOW    | `@if (userEmail())` guard in template hides the section when no data.                                                                                                                                                         |
| Stale user data                          | LOW         | LOW    | License cache refreshes hourly. User data changes (name) are rare.                                                                                                                                                            |
| Privacy concern                          | LOW         | LOW    | Only showing user's own email/name to themselves. No third-party exposure.                                                                                                                                                    |
| Server-side `license.user` could be null | LOW         | MEDIUM | The Prisma query includes `user` via foreign key. Every license has a userId (required field). The user object will always exist for valid licenses. Add a null check as defense: `user: license.user ? { ... } : undefined`. |

---

## Architecture Design Philosophy

### Evidence-Based Decisions

| Decision                                           | Evidence                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Remove `openrouter_proxy` from ProOnlyFeature type | feature-gate.service.ts:29-35, only 5 remaining Pro features          |
| Remove `openrouter:` from PRO_ONLY_METHOD_PREFIXES | rpc-handler.ts:83-88, middleware blocks all openrouter:\* calls       |
| Add `openrouter_proxy` to community.features       | plans.config.ts:18-26, community features array                       |
| Extend verify response (not new endpoint)          | license.service.ts:101-113 already includes user in Prisma query      |
| Use LicenseStatus.user optional field              | license.service.ts:62, additive change to existing interface          |
| Display user in License Status Card                | settings.component.html:51-161, natural location for user identity    |
| Signal-based user state                            | settings.component.ts uses signals exclusively (pattern: lines 74-96) |

### No Backward Compatibility Needed

Both batches involve direct, clean modifications:

- Batch 1: Removes restrictions (no old behavior to maintain)
- Batch 2: Adds new data to existing flows (additive, optional fields)

No compatibility layers, version bridges, or migration strategies required.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Batch 1 is entirely backend (feature gate, RPC middleware, server config)
- Batch 2 spans server + extension backend + frontend, but the frontend changes are minimal (3 signals, 2 computed, ~10 lines of HTML)
- A backend developer familiar with the license/RPC flow is the best fit
- Frontend changes follow established signal patterns (no new Angular concepts)

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Total Effort**: 1.5-2.5 hours

**Breakdown**:

- Batch 1: 30 minutes (4 simple removals + comment updates)
- Batch 2: 1-2 hours (6 files across 3 layers, but all additive changes)

### Files Affected Summary

**MODIFY** (Batch 1 -- OpenRouter Un-gating):

- `libs\backend\vscode-core\src\services\feature-gate.service.ts` -- Remove openrouter_proxy from type + array + comments
- `libs\backend\vscode-core\src\messaging\rpc-handler.ts` -- Remove openrouter: prefix + update comments
- `apps\ptah-license-server\src\config\plans.config.ts` -- Add openrouter_proxy to community features

**MODIFY** (Batch 2 -- User Profile Display):

- `apps\ptah-license-server\src\license\services\license.service.ts` -- Add user to verify response + interface
- `libs\backend\vscode-core\src\services\license.service.ts` -- Add user to LicenseStatus interface
- `libs\shared\src\lib\types\rpc.types.ts` -- Add user to LicenseGetStatusResponse
- `apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts` -- Forward user data
- `libs\frontend\chat\src\lib\settings\settings.component.ts` -- Add user signals + computed
- `libs\frontend\chat\src\lib\settings\settings.component.html` -- Add user profile section in License Status Card

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `ProOnlyFeature` type from `feature-gate.service.ts:29`
   - `LicenseStatus` interface from `license.service.ts:62`
   - `LicenseGetStatusResponse` from `rpc.types.ts:575`

2. **All patterns verified from examples**:

   - Signal pattern: `settings.component.ts` lines 74-96
   - Computed pattern: `settings.component.ts` lines 101-143
   - RPC response mapping: `license-rpc.handlers.ts` lines 146-196
   - Template conditional: `settings.component.html` `@if` blocks

3. **Server Prisma query already includes user**:

   - `license.service.ts` (server) line 101-113: `include: { user: { include: { subscriptions } } }`
   - No new database query needed

4. **No hallucinated APIs**:
   - All decorator/class/interface modifications are to existing code
   - No new libraries or dependencies introduced
   - All signal/computed patterns match established codebase conventions

### Architecture Delivery Checklist

- [x] All components specified with evidence (file:line citations throughout)
- [x] All patterns verified from codebase (signal pattern, RPC mapping, Prisma query)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (testing strategy per batch)
- [x] Integration points documented (server -> extension -> frontend data flow)
- [x] Files affected list complete (3 files Batch 1, 6 files Batch 2)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (LOW-MEDIUM, 1.5-2.5 hours total)
- [x] Batch organization with dependency order documented
- [x] Risk mitigation tables provided per batch
