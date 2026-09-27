# Review: task-description.md, TASK_2026_575_fee7 (Gate 1)

## Review state

| Field | Value |
| --- | --- |
| Artifact | `.ptah/specs/TASK_2026_575_fee7/task-description.md` |
| Author | project-manager (subagent) |
| Author execution side | Claude Code subagent |
| Reviewer | independent document reviewer (subagent) |
| Reviewer execution side | Claude Code subagent. This is a same-side review because no CLI lanes (`ptah_agent_*` tools) are available in this cloud session. |
| Reviewed revision | 1 (round 0 reviewed revision 0) |
| Rounds completed | 1 |
| Verdict | **APPROVED** (round 1). Round 0 was REVISE. |
| Unresolved items | No blocking items. B1-B4 and N1-N11 are resolved. New non-blocking N12 and N13 are open, and I recommend the software-architect handle them. |

## Round 1 recheck (revision 1)

The line numbers below refer to `task-description.md` revision 1.

| Finding | Status | Evidence in revision 1 |
| --- | --- | --- |
| B1 | Resolved | Two new criteria and a reworded question:<ul><li>8.2 (line 187): a regenerable per-scope side-by-side table plus the glossary.</li><li>8.3 (line 188): merge is blocked without the user's sign-off for each scope, "admin included".</li><li>Open question 3 (line 225) now asks only about review depth and states that "sign-off is still required".</li></ul>Gate 0 decision 3 is now enforced. |
| B2 | Resolved | 3.6 (lines 117-124) picks option (b): each scope resolves before the first client render. The English-in-RTL window is limited to first paint through hydration, and the NFR (line 194) names that exception, so the contradiction is gone. The test is now concrete: `addInitScript` with a first-`requestAnimationFrame` `dir` capture, an `NG05xx` console check, and an Arabic `h1`. See N13 for one test detail. |
| B3 | Resolved | 7.3 (line 176) requires a named `ci.yml` step, and the criterion is that the CI job fails. I confirmed the cited lines `ci.yml:182` and `:192`. Keeping CI lint out of scope (line 59) is stated with a reason, which is acceptable. |
| B4 | Resolved | 3.5 (line 116) requires a text diff against a baseline from `main`, a key-path regex check, a check for empty `h1`/`h2`, a committed script, and an extended `deploy-landing.yml:59-77` step. I confirmed that step range. A HIGH/HIGH risk row is added (line 213). |
| N1 | Resolved | 4.1 (lines 134-139): the wording is now "converted or `rtl-exempt:`", raw CSS and data-driven positions are covered, the missing utilities are added, centring pairs are allowed, and the pattern must be committed. |
| N2 | Resolved | New risk row at line 214, with the architect as owner. |
| N3 | Resolved | 1.2 (line 88) now uses the project graph. `platform:angular` is optional, and the `type:util` consequence is stated (line 74). |
| N4 | Resolved | "Must not contain" gains an inline-script dependency (line 83), and new criterion 1.6 (line 92) requires one source of truth or a sync test. |
| N5 | Resolved | 8.1 (line 186) allows per-lib or batched PRs, and each one must stand on its own. |
| N6 | Resolved | 3.7 (line 125) covers the runtime title and description, and OG, Twitter and canonical tags stay English. See the new N12, which the current code affects. |
| N7 | Resolved | 7.2 (lines 172-175) sets a policy for computed keys, and an unannotated computed key fails the check. |
| N8 | Resolved | New risk row at line 215, with an owner. |
| N9 | Resolved | New risk row at line 216: the pre-paint step preloads the Arabic font. |
| N10 | Resolved | Scope (lines 43-47) names the shells. I confirmed that `libs/web/ui/src/lib/navigation.component.ts`, `libs/web/members/src/lib/member-layout/member-layout.ts` (with `member-theme-toggle.ts` beside it), `libs/web/admin/src/lib/admin-layout/admin-layout.ts` and `libs/web/panel-ui/src/lib/panel-layout/panel-layout.ts` all exist. |
| N11 | Resolved | 3.6 (line 117) covers stored preference and first-visit detection, and the Playwright test runs both cases (line 121). |

### New findings (round 1)

