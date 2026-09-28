# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 2c r2 re-review, 2026-09-25. All eight r1 literal regressions now pass. Revision is still required: the new script guard performs quadratic scans, the CSS whitelist discards valid visibility overrides, and depth flattening changes literal code into active Markdown/HTML.

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 2 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Failure modes found | 5 new |

The score is above the 3–4 band because the original eight failures are repaired with regressions and functional refusal paths. It is below 7–8 because independent probes still demonstrate semantic corruption and a synchronous multi-second stall. Passing checks do not exercise the new failure inputs below.

Path aliases: **H** = `libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts`; **T** = `libs/backend/tool-output-reducers/src/lib/reducers/html-tree.ts`; **L** = `libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.ts`. All citations use current worktree line numbers. No production source or task state was changed; no git operation was run.

## Scope and verification

Read the complete current H, T, L and both reducer specs, the barrel, current context and relevant batch contract, and r1 archive. Sibling reducers/types/token measurement were read in r1 and retained as comparison context. Task-folder discovery again found no task-description.md, implementation-plan.md or code-style-review.md. The previous instruction-file search found no applicable AGENTS.md. No Ptah file-read or Write tool is listed, so native reads and the apply_patch file tool were used.

Scoped ptah_get_diagnostics on H/T/L: **0 errors, 0 warnings**.

Ran the requested command exactly once:

`node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache`

Relevant tail:

```text
√ nx run @ptah-extension/tool-output-reducers:lint
√ nx run @ptah-extension/tool-output-reducers:typecheck
√ nx run @ptah-extension/tool-output-reducers:test
NX Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
Run duration: 21.8s
Cache: Skipped (--skip-nx-cache)
```

Independent probes bundled current TypeScript with installed esbuild, used installed JSDOM for tree/inline-style comparisons, and used installed marked plus JSDOM for the nesting output. No package was installed. Temporary .mjs scripts and bundle were placed under C:/Users/abdal/AppData/Local/Temp and deleted after use. JSDOM's incomplete variable/shorthand resolution was not used to substantiate the CSS finding; N2 uses multi-keyword display values that it resolves explicitly.

## Original defect status

“Fixed” below means the exact r1 input was independently rerun successfully, not that its entire feature is browser-conformant.

| r1 defect | Status | Current evidence and observed result |
| --- | --- | --- |
| D1 required log context/tail lost | FIXED | L:168–180 forces head/tail/error context. Original 103-line input at budget 10 returns original input, including first frame/context/final summary. Original 200 benign error-word lines + summary at budget 2000 also returns original. Regression specs log.reducer.spec.ts:423 onward cover literal and larger required sets. |
| D2 double-escaped script promotion | FIXED literal; new guard performance defect N1 | T:369–370 refuses the original script shape with `script body may be double-escaped`; exact original bytes returned. Spec html.reducer.spec.ts:476. |
| D3 quoted end-tag > leaked | FIXED | T:343–350 shares readTagBody; original input returns `shown\n\nafter`. Spec :490. |
| D4 inline entity/comment/override handling | FIXED literals; broader CSS correctness incomplete (N2) | T:525–550 decodes and chooses declarations. Original numeric entity and comment cases return shown; original none→block case retains VISIBLE. Specs :494–520. |
| D5 missing unit caption | FIXED literal; mixed foster/caption ordering defect N5 | H:574–577 preserves original caption: `Amounts in thousands\n\n| USD |\n| --- |\n| 5 |`. Spec :522. |
| D6 ragged-table quadratic padding | FIXED | H:588–594 pads header only. Original n=6000, exact 2 MiB input: 53 ms, html-extract, 96,003 output characters, no huge per-row padding. Spec :534. |
| D7 trailing pre whitespace lost | FIXED literal; new leading-newline mistakes N4 | H:493–510 preserves original `first\nlast  \n\n` inside fence. Spec :552. |
| D8 density-selected heading loses semantics | FIXED | H:259–266 renders root node. Original single H1 returns `# Only heading`. Spec :556. |

### Log budget contract

Exceeding the reducer budget is now intentional and supported by **batches.md:234–236** (reduce, then cut if still over) together with **batches.md:264 and :635** (unconditional head 40/tail 80/errors ±3). L:168–180 matches this contract. Batch 2e must still prove its final cap/spool and preserved-content behavior; reducer retention alone does not guarantee that a subsequent blind head cut retains the tail. This is an integration obligation, not a new Batch 2c defect.

