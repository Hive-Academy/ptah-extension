# Implementation Plan - TASK_FE_001

**Task ID**: TASK_FE_001  
**Task Name**: Angular Frontend Library Extraction & Modernization  
**Created**: October 11, 2025  
**Architect**: software-architect  
**Timeline**: 15 working days (3 weeks)

---

## 📊 Codebase Investigation Summary

### Investigation Scope

- **Components Analyzed**: 41 component files discovered via file search
- **Services Analyzed**: 17 unique service files examined
- **Libraries Checked**: 7 frontend libraries verified (all exist as empty placeholders)
- **Angular Version Verified**: 20.1.0 (package.json:42-48)
- **Documentation Read**: MONSTER_EXTENSION_REFACTOR_PLAN.md, MODERN_ANGULAR_GUIDE.md

### Evidence Sources

1. **Monolithic Application** - `apps/ptah-extension-webview/src/app/`

   - Verified location: File search returned 82 component files
   - Pattern: All using `@Input()`, `@Output()` decorators
   - Structure: features/, shared/, core/ organization

2. **Empty Frontend Libraries** - `libs/frontend/`

   - Verified libraries exist: chat, session, analytics, dashboard, providers, shared-ui, core
   - Current state: Only placeholder files (e.g., `libs/frontend/chat/src/lib/chat/chat.ts`)
   - Ready for population: Proper nx.json configuration confirmed

3. **Shared Types Library** - `libs/shared/src/`
   - Verified exports: ai-provider.types, branded.types, claude-domain.types, common.types, message.types, webview-ui.types
   - Location: libs/shared/src/index.ts
   - Usage: Already imported by existing services

---

## Architecture Overview

### Design Decisions

**Pattern**: **Domain-Driven Design with Feature-Based Libraries**

- **Rationale**: User requested "extractions of our old angular application into dedicated components" - DDD aligns with feature-based extraction
- **SOLID Compliance**:

  - **S**ingle Responsibility: Each library owns one feature domain (chat, session, analytics, etc.)
  - **O**pen/Closed: Libraries expose public APIs via index.ts, implementation details hidden
  - **L**iskov Substitution: All components implement consistent signal-based APIs
  - **I**nterface Segregation: Libraries only depend on shared types they actually use
  - **D**ependency Inversion: Components depend on @ptah-extension/shared types, not concrete implementations**Architecture Style**: **Incremental Migration with Feature Flags**

- **Phase-based approach**: Extract one feature library at a time (chat → session → analytics → dashboard → providers → shared-ui)
- **Backward compatibility**: Main app routing shell remains functional during migration
- **Rollback capability**: Git branch per library extraction enables selective rollback

