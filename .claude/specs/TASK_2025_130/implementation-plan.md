# Implementation Plan - TASK_2025_130

## Sidebar Redesign & Softened Dark Theme ("Faros")

**Author**: Software Architect Agent
**Date**: 2026-02-01
**Status**: Ready for Team-Leader Decomposition

---

## Codebase Investigation Summary

### Files Analyzed

| File                          | Path                                                                                                       | Lines | Key Findings                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tailwind.config.js            | `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js`                                | 163   | Contains `anubis` theme (lines 49-99) and `anubis-light` theme (lines 100-153). DaisyUI v4 theme format.                                                                                                                        |
| styles.css                    | `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`                                    | 1605  | Global styles with glass morphism vars (lines 35-98), scrollbar (lines 363-385), agent badges (lines 466-479), utility classes (lines 1201-1221). Light theme overrides (lines 1471-1600).                                      |
| app-shell.component.html      | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`      | 248   | Sidebar template (lines 37-187). Session list uses `menu menu-sm` DaisyUI classes. Active state uses `bg-primary text-primary-content`. Date uses Angular `DatePipe` with `'M/d HH:mm'` format.                                 |
| app-shell.component.ts        | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`        | 331   | Imports `DatePipe` (line 11, 83). No `formatRelativeDate` exists. Imports Lucide icons: Settings, Plus, Check, X, PanelLeftClose, PanelLeftOpen, PanelRight, ChevronDown, Trash2.                                               |
| message-bubble.component.html | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` | 147   | Reference quality: uses `bg-base-300 text-base-content shadow-card`, `text-xs text-base-content/70`, `opacity-0 group-hover:opacity-100 transition-opacity duration-200`, `badge badge-sm bg-base-200/80 text-base-content/70`. |
| chat-input.component.ts       | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts`       | 809   | Reference quality: uses `bg-base-100`, `textarea-bordered`, `btn btn-primary`, `text-base-content/60`.                                                                                                                          |

### Libraries and Exports Verified

| Item                          | Source                                                             | Verified                                                      |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `MessageSquare` (Lucide icon) | `node_modules\lucide-angular\src\icons\icons\message-square.d.ts`  | YES - exists in lucide-angular                                |
| `DatePipe` usage in app-shell | `app-shell.component.ts:11,83` and `app-shell.component.html:140`  | YES - only used for sidebar date formatting                   |
| `ChatSessionSummary` type     | `@ptah-extension/shared` (imported at `app-shell.component.ts:41`) | YES - includes `lastActivityAt`, `messageCount`, `name`, `id` |

### Hardcoded Color References Found (Must Update)

All instances of old theme colors in `styles.css`:

| Line | Old Value                | Context                                               |
| ---- | ------------------------ | ----------------------------------------------------- |
| 67   | `rgba(42, 42, 42, 0.7)`  | `--glass-panel` variable in `:root`                   |
| 72   | `#1e3a8a`                | `--gradient-divine` in `:root`                        |
| 80   | `rgba(30, 58, 138, 0.1)` | `--gradient-panel` in `:root`                         |
| 86   | `#1e3a8a`                | `--agent-color-thoth` in `:root`                      |
| 87   | `#228b22`                | `--agent-color-ptah` in `:root`                       |
| 88   | `#f5f5dc`                | `--agent-color-seshat` in `:root`                     |
| 90   | `#b22222`                | `--agent-color-khnum` in `:root`                      |
| 370  | `rgba(10, 10, 10, 0.6)`  | Scrollbar track fallback                              |
| 468  | `#1e3a8a`                | `--agent-architect` in `[data-theme='anubis']`        |
| 470  | `#228b22`                | `--agent-backend` in `[data-theme='anubis']`          |
| 474  | `#b22222`                | `--agent-pm` in `[data-theme='anubis']`               |
| 477  | `#f5f5dc`                | `--agent-badge-text-light` in `[data-theme='anubis']` |
| 478  | `#0a0a0a`                | `--agent-badge-text-dark` in `[data-theme='anubis']`  |
| 1212 | `#f5f5dc`                | `.text-papyrus` utility class                         |
| 1220 | `#1e3a8a`                | `.text-lapis` utility class                           |

No hardcoded old colors found in any frontend library TypeScript or HTML files (confirmed via grep across `libs/frontend`).

### Patterns Identified

1. **Styling Pattern**: The polished chat area uses DaisyUI semantic tokens (`bg-base-300`, `text-base-content/70`) combined with Tailwind utilities (`shadow-card`, `transition-opacity duration-200`). No hardcoded hex values in templates.
2. **Component Pattern**: OnPush change detection, signal-based state, standalone components with explicit imports array.
3. **Icon Pattern**: Lucide icons are imported as named exports and exposed as `readonly` class properties (e.g., `readonly Trash2Icon = Trash2;`).
4. **Date Pattern**: Currently uses Angular `DatePipe` as a standalone import in the component's `imports` array.
5. **Light Theme Isolation**: Light theme (`anubis-light`) overrides are in a dedicated `[data-theme='anubis-light']` block (lines 1471-1600). Session-specific styles there reference `.menu-sm li button` (lines 1586-1599).

---

## Architecture Design

### Design Philosophy

**Direct replacement** of existing sidebar styling and theme tokens. No backward compatibility, no versioning. The anubis theme tokens get new values; the sidebar HTML template gets restructured. All changes use existing DaisyUI/Tailwind conventions already established in the codebase (evidence: message-bubble.component.html patterns).

### Layers Affected

| Layer                     | Files                                                | Impact                                                  |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| **Webview App Config**    | `tailwind.config.js`                                 | Theme token values updated                              |
| **Webview Global CSS**    | `styles.css`                                         | Hardcoded colors updated, new sidebar CSS classes added |
| **Frontend Chat Library** | `app-shell.component.html`, `app-shell.component.ts` | Sidebar template rewritten, relative date method added  |

No backend, shared types, or other library changes required.

### Dependency Chain

```
Batch 1 (Foundation) ─── must complete before ──> Batch 2 (Sidebar) ──> Batch 3 (Validation)
   tailwind.config.js                               app-shell.component.html
   styles.css                                        app-shell.component.ts
```

