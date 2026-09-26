# Code Logic Review — TASK_2026_559_8ca9

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

**Round 3, post-cap independent review of Batch 2e. Verdict: APPROVE.** Both r2 findings are fixed, and all five r1 fixes remain effective in the supplied regressions and independent probes. No new reproduced defect was established.

The evidence supports 8 rather than 5–6: the previous semantic-corruption, inaccurate-retention, budget-overflow and recovery failures no longer reproduce. It does not support 9–10: packaged host installation was not exercised, editor diagnostics remained unavailable, and this is an approval of the Batch 2e correction and integration contracts, not a fresh approval of the previously accepted reducers and their recorded known issues.

Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract:

- **R**: libs/backend/tool-output-reducers/src/lib/reduce-output.ts
- **T**: libs/backend/tool-output-reducers/src/lib/token-measure.ts
- **L**: libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.ts
- **D**: libs/backend/tool-output-reducers/src/lib/content-detector.ts
- **B**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts
- **BS**: the adjacent tool-result-budget.spec.ts

## Prior findings: r1 and r2

| Finding | Status | Evidence and reproduced verification |
| --- | --- | --- |
| r1 S1: piecewise token undercount | fixed | T:201–243 uses pre-token boundaries or a byte upper bound; T:135 verifies fitted prefixes; B:290 measures the joined result. Literal 1,018-space case returns 19; the 2,734-character case counts 2,001 and is cut at the default limit. Independent 1,000-sample Unicode/boundary and prefix probes found no undercount or overflow. |
| r1 S2: prefix fitting drops the failure and summary | fixed | L:186–245 and L:273–305 prioritize failures; B:250 supplies the trailer-adjusted window. The literal 1,000-line verbose-head fixture retains UNIQUE_FAILURE, its frame and the final summary (BS:416). The beyond-2-MiB tail regression also passes in reduce-output.spec.ts. This status does not promise preservation of errors in the deliberately omitted middle. |
| r1 M1: trailer exceeds the budget | fixed | B:372–389 chooses a bounded relative locator; B:290–315 checks body plus actual trailer. The literal 35-component qz path reproduction fits and names the workspace root. The temp-root regression passes (BS:452). |
| r1 M2: throwing output channel escapes recovery | fixed | B:593 and R:222 isolate logging. Simultaneous rejecting reduction and throwing appendLine resolves to capped fallback output, independently reproduced and covered at BS:463. |
| r1 M3: arbitrary Error.name leaks | fixed | B:612 and R:260 allow only fixed names with guarded reads. Custom-name reduction and spool failures emit Error, not /private/SECRET; independent fault injection and BS:472/484 pass. |
| r2 B1: structured tail parsed outside its original context | fixed | R:120–138 determines kind before the cap and refuses every over-cap non-log kind; only R:200 stitches lines. Both literal HTML/Markdown cases return raw with reducer none. The HTML helper result is cut, contains no hidden sentinel, and saves the original raw (BS:496). LF/CRLF and hint variants pass. |
| r2 M1: degraded error-retention metadata overstates kept errors | fixed | L:108–112 counts final keep flags. Literal 30-error fixture at 25 tokens/200 chars reports kept 2 of 30 error line(s). Independent LF/CRLF variants at 10, 25, 50 and 2,000 tokens report 1, 2, 6 and 10 retained groups respectively under the 200-character limit. |

For r2 M1, the counting unit is the collapsed error group, as explicitly requested in the bounded correction; repeated source lines are separately represented by the repeat suffix (L:144–162).

## Five logic questions

### 1. How does this fail silently?

No new silent failure reproduced. Structured over-cap input now refuses before extraction (R:134–138); reduced or cut helper output has a raw spool locator or an explicit save-failure trailer (B:260–269, B:381–389). A log can still omit its middle by design, with a character omission note (R:213–218); the correction does not promise that every error anywhere in arbitrarily large input survives.

### 2. What user action produces unexpected behaviour?

