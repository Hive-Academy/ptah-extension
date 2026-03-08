# Implementation Plan - TASK_2025_126

## Embedded Welcome Page for Unlicensed Users

**Prepared by**: Software Architect
**Date**: 2026-01-27
**Task ID**: TASK_2025_126
**Complexity**: Medium-High
**Estimated Effort**: 4-5 hours

---

## Executive Summary

This implementation plan details the architecture for replacing the VS Code modal popup with an embedded welcome page inside the extension webview. The solution follows established patterns from the codebase (setup-wizard, settings components) and leverages existing RPC infrastructure.

---

## Codebase Investigation Summary

### Libraries Discovered

| Library                       | Purpose                | Key Exports                                            |
| ----------------------------- | ---------------------- | ------------------------------------------------------ |
| `@ptah-extension/core`        | Frontend services      | `AppStateManager`, `ClaudeRpcService`, `VSCodeService` |
| `@ptah-extension/chat`        | Chat UI components     | App shell, settings, templates                         |
| `@ptah-extension/shared`      | Type definitions       | `LicenseGetStatusResponse`, `LicenseTier`, RPC types   |
| `@ptah-extension/vscode-core` | Backend infrastructure | `LicenseService`, `TOKENS`                             |

### Patterns Identified

**1. ViewType Navigation Pattern**

- **Evidence**: `libs/frontend/core/src/lib/services/app-state.service.ts:11-17`
- **Pattern**: Union type with signal-based navigation
- **Usage**: `@switch (currentView())` in app-shell.component.html

**2. Standalone View Pattern**

- **Evidence**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:11-24`
- **Pattern**: `@case ('setup-wizard')` and `@case ('settings')` render full-width standalone layouts
- **Key**: No sidebar, no tabs, clean focused UI

**3. License RPC Pattern**

- **Evidence**: `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts:77-114`
- **Pattern**: `license:getStatus` RPC returns `LicenseGetStatusResponse` with `reason` field
- **Usage**: `SettingsComponent` (line 143) calls `this.rpcService.call('license:getStatus', {})`

**4. VS Code Command Execution Pattern**

- **Evidence**: `apps/ptah-extension-vscode/src/main.ts:67-79`
- **Pattern**: Commands registered as `ptah.enterLicenseKey`, `ptah.openPricing`
- **Usage**: `vscode.commands.executeCommand('ptah.enterLicenseKey')`

**5. WebviewHtmlGenerator Pattern**

- **Evidence**: `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:80-96`
- **Pattern**: `VALID_VIEWS` array validation, `initialView` option
- **Key**: Must add 'welcome' to VALID_VIEWS array

### Integration Points Verified

| Component             | Location                          | Integration Method                 |
| --------------------- | --------------------------------- | ---------------------------------- |
| ViewType              | `app-state.service.ts:11-17`      | Add 'welcome' to union             |
| App Shell             | `app-shell.component.html:11`     | Add `@case ('welcome')`            |
| VALID_VIEWS           | `webview-html-generator.ts:81-88` | Add 'welcome' to array             |
| handleLicenseBlocking | `main.ts:88-105`                  | Replace modal with webview         |
| License RPC           | `license-rpc.handlers.ts`         | Reuse existing `license:getStatus` |

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Standalone View with License-Gate Pattern
**Rationale**:

1. Matches existing patterns (setup-wizard, settings)
2. Reuses existing RPC and command infrastructure
3. No new backend RPC methods required
4. Clean user experience with focused onboarding

**Evidence**:

- Setup-wizard pattern: `wizard-view.component.ts:59-199`
- Settings pattern: `settings.component.ts:37-162`
- License RPC: `license-rpc.handlers.ts:77-114`

---

## Component Specifications

### Component 1: ViewType Extension

**Purpose**: Add 'welcome' to the navigation system's ViewType union

**Pattern**: ViewType Union Extension (verified from `app-state.service.ts:11-17`)

**Files Affected**:

- `libs/frontend/core/src/lib/services/app-state.service.ts` (MODIFY)

**Implementation Pattern**:

```typescript
// Source pattern: app-state.service.ts:11-17
export type ViewType = 'chat' | 'command-builder' | 'analytics' | 'context-tree' | 'settings' | 'setup-wizard' | 'welcome'; // NEW: Add welcome view
```

**Quality Requirements**:

- Must maintain union type semantics
- All existing navigation must continue working
- TypeScript must enforce valid view types

---

### Component 2: WelcomeComponent

**Purpose**: Full-page welcome/onboarding component for unlicensed users

**Pattern**: Standalone View Component (verified from `settings.component.ts`, `wizard-view.component.ts`)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/templates/welcome.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/templates/welcome.component.html` (CREATE)

