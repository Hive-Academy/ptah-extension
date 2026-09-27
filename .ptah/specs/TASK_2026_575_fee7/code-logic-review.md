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
