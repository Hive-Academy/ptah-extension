# Batch 25b executor report: diagnostics forwarding and end-to-end (Lane H)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`, branch `fix/task-559-lane-h`. The base is HEAD
plus the uncommitted, approved Batch 25a. No git state was changed.

For the fails-before (FB) runs, the three vscode-lm-tools sources were set to `git show HEAD:<file>` (25a never touched
them, so HEAD is the 25b base). The provider was reverted by hand to its 25a form. Every file was then restored from a
temp backup and checked with `cmp` or `git status`.

## Tasks completed

- 25b.1: `coverage` and `notChecked` are forwarded on both arms, and the formatter follows the clean-answer rule.
- 25b.2: the end-to-end spec `diagnostics-coverage.e2e.spec.ts`.
- Carried item R4-M1 (from the 25a post-cap review): the per-root generation map is now bounded, and the fence is
  intact.

## Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
  - `DiagnosticsPayload.coverage: LanguageCoverage` (required).
  - `notChecked?: readonly NotCheckedFiles[]`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts`
  - Forwards `result.coverage` and a non-empty `result.notChecked` on both arms.
  - When the provider gives no coverage (the VS Code provider), `providerDefinedCoverage()` fills it in:
    `checks:'provider-defined'`, `census:'unknown'`, `analyzed:null`, every other count `null`, never clean.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
  - `diagnosticsVerdict`, `reasonText`, `approximationTexts`, `coverageBlock`, `emptyVerdictLine`,
    `notCheckedGroups` and `notCheckedBlocks`.
  - `formatDiagnosticList` takes the verdict and the not-checked groups.
- MODIFIED `.../namespace-builders/core-namespace.builders.spec.ts`: 6 new cases.
- MODIFIED `.../mcp-core/mcp-response-formatter.spec.ts`
  - 17 new cases.
  - 2 existing expectations updated (see Deviations).
  - A clean type-check coverage was added to the two existing payload helpers.
- CREATED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/diagnostics-coverage.e2e.spec.ts`: 7 cases.
- MODIFIED `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`
  - `ROOT_GENERATIONS_MAX` (256).
  - `advanceGlobalGeneration()`.
  - A rollover check in `invalidate`.
- MODIFIED `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.spec.ts`: 2 new
  cases.

## Design

**Clean-answer rendering.** The formatter prints a bare "No issues found" only when all of these hold:

- `coverageReasons(coverage)` is empty;
- `checks` is `type-check` or absent;
- there are no approximations.

In every other case:

- The totals line reads `Errors: 0 | Warnings: 0 in what was checked — not a clean answer (see Coverage).`
- A `**Coverage:** qualified — <qualifiers>.` line follows, with the compact Batch 22c block
  (`compactCoverage`) under it.

Each qualifier is named in words:

- `N files unchecked (pass \`files\` to check them)`
- `N file(s) unsupported (no diagnostics for <lang n> on this host)`
- `census unknown (...)`
- `census truncated at N files`
- `N file(s) omittedByCap (...)`
- `N files failed (read 1, ...)`
- `syntax-only check (python): syntax errors only, not type-checked`
- `mixed check: python syntax-only ..., the rest type-checked`
- `provider-defined: only what the installed language extensions report; census unknown, per-language coverage unknown`
- `coverage not reported ...` when a payload or the legacy array carries no coverage.

A clean syntax-only answer (`clean:true` in its coverage) is still qualified, because syntax-only is never a
type-check claim. This also addresses the 25a observation that `compactCoverage` drops `checks` on a clean block.

**Placement under the budget.** Diagnostics stay `preformatted`: the budget cuts them and never reduces them.

- The Coverage line sits right under the totals, before every list, so the cut of the tail never drops it.
- Unscoped: the `### Not checked` groups (counts only) follow the Coverage line.
- Scoped: the groups (at most 10 paths each) follow the Requested files section and come before Sibling files. The
  Batch 1 order is kept: requested files first and in full, then siblings capped at 50.
- The unavailable arm also renders the Coverage line and the Not checked groups.

**R4-M1.** A root's generation record cannot simply be evicted. A reader may still hold the value that record replaced,
and eviction would move the root back to that value, which passes the fence.

- Once more than 256 roots hold a record, `invalidate` rolls over: the global generation becomes this invalidate's
  number (above every generation any reader holds), the root map is cleared, and every settled census is dropped. This
  is the same state as a global invalidate. The inner TS caches are left alone.
