import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  DestroyRef,
  afterNextRender,
  computed,
  ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import {
  LucideAngularModule,
  User,
  Users,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Download,
  MessagesSquare,
} from 'lucide-angular';
import { AuthService } from '@ptah-web/core';
import { SubscriptionStateService } from '@ptah-web/core';

/**
 * NavigationComponent - Fixed navigation bar with branding and CTAs
 *
 * Declutter & consolidate redesign (TASK_2026_168):
 * - Top row consolidated to: Product ▾ (Features, Builders), Pricing, Docs,
 *   Community ▾ (Community — authenticated only, Discord, GitHub, Reddit, LinkedIn),
 *   Download Ptah CTA, and — authenticated only — a User ▾ avatar menu
 *   (Members, Profile, divider, Logout). Unauthenticated keeps Login + Sign Up
 *   inline before the CTA.
 * - Three disclosure menus are driven by a single tri-state `openMenu` signal
 *   guaranteeing mutual exclusion. Escape closes the open menu (and returns
 *   focus to its trigger); outside-click closes it (host listeners).
 * - Fully transparent at top, solid on scroll; backdrop blur; auth-aware.
 */
@Component({
  selector: 'ptah-navigation',
  imports: [
    CommonModule,
    NgOptimizedImage,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
  ],
  host: {
    '(window:scroll)': 'onScroll()',
    '(document:keydown.escape)': 'closeMenuAndRefocus()',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <nav
      class="fixed top-0 left-0 right-0 z-50 h-16 px-4 sm:px-6 lg:px-16 flex items-center justify-between transition-all duration-300"
      [ngClass]="{
        'bg-transparent': !scrolled() && !mobileMenuOpen(),
        'bg-ink-900/90 backdrop-blur-md shadow-lg border-b border-ink-700':
          scrolled() || mobileMenuOpen(),
      }"
      role="navigation"
      aria-label="Main navigation"
    >
      <!-- Logo and Branding -->
      <a
        routerLink="/"
        class="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
        aria-label="Ptah home"
        (click)="closeMobileMenu()"
      >
        <img
          ngSrc="/assets/icons/ptah-icon.png"
          alt="Ptah logo"
          width="96"
          height="96"
          class="w-11 h-11"
        />
      </a>

      <!-- Mobile Hamburger Button -->
      <button
        type="button"
        class="md:hidden flex items-center justify-center w-11 h-11 rounded-lg text-white/80 hover:text-amber-500 hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
        [attr.aria-expanded]="mobileMenuOpen()"
        aria-controls="mobile-menu"
        aria-label="Toggle navigation menu"
        (click)="toggleMobileMenu()"
      >
        @if (mobileMenuOpen()) {
          <lucide-angular [img]="XIcon" class="w-6 h-6" aria-hidden="true" />
        } @else {
          <lucide-angular [img]="MenuIcon" class="w-6 h-6" aria-hidden="true" />
        }
      </button>

      <!-- Desktop Navigation Links + CTAs -->
      <div class="hidden md:flex items-center gap-6">
        <!-- Product Disclosure Menu (Features, Builders) -->
        <div class="relative">
          <button
            type="button"
            id="product-menu-trigger"
            class="flex items-center gap-1 text-sm font-medium transition-colors rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            [ngClass]="
              openMenu() === 'product'
                ? 'text-amber-500'
                : 'text-white/80 hover:text-amber-500'
            "
            aria-haspopup="menu"
            [attr.aria-expanded]="openMenu() === 'product'"
            aria-controls="product-menu"
            (click)="toggleMenu('product')"
          >
            Product
            <lucide-angular
              [img]="ChevronDownIcon"
              class="w-4 h-4 transition-transform duration-200"
              [class.rotate-180]="openMenu() === 'product'"
              aria-hidden="true"
            />
          </button>

          @if (openMenu() === 'product') {
            <div
              id="product-menu"
              class="absolute left-0 top-full mt-2 w-40 rounded-lg border border-amber-500/10 bg-slate-950/95 backdrop-blur-md shadow-lg py-1.5 z-50"
              role="menu"
              aria-labelledby="product-menu-trigger"
            >
              <a
                routerLink="/"
                fragment="features"
                class="flex items-center px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                role="menuitem"
                (click)="closeMenu()"
              >
                Features
              </a>
              <a
                routerLink="/"
                fragment="builders"
                class="flex items-center px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                role="menuitem"
                (click)="closeMenu()"
              >
                Builders
              </a>
            </div>
          }
        </div>

        <!-- Pricing Link -->
        <a
          routerLink="/pricing"
          routerLinkActive="text-amber-500"
          [routerLinkActiveOptions]="{ exact: true }"
          class="text-white/80 hover:text-amber-500 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1"
          aria-label="View pricing plans"
        >
          Pricing
        </a>

        <!-- Docs Link -->
        <a
          href="https://docs.ptah.live"
          target="_blank"
          rel="noopener noreferrer"
          class="text-white/80 hover:text-amber-500 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1"
          aria-label="View documentation"
        >
          Docs
        </a>

        <!-- Community Disclosure Menu (Community, Discord, GitHub, Reddit, LinkedIn) -->
        <div class="relative">
          <button
            type="button"
            id="community-menu-trigger"
            class="flex items-center gap-1 text-sm font-medium transition-colors rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            [ngClass]="
              openMenu() === 'community'
                ? 'text-amber-500'
                : 'text-white/80 hover:text-amber-500'
            "
            aria-haspopup="menu"
            [attr.aria-expanded]="openMenu() === 'community'"
            aria-controls="community-menu"
            (click)="toggleMenu('community')"
          >
            Community
            <lucide-angular
              [img]="ChevronDownIcon"
              class="w-4 h-4 transition-transform duration-200"
              [class.rotate-180]="openMenu() === 'community'"
              aria-hidden="true"
            />
          </button>

          @if (openMenu() === 'community') {
            <div
              id="community-menu"
              class="absolute right-0 top-full mt-2 w-48 rounded-lg border border-amber-500/10 bg-slate-950/95 backdrop-blur-md shadow-lg py-1.5 z-50"
              role="menu"
              aria-labelledby="community-menu-trigger"
            >
              <!-- Community (in-product, authenticated only) -->
              @if (isAuthenticated()) {
                <a
                  [routerLink]="COMMUNITY_ROUTE"
                  class="flex items-center gap-2.5 px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                  role="menuitem"
                  (click)="closeMenu()"
                >
                  <lucide-angular
                    [img]="MessagesSquareIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                  Community
                </a>
              }

              <!-- Discord Link -->
              <a
                href="https://discord.gg/pZcbrqNRzq"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2.5 px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                role="menuitem"
                (click)="closeMenu()"
              >
                <svg
                  class="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"
                  />
                </svg>
                Discord
              </a>

              <!-- GitHub Link -->
              <a
                href="https://github.com/Hive-Academy/ptah-extension"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2.5 px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                role="menuitem"
                (click)="closeMenu()"
              >
                <svg
                  class="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                  />
                </svg>
                GitHub
              </a>

              <!-- Reddit Link -->
              <a
                href="https://www.reddit.com/r/ptah_coding/"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2.5 px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                role="menuitem"
                (click)="closeMenu()"
              >
                <svg
                  class="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.249-.561 1.249-1.249 0-.688-.562-1.249-1.25-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 0-.463.327.327 0 0 0-.231-.094.33.33 0 0 0-.232.094c-.53.53-1.563.764-2.498.764-.935 0-1.982-.234-2.498-.764a.326.326 0 0 0-.232-.094z"
                  />
                </svg>
                Reddit
              </a>

              <!-- LinkedIn Link -->
              <a
                href="https://www.linkedin.com/showcase/ptah-coding-orchestra/"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2.5 px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                role="menuitem"
                (click)="closeMenu()"
              >
                <svg
                  class="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
                  />
                </svg>
                LinkedIn
              </a>
            </div>
          }
        </div>

        @if (!isAuthenticated()) {
          <!-- Login Link (Not Authenticated) -->
          <a
            routerLink="/login"
            class="text-white/80 hover:text-amber-500 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1"
            aria-label="Sign in to your account"
          >
            Login
          </a>

          <!-- Sign Up CTA (Not Authenticated) -->
          <a
            routerLink="/signup"
            class="text-amber-500 hover:text-amber-400 border border-ink-600 hover:border-amber-500/40 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            aria-label="Create an account"
          >
            Sign Up
          </a>
        }

        <!-- Primary Download CTA (always visible) -->
        <a
          routerLink="/download"
          routerLinkActive="bg-amber-400"
          class="inline-flex items-center justify-center gap-2 bg-amber-500 text-ink-950 px-5 py-2 rounded-lg font-semibold text-sm transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          aria-label="Download the Ptah desktop app"
        >
          <lucide-angular
            [img]="DownloadIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Download Ptah
        </a>

        @if (isAuthenticated()) {
          <!-- User Disclosure Menu (Members, Profile, divider, Logout) -->
          <div class="relative">
            <button
              type="button"
              id="user-menu-trigger"
              class="flex items-center gap-1 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
              aria-haspopup="menu"
              [attr.aria-expanded]="openMenu() === 'user'"
              aria-controls="user-menu"
              aria-label="Account menu"
              (click)="toggleMenu('user')"
            >
              <!--
                Avatar = Option A (recommended for this pass): generic circular
                badge with the User lucide icon, zero new HTTP calls / signals.
                Option B (future upgrade): derive email-initials from
                authService.getCurrentUser() and render them as text instead of
                the icon — flagged as a follow-up, out of scope for declutter.
              -->
              <span
                class="w-9 h-9 rounded-full bg-ink-800 border border-white/10 text-white/80 hover:border-amber-500/40 hover:text-amber-500 transition-colors flex items-center justify-center"
                [ngClass]="{
                  'ring-2 ring-amber-400': accountSectionActive(),
                  'ring-1 ring-amber-500/30':
                    openMenu() === 'user' && !accountSectionActive(),
                }"
              >
                <lucide-angular
                  [img]="UserIcon"
                  class="w-5 h-5"
                  aria-hidden="true"
                />
              </span>
              <lucide-angular
                [img]="ChevronDownIcon"
                class="w-4 h-4 text-white/80 transition-transform duration-200"
                [class.rotate-180]="openMenu() === 'user'"
                aria-hidden="true"
              />
            </button>

            @if (openMenu() === 'user') {
              <div
                id="user-menu"
                class="absolute right-0 top-full mt-2 w-48 rounded-lg border border-amber-500/10 bg-slate-950/95 backdrop-blur-md shadow-lg py-1.5 z-50"
                role="menu"
                aria-labelledby="user-menu-trigger"
              >
                <!-- Members Link -->
                <a
                  routerLink="/members"
                  class="flex items-center gap-2.5 px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                  role="menuitem"
                  (click)="closeMenu()"
                >
                  <lucide-angular
                    [img]="UsersIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                  Members
                </a>

                <!-- Profile Link -->
                <a
                  routerLink="/profile"
                  class="flex items-center gap-2.5 px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                  role="menuitem"
                  (click)="closeMenu()"
                >
                  <lucide-angular
                    [img]="UserIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                  Profile
                </a>

                <!-- Divider -->
                <div class="h-px bg-white/10 my-1" aria-hidden="true"></div>

                <!-- Logout Button -->
                <button
                  type="button"
                  class="flex items-center gap-2.5 px-4 py-2 w-full text-left text-white/70 hover:text-red-400 hover:bg-white/5 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                  role="menuitem"
                  (click)="handleLogout(); closeMenu()"
                >
                  <lucide-angular
                    [img]="LogOutIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                  Logout
                </button>
              </div>
            }
          </div>
        }
      </div>
    </nav>

    <!-- Mobile Menu Overlay -->
    @if (mobileMenuOpen()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-40 bg-ink-950/80 backdrop-blur-sm md:hidden"
        aria-hidden="true"
        (click)="closeMobileMenu()"
      ></div>

      <!-- Mobile Menu Panel -->
      <div
        id="mobile-menu"
        class="fixed top-16 left-0 right-0 z-50 bg-ink-900/95 backdrop-blur-md border-b border-ink-700 md:hidden animate-slide-down"
        role="menu"
        aria-label="Mobile navigation menu"
      >
        <div class="flex flex-col py-4 px-4 space-y-1">
          <!-- Primary nav (ungrouped) -->
          <!-- Features Anchor -->
          <a
            routerLink="/"
            fragment="features"
            class="flex items-center px-4 py-3 text-white/80 hover:text-amber-500 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            Features
          </a>

          <!-- Builders Anchor -->
          <a
            routerLink="/"
            fragment="builders"
            class="flex items-center px-4 py-3 text-white/80 hover:text-amber-500 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            Builders
          </a>

          <!-- Pricing Link -->
          <a
            routerLink="/pricing"
            class="flex items-center px-4 py-3 text-white/80 hover:text-amber-500 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            Pricing
          </a>

          <!-- Docs Link -->
          <a
            href="https://docs.ptah.live"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center px-4 py-3 text-white/80 hover:text-amber-500 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            Docs
          </a>

          <!-- Divider -->
          <div class="h-px bg-white/10 my-2" aria-hidden="true"></div>

          @if (isAuthenticated()) {
            <!-- ACCOUNT section -->
            <div
              class="px-4 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-white/40"
            >
              Account
            </div>

            <!-- Members Link -->
            <a
              routerLink="/members"
              class="flex items-center gap-2 px-4 py-3 text-white/80 hover:text-amber-500 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
              role="menuitem"
              (click)="closeMobileMenu()"
            >
              <lucide-angular
                [img]="UsersIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
              Members
            </a>

            <!-- Profile Link -->
            <a
              routerLink="/profile"
              class="flex items-center gap-2 px-4 py-3 text-white/80 hover:text-amber-500 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
              role="menuitem"
              (click)="closeMobileMenu()"
            >
              <lucide-angular
                [img]="UserIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
              Profile
            </a>

            <!-- Logout Button -->
            <button
              type="button"
              class="flex items-center gap-2 px-4 py-3 text-white/60 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors text-base font-medium w-full text-left"
              role="menuitem"
              (click)="handleLogout(); closeMobileMenu()"
            >
              <lucide-angular
                [img]="LogOutIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
              Logout
            </button>
          } @else {
            <!-- Login Link (Not Authenticated) -->
            <a
              routerLink="/login"
              class="flex items-center px-4 py-3 text-white/80 hover:text-amber-500 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
              role="menuitem"
              (click)="closeMobileMenu()"
            >
              Login
            </a>

            <!-- Sign Up Link (Not Authenticated) -->
            <a
              routerLink="/signup"
              class="flex items-center px-4 py-3 text-amber-500 hover:text-amber-400 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
              role="menuitem"
              (click)="closeMobileMenu()"
            >
              Sign Up
            </a>
          }

          <!-- Divider -->
          <div class="h-px bg-white/10 my-2" aria-hidden="true"></div>

          <!-- COMMUNITY section -->
          <div
            class="px-4 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-white/40"
          >
            Community
          </div>

          <!-- Community Link (Authenticated, in-product) -->
          @if (isAuthenticated()) {
            <a
              [routerLink]="COMMUNITY_ROUTE"
              class="flex items-center gap-2 px-4 py-3 text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
              role="menuitem"
              (click)="closeMobileMenu()"
            >
              <lucide-angular
                [img]="MessagesSquareIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
              Community
            </a>
          }

          <!-- Discord Link -->
          <a
            href="https://discord.gg/pZcbrqNRzq"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 px-4 py-3 text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            <svg
              class="w-5 h-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"
              />
            </svg>
            Discord
          </a>

          <!-- GitHub Link -->
          <a
            href="https://github.com/Hive-Academy/ptah-extension"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 px-4 py-3 text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            <svg
              class="w-5 h-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
            GitHub
          </a>

          <!-- Reddit Link -->
          <a
            href="https://www.reddit.com/r/ptah_coding/"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 px-4 py-3 text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            <svg
              class="w-5 h-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.249-.561 1.249-1.249 0-.688-.562-1.249-1.25-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 0-.463.327.327 0 0 0-.231-.094.33.33 0 0 0-.232.094c-.53.53-1.563.764-2.498.764-.935 0-1.982-.234-2.498-.764a.326.326 0 0 0-.232-.094z"
              />
            </svg>
            Reddit
          </a>

          <!-- LinkedIn Link -->
          <a
            href="https://www.linkedin.com/showcase/ptah-coding-orchestra/"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 px-4 py-3 text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            <svg
              class="w-5 h-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
              />
            </svg>
            LinkedIn
          </a>

          <!-- Divider -->
          <div class="h-px bg-white/10 my-2" aria-hidden="true"></div>

          <!-- Primary Download CTA -->
          <a
            routerLink="/download"
            class="flex items-center justify-center gap-2 mt-2 mx-2 bg-amber-500 text-ink-950 px-5 py-3 rounded-lg font-semibold text-base hover:bg-amber-400 transition-all duration-200 shadow-lg shadow-amber-500/20"
            role="menuitem"
            (click)="closeMobileMenu()"
          >
            <lucide-angular
              [img]="DownloadIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Download Ptah
          </a>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      @keyframes slide-down {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-slide-down {
        animation: slide-down 0.2s ease-out;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationComponent {
  /** Lucide icon references */
  public readonly UserIcon = User;
  public readonly UsersIcon = Users;
  public readonly LogOutIcon = LogOut;
  public readonly MenuIcon = Menu;
  public readonly XIcon = X;
  public readonly ChevronDownIcon = ChevronDown;
  public readonly DownloadIcon = Download;
  public readonly MessagesSquareIcon = MessagesSquare;

  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly subscriptionState = inject(SubscriptionStateService);
  private readonly router = inject(Router);
  private readonly elementRef = inject(ElementRef);

  /**
   * In-product community route (MG-2.7).
   *
   * This used to be a one-click SSO deep-link into an external forum, computed
   * from a `communityUrl` the server echoed on `/licenses/me`. TASK_2026_177
   * removed the forum, the env var behind it and that response field, so the
   * link is now a plain internal route and needs no server input at all.
   *
   * Still shown to AUTHENTICATED visitors only, and the guard is unchanged in
   * spirit: `/members` is protected by `MemberGuard`, so an authenticated
   * non-member who follows this lands on `/pricing` rather than an error. It is
   * a `routerLink`, not an `href` with `target="_blank"` — the destination is
   * this same app now, so a new tab would be wrong.
   */
  public readonly COMMUNITY_ROUTE = '/members/community';

  /**
   * Signal tracking scroll position
   * - false: User at top (fully transparent)
   * - true: User scrolled (solid background + shadow)
   */
  public readonly scrolled = signal(false);

  /**
   * Signal tracking mobile menu open state
   * - false: Menu closed (hamburger icon shown)
   * - true: Menu open (X icon shown, overlay visible)
   */
  public readonly mobileMenuOpen = signal(false);

  /**
   * Single tri-state signal driving all three desktop disclosure menus
   * (Product / Community / User). Only one may be open at a time — mutual
   * exclusion is guaranteed for free by a single source of truth.
   */
  public readonly openMenu = signal<'product' | 'community' | 'user' | null>(
    null,
  );

  /**
   * Signal tracking authentication state
   * - null: Still checking (initial load)
   * - true: User is authenticated
   * - false: User is not authenticated
   */
  public readonly isAuthenticated = signal<boolean | null>(null);

  /**
   * True when the current route is inside an account-scoped section
   * (`/profile` or `/members`) — rings the avatar trigger to signal
   * "you are here" for the User menu.
   */
  public readonly accountSectionActive = computed<boolean>(() => {
    const url = this.router.url;
    return url.startsWith('/profile') || url.startsWith('/members');
  });

  constructor() {
    afterNextRender(() => {
      this.checkAuthState();
      this.subscriptionState
        .fetchSubscriptionState()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe();
    });
  }

  /**
   * Check authentication state from server
   *
   * Uses verifyAuthentication() instead of isAuthenticated() to always
   * make an API call. This ensures that after OAuth/magic-link redirects,
   * the HTTP-only cookie is properly validated and the localStorage hint
   * is set for future calls.
   */
  private checkAuthState(): void {
    this.authService
      .isAuthenticated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (isAuth) => this.isAuthenticated.set(isAuth),
        error: () => this.isAuthenticated.set(false),
      });
  }

  /**
   * Handle logout action
   */
  public handleLogout(): void {
    this.authService
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isAuthenticated.set(false);
          window.location.href = '/';
        },
        error: () => {
          this.isAuthenticated.set(false);
        },
      });
  }

  /**
   * Handler for window scroll events
   */
  public onScroll(): void {
    const scrollPosition = window.scrollY;
    this.scrolled.set(scrollPosition > 50);
  }

  /**
   * Toggle mobile menu open/closed state
   */
  public toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  /**
   * Close mobile menu (used by links and backdrop click)
   */
  public closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  /**
   * Toggle a desktop disclosure menu. Opening a menu implicitly closes any
   * other open menu (mutual exclusion via the single tri-state signal).
   */
  public toggleMenu(menu: 'product' | 'community' | 'user'): void {
    this.openMenu.update((current) => (current === menu ? null : menu));
  }

  /**
   * Close whichever desktop disclosure menu is open. Used by menu-item clicks:
   * activating an item either navigates (focus moves to the new content) or
   * opens an external tab, so we deliberately do NOT force focus back onto the
   * trigger here — that would snap a keyboard user away from the destination.
   * The Escape path uses `closeMenuAndRefocus()` instead.
   */
  public closeMenu(): void {
    this.openMenu.set(null);
  }

  /**
   * Close the open desktop disclosure menu AND return keyboard focus to its
   * trigger button. Bound to the `document:keydown.escape` host listener — the
   * standard menu-button pattern where Escape returns focus to the trigger.
   */
  public closeMenuAndRefocus(): void {
    const menu = this.openMenu();
    if (menu === null) {
      return;
    }
    this.openMenu.set(null);
    const trigger = this.elementRef.nativeElement.querySelector(
      `#${menu}-menu-trigger`,
    ) as HTMLElement | null;
    trigger?.focus();
  }

  /**
   * Close any open desktop disclosure menu when the user clicks outside the
   * navigation. Because `:host { display: contents }` keeps the host element a
   * real DOM node wrapping both the nav bar and the mobile overlay, a
   * `.contains()` check treats clicks anywhere inside the nav as "inside" —
   * only clicks elsewhere on the page close the menu.
   */
  public onDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.openMenu.set(null);
    }
  }
}