The broad error patterns, exact consecutive-line equality, explicit repeat counts and byte-identical unchanged return remain (L:68–71, :136–154, :115). No new log correctness defect was established. Collapsing repeated errors still differs from the plan's “non-error” wording, as already recorded in r1; counts remain present, and it is not counted anew. The generated 5,000-line fixture shortened pass names to keep its required set under 2000 tokens (log.reducer.spec.ts:144–149); its passing size assertion does not promise every real log's required set fits.

## Five logic questions

### 1. How does this fail silently?

A valid later display value is ignored, so visible content disappears in a successful extraction (T:547, N2). At rendering depth eight, literal code markup becomes actual HTML and a URL disappears without a note (H:400–408, N3).

### 2. What user action produces unexpected behaviour?

Extracting a page containing many small scripts stalls the host (T:447, N1). Extracting an eight-level quoted example loses its link destination and code protection (H:400, N3). Reading a pre block beginning with a comment or encoded newline alters its content (H:497–501, N4).

### 3. What input data produces a wrong answer?

The literal CSS override, nested quote/code/link, pre newline and foster-parent/caption inputs in N2–N5 reproduce wrong content, semantics or order. Each has expected versus actual output and current line evidence below.

### 4. What happens when a dependency fails?

H:100–109 catches HtmlRefusal or unexpected exceptions and returns the original input through H:113–114. Numeric/unknown reference, CSS escape and unterminated string refusals were independently checked with a BOM and CRLF: unchanged output remained exactly equal. Log token failures still propagate locally to the future pipeline boundary (L:333–345). Pure parser/renderer code has no network, filesystem or cancellation boundary; N1's synchronous work cannot be rescued by the catch.

### 5. What is missing that the requirements never mentioned?

A bounded range for each guard scan (T:447), distinguishing unsupported valid CSS from invalid CSS (T:547), preserving code/link semantics when flattening (H:400), parser-accurate initial newline consumption (H:497), and browser-order placement of foster-parented nodes relative to captions (H:549–595). These are necessary to the stated bounded-work and preserved-content guarantees, not requests for unrelated features.

## Failure modes — Log

No new numbered defect. The original D1 inputs pass and the required set is forced independent of budget (L:168–180). Tests cover tiny budgets, no-change identity, CRLF, dedupe, ANSI removal, adversarial large lines and exact omission counts. Error recall is still intentionally pattern-based; pytest assertion detail outside ±3 of a matched error can be omitted, while benign error-word lines are retained. This is a remaining heuristic limit, not a regression introduced by r2.

## Failure modes — HTML

### N1. Serious — Script safety guard repeatedly scans the remaining document

- File: **T:446–449**, called for every script at **T:369**.
- Failure input:
  `const size = 2097152; const input = '<main><p>visible</p>' + '<script></script>'.repeat(Math.floor((size - 26) / 17)) + '</main>'; reduceHtml(input, {budgetTokens:2000});`
- Trigger: many sibling script tags, no comment opener.
- Expected: total scan work linear in input size; every per-script safety scan bounded by that script's candidate close.
- Actual: `html.indexOf('<!--', from)` scans to the end of the complete document for each script. Checking `comment >= end` afterward cannot undo the work. Independent times: **524,273 chars → 5,354 ms; 1,048,570 chars → 21,305 ms**. At **2,097,147 chars**, the same call took **92,590 ms** and returned html-extract with only “visible”.
- Symptom/impact: a valid page yielding only “visible” blocks synchronous host execution for seconds; doubling input quadruples cost.
- Current handling: ordinary successful html-extract; no refusal or bounded scan.
- Fix: scan only [from, end), using a bounded slice or a forward loop that stops at end; add many sibling scripts with and without a later comment to cap-sized timing guards. The current single-script test does not catch this case.

### N2. Blocking — Valid multi-keyword display overrides are treated as invalid

- File: **T:91–102**, **T:547–550**.
- Failure input:
  `<main><p>shown</p><div style="display:none;display:inline flow">VISIBLE</div></main>`
- Expected: `shown\n\nVISIBLE`, or exact-input refusal if the value cannot be interpreted. JSDOM resolves the final declaration to inline.
- Actual: `shown`, html-extract, note “skipped 1 hidden element(s)”.
- Second confirmed variant: `display:none;display:block flex`; JSDOM resolves flex, extractor still drops VISIBLE.
- Impact: legitimate page content silently disappears. The comment at T:83–88 explicitly accepts “hides more text” as safe, but that violates main-content preservation.
- Current handling: whitelist lacks valid compound display values and silently retains the earlier none.
- Fix: normalize supported compound values or refuse unsupported values that could supersede a hiding declaration. Do not equate unrecognized syntax with invalid syntax. Variable-based values also deserve refusal until resolved; they are currently ignored rather than refused, but are not needed to establish this finding.

