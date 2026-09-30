# Requirements - TASK_2026_575_fee7

Revision: 1. This revision addresses `task-description-review.md` findings B1-B4 and N1-N11; see Review responses.

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
- A language switcher, with persistence and first-visit detection, placed in:
  - the public header (`libs/web/ui/src/lib/navigation.component.ts`);
  - the member shell (`libs/web/members/src/lib/member-layout/member-layout.ts`, next to the existing `member-theme-toggle`);
  - the admin shell (`libs/web/admin/src/lib/admin-layout/admin-layout.ts`).
  The Gate 1.7 prototype may move it within those shells, or into the shared `libs/web/panel-ui/src/lib/panel-layout/panel-layout.ts`. It must stay reachable from all three.
- RTL: `lang`/`dir` on `<html>`, conversion of physical-direction Tailwind utilities in in-scope files to logical equivalents, mirroring of direction-bearing icons, LTR islands.
- An Arabic webfont.
- Locale-aware date/number formatting at the existing formatting sites.
- A translation-completeness check target wired into CI.
- Agent-drafted Arabic copy for all keys, flagged for user review.
- A designer/prototype step (Gate 1.7) for the switcher and the RTL treatment before architecture.

Out of scope:

- Adopting i18n in `apps/ptah-extension-webview` / Electron / VS Code webview: a follow-up task. This task only makes sure the shared library is usable there (see 1.4).
- Locale URLs (`/ar/…`), hreflang, localized sitemap, prerendering Arabic HTML, and localized `index.html` meta/OG/Twitter tags, canonical, `llms.txt` and `robots.txt`: the user decided on a client-side toggle only (Gate 0).
- Adding a general `lint` step to CI. Criteria 1.1 and 7.4 are verified locally by the developer and QA. Only the `i18n-check` CI step is added (7.3). A CI lint gate is a separate DevOps task.
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

Proposed placement (the architect may adjust the path; the tags and constraints below are requirements): `libs/frontend/i18n`, import path `@ptah-extension/i18n`, tags `["scope:shared", "type:util"]`. `platform:angular` is optional, because no constraint uses it. `type:util` may import only `type:util` (`eslint.config.mjs:383-384`), so the library can hold no switcher UI. The switcher belongs to a `scope:web` ui lib. This follows the precedent of `@ptah-extension/markdown` (`libs/frontend/markdown`, `scope:shared`). `scope:shared` is importable by `scope:web`, `scope:landing` and `scope:webview` under the current `depConstraints` (`eslint.config.mjs:254-290`).

It must contain: the supported-language list and types (`en`, `ar`), each language's direction, an Angular provider/factory that configures Transloco given app-supplied options (loader, available langs, default lang, persistence key), an active-language state readable as a signal, the logic that applies `lang`/`dir` to the document root, preference persistence with safe fallback, first-visit detection, and locale-aware formatting helpers or re-exports if the architect chooses them. It may contain truly generic common keys (e.g. "Cancel", "Close", "Loading") only if the architect decides they are shared across both products.

It must not contain:
- landing- or webview-specific strings, routes, or components with product styling;
- imports from any `scope:web`, `scope:landing` or `scope:webview` project;
- `localStorage` keys naming the landing app;
- assumptions of HTTP-served assets (the webview loads from `file://`);
- any dependency on an inline `<script>` in the host page. The VS Code webview CSP is nonce-only (`webview-html-generator.ts:286`), so the landing app's pre-paint mechanism (3.6) is app-level, not part of the library.

Acceptance criteria:

