# Code Logic Review — TASK_2026_559_8ca9 / Batch 26b r1

## Summary

**Recommendation: REVISE — 4/10.** The forwarding contract, C# query compilation, normal cap flags, and rolled-forward 26a fixes work. However, passing coverage checks do not establish a stable, workspace-specific reference scope, and several omitted or unsuccessful searches still produce an unqualified report. Six reproduced silent-answer defects are Blocking under the review role's severity definition; three further boundedness/matching/disclosure defects are Moderate. These are independent correction targets, not requests for another 26b review round.

| Metric | Value |
| --- | --- |
| Assessment | NEEDS_REVISION |
| Blocking | 6 |
| Serious | 0 |
| Moderate | 3 |
| Failure modes | 9 |

Scope: the on-disk Electron capability, its new report/gate/C# tests, registry capability change, real graph selection/invalidation behavior, stream filtering, namespace forwarding, formatter, and dispatcher error exit. The authoritative task-branch Batch 26b/common checks, language plan and executor reports were read. Source/spec files were not edited; no git commands were run. A 4 rather than 3 reflects working wiring and tests; a 5 would require the reports to stop presenting demonstrably incomplete searches without qualification.

Paths below: **E** = `apps/ptah-electron/src/services/electron-ide-capabilities.ts`; **WI** = `libs/backend/workspace-intelligence/src`; **MCP** = `libs/backend/vscode-lm-tools/src/lib/code-execution`.

## 26a rolled-forward fixes

| Finding | Status | Evidence |
| --- | --- | --- |
| R26A-M1: empty result with unknown support | VERIFIED | `MCP/mcp-core/mcp-response-formatter.ts:1346` explicitly names unknown support; `:1363` qualifies support other than true. Re-ran the previous Node probe: array-host and legacy-array empty results both say not proof that none exist. New regression cases at `protocol-dispatcher.spec.ts:7093` exercise both tools. |
| R26A-M2: line/column zero | VERIFIED | Shared renderer at `mcp-response-formatter.ts:1386` checks coordinate presence; same probe returns `a.ts:0:4` and `b.ts:3:0`. Cases at `protocol-dispatcher.spec.ts:7111` and `:7139` cover reports and arrays. |
| R26A-m1: report-aware help | CARRY-TO-24c | `MCP/namespace-builders/system-namespace.builders.ts:253` still lists only array methods; accepted carry remains open. Not counted as a new 26b finding. |

## Numbered findings / failure modes

### 1. R26B-B1 — Failed or unresolved declaration scans become authoritative empty reports

- **Blocking; disposition: fix-now.** Evidence: **E:425**, **E:514**, **E:528**, **E:549**, **E:1056**.
- Trigger: no symbol-index candidate and the tree-sitter query returns an error Result; alternatively the file has an ERROR node, import resolution is unavailable, or an imported target cannot be read. `findDeclaration` returns `uncertain`, but the caller collapses uncertainty to `[]` and reports `declaration-scan`, `languageSupported:true`, no approximation and no truncation.
- Reproduction: probe `declaration-parser-failure` followed by `failure-rendered` produced exactly `Mechanism: declaration-scan; language: typescript` and `Found: 0 definitions`, without a qualifier.
- The same missing distinction applies to the limited fallback scope: a valid C# type used in another same-namespace file has no relative import to follow; local-only lookup cannot establish that no definition exists. The C# syntax-error spec at `electron-ide-capabilities.spec.ts:1700` currently pins empty locations with supported language, but never checks the resulting misleading prose.
- Fix: retain a typed unresolved/unavailable outcome through the fallback and report boundary. Throw an honest tool error for failed analysis, or extend/report an explicit incomplete-scope qualifier. Do not infer a successful exhaustive lookup solely from language capability. Keep the legacy list API's empty-array compatibility if required.

### 2. R26B-B2 — Language-level TS/JS capability does not prove reference completeness

