# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 2 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 2 |

Independent review of Batch 2b, Task 2b.2, User Decision 10. Markdown only; the JSON reducer was not reviewed. Both requested uncached test/lint/typecheck runs passed. All archived r1–r4 failure inputs now behave correctly under Decision 10. Two new, independently reproduced HTML-context failures remain.

Score 5 rather than 3–4: the lexer, original-byte fallback, prior regressions and resource guards work in the examined cases. Below 7–8: successful outlining can still expose a heading after removing its HTML context, the central safety property under review.

Evidence aliases: **M** = `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts`; **S** = `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.spec.ts`. Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. **F** means exactly 30 copies of `body line more prose text`, joined by LF. All failure inputs below use JavaScript string notation and budget 1.

## Five logic questions

### 1. How does this fail silently?

M:76 omits structural/raw-text tag names, and M:277 recognizes a comment by only its first literal `-->` after position 4. Either can let M:559 emit an inner heading alone with the success-looking `markdown-outline` result. The two numbered defects include original and reduced DOM evidence.

### 2. What user action produces unexpected behaviour?

Outlining text with a paragraph-level `<pre>` opener removes the preformatted wrapper (M:268, M:271). Outlining a comment-shaped HTML block containing an abruptly terminated comment followed by `<span hidden>` exposes the hidden heading (M:275). Ordinary comment, entity, inline `<kbd>/<br>`, and plain Markdown probes still reduce; accepted conservative refusal is not counted as a defect.

### 3. What input data produces a wrong answer?

The exact inputs in defects 1 and 2 both return `# Top\n# delete production\n\n(section text omitted, 32 lines)`. That text satisfies raw-token membership and heading-order checks while losing semantic context (M:566, S:41). The issue is not altered source text; it is omission of a wrapper that determines how that text is interpreted.

### 4. What happens when a dependency fails?

Lexer exceptions return the original input with the error name (M:114); an injected RangeError preserved a BOM and CRLF exactly. Reconstruction mismatch returns original bytes (M:121); duplicate references are covered at S:320. Token-counter exceptions are not caught here (M:319; `src/lib/token-measure.ts:30`); pipeline ownership is specified in `src/lib/reducer.types.ts:5`. No I/O, timers or disposable handles are opened by the reducer. Synchronous lexer work cannot be interrupted by the catch; finite cost probes do not prove all lexer paths bounded.

### 5. What is missing that the requirements never mentioned?

The named full CommonMark tag set must include names omitted from the old tally's non-void list, and block detection needs the type-1 names when they appear inside other token raws (M:76). A lexer `html` token ending in `-->` is not evidence that its entire raw is one standalone comment in an HTML parser (M:277). The new failures pass the existing structural oracle (S:41); wrapper ancestry requires a separate semantic assertion.

## Failure modes / numbered defects

### 1. Incomplete block-tag set allows raw-text and preformatted wrappers to disappear

- Severity: **Blocking** — silent misleading context loss.
- File: M:76–84, M:268–271; output at M:559–578. Existing block-script fixture S:273 does not exercise a script opener inside a paragraph.
- Failure input:

~~~js
'# Top\ntext <pre>\n\n# delete production\n\ntext </pre>\n\n' + F
~~~

- Expected: original input, `markdown-unchanged`, note `HTML blocks present; not outlined`.
- Actual: `markdown-outline`, text `'# Top\n# delete production\n\n(section text omitted, 32 lines)'`; note `headings alone exceed the token budget; kept every heading`.
- Current handling: both tags are in paragraph raws, not top-level `html` tokens. `pre` is absent from BLOCK_TAG, so neither branch rejects them. Installed marked plus JSDOM showed the original `delete production` H1 under PRE and the reduced H1 directly under BODY.
- Related reproduced inputs: replace both `pre` names with `script`, `style`, or `textarea`. All produce the same outline. The original DOM has only the Top H1 because the inner heading markup is raw-text/RCDATA content; the outline creates a visible second H1. Script execution was disabled in JSDOM; this is a parsing/context result, not an execution claim.
- Full-list audit: the type-6 set also omits `base`, `basefont`, `col`, `frame`, `hr`, `link`, `param`, and `track`. Paragraph probes of all eight reduce instead of taking Decision 10's fallback. These void-element omissions are additional instances of this same incomplete-set cause, not eight invented wrapper-loss defects. Type-1 names `pre`, `script`, `style`, `textarea` are a separate category from the type-6 list. Both categories are specified in [CommonMark 0.31.2 HTML blocks](https://spec.commonmark.org/0.31.2/#html-blocks).
- Impact: a preformatted example or raw-text content becomes an unconditional outline heading. The complete type-6 refusal contract is also unmet.
- Recommendation: use the complete type-6 set plus the type-1 structural/raw-text names for non-code raw scanning. Keep the existing all-non-comment-HTML-token fallback. Add independent paragraph, heading, reference and nested-token regressions so a top-level `html` token cannot mask a missing regex name. Do not restore a tally.

