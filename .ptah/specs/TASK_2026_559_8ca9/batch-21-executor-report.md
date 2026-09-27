# Batch 21 Executor Report — TASK_2026_559_8ca9

Lane A, senior-tester. Files added (both new, nothing else touched):

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts` (Task 21.1)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-mandate-manifest.spec.ts` (Task 21.2)

## Task 21.1 — dispatcher contract sweep

**Method.** The tool universe comes from a live `tools/list` call (`hasIDECapabilities: true`,
`hasSqliteLayer: true`) — no hard-coded tool array. A `TOOL_DRIVERS` map supplies, per tool, valid
`tools/call` arguments and a fake `PtahAPI` mock returning an oversized payload; a tool present in
`tools/list` with no driver fails the run with a named message (`No oversized-payload driver
registered for "<name>"...`), which is how a newly added tool gets caught. 43 tools were exercised
(every tool `tools/list` returns except `execute_code` and `approval_prompt`, which return no bounded
text result). Most namespace calls (`ptah_ast_analyze`, `context_enrich_file`, `get_dependents`,
`get_dependencies`, `code_search_symbols`, `memory_search`, `relevance_rank_files`,
`project_detect_monorepo`, `task_*`, harness/dashboard/surface tools) go straight through
`JSON.stringify` in the dispatcher, so any large object clears the budget check regardless of exact
field names. `mcp-response-formatter.ts` formatters (workspace_analyze, search_files, diagnostics,
lsp_references/definitions, dirty_files, agent__, web_search, worktree__, json_validate, browser_*)
got real field names, read from the formatter source. Four tools (`browser_click/type/close/record_start`)
emit a fixed-size success line regardless of input; their only variable-length field is `error`, so
that is what is forced oversized — the sole way the budget layer is exercised for them at all.

**Failures the sweep found in production (during development, all fixed by fixing the TEST, not
production — see "no production-code changes" below):** none. Every production assertion in the
final suite passes against unmodified source. The three iterations below were test-fixture
corrections, not code findings:

- `ptah_dashboard_propose_spec`, `ptah_surface_update`, `ptah_surface_get_state` were missing
  drivers initially (43 tools, not the ~40 I estimated from reading); added.
- The tools/list size pin was a placeholder guess (24,000); the real measured value is
  **125,374 bytes** at this HEAD (2026-09-27), pinned with +5% headroom (≤131,643).
