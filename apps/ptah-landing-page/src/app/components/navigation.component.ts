import {
  Component,
  ChangeDetectionStrategy,
  signal,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * NavigationComponent - Fixed navigation bar with branding and CTAs
 *
 * Features:
 * - Fully transparent at top, solid on scroll
 * - Backdrop blur effect
 * - Ptah logo and branding
 * - GitHub link with icon
 * - VS Code Marketplace CTA button
 */
@Component({
  selector: 'ptah-navigation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <nav
      class="fixed top-0 left-0 right-0 z-50 h-16 px-6 lg:px-16 flex items-center justify-between transition-all duration-300"
      [ngClass]="{
        'bg-transparent': !scrolled(),
        'bg-slate-950/90 backdrop-blur-md shadow-lg border-b border-amber-500/10':
          scrolled()
      }"
      role="navigation"
      aria-label="Main navigation"
    >
      <!-- Logo and Branding -->
      <a
        href="#"
        class="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
        aria-label="Ptah Extension Home"
      >
        <img
          src="/assets/icons/ptah-icon.png"
          alt="Ptah Extension Logo"
          class="w-8 h-8"
        />
        <span class="font-bold text-xl text-amber-400">Ptah</span>
      </a>

      <!-- CTAs -->
      <div class="flex items-center gap-4">
        <!-- GitHub Link -->
        <a
          href="https://github.com/anthropics/claude-code"
          target="_blank"
          rel="noopener noreferrer"
          class="text-white/70 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md p-1"
          aria-label="View on GitHub"
        >
          <svg
            class="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clip-rule="evenodd"
            />
          </svg>
        </a>

        <!-- Marketplace CTA -->
        <a
          href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
          target="_blank"
          rel="noopener noreferrer"
          class="bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 px-5 py-2 rounded-lg font-semibold text-sm hover:from-amber-400 hover:to-amber-500 hover:scale-105 transition-all duration-200 shadow-lg shadow-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          aria-label="Install from VS Code Marketplace"
        >
          Get Extension
        </a>
      </div>
    </nav>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationComponent {
  /**
   * Signal tracking scroll position
   * - false: User at top (fully transparent)
   * - true: User scrolled (solid background + shadow)
   */
  readonly scrolled = signal(false);

  /**
   * HostListener for window scroll events
   */
  @HostListener('window:scroll')
  onScroll(): void {
    const scrollPosition = window.scrollY;
    this.scrolled.set(scrollPosition > 50);
  }
}
