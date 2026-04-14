import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { LucideAngularModule, Palette, Check } from 'lucide-angular';
import {
  ThemeService,
  type ThemeName,
  type ThemeInfo,
  DAISYUI_THEMES,
} from '@ptah-extension/core';

/**
 * ThemeToggleComponent - DaisyUI theme picker dropdown
 *
 * Displays a dropdown with all available DaisyUI themes.
 * Each theme shows 4 color preview dots (primary, secondary, accent, neutral)
 * and a checkmark for the currently active theme.
 *
 * Replaces the previous simple dark/light toggle to support all 34 themes.
 */
@Component({
  selector: 'ptah-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="dropdown dropdown-end">
      <div
        tabindex="0"
        role="button"
        class="btn btn-ghost btn-xs gap-1"
        aria-label="Change theme"
      >
        <lucide-angular [img]="PaletteIcon" class="w-4 h-4" />
        <span class="icon-btn-label text-xs">Theme</span>
      </div>
      <ul
        tabindex="0"
        class="dropdown-content z-[1] menu p-2 shadow-lg bg-base-200 rounded-box w-56 max-h-96 overflow-y-auto flex-nowrap"
      >
        <li class="menu-title text-xs opacity-60">Theme</li>
        @for (theme of themes; track theme.name) {
          <li>
            <button
              class="flex items-center gap-2 px-2 py-1.5"
              [class.active]="currentTheme() === theme.name"
              [attr.data-theme]="theme.name"
              (click)="selectTheme(theme.name)"
            >
              <!-- Color preview dots -->
              <div class="flex gap-0.5">
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  [style.background-color]="'oklch(var(--p))'"
                ></span>
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  [style.background-color]="'oklch(var(--s))'"
                ></span>
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  [style.background-color]="'oklch(var(--a))'"
                ></span>
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  [style.background-color]="'oklch(var(--n))'"
                ></span>
              </div>
              <!-- Theme name -->
              <span class="flex-1 text-sm">{{ theme.label }}</span>
              <!-- Active checkmark -->
              @if (currentTheme() === theme.name) {
                <lucide-angular [img]="CheckIcon" class="w-4 h-4 shrink-0" />
              }
            </button>
          </li>
        }
      </ul>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  private readonly themeService = inject(ThemeService);

  readonly currentTheme = this.themeService.currentTheme;
  readonly themes: readonly ThemeInfo[] = DAISYUI_THEMES;

  protected readonly PaletteIcon = Palette;
  protected readonly CheckIcon = Check;

  protected selectTheme(theme: ThemeName): void {
    this.themeService.setTheme(theme);
  }
}
