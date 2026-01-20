# Task Context - TASK_2025_107

## User Intent

Based on TASK_2025_079 (Settings Conditional Visibility & Premium Gating), perform a comprehensive codebase verification to ensure:

1. **Backend License Enforcement**: All premium features are properly gated by license checks on the backend
2. **Frontend License Enforcement**: All premium UI features are hidden/disabled based on license status
3. **Route Guards / Directives**: Implement proper route guards or directives to show/hide premium features based on:
   - License existence (authenticated vs unauthenticated)
   - License expiry date (valid vs expired)
   - License tier (free vs early_adopter)
4. **Gap Analysis**: Identify any premium features that may be missing proper license checks

## Conversation Summary

- TASK_2025_079 completed: Added license RPC handler, conditional settings visibility, premium gating
- User wants comprehensive audit of the implementation
- Need to verify both backend and frontend enforcement
- Should evaluate need for reusable directives/guards for premium feature gating

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2026-01-20
- Type: RESEARCH (Comprehensive audit with potential FEATURE follow-up)
- Complexity: Medium (Audit existing code, may lead to implementation tasks)

## Related Tasks

- **TASK_2025_075**: Simplified License Server (No Payments) - Backend license server implementation
- **TASK_2025_079**: Settings Conditional Visibility & Premium Gating - Frontend/backend gating implementation
- **TASK_2025_076**: Settings VS Code Secrets Sync - Credential display in Settings UI

## Execution Strategy

### Phase 1: Research - Comprehensive License Audit

Invoke researcher-expert to:
1. Audit all backend services for license checks
2. Audit all frontend components for premium gating
3. Identify gaps in enforcement
4. Evaluate existing patterns (computed signals, RPC handlers)
5. Recommend directive/guard implementation if needed

### Phase 2 (If Needed): Implementation

Based on audit findings:
- Create reusable Angular directive for premium feature gating
- Add missing license checks to backend services
- Standardize the gating pattern across codebase

## Files to Audit

### Backend License System
- `libs/backend/vscode-core/src/services/license.service.ts` - Core license verification
- `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts` - License RPC
- `apps/ptah-extension-vscode/src/main.ts` - MCP Server gating
- `apps/ptah-extension-vscode/src/commands/license-commands.ts` - License commands

### Frontend Premium Gating
- `libs/frontend/chat/src/lib/settings/settings.component.ts` - Settings visibility
- `libs/frontend/chat/src/lib/settings/settings.component.html` - Conditional sections
- `libs/frontend/chat/src/lib/settings/auth-config.component.ts` - Auth status

### Shared Types
- `libs/shared/src/lib/types/rpc.types.ts` - License RPC types

## Expected Deliverables

1. **Audit Report** (`audit-report.md`): Comprehensive analysis of current implementation
2. **Gap Analysis** (`gap-analysis.md`): Missing checks and recommendations
3. **Implementation Plan** (if needed): Directive/guard design for standardized gating
