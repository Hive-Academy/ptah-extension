# @ptah-extension/i18n

## Purpose

English/Arabic (RTL) internationalisation for any Angular app in the workspace,
built on `@jsverse/transloco` 8.4.0. It owns the language list, directions and
locales, the initial-language rule, persistence of the visitor's choice, scope
definition and loading, and the Transloco setup. Consumers import only from
`@ptah-extension/i18n` (and `@ptah-extension/i18n/testing` in specs), never from
`@jsverse/transloco` directly.

Tags `scope:shared`, `type:util`. No build target: consumed from source.

## Rules

- **npm only.** No workspace imports. Peers: `@angular/core`, `@angular/common`,
  `@angular/router`, `@jsverse/transloco`, `rxjs`. No `HttpClient`: translations
  are bundled JSON chunks, so the library works under `file://`.
- **`resolveInitialLang` is the single source of truth** for the detection rule
  (stored valid language, else first browser language starting with `ar`, else
  `en`). The landing app's pre-paint inline script is tested against it; change
  both together.
- **Storage is best effort.** `LangPreferenceStore` validates on read, wraps
  every access in try/catch and is a no-op on the server.
- **Scopes** are declared once per project:

  ```ts
  export const PRICING_I18N_SCOPE = defineI18nScope('pricing', {
    en: () => import('./en.json'),
    ar: () => import('./ar.json'),
  });
  ```

  Names match `^[a-z][A-Za-z]*$` (dev mode throws otherwise). The alias always
  equals the name, and templates use fully-qualified keys
  (`'pricing.hero.title' | transloco`), never `provideTranslocoScope`.
  The scope-name guard runs in dev mode only; it catches authoring mistakes and
  does not validate input at runtime.

- **Load before render.** `provideI18n` loads the global scopes in an app
  initializer; each route loads its feature scopes with
  `resolve: { i18n: i18nScopesResolver(...) }`; `setLanguage` loads every
  registered scope before it switches. Transloco never re-renders for a late
  scope load, so nothing may rely on one.
- **Scope loading is ours.** `I18nService` runs each scope's loader itself
  (one immediate retry, concurrent callers share one call) and stores the
  result with `setTranslation(t, 'scope/lang', { emitChange: false })`, so keys
  read `scope.key`. A loaded `scope/lang` is remembered; a failed one is not, so
  the next `setLanguage`, route visit or English retry calls the loader again.
  Only the (empty) root translations go through `TranslocoService.load`.
- **Missing keys never show the key.** A key missing in Arabic renders its
  English value; missing in English too, it renders `''` (dev warns).
- **Errors.** Everything this library throws is an `I18nError`. Errors from
  outside (a failed chunk `import()`, Transloco's `TranslationLoadError`) pass
  through unchanged. `init()` and the resolver never reject: they log and carry
  on in English; `setLanguage` resolves `false` and changes nothing. The
  resolver logs an `I18nError` (a wiring mistake such as two scopes under one
  name) as `[i18n:wiring]`, apart from ordinary load failures.

- **Arabic digits stay Western**: Angular formatting uses `ANGULAR_LOCALE`, raw
  `Intl` uses `INTL_LOCALE` (`ar-u-nu-latn`).
- Services return user-facing text as `I18nMessage` (`{ key, params? }`), not as
  a rendered string.

## Specs (`@ptah-extension/i18n/testing`)

Canonical recipe: always pass the global scopes (`ui`, `core`, plus `app` in app
specs) next to the owning scope, because shared chrome and `I18nMessage`s from
`core` services render keys of those scopes, and a key missing from every
provided language fails the spec (N13):

```ts
import coreEn from '<core>/i18n/en.json';
import uiEn from '<ui>/i18n/en.json';
import pricingEn from '../i18n/en.json';

TestBed.configureTestingModule({
  providers: [
    provideI18nTesting({
      translations: { en: { pricing: pricingEn, ui: uiEn, core: coreEn } },
    }),
  ],
});
```

- Translations are per language (N14). For an Arabic spec pass both, so the same
  key resolves in `ar` and, with `translate(key, {}, 'en')`, in `en`:
  `provideI18nTesting({ lang: 'ar', translations: { en: {...}, ar: {...} } })`.
- Rendering is synchronous: the first `detectChanges()` shows translated text.
  The seeded language touches neither storage nor `<html lang/dir>`.
- A missing key throws an `I18nError` at once from TypeScript
  (`I18nService.translate`, `translateSignal`). Through the `transloco` pipe it
  fails the test at TestBed teardown, because the pipe translates inside an RxJS
  subscription. Only the first missing key of a test is reported there; fix it
  and rerun to see the next.
- Jest configs of consuming projects must transform `@jsverse` and
  `@angular/common/locales` (see this lib's `jest.config.ts`).

## Layout

```
src/
├── index.ts                     # barrel, grouped explicit exports
├── lib/
│   ├── lang.config.ts           # pure data: langs, directions, locales
│   ├── resolve-initial-lang.ts  # the detection rule
│   ├── lang-preference.store.ts # localStorage persistence
│   ├── i18n-scope.ts            # defineI18nScope, scopeLoadPath
│   ├── i18n-message.ts          # I18nMessage
│   ├── i18n.error.ts            # I18nError, the root error class
│   ├── i18n-options.ts          # I18nOptions, I18N_OPTIONS
│   ├── i18n.service.ts          # I18nService: lang signals, init, setLanguage
│   ├── i18n-scopes.resolver.ts  # i18nScopesResolver for routes
│   ├── i18n-missing.handler.ts  # English fallback, never the raw key
│   ├── provide-i18n.ts          # provideI18n + the shared Transloco runtime
│   └── pipes/                   # i18nDate, i18nNumber
└── testing/
    └── provide-i18n-testing.ts  # provideI18nTesting
```

Tasks: `.ptah/specs/TASK_2026_575_fee7/implementation-plan.md`, Component 1.
