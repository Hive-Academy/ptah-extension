# Code Style Review — `TASK_2026_575_fee7`

## Batch 8 — round 2

### Summary

| Metric          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Overall score   | 9/10                                                                   |
| Assessment      | APPROVED                                                               |
| Blocking issues | 0                                                                      |
| Serious issues  | 0                                                                      |
| Moderate issues | 0                                                                      |
| Minor issues    | 0                                                                      |
| Files reviewed  | round-1's 41, plus the extra Sonar fix to `progress-meter.spec.ts:116` |

Scope: verification of the three round-1 carry-overs plus the executor's
extra Sonar fix. All checked directly on disk against the working tree, not
taken from the executor's report.

### Findings verified

1. **Serious (naming vs behaviour) — FIXED.** `expect-scope-loads.ts`/`.spec.ts`
   are gone (`git status` shows no such paths, tracked or untracked);
   `libs/frontend/i18n/src/testing/load-scope-translations.ts` replaces it
   with the same 11-line body under a verb-first name that now matches the
   library's own convention (`loadScope`/`loadScopes`,
   `i18n.service.ts:121,209`). `grep -rn expectScopeLoads libs apps` returns
   nothing — no alias, no leftover reference, no stale doc mention.
   `testing/index.ts:6` exports the renamed symbol in the same place;
   `CLAUDE.md`'s "Specs" section (the canonical recipe) and its layout
   diagram both now say `loadScopeTranslations`, and the JSDoc on
   `unwrapJsonModule` (`i18n.service.ts:257-261`) was updated in lockstep to
   name the new helper. `grep -rl "loadScopeTranslations(" apps/.../i18n
libs/web/*/src/lib/i18n` finds all 11 call sites (the five Batch 7 specs
   plus the six Batch 8 specs); none still reads the old name. The spec file
   itself (`load-scope-translations.spec.ts`) renamed its `describe` block
   and every call site consistently — no partial rename anywhere.

2. **Moderate (stale barrel comment) — FIXED.**
   `progress-meter.spec.ts:200-202` now reads: "`libs/web/members/src/index.ts`
   stays narrow: everything it exports must be usable inside the app's
   `import()` callback (`MEMBER_ROUTES` and the translation scopes), never a
   member component like this one." This states the barrel's actual current
   contract (matching `libs/web/members/src/index.ts:1-14`'s own updated
   intent comment from round 1) instead of the pre-Batch-8 "exports
   `MEMBER_ROUTES` and nothing else" claim. The assertion itself
   (`expect(barrel).not.toContain('progress-meter')`) is untouched, so no
   behavioural risk from the edit — this was a comment-only fix to a comment-only
   problem, correctly scoped.

3. **Minor (spec coverage narrower than its docstring) — FIXED, and slightly
   exceeds what was asked.** `load-scope-translations.spec.ts` now has 5
   `it` blocks: the two round-1 cases (unwraps a real scope; unwraps a module
   wrapper while keeping a real `default` section) plus three rejection
   cases — `ar` resolves to a non-translation, `en` resolves to a
   non-translation (new; the round-1 gap), and a loader that genuinely
   rejects (`Promise.reject(chunkError)`, asserted with
   `.rejects.toBe(chunkError)`, confirming the raw rejection propagates
   unchanged through `Promise.all`, not wrapped or swallowed). This closes
   the exact gap the round-1 minor named — the docstring's "a loader that
   rejects rejects this call" claim is now backed by a case that rejects via
   an actual promise rejection, not only via a value that fails the
   `I18nError` unwrap.

### Extra edit: `declarations.sort()` → `declarations.sort((a, b) => a.localeCompare(b))`

- File: `libs/web/members/src/lib/learning/components/progress-meter.spec.ts:116`
- Not part of round 1's carry-over; the executor's own report attributes it
  to the SonarJS gate (`batches.md`'s "Execution defaults": no `.sort()`
  without a comparator).
- Judged acceptable. `declarations` (`:112-114`) is
  `[...source.matchAll(/public readonly (\w+) = input/g)].map((m) => m[1])` —
  every element is a lowercase-ASCII property identifier matched from
  `\w+` on a TS source file (`completed`, `label`, `total`, `unit` are the
  only values this regex can ever produce for this component). For that
  input set `localeCompare` and the default UTF-16 comparator produce the
  identical order, so the expected array (`:117-120`) needed no change and
  none was made. The fix is minimal, in-scope for what it touches (one line,
  the comparator only), and does not weaken or change the test's assertion —
  it only makes the sort's ordering explicit instead of relying on the
  default coercion-based comparator, which is what the gate exists to catch.
  This is a legitimate, narrowly-scoped incidental fix, not scope creep: it
  touches a line the batch's own executor was already editing in this same
  file for the round-1 minor, in service of a repository-wide gate every
  batch must pass (`batches.md`'s "Execution defaults" — the SonarJS
  reliability gate), not a stylistic preference introduced on its own
  initiative.

### File-by-file (delta from round 1)

- `libs/frontend/i18n/src/testing/load-scope-translations.ts` + spec: 6/10 → 9/10.
- `libs/frontend/i18n/src/lib/i18n.service.ts`, `testing/index.ts`, `CLAUDE.md`: 9/10 → 9/10 (already clean; JSDoc/recipe text updated for the rename, same shape).
- Six new scopes (`legal`, `pricing`, `auth`, `account`, `members`, `admin`): 8/10 → 9/10 (the members-barrel-comment moderate is closed; nothing else in this group changed).

### Pattern compliance (delta from round 1)

| Repository rule or nearby convention                               | Status             | Evidence                                                           |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------ |
| `expect*`-named testing helper asserts internally (repo precedent) | N/A (renamed away) | `load-scope-translations.ts:13-23`, no `expect*` name in this file |
| A file describing another file's contract stays accurate           | PASS               | `progress-meter.spec.ts:200-202`                                   |
| `.sort()` always has an explicit comparator (SonarJS gate)         | PASS               | `progress-meter.spec.ts:116`                                       |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none remaining from round 1; all three findings verified fixed
  directly on disk, not only via the executor's report.
- What a 10/10 version would do differently: nothing further — round 2 closes
  every round-1 item at the scope it was raised, with no new drift
  introduced.

## Batch 8

### Summary

| Metric          | Value                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall score   | 7/10                                                                                                                                                                |
| Assessment      | NEEDS_REVISION                                                                                                                                                      |
| Blocking issues | 0                                                                                                                                                                   |
| Serious issues  | 1                                                                                                                                                                   |
| Moderate issues | 1                                                                                                                                                                   |
| Minor issues    | 1                                                                                                                                                                   |
| Files reviewed  | 41 (2 new + spec in `libs/frontend/i18n/src/testing`, 3 modified there, 24 new scope files across 6 libs, 12 modified `index.ts`/`tsconfig.json`/`jest.config.cts`) |

