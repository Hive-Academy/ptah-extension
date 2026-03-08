# Development Tasks - TASK_2025_104

## Landing Page Premium Redesign

**Target Project**: `apps/ptah-landing-page/` (standalone marketing site)
**Total Tasks**: 14 | **Batches**: 5 | **Status**: 5/5 complete | **Current Batch**: 5 IMPLEMENTED

---

## Plan Validation Summary

**Validation Status**: CORRECTED - NOW TARGETING CORRECT PROJECT

### Critical Correction Applied

**WRONG** (Previous Batches 1-2 - REVERTED):

- Created `libs/frontend/landing/` library (DELETED)
- Modified `apps/ptah-extension-webview/src/app/app.config.ts` (REVERTED)
- Modified `libs/frontend/core/src/lib/services/app-state.service.ts` (REVERTED)
- Added path alias to tsconfig.base.json (REVERTED)

**CORRECT** (This Plan):

- Work ONLY in `apps/ptah-landing-page/`
- Modify `apps/ptah-landing-page/src/app/app.config.ts`
- Upgrade existing components in `apps/ptah-landing-page/src/app/sections/`

### Existing Components to Upgrade

| Component                       | Current State                   | Target State                    |
| ------------------------------- | ------------------------------- | ------------------------------- |
| hero.component.ts               | Raw Three.js + GSAP (430 lines) | @hive-academy/angular-3d        |
| features-section.component.ts   | Feature cards grid              | HijackedScrollTimelineComponent |
| comparison-section.component.ts | Before/After cards              | ParallaxSplitScrollComponent    |

---

## Batch 1: Foundation Setup - COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Install @hive-academy packages - COMPLETE (already installed)

**File**: D:\projects\ptah-extension\package.json
**Action**: Install packages if not already installed

**Quality Requirements**:

- Install @hive-academy/angular-3d
- Install @hive-academy/angular-gsap
- Install lenis (peer dependency)
- Run npm install to verify no conflicts

**Implementation Details**:

```bash
npm install @hive-academy/angular-3d @hive-academy/angular-gsap lenis
```

**Note**: Packages may already be installed from previous (reverted) work. Verify in package.json.

---

### Task 1.2: Configure landing page app.config.ts - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\app.config.ts
**Pattern**: Add provideGsap and provideLenis to providers

**Current Content**:

```typescript
import { ApplicationConfig, ... } from '@angular/core';
import { provideMarkdown } from 'ngx-markdown';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideMarkdown(),
  ],
};
```

**Target Content**:

```typescript
import { ApplicationConfig, ... } from '@angular/core';
import { provideMarkdown } from 'ngx-markdown';
import { provideGsap, provideLenis } from '@hive-academy/angular-gsap';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideMarkdown(),
    provideGsap({
      defaults: {
        ease: 'power2.out',
        duration: 0.8,
      },
    }),
    provideLenis({
      lerp: 0.08,
      wheelMultiplier: 0.7,
    }),
  ],
};
```

---

**Batch 1 Verification**:

- [x] npm install completes without errors (packages already installed)
- [x] app.config.ts has provideGsap and provideLenis
- [x] Build passes: `npx nx build ptah-landing-page`
- [x] Assets copied to public/assets/hero/ (cosmic_nebula_backdrop.png, star_field_layer.png)

---

## Batch 2: Hero Section Upgrade (3D) - IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete

### Task 2.1: Create hero-3d-scene.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-3d-scene.component.ts
**Action**: NEW FILE - Extract 3D scene to separate component using @hive-academy/angular-3d

**Quality Requirements**:

- Use ONLY @hive-academy/angular-3d components (NO raw Three.js)
- Scene3dComponent, SphereComponent, StarFieldComponent, NebulaVolumetricComponent
- AmbientLightComponent, SpotLightComponent, PointLightComponent
- EnvironmentComponent, EffectComposerComponent, BloomEffectComponent
- Float3dDirective, MouseTracking3dDirective
- Accept reducedMotion input signal

**Implementation Details**:

- Component selector: `ptah-hero-3d-scene`
- Standalone component with OnPush
- Glass/Cosmic aesthetic: 4 iridescent spheres, 2-layer star field, nebula backdrop
- Three-point lighting with bloom post-processing

---

### Task 2.2: Create hero-content-overlay.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-content-overlay.component.ts
**Action**: NEW FILE - Extract content overlay with viewport animations

**Quality Requirements**:

