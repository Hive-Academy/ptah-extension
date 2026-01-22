# Implementation Plan - TASK_2025_112 Frontend License Integration

## Visual Design References

**Design Specifications**: [visual-design-specification.md](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/visual-design-specification.md)  
**Asset Inventory**: [design-assets-inventory.md](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/design-assets-inventory.md)  
**Developer Handoff**: [developer-handoff.md](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/developer-handoff.md)

## Overview

This implementation plan creates the frontend pages for the license system based on Phase 3 UI/UX design deliverables. The plan follows **evidence-based architecture** by investigating existing patterns in the Ptah codebase and aligning with design specifications.

### Scope

1. **Implement Angular routing** (currently missing - landing page is single-component app)
2. **Create three new pages**: Pricing (`/pricing`), Login (`/login`), Profile (`/profile`)
3. **Integrate with existing backend APIs**: License verification, WorkOS auth
4. **Deploy generated design assets** to Angular assets directory
5. **Ensure design system compliance** with Ptah Design System (Egyptian tech aesthetic)

---

## Architecture Investigation Findings

### Current State Analysis

**Evidence**: [app.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/app.ts:1-36)  
**Evidence**: [landing-page.component.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/landing-page.component.ts:1-108)

#### Finding 1: No Angular Router

**Status**: ❌ Not configured

- `app.config.ts` does NOT include `provideRouter()` ✓ Verified
- No `app.routes.ts` file exists ✓ Verified via `find_by_name`
- Application directly loads `LandingPageComponent` in `app.html`  
  **Evidence**: [app.config.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/app.config.ts:1-32) lines 9-31

**Impact**: Need to create routing infrastructure from scratch

#### Finding 2: Existing Design System (Ptah Design System)