Batch 1 must complete first because the sidebar template uses theme tokens (`bg-base-200`, `bg-base-300/50`, `text-primary`, etc.) that will reference the new color values. If the sidebar is updated before theme tokens change, visual testing during Batch 2 development would show incorrect colors.

---

## Visual Design References

**Design Specifications**: `D:\projects\ptah-extension\task-tracking\TASK_2025_130\visual-design-specification.md`
**Requirements**: `D:\projects\ptah-extension\task-tracking\TASK_2025_130\task-description.md`

All hex values, Tailwind classes, and CSS property specifications in this plan are sourced from the visual design specification.

---

## Batch 1: Theme Softening (Foundation)

### Technical Decisions for Batch 1

- All color changes are applied to the `anubis` theme object only; `anubis-light` remains untouched (per scope exclusion in task-description.md).
- Hardcoded hex fallbacks in `styles.css` are updated to match new token values.
- The `--gradient-panel` rgba value uses new primary (`#2563eb` = `rgb(37, 99, 235)`) instead of old (`#1e3a8a` = `rgb(30, 58, 138)`).
- Light theme override block (`[data-theme='anubis-light']`) at lines 1471-1600 references `.menu-sm li button` for session styling. Since Batch 2 removes `menu-sm` from the sidebar, those light theme selectors will become dead CSS. This is acceptable -- they were styling the old sidebar structure and will no longer match. No active breakage occurs.

### File 1: tailwind.config.js

**Full Path**: `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js`
**Change Type**: MODIFY (replace anubis theme object, lines 49-99)

**What to Change**: Replace the entire `anubis` theme object (lines 49-99) with the softened "Faros" values. The `anubis-light` theme (lines 100-153) and all other config remains unchanged.

**Exact replacement for lines 49-99**:

```javascript
        anubis: {
          // PRIMARY: Bright Blue (visible on dark surfaces)
          primary: '#2563eb',
          'primary-focus': '#1d4ed8',
          'primary-content': '#e8e6e1',

          // SECONDARY: Pharaoh's Gold (unchanged - brand anchor)
          secondary: '#d4af37',
          'secondary-focus': '#92400e',
          'secondary-content': '#131317',

          // ACCENT: Gold Light (unchanged)
          accent: '#fbbf24',
          'accent-focus': '#d4af37',
          'accent-content': '#131317',

          // NEUTRAL: Blue-tinted dark (distinct from base-200)
          neutral: '#1e1e26',
          'neutral-focus': '#2a2a34',
          'neutral-content': '#d1d5db',

          // BASE: Softened background hierarchy (blue-tinted charcoal)
          'base-100': '#131317',
          'base-200': '#1a1a20',
          'base-300': '#242430',
          'base-content': '#e8e6e1',

          // SEMANTIC COLORS
          info: '#3b82f6',
          'info-content': '#e8e6e1',

          success: '#16a34a',
          'success-content': '#e8e6e1',

          warning: '#fbbf24',
          'warning-content': '#131317',

          error: '#dc2626',
          'error-content': '#e8e6e1',

          // DAISYUI CUSTOM PROPERTIES (unchanged)
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.375rem',
          '--rounded-badge': '0.25rem',
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
          '--btn-focus-scale': '1.02',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
```

**Token change summary**:

| Token               | Old       | New       | Why                                                                 |
| ------------------- | --------- | --------- | ------------------------------------------------------------------- |
| `primary`           | `#1e3a8a` | `#2563eb` | Brighter blue visible on dark surfaces (4.2:1 contrast vs base-100) |
| `primary-focus`     | `#1e40af` | `#1d4ed8` | Darker blue for focus states                                        |
| `primary-content`   | `#f5f5dc` | `#e8e6e1` | Warm off-white replaces harsh cream                                 |
| `secondary-content` | `#0a0a0a` | `#131317` | Dark text updated to match new base-100                             |
| `accent-content`    | `#0a0a0a` | `#131317` | Dark text updated to match new base-100                             |
| `neutral`           | `#1a1a1a` | `#1e1e26` | Blue-tinted, distinct from base-200                                 |
| `neutral-focus`     | `#2a2a2a` | `#2a2a34` | Blue-tinted focused state                                           |
| `base-100`          | `#0a0a0a` | `#131317` | Soft dark with blue undertone                                       |
| `base-200`          | `#1a1a1a` | `#1a1a20` | Subtle elevation step                                               |
| `base-300`          | `#2a2a2a` | `#242430` | Clear elevation distinction                                         |
| `base-content`      | `#f5f5dc` | `#e8e6e1` | Warm stone-gray, less yellow                                        |
| `info-content`      | `#f5f5dc` | `#e8e6e1` | Match base-content                                                  |
| `success`           | `#228b22` | `#16a34a` | Brighter green (4.7:1 contrast)                                     |
| `success-content`   | `#f5f5dc` | `#e8e6e1` | Match base-content                                                  |
| `warning-content`   | `#0a0a0a` | `#131317` | Dark text updated                                                   |
| `error`             | `#b22222` | `#dc2626` | Brighter red (4.6:1 contrast)                                       |
| `error-content`     | `#f5f5dc` | `#e8e6e1` | Match base-content                                                  |

Tokens NOT changed: `secondary`, `secondary-focus`, `accent`, `accent-focus`, `info`, `warning`, `neutral-content`, and all `--rounded-*`, `--animation-*`, `--btn-focus-scale`, `--border-btn`, `--tab-border`, `--tab-radius` custom properties.

---

### File 2: styles.css

**Full Path**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Change Type**: MODIFY (update hardcoded colors + add new sidebar CSS classes)

#### Change Set 2a: Glass Morphism Variable (Line 67)

**Old** (line 67):

```css
--glass-panel: rgba(42, 42, 42, 0.7);
```

**New**:

```css
--glass-panel: rgba(36, 36, 48, 0.7);
```

**Why**: Updated to match new base-300 (`#242430` = rgb(36, 36, 48)).

#### Change Set 2b: Divine Gradient (Line 72)

**Old** (line 72):

```css
--gradient-divine: linear-gradient(135deg, #1e3a8a, #d4af37);
```

