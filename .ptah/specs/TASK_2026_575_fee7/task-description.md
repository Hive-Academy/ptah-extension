# Requirements - TASK_2026_575_fee7

## Context

`ptah-landing-page` (Angular 22.1.7, Nx 23.2.1, Tailwind 3.4 + DaisyUI 4) is English-only. `<html lang="en" data-theme="operator">` is hard-coded (`apps/ptah-landing-page/src/index.html:2`), fonts are Inter + JetBrains Mono with no Arabic glyphs (`index.html:85-89`), and the only i18n artefact is the generator-default `extract-i18n` target (`apps/ptah-landing-page/project.json:89`). Six marketing routes are prerendered (SSG) and everything else is client-rendered (`apps/ptah-landing-page/src/app/app.routes.server.ts:11-19`). Almost all UI lives in `libs/web/*` (`@ptah-web/*`, tag `scope:web`); the app shell itself holds 2 components.

The user wants the site bilingual in English and Arabic, starting with the landing app, with an Nx-idiomatic per-app/per-lib setup that the Electron renderer (`apps/ptah-extension-webview`, `scope:webview`) can adopt later. Settled before this document (see `context.md`, not re-opened here): library `@jsverse/transloco`; language chosen client-side and remembered locally, same URLs, no `/ar/` routes, prerendered HTML stays English; the whole landing app is in scope (marketing, legal, auth, account, members/sessions, contact, admin, shared header/footer); agents draft Arabic copy and the user reviews it before merge.

Surface inventory (grep-based, approximate; non-spec files):

| Project | Tag | Components | Directional-class hits (`ml-/mr-/pl-/pr-/left-/right-/text-left/…`) | Locale-formatting sites (`date`/`currency`/`number` pipes, `toLocale*`, `Intl`) | Title/Meta calls |
| --- | --- | --- | --- | --- | --- |
| `apps/ptah-landing-page` | scope:landing, type:app | 2 | 0 | 1 | 1 |
| `libs/web/landing` | scope:web, type:feature | 20 | ~24 | 0 | 3 |
| `libs/web/legal` | scope:web, type:feature | 4 | ~15 | 0 | 0 |
| `libs/web/pricing` | scope:web, type:feature | 3 | 0 | 0 (prices are literal strings, e.g. `'$29/mo'` at `pricing-grid.component.ts:643`) | 1 |
| `libs/web/auth` | scope:web, type:feature | 8 | ~15 | 0 | 3 |
| `libs/web/account` | scope:web, type:feature | 12 | ~4 | 2 | 0 |
| `libs/web/members` | scope:web, type:feature | 33 | ~14 | 22 | 21 |
| `libs/web/admin` | scope:web, type:feature | 46 | ~27 | 49 | 22 |
| `libs/web/ui` | scope:web, type:ui | 5 | ~7 | 0 | 0 |
| `libs/web/panel-ui` | scope:web, type:ui | 8 | ~7 | 1 | 0 |
| `libs/web/core` | scope:web, type:util | 0 (services, guards, `SeoService` at `libs/web/core/src/lib/services/seo.service.ts`) | 0 | 0 | 14 |

Roughly 140 components, ~115 directional utility usages, ~75 locale-formatting sites, and ~74 files containing code/`<pre>`/`font-mono` content. An existing precedent for a locally persisted UI preference is `MEMBER_THEME_STORAGE_KEY = 'ptah.members.theme'` (`libs/web/members/src/lib/services/member-theme.service.ts:22`), which already guards `localStorage` throwing in private mode.

## Classification

- Type: FEATURE — adds a language capability and a new UI control; no existing behaviour is replaced.
- Estimate: XL — ~140 components across 10 projects need string extraction, RTL conversion and Arabic copy, plus a new shared library, a new switcher, font loading and a CI check.
- Priority: not defined here.

## Scope

In scope:

- A new framework-level i18n Nx library (scope:shared) that both `scope:web` and, later, `scope:webview` may import.
- Transloco wiring in `apps/ptah-landing-page` (browser and server/prerender configs).
- Per-lib translation scopes and `en` + `ar` translation files for every project in the inventory table.
- Extraction of all user-visible strings in those projects: template text, `aria-*`/`title`/`placeholder`/`alt` attributes, toast/validation/error messages built in TypeScript, document titles set at runtime.
- A language switcher in the shared header (and wherever the member/admin shells have their own chrome), with persistence and first-visit detection.
- RTL: `lang`/`dir` on `<html>`, conversion of physical-direction Tailwind utilities in in-scope files to logical equivalents, mirroring of direction-bearing icons, LTR islands.
- An Arabic webfont.
- Locale-aware date/number formatting at the existing formatting sites.
- A translation-completeness check target wired into CI.
- Agent-drafted Arabic copy for all keys, flagged for user review.
- A designer/prototype step (Gate 1.7) for the switcher and the RTL treatment before architecture.

