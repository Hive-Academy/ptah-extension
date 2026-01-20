# Gap Analysis - License Verification Audit - TASK_2025_107

**Date**: 2025-01-20
**Auditor**: Research Expert Agent

---

## 1. Missing Backend License Checks

### 1.1 LLM RPC Handlers - MEDIUM PRIORITY

**Location**: `apps/ptah-extension-vscode/src/services/rpc/handlers/` (LLM handlers not found in current codebase)

**Issue**: The following RPC methods in `libs/shared/src/lib/types/rpc.types.ts` have no license checks:

| Method | Line | Issue |
|--------|------|-------|
| `llm:setApiKey` | 746 | Allows storing API keys for premium LLM providers |
| `llm:removeApiKey` | 747-750 | Allows removing API keys |
| `llm:getProviderStatus` | 742-745 | Returns provider status (low risk) |
| `openrouter:setModelTier` | 769-772 | Allows configuring premium OpenRouter mapping |
| `openrouter:getModelTiers` | 773-776 | Returns tier configuration |
| `openrouter:clearModelTier` | 777-780 | Clears tier configuration |

**Risk**: A free user could call these RPC methods directly (though the MCP server wouldn't start, so they couldn't actually USE the configured providers via Ptah API).

**Recommended Fix**:
```typescript
// In LlmRpcHandlers (if exists) or create new handler
private async checkPremiumAccess(): Promise<void> {
  const status = await this.licenseService.verifyLicense();
  if (status.tier === 'free') {
    throw new Error('Premium license required for LLM provider configuration');
  }
}
```

### 1.2 Ptah API Namespaces - LOW PRIORITY (Currently Protected)

**Location**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`

**Current State**: These namespaces are only accessible via the MCP server, which IS gated by license check in `main.ts`.

**Issue**: Individual namespace methods have no internal license checks. If a future feature exposes these APIs through a different entry point, they would be unprotected.

**Specific Namespaces at Risk**:
- `ptah.ai` - AI provider integration (line 189)
- `ptah.llm` - Langchain LLM abstraction (line 205)

**Recommended Fix**: Add license check at PtahAPIBuilder.build() or add to each premium namespace builder.

### 1.3 No License Check Middleware in RPC Handler

**Location**: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`

**Issue**: The RPC handler has no middleware system for applying license checks to method groups.

**Impact**: Each premium RPC method must manually check license status.

---

## 2. Missing Frontend License Checks

### 2.1 Settings Component - LOW PRIORITY (Visibility Only)

**Location**: `libs/frontend/chat/src/lib/settings/settings.component.html`

**Current Implementation**:
- Uses `@if (showPremiumSections())` for visibility (line 135)
- Premium sections are HIDDEN but not structurally removed

**Security Concern**: A determined user could:
1. Inspect DOM
2. Remove `hidden` attributes
3. See premium UI elements

**However**: This is low risk because:
- Backend operations still require license
- No actual data is exposed
- Only UI placeholders are shown

### 2.2 No Reusable Premium Directive

**Issue**: Premium visibility is implemented ad-hoc in SettingsComponent. Other components would need to duplicate this logic.

**Current Pattern**:
```typescript
// SettingsComponent
readonly showPremiumSections = computed(
  () => this.isAuthenticated() && this.isPremium()
);
```

**Missing Pattern**:
```html
<!-- Desired: Reusable structural directive -->
<div *ptahPremium>
  <!-- Premium content -->
</div>
```

### 2.3 No Centralized License State Service

**Issue**: License state is fetched and managed in SettingsComponent only. Other components would need to duplicate this.

**Current Pattern**: RPC call in `ngOnInit()` of SettingsComponent
**Missing**: Shared injectable service that caches and broadcasts license state

---

## 3. Security Gaps

### 3.1 Frontend-Only UI Gating (LOW)

**Description**: Premium settings sections rely solely on Angular `@if` directives.

**Risk**: DOM manipulation could reveal hidden elements.
**Impact**: Visual exposure only - no data breach possible.
**Mitigation**: Backend enforcement already exists for MCP server.

### 3.2 LLM API Key Storage Without License Check (MEDIUM)

**Description**: `llm:setApiKey` RPC can be called by free users.

**Risk**: Free users could store API keys for providers they can't use.
**Impact**: Data pollution, potential confusion.
**Mitigation**: Add license check to handler.

### 3.3 No RPC Method-Level Enforcement (PROCESS)

**Description**: Premium RPC methods must individually check license status.

**Risk**: Easy to forget when adding new premium features.
**Impact**: Potential security holes in future development.
**Mitigation**: Create RPC middleware or decorator pattern.

