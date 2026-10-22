import {
  Component,
  ChangeDetectionStrategy,
  HostListener,
  ElementRef,
  Injector,
  afterNextRender,
  type AfterRenderRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type OnDestroy,
} from '@angular/core';
import { LucideAngularModule, Palette, Check } from 'lucide-angular';
import {
  ThemeService,
  type ThemeInfo,
  type ThemeName,
  DAISYUI_THEMES,
} from '@ptah-extension/core';

type AccentName = Parameters<ThemeService['setAccent']>[0];
type ThemeCategory = 'light' | 'dark' | 'glass';

/** Glass wins, then isDark. Each theme is in one tab, in DAISYUI_THEMES order. */
function themeCategory(theme: ThemeInfo): ThemeCategory {
  if (theme.glass) return 'glass';
  return theme.isDark ? 'dark' : 'light';
}

const LIGHT_THEMES = DAISYUI_THEMES.filter((theme) => themeCategory(theme) === 'light');
const DARK_THEMES = DAISYUI_THEMES.filter((theme) => themeCategory(theme) === 'dark');
const GLASS_THEMES = DAISYUI_THEMES.filter((theme) => themeCategory(theme) === 'glass');
const CATEGORIES: readonly ThemeCategory[] = ['light', 'dark', 'glass'];

