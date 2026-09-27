# Code Logic Review — TASK_2026_559_8ca9 — Batch 29a1 r1

## Summary

| Metric                          | Value                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Part 1: rolled-forward Batch 27 | R27-01/02/05 verified; R27-03/04 partially fixed, OPEN as detailed below          |
| Part 2: Batch 29a1              | APPROVE — 8/10                                                                    |
| Overall assessment              | NEEDS_REVISION for the two carried harness gaps; no new 29a1 product defect found |
| Blocking / Serious / Moderate   | 0 / 2 / 0                                                                         |
| Failure modes                   | 2, both carried from Batch 27                                                     |
| Requested verification          | Six targets passed, 1m 46s; scoped diagnostics: zero errors/warnings              |

The language-module extraction preserves the examined behavior. Independent comparison against commit `6c91157f2f5a053070a17ab689b194f00eb61ed3` confirms the configuration, all 20 query strings, registry values, ordered extension lookup and advertised language claims remain equal. The existing specs are unchanged. The repaired activation and export-kind guards now reject their original sabotage cases, but unsupported-file accounting and real spool recovery remain insufficiently guarded.

Score rationale: Part 2 earns 8 rather than 7 because old/new runtime equivalence, ordering, unchanged tests and module-load behavior were independently checked. It does not receive 9–10 because this is scoped configuration/bundle verification rather than packaged application startup, and the surrounding harness still has carried gaps. Overall work remains incomplete because of those gaps, not because the pure move should be redesigned.

Path abbreviations, relative to the worktree: `WI` = `libs/backend/workspace-intelligence/src`; `WIT` = `WI/testing/mcp-contract`; `MCP` = `libs/backend/vscode-lm-tools/src/lib/code-execution`.

## Part 1 — rolled-forward findings

| Previous finding                                                  | Status                           | Evidence / replay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R27-01: activation without an executing check                     | VERIFIED for the activation gate | `WIT/language-honesty.contract.spec.ts:340,745,755` provides the executable registry, checks activated ownership and awaits every registered check. The three MCP-owned checks execute at `MCP/mcp-core/mcp-language-coverage.spec.ts:266,275`. TEMP replay grants Java parse in the production registry and adds `parse:java` in a fragment without a check: the missing-check assertion fails specifically on `parse:java`, while the registry grant passes. The ten WI checks also run during that selection. This closes the prior Blocking activation false green. |
| R27-02: self-derived key snapshot                                 | VERIFIED                         | `WIT/language-honesty.contract.spec.ts:162,251` compares against a separately written literal set. Swapping Go typeCheck for Kotlin typeCheck now fails the snapshot. The typeCheck category is recognized at :231 and the real Go diagnostic is explicitly checked at :861. Current data remains the 58-key Decision 18/19 set, excluding Kotlin graphEdges/publicSymbols.                                                                                                                                                                                             |
| R27-03: missing export-kind/tool checks                           | OPEN, partly fixed               | `WIT/language-honesty.contract.spec.ts:408,465,580` now uses the real graph symbol-index path and real parser/indexer kind oracle. Removing the export-row iteration causes exactly the two code-search/reindex guards to fail, identifying interface/type/enum/variable/namespace/export omissions. However, the old unsupported-file disclosure weakness remains at :605; see R29a1-01.                                                                                                                                                                               |
| R27-04: missing dispatcher/recovery checks and wrong host mapping | OPEN, partly fixed               | `MCP/mcp-core/mcp-mandate-manifest.spec.ts:156,167,854` now names the actual match-cap and definition-truncation guard titles, alongside the recall guards. Real handleMCPRequest building/failed/warm checks were added at `mcp-language-coverage.spec.ts:302`. But they never exercise/read a raw spool or an oversized/partial result; their round-trip JSON check is not spool equality. See R29a1-02.                                                                                                                                                              |
| R27-05: help overstates CLI support                               | VERIFIED                         | `MCP/namespace-builders/system-namespace.builders.ts:56,245` now distinguishes Electron fallback from CLI's absent IDE host. The new consistency pin at `system-namespace.builders.spec.ts:357` checks both hosts and passes in the scoped run. It matches the no-host namespace implementation at `ide-namespace.builder.ts:403,457`.                                                                                                                                                                                                                                  |

R27-01's future activation gate is materially repaired; this does not establish that every possible future check is a sound oracle. The existing nonactivated classifier check still explicitly skips TSX/Kotlin without fixtures (`language-honesty.contract.spec.ts:845`); their activation batches must supply actual fixture contracts. No remaining Blocking finding is asserted by this review.

## Part 2 — pure-move review

### Runtime equivalence and key order

`WI/ast/languages/index.ts:14` declares modules in JavaScript, TypeScript, Python, Go, C# order. `tree-sitter.config.ts:12,16,30,44` assembles maps in that order, retaining the extension sequence:

`.js, .jsx, .ts, .tsx, .py, .go, .cs, .csx`.

The registry deliberately retains the distinct `LANGUAGE_IDS` order through `language-registry.ts:159`: TypeScript, JavaScript, TSX, Python, Go, C#, Java, Kotlin, Rust, PHP, Ruby, C++. This matters for `supportedLanguagesFor`, recognition and descriptions; it was compared rather than assumed from module import order.

