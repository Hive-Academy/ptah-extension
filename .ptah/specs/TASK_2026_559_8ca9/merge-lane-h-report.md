# Lane H merge fallout — TASK_2026_559_8ca9 (RESUME POINT step 3)

Worktree `task-559-mcp-tool-contract`, merge `fix/task-559-lane-h` (MERGE_HEAD ea46dc9ad) in progress, not
committed. Only files were edited. No git state was changed. All paths below are under
`libs/backend/`. The edits are unstaged, on top of the staged merge resolution.

## R1: compact coverage size bound (User Decision 21, ≤ 1,000 chars)

- `platform-core/src/interfaces/language-coverage.interface.ts:366`: new `MAX_COMPACT_FAILURE_REASONS = 3`
  and the `CompactFailedByReason` type (`FailureReason | 'other'`). `compactFailedByReason` (:428), called
  at :509, orders the non-zero reasons largest first. Ties keep `FAILURE_REASONS` order (stable sort). It
  keeps 3 by name and sums the rest into `other`, saturating at `COVERAGE_COUNT_MAX`. When 3 or fewer
  reasons are non-zero, the map is returned unchanged with no `other`. The full shape (`withCoverageVerdict`,
  what `execute_code` returns) keeps every reason. No reason code was renamed. `CompactQualifiedCoverage`
  now types `failedByReason` as the compact map. The header doc now states the new numbers.
- `platform-core/src/index.ts`: exports `MAX_COMPACT_FAILURE_REASONS` and `CompactFailedByReason`.
- `platform-core/src/interfaces/language-coverage.interface.spec.ts:404-460`: four new tests.
  - Six reasons fold into 3 plus `other` (sum 3). Fails before the cap, because all six are named.
  - Three or fewer reasons get no `other`.
  - Tie order and `other` saturation.
  - The full shape keeps all six.
- `workspace-intelligence/src/ast/language-registry.spec.ts`:
  - The `WORST_FIELDS` fixture (:131 `longestFailureReasons`) gives the 3 longest reason names MAX and the
    rest MAX−1. Every count is still 6 digits. The enumerated compact worst case therefore keeps the longest
    names, not the ones the tie-break would pick first. It is a true adversarial case.
  - Pins:

    | Pin                                            | Before (24r / 22c) | Merged, without the cap | Now                    |
    | ---------------------------------------------- | ------------------ | ----------------------- | ---------------------- |
    | `MEASURED_WORST_CASE_CHARS` (:252, full shape) | 1,000              | 1,028                   | 1,028                  |
    | `MEASURED_COMPACT_WORST_CASE_CHARS` (:262)     | 997                | 1,025                   | 994 (≤ 1,000 asserted) |

    The full shape grows because of 20.2q's `unsupported-syntax` (+27 chars, +1 separator).

  - Assertion change, disclosed: the test "worst-case coverage, verdict included, <= 1,000 chars" on the
    FULL shape was removed. Under R1 the full shape keeps every reason, so it cannot meet 1,000. It is now
    pinned exactly at 1,028 (:270). The ≤ 1,000 bound is still asserted, on the compact block every tool
    writes (:284).

## R2: description budgets

`vscode-lm-tools/.../mcp-core/mcp-contract.sweep.spec.ts`. The comment on each names 24b as the cause and 24c
as the owner. No other entry in the table changed.

| Tool (line)                        | Old budget | 24b measured length | New budget (+5%) |
| ---------------------------------- | ---------- | ------------------- | ---------------- |
| `ptah_code_search_symbols` (:2099) | 702        | 972                 | 1,021            |
| `ptah_code_reindex` (:2110)        | 536        | 949                 | 997              |

## Step 3: sweep fakes, ast_analyze pins, bench compile

All in `vscode-lm-tools/src/lib/code-execution/mcp-core/` unless another lib is named.