- The description-budget pin was a placeholder guess (1,000, copied from
  `tool-description.builder.spec.ts`'s LOCAL constant for two specific tools); the real longest
  description in the full set is `ptah_surface_update` at **4,496 chars**. Repinned at 5,000 with
  a comment explaining it is a regression pin, not a documented contract (none exists).

**A real, notable finding (documented, not "fixed"):** `ptah_get_dependents`/`get_dependencies`
JSON.stringify a flat array of path strings — already maximally compact — so `reduceJson` correctly
refuses it (nothing to drop, nothing to tabulate) and the pipeline falls back to `reducer: 'none'` +
a plain cut. This is correct, existing behaviour, not a defect; the "JSON shape" reducer-naming test
was pointed at `ptah_context_enrich_file` instead (its payload is an array of uniform objects, which
`reduceJson` does tabulate).

**A second finding:** `ptah_browser_content`'s formatted text always opens with a Markdown heading
(`## Page Content`) ahead of its HTML code block. `detectContentKind`'s HTML sniffer requires the
document to literally start with `<` (or `<!doctype html`), so this tool's dispatcher-level result is
always classified `markdown`, never `html` — verified live in the main sweep loop (it gets
`markdown-outline`). This is architecturally consistent (a real per-tool HTML-kind path does not
exist through this dispatcher today), so the "HTML shape" case exercises `reduceOutput` directly with
`hint: 'html'` on the tool's raw captured page content — real production reducer code, just not
routed through `handleMCPRequest` for this specific tool, and the report says so rather than papering
over it.

**Pinned sizes (2026-09-27, this HEAD):**

- `tools/list` JSON: 125,374 bytes, allowance ≤ 131,643 (5%).
- Longest tool description: 4,496 chars (`ptah_surface_update`), allowance < 5,000.
- Both are byte-identical across all 4 caller kinds (anonymous/agent/session/workspace) — asserted.

**Coverage vs. Decision 7 extension.** Per-tool budget compliance: all 43. Shape-specific
reducer/spool/marker assertions: one representative per shape actually reachable through this
dispatcher — JSON (`context_enrich_file`), Markdown (`workspace_analyze`, spool byte-equal to a
directly-recomputed `formatWorkspaceAnalysis` call), HTML (direct `reduceOutput` call, see above).
No dispatcher-formatted tool result sniffs as `log` (every formatter's raw text opens with a Markdown
heading or valid JSON), so no log-shape case is claimed; noted here rather than asserted falsely.
`ptah_get_diagnostics` (`preformatted`, no content reducer) is asserted to keep its requested-file
entries verbatim. One pending test, matching the existing naming convention from
`mcp-contract.bench.spec.ts:416`: `it.todo('pending Batch 24r: ptah_get_dependents coverage/status
block survives the budget intact and first')` — `preserveKeys` support lands in Batch 24r (Lane H,
not yet merged here).

## Task 21.2 — mandate manifest

Parses tool names out of the real `PTAH_MCP_SUBSTITUTION_SECTION` export (16 tools found; the
constant itself is never edited). `MANDATE_MAP`:

| Tool                         | Guard file                                               | Test title / exemption                                                                         |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ptah_workspace_analyze       | mcp-contract.sweep.spec.ts                               | "Markdown shape: ptah_workspace_analyze names its reducer"                                     |
| ptah_search_files            | mcp-contract.sweep.spec.ts                               | "every tool in tools/list stays within its declared budget"                                    |
| ptah_get_diagnostics         | platform-core/.../run-diagnostics-provider-contract.ts   | "a file in a second checkout gets the same diagnostics..."                                     |
| ptah_lsp_references          | apps/ptah-electron/.../electron-ide-capabilities.spec.ts | "lsp.getReferences" (real host spec found — not exempted)                                      |
| ptah_lsp_definitions         | electron-ide-capabilities.spec.ts                        | "finds an imported class through the import when the index returns no hits"                    |
| ptah_get_dirty_files         | electron-ide-capabilities.spec.ts                        | "getDirtyFiles returns [] (not tracked in main process)" (real host spec found — not exempted) |
| ptah_count_tokens            | workspace-intelligence/.../mcp-contract.bench.spec.ts    | "ptah_count_tokens"                                                                            |
| ptah_web_search              | —                                                        | exempt: "external network"                                                                     |
| ptah_code_search_symbols     | memory-curator/.../code-symbol.store.spec.ts             | "an identifier query prepares a workspace-scoped exact symbol_name lookup"                     |
| ptah_ast_analyze             | mcp-contract.bench.spec.ts                               | "ptah_ast_analyze"                                                                             |
| ptah_context_enrich_file     | mcp-contract.bench.spec.ts                               | "ptah_context_enrich_file"                                                                     |
| ptah_get_dependents          | mcp-contract.bench.spec.ts                               | "ptah_get_dependents"                                                                          |
| ptah_memory_search           | mcp-contract.sweep.spec.ts                               | "every tool in tools/list stays within its declared budget"                                    |
| ptah_relevance_rank_files    | mcp-contract.bench.spec.ts                               | "ptah_relevance_rank_files"                                                                    |
| ptah_project_detect_monorepo | mcp-contract.bench.spec.ts                               | "ptah_project_detect_monorepo"                                                                 |
| ptah_get_symbol_index        | mcp-contract.bench.spec.ts                               | "ptah_get_symbol_index"                                                                        |

Checked (per batches.md's "unless a host spec covers them" instruction) whether
`ptah_get_dirty_files`/`ptah_lsp_references` had a real host spec instead of a bare exemption: both
do (`electron-ide-capabilities.spec.ts`), so both map to guards, not exemptions. Only
`ptah_web_search` is exempt.

## Break proofs (all reverted; `git diff --stat` clean on both files afterward)

1. **Missing budget** — temporarily added `|| tool.name === 'ptah_search_files'` to
   `declareResultBudgets`'s `continue` guard in `protocol-dispatcher.ts` (skipping `_meta` stamping).
   Result: `declares a maxResultSizeChars budget on every tool` failed
   (`Expected: "number", Received: "undefined"`). Reverted; file diff empty.
2. **Missing manifest guard** — temporarily pointed `ptah_lsp_definitions`'s title at a string that
   exists nowhere. Result: the corresponding `it.each` case failed
   (`fileHasTitle(...)` returned `false`). Reverted; file diff empty.
3. **Broken marker preservation** — temporarily inserted
   `text = text.replace(/MARK-[A-Za-z-]+/g, '');` after `render()` in `html.reducer.ts`. Result: the
   HTML-shape test failed (`Expected substring: "MARK-html-shape"`, not found). Reverted; file diff
   empty.

## Test hygiene

Both `beforeEach`/`afterEach` in `mcp-contract.sweep.spec.ts` create and remove a fresh
`fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-mcp-sweep-'))` directory, injected as the only
`workspaceProvider.getWorkspaceFolders()` entry so every spool write lands under it, never under
`os.tmpdir()/.ptah` directly and never the repo's own `.ptah`. No network calls anywhere in either
file (`ptah_web_search`, `ptah_browser_navigate` etc. are driven through the fake API, never a real
provider). Runtime, both files together: ~19s (well under the 60s budget); the sweep's main
table-driven test needed a 30s Jest timeout (real tokenizer + fs work across 43 tools) — noted rather
than hidden.

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`, run 3
  times (per instruction):
  - Run 1 (`-t=test` alone first, before the combined run): `2016 total, 2015 passed, 1 todo` — clean.
  - Run 2 (`-t=test` alone): Nx flagged the task "flaky" (an internal retry occurred, plausibly
    resource contention from other concurrent agent sessions on this machine — `protocol-dispatcher.spec.ts`,
    a file this batch never touched, was implicated); final result after Nx's own retry: all green.
  - Run 3 (combined `test,lint,typecheck`): all three targets green in one pass, no retry,
    `43.4s` critical path.
  - Isolated `jest mcp-contract.sweep.spec.ts mcp-mandate-manifest.spec.ts` (run separately to
    confirm the two new files specifically, not just the aggregate): `28 total, 27 passed, 1 todo`,
    `~19s`.
- `ptah-electron:validate-deps` → "✅ All external imports are covered by package.json dependencies."
- `degradation-audit:lint` → `TOTAL 300` (unchanged baseline).
- `git status --short` → only the two new spec files added by this batch; one pre-existing modified
  file (`TASK_2026_561_9e57/context.md`) and two pre-existing untracked files
  (`TASK_2026_559_8ca9/code-logic-review.md`, `research/diagnostics-worktree-repro.ts`) belong to
  other concurrent work in this shared worktree, not this batch — confirmed via `git diff` that
  `context.md`'s only change is an unrelated TASK_2026_408/561 note.
- No `TODO`/`FIXME`/`PLACEHOLDER`/`STUB`, no `as any`/`@ts-ignore`, no `from "<word>"` string literal
  in either new file (grepped). Prettier run on both files only.

## Not done / deliberately scoped out

- Not every tool got a full four-shape (JSON/log/Markdown/HTML) matrix — only the shapes that
  dispatcher (`tools/call`)-formatted text actually produces were exercised per representative tool,
  per the findings above; every tool still gets the budget-compliance assertion in the main sweep.
- The pending coverage-preservation test for `ptah_get_dependents` stays `it.todo` until Batch 24r's
  `preserveKeys` lands (Lane H), matching the project's existing convention for this exact situation.

## Revision round 1 (r1 REVISE 3/10)

Both spec files rewritten against `reviews/batch-21-code-logic-review-r1.md` (9 defects: 3 Blocking, 3
Serious, 3 Moderate). No production file was edited; `ptah_browser_content` was fixed in parallel by
Batch 21p (author's own note: dispatcher now hints `'html'` at the raw page HTML over budget via
`createBrowserContentResponse`), which this revision's dispatcher-level test now exercises and asserts
against (it was written to pass once 21p landed, and does).

**Coverage (defects 1, "43-tool" miscount).** The live driver count was actually 54 (the "43" in the
first report was a mis-tally, not a coverage gap — every served HTTP name already had a driver).
Added: a coverage-matrix describe block asserting HTTP-with-IDE serves 56 tools and HTTP-without-IDE
serves 53, identically across all 4 caller kinds, with the 3-tool IDE-only delta pinned by name; a
check that every name served in either configuration has a driver; a dedicated `execute_code` test
(it IS budgeted — `protocol-dispatcher.ts:3257-3287` — confirmed and pinned); a new `describe` for the
stdio MCP server driving `AgentToolDispatcher` directly for all 7 of its tools plus asserting the
8-tool catalog, with `session_submit` explicitly excluded (a harness trigger, not a content tool) and
its exclusion asserted, not assumed.

**False greens (defect 2).** `ptah_count_tokens`'s driver now mocks `files.read`/`context.countTokens`
(previously unmocked — the call threw and returned an accepted `isError`). `ptah_get_symbol_index`'s
fixture now uses the real `SymbolIndexPage` shape (`files`/`count`/`total`/`offset`, not
`entries`/`nextOffset`) and gets its own dedicated test (own-windowing tool, see below).
`ptah_lsp_references`/`ptah_lsp_definitions` fixtures are now `{file, line, col}` objects, matching
what the formatter reads (string fixtures rendered empty location labels — a real false green).
`ptah_agent_report`'s coverage-loop call now sets `_callerAgentId` and exercises the ATTRIBUTED
success path (`ptahAPI.agent.report` actually invoked), not the 79-char unattributed refusal.

**Universal per-tool checks (defects 3, 4).** Every non-"own-windowing" tool (50 of 54) is now checked,
generically, for: call success (before any size check); returned TOKENS ≤ the tool's budget (not char-
only); a `[reduced: ` trailer; exactly one new spool file, BYTE-EQUAL to the exact raw text captured by
spying on the real, unmocked `applyToolResultBudget` export (`jest.spyOn` on the module — not a
hand-duplicated formatter call, so oracle and implementation cannot drift); the marker present in the
raw AND in the spool file always, and in the returned TEXT unless the driver declares
`expectMarkerInText: false`. That flag exists because testing surfaced a REAL, correct system behaviour:
for tools whose entire oversized content is one fixed-order paragraph or Markdown table with no
internal heading/list structure (`agent_spawn`, `agent_message`, `agent_report`, `agent_stop`,
`agent_list`, `git_worktree_list/add/remove`, `json_validate`, all single-field `browser_*` tools,
`count_tokens`), the Markdown-outline reducer correctly drops that block wholesale rather than
partial-keep it (`isMarkdown` treats any single leading `#` heading as Markdown, and the outline keeps
only headings) — nothing is lost (spool byte-equality + marker-in-spool still hold), the model simply
does not see it inline. This is documented, not weakened: 17 drivers carry the flag with a comment;
16 others (lists like `search_files`/`lsp_references`, multi-heading `agent_status`, JSON-tabulated
tools, diagnostics) keep full text-marker survival because their structure genuinely does survive.
`ptah_get_symbol_index`, `ptah_agent_read` and `ptah_browser_evaluate` pre-fit their own output to the
budget INSIDE the dispatcher before the generic layer runs; each gets a dedicated correctness test
instead of the generic byte-oracle assertion (their own algorithm's front-kept/no-outer-trailer
contract is asserted directly). `ptah_get_diagnostics` keeps its dedicated test, strengthened to assert
the MARKER inside the requested-file message, not just the filename/heading (r1's specific "message can
disappear while heading survives" finding).

**browser_content (defect 5).** New dedicated test drives the real `handleMCPRequest` path (not a
bypass): asserts `html-extract` named in the trailer, the article-title marker present in the returned
text, and the spool file byte-equal to the RAW page HTML (not the 32 KiB formatter copy) — passes now
that Batch 21p landed. The stale "does not exist" comment is removed.

**Manifest exact-title matching (defect 6).** Replaced substring matching with `hasActiveTestTitled`: a
line-based (not full-AST) matcher requiring the EXACT quoted title as the argument of an active
`it`/`test`/`maybe`(`.each`) call, walking back one line when the call opener is alone on the line above
(the codebase's `maybe(...)` convention wraps a multi-line call); explicitly rejects `.skip`/`.todo`/
`xit`/`xtest` openers and comment lines. Self-tests included (5 cases: comment-only, skip/todo, all
three active callers + `.each`, and no-accidental-substring-match).

**Manifest mapping fixes (defect 7).** `ptah_code_search_symbols` now points at the actual recall
benchmark (`code-symbol.store.spec.ts`'s `maybe('recall guard: every exact symbol name ranks its
declaration first...')`), not the SQL-preparation unit test it wrongly pointed at before.
`ptah_get_diagnostics` now requires an array of BOTH guards (the Batch 19 provider contract AND the
Batch 1 formatter cap, per batches.md:2854), and the provider-contract guard carries an `invokedBy`
check that `run-diagnostics-provider-contract.self.spec.ts` contains `createSecondCheckout` — proving
the contract is actually exercised with that case, not merely defined.

**Portable spool discovery (defect 8).** All regex-over-printed-path parsing removed; every test now
diffs a directory snapshot of `<spoolRoot>/.ptah/tmp/mcp-out` before/after the call (works on any OS,
any path shape, matching `protocol-dispatcher.spec.ts`'s own `onlySpoolFile()`/`spoolDir()` idiom).

**Per-tool description budget (defect 9).** Replaced the single 5,000-char ceiling with a 56-entry
`DESCRIPTION_BUDGETS` map, one pin per tool at `ceil(measured * 1.1) + 10`, measured 2026-09-27; a tool
missing from the map fails explicitly rather than inheriting a permissive default.

**Independent pins (defect 3, budgets).** New describe block asserts `DEFAULT_TOOL_RESULT_BUDGET_TOKENS
=== 2000`, `DEFAULT_TOOL_RESULT_BUDGET_CHARS === 8000`, and both documented overrides
(`ptah_browser_content` = 32 KiB + 1 KiB, `ptah_surface_get_state` = 548 KiB) against their literal
formulas, independent of using the same constant elsewhere as a comparison threshold.

**Break proofs (redone, all reverted, `git diff --stat` clean on production files after):**

1. Same as before — `declareResultBudgets` skip for `ptah_search_files` → the "declares a
   maxResultSizeChars" test fails (`Received: "undefined"`).
2. Stronger, per the review's own suggestion: `it.skip(` a REAL test
   (`mcp-response-formatter.spec.ts`'s diagnostics-cap test) while keeping its exact title → the
   `ptah_get_diagnostics` manifest case fails (`no active test titled exactly "..."`), proving the
   matcher rejects a skipped-but-titled test, not just an absent string.
3. Same html-reducer marker sabotage — now fails the `ptah_browser_content over budget` DISPATCHER test
   (not a bypassed direct-`reduceOutput` test as before).

**Verification:** `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`
run 3 times — all three green (52.8s, 44.1s, 38.5s critical path; no flake this round).
`ptah-electron:validate-deps` → all imports covered. `degradation-audit:lint` → TOTAL 300. Isolated
`jest mcp-contract.sweep.spec.ts mcp-mandate-manifest.spec.ts` → 42 total, 41 passed, 1 todo, ~20s.
`git status --short` after all reverts: only the two spec files are new from this batch; the modified
`protocol-dispatcher.ts`/`.spec.ts`/`tool-result-budget.ts` are Batch 21p's own uncommitted changes
(not this batch's); `batches.md`/`context.md` are outside this batch's ownership and untouched by it.

## Revision round 2 (r2 REVISE 4/10)

Against `reviews/batch-21-code-logic-review-r2.md` (2 Blocking, 3 Serious, 1 Moderate). No production
file edited; six production-confirmed regressions are now failing tests, left failing per the
coordinator's explicit instruction this round.

**Blocking 1, execution matrix.** `sweepAllTools(hostConfig, requestExtra)` extracted from the single
loop into a reusable function; the FULL universal contract (success, token/char budget, trailer,
byte-equal spool, marker) now actually runs 5 times: HTTP+IDE+anonymous, HTTP+no-IDE+anonymous (51
tools), HTTP+IDE+workspace-caller, HTTP+IDE+agent-caller, HTTP+IDE+session-caller, not just counted.
A new coverage-matrix describe block pins the served counts (56/53) and the 3-tool IDE-only delta by
name. Stdio was rewritten to route through the REAL `StdioMcpServerService` (not `AgentToolDispatcher`
directly, and not `MCP_MVP_TOOL_NAMES`, the actual `handleToolsList`/`handleToolsCall` response),
covering all 7 agent handlers, not 2, plus `session_submit` via a fake `ISessionSubmitHandler` (proving
real routing; its own aggregation cap lives in `apps/ptah-cli`, outside this lib's hexagonal boundary,
documented rather than asserted). All 6 additional full passes plus the stdio suite added roughly 13s
total, not the blow-up a naive 4-caller by 2-host by 54-tool full re-run would cost: production
dispatch on even 280KB to 1MB fixtures is fast (string ops and `marked` lexing, not real BPE
tokenization), so there was room to do this properly rather than sample it.

**Blocking 2, 18 marker waivers reduced to zero.** Investigated why `expectMarkerInText: false` was
needed at all: `detectContentKind`'s `isMarkdown` fires on any single leading `#` heading, and the
Markdown-outline reducer drops a paragraph or table that does not fit as one indivisible block, unless
the raw document exceeds `MAX_OUTLINE_CHARS` (262,144 chars, `markdown.reducer.ts`), in which case the
reducer takes its own "too large to lex" bypass and the generic pipeline falls back to a plain prefix
cut, which does preserve a front-positioned marker. Verified empirically with temporary debug specs
(removed) for `agent_spawn` at 280,000 chars versus 20,000. Fix: raised every affected driver's
oversized field, or for the 4 table-shaped tools (`agent_list`, `git_worktree_list`, `browser_network`,
`json_validate`) the row count or row size, past that threshold. All 18 now assert full marker survival
in the returned text; the now-unused `expectMarkerInText` field was deleted from the driver interface
and the assertion. Waivers remaining: zero.

**Serious R2-04, screenshot.** Token and char checks now run for `ptah_browser_screenshot`'s text
caption before the image-block exception (previously skipped entirely via an early `continue`); the
image block's `data` is also asserted byte-identical to the source.

**Serious R2-03, recovery and shape checks.** Partially addressed within scope: the generic loop now
requires the returned text to literally contain `[reduced: ` and the spool file to be byte-equal to the
exact captured pre-budget text (via `jest.spyOn` on the real `applyToolResultBudget`, not duplicated
logic) and the marker to be present in both the spool and the returned text for every one of the 50
generic-path tools, a stronger universal per-tool requirement than r1's two representative examples.
Not attempted this round, given the remaining Blocking items took priority: parsing the trailer's
printed reducer NAME and asserting it against an allow-list per tool, and verifying the printed locator
resolves to the discovered file byte-for-byte (the discovery is directory-diff based and independent
of the printed path, a stronger portability property per r1 defect 8, but does not cross-check the
two).

**Serious R2-05, manifest AST parsing.** `hasActiveTestTitled` rewritten on the real TypeScript
compiler API (`ts.createSourceFile` plus an AST walk); `typescript` was already a workspace dependency,
no new one added. Handles: string-literal and adjacent-concatenation titles; `it`/`test`/`.each(...)`;
the codebase's `const maybe = cond ? it : it.skip;` alias, resolved by inspecting the initializer's
`ConditionalExpression` shape (an alias bound to anything else, e.g. `const maybe = it.skip;`, is
correctly not active); rejects any call whose own name or any ancestor call is `describe.skip`,
`xdescribe`, `it.skip`/`test.skip`/`xit`/`xtest`. All 4 of the review's counterexamples now have a
dedicated self-test and correctly return false: skipped-parent `describe.skip`, a block comment without
leading stars, a title inside an unrelated string literal, and an unconditional `maybe=it.skip` alias.

**Moderate R2-06, mapping fixes.** `ptah_lsp_references` now maps to "returns word-boundary matches
across scanned files" (a real `getReferences` test), not the `getDefinition` test it wrongly pointed
at. `ptah_workspace_analyze`/`ptah_search_files`/`ptah_memory_search` now map to the sweep's own
executing test title (the one that actually calls them), not a driver-object-exists check.
`ptah_get_diagnostics`'s `invokedBy` now points at `type-script-diagnostics-provider.spec.ts` (the real
`TypeScriptDiagnosticsProvider` run through the shared contract with `createSecondCheckout`), not the
self-spec's fake provider.

**Newly confirmed product defects (tests left failing, not weakened, per this round's explicit
instruction):** the stdio `AgentToolDispatcher` applies no budget, cut or spool step to `agent_spawn`,
`agent_status`, `agent_message`, `agent_report`, `agent_stop` or `agent_list`, only `agent_read` has
its own pre-fit windowing. Each of the 6 now has a dedicated test asserting the real required contract
(bounded text, marker present); all 6 fail with the actual oversized length (280,089 to 490,877 chars
against the 8,000-char budget), confirming the gap is real, not a fixture artefact. Recommended next
step: a fix batch adding the same `applyToolResultBudget`/spool step `agent_read` already has to the
other six handlers in `agent-tool.dispatcher.ts` (out of this batch's scope, spec files only).

**Break proofs (redone for r2, all reverted, `git diff --stat` clean on production files after):**

1. Same `declareResultBudgets` skip for `ptah_search_files` fails "declares a maxResultSizeChars".
2. `mcp-response-formatter.spec.ts`'s diagnostics-cap test wrapped in a NEW enclosing
   `describe.skip('display cap, requested files first (TASK_2026_559)', ...)`, the coordinator's
   specific ask this round, a skipped PARENT, not the test itself, fails the `ptah_get_diagnostics`
   manifest case (`no active test titled exactly "..."`), proving the AST walk's ancestor check.
3. Same html-reducer marker sabotage fails the `ptah_browser_content over budget` dispatcher test.

**Verification:** `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`
run 3 times: lint and typecheck succeed every time; the `test` target fails every time on exactly the
6 known, confirmed, newly-discovered stdio product defects above (2,048 total tests, 2,041 passed, 6
failed, 1 todo), reported honestly rather than weakened. `ptah-electron:validate-deps` shows all
imports covered. `degradation-audit:lint` shows TOTAL 300. Isolated `jest mcp-contract.sweep.spec.ts
mcp-mandate-manifest.spec.ts`: 57 total, 50 passed, 6 failed (the same 6), 1 todo, about 23 to 25s
(under the 60s budget for both files). `git status --short`: only the two spec files are new from this
batch; `protocol-dispatcher.ts`/`.spec.ts`/`tool-result-budget.ts` remain Batch 21p's own uncommitted
changes; `batches.md`/`context.md` remain outside this batch's ownership.
