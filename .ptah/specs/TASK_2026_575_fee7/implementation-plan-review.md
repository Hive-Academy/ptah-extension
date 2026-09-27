# Implementation Plan Review - TASK_2026_575_fee7

| Field | Value |
| --- | --- |
| Artifact | `implementation-plan.md` (818 lines) |
| Author | software-architect (subagent) |
| Reviewer | independent document reviewer (subagent) |
| Execution sides | Author: subagent. Reviewer: subagent. Same-side review: no CLI lanes (`ptah_agent_*` tools) available in this cloud session. |
| Reviewed revision | 0 |
| Rounds completed | 0 (this is the round-0 review) |
| Verdict | **REVISE**: 2 blocking (B1, B2), 11 non-blocking (N1-N11) |
| Unresolved items | B1, B2, N1-N11. None of the blocking items needs a user decision. N10 lists two items that should go to the user. |

Baseline: `context.md` (Gate 0, 1 and 1.7 decisions), `task-description.md` rev 1 (open N12, N13), `design-spec.md` rev 2 plus `prototype/` (open N22, N23), `CLAUDE.md`. No `CLAUDE.md` exists under `apps/ptah-landing-page` or `libs/web`.

Overall: this is a strong plan. The core mechanism holds up against the real Transloco 8.4.0 source and the real repo: bundled JSON scopes, loaded before render by an initializer and route resolvers, with atomic switching and a behavioural sync test for the pre-paint script. Codebase anchors are almost all exact. Both blocking findings are internal contradictions, each with a small fix. Neither is an architectural flaw.

## 1. Open handed-over items

| Item | Status | Evidence |
| --- | --- | --- |
| N12 (og:\* vs. `SeoService` fallback) | Resolved | Component 9 (plan:480-498) makes `SeoConfig` key-based and always writes `og:*`/`twitter:*` from `translate(key, {}, 'en')`. Title and description follow the active language, and an effect re-applies them. The spec cases (plan:495-497) make 3.7 testable. `seo.service.ts:35-56` and the 6 callers (plan:52) were confirmed. The two other `setPage(` grep hits are not calls. |
| N13 (no testability API for "stable") | Resolved | Component 6 (plan:438-448): `whenStable()` then `html[data-app-stable]`, set from `main.ts`. `main.ts` is a one-line bootstrap today, so the change is contained. It depends on A4, which is handled as an English control run first. |
| N22 (`[class.rtl:rotate-90]`) | Resolved | Verified against `@angular/compiler@22.1.7` and Tailwind 3.4.18 (plan:57). `panel-layout.html:95` is the `[class.-rotate-90]` line (confirmed). The extra finding that `rtl:` still matches inside `dir="ltr"` islands is correct and useful. |
| N23 (`[title]` on the truncated email) | Resolved | Component 14 (plan:604). The anchors `member-layout.html:24`, `admin-layout.html:22` and the sidebar precedent `member-layout.html:48` were all confirmed. |

## 2. Acceptance-criteria traceability

Every criterion maps to a component and a work unit. Gaps and weak traces:

| AC | Component / unit | Note |
| --- | --- | --- |
| 1.1-1.5 | C1 / F1 | OK. For 1.2, see N7. |
| 1.6 | C4 sync spec / F4 | OK. A jsdom matrix against `resolveInitialLang`. |
| 2.1 | C2 reference rule, lib units | **B1**: `core` keys consumed outside `core` fail the rule. |
| 2.2, 2.4 | C3 / F3, A1 | OK |
| 2.3 | C4 resolvers, C15 `lazy-scopes` | OK, subject to N4. |
| 2.5 | C1 missing handler | OK. See N11. |
| 3.1, 3.2, 3.8 | C10, C13, C15 | OK |
| 3.3, 3.4 | C1, C4 / F1, F4 | OK. 3.4 "no console errors" is checked only at unit level, which is acceptable. |
| 3.5 | C2 `check-prerender`, C11 deploy / F2b | **B2**: C8 and C7 change prerendered text. |
| 3.6 | C4, C5, C6, C15 | OK |
| 3.7 | C9 / CORE | OK (N12). |
| 4.1 | C2 RTL rule, C8 | OK. See N5. |
| 4.2, 4.3, 4.4 | C8, lib units | 4.2 has no automated check, only review. Acceptable. |
| 4.5 | C15 `rtl-layout` | OK. Geometry checks plus attached screenshots. |
| 4.6 | C4 / F4 | **Weak**: no verification step (N8). |
| 5.1, 5.2 | C1 pipes, C7 | OK. See N3 for the inventory. |
| 5.3 | C7 / PRC | OK, but see B2 for the extracted-text impact. |
| 6.1, 6.2 | C2 glossary rule / F2a | OK |
| 7.1-7.3 | C2, C11 / F2a | OK. See N1, N2 and N6. |
| 7.4, 7.5 | Unit closure rules, C15 | OK |
| 8.1-8.4 | C2 "real Arabic" rule, C16, LEG | OK. See N10 on the sign-off record. |
| NFR compatibility, accessibility, security | C1 (no `HttpClient`), C4, C10/C13, C1 store validation | OK |

