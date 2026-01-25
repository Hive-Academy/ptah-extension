import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Github } from 'lucide-angular';

/**
 * NavigationComponent - Fixed navigation bar with branding and CTAs
 *
 * Features:
 * - Fully transparent at top, solid on scroll
 * - Backdrop blur effect
 * - Ptah logo and branding
 * - Navigation links: Pricing, Login
 * - GitHub link with icon
 * - VS Code Marketplace CTA button
 */
@Component({
  selector: 'ptah-navigation',
  imports: [CommonModule, NgOptimizedImage, RouterLink, LucideAngularModule],
  host: {
    '(window:scroll)': 'onScroll()',
  },
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
        routerLink="/"
        class="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
        aria-label="Ptah Extension Home"
      >
        <img
          ngSrc="/assets/icons/ptah-icon.png"
          alt="Ptah Extension Logo"
          width="32"
          height="32"
          class="w-8 h-8"
        />
        <span class="font-bold text-xl text-amber-400">Ptah</span>
      </a>

      <!-- Navigation Links + CTAs -->
      <div class="flex items-center gap-6">
        <!-- Pricing Link -->
        <a
          routerLink="/pricing"
          class="text-white/80 hover:text-amber-400 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1"
          aria-label="View pricing plans"
        >
          Pricing
        </a>

        <!-- Login Link -->
        <a
          routerLink="/login"
          class="text-white/80 hover:text-amber-400 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1"
          aria-label="Sign in to your account"
        >
          Login
        </a>

        <!-- Sign Up CTA -->
        <a
          routerLink="/signup"
          class="text-amber-400/90 hover:text-amber-300 border border-amber-500/30 hover:border-amber-400/50 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          aria-label="Create an account"
        >
          Sign Up
        </a>

        <!-- Divider -->
        <div class="h-6 w-px bg-white/10" aria-hidden="true"></div>

        <!-- GitHub Link -->
        <a
          href="https://github.com/anthropics/claude-code"
          target="_blank"
          rel="noopener noreferrer"
          class="text-white/70 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md p-1"
          aria-label="View on GitHub"
        >
          <lucide-angular
            [img]="GithubIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
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
  /** Lucide icon reference */
  readonly GithubIcon = Github;

  /**
   * Signal tracking scroll position
   * - false: User at top (fully transparent)
   * - true: User scrolled (solid background + shadow)
   */
  public readonly scrolled = signal(false);

  /**
   * Handler for window scroll events
   */
  public onScroll(): void {
    const scrollPosition = window.scrollY;
    this.scrolled.set(scrollPosition > 50);
  }
}
