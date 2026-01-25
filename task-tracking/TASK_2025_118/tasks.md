# Development Tasks - TASK_2025_118

**Total Tasks**: 15 | **Batches**: 3 | **Status**: 3/3 COMPLETE

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- Lucide Angular v0.542.0 is already installed in the project
- Pattern verified from `libs/frontend/chat/src/lib/components/atoms/copy-button.component.ts`
- All required icons exist in lucide-angular: Check, Github, Mail, Eye, TriangleAlert, CircleX, CircleAlert
- LucideAngularModule import pattern uses `[img]` binding (not `[name]`)

### Risks Identified

| Risk                                                | Severity | Mitigation                                                    |
| --------------------------------------------------- | -------- | ------------------------------------------------------------- |
| Ptah Logo animation class may not work with img tag | LOW      | Test `animate-glow-pulse` on img tag; may need CSS adjustment |
| Icon sizing may differ slightly from inline SVGs    | LOW      | Use same Tailwind classes; visual verification required       |

### Edge Cases to Handle

- [x] Multi-color Google logo cannot use Lucide (extract to asset)
- [x] Ptah Logo is custom brand SVG (extract to asset)
- [x] Some SVGs use `fill="currentColor"` while others use `stroke="currentColor"` - Lucide handles this automatically

---

## Batch 1: Assets & Simple Components - COMPLETE

**Developer**: frontend-developer
**Tasks**: 6 | **Dependencies**: None
**Verified**: 2025-01-25 by team-leader
**Commit**: e0963de

### Task 1.1: Create Ptah Logo SVG Asset - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\public\assets\icons\ptah-logo.svg
**Spec Reference**: implementation-plan.md:420-430

**Quality Requirements**:

- SVG must use `currentColor` for CSS color inheritance
- ViewBox must be `0 0 100 100`
- Stroke-based design for consistency with Lucide icons

**Implementation Details**:

```svg
<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="45" stroke="currentColor" stroke-width="3"/>
  <path d="M50 20 L50 80 M35 35 L65 35 M35 65 L65 65" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>
```

---

### Task 1.2: Create Google Logo SVG Asset - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\public\assets\icons\google-logo.svg
**Spec Reference**: implementation-plan.md:442-453

**Quality Requirements**:

- Must preserve Google brand colors (#4285F4, #34A853, #FBBC05, #EA4335)
- ViewBox must be `0 0 24 24`
- Cannot use Lucide - requires exact brand colors

**Implementation Details**:

```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
</svg>
```

---

### Task 1.3: Migrate NavigationComponent to Lucide - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\components\navigation.component.ts
**Spec Reference**: implementation-plan.md:104-139
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\copy-button.component.ts:9

**Quality Requirements**:

- Import `LucideAngularModule` and `Github` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icon as class property: `readonly GithubIcon = Github;`
- Replace inline SVG (lines 89-100) with: `<lucide-angular [img]="GithubIcon" class="w-5 h-5" />`
- Icon must inherit `currentColor` for hover effects

**Validation Notes**:

- Verify hover color transition works after migration

---

### Task 1.4: Migrate PlanCardComponent to Lucide - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts
**Spec Reference**: implementation-plan.md:142-180
**Pattern to Follow**: Same as Task 1.3

**Quality Requirements**:

- Import `LucideAngularModule` and `Check` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icon as class property: `readonly CheckIcon = Check;`
- Replace inline SVG (lines 75-87) with: `<lucide-angular [img]="CheckIcon" class="flex-shrink-0 w-5 h-5 text-success mt-0.5" />`
- Preserve all existing classes for alignment

---

### Task 1.5: Migrate CTASectionComponent to Lucide - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\cta\cta-section.component.ts
**Spec Reference**: implementation-plan.md:235-264
**Pattern to Follow**: Same as Task 1.3

**Quality Requirements**:

- Import `LucideAngularModule` and `Check` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icon as class property: `readonly CheckIcon = Check;`
- Replace inline SVG (lines 102-112) with: `<lucide-angular [img]="CheckIcon" class="w-5 h-5 text-success" />`

---

### Task 1.6: Migrate ProfilePageComponent to Lucide - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts
**Spec Reference**: implementation-plan.md:296-321
**Pattern to Follow**: Same as Task 1.3

**Quality Requirements**:

- Import `LucideAngularModule` and `Check` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icon as class property: `readonly CheckIcon = Check;`
- Replace inline SVG (lines 162-174) with: `<lucide-angular [img]="CheckIcon" class="w-5 h-5 text-success flex-shrink-0" />`

---

**Batch 1 Verification**:

- All 2 asset files exist at paths
- All 4 component files compile without errors
- Build passes: `npx nx build ptah-landing-page`
- code-logic-reviewer approved
- Visual appearance unchanged

---

## Batch 2: Complex Components - COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 (assets must exist for signup/login)
**Verified**: 2025-01-25 by team-leader
**Commit**: 70de177

### Task 2.1: Migrate PricingGridComponent to Lucide - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
**Spec Reference**: implementation-plan.md:182-231
**Pattern to Follow**: Same as Task 1.3

**Quality Requirements**:

- Import `LucideAngularModule`, `TriangleAlert`, and `CircleX` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icons as class properties:
  ```typescript
  readonly TriangleAlertIcon = TriangleAlert;
  readonly CircleXIcon = CircleX;
  ```
- Replace warning SVG (lines 44-56) with: `<lucide-angular [img]="TriangleAlertIcon" class="stroke-current shrink-0 h-6 w-6" />`
- Replace error SVG (lines 64-76) with: `<lucide-angular [img]="CircleXIcon" class="stroke-current shrink-0 h-6 w-6" />`
- DaisyUI alert styling must be preserved

---

### Task 2.2: Migrate FeaturesHijackedScrollComponent to Lucide - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\features-hijacked-scroll.component.ts
**Spec Reference**: implementation-plan.md:266-293
**Pattern to Follow**: Same as Task 1.3

**Quality Requirements**:

- Import `LucideAngularModule`, `Eye`, and `Check` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icons as class properties:
  ```typescript
  readonly EyeIcon = Eye;
  readonly CheckIcon = Check;
  ```
- Replace Eye SVG (lines 80-87) with: `<lucide-angular [img]="EyeIcon" class="w-4 h-4" />`
- Replace Check SVG (lines 295-307) with: `<lucide-angular [img]="CheckIcon" class="w-6 h-6 text-[#d4af37] mt-0.5 flex-shrink-0" />`
- Note: Check icon uses stroke, not fill - Lucide handles this

---

### Task 2.3: Migrate SignupPageComponent to Lucide + Assets - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\signup\signup-page.component.ts
**Spec Reference**: implementation-plan.md:324-377
**Pattern to Follow**: Same as Task 1.3
**Dependencies**: Task 1.1 (ptah-logo.svg), Task 1.2 (google-logo.svg)

**Quality Requirements**:

- Import `LucideAngularModule`, `Github`, `Mail`, and `Check` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icons as class properties:
  ```typescript
  readonly GithubIcon = Github;
  readonly MailIcon = Mail;
  readonly CheckIcon = Check;
  ```
- Replace Ptah Logo SVG (lines 56-75) with:
  ```html
  <img src="/assets/icons/ptah-logo.svg" alt="Ptah Logo" class="w-16 h-16 text-secondary animate-glow-pulse" />
  ```
- Replace GitHub SVG (lines 97-101) with: `<lucide-angular [img]="GithubIcon" class="w-5 h-5" />`
- Replace Google SVG (lines 111-128) with:
  ```html
  <img src="/assets/icons/google-logo.svg" alt="Google" class="w-5 h-5" />
  ```
- Replace Mail SVG (lines 138-149) with: `<lucide-angular [img]="MailIcon" class="w-5 h-5" />`
- Replace 3 Check SVGs (lines 162-173, 177-188, 192-203) with: `<lucide-angular [img]="CheckIcon" class="w-4 h-4 text-secondary" />`

**Validation Notes**:

- Verify `animate-glow-pulse` animation works on img tag
- If animation doesn't work, may need to wrap in a div with the animation class

---

### Task 2.4: Migrate LoginPageComponent to Lucide + Assets - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\login\login-page.component.ts
**Spec Reference**: implementation-plan.md:379-408
**Pattern to Follow**: Same as Task 1.3
**Dependencies**: Task 1.1 (ptah-logo.svg), Task 1.2 (google-logo.svg)

**Quality Requirements**:

- Import `LucideAngularModule`, `Github`, `Mail`, and `CircleAlert` from 'lucide-angular'
- Add `LucideAngularModule` to imports array
- Store icons as class properties:
  ```typescript
  readonly GithubIcon = Github;
  readonly MailIcon = Mail;
  readonly CircleAlertIcon = CircleAlert;
  ```
- Replace Ptah Logo SVG (lines 54-73) with:
  ```html
  <img src="/assets/icons/ptah-logo.svg" alt="Ptah Logo" class="w-16 h-16 text-secondary animate-glow-pulse" />
  ```
- Replace Error Alert SVG (lines 90-101) with: `<lucide-angular [img]="CircleAlertIcon" class="w-5 h-5" />`
- Replace GitHub SVG (lines 129-132) with: `<lucide-angular [img]="GithubIcon" class="w-5 h-5" />`
- Replace Google SVG (lines 143-159) with:
  ```html
  <img src="/assets/icons/google-logo.svg" alt="Google" class="w-5 h-5" />
  ```
- Replace Mail SVG (lines 170-181) with: `<lucide-angular [img]="MailIcon" class="w-5 h-5" />`

---

**Batch 2 Verification** (PASSED 2025-01-25):

- All 4 component files compile without errors
- Build passes: `npx nx build ptah-landing-page`
- Lucide pattern correctly applied to all components
- Ptah Logo and Google Logo use asset img tags
- All Tailwind classes preserved
- Commit: 70de177

---

## Batch 3: QA Fixes - COMPLETE

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 2
**Verified**: 2025-01-25 by team-leader
**Commit**: 4ed5b43

### Task 3.1: Migrate AuthPageComponent to Lucide - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\auth\auth-page.component.ts
**Spec Reference**: QA review findings

**Quality Requirements**:

- Import 6 Lucide icons: CircleAlert, CheckCircle, Mail, Github, KeyRound, Zap
- All icons use `aria-hidden="true"` for accessibility
- Google logo uses asset img tag with `aria-hidden="true"`

**Implementation Details**:

- 9 inline SVGs migrated to Lucide Angular
- All icons stored as readonly class properties
- Consistent pattern with other components

---

### Task 3.2: Fix ptah-logo.svg Color - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\public\assets\icons\ptah-logo.svg
**Spec Reference**: QA style review finding

**Quality Requirements**:

- Replace `currentColor` with `#d4af37` (gold) for proper rendering
- `currentColor` doesn't work in `<img>` tags

**Implementation Details**:

- stroke="currentColor" changed to stroke="#d4af37" on both circle and path elements

---

### Task 3.3: Add aria-hidden to cta-section.component.ts - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\cta\cta-section.component.ts
**Spec Reference**: QA accessibility review

**Quality Requirements**:

- Add `aria-hidden="true"` to Lucide icon for screen reader compatibility

**Implementation Details**:

- Added `aria-hidden="true"` to `<lucide-angular [img]="CheckIcon" ...>` on line 106

---

### Task 3.4: Add aria-hidden to profile-page.component.ts - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts
**Spec Reference**: QA accessibility review

**Quality Requirements**:

- Add `aria-hidden="true"` to Lucide icon for screen reader compatibility

**Implementation Details**:

- Added `aria-hidden="true"` to `<lucide-angular [img]="CheckIcon" ...>` on line 166

---

### Task 3.5: Remove unused imports from signup-page.component.ts - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\signup\signup-page.component.ts
**Spec Reference**: QA code review

**Quality Requirements**:

- Remove unused `signal`, `computed`, and `inject` imports

**Implementation Details**:

- Simplified imports from 6 items to 2: `Component`, `ChangeDetectionStrategy`

---

**Batch 3 Verification** (PASSED 2025-01-25):

- All 5 files compile without errors
- Build passes: `npx nx build ptah-landing-page`
- All accessibility attributes added
- SVG color fixed for img tag usage
- Unused imports removed
- Commit: 4ed5b43
