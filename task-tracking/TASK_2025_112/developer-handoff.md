# Developer Handoff - Frontend License System Pages

## Document Purpose

This document provides implementation guidance for developers building the three frontend pages for TASK_2025_112. It consolidates design specifications, assets, component architecture, and quality requirements.

---

## Quick Start

### Prerequisites

1. **Review Design System**: Read [Ptah Design System](file:///d:/projects/ptah-extension/.agent/skills/technical-content-writer/DESIGN-SYSTEM.md)
2. **Review Visual Specs**: Read [Visual Design Specification](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/visual-design-specification.md)
3. **Review Assets**: Read [Design Assets Inventory](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/design-assets-inventory.md)
4. **Install Dependencies**:
   ```bash
   npm install @paddle/paddle-js workos gsap three @angular-3d/core
   ```

### Implementation Order

1. **Pricing Page** (`/pricing`) - Standalone, no auth required
2. **Login Page** (`/login`) - Depends on backend auth API
3. **Profile Page** (`/profile`) - Depends on auth + license API

---

## Page 1: Pricing Page (`/pricing`)

### Component Structure

```
PricingPageComponent
├── PricingHeroComponent (headline + background pattern)
├── PricingGridComponent
│   ├── PlanCardComponent (Free)
│   ├── PlanCardComponent (Early Adopter) ← Has LIMITED badge
│   └── PlanCardComponent (Pro)
└── ComparisonTableComponent (optional)
```

### Implementation Steps

#### Step 1: Create Page Component

**File**: `apps/ptah-landing-page/src/app/pages/pricing/pricing-page.component.ts`

```typescript
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PricingHeroComponent } from './hero/pricing-hero.component';
import { PricingGridComponent } from './grid/pricing-grid.component';

@Component({
  selector: 'ptah-pricing-page',
  standalone: true,
  imports: [CommonModule, PricingHeroComponent, PricingGridComponent],
  template: `
    <div class="min-h-screen bg-obsidian">
      <ptah-pricing-hero />
      <ptah-pricing-grid />
    </div>
  `,
})
export class PricingPageComponent {}
```

#### Step 2: Create Hero Component

**File**: `apps/ptah-landing-page/src/app/pages/pricing/hero/pricing-hero.component.ts`

```typescript
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-pricing-hero',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="pricing-hero relative overflow-hidden py-24">
      <div class="container mx-auto px-6 text-center">
        <h1 class="text-5xl md:text-7xl font-display gradient-gold-text mb-6">Choose Your Path</h1>
        <p class="text-xl text-sand max-w-2xl mx-auto">Unlock ancient wisdom for modern development</p>
      </div>
    </section>
  `,
  styles: [
    `
      .pricing-hero {
        background-image: radial-gradient(ellipse at 50% 70%, rgba(212, 175, 55, 0.15), transparent 70%), url('/assets/images/license-system/pricing_hero_pattern.png');
        background-size: cover;
        background-position: center;
      }

      .gradient-gold-text {
        background: linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 50%, var(--gold-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    `,
  ],
})
export class PricingHeroComponent {}
```

#### Step 3: Create Plan Card Component

**File**: `apps/ptah-landing-page/src/app/pages/pricing/card/plan-card.component.ts`

```typescript
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Paddle } from '@paddle/paddle-js';

export interface PricingPlan {
  name: string;
  tier: 'free' | 'early_adopter' | 'pro';
  price: string;
  priceId?: string; // Paddle price ID
  features: string[];
  ctaText: string;
  ctaAction: 'download' | 'checkout';
  highlight?: boolean;
  badge?: string; // e.g., "LIMITED"
}

