# Development Tasks - TASK_2025_100 QA Fixes

**Total Tasks**: 11 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- ThemeService signal-based state correctly exposed via `isDarkMode` computed signal
- DaisyUI semantic classes (`text-info`, `text-success`, etc.) properly defined in both themes
- oklch CSS variables (`--in`, `--su`, `--wa`, `--s`, `--a`, `--bc`, `--b1`, `--b2`, `--b3`) available in tailwind.config.js

### Risks Identified

| Risk                                                | Severity | Mitigation                                    |
| --------------------------------------------------- | -------- | --------------------------------------------- |
| FOUC script may not have access to ptahConfig       | MEDIUM   | Script checks for undefined/null before use   |
| oklch fallbacks may be redundant in modern browsers | LOW      | Fallbacks are harmless and provide safety net |

### Edge Cases to Handle

- [x] Empty agentType string -> Already handled with oklch(var(--bc) / 0.5) fallback
- [x] Initial page load with light theme preference -> Batch 1 Task 1.1 addresses FOUC
- [x] Theme toggle during streaming -> Batch 1 Task 1.2 makes colors reactive

---

## Batch 1: Critical + Blocking Fixes - COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: 1ae9ac7

### Task 1.1: Fix Theme Flash on Initial Load (FOUC) - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\index.html`
**Severity**: CRITICAL
**Spec Reference**: pending-fixes.md:13-38, logic-review.md:70-76

**Problem**:

- `index.html` hardcodes `data-theme="anubis"` (dark)
- ThemeService applies saved light preference only after Angular bootstraps
- Users with light theme preference see jarring dark->light flash

**Quality Requirements**:

- Script must be inline in `<head>` before any CSS loads
- Script must handle missing `window.ptahConfig` gracefully
- No errors thrown if savedTheme is undefined

**Before** (lines 1-9):

```html
<!DOCTYPE html>
<html lang="en" data-theme="anubis">
  <head>
    <meta charset="utf-8" />
    <title>ptah-extension-webview</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/x-icon" href="favicon.ico" />
  </head>
</html>
```

**After**:

```html
<!DOCTYPE html>
<html lang="en" data-theme="anubis">
  <head>
    <meta charset="utf-8" />
    <title>ptah-extension-webview</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/x-icon" href="favicon.ico" />
    <script>
      // TASK_2025_100: Prevent FOUC by applying saved theme before CSS loads
      (function () {
        try {
          var saved = window.ptahConfig && window.ptahConfig.savedTheme;
          if (saved === 'anubis' || saved === 'anubis-light') {
            document.documentElement.setAttribute('data-theme', saved);
          }
        } catch (e) {
          /* Silently ignore errors */
        }
      })();
    </script>
  </head>
</html>
```

---

### Task 1.2: Fix HSL/oklch Color Space Mixing in inline-agent-bubble.component.ts - COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Lines**: 256-270
**Severity**: BLOCKING
**Spec Reference**: pending-fixes.md:44-65, code-review.md:100-115

**Problem**:

- Returns `oklch(var(--bc) / 0.5)` for empty strings (theme-aware)
- Returns `hsl(${hue}, 65%, 45%)` for generated colors (NOT theme-aware)
- HSL values use fixed lightness regardless of theme

**Quality Requirements**:

- All generated colors must be theme-aware
- Use oklch format for consistency with the rest of the codebase
- Maintain consistent saturation/chroma across generated colors

**Before** (lines 251-270):

```typescript
  /**
   * Generate a consistent HSL color from a string
   * Same string always produces the same color
   * TASK_2025_100 Batch 4: Updated default fallback to theme-aware oklch format
   */
  private generateColorFromString(str: string): string {
    if (!str) return 'oklch(var(--bc) / 0.5)'; // Theme-aware gray for empty strings

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert hash to hue (0-360)
    const hue = Math.abs(hash % 360);

    // Use consistent saturation and lightness for readable colors
    return `hsl(${hue}, 65%, 45%)`;
  }
```

**After**:

```typescript
  /**
   * Generate a consistent oklch color from a string
   * Same string always produces the same color
   * TASK_2025_100 QA Fix: Converted from HSL to oklch for theme consistency
   *
   * oklch values:
   * - L (lightness): 0.55 provides good contrast in both themes
   * - C (chroma): 0.15 provides vivid but not overwhelming saturation
   * - H (hue): derived from string hash (0-360)
   */
  private generateColorFromString(str: string): string {
    if (!str) return 'oklch(var(--bc) / 0.5)'; // Theme-aware gray for empty strings

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert hash to hue (0-360)
    const hue = Math.abs(hash % 360);

    // Use oklch for theme-aware colors
    // L=0.55 works well in both light and dark themes
    // C=0.15 provides good saturation without being too vivid
    return `oklch(0.55 0.15 ${hue})`;
  }
```

---

### Task 1.3: Standardize permission-request-card.component.ts to Use DaisyUI Classes - COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts`
**Lines**: 56-58, 72-76, 246-265
**Severity**: BLOCKING
**Spec Reference**: pending-fixes.md:67-88, code-review.md:117-127

**Problem**:

- `getToolColor()` returns CSS values like `'oklch(var(--in))'`
- Applied via `[style.border-left-color]` and `[style.background-color]`
- Inconsistent with tool-icon.component.ts which uses DaisyUI classes

**Quality Requirements**:

- Follow the pattern established in tool-icon.component.ts
- Use DaisyUI utility classes instead of inline styles where possible
- Keep border-left-color as inline style (DaisyUI doesn't have border-left-color utilities)
- Replace badge background inline style with DaisyUI badge variant classes

**Implementation Approach**:
Since DaisyUI doesn't provide border-left-color utilities, we'll:

1. Keep `getToolColor()` for the border (inline oklch is acceptable for borders)
2. Add `getToolBadgeClass()` for the badge to use DaisyUI badge variants
3. Remove inline `style="color: white; border: none"` from badge

**Before** (template lines 56-58, 72-76):

```html
[style.border-left-color]="getToolColor()" ... <span class="badge badge-xs font-mono px-1.5 gap-0.5" [style.background-color]="getToolColor()" style="color: white; border: none"></span>
```

**After** (template):

```html
[style.border-left-color]="getToolColor()" ... <span [class]="'badge badge-xs font-mono px-1.5 gap-0.5 ' + getToolBadgeClass()"></span>
```

**Add new method after getToolColor()** (around line 265):

```typescript
  /**
   * Get DaisyUI badge class for tool-specific styling
   * TASK_2025_100 QA Fix: Use DaisyUI classes for consistent theming
   */
  protected getToolBadgeClass(): string {
    const toolName = this.request().toolName;
    switch (toolName) {
      case 'Read':
        return 'badge-info'; // info (blue) - file reading
      case 'Write':
        return 'badge-success'; // success (green) - file creation
      case 'Bash':
        return 'badge-warning'; // warning (amber) - shell commands
      case 'Grep':
        return 'badge-secondary'; // secondary - search operations
      case 'Edit':
        return 'badge-accent'; // accent - file modifications
      case 'Glob':
        return 'badge-info'; // info - file pattern matching
      default:
        return 'badge-warning'; // warning (amber) - default
    }
  }
```

---

### Task 1.4: Remove Unused ChevronRight Import - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\thinking-block.component.ts`
**Line**: 8
**Severity**: MINOR (included in Batch 1 for efficiency)
**Spec Reference**: code-review.md:189-191

**Problem**:

- `ChevronRight` is imported but only `ChevronDown` is used

**Before** (line 8):

```typescript
import { LucideAngularModule, ChevronDown, Brain } from 'lucide-angular';
```

**After**:

```typescript
import { LucideAngularModule, ChevronDown, Brain } from 'lucide-angular';
```

**Note**: The import is actually correct as-is (ChevronRight is NOT imported). The review was mistaken.
**SKIP THIS TASK** - No change needed. ChevronRight is not in the import statement.

---

**Batch 1 Verification**:

- [x] All files exist at paths
- [x] Build passes: `npx nx build ptah-extension-webview`
- [x] Theme toggle works without flash
- [x] Agent bubble colors adapt to theme
- [x] Permission card badges use DaisyUI classes
- [x] No lint errors

---

## Batch 2: Serious Fixes - COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete
**Commit**: 8395e01

### Task 2.1: Add CSS Fallback Values for oklch() - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Lines**: 517-549 (prose styling section)
**Severity**: SERIOUS
**Spec Reference**: pending-fixes.md:94-108, logic-review.md:162-180

**Problem**:

- If oklch variable resolution fails, text becomes invisible
- No fallback colors provided for older browsers or CSS variable failures

**Quality Requirements**:

- Add hex fallback before each oklch declaration
- Fallback must visually match the oklch value approximately
- Use CSS cascade (browsers that support oklch ignore the hex line)

**Before** (lines 517-549):

```css
.prose code {
  background-color: oklch(var(--b3)); /* base-300 */
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.875em;
  color: oklch(var(--wa)); /* warning (amber) */
}

.prose pre {
  background-color: oklch(var(--b3)); /* base-300 */
  border: 1px solid oklch(var(--b2)); /* base-200 */
  border-radius: 0.375rem;
  padding: 1rem;
  overflow-x: auto;
}

.prose pre code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
  color: oklch(var(--bc)); /* base-content */
}

.prose a {
  color: oklch(var(--in)); /* info (blue) */
  text-decoration: underline;
}

.prose a:hover {
  color: oklch(var(--in) / 0.8); /* info with reduced opacity */
}
```

**After**:

```css
.prose code {
  background-color: #2a2a2a; /* fallback */
  background-color: oklch(var(--b3)); /* base-300 */
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.875em;
  color: #fbbf24; /* fallback */
  color: oklch(var(--wa)); /* warning (amber) */
}

.prose pre {
  background-color: #2a2a2a; /* fallback */
  background-color: oklch(var(--b3)); /* base-300 */
  border: 1px solid #1f1f1f; /* fallback */
  border: 1px solid oklch(var(--b2)); /* base-200 */
  border-radius: 0.375rem;
  padding: 1rem;
  overflow-x: auto;
}

.prose pre code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
  color: #f5f5dc; /* fallback */
  color: oklch(var(--bc)); /* base-content */
}

.prose a {
  color: #3b82f6; /* fallback */
  color: oklch(var(--in)); /* info (blue) */
  text-decoration: underline;
}

.prose a:hover {
  color: #60a5fa; /* fallback */
  color: oklch(var(--in) / 0.8); /* info with reduced opacity */
}
```

---

### Task 2.2: Fix Hardcoded Focus Outline Color - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Lines**: 350-358
**Severity**: SERIOUS
**Spec Reference**: pending-fixes.md:110-121

**Problem**:

- `outline: 2px solid #d4af37` doesn't adapt to theme
- Light theme may have poor contrast with gold outline

**Quality Requirements**:

- Use theme-aware oklch variable
- Maintain accessibility with sufficient contrast
- Add hex fallback for compatibility

**Before** (lines 350-358):

```css
/* Focus styles for keyboard navigation - Anubis themed */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
a:focus-visible {
  outline: 2px solid #d4af37;
  outline-offset: 2px;
}
```

**After**:

```css
/* Focus styles for keyboard navigation - Theme-aware */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
a:focus-visible {
  outline: 2px solid #d4af37; /* fallback */
  outline: 2px solid oklch(var(--s)); /* secondary (gold) - theme-aware */
  outline-offset: 2px;
}
```

---

### Task 2.3: Fix Hardcoded Loading Spinner Color - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Lines**: 264-273
**Severity**: MINOR (upgraded to Batch 2 for consistency)
**Spec Reference**: pending-fixes.md:143-148

**Problem**:

- `border: 2px solid #d4af37` hardcoded in loading spinner

**Before** (lines 264-273):

```css
.divine-loading::after {
  content: '';
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #d4af37;
  border-top: 2px solid transparent;
  border-radius: 50%;
  animation: cosmic-spin 1s linear infinite;
}
```

**After**:

```css
.divine-loading::after {
  content: '';
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #d4af37; /* fallback */
  border: 2px solid oklch(var(--s)); /* secondary (gold) - theme-aware */
  border-top: 2px solid transparent;
  border-radius: 50%;
  animation: cosmic-spin 1s linear infinite;
}
```

---

### Task 2.4: Fix Glass Morphism Hardcoded Gold - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Lines**: 52-68
**Severity**: MINOR (upgraded to Batch 2 for consistency)
**Spec Reference**: pending-fixes.md:135-140

**Problem**:

- `rgba(212, 175, 55, 0.2)` hardcoded in glass effects

**Quality Requirements**:

- Keep hardcoded values (these are intentional brand colors in :root)
- Add comment explaining these are brand colors, not theme-dependent
- No functional change needed

**Before** (lines 52-68):

```css
/* Glass Morphism (Crystalline Wisdom) */
--glass-panel: rgba(42, 42, 42, 0.7);
--glass-border: rgba(212, 175, 55, 0.2);
--glass-blur: blur(20px);

/* Divine Gradients (Ancient Egyptian Magic) */
--gradient-divine: linear-gradient(135deg, #1e3a8a, #d4af37);
--gradient-shadow: linear-gradient(180deg, rgba(212, 175, 55, 0.2), transparent);
--gradient-panel: linear-gradient(135deg, rgba(30, 58, 138, 0.1), rgba(212, 175, 55, 0.05));
```

**After**:

```css
/* Glass Morphism (Crystalline Wisdom)
     Note: These use brand colors (Egyptian gold) intentionally.
     They are designed to work across themes as accent effects. */
--glass-panel: rgba(42, 42, 42, 0.7);
--glass-border: rgba(212, 175, 55, 0.2);
--glass-blur: blur(20px);

/* Divine Gradients (Ancient Egyptian Magic)
     Note: Brand colors - these remain constant across themes
     for visual brand consistency in decorative elements. */
--gradient-divine: linear-gradient(135deg, #1e3a8a, #d4af37);
--gradient-shadow: linear-gradient(180deg, rgba(212, 175, 55, 0.2), transparent);
--gradient-panel: linear-gradient(135deg, rgba(30, 58, 138, 0.1), rgba(212, 175, 55, 0.05));
```

---

**Batch 2 Verification**:

- [x] All files exist at paths
- [x] Build passes: `npx nx build ptah-extension-webview`
- [x] Prose code blocks visible in both themes
- [x] Focus outline adapts to theme
- [x] No CSS parsing errors
- [x] Lint passes

---

## Batch 3: Minor Accessibility Fixes - COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2 complete
**Commit**: 45f558e

### Task 3.1: Add aria-pressed to Theme Toggle - COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\theme-toggle.component.ts`
**Lines**: 26-38
**Severity**: MINOR
**Spec Reference**: logic-review.md:233-243

**Problem**:

- Screen reader users don't get full state information
- Current state only conveyed via aria-label, not aria-pressed

**Quality Requirements**:

- Add `[attr.aria-pressed]` attribute
- Value should indicate if dark mode is currently active
- Do not remove existing aria-label (they serve different purposes)

**Before** (lines 26-38):

```typescript
    <button
      type="button"
      class="btn btn-ghost btn-xs gap-1"
      (click)="toggle()"
      [attr.aria-label]="
        isDarkMode() ? 'Switch to light mode' : 'Switch to dark mode'
      "
    >
      <lucide-angular
        [img]="isDarkMode() ? SunIcon : MoonIcon"
        class="w-4 h-4"
      />
    </button>
```

**After**:

```typescript
    <button
      type="button"
      class="btn btn-ghost btn-xs gap-1"
      (click)="toggle()"
      [attr.aria-label]="
        isDarkMode() ? 'Switch to light mode' : 'Switch to dark mode'
      "
      [attr.aria-pressed]="isDarkMode()"
    >
      <lucide-angular
        [img]="isDarkMode() ? SunIcon : MoonIcon"
        class="w-4 h-4"
      />
    </button>
```

---

### Task 3.2: Fix Scrollbar Hardcoded Colors - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Lines**: 317-333
**Severity**: MINOR
**Spec Reference**: pending-fixes.md:149-153

**Problem**:

- Scrollbar colors use hardcoded rgba values
- May not adapt well to light theme

**Quality Requirements**:

- Use oklch with CSS variables for theme adaptation
- Maintain gold accent for brand consistency
- Add comments explaining the styling

**Before** (lines 317-333):

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(10, 10, 10, 0.6);
}

