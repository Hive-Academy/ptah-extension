import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ThemeService, type ThemeName } from '@ptah-extension/core';
import { ThemeToggleComponent } from './theme-toggle.component';

describe('ThemeToggleComponent', () => {
  let setTheme: jest.Mock;
  let currentTheme: ReturnType<typeof signal<ThemeName>>;

  beforeEach(async () => {
    currentTheme = signal<ThemeName>('anubis');
    setTheme = jest.fn();

    await TestBed.configureTestingModule({
      imports: [ThemeToggleComponent],
      providers: [
        {
          provide: ThemeService,
          useValue: {
            currentTheme: currentTheme.asReadonly(),
            setTheme,
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
});
