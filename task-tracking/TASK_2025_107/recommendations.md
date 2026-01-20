# Recommendations - License Verification Audit - TASK_2025_107

**Date**: 2025-01-20
**Auditor**: Research Expert Agent

---

## Executive Summary

Based on the comprehensive audit, the current license enforcement is **generally effective** for the primary premium feature (MCP Server). However, there are opportunities to improve maintainability, prevent future security gaps, and enhance the developer experience. This document provides prioritized, actionable recommendations.

---

## 1. Should We Create a `*ptahPremium` Directive?

### Recommendation: YES, but LOW PRIORITY

**Rationale**:
- Currently only SettingsComponent uses premium gating
- Angular structural directives provide cleaner templates
- Reduces code duplication if more premium UI sections are added

**Proposed Implementation**:

```typescript
// libs/frontend/core/src/lib/directives/premium.directive.ts
import { Directive, Input, TemplateRef, ViewContainerRef, inject, effect } from '@angular/core';
import { LicenseStateService } from '../services/license-state.service';

@Directive({
  selector: '[ptahPremium]',
  standalone: true,
})
export class PtahPremiumDirective {
  private readonly licenseState = inject(LicenseStateService);
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);

  private hasView = false;

  @Input() set ptahPremium(showWhenPremium: boolean) {
    // Default: show when premium (true), hide when free
    const shouldShow = showWhenPremium === undefined ? true : showWhenPremium;

    effect(() => {
      const isPremium = this.licenseState.isPremium();
      const show = shouldShow ? isPremium : !isPremium;

      if (show && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!show && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
```

**Usage**:
```html
<!-- Show for premium users -->
<div *ptahPremium>
  <h2>Premium Features</h2>
</div>

<!-- Show for free users (upsell) -->
<div *ptahPremium="false">
  <button>Upgrade to Premium</button>
</div>
```

**Priority**: P3 (Low) - Current `@if` approach works fine with only one usage location

**Effort**: 4-8 hours (including tests)

---

## 2. Should We Create Route Guards?

### Recommendation: NO (Not Applicable)

**Rationale**:
- Ptah Extension uses signal-based navigation, NOT Angular Router
- Route guards are Router-specific constructs
- The webview doesn't have traditional routes to guard

**Alternative for Signal-Based Navigation**:
If premium-only views are added in the future, guard logic should be in `AppStateManager`:

```typescript
// libs/frontend/core/src/lib/services/app-state-manager.service.ts
async setCurrentView(view: AppView): Promise<void> {
  // Check premium requirement
  if (PREMIUM_VIEWS.includes(view) && !await this.licenseState.isPremium()) {
    this.showUpgradePrompt();
    return;
  }
  this._currentView.set(view);
}

const PREMIUM_VIEWS: AppView[] = [
  // Add premium-only views here if/when created
];
```

**Priority**: N/A - Not applicable to current architecture

---

## 3. Should We Centralize License State?

### Recommendation: YES, MEDIUM PRIORITY

**Rationale**:
- SettingsComponent currently owns license state
- Other components may need license status
- Eliminates duplicate RPC calls
- Enables reactive updates across UI

**Proposed Implementation**:

```typescript
// libs/frontend/core/src/lib/services/license-state.service.ts
import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import type { LicenseGetStatusResponse, LicenseTier } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class LicenseStateService implements OnDestroy {
  private readonly rpcService = inject(ClaudeRpcService);

  // Core state
  private readonly _isLoading = signal(true);
  private readonly _valid = signal(false);
  private readonly _tier = signal<LicenseTier>('free');
  private readonly _daysRemaining = signal<number | null>(null);
  private readonly _plan = signal<{ name: string; description: string } | undefined>(undefined);

  // Computed
  readonly isLoading = this._isLoading.asReadonly();
  readonly isPremium = computed(() => this._tier() !== 'free');
  readonly tier = this._tier.asReadonly();
  readonly daysRemaining = this._daysRemaining.asReadonly();
  readonly plan = this._plan.asReadonly();

  // Combined state for components
  readonly showPremiumFeatures = computed(
    () => !this._isLoading() && this.isPremium()
  );

  // Refresh interval (every 5 minutes to catch upgrades)
  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor() {
    this.refresh();
    this.refreshInterval = setInterval(() => this.refresh(), 5 * 60 * 1000);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  async refresh(): Promise<void> {
    this._isLoading.set(true);
    try {
      const result = await this.rpcService.call('license:getStatus', {});
      if (result.isSuccess() && result.data) {
        const data = result.data as LicenseGetStatusResponse;
        this._valid.set(data.valid);
        this._tier.set(data.tier);
        this._daysRemaining.set(data.daysRemaining);
        this._plan.set(data.plan);
      }
    } catch (error) {
      console.error('[LicenseStateService] Failed to fetch status:', error);
      // Graceful degradation: assume free tier
      this._tier.set('free');
    } finally {
      this._isLoading.set(false);
    }
  }
}
```

**Benefits**:
1. Single source of truth for license state
2. Automatic refresh catches mid-session upgrades
3. Reduces RPC calls (shared across components)
4. Enables premium directive implementation

**Migration**:
```typescript
// SettingsComponent - After
export class SettingsComponent {
  readonly licenseState = inject(LicenseStateService);

  // Remove: isPremium, licenseTier, isLoadingLicenseStatus signals
  // Remove: fetchLicenseStatus() method

  // Use: this.licenseState.isPremium(), this.licenseState.isLoading()
}
```

**Priority**: P2 (Medium) - Improves architecture, enables future features

**Effort**: 8-16 hours (including migration and tests)

---

## 4. Backend License Check Improvements

### 4.1 Add License Check to LLM RPC Handlers

**Recommendation**: YES, MEDIUM PRIORITY

**Implementation**:

```typescript
// apps/ptah-extension-vscode/src/services/rpc/handlers/llm-rpc.handlers.ts
@injectable()
export class LlmRpcHandlers {
  constructor(
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    // ... other deps
  ) {}

  private async requirePremium(): Promise<void> {
    const status = await this.licenseService.verifyLicense();
    if (status.tier === 'free') {
      throw new Error('Premium license required for LLM provider configuration');
    }
  }

  // In handler registration:
  this.rpcHandler.registerMethod<LlmSetApiKeyParams, LlmSetApiKeyResponse>(
    'llm:setApiKey',
    async (params) => {
      await this.requirePremium(); // <-- Add this check
      // ... existing logic
    }
  );
}
```

**Methods to Gate**:
- `llm:setApiKey`
- `llm:removeApiKey`
- `openrouter:setModelTier`
- `openrouter:clearModelTier`

**Priority**: P2 (Medium) - Prevents free users from polluting config

**Effort**: 2-4 hours

### 4.2 Consider RPC Middleware Pattern

**Recommendation**: OPTIONAL, LOW PRIORITY

**Rationale**:
- Would allow declarative premium method registration
- Reduces boilerplate in individual handlers
- Provides centralized audit log

**Implementation Sketch**:

```typescript
// libs/backend/vscode-core/src/messaging/rpc-handler.ts
interface RpcMethodOptions {
  requiresPremium?: boolean;
}

registerMethod<P, R>(
  method: string,
  handler: (params: P) => Promise<R>,
  options?: RpcMethodOptions
): void {
  const wrappedHandler = async (params: P) => {
    if (options?.requiresPremium) {
      const status = await this.licenseService.verifyLicense();
      if (status.tier === 'free') {
        throw new RpcError('PREMIUM_REQUIRED', 'Premium license required');
      }
    }
    return handler(params);
  };
  // ... register wrapped handler
}
```

**Priority**: P3 (Low) - Nice-to-have for future maintainability

**Effort**: 8-16 hours (affects core infrastructure)

---

## 5. Priority Matrix

### P1 - Critical (Do Now)

| Item | Effort | Impact |
|------|--------|--------|
| Document premium vs free features | 2h | Process clarity |

