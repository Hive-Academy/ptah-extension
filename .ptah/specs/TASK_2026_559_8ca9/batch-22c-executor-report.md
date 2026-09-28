# Batch 22c — Compact coverage block (User Decision 21): executor report

Worktree `task-559-lane-h`, branch `fix/task-559-lane-h` (base HEAD 41ed73395). Nothing is staged or committed.

## Design

There is one serializer, `compactCoverage(coverage)`, in the platform-core contract (`language-coverage.interface.ts`, exported from the barrel). It works at the **wire boundary**: every language-bound MCP tool calls it at the point where it writes `coverage` into its answer text.

In-memory `LanguageCoverage` objects keep the full shape, so these are unchanged:

- `withCoverageVerdict`
- `isCleanAnswer`
- the graph merges (`graph-coverage.ts`, which sums fields)
- the namespaces and `execute_code` results

### Serialization rule

- **Clean** answers are written as `{"clean":true,"analyzed":N}` and nothing else. `analyzed: null` is kept as `null`. `nonSource`, `excluded: null`, approximations and a clean `resolution` never qualify an answer, so they are not repeated.
- **Qualified** answers are written as `clean:false` and `reasons`, then, in `CoverageFields` order, only the fields that differ from their clean value:
  - Counts: a count that is 0 is left out. A `null` count is **always kept**, so unknowns stay visible.
  - `census` appears unless it is `'complete'`. `censusLimit` appears when present. `state` appears unless it is `'current'`.
  - `unsupportedByLanguage` and `failedByReason`: only their non-zero entries.
  - `resolution`: 0 counts, `edgeCapHit:false` and `context:'complete'` are left out; `null` values are kept.
  - `approximations` and `checks` appear when present. `approximationsOmitted` appears when it is above 0.
  - `supportedLanguages` appears only when `unsupported` is not 0.
- **Reading rule** (documented in the contract JSDoc and in the agent-facing legend): an omitted count is 0; `null` is unknown.
- The verdict is recomputed inside the serializer, so it cannot disagree with `isCleanAnswer`. The reason vocabulary is unchanged: no reason was renamed, so Lane A's `unsupported-syntax` merges cleanly.

### Call sites (`protocol-dispatcher.ts` and `ast-namespace.builder.ts`)

- `ptah_get_dependents` and `ptah_get_dependencies` go through `graphFileAnswer`.
- `ptah_get_symbol_index` uses it in its page header.
- `ptah_ast_analyze`, `ptah_code_search_symbols` and `ptah_code_reindex` use `withCompactCoverage`, which keeps each key in its place, so the budget order is unchanged.
- The two AST error texts that embed coverage also use it.

### Legend (24b `COVERAGE_LEGEND`)

The legend now includes: "A clean block holds only `analyzed`; otherwise an omitted count is 0 and null is unknown." Both descriptions stay under the 1,000-char budget; the spec passes. The graph tool descriptions do not describe the block.

### Batch 24r preserveKeys

The reducer still keeps the block verbatim. The `tool-result-budget.spec` input is now the compact block, and the spec pins the exact serialized text, with its nulls, after reduction.

## Token overhead (exact o200k, `gpt-tokenizer`)

The sample is a 4-dependent `ptah_get_dependents` answer. The answer without `coverage` is 67 tokens.

| Answer | Before (full block) | After (compact) | Cap (spec) |
| --- | --- | --- | --- |
| Clean | 91 tokens (326 chars) | **11 tokens** (27 chars) | ≤ 40 |
| Typical qualified (2 Python, 3 unrecognised, 41 non-source, `excluded:null`, 57 external) | 105 tokens (396 chars) | **63 tokens** (250 chars) | ≤ 120 |

Total answer size: clean went from 158 to 78 tokens; qualified went from 172 to 130.

**Worst case:** the full in-memory shape is still pinned at 1,000 chars; it bounds `execute_code`. The compact worst case, which is what tools write, measures **997** chars. It is pinned, and asserted to be ≤ 1,000.

## Specs

New specs, each marked with a fails-before:

- **`language-coverage.interface.spec.ts` › `compactCoverage` (15 tests):**
  - the clean shape
  - the qualified shape and its key order
  - each count kept when `null`
  - a reader recovers every count under "omitted = 0"
  - the `supportedLanguages` rule
  - census and state
  - resolution
  - agreement with `isCleanAnswer` and a stale verdict

  Fails before: `compactCoverage` does not exist, so the suite does not compile.
- **`protocol-dispatcher.spec.ts` › "ptah_get_dependents coverage overhead on a small answer":** a clean answer must cost ≤ 40 tokens and a qualified one ≤ 120, with the exact compact shape.

  Fails before: measured against the base dispatcher, the clean test failed (91 > 40). The qualified test failed on its shape, because the full block was emitted. On overhead alone the old qualified block, at 105 tokens, would pass the 120 cap.
- **`tool-description.builder.spec.ts` › "states the compact reading rule" (×2).** Fails before: the legend had no such text.
- **`language-registry.spec.ts` › "compact worst case … pinned".** Fails before: `compactCoverage` is not exported.

Consumer specs that pinned the old full shape were updated to the exact compact shape, with no loosened matchers:

- `protocol-dispatcher.spec.ts`:
  - graph completeness, `toEqual` → `{clean:true, analyzed:2}`
  - the symbol-index whole page, an exact qualified literal
  - two empty pages, `toEqual`
  - bounded discovery: dropped `census:'complete'`, and added `not.toHaveProperty` for `census`, `failed` and `omittedByCap`
- `ast-namespace.builder.spec.ts`: the three AST rejections now parse the coverage JSON out of the message and assert the exact compact block per file kind (`unsupported` or `unrecognised`), plus `Supported:`.
- `tool-result-budget.spec.ts`: see preserveKeys above.

**Fails-before run:** I wrote the base versions of `protocol-dispatcher.ts`, `tool-description.builder.ts` and `ast-namespace.builder.ts` into the worktree with `git show HEAD:<f> >` and ran the three vscode-lm-tools spec files. Result: `Tests: 13 failed, 334 passed`. The 13 failures were the new and updated tests listed above. I then copied my versions back from a temp backup.

## Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers --skip-nx-cache --parallel=2` → "Successfully ran targets test, lint, typecheck for 4 projects" (12 tasks). Neither known flake appeared.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron ptah-extension-vscode --skip-nx-cache` → "Successfully ran target typecheck for 3 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → "TOTAL 300 unsuppressed site(s)". No catch was added.
- `prettier --check` on the 11 changed files → "All matched files use Prettier code style!"
- `ptah-core-prompt.ts` is unchanged (`git diff --quiet HEAD` → 0). No `as any`, no `@ts-ignore`, and no `from "<word>"` string.
- `git status --short` shows 11 modified files, listed below. The untracked `code-logic-review.md` was already present and is not mine.

## Files (all under `libs/backend/`)

- `platform-core/src/interfaces/language-coverage.interface.ts`: `compactCoverage`, the `Compact*Coverage` types, and doc updates.
- `platform-core/src/index.ts`: barrel exports.
- `platform-core/src/interfaces/language-coverage.interface.spec.ts`
- `vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`: the call sites and `withCompactCoverage`.
- `vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`: the legend.
- `vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`: the two error texts.
- Specs: `protocol-dispatcher.spec.ts`, `tool-description.builder.spec.ts`, `tool-result-budget.spec.ts`, `ast-namespace.builder.spec.ts`, `workspace-intelligence/src/ast/language-registry.spec.ts`.

## Merge notes for the team-leader

- **`language-registry.spec.ts`:** keeps both pins, the full shape at 1,000 and the compact shape at 997. When 20.2q's `unsupported-syntax` reason is merged, re-measure both. The reason may lengthen the full or compact worst case, and the enumerator must include it.
- **The pending bench test** (`mcp-contract.bench.spec.ts:416`) and the dependents/symbol-index SIZE guards should be re-run on the compact envelopes after the merge.
- **`execute_code` returns the full in-memory shape.** It is the programmatic API, not a language-bound tool's wire answer. That is a deliberate choice, not an omission.
