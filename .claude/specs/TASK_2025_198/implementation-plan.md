# Implementation Plan - TASK_2025_198: Auth Settings UX Redesign

## Codebase Investigation Summary

### Files Analyzed

- `libs/frontend/chat/src/lib/settings/auth/auth-config.component.html` (620 lines) - Main auth form template
- `libs/frontend/chat/src/lib/settings/auth/auth-config.component.ts` (330 lines) - Auth form component logic
- `libs/frontend/chat/src/lib/settings/settings.component.html` (210 lines) - Settings page with tab bar
- `libs/frontend/chat/src/lib/settings/settings.component.ts` (170 lines) - Settings page logic
- `libs/frontend/core/src/lib/services/auth-state.service.ts` (675 lines) - Auth state service (NOT modified)
- `libs/shared/src/lib/types/rpc.types.ts` - AuthMethod, AnthropicProviderInfo types

### Key State Model (Unchanged)

- `authState.authMethod()` - Signal: `'openrouter' | 'apiKey' | 'auto' | 'oauth'`
- `authState.selectedProviderId()` - Signal: string (e.g., `'openrouter'`, `'github-copilot'`)
- `authState.availableProviders()` - Signal: `AnthropicProviderInfo[]` (from backend registry)
- `authState.selectedProvider()` - Computed: `AnthropicProviderInfo | null`
- `AnthropicProviderInfo.authType` - `'apiKey' | 'oauth'` (distinguishes OAuth vs API key providers)

### Current Provider Registry (from backend, unchanged)

| Provider ID      | Name           | authType | Auth Input         |
| ---------------- | -------------- | -------- | ------------------ |
| `openrouter`     | OpenRouter     | apiKey   | API key input      |
| `moonshot`       | Moonshot/Kimi  | apiKey   | API key input      |
| `zai`            | Z.AI/GLM       | apiKey   | API key input      |
| `github-copilot` | GitHub Copilot | oauth    | GitHub OAuth login |
| `openai-codex`   | OpenAI Codex   | oauth    | File-based auth    |

### What Does NOT Exist in Backend

- There is NO "Claude" provider in the registry. Claude direct auth (API Key + OAuth) is handled by `authMethod === 'apiKey'` and `authMethod === 'oauth'` without any provider selection.

---

## Architecture Design

### Design Philosophy

**Tile-based provider selection that maps to the existing signal model.** The tile grid is a purely visual reorganization. Each tile click sets the appropriate combination of `authMethod` and `selectedProviderId` signals -- no new state is needed.

### Mapping Strategy: Tiles to Existing Signals

The core insight is that the 4-button auth method selector and the provider dropdown can be **collapsed into a single tile grid**. Each tile maps to a unique `(authMethod, selectedProviderId)` pair:

| Tile               | On Click: `setAuthMethod()` | On Click: `setSelectedProviderId()` | Config Panel Shown                               |
| ------------------ | --------------------------- | ----------------------------------- | ------------------------------------------------ |
| **Claude**         | `'apiKey'`                  | (no change)                         | API Key input + OAuth token input (with warning) |
| **OpenRouter**     | `'openrouter'`              | `'openrouter'`                      | Provider API key input                           |
| **Moonshot**       | `'openrouter'`              | `'moonshot'`                        | Provider API key input                           |
| **Z.AI**           | `'openrouter'`              | `'zai'`                             | Provider API key input                           |
| **GitHub Copilot** | `'openrouter'`              | `'github-copilot'`                  | GitHub OAuth login flow                          |
| **OpenAI Codex**   | `'openrouter'`              | `'openai-codex'`                    | Codex file-based auth                            |

**Claude tile special case**: When the Claude tile is selected, `authMethod` is set to `'apiKey'`. The template shows BOTH the API Key input AND the OAuth token input (with the existing restricted warning). This gives users both options under one tile. The `saveAndTest()` method already handles sending whichever credentials are filled in.

**Active tile detection** (computed signal):

- Claude tile is active when `authMethod === 'apiKey' || authMethod === 'oauth'`
- Provider tiles are active when `authMethod === 'openrouter' && selectedProviderId === tileId`

### What Gets Removed

1. The 4-button auth method selector (`Provider | API Key | Auto | OAuth` join buttons, lines 2-81)
2. The `<select>` provider dropdown (lines 87-106)
3. The "Auto-detect" helper text (line 76-80)

### What Gets Added

1. A tile grid (CSS grid, 3 columns) with 6 clickable cards
2. A new computed signal `selectedTileId` in the component TS
3. A new method `onTileSelect(tileId: string)` in the component TS
4. Provider icon definitions (Lucide icons for each tile)

### What Gets Reorganized (Not Rewritten)