### N3. Blocking — Depth flattening removes code protection and essential hrefs

- File: **H:400–408**, decorated code/link cases **H:440–447**, sub-render depth **H:453–454**.
- Failure input:
  `'<main>' + '<blockquote>'.repeat(8) + '<p>before <a href="/essential">link</a> after</p><p><code>text &lt;span hidden&gt;VISIBLE&lt;/span&gt;</code></p>' + '</blockquote>'.repeat(8) + '</main>'`.
- Expected: keep /essential and keep the code text literal, or refuse extraction at the semantic limit.
- Actual:
  `> > > > > > > > before link after\n> > > > > > > >\n> > > > > > > > text <span hidden>VISIBLE</span>`.
- Impact: /essential is lost, and literal source-code text becomes active HTML. Independent marked→JSDOM rendering of the output creates a hidden SPAN containing VISIBLE; the original DOM instead contains a CODE text node with the literal string and no such span. This is content/meaning corruption, not a claim of executable XSS.
- Current handling: at level eight, code and links are rendered as ordinary children; raw text is entity-decoded but not protected from inline Markdown/HTML interpretation.
- Fix: either return exact original bytes when the decoration limit is reached, or preserve semantic leaves (code/link) with bounded rendering and escaping. Flattening layout is not permission to omit destinations or reinterpret literal text.
- Control: depth seven preserves both href and backticks; depth eight and nine reproduce the failure.

### N4. Moderate — Initial pre newline is removed/kept based on raw text rather than HTML parsing

- File: **T:233–234** discards comments; **H:497–501** tests the first surviving raw text child.
- Failure input A: `<main><p>shown</p><pre><!--c-->\nline</pre></main>`.
- Expected A: code content starts with a newline. JSDOM pre.textContent is `\nline`; the intervening comment prevents immediate-newline consumption.
- Actual A: fence body starts with line, dropping that newline because the comment no longer exists in the tree.
- Failure input B: `<main><p>shown</p><pre>&#10;line</pre></main>`.
- Expected B: code content `line` (JSDOM consumes the initial decoded LF).
- Actual B: code content `\nline`, because the raw first child starts with ampersand.
- Third probe: a lone CR immediately after pre similarly survives as an extra normalized LF; JSDOM consumes it after preprocessing.
- Impact: whitespace-sensitive examples are changed despite the new preservation claim; the r1 trailing-whitespace fix itself remains correct.
- Fix: handle initial newline consumption in the tokenizer with character decoding/preprocessing and token-position information, or conservatively refuse ambiguous leading forms.

### N5. Moderate — Caption is moved ahead of browser-fostered content

- File: **H:549–595**, particularly the single outside accumulator at **H:551** and caption handling **H:574–577**.
- Failure input:
  `<main><table><caption>CAPTION</caption><tr><td>CELL</td></tr><div>OUTSIDE</div></table></main>`.
- Expected: OUTSIDE, then CAPTION adjacent to its table, then CELL. JSDOM tree is `<main><div>OUTSIDE</div><table><caption>CAPTION</caption><tbody>…CELL…</tbody></table></main>`.
- Actual: `CAPTION\n\nOUTSIDE\n\n| CELL |\n| --- |`.
- Impact: content order differs from the page; an unrelated fostered note separates the caption from its table. This is the mixed case missing from the two separate caption/foster tests.
- Current handling: captions and fostered nodes share a source-order accumulator and are both emitted before the table.
- Fix: collect fostered content separately from caption/table content and emit in browser order, or decline malformed tables whose order is uncertain.

## Blocking issues

N2 (T:547): silent visible-content loss. N3 (H:400): literal-code reinterpretation and href loss. Their failure inputs, impacts and fixes are specified above.

## Serious issues

N1 (T:447): unbounded repeated suffix scans stall synchronous execution. This is a new performance regression caused by the D2 guard, not a recurrence of D6's table allocation.

## Moderate and minor issues

N4 (H:497): initial pre newline mismatch. N5 (H:574): caption/foster ordering mismatch. No separate finding for file length, naming or formatting.

## Structural and refusal assessment

The parser extraction is an appropriate single nameable collaborator: T:163 supplies a tree/refusal contract; H:118 consumes it; reduceHtml and src/index.ts exports are unchanged. No dependency was added by these imports. This split addresses the earlier maintainability recommendation without introducing public API shims.

