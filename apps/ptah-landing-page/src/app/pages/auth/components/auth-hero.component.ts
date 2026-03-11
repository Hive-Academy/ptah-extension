import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import { LucideAngularModule, Zap } from 'lucide-angular';
import {
  CARD_ANIMATION,
  HERO_CARD_ANIMATION,
  SECONDARY_CARD_ANIMATION,
} from '../config/auth-animation.configs';

/**
 * AuthHeroComponent - Right side hero section
 *
 * Displays:
 * - Temple background with parallax effect
 * - Gradient overlays
 * - Floating particles animation
 * - Feature card with Claude branding
 * - Active developers counter card
 */
@Component({
  selector: 'ptah-auth-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ViewportAnimationDirective, LucideAngularModule],
  template: `
    <div class="hidden lg:block lg:w-1/2 relative overflow-hidden h-100vh">
      <!-- Temple Background with parallax -->
      <div
        viewportAnimation
        [viewportConfig]="cardAnimationConfig"
        class="absolute inset-0 bg-cover bg-center bg-no-repeat scale-110"
        [style.backgroundImage]="'url(/assets/backgrounds/temple-bg.png)'"
      ></div>

      <!-- Gradient Overlay -->
      <div
        class="absolute inset-0 bg-gradient-to-l from-transparent via-base-100/20 to-base-100"
        aria-hidden="true"
      ></div>

      <!-- Bottom Gradient -->
      <div
        class="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-base-100/80 to-transparent"
        aria-hidden="true"
      ></div>

      <!-- Floating particles -->
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        <div class="particle particle-1"></div>
        <div class="particle particle-2"></div>
        <div class="particle particle-3"></div>
      </div>

      <!-- Main Floating Card -->
      <div
        viewportAnimation
        [viewportConfig]="heroCardConfig"
        class="absolute bottom-16 left-8 right-8 bg-base-200/90 backdrop-blur-xl
               border border-secondary/20 rounded-2xl p-6 shadow-2xl
               animate-float"
      >
        <div class="flex items-start gap-4">
          <div
            class="w-12 h-12 rounded-xl bg-secondary/20 flex items-center justify-center shrink-0
                   animate-glow-pulse"
          >
            <lucide-angular
              [img]="ZapIcon"
              class="w-6 h-6 text-secondary"
              aria-hidden="true"
            />
          </div>
          <div>
            <h3 class="font-semibold text-white mb-1">Powered by Claude</h3>
            <p class="text-sm text-neutral-content/70">
              Experience AI-powered coding assistance with a beautiful visual
              interface designed for VS Code.
            </p>
          </div>
        </div>
      </div>

      <!-- Secondary floating element -->
      <div
        viewportAnimation
        [viewportConfig]="secondaryCardConfig"
        class="absolute top-24 right-8 bg-base-200/80 backdrop-blur-xl
               border border-secondary/10 rounded-xl px-4 py-3 shadow-xl
               animate-float-delayed"
      >
        <div class="flex items-center gap-3">
          <div class="flex -space-x-2">
            <div
              class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-secondary flex items-center justify-center text-xs font-bold text-base-100"
            >
              5K+
            </div>
          </div>
          <span class="text-sm text-neutral-content/70">Active developers</span>
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
          box-shadow: 0 0 20px rgba(212, 175, 55, 0.2);
        }
        50% {
          box-shadow: 0 0 30px rgba(212, 175, 55, 0.4);
        }
      }

      .animate-glow-pulse {
        animation: glow-pulse 3s ease-in-out infinite;
      }

      /* Floating particles */
      @keyframes particle-float {
        0%,
        100% {
          transform: translateY(100vh) rotate(0deg);
          opacity: 0;
        }
        10% {
          opacity: 0.6;
        }
        90% {
          opacity: 0.6;
        }
        100% {
          transform: translateY(-100px) rotate(720deg);
          opacity: 0;
        }
      }

      .particle {
        position: absolute;
        width: 6px;
        height: 6px;
        background: linear-gradient(135deg, #d4af37, #f5d97d);
        border-radius: 50%;
        opacity: 0;
      }

      .particle-1 {
        left: 20%;
        animation: particle-float 15s ease-in-out infinite;
      }

      .particle-2 {
        left: 50%;
        animation: particle-float 18s ease-in-out infinite;
        animation-delay: -5s;
      }

      .particle-3 {
        left: 80%;
        animation: particle-float 12s ease-in-out infinite;
        animation-delay: -10s;
      }
    `,
  ],
})
export class AuthHeroComponent {
  /** Lucide icon references */
  public readonly ZapIcon = Zap;

  /** Animation configurations */
  public readonly cardAnimationConfig = CARD_ANIMATION;
  public readonly heroCardConfig = HERO_CARD_ANIMATION;
  public readonly secondaryCardConfig = SECONDARY_CARD_ANIMATION;
}