Out of scope:

- Adopting i18n in `apps/ptah-extension-webview` / Electron / VS Code webview: a follow-up task. This task only makes sure the shared library is usable there (see 1.4).
- Locale URLs (`/ar/…`), hreflang, localized sitemap, prerendering Arabic HTML, and localized `index.html` meta/OG/Twitter tags, canonical, `llms.txt` and `robots.txt`: the user decided on a client-side toggle only (Gate 0).
- Backend and transactional emails, the license server, and `libs/api/*`: server-side, a separate task.
- Localizing the Paddle checkout overlay and other third-party widgets: third-party UI; revisit in a follow-up if Paddle's locale option is wanted.
- Translating user-generated content (member posts, topics, names): it is data, not UI copy. Only its rendering direction is in scope (3.4).
- Storing language preference server-side on the user profile: the decision was local persistence.
- `apps/ptah-docs`, `video-studio` and other apps: not requested.
- Languages other than `en` and `ar`: not requested. The design must not preclude a third language, but no third language is delivered.
- Removing the `extract-i18n` targets: not requested. Whether to keep them is for the architect to decide and state.

## Requirements

### 1. Shared i18n library

Requirement: Angular apps in the workspace — one reusable, framework-level i18n foundation — so language state, direction handling and the Transloco setup are defined once and reused by the landing page now and the webview later.

Proposed placement (the architect may adjust the path; the tags and constraints below are requirements): `libs/frontend/i18n`, import path `@ptah-extension/i18n`, tags `["scope:shared", "type:util", "platform:angular"]`. This follows the precedent of `@ptah-extension/markdown` (`libs/frontend/markdown`, `scope:shared`). `scope:shared` is importable by `scope:web`, `scope:landing` and `scope:webview` under the current `depConstraints` (`eslint.config.mjs:254-290`).

It must contain: the supported-language list and types (`en`, `ar`), each language's direction, an Angular provider/factory that configures Transloco given app-supplied options (loader, available langs, default lang, persistence key), an active-language state readable as a signal, the logic that applies `lang`/`dir` to the document root, preference persistence with safe fallback, first-visit detection, and locale-aware formatting helpers or re-exports if the architect chooses them. It may contain truly generic common keys (e.g. "Cancel", "Close", "Loading") only if the architect decides they are shared across both products.

It must not contain: landing- or webview-specific strings, routes, components with product styling, imports from any `scope:web`, `scope:landing` or `scope:webview` project, `localStorage` keys naming the landing app, or assumptions of HTTP-served assets (the webview loads from `file://`).

Acceptance criteria:

1. When `nx lint` runs over the workspace, the system shall report no `@nx/enforce-module-boundaries` violations. The new library's `project.json` shall carry the `scope:shared` tag and a `type:*` tag.
2. When the new library's source is searched for imports of `@ptah-web/`, `@ptah-landing` or webview-scoped aliases, the search shall return no matches.
3. When the new library's source and assets are searched for any key or string from a landing lib's translation file, other than keys the architect designated as common, the search shall return no matches.
4. When the library's public API is used with a translation loader that takes no `HttpClient` (for example a static-import loader), it shall configure Transloco without error. A unit test in the library shall demonstrate this, so the `file://` webview can adopt it later.
5. When `nx test` runs for the new library, the tests shall cover language switching, document `lang`/`dir` update, persistence read/write, the storage-throws fallback and first-visit detection, and they shall pass.

### 2. Per-lib scopes and translation ownership

Requirement: each Nx project owns its own translation keys, so strings change alongside the code that shows them and a lib's keys cannot collide with another's.

Acceptance criteria:

1. When any in-scope project renders user-visible text, that text shall come from a translation key under that project's own Transloco scope (one scope per project in the inventory table, plus an app-level scope for `apps/ptah-landing-page` shell text), not from a key owned by another feature lib. Shared chrome text belongs to `libs/web/ui` (or `panel-ui`) and is consumed from there.
2. When the repository is inspected, each project's `en` and `ar` translation files shall live inside that project's folder, not in the app or in the shared i18n library.
3. When a lazy-loaded route renders, only the scopes that route needs (plus global/app-level ones) shall be requested. Loading `/` shall not fetch the `admin` or `members` scope files, as shown by the browser network log.
4. When the landing app is built for production, translation files for every scope and both languages shall be present in the build output, or bundled, and the build shall succeed.
5. When a key is missing in the active language at runtime, the system shall display the English value and log a development-mode warning. It shall never display the raw key path to users in production.