- The cost is conservative: answers already in flight for other roots report `census: unknown` once.
- Single-flight is unchanged. The settle-time check and the assembly fence are unchanged.

## FB evidence

| Spec | Base | After |
| --- | --- | --- |
| builders › "mixed repo never prints a bare No issues found" (namespace → formatter) | FAIL | PASS |
| formatter › "mixed repo never prints a bare No issues found" | FAIL | PASS |
| e2e › "empty: a mixed TS/Python workspace … never a bare No issues found" (provider → namespace → dispatcher → formatter) | FAIL | PASS |
| Every other new 25b builder, formatter and e2e case, except the e2e Batch 1 order case | FAIL (27 failed, 162 passed on base; log `%TEMP%/task559-25b-fb-vscode-lm-tools.log`) | PASS |
| e2e › Batch 1 requested-file order | PASS (preservation spec) | PASS |
| provider › "stay bounded across 10,000 distinct root invalidations …" | FAIL (`Expected: <= 256, Received: 257`) | PASS |
| provider › "a rollover past the bound still fences a census read before the root was invalidated" | PASS on base (base never evicts). Mutation check: a naive oldest-key eviction in place of the rollover makes it FAIL | PASS |

For the base run of the vscode-lm-tools specs, `jest.config.ts` was set temporarily to `diagnostics: false`. The base
`types.ts` lacks `coverage`, so ts-jest would otherwise refuse to compile the specs. The config was restored byte for
byte; `git status` shows it unmodified.

