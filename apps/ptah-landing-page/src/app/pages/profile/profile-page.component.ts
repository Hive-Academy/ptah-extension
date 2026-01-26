import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  signal,
  inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Settings, Shield } from 'lucide-angular';
import { AuthService } from '../../services/auth.service';
import { LicenseData } from './models/license-data.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  ProfileHeaderComponent,
  ProfileDetailsComponent,
  ProfileFeaturesComponent,
} from './components';

/**
 * ProfilePageComponent - Enhanced user account dashboard
 *
 * Orchestrating component that composes:
 * - ProfileHeaderComponent: Hero with avatar, stats, badges
 * - ProfileDetailsComponent: Account info and subscription status
 * - ProfileFeaturesComponent: Categorized feature list
 *
 * Responsibilities:
 * - Data fetching from /api/v1/licenses/me
 * - Loading/error state management
 * - Logout handling
 * - Action buttons
 *
 * Angular 21 patterns:
 * - signal() for state management
 * - inject() for DI
 * - Composition over inheritance
 * - Tailwind/DaisyUI with Anubis theme
 *
 * Protected Route: Requires authentication via AuthGuard
 * Backend API: GET /api/v1/licenses/me
 */
@Component({
  selector: 'ptah-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ViewportAnimationDirective,
    RouterLink,
    LucideAngularModule,
    ProfileHeaderComponent,
    ProfileDetailsComponent,
    ProfileFeaturesComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100">
      <!-- Loading State -->
      @if (isLoading()) {
      <div class="min-h-screen flex items-center justify-center">
        <div class="text-center">
          <span
            class="loading loading-spinner loading-lg text-secondary"
          ></span>
          <p class="mt-4 text-neutral-content">Loading your account...</p>
        </div>
      </div>
      }

      <!-- Error State -->
      @if (errorMessage() && !isLoading()) {
      <div class="min-h-screen flex items-center justify-center p-4">
        <div
          class="max-w-md w-full bg-base-200/95 backdrop-blur-xl border border-error/30 rounded-3xl p-8 shadow-2xl"
        >
          <div class="alert alert-error mb-4">
            <h3 class="font-bold">Error Loading Account</h3>
            <p>{{ errorMessage() }}</p>
          </div>
          <button class="btn btn-error w-full" (click)="loadLicense()">
            Retry
          </button>
        </div>
      </div>
      }

      <!-- Main Profile Content -->
      @if (license() && !isLoading()) {
      <!-- Profile Header with Avatar, Stats, Badges -->
      <ptah-profile-header [license]="license()" (logout)="handleLogout()" />

      <!-- Content Container -->
      <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <!-- Account Details & Upgrade CTA -->
        <ptah-profile-details [license]="license()" />

        <!-- Features Section -->
        <div class="mt-6">
          <ptah-profile-features [features]="license()?.features ?? []" />
        </div>

        <!-- Actions -->
        <div
          viewportAnimation
          [viewportConfig]="actionsConfig"
          class="mt-6 mb-12 grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <a routerLink="/pricing" class="btn btn-outline btn-secondary">
            <lucide-angular
              [img]="SettingsIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            {{
              license()?.plan === 'trial'
                ? 'View Pricing Plans'
                : 'Manage Subscription'
            }}
          </a>
          <a
            href="https://docs.ptah.dev"
            target="_blank"
            rel="noopener"
            class="btn btn-ghost"
          >
            <lucide-angular
              [img]="ShieldIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Documentation
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
  /** Lucide icon references */
  public readonly SettingsIcon = Settings;
  public readonly ShieldIcon = Shield;

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  // State signals
  public readonly license = signal<LicenseData | null>(null);
  public readonly isLoading = signal(true);
  public readonly errorMessage = signal('');

  // Animation config for actions
  public readonly actionsConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.4,
    threshold: 0.1,
    delay: 0.4,
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
}