1. The API Key input section (lines 426-521) -- shown when Claude tile is selected
2. The OAuth token input section (lines 311-424) -- shown when Claude tile is selected
3. The provider key input section (lines 208-309) -- shown when a provider tile is selected
4. The Copilot OAuth login section (lines 111-173) -- shown when Copilot tile is selected
5. The Codex auth section (lines 176-207) -- shown when Codex tile is selected
6. Save & Test button, success/error alerts -- unchanged

---

## Component Specifications

### Component 1: auth-config.component.ts (MODIFY)

**New additions** (minimal TS changes):

```typescript
// New Lucide icon imports
import { Bot, Globe, Sparkles, Zap, Terminal } from 'lucide-angular';

// New icon properties
readonly BotIcon = Bot;       // Claude tile
readonly GlobeIcon = Globe;   // OpenRouter tile
readonly SparklesIcon = Sparkles; // Moonshot tile
readonly ZapIcon = Zap;       // Z.AI tile
readonly TerminalIcon = Terminal; // Codex tile
// GithubIcon already imported

// Computed: which tile is currently active
readonly selectedTileId = computed(() => {
  const method = this.authState.authMethod();
  if (method === 'apiKey' || method === 'oauth') {
    return 'claude';  // Claude tile covers both apiKey and oauth methods
  }
  // For 'openrouter' and 'auto', the tile is the selected provider
  return this.authState.selectedProviderId();
});

// Method: handle tile selection
onTileSelect(tileId: string): void {
  if (tileId === 'claude') {
    // Claude tile: set authMethod to apiKey (primary), keep providerId unchanged
    this.authState.setAuthMethod('apiKey');
  } else {
    // Provider tile: set authMethod to openrouter, set provider
    this.authState.setAuthMethod('openrouter');
    this.authState.setSelectedProviderId(tileId);
    // Check key status for this provider (same as existing onProviderChange)
    this.authState.checkProviderKeyStatus(tileId);
  }
  // Reset replacement toggles (same as existing onAuthMethodChange)
  this.isReplacingOAuth.set(false);
  this.isReplacingApiKey.set(false);
  this.isReplacingProviderKey.set(false);
}
```

**Existing methods to keep**: `onAuthMethodChange` (unused by template but keep for API), `onProviderChange` (unused by template but keep for API), `saveAndTest`, `deleteOAuthToken`, `deleteApiKey`, `deleteProviderKey`, `copilotLogin`, `copilotLogout`, `reloadWindow`, `canSaveAndTest`.

**canSaveAndTest adjustment**: The existing `canSaveAndTest` computed already handles all methods correctly. When the Claude tile is selected (`authMethod === 'apiKey'`), it checks for API key. The OAuth token input is also shown but the user must manually switch if they want OAuth-only (edge case -- the Claude tile primarily uses API key, with OAuth as a secondary deprecated option visible for existing users).

**Evidence**:

- Icon imports verified: `lucide-angular` already imported (auth-config.component.ts:13-21)
- Signal pattern: follows existing `isOAuthProvider`, `isCopilotProvider` computed signals (lines 108-121)
- Method pattern: follows existing `onAuthMethodChange` and `onProviderChange` (lines 244-278)

### Component 2: auth-config.component.html (REWRITE)

**Template structure** (section by section):