- **Blocking; disposition: fix-now.** Evidence: **E:749**, **E:1113**; `WI/ast/language-registry.ts:93` sets `referenceScopeComplete:true` for both languages.
- Trigger: two valid TypeScript scripts: `a.ts` contains `function Foo() {}` and `b.ts` calls `Foo();`, with the declaration indexed. There is no import edge, even with a complete file census and perfectly clean import resolution.
- Reproduction `global-script-real-graph`: the actual DependencyGraphService built both real temporary files; the query returned only a.ts, `mechanism:'graph-scoped-scan'`, support true, no approximation/truncation. The b.ts reference disappeared.
- The author's out-of-scope note accurately identifies the existing condition, but the new per-query proof explicitly promises to exclude unsafe narrowing. Finding an indexed declaration does not turn a global script into a module. Ambient/global augmentation has the same underlying issue.
- Fix: require evidence that the relevant workspace/declarations have no implicit-global reference paths, or conservatively use the full text scan. Until such evidence exists, a blanket TS/JS flag is not sufficient. This is a design gap as well as an implementation gap; do not merely document the false-negative path.

### 3. R26B-B3 — Coverage is checked before an await and never revalidated

- **Blocking; disposition: fix-now.** Evidence: **E:746–755**, **E:766**, **E:716**.
- Trigger: coverage is clean, then `indexedDeclarations()` awaits a symbol read while a watcher invalidates a dependent file. The surviving declaration node still resolves, but its reverse edges have been removed. The scan publishes its old completeness conclusion with the new, incomplete edge set.
- Reproduction `real-invalidate-during-index`: the actual graph was built with b importing a; the symbol-reader callback invoked `invalidateFile(b)` before resolving. The report omitted b and remained unqualified graph-scoped. A separate controlled coverage-change probe showed the same result.
- Fix: bind the decision to a root/generation or immutable graph snapshot, and revalidate after asynchronous index work and before publishing the report (file reads also await). If the proof changed, fall back or disclose incompleteness. Merely rechecking `isBuilt` is insufficient because invalidation can leave the graph built.

### 4. R26B-B4 — The gate certifies one root but traverses a different cached graph

- **Blocking; disposition: fix-now.** Evidence: **E:748**, **E:761**, **E:784**; `WI/ast/dependency-graph.service.ts:842`, `:849`, `:1289`.
- Trigger: cache a clean parent graph containing `pkg/decl.ts` and `use.ts` importing it; also cache a graph rooted at `pkg`. Coverage is read for the parent workspace, but `resolveNodePath` and `getDependents` select by file and prefer the nested root. The nested graph cannot contain the parent's outside consumer.
- Reproduction `parent-certified-child-queried` uses two actual builds in an OS-temp directory. Parent coverage printed `clean:true`, analyzed 2, complete resolution; the report returned only pkg/decl.ts, excluding use.ts, with no qualifier.
- Fix: resolve nodes and traverse reverse edges on the exact graph snapshot/root whose coverage was certified. If the API cannot provide that guarantee, refuse narrowing when selection can differ. Re-checking parent coverage alone will not fix this case.

### 5. R26B-B5 — Per-file omissions are not reflected in the report

- **Blocking; disposition: fix-now.** Evidence: **E:837–838**, **E:807**, **E:914** (`safeReadFile`); `WI/file-indexing/workspace-indexer.service.ts:453–460`.
- Trigger A: a dependent exists in the certified scope but reading it fails with EACCES/EPERM. `safeReadFile` logs and returns null; `collectMatchesInFile` silently returns. The outer scan catch never sees the failure.
- Observed `unreadable-scope-member`: only the declaration was returned, graph-scoped/support true, no truncation or approximation.
- Trigger B: brute scan consumes `indexWorkspaceStream`, which drops stat-unreadable entries and files above its default 1 MiB size. Electron supplies no `onUnreadableEntry` observer and receives no oversized-file disclosure.
- Probes using the **unaltered on-disk stream method body** with controlled stat/discovery dependencies showed both an oversized file and a null-stat file omitted with no `truncated` flag (`real-stream-oversize-omission`, `real-stream-stat-omission`). The generic text-scan approximation does not disclose a size cutoff.
- Fix: carry read/size/stat omissions into report completeness, or fail the report honestly. Add a stream outcome/observer for all skipped eligible files, including the size limit; do not make the outer thrown-error catch the only incomplete-scan signal. Distinguish I/O failure from an actual cap where the contract permits it.

