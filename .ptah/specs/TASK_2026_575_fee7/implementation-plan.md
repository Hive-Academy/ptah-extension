# Implementation Plan - TASK_2026_575_fee7

Bilingual English/Arabic (RTL) i18n for `ptah-landing-page` on `@jsverse/transloco` 8.4.0, through a shared `scope:shared` library.

Verdict: build it as **bundled per-project scopes, loaded by resolvers before render**. Translations are imported as JSON chunks, with no HTTP loader and no asset copying. An app initializer loads the global scopes, and a route resolver loads each route's scope. A registry-driven switch loads every scope the session has used before it flips the active language. A committed inline pre-paint script sets `lang`/`dir`, and a Jest spec keeps it equal to the library's detection function. A custom `tools/i18n-check` Nx project handles the checks.

## Inputs and constraints

- Requirements used:
  - `context.md`: Gate 0, 1 and 1.7 decisions.
  - `task-description.md` rev 1: Gate 1 approved.
  - `task-description-review.md`: open items N12 and N13.
  - `design-spec.md` rev 2 and `prototype/`: Gate 1.7 approved.
  - `design-spec-review.md`: open items N22 and N23.
- Approved decisions encoded as-is, not reopened:
  - `@jsverse/transloco`.
  - Client-side toggle, same URLs.
  - Prerendered HTML stays English.
  - The whole landing app is in scope.
  - Agents draft the Arabic and the user signs it off before merge.
  - Western digits via `ar-u-nu-latn`.
  - Arabic-only "English version governs" notice on the three legal pages.
  - IBM Plex Sans Arabic, loaded only when Arabic is active.
- Corrections applied (review items handed to the architect):
  - N12: resolved in Component 9 (`SeoService` becomes key-based; OG and Twitter tags are always written from the English value).
  - N13: resolved in Component 6 (`data-app-stable` attribute).
  - N22: verified, see Codebase evidence.
  - N23: resolved in Components 12 and 13.
- Design handoff used: `design-spec.md` §2 (switcher, both skins), §3.1-3.9 (RTL policy, icons, LTR islands, UGC, 19 animated-section decisions, font, numbering, legal notice), and `prototype/tokens.css:12-56`.
- Conflicts between the design artifacts and the source, with their resolution:
  1. **`.ltr-island` display.** `prototype/tokens.css:17` adds `display: inline-block`, but the normative `design-spec.md` §3.3 does not.
     - Resolution: the spec wins, and the class carries no `display`.
     - Reason: `inline-block` on `<pre>` blocks changes layout. The one case that needs a box, the truncating email span, is already a flex item of the topbar cluster, so it is blockified (`design-spec-review.md` B7 details).
  2. **Key `common.language`.** In the design (§2.7) this key is owned by `libs/web/ui`. Every key in this plan is scope-qualified, so the key becomes `ui.common.language`. This is the same single key, owned by `ui`, used by both skins.
  3. **The design's `setLanguage()` returns `void`; this plan's returns `Promise<boolean>`** (Component 1). `selectLanguage()` still closes the menu and refocuses the trigger synchronously, as §2.2 specifies. It does not await the promise.
