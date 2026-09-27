# Code Logic Review — TASK_2026_559_8ca9 — r4 post-cap

## Summary

| Metric                                 | Result                |
| -------------------------------------- | --------------------- |
| Overall assessment / score             | NEEDS_REVISION — 6/10 |
| A: Batch 21 post-cap                   | REVISE — 7/10         |
| B: Batch 21q revision 1                | REVISE — 6/10         |
| C: Batch 21r initial review            | REVISE — 4/10         |
| Blocking / serious / moderate findings | 1 / 2 / 0             |
| Failure modes                          | 3                     |

The bounded correction materially improves the CI guard: the original bogus-trailer, extra-text-block, advertised-limit, comment-only invocation, constant-false alias and session-cap-removal probes are now caught. The 20 KB agent-message marker survives on both surfaces. The requested two-project checks pass.

Three anchored defects remain: the manifest accepts an undefined/unreturned required capability; structured-result disclosure can push the final object over budget; and the general sparse-outline rule discards useful structure while still accepting some body-dropping outlines. Batch 21 has reached its post-cap review: its remaining finding goes to the user, not another automatic revise round.

Reviewed current disk contents in `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`, using the three executor reports, current bounded-correction code and archived r3 contracts. No source or submitted spec was edited, and no git operation was run. Temporary probes and a mutated **temporary copy** of session-submit.service.ts were isolated under a mkdtemp directory and removed. Native reads were used because no direct ptah file-read tool was available.