### 6. R26B-B6 — Existing string filters delete executable interpolation references

- **Blocking; disposition: fix-now.** Evidence: **E:246–248**, **E:855**.
- Trigger: a TypeScript/JavaScript consumer invokes Foo inside a template interpolation, such as `const s = `${Foo()}`;`. The query excludes the entire template_string, including executable expression nodes. Python's whole-string filter has the analogous f-string concern.
- Reproduction `real-typescript-template`: the shipped TypeScript grammar, actual exclusion query, and a scope explicitly containing both files returned the declaration but dropped the interpolation reference, with an unqualified graph-scoped report.
- Fix: use the same principle already applied to new C# interpolation: exclude literal text/comments, retain executable interpolation nodes. Add real-grammar TS/JS regression cases, and check Python f-strings. This predates the report API but directly falsifies the newly unqualified reference answer, so it must not be deferred as unrelated history.

### 7. R26B-M1 — The 25-candidate index cap is discarded

- **Moderate; disposition: fix-now.** Evidence: **E:472–490**, **E:423**, **E:751**.
- Trigger: symbol search fills its topK=25 page in a workspace with more same-named declarations. `indexCandidates` discards the page limit before producing either definitions or a narrowing decision.
- Reproduction `definition-top25`: 25 locations returned as symbol-index with no `truncated` field. The port (`libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts:13`) has no hasMore signal; that is a reason to be conservative, not to assume completeness.
- Fix: preserve an exhausted/unknown-candidate-set indicator from the raw page before exact-name filtering. Request a sentinel if supported, otherwise conservatively qualify a full page. Do not narrow on an incomplete candidate set unless unique binding was independently proven; otherwise omitted declaration scopes can compound the false negatives above.

### 8. R26B-M2 — Dollar-prefixed identifiers cannot be found by the text matcher

- **Moderate; disposition: fix-now.** Evidence: **E:238**, **E:840**.
- Trigger: valid TypeScript `const $Foo = 1; $Foo;`, queried at column 6. Identifier extraction accepts $, but JavaScript regex word boundaries do not consider $ a word character.
- Reproduction `dollar-identifier`: empty text-scan locations despite two literal occurrences. The approximation makes this less authoritative than the Blocking paths, but does not make systematic token-boundary failure correct.
- Fix: use boundaries based on the accepted identifier character set, not `\b`; test leading/trailing $, ordinary identifiers, and substrings. This inherited matcher bug affects the expanded scan/report path.

### 9. R26B-M3 — The 8,000-file limit does not bound discovery or per-file candidate allocation

- **Moderate; disposition: fix-now.** Evidence: **E:807–815**, **E:842–847**; `WI/file-indexing/workspace-indexer.service.ts:422`, `:646`.
- Trigger: a very large recognized-source tree. The stream first awaits discovery of the full file array; its adapter findFiles call receives `maxResults:undefined`. The consumer's 8,000 limit is reached only afterward. A dense matching file also builds the entire raw match array before applying the 500-result bound.
- Impact: discovery memory/time grows with all eligible files, and candidate allocation with all occurrences, despite the advertised bounded scan. This is source-traced, not a measured out-of-memory claim. The existing in-memory 8,001-path spec cannot establish a traversal bound.
- Fix: consume bounded/incremental discovery with an honest omitted-tail signal, and stream/count matches without materializing every candidate before the output cap. Preserve the desired policy on excluded matches and disclose any new work cap. Add instrumentation against a real adapter, not only a mocked generator.

## Five logic questions

1. **How can failure look successful?** Uncertain declarations collapse to a bare zero (B1); unreadable scope members vanish while the report remains unqualified (B5).
2. **Which actions cause unexpected behavior?** Query a global-script symbol, query with parent/nested graphs cached, or edit a dependent while the symbol lookup waits (B2–B4).
3. **Which input data produces wrong answers?** Interpolation expressions, dollar-prefixed identifiers, and a saturated symbol candidate page (B6, M2, M1).
4. **What happens on dependency failure?** Cursor-file failures throw through reportOf at E:285 and the namespace; scan read failures and Result-style declaration failures do not. The dispatcher catch at `MCP/mcp-core/protocol-dispatcher.ts:2342` returns `isError:true`, so real report rejections do not become Found:0.
5. **What was left unspecified?** A language-level edge capability is not a per-symbol completeness proof; the gate needs root/generation provenance, and both file-discovery and candidate caps need explicit outcomes (B2–B4, M1/M3).