**Implementation Pattern**:

```typescript
// Pattern source: settings.component.ts:37-162
// Pattern source: wizard-view.component.ts:59-199

import { Component, inject, ChangeDetectionStrategy, signal, OnInit } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import type { LicenseGetStatusResponse } from '@ptah-extension/shared';
import { LucideAngularModule, Key, ExternalLink, Sparkles, Zap, GitBranch, Bot } from 'lucide-angular';

/**
 * WelcomeComponent - Embedded onboarding page for unlicensed users
 *
 * Complexity Level: 2 (View with RPC and command execution)
 * Pattern: Standalone View (matches setup-wizard, settings)
 *
 * Responsibilities:
 * - Display Ptah branding and value proposition
 * - Show context-aware messaging based on license reason
 * - Provide license key entry action (VS Code command)
 * - Provide pricing/trial actions (external URLs)
 * - Block navigation to other views (no escape hatch)
 *
 * TASK_2025_126: Replaces VS Code modal for unlicensed users
 */
@Component({
  selector: 'ptah-welcome',
  standalone: true,
  imports: [NgOptimizedImage, LucideAngularModule],
  templateUrl: './welcome.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  // Icons
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly SparklesIcon = Sparkles;
  readonly ZapIcon = Zap;
  readonly GitBranchIcon = GitBranch;
  readonly BotIcon = Bot;

  // State signals
  readonly licenseReason = signal<string | null>(null);
  readonly isLoadingStatus = signal(true);
  readonly errorMessage = signal<string | null>(null);

  // Ptah icon URI from VSCodeService
  readonly ptahIconUri: string;

  // Feature highlights
  readonly features = [
    { icon: this.BotIcon, title: 'AI-Powered Assistance', description: 'Get intelligent code suggestions and explanations' },
    { icon: this.GitBranchIcon, title: 'Multi-Agent Orchestration', description: 'Coordinate specialized agents for complex tasks' },
    { icon: this.ZapIcon, title: 'VS Code Native Integration', description: 'Seamless integration with your development workflow' },
    { icon: this.SparklesIcon, title: 'Session Continuity', description: 'Resume conversations and maintain context across sessions' },
  ];

  constructor() {
    this.ptahIconUri = this.vscodeService.getPtahIconUri();
  }

  async ngOnInit(): Promise<void> {
    await this.fetchLicenseStatus();
  }

  /**
   * Fetch license status to determine context-aware messaging
   * Pattern: settings.component.ts:140-161
   */
  private async fetchLicenseStatus(): Promise<void> {
    this.isLoadingStatus.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('license:getStatus', {});

      if (result.isSuccess() && result.data) {
        const data = result.data as LicenseGetStatusResponse;
        // Note: reason field needs to be added to LicenseGetStatusResponse
        this.licenseReason.set((data as any).reason ?? null);
      }
    } catch (error) {
      console.error('[WelcomeComponent] Failed to fetch license status:', error);
      this.errorMessage.set('Failed to check license status');
    } finally {
      this.isLoadingStatus.set(false);
    }
  }

  /**
   * Get contextual headline based on license reason
   */
  getHeadline(): string {
    const reason = this.licenseReason();
    switch (reason) {
      case 'expired':
        return 'Your subscription has expired';
      case 'trial_ended':
        return 'Your trial has ended';
      default:
        return 'Welcome to Ptah';
    }
  }

  /**
   * Get contextual subheadline based on license reason
   */
  getSubheadline(): string {
    const reason = this.licenseReason();
    switch (reason) {
      case 'expired':
        return "Renew your subscription to continue using Ptah's powerful AI-assisted development features.";
      case 'trial_ended':
        return 'Subscribe now to unlock the full potential of AI-assisted development.';
      default:
        return 'Transform your Claude Code experience with a native VS Code interface.';
    }
  }

  /**
   * Trigger license key entry via VS Code command
   * Pattern: main.ts:68-71
   */
  enterLicenseKey(): void {
    this.vscodeService.postMessage({
      type: 'command',
      payload: { command: 'ptah.enterLicenseKey' },
    });
  }

  /**
   * Open pricing page in external browser
   * Pattern: main.ts:75-77
   */
  viewPricing(): void {
    this.vscodeService.postMessage({
      type: 'command',
      payload: { command: 'ptah.openPricing' },
    });
  }

  /**
   * Start trial (opens pricing page)
   * Same as viewPricing - trial starts from pricing page
   */
  startTrial(): void {
    this.viewPricing();
  }

  /**
   * Retry license status fetch
   */
  retryStatus(): void {
    this.fetchLicenseStatus();
  }
}
```

