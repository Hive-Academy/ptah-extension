# Implementation Plan - TASK_2025_118: Migrate Inline SVGs to Lucide Angular

## Codebase Investigation Summary

### Libraries Discovered

| Library        | Version  | Path                        | Purpose                          |
| -------------- | -------- | --------------------------- | -------------------------------- |
| lucide-angular | ^0.542.0 | node_modules/lucide-angular | Icon library (already installed) |
| @angular/core  | ~20.1.0  | Root dependencies           | Component framework              |

**Key Finding**: Lucide Angular is already installed (v0.542.0) and used extensively in the webview app (`apps/ptah-extension-webview`) and chat library (`libs/frontend/chat`). The landing page (`apps/ptah-landing-page`) does NOT currently use it.

### Patterns Identified

**Pattern 1: Component-Level Icon Import (Verified)**

- **Evidence**: `libs/frontend/chat/src/lib/components/atoms/copy-button.component.ts:9`
- **Evidence**: `libs/frontend/chat/src/lib/components/atoms/theme-toggle.component.ts:2`
- **Evidence**: `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts:11`

```typescript
// Import LucideAngularModule + specific icons
import { LucideAngularModule, Check, Copy } from 'lucide-angular';

@Component({
  imports: [LucideAngularModule], // Add to imports array
  template: ` <lucide-angular [img]="CheckIcon" class="w-5 h-5" /> `,
})
export class MyComponent {
  readonly CheckIcon = Check; // Store icon reference as class property
}
```

**Pattern 2: Dynamic Icon Switching (Verified)**

- **Evidence**: `libs/frontend/chat/src/lib/components/atoms/copy-button.component.ts:36-39`

```typescript
<lucide-angular
  [img]="isCopied() ? CheckIcon : CopyIcon"
  class="w-3.5 h-3.5"
/>
```

**Pattern 3: Icon Sizing via Tailwind Classes (Verified)**

- **Evidence**: `apps/ptah-extension-webview/src/styles.css:878-910`
- Size classes: `w-3`, `w-3.5`, `w-4`, `w-5`, `w-6` control SVG dimensions

### SVG Inventory (8 Files, 23 Inline SVGs)

| File                                    | Line Range                | Icon Type          | Lucide Equivalent | Notes               |
| --------------------------------------- | ------------------------- | ------------------ | ----------------- | ------------------- |
| `navigation.component.ts`               | 89-101                    | GitHub             | `Github`          | Brand icon          |
| `plan-card.component.ts`                | 75-87                     | Checkmark          | `Check`           | Feature list item   |
| `pricing-grid.component.ts`             | 44-56                     | Alert/Warning      | `TriangleAlert`   | Warning alert       |
| `pricing-grid.component.ts`             | 64-76                     | Error/X Circle     | `CircleX`         | Error alert         |
| `cta-section.component.ts`              | 102-112                   | Checkmark (filled) | `Check`           | Trust signal        |
| `features-hijacked-scroll.component.ts` | 80-87                     | Eye                | `Eye`             | Badge icon          |
| `features-hijacked-scroll.component.ts` | 295-307                   | Checkmark (stroke) | `Check`           | Feature note        |
| `profile-page.component.ts`             | 162-174                   | Checkmark          | `Check`           | Feature list item   |
| `signup-page.component.ts`              | 56-76                     | Ptah Logo          | Custom SVG        | Extract to asset    |
| `signup-page.component.ts`              | 97-101                    | GitHub             | `Github`          | OAuth button        |
| `signup-page.component.ts`              | 111-128                   | Google             | Custom SVG        | Colored Google logo |
| `signup-page.component.ts`              | 138-149                   | Mail/Email         | `Mail`            | Email signup        |
| `signup-page.component.ts`              | 162-173, 177-188, 192-203 | Checkmark (3x)     | `Check`           | Features list       |
| `login-page.component.ts`               | 54-73                     | Ptah Logo          | Custom SVG        | Extract to asset    |
| `login-page.component.ts`               | 90-101                    | Error/Alert        | `CircleAlert`     | Error message       |
| `login-page.component.ts`               | 129-132                   | GitHub             | `Github`          | OAuth button        |
| `login-page.component.ts`               | 143-159                   | Google             | Custom SVG        | Colored Google logo |
| `login-page.component.ts`               | 170-181                   | Mail/Email         | `Mail`            | Email login         |