- `mcp-contract.sweep.spec.ts`:
  - New helpers: `CLEAN_FIELDS` / `CLEAN_COVERAGE` (`withCoverageVerdict`), `graphFileStubs` (:153:
    `unsupportedGraphLanguage` plus `getGraphCoverageForFile → {coverage, nodePath}`) and `lspReport` (:167,
    an `LspLocationReport`).
  - Drivers updated to the new shapes:
    - `ptah_lsp_references` → `getReferencesReport` (:270)
    - `ptah_lsp_definitions` → `getDefinitionReport` (:291); locations use `column`
    - `ptah_ast_analyze` returns `parseStatus` and `coverage` (:721)
    - `ptah_get_dependents` / `ptah_get_dependencies` use `...graphFileStubs()` (:747, :760)
    - `ptah_get_symbol_index`, in its driver and in the dedicated windowing test, uses
      `getGraphCoverage → {coverage}` (:809, :2249)
  - Causes of the failures:
    - The dispatcher now calls the 26a report APIs.
    - `withCompactCoverage` / `graphFileAnswer` call `compactCoverage` on the coverage, which the old fakes
      left `undefined`.
    - 23b calls `unsupportedGraphLanguage`.
  - Result: all 17 sweep tests that failed on these fakes now pass: 16 host/caller cells (anonymous with
    IDE, no-IDE, agent, session, workspace, and the 11 remaining matrix cells) plus `ptah_get_symbol_index`
    own windowing. The 18th, the description-budget test, is the R2 fix. No assertion changed.
- `ast-analyze-result.spec.ts:233`: the pin now formats the result the way the dispatcher writes it (compact
  coverage). The regex is exact: `"coverage":{"clean":true,"analyzed":1}`. It was a loose `[^[]*` match
  around `supportedLanguages`. The test also asserts that the namespace result's coverage starts with
  `clean`, `reasons`.
- `protocol-dispatcher.spec.ts:~987/1035`: the fake coverage `{census, analyzed}` was an incomplete field set.
  `compactCoverage` read the missing counts as non-zero and produced `clean:false, reasons:[unchecked,…]`.
  The fake is now a full `withCoverageVerdict` clean coverage. Pin old
  `"coverage":{"census":"complete","analyzed":1}` → new `"coverage":{"clean":true,"analyzed":1}`. Prettier
  also reflowed two 26a hunks in this file (:~7221, :~7337). The change is format only.
- `workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts:275`: the envelope coverage
  is built with `withCoverageVerdict`. This fixes the TS2739 compile error that stopped the suite. The
  envelope carries `compactCoverage(coverage)`, as the dispatcher's `ptah_ast_analyze` case does.

## Step 4: "pending Batch 24r" tests are now real

- `mcp-contract.bench.spec.ts:422`, "preserved coverage survives reduction". The test uses the real envelope
  of the 300-line fixture, a qualified compact coverage with `unrecognised: null` and `excluded: null`, and
  `errorNodeCount: null`. It runs the real `reduceOutput` (hint json) with the budget layer's
  `PRESERVED_RESULT_KEYS`. That value is restated in the test, because vscode-lm-tools cannot be imported
  from this lib. The test asserts:
  - the reducer is `json-compact`;
  - `coverage` and `parseStatus` are the first two keys, and the text starts with them verbatim;
  - the coverage deep-equals the input, nulls included;
  - the unpreserved `errorNodeCount` was dropped, which proves the reducer ran.
- `mcp-contract.sweep.spec.ts:2497`, "status block, compact coverage included (nulls too), survives
  verbatim and first". The call goes through the real dispatcher with a qualified coverage: nulls in
  `unrecognised`, `excluded` and `resolution.unresolvedInternal`. The test asserts:
  - the raw text is in production order (`count`, `fileInGraph`, `coverage`, `file`, `dependents`);
  - the trailer reducer is `none`: with `coverage` preserved, nothing in this answer is prunable;
  - the returned text starts with that exact status block, coverage verbatim;
  - `budgetContractFailures` returns `[]`;
  - a control, `reduceJson` without `preserveKeys`, gives `json-compact` and drops `"unrecognised":null`.
    That is the behaviour before 24r.
