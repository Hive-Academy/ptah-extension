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

- **Arabic digits stay Western**: Angular formatting uses `ANGULAR_LOCALE`, raw
  `Intl` uses `INTL_LOCALE` (`ar-u-nu-latn`).
- Services return user-facing text as `I18nMessage` (`{ key, params? }`), not as
  a rendered string.

## Layout

```
src/
├── index.ts                     # barrel, grouped explicit exports
└── lib/
    ├── lang.config.ts           # pure data: langs, directions, locales
    ├── resolve-initial-lang.ts  # the detection rule
    ├── lang-preference.store.ts # localStorage persistence
    ├── i18n-scope.ts            # defineI18nScope, scope load paths
    └── i18n-message.ts          # I18nMessage
```

Tasks: `.ptah/specs/TASK_2026_575_fee7/implementation-plan.md`, Component 1.
