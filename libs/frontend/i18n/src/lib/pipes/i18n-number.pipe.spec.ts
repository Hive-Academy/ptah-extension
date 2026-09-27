import * as angularCommon from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../testing';
import { I18nError } from '../i18n.error';
import { I18nService } from '../i18n.service';
import { I18nNumberPipe } from './i18n-number.pipe';

jest.mock('@angular/common', () => {
  const actual = jest.requireActual<typeof angularCommon>('@angular/common');
  return { ...actual, formatNumber: jest.fn(actual.formatNumber) };
});

const formatNumber = jest.mocked(angularCommon.formatNumber);
const ARABIC_INDIC_DIGITS = /[٠-٩]/;

@Component({
  selector: 'ptah-number-host',
  imports: [I18nNumberPipe],
  template: `{{ 1234.56 | i18nNumber: '1.0-1' }}`,
})
class NumberHostComponent {}

function setup(lang: 'en' | 'ar') {
  TestBed.configureTestingModule({
    providers: [provideI18nTesting({ lang, translations: { en: {}, ar: {} } })],
  });
  return TestBed.runInInjectionContext(() => new I18nNumberPipe());
}

describe('I18nNumberPipe', () => {
  afterEach(() => formatNumber.mockClear());

  it('formats like DecimalPipe in English', () => {
    const pipe = setup('en');

    expect(pipe.transform(1234.56, '1.0-1')).toBe('1,234.6');
    expect(pipe.transform(4.5)).toBe('4.5');
  });

  it('keeps Western digits in Arabic', () => {
    const pipe = setup('ar');

    const formatted = pipe.transform(1234.56, '1.0-1');

    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toMatch(/1.?234.6/);
  });

  it('converts numeric strings, as DecimalPipe does', () => {
    const pipe = setup('en');

    expect(pipe.transform('42.25', '1.0-1')).toBe('42.3');
  });

  it('throws an I18nError for a non-numeric string', () => {
    const pipe = setup('en');

    expect(() => pipe.transform('abc')).toThrow(I18nError);
  });

  it.each([[null], [undefined], [''], [Number.NaN]])(
    'returns null for %p',
    (value) => {
      const pipe = setup('en');

      expect(pipe.transform(value)).toBeNull();
      expect(formatNumber).not.toHaveBeenCalled();
    },
  );

  it('formats once for repeated identical input (memoised)', () => {
    const pipe = setup('en');

    pipe.transform(7, '1.0-1');
    pipe.transform(7, '1.0-1');
    expect(formatNumber).toHaveBeenCalledTimes(1);

    pipe.transform(7, '1.2-2');
    expect(formatNumber).toHaveBeenCalledTimes(2);
  });

  it('reformats after setLanguage without re-creating the pipe', async () => {
    setup('en');
    const fixture = TestBed.createComponent(NumberHostComponent);
    fixture.detectChanges();
    expect(formatNumber).toHaveBeenCalledTimes(1);

    await TestBed.inject(I18nService).setLanguage('ar');
    fixture.detectChanges();

    expect(formatNumber).toHaveBeenLastCalledWith(1234.56, 'ar', '1.0-1');
    expect(fixture.nativeElement.textContent).not.toMatch(ARABIC_INDIC_DIGITS);
  });
});