The design-spec decisions trace fully: §2.2-2.7 to C10/C13, §3.1-3.4 to C8, the 19-row §3.5 table to the LND units, AUTH, LEG and UI, §3.6 to C4, §3.7 to C1 (`ar-u-nu-latn`, Latin `ar` symbols), and §3.8 to LEG. The plan documents its three conflict resolutions (`.ltr-island` display, `ui.common.language`, the `setLanguage` return type), and all three are sound.

## 3. Feasibility checks performed

- **Transloco 8.4.0**. I ran `npm view` and `npm pack` into the scratchpad and read `fesm2022/jsverse-transloco.mjs`. Confirmed:
  - `res.default` unwrap (`:333`);
  - the `shareReplay(1)` cache per path (`:571-619`);
  - the pipe returns `lastValue` from a synchronous `langChanges$` subscription (`:1375-1397`);
  - `handleSuccess` uses `emitChange: false` (`:928`);
  - `getMappedScope` honours `scopes.keepCasing` (`:975-976`);
  - `DefaultMissingHandler` returns the raw key (`:257-266`);
  - config keys `prodMode`, `failedRetries` and `missingHandler.{logMissingKey,useFallbackTranslation,allowEmpty}` exist (`:26-40`).

  `handleFailure` (`:937-972`) falls back to `scope/en`, which fits the plan's resolver failure story. Dependencies: `@jsverse/utils@1.0.0-beta.5` is `"type":"module"` with `.js` files, so the plan's Jest `@jsverse` whitelist is required and correct. The "preload, then render" design is sound.
- **Bundled JSON with esbuild and SSG (A1, A3)**. `tsconfig.app.json` extends the app `tsconfig.json`, so setting `resolveJsonModule` there (C3) covers lib sources compiled into the app build and `typecheck`. The lazy `loadComponent(() => import('@ptah-web/…'))` routes already prerender, which is a strong precedent for A3. A1 has a credible fallback.
- **Hydration**. A text-binding difference between the English prerender and the Arabic client is not an NG05xx condition. Angular's hydration does not touch `<html>`, so the pre-paint `lang`/`dir` mutation is safe. The only structural branch on a prerendered route is the legal notice (A5). The switcher check icons sit inside menus that are closed at load, and `/members` and `/admin` are CSR-only, so A5 is lower risk than the plan states.
- **CSP**. No CSP exists for the landing app anywhere in the repo, and the build has no `autoCsp`. The inline script is fine.
- **`ar` locale data**. `@angular/common@22.1.7/locales/ar.js` has Latin `.` and `,` symbols and Arabic month names. There is no `LOCALE_ID` or `DATE_PIPE_DEFAULT_OPTIONS` override in scope, so `'en-US'` in the drop-in pipes is behaviour-preserving.
- **Module boundaries**. The `eslint.config.mjs` `depConstraints` allow `scope:web` to import `scope:shared`, and `type:ui`/`type:feature`/`type:util` to import `type:util`. The new library as `scope:shared,type:util` works.
- **CI anchors**. `ci.yml:141-144` (degradation-audit), `:181-182` (affected test) and `:192` (affected build), plus `deploy-landing.yml:59-77`, are all exact.

## 4. Findings

### Blocking

