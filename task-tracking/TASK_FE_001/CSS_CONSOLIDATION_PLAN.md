# CSS Consolidation Plan - TASK_FE_001

**Date**: October 14, 2025  
**Priority**: 🔴 CRITICAL (P0)  
**Issue**: CSS budget exceeded - component styles at 13KB (limit: 8KB)  
**Impact**: VS Code extension bundle size directly affects user experience

---

## 🚨 Current Situation Analysis

### Budget Configuration

```json
{
  "type": "anyComponentStyle",
  "maximumWarning": "4kb",
  "maximumError": "8kb"
}
```

### Current CSS File Sizes

| File                                            | Size        | Status        | Exceeds Limit By |
| ----------------------------------------------- | ----------- | ------------- | ---------------- |
| `chat-message-content.component.scss`           | 13.0 KB     | ❌ EXCEEDS    | +5 KB (162%)     |
| `chat-messages-list.component.scss`             | 9.2 KB      | ❌ EXCEEDS    | +1.2 KB (115%)   |
| `chat-messages-list.component.scss` (duplicate) | 8.5 KB      | ⚠️ NEAR LIMIT | +0.5 KB (106%)   |
| **Total**                                       | **30.7 KB** | ❌ CRITICAL   | -                |

### Root Cause Analysis

**1. Massive Duplication** (60-70% of CSS)

- ✅ **Color tokens**: VS Code CSS variables repeated 40+ times across components
- ✅ **Layout patterns**: Flexbox/grid patterns duplicated in every component
- ✅ **Typography**: Font sizing, weights, families repeated everywhere
- ✅ **Animations**: `fadeIn`, `spin`, `pulse`, `typingDot` defined 3+ times
- ✅ **Spacing**: Padding/margin values hardcoded instead of using scale
- ✅ **Border radius**: Magic numbers (4px, 6px, 8px) scattered throughout
- ✅ **Transitions**: Same transition timings (`0.2s ease`, `0.15s ease`) duplicated
- ✅ **Button styles**: Action buttons styled separately in each component
- ✅ **Form elements**: Input/select/textarea styles duplicated
- ✅ **Scrollbar styling**: Webkit scrollbar styles repeated 3 times

**2. Lack of Design Token System**

- ❌ No centralized spacing scale (using magic numbers)
- ❌ No typography scale (font sizes hardcoded)
- ❌ No animation timing constants
- ❌ No z-index management system
- ❌ No breakpoint constants

**3. Component Over-Styling**

- 🔴 **chat-message-content.component.scss** (13KB):
  - Tool visualization styles (could be extracted)
  - File attachment styles (reusable pattern)
  - Code block styles (duplicates editor styles)
  - Typography styles (duplicates global patterns)
  - Responsive media queries (same breakpoints everywhere)
  - Accessibility media queries (duplicated)

**4. Missing Shared UI Utilities**

- No utility classes for common patterns
- No mixins for repeated styles
- No shared component base classes

---

## 🎯 Consolidation Strategy

### Phase 1: Create Design Token System (PRIORITY)

**Timeline**: 2 hours  
**Impact**: Reduces CSS by ~40%

#### 1.1 Create Shared Design Tokens Library

**Location**: `libs/frontend/shared-ui/src/lib/styles/`

**File Structure**:

```
libs/frontend/shared-ui/src/lib/styles/
  ├── _tokens.scss              # Design tokens (variables)
  ├── _mixins.scss              # Reusable mixins
  ├── _animations.scss          # Global animations
  ├── _utilities.scss           # Utility classes
  ├── _components-base.scss     # Base component patterns
  └── index.scss                # Barrel export
```

**\_tokens.scss** (Design Token System):