### Icons Required from Lucide

| Lucide Icon   | Import Name     | Usage Count | Components                                               |
| ------------- | --------------- | ----------- | -------------------------------------------------------- |
| Check         | `Check`         | 12          | plan-card, cta-section, features, profile, signup, login |
| Github        | `Github`        | 3           | navigation, signup, login                                |
| Mail          | `Mail`          | 2           | signup, login                                            |
| Eye           | `Eye`           | 1           | features-hijacked-scroll                                 |
| TriangleAlert | `TriangleAlert` | 1           | pricing-grid (warning)                                   |
| CircleX       | `CircleX`       | 1           | pricing-grid (error)                                     |
| CircleAlert   | `CircleAlert`   | 1           | login (error message)                                    |

### Custom SVGs (Cannot Use Lucide)

| SVG         | Files         | Reason                              | Solution                                  |
| ----------- | ------------- | ----------------------------------- | ----------------------------------------- |
| Ptah Logo   | signup, login | Custom brand logo (100x100 viewBox) | Extract to `assets/icons/ptah-logo.svg`   |
| Google Logo | signup, login | Multi-colored brand logo            | Extract to `assets/icons/google-logo.svg` |

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Direct Replacement Pattern**: Replace all inline SVGs with Lucide Angular components using the established pattern from `libs/frontend/chat`. No backward compatibility - clean migration.

### Component Specifications

#### Component 1: NavigationComponent

**Purpose**: Replace GitHub icon with Lucide `Github`
**Pattern**: Component-level icon import (verified from chat library)
**Evidence**: `libs/frontend/chat/src/lib/components/atoms/copy-button.component.ts:9`

**Current Implementation** (lines 89-101):

```html
<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
  <path fill-rule="evenodd" d="M12 2C6.477 2..." clip-rule="evenodd" />
</svg>
```

**Target Implementation**:

```typescript
import { LucideAngularModule, Github } from 'lucide-angular';

@Component({
  imports: [CommonModule, NgOptimizedImage, RouterLink, LucideAngularModule],
  // ...
})
export class NavigationComponent {
  readonly GithubIcon = Github;
}
```

```html
<lucide-angular [img]="GithubIcon" class="w-5 h-5" />
```

**Quality Requirements**:

- Icon must inherit `currentColor` for hover effects
- Size must remain `w-5 h-5` (20px)
- Accessibility: Keep `aria-hidden="true"` on icon

**Files Affected**:

- `apps/ptah-landing-page/src/app/components/navigation.component.ts` (MODIFY)

---

#### Component 2: PlanCardComponent

**Purpose**: Replace checkmark icon with Lucide `Check`
**Pattern**: Component-level icon import
**Evidence**: `libs/frontend/chat/src/lib/components/molecules/diff-display.component.ts:8`

**Current Implementation** (lines 75-87):

```html
<svg class="flex-shrink-0 w-5 h-5 text-success mt-0.5" viewBox="0 0 20 20" fill="none">
  <path d="M16.25 5.625L7.5 14.375L3.75 10.625" stroke="currentColor" stroke-width="2" ... />
</svg>
```

**Target Implementation**:

```typescript
import { LucideAngularModule, Check } from 'lucide-angular';

@Component({
  imports: [NgOptimizedImage, LucideAngularModule],
})
export class PlanCardComponent {
  readonly CheckIcon = Check;
}
```

```html
<lucide-angular [img]="CheckIcon" class="flex-shrink-0 w-5 h-5 text-success mt-0.5" />
```

**Quality Requirements**:

- Stroke-based icon matches Lucide's default style
- Color via `text-success` class preserved
- Alignment via `mt-0.5` preserved

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/plan-card.component.ts` (MODIFY)

---

#### Component 3: PricingGridComponent

**Purpose**: Replace alert icons with Lucide `TriangleAlert` and `CircleX`
**Pattern**: Component-level icon import
**Evidence**: `libs/frontend/chat/src/lib/components/molecules/resume-notification-banner.component.ts:10`

**Current Implementation** (lines 44-56, 64-76):

```html
<!-- Warning alert (triangle) -->
<svg class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856..." />
</svg>

<!-- Error alert (circle X) -->
<svg class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
</svg>
```

**Target Implementation**:

```typescript
import { LucideAngularModule, TriangleAlert, CircleX } from 'lucide-angular';

@Component({
  imports: [PlanCardComponent, ViewportAnimationDirective, LucideAngularModule],
})
export class PricingGridComponent {
  readonly TriangleAlertIcon = TriangleAlert;
  readonly CircleXIcon = CircleX;
}
```

```html
<lucide-angular [img]="TriangleAlertIcon" class="stroke-current shrink-0 h-6 w-6" /> <lucide-angular [img]="CircleXIcon" class="stroke-current shrink-0 h-6 w-6" />
```

**Quality Requirements**:

- DaisyUI alert styling preserved
- `stroke-current` for inherited color
- Size `h-6 w-6` (24px) preserved

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts` (MODIFY)

---

#### Component 4: CTASectionComponent

**Purpose**: Replace checkmark icon with Lucide `Check`
**Pattern**: Component-level icon import
**Evidence**: Same as PlanCardComponent

**Current Implementation** (lines 102-112):

```html
<svg class="w-5 h-5 text-success" fill="currentColor" viewBox="0 0 20 20">
  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8..." clip-rule="evenodd" />
</svg>
```

**Target Implementation**:

```typescript
import { LucideAngularModule, Check } from 'lucide-angular';

@Component({
  imports: [CommonModule, ViewportAnimationDirective, LucideAngularModule],
})
export class CTASectionComponent {
  readonly CheckIcon = Check;
}
```

```html
<lucide-angular [img]="CheckIcon" class="w-5 h-5 text-success" />
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/sections/cta/cta-section.component.ts` (MODIFY)

---

#### Component 5: FeaturesHijackedScrollComponent

**Purpose**: Replace Eye and Check icons with Lucide equivalents
**Pattern**: Component-level icon import
**Evidence**: Same established pattern

**Current Implementation**:

- Eye icon (lines 80-87): Hero badge "NEXT-GEN VISIBILITY"
- Check icon (lines 295-307): Feature notes checkmark

**Target Implementation**:

```typescript
import { LucideAngularModule, Eye, Check } from 'lucide-angular';

@Component({
  imports: [NgClass, NgOptimizedImage, FeatureShowcaseTimelineComponent, ViewportAnimationDirective, ScrollAnimationDirective, LucideAngularModule],
})
export class FeaturesHijackedScrollComponent {
  readonly EyeIcon = Eye;
  readonly CheckIcon = Check;
}
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/sections/features/features-hijacked-scroll.component.ts` (MODIFY)

---

#### Component 6: ProfilePageComponent

**Purpose**: Replace checkmark icon with Lucide `Check`
**Pattern**: Component-level icon import

**Current Implementation** (lines 162-174):

```html
<svg class="w-5 h-5 text-success flex-shrink-0" viewBox="0 0 20 20" fill="none">
  <path d="M16.25 5.625L7.5 14.375L3.75 10.625" stroke="currentColor" stroke-width="2" ... />
</svg>
```

**Target Implementation**:

```typescript
import { LucideAngularModule, Check } from 'lucide-angular';

@Component({
  imports: [ViewportAnimationDirective, RouterLink, NgOptimizedImage, LucideAngularModule],
})
export class ProfilePageComponent {
  readonly CheckIcon = Check;
}
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts` (MODIFY)

