# Code Style Review — `TASK_2026_575_fee7`

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
