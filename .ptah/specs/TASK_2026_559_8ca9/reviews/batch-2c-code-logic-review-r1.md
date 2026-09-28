# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Independent Batch 2c review, 2026-09-25. No source edits or git operations.

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 4 |
| Serious issues | 2 |
| Moderate issues | 2 |
| Failure modes found | 8 |

Browser-differential probes demonstrate hidden-content promotion and silent meaning loss; table rendering has quadratic expansion. These findings separate the score from the 5–6 band. Real implementations, conservative refusal paths and passing scoped checks separate it from 1–2. Future raw spooling makes originals recoverable but cannot make a misleading extracted answer correct.

Path aliases below: **H** = `libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts`; **L** = the adjacent `log.reducer.ts`. All paths are relative to this worktree.

## Verification and scope

Read both complete implementations and specs, barrel, JSON/Markdown sibling implementations, reducer types, token-measure, project configuration, context.md, task.md and the relevant amendment, risks, Batch 2c and KI-2b-1 sections of batches.md. The discovered task folder has no task-description.md, implementation-plan.md or code-style-review.md. Ptah file search found no AGENTS.md; native checks found no applicable instruction file. No file-read or Write tool was listed, so native reads and the apply_patch file tool were used.

Scoped ptah_get_diagnostics: TypeScript compiler, **0 errors, 0 warnings**.

Ran once:
`node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache`

Relevant tail:

```text
√ nx run @ptah-extension/tool-output-reducers:lint
√ nx run @ptah-extension/tool-output-reducers:typecheck
√ nx run @ptah-extension/tool-output-reducers:test
NX Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
Run duration: 16.4s
Cache: Skipped (--skip-nx-cache)
```

Independent probes bundled the actual source with installed esbuild and compared HTML parsing/inline computed styles with installed JSDOM. JSDOM was verification-only; no new dependency was installed. Temporary .mjs scripts and bundle were under C:/Users/abdal/AppData/Local/Temp and removed afterward. No layout inference depends on JSDOM: script ancestry, attribute consumption and computed display suffice. No git comparison was performed, as instructed; dependency evidence is reviewed imports and package resolution, not verification of the entire package.json diff.

## Five logic questions

### 1. How does this fail silently?

H:427 and H:460 can promote non-rendered script/styled content into successful html-extract output (D2/D4). H:1030 drops a unit-bearing table caption without noting the loss (D5).

### 2. What user action produces unexpected behaviour?

Reading a captioned table loses its units (H:1014, D5); extracting a page with overridden inline display loses visible text (H:460, D4). Reducing a dense log drops promised context and summary (L:181, L:192, D1).

### 3. What input data produces a wrong answer?

Script double-escaped markup, quoted end-tag attributes, encoded/commented CSS, captioned tables, trailing preformatted whitespace and isolated headings. D2–D5/D7–D8 contain literal inputs and expected versus actual output (H:334, H:427, H:460, H:764, H:972, H:1030).

### 4. What happens when a dependency fails?

HTML has no runtime parsing dependency and catches extraction failures, returning original input and reason (H:179–197). Log tokenization errors are not caught locally (L:358–369); pipeline failure handling is deferred to Batch 2e. token-measure.ts:15 disables special-token rejection. Table expansion precedes the recovery/shrink check (H:1039–1042); catch cannot guarantee recovery from heap exhaustion.

### 5. What is missing that the requirements never mentioned?

CSS declaration semantics, script escaped states, output-work bounds, table captions, semantic roots and trailing preformatted whitespace all affect the visible-content contract (H:460, H:427, H:1039, H:764, H:972). aria-hidden is unspecified and not read (H:106); keeping its visually rendered text is defensible because aria-hidden alone does not hide pixels. Accessibility-tree extraction would need a separate policy.

## Failure modes — Log

### D1. Serious — Required context and final summary are discarded