**N12. Non-blocking. 3.7's "og:\* stays English" conflicts with the current `SeoService` fallback.**
- Location: `task-description.md:125`
- `seo.service.ts:37` sets `ogDescription = config.ogDescription ?? config.description`, and lines 43-44 then write `og:title` and `og:description` from those values.
- As a result, translating the description or title at runtime also makes the OG and Twitter tags Arabic, unless every page passes an explicit English `ogDescription`/`ogTitle` or `SeoService` changes.
- This matters little in practice, because crawlers see only the prerendered English. The architect should still state which of the two approaches applies, so that 3.7 can be tested.

**N13. Non-blocking. 3.6's "after `ApplicationRef` reports stable" cannot be observed directly from Playwright in the production build.**
- Location: `task-description.md:124`
- `app.config.ts` provides `provideZoneChangeDetection` but not `provideProtractorTestingSupport`, so `window.getAllAngularTestabilities` is not available.
- The architect should define an observable signal instead, for example a `data-i18n-ready` or `data-hydrated` attribute that the app sets on `<html>` once hydration is stable, or an explicit wait strategy.

### Feasibility spot-checks for claims new in revision 1

- The mechanism in 3.6 is feasible:
  - The landing app has no CSP, so an inline pre-paint script is allowed.
  - `<html>` sits outside `<app-root>`.
  - Text bindings whose node structure matches the server render do not trigger `NG0500`-family mismatches. Resolving scopes before the first client render keeps the structure identical.
  - The initial navigation already gates hydration, so a blocking scope load fits there.
- The `deploy-landing.yml` comment at lines 55-58 already expects copy-specific greps to be tightened, which is consistent with the 3.5 extension.
- `apps/ptah-landing-page-e2e` exists with `playwright.config.ts`, as 7.5 assumes.

The remainder of this file is the round 0 review of revision 0, kept for history.

## 1. Trace: user requests and Gate 0 decisions mapped to the artifact

| # | Source | Requirement / decision | Where the artifact meets it | Status |
| --- | --- | --- | --- | --- |
| U1 | context.md:4 | Bilingual English + Arabic | Scope (lines 35-47); Req 3, 4, 8 | Met |
| U2 | context.md:4 | Library supports the latest Angular | Context line 7 names `@jsverse/transloco` and points to context.md:27 (peer `@angular/core >=16`; workspace runs Angular 22.1.7, `package.json:94`) | Met, because the choice was settled before this document |
| U3 | context.md:4 | Nx best practice with per-app/per-lib configuration | Req 1 (shared lib and tags), Req 2 (per-lib scopes, files kept inside each project) | Met |
| U4 | context.md:6 | Start with the landing page, and make Electron possible later | Out of scope line 51; Req 1.4; NFR compatibility line 163 | Met. See N4 for the webview CSP caveat. |
| U5 | context.md:6 | Follow the repo orchestration workflow | Handoff (lines 193-196) goes to designer, Gate 1.7, then architect, which matches `.claude/skills/orchestration/SKILL.md:33` | Met |
| G1 | context.md:30 | Client-side toggle only. No `/ar/` routes and no hreflang. Prerendered HTML stays English. | Out of scope line 52; Req 3.1 and 3.5 | Partly met. 3.5 cannot be verified as written (B4), and 3.6 conflicts with the NFR (B2). |
| G2 | context.md:31 | Whole landing app: marketing, legal, auth, account/profile, sessions, contact, admin, header/footer | Inventory table (lines 11-23); Scope line 39. Contact and sessions are redirects to `profile` (`app.routes.ts:109-115`), so `libs/web/account` covers them. Header and footer are in `libs/web/ui/src/lib/navigation.component.ts` and `footer.component.ts`. | Met |
| G3 | context.md:32 | Agents draft the Arabic and the user reviews it **before merge** | Req 8.1 only asks the PR to say the copy is "pending user review". Open question 3 (line 191) asks whether admin copy can skip review. | **Not met (B1)** |
| G4 | context.md:27 | Library is `@jsverse/transloco` | Context line 7 and Req 1 | Met |

## 2. Feasibility evidence (spot-checks against the code)

- **Cited paths and lines are accurate.**
  - `index.html:2` holds `<html lang="en" data-theme="operator">`.
  - Fonts are loaded at `index.html:85-91`.
  - `project.json:89` holds `extract-i18n`.
  - `app.routes.server.ts:11-19` prerenders 6 routes and falls through to `**` Client.
  - `pricing-grid.component.ts:643` has `price: '$29/mo'`.
  - `member-theme.service.ts:22` has `MEMBER_THEME_STORAGE_KEY`.
