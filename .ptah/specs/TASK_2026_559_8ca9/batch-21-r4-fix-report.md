# Batch 21 — r4 fix report (Lane A, backend-developer)

Scope: the three findings of `reviews/batch-21-code-logic-review-r4-postcap.md` (R4-01, R4-02, R4-03). This is the
single fix round (User Decision 24). No git commands were run. `libs/backend/tool-output-reducers/**` was not changed,
and none of its specs were changed.

Path shorthand: **core/** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`; **stdio/** = the sibling
`mcp-stdio/`.

## R4-03 (Blocking): outline plus a labelled prefix replaces the occupancy rule

### Change

- `core/tool-result-budget.ts`: `isSparseOutline` and `MIN_OUTLINE_SHARE` are removed. When the reducer returns
  `markdown-outline` (:301), `outlineWithPrefix` (:357) composes the result. The outline comes first, then the label
  `[the full output from its start, cut to fit:]`, then the longest prefix of the raw text that keeps the whole body
  within the window (`composeWithPrefix`, :391). It uses the same line-break rule as `fitWindow`, remeasures, and
  shrinks the prefix until the body fits. The trailer names the reducer `markdown-outline+prefix` (:196).
- If the outline leaves less than `PREFIX_RESERVE_SHARE` = 20% of the window (:203), the outline is requested again
  within the other 80%. A dense outline therefore still leaves room for the front of the body. If no prefix fits, the
  outline is returned alone under its own name, `markdown-outline`. The raw text is still spooled byte-equal.
- Why the outline goes first: it is short and names the whole document's structure. The final cut in
  `fitWithTrailer` only ever shortens the end of the text. With the outline first, that end is the prefix, which is
  recoverable from the spool, so a late heading or answer is never cut. With the prefix first, the final cut would
  remove the late headings, which is the loss in counterexample A.
- Module doc step 2 is updated. Sweep: `markdown-outline+prefix` is added to `KNOWN_TRAILER_REDUCERS`
  (`core/mcp-contract.sweep.spec.ts:1282`). This is the only sweep change.

### Spec changes

- `core/tool-result-budget.spec.ts`: the 21r describe block is renamed `Markdown outline plus a labelled prefix
(Batch 21r, reviews r3 R3-01 and r4 R4-03)`. Its four 21r tests now expect `markdown-outline+prefix`. They check that
  the outline part keeps the header and every heading, and that the prefix part is a real prefix of the raw text and
  holds the marker. The json-compact guard is unchanged. New tests:
  - `review r4 R4-03 A: a late heading and answer after one long paragraph survive with the start of the paragraph
(was a 7,939-char prefix without the heading)`
  - `review r4 R4-03 B: a first long paragraph before 60 short sections keeps its front marker and every heading (was
markdown-outline, 6,130 chars, marker gone)`
- `core/protocol-dispatcher.spec.ts`: the three expectations that 21r changed now expect what this design produces:
  - Refused-HTML browser fallback. It now asserts that the outline keeps `## Page Content`, `### Text`, `### HTML` and
    the `(code block, N lines, omitted)` note. The HTML section is useful structure that the prefix never reaches, so
    the test no longer asserts `NAV-NOISE`. It also asserts that the prefix is a real prefix of the formatted page and
    is over 8 KiB, and that there is exactly one byte-equal spool file.
  - Large-text-only browser fallback. It now asserts that the article's `<h1>ARTICLE-TITLE-21p</h1>` and its paragraph
    are kept by the outline, and that `'T'.repeat(1000)` is kept by the prefix.
  - search_files with 1,000 files. The row is renamed `the outline plus a labelled prefix below the outline cap`, and
    its trailer is `markdown-outline+prefix`. Both rows now also assert the first two file rows
    (`1. libs/group-0/…file-0.service.ts\n 2. libs/group-1/…`).
  - New test (counterexample A through the real `handleMCPRequest`): `ptah_web_search: a late heading and its answer
after a long prose summary survive, next to the start of the summary`. It asserts the heading, the answer,
    `MARK-SUMMARY-FRONT`, both budget limits, and a spool byte-equal to `formatWebSearch(result)`.

### Fails-before evidence

Run with the occupancy rule still in place (only the specs changed):
`jest tool-result-budget.spec.ts protocol-dispatcher.spec.ts -t "outline|web_search: a late|falls back to the
formatted page|search_files truncation"` gave **10 failed**. The failures were the 5 tests of the renamed describe
(A and B included), the 2 browser fallbacks, the 1,000-file row, the web_search test, and the 10,000-file row. The
10,000-file row failed because of a first-row literal that I then corrected to the formatter's ` 2.` indentation; that
row passes both before and after the design change. With the fix: 307/307 in those two suites; the sweep gives 69
passed and 1 todo (the named, pre-existing Batch 24r item). The 13 below-cap sweep tests pass.

## R4-02 (Serious): final serialized-size invariant for structuredContent

### Change

- `stdio/bounded-structured-content.ts`:
  - A long string is listed in `omittedFields` before any value is filled (:176). A prefix takes that slot out, and
    dropping the prefix puts it back. The fallback state is therefore always the one that was already measured, and
    the note never grows after the last fit.
  - `boundStructuredContent` (:90) re-measures the final object (chars and tokens) for each locator form.
  - Locator forms: first absolute spool paths, then paths relative to the spool root (`recoveryNote`, :119). The
    relative form is `.ptah/tmp/mcp-out/<name> under the workspace root`, bounded whatever the root's length.
  - When the skeleton cannot fit, the recovery-only note `{…, allFieldsOmitted: true}` (:106) is measured too.
  - The last resorts are a bare `{truncated, limitChars}` note (:112), then `{}`. The output is always a plain
    object, so it is always valid JSON.
- `core/tool-result-budget.ts:561`: a new `relativeSpoolLocator(path, root)`, which `describeSpool` now shares, so both
  surfaces print the same relative form.
- `StructuredRecovery` now requires `spoolRoot`. `stdio/agent-tool.dispatcher.ts:319,324` passes `this.spoolRoot()`.

### Specs

- New file `stdio/bounded-structured-content.spec.ts`:
  - `two long fields: the omitted second field is reserved before filling…`
  - `two long fields, second of %i chars: always within both limits` (8 rows)
  - `a 1,200-segment spool root: locators are shown relative to the spool root…` (the long-locator case)
  - `a skeleton that cannot fit: the recovery-only note is itself held to the budget`
- `stdio/agent-tool.dispatcher.spec.ts`: `agent_spawn with two long fields: the omitted field is disclosed and the JSON
stays within both limits (review r4 R4-02: was 2,002 tokens)`. This uses the real dispatcher with a 20,000-char
  ptahCliName and a 200-char role, the reviewer's probe.

### Fails-before evidence

- The helper spec was run against the old helper, with only an optional `spoolRoot` type field added so that it would
  compile: **8 failed**, 3 passed. The measurements were 2,002 and 2,004 tokens (the limit is 2,000), 21,912 chars
  (the limit is 8,000), and 11,012 chars (the limit is 240).
- The dispatcher test was run against the old helper, restored temporarily: **1 failed** (expected ≤ 2000, received
  2002).
- After the fix, the stdio suites give 102/102.

## R4-01 (Serious): the manifest proves the returned setup's capability

### Change

- `core/mcp-mandate-manifest.spec.ts`: `argumentsDeclareOption` and `isOptionProperty` are replaced by
  `setupReturnsOption` (:534), which the invocation proof calls at :593. It resolves the callback's RETURNED value
  from one of these shapes:
  - an expression-body object literal;
  - `return <literal>` at the callback's own top level;
  - `return <const bound to a literal>` at the callback's own top level.

  Every return must qualify.

- `objectGivesFunction` (:501) requires the last `createSecondCheckout` property to hold a function value: a method
  with a body, an arrow/function expression, or an identifier (plain or shorthand) that `namesFunction` (:471)
  resolves to a function declaration or a const-bound function. `undefined`, `null`, `void 0`, strings, a const bound
  to `undefined`, an override by a later `undefined`, and an absent key are all rejected. Wrappers such as `as` and
  `satisfies` are unwrapped by `unwrapExpression` (:408).

### Specs (self-tests)

- `invocation proof: \`createSecondCheckout: undefined\` in the returned setup is NOT proof (review r4 R4-01
  counterexample)`
- `invocation proof: a setup object that declares the method but is NOT returned is NOT proof (review r4 R4-01
counterexample)`
- `invocation proof: null, a non-function value, or a shorthand bound to undefined is NOT proof`
- `invocation proof: a returned expression-body setup with an arrow, or a shorthand bound to a function, IS proof`
  (positive control)

The existing real-shape positive test and the real mapped `type-script-diagnostics-provider.spec.ts` invocation still
pass.

### Fails-before evidence

The old `argumentsDeclareOption` was temporarily swapped back in for the call at :593: **3 failed** (the two
counterexamples and the null/non-function test), 5 passed. After the fix, the manifest gives 36/36.

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools ptah-cli --skip-nx-cache`:
  "Successfully ran targets test, lint, typecheck for 2 projects and 33 tasks they depend on" (3m 1s).
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: "Successfully ran target validate-deps".
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: `degradation-audit: TOTAL 300 unsuppressed
site(s)`.
- `prettier --write` was run on the four changed files that were not formatted. After that, a re-run of the stdio,
  manifest and budget suites gave 175/175. Lint gives 0 errors; its 63 warnings were already there (nx reports success).
- Constraints: no new `as any`, `@ts-ignore`, catch clauses or deep cross-lib imports.
  `relativeSpoolLocator` comes from the sibling `../mcp-core/tool-result-budget`, which the helper already imported
  from.

## Out-of-scope observations

- `ToolResultBudgetOutcome.truncated` is false for a composed `markdown-outline+prefix` result whose body fits the
  window. The label says the prefix is cut, and the trailer names the reducer. If telemetry needs "prefix was cut",
  that is a separate flag.
- The R4-01 proof does not follow a mutation made after the setup object is created, such as
  `setup.createSecondCheckout = undefined` before `return setup`. As the reviewer allowed, this is bounded syntactic
  resolution, not reachability analysis.
