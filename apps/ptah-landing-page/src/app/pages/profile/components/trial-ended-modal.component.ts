import {
  Component,
  input,
  output,
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
              @if (daysRemaining() === 0) { Your {{ trialDurationDays }}-day Pro
              trial has expired } @else { Your Pro trial ends in
              {{ daysRemaining() }} day{{ daysRemaining() !== 1 ? 's' : '' }}
              }
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

      <!-- Backdrop (only dismissible if daysRemaining > 0) -->
      @if (daysRemaining() > 0) {
      <form method="dialog" class="modal-backdrop">
        <button (click)="continueWithCommunity()" type="button">close</button>
      </form>
      }
    </dialog>
  `,
})
export class TrialEndedModalComponent {
  // Input: License status reason
  public readonly reason = input<string | undefined>(undefined);

  // Input: Days remaining in trial (0 if fully expired)
  public readonly daysRemaining = input<number>(0);

  // Output: Event when user clicks "Continue with Community" and trial has ended (daysRemaining === 0)
  public readonly downgradeToCommunity = output<void>();

  // Internal state
  public readonly isOpen = signal(false);

  // Icons
  protected readonly ClockIcon = Clock;
  protected readonly SparklesIcon = Sparkles;
  protected readonly ZapIcon = Zap;
  protected readonly ShieldIcon = Shield;
  protected readonly BotIcon = Bot;

  // TASK_2025_143: Use constant instead of hardcoded value
  protected readonly trialDurationDays = TRIAL_DURATION_DAYS;

  private readonly router = inject(Router);

  public constructor() {
    // TASK_2025_143: Watch for reason changes to show/hide modal
    // No localStorage dismissal logic - modal shows every time when reason='trial_ended'
    effect(() => {
      const currentReason = this.reason();
      const days = this.daysRemaining();
      console.log('[TrialEndedModal] Effect triggered:', {
        currentReason,
        days,
      });
      // Only show if reason is 'trial_ended'
      const shouldOpen = currentReason === 'trial_ended';
      console.log('[TrialEndedModal] Setting isOpen to:', shouldOpen);
      this.isOpen.set(shouldOpen);
    });
  }

  /**
   * Navigate to pricing page and dismiss modal
   * Landing page version: Uses Angular Router instead of RPC
   */
  public upgradeToPro(): void {
    this.dismiss();
    this.router.navigate(['/pricing']);
  }

  /**
   * Dismiss modal and continue with Community tier
   *
   * TASK_2025_143: When trial has fully expired (daysRemaining === 0),
   * emit event to trigger downgrade API call before dismissing.
   */
  public continueWithCommunity(): void {
    // If trial fully expired, trigger downgrade before dismissing
    if (this.daysRemaining() === 0) {
      this.downgradeToCommunity.emit();
    }

    // Just close modal - no localStorage needed
    this.isOpen.set(false);
  }

  /**
   * Dismiss modal without storing timestamp
   * TASK_2025_143: Removed 24-hour localStorage logic
   */
  private dismiss(): void {
    this.isOpen.set(false);
  }
}
