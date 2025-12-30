# Implementation Plan - TASK_2025_100

## DaisyUI Theme Consistency & Theme Toggle System

---

## Codebase Investigation Summary

### Theme Configuration Discovered

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js`

The codebase already has two fully-defined DaisyUI themes:

| Theme          | Purpose     | Base Colors                              |
| -------------- | ----------- | ---------------------------------------- |
| `anubis`       | Dark theme  | base-100: #0a0a0a, base-content: #f5f5dc |
| `anubis-light` | Light theme | base-100: #ffffff, base-content: #1a1a1a |

Both themes define complete semantic color palettes:

- `--p` (primary), `--s` (secondary), `--a` (accent)
- `--n` (neutral), `--b1/b2/b3` (base backgrounds)
- `--bc` (base-content/text)
- `--su` (success), `--er` (error), `--wa` (warning), `--in` (info)

**Current issue**: `index.html` uses `data-theme="ptah"` which doesn't exist, should be `anubis`.

### Service Patterns Discovered

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`

Key patterns for ThemeService design:

- Signal-based state: `private readonly _config = signal<WebviewConfig>(...)`
- Public readonly: `readonly config = this._config.asReadonly()`
- Initialization from window globals: `ptahWindow.ptahConfig.theme`
- VS Code already provides theme info: `theme: 'light' | 'dark' | 'high-contrast'`

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`

Established pattern for state services:

- `@Injectable({ providedIn: 'root' })`
- Private signals with public readonly accessors
- Computed signals for derived state
- State snapshot method for debugging

### Files With Hardcoded Colors (Evidence)

#### 1. styles.css (D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css)

**Agent Badge Colors (lines 386-429)** - 9 badges with hardcoded hex + `!important`:

```css
.badge-agent-architect {
  background-color: #1e3a8a !important;
  color: #f5f5dc !important;
}
.badge-agent-frontend {
  background-color: #3b82f6 !important;
  color: #f5f5dc !important;
}
.badge-agent-backend {
  background-color: #228b22 !important;
  color: #f5f5dc !important;
}
.badge-agent-tester {
  background-color: #8b5cf6 !important;
  color: #f5f5dc !important;
}
.badge-agent-reviewer {
  background-color: #d4af37 !important;
  color: #0a0a0a !important;
}
.badge-agent-leader {
  background-color: #6366f1 !important;
  color: #f5f5dc !important;
}
.badge-agent-pm {
  background-color: #b22222 !important;
  color: #f5f5dc !important;
}
.badge-agent-researcher {
  background-color: #06b6d4 !important;
  color: #0a0a0a !important;
}
.badge-agent-supervisor {
  background-color: #d4af37 !important;
  color: #0a0a0a !important;
}
```

**Prose/Markdown Styling (lines 479-545)** - Hardcoded colors for markdown:

```css
.prose code {
  background-color: #2a2a2a;
  color: #fbbf24;
}
.prose pre {
  background-color: #2a2a2a;
  border: 1px solid #1a1a1a;
}
.prose pre code {
  color: #f5f5dc;
}
.prose a {
  color: #3b82f6;
}
.prose a:hover {
  color: #60a5fa;
}
.prose h1-h6 {
  color: #d4af37;
}
.prose blockquote {
  border-left: 4px solid #d4af37;
  color: #9ca3af;
}
.prose ul,
.prose ol {
  color: #f5f5dc;
}
.prose strong {
  color: #f5f5dc;
}
```

**Additional hardcoded values** (decorative/animations - lower priority):

- CSS variables in `:root` (lines 21-80) - These define theme-specific accents
- Glass morphism effects (rgba values with gold accent)
- Focus outline colors (line 356): `outline: 2px solid #d4af37`
- Loading spinner (line 269): `border: 2px solid #d4af37`

#### 2. permission-request-card.component.ts (lines 245-263)

**Location**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts`

```typescript
protected getToolColor(): string {
  switch (toolName) {
    case 'Read': return '#60a5fa';    // blue-400
    case 'Write': return '#4ade80';   // green-400
    case 'Bash': return '#fbbf24';    // amber-400
    case 'Grep': return '#a855f7';    // purple-400
    case 'Edit': return '#fb923c';    // orange-400
    case 'Glob': return '#06b6d4';    // cyan-400
    default: return '#f59e0b';        // amber-500
  }
}
```

#### 3. tool-icon.component.ts (lines 72-90)

**Location**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\tool-icon.component.ts`

```typescript
protected getColorClass(): string {
  switch (name) {
    case 'Read': return 'text-blue-400';
    case 'Write': return 'text-green-400';
    case 'Bash': return 'text-yellow-400';
    case 'Grep': return 'text-purple-400';
    case 'Edit': return 'text-orange-400';
    case 'Glob': return 'text-cyan-400';
    default: return 'text-base-content/60';
  }
}
```