1. When `nx lint` runs over the workspace, the system shall report no `@nx/enforce-module-boundaries` violations. The new library's `project.json` shall carry the `scope:shared` tag and a `type:*` tag.
2. When `nx graph --file` output is inspected, the new library shall have no project dependencies other than `scope:shared` projects. Its dependencies should be npm packages only.
3. When the new library's source and assets are searched for any key or string from a landing lib's translation file, other than keys the architect designated as common, the search shall return no matches.
4. When the library's public API is used with a translation loader that takes no `HttpClient` (for example a static-import loader), it shall configure Transloco without error. A unit test in the library shall demonstrate this, so the `file://` webview can adopt it later.
5. When `nx test` runs for the new library, the tests shall cover language switching, document `lang`/`dir` update, persistence read/write, the storage-throws fallback and first-visit detection, and they shall pass.
6. When the landing app's pre-paint logic (3.6) and the library disagree on the storage key, the supported-language list or the detection rule, a test or build step shall fail. There shall be one source of truth for these values, or an automated test that proves the two stay in sync.

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
5. When a prerendered route (`/`, `/download`, `/pricing`, `/terms-and-conditions`, `/privacy`, `/refund`) is fetched without JavaScript, the HTML shall be English with `lang="en"` and `dir="ltr"`. Its visible text shall match a baseline captured from `main` before this change, compared as extracted text with the switcher markup ignored. It shall contain no raw key paths (text matching `^[a-z][\w-]*(\.[\w-]+)+$`) and no empty `<h1>`/`<h2>`. The check shall be a committed script or test. The `Assert prerendered content` step in `.github/workflows/deploy-landing.yml:59-77` shall be extended to grep each route for a known English headline and for no key-path patterns.
6. When a visitor whose resolved language is Arabic loads a prerendered route, the site shall behave as follows. The resolved language is the stored preference (3.2) or, with nothing stored, first-visit detection (3.3); both cases are covered.
   - Before first paint, `documentElement` shall have `lang="ar"` and `dir="rtl"`, so no frame is painted with an LTR layout.
   - The only English-in-RTL window allowed is from first paint until hydration completes. The active language's translations for the route's scopes shall resolve before the first client render, so the first client render already emits Arabic.
   - The console shall show no Angular hydration mismatch errors or warnings (`NG05xx`).
   Verification is a Playwright spec, run once with a pre-seeded preference and once with an `ar` browser locale and empty storage. It shall:
   - record `documentElement.dir` from an init script (`page.addInitScript`) at the first `requestAnimationFrame` and assert `rtl`;
   - assert no `NG05xx` console messages;
   - after `ApplicationRef` reports stable, assert that no visible text node in `<main>` matches the route's English baseline headline, and that the `h1` is Arabic.
7. When the active language changes, `document.documentElement.lang` and `.dir` shall update to `ar`/`rtl` or `en`/`ltr`, and the runtime document title and runtime meta description set by `SeoService` (`libs/web/core/src/lib/services/seo.service.ts`) or page components shall be in the active language. Runtime `og:*`/`twitter:*` tags and canonical links stay English, because crawlers see only the prerendered English.
8. When the switcher is used with a keyboard only, it shall be reachable, operable and show its current value. Its accessible name shall be announced in the current language, and each language option shall be labelled in its own language ("English", "العربية").

### 4. RTL layout

Requirement: As an Arabic reader, I want every in-scope page laid out right-to-left, with content that is inherently left-to-right kept readable, so the site feels native rather than mirrored halfway.

Acceptance criteria:

1. When the in-scope projects' `.ts`, `.html` and `.css` files are searched for physical-direction styling, every match shall either have been converted to a logical or `rtl:`-aware equivalent or carry an inline `rtl-exempt: <reason>` comment on the same or preceding line. Examples of an exempt match are a decorative 3D/GSAP element, or a centring pair such as `left-1/2 -translate-x-1/2`.
   The search covers:
   - Tailwind utilities: `-?ml-*`, `-?mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`, `rounded-l*`, `rounded-r*`, `rounded-tl/tr/bl/br*`, `border-l*`, `border-r*`, `space-x-*`, `-?translate-x-*`, `bg-gradient-to-l/r`, `origin-left/right` and `float-left/right`.
   - Raw CSS in component `styles`: `left:`, `right:`, `margin-left/right`, `padding-left/right` and `text-align: left/right`. Examples include `auth-hero.component.ts:173-184`, `video-showcase.component.ts:108`, `console-grid-background.component.ts:51` and `falling-cubes-background.component.ts:142`.
   - Data-driven inline positions, for example `alwayson-loop-diagram.component.ts:187-214`.
   The search pattern shall be committed, as a script or inside `i18n-check`, so a reviewer can rerun it.
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
2. When a template or TypeScript file references a translation key that does not exist in the owning scope's `en` file, the check shall exit non-zero and name the key and file. Computed keys (for example `'status.' + value`) shall be either:
   - written as an enumerated key map whose literal keys the check can see, or
   - annotated with a marker comment the check tool understands that lists the possible keys.
   An unannotated computed key shall itself fail the check.
