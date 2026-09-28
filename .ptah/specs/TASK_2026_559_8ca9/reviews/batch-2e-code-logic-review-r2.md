# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 2 |

Round 2, Batch 2e, independent behavioural review. **Verdict: REVISE.** All five round-1 reproductions are fixed. The new head/tail cap nevertheless corrupts structured-document context, and degradation leaves an inaccurate error-retention note. Working budget enforcement, recovery and the passing regression suite separate this from the 3–4 band; demonstrated semantic corruption prevents 7–8.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`:

- **R**: `libs/backend/tool-output-reducers/src/lib/reduce-output.ts`
- **T**: `libs/backend/tool-output-reducers/src/lib/token-measure.ts`
- **L**: `libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.ts`
- **M**: `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts`
- **B**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- **BS**: the adjacent `tool-result-budget.spec.ts`.

## Round-1 findings

| Finding | Status | Evidence and verification |
| --- | --- | --- |
| S1: piecewise undercount | fixed | T:201–245 cuts on pre-token boundaries, with UTF-8-byte fallback; T:135 verifies the resulting prefix. Both literal counter reproductions and the default-budget helper reproduction run in the passing suite (BS:396,407). Additional independent stress checks found no undercount or final overflow. |
| S2: prefix cut drops log failures | fixed | L:181,204,268 prioritizes errors and fits both budgets; B:250 supplies the trailer-adjusted window. The literal verbose-head/failure/summary reproduction passes (BS:416). R:187–200 also retains a tail beyond the old prefix cap. The separate cross-kind regression is B1 below. |
| M1: oversized trailer | fixed | B:372 selects a bounded relative locator; B:290 checks the actual combined string. The 35-component token-dense path reproduction and long temp root both pass (BS:434,452). |
| M2: throwing output channel | fixed | B:593 and R:208 isolate appendLine. The simultaneous reduction failure and throwing sink reproduction passes (BS:463). |
| M3: Error.name leak | fixed | B:612 and R:246 allow only fixed built-in names and guard property reads. Custom-name budget and spool failures pass (BS:472,484); pipeline regression also passes. |

“Fixed” refers to the identified failure and its reproductions, not a claim that every possible log failure in a multi-megabyte input survives: the declared cap still deliberately omits the middle (R:200).

## Five logic questions

### 1. How does this fail silently?

A syntactically significant opener in the omitted middle is removed before parsing, promoting script text to visible main content or fenced text to a Markdown heading (R:114–119,200; B1). The result is labelled a successful extraction. Separately, the public log reducer can report `kept 30 error line(s)` after emitting only two (L:107; M1).

### 2. What user action produces unexpected behaviour?

Requesting a large HTML document containing long lines around a script, or a Markdown document with a large fenced example, triggers B1 (R:187–200). Calling the reusable log reducer with a tight budget triggers the misleading retention note (L:93–107,268).

### 3. What input data produces a wrong answer?

The literal HTML and Markdown cases below lose their structural opener while retaining complete tail lines. Complete lines do not imply complete syntactic context (R:200, M:110). Token tests including CJK, emoji, combining marks, lone surrogates, numbers, contractions, CRLF and long whitespace found no false acceptance in T:201 or B:290.

### 4. What happens when a dependency fails?

Reducer throws are awaited and caught, with raw fallback and best-effort logging (R:128–146,208). Spool failures yield a short classified failure trailer, collisions retry exclusive creation, and pruning failures are ignored (B:470–533). Unexpected budgeting failures use plainCut; a broken tokenizer can yield trailer-only output with zero/unknown counts (B:541–589). These branches passed the scoped suite; no new escape was established.

### 5. What is missing that the requirements never mentioned?

The head/tail cap needs a content-kind-specific structural policy: an omission note cannot restore HTML ancestry or fence state (R:119,200). Degradation also needs truthful retained/omitted error accounting (L:107). These are necessary consequences of Decision 7's faithful reduction contract.

## Failure modes

### B1 — Head/tail stitching changes structured content meaning (Blocking)

- Trigger: input exceeds the cap, and an HTML/fence opener falls in the removed middle while its contents occur in the retained tail.
- Symptom: hidden script content appears as visible main content; a code-example heading appears as a real document heading.
- Evidence: R:114–119 caps before detection; R:187–200 concatenates distant pieces into one document; M:110 and `reducers/html.reducer.ts:122` parse that synthetic document normally.
- Current handling: a generic character-omission note is inserted. It describes missing characters but does not disclose that the surviving text was interpreted in the wrong context. Both ordinary size guards can be bypassed by the much shorter stitched input (M:91; `reducers/html.reducer.ts:101`).
- Recommendation: limit head/tail stitching to line-oriented content with the corresponding safety contract. For structured kinds, refuse reduction of an incomplete document and let the caller cut/spool raw, or preserve parser state and complete structural units. Determine kind from the original prefix/hint before applying this policy. Add both literal integration regressions.

Executed with actual TypeScript sources transpiled in memory; only filesystem I/O was stubbed for the final helper probe (no spool file was created):

```js
const raw = '<main>\n<p>VISIBLE</p>\n'
  + 'x'.repeat(1100000) + '\n<script>\n'
  + 'y'.repeat(1100000)
  + '\n<p>HIDDEN_SCRIPT_SENTINEL</p>\n</script>\n</main>';
