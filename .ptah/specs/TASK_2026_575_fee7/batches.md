# Batches - TASK_2026_575_fee7

Total tasks: 76 | Batches: 33 (+1 contingent, see end) | Complete: 6/33

Root: `/home/user/ptah-extension` (abbreviated `$ROOT` below; every path is absolute under it).
Task folder: `$ROOT/.ptah/specs/TASK_2026_575_fee7`. Plan: `implementation-plan.md` rev 1 (Gate 2 approved).
Branch: `claude/sleepy-turing-pdzxlm`. One commit per batch, by the team-leader, after review.

## Execution defaults (recorded by team-leader)

- No CLI lanes exist in this session. Every batch runs as ONE subagent, sequentially. No parallel batches,
  although the plan marks lib units parallel-safe (plan:804-808); order below follows plan:803-807.
- Executor types available: frontend-developer, backend-developer, devops-engineer, senior-tester.
- Verification is always scoped: `node_modules/.bin/nx run-many -t <targets> -p <projects>`, never workspace-wide.
  Output is tailed/filtered, never pasted in full.
- Batch size: the 6-file / 2-lib cap is applied per plan work unit where possible. Deviations, each deliberate:
  Batch 1-2 (new library: config files are atomic), Batch 7-8 (mechanical scope scaffolding across 11 projects,
  3 new files + 3 edits each), Batch 10 (the `SeoConfig` replacement must be atomic across its 6 callers, plan:854,
  "no dual API"), and lib batches (one lib, sub-folder bounded; spec files travel with their source).
- Commit scopes (from `$ROOT/.commitlintrc.json` scope-enum; there is no `i18n` scope):
  `shared` for `libs/frontend/i18n`; `scripts` for `tools/i18n-check`; `landing` for `apps/ptah-landing-page`;
  `web-<lib>` for `libs/web/<lib>`; `e2e` for `apps/ptah-landing-page-e2e`. Subject lowercase, <= 72 chars.
  Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01PnRXJnJhgYDMeYGwFS2UTD`.
- Executors never run git and never edit `task.md` or `batches.md`.
- SonarCloud reliability gate (added after e4a71cee / 850f2a2d): every batch touching TypeScript runs the typed
  SonarJS bug-rule check on its changed `.ts` files and must report 0 problems:
  `/tmp/claude-0/-home-user-ptah-extension/796962e2-8323-5794-bdb7-e6d506a4bc9d/scratchpad/sonar/node_modules/.bin/eslint -c /tmp/claude-0/-home-user-ptah-extension/796962e2-8323-5794-bdb7-e6d506a4bc9d/scratchpad/sonar/eslint.typed.mjs --no-config-lookup <changed .ts files>`
  (no `.sort()` without a comparator; no `=== undefined` on a value typed as never-undefined).
- Every batch touching TS also runs `node_modules/.bin/nx run degradation-audit:lint` (the pre-commit hook runs
  `nx affected -t lint`, which includes it). A swallowed `catch` needs a
  `// degradation-audit: optional-capability|reported - <reason>` marker; never raise `baseline.json`.
- Lockfile writes use `npx npm@11` (repo engines: node 24.x / npm 11). The container npm 10.9.7 strips `libc`
  fields and rewrites package-lock.json; any batch that changes dependencies runs
  `npx npm@11 install --package-lock-only --ignore-scripts` and the team-leader checks the lock diff is scoped.
- Lib sub-units that do not yet own the lib's `i18n-check` target (LND-1, LEG-1, MEM-1a..MEM-2, ADM-1a..ADM-3b)
  verify with lint/test/typecheck (+ `prerender-check` where the lib renders a prerendered route); the lib's last
  sub-unit adds the target and must exit 0 for the whole lib.
- Glossary (`tools/i18n-check/glossary.json`): after Batch 4, lib batches do NOT edit it (plan:726). They report
  new terms; Batch 32 appends them and regenerates every copy-review table (the team-leader does not write code).
- Arabic sign-off (8.3) is a merge gate for the user, not a batch gate. Every lib batch must produce
  `copy-review/<scope>.md` via `review-tables` and pass `--check`.
- Orchestrator user item (non-blocking, plan:725): before the first admin copy-review table (Batch 25) is sent to
  the user, ask whether admin copy needs a full read or a spot-check. Implementation is not blocked on it.

## Plan validation

Status: PASSED WITH RISKS

Checked on disk: `libs/frontend/i18n`, `tools/i18n-check` and `apps/ptah-landing-page/prerender-baseline` do not
exist (all "create" items are true creates). All 11 projects exist with the names used below (`web-ui`,
`web-panel-ui`, `web-core`, `web-landing`, `web-legal`, `web-pricing`, `web-auth`, `web-account`, `web-members`,
`web-admin`, `ptah-landing-page`). Web lib Jest configs are `jest.config.cts`; the app's is `jest.config.ts`.
`tools/di-lint/run-self-test.js` and `tools/degradation-audit/` exist as tool precedents. CI anchors
(`.github/workflows/ci.yml` di-lint / degradation-audit steps near :127-144) match. No web project has a
`coverageThreshold`. `node_modules` is absent; Node 22.22.2 / npm 10.9.7 are present; no Playwright browsers.

Assumptions:

- A1 esbuild bundles `import('./en.json')` into lazy chunks (browser + server) — unverified; checked in Task 9.4
  (build stats show scope JSON in lazy chunks) and re-confirmed in Batch 15 (a unique `landing` value is found in a
  lazy chunk of `dist/ptah-landing-page/browser`, not in `main-*.js`).
- A2 Jest resolves dynamic JSON imports in scope files — unverified; checked in Task 2.4 and Task 7.1.
- A3 route resolvers hold SSG until navigation ends — unverified; checked in Task 9.4 (`prerender-check` green,
  zero key paths, unchanged baselines).
- A4 the landing app reaches `ApplicationRef` stability — unverified; checked by the English control run, Task 33.2.
- A5 `@if` differences between English prerender and Arabic client hydrate cleanly — unverified; Task 33.3.
- `serve-static` (`apps/ptah-landing-page/project.json:106-112`) is `@nx/web:file-server` with `spa: true`; the plan
  assumes it serves `pricing/index.html` for `/pricing` — unverified; checked in Task 33.1.
- The existing English e2e (7.5) needs its backend `globalSetup` — may not start in this container; Task 33.4.

| Risk                                                                                                                                 | Severity | Mitigation                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies not installed; `npm ci` may fail behind the proxy                                                                       | HIGH     | Task 1.1 establishes the install first; proxy notes in `/root/.ccr/README.md`                                                                              |
| N13: lib-spec recipe omits `core`; the throwing testing handler breaks error-path specs                                              | MEDIUM   | Task 2.3 (recipe always includes global scopes); every lib batch uses it                                                                                   |
| N14: `provideI18nTesting` holds one language per scope; SEO and nav specs need `en` + `ar`                                           | MEDIUM   | Task 2.3 (per-language translations shape), before CORE (Batch 10) depends on it                                                                           |
| N12: `document.fonts.check` passes when no Arabic face is registered                                                                 | LOW      | Task 33.1 uses `document.fonts.load(...)` length > 0 and asserts `#ptah-font-ar` exists                                                                    |
| A4 app never stable (GSAP/Lenis in zone)                                                                                             | HIGH     | English control first (Task 33.2); on failure activate contingent TASK_2026_576 batch (user decided at Gate 2)                                             |
| Prerendered text drifts from baselines                                                                                               | HIGH     | Baselines captured once (Task 6.3) before any template edit; `prerender-check` closes Batches 9, 10, 11, 13-18                                             |
| Missed strings at scale (~141 components)                                                                                            | MEDIUM   | Per-lib `i18n-check` reference rule; reviewer greps for literal template text                                                                              |
| `rtl:` variants misfire inside `dir="ltr"` islands                                                                                   | MEDIUM   | Checker rule (Task 5.1); lib batches use physical utilities inside islands                                                                                 |
| Playwright browsers absent in container                                                                                              | MEDIUM   | Task 33.1 installs chromium via `npx playwright install chromium`; if blocked, report environment blocker with evidence                                    |
| Nx cache ripple from new `tsconfig.base.json` aliases                                                                                | LOW      | Accepted (plan:879); `resolveJsonModule` stays per project                                                                                                 |
| Commitlint has no `i18n` scope                                                                                                       | LOW      | Scopes fixed in Execution defaults                                                                                                                         |
| Consumer Jest configs cannot load `@angular/common/locales/ar` (untransformed ESM) once specs use `provideI18nTesting`               | MEDIUM   | Tasks 7.1, 7.2, 8.1, 8.2 add `@angular/common/locales` next to `@jsverse` in every touched `jest.config.cts` / the app `jest.config.ts` (found in Batch 2) |
| Under `provideI18nTesting`, a mistyped key rendered through the `transloco` pipe fails at TestBed teardown, not at `detectChanges()` | LOW      | Batch 2 deviation 2; documented in the lib `CLAUDE.md`; lib batches rely on the teardown failure                                                           |

Edge cases:

- Storage throws / invalid stored value / server platform — Task 1.3, Task 2.1
- Concurrent `setLanguage` calls (latest wins), load failure returns `false` with state unchanged — Task 2.1
- Key missing in `ar` (English fallback) and in both (`''`, never the key) — Task 2.2
- Pre-paint script vs library detection drift — Task 9.2 (jsdom matrix)
- Arabic font requested by English visitors — Task 9.3, Task 33.1
- Language switch while a nav group is collapsed (label-keyed state) — Task 12.2
- Backend-supplied messages (`core.common.serverMessage`) — Task 10.2
- Marquee direction change mid-animation — Task 14.3
- UGC mixed direction (`dir="auto"`) — Tasks 23.1, 31.2
- Legal governing-language notice structural branch on prerendered routes — Task 16.2, Task 33.3

Preserve list (for Mode 3; no surface is replaced, these existing behaviours must survive):
all routes in `app.routes.ts` with their guards; nav menus (Escape, outside-click, refocus); `og:*`/`twitter:*`/
canonical tags in English; prerendered text of the 6 SSG routes; member/admin nav-group collapse; `extract-i18n`
of `apps/ptah-extension-webview` untouched. Write path to trace at Mode 3: `localStorage['ptah.lang']`
(written by `LangPreferenceStore.write`, read by `LangPreferenceStore.read` and the `#ptah-i18n-prepaint` script).

---

## Batch 1: Dependency install and i18n library core (F1, part 1) — COMPLETE (0462df27)

- Recommended executor: backend-developer
- Fallback executor: frontend-developer
- Execution mode: sequential
- Rationale: pure TypeScript library logic plus environment setup; no templates.
- Tasks: 4 | Depends on: none
- Commit: `feat(shared): add i18n library core and transloco dependency`

### Task 1.1: Establish a working install and add Transloco — COMPLETE

- Files: `$ROOT/package.json`, `$ROOT/package-lock.json`
- Plan reference: implementation-plan.md:247-250, :273
- Pattern to follow: existing exact pins in `$ROOT/package.json`
- Quality requirements: `npm ci` succeeds (proxy: see `/root/.ccr/README.md`); then add `@jsverse/transloco` at exactly `8.4.0` and refresh the lock; `node_modules/.bin/nx --version` runs.
- Validation notes: do not upgrade unrelated packages; if `npm ci` fails, report the exact error rather than deleting the lockfile.
- Implementation details: `npm ci` then `npm install --save-exact @jsverse/transloco@8.4.0`; confirm `@jsverse/utils@1.0.0-beta.5` is locked (accepted pin).

### Task 1.2: Scaffold `@ptah-extension/i18n` project — COMPLETE

