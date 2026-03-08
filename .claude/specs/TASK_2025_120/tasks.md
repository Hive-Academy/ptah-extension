# Task Breakdown - TASK_2025_120

**Implementation Plan**: [implementation-plan.md](implementation-plan.md)
**Task Description**: [task-description.md](task-description.md)

---

## Task Summary

- **Total Tasks**: 8
- **Frontend Tasks**: 7
- **Testing Tasks**: 1
- **Estimated Total Time**: 16 hours

---

## Task List

### Task 1: Navigation Mobile Hamburger Menu ✅ COMPLETED

**Type**: FRONTEND
**Complexity**: Level 2 (Moderate - state management + template changes)
**Estimated Time**: 3 hours
**Status**: ✅ COMPLETED
**Completed**: 2026-01-26T12:30:00Z
**Commit**: b9dc9e3

**Description**:
Add a fully functional mobile hamburger menu to NavigationComponent. This includes adding mobile menu state signal, hamburger toggle button visible on mobile (hidden on md+), desktop navigation hidden on mobile (visible on md+), and a slide-down overlay menu with all navigation links.

**File to Change**:

- `apps/ptah-landing-page/src/app/components/navigation.component.ts`

**Implementation Details**:

1. Import `Menu` and `X` icons from `lucide-angular`
2. Add signal: `mobileMenuOpen = signal(false)`
3. Add method: `toggleMobileMenu()` to flip the signal
4. Wrap desktop nav links in container with `hidden md:flex`
5. Add hamburger button with `md:hidden` and 44x44px touch target
6. Add mobile menu overlay that slides down when `mobileMenuOpen()` is true
7. Include all links: Pricing, Login/Sign Up (or Profile/Logout), GitHub, Get Extension
8. Add backdrop click to close menu

**Verification Criteria**:

- [x] `Menu` and `X` icons imported from lucide-angular
- [x] `mobileMenuOpen` signal exists and toggles correctly
- [x] Desktop nav links have `hidden md:flex` classes
- [x] Hamburger button visible only on mobile (<768px)
- [x] Mobile overlay shows all navigation options
- [x] Touch target ≥44x44px on hamburger button (w-11 h-11 = 44px)
- [x] No horizontal overflow on 375px viewport
- [x] No TypeScript errors, builds successfully
- [x] Git commit created with pattern: `feat(landing): add mobile hamburger menu to navigation`

**Implementation Summary**:

- Added `Menu` and `X` icons from lucide-angular
- Added `mobileMenuOpen` signal with `toggleMobileMenu()` and `closeMobileMenu()` methods
- Desktop nav wrapped with `hidden md:flex`
- Hamburger button with 44x44px touch target (w-11 h-11), md:hidden
- Full mobile overlay menu with backdrop, slide-down animation
- All links included: Pricing, Login/Sign Up, Profile/Logout, GitHub, Get Extension
- Backdrop click and link click close menu
- Responsive padding (px-4 sm:px-6 lg:px-16)

**Dependencies**: None

---

### Task 2: Hero Content Responsive Typography ✅ COMPLETED

**Type**: FRONTEND
**Complexity**: Level 1 (Simple - class modifications only)
**Estimated Time**: 1.5 hours
**Status**: ✅ COMPLETED
**Completed**: 2026-01-26T12:45:00Z
**Commit**: 042bfdf

**Description**:
Apply responsive typography scaling to hero headline and convert stats to a 2x2 grid on mobile. The subtitle and CTAs are already responsive.

**File to Change**:

- `apps/ptah-landing-page/src/app/sections/hero/hero-content-overlay.component.ts`

**Implementation Details**:

1. Update headline classes:
   - From: `text-6xl md:text-7xl lg:text-8xl`
   - To: `text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl`
2. Update stats container:
   - From: `flex flex-wrap justify-center gap-10`
   - To: `grid grid-cols-2 gap-4 sm:gap-6 md:flex md:flex-wrap md:justify-center md:gap-10`
3. Verify subtitle already has responsive classes (text-base md:text-lg lg:text-xl)
4. Verify CTAs already have `flex-col sm:flex-row`

**Verification Criteria**:

- [x] Headline scales from 4xl on mobile to 8xl on xl screens
- [x] Stats display as 2x2 grid on mobile, flex row on md+
- [x] No horizontal overflow on 375px viewport
- [x] Text readable without zooming on mobile
- [x] No TypeScript errors, builds successfully
- [x] Git commit created with pattern: `feat(landing): add responsive typography to hero content`