@Component({
  selector: 'ptah-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule],
  styles: `
    /* DaisyUI keeps .dropdown-content opacity:0 until :focus-within, and
       position:absolute inside the 40px bar. The bar is a flex item under
       overflow:hidden and an isolating stacking context, so the open panel
       was clipped or painted under the panes. The top layer is not clipped
       by those ancestors. :popover-open wins over the closed opacity.
       The panel stays in this host so custom properties inherit. */
    .dropdown > .dropdown-content {
      position: fixed;
      inset: auto;
      margin: 0;
      height: auto;
      color: inherit;
      box-sizing: border-box;
      width: min(16rem, calc(100vw - 16px));
      max-height: min(28rem, calc(100dvh - 16px));
      font-family: Inter, system-ui, sans-serif;
    }
    .dropdown > .dropdown-content:popover-open {
      visibility: visible;
      opacity: 1;
      transform: none;
    }
    .theme-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 0.375rem;
    }
    .theme-tab {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      margin: 0;
      padding: 0.25rem 0.5rem;
      border: 0;
      border-radius: var(--glass-radius-sm, 10px);
      color: inherit;
      font: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.2;
      cursor: pointer;
    }
    .theme-tab[aria-selected='false'] {
      background: transparent;
    }
    :host-context([data-glass='on']) .theme-tab[aria-selected='true'] {
      background: var(--glass-sel);
    }
    .theme-tab:focus-visible {
      outline: 2px solid var(--picker-ink, currentColor);
      outline-offset: 2px;
    }
    .theme-tab-chip {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 2px;
      box-sizing: border-box;
      flex: 0 0 auto;
    }
    .theme-tab-chip[data-chip='light'] {
      background: #ffffff;
      border: 1px solid var(--glass-line-strong, currentColor);
    }
    .theme-tab-chip[data-chip='dark'] {
      background: #17191d;
    }
    .theme-tab-chip[data-chip='glass'] {
      background: linear-gradient(135deg, #2b2e34, #17191d 62%, #26292f);
    }
    .picker-surface-light .theme-tab-chip[data-chip='glass'] {
      background: linear-gradient(135deg, #e9e1fb, #f6edf8 62%, #fde9df);
    }
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, 2.25rem);
      gap: 0.375rem;
    }
    .theme-tile {
      position: relative;
      box-sizing: border-box;
      width: 2.25rem;
      height: 2.25rem;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: var(--rounded-btn, 0.5rem);
      background: transparent;
      /* data-theme redefines --bc on this control. The ring and check use the
         concrete --picker-ink copied from the parent, not the preview ink. */
      color: var(--picker-ink, CanvasText);
      cursor: pointer;
    }
    .theme-tile[data-theme][aria-pressed='true'],
    .theme-tile[data-theme]:focus-visible {
      outline: 2px solid var(--picker-ink, CanvasText);
      outline-offset: 2px;
    }
    .theme-tile[data-theme]:hover {
      background-color: color-mix(in srgb, var(--picker-ink, CanvasText) 12%, transparent);
    }
    .theme-swatches {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px;
      width: 100%;
      height: 100%;
      padding: 0.25rem;
      box-sizing: border-box;
      pointer-events: none;
    }
    .theme-swatch {
      display: block;
      min-width: 0;
      min-height: 0;
      border-radius: 999px;
    }
    .theme-tile-plate {
      position: absolute;
      right: 1px;
      bottom: 1px;
      z-index: 1;
      display: grid;
      place-items: center;
      width: 0.875rem;
      height: 0.875rem;
      border-radius: 999px;
      background: var(--picker-plate, color-mix(in srgb, var(--picker-ink, CanvasText) 18%, Canvas));
      color: var(--picker-ink, CanvasText);
      pointer-events: none;
    }
    .theme-tile-check {
      width: 0.75rem;
      height: 0.75rem;
    }
  `,
  template: `
    <div class="dropdown dropdown-end" [class.dropdown-open]="menuOpen()">
      <button
        #trigger
        type="button"
        class="btn btn-ghost btn-xs gap-1"
        aria-label="Change theme"
        aria-haspopup="dialog"
        [attr.aria-expanded]="menuOpen() ? 'true' : 'false'"
        [attr.aria-controls]="menuId"
        [attr.popovertarget]="menuId"
        (keydown)="onTriggerKeydown($event)"
      >
        <lucide-angular [img]="PaletteIcon" class="w-4 h-4" />
        <span class="icon-btn-label text-xs">Theme</span>
      </button>
      <div
        #panel
        [id]="menuId"
        popover="auto"
        role="dialog"
        aria-label="Theme"
        class="dropdown-content z-[1] p-2 shadow-lg bg-base-200 rounded-box overflow-y-auto"
        [class.picker-surface-light]="!currentIsDark()"
        (beforetoggle)="onBeforeToggle($event)"
        (keydown)="onDialogKeydown($event)"
      >
        <div class="theme-tabs" role="tablist" aria-label="Theme categories">
          @for (category of categories; track category.id) {
            <button
              type="button"
              class="theme-tab"
              role="tab"
              [id]="tabId(category.id)"
              [class.bg-base-300]="activeCategory() === category.id"
              [attr.aria-selected]="activeCategory() === category.id"
              [attr.aria-controls]="tabPanelId"
              [attr.tabindex]="activeCategory() === category.id ? 0 : -1"
              (click)="selectCategory(category.id)"
            >
              <span class="theme-tab-chip" [attr.data-chip]="category.id" aria-hidden="true"></span>
              {{ category.label }}
            </button>
          }
        </div>
        <div
          role="tabpanel"
          [id]="tabPanelId"
          [attr.aria-labelledby]="tabId(activeCategory())"
        >
          <div #grid class="theme-grid">
            @for (theme of visibleThemes(); track theme.name) {
              <button
                type="button"
                class="theme-tile"
                [attr.data-theme]="theme.name"
                [attr.title]="theme.label"
                [attr.aria-label]="theme.label"
                [attr.aria-pressed]="currentTheme() === theme.name ? 'true' : 'false'"
                [attr.tabindex]="tileTabIndex(theme.name)"
                (click)="selectTheme(theme.name)"
              >
                <span class="theme-swatches" aria-hidden="true">
                  <span class="theme-swatch" data-channel="p" [style.background-color]="'oklch(var(--p))'"></span>
                  <span class="theme-swatch" data-channel="s" [style.background-color]="'oklch(var(--s))'"></span>
                  <span class="theme-swatch" data-channel="a" [style.background-color]="'oklch(var(--a))'"></span>
                  <span class="theme-swatch" data-channel="n" [style.background-color]="'oklch(var(--n))'"></span>
                </span>
                @if (currentTheme() === theme.name) {
                  <span class="theme-tile-plate">
                    <lucide-angular [img]="CheckIcon" class="theme-tile-check" />
                  </span>
                }
              </button>
            }
          </div>
        </div>
        @if (currentTheme() === 'ptah-glass' || currentTheme() === 'ptah-glass-light') {
          <fieldset class="mt-3 border-t border-base-content/20 px-2 pt-3">
            <legend class="text-xs font-semibold">Primary accent</legend>
            <div class="flex gap-3 pt-2">
              @for (option of accents; track option.name) {
                <label class="cursor-pointer" [title]="option.label">
                  <input class="sr-only peer" type="radio" [attr.name]="accentGroup"
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
export class ThemeToggleComponent implements OnDestroy {
  private static sequence = 0;

  private readonly themeService = inject(ThemeService);
  private readonly injector = inject(Injector);
  private readonly triggerRef = viewChild<ElementRef<HTMLElement>>('trigger');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly gridRef = viewChild<ElementRef<HTMLElement>>('grid');

  readonly currentTheme = this.themeService.currentTheme;
  readonly accent = this.themeService.accent;
  protected readonly menuId = `ptah-theme-menu-${++ThemeToggleComponent.sequence}`;
  protected readonly tabPanelId = `${this.menuId}-tabpanel`;
  protected readonly accentGroup = `${this.menuId}-accent`;
  protected readonly menuOpen = signal(false);
  protected readonly activeCategory = signal<ThemeCategory>(
    this.categoryOfName(this.currentTheme()),
  );
  private readonly rovingName = signal<ThemeName | null>(null);
  /** Bumped on close and destroy so a render callback queued for the previous open cannot focus. */
  private focusGeneration = 0;
  private openRender: AfterRenderRef | undefined;
  /** Focus target for the queued follow-up. Refresh-only follow-ups leave it unchanged. */
  private pendingFocus: ThemeName | 'selected' | null = null;
  private destroyed = false;

  readonly accents: readonly { name: AccentName; label: string; fill: string }[] = [
    { name: 'gold', label: 'Gold', fill: 'linear-gradient(#f6d675, #d9a928)' },
    { name: 'rose', label: 'Rose quartz', fill: 'linear-gradient(#f9c6d4, #e98fab)' },
    { name: 'moonstone', label: 'Moonstone', fill: 'linear-gradient(#eef1f8, #bcc4d6)' },
  ];
  readonly lightThemes = LIGHT_THEMES;
  readonly darkThemes = DARK_THEMES;
  readonly glassThemes = GLASS_THEMES;
  protected readonly categories: readonly { id: ThemeCategory; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'glass', label: 'Glass' },
  ];
  protected readonly visibleThemes = computed(() => {
    const category = this.activeCategory();
    return DAISYUI_THEMES.filter((theme) => themeCategory(theme) === category);
  });
  protected readonly currentIsDark = computed(() => {
    const name = this.currentTheme();
    return DAISYUI_THEMES.find((theme) => theme.name === name)?.isDark === true;
  });

  protected readonly PaletteIcon = Palette;
  protected readonly CheckIcon = Check;

  /**
   * A theme change re-renders the panel (new parent ink, accent footer in or out).
   * setTheme can apply late, so react to the signal instead of the click.
   */
  constructor() {
    effect(() => {
      this.currentTheme();
      if (untracked(this.menuOpen)) this.scheduleFollowup();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cancelFollowup();
  }

  protected tabId(category: ThemeCategory): string {
    return `${this.menuId}-tab-${category}`;
  }

  protected selectTheme(theme: ThemeName): void {
    this.themeService.setTheme(theme);
    if (!this.menuOpen()) return;
    const next = this.categoryOfName(theme);
    this.rovingName.set(theme);
    if (next !== this.activeCategory()) {
      this.activeCategory.set(next);
      this.scheduleFollowup(theme);
      return;
    }
    this.focusTile(theme);
  }

  protected selectAccent(accent: AccentName): void {
    this.themeService.setAccent(accent);
  }

  protected selectCategory(category: ThemeCategory, focusTab = false): void {
    this.activeCategory.set(category);
    const tiles = this.visibleThemes();
    const current = this.currentTheme();
    const next = tiles.some((theme) => theme.name === current) ? current : tiles[0]?.name;
    if (next) this.rovingName.set(next);
    if (focusTab) this.tabButton(category)?.focus();
    if (this.menuOpen()) this.scheduleFollowup(null);
  }

  protected tileTabIndex(name: ThemeName): number {
    return name === this.activeTileName() ? 0 : -1;
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' || this.menuOpen()) return;
    event.preventDefault();
    const panel = this.panelRef()?.nativeElement;
    if (panel && typeof panel.showPopover === 'function') panel.showPopover();
  }

  /** State updates here. Focus and geometry wait until the next render has the selected tab's tiles. */
  protected onBeforeToggle(event: Event): void {
    const next = (event as { newState?: string }).newState;
    if (next !== 'open' && next !== 'closed') return;
    if (next === 'closed') {
      this.menuOpen.set(false);
      this.cancelFollowup();
      return;
    }
    this.menuOpen.set(true);
    const current = this.currentTheme();
    this.activeCategory.set(this.categoryOfName(current));
    this.rovingName.set(current);
    const panel = event.currentTarget;
    const trigger = this.triggerRef()?.nativeElement;
    if (panel instanceof HTMLElement && trigger) this.captureParentInk(panel, trigger);
    this.scheduleFollowup('selected');
  }

  protected onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      const panel = this.panelRef()?.nativeElement;
      if (panel?.contains(event.target as Node)) this.triggerRef()?.nativeElement.focus();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[role="tab"]')) {
      this.onTabKeydown(event);
      return;
    }
    if (target.closest('.theme-grid')) this.onTileKeydown(event);
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    if (!this.menuOpen()) return;
    const panel = this.panelRef()?.nativeElement;
    const trigger = this.triggerRef()?.nativeElement;
    if (!panel || !trigger) return;
    this.place(panel, trigger);
  }

  private onTabKeydown(event: KeyboardEvent): void {
    const index = CATEGORIES.indexOf(this.activeCategory());
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % CATEGORIES.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + CATEGORIES.length) % CATEGORIES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = CATEGORIES.length - 1;
    else return;
    event.preventDefault();
    this.selectCategory(CATEGORIES[next], true);
  }

  private onTileKeydown(event: KeyboardEvent): void {
    const tiles = this.visibleThemes();
    if (tiles.length === 0) return;
    const columns = this.columnCount();
    let index = tiles.findIndex((theme) => theme.name === this.activeTileName());
    if (index < 0) index = 0;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    else if (event.key === 'ArrowRight') index = Math.min(tiles.length - 1, index + 1);
    else if (event.key === 'ArrowUp') index = Math.max(0, index - columns);
    else if (event.key === 'ArrowDown') index = Math.min(tiles.length - 1, index + columns);
    else if (event.key === 'End') index = tiles.length - 1;
    else return;
    event.preventDefault();
    const name = tiles[index].name;
    this.rovingName.set(name);
    this.focusTile(name);
  }

  /**
   * After the next render: copy parent ink, re-place, then move focus only if asked.
   * Omit focus to keep the queued target; null clears it.
   */
  private scheduleFollowup(focus?: ThemeName | 'selected' | null): void {
    if (focus !== undefined) this.pendingFocus = focus;
    this.openRender?.destroy();
    const generation = this.focusGeneration;
    this.openRender = afterNextRender({
      mixedReadWrite: () => {
        this.openRender = undefined;
        if (!this.isFollowupCurrent(generation)) return;
        const panel = this.panelRef()?.nativeElement;
        const trigger = this.triggerRef()?.nativeElement;
        if (!panel || !trigger) return;
        this.captureParentInk(panel, trigger);
        this.place(panel, trigger);
        const target = this.pendingFocus;
        this.pendingFocus = null;
        if (!this.isFollowupCurrent(generation)) return;
        if (target === 'selected') this.focusSelectedTile();
        else if (target) this.focusTile(target);
      },
    }, { injector: this.injector });
  }

  private cancelFollowup(): void {
    this.focusGeneration += 1;
    this.pendingFocus = null;
    this.openRender?.destroy();
    this.openRender = undefined;
  }

  private isFollowupCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.focusGeneration && this.menuOpen();
  }

  /**
   * Copy used parent colors. A custom property set to var(--bc) would re-resolve
   * on the tile, because data-theme replaces --bc with the preview theme.
   */
  private captureParentInk(panel: HTMLElement, trigger: HTMLElement): void {
    const source = trigger.parentElement ?? trigger;
    const ink = getComputedStyle(source).color;
    if (ink && ink !== 'transparent' && ink !== 'rgba(0, 0, 0, 0)') {
      panel.style.setProperty('--picker-ink', ink);
    }
    let node: HTMLElement | null = source;
    while (node) {
      const background = getComputedStyle(node).backgroundColor;
      if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
        panel.style.setProperty('--picker-plate', background);
        return;
      }
      node = node.parentElement;
    }
  }

  /** Skip the write when the popover has not produced a real content box yet. */
  private place(panel: HTMLElement, trigger: HTMLElement): void {
    const margin = 8;
    const gap = 4;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    if (panel.scrollHeight <= 0) return;

    const width = Math.min(this.rem(256), viewportWidth - margin * 2);
    if (width <= 0) return;
    panel.style.width = `${width}px`;
    const contentHeight = panel.scrollHeight;
    if (contentHeight <= 0) return;

    const rect = trigger.getBoundingClientRect();
    const cap = Math.min(this.rem(448), viewportHeight - margin * 2);
    const needed = Math.min(contentHeight, cap);
    const spaceBelow = viewportHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    let top: number;
    let maxHeight: number;
    if (spaceBelow >= needed + gap) {
      top = rect.bottom + gap;
      maxHeight = needed;
    } else if (spaceAbove >= needed + gap) {
      maxHeight = needed;
      top = rect.top - gap - needed;
    } else if (Math.max(spaceBelow, spaceAbove) > gap) {
      const below = spaceBelow >= spaceAbove;
      const side = below ? spaceBelow : spaceAbove;
      maxHeight = side - gap;
      top = below ? rect.bottom + gap : rect.top - gap - maxHeight;
    } else {
      top = margin;
      maxHeight = Math.max(0, viewportHeight - margin * 2);
    }

    const boxHeight = Math.min(contentHeight, maxHeight);
    if (top < margin) top = margin;
    if (top + boxHeight > viewportHeight - margin) {
      top = Math.max(margin, viewportHeight - margin - boxHeight);
    }

    panel.style.top = `${top}px`;
    panel.style.bottom = 'auto';
    panel.style.maxHeight = `${maxHeight}px`;
    if (rect.right - width < margin) {
      panel.style.left = `${margin}px`;
      panel.style.right = 'auto';
    } else {
      panel.style.left = 'auto';
      panel.style.right = `${Math.max(0, viewportWidth - rect.right)}px`;
    }
  }

  private rem(pixelsAt16: number): number {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const base = Number.isFinite(root) && root > 0 ? root : 16;
    return (pixelsAt16 / 16) * base;
  }

  private columnCount(): number {
    const grid = this.gridRef()?.nativeElement;
    if (!grid) return 1;
    const tracks = getComputedStyle(grid).gridTemplateColumns;
    if (tracks && tracks !== 'none' && !tracks.includes('repeat(')) {
      const count = tracks.trim().split(/\s+/).filter((part) => part.length > 0).length;
      if (count > 0) return count;
    }
    const tiles = [...grid.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
    if (tiles.length === 0) return 1;
    const top = tiles[0].offsetTop;
    let count = 0;
    for (const tile of tiles) {
      if (tile.offsetTop !== top) break;
      count += 1;
    }
    return Math.max(1, count);
  }

  private activeTileName(): ThemeName | null {
    const tiles = this.visibleThemes();
    const roving = this.rovingName();
    if (roving && tiles.some((theme) => theme.name === roving)) return roving;
    const current = this.currentTheme();
    if (tiles.some((theme) => theme.name === current)) return current;
    return tiles[0]?.name ?? null;
  }

  private focusSelectedTile(): void {
    const current = this.currentTheme();
    const inTab = this.visibleThemes().some((theme) => theme.name === current);
    const name = inTab ? current : this.visibleThemes()[0]?.name;
    if (!name) return;
    this.rovingName.set(name);
    this.focusTile(name);
  }

  private focusTile(name: ThemeName): void {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) return;
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(name) : name;
    panel.querySelector<HTMLButtonElement>(`button[data-theme="${escaped}"]`)?.focus();
  }

  private tabButton(category: ThemeCategory): HTMLButtonElement | null {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) return null;
    const id = this.tabId(category);
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
    return panel.querySelector<HTMLButtonElement>(`#${escaped}`);
  }

  private categoryOfName(name: ThemeName): ThemeCategory {
    const theme = DAISYUI_THEMES.find((item) => item.name === name);
    return theme ? themeCategory(theme) : 'dark';
  }
}