**B1. The `i18n-check` scope rule rejects `core` keys, but the plan requires feature and app templates to render them.**
- Plan locations: `implementation-plan.md:267-268` ("owning scope is the project's own, or `ui` when `--allow-scope ui`… Any other scope prefix fails"), `:271` (the `i18n-keys: <prefix>.*` marker must name "a non-empty object in `en.json`" of the project's own scope), `:314-317` (every target passes only `--allow-scope ui`) and `:431` (rule 3: "Services return keys… templates translate them").
- Real consumers of `core` service messages:
  - `apps/ptah-landing-page/src/app/pages/download/download-page.component.ts:80,374` renders `{{ error() }}` from `GitHubReleaseService`;
  - `libs/web/pricing/src/lib/components/pricing-grid.component.ts:537,540` renders `PaddleCheckoutService.error`/`validationError`;
  - `libs/web/account/.../sessions-grid.component.ts:124` and `libs/web/landing/.../waitlist-form.component.ts:170` use core services.
- Consequence: under rule 3 these templates hold `core.*` keys, often computed (for example `{{ error() | transloco }}`). APP, PRC, ACC and LND-1 then cannot reach `i18n-check` exit 0, which their units require (plan:569).
- `paddle-checkout.service.ts:238` also builds a message with interpolated values, so rule 3 needs a `{ key, params }` shape, not a bare key.
- Fix:
  - allow `core` as well as `ui` for every consumer (`--allow-scope ui,core`, since both are global scopes);
  - make the `i18n-keys:` marker resolve the prefix against the key's owning scope file;
  - specify the message shape for parameterized service messages.

**B2. Plan instructions change the prerendered visible text, which 3.5 says must match the `main` baseline.**
- Plan locations: `implementation-plan.md:293` (text must equal the baseline), `:332` (baselines captured before any lib unit) and `:473` ("Literal `→`/`←` characters in strings become icon components").
- `libs/web/landing/src/lib/sections/cta/cta-section.component.ts:78` has `or view pricing →` on `/`. Converting it to an icon removes a character from the extracted text, so `prerender-check` fails in LND-2, unless the baseline is regenerated, which 3.5 forbids.
- The price split (`:458`, `$29` island plus a separate `/mo` node on the prerendered `/pricing`) and the new `.ltr-island` wrappers also add text-node boundaries. The extraction spec (`:288`, "whitespace collapsed") does not say how adjacent text nodes are joined. Joining with a space turns `$29/mo` into `$29 /mo`.
- Fix:
  - On prerendered routes, keep text-arrow glyphs as literal text outside the translation value, for example `<span aria-hidden="true" class="inline-block rtl:scale-x-[-1]">→</span>`. Limit glyph-to-icon conversion to the admin/members templates the design named (design-spec.md:619).
  - Define the extraction join rule: concatenate adjacent inline text nodes with no separator, then collapse whitespace.
  - State that baselines are never regenerated inside this task.

### Non-blocking

**N1. F4 adds the app's `i18n-check` target before the app's sites are converted.**
- Plan locations: `implementation-plan.md:401` (Component 4 adds `i18n-check`), `:751` (F4) and `:755` (APP also adds it).
- The app has `toLocaleDateString('en-US', …)` at `download-page.component.ts:456` and `sm:text-left` at `:332`. F4 touches the app, so the F2a CI step `nx affected -t i18n-check` fails on F4's PR.
- Fix: add the target only in APP, as the other units do, where it is added in each lib's last sub-unit.

**N2. The F2a self-test depends on F2b rules.**
- Plan locations: `:300-307` (the fixture plants `ml-4` and `| date`) and `:748-749` (F2a ships the self-test and the CI step, while the RTL and format rules land in F2b).
- The CI self-test would fail between F2a and F2b.
- Fix: F2a's fixture covers only F2a's rules, and F2b adds the two planted violations.

**N3. The formatting inventory is incomplete, and the format regex has false positives.**
- Plan line 61 lists one `toLocaleString()`. There are also 4 `toLocaleDateString` sites:
  - `libs/web/account/.../profile-details.component.ts:530`;
  - `libs/web/account/.../profile-header.component.ts:303`;
  - `libs/web/members/.../locked-module-notice.ts:168`;
  - `download-page.component.ts:456`.
- Component 7 (plan:450-463) should say that method-based formatters must read `i18n.intlLocale()` (a signal) so they recompute on a switch (5.1). The ACC unit's "2 formatting sites" (plan:761) are these two methods.
- The rule `\|\s*(date|number|currency|percent)\b` (plan:285), run as a regex over `.ts`, matches TypeScript unions such as:
  - `data-table.ts:203`;
  - `webhooks-triage.ts:232`;
  - `waitlist-query-state.ts:367-368`;
  - `stat-tile.ts:45`.

  Fix: detect pipes through the `parseTemplate` AST (`BindingPipe` names) that the tool already builds, not with a raw regex over TypeScript.

**N4. The resolver table does not say that the members and admin scopes are imported dynamically.**
- Plan locations: `:382-383` list bare `MEMBERS_I18N_SCOPES`/`ADMIN_I18N_SCOPES`, while plan:46 correctly requires a dynamic import.
- A static import from `@ptah-web/members`/`@ptah-web/admin` in `app.routes.ts` would:
  - break the "static imports of lazy-loaded libraries" lint (`app.routes.ts:65-72` explains this);
  - pull those libs into the initial bundle, which fails 2.3.
- Fix: write `() => import('@ptah-web/members').then(m => m.MEMBERS_I18N_SCOPES)` explicitly for both rows.

**N5. The LTR-island rule conflicts with design §3.5 and will make the checker noisy.**
- The plan says islands "contain logical utilities only" (plan:474, :806).
- Design-spec.md:663 keeps the tug meter's physical `left-0`, `left-[38%]`, `bg-gradient-to-r` and `justify-between` as they are inside the `dir="ltr"` island. `bg-gradient-to-r` has no logical equivalent in Tailwind 3.4.
- Design-spec.md:667 keeps `ml-1` in the terminal-mock island.
- As specified (plan:282-284), the RTL rule forces an `rtl-exempt` comment on every such line.
- Fix:
  - state the rule as "no `rtl:`/`ltr:` variants inside islands; physical utilities there are allowed";
  - have the checker auto-exempt descendants of `dir="ltr"` or `.ltr-island` elements, whose spans it already has from `parseTemplate`.

**N6. `nx affected -t i18n-check` does not re-run lib checks when the glossary or the tool changes.**
- `affected` maps changed files to projects. `targetDefaults.inputs` (plan:318) only affects caching.
- A glossary edit (`apps/ptah-landing-page/i18n-glossary.json`) marks only the app as affected, and a tool change marks only `i18n-check`.
- Fix:
  - add `implicitDependencies: ["i18n-check"]` to the in-scope projects, or make the CI step `run-many` when `tools/i18n-check/**` or the glossary changes;
  - consider moving the glossary out of the app. Shared `ui` referencing an app file is awkward for the later webview adoption.

**N7. The `@nx/dependency-checks` precedent does not carry over.**
- `libs/frontend/markdown` is buildable (`ng-packagr-lite`). The new library has no `build` target (plan:254), so that lint rule will probably not exercise its `package.json`.
- 1.2 therefore rests on the `nx graph` inspection only. That is acceptable, but the plan should say so instead of citing dependency-checks (plan:230).
- Note also the pinned beta transitive dependency `@jsverse/utils@1.0.0-beta.5`.

**N8. 4.6 (Arabic text renders in IBM Plex Sans Arabic, not a fallback) has no check.**
- Add to `e2e:i18n`, after `document.fonts.ready`: `document.fonts.check('700 16px "IBM Plex Sans Arabic"')` in `ar`.
- Also assert that an English run makes no request to the Arabic font URL, which covers the font-weight risk row.

**N9. The rollback text is inaccurate after the lib units merge.**
- Plan locations: `:689` and `:815` ("F4 revert… restores the current app exactly").
- This holds only before CORE and the lib units. After them, templates depend on `provideI18n`, the resolvers and the key-based `SeoConfig`.
- Fix: state a reverse-dependency rollback order: lib units, then CORE, then F4, then F3 and F1.

**N10. Items that should go to the user.**
- (a) Task-description open question 3 and design-spec.md:931 (admin copy review depth: spot-check or full read) do not appear in Component 16. The team-leader should ask it before ADM-1 copy review starts.
- (b) A4's remediation (plan:109-110, :801) means moving GSAP/Lenis loops outside the zone. That expands the task's scope. If the English control run fails, the team-leader should raise it with the user instead of silently opening a fix.
- (c) C16's `SIGNOFF.md` line is written by the team-leader. It should quote or link the user's own message so that it counts as the user's sign-off under 8.3.
- A1-A3 and A5 are technical, and they are correctly not user decisions.

**N11. The missing-handler wiring and the testing provider.**
- `provideTransloco` registers `DefaultMissingHandler` itself (`fesm2022:1459`), and that handler returns the raw key. `provideTranslocoMissingHandler(I18nMissingHandler)` must come after it inside `provideI18n`. The F1 spec should assert that the prod path returns `''`, never the key.
- `provideI18nTesting` (plan:225-227) should install the same handler. Otherwise lib specs silently render raw keys for typos that `i18n-check` would catch only later.

## 5. Work-unit list

- **Ordering**: the dependency chain F1 → F2a → F2b → F3 → F4 → CORE → lib units → E2E is correct. Capturing the baseline in F2b before any template edit is the right call. N1 and N2 are the two ordering defects.
- **File-disjointness**:
  - OK across lib chains.
  - CORE's edits to the 6 caller files and 4 JSON files come before LND, LEG, PRC and APP, so there is no overlap.
  - The members and admin folder partitions match the real directories (`libs/web/members/src/lib/*`, `libs/web/admin/src/lib/*`). `members.routes.ts`/`admin.routes.ts` and the `__fixtures__` folder are unassigned. Say explicitly that they carry no UI strings, or assign them.
- **Sizing**: MEM-1 (9 folders) and ADM-1 are the largest. They are acceptable, given the "up to 3 in parallel" cap.
- **AC mapping**: every unit carries AC IDs, and the closure list (plan:771-779) covers 2.1, 6.x, 7.4, 8.1 and 8.2.

## 6. Risks and rollback

The risk table is credible, and it adds good risks the requirements did not name: late scope loads that do not re-render, `rtl:` leaking into islands, and literal-scan false positives. A4 is correctly rated HIGH impact with a detection-first approach. The rollback text needs N9's correction.

## 7. Verdict

**REVISE.** Fix B1 and B2. I also recommend addressing N1-N4 in revision 1, since they are cheap and each one would otherwise stall a unit. N5-N11 may be carried to the team-leader.
