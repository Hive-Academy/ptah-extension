# Development Tasks - TASK_2025_124

**Total Tasks**: 5 | **Batches**: 1 | **Status**: 0/1 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `getCachedStatus()` method exists: VERIFIED (license.service.ts:412-413)
- `TOKENS.LICENSE_SERVICE` exists: VERIFIED (tokens.ts:110, 283)
- `LicenseService` is injectable: VERIFIED (license.service.ts:113)
- `LicenseStatus` type has `valid` and `tier` fields: VERIFIED (license.service.ts:62-85)
- `RpcResponse` interface: VERIFIED (rpc-types.ts:26-35)
- DI injection pattern in RpcHandler: VERIFIED (rpc-handler.ts:67)
- Prefix matching pattern exists: VERIFIED (rpc-handler.ts:215-217)

### Risks Identified

| Risk                                                            | Severity | Mitigation                                            |
| --------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| Constructor signature change may require DI registration update | LOW      | Verify container.ts registration after implementation |

### Edge Cases to Handle

- [ ] No cached license status (cache not populated yet) -> Task 1.3
- [ ] Invalid license (subscription expired) -> Task 1.3
- [ ] Pro-only method called by Basic tier -> Task 1.3
- [ ] Exempt methods (license:_, auth:_) must bypass all checks -> Task 1.3

---

## Batch 1: RPC License Middleware Implementation - IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Add errorCode field to RpcResponse type - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-types.ts
**Spec Reference**: implementation-plan.md:299-320
**Pattern to Follow**: rpc-types.ts:26-35 (existing RpcResponse interface)

**Quality Requirements**:

- MUST be optional field (backward compatible)
- MUST use literal union type: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED'
- MUST include JSDoc comment for frontend developers

**Implementation Details**:

- Add `errorCode?: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED';` to RpcResponse interface
- Place after `error?: string;` field (line 32)
- Add JSDoc comment explaining purpose

---

### Task 1.2: Add license middleware constants to RpcHandler - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts
**Spec Reference**: implementation-plan.md:145-170
**Pattern to Follow**: rpc-handler.ts:40-57 (ALLOWED_METHOD_PREFIXES pattern)

**Quality Requirements**:

- MUST define PRO_ONLY_METHOD_PREFIXES constant
- MUST define LICENSE_EXEMPT_PREFIXES constant
- MUST align with FeatureGateService.PRO_ONLY_FEATURES
- MUST use `as const` for type safety

**Implementation Details**:

- Add PRO_ONLY_METHOD_PREFIXES: ['setup-status:', 'setup-wizard:', 'wizard:', 'openrouter:']
- Add LICENSE_EXEMPT_PREFIXES: ['license:', 'auth:']
- Add RpcLicenseValidationResult interface
- Place after ALLOWED_METHOD_PREFIXES (around line 58)

---

### Task 1.3: Inject LicenseService and add validateLicense method - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts
**Spec Reference**: implementation-plan.md:197-278
**Pattern to Follow**: rpc-handler.ts:67 (constructor injection pattern)

**Quality Requirements**:

- MUST inject LicenseService via constructor
- MUST use `getCachedStatus()` only (NO server calls)
- MUST log rejections at INFO level with method name and tier
- MUST return structured RpcLicenseValidationResult (not throw)

**Validation Notes**:

- Handle edge case: No cached status (return LICENSE_REQUIRED)
- Handle edge case: Invalid license (return LICENSE_REQUIRED)
- Handle edge case: Pro-only method with Basic tier (return PRO_TIER_REQUIRED)
- Exempt methods must bypass ALL checks (license:_, auth:_)

**Implementation Details**:

- Import LicenseService and TOKENS.LICENSE_SERVICE
- Add `@inject(TOKENS.LICENSE_SERVICE) private readonly licenseService: LicenseService` to constructor
- Add private `validateLicense(method: string): RpcLicenseValidationResult` method
- Add private `isProOnlyMethod(method: string): boolean` helper method
- Check exempt prefixes first (always allowed)
- Check cached status exists
- Check status.valid
- Check Pro tier for pro-only methods