Scope: Task 8.0 (`expectScopeLoads` helper and the five Batch 7 spec
conversions) and Tasks 8.1-8.2 (scopes for `legal`, `pricing`, `auth`,
`account`, `members`, `admin`, plus `MEMBERS_I18N_SCOPES`/
`ADMIN_I18N_SCOPES`). Read in full: `expect-scope-loads.ts` + spec,
`i18n.service.ts` (the `unwrapJsonModule` export), `testing/index.ts`,
`CLAUDE.md`, every new `en.json`/`ar.json`/`<name>.i18n-scope.ts`/
`<name>.i18n-scope.spec.ts`, every touched `index.ts`/`tsconfig.json`/
`jest.config.cts`, `members/src/index.ts` at `HEAD` vs working tree, and
`libs/web/members/src/lib/learning/components/progress-meter.spec.ts`
(untouched by this batch, but its assertion's own comment is examined against
the barrel this batch changed). Compared against `implementation-plan.md:409-421`
(the resolver table that requires `MEMBERS_I18N_SCOPES`/`ADMIN_I18N_SCOPES` to
be reachable only inside a dynamic `import()` callback) and against
`libs/shared/src/testing/path/expect-normalized-path.ts`, the repository's one
other `expect*`-named testing helper. Verified by grep: no remaining local
`unwrap()` copies anywhere under `apps/ptah-landing-page/src/app/i18n` or
`libs/web/*/src/lib/i18n` (all five Batch 7 specs and all six new specs use
`expectScopeLoads`). Not run myself: `nx run-many -t lint,test,typecheck`
(delegated to Batch 8's own verification step per `batches.md:622`).

### Five style questions

#### 1. What breaks when requirements change in six months?

`libs/frontend/i18n/src/testing/expect-scope-loads.ts:13-23` is named for what
Jest convention says a helper starting with `expect` does — assert and throw —
but it only loads and returns data (`Promise<Record<SupportedLang,
Translation>>`); every call site still wraps it in a real `expect(...)`
(`expect(await expectScopeLoads(SCOPE)).toEqual({ en, ar })`, e.g.
`libs/web/legal/src/lib/i18n/legal.i18n-scope.spec.ts:12-14`). Six months from
now, someone adding a seventh scope spec, or reusing this helper in a
non-scope test, will read `expectScopeLoads(x)` on its own line and expect it
to assert by itself — the repository has exactly this convention already,
at `libs/shared/src/testing/path/expect-normalized-path.ts:39-41`
(`expectNormalizedPath` calls `expect().toBe()` internally and returns
`void`). The mismatch is silent (no compile error, no runtime failure) until
someone drops the outer `expect(...)`, at which point a rejected loader or a
wrong translation shape is swallowed as an unawaited/unchecked promise instead
of failing the test loudly. See Serious issue below.

#### 2. What would a new team member misread?

`libs/web/members/src/lib/learning/components/progress-meter.spec.ts:200`
still reads `// \`libs/web/members/src/index.ts\` exports MEMBER_ROUTES and
nothing else.`This batch made that comment false: the barrel now also
exports`MEMBERS_I18N_SCOPE`/`MEMBERS_I18N_SCOPES`
(`libs/web/members/src/index.ts:26-29`, working tree). The assertion below it
(`expect(barrel).not.toContain('progress-meter')`) still passes, so nothing
breaks today, but a reader hitting that comment while investigating the
barrel's contract is told something the same batch just made untrue. See
Moderate issue below.

#### 3. What does this cost to maintain?

Very little net cost — this batch is the Batch 7 carry-over doing exactly what
it promised: one helper (`expect-scope-loads.ts`, 23 lines) replaces six
identical 5-line `unwrap()` copies (five deleted from the Batch 7 specs, one
avoided in each of the six new Batch 8 specs), and it reuses
`unwrapJsonModule` instead of re-implementing the wrapper rule a seventh time.
The two outstanding costs are narrow: the naming mismatch above (a one-line
JSDoc plus a call-site convention now diverges from the repository's own
sibling), and the stale barrel comment (one line, already drifted).

#### 4. Where is this inconsistent with the rest of the repository?

- `expectScopeLoads`'s name is inconsistent with this repository's own
  `expect*` naming precedent (`expect-normalized-path.ts`) — see the Serious
  issue. Everywhere else in this same library, an async operation that
  performs work and returns a value is named for the verb it performs
  (`loadScope`/`loadScopes` in `i18n.service.ts:121,209`, `resolveInitialLang`,
  `defineI18nScope`), never `expect*`.
- Everything else in this batch is consistent with Batch 7 and with the
  library's own established shape: `unwrapJsonModule` is exported from
  `i18n.service.ts` but deliberately left out of the root barrel
  (`src/index.ts`) and documented as "library-internal" — this mirrors the
  existing precedent that `testing/provide-i18n-testing.ts` already imports
  directly from `../lib/*` files rather than through the barrel
  (`provide-i18n-testing.ts:17-19`); nothing new is introduced here. The six
  new eager libs' barrels (`legal`, `pricing`, `auth`, `account`) each append
  one `export * from './lib/i18n/<name>.i18n-scope';` line, matching the
  `export *` shape every one of those barrels already uses for every other
  symbol. The `tsconfig.json`/`jest.config.cts` edits across all six libs are
  byte-identical in shape to Batch 7's (`resolveJsonModule: true`; `@jsverse`
  and `@angular/common/locales` added to `transformIgnorePatterns`, with a
  comment explaining why, worded per-file to fit each config's existing
  comment).
- `members`/`admin` intentionally break from the "`export *`" pattern the
  other four libs use, exporting named symbols instead
  (`libs/web/members/src/index.ts:26-29`,
  `libs/web/admin/src/index.ts:2` uses `export *` but only two symbols exist
  behind it). That divergence is required, not accidental: both libs are
  lazy-loaded, and `@nx/enforce-module-boundaries` forbids any file in this
  workspace from statically importing a lazily-loaded lib's barrel
  (`libs/web/members/src/index.ts:9-17`, working tree, restates the rule this
  batch had to extend). The plan requires `MEMBERS_I18N_SCOPES`/
  `ADMIN_I18N_SCOPES` to be reached only inside a dynamic `import().then(...)`
  callback (`implementation-plan.md:416-417`), and the rewritten barrel
  comment states exactly that constraint and updates the "MUST STAY ONE
  SYMBOL" claim to "every export must be consumable inside an `import()`
  callback" — this is a correct, plan-required narrowing of the original
  intent (confirmed against `git show HEAD:libs/web/members/src/index.ts`),
  not a weakening of the lazy-loading boundary: nothing here becomes
  statically importable, and no component, service or other runtime code is
  newly exposed. Not a finding.

