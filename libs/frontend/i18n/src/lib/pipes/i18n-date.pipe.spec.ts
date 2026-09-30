import * as angularCommon from '@angular/common';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../testing';
import { I18nService } from '../i18n.service';
import { I18nDatePipe } from './i18n-date.pipe';

jest.mock('@angular/common', () => {
  const actual = jest.requireActual<typeof angularCommon>('@angular/common');
  return { ...actual, formatDate: jest.fn(actual.formatDate) };
});

const formatDate = jest.mocked(angularCommon.formatDate);

// 2026-01-05 12:00 UTC; formatted in UTC so the result does not depend on the
// machine's time zone.
const DAY = new Date(Date.UTC(2026, 0, 5, 12));
const ARABIC_INDIC_DIGITS = /[٠-٩]/;

@Component({
  selector: 'ptah-date-host',
  imports: [I18nDatePipe],
  template: `{{ value() | i18nDate: 'MMM d, y' : 'UTC' }}`,
})
class DateHostComponent {
  readonly value = signal<Date | null>(DAY);
}

function setup(lang: 'en' | 'ar') {
  TestBed.configureTestingModule({
    providers: [provideI18nTesting({ lang, translations: { en: {}, ar: {} } })],
  });
  return TestBed.runInInjectionContext(() => new I18nDatePipe());
}

describe('I18nDatePipe', () => {
  afterEach(() => formatDate.mockClear());

  it('formats like DatePipe in English', () => {
    const pipe = setup('en');

    expect(pipe.transform(DAY, 'MMM d, y', 'UTC')).toBe('Jan 5, 2026');
    expect(pipe.transform(DAY, undefined, 'UTC')).toBe('Jan 5, 2026');
  });

  it('uses Arabic month names and Western digits in Arabic', () => {
    const pipe = setup('ar');

    const formatted = pipe.transform(DAY, 'MMM d, y', 'UTC');

    expect(formatted).toContain('يناير');
    expect(formatted).toContain('2026');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it.each([[null], [undefined], [''], [Number.NaN]])(
    'returns null for %p',
    (value) => {
      const pipe = setup('en');

      expect(pipe.transform(value)).toBeNull();
      expect(formatDate).not.toHaveBeenCalled();
    },
  );

  it('formats once for repeated identical input (memoised)', () => {
    const pipe = setup('en');

    pipe.transform(DAY, 'MMM d, y', 'UTC');
    pipe.transform(DAY, 'MMM d, y', 'UTC');
    pipe.transform(DAY, 'MMM d, y', 'UTC');
    expect(formatDate).toHaveBeenCalledTimes(1);

    pipe.transform(DAY, 'y', 'UTC');
    expect(formatDate).toHaveBeenCalledTimes(2);
  });

  it('reformats after setLanguage without re-creating the pipe', async () => {
    setup('en');
    const fixture = TestBed.createComponent(DateHostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe('Jan 5, 2026');

    await TestBed.inject(I18nService).setLanguage('ar');
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('يناير');
    expect(text).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatDate).toHaveBeenCalledTimes(2);
  });

  it('renders nothing for a null value in a template', () => {
    setup('en');
    const fixture = TestBed.createComponent(DateHostComponent);
    fixture.componentInstance.value.set(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toBe('');
  });
});