---

### Task 1.4: Integrate license validation into handleMessage - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts
**Spec Reference**: implementation-plan.md:100-117
**Pattern to Follow**: rpc-handler.ts:138-171 (existing handleMessage structure)

**Quality Requirements**:

- MUST call validateLicense() BEFORE handler lookup
- MUST return structured RpcResponse with errorCode on failure
- MUST preserve existing handler execution flow
- MUST NOT break backward compatibility

**Implementation Details**:

- Add validation call at start of handleMessage (after extracting method/params/correlationId)
- If not allowed, return early with: { success: false, error: validation.error.message, errorCode: validation.error.code, correlationId }
- Continue to existing handler lookup if allowed

---

### Task 1.5: Update index.ts exports if needed - IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts
**Spec Reference**: implementation-plan.md:406-410
**Pattern to Follow**: index.ts:66 (existing RpcResponse export)

**Quality Requirements**:

- MUST verify RpcResponse type is already exported (it is at line 66)
- MUST add RpcLicenseValidationResult export if needed for testing
- MUST maintain backward compatibility

**Implementation Details**:

- Check if RpcResponse is already exported (YES - line 66)
- Optionally export RpcLicenseValidationResult type for testing
- No changes needed if all types are internal to RpcHandler

---

**Batch 1 Verification**:

- [x] All files exist at paths
- [x] Build passes: `npx nx build vscode-core`
- [x] code-logic-reviewer approved (with fixes applied in Batch 2)
- [x] Edge cases from validation handled
- [x] No server calls in validateLicense (uses getCachedStatus only)

---

## Batch 2: Code Logic Review Fixes - COMPLETED

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Fix errorCode forwarding in WebviewMessageHandlerService - COMPLETED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\services\webview-message-handler.service.ts
**Issue**: errorCode generated in RpcHandler but not forwarded to frontend via postMessage

**Fix Applied**:
- Added `errorCode: response.errorCode` to postMessage payload at line 258-264

---

### Task 2.2: Add errorCode to frontend RpcResponse and RpcResult - COMPLETED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\claude-rpc.service.ts
**Issue**: Frontend interface and class did not include errorCode field

**Fixes Applied**:
1. Added `errorCode?: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED'` to RpcResponse interface
2. Added `errorCode` parameter to RpcResult class constructor
3. Added `isLicenseError()` and `isProRequired()` helper methods to RpcResult
4. Updated call() method to pass errorCode to RpcResult constructor

---

### Task 2.3: Add try/catch in validateLicense for defensive coding - COMPLETED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts
**Issue**: If getCachedStatus() throws unexpectedly, handleMessage would crash

**Fix Applied**:
- Wrapped validateLicense() internals in try/catch block
- Returns LICENSE_REQUIRED on exception (fail-closed, not fail-open)
- Logs error with method name for debugging

---

### Task 2.4: Document Pro feature RPC prefix mapping - COMPLETED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts
**Issue**: PRO_ONLY_METHOD_PREFIXES comment didn't explain unmapped Pro features

**Fix Applied**:
- Added comprehensive documentation for Pro feature -> RPC prefix mapping
- Documented that other Pro features (mcp_server, workspace_intelligence, custom_tools, cost_tracking) are gated via FeatureGateService, not RPC layer
- Added note for future developers to add prefixes when new Pro features expose RPC endpoints

---

**Batch 2 Verification**:

- [x] Build passes: `npx nx build vscode-core`
- [x] Build passes: `npx nx build core`
- [x] errorCode flows end-to-end from RpcHandler -> WebviewMessageHandler -> Frontend
- [x] Defensive error handling in validateLicense prevents crashes

---

_Created by Team-Leader Agent - TASK_2025_124_
_Updated: 2026-01-27 (Batch 2 completed)_
