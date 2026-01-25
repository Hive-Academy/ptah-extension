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
import { LucideAngularModule, Check } from 'lucide-angular';
import { AuthService } from '../../services/auth.service';
import { LicenseData } from './models/license-data.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * ProfilePageComponent - User account dashboard
 *
 * Angular 21 patterns:
 * - signal() for state management
 * - inject() for DI
 * - Tailwind/DaisyUI for styling
 * - @if/@for control flow
 *
 * Protected Route: Requires authentication via AuthGuard
 * Backend API: GET /api/v1/licenses/me
 *
 * Note: License key is NOT returned by backend for security reasons.
 * License key is only sent via email after purchase.
 */
@Component({
  selector: 'ptah-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, RouterLink, NgOptimizedImage, LucideAngularModule],
  template: `
    <div class="min-h-screen bg-base-100 p-6 text-base-content">
      <!-- Header -->
      <div class="max-w-4xl mx-auto mb-12 flex justify-between items-center">
        <h1
          class="font-display text-4xl md:text-5xl font-bold
                 bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
        >
          Your Account
        </h1>
        <button class="btn btn-outline btn-secondary" (click)="handleLogout()">
          Logout
        </button>
      </div>

      <!-- Loading State -->
      @if (isLoading()) {
      <div class="max-w-4xl mx-auto text-center py-16">
        <span class="loading loading-spinner loading-lg text-secondary"></span>
        <p class="mt-4 text-neutral-content">Loading account details...</p>
      </div>
      }

      <!-- Error State -->
      @if (errorMessage()) {
      <div class="max-w-md mx-auto">
        <div class="alert alert-error">
          <h3 class="font-bold">Error Loading Account</h3>
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
        @if (license()?.plan !== 'free') {
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
        }

        <!-- Account Card -->
        <div
          viewportAnimation
          [viewportConfig]="cardConfig"
          class="relative z-10 bg-base-200/90 backdrop-blur-3xl
                   border border-secondary/20 rounded-3xl p-8 shadow-2xl"
        >
          <!-- Badges -->
          <div class="flex flex-wrap gap-3 mb-6">
            <span class="badge badge-lg" [class]="getPlanBadgeClass()">
              {{ getPlanName() }}
            </span>
            <span class="badge badge-lg" [class]="getStatusBadgeClass()">
              {{ (license()?.status ?? 'none').toUpperCase() }}
            </span>
          </div>

          <!-- Free Tier Message -->
          @if (license()?.message) {
          <div class="alert alert-info mb-6">
            <p>{{ license()?.message }}</p>
            <a routerLink="/pricing" class="btn btn-sm btn-secondary">
              Upgrade Now
            </a>
          </div>
          }

          <!-- Account Details -->
          <div class="space-y-4">
            <div class="flex justify-between py-3 border-b border-secondary/10">
              <span class="text-neutral-content">Email</span>
              <span>{{ license()?.email ?? 'N/A' }}</span>
            </div>

            <div class="flex justify-between py-3 border-b border-secondary/10">
              <span class="text-neutral-content">Member Since</span>
              <span>{{ formatDate(license()?.createdAt ?? null) }}</span>
            </div>

            @if (license()?.expiresAt) {
            <div class="flex justify-between py-3 border-b border-secondary/10">
              <span class="text-neutral-content">Expires</span>
              <span [class]="getExpiryClass()">
                {{ formatDate(license()?.expiresAt ?? null) }}
                @if (license()?.daysRemaining !== undefined) {
                <span class="text-sm ml-2">
                  ({{ license()?.daysRemaining }} days remaining)
                </span>
                }
              </span>
            </div>
            } @else if (license()?.plan !== 'free') {
            <div class="flex justify-between py-3 border-b border-secondary/10">
              <span class="text-neutral-content">Validity</span>
              <span class="text-secondary font-semibold">
                Lifetime License
              </span>
            </div>
            }
          </div>

          <!-- Features List -->
          @if (license()?.features && license()!.features.length > 0) {
          <div class="mt-8">
            <h3 class="text-lg font-semibold mb-4 text-secondary">
              Your Features
            </h3>
            <ul class="grid grid-cols-1 md:grid-cols-2 gap-3">
              @for (feature of license()?.features ?? []; track feature) {
              <li class="flex items-center gap-2 text-base-content/80">
                <lucide-angular
                  [img]="CheckIcon"
                  class="w-5 h-5 text-success flex-shrink-0"
                />
                <span>{{ feature }}</span>
              </li>
              }
            </ul>
          </div>
          }
        </div>

        <!-- Actions -->
        <div class="mt-8">
          <a routerLink="/pricing" class="btn btn-outline btn-secondary w-full">
            {{
              license()?.plan === 'free'
                ? 'View Pricing Plans'
                : 'Manage Subscription'
            }}
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
  /** Lucide icon reference */
  readonly CheckIcon = Check;

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  // State signals
  public readonly license = signal<LicenseData | null>(null);
  public readonly isLoading = signal(true);
  public readonly errorMessage = signal('');

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
          error.error?.message || 'Failed to load account details'
        );
      },
    });
  }

  public handleLogout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    });
  }

  public getPlanName(): string {
    const plan = this.license()?.plan;
    if (plan === 'early_adopter') return 'Early Adopter';
    if (plan === 'pro') return 'Pro';
    return 'Free';
  }

  public getPlanBadgeClass(): string {
    const plan = this.license()?.plan;
    if (plan === 'early_adopter') return 'badge-secondary';
    if (plan === 'pro') return 'badge-primary';
    return 'badge-ghost';
  }

  public getStatusBadgeClass(): string {
    const status = this.license()?.status;
    if (status === 'active') return 'badge-success';
    if (status === 'expired') return 'badge-error';
    return 'badge-ghost';
  }

  public getExpiryClass(): string {
    const days = this.license()?.daysRemaining;
    if (days === undefined) return '';
    if (days <= 7) return 'text-error';
    if (days <= 30) return 'text-warning';
    return 'text-success';
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
