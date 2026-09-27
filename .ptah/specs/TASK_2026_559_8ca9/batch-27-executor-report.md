# Batch 27 Executor Report — Harness H3 (polyglot fixtures, fixed keys, honesty contract)

Executor: senior-tester (Lane T). Worktree:
`D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`, branch
`fix/task-559-mcp-tool-contract`, base HEAD `7c9e1cc00` (confirmed the whole 22-26b
honesty chain, Lane A 21, and 24c/24d are merged via `git log --oneline`).

## Files

New:

- `libs/backend/workspace-intelligence/src/testing/mcp-contract/polyglot-fixtures.ts`
  (Task 27.1)
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/required-keys.ts`
  (Task 27.2)
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/activations/activation-fragment.ts`
  — the shared `ActivationFragment` shape. **Deviation from the literal file
  list**: the plan names only `required-keys.ts` and `b27-baseline.ts`; this
  extra file holds the fragment interface so `required-keys.ts` never imports
  from `activations/*` and a fragment never imports the discovery spec. Kept
  because "fragments discovered via `fs`" needs an agreed shape somewhere.
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/activations/b27-baseline.ts`
  (Task 27.2) — activates the ten `honesty:*` keys plus
  `syntaxDiagnostics:python|go|csharp`.
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`
  (Task 27.2) — matrix structure + registry-grant checks, plus real
  per-tool honesty proofs for 7 of the 10 keys (see below).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-language-coverage.spec.ts`
  (Task 27.3) — the remaining 3 honesty keys (`ptah_get_diagnostics`,
  `ptah_lsp_definitions`, `ptah_lsp_references`), which need
  `mcp-response-formatter.ts` (a `vscode-lm-tools`-only collaborator;
  `workspace-intelligence` must not depend on it — layering runs the other
  way).

Modified:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-mandate-manifest.spec.ts`
  — added one test pinning "26b becomes the host guard for
  `ptah_lsp_references`/`ptah_lsp_definitions`, never an exemption" (Task
  27.3's own file, per its listed files: "H reconciles 21.1/21.2").
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
  — the 24c review carried-item fix (below).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts`
  — pins the fix.

**Not touched**: `mcp-contract.sweep.spec.ts`. Task 27.3 lists it, but Batch 27
introduces no new MCP tool/capability shape of its own (it is a harness batch);
its own comment in `mcp-language-coverage.spec.ts` explains why the sweep's
existing pins are read, not edited, and that 29b+ (the batches that add real
shapes) extend both files together. `ptah-core-prompt.ts` and
`NATIVE_AGENT_TOOL_POLICY` (`cli-adapter.utils.ts`) confirmed unchanged via
`git diff --stat` (empty).

## Carried item 1 — 24c review: "ide" help exclusive-to-VS-Code text

`system-namespace.builders.ts:56` and `:241` said IDE access was "VS Code
exclusive" / "exclusive to VS Code", contradicting `ptah.ide.lsp`'s own doc
(desktop `text-scan` mechanism) — 24c review finding 3, evidence
`system-namespace.builders.ts:241` vs `:253-261` (batch-24c-code-logic-review-r1.md).
Fixed both strings to state IDE is host-dependent (full in VS Code; desktop/CLI
get LSP fallbacks, no editor/actions/testing). Added
`system-namespace.builders.spec.ts` test `'never claims the ide namespace is
exclusive to VS Code (Batch 27 honesty: 24c review finding 3)'`.

**FB evidence**: ran the new test against the untouched string first — failed
(`Received string: "...exclusive to VS Code..."`); after the fix, passes (22/22
in the file). This is a genuine "fails before, passes after" pair, not a revert
— the defect was real and open (batches.md still lists 24c's review as REVISE).

## Carried item 2 — 24c descriptions list 24d's export kinds; are they real?

`tool-description.builder.ts:1837` (`ptah_code_search_symbols`) claims
"exported interfaces/types/enums/variables/namespaces/export-clause names".
Checked against 24d's actual indexer (`code-symbol-indexer.service.ts:288-306`,
`exportRowKind`/`isIndexableExportName`) and its own real-tree-sitter
integration spec (`code-symbol-indexer.exports.integration.spec.ts`,
already existing, 512 lines, real WASM): it proves interface/type/enum/
variable/namespace/export(-clause) kinds are indexed exactly as named,
including declaration-merge and dedup edge cases. **No defect found** — this
description/implementation pair is honest. I did not duplicate that spec;
`language-honesty.contract.spec.ts`'s `CodeSymbolIndexer` test (below) is a
second, smaller real-WASM proof from the harness's own polyglot fixtures
rather than a re-run of 24d's own fixtures.

