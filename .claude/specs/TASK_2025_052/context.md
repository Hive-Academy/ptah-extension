# Task Context: PricingService DI Registration Fix

**Created**: 2025-12-07  
**Type**: BUGFIX  
**Priority**: P0 (Critical - Blocks Extension Activation)  
**Complexity**: Medium

## User Intent

Fix the extension activation failure caused by missing `PricingService` registration in the DI container. The error occurs during Step 8 of activation ("Initializing Pricing Service") and prevents the entire extension from loading.

Additionally, investigate how the PricingService is being used with the new `agentsdk` package integration to ensure proper integration.

## Error Details

```
Error: Attempted to resolve unregistered dependency token: "Symbol(PricingService)"
  at InternalDependencyContainer.resolve (main.js:23010:19)
  at DIContainer.resolve (main.js:299:37)
  at activation (main.js:384:60)
```

**Log File**: `D:\projects\ptah-extension\vscode-app-1764005778940.log`  
**Failure Point**: Line 90 - [Activate] Step 8: Initializing Pricing Service

## Context

- Recent SDK integration work (TASK_2025_049 in progress) may have affected service registration
- The pricing service needs to be registered in the DI container before it can be resolved
- Need to understand the relationship between PricingService and the new SDK adapter

## Success Criteria

1. ✅ PricingService properly registered in DI container
2. ✅ Extension activates successfully without errors
3. ✅ Investigation complete on SDK/pricing service interaction
4. ✅ Verification that pricing service works correctly with SDK integration

## Related Tasks

- TASK_2025_049: SDK Integration Review & Critical Fixes (In Progress)
- TASK_2025_044: Claude Agent SDK Integration (Planned)