```scss
/**
 * Design Tokens for VS Code Extension
 * Single source of truth for all design values
 */

// Spacing Scale (based on 4px baseline grid)
$spacing-0: 0;
$spacing-1: 0.25rem; // 4px
$spacing-2: 0.5rem; // 8px
$spacing-3: 0.75rem; // 12px
$spacing-4: 1rem; // 16px
$spacing-5: 1.25rem; // 20px
$spacing-6: 1.5rem; // 24px
$spacing-8: 2rem; // 32px
$spacing-10: 2.5rem; // 40px
$spacing-12: 3rem; // 48px

// Typography Scale
$font-size-xs: 0.75rem; // 12px
$font-size-sm: 0.8rem; // 13px
$font-size-base: 0.85rem; // 14px
$font-size-md: 0.9rem; // 15px
$font-size-lg: 1rem; // 16px
$font-size-xl: 1.1rem; // 18px
$font-size-2xl: 1.3rem; // 21px
$font-size-3xl: 1.5rem; // 24px

// Font Weights
$font-weight-light: 300;
$font-weight-normal: 400;
$font-weight-medium: 500;
$font-weight-semibold: 600;
$font-weight-bold: 700;

// Border Radius Scale
$radius-none: 0;
$radius-sm: 2px;
$radius-md: 4px;
$radius-lg: 6px;
$radius-xl: 8px;
$radius-2xl: 12px;
$radius-full: 50%;

// Transitions
$transition-fast: 0.15s ease;
$transition-base: 0.2s ease;
$transition-slow: 0.3s ease;

// Z-Index Scale (prevents z-index wars)
$z-base: 1;
$z-dropdown: 10;
$z-sticky: 20;
$z-overlay: 30;
$z-modal: 40;
$z-popover: 50;
$z-tooltip: 60;

// Layout Breakpoints
$breakpoint-sm: 576px;
$breakpoint-md: 768px;
$breakpoint-lg: 992px;
$breakpoint-xl: 1200px;

// Component Sizes
$button-height-sm: 24px;
$button-height-md: 32px;
$button-height-lg: 40px;

$input-height-sm: 24px;
$input-height-md: 32px;
$input-height-lg: 40px;

// Icon Sizes
$icon-sm: 1rem; // 16px
$icon-md: 1.25rem; // 20px
$icon-lg: 1.5rem; // 24px
$icon-xl: 2rem; // 32px
```

**\_mixins.scss** (Reusable Style Patterns):

```scss
/**
 * Reusable Mixins for Common Patterns
 */

// Flexbox Patterns
@mixin flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

@mixin flex-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

@mixin flex-column {
  display: flex;
  flex-direction: column;
}

// Card Pattern (used in messages, tools, files)
@mixin card-base {
  background-color: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: $radius-lg;
  overflow: hidden;
}

// Action Button Pattern (copy, regenerate, export buttons)
@mixin action-button {
  padding: $spacing-2 $spacing-3;
  border: 1px solid var(--vscode-button-border);
  border-radius: $radius-md;
  background-color: transparent;
  color: var(--vscode-foreground);
  font-size: $font-size-sm;
  cursor: pointer;
  transition: all $transition-base;
  @include flex-center;
  gap: $spacing-1;

  &:hover {
    background-color: var(--vscode-button-hoverBackground);
  }

  &:active {
    transform: scale(0.98);
  }
}

// Badge Pattern (tokens, tools, status)
@mixin badge {
  font-size: $font-size-xs;
  background-color: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  padding: 2px 6px;
  border-radius: $radius-2xl;
  @include flex-center;
  gap: $spacing-1;
}

// Code Block Pattern
@mixin code-inline {
  background-color: var(--vscode-textCodeBlock-background);
  color: var(--vscode-textPreformat-foreground);
  padding: 2px 4px;
  border-radius: $radius-sm;
  font-family: var(--vscode-editor-font-family);
  font-size: 0.9em;
}

// Scrollbar Pattern
@mixin custom-scrollbar($width: 8px) {
  &::-webkit-scrollbar {
    width: $width;
    height: $width;
  }

  &::-webkit-scrollbar-track {
    background-color: var(--vscode-scrollbar-shadow);
  }

  &::-webkit-scrollbar-thumb {
    background-color: var(--vscode-scrollbarSlider-background);
    border-radius: $radius-md;
    transition: background-color $transition-base;

    &:hover {
      background-color: var(--vscode-scrollbarSlider-hoverBackground);
    }
  }
}

// Responsive Breakpoints
@mixin mobile {
  @media (max-width: #{$breakpoint-md - 1px}) {
    @content;
  }
}

@mixin tablet {
  @media (min-width: $breakpoint-md) and (max-width: #{$breakpoint-lg - 1px}) {
    @content;
  }
}

@mixin desktop {
  @media (min-width: $breakpoint-lg) {
    @content;
  }
}

// Accessibility
@mixin focus-visible {
  &:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
}

@mixin high-contrast {
  @media (prefers-contrast: high) {
    @content;
  }
}

@mixin reduced-motion {
  @media (prefers-reduced-motion: reduce) {
    @content;
  }
}
```