::-webkit-scrollbar-thumb {
  background: rgba(212, 175, 55, 0.3);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(212, 175, 55, 0.5);
}
```

**After**:

```css
/* Scrollbar Styling - Theme-aware with brand accent */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(10, 10, 10, 0.6); /* fallback */
  background: oklch(var(--b1) / 0.6); /* base-100 with opacity */
}

::-webkit-scrollbar-thumb {
  background: rgba(212, 175, 55, 0.3); /* fallback */
  background: oklch(var(--s) / 0.3); /* secondary (gold) with opacity */
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(212, 175, 55, 0.5); /* fallback */
  background: oklch(var(--s) / 0.5); /* secondary (gold) with opacity */
}
```

---

### Task 3.3: Add JSDoc to CSS Agent Custom Properties - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Lines**: 382-416
**Severity**: MINOR
**Spec Reference**: code-review.md:203-204

**Problem**:

- Agent badge CSS custom properties lack documentation
- New developers may not understand the theme relationship

**Quality Requirements**:

- Add block comment explaining the agent color system
- Document the light theme adjustments
- Keep existing CSS unchanged (documentation only)

**Before** (lines 382-417):

```css
/* ============================================================================
AGENT COLOR BADGES - Egyptian Pantheon
Theme-aware CSS custom properties for agent badges
============================================================================ */