3. When a PR adds a key to any `en` file without the matching `ar` key, a named step in `.github/workflows/ci.yml` that runs `nx affected -t i18n-check` shall fail the CI job. Today the workflow runs only `affected -t test` (`ci.yml:182`) and `affected -t build` (`ci.yml:192`), so this step is new.
4. When `nx run-many -t lint,test,build` runs locally for the landing app, all in-scope libs and the new i18n library, it shall pass. This includes Jest specs that render translated components.
5. When the existing landing e2e suite (`apps/ptah-landing-page-e2e`) runs in English, it shall pass unchanged or with selector-only updates, and at least one new e2e spec shall cover 3.1, 3.2, 3.6 and 4.5.

### 8. Arabic copy delivery

Requirement: the user can review every agent-drafted Arabic string before merge.

Acceptance criteria:

1. When a delivery PR is opened, every `ar` value in the scopes it touches shall be a real Arabic translation. None shall be an English copy, a placeholder or an empty string, except where 6.1 requires verbatim terms. Delivery may be split into per-lib or batched PRs. Each PR must pass `i18n-check` and meet 8.3 on its own.
2. When Arabic copy is submitted for review, the task folder shall contain, for each scope, a generated side-by-side review table (key | English | Arabic | notes) plus the do-not-translate glossary (6.2). Regenerating the table from the JSON files shall reproduce it exactly.
3. When a PR containing Arabic copy is ready to merge, the user's sign-off for each scope it contains shall be recorded, either as a PR review/comment from the user or as a sign-off line per scope in the task folder. Without that record the team-leader shall not merge. This applies to every scope, admin included.
4. When the legal pages (`terms-and-conditions`, `privacy`, `refund`) are shown in Arabic, the page shall carry whatever governing-language notice the user decides under Open questions.

## Non-functional requirements

- Compatibility: the new library shall not require `HttpClient`-based loading (1.4), so the `file://` Electron/webview renderer can adopt it. `outputMode: "static"` prerendering of the six routes shall keep building.
- Accessibility: `lang` shall match the language of the visible UI (WCAG 2.2 SC 3.1.1). The one exception is the pre-hydration window defined in 3.6, which ends at hydration. The switcher shall meet 3.8.
- Security: the stored preference shall be validated against the supported-language list before use. An unknown value falls back as in 3.3.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| Arabic-speaking visitors and members | A native-feeling RTL site in Arabic that remembers the choice | 3.x and 4.x pass; no mirrored-halfway pages |
| English visitors and crawlers | Nothing gets worse | Prerendered HTML unchanged apart from switcher markup (3.5); e2e passes (7.5) |
| User and product owner (copy reviewer) | Reviewable Arabic drafts and a glossary | 8.2 review tables and 6.2 glossary present; 8.3 sign-off recorded before merge |
| Future Electron/webview task | A shared library it can import without change | 1.1-1.4 pass |
| Developers on `libs/web/*` | A clear place to add strings, with CI catching gaps | Per-lib files (2.2); `i18n-check` (7.1-7.3) |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Hydration mismatch or LTR-to-RTL flash on prerendered routes for Arabic returning visitors | HIGH | HIGH | The architect specifies how `lang`/`dir` are set before first paint and how Transloco behaves on the server. QA gates on the 3.6 Playwright test. |
| GSAP, 3D and horizontal-scroll landing sections break in RTL (they compute x-offsets physically) | MEDIUM | HIGH | The designer marks each animated section as mirror or keep-LTR at Gate 1.7. The developer adds 4.5 screenshot checks per section. |
| Prerender emits raw keys or empty copy (server-side translations not resolved at SSG time), which the current deploy check (`<h1` grep only) would not catch | HIGH | HIGH | The software-architect specifies a server-side loader that resolves every prerendered route's `en` scopes before render. QA gates on 3.5, including the extended deploy assertion. |
| Angular `date`/`number` pipes use the bootstrap `LOCALE_ID`, so 5.1's switch-without-reload cannot work unchanged at ~75 sites | HIGH | MEDIUM | The software-architect chooses between an explicit locale argument at every site and a locale-aware pipe or helper in the shared lib, and registers `ar` locale data. The team-leader tracks the ~75 sites in the batch plan. |
| `@jsverse/transloco` ships ESM; `jest.preset.js` has no `transformIgnorePatterns` entry for it, so specs rendering translated components may fail | MEDIUM | LOW | The developer of the first batch adds the Jest transform or a shared Transloco testing provider before the lib batches start (7.4). |
| Returning Arabic visitors see a font flash (FOUT) when the Arabic font is loaded late | MEDIUM | MEDIUM | The software-architect has the app-level pre-paint step start the Arabic font load (for example a preload) when the resolved language is `ar`. The designer confirms the font at Gate 1.7. |
| Agent-drafted Arabic legal text is read as binding | MEDIUM | HIGH | The user answers the governing-language question below before merge. The team-leader blocks merge on 8.4. |
| Scale (~140 components) leads to missed strings | HIGH | MEDIUM | The team-leader batches by lib. Each batch runs `i18n-check`, and the reviewer greps the batch's templates for remaining literal text. |
| The Arabic webfont adds weight for all visitors | MEDIUM | LOW | The architect loads the Arabic font only when Arabic is active, or subsets it; the designer picks it at Gate 1.7. |