### Component Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│  apps/ptah-extension-webview (Main App - Routing Shell Only)   │
│  - app.component.ts (router-outlet)                           │
│  - app.config.ts (route configuration)                        │
└──────────────────┬──────────────────────────────────────────────┘
                   │ imports
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│              libs/frontend/* (Feature Libraries)               │
├─────────────────┬───────────────┬───────────────┬───────────────┤
│ chat/           │ session/      │ analytics/    │ dashboard/    │
│ - 13 components │ - 3 components│ - 3 components│ - 5 components│
│ - 5 services    │               │               │               │
├─────────────────┼───────────────┴───────────────┴───────────────┤
│ providers/      │ shared-ui/    │ core/                         │
│ - 3 components  │ - 13 components│ - 11 services                 │
└─────────────────┴───────────────┴───────────────────────────────┘
                   │ depends on
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│         libs/shared (Shared Types & Interfaces)                │
│  - ai-provider.types.ts                                        │
│  - message.types.ts                                            │
│  - common.types.ts                                             │
│  - webview-ui.types.ts                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Dependency Rules**:

1. Main app → Feature libraries (lazy loaded routes)
2. Feature libraries → shared library (types only)
3. Feature libraries → shared-ui library (reusable components)
4. shared-ui → shared library (types only)
5. ❌ NO feature library → feature library dependencies (prevents circular deps)

---

## Type/Schema Strategy

### Existing Types to Reuse

**Search completed**: Read `libs/shared/src/index.ts` and verified exports

#### From @ptah-extension/shared

1. **`ai-provider.types.ts`** - Provider configuration and status

   - Evidence: libs/shared/src/index.ts:1
   - Usage: Provider selector components, provider service
   - Types: `AIProvider`, `ProviderConfig`, `ProviderStatus`

2. **`message.types.ts`** - Chat message structures

   - Evidence: libs/shared/src/index.ts:6
   - Usage: Chat components, message rendering
   - Types: `ChatMessage`, `MessageRole`, `MessageContent`

3. **`common.types.ts`** - Shared domain types

   - Evidence: libs/shared/src/index.ts:5
   - Usage: Across all features
   - Types: `WorkspaceInfo`, `FileInfo`, `SessionInfo`

4. **`webview-ui.types.ts`** - UI component contracts
   - Evidence: libs/shared/src/index.ts:7
   - Usage: Shared UI components, form controls
   - Types: `DropdownOption`, `ValidationState`, `ButtonVariant`

#### Component-Level Interfaces (Currently in Components)

**Pattern found**: Components define local interfaces like `ProviderStatus` (chat-header.component.ts:4-6)

**Strategy**: Extract to appropriate library's `/models` folder

- Example: `ProviderStatus` → `libs/frontend/providers/src/lib/models/provider.models.ts`
- Rationale: Keep component-specific types close to usage, export via library index.ts

### New Types Required

#### 1. **Signal-based Component APIs** (libs/frontend/_/src/lib/models/_.models.ts)

**Purpose**: Type-safe signal inputs/outputs for migrated components

**Example Structure**:

```typescript
// libs/frontend/chat/src/lib/models/chat-header.models.ts
export interface ChatHeaderInputs {
  providerStatus: ProviderStatus;
}

export interface ChatHeaderOutputs {
  newSession: void;
  analytics: void;
  providerSettings: void;
}
```

**Estimated Files**: 6 (one per feature library)

#### 2. **Service State Interfaces** (libs/frontend/core/src/lib/models/\*.models.ts)

**Purpose**: Signal-based state management contracts

**Example Structure**:

```typescript
// libs/frontend/core/src/lib/models/app-state.models.ts
export interface AppStateSignals {
  currentView: Signal<ViewType>;
  isLoading: Signal<boolean>;
  statusMessage: Signal<string>;
  workspaceInfo: Signal<WorkspaceInfo | null>;
  isConnected: Signal<boolean>;
}
```

**Estimated Files**: 3 (app-state, chat-state, provider-state)

#### 3. **Performance Monitoring Types** (libs/frontend/core/src/lib/models/performance.models.ts)

**Purpose**: Performance metrics and monitoring interfaces

**New Types**:

```typescript
export interface PerformanceMetrics {
  changeDetectionCycles: number;
  renderTime: number;
  bundleSize: number;
  lastUpdated: Date;
}

export interface PerformanceBenchmark {
  baseline: PerformanceMetrics;
  current: PerformanceMetrics;
  improvement: Record<keyof PerformanceMetrics, number>;
}
```

**Estimated LOC**: 50 lines

### No Duplication Evidence

**Search Process**:

1. ✅ Examined `libs/shared/src/index.ts` - 7 type files already exported
2. ✅ Searched components for inline interfaces - Found local types like `ProviderStatus`
3. ✅ Checked service files - Services use existing shared types (e.g., `WorkspaceInfo` from @ptah-extension/shared)

**Decision**: Reuse all shared types, extract component-local interfaces to library `/models` folders, create minimal new types for signal APIs

---

## Component-to-Library Mapping

### Chat Library (`libs/frontend/chat/`)

**Evidence**: File search found 14 chat components in `apps/ptah-extension-webview/src/app/features/chat/`

#### Container Component (1)

1. **`VSCodeChatComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/chat/containers/chat.component.ts:213
   - New: libs/frontend/chat/src/lib/containers/chat.container.ts
   - LOC: ~200 (container orchestration)

#### Presentational Components (13)

1. **`VSCodeChatHeaderComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-header.component.ts:121
   - New: libs/frontend/chat/src/lib/components/chat-header/chat-header.component.ts
   - LOC: ~80
   - Already has OnPush: ✅ (line 16)
   - Needs signal migration: `@Input()` providerStatus (line 121), `@Output()` events (lines 123-125)

2. **`VSCodeChatMessagesListComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-messages-list.component.ts:456
   - New: libs/frontend/chat/src/lib/components/messages-list/messages-list.component.ts
   - LOC: ~400

3. **`VSCodeChatInputAreaComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-input-area.component.ts:317
   - New: libs/frontend/chat/src/lib/components/input-area/input-area.component.ts
   - LOC: ~270

4. **`EnhancedChatMessagesListComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/enhanced-chat-messages-list.component.ts:168
   - New: libs/frontend/chat/src/lib/components/enhanced-messages-list/enhanced-messages-list.component.ts
   - LOC: ~150

5. **`ClaudeMessageContentComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/claude-message-content.component.ts:197
   - New: libs/frontend/chat/src/lib/components/message-content/message-content.component.ts
   - LOC: ~180

6. **`VSCodeChatMessagesContainerComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-messages-container.component.ts:89
   - New: libs/frontend/chat/src/lib/components/messages-container/messages-container.component.ts
   - LOC: ~70

7. **`VSCodeChatStatusBarComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-status-bar.component.ts:117
   - New: libs/frontend/chat/src/lib/components/status-bar/status-bar.component.ts
   - LOC: ~100

8. **`VSCodeChatTokenUsageComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-token-usage.component.ts:126
   - New: libs/frontend/chat/src/lib/components/token-usage/token-usage.component.ts
   - LOC: ~110

9. **`VSCodeChatStreamingStatusComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-streaming-status.component.ts:119
   - New: libs/frontend/chat/src/lib/components/streaming-status/streaming-status.component.ts
   - LOC: ~100

10. **`VSCodeChatEmptyStateComponent`**

    - Current: apps/ptah-extension-webview/src/app/features/chat/components/chat-empty-state.component.ts:271
    - New: libs/frontend/chat/src/lib/components/empty-state/empty-state.component.ts
    - LOC: ~250

11. **`VSCodeFileTagComponent`**

    - Current: apps/ptah-extension-webview/src/app/features/chat/components/file-tag.component.ts:304
    - New: libs/frontend/chat/src/lib/components/file-tag/file-tag.component.ts
    - LOC: ~280

12. **`VSCodeFileSuggestionsDropdownComponent`**
    - Current: apps/ptah-extension-webview/src/app/features/chat/components/file-suggestions-dropdown.component.ts:264
    - New: libs/frontend/chat/src/lib/components/file-suggestions/file-suggestions.component.ts
    - LOC: ~240

**Total Chat Components**: 13 components, ~2,430 LOC

#### Services (5)

1. **`EnhancedChatService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/enhanced-chat.service.ts
   - New: libs/frontend/chat/src/lib/services/enhanced-chat.service.ts
   - Already uses signals: Unknown (needs investigation)

2. **`ChatStateManagerService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/chat-state-manager.service.ts
   - New: libs/frontend/chat/src/lib/services/chat-state.service.ts

3. **`MessageProcessingService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/chat/message-processing.service.ts
   - New: libs/frontend/chat/src/lib/services/message-processing.service.ts

4. **`StateService` (Chat)**

   - Current: apps/ptah-extension-webview/src/app/core/services/chat/state.service.ts
   - New: libs/frontend/chat/src/lib/services/state.service.ts

5. **`StreamHandlingService`**
   - Current: apps/ptah-extension-webview/src/app/core/services/chat/stream-handling.service.ts
   - New: libs/frontend/chat/src/lib/services/stream-handling.service.ts

**Total Chat Services**: 5 services

---

### Session Library (`libs/frontend/session/`)

**Evidence**: File search found 3 session components

#### Container Component (1)

1. **`SessionManagerComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/session/containers/session-manager.component.ts:496
   - New: libs/frontend/session/src/lib/containers/session-manager.container.ts
   - LOC: ~450

#### Presentational Components (2)

1. **`SessionSelectorComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/session/components/session-selector.component.ts:482
   - New: libs/frontend/session/src/lib/components/session-selector/session-selector.component.ts
   - LOC: ~450

2. **`SessionCardComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/session/components/session-card.component.ts:485
   - New: libs/frontend/session/src/lib/components/session-card/session-card.component.ts
   - LOC: ~450

**Total Session Components**: 3 components, ~1,350 LOC

---

### Analytics Library (`libs/frontend/analytics/`)

**Evidence**: File search found 4 analytics components (1 container + 3 presentational)

#### Container Component (1)

1. **`AnalyticsComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/analytics/containers/analytics.component.ts:108
   - New: libs/frontend/analytics/src/lib/containers/analytics.container.ts
   - LOC: ~100

#### Presentational Components (3)

1. **`VSCodeAnalyticsHeaderComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/analytics/components/analytics-header.component.ts:115
   - New: libs/frontend/analytics/src/lib/components/analytics-header/analytics-header.component.ts
   - LOC: ~100

2. **`VSCodeAnalyticsStatsGridComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/analytics/components/analytics-stats-grid.component.ts:292
   - New: libs/frontend/analytics/src/lib/components/stats-grid/stats-grid.component.ts
   - LOC: ~270

3. **`VSCodeAnalyticsComingSoonComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/analytics/components/analytics-coming-soon.component.ts:201
   - New: libs/frontend/analytics/src/lib/components/coming-soon/coming-soon.component.ts
   - LOC: ~180

**Total Analytics Components**: 4 components, ~650 LOC

---

### Dashboard Library (`libs/frontend/dashboard/`)

**Evidence**: File search found 5 dashboard components (1 container + 4 presentational)

#### Container Component (1)

1. **`DashboardComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/dashboard/containers/dashboard.component.ts:137
   - New: libs/frontend/dashboard/src/lib/containers/dashboard.container.ts
   - LOC: ~120

#### Presentational Components (4)

1. **`VSCodeDashboardHeaderComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/dashboard/components/dashboard-header.component.ts:272
   - New: libs/frontend/dashboard/src/lib/components/header/header.component.ts
   - LOC: ~250

2. **`VSCodeDashboardMetricsGridComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/dashboard/components/dashboard-metrics-grid.component.ts:322
   - New: libs/frontend/dashboard/src/lib/components/metrics-grid/metrics-grid.component.ts
   - LOC: ~300

3. **`VSCodeDashboardActivityFeedComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/dashboard/components/dashboard-activity-feed.component.ts:338
   - New: libs/frontend/dashboard/src/lib/components/activity-feed/activity-feed.component.ts
   - LOC: ~320

4. **`VSCodeDashboardPerformanceChartComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/dashboard/components/dashboard-performance-chart.component.ts:252
   - New: libs/frontend/dashboard/src/lib/components/performance-chart/performance-chart.component.ts
   - LOC: ~230

**Total Dashboard Components**: 5 components, ~1,220 LOC

---

### Providers Library (`libs/frontend/providers/`)

**Evidence**: File search found 3 provider components (1 container + 2 presentational)

#### Container Component (1)

1. **`ProviderManagerComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/providers/containers/provider-manager.component.ts:87
   - New: libs/frontend/providers/src/lib/containers/provider-manager.container.ts
   - LOC: ~70

#### Presentational Components (2)

1. **`ProviderSettingsComponent`**

   - Current: apps/ptah-extension-webview/src/app/features/providers/components/provider-settings.component.ts:653
   - New: libs/frontend/providers/src/lib/components/provider-settings/provider-settings.component.ts
   - LOC: ~630

2. **`ProviderSelectorDropdownComponent`**
   - Current: apps/ptah-extension-webview/src/app/features/providers/components/provider-selector-dropdown.component.ts:455
   - New: libs/frontend/providers/src/lib/components/provider-selector/provider-selector.component.ts
   - LOC: ~430

**Total Providers Components**: 3 components, ~1,130 LOC

---

### Shared UI Library (`libs/frontend/shared-ui/`)

**Evidence**: File search found 13 shared components

#### Form Components (8)

1. **`VSCodeInputComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/vscode-input.component.ts:238
   - New: libs/frontend/shared-ui/src/lib/forms/input/input.component.ts
   - LOC: ~220

2. **`VSCodeDropdownComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/vscode-dropdown.component.ts:145
   - New: libs/frontend/shared-ui/src/lib/forms/dropdown/dropdown.component.ts
   - LOC: ~130

3. **`VSCodeDropdownTriggerComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/dropdown-trigger.component.ts:151
   - New: libs/frontend/shared-ui/src/lib/forms/dropdown-trigger/dropdown-trigger.component.ts
   - LOC: ~140

4. **`VSCodeDropdownSearchComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/dropdown-search.component.ts:89
   - New: libs/frontend/shared-ui/src/lib/forms/dropdown-search/dropdown-search.component.ts
   - LOC: ~80

5. **`VSCodeDropdownOptionsListComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/dropdown-options-list.component.ts:208
   - New: libs/frontend/shared-ui/src/lib/forms/dropdown-options/dropdown-options.component.ts
   - LOC: ~190

6. **`VSCodeActionButtonComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/action-button.component.ts:188
   - New: libs/frontend/shared-ui/src/lib/forms/action-button/action-button.component.ts
   - LOC: ~170

7. **`VSCodeValidationMessageComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/validation-message.component.ts:45
   - New: libs/frontend/shared-ui/src/lib/forms/validation-message/validation-message.component.ts
   - LOC: ~40

8. **`VSCodeInputIconComponent`**
   - Current: apps/ptah-extension-webview/src/app/shared/components/forms/input-icon.component.ts:69
   - New: libs/frontend/shared-ui/src/lib/forms/input-icon/input-icon.component.ts
   - LOC: ~60

#### UI Components (2)

1. **`VSCodeLoadingSpinnerComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/ui/loading-spinner.component.ts:110
   - New: libs/frontend/shared-ui/src/lib/ui/loading-spinner/loading-spinner.component.ts
   - LOC: ~100

2. **`VSCodeStatusBarComponent`**
   - Current: apps/ptah-extension-webview/src/app/shared/components/ui/status-bar.component.ts:201
   - New: libs/frontend/shared-ui/src/lib/ui/status-bar/status-bar.component.ts
   - LOC: ~190

#### Layout Components (1)

1. **`VSCodeSimpleHeaderComponent`**
   - Current: apps/ptah-extension-webview/src/app/shared/components/layout/simple-header.component.ts:98
   - New: libs/frontend/shared-ui/src/lib/layout/simple-header/simple-header.component.ts
   - LOC: ~90

#### Overlay Components (2)

1. **`VSCodePermissionPopupComponent`**

   - Current: apps/ptah-extension-webview/src/app/shared/components/overlays/permission-popup.component.ts:534
   - New: libs/frontend/shared-ui/src/lib/overlays/permission-popup/permission-popup.component.ts
   - LOC: ~510

2. **`VSCodeCommandBottomSheetComponent`**
   - Current: apps/ptah-extension-webview/src/app/shared/components/overlays/command-bottom-sheet.component.ts:294
   - New: libs/frontend/shared-ui/src/lib/overlays/command-bottom-sheet/command-bottom-sheet.component.ts
   - LOC: ~280

**Total Shared UI Components**: 13 components, ~2,200 LOC

---

### Core Library (`libs/frontend/core/`)

**Evidence**: File search found 11+ core services

#### Services (11)

1. **`AppStateManager`** (Already uses signals ✅)

   - Current: apps/ptah-extension-webview/src/app/core/services/app-state.service.ts
   - Evidence: Line 21-32 shows signal() usage
   - New: libs/frontend/core/src/lib/services/app-state.service.ts
   - LOC: ~130
   - Migration: Already using signals, just move file

2. **`VSCodeService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/vscode.service.ts
   - New: libs/frontend/core/src/lib/services/vscode.service.ts

3. **`ViewManagerService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/view-manager.service.ts
   - New: libs/frontend/core/src/lib/services/view-manager.service.ts

4. **`WebviewNavigationService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/webview-navigation.service.ts
   - New: libs/frontend/core/src/lib/services/webview-navigation.service.ts

5. **`WebviewConfigService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/webview-config.service.ts
   - New: libs/frontend/core/src/lib/services/webview-config.service.ts

6. **`MessageHandlerService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/message-handler.service.ts
   - New: libs/frontend/core/src/lib/services/message-handler.service.ts

7. **`LoggingService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/logging.service.ts
   - New: libs/frontend/core/src/lib/services/logging.service.ts

8. **`ProviderService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/provider.service.ts
   - New: libs/frontend/core/src/lib/services/provider.service.ts

9. **`AnalyticsService`**

   - Current: apps/ptah-extension-webview/src/app/core/services/analytics.service.ts
   - New: libs/frontend/core/src/lib/services/analytics.service.ts

10. **`FilePickerService`**

    - Current: apps/ptah-extension-webview/src/app/core/services/file-picker.service.ts
    - New: libs/frontend/core/src/lib/services/file-picker.service.ts

11. **`ClaudeMessageTransformerService`**
    - Current: apps/ptah-extension-webview/src/app/core/services/claude-message-transformer.service.ts
    - New: libs/frontend/core/src/lib/services/claude-message-transformer.service.ts

**Total Core Services**: 11 services

---

## Summary Statistics

| Library   | Components | Services | Total LOC   | Priority |
| --------- | ---------- | -------- | ----------- | -------- |
| chat      | 13         | 5        | ~3,230      | P0       |
| session   | 3          | 0        | ~1,350      | P1       |
| analytics | 4          | 0        | ~650        | P2       |
| dashboard | 5          | 0        | ~1,220      | P1       |
| providers | 3          | 0        | ~1,130      | P1       |
| shared-ui | 13         | 0        | ~2,200      | P0       |
| core      | 0          | 11       | ~1,500      | P0       |
| **TOTAL** | **41**     | **16**   | **~11,280** |          |

---

## Integration Points

### Dependencies

#### Internal Dependencies

**Main App**:

- Depends on: All frontend libraries (lazy-loaded routes)
- Current routing: apps/ptah-extension-webview/src/app/app.config.ts
- Migration: Update imports from `./features/` → `@ptah-extension/*`

**Frontend Libraries**:

- **All libraries** → `@ptah-extension/shared` (types only)
- **Feature libraries** → `@ptah-extension/shared-ui` (reusable components)
- **Feature libraries** → `@ptah-extension/core` (core services via DI)
- ❌ **NO** feature library → feature library (prevents circular deps)

**Shared UI**:

- Depends on: `@ptah-extension/shared` (types for dropdown options, validation states)
- Standalone: No feature library dependencies

**Core**:

- Depends on: `@ptah-extension/shared` (types for workspace info, provider config)
- Standalone: No feature library dependencies

#### External Dependencies

**Angular Core** (already installed):

- @angular/core ~20.1.0
- @angular/common ~20.1.0
- @angular/forms ~20.1.0
- @angular/router ~20.1.0

**VS Code Webview API**:

- acquireVsCodeApi() - Already used in VSCodeService
- Window messaging - Extension ↔ Webview communication
- Location: Window global, injected by VS Code

**Third-party** (if any):

- Need to investigate: marked.js, highlight.js (for message rendering)

### Breaking Changes

- [x] **None - backwards compatible**

**Rationale**: Migration strategy maintains backward compatibility via:

1. **Incremental extraction**: Old components remain functional until library migration complete
2. **Routing updates**: Main app routes updated per library, not all at once
3. **Import path aliases**: nx.json tsconfig paths enable gradual import migration
4. **No API changes**: Component public APIs remain identical (inputs/outputs → signals is internal change)

**Evidence**: Apps will continue to build and run during migration because:

- Libraries expose components via index.ts barrel exports
- Main app routing can be updated incrementally (one route at a time)
- Tests remain in component folders until migration complete

---

## Implementation Steps

### Step 1: Foundation - Library Structure & Tooling Setup (Days 1-2)

**Objective**: Create proper folder structure in all frontend libraries and set up development tooling

#### Files to Create

**Per Library** (7 libraries × structure):

1. **`libs/frontend/{library}/src/lib/components/README.md`**

   - Purpose: Document component organization strategy
   - Content: Naming conventions, folder structure guidelines
   - LOC: 30

2. **`libs/frontend/{library}/src/lib/services/README.md`**

   - Purpose: Document service patterns
   - Content: Signal-based state management examples
   - LOC: 40

3. **`libs/frontend/{library}/src/lib/models/README.md`**

   - Purpose: Document type/interface organization
   - Content: When to create new types vs. reuse shared
   - LOC: 25

4. **`libs/frontend/{library}/src/index.ts`** (update)
   - Purpose: Barrel export file for public API
   - Content: Export all components, services, models
   - LOC: 10-50 (depends on library size)

**Cross-cutting**:

5. **`docs/guides/SIGNAL_MIGRATION_GUIDE.md`**

   - Purpose: Step-by-step guide for decorator → signal migration
   - Content: Before/after examples, common pitfalls, testing strategies
   - LOC: 200

6. **`docs/guides/LIBRARY_EXTRACTION_CHECKLIST.md`**

   - Purpose: Checklist for extracting each feature library
   - Content: File moves, import updates, test migration, validation steps
   - LOC: 150

7. **`.github/workflows/nx-affected.yml`** (update)
   - Purpose: CI/CD for affected libraries only
   - Content: Run build/lint/test only on changed libraries
   - LOC: 50

#### Tasks

1. Run `nx graph` to establish baseline dependency graph (save screenshot)
2. Create folder structure: `components/`, `services/`, `models/` in each library
3. Update nx.json with import path aliases (verify @ptah-extension/\* paths)
4. Create README files documenting patterns per library
5. Set up ESLint rules for circular dependency detection
6. Create performance monitoring baseline script

#### Validation

- [ ] `nx graph` shows all 7 frontend libraries with zero dependencies between features
- [ ] All README files created and reviewed
- [ ] Folder structure verified: Each library has components/, services/, models/
- [ ] Import path aliases working: Can import `@ptah-extension/shared-ui`
- [ ] ESLint circular dependency rule configured
- [ ] Baseline performance metrics captured (bundle size, render time)

**Estimated Time**: 2 days

---

### Step 2: Shared UI Library Migration (Days 3-5)

**Objective**: Extract and modernize all shared components first (used by other libraries)

**Priority Rationale**: Shared UI has NO feature dependencies, must be completed before feature libraries

#### Components to Migrate (13 total)

**Day 3**: Form Components (8 components)

1. VSCodeInputComponent → libs/frontend/shared-ui/src/lib/forms/input/
2. VSCodeDropdownComponent → libs/frontend/shared-ui/src/lib/forms/dropdown/
3. VSCodeDropdownTriggerComponent → libs/frontend/shared-ui/src/lib/forms/dropdown-trigger/
4. VSCodeDropdownSearchComponent → libs/frontend/shared-ui/src/lib/forms/dropdown-search/
5. VSCodeDropdownOptionsListComponent → libs/frontend/shared-ui/src/lib/forms/dropdown-options/
6. VSCodeActionButtonComponent → libs/frontend/shared-ui/src/lib/forms/action-button/
7. VSCodeValidationMessageComponent → libs/frontend/shared-ui/src/lib/forms/validation-message/
8. VSCodeInputIconComponent → libs/frontend/shared-ui/src/lib/forms/input-icon/

**Day 4**: UI & Layout Components (3 components)

1. VSCodeLoadingSpinnerComponent → libs/frontend/shared-ui/src/lib/ui/loading-spinner/
2. VSCodeStatusBarComponent → libs/frontend/shared-ui/src/lib/ui/status-bar/
3. VSCodeSimpleHeaderComponent → libs/frontend/shared-ui/src/lib/layout/simple-header/

**Day 5**: Overlay Components (2 components) + Testing

1. VSCodePermissionPopupComponent → libs/frontend/shared-ui/src/lib/overlays/permission-popup/
2. VSCodeCommandBottomSheetComponent → libs/frontend/shared-ui/src/lib/overlays/command-bottom-sheet/

#### Migration Process (Per Component)

1. **Copy component file** to new location
2. **Signal migration**:
   - Replace `@Input()` → `input<T>()`
   - Replace `@Output()` → `output<T>()`
   - Replace `@ViewChild()` → `viewChild<T>()`
3. **Control flow migration**:
   - Replace `*ngIf` → `@if`
   - Replace `*ngFor` → `@for`
   - Replace `*ngSwitch` → `@switch`
4. **Ensure OnPush**:
   - Add `changeDetection: ChangeDetectionStrategy.OnPush` if missing
5. **Update imports**: Add to `libs/frontend/shared-ui/src/index.ts`
6. **Migrate tests**: Move .spec.ts files, update imports
7. **Update consuming components**: Change imports in main app (if any)

#### Validation

- [ ] All 13 components extracted to shared-ui library
- [ ] Zero `@Input()`, `@Output()`, `@ViewChild()` decorators (grep verification)
- [ ] Zero `*ngIf`, `*ngFor`, `*ngSwitch` directives (grep verification)
- [ ] All components have OnPush change detection
- [ ] `nx build frontend-shared-ui` succeeds
- [ ] All component tests pass
- [ ] Test coverage ≥80%
- [ ] Main app still functional (consuming components updated)

**Estimated Time**: 3 days

---

### Step 3: Core Library Migration (Days 6-8)

**Objective**: Extract core services to enable feature library migrations

**Priority Rationale**: Feature libraries depend on core services via DI

#### Services to Migrate (11 total)

**Day 6**: State & Config Services (4 services)

1. **AppStateManager** → libs/frontend/core/src/lib/services/app-state.service.ts

   - Already uses signals ✅ (just move file)
   - Evidence: apps/ptah-extension-webview/src/app/core/services/app-state.service.ts:21-32

2. **WebviewConfigService** → libs/frontend/core/src/lib/services/webview-config.service.ts

   - Migrate to signals: Configuration state management

3. **ViewManagerService** → libs/frontend/core/src/lib/services/view-manager.service.ts

   - Migrate to signals: Current view state

4. **WebviewNavigationService** → libs/frontend/core/src/lib/services/webview-navigation.service.ts
   - Migrate to signals: Navigation state

**Day 7**: Communication Services (4 services)

5. **VSCodeService** → libs/frontend/core/src/lib/services/vscode.service.ts

   - Migrate to signals: Connection state, message handling

6. **MessageHandlerService** → libs/frontend/core/src/lib/services/message-handler.service.ts

   - Migrate to signals: Message queue state

7. **LoggingService** → libs/frontend/core/src/lib/services/logging.service.ts

   - Migrate to signals: Log level state

8. **FilePickerService** → libs/frontend/core/src/lib/services/file-picker.service.ts
   - Migrate to signals: Selected files state

**Day 8**: Domain Services (3 services) + Testing

9. **ProviderService** → libs/frontend/core/src/lib/services/provider.service.ts

   - Migrate to signals: Current provider state, available providers

10. **AnalyticsService** → libs/frontend/core/src/lib/services/analytics.service.ts

    - Migrate to signals: Analytics events queue

11. **ClaudeMessageTransformerService** → libs/frontend/core/src/lib/services/claude-message-transformer.service.ts
    - Migrate to signals: Transform options state

#### Migration Process (Per Service)

1. **Copy service file** to new location
2. **Signal migration**:
   - Replace `BehaviorSubject<T>` → `signal<T>()`
   - Replace `combineLatest(...)` → `computed(() => ...)`
   - Replace `.pipe(tap(...))` → `effect(() => ...)`
   - Replace `.subscribe()` with `effect()` where appropriate
3. **Update DI**: Ensure `@Injectable({ providedIn: 'root' })` or register in library providers
4. **Export**: Add to `libs/frontend/core/src/index.ts`
5. **Migrate tests**: Move .spec.ts files, update imports, update test signals
6. **Update consuming code**: Dependency injection imports remain same (Angular DI resolves)

#### Validation

- [ ] All 11 services extracted to core library
- [ ] Zero BehaviorSubject instances (grep verification)
- [ ] All services use `signal()`, `computed()`, `effect()`
- [ ] `nx build frontend-core` succeeds
- [ ] All service tests pass
- [ ] Test coverage ≥80%
- [ ] Feature components can still inject services (verify DI working)

**Estimated Time**: 3 days

---

### Step 4: Feature Libraries Migration - Phase 1 (Days 9-11)

**Objective**: Extract chat and providers libraries (highest complexity)

#### Day 9-10: Chat Library (13 components + 5 services)

**Priority**: P0 - Largest library, most complex

**Components** (in extraction order):

1. Container: VSCodeChatComponent
2. Messages: VSCodeChatMessagesContainerComponent
3. Messages: VSCodeChatMessagesListComponent
4. Messages: EnhancedChatMessagesListComponent
5. Messages: ClaudeMessageContentComponent
6. Input: VSCodeChatInputAreaComponent
7. Input: VSCodeFileTagComponent
8. Input: VSCodeFileSuggestionsDropdownComponent
9. Status: VSCodeChatHeaderComponent
10. Status: VSCodeChatStatusBarComponent
11. Status: VSCodeChatTokenUsageComponent
12. Status: VSCodeChatStreamingStatusComponent
13. Empty: VSCodeChatEmptyStateComponent

**Services**:

1. EnhancedChatService
2. ChatStateManagerService
3. MessageProcessingService
4. StateService
5. StreamHandlingService

**Migration Process**: Same as Step 2 (copy, signal migration, control flow migration, OnPush, tests)

#### Day 11: Providers Library (3 components)

**Priority**: P1 - Medium complexity

**Components**:

1. Container: ProviderManagerComponent
2. Settings: ProviderSettingsComponent
3. Selector: ProviderSelectorDropdownComponent

#### Validation

- [ ] Chat library: 13 components + 5 services extracted and modernized
- [ ] Providers library: 3 components extracted and modernized
- [ ] Zero decorators, zero structural directives (grep verification)
- [ ] All components OnPush, all services signal-based
- [ ] `nx build frontend-chat frontend-providers` succeeds
- [ ] All tests pass, coverage ≥80%
- [ ] Main app chat/provider routes updated and functional

**Estimated Time**: 3 days

---

### Step 5: Feature Libraries Migration - Phase 2 (Days 12-13)

**Objective**: Extract session, dashboard, and analytics libraries

#### Day 12: Session & Analytics Libraries

**Session Library** (3 components):

1. Container: SessionManagerComponent
2. SessionSelectorComponent
3. SessionCardComponent

**Analytics Library** (4 components):

1. Container: AnalyticsComponent
2. VSCodeAnalyticsHeaderComponent
3. VSCodeAnalyticsStatsGridComponent
4. VSCodeAnalyticsComingSoonComponent

#### Day 13: Dashboard Library + Integration Testing

**Dashboard Library** (5 components):

1. Container: DashboardComponent
2. VSCodeDashboardHeaderComponent
3. VSCodeDashboardMetricsGridComponent
4. VSCodeDashboardActivityFeedComponent
5. VSCodeDashboardPerformanceChartComponent

**Integration Testing**:

- Verify all routes work
- Test navigation between features
- Validate lazy loading working
- Check bundle sizes per library

#### Validation

- [ ] Session: 3 components extracted
- [ ] Analytics: 4 components extracted
- [ ] Dashboard: 5 components extracted
- [ ] All modernization complete (signals, control flow, OnPush)
- [ ] All feature libraries build successfully
- [ ] Integration tests pass
- [ ] Bundle size per library measured and documented
- [ ] Main app routes fully migrated

**Estimated Time**: 2 days

---

### Step 6: Performance Monitoring & Theme Integration (Days 14-15)

**Objective**: Implement performance monitoring system and VS Code theme integration

#### Day 14: Performance Monitoring

**Files to Create**:

1. **`libs/frontend/core/src/lib/services/performance-monitoring.service.ts`**

   - Purpose: Track change detection cycles, render times, bundle sizes
   - Implementation: Use Performance API, Angular profiler integration
   - LOC: 200

2. **`libs/frontend/core/src/lib/models/performance.models.ts`**

   - Purpose: Performance metrics interfaces
   - Content: PerformanceMetrics, PerformanceBenchmark types
   - LOC: 50

3. **`libs/frontend/dashboard/src/lib/components/performance-dashboard/performance-dashboard.component.ts`**
   - Purpose: Display real-time performance metrics
   - Implementation: Chart.js or native Angular charting
   - LOC: 300

**Tasks**:

1. Implement performance monitoring service
2. Integrate with Angular DevTools profiler
3. Create performance dashboard component
4. Measure baseline vs. current metrics
5. Document 30%/40%/50% improvement achievements

#### Day 15: VS Code Theme Integration

**Files to Create**:

1. **`libs/frontend/core/src/lib/services/theme.service.ts`**

   - Purpose: Extract theme tokens from VS Code API
   - Implementation: `vscode.window.activeColorTheme` wrapper
   - LOC: 150

2. **`libs/frontend/core/src/lib/models/theme.models.ts`**

   - Purpose: Theme token interfaces
   - Content: ThemeColors, ThemeTokens types
   - LOC: 40

3. **Update all component styles** (41 components):
   - Replace hardcoded colors with CSS custom properties
   - Example: `color: #ffffff` → `color: var(--vscode-foreground)`
   - Per component: ~10 lines changed

**Tasks**:

1. Create theme service
2. Extract VS Code theme tokens
3. Generate CSS custom properties
4. Update all component styles to use tokens
5. Test theme switching (light ↔ dark)
6. Verify theme changes apply without reload

#### Validation

- [ ] Performance monitoring service implemented
- [ ] Performance dashboard displays metrics
- [ ] 30%+ change detection improvement measured
- [ ] 40%+ rendering improvement measured
- [ ] 50%+ bundle size reduction measured (per library)
- [ ] Theme service implemented
- [ ] All components use CSS custom properties
- [ ] Theme switching works dynamically
- [ ] No hardcoded colors remain (grep verification)
- [ ] Documentation updated

**Estimated Time**: 2 days

---

## Timeline & Scope

### Current Scope (This Task - 15 Days)

**Estimated Time**: 15 working days (3 weeks)

**Core Deliverable**: Fully modernized Angular frontend with:

- 41 components extracted to 6 feature libraries
- 16 services extracted to core library
- 100% signal-based APIs (zero decorators)
- 100% modern control flow (zero structural directives)
- 100% OnPush change detection
- Performance monitoring system
- VS Code theme integration
- ≥80% test coverage maintained

**Quality Threshold**: Production-ready modular frontend

- All `nx build` commands succeed
- All `nx test` commands pass with ≥80% coverage
- All `nx lint` commands pass with zero warnings
- Extension loads in VS Code Development Host
- All webview features functional

### Week-by-Week Breakdown

**Week 1 (Days 1-5)**: Foundation + Shared UI + Core (start)

- Day 1-2: Library structure, tooling, documentation
- Day 3-5: Shared UI library (13 components)

**Week 2 (Days 6-10)**: Core (complete) + Feature Libraries (start)

- Day 6-8: Core library (11 services)
- Day 9-10: Chat library (13 components + 5 services)

**Week 3 (Days 11-15)**: Feature Libraries (complete) + Performance + Theme

- Day 11: Providers library (3 components)
- Day 12: Session (3) + Analytics (4) libraries
- Day 13: Dashboard library (5 components)
- Day 14: Performance monitoring
- Day 15: Theme integration + final validation

### Future Work (Registry Tasks)

**NO FUTURE WORK REQUIRED** - This task IS the MONSTER plan Weeks 7-9 deliverable

All work fits within 15-day timeline because:

1. No new features - only refactoring/modernization
2. Incremental approach enables parallel work streams
3. Well-understood patterns (Angular 20+ documented)
4. Tooling support (Angular CLI schematics)

**Next Task**: TASK_INT_001 (Week 10 - Final Library Integration) - already in registry

---

## Risk Mitigation

### Technical Risks

#### Risk 1: Breaking Changes During Signal Migration

**Risk**: Converting decorators to signals may introduce subtle behavioral differences

**Probability**: Medium  
**Impact**: High

**Mitigation Strategy**:

1. **Incremental rollout**: Migrate one library at a time (shared-ui → core → features)
2. **Comprehensive testing**: Run full test suite after each library migration
3. **Manual testing**: Test in Extension Development Host after each library
4. **Rollback capability**: Each library on separate git branch for selective rollback

**Contingency Plan**:

- If critical issues found in library X, rollback library X only
- Keep other libraries migrated
- Debug issues in isolation before re-attempting library X migration

#### Risk 2: OnPush Change Detection Breaking UI Updates

**Risk**: OnPush requires immutable inputs; existing code may mutate objects

**Probability**: High  
**Impact**: Medium

**Mitigation Strategy**:

1. **Pre-migration audit**: Grep for object mutations before OnPush implementation
2. **Angular DevTools**: Use profiler to verify change detection triggers
3. **Immutability helpers**: Create utility functions for immutable updates
4. **Gradual OnPush**: Add OnPush library-by-library, not all at once

**Contingency Plan**:

- Use `ChangeDetectorRef.markForCheck()` where absolutely necessary
- Document locations as technical debt
- Create follow-up task to refactor for true immutability

#### Risk 3: Circular Dependencies After Library Extraction

**Risk**: Extracting components may expose hidden circular dependencies

**Probability**: Medium  
**Impact**: High

**Mitigation Strategy**:

1. **Pre-extraction analysis**: Run `nx graph` before starting to identify potential cycles
2. **Domain-driven boundaries**: Design libraries following feature domains (chat, session, etc.)
3. **Shared-ui library**: Put truly shared components here to prevent cross-feature dependencies
4. **ESLint enforcement**: Configure `@nx/enforce-module-boundaries` rule

**Contingency Plan**:

- If cycle detected: Refactor component composition
- Create adapter component in higher-level library
- Move shared logic to core library
- In worst case: Keep component in main app temporarily, defer to future task

#### Risk 4: Performance Regression Despite Optimizations

**Risk**: Refactoring may introduce performance issues (over-use of effects, etc.)

**Probability**: Low  
**Impact**: High

**Mitigation Strategy**:

1. **Baseline metrics**: Capture performance baseline before starting (Day 1)
2. **Continuous monitoring**: Run performance profiler after each library migration
3. **Chrome DevTools**: Profile render times and change detection cycles
4. **Angular DevTools**: Use profiler to catch change detection issues

**Contingency Plan**:

- Profile to identify bottleneck (effect over-use, unnecessary computed())
- Optimize hot paths (batch updates, debounce effects)
- Consider lazy loading for heavy components
- Defer non-critical optimizations to future task if timeline at risk

### Performance Considerations

#### Concern 1: Bundle Size Increase from Library Overhead

**Concern**: Each library adds build overhead, may increase total bundle size

**Strategy**:

- Use lazy loading for all feature libraries
- Implement tree-shaking via proper index.ts exports
- Webpack bundle analyzer to measure size per library
- Target: 50% reduction per feature (more focused bundles)

**Measurement**:

- Baseline: Run `webpack-bundle-analyzer` on current build
- Per library: Measure after each library migration
- Document in test-report.md

#### Concern 2: Change Detection Performance with Signals

**Concern**: Incorrect signal usage may cause more change detection than before

**Strategy**:

- Use `computed()` for derived state (not effects)
- Avoid creating signals in templates
- Use `effect()` sparingly, only for side effects
- Angular DevTools profiler to validate

**Measurement**:

- Baseline: Count change detection cycles in Angular DevTools
- Target: 30% reduction
- Verify no regressions per library

#### Concern 3: Initial Load Time with Library Extraction

**Concern**: Modular architecture may increase initial load time

**Strategy**:

- Lazy load all feature libraries (only load when route accessed)
- Preload strategy for likely-to-be-used libraries
- Service worker caching for repeat visits
- Measure Time to Interactive (TTI)

**Measurement**:

- Lighthouse performance audit before/after
- Target: No regression in TTI, ideally 10-20% improvement

---

## Testing Strategy

### Unit Tests Required

**Per Component** (41 components):

1. **Signal input tests**:

   - Verify input changes trigger component updates
   - Test computed values update correctly
   - Validate immutability (no input mutations)

2. **Signal output tests**:

   - Verify output emissions work
   - Test event payloads correct
   - Validate timing (synchronous vs async)

3. **Control flow tests**:

   - `@if` conditions work correctly
   - `@for` loops render correct items
   - `@switch` cases match correctly

4. **OnPush detection tests**:
   - Verify change detection only on input changes
   - Test manual markForCheck scenarios
   - Validate no unnecessary re-renders

**Per Service** (16 services):

1. **Signal state tests**:

   - Verify signal updates work
   - Test computed values derive correctly
   - Validate effect side effects execute

2. **Effect tests**:
   - Test cleanup on destroy
   - Verify effect dependencies tracked correctly
   - Validate no memory leaks

**Coverage Target**: ≥80% for lines, branches, functions

**Test File Locations**:

- Move .spec.ts files with components to library
- Example: `VSCodeChatHeaderComponent.spec.ts` → `libs/frontend/chat/src/lib/components/chat-header/chat-header.component.spec.ts`

### Integration Tests Required

**Library Build Integration**:

1. **`libs/frontend/*/integration/build.integration.spec.ts`**
   - Test: Library builds successfully
   - Test: All exports accessible
   - Test: No circular dependencies detected

**Library Interaction Integration**:

2. **`libs/frontend/*/integration/component-interaction.integration.spec.ts`**
   - Test: Components from different libraries work together
   - Test: Services inject correctly across libraries
   - Test: Shared UI components work in feature components

**Main App Integration**:

3. **`apps/ptah-extension-webview/src/app/integration/routing.integration.spec.ts`**
   - Test: All routes load correctly
   - Test: Lazy loading works
   - Test: Navigation between features functional

**VS Code Integration**:

4. **`apps/ptah-extension-webview/src/app/integration/vscode.integration.spec.ts`**
   - Test: Extension ↔ Webview communication works
   - Test: Theme integration functional
   - Test: VS Code APIs accessible

### Manual Testing

**After Each Library Migration**:

- [ ] Load extension in Extension Development Host
- [ ] Navigate to feature (chat, session, analytics, dashboard, providers)
- [ ] Test all user interactions (buttons, forms, navigation)
- [ ] Verify no console errors
- [ ] Check performance (no visual lag)
- [ ] Test theme switching (light ↔ dark)

**Final Validation (Day 15)**:

- [ ] Full user journey: Open extension → Chat → Send message → View analytics → Check session → Change provider → Switch theme
- [ ] Performance benchmark: Measure change detection, render time, bundle size
- [ ] Cross-browser test: Verify webview works in different VS Code versions
- [ ] Accessibility test: Keyboard navigation, screen reader support
- [ ] Error scenarios: Network errors, invalid inputs, edge cases

**Acceptance Criteria Validation**:

- [ ] Run all BDD scenarios from task-description.md
- [ ] Verify all "Then" conditions met
- [ ] Document results in test-report.md

---

## PHASE 3 COMPLETE ✅

**Deliverable**: task-tracking/TASK_FE_001/implementation-plan.md created

**Scope Summary**:

- **Current Task**: 15 days estimated (within 3-week requirement)
- **Future Tasks Added to Registry**: 0 (all work fits in current scope)

**Architecture Highlights**:

- 41 components mapped to 6 feature libraries with file paths
- 16 services mapped to core library
- Domain-driven design with strict dependency rules
- Incremental migration strategy (library-by-library)
- Evidence-based planning with 50+ codebase citations

**Next Phase**: frontend-developer (Phase 4)

---

## 📋 NEXT STEP - Validation Gate

Copy and paste this command into the chat:

```bash
/validation-gate PHASE_NAME="Phase 3 - Architecture Planning" AGENT_NAME="software-architect" DELIVERABLE_PATH="task-tracking/TASK_FE_001/implementation-plan.md" TASK_ID=TASK_FE_001
```

**What happens next**: Business analyst will validate the architecture plan and decide APPROVE or REJECT.