**Template Pattern**:

```html
<!-- Pattern source: wizard-view.component.ts:70-124 (hero layout) -->
<!-- Pattern source: settings.component.html (DaisyUI classes) -->

<div class="hero min-h-screen bg-base-100">
  <div class="hero-content text-center max-w-2xl">
    <div class="flex flex-col items-center gap-6">
      <!-- Ptah Logo -->
      <img [ngSrc]="ptahIconUri" alt="Ptah" class="w-20 h-20" width="80" height="80" priority />

      <!-- Headline (context-aware) -->
      <h1 class="text-4xl font-bold text-base-content">{{ getHeadline() }}</h1>

      <!-- Subheadline (context-aware) -->
      <p class="text-lg text-base-content/70 max-w-lg">{{ getSubheadline() }}</p>

      <!-- Feature Highlights -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 w-full max-w-xl">
        @for (feature of features; track feature.title) {
        <div class="card bg-base-200 p-4">
          <div class="flex items-start gap-3">
            <lucide-angular [img]="feature.icon" class="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div class="text-left">
              <h3 class="font-semibold text-sm">{{ feature.title }}</h3>
              <p class="text-xs text-base-content/60">{{ feature.description }}</p>
            </div>
          </div>
        </div>
        }
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row gap-3 mt-6 w-full max-w-sm">
        <!-- Start Trial (Primary) -->
        <button class="btn btn-secondary btn-lg flex-1 gap-2" (click)="startTrial()" aria-label="Start 14-day free trial">
          <lucide-angular [img]="SparklesIcon" class="w-5 h-5" />
          Start 14-Day Trial
        </button>

        <!-- Enter License Key (Outline) -->
        <button class="btn btn-primary btn-lg flex-1 gap-2" (click)="enterLicenseKey()" aria-label="Enter license key">
          <lucide-angular [img]="KeyIcon" class="w-5 h-5" />
          Enter License Key
        </button>
      </div>

      <!-- View Pricing Link -->
      <button class="btn btn-ghost btn-sm gap-1 text-base-content/60" (click)="viewPricing()" aria-label="View pricing options">
        <lucide-angular [img]="ExternalLinkIcon" class="w-4 h-4" />
        View Pricing
      </button>

      <!-- Error State -->
      @if (errorMessage()) {
      <div class="alert alert-warning mt-4 max-w-sm">
        <span>{{ errorMessage() }}</span>
        <button class="btn btn-sm btn-ghost" (click)="retryStatus()">Retry</button>
      </div>
      }
    </div>
  </div>
</div>
```

