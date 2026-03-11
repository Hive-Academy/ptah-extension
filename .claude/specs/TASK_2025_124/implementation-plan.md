# Implementation Plan - TASK_2025_124: Centralized RPC License Middleware

## Codebase Investigation Summary

### Libraries Discovered

- **vscode-core**: `libs/backend/vscode-core/src/`
  - RpcHandler: `messaging/rpc-handler.ts` - Core RPC method registration and dispatch
  - LicenseService: `services/license.service.ts` - License verification with 1-hour cache
  - FeatureGateService: `services/feature-gate.service.ts` - Pro-only feature gating
  - TOKENS: `di/tokens.ts` - DI tokens including RPC_HANDLER, LICENSE_SERVICE

### Patterns Identified

1. **RPC Handler Registration Pattern** (Evidence: `rpc-handler.ts:95-116`)

   ```typescript
   rpcHandler.registerMethod<TParams, TResult>('method:name', async (params: TParams) => {
     /* handler */
   });
   ```

2. **Domain Handler Pattern** (Evidence: `session-rpc.handlers.ts:32-52`)

   - Handlers are `@injectable()` classes
   - Inject `RpcHandler` via `@inject(TOKENS.RPC_HANDLER)`
   - Call `register()` method to register all methods
   - Orchestrated by `RpcMethodRegistrationService.registerAll()`

3. **License Caching Pattern** (Evidence: `license.service.ts:416-418`)

   ```typescript
   getCachedStatus(): LicenseStatus | null {
     return this.cache.status;
   }
   ```

   - Returns in-memory cached status (NO server call)
   - Cache TTL: 1 hour (verified on `verifyLicense()` calls)

4. **Feature Gate Pattern** (Evidence: `feature-gate.service.ts:57-64`)
   ```typescript
   const PRO_ONLY_FEATURES: readonly ProOnlyFeature[] = ['mcp_server', 'workspace_intelligence', 'openrouter_proxy', 'custom_tools', 'setup_wizard', 'cost_tracking'] as const;
   ```

### Integration Points

- **RpcHandler.handleMessage()**: `rpc-handler.ts:138-171` - Central dispatch point
- **RpcHandler.handlers Map**: `rpc-handler.ts:65` - Private handler storage
- **RpcMethodRegistrationService.registerAll()**: `rpc-method-registration.service.ts:97-131`

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Middleware Pattern via RpcHandler Enhancement

**Rationale**:

1. **Centralized**: Single enforcement point in `RpcHandler.handleMessage()`
2. **Performant**: Uses `getCachedStatus()` - NO server calls per request
3. **Transparent**: Existing handlers require ZERO modifications
4. **Type-Safe**: Preserves TypeScript generics in handler registration

**Rejected Approaches**:

- **Decorator Pattern**: Would require modifying all 12 handler classes
- **Per-Handler Checks**: Scattered validation, easy to miss (current broken state)
- **Wrapper Functions**: Would break type inference on handlers

### Component Specifications

#### Component 1: RpcLicenseMiddleware

**Purpose**: Centralized license validation for ALL RPC requests before handler execution

**Pattern**: Middleware in `handleMessage()` dispatch
**Evidence**: Similar pattern used in Express.js middleware, validated against `rpc-handler.ts:138-171`

**Responsibilities**:

- Validate license status BEFORE invoking handler
- Check Pro tier for Pro-only methods
- Return structured error response (not exception)
- Use only cached license status (no server calls)

**Implementation Pattern**:

```typescript
// Pattern source: rpc-handler.ts:138-171 (handleMessage structure)
// License check source: license.service.ts:416-418 (getCachedStatus)

interface RpcLicenseValidationResult {
  allowed: boolean;
  error?: {
    code: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED';
    message: string;
  };
}

// In RpcHandler.handleMessage():
async handleMessage(message: RpcMessage): Promise<RpcResponse> {
  const { method, params, correlationId } = message;

  // STEP 1: License validation (BEFORE handler lookup)
  const validation = this.validateLicense(method);
  if (!validation.allowed) {
    return {
      success: false,
      error: validation.error?.message,
      errorCode: validation.error?.code,
      correlationId,
    };
  }

  // STEP 2: Existing handler dispatch
  const handler = this.handlers.get(method);
  // ... rest unchanged
}
```