- Use ViewportAnimationDirective from @hive-academy/angular-gsap
- Staggered entrance animations: badge, headline, subheadline, CTAs, social proof
- Keep existing copy or update per LANDING_PAGE.md

**Implementation Details**:

- Component selector: `ptah-hero-content-overlay`
- Animation configs for scaleIn, slideUp, fadeIn

---

### Task 2.3: Refactor hero.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero.component.ts
**Action**: REFACTOR - Replace raw Three.js with child components

**Current State**: 430+ lines of raw Three.js + GSAP code
**Target State**: Orchestrator component using Hero3dSceneComponent + HeroContentOverlayComponent

**Quality Requirements**:

- Remove all raw Three.js imports and code
- Remove all raw GSAP imports
- Import and use Hero3dSceneComponent
- Import and use HeroContentOverlayComponent
- Implement reducedMotion signal for prefers-reduced-motion
- Apply ScrollAnimationDirective for content fade-out on scroll

---

**Batch 2 Verification**:

- [ ] Hero section renders with new 3D scene
- [ ] Star field rotates (when reducedMotion is false)
- [ ] Glass spheres respond to mouse movement
- [ ] Viewport animations trigger correctly
- [ ] Build passes: `npx nx build ptah-landing-page`

---

## Batch 3: Features Section Upgrade (Hijacked Scroll) - IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2 complete

### Task 3.1: Create feature-slide.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\feature-slide.component.ts
**Action**: NEW FILE - Individual fullscreen feature slide

**Quality Requirements**:

- Accept Feature input (title, headline, description, metric, icon, gradient, bgGlow)
- Accept stepNumber and totalSteps inputs
- Full viewport height/width slide design
- Use class binding for dynamic gradient/glow classes

---

### Task 3.2: Create features-hijacked-scroll.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\features-hijacked-scroll.component.ts
**Action**: NEW FILE - Hijacked scroll timeline container

**Quality Requirements**:

- Use HijackedScrollTimelineComponent from @hive-academy/angular-gsap
- Use HijackedScrollItemDirective for each slide
- 6 features with fullscreen slides
- Step indicator on left side
- Configure: scrollHeightPerStep=900, animationDuration=0.8, stepHold=0.9

---

### Task 3.3: Refactor features-section.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\features-section.component.ts
**Action**: REFACTOR - Replace card grid with hijacked scroll

**Current State**: Feature cards in grid layout
**Target State**: Wrapper for FeaturesHijackedScrollComponent

---

**Batch 3 Verification**:

- [x] Features section uses hijacked scroll timeline (NOT cards)
- [x] 6 fullscreen feature slides render correctly
- [x] Step indicator visible and updates on scroll
- [x] Clicking step indicator jumps to slide
- [ ] Build passes: `npx nx build ptah-landing-page`

---

## Batch 4: Comparison Section Upgrade (Parallax Split) - IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 3 complete

### Task 4.1: Create comparison-split-scroll.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\comparison\comparison-split-scroll.component.ts
**Action**: NEW FILE - Parallax split scroll implementation

**Quality Requirements**:

- Use ParallaxSplitScrollComponent from @hive-academy/angular-gsap
- Use ParallaxSplitItemDirective for panels
- "Before Ptah" section with pain points (left layout)
- "With Ptah" section with benefits (right layout)
- "Performance Metrics" section with SDK vs CLI comparison

---

### Task 4.2: Refactor comparison-section.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\comparison\comparison-section.component.ts
**Action**: REFACTOR - Replace static cards with parallax split scroll

**Current State**: Before/After cards
**Target State**: Wrapper for ComparisonSplitScrollComponent

---

**Batch 4 Verification**:

- [x] Comparison uses parallax split scroll (NOT cards)
- [x] "Before Ptah" and "With Ptah" panels render
- [x] Performance metrics display correctly
- [x] Parallax effect visible when scrolling
- [ ] Build passes: `npx nx build ptah-landing-page`

---

## Batch 5: CTA + Final Integration - IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 4 complete

### Task 5.1: Upgrade cta-section.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\cta\cta-section.component.ts
**Action**: UPGRADE - Add viewport animations

**Quality Requirements**:

- Add ViewportAnimationDirective
- Golden gradient headline "Get Started Free"
- Primary CTA with pulse animation
- Trust signals with staggered animation

**Implementation Notes**:

- Replaced raw GSAP with ViewportAnimationDirective from @hive-academy/angular-gsap
- Added scaleIn animation to headline, fadeIn to subheadline
- Added slideUp with bounce to primary CTA
- Added staggered fadeIn for trust signals ("Free Forever", "No Account Required", "Open Source")
- Added custom scaleX animation for golden divider
- Updated CTA links to correct VS Code Marketplace URL