**\_animations.scss** (Global Animations):

```scss
/**
 * Global Animation Definitions
 * Define once, use everywhere
 */

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@keyframes typingDot {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

@keyframes toolRunning {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}

// Animation Utilities (can be used as classes)
.animate-fade-in {
  animation: fadeIn $transition-slow;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

.animate-pulse {
  animation: pulse 1.5s infinite;
}
```

**\_utilities.scss** (Utility Classes):

```scss
/**
 * Utility Classes for Common Patterns
 * Avoid inline styles, use these instead
 */

// Spacing Utilities
.p-0 {
  padding: $spacing-0;
}
.p-1 {
  padding: $spacing-1;
}
.p-2 {
  padding: $spacing-2;
}
.p-3 {
  padding: $spacing-3;
}
.p-4 {
  padding: $spacing-4;
}
.p-5 {
  padding: $spacing-5;
}
.p-6 {
  padding: $spacing-6;
}

.m-0 {
  margin: $spacing-0;
}
.m-1 {
  margin: $spacing-1;
}
.m-2 {
  margin: $spacing-2;
}
.m-3 {
  margin: $spacing-3;
}
.m-4 {
  margin: $spacing-4;
}
.m-5 {
  margin: $spacing-5;
}
.m-6 {
  margin: $spacing-6;
}

// Flexbox Utilities
.flex {
  display: flex;
}
.flex-column {
  @include flex-column;
}
.flex-center {
  @include flex-center;
}
.flex-between {
  @include flex-between;
}
.gap-1 {
  gap: $spacing-1;
}
.gap-2 {
  gap: $spacing-2;
}
.gap-3 {
  gap: $spacing-3;
}
.gap-4 {
  gap: $spacing-4;
}

// Text Utilities
.text-xs {
  font-size: $font-size-xs;
}
.text-sm {
  font-size: $font-size-sm;
}
.text-base {
  font-size: $font-size-base;
}
.text-lg {
  font-size: $font-size-lg;
}
.text-xl {
  font-size: $font-size-xl;
}

.font-light {
  font-weight: $font-weight-light;
}
.font-normal {
  font-weight: $font-weight-normal;
}
.font-medium {
  font-weight: $font-weight-medium;
}
.font-semibold {
  font-weight: $font-weight-semibold;
}
.font-bold {
  font-weight: $font-weight-bold;
}

// Border Utilities
.rounded-none {
  border-radius: $radius-none;
}
.rounded-sm {
  border-radius: $radius-sm;
}
.rounded-md {
  border-radius: $radius-md;
}
.rounded-lg {
  border-radius: $radius-lg;
}
.rounded-xl {
  border-radius: $radius-xl;
}
.rounded-full {
  border-radius: $radius-full;
}

// Transition Utilities
.transition-fast {
  transition: all $transition-fast;
}
.transition-base {
  transition: all $transition-base;
}
.transition-slow {
  transition: all $transition-slow;
}
```

#### 1.2 Update Component Imports

**Every component SCSS file should import**:

```scss
@import '@ptah-extension/shared-ui/styles';

// Then use tokens instead of magic numbers
.my-component {
  padding: $spacing-4; // Instead of: padding: 1rem;
  font-size: $font-size-base; // Instead of: font-size: 0.85rem;
  border-radius: $radius-lg; // Instead of: border-radius: 6px;
  transition: all $transition-base; // Instead of: transition: all 0.2s ease;
}
```

---

### Phase 2: Extract Shared Component Patterns (IMMEDIATE)

**Timeline**: 3 hours  
**Impact**: Reduces CSS by ~30%

#### 2.1 Create Shared Component Base Styles

**Location**: `libs/frontend/shared-ui/src/lib/styles/_components-base.scss`

