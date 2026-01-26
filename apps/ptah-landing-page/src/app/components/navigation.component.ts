import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  Github,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-angular';
import { AuthService } from '../services/auth.service';

/**
 * NavigationComponent - Fixed navigation bar with branding and CTAs
 *
 * Features:
 * - Fully transparent at top, solid on scroll
 * - Backdrop blur effect
 * - Ptah logo and branding
 * - Navigation links: Pricing, Login/Profile (based on auth state)
 * - GitHub link with icon
 * - VS Code Marketplace CTA button
 * - Auth-aware: Shows Profile when logged in, Login/Sign Up when not
 */
@Component({
  selector: 'ptah-navigation',
  imports: [CommonModule, NgOptimizedImage, RouterLink, LucideAngularModule],
  host: {
    '(window:scroll)': 'onScroll()',
  },
  template: `
    <nav
      class="fixed top-0 left-0 right-0 z-50 h-16 px-4 sm:px-6 lg:px-16 flex items-center justify-between transition-all duration-300"
      [ngClass]="{
        'bg-transparent': !scrolled() && !mobileMenuOpen(),
        'bg-slate-950/90 backdrop-blur-md shadow-lg border-b border-amber-500/10':
          scrolled() || mobileMenuOpen()
      }"
      role="navigation"
      aria-label="Main navigation"
    >
      <!-- Logo and Branding -->
      <a
        routerLink="/"
        class="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
        aria-label="Ptah Extension Home"
        (click)="closeMobileMenu()"
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

      <!-- Mobile Hamburger Button -->
      <button
        type="button"
        class="md:hidden flex items-center justify-center w-11 h-11 rounded-lg text-white/80 hover:text-amber-400 hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
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
        <!-- Pricing Link -->
        <a
          routerLink="/pricing"
          class="text-white/80 hover:text-amber-400 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1"
          aria-label="View pricing plans"
        >
          Pricing
        </a>

        @if (isAuthenticated()) {
        <!-- Profile Link (Authenticated) -->
        <a
          routerLink="/profile"
          class="text-white/80 hover:text-amber-400 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1 flex items-center gap-1.5"
          aria-label="View your profile"
        >
          <lucide-angular [img]="UserIcon" class="w-4 h-4" aria-hidden="true" />
          Profile
        </a>

        <!-- Logout Button (Authenticated) -->
        <button
          type="button"
          class="text-white/60 hover:text-red-400 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1 flex items-center gap-1.5"
          aria-label="Sign out of your account"
          (click)="handleLogout()"
        >
          <lucide-angular
            [img]="LogOutIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Logout
        </button>
        } @else {
        <!-- Login Link (Not Authenticated) -->
        <a
          routerLink="/login"
          class="text-white/80 hover:text-amber-400 transition-colors text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md px-2 py-1"
          aria-label="Sign in to your account"
        >
          Login
        </a>

        <!-- Sign Up CTA (Not Authenticated) -->
        <a
          routerLink="/signup"
          class="text-amber-400/90 hover:text-amber-300 border border-amber-500/30 hover:border-amber-400/50 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          aria-label="Create an account"
        >
          Sign Up
        </a>
        }

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

    <!-- Mobile Menu Overlay -->
    @if (mobileMenuOpen()) {
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm md:hidden"
      aria-hidden="true"
      (click)="closeMobileMenu()"
    ></div>

    <!-- Mobile Menu Panel -->
    <div
      id="mobile-menu"
      class="fixed top-16 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-amber-500/10 md:hidden animate-slide-down"
      role="menu"
      aria-label="Mobile navigation menu"
    >
      <div class="flex flex-col py-4 px-4 space-y-1">
        <!-- Pricing Link -->
        <a
          routerLink="/pricing"
          class="flex items-center px-4 py-3 text-white/80 hover:text-amber-400 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
          role="menuitem"
          (click)="closeMobileMenu()"
        >
          Pricing
        </a>

        @if (isAuthenticated()) {
        <!-- Profile Link (Authenticated) -->
        <a
          routerLink="/profile"
          class="flex items-center gap-2 px-4 py-3 text-white/80 hover:text-amber-400 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
          role="menuitem"
          (click)="closeMobileMenu()"
        >
          <lucide-angular [img]="UserIcon" class="w-5 h-5" aria-hidden="true" />
          Profile
        </a>

        <!-- Logout Button (Authenticated) -->
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
          class="flex items-center px-4 py-3 text-white/80 hover:text-amber-400 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
          role="menuitem"
          (click)="closeMobileMenu()"
        >
          Login
        </a>

        <!-- Sign Up Link (Not Authenticated) -->
        <a
          routerLink="/signup"
          class="flex items-center px-4 py-3 text-amber-400/90 hover:text-amber-300 hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
          role="menuitem"
          (click)="closeMobileMenu()"
        >
          Sign Up
        </a>
        }

        <!-- Divider -->
        <div class="h-px bg-white/10 my-2" aria-hidden="true"></div>

        <!-- GitHub Link -->
        <a
          href="https://github.com/anthropics/claude-code"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-2 px-4 py-3 text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-base font-medium"
          role="menuitem"
          (click)="closeMobileMenu()"
        >
          <lucide-angular
            [img]="GithubIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
          GitHub
        </a>

        <!-- Get Extension CTA -->
        <a
          href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center mt-2 mx-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 px-5 py-3 rounded-lg font-semibold text-base hover:from-amber-400 hover:to-amber-500 transition-all duration-200 shadow-lg shadow-amber-500/20"
          role="menuitem"
          (click)="closeMobileMenu()"
        >
          Get Extension
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
export class NavigationComponent implements OnInit {
  /** Lucide icon references */
  public readonly GithubIcon = Github;
  public readonly UserIcon = User;
  public readonly LogOutIcon = LogOut;
  public readonly MenuIcon = Menu;
  public readonly XIcon = X;

  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

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
   * Signal tracking authentication state
   * - null: Still checking (initial load)
   * - true: User is authenticated
   * - false: User is not authenticated
   */
  public readonly isAuthenticated = signal<boolean | null>(null);

  /**
   * Initialize component - check auth state
   */
  public ngOnInit(): void {
    this.checkAuthState();
  }

  /**
   * Check authentication state from server
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
          // Optionally redirect to home
          window.location.href = '/';
        },
        error: () => {
          // Even on error, clear local state
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
}
