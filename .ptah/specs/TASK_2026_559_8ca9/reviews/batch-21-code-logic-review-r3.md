# Code Logic Review — TASK_2026_559_8ca9 — r3

## Summary

| Metric          | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Overall score   | 5/10                                                         |
| Assessment      | NEEDS_REVISION                                               |
| Blocking issues | 2                                                            |
| Serious issues  | 3                                                            |
| Moderate issues | 1                                                            |
| Failure modes   | 6                                                            |
| Batch 21        | REVISE — 5/10                                                |
| Batch 21p       | APPROVE — 8/10, limited to the requested interaction recheck |
| Batch 21q       | REVISE — 5/10                                                |

Reviewed the files on disk on 2026-09-27. Source and submitted specs were not edited. No git state was changed. Native reads were used because no direct ptah file-reading tool was available; scoped diagnostics used ptah_get_diagnostics. The named generic task-description/implementation-plan/code-style-review files were not present in this task folder; batches.md, context.md, executor reports and archived r2 supplied the contracts.

The six stdio success paths now pass the text-size tests, and the scoped Nx checks pass. That distinguishes this revision from r2. Approval is still prevented by an independently reproduced loss of returned detail, incomplete recovery assertions, incomplete all-served-tool contracts, and an actual external host consuming the unbounded structured result. These are behavioral gaps, not formatting objections.