- **Component counts reproduce exactly.** I counted `@Component` files outside specs: app 2, landing 20, legal 4, pricing 3, auth 8, account 12, members 33, admin 46, ui 5, panel-ui 8, core 0. That is 141, against the artifact's "~140".
- **Formatting-site counts reproduce exactly.** admin 49, members 22, account 2, panel-ui 1, app 1.
- **Directional-class counts are plausible.** A broader regex that also catches `space-x-` and `-ml-` gives admin 45 (artifact ~27) and the other projects within about 3 of the artifact. The difference does not matter because 4.1 is a grep-to-zero criterion.
- **Tags and depConstraints.**
  - All 10 `libs/web/*` projects carry `scope:web` with the stated `type:*`.
  - `scope:web` and `scope:landing` may import `scope:shared` (`eslint.config.mjs:284-292`, `271-282`), and so may `scope:webview` (`:264-266`).
  - `scope:shared` may import only `scope:shared` (`:256-258`).
  - `type:util` may import only `type:util` (`:383-384`). That is fine for a lib whose only dependencies are npm packages, and consumers `libs/web/core` (type:util) and `libs/web/ui` (type:ui) may import a type:util lib.
  - The precedent is real: `libs/frontend/markdown` is `["scope:shared","type:ui"]` at `tsconfig.base.json:178`.
  - `platform:angular` exists only on `scope:webview` libs such as `libs/frontend/tasks-ui` and has no depConstraint. It is harmless but not a convention in `scope:shared`.
  - No `i18n` path alias exists yet, so `@ptah-extension/i18n` does not collide.
- **SSG and hydration.**
  - `outputMode: "static"` is set at `project.json:16`.
  - **Full hydration with event replay is on** (`app.config.ts:44`, `provideClientHydration(withEventReplay(), withNoIncrementalHydration())`).
  - `deploy-landing.yml:59-77` checks that each of the 6 prerendered files exists, contains `<h1`, and is not an empty `<app-root>`. It does not check the copy itself.
- **A pre-hydration inline script for `lang`/`dir` is feasible on the landing app.**
  - No CSP is set anywhere for the landing app: there is no `<meta http-equiv>` in `index.html` and no header rules in `.do/app.yaml` (a DO static site).
  - Angular `autoCsp` is not enabled in `project.json`.
  - `<html>` sits outside `<app-root>`, so changing its attributes cannot cause a hydration mismatch.
  - Text content is the real hazard. The prerendered English DOM is hydrated, and if the client's first render emits different nodes (for example a structural `*transloco` that renders nothing until `ar` loads), Angular throws a hydration mismatch (see B2).
  - This inline-script approach does **not** carry over to the VS Code webview, whose CSP is `script-src 'nonce-${nonce}'` (`webview-html-generator.ts:286`). See N4.
- **Tailwind 3.4 (`^3.4.18`, `package.json:277`) has most of the logical utilities needed.**
  - It provides `ms-/me-/ps-/pe-`, `start-/end-`, `text-start/end`, `rounded-s/e/ss/se/es/ee`, `border-s/e`, `scroll-ms/me`, and the `rtl:`/`ltr:` variants.
  - It has no logical form of `space-x-*` (use `rtl:space-x-reverse` or `gap`), `translate-x-*`, `bg-gradient-to-l/r` or `origin-left/right`. These need `rtl:` variants.
  - DaisyUI 4 components use logical properties.
  - Raw CSS in component `styles` is not covered by Tailwind at all (see N1).
- **Lazy loading supports 2.3.** `/members` and `/admin` use `loadChildren` (`app.routes.ts:101-106`, `132-134`), and `/` is eager, so keeping the admin and members scopes off the `/` request is achievable.
- **CI.** `ci.yml` runs `nx affected -t test` (`:182`) and `nx affected -t build` (`:192`). It does **not** run `lint` or any other affected target (see B3).

## 3. Findings

### Blocking

**B1. Gate 0 decision 3 ("user reviews before merge") has no enforcing criterion.**
- Location: `task-description.md:156-159`, `:191`
- 8.1 only requires the PR description to say the copy is "pending user review". Nothing requires the review to be finished before merge. The only merge block in the risk table (line 183) is on 8.2, the legal notice.
- Open question 3 (line 191) asks whether admin copy can ship "without review". That reopens a binding Gate 0 decision, which says the user reviews the copy.
- Fix:
  - Add a criterion that merge is blocked until the user records sign-off on the Arabic copy, per lib or batch, in the task folder or on the PR.
  - Name the review artefact, for example a generated per-scope en|ar side-by-side table plus the glossary. A reviewer cannot practically review a thousand-plus keys spread across about 22 JSON files.
  - Drop open question 3, or reword it as "review depth for admin". It must not become a review exemption.