- File: L:177–201; L:254.
- Trigger/failure input: `reduceLog('Error: boom\n    at fn (a.ts:1:1)\n' + Array.from({length:100}, (_,i) => 'item '+i).join('\n') + '\nRan all test suites.', {budgetTokens:10})`.
- Expected: retain the promised context and summary, or explicitly amend the preservation contract and coordinate the final cut. batches.md:635 requires head 40, tail 80 and ±3 context.
- Actual: `Error: boom\n    at fn (a.ts:1:1)\n… 101 lines omitted …`.
- Impact: assertion detail and completion context disappear. Gaps disclose omission, so this is Serious rather than a silent success reversal.
- Default-budget reproduction: 200 distinct lines `0 errors, 0 failures run ${i}`, then `Ran all test suites.`, budget 2000. All benign lines match L:76; summary becomes `… 1 line omitted …`.
- Current handling: only matched error groups are forced; context/tail/head compete for remaining budget. The existing low-budget spec explicitly expects the final summary to disappear.
- Fix: preserve the stated required set and test the pipeline cut, or obtain an explicit contract amendment. Reserve summary/context; do not call retention unconditional.

Other log checks:

- Conventional Jest FAIL, tsc error TS2345, Python AssertionError and indented JS/Java/Python frames survive via L:75–78/L:179. A matched error or first frame cannot be budget-dropped by this reducer.
- False positives include `0 errors, 0 failures`, substrings containing fail, and indented prose beginning at. False negatives include pytest detail `E       assert 1 == 2`, ESLint warning rows and Nx success summaries. Probes show these are only optional context/tail candidates (L:76–78); long assertion bodies are not independently protected. This supports D1, not additional counted findings.
- Dedupe uses strict equality of complete post-ANSI lines (L:153), so differing/alternating lines do not merge. Counts remain explicit (L:164), including repeated errors. Existing literal count-like suffixes are not overwritten.
- CRLF terminators normalize only on reduced output (L:139); unchanged paths return original input (L:125). Empty/ANSI-only/no-fit/no-change paths preserve input (L:91–109). Whitespace-only input may remain whitespace-only on identity; the relevant safety guarantee is not dropping actual content to empty.

## Failure modes — HTML

### D2. Blocking — Script double-escaped content becomes visible Markdown

- File: H:382–387; H:427–445.
- Failure input: `<main><p>shown</p><script><!--<script></script><h1>SECRET</h1>--></script></main>`.
- Expected: `shown` or unchanged refusal. JSDOM keeps the apparent H1 inside script text.
- Actual: `shown\n\n# SECRET\n\n-->`, html-extract.
- Impact: non-rendered data becomes a visible heading/instruction, the semantic exposure class of KI-2b-1. This is not an XSS claim.
- Current handling: the first matching script end-tag string closes raw text, ignoring escaped/double-escaped script states.
- Fix: model these tokenizer states or refuse ambiguous script bodies; add ancestry-sensitive regressions.

### D3. Blocking — Quoted end-tag attributes become invented content

- File: H:334–341, especially H:336.
- Failure input: `<main><p>shown</p><div hidden>x</div title=">SECRET"><p>after</p></main>`.
- Expected: `shown\n\nafter`. JSDOM consumes the full end tag including its ignored attribute.
- Actual: `shown\n\nSECRET">\n\nafter`, html-extract.
- Impact: attribute bytes that were never visible become visible model input.
- Current handling: the first > inside a quote closes the hidden div, and the remaining attribute value becomes text.
- Fix: use quote-aware end-tag scanning or refuse such end tags, retaining forward-only scanning.

### D4. Blocking — Visibility checks ignore decoded CSS declaration semantics

- File: H:367–371 stores raw values; H:452–461 uses whitespace-stripped substring matching.
- Failure input A: `<main><p>shown</p><div style="display&#58;none">SECRET</div></main>`.
- Failure input B: `<main><p>shown</p><div style="display:/**/none">SECRET</div></main>`.
- Expected A/B: shown only. Actual A/B: `shown\n\nSECRET`. JSDOM computed display is none for both.
- Failure input C: `<main><p>shown</p><div style="display:none;display:block">VISIBLE</div></main>`.
- Expected C: include VISIBLE, computed display block. Actual C: shown only.
- Impact: both hidden-content promotion and visible-content loss occur on inline styles, which the implementation explicitly claims to handle.
- Current handling: any literal matching substring is treated as effective CSS; entities, comments and declaration precedence are ignored.
- Fix: decode attributes and parse bounded declarations with comment/priority/order handling; refuse unsupported ambiguous styles conservatively. Do not add a dependency without approval.

### D5. Blocking — Table captions carrying units are silently dropped

