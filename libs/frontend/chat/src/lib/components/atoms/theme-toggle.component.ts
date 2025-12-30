import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { LucideAngularModule, Sun, Moon } from 'lucide-angular';
import { ThemeService } from '@ptah-extension/core';

/**
 * ThemeToggleComponent - Toggle between light and dark themes
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Single Responsibility, Composition via LucideAngularModule
 *
 * Displays a button with Sun icon (in dark mode) or Moon icon (in light mode)
 * that toggles between the 'anubis' (dark) and 'anubis-light' themes.
 *
 * Accessibility:
 * - Uses semantic <button> element
 * - Dynamic aria-label describes the action (switch to light/dark mode)
 * - Icon changes to indicate current state
 *
 * TASK_2025_100: DaisyUI Theme Consistency & Theme Toggle System
 */
@Component({
  selector: 'ptah-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button
      type="button"
      class="btn btn-ghost btn-xs gap-1"
      (click)="toggle()"
      [attr.aria-label]="
        isDarkMode() ? 'Switch to light mode' : 'Switch to dark mode'
      "
    >
      <lucide-angular
        [img]="isDarkMode() ? SunIcon : MoonIcon"
        class="w-4 h-4"
      />
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  private readonly themeService = inject(ThemeService);

  /**
   * Signal indicating if dark mode is active
   * Bound directly from ThemeService for reactivity
   */
  readonly isDarkMode = this.themeService.isDarkMode;

  /**
   * Sun icon - shown when in dark mode (click to switch to light)
   */
  protected readonly SunIcon = Sun;

  /**
   * Moon icon - shown when in light mode (click to switch to dark)
   */
  protected readonly MoonIcon = Moon;

  /**
   * Toggle between dark and light themes
   * Delegates to ThemeService which handles persistence
   */
  protected toggle(): void {
    this.themeService.toggleTheme();
  }
}