## Data flow / requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Report methods wired and preferred | Complete | E:314/317; namespace delegates at `ide-namespace.builder.ts:274/:290`. |
| No-lookup failures become honest errors | Partial | Cursor failure propagated in probe; E:287 throws and dispatcher :2342 emits tool error. Other failures collapse as B1/B5. |
| Registry source extensions | Complete in pattern construction | E:107 and :806 use recognized extensions. Actual traversal bounds and stream omissions remain M3/B5. |
| C# declaration/comment query node names valid | Verified | Real shipped C# WASM successfully executed the new declaration query; scoped test suite includes real C# namespace/interpolation cases. |
| Narrow only with a complete reference scope | Incomplete | Positive predicates exist, but B2–B4 defeat their conclusion. |
| All caps/omissions disclosed | Partial | 8,000 yielded-file and 500 returned-match caps set truncation; B5 and M1 are missing. |
| Caveats survive budget | Verified for previous 26a probe | Re-run retained support, approximation and truncation ahead of 2,000 locations through the real markdown reducer. |
| CLI no-host | Existing coverage accepted | 26a namespace/dispatcher tests exercise absent capabilities; Electron need not duplicate them. No new CLI runtime test was claimed here. |

Registry C# definitionFallback is a justified adjacent edit: the capability claim belongs there and its positive query is proven on the real grammar. It does not justify certifying unsuccessful fallback searches (B1).

## Verification and reproducibility

- `node "$env:TEMP/task559-26a-r1-probe.cjs"` — rolled-forward warnings and zero coordinates verified; actual budget caveats retained.
- `node "$env:TEMP/task559-26b-r1-probe.cjs"` — reviewed source transpiled in a temp harness. Fixtures use `mkdtemp` under OS temp. Output saved at `%TEMP%/task559-26b-r1-probe.jsonl`.
- Harness uses actual Electron class, actual DependencyGraphService for global/nested/invalidation cases, controlled symbol/AST collaborators, actual formatter, and real shipped C#/TypeScript WASM for grammar/filter probes. For stat/size skips it executes the exact extracted indexWorkspaceStream method with controlled dependencies; this is not represented as a full adapter integration test.
- Namespace failure probe: missing cursor file rejected with `Lookup did not run: could not read ...`; dispatcher error propagation was traced on disk, not asserted via a live Electron MCP process.
- Required `nx run-many -t=test,lint,typecheck -p ptah-electron @ptah-extension/workspace-intelligence --skip-nx-cache` with NX_ISOLATE_PLUGINS=false/NX_DAEMON=false: **passed**. Header/final summary confirm two projects plus six prerequisite tasks. No known stress/missing-bundle failure occurred. Log `%TEMP%/task559-26b-checks.log`; one completion check, no rerun.
- CLI/Electron typechecks: passed. `ptah-electron:validate-deps`: passed. `degradation-audit:lint`: passed (executor reports TOTAL 300; the review command's short tail did not retain the numeric line).
- `ptah_get_diagnostics` on the two production paths reported unavailable after 45 seconds while its TypeScript check continued. It was not retried; the independent scoped Nx typechecks passed. Do not interpret that diagnostics call as a clean result.
- Author's base-failure evidence is plausible for the new APIs and edge-cap behavioral case; source swapping was not repeated in this read-only review. Passing new specs do not exercise the failures enumerated above.

## Verdict

- Recommendation: **REVISE**
- Score: **4/10**
- Confidence: **HIGH** for the reproduced wrong-answer paths; **MEDIUM** for the unbenchmarked cost impact in M3.
- Top risk: an unqualified graph-scoped report omits real references even when its upfront coverage check is clean.
- Required follow-up: one correction round under Decision 24, then verify these findings in the next lane review. No further 26b review round requested. Keep the existing 24c help carry separate.