- File: H:1014–1037, especially H:1030.
- Failure input: `<main><table><caption>Amounts in thousands</caption><tr><th>USD</th></tr><tr><td>5</td></tr></table></main>`.
- Expected: preserve Amounts in thousands beside the table.
- Actual: `| USD |\n| --- |\n| 5 |`, no caption or omission warning.
- Impact: an agent can interpret five thousand dollars as five dollars.
- Current handling: collector only traverses rows and table sections.
- Fix: render captions adjacent to tables; preserve or explicitly refuse meaningful table content that cannot be represented.

### D6. Serious — Ragged tables expand quadratically before refusal

- File: H:1039–1042; late size check H:218.
- Failure recipe:
  `s='<main><table><tr>'+'<td>x</td>'.repeat(n)+'</tr>'+'<tr><td>y</td></tr>'.repeat(n)+'</table></main>'; s+='<!--'+'x'.repeat(2097152-s.length-7)+'-->'; reduceHtml(s,{budgetTokens:2000})`.
- Expected: bounded linear work at the 2 MiB cap; refuse before huge expansion.
- Actual: n=1000: 74 ms; n=2000: 291 ms; n=4000: 1069 ms; n=6000: **2711 ms**. All return original input only after oversized output construction.
- Impact: synchronous host stall and memory pressure. n=6000 creates about 36 million cell slots and over 100 MB of table text; substantially larger shapes still fit under the input cap.
- Current handling: every row is padded to maximum width; shrink check runs after allocation.
- Fix: bound projected output/cell count before allocating, render sparse rows or refuse disproportionate padding, and add this regression to performance guards.

### D7. Moderate — Preformatted trailing whitespace is removed

- File: H:971–982, especially trimEnd at H:972.
- Failure input: `<main><p>shown</p><pre>first\nlast  \n\n</pre></main>`.
- Expected: preserve trailing spaces on last and both terminal newlines inside the fence.
- Actual: fenced body becomes `first\nlast\n`.
- Impact: whitespace-sensitive fixtures/code change, contrary to intact-pre requirement (batches.md:648).
- Current handling: trims entire pre body.
- Fix: retain trailing whitespace; only the HTML-defined initial newline removal and documented line-ending normalization should apply.

### D8. Moderate — A density-selected heading loses heading semantics

- File: H:710–729 selects any element; H:102/H:764 render children for roots outside SELF_RENDERED_ROOTS.
- Failure input: `<h1>Only heading</h1>`.
- Expected: `# Only heading`.
- Actual: `Only heading`, note densest block <h1>.
- Impact: requested h1–h6 conversion depends on surrounding markup; isolated content loses structure.
- Current handling: root heading bypasses renderElement.
- Fix: render semantic roots through renderNode, or restrict density descent to neutral containers. Test standalone roots, not only children.

## Blocking issues

D2 (H:427), D3 (H:336), D4 (H:460), D5 (H:1030). Each trigger, impact and fix is specified above.

## Serious issues

D1 (L:181/L:192): required context/tail loss. D6 (H:1041): quadratic allocation exceeds 1500 ms.

## Moderate and minor issues

D7 (H:972): pre whitespace loss. D8 (H:764): root semantics lost. No extra score penalty for style or line count.

## Developer deviation judgments

1. **Conditional log head/tail is not accepted as satisfying the current contract.** D1 proves material drift. Collapsing identical error lines also differs from non-error-only wording at batches.md:635, but L:153–164 retains text/count; a defensible explicit amendment, not a separately demonstrated loss.
2. **HTML guard/selection direction is reasonable; correctness needs revision.** The KI-2b-1 wrapper refusal works in tested shapes (H:623–645), but does not cover D2–D4. Keeping article-local headers/footers protects titles (H:470). Whole-visible-page fallback (H:695) intentionally retains navigation if stripping loses most text: a conservative tradeoff. Size/depth refusals (H:180/H:569) preserve input. The size guard measures UTF-16 units, not UTF-8 bytes. Not trimming to budget matches the later pipeline cut (batches.md:234–236), but output work must still be bounded (D6).
3. **Duplicated bounded token counting is acceptable for this batch.** L:358 and markdown.reducer.ts:309 use bounded pieces/early exit; they are not identical: Markdown seeks word boundaries, log uses fixed pieces. No separate defect established. A future shared primitive needs an explicit bounded-count contract; final exact caps belong to the pipeline.
4. **One nameable parser collaborator is warranted.** H:235–648 is an HTML scanner/tree-builder responsibility, distinct from selection H:654–752 and rendering H:758 onward. Extract an internal HtmlTreeParser while keeping reduceHtml and its export. Give it DOM-differential tests. The reason is the concentrated parsing failure cluster, not merely the reported 831 code lines/700 warning. No need for several small helpers or public API changes. Refactoring alone does not fix these defects.