**Quality Requirements**:

- Must render within 100ms of webview initialization
- Must work with dark, light, and high-contrast themes
- Must have proper ARIA labels for accessibility
- Must use DaisyUI theme variables for color consistency

---

### Component 3: App Shell Integration

**Purpose**: Render WelcomeComponent in standalone mode (no sidebar/tabs)

**Pattern**: Standalone View Case (verified from `app-shell.component.html:11-24`)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` (MODIFY)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` (MODIFY)

**Implementation Pattern**:

```html
<!-- Add after @case ('settings') block, before @default -->
<!-- Pattern source: app-shell.component.html:11-24 -->

<!-- Welcome: Full-width, standalone layout (no sidebar, no tabs) -->
@case ('welcome') {
<div class="h-full w-full">
  <ptah-welcome />
</div>
}
```

**TypeScript Import**:

```typescript
// Add to imports array in app-shell.component.ts
import { WelcomeComponent } from './welcome.component';

// Add to @Component imports
imports: [
  // ... existing imports
  WelcomeComponent,
],
```

**Quality Requirements**:

- Must match setup-wizard and settings layout pattern
- Must not render sidebar or tab bar
- Must be full-width, full-height

---

### Component 4: VALID_VIEWS Backend Update

**Purpose**: Allow backend to set `initialView: 'welcome'`

**Pattern**: VALID_VIEWS Array (verified from `webview-html-generator.ts:81-88`)

**Files Affected**:

- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` (MODIFY)

**Implementation Pattern**:

```typescript
// Pattern source: webview-html-generator.ts:81-88
const VALID_VIEWS = [
  'chat',
  'command-builder',
  'analytics',
  'context-tree',
  'settings',
  'setup-wizard',
  'welcome', // NEW: Add welcome view
];
```

**Quality Requirements**:

- Must validate 'welcome' as a valid initialView option
- Must throw error for invalid views (existing behavior)

---

### Component 5: License Blocking Flow Modification

**Purpose**: Show webview with welcome view instead of modal popup

**Pattern**: Minimal Webview Initialization (design based on existing flow)

**Files Affected**:

- `apps/ptah-extension-vscode/src/main.ts` (MODIFY)

**Current Flow** (lines 88-105):

```typescript
async function handleLicenseBlocking(context: vscode.ExtensionContext, licenseService: LicenseService, status: LicenseStatus): Promise<void> {
  // Register minimal commands for license management
  registerLicenseOnlyCommands(context, licenseService);

  // Show blocking UI and handle user selection
  const selection = await showLicenseRequiredUI(status);
  // ... handle selection
}
```

**New Flow**:

```typescript
async function handleLicenseBlocking(context: vscode.ExtensionContext, licenseService: LicenseService, status: LicenseStatus): Promise<void> {
  // Register minimal commands for license management
  registerLicenseOnlyCommands(context, licenseService);

  // TASK_2025_126: Show webview with welcome view instead of modal
  // Create minimal webview provider for unlicensed users
  const { WebviewHtmlGenerator } = require('./services/webview-html-generator');
  const htmlGenerator = new WebviewHtmlGenerator(context);

  // Register webview provider with initialView: 'welcome'
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView: vscode.WebviewView): void {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview', 'browser')],
      };

      // Generate HTML with welcome view
      const workspaceInfo = {
        name: vscode.workspace.workspaceFolders?.[0]?.name || 'Workspace',
        path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      };

      webviewView.webview.html = htmlGenerator.generateAngularWebviewContent(webviewView.webview, { workspaceInfo, initialView: 'welcome' });
    },
  };

  // Register the webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ptah.main', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  console.log('[Activate] Webview registered with welcome view for unlicensed user');

  // DO NOT show modal - webview handles onboarding
  // The modal code (showLicenseRequiredUI) is bypassed
}
```

**Quality Requirements**:

- Must NOT show blocking modal
- Must register license commands before webview
- Must initialize webview with `initialView: 'welcome'`
- Must provide workspaceInfo for context

---

### Component 6: Navigation Blocking

**Purpose**: Prevent users from escaping welcome view without license

**Pattern**: Signal-Based Navigation Guard

**Implementation Strategy**:

The navigation blocking is already handled by the design:

1. **No Sidebar**: Welcome view renders without sidebar (pattern from setup-wizard)
2. **No Tab Bar**: Welcome view renders without tab bar
3. **No Close Button**: No dismiss mechanism in UI design
4. **`canSwitchViews`**: Already exists in AppStateManager but needs enhancement

**Enhancement to AppStateManager** (optional, for defense-in-depth):

```typescript
// In app-state.service.ts
// Add license-aware navigation blocking

