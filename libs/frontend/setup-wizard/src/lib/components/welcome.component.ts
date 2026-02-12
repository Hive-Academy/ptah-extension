import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import {
  Bot,
  LucideAngularModule,
  Search,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

/**
 * WelcomeComponent - Setup wizard hero screen with gradient design
 *
 * Purpose:
 * - Welcome users to the setup wizard with a visually engaging hero layout
 * - Highlight key features via a 2x2 card grid
 * - Provide time estimate and clear call-to-action
 * - Start the setup process by transitioning to scan step
 *
 * Features:
 * - Gradient background hero (primary/secondary)
 * - Gradient text title effect
 * - 2x2 responsive feature cards with icons
 * - Enhanced CTA button with hover scale animation
 * - Fade-in entrance animation with prefers-reduced-motion support
 *
 * Usage:
 * ```html
 * <ptah-welcome />
 * ```
 */
@Component({
  selector: 'ptah-welcome',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fadeIn {
        animation: fadeIn 0.6s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-fadeIn {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div class="h-full flex flex-col items-center justify-center px-3 py-4">
      <div class="animate-fadeIn text-center">
        <!-- Title -->
        <h1 class="text-base font-semibold mb-3">
          Let's Personalize Your Ptah Experience
        </h1>

        <p class="text-xs text-base-content/70 mb-2">
          We'll analyze your project structure, detect your tech stack, and
          generate intelligent agents tailored specifically to your codebase.
        </p>
        <p class="text-xs text-base-content/60 mb-4">
          <span class="font-semibold">Estimated time:</span> 2-4 minutes
        </p>

        <!-- Feature Cards Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 text-left">
          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-primary/10 rounded p-1.5">
                <lucide-angular
                  [img]="SearchIcon"
                  class="w-4 h-4 text-primary"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Deep Analysis</h3>
                <p class="text-xs text-base-content/60">
                  4-phase AI-powered codebase scan
                </p>
              </div>
            </div>
          </div>

          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-secondary/10 rounded p-1.5">
                <lucide-angular
                  [img]="BotIcon"
                  class="w-4 h-4 text-secondary"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Smart Agents</h3>
                <p class="text-xs text-base-content/60">
                  13 customized agent templates
                </p>
              </div>
            </div>
          </div>

          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-accent/10 rounded p-1.5">
                <lucide-angular
                  [img]="ZapIcon"
                  class="w-4 h-4 text-accent"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Quick Setup</h3>
                <p class="text-xs text-base-content/60">
                  Ready in under 5 minutes
                </p>
              </div>
            </div>
          </div>

          <div class="border border-base-300 rounded-md bg-base-200/50">
            <div class="p-3 flex flex-row items-center gap-2">
              <div class="bg-success/10 rounded p-1.5">
                <lucide-angular
                  [img]="ShieldIcon"
                  class="w-4 h-4 text-success"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 class="font-medium text-xs">Project-Specific</h3>
                <p class="text-xs text-base-content/60">
                  Rules matched to your tech stack
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- CTA Button -->
        <button
          class="btn btn-primary btn-sm"
          aria-label="Start wizard setup"
          (click)="onStartSetup()"
        >
          <lucide-angular
            [img]="SparklesIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Start Setup
        </button>
      </div>
    </div>
  `,
})
export class WelcomeComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  protected readonly SearchIcon = Search;
  protected readonly BotIcon = Bot;
  protected readonly ZapIcon = Zap;
  protected readonly ShieldIcon = Shield;
  protected readonly SparklesIcon = Sparkles;

  /**
   * Handle "Start Setup" button click.
   * Transitions directly to scan step -- no RPC needed since the wizard webview already exists.
   * The ScanProgressComponent will initiate the actual deep analysis on mount.
   */
  protected onStartSetup(): void {
    this.wizardState.setCurrentStep('scan');
  }
}