New explicit refusal paths preserve original strings, including BOM/CRLF, through H:113–114. Independent tests confirmed the original double-escape input, unknown &colon; in style, a CSS escape, and an unterminated CSS string. However T:547 silently ignores other unsupported values rather than refusing (N2), and flattening also takes a success path rather than refusal (N3).

## Data flow

1. Barrel exports reduceLog/reduceHtml unchanged (src/index.ts:12–13) — OK.
2. L:87–94 strips ANSI, groups exact repeated lines and selects — OK.
3. L:168–180 forces required retention; :181 widens with leftovers — D1 repaired; final cap belongs to 2e.
4. T:163 parses through scanner/tree; tags use shared readTagBody — D3 repaired.
5. T:369 invokes script guard — D2 literal repaired, N1 repeated-suffix scan.
6. T:525 resolves styles — D4 literals repaired, N2 unsupported valid values misclassified.
7. H:123–125 measures/selects/renders — D8 semantic roots repaired.
8. H:400 applies depth policy — N3; H:497 initial pre LF — N4; H:551 caption/foster collection — N5.
9. H:588 pads only header — D6 repaired; H:131–135 refuses empty/nonshrinking output, H:103–114 returns input on refusal — identity paths OK in tested cases.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Original eight literal defects repaired | COMPLETE | Independent reruns and regression specs |
| Unconditional log head/tail/error context | COMPLETE at reducer layer | Final pipeline cut still needs integration verification |
| Original hidden/script/end-tag regressions | COMPLETE for literals | New script guard cost N1 |
| Accurate inline visibility | PARTIAL | N2 |
| Preserve table captions/content | PARTIAL | Caption present, order issue N5 |
| Preserve pre whitespace | PARTIAL | Trailing fixed; initial newline N4 |
| Preserve headings, code and href | PARTIAL | Root heading fixed; nesting N3 |
| Linear work at 2 MiB | PARTIAL | N1 |
| Refusals preserve original bytes | COMPLETE for checked paths | Unsupported syntax can still take success paths |
| No new dependencies/no LLM/pure reducers | COMPLETE in reviewed imports/code | No package diff claimed |
| Full raw spool and final cap | OUTSIDE THIS BATCH | Batch 2e |

Implicit requirements not addressed are the semantic and work-bound cases described in question five.

## Edge cases and timings

Single independent runs, not best-of-three. All cap probes use UTF-16 character length, matching the implementation guard. The scoped suite additionally passed its existing adversarial guards.

| Case | Handled | Result | Concern |
| --- | --- | --- | --- |
| Original ragged table, n=6000, 2 MiB | YES | 53 ms, 96,003 output chars | D6 fixed |
| Many sibling scripts, ~512 KiB | NO | 5,354 ms | N1 |
| Many sibling scripts, ~1 MiB | NO | 21,305 ms | N1, ~4× time for 2× input |
| Many sibling scripts, 2,097,147 chars | NO | **92,590 ms** | N1; synchronous stall near the 2 MiB cap |
| One giant inline style, 2 MiB | YES | 158 ms | Bounded single scan |
| Many declarations in one style, ~2 MiB | YES | 46 ms | Bounded single scan |
| 500 nested quotes + paragraph runs, ~2 MiB | PARTIAL | 1,669 ms, unchanged | Above 1500 in a single CPU-contended run; not independently attributed to super-linear work |
| 500 inline levels in pre + text, 2 MiB | YES | 20 ms | Parts collection avoids repeated string assembly |
| Explicit style refusals with BOM/CRLF | YES | Exact original equality | No normalization on refusal |
| Render nesting seven | YES for probe | Code and href preserved | Control for N3 |
| Render nesting eight/nine | NO | Code/href semantics lost | N3 |
| Comment/entity/CR at start of pre | NO | JSDOM text differs | N4 |
| Caption and foster node together | NO | JSDOM order differs | N5 |

The deep-quote measurement overlapped the sibling-script CPU probe and is reported as an observed threshold exceedance, not an additional failure mode. No suite was rerun to reread logs.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the five reproducible findings; MEDIUM for remaining browser semantics.
- Top risk: successful extraction still changes content meaning, while the new safety guard can stall the host.
- What a robust implementation would add: bounded per-script scans, conservative handling of unsupported valid CSS, semantic protection at the depth limit, tokenizer-accurate pre newlines, and separate foster/caption placement.