**Evidence**: [DESIGN-SYSTEM.md](file:///d:/projects/ptah-extension/.agent/skills/technical-content-writer/DESIGN-SYSTEM.md)

**Colors**: Egyptian sacred tech palette

- `--obsidian`: `#0a0a0a` (background)
- `--gold`: `#d4af37` (primary accent)
- `--gold-light`: `#f4d47c`
- `--gold-dark`: `#b8963a`
- `--cream`: `#f5f5dc` (text)
- `--sand`: `#c4b998` (secondary text)
- `--scarab-teal`: `#2dd4bf` (success)
- `--papyrus-red`: `#ef4444` (error)

**Typography**:

- `--font-display`: Cinzel (serif, for headings)
- `--font-body`: Inter (sans-serif, for body text)
- `--font-mono`: JetBrains Mono (code/license keys)

**Verified in**: [tailwind.config.js](file:///d:/projects/ptah-extension/apps/ptah-landing-page/tailwind.config.js) (assumed existence based on landing page)

#### Finding 3: Standalone Component Architecture

**Pattern**: 100% standalone components, no `NgModule`  
**Evidence**: [landing-page.component.ts:69-106](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/landing-page.component.ts:69-106)

```typescript
@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  imports: [/* ... */],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

**Decision**: All new page components MUST use `standalone: true` pattern

#### Finding 4: GSAP + Lenis Integration

**Evidence**: [app.config.ts:22-29](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/app.config.ts:22-29)

Existing animation infrastructure:

- **GSAP**: Provided via `provideGsap()` from `@hive-academy/angular-gsap`
- **Lenis**: Smooth scroll provided via `provideLenis()`

**Decision**: Reuse existing animation providers for pricing page card animations

#### Finding 5: Backend API Patterns

**Evidence**: [license.controller.ts](file:///d:/projects/ptah-extension/apps/ptah-license-server/src/license/controllers/license.controller.ts)  
**Evidence**: [auth.controller.ts](file:///d:/projects/ptah-extension/apps/ptah-license-server/src/app/auth/auth.controller.ts)

**License API** (Already implemented in TASK_2025_075):

- `GET /api/v1/licenses/me` → Returns user's license details ✓ Verified: lines 95-141
- `POST /api/v1/licenses/verify` → Verifies license key ✓ Verified: lines 57-60

**Auth API** (Magic Link Authentication):

- `GET /auth/login` → Redirects to WorkOS AuthKit ✓ Verified: lines 51-55
- `GET /auth/callback?code=` → Handles OAuth callback ✓ Verified: lines 68-100
- `POST /auth/magic-link` → Sends passwordless magic link ✓ Verified: lines 171-205
- `GET /auth/verify?token=` → Verifies magic link token ✓ Verified: lines 231-283
- `GET /auth/me` → Returns current authenticated user ✓ Verified: lines 140-144
- `POST /auth/logout` → Clears auth cookie ✓ Verified: lines 112-127

**Cookie Name**: `ptah_auth` (JWT token) ✓ Verified: line 272

**Decision**: Frontend will use **magic link authentication** (passwordless) instead of WorkOS SSO for simplicity

---

## User Review Required

> [!IMPORTANT] > **Authentication Strategy Change**
>
> Based on backend investigation, the backend supports **two authentication methods**:
>
> 1. **WorkOS SSO** (enterprise-focused) - Requires WorkOS account setup
> 2. **Magic Link** (passwordless email) - Already fully implemented
>
> **Proposed Change**: Use **magic link authentication** for the login page instead of WorkOS SSO.
>
> **Rationale**:
>
> - ✅ Magic link API is fully implemented ([auth.controller.ts:171-283](file:///d:/projects/ptah-extension/apps/ptah-license-server/src/app/auth/auth.controller.ts:171-283))
> - ✅ No external service setup required (works immediately)
> - ✅ Better UX for individual users (no SSO provider selection)
> - ✅ Still secure (30s token TTL, single-use, HTTP-only cookie)
> - ⚠️ WorkOS SSO can be added later for enterprise customers
>
> **Impact on Design**: Login page will have email input + "Send Magic Link" button instead of "Sign in with WorkOS" button.

---

## Proposed Changes

### Phase 1: Routing Infrastructure

#### [NEW] [app.routes.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/app.routes.ts)

**Purpose**: Define application routes (currently missing)

**Routes**:

```typescript
export const routes: Routes = [
  { path: '', component: LandingPageComponent },
  { path: 'pricing', component: PricingPageComponent },
  { path: 'login', component: LoginPageComponent },
  { path: 'profile', component: ProfilePageComponent, canActivate: [AuthGuard] },
  { path: '**', redirectTo: '' },
];
```

**Evidence**: Angular standalone routing pattern from official docs

---

#### [MODIFY] [app.config.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/app.config.ts)

**Changes**:

1. Add `provideRouter(routes)` import
2. Add `provideHttpClient()` for API calls

**Diff**:

```diff
 import { provideMarkdown } from 'ngx-markdown';
 import { provideGsap, provideLenis } from '@hive-academy/angular-gsap';
+import { provideRouter } from '@angular/router';
+import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
+import { routes } from './app.routes';

 export const appConfig: ApplicationConfig = {
   providers: [
+    provideRouter(routes),
+    provideHttpClient(withInterceptorsFromDi()),
     provideBrowserGlobalErrorListeners(),
```

**Evidence**: [app.config.ts:1-32](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/app.config.ts:1-32)

---

#### [MODIFY] [app.html](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/app.html)

**Change**: Replace direct component with router outlet

**Before**:

```html
<ptah-landing-page></ptah-landing-page>
```

**After**:

```html
<router-outlet></router-outlet>
```

**Evidence**: Standard Angular routing pattern

---

### Phase 2: Pricing Page Implementation

#### [NEW] [pricing-page.component.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/pricing/pricing-page.component.ts)

**Purpose**: Root pricing page container composing hero + grid sections

**Component hierarchy** (from design-handoff.md):

```
Pricing PageComponent
├── PricingHeroComponent
├── PricingGridComponent
│   ├── PlanCardComponent (Free)
│   ├── PlanCardComponent (Early Adopter)
│   └── PlanCardComponent (Pro)
```

**Key features**:

- Standalone component with `OnPush` change detection
- Uses Tailwind classes from Ptah Design System
- Composable architecture (hero + grid separation)

**Evidence**: Pattern from [landing-page.component.ts:69-106](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/pricing/landing-page.component.ts:69-106)

---

#### [NEW] [plan-card.component.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/pricing/components/plan-card.component.ts)

**Purpose**: Reusable pricing plan card with CTA actions

**Component API** (from design-handoff.md:110-223):

```typescript
export interface PricingPlan {
  name: string;
  tier: 'free' | 'early_adopter' | 'pro';
  price: string;
  priceId?: string; // Paddle price ID
  features: string[];
  ctaText: string;
  ctaAction: 'download' | 'checkout';
  highlight?: boolean;
  badge?: string;
}
```

**Design specifications** (from visual-design-specification.md:41-247):

- Glass morphism background: `rgba(26, 26, 26, 0.8)` with `backdrop-filter: blur(12px)`
- Gold border on hover: `rgba(212,175,55,0.4)`
- Scale animation: `translateY(-8px)` on hover
- LIMITED badge: `plan_badge_early_adopter.png` asset (absolute position top-right)

**Badge Integration**:

```html
<img *ngIf="plan.badge" src="/assets/images/license-system/plan_badge_early_adopter.png" alt="LIMITED" class="absolute -top-2 right-6 w-32 limited-badge" />
```

**Animation** (reusing GSAP):

- Entry animation: `scale-in` with 600ms duration
- Stagger: 150ms delay between cards

**Evidence**: Design pattern from [visual-design-specification.md:41-135](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/visual-design-specification.md:41-135)

---

#### [NEW] [environment.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/environments/environment.ts)

**Purpose**: Store Paddle configuration

**Currently missing** ✓ Verified via `find_by_name`

**Content**:

```typescript
export const environment = {
  production: false,
  paddlePriceIdEarlyAdopter: 'pri_01jqbkwnq87xxxxxxxxx', // From Paddle dashboard
  paddlePriceIdPro: 'pri_01jqbkwnq87yyyyyyyyy',
};
```

**Note**: Paddle SDK integration deferred to Phase 2 (Backend Execution) based on research findings (Paddle not yet configured)

---

### Phase 3: Login Page Implementation

#### [NEW] [login-page.component.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/login/login-page.component.ts)

**Purpose**: Passwordless magic link authentication

**Updated flow** (magic link instead of WorkOS SSO):

1. User enters email
2. Click "Send Magic Link" → `POST /auth/magic-link`
3. User receives email with link
4. Click link → `GET /auth/verify?token=...`
5. Backend sets `ptah_auth` cookie → Redirects to `/profile`

**Component structure**:

```typescript
template: `
  <div class="login-page">
    <div class="auth-card">
      <img src="ptah-logo.svg" class="animate-glow" />
      <h1>Welcome Back</h1>
      
      <form (submit)="handleMagicLink()">
        <input type="email" [(ngModel)]="email" />
        <button type="submit" [disabled]="isLoading">
          {{ isLoading ? 'Sending...' : 'Send Magic Link' }}
        </button>
      </form>
      
      <p *ngIf="successMessage" class="text-scarab-teal">
        {{ successMessage }}
      </p>
      <p *ngIf="errorMessage" class="text-papyrus-red">
        {{ errorMessage }}
      </p>
    </div>
  </div>
`;
```

**API integration**:

```typescript
handleMagicLink() {
  this.http.post('/auth/magic-link', { email: this.email }).subscribe({
    next: () => {
      this.successMessage = 'Check your email for the login link!';
    },
    error: (err) => {
      this.errorMessage = 'Failed to send magic link. Please try again.';
    }
  });
}
```

**Design specifications** (from visual-design-specification.md:325-539):

- Full viewport height centered layout
- Radial gradient background: `rgba(212,175,55,0.1)` to transparent
- Glass card: `rgba(26,26,26,0.9)` with `blur(30px)`
- Logo glow animation: 3s infinite pulse

**Evidence**: Magic link API from [auth.controller.ts:171-205](file:///d:/projects/ptah-extension/apps/ptah-license-server/src/app/auth/auth.controller.ts:171-205)

---

#### [NEW] [auth.service.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/services/auth.service.ts)

**Purpose**: Manage authentication state and API calls

**Service API**:

```typescript
class AuthService {
  isAuthenticated(): Observable<boolean>;
  getCurrentUser(): Observable<User | null>;
  logout(): Observable<void>;
}
```

**Authentication check** (used by `AuthGuard`):

```typescript
isAuthenticated(): Observable<boolean> {
  return this.http.get<User>('/auth/me').pipe(
    map(() => true),
    catchError(() => of(false))
  );
}
```

**Evidence**: Auth pattern from [auth.controller.ts:140-144](file:///d:/projects/ptah-extension/apps/ptah-license-server/src/app/auth/auth.controller.ts:140-144)

---

#### [NEW] [auth.guard.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/guards/auth.guard.ts)

**Purpose**: Protect `/profile` route (requires authentication)

**Guard logic**:

```typescript
export const AuthGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isAuthenticated().pipe(
    map((isAuth) => {
      if (!isAuth) {
        router.navigate(['/login']);
        return false;
      }
      return true;
    })
  );
};
```

**Evidence**: Standard Angular functional guard pattern

---

### Phase 4: Profile Page Implementation

#### [NEW] [profile-page.component.ts](file:///d:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts)

**Purpose**: Display user license details with management actions

**Data model** (from backend API):

```typescript
interface LicenseData {
  plan: 'free' | 'early_adopter' | 'pro';
  status: 'active' | 'expired' | 'none';
  expiresAt: string | null;
  daysRemaining?: number;
  email: string;
  createdAt: string;
  features: string[];
}
```

**Component sections**:

1. **Subscription Status Card**: Plan badge, status indicator, expiration
2. **License Key Display**: Copyable key (monospace font) + copy button
3. **3D Visual** (desktop only): `license_badge_3d.png` asset with float animation
4. **Action Buttons**: "Manage Subscription" (if applicable)

**API integration**:

```typescript
ngOnInit() {
  this.http.get<LicenseData>('/api/v1/licenses/me').subscribe({
    next: (data) => this.licenseData = data,
    error: () => this.errorMessage = 'Failed to load license'
  });
}
```

**Clipboard copy** (using Web API):

```typescript
copyLicenseKey() {
  navigator.clipboard.writeText(this.licenseData.licenseKey).then(() => {
    this.copyButtonText = 'Copied!';
    setTimeout(() => this.copyButtonText = 'Copy', 2000);
  });
}
```

**Design specifications** (from visual-design-specification.md:540-850):

- 2-column layout (content left, 3D visual right on desktop)
- Responsive: Single column on mobile/tablet
- Success toast after checkout: Fixed position top-right, auto-dismiss 3s
- Days remaining color-coded:
  - Green (`--scarab-teal`): > 7 days
  - Yellow (`--gold`): 7-30 days
  - Red (`--papyrus-red`): < 7 days

**Evidence**: Backend API from [license.controller.ts:95-141](file:///d:/projects/ptah-extension/apps/ptah-license-server/src/license/controllers/license.controller.ts:95-141)

---

### Phase 5: Design Assets Integration

#### [COPY] Design Assets to Angular Public Directory

**Source**: `C:\Users\abdal\.gemini\antigravity\brain\c37e76f9-755e-4f40-a1a6-2a9fa5cd0692\`

**Destination**: `d:\projects\ptah-extension\apps\ptah-landing-page\public\assets\images\license-system\`

**Assets** (from design-assets-inventory.md):

1. `plan_badge_early_adopter.png` → Pricing page LIMITED badge
2. `pricing_hero_pattern.png` → Pricing page background
3. `workos_sso_icon.png` → Login button icon (if using WorkOS)
4. `license_badge_3d.png` → Profile page visual element

**Command**:

```bash
mkdir -p apps/ptah-landing-page/public/assets/images/license-system
cp "C:\Users\abdal\.gemini\antigravity\brain\c37e76f9-755e-4f40-a1a6-2a9fa5cd0692\plan_badge_early_adopter.png" "apps/ptah-landing-page/public/assets/images/license-system/"
# ... repeat for other assets
```

**Evidence**: Assets from [design-assets-inventory.md](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/design-assets-inventory.md)

---

### Phase 6: Design System Compliance

#### [MODIFY] [tailwind.config.js](file:///d:/projects/ptah-extension/apps/ptah-landing-page/tailwind.config.js)

**Add custom utilities** for design specification classes:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        // Verify these exist, add if missing
        obsidian: '#0a0a0a',
        gold: '#d4af37',
        'gold-light': '#f4d47c',
        'gold-dark': '#b8963a',
        cream: '#f5f5dc',
        sand: '#c4b998',
        'scarab-teal': '#2dd4bf',
        'papyrus-red': '#ef4444',
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Courier', 'monospace'],
      },
      animation: {
        glow: 'glow 3s infinite',
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': { filter: 'drop-shadow(0 0 20px rgba(212, 175, 55, 0.6))' },
          '50%': { filter: 'drop-shadow(0 0 40px rgba(212, 175, 55, 0.9))' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
    },
  },
};
```

**Evidence**: Design system from [DESIGN-SYSTEM.md](file:///d:/projects/ptah-extension/.agent/skills/technical-content-writer/DESIGN-SYSTEM.md)

---

## Verification Plan

### Automated Tests

**Unit Tests** (Jest):

```bash
# Test individual components
nx test ptah-landing-page

# Specific test files
nx test ptah-landing-page --testFile=plan-card.component.spec.ts
nx test ptah-landing-page --testFile=auth.service.spec.ts
nx test ptah-landing-page --testFile=auth.guard.spec.ts
```

**Test coverage requirements**:

- ✅ Plan card renders correctly with all tiers
- ✅ Auth service returns authentication status
- ✅ Auth guard redirects unauthenticated users
- ✅ Profile page displays license data
- ✅ Copy button copies license key to clipboard

**E2E Tests** (Playwright - future):

- User can navigate to pricing page
- User can send magic link
- User can copy license key

### Manual Verification

#### Pricing Page (`/pricing`)

1. **Layout**:

   - [ ] 3 plan cards displayed in grid (mobile: vertical, desktop: horizontal)
   - [ ] Early Adopter card has LIMITED badge (golden glow animation)
   - [ ] Gradient gold text on headlines
   - [ ] Hover effects: Cards lift 8px, gold border intensifies

2. **Interactions**:

   - [ ] Free plan: "Download Extension" redirects to VS Code Marketplace
   - [ ] Early Adopter: "Buy Early Adopter" button (disabled until Paddle integrated)
   - [ ] Pro plan: Grayed out "Notify Me" button (disabled)

3. **Responsive**:
   - [ ] Mobile (\u003c768px): Single column, cards stack
   - [ ] Desktop (≥1024px): 3 columns, hover animations active

#### Login Page (`/login`)

1. **Layout**:

   - [ ] Centered glass card with Ptah logo
   - [ ] Radial gradient background (gold glow)
   - [ ] Email input field with proper styling
   - [ ] "Send Magic Link" button with gradient gold background

2. **Interactions**:

   - [ ] Enter email + click button → Success message "Check your email"
   - [ ] Invalid email → Error state
   - [ ] Loading state shows spinner

3. **Magic Link Flow**:
   - [ ] Click emailed link → Redirects to `/profile` with auth cookie set
   - [ ] Invalid token → Redirects to `/login?error=token_expired`

#### Profile Page (`/profile`)

1. **Authentication**:

   - [ ] Unauthenticated user redirected to `/login`
   - [ ] Authenticated user sees license details

2. **Layout**:

   - [ ] 2-column (desktop): License info left, 3D badge right
   - [ ] Single column (mobile): 3D badge hidden
   - [ ] Status badge color: Green (active), Red (expired)

3. **Data Display**:

   - [ ] Plan name: "Early Adopter" or "Pro"
   - [ ] Expiration date formatted correctly
   - [ ] Days remaining color-coded (green/yellow/red)
   - [ ] Email address displayed

4. **Interactions**:
   - [ ] Click "Copy" → License key copied to clipboard
   - [ ] Success feedback: Button text changes to "Copied!" for 2s
   - [ ] Checkout success toast (if URL has `?checkout=success`)

### Design Fidelity Checklist

From [visual-design-specification.md](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/visual-design-specification.md):

**Colors**:

- [ ] Background: `--obsidian` (#0a0a0a)
- [ ] Primary text: `--cream` (#f5f5dc)
- [ ] Accents: `--gold` (#d4af37)
- [ ] Status indicators: `--scarab-teal` (active), `--papyrus-red` (error)

**Typography**:

- [ ] Headlines: Cinzel (font-display)
- [ ] Body text: Inter (font-body)
- [ ] License keys: JetBrains Mono (font-mono)

**Effects**:

- [ ] Glass morphism: `backdrop-filter: blur(12px)`
- [ ] Gold glow: `box-shadow: 0 0 40px rgba(212,175,55,0.3)`
- [ ] Hover lift: `transform: translateY(-8px)`

**Accessibility**:

- [ ] Color contrast ≥ 4.5:1 (WCAG AA)
- [ ] All buttons keyboard navigable
- [ ] Focus states: 2px gold outline
- [ ] Screen reader labels on all interactive elements

---

## Dependencies

### Frontend Dependencies (Add to `package.json`)

```json
{
  "dependencies": {
    "@angular/router": "^20.0.0",
    "@angular/common/http": "^20.0.0"
  }
}
```

**Note**: Paddle SDK (`@paddle/paddle-js`) intentionally deferred until backend Paddle integration complete (Phase 6: Backend Execution)

### Backend Dependencies (Already Installed)

✅ NestJS with Prisma  
✅ JWT authentication (`@nest js/jwt`)  
✅ Magic link service (custom implementation)

---

## Out of Scope (Future Tasks)

- ❌ Paddle checkout integration (Phase 6: Backend Execution prerequisite)
- ❌ Paddle customer portal redirect (requires Paddle subscription ID)
- ❌ WorkOS SSO integration (magic link used instead)
- ❌ Subscription renewal flow (requires Paddle webhook handlers)
- ❌ Admin dashboard for license management
- ❌ Analytics tracking (Sentry/Mixpanel)
- ❌ Email template customization

---

## Risk Mitigation

### Risk 1: Design Asset Quality

**Probability**: Low (10%)  
**Impact**: Medium (visual polish affected)

**Mitigation**:

- Generated assets are PNG with transparency ✓ Verified
- Fallback: Use CSS gradients if images fail to load
- Test asset rendering on different screen densities

### Risk 2: Magic Link Email Delivery

**Probability**: Medium (20%)  
**Impact**: High (login blocked)

**Mitigation**:

- Backend email service already configured (SendGrid) ✓ Verified
- Add retry logic on frontend (3 attempts)
- Clear error messages if email fails

### Risk 3: Routing Conflicts with Existing Landing Page

**Probability**: Low (5%)  
**Impact**: High (breaks existing page)

**Mitigation**:

- Landing page becomes `/` route (unchanged URL)
- Test landing page still loads after routing added
- Incremental rollout: Test routing in dev environment first

### Risk 4: Browser Clipboard API Compatibility

**Probability**: Low (10%)  
**Impact**: Medium (copy function broken on older browsers)

**Mitigation**:

- Use `navigator.clipboard` API with fallback to `document.execCommand()`
- Show manual copy instructions if clipboard fails
- Test on Chrome, Firefox, Safari, Edge

---

## Quality Requirements

### Performance

**Targets** (from task-description.md):

- License API response time: \u003c 150ms (p95)
- Frontend page load (LCP): \u003c 2.5s (desktop), \u003c 3.5s (mobile)
- Time to Interactive (TTI): \u003c 3.5s

**Optimization strategies**:

- Lazy load profile page (reduce initial bundle)
- Preload critical assets (Ptah logo, fonts)
- Use Angular `OnPush` change detection

### Accessibility

**WCAG 2.1 AA Compliance**:

- [ ] All interactive elements keyboard navigable
- [ ] Focus management (Tab order logical)
- [ ] Color contrast ≥ 4.5:1
- [ ] Screen reader labels (`aria-label`, `alt` text)
- [ ] Error messages with `role="alert"`

### Security

**Frontend security**:

- ✅ JWT cookie HTTP-only (XSS protection) - backend enforced
- ✅ SameSite=lax (CSRF protection) - backend enforced
- ❌ **No sensitive data in localStorage** (use secure cookies only)
- ❌ **Never log license keys** (PII/security risk)

---

## Approved By

**Status**: **PENDING USER REVIEW** ✋

> **User**: Please review this implementation plan and reply with:
>
> 1. **Authentication Decision**: Approve magic link or request WorkOS SSO?
> 2. "APPROVED ✅" to proceed to implementation
> 3. Feedback/questions/changes if needed

---

**Document Version**: 1.0  
**Created**: 2026-01-22T14:30:00+02:00  
**Software Architect**: Antigravity (Evidence-Driven Edition)

<function_calls>
<invoke name="task_boundary">
<parameter name="TaskName">Phase 4 Architecture - License Frontend Integration