**New**:

```css
--gradient-divine: linear-gradient(135deg, #2563eb, #d4af37);
```

**Why**: Updated to match new primary (`#2563eb`).

#### Change Set 2c: Gradient Panel (Lines 78-82)

**Old** (lines 78-82):

```css
--gradient-panel: linear-gradient(135deg, rgba(30, 58, 138, 0.1), rgba(212, 175, 55, 0.05));
```

**New**:

```css
--gradient-panel: linear-gradient(135deg, rgba(37, 99, 235, 0.1), rgba(212, 175, 55, 0.05));
```

**Why**: Updated rgba to match new primary (`#2563eb` = rgb(37, 99, 235)).

#### Change Set 2d: Agent Color Variables (Lines 86-90)

**Old** (lines 86-90):

```css
--agent-color-thoth: #1e3a8a; /* Architect - Blue */
--agent-color-ptah: #228b22; /* Developer - Green */
--agent-color-seshat: #f5f5dc; /* QA - White */
--agent-color-maat: #d4af37; /* Reviewer - Gold */
--agent-color-khnum: #b22222; /* PM - Red */
```

**New**:

```css
--agent-color-thoth: #2563eb; /* Architect - Blue */
--agent-color-ptah: #16a34a; /* Developer - Green */
--agent-color-seshat: #e8e6e1; /* QA - White */
--agent-color-maat: #d4af37; /* Reviewer - Gold */
--agent-color-khnum: #dc2626; /* PM - Red */
```

**Why**: Aligned with new primary, success, base-content, and error token values.

#### Change Set 2e: Scrollbar Track Fallback (Line 370)

**Old** (line 370):

```css
background: rgba(10, 10, 10, 0.6);
```

**New**:

```css
background: rgba(19, 19, 23, 0.6);
```

**Why**: Updated to match new base-100 (`#131317` = rgb(19, 19, 23)). The oklch line below it (line 371) uses a DaisyUI variable and needs no change.

#### Change Set 2f: Agent Badge Colors in Dark Theme Block (Lines 468-478)

**Old** (lines 468-478):

```css
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
```

**New**:

```css
--agent-architect: #2563eb;
--agent-frontend: #3b82f6;
--agent-backend: #16a34a;
--agent-tester: #8b5cf6;
--agent-reviewer: #d4af37;
--agent-leader: #6366f1;
--agent-pm: #dc2626;
--agent-researcher: #06b6d4;
--agent-supervisor: #d4af37;
--agent-badge-text-light: #e8e6e1;
--agent-badge-text-dark: #131317;
```

**Why**: `--agent-architect` aligned with new primary. `--agent-backend` aligned with new success. `--agent-pm` aligned with new error. `--agent-badge-text-light` aligned with new base-content. `--agent-badge-text-dark` aligned with new base-100. Other agent colors (`--agent-frontend`, `--agent-tester`, `--agent-reviewer`, `--agent-leader`, `--agent-researcher`, `--agent-supervisor`) remain unchanged.

#### Change Set 2g: Utility Classes (Lines 1211-1221)

**Old** (lines 1211-1213):

```css
.text-papyrus {
  color: #f5f5dc;
}
```

**New**:

```css
.text-papyrus {
  color: #e8e6e1;
}
```

**Old** (lines 1219-1221):

```css
.text-lapis {
  color: #1e3a8a;
}
```

**New**:

```css
.text-lapis {
  color: #2563eb;
}
```

**Why**: Aligned with new base-content and primary values.

#### Change Set 2h: New Sidebar CSS Classes (Add After Line 1601)

Insert the following block **before** the final `/* END OF ANUBIS DESIGN SYSTEM */` comment (currently at line 1602-1604). The new block should go between the end of the light theme section and the closing comment.

```css
/* ============================================================================
SIDEBAR SESSION LIST STYLES - TASK_2025_130
============================================================================ */

/* Active session in sidebar */
.sidebar-item-active {
  background-color: oklch(var(--b3) / 0.7);
  border-left-color: oklch(var(--p));
}

/* Session with open tab (but not active) */
.sidebar-item-open-tab {
  border-left-color: oklch(var(--p) / 0.3);
}

/* Sidebar-specific thin scrollbar (only visible on aside hover) */
.sidebar-scroll::-webkit-scrollbar {
  width: 4px;
}

.sidebar-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-scroll::-webkit-scrollbar-thumb {
  background-color: oklch(var(--bc) / 0.15);
  border-radius: 9999px;
}

.sidebar-scroll::-webkit-scrollbar-thumb:hover {
  background-color: oklch(var(--bc) / 0.25);
}

/* Hide scrollbar until sidebar is hovered */
aside:not(:hover) .sidebar-scroll::-webkit-scrollbar-thumb {
  background-color: transparent;
}
```

**Why**: These CSS classes support the sidebar redesign in Batch 2:

- `.sidebar-item-active` applies the active session visual state (bg + left border) via a single class toggle instead of multiple `[class.xxx]` bindings.
- `.sidebar-item-open-tab` applies the open-tab visual state (faded left border).
- `.sidebar-scroll` and related rules create a thin, auto-hiding scrollbar for the session list.
- Uses `oklch(var(--b3))` and `oklch(var(--p))` DaisyUI CSS variables, so colors automatically follow theme tokens.

---

## Batch 2: Sidebar Redesign

### Technical Decisions for Batch 2

1. **Relative date formatting**: Implemented as a **pure method on the component class** (`formatRelativeDate()`), not an Angular pipe. Rationale: (a) It is used only in this one template, (b) creating a standalone pipe would add a new file plus module registration, (c) the method is a simple pure function with no dependencies. This matches the existing `getSessionDisplayName()` pattern on the same component (line 239-266 of app-shell.component.ts).

2. **Sidebar-specific CSS classes vs inline Tailwind**: The active/open-tab states use CSS classes (`.sidebar-item-active`, `.sidebar-item-open-tab`) defined in styles.css (Batch 1, Change Set 2h) rather than multiple inline `[class.xxx]` bindings. This keeps the template clean. The hover state uses inline Tailwind (`hover:bg-base-300/50`) since it is a single property.

