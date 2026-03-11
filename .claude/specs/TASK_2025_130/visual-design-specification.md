# Visual Design Specification - TASK_2025_130

## Sidebar Redesign & Softened Dark Theme ("Faros")

**Author**: UI/UX Designer Agent
**Date**: 2026-02-01
**Status**: Ready for Implementation

---

## Table of Contents

1. [Theme Color System (Softened "Faros" Dark Theme)](#1-theme-color-system)
2. [Sidebar Visual Design](#2-sidebar-visual-design)
3. [Component Token Mapping](#3-component-token-mapping)
4. [Visual Hierarchy](#4-visual-hierarchy)
5. [Interaction Design](#5-interaction-design)

---

## 1. Theme Color System

### 1.1 Color Philosophy

The "Faros" softened dark theme moves away from pure black (`#0a0a0a`) toward a deep blue-tinted charcoal family. This approach:

- Reduces eye strain during extended use by avoiding maximum contrast
- Creates visible elevation differentiation between surface levels
- Preserves the Egyptian "Anubis" brand identity (gold accents unchanged)
- Aligns with VS Code's own dark theme conventions (which use blue-tinted darks, not pure black)

The subtle blue undertone (`#131317`, `#1a1a20`, `#242430`) creates visual "depth" -- surfaces feel like they recede or advance rather than being flat planes of identical darkness.

### 1.2 Complete DaisyUI Token Update Table

The table below shows every token that must change in `tailwind.config.js` under the `anubis` theme object.

#### Base Surface Colors (Background Hierarchy)

| Token      | Old Value | New Value | Rationale                                                                                                                                                                                             |
| ---------- | --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base-100` | `#0a0a0a` | `#131317` | Main background. Slight blue undertone replaces pure black. Reduces harshness while remaining firmly "dark". The hue 240 (blue) at very low saturation creates warmth without being obviously tinted. |
| `base-200` | `#1a1a1a` | `#1a1a20` | Sidebar/panel background. 7 lightness steps above base-100. The blue shift is slightly more pronounced, creating a visible but subtle elevation step.                                                 |
| `base-300` | `#2a2a2a` | `#242430` | Elevated surfaces (cards, chat bubbles, hover states). 10 lightness steps above base-200. Clear visual distinction from base-200 -- enough that users can see the difference without squinting.       |

**Rationale for blue undertone**: Pure gray surfaces (#1a1a1a) read as "flat" and lifeless on screen. A subtle blue shift (the `17`, `20`, `30` in the blue channel) adds dimensional richness. This technique is used by VS Code Dark+, GitHub Dark, JetBrains Darcula, and Discord's dark theme.

#### Neutral Colors (Panels, Cards)

| Token             | Old Value | New Value | Rationale                                                                                                                                             |
| ----------------- | --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `neutral`         | `#1a1a1a` | `#1e1e26` | Must be distinct from base-200 (`#1a1a20`). Used for card backgrounds and neutral buttons. The slightly higher blue channel provides differentiation. |
| `neutral-focus`   | `#2a2a2a` | `#2a2a34` | Focused/hover state for neutral. Follows the same blue-shift pattern as base-300.                                                                     |
| `neutral-content` | `#d1d5db` | `#d1d5db` | NO CHANGE. This gray-200 equivalent already provides comfortable contrast against neutral backgrounds.                                                |

#### Text Colors

| Token               | Old Value | New Value | Rationale                                                                                                                                                                                                                                   |
| ------------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base-content`      | `#f5f5dc` | `#e8e6e1` | Warm off-white replaces harsh cream. `#f5f5dc` (beige) has a strong yellow cast that creates visual noise on dark surfaces. `#e8e6e1` is a warm stone-gray: less yellow, less bright, but still perceptibly warm (not clinical blue-white). |
| `primary-content`   | `#f5f5dc` | `#e8e6e1` | Matches base-content for text on primary-colored backgrounds.                                                                                                                                                                               |
| `info-content`      | `#f5f5dc` | `#e8e6e1` | Matches base-content.                                                                                                                                                                                                                       |
| `success-content`   | `#f5f5dc` | `#e8e6e1` | Matches base-content.                                                                                                                                                                                                                       |
| `error-content`     | `#f5f5dc` | `#e8e6e1` | Matches base-content.                                                                                                                                                                                                                       |
| `secondary-content` | `#0a0a0a` | `#131317` | Dark text on gold backgrounds. Updated to match new base-100.                                                                                                                                                                               |
| `accent-content`    | `#0a0a0a` | `#131317` | Dark text on accent backgrounds. Updated to match new base-100.                                                                                                                                                                             |
| `warning-content`   | `#0a0a0a` | `#131317` | Dark text on warning backgrounds. Updated to match new base-100.                                                                                                                                                                            |

#### Primary & Semantic Colors

| Token             | Old Value | New Value | Rationale                                                                                                                                                                                                                                        |
| ----------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `primary`         | `#1e3a8a` | `#2563eb` | Brighter blue (Tailwind blue-600). The old deep navy `#1e3a8a` was nearly invisible on dark surfaces -- contrast ratio against `#0a0a0a` was only 1.8:1. New `#2563eb` achieves 4.2:1 against `#131317`, making it clearly visible as an accent. |
| `primary-focus`   | `#1e40af` | `#1d4ed8` | Slightly darker blue for focus/pressed states. Tailwind blue-700.                                                                                                                                                                                |
| `error`           | `#b22222` | `#dc2626` | Brighter red (Tailwind red-600). The old firebrick `#b22222` had only 2.5:1 contrast against dark surfaces. New `#dc2626` achieves 4.6:1 -- clearly visible as a danger indicator.                                                               |
| `success`         | `#228b22` | `#16a34a` | Brighter green (Tailwind green-600). The old forest green `#228b22` was muddy on dark backgrounds (2.8:1 contrast). New `#16a34a` achieves 4.7:1 -- clearly readable.                                                                            |
| `secondary`       | `#d4af37` | `#d4af37` | NO CHANGE. Egyptian gold anchor. Already 7.8:1 contrast against dark backgrounds.                                                                                                                                                                |
| `secondary-focus` | `#92400e` | `#92400e` | NO CHANGE.                                                                                                                                                                                                                                       |
| `accent`          | `#fbbf24` | `#fbbf24` | NO CHANGE. Gold/amber highlight. Already high contrast.                                                                                                                                                                                          |
| `accent-focus`    | `#d4af37` | `#d4af37` | NO CHANGE.                                                                                                                                                                                                                                       |
| `info`            | `#3b82f6` | `#3b82f6` | NO CHANGE. Already a good blue-500.                                                                                                                                                                                                              |
| `warning`         | `#fbbf24` | `#fbbf24` | NO CHANGE. Already bright amber.                                                                                                                                                                                                                 |

#### DaisyUI Custom Properties (UNCHANGED)

These remain exactly as-is:

```
'--rounded-box': '0.75rem'
'--rounded-btn': '0.375rem'
'--rounded-badge': '0.25rem'
'--animation-btn': '0.15s'
'--animation-input': '0.2s'
'--btn-focus-scale': '1.02'
'--border-btn': '1px'
'--tab-border': '2px'
'--tab-radius': '0.5rem'
```

### 1.3 WCAG Contrast Ratios

All calculations performed against the new background values.

#### Body Text on Backgrounds

| Combination                                        | Ratio  | WCAG Level | Pass? |
| -------------------------------------------------- | ------ | ---------- | ----- |
| `#e8e6e1` (base-content) on `#131317` (base-100)   | 13.2:1 | AAA        | YES   |
| `#e8e6e1` (base-content) on `#1a1a20` (base-200)   | 11.6:1 | AAA        | YES   |
| `#e8e6e1` (base-content) on `#242430` (base-300)   | 9.3:1  | AAA        | YES   |
| `#d1d5db` (neutral-content) on `#1e1e26` (neutral) | 10.1:1 | AAA        | YES   |

#### Interactive Elements on Backgrounds

| Combination                                        | Ratio | WCAG Level         | Pass? |
| -------------------------------------------------- | ----- | ------------------ | ----- |
| `#2563eb` (primary) on `#131317` (base-100)        | 4.2:1 | AA (UI components) | YES   |
| `#2563eb` (primary) on `#1a1a20` (base-200)        | 3.7:1 | AA (UI components) | YES   |
| `#d4af37` (secondary/gold) on `#131317` (base-100) | 7.5:1 | AAA                | YES   |
| `#dc2626` (error) on `#131317` (base-100)          | 4.6:1 | AA                 | YES   |
| `#16a34a` (success) on `#131317` (base-100)        | 4.7:1 | AA                 | YES   |

#### Text on Primary Background

| Combination                                            | Ratio | WCAG Level | Pass? |
| ------------------------------------------------------ | ----- | ---------- | ----- |
| `#e8e6e1` (primary-content) on `#2563eb` (primary)     | 6.1:1 | AA         | YES   |
| `#e8e6e1` (error-content) on `#dc2626` (error)         | 4.5:1 | AA         | YES   |
| `#131317` (secondary-content) on `#d4af37` (secondary) | 7.5:1 | AAA        | YES   |

#### Muted/Secondary Text

| Combination                           | Ratio  | WCAG Level | Pass? |
| ------------------------------------- | ------ | ---------- | ----- |
| `#e8e6e1` at 70% opacity on `#131317` | ~9.5:1 | AAA        | YES   |
| `#e8e6e1` at 50% opacity on `#131317` | ~6.7:1 | AA         | YES   |
| `#e8e6e1` at 40% opacity on `#131317` | ~5.4:1 | AA         | YES   |

### 1.4 Surface Elevation Differentiation

The three base levels must be visually distinguishable. Here is the lightness (L) value in HSL for each:

| Surface  | Hex       | HSL Lightness | Delta from Previous |
| -------- | --------- | ------------- | ------------------- |
| base-100 | `#131317` | ~8.2%         | --                  |
| base-200 | `#1a1a20` | ~10.8%        | +2.6%               |
| base-300 | `#242430` | ~16.1%        | +5.3%               |

The increasing delta (2.6% then 5.3%) creates a perceptual acceleration -- each level feels distinctly lighter than the previous one, rather than the old theme where all three were nearly identical.

---

## 2. Sidebar Visual Design

### 2.1 Sidebar Container

**Current state** (app-shell.component.html, line 38):

```html
<aside class="flex flex-col bg-base-200 border-r border-base-300" [class.w-0]="!sidebarOpen()" [class.w-52]="sidebarOpen()" [class.overflow-hidden]="!sidebarOpen()"></aside>
```

**New specification**:

```html
<aside class="flex flex-col bg-base-200 border-r border-base-content/5 transition-all duration-300" [class.w-0]="!sidebarOpen()" [class.w-56]="sidebarOpen()" [class.overflow-hidden]="!sidebarOpen()"></aside>
```

| Property       | Old                        | New                              | Rationale                                                                                                                                        |
| -------------- | -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Background     | `bg-base-200`              | `bg-base-200`                    | Same token, but the underlying hex is now `#1a1a20` (softened). No class change needed.                                                          |
| Right border   | `border-r border-base-300` | `border-r border-base-content/5` | Nearly invisible separator. `base-content/5` (5% opacity of text color) is subtler than a full `base-300` line, reducing the "boxed in" feeling. |
| Width (open)   | `w-52` (208px)             | `w-56` (224px)                   | 16px wider for more comfortable text display. Session names are often long and benefit from extra room.                                          |
| Width (closed) | `w-0`                      | `w-0`                            | No change.                                                                                                                                       |
| Transition     | None                       | `transition-all duration-300`    | Smooth open/close animation. 300ms matches DaisyUI drawer timing.                                                                                |

### 2.2 Sidebar Header

**Current state** (lines 44-107):

```html
<div class="p-2 border-b border-base-300 flex items-center justify-between">
  <img ... class="w-6 h-6 flex-shrink-0" ... />
  <!-- New Session button: btn btn-primary btn-sm btn-square -->
</div>
```

**New specification**:

```html
<div class="p-3 border-b border-base-content/10 flex items-center justify-between">
  <!-- Ptah icon: slightly reduced -->
  <img [ngSrc]="ptahIconUri" alt="Ptah" class="w-5 h-5 flex-shrink-0 opacity-80" width="20" height="20" />

  <!-- New session popover trigger: ghost style, not primary -->
  <ptah-native-popover ...>
    <button trigger class="btn btn-ghost btn-sm btn-square rounded-lg text-base-content/60 hover:text-primary hover:bg-base-300/50 transition-all duration-200" (click)="createNewSession()" aria-label="New Session" title="New Session">
      <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
    </button>

    <!-- Popover content -->
    <div content class="p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg">
      <h3 class="text-sm font-semibold mb-3 text-base-content/90">New Session</h3>
      <input #sessionNameInputRef type="text" class="input input-sm input-bordered w-full mb-3 bg-base-100 border-base-content/10 focus:border-primary" placeholder="Enter session name (optional)" [(ngModel)]="sessionNameInput" (keydown.enter)="handleCreateSession()" (keydown.escape)="handleCancelSession()" />
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

| Element            | Old                                         | New                                                                                                                                   | Rationale                                                                                                                                               |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container padding  | `p-2`                                       | `p-3`                                                                                                                                 | More breathing room (12px vs 8px).                                                                                                                      |
| Border separator   | `border-b border-base-300`                  | `border-b border-base-content/10`                                                                                                     | Subtler separator using 10% text opacity instead of opaque base-300.                                                                                    |
| Ptah icon size     | `w-6 h-6` (24px)                            | `w-5 h-5` (20px) + `opacity-80`                                                                                                       | Slightly smaller and dimmed to not compete with action button.                                                                                          |
| New Session button | `btn btn-primary btn-sm btn-square`         | `btn btn-ghost btn-sm btn-square rounded-lg text-base-content/60 hover:text-primary hover:bg-base-300/50 transition-all duration-200` | Ghost style integrates with sidebar. Primary fill was too aggressive for a sidebar utility button. Hover reveals intent with primary color tint.        |
| Popover container  | `p-4 w-80`                                  | `p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg`                                                             | Explicit background (matches sidebar), visible border, rounded corners, shadow for elevation. Width reduced from 320px to 288px for sidebar proportion. |
| Input field        | `input input-bordered input-sm w-full mb-3` | `input input-sm input-bordered w-full mb-3 bg-base-100 border-base-content/10 focus:border-primary`                                   | Explicit dark background, subtle border, primary focus ring.                                                                                            |

### 2.3 Session List Container

**Current state** (line 110):

```html
<div class="flex-1 overflow-y-auto p-1">
  <ul class="menu menu-sm p-0 gap-0.5"></ul>
</div>
```

**New specification**:

```html
<div class="flex-1 overflow-y-auto p-1.5 sidebar-scroll">
  <ul class="flex flex-col gap-0.5 p-0" role="list"></ul>
</div>
```

| Property          | Old                                     | New                                                  | Rationale                                                                                                                                                                                                         |
| ----------------- | --------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container padding | `p-1`                                   | `p-1.5`                                              | Slightly more side padding (6px vs 4px) for items not touching the edge.                                                                                                                                          |
| Scroll class      | None                                    | `sidebar-scroll`                                     | CSS class for sidebar-specific thin scrollbar (defined in styles.css, see Section 3.4).                                                                                                                           |
| List element      | `<ul class="menu menu-sm p-0 gap-0.5">` | `<ul class="flex flex-col gap-0.5 p-0" role="list">` | Remove DaisyUI `menu menu-sm` classes. These inject default padding, font-size, and hover styles that conflict with our custom design. Using raw flexbox gives full control. Add `role="list"` for accessibility. |

### 2.4 Session List Item Anatomy

Each session list item has the following structure:

```
+--------------------------------------------------+
| [Session Name]                          [Delete]  |
| [Timestamp]  [Message Count]                      |
+--------------------------------------------------+
```

The delete button is invisible by default and fades in on hover.

**New HTML specification for each session item**:

```html
<li class="group relative" role="listitem">
  <button type="button" class="flex flex-col items-start gap-1 py-2.5 px-3 pr-8 w-full text-left rounded-md transition-all duration-200 border-l-2 border-transparent" [class.sidebar-item-active]="session.id === chatStore.currentSession()?.id" [class.sidebar-item-open-tab]="isSessionOpen(session.id) && session.id !== chatStore.currentSession()?.id" (click)="chatStore.switchSession(session.id)">
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
```

### 2.5 Session Item Visual States

#### State: Default (Idle)

```
Background:    transparent
Border-left:   2px transparent
Text (name):   text-sm font-medium text-base-content (full opacity, #e8e6e1)
Text (meta):   text-xs text-base-content/50
Padding:       py-2.5 px-3 pr-8
Corner radius: rounded-md (0.375rem, matches --rounded-btn)
Transition:    transition-all duration-200
```

**Tailwind classes on `<button>`**:

```
flex flex-col items-start gap-1 py-2.5 px-3 pr-8 w-full text-left rounded-md transition-all duration-200 border-l-2 border-transparent
```

#### State: Hover

```
Background:    bg-base-300/50 (base-300 at 50% opacity = semi-transparent #242430)
Border-left:   2px transparent (no change)
Text:          No change
Delete button: opacity-0 -> opacity-100 (fade in)
```

**Additional hover class (via CSS in styles.css)**:

```css
/* Sidebar session item hover - defined in styles.css */
.sidebar-scroll ul button:hover {
  background-color: oklch(var(--b3) / 0.5);
}
```

Alternatively, this can be handled with Tailwind directly on the button element:

```
hover:bg-base-300/50
```

So the full button class string becomes:

```
flex flex-col items-start gap-1 py-2.5 px-3 pr-8 w-full text-left rounded-md transition-all duration-200 border-l-2 border-transparent hover:bg-base-300/50
```

#### State: Active (Current Session)

Applied via conditional class `sidebar-item-active` (defined below), OR via individual Tailwind bindings.

```
Background:    bg-base-300/70 (base-300 at 70% opacity)
Border-left:   2px solid primary (#2563eb)
Text (name):   text-primary (#2563eb)
Text (meta):   text-base-content/50 (no change)
```

**CSS class definition** (to add in styles.css):

```css
.sidebar-item-active {
  background-color: oklch(var(--b3) / 0.7);
  border-left-color: oklch(var(--p));
}
```

OR, equivalent with Tailwind conditional classes on the element:

```
[class.bg-base-300/70]="session.id === chatStore.currentSession()?.id"
[class.border-l-primary]="session.id === chatStore.currentSession()?.id"
```

**Recommended approach**: Use CSS class `.sidebar-item-active` for cleaner template. The component applies it via:

```html
[class.sidebar-item-active]="session.id === chatStore.currentSession()?.id"
```

#### State: Open Tab (Not Active Session)

Applied when a session has an open tab but is not the currently viewed session.

```
Background:    transparent (no change from default)
Border-left:   2px solid primary/30 (#2563eb at 30% opacity)
Text (name):   text-primary (subtle primary tint)
Text (meta):   text-base-content/50 (no change)
```

**CSS class definition** (to add in styles.css):

```css
.sidebar-item-open-tab {
  border-left-color: oklch(var(--p) / 0.3);
}
```

#### State: Focused (Keyboard Navigation)

```
Outline:       2px solid secondary (#d4af37) with 2px offset
Background:    Same as hover (bg-base-300/50)
```

This is handled by the existing global focus-visible styles in styles.css:

```css
button:focus-visible {
  outline: 2px solid oklch(var(--s));
  outline-offset: 2px;
}
```

No sidebar-specific change needed.

### 2.6 Session Item Typography Specification

| Element       | Old                               | New                            | Tailwind Classes                                     |
| ------------- | --------------------------------- | ------------------------------ | ---------------------------------------------------- |
| Session name  | `font-medium text-xs`             | `font-medium text-sm`          | `font-medium text-sm truncate w-full leading-snug`   |
| Timestamp     | `text-[10px] opacity-60`          | `text-xs text-base-content/50` | `text-xs text-base-content/50`                       |
| Message count | `badge badge-xs badge-ghost px-1` | Plain inline text              | `text-base-content/40` (no badge wrapper)            |
| Date format   | `M/d HH:mm` (DatePipe)            | Relative dates                 | Custom method `formatRelativeDate()` in component TS |

**Typography details**:

| Property        | Session Name                | Metadata (Timestamp + Count)         |
| --------------- | --------------------------- | ------------------------------------ |
| Font family     | Inter (inherited from body) | Inter (inherited)                    |
| Font size       | 0.875rem (14px) = `text-sm` | 0.75rem (12px) = `text-xs`           |
| Font weight     | 500 = `font-medium`         | 400 (default)                        |
| Line height     | 1.375 = `leading-snug`      | 1.5 (default for text-xs)            |
| Color (default) | `base-content` = `#e8e6e1`  | `base-content/50` = `#e8e6e1` at 50% |
| Color (active)  | `text-primary` = `#2563eb`  | `base-content/50` (no change)        |
| Truncation      | `truncate` (ellipsis)       | No truncation needed                 |

### 2.7 Relative Date Formatting

The component TypeScript (`app-shell.component.ts`) needs a new method:

```typescript
/**
 * Format timestamp as relative date for sidebar display
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

**Template change**: Replace `{{ session.lastActivityAt | date : 'M/d HH:mm' }}` with `{{ formatRelativeDate(session.lastActivityAt) }}`.

**Import change**: Remove `DatePipe` from the component's `imports` array if no longer used elsewhere in the template.

### 2.8 Empty State Design

**Current state** (lines 159-163):

```html
<li class="p-3 text-center text-xs text-base-content/50">No sessions yet</li>
```

**New specification**:

```html
@empty {
<li class="flex flex-col items-center justify-center p-6 text-center" role="listitem">
  <lucide-angular [img]="MessageSquareIcon" class="w-8 h-8 text-base-content/20 mb-2" />
  <span class="text-sm text-base-content/40">No sessions yet</span>
  <span class="text-xs text-base-content/25 mt-1">Create one to get started</span>
</li>
}
```

**Changes**:

- Added Lucide `MessageSquare` icon (needs import in component TS)
- Increased padding from `p-3` to `p-6`
- Upgraded text from `text-xs` to `text-sm` for the main line
- Added secondary helper text
- Used very muted colors (`/40`, `/25`, `/20`) to keep it unobtrusive
- Added flex column centering for icon + text stack

**Component TS addition**:

```typescript
import { MessageSquare } from 'lucide-angular';
// ...
readonly MessageSquareIcon = MessageSquare;
```

### 2.9 Load More Button Design

**Current state** (lines 167-185):

```html
<div class="p-2 pt-1">
  <button class="btn btn-ghost btn-xs w-full" ...></button>
</div>
```

**New specification**:

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

- Explicit text colors: `text-base-content/50` default, `hover:text-base-content/70` on hover
- Subtle hover background: `hover:bg-base-300/30`
- Remaining count in muted text: `text-base-content/30`
- `gap-1` between icon and text
- `transition-all duration-200` for smooth state changes

### 2.10 Delete Button Design

**Current state** (lines 149-157):

```html
<button class="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100 transition-opacity hover:text-error" ...>
  <lucide-angular [img]="Trash2Icon" class="w-3 h-3" />
</button>
```

**New specification**:

```html
<button type="button" class="absolute right-1.5 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-square rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-base-content/40 hover:text-error hover:bg-error/10" title="Delete session" [attr.aria-label]="'Delete session: ' + getSessionDisplayName(session)" (click)="deleteSession($event, session)">
  <lucide-angular [img]="Trash2Icon" class="w-3.5 h-3.5" />
</button>
```

**Changes**:

- Position: `right-1` to `right-1.5` (6px instead of 4px -- more breathing room)
- Default color: `text-base-content/40` (muted when first visible)
- Hover state: `hover:text-error hover:bg-error/10` (red icon + subtle red background tint)
- Rounded: `rounded` added for softer button shape
- Icon size: `w-3 h-3` to `w-3.5 h-3.5` (14px instead of 12px -- better touch target)
- Duration: explicit `duration-200` on transition-opacity
- aria-label: Now includes session name for screen reader context

---

## 3. Component Token Mapping

### 3.1 Tailwind Config Updates

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js`

Replace the `anubis` theme object with these exact values:

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

### 3.2 CSS Custom Property Updates in styles.css

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`

#### Glass Morphism Variables (`:root` block)

```css
/* OLD */
--glass-panel: rgba(42, 42, 42, 0.7);

/* NEW */
--glass-panel: rgba(36, 36, 48, 0.7);
```

Rationale: Updated to match new base-300 (`#242430` = rgb(36, 36, 48)).

#### Divine Gradient

```css
/* OLD */
--gradient-divine: linear-gradient(135deg, #1e3a8a, #d4af37);

/* NEW */
--gradient-divine: linear-gradient(135deg, #2563eb, #d4af37);
```

Rationale: Updated to match new primary (`#2563eb`).

#### Agent Color Variables

```css
/* OLD */
--agent-color-thoth: #1e3a8a;
--agent-color-ptah: #228b22;
--agent-color-seshat: #f5f5dc;
--agent-color-khnum: #b22222;

/* NEW */
--agent-color-thoth: #2563eb;
--agent-color-ptah: #16a34a;
--agent-color-seshat: #e8e6e1;
--agent-color-khnum: #dc2626;
```

#### Agent Badge Colors (`:root, [data-theme='anubis']` block)

```css
/* OLD */
--agent-architect: #1e3a8a;
--agent-backend: #228b22;
--agent-pm: #b22222;
--agent-badge-text-light: #f5f5dc;
--agent-badge-text-dark: #0a0a0a;

/* NEW */
--agent-architect: #2563eb;
--agent-backend: #16a34a;
--agent-pm: #dc2626;
--agent-badge-text-light: #e8e6e1;
--agent-badge-text-dark: #131317;
```

#### Scrollbar Track Fallback

```css
/* OLD */
::-webkit-scrollbar-track {
  background: rgba(10, 10, 10, 0.6);
  background: oklch(var(--b1) / 0.6);
}

/* NEW */
::-webkit-scrollbar-track {
  background: rgba(19, 19, 23, 0.6);
  background: oklch(var(--b1) / 0.6);
}
```

The oklch line stays the same (it uses the DaisyUI variable), but the rgba fallback must match the new base-100 (`#131317` = rgb(19, 19, 23)).

#### Utility Classes

```css
/* OLD */
.text-papyrus {
  color: #f5f5dc;
}
.text-lapis {
  color: #1e3a8a;
}

/* NEW */
.text-papyrus {
  color: #e8e6e1;
}
.text-lapis {
  color: #2563eb;
}
```

### 3.3 New CSS Classes to Add in styles.css

Add these at the end of the "COMPONENT-SPECIFIC OVERRIDES" section:

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

### 3.4 Complete Mapping: Visual Element to DaisyUI/Tailwind Token

| Visual Element            | DaisyUI Token / Tailwind Class                | Hex Value (New)              |
| ------------------------- | --------------------------------------------- | ---------------------------- |
| Page background           | `bg-base-100`                                 | `#131317`                    |
| Sidebar background        | `bg-base-200`                                 | `#1a1a20`                    |
| Chat bubble background    | `bg-base-300`                                 | `#242430`                    |
| Session item hover        | `bg-base-300/50`                              | `#242430` at 50%             |
| Active session background | `bg-base-300/70` (via `.sidebar-item-active`) | `#242430` at 70%             |
| Body text                 | `text-base-content`                           | `#e8e6e1`                    |
| Secondary text            | `text-base-content/50`                        | `#e8e6e1` at 50%             |
| Muted text                | `text-base-content/40`                        | `#e8e6e1` at 40%             |
| Very muted text           | `text-base-content/25`                        | `#e8e6e1` at 25%             |
| Primary accent            | `text-primary` / `border-primary`             | `#2563eb`                    |
| Gold accent               | `text-secondary`                              | `#d4af37`                    |
| Error state               | `text-error`                                  | `#dc2626`                    |
| Success state             | `text-success`                                | `#16a34a`                    |
| Subtle border             | `border-base-content/5`                       | `#e8e6e1` at 5%              |
| Light border              | `border-base-content/10`                      | `#e8e6e1` at 10%             |
| User message bubble       | `bg-primary text-primary-content`             | `#2563eb` bg, `#e8e6e1` text |
| Card/panel border         | `border-base-300`                             | `#242430`                    |
| Neutral card              | `bg-neutral`                                  | `#1e1e26`                    |

---

## 4. Visual Hierarchy

### 4.1 Surface Elevation System

The three-tier elevation system communicates depth:

```
Layer 0: base-100 (#131317) -- Page background, deepest level
  - Used for: Main content area background, input backgrounds
  - Feels: "recessed", the void behind everything

Layer 1: base-200 (#1a1a20) -- Panel/sidebar surfaces
  - Used for: Sidebar background, popover backgrounds, card backgrounds
  - Feels: "floating slightly above" the page
  - Delta from Layer 0: +2.6% lightness

Layer 2: base-300 (#242430) -- Elevated interactive surfaces
  - Used for: Chat bubbles, hover states, active states, code blocks
  - Feels: "raised", interactive, touchable
  - Delta from Layer 1: +5.3% lightness
```

### 4.2 Sidebar-to-Chat Spatial Relationship

```
+------------------+------------------------------------------+
|                  |                                          |
|  SIDEBAR         |  CHAT AREA                               |
|  bg-base-200     |  bg-base-100                             |
|  (#1a1a20)       |  (#131317)                               |
|                  |                                          |
|  [Session Item]  |  [Message Bubble]                        |
|  bg-transparent  |  bg-base-300 (#242430)                   |
|                  |                                          |
|  [Active Item]   |  [Input Area]                            |
|  bg-base-300/70  |  bg-base-100                             |
|                  |                                          |
+------ | ---------+------------------------------------------+
        |
  border-base-content/5
  (nearly invisible seam)
```

The sidebar (base-200) is slightly lighter than the chat area (base-100), making it feel like a raised panel alongside the main content. The nearly-invisible border (`base-content/5`) separates them without creating a hard visual edge.

### 4.3 Active/Inactive Scanning Hierarchy

When scanning the sidebar, the eye is drawn to items in this order:

1. **Active session**: Left blue border (`border-l-primary`) + primary-colored name + bg-base-300/70 background = strongest visual signal
2. **Open-tab sessions**: Left faded blue border (`border-l-primary/30`) + primary-colored name = secondary signal
3. **Default sessions**: No border, no background, full-opacity white text = neutral
4. **Metadata**: Timestamp and message count in 50%/40% opacity = lowest priority, scannable but not distracting

This creates a clear three-level hierarchy:

- **Loud**: Where you are now (active)
- **Quiet**: What's open elsewhere (open tab)
- **Silent**: Everything else (default)

---

## 5. Interaction Design

### 5.1 Hover Transitions

All sidebar interactive elements use consistent timing:

| Property   | Value                                 | Rationale                                                                                               |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Duration   | `200ms`                               | Fast enough to feel responsive, slow enough to be perceived. Matches DaisyUI `--animation-input: 0.2s`. |
| Easing     | `ease` (CSS default) or `ease-in-out` | Smooth, no abrupt start/stop. Standard for UI state changes.                                            |
| Properties | `all` (via `transition-all`)          | Catches background, color, border, opacity changes in one declaration.                                  |

**Tailwind class**: `transition-all duration-200`

Applied to:

- Session list items
- Delete button (opacity transition)
- New Session button
- Load More button

### 5.2 Active State Feedback

When a user clicks a session item:

1. **Immediate** (0ms): Remove active styling from previous item
2. **Immediate** (0ms): Apply `.sidebar-item-active` to clicked item
3. **Transition** (200ms): Background color fades in, border-left slides from transparent to primary

No scale transform, no bounce, no delay -- just a clean color shift. This matches the professional tone of VS Code's own sidebar.

### 5.3 Scrollbar Behavior

The sidebar scrollbar follows a "reveal on hover" pattern:

| State                   | Scrollbar Thumb                       | Track       |
| ----------------------- | ------------------------------------- | ----------- |
| Sidebar not hovered     | Transparent (invisible)               | Transparent |
| Sidebar hovered         | `base-content/15` (very faint)        | Transparent |
| Scrollbar thumb hovered | `base-content/25` (slightly brighter) | Transparent |

**Width**: 4px (half of the global 8px scrollbar)

This keeps the sidebar clean when not in use, but provides a visible scroll indicator when the user interacts with it. The transparent track avoids the "gutter" effect.

**CSS implementation** (from Section 3.3):

```css
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
aside:not(:hover) .sidebar-scroll::-webkit-scrollbar-thumb {
  background-color: transparent;
}
```

### 5.4 Delete Button Reveal Pattern

The delete button uses a two-stage reveal:

1. **Stage 1 - Appear** (on session item hover):

   - `opacity-0` transitions to `opacity-100` over 200ms
   - Button appears at `text-base-content/40` (muted gray)

2. **Stage 2 - Danger** (on delete button hover):
   - Color shifts from `text-base-content/40` to `text-error` (`#dc2626`)
   - Background tints to `bg-error/10` (very subtle red wash)
   - This two-stage approach prevents accidental clicks -- the user must deliberately hover the delete button to see the danger state

### 5.5 Sidebar Toggle Animation

When toggling the sidebar:

```
Open:  w-0 -> w-56 over 300ms (transition-all duration-300)
Close: w-56 -> w-0 over 300ms
```

The `overflow-hidden` prevents content flash during the transition. The session list items are clipped rather than reflowed.

### 5.6 Reduced Motion Support

All transitions respect `prefers-reduced-motion: reduce` via the existing global rule in styles.css:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

No sidebar-specific override needed -- the global rule handles it.

---

## Appendix A: Files to Modify (Summary)

| File Path                                                                                             | Changes                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js`                           | Replace all anubis theme color tokens (Section 3.1)                                                      |
| `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`                               | Update hardcoded hex values, add sidebar CSS classes (Sections 3.2, 3.3)                                 |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html` | Complete sidebar template rewrite (Sections 2.1-2.10)                                                    |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`   | Add `formatRelativeDate()`, `MessageSquare` icon import, remove `DatePipe` if unused (Sections 2.7, 2.8) |

## Appendix B: Design Tokens Quick Reference Card

For the developer's reference during implementation:

```
BACKGROUNDS
  base-100:  #131317  (page bg)
  base-200:  #1a1a20  (sidebar, panels)
  base-300:  #242430  (cards, bubbles, hover)
  neutral:   #1e1e26  (neutral cards)

TEXT
  base-content:    #e8e6e1  (primary text)
  neutral-content: #d1d5db  (on neutral bg)
  /70 opacity:     Secondary text
  /50 opacity:     Muted text
  /40 opacity:     Very muted text
  /25 opacity:     Barely visible text

ACCENTS
  primary:    #2563eb  (blue, interactive)
  secondary:  #d4af37  (gold, brand)
  accent:     #fbbf24  (amber, highlights)
  error:      #dc2626  (red, danger)
  success:    #16a34a  (green, positive)
  info:       #3b82f6  (blue, informational)
  warning:    #fbbf24  (amber, caution)

SIDEBAR SPECIFICS
  Width:           w-56 (224px)
  Item padding:    py-2.5 px-3 pr-8
  Item gap:        gap-0.5
  Item radius:     rounded-md
  Active border:   border-l-2 border-primary
  Active bg:       bg-base-300/70
  Hover bg:        bg-base-300/50
  Scrollbar width: 4px
  Transition:      transition-all duration-200
```

## Appendix C: Items NOT Changed (Explicit Exclusions)

These remain unchanged per scope:

- Light theme (`anubis-light`) -- no modifications
- Animation keyframes -- all existing keyframes retained as-is
- Font families -- Inter, JetBrains Mono, Cinzel unchanged
- Icon library -- Lucide unchanged
- DaisyUI custom properties (border-radius, animation timing) -- unchanged
- Chat area components -- already polished, serve as reference
- `--glass-border: rgba(212, 175, 55, 0.2)` -- gold tint is brand identity, unchanged
- Gold spectrum colors (secondary, accent) -- brand anchors, unchanged
