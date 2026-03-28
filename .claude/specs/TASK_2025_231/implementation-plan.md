# Implementation Plan - TASK_2025_231: Electron View Tab Pills

## Codebase Investigation Summary

### Libraries Analyzed

- **@ptah-extension/core** (`libs/frontend/core/`) - AppStateManager, ElectronLayoutService, WebviewNavigationService
- **@ptah-extension/chat** (`libs/frontend/chat/`) - ElectronShellComponent, AppShellComponent, AppShellComponent HTML template

### Patterns Identified

- **Signal-based state management**: All state uses Angular 20 `signal()` / `computed()` / `.asReadonly()` pattern (AppStateManager:65-84, ElectronLayoutService:56-79)
- **View switching via AppStateManager.currentView()**: Single `_currentView` signal drives `@switch` in `app-shell.component.html:17` to render one view at a time
- **Electron-only UI in electron-shell.component.ts**: Global navbar (line 141-256) only rendered in Electron; VS Code webview has its own header in app-shell
- **`isElectron` conditional rendering**: `app-shell.component.ts:145` and `.html:311,369,447` use `isElectron` flag to show/hide UI elements
- **Lucide icons**: All icons imported from `lucide-angular` (electron-shell:19-42, app-shell:14-30)
- **DaisyUI + Tailwind styling**: All components use `btn btn-ghost btn-xs`, `bg-base-200`, `border-base-content/10`, etc.

### Key Observation: The Problem

Currently in `app-shell.component.html:17-44`, view switching uses `@switch (currentView())` which **exclusively** renders one view. When the user opens Settings, Setup Wizard, or Dashboard, the Chat view is completely destroyed. The only way back is through each view's own "back" button:

- Settings: `settings.component.ts:244` calls `setCurrentView('chat')`
- Dashboard: `session-analytics-dashboard-view.component.ts:160` calls `setCurrentView('chat')`
- Setup Wizard: Has **no back button at all** - this is the core UX problem

### Integration Points

- `AppStateManager.setCurrentView()` (app-state.service.ts:175) - The single method that switches views
- `ElectronShellComponent.openSettings()` / `openDashboard()` (electron-shell.component.ts:508-514) - Navbar buttons that trigger view changes
- `AppShellComponent.openSettings()` / `openDashboard()` (app-shell.component.ts:283-291) - Header buttons that trigger view changes

---

## Architecture Design

### Design Philosophy

**Minimal-footprint extension of existing signal-based state**, not a new component or service. We add an `openViews` signal to the existing `AppStateManager`, then render tab pills inline in the electron-shell navbar template. No new components, no new services, no new files.

**Rationale**: The view tab pills are a small, Electron-only UI addition. Creating a new component for 5-6 tab pills would be over-engineering. The state tracking (which views are "open") naturally belongs in AppStateManager alongside `currentView`. The tab pill rendering belongs in the electron-shell navbar because that's the only place it appears.

---

## Component Specifications

### Component 1: Open Views Tracking (AppStateManager)

**Purpose**: Track which views are currently "open" (visible as tabs). Chat is always open. Other views are added when navigated to and removed when explicitly closed.

**Pattern**: Existing signal-based state pattern in AppStateManager (app-state.service.ts:65-84)

**Evidence**: All state in AppStateManager follows the `private signal` + `public asReadonly()` + `update methods` pattern.

**File**: `libs/frontend/core/src/lib/services/app-state.service.ts`

**Changes**:

1. Add a new private signal `_openViews` of type `Set<ViewType>`, initialized with `new Set(['chat'])`.

2. Add a public readonly signal `openViews` exposing the set as a readonly array (for template iteration):

   ```typescript
   private readonly _openViews = signal<Set<ViewType>>(new Set(['chat']));
   readonly openViews = computed(() => Array.from(this._openViews()));
   ```

3. Add method `openView(view: ViewType)` that adds to the set and switches to it:

   ```typescript
   openView(view: ViewType): void {
     this._openViews.update(views => {
       const next = new Set(views);
       next.add(view);
       return next;
     });
     this._currentView.set(view);
   }
   ```

4. Add method `closeView(view: ViewType)` that removes from the set (cannot close 'chat') and switches to chat:

   ```typescript
   closeView(view: ViewType): void {
     if (view === 'chat') return; // Chat cannot be closed
     this._openViews.update(views => {
       const next = new Set(views);
       next.delete(view);
       return next;
     });
     // If we just closed the active view, switch to chat
     if (this._currentView() === view) {
       this._currentView.set('chat');
     }
   }
   ```