**Implementation Summary**:

- Updated headline: `text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl`
- Updated stats: `grid grid-cols-2 gap-4 sm:gap-6 md:flex md:flex-wrap md:justify-center md:gap-10`
- Verified subtitle already has responsive classes ✅
- Verified CTAs already have `flex-col sm:flex-row` ✅

**Dependencies**: None (can run parallel to Task 1)

---

### Task 3: Hide Floating Images on Mobile ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 1 (Simple - single class addition)
**Estimated Time**: 0.5 hours
**Status**: ⏸️ PENDING

**Description**:
Hide the orbital floating images on mobile viewports to prevent visual clutter and potential overflow issues. Images should only be visible on md (768px) and above.

**File to Change**:

- `apps/ptah-landing-page/src/app/sections/hero/hero-floating-images.component.ts`

**Implementation Details**:

1. Find the root container div with class `absolute inset-0 pointer-events-none overflow-hidden`
2. Add `hidden md:block` to hide on mobile, show on md+
3. Alternatively, wrap entire template content in a container with these classes

**Verification Criteria**:

- [ ] Floating images invisible on viewports <768px
- [ ] Floating images visible on viewports ≥768px
- [ ] No layout shift when crossing md breakpoint
- [ ] No horizontal overflow on 375px viewport
- [ ] No TypeScript errors, builds successfully
- [ ] Git commit created with pattern: `feat(landing): hide floating images on mobile viewports`

**Dependencies**: None (can run parallel to Tasks 1-2)

---

### Task 4: Features Section Mobile Stacked Layout ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 3 (Complex - layout restructuring)
**Estimated Time**: 4 hours
**Status**: ⏸️ PENDING

**Description**:
Convert the features section from a 50/50 side-by-side layout to a stacked vertical layout on mobile. This is the most complex task as it requires restructuring how image and text containers are positioned.

**File to Change**:

- `apps/ptah-landing-page/src/app/sections/features/features-hijacked-scroll.component.ts`

**Implementation Details**:

1. **Features Hero Heading** (line ~92):

   - Update: `text-6xl md:text-7xl` → `text-4xl sm:text-5xl md:text-6xl lg:text-7xl`
   - Add padding: `px-4 sm:px-6 lg:px-8`

2. **Feature Steps Section Container** (line ~128):

   - Update from: `class="relative min-h-screen flex w-full overflow-hidden"`
   - To: `class="relative min-h-screen flex flex-col md:flex-row w-full overflow-hidden"`

3. **Image Side Container** (line ~131):

   - Update from: `class="absolute inset-y-0 w-1/2"`
   - To: `class="relative h-64 w-full md:absolute md:inset-y-0 md:w-1/2 md:h-auto"`
   - This makes image stack above text on mobile

4. **Text Content Side** (line ~177):

   - Update from: `class="relative z-20 w-1/2 min-h-screen flex items-center"`
   - To: `class="relative z-20 w-full md:w-1/2 min-h-[50vh] md:min-h-screen flex items-center"`

5. **Text Container Padding** (line ~184):

   - Update: `px-8 lg:px-16` → `px-4 sm:px-6 md:px-8 lg:px-16`

6. **Feature Step Title** (line ~232):
   - Update: `text-4xl md:text-5xl` → `text-2xl sm:text-3xl md:text-4xl lg:text-5xl`

**Verification Criteria**:

- [ ] Features hero heading scales responsively
- [ ] Feature steps show image above text on mobile (<768px)
- [ ] Feature steps show side-by-side on md+ (≥768px)
- [ ] Text content readable with proper padding on mobile
- [ ] No horizontal overflow on 375px and 414px viewports
- [ ] Scroll animations still function correctly
- [ ] No TypeScript errors, builds successfully
- [ ] Git commit created with pattern: `feat(landing): convert features section to stacked mobile layout`

**Dependencies**: None (can start after Task 3)

---

### Task 5: Comparison Section Mobile Grid ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 2 (Moderate - multiple class updates)
**Estimated Time**: 2 hours
**Status**: ⏸️ PENDING

**Description**:
Ensure the comparison section properly stacks cards on mobile and adjust padding/spacing for better mobile readability.

**File to Change**:

- `apps/ptah-landing-page/src/app/sections/comparison/comparison-split-scroll.component.ts`

**Implementation Details**:

1. **Section Header** (~line 48):
   - Update padding: `px-4` → `px-4 sm:px-6 lg:px-8`
2. **Header Typography** (~line 51):

   - Update: `text-4xl md:text-5xl` → `text-3xl sm:text-4xl md:text-5xl`

3. **Comparison Grid Container** (~line 62):

   - Verify: Already has `grid md:grid-cols-2` ✅
   - Update gap: `gap-8 lg:gap-12` → `gap-6 md:gap-8 lg:gap-12`

4. **Card Padding** (~lines 68, 117):

   - Update: `p-8 md:p-12` → `p-6 md:p-8 lg:p-12`

5. **Performance Metrics Grid** (~line 177):

   - Update: `grid grid-cols-1 md:grid-cols-3`
   - To: `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3`

6. **Metric Card Padding** (~line 185):
   - Update: `p-6` → `p-4 sm:p-6`

**Verification Criteria**:

- [ ] Comparison cards stack vertically on mobile (<768px)
- [ ] Cards display side-by-side on md+ (≥768px)
- [ ] Performance metrics show 1 col on mobile, 2 on sm, 3 on md+
- [ ] Padding reduces appropriately on smaller screens
- [ ] All text readable on 375px viewport
- [ ] No horizontal overflow
- [ ] No TypeScript errors, builds successfully
- [ ] Git commit created with pattern: `feat(landing): improve comparison section mobile responsiveness`

**Dependencies**: None (can run parallel)

---

### Task 6: CTA Section Responsive Typography ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 2 (Moderate - typography + button sizing)
**Estimated Time**: 2 hours
**Status**: ⏸️ PENDING

**Description**:
Apply responsive typography to CTA section headline, adjust button sizing for mobile touch targets, and optimize spacing.

**File to Change**:

- `apps/ptah-landing-page/src/app/sections/cta/cta-section.component.ts`

**Implementation Details**:

1. **Section Padding** (~line 33):

   - Update: `py-32` → `py-16 sm:py-24 md:py-32`
   - Update container: `px-6` → `px-4 sm:px-6`

2. **Headline** (~line 38):

   - Update: `text-7xl` → `text-4xl sm:text-5xl md:text-6xl lg:text-7xl`

3. **Subheadline** (~line 45):

   - Update: `text-xl` → `text-base sm:text-lg md:text-xl`

4. **Primary CTA Button** (~line 54):

   - Update: `px-12 py-6 text-xl`
   - To: `px-8 py-4 text-base sm:px-10 sm:py-5 sm:text-lg md:px-12 md:py-6 md:text-xl`

5. **Trust Signals Container** (~line 94):

   - Update: `gap-8` → `gap-4 sm:gap-6 md:gap-8`

6. **Footer Brand Section** (~line 120):

   - Update heading: `text-2xl` → `text-xl sm:text-2xl`

7. **Footer Navigation** (~line 130):
   - Update: `gap-6` → `gap-4 sm:gap-6`

**Verification Criteria**:

- [ ] Headline scales from 4xl on mobile to 7xl on lg+
- [ ] CTA button appropriately sized for mobile touch (≥44px height)
- [ ] Trust signals wrap properly with reduced gaps on mobile
- [ ] Footer links wrap naturally
- [ ] No horizontal overflow on 375px viewport
- [ ] No TypeScript errors, builds successfully
- [ ] Git commit created with pattern: `feat(landing): add responsive typography to CTA section`

**Dependencies**: None (can run parallel)

---

### Task 7: Pricing Hero Responsive Verification ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 1 (Simple - verification + minor adjustments)
**Estimated Time**: 1 hour
**Status**: ⏸️ PENDING

**Description**:
Verify pricing hero component is fully responsive and make minor adjustments if needed. Based on implementation plan, this component is already mostly responsive.

