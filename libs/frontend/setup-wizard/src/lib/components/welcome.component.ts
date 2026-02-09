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
    <div
      class="hero min-h-screen bg-gradient-to-br from-primary/10 via-base-200 to-secondary/10"
    >
      <div class="hero-content text-center">
        <div class="max-w-2xl animate-fadeIn">
          <!-- Gradient Title -->
          <h1
            class="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"
          >
            Let's Personalize Your Ptah Experience
          </h1>

          <p class="text-lg text-base-content/80 mb-4">
            We'll analyze your project structure, detect your tech stack, and
            generate intelligent agents tailored specifically to your codebase.
          </p>
          <p class="text-base text-base-content/60 mb-8">
            <span class="font-semibold">Estimated time:</span> 2-4 minutes
          </p>

          <!-- Feature Cards Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 text-left">
            <div
              class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300"
            >
              <div class="card-body p-4 flex-row items-center gap-3">
                <div class="bg-primary/10 rounded-lg p-2">
                  <lucide-angular
                    [img]="SearchIcon"
                    class="w-5 h-5 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <h3 class="font-semibold text-sm">Deep Analysis</h3>
                  <p class="text-xs text-base-content/60">
                    4-phase AI-powered codebase scan
                  </p>
                </div>
              </div>
            </div>

            <div
              class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300"
            >
              <div class="card-body p-4 flex-row items-center gap-3">
                <div class="bg-secondary/10 rounded-lg p-2">
                  <lucide-angular
                    [img]="BotIcon"
                    class="w-5 h-5 text-secondary"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <h3 class="font-semibold text-sm">Smart Agents</h3>
                  <p class="text-xs text-base-content/60">
                    13 customized agent templates
                  </p>
                </div>
              </div>
            </div>

            <div
              class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300"
            >
              <div class="card-body p-4 flex-row items-center gap-3">
                <div class="bg-accent/10 rounded-lg p-2">
                  <lucide-angular
                    [img]="ZapIcon"
                    class="w-5 h-5 text-accent"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <h3 class="font-semibold text-sm">Quick Setup</h3>
                  <p class="text-xs text-base-content/60">
                    Ready in under 5 minutes
                  </p>
                </div>
              </div>
            </div>

            <div
              class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow duration-300"
            >
              <div class="card-body p-4 flex-row items-center gap-3">
                <div class="bg-success/10 rounded-lg p-2">
                  <lucide-angular
                    [img]="ShieldIcon"
                    class="w-5 h-5 text-success"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <h3 class="font-semibold text-sm">Project-Specific</h3>
                  <p class="text-xs text-base-content/60">
                    Rules matched to your tech stack
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- CTA Button -->
          <button
            class="btn btn-primary btn-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
            aria-label="Start wizard setup"
            (click)="onStartSetup()"
          >
            <lucide-angular
              [img]="SparklesIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Start Setup
          </button>
        </div>
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