@Component({
  selector: 'ptah-plan-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="plan-card relative p-8 rounded-2xl transition-all duration-300" [class.highlighted]="plan.highlight" [class.hover:scale-105]="true">
      <!-- Badge (Early Adopter only) -->
      <img *ngIf="plan.badge" src="/assets/images/license-system/plan_badge_early_adopter.png" [alt]="plan.badge" class="absolute -top-2 right-6 w-32 h-auto limited-badge" />

      <!-- Plan Name -->
      <h3 class="text-2xl font-display text-cream mb-4">{{ plan.name }}</h3>

      <!-- Price -->
      <div class="mb-6">
        <span class="text-5xl font-bold gradient-gold-text">{{ plan.price }}</span>
        <span class="text-sand text-sm ml-2" *ngIf="plan.price !== 'Free'">/ 2 months</span>
      </div>

      <!-- Features -->
      <ul class="space-y-3 mb-8">
        <li *ngFor="let feature of plan.features" class="flex items-start gap-3 text-sand">
          <svg class="w-6 h-6 text-gold flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
          <span>{{ feature }}</span>
        </li>
      </ul>

      <!-- CTA Button -->
      <button (click)="handleCTA()" class="w-full py-4 rounded-xl font-semibold transition-all duration-300" [class]="plan.highlight ? 'bg-gradient-to-r from-gold to-gold-dark text-obsidian hover:shadow-gold' : 'border-2 border-gold text-gold hover:bg-gold hover:text-obsidian'">
        {{ plan.ctaText }}
      </button>
    </div>
  `,
  styles: [
    `
      .plan-card {
        background: rgba(26, 26, 26, 0.6);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(212, 175, 55, 0.2);
      }

      .plan-card.highlighted {
        background: rgba(42, 42, 42, 0.8);
        border: 2px solid var(--gold);
        box-shadow: 0 0 40px rgba(212, 175, 55, 0.3);
      }

      .limited-badge {
        filter: drop-shadow(0 0 20px rgba(212, 175, 55, 0.4));
        animation: glow-pulse 2s infinite;
      }

      @keyframes glow-pulse {
        0%,
        100% {
          filter: drop-shadow(0 0 20px rgba(212, 175, 55, 0.4));
        }
        50% {
          filter: drop-shadow(0 0 30px rgba(212, 175, 55, 0.6));
        }
      }

      .hover\:shadow-gold:hover {
        box-shadow: 0 0 30px rgba(212, 175, 55, 0.5);
      }

      .gradient-gold-text {
        background: linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 50%, var(--gold-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    `,
  ],
})
export class PlanCardComponent {
  @Input() plan!: PricingPlan;

  public handleCTA(): void {
    if (this.plan.ctaAction === 'download') {
      window.open('https://marketplace.visualstudio.com/items?itemName=ptah', '_blank');
    } else if (this.plan.ctaAction === 'checkout' && this.plan.priceId) {
      this.openPaddleCheckout(this.plan.priceId);
    }
  }

  private openPaddleCheckout(priceId: string): void {
    const paddle = new Paddle('YOUR_PADDLE_CLIENT_TOKEN'); // From environment
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      successUrl: `${window.location.origin}/profile?checkout=success`,
    });
  }
}
```

#### Step 4: Create Pricing Grid

**File**: `apps/ptah-landing-page/src/app/pages/pricing/grid/pricing-grid.component.ts`

```typescript
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanCardComponent, PricingPlan } from '../card/plan-card.component';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'ptah-pricing-grid',
  standalone: true,
  imports: [CommonModule, PlanCardComponent],
  template: `
    <section class="py-24 px-6">
      <div class="container mx-auto">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <ptah-plan-card *ngFor="let plan of plans" [plan]="plan" />
        </div>
      </div>
    </section>
  `,
})
export class PricingGridComponent {
  public readonly plans: PricingPlan[] = [
    {
      name: 'Free',
      tier: 'free',
      price: 'Free',
      features: ['Basic code generation', 'Community support', 'Limited AI models', 'VS Code integration'],
      ctaText: 'Download Extension',
      ctaAction: 'download',
    },
    {
      name: 'Early Adopter',
      tier: 'early_adopter',
      price: '$49',
      priceId: environment.paddlePriceIdEarlyAdopter,
      features: ['All Free features', 'Premium AI models (Claude Opus)', 'Priority support', '2-month access', 'Limited availability'],
      ctaText: 'Buy Early Adopter',
      ctaAction: 'checkout',
      highlight: true,
      badge: 'LIMITED',
    },
    {
      name: 'Pro',
      tier: 'pro',
      price: '$99',
      priceId: environment.paddlePriceIdPro,
      features: ['All Early Adopter features', 'Unlimited AI requests', 'Custom workflows', '12-month access', 'Dedicated support'],
      ctaText: 'Go Pro',
      ctaAction: 'checkout',
    },
  ];
}
```

#### Step 5: Environment Configuration

**File**: `apps/ptah-landing-page/src/environments/environment.ts`

```typescript
export const environment = {
  production: false,
  paddleClientToken: 'test_xxxxxxxxxxxxxxxxxxxxxxxx', // From Paddle dashboard
  paddlePriceIdEarlyAdopter: 'pri_01jqbkwnq87xxxxxxxxx',
  paddlePriceIdPro: 'pri_01jqbkwnq87yyyyyyyyy',
};
```

### Responsive Behavior

| Breakpoint          | Layout        | Changes                             |
| ------------------- | ------------- | ----------------------------------- |
| Mobile (<768px)     | Single column | Cards stack vertically, full width  |
| Tablet (768-1024px) | 3 columns     | Smaller padding, reduced font sizes |
| Desktop (>1024px)   | 3 columns     | Full spacing, scale on hover        |

### Accessibility Checklist

- [ ] All buttons have clear focus states (2px gold outline)
- [ ] Plan cards are keyboard navigable (Tab order: Free → Early Adopter → Pro)
- [ ] Badge images have `alt` text
- [ ] Color contrast meets WCAG 2.1 AA (4.5:1)
- [ ] Screen reader announces price as "49 dollars per 2 months"

---

## Page 2: Login Page (`/login`)

### Component Structure

```
LoginPageComponent
└── AuthCardComponent
    ├── PtahLogoComponent (animated)
    └── SSO Button (WorkOS)
```

### Implementation Steps

#### Step 1: Create Login Page Component

**File**: `apps/ptah-landing-page/src/app/pages/login/login-page.component.ts`

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'ptah-login-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="login-page min-h-screen flex items-center justify-center px-6">
      <!-- Background gradient -->
      <div class="absolute inset-0 bg-gradient-radial from-gold/10 via-transparent to-transparent opacity-50"></div>

      <!-- Auth Card -->
      <div class="auth-card relative z-10 w-full max-w-md p-12 rounded-3xl">
        <!-- Animated Logo -->
        <div class="flex justify-center mb-8">
          <img src="/assets/images/ptah-logo.svg" alt="Ptah Logo" class="w-24 h-24 animate-glow" />
        </div>

        <!-- Tagline -->
        <h1 class="text-3xl font-display text-center gradient-gold-text mb-3">Welcome Back</h1>
        <p class="text-sand text-center mb-10">Access your sacred workspace</p>

        <!-- SSO Button -->
        <button (click)="handleSSOLogin()" [disabled]="isLoading" class="sso-button w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl font-semibold transition-all duration-300">
          <img src="/assets/images/license-system/workos_sso_icon.png" alt="" class="w-6 h-6" aria-hidden="true" />
          <span *ngIf="!isLoading">Sign in with WorkOS</span>
          <span *ngIf="isLoading" class="flex items-center gap-2">
            <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Redirecting...
          </span>
        </button>

        <!-- Error State -->
        <div *ngIf="errorMessage" class="mt-6 p-4 rounded-lg bg-papyrus-red/10 border border-papyrus-red/30" role="alert">
          <p class="text-papyrus-red text-sm">{{ errorMessage }}</p>
          <button (click)="clearError()" class="mt-2 text-xs text-sand hover:text-cream underline">Try again</button>
        </div>

        <!-- Optional: Free Plan Link -->
        <div class="mt-8 text-center">
          <p class="text-stone text-sm">
            Don't have an account?
            <a href="/pricing" class="text-gold hover:text-gold-light underline"> Start with Free </a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .login-page {
        background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
      }

      .auth-card {
        background: rgba(26, 26, 26, 0.8);
        backdrop-filter: blur(30px);
        border: 1px solid rgba(212, 175, 55, 0.3);
        box-shadow: 0 0 60px rgba(212, 175, 55, 0.15);
      }

      .sso-button {
        background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
        color: var(--obsidian);
        box-shadow: 0 4px 20px rgba(212, 175, 55, 0.3);
      }

      .sso-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(212, 175, 55, 0.5);
      }

      .sso-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      @keyframes glow {
        0%,
        100% {
          filter: drop-shadow(0 0 20px rgba(212, 175, 55, 0.6));
        }
        50% {
          filter: drop-shadow(0 0 40px rgba(212, 175, 55, 0.9));
        }
      }

      .animate-glow {
        animation: glow 3s infinite;
      }

      .gradient-gold-text {
        background: linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 50%, var(--gold-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    `,
  ],
})
export class LoginPageComponent implements OnInit {
  public isLoading = false;
  public errorMessage = '';

  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  public ngOnInit(): void {
    // Redirect if already authenticated
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/profile']);
    }
  }

  public handleSSOLogin(): void {
    this.isLoading = true;
    this.errorMessage = '';

    // Redirect to backend WorkOS auth endpoint
    window.location.href = '/api/auth/workos';
  }

  public clearError(): void {
    this.errorMessage = '';
  }
}
```

#### Step 2: Create Auth Service

**File**: `apps/ptah-landing-page/src/app/core/services/auth.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface User {
  id: string;
  email: string;
  name?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly currentUserSubject = new BehaviorSubject<User | null>(null);
  public readonly currentUser$ = this.currentUserSubject.asObservable();

  constructor(private readonly http: HttpClient) {
    this.checkAuthStatus();
  }

  public isAuthenticated(): boolean {
    return this.currentUserSubject.value !== null;
  }

  private checkAuthStatus(): void {
    this.http.get<User>('/api/auth/me').subscribe({
      next: (user) => this.currentUserSubject.next(user),
      error: () => this.currentUserSubject.next(null),
    });
  }

  public logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {}).pipe(tap(() => this.currentUserSubject.next(null)));
  }
}
```

### Responsive Behavior

| Breakpoint          | Layout        | Changes                              |
| ------------------- | ------------- | ------------------------------------ |
| Mobile (<768px)     | Centered card | Smaller logo (64px), reduced padding |
| Tablet (768-1024px) | Centered card | Standard sizing                      |
| Desktop (>1024px)   | Centered card | Full effects, logo glow animation    |

### Accessibility Checklist

- [ ] Button has clear focus state
- [ ] Loading state announced to screen readers (`aria-live="polite"`)
- [ ] Error messages have `role="alert"`
- [ ] Logo has descriptive `alt` text
- [ ] Keyboard navigation works (Tab to button, Enter to submit)

---

## Page 3: Profile/Dashboard Page (`/profile`)

### Component Structure

```
ProfilePageComponent
├── ProfileHeaderComponent
├── SubscriptionStatusCardComponent
│   ├── Plan name badge
│   ├── Status indicator (active/expired)
│   └── Expiration date
├── LicenseDetailsCardComponent
│   ├── License key display
│   ├── Copy button with toast
│   └── Days remaining indicator
├── ActionButtonsComponent
│   ├── Manage Subscription (Paddle portal)
│   └── Renew License (Paddle checkout)
└── License3DVisualComponent (desktop only, optional)
```

### Implementation Steps

#### Step 1: Create Profile Page Component

**File**: `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts`

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';

export interface LicenseData {
  licenseKey: string;
  plan: 'early_adopter' | 'pro';
  status: 'active' | 'expired';
  expiresAt: string; // ISO date string
  daysRemaining: number;
  paddleSubscriptionId?: string;
}

@Component({
  selector: 'ptah-profile-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="profile-page min-h-screen bg-obsidian py-24 px-6">
      <div class="container mx-auto max-w-7xl">
        <!-- Success Toast (after checkout) -->
        <div *ngIf="showSuccessToast" class="fixed top-6 right-6 p-4 rounded-lg bg-scarab-teal/20 border border-scarab-teal/50 z-50 animate-slide-in" role="alert">
          <p class="text-scarab-teal font-semibold">✓ License activated successfully!</p>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gold border-t-transparent"></div>
          <p class="text-sand mt-4">Loading your license...</p>
        </div>

        <!-- Error State -->
        <div *ngIf="errorMessage" class="text-center">
          <p class="text-papyrus-red mb-4">{{ errorMessage }}</p>
          <button (click)="loadLicenseData()" class="px-6 py-3 rounded-lg bg-gold text-obsidian font-semibold hover:bg-gold-light">Retry</button>
        </div>

        <!-- Profile Content (2-column layout on desktop) -->
        <div *ngIf="!isLoading && !errorMessage && licenseData" class="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <!-- Left Column: License Info -->
          <div class="space-y-8">
            <!-- Page Header -->
            <div>
              <h1 class="text-5xl font-display gradient-gold-text mb-3">Your License</h1>
              <p class="text-sand">Manage your Ptah subscription</p>
            </div>

            <!-- Subscription Status Card -->
            <div class="glass-card p-8 rounded-2xl">
              <div class="flex items-center justify-between mb-6">
                <h2 class="text-2xl font-semibold text-cream">Subscription Status</h2>
                <span class="px-4 py-2 rounded-full text-sm font-semibold" [class]="licenseData.status === 'active' ? 'bg-scarab-teal/20 text-scarab-teal' : 'bg-papyrus-red/20 text-papyrus-red'">
                  {{ licenseData.status === 'active' ? 'Active' : 'Expired' }}
                </span>
              </div>

              <div class="space-y-4">
                <div>
                  <p class="text-stone text-sm mb-1">Plan</p>
                  <p class="text-cream text-xl font-semibold">
                    {{ licenseData.plan === 'early_adopter' ? 'Early Adopter' : 'Pro' }}
                  </p>
                </div>

                <div>
                  <p class="text-stone text-sm mb-1">Expires</p>
                  <p class="text-cream">{{ licenseData.expiresAt | date : 'longDate' }}</p>
                  <p class="text-sm mt-1" [class]="licenseData.daysRemaining > 7 ? 'text-sand' : 'text-papyrus-red'">{{ licenseData.daysRemaining }} days remaining</p>
                </div>
              </div>
            </div>

            <!-- License Key Card -->
            <div class="glass-card p-8 rounded-2xl">
              <h2 class="text-2xl font-semibold text-cream mb-6">License Key</h2>

              <div class="relative">
                <input type="text" [value]="licenseData.licenseKey" readonly class="w-full p-4 pr-24 bg-obsidian border border-gold-dark rounded-lg text-cream font-mono text-sm" aria-label="License key" />
                <button (click)="copyLicenseKey()" class="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-gold text-obsidian rounded-lg font-semibold hover:bg-gold-light transition-colors">
                  {{ copyButtonText }}
                </button>
              </div>

              <p class="text-stone text-sm mt-4">Copy this key to activate Ptah in VS Code</p>
            </div>

            <!-- Action Buttons -->
            <div class="flex flex-col sm:flex-row gap-4">
              <button *ngIf="licenseData.paddleSubscriptionId" (click)="openPaddlePortal()" class="flex-1 px-6 py-4 border-2 border-gold text-gold rounded-xl font-semibold hover:bg-gold hover:text-obsidian transition-all">Manage Subscription</button>

              <button *ngIf="licenseData.status === 'expired'" (click)="renewLicense()" class="flex-1 px-6 py-4 bg-gradient-to-r from-gold to-gold-dark text-obsidian rounded-xl font-semibold hover:shadow-lg hover:shadow-gold/50 transition-all">Renew License</button>
            </div>
          </div>

          <!-- Right Column: 3D Visual (desktop only) -->
          <div class="hidden lg:flex items-center justify-center">
            <div class="relative w-full h-96">
              <img src="/assets/images/license-system/license_badge_3d.png" alt="Premium license badge" class="w-full h-full object-contain animate-float" />
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .profile-page {
        background: radial-gradient(ellipse at 50% 0%, rgba(212, 175, 55, 0.1) 0%, transparent 50%);
      }

      .glass-card {
        background: rgba(26, 26, 26, 0.8);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(212, 175, 55, 0.2);
      }

      .gradient-gold-text {
        background: linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 50%, var(--gold-dark) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      @keyframes float {
        0%,
        100% {
          transform: translateY(0px);
        }
        50% {
          transform: translateY(-20px);
        }
      }

      .animate-float {
        animation: float 6s ease-in-out infinite;
      }

      @keyframes slide-in {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      .animate-slide-in {
        animation: slide-in 0.3s ease-out;
      }
    `,
  ],
})
export class ProfilePageComponent implements OnInit {
  public isLoading = true;
  public errorMessage = '';
  public licenseData: LicenseData | null = null;
  public copyButtonText = 'Copy';
  public showSuccessToast = false;

  constructor(private readonly http: HttpClient, private readonly router: Router) {}

  public ngOnInit(): void {
    // Check for checkout success query param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('checkout') === 'success') {
      this.showSuccessToast = true;
      setTimeout(() => {
        this.showSuccessToast = false;
        // Clean URL
        window.history.replaceState({}, '', '/profile');
      }, 5000);
    }

    this.loadLicenseData();
  }

  public loadLicenseData(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http.get<LicenseData>('/api/v1/licenses/me').subscribe({
      next: (data) => {
        this.licenseData = data;
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = 'Failed to load license data. Please try again.';
        this.isLoading = false;
        console.error('License API error:', err);
      },
    });
  }

  public copyLicenseKey(): void {
    if (!this.licenseData) return;

    navigator.clipboard.writeText(this.licenseData.licenseKey).then(() => {
      this.copyButtonText = 'Copied!';
      setTimeout(() => {
        this.copyButtonText = 'Copy';
      }, 2000);
    });
  }

  public openPaddlePortal(): void {
    if (!this.licenseData?.paddleSubscriptionId) return;

    // Redirect to backend endpoint that generates Paddle portal URL
    window.location.href = `/api/paddle/portal?subscriptionId=${this.licenseData.paddleSubscriptionId}`;
  }

  public renewLicense(): void {
    // Open Paddle checkout for renewal (use same price ID as original plan)
    const priceId = this.licenseData?.plan === 'early_adopter' ? 'pri_01jqbkwnq87xxxxxxxxx' : 'pri_01jqbkwnq87yyyyyyyyy';

    const paddle = new Paddle('YOUR_PADDLE_CLIENT_TOKEN');
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      successUrl: `${window.location.origin}/profile?checkout=success`,
    });
  }
}
```

### Responsive Behavior

| Breakpoint          | Layout        | Changes                                    |
| ------------------- | ------------- | ------------------------------------------ |
| Mobile (<768px)     | Single column | 3D visual hidden, buttons stack vertically |
| Tablet (768-1024px) | Single column | 3D visual hidden, buttons in row           |
| Desktop (>1024px)   | 2 columns     | 3D visual shown, full effects              |

### Accessibility Checklist

- [ ] License key input has `aria-label`
- [ ] Status badge has semantic color (green/red)
- [ ] Copy button announces "Copied" to screen readers
- [ ] Success toast has `role="alert"`
- [ ] All interactive elements keyboard accessible

---

## Global Requirements

### TailwindCSS Extensions

Add these to `apps/ptah-landing-page/tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        obsidian: '#0a0a0a',
        charcoal: '#1a1a1a',
        smoke: '#2a2a2a',
        gold: '#d4af37',
        'gold-light': '#f4d47c',
        'gold-dark': '#9a7b2c',
        cream: '#f5f5dc',
        sand: '#c4b998',
        stone: '#8a8a8a',
        'scarab-teal': '#2dd4bf',
        'papyrus-red': '#ef4444',
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s infinite',
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { filter: 'drop-shadow(0 0 20px rgba(212, 175, 55, 0.4))' },
          '50%': { filter: 'drop-shadow(0 0 30px rgba(212, 175, 55, 0.6))' },
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

### GSAP Configuration

**File**: `apps/ptah-landing-page/src/app/app.config.ts`

```typescript
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Add to your app initialization
export function initializeAnimations() {
  // Scroll-based reveals
  gsap.utils.toArray('.reveal-on-scroll').forEach((element: any) => {
    gsap.from(element, {
      y: 100,
      opacity: 0,
      duration: 1,
      scrollTrigger: {
        trigger: element,
        start: 'top 80%',
        toggleActions: 'play none none reverse',
      },
    });
  });
}
```

### HTTP Interceptor (Auth)

**File**: `apps/ptah-landing-page/src/app/core/interceptors/auth.interceptor.ts`

```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  return next(req).pipe(
    catchError((error) => {
      if (error.status === 401) {
        // Redirect to login on 401 Unauthorized
        router.navigate(['/login']);
      }
      return throwError(() => error);
    })
  );
};
```

---

## Quality Checklist

### Design System Compliance

- [ ] All colors use CSS variables from Ptah Design System
- [ ] Typography follows type scale (display, heading, body)
- [ ] Spacing uses 8px grid system
- [ ] Glassmorphism effects on cards (`backdrop-filter: blur(20px)`)
- [ ] Gold gradients applied to CTAs and accents

### Accessibility (WCAG 2.1 AA)

- [ ] All text meets 4.5:1 contrast ratio
- [ ] Focus states visible on all interactive elements
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Screen reader friendly (ARIA labels, semantic HTML)
- [ ] Reduced motion respected (`prefers-reduced-motion`)

### Responsiveness

- [ ] Mobile-first approach (breakpoints: 768px, 1024px)
- [ ] Touch targets ≥ 44x44px
- [ ] No horizontal scroll on mobile
- [ ] Images lazy-loaded and optimized (WebP)

### Performance

- [ ] Lighthouse score > 90 (Performance, Accessibility, Best Practices)
- [ ] First Contentful Paint < 1.5s
- [ ] Total image size < 200KB (after WebP compression)
- [ ] GSAP animations use `will-change` for GPU acceleration

### Brand Alignment

- [ ] Egyptian sacred tech aesthetic maintained
- [ ] Premium/mystical mood conveyed
- [ ] Consistent with existing Ptah extension UI
- [ ] Matches BlueYard Capital inspiration

---

## Testing Plan

### Unit Tests (Jest)

```bash
# Test plan card checkout logic
npm test -- --testNamePattern="PlanCardComponent should open Paddle checkout for paid plans"

# Test auth service token refresh
npm test -- --testNamePattern="AuthService should redirect to login on 401"

# Test license key copy to clipboard
npm test -- --testNamePattern="ProfilePageComponent should copy license key to clipboard"
```

### E2E Tests (Playwright)

```javascript
// pricing-page.spec.ts
test('should allow user to purchase Early Adopter plan', async ({ page }) => {
  await page.goto('/pricing');
  await page.click('text=Buy Early Adopter');
  // Verify Paddle checkout modal opens
  await expect(page.locator('.paddle-checkout-frame')).toBeVisible();
});

// login-page.spec.ts
test('should redirect to /profile after successful SSO login', async ({ page }) => {
  await page.goto('/login');
  await page.click('text=Sign in with WorkOS');
  // Mock WorkOS callback
  await page.goto('/api/auth/workos/callback?code=test123');
  await expect(page).toHaveURL('/profile');
});

// profile-page.spec.ts
test('should display license key and allow copying', async ({ page }) => {
  await page.goto('/profile');
  const licenseKey = await page.locator('input[aria-label="License key"]').inputValue();
  await page.click('text=Copy');
  // Verify clipboard (requires clipboard permissions in Playwright)
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(licenseKey);
});
```

### Manual Testing Checklist

- [ ] Paddle checkout completes successfully (use test card 4242 4242 4242 4242)
- [ ] WorkOS SSO redirects correctly (test with sandbox environment)
- [ ] License key displays on `/profile` after purchase
- [ ] Copy-to-clipboard works across browsers (Chrome, Firefox, Safari)
- [ ] Animations run smoothly on 60fps (check Chrome DevTools Performance)
- [ ] Page loads correctly on slow 3G network (Lighthouse throttling)

---

## Deployment Notes

### Environment Variables (Production)

```bash
# DigitalOcean App Platform
PADDLE_CLIENT_TOKEN=live_xxxxxxxxxxxxxxxxxxxxxxxx
PADDLE_PRICE_ID_EARLY_ADOPTER=pri_01jqbkwnq87xxxxxxxxx
PADDLE_PRICE_ID_PRO=pri_01jqbkwnq87yyyyyyyyy
WORKOS_API_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxxxxx
WORKOS_CLIENT_ID=client_xxxxxxxxxxxxxxxxxxxxxxxx
```

### Build Command

```bash
nx build ptah-landing-page --configuration=production
```

### Asset Optimization Pre-Deploy

```bash
# Convert PNGs to WebP
cwebp -q 85 pricing_hero_pattern.png -o pricing_hero_pattern.webp
cwebp -q 85 license_badge_3d.png -o license_badge_3d.webp

# Generate responsive variants
magick pricing_hero_pattern.png -resize 1280x720 pricing_hero_pattern-tablet.webp
magick pricing_hero_pattern.png -resize 768x432 pricing_hero_pattern-mobile.webp
```

### CDN Caching Headers

```nginx
# nginx.conf
location /assets/images/ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}
```

---

## Support & References

### Documentation Links

- [Visual Design Specification](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/visual-design-specification.md)
- [Design Assets Inventory](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/design-assets-inventory.md)
- [Ptah Design System](file:///d:/projects/ptah-extension/.agent/skills/technical-content-writer/DESIGN-SYSTEM.md)
- [Research Findings](file:///d:/projects/ptah-extension/task-tracking/TASK_2025_112/research-findings.md)

### External References

- [Paddle.js Documentation](https://developer.paddle.com/paddlejs/overview)
- [WorkOS OAuth Guide](https://workos.com/docs/sso/guide)
- [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)
- [TailwindCSS Dark Mode](https://tailwindcss.com/docs/dark-mode)

### Questions?

Contact: ui-ux-designer agent (Phase 3 lead)  
Task: TASK_2025_112  
Last Updated: 2026-01-22

---

**Developer Handoff Complete. Ready for Phase 4: Architecture Planning.**
