# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

**Batch 21 r2, including first review of Batch 21p: REVISE, 4/10.** The revision fixes the broken HTTP fixtures, adds meaningful token/spool checks, and wires accepted oversized browser HTML through extraction. It still does not sweep every served route, expressly waives returned-marker preservation for 18 tools, and can certify disabled/nonexistent manifest guards.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 3              |
| Moderate issues     | 1              |
| Failure modes found | 6              |

The score improves from r1's 3 because actual success checks, token ceilings, spool byte comparisons and browser integration now work. It remains below 5–6 because all-tool coverage and preservation—the central acceptance criteria—remain incomplete. No new defect was demonstrated in the narrow 21p implementation; this does not approve the incomplete Batch 21 guard.

Scope: both rewritten specs read in full; tool-result-budget.ts read in full; dispatcher/formatter/stdio/session-submit and referenced guard paths traced at their material boundaries, including all 21p helper and test logic. No source edits or git operations. Requirements: batches.md:2843/:2846, context.md Decisions 4/7/17/18/21/22, archived r1, both executor reports. No applicable AGENTS.md found in the worktree. Native reads were used because no ptah file-read tool is listed; diagnostics used ptah_get_diagnostics.

Path shorthand: **core/** = libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/; **stdio/** = sibling mcp-stdio/. **sweep** = core/mcp-contract.sweep.spec.ts; **manifest** = core/mcp-mandate-manifest.spec.ts.

## r1 findings status

| r1                                    | Status                            | Evidence / remaining issue                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — full catalog/caller/host coverage | PARTIAL                           | Counts pinned at sweep:1026/:1050; execute_code now called at :1540. Main execution remains one default host/caller (:1113/:1133), with agent_report override only. Stdio calls only two names. R2-01                 |
| 2 — short errors / broken drivers     | FIXED for identified HTTP cases   | Correct files.read/context.countTokens (:271), SymbolIndexPage (:755), LSP location objects (:216), attributed report (:347). Error and empty checks at :1150/:1157. Live probe: no error responses across 54 drivers |
| 3 — tokens and independent limits     | PARTIAL                           | Literal default/override pins at :971/:976; returned tokens/chars at :1180. Screenshot continues before either check. R2-04                                                                                           |
| 4 — universal markers/reducers/spools | OPEN                              | Raw capture and byte comparison added (:1206/:1226), but 18 marker waivers (:1245), no generic trailer locator/name validation, one shape per driver, weak dedicated exceptions. R2-02/03                             |
| 5 — browser HTML integration          | FIXED for accepted oversized HTML | core/protocol-dispatcher.ts:3096–3119; dispatcher-level title/raw-spool assertion at sweep:1459. Five browser branches independently probed; see 21p findings                                                         |
| 6 — manifest substring matcher        | PARTIAL                           | Exact quoted titles/direct skip detection implemented, but comments/string literals/skipped parents/aliases still pass. R2-05                                                                                         |
| 7 — wrong/missing mappings            | PARTIAL                           | Real symbol recall and diagnostic formatter cap now mapped (:143/:121); LSP references now maps to a definition test, generic mappings check only driver existence, diagnostic invocation proves only a fake. R2-06   |
| 8 — Windows-only spool regex          | FIXED as portability issue        | Directory-diff discovery (:927–934) works without drive-letter parsing. However, it no longer proves the result names that file; R2-03                                                                                |
| 9 — global description budget         | FIXED                             | Explicit per-tool dated pins and missing-entry rejection (:1263/:1325). Existing tighter dedicated tests still apply                                                                                                  |

## Coverage table

Independent live probe called actual HTTP tools/list for **all four caller kinds × both IDE flags × both SQLite flags** (16 combinations), and the actual StdioMcpServerService.handleToolsList. HTTP serves **56 with IDE / 53 without IDE**, unaffected in membership by SQLite. Stdio serves eight names. “Swept” below describes the submitted spec's executions, not reviewer-only probes.

| Caller / host                             | Tools served | Tools executed in revised sweep     | Missing                                                                          |
| ----------------------------------------- | ------------ | ----------------------------------- | -------------------------------------------------------------------------------- |
| Anonymous, IDE=true, SQLite=true          | 56           | 53 driver calls + execute_code = 54 | approval_prompt excluded; agent_report moved to agent caller                     |
| Agent, IDE=true, SQLite=true              | 56           | 1: agent_report                     | Other 55 routes not executed under agent context                                 |
| Session, IDE=true, SQLite=true            | 56           | 0                                   | All execution routes; list comparison only                                       |
| Workspace, IDE=true, SQLite=true          | 56           | 0                                   | All execution routes; list comparison only                                       |
| Each caller, IDE=true, SQLite=false       | 56 each      | 0 in this configuration             | Host/caller execution matrix absent                                              |
| Each caller, IDE=false, SQLite=true/false | 53 each      | 0 in these configurations           | Host/caller execution matrix absent                                              |
| CLI stdio                                 | 8            | 2: agent_read, agent_status         | agent_spawn, agent_message, agent_report, agent_stop, agent_list, session_submit |

Shared HTTP names do have drivers; zero means the particular route is untested, not that all those tool names are globally missing. Of the two stdio executions, only agent_read checks a budget; agent_status explicitly requires oversized output. The title claiming six stdio tools is not evidence of six calls.

Catalog evidence: core/protocol-dispatcher.ts:394–485 (IDE adds exactly references/definitions/dirty-files; browser 11, harness 6, agent 7, git 3, json 1, code 10; dashboard and both surface tools always on at :416–420). HTTP flag derivation: mcp-http/http-mcp-server.service.ts:297/:377; VS Code/Electron IDE registration: apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:126 and apps/ptah-electron/src/di/phase-3-storage.ts:189. Stdio actual catalog: stdio/stdio-mcp-server.service.ts:124–140, independent of the HTTP dispatcher. Namespace-disabled subsets are not executed by the new sweep.

## 21p findings

No new production defect demonstrated in the changed 21p path. This conclusion is limited to the integration paths examined, not a fresh approval of every existing HTML extraction behavior.

- **Within budget:** core/protocol-dispatcher.ts:3101–3108 checks the formatted envelope and returns it through the existing response path. Existing test :3268–3279 compares byte-for-byte to formatBrowserContent and checks no spool. Probe: 117 chars/42 tokens, zero spools.
- **Accepted oversized page:** probe reducer is html-extract; raw HTML is handed to the real budget layer with an explicit hint (:3110–3119). tool-result-budget.ts:265 honors that hint; :273 spools its raw input; :275 fits the trailer-inclusive output. Probe: 33,741 chars/5,667 tokens, article marker present, one spool byte-equal to raw HTML.
- **HTML fits alone but envelope does not:** reduceOutput.ts:109–113 returns unreduced; dispatcher:3116–3117 still budgets the formatted envelope. It does not mistakenly return the oversized envelope untouched. Probe: markdown-outline, 315 chars/111 tokens, one formatted-envelope spool.
- **Refusal / over-cap:** probe does not spool; fallback calls the ordinary formatted-envelope budget path. Observed refusal and >2 MiB cases remain under both ceilings, with one spool and markdown-outline rather than a false html-extract label. As explicitly specified by 21p, these spools hold the formatter's capped envelope, not the full raw HTML. That inherited limitation is not represented as raw-HTML preservation.
- **Double extraction:** reduceHtml ignores the budget argument (reducers/html.reducer.ts:100–105), so the narrower second-pass trailer window does not change extraction selection. Accepted input is bounded to 2*1024*1024 UTF-16 code units by reduce-output.ts:120–138 and html.reducer.ts:101. The probe writes no file. Raw token counting occurs before cap rejection (:115), so total request work still scales with raw input size; only extraction is capped. Probe times: accepted 35 ms; fits-alone 5 ms; refused 27 ms; within-budget 1 ms; >cap 96 ms. These are observations, not worst-case timing guarantees.

The existing 21p tests at core/protocol-dispatcher.spec.ts:3209/:3232/:3251/:3268 cover accepted, refusal, fits-alone and unchanged branches. Their accepted case also checks the printed spool path (:3229), which the generic sweep does not.

## New and remaining defects

### R2-01 — Blocking: coverage claims exceed actual executions; stdio failure is locked in

- File: sweep:1003–1090, :1113–1145, :1624–1669.
- Trigger → symptom: add a tool to the actual stdio builder without changing its exported name constant, regress one of five uncalled agent handlers, or regress session/workspace-specific dispatch → this guard stays green.
- Evidence: HTTP matrix only invokes tools/list. Main loop calls listAllTools/buildDeps without matrix overrides. The stdio catalog assertion reads MCP_MVP_TOOL_NAMES rather than the served response. The “agent_spawn/status/message/report/stop/list” test only calls agent_status (:1647–1650). It requires no trailer and output >8,000 (:1664–1665), so adding a correct budget makes that test fail.
- session_submit exemption is false: apps/ptah-cli/src/services/mcp/session-submit.service.ts:595–603 returns aggregated text in MCP content. It has its own aggregation cap, so it needs that contract tested through a fake handler/event source, not a live background session. Excluding it from AgentToolDispatcher only proves another class owns it.
- Impact: six served stdio tools lack an execution sweep, and known unbounded output is treated as an invariant. This meets the explicit all-served-tools Blocking criterion.
- Recommendation: enumerate the actual served catalog per host/caller and dispatch that same list under the same context. Exercise all seven agent handlers, plus session_submit with its documented aggregate contract. Replace the oversized-characterization assertion with the intended ceiling and visible disclosure contract; fix the product route or record it as an unresolved failing requirement, not compliance. Keep any control-tool exception explicit and tested.

### R2-02 — Blocking: 18 waivers remove the required returned-content protection

- File: sweep:122–132, :270 and other expectMarkerInText:false entries, :1245–1249.
- Trigger → symptom: a reducer drops the useful answer entirely → the test passes as long as a hidden spool retains the marker.
- Probe: **18**, not the report's 17, drivers waive preservation; all 18 actually lose the planted marker. Names: count_tokens; agent_spawn/message/report/stop/list; git_worktree_list/add/remove; json_validate; browser_navigate/click/type/network/close/status/record_start/record_stop (all with ptah_ prefix).
- Current handling: the implementation's existing omission behavior is used to waive the acceptance criterion. batches.md:2846 explicitly requires the planted marker in returned text. Spool recovery is an additional requirement, not a substitute.
- Impact: silent answer degradation is expressly permitted by the CI guard. An explanatory comment does not authorize changing Decision 7.
- Recommendation: remove blanket waivers. Use representative supported fixtures with semantic markers that the contract requires retaining, including real headings and error context; where production cannot retain them, report/fix that behavior or obtain an explicit contract decision. Do not reshape fixtures solely to pass. Retain both inline recall and raw-spool assertions.

### R2-03 — Serious: file existence replaces visible recovery and per-shape contracts

- File: sweep:1211–1239, :1193–1196, :1387–1457, :1495–1520, :1559–1561.
- Trigger → symptom: return `[reduced: bogus]` without a locator while still writing a spool → generic assertions pass. Remove browser_evaluate's spool, agent_read's recovery locator, symbol-index continuation, or execute_code's raw-tail preservation → dedicated checks still accept a short result containing the first marker.
- Evidence: generic check only searches for `[reduced: `; directory discovery never links the file to the returned trailer or verifies the reducer name. Dedicated own-windowing tests assert size/first marker only; symbol-index does not verify nextOffset/total or continuation. execute_code checks spool count, not contents/path. Diagnostics checks a marker prefix rather than the whole message and never asserts reducer:none. Each driver still supplies one payload shape, not all supported shapes.
- Impact: the agent can lose access to omitted data while CI finds a file privately and calls recovery valid. Other permitted shapes escape the guard.
- Recommendation: parse the returned locator portably and resolve it to the discovered file; assert allowed/exact reducer identity and preformatted none. Add raw-byte equality and recovery checks to pre-windowed/spooled tools and execute_code, exact diagnostic text, paging continuation, and an explicit per-tool shape matrix. Existing dedicated product specs are useful evidence, but do not make this new sweep universal.

### R2-04 — Serious: screenshot bypasses all text-budget assertions

- File: sweep:1162–1177 (continue precedes :1180–1191).
- Trigger → symptom: restore duplicated base64 in the text caption while retaining the image block → the sweep passes despite the context flood.
- Current handling: merely verifies an image block exists. The comment promises text token/char checks, but control flow skips them.
- Impact: the known screenshot regression targeted by Decision 3 can evade this guard.
- Recommendation: always assert aggregate text tokens/chars before the image-specific exception. Separately assert image data equality and absence of duplicated base64; only waive text spooling when the caption is demonstrably bounded.

### R2-05 — Serious: exact-title regex still accepts non-runnable guards

- File: manifest:190–237 and :261–262.
- Trigger → symptom: put the test inside describe.skip, a multiline block comment without leading stars, a string literal, or bind maybe=it.skip → matcher returns true.
- Probe: all four counterexamples returned true. Examples: `describe.skip('group',()=>{ it('guard',()=>{}); });` (with a newline before it), `/*\nit('guard',()=>{});\n*/`, and a string containing `it('guard',()=>{});`.
- Current handling: line-prefix comment detection and call-opener regex have no syntax-tree or parent/alias context. invokedBy remains an arbitrary substring check and can be satisfied by comments/imports.
- Impact: a mandated test can cease executing without the manifest noticing. The successful direct it.skip break proof covers only one syntax.
- Recommendation: parse actual declarations and ancestors, reject disabled suites and non-code text, resolve supported aliases (including the native-availability convention) and verify actual invocation with required options. Add these four counterexamples and a removed-invocation/leftover-comment break proof.

### R2-06 — Moderate: mappings now certify unrelated or non-product guards

- File: manifest:104–110, :116–118, :126–128, :159–161.
- Trigger → symptom: delete the LSP-reference behavior test or all actual budget tests for workspace/search/memory → mapped driver-existence/definition tests still satisfy the manifest.
- Evidence: the mapped “picks the candidate…” test calls **getDefinition**, not getReferences (apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts:305/:324). A real reference test exists at :232. workspace_analyze/search_files/memory_search map only to the check that a driver object exists (sweep:1060–1072), not the execution contract. Diagnostics invokedBy points at run-diagnostics-provider-contract.self.spec.ts:30, whose provider is a fake at :31–45; checking the word createSecondCheckout does not prove a real host provider is exercised.
- Impact: the named guards do not establish the mandated behavior even when active.
- Recommendation: map references to an actual reference test; generic tools to the executed budget/recall test (support concatenated titles via the parser); map diagnostic contract invocation to the real provider/Batch 19 test and require the actual call with second-checkout support. Keep the corrected symbol-recall and formatter-cap entries.

## Blocking issues

R2-01 and R2-02 above. Coverage and inline-content preservation remain acceptance blockers.

## Serious issues

R2-03, R2-04 and R2-05 above. Recovery, screenshot text bounds and executable-guard detection remain unproven.

## Moderate and minor issues

R2-06 above. The executor report's assertions that all seven stdio handlers are exercised and that there are 17 waivers are inaccurate; actual code/probe evidence is recorded here rather than counted again.

## Five logic questions

1. **Silent failure:** missing returned locator can pass while a spool exists (sweep:1211/:1216); 18 missing inline markers are accepted (:1245).
2. **Unexpected user action:** a stdio call to session_submit or any of five uncalled agent handlers has no sweep, while a fix to agent_status budgeting breaks the characterization (:1664).
3. **Wrong-answer input:** alternate payload shapes and oversized single-block answers can lose meaning under the accepted waivers (:122–132); diagnostic text can change after its marker (:1520).
4. **Dependency failure:** HTTP isError/empty handling is now checked (:1150/:1157); spool/locator failure is not verified for the dedicated exceptions (:1411/:1435/:1537). Manifest can certify disabled code (:199).
5. **Unspecified requirement:** “named guard” needs syntactic execution context and a behaviorally relevant mapping; a literal title/driver object is insufficient (manifest:233; sweep:1070).

## Data flow

1. Host/caller → live catalog: counts and caller-list equality checked; execution matrix missing (sweep:1003/:1113).
2. Driver → API/formatter: identified broken fixtures corrected; live 54-driver probe has no error responses (:1150).
3. Browser page → formatted-envelope budget check → acceptance probe → raw hinted HTML or formatted fallback: bounded output confirmed (dispatcher:3101–3119).
4. Budget → spool → returned text: real code and exact generic raw-spool equality used; returned locator/reducer and 18 inline markers inadequately checked (sweep:1211/:1245).
5. Prompt names → map → title: table/code-span name parser remains valid; exact-title syntax/mapping flaws remain (manifest:45/:199).

## Requirements fulfilment and edge cases

| Requirement / case                                    | Status                                      | Evidence / limit                                                                                           |
| ----------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Every served tool/caller/host                         | PARTIAL                                     | R2-01; actual stdio 8, executed 2                                                                          |
| HTTP success before size                              | COMPLETE for current drivers                | No probe errors; sweep:1150                                                                                |
| Universal token/character checks                      | PARTIAL                                     | R2-04 screenshot exception; stdio only one budget check                                                    |
| Universal shapes/markers/reducers/locators/raw spools | PARTIAL                                     | R2-02/03                                                                                                   |
| 21p accepted/refused/fits-alone/unchanged/overcap     | VERIFIED in examined paths                  | Browser probe and product tests above                                                                      |
| Dated tools/list pin and caller byte stability        | COMPLETE for existing default configuration | sweep:1340–1368; no byte pin for every host                                                                |
| Per-tool description pins                             | COMPLETE                                    | Explicit map; new unpinned name fails                                                                      |
| Mandate parser/new unmapped name                      | COMPLETE for current ptah_* format          | manifest:45–50/:312; table/code spans supported                                                            |
| Runnable/relevant manifest guards                     | PARTIAL                                     | R2-05/06                                                                                                   |
| Exemptions                                            | PARTIAL                                     | web_search external-network exemption is authorized; session_submit rationale is false                     |
| Only named 24r pending test                           | YES in rewritten specs                      | Single it.todo at sweep:1527; no literal skip in sweep                                                     |
| get_dependents reducer:none                           | ACCEPTABLE fallback                         | Still must enforce marker/spool/coverage contract; coverage fixture undefined at :703; 24r remains pending |
| Temp spool hygiene                                    | VERIFIED for reviewed specs/probe           | mkdtemp roots, host injection, afterEach removal (:914–949); no direct os.tmpdir()/.ptah writes            |
| Repeat/concurrent review runs                         | ISOLATED roots                              | No source mutations; per-run probe root also created via mkdtemp                                           |

## Verification

- Scoped ptah_get_diagnostics: **0 errors / 0 warnings**.
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers --skip-nx-cache --parallel=2`: **PASS**, all six targets; 2m23s total, 1m53s critical path. Tailed output, no workspace-wide check.
- `degradation-audit:lint --skip-nx-cache`: **PASS**, TOTAL **300**.
- `ptah-electron:validate-deps --skip-nx-cache`: command completed; displayed tail contains timing/recommendations and no error, including a 53s dependent build. The short tail did not retain the explicit success banner; no rerun was made solely to recover it.
- Independent temporary Jest probe: **1 passed**, 93.821s including cold compilation/concurrent scoped checks. This is not an isolated runtime measurement of the submitted 42 tests. It exercised 16 actual HTTP inventories, actual stdio listing, 54 corrected HTTP drivers, five browser branches and four matcher counterexamples. Results summarized above.
- Author's 42 tests / 41 passed + named todo and three clean runs are reported evidence; this review independently ran both scoped projects, not the isolated pair three more times.
- Break proofs: direct skip/title and dispatcher HTML sabotage now test stronger behavior than r1. They do not establish parent-suite activity, six claimed stdio calls or waived marker survival. Reviewer did not mutate production source.
- Temporary probe files removed after recording their evidence. The review artifact is the only retained reviewer deliverable.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: passing CI still permits unswept served tools and intentional loss of useful returned content.
- What a robust implementation would add: actual catalog-driven execution across callers/hosts/stdio; no unauthorized semantic waivers; complete recovery/page/shape assertions; screenshot text limits; syntax-aware executable guard checks and correct mappings. Keep the 21p integration and corrected HTTP fixtures.
