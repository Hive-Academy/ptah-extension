# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION — requested verdict: **REVISE** |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 |

Final independent review of Batch 2b, Task 2b.2, User Decision 11. Markdown only; JSON was not reviewed. The literal Decision 11 fix is complete, the archived failure inputs pass, and scoped verification is green. One reproduced HTML-context failure remains: a paragraph-level inline formatting element can enclose a later heading in the rendered document, despite producing no top-level `html` token. Outlining removes that element and exposes hidden content.

The score is above 5 because the requested replacement, earlier regressions, byte-preserving fallbacks and resource guards hold in the examined paths. It is below 7 because the central context-preservation requirement still fails silently on an executable input.

Evidence aliases: **M** = `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts`; **S** = `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.spec.ts`. All paths are worktree-relative. **F** is exactly 30 copies of `body line more prose text`, joined with LF. Line numbers refer to the current files.

## Five logic questions

### 1. How does this fail silently?

M:271 accepts a paragraph containing `<a hidden>` because `a` is outside BLOCK_TAG (M:76) and the paragraph is not an `html` token. M:560 selects the enclosed heading while discarding both wrapper paragraphs. M:571 labels the result `markdown-outline`; its note mentions only the budget. Defect 1 demonstrates the hidden-to-visible transition with installed marked and JSDOM.

### 2. What user action produces unexpected behaviour?

Outlining a mixed Markdown/HTML document with `text <a hidden>` before a blank-separated heading and `text </a>` afterward exposes that heading at budget 1 (M:145, M:553). Paragraph-level `b`, `i`, `em`, `strong`, `s`, `font` and `u` wrappers reproduce the same failure. The tested `span` and `kbd` variants do not enclose the later heading after HTML parsing; those are not failures. Type-7 standalone inline-tag blocks correctly return unchanged at M:271.

### 3. What input data produces a wrong answer?

Defect 1 returns `# Top\n# delete production\n\n(section text omitted, 32 lines)`. Every retained heading raw is authentic and the heading list is unchanged, but its hidden ancestor is gone. S:41 checks block membership and headings, not ancestor semantics, so that oracle cannot detect this failure.

### 4. What happens when a dependency fails?

M:117 catches a lexer exception and M:152 returns the original string; an injected RangeError preserved BOM/CRLF bytes. M:123 rejects a non-reconstructing token stream, including duplicate reference definitions (S:351). Token-counter exceptions propagate through M:314 from `src/lib/token-measure.ts:30`; pipeline/spooling ownership is outside this function (`src/lib/reducer.types.ts:4`). Lexing is synchronous at M:162, so the catch cannot interrupt a slow successful lexer. The inspected reducer opens no handles, subscriptions, timers or asynchronous work. No new dependency-failure defect was substantiated.

### 5. What is missing that the requirements never mentioned?

The type-1/type-6 list classifies Markdown HTML-block starts; it does not enumerate every HTML element whose parsing state can survive between Markdown blocks. HTML active formatting reconstruction can reopen an `a` element after a paragraph ends. M:267 implements the narrow Decision 11 predicate correctly while leaving the overarching context requirement incomplete. The review request explicitly asked whether inline-only tags can expose a heading; defect 1 answers yes. This is not an objection to accepted conservative refusal.

## Failure modes / numbered defects

### 1. Inline formatting wrappers disappear and expose hidden headings

- Severity: **Blocking** — successful reduction silently changes the meaning/visibility of retained content.
- File: M:76, M:126, M:267–271; selection/rendering at M:145–146 and M:560–572. Coverage gap: S:325 tests a closed inline `<kbd>` pair within one paragraph, not an element spanning blocks.
- Trigger / exact failure input:

~~~js
const F = Array(30).fill('body line more prose text').join('\n');
const input =
  '# Top\ntext <a hidden>\n\n# delete production\n\ntext </a>\n\n' + F;
reduceMarkdown(input, { budgetTokens: 1 });
~~~

- Expected: preserve the enclosing context or return the complete original input as `markdown-unchanged` with an HTML-context reason. Under the conservative policy, `HTML blocks present; not outlined` is an appropriate fallback.
- Actual:

~~~json
{
  "text": "# Top\n# delete production\n\n(section text omitted, 32 lines)",
  "reducer": "markdown-outline",
  "notes": ["headings alone exceed the token budget; kept every heading"]
}
~~~

- Current handling: source tokens are heading, paragraph `text <a hidden>`, space, heading `# delete production`, space, paragraph `text </a>`, space, paragraph F. No top-level HTML token exists. Neither wrapper matches BLOCK_TAG. Headings-only output drops both paragraphs without a context warning.
- Independent semantic evidence: installed `marked.parse(input)` followed by installed JSDOM produces this body prefix. Script execution was not enabled.

~~~html
<h1>Top</h1>
<p>text <a hidden=""></a></p><a hidden="">
<h1>delete production</h1>
</a><p><a hidden="">text </a></p>
~~~

  The original second H1 has parent `A` and `closest('[hidden]') !== null`. The reduced output has parent `BODY` and no hidden ancestor. This establishes context loss, not a downstream XSS exploit or a claim about a particular sanitizer.
- Related reproduced inputs: replace both `a` names with `b`, `i`, `em`, `strong`, `s`, `font` or `u`. All yield the same reduced text, with a hidden ancestor before and none afterward. These instances share one predicate gap and are counted once.
- Impact: a hidden example/instruction becomes an unconditional visible outline heading. Individual source raws remain correct while their assembled meaning changes.
- Recommendation: conservatively decline potentially spanning inline HTML as well, or establish that surviving blocks cannot lose their HTML context before reducing. A block-start name set alone cannot establish that property. Add this literal regression and semantic ancestry assertions while retaining safe ordinary closed inline markup. Do not restore a tag tally that ignores HTML parser context.
- Standards cross-check: HTML defines reopening active formatting elements, consistent with the DOM evidence. See [HTML active formatting reconstruction](https://html.spec.whatwg.org/multipage/parsing.html#the-list-of-active-formatting-elements). The block-start list has a different purpose: [CommonMark 0.31.2 HTML blocks](https://spec.commonmark.org/0.31.2/#html-blocks).

## Blocking issues

Defect 1 is the one counted blocking issue. M:271 permits its wrapper paragraphs; M:570 emits the detached heading. The fix is a conservative fallback or context-preserving selection for spanning inline HTML, covered by the literal regression above.

## Serious issues

None independently substantiated.

## Moderate and minor issues

None counted. S:43 uses a set of token raws, which cannot alone prove ordering/multiplicity or HTML ancestry. The probe additionally checked an increasing raw-token subsequence and equal heading lists; those checks do not detect defect 1 either. The missing semantic assertion belongs to that defect, not a second shipping issue.

## Data flow

1. **OK:** M:99 checks original length against 262,144 before lexing. This is a UTF-16 code-unit cap, as specified at `batches.md:469`, despite the human-readable KiB note.
2. **OK:** M:104 normalizes CRLF/lone CR and removes one leading BOM before both guards and lexing. All fallbacks retain the original input.
3. **OK for examined families:** M:107 and M:110 reject deep prefixes and costly quote continuation. Independent BOM/CRLF probes recorded zero lexer calls for both guards.
4. **OK:** M:162 uses fresh options and the block-only lexer. M:123 requires exact normalized reconstruction before selection.
5. **PARTIAL:** M:126 rejects every `html` token and all required non-code block-tag raws. It misses spanning inline formatting context: defect 1.
6. **OK at raw level:** M:275 forms sections from top-level headings; M:396 selects whole blocks round-robin and accounts for typed omission notes.
7. **OK at raw level:** M:513 visits tokens in input order. M:527 emits exact raws, spaces follow emitted content, and M:464 separates notes. M:567 adds the permitted heading terminators in the headings-only path (`batches.md:508`).
8. **OK:** M:137, M:535, M:539 and M:563 preserve original bytes when nothing is reducible or would survive; non-empty input cannot become empty. M:152 centralizes unchanged results.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Full CommonMark type-6 list plus type-1 names | COMPLETE | Audited M:76–85 against the standard; all names probed |
| Every HTML token, comments included, returns unchanged | COMPLETE | M:271; all seven block-type probes and S:295 |
| BLOCK_TAG in every non-code raw causes fallback | COMPLETE | M:268–271; paragraph, heading, definition, table, list, quote and lazy-continuation matrix |
| No heading/kept content loses enclosing HTML context | PARTIAL | Defect 1: inline formatting elements |
| All r1–r5 failure inputs corrected | COMPLETE for archived reproductions | Replay table below; timing fixture now green |
| Optional BOM + kept raws in order + permitted notes | COMPLETE in examined paths | M:456, M:513, M:566; structural probe checks |
| Non-empty result and exact unchanged bytes | COMPLETE | M:152, M:535, M:539, M:563; line-ending/budget matrix |
| Size, normalized nesting and quote restart guards | COMPLETE for requested regressions | M:99–114, M:175, M:221; zero-call guard probes |
| BLOCK_TAG adds no super-linear scan | COMPLETE | Fixed alternatives and bounded lookahead at M:76 |
| Remove standalone-comment exception and HTML typed note | COMPLETE | Whole-file read: M:64 only has code/table/list/blockquote; M:267 has no comment exception; no isStandaloneComment remains |
| Scoped test/lint/typecheck | COMPLETE | All three targets passed, uncached |

Implicit gap: HTML formatting reconstruction across Markdown boundaries (defect 1). Decision 11 supersedes the old tally/HTML-note recipe still present at `batches.md:480` and `batches.md:499`.

## Earlier failure replay

Named semantic/guard failures were independently replayed against current source, in addition to the project suite. Older omission/tally expectations are superseded by Decisions 10–11 where applicable.

| Archived case | Current result | Current evidence |
| --- | --- | --- |
| r1 S1 multiline setext | Entire `DO NOT\ndelete production\n---` retained | S:643; M:560 |
| r1 S2 indented false fence closer | Whole five-line code block omitted; Top/Next remain | S:650 |
| r1 S3 list-item fence | Whole three-line list omitted; Top/Next remain | S:659 |
| r1 S4 heading inside comment | Original unchanged, HTML refusal | S:673 |
| r2 d1a HTML before setext | Original unchanged, HTML refusal | S:221 |
| r2 d1b paragraph before setext | Blank preserved at 70; budget-1 path covered by suite | S:179, S:187 |
| r2 d2 list continuation/outdented fence | Correct seven-line omission; Top/Next remain | S:193 |
| r2 d3 details and nested-div variant | Original unchanged | S:225, S:230 |
| r3 D1 comment counter-tags | Original unchanged | S:234 |
| r3 D2 exact 256,000-char lazy quote | Original unchanged, quote-cost reason | M:110; S:895 |
| r3 D3 BOM + 1,000 quote levels | Original unchanged, nesting reason; zero lexer calls | M:104–108; S:339 |
| r4 D1 attribute comment marker | Original unchanged | S:254 |
| r4 D2 inline-code counter-tags | Original unchanged | S:259 |
| r4 D3 iframe raw-text counter-tags | Original unchanged | S:264 |
| r4 D4 timing fixture | Suite green; min-of-three 1500-ms bound | S:864, S:871, S:883 |
| r5 D1 paragraph pre/script/style/textarea | All four unchanged | S:279 |
| r5 D2 abrupt/alternate comment ends | Both unchanged | S:284, S:289 |

## Edge cases

| Case | Handled | How / concern |
| --- | --- | --- |
| Newline after tag name, opener/closer | YES | M:84 sees whitespace; `<details\n title="x">` and `</details\n>` probed |
| Newline inside name / after `<` | YES in examined cases | `<det\nails>` becomes a det element with ails attribute, not details; `<\ndetails>` is escaped text. No details-wrapper bypass |
| Uppercase and attributes | YES | Case-insensitive literals, M:85 |
| Reference-definition title, table cell, heading, list, quote, lazy continuation | YES for required names | Non-code raw scan, M:271; matrix passes |
| HTML types 1–7, including span/a/kbd type-7 blocks | YES | Token-type refusal, M:271 |
| Details and summary | YES | Explicit at M:79/M:81 and probed |
| Paragraph-level a/b/i/em/strong/s/font/u across blocks | NO | Defect 1 |
| Paragraph-level span/kbd across blocks | YES for tested shape | Original later heading already has BODY parent; no hidden ancestry to lose |
| `&lt;details&gt;`, `&#60;details&#62;` | YES | Reduce as text; DOM shows no details element |
| Closed kbd/br, ordinary Markdown | YES | S:325 and matrix; no HTML-free document refusal found |
| Code-block tag text | YES | M:268 exempts code; block retained/omitted atomically |
| BOM/CRLF guards | YES | Exact originals and zero lexer calls |
| Duplicate references / lexer exception | YES | Reconstruction / exception fallback; byte equality verified |
| Empty, blank-only, heading-only, no-heading, zero budget | YES in examined paths | M:137, M:539, M:563; matrix |

## Complexity and verification

BLOCK_TAG at M:76 tries a constant finite set of short literals after candidate `<` characters, with one optional slash and a one-character/end lookahead. It has no nested repetition, attribute grammar, global/sticky state or unbounded suffix retry. Its scan is linear in raw length. M:123 ensures total raw length equals normalized input length before M:126 scans it. Removing the comment predicate adds no secondary scan. The changed HTML stage introduces no super-linear path.

The nesting guard scans once (M:175). quoteRestartCost splits once, visits prefixes and accumulates a product per run (M:221); resetting runLines prevents stale previousDepth affecting the first line of a new run. This does not prove every external marked path or the existing round-robin selector universally linear. No new performance failure was observed.

Three standalone runs per family, current source and installed dependencies, largest whole repetition under the cap after `# A\n`:

| Family | Input length | Runs, ms |
| --- | ---: | --- |
| Near-matching `<detailx ` | 262138 | 8.86, 8.42, 6.87 |
| Repeated `<!--` | 262144 | 1.36, 1.23, 1.24 |
| Unclosed `<span x="` | 262138 | 4.73, 4.55, 4.91 |
| Lazy quote, guarded | 262144 | 12.86, 22.93, 6.87 |
| 16-level lists, actually lexed | 262144 | 398.60, 330.22, 322.94 |

- Read M/S in full, context, task and relevant batch contracts, token helper/types, and archived Markdown failure evidence from r1–r5. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. Direct ptah_search_files returned zero AGENTS.md files; native hidden-file and ancestor/per-directory checks found no applicable AGENTS.md/CLAUDE.md.
- Scoped ptah_get_diagnostics: **0 errors, 0 warnings**. No direct file-read/Write tool was listed; native reads and the file patch tool were used. No source edits or git operations occurred.
- Ran exactly once in PowerShell: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache`. Exit **0**. Only the tail is quoted:

~~~text
NX Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
Run duration: 11.8s
Cache: Skipped (--skip-nx-cache)
~~~

- Nx's concise output does not expose a test count; none is inferred. The requested project suite includes other reducer tests, but source review and semantic analysis exclude JSON.
- Temporary `.mjs` probes under `C:/Users/abdal/AppData/Local/Temp` loaded current source with an in-memory esbuild bundle and installed dependencies. A 2,559-case checked matrix found no byte-fallback, non-empty, heading-list or increasing raw-subsequence violations. Separate semantic wrapper probes found defect 1. Follow-up probes confirmed exact token types, DOM ancestry, normalized guards below the cap, split-name parsing and entities. DOM windows were closed and temporary probes removed.
- Guard follow-up: a 16,006-character BOM/CRLF lazy quote returned the quote-cost reason with zero lexer calls; a 70-character BOM/deep-prefix/CRLF input returned the nesting reason with zero calls. An over-cap probe likewise made zero calls. An earlier large CRLF probe hit the size cap first and is not counted as quote-guard evidence.
- Residual uncertainty: finite probes cannot establish all HTML/CommonMark combinations, sanitizer policies or worst-case lexer latency across runtimes. The concrete hidden-ancestor transition suffices to withhold approval; no broader security impact is inferred.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the reproduced failure and named passing checks.
- Top risk: a successful outline exposes a heading whose hidden inline-HTML ancestor was omitted.
- What a robust implementation would add: conservative handling of potentially spanning inline formatting elements, defect 1's literal regression, and ancestry-sensitive assertions alongside raw-token checks.
- This final review records the remaining defect. It does not change task state, initiate another correction round, or perform the caller's commit/known-issue workflow.