3. **DaisyUI menu removal**: The current `<ul class="menu menu-sm">` is replaced with `<ul class="flex flex-col gap-0.5 p-0" role="list">`. The DaisyUI `menu` and `menu-sm` classes inject default padding, font-size, hover, and focus styles that conflict with our custom session item design. Raw flexbox gives full control.

4. **DatePipe removal**: `DatePipe` is removed from the component's `imports` array since the template no longer uses the `| date` pipe. It is also removed from the import statement at the top of the file.

5. **MessageSquare icon**: `MessageSquare` is imported from `lucide-angular` for the empty state. Verified to exist at `node_modules\lucide-angular\src\icons\icons\message-square.d.ts`.

### File 3: app-shell.component.html

**Full Path**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`
**Change Type**: MODIFY (rewrite sidebar section, lines 37-187)

The sidebar section is enclosed within `<aside>...</aside>` (lines 37-187). Only this section changes. Everything above line 37 and below line 187 (the main content area, header, etc.) remains unchanged.

#### Change 3a: Sidebar Container (Line 37-42)

**Old** (lines 37-42):

```html
<aside class="flex flex-col bg-base-200 border-r border-base-300" [class.w-0]="!sidebarOpen()" [class.w-52]="sidebarOpen()" [class.overflow-hidden]="!sidebarOpen()"></aside>
```

**New**:

```html
<aside class="flex flex-col bg-base-200 border-r border-base-content/5 transition-all duration-300" [class.w-0]="!sidebarOpen()" [class.w-56]="sidebarOpen()" [class.overflow-hidden]="!sidebarOpen()"></aside>
```

**Changes**:

- `border-base-300` changed to `border-base-content/5` (nearly invisible separator)
- `w-52` changed to `w-56` (224px instead of 208px for better text display)
- Added `transition-all duration-300` for smooth open/close animation

#### Change 3b: Sidebar Header (Lines 44-107)

**Old** (lines 44-107):

```html
<div class="p-2 border-b border-base-300 flex items-center justify-between">
  <!-- Ptah icon -->
  <img [ngSrc]="ptahIconUri" alt="Ptah" class="w-6 h-6 flex-shrink-0" width="24" height="24" />

  <!-- New session popover -->
  <ptah-native-popover [isOpen]="sessionNamePopoverOpen()" [placement]="'bottom'" [hasBackdrop]="true" [backdropClass]="'transparent'" (closed)="handleCancelSession()">
    <!-- Trigger: New Session button -->
    <button trigger class="btn btn-primary btn-sm btn-square flex-shrink-0" (click)="createNewSession()" aria-label="New Session" title="New Session">
      <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
    </button>

    <!-- Popover content -->
    <div content class="p-4 w-80">
      <h3 class="text-sm font-semibold mb-3">New Session</h3>

      <!-- Input field with Enter/ESC keyboard support -->
      <input #sessionNameInputRef type="text" class="input input-bordered input-sm w-full mb-3" placeholder="Enter session name (optional)" [(ngModel)]="sessionNameInput" (keydown.enter)="handleCreateSession()" (keydown.escape)="handleCancelSession()" />

      <!-- Action buttons -->
      <div class="flex gap-2">
        <button class="btn btn-sm btn-ghost flex-1 gap-1.5" (click)="handleCancelSession()">
          <lucide-angular [img]="XIcon" class="w-3 h-3" />
          Cancel
        </button>
        <button class="btn btn-sm btn-primary flex-1 gap-1.5" (click)="handleCreateSession()">
          <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
          Create
        </button>
      </div>
    </div>
  </ptah-native-popover>
</div>
```

**New**:

```html
<div class="p-3 border-b border-base-content/10 flex items-center justify-between">
  <!-- Ptah icon -->
  <img [ngSrc]="ptahIconUri" alt="Ptah" class="w-5 h-5 flex-shrink-0 opacity-80" width="20" height="20" />

  <!-- New session popover -->
  <ptah-native-popover [isOpen]="sessionNamePopoverOpen()" [placement]="'bottom'" [hasBackdrop]="true" [backdropClass]="'transparent'" (closed)="handleCancelSession()">
    <!-- Trigger: New Session button (ghost style, not primary) -->
    <button trigger class="btn btn-ghost btn-sm btn-square rounded-lg text-base-content/60 hover:text-primary hover:bg-base-300/50 transition-all duration-200" (click)="createNewSession()" aria-label="New Session" title="New Session">
      <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
    </button>

    <!-- Popover content -->
    <div content class="p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg">
      <h3 class="text-sm font-semibold mb-3 text-base-content/90">New Session</h3>

      <!-- Input field with Enter/ESC keyboard support -->
      <input #sessionNameInputRef type="text" class="input input-sm input-bordered w-full mb-3 bg-base-100 border-base-content/10 focus:border-primary" placeholder="Enter session name (optional)" [(ngModel)]="sessionNameInput" (keydown.enter)="handleCreateSession()" (keydown.escape)="handleCancelSession()" />

      <!-- Action buttons -->
      <div class="flex gap-2">
        <button class="btn btn-sm btn-ghost flex-1 gap-1.5 text-base-content/60" (click)="handleCancelSession()">
          <lucide-angular [img]="XIcon" class="w-3 h-3" />
          Cancel
        </button>
        <button class="btn btn-sm btn-primary flex-1 gap-1.5" (click)="handleCreateSession()">
          <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
          Create
        </button>
      </div>
    </div>
  </ptah-native-popover>
</div>
```

**Changes**:

- Header padding: `p-2` to `p-3`
- Border: `border-b border-base-300` to `border-b border-base-content/10`
- Icon: `w-6 h-6` to `w-5 h-5 opacity-80`, `width="24" height="24"` to `width="20" height="20"`
- New session button: `btn btn-primary btn-sm btn-square flex-shrink-0` to `btn btn-ghost btn-sm btn-square rounded-lg text-base-content/60 hover:text-primary hover:bg-base-300/50 transition-all duration-200`
- Plus icon: `w-3.5 h-3.5` to `w-4 h-4`
- Popover: `p-4 w-80` to `p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg`
- Popover title: added `text-base-content/90`
- Input: `input input-bordered input-sm w-full mb-3` to `input input-sm input-bordered w-full mb-3 bg-base-100 border-base-content/10 focus:border-primary`
- Cancel button: added `text-base-content/60`

#### Change 3c: Session List Container (Lines 109-111)

**Old** (lines 109-111):

```html
<div class="flex-1 overflow-y-auto p-1">
  <ul class="menu menu-sm p-0 gap-0.5"></ul>
