import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';
import { firstValueFrom, isObservable, of, type Observable } from 'rxjs';
import { I18nError } from './i18n.error';
import { defineI18nScope } from './i18n-scope';
import {
  i18nScopesResolver,
  type I18nScopesSource,
} from './i18n-scopes.resolver';
import { I18nService } from './i18n.service';
import { provideI18nRuntime } from './provide-i18n';

@Injectable()
class EmptyLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

/** The shape every project uses: a dynamic import of bundled JSON (A2). */
const FIXTURE_SCOPE = defineI18nScope('fixture', {
  en: () => import('./__fixtures__/en.json'),
  ar: () => import('./__fixtures__/ar.json'),
});

function run(source: I18nScopesSource): Promise<boolean> {
  const result = TestBed.runInInjectionContext(() =>
    i18nScopesResolver(source)(
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot,
    ),
  );
  if (!isObservable(result)) throw new Error('expected an Observable');
  return firstValueFrom(result);
}

describe('i18nScopesResolver', () => {
  let i18n: I18nService;
  let consoleError: jest.SpyInstance;

  beforeEach(async () => {
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // No HttpClient provider: scopes are bundled chunks (requirement 1.4).
    TestBed.configureTestingModule({
      providers: [
        provideI18nRuntime({
          options: { storageKey: 'spec.lang', globalScopes: [] },
          initialLang: 'en',
          rootLoader: EmptyLoader,
          missingKeys: 'report',
          prodMode: true,
        }),
      ],
    });
    i18n = TestBed.inject(I18nService);
    await i18n.init();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('loads a JSON scope through dynamic import with no HttpClient provided', async () => {
    await expect(run(FIXTURE_SCOPE)).resolves.toBe(true);

    expect(i18n.translate('fixture.greeting.hello')).toBe('Hello');
  });

  it('loads the active language and English when Arabic is active', async () => {
    await i18n.setLanguage('ar');

    await expect(run([FIXTURE_SCOPE])).resolves.toBe(true);

    expect(i18n.translate('fixture.greeting.hello')).toBe('مرحبا');
    expect(i18n.translate('fixture.greeting.hello', {}, 'en')).toBe('Hello');
  });

  it('accepts a lazy source, as used for lazy libraries', async () => {
    await expect(run(() => Promise.resolve([FIXTURE_SCOPE]))).resolves.toBe(
      true,
    );
    expect(i18n.translate('fixture.greeting.hello')).toBe('Hello');
  });

  it('logs and still resolves true when the lazy import fails', async () => {
    await expect(
      run(() => Promise.reject(new Error('chunk failed'))),
    ).resolves.toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      '[i18n] Could not load route scopes.',
      expect.objectContaining({ message: 'chunk failed' }),
    );
  });

  it('loads a scope on a revisit after it failed on the first navigation', async () => {
    let calls = 0;
    const flaky = defineI18nScope('flaky', {
      en: () => {
        calls++;
        // The first navigation's load and its immediate retry both fail.
        return calls <= 2
          ? Promise.reject(new Error('chunk failed'))
          : import('./__fixtures__/en.json');
      },
      ar: () => import('./__fixtures__/ar.json'),
    });

    await expect(run(flaky)).resolves.toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      '[i18n] Could not load route scopes.',
      expect.objectContaining({ message: 'chunk failed' }),
    );
    expect(i18n.translate('flaky.greeting.hello')).toBe('');

    await expect(run(flaky)).resolves.toBe(true);
    expect(calls).toBe(3);
    expect(i18n.translate('flaky.greeting.hello')).toBe('Hello');
  });

  it('logs a wiring mistake under its own tag and still resolves true', async () => {
    const same = () => Promise.resolve({ a: 'A' });
    await expect(
      run(defineI18nScope('twin', { en: same, ar: same })),
    ).resolves.toBe(true);

    // A second, different definition under the same name (dev mode).
    await expect(
      run(defineI18nScope('twin', { en: same, ar: same })),
    ).resolves.toBe(true);

    expect(consoleError).toHaveBeenCalledWith(
      '[i18n:wiring] Route scopes are misconfigured.',
      expect.any(I18nError),
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      '[i18n] Could not load route scopes.',
      expect.anything(),
    );
  });

  it('logs and still resolves true when a scope fails to load', async () => {
    const broken = defineI18nScope('broken', {
      en: () => Promise.reject(new Error('missing chunk')),
      ar: () => Promise.reject(new Error('missing chunk')),
    });

    await expect(run(broken)).resolves.toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      '[i18n] Could not load route scopes.',
      expect.anything(),
    );
    // The page renders without that scope; its keys never show as raw keys.
    expect(i18n.translate('broken.anything')).toBe('');
  });
});
