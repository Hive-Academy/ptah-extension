# Implementation Plan Review - TASK_2026_575_fee7

| Field | Value |
| --- | --- |
| Artifact | `implementation-plan.md` (942 lines) |
| Author | software-architect (subagent) |
| Reviewer | independent document reviewer (subagent) |
| Execution sides | Author: subagent. Reviewer: subagent. Same-side review: no CLI lanes (`ptah_agent_*` tools) available in this cloud session. |
| Reviewed revision | 1 |
| Rounds completed | 1. Round 0 reviewed revision 0 (REVISE: B1 and B2 blocking, N1-N11 non-blocking). Round 1 reviews revision 1. |
| Verdict | **APPROVED**: no blocking findings open. B1, B2 and N1-N11 are resolved. 3 new non-blocking findings (N12-N14) go to the team-leader and developer. |
| Unresolved items | N12, N13 and N14 are non-blocking; they are for F1 and E2E. Two user-facing items are already scheduled in the plan: the admin review-depth question (plan:725), and the A4 remediation, if triggered (plan:127, :869). |

Baseline: `context.md` (Gate 0, 1 and 1.7 decisions), `task-description.md` rev 1 (open N12, N13), `design-spec.md` rev 2 plus `prototype/` (open N22, N23), `CLAUDE.md`. No `CLAUDE.md` exists under `apps/ptah-landing-page` or `libs/web`.

## Round 1 recheck (revision 1)

Line numbers refer to `implementation-plan.md` revision 1.

### Blocking findings from round 0

| Finding | Status | Evidence in revision 1, checked against the code |
| --- | --- | --- |
| **B1**: the scope rule rejected `core` keys that templates must render | **Resolved** | <ul><li>`--allow-scope ui,core` is the default for every web project, with key ownership taken from the first segment through `src/lib/scope-map.ts` (plan:282-290). `i18n-keys:` markers resolve each key against its owning scope (plan:293-296).</li><li>`I18nMessage { key, params? }` is added (plan:235), and Component 5 rule 3 (plan:467-470) applies it.</li><li>I confirmed the interpolation at `paddle-checkout.service.ts:234-238` and the backend `response.message` at `:235`. The `core.common.serverMessage` wrapper with `{{ text }}` values fits the "real Arabic" exception, since that exception requires `ar === en` for placeholder-only values.</li><li>The F2a self-test must pass on a valid `core.*` reference (plan:338).</li><li>`ui` passes no allow-list. I checked: `navigation.component.ts:25-26,767` injects `AuthService` and `SubscriptionStateService` but renders no core-produced message, so this is correct.</li></ul> |
| **B2**: prerendered text vs. the 3.5 baseline | **Resolved** | <ul><li>Component 5 rule 7 (plan:474-480) requires verbatim `en` values and splits that reproduce every character. Arrow glyphs stay literal in `aria-hidden` `rtl:scale-x-[-1]` spans on prerendered routes, and icon conversion is limited to the design's admin and CSR-only cases.</li><li>The extraction normalisation is defined once and shared (plan:319-325): join with no separator, then collapse whitespace.</li><li>`--update` runs once, in F2b (plan:331). `prerender-check` closes UI, APP, LND-1, LND-2, LEG and PRC (plan:848).</li><li>I checked the worked example against `cta-section.component.ts:74-79`. The anchor's only content is `or view pricing →`. The template `{{ 'landing.cta.viewPricing' | transloco }} <span…>→</span>` keeps one space, because Angular's whitespace collapse keeps non-blank text nodes with a single space, so it extracts identically.</li><li>The `$29/mo` example also extracts identically under the no-separator join.</li><li>3.5 is not weakened.</li></ul> |

### Non-blocking findings from round 0

