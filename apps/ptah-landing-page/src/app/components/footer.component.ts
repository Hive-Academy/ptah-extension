import { NgOptimizedImage } from '@angular/common';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * FooterComponent - Shared site footer with golden divider
 *
 * Used across all pages (landing, docs, pricing, etc.)
 * Features:
 * - Golden gradient divider line at top
 * - Brand name and tagline
 * - Navigation links (Documentation, Marketplace, Community)
 * - Social links (X, Discord)
 * - Legal links (Privacy, Terms, Refund Policy)
 */
@Component({
  selector: 'ptah-footer',
  imports: [RouterLink, ViewportAnimationDirective, NgOptimizedImage],
  template: `
    <!-- Golden Divider with scaleX animation -->
    <div
      viewportAnimation
      [viewportConfig]="dividerConfig"
      class="overflow-hidden"
    >
      <div
        class="h-[2px] w-full bg-gradient-to-r from-transparent via-secondary to-transparent"
      ></div>
    </div>

    <footer
      viewportAnimation
      [viewportConfig]="footerConfig"
      class="pt-12 pb-8 bg-base-100"
      role="contentinfo"
    >
      <div class="container mx-auto px-4 sm:px-6 text-center">
        <!-- Brand -->
        <div class="mb-8">
          <img
            ngSrc="/assets/icons/ptah-icon.png"
            alt="Ptah Extension Logo"
            width="96"
            height="96"
            class="w-24 h-24 items-center mx-auto mb-4"
          />
          <p class="text-base-content/60">Craftsman of AI Development</p>
          <p class="text-xs text-base-content/40 mt-1">
            Powered by Claude Agent SDK
          </p>
        </div>

        <!-- Navigation Links -->
        <nav
          class="flex flex-wrap justify-center gap-4 sm:gap-6 mb-8"
          aria-label="Footer navigation"
        >
          <a
            href="https://docs.ptah.live"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="View documentation"
          >
            Documentation
          </a>
          <a
            href="https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="Visit VS Code Marketplace"
          >
            Marketplace
          </a>
          <a
            href="https://discord.gg/pZcbrqNRzq"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="Join community"
          >
            Community
          </a>
        </nav>

        <!-- Social Links -->
        <div class="flex justify-center items-center gap-6 mb-8">
          <a
            href="https://discord.gg/pZcbrqNRzq"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="Join Discord server"
          >
            <svg
              class="w-6 h-6"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"
              />
            </svg>
          </a>
          <a
            href="https://github.com/Hive-Academy/ptah-extension"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="View on GitHub"
          >
            <svg
              class="w-6 h-6"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
          </a>
          <a
            href="https://www.reddit.com/r/ptah_coding/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="Join Reddit community"
          >
            <svg
              class="w-6 h-6"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.249-.561 1.249-1.249 0-.688-.562-1.249-1.25-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 0-.463.327.327 0 0 0-.231-.094.33.33 0 0 0-.232.094c-.53.53-1.563.764-2.498.764-.935 0-1.982-.234-2.498-.764a.326.326 0 0 0-.232-.094z"
              />
            </svg>
          </a>
          <a
            href="https://www.linkedin.com/showcase/ptah-coding-orchestra/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="Follow on LinkedIn"
          >
            <svg
              class="w-6 h-6"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
              />
            </svg>
          </a>
        </div>

        <!-- Legal -->
        <div class="text-center text-sm text-base-content/50">
          <p>
            2025 Ptah Extension |
            <a
              routerLink="/privacy"
              class="hover:text-secondary transition-colors"
              >Privacy</a
            >
            |
            <a
              routerLink="/terms-and-conditions"
              class="hover:text-secondary transition-colors"
              >Terms</a
            >
            |
            <a
              routerLink="/refund"
              class="hover:text-secondary transition-colors"
              >Refund Policy</a
            >
          </p>
        </div>
      </div>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent {
  /** Divider animation config - custom scaleX animation */
  public readonly dividerConfig: ViewportAnimationConfig = {
    animation: 'custom',
    duration: 1.2,
    delay: 0.4,
    threshold: 0.2,
    from: { scaleX: 0, transformOrigin: 'center' },
    to: { scaleX: 1 },
  };

  /** Footer animation config - fadeIn */
  public readonly footerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.5,
    threshold: 0.1,
  };
}
