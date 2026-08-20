import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import {
  MEMBER_THEME_DARK,
  MEMBER_THEME_LIGHT,
  MEMBER_THEME_STORAGE_KEY,
  MemberThemeService,
} from '../services/member-theme.service';
import { MemberThemeToggle } from './member-theme-toggle';

/**
 * R9.6 — the member panel's theme switch is REACHABLE, LABELLED and DRIVES THE
 * ONE SERVICE.
 *
 * `member-theme.service.spec.ts` already covers the state machine: default,
 * persistence, fallback, and that only the two member themes are ever emitted.
 * What it cannot cover is whether a member can actually get at it. Batch 4's
 * exit gate stalled on exactly that gap — the two themes existed and nothing
 * rendered a way to see the second one.
 *
 * The a11y assertions below are not decoration. B15 audits this control, and a
 * control that is inaccessible now is rework then, not a later polish pass.
 */
describe('MemberThemeToggle (R9.6)', () => {
  let fixture: ComponentFixture<MemberThemeToggle>;
  let service: MemberThemeService;

  function button(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('button')).nativeElement;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [MemberThemeToggle] });

    service = TestBed.inject(MemberThemeService);
    fixture = TestBed.createComponent(MemberThemeToggle);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders a real <button>, so it is keyboard reachable for free', () => {
    const el = button();

    // A <div> with a (click) handler looks identical and is unreachable by
    // keyboard. A native button is in the tab order and fires on Enter and
    // Space with no key handling of ours to get wrong.
    expect(el.tagName).toBe('BUTTON');
    expect(el.type).toBe('button');
    // Nothing may remove it from the tab order.
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.getAttribute('tabindex')).toBeNull();
  });

  it('announces the DESTINATION, not the current state', () => {
    // "Switch to light theme" tells a screen-reader user what the click will
    // do. "Dark theme active" would leave them to guess.
    expect(button().getAttribute('aria-label')).toBe('Switch to light theme');

    service.toggle();
    fixture.detectChanges();

    expect(button().getAttribute('aria-label')).toBe('Switch to dark theme');
  });

  it('keeps the visible caption inside the accessible name (WCAG 2.5.3)', () => {
    const el = button();
    const accessibleName = el.getAttribute('aria-label') ?? '';

    // aria-label REPLACES the visible text as the accessible name, so speech
    // input ("click Light theme") only works while the name still contains
    // what is printed on the control.
    expect(el.textContent?.trim()).toBe('Light theme');
    expect(accessibleName.toLowerCase()).toContain('light theme');
  });

  it('hides the icon from assistive tech rather than announcing it twice', () => {
    const icon = fixture.debugElement.query(By.css('lucide-angular'));

    expect(icon).not.toBeNull();
    expect(icon.nativeElement.getAttribute('aria-hidden')).toBe('true');
  });

  it('a click switches the theme and persists it to the one existing key', () => {
    expect(service.theme()).toBe(MEMBER_THEME_DARK);

    button().click();
    fixture.detectChanges();

    expect(service.theme()).toBe(MEMBER_THEME_LIGHT);
    // The service's own key — this control introduces no second one.
    expect(localStorage.getItem(MEMBER_THEME_STORAGE_KEY)).toBe(
      MEMBER_THEME_LIGHT,
    );

    button().click();
    fixture.detectChanges();

    expect(service.theme()).toBe(MEMBER_THEME_DARK);
  });

  it('reflects a theme changed elsewhere, e.g. the account page control', () => {
    // AccountPage offers the same choice as an explicit two-option control.
    // Both drive this one service, so the chrome must never show a stale label.
    service.setTheme(MEMBER_THEME_LIGHT);
    fixture.detectChanges();

    expect(button().textContent?.trim()).toBe('Dark theme');
    expect(button().getAttribute('aria-label')).toBe('Switch to dark theme');
  });
});