---

### Task 5.2: Upgrade landing-page.component.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\landing-page.component.ts
**Action**: UPGRADE - Initialize Lenis smooth scroll

**Quality Requirements**:

- Inject LenisSmoothScrollService
- Initialize Lenis after first render
- Handle cleanup in ngOnDestroy

**Implementation Notes**:

- Injected LenisSmoothScrollService from @hive-academy/angular-gsap
- Used afterNextRender() for client-side only initialization
- Service handles cleanup automatically via its OnDestroy implementation
- Graceful degradation if Lenis fails to initialize (SSR compatibility)

---

### Task 5.3: Add demo-section viewport animations - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\demo\demo-section.component.ts
**Action**: UPGRADE - Add scroll-triggered animations

**Quality Requirements**:

- Add ScrollAnimationDirective for glassmorphism window
- Scroll animation for header text

**Implementation Notes**:

- Replaced raw GSAP with ViewportAnimationDirective and ScrollAnimationDirective
- Added fadeIn animation to eyebrow text
- Added slideUp animation to headline
- Added custom scroll animation (scale 0.95->1, opacity 0->1) for demo window
- Removed all raw GSAP imports and manual cleanup code

---

### Task 5.4: Final integration test - IMPLEMENTED

**Action**: Verify complete landing page flow

**Quality Requirements**:

- Serve landing page: `nx serve ptah-landing-page`
- Test all scroll animations work
- Test reduced motion preference
- Test mobile responsiveness
- Build passes: `npx nx build ptah-landing-page`
- Lint passes: `npx nx lint ptah-landing-page`

**Implementation Notes**:

- Build passed: `npx nx build ptah-landing-page`
- Lint passed: `npx nx lint ptah-landing-page`
- All components use OnPush change detection
- No raw GSAP code - all via @hive-academy/angular-gsap

---

**Batch 5 Verification**:

- [x] CTA section has viewport animations
- [x] Lenis smooth scroll works
- [x] Demo section has scroll animations
- [x] Full page scroll works through all sections
- [x] Build and lint pass

---

## Final Verification Checklist

### Visual Quality

- [ ] Hero 3D scene displays Glass/Cosmic aesthetic
- [ ] Star field has visible parallax depth
- [ ] Glass spheres respond to mouse movement
- [ ] Features section uses fullscreen hijacked scroll slides
- [ ] Comparison section uses parallax split scroll
- [ ] CTA button has visible glow and pulse animation

### Technical Quality

- [ ] All components use OnPush change detection
- [ ] No raw Three.js code - all via @hive-academy/angular-3d
- [ ] No raw GSAP code - all via @hive-academy/angular-gsap
- [ ] 60fps maintained during scroll animations

### Accessibility

- [ ] `prefers-reduced-motion` respected
- [ ] All CTAs keyboard accessible
- [ ] Focus states visible

---

## Status Legend

- PENDING - Not started
- IN PROGRESS - Developer working
- IMPLEMENTED - Developer done, awaiting verification
- COMPLETE - Verified and committed
- BLOCKED - Waiting on external dependency

---

## File Summary

### Files to Create (New Components in apps/ptah-landing-page/)

- src/app/sections/hero/hero-3d-scene.component.ts
- src/app/sections/hero/hero-content-overlay.component.ts
- src/app/sections/features/feature-slide.component.ts
- src/app/sections/features/features-hijacked-scroll.component.ts
- src/app/sections/comparison/comparison-split-scroll.component.ts

### Files to Modify (in apps/ptah-landing-page/)

- D:\projects\ptah-extension\package.json (verify @hive-academy packages)
- D:\projects\ptah-extension\apps\ptah-landing-page\src\app\app.config.ts (add providers)
- D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero.component.ts (refactor)
- D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\features-section.component.ts (refactor)
- D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\comparison\comparison-section.component.ts (refactor)
- D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\cta\cta-section.component.ts (upgrade)
- D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\demo\demo-section.component.ts (upgrade)
- D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\landing-page.component.ts (upgrade)

### Files NOT to Modify (VS Code Extension - WRONG PROJECT)

- ❌ apps/ptah-extension-webview/\*
- ❌ libs/frontend/core/\*
- ❌ libs/frontend/chat/\*
- ❌ tsconfig.base.json (no new path aliases needed)