None established within this correction's contract. Supplying a mismatched hint intentionally overrides sniffing (D:71–73). Over-cap log hints select line reduction, while HTML/Markdown/code/JSON hints return raw (R:135). Independent variants verified this distinction. A log-like prefix followed by HTML or Markdown after the first 2 MiB can still select log, but output remains source lines plus omission notes; no structured parser is invoked (R:239–242).

### 3. What input data produces a wrong answer?

No new wrong-answer case reproduced. The former script and fence fixtures now refuse. Active mixed-format cases with an opener outside the retained regions preserved ordered verbatim tail lines and declared the omission (R:200–218, L:455–480). They were labelled log-reduced, not html-extract or markdown-outline. The token counter and fitted prefixes passed an independent whole-string tokenizer oracle on 1,000 generated samples including CRLF, combining marks, CJK, emoji and lone surrogates (T:86, T:135).

### 4. What happens when a dependency fails?

Rejected reducers are caught and return raw through best-effort logging (R:146–163). Spool errors become classified failure trailers; EEXIST retries exclusive creation, and other write errors attempt partial-file cleanup (B:470–494). Unexpected budgeting failure follows plainCut (B:541–580); throwing logging cannot defeat it (B:593). Independent custom-name and throwing-channel injection passed. Pruning is best effort (B:502–532). No timeout guarantee is inferred: the existing outliner call is awaited, and this bounded correction adds no cancellation protocol.

### 5. What is missing that the requirements never mentioned?

No additional requirement gap established by reproduction. The limits that must remain explicit are conservative token estimates for long pre-tokens (T:242), deliberate middle omission for oversized logs (R:213), and group-based error notes after deduplication (L:108, L:144). These constrain interpretation rather than constitute new defects.

## Failure modes

None newly established. Reviewed the full pipeline, token counter, log reducer, budget helper, shared contract/barrel and Markdown counter consumer; read the pipeline, counter, log and helper regression suites and the changed adapter spec/configuration. Traced identity, classification, cap/refusal, reduction, final fitting, spool writes, collision/error paths and logging fallback.

The independent probes used actual worktree TypeScript transpiled in memory and the installed tokenizer. Filesystem writes were stubbed in those probes to capture and compare raw spool payloads; the passing supplied helper suite exercises real temporary spool files. The unchanged HTML/JSON internals and earlier known issues are not newly approved by this report.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

None newly reproduced. No speculative finding is counted.

## Data flow

1. **OK — Identity:** B:230–244 and R:108–115 measure before acceptance; no spool for an unchanged under-budget result.
2. **OK — Kind and cap:** R:120–138 applies hints/original-prefix detection before selecting the cap policy. Over-cap non-log input goes raw to cut/spool.
3. **OK — Log cap:** R:200–214 retains complete LF/CRLF lines and an omission note. Independent active mixed-structure variants preserved line order and contents.
4. **OK — Reduction/refusal:** R:146–172 awaits reduction and rejects unchanged, blank or non-improving output. R:166 restores the cap note if selection omitted it.
5. **OK — Error-priority selection and metadata:** L:209–245 fits the rendered selection; L:273 prioritizes errors; L:108 counts retained groups.
6. **OK — Raw persistence:** B:260 saves raw rather than reduced text; B:480 uses wx, retries collisions and exposes failure rather than claiming a saved file.
7. **OK — Final envelope:** B:290–315 validates the actual joined text against both limits and shrinks or falls back to trailer-only output.
8. **OK — Recovery:** B:541, B:593 and B:612 separate fallback, logging and safe exception classification.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| r2 structured-cap safety | COMPLETE | Non-log over-cap input refuses; R:134–138 |
| Truthful retained-error metadata | COMPLETE | Final selection counted; L:108 |
| r1 token upper bound and final budgets | COMPLETE | T:201; B:290; independent oracle passed |
| r1 error and summary retention reproduction | COMPLETE | L:186; BS:416 passes |
| Verbatim ordered log lines, omission notes, non-empty/refusal | COMPLETE for reviewed correction | L:144, L:455; R:162; reconstruction suite and independent probes pass |
| Safe logging and exception names | COMPLETE | R:222/260; B:593/612 |
| Raw spool, locator, failure/collision recovery | COMPLETE | B:372/470; supplied helper suite passes |
| Runtime marked dependencies and real-marked Jest loading | COMPLETE in source configuration | CLI package.json:78, Electron package.json:42, vscode-lm-tools package.json:17, jest.config.ts:31, tsconfig.spec.json:8; no packaged installation smoke test |
| Dispatcher integration | Outside Batch 2e | Batch 2f owns wiring |

