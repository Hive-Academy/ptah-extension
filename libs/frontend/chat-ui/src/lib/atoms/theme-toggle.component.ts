import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Palette, Check } from 'lucide-angular';
import {
  ThemeService,
  type ThemeName,
  DAISYUI_THEMES,
} from '@ptah-extension/core';

type AccentName = Parameters<ThemeService['setAccent']>[0];

@Component({
  selector: 'ptah-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule],
  styles: `
    /* DaisyUI keeps .dropdown-content opacity:0 until :focus-within, and
       position:absolute inside the 40px bar. The bar is a flex item under
       overflow:hidden and an isolating stacking context, so the open panel
       was clipped or painted under the panes. The top layer is not clipped
       by those ancestors. :popover-open wins over the closed opacity. */
    .dropdown > .dropdown-content {
      position: fixed;
      inset: auto;
      margin: 0;
      height: auto;
      color: inherit;
    }
    .dropdown > .dropdown-content:popover-open {
      visibility: visible;
      opacity: 1;
      transform: none;
    }
  `,
  template: `
    <div class="dropdown dropdown-end" [class.dropdown-open]="menuOpen()">
      <button
        type="button"
        class="btn btn-ghost btn-xs gap-1"
        aria-label="Change theme"
        aria-haspopup="true"
        [attr.aria-expanded]="menuOpen() ? 'true' : 'false'"
        [attr.aria-controls]="menuId"
        [attr.popovertarget]="menuId"
      >
        <lucide-angular [img]="PaletteIcon" class="w-4 h-4" />
        <span class="icon-btn-label text-xs">Theme</span>
      </button>
      <div
        [id]="menuId"
        popover="auto"
        class="dropdown-content z-[1] p-2 shadow-lg bg-base-200 rounded-box w-64 max-h-[28rem] overflow-y-auto"
        (beforetoggle)="onBeforeToggle($event)"
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
        @if (currentTheme() === 'ptah-glass' || currentTheme() === 'ptah-glass-light') {
          <fieldset class="mt-3 border-t border-base-content/20 px-2 pt-3">
            <legend class="text-xs font-semibold">Primary accent</legend>
            <div class="flex gap-3 pt-2">
              @for (option of accents; track option.name) {
                <label class="cursor-pointer" [title]="option.label">
                  <input class="sr-only peer" type="radio" name="ptah-accent"
                    [attr.aria-label]="option.label" [checked]="accent() === option.name"
                    (change)="selectAccent(option.name)" />
                  <span class="block h-[22px] w-[22px] rounded-full border border-base-content/30 ring-offset-2 ring-offset-base-200 peer-checked:ring-2 peer-checked:ring-base-content peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--glass-focus)]"
                    [style.background]="option.fill"></span>
                </label>
              }
            </div>
          </fieldset>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  private static sequence = 0;

  private readonly themeService = inject(ThemeService);

  readonly currentTheme = this.themeService.currentTheme;
  readonly accent = this.themeService.accent;
  protected readonly menuId = `ptah-theme-menu-${++ThemeToggleComponent.sequence}`;
  protected readonly menuOpen = signal(false);
  readonly accents: readonly { name: AccentName; label: string; fill: string }[] = [
    { name: 'gold', label: 'Gold', fill: 'linear-gradient(#f6d675, #d9a928)' },
    { name: 'rose', label: 'Rose quartz', fill: 'linear-gradient(#f9c6d4, #e98fab)' },
    { name: 'moonstone', label: 'Moonstone', fill: 'linear-gradient(#eef1f8, #bcc4d6)' },
  ];
  readonly darkThemes = DAISYUI_THEMES.filter((t) => t.isDark);
  readonly lightThemes = DAISYUI_THEMES.filter((t) => !t.isDark);

  protected readonly PaletteIcon = Palette;
  protected readonly CheckIcon = Check;

  protected selectTheme(theme: ThemeName): void {
    this.themeService.setTheme(theme);
  }
  protected selectAccent(accent: AccentName): void {
    this.themeService.setAccent(accent);
  }

  /** Place the panel before the top layer shows it. newState is a DOM ToggleEvent field. */
  protected onBeforeToggle(event: Event): void {
    const next = (event as { newState?: string }).newState;
    if (next !== 'open' && next !== 'closed') return;
    this.menuOpen.set(next === 'open');
    if (next !== 'open') return;
    const panel = event.currentTarget;
    const trigger = panel instanceof HTMLElement ? panel.previousElementSibling : null;
    if (!(panel instanceof HTMLElement) || !(trigger instanceof HTMLElement)) return;
    const rect = trigger.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.right = `${Math.max(0, window.innerWidth - rect.right)}px`;
    panel.style.left = 'auto';
    panel.style.bottom = 'auto';
  }
}