Path shorthand below: **sweep** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts`; **manifest** = sibling `mcp-mandate-manifest.spec.ts`; **core/** = that directory; **stdio/** = sibling `mcp-stdio/`. Line anchors refer to the current files, not archived revisions.

## r2 findings status

| r2 finding                                 | Status                                                                 | On-disk evidence and regression protection                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-01: execution/catalog coverage          | PARTIAL / OPEN                                                         | Five HTTP execution passes now exist (sweep:1253, :1267, :1281, :1295, :1303); real stdio catalog is pinned (:1660); all seven agent handlers execute (:1678–1854). The six previously unbudgeted text paths now use stdio/agent-tool.dispatcher.ts:276. However, session_submit only returns an already-small fake response (:1857), and the full host/caller matrix is not executed. R3-03.                                           |
| R2-02: marker waivers                      | OPEN                                                                   | The waiver field is gone and :1243 asserts the marker. But drivers deliberately exceed the Markdown reducer's 262,144-character cap (:378–386, :422, :533). A 20 KB detail still loses its marker in a live probe. This changes the exercised path rather than fixing the failed contract. R3-01.                                                                                                                                       |
| R2-03: recovery/shape/diagnostic contracts | OPEN                                                                   | Generic check remains only `includes('[reduced: ')` (:1209); private spool discovery is not tied to the printed locator (:1214). Dedicated exceptions remain weak (:1441, :1465, :1489, :1549, :1591). Stdio helper checks only size/tokens/marker (:1716). The executor explicitly records that locator/name verification was not attempted. R3-02.                                                                                    |
| R2-04: screenshot text checks              | RESOLVED for the identified early-continue defect                      | Size/token checks now precede the screenshot branch (:1156, :1169); image data equality is checked (:1183). Restoring duplicated base64 in the existing caption would fail. Additional text blocks remain a universal-helper weakness covered in R3-02.                                                                                                                                                                                 |
| R2-05: active test detection               | PARTIAL / OPEN                                                         | AST walk rejects the four original comment/string/skipped-parent/unconditional-alias examples; self-tests at manifest:410 onward cover them. The shared-contract invocation check remains substring-only (:351), and an always-disabled conditional alias is accepted (:224). Independent probes confirm both. R3-04.                                                                                                                   |
| R2-06: incorrect mappings                  | Mapping corrections RESOLVED; execution proof remains OPEN under R2-05 | References now maps to a real getReferences test (manifest:134; electron-ide-capabilities.spec.ts:232). Workspace/search/memory map to the executing sweep title (manifest:104, :108, :171). Diagnostics maps to the real provider spec (:123), which calls the contract at type-script-diagnostics-provider.spec.ts:150 with createSecondCheckout at :154. Deleting the invocation while retaining its name in a comment still passes. |

The unchanged stdio assertion _strength_ is visible at sweep:1716–1723: success, <=8,000 chars, <=2,000 tokens, marker. The six callers still invoke this helper, including the attributed report case (:1788–1813). Their present assertions have not been relaxed into oversized-output characterization. Exact historical byte equality cannot independently be certified from the executor's fails-before notes alone; no previous uncommitted source snapshot was supplied. The current tests and the reported six before-fix length failures are consistent.

## Coverage table

Independent live probe invoked HTTP tools/list for all four caller kinds × both IDE settings × both SQLite settings, and StdioMcpServerService.handleToolsList. Counts remain **56 IDE / 53 non-IDE / 8 stdio**. SQLite changes no catalog membership. The context header's 53 describes the non-IDE set, not the complete IDE surface.

| Host/caller                                          |  Served | Current submitted executions                           | Remaining gap                                                                                                                                       |
| ---------------------------------------------------- | ------: | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP IDE + SQLite, anonymous                         |      56 | 54 driver calls, plus one standalone execute_code test | approval_prompt explicitly excluded as control/UI; agent_report driver adds agent identity                                                          |
| HTTP IDE + SQLite, agent                             |      56 | 54 driver calls                                        | execute_code not executed under this identity; approval control exception                                                                           |
| HTTP IDE + SQLite, session                           |      56 | 54 driver calls                                        | Same; report adds agent identity                                                                                                                    |
| HTTP IDE + SQLite, workspace                         |      56 | 54 driver calls                                        | Workspace supplied is deliberately unknown, so it exercises fallback rather than accepted caller-root routing (:1288); execute_code standalone only |
| HTTP non-IDE + SQLite, anonymous                     |      53 | 51 driver calls                                        | execute_code standalone IDE test only; report identity override                                                                                     |
| HTTP non-IDE + SQLite, agent/session/workspace       | 53 each | Catalog checks only                                    | No corresponding execution pass                                                                                                                     |
| HTTP SQLite=false, both IDE settings and all callers | 56 / 53 | No submitted execution pass                            | Reviewer catalog probe is not a CI execution guard                                                                                                  |
| Stdio                                                |       8 | 7 agent calls + 1 session_submit routing stub          | session_submit has no oversized/page-cap contract; six agent calls lack recovery checks                                                             |

IDE-only delta: ptah_lsp_references, ptah_lsp_definitions, ptah_get_dirty_files (core/protocol-dispatcher.ts:421). Browser/harness are included in the default catalog and have drivers; dashboard/surface are always registered (:416). No globally missing HTTP text-tool name was found. Namespace-disabled subsets/stdio allow-tools filters are not exercised by the new sweep. The remaining coverage finding is about required execution contracts, not a claim that those shared names have no driver.

## Numbered findings / failure modes

### R3-01 — Blocking — fixtures bypass the reducer that loses the answer (21); the same loss now reaches stdio (21q)

- **File:** sweep:329 (agent_message detail), :378–386 (explicit cap-bypass rationale), :1243; stdio/agent-tool.dispatcher.ts:276 and :508.
- **Trigger → symptom:** return a valid agent_message result with `detail = 'MARK-small-' + 'e'.repeat(20000)`. The real stdio dispatcher returns a 312-character success with `(1 lines omitted)`, a markdown-outline trailer and **no marker/detail**. The submitted 280,000-character fixture survives because markdown.reducer.ts:91 refuses to outline inputs above MAX_OUTLINE_CHARS (:35), leaving a prefix cut.
- **Evidence:** reviewer probe executed the real AgentToolDispatcher with a mkdtemp spool root; marker=false, text chars=312, structured JSON chars=20,053. The executor's round-2 notes explicitly say the fixtures were raised above this threshold to preserve markers. This is the exact r2 warning against reshaping fixtures solely to pass.
- **Impact:** CI passes while ordinary oversized answers lose the substantive message. On content-consuming hosts this is newly exposed by 21q's application of the reducer to formerly intact stdio output. The recovery file is additional protection, not fulfillment of the inline-preservation requirement (batches.md:2912).
- **Recommendation:** keep both below-cap and above-cap oversized fixtures, including real formatted paragraphs/tables and semantic markers. Make the below-cap regression red, then fix the relevant formatting/reduction policy so useful detail survives. For already-curated agent replies, explicitly consider preformatted/cut behavior rather than treating every leading Markdown heading as permission to discard its body. Do not satisfy this correction by enlarging fixtures again.

### R3-02 — Serious — the universal assertions still cannot prove visible recovery or the declared budget

- **File:** sweep:874, :1156, :1209, :1214, :1425, :1441, :1549, :1613, :1716.
- **Trigger → symptom:** change a generic trailer to `[reduced: bogus]` while still writing the spool. The sweep accepts it because it finds the file privately and never verifies the name/path returned to the caller. Remove execute_code's raw tail, browser_evaluate's spool, agent_read's locator or symbol-index continuation and their dedicated cases still accept a bounded prefix containing the first marker.
- **Additional concrete holes:** textOf uses the first text block (:878), so adding a second oversized text block escapes the ceiling. Budget checks use getToolResultBudget (:1156), while the advertised metadata check only checks `typeof number` (:1432): declaring 1 character without changing the 8,000-character implementation would pass. Diagnostics checks only marker/file/heading (:1572), not the complete planted message or reducer:none. Six stdio tests never require a trailer or byte-equal spool (:1716–1723).
- **Impact:** results can be advertised as bounded/recoverable while the model receives excess text or no usable route to omitted data. One payload per driver also leaves supported alternate shapes outside Decision 7's guard.
- **Recommendation:** one reusable contract should aggregate all text blocks, compare actual advertised limits to independent pins, parse/validate the reducer and returned locator, open that locator and compare the captured raw bytes. Apply dedicated page/continuation or raw-spool assertions to exceptions; assert diagnostics' full kept message and none reducer; supply an explicit supported-shape matrix. The existing 21p accepted-page test at core/protocol-dispatcher.spec.ts:3225 demonstrates an actual locator check.

### R3-03 — Blocking — session_submit is called but never swept against its result contract; matrix remains partial

- **File:** sweep:1857–1888, :1101, :1253–1308; apps/ptah-cli/src/services/mcp/session-submit.service.ts:61, :438, :595.
- **Trigger → symptom:** remove the real session_submit aggregation cap or its truncation disclosure. Batch 21 stays green: it injects its own 1 KB result and asserts object identity/forwarded arguments. This is not an oversized result or documented-cap test.
- **Current handling:** the app implementation does own the cap, and the lib must not import the app. That boundary justifies locating a real service/event-source guard in the app and referencing it; it does not justify certifying this served tool from a routing-only stub. No aggregation-cap assertion was found in session-submit.service.spec.ts by targeted inspection.
- **Matrix gap:** sweepAllTools lists without requestExtra (:1101/listAllTools:939), then calls with it; only five host/caller combinations run, all with SQLite=true. Known caller sets are separately pinned today, but a future caller-specific registration or dispatch change is not universally exercised.
- **Recommendation:** add/reference a real oversized session-submit guard in its owning app, using a fake event source and its documented cap/disclosure. Execute the actual list under the same caller/host configuration as calls, with explicit control-tool exceptions and an executed-name assertion. Cover the missing combinations or prove equivalent routing with a precise regression guard. No need to launch real agents.

### R3-04 — Serious — a mandated shared guard can stop running while the AST manifest stays green

- **File:** manifest:224–231, :344–351; libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts:213–214.
- **Trigger → symptom:** comment out the real provider's runDiagnosticsProviderContract call, leaving `// createSecondCheckout`, or remove its createSecondCheckout option while retaining a comment. `checkGuard` returns no problems. The contract declaration still exists, and its second-checkout case silently returns when the option is absent.
- **Evidence:** a native probe evaluated the actual matcher/checkGuard functions: comment-only invocation produced `[]`; `const maybe=false?it:it.skip; maybe('guard',()=>{});` was also accepted; a describe.skip parent was correctly rejected.
- **Impact:** this remaining portion of R2-05/R2-06 can silently disable the required real-provider regression. The four new matcher self-tests are useful but do not prove invocation.
- **Recommendation:** inspect the real invocation AST, including required second-checkout setup, and reject disabled enclosing context/comment-only proof. Add the removed-invocation/leftover-comment regression. Resolve the explicitly supported alias pattern without treating a literal false condition as an active branch. This is a bounded syntactic check, not a request to solve arbitrary JavaScript reachability.