### 3. Language switching, persistence and prerender safety

Requirement: As a visitor, I want to switch between English and Arabic from any page and have the site remember my choice, so that I read the site in my language on every visit without a jarring flash.

Acceptance criteria:

1. When a visitor activates the switcher, all visible UI text on the current page shall change to the selected language without a full page reload or route change, and the URL shall be unchanged.
2. When a visitor has chosen a language, then reloads or returns in a later session in the same browser, the site shall start in that language.
3. When no stored preference exists and the browser's first preferred language (`navigator.languages[0]`) starts with `ar`, the site shall start in Arabic. In every other case it shall start in English.
4. When storage is unavailable or throws (private mode, blocked storage), the site shall still render and switch languages for the session without console errors, falling back to 3.3 on the next load.
5. When a prerendered route (`/`, `/download`, `/pricing`, `/terms-and-conditions`, `/privacy`, `/refund`) is fetched without JavaScript, the HTML shall be English with `lang="en"` and `dir="ltr"`. This is unchanged from today apart from the switcher markup.
6. When a returning visitor with Arabic stored loads a prerendered route, the document shall have `lang="ar"` and `dir="rtl"` from the first paint, so no frame is painted with an LTR layout. The console shall show no Angular hydration mismatch errors or warnings. English copy shall not stay visible once the Arabic translations have loaded. This is verified with a Playwright test that pre-seeds the stored preference, captures the first screenshot after navigation and checks `dir` and the console.
7. When the active language changes, `document.documentElement.lang` and `.dir` shall update to `ar`/`rtl` or `en`/`ltr`, and the runtime document title set by `SeoService` or page components shall be in the active language.
8. When the switcher is used with a keyboard only, it shall be reachable, operable and show its current value. Its accessible name shall be announced in the current language, and each language option shall be labelled in its own language ("English", "العربية").

### 4. RTL layout

Requirement: As an Arabic reader, I want every in-scope page laid out right-to-left, with content that is inherently left-to-right kept readable, so the site feels native rather than mirrored halfway.

Acceptance criteria:

1. When the in-scope projects' `.ts`, `.html` and `.css` files are searched for physical-direction Tailwind utilities (`ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`, `rounded-l*`, `rounded-r*`, `border-l*`, `border-r*`, `space-x-*` without an RTL counterpart), the search shall return no matches. Any remaining match shall carry an inline comment explaining why it must stay physical, for example a decorative 3D/GSAP element.
2. When `dir="rtl"` is active, direction-bearing icons (arrows, chevrons, "next/back") shall be mirrored. Non-directional icons and logos, including the Ptah logo, shall not.
3. When `dir="rtl"` is active, the following shall render LTR and left-aligned inside the RTL page: code blocks, inline code, CLI commands and anything in `font-mono`, email addresses, URLs, license keys, file paths, and version strings.
4. When user-generated content (member posts, topic titles, display names) is rendered, its direction shall be set from its own content, so an English post reads LTR and an Arabic post reads RTL, regardless of the UI language.
5. When `dir="rtl"` is active, horizontal-scroll, carousel, GSAP scroll-driven and 3D sections in `libs/web/landing` shall have no horizontal page overflow and no overlapped or clipped copy at 375px, 768px and 1440px widths. This is checked by screenshot in the Playwright suite.
6. When Arabic is active, Arabic text shall render in the designated Arabic webfont, chosen at Gate 1.7, not a system fallback. English, Latin and mono text shall keep Inter and JetBrains Mono.

### 5. Locale-aware formatting

Requirement: dates and numbers the app already formats — about 75 sites, mainly `admin`, `members` and `account` — follow the active language.

Acceptance criteria:

1. When Arabic is active, every date rendered through the `date` pipe, `toLocale*String` or `Intl` in the in-scope projects shall use Arabic month and day names and the active locale, and it shall update when the language is switched without a reload.
2. When Arabic is active, the numbering system (Western `0-9` or Arabic-Indic `٠-٩`) shall be the single one chosen at Gate 1.7 and applied consistently across the app.
3. When prices are shown (for example `$29/mo`, `$290/yr` in `libs/web/pricing`), the amount and currency shall stay USD with the same numeric value in both languages. Only the surrounding words, such as "/mo", "per year" and "Free", shall be translated.

### 6. Do-not-translate content

Requirement: brand, product and technical identifiers stay intact in both languages.

Acceptance criteria:

1. When Arabic is active, the following shall appear unchanged, in Latin script: the brand name "Ptah", product and tier names (e.g. "Ptah Builders"), AI model and vendor names, "Electron", "VS Code", "Nx", "Angular", code, CLI commands, file names, and any identifiers from the showcase manifest.
2. When the Arabic translation files are reviewed, a do-not-translate glossary committed with the task (term, reason) shall list the terms above. Every Arabic value containing one of these terms shall contain it verbatim.

### 7. Tooling and CI

Requirement: CI keeps English and Arabic from drifting apart.

Acceptance criteria:

1. When a key exists in any project's `en` file but not in its `ar` file, or the reverse, a dedicated Nx target (e.g. `i18n-check`) for that project shall exit non-zero and name the file and key. With complete files it shall exit zero.
2. When a template or TypeScript file references a translation key that does not exist in the owning scope's `en` file, the check shall exit non-zero and name the key and file.
3. When `nx affected -t i18n-check` runs in CI, the target shall be included, so a PR that adds an English string without an Arabic entry fails.
4. When `nx run-many -t lint,test,build` runs for the landing app and all in-scope libs, it shall pass.
5. When the existing landing e2e suite (`apps/ptah-landing-page-e2e`) runs in English, it shall pass unchanged or with selector-only updates, and at least one new e2e spec shall cover 3.1, 3.2, 3.6 and 4.5.

### 8. Arabic copy delivery

Requirement: the user can review every agent-drafted Arabic string before merge.

Acceptance criteria:

1. When the PR is opened, every `ar` value shall be a real Arabic translation. None shall be an English copy, a placeholder or an empty string, except where 6.1 requires verbatim terms. The PR description shall state that the copy is agent-drafted and pending user review.
2. When the legal pages (`terms-and-conditions`, `privacy`, `refund`) are shown in Arabic, the page shall carry whatever governing-language notice the user decides under Open questions.

## Non-functional requirements

- Compatibility: the new library shall not require `HttpClient`-based loading (1.4), so the `file://` Electron/webview renderer can adopt it. `outputMode: "static"` prerendering of the six routes shall keep building.
- Accessibility: `lang` shall always match the language of the visible UI (WCAG 2.2 SC 3.1.1). The switcher shall meet 3.8.
- Security: the stored preference shall be validated against the supported-language list before use. An unknown value falls back as in 3.3.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| Arabic-speaking visitors and members | A native-feeling RTL site in Arabic that remembers the choice | 3.x and 4.x pass; no mirrored-halfway pages |
| English visitors and crawlers | Nothing gets worse | Prerendered HTML unchanged apart from switcher markup (3.5); e2e passes (7.5) |
| User and product owner (copy reviewer) | Reviewable Arabic drafts and a glossary | 8.1 and 6.2 artefacts present in the PR |
| Future Electron/webview task | A shared library it can import without change | 1.1-1.4 pass |
| Developers on `libs/web/*` | A clear place to add strings, with CI catching gaps | Per-lib files (2.2); `i18n-check` (7.1-7.3) |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Hydration mismatch or LTR-to-RTL flash on prerendered routes for Arabic returning visitors | HIGH | HIGH | The architect specifies how `lang`/`dir` are set before first paint and how Transloco behaves on the server. QA gates on the 3.6 Playwright test. |
| GSAP, 3D and horizontal-scroll landing sections break in RTL (they compute x-offsets physically) | MEDIUM | HIGH | The designer marks each animated section as mirror or keep-LTR at Gate 1.7. The developer adds 4.5 screenshot checks per section. |
| Agent-drafted Arabic legal text is read as binding | MEDIUM | HIGH | The user answers the governing-language question below before merge. The team-leader blocks merge on 8.2. |
| Scale (~140 components) leads to missed strings | HIGH | MEDIUM | The team-leader batches by lib. Each batch runs `i18n-check`, and the reviewer greps the batch's templates for remaining literal text. |
| The Arabic webfont adds weight for all visitors | MEDIUM | LOW | The architect loads the Arabic font only when Arabic is active, or subsets it; the designer picks it at Gate 1.7. |

## Open questions

- Numbering system in Arabic: Western `0-9` (recommended for a developer tool) or Arabic-Indic. Resolved at Gate 1.7 by the designer and user.
- Arabic legal pages: show a notice that the English version governs, or publish the Arabic legal text as equally binding? The user decides.
- Should the admin screens (internal-only) receive fully reviewed Arabic copy, or is the drafted copy acceptable without review? The user decides; this does not block implementation.

## Handoff

- Next specialist: ui-ux-designer (Gate 1.7 prototype), then software-architect.
- Why: the language switcher is a new UI element, and the RTL treatment of animated/3D sections, the Arabic font and the numbering system are visual decisions to settle before the architect fixes the library API, scope layout, pre-paint direction mechanism and check tooling.
