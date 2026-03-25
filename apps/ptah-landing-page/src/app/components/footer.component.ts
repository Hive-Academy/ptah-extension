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
            routerLink="/docs"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="View documentation"
          >
            Documentation
          </a>
          <a
            href="https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode"
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
        <div class="flex justify-center gap-4 mb-8">
          <a
            href="#"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="Follow on X"
          >
            <span class="text-xl">X</span>
          </a>
          <a
            href="https://discord.gg/pZcbrqNRzq"
            target="_blank"
            rel="noopener noreferrer"
            class="text-base-content/70 hover:text-secondary transition-colors"
            aria-label="Join Discord server"
          >
            <span class="text-xl">Discord</span>
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