- The earlier draft expected `json-compact` and a coverage-first reorder through the dispatcher. It failed.
  Minified graph answers have nothing prunable once the coverage is preserved, so only the cut runs. This is
  correct product behaviour, not a defect. The assertion now matches it and is exact.

## Step 5: re-measured 22c pins and 20.2 SIZE benchmarks (real gpt-tokenizer)

| Pin / benchmark                                                                  | Before        | After              | Changed?                               |
| -------------------------------------------------------------------------------- | ------------- | ------------------ | -------------------------------------- |
| 22c compact worst case                                                           | 997           | 994                | yes, see R1                            |
| 22c small-answer overhead caps (`protocol-dispatcher.spec`, ≤ 40 / ≤ 120 tokens) | pass          | pass               | no; no fixture has more than 3 reasons |
| ast_analyze tokens (20.2p: 2,184 source)                                         | 1,131 (48.2%) | 1,124 (48.5%)      | no pin; ≥ 40% holds                    |
| context_enrich tokens (2,184 source)                                             | —             | 805                | no pin; ≥ 40% holds                    |
| get_dependents hub SIZE (20.2 r3: 451 vs 639 grep, 29.4%)                        | 451 vs 639    | 481 vs 652 (26.2%) | no pin; < grep holds                   |
| get_symbol_index SIZE                                                            | —             | 1,226 vs 4,551     | no pin; < grep holds                   |

- The combined product legitimately changed the envelopes the bench mirrors:
  - `mcp-contract.bench.spec.ts:693-700`: the get_dependents answer now carries 23b's `fileInGraph` and
    `coverage: compactCoverage(...)` from `getCoverageReportForFile`. `file` is the node path.
  - `mcp-contract.bench.spec.ts:773`: the symbol-index page carries the compact coverage.
- The SIZE margins still hold with the coverage in place, which is what User Decision 21 asked for. No
  threshold was changed.

## Other merge failures

The baseline after the merge had 20 failing tests in vscode-lm-tools, 3 in workspace-intelligence, and 1
suite that did not compile. All are covered above:

- 16 sweep host/caller cells and symbol-index windowing → step 3; the description-budget test → R2.
- `protocol-dispatcher.spec.ts:1020` and `ast-analyze-result.spec.ts:233` → step 3.
- `language-registry.spec.ts`: 3 tests → R1.
- bench compile → step 3.

No product defect was found.

## Verification

- `nx run-many -t=test,lint,typecheck -p platform-core platform-cli platform-electron workspace-intelligence
vscode-lm-tools ptah-cli --skip-nx-cache`: "Successfully ran targets test, lint, typecheck for 6 projects
  and 33 tasks".
- Header counts (static re-run):

  | Project                | Suites               | Tests                                                  |
  | ---------------------- | -------------------- | ------------------------------------------------------ |
  | platform-core          | 46/46                | 995 passed, 4 todo (master-key contract, pre-existing) |
  | workspace-intelligence | 52/52                | 1,629 passed, 1 skipped (pre-existing)                 |
  | vscode-lm-tools        | 75/75                | 2,245 passed, 0 todo (was 1 todo)                      |
  | platform-cli           | 15/15                | 256 passed, 3 todo                                     |
  | platform-electron      | 36 passed, 2 skipped | 654 passed                                             |
  | ptah-cli               | 68 passed, 1 skipped | 1,102 passed                                           |

- `nx run-many -t=typecheck -p ptah-electron`: success.
- `nx run ptah-electron:validate-deps`: success.
- `nx run degradation-audit:lint`: "TOTAL 300 unsuppressed site(s)", success.
- None of the known flakes fired in either full run, so no isolated re-run was needed.