---

#### Component 7: SignupPageComponent

**Purpose**: Replace GitHub, Mail icons with Lucide; extract custom SVGs to assets
**Pattern**: Component-level icon import + asset extraction

**Current Implementation**:

- Ptah Logo (lines 56-76): Custom SVG - must extract
- GitHub (lines 97-101): Replace with Lucide `Github`
- Google (lines 111-128): Custom multi-color SVG - must extract
- Mail (lines 138-149): Replace with Lucide `Mail`
- Check (lines 162-173, 177-188, 192-203): Replace with Lucide `Check`

**Target Implementation**:

```typescript
import { LucideAngularModule, Github, Mail, Check } from 'lucide-angular';

@Component({
  imports: [FormsModule, ViewportAnimationDirective, RouterLink, LucideAngularModule],
})
export class SignupPageComponent {
  readonly GithubIcon = Github;
  readonly MailIcon = Mail;
  readonly CheckIcon = Check;
}
```

**Asset Extraction**:

- Create `apps/ptah-landing-page/public/assets/icons/ptah-logo.svg`
- Create `apps/ptah-landing-page/public/assets/icons/google-logo.svg`

**Template Updates**:

```html
<!-- Ptah Logo - use img tag with extracted SVG -->
<img src="/assets/icons/ptah-logo.svg" alt="Ptah Logo" class="w-16 h-16 text-secondary animate-glow-pulse" />

<!-- Google Logo - use img tag with extracted SVG -->
<img src="/assets/icons/google-logo.svg" alt="Google" class="w-5 h-5" />

<!-- GitHub - Lucide -->
<lucide-angular [img]="GithubIcon" class="w-5 h-5" />

<!-- Mail - Lucide -->
<lucide-angular [img]="MailIcon" class="w-5 h-5" />

<!-- Check icons - Lucide -->
<lucide-angular [img]="CheckIcon" class="w-4 h-4 text-secondary" />
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/signup/signup-page.component.ts` (MODIFY)
- `apps/ptah-landing-page/public/assets/icons/ptah-logo.svg` (CREATE)
- `apps/ptah-landing-page/public/assets/icons/google-logo.svg` (CREATE)

---

#### Component 8: LoginPageComponent

**Purpose**: Replace GitHub, Mail, CircleAlert icons with Lucide; extract custom SVGs
**Pattern**: Component-level icon import + asset extraction

**Current Implementation**:

- Ptah Logo (lines 54-73): Custom SVG - reuse from signup asset
- Error Alert (lines 90-101): Replace with Lucide `CircleAlert`
- GitHub (lines 129-132): Replace with Lucide `Github`
- Google (lines 143-159): Custom multi-color SVG - reuse from signup asset
- Mail (lines 170-181): Replace with Lucide `Mail`

**Target Implementation**:

```typescript
import { LucideAngularModule, Github, Mail, CircleAlert } from 'lucide-angular';

@Component({
  imports: [FormsModule, ViewportAnimationDirective, RouterLink, LucideAngularModule],
})
export class LoginPageComponent {
  readonly GithubIcon = Github;
  readonly MailIcon = Mail;
  readonly CircleAlertIcon = CircleAlert;
}
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/login/login-page.component.ts` (MODIFY)

---

## Custom Asset Specifications

### Asset 1: Ptah Logo SVG

**Purpose**: Brand logo for auth pages
**Source**: `signup-page.component.ts` lines 56-76

**Target Path**: `apps/ptah-landing-page/public/assets/icons/ptah-logo.svg`

**SVG Content**:

```svg
<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="45" stroke="currentColor" stroke-width="3"/>
  <path d="M50 20 L50 80 M35 35 L65 35 M35 65 L65 65" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>
```

**Notes**:

- Uses `currentColor` for CSS color inheritance
- Stroke-based for consistent styling with Lucide

---

### Asset 2: Google Logo SVG

**Purpose**: Google OAuth button icon
**Source**: `signup-page.component.ts` lines 111-128

