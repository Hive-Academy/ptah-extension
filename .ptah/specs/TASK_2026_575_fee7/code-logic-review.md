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