</div>
```

**New**:

```html
<div class="flex-1 overflow-y-auto p-1.5 sidebar-scroll">
  <ul class="flex flex-col gap-0.5 p-0" role="list"></ul>
</div>
```

**Changes**:

- Container: `p-1` to `p-1.5 sidebar-scroll`
- List: `menu menu-sm p-0 gap-0.5` to `flex flex-col gap-0.5 p-0` with `role="list"`

#### Change 3d: Session List Item (Lines 112-158)

**Old** (lines 112-158):

```html
@for (session of chatStore.sessions(); track session.id) {
<li class="group relative">
  <button
    type="button"
    class="flex flex-col items-start gap-0.5 py-1.5 px-2 pr-7 w-full text-left rounded-lg border border-transparent"
    [class.active]="session.id === chatStore.currentSession()?.id"
    [class.bg-primary]="session.id === chatStore.currentSession()?.id"
    [class.text-primary-content]="
              session.id === chatStore.currentSession()?.id
            "
    [class.border-primary!]="isSessionOpen(session.id)"
    [class.text-primary]="
              isSessionOpen(session.id) &&
              session.id !== chatStore.currentSession()?.id
            "
    (click)="chatStore.switchSession(session.id)"
  >
    <!-- Session title -->
    <span class="font-medium text-xs truncate w-full leading-tight" [title]="session.name"> {{ getSessionDisplayName(session) }} </span>
    <!-- Session metadata -->
    <span class="text-[10px] opacity-60 flex items-center gap-1.5 w-full">
      <span>{{ session.lastActivityAt | date : 'M/d HH:mm' }}</span>
      @if (session.messageCount > 0) {
      <span class="badge badge-xs badge-ghost px-1"> {{ session.messageCount }} msgs </span>
      }
    </span>
  </button>
  <!-- Delete button (appears on hover) -->
  <button type="button" class="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100 transition-opacity hover:text-error" title="Delete session" aria-label="Delete session" (click)="deleteSession($event, session)">
    <lucide-angular [img]="Trash2Icon" class="w-3 h-3" />
  </button>
</li>
}
```

**New**:

```html
@for (session of chatStore.sessions(); track session.id) {
<li class="group relative" role="listitem">
  <button type="button" class="flex flex-col items-start gap-1 py-2.5 px-3 pr-8 w-full text-left rounded-md transition-all duration-200 border-l-2 border-transparent hover:bg-base-300/50" [class.sidebar-item-active]="session.id === chatStore.currentSession()?.id" [class.sidebar-item-open-tab]="isSessionOpen(session.id) && session.id !== chatStore.currentSession()?.id" (click)="chatStore.switchSession(session.id)">
    <!-- Session name -->
    <span class="font-medium text-sm truncate w-full leading-snug" [class.text-primary]="session.id === chatStore.currentSession()?.id || isSessionOpen(session.id)" [title]="session.name"> {{ getSessionDisplayName(session) }} </span>
    <!-- Session metadata row -->
    <span class="text-xs text-base-content/50 flex items-center gap-2 w-full">
      <span>{{ formatRelativeDate(session.lastActivityAt) }}</span>
      @if (session.messageCount > 0) {
      <span class="text-base-content/40">{{ session.messageCount }} msgs</span>
      }
    </span>
  </button>
  <!-- Delete button (hover reveal) -->
  <button type="button" class="absolute right-1.5 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-square rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-base-content/40 hover:text-error hover:bg-error/10" title="Delete session" [attr.aria-label]="'Delete session: ' + getSessionDisplayName(session)" (click)="deleteSession($event, session)">
    <lucide-angular [img]="Trash2Icon" class="w-3.5 h-3.5" />
  </button>
</li>
}
```

**Changes summary** (per visual-design-specification.md Section 2.4):

- `<li>`: added `role="listitem"`
- Button base classes: `gap-0.5 py-1.5 px-2 pr-7 rounded-lg border border-transparent` to `gap-1 py-2.5 px-3 pr-8 rounded-md transition-all duration-200 border-l-2 border-transparent hover:bg-base-300/50`
- Active state: removed `[class.active]`, `[class.bg-primary]`, `[class.text-primary-content]` -- replaced with `[class.sidebar-item-active]`
- Open tab state: removed `[class.border-primary!]` and separate `[class.text-primary]` -- replaced with `[class.sidebar-item-open-tab]`
- Session name: `font-medium text-xs truncate w-full leading-tight` to `font-medium text-sm truncate w-full leading-snug` with `[class.text-primary]` for active/open-tab
- Metadata: `text-[10px] opacity-60 flex items-center gap-1.5` to `text-xs text-base-content/50 flex items-center gap-2`
- Date: `{{ session.lastActivityAt | date : 'M/d HH:mm' }}` to `{{ formatRelativeDate(session.lastActivityAt) }}`
- Message count: removed `badge badge-xs badge-ghost px-1` wrapper, replaced with inline `text-base-content/40`
- Delete button: `right-1` to `right-1.5`, added `rounded duration-200 text-base-content/40 hover:bg-error/10`, icon `w-3 h-3` to `w-3.5 h-3.5`, aria-label now dynamic

#### Change 3e: Empty State (Lines 159-163)

**Old** (lines 159-163):

```html
} @empty {
<li class="p-3 text-center text-xs text-base-content/50">No sessions yet</li>
}
```

**New**:

```html
} @empty {
<li class="flex flex-col items-center justify-center p-6 text-center" role="listitem">
  <lucide-angular [img]="MessageSquareIcon" class="w-8 h-8 text-base-content/20 mb-2" />
  <span class="text-sm text-base-content/40">No sessions yet</span>
  <span class="text-xs text-base-content/25 mt-1">Create one to get started</span>
</li>
}
```

**Changes**:

- Padding: `p-3` to `p-6`
- Layout: added `flex flex-col items-center justify-center` + `role="listitem"`
- Added `MessageSquareIcon` icon (requires new import in TS)
- Text: `text-xs text-base-content/50` to `text-sm text-base-content/40`
- Added helper text below

#### Change 3f: Load More Button (Lines 166-185)

**Old** (lines 166-185):

```html
@if (chatStore.hasMoreSessions()) {
<div class="p-2 pt-1">
  <button class="btn btn-ghost btn-xs w-full" [class.loading]="chatStore.isLoadingMoreSessions()" [disabled]="chatStore.isLoadingMoreSessions()" (click)="chatStore.loadMoreSessions()">
    @if (chatStore.isLoadingMoreSessions()) {
    <span class="loading loading-spinner loading-xs"></span>
    Loading... } @else {
    <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
    Load More ({{ chatStore.totalSessions() - chatStore.sessions().length }} more) }
  </button>
</div>
}
```

**New**:

```html
@if (chatStore.hasMoreSessions()) {
<div class="px-1.5 pt-1 pb-1">
  <button class="btn btn-ghost btn-xs w-full text-base-content/50 hover:text-base-content/70 hover:bg-base-300/30 transition-all duration-200 gap-1" [class.loading]="chatStore.isLoadingMoreSessions()" [disabled]="chatStore.isLoadingMoreSessions()" (click)="chatStore.loadMoreSessions()">
    @if (chatStore.isLoadingMoreSessions()) {
    <span class="loading loading-spinner loading-xs"></span>
    Loading... } @else {
    <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
    Load More
    <span class="text-base-content/30">({{ chatStore.totalSessions() - chatStore.sessions().length }})</span>
    }
  </button>
</div>
}
```

**Changes**:

- Container: `p-2 pt-1` to `px-1.5 pt-1 pb-1`
- Button: added `text-base-content/50 hover:text-base-content/70 hover:bg-base-300/30 transition-all duration-200 gap-1`
- Remaining count: wrapped in `<span class="text-base-content/30">` and reformatted

#### Change 3g: Closing `</ul>` and `</div>` remain unchanged (lines 164-186)

No changes needed to the closing tags structure.

---

### File 4: app-shell.component.ts

**Full Path**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`
**Change Type**: MODIFY (add formatRelativeDate method, add MessageSquare icon, remove DatePipe)