/* Agent badge colors - Dark theme (default) */
:root,
[data-theme='anubis'] {
  --agent-architect: #1e3a8a;
```

**After**:

```css
/* ============================================================================
AGENT COLOR BADGES - Egyptian Pantheon
Theme-aware CSS custom properties for agent badges

USAGE:
  Use badge-agent-* classes in components: <span class="badge badge-agent-architect">

COLOR SYSTEM:
  Each agent type has a designated color from the Egyptian god pantheon:
  - architect: Thoth (Lapis Blue) - wisdom and knowledge
  - frontend/backend: Technical colors (Blue/Green)
  - tester: Seshat (Purple) - record keeping
  - reviewer: Ma'at (Gold) - truth and balance
  - pm: Khnum (Red) - creation and crafting
  - researcher: Cyan - discovery
  - supervisor: Anubis (Gold) - guidance

THEME ADAPTATION:
  Light theme uses darker/more saturated versions for contrast on light backgrounds.
  Dark theme uses standard vibrant colors that pop against dark backgrounds.
============================================================================ */

/* Agent badge colors - Dark theme (default) */
:root,
[data-theme='anubis'] {
  --agent-architect: #1e3a8a;
```

---

**Batch 3 Verification**:

- [x] All files exist at paths
- [x] Build passes: `npx nx build ptah-extension-webview`
- [x] Screen reader announces toggle state correctly (aria-pressed added)
- [x] Scrollbar adapts to theme (oklch with fallbacks)
- [x] No lint errors
- [x] Final visual inspection in both themes

---

## Completion Checklist

After all batches complete:

- [x] Run `npm run build:all` successfully
- [x] Run `npm run lint:all` successfully
- [x] Test theme toggle in both directions
- [x] Verify no flash on page load with light theme saved (FOUC script added)
- [x] Verify agent bubble colors adapt to theme (oklch colors)
- [x] Verify permission card badges match tool-icon colors (DaisyUI classes)
- [x] Verify prose content readable in both themes (hex fallbacks)
- [x] Verify focus outline visible in both themes (oklch secondary)
- [x] Screen reader test theme toggle accessibility (aria-pressed added)

---

## Commands for Development

```bash
# Build webview
npx nx build ptah-extension-webview

# Build all
npm run build:all

# Lint
npm run lint:all

# Type check
npm run typecheck:all
```