Independent TEMP bundles of the committed old sources and current sources produced equal configuration values, all 20 query strings, registry data, recognized-extension arrays, all eight capability language lists, and extension/classifier results across every recognized suffix, including case normalization. Equality held under both apps' actual tsconfig/Node20 ESM settings. No query or capability change was found in the five fully read modules.

Independent real-dispatcher tools/list captures are byte-identical before/after: **125,790 bytes**, SHA-256 `43c89fe184fbd11beeab30965bef2804898cdcd95830a838a82e278938eac0a4`. Both baseline/current sweep cases passed their four caller-kind stability assertions (`MCP/mcp-core/mcp-contract.sweep.spec.ts:2167`). Runtime public export-name sets for both configuration and registry are also equal, including function exports. The TEMP capture filename collision was corrected by preserving the baseline and recapturing the current payload; the final comparison uses separate files.

### Initialization, side effects and cycles

The move changes the location of data initialization, not its timing contract. All five modules still initialize eagerly when the assembly/registry loads; they contain string constants and plain data objects, without filesystem access, processes, timers, asynchronous work or WASM loading. Import order therefore adds no externally observable initialization effect.

The apparent cycle is erased: `languages/types.ts:2` imports LanguageCapabilities with `import type`, and `javascript.language.ts:8` imports GraphEdgesCapability type-only. TypeScript depends on JavaScript's query constants at runtime, but JavaScript does not depend on the registry at runtime. Esbuild input metadata confirms the types module adds no runtime back-edge. Jest project tests passed. A separate production-mode webpack/TypeScript-transpilation smoke bundle also loaded and returned equal registry/config values.

Both current product main targets actually use esbuild: `apps/ptah-cli/project.json:12` and `apps/ptah-electron/project.json:9`; this review did not assume a webpack-built CLI. The webpack probe is additional cycle/erasure coverage, not a full product build claim.

### No-spec-change and FB requirement

Compared all **131 tracked `.spec.ts` files** in the two reviewed projects with the baseline object tree, normalizing CRLF only: **zero changes**. No git command or state change was used; baseline blobs were read directly into TEMP for comparison. The six current verification targets passed.

Missing failing-before evidence is **acceptable for 29a1**: `batches.md:3784` and `implementation-plan-languages.md:228` explicitly designate a pure move, unchanged-green specs, and FB n/a. A manufactured behavioral regression or new spec would not strengthen this move's stated proof. The executor's exact historical test counts remain author evidence; this run's Nx summary did not print per-test counts, so they are not independently claimed here.

### Readiness for 29a2

The modules already own extensions, recognition-only extensions, grammar filenames, queries and declared capabilities (`languages/types.ts:43`). `tree-sitter.config.ts:29` exposes the grammar map for the next loader change. `tree-sitter-parser.service.ts:138` still performs the old all-grammar initialization; that is intentional in 29a1 and exactly the behavior 29a2 will replace with per-language latches. No second data move is necessary for that change. This approval does not pre-approve lazy failure isolation, concurrency or size refusals before they exist.

## Numbered findings — carried harness corrections

### R29a1-01 — Serious — unsupported-file accounting can disappear while the symbol honesty checks pass

- **Origin:** unclosed disclosure portion of R27-03; not introduced by 29a1.
- **File:** `WIT/language-honesty.contract.spec.ts:605` (mixed run), :634 (contrast).
- **Concrete scenario:** remove `this.countUnsupported(run, filePath)` from the real indexer's unsupported-file branch. The Elixir file is skipped without contributing an unsupported count. The supported symbols and export kinds remain correct.
- **Observed symptom:** all **10 executable WI honesty checks pass** against that mutated production copy. The mixed run still has `clean: false` due to independently unknown census buckets. The all-supported contrast checks analyzed/failed/unchecked, but does not compare unsupported accounting against the mixed run. Thus it does not prove the missing file was disclosed.
- **Impact:** the named code-search/reindex honesty keys accept a regression that silently understates unsupported files. The repaired 24d kind checks work, but they do not close the coverage portion of the prior finding.
- **Recommendation:** assert exact mixed-run unsupported count and language bucket (Elixir), plus the corresponding zero/absent bucket in the all-supported run. Retain exact supported analyzed counts. Make the same field-removal mutation fail at least the two owning checks.
- **Disposition:** **fix-now** in the rolled-forward Batch 27 correction; verify in the next Lane A review (29a2), per Decision 24.

### R29a1-02 — Serious — the new “raw spool equality” assertion compares a response to itself