- Depends on: Task 1.1
- Files: `$ROOT/libs/frontend/i18n/{project.json,package.json,CLAUDE.md,eslint.config.mjs,jest.config.ts,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json}`, `$ROOT/libs/frontend/i18n/src/{index.ts,test-setup.ts}`, `$ROOT/tsconfig.base.json`
- Plan reference: implementation-plan.md:273-276, :51-52
- Pattern to follow: `$ROOT/libs/frontend/markdown/project.json`, `tsconfig.base.json:97-99` (`/testing` alias)
- Quality requirements: tags `["scope:shared","type:util"]`; targets `test`/`lint`/`typecheck`, no build; `resolveJsonModule: true`; Jest `transformIgnorePatterns` includes `@jsverse`; aliases `@ptah-extension/i18n` and `@ptah-extension/i18n/testing`.
- Validation notes: zero workspace imports (1.2).
- Implementation details: barrel with grouped explicit exports (<150 lines), filled as units land.

### Task 1.3: Pure language data, detection and persistence — COMPLETE

- Depends on: Task 1.2
- Files: `$ROOT/libs/frontend/i18n/src/lib/{lang.config.ts,resolve-initial-lang.ts,lang-preference.store.ts}` + specs
- Plan reference: implementation-plan.md:194-210
- Pattern to follow: `$ROOT/libs/web/members/src/lib/services/member-theme.service.ts:85-108`
- Quality requirements: `resolveInitialLang` is the literal 3.3 rule (single source of truth for the pre-paint script); store validates on read, every access in try/catch, no-op on server.
- Validation notes: specs cover stored `ar`, `navigator ['ar-EG']`, invalid `'xx'`, throwing getter and setter.
- Implementation details: `SUPPORTED_LANGS`, `LANG_DIRECTION`, `ANGULAR_LOCALE`, `INTL_LOCALE` (`ar-u-nu-latn`), `LANG_NATIVE_NAME`.

### Task 1.4: `I18nMessage` and `defineI18nScope` — COMPLETE

- Depends on: Task 1.2
- Files: `$ROOT/libs/frontend/i18n/src/lib/{i18n-message.ts,i18n-scope.ts}` + spec
- Plan reference: implementation-plan.md:219-221, :235
- Pattern to follow: Transloco `ProviderScope`/`InlineLoader` types (plan:91)
- Quality requirements: type forces a loader for every `SupportedLang`; scope name must match `^[a-z][A-Za-z]*$` (throws in dev).
- Validation notes: inline-loader map keys are `scope/lang` (plan:93) — build them here.
- Implementation details: `I18nScope` = `ProviderScope` with `alias === scope`.

### Batch 1 verification

- All files exist with real implementations; barrel exports Tasks 1.3-1.4.
- `node_modules/.bin/nx run-many -t lint,test,typecheck -p @ptah-extension/i18n` passes.
- `git diff package.json` shows only the transloco addition.
- Reviewer: logic (library behaviour, storage edge cases).
- Review result: code-logic-review.md, APPROVED (0 blocking, 0 serious, 1 moderate). Moderate-1 (plain `Error` at
  the library boundary, CONVENTIONS.md §7) and two minor notes (`ar*` prefix trade-off undocumented; dev-only scope
  guard) are carried into Task 2.0, before Batch 2 adds more code that throws errors, not fixed in Batch 1.
- Commit gate (pre-commit `nx affected -t lint`): FAILED on `degradation-audit:lint`.
  `libs/frontend/i18n/src/lib/lang-preference.store.ts:30 [catch-return-sentinel]`, libs/frontend/i18n 1 site vs
  baseline 0. Returned to the executor as rework on Task 1.3: add a `// degradation-audit: optional-capability - <reason>`
  marker inside or directly above that `catch` (form: `tools/degradation-audit/check-degradation.ts:26-56`, example
  `libs/frontend/markdown/src/lib/file-link-target.ts:133`). The behaviour stays the same, the baseline is not
  raised, and `nx run degradation-audit:lint` must exit 0.
  Resolved: marker added at `lang-preference.store.ts:31-32`; the audit exits 0 (nothing under libs/frontend/i18n).

## Batch 2: i18n library runtime, pipes and testing entry (F1, part 2) — COMPLETE (37537338)

- Recommended executor: backend-developer
- Fallback executor: frontend-developer
- Execution mode: sequential
- Rationale: tightly coupled DI wiring in one library; N13/N14 must be settled here.
- Tasks: 5 | Depends on: Batch 1
- Commit: `feat(shared): add i18n service, resolver, pipes and testing provider`

### Task 2.0: `I18nError` root error class (Batch 1 review carry-over, Moderate-1) — COMPLETE

- Files: `$ROOT/libs/frontend/i18n/src/lib/i18n.error.ts` + spec, `$ROOT/libs/frontend/i18n/src/lib/i18n-scope.ts`,
  `$ROOT/libs/frontend/i18n/src/lib/resolve-initial-lang.ts` (+ spec), `$ROOT/libs/frontend/i18n/CLAUDE.md`,
  `$ROOT/libs/frontend/i18n/src/index.ts`
- Plan reference: code-logic-review.md "Moderate-1" and "Verdict"; `$ROOT/CONVENTIONS.md:97-100`
- Pattern to follow: `$ROOT/libs/backend/agent-sdk/src/lib/errors/sdk.error.ts` (root error shape)
- Quality requirements: `I18nError extends Error` (sets `name`); both throw sites in `i18n-scope.ts` (invalid scope
  name at :44-46, bad loader result at :90-92) throw it, message text unchanged; exported from the barrel; specs assert
  `instanceof I18nError` at both sites. Every error Batch 2 throws itself (duplicate-scope dev error, testing
  missing-key throw) uses `I18nError` or a subclass. Errors that come from outside the library, such as a rejected
  `import()`, are passed on unchanged.
- Validation notes: do NOT change the detection rule (plan 3.3 is the single source of truth, mirrored by the
  pre-paint script). Instead add a code comment to `resolveInitialLang` stating that any `ar*` prefix (including
  non-Arabic tags such as `arn`) is intentionally treated as Arabic, and a spec that pins that behaviour. Add one line
  to the lib `CLAUDE.md` saying the scope-name guard runs in dev mode only and does not validate input at runtime.
- Implementation details: one small file; barrel stays grouped under a new "Errors" heading.

### Task 2.1: `I18nService` and `i18nScopesResolver` — COMPLETE

- Depends on: Task 2.0

- Files: `$ROOT/libs/frontend/i18n/src/lib/{i18n.service.ts,i18n-scopes.resolver.ts}` + specs
- Plan reference: implementation-plan.md:211-222, :256-260, :97
- Pattern to follow: `$ROOT/libs/frontend/markdown/src/lib/provide-markdown-rendering.ts`
- Quality requirements: signals `lang`/`direction`/`locale`/`intlLocale`; `init()` never rejects (falls back to `en`, one `console.error`); server short-circuits to `en`; `setLanguage` loads every registered scope before `setActiveLang`, returns `Promise<boolean>`, latest call wins; resolver logs and resolves `true` on failure.
- Validation notes: late scope loads never re-render (`emitChange: false`) — loads must finish before render/switch. Duplicate scope name with a different loader is a dev error.
- Implementation details: registry keyed by scope name; `documentElement.lang/dir` via `DOCUMENT`; resolver spec loads a scope with no `HttpClient` provided (1.4).

### Task 2.2: `provideI18n` and `I18nMissingHandler` — COMPLETE

- Depends on: Task 2.1
- Files: `$ROOT/libs/frontend/i18n/src/lib/{provide-i18n.ts,i18n-missing.handler.ts}` + specs
- Plan reference: implementation-plan.md:223-234, :66, :98
- Pattern to follow: `provide-markdown-rendering.ts:475`
- Quality requirements: handler registered AFTER `provideTransloco`; spec asserts `TRANSLOCO_MISSING_HANDLER` resolves to `I18nMissingHandler`; prod path returns `''` for a key missing in both languages, never the key; English fallback when `ar` misses.
- Validation notes: resolve `TranslocoService` lazily from `Injector` with a re-entrancy guard.
- Implementation details: `EmptyRootLoader` returns `{}`; `registerLocaleData(localeAr,'ar')` in an environment initializer; `provideAppInitializer(() => inject(I18nService).init())`.

### Task 2.3: `provideI18nTesting` (resolves review N13 and N14) — COMPLETE