#### Change 4a: Import Statement (Line 11)

**Old** (line 11):

```typescript
import { DatePipe, NgOptimizedImage } from '@angular/common';
```

**New**:

```typescript
import { NgOptimizedImage } from '@angular/common';
```

**Why**: `DatePipe` is no longer used in the template. Removed from import.

#### Change 4b: Lucide Imports (Lines 13-24)

**Old** (lines 13-24):

```typescript
import { LucideAngularModule, Settings, Plus, PanelLeftClose, PanelLeftOpen, PanelRight, ChevronDown, Check, X, Trash2 } from 'lucide-angular';
```

**New**:

```typescript
import { LucideAngularModule, Settings, Plus, PanelLeftClose, PanelLeftOpen, PanelRight, ChevronDown, Check, X, Trash2, MessageSquare } from 'lucide-angular';
```

**Why**: Added `MessageSquare` for the empty state icon. Verified to exist in `lucide-angular` exports.

#### Change 4c: Component Imports Array (Lines 75-88)

**Old** (lines 75-88):

```typescript
  imports: [
    ChatViewComponent,
    SettingsComponent,
    WelcomeComponent,
    WizardViewComponent,
    TabBarComponent,
    ConfirmationDialogComponent,
    ThemeToggleComponent,
    DatePipe,
    NgOptimizedImage,
    LucideAngularModule,
    FormsModule,
    NativePopoverComponent,
  ],
```

**New**:

```typescript
  imports: [
    ChatViewComponent,
    SettingsComponent,
    WelcomeComponent,
    WizardViewComponent,
    TabBarComponent,
    ConfirmationDialogComponent,
    ThemeToggleComponent,
    NgOptimizedImage,
    LucideAngularModule,
    FormsModule,
    NativePopoverComponent,
  ],
```

**Why**: Removed `DatePipe` from imports since the template no longer uses the `| date` pipe.

#### Change 4d: Icon Property (After line 119)

**Add** after the existing `readonly Trash2Icon = Trash2;` line (line 119):

```typescript
  readonly MessageSquareIcon = MessageSquare;
```

**Why**: Exposed for use in the empty state template.

#### Change 4e: formatRelativeDate Method (Add before `getSessionDisplayName`)

**Add** the following method before the `getSessionDisplayName` method (which starts at line 239). Insert it around line 234 (after `handleCancelSession`):

```typescript
  /**
   * Format timestamp as relative date for sidebar display.
   * Pure function - no side effects, no dependencies.
   *
   * Rules:
   *   < 1 minute:    "Just now"
   *   < 1 hour:      "Xm ago"    (e.g., "5m ago")
   *   < 24 hours:    "Xh ago"    (e.g., "2h ago")
   *   Yesterday:     "Yesterday"
   *   Current week:  "Mon", "Tue", etc.
   *   Current year:  "Jan 15"
   *   Previous year: "Jan 15, 2025"
   */
  formatRelativeDate(date: Date | string): string {
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

    // Current week: show day name
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    }

    // Current year: "Jan 15"
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // Previous year: "Jan 15, 2025"
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
```

**Why**: Replaces the `DatePipe`-based `'M/d HH:mm'` format with user-friendly relative dates ("Just now", "5m ago", "Yesterday", etc.). This is a pure function with no side effects or dependencies -- it computes the relative time based on `Date.now()` delta.

**Note on change detection**: This method is called in the template for each session item on every change detection cycle. Since `ChangeDetectionStrategy.OnPush` is used and the component only re-renders when signals change, this is acceptable for the expected session count (<100 items). No pipe caching is needed.

---

## Batch 3: Validation and Polish

### Purpose

Batch 3 is a verification pass to ensure theme changes do not break existing components. No new code is written -- this is a review and potential adjustment phase.

### Verification Checklist

The developer should verify the following after Batches 1 and 2 are complete:

#### Theme Consistency Checks

1. **Chat bubbles** (`message-bubble.component.html`): Verify `bg-base-300 text-base-content` looks correct with new `#242430` and `#e8e6e1` values. The assistant bubble should have clear elevation above `bg-base-100`.

2. **User message bubbles**: Verify `bg-primary text-primary-content` looks correct with new `#2563eb` and `#e8e6e1`. The blue should be clearly visible, not too dark.

3. **Chat input area** (`chat-input.component.ts`): Verify `textarea-bordered` and `btn btn-primary` look correct. The textarea border should be visible against `bg-base-100`.

4. **File attachment badges**: Verify `badge badge-sm bg-base-200/80 text-base-content/70` in message-bubble.component.html has sufficient contrast.

5. **Error button** (`btn btn-error`): Verify the stop button in chat-input uses new `#dc2626` and is clearly visible.

6. **Gold accents**: Verify `text-secondary` (gold `#d4af37`) and `text-accent` (amber `#fbbf24`) still look correct on new base surfaces. These should be unchanged but visual verification is needed.

7. **Glass morphism**: Verify `glass-panel` class still creates a visible translucent effect with the updated `rgba(36, 36, 48, 0.7)` value.

8. **Markdown prose**: Verify code blocks (`bg-base-300`), blockquotes (`bg-base-200/0.3`), and inline code (`bg-base-300/0.7`) render with proper contrast.

9. **Agent badges**: Verify all `.badge-agent-*` classes display correctly with updated `--agent-*` CSS variables. Especially check `badge-agent-architect` (now `#2563eb`), `badge-agent-backend` (now `#16a34a`), and `badge-agent-pm` (now `#dc2626`).

10. **Scrollbar**: Verify global scrollbar (8px, gold-tinted) still works correctly on the chat message list. Verify sidebar scrollbar (4px, base-content-tinted) works correctly on the session list.

#### Sidebar-Specific Checks

11. **Active session**: Verify `.sidebar-item-active` applies correctly -- left blue border + bg-base-300/70 background.

12. **Open tab session**: Verify `.sidebar-item-open-tab` applies correctly -- faded left border, primary text.

13. **Hover state**: Verify `hover:bg-base-300/50` creates a visible but subtle background change.

14. **Delete button reveal**: Verify delete button fades in on hover and turns red (`hover:text-error hover:bg-error/10`) on its own hover.

15. **Empty state**: Verify `MessageSquareIcon` renders at correct size with very muted color.

16. **Load more button**: Verify remaining count is visible in muted text.

17. **Popover**: Verify new session popover has `bg-base-200` background, `shadow-lg` elevation, and `rounded-xl` corners.

18. **Sidebar width**: Verify `w-56` (224px) does not cause layout issues at minimum VS Code sidebar width.

19. **Sidebar toggle**: Verify smooth `w-0` to `w-56` transition with `transition-all duration-300`.

#### Contrast Ratio Checks

20. **Body text on base-100**: `#e8e6e1` on `#131317` should be approximately 13.2:1 (AAA).
21. **Body text on base-200**: `#e8e6e1` on `#1a1a20` should be approximately 11.6:1 (AAA).
22. **Body text on base-300**: `#e8e6e1` on `#242430` should be approximately 9.3:1 (AAA).
23. **Primary on base-100**: `#2563eb` on `#131317` should be approximately 4.2:1 (AA for UI components).
24. **Error on base-100**: `#dc2626` on `#131317` should be approximately 4.6:1 (AA).
25. **Muted text**: `#e8e6e1` at 50% on `#131317` should be approximately 6.7:1 (AA).

#### Cross-View Checks

26. **Settings page**: Open settings and verify it looks correct with softened theme.
27. **Welcome page**: Open welcome view and verify it looks correct.
28. **Dashboard**: If accessible, verify dashboard charts and cards work with new colors.
29. **Theme toggle**: Switch to `anubis-light` and back to `anubis`. Verify both themes apply correctly and no flash of unstyled content occurs.

#### Light Theme Non-Regression

30. **Light theme isolation**: Verify the `anubis-light` theme is completely unaffected. The light theme selectors referencing `.menu-sm li button` (styles.css lines 1586-1599) will become dead selectors after removing `menu-sm`, but this does not cause any visual regression in light theme -- those selectors simply won't match anything.

### Potential Adjustments

If any verification check fails, the developer should:

1. **Contrast issue**: Adjust the specific opacity value (e.g., `/50` to `/60`) to achieve sufficient contrast.
2. **Glass morphism too dark/light**: Adjust the alpha value in `--glass-panel` (currently `0.7`).
3. **Primary too bright on base-300**: This is unlikely given the 4.2:1 ratio, but if visually jarring, could reduce to `#2452cc` (between old and new).
4. **Sidebar too wide**: If `w-56` causes issues, can revert to `w-52` or use `w-54`.

---

## Risk Mitigations

### Risk 1: Theme changes break chat area

**Mitigation**: Batch 1 only changes DaisyUI theme token values and CSS custom properties. All existing components reference these tokens via class names (`bg-base-300`, `text-base-content`, etc.), so they automatically pick up the new colors. The WCAG contrast ratios in the visual design spec have been pre-calculated for all common combinations. Batch 3 verification confirms no regression.

### Risk 2: Light theme (anubis-light) affected

**Mitigation**: All Batch 1 changes target only the `anubis` theme object in tailwind.config.js. The `anubis-light` theme object is explicitly not modified. CSS custom property changes in styles.css target the `:root` block (which applies to dark theme by default) and the `:root, [data-theme='anubis']` block. The `[data-theme='anubis-light']` blocks are untouched. The only subtle impact is that light theme selectors `.menu-sm li button` (styles.css lines 1586-1599) become dead selectors after `menu-sm` removal in Batch 2, but this causes zero visual effect since those selectors simply won't match.

### Risk 3: VS Code webview compatibility

**Mitigation**: All styling uses standard CSS (Tailwind utilities, DaisyUI components, CSS custom properties with oklch). The VS Code webview uses Chromium, which has full support for oklch, CSS transitions, and ::-webkit-scrollbar. No experimental or non-standard CSS is introduced.