**B2. 3.6 contradicts the accessibility NFR and cannot be tested as written.**
- Location: `task-description.md:104`, `:164`
- Hydration is on (`app.config.ts:44`) and prerendered HTML is English (G1). A returning Arabic visitor therefore sees English copy with `lang="ar" dir="rtl"` until the `ar` scope loads.
- 3.6 accepts that window: English copy "shall not stay visible once the Arabic translations have loaded". The NFR (line 164) says "`lang` shall always match the language of the visible UI". Both cannot hold.
- "captures the first screenshot after navigation" does not prove anything about first paint. Playwright's first screenshot is taken after load.
- The criterion also does not rule out the hydration-mismatch hazard, where client nodes differ while `ar` is loading.
- Fix:
  - Choose one option explicitly:
    - (a) accept a bounded English-in-RTL window, relax the NFR for that window, and set a time or event bound; or
    - (b) require the active-language translations of the route's scopes to resolve before bootstrap or hydration, so the first client render already emits Arabic, with the mismatch handling the architect specifies.
  - Make the test concrete. Record `documentElement.dir` from a `page.addInitScript` MutationObserver or first `requestAnimationFrame`, assert `rtl` at the first recorded frame, assert no `NG05xx` hydration warnings in the console, and assert how long it takes until no English text node remains.
  - Extend the criterion to first-visit Arabic detection (3.3), not only a stored preference (see N11).

**B3. 7.3 is circular, and CI does not run lint today.**
- Location: `task-description.md:148-149`
- "When `nx affected -t i18n-check` runs in CI, the target shall be included" is true by definition. CI has no step that runs it: `ci.yml` runs only `affected -t test` (`:182`) and `affected -t build` (`:192`).
- 7.4 requires `lint` to pass, but CI does not run lint either, so the boundary guarantee in 1.1 is not enforced by CI.
- Fix: require a named step in `.github/workflows/ci.yml` that runs `nx affected -t i18n-check`. The criterion is then "a PR that adds an `en` key without an `ar` key fails the CI job". State whether 1.1 and 7.4 are local-only checks or also need a CI lint step.

**B4. There is no criterion and no risk entry for prerender (SSG) translation loading, which is the SEO backbone that Gate 0 keeps English.**
- Location: `task-description.md:103`, `:177-185`
- During `outputMode: "static"` prerender the server must have the `en` translations of every scope resolved before rendering. A relative-URL HTTP loader, or an async scope load, can leave empty text or raw keys in the prerendered HTML.
- `deploy-landing.yml:59-77` would still pass, because it only greps for `<h1`.
- 3.5 says the HTML "shall be English", but gives no measurable test.
- Fix:
  - Add an acceptance criterion: the visible text of the 6 prerendered routes equals the pre-change baseline (a text diff that ignores switcher markup), with no raw key paths and no empty headings.
  - Extend the deploy assertion to grep for a known headline and for no `landing.`-style key patterns.
  - Add a HIGH/HIGH risk row, "prerender emits keys or empty copy", with the mitigation "architect specifies the server-side loader".

### Non-blocking

**N1. 4.1 contradicts itself and misses several physical-direction patterns.**
- Location: `task-description.md:114`
- The criterion says "shall return no matches" and in the next sentence "Any remaining match shall carry an inline comment". Reword it to: every match either has been converted or carries a `rtl-exempt:` comment.
- The pattern list does not cover:
  - Raw CSS in component `styles`, for example `auth-hero.component.ts:173-184` (`left: 20%/50%/80%`), `video-showcase.component.ts:108`, `console-grid-background.component.ts:51`, `falling-cubes-background.component.ts:142`.
  - Data-driven positions, for example `alwayson-loop-diagram.component.ts:187-214` (`left: 50/76.9/23.1`).
  - The utilities `-ml-*`, `translate-x-*`, `bg-gradient-to-l/r`, `origin-left/right` and `float-left/right`.
- Centering pairs such as `left-1/2 -translate-x-1/2` are direction-neutral and should be allow-listed.