Implicit requirements not addressed: none newly established within the correction's scope.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Literal r2 HTML/script and Markdown/fence corruption | YES | Raw refusal, reducer none | Helper cuts and spools; no extraction of a synthetic document |
| LF/CRLF and all seven hint kinds | YES | 32 structured-cap routing variants passed | Log hint intentionally overrides structure |
| Log-like prefix; structure begins after 2 MiB | YES for log safety contract | Active reductions preserve source lines/order and omission note | No promise of HTML/fence structural completeness for log output |
| Tail begins inside a structure | YES for log safety contract | No structural parsing; complete retained lines | Middle context is explicitly omitted |
| Too many errors for the budget | YES | Retained group count matches final selection | Finite budget cannot retain all errors |
| Huge single line / no useful capped lines | YES | Raw fallback then cut/spool | Conservative counting can shorten output |
| Empty, whitespace, Unicode and token boundaries | YES on exercised cases | Supplied suite plus 1,000 independent token/prefix samples | No exhaustive Unicode proof claimed |
| Long spool path | YES | Relative locator; final combined fit | Long-path probe stubs successful I/O |
| Throwing sink and custom Error.name | YES | Nonthrowing logging and allow-list | Independent combined-failure probe passed |

## Verification and scope limits

- Ran once from the requested worktree root: node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools --skip-nx-cache. **All six targets passed; duration 1m28s, cache skipped.** Output was tailed. PowerShell wrapped native stderr as NativeCommandError, but Nx explicitly reported all targets successful.
- Scoped ptah_get_diagnostics returned unavailable: the compiler check was still running after 45 seconds. No editor-diagnostics pass is claimed; both requested Nx typecheck targets completed successfully.
- Independent probes: 32 structured cap/hint/EOL routing cases; original r2 fixtures through the helper; eight degraded-error-count cases; four active mixed-structure reductions; 1,000 generated token-boundary/prefix samples; the literal r1 token, verbose-log and long-root cases; 24 additional final-envelope cases; and combined throwing-channel/custom-error dependency failures. All final-envelope checks use exact whole-string token counts plus character length.
- Active mixed-structure helper outputs were 7,688–7,694 characters and 1,194–1,196 exact tokens, including trailers. Captured spool payloads equalled raw input.
- Read both prior reviews, the executor report including bounded correction, both Batch 2e notes, Batch 2e requirements and Decisions 2/7. The task folder contains no task-description.md, implementation-plan.md or code-style-review.md; batches.md is the operative plan.
- ptah_search_files found no AGENTS.md; checked worktree/ancestor instruction locations also yielded none. No direct file-read tool was listed, so native reads were used.
- The reviewer role prohibits git operations. Consequently git status/diff/branch verification requested by the caller could not be performed; scope is the supplied file list, executor report and current worktree contents, not an independently enumerated diff.
- No production edits, git operations or raw .jsonl/.sqlite session-log reads were performed. Inline probes created no source or spool files. No packaged Electron/CLI install or adversarial filesystem-race test was run.

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** for the bounded correction and reproduced regressions; limited to source configuration for runtime packaging.
- Top risk: consumers must interpret oversized log output as explicitly incomplete line selection, not a complete structured document (R:200, L:23).
- What a robust implementation would add: retain the literal regressions and, in later integration verification, add the active mixed-format/CRLF cap cases and packaged-host smoke coverage. No production correction is required by this review.