#### 5. What would you have done differently, and why is that better rather than merely other?

Name the helper `loadScopeTranslations` (or `resolveScopeTranslations`) to
match `loadScope`/`loadScopes` in the same library, and drop `expect` from
the name entirely — or, if the "read like `expect`" ergonomics at the call
site are wanted, make it actually assert (mirroring
`expectNormalizedPath`): `expectScopeLoads(scope, { en, ar })` performing the
`toEqual` internally and returning `void`, with the loader-rejection case
covered by `await expect(expectScopeLoads(...)).rejects.toBeInstanceOf(...)`
exactly as today. Either fix removes the same latent risk: a call site that
drops the outer `expect(...)` currently compiles and runs silently instead of
failing.

### Serious issues

### `expectScopeLoads` is named as an assertion but only returns data

- File: `libs/frontend/i18n/src/testing/expect-scope-loads.ts:6-23`
- Problem: the repository already has one `expect*`-prefixed testing helper —
  `libs/shared/src/testing/path/expect-normalized-path.ts:39-41` — and it
  calls `expect(...)` internally and returns `void`. `expectScopeLoads`
  breaks that local convention: it performs no assertion, returns
  `Promise<Record<SupportedLang, Translation>>`, and depends on every caller
  remembering to wrap it in its own `expect(...)` (which all 11 current call
  sites do, e.g. `libs/web/admin/src/lib/i18n/admin.i18n-scope.spec.ts` via
  the same pattern as `legal.i18n-scope.spec.ts:12-14`).
- Tradeoff: nothing breaks today because every existing call site wraps the
  result correctly, but the name actively misleads a future author into
  treating a bare `expectScopeLoads(scope)` call (with no outer `expect`) as
  a complete, self-checking assertion — Jest would not fail such a test even
  though nothing was verified, and TypeScript gives no signal either, since a
  dropped `expect(...)` around an awaited call is a silently discarded
  promise result, not a type error.
- Recommendation: rename to a verb that matches the library's own convention
  (`loadScopeTranslations`), or change the function to assert internally like
  its repository sibling. See style question 5 for both options in detail.

### Moderate issues

### Stale barrel-contents comment left by this batch's own change

- File: `libs/web/members/src/lib/learning/components/progress-meter.spec.ts:200`
- Problem: this batch changed the exact file the comment describes
  (`libs/web/members/src/index.ts`, adding `MEMBERS_I18N_SCOPE`/
  `MEMBERS_I18N_SCOPES` exports) but did not update the comment in this
  sibling spec that asserts against that same barrel's contents.
- Impact: the assertion (`not.toContain('progress-meter')`) still passes, so
  there is no test regression, but the comment now states something false
  about the barrel's surface, which a future reader auditing `§5.3 — it is