## Carried item 3 — 26b Electron LSP: never a confident zero

`apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts` (already
merged, ~2500 lines) extensively covers this: B1-B6/M1-M2 truncation and
unsupported-language disclosure, all passing today. **No defect found**; I did
not duplicate this Electron-project suite inside the `workspace-intelligence`
harness (would cross a layering boundary the other direction — `apps/
ptah-electron` depending back into a `libs/backend/workspace-intelligence`
test file is fine, but the reverse import I'd need is not). Instead:
`mcp-language-coverage.spec.ts` pins the SAME contract one level up, at
`mcp-response-formatter.ts`'s `formatLspReferences`/`formatLspDefinitions`
(4 tests: truncated-zero, unsupported-zero, `mechanism: 'none'`, and a
clean-zero contrast case) — the layer every `ptah_lsp_*` answer actually
renders through — plus the `mcp-mandate-manifest.spec.ts` pin that
`ptah_lsp_references`/`ptah_lsp_definitions` stay real guards, never
`exempt()`.

## Carried item 4 — 25b: never a bare "No issues found" on a mixed repo

Already pinned pre-existing at `mcp-response-formatter.spec.ts:1076` and
`diagnostics-coverage.e2e.spec.ts`. **No defect found**. Re-pinned in
`mcp-language-coverage.spec.ts` against the harness's own
ts-python-monorepo polyglot shape (2 python files unchecked), plus a
TS-only-clean contrast case.

## FB (Decision 6) — deliberate local revert, executor report evidence

Batch 27's own FB is a deliberate local revert (D6: on this base, the honesty
fixes already exist, so the harness's FB is "revert one, watch its key fail").
Reverted `mcp-response-formatter.ts`'s `diagnosticsVerdict` `bare:` field to a
hardcoded `true` (undoing 25b's clean-answer rule) → re-ran
`mcp-language-coverage.spec.ts`: the `honesty:ptah_get_diagnostics` test
failed exactly as expected (`Received string: "...No issues found..."`,
7/8 passed, 1 failed). Restored the original line
(`bare: qualifiers.length === 0 && typeCheckOnly,`) → `git diff --stat` on
that file is empty, and the suite is 8/8 green again.

## Required-keys set

58 keys, sorted, no duplicates (`required-keys.ts` structural tests). Ten
literal `honesty:*` keys (exact list in `HONESTY_KEYS`); 48
`<capability>:<language>` keys built from the plan's Required-keys table
(parse/outline/codeIndex ×{tsx, java+rust, php/ruby/cpp, kotlin} = 21;
enrichSummary:tsx = 1; syntaxDiagnostics ×{python/go/csharp, java/rust,
php/ruby/cpp, kotlin} = 9; publicSymbols/graphEdges ×{python/go, csharp/java,
rust, php/ruby/cpp} = 16; typeCheck:go = 1). No `graphEdges:kotlin` /
`publicSymbols:kotlin` (Decision 19). `SELECTED_OPTIONS` matches the plan
verbatim.

## Deviations from the literal fixture spec (documented per role honesty)

- `planFlatNamespace`/`planManifests` generate the literal 300/80 counts (cheap
  string generation — no reason to shrink).
- `planVendorTreeBeyondCensusLimit(limit, beyondLimit=5)` takes the real cap as
  a parameter rather than hardcoding the production ~2,000-file constant, so
  the harness stays fast by default; a caller that needs the exact production
  boundary passes it in. No test in this batch calls it with the real constant
  — flagging this as unexercised at production scale.
- `planSupersededBuild` is a plan pair (outdated/current), not yet wired into a
  spec in this batch (no test currently exercises it) — left in place for
  29b+/23a-reconciliation use since Task 27.1 only requires the fixture to
  exist, not that every bounds fixture already have a Batch-27 consumer.
- `honesty:ptah_lsp_definitions`/`honesty:ptah_lsp_references` and
  `honesty:ptah_get_diagnostics` are pinned at the formatter layer
  (`mcp-response-formatter.ts`) rather than re-driving the full Electron/
  diagnostics-provider stack from the polyglot fixtures — the underlying
  stacks already have their own real, passing, heavier specs (26b, 25b); this
  harness's job (per Task 27.2's "each honesty key asserted against that
  tool's own contract") is satisfied at the contract layer every answer must
  pass through, not by re-proving the lower layers.
- Task 27.3's "new shapes through the reducer/budget path ... new shapes in
  the sweep" is deferred: Batch 27 adds no new MCP tool/capability shape.
  `mcp-contract.sweep.spec.ts` is unedited; explained in a doc comment in the
  new file.

## Runtimes (each new spec file, `--skip-nx-cache`, standalone `--testFile` run)

| File                                          | Tests | Time  |
| --------------------------------------------- | ----- | ----- |
| `language-honesty.contract.spec.ts`           | 14    | 3.07s |
| `mcp-language-coverage.spec.ts`               | 8     | 3.75s |
| `system-namespace.builders.spec.ts` (+1 test) | 22    | 4.2s  |
| `mcp-mandate-manifest.spec.ts` (+1 test)      | 49    | 4.2s  |

`language-honesty.contract.spec.ts` includes a real-tree-sitter-WASM
`CodeSymbolIndexer` run (mkdtemp fixtures, real grammar load) and still
finishes in ~3s alongside 13 lighter tests in the same file — well within
"keep the harness fast."

## Product defects exposed

One, already fixed as part of this batch (carried item 1): the `ide` parent
help topic's "exclusive to VS Code" claim, contradicted by its own child topic
and by the real Electron/CLI LSP fallback (26a/26b). No other product defect
was found in carried items 2-4 — each was already honestly implemented and
tested; this harness adds cross-batch regression pins for them rather than new
fixes.

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`
  → all 6 tasks green (test/lint/typecheck × 2 projects), ~1m22s.
- `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`
  → both green.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`
  → "All external imports are covered by package.json dependencies."
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`
  → `degradation-audit: TOTAL 300 unsuppressed site(s)` (per-lib baselines
  unchanged).
- `git diff --stat` on `ptah-core-prompt.ts` and `cli-adapter.utils.ts`: empty
  (unchanged, Decision 4).

## Pre-existing worktree state (not mine)

`git status` at session start/end also shows `.ptah/specs/TASK_2026_559_8ca9/
o2-go-vet-consent-surface.md` (modified) and three untracked files
(`code-logic-review.md`, `o2-go-vet-consent-surface-review.md`,
`o3-kotlin-grammar-provenance-review.md`, `research/diagnostics-worktree-repro.ts`)
that this session did not create or edit — left untouched, noted for the team
leader's awareness since this is a shared lane worktree.

## Fix round (review r1)

Addressed all findings in `reviews/batch-27-code-logic-review-r1.md` (REVISE 4/10: 1 Blocking, 3 Serious, 1 Moderate). No git commands used; sabotage probes edited production files in place and were restored (verified via `git diff --stat`), not TEMP copies.

**R27-01 (Blocking, activation without executable proof)** — Added `HONESTY_CHECKS` (WIT) and `MCP_HONESTY_CHECKS` (MCP) registries: one real, executable async function per key that calls the actual tool path and throws on failure. New test asserts every fragment-activated, locally-owned key has an entry and runs it (`it.each`). The old "same-length array" negative test was replaced by running the SAME validator over a real all-supported fixture (must read fully-analysed) and a real mixed fixture (must be non-clean) — one validator, two real inputs, per the review's "same validator" requirement.

**R27-02 (Serious, self-comparison snapshot)** — Added `EXPECTED_REQUIRED_KEYS`, a hand-typed, independent literal 58-key array (not derived from `required-keys.ts`), asserted equal to `sortedRequiredKeys()`. Added a category-completeness test (`typeCheck` included; an unrecognised category fails). `typeCheck:go` is proved through the real `LanguageAwareDiagnosticsProvider` (Go stays syntax-only), not the registry.

**R27-03 (Serious, symbol tools/24d kinds not guarded)** — Rewrote the shared symbol check to run the real `CodeSymbolIndexer` + real tree-sitter over a fixture declaring every 24d export kind (interface/type/enum/variable/namespace/export-clause), asserting the exact kind map, plus a real `DependencyGraphService.getSymbolIndex` proof (`honesty:ptah_get_symbol_index` now checks the graph-backed surface specifically, not just the SQLite indexer).

**R27-04 (Serious, dispatcher/spool untested; wrong 26b mapping)** — `mcp-mandate-manifest.spec.ts`: `ptah_lsp_references`/`ptah_lsp_definitions` now map to BOTH the original recall guard and the actual truncation guard (`'reports the match cap as truncated'`, `'qualifies the definition answer as truncated'`), plus a test asserting these exact titles and that they are AST-verified active tests. `mcp-language-coverage.spec.ts`: added a real `handleMCPRequest` dispatch suite (trimmed from Batch 9b's harness) driving `ptah_get_dependents` through warm/building/failed graph states, asserting `status` is the first key and the response text is byte-equal to `JSON.stringify(body)` (raw spool, no paraphrase).

**R27-05 (Moderate, CLI fallback overstated)** — `system-namespace.builders.ts`: corrected the `ide`/`ide.lsp` help text — only the Electron desktop app registers a real LSP fallback; the CLI registers no IDE host at all (`mechanism: 'none'`), matching `ide-namespace.builder.ts:212-233`. Added a test naming the desktop app (not the CLI) as the fallback host.

### Sabotage proofs (each: revert in place, run, confirm fail, restore, confirm `git diff --stat` clean)

| Finding | Sabotage                                                                        | Result before restore                                                                           | `git diff --stat` after                                               |
| ------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| R27-01  | Added `parse:java` to `b27-baseline.ts` with no check                           | 2 tests fail (missing-check test + registry-grant test)                                         | clean (new untracked file, marker removed)                            |
| R27-02  | Swapped `typeCheck:go` → `typeCheck:kotlin` in `required-keys.ts`               | 1 test fails (independent snapshot mismatch)                                                    | clean                                                                 |
| R27-03  | `code-symbol-indexer.service.ts:1102` export loop → `.slice(0,0)` (typed empty) | 2 tests fail (`ptah_code_search_symbols`, `ptah_code_reindex`) — exact kind list vanishes       | clean                                                                 |
| R27-04  | `mcp-response-formatter.ts`'s `qualified` truncation flag → hardcoded `false`   | 4 tests fail (both truncated-report formatter tests + both new `MCP_HONESTY_CHECKS` lsp checks) | clean                                                                 |
| R27-05  | Reworded `ide.lsp` help to again claim a CLI fallback                           | 1 test fails (new R27-05 pin)                                                                   | clean (diff shows only this round's legitimate fix vs review-r1 base) |

All five restores confirmed via `git diff --stat` on the exact files (`b27-baseline.ts`, `required-keys.ts`, `code-symbol-indexer.service.ts`, `mcp-response-formatter.ts` show no diff; `system-namespace.builders.ts` shows only this round's real fix).

### Verification (post-fix)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache` → all 6 tasks green, 1m37s.
- `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → green.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300 unsuppressed site(s)`.
- `ptah-core-prompt.ts` / `cli-adapter.utils.ts`: `git diff --stat` empty (unchanged).

### Spec runtimes (standalone `--testFile`, `--skip-nx-cache`)

| File                                | Tests | Time |
| ----------------------------------- | ----- | ---- |
| `language-honesty.contract.spec.ts` | 21    | 6.9s |
| `mcp-language-coverage.spec.ts`     | 15    | 5.3s |
| `mcp-mandate-manifest.spec.ts`      | 51    | 3.8s |
| `system-namespace.builders.spec.ts` | 23    | 2.8s |

### Product defects found this round

None new. R27-05's help-text inaccuracy was the only real product-facing defect the review found in Batch 27's own work (the CLI-fallback overclaim), and it is fixed above (minimal text change, no behavioral code touched).

### Deviations / known limits

- Cross-project "every activated key has a check" enforcement is per-project (WIT's `HONESTY_CHECKS`/`CHECKED_ELSEWHERE`, MCP's `MCP_HONESTY_CHECKS`), pinned by two independent literal 3-key lists rather than one shared import — `workspace-intelligence` has no public `/testing` subpath to import from `vscode-lm-tools`, and adding one was judged out of scope for a review-fix round (layering stays one-directional; flagged here for a future batch if tighter cross-project enforcement is wanted).
- The real dispatcher/spool test covers one representative tool (`ptah_get_dependents`); `ptah_get_dependencies`/`ptah_get_symbol_index` share the same dispatcher code path (Batch 9b's own harness already covers all three in full).