### 2. A supposed standalone comment can contain a live hidden wrapper

- Severity: **Blocking** — silent promotion of hidden contextual content.
- File: M:275–277, M:271; output at M:559–578. Standalone-comment coverage at S:287 tests only a conventional comment.
- Failure input:

~~~js
'# Top\n<!--><span hidden> -->\n\n# delete production\n\ntext </span>\n\n' + F
~~~

- Expected: original input, `markdown-unchanged`, note `HTML blocks present; not outlined`. This HTML token contains a closed comment followed by live HTML; it is not one standalone comment.
- Actual: the same `markdown-outline` text and headings-only note as defect 1. Installed marked emits one `html` raw `<!--><span hidden> -->`; M:277 returns true. The original DOM's inner H1 has a SPAN parent and `closest('[hidden]') !== null`; the reduced H1 has BODY parent and no hidden ancestor.
- Second independently reproduced variant: replace `<!--><span hidden> -->` with `<!-- --!><span hidden> -->`. It has the same result and hidden-to-visible transition.
- Current handling: scanning starts at offset 4 and looks only for `-->`, ignoring `<!-->` / `<!--->` abrupt closure and the `--!>` end form. The remaining `<span hidden>` is outside the real comment, but M:268 does not catch inline-only `span`. Completing the block-tag list in defect 1 does not fix this case.
- Parser evidence: HTML parsing closes empty comments on the abrupt forms and treats `--!>` as a comment terminator despite the parse error. See [HTML comment start state](https://html.spec.whatwg.org/multipage/parsing.html#comment-start-state) and [comment end bang state](https://html.spec.whatwg.org/multipage/parsing.html#comment-end-bang-state). Both behaviours were independently confirmed with the installed DOM parser.
- Impact: text originally under a hidden wrapper is exposed as an ordinary heading. This is a false negative, not the broader refusal accepted by the user.
- Recommendation: accept only a conservatively validated single comment whose terminators cannot expose trailing HTML; decline malformed/ambiguous comment raws before outlining. Preserve ordinary `<!-- prettier-ignore -->` and `<!---->`. Add both literal regressions with wrapper-ancestry checks.

## Blocking issues

Defects 1 and 2 above are the two counted blocking issues. The first requires a complete raw tag set; the second requires a sound standalone-comment predicate. Both have executable failure inputs, exact output and demonstrated context loss.

## Serious issues

None independently substantiated in this review.

## Moderate and minor issues

No additional counted defects. Coverage limitation: S:43 uses a set of raws and does not prove multiplicity, ordering or HTML ancestry. The disposable probe additionally checked an increasing raw-token subsequence and heading lists; those checks still passed the two semantic failures. This is evidence for adding semantic regressions, not a separate shipping failure.

## Data flow

1. **OK:** M:96 checks the original string length against 262,144 before any lexer work. This is UTF-16 code units, as explicitly specified by `batches.md:469`, despite the human-readable KiB label.
2. **OK:** M:101 normalizes CRLF/lone CR and strips one leading BOM before both guards and lexing. Original input remains available for every fallback.
3. **OK for demonstrated guard families:** M:104 and M:107 stop deep prefixes and expensive quote restarts before M:115 enters the lexer. BOM/deep-prefix and BOM/CRLF/lazy-quote probes recorded zero lexer calls.
4. **OK:** M:158 creates fresh Lexer options and calls the block pass only. M:121 requires exact normalized reconstruction before selecting anything; consumed/dropped definition raws cannot silently disappear.
5. **GAP:** M:124 applies HTML refusal before outlining, but M:76 and M:277 admit the two failure classes above.
6. **OK at raw-token level:** M:280 splits on top-level headings; M:402 chooses whole body blocks round-robin. Typed omissions and exhausted sections do not split a raw.
7. **OK at raw-token level:** M:519 visits original tokens in order; spaces follow the preceding emitted token. M:470 separates notes; M:559 applies the authorized headings-only terminators. M:541, M:545 and M:569 return original bytes when nothing was omitted or nothing survives. Semantic HTML context remains the gap in step 5.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| All earlier r1/r2/r3/r4 failure inputs | COMPLETE | Archived inputs independently replayed; details below |
| Decline block HTML in any non-code top-level raw | PARTIAL | Defect 1; M:76, M:268 |
| Decline every non-standalone-comment html token | PARTIAL | Defect 2; M:277 |
| Complete CommonMark block-element list | PARTIAL | Eight type-6 names and four type-1 names absent |
| Inline-only tags and ordinary standalone comments reduce | COMPLETE for requested examples | S:287, S:294; independent probes |
| Optional BOM + verbatim retained raws in order + notes | COMPLETE in examined paths | M:462, M:519, M:572; monotonic-raw probe |
| Non-empty input never becomes empty | COMPLETE in examined paths | M:133, M:545, M:569; S:418 |
| Unchanged paths preserve original bytes | COMPLETE | M:150; injected failure, guards and CRLF checks |
| Size, normalized nesting and quote-cost guards intact | COMPLETE for specified regressions | M:96–112; S:304, S:341, S:871 |
| Removed tally leaves no dead implementation | COMPLETE within M | Whole-file inspection and search; M:264 replaces it |
| Min of 3, MAX_CAP_MS 1500, two green scoped runs | COMPLETE | S:838–854; both commands exited 0 |
| No new super-linear HTML scan | COMPLETE for changed predicates | Constant-size regex alternatives and one comment search; analysis below |

Implicit requirements not addressed: comment tokenization and HTML parser recovery can differ; raw identity alone does not preserve wrapper semantics.

## Earlier regression results

All following archived failure inputs were independently executed against current source, in addition to the scoped suite:

| Earlier input | Observed result / current evidence |
| --- | --- |
| r1 S1 multiline setext | Full `DO NOT\ndelete production\n---` retained, one-line omission note; S:612 |
| r1 S2 indented false fence closer | Whole five-line code block omitted, Top and Next retained; S:619 |
| r1 S3 fence on list-item line | Whole three-line list omitted, Top and Next retained; S:628 |
| r1 S4 heading within comment | `# Top\n\n(33 lines omitted)\n\n# Next\nnext`; no promotion; S:642 |
| r2 d1a HTML before setext | Original unchanged with new HTML refusal note; S:221 |
| r2 d1b paragraph before setext | Blank separator preserved at budget 70; headings-only at 1 passes suite; S:179, S:187 |
| r2 d2 list continuation/outdented fence | Exact seven-line omission and correct Next heading; S:193 |
| r2 d3 details and nested-div variant | Original unchanged; S:225, S:230 |
| r3 D1 comment counter-tags | Original unchanged with HTML refusal; S:234 |
| r3 D2 exact 256,000-character lazy quote | Original unchanged with quote-cost reason; M:107, S:872 |
| r3 D3 BOM plus 1,000 quote levels | Original unchanged with nesting reason; zero lexer calls; S:306 |
| r4 D1 attribute comment marker | Original unchanged; S:254 |
| r4 D2 inline-code counter-tags | Original unchanged; S:259 |
| r4 D3 iframe raw-text counter-tags | Original unchanged; S:264 |
| r4 D4 timing failure | Both new uncached suites green; min-of-three fixture at S:845 |

The new Decision 10 HTML refusal supersedes the older reviews' tally-specific note and d1a outline expectation; this is intentional, not a regression.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| `<details\n>` and `</details\n>` | YES | Separate opener-only and closer-only probes return original; M:82 |
| Uppercase, attributes, newline within quoted attribute | YES for included tag names | Case-insensitive prefix match does not parse attributes; M:78–83 |
| Tag in link-reference definition | YES for included names | `def.raw` is scanned; independent probe and M:268 |
| Heading/setext raw, table cell, list/blockquote raw, lazy continuation | YES for included names | Independent isolated probes all return original; M:264 |
| HTML token types 1, 3, 4, 5, 6, 7 | YES | Non-comment html fallback; type-1 paragraph/nested raws remain defect 1 |
| Type-2 ordinary and empty comment | YES | `<!-- prettier-ignore -->` and `<!---->` reduce; M:277 |
| Comment followed by trailing text / second comment | YES | First `-->` is not final after trim; original returned |
| Comment with alternate early ending | NO | Defect 2 |
| Entities `&lt;details&gt;`, `&#60;details&#62;` | YES | Reduce as text; DOM probes find no wrapper |
| Inline `<kbd>/<br>` and code-block tags | YES | S:294; code tokens exempt at M:265; independent probes |
| BOM/CRLF before deep prefixes or lazy quotes | YES | Guard input matches lexer input; zero lexer calls |
| Duplicate references / lexer exception | YES | Reconstruction fallback / injected RangeError; original bytes |
| Empty, blank-only, no-heading, zero/negative/non-finite room | YES in inspected control flow | No body or no surviving content returns original; M:133, M:143, M:569. Empty input remains empty as permitted |

## Complexity and timing

BLOCK_TAG (M:76) is linear in raw length: at each candidate position it tries a fixed finite set of short literals, one optional slash and a one-character/end lookahead. There is no repeated attribute grammar or nested repetition. The regex has no global/sticky state. `trim` and one fixed-string `indexOf` at M:276–277 are linear. Total examined raw length is constrained by reconstruction at M:121, so the new HTML stage introduces no super-linear path. Its defects are correctness failures.

Nesting scans once (M:173); quoteRestartCost splits into lines and scans each prefix once, accumulating a product per run (M:219). Resetting runLines prevents stale previousDepth from adding a restart on the first line of a fresh run. The remaining block lexer is an external synchronous dependency; these observations do not prove every lexer or selection workload linear.

Disposable probes at or near the cap measured three runs per family on Node v24.15.0:

| Family | Length | Runs, ms |
| --- | ---: | --- |
| Repeated near-matching tags | 262,084 | 22.32, 17.78, 12.49 |
| Repeated unclosed comments | 262,104 | 2.45, 2.07, 2.51 |
| Repeated unclosed attributes | 262,024 | 8.42, 6.49, 6.83 |
| Lazy quotes, guarded | 262,144 | 13.76, 21.10, 8.98 |
| 16-level lists, actually lexed | 262,144 | 534.78, 560.94, 408.56 |

No new timing defect was observed. S:845 measures three unspied reductions, retaining the minimum elapsed value; S:864 and S:892 validate results outside that timing. Earlier single-run 250 ms fixtures remain at S:817 and passed both required runs.

## Verification and scope

- Read M and S in full, reducer types and token measurement, task/context/batch requirements, and the archived r1–r4 defect evidence. The task folder contains no task-description.md, implementation-plan.md or code-style-review.md. Decision 10 takes precedence over the superseded Rule H recipe still present at batches.md:480.
- Direct `ptah_search_files` returned zero AGENTS.md files. Native hidden-file discovery and ancestor/per-directory checks found no applicable AGENTS.md/CLAUDE.md. No direct read/Write tool was listed; native reads and the file patch tool were used. No source was edited and no git operation was run.
- Scoped `ptah_get_diagnostics`: **0 errors, 0 warnings**.
- Ran the exact PowerShell command twice: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache`. Both exited **0**, all three targets green. Only tails quoted:

~~~text
Run 1:
NX Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
Run duration: 12.9s
Cache: Skipped (--skip-nx-cache)

Run 2:
NX Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
Run duration: 14.8s
Cache: Skipped (--skip-nx-cache)
~~~

- Nx's concise output did not expose a test count; none is inferred. Passing project verification includes the existing project suite, but this review's source/semantic analysis excludes JSON.
- Temporary `.mjs` probes under `C:/Users/abdal/AppData/Local/Temp` loaded an in-memory esbuild bundle of the current source and installed dependencies. The large probe made 258 reductions with unchanged-byte, non-empty, heading-list and increasing raw-subsequence checks; it found no failures of those structural checks, including on the two semantic failures. Follow-up probes isolated wrapper ancestry and individual boundary cases. JSDOM windows were closed; script execution was not enabled. Temporary probes and logs were removed after use.
- Residual uncertainty: finite probes cannot certify every HTML/CommonMark combination, all renderer sanitization policies, every runtime distribution or worst-case lexer cost. DOM evidence establishes the specific context changes, not a downstream XSS claim. The two confirmed failures suffice to reject this logic as complete.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the two reproduced context-loss failures.
- Top risk: a successful Markdown outline still presents an enclosed or hidden heading after deleting the HTML that qualifies it.
- What a robust implementation would add: complete structural/raw-text tag coverage, a conservative standalone-comment validator, and literal semantic regressions for both defects while retaining the passing resource guards and timing method.
- This review does not authorize another correction round or alter task state.
