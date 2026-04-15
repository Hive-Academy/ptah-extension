import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { LucideAngularModule, Palette, Check } from 'lucide-angular';
import {
  ThemeService,
  type ThemeName,
  type ThemeInfo,
  DAISYUI_THEMES,
} from '@ptah-extension/core';

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
      <div
        tabindex="0"
        class="dropdown-content z-[1] p-2 shadow-lg bg-base-200 rounded-box w-64 max-h-[28rem] overflow-y-auto"
      >
        <!-- Dark Themes -->
        <div
          class="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-50"
        >
          Dark
        </div>
        <div class="grid grid-cols-1 gap-0.5 mb-2">
          @for (theme of darkThemes; track theme.name) {
            <button
              class="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors hover:bg-base-300"
              [class.bg-base-300]="currentTheme() === theme.name"
              [attr.data-theme]="theme.name"
              (click)="selectTheme(theme.name)"
            >
              <div class="flex gap-1 shrink-0">
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--p))'"
                ></span>
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--s))'"
                ></span>
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--a))'"
                ></span>
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--n))'"
                ></span>
              </div>
              <span class="flex-1 text-left truncate">{{ theme.label }}</span>
              @if (currentTheme() === theme.name) {
                <lucide-angular
                  [img]="CheckIcon"
                  class="w-3.5 h-3.5 shrink-0 opacity-70"
                />
              }
            </button>
          }
        </div>

        <!-- Light Themes -->
        <div
          class="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-50"
        >
          Light
        </div>
        <div class="grid grid-cols-1 gap-0.5">
          @for (theme of lightThemes; track theme.name) {
            <button
              class="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors hover:bg-base-300"
              [class.bg-base-300]="currentTheme() === theme.name"
              [attr.data-theme]="theme.name"
              (click)="selectTheme(theme.name)"
            >
              <div class="flex gap-1 shrink-0">
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--p))'"
                ></span>
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--s))'"
                ></span>
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--a))'"
                ></span>
                <span
                  class="w-3 h-3 rounded-full"
                  [style.background-color]="'oklch(var(--n))'"
                ></span>
              </div>
              <span class="flex-1 text-left truncate">{{ theme.label }}</span>
              @if (currentTheme() === theme.name) {
                <lucide-angular
                  [img]="CheckIcon"
                  class="w-3.5 h-3.5 shrink-0 opacity-70"
                />
              }
            </button>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  private readonly themeService = inject(ThemeService);

  readonly currentTheme = this.themeService.currentTheme;
  readonly darkThemes = DAISYUI_THEMES.filter((t) => t.isDark);
  readonly lightThemes = DAISYUI_THEMES.filter((t) => !t.isDark);

  protected readonly PaletteIcon = Palette;
  protected readonly CheckIcon = Check;

  protected selectTheme(theme: ThemeName): void {
    this.themeService.setTheme(theme);
  }
}