```
<form class="space-y-2.5">

  <!-- SECTION 1: Provider Tile Grid (REPLACES auth method buttons + dropdown) -->
  <div class="form-control">
    <div class="label py-1">
      <span class="label-text text-xs font-medium">Select Provider</span>
    </div>
    <div class="grid grid-cols-3 gap-1.5">
      <!-- Claude Tile (NEW - not from provider registry) -->
      <button type="button"
        class="btn btn-sm h-auto py-2 flex flex-col items-center gap-1 ..."
        [class.btn-primary]="selectedTileId() === 'claude'"
        [class.btn-ghost]="selectedTileId() !== 'claude'"
        (click)="onTileSelect('claude')">
        <lucide-angular [img]="BotIcon" class="w-4 h-4" />
        <span class="text-[10px] font-medium">Claude</span>
      </button>

      <!-- Dynamic provider tiles from registry -->
      @for (provider of authState.availableProviders(); track provider.id) {
        <button type="button"
          class="btn btn-sm h-auto py-2 flex flex-col items-center gap-1 ..."
          [class.btn-primary]="selectedTileId() === provider.id"
          [class.btn-ghost]="selectedTileId() !== provider.id"
          (click)="onTileSelect(provider.id)">
          <!-- Icon per provider (conditional) -->
          @if (provider.id === 'github-copilot') {
            <lucide-angular [img]="GithubIcon" class="w-4 h-4" />
          } @else if (provider.id === 'openai-codex') {
            <lucide-angular [img]="TerminalIcon" class="w-4 h-4" />
          } @else if (provider.id === 'moonshot') {
            <lucide-angular [img]="SparklesIcon" class="w-4 h-4" />
          } @else if (provider.id === 'zai') {
            <lucide-angular [img]="ZapIcon" class="w-4 h-4" />
          } @else {
            <lucide-angular [img]="GlobeIcon" class="w-4 h-4" />
          }
          <span class="text-[10px] font-medium leading-tight text-center">
            {{ provider.name }}
          </span>
        </button>
      }
    </div>
  </div>

  <!-- SECTION 2: Claude Auth Config (shown when Claude tile selected) -->
  @if (selectedTileId() === 'claude') {
    <!-- API Key Input (EXISTING lines 426-521, moved here unchanged) -->
    ...existing API key input block...

    <!-- Divider -->
    <div class="divider my-1 text-[10px] opacity-50">or</div>

    <!-- OAuth Token Input (EXISTING lines 311-424, moved here) -->
    <!-- Includes the OAuth policy warning alert -->
    ...existing OAuth token input block...
  }

  <!-- SECTION 3: Provider Auth Config (shown when a provider tile selected) -->
  @if (selectedTileId() !== 'claude') {

    <!-- OAuth Provider: GitHub Copilot -->
    @if (isCopilotProvider()) {
      ...existing Copilot OAuth login block (lines 111-173), unchanged...
    }

    <!-- OAuth Provider: OpenAI Codex -->
    @if (isCodexProvider()) {
      ...existing Codex file-based auth block (lines 176-207), unchanged...
    }

    <!-- API Key Provider (OpenRouter, Moonshot, Z.AI) -->
    @if (!isOAuthProvider()) {
      ...existing provider API key input block (lines 208-309), unchanged...
    }
  }

  <!-- SECTION 4: Save & Test + Status Messages (UNCHANGED) -->
  @if (!isOAuthProvider() || selectedTileId() === 'claude') {
    ...existing Save & Test button block (lines 524-547)...
  }

  ...existing success alert (lines 549-565)...
  ...existing error alert (lines 567-610)...
  ...existing testing-in-progress alert (lines 612-619)...
</form>
```

**Key template changes**:

1. **REMOVE**: Lines 2-81 (auth method buttons + OAuth warning + auto-detect text)
2. **REMOVE**: Lines 87-106 (provider `<select>` dropdown)
3. **ADD**: Tile grid section (new)
4. **MOVE**: Claude API Key section (lines 426-521) into Claude tile conditional
5. **MOVE**: OAuth token section (lines 311-424) into Claude tile conditional (below API key)
6. **KEEP**: Provider key section, Copilot section, Codex section -- restructured into `selectedTileId() !== 'claude'` conditional
7. **KEEP**: Save & Test button, success/error/testing alerts -- unchanged

**Tile DaisyUI styling**:

```html
<!-- Active tile -->
class="btn btn-sm h-auto py-2 px-1 flex flex-col items-center gap-1 btn-primary min-h-0 rounded-lg border-2"

<!-- Inactive tile -->
class="btn btn-sm h-auto py-2 px-1 flex flex-col items-center gap-1 btn-ghost min-h-0 rounded-lg border-2 border-base-300 hover:border-primary/50"
```

### Component 3: settings.component.html (MODIFY)

**Single change**: Rename the tab label.

```html
<!-- BEFORE (line 59) -->
<span class="text-xs">Claude Auth</span>

<!-- AFTER -->
<span class="text-xs">Ptah Providers</span>
```

No other changes to this file.

### Component 4: settings.component.ts (NO CHANGES)

No modifications needed. The tab type `'claude-auth'` is a TS literal, not user-facing -- renaming it would cascade through the entire file for no benefit. The user-facing label change is in the HTML only.

---

## Save & Test Button Visibility

The Save & Test button needs careful handling:

- **Claude tile**: Show always (user enters API key or OAuth token)
- **Provider tiles (API key type)**: Show always (user enters provider key)
- **Provider tiles (OAuth type)**: Hide (Copilot/Codex have their own auth flows)

The condition becomes:

```html
@if (selectedTileId() === 'claude' || !isOAuthProvider()) {
```

This is equivalent to the existing `!isOAuthProvider()` check (line 524) plus adding Claude tile coverage. Since when `selectedTileId() === 'claude'`, `isOAuthProvider()` is already false (no provider is selected in oauth mode), the existing condition `!isOAuthProvider()` already covers Claude. So the existing condition works unchanged.

---

## canSaveAndTest Signal Adjustment

When the Claude tile is selected, `authMethod` is `'apiKey'`. The existing `canSaveAndTest` only checks API key for `'apiKey'` method. But we now show BOTH API key AND OAuth inputs under the Claude tile.