#### 4. inline-agent-bubble.component.ts (lines 235-269)

**Location**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`

```typescript
const builtinColors: Record<string, string> = {
  Explore: '#22c55e',
  Plan: '#a855f7',
  'general-purpose': '#6366f1',
  'claude-code-guide': '#0ea5e9',
  'statusline-setup': '#64748b',
};
// Default: '#717171'
// Generated colors use HSL
```

#### 5. Additional Components with Hardcoded Tailwind Colors

| File                         | Line | Hardcoded Class   |
| ---------------------------- | ---- | ----------------- |
| agent-execution.component.ts | 72   | `text-purple-400` |
| agent-execution.component.ts | 120  | `text-blue-400`   |
| agent-summary.component.ts   | 64   | `text-purple-400` |
| agent-summary.component.ts   | 83   | `text-blue-400`   |
| thinking-block.component.ts  | 41   | `text-purple-400` |

### Already Fixed (Pattern Reference)

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\diff-display.component.ts`

Uses DaisyUI oklch variables correctly:

```css
.token.deleted {
  color: oklch(var(--er)) !important;
}
.token.inserted {
  color: oklch(var(--su)) !important;
}
.token.coord {
  color: oklch(var(--in)) !important;
}
border-left: 3px solid oklch(var(--bc) / 0.2);
```

---

## Architecture Design

### Design Philosophy

**Approach**: Incremental migration to DaisyUI semantic colors + ThemeService for toggle

**Principles**:

1. Use DaisyUI semantic variables (`--su`, `--er`, `--wa`, `--in`, `--p`, `--s`) for all colors
2. Single source of truth for theme state (ThemeService)
3. Persist preference via VSCode extension state
4. Follow existing service patterns (signal-based, readonly accessors)

### Component Specifications

---

#### Component 1: ThemeService

**Purpose**: Centralized theme state management and persistence

**Pattern**: Signal-based service (matching AppStateManager pattern)
**Evidence**:

- Pattern source: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`
- VSCode integration: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`

**Responsibilities**:

- Store current theme ('anubis' | 'anubis-light')
- Apply `data-theme` attribute to document.documentElement
- Persist preference via ClaudeRpcService (extension state)
- Initialize from saved preference or VS Code theme signal
- Provide computed signal for isDarkMode

**Implementation Pattern**:

```typescript
// Pattern source: app-state.service.ts
// Location: libs/frontend/core/src/lib/services/theme.service.ts

import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';
import { ClaudeRpcService } from './claude-rpc.service';

export type ThemeName = 'anubis' | 'anubis-light';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly vscode = inject(VSCodeService);
  private readonly rpc = inject(ClaudeRpcService);

  // Private mutable signal
  private readonly _currentTheme = signal<ThemeName>('anubis');

  // Public readonly signals
  readonly currentTheme = this._currentTheme.asReadonly();
  readonly isDarkMode = computed(() => this._currentTheme() === 'anubis');

  constructor() {
    this.initializeTheme();

    // Apply theme to DOM whenever it changes
    effect(() => {
      const theme = this._currentTheme();
      document.documentElement.setAttribute('data-theme', theme);
    });
  }

  private async initializeTheme(): Promise<void> {
    // 1. Try to load saved preference from extension state
    const result = await this.rpc.callExtension<void, { theme: ThemeName }>('settings:get-theme', undefined);

    if (result.success && result.data.theme) {
      this._currentTheme.set(result.data.theme);
      return;
    }

    // 2. Fall back to VS Code theme signal
    const vscodeTheme = this.vscode.config().theme;
    if (vscodeTheme === 'light') {
      this._currentTheme.set('anubis-light');
    } else {
      this._currentTheme.set('anubis');
    }
  }

  async setTheme(theme: ThemeName): Promise<void> {
    this._currentTheme.set(theme);

    // Persist to extension state
    await this.rpc.callExtension('settings:set-theme', { theme });
  }

  toggleTheme(): void {
    const newTheme = this._currentTheme() === 'anubis' ? 'anubis-light' : 'anubis';
    this.setTheme(newTheme);
  }
}
```

**Quality Requirements**:

- Must initialize before first render (use in APP_INITIALIZER)
- Must handle missing extension state gracefully
- Must apply data-theme attribute reactively

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\theme.service.ts` (CREATE)
- `D:\projects\ptah-extension\libs\frontend\core\src\index.ts` (MODIFY - export)

---

#### Component 2: Theme Toggle UI

**Purpose**: User-facing theme switch control

**Pattern**: Atom component with toggle/dropdown
**Evidence**: Similar pattern in `autopilot-popover.component.ts`

**Implementation Pattern**:

```typescript
// Location: libs/frontend/chat/src/lib/components/atoms/theme-toggle.component.ts

