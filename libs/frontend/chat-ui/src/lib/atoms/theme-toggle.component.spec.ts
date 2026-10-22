import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ThemeService, type ThemeName } from '@ptah-extension/core';
import { ThemeToggleComponent } from './theme-toggle.component';

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

  it('creates and exposes the current theme from the service', () => {
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.currentTheme()).toBe('anubis');
  });

  it('separates dark and light theme buckets', () => {
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.darkThemes.length).toBeGreaterThan(0);
    expect(fixture.componentInstance.lightThemes.length).toBeGreaterThan(0);
    expect(fixture.componentInstance.darkThemes.every((t) => t.isDark)).toBe(
      true,
    );
    expect(fixture.componentInstance.lightThemes.every((t) => !t.isDark)).toBe(
      true,
    );
  });

  it('delegates theme selection to the ThemeService', () => {
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    fixture.detectChanges();

    const firstButton = fixture.nativeElement.querySelector(
      'button[data-theme]',
    ) as HTMLButtonElement;
    firstButton.click();
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith(firstButton.dataset['theme']);
  });

  it('opens the same 36-theme list in the top layer under the trigger', () => {
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector(
      '[aria-label="Change theme"]',
    ) as HTMLButtonElement;
    const panel = fixture.nativeElement.querySelector(
      '.dropdown-content',
    ) as HTMLElement;

    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('popovertarget')).toBe(panel.id);
    expect(panel.getAttribute('popover')).toBe('auto');
    expect(panel.querySelectorAll('button[data-theme]').length).toBe(36);
    expect(
      fixture.componentInstance.darkThemes.length +
        fixture.componentInstance.lightThemes.length,
    ).toBe(36);

    jest.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      right: 800,
      top: 8,
      left: 700,
      width: 100,
      height: 32,
      x: 700,
      y: 8,
      toJSON() {
        return {};
      },
    });
    const opening = new Event('beforetoggle');
    Object.defineProperty(opening, 'newState', { value: 'open' });
    panel.dispatchEvent(opening);
    fixture.detectChanges();

    expect(panel.style.top).toBe('44px');
    expect(panel.style.right).toBe(`${window.innerWidth - 800}px`);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel.querySelector('fieldset')).toBeNull();
  });

  it('keeps accent choices on the glass themes and delegates them', () => {
    currentTheme.set('ptah-glass');
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    fixture.detectChanges();

    const radios = [
      ...fixture.nativeElement.querySelectorAll('input[type="radio"]'),
    ] as HTMLInputElement[];
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'Gold',
      'Rose quartz',
      'Moonstone',
    ]);
    radios[1].dispatchEvent(new Event('change'));
    expect(setAccent).toHaveBeenCalledWith('rose');

    currentTheme.set('ptah-glass-light');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('input[type="radio"]').length).toBe(
      3,
    );
  });
});