```scss
/**
 * Base Component Patterns
 * Shared across multiple components
 */

// Message Content Base (used by chat-message-content, tool-use-block)
.message-content-base {
  padding: $spacing-4 $spacing-5;
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  border-radius: $radius-xl;
  position: relative;
}

// Tool/File Card Base (used by tool-use-block, file-item)
.card-interactive {
  @include card-base;
  transition: all $transition-base;
  cursor: pointer;

  &:hover {
    background-color: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-focusBorder);
  }
}

// Typography Content (used by all message content areas)
.typography-content {
  font-family: var(--vscode-editor-font-family);
  word-wrap: break-word;
  overflow-wrap: break-word;

  p {
    margin: 0 0 $spacing-4 0;
    line-height: 1.6;
  }
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: $spacing-5 0 $spacing-3 0;
    font-weight: $font-weight-semibold;
    line-height: 1.3;
  }
  h1 {
    font-size: $font-size-3xl;
  }
  h2 {
    font-size: $font-size-2xl;
  }
  h3 {
    font-size: $font-size-xl;
  }

  code {
    @include code-inline;
  }

  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    &:hover {
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
    }
  }

  ul,
  ol {
    margin: $spacing-3 0;
    padding-left: $spacing-8;
  }

  blockquote {
    margin: $spacing-4 0;
    padding: $spacing-3 $spacing-4;
    border-left: 3px solid var(--vscode-textLink-foreground);
    background-color: var(--vscode-textBlockQuote-background);
  }
}

// Loading Spinner (used in multiple components)
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--vscode-widget-border);
  border-top-color: var(--vscode-progressBar-foreground);
  border-radius: $radius-full;
  animation: spin 1s linear infinite;
}

// Typing Dots Animation (used in chat, streaming)
.typing-dots {
  @include flex-center;
  gap: 4px;

  span {
    width: 6px;
    height: 6px;
    border-radius: $radius-full;
    background-color: var(--vscode-progressBar-foreground);
    animation: typingDot 1.4s infinite;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }
    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}
```

#### 2.2 Refactor chat-message-content.component.scss

**Before** (13KB) → **After** (~4KB)

```scss
@import '@ptah-extension/shared-ui/styles';

.claude-message-content {
  @extend .message-content-base;

  &.streaming {
    border-left: 3px solid var(--vscode-progressBar-foreground);
    background-color: var(--vscode-editor-lineHighlightBackground);
  }
}

.message-header {
  @include flex-column;
  gap: $spacing-2;
  margin-bottom: $spacing-4;
  padding-bottom: $spacing-3;
  border-bottom: 1px solid var(--vscode-widget-border);
}

.text-content {
  @extend .typography-content;
}

.tool-use-block {
  @extend .card-interactive;

  &.running {
    border-left: 3px solid var(--vscode-progressBar-foreground);
    animation: toolRunning 2s infinite;
  }
}

// Only component-specific styles remain
// ~70% of CSS removed via shared patterns
```

---

### Phase 3: Build Optimization (NEXT)

**Timeline**: 1 hour  
**Impact**: Reduces CSS by ~20% through minification

#### 3.1 Enable CSS Optimization in angular.json

```json
{
  "optimization": {
    "scripts": true,
    "styles": {
      "minify": true,
      "inlineCritical": true
    },
    "fonts": true
  }
}
```

#### 3.2 PurgeCSS Configuration (Remove Unused Styles)

**Install**: `npm install -D @fullhuman/postcss-purgecss`

**postcss.config.js**:

```javascript
module.exports = {
  plugins: [
    require('@fullhuman/postcss-purgecss')({
      content: ['./apps/ptah-extension-webview/src/**/*.{html,ts}', './libs/frontend/**/*.{html,ts}'],
      safelist: {
        // Preserve VS Code CSS variables
        standard: [/^vscode-/],
        // Preserve animation classes
        deep: [/animate-/, /typing-/, /streaming-/],
      },
    }),
  ],
};
```

---

### Phase 4: Performance Monitoring (CONTINUOUS)

**Timeline**: 30 minutes  
**Impact**: Prevents future regressions

#### 4.1 Stricter Budget Limits