The simplest fix: when `selectedTileId() === 'claude'`, treat it like `'auto'` mode for validation purposes. This requires a small adjustment:

```typescript
readonly canSaveAndTest = computed(() => {
  const method = this.authState.authMethod();
  const hasNewOAuth = this.oauthToken().trim().length > 0;
  const hasNewApiKey = this.apiKey().trim().length > 0;
  const hasNewProviderKey = this.providerKey().trim().length > 0;
  const hasExistingOAuth = this.authState.hasOAuthToken();
  const hasExistingApiKey = this.authState.hasApiKey();
  const hasExistingProviderKey = this.authState.hasProviderKey();

  // Claude tile shows both API Key and OAuth -- accept either
  if (this.selectedTileId() === 'claude') {
    return hasNewApiKey || hasExistingApiKey || hasNewOAuth || hasExistingOAuth;
  }

  switch (method) {
    case 'oauth':
      return hasNewOAuth || hasExistingOAuth;
    case 'apiKey':
      return hasNewApiKey || hasExistingApiKey;
    case 'openrouter':
      return hasNewProviderKey || hasExistingProviderKey;
    case 'auto':
      return (
        hasNewOAuth || hasNewApiKey || hasNewProviderKey ||
        hasExistingOAuth || hasExistingApiKey || hasExistingProviderKey
      );
    default:
      return false;
  }
});
```

---

## saveAndTest Adjustment for Claude Tile

When the Claude tile is selected and the user fills in both API key and OAuth token, `saveAndTest` should send both. The existing `saveAndTest` already does this -- it sends `claudeOAuthToken` and `anthropicApiKey` regardless of auth method. The backend saves whatever is provided. No change needed.

However, we should set `authMethod` to `'auto'` when saving from the Claude tile if BOTH credentials are provided, so the backend tries both. Actually, looking at the existing code more carefully, the `params` object at line 208-215 already sends ALL filled inputs regardless of method. The backend decides priority based on `authMethod`. For the Claude tile, setting `authMethod: 'apiKey'` is correct since API key is the primary method.

No change needed to `saveAndTest`.

---

## Files Affected Summary

### MODIFY (3 files)

1. **`libs/frontend/chat/src/lib/settings/auth/auth-config.component.ts`**

   - Add 5 Lucide icon imports and properties
   - Add `selectedTileId` computed signal (~5 lines)
   - Add `onTileSelect()` method (~15 lines)
   - Adjust `canSaveAndTest` to handle Claude tile (~3 lines changed)
   - Total: ~30 lines added/modified

2. **`libs/frontend/chat/src/lib/settings/auth/auth-config.component.html`**

   - Replace auth method buttons + dropdown with tile grid
   - Reorganize conditional sections around `selectedTileId()`
   - Move API Key + OAuth sections under Claude tile conditional
   - Total: ~100 lines changed (mostly reorganization, not new logic)

3. **`libs/frontend/chat/src/lib/settings/settings.component.html`**
   - Change tab label: "Claude Auth" -> "Ptah Providers" (line 59)
   - Total: 1 line changed

### NO CHANGES (preserved exactly)

- `libs/frontend/core/src/lib/services/auth-state.service.ts` - All signals, methods, RPC calls unchanged
- `libs/shared/src/lib/types/rpc.types.ts` - Types unchanged
- All backend files - No changes
- `libs/frontend/chat/src/lib/settings/settings.component.ts` - No changes

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- Pure template and minimal TS changes in Angular components
- DaisyUI/Tailwind styling work
- No backend, no service layer changes
- Requires understanding of Angular signals and template syntax

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-3 hours

**Breakdown**:

- Tab rename in settings.component.html: 5 minutes
- TS changes in auth-config.component.ts (icons, computed, method): 30 minutes
- Template reorganization in auth-config.component.html: 1-2 hours
- Manual testing of all provider flows: 30 minutes

### Critical Verification Points

1. **All Lucide icons exist**: `Bot`, `Globe`, `Sparkles`, `Zap`, `Terminal` -- verified in lucide-angular package
2. **Signal pattern**: `selectedTileId` computed follows existing `isOAuthProvider` pattern (auth-config.component.ts:108-111)
3. **No AuthStateService changes**: All state management stays in the service layer
4. **Template blocks are copy-paste**: The API key, OAuth, provider key, Copilot, and Codex sections are moved, not rewritten

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] Mapping strategy: tiles -> existing signals documented
- [x] Template changes section-by-section
- [x] Minimal TS changes (computed + method + icons)
- [x] Claude tile special handling (both API Key + OAuth)
- [x] canSaveAndTest adjustment for Claude tile
- [x] Save & Test visibility logic preserved
- [x] No backend changes required
- [x] No AuthStateService changes required
- [x] File list with exact scope