**Target Path**: `apps/ptah-landing-page/public/assets/icons/google-logo.svg`

**SVG Content**:

```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
</svg>
```

**Notes**:

- Multi-color Google brand colors (blue, green, yellow, red)
- Cannot use Lucide - requires exact brand colors

---

## Integration Architecture

### Integration Points

1. **LucideAngularModule**: Imported per-component (standalone pattern)
2. **Icon References**: Stored as class properties (not template literals)
3. **Styling**: Tailwind classes applied to `<lucide-angular>` element
4. **Asset Loading**: Standard Angular public assets via `/assets/icons/`

### No Global Configuration Required

Unlike some icon libraries, Lucide Angular v0.542.0 with standalone components does NOT require:

- App-level module configuration
- Icon registration in `app.config.ts`
- Provider setup

Each component imports only the icons it needs (tree-shakeable).

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

1. All 20+ inline SVGs replaced with Lucide components or extracted assets
2. Visual appearance unchanged (size, color, alignment)
3. Hover effects preserved (color transitions via `currentColor`)
4. Animations preserved (e.g., `animate-glow-pulse` on Ptah logo)

### Non-Functional Requirements

1. **Bundle Size**: Only imported icons included (tree-shaking)
2. **Performance**: No runtime SVG parsing (icons are pre-compiled)
3. **Maintainability**: Consistent icon usage pattern across landing page
4. **Accessibility**: `aria-hidden="true"` for decorative icons

### Pattern Compliance

- Must follow component-level import pattern (verified at `libs/frontend/chat`)
- Must use `[img]` binding (not `[name]` string binding)
- Must store icon as class property (not inline in template)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

1. Pure Angular component modifications
2. Template updates (HTML/Tailwind)
3. No backend or API changes
4. Familiar patterns from chat library

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-3 hours

**Breakdown**:

- Phase 1: Create asset files (15 min)
- Phase 2: Update 8 component files (1.5-2 hours)
- Phase 3: Visual verification (30 min)

### Files Affected Summary

**CREATE** (2 files):

- `apps/ptah-landing-page/public/assets/icons/ptah-logo.svg`
- `apps/ptah-landing-page/public/assets/icons/google-logo.svg`

**MODIFY** (8 files):

- `apps/ptah-landing-page/src/app/components/navigation.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/components/plan-card.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
- `apps/ptah-landing-page/src/app/sections/cta/cta-section.component.ts`
- `apps/ptah-landing-page/src/app/sections/features/features-hijacked-scroll.component.ts`
- `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts`
- `apps/ptah-landing-page/src/app/pages/signup/signup-page.component.ts`
- `apps/ptah-landing-page/src/app/pages/login/login-page.component.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in lucide-angular**:

   - `Check` from 'lucide-angular' (verified: lucide-icons.d.ts:320)
   - `Github` from 'lucide-angular' (verified: lucide-icons.d.ts:728)
   - `Mail` from 'lucide-angular' (verified: lucide-icons.d.ts:915)
   - `Eye` from 'lucide-angular' (verified: lucide-icons.d.ts:563)
   - `TriangleAlert` from 'lucide-angular' (verified: lucide-icons.d.ts:1518)
   - `CircleX` from 'lucide-angular' (verified: lucide-icons.d.ts:385)
   - `CircleAlert` from 'lucide-angular' (verified: lucide-icons.d.ts:342)

2. **Pattern verified from existing usage**:

   - `libs/frontend/chat/src/lib/components/atoms/copy-button.component.ts`
   - `libs/frontend/chat/src/lib/components/atoms/theme-toggle.component.ts`

3. **No hallucinated APIs**:
   - `LucideAngularModule` verified: `lib/lucide-angular.module.d.ts:5`
   - `[img]` binding verified: `lib/lucide-angular.component.d.ts:28`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/icons verified as existing in lucide-angular
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (LOW-MEDIUM)
- [x] Custom asset specifications included