```json
{
  "budgets": [
    {
      "type": "initial",
      "maximumWarning": "400kb",
      "maximumError": "500kb"
    },
    {
      "type": "anyComponentStyle",
      "maximumWarning": "2kb", // 50% of current
      "maximumError": "4kb" // 50% of current
    }
  ]
}
```

#### 4.2 Pre-Commit Hook for CSS Size

**`.husky/pre-commit`**:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Check CSS file sizes
for file in $(git diff --cached --name-only | grep '\.scss$'); do
  size=$(wc -c < "$file")
  if [ $size -gt 4096 ]; then
    echo "❌ ERROR: $file exceeds 4KB ($size bytes)"
    echo "   Consider extracting shared styles to design token system"
    exit 1
  fi
done
```

---

## 📊 Expected Outcomes

### Before Consolidation

| Metric                      | Value   | Status      |
| --------------------------- | ------- | ----------- |
| Largest component CSS       | 13.0 KB | ❌ FAIL     |
| Total CSS across components | 30.7 KB | ❌ BLOATED  |
| Duplication rate            | ~70%    | ❌ CRITICAL |
| Build warnings              | 3       | ⚠️ WARNING  |

### After Consolidation

| Metric                      | Value | Status       | Improvement      |
| --------------------------- | ----- | ------------ | ---------------- |
| Largest component CSS       | ~4 KB | ✅ PASS      | **-69%**         |
| Total CSS across components | ~9 KB | ✅ OPTIMIZED | **-71%**         |
| Duplication rate            | <10%  | ✅ MINIMAL   | **-86%**         |
| Build warnings              | 0     | ✅ CLEAN     | **-100%**        |
| Bundle size reduction       | -     | ✅ IMPROVED  | **~21 KB saved** |

---

## 🚀 Implementation Roadmap

### Week 1: Foundation (Days 1-2)

- [ ] Create `libs/frontend/shared-ui/src/lib/styles/` directory structure
- [ ] Implement `_tokens.scss` with complete design token system
- [ ] Implement `_mixins.scss` with all reusable patterns
- [ ] Implement `_animations.scss` with global animations
- [ ] Implement `_utilities.scss` with utility classes
- [ ] Implement `_components-base.scss` with shared component patterns
- [ ] Create `index.scss` barrel export
- [ ] Update `libs/frontend/shared-ui/project.json` to include styles in build

### Week 1: Component Refactoring (Days 3-4)

- [ ] Refactor `chat-message-content.component.scss` (13KB → 4KB)
  - Replace magic numbers with tokens
  - Use shared mixins for cards, buttons, badges
  - Extract typography to shared pattern
  - Use global animations
  - Remove duplicated scrollbar styles
- [ ] Refactor `chat-messages-list.component.scss` (9.2KB → 3KB)
  - Use shared card patterns
  - Use shared button/action patterns
  - Replace hardcoded spacing with tokens
  - Use global animations
- [ ] Refactor `chat-messages-list.component.scss` duplicate (8.5KB → 2.5KB)
- [ ] Validate all components compile and render correctly

### Week 1: Build Optimization (Day 5)

- [ ] Enable CSS optimization in `project.json`
- [ ] Configure PurgeCSS for unused style removal
- [ ] Update budget limits to stricter values
- [ ] Add pre-commit hook for CSS size validation
- [ ] Run full build and validate bundle sizes
- [ ] Document CSS guidelines in `CLAUDE.md`

### Week 2: Validation & Documentation

- [ ] Run `npm run build` and verify 0 budget warnings
- [ ] Measure bundle size reduction
- [ ] Visual regression testing (screenshot comparison)
- [ ] Update `CSS_CONSOLIDATION_PLAN.md` with results
- [ ] Create PR with comprehensive before/after metrics
- [ ] Update task progress in `progress.md`

---

## 🎯 Success Criteria

### Build Metrics

- ✅ **0 CSS budget warnings** in production build
- ✅ **All component styles <4KB** each
- ✅ **Total CSS bundle <10KB** (from 30.7KB)
- ✅ **Build time unchanged or improved**

### Code Quality

- ✅ **<10% CSS duplication** (from 70%)
- ✅ **100% design token usage** (no magic numbers)
- ✅ **All animations in global file** (no duplicates)
- ✅ **Consistent spacing/sizing** across all components

### User Experience

- ✅ **No visual regressions** (pixel-perfect preservation)
- ✅ **Extension load time improved** (smaller bundle)
- ✅ **Theme switching still works** (VS Code CSS variables preserved)
- ✅ **Accessibility unchanged** (all a11y features intact)

---

## 📝 Documentation Updates Required

### 1. CLAUDE.md - CSS Guidelines Section

Add section on mandatory design token usage:

```markdown
### CSS/SCSS Guidelines

