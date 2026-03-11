import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationComponent } from '../../components/navigation.component';
import {
  LucideAngularModule,
  Clock,
  Sparkles,
  Zap,
  Shield,
  Bot,
} from 'lucide-angular';
import { PaddleCheckoutService } from '../../services/paddle-checkout.service';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'ptah-trial-ended-page',
  standalone: true,
  imports: [NavigationComponent, LucideAngularModule],
  template: `
    <div class="min-h-screen bg-base-100">
      <ptah-navigation />

      <div
        class="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4"
      >
        <div class="max-w-2xl w-full">
          <!-- Hero section with warning icon -->
          <div class="text-center mb-8">
            <div
              class="w-20 h-20 mx-auto mb-6 rounded-full bg-warning/20 flex items-center justify-center"
            >
              <lucide-angular
                [img]="ClockIcon"
                class="w-10 h-10 text-warning"
              />
            </div>
            <h1 class="text-4xl font-bold mb-4">
              @if (daysRemaining() <= 0) { Your Pro trial has expired } @else {
              Your Pro trial ends in {{ daysRemaining() }} day{{
                daysRemaining() !== 1 ? 's' : ''
              }}
              }
            </h1>
            <p class="text-lg text-base-content/70">
              Thanks for trying Ptah Pro! Choose how you'd like to continue.
            </p>
          </div>

          <!-- Feature comparison card -->
          <div class="card bg-base-200 shadow-xl mb-6">
            <div class="card-body">
              <h3 class="card-title mb-4">Pro features you'll miss:</h3>
              <ul class="space-y-3">
                <li class="flex items-center gap-3">
                  <lucide-angular
                    [img]="SparklesIcon"
                    class="w-5 h-5 text-primary flex-shrink-0"
                  />
                  <span>Advanced multi-agent orchestration</span>
                </li>
                <li class="flex items-center gap-3">
                  <lucide-angular
                    [img]="ZapIcon"
                    class="w-5 h-5 text-primary flex-shrink-0"
                  />
                  <span>Priority API access & faster responses</span>
                </li>
                <li class="flex items-center gap-3">
                  <lucide-angular
                    [img]="ShieldIcon"
                    class="w-5 h-5 text-primary flex-shrink-0"
                  />
                  <span>Extended context window & memory</span>
                </li>
                <li class="flex items-center gap-3">
                  <lucide-angular
                    [img]="BotIcon"
                    class="w-5 h-5 text-primary flex-shrink-0"
                  />
                  <span>Custom agent creation & MCP tools</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- Community tier info -->
          <div class="alert mb-6">
            <lucide-angular [img]="SparklesIcon" class="w-5 h-5" />
            <div>
              <h4 class="font-bold">Community tier is still powerful!</h4>
              <p class="text-sm">
                You can continue using Ptah with basic AI assistance and
                standard features.
              </p>
            </div>
          </div>

          <!-- Paddle error -->
          @if (paddleError()) {
          <div class="alert alert-warning mb-4">
            <span>{{ paddleError() }}</span>
            <button class="btn btn-sm btn-secondary" (click)="retryPaddle()">
              Retry
            </button>
          </div>
          }

          <!-- Billing toggle + price display -->
          <div class="flex flex-col items-center gap-3 mb-6">
            <div class="flex items-center gap-3">
              <span
                class="text-sm font-medium"
                [class]="isYearly() ? 'text-base-content/50' : 'text-primary'"
              >
                Monthly
              </span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                [checked]="isYearly()"
                (change)="isYearly.set(!isYearly())"
              />
              <span
                class="text-sm font-medium"
                [class]="isYearly() ? 'text-primary' : 'text-base-content/50'"
              >
                Yearly
              </span>
              @if (isYearly()) {
              <span class="badge badge-success badge-sm">-17%</span>
              }
            </div>
            <p class="text-2xl font-bold">
              {{ isYearly() ? '$50' : '$5' }}
              <span class="text-base font-normal text-base-content/70">
                / {{ isYearly() ? 'year' : 'month' }}
              </span>
            </p>
          </div>

          <!-- Action buttons -->
          <div class="flex flex-col sm:flex-row gap-4">
            <button
              class="btn btn-ghost flex-1"
              (click)="continueWithCommunity()"
              [disabled]="isDowngrading()"
            >
              @if (isDowngrading()) {
              <span class="loading loading-spinner loading-sm"></span>
              Processing... } @else { Continue with Community }
            </button>
            <button
              class="btn btn-primary flex-1 gap-2"
              (click)="upgradeToPro()"
              [disabled]="isCheckingOut()"
            >
              @if (isCheckingOut()) {
              <span class="loading loading-spinner loading-sm"></span>
              Opening checkout... } @else {
              <lucide-angular [img]="SparklesIcon" class="w-4 h-4" />
              Upgrade to Pro }
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class TrialEndedPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly paddleService = inject(PaddleCheckoutService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly daysRemaining = signal(0);
  public readonly isDowngrading = signal(false);
  public readonly isYearly = signal(false);
  public readonly isCheckingOut = signal(false);

  // Expose Paddle error for template
  public readonly paddleError = this.paddleService.error;

  // Icons
  public readonly ClockIcon = Clock;
  public readonly SparklesIcon = Sparkles;
  public readonly ZapIcon = Zap;
  public readonly ShieldIcon = Shield;
  public readonly BotIcon = Bot;

  public ngOnInit(): void {
    // Initialize Paddle SDK
    this.paddleService.initialize();

    // Fetch current license data to get daysRemaining
    this.http.get<{ daysRemaining?: number }>('/api/v1/licenses/me').subscribe({
      next: (data) => {
        this.daysRemaining.set(data.daysRemaining ?? 0);
      },
    });
  }

  public upgradeToPro(): void {
    if (this.isCheckingOut()) return;
    this.isCheckingOut.set(true);

    const priceId = this.isYearly()
      ? environment.paddle.proPriceIdYearly
      : environment.paddle.proPriceIdMonthly;

    // Get current user email for Paddle checkout
    this.authService
      .getCurrentUser()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.isCheckingOut.set(false);
          this.paddleService.openCheckout({
            priceId,
            customerEmail: user?.email,
          });
        },
        error: () => {
          this.isCheckingOut.set(false);
          this.paddleService.openCheckout({ priceId });
        },
      });
  }

  public retryPaddle(): void {
    this.paddleService.retryInitialization();
  }

  public async continueWithCommunity(): Promise<void> {
    this.isDowngrading.set(true);
    try {
      // Call backend to downgrade to Community plan
      await this.http
        .post('/api/v1/licenses/downgrade-to-community', {})
        .toPromise();
      // Redirect to profile after successful downgrade
      this.router.navigate(['/profile']);
    } catch (error) {
      console.error('Failed to downgrade:', error);
      this.isDowngrading.set(false);
    }
  }
}