PRIVATE` would take at face value.
- Fix: reword the comment to state the actual current constraint (the barrel
  is narrow and everything in it must be consumable inside the lazy-loaded
  lib's `import()` callback — `libs/web/members/src/index.ts:1-14`
  already has the exact wording to draw from), or drop the file-contents
  claim from the comment and keep only "the panel's private internals,
  including `progress-meter`, are not exported."

### Minor issues

- `libs/frontend/i18n/src/testing/expect-scope-loads.spec.ts:32-39`: the
  "rejects when a loader fails" case only exercises `ar` rejecting via
  `Promise.resolve(null)` (a non-object result, not an actual promise
  rejection) reaching `unwrapJsonModule`'s `I18nError` throw path inside
  `isPlainObject`; it never exercises an `en`-side failure or a genuinely
  rejected loader promise (`Promise.reject(...)`), both of which
  `Promise.all` in `expect-scope-loads.ts:16-21` also has to propagate
  correctly. Low cost since the `Promise.all` behaviour is standard, but the
  spec's own docstring implies broader coverage ("a loader that rejects
  rejects this call") than the single case tests.

## File-by-file

### `libs/frontend/i18n/src/testing/expect-scope-loads.ts` + spec

Score 6/10 — 0 blocking, 1 serious, 1 minor. Correct, small, and reuses
`unwrapJsonModule` rather than duplicating the wrapper rule; the naming
mismatch against the repository's own `expect*` convention
(`expect-normalized-path.ts`) is the whole deduction.

### `libs/frontend/i18n/src/lib/i18n.service.ts`, `src/testing/index.ts`, `CLAUDE.md`

Score 9/10 — 0/0/0. `unwrapJsonModule` is exported with a doc comment stating
it is deliberately kept out of the barrel and why; `testing/index.ts` adds one
export line in the same grouped style as the rest of the file; `CLAUDE.md`'s
layout diagram and "Specs" section are both updated to match, including the
canonical `expect(await expectScopeLoads(...)).toEqual(...)` recipe.

### Five Batch 7 spec conversions (`app`, `ui`, `core`, `panel-ui`, `landing`)

Score 9/10 — 0/0/0. Each drops its local `unwrap()` and the `it.each` table in
favour of one `expectScopeLoads` call, identically shaped across all five
files; nothing else in any of the five specs changed.

### Six new scopes (`legal`, `pricing`, `auth`, `account`, `members`, `admin`)

Score 8/10 — 0 blocking, 0 serious, 1 moderate (the members barrel-comment
drift lands here because the scope wiring is what caused it), 0 further
minor. Every scope file, spec, `tsconfig.json` and `jest.config.cts` matches
the Batch 7 pattern exactly; the `members`/`admin` barrel divergence into
named/`export *`-of-two-symbols exports is correct and plan-required
(`implementation-plan.md:416-417`), and its rewritten intent comment is
accurate for the file it lives in — the drift is only in the _other_ spec
file that quoted the old contract.

## Pattern compliance

| Repository rule or nearby convention                                            | Status | Evidence                                                                                    |
| ------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `expect*`-named testing helper asserts internally (repo precedent)              | FAIL   | `expect-scope-loads.ts:13-23` vs `expect-normalized-path.ts:39-41`                          |
| Local `unwrap()` copies replaced everywhere, none left behind                   | PASS   | grep across `apps/**/i18n`, `libs/web/*/src/lib/i18n` — zero matches                        |
| New scope file shape matches Batch 7 (`defineI18nScope`, `en`/`ar` `import()`)  | PASS   | e.g. `libs/web/account/src/lib/i18n/account.i18n-scope.ts:1-6`                              |
| `tsconfig.json` / `jest.config.cts` edits match Batch 7's shape and rationale   | PASS   | `libs/web/{legal,pricing,auth,account,members,admin}/{tsconfig.json,jest.config.cts}` diffs |
| Lazy-loaded lib barrel exports stay consumable only inside `import()`           | PASS   | `libs/web/members/src/index.ts:1-14`, `implementation-plan.md:416-417`                      |
| A file describing another file's contract stays accurate when that file changes | FAIL   | `progress-meter.spec.ts:200` vs `members/src/index.ts` (working tree)                       |
| `unwrapJsonModule` export documents why it bypasses the barrel                  | PASS   | `i18n.service.ts:257-261`                                                                   |

## Maintenance debt

- Introduced: one shared testing helper (`expectScopeLoads`, 23 lines) and its
  spec (40 lines); six new scope units following an established shape; one
  exported low-level function (`unwrapJsonModule`) with a documented,
  deliberately narrow reach.
- Retired: six independent `unwrap()` copies (5 deleted from Batch 7 specs,
  one avoided per new Batch 8 spec) — net duplication removed, exactly the
  Batch 7 carry-over's purpose.
- Net: reduction in duplication, offset by one small naming debt
  (`expectScopeLoads`) and one small documentation-drift debt
  (`progress-meter.spec.ts:200`), both cheap to close before merge.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `expectScopeLoads` reads, by this repository's own established
  `expect*` convention, as a self-asserting helper; it is not one, and that
  gap is currently masked only by every call site happening to wrap it
  correctly.
- What a 10/10 version would do differently: rename `expectScopeLoads` to a
  verb consistent with `loadScope`/`loadScopes` (or make it assert
  internally, matching `expectNormalizedPath`); update
  `progress-meter.spec.ts:200`'s comment to state the barrel's current,
  narrower contract instead of the pre-Batch-8 one.

## Batch 4

## Summary

| Metric          | Value                                 |
| --------------- | ------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 1                                     |
| Minor issues    | 4                                     |
| Files reviewed  | 15 (13 modified, 2 new + their specs) |

Scope: Task 4.1 (`review-tables.ts` + the Batch 3 carry-over fixes in
`main.ts`, `glossary.ts`, `ts-keys.ts`, `report.ts`) and Task 4.2 (`nx.json`,
`.github/workflows/ci.yml`). `literal-offsets.ts` is new, load-bearing for the
carry-over item on escaped inline templates. Verified: `nx run
i18n-check:self-test` (review-tables `--check` sub-check passes against the
committed `__fixtures__/project/copy-review/` tables), `nx run-many -t test -p
i18n-check` (green), `npx tsc --noEmit -p tools/i18n-check/tsconfig.json`
(clean), `nx run degradation-audit:lint` (i18n-check has no swallowed
catches — the tool isn't in that check's input glob, `libs/**` /
`apps/**`, so this is a no-op rather than a pass, noted for completeness).

## Five style questions

### 1. What breaks when requirements change in six months?

A third CLI entry point in this tool (the plan already has `check-prerender.ts`
coming in Batch 6, `tools/i18n-check/src/prerender/check-prerender.ts`) will
either duplicate the `UsageError`/`toRel`/project-root-validation/`main()`
bootstrap block a third time or someone will finally extract it — at which
point they have to reconcile three independently-evolved copies instead of
one. See `tools/i18n-check/src/main.ts:73-141` vs
`tools/i18n-check/src/review/review-tables.ts:67-130`.

### 2. What would a new team member misread?

`main.ts`'s `allowedScopeDefect` (`main.ts:360-375`) reads as "report a
problem with the allowed scope's file" but is keyed only off
`file.violations` filtered against `unreadable` — a reader has to trace back
to `run()` (`main.ts:410-418`) to see that `unreadable` is computed from the
_same_ `allowedEn.violations` array one call site up, just to know which
subset `allowedScopeDefect` is meant to receive. Passing the already-filtered
"structural" list in, rather than the raw violations plus the exclusion
list, would remove that indirection.

### 3. What does this cost to maintain?

The literal offset-mapping machinery (`literal-offsets.ts`, the
`InlineTemplate`/`TemplateSource` refactor in `template-keys.ts`, and
`inlineTemplateOf` in `ts-keys.ts`) is a real net addition of precision (see
Pattern compliance) but it is also the single densest, most failure-prone
piece of the tool: a hand-rolled ECMAScript string-literal decoder duplicating
logic the TypeScript compiler already computed once and discarded. The
`decoded.text !== init.text` guard (`ts-keys.ts:167-169`) is the right
defensive check — it makes a future TC39/TS escape-rule discrepancy fail
loud as a `parse-error` rather than mis-locate a marker — but the ~110 lines
in `literal-offsets.ts` are now a second implementation of literal decoding
that must be kept in sync with `ts.StringLiteral.text` by that guard alone,
forever.

### 4. Where is this inconsistent with the rest of the repository?

- `nx.json`'s new `targetDefaults["i18n-check"]` centralises `cache`/`inputs`
  for a target that will be declared per-consumer-project starting Batch 7.
  The tool's two existing siblings (`di-lint`, `degradation-audit`) instead
  put `"cache": true` and `"inputs"` directly on each tool's own single
  `lint` target in its own `project.json` (`tools/di-lint/project.json:8-19`,
  `tools/degradation-audit/project.json:8-19`) — there is no
  `targetDefaults["lint"]` entry keyed by target name in `nx.json`. This is a
  deliberate and justified divergence, not a defect: `di-lint`/
  `degradation-audit` are single-project tools, while `i18n-check` will be
  declared identically on ~11 downstream projects (plan `implementation-plan.md:352`), so one
  `targetDefaults` entry avoids repeating the same three `inputs` globs 11
  times. Worth a one-line comment in `nx.json` saying why this target breaks
  the sibling pattern, since a future reader comparing it to `di-lint`/
  `degradation-audit` will otherwise flag exactly this (as this review did,
  before checking the plan).
- The CI step naming, comment density and `node_modules/.bin/nx` (never
  `npx`) usage match the `degradation-audit` step exactly
  (`ci.yml:120-144` vs the new `ci.yml:146-165`) — this is the strongest
  compliance point in the batch.
- `review-tables.ts` duplicates `main.ts`'s CLI scaffolding verbatim rather
  than factoring it into `tools/i18n-check/src/lib/` alongside the other
  shared modules (`glossary.ts`, `report.ts`, `scope-map.ts`, …) that both
  entry points already import from. See Serious issue below.

### 5. What would you have done differently, and why is that better rather than merely other?

Extract a `tools/i18n-check/src/lib/cli.ts` exporting the `UsageError` class,
`toRel`, and a `resolveProjectRoot(scope, projectRoot)` helper (the
normalise-and-validate-against-`SCOPE_MAP` block) — following the same
"shared module both entry points import" shape the tool already uses for
`glossary.ts`/`report.ts`/`scope-map.ts`. That is better than leaving the two
copies because Task 4.1's own carry-over note proves the pattern already
drifts under real work: `main.ts`'s `parseArgs` loop enforces strict
alternating flag/value pairs (`main.ts:82`, `i += 2`), while
`review-tables.ts`'s loop was written to also recognise a bare `--check`
flag and so increments `i` conditionally (`review-tables.ts:85-100`,
`i += 1`) — the shared 60%, not the different 40%, is exactly what a `cli.ts`
would have kept in one place while still letting each file own its
own flag list.

## Blocking issues

None.

## Serious issues

### CLI scaffolding duplicated verbatim between `main.ts` and `review-tables.ts`

- File: `tools/i18n-check/src/main.ts:73-75,111-116,143-145,578-585` and
  `tools/i18n-check/src/review/review-tables.ts:67-69,114-119,132-134,368-375`
- Problem: `class UsageError extends Error { override readonly name =
'UsageError'; }`, `toRel()`, the `normalisedRoot`/`SCOPE_MAP[scope]`
  validation block, and the `if (require.main === module) { main().then(...).catch(...) }`
  bootstrap are byte-for-byte identical across both files (differing only in
  the tool-name string interpolated into error messages). `review-tables.ts`
  is new in this batch — introducing it was the moment to factor the shared
  shape out, not repeat it.
- Tradeoff: leaving it inline optimises for each file staying fully
  self-contained and readable top-to-bottom; a shared `lib/cli.ts` costs one
  more file and one more indirection to trace. But the tool already accepts
  that tradeoff for `glossary.ts`, `report.ts`, `scope-map.ts`, and
  `translation-files.ts` — all imported by both `main.ts` and
  `review-tables.ts` — so the CLI scaffolding is the one piece left
  unfactored for no stated reason, and Batch 6 is about to add a third
  entry point (`check-prerender.ts`, `implementation-plan.md:317-331`) that will either
  duplicate it again or force an extraction under time pressure later.
- Recommendation: extract `UsageError`, `toRel`, and a
  `resolveProjectRoot(scope, projectRoot): string` helper (wrapping the
  normalise + `SCOPE_MAP` match + throw) into `tools/i18n-check/src/lib/cli.ts`,
  imported by both `main.ts` and `review-tables.ts`. Leave the `main()`
  bootstrap block inline (it is three lines of boilerplate per file and
  differs in its label string; not worth a shared wrapper by itself).

## Minor issues

- `tools/i18n-check/src/main.ts:360-375` — `allowedScopeDefect` takes the raw
  `unreadable` list and re-derives "structural" from it via `!unreadable.includes(v)`
  rather than receiving the already-computed structural list; forces the
  reader to hold two related arrays in mind across the one call site at
  `main.ts:410-418`. See Five style questions, Q2.
- `tools/i18n-check/src/lib/literal-offsets.ts:35` — `LINE_TERMINATORS` holds
  the literal `U+2028`/`U+2029` characters directly in the source rather than
  `' '`/`' '` escapes. It works (verified via `codePointAt`), and a
  comment nearby would explain the choice, but an invisible character sitting
  in source as a bare literal is exactly the kind of thing a diff, a font
  substitution, or a copy-paste can silently corrupt without any lint catching
  it. A one-line comment or switching to the escaped form removes that risk
  for near-zero cost.
- `tools/i18n-check/src/main.ts` is 585 lines (561 before this batch's
  24-line carry-over addition), the largest file in the tool by a wide margin
  (next is `review-tables.ts` at 375, `ts-keys.ts` at 371). This predates
  Batch 4 and the batch's own addition (`allowedScopeDefect`) is small and
  well-placed, so this is not a Batch-4 regression — flagged only because the
  file keeps growing task-by-task (`KeyResolver`, `TargetMap`,
  `allowedScopeDefect` are all `run()`-only concerns bundled into the entry
  point rather than `src/lib/`). Worth a look before Batch 5/6 add more rules
  to the same file.
- CI comment at `.github/workflows/ci.yml:146-155` is excellent (explains the
  SIGPIPE/`grep -q` hazard, matching the discipline of the
  `degradation-audit` step's own comment on `npx` script-execution risk at
  `ci.yml:127-133`), but the step itself has no equivalent inline comment
  inside `nx.json` explaining why `i18n-check`'s `targetDefaults` entry is
  keyed by plain target name rather than following the executor-name keying
  every other entry in that block uses. See Five style questions, Q4.

## File-by-file

### `tools/i18n-check/src/review/review-tables.ts` (new)

Score 7/10 — 0 blocking, 1 serious, 0 minor. Cohesive, single-purpose module
(parse args → load inputs → render two deterministic Markdown files → write
or `--check`); `reviewNotes`/`tableCell`/`renderScopeTable`/`renderGlossary`
are each small, pure, and independently tested (`review-tables.spec.ts`).
Its only real fault is the CLI-scaffolding duplication with `main.ts`
(Serious issue above).

### `tools/i18n-check/src/lib/literal-offsets.ts` (new)

Score 7/10 — 0 blocking, 0 serious, 1 minor (the raw `U+2028`/`U+2029`
literals). Precise, well-commented, and its `decodeLiteral` is exhaustively
spec'd against the real TypeScript scanner's output
(`literal-offsets.spec.ts:5-16`, comparing against `ts.createSourceFile`
rather than asserting expected values by hand) — that comparison-to-the-real-
compiler technique is a strong pattern other fixture-heavy specs in this tool
could reuse.

### `tools/i18n-check/src/main.ts` (modified)

Score 7/10 — 0 blocking, 0 serious, 2 minor (file size trend,
`allowedScopeDefect` signature). The Batch 3 carry-over items (`fileTemplateSource`
call at `main.ts:231`, `allowedScopeDefect` at `main.ts:355-375`) are both
correctly scoped, tested (`main.spec.ts` "allowed scope with structural
violations" describe block covers dotted-key/duplicate-key/invalid-value,
non-object top level, unreadable file, and clean case) and match the batch's
carry-over instructions exactly.

### `tools/i18n-check/src/lib/glossary.ts` (modified)

Score 8/10 — 0 blocking, 0 serious, 0 minor. The Arabic word-character fix
(`WORD_CHAR`, `glossary.ts:79-84`) is precise (uses a lookahead to restrict
`\p{L}\p{M}\p{N}` to the Arabic block rather than all Unicode letters, so it
doesn't accidentally treat, say, Latin-adjacent or CJK text as
"word-glued") and the `u` flag is correctly added to the resulting `RegExp`
(`glossary.ts:87`) so the lookahead's Unicode property escapes are legal.
Tests cover both directions of gluing and both punctuation exemptions.

### `tools/i18n-check/src/lib/ts-keys.ts` (modified)

Score 7/10 — 0 blocking, 0 serious, 0 minor. `inlineTemplateOf` correctly
turns a decode failure into a `parse-error` violation naming the file/line
rather than throwing out of the scan loop (`ts-keys.ts:150-159`), consistent
with `scanProject`'s "one file's failure doesn't stop the run" contract in
`main.ts:205-217`.

### `tools/i18n-check/src/lib/template-keys.ts`, `report.ts` (modified)

Score 8/10 — 0 blocking, 0 serious, 0 minor each. `TemplateSource` moving
from a `firstLine`/`firstOffset` pair to `offsetAt`/`lineAt` closures is a
clean interface tightening that both call sites (`main.ts`'s
`fileTemplateSource`, `ts-keys.ts`'s `inlineTemplateOf`) now implement
correctly; `compareText` being exported from `report.ts` instead of
duplicated in `review-tables.ts` is exactly the kind of sharing the CLI
scaffolding (Serious issue) should also have gotten.

### `nx.json`, `tools/i18n-check/project.json`, `.github/workflows/ci.yml` (modified)

Score 7/10 — 0 blocking, 0 serious, 1 minor (undocumented `targetDefaults`
keying divergence). The CI step is a faithful sibling of the
`degradation-audit` step in naming, comment density, shell defensiveness and
`node_modules/.bin/nx` usage. The `review-tables` target in `project.json`
matches the shape of the existing `self-test`/`test` targets in the same
file.

## Pattern compliance

| Repository rule or nearby convention                                                        | Status         | Evidence                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CI step naming/shape matches `degradation-audit` (Pattern to follow, batches.md:386)        | PASS           | `ci.yml:146-165` vs `ci.yml:120-144`                                                                                                     |
| Uses `node_modules/.bin/nx`, never `npx` (Validation notes, batches.md:388)                 | PASS           | `ci.yml:151,155,157`                                                                                                                     |
| `targetDefaults["i18n-check"]` has `cache: true` + the three inputs (Task 4.2 quality req.) | PASS           | `nx.json:62-69`                                                                                                                          |
| `review-tables` deterministic, byte-for-byte, sorted (Task 4.1 quality req.)                | PASS           | `review-tables.ts:23-26,194-225`; self-test `--check` re-run passes                                                                      |
| `--check` exits 1 on drift (Task 4.1 quality req.)                                          | PASS           | `review-tables.ts:339-347`; verified via `nx run i18n-check:self-test`                                                                   |
| New/likely-shared CLI code lives in `src/lib/` (sibling pattern: `glossary.ts` etc.)        | FAIL           | `main.ts:73-145` duplicated at `review-tables.ts:67-134` (Serious)                                                                       |
| One error hierarchy rooted at `{Lib}Error` (CONVENTIONS.md §7)                              | NOT_APPLICABLE | `tools/` is not a `libs/<tier>/<lib>` unit under CONVENTIONS.md §2 scope                                                                 |
| `dispose()` sync, idempotent (CONVENTIONS.md §9)                                            | NOT_APPLICABLE | No stateful resource with a lifecycle in this batch                                                                                      |
| Comment density matches sibling tool (`degradation-audit`)                                  | PASS           | `ci.yml:146-155`; `main.ts`/`literal-offsets.ts` module doc comments                                                                     |
| No swallowed `catch` without a degradation-audit marker                                     | PASS           | `nx run degradation-audit:lint`: `tools/` not in its input glob; `main.ts:207-217` catch rethrows as a reported violation, not swallowed |

## Maintenance debt

- Introduced: `review-tables.ts` (a self-contained, well-tested generator);
  `literal-offsets.ts` (precise but intrinsically fragile literal decoding,
  guarded by a compiler-text equality check); one more `UsageError`/`toRel`/
  project-root-validation copy.
- Retired: the approximate offset-mapping in `ts-keys.ts`'s old
  `InlineTemplate.firstOffset` (replaced by exact per-character mapping),
  closing the Batch 3 round-2 Moderate finding on escaped inline templates.
- Net: positive. The precision gain in template-key offset mapping is real
  and well-tested; the new duplication is small in absolute lines (~35) but
  sits exactly on a path (CLI entry points) about to gain a third instance.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the `main.ts`/`review-tables.ts` CLI-scaffolding duplication
  should be extracted before or alongside Batch 6's `check-prerender.ts`,
  which will otherwise make it a three-way duplication.
- What a 10/10 version would do differently: extract `lib/cli.ts` for the
  shared `UsageError`/`toRel`/project-root-validation shape before adding the
  second entry point; give `allowedScopeDefect` the pre-filtered structural
  list instead of re-deriving it from `unreadable`; add a one-line comment in
  `nx.json` on why `i18n-check`'s `targetDefaults` entry is keyed by target
  name rather than executor name, and a one-line comment in
  `literal-offsets.ts` on the two literal `U+2028`/`U+2029` characters in
  `LINE_TERMINATORS`.

## Batch 7

### Summary

| Metric          | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Overall score   | 9/10                                                                    |
| Assessment      | APPROVED                                                                |
| Blocking issues | 0                                                                       |
| Serious issues  | 0                                                                       |
| Minor issues    | 1                                                                       |
| Files reviewed  | 34 (20 new, 9 modified index.ts/tsconfig.json, 5 modified jest configs) |

Scope: Task 7.1 (scopes for `app`, `ui`, `core`) and Task 7.2 (scopes for
`panelUi`, `landing`) — mechanical scaffolding across 5 projects. Reviewed
every new `en.json`/`ar.json`/`<name>.i18n-scope.ts`/`<name>.i18n-scope.spec.ts`
in full, every modified `tsconfig.json`, `jest.config.cts`/`jest.config.ts`,
and `src/index.ts`, plus `libs/frontend/i18n/CLAUDE.md`,
`libs/frontend/i18n/jest.config.ts`, and
`tools/i18n-check/src/lib/scope-map.ts` for the contracts this batch must
match. Verified: `node_modules/.bin/nx run-many -t lint,test,typecheck -p
ptah-landing-page web-ui web-core web-panel-ui web-landing` — 15/15 green
(the scope-verification A2 note is closed by this run: every
`<name>.i18n-scope.spec.ts` imports its own scope file and asserts a real
dynamic `import()` of its JSON resolves, so Jest's JSON-module handling is
exercised, not merely typechecked).

On the "`nx test --testPathPattern` ignored the filter" remark relayed from
the executor: not reproduced and not a finding. `Batch 7 verification` in
`batches.md:565-568` specifies `-p <project>` scoping, which is what this
review ran and is the correct way to scope an Nx run-many; nothing in this
batch's targets or executor options adds or depends on
`--testPathPattern`, so there is no misconfiguration to trace here.

### Five style questions

#### 1. What breaks when requirements change in six months?

Nothing structural — this batch only wires each project's own scope. The one
thing to watch is `libs/web/panel-ui/src/index.ts:4` and `:11-15`, the
"authoritative count" comment: it is correct today (11 export lines / 12
symbols, matching the 11 `export *` lines at `index.ts:28-38`), but every
future addition to this barrel must update the same two numbers in the same
edit or the comment goes stale again, exactly as it did before this task
(`index.ts:5-6`).

#### 2. What would a new team member misread?

Nothing in this batch itself; the five `<name>.i18n-scope.ts` files are three
lines of `defineI18nScope` each, and the five spec files read as one
template. The one thing worth flagging for a newcomer is that the identical
`unwrap()` helper in each spec (e.g.
`apps/ptah-landing-page/src/app/i18n/app.i18n-scope.spec.ts:6-9`,
`libs/web/ui/src/lib/i18n/ui.i18n-scope.spec.ts:6-9`, and three more) is
copy-pasted rather than shared, which could read as "each project owns its
own unwrap logic" when it is in fact one concept repeated five times.

#### 3. What does this cost to maintain?

Very little. Each project's `resolveJsonModule` addition
(`apps/ptah-landing-page/tsconfig.json:15`, `libs/web/{ui,core,landing,panel-ui}/tsconfig.json`)
and `transformIgnorePatterns` addition
(`apps/ptah-landing-page/jest.config.ts:33`,
`libs/web/{ui,core,landing,panel-ui}/jest.config.cts`) is a single line each,
placed exactly where the plan and `libs/frontend/i18n/jest.config.ts` say it
belongs. The recurring cost is the 5-way (soon 11-way, once Batch 8 lands)
duplication of the 9-line `unwrap()` spec helper — small today, and it is
already the pattern the owning library's own spec uses
(`libs/frontend/i18n/src/lib/i18n-scope.spec.ts:44`, a one-line inline
`const unwrap = ...`), just expanded here into a named function with a
repeated JSDoc comment.

#### 4. Where is this inconsistent with the rest of the repository?

It is not, on any check this batch changes. Barrel exports use `export *`
for the new scope constant in all four lib barrels
(`libs/web/{ui,core,landing,panel-ui}/src/index.ts`), which is the same
style every pre-existing line in those same barrels already uses — a
pre-existing repo-wide departure from CONVENTIONS.md §3's "explicit named
exports" rule that this batch neither introduces nor worsens (see Pattern
compliance). `resolveJsonModule` lands in the project root `tsconfig.json`
(inherited by both `tsconfig.lib.json`/`tsconfig.app.json` and
`tsconfig.spec.json` via `extends`), matching the plan's explicit rationale
(avoid invalidating `tsconfig.base.json`-rooted caches,
`implementation-plan.md:390`) and the cited precedent
`libs/web/ui/tsconfig.json`.

#### 5. What would you have done differently, and why is that better rather than merely other?

Hoist the spec `unwrap()` helper (and its JSDoc) into
`@ptah-extension/i18n/testing` once, e.g. `unwrapJsonModule`, and import it
from each `<name>.i18n-scope.spec.ts`. The library already owns the concept
under a different name in production code
(`libs/frontend/i18n/src/lib/i18n.service.ts:258-259`,
`unwrapJsonModule`); exporting a test-only twin from `testing/` would let
Batch 8's six additional scope specs import instead of copy, so the
duplication count stops at one shared helper instead of growing to eleven
independent copies. This is not blocking because Batch 7's copies are
correctly written and match established precedent, but a single publish
point is cheaper than any point where an eleventh spec diverges from the
other ten.

### Blocking issues

None.

### Serious issues

None.

### Minor issues

- The `unwrap()` helper is copy-pasted verbatim (implementation and JSDoc)
  across all five new spec files instead of being imported from one place:
  `apps/ptah-landing-page/src/app/i18n/app.i18n-scope.spec.ts:6-9`,
  `libs/web/ui/src/lib/i18n/ui.i18n-scope.spec.ts:6-9`,
  `libs/web/core/src/lib/i18n/core.i18n-scope.spec.ts:6-9`,
  `libs/web/landing/src/lib/i18n/landing.i18n-scope.spec.ts:6-9`,
  `libs/web/panel-ui/src/lib/i18n/panel-ui.i18n-scope.spec.ts:6-9`. Consistent
  with the owning library's own inline precedent
  (`libs/frontend/i18n/src/lib/i18n-scope.spec.ts:44`), so not a new
  deviation, but Batch 8 repeats the same pattern for 6 more projects
  (`batches.md:583,593`: "Pattern to follow: Task 7.1"), so the count is
  about to reach eleven. See question 5 for the fix.

### File-by-file

#### `apps/ptah-landing-page/src/app/i18n/{en.json,ar.json,app.i18n-scope.ts,app.i18n-scope.spec.ts}`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `defineI18nScope('app', ...)`
matches the CLAUDE.md recipe exactly; the spec asserts both `scope`/`alias`
and a real async load of each JSON module against the statically-imported
file, closing the A2 verification note.

#### `libs/web/ui/src/lib/i18n/{en.json,ar.json,ui.i18n-scope.ts,ui.i18n-scope.spec.ts}`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Scope name `ui` matches
`SCOPE_MAP.ui` (`tools/i18n-check/src/lib/scope-map.ts:20`) and the JSON
files start empty, per plan.

#### `libs/web/core/src/lib/i18n/{en.json,ar.json,core.i18n-scope.ts,core.i18n-scope.spec.ts}`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Same shape as `ui`; scope name
`core` matches `SCOPE_MAP.core`.

#### `libs/web/landing/src/lib/i18n/{en.json,ar.json,landing.i18n-scope.ts,landing.i18n-scope.spec.ts}`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Same shape; scope name
`landing` matches `SCOPE_MAP.landing`.

#### `libs/web/panel-ui/src/lib/i18n/{en.json,ar.json,panel-ui.i18n-scope.ts,panel-ui.i18n-scope.spec.ts}`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Scope name is `panelUi`
(camelCase, matching `SCOPE_MAP.panelUi` and the `keepCasing` validation note
in `batches.md:563`), file name is kebab-case `panel-ui.i18n-scope.ts` —
correctly following the library-directory-name convention rather than the
scope-name casing.

#### `libs/web/panel-ui/src/index.ts` (modified)

Score 9/10 — 0 blocking, 0 serious, 0 minor. The authoritative-count comment
is updated correctly and precisely (11 export lines, 12 symbols, both
verified by counting `index.ts:28-38`), and the new prose
(`index.ts:13-15`) correctly notes `PANEL_UI_I18N_SCOPE` is exempt from the
promotion rule (§5.3) rather than silently folding it into the primitive
count — the one place in this batch where a wrong edit would have been easy
to make invisibly.

#### `libs/web/{ui,core,landing,panel-ui}/src/index.ts` (modified, barrel additions)

Score 9/10 — 0 blocking, 0 serious, 0 minor. Each adds exactly one
`export * from './lib/i18n/<name>.i18n-scope'` line, in the same `export *`
style as every existing line in the same file.

#### `apps/ptah-landing-page/tsconfig.json`, `libs/web/{ui,core,landing,panel-ui}/tsconfig.json` (modified)

Score 9/10 — 0 blocking, 0 serious, 0 minor. `"resolveJsonModule": true`
added at the project-root level in all five, inherited by both the
lib/app and spec `tsconfig`s through `extends`, matching the plan's explicit
"per project, not `tsconfig.base.json`" rationale and the cited
`libs/web/ui/tsconfig.json` precedent.

#### `apps/ptah-landing-page/jest.config.ts`, `libs/web/{ui,core,landing,panel-ui}/jest.config.cts` (modified)

Score 9/10 — 0 blocking, 0 serious, 0 minor. Each `transformIgnorePatterns`
gains `|@jsverse|@angular/common/locales` alongside its project's existing
entries (`marked|ngx-markdown` for the app;
`@fullcalendar|...|temporal-utils` for `ui`/`panel-ui`; the bare `.mjs$`
default for `core`/`landing`), matching
`libs/frontend/i18n/jest.config.ts`'s pattern and comment rationale
verbatim, and each carries an inline comment explaining why (consistent with
every pre-existing entry in these same files already being commented).

### Pattern compliance

| Repository rule or nearby convention                                                                                                                         | Status | Evidence                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope constant name `<LIB>_I18N_SCOPE`, aliased to its own name (`libs/frontend/i18n/CLAUDE.md`)                                                             | PASS   | `app.i18n-scope.ts:3`, `ui.i18n-scope.ts:3`, `core.i18n-scope.ts:3`, `landing.i18n-scope.ts:3`, `panel-ui.i18n-scope.ts:3`, each asserted in its spec's `scope`/`alias` test |
| File name `<name>.i18n-scope.ts` per library directory name, not scope camelCase                                                                             | PASS   | `panel-ui.i18n-scope.ts` for scope `panelUi`                                                                                                                                 |
| Scope name/path matches `SCOPE_MAP` (`tools/i18n-check/src/lib/scope-map.ts:19-30`)                                                                          | PASS   | `app`/`ui`/`core`/`landing`/`panelUi` all resolve to `src/app/i18n` or `src/lib/i18n` as declared                                                                            |
| JSON translation files start `{}` (plan, Component 3)                                                                                                        | PASS   | All 10 new `en.json`/`ar.json` files                                                                                                                                         |
| `resolveJsonModule` per project tsconfig, not `tsconfig.base.json` (plan:390)                                                                                | PASS   | `apps/ptah-landing-page/tsconfig.json:15`; `libs/web/{ui,core,landing,panel-ui}/tsconfig.json`                                                                               |
| Jest `transformIgnorePatterns` adds `@jsverse` and `@angular/common/locales` next to existing entries (Batch 2 finding; `libs/frontend/i18n/jest.config.ts`) | PASS   | All 5 touched Jest configs                                                                                                                                                   |
| Panel-ui barrel authoritative-count comment updated in the same edit as the export list (`index.ts:3-9` precedent)                                           | PASS   | `libs/web/panel-ui/src/index.ts:4,11-15,38`                                                                                                                                  |
| Barrel exports use `export * from` (existing sibling style in `libs/web/{ui,core,landing,panel-ui}/src/index.ts`)                                            | PASS   | New lines match every pre-existing line in the same files                                                                                                                    |
| CONVENTIONS.md §3 "explicit named exports" barrel rule                                                                                                       | FAIL   | Pre-existing repo-wide departure in `libs/web/*` barrels, not introduced or worsened by this batch — not attributable to Task 7.1/7.2                                        |
| No translation content in the shared library (plan Component 3 quality requirement)                                                                          | PASS   | `libs/frontend/i18n` unmodified by this batch                                                                                                                                |
| `nx run-many -t lint,test,typecheck` stays green over the 11 in-scope projects (Verification seam)                                                           | PASS   | `-p ptah-landing-page web-ui web-core web-panel-ui web-landing`: 15/15 tasks green                                                                                           |

### Maintenance debt

- Introduced: 5 scope-constant/JSON pairs, 5 specs, 5 `resolveJsonModule`
  flags, 5 Jest `transformIgnorePatterns` entries — all mechanical, all
  matched to their stated pattern-to-follow. One copy of a 9-line spec
  helper × 5, which Batch 8 is set to grow to × 11 unless hoisted first.
- Retired: nothing.
- Net: neutral-to-positive. This batch adds exactly the scaffolding the plan
  calls for and nothing else; the only debt is the small, easily-collapsed
  `unwrap()` duplication, not yet costly enough to block on.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: hoist the spec `unwrap()` helper into
  `@ptah-extension/i18n/testing` before Batch 8 repeats it six more times.
- What a 10/10 version would do differently: export a shared
  `unwrapJsonModule` test helper from `@ptah-extension/i18n/testing` and have
  all five (soon eleven) `<name>.i18n-scope.spec.ts` files import it instead
  of redefining it.