- **Origin:** unclosed recovery portion of R27-04; not introduced by 29a1.
- **File:** `MCP/mcp-core/mcp-language-coverage.spec.ts:407,450,463,479`.
- **Concrete scenario:** raw spool writes are corrupted, or a qualified large result loses recovery bytes. The new suite only generates small warm/building/failed responses, parses their text into `body`, and checks `text === JSON.stringify(body)`.
- **Observed symptom:** replacing the production copy's raw spool write with literal `CORRUPTED` leaves **15/15 tests green**. There is no spool-file read or independently captured raw payload in the spec; the comparison at :450 can only establish JSON serialization form. No oversized partial-coverage result reaches recovery here.
- **Impact:** the required Task 27.3 recovery guard is still absent despite the new test names and report claiming byte-equal raw spooling. The status-order and safe-error assertions are real improvements, and the corrected host mandate mapping is valid, but neither detects this failure mode.
- **Recommendation:** drive an over-budget qualified/partial payload through the real dispatcher with a TEMP host-owned spool root. Capture raw expected bytes before dispatch, require the returned recovery locator, read the referenced file and compare bytes. Assert the ordered status/coverage prefix in the bounded response and add the required sweep shape. Preserve the existing small-response tests under accurate serialization descriptions.
- **Disposition:** **fix-now** in the rolled-forward Batch 27 correction; verification rolls to the next Lane A review. Existing Batch 21 recovery tests elsewhere are useful, but do not prove this requested language-coverage shape was added.

## Five logic questions

1. **How does this fail silently?** The two carried harness checks accept unsupported-count loss and corrupted recovery (R29a1-01/02). No additional silent failure was found in the module extraction itself.
2. **What user action produces unexpected behavior?** A future author can regress unsupported accounting or spool recovery without these named honesty tests catching it. Current extension lookup and description generation retain their original order (`tree-sitter.config.ts:16`, `language-registry.ts:160`).
3. **What input produces a wrong answer rather than an error?** A mixed supported/Elixir index can omit its unsupported count while remaining generically non-clean. Large qualified responses are not supplied to the claimed spool guard. The move's recognized suffixes and query text are unchanged.
4. **What happens when a dependency fails?** The move does not add dependencies or change loader error handling. Grammar initialization still has its existing all-language failure behavior (`tree-sitter-parser.service.ts:138`); isolation is explicitly 29a2. The dispatcher failed-state test checks safe error/status text, but not recovery files.
5. **What is missing that the requirements never mentioned?** No additional product requirement is needed to explain the findings. The open cases are explicit carried 27 requirements. Packaged application startup remains outside the scoped bundle smoke evidence.

## Data flow and requirements

| Step / requirement                      | Result                | Evidence / practical limit                                                              |
| --------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| Per-language data to assembled maps     | OK                    | Ordered Object.values/fromEntries, `tree-sitter.config.ts:12`; runtime old/new equality |
| Maps/modules to registry                | OK                    | `language-registry.ts:132,159`; derived parse/publicSymbols preserved                   |
| Registry to classification/descriptions | OK                    | All suffix/capability probes and tools/list comparison                                  |
| Query strings to parser                 | OK for move           | 20 strings equal; current parser/WASM tests pass                                        |
| Runtime import cycle                    | OK                    | Type-only back-references; esbuild/Jest/webpack smoke evidence                          |
| Eager/lazy initialization               | UNCHANGED             | No grammar loaded by language module import; old parser initialization retained         |
| Future activation must execute a check  | VERIFIED correction   | Missing Java check now fails independently of granted registry capability               |
| Unsupported-file accounting             | PARTIAL               | R29a1-01                                                                                |
| Qualified response recovery             | PARTIAL               | R29a1-02                                                                                |
| Readiness for isolated grammar loading  | COMPLETE prerequisite | Grammar metadata centralized; latch/error behavior remains 29a2 work                    |

## Verification and limits

- Requested `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: all six targets passed in **1m 46s**. No workspace-wide suite was run.
- `ptah_get_diagnostics`, scoped to the moved assembly/registry: **0 errors, 0 warnings**, TypeScript compiler source.
- Original sabotage replays: unproved Java activation **1 failure**; wrong required key **1 failure**; removed export indexing **2 failures / 8 executable checks passing**. These are expected failures and verify the corresponding fixes.
- Additional probes: unsupported accounting removed **10/10 executable checks pass**; corrupt spool writes **15/15 MCP tests pass**. These demonstrate the two remaining gaps without alleging the entire repository would pass those mutations.
- Runtime old/new equivalence under both product esbuild configurations; extra webpack smoke result equal; 131 tracked specs unchanged.
- All probes, baseline copies and logs live under `C:/Users/abdal/AppData/Local/Temp/ptah-review29a1-ZnN5Hw`. Source and specs were never edited. No git command was run. Only the requested review and the role-required task-root review were written in the worktree.
- Full Electron/CLI packaging/startup, validate-deps and audit were not rerun here. The executor reports those additional checks; this review distinguishes them from independently executed evidence.

## Verdict

- **Part 2 Recommendation: APPROVE — 8/10 for Batch 29a1.**
- **Part 1: two Serious carried gaps remain OPEN; correct them and verify in the next Lane A review.** No Blocking rolled-forward finding remains.
- Overall assessment: NEEDS_REVISION for the carried harness corrections; the pure move itself may be accepted on its own evidence.
- Confidence: HIGH for runtime equivalence and the demonstrated mutation outcomes; MEDIUM for unexecuted packaged host startup.
- Top risk: the harness still confuses generic non-clean status and JSON serialization with precise omission accounting and byte-equal recovery.