| Finding | Status | Evidence |
| --- | --- | --- |
| N1: the app `i18n-check` target was added in F4 | Resolved | plan:437 and the F4 row (:817) say "**no** `i18n-check` target". APP adds it after converting `download-page.component.ts:332,456` (:822). |
| N2: the F2a self-test depended on F2b rules | Resolved | plan:337-341 grows the fixture per unit and adds must-pass lines (a type union, `left-0` in an island). The F2b row owns `__fixtures__/project/**` additions (:816). |
| N3: formatting inventory and regex false positives | Resolved | <ul><li>AST-based detection covers `BindingPipe` names plus TypeScript `toLocale*` calls and `Intl` construction (plan:313-316).</li><li>The 4 `toLocaleDateString` sites are included, and method formatters must read the `intlLocale()` signal (plan:502).</li><li>The prerendered download-page date stays English at SSG (:503), which is correct because the server language is `en`.</li></ul> |
| N4: dynamic scope imports for members/admin | Resolved | plan:416-419 spells out both dynamic imports and the lint and 2.3 rationale. |
| N5: LTR-island rule vs. design §3.5 | Resolved | <ul><li>The checker auto-exempts island descendants and fails on `rtl:`/`ltr:` variants inside them (plan:310-312).</li><li>Component 8 is aligned (:524-526).</li><li>The self-test covers both directions (:339).</li></ul> |
| N6: `affected` misses glossary and tool changes | Resolved | <ul><li>The glossary moves to `tools/i18n-check/glossary.json` (:365).</li><li>The CI step switches to `run-many` when `tools/i18n-check/**` changes (:580-592).</li><li>I verified that `NX_BASE`/`NX_HEAD` come from `nrwl/nx-set-shas` (`ci.yml:119-122`) and that checkout uses `fetch-depth: 0` (`ci.yml:57`), so `git diff "$NX_BASE" "$NX_HEAD"` works.</li><li>Rejecting `implicitDependencies` is reasoned.</li></ul> |
| N7: dependency-checks precedent | Resolved | plan:51 and :249 rest 1.2 on `nx graph --file`. The beta pin is noted (:250). |
| N8: no 4.6 check | Resolved, with a caveat | New `arabic-font.spec.ts` (plan:696-698), with the no-request check in `en`. The `fonts.check` assertion is weak, see N12. |
| N9: rollback | Resolved | plan:880-891 gives a reverse-dependency order with the F4 qualification. |
| N10: items for the user | Resolved | <ul><li>(a) The admin review-depth question is asked before the ADM-1 review (:725).</li><li>(b) The A4 remediation is a user decision (:127, risk row :869), and 3.6 Arabic is not judged until it is resolved.</li><li>(c) The `SIGNOFF.md` line must quote or link the user's message (:722-723).</li></ul> |
| N11: missing-handler ordering and the testing handler | Resolved | Placed after `provideTransloco` (plan:229, matching `fesm2022:1456-1462`). The testing provider throws on unknown keys (:244), but see N13 and N14 for its consequences. |
| Work-unit note: unassigned routes and fixtures | Resolved | `members.routes.ts`/`admin.routes.ts` are assigned as "verify no UI strings", and fixtures are stated as test data (:829, :832). |

### Assumptions A1-A5 (revised classification, plan:120-128)

I agree with the classification.

- A1, A2, A3 and A5 are technical defaults with local, product-neutral fallbacks:
  - A1 and A2 fall back to a TS wrapper module;
  - A3 rests on the existing `loadComponent` prerender precedent;
  - A5's only real branch on a prerendered route is the legal notice.
- A4 is correctly split. Detection is technical (an English control run on `data-app-stable`). Remediation, moving GSAP/Lenis out of the zone, is a scope change the user must choose (a separate task or a wider one). The risk row (:869) forbids a silent fix and holds the 3.6 Arabic verdict until the choice is made.
- No approved Gate 0, 1 or 1.7 decision is reopened.

### New findings (round 1)

All are non-blocking.

**N12. `document.fonts.check` can pass without the Arabic font loaded.**
- Location: plan:697.
- `FontFaceSet.check()` returns `true` when no matching face needs loading. That includes the case where no `@font-face` for "IBM Plex Sans Arabic" was ever registered, for example when the stylesheet link failed or was never injected. The assertion can therefore pass even though 4.6 fails.
- Fix, either of:
  - `const faces = await document.fonts.load('700 16px "IBM Plex Sans Arabic"', 'ع'); expect(faces.length).toBeGreaterThan(0)`;
  - assert that a `FontFace` in `document.fonts` has family `IBM Plex Sans Arabic` and `status === 'loaded'`.

  Also assert that `#ptah-font-ar` exists.