### P2 - High (Do Soon)

| Item | Effort | Impact |
|------|--------|--------|
| Add license checks to LLM RPC handlers | 4h | Security |
| Create LicenseStateService | 16h | Architecture |

### P3 - Medium (Do Later)

| Item | Effort | Impact |
|------|--------|--------|
| Create `*ptahPremium` directive | 8h | DX improvement |
| Add expiry countdown to Settings UI | 4h | UX improvement |
| RPC middleware pattern | 16h | Future maintainability |

### P4 - Low (Backlog)

| Item | Effort | Impact |
|------|--------|--------|
| License change event subscription | 4h | Edge case UX |
| Premium analytics dashboard | TBD | Future feature |

---

## 6. Implementation Order

### Phase 1: Immediate (This Sprint)

1. **Document premium features** - Create `PREMIUM_FEATURES.md`
2. **Add LLM RPC checks** - Quick security win

### Phase 2: Near-term (Next Sprint)

3. **Create LicenseStateService** - Centralize frontend state
4. **Migrate SettingsComponent** - Use new service

### Phase 3: Future (Backlog)

5. **Create `*ptahPremium` directive** - When more premium UI needed
6. **Consider RPC middleware** - When many premium methods exist

---

## 7. Testing Strategy

### Unit Tests

```typescript
// LicenseStateService.spec.ts
describe('LicenseStateService', () => {
  it('should return isPremium=true for early_adopter tier');
  it('should return isPremium=false for free tier');
  it('should refresh on interval');
  it('should gracefully degrade on error');
});

// PtahPremiumDirective.spec.ts (if implemented)
describe('*ptahPremium', () => {
  it('should show content for premium users');
  it('should hide content for free users');
  it('should show upsell when ptahPremium="false"');
});
```

### Integration Tests

```typescript
// LLM RPC handlers
describe('llm:setApiKey', () => {
  it('should reject for free users');
  it('should allow for premium users');
});
```

---

## 8. Risk Mitigation

### Risk: Breaking Existing Functionality

**Mitigation**:
- Implement LicenseStateService alongside SettingsComponent
- Migrate one component at a time
- Feature flag new service if needed

### Risk: Performance Impact

**Mitigation**:
- Cache license status (already done in LicenseService)
- Limit refresh interval (5 minutes suggested)
- Use signals for reactive updates (no polling)

### Risk: Premium Feature Creep

**Mitigation**:
- Maintain PREMIUM_FEATURES.md
- Code review checklist item: "Does this need license check?"
- Consider CI lint rule for new RPC methods

---

## 9. Conclusion

The current license implementation is **good for the MVP**. The MCP server (primary premium feature) is properly gated. Recommendations focus on:

1. **Security hardening** - Add checks to LLM RPC methods
2. **Developer experience** - Centralize license state
3. **Maintainability** - Document and standardize patterns

**No critical issues found**. All recommendations are improvements for scale and maintainability.

---

## Appendix: PREMIUM_FEATURES.md Template

Create this file at `docs/PREMIUM_FEATURES.md`:

```markdown
# Ptah Premium Features

## Premium Features (early_adopter tier)

| Feature | Backend Check | Frontend Check | Notes |
|---------|--------------|----------------|-------|
| MCP Server | main.ts:167 | N/A | Gated at activation |
| MCP Port Config | N/A | settings.component.html:135 | UI only |
| LLM Provider API Keys | llm-rpc.handlers.ts | settings.component.html:135 | TODO: Add backend check |
| Ptah API (14 namespaces) | Via MCP gating | N/A | Protected by MCP |

## Free Features

| Feature | Notes |
|---------|-------|
| Chat Interface | Core value |
| Session History | Core value |
| Agent Generation | Part of setup |
| Setup Wizard | Onboarding |
| Model Selection | Config |
| Autopilot Mode | Config |
| Authentication | Required for core |

## Adding New Premium Features

1. Add backend license check in RPC handler
2. Add frontend visibility check in component
3. Update this document
4. Add tests for license gating
```
