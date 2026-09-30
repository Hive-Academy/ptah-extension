import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SupportedLang } from '@ptah-extension/i18n';
import { provideI18nTesting } from '@ptah-extension/i18n/testing';

import { CountdownTimerComponent } from './countdown-timer.component';
import uiAr from './i18n/ar.json';
import uiEn from './i18n/en.json';

/** A fixed "now", so the rendered values do not drift during a test. */
const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);
/** 1 day, 2 hours, 3 minutes and 4 seconds after `NOW`. */
const TARGET = NOW + ((1 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000;

describe('CountdownTimerComponent', () => {
  let fixture: ComponentFixture<CountdownTimerComponent>;

  const render = (lang: SupportedLang, target = TARGET): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [CountdownTimerComponent],
      providers: [
        provideI18nTesting({
          lang,
          translations: { en: { ui: uiEn }, ar: { ui: uiAr } },
        }),
      ],
    });
    fixture = TestBed.createComponent(CountdownTimerComponent);
    fixture.componentRef.setInput('target', target);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  /** Each cell's `[value, label]`, in document order. */
  const cells = (host: HTMLElement): string[][] =>
    Array.from(host.querySelectorAll('[role="timer"] > div')).map((cell) =>
      Array.from(cell.querySelectorAll('span')).map(
        (span) => span.textContent?.trim() ?? '',
      ),
    );

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    fixture.destroy();
    jest.restoreAllMocks();
  });

  it('shows days to seconds with English labels and an aria text with params', () => {
    const host = render('en');

    expect(cells(host)).toEqual([
      ['01', 'Days'],
      ['02', 'Hrs'],
      ['03', 'Min'],
      ['04', 'Sec'],
    ]);
    expect(
      host.querySelector('[role="timer"]')?.getAttribute('aria-label'),
    ).toBe('01 days, 02 hours, 03 minutes, 04 seconds remaining');
  });

  it('keeps the days-to-seconds order in Arabic, in a left-to-right row', () => {
    const host = render('ar');
    const row = host.querySelector('[role="timer"]');

    expect(row?.getAttribute('dir')).toBe('ltr');
    expect(cells(host)).toEqual([
      ['01', 'أيام'],
      ['02', 'ساعات'],
      ['03', 'دقائق'],
      ['04', 'ثوانٍ'],
    ]);
    expect(row?.getAttribute('aria-label')).toBe(
      'متبقٍّ 01 يوم، و02 ساعة، و03 دقيقة، و04 ثانية',
    );
  });

  it('pulses only the seconds cell', () => {
    const host = render('en');
    const pulsing = Array.from(host.querySelectorAll('.sec-pulse')).map((el) =>
      el.textContent?.trim(),
    );

    expect(pulsing).toEqual(['04']);
  });

  it('announces that applications are closing once the target has passed', () => {
    const host = render('ar', NOW - 1000);
    const timer = host.querySelector('[role="timer"]');

    expect(timer?.textContent?.trim()).toBe('باب التقديم يُغلَق');
    expect(host.querySelectorAll('.sec-pulse')).toHaveLength(0);
  });
});