**N13. The lib-spec provider recipe omits `core`, and the testing handler now throws.**
- Location: plan:610 prescribes `provideI18nTesting({ translations: { <scope>: en, ui: uiEn } })`. Since rev 1, the testing handler throws on unknown keys (:244), and `core` keys are rendered in other projects (:467-470, :626).
- Specs that exercise an error path would throw. Examples are the pricing-grid Paddle error alerts (`pricing-grid.component.ts:98-140`) and the download-page `@else if (error())` branch.
- Fix: the recipe should include `core: coreEn` wherever a component renders an `I18nMessage`. Simplest: always pass the global scopes (`ui`, `core`, and `app` for app specs).

**N14. The `provideI18nTesting` translations shape holds one language per scope, but the CORE spec needs two.**
- Location: plan:242-243 define `translations: Record<scope, Translation>`.
- `seo.service.spec.ts` (plan:548-549) runs in `lang: 'ar'` and asserts an Arabic title alongside English `og:*`, which needs both `ar` and `en` for the same scope. The navigation spec (:569) likewise switches to `ar`.
- Fix: accept `translations: Partial<Record<SupportedLang, Record<string, Translation>>>`, or `{ en, ar }` per scope, and make the synchronous root loader serve each language's map. Settle this in F1, before CORE depends on it.

### Spot-checks of other claims new in revision 1

- `paddle-checkout.service.ts:234-239`: confirmed. The ternary interpolation builds the message, with `response.message` taking precedence.
- `cta-section.component.ts:78`: confirmed. The anchor holds only `or view pricing →`.
- `ci.yml:119-122` (`nx-set-shas`) and `:57` (`fetch-depth: 0`): confirmed.
- `download-page.component.ts:332` (`sm:text-left`) and `:456` (`toLocaleDateString('en-US', …)`): confirmed.
- `data-table.ts:203` and `stat-tile.ts:45` type unions: confirmed. They are now handled by AST detection.
- The admin glyph cases (`needs-attention-queue.ts`, `data-table.ts`) come from design-spec.md:619, and those routes are CSR-only. That is consistent.

## Round 0 record (revision 0, summary)

- **Verdict**: REVISE.
- **B1**: `i18n-check` allowed only `ui` as a foreign scope, while rule 3 made `core` services return keys rendered by the app, pricing, account and landing (`download-page.component.ts:80,374`, `pricing-grid.component.ts:537,540`).
- **B2**: converting `→` glyphs to icons (`cta-section.component.ts:78`), plus an undefined text-join, would break the 3.5 "matches the `main` baseline" check.
- **N1-N11**:
  - N1: premature app `i18n-check` in F4.
  - N2: F2a self-test depended on F2b rules.
  - N3: formatting inventory and regex false positives.
  - N4: static-vs-dynamic scope import ambiguity.
  - N5: island rule vs. design §3.5.
  - N6: `affected` blind spots.
  - N7: dependency-checks precedent.
  - N8: no 4.6 check.
  - N9: rollback order.
  - N10: user-facing items.
  - N11: missing-handler ordering and the testing handler.
- **Round-0 feasibility checks** still stand. They covered:
  - Transloco 8.4.0 internals, verified from the `npm pack` tarball: the `res.default` unwrap, `shareReplay` synchronous replay, synchronous pipe `lastValue`, `emitChange: false`, `keepCasing`, the default missing handler returning the key, and the `scope/en` fallback in `handleFailure`;
  - `@jsverse/utils` ESM `.js`, which needs the Jest whitelist;
  - `resolveJsonModule` in the app `tsconfig.json`, which covers lib sources in the app build;
  - no landing CSP;
  - Angular `ar` locale data with Latin symbols;
  - the module-boundary `depConstraints`;
  - the CI and deploy line anchors;
  - hydration: text-binding differences are not NG05xx, and `<html>` is outside hydration.

## Verdict

**APPROVED.** No blocking findings remain. Revision 1 resolves B1 and B2 without weakening any acceptance criterion, and it closes N1-N11. N12-N14 are small, local corrections. The team-leader can carry them into F1, where the testing-provider shape is decided, and into E2E, where the font assertion is written. They do not need another architecture round.