### Risk 4: Sidebar width increase causes layout issues

**Mitigation**: The sidebar increases from `w-52` (208px) to `w-56` (224px) -- a 16px increase. The sidebar is already collapsible (`w-0` when closed), so width only matters when open. The minimum VS Code sidebar width is approximately 200px, and the sidebar is inside the webview which is itself inside the VS Code panel. The main content area uses `flex-1 min-w-0` (line 190) which will shrink to accommodate. If issues arise, reverting to `w-52` or using `w-54` is a trivial change.

### Risk 5: formatRelativeDate performance

**Mitigation**: The method creates a few `Date` objects and performs simple arithmetic. With OnPush change detection, it only runs when the session list signal changes. For 50 sessions, this is ~50 simple function calls -- negligible overhead.

---

## Testing Strategy

### Visual Regression

1. Open the extension in VS Code with the dark theme (`anubis`).
2. Open the sidebar (click the sidebar toggle button).
3. Verify the theme softening across all visible elements.
4. Create a new session and verify the popover styling.
5. Switch between sessions and verify active/hover/open-tab states.
6. Scroll the session list and verify the thin scrollbar behavior.
7. Delete a session and verify the delete button hover state (red tint).
8. Toggle the sidebar open/closed and verify smooth animation.
9. Switch to light theme and verify no regression.
10. Switch back to dark theme.

### Key Components to Verify

| Component                            | What to Check                                |
| ------------------------------------ | -------------------------------------------- |
| `message-bubble.component.html`      | Chat bubble colors (bg-base-300, bg-primary) |
| `chat-input.component.ts`            | Input area, send button, stop button         |
| `session-stats-summary.component.ts` | Stat badges contrast                         |
| `chat-empty-state.component.ts`      | Empty state text visibility                  |
| `tab-bar.component.ts`               | Tab text and active indicator                |
| `model-selector.component.ts`        | Dropdown visibility                          |
| `settings.component.ts`              | Settings page elements                       |
| `auth-config.component.ts`           | Auth badges and inputs                       |

### Contrast Ratio Validation

Use browser DevTools (Inspect Element > Computed Styles > check contrast) or an online tool (WebAIM Contrast Checker) to verify:

- Body text (`#e8e6e1`) on base-100 (`#131317`): target >= 7:1
- Primary (`#2563eb`) on base-100 (`#131317`): target >= 3:1
- Error (`#dc2626`) on base-100 (`#131317`): target >= 3:1
- Muted text at 50% opacity on base-100: target >= 4.5:1

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- All changes are in the Angular webview application and frontend chat library
- Work involves Tailwind/DaisyUI styling, Angular templates, and TypeScript component logic
- No backend, shared types, or VS Code extension host changes
- Requires visual judgment for theme verification

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 3-5 hours across all batches

**Breakdown**:

- Batch 1 (Theme Softening): ~1-2 hours (mechanical find-and-replace of color values)
- Batch 2 (Sidebar Redesign): ~1.5-2 hours (template rewrite, new method, import changes)
- Batch 3 (Validation): ~0.5-1 hour (visual verification, potential adjustments)

### Files Affected Summary

**MODIFY** (4 files):

| File                     | Path                                                                                                  | Batch |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ----- |
| tailwind.config.js       | `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js`                           | 1     |
| styles.css               | `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`                               | 1     |
| app-shell.component.html | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html` | 2     |
| app-shell.component.ts   | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`   | 2     |

**REVIEW ONLY** (verification in Batch 3, no code changes expected):

| File                               | Path                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| message-bubble.component.html      | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html`      |
| chat-input.component.ts            | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts`            |
| chat-empty-state.component.ts      | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-empty-state.component.ts`      |
| session-stats-summary.component.ts | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session-stats-summary.component.ts` |

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All Lucide icon imports exist**:

   - `MessageSquare` from `lucide-angular` (verified: `node_modules\lucide-angular\src\icons\icons\message-square.d.ts`)
   - All existing icons (Settings, Plus, Check, X, etc.) remain in the import

2. **DatePipe removal is safe**:

   - `DatePipe` is only used at `app-shell.component.html:140` for `session.lastActivityAt | date : 'M/d HH:mm'`
   - After replacing with `formatRelativeDate()`, no other template in this component uses `| date`
   - Verified: no other DatePipe usage in app-shell templates

3. **CSS class names are correct**:

   - `.sidebar-item-active` defined in styles.css (Batch 1, Change Set 2h)
   - `.sidebar-item-open-tab` defined in styles.css (Batch 1, Change Set 2h)
   - `.sidebar-scroll` defined in styles.css (Batch 1, Change Set 2h)
   - These must be added in Batch 1 before Batch 2 uses them

4. **No hallucinated APIs**:
   - `chatStore.sessions()` - verified signal at app-shell.component.ts:96
   - `chatStore.currentSession()` - verified via ChatStore
   - `chatStore.hasMoreSessions()` - verified in template (line 167)
   - `chatStore.isLoadingMoreSessions()` - verified in template (line 171)
   - `chatStore.loadMoreSessions()` - verified in template (line 173)
   - `chatStore.totalSessions()` - verified in template (line 180)
   - `chatStore.switchSession()` - verified in template (line 127)
   - `isSessionOpen()` - verified method at app-shell.component.ts:272
   - `getSessionDisplayName()` - verified method at app-shell.component.ts:239
   - `deleteSession()` - verified method at app-shell.component.ts:280

### Architecture Delivery Checklist

- [x] All components specified with evidence (file:line citations for every change)
- [x] All patterns verified from codebase (message-bubble.component.html as reference)
- [x] All imports/decorators verified as existing (MessageSquare, DatePipe removal safe)
- [x] Quality requirements defined (WCAG contrast ratios, performance requirements)
- [x] Integration points documented (CSS classes shared between Batch 1 and Batch 2)
- [x] Files affected list complete (4 MODIFY, 4 REVIEW)
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM, 3-5 hours)
- [x] Batch dependencies documented (Batch 1 before Batch 2 before Batch 3)
- [x] Risk mitigations for all identified risks
- [x] No step-by-step implementation needed (plan is self-contained with exact code)
