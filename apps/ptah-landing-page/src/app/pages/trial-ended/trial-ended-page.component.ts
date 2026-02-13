import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NavigationComponent } from '../../components/navigation.component';
import {
  LucideAngularModule,
  Clock,
  Sparkles,
  Zap,
  Shield,
  Bot,
} from 'lucide-angular';

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
            >
              <lucide-angular [img]="SparklesIcon" class="w-4 h-4" />
              Upgrade to Pro
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

  public readonly daysRemaining = signal(0);
  public readonly isDowngrading = signal(false);

  // Icons
  public readonly ClockIcon = Clock;
  public readonly SparklesIcon = Sparkles;
  public readonly ZapIcon = Zap;
  public readonly ShieldIcon = Shield;
  public readonly BotIcon = Bot;

  public ngOnInit(): void {
    // Fetch current license data to get daysRemaining
    this.http.get<{ daysRemaining?: number }>('/api/v1/licenses/me').subscribe({
      next: (data) => {
        this.daysRemaining.set(data.daysRemaining ?? 0);
      },
    });
  }

  public upgradeToPro(): void {
    this.router.navigate(['/pricing']);
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
