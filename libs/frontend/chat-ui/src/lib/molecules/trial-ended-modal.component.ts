import {
  Component,
  input,
  signal,
  inject,
  ChangeDetectionStrategy,
  effect,
} from '@angular/core';
import {
  LucideAngularModule,
  Clock,
  Sparkles,
  Zap,
  Shield,
  Bot,
  ExternalLink,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { TRIAL_DURATION_DAYS } from '@ptah-extension/shared';

/**
 * TrialEndedModalComponent - Modal for trial/subscription expiration
 *
 * Displays when license:getStatus returns reason: 'trial_ended' or 'expired'.
 * Redirects users to the website to manage their plan (upgrade or community).
 * Once they have a new license key from the website, they enter it in the extension.
 *
 * The modal is temporarily dismissible (backdrop close). It reappears each session
 * until the user enters a new valid license key (which clears previousUserContext).
 *
 * Complexity Level: 1 (Simple redirect modal)
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
            <h3 class="font-bold text-lg">
              {{
                reason() === 'expired'
                  ? 'Your Subscription Has Expired'
                  : 'Your Pro Trial Has Ended'
              }}
            </h3>
            <p class="text-sm text-base-content/70">
              {{
                reason() === 'expired'
                  ? 'Your Pro subscription has expired'
                  : 'Your ' +
                    trialDurationDays +
                    '-day Pro trial period has concluded'
              }}
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

        <!-- Instructions -->
        <p class="text-sm text-base-content/70 mb-4">
          Visit your account to choose a plan. Once you have your new license
          key, enter it in the extension to continue.
        </p>

        <!-- Actions -->
        <div class="modal-action flex-col sm:flex-row gap-2">
          <button
            class="btn btn-ghost flex-1"
            (click)="dismiss()"
            type="button"
          >
            Maybe Later
          </button>
          <button
            class="btn btn-primary flex-1"
            (click)="goToAccount()"
            type="button"
          >
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Go to Account
          </button>
        </div>
      </div>

      <!-- Backdrop close (temporary dismiss) -->
      <form method="dialog" class="modal-backdrop">
        <button (click)="dismiss()" type="button">close</button>
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
  protected readonly ExternalLinkIcon = ExternalLink;

  protected readonly trialDurationDays = TRIAL_DURATION_DAYS;

  private readonly rpcService = inject(ClaudeRpcService);

  constructor() {
    // Use effect to watch for reason changes (e.g., when license status is fetched async)
    // Effect runs on initial value AND subsequent changes, so no ngOnInit needed
    effect(() => {
      const currentReason = this.reason();
      this.checkAndShowModal(currentReason);
    });
  }

  /**
   * Check if modal should be shown based on reason
   */
  private checkAndShowModal(currentReason: string | undefined): void {
    // Show for both 'trial_ended' and 'expired' reasons
    if (currentReason !== 'trial_ended' && currentReason !== 'expired') {
      this.isOpen.set(false);
      return;
    }

    // Show modal
    this.isOpen.set(true);
  }

  /**
   * Open the account/trial-ended page on the website.
   * User manages their plan there and gets a new license key.
   */
  async goToAccount(): Promise<void> {
    try {
      await this.rpcService.call('command:execute', {
        command: 'ptah.openSignup',
      });
    } catch {
      // Silently fail - browser should still open
    }
    this.isOpen.set(false);
  }

  /**
   * Temporarily dismiss modal for this session.
   * Modal will reappear on next VS Code restart until user enters a new license key.
   */
  dismiss(): void {
    this.isOpen.set(false);
  }
}
