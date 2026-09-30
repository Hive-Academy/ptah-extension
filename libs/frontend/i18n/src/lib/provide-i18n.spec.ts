import { formatDate } from '@angular/common';
import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DefaultFallbackStrategy,
  DefaultMissingHandler,
  TRANSLOCO_FALLBACK_STRATEGY,
  TRANSLOCO_MISSING_HANDLER,
  TranslocoService,
} from '@jsverse/transloco';
import { I18nMissingHandler } from './i18n-missing.handler';
import { defineI18nScope } from './i18n-scope';
import { I18nService } from './i18n.service';
import { provideI18n } from './provide-i18n';

const KEY = 'spec.lang';

const FIXTURE_SCOPE = defineI18nScope('fixture', {
  en: () => import('./__fixtures__/en.json'),
  ar: () => import('./__fixtures__/ar.json'),
});

function setup(): void {
  TestBed.configureTestingModule({
    providers: [
      provideI18n({ storageKey: KEY, globalScopes: [FIXTURE_SCOPE] }),
    ],
  });
}

describe('provideI18n', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('replaces Transloco’s DefaultMissingHandler with I18nMissingHandler', () => {
    setup();

    const handler = TestBed.inject(TRANSLOCO_MISSING_HANDLER);

    expect(handler).toBeInstanceOf(I18nMissingHandler);
    expect(handler).not.toBeInstanceOf(DefaultMissingHandler);
  });

  it('replaces the load fallback strategy, so a failed load fails', () => {
    setup();

    const strategy = TestBed.inject(TRANSLOCO_FALLBACK_STRATEGY);

    expect(strategy).not.toBeInstanceOf(DefaultFallbackStrategy);
    expect(strategy.getNextLangs('ar')).toEqual([]);
  });

  it('configures Transloco for bundled scopes', () => {
    setup();

    const { config } = TestBed.inject(TranslocoService);

    expect(config.availableLangs).toEqual(['en', 'ar']);
    expect(config.defaultLang).toBe('en');
    expect(config.reRenderOnLangChange).toBe(true);
    expect(config.scopes.keepCasing).toBe(true);
    expect(config.missingHandler).toEqual({
      useFallbackTranslation: false,
      logMissingKey: false,
      allowEmpty: false,
    });
  });

  it('registers Arabic locale data', () => {
    setup();
    TestBed.inject(TranslocoService);

    const formatted = formatDate(Date.UTC(2026, 0, 5), 'MMMM', 'ar', 'UTC');

    expect(formatted).toBe('يناير');
  });

  it('initialises before bootstrap completes: language resolved, global scopes loaded', async () => {
    localStorage.setItem(KEY, 'ar');
    setup();

    await TestBed.inject(ApplicationInitStatus).donePromise;
    const i18n = TestBed.inject(I18nService);

    expect(i18n.lang()).toBe('ar');
    expect(i18n.translate('fixture.greeting.hello')).toBe('مرحبا');
    expect(i18n.translate('fixture.greeting.hello', {}, 'en')).toBe('Hello');
  });
});