- Depends on: Task 2.2
- Files: `$ROOT/libs/frontend/i18n/src/testing/{index.ts,provide-i18n-testing.ts}` + spec
- Plan reference: implementation-plan.md:242-245; implementation-plan-review.md:68-76
- Pattern to follow: `@ptah-extension/core/testing` entry shape
- Quality requirements: N14 — `translations` accepts per-language maps: `Partial<Record<SupportedLang, Record<string /*scope*/, Translation>>>` (the synchronous root loader serves each language's map, nested under scope name); N13 — document in the lib `CLAUDE.md` the canonical recipe that always passes the global scopes (`ui`, `core`, plus `app` for app specs) alongside the owning scope; handler throws on a key missing from every provided language.
- Validation notes: spec proves a `lang: 'ar'` setup can translate the same key in `ar` and in `en` (the CORE SEO spec depends on it).
- Implementation details: `I18nService` seeded with `lang`; locale registration included; renders synchronously.

### Task 2.4: `i18nDate` / `i18nNumber` pipes and barrel completion — COMPLETE

- Depends on: Task 2.1
- Files: `$ROOT/libs/frontend/i18n/src/lib/pipes/{i18n-date.pipe.ts,i18n-number.pipe.ts}` + specs, `$ROOT/libs/frontend/i18n/src/index.ts`
- Plan reference: implementation-plan.md:236-241, :271
- Pattern to follow: Angular `DatePipe`/`DecimalPipe` signatures
- Quality requirements: impure, memoised on `(value, format, tz, lang)`; no `Intl` allocation on cache hit; `'MMM d, y'` in `ar` has Arabic month names and no `[٠-٩]`; updates after `setLanguage` without pipe re-creation; null/undefined/'' return `null`.
- Validation notes: A2 — at least one spec imports a scope with dynamic JSON import; if Jest cannot resolve it, apply the plan's TS-wrapper fallback (plan:109) and report it.
- Implementation details: barrel re-exports `TranslocoPipe` and `translateSignal` so consumers never import `@jsverse/transloco`.

### Batch 2 verification

- Review round 1 (code-logic-review.md `## Batch 2`): NEEDS_REVISION, 0 blocking, 1 serious, 2 moderate, 1 minor.
  Rework assigned to the same executor, all in this batch (none deferred):
  - Serious-1 (Task 2.1): a failed `scope/lang` load is cached by Transloco's `shareReplay(1)` and never retried.
    Required outcome: the next `setLanguage` / `loadScopes` / `init` English retry for a previously failed pair calls
    the scope loader again and recovers once the loader succeeds. Only public Transloco API; no access to private
    `cache` / `failedLangs`; no cache-busting path suffixes. Preferred shape: `I18nService` runs scope loaders itself
    (one immediate retry, as `failedRetries: 1` did; concurrent calls share one in-flight promise; a failure is not
    remembered), unwraps a JSON module's `default` as Transloco's `resolveLoader` does, and stores the result with
    `transloco.setTranslation(translation, scopeLoadPath(scope, lang), { emitChange: false })`, the same call as
    Transloco's own `handleSuccess`. Delete `scopeInlineLoader` if nothing uses it any more.
  - Moderate-1 (Task 2.1): the resolver keeps resolving `true` (plan:256-260), but an `I18nError` (wiring mistake)
    is logged with its own distinct tag, separate from ordinary load failures; spec through the resolver.
  - Moderate-2 (Task 2.1): spec that `init()` recovers when English fails on the first attempt and succeeds on the
    retry; comment on the ordering `retryEnglish()` relies on (or remove the dependency).
  - Minor (Task 2.3): lib `CLAUDE.md` notes that only the first missing key is reported at teardown.
  - Pass condition: a spec with a loader that fails once and then succeeds shows `setLanguage` false, then true,
    with the loader called again; the same for a revisited resolver route.
  - Rework verified on disk by team-leader: scope loads run through `I18nService.loadScope` (in-flight sharing,
    loaded-path set, failures not remembered, `setTranslation(..., { emitChange: false })`); `scopeInlineLoader`
    removed; `[i18n:wiring]` tag in the resolver; 12 suites / 112 tests, audit exit 0. Awaiting review round 2.
- Review round 2: NEEDS_REVISION, 0 blocking, 1 serious (new), 0 moderate; round-1 items fixed 4/4.
  Serious-2 (Task 2.1, narrow rework, last automatic round before the user is asked):
  `unwrapJsonModule` (`i18n.service.ts:257-261`) unwraps any object with a truthy `default`, which drops sibling
  keys of a real translation that has a top-level `default` namespace. Chosen fix: unwrap only when the result is a
  JSON module namespace. That means `default` is a plain non-array object and every other own key of the result is
  a named export mirroring it (`result[k] === result.default[k]`); otherwise use the result as is. A "sole key" test
  alone is rejected: esbuild and TS interop namespaces also carry the mirrored named exports. Regression specs:
  (a) a loader returning `{ default: {label}, theme: {label} }` keeps both namespaces; (b) a real
  `import('./__fixtures__/*.json')` still unwraps; (c) a mirrored namespace shape `{ default: X, ...X }` unwraps;
  (d) a key three levels deep resolves as `scope.a.b.c` after `setTranslation` (reviewer's load-path check).
  No other changes.
- Review round 3: APPROVED (0 blocking, 0 serious, 1 moderate). Serious-2 fixed (`unwrapJsonModule` wrapper check,
  specs a-d, 12 suites / 116 tests). Residual Moderate: a scope file whose ONLY top-level key is `default` is
  indistinguishable from a module wrapper and loses the `default.` prefix. No further Batch 2 rework. Carried
  forward to Tasks 3.2/3.3: the i18n-check tool rejects such a file, which enforces the constraint at build time
  instead of guessing at runtime, and the lib `CLAUDE.md` states it.

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p @ptah-extension/i18n` passes.
- Task 2.0: no `throw new Error(` remains under `libs/frontend/i18n/src/lib` (non-spec files).
- 1.2: `node_modules/.bin/nx graph --file=<scratch>.json` shows `@ptah-extension/i18n` with an empty workspace-dependency list (evidence quoted in the report).
- Reviewer: logic (DI ordering, missing-handler semantics, N13/N14 shape).

## Batch 3: i18n-check tool core rules (F2a, part 1) — COMPLETE (83b0d38c)

- Recommended executor: backend-developer
- Fallback executor: devops-engineer
- Execution mode: sequential
- Rationale: Node AST tooling with shared helpers.
- Tasks: 3 | Depends on: Batch 2 (package.json sequencing)
- Commit: `feat(scripts): add i18n-check tool with parity and key reference rules`

### Task 3.1: Tool project scaffold and glossary seed — COMPLETE

- Files: `$ROOT/tools/i18n-check/{project.json,tsconfig.json,jest.config.ts}`, `$ROOT/tools/i18n-check/glossary.json`
- Plan reference: implementation-plan.md:362-365, :70
- Pattern to follow: `$ROOT/tools/degradation-audit/project.json`, `$ROOT/tools/di-lint/run-self-test.js`
- Quality requirements: tags `["type:tool"]`; targets `self-test`, `test`; Jest `testEnvironment: node`; glossary seeded from task-description §6.1 with `{term, reason}`.
- Validation notes: tool imports no project code.
- Implementation details: ts-node `--transpile-only` invocation as in degradation-audit.

### Task 3.2: Helpers and `main.ts` rules: parity, references, computed keys, placeholders, glossary, real Arabic — COMPLETE

- Depends on: Task 3.1
- Files: `$ROOT/tools/i18n-check/src/main.ts`, `$ROOT/tools/i18n-check/src/lib/{scope-map.ts,template-keys.ts,ts-keys.ts,translation-files.ts,glossary.ts,report.ts}` + specs
- Plan reference: implementation-plan.md:282-301, :355-361
- Pattern to follow: `$ROOT/tools/degradation-audit/check-degradation.ts`
- Quality requirements: `--allow-scope` semantics (default `ui,core`; `ui` none; `core` passes `ui`); ownership by first key segment via `scope-map.ts`; `i18n-keys:` markers resolved per owning scope; `*I18N_KEYS`/`*I18nKeys` const rule; `i18n-ignore:` marker; every violation reported with file:line:key, exit 1; parse failures are failures; deterministic order.
- Validation notes: literal-scan regex anchored on the project's own scope; `>ptah.live<` must not match.
- Batch 2 carry-over (review round 3, Moderate): a translation file whose only top-level key is `default` is a
  violation (`sole-default-key`, file path reported). `I18nService` cannot tell it from a JSON module wrapper
  (`libs/frontend/i18n/src/lib/i18n.service.ts` `unwrapJsonModule`). Also add one sentence stating this
  constraint to `$ROOT/libs/frontend/i18n/CLAUDE.md`.
- Implementation details: `@angular/compiler` `parseTemplate` for `.html` and inline `template:`; `typescript` API for `translate(`, `.translate(`, `translateSignal(`, `translateObjectSignal(`.

### Task 3.3: Self-test fixture with F2a planted violations — COMPLETE

- Depends on: Task 3.2
- Files: `$ROOT/tools/i18n-check/run-self-test.js`, `$ROOT/tools/i18n-check/__fixtures__/project/**`
- Plan reference: implementation-plan.md:337-341
- Pattern to follow: `$ROOT/tools/di-lint/run-self-test.js`
- Quality requirements: plants `en` key missing from `ar`, unknown key, unannotated computed key, foreign-scope `landing.x` in a `pricing` fixture, a translation file whose only top-level key is `default` (Batch 2 carry-over); a valid `core.*` reference must PASS; self-test passes only if exit 1, every planted violation named, no must-pass line named.
- Validation notes: fixture is data, not a real project (no `project.json` that Nx would pick up).
- Implementation details: none beyond the above.

### Batch 3 verification

- `node_modules/.bin/nx run i18n-check:self-test` and `node_modules/.bin/nx run-many -t test -p i18n-check` pass.
- Reviewer: logic (rule correctness, false-positive/negative risk).
- Review round 1 (code-logic-review.md `## Batch 3`): NEEDS_REVISION, 0 blocking, 2 serious, 2 moderate, 3 minor.
  Team-leader verified on disk: all listed files exist; self-test PASS on both runs, 7 suites pass. Task 3.1
  IMPLEMENTED; Tasks 3.2/3.3 stay IN_PROGRESS for rework. Fix in this batch:
  - Serious-1 (Task 3.2): the `translateObjectSignal` group requirement is enforced for computed keys. Each use site
    is validated with its own `target`: const values are checked per reading use site (`'any'` when no use reads
    them); marker keys for an `object` target must name a non-empty group. Fixture plants (Task 3.3): a group-name
    const read by `translateObjectSignal` PASSES; a leaf const read by `translateObjectSignal` FAILS; a leaf-only
    marker on a `translateObjectSignal` computed argument FAILS.
  - Serious-2 (Task 3.2): markers attach by AST, not line count. A template comment covers the next sibling node's
    full source span (`parseTemplate` spans); a TS `//` marker covers the full span of the next statement or
    property it precedes. Fixture (Task 3.3): Prettier-formatted wrapped elements where the annotated expression
    sits 2+ lines below its marker PASS (`i18n-keys:` and `i18n-ignore:`), and a marker two nodes away does NOT
    cover.
  - Moderate-2 (Task 3.2): `parseTemplate` (and any other per-file parse) is wrapped so a throw becomes a per-file
    `parse-error` and the scan continues; spec with a throwing parse.
  - Minor, zero source files (Task 3.2): a project root whose `src` yields no `.ts`/`.html` files is a violation
    (`no-source-files`), never a silent exit 0.
  - Minor, duplicate key-constant name (Task 3.2): two `*_I18N_KEYS`/`*I18nKeys` declarations with the same name
    in one project is a violation (`duplicate-key-constant`, both locations).
    Deferred to Task 4.1 (same tool, next batch): Moderate-1, an allowed scope's own structural defects get a one-line
    summary pointer in the consumer's report; Minor, the glossary word boundary also treats Arabic letters as word
    characters.
- Review round 2: APPROVED (0 blocking, 0 serious, 1 new moderate). All five round-1 fixes verified; team-leader
  reran self-test (both runs PASS), test, eslint:lint, tsc and prettier --check: all clean. New Moderate (inline
  template offsets are approximate after an escape sequence, `ts-keys.ts:43-47,150`) carried to Task 4.1.

## Batch 4: Review tables, Nx target defaults and CI step (F2a, part 2) — COMPLETE (bfb3e7b4)

- Recommended executor: backend-developer
- Fallback executor: devops-engineer
- Execution mode: sequential
- Rationale: small, CI-facing completion of F2a.
- Tasks: 2 | Depends on: Batch 3
- Commit: `feat(scripts): add i18n review tables and ci i18n-check step`

### Task 4.1: `review-tables` generator — COMPLETE

- Batch 3 review carry-over: (1) when an allowed scope's `en.json` loads but has structural violations
  (`dotted-key`, `duplicate-key`, `invalid-value`), the consumer's report adds one `allowed-scope-defect` line
  naming that scope's file; (2) `glossary.ts` `containsTerm` treats Arabic letters (U+0600-06FF) as word
  characters at the boundaries. Each gets a spec. (3) Batch 3 round-2 Moderate: an inline `template:` whose raw
  text contains a backslash has approximate offsets (`ts-keys.ts:43-47,150`). Either map offsets exactly by
  re-scanning the raw literal's escapes, or report a marker inside such a template as `marker-in-escaped-template`
  (a distinct violation telling the author to move the markup to an `.html` file) instead of trusting
  `coversOffset`. Spec: an escaped inline template with a marker right before and right after the escape.

- Files: `$ROOT/tools/i18n-check/src/review/review-tables.ts` + spec; carry-over: `$ROOT/tools/i18n-check/src/{main.ts,lib/glossary.ts,lib/ts-keys.ts,lib/report.ts}` + specs
- Plan reference: implementation-plan.md:332-336, :720
- Pattern to follow: `report.ts` from Task 3.2
- Quality requirements: `<out>/<scope>.md` (`key | English | Arabic | notes`, sorted), `<out>/glossary.md`; `--check` exits 1 on drift; byte-for-byte deterministic.
- Validation notes: notes computed deterministically (glossary terms, placeholders, identical-to-English, legal notice).
- Implementation details: add a `review-tables` invocation example to the tool's `project.json` or a README comment for lib executors.

### Task 4.2: `nx.json` targetDefaults and CI step — COMPLETE

- Depends on: Task 4.1
- Files: `$ROOT/nx.json`, `$ROOT/.github/workflows/ci.yml`
- Plan reference: implementation-plan.md:352, :578-592
- Pattern to follow: the degradation-audit step in `ci.yml` (~:141-144)
- Quality requirements: `targetDefaults["i18n-check"]` with `cache: true` and the three inputs; CI step named `i18n-check (translation parity, key references, RTL and formatting patterns)` inserted after degradation-audit, with the `run-many` branch when `tools/i18n-check/` changed.
- Validation notes: uses `node_modules/.bin/nx`, not `npx`; `NX_BASE`/`NX_HEAD` from existing `nx-set-shas`.
- Implementation details: YAML parses (`node -e` with a YAML parser available in node_modules, or `npx --no-install yaml`-free check via `python3 -c 'import yaml'` if present).

### Batch 4 verification

- `node_modules/.bin/nx run i18n-check:self-test` passes; review-tables run on the fixture twice is identical and `--check` passes.
- Reviewer: style (CI/YAML consistency) and logic (conditional branch).
- Review round 1: code-style-review.md `## Batch 4` APPROVED (1 serious, 4 minor); code-logic-review.md `## Batch 4`
  NEEDS_REVISION (1 blocking, 1 serious, 2 moderate, 2 minor). Team-leader verified on disk: self-test (3 stages)
  PASS, test + eslint:lint pass. Both tasks stay IN_PROGRESS. Rework in this batch:
  - Logic Blocking-1 (Task 4.1): `review-tables` refuses to generate (and `--check` fails) when a scope file has
    ANY violation (dotted-key, duplicate-key, invalid-value, sole-default-key, parse), not only when unreadable;
    the output names each violation. Spec or fixture plant for each kind.
  - Logic Serious-1 (Task 4.2): `targetDefaults["i18n-check"].inputs` also covers the allowed scopes' translation
    files a project reads (`ui`, `core`, and `app` for the landing app), for example
    `{workspaceRoot}/libs/web/{ui,core}/src/lib/i18n/**/*` plus the app scope folder, taken from `scope-map.ts`.
    This deviates from plan:352, which lists only three inputs: the plan text missed cross-scope reads.
  - Style Serious (Task 4.1): extract `UsageError`, `toRel`, and `resolveProjectRoot(scope, projectRoot)` into
    `tools/i18n-check/src/lib/cli.ts`, used by `main.ts` and `review-tables.ts`; the `main()` bootstrap stays
    inline.
  - Logic Moderates (Task 4.1): try/catch around Prettier `format()` in `formatMarkdown`, which reports the
    scope/file and exits 1; a self-test fixture plant for `allowed-scope-defect`.
  - Minors (Task 4.1): `parseArgs` exported and spec'd; `tableCell` also turns U+2028/U+2029 into `<br>`;
    `allowedScopeDefect` receives the structural list directly; `LINE_TERMINATORS` uses `\u2028`/`\u2029` escapes.
    Not actioned: a comment in `nx.json` (JSON has no comments; the rationale lives in the ci.yml comment). Carried to
    Batch 5: `main.ts` (585 lines) — Batch 5 adds its rules under `src/lib/`, and moves `KeyResolver`/`TargetMap`
    out of `main.ts` when it touches them.
- Review round 2: code-logic-review.md `## Batch 4 — round 2` APPROVED (0/0/0; Blocking-1, Serious-1 and the style
  Serious verified fixed, `lib/cli.ts` style-checked). Style APPROVED in round 1. Team-leader verified on disk: no
  duplicated CLI code, no raw U+2028/2029, nx.json inputs match scope-map paths; self-test (3 stages), test,
  eslint:lint, tsc and prettier are all clean.

## Batch 5: RTL and formatting rules (F2b, part 1) — COMPLETE (29f643dd)

- Recommended executor: backend-developer
- Fallback executor: devops-engineer
- Execution mode: sequential
- Rationale: AST rule work in the same tool.
- Tasks: 2 | Depends on: Batch 4
- Commit: `feat(scripts): add rtl and locale formatting rules to i18n-check`
- Batch 4 style carry-over: new rules live under `tools/i18n-check/src/lib/`, not in `main.ts` (585 lines); move
  `KeyResolver`/`TargetMap` out of `main.ts` into `src/lib/` when this batch touches them.
- Consistency note (team-leader): `rtl-exempt:` and `i18n-format-exempt:` markers reuse the AST-bound attachment in
  `src/lib/markers.ts` (Batch 3 Serious-2), which covers the next sibling node or statement span, instead of
  line-based matching. "Before the containing start tag" in Task 5.1 is satisfied by that attachment.

### Task 5.1: RTL pattern rule with island auto-exemption — COMPLETE

- Files: `$ROOT/tools/i18n-check/src/lib/rtl-patterns.ts` + spec, `$ROOT/tools/i18n-check/src/main.ts`
- Plan reference: implementation-plan.md:302-312, :59
- Pattern to follow: `template-keys.ts` span handling (Task 3.2)
- Quality requirements: covers 4.1 utilities, raw CSS, inline style bindings; passes centring pairs, `rtl-exempt: <reason>` (same line, preceding line, or before the containing start tag), and island descendants (`dir="ltr"` / `ltr-island`); FAILS any `rtl:`/`ltr:` variant inside an island.
- Validation notes: Tailwind `rtl:` matches inside islands (verified, plan:59).
- Implementation details: `.ts`, `.html`, `.css` inputs.

### Task 5.2: AST formatting rule and F2b fixtures — COMPLETE

- Depends on: Task 5.1
- Files: `$ROOT/tools/i18n-check/src/lib/format-patterns.ts` + spec, `$ROOT/tools/i18n-check/__fixtures__/project/**`, `$ROOT/tools/i18n-check/run-self-test.js`
- Plan reference: implementation-plan.md:313-316, :339
- Pattern to follow: Task 3.3 fixture
- Quality requirements: fails `BindingPipe` `date|number|currency|percent|decimal`, `toLocale*String` calls, `Intl.X` without `intlLocale()` first arg; `i18n-format-exempt:` marker; fixture adds `ml-4`, `| date`, `toLocaleDateString()`, `rtl:` inside island (must fail) and `number | Date` union plus `left-0` in island (must pass).
- Validation notes: type unions must not match (N3).
- Implementation details: wire both rules into `main.ts`.

### Batch 5 verification

- `node_modules/.bin/nx run i18n-check:self-test` and `node_modules/.bin/nx run-many -t test -p i18n-check` pass.
- Reviewer: logic.
- Review round 1 (code-logic-review.md `## Batch 5`): NEEDS_REVISION, 0 blocking, 1 serious, 2 moderate, 1 minor.
  Team-leader verified on disk: all listed files exist; self-test (3 stages), test and eslint:lint pass; main.ts
  536 lines; KeyResolver/TargetMap moved. Both tasks stay IN_PROGRESS. Rework in this batch:
  - Serious-1 (Task 5.1, `rtl-patterns.ts:181-230`): the `rtl:` pairing bypass applies only to the families where
    the plan offers pairing (`translate-x`, `gradient`, `origin`; `space-x` keeps its `reverse` handling). `ml-4
rtl:mr-8` and the `pl-*`, `left-*`/`right-*`, `rounded-*`, `text-left/right`, `border-l/r`, `float-*`
    equivalents still FAIL (regression spec plus one fixture plant).
  - Moderate-1 (Tasks 5.1/5.2, `markers.ts`): a marker that attaches to nothing (for example trailing on the same
    line, or at the end of a CSS block) is reported as `detached-marker` with a fix hint ("put the marker on its
    own line directly above the code"), for every marker kind (`i18n-keys`, `i18n-ignore`, `rtl-exempt`,
    `i18n-format-exempt`). It is never a silent no-op. This keeps the Batch 3 AST attachment model and supersedes
    "same line" in Task 5.1's wording. Self-test expectations are updated for existing detached plants.
  - Moderate-2 (Task 5.1): CSS `margin`/`padding`/`inset` shorthand with four values whose right and left differ is
    `rtl-physical`; three-value and symmetric forms pass. Spec.
    Not actioned: `.css` files carry no island context (by design, a standalone stylesheet has no DOM).
- Review round 2: APPROVED (all round-1 findings verified fixed live, 0 new). Team-leader verified on disk: self-test
  (3 stages), test, eslint:lint and tsc are clean; the plants are at rtl-format.component.html:10, .ts:46 and .css:21.
  `prettier --check` fails only on the intentionally unparsable Batch 3 fixture `broken.component.html`. Nothing
  gates on it (lint-staged formats ts/js/json/md only). The `.prettierignore` entry the executor proposed is carried
  to Task 6.1, because the team-leader does not write repository files.

## Batch 6: Prerender check, baseline capture and deploy gate (F2b, part 2) — COMPLETE (70b712f8)

- Recommended executor: backend-developer
- Fallback executor: devops-engineer
- Execution mode: sequential
- Rationale: needs the first production build of the unmodified app; must precede every template edit.
- Tasks: 3 | Depends on: Batch 5
- Commit: `feat(scripts): add prerender check and capture english baselines`

### Task 6.1: `parse5` devDependency — COMPLETE

- Files: `$ROOT/package.json`, `$ROOT/package-lock.json`, `$ROOT/.prettierignore` (Batch 5 carry-over)
- Plan reference: implementation-plan.md:69, :343
- Pattern to follow: existing devDependency pins
- Quality requirements: `parse5` pinned at `8.0.1` (lockfile version); nothing else changes.
- Validation notes: none.
- Implementation details: `npx npm@11 install --save-dev --save-exact parse5@8.0.1` (never the container's npm 10;
  the lock diff must stay scoped to parse5 and its own deps).
- Batch 5 carry-over: add `tools/i18n-check/__fixtures__/project/libs/web/pricing/src/lib/broken.component.html` to
  `.prettierignore` beside the degradation-audit parse-failure entry, with a one-line comment (it is unparsable on
  purpose; the self-test's parse-error plant).

### Task 6.2: `check-prerender.ts` — COMPLETE

- Depends on: Task 6.1
- Files: `$ROOT/tools/i18n-check/src/prerender/check-prerender.ts` + spec
- Plan reference: implementation-plan.md:317-331
- Pattern to follow: `report.ts`
- Quality requirements: the single shared normalisation (document order, skip comments/script/style/template/`[data-i18n-switcher]`, no-separator join, collapse whitespace, trim); asserts `lang="en"`, `dir="ltr"` (note: `dir` does not exist yet on `main`; baseline capture must not assert it — assert `dir` only in compare mode, and report this handling), no scope-anchored key-path text node, no empty h1/h2, text equals baseline.
- Validation notes: spec proves `<span class="ltr-island">$29</span>/mo` extracts as `$29/mo`.
- Implementation details: `--update` writes `{ route, h1, text }` per route slug.

### Task 6.3: Capture baselines (the only `--update` in this task) and extend deploy assertions — COMPLETE

- Depends on: Task 6.2
- Files: `$ROOT/apps/ptah-landing-page/prerender-baseline/{home,download,pricing,terms-and-conditions,privacy,refund}.json`, `$ROOT/.github/workflows/deploy-landing.yml`
- Plan reference: implementation-plan.md:331, :366, :594-597
- Pattern to follow: existing loop and `fail()` helper at `deploy-landing.yml:59-77`
- Quality requirements: baselines from `node_modules/.bin/nx build ptah-landing-page` of UNMODIFIED templates; deploy loop adds `lang="en"`, `dir="ltr"`, per-route headline greps from baseline `h1`, and a failing key-path grep.
- Validation notes: verify `git diff --stat -- apps/ptah-landing-page/src libs/web` is empty before capture.
- Implementation details: route slugs map to the six `app.routes.server.ts` prerender routes.
- Team-leader notes: (1) the pre-commit hook runs `nx format:write` on staged `.json`, so baselines must already be
  Prettier-clean, or compare must read them as parsed JSON, never byte-for-byte; verify with `prettier --check`.
  (2) The `dir="ltr"` deploy grep only holds once Batch 9 renders `dir`. The whole task merges as one branch, so
  this is acceptable, but state it in the ci comment and in the report.

### Batch 6 verification

- Build succeeds; six baseline files exist with non-empty `h1`/`text`; a compare run (without `--update`) against the same dist passes except the documented `dir` assertion.
- `node_modules/.bin/nx run i18n-check:self-test` passes.
- Reviewer: logic (normalisation shared by capture and compare).
- Review round 1: APPROVED (0 blocking, 0 serious, 1 moderate, 1 minor). Team-leader verified on disk: lock diff is
  one root devDependency line (parse5 8.0.1 was already locked); `report.ts` diff is only the five `prerender-*`
  kinds; check-prerender imports only committed exports (`cli.ts`, `report.ts`, `KNOWN_SCOPES` in HEAD).
  Carried to Batch 9 (it touches the landing app's prerender output and `dir`): Moderate, add a comment in
  `deploy-landing.yml` beside `KEY_PATH` saying the grep is not DOM-aware (it can false-positive on script or
  JSON-LD content; `check-prerender.ts` is authoritative); Minor, escape ERE metacharacters in the `HEADLINE`
  anchors, or comment that they must stay free of them.

## Batch 7: Scope scaffolding, global and eager projects (F3, part 1) — IN_PROGRESS

- Recommended executor: frontend-developer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: mechanical, repetitive per-project scaffolding; split in two to keep the lane short.
- Tasks: 2 | Depends on: Batch 6
- Commit: `feat(landing): scaffold i18n scopes for app, ui, core, panel-ui and landing`

### Task 7.1: Scopes for `app`, `ui`, `core` — IMPLEMENTED

- Files: `$ROOT/apps/ptah-landing-page/src/app/i18n/{en.json,ar.json,app.i18n-scope.ts}`, `$ROOT/libs/web/{ui,core}/src/lib/i18n/{en.json,ar.json,<lib>.i18n-scope.ts}`; MODIFY each project's `src/index.ts` (libs only), `tsconfig.json`, Jest config
- Plan reference: implementation-plan.md:368-400
- Pattern to follow: `$ROOT/libs/web/ui/tsconfig.json`, `$ROOT/libs/web/ui/jest.config.cts`, `$ROOT/libs/web/core/src/index.ts`
- Quality requirements: `defineI18nScope('<scope>', { en: () => import('./en.json'), ar: () => import('./ar.json') })`; `resolveJsonModule` per project; `@jsverse` AND `@angular/common/locales` in `transformIgnorePatterns` (Batch 2 finding: `provideI18nRuntime` registers `@angular/common/locales/ar`, untransformed ESM).
- Validation notes: A2 — a spec (or existing spec run) must import a scope file; report the result.
- Implementation details: JSON files start as `{}`.

### Task 7.2: Scopes for `panelUi`, `landing` — IMPLEMENTED

- Depends on: Task 7.1
- Files: `$ROOT/libs/web/{panel-ui,landing}/src/lib/i18n/*`, their `src/index.ts`, `tsconfig.json`, `jest.config.cts`
- Plan reference: implementation-plan.md:374-391
- Pattern to follow: Task 7.1
- Quality requirements: update the panel-ui barrel "authoritative count" comment (`libs/web/panel-ui/src/index.ts:3-9`).
- Validation notes: scope name `panelUi` (camelCase, `keepCasing`).
- Implementation details: none beyond the above.

### Batch 7 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p ptah-landing-page web-ui web-core web-panel-ui web-landing` passes.
- Reviewer: style.
- Review round 1: code-style-review.md `## Batch 7` APPROVED (0 blocking, 0 serious, 1 minor). Team-leader verified
  on disk: five scopes (`app`, `ui`, `core`, `panelUi`, `landing`) plus JSON `{}` and a spec each; tsconfig
  `resolveJsonModule`; jest `@jsverse` + `@angular/common/locales`. Scoped lint/test/typecheck passed (5 projects,
  uncached) and the typed SonarJS check found 0 problems on the 15 changed `.ts` files. A2 confirmed in all five.
  Minor (the `unwrap()` spec helper is copied into 5 specs) carried to Task 8.0, before Batch 8 would grow it to 11.

## Batch 8: Scope scaffolding, feature projects (F3, part 2) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: same mechanical shape as Batch 7.
- Tasks: 3 | Depends on: Batch 7
- Commit: `feat(landing): scaffold i18n scopes for feature libraries`

### Task 8.0: Shared scope-spec helper (Batch 7 style carry-over) — PENDING

- Files: `$ROOT/libs/frontend/i18n/src/testing/{index.ts, expect-scope-loads.ts}` + spec; the five Batch 7 specs
  (`apps/ptah-landing-page/src/app/i18n/app.i18n-scope.spec.ts`,
  `libs/web/{ui,core,panel-ui,landing}/src/lib/i18n/*.i18n-scope.spec.ts`)
- Plan reference: code-style-review.md `## Batch 7`, Minor
- Pattern to follow: `@ptah-extension/i18n/testing` entry shape (Task 2.3)
- Quality requirements: one exported testing helper that runs a scope's `en`/`ar` loaders and returns the unwrapped
  JSON (same `default` handling as the library). The five Batch 7 specs use it, and their local `unwrap()` copies
  are deleted. Batch 8 specs use it from the start. `libs/frontend/i18n` lint/test/typecheck stays green.
- Validation notes: keep `@ptah-extension/i18n/testing` free of Jest globals if a test runner type is not already
  used there; the helper returns data and the spec asserts.

### Task 8.1: Scopes for `legal`, `pricing`, `auth`, `account` — PENDING

- Files: `$ROOT/libs/web/{legal,pricing,auth,account}/src/lib/i18n/*`, their `src/index.ts`, `tsconfig.json`, `jest.config.cts`
- Plan reference: implementation-plan.md:368-400
- Pattern to follow: Task 7.1
- Quality requirements: as Task 7.1.
- Validation notes: none.
- Implementation details: none beyond the above.

### Task 8.2: Scopes for `members`, `admin` plus aggregate exports — PENDING

- Depends on: Task 8.1
- Files: `$ROOT/libs/web/{members,admin}/src/lib/i18n/*`, their `src/index.ts`, `tsconfig.json`, `jest.config.cts`
- Plan reference: implementation-plan.md:391
- Pattern to follow: Task 7.1
- Quality requirements: `MEMBERS_I18N_SCOPES = [MEMBERS_I18N_SCOPE, PANEL_UI_I18N_SCOPE]`, `ADMIN_I18N_SCOPES` likewise.
- Validation notes: `members.routes.spec.ts` and admin route specs stay untouched and green.
- Implementation details: none beyond the above.

### Batch 8 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-legal web-pricing web-auth web-account web-members web-admin` passes.
- Reviewer: style.

## Batch 9: App wiring, pre-paint, font and stable marker (F4) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: cross-file app wiring with an SSG contract; needs design judgement.
- Tasks: 4 | Depends on: Batches 6, 8
- Commit: `feat(landing): wire i18n provider, route resolvers and pre-paint script`
- Batch 6 carry-over (deploy-landing.yml, one comment and one escape): see "Batch 6 verification", review round 1.

### Task 9.1: Providers, resolvers, constants, styles, Tailwind stack, project targets — PENDING

- Files: `$ROOT/apps/ptah-landing-page/src/app/{app.config.ts,app.routes.ts}`, `$ROOT/apps/ptah-landing-page/src/app/i18n/landing-i18n.constants.ts`, `$ROOT/apps/ptah-landing-page/src/styles.css`, `$ROOT/apps/ptah-landing-page/tailwind.config.js`, `$ROOT/apps/ptah-landing-page/project.json`
- Plan reference: implementation-plan.md:402-437; design-spec.md §3.3 (:623), §3.6 (:689)
- Pattern to follow: existing `APP_INITIALIZER` in `app.config.ts:31-36`; `loadComponent` dynamic imports in `app.routes.ts`
- Quality requirements: resolver table exactly as plan:409-418 (members/admin via dynamic `import()`); `.ltr-island` WITHOUT `display` (plan:33-35); remove `extract-i18n`; add `prerender-check` (`dependsOn: ["build"]`); NO `i18n-check` target yet.
- Validation notes: `app.routes.spec.ts` must not import `app.routes` (jest NOTE block).
- Implementation details: `sans` stack `['Inter','IBM Plex Sans Arabic','Noto Sans Arabic','system-ui','-apple-system','sans-serif']`.

### Task 9.2: Pre-paint inline script and jsdom sync spec — PENDING

- Depends on: Task 9.1
- Files: `$ROOT/apps/ptah-landing-page/src/index.html`, `$ROOT/apps/ptah-landing-page/src/app/i18n/pre-paint-script.spec.ts`
- Plan reference: implementation-plan.md:426-431, :452-456
- Pattern to follow: `readFileSync` in `app.routes.spec.ts:1`
- Quality requirements: `<html lang="en" dir="ltr" data-theme="operator">`; `#ptah-i18n-prepaint` first after `<meta charset>`, <1 KB, try/catch storage; spec runs the full matrix (stored x languages) against `resolveInitialLang` and `LANG_DIRECTION`, asserts constants verbatim and font link exactly when `ar`.
- Validation notes: script inert without JS; static attributes stay English.
- Implementation details: literals `'ptah.lang'`, `['en','ar']`, direction map, font id/href.

### Task 9.3: Arabic font loader and app-stable marker — PENDING

- Depends on: Task 9.1
- Files: `$ROOT/apps/ptah-landing-page/src/app/i18n/{arabic-font.loader.ts,arabic-font.loader.spec.ts,app-stable-marker.ts,app-stable-marker.spec.ts}`, `$ROOT/apps/ptah-landing-page/src/main.ts`
- Plan reference: implementation-plan.md:432, :457, :484-494
- Pattern to follow: `provideEnvironmentInitializer` + browser-only root `effect`
- Quality requirements: link appended once, never for `en`; `markAppStable` awaits `whenStable()` then sets `data-app-stable="true"`, called from `main.ts` on the resolved `ApplicationRef`; `main.server.ts` untouched.
- Validation notes: A4 detection depends on this marker being honest (no timeout fallback that sets it anyway).
- Implementation details: none beyond the above.

### Task 9.4: Build, A1 and A3 evidence — PENDING

- Depends on: Tasks 9.1-9.3
- Files: none created (evidence only)
- Plan reference: implementation-plan.md:850-852, :107-113
- Pattern to follow: n/a
- Quality requirements: `node_modules/.bin/nx build ptah-landing-page` then `node_modules/.bin/nx run ptah-landing-page:prerender-check` pass against UNCHANGED baselines (A3: zero key paths). A1: build once with `--stats-json` and show from the stats that each scope's `en.json`/`ar.json` is emitted in a lazy chunk (not `main-*`), for the browser and server builds. Batch 15 re-confirms A1 with a unique `landing` value once that JSON is filled.
- Validation notes: if A1 fails, apply the TS-wrapper fallback (plan:109) in the scope files and report it.
- Implementation details: none.

### Batch 9 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p ptah-landing-page` passes; build and `prerender-check` pass.
- Reviewer: logic (SSG contract, pre-paint equivalence).

## Batch 10: Key-based SeoService and core service messages (CORE) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: atomic API replacement across 6 callers in 4 projects (no dual API, plan:854).
- Tasks: 3 | Depends on: Batch 9
- Commit: `feat(web-core): make seo service key-based and core messages translatable`

### Task 10.1: Key-based `SeoService` — PENDING

- Files: `$ROOT/libs/web/core/src/lib/services/seo.service.ts`, `$ROOT/libs/web/core/src/lib/services/seo.service.spec.ts`
- Plan reference: implementation-plan.md:532-550
- Pattern to follow: current `seo.service.ts:35-68`
- Quality requirements: old literal fields removed; synchronous `setPage`; og/twitter always English via `translate(key, {}, 'en')`; title/description follow active language via a root `effect`; spec with `provideI18nTesting({ lang: 'ar', ... })` using the N14 per-language shape.
- Validation notes: SSG head stays English.
- Implementation details: none beyond the above.

### Task 10.2: `core` service messages as `I18nMessage` — PENDING

- Depends on: Task 10.1
- Files: `$ROOT/libs/web/core/src/lib/services/{paddle-checkout.service.ts,github-release*.ts and other message-producing services}`, `$ROOT/libs/web/core/src/lib/i18n/{en.json,ar.json}`, `$ROOT/libs/web/core/project.json`
- Plan reference: implementation-plan.md:464-470, :64
- Pattern to follow: plan rule 3 example
- Quality requirements: `activePlanExists` with `{ plan }`; backend `response.message` wrapped as `core.common.serverMessage` (`{{ text }}` in both languages); add `i18n-check` target with `--allow-scope ui`; `copy-review/core.md` generated.
- Validation notes: consumers in other projects (download page, pricing grid) must still compile — update only their bindings to `msg.key | transloco: msg.params` with `i18n-keys: core.<area>.*` markers if types change; report every consumer touched.
- Implementation details: none beyond the above.

### Task 10.3: Update the 6 `setPage` callers and their SEO keys — PENDING

- Depends on: Task 10.1
- Files: `$ROOT/libs/web/landing/src/lib/landing-page.component.ts`, `$ROOT/libs/web/pricing/src/lib/pricing-page.component.ts`, `$ROOT/libs/web/legal/src/lib/{terms-page,privacy-page,refund-page}.component.ts`, `$ROOT/apps/ptah-landing-page/src/app/pages/download/download-page.component.ts`, and the `en.json`/`ar.json` of `landing`, `legal`, `pricing`, `app`
- Plan reference: implementation-plan.md:545, :54
- Pattern to follow: n/a
- Quality requirements: only the `setPage` blocks change; `<scope>.seo.title/description` verbatim English; `pricing` also `ogTitle`/`ogDescription`.
- Validation notes: prerender title/meta unchanged.
- Implementation details: none beyond the above.

### Batch 10 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-core web-landing web-pricing web-legal ptah-landing-page` and `node_modules/.bin/nx run web-core:i18n-check` pass.
- `node_modules/.bin/nx run ptah-landing-page:prerender-check` passes; `review-tables --check` clean for `core`.
- Reviewer: logic (SEO semantics, message contract).

## Batch 11: Header language switcher and `ui` strings (UI) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none (rerun frontend-developer)
- Execution mode: sequential
- Rationale: rendered UI with design-mid-flight decisions.
- Tasks: 3 | Depends on: Batch 10
- Commit: `feat(web-ui): add header language switcher and translate ui chrome`

### Task 11.1: Switcher in `NavigationComponent` (desktop + mobile) — PENDING

- Files: `$ROOT/libs/web/ui/src/lib/navigation.component.ts`, its spec
- Plan reference: implementation-plan.md:552-571; design-spec.md §2.2 (:98), §2.3 (:212), §2.5-2.7 (:429-570); `prototype/index.html`
- Pattern to follow: `#community-menu` (`navigation.component.ts:204-206`), `closeMenuAndRefocus` (:920)
- Quality requirements: `openMenu` union gains `'lang'`; `menuitemradio`; per-option `lang`/`dir`; label-in-name `aria-label`; `data-i18n-switcher` wrappers; Escape/outside-click unchanged; spec covers select `ar` → `dir === 'rtl'` + focus back, Escape without change, option `lang`.
- Validation notes: A5 — check icon branch; prefer `[class.invisible]` if hydration warns.
- Implementation details: key `ui.common.language`.

### Task 11.2: Remaining `ui` strings, formatting and RTL conversion — PENDING

- Depends on: Task 11.1
- Files: `$ROOT/libs/web/ui/src/lib/{footer.component.ts,countdown-timer.component.ts,console/**,session-calendar/**}`, `$ROOT/libs/web/ui/src/lib/i18n/{en,ar}.json`
- Plan reference: implementation-plan.md:562-563, :474-480, :512-528
- Pattern to follow: design-spec §3.1-3.2
- Quality requirements: verbatim English values (rule 7); `console-grid-background` `rtl-exempt`; icons mirrored per §3.2.
- Validation notes: prerendered routes render `ui` chrome.
- Implementation details: none beyond the above.

### Task 11.3: `i18n-check` target and copy review — PENDING

- Depends on: Task 11.2
- Files: `$ROOT/libs/web/ui/project.json`, `$ROOT/.ptah/specs/TASK_2026_575_fee7/copy-review/ui.md`
- Plan reference: implementation-plan.md:345-351, :716-727
- Pattern to follow: plan:348 command (no `--allow-scope`)
- Quality requirements: target exits 0; report any new glossary terms (do not edit glossary).
- Validation notes: none.
- Implementation details: none.

### Batch 11 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-ui`; `prerender-check`; `review-tables --check` for `ui`.
- Reviewer: visual (switcher vs prototype, dark + light) and logic.

## Batch 12: Panel switcher and panel shell (PANEL) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none (rerun frontend-developer)
- Execution mode: sequential
- Rationale: rendered component with keyboard semantics.
- Tasks: 3 | Depends on: Batch 11
- Commit: `feat(web-panel-ui): add panel language switch and rtl panel shell`

### Task 12.1: `LanguageSwitch` radiogroup — PENDING

- Files: `$ROOT/libs/web/panel-ui/src/lib/language-switch/{language-switch.ts,language-switch.spec.ts}`
- Plan reference: implementation-plan.md:638-644, :652-656; design-spec.md §2.4 (:251), §2.6 (:459)
- Pattern to follow: `MemberThemeToggle` styling vocabulary
- Quality requirements: not exported from barrel; roving `tabIndex`; direction-aware Left/Right; spec: ArrowRight in `rtl` → `en`, in `ltr` → `ar`, `aria-checked`, label-in-name.
- Validation notes: none.
- Implementation details: reads `I18nService.direction()`.

### Task 12.2: `panel-layout` header markup, chevron, collapse re-key — PENDING

- Depends on: Task 12.1
- Files: `$ROOT/libs/web/panel-ui/src/lib/panel-layout/{panel-layout.html,panel-layout.ts}`, new/updated `panel-layout.spec.ts`
- Plan reference: implementation-plan.md:645-647, :57-59, :658
- Pattern to follow: design-spec §2.4 normative markup
- Quality requirements: `[class.rtl:rotate-90]` next to `[class.-rotate-90]` (N22); `collapsedGroups` keyed by index; spec proves collapse survives a switch.
- Validation notes: inputs arrive translated (rule 4) — panel-ui never translates `title`/nav labels.
- Implementation details: none.

### Task 12.3: Remaining panel-ui strings, formatting site, target, copy review — PENDING

- Depends on: Task 12.2
- Files: `$ROOT/libs/web/panel-ui/src/lib/{empty-state,detail-drawer,selection-toolbar,stat-tile,status-badge,tag-chip,thread-row}/**`, `$ROOT/libs/web/panel-ui/src/lib/i18n/{en,ar}.json`, `$ROOT/libs/web/panel-ui/project.json`, `copy-review/panelUi.md`
- Plan reference: implementation-plan.md:648
- Pattern to follow: Task 11.2
- Quality requirements: `i18n-check` exits 0; spec updates use the N13 recipe.
- Validation notes: `stat-tile.ts:45` type union must not be flagged.
- Implementation details: none.

### Batch 12 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-panel-ui`; `review-tables --check`.
- Reviewer: visual and logic.

## Batch 13: Download page (APP) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: one prerendered page with core messages.
- Tasks: 2 | Depends on: Batch 12
- Commit: `feat(landing): translate download page and add app i18n-check`

### Task 13.1: Download page strings, RTL, formatting — PENDING

- Files: `$ROOT/apps/ptah-landing-page/src/app/pages/download/download-page.component.ts` (+ spec if present), `$ROOT/apps/ptah-landing-page/src/app/i18n/{en,ar}.json`
- Plan reference: implementation-plan.md:822, :503, :474-480
- Pattern to follow: rule 3 consumer pattern
- Quality requirements: `sm:text-left` (:332) → logical; `toLocaleDateString` (:456) via `intlLocale()` inside a computed/template-called method, SSG output unchanged; release error via `I18nMessage` with `i18n-keys: core.*` marker.
- Validation notes: verbatim English values.
- Implementation details: none.

### Task 13.2: App `i18n-check` target and copy review — PENDING

- Depends on: Task 13.1
- Files: `$ROOT/apps/ptah-landing-page/project.json`, `copy-review/app.md`
- Plan reference: implementation-plan.md:437, :822
- Pattern to follow: plan:348
- Quality requirements: exits 0 with `--allow-scope ui,core`.
- Validation notes: `Intl.DateTimeFormat().resolvedOptions().timeZone` gets `i18n-format-exempt` if present.
- Implementation details: none.

### Batch 13 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p ptah-landing-page`; `prerender-check`; `review-tables --check`.
- Reviewer: logic and visual.

## Batch 14: Landing sections, part 1 (LND-1) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: GSAP sections needing per-section RTL decisions.
- Tasks: 3 | Depends on: Batch 13
- Commit: `feat(web-landing): translate hero, problem, pillars, comparison, builders`

### Task 14.1: Hero and pillars — PENDING

- Files: `$ROOT/libs/web/landing/src/lib/sections/{hero,pillars}/**`, landing `en/ar.json`
- Plan reference: implementation-plan.md:614-621; design-spec.md §3.5 (:650)
- Pattern to follow: design §3.5 table rows
- Quality requirements: verbatim English; logical utilities; icons per §3.2.
- Validation notes: prerendered route.
- Implementation details: none.

### Task 14.2: Problem and comparison (islands) — PENDING

- Depends on: Task 14.1
- Files: `$ROOT/libs/web/landing/src/lib/sections/{problem,comparison}/**`, landing JSON
- Plan reference: implementation-plan.md:617-618
- Pattern to follow: design §3.5
- Quality requirements: `problem-section` swaps slide direction by `direction()`; SVG chart and `comparison-tug-meter` are `dir="ltr"` islands; no `rtl:` variants inside islands.
- Validation notes: none.
- Implementation details: none.

### Task 14.3: Builders marquee flip and rebuild — PENDING

- Depends on: Task 14.2
- Files: `$ROOT/libs/web/landing/src/lib/sections/builders/**`, landing JSON
- Plan reference: implementation-plan.md:616, :77
- Pattern to follow: `builders-section.component.ts:486-504`
- Quality requirements: negate `from`/`to` when `rtl`; kill previous tween then rebuild on direction change; no leaked tweens.
- Validation notes: showcase-manifest identifiers stay out of translation values.
- Implementation details: none.

### Batch 14 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-landing`; `prerender-check`.
- Reviewer: visual and logic.

## Batch 15: Landing sections, part 2 (LND-2) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: completes the landing scope and its check target.
- Tasks: 3 | Depends on: Batch 14
- Commit: `feat(web-landing): translate remaining landing sections and add i18n-check`

### Task 15.1: `console/*` diagrams — PENDING

- Files: `$ROOT/libs/web/landing/src/lib/console/**`, landing JSON
- Plan reference: implementation-plan.md:619
- Pattern to follow: design §3.5
- Quality requirements: chronology kept; `rtl-exempt: <reason>` where physical.
- Validation notes: none.
- Implementation details: none.

### Task 15.2: cta, also-available, provider-strip, video-showcase, waitlist-form, device-frame, `landing-page.component` — PENDING

- Depends on: Task 15.1
- Files: remaining `$ROOT/libs/web/landing/src/lib/sections/**`, `$ROOT/libs/web/landing/src/lib/landing-page.component.ts`, landing JSON
- Plan reference: implementation-plan.md:477, :620-621
- Pattern to follow: plan:477 worked example (`cta-section.component.ts:78`)
- Quality requirements: arrow glyphs stay literal in `aria-hidden` `rtl:scale-x-[-1]` spans; `waitlist-form` `start-3.5`; `device-frame` logical.
- Validation notes: B2 whitespace preservation.
- Implementation details: none.

### Task 15.3: Landing `i18n-check` target and copy review — PENDING

- Depends on: Task 15.2
- Files: `$ROOT/libs/web/landing/project.json`, `copy-review/landing.md`
- Plan reference: implementation-plan.md:824
- Pattern to follow: plan:348
- Quality requirements: whole lib exits 0; report sentinel candidates are not needed here (admin/members only).
- Validation notes: none.
- Implementation details: none.

### Batch 15 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-landing`; `prerender-check`; `review-tables --check`.
- A1 re-confirmation: a unique `landing` en value appears in a lazy browser chunk, not in `main-*.js`.
- Reviewer: visual and logic.

## Batch 16: Legal, terms page and notice (LEG-1) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: long legal copy; split across two batches to keep the lane short.
- Tasks: 2 | Depends on: Batch 15
- Commit: `feat(web-legal): translate terms page and add governing-language notice`

### Task 16.1: Terms page strings with `[innerHTML]` policy — PENDING

- Files: `$ROOT/libs/web/legal/src/lib/terms-page.component.ts`, legal `en/ar.json`
- Plan reference: implementation-plan.md:622-625, :472
- Pattern to follow: rule 5 (tag allow-list `strong|em|code|a`, no router links in HTML)
- Quality requirements: verbatim English; `ptah.live` copy untouched.
- Validation notes: prerendered route.
- Implementation details: none.

### Task 16.2: Governing-language notice and falling-cubes exemption — PENDING

- Depends on: Task 16.1
- Files: `$ROOT/libs/web/legal/src/lib/{terms-page,privacy-page,refund-page}.component.ts` (notice block only), `$ROOT/libs/web/legal/src/lib/components/falling-cubes-background.component.ts`, legal JSON
- Plan reference: implementation-plan.md:624-625; design-spec.md §3.8 (:845)
- Pattern to follow: design §3.8
- Quality requirements: `@if (i18n.lang() === 'ar')` notice below `<h1>` on all three; `rtl-exempt` on falling-cubes.
- Validation notes: A5 structural branch; English prerender unaffected.
- Implementation details: none.

### Batch 16 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-legal`; `prerender-check`.
- Reviewer: logic and visual.

## Batch 17: Legal, privacy and refund (LEG-2) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: completes legal scope.
- Tasks: 2 | Depends on: Batch 16
- Commit: `feat(web-legal): translate privacy and refund pages and add i18n-check`

### Task 17.1: Privacy and refund strings — PENDING

- Files: `$ROOT/libs/web/legal/src/lib/{privacy-page,refund-page}.component.ts`, legal JSON
- Plan reference: implementation-plan.md:622-623
- Pattern to follow: Task 16.1
- Quality requirements: as Task 16.1.
- Validation notes: none.
- Implementation details: none.

### Task 17.2: Legal `i18n-check` target and copy review — PENDING

- Depends on: Task 17.1
- Files: `$ROOT/libs/web/legal/project.json`, `copy-review/legal.md`
- Plan reference: implementation-plan.md:825
- Pattern to follow: plan:348
- Quality requirements: exits 0; notice rows noted in the table.
- Validation notes: none.
- Implementation details: none.

### Batch 17 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-legal`; `prerender-check`; `review-tables --check`.
- Reviewer: logic.

## Batch 18: Pricing (PRC) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: one lib, price split and core messages.
- Tasks: 2 | Depends on: Batch 17
- Commit: `feat(web-pricing): translate pricing with ltr price islands`

### Task 18.1: Pricing page, hero, grid, utils — PENDING

- Files: `$ROOT/libs/web/pricing/src/lib/**`, pricing JSON
- Plan reference: implementation-plan.md:626, :505, :476
- Pattern to follow: plan:476 split example
- Quality requirements: `$29` in `.ltr-island`, suffix key `pricing.plan.perMonth`, extracted text still `$29/mo`; Paddle `error`/`validationError` rendered as `I18nMessage` with `i18n-keys: core.checkout.*`; N13 spec recipe includes `core`.
- Validation notes: numeric values never in translation values.
- Implementation details: none.

### Task 18.2: Pricing `i18n-check` target and copy review — PENDING

- Depends on: Task 18.1
- Files: `$ROOT/libs/web/pricing/project.json`, `copy-review/pricing.md`
- Plan reference: implementation-plan.md:826
- Quality requirements: exits 0.
- Pattern to follow: plan:348
- Validation notes: none.
- Implementation details: none.

### Batch 18 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-pricing`; `prerender-check`; `review-tables --check`.
- Reviewer: logic and visual.

## Batch 19: Auth (AUTH) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: one lib, CSR-only.
- Tasks: 2 | Depends on: Batch 18
- Commit: `feat(web-auth): translate auth pages and convert hero css to logical`

### Task 19.1: Auth components, validation messages, hero raw CSS — PENDING

- Files: `$ROOT/libs/web/auth/src/lib/**`, auth JSON
- Plan reference: implementation-plan.md:627
- Pattern to follow: design §3.5 auth-hero row
- Quality requirements: `auth-hero.component.ts:173-184` → `inset-inline-*`; validation messages in TS via `translate` at event time or keys; emails `.ltr-island`.
- Validation notes: none.
- Implementation details: none.

### Task 19.2: Auth `i18n-check` target and copy review — PENDING

- Depends on: Task 19.1
- Files: `$ROOT/libs/web/auth/project.json`, `copy-review/auth.md`
- Plan reference: implementation-plan.md:827
- Pattern to follow: plan:348
- Quality requirements: exits 0.
- Validation notes: none.
- Implementation details: none.

### Batch 19 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-auth`; `review-tables --check`.
- Reviewer: logic.

## Batch 20: Account (ACC) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: one lib, CSR-only.
- Tasks: 2 | Depends on: Batch 19
- Commit: `feat(web-account): translate profile, sessions and contact pages`

### Task 20.1: Profile, sessions, contact — PENDING

- Files: `$ROOT/libs/web/account/src/lib/**`, account JSON
- Plan reference: implementation-plan.md:628, :502
- Pattern to follow: Component 7 method-formatter rule
- Quality requirements: `profile-details.component.ts:530` and `profile-header.component.ts:303` read `intlLocale()` inside computed/template method; license keys and emails `.ltr-island`.
- Validation notes: none.
- Implementation details: none.

### Task 20.2: Account `i18n-check` target and copy review — PENDING

- Depends on: Task 20.1
- Files: `$ROOT/libs/web/account/project.json`, `copy-review/account.md`
- Plan reference: implementation-plan.md:828
- Pattern to follow: plan:348
- Quality requirements: exits 0.
- Validation notes: none.
- Implementation details: none.

### Batch 20 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-account`; `review-tables --check`.
- Reviewer: logic.

## Batch 21: Members shell and small areas (MEM-1a) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: shell wiring plus small folders.
- Tasks: 2 | Depends on: Batch 20
- Commit: `feat(web-members): translate member shell, hub and small areas`

### Task 21.1: `member-layout` and nav keys — PENDING

- Files: `$ROOT/libs/web/members/src/lib/member-layout/**`, `$ROOT/libs/web/members/src/lib/member-nav.config.ts`, `$ROOT/libs/web/members/src/lib/members.routes.ts` (verify only), members JSON
- Plan reference: implementation-plan.md:661-669, :829
- Pattern to follow: `member-layout.html:48` `[title]` precedent
- Quality requirements: email span per plan:665 (N23 `[title]`); nav config holds `*_I18N_KEYS`; `title`/`badgeLabel`/labels via `computed` over `lang()`.
- Validation notes: `members.routes.spec.ts` untouched and green.
- Implementation details: none.

### Task 21.2: account, hub, notifications, packs, search, shared — PENDING

- Depends on: Task 21.1
- Files: `$ROOT/libs/web/members/src/lib/{account,hub,notifications,packs,search,shared}/**`, members JSON
- Plan reference: implementation-plan.md:829
- Pattern to follow: Task 21.1
- Quality requirements: formatting via pipes; fixtures not translated.
- Validation notes: none.
- Implementation details: none.

### Batch 21 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-members`.
- Reviewer: logic and visual.

## Batch 22: Members services and state (MEM-1b) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: user messages built in services.
- Tasks: 1 | Depends on: Batch 21
- Commit: `feat(web-members): return translatable messages from member services`

### Task 22.1: services and state user messages — PENDING

- Files: `$ROOT/libs/web/members/src/lib/{services,state}/**`, members JSON
- Plan reference: implementation-plan.md:467, :829
- Pattern to follow: rule 3 `I18nMessage`
- Quality requirements: services return keys, templates translate; specs updated.
- Validation notes: none.
- Implementation details: none.

### Batch 22 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-members`.
- Reviewer: logic.

## Batch 23: Members community and live (MEM-2) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: UGC direction handling.
- Tasks: 1 | Depends on: Batch 22
- Commit: `feat(web-members): translate community and live with ugc direction`

### Task 23.1: community and live — PENDING

- Files: `$ROOT/libs/web/members/src/lib/{community,live}/**`, members JSON
- Plan reference: implementation-plan.md:830, :527
- Pattern to follow: design-spec §3.4 (:642)
- Quality requirements: `dir="auto"` at UGC render elements; formatting via pipes / `intlLocale()`.
- Validation notes: `markdown-chokepoint.spec.ts` stays green.
- Implementation details: none.

### Batch 23 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-members`.
- Reviewer: logic and visual.

## Batch 24: Members learning and check target (MEM-3) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: completes members scope.
- Tasks: 2 | Depends on: Batch 23
- Commit: `feat(web-members): translate learning and add members i18n-check`

### Task 24.1: learning — PENDING

- Files: `$ROOT/libs/web/members/src/lib/learning/**`, members JSON
- Plan reference: implementation-plan.md:831
- Pattern to follow: Batch 23
- Quality requirements: `learning-fixtures.ts` not translated; `youtube-embed-chokepoint.spec.ts` green.
- Validation notes: none.
- Implementation details: none.

### Task 24.2: Members `i18n-check` target, copy review, e2e sentinel — PENDING

- Depends on: Task 24.1
- Files: `$ROOT/libs/web/members/project.json`, `copy-review/members.md`
- Plan reference: implementation-plan.md:699, :831
- Pattern to follow: plan:348
- Quality requirements: whole lib exits 0; report one members-unique `en.json` value as the lazy-scope sentinel for Batch 33.
- Validation notes: none.
- Implementation details: none.

### Batch 24 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-members`; `review-tables --check`.
- Reviewer: logic.

## Batch 25: Admin shell, list, detail, overview (ADM-1a) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: shell wiring first.
- Tasks: 2 | Depends on: Batch 24
- Commit: `feat(web-admin): translate admin shell, list, detail and overview`

### Task 25.1: `admin-layout`, nav keys, `admin-models.config.ts`, routes check — PENDING

- Files: `$ROOT/libs/web/admin/src/lib/admin-layout/**`, `$ROOT/libs/web/admin/src/lib/admin-models.config.ts`, `$ROOT/libs/web/admin/src/lib/admin.routes.ts` (verify only), admin JSON
- Plan reference: implementation-plan.md:661-669, :832
- Pattern to follow: Task 21.1
- Quality requirements: email span per plan:665; nav keys; translated shell inputs.
- Validation notes: admin route specs untouched.
- Implementation details: none.

### Task 25.2: `admin-list`, `admin-detail`, `overview` — PENDING

- Depends on: Task 25.1
- Files: `$ROOT/libs/web/admin/src/lib/{admin-list,admin-detail,overview}/**`, admin JSON
- Plan reference: implementation-plan.md:832, :478
- Pattern to follow: design-spec §3.2 (:600)
- Quality requirements: CSR-only, glyph-to-icon conversion allowed per design.
- Validation notes: none.
- Implementation details: none.

### Batch 25 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-admin`.
- Reviewer: logic and visual. Orchestrator: ask the admin review-depth question before sending admin tables.

## Batch 26: Admin shared components (ADM-1b) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: modals and data-table.
- Tasks: 1 | Depends on: Batch 25
- Commit: `feat(web-admin): translate admin modals and data table`

### Task 26.1: `components/*` modals, pickers, data-table — PENDING

- Files: `$ROOT/libs/web/admin/src/lib/components/**`, admin JSON
- Plan reference: implementation-plan.md:832
- Pattern to follow: design-spec §3.2
- Quality requirements: `→` literals in `data-table` become mirrored icons; `data-table.ts:203` union not flagged.
- Validation notes: none.
- Implementation details: none.

### Batch 26 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-admin`.
- Reviewer: logic and visual.

## Batch 27: Admin groups, users, failed webhooks, services (ADM-2a) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: sub-folder bounded.
- Tasks: 1 | Depends on: Batch 26
- Commit: `feat(web-admin): translate groups, users, webhooks and service messages`

### Task 27.1: groups, users, failed-webhooks, services — PENDING

- Files: `$ROOT/libs/web/admin/src/lib/{groups,users,failed-webhooks,services}/**`, admin JSON
- Plan reference: implementation-plan.md:833, :467
- Pattern to follow: rule 3
- Quality requirements: service user messages as keys.
- Validation notes: none.
- Implementation details: none.

### Batch 27 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-admin`.
- Reviewer: logic.

## Batch 28: Admin waitlist (ADM-2b) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: 10 source files with 6 specs.
- Tasks: 1 | Depends on: Batch 27
- Commit: `feat(web-admin): translate waitlist`

### Task 28.1: waitlist — PENDING

- Files: `$ROOT/libs/web/admin/src/lib/waitlist/**`, admin JSON
- Plan reference: implementation-plan.md:833
- Pattern to follow: Batch 27
- Quality requirements: dates via `i18nDate`; emails `.ltr-island`.
- Validation notes: none.
- Implementation details: none.

### Batch 28 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-admin`.
- Reviewer: logic.

## Batch 29: Admin marketing (ADM-3a) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: 18 source files.
- Tasks: 1 | Depends on: Batch 28
- Commit: `feat(web-admin): translate marketing`

### Task 29.1: marketing — PENDING

- Files: `$ROOT/libs/web/admin/src/lib/marketing/**`, admin JSON
- Plan reference: implementation-plan.md:834
- Pattern to follow: `marketing-segment-labels.ts` becomes an `*_I18N_KEYS` map
- Quality requirements: metrics via `i18nNumber`.
- Validation notes: none.
- Implementation details: none.

### Batch 29 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-admin`.
- Reviewer: logic.

## Batch 30: Admin builders packs and courses (ADM-3b) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: 20 source files.
- Tasks: 1 | Depends on: Batch 29
- Commit: `feat(web-admin): translate pack and course builders`

### Task 30.1: `builders/packs`, `builders/courses` — PENDING

- Files: `$ROOT/libs/web/admin/src/lib/builders/{packs,courses}/**`, admin JSON
- Plan reference: implementation-plan.md:834-835
- Pattern to follow: Batch 29
- Quality requirements: as Batch 29.
- Validation notes: plan put courses in ADM-4; moved here for size (file-disjoint, same order).
- Implementation details: none.

### Batch 30 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck -p web-admin`.
- Reviewer: logic.

## Batch 31: Admin community and sessions builders, check target (ADM-4) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: completes admin scope.
- Tasks: 2 | Depends on: Batch 30
- Commit: `feat(web-admin): translate community and session builders, add i18n-check`

### Task 31.1: `builders/sessions` — PENDING

- Files: `$ROOT/libs/web/admin/src/lib/builders/sessions/**`, admin JSON
- Plan reference: implementation-plan.md:835
- Pattern to follow: Batch 29
- Quality requirements: formatting via pipes.
- Validation notes: none.
- Implementation details: none.

### Task 31.2: `builders/community`, admin `i18n-check` target, copy review, sentinel — PENDING

- Depends on: Task 31.1
- Files: `$ROOT/libs/web/admin/src/lib/builders/community/**`, admin JSON, `$ROOT/libs/web/admin/project.json`, `copy-review/admin.md`
- Plan reference: implementation-plan.md:835, :699
- Pattern to follow: design-spec §3.4
- Quality requirements: UGC `dir="auto"`; whole lib exits 0; report one admin-unique `en.json` value as the lazy-scope sentinel.
- Validation notes: none.
- Implementation details: none.

### Batch 31 verification

- `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p web-admin`; `review-tables --check`.
- Reviewer: logic and visual.

## Batch 32: Glossary top-up and copy-review regeneration — PENDING

- Recommended executor: backend-developer
- Fallback executor: devops-engineer
- Execution mode: sequential
- Rationale: plan:726 assigns glossary appends to the team-leader; the team-leader does not write code, so it is a batch fed by the lib reports.
- Tasks: 2 | Depends on: Batch 31
- Commit: `chore(scripts): extend i18n glossary and regenerate copy review tables`

### Task 32.1: Append reported glossary terms — PENDING

- Files: `$ROOT/tools/i18n-check/glossary.json`
- Plan reference: implementation-plan.md:726, :365
- Pattern to follow: existing entries
- Quality requirements: the team-leader passes the collected term list in the prompt; no term may break a check.
- Validation notes: if the list is empty, the batch is reduced to Task 32.2.
- Implementation details: none.

### Task 32.2: Regenerate all copy-review tables and glossary.md; run every check — PENDING

- Depends on: Task 32.1
- Files: `$ROOT/.ptah/specs/TASK_2026_575_fee7/copy-review/{app,ui,panelUi,core,landing,legal,pricing,auth,account,members,admin,glossary}.md`
- Plan reference: implementation-plan.md:856-861
- Pattern to follow: n/a
- Quality requirements: `node_modules/.bin/nx run-many -t i18n-check -p ptah-landing-page web-ui web-panel-ui web-core web-landing web-legal web-pricing web-auth web-account web-members web-admin` exits 0; `review-tables --check` clean for all 11.
- Validation notes: do not create `SIGNOFF.md` (user and team-leader owned).
- Implementation details: none.

### Batch 32 verification

- The run-many above, `nx run i18n-check:self-test`, `nx build ptah-landing-page` and `prerender-check` pass.
- Reviewer: logic.

## Batch 33: i18n E2E suite with A4 English control (E2E) — PENDING

- Recommended executor: senior-tester
- Fallback executor: frontend-developer
- Execution mode: sequential
- Rationale: Playwright against the static production build.
- Tasks: 4 | Depends on: Batches 11-18, 32
- Commit: `test(e2e): add i18n playwright suite for switching, prepaint and rtl`

### Task 33.1: Config, helpers and specs (N12 applied) — PENDING

- Files: `$ROOT/apps/ptah-landing-page-e2e/playwright.i18n.config.ts`, `$ROOT/apps/ptah-landing-page-e2e/src/support-i18n/i18n.ts`, `$ROOT/apps/ptah-landing-page-e2e/src/specs-i18n/{language-switch,prepaint-hydration,arabic-font,lazy-scopes,rtl-layout}.spec.ts`, `$ROOT/apps/ptah-landing-page-e2e/{project.json,tsconfig.spec.json}`
- Plan reference: implementation-plan.md:671-714; implementation-plan-review.md:59-66
- Pattern to follow: `$ROOT/apps/ptah-landing-page-e2e/playwright.checkout.config.ts`
- Quality requirements: no backend `globalSetup`, `workers: 1`; install chromium (`npx playwright install chromium`) first; N12 — font spec uses `document.fonts.load('700 16px "IBM Plex Sans Arabic"', 'ع')` with length > 0 and asserts `#ptah-font-ar` exists; lazy-scope sentinels from Batches 24 and 31 reports (team-leader passes them); `serve-static` has `spa: true` — a spec asserts the first `/pricing` response body contains the baseline `h1`; if not, switch `webServer` to a plain static server.
- Validation notes: no retries into a pass; timeouts on `data-app-stable` are reported as A4.
- Implementation details: target `e2e:i18n`.

### Task 33.2: A4 English control run FIRST — PENDING

- Depends on: Task 33.1
- Files: none (evidence)
- Plan reference: implementation-plan.md:114-115, :695, :869; context.md Gate 2
- Pattern to follow: n/a
- Quality requirements: run `prepaint-hydration` in English on all 6 routes; record for each route whether `html[data-app-stable="true"]` appears and any NG0506/NG05xx.
- Validation notes — CONDITIONAL, decided by the user at Gate 2, do not ask again:
  - Control PASSES → report "A4 CONTROL PASSED" with per-route evidence; continue to Task 33.3. The team-leader then removes the contingent section below and tells the orchestrator to cancel TASK_2026_576_54d7 with this evidence.
  - Control FAILS on stability (marker never appears, NG0506, zone busy) → report "A4 CONTROL FAILED" with evidence (console output, which routes); do NOT judge the Arabic 3.6 run, do NOT attempt the zone fix. Run and report every other spec. The team-leader activates the contingent TASK_2026_576 batch on this branch.
  - Control fails for any other reason → ordinary defect, fixed in this batch.
- Implementation details: none.

### Task 33.3: Full `e2e:i18n` run (only if the control passed) — PENDING

- Depends on: Task 33.2
- Files: none (evidence)
- Plan reference: implementation-plan.md:689-706, :853
- Pattern to follow: n/a
- Quality requirements: `node_modules/.bin/nx run ptah-landing-page-e2e:e2e:i18n` green; A5 evidence (no NG05xx on legal routes in `ar`); rtl-layout screenshots attached per section and width.
- Validation notes: A5 fallback (`[class.invisible]`) belongs to the UI batch's files — report, do not patch them here unless the team-leader says so.
- Implementation details: none.

### Task 33.4: Existing English e2e (7.5) — PENDING

- Depends on: Task 33.2
- Files: none (evidence)
- Plan reference: implementation-plan.md:863
- Pattern to follow: `$ROOT/apps/ptah-landing-page-e2e/src/support/global-setup.ts`
- Quality requirements: run `node_modules/.bin/nx run ptah-landing-page-e2e:e2e`; if its backend cannot start in this container, report the exact reason — it then becomes a QA/CI item recorded at Mode 3, not silently skipped.
- Validation notes: none.
- Implementation details: none.

### Batch 33 verification

- Suite files exist; A4 outcome recorded with evidence; if control passed, `e2e:i18n` green; 7.5 result or documented environment reason.
- If control failed: batch is committed with the suite once all non-3.6 specs pass; 3.6 acceptance moves to the contingent batch.
- Reviewer: logic (test honesty, no retry-to-pass).

---

## Contingent: TASK_2026_576_54d7 activation (not counted until activated)

Activation rule: activated by the team-leader in Mode 2 of Batch 33 if and only if Task 33.2 reports "A4 CONTROL
FAILED" on stability. Then this section becomes `## Batch 34: App stability under GSAP and Lenis (TASK_2026_576) —
PENDING`, the batch count becomes 34, and the orchestrator moves TASK_2026_576_54d7 to in_progress. If the control
passes, this section is deleted and the orchestrator cancels TASK_2026_576_54d7 with the Task 33.2 evidence.

- Recommended executor: frontend-developer
- Fallback executor: senior-tester (diagnosis only)
- Execution mode: sequential
- Commit: `fix(web-landing): run animation loops outside the angular zone` (scope adjusted to the libs touched)
- Task 34.1: Diagnose which loops keep the zone unstable (GSAP ticker, ScrollTrigger, Lenis, `falling-cubes-background`, builders marquee, `comparison-tug-meter`, `pillars-spine`), with and without each source — evidence per source. Reference: `$ROOT/.ptah/specs/TASK_2026_576_54d7/task.md`.
- Task 34.2: Run those loops via `NgZone.runOutsideAngular` (or the library's own option), re-entering the zone only for binding state; no visual or timing change; existing landing unit and e2e tests stay green.
- Task 34.3: Re-run `nx run ptah-landing-page-e2e:e2e:i18n` — English control and Arabic 3.6 both pass on all 6 routes, no NG0506.
- Verification: `node_modules/.bin/nx run-many -t lint,test,typecheck,i18n-check -p <libs touched>`; `prerender-check`; `e2e:i18n` green. Reviewer: logic.
