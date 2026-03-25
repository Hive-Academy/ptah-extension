import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * HeroContentOverlayComponent - Hero text content with cinematic scroll animations
 *
 * Animation Strategy:
 * 1. ENTRANCE (viewport): Staggered reveal - badge → headline → subheadline → CTAs → stats
 * 2. EXIT (scroll): Cinematic fade-out + rise as user scrolls down
 *
 * The scroll exit creates a dramatic "leaving the temple" effect
 */
@Component({
  selector: 'ptah-hero-content-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, ScrollAnimationDirective],
  template: `
    <!-- Scroll-linked fade-out container for cinematic exit -->
    <div
      scrollAnimation
      [scrollConfig]="contentScrollExitConfig"
      class="flex flex-col items-center justify-center min-h-screen py-20 px-6 text-center max-w-4xl mx-auto"
    >
      <!-- Badge -->
      <div
        viewportAnimation
        [viewportConfig]="badgeConfig"
        class="inline-flex items-center gap-2 px-4 py-2 mb-10 bg-amber-500/10 border border-amber-500/20 rounded-full"
      >
        <span class="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
        <span class="text-sm font-medium text-amber-300/90 tracking-wide"
          >Provider-Agnostic AI Orchestration</span
        >
      </div>

      <!-- Main Headline: Ptah -->
      <h1
        viewportAnimation
        [viewportConfig]="headlineConfig"
        class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold mb-8 leading-none tracking-tight bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 bg-clip-text text-transparent"
      >
        Ptah
      </h1>

      <!-- Subheadline -->
      <p
        viewportAnimation
        [viewportConfig]="subheadlineConfig"
        class="text-base md:text-lg lg:text-xl text-white/70 mb-12 max-w-2xl leading-relaxed font-light"
      >
        The agentic harness for VS Code that unifies OpenAI, Claude, and GitHub
        Copilot into one seamless orchestration workflow. Intelligent workspace
        analysis, project-adaptive agents, and full provider freedom.
      </p>

      <!-- CTA Buttons -->
      <div
        viewportAnimation
        [viewportConfig]="ctaConfig"
        class="flex flex-col sm:flex-row gap-5 sm:gap-6 mb-12 sm:mb-16 w-full sm:w-auto px-2 sm:px-0"
      >
        <!-- VS Code Extension -->
        <div class="relative">
          <span
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-slate-900 border border-amber-400/50 text-[10px] font-bold text-amber-300 tracking-wide z-20 whitespace-nowrap"
          >
            14 DAYS TRIAL
          </span>
          <a
            href="https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode"
            target="_blank"
            rel="noopener"
            class="cta-glow-button block relative overflow-hidden px-5 sm:px-8 py-3.5 sm:py-4 text-sm sm:text-base font-semibold text-white rounded-xl text-center"
          >
            <span class="relative z-[1]">Install VS Code Extension</span>
          </a>
        </div>

        <!-- Desktop App -->
        <div class="relative">
          <span
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-slate-900 border border-amber-400/50 text-[10px] font-bold text-amber-300 tracking-wide z-20 whitespace-nowrap"
          >
            14 DAYS TRIAL
          </span>
          <a
            href="https://github.com/Hive-Academy/ptah-app/releases/latest"
            target="_blank"
            rel="noopener"
            class="cta-glow-button block relative overflow-hidden px-5 sm:px-8 py-3.5 sm:py-4 text-sm sm:text-base font-semibold text-white rounded-xl text-center"
          >
            <span class="relative z-[1]">Download Desktop App</span>
          </a>
        </div>
      </div>

      <!-- Social Proof Stats -->
      <div
        viewportAnimation
        [viewportConfig]="socialProofConfig"
        class="grid grid-cols-2 gap-x-6 gap-y-4 sm:gap-6 md:flex md:flex-wrap md:justify-center md:gap-10 w-full max-w-sm sm:max-w-none mx-auto"
      >
        @for (stat of stats; track stat.value) {
        <div class="flex items-baseline justify-center gap-1.5 sm:gap-2">
          <span class="text-xl sm:text-2xl font-semibold text-white/90">{{
            stat.value
          }}</span>
          <span class="text-xs sm:text-sm text-white/50">{{ stat.label }}</span>
        </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cta-glow-button {
        background: linear-gradient(
          135deg,
          rgba(212, 175, 55, 0.15) 0%,
          rgba(212, 175, 55, 0.05) 50%,
          rgba(212, 175, 55, 0.15) 100%
        );
        border: 1px solid rgba(212, 175, 55, 0.3);
        box-shadow: 0 0 15px rgba(212, 175, 55, 0.15),
          0 0 30px rgba(212, 175, 55, 0.05),
          inset 0 1px 0 rgba(244, 212, 124, 0.1);
        transition: all 0.3s ease;
      }

      .cta-glow-button:hover {
        transform: translateY(-2px);
        border-color: rgba(212, 175, 55, 0.5);
        box-shadow: 0 0 20px rgba(212, 175, 55, 0.3),
          0 0 50px rgba(212, 175, 55, 0.1),
          inset 0 1px 0 rgba(244, 212, 124, 0.2);
      }

      /* Rotating beam element — sits behind the border */
      .cta-glow-button::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 200%;
        height: 200%;
        background: conic-gradient(
          from 0deg,
          transparent 0%,
          transparent 65%,
          rgba(244, 212, 124, 0.7) 75%,
          rgba(212, 175, 55, 1) 80%,
          rgba(244, 212, 124, 0.7) 85%,
          transparent 95%,
          transparent 100%
        );
        animation: beam-spin 4s linear infinite;
        z-index: 0;
      }

      /* Mask that reveals beam only on the border edge */
      .cta-glow-button::after {
        content: '';
        position: absolute;
        inset: 1px;
        border-radius: 10px;
        background: linear-gradient(
          135deg,
          rgba(15, 23, 42, 0.95) 0%,
          rgba(15, 23, 42, 0.98) 50%,
          rgba(15, 23, 42, 0.95) 100%
        );
        z-index: 0;
      }

      @keyframes beam-spin {
        from {
          transform: translate(-50%, -50%) rotate(0deg);
        }
        to {
          transform: translate(-50%, -50%) rotate(360deg);
        }
      }
    `,
  ],
})
export class HeroContentOverlayComponent {
  public readonly stats = [
    { value: '13', label: 'AI agents' },
    { value: '200+', label: 'LLM models' },
    { value: '14', label: 'MCP tools' },
    { value: '4', label: 'agent runtimes' },
  ];

  /**
   * Cinematic scroll exit - content fades out and rises as user scrolls
   * Creates "ascending from the temple" effect
   */
  public readonly contentScrollExitConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top top',
    end: 'bottom 50%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -120 },
  };

  /**
   * Badge entrance - quick scale in
   */
  public readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    threshold: 0.1,
  };

  /**
   * Headline entrance - dramatic slide up
   */
  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.15,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Subheadline - fade in after headline
   */
  public readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.3,
    threshold: 0.1,
  };

  /**
   * CTAs - slide up together
   */
  public readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.45,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Stats - fade in last
   */
  public readonly socialProofConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.6,
    threshold: 0.1,
  };
}