**Quality Requirements**:

- MUST NOT call server (use `getCachedStatus()` only)
- MUST return structured error with `errorCode` for frontend handling
- MUST allow `license:*` methods to bypass (needed for license entry)
- MUST log validation failures at INFO level (not ERROR - expected behavior)

**Files Affected**:

- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (MODIFY)
- `libs/backend/vscode-core/src/messaging/rpc-types.ts` (MODIFY - add errorCode)

---

#### Component 2: Pro-Only Method Registry

**Purpose**: Centralized configuration of which RPC methods require Pro tier

**Pattern**: Static readonly array with method prefixes
**Evidence**: Similar pattern at `feature-gate.service.ts:57-64`

**Responsibilities**:

- Define which method prefixes require Pro tier
- Provide lookup function for middleware
- Keep in sync with FeatureGateService features

**Implementation Pattern**:

```typescript
// Pattern source: feature-gate.service.ts:57-64 (PRO_ONLY_FEATURES)
// Method prefix pattern: rpc-handler.ts:40-57 (ALLOWED_METHOD_PREFIXES)

/**
 * RPC methods requiring Pro tier subscription
 *
 * Prefix matching: 'setup-status:' matches 'setup-status:get-status'
 * Derived from PRO_ONLY_FEATURES in FeatureGateService
 */
const PRO_ONLY_METHOD_PREFIXES = [
  'setup-status:', // setup_wizard feature
  'setup-wizard:', // setup_wizard feature
  'wizard:', // setup_wizard feature (deep-analyze, recommend-agents)
  'openrouter:', // openrouter_proxy feature
] as const;

/**
 * Methods that bypass license check entirely
 * Required for license management flow
 */
const LICENSE_EXEMPT_PREFIXES = [
  'license:', // Must work to show license status
  'auth:', // Must work for login flow
] as const;
```

**Quality Requirements**:

- MUST be easily extensible (add new prefixes)
- MUST align with FeatureGateService.PRO_ONLY_FEATURES
- MUST include exemptions for license/auth flow

**Files Affected**:

- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (MODIFY - add constants)

---

#### Component 3: Enhanced RpcHandler

**Purpose**: Add middleware support to existing RpcHandler without breaking changes

**Pattern**: Dependency injection of LicenseService
**Evidence**:

- DI pattern: `rpc-handler.ts:67` (constructor injection)
- LicenseService injection: `chat-rpc.handlers.ts:63-64`

**Responsibilities**:

- Inject LicenseService at construction
- Add `validateLicense()` private method
- Modify `handleMessage()` to call validation first
- Preserve all existing type safety and functionality

**Implementation Pattern**:

```typescript
// Pattern source: rpc-handler.ts:64-69 (constructor pattern)
// LicenseService injection: chat-rpc.handlers.ts:63-64

@injectable()
export class RpcHandler {
  private handlers = new Map<string, BaseRpcMethodHandler>();

  constructor(@inject(LOGGER) private readonly logger: Logger, @inject(TOKENS.LICENSE_SERVICE) private readonly licenseService: LicenseService) {
    this.logger.debug('RpcHandler: Initialized with license middleware');
  }

  /**
   * Validate license before allowing RPC method execution
   * Uses CACHED status only - no server calls
   *
   * @param method - RPC method name (e.g., 'session:list')
   * @returns Validation result with allowed flag and optional error
   */
  private validateLicense(method: string): RpcLicenseValidationResult {
    // Exempt methods (license, auth) always allowed
    if (LICENSE_EXEMPT_PREFIXES.some((p) => method.startsWith(p))) {
      return { allowed: true };
    }

    // Get cached license status (NO server call)
    const status = this.licenseService.getCachedStatus();

    // No cached status = must verify first (unlikely in normal flow)
    if (!status) {
      this.logger.info('RpcHandler: No cached license status, rejecting', { method });
      return {
        allowed: false,
        error: {
          code: 'LICENSE_REQUIRED',
          message: 'License verification required. Please restart the extension.',
        },
      };
    }

    // Invalid license = block all non-exempt methods
    if (!status.valid) {
      this.logger.info('RpcHandler: Invalid license, blocking RPC', { method, tier: status.tier });
      return {
        allowed: false,
        error: {
          code: 'LICENSE_REQUIRED',
          message: 'Valid subscription required. Please subscribe to use this feature.',
        },
      };
    }

    // Pro-only methods require Pro tier
    if (this.isProOnlyMethod(method)) {
      const isPro = status.tier === 'pro' || status.tier === 'trial_pro';
      if (!isPro) {
        this.logger.info('RpcHandler: Pro tier required, blocking RPC', { method, tier: status.tier });
        return {
          allowed: false,
          error: {
            code: 'PRO_TIER_REQUIRED',
            message: 'Pro subscription required for this feature. Please upgrade to Pro.',
          },
        };
      }
    }

    // Valid license, allowed
    return { allowed: true };
  }

  /**
   * Check if method requires Pro tier
   */
  private isProOnlyMethod(method: string): boolean {
    return PRO_ONLY_METHOD_PREFIXES.some((p) => method.startsWith(p));
  }
}
```

