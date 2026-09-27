# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 21 r1, Lane A. Source remained read-only. Both new specs were read in full. Requirements: context.md Decisions 4/7/17/18/21/22, batches.md:2827–2861, task.md, and the language plan. The executor report was checked against current source and a temporary dispatcher probe. No task-description.md, base implementation-plan.md, code-style-review.md or applicable AGENTS.md was found. ptah_search_files returned no AGENTS.md; no native file-read tool was listed, so reads used PowerShell.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 3/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 3              |
| Serious issues      | 3              |
| Moderate issues     | 3              |
| Failure modes found | 9              |

The passing suite accepts two actual error responses and an anonymous-agent refusal as coverage. It omits served tools, never measures returned tokens, and does not enforce per-tool preservation. These central failures separate it from the 5–6 band. Live enumeration, caller-list stability, real budget plumbing and two exact spool comparisons separate it from the 1–2 band.

Paths below are repository-relative. **core/** = libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/; **stdio/** = sibling mcp-stdio/. **sweep** and **manifest** refer to the two reviewed specs in core/.

## Coverage

Live probe: **56 HTTP tools with IDE capabilities, 53 without**, identical names across anonymous/agent/session/workspace callers within each configuration. The full sweep has **54 drivers**, not the report's 43. The context's 53 matches the non-IDE catalog. The three extras are ptah_lsp_references, ptah_lsp_definitions and ptah_get_dirty_files; all have drivers.

| Caller kind           | Served, IDE / non-IDE HTTP     | Swept, IDE / non-IDE                   | Missing                                                                                                    |
| --------------------- | ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| anonymous             | 56 / 53                        | 54 attempted / 0 in that configuration | execute_code; approval_prompt explicitly skipped; non-IDE configuration                                    |
| agent                 | 56 / 53                        | 0 / 0                                  | Caller-specific executions, especially agent_report delivery                                               |
| session               | 56 / 53                        | 0 / 0                                  | Caller-specific executions                                                                                 |
| workspace             | 56 / 53                        | 0 / 0                                  | Caller-specific executions                                                                                 |
| external stdio client | 8 before allow-tools filtering | 0                                      | agent_spawn, agent_status, agent_read, agent_message, agent_report, agent_stop, agent_list, session_submit |

Zero means that route/configuration is unswept, not that shared HTTP names lack drivers. Of the 54 anonymous attempts, count_tokens and get_symbol_index return isError; agent_report returns the 79-character unattributed-caller refusal. Attempted count is not successful oversized-output coverage.

| Host/registration path  | Catalog evidence                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code HTTP            | IDE registered at apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:126 → 56 with all namespaces enabled                                               |
| Electron HTTP           | IDE registered at apps/ptah-electron/src/di/phase-3-storage.ts:189 → 56; HTTP derives flags at mcp-http/http-mcp-server.service.ts:297 and forwards at :377 |
| HTTP without IDE        | 53; core/protocol-dispatcher.ts:421 gates the three IDE tools                                                                                               |
| CLI mcp-serve stdio     | Separate eight-tool catalog at stdio/tool-builders.ts:33/:143; apps/ptah-cli/src/cli/commands/mcp-serve.ts:344/:359 uses its separate server                |
| Namespace-disabled HTTP | Subsets: agent 7, git 3, json 1, browser 11, harness 6, code 10, IDE 3; core/protocol-dispatcher.ts:394–485. No subset sweep                                |

All 11 browser and six harness tools have drivers. Dashboard proposal and both surface tools are always on (core/protocol-dispatcher.ts:416–420). hasSqliteLayer changes eager metadata, not membership. No hidden conditional family explains “43.” Caller-byte-stability is checked only with both flags true (sweep:829–840).

## Five logic questions

### 1. How does this fail silently?

A missing response becomes empty text and passes (sweep:725–729/:807–823). Existing broken count-token/symbol-index fixtures pass as short errors. Most rows do not assert marker or spool behavior at all (sweep:797–823). Defects 2 and 4.

### 2. What user action produces unexpected behaviour?

Adding a stdio tool never enters this sweep (stdio/stdio-mcp-server.service.ts:132). Reporting as a real agent executes a different branch from the tested refusal (core/protocol-dispatcher.ts:1190–1208). Reading a large HTML page loses the planted title despite a passing HTML test. Defects 1 and 5.

### 3. What input data produces a wrong answer?

Token-dense text passes character-only checks (sweep:815). String-valued LSP fixtures produce empty location labels because the formatter expects objects (sweep:159/:169; core/mcp-response-formatter.ts:929/:960). Removing diagnostic messages while retaining filenames/headings still satisfies the purported verbatim test (sweep:1044–1045).

### 4. What happens when a dependency fails?

A throw converted into a short isError response passes. Spool failures pass most rows because only two examples read spools. Deleted/skipped guard tests pass the manifest if their title remains in a comment (manifest:145–150). Defects 2, 4 and 6.

### 5. What is missing that the requirements never mentioned?

Portable locator parsing, positive branch-invocation assertions, and transport-specific inventory are necessary to make this guard reliable (sweep:933/:969, core/protocol-dispatcher.ts:1191, stdio/stdio-mcp-server.service.ts:124). Later language/coverage work must stay visibly pending (sweep:1052), not be counted as passed.

## Failure modes / numbered defects

### 1. Blocking — Served tools and caller/host paths escape the sweep

- File: sweep:755–767, :785–789, :830–840.
- Trigger → symptom: regress execute_code budgeting or add a stdio tool → sweep remains green. Regress attributed agent_report → anonymous refusal still passes.
- Evidence: core/protocol-dispatcher.ts:3257–3287 serializes and budgets execute_code text. It is not a non-text tool. stdio/stdio-mcp-server.service.ts:124–140 has a distinct catalog and :210/:219 separate dispatch. core/protocol-dispatcher.ts:1191–1208 separates report refusal/delivery.
- Current handling: fixed true/true dependencies; caller variation only for tools/list. execute_code skipped, stdio never imported.
- Impact: served tools have no contract-sweep protection, meeting the explicit Blocking coverage criterion.
- Recommendation: enumerate and dispatch each served host/transport catalog under each caller context. Add execute_code oversized serialized output and all eight stdio tools with their own contracts. Retain approval_prompt only as an explicit tested bounded-control-response exception. Assert driver invocation where the route permits it.

### 2. Blocking — Broken fixtures and short errors count as coverage

- File: sweep:184–190, :606–619, :725–729, :807–823.
- Trigger → symptom: unmodified drivers return count_tokens isError (86 chars) and get_symbol_index isError (89 chars); both pass. Observed in the temporary probe.
- Evidence: count_tokens needs workspace resolution, files.read and context.countTokens (core/protocol-dispatcher.ts:1013–1015), but supplies only files.countTokens. Symbol-index rendering expects page.files/total/offset (:2903–2914); the driver supplies entries/nextOffset. LSP drivers use strings where formatters read location objects (core/mcp-response-formatter.ts:929/:960).
- Current handling: textOf ignores errors and defaults to empty; no assertion checks API invocation or that the formatted budget input was oversized.
- Impact: CI certifies success paths that were never exercised; broken wiring can make tests easier to pass.
- Recommendation: contract-correct typed fixtures; no JSON-RPC error; expected isError status; nonempty text; invoked API; measured pre-budget formatted input. Separate deliberate error cases. Fix count-token dependencies, SymbolIndexPage fields and LSP location shapes. The agent-report refusal is additionally addressed by defect 1.

### 3. Serious — Returned tokens never checked; expected budgets can grow with production

- File: sweep:808–815, :929–930, :1056–1058.
- Trigger → symptom: remove token enforcement but retain character cutting → main sweep passes. Raise production metadata/budget together → expected limits rise with the implementation.
- Evidence: only token assertion checks one fixture >500, despite the 2,000-token default (core/tool-result-budget.ts:48). Production promises trailer-inclusive limits (:22–24); sweep invents 5% +200 extra allowance.
- Current handling: character-only checks and production-derived expected ceilings.
- Impact: the primary token-saving contract can regress unnoticed.
- Recommendation: independently pin 2,000 tokens/8,000 chars and documented overrides; validate metadata against those pins; count complete returned text, trailer included. Add token-dense input below the char ceiling. Assert real page contracts for exceptions; remove unsupported allowance.

### 4. Blocking — Required per-tool preservation/spooling reduced to two examples

- File: sweep:797–823, :889–893, :1023–1045.
- Trigger → symptom: reducer deletes useful content or a tool stops spooling → most rows remain green. Diagnostic messages can disappear while file_0.ts and “Requested files” remain.
- Evidence: only JSON/Markdown examples read spools (:947/:974). Main loop never asserts marker/reducer/spool; many mocks ignore markers (:142/:552/:579). Diagnostics checks hint configuration and headings, not reducer:none or exact messages. Agent-read's log preservation is unverified: marker is simply at the beginning of 4,000 lines (:223–239).
- Current handling: representatives replace batches.md:2846's explicit every-tool/every-shape requirement.
- Impact: CI silently approves token savings obtained by discarding the answer.
- Recommendation: per-driver raw-output and semantic expectations for each supported shape; reducer identity, token budget, exact spool bytes and meaningful markers. Explicit page/preformatted contracts. Diagnostics must check reducer:none and exact requested messages/order. Recomputing the formatter is a legitimate pre-budget byte oracle, but not independent semantic-recall evidence.

### 5. Serious — browser_content HTML reducer is not wired through the product

- File: core/protocol-dispatcher.ts:1639; core/mcp-response-formatter.ts:1754–1770; sweep:996–1020.
- Trigger → symptom: oversized article fixture → dispatcher returns markdown-outline, approximately 450 chars, without MARK-ptah_browser_content. Direct reduceOutput test still passes.
- Evidence: formatter caps and wraps HTML behind “## Page Content”; libs/backend/tool-output-reducers/src/lib/content-detector.ts:126–135 requires HTML starting with `<`. core/tool-result-budget.ts:86–92 has no browser-content hint. Probe confirmed marker loss.
- Current handling: test accepts mismatch and bypasses dispatcher.
- Impact: page-content tool misses intended main-content extraction; agent receives headings instead of the article. This is a product integration defect.
- Recommendation: smallest coherent fix is a browser-specific budget boundary at dispatcher:1639 handing unwrapped, uncut HTML to reduction with an explicit hint, preserving raw content for spooling and formatting afterward. Alternatively expose that boundary from the formatter. Merely labeling the Markdown wrapper as HTML is insufficient. Regression must call handleMCPRequest and assert html-extract, title, budgets and spool equality.

### 6. Serious — Manifest checks arbitrary text, not executable test titles

- File: manifest:145–150, :179–180.
- Trigger → symptom: delete guard but retain its title in a comment, or use it.skip/it.todo → content.includes still passes.
- Evidence: no parsing of declarations; broad mapped suite labels also occur in benchmark comments (libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts:332/:498/:880).
- Current handling: file existence and substring. Reported absent-string mutation proves only this weaker condition.
- Impact: CI cannot establish that mandated tools retain runnable guards.
- Recommendation: AST-check active test declarations, literal/concatenated titles and suite paths; reject comments/skip/todo, require an active child when mapping a suite. Break proofs should delete the test while retaining its title and mark it skipped. Keep the new-name/no-map check.

### 7. Moderate — Wrong symbol guard; missing diagnostic cap guard

- File: manifest:89–92, :110–113.
- Trigger → symptom: remove actual Batch 5 recall benchmark or Batch 1 formatter cap test → manifest passes.
- Evidence: code-symbol.store.spec.ts:166 checks SQL preparation/binding (:167–175), not recall. Actual requested recall benchmark is :935. batches.md:2854 requires provider contract AND formatter cap; only the former is mapped. Cap test exists at core/mcp-response-formatter.spec.ts:580.
- Recommendation: multiple guard entries per tool; map actual recall benchmark and both diagnostic guards. Shared run-diagnostics-provider-contract.ts is legitimate but not a discovered .spec; verify a host invocation with createSecondCheckout, since :214 otherwise returns without exercising it.

### 8. Moderate — Spool regex assumes drive-letter paths without spaces

- File: sweep:933–935 and :969–971.
- Trigger → symptom: POSIX, spaced Windows temp root or relative locator → valid spool fails regex.
- Current handling: `[A-Za-z]:` and `[^\s]+` required.
- Recommendation: parse documented trailer delimiters, resolve relative paths against injected spool root, assert containment, and test all three path forms.

### 9. Moderate — Global description ceiling is not a per-tool budget

- File: sweep:859–873.
- Trigger → symptom: greatly expand a short description but stay under 5,000 → “per-tool” sweep passes.
- Evidence: several existing 1,000-character ceilings at core/tool-description.builder.spec.ts:23/:41/:51/:67; distinct 3,000 whole-definition ceiling at core/dashboard-propose-spec.tool.spec.ts:106. Sweep substitutes one maximum.
- Impact: universal guard misses individual description growth; dedicated specs protect only their subset.
- Recommendation: explicit per-tool budget map, distinguish description/whole-definition limits, fail new tools lacking a budget. Keep aggregate dated size pin separately.

## Blocking issues

Defects **1, 2, 4**: unswept served paths; actual errors accepted; unguarded semantic/spool preservation. Evidence, impact and fixes above.

## Serious issues

Defects **3, 5, 6**: token assertion missing; HTML integration broken; manifest cannot establish runnable guards.

## Moderate and minor issues

Defects **7, 8, 9**. The report's 43-tool count and flat-array account also need correction; not counted as additional failure modes.

## get_dependents: reducer:none

Acceptable as a reducer outcome, not proof of the complete contract. core/protocol-dispatcher.ts:2051 emits an object with count/file/dependents, not a bare array. Its string-array field offers no tabulation saving; refusal followed by disclosed cut/spool is legitimate. Probe observed reducer:none. Assert actual output, spool and count/completeness fields. Fixture coverage is explicitly undefined (sweep:561), so it cannot prove coverage honesty. Keep Batch 24r todo pending (:1052); Decisions 21/22 authorize later work, not declaring it passed.

## Data flow

1. Host flags/namespaces → **GAP** true/true/all-enabled only (sweep:755).
2. Caller and live tools/list → **OK** real catalog and four caller-list comparisons (core/protocol-dispatcher.ts:354; sweep:830).
3. Driver selection → **GAP** exclusions/stdio transport absent; **OK** new full-HTTP names fail with a named message (sweep:785–794).
4. Fake API → formatter → **GAP** wrong fixtures and anonymous report refusal (defect 2).
5. Actual budget/reducer/spool → **OK** real code; **GAP** HTML wrapped before detection (defect 5).
6. Response assertions → **GAP** first text block only; no success/token/semantic checks for most rows (sweep:725/:807).
7. Prompt → map → filesystem → **OK** regex handles current table/code-span names, deduplicates, sorts and rejects unmapped ptah_* names (manifest:34–39/:169/:184); **GAP** arbitrary text substitutes for runnable titles (:150).

## Requirements fulfilment

| Requirement                                     | Status                             | Gap                                                                                                  |
| ----------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Every served tool/caller/host                   | PARTIAL                            | Defects 1–2                                                                                          |
| Character/page ceiling                          | PARTIAL                            | Unsupported allowance; page semantics generally untested                                             |
| Returned token ceiling                          | MISSING                            | Defect 3                                                                                             |
| Every shape, marker, reducer, exact spool       | PARTIAL                            | Two spool examples only; defect 4                                                                    |
| HTML article via browser_content                | MISSING                            | Defect 5                                                                                             |
| Diagnostics not reduced, entries verbatim       | PARTIAL                            | Hint/headings only                                                                                   |
| Dated +5% tools/list pin, caller byte stability | COMPLETE for sampled configuration | 125,374 bytes, 2026-09-27 (sweep:848–855); no host matrix                                            |
| Per-tool description budget                     | PARTIAL                            | Defect 9                                                                                             |
| Live mandate parsing/new-name failure           | COMPLETE for ptah_* names          | Current tables/code spans supported; literal prefix wildcard does not become a tool                  |
| Runnable, correctly mapped guards               | PARTIAL                            | Defects 6–7                                                                                          |
| Explicit reasoned exemptions                    | COMPLETE                           | web_search external-network exemption authorized at batches.md:2854; LSP/dirty-file host tests exist |
| Temp spool hygiene                              | COMPLETE in reviewed specs         | mkdtemp/injected root/afterEach removal (sweep:739–757)                                              |
| Language/coverage extension                     | PENDING                            | Batch 24r todo and later language acceptance remain                                                  |

Implicit requirements not addressed: portable locators, positive branch-execution evidence, skipped/deleted-guard detection.

Manifest spot checks: Electron lsp.getReferences has an actual word-boundary test at apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts:231–255; imported-class fallback at :573 exists; dirty-files test at :1186 deliberately asserts Electron's empty result. Benchmark suite labels exist at mcp-contract.bench.spec.ts:335/:500/:882. The symbol mapping exists but is semantically the wrong guard (defect 7).

## Edge cases

| Case                                      | Handled           | Concern                                                                       |
| ----------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| Empty tools/list                          | YES, main test    | >30 prevents fully vacuous loop, not partial omission (sweep:781)             |
| New full HTTP name without driver         | YES               | Named failure (sweep:792)                                                     |
| New stdio tool                            | NO                | Separate catalog ignored                                                      |
| Error/missing response                    | NO                | Empty/short text passes                                                       |
| Token-dense Unicode                       | NO                | Character checks only                                                         |
| Multiple text blocks                      | NO                | First text block only (sweep:728)                                             |
| Spool failure                             | NO for most tools | Two examples require spool                                                    |
| POSIX/spaced/relative locator             | NO                | Windows-only regex                                                            |
| Deleted/skipped guard with leftover title | NO                | Substring search                                                              |
| Repeated tests/temp cleanup               | YES               | Fresh root and teardown; no direct os.tmpdir()/.ptah writes in reviewed specs |

## Verification

- ptah_get_diagnostics scoped to both files: **0 errors, 0 warnings**, TypeScript compiler.
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: **PASS**, 51.3 seconds total; test critical path 48.6 seconds. Tailed output, no workspace-wide check.
- `nx run degradation-audit:lint --skip-nx-cache`: **PASS**, TOTAL **300**.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: **PASS**.
- Temporary isolated Jest probe reused drivers and actual dispatcher without source edits: **1 passed**, 43.941 seconds including cold startup. Observed eight HTTP inventory combinations, 54 attempted rows, count_tokens isError (86 chars), get_symbol_index isError (89 chars), agent_report refusal (79 chars), browser_content markdown-outline with missing planted title (~450 chars). Other absent markers often mean the driver never planted them; they are not additional product findings.
- Author break proofs: missing metadata is meaningful; wholly absent title proves only substring detection; HTML marker mutation proves only direct reducer behavior. None establishes host/caller coverage or universal preservation. Reviewer did not mutate source.
- Author reports ~19 seconds for the two new suites; that isolated timing was not independently rerun. Scoped verification passed. Probe findings are recorded here; temporary probe files were removed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: green CI certifies the contract even when the intended API errors or the reduced result loses the answer.
- What a robust implementation would add: host/caller catalog matrix; typed successful fixtures and invocation checks; independently pinned token/char ceilings; per-tool shapes/markers/spools; browser HTML integration; executable and correctly mapped manifest guards; portable locator parsing.