**N2. 5.1 needs the date pipe to switch locale at runtime.**
- Location: `task-description.md:127`, risks
- Angular's `date`/`number` pipes use the bootstrap-time `LOCALE_ID` and need `registerLocaleData(localeAr)`.
- Updating "without a reload" means passing the locale argument at all ~75 sites or replacing them with an impure or signal-aware pipe from the shared lib.
- This is a design risk that deserves a row in the risk table.

**N3. Criterion 1.2 is hard to check by grep, and the lib's type tag should be stated.**
- Location: `task-description.md:67`, `:76`
- 1.2's "webview-scoped aliases" cannot be told apart by grep, because webview libs share the `@ptah-extension/` prefix (for example `@ptah-extension/tasks-ui`). Rely on the 1.1 lint result, or list the forbidden aliases.
- The proposed tag `platform:angular` has no constraint and does not appear on other `scope:shared` libs. It is harmless, but optional.
- Note that `type:util` may import only `type:util` (`eslint.config.mjs:383-384`). No switcher UI can ever live in this lib, which is consistent with "no product-styled components".

**N4. The shared lib must not depend on the landing app's inline pre-paint script.**
- Location: `task-description.md:69`, `:163`
- The VS Code webview CSP is nonce-only (`webview-html-generator.ts:286`), so the pre-paint mechanism cannot come from the lib as an inline script.
- The storage key and the validation logic will be duplicated between the inline script and the lib. Require a single source of truth (for example a build-time-generated snippet) or a test that keeps the two in sync.

**N5. The single-PR delivery assumption does not fit the size of the job.**
- Location: `task-description.md:158`, `:184`
- "When the PR is opened" implies one PR covering about 141 components, about 11 projects and every Arabic string.
- Allow per-lib PRs or batches, each with its own `i18n-check` and user copy sign-off. That also makes B1 practical.

**N6. It is unclear whether runtime meta tags are translated.**
- Location: `task-description.md:52`, `:105`
- 3.7 covers titles only. `SeoService` (`libs/web/core/src/lib/services/seo.service.ts`, 14 Title/Meta call sites in core) also sets description and OG tags at runtime.
- Out of scope excludes only the static `index.html` meta. State whether runtime meta descriptions follow the active language.

**N7. 7.2's missing-key check has no rule for dynamic keys.**
- Location: `task-description.md:147`
- Computed keys (`'status.' + x`), which are likely in admin and members status maps, cannot be resolved statically.
- Require a policy: an enumerated key map or marker comments for `@jsverse/transloco-keys-manager`. Otherwise 7.2 gives false passes.

**N8. Jest may need configuration for Transloco's ESM package.**
- Location: `task-description.md:79`, risks
- `@jsverse/transloco` ships ESM. `jest.preset.js` has no `transformIgnorePatterns` entry for `@jsverse`.
- The 1.4 and 1.5 unit tests, and every `libs/web/*` spec that renders a translated component, may need a Jest transform or a testing module (`TranslocoTestingModule`) setup. Add this as a low risk and name who fixes it.

**N9. Arabic font loading can cause a font flash.**
- Location: `task-description.md:185`
- Loading the Arabic font "only when Arabic is active" means returning Arabic visitors get a FOUT, which works against the spirit of 3.6.
- The mitigation should have the pre-paint script inject or preload the font when the resolved language is `ar`.

**N10. The switcher placement in member and admin shells is left vague.**
- Location: `task-description.md:41`
- "wherever the member/admin shells have their own chrome" is untestable. List the shells (for example the members layout and the admin layout in `libs/web/panel-ui`), or defer the list to the Gate 1.7 prototype explicitly.

**N11. Criterion 3.6 covers only returning visitors with a stored preference.**
- Location: `task-description.md:101-104`
- A first-time visitor detected as Arabic under 3.3 hits the same flash and hydration path.
- The pre-paint mechanism has to run the detection too. Say so in 3.6, or add a criterion 3.6b.

## 4. Scope check

- Nothing contradicts G1 or G2.
- The out-of-scope list is sound. Excluding Paddle, emails, server-side preference storage and localized `index.html` meta is consistent with the Gate 0 decisions.
- Some items were not explicitly requested but are reasonable and low-cost, so I do not count them as over-scope: the CI completeness check (7.x), the do-not-translate glossary (6.2) and the UGC direction rule (4.4).
- The only real over-reach is open question 3 reopening G3 (B1).