### R3-05 — Serious — unbounded structuredContent bypasses 21q on an actual MCP host

- **File:** stdio/agent-tool.dispatcher.ts:288, :428, :508, :651; apps/ptah-cli/src/cli/commands/mcp-serve.ts:370.
- **Trigger → symptom:** the 20 KB message result in R3-01 has bounded content but its full detail in structuredContent (20,053 JSON characters). Large status/list arrays are likewise retained. mcp-serve returns resp.result unchanged; there is no outgoing client/transport sanitization that removes this field.
- **Real-host evidence:** Microsoft's current `mcpLanguageModelToolContribution.ts:333` skips textual content when structuredContent exists, and :389–391 serializes structuredContent into assistant-facing text. Consequently VS Code's MCP host receives the unbounded value instead of the reduced text and its spool notice. Verified against the primary source on 2026-09-27: [VS Code MCP model-result conversion](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpLanguageModelToolContribution.ts#L333). The [maintainer-filed issue #290063](https://github.com/microsoft/vscode/issues/290063) also documents this behavior.
- **Classification:** a real interoperability/budget defect, not merely speculative transport overhead. This does **not** claim Claude Code consumes structuredContent; its content-oriented path benefits from 21q's text ceiling. The local Ptah code is a stdio server, not a host-side consumer, and does not constrain external hosts to Claude Code.
- **Recommendation:** define a bounded structured success representation, preserving machine-readable identifiers and visible truncation/recovery information, or explicitly omit structuredContent on oversized responses if compatibility permits. Preserve the full raw value in recovery storage. Test a consumer that prefers structuredContent as well as one that reads content. Do not simply truncate serialized JSON into invalid structured data.

### R3-06 — Moderate — stdio enforces an internal limit without advertising it

- **File:** stdio/tool-builders.ts:49–57, :143; stdio/stdio-mcp-server.service.ts:124–140; sweep:1425, :1660.
- **Trigger → symptom:** a host enumerates stdio tools and attempts to honor their declared result sizes. All eight tools have no `_meta['anthropic/maxResultSizeChars']`, confirmed by the live catalog probe, while the seven agent tools now enforce the canonical 8,000-character limit.
- **Classification:** contract/observability gap under batches.md:2909, not the reason server-side text bounds fail and not a violation of mandatory MCP protocol syntax. This omission predates 21q, but it remains open in the combined all-surface budget work. The HTTP-only metadata assertion does not guard it.
- **Recommendation:** advertise the seven agent budgets using the canonical-name mapping and verify exact values against actual served stdio definitions. For session_submit, publish its own deliberately documented cap rather than falsely assigning the agent limit. Pin this catalog's descriptions/size as appropriate to the all-served-tool contract.

## 21p interaction findings

No additional defect found in the requested 21q interaction check. 21q calls applyToolResultBudget with `ptah_agent_*` names and no hint (stdio/agent-tool.dispatcher.ts:276–282); it does not invoke the browser path or alter hint precedence. In core/tool-result-budget.ts:265 the optional HTML hint still wins over per-tool hints. core/protocol-dispatcher.ts:3101–3119 still checks the formatted envelope, probes raw HTML without spooling, then either budgets the formatted fallback or passes accepted raw HTML with the hint.

The existing accepted-page test checks title/paragraph, actual printed locator and raw HTML equality (core/protocol-dispatcher.spec.ts:3209–3229); refusal, HTML-fits-alone and unchanged-page tests remain at :3232, :3251 and :3268. They ran in the passing scoped test target. Extraction remains bounded as recorded in r2; no new extraction/cap logic was introduced by 21q. This is an interaction approval, not a fresh claim about all pre-existing reducer edge cases.

## Five logic questions

1. **How does this fail silently?** The 20 KB detail is omitted from a success while the enlarged fixture passes (R3-01); a disabled shared guard is accepted from a comment (R3-04).
2. **What user action produces unexpected behavior?** Calling stdio tools from a host that prefers structuredContent bypasses the text budget and recovery notice (R3-05).
3. **What input produces a wrong answer?** Below-outline-cap oversized paragraphs/tables can lose the substantive content; extra text blocks escape the sweep's ceiling (R3-01/02).
4. **What happens when a dependency fails?** Existing API rejection/error results remain explicit and unbudgeted (stdio/agent-tool.dispatcher.spec.ts:627 onward). Shared spool failure handling reports failure through the trailer (core/tool-result-budget.ts:414). The sweep does not validate that recovery contract across all paths (R3-02).
5. **What is missing from implicit requirements?** The consumed result representation must be bounded, not just one field; a named shared test must actually be invoked with the required capability (R3-04/05).

## Data flow and requirements

| Stage / requirement                               | Status                                   | Evidence / gap                                                                                 |
| ------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Live catalog → driver set                         | PARTIAL                                  | Counts pinned; missing execution combinations and routing-only session_submit (R3-03)          |
| API → explicit successful result                  | COMPLETE for supplied agent/HTTP drivers | sweep:1138; stdio helper:1718; report attributed at :1803                                      |
| Formatter → budget → spool                        | PARTIAL                                  | 21q correctly calls shared layer, but ordinary detail can be lost (R3-01)                      |
| Budget → host-visible result                      | PARTIAL                                  | First-block-only verification; structured bypass (R3-02/05)                                    |
| Returned recovery reference → original raw output | PARTIAL                                  | Generic raw-file comparison exists, printed-reference check missing (R3-02)                    |
| Prompt names → relevant runnable guards           | PARTIAL                                  | Corrected mappings; invocation and alias loopholes (R3-04)                                     |
| Within-budget stdio compatibility                 | PASS for supplied small success          | stdio/agent-tool.dispatcher.spec.ts:611; text byte-equality and no spool                       |
| Screenshot caption + image                        | PASS for supplied one-caption shape      | sweep:1156, :1183                                                                              |
| Description and tools/list pins                   | HTTP default covered                     | Dated +5% pin at sweep:1414; stdio declarations absent (R3-06)                                 |
| Pending tests                                     | Expected one in the new sweep            | Named Batch 24r todo at sweep:1581; no new skip exemption introduced                           |
| Fixture hygiene                                   | PASS for reviewed changes                | mkdtemp roots at sweep:895 and agent-tool.dispatcher.spec.ts:540; cwd spy :1634 restored :1637 |

`get_dependents` reducer:none remains acceptable for this plain/preformatted shaped answer; there is no requirement to invent a semantic reducer. It does not discharge the separately named pending coverage/status-preservation test (sweep:1581).

The process.cwd redirect is legitimate fixture isolation: it supplies the same root the production constructor normally resolves, while keeping the actual budget/spool implementation and all six text assertions active. It does not cause R3-01 or R3-05, and removing it would risk repository .ptah writes. It does not test a deleted/inaccessible process cwd; that remains unverified rather than a newly counted finding.

## Verification

- Ran once: `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`. **All three targets passed**, Nx run duration **37.1 seconds**; one completion check, no suite rerun. No real-port flake occurred in this run.
- ptah_get_diagnostics scoped to the reviewed dispatcher/sweep paths: **0 errors, 0 warnings**, typescript-compiler.
- Independent temporary Jest probe: **1 passed**, 27.613 seconds including module startup. It enumerated the 16 HTTP configurations plus real stdio catalog, and asserted the observed smaller-payload marker loss and structured size bypass. A passing reviewer probe here proves the defect, not product compliance.
- Independent native manifest probe: skipped parent rejected; comment-only invocation accepted; constant-false alias accepted. No source mutation was needed.
- Hand-checked corrected LSP-reference, real diagnostics-provider invocation and symbol-recall locations. Exemption remains only external-network web search; that matches batches.md:2920.
- Did not rerun audit/validate-deps or other projects: r3 requested the scoped Nx command. No destructive git commands, source edits or live external agent launches. Temporary probe files were removed after recording their evidence.

## Bounded correction

Batch 21 has exhausted its two revise rounds. The one correction should close the existing acceptance holes, not start an unrelated refactor: restore meaningful below-cap shape tests; finish universal budget/reducer/locator/raw/page assertions; add a real session-submit cap guard in its owning project and complete the declared execution matrix; prove actual shared-contract invocation. For 21q, fix the newly exercised detail loss and bound the host-consumed structured representation, with explicit stdio metadata. Retain the six current size/marker tests as fails-before guards.

## Verdict

- **Batch 21 — Recommendation: REVISE. Score: 5/10.** R2-02/03 remain open; R2-01/05 are only partially resolved. R2-04 and the mapping corrections are substantiated.
- **Batch 21p — Recommendation: APPROVE. Score: 8/10.** No new interaction defect established; existing accepted/fallback/unchanged guards pass.
- **Batch 21q — Recommendation: REVISE. Score: 5/10.** The six text ceilings now work, but ordinary detail is lost and an actual host can consume the unbounded structured values.
- **Overall Recommendation: REVISE. Confidence: HIGH** for the reproduced and anchored findings; external-host evidence is the cited source, not a locally launched host.
- Top risk: green CI still permits silent loss of useful output, while host-dependent result consumption defeats the advertised purpose of the stdio budget fix.
