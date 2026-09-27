# Code Logic Review — `TASK_2026_575_fee7`

## Batch 1

Scope: Batch 1 only (Tasks 1.1-1.4, IMPLEMENTED, uncommitted). Files reviewed in full:
`package.json`, `package-lock.json`, `tsconfig.base.json` (diff hunks only), and every file under
`libs/frontend/i18n/` (`CLAUDE.md`, `eslint.config.mjs`, `jest.config.ts`, `package.json`,
`project.json`, `tsconfig*.json`, `src/index.ts`, `src/test-setup.ts`, `src/lib/lang.config.ts`,
`src/lib/resolve-initial-lang.ts`, `src/lib/lang-preference.store.ts`, `src/lib/i18n-scope.ts`,
`src/lib/i18n-message.ts`, all four `*.spec.ts`, and the two `__fixtures__/*.json`).

Verification run: `node_modules/.bin/nx run-many -t lint,test,typecheck -p @ptah-extension/i18n`
→ 3/3 targets green, 4 test suites / 46 tests passed. `node_modules/@jsverse/transloco/fesm2022/jsverse-transloco.mjs:411-416`
(`prependScope`) read directly to verify the inline-loader key format this library must produce.

## Summary

| Metric              | Value                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Overall score       | 8/10                                                                                                     |
| Assessment          | APPROVED (with one non-blocking fix requested before Batch 2 closes the library's error surface further) |
| Blocking issues     | 0                                                                                                        |
| Serious issues      | 0                                                                                                        |
| Moderate issues     | 1                                                                                                        |
| Failure modes found | 2 (both intentional/handled)                                                                             |

## Five logic questions

### 1. How does this fail silently?

Nothing in this batch fails silently. `LangPreferenceStore.read()`/`write()` are the only
"swallow and continue" paths, and they are the plan's explicit, tested design (`lang-preference.store.ts:25-46`):
a storage failure degrades to `null`/no-op, never to a wrong language, and the caller
(`resolveInitialLang`) treats `null` identically to "nothing stored" — there is no path where a
storage failure is reported as success with wrong data. `defineI18nScope`'s loader wrapper
(`i18n-scope.ts:48-53`) is the opposite: a bad loader result is turned into a **rejected promise**,
not a silent default, so a broken scope shows up as a load failure rather than empty/garbled text.

### 2. What user action produces unexpected behaviour?

None observable yet — this batch ships no UI, service, or route wiring (that is Batch 2/7-8). The
only "user action" surface is the browser's stored-language value and `navigator.languages`, both
covered under Q3.

### 3. What input data produces a wrong answer?

- Tested and correct: `'xx'`, `'AR'`, `'ar-EG'`, `''` as stored values all fall through to `null`
  via `isSupportedLang` (`lang.config.ts:16-21`, exercised in
  `lang-preference.store.spec.ts:24-30` and `resolve-initial-lang.spec.ts:20-27`).
- Detection order is correct and tested: valid stored value wins over `navigator.languages`
  (`resolve-initial-lang.spec.ts:4-11`); `['fr-FR','ar-EG']` yields `'en'` because only
  `languages[0]` is inspected (`resolve-initial-lang.ts:21-24`, spec line 29-33) — this matches the
  plan's literal 3.3 rule verbatim.
- One latent case the tests do not cover: `resolveInitialLang` compares `first.toLowerCase().startsWith('ar')`.
  A browser reporting `'ars'` (Arabic, Najdi Spoken — a real BCP-47 subtag) or any other
  non-Arabic `ar*`-prefixed tag would be misclassified as Arabic. This is a pre-existing plan
  decision (the rule is defined at plan level, not invented here), so it is not a Batch 1 defect,
  but it is a real edge case with no test guarding it — flagged as Moderate below since Batch 1 is
  where the rule's "single source of truth" contract is established.
- `defineI18nScope`'s scope-name check only runs when `isDevMode()` is true
  (`i18n-scope.ts:43-47`, confirmed by the mocked-`isDevMode` spec at `i18n-scope.spec.ts:79-87`).
  In production a malformed name (`'panel-ui'`, digits, etc.) is silently accepted and later
  produces mismatched `scope/lang` keys wherever `scopeInlineLoader`/`scopeLoadPath` are used
  (Batch 2). Scope names are developer-authored constants, not external input, so this is a
  reasonable trade-off consistent with Angular's own `ngDevMode`-style assertions — not a defect,
  but worth stating since it is the only place in this batch where invalid data can reach
  production undetected.

### 4. What happens when a dependency fails?

- `LangPreferenceStore` treats every `localStorage` failure mode: `getItem` throwing
  (`lang-preference.store.spec.ts:32-37`), `setItem` throwing (`:39-44`), and the accessor itself
  throwing in hardened/private browsers (`:46-52`, mocking `window.localStorage` as a getter). All
  three degrade to "as if nothing were stored" without throwing out of the store.
- `defineI18nScope`'s loader: a rejected `load()` promise propagates as-is
  (`i18n-scope.spec.ts:59-65`, `'chunk failed'`), and a resolved-but-wrong-shape result
  (`null`, `'text'`, `42`, an array, `undefined`) is converted to a rejection naming the scope and
  language (`i18n-scope.ts:84-93`, spec `:46-57`). Both are handed to the caller as failures, never
  masked as empty translations — correct per the plan's "non-object loader result → load failure"
  requirement. What happens _after_ that rejection (retry, fallback to `en`, `console.error`) is
  `I18nService.init()`'s job in Batch 2, out of this batch's scope.

### 5. What is missing that the requirements never mentioned?

- No test exercises `resolveInitialLang` with `navigator.languages` containing a non-Arabic
  `ar*`-prefixed BCP-47 tag (see Q3). Low real-world likelihood, but it is exactly the kind of
  input-shape gap the "single source of truth" comment (`resolve-initial-lang.ts:10-13`) asks
  reviewers to guard closely, since the pre-paint script will later be tested only for equivalence
  with this function, not for its own correctness.
- No root `{Lib}Error` class is defined for this library, despite two library-boundary throw
  sites already existing in this batch (see Moderate-1 below).

## Failure modes

### Malformed scope name reaches production undetected

- Trigger: a scope defined with `isDevMode()` false (a production build) and a name outside
  `^[a-z][A-Za-z]*$`, e.g. `'panel-ui'`.
- Symptom: `defineI18nScope` returns a scope object anyway (`i18n-scope.ts:43-47`, and proven by the
  "does not validate the name in production mode" spec, `i18n-scope.spec.ts:79-87`); in Batch 2+
  `scopeLoadPath`/`scopeInlineLoader` would key Transloco's inline loader as `panel-ui/en`, which
  will not camelCase-match the way `getMappedScope` expects, per the plan's own "Scope names are
  therefore camelCase" note (implementation-plan.md, Transloco verified list).
- Evidence: `i18n-scope.ts:39-47`.
- Current handling: dev-only throw, silent pass-through in prod.
- Recommendation: acceptable as designed (developer-authored input, not user input); no change
  requested for Batch 1. Worth a one-line note in `CLAUDE.md`'s scope section that this guard is
  dev-only, so a later reviewer does not mistake it for a runtime input validator.

### Loader resolves to a non-object or throws

- Trigger: a scope's `import('./xx.json')` fails to bundle, or a hand-written loader returns the
  wrong shape.
- Symptom: the returned promise rejects with `[i18n] Loader for "<scope>/<lang>" resolved to
<type>, expected a translation object.` or the original rejection reason.
- Evidence: `i18n-scope.ts:84-93`; exercised in `i18n-scope.spec.ts:46-65`.
- Current handling: correct — converts to an explicit rejection, never a default `{}`.
- Recommendation: none for this batch. Batch 2 should be checked for whether `I18nService.init()`
  actually surfaces this (the plan promises a `console.error` and fallback to `en`), since a
  rejected scope load must not silently become an infinite pending state.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### Moderate-1: Plain `Error` at a library boundary violates `CONVENTIONS.md` §7

- File: `libs/frontend/i18n/src/lib/i18n-scope.ts:44-46` (`defineI18nScope`, a public entry point
  every consuming project calls) and `:90-92` (`toTranslation`, thrown from inside every scope's
  loader, i.e. reachable from any consumer that awaits a scope load).
- `CONVENTIONS.md:97-100` states explicitly: _"Each library has a root error class `{Lib}Error
extends Error`. Domain errors extend the root. Do **not** throw plain `Error` at a library
  boundary."_ This is an enforced, non-decorative rule elsewhere in the workspace — e.g.
  `libs/backend/agent-sdk/src/lib/errors/sdk.error.ts`,
  `libs/backend/auth-providers/src/lib/auth/provider-quota.error.ts`,
  `libs/backend/voice-contracts/src/lib/voice-provider-error.ts` all define a root error type
  for exactly this reason. No `I18nError` (or equivalent) exists anywhere under
  `libs/frontend/i18n/`, and neither `implementation-plan.md`'s Component 1 file list nor its
  "Failure behaviour" subsection mentions one — the plan is silent on this requirement rather than
  having consciously waived it.
- Impact: today this is purely a convention/typing gap, not a behavioural bug — both throw sites
  are exercised by tests and do propagate correctly (Q1/Q4 above). The risk grows with Batch 2,
  where `I18nService.init()`/`setLanguage()` will need to distinguish "scope load failed" from
  other rejection sources to implement the plan's documented fallback-to-`en`/`console.error`
  behaviour; a plain `Error` with only a string-prefixed message gives callers nothing to
  `instanceof`-check, pushing them toward fragile string-matching on `[i18n]`.
- Fix: introduce `I18nError extends Error` (or similar) in this library and have both throw sites
  use it, before Batch 2 adds more error-producing surfaces (`I18nMissingHandler`,
  `I18nService.init()`, `setLanguage()`) that would otherwise compound the same gap. Non-blocking
  for Batch 1's own correctness, but flagged now while the fix is still a two-call-site change.

### Minor: forward-declared `/testing` alias with no backing file yet

- File: `tsconfig.base.json` (diff) adds `"@ptah-extension/i18n/testing": ["./libs/frontend/i18n/src/testing/index.ts"]`,
  but `libs/frontend/i18n/src/testing/` does not exist on disk yet (confirmed:
  `find libs/frontend/i18n -type f` lists no `src/testing/*`).
- Impact: none today — nothing imports the alias yet, and `typecheck`/`lint`/`test` all pass. This
  is explicitly Batch 1's task file list per `batches.md:121` ("Task 1.2 ... `$ROOT/tsconfig.base.json`")
  and Batch 2 creates the file (`implementation-plan.md`'s file list: `src/testing/{index.ts,
provide-i18n-testing.ts}`). Documented here only so it is not mistaken for an oversight if Batch 2
  is reviewed independently.

## Data flow

1. `localStorage[storageKey]` (or a thrown accessor/method) → `LangPreferenceStore.read()`
   (`lang-preference.store.ts:25-33`) — OK: every throw path returns `null`; every non-`SupportedLang`
   string is rejected via `isSupportedLang`.
2. `{ stored, languages }` → `resolveInitialLang()` (`resolve-initial-lang.ts:19-26`) — OK for the
   tested matrix; gap noted above for non-Arabic `ar*` BCP-47 tags (Q3/Q5).
3. A caller's `{ en: () => import(...), ar: () => import(...) }` → `defineI18nScope()` builds a
   frozen `I18nScope` whose `loader[lang]` wraps the raw loader (`i18n-scope.ts:39-59`) — OK: dev-only
   name validation, production pass-through documented as a failure mode above.
4. `scope.loader[lang]()` → `toTranslation()` (`i18n-scope.ts:84-93`) — OK: object passes through,
   everything else becomes a named rejection.
5. `I18nScope` → `scopeLoadPath`/`scopeInlineLoader` (`i18n-scope.ts:62-77`) — OK and verified against
   the installed Transloco source: `scope/lang` matches exactly what `prependScope` in
   `node_modules/@jsverse/transloco/fesm2022/jsverse-transloco.mjs:411-416` produces, so a future
   `TranslocoService.load(path, { inlineLoader })` call keyed this way will resolve correctly.
6. `LANG_DIRECTION`/`ANGULAR_LOCALE`/`INTL_LOCALE`/`LANG_NATIVE_NAME` (`lang.config.ts:23-47`) are
   pure lookup tables keyed by `SupportedLang` — no missing-key path is reachable since
   `SupportedLang` is a closed union and every table is `Record<SupportedLang, ...>`, so TypeScript
   enforces completeness at compile time. OK.
7. No path in this batch reaches Angular DI, `I18nService`, or any route — those begin in Batch 2,
   out of scope here.

## Requirements fulfilment

| Requirement                                                                               | Status   | Gap                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 1.1: install + pin `@jsverse/transloco` 8.4.0                                        | COMPLETE | `package.json` diff is exactly the one line (verified via `git diff package.json`); lockfile diff is limited to the Transloco dependency tree (`@jsverse/transloco`, `@jsverse/transloco-utils`, `@jsverse/utils`, and that package's own `cosmiconfig`/`import-fresh`/`js-yaml`/`parse-json`/`path-type` sub-deps) — verified via `git diff package-lock.json` key scan. |
| Task 1.2: scaffold project + aliases                                                      | COMPLETE | `project.json` tags `["scope:shared","type:util"]`, `test`/`lint`/`typecheck` targets, no build target; `tsconfig.json`'s `resolveJsonModule` and `jest.config.ts`'s `transformIgnorePatterns: [...,'@jsverse']` both present.                                                                                                                                            | none                                                                      |
| Task 1.3: pure lang data, detection, persistence                                          | COMPLETE | All four data points (`SUPPORTED_LANGS`, `LANG_DIRECTION`, `ANGULAR_LOCALE`, `INTL_LOCALE` with `ar-u-nu-latn`) present; storage try/catch and server no-op confirmed; detection order confirmed against spec.                                                                                                                                                            | Non-Arabic `ar*` BCP-47 tag not covered by any spec (see Q3/Q5).          |
| Task 1.4: `I18nMessage` and `defineI18nScope`                                             | COMPLETE | Loader-per-language type is exhaustive (`Record<SupportedLang, ...>`); scope name pattern enforced in dev; `scope/lang` key format matches installed Transloco source.                                                                                                                                                                                                    | Error type is plain `Error`, not a library root error class (Moderate-1). |
| Batch 1 verification: `nx run-many -t lint,test,typecheck -p @ptah-extension/i18n` passes | COMPLETE | Re-ran directly: 3/3 targets green, 46/46 tests passed.                                                                                                                                                                                                                                                                                                                   | none                                                                      |
| Zero workspace imports (1.2)                                                              | COMPLETE | `grep` for `@ptah-extension                                                                                                                                                                                                                                                                                                                                               | libs/web                                                                  | libs/backend`under`src/`finds only a doc-comment mention of the library's own package name in`lang.config.ts:2`; no actual import statement references a workspace path. | none |

Implicit requirements not addressed: none found beyond Moderate-1 and the BCP-47 edge case, both
already logged above.

## Edge cases

| Case                                                            | Handled        | How                                                                                                                      | Concern                                                                        |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Throwing `getItem`                                              | YES            | try/catch → `null` (`lang-preference.store.ts:27-32`, spec `:32-37`)                                                     | none                                                                           |
| Throwing `setItem`                                              | YES            | try/catch, swallowed (`:39-45`, spec `:39-44`)                                                                           | none                                                                           |
| Throwing `localStorage` accessor itself                         | YES            | same try/catch wraps the property access too (spec `:46-52`, mocks the getter)                                           | none                                                                           |
| Invalid stored values (`'xx'`,`'AR'`,`'ar-EG'`,`''`)            | YES            | `isSupportedLang` rejects; `read()` returns `null` (spec `:24-30`)                                                       | none                                                                           |
| Server platform (`isBrowser=false`)                             | YES            | both methods short-circuit before touching `localStorage`; spec asserts `getItem`/`setItem` were never called (`:55-68`) | none                                                                           |
| Detection: valid stored wins over navigator                     | YES            | spec `resolve-initial-lang.spec.ts:4-11`                                                                                 | none                                                                           |
| Detection: `['fr-FR','ar-EG']` → `'en'` (first-only)            | YES            | spec `:29-33`                                                                                                            | none                                                                           |
| Detection: empty/undefined `navigator.languages`                | YES            | spec `:35-40`                                                                                                            | none                                                                           |
| Detection: non-Arabic `ar*` tag (`'ars'`, etc.)                 | NO             | `startsWith('ar')` would misclassify                                                                                     | Low likelihood; not tested; rule is plan-level, not a Batch 1 invention        |
| Non-object loader result (`null`,`'text'`,42,array,`undefined`) | YES            | `toTranslation` throws a named error (spec `i18n-scope.spec.ts:46-57`)                                                   | none                                                                           |
| Loader promise rejection                                        | YES            | propagates as-is (spec `:59-65`)                                                                                         | none                                                                           |
| Malformed scope name, dev mode                                  | YES            | throws with pattern in message (spec `:67-77`)                                                                           | none                                                                           |
| Malformed scope name, prod mode                                 | NO (by design) | passes through silently (spec `:79-87`)                                                                                  | acceptable — developer-authored constant, not external input; documented above |
| Scope inline-loader key format vs installed Transloco           | YES            | `scope/lang`, matches `prependScope` in `node_modules/@jsverse/transloco/fesm2022/jsverse-transloco.mjs:411-416` exactly | none                                                                           |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the missing `I18nError` root class (Moderate-1) is inexpensive to fix now, at two call
  sites, but will get more expensive to retrofit once Batch 2 adds `I18nService.init()`,
  `setLanguage()`, and `I18nMissingHandler`, all of which are error-producing surfaces per the
  plan's own "Failure behaviour" section.
- What a robust implementation would add: (1) an `I18nError extends Error` root class per
  `CONVENTIONS.md` §7, used by both current throw sites and reused by Batch 2's service-layer
  errors; (2) a spec asserting `resolveInitialLang` does not misclassify a non-Arabic `ar*`-prefixed
  BCP-47 tag (or an explicit code comment stating the rule intentionally treats any `ar*` prefix as
  Arabic, if that is the accepted trade-off); (3) a one-line `CLAUDE.md` note that the scope-name
  guard is dev-only, not a runtime validator.

## Judgement calls (team-leader items)

- **Plain `Error` with `[i18n]` prefix vs. `CONVENTIONS.md` §7 root error class:** a genuine,
  evidenced deviation from an actively-enforced repo convention (see Moderate-1). Not blocking for
  Batch 1's own correctness — both throw sites work as intended and are tested — but it should be
  fixed before more error-producing code lands on top of it in Batch 2.
- **`@nx/dependency-checks` rule omitted from `eslint.config.mjs`:** correct, not a finding. Verified
  against the two closest precedents: `libs/frontend/markdown` (has a real `build` target via
  `@nx/angular:ng-packagr-lite`) _does_ configure `@nx/dependency-checks`, while `libs/web/ui`
  (no build target, consumed from source — the same shape as this library) has no
  `@nx/dependency-checks` block either. `@ptah-extension/i18n` has no build target
  (`project.json` targets: `test`/`lint`/`typecheck` only), so omitting the rule matches existing
  workspace practice, not a gap.
- **`@angular/router` peer dependency unused until Batch 2:** correct, not a finding. The plan
  explicitly declares all runtime peers (`@angular/core`, `@angular/common`, `@angular/router`,
  `@jsverse/transloco`, `rxjs`) in the library's `package.json` "for documentation"
  (implementation-plan.md, Component 1, Dependencies), and Batch 1's own task list never claims to
  use routing — `i18n-scopes.resolver.ts` (which needs `ResolveFn`/`@angular/router`) is Task 2.1,
  not in this batch. `grep` confirms no `.ts` file in this batch imports `@angular/router`; the only
  occurrences are the `package.json` peer entry and the `CLAUDE.md` prose. Declaring an
  as-yet-unused peer ahead of the file that needs it is normal for an atomic "config files are
  atomic" batch (per `batches.md`'s stated batching rationale) and carries no runtime cost since
  `peerDependencies` are not bundled.

WROTE: /home/user/ptah-extension/.ptah/specs/TASK_2026_575_fee7/code-logic-review.md — APPROVED, 0 blocking, 0 serious, 1 moderate, 2 failure modes