---

## 4. Inconsistent Patterns

### 4.1 License Check Location

| Feature | Check Location | Pattern |
|---------|---------------|---------|
| MCP Server | main.ts activation | Direct check |
| Settings UI | SettingsComponent | Signal + computed |
| LLM RPC | (none) | N/A |
| License RPC | LicenseRpcHandlers | Returns status (no gating) |

**Issue**: No consistent pattern for where/how license checks should occur.

### 4.2 Signal vs RPC Call Pattern

| Feature | State Source | Update Mechanism |
|---------|-------------|------------------|
| isPremium | SettingsComponent.fetchLicenseStatus() | One-time on init |
| License changes | LicenseService.on('license:updated') | Backend events |

**Issue**: Frontend doesn't subscribe to license change events. If a user upgrades mid-session, UI won't update until page refresh.

### 4.3 Graceful Degradation Inconsistency

| Component | On Error Behavior |
|-----------|-------------------|
| LicenseService | Returns cached or free tier |
| SettingsComponent | Sets free tier, logs error |
| LicenseRpcHandlers | Returns free tier object |

**Good**: Consistent free tier fallback. No inconsistency found.

---

## 5. Expiry Handling Gaps

### 5.1 No Active Expiry Monitoring in Frontend

**Location**: `libs/frontend/chat/src/lib/settings/settings.component.ts`

**Issue**: `daysRemaining` is received from RPC but not displayed or monitored.

**Current Response Type** (line 557-571 in rpc.types.ts):
```typescript
export interface LicenseGetStatusResponse {
  daysRemaining: number | null;
  // ...
}
```

**Missing**:
- Expiry warning notification
- Countdown display
- Auto-refresh before expiry

### 5.2 Backend Expiry Handling - GOOD

**Location**: main.ts lines 215-219

**Current Implementation**:
```typescript
licenseService.on('license:expired', (status: LicenseStatus) => {
  logger.warn('License expired - premium features disabled', { status });
  vscode.window.showWarningMessage(
    'Your Ptah premium license has expired...'
  );
});
```

**Status**: Properly implemented with window message.

---

## 6. Specific File Paths with Issues

### HIGH PRIORITY - Add License Checks

| File | Line | Issue |
|------|------|-------|
| N/A | N/A | No LLM RPC handlers file found - may need creation |

### MEDIUM PRIORITY - Consider License Checks

| File | Line | Issue |
|------|------|-------|
| `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` | 143 | build() has no license check (protected by MCP gating) |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` | N/A | AI namespace builders have no license checks |

### LOW PRIORITY - UI/UX Improvements

| File | Line | Issue |
|------|------|-------|
| `libs/frontend/chat/src/lib/settings/settings.component.ts` | 65-67 | License signals local to component, not shared |
| `libs/frontend/chat/src/lib/settings/settings.component.html` | 135 | Frontend-only `@if` visibility |

---

## 7. Feature-to-License Mapping Gaps

### 7.1 Features Clearly Documented as Premium

| Feature | Documentation | Implementation |
|---------|--------------|----------------|
| MCP Server | settings.component.html comments | Gated in main.ts |
| LLM Provider API Keys | settings.component.html:166-178 | UI hidden, no backend check |
| MCP Port Config | settings.component.html:142-159 | UI hidden, config free to read |

### 7.2 Features with Unclear Premium Status

| Feature | Current Behavior | Should Be Premium? |
|---------|-----------------|-------------------|
| OpenRouter Model Mapping | Shown when OpenRouter key exists | UNCLEAR - key is auth, mapping is config |
| Agent Generation | Free | NO (part of core value prop) |
| Dashboard/Analytics | Free | MAYBE (future consideration) |
| Setup Wizard | Free | NO (part of onboarding) |

---

## 8. Summary of Gaps

### Critical (P0) - None Found

### High Priority (P1)

1. **Process Gap**: No documentation on which features require premium
2. **Process Gap**: No standard pattern for adding license checks to new features

### Medium Priority (P2)

1. **LLM RPC Methods**: Add license checks to `llm:setApiKey` and related methods
2. **Centralized License State**: Create shared license state service for frontend

### Low Priority (P3)

1. **Premium Directive**: Create `*ptahPremium` structural directive
2. **Expiry UI**: Add expiry countdown/warning to Settings
3. **Event Subscription**: Frontend should listen to license change events

---

## 9. Recommended Actions

1. **Immediate**: Document which features are premium vs free
2. **Short-term**: Add license checks to LLM-related RPC handlers
3. **Medium-term**: Create centralized license state service
4. **Long-term**: Consider RPC middleware for premium method groups