- Missing decision-critical input: none. There is no research report, because the library choice was settled in `context.md:27`.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `<html lang="en" data-theme="operator">`; Google Fonts links | `apps/ptah-landing-page/src/index.html:2`, `:85-91` | `dir="ltr"` is added statically. The pre-paint script goes before the font links. |
| SSG `outputMode: "static"`; `extract-i18n` target | `apps/ptah-landing-page/project.json:16`, `:89-94` | Server rendering must resolve every scope before render. `extract-i18n` serves `@angular/localize`, which is not used, so it is removed from this app (webview's copy is untouched). |
| Six prerendered routes; `**` is Client | `apps/ptah-landing-page/src/app/app.routes.server.ts:11-19` | Resolvers must block these six routes, on the server and in the first client render. |
| Full hydration with event replay; existing `APP_INITIALIZER` | `apps/ptah-landing-page/src/app/app.config.ts:44`, `:31-36` | The i18n initializer sits next to auth. The switcher clicks that event replay replays before hydration then run `setLanguage`. |
| `loadComponent` from lazy lib barrels; lint forbids static imports of lazy libs | `apps/ptah-landing-page/src/app/app.routes.ts:47-51`, `:82-90`, `:101-107`, `:131-136` | Scope definitions for lazy libs are reached with a **dynamic** `import('@ptah-web/x')` inside the resolver, the same module `loadComponent` already imports. |
| Route-table specs must not import `app.routes` (it drags in the marketing graph) | `apps/ptah-landing-page/jest.config.ts` (NOTE block), `apps/ptah-landing-page/src/app/app.routes.spec.ts:29-35` | The resolver is unit-tested in the library, not through the route table. |
| `scope:shared` may import only `scope:shared`; `scope:web` imports shared; `type:ui` imports `ui` and `util`; `type:util` imports only `util` | `eslint.config.mjs:256-258`, `:284-292`, `:379-384` | The new lib is `["scope:shared","type:util"]` and depends on npm only. The switcher UI lives in `web-ui` and `web-panel-ui`. |
| Precedent `scope:shared` Angular lib: provider factory, peers `package.json`, `@nx/dependency-checks` | `libs/frontend/markdown/project.json:7`, `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:475`, `libs/frontend/markdown/eslint.config.mjs` | The library shape and the `provideI18n()` factory follow this precedent. |
| `testing` secondary entry alias precedent | `tsconfig.base.json:97-99` (`@ptah-extension/core/testing` → `src/testing/index.ts`) | `@ptah-extension/i18n/testing` follows the same shape. |
| Local UI preference persisted with try/catch and validation | `libs/web/members/src/lib/services/member-theme.service.ts:85-108` | `LangPreferenceStore` uses the same guard pattern. |
| `SeoService.setPage` falls back from og to title/description; 6 callers pass literals synchronously in constructors | `libs/web/core/src/lib/services/seo.service.ts:35-56`; callers `libs/web/landing/src/lib/landing-page.component.ts:90`, `libs/web/pricing/src/lib/pricing-page.component.ts:58`, `libs/web/legal/src/lib/{terms-page.component.ts:400,privacy-page.component.ts:486,refund-page.component.ts:267}`, `apps/ptah-landing-page/src/app/pages/download/download-page.component.ts:403` | N12. The key-based API writes OG from English. Callers change in the same unit. |
| Visible text `>ptah.live<` on legal pages | `libs/web/legal/src/lib/privacy-page.component.ts:52,454`, `terms-page.component.ts:60,368`, `refund-page.component.ts:235` | The generic key-path regex from 3.5 would flag real copy, so the key-path check is anchored on the known scope names. |
| Feature libs never import each other; `panel-ui` is imported only by `admin` and `members`; `ui` and `core` are imported broadly | `grep "from '@ptah-web/<lib>'"` (run during planning) | Global scopes are `app`, `ui` and `core`. `panelUi` travels with `/members` and `/admin` only. |
| Nav-group collapse state is keyed by label | `libs/web/panel-ui/src/lib/panel-layout/panel-layout.ts:80-99`, `panel-layout.html:95` | Translated labels would reset the state on a switch, so it is re-keyed by group index (Component 13). |
| `[class.-rotate-90]` rotated chevron | `libs/web/panel-ui/src/lib/panel-layout/panel-layout.html:95` | N22 site. |
| **N22 verified:** `@angular/compiler@22.1.7` `parseTemplate('<i [class.rtl:rotate-90]="c">')` gives no errors and a class binding named `rtl:rotate-90` (BindingType 2). Tailwind 3.4.18 emits `.rtl\:rotate-90:where([dir="rtl"], [dir="rtl"] *)` from that source. | scratchpad run against the npm tarballs | Keep the design's binding verbatim. `rtl:` is a `:where([dir=rtl] *)` variant, so it **also matches inside `dir="ltr"` islands**. Inside islands, use logical utilities, never `rtl:`/`ltr:` variants. |
| Nav chevrons already use `[class.rotate-180]` on `<lucide-angular>` | `libs/web/ui/src/lib/navigation.component.ts:121,197,389` | Transforms work on the icon host, so `rtl:scale-x-[-1]` mirroring is viable. |
| Nav menu anchors | `navigation.component.ts:806` (`openMenu` union), `:900` (`toggleMenu`), `:920` (`closeMenuAndRefocus`), `:939` (`onDocumentClick`), `:468` (mobile `role="menu"`) | Header-skin wiring for design §2.2-2.3. |
| Topbar email spans | `libs/web/members/src/lib/member-layout/member-layout.html:21-25`, `libs/web/admin/src/lib/admin-layout/admin-layout.html:19-24` | B7 truncation plus N23 `[title]`. |
| Formatting sites: 58 `\| date` (Angular patterns such as `'medium'` or `'MMM d, HH:mm'`), 3 `\| number:'1.0-1'`, 1 `toLocaleString()`, 1 `Intl.RelativeTimeFormat('en')`, 1 `Intl.DateTimeFormat().resolvedOptions().timeZone` | grep over `libs/web`, `apps/ptah-landing-page/src` | A drop-in `i18nDate`/`i18nNumber` keeps every existing pattern string. The timezone read is not formatting, and is marker-exempted. |
| Angular `ar` locale data uses Latin number symbols (`"."`, `","`), and `formatDate` emits JS digits | `@angular/common@22.1.7/locales/ar.js` (symbols array); `types/common.d.ts:168` `formatDate(value, format, locale, timezone?)`, `:233` `formatNumber`, `:244` `registerLocaleData` | Angular formatting with `'ar'` already satisfies Western digits. Raw `Intl` calls use `ar-u-nu-latn`. |
| `ApplicationRef.whenStable(): Promise<void>`, `provideAppInitializer`, `provideEnvironmentInitializer` | `@angular/core@22.1.7` `types/_debug_node-chunk.d.ts:5832`, `types/core.d.ts:1986`, `:386` | Stability marker (N13), i18n initializer, locale-data registration. |
| Dependency floor: `@angular/compiler` 22.1.7, `ts-node`, `fast-glob`, `@playwright/test`; `parse5@8.0.1` exists only transitively (via jsdom) | `package.json:93,158,223,282`; `package-lock.json:32584` | Tooling reuses these. `parse5` is promoted to an explicit devDependency. |
| Tool-project precedent: `type:tool`, `nx:run-commands` with ts-node, self-test against a planted fixture, CI step | `tools/degradation-audit/project.json`, `tools/di-lint/run-self-test.js`, `.github/workflows/ci.yml:127-144` | `tools/i18n-check` copies this shape exactly. |
| CI runs only `affected -t test` and `-t build` | `.github/workflows/ci.yml:181-182`, `:192` | A new named `i18n-check` step is required (7.3). |
| Deploy assertion step | `.github/workflows/deploy-landing.yml:59-77` | Extended for 3.5. |
| E2E: backend-dependent `globalSetup`; a separate-config precedent for a special build | `apps/ptah-landing-page-e2e/src/support/global-setup.ts:57-80`, `apps/ptah-landing-page-e2e/playwright.checkout.config.ts` | The i18n suite gets its own config against the **static production build**, with no backend `globalSetup`. |
| `serve-static` target serves `dist/ptah-landing-page/browser` | `apps/ptah-landing-page/project.json` (`serve-static`) | This is the web server for the i18n e2e run. |
| Jest configs whitelist ESM packages per project | `libs/web/ui/jest.config.cts` (`transformIgnorePatterns`), `apps/ptah-landing-page/jest.config.ts`, `libs/frontend/markdown/jest.config.ts` | `@jsverse/utils` 1.0.0-beta.5 is `"type":"module"` `.js`, so `@jsverse` is added to every affected config. |
| `overflow-x: hidden` on the landing host | `libs/web/landing/src/lib/landing-page.component.ts:82` | The 4.5 check measures element geometry, not the page scrollbar. |
| Marquee builder | `libs/web/landing/src/lib/sections/builders/builders-section.component.ts:486-504` | The RTL sign flip is applied, and the marquee is rebuilt when the direction changes. |

### Transloco 8.4.0: verified vs assumed

Verified against `npm pack @jsverse/transloco@8.4.0` (`index.d.ts`, `fesm2022/jsverse-transloco.mjs`):

- The exports include:
  - `provideTransloco({config, loader?})`
  - `provideTranslocoMissingHandler`
  - `TranslocoPipe` (standalone, `pure: false`)
  - `translateSignal` / `translateObjectSignal`
  - `TranslocoService`, with `readonly activeLang: Signal<string>`, `load(path, {inlineLoader})`, `translate(key, params, lang)` and `setActiveLang`
  - `TranslocoTestingModule`
  - `TRANSLOCO_SCOPE`
- `ProviderScope = {scope, loader?: InlineLoader, alias?}`, where `InlineLoader = HashMap<() => Promise<Translation>>` (`lib/transloco.types.d.ts`).
- The inline loader unwraps `res.default` (`fesm2022:333`). A dynamic `import('./en.json')` therefore works as a loader.
- Inline-loader maps are keyed `scope/lang` (`prependScope`, `fesm2022:411-416`). The library's preload helper must build that key itself.
- `load()` caches a `shareReplay(1)` observable per path (`fesm2022:571-619`). After the first resolution it replays **synchronously**.
- `TranslocoPipe.transform` subscribes to the `BehaviorSubject` `langChanges$` and returns `lastValue` in the same call (`fesm2022:1375-1397`). Once the path is cached, the first render is already translated. This is the basis of the no-English-flash guarantee.
- Scope translations are merged into the lang map under `mappedScope.` (`setTranslation`). `getMappedScope` camel-cases unless `scopes.keepCasing` is set (`fesm2022:40`, `:975-976`). Scope names are therefore camelCase, and `keepCasing: true` is set.
- `handleSuccess` saves with `emitChange: false`. A scope that loads after render does **not** re-render views on its own. The design never relies on late loads, because loads always finish before render or before `setActiveLang`.
- `useFallbackTranslation` only takes effect for `lang !== firstFallbackLang`. `DefaultMissingHandler` returns the raw key and warns only in dev (`fesm2022:257-266`). A custom handler is required for 2.5.
- Transloco uses no `PendingTasks` or `TransferState`, and does no platform check except `getBrowserLang`. SSR correctness is the app's job, which is why the resolvers and the initializer below exist.
- `@jsverse/transloco-keys-manager@8.1.1` (the latest version):
  - peer `@angular/compiler >=21.1 <23`;
  - its keys-detective exits non-zero only for missing keys, or for extra keys behind a flag (`keys-detective/build-table.js:44-53`);
  - computed keys are skipped silently.

Assumptions, each with the check that resolves it:

- **A1.** The `@angular/build:application` esbuild pipeline bundles `import('./en.json')` (with `resolveJsonModule`) into a lazy chunk for both the browser and server builds.
  - Check: during F3, run `nx build ptah-landing-page` and grep `dist/ptah-landing-page/browser/*.js` for a unique en value.
  - Fallback (plan-level): the scope file imports each JSON statically inside its own per-language module (`en.ts`: `import en from './en.json'; export default en;`), and the loader dynamically imports that module.
- **A2.** Jest (jest-preset-angular 17) resolves `import('./en.json')` inside scope files.
  - Check: the F1 scope-loader spec, and the first lib spec that imports a scope.
- **A3.** A route resolver that returns an Observable completed by a native `import()` holds SSR/SSG until navigation ends. Angular's router registers the initial navigation as a pending task, so this does not depend on zone tracking of `import()`.
  - Check: F4 builds and asserts that prerendered `index.html` carries resolved English text, and the `prerender-check` passes.
- **A4.** The landing app reaches `ApplicationRef` stability in the browser. GSAP/Lenis rAF loops inside the Angular zone would prevent it and log NG0506 in dev.
  - Check: run the 3.6 spec in **English first**. If `data-app-stable` never appears in English, that is pre-existing, and the team-leader raises it before the Arabic run is judged.
- **A5.** `@if` branches that differ between the English prerender and the Arabic client render are handled by Angular's dehydrated-view cleanup without NG05xx. These are the check icon in the switcher and the legal notice.
  - Check: the 3.6 spec. On failure, the switcher's check icons become `[class.invisible]` toggles, a visual no-op.

## Architecture decision

- **Chosen approach:**
  - **(1) One shared library `@ptah-extension/i18n`** (`libs/frontend/i18n`, `scope:shared`, `type:util`). It owns:
    - the language list, directions and locales;
    - the detection rule;
    - persistence;
    - document `lang`/`dir`;
    - the Transloco configuration;
    - scope definition and loading;
    - route preloading;
    - the locale-aware pipes.

    It wraps Transloco, so consumers import only from `@ptah-extension/i18n`.
  - **(2) Per-project scopes bundled as JSON chunks.** Each project defines `defineI18nScope('<scope>', { en: () => import('./en.json'), ar: () => import('./ar.json') })`. Nothing is served over HTTP and there is no `assets` copying. That satisfies 1.4 (`file://` webview), 2.4 (bundled) and 2.3 (a lazy lib's JSON chunk is reachable only from that lib).
  - **(3) Load before render, everywhere.**
    - `provideI18n()` registers an app initializer. It resolves the language and loads the root plus the global scopes (`app`, `ui`, `core`) for the active language and `en`.
    - Each route declares `resolve: { i18n: i18nScopesResolver(...) }` for its feature scopes.
    - On the server this guarantees English text in the SSG output (3.5).
    - In the browser it guarantees the first client render emits the resolved language (3.6), because the pipe reads synchronously from the cache.
  - **(4) Atomic switching.**
    - `setLanguage(lang)` loads every scope registered so far, for `lang`, and only then calls `setActiveLang`. There is never a mixed-language frame, and no pipe falls back to English because a scope is missing.
    - Components use **fully-qualified keys** (`'pricing.hero.title' | transloco`) and do not use `provideTranslocoScope`.
  - **(5) An app-level pre-paint inline script** in `index.html`. It sets `lang`/`dir` and injects the Arabic font link before first paint. A Jest spec runs it in jsdom and proves it equals the library's `resolveInitialLang` across a fixture matrix (1.6).
  - **(6) Formatting.**
    - Impure, memoised `i18nDate`/`i18nNumber` pipes wrap Angular `formatDate`/`formatNumber` with `'en-US'`/`'ar'`, after `registerLocaleData(ar)`. They are drop-in: same arguments as `date`/`number`.
    - Raw `Intl` use takes `i18n.intlLocale()` (`'en-US'` or `'ar-u-nu-latn'`).
  - **(7) A custom `tools/i18n-check` Nx tool.** It follows the di-lint/degradation-audit precedent and provides:
    - a per-project `i18n-check` target: key parity, reference existence, the computed-key policy, glossary and placeholder parity, the RTL pattern, and banned raw formatting;
    - `prerender-check` (3.5);
    - `review-tables` (8.2);
    - a self-test in CI.
- **Rationale:**
  - Transloco facts verified above: synchronous cached replay, inline loaders unwrapping `default`, and no SSR support of its own. These make a "preload, then render" design both sufficient and necessary.
  - Blocking in the initializer and resolvers reuses the two gates Angular already holds for bootstrap and initial navigation. It avoids TransferState, which would not help an Arabic client of an English prerender anyway.
  - Bundled JSON removes a server-side HTTP loader. With a relative-URL loader during SSG, the HTTP loader is the documented raw-key risk (task-description risk row 3).
- **Rejected alternatives:**
  - **`TranslocoHttpLoader` plus per-lib `assets` globs.** It needs `HttpClient`, which violates 1.4 in the library. It needs absolute URLs, or a file-system shim during SSG, and 10 `assets` entries in `project.json:21-26`.
  - **Component-level `provideTranslocoScope` with lazy pipe loading.** A scope loaded after render never re-renders (`emitChange: false`), and the first client render shows `''`. That fails 3.6.
  - **TransferState of translations.** The prerender is English and the Arabic client needs `ar`, which is not in the transferred state. It adds complexity without removing the client load.
  - **`@jsverse/transloco-keys-manager` as the check.** It cannot fail on unannotated computed keys (7.2 requires failure), it is workspace-global rather than a per-project target, and it pins `@angular/compiler <23`. Its `marker()` idea is kept as a comment marker.
  - **`@jsverse/transloco-locale`.** It is a second locale mechanism beside Angular's. The existing 58 sites use Angular date patterns, and the drop-in `formatDate` keeps them verbatim.
  - **A build-time-generated pre-paint snippet.** It needs an index.html templating step the Angular builder lacks. A behavioural sync test satisfies 1.6 with no build change.
- **Assumptions:** A1-A5 above.
- **Effect on existing code:**
  - **Replaced:**
    - the `SeoService.setPage` config shape (6 callers);
    - every `| date`/`| number` in scope, replaced by `| i18nDate`/`| i18nNumber`;
    - physical Tailwind or CSS direction utilities;
    - literal UI strings;
    - `extract-i18n` in `apps/ptah-landing-page/project.json`;
    - `fontFamily.sans`.
  - **Left alone:**
    - `app.config.server.ts`, since `I18nService` is platform-aware;
    - `MEMBER_ROUTES`/`ADMIN_ROUTES` guards, since resolvers sit on the app-level parent routes;
    - `index.html` meta/OG/JSON-LD;
    - `apps/ptah-extension-webview`, including its `extract-i18n`.

## Component specifications

### 1. Shared i18n library `@ptah-extension/i18n`

- Purpose: define the language state, the direction handling and the Transloco setup once, for any Angular app in the workspace.
- Responsibilities (one file each):
  - `lang.config.ts`: pure data and helpers. No Angular.
    - `SUPPORTED_LANGS = ['en','ar'] as const` and `SupportedLang`.
    - `DEFAULT_LANG = 'en'`.
    - `isSupportedLang`.
    - `LANG_DIRECTION` (`en: 'ltr'`, `ar: 'rtl'`).
    - `ANGULAR_LOCALE` (`en: 'en-US'`, `ar: 'ar'`).
    - `INTL_LOCALE` (`en: 'en-US'`, `ar: 'ar-u-nu-latn'`).
    - `LANG_NATIVE_NAME` (`'English'`, `'العربية'`).
  - `resolve-initial-lang.ts`: `resolveInitialLang({ stored: string | null, languages: readonly string[] | undefined }): SupportedLang`.
    - If `stored` is a valid language, return it.
    - Otherwise, if `languages?.[0]` lower-cased starts with `'ar'`, return `'ar'`.
    - Otherwise return `'en'`.

    This is the literal 3.3 rule, and it is **the single source of truth** that the pre-paint script is tested against.
  - `lang-preference.store.ts`: `LangPreferenceStore`, with `read(): SupportedLang | null` and `write(lang): void`.
    - It uses `localStorage[options.storageKey]` and validates the value on read.
    - Every access is inside try/catch, and it is a no-op on the server (the pattern at `member-theme.service.ts:85-108`).
  - `i18n.service.ts`: `I18nService`.
    - Read-only signals: `lang`, `direction`, `locale` (Angular locale id) and `intlLocale`.
    - `init(): Promise<void>`.
    - `setLanguage(lang): Promise<boolean>`.
    - `loadScopes(scopes): Observable<void>`, which registers the scopes and loads root plus scopes for the active language and `en`, sequentially root-first.
    - `translate(key, params?)`, a thin wrapper for imperative TypeScript: toasts, `aria` text built in code.
    - It holds the scope registry, keyed by scope name. Registering the same name with a different loader object is a dev-mode error.
    - It applies `documentElement.lang`/`.dir` through `DOCUMENT`.
  - `i18n-scope.ts`:
    - `I18nScope` (= Transloco `ProviderScope` with `alias === scope`).
    - `defineI18nScope(scope: string, loaders: Record<SupportedLang, () => Promise<unknown>>)`. The type forces a loader for every supported language, and the scope must match `^[a-z][A-Za-z]*$`.
  - `i18n-scopes.resolver.ts`: `i18nScopesResolver(source: I18nScope | readonly I18nScope[] | (() => Promise<I18nScope | readonly I18nScope[]>)): ResolveFn<boolean>`.
  - `provide-i18n.ts`:
    - `I18N_OPTIONS` (`InjectionToken`).
    - `interface I18nOptions { storageKey: string; globalScopes: readonly I18nScope[] }`.
    - `provideI18n(options): EnvironmentProviders` combines:
      - `provideTransloco` with `availableLangs: SUPPORTED_LANGS`, `defaultLang: 'en'`, `fallbackLang: 'en'`, `reRenderOnLangChange: true`, `prodMode: !isDevMode()`, `failedRetries: 1`, `missingHandler: { useFallbackTranslation: false, logMissingKey: false, allowEmpty: false }` and `scopes: { keepCasing: true }`;
      - the internal `EmptyRootLoader`, which returns `{}` for root languages (all real content lives in scopes, and no `HttpClient` is involved);
      - `provideTranslocoMissingHandler(I18nMissingHandler)`;
      - `provideEnvironmentInitializer(() => registerLocaleData(localeAr, 'ar'))`;
      - `provideAppInitializer(() => inject(I18nService).init())`.
  - `i18n-missing.handler.ts` (internal):
    - When the active language is not `en`, it warns in dev (`[i18n] missing "<key>" in "<lang>"`) and returns the English value via `TranslocoService` (resolved lazily from `Injector`, to avoid a DI cycle), with a re-entrancy guard.
    - When the key is missing in English too, it warns in dev and returns `''` in prod, **never the key** (2.5).
  - `pipes/i18n-date.pipe.ts` (`i18nDate`, standalone, `pure: false`):
    - Signature `(value, format = 'mediumDate', timezone?)`, mirroring `DatePipe`.
    - It memoises on `(value, format, timezone, lang)` and calls `formatDate(value, format, ANGULAR_LOCALE[lang], timezone)`.
    - null, undefined and `''` return `null`.
  - `pipes/i18n-number.pipe.ts` (`i18nNumber`): same pattern over `formatNumber`, mirroring `DecimalPipe`.
  - Barrel `src/index.ts`, with explicit grouped exports under 150 lines (`CONVENTIONS.md:§3`). It re-exports `TranslocoPipe` and `translateSignal` from Transloco, so consumers never import `@jsverse/transloco` directly.
  - `src/testing/index.ts` (`@ptah-extension/i18n/testing`): `provideI18nTesting({ lang?: SupportedLang, translations: Record<string /*scope*/, Translation> })`.
    - It is `provideTransloco` with a **synchronous** `of()` root loader that nests each scope's JSON under its scope name, plus `I18nService` seeded with `lang`, plus the locale registration.
    - Specs import the real `en.json`, so existing English assertions keep passing.
- Verified contracts and entry points: see the Transloco "verified" list, `@angular/common` `formatDate`/`formatNumber`/`registerLocaleData` (`types/common.d.ts:168,233,244`), and `provideAppInitializer`/`provideEnvironmentInitializer` (`types/core.d.ts:1986,386`).
- Dependencies:
  - npm only: `@angular/core`, `@angular/common`, `@angular/router`, `@jsverse/transloco@8.4.0`, `rxjs`, all declared as peers in the library `package.json` (dependency-checks lint, as in the markdown precedent).
  - No workspace imports (1.2).
- Integration points:
  - `apps/ptah-landing-page` calls `provideI18n` and uses the resolvers.
  - Every `libs/web/*` project calls `defineI18nScope` and uses the pipes and `I18nService`.
  - The future webview reuses the library with its own `storageKey` and scopes, and no inline script.
- Failure behaviour:
  - Storage throws or holds an invalid value: `read()` returns `null`, detection applies, and `write()` is silently skipped (3.4, and the NFR security rule).
  - `init()` never rejects. If loading the resolved language fails, it retries with `en`, sets `lang`/`dir` back to `en`/`ltr`, and logs `console.error` once. Bootstrap continues.
  - `setLanguage` failure: the state is unchanged and the call returns `false`. For concurrent calls, the latest wins, via a request counter.
  - Resolver failure: it logs and resolves `true`, so navigation is never blocked. Text falls back to English through the missing handler.
- Quality requirements:
  - No timers, observers or listeners beyond the root service's lifetime.
  - The pipes allocate no `Intl` objects on a cache hit.
  - The stored value is validated against `SUPPORTED_LANGS` before use.
- Verification seam: unit specs in the library (1.4, 1.5, 2.5, 5.1, 5.2):
  - init with stored `ar`, with `navigator ['ar-EG']`, and with invalid stored `'xx'`;
  - a throwing storage getter and setter;
  - `setLanguage` updates `lang`, `dir`, `documentElement` and storage;
  - the resolver loads a static-import scope with **no `HttpClient` provided** (1.4);
  - the missing handler in dev and prod;
  - the pipes: `'MMM d, y'` in `ar` gives Arabic month names and ASCII digits (`/[٠-٩]/` absent), and the output updates after `setLanguage` without re-creating the pipe;
  - `provideI18nTesting` renders synchronously.
- Files: CREATE `libs/frontend/i18n/{project.json, package.json, CLAUDE.md, eslint.config.mjs, jest.config.ts, tsconfig.json, tsconfig.lib.json, tsconfig.spec.json}`, `libs/frontend/i18n/src/{index.ts, test-setup.ts}`, `libs/frontend/i18n/src/lib/{lang.config.ts, resolve-initial-lang.ts, lang-preference.store.ts, i18n.service.ts, i18n-scope.ts, i18n-scopes.resolver.ts, provide-i18n.ts, i18n-missing.handler.ts}`, `libs/frontend/i18n/src/lib/pipes/{i18n-date.pipe.ts, i18n-number.pipe.ts}`, `libs/frontend/i18n/src/testing/{index.ts, provide-i18n-testing.ts}`, plus a `*.spec.ts` beside each unit. MODIFY `tsconfig.base.json` (aliases `@ptah-extension/i18n` and `@ptah-extension/i18n/testing`), `package.json` and `package-lock.json` (`@jsverse/transloco` 8.4.0).
  - `project.json`: name `@ptah-extension/i18n`, tags `["scope:shared","type:util"]`, targets `test`/`lint`/`typecheck`, and no build target, consumed from source like the web libs.
  - `tsconfig.json`: adds `"resolveJsonModule": true`.
  - `jest.config.ts`: `transformIgnorePatterns` includes `@jsverse`.

### 2. i18n tooling `tools/i18n-check`

- Purpose: the committed, rerunnable checks behind 3.5, 4.1, 5.1, 6.2, 7.1-7.3, 8.1 and 8.2.
- Responsibilities (one entry point each, sharing `src/lib/*` helpers):
  - **`src/main.ts --project-root <p> --scope <s> [--allow-scope ui] --glossary <file>`**. This is the per-project `i18n-check` target. It exits 1 and names the file, line and key for every failure, across these rules:
    - **Parity (7.1):** the flattened key sets of `en.json` and `ar.json` are equal. Every value is a non-empty string.
    - **References (7.2):**
      - Templates (`.html` files and inline `template:`) are parsed with `@angular/compiler` `parseTemplate`. It collects every `transloco` pipe's first argument, from interpolations, bound attributes and control-flow expressions.
      - TypeScript is parsed with the `typescript` compiler API. It collects the first argument of `translate(`, `.translate(`, `translateSignal(` and `translateObjectSignal(`.
      - Literal keys, and **every string literal in the project that matches `^<scope>\.[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)+$`**, must exist in the owning scope's `en.json`. The owning scope is the project's own, or `ui` when `--allow-scope ui` is given.
      - Any other scope prefix fails (2.1).
    - **Computed keys (7.2):** a non-literal key argument passes only when one of these holds:
      - (a) Its receiver identifier ends in `I18N_KEYS`/`I18nKeys` (for example `STATUS_I18N_KEYS[s]` or `statusI18nKeys[s]`), and a `const <X>I18N_KEYS = {...} as const` exists in the project whose values are all string-literal keys. The values are checked by the literal scan.
      - (b) An `i18n-keys: <key> <key> …` comment, or an `i18n-keys: <prefix>.*` comment (the prefix must be a non-empty object in `en.json`), sits on the same line or the preceding line (`<!-- -->` in HTML, `//` in TS).

      Otherwise it fails with "unannotated computed key". A literal-scan false positive is silenced with `i18n-ignore: <reason>`.
    - **Placeholder and markup parity:** the `{{ param }}` sets match between `en` and `ar`. Tags present in a value are limited to `strong|em|code|a` and match between `en` and `ar`.
    - **Glossary (6.2):** for each `{term, reason}`, if the `en` value contains the term, the `ar` value contains it verbatim.
    - **Real Arabic (8.1):** every `ar` value contains at least one Arabic-script character (`؀-ۿ`). The only exception is an `en` value made up solely of glossary terms, placeholders, digits and punctuation, and in that case `ar === en` is required.
    - **RTL pattern (4.1):** the committed regex set in `src/lib/rtl-patterns.ts` covers:
      - every Tailwind utility listed in 4.1;
      - raw CSS in `styles`: `left:`, `right:`, `margin-left/right`, `padding-left/right` and `text-align: left|right`;
      - inline `[style.left]`, `[style.right]`, `style="left:` and `left: <number>` inside object literals.

      It runs over `.ts`, `.html` and `.css`. A match passes when it is:
      - (i) a centring pair on the same element or line (`(left|right)-1/2` with `-?translate-x-1/2`), which is the allow-list recorded in rev 1's N1 response; or
      - (ii) covered by an `rtl-exempt: <non-empty reason>` comment on the same line, the preceding line, or immediately before the start tag of the containing element. The element-start case exists because HTML comments cannot sit between attributes, and the parser's source spans locate the tag.
    - **Formatting (5.1):** it fails on `\|\s*(date|number|currency|percent)\b`, `toLocale(Date|Time)?String\(` and `Intl\.[A-Za-z]+\(` unless the line or the preceding line carries `i18n-format-exempt: <reason>`, or the first argument is an `intlLocale()` call.
  - **`src/prerender/check-prerender.ts --dist <dir> --baseline <dir> [--update]`** (3.5):
    - For each of the 6 routes, it reads `<dist>/<route>/index.html` and parses it with `parse5`.
    - It extracts the visible body text: text nodes outside `script`, `style`, `template` and `[data-i18n-switcher]` subtrees, with whitespace collapsed.
    - It asserts:
      - `<html>` has `lang="en"` and `dir="ltr"`;
      - there is no text node matching `^(app|ui|core|landing|legal|pricing|auth|account|members|admin|panelUi)\.[\w-]+(\.[\w-]+)*$` (the 3.5 regex, anchored on scope names because `>ptah.live<` is real copy);
      - there is no empty `h1` or `h2`;
      - the text equals `<baseline>/<route-slug>.json`, which holds `{ route, h1, text }`.
    - `--update` rewrites the baselines.
  - **`src/review/review-tables.ts --project-root <p> --scope <s> --glossary <g> --out <dir> [--check]`** (8.2):
    - It writes `<out>/<scope>.md`, a table of `key | English | Arabic | notes`, sorted by key.
    - Notes are computed deterministically: glossary terms present, placeholders, identical-to-English, legal notice.
    - It also writes `<out>/glossary.md`.
    - `--check` exits 1 if the committed output differs from a fresh generation.
  - **`run-self-test.js`:** runs `main.ts` against `__fixtures__/project/`. The fixture plants:
    - an `en` key missing from `ar`;
    - an unknown key;
    - an unannotated computed key;
    - an `ml-4`;
    - a `| date`.

    It passes only if the checker exits 1 **and** the output names all five. This is the degradation-audit discipline.
- Verified contracts: `parseTemplate` from `@angular/compiler@22.1.7` (run during planning); `typescript` 6.0.3 (`package.json:284`); `ts-node --transpile-only` invocation precedent (`tools/degradation-audit/project.json`).
- Dependencies: `@angular/compiler`, `typescript`, `fast-glob`, and `parse5` (a new explicit devDependency at the lockfile's `8.0.1`). The tool is Node-only and imports no project code.
- Integration points:
  - Every in-scope `project.json` gets an `i18n-check` target, added by that project's unit:

    ```
    "i18n-check": { "executor": "nx:run-commands", "options": { "command": "node_modules/.bin/ts-node --transpile-only --project tools/i18n-check/tsconfig.json tools/i18n-check/src/main.ts --project-root <root> --scope <scope> --allow-scope ui --glossary apps/ptah-landing-page/i18n-glossary.json", "cwd": "{workspaceRoot}" } }
    ```

    `ui` itself omits `--allow-scope`.
  - `nx.json` `targetDefaults["i18n-check"]` sets `cache: true` and `inputs: ["{projectRoot}/src/**/*", "{workspaceRoot}/tools/i18n-check/src/**/*", "{workspaceRoot}/apps/ptah-landing-page/i18n-glossary.json"]`.
  - The `ptah-landing-page` target `prerender-check` has `dependsOn: ["build"]`.
  - CI step (Component 11).
- Failure behaviour:
  - Every rule reports all violations, not only the first, and then exits 1.
  - Parse failures of a file are reported as failures, never skipped (degradation-audit precedent).
  - Exit 0 only when clean.
- Quality requirements:
  - A deterministic output order, so review tables regenerate byte-for-byte.
  - Runtime under about 10 s per project.
- Verification seam: `nx run i18n-check:self-test` (fixtures), plus the tool's own Jest spec over the `rtl-patterns` and key-extraction helpers (`tools/i18n-check/jest.config.ts`, `testEnvironment: node`).
- Files: CREATE `tools/i18n-check/{project.json, tsconfig.json, jest.config.ts, run-self-test.js}`, `tools/i18n-check/src/{main.ts}`, `tools/i18n-check/src/lib/{template-keys.ts, ts-keys.ts, translation-files.ts, rtl-patterns.ts, format-patterns.ts, glossary.ts, report.ts}` with specs, `tools/i18n-check/src/prerender/check-prerender.ts`, `tools/i18n-check/src/review/review-tables.ts`, `tools/i18n-check/__fixtures__/project/**`, `apps/ptah-landing-page/i18n-glossary.json`, `apps/ptah-landing-page/prerender-baseline/{home,download,pricing,terms-and-conditions,privacy,refund}.json`. MODIFY `nx.json` (targetDefaults), `package.json`/`package-lock.json` (`parse5` devDependency).
  - `project.json`: name `i18n-check`, tags `["type:tool"]`, targets `self-test` and `test`.
  - `i18n-glossary.json`: `[{ "term": "Ptah", "reason": "brand" }, …]`, seeded from 6.1. Showcase-manifest identifiers are rendered from the manifest data and never copied into translation values.
  - The six baseline JSON files are **captured from the unmodified templates before any lib unit runs**.

### 3. Scope scaffolding (every in-scope project)

- Purpose: give each of the 11 projects its own scope, so later per-lib work only fills in JSON and templates.
- Responsibilities:
  - Scope names:

    | Project | Scope |
    | --- | --- |
    | app | `app` |
    | `libs/web/ui` | `ui` |
    | `libs/web/panel-ui` | `panelUi` |
    | `libs/web/core` | `core` |
    | `libs/web/landing` | `landing` |
    | `libs/web/legal` | `legal` |
    | `libs/web/pricing` | `pricing` |
    | `libs/web/auth` | `auth` |
    | `libs/web/account` | `account` |
    | `libs/web/members` | `members` |
    | `libs/web/admin` | `admin` |

  - Files per library: `src/lib/i18n/en.json`, `src/lib/i18n/ar.json` (both `{}`) and `src/lib/i18n/<lib>.i18n-scope.ts`, which exports `<LIB>_I18N_SCOPE = defineI18nScope('<scope>', { en: () => import('./en.json'), ar: () => import('./ar.json') })`.
  - The app uses the same files under `apps/ptah-landing-page/src/app/i18n/`.
  - Barrel exports of the scope constant from each lib's `src/index.ts`. The panel-ui barrel's "authoritative count" comment is updated (`libs/web/panel-ui/src/index.ts:3-9`).
  - `members` additionally exports `MEMBERS_I18N_SCOPES = [MEMBERS_I18N_SCOPE, PANEL_UI_I18N_SCOPE]`, and `admin` exports `ADMIN_I18N_SCOPES` likewise.
  - `"resolveJsonModule": true` in each project's `tsconfig.json`. This is per project, not in `tsconfig.base.json`, so it does not invalidate every workspace project's Nx cache.
  - `@jsverse` is added to each project's Jest `transformIgnorePatterns`, closing the N8 risk.
- Verified contracts: lib `tsconfig.json` shape (`libs/web/ui/tsconfig.json`); Jest config shape (`libs/web/ui/jest.config.cts`); barrel precedent (`libs/web/core/src/index.ts`).
- Dependencies: Component 1.
- Integration points: Component 4 (the resolvers reference these constants).
- Failure behaviour: not applicable (static data). The scope-name regex in `defineI18nScope` throws in dev on a malformed name.
- Quality requirements: no translation content in the shared library (1.3).
- Verification seam: `nx run-many -t lint,test,typecheck` over all 11 projects stays green.
- Files: CREATE `libs/web/{ui,panel-ui,core,landing,legal,pricing,auth,account,members,admin}/src/lib/i18n/{en.json,ar.json,<lib>.i18n-scope.ts}` and `apps/ptah-landing-page/src/app/i18n/{en.json,ar.json,app.i18n-scope.ts}`. MODIFY each of those 10 libs' `src/index.ts`, `tsconfig.json` and `jest.config.cts`, plus `apps/ptah-landing-page/{tsconfig.json,jest.config.ts}`.

### 4. App i18n wiring (`apps/ptah-landing-page`)

- Purpose: turn the library on for the landing app, on both the server and the browser.
- Responsibilities:
  - `app.config.ts`: `provideI18n({ storageKey: LANDING_LANG_STORAGE_KEY, globalScopes: [APP_I18N_SCOPE, UI_I18N_SCOPE, CORE_I18N_SCOPE] })`, plus `provideArabicFontLoader()`.
  - `app.routes.ts`: add `resolve: { i18n: i18nScopesResolver(...) }` to each route:

    | Route(s) | Resolver argument |
    | --- | --- |
    | `''` | `LANDING_I18N_SCOPE` (static; `landing` is already eager, `app.routes.ts:3`) |
    | `pricing` | `() => import('@ptah-web/pricing').then(m => m.PRICING_I18N_SCOPE)` |
    | `login`, `signup` | the auth scope, loaded the same way |
    | `profile` | the account scope |
    | the 3 legal routes | the legal scope |
    | `members` | `MEMBERS_I18N_SCOPES` |
    | `admin` | `ADMIN_I18N_SCOPES` |

    `download` needs no resolver, because `app` is global. The resolvers go on the app-level routes, so `MEMBER_ROUTES`/`ADMIN_ROUTES` and their guard-policing specs are untouched.
  - `src/app/i18n/landing-i18n.constants.ts`:
    - `LANDING_LANG_STORAGE_KEY = 'ptah.lang'`, app-owned, so the library names no app.
    - `ARABIC_FONT_LINK_ID = 'ptah-font-ar'`.
    - `ARABIC_FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap'` (design §3.6).
  - `index.html`: `<html lang="en" dir="ltr" data-theme="operator">`, plus `<script id="ptah-i18n-prepaint">` as the first element after `<meta charset>`. The script is a minified IIFE with these literals: the key `'ptah.lang'`, `['en','ar']`, `{en:'ltr',ar:'rtl'}`, and the font id and href. It:
    - reads storage (try/catch);
    - validates the value;
    - otherwise tests `/^ar/i` on `navigator.languages && navigator.languages[0]`;
    - sets `documentElement.lang`/`.dir`;
    - when the result is `ar`, appends a `preconnect` to `fonts.gstatic.com` and `<link id="ptah-font-ar" rel="stylesheet" href=…>`.
  - `src/app/i18n/arabic-font.loader.ts`: `provideArabicFontLoader()`, an environment initializer holding a browser-only root `effect` on `I18nService.lang()`. When the language is `ar` and `#ptah-font-ar` is absent, it appends the same link. It runs once per page, and the effect's lifetime is the app.
  - `src/styles.css`, copied from `prototype/tokens.css:12-56` without `display: inline-block` (see the conflict resolution above):
    - `.ltr-island { direction: ltr; unicode-bidi: isolate; text-align: left; }`;
    - the `[lang='ar']` metrics rules: line-height, tracking and uppercase neutralisation, and `font-synthesis-weight: none`.
  - `tailwind.config.js:74`: `sans: ['Inter', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'system-ui', '-apple-system', 'sans-serif']` (design §3.6 B6).
  - `project.json`: remove `extract-i18n` (`:89-94`), and add `i18n-check` (scope `app`) and `prerender-check`.
- Verified contracts: `provideAppInitializer` and `provideEnvironmentInitializer` (Angular core types). Route `resolve` with a `ResolveFn` is standard `@angular/router` API: Assumption A3 covers only its SSR blocking.
- Dependencies: Components 1 and 3. `web-ui` and `web-core` scopes are imported statically (they are eager already).
- Integration points:
  - The pre-paint result and `I18nService.init()` must agree: the sync spec below.
  - `SeoService` (Component 9) reads the English values after the resolvers.
- Failure behaviour:
  - When JavaScript is disabled, the pre-paint script is inert, and the static `lang="en" dir="ltr"` stays (3.5).
  - If the font request fails, the stack falls through to Noto Sans Arabic or the system font.
  - Storage throws inside the script: it is caught, and detection applies.
- Quality requirements:
  - The script is under 1 KB.
  - English visitors never request the Arabic font (4.6, and the risk row).
  - CSP: the landing app has none today (review Feasibility §2). If `autoCsp` is ever enabled, Angular hashes this inline script.
- Verification seam:
  - `src/app/i18n/pre-paint-script.spec.ts` (1.6):
    - It reads `src/index.html` with `readFileSync` (precedent `app.routes.spec.ts:1`) and extracts `#ptah-i18n-prepaint`.
    - It evaluates the script in a fresh jsdom document per case, over the matrix: stored ∈ {`en`, `ar`, `xx`, null, throws} × languages ∈ {`['ar']`, `['ar-EG','en']`, `['AR']`, `['en-US']`, `['fr']`, `[]`, undefined}.
    - For every case it asserts `lang`/`dir` equal `resolveInitialLang(...)` and `LANG_DIRECTION`.
    - It asserts the script contains `LANDING_LANG_STORAGE_KEY`, `ARABIC_FONT_LINK_ID` and `ARABIC_FONT_HREF` verbatim, and that the font link exists exactly when the result is `ar`.
  - `arabic-font.loader.spec.ts`: the link is appended once, and not for `en`.
  - Build: `nx build ptah-landing-page` succeeds, then `nx run ptah-landing-page:prerender-check` (3.5, 2.4).
- Files: MODIFY `apps/ptah-landing-page/src/{index.html, styles.css}`, `apps/ptah-landing-page/src/app/{app.config.ts, app.routes.ts}`, `apps/ptah-landing-page/{tailwind.config.js, project.json}`. CREATE `apps/ptah-landing-page/src/app/i18n/{landing-i18n.constants.ts, arabic-font.loader.ts, arabic-font.loader.spec.ts, pre-paint-script.spec.ts}`.

### 5. Hydration and prerender contract (cross-cutting rules)

- Purpose: stop the English prerender and the Arabic client render from diverging structurally.
- Responsibilities (rules every lib unit follows):
  1. The server language is always `en` (`I18nService.init` short-circuits on the server platform).
  2. Text changes only through bindings (`| transloco`, `translateSignal`). A template does not branch structurally on language, except for the legal governing-language notice and the switcher's check icons (A5).
  3. Services return **keys**, not translated strings (for example error keys from `libs/web/core` services), and templates translate them, so a later language switch re-renders them.
  4. Inputs carry already-translated text: `PanelLayout` `title`, `badgeLabel` and nav labels are translated by their owner (`members`, `admin`), never by `panel-ui`.
  5. `[innerHTML]` is allowed only for legal-page paragraphs whose value contains the tag allow-list (`strong|em|code|a`). Angular's sanitizer still applies. Router links are never placed inside translated HTML.
  6. Only `ar` is detected. Showcase-manifest identifiers, prices and versions stay outside translation values.
- Verification seam: the 3.6 e2e spec (Component 15); `i18n-check` markup parity.
- Files: none. This is a contract for Components 12-14.

### 6. App-stable marker (N13 resolution)

- Purpose: give Playwright an observable signal for "ApplicationRef reports stable after hydration", because `getAllAngularTestabilities` is absent (`app.config.ts` has no Protractor testing support).
- Responsibilities: `markAppStable(appRef: ApplicationRef, doc: Document): Promise<void>` awaits `appRef.whenStable()`, then sets `documentElement.setAttribute('data-app-stable', 'true')`. `main.ts` calls it on the resolved `ApplicationRef` from `bootstrapApplication(...)`. It is not called from an initializer, because the zone can report stable before bootstrap.
- Verified contracts: `ApplicationRef.whenStable(): Promise<void>` (`@angular/core@22.1.7` `_debug_node-chunk.d.ts:5832`).
- Dependencies: none beyond Angular.
- Integration points: `main.ts`; the e2e helper waits on `html[data-app-stable]`.
- Failure behaviour: if the app never becomes stable (A4), the attribute never appears, and the e2e times out with a clear message. That is a visible failure, not a silent pass.
- Quality requirements: browser-only. `main.server.ts` is untouched.
- Verification seam: `app-stable-marker.spec.ts` (a fake `ApplicationRef` with a resolved `whenStable` sets the attribute); the e2e.
- Files: CREATE `apps/ptah-landing-page/src/app/i18n/{app-stable-marker.ts, app-stable-marker.spec.ts}`. MODIFY `apps/ptah-landing-page/src/main.ts`.

### 7. Locale-aware formatting rollout

- Purpose: meet 5.1-5.3 at the roughly 64 sites.
- Responsibilities:
  - Replace `| date:'…'` with `| i18nDate:'…'` and `| number:'…'` with `| i18nNumber:'…'`, arguments unchanged.
  - `Intl.RelativeTimeFormat('en', …)` becomes `new Intl.RelativeTimeFormat(this.i18n.intlLocale(), …)`, recomputed per call or in a `computed`.
  - `toLocaleString()` becomes the matching pipe, or `Intl` with `intlLocale()`.
  - `Intl.DateTimeFormat().resolvedOptions().timeZone` gets `i18n-format-exempt: timezone lookup, not formatting`.
  - Prices (5.3): the pricing unit splits `'$29/mo'` into an `.ltr-island` amount (`$29`), untranslated, and a translated suffix key (`pricing.plan.perMonth`). The numeric value never enters a translation.
- Verified contracts: Component 1 pipes; the Angular `ar` data (Latin symbols).
- Dependencies: Component 1. Executed inside each lib unit.
- Failure behaviour: invalid dates throw as `DatePipe` does today, so behaviour is unchanged.
- Verification seam: `i18n-check` formatting rule (zero raw sites per project); pipe unit specs; lib component specs where they already assert dates.
- Files: inside the lib units' files.

### 8. RTL conversion rollout

- Purpose: meet 4.1-4.4 per design §3.
- Responsibilities (per lib unit):
  - Physical to logical: `ml`→`ms`, `mr`→`me`, `pl`→`ps`, `pr`→`pe`, `left`→`start`, `right`→`end`, `text-left`→`text-start`, `rounded-l`→`rounded-s`, `border-l`→`border-s`, and so on.
  - `space-x-*` becomes `gap-*`, or `rtl:space-x-reverse`.
  - Non-centring `translate-x`, `bg-gradient-to-l/r` and `origin-left/right` get paired `rtl:` variants.
  - Raw CSS becomes `inset-inline-start/end`, `margin-inline-*`, `padding-inline-*` and `text-align: start/end`.
  - Direction-bearing icons (`ArrowRight`, `ArrowLeft`, `ChevronRight`, `ChevronLeft`, `LogOut`) get `rtl:scale-x-[-1]`. `ExternalLink`, `Download` and brand marks do not. Literal `→`/`←` characters in strings become icon components.
  - `.ltr-island` goes on every `font-mono`, code, CLI, email, URL, license-key, file-path and version element. Block islands (`comparison-tug-meter`, the `problem-section` SVG) take `dir="ltr"`, and contain **no** `rtl:`/`ltr:` variants (Tailwind's `rtl:` still matches inside them, per the evidence row).
  - UGC gets `dir="auto"` at the rendering element (members community, admin moderation).
  - Exemptions get `rtl-exempt: <reason>` with the design's reasons (§3.1, §3.5).
- Verification seam: `i18n-check` RTL rule (zero unexempted matches); the 4.5 e2e for `landing`.
- Files: inside the lib units' files.

### 9. SeoService, key-based (N12 resolution)

- Purpose: 3.7. The runtime `<title>` and description follow the active language, while `og:*`, `twitter:*` and the canonical link stay English and testable.
- Responsibilities:
  - `SeoConfig` becomes `{ titleKey: string; descriptionKey: string; url: string; ogTitleKey?: string; ogDescriptionKey?: string; ogImage?: string }`. The old `title`, `description`, `ogTitle` and `ogDescription` literal fields are **removed**, not kept as an alternative.
  - `setPage(config)` runs synchronously, preserving the constructor-time SSG contract at `seo.service.ts:20-28`:
    - (a) It writes `og:title`, `og:description`, `twitter:title` and `twitter:description` from `translate(ogKey ?? key, {}, 'en')`, which is always English because the scopes load `en` alongside the active language.
    - (b) It writes the canonical link, `og:url`, `og:type` and `og:image` as today.
    - (c) It writes `<title>` and `meta[name=description]` from the active language.
    - (d) It stores the config.
  - A root `effect` on `I18nService.lang()` re-applies only (c) for the stored config.
- Verified contracts: `seo.service.ts:35-68` (current behaviour); the 6 callers listed in Codebase evidence.
- Dependencies: `web-core` (`type:util`) → `@ptah-extension/i18n` (`type:util`, `scope:shared`), which is allowed (`eslint.config.mjs:284-292`, `:383-384`).
- Integration points: callers move their strings into their scope as `<scope>.seo.title` and `<scope>.seo.description`, plus `ogTitle`/`ogDescription` for `pricing` only (`pricing-page.component.ts:63-65` has distinct OG copy).
- Failure behaviour: a missing key goes through the missing handler, which gives English or `''` and never a raw key. On the server the language is `en`, so the SSG head is English.
- Verification seam: `seo.service.spec.ts`:
  - with `provideI18nTesting({ lang: 'ar', … })`, the title and description are Arabic while og and twitter are English;
  - after `setLanguage('en')` the title is English and og is unchanged.
- Files: MODIFY `libs/web/core/src/lib/services/seo.service.ts`, CREATE `libs/web/core/src/lib/services/seo.service.spec.ts`, MODIFY the 6 caller files (the `setPage` blocks only), and the `en.json`/`ar.json` of `core`, `landing`, `legal`, `pricing` and `app` for the SEO keys.

### 10. Language switcher, header skin (`libs/web/ui`)

- Purpose: design §2.2-2.3 and 2.5-2.7, plus 3.1 and 3.8.
- Responsibilities:
  - `NavigationComponent`: widen the `openMenu` union with `'lang'` (`navigation.component.ts:806`, `:900`).
  - Add the design §2.2 desktop trigger and menu. The menu is anchored `start-0`, uses `menuitemradio`, and each option carries its own `lang`/`dir`.
  - Add `selectLanguage(lang)`: it calls `setLanguage`, closes the menu and refocuses `#lang-menu-trigger`.
  - Add the design §2.3 mobile `role="group"` row.
  - The trigger `aria-label` is `languageCode() + ' — ' + ('ui.common.language' | transloco) + ': ' + LANG_NATIVE_NAME[lang]`.
  - Switcher wrappers carry `data-i18n-switcher`, so the 3.5 extraction ignores them.
  - Extract the rest of `ui`'s strings: navigation, footer, countdown, session calendar.
  - Convert RTL. `console-grid-background` is `rtl-exempt`.
- Verified contracts: `closeMenuAndRefocus` (`:920`), `onDocumentClick` (`:939`), mobile `role="menu"` (`:468`), `#community-menu` styling (`:204-206`).
- Dependencies: Components 1 and 3; the `ui` scope owns `ui.common.language`.
- Failure behaviour: if `setLanguage` resolves `false`, the menu has already closed and the selection is unchanged (`aria-checked` reflects the actual `lang()`).
- Quality requirements: WCAG 2.5.3 label-in-name; Escape and outside-click semantics unchanged.
- Verification seam: `navigation.component.spec.ts`:
  - opening the menu, selecting `ar`, `document.documentElement.dir === 'rtl'`, and focus back on the trigger;
  - Escape closes the menu without changing the language;
  - the options' `lang` attributes.
- Files: MODIFY `libs/web/ui/src/lib/**` (components, their specs), `libs/web/ui/src/lib/i18n/{en,ar}.json`, `libs/web/ui/project.json` (`i18n-check`).

### 11. CI and deploy gates

- Purpose: 7.3 and 3.5 (deploy half).
- Responsibilities:
  - **`.github/workflows/ci.yml`:** insert after the degradation-audit step (`:141-144`) a step named `i18n-check (translation parity, key references, RTL and formatting patterns)`:

    ```
    node_modules/.bin/nx run i18n-check:self-test
    node_modules/.bin/nx affected -t i18n-check
    ```

  - **`.github/workflows/deploy-landing.yml:59-77`:** inside the existing loop, add:
    - `grep -Eq '<html[^>]*\blang="en"'` and `grep -Eq '<html[^>]*\bdir="ltr"'`;
    - a per-route known-English-headline grep from a bash associative array (`[index.html]=…`, and so on), filled from the committed baselines' `h1`;
    - a failing grep for `>[[:space:]]*(app|ui|core|landing|legal|pricing|auth|account|members|admin|panelUi)\.[A-Za-z0-9_.-]+[[:space:]]*<`.
- Verified contracts: step anchors `ci.yml:141-144`, `:181-182`; `deploy-landing.yml:59-77`.
- Failure behaviour: `::error::` plus a non-zero exit, as the existing `fail()` helper does.
- Verification seam: a PR that adds an `en` key without `ar` fails the named CI step (QA plants it on a throwaway branch).
- Files: MODIFY `.github/workflows/ci.yml` and `.github/workflows/deploy-landing.yml`.

### 12. Per-lib translation units (feature libs)

- Purpose: 2.1, 2.2, 4.x, 5.x, 6.x and 8.1 for each feature project.
- Responsibilities (per lib):
  - Extract every user-visible string (template text, `aria-*`/`title`/`placeholder`/`alt`, toasts and validation built in TypeScript) into the lib's scope. Templates use `| transloco`; TypeScript uses `translateSignal` or `I18nService.translate` at event time.
  - Draft the Arabic.
  - Rules 5.1-5.6 (Component 5), Component 7, Component 8.
  - Update the lib's specs to `provideI18nTesting({ translations: { <scope>: en, ui: uiEn } })`.
  - Add the `i18n-check` target.
  - Generate `copy-review/<scope>.md`.
- Lib-specific requirements:
  - **landing:**
    - The design §3.5 table, row by row.
    - `builders-section`'s `buildMarquee()` negates `from`/`to` when `direction() === 'rtl'`, and rebuilds the marquee (killing the previous tween, as the release path) on a direction change.
    - `problem-section` swaps `slideRight`/`slideLeft` by direction, and its SVG chart is a `dir="ltr"` island.
    - `comparison-tug-meter` gets a `dir="ltr"` block.
    - The `console/*` diagrams keep their chronology and are exempt.
    - `waitlist-form` uses `start-3.5`.
    - `device-frame` is converted to logical utilities.
  - **legal:**
    - The three pages move into the `legal` scope. Paragraphs with inline emphasis or links use allow-listed `[innerHTML]` (rule 5).
    - `@if (i18n.lang() === 'ar')` wraps the design §3.8 notice `{{ 'legal.governingLanguageNotice' | transloco }}` below `<h1>` on all three routes (8.4).
    - `falling-cubes-background` is `rtl-exempt`.
  - **pricing:** the price split (Component 7).
  - **auth:** `auth-hero.component.ts:173-184` raw CSS is converted to `inset-inline-*` (design §3.5 row).
  - **account:** the 2 formatting sites; license keys and emails are `.ltr-island`.
  - **core:** service messages become keys (rule 3). Handled in the CORE unit together with Component 9.
- Failure behaviour: the lib's `i18n-check` must exit 0 before its unit closes.
- Verification seam: `nx run-many -t lint,test,typecheck,i18n-check -p <lib>`; review-table `--check`.
- Files: all within that lib's folder, plus its `copy-review/<scope>.md` in the task folder.

### 13. Panel switcher and panel shell (`libs/web/panel-ui`)

- Purpose: design §2.4, 2.5a and 2.6 (panel skin), §3.2 N16/N22 exception, and B7.
- Responsibilities:
  - Create `LanguageSwitch` (selector `ptah-language-switch`, standalone, **not exported** from the barrel, because only `PanelLayout` renders it). It follows design §2.4:
    - `role="radiogroup"`;
    - roving `tabIndex`;
    - `onGroupKeydown`, with direction-aware Left/Right and direction-independent Up/Down, reading `I18nService.direction()`;
    - `focus-visible:outline-base-content`;
    - a check icon on the selected option;
    - each option's `aria-label` `'EN — ' + ('ui.common.language' | transloco) + ': English'`.
  - `panel-layout.html`: replace the `<header>` (`:17-…`) with the normative design §2.4 markup (outer `flex-wrap`, `min-w-0`, `truncate`, `shrink-0 whitespace-nowrap`, `<ptah-language-switch />` after `<ng-content select="[panelTopBar]" />`).
  - Chevron at `:95`: add `[class.rtl:rotate-90]="isCollapsed(i)"` next to `[class.-rotate-90]` (N22 verified).
  - Re-key `collapsedGroups` by group index (`panel-layout.ts:80-99`), so collapse state survives the labels changing language.
  - Other `panel-ui` strings (`menuLabel` default, `EmptyState`, `DetailDrawer`, `SelectionToolbar`) and the 1 formatting site.
- Verified contracts: `panel-layout.ts:80-99`, `panel-layout.html:17-19` and `:95`; `MemberThemeToggle` styling vocabulary (design §1).
- Dependencies: Components 1 and 3; the `ui` scope key (global).
- Failure behaviour: as in Component 10.
- Verification seam: `language-switch.spec.ts`:
  - ArrowRight in `rtl` selects `en` and ArrowRight in `ltr` selects `ar`;
  - `tabIndex` follows the selection;
  - `aria-checked`;
  - label-in-name.

  `panel-layout.spec.ts`: collapse state survives a language switch.
- Files: CREATE `libs/web/panel-ui/src/lib/language-switch/{language-switch.ts, language-switch.spec.ts}`. MODIFY `libs/web/panel-ui/src/lib/panel-layout/{panel-layout.html, panel-layout.ts}` and the other panel-ui components and specs, `libs/web/panel-ui/src/lib/i18n/{en,ar}.json`, `libs/web/panel-ui/project.json`.

### 14. Member and admin shells (part of the MEM-1 and ADM-1 units)

- Purpose: B7 email truncation plus N23, and owner-side translation of the shell inputs.
- Responsibilities:
  - `member-layout.html:24` and `admin-layout.html:22`: `<span class="font-mono text-xs ltr-island truncate max-w-[7rem] sm:max-w-none" [title]="email">{{ email }}</span>` (N23: `[title]` added, matching the sidebar precedent at `member-layout.html:48`).
  - Nav configs (`member-nav.config.ts`, the admin equivalent) hold keys, named `*_I18N_KEYS` or marker-annotated.
  - The layouts pass translated `title`, `badgeLabel` and nav labels via `computed` over `I18nService.lang()`.
- Verification seam: the existing `member-layout` and `admin-layout` specs, updated with the testing provider.
- Files: within `libs/web/members/src/lib/member-layout/**`, `libs/web/members/src/lib/member-nav.config.ts` and `libs/web/admin/src/lib/admin-layout/**`.

### 15. E2E suite for i18n (`apps/ptah-landing-page-e2e`)

- Purpose: 3.1, 3.2, 3.6, 2.3, 4.5 and 7.5.
- Responsibilities:
  - `playwright.i18n.config.ts` (precedent `playwright.checkout.config.ts`):
    - `testDir: ./src/specs-i18n`;
    - `webServer: npx nx run ptah-landing-page:serve-static --port=4400`, which builds production and serves the **prerendered** output;
    - **no** backend `globalSetup`;
    - `workers: 1`.
  - `src/support-i18n/i18n.ts`, the helpers:
    - `captureFirstFrameDir(page)` (`addInitScript`: `requestAnimationFrame(() => window.__firstFrameDir = document.documentElement.dir)`);
    - `collectHydrationMessages(page)` (console messages matching `/NG05\d\d/`);
    - `waitForAppStable(page)` (`html[data-app-stable="true"]`);
    - `seedLang(page, 'ar')` (an init script that sets `localStorage['ptah.lang']`; the key is asserted equal to the app constant by Component 4's sync spec).
  - `language-switch.spec.ts` (3.1, 3.2, 3.8 keyboard):
    - Set `window.__noReload = 1`, switch through the header menu with the keyboard only, and assert: the `h1` is Arabic (`/[؀-ۿ]/`), `html[lang=ar][dir=rtl]`, the URL is unchanged and `__noReload` is still set.
    - Reload and assert the page is still Arabic.
    - Repeat on the mobile viewport, and on `/members`, which is skipped when no member fixture is available, because this suite has no backend.
  - `prepaint-hydration.spec.ts` (3.6), for each of the 6 prerendered routes, twice (a seeded `ar` preference, and `locale: 'ar-EG'` with empty storage):
    - `__firstFrameDir === 'rtl'`;
    - there are no NG05xx messages;
    - after `waitForAppStable`, no visible text node in `<main>` (fallback `body`) equals the route baseline's `h1`;
    - the `h1` matches Arabic.

    An English control run of the same routes must pass first (A4).
  - `lazy-scopes.spec.ts` (2.3): load `/`, collect every JS response body, and assert none contains a sentinel unique to `admin` or `members` `en.json` (for example the admin scope's `seo`/nav root value, chosen by the ADM-1 unit).
  - `rtl-layout.spec.ts` (4.5): in `ar` at 375, 768 and 1440, for every landing section:
    - `scrollWidth <= clientWidth` on the landing host and the section;
    - every text-bearing element's bounding rect lies within `[0, viewportWidth]`;
    - there is no pairwise overlap of heading and paragraph boxes inside a section;
    - it attaches a screenshot per section and width (`testInfo.attach`).

    Pixel baselines are deliberately not used, because the GSAP sections animate.
  - `project.json`: target `e2e:i18n`. `tsconfig.spec.json`: include the new config.
- Verified contracts: e2e project shape (`apps/ptah-landing-page-e2e/project.json`, `playwright.config.ts`); the `serve-static` target.
- Assumption:
  - Check that `@nx/web:file-server` serves `/pricing` from `pricing/index.html`, not the SPA fallback. The spec asserts that the first response body contains the baseline `h1` text.
  - If it does not, the config's `webServer` uses a static-directory server command instead.
- Failure behaviour: a timeout on `data-app-stable` reports A4. It must not be retried into a pass.
- Verification seam: `nx run ptah-landing-page-e2e:e2e:i18n`. The existing `e2e` suite runs unchanged in English (7.5).
- Files: CREATE `apps/ptah-landing-page-e2e/playwright.i18n.config.ts`, `apps/ptah-landing-page-e2e/src/specs-i18n/{language-switch,prepaint-hydration,lazy-scopes,rtl-layout}.spec.ts`, `apps/ptah-landing-page-e2e/src/support-i18n/i18n.ts`. MODIFY `apps/ptah-landing-page-e2e/{project.json, tsconfig.spec.json}`.

### 16. Arabic copy delivery (process component)

- Purpose: 8.1-8.4, and the Gate 0 decision that the user reviews every scope.
- Responsibilities:
  - Each lib unit drafts the Arabic, runs `i18n-check`, and generates `.ptah/specs/TASK_2026_575_fee7/copy-review/<scope>.md` plus `glossary.md` with `review-tables`.
  - The PR for a scope lists the table path.
  - The user's sign-off is recorded as a PR review or comment, or as a line `- <scope>: approved by <user>, <date>, <PR>` in `.ptah/specs/TASK_2026_575_fee7/copy-review/SIGNOFF.md`. The **team-leader blocks the merge of any PR that contains a scope without that record**, admin included.
  - Glossary edits after F2 are appended by the team-leader. Lib units report new terms in their report, but do not edit `i18n-glossary.json`. That keeps lib units file-disjoint, and adding a term never breaks an existing check.
  - The legal notice copy is the design §3.8 draft, in the user's review like every other key.
- Verification seam: `review-tables --check` per scope; the presence of `SIGNOFF.md` or PR sign-off before merge.
- Files: CREATE `.ptah/specs/TASK_2026_575_fee7/copy-review/{<scope>.md…, glossary.md, SIGNOFF.md}`. The first two are generated; `SIGNOFF.md` is user and team-leader owned.

## Integration architecture

- **Data flow, first load (browser, stored `ar`):**
  1. The pre-paint script sets `lang="ar" dir="rtl"` and injects the font link.
  2. The prerendered English paints in RTL. This is the allowed window.
  3. `main.ts` bootstraps.
  4. The `provideI18n` initializer runs `resolveInitialLang` and gets `ar`. It loads root `ar`, root `en` and `app`/`ui`/`core` for `ar` and `en`, then calls `setActiveLang('ar')`.
  5. The router's initial navigation runs the guards, then `i18nScopesResolver`, which loads `landing` for `ar` and `en`.
  6. Route components are created and hydrated. The `transloco` pipe reads synchronously, so the first client render is Arabic.
  7. `whenStable` fires and `data-app-stable` is set.
- **Data flow, server (SSG):** `init` sets `en` and loads the global scopes' `en`. The resolver loads the route scope's `en`. The component constructor calls `SeoService.setPage` (keys resolved in English). The HTML is serialised with `lang="en" dir="ltr"`.
- **Data flow, switch:** a click calls `setLanguage('en')`. It loads root and every registered scope (all cached), then `setActiveLang`, then sets the `lang` signal, writes the document attributes, and persists to the store. The pipes re-render (`reRenderOnLangChange`), the date and number pipes recompute, the `SeoService` effect re-applies the title, and the font loader effect is a no-op for `en`.
- **State and persistence:**
  - `I18nService` is root-provided and holds the `lang` signal and the scope registry for the app's lifetime.
  - Transloco holds the translation cache.
  - `localStorage['ptah.lang']` holds only an explicit choice. Detection results are never persisted, so 3.3 re-applies next time.
- **External boundaries:**
  - The stored value is validated against `SUPPORTED_LANGS` in both the library and the inline script.
  - `navigator.languages` is only prefix-tested.
  - Translation values are repo-owned. They render through escaped interpolation, and the `[innerHTML]` exception goes through Angular's sanitizer with a check-enforced tag allow-list.
  - Google Fonts is a stylesheet link with no script and no timeout, and fails over to fallback fonts.
- **Failure and rollback:**
  - Runtime failures are listed per component. No failure blocks bootstrap or navigation.
  - Rollback:
    - Each lib unit is a separate PR, and reverting one re-English-es that lib: its keys disappear and its templates go back to literals.
    - Reverting F3/F4 restores English-only behaviour.
    - A stale stored `ptah.lang` is then an unused key, and harmless.
    - Prerendered HTML is English throughout, so SEO is unaffected by any revert.
- **Observability:**
  - Dev: `[i18n] missing "<key>" in "<lang>"` warnings.
  - Always: a single `console.error` on a scope load failure, naming the scope and language.
  - CI: the `i18n-check` step output names the file, line and key.
  - Deploy: `::error::prerender assertion failed: …`.
  - E2E: attached per-section screenshots and the collected NG05xx messages.

## Architecture-level quality requirements

- **Functional:**
  - All acceptance criteria 1.1-8.4 map to a component and a seam. See the handoff AC column.
  - The prerendered text of the six routes is byte-equal to the baselines (after whitespace normalisation) apart from switcher markup.
- **Performance:**
  - `/` fetches only the `app`, `ui`, `core` and `landing` chunks for the active language plus `en`.
  - The initial bundle growth is only the library, Transloco and the `ar` locale data (about 10 KB), within the 1 MB warning budget (`project.json` production budgets).
  - No impure pipe allocates an `Intl` object on a cache hit.
- **Security:**
  - Stored preferences are validated.
  - There are no string-built HTML sinks except the sanitised, allow-listed legal `[innerHTML]`.
  - No new network origin beyond `fonts.googleapis.com` and `fonts.gstatic.com`, which are already used.
- **Maintainability:**
  - `@ptah-extension/i18n` has zero workspace dependencies (1.2).
  - Consumers never import `@jsverse/transloco` directly.
  - One scope per project.
  - Scope names are camelCase and equal to the key prefix.
  - The barrel stays under 150 lines.
  - No `V2` or legacy `SeoConfig`.
- **Testability:**
  - Library behaviour is covered by unit specs.
  - The pre-paint/library equivalence is proven by the jsdom matrix spec.
  - The check tool is proven by its self-test fixture.
  - The prerender contract is proven by `prerender-check`.
  - Hydration, switching, lazy scopes and RTL layout are proven by the `e2e:i18n` suite.
  - Every translated component spec uses `provideI18nTesting` with real `en.json`.

## Team-leader handoff

- **Recommended executors:**
  - `backend-developer`-style TypeScript developer for F1 (library logic, no UI) and F2a/F2b (Node tooling).
  - `frontend-developer` for F3, F4, CORE and every lib unit (Angular templates, Tailwind RTL, GSAP).
  - `senior-tester` for E2E. It needs Playwright and the static build.
  - The copy drafting inside each lib unit is done by that unit's frontend developer, and reviewed by the user (8.3).
- **Complexity: HIGH.** Eleven projects and about 141 components, an SSG and hydration contract, a new shared library, and a custom AST-based checker.
- **Dependencies and ordering (component-level):**
  - F1 → F2a → F2b → F3 → F4 → CORE → the lib units.
  - The lib units are mutually file-disjoint across libs and are parallel-safe, up to 3 at a time.
  - Within a lib, sub-units are sequential, because they share the lib's `en.json`/`ar.json`.
  - E2E runs last. It needs UI, PANEL, APP, LND-1, LND-2, LEG and PRC.
  - F2b's baseline capture **must** run before any unit that edits templates.
- **Parallel-safe work:** after CORE, any 3 of {UI, PANEL, APP, LND-1→LND-2, LEG, PRC, AUTH, ACC, MEM-1→MEM-2→MEM-3, ADM-1→ADM-2→ADM-3→ADM-4}, taking one chain per lib.

### Work units (ordered)

| # | Unit | Files (summary; full paths in the components above) | Depends on | AC |
| --- | --- | --- | --- | --- |
| F1 | Shared i18n library (Component 1) | `libs/frontend/i18n/**`, `tsconfig.base.json`, `package.json`, `package-lock.json` | — | 1.1, 1.2, 1.3, 1.4, 1.5, 2.5, 5.1, 5.2 (unit level) |
| F2a | Check tool: translation, reference, computed-key, glossary, 8.1 rules; review tables; self-test; CI step; glossary seed (Components 2 and 11 CI half) | `tools/i18n-check/**` (except `src/prerender`), `nx.json`, `.github/workflows/ci.yml`, `apps/ptah-landing-page/i18n-glossary.json` | F1 (package.json is sequential) | 6.2, 7.1, 7.2, 7.3, 8.2 |
| F2b | Check tool: RTL and formatting rules, `check-prerender` plus `parse5`; **capture the prerender baselines from the unmodified templates**; extend `deploy-landing.yml` | `tools/i18n-check/src/{lib/rtl-patterns.ts, lib/format-patterns.ts, prerender/**}`, `package.json`, `package-lock.json`, `apps/ptah-landing-page/prerender-baseline/*.json`, `.github/workflows/deploy-landing.yml` | F2a | 3.5 (script, deploy), 4.1 (pattern committed), 5.1 (regression rule) |
| F3 | Scope scaffolding for all 11 projects (Component 3) | `*/src/lib/i18n/*` (created), each project's `src/index.ts`, `tsconfig.json`, Jest config | F1 | 2.2, 2.4 (A1 check), N8 |
| F4 | App wiring, pre-paint, font, styles, Tailwind stack, stable marker (Components 4 and 6) | `apps/ptah-landing-page/src/{index.html, main.ts, styles.css}`, `src/app/{app.config.ts, app.routes.ts}`, `src/app/i18n/*`, `tailwind.config.js`, `project.json` | F2b, F3 | 1.6, 2.3 (wiring), 2.4, 3.3, 3.4, 3.5 (`prerender-check` passes), 3.6 (mechanism), 4.6 |
| CORE | `SeoService` key-based plus the 6 callers' `setPage` blocks and SEO keys; `core` service messages become keys; `web-core` `i18n-check` target (Components 9 and 12 core) | `libs/web/core/**`, the 6 caller files (`setPage` block only), SEO keys in the `landing`, `legal`, `pricing` and `app` JSON | F4 | 3.7, N12 |
| UI | Header switcher plus the rest of `ui` (Component 10) | `libs/web/ui/**` | CORE | 3.1, 3.8, 4.1, 4.2, 4.3, 2.1 |
| PANEL | Panel switcher, header markup, chevron N22, collapse re-key, the rest of `panel-ui` (Component 13) | `libs/web/panel-ui/**` | CORE | 3.8, 4.1, 4.2, 5.1, N22 |
| APP | Download page strings and RTL; app `i18n-check` | `apps/ptah-landing-page/src/app/pages/**`, `src/app/i18n/{en,ar}.json`, `project.json` | CORE | 2.1, 4.1, 4.3 |
| LND-1 | Landing: hero, problem, pillars, comparison (meter island), builders (marquee flip and rebuild) | `libs/web/landing/src/lib/sections/{hero,problem,pillars,comparison,builders}/**`, the landing i18n JSON | CORE | 4.1, 4.2, 4.5, 2.1 |
| LND-2 | Landing: `console/*`, cta, also-available, provider-strip, video-showcase, `landing-page.component`; landing `i18n-check` target | the remaining `libs/web/landing/src/lib/**`, the landing i18n JSON, `libs/web/landing/project.json` | LND-1 | 4.1, 4.3, 4.5, 6.1, 8.1 |
| LEG | Legal: 3 pages, `innerHTML` policy, governing notice, falling-cubes exempt | `libs/web/legal/**` | CORE | 8.4, 4.1, 2.1, 8.1 |
| PRC | Pricing: price split, pricing grid | `libs/web/pricing/**` | CORE | 5.3, 4.1, 2.1 |
| AUTH | Auth: pages, hero raw CSS | `libs/web/auth/**` | CORE | 4.1, 2.1 |
| ACC | Account: profile and related, 2 formatting sites | `libs/web/account/**` | CORE | 5.1, 4.3, 2.1 |
| MEM-1 | Members: scope strings for `member-layout` (Component 14), `member-nav.config.ts`, account, hub, notifications, packs, search, shared, services and state | `libs/web/members/src/lib/{member-layout, account, hub, notifications, packs, search, shared, services, state}/**`, `member-nav.config.ts`, the members i18n JSON | CORE, PANEL | 4.3, 5.1, N23, 2.1 |
| MEM-2 | Members: community (UGC `dir="auto"`), live | `libs/web/members/src/lib/{community,live}/**`, the members i18n JSON | MEM-1 | 4.4, 5.1 |
| MEM-3 | Members: learning; members `i18n-check` target | `libs/web/members/src/lib/learning/**`, the members i18n JSON, `libs/web/members/project.json` | MEM-2 | 5.1, 8.1 |
| ADM-1 | Admin: `admin-layout` (Component 14), nav keys, `admin-list`, `admin-detail`, overview, `components/*` modals and data-table (the `→` literals become icons) | `libs/web/admin/src/lib/{admin-layout, admin-list, admin-detail, overview, components}/**`, `admin-models.config.ts`, the admin i18n JSON | CORE, PANEL | 4.2, 5.1, N23 |
| ADM-2 | Admin: groups, users, waitlist, failed-webhooks, services' user messages | `libs/web/admin/src/lib/{groups, users, waitlist, failed-webhooks, services}/**`, the admin i18n JSON | ADM-1 | 5.1 |
| ADM-3 | Admin: marketing, `builders/packs` | `libs/web/admin/src/lib/{marketing, builders/packs}/**`, the admin i18n JSON | ADM-2 | 5.1 |
| ADM-4 | Admin: `builders/{courses, community, sessions}` (UGC `dir="auto"`); admin `i18n-check` target | `libs/web/admin/src/lib/builders/{courses, community, sessions}/**`, the admin i18n JSON, `libs/web/admin/project.json` | ADM-3 | 4.4, 5.1, 8.1 |
| E2E | i18n Playwright suite (Component 15) | `apps/ptah-landing-page-e2e/**` (new files plus `project.json` and `tsconfig.spec.json`) | UI, PANEL, APP, LND-2, LEG, PRC | 2.3, 3.1, 3.2, 3.6, 4.5, 7.5 |

Every lib unit also closes with these acceptance items:

- 2.1 (own scope only, plus `ui`);
- 6.1 and 6.2 (the glossary check passes);
- 7.4 (`nx run-many -t lint,test,typecheck,i18n-check` for that project);
- 8.1 (real Arabic);
- 8.2 (`copy-review/<scope>.md` generated and `--check` clean).

8.3 is a merge gate, not a unit acceptance criterion.

- **Verification points:**
  - Confirm A1 during F3/F4: a unique `en` value is found in a lazy chunk; the server build succeeds.
  - Confirm A2 during F1.
  - Confirm A3 during F4: `prerender-check` passes with **zero** key paths and an unchanged text baseline.
  - Confirm A4 and A5 in E2E, English control first.
  - Honour the `SeoConfig` replacement in one unit (CORE). No dual API.
  - `members.routes.spec.ts` and `admin` route specs must stay untouched and green; resolvers live only in `app.routes.ts`.
  - Commands that must pass by the end:
    - `nx run-many -t lint,test,typecheck -p @ptah-extension/i18n ptah-landing-page web-ui web-panel-ui web-core web-landing web-legal web-pricing web-auth web-account web-members web-admin`;
    - `nx affected -t i18n-check`;
    - `nx run i18n-check:self-test`;
    - `nx build ptah-landing-page`;
    - `nx run ptah-landing-page:prerender-check`;
    - `nx run ptah-landing-page-e2e:e2e:i18n`;
    - the existing `nx run ptah-landing-page-e2e:e2e` in English, with its backend (7.5).

### Risks and rollback

| Risk | Likelihood | Impact | Mitigation / owner |
| --- | --- | --- | --- |
| The app never reaches stability because zone macrotasks (GSAP, Lenis) keep it busy. That means NG0506, no `data-app-stable`, and deferred hydration cleanup (A4) | MEDIUM | HIGH | Run the English control first in E2E. If it fails, the team-leader opens a separate fix (run the animation loops outside the zone) before the 3.6 Arabic run is judged. |
| esbuild or Jest will not bundle dynamic JSON imports (A1, A2) | LOW | HIGH | Checked in F1 and F3. The fallback is a per-language TS module wrapper, a change confined to the scope files. |
| A structural `@if` difference between the English prerender and the Arabic client triggers NG05xx (A5) | LOW | MEDIUM | 3.6 E2E. The switcher's check icons fall back to class toggles. The legal notice is the only necessary branch. |
| A scope loaded after render does not refresh views (`emitChange: false`) | Addressed by design | HIGH | Loads happen only in the initializer, the resolver, or before `setActiveLang`. The fully-qualified-key rule means no late component-level scope loads. |
| The literal-scan key rule flags a non-key string that starts with a scope name | MEDIUM | LOW | `i18n-ignore: <reason>` marker. The self-test covers a false positive. |
| `rtl:` variants misfire inside `dir="ltr"` islands (Tailwind's `:where([dir=rtl] *)`, verified) | MEDIUM | MEDIUM | Rule in Component 8: islands contain logical utilities only. The 4.5 geometry checks catch leaks. |
| Missed strings at scale (~141 components) | HIGH | MEDIUM | The per-lib `i18n-check` reference rule, plus the reviewer's grep for literal template text in each unit. 3.5 baselines guard the prerendered routes. |
| Agent-drafted Arabic legal text is read as binding | MEDIUM | HIGH | The §3.8 notice (8.4) plus the sign-off gate (8.3). |
| Arabic font flash for returning Arabic visitors | MEDIUM | LOW | The pre-paint script injects the font before first paint. `display=swap`. |
| The Nx cache ripples from adding path aliases to `tsconfig.base.json` | CERTAIN | LOW | A one-time affected-all CI run in F1. `resolveJsonModule` is kept per project so the ripple does not repeat. |

**Rollback:**

- Per-lib units revert independently: the lib goes back to English literals, and its `i18n-check` target leaves with it.
- F4 revert: remove `provideI18n`, the resolvers and the pre-paint script, which restores the current app exactly.
- F1 and F3 revert last.
- The prerendered HTML is English in every state, so crawlers see no change at any step, and a stored `ptah.lang` becomes an inert key.