5. Modify `setCurrentView(view: ViewType)` to also add the view to `_openViews` (so existing callers automatically open the tab):

   ```typescript
   setCurrentView(view: ViewType): void {
     if (this.canSwitchViews()) {
       this._openViews.update(views => {
         const next = new Set(views);
         next.add(view);
         return next;
       });
       this._currentView.set(view);
     }
   }
   ```

6. Modify `handleViewSwitch(view: ViewType)` similarly (called from backend message handler):
   ```typescript
   handleViewSwitch(view: ViewType): void {
     this._openViews.update(views => {
       const next = new Set(views);
       next.add(view);
       return next;
     });
     this._currentView.set(view);
   }
   ```

**Quality Requirements**:

- `'chat'` must always be in `openViews` (never removable)
- `'welcome'` view should NOT appear in open views (it's a gate, not a tab)
- Opening a view that's already open should just switch to it (no duplicate)
- Closing the active view must fall back to 'chat'
- Signal immutability: always create new Set instances on update

**Decisions**:

- **Decision**: Use `Set<ViewType>` for open views tracking
- **Evidence**: Sets provide O(1) add/delete/has, natural deduplication, and match the "unique open views" semantics
- **Decision**: Integrate with existing `setCurrentView` rather than requiring callers to change
- **Evidence**: 6 call sites already use `setCurrentView` (electron-shell:509,513; app-shell:264,284,291; dashboard:160). Making `setCurrentView` auto-add to open views means zero changes at call sites.

---

### Component 2: View Tab Pills UI (ElectronShellComponent)

**Purpose**: Render a row of small tab pills in the Electron global navbar showing all open views. Clicking a pill switches to that view. Non-chat pills have a close (X) button.

**Pattern**: Existing navbar button pattern in electron-shell.component.ts (lines 162-254)

**Evidence**: The navbar already renders buttons with `btn btn-ghost btn-xs gap-1` class, Lucide icons, and `(click)` handlers for settings/dashboard.

**File**: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`

**Changes**:

1. **Add imports**: Import `X`, `MessageSquare`, `Wand2` (for wizard) from `lucide-angular`. `Settings` and `BarChart3` are already imported.

2. **Add icon references** in the component class:

   ```typescript
   readonly XIcon = X;
   readonly MessageSquareIcon = MessageSquare;
   readonly Wand2Icon = Wand2;
   ```

3. **Add a view metadata helper** (computed signal or method) to map ViewType to display label + icon:

   ```typescript
   /** Map view types to display metadata for tab pills */
   protected getViewMeta(view: ViewType): { label: string; icon: LucideIconData } {
     switch (view) {
       case 'chat': return { label: 'Chat', icon: MessageSquare };
       case 'settings': return { label: 'Settings', icon: Settings };
       case 'analytics': return { label: 'Dashboard', icon: BarChart3 };
       case 'setup-wizard': return { label: 'Setup', icon: Wand2 };
       default: return { label: view, icon: MessageSquare };
     }
   }
   ```

4. **Add tab pills in the navbar template**, placed between the workspace sidebar toggle and the spacer. This positions them left-of-center, which is the natural location for "content tabs" (similar to browser tabs or VS Code editor tabs):

   ```html
   <!-- View tab pills (between workspace toggle and spacer) -->
   @if (appState.isLicensed() && layout.hasWorkspaceFolders()) {
   <div class="flex items-center gap-0.5 no-drag ml-2">
     @for (view of appState.openViews(); track view) {
     <button class="btn btn-xs gap-1 rounded-full px-2.5 h-6 min-h-0 no-drag transition-all duration-150" [class.btn-primary]="appState.currentView() === view" [class.btn-ghost]="appState.currentView() !== view" [class.text-base-content/60]="appState.currentView() !== view" [title]="getViewMeta(view).label" (click)="appState.setCurrentView(view)">
       <lucide-angular [img]="getViewMeta(view).icon" class="w-3 h-3" />
       <span class="text-xs">{{ getViewMeta(view).label }}</span>
       <!-- Close button for non-chat views -->
       @if (view !== 'chat') {
       <span class="ml-0.5 rounded-full hover:bg-base-content/20 p-0.5 cursor-pointer" title="Close" (click)="closeViewTab(view, $event)">
         <lucide-angular [img]="XIcon" class="w-2.5 h-2.5" />
       </span>
       }
     </button>
     }
   </div>
   }
   ```

5. **Add closeViewTab method** in the component class:

   ```typescript
   closeViewTab(view: ViewType, event: Event): void {
     event.stopPropagation(); // Prevent the parent button click from switching to this view
     this.appState.closeView(view);
   }
   ```

6. **Modify existing openSettings/openDashboard methods** to use `openView` instead of `setCurrentView` (optional, since `setCurrentView` now auto-adds to open views, but using `openView` is more semantically clear):
   ```typescript
   openSettings(): void {
     this.appState.openView('settings');
   }
   openDashboard(): void {
     this.appState.openView('analytics');
   }
   ```

**UI/UX Specification**:

- **Location**: In the Electron global navbar, after the workspace sidebar toggle button, before the flex spacer
- **Shape**: Rounded pill buttons (`rounded-full`)
- **Size**: Extra small (`btn-xs`, `h-6 min-h-0`)
- **Active state**: `btn-primary` (filled primary color) for the current view
- **Inactive state**: `btn-ghost text-base-content/60` for non-active open views
- **Content**: Lucide icon (w-3 h-3) + short label text (text-xs) + close X button (non-chat only)
- **Close button**: Small inline X icon with hover highlight, stops event propagation
- **Visibility**: Only shown when licensed AND workspace is open (matches existing gate logic at line 208/232)
- **macOS drag region**: Tab pills are `no-drag` so they're clickable on macOS title bar

**View-to-Metadata Mapping**:
| ViewType | Label | Icon |
|---|---|---|
| `chat` | Chat | MessageSquare |
| `settings` | Settings | Settings |
| `analytics` | Dashboard | BarChart3 |
| `setup-wizard` | Setup | Wand2 |

---

### Component 3: Existing View Back Buttons (Settings, Dashboard)

**Purpose**: Existing "back to chat" buttons in Settings and Dashboard should continue to work. They already call `setCurrentView('chat')` which will work correctly with the new open views tracking (the settings/dashboard view stays in `openViews` until the user explicitly closes the tab pill).

**Decision**: No changes needed to settings or dashboard components. When the user clicks "Back" in Settings, it switches to chat but leaves the Settings tab pill visible. The user can switch back to Settings by clicking the pill, or close it with X.

**Alternative Considered**: Making the "Back" button also close the view tab. Rejected because keeping the tab open provides better UX - the user can quickly switch between chat and settings without re-opening settings each time. The explicit X button on the tab pill is the clear "close" affordance.

---

## Integration Architecture

### Data Flow

```
User clicks "Settings" navbar button
  -> ElectronShellComponent.openSettings()
  -> AppStateManager.openView('settings')
    -> _openViews adds 'settings'
    -> _currentView set to 'settings'
  -> electron-shell template re-renders:
    -> Tab pills now show: [Chat] [Settings(active)]
  -> app-shell @switch renders SettingsComponent

User clicks "Chat" tab pill
  -> AppStateManager.setCurrentView('chat')
    -> _currentView set to 'chat'
  -> Tab pills: [Chat(active)] [Settings]
  -> app-shell @switch renders ChatViewComponent

User clicks X on Settings tab pill
  -> ElectronShellComponent.closeViewTab('settings', event)
    -> event.stopPropagation()
    -> AppStateManager.closeView('settings')
      -> _openViews removes 'settings'
      -> _currentView set to 'chat' (was viewing settings)
  -> Tab pills: [Chat(active)]
  -> app-shell @switch renders ChatViewComponent
```

### Dependencies

- No new external dependencies
- No new internal library dependencies
- Only existing imports: `lucide-angular` icons (X, MessageSquare, Wand2 added to electron-shell)

---

## Files Affected Summary

**MODIFY** (3 files):

1. **`libs/frontend/core/src/lib/services/app-state.service.ts`**
   - Add `_openViews` signal and `openViews` computed signal
   - Add `openView()` and `closeView()` methods
   - Modify `setCurrentView()` and `handleViewSwitch()` to auto-add views to open set
   - Estimated: ~30 lines added/modified

2. **`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`**
   - Add Lucide icon imports (X, MessageSquare, Wand2)
   - Add icon fields and `getViewMeta()` helper
   - Add `closeViewTab()` method
   - Add tab pills section in navbar template
   - Update `openSettings()`/`openDashboard()` to use `openView()`
   - Estimated: ~50 lines added/modified

3. **`libs/frontend/core/src/lib/services/app-state.service.ts`** (type export)
   - `ViewType` already exported, `openViews` signal automatically available through existing AppStateManager export

**NO NEW FILES**: The entire feature fits within 2 existing files.

---

## Edge Cases to Handle

### 1. Welcome View Excluded from Tabs

The `welcome` view is a license gate, not a regular view. It should never appear as a tab pill. The `openViews` computed signal should filter it out:

```typescript
readonly openViews = computed(() =>
  Array.from(this._openViews()).filter(v => v !== 'welcome')
);
```

**Evidence**: Welcome view already has special handling (app-state.service.ts:89 blocks navigation from welcome view).

### 2. Backend-Triggered View Switch

When the backend sends a `SWITCH_VIEW` message (app-state.service.ts:40-61), it calls `handleViewSwitch()`. This must also add the view to `_openViews` so the tab pill appears. Already covered in the design above.

### 3. Initial View from Window Augmentation

On startup, `initializeState()` (app-state.service.ts:134-172) sets `_currentView` from `window.initialView`. If the initial view is not 'chat', it should also be added to `_openViews`. Modify `initializeState()` to:

```typescript
const initialView = windowWithState.initialView || 'chat';
this._currentView.set(initialView);
if (initialView !== 'chat' && initialView !== 'welcome') {
  this._openViews.update((views) => {
    const next = new Set(views);
    next.add(initialView);
    return next;
  });
}
```

### 4. canSwitchViews Guard

`setCurrentView` already checks `canSwitchViews()` (app-state.service.ts:176). When views can't switch (loading, disconnected, on welcome), `openView` should also respect this guard. The `openView` method should check `canSwitchViews()` before proceeding (same pattern as `setCurrentView`).

### 5. Rapid Click on Close Button

The `closeViewTab` method uses `event.stopPropagation()` to prevent the parent button's `(click)` from firing and switching to the view being closed. This is essential -- without it, clicking X would first switch to the view then immediately close it, causing a flash.

### 6. Views Not Relevant in VS Code Sidebar

Tab pills only render in the electron-shell navbar. The VS Code sidebar webview is not affected. This is enforced by the tab pills template only existing in `electron-shell.component.ts`.

### 7. Context-Tree and Command-Builder Views

These ViewTypes exist in the type union but are not currently used in the UI. If a backend message switches to them, they'd appear as tab pills with a generic fallback label. The `getViewMeta` switch has a `default` case that handles this gracefully.

### 8. Closing Active View While Streaming

If the user closes the chat-adjacent view while a stream is active in chat, the switch back to chat is safe because `@switch` in app-shell simply renders the ChatViewComponent which has its own streaming state managed by ChatStore.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- Pure Angular frontend changes (signals, templates, Tailwind)
- No backend/extension changes needed
- Only 2 files modified in frontend libraries

### Complexity Assessment

**Complexity**: LOW
**Estimated Effort**: 1-2 hours

**Breakdown**:

- AppStateManager signal additions: 30 minutes
- Electron-shell navbar template + component: 45 minutes
- Manual testing across views: 30 minutes

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:
   - `X` from `lucide-angular` (verified: used in app-shell.component.ts:28)
   - `MessageSquare` from `lucide-angular` (verified: used in app-shell.component.ts:19)
   - `Wand2` from `lucide-angular` (verify available in lucide-angular package)
   - `ViewType` from `app-state.service.ts:12-19` (verified)
   - `computed`, `signal` from `@angular/core` (verified: used throughout)

2. **All patterns verified from examples**:
   - Signal + computed pattern: `app-state.service.ts:65-96`
   - Navbar button pattern: `electron-shell.component.ts:162-254`
   - `event.stopPropagation()` pattern: `app-shell.component.ts:512`

3. **No hallucinated APIs**:
   - `signal()` (verified: @angular/core)
   - `computed()` (verified: @angular/core)
   - `.asReadonly()` (verified: app-state.service.ts:78)
   - `.update()` on signal (verified: app-state.service.ts used throughout)
   - `LucideAngularModule` (verified: electron-shell.component.ts:69)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete (2 files)
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (LOW, 1-2 hours)
- [x] Edge cases documented (8 cases)
- [x] No step-by-step implementation (that's team-leader's job)
