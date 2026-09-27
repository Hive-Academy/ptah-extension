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

## Batch 2

Scope: Batch 2 only (Tasks 2.0-2.4, IMPLEMENTED, uncommitted). Files read in full:
`libs/frontend/i18n/src/lib/{i18n.error.ts, i18n-options.ts, i18n.service.ts, i18n-scopes.resolver.ts,
i18n-missing.handler.ts, provide-i18n.ts, i18n-scope.ts, resolve-initial-lang.ts, index.ts}`,
`libs/frontend/i18n/src/lib/pipes/{i18n-date.pipe.ts, i18n-number.pipe.ts}`,
`libs/frontend/i18n/src/testing/{index.ts, provide-i18n-testing.ts}`, `libs/frontend/i18n/CLAUDE.md`,
`libs/frontend/i18n/jest.config.ts`, and every `*.spec.ts` beside those files (12 suites). Diffs read for
`i18n-scope.spec.ts` and `resolve-initial-lang.spec.ts` (Task 2.0's carry-over changes only). Cross-checked
against `@jsverse/transloco@8.4.0` source (`node_modules/@jsverse/transloco/fesm2022/jsverse-transloco.mjs`):
`DefaultFallbackStrategy`/`handleFailure` (:296-315, :937-970), `load()`/cache/`shareReplay` (:571-619),
`_handleMissingKey` (:842-850), `TranslocoPipe.transform`/`updateValue` (:1355-1420).

Verification run: `node_modules/.bin/nx run-many -t lint,test,typecheck -p @ptah-extension/i18n --skip-nx-cache`
→ lint clean, typecheck clean, **12 suites / 106 tests passed**. `nx run degradation-audit:lint` → 0 sites
under `libs/frontend/i18n` (baseline 0, unchanged from Batch 1). `nx graph --file=...` → `@ptah-extension/i18n`
has an empty workspace-dependency array (1.2 still holds). Two throwaway scratch specs (not committed, deleted
after use) were run directly against `provideI18nRuntime`/`I18nService` to observe Transloco's real caching
behaviour under a scope whose loader fails once then recovers — see Serious-1 below.

### Summary

| Metric              | Value                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Overall score       | 6/10                                                                                                                            |
| Assessment          | NEEDS_REVISION (one Serious, evidence-backed gap in the retry/failure contract; the rest of the batch is sound and well tested) |
| Blocking issues     | 0                                                                                                                               |
| Serious issues      | 1                                                                                                                               |
| Moderate issues     | 2                                                                                                                               |
| Failure modes found | 4                                                                                                                               |

### Five logic questions

1. **How does this fail silently?** Nothing returns a success-looking result for a real failure — `setLanguage` returns `false`, `init()` logs and falls back to English, the resolver logs and resolves `true` (by design, so navigation is never blocked; the affected keys degrade to English/`''`, never a raw key). The one place a failure is _effectively_ laundered into permanent silence is Serious-1: once a scope/lang path fails once, Transloco's `shareReplay(1)` cache (`jsverse-transloco.mjs:618`) makes every later retry of that same path fail immediately from the cached error, without ever calling the loader again — `console.error`/`false` still fire each time, so it is not strictly silent, but there is no code path in this library that ever clears the stuck entry, so a transient failure becomes a permanent one with no visible signal that it is now unrecoverable.
2. **What user action produces unexpected behaviour?** Clicking the (future) language switcher a second time after a first failed switch: the user gets `false` again, identically, even if the network/chunk problem that caused the first failure is gone — see Serious-1. A route revisited after its scope failed to load once (`i18nScopesResolver`) renders empty text for that scope's keys on every future visit, not just the one where the load failed, until an unrelated successful load elsewhere in the app happens to flush Transloco's `failedLangs` set (`jsverse-transloco.mjs:969-971`, called from `handleSuccess`).
3. **What input data produces a wrong answer?** None found that produces a _wrong_ (non-empty, mistranslated) answer — every missing-key and load-failure path is proven by test to degrade to English or `''`, never to garbled or mismatched text. `toNumber` (`pipes/i18n-number.pipe.ts:60-64`) throws `I18nError` rather than silently coercing `NaN`/`0` for a non-numeric string, which is correct and tested (`i18n-number.pipe.spec.ts:56-60`).
4. **What happens when a dependency fails?** Transloco's own load pipeline is retried once (`failedRetries: 1`, `provide-i18n.ts:84`) and then, with `NoLoadFallbackStrategy` (`provide-i18n.ts:119-124`), throws `TranslationLoadError` instead of Transloco auto-switching the active language — verified directly against `handleFailure` (`jsverse-transloco.mjs:937-970`: `getNextLangs()→[]` ⇒ `!nextLang` ⇒ throw). `I18nService.init()` catches this, retries English once (a real retry, since English was never attempted when the first language's `for` loop threw before reaching it — confirmed by test and by reading `load()`'s language loop, `i18n.service.ts:186-203`), and falls back with one `console.error`. `setLanguage()` and `i18nScopesResolver` also catch it, but neither performs a real retry: both re-enter the exact same cached, already-failed Transloco path on every subsequent call (Serious-1).
5. **What is missing that the requirements never mentioned?** (a) No mechanism to clear a stuck Transloco cache entry after a transient failure (Serious-1) — the plan's "Failure behaviour" section (implementation-plan.md:256-260) specifies what a _single_ failure does, not what a _repeated_ one does. (b) The dev-mode duplicate-scope assertion (`i18n.service.ts:148-159`) is unreachable in its intended "fail loud" form whenever a scope is registered through a route resolver, because `i18nScopesResolver`'s blanket `catchError` (`i18n-scopes.resolver.ts:34-37`) turns it into the same quiet `console.error` as a network failure (Moderate-1). (c) No spec exercises `init()` racing a concurrent `setLanguage()` call (both share `latestRequest`); the mechanism looks correct by inspection but is untested.

### Failure modes

#### A failed scope/lang load never retries; it replays the cached error forever

- Trigger: any `I18nService.load()` call for a given `scope/lang` path — from `init()`, `setLanguage()`, or `loadScopes()`/`i18nScopesResolver` — fails once (a transient chunk-import error, a flaky bundled-JSON load, or in a future HTTP-loader consumer such as the webview, a network blip).
- Symptom: every later call that needs that same path (a retry of `setLanguage(lang)`, a repeat visit to the route that failed) fails immediately and identically, without the scope's `loader` function ever being invoked again, until some _unrelated_ path elsewhere in the app succeeds for the first time and incidentally flushes Transloco's `failedLangs` cache-eviction (`jsverse-transloco.mjs:969-971`).
- Evidence: `i18n.service.ts:186-203` (`load()` always calls `this.transloco.load(scopeLoadPath(...), {...})`, i.e. always goes through Transloco's own `path → shareReplay(1)` cache at `jsverse-transloco.mjs:571-619`, and never removes or bypasses a cached entry). Confirmed empirically: a scratch spec built on the exact `provideI18nRuntime`/`I18nService` pair, with a scope loader that rejects on its first Arabic call and resolves on every call after, showed `setLanguage('ar')` return `false` on the first call (expected) **and again on a second, independent call**, with the underlying loader's call counter still at `1` — i.e. the loader was never invoked a second time. (Not committed; reproducible with the same shape as `controllableScope` in `i18n.service.spec.ts:24-47`, but with a loader that fails once and then recovers instead of failing permanently.)
- Current handling: `setLanguage` returns `false` and logs (`i18n.service.ts:102-105`); `i18nScopesResolver` logs and resolves `true` (`i18n-scopes.resolver.ts:34-37`). Neither distinguishes "this will keep failing until something else fixes it" from an ordinary one-off failure, and neither attempts to make the retry real.
- Recommendation: before a retried `load()` call for a path that is known to have failed, evict it from Transloco's cache so the loader runs again — Transloco exposes no public "clear one path" API in the verified surface, so the practical fix is for `I18nService` to track its own failed `(scope, lang)` pairs and, on the next `setLanguage`/`loadScopes` targeting one of them, load through a **new** scope-relative path segment, or otherwise force a fresh Transloco load (for example, by wrapping the loader so a `console.warn`-with-counter design causes Transloco to see a different cache key). At minimum, document the sticky-failure behaviour in `CLAUDE.md`'s "Errors" section and in the plan's failure-behaviour contract, since today's wording ("the state is unchanged and the call returns `false`") reads as "try again later," not "this path is now permanently stuck short of an unrelated coincidence."

#### Dev-mode duplicate-scope assertion is unreachable through the resolver

- Trigger: two different `I18nScope` objects are registered under the same scope name (a copy-paste or refactor mistake), and at least one of them is registered via a route's `resolve: { i18n: i18nScopesResolver(...) }` rather than `globalScopes`/a direct `loadScopes()` call.
- Symptom: in dev mode the intent is to throw loudly so the mistake is caught immediately (`i18n.service.ts:148-159`, and it is proven to do so when `loadScopes()` is subscribed to directly — `i18n.service.spec.ts:287-299`). Through the resolver, the same throw is caught by `catchError` (`i18n-scopes.resolver.ts:34-37`), logged as `'[i18n] Could not load route scopes.'`, and swallowed identically to a genuine network failure; navigation proceeds and nothing distinguishes a wiring bug from a chunk-load hiccup except reading the console.
- Evidence: `i18n.service.ts:148-159` (the throw, dev-mode only) and `i18n-scopes.resolver.ts:24-39` (the unconditional `catchError`).
- Current handling: swallowed into the resolver's generic failure path.
- Recommendation: this is a genuine, evidenced tension with the plan's own "resolver failure: it logs and resolves `true`, so navigation is never blocked" rule (implementation-plan.md:256-260), which is architecturally correct and should stay — a resolver must not hang SSG on a wiring bug either. The gap is that the _loud_ dev-only assertion loses its loudness specifically on the one path (route resolvers) that most of the app will use from Batch 9 onward. Recommend either (a) re-throwing synchronously, outside the Observable, for this specific `I18nError` subtype before it reaches `catchError` (so it surfaces as an unhandled dev-mode error rather than a caught one), or (b) at minimum `console.error`-tagging it distinctly (e.g. `'[i18n] DEV: duplicate scope registration'`) so it is grep-able and does not read identically to a transient chunk failure in CI/browser logs. Non-blocking: matches the plan's explicit resolver contract, but should be resolved before Batch 9 wires the first resolver-driven feature scope.

#### `retryEnglish()` is a real second attempt only because English is not attempted in the failing call

- Trigger: `init()` fails to load a non-English language.
- Symptom: `retryEnglish()` (`i18n.service.ts:206-214`) actually re-invokes the English loader, because `load()`'s `for (const lang of langs)` loop (`i18n.service.ts:186-203`) throws out on the first language's failure and never reaches `'en'` in `withEnglish(lang)` — so English's Transloco cache entry is still unpopulated when `retryEnglish()` runs. This is correct today, but it is an accidental consequence of loop ordering, not a designed guarantee; if `withEnglish()`'s order or `load()`'s loop-vs-`Promise.all` shape ever changes so that English is attempted before or alongside the failing language, `retryEnglish()` would silently become a no-op that replays the same cached failure (the same mechanism as the failure mode above).
- Evidence: `i18n.service.ts:186-203` (sequential `for` loop over `langs`, `withEnglish` puts the target language first, `i18n.service.ts:226-228`); confirmed by the passing test `i18n.service.spec.ts:167-180`.
- Current handling: works today; tested only for the single-failure case, not for "English also already cached-failed."
- Recommendation: add a one-line comment at `withEnglish`/`load()` stating the ordering dependency `retryEnglish()` relies on, so a future refactor does not break it silently; a spec forcing English to already be cache-failed before `retryEnglish()` runs would also catch a regression (currently `i18n.service.spec.ts:182-195` tests "English fails too" only for the first attempt, not a _retried_ attempt).

#### Non-object/throwing scope loader results are converted, never defaulted (carried from Batch 1, now with the root error class)

- Trigger: a scope's loader rejects, or resolves to a non-object.
- Symptom: `toTranslation()` throws `I18nError` (`i18n-scope.ts:87-96`), and it is `instanceof I18nError` for the "wrong shape" case and passes the _original_ error through unchanged for a real rejection (`i18n-scope.spec.ts` diff: both are now asserted separately). `I18nService.load()`/`i18nScopesResolver` correctly surface this as a load failure per the mode above, never as empty text silently accepted.
- Evidence: `i18n-scope.ts:87-96`.
- Current handling: correct, and the Moderate-1 fix from Batch 1 (the root `I18nError` class) is applied at every throw site in this batch — confirmed no `throw new Error(` remains anywhere under `libs/frontend/i18n/src/lib` or `src/testing` outside specs.
- Recommendation: none.

### Blocking issues

None found.

### Serious issues

#### Serious-1: A failed scope/lang load is permanently stuck until an unrelated load succeeds elsewhere

- File: `libs/frontend/i18n/src/lib/i18n.service.ts:186-203` (`load()`, the single place every load path funnels through), interacting with `@jsverse/transloco`'s uncleared `shareReplay(1)` cache (`node_modules/@jsverse/transloco/fesm2022/jsverse-transloco.mjs:571-619`, `:937-971`).
- Scenario: a scope/lang chunk fails to load once (a genuinely transient condition — a lazy `import()` racing an unrelated navigation, a momentary browser hiccup, or, for the webview reuse this library explicitly targets (`CLAUDE.md`, "Integration points"), a real network loader). Every later attempt to load that exact path — a user retrying the language switcher, or simply revisiting the same route — fails immediately from Transloco's cached error without the scope's own loader function ever running again, until some other, unrelated scope/lang load succeeds for the first time anywhere in the app and incidentally clears Transloco's `failedLangs` set.
- Impact: the language switcher (or a feature route) can become durably broken for the rest of the session after one bad load, with no way for the library's own code, or a consumer built on it, to recover short of a full page reload — which contradicts the natural reading of the plan's stated contract ("setLanguage failure: the state is unchanged and the call returns `false`", implementation-plan.md:259) as a transient, retryable failure. Confirmed empirically (see the "A failed scope/lang load never retries" failure mode above): a loader that fails once and recovers on every subsequent call was still shown as failed on a second, independent `setLanguage()` call, with the loader's own call counter unchanged.
- Fix: `I18nService` should not rely on Transloco's raw `path` as the sole cache key for a retry. Options include: tracking failed `(scope, lang)` pairs internally and forcing a fresh Transloco load on the next attempt (e.g. by varying the loader's registered inline-loader key, or by re-registering the scope under a cache-busting suffix known only to Transloco's loader map before retrying), or filing this as a known limitation with a documented workaround (e.g. `setLanguage` clearing and reapplying `TranslocoService`'s scope registration) before this ships to users who can retry a failed switch. At minimum this needs a test that retries the same failing path a second time and asserts recovery once the underlying condition clears, because none of the current specs exercise a second attempt at an already-failed path.

### Moderate and minor issues

#### Moderate-1: Dev-mode "fail loud" duplicate-scope assertion is muted by the resolver's blanket catch

- File: `libs/frontend/i18n/src/lib/i18n-scopes.resolver.ts:24-39`, interacting with the throw at `i18n.service.ts:148-159`.
- See "Dev-mode duplicate-scope assertion is unreachable through the resolver" above for the full scenario. Non-blocking because it matches the plan's explicit, deliberate "resolver never blocks navigation" rule, but it measurably weakens a guard whose entire purpose is to fail loudly in dev.
- Fix: as recommended above — a distinct log tag or a synchronous rethrow specifically for `I18nError` before the generic `catchError`, so it is not indistinguishable from an ordinary chunk-load failure.

#### Moderate-2: `retryEnglish()`'s "real retry" depends on an unstated ordering invariant in `load()`/`withEnglish()`

- File: `libs/frontend/i18n/src/lib/i18n.service.ts:75-91` (`init()`), `:186-203` (`load()`), `:206-214` (`retryEnglish()`), `:226-228` (`withEnglish()`).
- See the corresponding failure mode above. Today it works, and is tested for the "single failure" case, but the guarantee is implicit and untested for the "retry after both already cache-failed" case, which is exactly the scenario Serious-1 describes for `init()` specifically (not just `setLanguage`).
- Fix: a code comment plus a spec for the "English retry after both languages already failed once" case.

#### Minor: `I18nMissingHandler.failure` keeps only the first `throw`-policy miss

- File: `libs/frontend/i18n/src/lib/i18n-missing.handler.ts:44`, `:66-68`, `:84-88`.
- If a component under `provideI18nTesting` renders two different mistyped keys in the same test, only the first is retained for `takeFailure()`; TestBed teardown still fails the test (each `handle()` call throws independently, so the _first_ offending render already breaks change detection in most real templates), so this is unlikely to hide a defect in practice, but the reported failure message would name only the first typo, not every one present. Low impact; worth a one-line `CLAUDE.md` note if it is ever surprising in practice.

### Data flow

1. `I18nOptions` (`storageKey`, `globalScopes`) → `I18N_OPTIONS` token (`i18n-options.ts`) → `I18nService` — OK, no import cycle (verified: `i18n.service.ts` imports `i18n-options.ts`; `provide-i18n.ts` imports both `i18n-options.ts` and `i18n.service.ts`, never the reverse).
2. `provideI18n`/`provideI18nTesting` → `provideI18nRuntime` → Transloco config, `EmptyRootLoader`/`TestingRootLoader`, `I18nMissingHandler` (registered after `provideTransloco`, verified against the real default registration at `jsverse-transloco.mjs:1456-1462` and by `provide-i18n.spec.ts:37-44`), `NoLoadFallbackStrategy` (verified against `handleFailure`'s real branching), Arabic locale data — OK, provider order is exactly as the plan requires (implementation-plan.md:229) and is asserted by test.
3. `provideAppInitializer(() => inject(I18nService).init())` → `init()` detects the language (server always `en`, browser via `resolveInitialLang`), registers `globalScopes`, loads root + scopes for `[lang, en]` (or just `[en]` when `lang === 'en'`) — OK, every branch (success, storage-throw, invalid-stored, server, single-language failure, both-languages failure) is tested. Gap: a _second_ failure of the same path after `retryEnglish()` already exhausted it is not modelled (Serious-1/Moderate-2).
4. Route navigation → `i18nScopesResolver` → `I18nService.loadScopes()` → `register()` + `load(withEnglish(current), scopes)` → `true` always, `catchError` logs on any failure — OK for a single failure; a repeat visit to a route whose scope is stuck (Serious-1) silently keeps rendering the missing-handler's `''`/English fallback forever, with no new console signal after the first visit (Transloco's cache short-circuits before `i18nScopesResolver`'s own `catchError` even sees a _new_ error — the cached error is what gets replayed and re-logged each time, so the user does keep seeing the console error, but the underlying condition is never re-checked).
5. `setLanguage(lang)` → `loadRegistered(lang)` (loads `[lang]` for every registered scope, then repeats for any scope registered mid-flight, confirmed by `i18n.service.spec.ts:249-266`) → on success, `apply(lang)` + `store.write(lang)`; on failure, state untouched, `false` returned — OK for the tested "latest wins" and "mid-switch registration" cases; the retry-after-failure gap is Serious-1.
6. `I18nMissingHandler.handle()` → English lookup via lazily-injected `TranslocoService` with a re-entrancy guard (`resolvingEnglish`) → English value, or `''`/throw (per `MissingKeyPolicy`) — OK, and independently cross-checked against Transloco's own `_handleMissingKey` (`jsverse-transloco.mjs:842-850`): `useFallbackTranslation: false` in the config means Transloco always defers to this handler rather than its own fallback machinery, exactly as the plan requires. The `throw`-policy path's interaction with `TranslocoPipe.transform`/`updateValue` (`jsverse-transloco.mjs:1375-1410`, synchronous `.subscribe()` callback) is real, not just plausible: the `failure` field is set synchronously inside `handle()` before the throw, so it survives regardless of whether RxJS's own error handling for a plain-function `subscribe()` callback defers the throw to a timer (it does, per the code comment, `provide-i18n-testing.ts:79-82`) — `takeFailure()` at `DestroyRef.onDestroy` reads a value that was already set well before teardown runs. Verified working end to end by `provide-i18n-testing.spec.ts:137-148`.
7. `I18nDatePipe`/`I18nNumberPipe` → memoised on `(value, format/digitsInfo, timezone?, lang)`, `formatDate`/`formatNumber` with `ANGULAR_LOCALE[lang]` — OK; Arabic output verified free of Arabic-Indic digits (`٠-٩`) by both pipe specs, and the pipes read `I18nService.lang()` before the null/blank check so a language switch is tracked even when the current value renders nothing.

### Requirements fulfilment

| Requirement                                                                                                                                                                                                                                          | Status                                                              | Gap                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 2.0: `I18nError` root class, both `i18n-scope.ts` throw sites use it, barrel export, `ar*` comment + spec, `CLAUDE.md` dev-only note                                                                                                            | COMPLETE                                                            | None. `grep` confirms no `throw new Error(` remains under `src/lib`/`src/testing` outside specs.                                                                                                                                   |
| Task 2.1: `I18nService` signals, `init()` never rejects/falls back to `en`/logs once, server short-circuits, `setLanguage` loads-then-switches/returns `Promise<boolean>`/latest-wins, resolver logs+resolves `true`, dev-mode duplicate-scope error | COMPLETE for the single-failure case; PARTIAL for repeated failures | Serious-1: a _retried_ `setLanguage`/resolver call against an already-failed path never really retries. Moderate-1: the dev duplicate-scope error is swallowed identically to a network failure when reached through the resolver. |
| Task 2.2: `provideI18n`/`I18nMissingHandler`, handler registered after `provideTransloco`, prod `''` never the key, English fallback when `ar` misses                                                                                                | COMPLETE                                                            | None; independently verified against Transloco's default-handler registration and `_handleMissingKey` source.                                                                                                                      |
| Task 2.3: `provideI18nTesting`, N14 per-language shape, N13 recipe documented, throw on a key missing everywhere                                                                                                                                     | COMPLETE                                                            | The N13 recipe is documented in `CLAUDE.md` but not yet exercised by a real consumer spec — expected, since no lib batch has landed yet; not a Batch 2 gap.                                                                        |
| Task 2.4: `i18nDate`/`i18nNumber` pipes, memoised, no `Intl` allocation on a cache hit, null/undefined/`''` → `null`, barrel completion                                                                                                              | COMPLETE                                                            | None. `formatDate`/`formatNumber` mocks confirm zero extra calls on a cache hit.                                                                                                                                                   |
| Batch 2 verification: lint/test/typecheck; no `throw new Error(`; empty workspace-dependency graph                                                                                                                                                   | COMPLETE                                                            | Re-ran directly: 106/106 tests, lint clean, typecheck clean, graph empty.                                                                                                                                                          |

Implicit requirements not addressed: a retry path for a previously-failed scope/lang load (Serious-1); a way to tell a dev-mode wiring error apart from a runtime load failure in resolver logs (Moderate-1).

### Edge cases

| Case                                                                                                                                                                                                                 | Handled                                    | How                                                                                                                                                                                          | Concern                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Stored `ar`, server platform, invalid stored value, storage-getter throws                                                                                                                                            | YES                                        | `i18n.service.spec.ts:99-153`                                                                                                                                                                | none                                                                                                                              |
| Server always renders English regardless of storage                                                                                                                                                                  | YES                                        | `i18n.service.spec.ts:155-165`                                                                                                                                                               | none                                                                                                                              |
| Single-language load failure at `init()` (falls back to English, one log)                                                                                                                                            | YES                                        | `i18n.service.spec.ts:167-180`                                                                                                                                                               | none                                                                                                                              |
| Both languages fail at `init()` (never rejects, renders `''`, never the key)                                                                                                                                         | YES                                        | `i18n.service.spec.ts:182-195`                                                                                                                                                               | Only the _first_ attempt is tested; a retried `init()`/`setLanguage` against the same failed path is not (Serious-1, Moderate-2). |
| `setLanguage` success: loads-then-switches-then-stores                                                                                                                                                               | YES                                        | `i18n.service.spec.ts:199-214`                                                                                                                                                               | none                                                                                                                              |
| `setLanguage` failure: state unchanged, `false`                                                                                                                                                                      | YES                                        | `i18n.service.spec.ts:216-230`                                                                                                                                                               | Same call retried is not tested — the actual behaviour (permanently stuck) diverges from what a reader would assume.              |
| Concurrent `setLanguage` calls, latest wins                                                                                                                                                                          | YES                                        | `i18n.service.spec.ts:232-247`                                                                                                                                                               | none                                                                                                                              |
| Scope registered mid-switch is also loaded                                                                                                                                                                           | YES                                        | `i18n.service.spec.ts:249-266`                                                                                                                                                               | none                                                                                                                              |
| Duplicate scope, same loader (no-op) vs different loader (dev throw)                                                                                                                                                 | YES (direct call) / PARTIAL (via resolver) | `i18n.service.spec.ts:287-299`                                                                                                                                                               | Through `i18nScopesResolver` the throw is swallowed (Moderate-1); no spec exercises that path.                                    |
| Resolver: no `HttpClient` provided, bundled JSON scope loads                                                                                                                                                         | YES                                        | `i18n-scopes.resolver.spec.ts:70-74`                                                                                                                                                         | none                                                                                                                              |
| Resolver: lazy-source rejection, scope-load rejection                                                                                                                                                                | YES                                        | `i18n-scopes.resolver.spec.ts:92-115`                                                                                                                                                        | Only a single failure per test; no repeat-visit/retry case (Serious-1).                                                           |
| Missing key in active language only → English, with dev warning                                                                                                                                                      | YES                                        | `i18n-missing.handler.spec.ts:63-80`                                                                                                                                                         | none                                                                                                                              |
| Missing key in both, prod → `''`, no warning; dev → `''`, warning                                                                                                                                                    | YES                                        | `i18n-missing.handler.spec.ts:82-98`                                                                                                                                                         | none                                                                                                                              |
| Missing-handler re-entrancy (English lookup itself misses)                                                                                                                                                           | YES                                        | `i18n-missing.handler.spec.ts:100-106`                                                                                                                                                       | none                                                                                                                              |
| `throw` policy: throws `I18nError`, still falls back for a partial miss                                                                                                                                              | YES                                        | `i18n-missing.handler.spec.ts:109-124`                                                                                                                                                       | none                                                                                                                              |
| `provideI18nTesting`: synchronous render, N14 per-language lookup, storage/document untouched, `setLanguage` switch, throw-from-TS immediately, throw-from-template at teardown, clean teardown when nothing missing | YES                                        | `provide-i18n-testing.spec.ts` (all cases)                                                                                                                                                   | none                                                                                                                              |
| Pipes: memoised on `(value, format/digitsInfo, lang)`, null/undefined/''/NaN → `null`, reformat after `setLanguage` without pipe re-creation, Arabic Western digits, non-numeric string throws `I18nError`           | YES                                        | `i18n-date.pipe.spec.ts`, `i18n-number.pipe.spec.ts`                                                                                                                                         | none                                                                                                                              |
| Jest resolves dynamic `import('./en.json')`/`import('./ar.json')` inside scope files (A2)                                                                                                                            | YES                                        | `i18n-scope.spec.ts` fixtures, `i18n.service.spec.ts` fixture scope, `i18n-scopes.resolver.spec.ts:25-28`, `provide-i18n.spec.ts:18-21` all import real `__fixtures__/{en,ar}.json` and pass | none                                                                                                                              |

### Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: Serious-1 — a scope/language load that fails once stays failed for the rest of the session across every later retry (`setLanguage`, a revisited route), because every load path in `I18nService` funnels through Transloco's `shareReplay(1)`-cached `load(path)` with no mechanism to evict a stale failure, confirmed by direct experiment (loader recovers after its first call; `setLanguage` still reports `false` on a second, independent attempt, with the loader never re-invoked).
- What a robust implementation would add: (1) a real retry path — internal tracking of failed `(scope, lang)` pairs plus a way to force Transloco to re-attempt them, with a spec proving recovery after a transient failure clears; (2) a way to distinguish a dev-mode wiring assertion from an ordinary load failure in resolver logs, so Moderate-1 does not require reading source to diagnose; (3) an explicit code comment (and ideally a regression spec) pinning the load-order invariant that makes `retryEnglish()` a real retry today (Moderate-2).

## Batch 2 — round 2

Scope: the rework of round 1's findings. Files read in full (current versions):
`libs/frontend/i18n/src/lib/{i18n.service.ts, i18n-scope.ts, i18n-scopes.resolver.ts}` and their specs,
`libs/frontend/i18n/CLAUDE.md`; re-read for consistency (unchanged since round 1, confirmed by content):
`provide-i18n.ts`, `testing/provide-i18n-testing.ts`, `src/index.ts` (diffed: only additive barrel exports
from Task 2.0-2.4, already reviewed in round 1). `i18n-scope.spec.ts` diffed against round 1 (loses the
`scopeInlineLoader` test, since that function was removed — `defineI18nScope`'s output is no longer fed to
Transloco as an inline loader at all). Cross-checked against `@jsverse/transloco@8.4.0` source for
`EmptyRootLoader`/`TestingRootLoader`'s never-fails claim (both wrap a synchronous `of({...})`, which cannot
error) and for `TranslocoService.setTranslation`/`_loadDependencies` semantics.

Verification run: `node_modules/.bin/nx run-many -t lint,test,typecheck -p @ptah-extension/i18n --skip-nx-cache`
→ lint clean, typecheck clean, **12 suites / 112 tests passed** (106 → 112: six new specs, matching the six
round-1 gaps: English-real-retry, switch-retries-after-failure, single-retry-recovers, concurrent-dedup,
no-reload-of-a-loaded-pair, resolver-revisit-recovers, resolver-wiring-tag). `nx run degradation-audit:lint` →
still 0 sites under `libs/frontend/i18n` (baseline 0, unchanged). `grep` confirms no `throw new Error(` under
`src/lib`/`src/testing` outside specs. Three throwaway scratch specs (not committed, deleted after use) were
run directly against the reworked `I18nService` to independently verify the retry mechanism and to probe the
`unwrapJsonModule` heuristic with a translation object that legitimately has a top-level `default` key — see
Serious-2 below.

### Round-1 items, re-verified

1. **Serious-1 (a failed scope/lang load never retried) — FIXED, independently confirmed.** The design no longer routes scope loads through `TranslocoService.load(path)` (Transloco's own `shareReplay(1)`-cached pipeline, the actual cause) at all. `I18nService.loadScope()` (`i18n.service.ts:209-225`) now runs `scope.loader[lang]()` itself, with its own `loadedPaths`/`inFlight` bookkeeping, and calls `this.transloco.setTranslation(translation, path, { emitChange: false })` directly — bypassing Transloco's `load()`/cache entirely for scopes. A failed path is never added to `loadedPaths` (`i18n.service.ts:216-222`), so the next caller re-invokes the real loader. This is exactly the "only public Transloco API" fix asked for: `setTranslation` and `getActiveLang`/`load(lang)` (root only) are the only Transloco surface touched; there is no private-cache reach-in and no path-suffix trick. Confirmed by three independent lines of evidence:
   - `i18n.service.spec.ts:224-238` ("retries a scope that failed on an earlier switch"): `setLanguage('ar')` fails once (`global.failTimes('ar', 2)`, covering the loader's own immediate retry, `i18n.service.ts:215-217`), returns `false`, `global.callsFor('ar')` is `2`; a **second, independent** `setLanguage('ar')` call then succeeds and `callsFor('ar')` becomes `3` — the loader really ran again, not a cache replay.
   - `i18n-scopes.resolver.spec.ts:109-126` ("loads a scope on a revisit after it failed on the first navigation"): the first `run(flaky)` fails (`calls` reaches 2, both the load and its immediate retry), the key renders `''`; a **second, separate** `run(flaky)` call succeeds, `calls` reaches 3, and the key now renders `'Hello'` — proves recovery on a genuinely later resolver invocation (a route revisit), not just a retry within one call.
   - `i18n.service.spec.ts:191-201` ("retries English for real when it failed during the first attempt"): `global.failTimes('en', 2)` (both the initial `load()` attempt's call and `loadScope`'s own immediate retry fail), and `init()`'s `retryEnglish()` still succeeds with `global.callsFor('en')` reaching `3` — a genuine third invocation of the loader, not a cache hit.
   - Concurrency: `i18n.service.spec.ts:257-270` ("shares one loader call between concurrent loads of the same pair") proves two concurrent `setLanguage('ar')` calls share exactly one loader invocation (`global.callsFor('ar')` stays `1`) via the `inFlight` map (`i18n.service.ts:212-213, 223`), and `i18n.service.spec.ts:272-281` ("does not reload a pair that already loaded") proves a genuinely-loaded pair is never reloaded. Both are exercised directly (not merely asserted by inspection); the synchronous-construction argument (no `await` between the `loadedPaths`/`inFlight` check and `inFlight.set`, so no interleaving window even under real concurrent callers) matches the passing tests.
   - Root translations: `EmptyRootLoader`/`TestingRootLoader` (`provide-i18n.ts:106-111`, `provide-i18n-testing.ts:98-105`) both wrap a synchronous `of({...})`, which cannot error — so the one remaining use of `TranslocoService.load()` (root only, `i18n.service.ts:198`) is not exposed to the caching hazard in either runtime shipped today. This is correctly scoped in `CLAUDE.md`'s new "Scope loading is ours" note ("Only the (empty) root translations go through `TranslocoService.load`").
2. **Moderate-1 (dev-mode duplicate-scope error swallowed identically to a network failure) — FIXED.** `i18nScopesResolver`'s `catchError` now branches on `error instanceof I18nError` and logs under a distinct `'[i18n:wiring]'` tag (`i18n-scopes.resolver.ts:38-45`), still resolving `true` (correctly keeping the plan's "never block navigation" contract — this was never meant to change). Confirmed by `i18n-scopes.resolver.spec.ts:128-142` ("logs a wiring mistake under its own tag and still resolves true"), which also asserts the _ordinary_ `'[i18n] Could not load route scopes.'` tag was **not** used for this case — a real behavioural distinction, not just a differently-worded message for the same code path.
3. **Moderate-2 (`retryEnglish()`'s real-retry status was an untested, implicit ordering invariant) — FIXED.** `i18n.service.spec.ts:191-201` now pins exactly the scenario Moderate-2 asked for (English already failed during the first attempt, then genuinely retried and recovered), and `i18n.service.ts:227-231`'s doc comment states the invariant explicitly ("failed paths are not remembered, so every English loader that failed runs again... this may also be English's first attempt"). The invariant itself is now moot as a _correctness_ risk: since round 2 no longer relies on Transloco's cache for scopes, whether English was "already attempted" no longer matters for whether `retryEnglish()` does real work — `loadedPaths`/`inFlight` alone determine that, and a failed path is _never_ remembered regardless of call order. The `load()` loop's early-exit-on-first-language-failure behavior (`i18n.service.ts:196-201`, unchanged) is no longer load-bearing for `retryEnglish()`'s correctness, only for how many loader calls happen before it is invoked.
4. **Minor (`I18nMissingHandler.failure` keeps only the first `throw`-policy miss) — documented, as recommended.** `CLAUDE.md`'s testing section now states "Only the first missing key of a test is reported there; fix it and rerun to see the next." `i18n-missing.handler.ts` itself is unchanged (not in this batch's file list), which is correct — round 1 flagged this as low-impact and recommended only a doc note.

### New finding

#### Serious-2: `unwrapJsonModule` silently drops every sibling key when a translation legitimately has a top-level `default` key

- File: `libs/frontend/i18n/src/lib/i18n.service.ts:257-261`:
  ```ts
  function unwrapJsonModule(result: Translation): Translation {
    const content: Translation | undefined = result['default'];
    return content ? content : result;
  }
  ```
- Scenario: this function exists to unwrap the ES module namespace object that `() => import('./en.json')` resolves to (`{ default: {...the JSON...} }`), now that scope loads bypass Transloco's own inline-loader machinery (which used to do this unwrapping itself, per the plan's verified fact that Transloco's inline loader "unwraps `res.default`", `implementation-plan.md:92`). The heuristic — "if `result.default` is truthy, that's the real content" — cannot distinguish a genuine module wrapper from a **plain translation object that itself has a top-level key literally named `default`** (a realistic namespace name: a "default view", "default plan", or "default filter" section of a scope, e.g. `{ "default": { "label": "Default" }, "theme": { "label": "Theme" } }`). Any loader that returns such an object directly (a hand-written loader, or — depending on the bundler's JSON module interop — even a real `import('./en.json')` in some toolchains that spread named exports without nesting under a distinct wrapper shape) has every sibling key silently discarded; only the `default` sub-object survives.
- Evidence: confirmed empirically with a scratch spec (not committed) built on the shipped `I18nService`/`defineI18nScope`: a scope with `en: () => Promise.resolve({ default: { label: 'Default' }, theme: { label: 'Theme' } })` produced `i18n.translate('settings.default.label') === 'Default'` (correct) but `i18n.translate('settings.theme.label') === ''` (wrong — the `theme` namespace was entirely dropped), with the missing-handler's dev warning `'[i18n] missing "settings.theme.label" in "en" and in English.'` — indistinguishable in the logs from an ordinary missing key, giving no signal that the real cause is namespace collision with the unwrap heuristic.
- Current handling: none — `unwrapJsonModule` treats any object with a truthy `default` property as a module wrapper unconditionally, with no check that the object has _no other keys_, and no distinction between "this came from `import()`" and "this came from a hand-written loader that returned its content directly."
- Recommendation: at minimum, only unwrap when `default` is the sole own-enumerable key (`Object.keys(result).length === 1 && 'default' in result`), which correctly handles both plausible shapes of the ES module namespace object (`{ default: {...} }` alone, or `{ default: {...}, ...named-exports-of-the-same-keys }` — since JSON module named exports mirror the same values, unwrapping only when `default` is present is still correct in the mirrored case, but the single-key check at least stops a hand-authored or JSON-shaped `{ default: X, other: Y }` translation from being misread as a wrapper when `other` is real content Transloco never sees under the current heuristic). A more robust fix scopes the unwrap to loaders known to come from `import()` (for example, by having `defineI18nScope` mark its own wrapped loaders, since it already wraps every loader in `toTranslation` and controls the call site) rather than guessing from the shape of the result at the `I18nService` layer. Either way, this needs a regression spec pinning a scope whose real content has a top-level `default` key, since none of the current specs' fixtures use that key name (all fixtures/inline scopes in this batch use `hello`, `greeting`, `count`, `a`, etc.) — the gap is real but currently untested, and would previously have been Transloco's own problem (its inline-loader unwrap has the identical heuristic, per the plan's own verified note, so this is not a regression _introduced_ by the rework, but it is newly this library's own code and own responsibility now that it performs the unwrap itself outside Transloco).

### Other judged items

- **`loadedPaths`/`registry`/`inFlight` lifetime, including on the server.** `I18nService` is `providedIn: 'root'`, one instance per Angular injector. In SSR, Angular Universal creates a fresh platform/injector per request, so these maps start empty on every server render — no cross-request staleness or growth. In the browser (one SPA session), `loadedPaths` grows only with the number of distinct `scope/lang` pairs the session actually uses, bounded by the fixed scope catalog (at most ~13 scopes × 2 languages per the plan's scope table, implementation-plan.md:374-386) — not an unbounded, session-length-scaling structure. No leak.
- **`EmptyRootLoader`/`TestingRootLoader`: do they truly never fail?** Confirmed by reading both (`provide-i18n.ts:106-111`, `provide-i18n-testing.ts:98-105`): each `getTranslation()` returns `of({...})` — a synchronous, always-successful `Observable`. Neither can put a failed root-language path into Transloco's cache under the runtimes this library ships today. This is worth restating as an explicit invariant if the library is ever extended with a _real_ (HTTP or file-system) root loader for the webview reuse `CLAUDE.md` mentions, since a failing root loader would reintroduce exactly the Serious-1 class of bug at the root-translation layer, which the current scope-level fix does not cover.
- **Round-1 specs still pass, unmodified in behaviour:** "latest call wins" (`i18n.service.spec.ts`, still present, values unchanged), "scope registered mid-switch is also loaded" (still present), "always renders English on the server" (still present, `global.calls` still `['en']` only), missing-key English/`''` fallback (`i18n-missing.handler.spec.ts`, untouched file, still in the 112 total), synchronous render under `provideI18nTesting` (`provide-i18n-testing.spec.ts`, untouched file). None of round 2's file changes touched these paths, and the full suite run confirms they still pass alongside the six new specs.

### Updated summary

| Metric                       | Value                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall score (round 2)      | 7/10                                                                                                                                                                                                                         |
| Assessment                   | NEEDS_REVISION — one new Serious finding (`unwrapJsonModule`'s `default`-key collision), evidence-backed and currently untested; all four round-1 items are genuinely fixed and independently re-verified, not just asserted |
| Blocking issues              | 0                                                                                                                                                                                                                            |
| Serious issues (this round)  | 1 (Serious-2, new)                                                                                                                                                                                                           |
| Moderate issues (this round) | 0 (both round-1 Moderates fixed)                                                                                                                                                                                             |
| Round-1 issues fixed         | 4 of 4 (Serious-1, Moderate-1, Moderate-2, Minor)                                                                                                                                                                            |

### Verdict (round 2)

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: Serious-2 — `unwrapJsonModule` (`i18n.service.ts:257-261`) will silently discard an entire scope namespace's worth of translations the first time a scope's content legitimately uses a top-level key named `default`, with no error and a log line indistinguishable from an ordinary missing-key typo. Confirmed by direct experiment against the shipped code.
- What a robust round-3 would add: (1) the single-key guard (or a call-site-aware unwrap) recommended above, plus a regression spec using a `default`-named top-level key; (2) given round 2 substantially changed how scopes reach Transloco (bypassing its `load()`/inline-loader path entirely), a spec confirming `TranslocoService.setTranslation(t, 'scope/lang', { emitChange: false })` produces identical `scope.key` lookups to the old inline-loader path for a multi-level-nested key (the existing specs use flat or one-level-nested fixtures; the load-path change is architecturally significant enough to deserve one assertion against a deeper key shape, even though `getMappedScope`/dotted-key resolution is Transloco's own well-tested mechanism and not new code here).

## Batch 2 — round 3

Scope: Serious-2 only. File changed: `libs/frontend/i18n/src/lib/i18n.service.ts` (`unwrapJsonModule`/new
`isPlainObject` helper, `:257-273`) and `i18n.service.spec.ts` (new `describe('scope loader results', ...)`
block, four specs). No other file in the batch changed. Read in full: the new `unwrapJsonModule` and its four
new specs; re-read `CLAUDE.md`'s "Scope loading is ours" note (unchanged, still accurate).

Verification run: `node_modules/.bin/nx run-many -t lint,test,typecheck -p @ptah-extension/i18n --skip-nx-cache`
→ lint clean, typecheck clean, **12 suites / 116 tests passed** (matches the executor's report exactly: 112 → 116,
the four new specs). `nx run degradation-audit:lint` → still 0 sites under `libs/frontend/i18n`. `grep` confirms
no `throw new Error(`. Beyond the specs, this round independently probed the real shape `import('./x.json')`
produces under both this repo's Jest config and real esbuild bundling (not asserted by any spec, and exactly
what the coordinator asked to check), plus one further edge case the new heuristic still gets wrong.

### The fix

```ts
function unwrapJsonModule(result: Translation): Translation {
  const content: unknown = result['default'];
  if (!isPlainObject(content)) return result;
  const isWrapper = Object.keys(result).every((key) => key === 'default' || result[key] === content[key]);
  return isWrapper ? content : result;
}
```

This replaces "any truthy `default` means unwrap" with "unwrap only when every _other_ top-level key is
reference-equal to the same-named property of `default`" — the actual, verifiable signature of a bundler's
module-wrapper object, as opposed to a coincidental `default` namespace sitting beside real sibling content.

### Verified against the real toolchain (not just the new specs)

The new specs prove the logic is internally consistent, but the claim that "a module wrapper's siblings are
reference-equal to `default`'s same-named properties" is an empirical claim about what bundlers actually
produce, not something the specs alone can validate for the **production** build path (`@angular/build`,
esbuild-based) versus the **test** path (Jest). Both were checked directly:

- **Under this repo's actual Jest config** (`libs/frontend/i18n/jest.config.ts`, `jest-preset-angular`
  transform): a scratch spec (not committed) ran `await import('./__fixtures__/en.json')` and printed the real
  result. Shape: `Object.keys(mod)` is exactly `['greeting', 'default']` (no `__esModule`, no
  `Object.getOwnPropertySymbols` entries — so no `Symbol.toStringTag` or any other symbol-keyed own property
  that could interact with the `Object.keys()`-based check, since `Object.keys()` only ever returns string
  keys regardless). Critically, `mod.greeting === mod.default.greeting` is `true` — genuine reference equality,
  not just deep equality — so `isWrapper` correctly evaluates to `true` for a real fixture import under Jest.
- **Under real esbuild bundling** (the engine `@angular/build:application` uses): a standalone esbuild build of
  an equivalent `import('./en.json')` (both `platform: 'node'` execution and `platform: 'neutral'` source
  inspection) produces `__toESM`'s standard interop wrapper: `{ default: <the raw parsed JSON>, <each top-level
key>: <a getter delegating to the same raw object> }`. No `__esModule` marker is added (esbuild's own
  `__toESM` helper only _reads_ `mod.__esModule` to decide whether to wrap at all — parsed JSON has no such
  property, so it always wraps — it never _writes_ one onto the result). Executing the bundle confirmed
  `m.greeting === m.default.greeting` and `m.other === m.default.other` are both `true` by direct assertion, for
  the same reason: the generated named-export getters and `default` both read from the _same_ underlying
  `module.exports` object, so they are reference-equal by construction, not by coincidence.
- Conclusion: the coordinator's specific concern — that `__esModule` or a `Symbol.toStringTag` own key might be
  present and break the equality test — does not materialise in either real pipeline this library ships
  through. The `isWrapper` check is sound for both the shape Jest produces and the shape esbuild/`@angular/build`
  produces. This was worth checking empirically rather than trusting the doc comment's claim ("Bundlers and
  TypeScript repeat each JSON key beside `default`"), since a JSON-interop shape is exactly the kind of thing
  that varies silently across bundler versions.

### Remaining gap (Moderate, not Serious — narrower than round 2's finding)

#### A scope whose entire language content sits under one single top-level `default` key still loses that prefix

- File: `libs/frontend/i18n/src/lib/i18n.service.ts:257-269`.
- Scenario: `Object.keys(result).every(...)` is vacuously `true` when `'default'` is the **only** key in
  `result` — the `.every()` callback short-circuits to `true` on that one key via `key === 'default'` without
  ever needing to compare a sibling. So a translation object shaped exactly `{ default: { label: 'Default
label' } }` (a scope whose language file defines nothing but a `default` namespace, no other top-level
  section) is indistinguishable from a genuine one-key-only module wrapper and gets unwrapped: `content` (`{
label: 'Default label' }`) is returned in place of `result`. Confirmed empirically with a scratch spec (not
  committed): `i18n.translate('onlyDefault.default.label')` came back `''` (missing — the `default` segment was
  stripped), while `i18n.translate('onlyDefault.label')` (the un-prefixed key, never a key the app would
  actually ask for) came back `'Default label'`.
- Impact: this requires a scope whose _entire_ content for a language is nested under one namespace literally
  named `default`, with no sibling top-level namespace — a narrower and less likely authoring shape than round
  2's finding (which broke on a `default` namespace _alongside_ any other top-level content, a much more
  ordinary shape). It is real and reachable, though: a "default view"/"default plan"/"default filter" scope
  that happens to have no second top-level section yet (for example, before a second variant section is added)
  would silently mis-key every one of its entries, with the same "looks like an ordinary missing key" signal as
  round 2's bug — a dev warning naming the un-findable prefixed key, nothing pointing at the real cause.
- Recommendation: add `Object.keys(result).length > 1` (or equivalently, require at least one sibling key
  before trusting the mirroring check) to the `isWrapper` condition, so a single-key `{ default: {...} }` is
  never treated as a wrapper — it is the strictly more common shape for real content (a scope whose only
  section happens to be called "default") than for a genuine bundler wrapper reaching this function (which, per
  the empirical check above, always carries at least one mirrored sibling key in both Jest and esbuild output,
  since a real JSON module's top-level keys are always mirrored as named exports alongside `default`). This
  closes the gap without reopening round 2's bug, and without weakening the fix for the two toolchains this
  library actually ships through. Non-blocking for this round's stated scope, but worth one more line and one
  more spec before Batch 2 closes, since it is a direct, adjacent corollary of the exact case round 2 fixed.

### Batch 2 — final verdict

- Round-1 items (Serious-1, Moderate-1, Moderate-2, Minor): fixed and independently re-verified in round 2, unchanged in round 3 (this round's diff did not touch any of that code).
- Round-2 item (Serious-2, `unwrapJsonModule` dropping siblings of a real top-level `default` key): **fixed**, independently re-verified against both the Jest and esbuild toolchains this library actually ships through, with the exact multi-sibling scenario from round 2's report now passing (`'keeps a real top-level default section and its siblings'`, `i18n.service.spec.ts`).
- One narrower, adjacent gap remains (single-key `{ default: {...} }`, above) — Moderate, not Serious, and not blocking, but real and worth one more line before this component ships.
- Assessment: **APPROVED**, on the basis that every finding this review raised for Batch 2 across three rounds has been fixed and independently confirmed except the one Moderate item above, which is a materially smaller, less-likely-to-occur residual of the same class of bug, does not reopen anything previously found, and does not block the rest of the plan (Batches 3+) from proceeding.
- Confidence: HIGH — every claim in this round was checked against the running code (116/116 tests, lint, typecheck, degradation-audit) and against the real toolchain behaviour (Jest transform and esbuild bundling), not only against the new specs' own assertions.

| Metric                         | Value                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Overall score (Batch 2, final) | 8/10                                                         |
| Assessment                     | APPROVED                                                     |
| Blocking issues                | 0                                                            |
| Serious issues (open)          | 0                                                            |
| Moderate issues (open)         | 1 (the single-key `{ default: {...} }` corollary above)      |
| Issues fixed across rounds 1-3 | 5 of 6 (Serious-1, Serious-2, Moderate-1, Moderate-2, Minor) |

---

## Batch 3

### Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 2              |
| Failure modes found | 4              |

Scope examined: `tools/i18n-check/{project.json,tsconfig.json,jest.config.ts,glossary.json,run-self-test.js}`,
`tools/i18n-check/src/main.ts`, `tools/i18n-check/src/lib/{scope-map,template-keys,ts-keys,translation-files,glossary,report,markers}.ts` and
their `*.spec.ts`, and `tools/i18n-check/__fixtures__/project/**`. Read in full, not by diff. Verified against
`implementation-plan.md:282-301,337-341,355-365` and `batches.md` Batch 3 task text (Tasks 3.1-3.3). Ran
`node_modules/.bin/nx run i18n-check:self-test` (2/2 fixture runs pass) and
`node_modules/.bin/nx run-many -t test -p i18n-check` (7 suites / 38 tests pass). Regression-sensitivity spot check:
temporarily widened `defaultAllowedScopes('pricing')` to include `landing` in `scope-map.ts`, confirmed
`self-test` then fails (the foreign-scope plant stops being reported), then reverted and confirmed `git diff` on
that file is empty again (no working-tree change left behind).

### Five logic questions

**1. How does this fail silently?**

- A `translateObjectSignal(...)` call whose argument is a computed expression backed by a `*_I18N_KEYS` constant or
  an `i18n-keys:` marker is accepted without ever confirming the referenced key names a non-empty _namespace_, the
  one thing `translateObjectSignal` actually requires (`main.ts:379-393`, `:400-418` — see Failure mode
  "translateObjectSignal's group requirement is not checked for computed keys"). At runtime this becomes an empty
  or wrong-shaped object handed to the caller with no build-time signal.
- An allowed scope's (`ui`/`core`) real config defect — a `dotted-key`, `duplicate-key`, or unsupported-property
  `invalid-value` in its `en.json` — is filtered out of a consuming project's report (`main.ts:328-336` keeps only
  `missing-file`/`parse-error`), and the affected key is simply absent from `entries` (`translation-files.ts:123-154`,
  each of those three branches `continue`s before `entries.set`). A consuming project referencing that key sees a
  generic `unknown-key`, not the real cause; the real cause is reported only when that scope's own project is
  checked, so CI does not miss it project-wide, but a developer chasing the `unknown-key` in the _consumer_ project
  gets no pointer to the actual defect.

**2. What user action produces unexpected behaviour?**

- An author writes a `<!-- i18n-keys: core.checkout.* -->` marker one line above a `<p>` element whose interpolation
  is itself on the _next_ line (Prettier's normal output for anything past a one-line element), e.g.:
  ```html
  <!-- i18n-keys: core.checkout.* -->
  <p>{{ message.key | transloco }}</p>
  ```
  `coversLine` only accepts `markerLine === line` or `markerLine === line - 1` (`markers.ts:53-56`), so the marker
  is two lines above the actual pipe argument's line and the check fails with `unannotated-computed-key`
  (`main.ts:405-418`) even though the author did exactly what the tool asks. The only fixture case
  (`__fixtures__/project/.../pricing-page.component.ts:34-35`) keeps the marker and the usage adjacent, so this
  never surfaces in the self-test. See Failure mode "Marker association breaks across any intervening line".
- An author names a translateObjectSignal group-lookup constant `GROUP_I18N_KEYS = { a: 'pricing.card', b:
'pricing.footer' } as const` (values are namespace names, correctly matching the naming convention). Its values
  are validated with a hardcoded `'leaf'` target (`main.ts:392`), so a perfectly correct group-name constant is
  reported as `unknown-key` for every entry, because `pricing.card`/`pricing.footer` are namespaces, not leaves.

**3. What input data produces a wrong answer rather than an error?**

- Two files within the same project define an unrelated identifier that happens to end in `I18N_KEYS`/`I18nKeys`
  (`ts-keys.ts:21`, `KEY_CONST_NAME`), with the _same_ name in two different files. `scanProject`/`run` accumulate
  `keyConsts` into one project-wide `Map` keyed only by name (`main.ts:379-381`); the later file's declaration wins
  silently for every computed-key receiver check via `isKeyConstReceiver` (`main.ts:394-397`), regardless of which
  file a given computed key actually reads from. No import/data-flow tracking ties a receiver back to the specific
  declaration it uses, so a valid constant in file A can mask an invalid or mismatched one intended for a receiver
  in file B, or vice versa. Low likelihood in an 11-scope-per-project layout, but plausible after a copy-paste
  refactor within one lib.
- `containsTerm`'s word-boundary guard only excludes preceding/following `[A-Za-z0-9]` (`glossary.ts:76-78`); an
  Arabic character glued directly to a Latin term (`شركةPtahللمنتجات`, no separating space — a realistic RTL typo
  or a machine-translation artifact) still counts as a "whole-word" match, since Arabic letters are outside the
  exclusion class. This can produce a false negative glossary-parity pass for a value that isn't actually a clean,
  isolated brand mention.

**4. What happens when a dependency fails?**

- `@angular/compiler`'s `parseTemplate` throwing (rather than returning `errors`) is not caught anywhere in
  `extractTemplateKeys` (`template-keys.ts:68`) or its caller (`main.ts:181-187`); an uncaught exception here
  propagates out of `run()` to `main()`'s top-level `.catch` (`main.ts:456-461`), which exits 2 ("internal error")
  rather than reporting a per-file `parse-error` and continuing to scan the rest of the project. This differs from
  the TypeScript path, which explicitly treats `program.getSourceFile` returning `undefined` as a file-level
  violation and keeps going (`main.ts:189-198`). Whether `parseTemplate` can throw synchronously (vs. always
  populating `.errors`) was not verified against the installed `@angular/compiler@22.1.7`; if it can, one malformed
  template turns a per-file failure into a whole-run abort that silently skips every other file's rules on that
  run, which is a materially worse degradation-audit outcome than "every file's rules run, violations named."
- `fast-glob` returning zero files (e.g. `--project-root` points at a project whose `src/` was renamed or is
  temporarily empty during a migration) produces an empty `scan`, and `run()` proceeds to completion with only the
  parity/glossary/placeholder checks against `en.json`/`ar.json` still active — the project exits 0 if those pass,
  even though zero source files were scanned. There is no minimum-file-count or "did we actually see any source"
  assertion, so a broken `--project-root` (a typo not caught by the `--project-root`/scope-map match check, e.g. a
  correct root that nonetheless has no `src/*.ts`/`*.html` under it yet) reads as "clean" rather than "nothing was
  checked."

**5. What is missing that the requirements never mentioned?**

- The plan's own wording for a plain `i18n-keys:` token ("resolves against the `en.json` of its own owning scope")
  doesn't say whether that resolution should honour the surrounding call's target (`leaf` for `translate`/
  `translateSignal`, `object` for `translateObjectSignal`). The implementation resolves every plain token as
  `'leaf'` unconditionally (`main.ts:357-363`) and every key-const value as `'leaf'` unconditionally
  (`main.ts:392`), so the plan gap becomes a concrete bug the moment `translateObjectSignal` is used with anything
  other than a literal string argument — a combination the plan's own worked example never shows and the fixture
  never plants or exercises.
- No fixture or spec plants a genuinely un-annotated computed key argument to `translateObjectSignal` (target
  `object`) to confirm the `unannotated-computed-key` message correctly distinguishes "needs a leaf key" from
  "needs a non-empty group" — today's message text is target-agnostic (`main.ts:412-416`), which will read oddly
  once `translateObjectSignal` sees real use starting in later batches.

### Failure modes

#### translateObjectSignal's group requirement is not checked for computed keys

- Trigger: any `translateObjectSignal(EXPR)` call whose argument is not a plain string literal — the exact case
  requirement 7.2/6.2 review focus calls out ("translateObjectSignal keys must name a non-empty group").
- Symptom: (a) if the computed argument is annotated with an `i18n-keys:` marker or backed by a `*_I18N_KEYS`
  constant, the tool accepts it purely on "is this annotated/const-backed", never confirming the resolved key(s)
  are namespaces (`main.ts:400-418`); a marker or constant whose listed keys are leaves silently passes even though
  `translateObjectSignal` needs a group. (b) Conversely, a correctly-authored group-name constant (values are
  namespace prefixes, not leaves) is checked with a hardcoded `'leaf'` target (`main.ts:392`) and is wrongly
  reported as `unknown-key` for every entry — a false positive that blocks a correct usage.
- Evidence: `main.ts:379-393` (key-const values always checked `'leaf'`), `main.ts:400-418` (computed-use loop
  never reads `use.target` once `annotated`/`isKeyConstReceiver` is true), `ts-keys.ts:230-232` (`useOf` sets
  `target: 'object'` only for `translateObjectSignal`). Confirmed untested: no fixture or spec in
  `ts-keys.spec.ts`/`__fixtures__/project/**` exercises a non-literal `translateObjectSignal` argument — the only
  `translateObjectSignal` case anywhere is the literal `translateObjectSignal('a.b')` in `ts-keys.spec.ts:20`.
- Current handling: none; both directions (false accept and false reject) are live given the code as written, they
  are just not yet reachable because no in-repo caller has adopted `translateObjectSignal` with a computed argument
  yet (Batch 3 is the tool itself, not a consumer).
- Recommendation: thread `use.target` through both the key-const validation (`main.ts:392` — validate a const's
  values with the target of _the specific use site_ that reads them, or, if a const can legitimately feed both
  leaf and group call sites, validate with `'any'` and let target-specific misuse be a runtime concern) and the
  annotated-computed-key path (require an object-target marker/`.*` token when `use.target === 'object'`, and
  reject a plain leaf-shaped marker/const for a `translateObjectSignal` computed argument). Add a fixture plant
  exercising this before Batch 5+ work starts calling `translateObjectSignal` for real.

#### Marker association breaks across any intervening line

- Trigger: an `i18n-keys:` or `i18n-ignore:` marker sits on the line directly above an element, but the annotated
  expression is on a line two or more below the marker — normal Prettier output for any element whose content
  doesn't fit on one line (a `<p>` wrapping its interpolation on its own line, a multi-attribute element, a
  multi-line method call argument).
- Symptom: `coversLine` (`markers.ts:53-56`) only matches `markerLine === line` or `markerLine === line - 1`. A
  correctly-placed, well-intentioned marker fails to cover its target and the checker reports
  `unannotated-computed-key`/flags the literal-scan string as un-ignored, even though the author followed the
  documented convention ("on the same line or the preceding line").
- Evidence: `markers.ts:53-56`; consumed at `main.ts:405-407` (`i18n-keys:` coverage for computed uses) and
  `main.ts:424-426` (`i18n-ignore:` coverage for the literal scan). The only marker+usage pair in the fixture
  keeps them on adjacent lines (`pricing-page.component.ts:34-35`), so this gap is not exercised anywhere in the
  self-test or specs.
- Current handling: none — this is the documented behaviour ("covers its own line and the next one only",
  `markers.spec.ts:29`), so it is not a bug relative to spec, but the spec itself does not match how Prettier
  formats a multi-line Angular template, meaning the rule will misfire on ordinary, correctly-formatted code the
  moment a lib batch writes a wrapped `<p>`/`<span>` around an annotated pipe.
- Recommendation: either extend `coversLine` to look up to N lines ahead within the same element (using the
  template's own source spans, which the code already has access to via `parseTemplate`, to bound "same element"
  precisely rather than guessing a line count), or document and enforce (via a lint rule or a clearer error
  message telling the author to put the marker on the exact line of the expression) that the marker must sit
  strictly adjacent to the _token_, not the _element_. As written, this will generate real false positives as soon
  as lib batches start writing normally-formatted multi-line templates with annotated computed keys.

#### An allowed scope's own-file defects are invisible to a consuming project's report

- Trigger: `ui`'s or `core`'s `en.json` (an allowed scope, not the project under test) contains a `dotted-key`,
  `duplicate-key`, or unsupported-property-form `invalid-value` — any violation kind other than `missing-file`/
  `parse-error`.
- Symptom: the affected key is silently absent from `entries` (each of those three branches `continue`s before
  `entries.set`, `translation-files.ts:123-154`), and the filter at `main.ts:328-336` drops every non-
  `missing-file`/`parse-error` violation for an allowed scope. A project consuming `core.checkout.foo` (which
  exists in source but was malformed, e.g. `"checkout.foo": "..."` written as a single dotted key by mistake) sees
  a bare `unknown-key`, with no indication the real defect lives in `core`'s file, not in the consumer.
- Evidence: `main.ts:317-336`; `translation-files.ts:120-154` (the three `continue`-before-`entries.set` branches).
- Current handling: the real defect is still reported when `core`'s _own_ project (`i18n-check` for `core`) runs,
  so it is not lost from CI as a whole — only the pointer from the consumer's report to the root cause is missing.
- Recommendation: Moderate, non-blocking for Batch 3 — worth a one-line addition once every project has an
  `i18n-check` target (Batch 4+/Component 3): when an allowed scope's `en.json` loaded with `loaded: true` but has
  non-empty `violations` of kinds other than `missing-file`/`parse-error`, surface a single summary note ("scope
  X's en.json has unresolved structural issues; see its own i18n-check run") rather than nothing, so a developer
  chasing an `unknown-key` in scope A is pointed at scope B instead of guessing.

#### Template parser exceptions are not isolated per file

- Trigger: `@angular/compiler`'s `parseTemplate` throws synchronously for some malformed input, rather than
  returning a `ParseTreeResult` with populated `.errors` (not confirmed either way against the pinned
  `@angular/compiler@22.1.7` — the plan's "Verified contracts" line only confirms the API shape was checked during
  planning, not its exception behaviour on adversarial input).
- Symptom: if it can throw, that exception propagates out of `extractTemplateKeys` (`template-keys.ts:68`), out of
  `scanProject` (`main.ts:181-187`, no try/catch around the call), out of `run()`, and is caught only by `main()`'s
  generic top-level handler (`main.ts:456-461`), which prints `"i18n-check: internal error"` and exits 2. Every
  other file's rules in that run — parity, references, glossary, everything already scanned — are lost from the
  report, contradicting the plan's explicit contract ("A parse failure of a file is reported as failures, never
  skipped", `implementation-plan.md` Component 2, and the file header's own restated contract, `main.ts:14`).
- Evidence: `template-keys.ts:68` (no try/catch around `parseTemplate`); `main.ts:181-187` (no try/catch around
  `extractTemplateKeys`); contrast with the TS path's explicit per-file isolation at `main.ts:189-198`.
- Current handling: the TS parse path is isolated (`ts.createProgram`/`getSyntacticDiagnostics` never throw for a
  malformed file, by design of the TS compiler API); the template path has no equivalent guard.
- Recommendation: wrap the `parseTemplate` call (and, symmetrically, `JSON.parse`/`ts.parseJsonText` in
  `translation-files.ts`, which already has its own try/catch at `translation-files.ts:62-74` and is fine) in a
  try/catch that converts any thrown error into a `parse-error` violation for that one file and continues the scan,
  matching the isolation the TS path already has. Low cost, closes a real single-point-of-failure risk against the
  tool's own stated contract.

### Blocking issues

None found.

### Serious issues

#### Serious-1: translateObjectSignal's group-vs-leaf distinction is not enforced for computed keys

- File: `tools/i18n-check/src/main.ts:379-393` (key-const values hardcoded to `'leaf'`), `:400-418` (annotated/
  const-backed computed uses never re-check `use.target`).
- Scenario: any lib batch that calls `translateObjectSignal` with a non-literal argument — a `*_I18N_KEYS` constant
  of group names, or a marker-annotated dynamic key — starting from Batch 5 onward, since no consumer of
  `translateObjectSignal` exists yet in this repo.
- Impact: either a correct group-name constant is wrongly rejected (blocks a legitimate PR, sends the author
  chasing a phantom bug in their translation file), or an incorrect leaf-shaped reference is wrongly accepted
  (ships a `translateObjectSignal` call that resolves to an empty/wrong object at runtime with no build-time
  signal) — see the Failure mode above for both directions with line evidence.
- Fix: as recommended above — validate key-const values and annotated computed keys against the specific use
  site's `target`, not a hardcoded `'leaf'`. Add a fixture plant for the non-literal `translateObjectSignal` case
  before it is exercised by real code.

#### Serious-2: marker-to-usage line association does not survive normal multi-line template formatting

- File: `tools/i18n-check/src/lib/markers.ts:53-56` (`coversLine`), consumed at `main.ts:405-407,424-426`.
- Scenario: any correctly-annotated computed key or literal-scan false positive whose element wraps onto more than
  one line — the default Prettier output for anything but a trivially short element — starting with the first lib
  batch that writes a real, normally-formatted `<p>`/`<span>`/attribute-bound element around an annotated
  expression.
- Impact: the checker fails a correctly-written, correctly-annotated line with `unannotated-computed-key` (or fails
  to silence a literal-scan false positive with a correctly-placed `i18n-ignore:`), blocking CI on code that did
  exactly what the tool's own convention asks. This is a false positive on the checker's _own_ core mechanism for
  handling exactly the cases (computed keys, literal-scan noise) it was built to allow through.
- Fix: as recommended above — bound "covers" by the template's own element/statement span (already available via
  `parseTemplate`'s source spans and the TS AST's node spans) rather than a fixed one-line lookahead, or clearly
  require and document that the marker sit on the exact token's line/the line immediately above the _token_, and
  verify that requirement against a fixture that wraps an annotated element the way Prettier actually formats it.

### Moderate and minor issues

- **Moderate:** an allowed scope's own structural defects (`dotted-key`, `duplicate-key`, non-`missing-file`/
  `parse-error` `invalid-value`) are filtered out of a consuming project's report, leaving a bare `unknown-key`
  with no pointer to the real cause in the other scope. `main.ts:328-336`, `translation-files.ts:120-154`.
- **Moderate:** `extractTemplateKeys`'s call to `parseTemplate` (`template-keys.ts:68`) and its caller
  (`main.ts:181-187`) have no try/catch, unlike the isolated TS-parse path (`main.ts:189-198`); an exception here
  (unconfirmed whether reachable against the pinned compiler version) would abort the whole run via `main.ts`'s
  generic handler instead of being reported as a per-file `parse-error`, contradicting the tool's own stated
  "never skipped" contract.
- **Minor:** `isKeyConstReceiver`/`keyConsts` resolution is name-keyed across the whole project scan with no
  file/import scoping (`main.ts:379-397`); a same-named `*_I18N_KEYS`/`*I18nKeys` identifier declared twice within
  one project (unlikely but not impossible after a refactor) silently lets the later declaration win for every
  receiver check, regardless of which declaration a given use site actually reads from.
- **Minor:** `containsTerm`'s word-boundary guard (`glossary.ts:76-78`) excludes only `[A-Za-z0-9]` before/after a
  glossary term; an Arabic character glued directly to the term with no separator still counts as a whole-word
  match, a narrow false-negative source for the glossary-parity rule.
- **Minor:** `fast-glob` returning zero files for a misconfigured or temporarily-empty `--project-root/src` is not
  distinguished from "nothing to report" — the run still exits 0 based only on the translation-file-level checks,
  with no signal that no source files were actually scanned (`main.ts:148-171`, `:339-340`).

### Data flow

1. `parseArgs` (`main.ts:71-132`) — usage validated, `--project-root` cross-checked against `SCOPE_MAP[scope]`
   (exit 2 on mismatch), `--allow-scope` validated per entry (known scope, not self) — OK, matches
   `implementation-plan.md:282-301` and the executor-reported `--project-root` deviation is a sound addition
   (catches a `project.json` target misconfigured against the fixed scope table before any file is even read).
2. Glossary load (`glossary.ts:23-74`) → `run()` (`main.ts:299-337`) — malformed glossary entries are reported and
   the run continues with only the valid entries — OK, matches "every violation reported, not only the first."
3. Own scope's `en.json`/`ar.json` loaded, parity/placeholder/markup/glossary/real-Arabic checked
   (`main.ts:317-323`) — OK for the happy and malformed-file paths (both covered by
   `translation-files.spec.ts`/`glossary.spec.ts`).
4. Allowed scopes' `en.json` loaded for key-existence only, filtered to `missing-file`/`parse-error`
   (`main.ts:325-336`) — gap: non-`missing-file`/`parse-error` defects in an allowed scope are invisible to the
   consumer (Moderate above).
5. Project scan (`scanProject`, `main.ts:148-238`) — `.html` and `.ts` walked, TS parsed once into a shared
   `ts.Program` (`ts-keys.ts:63-89`), inline templates re-parsed through the same template extractor
   (`main.ts:226-235`) — OK for the happy path and for a malformed `.ts` file (isolated per file,
   `main.ts:189-218`); gap for a malformed template if `parseTemplate` can throw rather than return `.errors`
   (Moderate above, unconfirmed).
6. Markers validated in place (`main.ts:345-376`) — OK for adjacent marker/usage pairs; gap when the annotated
   token is more than one line below the marker (Serious-2).
7. Key constants validated, values checked, aliases resolved (`main.ts:378-397`) — OK for the leaf-target case
   (the only one tested); gap for a group-target (`translateObjectSignal`) constant (Serious-1).
8. Pipe/`translate()` uses resolved: literal via `KeyResolver.check` with the use's own target, computed via
   marker/const-receiver gating that ignores target (`main.ts:399-418`) — OK for `leaf`; gap for `object`
   (Serious-1, same root cause as step 7).
9. Literal scan over every string/text/attribute matching the own-scope pattern, `i18n-ignore:`-aware
   (`main.ts:420-428`) — OK; anchored pattern confirmed not to match `ptah.live` (fixture `mustPass`, and the
   self-test enforces it).
10. `normaliseViolations` sorts and dedupes (`report.ts:53-60`) → printed, exit code set (`main.ts:433-461`) — OK,
    deterministic order verified by inspection (stable `Array.prototype.sort` over a total order) and by the
    self-test's exact-match assertions on two full runs.

### Requirements fulfilment

| Requirement                                                                                                                                                                                                      | Status                       | Gap                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 3.1: scaffold, tags, `self-test`/`test` targets, `testEnvironment: node`, seeded glossary, no project-code import                                                                                           | COMPLETE                     | None — `project.json`, `jest.config.ts`, `glossary.json` all match the task text; `grep` confirms no import of `libs/**`/`apps/**` in the tool's source.                                                                                                                                                                                                  |
| Task 3.2: parity, references (pipe/`translate`/`translateSignal`/`translateObjectSignal`), computed keys, placeholders, glossary, real Arabic, `--allow-scope` semantics, `sole-default-key`, CLAUDE.md sentence | PARTIAL                      | `translateObjectSignal`'s object-target requirement is not honoured once the key argument is computed (Serious-1). Marker-to-usage association does not survive normal multi-line formatting (Serious-2). Everything else (parity, literal references, `--allow-scope` defaults, `sole-default-key`, the CLAUDE.md sentence) verified correct and tested. |
| Task 3.3: self-test fixture, `en`-missing-from-`ar`, unknown key, unannotated computed key, foreign-scope, `sole-default-key`, valid `core.*` must pass                                                          | COMPLETE for the planted set | Every plant in the task text is present and reported, and the `core.checkout` must-pass case is present and passes. The fixture does not plant a non-literal `translateObjectSignal` case or a multi-line-formatted marker, so Serious-1/Serious-2 are real but currently invisible to CI.                                                                |
| Batch 3 verification: `i18n-check:self-test` and `test -p i18n-check` pass                                                                                                                                       | COMPLETE                     | Re-ran directly: self-test 2/2 fixture runs pass, 7 suites / 38 tests pass.                                                                                                                                                                                                                                                                               |

Implicit requirements not addressed: a computed-argument test case for `translateObjectSignal` (Serious-1); a
marker-placement convention (and test) that survives ordinary multi-line template formatting (Serious-2); per-file
isolation for a `parseTemplate` exception, symmetric with the TS path's isolation (Moderate).

### Edge cases

| Case                                                                        | Handled | How                                                                                                                   | Concern                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key present in `en`, missing in `ar` (and vice versa)                       | YES     | `checkParity`, `translation-files.spec.ts:99-108`, fixture `onlyEnglish`                                              | none                                                                                                                                                                                         |
| Unknown literal key in a pipe/`translate()`                                 | YES     | `KeyResolver.check`, fixture `pricing.page.missing`/`.ghost`                                                          | none                                                                                                                                                                                         |
| Foreign-scope key (`landing.x` from a `pricing` project)                    | YES     | `KeyResolver.check` "foreign-scope", fixture                                                                          | none                                                                                                                                                                                         |
| Allowed-scope key (`core.*`/`ui.*`) from a non-`ui`/`core` project          | YES     | `defaultAllowedScopes`, fixture `core.checkout.error`/`ui.nav.home`                                                   | none                                                                                                                                                                                         |
| Unannotated computed key (identifier, member access, ternary)               | YES     | fixture `dynamicKey`/`this.dynamicKey`, `template-keys.spec.ts:26-42`                                                 | Marker-annotated variant is only tested when marker and usage sit on adjacent lines (Serious-2).                                                                                             |
| Computed key via `*_I18N_KEYS` constant / class-property alias, leaf target | YES     | `ts-keys.spec.ts:61-86`, fixture `statusI18nKeys`                                                                     | Object target (`translateObjectSignal`) variant is not tested (Serious-1).                                                                                                                   |
| Literal `translateObjectSignal('a.b')` argument                             | YES     | `ts-keys.spec.ts:14-37` (`target: 'object'`)                                                                          | Computed `translateObjectSignal(EXPR)` argument is not tested (Serious-1).                                                                                                                   |
| `sole-default-key` (top-level `{ "default": {...} } `)                      | YES     | fixture `legal` scope, `translation-files.spec.ts:42-61`                                                              | none                                                                                                                                                                                         |
| Bare `i18n-keys:`/`i18n-ignore:` marker (no tokens/reason)                  | YES     | `markers.spec.ts:4-27`, `main.ts:348-356,365-374`                                                                     | none                                                                                                                                                                                         |
| Malformed `.html` template (parse failure)                                  | YES     | fixture `broken.component.html`, `template-keys.spec.ts:73-79`                                                        | The failure is only exercised via `.errors`; an actual thrown exception from `parseTemplate` is not exercised or guarded against (Moderate).                                                 |
| Malformed `.ts` file (syntax error)                                         | YES     | `ts-keys.spec.ts:89-104`                                                                                              | none                                                                                                                                                                                         |
| Placeholder/markup parity and disallowed-tag detection                      | YES     | `translation-files.spec.ts:110-139`                                                                                   | none                                                                                                                                                                                         |
| Glossary term present in `en`, missing verbatim in `ar`                     | YES     | `glossary.spec.ts` (not read line-by-line in this pass, but self-test's `Ptah`/`brand` plant exercises it end to end) | none                                                                                                                                                                                         |
| Verbatim-only English value (glossary/placeholder/digits/punctuation only)  | YES     | `isVerbatimValue`, fixture `page.brand: "Ptah"`                                                                       | none                                                                                                                                                                                         |
| Real-Arabic rule (no Arabic-script character present)                       | YES     | `ARABIC_RE`, `checkGlossaryAndArabic`                                                                                 | Tag characters are not stripped before the Arabic-script test (only placeholders are), though this is inert in practice since tags contain only ASCII (Minor, no separate line item raised). |
| `--project-root` not matching the fixed scope map                           | YES     | `parseArgs`, `main.ts:99-107` (exit 2)                                                                                | none — a sound deviation beyond the plan's literal text, catches a misconfigured `project.json` target early.                                                                                |
| Zero source files scanned (empty/misconfigured `src/`)                      | NO      | `run()` proceeds with only file-level checks, exits 0 if those pass                                                   | No signal distinguishes "nothing to check" from "everything checked and clean" (Minor).                                                                                                      |

### Verdict

- Recommendation: REVISE
- Confidence: HIGH — every finding above is backed by a specific file:line and, where feasible, an executed
  check (self-test run, regression-sensitivity revert, direct reading of every rule's code path against its own
  spec file). The two Serious items are real gaps in rule correctness for the exact interaction
  (`translateObjectSignal` + computed key, and marker-to-usage association under real formatting) that this
  review was specifically asked to verify, and neither is exercised by the current fixture or specs, so neither
  would be caught by `self-test` regressing before this is fixed.
- Top risk: `translateObjectSignal`'s group-vs-leaf distinction silently breaks in both directions (false accept
  and false reject) the moment any lib batch uses it with anything but a literal string, and nothing in Batch 3's
  own verification would catch either direction, because no fixture plant exists for the case.
- What a robust implementation would add: (1) thread the call site's `target` through key-const and marker
  validation instead of hardcoding `'leaf'`; (2) bound marker "coverage" by the actual template element/statement
  span rather than a fixed one-line lookahead, and add a fixture plant that wraps an annotated element the way
  Prettier actually formats a non-trivial one; (3) wrap `parseTemplate` in the same per-file try/catch isolation
  the TS path already has; (4) surface (even as a one-line note) when an allowed scope's own `en.json` has
  unresolved structural violations that a consumer's `unknown-key` report can't otherwise explain; (5) a minimum-
  file-count or explicit "0 files scanned" signal so a misrouted `--project-root/src` doesn't read as "clean."

---

## Batch 3 — round 2

### Summary

| Metric                 | Value                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Overall score          | 8/10                                                                                                       |
| Assessment             | APPROVED                                                                                                   |
| Blocking issues        | 0                                                                                                          |
| Serious issues (open)  | 0                                                                                                          |
| Moderate issues (open) | 1 new (inline-template escape-offset approximation), 2 deferred to Task 4.1 (not counted, per coordinator) |
| Serious issues fixed   | 2 of 2 (Serious-1, Serious-2)                                                                              |
| Moderate issues fixed  | 1 of 2 from round 1 (parse-throw isolation); duplicate-key-constant (round-1 Minor) also fixed             |

Re-read in full: `tools/i18n-check/src/main.ts`, `src/main.spec.ts` (new), `src/lib/{markers,template-keys,ts-keys,report}.ts` + specs, `run-self-test.js`, and the changed fixture files
(`pricing-page.component.ts`, `pricing-card.component.html`, pricing `en.json`/`ar.json`, and the now-source-free `legal` fixture). Ran both commands the coordinator asked for:

- `node_modules/.bin/nx run i18n-check:self-test --skip-nx-cache` → both runs PASS: pricing reports exactly 13 violations, legal reports exactly 3 (`sole-default-key` × 2 + the new `no-source-files`). Matches the executor's report exactly.
- `node_modules/.bin/nx run-many -t test -p i18n-check --skip-nx-cache` → 8 suites / 53 tests, all pass. Matches the executor's report exactly.

Regression-sensitivity spot checks (each reverted, `git status`/`git diff` confirmed clean afterward — no working-tree change left behind):

- Mutated `KeyResolver.check` so `target === 'object'` also accepts `isLeaf` (i.e. "a single key counts as a group") → `self-test` fails, as the executor claimed for this exact mutation.
- Independently confirmed marker attachment to an **object-literal property** (not just a statement/class member/call argument, which the specs already cover directly) with a throwaway script run through `ts-node` against the real `tsMarkers` export: a marker on the line above `key: dynamicExpr,` inside an object literal covers that property and correctly does not leak onto the next sibling property. Script and its containing scratch directory were removed immediately after; `git status --porcelain tools/i18n-check` shows no residue.
- Independently reproduced the documented "approximate" escape-sequence offset behaviour for inline templates: a template literal containing `A` (6 raw source characters, decoding to the 1-character `A` `parseTemplate` actually sees) causes the reported use offset to land 5 characters short of the real expression inside the raw `.ts` source. Confirms the `firstOffset`/"approximately" caveat in `ts-keys.ts:43-47` is real, not just a defensive comment.

### Judging the three executor notes

1. **"TS markers also attach to object properties and call arguments."** Confirmed true. `markers.spec.ts:43-64` and `:66-81` directly test a wrapped call argument and a wrapped class property; the fixture's `checkoutNotice`/`checkoutMessage` case (`pricing-page.component.ts` — marker two lines above a multi-line `translate(...)` call) and `pricing-card.component.html`'s two-line-wrapped `<p>` exercise the same mechanism end to end and pass. Object-literal _property_ attachment specifically (as opposed to class property or call argument) had no dedicated spec, so it was verified directly against the shipped `tsMarkers` export (see above): correct, and does not leak to a sibling property. The claim holds; the one gap is an untested-but-verified-correct case, not a defect — worth a follow-up unit test for durability, not a blocker.

2. **"Every marker token is checked against the covered call's target (mixed group+leaf on translateObjectSignal fails)."** Confirmed true, and confirmed non-trivial: the new `TargetMap` (`main.ts:337-352`) records every target a marker or key constant is actually read with, and checks each token/value against _every_ recorded target, so a marker or constant shared between a `translate()` (leaf) call and a `translateObjectSignal()` (object) call must satisfy both simultaneously — which a single key path structurally cannot, forcing the mixed case to fail. This is exercised directly by `main.spec.ts:90-130` (`GROUP_I18N_KEYS` read by both `translateObjectSignal` and `translate` → the `unknown-key` on the leaf check; `LEAF_I18N_KEYS` read only by `translateObjectSignal` → `not-a-group`) and by the fixture (`CARD_LEAF_I18N_KEYS`, `markedGroup`'s marker). This is exactly what closes round 1's Serious-1 (previously, a key-const's values were checked with a hardcoded `'leaf'` target regardless of how they were actually used).

3. **"Inline templates with escape sequences map offsets approximately."** Confirmed true and confirmed as a real, if narrow, residual risk rather than pure defensive wording — see the reproduction above. `firstOffset: init.getStart(source) + 1` (`ts-keys.ts:150`) assumes the decoded template text (`init.text`, what `parseTemplate` walks) and the raw source slice (what `coversOffset`/marker spans are measured against) advance in lockstep; an escape sequence breaks that assumption by exactly the difference between its encoded and decoded lengths, shifting every subsequent offset in that template by that amount. In the worst case this could cause a marker immediately before/after an inline template containing an escaped character to mis-attach (cover the wrong span, or fail to cover the right one) for content after the escape. Angular inline templates rarely need escape sequences (real Unicode/HTML can be typed directly in a template literal), and the comment already discloses the limitation, so this is a **Moderate, not Serious**, new finding — accepted-and-documented today, but worth either closing (recompute the offset by walking the raw source for actual escape sequences, mirroring what `ts.isStringLiteral`/`NoSubstitutionTemplateLiteral` decoding does) or scoping explicitly (a parse-time check that rejects/flags an inline template containing a backslash escape, so the approximation is never silently relied upon) before Component 3+ lib batches start writing inline templates in earnest.

### Round-1 items re-verified as fixed

- **Serious-1 (translateObjectSignal group-vs-leaf not enforced for computed keys):** FIXED. `KeyResolver.check` now has an explicit `target === 'object' && isLeaf` branch producing `not-a-group` (`main.ts:304-312`), and both markers and key constants are checked against the union of targets of every use they actually cover (`main.ts:432-457, 484-512`), not a hardcoded `'leaf'`. Verified by direct mutation (reverting the fix reproduces the exact false-accept failure mode described in round 1) and by the new fixture plants (`CARD_LEAF_I18N_KEYS`, the `markedGroup` marker) and `main.spec.ts:90-130`.
- **Serious-2 (marker-to-usage association breaks across intervening lines):** FIXED, and fixed at the root rather than patched — markers now attach to the AST span of the node/element they lead (`markers.ts:66-108` for TS via `ts.getLeadingCommentRanges`/`onOwnLine`, `template-keys.ts:164-212` for HTML via `parsed.commentNodes`/`nextSibling`), not a line-count heuristic. Directly exercised by the two "wrapped element, marker two lines above" PASS cases the fixture now plants in both a `.ts` file and a `.html` file, and by five dedicated `markers.spec.ts` cases including "does not reach past an unrelated sibling" and "does not let a file-header marker cover the whole file."
- **Moderate (parseTemplate exception not isolated per file):** FIXED. `extractTemplateKeys` wraps its `parseTemplate` call in try/catch and converts a throw into a per-file `parse-error` (`template-keys.ts:100-111`); `scanProject`'s per-file loop additionally wraps the whole `scanFile` call in try/catch as defense in depth (`main.ts:202-217`). Directly exercised by `main.spec.ts:9-20,55-65`, which mocks `@angular/compiler`'s `parseTemplate` to throw for one file and asserts the run still reports the other file's violations — a real, executed regression test for exactly this failure mode, not just a code-reading inference.
- **Minor (duplicate-key-constant name collision silently resolved by last-wins):** FIXED, beyond what round 1 asked for. Round 1 flagged this as a low-likelihood Minor risk; the executor added an explicit `duplicate-key-constant` rule that reports _every_ declaration site when the same `*_I18N_KEYS`/`*I18nKeys` name is declared more than once in a project (`main.ts:400-421`), rather than merely avoiding the silent-overwrite risk. Exercised by `main.spec.ts:73-88`.

### Deferred items (not judged this round, per coordinator)

- Allowed-scope defect pointer (an allowed scope's `dotted-key`/`duplicate-key`/`invalid-value` defects stay invisible to a consuming project's report) — unchanged, `main.ts:386-394`/`translation-files.ts:120-154` are materially the same as round 1. Deferred to Task 4.1 as instructed; not counted against this round.
- Glossary Arabic-adjacency word-boundary (`containsTerm`'s guard excludes only `[A-Za-z0-9]`, not Arabic characters) — unchanged, `glossary.ts:76-78`. Deferred to Task 4.1 as instructed; not counted against this round.

### New issues this round

#### Moderate: inline-template offset approximation for escape sequences is unverified against a marker-adjacency case

- File: `tools/i18n-check/src/lib/ts-keys.ts:43-47,150` (`firstOffset: init.getStart(source) + 1`, documented as "approximately").
- Scenario: an inline `template:` string/template-literal containing an escape sequence (`\u00XX`, `\n` written literally, `\\`, `\"`/`\'` inside a quoted string) ahead of a marker-annotated computed key or a literal-scan string within the same template.
- Impact: reproduced directly (see above) — every offset after the escape sequence is shifted by the difference between its raw and decoded lengths, which can misalign `coversOffset`'s span comparison against a marker's `covers` range for content in the same template after the escape. No test exercises a marker's coverage boundary in the presence of an inline-template escape sequence (the `firstOffset` mechanism itself is exercised only for a template with no escapes, via `ts-keys.spec.ts`'s existing inline-template tests, which predate this round and were not extended).
- Recommendation: either compute `firstOffset`-relative positions by re-scanning the raw source text for the literal's actual escape sequences (mirroring how the TS scanner itself decodes `\uXXXX`/`\n`/etc.), or, more cheaply, detect a backslash in the raw text of an inline template literal and downgrade any marker adjacency check inside it to line-based (or refuse to trust `coversOffset` there and require the marker on the exact line, with a distinct message) so a subtle misattachment cannot happen silently. Not blocking Batch 3 — inline templates with escape sequences are not present anywhere in this fixture or, so far, in the plan's lib batches — but worth closing before a lib batch's real inline template relies on marker coverage near an escaped character.

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH — every claim in this round was checked against the running code: both requested `nx` commands executed live (not read from the executor's report), the two Serious fixes verified both by reading the new logic and by an actual reverted mutation reproducing the pre-fix failure, and all three executor notes verified against either an existing executed test or a fresh, cleanly-reverted throwaway script run through the real exported functions.
- Top risk: none blocking. The one new Moderate item (inline-template escape-offset approximation) is real but narrow, already disclosed in the code's own comment, and not yet reachable by any code in this repository.
- What a robust implementation would add before it matters: a marker-coverage test for an inline template containing an escape sequence (or a guard that refuses to rely on approximate offsets there); the two items already deferred to Task 4.1.

---

## Batch 4

### Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 4              |

Scope examined in full: `tools/i18n-check/src/review/review-tables.ts` + `.spec.ts`, `tools/i18n-check/src/lib/literal-offsets.ts` + `.spec.ts`, and the carry-over diffs to `tools/i18n-check/src/main.ts`, `src/main.spec.ts`, `src/lib/{glossary,ts-keys,report,template-keys}.ts` + specs, `run-self-test.js`, `tools/i18n-check/project.json`, `nx.json`, `.github/workflows/ci.yml`, and the new fixture files `__fixtures__/project/copy-review/{pricing,glossary}.md`. Verified against `implementation-plan.md:332-336,352,578-592,720`, requirements 7.3/8.2, and `batches.md` Batch 4 task text (Tasks 4.1-4.2, including the three Batch-3-round-2 carry-overs it names). Ran:

- `node_modules/.bin/nx run i18n-check:self-test --skip-nx-cache` — PASS: `review-tables --check` OK line, 13/13 pricing plants, 3/3 legal plants.
- `node_modules/.bin/nx run-many -t test -p i18n-check --skip-nx-cache` — 10 suites / 81 tests, all pass.
- A direct reproduction outside the fixture (`/tmp/rt-test`, removed after use): an `en.json` with a dotted-key mistake (`"terms.bad": "..."`) and a duplicate key (`"duplicate"` declared twice) run through both `review-tables.ts` and `main.ts` side by side — see Blocking-1 below.

### Carry-over items (Batch 3 round-2) — status

1. **Allowed-scope-defect pointer, including non-object top-level.** FIXED and correctly scoped: `allowedScopeDefect` (`main.ts:360-375`) summarises every non-`missing-file`/`parse-error` violation kind (including `sole-default-key` and a non-object top-level, which loads with `loaded: false` via `translation-files.ts:79-86` and is excluded from the "structural" set the same way — confirmed by reading the `unreadable` filter at `main.ts:412-414`, which only matches `missing-file`/`parse-error`, so a non-object top-level `invalid-value` correctly becomes a pointer, not a raw dump). `KeyResolver.check` (`main.ts:296`) skips key judgment entirely when `!translations.loaded`, so no spurious `unknown-key` noise is produced for an unreadable allowed scope. Verified by direct reproduction (see below) and by reading the code paths; no fixture plant exists for this exact case, but the mechanism is sound.
2. **Arabic word-boundary rule.** FIXED. `WORD_CHAR` (`glossary.ts:76`) uses `(?:[A-Za-z0-9]|(?=[؀-ۿ])[\p{L}\p{M}\p{N}])` — the lookahead restricts the Arabic branch to the Arabic block, and only its letter/mark/number categories count as word characters, so Arabic punctuation (`،؛؟`) is correctly excluded from the boundary and does not shield a glued Latin term.
3. **Approximate inline-template offsets.** FIXED at the root via the new `tools/i18n-check/src/lib/literal-offsets.ts`: every decoded UTF-16 unit is mapped to the exact source offset that produced it (single-character escapes, `\xHH`, `\uHHHH`, `\u{…}`, legacy octal, line continuations, CR/CRLF normalisation — `literal-offsets.ts:41-104`, unit-tested against the real TypeScript scanner's decoded text in `literal-offsets.spec.ts:5-16,19-34`). `inlineTemplateOf` (`ts-keys.ts:193-210`) additionally cross-checks `decoded.text !== init.text` and, on any mismatch or thrown decode error, reports a `parse-error` naming the inline template rather than trusting approximate offsets (`ts-keys.ts:145-159`) — this is exactly the "mismatch → parse-error, never approximate" contract the task asked for, and it is a marker-adjacency-safe design (a mis-offset marker simply can't happen; the template is rejected instead).

### Five logic questions

**1. How does this fail silently?**

- **The core one:** `review-tables` silently drops a malformed translation key from the generated review table and exits 0 ("wrote"/"OK"), even though the same file would fail `i18n-check` outright. See Blocking-1.
- A cached `i18n-check` task for a downstream project (e.g. `pricing`) can read stale as "still passing" after an allowed scope's (`core`/`ui`) `en.json` changes in an unrelated commit, because the task's cache hash has no input covering dependency projects. See Serious-1.
- `formatMarkdown` (`review-tables.ts:248-250`) has no try/catch around Prettier's `format()`; if it ever throws (malformed generated Markdown from a pathological key/value combination), the failure surfaces only as `main()`'s generic `"review-tables: internal error"` / exit 2, not as a labelled violation naming the offending scope — consistent with, but not better than, the pre-existing pattern this tool already isolates elsewhere (TS parse, template parse). Not currently reachable by any planted input, so Moderate.

**2. What user action produces unexpected behaviour?**

- A lib author fixes a typo by writing `"pricing.card": "..."` instead of `"pricing": { "card": "..." }` (a dotted key). `i18n-check` fails the PR with `[dotted-key]`. The author, following the tool's own advice to check `copy-review/pricing.md` before asking a human reviewer to sign off (8.3), sees a clean table with `pricing.card` simply missing no row, no note and no non-zero exit from `review-tables --check`. Nothing in the review workflow told them the key was ever malformed.
- An author who runs `review-tables` before `i18n-check` (a plausible order — the review table is meant as the artifact a human reads) gets a false "up to date" signal and may commit `copy-review/*.md` believing it is complete, only to have `i18n-check` fail the same PR for a reason the table never showed.

**3. What input data produces a wrong answer rather than an error?**

- Reproduced directly (`/tmp/rt-test`, workspace outside the repo, removed after use): `en.json` containing `"terms.bad": "dotted key mistake"` and a second `"duplicate"` property re-declared with a different value. `review-tables.ts` writes a 2-row table (`legal.duplicate` with the _first_ value only, `legal.governingLanguageNotice`) and reports `wrote copy-review/legal.md` / `wrote copy-review/glossary.md`, exit 0. The same input through `main.ts` reports 3 own-file violations (`dotted-key`, `duplicate-key`, plus the resulting `missing-in-ar`), exit 1. The two tools disagree about whether this file is fit to ship, and the one a human actually reads (the review table) is the one that says nothing is wrong.
- Root cause: `walkObject` (`translation-files.ts:118-176`) `continue`s before ever calling `result.entries.set(...)` for the three violation kinds `invalid-value` ("unsupported property form"), `dotted-key`, and `duplicate-key` (`:126-131`, `:138-143`, `:148-153`), yet unconditionally sets `result.loaded = true` afterwards (`:107`) regardless of what got pushed to `result.violations` during the walk. `review-tables.ts`'s `generate()` (`:274-278`) only surfaces a file's violations when `!file.loaded`, so every one of those three violation kinds — plus `sole-default-key`, which is pushed before `walkObject` runs but likewise doesn't flip `loaded` to false (`:92-102`) — is invisible to `review-tables` while fully visible to `main.ts` (`main.ts:401`, unconditional).

**4. What happens when a dependency fails?**

- `prettier/standalone`'s `format()` is awaited with no per-call try/catch (`review-tables.ts:248-250`); see Q1. Not exercised by any fixture.
- `fs.readFileSync`/`fs.existsSync` failures other than "file does not exist" (e.g. an `EACCES` permission error on the translation file or glossary) are not caught anywhere in `loadTranslationFile`/`loadGlossary` — such an error would propagate as an uncaught exception to `main()`'s top-level `.catch` (exit 2), consistent with the existing (already-reviewed) main.ts behaviour, not a new regression this batch introduces.

**5. What is missing that the requirements never mentioned?**

- The plan's own `nx.json` snippet (`implementation-plan.md:352`, reproduced verbatim in the diff) never specifies a `^production`/`^default`-style input for `i18n-check`, unlike every other cached target already in `nx.json` that crosses a project boundary (`@angular/build:application`, `@nx/esbuild:esbuild`, `@nx/js:tsc`, `@nx/angular:ng-packagr-lite` all carry `^production`; `@nx/jest:jest` carries `^production` too). Since `i18n-check` is the one target whose correctness _depends_ on another project's files (`--allow-scope`), and it is the one target in the file with no dependency-scoped input, this reads as a gap in the plan that the implementation inherited rather than an executor deviation. See Serious-1.
- No fixture plant or spec exercises `review-tables` against a file containing a `dotted-key`/`duplicate-key`/`unsupported-property-form` defect — the only "malformed input" case `review-tables.spec.ts` covers is a `parse-error` (unparseable JSON, `:232-247`), which _is_ caught (via `loaded: false`). The structural-but-still-`loaded`-true case (Blocking-1) has no test anywhere in this batch, so it would not have been caught by the batch's own verification even had a spec been written for it in the wrong shape.

### Failure modes

#### Review table silently omits structurally malformed keys

- Trigger: an `en.json`/`ar.json` in the scope under review contains a `dotted-key`, `duplicate-key`, `sole-default-key`, or "unsupported property form" (`invalid-value` for a non-leaf, non-object property) defect.
- Symptom: the affected key is absent from the generated Markdown table with no row and no note; `review-tables`/`review-tables --check` both report success (`wrote ...` / `OK (...)`) and exit 0.
- Evidence: `tools/i18n-check/src/review/review-tables.ts:274-278` (`generate`, gates violation surfacing on `!file.loaded`); `tools/i18n-check/src/lib/translation-files.ts:107` (`loaded` set unconditionally after `walkObject`) and `:126-153` (the three `continue`-before-`entries.set` branches); contrast `tools/i18n-check/src/main.ts:401` (`violations.push(...en.violations, ...ar.violations)`, unconditional). Reproduced live against a throwaway fixture outside the repo (see Q3), output pasted above.
- Current handling: none for these three violation kinds; entry-level `invalid-value` (empty/non-string leaf value) _is_ surfaced, because it still reaches `entries.set` with `value: null` and `reviewNotes` reports "invalid English/Arabic value" from that.
- Recommendation: in `generate()`, push a file's violations whenever it has any (not only when `!file.loaded`), or at minimum push the subset of kinds that `walkObject` can produce while still leaving `loaded: true` (`dotted-key`, `duplicate-key`, `sole-default-key`, "unsupported property form"). This should refuse generation the same way an unreadable file does, since a human reviewer's sign-off (8.3) on a table that silently hides a malformed key is not a real sign-off of that key.

#### Cross-scope cache blind spot for `i18n-check`

- Trigger: `libs/web/core`'s or `libs/web/ui`'s `en.json` changes in one commit; a consuming project (e.g. `pricing`, which reads it via `--allow-scope core`) is not itself touched in the same commit, and a prior CI run already cached `pricing:i18n-check` under GitHub Actions' `.nx/cache`, which the workflow restores by an OS-prefixed, not SHA-exact, key (`.github/workflows/ci.yml` "Cache Nx task results" step, `restore-keys: nx-${{ runner.os }}-`).
- Symptom: `pricing:i18n-check`'s cache key is computed only from `{projectRoot}/src/**/*` plus the tool's own source and glossary (`nx.json` `targetDefaults.i18n-check.inputs`) — nothing scoped to `core`'s files. A previously-cached "pass" for `pricing` is reused even though `core`'s `en.json` now has a real, `pricing`-reachable defect (e.g. `core.checkout.foo` turned into a `dotted-key`), so CI stays green for `pricing` on that PR even though `main.ts` run fresh against the same inputs would fail it.
- Evidence: `nx.json:64-71` (the new `i18n-check` targetDefaults entry, no `^`-scoped input, no `dependsOn`) versus every other cross-project-relevant entry in the same file (`nx.json:24-27,49-54,55-60` all use `^production`). `implementation-plan.md:352` specifies the same three-input list verbatim, so this is inherited from the plan, not an executor addition.
- Current handling: none. `nx affected -t i18n-check` may still _select_ `pricing` to run if the project graph connects it to `core` by import, but selection and cache-hit are independent — the explicit `inputs` override removes any dependency-file contribution to the hash regardless of selection, so even a freshly-selected task can still hit a stale cache entry.
- Recommendation: add a dependency-scoped input, e.g. `"^production"` or an explicit `{workspaceRoot}/libs/**/src/lib/i18n/*.json"` glob, to `targetDefaults.i18n-check.inputs`, or accept `implicitDependencies`-free correctness only if every allowed-scope relationship is also expressed as a real Nx project dependency edge with `dependsOn` ensuring re-hash. Flag back to whoever owns the plan text at `:352`, since the plan itself omits this.

#### `formatMarkdown` exceptions are not isolated per scope

- Trigger: Prettier's `format()` throws for some generated Markdown (not currently reachable by any planted key/value combination).
- Symptom: `review-tables`'s generic top-level `.catch` in `main()` (`review-tables.ts:369-374`) prints `"review-tables: internal error"` and exits 2, rather than a labelled per-scope failure.
- Evidence: `review-tables.ts:248-250` (no try/catch around `format`).
- Current handling: none; consistent with, not worse than, this tool's general pattern before Batch 3 round-2 hardened the TS/template parse paths specifically.
- Recommendation: Moderate, low priority — wrap `formatMarkdown` and report a scope-labelled `violation`-shaped failure instead of relying on the generic top-level catch, mirroring the isolation already applied to `parseTemplate`.

#### `review-tables`'s CLI argument parsing is entirely untested

- Trigger: any malformed invocation (missing flag, unknown scope, mismatched `--project-root`, unknown flag).
- Symptom: none observed as a bug — `parseArgs` (`review-tables.ts:82-130`) mirrors `main.ts`'s already-reviewed pattern closely and reads as correct — but no test in `review-tables.spec.ts` exercises `parseArgs` or the CLI `main()` entry point at all (only `generate`, `reviewTables`, `reviewNotes` and `tableCell` are imported and tested).
- Evidence: `review-tables.spec.ts:1-16` (import list omits `parseArgs`/`main`, both unexported besides).
- Current handling: none; a regression here (e.g. a future edit that silently accepts a mismatched `--project-root`) would not be caught by `self-test` or `test -p i18n-check`, since the self-test only invokes `review-tables --check` with fixed, correct arguments.
- Recommendation: Minor — add direct `parseArgs` coverage (export it for testing, as `main.ts` already exports its own parse function) for the four required-flag and scope/root-mismatch error paths.

### Blocking issues

#### Blocking-1: `review-tables` reports success on a translation file `i18n-check` would fail

- File: `tools/i18n-check/src/review/review-tables.ts:274-278`; root cause `tools/i18n-check/src/lib/translation-files.ts:107,126-153`.
- Scenario: any `dotted-key`, `duplicate-key`, "unsupported property form", or `sole-default-key` defect in a scope's `en.json`/`ar.json` — plausible, ordinary typos (a JS-object-style dotted key instead of nesting; a copy-pasted key left duplicated).
- Impact: the artifact this batch exists to produce — a byte-for-byte, human-reviewable side-by-side table that gates the Arabic sign-off (8.3, batches.md:37-38) — silently omits the broken key and reports "up to date"/exit 0, so neither the author nor the human reviewer sees anything wrong, even though the exact same input fails `i18n-check` outright with a named violation. A reviewer's sign-off on this table is not a sign-off on the real file.
- Fix: surface a file's violations in `generate()` whenever any exist (not only when `!file.loaded`), refusing generation the same way an unreadable file does; add a fixture/spec plant for each of the three silently-dropped kinds.

### Serious issues

#### Serious-1: `i18n-check`'s Nx cache inputs have no cross-project scope

- File: `nx.json:64-71` (new `targetDefaults.i18n-check`); compare `nx.json:24-27,49-54,55-60`. Plan source: `implementation-plan.md:352`.
- Scenario: a downstream project's `i18n-check` task is served from a stale GitHub Actions cache entry (restored by OS-prefix, not exact SHA) after an allowed scope it reads (`core`/`ui`) changes in a different commit.
- Impact: CI can report a passing `i18n-check` for a project whose translations are, at that moment, actually broken by an upstream scope change — exactly the "silent failure that misleads a user [into merging]" class this reviewer is asked to hunt for, on the review-focus item the task explicitly named.
- Fix: add a dependency-scoped input (`^production`, or an explicit glob over every project's `src/lib/i18n/*.json`) to the targetDefaults entry; flag the plan text at `:352` as needing the same correction, since the implementation matches it verbatim.

### Moderate and minor issues

- **Moderate:** `formatMarkdown` (`review-tables.ts:248-250`) has no try/catch around Prettier's `format()`; a throw there is caught only by the generic top-level handler (exit 2, no scope label), unlike the isolation this tool already applies to TS/template parsing. Not currently reachable.
- **Moderate:** the allowed-scope-defect pointer mechanism (carry-over item 1) is correct by code reading and direct reproduction, but has no fixture plant or spec of its own in this batch — a regression there would not be caught by `self-test`.
- **Minor:** `review-tables.ts`'s `parseArgs`/CLI entry point is completely untested (no export, no spec coverage) — see Failure mode above.
- **Minor:** `tableCell` (`review-tables.ts:181-188`) does not normalise U+2028/U+2029 (JS line/paragraph separators, valid inside a JSON string value); CommonMark does not treat them as hard breaks, so this is not currently exploitable as a table-breaking injection, but it is an asymmetry worth closing alongside the `\r?\n` handling for defense in depth.

### Data flow

1. `parseArgs` (`review-tables.ts:82-130`) — flags validated, scope checked against `isKnownScope`, `--project-root` cross-checked against `SCOPE_MAP` — reads correct by inspection; **untested** (Minor above).
2. `generate()` loads the glossary and the scope's `en`/`ar` files (`:259-272`) — OK for `missing-file`/`parse-error`/non-object-top-level (all three set `loaded: false` and are fully surfaced); **gap** for `dotted-key`/`duplicate-key`/"unsupported property form"/`sole-default-key`, which stay `loaded: true` and are silently dropped (Blocking-1).
3. `renderScopeTable`/`renderGlossary` (`:194-246`) build the Markdown from `en.entries`/`ar.entries`/`glossary.entries` only — OK for what reaches those maps; inherits gap 2 for what never does.
4. `tableCell`/`reviewNotes` (`:141-188`) — escaping and note computation verified directly against the spec's assertions and a fresh Prettier round-trip check (`format(content) === content`) — OK.
5. `formatMarkdown` (`:248-250`) — OK for the happy path (verified: fixture output is Prettier-stable); no isolation on a Prettier throw (Moderate above).
6. `reviewTables()` writes or `--check`s the two files (`:301-349`) — OK, verified live: writes, `--check` OK, drift detected and reported, `--check` writes nothing on drift (all directly re-run in this review).
7. `main()` (`:351-365`) / CI step (`ci.yml`) — `self-test` runs first (planted-fixture discipline), then `run-many`/`affected` branches on whether `tools/i18n-check/` changed, using `NX_BASE`/`NX_HEAD` from the existing `nx-set-shas` step — OK by inspection and by the sound `git diff`-captured-then-checked pattern (avoids the `grep -q`/`pipefail` SIGPIPE hazard the step's own comment calls out); the branch's actual project selection is not end-to-end testable yet since no project defines the `i18n-check` target before later lib batches add it — **gap**: the cache-hash omission (Serious-1) means even a correct branch selection can still resolve to a stale cached result.

### Requirements fulfilment

| Requirement                                                                                                                                                            | Status                       | Gap                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 4.1: `<out>/<scope>.md` and `<out>/glossary.md`, byte-for-byte deterministic, `--check` exits 1 on drift and writes nothing, unreadable input → exit 1            | PARTIAL                      | Determinism, `--check` semantics and the `missing-file`/`parse-error`/non-object-top-level "unreadable" path are all verified correct and tested live. The three other structural violation kinds are not treated as "unreadable" for this purpose and are silently dropped instead of failing generation (Blocking-1). |
| Task 4.1 carry-over: allowed-scope-defect pointer incl. non-object top-level                                                                                           | COMPLETE                     | None found; verified by reading and by live reproduction.                                                                                                                                                                                                                                                               |
| Task 4.1 carry-over: Arabic word-boundary rule                                                                                                                         | COMPLETE                     | None found.                                                                                                                                                                                                                                                                                                             |
| Task 4.1 carry-over: exact literal offsets, mismatch → parse-error                                                                                                     | COMPLETE                     | None found; the decode/re-encode cross-check and its fallback are exercised directly against the real TS scanner.                                                                                                                                                                                                       |
| Task 4.2: `nx.json` targetDefaults with `cache: true` and the three named inputs                                                                                       | COMPLETE (matches plan text) | The three inputs match `implementation-plan.md:352` verbatim, but the set itself has no cross-project scope, unlike every other cross-project-relevant cached target in the file (Serious-1).                                                                                                                           |
| Task 4.2: CI step named and positioned per spec, `run-many` branch on `tools/i18n-check/` changes, uses `node_modules/.bin/nx`, `NX_BASE`/`NX_HEAD` from `nx-set-shas` | COMPLETE                     | None found; the captured-diff pattern is a sound, documented improvement over the plan's literal `grep -q` pipeline.                                                                                                                                                                                                    |
| Batch 4 verification: `i18n-check:self-test` passes, review-tables run twice is identical, `--check` passes                                                            | COMPLETE                     | Re-ran directly: both hold.                                                                                                                                                                                                                                                                                             |

Implicit requirements not addressed: a review table that omits a malformed key without any indication is not a "byte-for-byte deterministic" artifact a human can trust for a merge-gate sign-off (8.3) — the requirement's spirit (Blocking-1); the cache-input set for a target whose correctness spans project boundaries needing the same dependency-scoping every other such target in `nx.json` already has (Serious-1).

### Edge cases

| Case                                                                | Handled             | How                                                                              | Concern                                                                                  |
| ------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Missing translation file / unparseable JSON / non-object top level  | YES                 | `loaded: false`, surfaced and refuses generation                                 | none                                                                                     |
| Dotted key / duplicate key / unsupported property form in `en`/`ar` | NO                  | silently dropped from the table, `loaded` stays true                             | Blocking-1                                                                               |
| Sole-`default`-key wrapper                                          | NO                  | same gap as above                                                                | Blocking-1                                                                               |
| Entry present with an empty-string/non-string value                 | YES                 | `entries.set(..., value: null)`, surfaced as "invalid English/Arabic value" note | none                                                                                     |
| Key present only in `en` or only in `ar`                            | YES                 | `reviewNotes`, verified in spec and live                                         | none                                                                                     |
| Value identical to English                                          | YES                 | `reviewNotes`, verified                                                          | none                                                                                     |
| Glossary term present in the English value                          | YES                 | `reviewNotes` + `containsTerm`, verified                                         | none                                                                                     |
| Placeholders in either side                                         | YES                 | `placeholdersOf`, verified                                                       | none                                                                                     |
| Markdown/HTML/pipe/newline in a value                               | YES                 | `tableCell` escaping, verified by spec and by a Prettier round-trip check        | U+2028/U+2029 not normalised (Minor, not currently exploitable)                          |
| `--check` against up-to-date files                                  | YES                 | verified live                                                                    | none                                                                                     |
| `--check` against drifted files                                     | YES                 | verified live, writes nothing                                                    | none                                                                                     |
| Inline template with an ECMAScript escape sequence                  | YES                 | `literal-offsets.ts` exact mapping, mismatch → `parse-error`                     | none                                                                                     |
| Inline template whose decode does not match the compiler's          | YES                 | `inlineTemplateOf` mismatch check → `parse-error`                                | none                                                                                     |
| CI: tool-only change vs. lib-only change                            | YES (by inspection) | `git diff`-captured branch                                                       | not exercisable end-to-end yet — no project defines `i18n-check` until later lib batches |
| Cross-project cache correctness for `i18n-check`                    | NO                  | `nx.json` inputs have no dependency scope                                        | Serious-1                                                                                |

### Verdict

- Recommendation: REVISE
- Confidence: HIGH — Blocking-1 is a live, reproduced defect (not a hypothetical): the same throwaway fixture run through `review-tables.ts` and `main.ts` in this review disagrees about whether the file is fit to ship, and the one that says nothing is wrong is the one a human reviewer actually reads. Serious-1 is confirmed by direct comparison against every other cross-project-relevant `targetDefaults` entry already in `nx.json`, and by reading how Nx explicit `inputs` overrides remove default dependency-based hashing. All three Batch-3-round-2 carry-over items are genuinely fixed, verified both by reading and, for the offset-mapping fix, against the real TypeScript scanner's own decoded text.
- Top risk: a lib batch author (or the merge-gate human reviewer at 8.3) trusts a clean-looking `copy-review/<scope>.md` table for a file that `i18n-check` would actually fail, because the table silently omits exactly the keys most likely to need a second look — the malformed ones.
- What a robust implementation would add: (1) `generate()` refuses (or clearly flags) on any structural violation, not only an unreadable file; (2) a dependency-scoped Nx cache input for `i18n-check`, plus a note back to the plan at `:352`; (3) a fixture/spec plant for the allowed-scope-defect pointer and for each of the three silently-dropped violation kinds; (4) `parseArgs`/CLI coverage for `review-tables.ts`, mirroring `main.ts`'s own test discipline.

---

## Batch 4 — round 2

### Summary

| Metric                 | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Overall score          | 9/10                                                                 |
| Assessment             | APPROVED                                                             |
| Blocking issues (open) | 0                                                                    |
| Serious issues (open)  | 0                                                                    |
| Moderate issues (open) | 0                                                                    |
| Blocking fixed         | 1 of 1 (Blocking-1)                                                  |
| Serious fixed          | 1 of 1 (Serious-1, code-logic) + 1 of 1 (style-reviewer's Serious)   |
| Moderate fixed         | 2 of 2 (formatMarkdown isolation, allowed-scope-defect fixture)      |
| Minor fixed            | 3 of 3 (parseArgs coverage, U+2028/U+2029, LINE_TERMINATORS escapes) |

Re-read in full: `tools/i18n-check/src/review/review-tables.ts` + `.spec.ts` (rewritten `generate`/`reviewNotes`/`formatMarkdown`, new `refusing to generate` and `parseArgs` describe blocks), the new `tools/i18n-check/src/lib/cli.ts` + `.spec.ts`, the diffs to `main.ts` (`allowedScopeDefect` call site), `report.ts` (`format-error`/`allowed-scope-defect` kinds), `literal-offsets.ts` (`LINE_TERMINATORS`), `run-self-test.js`, `nx.json`, and the fixture diff (`__fixtures__/project/libs/web/core/src/lib/i18n/en.json`). Ran both commands the coordinator asked for:

- `node_modules/.bin/nx run i18n-check:self-test --skip-nx-cache` → PASS, all three stages: `review-tables --check` OK; pricing 14/14 (13 F2a plants + the new `allowed-scope-defect` pointer); legal 4/4 (`sole-default-key` × 2, `no-source-files`, `allowed-scope-defect`). Matches the executor's report exactly.
- `node_modules/.bin/nx run-many -t test -p i18n-check --skip-nx-cache` → 11 suites / 93 tests, all pass. Matches the executor's report exactly.

Independently re-run, not just taken on the executor's word: `node_modules/.bin/eslint tools/i18n-check/src tools/i18n-check/run-self-test.js` (clean, no output), `node_modules/.bin/tsc -p tools/i18n-check/tsconfig.json --noEmit` (clean), `node_modules/.bin/prettier --check` over the new/changed files (clean), `node_modules/.bin/nx show project i18n-check --json` (resolves, lists `eslint:lint`, `test`, `self-test`, `review-tables`).

### Round-1 items re-verified as fixed

- **Blocking-1 (review-tables reports success on a translation file `i18n-check` would fail):** FIXED at the root, not patched around the symptom. `generate()` now collects `glossary.violations`, `en.violations` and `ar.violations` unconditionally — not gated on `!file.loaded` — and refuses generation (`{ files: [], violations }`, propagated to exit 1 by `reviewTables()`) whenever any exist (`review-tables.ts:288-295`). This correctly still lets parity/placeholder-style gaps (`missing in Arabic`, etc.) through as table _notes_ rather than blocking generation — those aren't loader-level defects, and `reviewNotes` still reports them per row — while every loader-level defect (`dotted-key`, `duplicate-key`, "unsupported property form", `sole-default-key`, unreadable file, invalid glossary) now refuses the whole scope's table. `reviewNotes` correspondingly lost its now-dead "invalid English/Arabic value" branch (`review-tables.ts:133-164`, comment at `:131` explains why: such a value can no longer reach the table). Verified against five new dedicated tests in `review-tables.spec.ts`'s `refusing to generate` block (`:220-283`) — dotted key, duplicate key, invalid value in _either_ file, sole-default-key, and the pre-existing unreadable-file case — each asserting the exact `file:line:[kind] key - detail` line, exit 1, and no `copy-review/` directory created either with or without `--check`. Independently re-run live (not just read): all pass.
- **Serious-1 (`i18n-check`'s Nx cache inputs have no cross-project scope):** FIXED for the relationship that actually exists. `nx.json`'s `targetDefaults.i18n-check.inputs` (`nx.json:64-74`) now adds `libs/web/ui/src/lib/i18n/**/*` and `libs/web/core/src/lib/i18n/**/*` — the exact two scopes `defaultAllowedScopes()` (`scope-map.ts:41-45`) can ever hand any project via `--allow-scope` (every non-`ui`/`core` scope gets `['ui', 'core']`; `core` gets `['ui']`; `ui` gets none) — so the stale-cache scenario reproduced in round 1 (a `core`/`ui` translation defect invisible to a downstream project's cached `i18n-check` result) is closed. One residual, not worth reopening as a finding: the added `apps/ptah-landing-page/src/app/i18n/**/*` glob has no matching consumer — `app` is never returned by `defaultAllowedScopes()`, so this entry only makes every other project's cache bust a little more than strictly necessary (an efficiency cost, not a correctness gap); noted for completeness, not counted against the score.
- **Style-reviewer's Serious (duplicated CLI parsing logic in `main.ts` and `review-tables.ts`):** FIXED. The new `tools/i18n-check/src/lib/cli.ts` holds exactly the three things both entry points needed to agree on — `UsageError`, `toRel`, and `resolveProjectRoot` (the scope/`--project-root` cross-check, `cli.ts:18-33`) — and both `main.ts` and `review-tables.ts` now import from it instead of each defining their own copy (confirmed via `grep`: a single `UsageError` class definition in the whole tool, at `cli.ts:9`). The module is small, single-purpose, and its own docstring correctly states its scope ("what they must agree on", not a dumping ground for anything CLI-shaped) — each entry point still owns its own flag table and `USAGE` string, which is the right split since those differ (`review-tables` needs `--out`; `main.ts` needs `--allow-scope`). `cli.spec.ts` covers `resolveProjectRoot`'s normal, cross-scope-rejection and unknown-scope paths, and `toRel`'s Windows-path-separator handling, directly. Style read: consistent with the rest of the tool's JSDoc/export conventions, no naming or cohesion issues found.
- **Moderate (formatMarkdown exceptions not isolated per scope):** FIXED, and fixed with a distinct new violation kind rather than folded into an existing one. `formatMarkdown` now returns `Promise<string | Violation>`, catching a Prettier throw and producing a `format-error` violation naming the scope and the _output_ file path (`review-tables.ts:242-261`); `generate()`'s draft-formatting loop routes a `Violation` result into the same refusal path as a loader defect (`:310-322`). Verified live via `review-tables.spec.ts`'s `jest.mock('prettier/standalone', ...)` (`:19-31`), which makes Prettier throw only for markdown containing a specific marker string and formats everything else for real — a real, executed regression test for exactly this failure mode, not an inference from reading the code. One residual, cosmetic only: violations accumulated after the draft-formatting loop are not passed through `normaliseViolations` the way the early-return glossary/en/ar path is (`review-tables.ts:323-325` vs `:293-295`); with at most two `format-error` entries in deterministic draft order (scope table, then glossary), this has no observable effect and is not worth a finding.
- **Moderate (allowed-scope-defect pointer had no fixture plant):** FIXED. `__fixtures__/project/libs/web/core/src/lib/i18n/en.json` now plants a real dotted key (`"legacy.title"`), and `run-self-test.js` expects the resulting `allowed-scope-defect` pointer in _both_ the pricing run (which allows `core`) and the legal run (`:76-81`, `:122-127`) — a stronger plant than the minimum, since it proves the pointer is per-consumer, not a one-off. Re-run live: both plants report exactly as expected, and `allowedScopeDefect`'s call site was also simplified to take the pre-filtered `structural` violation list directly (`main.ts:396-405`) rather than filtering inside the function, a small, correct readability cleanup with no behaviour change (confirmed by identical self-test output content, not just its exit code).
- **Minor (`review-tables.ts`'s `parseArgs` untested):** FIXED. `parseArgs` is now exported and directly tested (`review-tables.spec.ts:285-334`): valid parse with `--check` in an arbitrary position, all four required flags, the unknown-flag path, and the cross-scope `--project-root` rejection (via the shared `resolveProjectRoot`).
- **Minor (`tableCell` does not normalise U+2028/U+2029):** FIXED. `tableCell`'s newline pattern is now `/\r?\n| | /g` (`review-tables.ts:177`), directly asserted in the escaping spec (`:129`, `tableCell('a\r\nb c d')` → `'a<br>b<br>c<br>d'`).
- **Minor (`LINE_TERMINATORS` used raw pasted Unicode characters instead of escapes):** FIXED. `literal-offsets.ts:35` now reads `new Set(['\n', ' ', ' '])` — an explicit, greppable escape rather than an invisible pasted character in the source, with no behaviour change (same code points).

### New issues this round

None found. No new logic gap was introduced by any of this round's changes; each fix was read against its own new/updated test and, where feasible, re-run live rather than taken on report.

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH — every fix was verified against the running code: both requested `nx` commands executed live and matched the executor's reported counts exactly, plus independent live runs of eslint, tsc and prettier rather than trusting the executor's "0"/"clean" claims. Blocking-1's fix was checked against its five new dedicated tests and by re-reading the exact code path that produced the round-1 reproduction (the early, unconditional violation collection now short-circuits before any table is built). Serious-1's fix was checked against the only two scopes `defaultAllowedScopes()` can ever return, not just against the diff's literal text.
- Top risk: none blocking or serious. The two noted residuals (an unreachable `app` cache-input glob; two `format-error` violations not routed through `normaliseViolations`) are both cosmetic, have no correctness impact given their current reachability, and are not worth a follow-up item on their own.
- What a robust implementation would add: nothing required before this batch closes. If touched again, route the post-formatting `violations` array through `normaliseViolations` for consistency with the early-return path, and consider dropping the unreachable `apps/ptah-landing-page/src/app/i18n/**/*` cache input (or adding a real consumer that needs it) the next time `nx.json` is edited.

## Batch 5

### Scope

Tasks 5.1-5.2 (RTL pattern rule, AST formatting rule), uncommitted. Read in full: `tools/i18n-check/src/lib/rtl-patterns.ts` (+`.spec.ts`), `rtl-sources.ts` (+`.spec.ts`), `format-patterns.ts` (+`.spec.ts`), `key-resolver.ts` (+`.spec.ts`, a pure extraction of `KeyResolver`/`TargetMap` from `main.ts`, no logic change), the diffs to `markers.ts` (+`.spec.ts`), `template-keys.ts` (+`.spec.ts`, `preserveWhitespaces: true` switch), `ts-keys.ts` (+`.spec.ts`, `componentMetadataName`/`inlineSourceOf` generalisation), `report.ts` (new `ViolationKind`s), `main.ts` (+`.spec.ts`, wiring), `run-self-test.js`, and the new fixture `libs/web/pricing/src/lib/rtl-format.component.{html,ts,css}`. Cross-read `implementation-plan.md:59,302-339,505-530` and `design-spec.md §3.1-3.5` for the contract.

Verification run live, not taken on report: `node_modules/.bin/nx run i18n-check:self-test --skip-nx-cache` → PASS (review-tables --check OK; pricing 22/22 planted incl. the 8 new F2b sites; legal 4/4). `node_modules/.bin/nx run-many -t test -p i18n-check` → green. Beyond the requested commands, I isolated `evaluateClassTokens`/`parseClassToken` in throwaway scripts (`ts-node --transpile-only`, deleted after use, never committed) to probe combinations the fixture does not exercise (responsive/state prefixes, arbitrary/negative values, `inset-x-*`, `justify-left`, `scroll-ml-*`, cross-family `rtl:` pairing) and grepped `libs/web/landing`/`apps/ptah-landing-page` for real `inset-x-*`/`left-*` usage as an informal false-positive smoke check (no `en.json` exists yet for `landing`, so a real `i18n-check` run there is not yet meaningful — RTL rollout is a later batch).

### Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

### Five logic questions

**1. How does this fail silently?**

The RTL rule's cross-family pairing check is the main one. `evaluateClassTokens` (`rtl-patterns.ts:181-230`) computes `awareFamilies` from _any_ token in the group that carries an `rtl:`/`ltr:` variant and whose bare utility matches a `RTL_UTILITY_PATTERNS` family (`:190-195`), then skips _every_ physical token of that same family (`:218`) — not just the specific token the variant was meant to pair with. So `class="ml-4 rtl:mr-8"` on one element passes with **zero** violations (verified live, see Serious-1 below), even though in an RTL page both `ml-4` (unconditional) and `mr-8` (via `rtl:`) apply at once — the element gets margin on _both_ sides, not a mirrored margin on one side. The checker reports success (no violation) for code that is not RTL-correct.

**2. What user action produces unexpected behaviour?**

A developer placing an `rtl-exempt:`/`i18n-format-exempt:` comment _after_ the flagged code on the same physical line — a natural, common style, and one the batch's own task text names as valid ("same line, preceding line, or before the containing start tag", `batches.md:429`) — gets no exemption and no explanation: the violation is still reported as if no marker were present (see Moderate-1). The marker's `reason` is non-empty, so it also doesn't trip `bare-marker`; the developer sees a violation that looks unaffected by their comment, with no diagnostic telling them why.

**3. What input data produces a wrong answer?**

Beyond the pairing gap in Q1: `padding`/`margin` shorthand with asymmetric values (`padding: 0 8px 0 16px;`) is invisible to `CSS_DECLARATION` (`rtl-patterns.ts:124-125`), which only matches the `-left`/`-right` longhand property names, not the shorthand. This is consistent with the literal 4.1 list in the plan (which never names the shorthand) and the self-test fixture doesn't claim to cover it, so I record it as a documented scope limit (Q5), not a defect — flagging it here because it's a plausible source of a `padding: 0 8px 0 16px` slipping through RTL review in a later batch.

**4. What happens when a dependency fails?**

Handled well and consistently with Batch 3's pattern. A template that fails `parseTemplate` short-circuits before any RTL/format scan runs on it (`main.ts:190-192`, `template-keys.ts:135-143`) — reported as `parse-error`, not silently skipped from the violation count. A `.ts` file with TS diagnostics is likewise reported and skipped (`main.ts:253-267`) before `rtlTsFindings`/`formatTsFindings` ever run on it, so a syntactically broken file cannot produce a false "clean" RTL/format result. An inline `styles` string whose escape sequences can't be mapped back to source positions (`scanInlineStyles`, `rtl-sources.ts:306-338`) is reported as its own `parse-error`-shaped `SiteViolation` (`kind: 'parse-error'`, `exemptBy: null` — deliberately un-exemptable) rather than silently dropped or mis-positioned. One file throwing in `scanFile` doesn't stop the run (`main.ts:206-219`), matching the documented "one file's failure is that file's failure" contract.

**5. What is missing that the requirements never mentioned?**

- No check that an `rtl:` pairing partner is the _correct_ opposite-side utility (Q1) — the plan's own worked example is `translate-x-4` / `rtl:-translate-x-4` (same magnitude, negated), but nothing enforces that relationship; family membership alone is accepted.
- CSS shorthand (`margin:`, `padding:`) direction-sensitive values are out of scope for this rule (Q3), which is a legitimate call for this task's requirement list but is worth a line in `design-spec.md`/plan for whoever does the RTL rollout batches, so they know the checker won't catch it.
- `.css` file scans (`rtlCssFindings` called directly from `main.ts:235-241`) have no island concept at all — a component `.css` file styling elements that are always rendered inside a `dir="ltr"` block gets no auto-exemption the way the same rule gets in `.html`/inline `styles`+templates. This is architecturally hard to fix (a `.css` file has no DOM to inspect) and is not named as a requirement, so it's a residual note, not a finding.

### Failure modes

#### Cross-family `rtl:` pairing bypass

- Trigger: an element (or TS-object/line group) carries a physical utility from `RTL_UTILITY_PATTERNS` together with _any_ `rtl:`/`ltr:`-prefixed utility from the same `family`, regardless of whether the two are the documented mirror pair.
- Symptom: `i18n-check` reports zero violations for RTL-incorrect markup; a code reviewer or CI gate sees the tool pass.
- Evidence: `rtl-patterns.ts:190-195` (`awareFamilies` built from family membership only) and `:218` (`if (awareFamilies.has(pattern.family)) continue;`, applied to every family in the loop, not just the three families the plan documents pairing for). Confirmed live: `evaluateClassTokens([{token:'ml-4',...},{token:'rtl:mr-8',...}], false, 'x')`, `['pl-2','rtl:pr-6']`, `['rounded-l','rtl:rounded-r-lg']`, `['text-left','rtl:text-right']`, `['border-l','rtl:border-r-2']` — every one of these five combinations returns `[]` (no violations) when run through the real `evaluateClassTokens`.
- Current handling: none — the same "family-aware" escape hatch that is correct for `translate-x`/`bg-gradient-to-*`/`origin-*` (plan: "get paired `rtl:` variants", `RTL_UTILITY_PATTERNS` `fix` text explicitly says "a paired rtl: variant" only for those three families and `space-x`) is silently extended to `margin-x`, `padding-x`, `inset-x`, `rounded`, `border-x`, `text-align` and `float`, whose own `fix` strings in the same file (`:54,:59,:64,:69,:74,:79,:104`) never mention pairing as an accepted alternative — only logical-utility conversion. The two are contradicted by the same file's own data.
- Recommendation: restrict the `awareFamilies` bypass to the families the plan documents as pairing-eligible (`translate-x`, `gradient`, `origin`, and `space-x`'s existing `reverse` case); for every other family, require the token itself to become the logical utility (no rtl:-pairing escape). At minimum, gate the bypass on the specific opposite-side utility name (`ml-*` paired only with `rtl:mr-*` of the same numeric value, not any same-family variant) so a mismatched pair like `ml-4 rtl:mr-8` still fails.

#### Same-line trailing exempt markers are silently ineffective

- Trigger: `rtl-exempt: <reason>` or `i18n-format-exempt: <reason>` placed _after_ the offending code on the same physical line, in a `.ts` file or at the end of a CSS block/declaration.
- Symptom: the violation is still reported, with no indication that the marker was seen but discarded; a developer who follows the task's own documented positions ("same line", `batches.md:429`) gets an ineffective marker and no feedback loop telling them to move it.
- Evidence: `markers.spec.ts:125-133` (`'attaches a trailing or final comment to nothing, but still reports it'`, asserting `covers: null` for `const a = 1; // i18n-keys: core.a.b`, same class of comment as `rtl-exempt`/`i18n-format-exempt` since they share `parseMarkerComment`/`tsMarkers`) and `rtl-patterns.spec.ts:270-273` (`'cover nothing at the end of a block'`, `.a { left: 0; /* rtl-exempt: */ }` → `covers: null`). No test anywhere in this batch (`rtl-sources.spec.ts`, `format-patterns.spec.ts`, `main.spec.ts`'s new "RTL and formatting rules" block) exercises a trailing-same-line exempt marker that _does_ attach — every passing exempt-marker test in the new suite (`main.spec.ts:181-243`) places the comment on its own preceding line.
- Current handling: none — `markers.ts`'s docstring (`:17-19`) is explicit that a TS comment only covers "the node it leads" via `onOwnLine` (`:134-137`), and `statementAfter` (`rtl-patterns.ts:332-352`) only looks _forward_ from the comment, never backward to the declaration that already ended.
- Recommendation: either narrow Task 5.1's stated marker-position contract to "preceding line, or before the containing start tag" (dropping "same line" for `.ts`/CSS, keeping it for the HTML before-start-tag case that genuinely is same-line), or extend `tsMarkers`/`statementAfter` to also attach a trailing marker to the _previous_ statement/declaration when nothing follows it on the same line. Either way this is a spec/implementation mismatch worth resolving explicitly rather than leaving latent.

#### Bound `dir` unconditionally exits the island regardless of surrounding markup

- Trigger: an element with a bound `[dir]`/`[attr.dir]` input sits inside (or itself carries) a static `dir="ltr"`/`class="ltr-island"` ancestor.
- Symptom: that one element (and only that element, per `islandOf`'s per-node evaluation) is treated as _not_ an island, so its own physical utilities are flagged, while siblings without the bound attribute keep passing.
- Evidence: `rtl-sources.ts:74-76` — the bound-`dir` check runs before the static-class check and returns `false` unconditionally, discarding `inherited`/class evidence for that node.
- Current handling: intentional and documented ("a bound direction is not known to be LTR", `rtl-sources.ts:10`) — a conservative, defensible choice given the design's evidence row on `rtl:rotate-90` bindings. I list it here only as a residual, not a finding: it's a real design tradeoff (false positive on a legitimately-LTR dynamic element) rather than a bug, and no fixture or plan text contradicts it.

### Blocking issues

None.

### Serious issues

#### Serious-1: RTL `rtl:` pairing bypass is not scoped to the families the plan allows it for

- File: `tools/i18n-check/src/lib/rtl-patterns.ts:181-230` (`evaluateClassTokens`, `awareFamilies` at `:190-195`, bypass at `:218`)
- Scenario: any element or TS object/line carrying both a physical utility (`ml-*`, `pl-*`, `left-*`/`right-*`, `text-left`/`text-right`, `rounded-l*`/`rounded-r*`, `border-l*`/`border-r*`, `float-left`/`float-right`) and an unrelated `rtl:`/`ltr:`-prefixed utility of the same family.
- Impact: the RTL rule's core guarantee — "zero unexempted physical-direction matches" (plan §8, "RTL conversion rollout") — is not actually enforced for these seven families once any same-family `rtl:` variant is present anywhere in the group; a reviewer or CI relying on a clean `i18n-check` run for RTL correctness gets a false clean bill for markup that is not correctly mirrored. Demonstrated live (see Failure modes, above) for `margin-x`, `padding-x`, `rounded`, `text-align` and `border-x`.
- Fix: restrict the bypass to `translate-x`, `gradient`, `origin` (and keep `space-x`'s existing `reverse`-suffix handling), matching the `fix` hints already present in `RTL_UTILITY_PATTERNS` for the other families, which never offer pairing as an alternative to logical conversion. Add a regression test asserting `ml-4 rtl:mr-8` (and the `pl-*`/`rounded-*`/`text-*`/`border-*` equivalents) still fails.

### Moderate and minor issues

- **Moderate-1**: `rtl-exempt:`/`i18n-format-exempt:` markers placed _after_ the flagged code on the same physical line in `.ts` sources, or at the end of a CSS declaration/block, never attach (`covers: null`) and so never exempt anything, silently contradicting Task 5.1's stated "same line" marker position (`batches.md:429`). Evidence: `markers.spec.ts:125-133`, `rtl-patterns.spec.ts:270-273`. See Failure modes above.
- **Moderate-2**: CSS shorthand `margin:`/`padding:` with asymmetric left/right values is out of the RTL rule's scan (`CSS_DECLARATION`, `rtl-patterns.ts:124-125`, only the longhand property names). Matches the plan's literal 4.1 list, so not a defect against this batch's stated scope, but worth a note for whoever relies on this rule during the RTL rollout batches, since it's an easy way for direction-sensitive CSS to slip through undetected.
- Minor: `.css`-file scans have no island concept (`main.ts:235-241` calls `rtlCssFindings` directly, with no DOM/class context available); architecturally expected given a standalone `.css` file carries no markup, not a fixable gap in this rule's design, noted for completeness only.

### Data flow

1. `scanProject` (`main.ts:152-221`) globs `.ts`/`.html`/`.css` under the project's `src`, excluding specs — OK.
2. Each `.html` file is parsed once via `parseTemplateSource` (`preserveWhitespaces: true`, `collectCommentNodes: true`) and the same tree is shared by key extraction, `rtlTemplateFindings` and `formatTemplateFindings` (`main.ts:189-201`) — OK, avoids a double-parse and the whitespace-collapse span-shift bug the switch to `preserveWhitespaces` was made to avoid (documented at `template-keys.ts:119-121`).
3. Blank `TmplAstText` nodes are excluded from `nodeSpans` before marker-sibling resolution (`template-keys.ts:162-163`) — OK, confirms deviation (1) is real and does not regress Batch 3's key-marker attachment (self-test's pricing run, which exercises Batch 3's marker fixtures, still passes all 22 planted violations unchanged).
4. Each element's class/style tokens are gathered with the element's own island state (`rtl-sources.ts:82-162`) and judged together via `evaluateClassTokens`/`propertyViolation` — OK for island semantics (verified: fixture's `dir="ltr"` block passes `left-0` and fails `rtl:rotate-180`; `ltr-island` class does the same) — **gap** at the family-pairing step (Serious-1).
5. `.ts` files are scanned once with `parseTypeScriptFiles`/`ts.createProgram` (parent pointers available, verified no crash risk for `componentMetadataName`'s `node.parent.parent` access) — string literals, inline `styles`, and object-literal positions are each judged (`rtlTsFindings`, `rtl-sources.ts:224-276`) — OK, matches the documented per-line grouping.
6. `.css` files are scanned standalone via `rtlCssFindings` (`main.ts:235-241`) — OK for declarations/`@apply`, no island concept (Minor, noted above, architecturally expected).
7. All RTL/format `SiteViolation`s accumulate in `scan.sites` before markers are applied in one pass at the end of `run()` (`main.ts:487-500`), keyed by exact `exemptBy` kind and `coversOffset` — OK, kind-specific exemption verified live (`main.spec.ts`'s new block: a `format-exempt` marker drops the date pipe but not the co-located `mr-2` physical match) — **gap** for trailing-same-line markers (Moderate-1).
8. `normaliseViolations` sorts/dedupes and `main()` prints/exits 1 — unchanged from Batch 3/4, OK.

### Requirements fulfilment

| Requirement                                                                                                                                                                | Status   | Gap                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 Tailwind utility list (ml/mr/pl/pr, left/right, text-left/right, rounded-*, border-l/r, space-x, translate-x, bg-gradient-to-l/r, origin-left/right, float-left/right) | PARTIAL  | All utilities detected (verified live incl. negative/arbitrary values and responsive/state prefixes); the `rtl:`-pairing escape is over-broad for 7 of 11 families (Serious-1) |
| 4.1 raw CSS (left/right, margin-_, padding-_, text-align)                                                                                                                  | COMPLETE | Longhand only, matches the literal plan list (Moderate-2 is a documented scope note, not a gap against 4.1 as written)                                                         |
| Centring-pair allow-list                                                                                                                                                   | COMPLETE | Verified live and via fixture (`left-1/2 -translate-x-1/2`, CSS `left: 50%` + `translateX(-50%)`)                                                                              |
| `rtl-exempt:`/`i18n-format-exempt:` markers, bare-marker check                                                                                                             | PARTIAL  | Preceding-line and before-start-tag positions work and are tested; same-line-trailing does not (Moderate-1), despite being named in Task 5.1                                   |
| LTR island auto-exemption, `rtl:`/`ltr:` fails inside island, nested `dir` resets                                                                                          | COMPLETE | Verified via fixture and reasoning through `islandOf`; bound-`dir` handling is a defensible, documented conservative choice                                                    |
| 5.1 AST formatting rule (pipes, `toLocale*String`, `Intl.X`, type unions excluded)                                                                                         | COMPLETE | Verified live via fixture and `Moment = number \| Date` pass                                                                                                                   |
| F2b fixture / self-test growth (plan Component 2 "degradation-audit discipline")                                                                                           | COMPLETE | Self-test re-run live, 22/22 pricing + 4/4 legal, no unplanted leaks                                                                                                           |
| Batch 4 carry-over: move `KeyResolver`/`TargetMap` out of `main.ts`                                                                                                        | COMPLETE | `key-resolver.ts` is a faithful extraction, no logic change                                                                                                                    |

Implicit requirements not addressed: a regression test proving the `rtl:` pairing bypass is _not_ available for `margin-x`/`padding-x`/`rounded`/`text-align`/`border-x` (none exists; the gap was only found by direct probing, not by a failing test).

### Edge cases

| Case                                                                    | Handled | How                                                                          | Concern                                                                                                                       |
| ----------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `-ml-2` / `left-[38%]` (negative, arbitrary values)                     | YES     | `VALUE` regex alternation                                                    | none                                                                                                                          |
| `md:ml-4`, `hover:pl-2`, `group-hover:mr-1` (responsive/state prefixes) | YES     | `parseClassToken` splits on top-level `:`                                    | none                                                                                                                          |
| `inset-x-0`/`inset-x-3` (symmetric, should not match)                   | YES     | anchored `left\|right` regex, verified against real `libs/web/landing` usage | none                                                                                                                          |
| `justify-left`, `scroll-ml-2`, `data-left` (false-positive risk words)  | YES     | full-token anchored regex / attribute-name filter, verified live             | none                                                                                                                          |
| `!ml-4` / `ml-4!` (Tailwind important)                                  | YES     | `parseClassToken` strips leading/trailing `!`                                | none                                                                                                                          |
| `ml-4 rtl:mr-8` (mismatched cross-family pairing)                       | NO      | family-only bypass, verified live to pass with 0 violations                  | Serious-1                                                                                                                     |
| `rtl:`/`ltr:` variant inside `dir="ltr"` island                         | YES     | `evaluateClassTokens` island branch, fixture-verified                        | none                                                                                                                          |
| Nested `dir="rtl"`/`dir="auto"` resets an island                        | YES     | `islandOf` re-evaluates per element from its own `dir` attribute             | none                                                                                                                          |
| `@apply` in `.css` and inline `styles`                                  | YES     | `CSS_APPLY` regex, shared by both entry points                               | none                                                                                                                          |
| Host `[class.x]`/`[style.x]` string keys in TS                          | YES     | `CLASS_BINDING_KEY`/`STYLE_BINDING_KEY`, spec-tested                         | none                                                                                                                          |
| camelCase style object keys (`marginLeft`, `textAlign`)                 | YES     | `kebab()` normalisation, spec-tested                                         | none                                                                                                                          |
| `toLocale*String` in templates and TS, incl. safe-call/optional-chain   | YES     | `Call`/`SafeCall` in templates, `PropertyAccessExpression` unwrap in TS      | none                                                                                                                          |
| `Intl.X(...)` first-arg not an `intlLocale()` call                      | YES     | `isIntlLocaleCall`, direct-call only                                         | a variable holding `intlLocale()`'s result (not a direct call) still flags — matches the plan's literal wording, not a defect |
| `number \| Date` type union not matched as a pipe                       | YES     | AST-based (no raw-text scan), fixture-verified                               | none                                                                                                                          |
| `rtl-exempt:`/`i18n-format-exempt:` same-line-trailing                  | NO      | `covers: null`, verified via existing spec assertions                        | Moderate-1                                                                                                                    |
| CSS shorthand `margin:`/`padding:` asymmetric values                    | NO      | out of `CSS_DECLARATION`'s property list                                     | Moderate-2 (documented scope limit)                                                                                           |
| Unparseable template / TS syntax error                                  | YES     | reported as `parse-error`, RTL/format scan skipped for that file only        | none                                                                                                                          |
| Unreadable inline-style escape sequences                                | YES     | reported as a dedicated un-exemptable `parse-error` site                     | none                                                                                                                          |

### Verdict

- Recommendation: REVISE
- Confidence: HIGH — Serious-1 was not inferred from reading the code; it was reproduced live against the actual `evaluateClassTokens` export in five independent family combinations, none of which appear anywhere in the fixture or spec suite (the fixture and specs only ever test same-utility pairing, e.g. `translate-x-1/2` with itself, never a mismatched cross-utility pair within a non-pairing-eligible family). Moderate-1 is backed by the batch's own committed spec assertions (`markers.spec.ts:125-133`, `rtl-patterns.spec.ts:270-273`), not a hypothetical.
- Top risk: a developer (or a later RTL-rollout batch) converting `ml-4`/`pl-2`/`rounded-l`/`text-left`/`border-l` utilities can satisfy `i18n-check` by adding _any_ same-family `rtl:` variant instead of the correct logical utility, producing markup that is asymmetrically wrong under RTL while the tool reports success.
- What a robust implementation would add: (1) scope the `awareFamilies` pairing bypass to `translate-x`/`gradient`/`origin`/`space-x` only, with a regression test locking in that `margin-x`/`padding-x`/`rounded`/`text-align`/`border-x`/`inset-x`/`float` reject same-family-but-mismatched pairs; (2) either extend trailing-comment attachment for `.ts`/CSS or narrow Task 5.1's stated marker-position contract so it doesn't promise a position the implementation doesn't honour.

## Batch 5 — round 2

### Summary

| Metric                 | Value                           |
| ---------------------- | ------------------------------- |
| Overall score          | 9/10                            |
| Assessment             | APPROVED                        |
| Blocking issues (open) | 0                               |
| Serious issues (open)  | 0                               |
| Moderate issues (open) | 0                               |
| Serious fixed          | 1 of 1 (Serious-1)              |
| Moderate fixed         | 2 of 2 (Moderate-1, Moderate-2) |
| New issues this round  | 0                               |

Re-read in full: `tools/i18n-check/src/lib/rtl-patterns.ts` (+`.spec.ts`), `markers.ts` (+`.spec.ts`), the `detachedMarker` wiring in `main.ts:419-425`, `report.ts`'s new `detached-marker` kind, `run-self-test.js`, and the fixture diffs (`rtl-format.component.html:8-10`, `.ts:45-46`, `.css:19-28`). Ran both requested commands live, not taken on report:

- `node_modules/.bin/nx run i18n-check:self-test --skip-nx-cache` → PASS, all three stages: `review-tables --check` OK; pricing **25/25** planted violations reported, none unplanted, no must-pass leak; legal 4/4 unchanged. Output matches the executor's report exactly, including the three new lines (`rtl-format.component.html:10: [rtl-physical] ml-6`, `.css:21: [rtl-physical] padding` with the four-value detail text, `.ts:46: [detached-marker]`).
- `node_modules/.bin/jest --config tools/i18n-check/jest.config.ts --rootDir tools/i18n-check` (the `nx run-many -t test -p i18n-check --skip-nx-cache` target, run directly for visible counts) → **15 suites / 211 tests**, all pass. Matches the executor's report exactly.

Independently re-run, not just taken on the executor's word: `node_modules/.bin/tsc -p tools/i18n-check/tsconfig.json --noEmit` (clean), `node_modules/.bin/eslint tools/i18n-check/src tools/i18n-check/run-self-test.js` (clean). I also isolated `rtlCssFindings` in a throwaway script (deleted after use, never committed) against five shorthand combinations not in the fixture or specs (`!important` with all four values different, a symmetric 4-value form, a 2-value form, matching-`calc()` at positions 2/4 with differing 1st/3rd, and mismatched `calc()` at 2/4) to confirm the comparison is really right(2nd)-vs-left(4th) and not, say, an accidental full-string compare — all five behaved correctly.

### Round-1 items re-verified as fixed

- **Serious-1 (`rtl:` pairing bypass not scoped to pairing-eligible families):** FIXED at the root. `PAIRABLE_FAMILIES` (`rtl-patterns.ts:187-191`) now names exactly `translate-x`, `gradient` and `origin`; `evaluateClassTokens`'s `pairedFamilies` set (`:210-219`) only admits a family through that allowlist (plus the pre-existing, separately-handled `space-x-reverse` special case), and every other family (`margin-x`, `padding-x`, `inset-x`, `text-align`, `rounded`, `border-x`, `float`) can no longer be bypassed by an unrelated same-family `rtl:` variant. Verified live, not just read: I re-ran the exact five combinations from my round-1 finding (`ml-4 rtl:mr-8`, `pl-2 rtl:pr-6`, `rounded-l rtl:rounded-r-lg`, `text-left rtl:text-right`, `border-l rtl:border-r-2`) through the committed `rtl-patterns.spec.ts` (`it.each` block at `:147-160`, plus `'does not pair across families'` at `:162-166`) via the live test run above — all now fail as `rtl-physical`, naming the physical token. The three legitimately pairing-eligible families are still exercised and still pass (`:133-145`). The fixture plants the exact case from my report (`ml-6 rtl:mr-8`, `rtl-format.component.html:10`) and the self-test asserts it live.
- **Moderate-1 (same-line-trailing `rtl-exempt:`/`i18n-format-exempt:` silently ineffective) and a second, previously-unknown gap (a comment directly before a closing `}` was never even found):** FIXED, and fixed more thoroughly than I asked for. Rather than making trailing comments attach (which would have meant guessing which of two adjacent statements a trailing comment refers to — a real ambiguity my round-1 recommendation didn't resolve either), the fix keeps attachment rules unchanged and instead makes every marker that covers nothing into a first-class, always-reported `detached-marker` violation (`markers.ts:84-94`, wired unconditionally in `main.ts:424-425` via `push(detachedMarker(marker))`, ahead of and independent of the existing `bare-marker` reason check). This directly closes the silent-failure gap from my report: a developer whose exempt comment doesn't attach now gets an explicit line telling them why and how to fix it ("attaches to nothing; put the marker on its own line directly above the code"), instead of the violation just reappearing unexplained. I traced the mechanism for double-counting or newly-wrong attachment risk, since the fix also adds a second, token-level tree walk (`markers.ts:134-143`, `find`, using `node.getChildren(source)` rather than `ts.forEachChild`) to catch comments that only lead a non-node token (e.g. a block's closing brace) and so were invisible to the original node-level walk entirely — this is a genuine, separate bug the executor found and fixed (not one I'd flagged), confirmed real by tracing that `ts.forEachChild` never visits punctuation tokens, so `getLeadingCommentRanges` was never queried at a closing-brace's position before this change. The new walk only _adds entries to the `comments` map_ (keyed by the comment's own file offset, so a comment already found by the first walk is never revisited) and never touches the `leads` map that decides _what_ a marker covers — I confirmed this by reading both walks side by side: `find` has no `leads.set` call anywhere, so no marker's `covers` can change as a result of this addition, only previously-undetected orphaned comments become visible (and thus reported) for the first time. Verified live via the new `markers.spec.ts` tests (`'finds a marker before a closing brace, attached to nothing'`, `describe('detachedMarker', ...)`) and `main.spec.ts`'s `'reports a marker of any kind that attaches to nothing'`, all passing in the full run above. The fixture plant (`rtl-format.component.ts:46`, `readonly seam = 38; // rtl-exempt: fixed seam`) is exactly the same-line-trailing case from my round-1 report and is asserted live by the self-test.
- One deliberate, correct side effect worth naming rather than filing as a new issue: a marker that is _both_ detached (`covers: null`) _and_ bare (`reason === ''`) — e.g. `.a { left: 0; /* rtl-exempt: */ }` from the round-1 spec — now produces **two** violation lines (`detached-marker` and `bare-marker`) instead of one, since `detachedMarker` is pushed unconditionally ahead of the `reason === ''` check (`main.ts:424-431`). I checked this is not tested as a double-report anywhere and is not double-counting the _same_ problem — a marker that both fails to attach and lacks a reason genuinely has two independent defects, and each diagnostic is independently actionable (move the comment; also, write a reason). Not a finding.

### New issues this round

None found. Both fixes were traced against the actual mechanism (not just their tests) — the pairing fix against the `PAIRABLE_FAMILIES`/`pairedFamilies` code path directly, and the marker fix against both tree walks in `markers.ts` line by line — and both were re-run live rather than taken on the executor's report.

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH — Serious-1's fix was checked against the same five reproduction cases that proved the original bug, run through the live jest suite, not re-derived from reading the diff alone; the fixture's `ml-6 rtl:mr-8` plant and the self-test's live 25/25 output were independently confirmed, not taken on the executor's word. Moderate-1's fix required tracing two tree walks in `markers.ts` to rule out both a regression (a previously-attaching marker losing its attachment) and an over-detection risk (double-reporting the same comment); neither occurs, and the second walk's inability to touch `leads` was confirmed by reading it, not inferred.
- Top risk: none blocking, serious or moderate. The double-diagnostic case for a marker that is both detached and bare is a minor, correct, untested-but-harmless interaction, not worth a follow-up item.
- What a robust implementation would add: nothing required before this batch closes. If touched again, a small dedicated test asserting `detached-marker` and `bare-marker` both fire for the same marker would document the interaction I traced by hand in this round, rather than leaving it implicit.

## Batch 6

Scope: Batch 6 only (Tasks 6.1-6.3, uncommitted). Files reviewed in full:
`tools/i18n-check/src/prerender/check-prerender.ts` and its spec, the diffs to `package.json`,
`package-lock.json`, `.prettierignore`, `tools/i18n-check/jest.config.ts`,
`tools/i18n-check/src/lib/report.ts` and `.github/workflows/deploy-landing.yml`, and all six
`apps/ptah-landing-page/prerender-baseline/*.json` baselines. Cross-read: `tools/i18n-check/src/lib/{cli.ts,scope-map.ts}`
(`toRel`, `UsageError`, `KNOWN_SCOPES`) as used by the new prerender module. The already-committed
`.sonarcloud.properties` change is out of scope per the task and was not reviewed. `git status`/`git diff --stat`
confirms the batch touches exactly the files listed above plus two new directories
(`tools/i18n-check/src/prerender/`, `apps/ptah-landing-page/prerender-baseline/`); no template, route or
`nx.json`/`project.json` file is touched, consistent with "must precede every template edit."

Verification run:

- `node_modules/.bin/nx run-many -t test -p i18n-check` → green.
- `node_modules/.bin/nx run i18n-check:self-test` → both stages PASS (pricing 25/25 planted violations named, legal 3/3 named, no must-pass line named).
- `node_modules/.bin/ts-node --transpile-only --project tools/i18n-check/tsconfig.json tools/i18n-check/src/prerender/check-prerender.ts --dist dist/ptah-landing-page/browser --baseline apps/ptah-landing-page/prerender-baseline`, run directly against the pre-existing `dist/ptah-landing-page/browser` build (built 2026-09-27 16:01, from the unmodified templates — no `apps/ptah-landing-page/src`/`libs/web` changes are staged in this batch or any later one yet) → **6 `prerender-dir` violations only**, zero `prerender-drift`/`prerender-lang`/`prerender-key-path`/`prerender-empty-heading` violations. This is exactly the documented gap (Task 6.3 team-leader note: `dir` does not render until Batch 9) and independently confirms the six baselines were captured from, and still match, the real unmodified build byte-for-text.
- `node_modules/.bin/prettier --check apps/ptah-landing-page/prerender-baseline/*.json` → clean (satisfies the team-leader's Task 6.3 note 1: the pre-commit `nx format:write` will not touch these files).
- Manually replayed the CI `Assert prerendered content` step's new `grep` lines (`lang="en"`, `dir="ltr"`, per-route `HEADLINE` anchor, `KEY_PATH`) against the real `dist/ptah-landing-page/browser/**/index.html` files: the `lang`/headline greps match on every route (including `index.html`'s `<h1 ... aria-label="It ships the SaaS." ...> It ships<br>...`, where `[^>]*` correctly consumes the `aria-label` attribute before the anchor is tested against the tag's actual text content, so the attribute's copy cannot itself satisfy the anchor); `KEY_PATH` matches nothing in any route today. Confirmed `parse5` is a `devDependencies`-only pin (`package.json:73`, inside the `devDependencies` block that starts above it) and does not appear in any built browser or server chunk (`grep -rl parse5 dist/ptah-landing-page/browser/*.js` → no matches).
- Confirmed the `deploy-landing.yml` workflow triggers only on `push: branches: [release/landing]` and `workflow_dispatch` (`deploy-landing.yml:3-7`) — no `pull_request` trigger — so the acknowledged `dir="ltr"` grep failure between this commit and Batch 9 cannot fail PR CI, only a manual dispatch or an actual push to `release/landing` before the whole task branch merges.

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 2        |

### Five logic questions

1. **How does this fail silently?** Nothing does. `--update` writes no baseline file at all when any assertion fails (`check-prerender.ts:431-440`, `captured` is only flushed in the `violations.length === 0` branch), which is the correct behaviour for a capture step: a bad capture must never silently produce a bad baseline that all future compares would then treat as ground truth. A missing prerender file, a missing baseline, a malformed baseline (bad JSON, wrong shape, wrong `route` field) and every content assertion are each reported as a named, non-zero-exit violation (`check-prerender.ts:398-428`, `readBaseline` at `:271-315`) — none of them is swallowed into an exit-0 pass. The one place that _looks_ like a silent-success risk on first read is `readBaseline`'s route-mismatch check (`:308-313`): if the six baseline files were ever copied to the wrong slugs (e.g. `privacy.json`'s content saved as `refund.json`), the check still fails loudly, because it compares the baseline's own `route` field against the route the slug maps to (`PRERENDER_ROUTES`), not against the file's name — so a slug/content mismatch is caught, not silently accepted.
2. **What user action produces unexpected behaviour?** None in this batch's own surface — there is no interactive UI here. The closest analogue, a developer's local `--update` re-run, is intentionally restricted by policy ("used exactly once in this task", `check-prerender.ts:25-29`) but **not enforced in code**: nothing stops a second `--update` run from silently overwriting a baseline with drifted text once templates change in Batch 7+, which is precisely the failure mode this whole check exists to prevent. See Failure mode below.
3. **What input data produces a wrong answer?** None found for the shipped six routes — the direct compare run above shows zero text/h1 drift against the real build. The one input shape that would produce a _wrong_ (not just a "reported failure") answer is a baseline JSON edited by hand to match a drifted template instead of the template being fixed — the tool has no way to distinguish "this baseline is correct" from "this baseline was edited to make a real regression pass," which is a process/discipline control (stated in the module doc comment, `:28-29`), not a code defect.
4. **What happens when a dependency fails?** `parse5`'s `parse()` (`check-prerender.ts:186`) is not wrapped in a try/catch, unlike every other rule in the tool's `main.ts` pipeline (Batch 3 round-1 Moderate-2 explicitly made per-file parse failures degrade to a `parse-error` violation instead of crashing the whole run — `template-keys.ts`/`ts-keys.ts` follow that pattern). Here, a single malformed prerendered HTML file (a build tool regression, a truncated write, a `dist` corrupted mid-CI) throws an uncaught exception out of `checkPrerender`, caught only by `main()`'s outer `try { process.exit(main()) } catch { ...; process.exit(2) }` (`:478-485`). The process still exits non-zero (2, not 1), so CI does not pass silently, but the failure reports as `check-prerender: internal error <stack>` for the _whole run_ rather than naming which of the six routes has the malformed file, which is a real regression in diagnostic quality relative to the rest of the tool's stated design ("every violation reported...never skipped", plan:355-358, and the Batch 3 precedent). See Failure mode below.
5. **What is missing that the requirements never mentioned?** (a) A code-level guard against a second `--update` run overwriting a drifted baseline (see Q2) — the plan states the discipline in prose only. (b) Per-file parse-error isolation for `parse5.parse()`, matching the rest of the tool (see Q4). (c) The deploy workflow's `KEY_PATH`/`HEADLINE` greps are a hand-rolled, non-DOM-aware re-implementation of a subset of `check-prerender.ts`'s logic rather than a reuse of it, and unlike `check-prerender.ts` they do not skip `<script>`/`<style>` content (`extractVisibleText`'s `SKIPPED_TAGS` has no bash equivalent) — see Moderate-1.

### Failure modes

#### A second `--update` run can silently promote a real regression into the new baseline

- Trigger: after Batch 7+ starts editing templates, a developer (or an executor under time pressure) reruns `check-prerender.ts --update` to "fix" a failing compare, instead of fixing the template or the `en.json` value that caused the drift.
- Symptom: the tool accepts this without complaint — `--update` performs no check against the _previous_ baseline content, only against its own six assertions (lang, key-path, empty-heading; `dir` and drift are explicitly skipped in capture mode, `:214-217`, `:391`). A silently-broken prerendered headline (e.g. a stray leading space, a doubled word, text that moved from one paragraph to another) becomes the new ground truth, and every future compare run reports 0 violations against the now-wrong baseline.
- Evidence: `check-prerender.ts:25-29` ("`--update` ... It is run exactly once in this task ... No later unit may regenerate a baseline. A text difference is fixed in the template or the `en.json` value, never in the baseline") is a comment, not an enforced rule; `parseArgs`/`checkPrerender` place no restriction on when or how many times `--update` may run.
- Current handling: policy only, stated in the module doc comment and reiterated in `batches.md`'s Task 6.3 ("the only `--update` in this task"). Nothing in `nx.json`, the tool's own target, or the CI step blocks a second invocation.
- Recommendation: for this batch specifically, no code change is required — Task 6.3 is that one sanctioned run, and the compare-mode evidence above confirms it captured the unmodified templates correctly. Worth carrying forward (not blocking Batch 6): a lightweight guard before Batch 7 starts editing templates, e.g. `--update` refusing to run when the baseline directory already has committed content and no `--force`-style flag is passed, or a CI/self-test assertion that `apps/ptah-landing-page/prerender-baseline/*.json` never changes except in a commit whose message or PR explicitly says so. This is process risk, not a Batch 6 defect — flagged here because Batch 6 is where the "exactly once" contract is established and the enforcement gap is cheapest to close.

#### An unparseable prerendered HTML file crashes the whole run instead of reporting one route

- Trigger: `parse5.parse()` throws (it normally does not — parse5 is a permissive HTML5 parser that recovers from malformed markup rather than throwing — but a non-string/binary read, an encoding mismatch, or a future parse5 upgrade with stricter behaviour could still throw) for one of the six `dist/.../index.html` files.
- Symptom: the exception propagates out of `snapshotPage` (`:408`) and out of `checkPrerender` entirely, caught only by `main()`'s generic handler, which prints `check-prerender: internal error <full stack>` and exits 2 — the other five routes are never checked, and the report never says _which_ route or file was the problem beyond what's visible in the stack trace.
- Evidence: `check-prerender.ts:408` (`snapshotPage(fs.readFileSync(htmlAbs, 'utf8'))`, no try/catch around it), contrasted with the tool's own established pattern for exactly this situation — Batch 3 round-1 Moderate-2 required `parseTemplate`/AST parses elsewhere in this same tool to degrade to a named `parse-error` violation per file rather than crash (`report.ts`'s `ViolationKind` already includes `'parse-error'` for this reason, but `check-prerender.ts` never emits it).
- Current handling: falls through to the generic top-level `catch` in `main()` (`:479-484`); still exits non-zero, so CI does not pass, but with materially worse diagnostics than every other rule in this tool.
- Recommendation: wrap the `parse(...)`/`snapshotPage(...)` call per route in a try/catch that pushes a `parse-error` violation (file-scoped, using the existing `ViolationKind`) and continues to the next route, matching the rest of the tool. Low real-world likelihood — parse5's `parse()` has no documented throwing failure mode for well-formed UTF-8 input, which is presumably why this batch omitted the guard — but it is a real, evidenced gap against the tool's own stated and tested-elsewhere contract, so it is Moderate rather than dismissed.

### Blocking issues

None found.

### Serious issues

None found.

### Moderate and minor issues

#### Moderate-1: `deploy-landing.yml`'s `KEY_PATH` grep does not skip `<script>`/`<style>` content, unlike the tool it duplicates

- File: `.github/workflows/deploy-landing.yml:78-87` (the `KEY_PATH` regex and its `grep -Eq` check), compared with `tools/i18n-check/src/prerender/check-prerender.ts:104,129-134` (`SKIPPED_TAGS`, `isSkipped`, applied throughout `visibleTextNodes`/`extractVisibleText`/the key-path scan).
- The deploy workflow's own comment (`:56-59`) explicitly frames these greps as the same 3.5 rule that `check-prerender.ts` implements ("The full-text comparison against the committed baselines is tools/i18n-check/src/prerender/check-prerender.ts"), but the two are independent re-implementations with different rigor: `check-prerender.ts` walks the parsed DOM and skips `script`/`style`/`template`/`[data-i18n-switcher]` subtrees before testing for a key-path text node; the bash `grep -Eo "$KEY_PATH" "$DIST/$route"` runs over the raw file bytes, including the six `<script>` tags and three `application/ld+json` blocks confirmed present in the current `index.html` build. Verified empirically that today's build produces no false match (`KEY_PATH` finds nothing in any of the six routes, including inside those script/JSON-LD blocks), so this is not a live bug, but the two checks are not equivalent: a future JSON-LD manifest field, an inlined Angular transfer-state blob, or any other script content that happens to contain the byte sequence `>somescope.something<` would fail the CI grep even though `check-prerender.ts` — the tool a developer actually runs locally and that this task designates as authoritative — would correctly ignore it, because it never reaches a real rendered text node.
- Impact: low today (confirmed clean against the real build; the step only runs on `release/landing` push or manual dispatch, never PR CI). The risk is a future false-positive deploy block whose root cause (a bash grep with no DOM awareness) is not obvious from the failure message, and whose fix path (editing a workflow YAML regex) is disconnected from the tool that actually owns this rule.
- Fix: not required for this batch — 3.5 explicitly asks for both a committed script/test (`check-prerender.ts`) and an extended `deploy-landing.yml` grep as a second, independent belt-and-suspenders layer, and a raw grep is a reasonable, deliberately simpler implementation for a bash step that cannot easily invoke `parse5`. Worth a one-line comment in the workflow (next to the existing `KEY_PATH` comment) acknowledging that unlike `check-prerender.ts`, this grep is not DOM-aware and can theoretically false-positive on script/JSON-LD content, so a future investigator does not assume the two checks are equivalent.

#### Minor: per-route `HEADLINE` anchors are unescaped literal text inside an ERE

- File: `.github/workflows/deploy-landing.yml:73-80`.
- None of the six current headline anchors (`"It ships"`, `"Downloads"`, `"Ptah Is Free"`, `"Terms of Service"`, `"Privacy Policy"`, `"Refund Policy"`) contain POSIX extended-regex metacharacters (`.`, `*`, `+`, `(`, `)`, `[`, `]`, `|`, `^`, `$`), so today's `grep -Eq "<h1[^>]*>[[:space:]]*${HEADLINE[$route]}"` is correct. If a future English headline is edited to include one of those characters (e.g. a headline containing a literal period followed by a character the author did not intend to make optional), the grep would silently accept text it should reject, or reject text it should accept, without any test catching it (this whole step exists only in the deploy workflow, which is not exercised by `nx run i18n-check:self-test` or any Jest spec). Not actionable now; worth noting if a headline with punctuation is ever chosen at Gate-adjacent copy review.

### Data flow

1. `dist/ptah-landing-page/browser/<route>/index.html` (or its absence) → `checkPrerender` (`:395-408`) — OK: a missing file is reported as `missing-file` and the loop continues to the next route (verified by the spec's "reports missing prerender output" case and independently by inspecting the code path; no early return that would skip remaining routes).
2. HTML string → `parse5.parse()` → `snapshotPage()` (`:185-212`) — OK for every real input observed (six live routes, the spec's crafted HTML); gap: an actual parser throw is not isolated per file (Failure mode above).
3. Parsed document → `htmlEl`/`body` lookup, `findAll` for headings, `visibleTextNodes`/`extractVisibleText` for text (`:186-211`) — OK: `isSkipped` uniformly gates `script`/`style`/`template`/`[data-i18n-switcher]` for both the joined-text extraction and the per-node key-path scan, confirmed by the spec's dedicated "skips comments, script, style, template and `[data-i18n-switcher]`" case and independently re-derived by reading `isSkipped`/`visibleTextNodes`/`findAll`, which all route through the same `childrenOf`/skip check.
4. `PageSnapshot` → `assertPage()` (`:218-250`) — OK: `lang`, `key-path`, `empty-heading` always asserted; `dir` asserted only in compare mode, exactly matching the documented, evidenced (dist confirms no `dir` attribute today) design constraint.
5. `PageSnapshot` (compare mode) + `<baseline>/<slug>.json` → `readBaseline()` → `compareWithBaseline()` (`:271-343`) — OK: missing file, parse error, wrong shape, and wrong `route` field are each a distinct, correctly-labelled violation before any text comparison is attempted; text/h1 drift is reported with a helpful first-difference excerpt. Verified against the real build: 0 drift.
6. `PageSnapshot` (capture mode) → `captured` accumulator → written only if `violations.length === 0` for the whole run (`:412-417`, `:431-452`) — OK, and this is the correct "all or nothing" semantics for a baseline capture: a partial, inconsistent baseline set (five good routes, one route accidentally capturing broken text) is never possible, because a single route's violation blocks every route's write, not just that route's.
7. Baseline JSON on disk → git-committed `apps/ptah-landing-page/prerender-baseline/*.json` → `deploy-landing.yml`'s independent `HEADLINE`/`KEY_PATH`/`lang`/`dir` greps at deploy time — OK for headline/lang/key-path against the real build (verified above); the `KEY_PATH` grep's lack of DOM/script awareness is Moderate-1, not a correctness bug today.

### Requirements fulfilment

| Requirement                                                                                                                                                                                 | Status   | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 6.1: `parse5` devDependency pinned at `8.0.1`, nothing else changes, `.prettierignore` carry-over                                                                                      | COMPLETE | `git diff package.json`/`package-lock.json` shows only the `parse5` line and its own transitive tree (verified: `package.json`/`package-lock.json` diffs above show exactly one added line in each of the two top-level files); `.prettierignore` carry-over entry present with the required comment and a fixture that exists on disk.                                                                                                                                                 |
| Task 6.2: `check-prerender.ts`, shared normalisation, `lang`/`dir`(compare-only)/key-path/empty-heading/drift assertions                                                                    | COMPLETE | One shared `extractVisibleText` function is used for capture and every comparison, for both page text and heading text, exactly as required; `dir` correctly skipped only in capture mode. Gap (non-blocking, see Moderate/Failure modes): no per-file parse-error isolation, and `--update` has no code-level single-use guard.                                                                                                                                                        |
| Task 6.3: baselines captured from unmodified templates, deploy assertions extended                                                                                                          | COMPLETE | Directly re-verified: a compare run against the real (unmodified) `dist/ptah-landing-page/browser` build produces 0 drift/lang/key-path/empty-heading violations, only the documented `dir` gap; `git status` confirms no template file is part of this or any prior uncommitted change; deploy workflow greps replayed by hand against the real build and confirmed to pass/fail exactly as designed, with the `dir` gap correctly non-blocking for PR CI (no `pull_request` trigger). |
| Batch 6 verification: build succeeds; six baselines exist with non-empty `h1`/`text`; a compare run (without `--update`) against the same dist passes except the documented `dir` assertion | COMPLETE | Re-ran directly: `dist/` already built from the unmodified templates; all six baselines non-empty (spot-checked; `download.json` is the shortest at 542 chars of `text`, matching the page's real client-loaded-release-list content, not a truncation bug); compare run shows exactly 6 `prerender-dir` violations and nothing else.                                                                                                                                                   |
| `node_modules/.bin/nx run i18n-check:self-test` passes                                                                                                                                      | COMPLETE | Re-ran directly: both fixture stages PASS.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Implicit requirements not addressed: a code-level (not comment-only) guard against a second `--update` run overwriting a drifted baseline once template batches begin (Failure mode); per-file parse isolation for `check-prerender.ts` matching the rest of the tool (Failure mode); a note that the deploy workflow's `KEY_PATH` grep is not DOM-aware, unlike the tool it is documented as duplicating (Moderate-1).

### Edge cases

| Case                                                                                    | Handled         | How                                                                                                                                                     | Concern                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<span class="ltr-island">$29</span>/mo` wrapper added around existing text             | YES             | no-separator join, spec + live compare of the real `home` route (`$29/mo` unchanged)                                                                    | none                                                                                                                                                                                                                                                     |
| Whitespace between sibling block elements                                               | YES             | preserved as its own text node, then collapsed to one space (spec: `<p>Hello</p>\n <p>world</p>` → `Hello world`)                                       | none                                                                                                                                                                                                                                                     |
| `<br>` between two text runs with no intervening whitespace text node                   | YES (by design) | no space inserted (`It ships<br><span>the SaaS.</span>` → `It shipsthe SaaS.`), matches the plan's literal instruction and the real `home` baseline     | inherent to a text-only (not structural) diff: a future edit that moves a word across an element boundary with no new/removed whitespace could produce identical joined text for different markup — accepted, documented trade-off, not a Batch 6 defect |
| HTML entities (`&amp;`, `&rarr;`, `&#36;`)                                              | YES             | parse5 decodes on read                                                                                                                                  | none                                                                                                                                                                                                                                                     |
| Comments, `script`, `style`, `template`, `[data-i18n-switcher]` subtrees                | YES             | uniformly skipped by `isSkipped`, used by both text extraction and the key-path scan                                                                    | none                                                                                                                                                                                                                                                     |
| Empty `h1`/`h2` (including whitespace-only and icon-only)                               | YES             | `emptyHeadings` after `extractVisibleText === ''`                                                                                                       | none                                                                                                                                                                                                                                                     |
| Scope-anchored key path as an entire trimmed text node                                  | YES             | `KEY_PATH_RE` anchored on `KNOWN_SCOPES`; real copy (`ptah.live`, `core.errors` prose) does not false-positive (spec, plus 0 matches on the real build) | none                                                                                                                                                                                                                                                     |
| Baseline missing / malformed JSON / wrong shape / wrong `route` field                   | YES             | each a distinct, correctly-labelled violation (`missing-file`/`parse-error`/`invalid-value`×2)                                                          | none                                                                                                                                                                                                                                                     |
| Baseline compared as parsed JSON, not bytes (pre-commit `nx format:write` reformatting) | YES             | `JSON.parse` on both sides; spec re-serializes without Prettier formatting and still passes                                                             | none                                                                                                                                                                                                                                                     |
| `dir` attribute absent (pre-i18n build)                                                 | YES             | asserted only in compare mode, per design; confirmed against the real build (6 `prerender-dir`, nothing else)                                           | none — but this is the one currently-known, currently-accepted gap, and it is real (not hypothetical) in the working tree today                                                                                                                          |
| `--update` run twice, second time against drifted templates                             | NO              | no code guard; policy-only ("exactly once in this task")                                                                                                | Failure mode above; not a Batch 6 regression, but the enforcement gap is established here                                                                                                                                                                |
| `parse5.parse()` throws                                                                 | NO              | falls through to `main()`'s generic catch, exits 2 with a stack trace, not a per-route `parse-error`                                                    | Failure mode above; low likelihood, inconsistent with the rest of the tool                                                                                                                                                                               |
| Deploy grep vs script/JSON-LD content                                                   | PARTIAL         | raw grep, no DOM skip; clean against the real build today                                                                                               | Moderate-1                                                                                                                                                                                                                                               |

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH — every assertion above was checked against the actual `dist/ptah-landing-page/browser` build and the actual git diff, not inferred from the source alone; the compare-mode run, the self-test, the Jest suite and a hand-replay of the new deploy-workflow grep lines were all executed directly in this review.
- Top risk: none blocking. The two Moderate/Failure-mode items (no per-file parse isolation; no enforced single-use `--update` guard) are both cheap to close later and neither affects the correctness of what Batch 6 actually ships — the six committed baselines are verified byte-for-text correct against the real unmodified build, and the compare run's only violation is the one the team-leader already documented and scoped out.
- What a robust implementation would add: (1) wrap `snapshotPage`'s `parse5.parse()` call per route in a try/catch that emits a `parse-error` violation and continues, matching the rest of the tool's established contract; (2) a code-level (not comment-only) guard against `--update` silently overwriting a baseline once the "exactly once" window has passed — for example, refusing to run when `git status` shows the baseline directory as already clean/committed, or moving the enforcement into a CI check that the baseline files change only in a commit explicitly labelled to allow it; (3) a one-line comment in `deploy-landing.yml` acknowledging the `KEY_PATH` grep's lack of DOM/script awareness relative to `check-prerender.ts`, so a future investigator does not assume the two are equivalent.

## Batch 9

Scope: Batch 9 only (Tasks 9.1-9.5, uncommitted — `git status`/`git diff --stat` confirms the touched
files match the batch's file lists exactly, plus the Batch 6 carry-over to `deploy-landing.yml`). Files
read in full: `apps/ptah-landing-page/src/{index.html, main.ts, styles.css}`,
`apps/ptah-landing-page/src/app/{app.config.ts, app.routes.ts, app.routes.spec.ts}`,
`apps/ptah-landing-page/src/app/i18n/{landing-i18n.constants.ts, arabic-font.loader.ts,
arabic-font.loader.spec.ts, app-stable-marker.ts, app-stable-marker.spec.ts, pre-paint-script.spec.ts,
app.i18n-scope.ts, app.i18n-scope.spec.ts}`, `apps/ptah-landing-page/{tailwind.config.js, project.json}`,
`.github/workflows/deploy-landing.yml`, `tools/i18n-check/src/prerender/check-prerender.ts` (+ spec),
`libs/web/ui/src/lib/countdown-timer.component.ts`,
`apps/ptah-landing-page/prerender-baseline/{home.json, pricing.json, README.md}`. Cross-read for the
hydration/SSG contract: `libs/frontend/i18n/src/lib/{resolve-initial-lang.ts, i18n-scopes.resolver.ts,
provide-i18n.ts, i18n.service.ts, lang.config.ts}` and its `CLAUDE.md`, plus
`tools/i18n-check/src/lib/scope-map.ts` (`KNOWN_SCOPES`, `SCOPE_MAP`). `privacy.json`, `refund.json`,
`terms-and-conditions.json` and `download.json` were diffed against `HEAD` and confirmed byte-identical
(untouched, as Task 9.5 requires).

Verification run (all executed directly in this review, not inferred):

- `node_modules/.bin/nx run-many -t test -p ptah-landing-page --skip-nx-cache` → green (all suites pass).
- `node_modules/.bin/nx run i18n-check:test --skip-nx-cache` → green, 16 suites / 239 tests.
- `node_modules/.bin/nx build ptah-landing-page --stats-json` → succeeds, "Prerendered 6 static routes."
  (budget warnings only, pre-existing and unrelated to i18n).
- `node_modules/.bin/nx run ptah-landing-page:prerender-check` → `check-prerender: 6 routes match their
baselines` (exit 0), against the **unchanged** baselines (A3 re-confirmed: zero key-path, drift or
  `dir` violations).
- A1 (browser half): inspected the real build output. `libs/{ui,panel-ui,core,landing,legal,pricing,auth,
account,members,admin}/src/lib/i18n/{en,ar}.json` plus `apps/ptah-landing-page/src/app/i18n/{en,ar}.json`
  are 11 scope pairs (22 files, all still `{}` at this point in the rollout — confirmed by
  `find ... -path "*/i18n/en.json" -o -path "*/i18n/ar.json" | wc -l` = 22). `dist/ptah-landing-page/browser`
  contains exactly 22 `chunk-*.js` files of 30 bytes each, content `var c={};export{c as default};`, and
  `grep -rlF 'en.json' dist/ptah-landing-page/browser/*.js` finds nothing in `main-*.js` — the 22 dynamic
  `import('./en.json')`/`import('./ar.json')` calls are each their own lazy chunk, not inlined into the
  initial bundle. This is exactly the structural claim A1 needs at this stage (content-based
  re-confirmation is explicitly deferred to Batch 15, plan:107-108, once `landing`'s JSON is filled).
- Node one-off script comparing `home.json`/`pricing.json` against `git show HEAD:...` with the exact
  formula the README states (`collapseWhitespace(old.text.replace(/\d{2}Days:\d{2}Hrs:\d{2}Min:\d{2}Sec/,
''))`) → both `true`. `git diff` on the two baselines shows only the `text` field changed, `route`/`h1`
  untouched, confirming Task 9.5's quality requirement (4) exactly.

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 2        |

### Five logic questions

1. **How does this fail silently?** `i18nScopesResolver` (`libs/frontend/i18n/src/lib/i18n-scopes.resolver.ts:38-47`,
   reached for the first time by real navigation in this batch, via the resolver table in
   `app.routes.ts:32-37,43,69-71,79,86,94-97,135-138,173-176`) swallows every ordinary scope-load failure
   — a failed chunk `import()`, a rejected translation loader — and resolves navigation `true` regardless,
   logging only to `console.error`. A visitor whose scope failed to load sees the page render with English
   fallback text (via `I18nMissingHandler`, reviewed in Batch 2) and no visible error. This is a deliberate,
   already-reviewed trade-off (never block navigation on a translation failure), not new to this batch, but
   Batch 9 is where it starts affecting real users, so it is restated here as the honest answer to Q1. A
   second, narrower path: `I18nService.init()` (`i18n.service.ts:80-96`), invoked from `provideI18n`'s
   `provideAppInitializer` in `app.config.ts:46-49`, degrades a startup load failure to English and resolves
   the initializer promise regardless — bootstrap never sees the failure, only the console does.
2. **What user action produces unexpected behaviour?** A first-time visitor whose browser reports an
   `ar`-prefixed language (including a false positive such as `arn`/`ars`, `resolve-initial-lang.ts:19-22`)
   gets `dir="rtl"` and the Arabic webfont requested before first paint (`index.html:9-25`), purely from
   `navigator.languages`, with no stored preference and no user-visible language control yet (the switcher
   ships in Batch 11). Because every scope's `en.json`/`ar.json` is still `{}` at this point in the rollout,
   that visitor sees an RTL-laid-out page with empty/fallback text until later batches fill content — not a
   defect in this batch's own logic (the detection and font-loading code is correct and covered by the
   35-case matrix in `pre-paint-script.spec.ts`), but a real, currently-live mid-rollout user experience
   worth naming for QA/staging awareness, since this batch is the first to wire real navigation and DOM
   effects to that detection.
3. **What input data produces a wrong answer?** None found for the code in this batch. The pre-paint script
   (`index.html:9-25`) and `resolveInitialLang` (`resolve-initial-lang.ts:24-31`) were checked case by case:
   both use the identical case-sensitive exact match for a stored value (`['en','ar'].indexOf(s)` vs
   `isSupportedLang`, `lang.config.ts:16-20`) and the identical case-insensitive prefix test for a browser
   language (`/^ar/i` vs `.toLowerCase().startsWith('ar')`) — confirmed by running the actual inline script
   from the real `index.html` against all 5×7 = 35 stored×language combinations in `pre-paint-script.spec.ts`
   and asserting equality with `resolveInitialLang` and `LANG_DIRECTION` on every case (test run above,
   green). `[lang='ar']` in `styles.css:81-101` matches correctly because `I18nService.apply()`
   (`i18n.service.ts:244-250`) sets `root.lang`/`root.dir` as reflected IDL properties, which sync the
   content attribute the CSS attribute selector reads.
4. **What happens when a dependency fails?** Traced end to end: a rejected scope `import()` during route
   navigation is caught by `i18nScopesResolver`'s `catchError` (see Q1) and never reaches the router or the
   component tree as an error — this is the documented, already-reviewed contract, re-verified here as
   correctly wired into real routes for the first time. `markAppStable` (`app-stable-marker.ts:16-22`,
   called from `main.ts:6-8`) has no timeout fallback by design: if `ApplicationRef.whenStable()` never
   resolves (A4, GSAP/Lenis rAF loops keeping the zone unstable — a known risk this task already tracks with
   its own contingent remediation task), `data-app-stable` never appears and the e2e wait fails visibly
   rather than passing on a fabricated signal — confirmed with a fake-timer test that advances 60s past a
   never-resolving `whenStable()` and asserts the attribute is still absent
   (`app-stable-marker.spec.ts:42-57`). `provideArabicFontLoader` (`arabic-font.loader.ts:26-37`) does
   nothing if the font request itself fails (network down, CSP block) — the `<link>` is appended
   unconditionally and its failure is invisible by design (`font-family` fallback in `tailwind.config.js:74-81`
   absorbs it), matching plan:445 ("If the font request fails, the stack falls through to Noto Sans Arabic or
   the system font").
5. **What is missing that the requirements never mentioned?** (a) Task 9.4's quality requirement calls for
   build-stats evidence of lazy-chunked scope JSON "for the browser and server builds" (plan:107,
   `implementation-plan.md:107-108`), but `project.json:16` sets `outputMode: "static"`, so
   `nx build ptah-landing-page` writes only `dist/ptah-landing-page/browser` plus the prerendered HTML — no
   `dist/ptah-landing-page/server` directory is persisted to inspect. The browser half is fully proven (see
   verification run above); the server half can only be inferred indirectly, from `prerender-check` passing
   with correct English text and zero key-path leaks, which shows the server-side scope loader did not
   inline garbage or a raw key path into the HTML, but does not by itself show the server bundle's `en.json`
   was chunked rather than bundled inline (a bundled-but-still-correct outcome is possible and would look
   identical from the HTML alone). See Moderate-1. (b) The plan's own Assumption A5 (structural `@if`
   differences between the English prerender and an Arabic client render — the switcher's check icons and
   the legal governing-language notice) is explicitly out of scope for this batch (Task 33.3) and this batch
   introduces no structural language branching itself (`i18nScopesResolver`, `provideArabicFontLoader` and
   `markAppStable` are all additive DOM/attribute effects, never conditional element structure), so the
   NG05xx hydration-mismatch risk named in this review's brief does not yet have a code path to trigger in
   Batch 9's own files — traced and confirmed rather than assumed (see Failure modes, "Hydration mismatch
   risk (traced, not found)").

### Failure modes

#### Silent scope-load failure on route navigation (accepted, re-confirmed in real wiring)

- Trigger: a route's scope chunk fails to load (network failure, CDN error, a bad deploy) once real users hit
  the resolver table in `app.routes.ts` for the first time in this batch.
- Symptom: the route still navigates; the page renders with English-fallback or empty text for that scope
  (via `I18nMissingHandler`, Batch 2), no user-visible error.
- Evidence: `libs/frontend/i18n/src/lib/i18n-scopes.resolver.ts:38-47`; wired to real navigation via
  `apps/ptah-landing-page/src/app/app.routes.ts:43,69-71,79,86,94-97,135-138,173-176`.
- Current handling: `console.error` only, tagged `[i18n:wiring]` for a genuine wiring mistake
  (`I18nError`) versus untagged for an ordinary load failure — a deliberate, already-reviewed design
  (Batch 2), not a regression.
- Recommendation: unchanged from Batch 2's acceptance; no new action needed in this batch. Worth surfacing
  to product/observability once the app ships real scope content, since a CDN blip would otherwise be
  invisible outside server logs.

#### A1 server-build evidence gap under `outputMode: "static"`

- Trigger: none at runtime — this is a verification-evidence gap, not a functional defect. Running
  `nx build ptah-landing-page --stats-json` (as Task 9.4 instructs) under the app's own
  `outputMode: "static"` configuration.
- Symptom: no `dist/ptah-landing-page/server` directory or server-side stats artifact is written to inspect,
  so the "server builds" half of Task 9.4's quality requirement (plan:107, "esbuild pipeline bundles
  `import('./en.json')`... into a lazy chunk for both the browser and server builds") cannot be directly
  verified the way the browser half was (22 separate 30-byte chunks, confirmed above).
- Evidence: `apps/ptah-landing-page/project.json:16` (`"outputMode": "static"`); confirmed empirically —
  `find dist/ptah-landing-page -maxdepth 1 -type d` lists only `browser` after a full build.
- Current handling: none; the batch's own verification note (batches.md, "Batch 9 verification", round 1)
  does not call this out, and Task 9.4 is left `IN_PROGRESS` for a different reason (the countdown drift,
  now fixed by Task 9.5) rather than this one.
- Recommendation: either accept indirect proof (the successful English `prerender-check` run already shows
  the server-side render is correct, which is the outcome that actually matters) and say so explicitly in
  the Task 9.4 evidence note, or, if literal stats-based proof of server-side chunking is wanted, inspect the
  build's intermediate/server bundle before the static-mode build step discards it (e.g., a scratch build
  with `outputMode` temporarily unset), documented as a one-off check rather than a repeatable target. Not
  blocking: A1's content-based re-confirmation is already explicitly deferred to Batch 15 (plan:107-108),
  and nothing in this batch depends on the server-side chunking claim being true (the server always renders
  English from the empty root translation plus `{}` scopes today, so a bundled-vs-chunked `{}` would behave
  identically either way).

#### Hydration mismatch risk (traced, not found)

- Trigger (hypothetical, checked against this batch's actual code): an Arabic-detecting visitor's language
  being applied before Angular's root component tree is created and hydration begins, so the first hydration
  pass would expect Arabic text against a server-rendered English DOM.
- Symptom (if it existed): Angular hydration errors (NG05xx) or discarded server DOM on first paint.
- Evidence traced: `I18nService.apply()` (`i18n.service.ts:244-250`) is called from `init()`
  (`i18n.service.ts:80-96`), itself invoked by `provideAppInitializer` (`provide-i18n.ts:53`), which **does**
  run and resolve before Angular creates/hydrates the root component tree — so if `init()` detected `ar` for
  a browser-language visitor and no stored preference, `I18nService.lang()` would already read `ar` by the
  time hydration's first change-detection pass runs. Two things in this batch's own files keep this from
  being a live defect today: (1) `apply()` only ever touches `document.documentElement` directly
  (`root.lang`/`root.dir`), which sits **outside** Angular's view tree — hydration never tries to match
  `<html>`'s attributes against server output, so no mismatch is possible there; (2) the plan's hydration
  contract (implementation-plan.md:461-482, rule 2) forbids structural (`@if`/`@for`-shape) branching on
  language in every component this batch touches or wires — `arabic-font.loader.ts`, `app-stable-marker.ts`
  and the resolver are all additive effects with no template, and the countdown component's
  `data-prerender-volatile` host (`countdown-timer.component.ts:25`) is unrelated to language. A **text
  content** mismatch (an interpolated `| transloco` binding reading Arabic while the server DOM holds
  English) is not itself an NG05xx hydration error — Angular's normal change-detection update simply
  rewrites the DOM node's text on the first CD pass, which is standard reactive behaviour, not a hydration
  fault. The genuine structural-branch risk (the language switcher's check icons, the legal
  governing-language notice) is explicitly named by the plan as Assumption A5 and deferred to Task 33.3; none
  of that template code exists yet in the tree.
- Current handling: n/a — no defect found; documented here per this review's brief so the reasoning is
  auditable rather than asserted.
- Recommendation: none for this batch. When Task 33.3 lands, re-run this trace against the switcher and
  legal-notice templates specifically, since those are the only place the reasoning above changes.

### Blocking issues

None found.

### Serious issues

None found.

### Moderate and minor issues

- Moderate-1: A1's "server builds" evidence is not directly producible under `outputMode: "static"` (see
  Failure modes above). `apps/ptah-landing-page/project.json:16`; `implementation-plan.md:107-108`.
- Minor: `app.routes.ts:100-129`'s extensive inline JSDoc for the `/members` route (pre-existing, untouched
  by this batch except for the added `resolve` block at `:134-138`) is unrelated to this batch's own change
  and was left as-is, correctly — noted only because it made locating the batch's actual diff inside that
  route object slower during review; no action needed.

### Data flow

1. Server request for a prerendered route → `I18nService.detectLang()` short-circuits to `DEFAULT_LANG`
   (`i18n.service.ts:140-146`, `!this.isBrowser`) → `init()` loads English scopes only → `apply('en')` sets
   `<html lang dir>` server-side (matches the static `index.html:2` default). **OK.**
2. Browser first paint, before any script executes → static `<html lang="en" dir="ltr">` from `index.html:2`
   is what a no-JS visitor keeps permanently (3.5). **OK**, confirmed by `pre-paint-script.spec.ts`'s
   "leaves static English attributes" test.
3. Browser first paint, `#ptah-i18n-prepaint` runs synchronously (`index.html:9-25`) → reads storage
   (try/catch) → falls back to `navigator.languages` prefix test → sets `<html lang/dir>` and, for `ar`,
   appends the font `<link>` — all before Angular's bundle has even started loading. **OK**, matches
   `resolveInitialLang` exactly per the 35-case spec matrix.
4. Angular bootstrap: `AuthInitializerService.initialize()` and `I18nService.init()` run as app initializers
   (`app.config.ts:36-49`) → `init()` re-runs the _same_ detection (`resolveInitialLang`, browser-side this
   time) against the _same_ storage/`navigator.languages` inputs the pre-paint script just read → loads the
   global scopes (`APP_I18N_SCOPE`, `UI_I18N_SCOPE`, `CORE_I18N_SCOPE`) for that language plus English →
   `apply(lang)` re-sets `<html lang/dir>` (idempotent re-application of the same values the pre-paint script
   already set, in the ordinary case) and `provideArabicFontLoader`'s root `effect` additionally ensures the
   font link exists (`arabic-font.loader.ts:32-34`) — a no-op when the pre-paint script already added it
   (`ensureArabicFontLink`'s `getElementById` guard, `:40`). **OK.**
5. Bootstrap resolves → root component created → hydration reconciles against the server-rendered (always
   English) DOM inside `<app-root>` → `bootstrapApplication(...).then((appRef) => markAppStable(appRef,
document))` (`main.ts:6-8`) awaits `appRef.whenStable()` before marking `data-app-stable="true"`. **OK**,
   with the caveat traced in "Hydration mismatch risk" above (no defect found, but the reasoning is
   load-bearing on the "no structural language branching yet" fact, which will change in Task 33.3).
6. Per-route navigation → `i18nScopesResolver` registers and loads that route's scope(s) for the active
   language and English before the router completes navigation (`i18n-scopes.resolver.ts:31-49`,
   `i18n.service.ts:121-126`) → `SeoService` (a later batch) will read the English values after the
   resolver, per plan:442. **OK** for this batch's own scope (resolver wiring); `SeoService`'s consumption is
   out of scope (Batch 10).
7. `nx build` → prerender → `check-prerender` walks the six routes' parsed DOM, skipping
   `[data-prerender-volatile]` (the countdown) uniformly across text, heading and key-path extraction →
   compares against the two edited baselines (`home.json`, `pricing.json`, countdown segment removed per the
   documented formula) and the four untouched ones. **OK**, re-run directly in this review, exit 0.

### Requirements fulfilment

| Requirement                                                                                | Status   | Gap                                                                                                                   |
| ------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| Resolver table exactly as plan:409-418, members/admin via dynamic `import()`               | COMPLETE | none — verified against every route in `app.routes.ts`                                                                |
| `.ltr-island` without `display` (plan:33-35)                                               | COMPLETE | none — `styles.css:71-75`                                                                                             |
| Remove `extract-i18n`; add `prerender-check` (`dependsOn: ["build"]`); no `i18n-check` yet | COMPLETE | none — `project.json`                                                                                                 |
| `app.routes.spec.ts` must not import `app.routes`                                          | COMPLETE | none — uses `readFileSync`/source-slicing throughout                                                                  |
| Pre-paint script: literals, position, size, sync with `resolveInitialLang`                 | COMPLETE | none — 35-case matrix passes                                                                                          |
| Arabic font loader: browser-only, idempotent, no request for `en`                          | COMPLETE | none — spec covers server no-op, single append, existing-link reuse                                                   |
| `markAppStable`: honest, no timeout fallback                                               | COMPLETE | none — fake-timer test proves no fallback                                                                             |
| Task 9.5: shared `isSkipped`, `data-prerender-volatile` on both countdown branches, specs  | COMPLETE | none — host metadata covers both `@if`/`@else` branches; specs cover text-join and key-path-in-volatile-subtree cases |
| Task 9.5: baselines edited by the stated formula only, other four untouched                | COMPLETE | none — reproduced the formula programmatically against `git show HEAD:...`, both `true`                               |
| Task 9.5: README documents the one-time edit                                               | COMPLETE | none                                                                                                                  |
| Task 9.4: build + prerender-check pass against unchanged baselines                         | COMPLETE | none — re-run in this review                                                                                          |
| Task 9.4: A1 evidence for browser **and** server builds                                    | PARTIAL  | server-side evidence not directly producible under `outputMode: "static"` (Moderate-1)                                |
| Batch 6 carry-over: `deploy-landing.yml` comment + `HEADLINE` escaping                     | COMPLETE | none — both present exactly as specified                                                                              |

Implicit requirements not addressed: none found beyond Moderate-1.

### Edge cases

| Case                                                                 | Handled | How                                                                                            | Concern                                               |
| -------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Stored language invalid/absent, browser language absent/multi-valued | YES     | 35-case matrix (5 stored × 7 language shapes) in `pre-paint-script.spec.ts`                    | none                                                  |
| Storage throws (private mode)                                        | YES     | try/catch in both the script and `LangPreferenceStore`; both fall through to detection         | none                                                  |
| JS disabled                                                          | YES     | static English `lang`/`dir` on `<html>` persists forever                                       | none                                                  |
| Font link already present (pre-paint added it)                       | YES     | `getElementById` guard in both the script and `ensureArabicFontLink`                           | none                                                  |
| Repeated language switches (font link)                               | YES     | idempotent append, spec covers `ar→en→ar`                                                      | none                                                  |
| App never becomes stable                                             | YES     | no timeout fallback; attribute never appears, proven with fake timers                          | none (by design — visible failure, not a silent pass) |
| Countdown ticking vs expired branch, both prerendered/baselined      | YES     | `data-prerender-volatile` host attribute covers both `@if`/`@else` branches uniformly          | none                                                  |
| Key path rendered inside the volatile countdown subtree              | YES     | not reported (documented choice: the host only ever renders digits and fixed labels)           | none — explicit, reasoned, and specced                |
| Second `--update` capture drifting a baseline                        | NO      | policy-only, pre-existing gap from Batch 6, not touched by this batch                          | pre-existing, not a Batch 9 regression                |
| Scope chunk-load failure on a real route navigation                  | YES     | resolver never blocks navigation; falls back to English/empty via `I18nMissingHandler`         | accepted design; no visible error to the user (Q1)    |
| A1 server-build chunking evidence                                    | PARTIAL | browser build empirically confirmed (22×30-byte chunks); server build not directly inspectable | Moderate-1                                            |

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH — every load-bearing claim was checked against the real build output, the real test run,
  or a direct trace through the actual source (not inferred from documentation alone): `nx build` +
  `prerender-check` were re-run against the unchanged baselines, the 22 lazy i18n-scope chunks were counted
  and their content inspected, the baseline-edit formula was reproduced programmatically against `git show
HEAD:...`, and the SSG/hydration contract (the review's own stated top concern) was traced through
  `provideAppInitializer` → `I18nService.apply()` → `document.documentElement` to confirm hydration never
  touches `<html>` attributes, with the one live structural-branching risk (A5) confirmed absent from this
  batch's own files and correctly deferred by the plan to Task 33.3.
- Top risk: none blocking or serious. The one real gap (Moderate-1) is a verification-evidence shortfall
  under `outputMode: "static"`, not a functional defect — the behaviour it would have proven (server-side
  scope JSON is lazy-chunked, not bundled) is not depended on by anything else in this batch, since every
  scope is still `{}` and the server always renders English regardless.
- What a robust implementation would add: (1) a documented decision on Task 9.4's A1 evidence note about
  what "for the browser and server builds" means under `outputMode: "static"` (accept the indirect proof, or
  perform a one-off scratch build with server output retained); (2) when Task 33.3 lands the switcher and the
  legal governing-language notice, re-run the hydration-mismatch trace above specifically against those two
  structural branches, since they are the only place this batch's "no structural language branching yet"
  reasoning stops applying.

## Batch 10

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 3        |

### Scope examined

Read in full: `libs/web/core/src/lib/services/seo.service.ts` (+ new `seo.service.spec.ts`),
`paddle-checkout.service.ts`, `github-release.service.ts` (+ new `github-release.service.spec.ts`),
`subscription-state.service.ts`, `sse-events.service.ts`, `libs/web/core/src/lib/i18n/{en,ar}.json`,
`libs/web/core/project.json` (new `i18n-check` target); all 6 `setPage` callers
(`landing-page.component.ts`, `pricing-page.component.ts`, `terms/privacy/refund-page.component.ts`,
`download-page.component.ts`) and the `en`/`ar` scope files of `app`, `landing`, `legal`, `pricing`;
`pricing-grid.component.ts` (the one other consumer of the new `I18nMessage`-shaped signals);
`apps/ptah-landing-page/src/app/app.routes.ts` and `app.config.ts` (resolver/global-scope ordering);
`copy-review/core.md`. Traced but not re-read line by line: `sessions-grid.component.ts`,
`profile-page.component.ts`, `navigation.component.ts` (checked only for stray reads of the changed
signals).

Verification run and evidence: `nx run-many -t test -p web-core web-pricing ptah-landing-page
--skip-nx-cache` (3/3 green); `nx run web-core:i18n-check` → `i18n-check [core]: OK`; `review-tables
--check` for `core` → `OK`, no drift; `nx run-many -t lint,typecheck -p web-core web-landing web-pricing
web-legal ptah-landing-page --skip-nx-cache` (all green); `nx run degradation-audit:lint` →
`libs/web/core: 3 ok (baseline 3)` (0 new unsuppressed sites); the typed SonarJS bug-rule eslint check
against every changed `.ts` file in this batch (0 problems); `nx run ptah-landing-page:prerender-check`
→ `check-prerender: 6 routes match their baselines` (a real production build, not a cached one). I also
grepped the built `dist/ptah-landing-page/browser/{index,pricing,download}/index.html` directly and
confirmed `<title>`, `description`, all 5 `og:*` and 3 `twitter:*` tags are present, English, and byte-for-
byte the same strings that were removed as literals from the corresponding `.component.ts` files.

### Five logic questions

#### 1. How does this fail silently?

- `SeoService.applyLocalized`/`english` (`seo.service.ts:89-101`) call `I18nService.translate`, whose prod
  behaviour (Batch 2, `I18nMissingHandler`) is to return `''` for a key missing from the active language,
  never the key and never a thrown error. If a caller's key doesn't exist yet (typo, or a scope not
  actually loaded when `setPage` runs), the page silently gets a blank `<title>` and empty meta description
  — no console error, no visible break in the component tree. This batch's own keys all exist and are all
  scope-resolved before use (see Q3), so it is not triggered here, but the service itself has no guard
  against it (by design, per the missing-handler contract) — worth a one-line note if a future caller adds
  a key without also adding the review-table/i18n-check step, since `i18n-check`'s key-reference rule is the
  only thing standing between a typo and a silent blank tag.
- `checkoutBlockedMessage` (`paddle-checkout.service.ts:538-556`) turns _any_ truthy `response.message`
  into `core.common.serverMessage` with the raw backend text as `params.text`, without checking that the
  backend actually sent a non-empty, non-whitespace string. An API that starts returning
  `message: " "` (space) instead of omitting the field would silently show a single blank space to the
  user in the "blocked" banner instead of falling through to the `existingPlan`/generic branches, which are
  the more informative fallbacks. Narrow, low-likelihood (requires a backend regression), not exercised by
  any spec (see Failure modes).
- `SSEEventsService.getTicket` (`sse-events.service.ts:276-291`) now returns `null` on _any_ HTTP failure
  from `POST /auth/stream/ticket` — not only 401. A 500, a network drop, or a CORS failure all collapse
  into the same `core.realtime.authRequired` ("Authentication required. Please log in first.") message in
  `connect()` (`sse-events.service.ts:213-218`). A logged-in user whose ticket request merely timed out is
  told to log in again — misleading, though not a data-loss or success-looking failure (the UI does show an
  error state, `connectionState = 'error'`, just the wrong one).

#### 2. What user action produces unexpected behaviour?

- Switching language while a page's `SeoConfig` has not yet been set (i.e. before any `setPage` call has
  run once, app-wide) does nothing — verified by the spec `'touches nothing on a language switch before
any page is set'` (`seo.service.spec.ts:160-169`) and confirmed correct: `SeoService` is `providedIn:
'root'` and is only ever injected from inside a page component's constructor immediately before that
  same constructor calls `setPage` (`grep` confirms no other injection site), so in the running app this
  branch is only reachable for the instant between the service's own construction and the `setPage` call
  in the same synchronous constructor — never observable by a user.
- Switching language exactly while `document.title` no callback observes: intentional and correct —
  `og:*`/`twitter:*`/canonical are never re-applied on a language switch (`seo.service.ts:55-59` only
  re-triggers `applyLocalized`, not the og/twitter block in `setPage`), matching the stated contract
  ("og/twitter always English... title/description follow active lang").
- Retrying a blocked Paddle checkout after the backend's `existingPlan` value is empty/undefined string
  falls through correctly to `core.checkout.activeSubscriptionExists` (verified by reading the `if
(response.existingPlan)` branch) — the empty-string edge case is handled the same way `response.message`
  is (see Q1), by the same truthy check, so behaviour here is unchanged from before this batch.

#### 3. What input data produces a wrong answer?

- Ordering dependency: `SeoService.applyLocalized`/`english` will resolve to `''` if the calling page's
  scope isn't loaded before `setPage` runs. I traced this for every one of the 6 callers:
  - `landing.seo.*`, `pricing.seo.*`, `legal.seo.*` are behind their route's `resolve: { i18n:
i18nScopesResolver(...) }` in `app.routes.ts:43,68-72,154-166`, which Angular's router guarantees
    completes before the route activates (and thus before the page component — and its constructor —
    exists). Correct.
  - `app.seo.download.*` has **no** resolver (`app.routes.ts:57-63`, comment at :24-30 explains why); it
    relies on `app` being a `globalScope` in `provideI18n` (`app.config.ts:46-49`), whose loader is awaited
    by `provideAppInitializer(() => inject(I18nService).init())` (Batch 2), which Angular's bootstrap
    process must finish before the router performs its first navigation. Confirmed correct by tracing the
    initializer chain and by the passing `prerender-check` (the download route's title/og tags render with
    real English text in the built HTML, not blank strings — see Verification).
  - `core.*` keys used by `pricing-grid.component.ts` and `download-page.component.ts` (`msg.key |
transloco: msg.params`) are likewise covered by `core` being a `globalScope`.
  - No caller's key resolves to `''` in the build output I inspected.
- `checkoutBlockedMessage`'s params for `core.checkout.activePlanExists` interpolate
  `response.existingPlan` verbatim as `{{ plan }}` with no allow-list/enum check against the plan names the
  backend is contractually expected to send. A backend change to plan naming shows up untranslated (English
  plan name inside an otherwise-localized Arabic sentence) — acceptable per the "server text isn't
  localised" contract stated in the code comment (`paddle-checkout.service.ts:539-542`), not a defect.
- `core.checkout.config.tokenMismatch`'s params (`environment`, `prefix`) are literal `'sandbox'|
'production'` / `'test_'|'live_'` strings from the client's own config, not user or server input — no
  injection surface, and Angular's `{{ }}` interpolation in the consuming templates is text-only (no
  `innerHTML`), so `core.common.serverMessage`'s raw `response.message` passthrough cannot inject markup
  even though it is unsanitised/unvalidated text.

#### 4. What happens when a dependency fails?

- Paddle SDK load failure, checkout-not-ready, checkout timeout, and Paddle config validation failures all
  now route through `I18nMessage` keys instead of hardcoded strings — traced each of the 7 `_error.set(...)`
  / `_validationError.set(...)` call sites in `paddle-checkout.service.ts` against `core.checkout.*` in both
  `en.json`/`ar.json`; all 7 keys exist in both languages (confirmed independently by `i18n-check`'s key-
  reference rule passing).
- GitHub API failure: `github-release.service.ts:59-68` still branches on `err.status === 403` for
  rate-limiting vs. a generic failure, now mapped to `core.releases.rateLimited` /
  `core.releases.loadFailed`. Correct, key parity confirmed.
- SSE ticket-fetch failure: previously threw a plain `Error` that `connect()`'s `catch` turned into a fixed
  English string; now `getTicket` returns `null` and `connect()` explicitly checks for it
  (`sse-events.service.ts:213-218`) before ever reaching the `try`'s `catch`. I grepped the whole repo for
  other callers of the (private) `getTicket` — none exist outside `connect()` — so there is no caller still
  relying on the old throw-based contract. The `// degradation-audit: reported` marker on the swallowed
  `catch` (`sse-events.service.ts:286-288`) is present and the degradation-audit baseline for `libs/web/
core` is unchanged (3 ok / baseline 3), so this was correctly accounted for rather than silently raising
  the baseline.
- `SubscriptionStateService`'s HTTP failure path (`subscription-state.service.ts:176-181`) sets
  `core.subscription.loadFailed` and unconditionally clears loading/marks fetched — unchanged control flow
  from before this batch, only the error payload's shape changed.

#### 5. What is missing that the requirements never mentioned?

- No spec file exists for `paddle-checkout.service.ts` or `sse-events.service.ts` at all (not before this
  batch, not added by it) — see Failure modes / Moderate-1. Batch 10's task list only names
  `seo.service.spec.ts` and (pre-existing) `github-release.service.spec.ts` as files to touch, so this is
  not a violation of the batch's own scope, but it means the two most consequential new logic changes in
  this batch — `checkoutBlockedMessage`'s 3-way precedence and the SSE null-ticket path — ship with zero
  automated verification of their own; only the passing `nx test` (of everything _else_ in `web-core`) and
  my manual trace stand behind them.
- The plan's Preserve list requires "`og:*`/`twitter:*`/canonical tags in English" to survive — verified
  directly against the built HTML (see Verification), not only inferred from the spec.
- Nothing in this batch touches `SubscriptionStateService.error`'s only consumer count: I confirmed by grep
  that no component currently reads `subscriptionService.error()` at all (it's set but never displayed
  anywhere in the codebase). Not a batch defect — pre-existing dead state — but worth naming since it means
  the `I18nMessage` conversion on that one signal is currently unobservable to any test or user.

### Failure modes

#### Silent blank SEO tag from an unresolved key

- Trigger: a future page component calls `SeoService.setPage` with a `titleKey`/`descriptionKey` whose
  owning scope has not been loaded (resolver missing, or scope typo).
- Symptom: `<title>` and meta description silently render as `''` — no console error, no failed request,
  no test failure unless a spec explicitly asserts non-empty text.
- Evidence: `seo.service.ts:90-94` (`this.i18n.translate(config.titleKey)`, no fallback/assertion);
  `I18nMissingHandler`'s prod contract (Batch 2) returns `''` for a key missing in every loaded language.
- Current handling: none inside `SeoService` itself; the only backstop is `i18n-check`'s key-reference rule
  at build time, which this batch's own keys pass.
- Recommendation: none required for this batch (all 6 callers verified correctly ordered against their
  resolvers/global scopes), but worth a one-line `SeoService` doc comment (it already documents the
  `--allow-scope` deviation) noting that `setPage` assumes the caller's scope is already loaded, since nothing
  enforces that at the type level.

#### Untested checkout-blocked precedence and SSE ticket-null path

- Trigger: any of `response.message` truthy / `response.existingPlan` truthy / neither, going through
  `checkoutBlockedMessage`; or `getTicket()` failing for any of several distinct backend failure modes
  (401, 500, network) in `SSEEventsService.connect`.
- Symptom: none currently — the logic reads correctly on inspection (traced above), but there is no
  automated test that would catch a regression in either branch order or in the null-vs-throw contract
  change if either is touched again later.
- Evidence: `paddle-checkout.service.ts:538-556` (function `checkoutBlockedMessage`, no spec file for the
  containing service exists anywhere under `libs/web/core/src/lib/services/`);
  `sse-events.service.ts:213-218,276-291` (same — no spec file for `SSEEventsService` exists).
- Current handling: none; relies on the reviewer's manual trace and the passing `web-core` test suite
  (which contains zero assertions touching either file).
- Recommendation: not a blocker for this batch (pre-existing gap, not introduced or worsened in scope by
  it — the previous string-based error signals were equally untested), but flagging it as the batch's one
  real residual risk: it is exactly the kind of branching logic (precedence order, a new `null` sentinel
  replacing a thrown `Error`) that a future refactor could silently invert without any test failing.

#### Generic `core.realtime.connectFailed` collapses distinct SSE failure causes

- Trigger: any exception inside `connect()`'s `try` block _other than_ a null ticket (e.g. `new
EventSource(...)` throwing, or a synchronous error in `setupEventListeners`).
- Symptom: the user sees the generic "Failed to connect" (`core.realtime.connectFailed`) regardless of the
  actual cause; the previous code had the same generic fallback for non-`Error` throws but preserved
  `error.message` for `Error` instances (`error instanceof Error ? error.message : 'Failed to connect'`) —
  that per-error detail is now discarded in favour of always using the fixed key.
- Evidence: `sse-events.service.ts:242-246` (old) vs `sse-events.service.ts:242-246` (new, the diff shown
  under Verification).
- Current handling: the real error is still `console.error`'d (`sse-events.service.ts:243`), so it is not
  lost for debugging — only the user-facing detail is now generic.
- Recommendation: acceptable and arguably required by this batch's own constraint (a signal typed
  `I18nMessage` cannot carry an arbitrary untranslated runtime string without breaking the "translatable,
  not raw text" contract the whole batch establishes) — not a regression to fix, just recorded as an
  intentional trade-off since the task description asked me to check for it.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### Moderate-1: No spec coverage for `PaddleCheckoutService` or `SSEEventsService`

- File: `libs/web/core/src/lib/services/paddle-checkout.service.ts`, `libs/web/core/src/lib/services/
sse-events.service.ts` (no corresponding `.spec.ts` exists for either)
- See "Failure modes — Untested checkout-blocked precedence and SSE ticket-null path" above for the full
  argument. Pre-existing gap, not newly introduced, but this batch adds the most branching-sensitive logic
  either file has had (a 3-way message precedence function; a thrown-to-null contract change) without
  adding tests. Carrying this forward rather than blocking on it, since it is outside this batch's declared
  file list (`batches.md:784` only names `paddle-checkout.service.ts` under "and other message-producing
  services", with no spec requirement stated).

### Minor

- `seo.service.ts:87` doc comment says "A switch re-applies them" for title/description; worth one more
  clause stating the assumption that the caller's scope must already be loaded (see Failure modes above) —
  cosmetic, not a functional gap.
- `sse-events.service.ts:87-88` reformatted `ConnectionState` from a multi-line union to one line — a pure
  style change with no logic effect, noted here only because it appeared in the diff; route to
  `code-style-review.md` if not already covered there.

## Data flow

1. Page component constructor → `inject(SeoService).setPage(config)` — synchronous, runs during Angular's
   component construction (SSR/SSG-safe). OK.
2. `setPage` computes English `ogTitle`/`ogDescription` via `this.english(key)` →
   `i18n.translate(key, {}, DEFAULT_LANG)` — always resolves the English scope regardless of active
   language. OK, confirmed in the build output for `ar`-irrelevant (server always renders `en`) and in the
   spec `'writes the title and description in Arabic and og/twitter in English'`.
3. `applyLocalized(config)` → `Title.setTitle` / `Meta.updateTag('description', ...)` in the **active**
   language. OK — depends on the calling scope already being loaded (traced per-caller above; no gap
   found).
4. `setCanonical`, then the 5 `og:*`/2 `twitter:*` `Meta.updateTag` calls, then `this.page = config` is
   stored last. OK — storing `this.page` after all synchronous writes means a concurrent read of `this.page`
   (there is none; single-threaded JS) is a non-issue, but it does mean the root `effect` (registered in the
   constructor, reading `this.page`) cannot see a config until `setPage` has fully returned — correct, since
   the effect's own first flush is scheduled asynchronously by Angular regardless.
5. Root `effect(() => { this.i18n.lang(); if (this.page) this.applyLocalized(this.page); })` — re-runs only
   `applyLocalized`, never the og/twitter block or canonical — OK, matches the "og/twitter always English"
   contract; verified against the spec `'re-applies only the title and description after a language
switch'`.
6. Backend/service error signals (`_error`, `_validationError`, `error`, `errorMessage`) now carry
   `I18nMessage` instead of `string`; every consuming template updated in lockstep
   (`pricing-grid.component.ts:86-99,139-150`, `download-page.component.ts:77-83`) to
   `msg.key | transloco: msg.params`, each guarded by an `i18n-keys:` marker naming the owning `core.*`
   group. OK — `i18n-check` independently confirms these markers resolve and no orphaned key exists.

## Requirements fulfilment

| Requirement                                                                        | Status   | Gap                                                                                                              |
| ---------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Key-based `SeoService`, old literal fields removed, synchronous `setPage`          | COMPLETE | none                                                                                                             |
| og/twitter always English via `translate(key, {}, 'en')`                           | COMPLETE | none                                                                                                             |
| title/description follow active lang via a root `effect`                           | COMPLETE | none                                                                                                             |
| `core` service messages as `I18nMessage`                                           | COMPLETE | none                                                                                                             |
| `activePlanExists` with `{ plan }`; server message via `core.common.serverMessage` | COMPLETE | none                                                                                                             |
| `web-core` `i18n-check` target with `--allow-scope ui,app,landing,legal,pricing`   | COMPLETE | none                                                                                                             |
| `copy-review/core.md` generated                                                    | COMPLETE | none (regenerated live, `--check` clean)                                                                         |
| 6 `setPage` callers updated, only `setPage` blocks changed                         | COMPLETE | none                                                                                                             |
| English values verbatim                                                            | COMPLETE | confirmed by diff against the removed literals, all identical                                                    |
| `pricing` also carries `ogTitle`/`ogDescription`                                   | COMPLETE | none                                                                                                             |
| Prerender title/meta unchanged                                                     | COMPLETE | confirmed by a real build + `prerender-check`, not only by baseline diff                                         |
| Consumers in other projects (download page, pricing grid) still compile            | COMPLETE | confirmed by `lint`/`typecheck` on all 5 affected projects; no other stray consumer of the changed signals found |

Implicit requirements not addressed: automated test coverage for `PaddleCheckoutService`'s new message-
precedence function and `SSEEventsService`'s null-ticket contract (Moderate-1) — not stated as a Batch 10
acceptance criterion, carried forward as observed gap rather than as a violation.

## Edge cases

| Case                                                               | Handled        | How                                                                                                     | Concern                                                                       |
| ------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Language switch before any `setPage` call                          | YES            | `if (this.page)` guard in the effect                                                                    | none — unreachable in the running app per the single-injection-site trace     |
| Repeated `setPage` calls (route revisit) reuse one canonical link  | YES            | `setCanonical` queries for an existing `link[rel=canonical]` first                                      | none                                                                          |
| `og:image` only set when provided                                  | YES            | `if (config.ogImage)` guard                                                                             | none                                                                          |
| Empty/whitespace backend `message` in `checkoutBlockedMessage`     | NO             | truthy check only, same as the pre-batch code                                                           | see Q1 — pre-existing, not worsened                                           |
| SSE ticket request failing for a reason other than "not logged in" | NO (collapsed) | all failures → `core.realtime.authRequired`/`connectFailed`                                             | see Failure modes — user-facing detail lost, cause still logged               |
| Route navigation racing a language switch mid-transition           | YES (narrow)   | `this.page` always reflects the last completed `setPage`; effect re-applies whichever config is current | theoretical flicker window, not user-observable in practice                   |
| Scope not yet loaded when `setPage` runs                           | YES            | every caller's scope is resolver- or global-scope-gated (traced per caller)                             | none found in this batch; no enforcement at the type level for future callers |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH — every claim was checked against a real, uncached build (`prerender-check` ran a full
  production build, not a cached one), the grepped built HTML's actual tag content, a full re-run of every
  verification command the batch specifies (`test`, `i18n-check`, `lint`, `typecheck`,
  `degradation-audit:lint`, the typed SonarJS check, `review-tables --check`), and a direct trace of every
  one of the 6 `setPage` call sites against the router's resolver configuration and `app.config.ts`'s
  global-scope wiring, not inferred from the plan's description of that ordering.
- Top risk: none blocking or serious. The one real gap (Moderate-1) is missing test coverage for two
  services' new branching logic, not a functional defect — I traced both by hand and found the logic
  correct against its stated contract.
- What a robust implementation would add: (1) a spec for `PaddleCheckoutService.checkoutBlockedMessage`
  covering all three precedence branches plus the empty-string `message` edge case; (2) a spec for
  `SSEEventsService.connect`/`getTicket` covering the null-ticket path and at least one non-401 failure
  distinguishing test; (3) a one-line `SeoService` doc-comment stating the "caller's scope must already be
  loaded" assumption explicitly, since nothing enforces it at the type level for a future seventh caller.

---

# Code Logic Review — `TASK_2026_575_fee7` — Batch 11

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

Scope reviewed: `libs/web/ui/src/lib/{navigation.component.ts + new spec, footer.component.ts,
countdown-timer.component.ts, console/console-grid-background.component.ts,
session-calendar/{session-calendar.ts,.html,.spec.ts}, i18n/{en,ar}.json}`,
`libs/web/ui/project.json`, `copy-review/ui.md`, and the out-of-batch
`libs/web/admin/src/lib/builders/sessions/sessions-list.spec.ts`. Every file was read in full,
not only the diff hunks. Verification run: `nx run-many -t test,i18n-check -p web-ui
--skip-nx-cache` (3 suites / 33 tests, i18n-check exit 0), `nx run-many -t test -p web-admin
--skip-nx-cache` (pass), `nx run-many -t lint -p web-ui --skip-nx-cache` (pass),
`tools/i18n-check/src/prerender/check-prerender.ts` against the existing
`dist/ptah-landing-page/browser` (6/6 routes match baseline — build not rebuilt, per the
parallel-reviewer note), and `review-tables --check` for `ui` (OK, byte-identical).

## Five logic questions

### 1. How does this fail silently?

- `NavigationComponent.selectLanguage()` (`navigation.component.ts:1049-1056`) calls
  `this.setLanguage(lang)` without awaiting it, then immediately closes the menu and refocuses
  the trigger. If the scope load underlying that call fails, the visible state (menu closed,
  focus on trigger, `EN`/`AR` caption) briefly implies success even though nothing changed. This
  is not a new defect introduced by this batch — it is the literal, reviewed design-spec
  contract (design-spec.md §2.2's own `selectLanguage` snippet, §2.6 "closes the menu and
  explicitly refocuses the trigger") and `I18nService.setLanguage` (Batch 2, already APPROVED)
  guarantees it never rejects and that `activeLang()` stays truthful, so reopening the menu (or
  glancing at the trigger caption) always shows the real state, not a stale checked mark. No
  toast/error surface exists for a failed switch, which is an accepted product decision from an
  earlier, already-approved batch, not something Batch 11 introduces or should re-litigate.
- `footer.component.ts:106-124`: an `@for` loop over `column.links` renders `link.label` either
  literally (`brand: true`) or through `transloco`. If a future edit adds a link with neither
  `brand: true` nor a valid key, the `I18nMissingHandler` (Batch 2) returns `''` in production —
  the link would render with empty text but no error. This is the standing i18n-wide contract
  (2.2.5), not a Batch 11-specific gap, and `i18n-check`'s reference rule would already have
  caught a missing key had one existed in this diff (it did not: `i18n-check` exits 0).

### 2. What user action produces unexpected behaviour?

- Opening the language menu, then pressing `Escape`: `closeMenuAndRefocus()`
  (`navigation.component.ts:1083-1093`) looks up `#${menu}-menu-trigger`, which resolves to
  `#lang-menu-trigger` for `openMenu() === 'lang'` — verified by the new spec
  (`navigation.component.spec.ts:117-128`). No behavioural surprise found; the existing
  Escape/outside-click machinery required zero new wiring beyond widening the `NavMenu` union,
  exactly as design-spec §2.2 states.
- Switching language while the session calendar is mounted: `calendarOptions` recomputes only
  when `writable()`, `i18n.intlLocale()`, `i18n.direction()`, or `validRange()` actually change
  (Angular `computed()` semantics), so a language switch produces one new `options` object;
  `FullCalendarComponent.ngDoCheck` (vendor code, `node_modules/@fullcalendar/angular`) does a
  per-property shallow-inequality diff against its snapshot and calls `calendar.resetOptions(...)`
  when anything differs — verified directly by reading the vendor source and by the new spec
  `session-calendar.spec.ts:79-87` (`follows a switch to Arabic, keeping Western digits`), which
  asserts `getOption('locale')`/`getOption('direction')` update post-init. This was the task's own
  named risk ("does changing language after init update the calendar?") and it is answered: yes,
  by both source inspection and a passing regression test.

### 3. What input data produces a wrong answer?

- None found in this batch's own logic. Countdown cells are keyed by a stable `unit` literal
  (`'days' | 'hours' | 'minutes' | 'seconds'`, `countdown-timer.component.ts:110-121`) rather than
  the old translated `label` string, which was the correct fix for `@for (... track cell.label)`
  breaking `trackBy` identity once labels became language-dependent — tracking by a
  language-invariant key means Angular's view diffing survives a language switch instead of
  destroying and recreating the DOM cells (which would have discarded the `sec-pulse` animation
  state and briefly interrupted the `role="timer"` announcement region). This is exactly the fix
  the task called out to check, and it is correctly done.
- `ariaParams()` (`countdown-timer.component.ts:126-134`) feeds already zero-padded decimal
  strings (`pad(n)`, Western digits by construction) into `ui.countdown.ariaLabel`'s
  `{{ days }}`/`{{ hours }}`/… placeholders. Per 5.2 (Western numerals throughout), this is
  correct; there is no locale-sensitive number formatting call here to get wrong.

### 4. What happens when a dependency fails?

- `I18nService.setLanguage` (dependency of every component in this batch) is contractually
  non-rejecting (Batch 2, already reviewed); this batch's components correctly rely on that
  contract rather than adding their own try/catch, which would have been redundant defensive
  code against an invariant the library already guarantees.
- FullCalendar's `resetOptions` (vendor dependency) is not itself defensively wrapped, but it is
  vendor-tested library code being handed a plain data object; there is no plausible failure mode
  local to `session-calendar.ts` that would need catching here, and the spec exercises the real
  code path end to end.

### 5. What is missing that the requirements never mentioned?

- The task's own instruction to check "ar locale lazy" surfaces a genuine gap: see Moderate-1.
- No test file exists for `footer.component.ts` or `countdown-timer.component.ts` even though
  both received substantial i18n/RTL rewrites in this batch (see Moderate-2). Neither the task
  description nor the plan explicitly demands a spec per component, but `navigation.component.ts`
  and `session-calendar.ts` — the two files that _did_ get new/updated specs in this same batch —
  show the team's own established practice of pairing a behavioural rewrite with a regression
  spec; the two components that didn't get one are the two left unverified by anything but
  `prerender-check` (which only proves the six baselined SSG routes, not runtime language
  switching, not the footer's `columnAriaLabel` interpolation, not the countdown's
  `ariaParams` wiring).

## Failure modes

### FullCalendar Arabic locale bundled unconditionally

- Trigger: any consumer of `SessionCalendar` (admin builders session list, members area) is
  built, regardless of whether that visitor ever switches to Arabic.
- Symptom: none visible to the user — this is a bundle-cost issue, not a correctness bug. Every
  build of every app importing `@ptah-web/ui`'s `SessionCalendar` unconditionally downloads
  FullCalendar's Arabic locale strings (`import arLocale from 'fullcalendar/locales/ar'`,
  `session-calendar.ts:31`) even for English-only sessions.
- Evidence: `libs/web/ui/src/lib/session-calendar/session-calendar.ts:31` (static top-level
  import), `:199` (`locales: [arLocale]`, always included in `calendarOptions`).
- Current handling: the locale module is a static ES import, resolved at build time into the
  initial chunk for every consumer of this component — there is no dynamic `import()` gate on
  the active language.
- Recommendation: mirror the pattern this same task already established for translation JSON
  (A1: `import('./ar.json')` lazy chunks) — load `fullcalendar/locales/ar` via a dynamic
  `import()` inside a `computed`/effect keyed off `i18n.lang() === 'ar'`, or unconditionally
  register both locales once but behind a route-level `import()` boundary, so an English-only
  bundle does not carry Arabic calendar strings it will never use. This is a Moderate finding —
  not a functional defect (the current code is correct end to end), but a bundle-size regression
  against the task's own stated architecture for exactly this kind of asset.

### Untested i18n conversion in footer and countdown components

- Trigger: any future edit to `footer.component.ts` or `countdown-timer.component.ts` (e.g. a
  copy change, a computed-key refactor, a locale-formatting change).
- Symptom: a regression (a missing `ltr-island` class, a broken `columnAriaLabel` interpolation,
  a `cell.unit`/`labelKey` mismatch) would not be caught by any unit test — only by
  `prerender-check` for the exact English string on the six baselined SSG routes, and only by
  manual QA/visual review for Arabic and for non-prerendered call sites.
- Evidence: `find libs/web/ui -name '*.spec.ts'` returns only
  `navigation.component.spec.ts`, `session-calendar.spec.ts` and `i18n/ui.i18n-scope.spec.ts` —
  no `footer.component.spec.ts`, no `countdown-timer.component.spec.ts`, and none existed before
  this batch either (`git log` on those paths is empty).
- Current handling: none; both components changed non-trivially (footer: `columnAriaLabel`
  interpolation over a computed `titleKey`, brand-vs-translated branching; countdown: cell keying,
  `ariaParams` computed, `ltr-island` digit wrapping) and rely entirely on `i18n-check`'s static
  key-reference checking plus `prerender-check`'s baseline-diff for the English happy path.
- Recommendation: add a focused spec for each covering at minimum: (a) verbatim English render
  before any language is switched, (b) the interpolated `columnAriaLabel`/`ariaLabel` values after
  a switch to `ar`, and, for the countdown, (c) that `cell.unit`-based tracking survives a
  language switch without remounting the `sec-pulse` element (a DOM-node-identity assertion). This
  is Moderate, not Blocking/Serious, because the actual behaviour — verified by hand-tracing both
  files line by line and by the passing `prerender-check` — is correct; the gap is coverage, not a
  known defect.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. (Moderate) `session-calendar.ts:31` — `fullcalendar/locales/ar` imported statically; not
   lazy-loaded behind the active language. See "FullCalendar Arabic locale bundled
   unconditionally" above.
2. (Moderate) No spec files for `footer.component.ts` / `countdown-timer.component.ts`. See
   "Untested i18n conversion" above.
3. (Minor) `console-grid-background.component.ts:48` marks `.glow`'s `left: 50%` /
   `transform: translate(-50%, -50%)` as `rtl-exempt: decorative geometry, not content flow`,
   which is accurate but not the most precise available reason — `left-1/2 -translate-x-1/2` (its
   Tailwind analogue) is textbook design-spec §3.1 "centring pair, directionless." Either
   exemption reason is accepted by the tool and both are true of this rule; no functional
   difference, purely a documentation-precision nit.
4. (Minor) `navigation.component.ts:337-408` (desktop) vs `:610-635` (mobile): the desktop skin's
   `selectLanguage()` explicitly refocuses `#lang-menu-trigger` after a switch, while the mobile
   row's plain `setLanguage(lang)` (`:630`) does not manage focus at all — correct per design-spec
   §2.3 (native `<button>` operability, no roving-tabindex needed), but worth noting for a future
   reviewer that the two code paths are intentionally asymmetric, not an oversight.

## Data flow

1. User opens the desktop language menu (`toggleMenu('lang')`) → `openMenu` signal flips to
   `'lang'` → `@if (openMenu() === 'lang')` renders the menu, `aria-expanded` and the `rotate-180`
   chevron follow the same signal. OK.
2. User activates an option → `selectLanguage(lang)` → `I18nService.setLanguage(lang)` fired
   (fire-and-forget, contractually non-rejecting) → `openMenu.set(null)` → trigger refocused
   synchronously, before the language promise settles. OK — matches the reviewed and approved
   design contract; `aria-checked` on reopen always reflects the real `activeLang()`, never a
   forged intermediate state.
3. `I18nService.setLanguage` resolves → `i18n.lang`/`direction`/`intlLocale` signals update →
   every `computed()` reading them recomputes: `NavigationComponent.languageCode`/
   `languageNativeName`, `SessionCalendar.calendarOptions` (locale/direction), any `transloco`
   pipe bound in the templates of `footer`, `countdown-timer`, `session-calendar.html`. OK,
   verified by the new specs for navigation and the calendar.
4. `SessionCalendar.calendarOptions()` change → `[options]` binding on `<full-calendar>` → vendor
   `ngDoCheck` diff → `calendar.resetOptions(...)` → the mounted FullCalendar instance re-renders
   with the new `locale`/`direction`. OK, verified by spec and by reading vendor source.
5. Prerendered routes (`/`, `/download`, `/pricing`, legal pages) render `FooterComponent` and
   `NavigationComponent` server-side in English → `check-prerender.ts` confirms all 6 routes still
   match their English baselines byte-for-byte after this batch's key extraction. OK, run and
   confirmed in this review.
6. `i18n-check --scope ui` (no `--allow-scope`) statically verifies every `transloco`
   reference/computed-key marker against `en.json`/`ar.json` parity, RTL exemptions, and glossary
   terms → exits 0. OK, run and confirmed in this review.

## Requirements fulfilment

| Requirement                                                                                                           | Status   | Gap                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.8 switcher keyboard/ARIA (menu, menuitemradio, aria-checked, aria-expanded, label-in-name, own lang/dir per option) | COMPLETE | None found; matches design-spec §2.2/§2.3/§2.6 exactly, verified by new spec and prerendered HTML.                                                                                                                                              |
| Escape/outside-click semantics unchanged                                                                              | COMPLETE | Verified by spec (`navigation.component.spec.ts:117-139`).                                                                                                                                                                                      |
| Selection closes menu and refocuses trigger                                                                           | COMPLETE | `selectLanguage` (`navigation.component.ts:1049-1056`), verified by spec.                                                                                                                                                                       |
| Mobile row group semantics (`role="group"` owning `menuitemradio`, valid child of the `role="menu"` overlay)          | COMPLETE | `navigation.component.ts:611-635`, matches design-spec §2.3's B3 fix.                                                                                                                                                                           |
| `setLanguage` failure keeps state honest                                                                              | COMPLETE | Relies on Batch 2's non-rejecting, state-truthful `I18nService.setLanguage` contract; no regression introduced.                                                                                                                                 |
| Accessible name / option labels in own language (3.8)                                                                 | COMPLETE | Verified by spec and prerendered `aria-label="EN — Language: English"`.                                                                                                                                                                         |
| Per-option `lang`/`dir`                                                                                               | COMPLETE | `[attr.lang]="lang" [attr.dir]="LANG_DIRECTION[lang]"`, verified by spec.                                                                                                                                                                       |
| `NavMenu` union widened without breaking other menus                                                                  | COMPLETE | `'product' \| 'community' \| 'lang' \| 'user'`; mutual exclusion via the single `openMenu` signal preserved; verified by spec ("keeps one menu open at a time").                                                                                |
| `data-i18n-switcher` on both wrappers                                                                                 | COMPLETE | Desktop wrapper (`:338`) confirmed in prerendered HTML; mobile wrapper (`:614`) confirmed by spec — absent from the prerendered HTML only because the mobile overlay itself is conditionally rendered, which is expected, not a gap.            |
| Countdown cells keyed by unit, not label                                                                              | COMPLETE | `track cell.unit`, `countdown-timer.component.ts:43`.                                                                                                                                                                                           |
| Digits `ltr-island`                                                                                                   | COMPLETE | `countdown-timer.component.ts:46`.                                                                                                                                                                                                              |
| `aria-label` params                                                                                                   | COMPLETE | `ariaParams()` computed, `:126-134`.                                                                                                                                                                                                            |
| Volatile attribute intact                                                                                             | COMPLETE | `data-prerender-volatile` unchanged, `:27`.                                                                                                                                                                                                     |
| Footer brand names literal                                                                                            | COMPLETE | `link.brand ? link.label : (link.label \| transloco)`, `footer.component.ts:115`.                                                                                                                                                               |
| Footer `i18n-keys` markers valid                                                                                      | COMPLETE | `i18n-check` exits 0; markers at `:71`, `:93` cover their `@for` blocks.                                                                                                                                                                        |
| FullCalendar locale/direction reactive to i18n signals                                                                | COMPLETE | Verified by source read of vendor `ngDoCheck`/`resetOptions` and by the new spec.                                                                                                                                                               |
| Ar locale lazy                                                                                                        | MISSING  | `fullcalendar/locales/ar` is a static top-level import (`session-calendar.ts:31`); see Moderate-1.                                                                                                                                              |
| Verbatim English on prerendered chrome                                                                                | COMPLETE | `check-prerender.ts` run in this review: 6/6 routes match baseline.                                                                                                                                                                             |
| Arabic real, glossary terms Latin                                                                                     | COMPLETE | Every `ar.json` value is genuine Arabic prose; all Latin-script glossary terms (Ptah, Claude Agent SDK, VS Code, CLI, Discord, GitHub, Reddit, LinkedIn, Meet) preserved verbatim; all already present in `glossary.json` (none new to report). |
| Admin spec edit justified and minimal                                                                                 | COMPLETE | `sessions-list.spec.ts` adds only the `ui` scope translations `SessionCalendar` now needs; no unrelated changes.                                                                                                                                |

Implicit requirements not addressed: automated regression coverage for `footer.component.ts` and
`countdown-timer.component.ts` (Moderate-2, not a stated acceptance criterion, but consistent with
the pattern the rest of this batch follows).

## Edge cases

| Case                                                  | Handled                          | How                                                                                                                                                                        | Concern                                                                                                                          |
| ----------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Select same language twice                            | YES                              | `selectLanguage`/`setLanguage` are idempotent; `I18nService` re-resolves without side effects (Batch 2).                                                                   | None.                                                                                                                            |
| Rapid double-click between EN/AR                      | YES (by Batch 2 contract)        | "latest call wins" (`i18n.service.ts`, already reviewed); not re-tested here since no new concurrency code was added in this batch.                                        | None new.                                                                                                                        |
| Language switch mid-drag on the calendar              | NOT COVERED                      | No test or code path specifically addresses a `resetOptions` call arriving while FullCalendar has an in-progress drag/resize interaction.                                  | Low-probability interaction; not named in task-description or design-spec; worth a follow-up e2e note, not a batch-blocking gap. |
| Escape with no menu open                              | YES                              | `closeMenuAndRefocus()` returns early when `openMenu() === null` (`navigation.component.ts:1083-1088`).                                                                    | None.                                                                                                                            |
| Footer link with neither `brand` nor a resolvable key | YES (by the wider i18n contract) | `I18nMissingHandler` returns `''`, never a raw key; `i18n-check` would fail the build first.                                                                               | None — covered by the standing i18n-wide contract, not this batch's own code.                                                    |
| SSR/prerender of the language menu itself             | YES                              | `data-i18n-switcher` wrapper renders in the English SSG output with `aria-expanded="false"`, no open-menu state; confirmed in `dist/ptah-landing-page/browser/index.html`. | None.                                                                                                                            |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: `fullcalendar/locales/ar` is bundled unconditionally for every consumer of
  `SessionCalendar`, working against this task's own "lazy per-language asset" architecture
  (Moderate-1) — not a correctness bug, but a real regression against the task's stated goals if
  left unaddressed in a later batch.
- What a robust implementation would add: (1) a dynamic `import()` gate on
  `fullcalendar/locales/ar`, loaded only when `i18n.lang() === 'ar'`; (2) `footer.component.spec.ts`
  and `countdown-timer.component.spec.ts` covering verbatim English, the interpolated ARIA labels
  after a language switch, and (for the countdown) DOM-node-identity survival across a switch; (3)
  an e2e note (not necessarily a unit test) covering a language switch mid-drag on the session
  calendar, since `resetOptions` semantics under an in-progress FullCalendar interaction are
  untested by this batch or by FullCalendar's own type contract.

---

# Code Logic Review — `TASK_2026_575_fee7` — Batch 11 — round 2

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

Scope: the round-1 rework only — `libs/web/ui/src/lib/session-calendar/{session-calendar.ts,.spec.ts}`
(the `resource()`-based lazy `ar` locale and its `locales: hasValue() ? [value()] : []` wiring),
new `libs/web/ui/src/lib/{footer.component.spec.ts,countdown-timer.component.spec.ts}`, and the
`countdown-timer.component.ts` row-level `dir="ltr"` change (replacing the earlier per-digit
`.ltr-island`). `navigation.component.ts`'s further changes in this diff are class-only responsive
spacing (`px-1 lg:px-2`, `gap-1 lg:gap-6`, `whitespace-nowrap`, `shrink-0`, `min-w-0`) with no new
logic, ARIA, or i18n-key surface — visual-reviewer territory, out of this logic review's scope, and
confirmed inert here by the still-passing `navigation.component.spec.ts` (unchanged assertions, all
green). Every file was re-read in full against the round-1 finding, not only the new diff hunks.
`fullcalendar/locales/ar`'s vendor loader/effect implementation
(`node_modules/@angular/core/fesm2022/_resource-chunk.mjs`, the `resource()`/`ResourceImpl` source)
was read directly to verify the reactivity and cancellation claims below rather than assumed.

Verification run (no dist rebuild — the visual reviewer owns that in parallel this round):

- `nx run-many -t test,i18n-check -p web-ui --skip-nx-cache`: 5 suites / 40 tests pass, i18n-check
  exit 0 (run 3× back to back to check the new `until()` poll for flakiness — 40/40 green every time).
- `nx run-many -t test -p web-admin --skip-nx-cache`: pass, unchanged from round 1.

## Judge questions

### `resource()` semantics — reactivity on en→ar→en, cancellation, error state

**Reactivity (en→ar→en).** `arLocale = resource({ params: () => i18n.lang() === 'ar' ? 'ar' : undefined,
loader: () => import('fullcalendar/locales/ar').then(m => m.default) })`
(`session-calendar.ts:154-157`). Reading Angular's own `ResourceImpl` (`_resource-chunk.mjs:204-338`):
`extRequest` is a `linkedSignal` that recomputes synchronously whenever `params()`'s tracked
dependency (`i18n.lang()`) changes, producing a **new** `{request, reload}` object each time. `state`
(also a `linkedSignal`, derived from `extRequest`) recomputes in the same synchronous pass: when
`request === undefined` it sets `status: 'idle'` and does not carry the previous `stream` forward
(the `previous.value.extRequest.request === request` guard fails whenever the request value itself
changed), so `arLocale.hasValue()`/`arLocale.value()` flip back to `false`/`undefined` **immediately**
on switching back to English, without waiting for the `loadEffect` effect to run. This matches the
new spec's assertion exactly (`session-calendar.spec.ts:130-133`, en→codes `[]`) and matches the
direct source read, not just the passing test.

**Cancellation.** When `state` transitions to `'loading'` (request `'ar'`), the `loadEffect` effect
(triggered because it reads `this.extRequest()`) proceeds, creates an `AbortController`, and awaits
`this.loaderFn({params, abortSignal, ...})`. If `i18n.lang()` flips back to English _while that await
is in flight_: `extRequest`/`state` have already synchronously reset to idle (as above) by the time
the effect re-runs; the re-run's own `if (extRequest.request === undefined) return;` guard means it
returns **before** calling `abortInProgressLoad()` — so the in-flight `import()` is not literally
`AbortController.abort()`-ed (dynamic `import()` has no cancellation hook to honor it anyway). It is,
however, correctly _discarded_: when the stale await eventually resolves, `shouldDiscard()` checks
`untracked(this.extRequest) !== extRequest` — the captured `extRequest` object reference from the
stale run no longer matches the live signal's current object (a new one was created on the switch
back), so the stale result is dropped and `this.state.set(...)` is never called for it. No
use-after-discard, no stale Arabic locale silently reappearing after a fast en→ar→en flip. This is
correct-by-construction Angular `resource()` behaviour, not bespoke code in this component, and it
was verified by reading the vendor source rather than trusted on faith.

**Error state.** `getLoader()` (vendor) wraps the user loader in a try/catch and resolves to an
error-carrying signal rather than letting the promise reject, so a failed `import()` (network
failure, corrupt chunk) lands in `status: 'error'`. `BaseWritableResource.isValueDefined` explicitly
returns `false` when `isError()` is true (`_resource-chunk.mjs:174-179`), so `hasValue()` stays
`false` on failure — `calendarOptions.locales` stays `[]`, and the grid keeps FullCalendar's built-in
English labels indefinitely for that session, exactly as the code's own comment states
(`session-calendar.ts:146-153`: "if it fails to load, the grid keeps FullCalendar's built-in English
labels"). This is intentional graceful degradation, not a defect — but see Moderate-1 below: nothing
in this component reads `arLocale.error()`, so a genuine chunk-load failure produces **no**
`console.error`/log of any kind, unlike `I18nService`'s own scope-load failures
(`i18n.service.ts:99-101`, `:105`), which do log. A subsequent switch away from and back to Arabic
retries the load automatically (new `extRequest` object, no memoized failure), so the degradation
self-heals on the next toggle; it is the _silence_ of the first failure, not permanence, that is the
gap.

### SSR — does the resource run on the server, and is that safe?

Yes, the `resource()` is constructed unconditionally (it is a field initializer, evaluated for every
instance including one rendered on the server), but its `params()` function is gated on
`this.i18n.lang() === 'ar'`, and `I18nService.detectLang()` (`i18n.service.ts:135-138`) returns
`DEFAULT_LANG` (`'en'`) whenever `!this.isBrowser` — a hard, unconditional short-circuit, not a
best-effort default. Since `I18nService.current` is seeded from `detectLang()`/`init()` and `init()`
itself short-circuits to English on the server, `i18n.lang()` can never read `'ar'` during
prerendering. `params()` therefore always evaluates to `undefined` server-side, `extRequest.request`
stays `undefined`, and `loadEffect`'s very first line (`if (extRequest.request === undefined) return;`)
means the loader — the `import('fullcalendar/locales/ar')` call — is **never invoked** on the server.
This was confirmed by reading `i18n.service.ts:43,135-138` directly (the same `isBrowser` gate
already reviewed and approved in Batch 2), not inferred. There is also no server-rendering exposure
in practice regardless: `SessionCalendar` is only reachable from the admin/members CSR-only areas,
which the app's `outputMode: "static"` build never server-renders (only the six named SSG routes in
`app.routes.server.ts` are prerendered, and `SessionCalendar` is not on any of them) — so this is
belt-and-braces safe on two independent grounds, not one assumption stacked on another.

### The `until()` helper — bounded, not flaky?

`until()` (`session-calendar.spec.ts:55-60`) polls up to 50 iterations of
`await setTimeout(0)` + `fixture.detectChanges()`, exiting early once `done()` holds and otherwise
falling through without throwing (the subsequent assertion then fails with a normal, readable
mismatch — e.g. `expect(localeCodes()).toEqual(['ar'])` against an empty array — rather than a test
runner timeout or an infinite hang). This is materially better than an unbounded `while` loop and
better than reusing `whenStable()` here — the code comment
(`session-calendar.spec.ts:51-54`) correctly explains why `whenStable()` cannot be used: FullCalendar's
`nowIndicator: true` (`session-calendar.ts:223`) keeps a live timer running once the calendar renders,
which is a genuinely pending macrotask from Angular's point of view, so `ApplicationRef.whenStable()`
(or `fixture.whenStable()`, which layers on the same zone/task tracking) would hang for the test's
lifetime. Run three times back to back in this review (see Verification above), all 40 tests passed
each time with no observed timing sensitivity — the awaited work (a same-repo Jest module resolution
of `fullcalendar/locales/ar`, effectively synchronous after Jest's module cache is warm) settles
within one or two ticks in practice, leaving 48-49 iterations of headroom against the 50-iteration
cap. This is a reasonable, correctly-bounded test pattern, not a source of CI flakiness.

### Does `locales: []` while loading/failed cause a visible flash?

Partially, and the code is explicit about accepting this trade-off rather than hiding it
(`session-calendar.ts:146-153`'s own comment). `locale: this.i18n.intlLocale()` and
`direction: this.i18n.direction()` come straight from `I18nService` signals and update **synchronously**
with the language switch — RTL layout and the `ar-u-nu-latn` locale tag apply on the very next render.
`locales: this.arLocale.hasValue() ? [this.arLocale.value()] : []`, by contrast, only gains the `'ar'`
locale definition once the lazy chunk resolves. Between those two moments — direction/locale flipped,
Arabic locale strings not yet registered — FullCalendar has nothing named `'ar'` to look up for its
`locale: 'ar-u-nu-latn'` option and falls back to its own built-in default (English) toolbar/day/month
strings, so for a brief window the grid is RTL-laid-out with English labels. On a warm module cache
(a repeat switch to Arabic in the same session) this window is sub-frame, since the dynamic `import()`
resolves from the browser's ES module cache almost instantly; on the **first** switch to Arabic in a
session it is a genuine, if small (343-byte chunk, per the coordinator), network round trip, so the
flash is real, not hypothetical, on that first switch. It self-corrects the moment the resource
resolves (verified by the new spec), never leaves the grid in a wrong-but-stable state, and is an
explicit, documented, single-component trade-off rather than an unnoticed gap — consistent with, and
in fact a closer reading of, this same task's own "the only English-in-RTL window allowed is from
first paint until hydration completes" principle (task-description.md 3.6) applied here to a
CSR-only, non-prerendered component where that specific acceptance criterion does not technically
apply (3.6 governs prerendered-route hydration, not a post-hydration in-session language switch on an
admin/members-only widget). Given the size of the asset, the self-healing behaviour, and the explicit
in-code acknowledgment, this is a Moderate observation, not a defect to block on.

## Failure modes

### Silent locale-chunk load failure

- Trigger: `import('fullcalendar/locales/ar')` (`session-calendar.ts:156`) rejects or the returned
  module is malformed (network failure, corrupted/missing chunk, a CDN/proxy blip).
- Symptom: the grid quietly keeps FullCalendar's built-in English toolbar/day/month strings forever
  for that session (by design — see "Error state" above), with no console output, no telemetry, and
  no visible error state anywhere in the component. A developer debugging "why does the calendar
  still say January in Arabic mode" has nothing in the console to go on.
- Evidence: `session-calendar.ts:154-157` — `arLocale`'s error path is never read (`arLocale.error()`
  is not referenced anywhere in the file); contrast `i18n.service.ts:99-101`/`:105`, which log a
  `console.error` on a comparable scope-load failure.
- Current handling: none; the error is captured in the resource's own `error` signal and left unread.
- Recommendation: log once on `arLocale.error()` transitioning to a defined value (e.g. an `effect()`
  or a `computed` read in a diagnostic path), mirroring `I18nService`'s own pattern for a failed load,
  so a real failure is at least observable in the console without changing the graceful-degradation
  UI behaviour. Moderate, not Blocking/Serious — the user-facing behaviour is correct and self-healing
  on the next language toggle; only observability is missing.

## Blocking issues

None found.

## Serious issues

None found. Both round-1 Moderate findings are resolved:

- M1 (`fullcalendar/locales/ar` bundled unconditionally): fixed. The static import is gone; the module
  is now reached only through `resource()`'s lazy `import()`, gated on `i18n.lang() === 'ar'`. Verified
  by reading `session-calendar.ts:154-157` (no top-level `import ... from 'fullcalendar/locales/ar'`
  remains) and taking the coordinator's stated bundle evidence (a separate 343-byte chunk, 0
  occurrences in `main-*.js`) as consistent with that source change — this review did not rebuild
  `dist` itself (per the round-2 instruction to leave the concurrent rebuild to the visual reviewer),
  so the bundle-analysis claim is accepted on the strength of the source change alone plus the
  reported figures, not independently re-measured this round.
- M2 (no spec coverage for `footer.component.ts`/`countdown-timer.component.ts`): fixed. Both now have
  focused specs (`footer.component.spec.ts`, `countdown-timer.component.spec.ts`) covering verbatim
  English, Arabic-with-Latin-brand-names, the `sec-pulse` gating, the expired state, and the
  interpolated `aria-label` values in both languages — reviewed in full above, both correct and
  passing.

## Moderate and minor issues

1. (Moderate) `session-calendar.ts:154-157` — `arLocale.error()` is never read or logged; a genuine
   locale-chunk load failure is entirely silent. See "Silent locale-chunk load failure" above.
2. (Minor) The brief RTL-layout/English-labels flash on the _first_ switch to Arabic in a session
   (see "Does `locales: []` while loading/failed cause a visible flash?" above) is real but small,
   self-healing, explicitly documented in-code, and outside this task's stated prerender-hydration
   acceptance criteria (3.6 governs SSG routes; `SessionCalendar` is CSR-only). Noted for a future
   polish pass (e.g. preloading the chunk on hover/focus of the language switcher, or eagerly starting
   the `import()` once `writable`/`sessions` are first bound) rather than required for this batch.
3. (Minor) `countdown-timer.component.ts:40` applies `dir="ltr"` unconditionally on the whole timer
   row, including in English (where it is a no-op, since `ltr` is already the ambient default) — a
   clean simplification over the earlier per-digit `.ltr-island` approach, and correctly reasoned in
   the adjacent comment ("A clock reads days to seconds left to right in both languages"); flagged
   only so a future reviewer knows this was a deliberate widening from "digits only" to "the whole
   row," confirmed still passing `i18n-check`'s RTL rule.

## Data flow (updated for the round-1 rework)

1. `i18n.lang()` changes → `arLocale`'s `params()` recomputes synchronously (`'ar'` or `undefined`) →
   `extRequest`/`state` (Angular `resource()` internals) recompute synchronously in the same pass,
   immediately reflecting `idle` (English) or `loading`→`resolved`/`error` (Arabic) in
   `hasValue()`/`value()`. OK, verified by source read and by the new "loads the Arabic strings lazily
   and drops them again in English" spec.
2. `calendarOptions()` (a `computed`) reads `this.arLocale.hasValue()`/`.value()` alongside
   `i18n.intlLocale()`/`i18n.direction()` → recomputes whenever any of those signals change → produces
   a new `CalendarOptions` object with `locales: [] | ['ar']`, `locale`, `direction` all consistent
   with the _current_ signal readings at computation time (direction/locale immediate; `locales` lags
   until the chunk resolves — the documented, accepted flash window). OK.
3. `[options]="calendarOptions()"` → vendor `ngDoCheck`/`resetOptions` (unchanged from round 1,
   already verified) → the mounted FullCalendar instance re-renders with whatever the latest
   `calendarOptions()` snapshot holds, including a `locales: []` snapshot if `resetOptions` happens to
   fire before the chunk resolves, and a second `resetOptions` once it does (the resource's own value
   change triggers `calendarOptions` to recompute again, a second distinct `options` object, caught by
   the same `ngDoCheck` diff). OK — this is exactly how the eventual self-correction reaches the DOM.
4. Prerendered routes never construct `SessionCalendar` at all (confirmed: not one of the 6 SSG routes,
   and `i18n.lang()` is hard-pinned to `'en'` server-side regardless). OK, no interaction with 3.5/3.6.

## Requirements fulfilment (delta from round 1)

| Requirement                                            | Status   | Gap                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ar locale lazy                                         | COMPLETE | Static import removed; now a `resource()`-gated dynamic `import()`, verified by source read; bundle-split evidence accepted from the coordinator's report (not independently re-measured this round per the no-concurrent-rebuild instruction). |
| FullCalendar locale/direction reactive across en→ar→en | COMPLETE | Verified by source read of `resource()` internals plus the new "loads... and drops them again" spec.                                                                                                                                            |
| Countdown/footer automated regression coverage         | COMPLETE | New `footer.component.spec.ts` and `countdown-timer.component.spec.ts`, both reviewed in full and passing.                                                                                                                                      |

## Edge cases (delta from round 1)

| Case                                                     | Handled                       | How                                                                                                       | Concern                                                                                                                              |
| -------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Fast en→ar→en toggle while the ar chunk is still loading | YES                           | `shouldDiscard()` reference-identity check drops the stale resolution; verified by reading vendor source. | None — no stale-value leak.                                                                                                          |
| Ar locale chunk fails to load                            | YES (functionally)            | `hasValue()` stays `false`, grid keeps English labels indefinitely, self-heals on next toggle.            | Silent — no log (Moderate-1 above).                                                                                                  |
| First-ever switch to Arabic in a session                 | PARTIALLY                     | Direction/locale update immediately; `locales` lags by one real network round trip for the small chunk.   | Brief, self-healing flash (Minor-2 above); not covered by an automated test, since it is a timing window rather than a steady state. |
| `SessionCalendar` server-rendered                        | N/A, but safe if it ever were | `i18n.lang()` is hard-pinned to `'en'` server-side; loader never invoked.                                 | None.                                                                                                                                |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a real locale-chunk load failure (network blip, bad deploy) would be entirely silent —
  no console signal for a developer to find, though the user-facing degradation itself is correct and
  self-healing (Moderate-1).
- What a robust implementation would add: (1) a single `console.error`/log read of `arLocale.error()`
  on transition to an error state, mirroring `I18nService`'s own failed-load logging; (2) an optional
  polish, not required this batch: start the `arLocale` chunk fetch slightly earlier than the language
  actually switching (e.g. on hover/focus of the language-switcher trigger) to shrink the first-switch
  flash window further; (3) a note in the component's own doc comment that the `locales: []` window is
  a deliberate, bounded trade-off, for the benefit of a future maintainer who might otherwise "fix" it
  by re-introducing a static import.

## Batch 12

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 4        |
| Failure modes found | 3        |

### Scope examined

Read in full: `libs/web/panel-ui/src/lib/language-switch/{language-switch.ts,language-switch.spec.ts}`
(new, not exported from `src/index.ts` — confirmed by grep); `panel-layout.{html,ts}` and the new
`panel-layout.spec.ts`; `empty-state.{html,ts,spec.ts}`; `detail-drawer.{html,ts,spec.ts}`;
`selection-toolbar.{html,ts,spec.ts}`; `thread-row.{html,ts,spec.ts}`; `stat-tile.{html,ts}` and the new
`stat-tile.spec.ts`; `libs/web/panel-ui/src/lib/i18n/{en,ar}.json`; `libs/web/panel-ui/project.json`
(new `i18n-check` target); `copy-review/panelUi.md`. Cross-checked against `libs/frontend/i18n/src/lib/
i18n.service.ts` (`setLanguage`/`loadRegistered`/`latestRequest` race guard) for the "failed setLanguage
keeps aria-checked honest" claim in the doc comments. Traced every consumer of `ADMIN_NAV_GROUPS`/
`MEMBER_NAV_GROUPS` — `admin-layout.ts`, `admin-nav.config.ts`, `member-layout.ts`,
`member-nav.config.ts` — to evaluate the nav-group index-keying risk, even though those files are out of
this batch's file list (only their specs were touched, and only for the `provideI18nTesting`
boilerplate). Diffed all 24 out-of-batch consumer spec changes in `libs/web/{admin,members}` (all
`beforeAll`-loaded `provideI18nTesting` additions plus the one `pl-8`→`ps-8` assertion update in
`member-nav-badge.spec.ts`), `libs/web/members/jest.config.cts`, and the two pre-existing-SonarJS-fix
diffs (`localeCompare` sort comparators, one regex non-capturing-group change) — all cosmetic/harness,
none touch behaviour under review.

Verification run and evidence: `nx run-many -t test,i18n-check -p web-panel-ui --skip-nx-cache` → both
green (`i18n-check [panelUi]: OK`; Jest: 9 suites / 64 tests passed); `nx run-many -t lint,typecheck -p
web-panel-ui --skip-nx-cache` → both green; `nx run-many -t test -p web-members web-admin
--skip-nx-cache` → both green (confirms none of the 24 out-of-batch spec edits broke anything). I did not
rebuild `dist` (a visual reviewer runs in parallel against it per the task's own instruction).

### Five logic questions

#### 1. How does this fail silently?

- `LanguageSwitch.select()` (`language-switch.ts:112-114`) is `void this.i18n.setLanguage(lang)` —
  fire-and-forget. `I18nService.setLanguage` (`i18n.service.ts:103-115`) never rejects; on a failed scope
  load it logs once via `console.error` and resolves `false`, leaving `current` (and therefore
  `i18n.lang()`, `aria-checked`, `tabIndex`) unchanged. So the UI degrades correctly — the radio the user
  pressed simply never becomes checked — but nothing in `LanguageSwitch` itself observes the `false`
  return to, for example, show a toast or retry. This matches the documented contract (the class doc
  comment at `language-switch.ts:108-111` states it explicitly) and is consistent with how `I18nService`
  is used everywhere else in this codebase (Batch 2/9), so it is not a new defect — but it means a
  transient network failure during a language switch is invisible to the user beyond "nothing happened",
  and **no spec in this batch exercises a rejected `setLanguage`** to prove the claim holds (see Failure
  modes).
- `onGroupKeydown` (`language-switch.ts:117-127`) calls `this.select(next)` (fire-and-forget) and then
  immediately, synchronously, `this.focusRadio(next)` — it does not wait for the promise the click path
  implicitly waits for via change detection. On the ordinary success path this is harmless (the signal
  updates before or around the same microtask), but on a **failed** switch, DOM focus lands on a button
  whose `tabIndex` will re-render back to `-1` and `aria-checked="false"` once `i18n.lang()` re-resolves —
  the group is left in a state where the browser's focused element is not the one the roving-tabindex
  pattern intends to be focusable. Not a data-loss bug (Tab still moves on from that element positionally,
  and Shift+Tab/click still recover the correct state), but it is an unverified a11y edge case.

#### 2. What user action produces unexpected behaviour?

- Pressing an arrow key twice in rapid succession (before the first `setLanguage` scope-load promise
  settles) is protected: `I18nService`'s `latestRequest` counter (`i18n.service.ts:66,104,111`) makes the
  second call the only one that can `apply()`, so the "last press wins" — no torn state, no two languages
  racing to apply. Confirmed by reading the guard, not by a dedicated spec in this batch (the existing
  `language-switch.spec.ts` presses keys one at a time with `await settle()` between them).
- Clicking (not arrow-keying) the currently-_unchecked_ radio while a group toggle re-render is in flight:
  no issue found — `select()`/click do not touch `collapsedGroups` or any `panel-layout` state, and
  `PanelLayout`'s own `toggleGroup`/`isCollapsed` (`panel-layout.ts:105-110`) are independent, synchronous,
  and unaffected by a language switch beyond the labels re-rendering.
- Collapsing a group, then having the shell append a NEW nav group to the end of `navGroups()` at runtime
  (`admin-layout.ts:50-53`: `this.session.entitled() ? [...ADMIN_NAV_GROUPS, ADMIN_MEMBER_NAV_GROUP] :
ADMIN_NAV_GROUPS`; `member-layout.ts:123-136`: the equivalent `isAdmin()` branch) does not corrupt any
  existing group's collapse state, because in both of today's call sites the appended group is `flat:
true` (`admin-nav.config.ts:227`, `member-nav.config.ts:172`) and appended strictly at the END — flat
  groups never call `toggleGroup`/`isCollapsed` at all (`panel-layout.html:90-99` only renders the
  toggle button in the `@else` / non-flat branch), so the index space `collapsedGroups` cares about never
  shifts. This holds today, verified by reading both config files, but nothing in `panel-ui` enforces it
  (see Failure modes / Moderate-1).

#### 3. What input data produces a wrong answer?

- `StatTile.valueText` (`stat-tile.ts:80-88`): `new Intl.NumberFormat(this.i18n.intlLocale()).format(raw)`
  for any `typeof raw === 'number'`, including `NaN`, `Infinity`, and negative values — none of which the
  input type (`string | number | null`) rules out. `Intl.NumberFormat` renders `NaN` as the locale's own
  "NaN" string and `Infinity` as "∞", neither of which is caught or guarded; the previous `String(raw)`
  behaviour showed the same values equally uninterpreted (`"NaN"`, `"Infinity"`), so this is not a
  regression, but the new formatting call is one more thing that would silently show `∞` in a metric tile
  if an upstream stat computation ever divides by zero — worth a one-line note, not a fix, since no caller
  currently can produce those values (grepped all 4 call sites: `overview.html`, `marketing-hub.html`,
  `marketing-compose.html`, `campaign-detail.html` — all bind counts derived from array lengths or summed
  integers).
- `SelectionToolbar`/`ThreadRow` plural selection is a literal `=== 1` ternary duplicated at two template
  sites each (`selection-toolbar.html:10-13`, `thread-row.html:38-42` for replies, `:29-33` for unread) —
  I confirmed by hand for count 0, 1, 2 and an arbitrary `n` that the English output is byte-identical to
  the pre-batch hardcoded strings (`0 items selected` / `1 item selected` / `2 items selected`; `0
replies` / `1 reply` / `2 replies`; `0 new` / `1 new` / `n new`), because both the old JS ternary and the
  new `count === 1 ? One : Other` key selection use the same boundary. A future edit to only one of the
  two near-identical ternary sites (say, adding a `count === 0` special case to `thread-row`'s reply count
  but not its unread count, or vice versa) would silently drift English behaviour with no shared helper to
  catch it — the exact "requirements drift" pattern the reviewer brief calls out, now with two more sites
  than before this batch since pluralisation logic used to live once per component in a `computed()` and
  now lives once per template usage.

#### 4. What happens when a dependency fails?

- `I18nService.setLanguage` failing (network drop fetching the `ar` scope chunk, or a malformed JSON
  payload) is handled correctly at the service layer (returns `false`, logs once, leaves state
  unchanged — `i18n.service.ts:103-115`) and `LanguageSwitch`'s `aria-checked`/`tabIndex` bindings, being
  pure functions of `i18n.lang()`, stay honest by construction. But see Q1: the _focus_ side-effect of a
  keyboard-driven attempt is not equally protected, and no test in this batch proves either half of the
  claim under an actual failure (only the always-succeeds path is exercised in
  `language-switch.spec.ts`).
- `PANEL_UI_I18N_SCOPE` failing to load for a consuming shell (e.g. `admin`/`members`) is outside this
  batch's code (it is `I18nService`'s/the resolver's problem, covered in earlier batches) — `panel-ui`'s
  own components correctly degrade to their key-shaped fallback only in the sense that Transloco's
  documented missing-key behaviour (return `''`, Batch 2) would apply; I did not find a new failure mode
  introduced here beyond what Batch 2/9/10 already reviewed.

#### 5. What is missing that the requirements never mentioned?

- No spec anywhere in this batch exercises a **failed** `setLanguage` for `LanguageSwitch` (the task's own
  review-focus text names this explicitly: "failed setLanguage keeps aria-checked honest"). I verified the
  claim by reading `I18nService`, not by running a test that proves it, because no such test exists (see
  Failure modes).
- No spec asserts on `detail-drawer`'s new RTL close-offset pairing
  (`[class.translate-x-full]`/`[class.rtl:-translate-x-full]`, `detail-drawer.html:47-49`), unlike
  `panel-layout.spec.ts:168-177`, which explicitly asserts both `-rotate-90` and `rtl:rotate-90` are
  present on the chevron. The drawer's pairing follows the same N22-verified Tailwind precedent
  (`:where([dir="rtl"], [dir="rtl"] *)`, zero added specificity, last-rule-wins), so it is very likely
  correct, but nothing in this batch's own test surface proves it; it relies entirely on the parallel
  visual reviewer.
- The plan's Component 13 (`implementation-plan.md:648`) and Batch 12's own Task 12.3 both name "the 1
  formatting site" as in-scope, and the validation note "`stat-tile.ts:45` type union must not be
  flagged" (`batches.md:926`) is satisfied (`i18n-check` passed, confirming the AST formatting-detector
  does not false-positive on the `string | number | null` union). What is not addressed anywhere is that
  this is **new** formatting, not a pre-existing site converted to be locale-aware: the prior code was
  `String(raw)` (no formatting at all), so task-description.md:148's framing of requirement 5 — "dates and
  numbers **the app already formats**" — is stretched, not met literally, by this site. The change is
  well-tested (`stat-tile.spec.ts:45-48,50-57`) and internally consistent with 5.2 ("the numbering system
  ... applied consistently across the app"), and I found no consumer spec that breaks from the new
  thousands-separator in English (`overview.spec.ts` asserts nothing about displayed count text). I judge
  this in-scope and correctly implemented, not a defect — but it is a visible English change (e.g. an
  admin dashboard member count of 1234 now reads "1,234") introduced without the same evidentiary trail
  (a Preserve-list entry, a prerender diff, an explicit "before/after" callout) that Batch 10 gave the SEO
  service's byte-identical guarantee, and no code-style or product reviewer has yet signed off on that
  specific visual delta.
- No requirement or plan text addresses what happens to `collapsedGroups` state if a future group is
  inserted or removed from the _middle_ of `navGroups()` (rather than appended at the end) — see Failure
  modes / Moderate-1. Today's two call sites never do this, so it is a latent risk, not a live bug.

### Failure modes

#### Nav-group collapse state misattributed by a mid-array reshape

- Trigger: a future change to `admin-nav.config.ts`/`member-nav.config.ts` or their owning
  `computed(navGroups)` that inserts, removes, or reorders a **non-flat** group anywhere other than
  appending one at the very end (today's only conditional reshape, and always `flat: true`).
- Symptom: a group the user had expanded/collapsed silently shows the wrong disclosure state after the
  reshape — no error, no console log, the wrong secondary items simply appear or disappear for a group the
  user never touched.
- Evidence: `panel-layout.ts:88-94` (`collapsedGroups: Signal<ReadonlySet<number>>`, "Keyed by POSITION...
  The nav config is static per shell, so a group's index is stable" — an assumption, not an invariant
  enforced anywhere in `panel-ui`); `panel-layout.html:87` (`track $index`, so Angular's own DOM reuse is
  keyed the same fragile way); contrast with `member-layout.ts:23-30`'s explicit doc comment rejecting
  index-based keying for the unread badge for the identical reason ("both fail SILENTLY... an index breaks
  the moment a group gains an item").
- Current handling: none — the invariant holds today only because both real call sites
  (`admin-layout.ts:50-53`, `member-layout.ts:123-136`) happen to append a `flat: true` group at the end,
  which never touches `collapsedGroups`' index space.
- Recommendation: either key `collapsedGroups` by a stable per-group id (the group's first item's `route`,
  mirroring the badge's own "by route, not index" precedent one file away) or add a one-line assertion/doc
  comment in `panel-layout.ts` stating the append-only, flat-only contract so a future violation is a
  visible code-review question rather than a silent UI bug.

#### Unverified failed-switch focus/aria state in `LanguageSwitch`

- Trigger: `setLanguage` rejects internally (scope chunk fetch fails, JSON parse fails) while the user is
  mid-arrow-key navigation of the radiogroup.
- Symptom: `aria-checked` and `tabIndex` correctly stay on the previous language (verified by inspection of
  `I18nService`), but DOM focus has already moved (synchronously, before the promise settles) to the radio
  that did NOT get checked, per `onGroupKeydown`'s `select(next); focusRadio(next);` sequence
  (`language-switch.ts:125-126`). A screen reader user hears/reads the focused (unchecked) option while
  the visually-checked one is still the old language — a brief but real mismatch between focus and
  selection state that the APG radiogroup pattern is designed to avoid.
- Evidence: `language-switch.ts:112-127`; `i18n.service.ts:103-115`.
- Current handling: none; no spec covers this path (`language-switch.spec.ts` only exercises successful
  switches).
- Recommendation: await `select`'s promise before calling `focusRadio`, or call `focusRadio` unconditionally
  on `next` regardless of outcome but re-run it (or accept the current, still-correct `aria-checked`) once
  the promise resolves — and add a spec that stubs a rejecting `setLanguage` to prove `aria-checked` never
  lies, which is the exact scenario the task's own review focus asked to see checked.

#### Duplicated plural-selection ternaries with no shared source of truth

- Trigger: a future edit to one of the four `count === 1 ? X : Y` sites (`selection-toolbar.html:10-13`,
  `thread-row.html:29-33` unread, `thread-row.html:38-42` replies, plus the mirrored logic that would be
  needed if a fifth pluralised label is ever added to either component) without updating its siblings.
- Symptom: English (or Arabic) pluralisation silently diverges between, for example, the reply count and
  the unread count on the same row, with no compiler or lint signal — both are valid Angular template
  expressions.
- Evidence: `selection-toolbar.html:10-13`; `thread-row.html:29-33,38-42`; the pre-batch code instead
  centralised this in one `computed()` per label (removed by this batch, per the diff against
  `thread-row.ts`/`selection-toolbar.ts`).
- Current handling: none; correctness today is established by manual review (see Q3), not by a shared
  helper or a snapshot test covering all four count-boundary cases together.
- Recommendation: not blocking — Transloco's `en`/`ar` values are already the single source of truth for
  the _wording_; the risk is narrow (a code edit to the _selection_ ternary, not the translation). Worth a
  short comment at each site cross-referencing the others, or (lower priority) a tiny shared
  `pluralKey(count, base)` helper in `panel-ui` if a fifth site appears.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. **Moderate** — `collapsedGroups` index-keying has no enforced invariant against a future mid-array nav
   reshape; see Failure modes. `panel-layout.ts:88-94`, `panel-layout.html:87`.
2. **Moderate** — `LanguageSwitch`'s failed-`setLanguage` path (aria-checked honesty, focus timing) is
   asserted only by code inspection, not by a spec — the task's own review-focus item is unverified.
   `language-switch.ts:112-127`; `language-switch.spec.ts` (no failure-path test present).
3. **Moderate** — `stat-tile.ts:80-88`'s `Intl.NumberFormat` call is new formatting (prior code never
   formatted numbers), a visible English change shipped without the Preserve-list-style evidentiary trail
   other formatting/verbatim-English guarantees get elsewhere in this task. Well-tested and plan-sanctioned
   (`implementation-plan.md:648`, `batches.md:926`), not a defect, but flagged for product/copy sign-off
   awareness. `stat-tile.ts:80-88`; `stat-tile.spec.ts:45-48`.
4. **Moderate** — Plural-selection ternaries duplicated across `selection-toolbar.html` and two sites in
   `thread-row.html` with no shared helper; see Failure modes. `selection-toolbar.html:10-13`;
   `thread-row.html:29-33,38-42`.
5. **Minor** — `detail-drawer`'s new RTL close-offset class pairing has no dedicated spec assertion, unlike
   the chevron's in `panel-layout.spec.ts:168-177`. `detail-drawer.html:47-49`.
6. **Minor** — `LanguageSwitch.onGroupKeydown` moves DOM focus before its fire-and-forget `select()` promise
   settles; harmless on the success path (the overwhelmingly common case) but unverified on failure (see
   Failure modes #2). `language-switch.ts:125-126`.

## Data flow

1. User presses an arrow key inside the `radiogroup` → `onGroupKeydown` computes the next language via
   `arrowDelta` (reads `i18n.direction()` live) → OK, direction-aware and re-read per keystroke, not cached.
2. `select(next)` fires `I18nService.setLanguage` (fire-and-forget) → `focusRadio(next)` runs synchronously
   → OK on success; unverified/DOM-focus-ahead-of-state on failure (see Failure modes #2).
3. `setLanguage` increments `latestRequest`, awaits `loadRegistered`, and only applies if it is still the
   latest request → OK, races are structurally prevented.
4. On success, `current` signal updates → `lang()`/`direction()`/`intlLocale()` computeds recompute → every
   template reading them (`LanguageSwitch`'s `aria-checked`/`tabIndex`/`dir`, `StatTile.valueText`,
   `panelUi.*` transloco pipes) re-renders → OK, verified by both the unit specs and the `i18n-check` pass.
5. `PanelLayout`'s `navGroups()` input is supplied by the owning shell's `computed()`, already translated →
   `panel-layout.html`'s `@for` renders labels verbatim, never re-translating them → OK, matches the stated
   rule 4 contract; verified by grep (no `transloco` pipe touches `group.label`/`item.label` anywhere in
   `panel-layout.html`).
6. `toggleGroup(i)`/`isCollapsed(i)` read/write `collapsedGroups` keyed by the `@for` loop's `$index` → OK
   for every reshape this batch's real callers perform (append-only, flat-only) — gap flagged in Failure
   modes #1 for any future reshape that violates that unstated contract.
7. `StatTile.value()` (a number) flows into `valueText` → `Intl.NumberFormat(i18n.intlLocale())` → OK for
   every value the four current call sites can produce (see Q3); no defensive check for `NaN`/`Infinity`
   but nothing upstream currently produces them.

## Requirements fulfilment

| Requirement                                                                                                | Status                         | Gap                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LanguageSwitch` radiogroup semantics (role, roving tabIndex, arrows, wrap, label-in-name)                 | COMPLETE                       | None found; fully spec-covered for the success path.                                                                                                                                      |
| Left/Right direction-aware, Up/Down direction-independent                                                  | COMPLETE                       | Verified in both `en` and `ar` describe blocks of `language-switch.spec.ts`.                                                                                                              |
| Failed `setLanguage` keeps `aria-checked` honest                                                           | PARTIAL                        | True by inspection of `I18nService`; not proven by a test in this batch.                                                                                                                  |
| Per-option `lang`/`dir`                                                                                    | COMPLETE                       | `language-switch.spec.ts:99-102`.                                                                                                                                                         |
| `collapsedGroups` re-keyed by index, survives a language switch                                            | COMPLETE (for today's callers) | Index-keying is fragile against a future mid-array reshape; see Failure modes #1.                                                                                                         |
| Chevron `rtl:rotate-90` alongside `-rotate-90` (N22)                                                       | COMPLETE                       | `panel-layout.spec.ts:168-177` asserts both classes.                                                                                                                                      |
| panel-ui never translates incoming `title`/nav labels                                                      | COMPLETE                       | Verified by grep; only `panelUi.*` chrome keys are translated.                                                                                                                            |
| Selection-toolbar / thread-row plural English output unchanged                                             | COMPLETE                       | Verified byte-for-byte for counts 0/1/2/n by hand; see Q3 for the drift risk this creates going forward.                                                                                  |
| `stat-tile` formatting follows active locale                                                               | COMPLETE, but see note         | This is a NEW formatting site, not a converted pre-existing one — task-description 5's "already formats" framing does not literally cover it; plan-sanctioned and well-tested regardless. |
| `itemNoun`/empty-state `message`/`detailDrawer` `title` input type changes (`string \| null`) and defaults | COMPLETE                       | Defaults match the exact prior hardcoded English strings (`'item'`, `'Nothing here yet.'`, `'Details'`) — verified against `en.json`.                                                     |
| `i18n-check` exits 0 for `panelUi`                                                                         | COMPLETE                       | Confirmed by direct run; 22 keys, full `en`/`ar` parity, placeholder parity.                                                                                                              |

Implicit requirements not addressed: none beyond what is captured above as gaps.

## Edge cases

| Case                                                             | Handled                                      | How                                                                                        | Concern                                                           |
| ---------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Failed `setLanguage` during an arrow-key switch                  | PARTIAL                                      | State (`aria-checked`) stays honest by construction                                        | Focus timing and the whole path are untested (Failure modes #2)   |
| Rapid double arrow-press before the first switch settles         | YES                                          | `latestRequest` counter in `I18nService`                                                   | None; verified by code inspection, not a dedicated race spec here |
| `StatTile.value` = `NaN`/`Infinity`                              | YES (inherits prior behaviour)               | `Intl.NumberFormat` renders locale "NaN"/"∞", same uninterpreted-ness as old `String(raw)` | No caller currently can produce these values                      |
| `selectionToolbar`/`threadRow` count = 0                         | YES                                          | Verified byte-identical English to pre-batch ("0 items selected", toolbar hidden at 0)     | None                                                              |
| Nav group appended at runtime (`entitled()`/`isAdmin()` toggles) | YES (today)                                  | Always `flat: true`, always appended last, never touches `collapsedGroups`'s index space   | Not enforced — see Failure modes #1                               |
| `detail-drawer` open/close in RTL                                | LIKELY YES, unverified in this batch's specs | Same Tailwind `:where()`-zero-specificity technique already N22-verified for the chevron   | No dedicated spec assertion (Minor-5)                             |
| Consumer components that never pass `message`/`itemNoun`/`title` | YES                                          | New `null` defaults resolve to the exact prior hardcoded English via `?? transloco`        | None; verified against `en.json` literal values                   |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the `collapsedGroups` index-keying scheme (Failure modes #1) is correct only because of an
  unenforced, unwritten contract shared across three files (`panel-layout.ts`, `admin-nav.config.ts`,
  `member-nav.config.ts`) that any conditionally-appended nav group must be `flat: true` and appended
  strictly last — a future change to any one of those three files, made without knowledge of the other
  two, would silently misattribute a user's collapse state to the wrong group.
- What a robust implementation would add: (1) a spec that stubs a rejecting `I18nService.setLanguage` and
  asserts `LanguageSwitch`'s `aria-checked`/focus state, closing the one review-focus item this batch left
  unverified; (2) either a stable-id key for `collapsedGroups` or an explicit runtime/dev-mode assertion of
  the append-only-flat-only nav-group contract; (3) a dedicated `detail-drawer` spec asserting the RTL
  close-offset class pairing, matching the coverage `panel-layout.spec.ts` already gives the chevron; (4) a
  one-line note (in the copy-review doc or a code comment) flagging `stat-tile`'s new thousands-separator
  as a deliberate, reviewed English-visible change, so it is not mistaken for scope creep by a later
  reviewer who diffs against `task-description.md`'s literal "already formats" wording.

## Batch 12 — round 2

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 8/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 2              |

### Scope examined

Rework of round 1's findings. Read in full against the current diff: `panel-layout.ts` (new `navGroups`
JSDoc contract) and `panel-layout.spec.ts` (new "trailing flat group toggled across en→ar→en" test);
`language-switch.ts` (`apply()` rewritten to `await`/try-catch, `restoreFocus()`) and
`language-switch.spec.ts`'s three new failure-path tests; the new `libs/web/panel-ui/src/lib/i18n/
plural.ts` + `plural.spec.ts`; `selection-toolbar.ts`/`.html` and `thread-row.ts`/`.html`'s move to
`pluralCategory`/`*_I18N_KEYS` constants; `detail-drawer.spec.ts`'s new RTL-anchoring test; `stat-tile.html`
and `navigation.component.ts`/`.spec.ts`'s icon-wrapper fix (moving `rtl:scale-x-[-1]` off `lucide-angular`
onto a plain `<span>`); `admin-layout.html` and `member-layout.html`'s topbar email span. Cross-checked
`node_modules/lucide-angular/esm2020/lib/lucide-angular.component.mjs` directly to verify the "host classes
copied onto the inner `<svg>`" claim behind the icon-wrapper fix, and `tools/i18n-check/src/lib/ts-keys.ts`
to verify `*_I18N_KEYS`-suffixed constants (and aliases of them) are a first-class, pre-existing key source
for the AST scanner — not something this batch invented an exception for.

Verification run and evidence: `nx run-many -t test,i18n-check -p web-panel-ui web-ui --skip-nx-cache` →
all 4 tasks green (`web-panel-ui` Jest: 9 suites / **80** tests, up from 64 in round 1; `web-ui` Jest: 5
suites / 41 tests; both `i18n-check` OK); `nx run-many -t test -p web-members web-admin --skip-nx-cache` →
both green. Did not rebuild `dist` (visual reviewer owns that in parallel, per this round's own
instruction).

### Round-1 findings: disposition

- **Moderate-1** (`collapsedGroups` index-keying, no enforced invariant) — **RESOLVED.**
  `panel-layout.ts:88-103`'s new JSDoc states the exact contract (order stable while mounted; a conditional
  group must be appended at the end and be `flat`) and, correctly, does NOT claim "every flat group is
  last" (`MEMBER_NAV_GROUPS` has flat groups at index 0 and mid-array) — it only constrains where a
  _conditionally appended_ group may go. `panel-layout.spec.ts:52-66,196-223` adds a dedicated test that
  toggles the trailing flat group off and back on across an `en`→`ar`→`en` switch and asserts the other
  groups' collapse state is untouched throughout. The mechanism is still index-based (a future violation of
  the documented contract would still misattribute state silently), but the contract is now written down
  and defended by a test, which is what round 1 asked for.
- **Moderate-2** (`LanguageSwitch` failed-`setLanguage` path unverified) — **RESOLVED.**
  `apply()` (`language-switch.ts:117-127`) now `await`s `setLanguage` inside `try`/`catch`, logs once with
  the repo's `// degradation-audit: reported` marker, and calls `restoreFocus()` — which, correctly, only
  moves focus if it is still inside the group (`language-switch.ts:164-170`: `host.contains(activeElement)`
  guard), so a user who has already tabbed away is left alone. Three new specs
  (`language-switch.spec.ts:164-204`) cover a rejected `setLanguage` via arrow key, a `false`-resolving
  `setLanguage`, and a rejected `setLanguage` via click — each asserting `aria-checked`, `tabIndex`, and
  `document.activeElement` all stay on `en`, `console.error` fires exactly once, and nothing reaches
  `process`'s `unhandledRejection` listener. I traced the "catch removed → 2/3 fail" mutation claim by
  reasoning through the code rather than re-running a mutated build (read-only on source per this round's
  instruction): removing the `try`/`catch` would make `apply()`'s own promise reject on
  `mockRejectedValue`, which both `console.error`-asserting tests use, so they would fail (no log call, and
  the rejection would reach the process listener the test explicitly watches for) — the third test
  (`mockResolvedValue(false)`) does not reject and would still pass. That is exactly 2 of 3, matching the
  claim.
- **Moderate-4** (duplicated plural ternaries) — **RESOLVED.** New `plural.ts` centralises the split:
  `pluralCategory(count) => count === 1 ? 'one' : 'other'` is byte-identical to the old `count === 1 ? X :
Y` ternary for every boundary the round-2 spec (`plural.spec.ts:4-10`) exercises, **including the two the
  coordinator specifically asked about**: `1.5 === 1` is `false` in both the old and new code (→ "other" /
  the old plural branch), and `-1 === 1` is likewise `false` in both (→ "other"). No behavioural difference
  for either value; both were already treated as "not exactly one" before this batch. `selection-toolbar.ts`
  and `thread-row.ts` now consume it via `{ one, other } as const satisfies PluralI18nKeys` constants named
  `*_I18N_KEYS`, which I confirmed against `tools/i18n-check/src/lib/ts-keys.ts:24` (`KEY_CONST_NAME =
/(I18N_KEYS|I18nKeys)$/`) is an existing, general key-source the AST scanner already recognises (and
  recognises aliases of, e.g. `protected readonly countI18nKeys = SELECTION_COUNT_I18N_KEYS`) — this is not
  a new carve-out invented for this batch, so a typo'd key inside one of these constants fails `i18n-check`
  as an ordinary unknown-key violation, exactly as the coordinator's message states. The `<!-- i18n-keys:
... -->` marker comments the round-1 diff needed are correctly removed now that the constants themselves
  are the source of truth.
- **Minor-5** (`detail-drawer` RTL pairing untested) — **RESOLVED.** New test
  `detail-drawer.spec.ts:129-150` asserts `end-0`/`border-s` are present and `right-0`/`border-l` are
  absent, that `translate-x-full` + `rtl:-translate-x-full` are both present while closed and both absent
  while open, and that `translate-x-0` appears only when open.
- **Minor-6** (focus-timing on a failed switch, unverified) — **RESOLVED** as part of Moderate-2 above;
  `restoreFocus()`'s "only if focus is still in the group" guard directly answers the "race if the user
  moved focus away" question the coordinator raised, and I traced the "stale apply after a newer apply"
  case (two rapid presses, the earlier one resolving `false` after `I18nService`'s own `latestRequest`
  guard supersedes it) by hand: `restoreFocus()` reads `this.i18n.lang()` live at the moment it runs, never
  a value captured at call time, so even a stale `apply()`'s late-resolving `restoreFocus()` call re-focuses
  whatever language is _actually_ current at that moment — which, with exactly two supported languages, is
  always either already correct or a harmless redundant `.focus()` on the element that already has focus.
  I did not find a scenario (with the current 2-language `SUPPORTED_LANGS`) where this produces a wrong
  focus target; not independently re-tested by a dedicated race spec, but the existing three failure specs
  plus the `latestRequest` guard (verified again this round in `i18n.service.ts:103-115`) together cover
  it.
- **Moderate-3** (`stat-tile`'s new `Intl.NumberFormat` formatting, no Preserve-list-style callout) —
  **NOT ADDRESSED**, carried forward. Round 2 did not touch this; it remains a deliberate, well-tested,
  plan-sanctioned (`implementation-plan.md:648`) change with no dedicated sign-off trail. Restated below,
  downgraded to informational since round 1 already judged it correctly implemented and not a defect.

### New findings this round

#### Serious: `[title]="email"` dropped from both panel topbar spans

The plan is explicit and cites an exact precedent: `implementation-plan.md:664` (Component 14) specifies
`member-layout.html:24` and `admin-layout.html:22` as `<span class="font-mono text-xs ltr-island truncate
max-w-[7rem] sm:max-w-none" [title]="email">{{ email }}</span>` — "N23: `[title]` added, matching the
sidebar precedent at `member-layout.html:48`". The implementation applied every class listed
(`ltr-island truncate max-w-[7rem] sm:max-w-none`) but the `[title]="email"` binding is missing from both
sites:

- `libs/web/admin/src/lib/admin-layout/admin-layout.html:21-24`
- `libs/web/members/src/lib/member-layout/member-layout.html:23-26`

The in-file precedent the plan cites is present and correct one file over —
`member-layout.html:51` (`<p class="mt-1 truncate font-mono text-xs text-base-content-muted"
[title]="email">`) — which makes the topbar span's omission look like a copy-paste that dropped one
attribute, not a considered decision. `truncate max-w-[7rem]` is unconditional below the `sm:` breakpoint
(`sm:max-w-none` only lifts it at `sm` and up), so this is not a rare edge case: on any admin or member
session viewed at less than `sm` width, the signed-in email is truncated with **no way to recover the full
address** (no tooltip, and nothing else on the topbar shows it in full). I grepped both layouts' specs
(`admin-layout.spec.ts`, `member-layout.spec.ts` and the notifications-badge sweep spec) for any assertion
on this span's `title` attribute — none exists, so `nx run-many -t test -p web-members web-admin` passing
does not, and cannot, catch this gap.

- Trigger: any admin or member session at a viewport narrower than Tailwind's `sm` breakpoint (or any
  email long enough to overflow `7rem` even above it, since `max-w-[7rem]` only lifts at `sm`).
- Symptom: the topbar shows a truncated, ellipsised email with no way to read the rest — no tooltip, no
  expansion affordance — unlike the functionally identical sidebar-footer email one file away.
- Evidence: `admin-layout.html:21-24`; `member-layout.html:23-26`; contrast `member-layout.html:51`;
  requirement source `implementation-plan.md:664`.
- Current handling: none; not a defect in behaviour that crashes or corrupts anything, but a named,
  specific, cited accessibility/UX requirement silently unmet on the common (not edge-case) narrow-viewport
  path, with zero test coverage to catch it.
- Recommendation: add `[title]="email"` to both spans, exactly as the plan specifies, and add one assertion
  per shell spec so a future edit cannot drop it again silently.

### Judgement on the items the coordinator specifically asked about

- **English plural output, all counts including 1.5 and −1**: byte-identical to before. The old code's
  `===1` ternary and the new `pluralCategory`'s `===1` check are the same test; I confirmed this holds for
  every count the round-2 spec added (`0, 1, 2, 3, 11, 100, 1.5, -1`) by direct comparison, not only by
  reading the implementation.
- **`pluralCategory`'s semantics vs. English**: matches exactly — English has only two grammatical number
  categories (singular at exactly 1, plural otherwise, including 0, fractions, and negatives), and the
  function implements precisely that split, nothing broader (it does not attempt CLDR's `zero`/`two`/`few`/
  `many`, which English does not use).
- **Arabic with only `one`/`other` given Arabic has 6 CLDR plural categories**: architecturally acceptable
  as designed. `plural.ts:11-14`'s own doc comment states the deliberate trade-off — the Arabic drafts word
  the count numerically without grammatical number agreement (e.g. `"الردود: {{ count }}"`, literally "the
  replies: {count}", a construction that doesn't inflect the noun for the count) specifically so the
  2-category `one`/`other` split suffices instead of needing Arabic's `zero`/`two`/`few`/`many`. This is a
  legitimate, common real-world i18n pattern (many production Arabic UIs use "count + generic plural noun"
  rather than full CLDR agreement) and is consistently applied across all three thread-row/selection-toolbar
  pairs. One inconsistency worth a copy-review flag rather than a logic one:
  `selectionToolbar.countOne`/`countOther` in `ar.json` are **byte-identical strings**
  (`"تم تحديد {{ count }} ({{ noun }})"` for both), whereas `threadRow.replyOne`/`replyOther` and
  `unreadOne`/`unreadOther` each use a different Arabic phrasing between the two branches. Both are valid
  under the architecture (the mechanism does not require the two branches to differ), and `i18n-check`
  correctly does not flag it (it checks key existence and placeholder parity, not textual distinctness), so
  this is not a logic defect — but it is an inconsistency in how the "one/other" split was drafted across
  the three key pairs, worth a copy-reviewer's eye rather than mine.
- **M2 focus-timing race (focus moved away; stale apply after a newer apply)**: see "Minor-6 RESOLVED"
  above — both scenarios are handled correctly, the first by the `host.contains(activeElement)` guard, the
  second because `restoreFocus()` always reads the live signal rather than a value closed over at call
  time.
- **`rtl-exempt` marker on `stat-tile.html`'s inner `<lucide-angular>`**: justification verified as
  technically correct, not merely asserted. I worked through the CSS transform composition by hand: with no
  parent flip (LTR), the child's `group-hover:translate-x-0.5` moves it toward reading-end (right) as
  intended. With the parent's `rtl:scale-x-[-1]` active (RTL), the child's own local `+x` translation is
  rendered through the parent's mirrored coordinate frame and manifests on screen as `-x` (leftward) — which
  **is** reading-end in RTL, so the same unmodified `translate-x-0.5` on the child already points the right
  way once composed with the parent flip; adding an `rtl:-translate-x-0.5` variant on the child as well
  would double-apply the mirroring and send the nudge back toward reading-start, which is exactly what the
  comment says and exactly why the exemption (rather than a fix) is correct.
- **Icon-mirroring wrapper fix (`stat-tile.html`, `navigation.component.ts`)**: I read
  `node_modules/lucide-angular/esm2020/lib/lucide-angular.component.mjs` directly.
  `LucideAngularComponent` declares `@Input() class?: string` and its `replaceElement()`
  (`icoElement.classList.add(...this.class.split(...))`) copies that input's value onto the **newly
  created inner `<svg>`** it renders via `ng-content` replacement. Angular assigns a static `class="..."`
  template attribute to a matching `@Input('class')` in addition to leaving it as a literal host-element
  attribute, so a class list on `<lucide-angular class="... rtl:scale-x-[-1]">` lands on both the host
  element and the generated inner `<svg>` — two nested elements each applying `scaleX(-1)`, which compose to
  no net mirroring at all. Moving `rtl:scale-x-[-1]` onto a separate, non-`lucide-angular` wrapper `<span>`
  and leaving the icon's own `class` free of it is the correct fix; confirmed for `navigation.component.ts`
  by `navigation.component.spec.ts:173-201`'s new test, which asserts the wrapper (not `lucide-angular` or
  its inner `<svg>`) carries the class.

### Failure modes

#### Truncated topbar email with no recovery affordance

- Trigger: any admin/member session at less-than-`sm` viewport width, or an unusually long email even
  above it.
- Symptom: the email reads as an ellipsis-truncated fragment with nothing to reveal the rest.
- Evidence: `admin-layout.html:21-24`; `member-layout.html:23-26`.
- Current handling: none.
- Recommendation: see Serious finding above.

#### `collapsedGroups`' index contract remains enforceable only by convention

- Trigger: a future change to either nav config or its owning `computed()` that inserts/removes/reorders a
  non-flat group anywhere but appending one flat group at the end.
- Symptom: silent collapse-state misattribution (unchanged from round 1's analysis).
- Evidence: `panel-layout.ts:88-103` (contract now documented); no runtime/dev-mode assertion enforces it.
- Current handling: a JSDoc contract and one regression spec
  (`panel-layout.spec.ts:196-223`) that would catch a violation IF it reshapes the array the same way the
  test does (trailing flat group toggling), but would not catch a violation that inserts a non-flat group
  mid-array, since no test constructs that scenario.
- Recommendation: unchanged from round 1 — a stable-id key would remove the risk entirely; the documented
  contract plus one spec is a reasonable, proportionate mitigation for what round 1 flagged, not a full
  closure of the underlying fragility.

## Blocking issues

None found.

## Serious issues

### `[title]="email"` missing from both panel topbar email spans

- File: `libs/web/admin/src/lib/admin-layout/admin-layout.html:21-24`;
  `libs/web/members/src/lib/member-layout/member-layout.html:23-26`
- Scenario: any session viewed narrower than Tailwind's `sm` breakpoint (the truncation's unconditional
  range), or with an email that overflows `7rem` even above it.
- Impact: the user (an admin or member) cannot recover their own truncated email address anywhere in the
  topbar; the functionally identical sidebar-footer instance one file away does not have this problem
  because it kept its `[title]`.
- Fix: add `[title]="email"` to both spans, exactly as `implementation-plan.md:664` specifies, and add one
  spec assertion per shell so a regression is caught.

## Moderate and minor issues

1. **Moderate** (carried forward, unaddressed) — `stat-tile.ts`'s `Intl.NumberFormat` is new formatting
   introduced without the Preserve-list-style evidentiary trail other verbatim-English guarantees get; not
   a defect, informational. `stat-tile.ts:80-88`.
2. **Moderate** (partially mitigated) — `collapsedGroups` index-keying's correctness still depends on an
   unenforced (though now documented and partially spec-tested) convention across three files; see Failure
   modes. `panel-layout.ts:88-103`.
3. **Minor** — Arabic `selectionToolbar.countOne`/`countOther` are byte-identical strings while the
   equivalent `threadRow` pairs are drafted distinctly; a copy-consistency question, not a logic defect.
   `libs/web/panel-ui/src/lib/i18n/ar.json` (`selectionToolbar.countOne`/`countOther`).

## Data flow

Unchanged from round 1 except where noted:

1-4. Arrow-key / click → `apply()` → `I18nService.setLanguage` (now correctly awaited, try/caught) → OK,
now verified for both the success and failure paths. 5. `PanelLayout`'s translated-label rule → OK, unchanged, re-verified. 6. `collapsedGroups` keyed by `$index` → OK for the append-only-flat-only reshape, now with a regression
spec; still fragile against an undocumented-in-code (documented-in-JSDoc) contract violation. 7. `StatTile.value()` → `Intl.NumberFormat` → OK, unchanged from round 1's analysis. 8. **New**: `count`/`unreadCount`/`replyCount` → `pluralCategory(n)` → `{one,other}I18nKeys[category]` →
`transloco` → OK, byte-identical English to both the pre-batch code and round 1's inline ternaries,
verified for the full boundary set including `1.5` and `-1`. 9. **New**: `currentEmail()` → topbar `<span>` → OK for display, GAP for full-value recovery when
truncated (no `[title]`) — see Serious issue.

## Requirements fulfilment

| Requirement                                                                            | Status   | Gap                                                                                                     |
| -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `navGroups` collapse-state contract documented and spec-defended                       | COMPLETE | Documented and tested for the one reshape pattern both real shells use; still index-based underneath.   |
| Failed `setLanguage` keeps `aria-checked`/focus honest                                 | COMPLETE | Three specs plus a traced mutation-testing claim; round 1's gap fully closed.                           |
| Plural English output byte-identical, including 1.5 and −1                             | COMPLETE | Verified directly.                                                                                      |
| `i18n-keys` validated via `*_I18N_KEYS` constants instead of comments                  | COMPLETE | Verified against the scanner's own recognised pattern (`ts-keys.ts:24`), not a new exception.           |
| Detail-drawer RTL anchoring/offset pairing tested                                      | COMPLETE | `detail-drawer.spec.ts:129-150`.                                                                        |
| Icon mirroring wrapper (stat-tile, navigation) correctly avoids the double-flip cancel | COMPLETE | Verified against `lucide-angular`'s own source; spec-covered for `navigation.component.ts`.             |
| B7 email truncation + N23 `[title]` (implementation-plan.md:664)                       | PARTIAL  | Truncation classes present; `[title]="email"` missing on both shells' topbar spans — see Serious issue. |

Implicit requirements not addressed: none beyond what is captured above.

## Edge cases

| Case                                                             | Handled | How                                                                          | Concern                                                                |
| ---------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Failed `setLanguage` via arrow key / click / `false` resolution  | YES     | `apply()`'s try/catch + `restoreFocus()`'s in-group guard                    | None; fully spec-covered this round                                    |
| Rapid double switch, stale `apply()` resolving after a newer one | YES     | `restoreFocus()` reads the live `i18n.lang()` signal, never a captured value | None, given exactly 2 supported languages                              |
| Plural count 0, 1, 2, 11, 1.5, −1                                | YES     | `pluralCategory`, verified byte-identical to pre-batch English for all       | None                                                                   |
| Nav group appended/removed at runtime (trailing, flat)           | YES     | New dedicated spec across a language switch                                  | Only this exact reshape pattern is covered; a mid-array reshape is not |
| Topbar email longer than `7rem` on a narrow viewport             | NO      | Truncated with no recovery                                                   | Serious issue above                                                    |
| Icon RTL mirror + hover nudge composing correctly                | YES     | Verified by hand (CSS transform composition) and by the navigation spec      | None                                                                   |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the missing `[title]="email"` on both panel topbar spans is a small, mechanical, one-line-per-file
  fix, but it is a plan-cited, explicitly named requirement that shipped silently unmet with no test to
  catch it — exactly the kind of small drift that compounds if it goes uncorrected.
- What a robust implementation would add: (1) `[title]="email"` on both spans, plus one spec assertion per
  shell; (2) optionally, a stable-id key for `collapsedGroups` rather than index+documented-convention,
  though the current mitigation is proportionate to round 1's finding; (3) a copy-review note on the
  `selectionToolbar` Arabic `one`/`other` byte-identity versus `threadRow`'s distinct phrasing, so it is a
  deliberate choice rather than an oversight.

## Batch 12 — round 3 (final)

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 0 new    |

### Scope examined

A narrow recheck of round 2's one Serious finding. Confirmed via `git diff` that this round touches
exactly four files and nothing else: `libs/web/admin/src/lib/admin-layout/admin-layout.html`,
`libs/web/members/src/lib/member-layout/member-layout.html`, and one new test each in
`admin-nav-member-link.spec.ts` / `member-nav-admin-link.spec.ts`. Every other file in the working tree is
byte-identical to what round 2 reviewed (`git status` lists the same file set as round 2, with these two
`.html` files and two `.spec.ts` files as the only entries whose content changed).

### Fix verified

Both spans now read exactly as `implementation-plan.md:664` specifies:

```html
<span class="font-mono text-xs ltr-island truncate max-w-[7rem] sm:max-w-none" [title]="email">{{ email }}</span>
```

— `admin-layout.html:21-25`, `member-layout.html:23-27`. This closes round 2's Serious finding exactly as
recommended: the class list is unchanged from round 2 (already correct), and only the missing `[title]`
binding was added.

Each shell gained one new spec (`admin-nav-member-link.spec.ts`, `member-nav-admin-link.spec.ts`, both
titled `'gives the truncated top-bar email its full address as a title (N23)'`) that: sets a long email
directly on the component's private `currentEmail` signal via a typed unknown-cast (bypassing the
`AuthService` subscription the component normally populates it from — a reasonable, minimal way to drive a
signal the spec doesn't otherwise control), re-renders, and asserts against
`header .font-mono.truncate` — a selector scoped to `<header>`, which correctly excludes the pre-existing,
already-`[title]`'d sidebar-footer email `<p>` one file away (`member-layout.html:51`, outside `<header>`)
so the two cannot be confused — that both `textContent.trim()` and the `title` attribute equal the full
email. I traced the "mutation check fails without the binding" claim: removing `[title]="email"` makes
`getAttribute('title')` return `null`, which fails the `toBe(email)` assertion in both new tests; the fix
is exactly the minimum needed to make them pass, so the tests are not vacuously true.

Verification run and evidence: `nx run-many -t test -p web-members web-admin --skip-nx-cache` → both green
(`web-admin`: 25 suites / 305 tests; `web-members`: 46 suites / 937 tests — all passing, including the two
new N23 tests). `nx run-many -t lint,typecheck -p web-members web-admin --skip-nx-cache` → all four green,
corroborating the executor's "lint/typecheck pass, SonarJS 0" claim for the touched projects.

### Batch 12 final disposition

All three rounds' findings are now resolved or stand as documented, non-blocking residue:

- Round 1: Moderate-1/2/4 and Minor-5/6 — RESOLVED in round 2 (contract + spec for nav-group collapse;
  awaited/try-caught `setLanguage` with three failure-path specs; shared `pluralCategory` helper; RTL
  anchoring spec; focus-race tracing). Moderate-3 (`stat-tile`'s new `Intl.NumberFormat`, no Preserve-list
  callout) stands as informational — correctly implemented, plan-sanctioned, well-tested, just without the
  same evidentiary trail other verbatim-English guarantees in this task got elsewhere.
- Round 2: the one Serious finding (`[title]="email"` missing on both topbar spans) — RESOLVED this round,
  verified by direct inspection of the diff and by two new, non-vacuous specs. The two Moderate items
  carried into round 2 (nav-index-keying's convention-only enforcement; the Arabic
  `selectionToolbar.countOne`/`countOther` byte-identity, a copy-consistency question) remain as
  documented, non-blocking residue — neither is a logic defect, both were already downgraded to
  informational/copy-review scope in round 2's verdict.
- Round 3: no new findings. The fix is minimal, correctly scoped (touches only the four files it needed
  to), matches the plan's exact cited markup, and is defended by tests that would fail without it.

## Blocking issues

None found (final).

## Serious issues

None (round 2's finding is resolved — see above).

## Verdict (Batch 12, final)

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The only residue is the two informational Moderate items carried from round
  2 — `stat-tile`'s new (rather than converted) formatting site, and the nav-group collapse contract's
  reliance on a documented convention rather than a structurally-enforced stable-id key — neither of which
  is a defect in what this batch shipped.
- What a robust implementation would add (non-blocking, for a future batch): (1) a stable-id key for
  `collapsedGroups` if `panel-ui` ever needs to support a nav reshape beyond "append one flat group at the
  end"; (2) a copy-review pass confirming the `selectionToolbar` Arabic `one`/`other` identity is
  deliberate.

## Batch 13

Files reviewed in full: `apps/ptah-landing-page/src/app/pages/download/download-page.component.ts`,
`apps/ptah-landing-page/src/app/pages/download/download-page.component.spec.ts` (new),
`apps/ptah-landing-page/src/app/i18n/{en,ar}.json`, `apps/ptah-landing-page/project.json`,
`apps/ptah-landing-page/src/styles.css`, `copy-review/app.md`. Also read for context (unmodified this
batch, to check what the diff plugs into): `libs/frontend/i18n/src/lib/{i18n.service.ts,lang.config.ts}`,
`libs/web/core/src/lib/services/github-release.service.ts`, `libs/web/core/src/lib/i18n/en.json`,
`apps/ptah-landing-page/prerender-baseline/download.json`.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 1              |

### Five logic questions

**1. How does this fail silently?** It does not fail silently — the one defect found (Serious-1 below)
fails _loudly_ (an uncaught `RangeError`) rather than silently, which is itself the problem: the
pre-existing code degraded a bad date to visible "Invalid Date" text, the new code throws. No other
silent-failure path was found: the loading/error/success branches are exhaustive (`@if/@else if/@else`),
`retry()` re-invokes `fetchReleases()` which resets `error` and `loading` before the request
(`github-release.service.ts:49-50`), and the `I18nMessage` path for the release error
(`download-page.component.ts:87-88`) is untouched by this batch and still renders the real GitHub error key.

**2. What user action produces unexpected behaviour?** Switching language while the download route is
open: `formatDate()` (`download-page.component.ts:479-481`) is a plain method called from the template, not
a direct signal read, so its output only refreshes when _something else_ forces change detection. In this
zone.js app that happens in practice (Transloco's `setActiveLang`/HTTP loads run through zone-patched
async), and the same `computed(() => ... this.i18n.intlLocale())` pattern is used and _explicitly tested
across a live switch_ in `libs/web/ui/src/lib/session-calendar/session-calendar.spec.ts:109-139` and
`libs/web/panel-ui/src/lib/stat-tile/stat-tile.spec.ts:52`. This batch's own spec never exercises that path
(see Moderate-1) — it renders two separate `TestBed` instances in `'en'` and `'ar'` rather than calling
`i18n.setLanguage()` on one, so a regression here would not be caught by this batch's tests.

**3. What input data produces a wrong answer?** `release.publishedAt` reaching `formatDate()` as anything
`new Date()` cannot parse (empty string, `null` coerced to a string by a schema drift, a non-ISO format)
now throws instead of rendering "Invalid Date" (Serious-1). Separately, Arabic asset labels/sizes and the
version string are correctly kept in `.ltr-island` spans (confirmed by the spec's
`islands` assertion at `download-page.component.spec.ts:177-180`), so no digit- or symbol-reversal wrong
answer was found there.

**4. What happens when a dependency fails?** `GitHubReleaseService.fetchReleases` (unchanged this batch)
already turns a 403 into `core.releases.rateLimited` and anything else into `core.releases.loadFailed`
(`github-release.service.ts:61-67`), and the component renders that via the `I18nMessage` pipe with the
`i18n-keys: core.releases.*` marker intact (`download-page.component.ts:87-88`) — this path was verified
unchanged and still correct. What was _not_ covered before and is now more exposed: the GitHub API
response shape is consumed with no runtime validation (`parseRelease` at `github-release.service.ts:73-84`
trusts `release.published_at` is a valid ISO string) — see Serious-1, which is the concrete symptom of this
unvalidated boundary.

**5. What is missing that the requirements never mentioned?** A test asserting the date format actually
recomputes when `i18n.setLanguage()` is called on a live component instance, matching how the two other
consumers of this exact pattern (`session-calendar`, `stat-tile`) are tested (Moderate-1). Also missing:
this review did not independently run `prerender-check` (it rebuilds `dist/`, which the task brief reserves
for the parallel visual reviewer), so the claim in the new code comment at
`download-page.component.ts:76-78` — that the inner `<span>` around the loading text is needed to keep the
prerendered output byte-identical — rests on reading the baseline JSON and Angular's default
whitespace-collapsing behaviour, not a fresh build (Moderate-2).

### Failure modes

#### Uncaught `RangeError` on a malformed release date

- Trigger: `release.publishedAt` is a string `new Date()` cannot parse into a valid timestamp (empty
  string, `null`/`undefined` surfacing as `"null"` through a JSON/typing drift, a GitHub API field rename,
  or a stubbed/test double that doesn't match the real shape).
- Symptom: `Intl.DateTimeFormat.prototype.format()` throws `RangeError: Invalid time value` from inside the
  template's interpolation of `formatDate(release.publishedAt)`. This surfaces as an uncaught exception
  during change detection for that release row — worse than the previous behaviour, which rendered the
  literal string `"Invalid Date"` and kept the rest of the page working.
- Evidence: `apps/ptah-landing-page/src/app/pages/download/download-page.component.ts:479-481`
  (`return this.dateFormat().format(new Date(isoDate));`); confirmed by direct execution —
  `new Intl.DateTimeFormat('en-US').format(new Date('not-a-date'))` throws `RangeError: Invalid time value`,
  while `new Date('not-a-date').toLocaleDateString('en-US')` (the old code, git-diff above) returns the
  string `"Invalid Date"` without throwing. Upstream, `publishedAt` is assigned straight from the untyped
  HTTP response with no validation: `libs/web/core/src/lib/services/github-release.service.ts:82`
  (`publishedAt: release.published_at`) inside `parseRelease` (`:73-84`), which is called directly on the
  raw `HttpClient.get<GitHubRelease[]>` payload (`:52-59`) with no runtime shape check.
- Current handling: none. No try/catch around `formatDate()`, no validation in `parseRelease`, and no spec
  in `download-page.component.spec.ts` exercises a release with a malformed `publishedAt` (`RELEASE` at
  `:55-71` uses a valid ISO string).
- Recommendation: either validate/guard in `formatDate()` (fall back to the raw string or a fixed message
  when `Number.isNaN(new Date(isoDate).getTime())`, matching the old degrade-gracefully behaviour) or
  validate `published_at` at the `GitHubReleaseService` boundary and route a shape mismatch through the
  existing `I18nMessage` error path instead of the success path. This is scoped to `GitHubReleaseService`,
  a file this batch did not touch, so the minimal in-scope fix is the guard inside `formatDate()`.

### Blocking issues

None.

### Serious issues

#### 1. `formatDate()` throws instead of degrading on invalid dates

- File: `apps/ptah-landing-page/src/app/pages/download/download-page.component.ts:479-481`
- Scenario: any `release.publishedAt` that is not a value `new Date()` can parse (see Failure modes above);
  in production this depends entirely on GitHub always returning well-formed `published_at`, which is
  external, unvalidated input.
- Impact: a single malformed release entry can throw during that row's change detection instead of showing
  degraded text, a regression from the pre-existing `toLocaleDateString('en-US', …)` call this batch
  replaced, which never threw. On a prerendered/hydrated route this risks a broken hydration or a console
  error surfaced to every visitor for that release, not just a cosmetic date.
- Fix: guard `formatDate()` against an invalid parsed date (see Failure-mode recommendation above) before
  handing it to `Intl.DateTimeFormat.prototype.format`.

### Moderate and minor issues

1. **Moderate — reactive-switch path untested.** `download-page.component.spec.ts` never calls
   `TestBed.inject(I18nService).setLanguage(...)` on a live instance to assert the rendered date actually
   re-renders after a switch, unlike the two other consumers of the identical `intlLocale()`-inside-`computed`
   pattern (`libs/web/ui/src/lib/session-calendar/session-calendar.spec.ts:109-139`,
   `libs/web/panel-ui/src/lib/stat-tile/stat-tile.spec.ts:52`). By code inspection the implementation
   (`download-page.component.ts:470-477`) matches that pattern and should behave the same way, but this
   batch's tests would not catch a regression in it (e.g. an accidental non-reactive cache).
2. **Moderate — prerender parity not independently rebuilt.** The claim in
   `download-page.component.ts:76-78` that the inner `<span>` is needed to keep the prerendered loading text
   byte-identical to `apps/ptah-landing-page/prerender-baseline/download.json` was checked by reading the
   baseline (`"...Loading releases...Ptah..."`, no separator, matching the pre-existing text verbatim) and
   by reasoning about Angular's default insignificant-whitespace collapsing, not by running
   `nx run ptah-landing-page:prerender-check` (deliberately skipped per this review's scope, to avoid
   rebuilding `dist/` while the visual reviewer runs in parallel). This should be confirmed once the visual
   reviewer's build (or a dedicated `prerender-check` run) is available.
3. Minor — `macOS`/`Windows`/`Linux` column headings
   (`download-page.component.ts:175-176,220-221,267-268`) remain hardcoded English literals, not translated
   keys. This is consistent with treating OS names as proper nouns (same treatment as "Ptah"/"VS Code"
   elsewhere) and is not in this batch's task list, so it is not a defect — noted only for completeness.

### Data flow

1. `constructor()` sets SEO keys, injects `DestroyRef`, and calls `afterNextRender(...)` — OK, standard
   Angular lifecycle hook usage; `destroyRef.onDestroy(() => clearInterval(checkExpand))` is registered
   inside the callback and closes over the correct `checkExpand` handle
   (`download-page.component.ts:421-436`).
2. `afterNextRender` callback calls `fetchReleases(3)` then starts a 100ms poll for the first release to
   auto-expand — OK for the new cleanup requirement: the interval is now cleared on (a) auto-expand applied,
   (b) `loading()` false, or (c) component destroy. Pre-existing gap, not introduced or fixed by this
   batch: if `loading()` never becomes `false` and no release ever arrives (a hung request with no
   `next`/`error` emission), the interval polls every 100ms for the component's lifetime — bounded by (c)
   but not by (a)/(b). Out of scope for this batch (the task asked only to add `DestroyRef` cleanup, which
   is present and correct).
3. `GitHubReleaseService.fetchReleases` → HTTP GET → `parseRelease` maps each raw release to `ParsedRelease`
   — OK for existing keys, but `publishedAt` is passed through unvalidated (see Serious-1); this batch
   newly exposes that gap because the new formatter is intolerant of it.
4. `dateFormat` computed reads `this.i18n.intlLocale()` and builds `new Intl.DateTimeFormat(...)` — OK,
   `INTL_LOCALE.ar === 'ar-u-nu-latn'` (`lang.config.ts:38-41`) confirmed to keep Western digits, and
   `INTL_LOCALE.en === 'en-US'` matches the exact locale the old `toLocaleDateString('en-US', …)` call
   used, so the formatted _output_ is unchanged for valid dates — verified by the spec's exact-string
   assertion (`download-page.component.spec.ts:148-159`, `'Version v1.4.0 Latest Mar 5, 2026'`).
5. `formatDate()` calls `.format(new Date(isoDate))` — gap: throws on invalid input (Serious-1).
6. Template renders `formatDate(release.publishedAt)` inside a plain-text span, not `.ltr-island` — OK,
   correct: a localized date (Arabic month name, Western digits) should follow document direction, unlike
   the version/asset-label/size spans, which are correctly `.ltr-island` (verified by the spec's `islands`
   assertion, `download-page.component.spec.ts:177-180`).
7. `error()` truthy branch renders `{{ msg.key | transloco: msg.params }}` with the `i18n-keys: core.releases.*`
   marker — OK, unchanged this batch, verified by the spec's Arabic-agnostic English-error test
   (`download-page.component.spec.ts:134-146`) and by reading `github-release.service.ts:61-67` and
   `libs/web/core/src/lib/i18n/en.json:18-21` directly.
8. `i18n-check` (`apps/ptah-landing-page/project.json`) and `review-tables --check` both run clean against
   the new `app` scope — verified by running
   `node_modules/.bin/nx run-many -t test,i18n-check -p ptah-landing-page --skip-nx-cache` (both green,
   92/92 tests across 8 suites) and
   `ts-node .../review-tables.ts --project-root apps/ptah-landing-page --scope app --glossary tools/i18n-check/glossary.json --out .ptah/specs/TASK_2026_575_fee7/copy-review --check` (`review-tables [app]: OK`).

### Requirements fulfilment

| Requirement                                                                      | Status   | Gap                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| English verbatim in `en.json` for every literal this batch replaced              | COMPLETE | `git diff` shows every removed literal (`Downloads`, `Loading releases...`, `Try Again`, `Version`, `Latest`, `No {macOS,Windows,Linux} builds`, `View release notes`, `Looking for the VS Code Extension?`, body, `VS Code Marketplace`) reproduced byte-for-byte as the matching `en.json` value. |
| Release date via `intlLocale()` inside a computed, SSG output unchanged for `en` | PARTIAL  | Output is unchanged for valid dates (verified); throws instead of degrading for an invalid/unparsable date (Serious-1).                                                                                                                                                                             |
| Reactive on language switch                                                      | PARTIAL  | Implementation matches the codebase's proven pattern by inspection, but this batch adds no test that exercises a live switch (Moderate-1).                                                                                                                                                          |
| Western digits in Arabic                                                         | COMPLETE | `INTL_LOCALE.ar = 'ar-u-nu-latn'`; asserted directly in the spec (`.not.toMatch(/[٠-٩]/)`).                                                                                                                                                                                                         |
| SSR-safe                                                                         | COMPLETE | `Intl.DateTimeFormat`/`Date` are standard, available on the server; no browser-only API introduced.                                                                                                                                                                                                 |
| `sm:text-left` → logical                                                         | COMPLETE | `sm:text-start` at `download-page.component.ts:342`.                                                                                                                                                                                                                                                |
| Release error via `I18nMessage`, `i18n-keys: core.*` marker intact               | COMPLETE | Unchanged, marker present at `:87`.                                                                                                                                                                                                                                                                 |
| `.ltr-island` placements for versions/labels/sizes                               | COMPLETE | Version, asset label, asset size all islanded; date correctly left un-islanded (see Data flow #6).                                                                                                                                                                                                  |
| `md:rtl:divide-x-reverse` / `rtl:bg-gradient-to-l` pairing                       | COMPLETE | Both paired with their physical base class and directly asserted in the spec.                                                                                                                                                                                                                       |
| App `i18n-check` target, `--allow-scope ui,core`, inputs                         | COMPLETE | Matches the `web-core` target's inputs shape one-for-one; exits 0 (verified).                                                                                                                                                                                                                       |
| `VS Code Marketplace` keyed                                                      | COMPLETE | `app.download.vsCode.cta`, glossary-flagged for "VS Code" in `copy-review/app.md`.                                                                                                                                                                                                                  |

Implicit requirements not addressed: graceful handling of a malformed `publishedAt` from the GitHub API
(Serious-1) — never stated as an acceptance criterion, but the pre-existing code already handled it and this
batch silently drops that handling.

### Edge cases

| Case                                                   | Handled                                | How                                                                                                                            | Concern                                                                                                       |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Empty `releases()` with `loading()` false, no error    | Partial                                | `@for (...) { } @empty {}` blocks exist per-platform, but the top-level list itself has no empty state if the API returns `[]` | Pre-existing, unchanged this batch — out of scope.                                                            |
| Malformed `publishedAt`                                | NO                                     | Throws (Serious-1)                                                                                                             | See above.                                                                                                    |
| Rapid `retry()` clicks                                 | Handled                                | `fetchReleases` resets `error`/`loading` synchronously each call, service overwrites signals; no visible race in the component | Not newly introduced or changed this batch.                                                                   |
| Language switch mid-render (loading spinner showing)   | Handled                                | `'app.download.loading'                                                                                                        | transloco`re-renders through Transloco's normal mechanism, inner`<span>` does not block it                    | None. |
| Language switch after releases loaded (date re-render) | Likely handled, untested by this batch | `computed()` over `intlLocale()`, same proven pattern as sibling components                                                    | Moderate-1.                                                                                                   |
| Component destroyed mid-poll                           | Handled                                | `destroyRef.onDestroy(() => clearInterval(checkExpand))`                                                                       | This is exactly what Task 13.1 asked for; verified present and correctly scoped to the right interval handle. |
| RTL asset labels/sizes/version staying LTR             | Handled                                | `.ltr-island`, asserted in spec                                                                                                | None.                                                                                                         |

### Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `formatDate()` now throws a `RangeError` on any release whose `publishedAt` `new Date()` cannot
  parse, where the old code degraded to visible "Invalid Date" text — a regression introduced by this
  batch, not a pre-existing gap, on data sourced from an external, unvalidated API response.
- What a robust implementation would add: (1) a guard in `formatDate()` (or validation in
  `GitHubReleaseService.parseRelease`) so an unparsable date degrades instead of throwing; (2) a spec that
  calls `i18n.setLanguage('ar')` on a live `DownloadPageComponent` instance and asserts the rendered date
  changes, matching `session-calendar`/`stat-tile`; (3) once the visual reviewer's build is available, a
  `prerender-check` confirmation that the new inner `<span>` around the loading text is in fact necessary
  (or provably harmless) for byte-identical SSG output.

## Batch 13 — round 2

Narrow recheck of round 1's findings. `git diff` confirms this round touches exactly
`apps/ptah-landing-page/src/app/pages/download/download-page.component.ts` and its `.spec.ts` — every
other file in the working tree (`project.json`, `en.json`, `ar.json`, `styles.css`) is byte-identical to
what round 1 already reviewed and approved on those points.

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0 new    |

### Serious-1 — RESOLVED

`formatDate()` (`download-page.component.ts:479-484`) now parses `isoDate` once into a `Date`, checks
`Number.isNaN(date.getTime())`, and returns `''` instead of calling `.format()` on an invalid date — exactly
the guard round 1 recommended, and it keeps the fast path (`this.dateFormat().format(date)`) unchanged for
every valid date, so the "SSG output unchanged for `en`" requirement still holds. Verified by direct
execution: `Number.isNaN(new Date('not-a-date').getTime())` is `true`, so the throwing `Intl.DateTimeFormat`
call is never reached for that input. New spec `'renders a release with an unparsable publishedAt without
throwing'` (`download-page.component.spec.ts:224-234`) sets `publishedAt: 'not-a-date'`, asserts `render('en')`
does not throw, asserts the header reads `'Version v1.4.0 Latest'` (no date text, no crash), and separately
asserts `formatDate('')` returns `''` directly — this is not vacuous: reverting the guard (removing the
`Number.isNaN` check) makes `new Date('not-a-date')` reach `Intl.DateTimeFormat.prototype.format`, which I
confirmed by direct execution throws `RangeError: Invalid time value`, which `render('en')` would propagate
and fail the `not.toThrow()` assertion. The one open half of round 1's Serious-1 — that
`GitHubReleaseService.parseRelease` still assigns `publishedAt: release.published_at` with no runtime
validation (`github-release.service.ts:82`) — is unchanged and correctly left alone: that file is outside
this batch's file list, and the new code comment at `download-page.component.ts:465-468` documents the
upstream trust boundary explicitly for whoever touches that service next. This is sound scoping, not a
new gap.

### Moderate-1 (reactive switch untested) — RESOLVED

New spec `'re-formats the release date on a live language switch'` (`download-page.component.spec.ts:203-222`)
renders once in `'en'`, asserts `'Mar 5, 2026'`, then calls `await TestBed.inject(I18nService).setLanguage('ar')`
on the **same** fixture, calls `fixture.detectChanges()`, and asserts the header no longer contains `'Mar'`,
still contains `'2026'`, contains the Arabic `download.release.version` label, and contains no Arabic-Indic
digit (`٠-٩`) — matching exactly how `session-calendar.spec.ts:109-139` and `stat-tile.spec.ts:52`
test the identical `intlLocale()`-inside-`computed` pattern elsewhere in this codebase. The `try/finally`
resetting `document.documentElement.lang`/`dir` to `'en'`/`'ltr'` after the switch is good spec hygiene
(`I18nService.apply` mutates the real `<html>` element even under `provideI18nTesting`; see
`i18n.service.ts:244-249`), preventing this test's language switch from leaking into later tests in the same
Jest environment. This closes round 1's Moderate-1 with direct evidence rather than by-inspection inference.

### Moderate-2 (prerender parity not independently rebuilt) — addressed with evidence, informational residue only

The coordinator reports the executor demonstrated the inner `<span>` (`download-page.component.ts:76-78`)
is load-bearing: removing it made `prerender-check` fail at character 193 of the extracted text, where
`"Loading releases..."` and the following `"Ptah"` (from unrelated footer/navigation content elsewhere on
the page) concatenated without the separating boundary the baseline expects — i.e. without the wrapping
element, Angular's compiled output merges the loading text's node with an adjacent one in a way that changes
the no-separator-joined extraction, whereas the `<span>` boundary keeps them distinct exactly as the
committed baseline (`apps/ptah-landing-page/prerender-baseline/download.json`) requires. I did not rebuild
`dist/` myself in this round either (per this round's scope, to avoid conflicting with the parallel visual
reviewer's build), so this is accepted as reported rather than independently reproduced by this review; the
coordinator's message states `prerender-check` passed for all 6 routes. This does not block approval — the
claim is now evidenced (a concrete failure point, not just a comment) — but it remains formally unverified by
this reviewer's own tool run, so I record it as residue rather than closing it outright.

### Verification run

`node_modules/.bin/nx run-many -t test -p ptah-landing-page --skip-nx-cache` (scoped rerun with
`--testPathPattern=download` for isolation): `Tests: 94 passed, 94 total` (up from round 1's 92 — the two new
specs), all suites green. `git diff` confirms no files outside the stated two were touched this round.

### Blocking issues

None.

### Serious issues

None (round 1's finding is resolved — see above).

### Moderate and minor issues

None new. Moderate-2 stands as documented, non-blocking residue (evidenced by the coordinator's report, not
independently rebuilt by this review).

## Verdict (Batch 13, round 2, final)

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The only residue is Moderate-2 (prerender-check's pass was reported, not rebuilt
  by this reviewer) — an evidentiary gap in this review's own process, not a known or suspected defect in
  the shipped code.
- What a robust implementation would add (non-blocking, for a future batch): validate `published_at` at the
  `GitHubReleaseService` boundary (round 1's still-open observation, correctly out of this batch's scope)
  so a malformed date routes through the existing `I18nMessage` error path instead of silently rendering no
  date at all.
