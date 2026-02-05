import {
  Component,
  input,
  signal,
  inject,
  ChangeDetectionStrategy,
  effect,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideAngularModule,
  Clock,
  Sparkles,
  Zap,
  Shield,
  Bot,
} from 'lucide-angular';
import { TRIAL_DURATION_DAYS } from '@ptah-extension/shared';

/**
 * TrialEndedModalComponent - Modal for trial expiration (Landing Page Version)
 *
 * TASK_2025_143: Trial-ended notifications for landing page
 *
 * Displays when license API returns reason: 'trial_ended'
 * - Primary CTA: "Upgrade to Pro" navigates to /pricing
 * - Secondary CTA: "Continue with Community" dismisses for 24 hours
 * - Feature comparison snippet showing what Pro offers
 *
 * 24-hour dismissal tracked in localStorage with TTL
 *
 * Ported from: libs/frontend/chat/src/lib/components/molecules/trial-ended-modal.component.ts
 * Key adaptation: Uses Angular Router instead of RPC calls for navigation
 *
 * Complexity Level: 2 (Modal with localStorage TTL logic)
 *
 * SOLID Principles:
 * - Single Responsibility: Display trial ended modal only
 * - Open/Closed: Extensible via input signal for reason
 */
@Component({
  selector: 'ptah-trial-ended-modal',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="modal" [class.modal-open]="isOpen()">
      <div class="modal-box max-w-md">
        <!-- Header -->
        <div class="flex items-center gap-3 mb-4">
          <div
            class="w-12 h-12 rounded-full bg-warning/20 flex items-center justify-center"
          >
            <lucide-angular
              [img]="ClockIcon"
              class="w-6 h-6 text-warning"
              aria-hidden="true"
            />
          </div>
          <div>
            <h3 class="font-bold text-lg">Your Pro Trial Has Ended</h3>
            <p class="text-sm text-base-content/70">
              Your {{ trialDurationDays }}-day Pro trial period has concluded
            </p>
          </div>
        </div>

        <!-- Feature comparison -->
        <div class="bg-base-200 rounded-lg p-4 mb-4">
          <h4 class="font-semibold text-sm mb-2">Pro features you'll miss:</h4>
          <ul class="space-y-2 text-sm">
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="SparklesIcon"
                class="w-4 h-4 text-primary"
                aria-hidden="true"
              />
              <span>Advanced multi-agent orchestration</span>
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="ZapIcon"
                class="w-4 h-4 text-primary"
                aria-hidden="true"
              />
              <span>Priority API access & faster responses</span>
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="ShieldIcon"
                class="w-4 h-4 text-primary"
                aria-hidden="true"
              />
              <span>Extended context window & memory</span>
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="BotIcon"
                class="w-4 h-4 text-primary"
                aria-hidden="true"
              />
              <span>Custom agent creation & MCP tools</span>
            </li>
          </ul>
        </div>

        <!-- Community tier info -->
        <p class="text-sm text-base-content/70 mb-4">
          You can continue using Ptah with the Community tier, which includes
          basic AI assistance and standard features.
        </p>

        <!-- Actions -->
        <div class="modal-action flex-col sm:flex-row gap-2">
          <button
            class="btn btn-ghost flex-1"
            (click)="continueWithCommunity()"
            type="button"
          >
            Continue with Community
          </button>
          <button
            class="btn btn-primary flex-1"
            (click)="upgradeToPro()"
            type="button"
          >
            <lucide-angular
              [img]="SparklesIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Upgrade to Pro
          </button>
        </div>
      </div>

      <!-- Backdrop -->
      <form method="dialog" class="modal-backdrop">
        <button (click)="continueWithCommunity()" type="button">close</button>
      </form>
    </dialog>
  `,
})
export class TrialEndedModalComponent {
  // Input: License status reason
  readonly reason = input<string | undefined>(undefined);

  // Internal state
  readonly isOpen = signal(false);

  // Icons
  protected readonly ClockIcon = Clock;
  protected readonly SparklesIcon = Sparkles;
  protected readonly ZapIcon = Zap;
  protected readonly ShieldIcon = Shield;
  protected readonly BotIcon = Bot;

  // TASK_2025_143: Use constant instead of hardcoded value
  protected readonly trialDurationDays = TRIAL_DURATION_DAYS;

  // LocalStorage key and TTL (24 hours)
  private readonly DISMISS_KEY = 'ptah_trial_ended_dismissed_at';
  private readonly DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  private readonly router = inject(Router);

  constructor() {
    // Use effect to watch for reason changes (e.g., when license status is fetched async)
    // Effect runs on initial value AND subsequent changes, so no ngOnInit needed
    effect(() => {
      const currentReason = this.reason();
      this.checkAndShowModal(currentReason);
    });
  }

  /**
   * Check if modal should be shown based on reason and dismissal TTL
   */
  private checkAndShowModal(currentReason: string | undefined): void {
    // Only show if reason is 'trial_ended'
    if (currentReason !== 'trial_ended') {
      this.isOpen.set(false);
      return;
    }

    // Check if dismissed within TTL
    if (typeof localStorage !== 'undefined') {
      const dismissedAt = localStorage.getItem(this.DISMISS_KEY);
      if (dismissedAt) {
        const dismissedTime = parseInt(dismissedAt, 10);
        const now = Date.now();
        if (now - dismissedTime < this.DISMISS_TTL_MS) {
          // Still within 24-hour cooldown
          this.isOpen.set(false);
          return;
        }
      }
    }

    // Show modal
    this.isOpen.set(true);
  }

  /**
   * Navigate to pricing page and dismiss modal
   * Landing page version: Uses Angular Router instead of RPC
   */
  upgradeToPro(): void {
    this.dismiss();
    this.router.navigate(['/pricing']);
  }

  /**
   * Dismiss modal and continue with Community tier
   */
  continueWithCommunity(): void {
    this.dismiss();
  }

  /**
   * Dismiss modal and set localStorage timestamp for 24-hour cooldown
   */
  private dismiss(): void {
    this.isOpen.set(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.DISMISS_KEY, Date.now().toString());
    }
  }
}