## Open questions

- Numbering system in Arabic: Western `0-9` (recommended for a developer tool) or Arabic-Indic. Resolved at Gate 1.7 by the designer and user.
- Arabic legal pages: show a notice that the English version governs, or publish the Arabic legal text as equally binding? The user decides.
- Review depth for admin (internal-only) copy: must the user read every admin string, or is a spot-check acceptable? Either way, sign-off is still required under 8.3. The user decides; this does not block implementation.

## Review responses (revision 1)

- B1 (copy review before merge): adds 8.2 (per-scope side-by-side review table and glossary) and 8.3 (merge blocked without recorded per-scope user sign-off, admin included). The old admin open question is reworded to ask only about review depth, with no exemption.
- B2 (3.6 vs NFR and testability): chose option (b). The route's active-language scopes must resolve before the first client render. The only English-in-RTL window allowed runs from first paint to hydration, and the NFR states this exception. 3.6 now names the Playwright mechanics: init-script `dir` capture at the first frame, the `NG05xx` console check, and an Arabic `h1` after stable.
- B3 (circular 7.3, no CI lint): 7.3 now requires a new named `ci.yml` step, and the criterion is that the CI job fails. 7.4 and 1.1 are stated as local checks. A CI lint gate is added to Out of scope with the reason.
- B4 (prerender translation loading): 3.5 now requires a text diff against a baseline, no key paths and no empty headings, plus the extended `deploy-landing.yml` assertion. A HIGH/HIGH risk row is added.
- N1: 4.1 is reworded to "converted or `rtl-exempt:`", covers raw CSS, data-driven positions and the missing utilities, allow-lists centring pairs, and requires a committed pattern.
- N2: added as a risk row owned by the architect.
- N3: 1.2 now uses the project graph instead of alias grep. `platform:angular` is optional, and the `type:util` consequence is stated.
- N4: added to Requirement 1's "must not contain" list, and new criterion 1.6 requires a single source of truth or a sync test.
- N5: 8.1 allows per-lib or batched PRs, each self-sufficient.
- N6: 3.7 now covers the runtime title and meta description. OG, Twitter and canonical tags stay English.
- N7: 7.2 now includes a policy for computed keys.
- N8: added as a risk row with an owner.
- N9: added as a risk row. The pre-paint step starts the font load.
- N10: the switcher shells are named in Scope, and Gate 1.7 may adjust placement within them.
- N11: folded into 3.6, which covers stored and first-visit detection alike.

## Handoff

- Next specialist: ui-ux-designer (Gate 1.7 prototype), then software-architect.
- Why: the language switcher is a new UI element, and the RTL treatment of animated/3D sections, the Arabic font and the numbering system are visual decisions to settle before the architect fixes the library API, scope layout, pre-paint direction mechanism and check tooling.