Path shorthand: **core/** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`; **stdio/** = sibling `mcp-stdio/`; **sweep** = core/mcp-contract.sweep.spec.ts; **manifest** = core/mcp-mandate-manifest.spec.ts; **app/** = `apps/ptah-cli/src/services/mcp/`.

## r3 findings status

| Finding                                           | r4 status                                                  | Evidence and regression protection                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-01: enlarged fixtures hid ordinary answer loss | Original cases RESOLVED; new 21r semantic regression below | sweep:835 adds below-cap prose/table drivers and retains above-cap drivers; :2379 runs them. Agent hints are preformatted in core/tool-result-budget.ts:93–105 and pinned by tool-result-budget.spec.ts:139. Replayed 20 KB single-run detail survives HTTP and stdio. The new general fallback has R4-03.                   |
| R3-02: weak universal budget/recovery checks      | Identified probes RESOLVED                                 | sweep:1362 grades aggregate text, independent limits, known reducer, printed locator and raw bytes. Bogus reducer, second oversized block and advertised limit 1 all produce failures. Dedicated page/spool/diagnostic/execute_code cases at :2154, :2239, :2261, :2337 and :2429 now inspect their real recovery contracts. |
| R3-03: partial matrix/session routing-only test   | Identified gaps RESOLVED                                   | All 16 combinations execute via :1894–2008; executed-name comparison at :1873. listAllTools carries requestExtra (:1554). Real app cap test at app/session-submit.service.spec.ts:395 is mapped at manifest:200. Removing the cap in a temporary service copy makes that exact test fail.                                    |
| R3-04: active invocation/constant alias proof     | PARTIAL                                                    | Comment-only invocation and constant-false alias now return false, with self-tests at manifest:631 and :681. An undefined capability or an unused setup object still counts as proof; R4-01.                                                                                                                                 |
| R3-05: unbounded structuredContent                | PARTIAL                                                    | stdio/agent-tool.dispatcher.ts:306 checks and spools the full JSON; normal oversized message/status/list cases are guarded at agent-tool.dispatcher.spec.ts:791. Original 20 KB detail now serializes to 2,283 chars/2,000 tokens in the replay. Final sizing is not guaranteed after disclosure changes; R4-02.             |
| R3-06: absent stdio metadata                      | RESOLVED                                                   | stdio/tool-builders.ts:82 declares the seven agent limits; :170 declares session_submit's separate cap. Exact served-map guard at stdio-mcp-server.service.spec.ts:186 and app's literal cap guard protect the copied values independently.                                                                                  |

These statuses address the specified r3 defects, not a claim that every possible tool payload or JavaScript test declaration has been exhaustively proved.

## A — Batch 21 post-cap

### Matrix and executed-name audit

| IDE   | SQLite | Caller kinds actually executed                  | Served / executed per cell                                                    |
| ----- | ------ | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| true  | true   | anonymous, agent, session, workspace            | 56 / 55                                                                       |
| true  | false  | anonymous, agent, session, workspace            | 56 / 55                                                                       |
| false | true   | anonymous, agent, session, workspace            | 53 / 52                                                                       |
| false | false  | anonymous, agent, session, workspace            | 53 / 52                                                                       |
| stdio | n/a    | real service routing; attributed report fixture | 8 names: 7 agent handlers plus session_submit routing and app-owned cap guard |

The five named passes and eleven table-driven passes form the requested 16 cells; the eleven remaining labels are pinned at sweep:1982. Each HTTP pass lists with the caller identity, adds names when dispatched (:1763), compares the executed set to the served set minus the explicit approval_prompt control exception (:1873), and rejects an empty catalog. execute_code has a driver at :821 and runs in the matrix. Success is checked before the size contract. agent_report still deliberately adds an agent identity to reach its success path; workspace cells still use an unknown root and therefore cover fallback root selection, not accepted-root routing. These are limits of the fixtures, not hidden extra full-identity coverage claims.

### Replayed break probes

| Probe                                                    | Observed r4 result                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 20 KB `agent_message` marker                             | Present in HTTP and stdio output; valid baseline helper result is `[]`             |
| Replace reducer with `bogus` in otherwise valid response | Rejected: unknown reducer and preformatted must be none                            |
| Append 9,000-character second text block                 | Rejected: 11,203 aggregate chars, 10,978 aggregate tokens, malformed final trailer |
| Advertise maxResultSizeChars=1                           | Rejected against independent 8,000-character pin                                   |
| Comment-only shared-contract invocation                  | False                                                                              |
| `false ? it : it.skip` alias                             | False                                                                              |
| Remove session-submit cap in temporary service copy      | Exact submitted cap test fails: expected 1,048,576, received 1,228,838             |

The six stdio fails-before tests retain their success/size/token/marker helper and now add printed-locator/raw-byte and structured-size checks (sweep:2539). mkdtemp roots and the scoped/restored cwd spy remain appropriate fixture isolation (:1202, :2503). Only the named Batch 24r todo remains in this new sweep (:2420).

### R4-01 — Serious — manifest accepts a capability that the contract never receives

- **File:** manifest:408–425 and :446–459; `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts:213–214`.
- **Trigger:** replace the real setup's method with `createSecondCheckout: undefined`, or leave a separate object containing the method in the callback but return only `{ provider }`.
- **Symptom:** hasActiveContractInvocation returns true, while the second-checkout test immediately returns because its optional capability is absent. The mandate guard certifies an unexercised behavior.
- **Evidence:** independent evaluation of the actual AST functions returned true for both `runDiagnosticsProviderContract('real',()=>({provider,createSecondCheckout:undefined}))` and a callback with an unused `{createSecondCheckout(){}}` object followed by `return {provider}`. isOptionProperty accepts any identifier, including undefined; argumentsDeclareOption searches every descendant object rather than the returned setup. The original comment-only and false-alias probes correctly return false.
- **Impact:** this is the remaining execution-proof portion of R3-04. It can silently remove the real second-checkout guard without the manifest noticing.
- **Recommendation for disposition:** record this as an open post-cap finding for the user. A bounded repair would resolve the supported returned setup shape and reject statically absent capabilities, with both counterexamples as negative tests; alternatively a runtime registration proof can make the optional capability mandatory for this mapped invocation. This does not require arbitrary JavaScript reachability analysis.

## B — Batch 21q revision 1

The normal stdio path is substantially improved. toolSuccess passes canonical agent names to the text budget, and budgetStructured independently checks the serialized object, spools its full JSON and returns a valid structured object with recovery information (stdio/agent-tool.dispatcher.ts:274–324). Small structured values remain unchanged. No host-specific assumption that only content is consumed remains in the intended design.

**Copied session-submit constant: not an additional defect in this revision.** The copy at stdio/tool-builders.ts:44 is a maintenance risk, but there is a guard that fails if the app cap changes: app/session-submit.service.spec.ts:395 hard-pins the actual returned length to 1,048,576 through the real service. The served metadata is separately pinned to the same literal at stdio-mcp-server.service.spec.ts:208. The cap-removal probe proves the app guard is meaningful. Changing either production literal alone makes one of the two scoped suites red. A shared port constant is still a reasonable later simplification, not a missing acceptance guard.

The spawn parity adjustment (core/agent-spawn-surface-parity.spec.ts:24–31) is justified: it includes the metadata now stamped by the stdio builder and otherwise compares the same definition. It does not independently dispatch HTTP tools/list, but the sweep separately checks the actual HTTP declaration.

### R4-02 — Serious — final structured JSON can exceed the token/character budget

- **File:** stdio/bounded-structured-content.ts:131–149, especially :145; recovery-only return at :123 and helper at :219. Caller: stdio/agent-tool.dispatcher.ts:321.
- **Trigger:** an early long string consumes all available space; a later long string cannot keep the minimum 32 characters and is removed. The implementation adds its key to omittedFields **after** the successful fit of the earlier field, then returns without rechecking. Separately, an overlarge recovery note is returned unchecked when the skeleton cannot fit.
- **Symptom:** valid JSON is returned, but the stated size guarantee is false under a structuredContent-preferring host.
- **Evidence:** real stdio AgentToolDispatcher.agent_spawn probe used ordinary scalar IDs/status/date, a 20,000-character ptahCliName and a 200-character role. It returned success with **2,340 chars / 2,002 tokens**, despite the 2,000-token limit; `omittedFields:['role']` was appended after fitting the profile-name prefix. This is an adversarial oversized-field case, not a claim that routine timestamps are large. Direct helper probes with two long fields returned 2,004 and 2,002 tokens. A recovery path built from 1,200 `segment/` components returned **9,739 chars / 2,441 tokens**, exceeding both limits.
- **Current handling:** arrays and candidate prefixes are measured, but there is no final fit barrier. recoveryOnly keeps the entire path(s), so removing field lists does not necessarily make the recovery note fit.
- **Recommendation:** reserve omission/cut metadata before filling values, and enforce a final serialized-size invariant after every mutation and on the recovery-only branch. Shorten/relativize recovery locators with an explicit root or provide a bounded honest failure note if necessary. Preserve valid JSON and raw recovery storage. Add a multi-long-field test and a long-locator test; the current single-detail and array tests cannot expose these branches.

## C — Batch 21r initial review

### R4-03 — Blocking — occupancy is not a semantic preservation test

- **File:** core/tool-result-budget.ts:293–300 and :340–351; regression coverage at tool-result-budget.spec.ts:175–258. HTTP web-search formatter accepts summary text at core/mcp-response-formatter.ts:1367–1369.
- **Trigger A:** a short useful outline preserves a late heading/answer after a long introductory paragraph. Because it fills less than half the window, isSparseOutline discards it and sends the raw prefix.
- **Symptom A:** useful information previously visible disappears even though the useful outline fits easily. This violates the requested heading-preservation contract rather than merely changing presentation.
- **Evidence A:** real `handleMCPRequest` for ptah_web_search with a long prose summary followed by `## CRITICAL-LATE-HEADING` and a short answer returned a successful **7,940-character prefix without the heading**. The same captured formatted text through reduceOutput produced a **219-character markdown-outline containing the heading**. An independent shared-layer example produced 80 characters with the heading before selection versus 7,939 characters without it after selection. Both examples fit below the outline input cap.
- **Trigger B:** a long first paragraph containing the answer is followed by enough short sections to fill half the window. The outline drops the answer paragraph but retains enough other material to pass the occupancy threshold.
- **Evidence B:** a document with `MARK-BODY-DROPPED` at the start of its first long paragraph plus 60 short sections returned **markdown-outline, 6,130 chars / 1,516 tokens**, with the body marker missing. The rule therefore neither reliably detects body loss nor reliably preserves meaningful outlines.
- **Impact:** the new global rule can worsen ptah_web_search and other Markdown results while the front-marker fixtures pass. A raw spool remains available, but Decision 7 requires semantic markers inline as well as recoverable raw output. This is a newly introduced silent degradation, not an argument against bounded prefix cuts in general.
- **Recommendation:** base fallback on actual omitted content/structure, not occupancy alone. Preserve the outline's headings/kept semantic content and use remaining space for prefixes of oversized blocks, or narrowly mark truly formatter-owned outputs preformatted. Guard both counterexamples and retain the 13 existing below-cap regression cases. Changing 50% to another percentage cannot distinguish these two failure modes.

### The three changed dispatcher expectations

| Changed expectation                                                 | Review judgment                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1,000-file search_files case, core/protocol-dispatcher.spec.ts:3949 | The old expectation tolerated losing the entire result list. Preserving the notice plus first file rows is a legitimate improvement. The test still checks notice, budget and raw spool (:3985 onward), but does not directly assert a first file row. The global threshold is not established as correct by this case. |
| Refused browser HTML, :3236                                         | Replacing an empty-body outline can be justified, and byte-equal formatted-envelope spooling remains checked. However, the new semantic assertion is explicitly `NAV-NOISE 0` (:3252). That proves a prefix, not useful page content. It cannot justify a general claim that a longer prefix is better than an outline. |
| HTML fits alone / large text, :3258                                 | The new assertion proves a prefix of the large text survives, with unchanged raw spool protection. The old reducer-name expectation was an implementation pin, not inherently a requirement to lose text. This local improvement does not offset the real late-heading regression.                                      |

The accepted html-extract path remains separately guarded and unaffected by the markdown-outline-only predicate. Refusals still use the formatted-envelope spool; these changed tests do not claim preservation of uncapped raw HTML on refusal.

## Five logic questions

1. **How can this fail silently?** A required diagnostics capability can become undefined while the manifest says its guard is active (R4-01). A valid outline's late answer can disappear behind a success response (R4-03).
2. **What user action produces unexpected behavior?** Asking web search for a summary with substantial introductory text and a late answer yields a longer but less informative prefix (R4-03).
3. **What data gives a wrong result instead of an error?** Multiple oversized structured string fields or a very long recovery locator defeat the final size guarantee (R4-02).
4. **What happens when dependencies fail?** Existing spoolToolText returns a path/failure union; the new structured reducer reports that union, but does not prove its note fits (:123). API error behavior is unchanged. Missing optional diagnostics setup still causes an early return in the shared contract, which is why invocation proof matters.
5. **What implicit requirement was missed?** Returning more characters is not evidence of preserving more useful information; and size checks must include disclosure metadata after the final mutation, not just candidate payloads.

## Data flow / requirements / edge cases

| Stage or case                                           | Status                                     | Evidence / remaining limit                                                                     |
| ------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Catalog → 16-cell execution → executed set              | COMPLETE for declared matrix               | sweep:1554, :1763, :1873, :1998; accepted caller-root selection remains outside these fixtures |
| All text blocks → independent budget/declaration        | COMPLETE for replayed regressions          | sweep:1362; bogus/extra-block/1-char probes reject                                             |
| Returned trailer → actual recovery bytes                | COMPLETE for reviewed ordinary spool paths | sweep:1426 onward; prewindowed tools now have dedicated checks                                 |
| session_submit own cap                                  | COMPLETE for tested aggregation path       | app spec:395; cap-removal mutation fails                                                       |
| Agent preformatted text                                 | COMPLETE for 20 KB and above-cap fixtures  | tool-result-budget.spec.ts:155; dispatcher spec:719                                            |
| Structured JSON → host                                  | PARTIAL                                    | Ordinary cases bounded, final disclosure edge cases exceed budget (R4-02)                      |
| Prompt name → active title → active required capability | PARTIAL                                    | Original probes fixed, required-option dataflow still unproved (R4-01)                         |
| Sparse/dense outline semantic recall                    | FAILED                                     | Both counterexamples reproduced (R4-03)                                                        |
| Test hygiene                                            | PASS for reviewed changes/probes           | mkdtemp roots; no source mutation; temporary copies removed                                    |

## Verification

- Ran once: `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools ptah-cli --skip-nx-cache`. **PASS**, both projects and 33 declared dependency tasks; **3m 11s**. No suite rerun or unrelated workspace target. No real-port flake observed.
- Scoped ptah_get_diagnostics was attempted for the structured helper and app spec. It returned **Unavailable: TypeScript check still running after 45s**, not a clean result; it was not retried. The completed Nx typecheck targets provide the verification evidence.
- Temporary replay suite: original r3 positive case passes; all requested response mutations are rejected. Manifest comment-only and constant-false inputs return false. Actual AST helper accepts undefined/unreturned capability counterexamples.
- Temporary cap-removal copy: the exact submitted app cap test fails at its length assertion (1,048,576 expected; 1,228,838 received). Production source was never changed. Other tests in that temporary spec were deliberately filtered out, not newly skipped in the submitted suite.
- Temporary semantic/size probes: four assertions of observed behavior pass, including sparse-outline loss, dense-outline body loss and final structured overshoot. Follow-up real HTTP/stdio integration probe passes assertions reproducing the two product defects. These passing reviewer probes demonstrate defects; they are not product-compliance passes.
- No live external agent, browser or network search was needed. The structured-preferring host path was established in r3; this review measured the exact serialized structured result it would receive.
- Audit and validate-deps were not rerun because this r4 request specified the two-project Nx command. No claims are made about new evidence from those targets.

## Verdict

- **A — Batch 21 post-cap: Recommendation: REVISE; 7/10.** The requested break proofs are now meaningful, and most r3 guard gaps are closed. R4-01 remains. Per the review cap, report it to the user for disposition; do not start another automatic Batch 21 revision round.
- **B — Batch 21q r1: Recommendation: REVISE; 6/10.** Preformatted text, ordinary structured bounding and stdio declarations work, but R4-02 violates the promised final bound.
- **C — Batch 21r: Recommendation: REVISE; 4/10.** The targeted front-marker cases improve, but the general threshold introduces a demonstrated late-heading loss and does not reliably detect answer-body omission.
- **Overall Recommendation: REVISE. Confidence: HIGH.** One blocking and two serious findings, each anchored and independently reproduced.
- Top risk: an apparently successful reduction replaces a useful outline with a larger prefix that drops the answer; passing front-marker tests conceal that regression.
