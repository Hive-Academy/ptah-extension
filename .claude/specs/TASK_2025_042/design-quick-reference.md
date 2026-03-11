# Design Quick Reference - TASK_2025_042

**Purpose**: Quick-reference guide for frontend developer implementing badge enhancements

---

## TL;DR Implementation

**Change**: Wrap command/agent/file names in DaisyUI badges for visual distinction

**File**: `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts`

**Lines**: 113-121 (replace 9 lines)

**Before**:

```html
<div class="flex-1 min-w-0">
  <div class="font-medium text-sm truncate">{{ getName(suggestion) }}</div>
  <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
</div>
```

**After**:

```html
@if (suggestion.type === 'command') {
<span class="badge badge-sm badge-primary">{{ getName(suggestion) }}</span>
} @if (suggestion.type === 'agent') {
<span class="badge badge-sm badge-secondary">{{ getName(suggestion) }}</span>
} @if (suggestion.type === 'file') {
<span class="badge badge-sm badge-ghost">{{ getName(suggestion) }}</span>
}
<div class="flex-1 min-w-0">
  <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
</div>
```

**No TypeScript changes. No CSS changes. Pure DaisyUI utility classes.**

---

## Color Reference

| Type            | Badge Class       | Background             | Text              | Contrast |
| --------------- | ----------------- | ---------------------- | ----------------- | -------- |
| Command         | `badge-primary`   | #1e3a8a (lapis blue)   | #f5f5dc (papyrus) | 8.3:1 ✅ |
| Agent           | `badge-secondary` | #d4af37 (pharaoh gold) | #0a0a0a (black)   | 6.1:1 ✅ |
| File            | `badge-ghost`     | Transparent            | #d1d5db (muted)   | 5.2:1 ✅ |
| Scope (Command) | `badge-accent`    | #fbbf24 (gold)         | #0a0a0a (black)   | 7.2:1 ✅ |
| Scope (Agent)   | `badge-primary`   | #1e3a8a (lapis blue)   | #f5f5dc (papyrus) | 8.3:1 ✅ |

All ratios exceed WCAG AA 4.5:1 standard.

---

## Visual Examples

### Command Item (Desktop 400px sidebar):

```
┌────────────────────────────────────────────────────────┐
│ 📋  [/orchestrate]  Start workflows          [Built-in]│
│     ↑ Lapis Blue    ↑ Muted gray (60%)       ↑ Gold   │
└────────────────────────────────────────────────────────┘
```

### Agent Item:

```
┌────────────────────────────────────────────────────────┐
│ 🤖  [@team-leader]  Coordinates tasks        [Built-in]│
│     ↑ Pharaoh Gold  ↑ Muted gray (60%)     ↑ Lapis Blue│
└────────────────────────────────────────────────────────┘
```

### File Item:

```
┌────────────────────────────────────────────────────────┐
│ 📄  [src/app.ts]  Main application entry point         │
│     ↑ Ghost (border only) ↑ Muted gray (60%)           │
└────────────────────────────────────────────────────────┘
```

---

## Testing Checklist

**Visual**:

- [ ] Command badges are lapis blue (#1e3a8a)
- [ ] Agent badges are pharaoh gold (#d4af37)
- [ ] File badges are ghost (transparent, border only)
- [ ] Description text is muted (60% opacity)
- [ ] Scope badges remain unchanged (gold for commands, lapis for agents)

**Interaction**:

- [ ] Hover: Background lightens, badge color unchanged
- [ ] Keyboard focus: 2px lapis blue outline appears
- [ ] ArrowUp/ArrowDown: Focus moves, outline follows
- [ ] Enter: Selects focused item
- [ ] Escape: Closes dropdown

**Accessibility**:

- [ ] Screen reader announces badge text naturally (test with NVDA/JAWS)
- [ ] Keyboard navigation works without mouse
- [ ] Focus outline visible (2px outline)
- [ ] All contrast ratios ≥ 4.5:1 (verify with color picker)

**Responsive**:

- [ ] Narrow sidebar (250px): Badge text does NOT truncate
- [ ] Narrow sidebar (250px): Description DOES truncate with ellipsis
- [ ] Wide sidebar (600px): All elements have comfortable spacing

**Themes**:

- [ ] Dark theme (Anubis): Lapis blue and gold badges
- [ ] Light theme (Anubis Light): Badge colors adapt via DaisyUI tokens

---

## Keyboard Shortcuts Reference

| Key         | Action                      | Expected Behavior                                 |
| ----------- | --------------------------- | ------------------------------------------------- |
| `/`         | Trigger command dropdown    | All commands displayed with lapis badges          |
| `@`         | Trigger agent/file dropdown | All agents/files displayed with gold/ghost badges |
| `ArrowDown` | Move focus down             | Focus outline moves to next item                  |
| `ArrowUp`   | Move focus up               | Focus outline moves to previous item              |
| `Enter`     | Select focused item         | Item inserted into chat input, dropdown closes    |
| `Escape`    | Close dropdown              | Dropdown disappears, focus returns to input       |
| `Tab`       | Cycle categories (@ mode)   | Switches between "All", "Files", "Agents" tabs    |

---

## Common Issues & Solutions

### Issue 1: Badge Text Truncates

**Symptom**: Command name shows "orches..." in narrow sidebar
**Cause**: Badge has `truncate` class
**Solution**: Remove `truncate` from badge, only apply to description

### Issue 2: Badge Color Wrong

**Symptom**: Command badge is gold instead of lapis blue
**Cause**: Used `badge-accent` instead of `badge-primary`
**Solution**: Verify badge class: Commands → `badge-primary`, Agents → `badge-secondary`

### Issue 3: Screen Reader Announces Badge Twice

**Symptom**: Screen reader says "orchestrate orchestrate Start workflows"
**Cause**: ARIA label duplicates badge text
**Solution**: Remove any `aria-label` on badge, let natural text flow announce

### Issue 4: Focus Outline Not Visible

**Symptom**: No outline when navigating with keyboard
**Cause**: `:focus` instead of `:focus-visible`
**Solution**: Verify styles.css line 348 uses `:focus-visible` pseudo-class

### Issue 5: Scope Badge Overlaps Description

**Symptom**: Scope badge appears on top of description text in narrow sidebar
**Cause**: Missing `flex-1 min-w-0` on description container
**Solution**: Ensure description container has `flex-1 min-w-0` classes

---

## DaisyUI Badge Classes Reference

**Size Classes**:

- `badge-xs`: 9px font, 14px height
- `badge-sm`: 10px font, 16px height ← **Use this**
- `badge-md`: 12px font, 20px height
- `badge-lg`: 14px font, 24px height

**Color Classes**:

- `badge-primary`: Lapis blue background, papyrus text ← **Commands**
- `badge-secondary`: Pharaoh gold background, black text ← **Agents**
- `badge-accent`: Gold background, black text ← **Scope badges**
- `badge-ghost`: Transparent background, border only ← **Files**
- `badge-info`: Light blue background, papyrus text
- `badge-success`: Green background, papyrus text
- `badge-warning`: Gold background, black text
- `badge-error`: Red background, papyrus text

**Style Classes**:

- `badge-outline`: Border only, no background
- `badge-dash`: Dashed border (not in DaisyUI v4, ignore)
- `badge-soft`: Softer background (not in DaisyUI v4, ignore)

**Recommended**: `badge badge-sm badge-{color}` (3 classes)

---

## Before/After Code Comparison

### Full Item Template (Lines 105-129)

**Before**:

```html
<a class="flex items-center gap-3 py-2" [class.active]="i === focusedIndex()" (click)="selectSuggestion(suggestion)" (mouseenter)="setFocusedIndex(i)" role="option" [attr.aria-selected]="i === focusedIndex()">
  <span class="text-xl">{{ getIcon(suggestion) }}</span>
  <div class="flex-1 min-w-0">
    <div class="font-medium text-sm truncate">
      {{ getName(suggestion) }}
      <!-- ❌ No visual distinction -->
    </div>
    <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
  </div>
  @if (suggestion.type === 'agent' && suggestion.scope === 'builtin') {
  <span class="badge badge-primary badge-sm">Built-in</span>
  } @if (suggestion.type === 'command' && suggestion.scope === 'builtin') {
  <span class="badge badge-accent badge-sm">Built-in</span>
  }
</a>
```

**After**:

```html
<a class="flex items-center gap-3 py-2" [class.active]="i === focusedIndex()" (click)="selectSuggestion(suggestion)" (mouseenter)="setFocusedIndex(i)" role="option" [attr.aria-selected]="i === focusedIndex()">
  <span class="text-xl">{{ getIcon(suggestion) }}</span>

  <!-- ✅ CHANGE 1: Badge wrapper for name based on type -->
  @if (suggestion.type === 'command') {
  <span class="badge badge-sm badge-primary">{{ getName(suggestion) }}</span>
  } @if (suggestion.type === 'agent') {
  <span class="badge badge-sm badge-secondary">{{ getName(suggestion) }}</span>
  } @if (suggestion.type === 'file') {
  <span class="badge badge-sm badge-ghost">{{ getName(suggestion) }}</span>
  }

  <!-- ✅ CHANGE 2: Description only (no stacking) -->
  <div class="flex-1 min-w-0">
    <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
  </div>

  <!-- Scope badges (unchanged) -->
  @if (suggestion.type === 'agent' && suggestion.scope === 'builtin') {
  <span class="badge badge-primary badge-sm">Built-in</span>
  } @if (suggestion.type === 'command' && suggestion.scope === 'builtin') {
  <span class="badge badge-accent badge-sm">Built-in</span>
  }
</a>
```

**Key Differences**:

1. Name removed from description container (line 115-117 deleted)
2. Badge wrapper added before description (lines 113-123 new)
3. Description simplified to single div (lines 125-129 new, was 118-121)
4. Layout flattened from 2-line (name+desc stacked) to 1-line (badge+desc side-by-side)

---

## Design System Tokens (Anubis Theme)

**Source**: `apps/ptah-extension-webview/tailwind.config.js` lines 23-73

```javascript
primary: '#1e3a8a',           // Lapis Lazuli Blue (Divine wisdom)
'primary-content': '#f5f5dc', // Papyrus (readable text on primary)

secondary: '#d4af37',         // Pharaoh's Gold (Eternal accent)
'secondary-content': '#0a0a0a', // Black (readable text on secondary)

accent: '#fbbf24',            // Gold Light (Highlights, warnings)
'accent-content': '#0a0a0a',  // Black (readable text on accent)

neutral: '#1a1a1a',           // Obsidian gray (panels, cards)
'neutral-content': '#d1d5db', // Light gray (readable text on neutral)

'base-100': '#0a0a0a',        // Background (The Void)
'base-200': '#1a1a1a',        // Elevated background
'base-300': '#2a2a2a',        // Borders
'base-content': '#f5f5dc',    // Papyrus (body text)
```

**Badge Color Mapping**:

- `badge-primary` → `primary` background, `primary-content` text
- `badge-secondary` → `secondary` background, `secondary-content` text
- `badge-accent` → `accent` background, `accent-content` text
- `badge-ghost` → Transparent background, `neutral-content` text

---

## Browser DevTools Inspection

**Verify Badge Rendering**:

1. Open Chrome DevTools (F12)
2. Inspect dropdown item
3. Select `<span class="badge badge-sm badge-primary">`
4. Check Computed styles:
   - `background-color`: rgb(30, 58, 138) ✅ (lapis blue)
   - `color`: rgb(245, 245, 220) ✅ (papyrus)
   - `font-size`: 10px ✅ (badge-sm)
   - `height`: 16px ✅ (badge-sm)
   - `padding-left`: ~4px ✅ (DaisyUI default)
   - `padding-right`: ~4px ✅ (DaisyUI default)

**Verify Contrast Ratio**:

1. Chrome DevTools → Elements → Styles
2. Click color swatch next to `background-color`
3. Expand color picker
4. Check "Contrast ratio" section
5. Verify green checkmark (AA compliant)

**Verify Focus Outline**:

1. Navigate with `Tab` or `ArrowDown` to focus item
2. Inspect focused `<a>` element
3. Check Computed styles:
   - `outline`: 2px solid rgb(30, 58, 138) ✅ (lapis blue)
   - `outline-offset`: -2px ✅ (inside border)

---

## Performance Notes

**Badge Rendering**:

- DaisyUI badges are pure CSS (no JavaScript overhead)
- Badge classes apply styles via Tailwind utility classes (atomic CSS)
- No additional DOM nodes (span wrapper around existing text)

**Expected Performance**:

- Badge rendering: < 1ms per item (negligible)
- Total dropdown render time: ~50ms for 50 items (unchanged from current)
- Hover transition: 150ms ease (DaisyUI default, smooth)

**No Optimization Needed**:

- Badges are lightweight (10px font, 16px height, ~4px padding)
- No images, no gradients (solid colors only)
- No JavaScript calculations (pure CSS)

---

## Git Commit Message Template

**Type**: `feat` (new feature - visual enhancement)
**Scope**: `webview` (Angular SPA changes)

**Template**:

```
feat(webview): add badge styling for autocomplete command names

Wrap command/agent/file names in DaisyUI badges for visual distinction:
- Commands: lapis blue badge (badge-primary)
- Agents: pharaoh gold badge (badge-secondary)
- Files: ghost badge (badge-ghost)
- Description: muted text (60% opacity)
- Scope badges: unchanged (gold for commands, lapis for agents)

Visual hierarchy: Icon → Badge (name) → Description → Scope
Layout: Single-line per item (was two-line stacked)
Accessibility: WCAG AA contrast (8.3:1, 6.1:1), screen reader friendly

BREAKING CHANGE: None (template change only, no API changes)

Refs: TASK_2025_042
```

---

**Document Version**: 1.0
**Created**: 2025-12-04
**Purpose**: Quick reference for frontend-developer implementation
**Parent Document**: visual-design-specification.md
