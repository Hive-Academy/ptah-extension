import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import { LucideAngularModule, Zap } from 'lucide-angular';
import { ConsoleGridBackgroundComponent } from '../../../components/console/console-grid-background.component';
import {
  HERO_CARD_ANIMATION,
  SECONDARY_CARD_ANIMATION,
} from '../config/auth-animation.configs';

/**
 * AuthHeroComponent — right-side hero panel for the auth page.
 *
 * Restyled onto the Operator Console system: the Egyptian temple-bg.png image
 * and gold particles are replaced by a coded ConsoleGridBackground + amber
 * glow, and the feature card drops the VS Code-framed "harness" copy for the
 * desktop-first positioning. Two floating cards remain as light motion accents.
 */
@Component({
  selector: 'ptah-auth-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    ViewportAnimationDirective,
    LucideAngularModule,
    ConsoleGridBackgroundComponent,
  ],
  template: `
    <div
      class="hidden lg:block lg:w-1/2 relative overflow-hidden h-100vh bg-ink-950"
    >
      <!-- Coded ambient background -->
      <ptah-console-grid-background [glow]="true" />

      <!-- Left fade into the form column -->
      <div
        class="absolute inset-0 bg-gradient-to-l from-transparent to-ink-950"
        aria-hidden="true"
      ></div>

      <!-- Main Floating Card -->
      <div
        viewportAnimation
        [viewportConfig]="heroCardConfig"
        class="absolute bottom-16 left-8 right-8 bg-ink-900/90 backdrop-blur-xl
               border border-amber-500/20 rounded-2xl p-6 shadow-2xl animate-float"
      >
        <div class="flex items-start gap-4">
          <div
            class="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 animate-glow-pulse"
          >
            <lucide-angular
              [img]="ZapIcon"
              class="w-6 h-6 text-amber-500"
              aria-hidden="true"
            />
          </div>
          <div>
            <h3 class="font-semibold text-white mb-1">
              Your AI Employee on the Desktop
            </h3>
            <p class="text-sm text-ink-400">
              Persistent memory, sub-agent orchestration, and scheduled runs —
              one desktop app, any model.
            </p>
          </div>
        </div>
      </div>

      <!-- Secondary floating element -->
      <div
        viewportAnimation
        [viewportConfig]="secondaryCardConfig"
        class="absolute top-24 right-8 bg-ink-900/80 backdrop-blur-xl
               border border-amber-500/10 rounded-xl px-4 py-3 shadow-xl animate-float-delayed"
      >
        <div class="flex items-center gap-3">
          <div class="flex -space-x-2">
            <div
              class="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-ink-950"
            >
              5K+
            </div>
          </div>
          <span class="text-sm text-ink-400">Active developers</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* Floating animation for cards */
      @keyframes float {
        0%,
        100% {
          transform: translateY(0px);
        }
        50% {
          transform: translateY(-10px);
        }
      }

      .animate-float {
        animation: float 6s ease-in-out infinite;
      }

      .animate-float-delayed {
        animation: float 6s ease-in-out infinite;
        animation-delay: -3s;
      }

      /* Glow pulse for icon */
      @keyframes glow-pulse {
        0%,
        100% {
          box-shadow: 0 0 20px rgba(245, 165, 36, 0.2);
        }
        50% {
          box-shadow: 0 0 30px rgba(245, 165, 36, 0.4);
        }
      }

      .animate-glow-pulse {
        animation: glow-pulse 3s ease-in-out infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .animate-float,
        .animate-float-delayed,
        .animate-glow-pulse {
          animation: none;
        }
      }
    `,
  ],
})
export class AuthHeroComponent {
  /** Lucide icon references */
  public readonly ZapIcon = Zap;

  /** Animation configurations */
  public readonly heroCardConfig = HERO_CARD_ANIMATION;
  public readonly secondaryCardConfig = SECONDARY_CARD_ANIMATION;
}
