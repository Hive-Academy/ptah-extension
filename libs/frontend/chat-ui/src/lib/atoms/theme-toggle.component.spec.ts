import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationRef } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DAISYUI_THEMES, ThemeService, type ThemeName } from '@ptah-extension/core';
import { ThemeToggleComponent } from './theme-toggle.component';

/**
 * jsdom does not promote popover="auto" to the top layer and does not paint it.
 * These tests check the contract the component can express in the DOM: partitions,
 * names, delegation, ARIA, placement writes, and callback cancellation.
 */
describe('ThemeToggleComponent', () => {
  let setTheme: jest.Mock;
  let setAccent: jest.Mock;
  let currentTheme: ReturnType<typeof signal<ThemeName>>;
  let accent: ReturnType<typeof signal<'gold' | 'rose' | 'moonstone'>>;

  beforeEach(async () => {
    currentTheme = signal<ThemeName>('anubis');
    accent = signal<'gold' | 'rose' | 'moonstone'>('gold');
    setTheme = jest.fn();
    setAccent = jest.fn();

    await TestBed.configureTestingModule({
      imports: [ThemeToggleComponent],
      providers: [
        {
          provide: ThemeService,
          useValue: {
            currentTheme: currentTheme.asReadonly(),
            accent: accent.asReadonly(),
            setTheme,
            setAccent,
          },
        },
      ],
    }).compileComponents();
  });

  const viewport = { width: window.innerWidth, height: window.innerHeight };

  afterEach(() => {
    jest.restoreAllMocks();
    document.documentElement.style.fontSize = '';
    setViewport(viewport.width, viewport.height);
  });

  /** jsdom defines innerWidth/innerHeight as data properties, so a getter spy cannot replace them. */
  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
  }

  function create(): ComponentFixture<ThemeToggleComponent> {
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    fixture.detectChanges();
    return fixture;
  }

  function triggerOf(fixture: ComponentFixture<ThemeToggleComponent>): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[aria-label="Change theme"]') as HTMLButtonElement;
  }

  function panelOf(fixture: ComponentFixture<ThemeToggleComponent>): HTMLElement {
    return fixture.nativeElement.querySelector('.dropdown-content') as HTMLElement;
  }

  function flush(fixture: ComponentFixture<ThemeToggleComponent>): void {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  }

  function toggle(panel: HTMLElement, state: 'open' | 'closed'): void {
    const event = new Event('beforetoggle');
    Object.defineProperty(event, 'newState', { value: state });
    panel.dispatchEvent(event);
  }

  function setScrollHeight(panel: HTMLElement, value: number): void {
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, value });
  }

  function mockRect(trigger: HTMLElement, rect: Partial<DOMRect>): void {
    jest.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 32,
      top: 8,
      left: 700,
      bottom: 40,
      right: 800,
      toJSON() {
        return {};
      },
      ...rect,
    } as DOMRect);
  }

  function patchComputed(
    patch: (element: Element) => Partial<CSSStyleDeclaration> | null,
  ): void {
    const real = window.getComputedStyle.bind(window);
    jest.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
      const style = real(element);
      const extra = patch(element);
      if (!extra) return style;
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(extra, prop)) {
            return extra[prop as keyof CSSStyleDeclaration];
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as CSSStyleDeclaration;
    });
  }

  it('creates and exposes the current theme from the service', () => {
    const fixture = create();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.currentTheme()).toBe('anubis');
  });

  it('partitions every theme once into Light 18, Dark 12, and Glass 6', () => {
    const fixture = create();
    const { lightThemes, darkThemes, glassThemes } = fixture.componentInstance;
    expect(lightThemes).toHaveLength(18);
    expect(darkThemes).toHaveLength(12);
    expect(glassThemes).toHaveLength(6);
    expect(lightThemes.every((theme) => theme.glass !== true && !theme.isDark)).toBe(true);
    expect(darkThemes.every((theme) => theme.glass !== true && theme.isDark)).toBe(true);
    expect(glassThemes.every((theme) => theme.glass === true)).toBe(true);
    expect(glassThemes.map((theme) => theme.name)).toEqual([
      'ptah-glass',
      'ptah-glass-light',
      'dark',
      'cupcake',
      'dracula',
      'nord',
    ]);
    const names = [...lightThemes, ...darkThemes, ...glassThemes].map((theme) => theme.name);
    expect(new Set(names).size).toBe(DAISYUI_THEMES.length);
    expect(names.sort()).toEqual(DAISYUI_THEMES.map((theme) => theme.name).sort());
    expect(lightThemes.map((theme) => theme.name)).toEqual(
      DAISYUI_THEMES.filter((theme) => theme.glass !== true && !theme.isDark).map((theme) => theme.name),
    );

    const seen = new Set<string>();
    for (const label of ['Light', 'Dark', 'Glass']) {
      const tab = [...fixture.nativeElement.querySelectorAll('[role="tab"]')].find((node) =>
        (node as HTMLElement).textContent?.includes(label),
      ) as HTMLButtonElement;
      tab.click();
      fixture.detectChanges();
      const tiles = [...fixture.nativeElement.querySelectorAll('button[data-theme]')] as HTMLButtonElement[];
      expect(tiles).toHaveLength(label === 'Light' ? 18 : label === 'Dark' ? 12 : 6);
      for (const tile of tiles) seen.add(tile.dataset['theme'] ?? '');
    }
    expect(seen.size).toBe(36);
  });

  it('names each tile with title and aria-label and paints the four theme channels', () => {
    const fixture = create();
    const tile = fixture.nativeElement.querySelector(
      'button[data-theme="synthwave"]',
    ) as HTMLButtonElement;
    expect(tile.getAttribute('title')).toBe('Synthwave');
    expect(tile.getAttribute('aria-label')).toBe('Synthwave');
    expect(tile.textContent?.trim()).toBe('');
    expect(
      [...tile.querySelectorAll('.theme-swatch')].map((swatch) => swatch.getAttribute('data-channel')),
    ).toEqual(['p', 's', 'a', 'n']);
    for (const channel of ['p', 's', 'a', 'n']) {
      expect(tile.querySelector(`[data-channel="${channel}"]`)?.getAttribute('style')).toContain(
        `oklch(var(--${channel}))`,
      );
    }
  });

  it('marks only the current tile pressed, shows its check, and delegates selection', () => {
    const fixture = create();
    const panel = panelOf(fixture);
    const pressed = [
      ...fixture.nativeElement.querySelectorAll('button[data-theme][aria-pressed="true"]'),
    ] as HTMLButtonElement[];
    expect(pressed.map((button) => button.dataset['theme'])).toEqual(['anubis']);
    expect(pressed[0].querySelector('.theme-tile-plate')).not.toBeNull();
    const rest = [
      ...fixture.nativeElement.querySelectorAll('button[data-theme][aria-pressed="false"]'),
    ] as HTMLButtonElement[];
    expect(rest.every((button) => button.querySelector('.theme-tile-plate') === null)).toBe(true);

    const hide = jest.fn();
    panel.hidePopover = hide;
    pressed[0].click();
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith('anubis');
    expect(hide).not.toHaveBeenCalled();
  });

  it('keeps the three accents on every tab for either Ptah theme and delegates them', () => {
    currentTheme.set('ptah-glass');
    const first = create();
    const second = create();
    for (const label of ['Light', 'Dark', 'Glass']) {
      const tab = [...first.nativeElement.querySelectorAll('[role="tab"]')].find((node) =>
        (node as HTMLElement).textContent?.includes(label),
      ) as HTMLButtonElement;
      tab.click();
      first.detectChanges();
      expect(
        [...first.nativeElement.querySelectorAll('input[type="radio"]')].map((radio) =>
          (radio as HTMLInputElement).getAttribute('aria-label'),
        ),
      ).toEqual(['Gold', 'Rose quartz', 'Moonstone']);
    }
    const rose = first.nativeElement.querySelector(
      'input[aria-label="Rose quartz"]',
    ) as HTMLInputElement;
    rose.dispatchEvent(new Event('change'));
    expect(setAccent).toHaveBeenCalledWith('rose');

    expect(panelOf(first).classList.contains('picker-surface-light')).toBe(false);
    currentTheme.set('ptah-glass-light');
    first.detectChanges();
    expect(first.nativeElement.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(panelOf(first).classList.contains('picker-surface-light')).toBe(true);
    const nameA = (first.nativeElement.querySelector('input[type="radio"]') as HTMLInputElement).name;
    const nameB = (second.nativeElement.querySelector('input[type="radio"]') as HTMLInputElement).name;
    expect(nameA).not.toBe(nameB);
    expect(nameA).not.toBe('ptah-accent');
    expect(nameB).not.toBe('ptah-accent');

    for (const name of ['lofi', 'dark', 'cupcake', 'dracula', 'nord'] as const) {
      currentTheme.set(name);
      first.detectChanges();
      expect(first.nativeElement.querySelector('fieldset')).toBeNull();
    }
  });

  it('links the tablist to one tabpanel and opens on the current theme category', () => {
    const fixture = create();
    const panel = panelOf(fixture);
    const tabs = [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    const tabpanel = fixture.nativeElement.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(fixture.nativeElement.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Theme categories',
    );
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('Theme');
    expect(tabs.map((tab) => tab.getAttribute('aria-controls'))).toEqual([
      tabpanel.id,
      tabpanel.id,
      tabpanel.id,
    ]);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Light', 'Dark', 'Glass']);
    expect(tabpanel.getAttribute('aria-labelledby')).toBe(tabs[1].id);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);

    tabs[0].click();
    fixture.detectChanges();
    currentTheme.set('nord');
    setScrollHeight(panel, 200);
    toggle(panel, 'open');
    flush(fixture);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(tabpanel.getAttribute('aria-labelledby')).toBe(tabs[2].id);
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('button[data-theme="nord"]'),
    );
  });

  it('moves tabs with arrows, Home, and End, and roves tiles by the live column count', () => {
    const fixture = create();
    patchComputed((element) =>
      element.classList.contains('theme-grid')
        ? { gridTemplateColumns: '16px 16px 16px 16px 16px' }
        : null,
    );
    const tabs = [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[2]);
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');

    tabs[1].click();
    fixture.detectChanges();
    const anubis = fixture.nativeElement.querySelector(
      'button[data-theme="anubis"]',
    ) as HTMLButtonElement;
    anubis.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('button[data-theme="black"]'),
    );
    (document.activeElement as HTMLButtonElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    );
    expect(document.activeElement).toBe(anubis);
    anubis.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('button[data-theme="sunset"]'),
    );
  });

  it('wires the popover invoker and places a roomy panel 4px under the trigger', () => {
    const fixture = create();
    const trigger = triggerOf(fixture);
    const panel = panelOf(fixture);
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('popovertarget')).toBe(panel.id);
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(panel.getAttribute('popover')).toBe('auto');
    expect(panel.querySelector('fieldset')).toBeNull();

    mockRect(trigger, { bottom: 40, right: 800, top: 8, left: 700 });
    setScrollHeight(panel, 400);
    toggle(panel, 'open');
    flush(fixture);

    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const base = Number.isFinite(root) && root > 0 ? root : 16;
    const width = Math.min((256 / 16) * base, window.innerWidth - 16);
    expect(panel.style.top).toBe('44px');
    expect(panel.style.right).toBe(`${window.innerWidth - 800}px`);
    expect(panel.style.width).toBe(`${width}px`);
    expect(panel.style.maxHeight).toBe('400px');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    toggle(panel, 'closed');
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('caps a narrow viewport and updates height when the window resizes', () => {
    const fixture = create();
    const trigger = triggerOf(fixture);
    const panel = panelOf(fixture);
    document.documentElement.style.fontSize = '16px';
    setViewport(200, 180);
    mockRect(trigger, { top: 68, bottom: 100, left: 100, right: 190, width: 90, height: 32 });
    setScrollHeight(panel, 400);
    toggle(panel, 'open');
    flush(fixture);

    expect(panel.style.width).toBe('184px');
    expect(panel.style.left).toBe('8px');
    expect(panel.style.right).toBe('auto');
    expect(panel.style.top).toBe('104px');
    expect(panel.style.maxHeight).toBe('68px');

    setViewport(1024, 120);
    mockRect(trigger, { top: 8, bottom: 40, left: 700, right: 800, width: 100, height: 32 });
    window.dispatchEvent(new Event('resize'));

    expect(panel.style.top).toBe('44px');
    expect(panel.style.maxHeight).toBe('68px');
    expect(panel.style.right).toBe(`${1024 - 800}px`);
  });

  it('does not write placement from an empty content box', () => {
    const fixture = create();
    const panel = panelOf(fixture);
    const trigger = triggerOf(fixture);
    panel.style.top = '7px';
    panel.style.right = '3px';
    mockRect(trigger, { bottom: 40, right: 800 });
    setScrollHeight(panel, 0);
    toggle(panel, 'open');
    flush(fixture);
    expect(panel.style.top).toBe('7px');
    expect(panel.style.right).toBe('3px');
  });

  it('returns Escape focus to the trigger and does not move focus for an outside click', () => {
    const fixture = create();
    const trigger = triggerOf(fixture);
    const tile = fixture.nativeElement.querySelector(
      'button[data-theme="anubis"]',
    ) as HTMLButtonElement;
    tile.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(trigger);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('opens from ArrowDown on the trigger through the popover API', () => {
    const fixture = create();
    const panel = panelOf(fixture);
    const show = jest.fn();
    panel.showPopover = show;
    triggerOf(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('copies parent ink as concrete colors and outlines tiles with that ink', () => {
    const fixture = create();
    patchComputed(() => ({ color: 'rgb(10, 20, 30)', backgroundColor: 'rgb(40, 50, 60)' }));
    const panel = panelOf(fixture);
    setScrollHeight(panel, 120);
    toggle(panel, 'open');
    flush(fixture);
    expect(panel.style.getPropertyValue('--picker-ink')).toBe('rgb(10, 20, 30)');
    expect(panel.style.getPropertyValue('--picker-plate')).toBe('rgb(40, 50, 60)');
    expect(panel.style.getPropertyValue('--picker-ink')).not.toContain('var(--bc)');

    // jest-preset-angular drops inline component styles, so no <style> reaches jsdom. Read the source.
    const css = readFileSync(join(__dirname, 'theme-toggle.component.ts'), 'utf8');
    expect(css).toContain('outline: 2px solid var(--picker-ink, CanvasText)');
    expect(css).not.toContain('outline: 2px solid currentColor');
  });

  it('marks the selected tab with a panel-ink bar in every theme, not only a fill', () => {
    // Inline styles never reach jsdom (see above), so pin the rule in the source.
    const css = readFileSync(join(__dirname, 'theme-toggle.component.ts'), 'utf8');
    const rule = /\n {4}\.theme-tab\[aria-selected='true'\] \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain('box-shadow: inset 0 -2px 0 var(--picker-ink, currentColor)');
    expect(rule?.[1]).toContain('color: var(--picker-ink, currentColor)');
  });

  function tabOf(fixture: ComponentFixture<ThemeToggleComponent>, label: string): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('[role="tab"]')].find((node) =>
      (node as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;
  }

  it('refreshes parent ink after a same-category theme renders without moving focus', () => {
    setTheme.mockImplementation((name: ThemeName) => currentTheme.set(name));
    let ink = 'rgb(10, 20, 30)';
    let plate = 'rgb(40, 50, 60)';
    patchComputed(() => ({ color: ink, backgroundColor: plate }));
    const fixture = create();
    const panel = panelOf(fixture);
    setScrollHeight(panel, 200);
    toggle(panel, 'open');
    flush(fixture);
    expect(panel.style.getPropertyValue('--picker-ink')).toBe('rgb(10, 20, 30)');

    const black = fixture.nativeElement.querySelector('button[data-theme="black"]') as HTMLButtonElement;
    black.click();
    expect(setTheme).toHaveBeenCalledWith('black');
    ink = 'rgb(200, 210, 220)';
    plate = 'rgb(1, 2, 3)';
    const focus = jest.spyOn(HTMLElement.prototype, 'focus');
    flush(fixture);
    expect(panel.style.getPropertyValue('--picker-ink')).toBe('rgb(200, 210, 220)');
    expect(panel.style.getPropertyValue('--picker-plate')).toBe('rgb(1, 2, 3)');
    expect(focus).not.toHaveBeenCalled();
  });

  it('re-places above the anchor after a tab change and an accent footer change', () => {
    setTheme.mockImplementation((name: ThemeName) => currentTheme.set(name));
    currentTheme.set('nord');
    const fixture = create();
    const trigger = triggerOf(fixture);
    const panel = panelOf(fixture);
    const height = window.innerHeight;
    mockRect(trigger, { top: height - 68, bottom: height - 36, left: 700, right: 800 });
    setScrollHeight(panel, 120);
    toggle(panel, 'open');
    flush(fixture);
    expect(panel.style.maxHeight).toBe('120px');
    expect(panel.style.top).toBe(`${height - 72 - 120}px`);

    const focus = jest.spyOn(HTMLElement.prototype, 'focus');
    tabOf(fixture, 'Light').click();
    setScrollHeight(panel, 360);
    flush(fixture);
    expect(panel.style.maxHeight).toBe('360px');
    expect(panel.style.top).toBe(`${height - 72 - 360}px`);
    expect(focus).not.toHaveBeenCalled();

    tabOf(fixture, 'Glass').click();
    setScrollHeight(panel, 120);
    flush(fixture);
    expect(panel.style.maxHeight).toBe('120px');
    expect(panel.querySelector('fieldset')).toBeNull();

    (fixture.nativeElement.querySelector('button[data-theme="ptah-glass"]') as HTMLButtonElement).click();
    setScrollHeight(panel, 200);
    flush(fixture);
    expect(panel.querySelector('fieldset')).not.toBeNull();
    expect(panel.style.maxHeight).toBe('200px');
    expect(panel.style.top).toBe(`${height - 72 - 200}px`);
  });

  it('does not focus a tile from a follow-up queued before close or destroy', () => {
    const fixture = create();
    const panel = panelOf(fixture);
    setScrollHeight(panel, 320);
    const focused: HTMLElement[] = [];
    jest.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    toggle(panel, 'open');
    const queuedDuringOpen = focused.some((element) => element.dataset['theme']);
    toggle(panel, 'closed');
    const countAtClose = focused.length;
    flush(fixture);
    expect(focused.length).toBe(countAtClose);
    if (!queuedDuringOpen) {
      expect(focused.filter((element) => element.dataset['theme'])).toEqual([]);
    }

    toggle(panel, 'open');
    const beforeDestroy = focused.length;
    fixture.destroy();
    expect(focused.length).toBe(beforeDestroy);
  });
});