## Verification (worktree root)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence
  @ptah-extension/platform-core --skip-nx-cache --parallel=2`
  - The header named 3 projects.
  - Result: "Successfully ran targets test, lint, typecheck for 3 projects", with all 9 tasks passing.
  - Neither known flake appeared.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: "Successfully ran target typecheck for 2
  projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: "degradation-audit: TOTAL 300 unsuppressed site(s)".
- `prettier --check` on every changed file: three spec files were reformatted with `--write`. The change is formatting
  only, applied after the passing run.
- `ptah-core-prompt.ts`, `NATIVE_AGENT_TOOL_POLICY` and `jest.config.ts` are unchanged. No `as any` or `@ts-ignore`
  was added, and no new catch was added.
- The e2e fixtures contain no `from "x"`, `import("x")` or `require("x")` shapes. They are `mkdtemp` roots removed in
  `afterEach`, and spools land inside the root.

## Deviations

1. **Existing expectations changed** (they encoded the false clean this batch removes):
   - `formatDiagnostics([])`: the legacy array carries no coverage, so the answer is now qualified.
   - Available-empty with no coverage: that case now passes a clean type-check coverage and still expects
     "No issues found". A new case covers the no-coverage path.
   - The two formatter payload helpers now carry a clean type-check coverage, so their Batch 1 assertions are
     unchanged.
2. **The e2e syntax parser is scripted**: a line containing `(:` counts as a syntax error. The real grammars need
   `wasm-bundle-dir` and `web-tree-sitter` Jest shims that belong to workspace-intelligence, and they are covered by
   the 25a provider spec. The provider, namespace, dispatcher, budget and formatter are all real, and the census walks
   the real temp directory.
3. **The VS Code `provider-defined` coverage is applied in the namespace**, when a provider returns no coverage. It is
   not applied in `platform-vscode`, which is outside this batch's files. This follows the platform-core contract:
   "absent coverage → provider-defined".
   - Side effect: the TS provider's no-root pass-through is also labelled provider-defined, which is honest because it
     is never clean.
4. **The R4-M1 files are outside the 25b list**. They were carried by the team-leader decision.

## Out-of-scope observations

- `supportedLanguages: []` in provider-defined coverage shows up in the compact block, because `unsupported` is
  `null`. A reader could take it as "supports nothing". A contract note, or a `provider-defined` exemption in
  `compactCoverage`, would remove that ambiguity (platform-core).
- `unsupportedByLanguage` renders as `ruby 1`. This reads acceptably but could be phrased `1 ruby`, if a reviewer
  prefers.

## Revision round 1 (review r1)

Source: `reviews/batch-25b-code-logic-review-r1.md`, findings M1, M2 and M3. The only source file changed is
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`. Its spec and the e2e spec were
extended. No existing assertion was weakened; the old unavailable-arm text assertion was replaced by the new layout.

### M1: out-of-vocabulary values fail closed

- `unrecognisedVocabularyTexts` checks `census` against `complete | truncated | unknown`, `state` against
  `current | updating | incomplete`, and `checks` against `type-check | syntax-only | mixed | provider-defined`.
- A value outside its set becomes a named qualifier, and the answer is then never bare. For example:
  `census "unavailable" not recognised (treated as census unknown)`.
- An unrecognised `checks` value is also not a type-check claim, so it can never be bare either.

### M2: coverage precedes the unbounded reason

- The unavailable arm now renders in this order:
  1. `**Source:** <src> — Unavailable (reason below).`
  2. The Coverage line (verdict and compact block).
  3. `### Not checked`.
  4. `**Reason:** <reason>`.
- The reason is unbounded and comes last, so the budget cut can shorten only the reason. The full text is still
  spooled.

### M3: a qualifier list is never empty

- A `mixed` or `syntax-only` check always gets its qualifier. When no `<id>:syntax-only` approximation is present,
  the languages read "languages not named". This also replaces the old `(all)` wording.
- A final guard: any check that is not a type check, with no other qualifier, gets `<checks> check: not a type-check
  claim`.

### Regression specs and FB evidence

The new specs were run against the round-0 formatter (a temp copy, restored and checked with `cmp`):
`Tests: 7 failed, 149 passed`. After the fix: `156 passed`.

- **M1** (formatter spec, `it.each` over census, state and checks): an unrecognised value with all counts clean is
  never "No issues found", and the qualifier names the value. All 3 failed on round 0, where the census case rendered
  bare.
- **M2, formatter spec** (the unavailable-arm case): Coverage and Not checked come before `**Reason:**`. Failed on
  round 0.
- **M2, e2e** (`diagnostics-coverage.e2e.spec.ts`, "an unavailable answer with a very long reason keeps its coverage
  through the budget cut"): real provider, namespace, dispatcher, budget and formatter, with a reason of about 21,000
  characters. The spec asserts that the budget trailer is present and that `**Coverage:** qualified — 4 files
  unchecked`, `### Not checked` and the Python group all survive, ahead of the reason. Failed on round 0.
- **M3** (formatter spec, `it.each` over mixed and syntax-only with no approximations): the named qualifier is present
  and `qualified — .` is absent. Both failed on round 0.

### Verification (worktree root)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence
  --skip-nx-cache --parallel=2`: "Successfully ran targets test, lint, typecheck for 2 projects" (6 of 6 tasks).
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json
  dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: "degradation-audit: TOTAL 300 unsuppressed site(s)".
- Prettier was applied to the three changed files. No `as any` or `@ts-ignore` was added, and no catch was added.

## Revision round 2 (review r2)

Source: `reviews/batch-25b-code-logic-review-r2.md`, finding R2-M1. The only source file changed is
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`, plus its spec.

### Fix

- `diagnosticsVerdict` now names the out-of-vocabulary values from the coverage it received. It then builds all of the
  following from the output of `normalizedCoverage(received)`:
  - the prose reasons;
  - the approximation texts;
  - the `bare` decision;
  - `compactCoverage`.
- `normalizedCoverage` replaces an unrecognised `census` with `'unknown'` and an unrecognised `state` with
  `'incomplete'`, then recomputes the verdict with `withCoverageVerdict`. A coverage whose values are all valid is
  returned unchanged.
- Result: an invalid value always gives a compact block with `clean:false` (`census?` or `stale`), alongside prose
  that names the value and the matching qualifier ("census unknown ..." or "index incomplete").
- `checks` is not an input to the clean-answer rule. An unrecognised value is still named and is never bare, as in r1.

### Regression spec and FB evidence

- Formatter spec, `it.each` over census `"unavailable"` and state `"frozen"`, with all counts clean. For each case the
  spec asserts:
  - the compact block starts `{"clean":false,` and carries `"reasons":["census?"]` / `"census":"unknown"` (or
    `"reasons":["stale"]` / `"state":"incomplete"`);
  - no `"clean":true` appears anywhere;
  - the prose contains the matching qualifier.
- Against the round-1 formatter (a temp copy, restored and checked with `cmp`): `Tests: 2 failed, 148 passed`, both
  new cases failing. After the fix: all pass.

### Verification (worktree root)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: "Successfully ran targets
  test, lint, typecheck for project @ptah-extension/vscode-lm-tools".
- `nx run degradation-audit:lint --skip-nx-cache`: "degradation-audit: TOTAL 300 unsuppressed site(s)".
- Prettier was applied to both files. No `as any` or `@ts-ignore` was added.