**Quality Requirements**:

- MUST preserve backward compatibility (no changes to registerMethod API)
- MUST use `getCachedStatus()` (NO `verifyLicense()` which calls server)
- MUST log rejections at INFO level with method name and tier
- MUST return structured error response (not throw)

**Files Affected**:

- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (MODIFY)

---

#### Component 4: Enhanced RpcResponse Type

**Purpose**: Add `errorCode` field for frontend to differentiate license errors

**Pattern**: Extend existing interface
**Evidence**: `rpc-types.ts:24-35` (RpcResponse definition)

**Implementation Pattern**:

```typescript
// Pattern source: rpc-types.ts:24-35

export interface RpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Error code for programmatic handling (e.g., 'LICENSE_REQUIRED') */
  errorCode?: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED';
  correlationId: string;
}
```

**Quality Requirements**:

- MUST be optional (backward compatible)
- MUST use literal types for type safety
- MUST be documented for frontend developers

**Files Affected**:

- `libs/backend/vscode-core/src/messaging/rpc-types.ts` (MODIFY)

---

## Integration Architecture

### Data Flow

```
Frontend RPC Call
       |
       v
+------------------+
| handleMessage()  |
+------------------+
       |
       v
+------------------+
| validateLicense()| <-- getCachedStatus() [NO SERVER CALL]
+------------------+
       |
   allowed?
  /        \
 No         Yes
 |           |
 v           v
Return    Get Handler
Error     Execute
          Return Data
```

### Performance Analysis

**Cache Behavior** (Evidence: `license.service.ts:197-208`):

1. **On Extension Activation**: `verifyLicense()` called, populates cache
2. **During Normal Operation**: `getCachedStatus()` returns in-memory status
3. **Cache TTL**: 1 hour (refreshed automatically if stale)
4. **RPC Middleware**: Uses ONLY `getCachedStatus()` - O(1) memory read

**Performance Guarantees**:

- **Zero Network Calls**: Middleware uses cached status only
- **Constant Time**: Map lookup + prefix matching = O(1)
- **No Handler Changes**: Existing handlers unchanged = zero regression risk

### License Caching Integration

```typescript
// LICENSE CACHE FLOW

1. Extension Activation (main.ts)
   └── licenseService.verifyLicense()  // Server call, populates cache
       └── this.cache = { status, timestamp: Date.now() }

2. RPC Request (handleMessage)
   └── licenseService.getCachedStatus()  // Memory read, no server call
       └── return this.cache.status  // Immediate return

3. Cache Refresh (automatic, 1-hour TTL)
   └── isCacheValid() returns false
   └── verifyLicense() called again
```

---

## Files to Create/Modify

### MODIFY: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`

**Changes**:

1. Add `PRO_ONLY_METHOD_PREFIXES` constant (lines ~40)
2. Add `LICENSE_EXEMPT_PREFIXES` constant (lines ~45)
3. Add `RpcLicenseValidationResult` interface (lines ~50)
4. Inject `LicenseService` in constructor (line 67)
5. Add `validateLicense()` private method (lines ~220-270)
6. Add `isProOnlyMethod()` private method (lines ~275-280)
7. Modify `handleMessage()` to call `validateLicense()` first (lines 138-145)

**Impact**: Core RPC infrastructure, affects all handlers

### MODIFY: `libs/backend/vscode-core/src/messaging/rpc-types.ts`

**Changes**:

1. Add `errorCode` field to `RpcResponse` interface (line 33)

**Impact**: Type definition, may require frontend updates for handling

### MODIFY: `libs/backend/vscode-core/src/index.ts`

**Changes**:

1. Export new types if needed for frontend consumption

**Impact**: Library public API

---

## Migration Strategy

### Phase 1: Type Updates (Non-Breaking)

1. Add `errorCode` to `RpcResponse` (optional field)
2. Build and verify no type errors

### Phase 2: RpcHandler Enhancement

1. Add constants (PRO_ONLY_METHOD_PREFIXES, LICENSE_EXEMPT_PREFIXES)
2. Inject LicenseService
3. Add validateLicense() and isProOnlyMethod() methods
4. Modify handleMessage() to call validateLicense()

### Phase 3: Testing

1. Test license:\* methods work without license (exemption)
2. Test Pro-only methods blocked for Basic tier
3. Test all methods work for Pro tier
4. Verify no server calls via network logging

### Rollback Strategy

- Revert rpc-handler.ts changes
- LicenseService injection has no side effects if unused
- RpcResponse.errorCode is optional, backward compatible

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes in `libs/backend/vscode-core/`
- TypeScript/Node.js work
- Dependency injection patterns
- No frontend/Angular components

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Type updates: 30 min
- RpcHandler enhancement: 2-3 hours
- Testing: 1-2 hours
- Documentation: 30 min

### Files Affected Summary

**MODIFY**:

- `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
- `libs/backend/vscode-core/src/messaging/rpc-types.ts`
- `libs/backend/vscode-core/src/index.ts` (if needed)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `LicenseService` from `@ptah-extension/vscode-core` (services/license.service.ts:118)
   - `TOKENS.LICENSE_SERVICE` from `di/tokens.ts:238`
   - `LicenseStatus` type from `services/license.service.ts:66`

2. **All patterns verified from examples**:

   - DI constructor injection: `rpc-handler.ts:67`
   - Cache access: `license.service.ts:416-418`
   - Prefix matching: `rpc-handler.ts:215-217`

3. **Library documentation consulted**:

   - `libs/backend/vscode-core/CLAUDE.md`

4. **No hallucinated APIs**:
   - `getCachedStatus()` verified: license.service.ts:416
   - `LicenseService` injectable: license.service.ts:117
   - `TOKENS.LICENSE_SERVICE` defined: di/tokens.ts

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

1. **License Gate**: All RPC methods (except license:_, auth:_) require valid license
2. **Pro Tier Gate**: setup-_, wizard:_, openrouter:\* require Pro tier
3. **Graceful Rejection**: Return `RpcResponse` with `errorCode`, not exception
4. **Exempt Methods**: license:_ and auth:_ always allowed (needed for login flow)

### Non-Functional Requirements

1. **Performance**: MUST use `getCachedStatus()` only (NO server calls)
2. **Logging**: License rejections logged at INFO level with method name and tier
3. **Type Safety**: `RpcResponse.errorCode` uses literal union type
4. **Backward Compatibility**: No changes to registerMethod API signature

### Pattern Compliance

1. **DI Pattern**: LicenseService injected via constructor (verified: chat-rpc.handlers.ts:63-64)
2. **Prefix Matching**: Same pattern as ALLOWED_METHOD_PREFIXES (verified: rpc-handler.ts:40-57)
3. **Response Structure**: Extends existing RpcResponse (verified: rpc-types.ts:24-35)

---

_Architecture designed by Software Architect Agent - TASK_2025_124_
_Date: 2026-01-27_