**File to Change**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-hero.component.ts`

**Implementation Details**:

1. **Verify Headline** (~line 77):

   - Already has: `text-4xl md:text-5xl lg:text-6xl` ✅
   - Optional: Add sm breakpoint: `text-4xl sm:text-5xl md:text-5xl lg:text-6xl`

2. **Content Container Padding** (~line 67):
   - Verify: `px-6` → Consider `px-4 sm:px-6`
3. **Promotional Line** (~line 92):

   - Update: `text-2xl md:text-3xl lg:text-4xl` → `text-xl sm:text-2xl md:text-3xl lg:text-4xl`
   - Update: `gap-3` → `gap-2 sm:gap-3`

4. **Subtext** (if exists):
   - Verify readable on mobile

**Verification Criteria**:

- [ ] Headline scales appropriately across breakpoints
- [ ] Promotional text readable on mobile
- [ ] Container has adequate mobile padding
- [ ] No horizontal overflow on 375px viewport
- [ ] Background image doesn't cause issues on mobile
- [ ] No TypeScript errors, builds successfully
- [ ] Git commit created with pattern: `feat(landing): verify and optimize pricing hero responsiveness`

**Dependencies**: None (can run parallel)

---

### Task 8: Responsive Testing & Validation ⏸️ PENDING

**Type**: TESTING
**Complexity**: Level 2 (Moderate - comprehensive testing)
**Estimated Time**: 2 hours
**Status**: ⏸️ PENDING

**Description**:
Comprehensive manual testing of all responsive changes across key breakpoints. Document any issues found and verify all acceptance criteria from task-description.md are met.

**Testing Scope**:

- All 7 modified components
- Both Landing Page and Pricing Page routes

**Testing Matrix**:

| Viewport | Device                 | Priority |
| -------- | ---------------------- | -------- |
| 320px    | Min supported          | High     |
| 375px    | iPhone SE              | High     |
| 414px    | iPhone Pro Max         | High     |
| 768px    | iPad / md breakpoint   | High     |
| 1024px   | Laptop / lg breakpoint | Medium   |
| 1440px   | Desktop                | Low      |

**Test Checklist**:

1. **Navigation**:

   - [ ] Hamburger menu visible on mobile
   - [ ] Menu opens/closes correctly
   - [ ] All links accessible in mobile menu
   - [ ] Desktop nav visible on md+

2. **Hero Section**:

   - [ ] Headline readable on all sizes
   - [ ] CTAs stacked on mobile, row on sm+
   - [ ] Stats 2x2 grid on mobile
   - [ ] Floating images hidden on mobile

3. **Features Section**:

   - [ ] Stacked layout on mobile
   - [ ] Side-by-side on md+
   - [ ] Text readable with proper padding

4. **Comparison Section**:

   - [ ] Cards stack on mobile
   - [ ] Metrics grid adapts

5. **CTA Section**:

   - [ ] Headline readable
   - [ ] Button touch-friendly

6. **Pricing Page**:

   - [ ] Hero responsive
   - [ ] Cards stack (already verified)

7. **Global Checks**:
   - [ ] No horizontal overflow at any breakpoint
   - [ ] No text cut off
   - [ ] All touch targets ≥44x44px
   - [ ] Smooth transitions between breakpoints

**Verification Criteria**:

- [ ] All 8 acceptance scenarios from task-description.md pass
- [ ] Zero horizontal scrollbar at 320px+
- [ ] All touch targets meet accessibility standards
- [ ] Visual consistency across breakpoints
- [ ] Git commit created with pattern: `test(landing): complete responsive testing validation`

**Dependencies**: Tasks 1-7 complete

---

## Execution Order

```
Phase 1 (Parallel):
├── Task 1: Navigation Hamburger Menu ← START HERE
├── Task 2: Hero Content Typography
└── Task 3: Floating Images Hidden

Phase 2 (Parallel):
├── Task 4: Features Stacked Layout (most complex)
├── Task 5: Comparison Grid
├── Task 6: CTA Typography
└── Task 7: Pricing Hero Verification

Phase 3 (Sequential):
└── Task 8: Responsive Testing (requires all above complete)
```

**Note**: Tasks 1-3 and 4-7 can run in parallel within their phases. Task 8 must wait for all others.

---

## Progress Tracking

| Task   | Status         | Commit SHA | Verified |
| ------ | -------------- | ---------- | -------- |
| Task 1 | ⏳ IN PROGRESS | -          | ⏸️       |
| Task 2 | ⏸️ PENDING     | -          | ⏸️       |
| Task 3 | ⏸️ PENDING     | -          | ⏸️       |
| Task 4 | ⏸️ PENDING     | -          | ⏸️       |
| Task 5 | ⏸️ PENDING     | -          | ⏸️       |
| Task 6 | ⏸️ PENDING     | -          | ⏸️       |
| Task 7 | ⏸️ PENDING     | -          | ⏸️       |
| Task 8 | ⏸️ PENDING     | -          | ⏸️       |

---

**TASK DECOMPOSITION COMPLETE - READY FOR DEVELOPMENT**