await applyToolResultBudget({
  text: raw, toolName: 'test', requestId: 7, spoolRoot: absoluteRoot
});
```

Observed: `reducer: 'html-extract'`, `reduced: true`, `truncated: false`; output contains `VISIBLE`, the cap note, then **HIDDEN_SCRIPT_SENTINEL** as ordinary visible text. The exact whole-output token count fits; this is semantic corruption, not overflow. Direct reduceHtml on the original refuses due to its size, so this is introduced by the pipeline rather than one of the accepted HTML known issues.

```js
const raw = '# REAL\n\n'
  + 'x'.repeat(1100000) + '\n```\n'
  + 'y'.repeat(1100000)
  + '\n# NOT_A_HEADING\ncode text\n```\n';
await reduceOutput(raw, {
  budgetTokens: 30, budgetChars: 500, hint: 'markdown'
});
```

Observed `markdown-outline` begins `# REAL\n# NOT_A_HEADING\n`; the latter was inside the original fence. This also bypasses the Markdown 256 KiB refusal because most source characters occupied two omitted lines. The pipeline may legitimately return more than its budget; the defect here is the changed meaning.

### M1 — Degraded logs overstate the number of retained errors (Moderate)

- Trigger: the required errors no longer all fit and the new one-by-one selection drops some.
- Symptom: ReduceResult.notes claims all detected error groups were kept.
- Evidence: L:93 collects every matching group; L:107 reports `errors.length` without consulting `keep`; L:268 may discard errors.
- Current handling: line omission markers in text remain correct, but the separate public metadata is false. The current pipeline does not forward notes (R:157–164), limiting the present impact to direct/reuse consumers.
- Recommendation: count retained error groups using keep, define whether counts mean source lines or collapsed groups, and report omitted errors explicitly.

Executed reproduction:

```js
reduceLog(Array.from({length: 30}, (_, i) => `ERROR: unique ${i}`).join('\n'), {
  budgetTokens: 25, budgetChars: 200
});
```

Text contains error 0, a 28-line omission marker, and error 29. Notes are `['kept 2 of 30 lines', 'kept 30 error line(s)']`.

## Blocking issues

### B1 — Structured tail is parsed without its original context

- File: R:200; routing R:119.
- Scenario: HTML script/hidden ancestry or Markdown fence openers occur in the removed middle.
- Impact: the model receives a successful-looking extraction with changed content meaning.
- Fix: use kind-aware cap/refusal; never parse disconnected structured fragments as a complete original document.

## Serious issues

None newly established in this batch.

## Moderate and minor issues

- **M1**, L:107: error-retention metadata does not account for budget degradation; calculate kept/omitted counts from the final selection.
- Residual limitation, not a new finding: conservative byte counting can substantially overestimate long pre-tokens (T:242); this trades reduction quality for bounded runtime and a sound upper bound.

## Data flow

1. **OK:** raw → identity precheck uses the conservative count (B:229; R:103).
2. **GAP B1:** raw → whole-line head/note/tail concatenation → content detection and parser (R:114–119,187–200).
3. **OK with M1 metadata gap:** reduction is awaited, refusals/blank/non-improvement return raw, log selection preserves order and omission markers (R:128–164; L:204,450).
4. **OK:** successful changed text → raw spool with exclusive creation, retry and best-effort cleanup/pruning (B:260,470–533).
5. **OK:** reduced text + actual trailer → measured token/character fit, smaller-window retry, trailer-only fallback (B:290–325).
6. **OK:** optional logging failure cannot prevent plain-cut recovery; fixed error classification avoids arbitrary Error.name text (B:541,593,612; R:208,246).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Conservative token upper bound and bounded tokenizer pieces | COMPLETE | T:201–245; independent probes found no undercount |
| Identity when the conservative measure fits | COMPLETE | B:229; conservative overestimation is intentional |
| Final text, trailer included, fits token and char budgets | COMPLETE | B:290; independent envelope probes and BS pass |
| Preserve log failures before routine head/tail | COMPLETE | L:181,268; r1 reproduction passes; finite budget cannot keep every error |
| Verbatim log lines, ordered gaps, non-empty result | COMPLETE | L:138–157,268,450; reconstruction specs pass |
| Both ends capped without splitting LF/CRLF lines | COMPLETE | R:187–200; instrumented capture confirms |
| Faithful structured reduction across the cap | MISSING | B1 |
| Accurate log retention metadata | PARTIAL | M1 |
| Raw spooling, locator, collisions and failure recovery | COMPLETE | B:372,470; BS passes |
| Runtime marked declarations and test ESM loading | COMPLETE for inspected configuration | Manifest entries and scoped lint/tests pass; no packaged install smoke test |
| Dispatcher integration | Outside Batch 2e | Batch 2f owns it |