@Component({
  selector: 'ptah-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button class="btn btn-ghost btn-xs gap-1" (click)="toggle()" [attr.aria-label]="isDarkMode() ? 'Switch to light mode' : 'Switch to dark mode'">
      <lucide-angular [img]="isDarkMode() ? SunIcon : MoonIcon" class="w-4 h-4" />
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  private readonly themeService = inject(ThemeService);

  readonly isDarkMode = this.themeService.isDarkMode;

  protected readonly SunIcon = Sun;
  protected readonly MoonIcon = Moon;

  protected toggle(): void {
    this.themeService.toggleTheme();
  }
}
```

**Placement Options** (recommend sidebar header):

- Settings component (settings.component.ts)
- App shell header/toolbar
- Sidebar navigation area

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\theme-toggle.component.ts` (CREATE)
- `D:\projects\ptah-extension\libs\frontend\chat\src\index.ts` (MODIFY - export)

---

#### Component 3: Color Migration - styles.css

**Purpose**: Replace hardcoded hex colors with DaisyUI semantic variables

**Pattern**: Use `oklch(var(--variable))` format (matching diff-display.component.ts)

**Migration Strategy for Agent Badges**:

The agent badge colors are intentional brand colors for the "Egyptian Pantheon" theme. These should remain as CSS custom properties but be theme-aware:

```css
/* BEFORE - hardcoded */
.badge-agent-architect {
  background-color: #1e3a8a !important;
}

/* AFTER - theme-aware via CSS custom properties */
/* Define in :root for dark theme, override for light */
:root,
[data-theme='anubis'] {
  --agent-architect: #1e3a8a;
  --agent-frontend: #3b82f6;
  --agent-backend: #228b22;
  --agent-tester: #8b5cf6;
  --agent-reviewer: #d4af37;
  --agent-leader: #6366f1;
  --agent-pm: #b22222;
  --agent-researcher: #06b6d4;
  --agent-supervisor: #d4af37;
  --agent-badge-text-light: #f5f5dc;
  --agent-badge-text-dark: #0a0a0a;
}

[data-theme='anubis-light'] {
  /* Slightly darker versions for light background contrast */
  --agent-architect: #1e40af;
  --agent-frontend: #2563eb;
  --agent-backend: #166534;
  --agent-tester: #7c3aed;
  --agent-reviewer: #b8860b;
  --agent-leader: #4f46e5;
  --agent-pm: #991b1b;
  --agent-researcher: #0891b2;
  --agent-supervisor: #b8860b;
  --agent-badge-text-light: #ffffff;
  --agent-badge-text-dark: #0a0a0a;
}

.badge-agent-architect {
  background-color: var(--agent-architect) !important;
  color: var(--agent-badge-text-light) !important;
}
/* ... repeat for other badges */
```

**Migration Strategy for Prose/Markdown**:

```css
/* BEFORE */
.prose code {
  background-color: #2a2a2a;
  color: #fbbf24;
}

/* AFTER - use DaisyUI semantic colors */
.prose code {
  background-color: oklch(var(--b3)); /* base-300 */
  color: oklch(var(--wa)); /* warning (amber) */
}

.prose pre {
  background-color: oklch(var(--b3));
  border: 1px solid oklch(var(--b2));
}

.prose pre code {
  background-color: transparent;
  color: oklch(var(--bc)); /* base-content */
}

.prose a {
  color: oklch(var(--in)); /* info (blue) */
}
.prose a:hover {
  color: oklch(var(--in) / 0.8);
}

.prose h1,
.prose h2,
.prose h3,
.prose h4,
.prose h5,
.prose h6 {
  color: oklch(var(--s)); /* secondary (gold) */
}

.prose blockquote {
  border-left: 4px solid oklch(var(--s));
  color: oklch(var(--bc) / 0.6);
}

.prose ul,
.prose ol,
.prose strong {
  color: oklch(var(--bc));
}
```

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css` (MODIFY)

---

#### Component 4: Color Migration - TypeScript Components

**Purpose**: Replace hardcoded hex/Tailwind colors in component code

**4.1 tool-icon.component.ts**

```typescript
// BEFORE
case 'Read': return 'text-blue-400';
case 'Write': return 'text-green-400';

// AFTER - use DaisyUI semantic classes
case 'Read': return 'text-info';        // info (blue)
case 'Write': return 'text-success';    // success (green)
case 'Bash': return 'text-warning';     // warning (amber)
case 'Grep': return 'text-secondary';   // secondary (purple in light, gold in dark - adjust)
case 'Edit': return 'text-accent';      // accent
case 'Glob': return 'text-info';        // info (cyan-ish)
default: return 'text-base-content/60';
```

**Alternative approach** - use CSS custom properties for tool colors:
Since tools have specific semantic colors that should be consistent across themes, define them as CSS variables similar to agent badges.

**4.2 permission-request-card.component.ts**

Same approach - use CSS custom properties for tool colors:

```typescript
// Define in styles.css
:root {
  --tool-color-read: #60a5fa;
  --tool-color-write: #4ade80;
  --tool-color-bash: #fbbf24;
  // etc.
}

// In component
protected getToolColor(): string {
  const toolName = this.request().toolName;
  return `var(--tool-color-${toolName.toLowerCase()}, var(--tool-color-default))`;
}
```

**4.3 inline-agent-bubble.component.ts**

Already uses dynamically generated colors. Add theme-aware fallbacks:

```typescript
// Keep dynamic color generation but update default
if (!str) return 'oklch(var(--bc) / 0.5)'; // Theme-aware gray
```

**4.4 Other components (thinking-block, agent-summary, agent-execution)**

Replace Tailwind color classes with DaisyUI semantic classes:

- `text-purple-400` -> `text-secondary` (for thinking/brain icons)
- `text-blue-400` -> `text-info` (for tool/wrench icons)

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\tool-icon.component.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\agent-execution.component.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-summary.component.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\thinking-block.component.ts` (MODIFY)

---

#### Component 5: index.html Fix

**Purpose**: Use correct theme name

```html
<!-- BEFORE -->
<html lang="en" data-theme="ptah">
  <!-- AFTER -->
  <html lang="en" data-theme="anubis"></html>
</html>
```

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\index.html` (MODIFY)

---

## Integration Architecture

### Data Flow

```
User clicks theme toggle
  -> ThemeToggleComponent.toggle()
  -> ThemeService.toggleTheme()
  -> _currentTheme signal updates
  -> effect() applies data-theme to document
  -> DaisyUI CSS variables change
  -> All components using oklch(var(--xxx)) update automatically
  -> ClaudeRpcService persists preference to extension state
```

### Initialization Flow

```
App bootstrap
  -> APP_INITIALIZER (VSCodeService)
  -> ThemeService.initializeTheme()
    -> Try: Load saved preference from extension
    -> Fallback: Use VSCode theme signal
  -> effect() applies initial data-theme
  -> UI renders with correct theme
```

---

## Quality Requirements

### Functional Requirements

- Theme toggle must instantly update all colors (no flicker)
- Theme preference must persist across sessions
- Light theme must have sufficient contrast (WCAG AA)
- Theme must sync with VS Code theme when no preference saved

### Non-Functional Requirements

- **Performance**: No layout shift during theme change
- **Accessibility**: Maintain 4.5:1 contrast ratio in both themes
- **Maintainability**: Single source of truth for theme colors

### Pattern Compliance

- Signal-based state (verified at app-state.service.ts)
- Readonly signal accessors (verified at vscode.service.ts)
- Injectable providedIn: 'root' (verified at multiple services)
- OnPush change detection (verified at all components)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- All changes are Angular components and CSS
- Signal-based service pattern is Angular-specific
- DaisyUI/Tailwind CSS expertise required
- No backend changes needed

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- ThemeService: 1 hour
- ThemeToggleComponent: 30 minutes
- styles.css migration: 1.5 hours
- TypeScript components migration: 1.5 hours
- Testing & verification: 1 hour

### Files Affected Summary

**CREATE**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\theme.service.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\theme-toggle.component.ts`

**MODIFY**:

- `D:\projects\ptah-extension\libs\frontend\core\src\index.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\index.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\index.html`
- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\tool-icon.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\agent-execution.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-summary.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\thinking-block.component.ts`

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `signal`, `computed`, `effect` from `@angular/core`
   - `VSCodeService` from `@ptah-extension/core`
   - `ClaudeRpcService` from `@ptah-extension/core`
   - `Sun`, `Moon` icons from `lucide-angular`

2. **All patterns verified from examples**:

   - Signal-based service: `app-state.service.ts`
   - VSCode integration: `vscode.service.ts`
   - oklch variable usage: `diff-display.component.ts`

3. **DaisyUI variables confirmed in tailwind.config.js**:

   - Both `anubis` and `anubis-light` themes defined
   - All semantic colors available (su, er, wa, in, p, s, a, bc, b1, b2, b3)

4. **No hallucinated APIs**:
   - All DaisyUI classes verified: `text-success`, `text-error`, `text-warning`, `text-info`
   - All oklch variables verified in theme config

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