// Option 1: Check current view before allowing switch
setCurrentView(view: ViewType): void {
  if (this._currentView() === 'welcome' && view !== 'welcome') {
    // Block navigation away from welcome (defense-in-depth)
    console.warn('[AppStateManager] Navigation blocked: user on welcome view');
    return;
  }
  if (this.canSwitchViews()) {
    this._currentView.set(view);
  }
}
```

**Quality Requirements**:

- Users must not be able to navigate to 'chat', 'analytics', etc. from welcome
- Only license activation (which reloads window) should exit welcome
- No programmatic escape hatches

---

### Component 7: RPC Response Type Extension (Optional)

**Purpose**: Expose `reason` field in LicenseGetStatusResponse for context-aware messaging

**Pattern**: RPC Type Extension (verified from `rpc.types.ts:549-595`)

**Files Affected**:

- `libs/shared/src/lib/types/rpc.types.ts` (MODIFY)

**Implementation Pattern**:

```typescript
// Pattern source: rpc.types.ts:574-595
export interface LicenseGetStatusResponse {
  /** Whether the license is valid */
  valid: boolean;
  /** License tier */
  tier: LicenseTier;
  /** Whether the user has premium features enabled */
  isPremium: boolean;
  /** Whether the user has Basic tier features */
  isBasic: boolean;
  /** Days remaining before subscription expires */
  daysRemaining: number | null;
  /** Whether user is currently in trial period */
  trialActive: boolean;
  /** Days remaining in trial period */
  trialDaysRemaining: number | null;
  /** Plan details */
  plan?: { name: string; description: string; features: string[] };

  // NEW: Add reason field for context-aware welcome messaging
  /** Reason for invalid license (expired, trial_ended, no_license) */
  reason?: 'expired' | 'trial_ended' | 'no_license';
}
```

**Backend Mapping Update** (license-rpc.handlers.ts):

```typescript
// In mapLicenseStatusToResponse method
return {
  // ... existing fields
  reason: status.reason, // Map from LicenseStatus.reason
};
```

**Quality Requirements**:

- Must be optional field (backward compatible)
- Must match LicenseStatus.reason values from backend

---

## Integration Architecture

### Sequence Diagram: Extension Activation to Welcome View

```
┌─────────────────┐    ┌────────────────┐    ┌──────────────┐    ┌─────────────┐
│   VS Code       │    │   main.ts      │    │ WebviewHtml  │    │  Webview    │
│   Extension     │    │  (activate)    │    │  Generator   │    │  (Angular)  │
└────────┬────────┘    └───────┬────────┘    └──────┬───────┘    └──────┬──────┘
         │                     │                    │                   │
         │ activate()          │                    │                   │
         │────────────────────>│                    │                   │
         │                     │                    │                   │
         │                     │ setupMinimal()     │                   │
         │                     │─────────>          │                   │
         │                     │                    │                   │
         │                     │ verifyLicense()    │                   │
         │                     │─────────>          │                   │
         │                     │                    │                   │
         │                     │ status.valid=false │                   │
         │                     │<─────────          │                   │
         │                     │                    │                   │
         │                     │ handleLicenseBlocking()                │
         │                     │─────────────────────────────────────>  │
         │                     │                    │                   │
         │                     │ registerLicenseOnlyCommands()          │
         │                     │─────────>          │                   │
         │                     │                    │                   │
         │                     │ registerWebviewProvider()              │
         │                     │─────────>          │                   │
         │                     │                    │                   │
         │                     │                    │ resolveWebviewView()
         │                     │                    │<──────────────────│
         │                     │                    │                   │
         │                     │                    │ generateAngularWebviewContent()
         │                     │                    │ (initialView: 'welcome')
         │                     │                    │──────────────────>│
         │                     │                    │                   │
         │                     │                    │                   │ Bootstrap Angular
         │                     │                    │                   │ AppStateManager.initializeState()
         │                     │                    │                   │ currentView = 'welcome'
         │                     │                    │                   │
         │                     │                    │                   │ AppShellComponent renders
         │                     │                    │                   │ @case ('welcome') -> WelcomeComponent
         │                     │                    │                   │