## Data flow

1. src/index.ts:12–13 exports both reducers — OK for this library; Batch 2e wiring is outside scope.
2. L:94–100 strips ANSI and groups exact equal lines — OK, explicit counts.
3. L:177–201 selects forced errors then budgeted context/tail/head — D1.
4. L:324–351 emits groups in order and explicit omission counts — OK for tested formats.
5. H:179–207 guards size and constructs tree — refusal paths work, D2–D4 corrupt content/visibility boundaries.
6. H:665–729 measures/selects roots — density heuristic; D8 bypass downstream.
7. H:758–1069 renders Markdown — D5 caption loss, D6 expansion, D7 pre loss.
8. H:210–219 returns original for empty/nonshrinking extraction — identity preserved, but too late for allocation safety.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Pure deterministic reducers, no LLM/new parsing dependency | COMPLETE within reviewed files | H imports types; L uses existing token helper |
| Log repeats, ANSI stripping, ordered verbatim lines | COMPLETE for tested formats | Error-run collapse differs from non-error-only wording |
| Errors + context + unconditional head/tail | PARTIAL | D1 |
| Generated Jest fixture preserves failures/first frames | COMPLETE | Scoped tests pass; not unconditional retention proof |
| Remove hidden/non-rendered HTML | PARTIAL | D2–D4 |
| Main-content and boilerplate selection | PARTIAL | Conservative fallback; D4 can drop visible text |
| Markdown heading/table/pre representation | PARTIAL | D5, D7, D8 |
| Common entity decoding | PARTIAL | Basic text entities work; CSS attribute decoding does not (D4) |
| Malformed HTML never throws | COMPLETE for executed probes | H:185 catches; cannot promise recovery from OOM |
| Linear bounded processing | PARTIAL | D6 |
| Raw spool/final cap | OUTSIDE THIS BATCH | Deferred to 2e, not claimed implemented |

Implicit requirements unaddressed: accurate inline style/script states, bounded expansion, units/captions, semantic roots and significant pre whitespace.

## Edge cases

Independent single-run times, approximately/exactly 2 MiB in UTF-16 units; suite performance tests separately use best-of-three.

| Case | Handled | How/evidence | Concern |
| --- | --- | --- | --- |
| Huge HTML text | YES | 8 ms | Final budget deferred |
| Many < characters | YES | 213 ms, unchanged | No elements |
| Unclosed paragraphs | YES | 591 ms | Many shallow nodes |
| Deep unclosed divs | YES | 1 ms, depth refusal | H:569 |
| Unterminated quoted attribute | YES | 1 ms, unchanged | EOF consumed |
| Long unterminated comment | YES | 39 ms | No exception |
| Foreign CDATA opener runs | YES | 1 ms, unchanged | No leakage in probe |
| Huge log line | YES | 10 ms, unchanged | Bounded count |
| Alternating short log lines | YES | 192 ms | No incorrect dedupe |
| Ragged 6000-column table | NO | **2711 ms** | D6 |
| Script escaped states/end-tag quotes | NO | JSDOM mismatch | D2/D3 |
| Inline style variations | NO | Computed display mismatch | D4 |
| aria-hidden alone | YES for visual policy | Text retained | Accessibility policy unspecified |
| Hidden active-formatting wrapper | YES in tested KI shape | H:644 refusal + existing spec | Not exhaustive parser proof |
| Repeated/concurrent calls | YES by construction | Per-call state H:201/L:176 | No timers, subscriptions or external writes |

No other independently timed shape exceeded 1500 ms. These are adversarial samples, not exhaustive browser conformance.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for reproduced findings; MEDIUM for remaining HTML semantics.
- Top risk: successful extraction promotes non-rendered data into visible model instructions.
- What a robust implementation would add: quote/escaped-state parser guards, decoded ordered styles, caption/pre/root preservation, pre-allocation output bounds, and explicit log retention carried through the final pipeline cut.