- **ALWAYS** import shared styles: `@import '@ptah-extension/shared-ui/styles';`
- **NEVER** use magic numbers - use design tokens ($spacing-4, $radius-lg, etc.)
- **NEVER** duplicate animations - use global definitions
- **NEVER** inline scrollbar styles - use `@include custom-scrollbar;`
- **Component styles MUST be <4KB** - extract shared patterns if exceeding
```

### 2. shared-ui README

Create `libs/frontend/shared-ui/README.md` with:

- Design token reference table
- Mixin usage examples
- Animation catalog
- Utility class reference
- Component pattern examples

### 3. Migration Guide

Create `docs/CSS_MIGRATION_GUIDE.md` with:

- Step-by-step refactoring process
- Before/after examples
- Common pitfalls
- Performance tips

---

## ⚠️ Risks & Mitigation

### Risk 1: Visual Regressions

**Likelihood**: MEDIUM  
**Impact**: HIGH  
**Mitigation**:

- Screenshot-based visual regression testing
- Manual QA in Extension Development Host
- Incremental refactoring (one component at a time)
- Git branch per component for easy rollback

### Risk 2: VS Code Theme Compatibility

**Likelihood**: LOW  
**Impact**: HIGH  
**Mitigation**:

- Preserve all `var(--vscode-*)` variables
- Test in Light, Dark, and High Contrast themes
- Add theme testing to QA checklist

### Risk 3: Build System Changes

**Likelihood**: LOW  
**Impact**: MEDIUM  
**Mitigation**:

- Test build system changes in isolation
- Validate with `nx build shared-ui` before integration
- Document all build config changes

### Risk 4: Import Path Issues

**Likelihood**: MEDIUM  
**Impact**: LOW  
**Mitigation**:

- Use TypeScript path aliases (`@ptah-extension/shared-ui/styles`)
- Add to `tsconfig.base.json` paths
- Test imports in multiple components

---

## 📈 Metrics & Tracking

### Daily Progress Tracking

```markdown
## Day 1 Progress

- [ ] Design tokens file created
- [ ] Mixins file created
- [ ] Component styles <XKB>
- [ ] Build passing: Yes/No

## Day 2 Progress

...
```

### Final Report Template

```markdown
## CSS Consolidation Final Report

**Date Completed**: YYYY-MM-DD
**Total Time**: X hours

### Metrics

| Metric           | Before  | After | Improvement |
| ---------------- | ------- | ----- | ----------- |
| Largest CSS file | 13.0 KB | X KB  | -XX%        |
| Total CSS        | 30.7 KB | X KB  | -XX%        |
| Duplication      | 70%     | X%    | -XX%        |
| Build warnings   | 3       | X     | -XX%        |

### Files Refactored

- chat-message-content.component.scss: 13.0KB → XKB (-XX%)
- chat-messages-list.component.scss: 9.2KB → XKB (-XX%)
- ...

### Deliverables

- ✅ Design token system
- ✅ Shared mixin library
- ✅ Global animations
- ✅ Utility classes
- ✅ Component base patterns
- ✅ All components refactored
- ✅ Build optimization enabled
- ✅ Documentation updated
```

---

## 🎓 Lessons Learned (Post-Implementation)

_To be filled after implementation_

### What Worked Well

-

### What Could Be Improved

-

### Recommendations for Future

-

---

**Status**: 📋 PLANNED - Ready for Implementation  
**Priority**: 🔴 P0 CRITICAL  
**Estimated Effort**: 5-6 hours (1 working day)  
**Risk Level**: MEDIUM (visual regressions possible)  
**Next Action**: Create design token system files