```

### Sequence Diagram: License Key Entry Flow

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌────────────────┐
│ WelcomeComponent│    │ VSCodeService│    │  main.ts        │    │ LicenseCommands│
└────────┬────────┘    └──────┬───────┘    └────────┬────────┘    └───────┬────────┘
         │                    │                     │                     │
         │ enterLicenseKey()  │                     │                     │
         │───────────────────>│                     │                     │
         │                    │                     │                     │
         │                    │ postMessage({       │                     │
         │                    │   type: 'command',  │                     │
         │                    │   command: 'ptah.enterLicenseKey'         │
         │                    │ })                  │                     │
         │                    │────────────────────>│                     │
         │                    │                     │                     │
         │                    │                     │ executeCommand()    │
         │                    │                     │────────────────────>│
         │                    │                     │                     │
         │                    │                     │                     │ showInputBox()
         │                    │                     │                     │ (password input)
         │                    │                     │                     │
         │                    │                     │                     │ setLicenseKey()
         │                    │                     │                     │
         │                    │                     │                     │ showInformationMessage()
         │                    │                     │                     │ "Reload Window"
         │                    │                     │                     │
         │                    │                     │ User clicks Reload  │
         │                    │                     │<────────────────────│
         │                    │                     │                     │
         │                    │                     │ reloadWindow()      │
         │                    │                     │                     │
         │                    │                     │ (Extension re-activates with valid license)
         │                    │                     │ (Webview shows 'chat' view)
         │                    │                     │
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Extension Host (Backend)                            │
├──────────────────────────────────────────────────────────────────────────────┤
│  LicenseService.verifyLicense()                                              │
│        │                                                                      │
│        ▼                                                                      │
│  LicenseStatus { valid: false, tier: 'expired', reason: 'no_license' }       │
│        │                                                                      │
│        ▼                                                                      │
│  handleLicenseBlocking() ─────> WebviewHtmlGenerator                          │
│        │                               │                                      │
│        │                               ▼                                      │
│        │                        { initialView: 'welcome' }                    │
│        │                               │                                      │
└────────│───────────────────────────────│──────────────────────────────────────┘
         │                               │
         │ (RPC: license:getStatus)      │ (HTML with window.ptahConfig.initialView)
         │                               │
         ▼                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Webview (Frontend)                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  AppStateManager.initializeState()                                           │
│        │                                                                      │
│        ▼                                                                      │
│  currentView = window.initialView || 'chat'  ─────> 'welcome'                │
│        │                                                                      │
│        ▼                                                                      │
│  AppShellComponent @switch(currentView())                                    │
│        │                                                                      │
│        ▼                                                                      │
│  @case('welcome') ─────> WelcomeComponent                                    │
│        │                                                                      │
│        ▼                                                                      │
│  WelcomeComponent.ngOnInit()                                                 │
│        │                                                                      │
│        ▼                                                                      │
│  ClaudeRpcService.call('license:getStatus')                                  │
│        │                                                                      │
│        ▼                                                                      │
│  LicenseGetStatusResponse { reason: 'no_license' }                           │
│        │                                                                      │
│        ▼                                                                      │
│  Context-aware headline: "Welcome to Ptah"                                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Navigation System Foundation (30 min)

**Objective**: Enable 'welcome' as a valid view type

**Tasks**:

1. Add 'welcome' to ViewType union in `app-state.service.ts`
2. Add 'welcome' to VALID_VIEWS array in `webview-html-generator.ts`
3. Verify TypeScript compilation passes

**Files**:

- `libs/frontend/core/src/lib/services/app-state.service.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` (MODIFY)

**Verification**:

- TypeScript compiles without errors
- Unit tests pass (if any for ViewType)

---

### Phase 2: WelcomeComponent Creation (1.5 hours)

**Objective**: Create the welcome page UI component

**Tasks**:

1. Create `welcome.component.ts` with signal-based state
2. Create `welcome.component.html` with DaisyUI hero layout
3. Implement RPC call for license status (context-aware messaging)
4. Implement command execution for license key entry
5. Implement external URL opening for pricing/trial
6. Add component to chat library exports

**Files**:

- `libs/frontend/chat/src/lib/components/templates/welcome.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/templates/welcome.component.html` (CREATE)
- `libs/frontend/chat/src/index.ts` (MODIFY - add export)

**Verification**:

- Component builds without errors
- DaisyUI classes render correctly
- Icons render via lucide-angular

---

### Phase 3: App Shell Integration (30 min)

**Objective**: Render WelcomeComponent in standalone mode

**Tasks**:

1. Import WelcomeComponent in app-shell.component.ts
2. Add `@case ('welcome')` block in app-shell.component.html
3. Verify standalone layout (no sidebar, no tabs)

**Files**:

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` (MODIFY)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` (MODIFY)

**Verification**:

- Manual test: Set window.initialView = 'welcome' in DevTools
- Verify full-width layout
- Verify no sidebar/tabs visible

---

### Phase 4: Backend License Flow (1 hour)

**Objective**: Replace modal with webview for unlicensed users

**Tasks**:

1. Modify `handleLicenseBlocking()` in main.ts
2. Create minimal webview provider inline
3. Set `initialView: 'welcome'` in HTML generation
4. Remove/bypass `showLicenseRequiredUI()` call
5. Ensure license commands are still registered

**Files**:

- `apps/ptah-extension-vscode/src/main.ts` (MODIFY)

**Verification**:

- Start extension with no license key
- Verify webview appears (not modal)
- Verify welcome page renders
- Verify "Enter License Key" opens VS Code input
- Verify "View Pricing" opens browser

---

### Phase 5: RPC Enhancement & Polish (30 min)

**Objective**: Add license reason field and polish

**Tasks**:

1. Add `reason` field to LicenseGetStatusResponse (optional)
2. Update license-rpc.handlers.ts to map reason field
3. Test context-aware messaging (expired, trial_ended, no_license)
4. Verify accessibility (ARIA labels, focus management)
5. Test all themes (dark, light, high-contrast)

**Files**:

- `libs/shared/src/lib/types/rpc.types.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts` (MODIFY)

**Verification**:

- Expired license shows "Your subscription has expired"
- Trial ended shows "Your trial has ended"
- No license shows "Welcome to Ptah"
- All buttons have ARIA labels
- All themes render correctly

---

## Quality Requirements

### Functional Requirements

| Requirement                               | Verification Method                                              |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Welcome view renders for unlicensed users | Manual test: Remove license key, restart extension               |
| Enter License Key triggers VS Code input  | Manual test: Click button, verify password input appears         |
| View Pricing opens external browser       | Manual test: Click button, verify browser opens ptah.dev/pricing |
| Start Trial opens pricing page            | Manual test: Click button, verify browser opens                  |
| Context-aware messaging                   | Manual test: Set different license reasons, verify headlines     |
| No navigation escape                      | Manual test: Try keyboard shortcuts, verify blocked              |

### Non-Functional Requirements

| Requirement            | Target   | Verification                    |
| ---------------------- | -------- | ------------------------------- |
| Component load time    | < 100ms  | Chrome DevTools performance tab |
| Bundle size increase   | < 15KB   | `nx build chat --stats-json`    |
| WCAG 2.1 AA compliance | Pass     | aXe DevTools extension          |
| Theme support          | 3 themes | Manual visual inspection        |

### Pattern Compliance

| Pattern                | Evidence                                                   |
| ---------------------- | ---------------------------------------------------------- |
| Standalone view layout | Matches setup-wizard, settings in app-shell.component.html |
| Signal-based state     | Uses `signal()`, `computed()`, no BehaviorSubject          |
| DaisyUI styling        | Uses hero, btn, card, alert classes                        |
| RPC call pattern       | Matches settings.component.ts:140-161                      |
| Command execution      | Uses postMessage with command type                         |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both (frontend-developer + backend-developer)

**Rationale**:

1. **Frontend Work** (Phases 2, 3): Angular component creation, DaisyUI styling, signal-based state
2. **Backend Work** (Phases 1, 4, 5): main.ts modification, RPC type updates, webview provider

**Alternative**: Single full-stack developer can handle all phases

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 4-5 hours total

**Breakdown**:

- Phase 1: 30 min (Low complexity - type changes only)
- Phase 2: 1.5 hours (Medium complexity - new component)
- Phase 3: 30 min (Low complexity - template changes)
- Phase 4: 1 hour (High complexity - core activation flow)
- Phase 5: 30 min (Low complexity - polish)

### Files Affected Summary

**CREATE**:

- `libs/frontend/chat/src/lib/components/templates/welcome.component.ts`
- `libs/frontend/chat/src/lib/components/templates/welcome.component.html`

**MODIFY**:

- `libs/frontend/core/src/lib/services/app-state.service.ts` (add ViewType)
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` (add VALID_VIEWS)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` (add case)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` (add import)
- `libs/frontend/chat/src/index.ts` (add export)
- `apps/ptah-extension-vscode/src/main.ts` (modify handleLicenseBlocking)
- `libs/shared/src/lib/types/rpc.types.ts` (add reason field)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts` (map reason)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `ClaudeRpcService` from `@ptah-extension/core` (verified: core/src/index.ts)
   - `VSCodeService` from `@ptah-extension/core` (verified: core/src/index.ts)
   - `LicenseGetStatusResponse` from `@ptah-extension/shared` (verified: rpc.types.ts:574)
   - `LucideAngularModule` from `lucide-angular` (verified: settings.component.ts:9)

2. **All patterns verified from examples**:

   - Standalone view layout: `app-shell.component.html:11-24`
   - RPC call pattern: `settings.component.ts:140-161`
   - Signal-based state: `wizard-view.component.ts:141-146`

3. **Library documentation consulted**:

   - `libs/frontend/chat/CLAUDE.md`
   - `libs/frontend/core/CLAUDE.md`
   - `libs/shared/CLAUDE.md`

4. **No hallucinated APIs**:
   - All RPC methods verified: `license:getStatus` exists
   - All commands verified: `ptah.enterLicenseKey`, `ptah.openPricing`
   - All decorators verified from Angular core

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Sequence diagrams provided
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Implementation phases defined

---

## Risk Mitigation

| Risk                   | Probability | Impact | Mitigation                                             |
| ---------------------- | ----------- | ------ | ------------------------------------------------------ |
| Navigation bypass      | Low         | High   | Defense-in-depth: No UI escape + AppStateManager guard |
| Theme inconsistency    | Low         | Medium | Use only DaisyUI variables, test all themes            |
| RPC timeout            | Low         | Medium | Show error state with retry button                     |
| Command not registered | Low         | High   | Verify registerLicenseOnlyCommands runs before webview |

---

## Document History

| Version | Date       | Author             | Changes                     |
| ------- | ---------- | ------------------ | --------------------------- |
| 1.0     | 2026-01-27 | Software Architect | Initial implementation plan |
