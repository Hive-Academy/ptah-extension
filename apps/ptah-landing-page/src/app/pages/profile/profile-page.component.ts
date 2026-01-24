import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  signal,
  inject,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LicenseData } from './models/license-data.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * ProfilePageComponent - User license dashboard
 *
 * Angular 21 patterns:
 * - signal() for state management
 * - inject() for DI
 * - Tailwind/DaisyUI for styling
 * - @if/@for control flow
 *
 * Protected Route: Requires authentication via AuthGuard
 * Backend API: GET /api/v1/licenses/me
 * Evidence: implementation-plan.md Phase 4 - Profile Page
 */
@Component({
  selector: 'ptah-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, RouterLink, NgOptimizedImage],
  template: `
    <div class="min-h-screen bg-base-100 p-6 text-base-content">
      <!-- Header -->
      <div class="max-w-4xl mx-auto mb-12 flex justify-between items-center">
        <h1
          class="font-display text-4xl md:text-5xl font-bold 
                 bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
        >
          Your License
        </h1>
        <button class="btn btn-outline btn-secondary" (click)="handleLogout()">
          Logout
        </button>
      </div>

      <!-- Loading State -->
      @if (isLoading()) {
      <div class="max-w-4xl mx-auto text-center py-16">
        <span class="loading loading-spinner loading-lg text-secondary"></span>
        <p class="mt-4 text-neutral-content">Loading license details...</p>
      </div>
      }

      <!-- Error State -->
      @if (errorMessage()) {
      <div class="max-w-md mx-auto">
        <div class="alert alert-error">
          <h3 class="font-bold">Error Loading License</h3>
          <p>{{ errorMessage() }}</p>
        </div>
        <button class="btn btn-error mt-4 w-full" (click)="loadLicense()">
          Retry
        </button>
      </div>
      }

      <!-- License Data -->
      @if (license() && !isLoading()) {
      <div class="max-w-4xl mx-auto relative">
        <!-- 3D Floating Badge (hidden on mobile) -->
        <div
          class="hidden lg:block absolute -top-20 -right-24 z-0 pointer-events-none"
        >
          <img
            ngSrc="/assets/images/license-system/license_badge_3d.png"
            alt="License Badge"
            width="288"
            height="288"
            class="w-72 animate-bounce drop-shadow-[0_20px_60px_rgba(212,175,55,0.4)]"
            priority
          />
        </div>

        <!-- License Card -->
        <div
          viewportAnimation
          [viewportConfig]="cardConfig"
          class="relative z-10 bg-base-200/90 backdrop-blur-3xl 
                   border border-secondary/20 rounded-3xl p-8 shadow-2xl"
        >
          <!-- Badges -->
          <div class="flex flex-wrap gap-3 mb-6">
            <span class="badge badge-lg" [class]="getTierBadgeClass()">
              {{ getTierName() }}
            </span>
            <span class="badge badge-lg" [class]="getStatusBadgeClass()">
              {{ license()!.status.toUpperCase() }}
            </span>
          </div>

          <!-- License Key -->
          <div class="mb-8">
            <span class="label-text text-neutral-content block mb-2"
              >License Key</span
            >
            <div
              class="flex gap-4 items-center bg-base-300/60 border border-secondary/20 
                       rounded-xl p-4"
            >
              <code
                class="flex-1 font-mono text-lg text-secondary tracking-wide"
              >
                {{ license()!.licenseKey }}
              </code>
              <button
                class="btn btn-sm btn-outline btn-secondary"
                (click)="copyLicenseKey()"
                [attr.aria-label]="isCopied() ? 'Copied!' : 'Copy license key'"
              >
                @if (isCopied()) { ✓ Copied } @else { Copy }
              </button>
            </div>
          </div>

          <!-- License Details -->
          <div class="space-y-4">
            <div class="flex justify-between py-3 border-b border-secondary/10">
              <span class="text-neutral-content">Email</span>
              <span>{{ license()!.email }}</span>
            </div>
            <div class="flex justify-between py-3 border-b border-secondary/10">
              <span class="text-neutral-content">Activated</span>
              <span>{{ formatDate(license()!.activatedAt) }}</span>
            </div>
            @if (license()!.expiresAt) {
            <div class="flex justify-between py-3 border-b border-secondary/10">
              <span class="text-neutral-content">Expires</span>
              <span>{{ formatDate(license()!.expiresAt) }}</span>
            </div>
            } @else {
            <div class="flex justify-between py-3">
              <span class="text-neutral-content">Validity</span>
              <span class="text-secondary font-semibold">
                Lifetime License
              </span>
            </div>
            }
          </div>
        </div>

        <!-- Actions -->
        <div class="mt-8">
          <a routerLink="/pricing" class="btn btn-outline btn-secondary w-full">
            View Pricing Plans
          </a>
        </div>
      </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ProfilePageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  // State signals
  public readonly license = signal<LicenseData | null>(null);
  public readonly isLoading = signal(true);
  public readonly errorMessage = signal('');
  public readonly isCopied = signal(false);

  // Animation config
  public readonly cardConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.1,
    ease: 'power2.out',
  };

  public ngOnInit(): void {
    this.loadLicense();
  }

  public loadLicense(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http.get<LicenseData>('/api/v1/licenses/me').subscribe({
      next: (data) => {
        this.license.set(data);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.error?.message || 'Failed to load license details'
        );
      },
    });
  }

  public copyLicenseKey(): void {
    const key = this.license()?.licenseKey;
    if (!key) return;

    navigator.clipboard.writeText(key).then(() => {
      this.isCopied.set(true);
      setTimeout(() => this.isCopied.set(false), 2000);
    });
  }

  public handleLogout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    });
  }

  public getTierName(): string {
    const tier = this.license()?.tier;
    if (tier === 'early_adopter') return 'Early Adopter';
    if (tier === 'pro') return 'Pro';
    return 'Free';
  }

  public getTierBadgeClass(): string {
    const tier = this.license()?.tier;
    if (tier === 'early_adopter') return 'badge-secondary';
    if (tier === 'pro') return 'badge-primary';
    return 'badge-ghost';
  }

  public getStatusBadgeClass(): string {
    const status = this.license()?.status;
    if (status === 'active') return 'badge-success';
    if (status === 'expired') return 'badge-error';
    return 'badge-ghost';
  }

  public formatDate(isoDate: string | null): string {
    if (!isoDate) return 'N/A';
    return new Date(isoDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