Implicit requirements not addressed: preserving parser context across omissions; truthful degraded-retention metadata.

### Deviations 1–5 and changed Batch 2c specs

| Item | Judgment | Evidence |
| --- | --- | --- |
| 1: shared bounded counter | Justified | Required by batches.md:773–783; T:201 and M:304/L:484 centralize counting. Sound bound for the installed pinned pre-token pattern; conservative long-run estimates are explicit. |
| 2: reducer package manifest | Justified | `libs/backend/tool-output-reducers/package.json:2–3` supplies workspace name/version for dependency checks. Scoped lint passes. |
| 3: marked in CLI/Electron | Justified | `apps/ptah-cli/package.json:78`, `apps/ptah-electron/package.json:42`; CLI external list `project.json:70`, Electron generation `project.json:32`. No new package family; fulfills the existing packaging risk. |
| 4: real marked in Jest | Justified | `vscode-lm-tools/jest.config.ts:31`, `tsconfig.spec.json:8`; real adapter and pipeline tests pass without the former marked shim. |
| 5: workspace dependency declaration | Required and justified | `vscode-lm-tools/package.json:17`, batches.md:883–889; scoped lint passes. |
| D1c/D1d changes | Justified behavioural adjustment under Decision 7 | `log.reducer.spec.ts:482,493`: when the required set cannot fit, keeping the failure before a caller prefix-cut is more faithful than preserving routine head lines at any cost. D1d still checks full head/tail/context when they fit. Verbatim/order/non-empty guards remain. This does not justify inaccurate retention notes (M1). |

The degradation is staged, not a strict lexicographic deletion: L:181 shrinks head and tail in the same early levels. No independent content-loss defect was established from that choice.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty, blank, ANSI-only logs | YES | Existing refusal/non-empty guards, L:84–103 | No new failure established |
| Unicode/CJK/emoji, combining marks, lone surrogates | YES for budget bound | Exact oracle versus T counter and fitted prefixes | Byte fallback may be conservative |
| Numbers, contractions, CRLF, long whitespace | YES for budget bound | Boundary stress and exact oracle | No observed undercount |
| Pre-token over 1,024 chars | YES | UTF-8 bytes, T:242 | Deliberate overestimate |
| LF/CRLF at 2 MiB cap | YES | Complete boundaries, R:187–200 | Structural context is still B1 |
| Huge lines in structured documents | NO | Their removal can shrink input past parser guards | B1 |
| More errors than fit | PARTIAL | Prioritized lines and omission markers | Metadata M1 |
| Long spool paths, same ids, filesystem errors | YES on tested paths | Relative locator, wx retries, short failure trailers | No installed-package or adversarial filesystem test |

## Verification and scope

Read the named production files and associated specs/configuration, r1 review, executor report, context and both Batch 2e notes. No task-description.md, implementation-plan.md, code-style-review.md or AGENTS.md was found in the task/worktree or checked ancestor instruction locations; batches.md is the operative plan. No production code was edited and no raw session logs were read. No git commands were run under the reviewer role's prohibition; scope follows the supplied file list, not an independently enumerated diff.

The exact requested scoped Nx command completed successfully: **test, lint and typecheck for both projects, six targets, cache skipped, 1m39s**. It reran all supplied r1 literal regressions. PowerShell displayed a NativeCommandError wrapper for native stderr, but Nx explicitly reported all six targets successful. The scoped ptah_get_diagnostics call returned unavailable after 45s; Nx's two passing typecheck targets provide the completed compiler evidence.

Independent in-memory probes used the real tokenizer as a whole-string oracle: 1,500 boundary samples plus 500 additional Unicode samples, prefix checks, and 27 final-envelope cases yielded zero undercounts/overflows. Unicode fixtures in the second set used JS escapes to avoid PowerShell stdin encoding changes. Numeric, contraction, CRLF and whitespace stretches and pre-tokens up to 2 million characters were exercised. Long-letter counter timings at 250k/500k/1m/2m characters were approximately 1/1/2/4 ms. T:201 scans pre-tokens once and sends only bounded pieces to BPE, supporting linear counting work; timing alone is not a proof.

Instrumented pipeline capture at 55,000 distinct lines produced capped lengths **2,096,993 (LF)** and **2,097,015 (CRLF)**; every non-note output line was a complete original line. The final HTML corruption and Markdown promotion were separately reproduced as above. The 30-error metadata case was reproduced at budgets 10, 25 and 50. Inline probes wrote no files and used filesystem stubs where noted. Packaging was inspected, not rebuilt or installed; prior accepted HTML/Markdown/code known issues are not reclassified as new Batch 2e findings.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for the reproduced findings and r1 fixes; packaging confidence remains limited to source configuration and the scoped checks.
- Top risk: the new generic cap changes parser context and silently promotes hidden or fenced content into the answer.
- What a robust implementation would add: kind-aware cap/refusal with the two structured regressions, and retention metadata calculated from the final kept error set.
