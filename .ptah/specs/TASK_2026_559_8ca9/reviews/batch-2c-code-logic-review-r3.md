# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 2c r3, final revise-round review, 2026-09-26. The original D1–D8 and N1–N5 reproduction inputs pass. Two additional HTML content-integrity defects remain. Neither is claimed to have been introduced by the latest edits: the requested semantic-leaf/raw-text probes expose gaps already present outside the repaired literal cases.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 2 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 2 newly identified |

The thirteen repaired reproduction cases, conservative refusal paths and removal of the demonstrated quadratic script scan put this above the significant-problems band. It is below 7–8 because successful extraction can still silently change visible content into hidden markup or discard it. Required scoped verification also did not finish green.

Paths: **H** = `libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts`; **T** = adjacent `html-tree.ts`; **L** = adjacent `log.reducer.ts`; **HS** = adjacent `html.reducer.spec.ts`; **LS** = adjacent `log.reducer.spec.ts`. Line numbers refer to current worktree files.

## Scope and verification

Read complete current H/T/L and both specs, the barrel, context.md, relevant batch requirements and the archived r2 review. Prior sibling reducer/type/token-measure reads remain comparison context. Task-folder discovery found no implementation-plan.md, task-description.md or code-style-review.md; no new instruction file was supplied beyond the project guidance. No production source, task status or git state was changed.

No listed Ptah file-read or Write tool is available; native reads and the apply_patch file tool were used. Scoped ptah_get_diagnostics on H/T/L returned **0 errors, 0 warnings**.

Ran once, with no rerun:

`node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache`

Captured tail:

```text
Snapshots:   0 total
Time:        38.588 s
Ran all test suites.
NX Running targets test, lint, typecheck for project @ptah-extension/tool-output-reducers failed
Failed tasks:
- @ptah-extension/tool-output-reducers:test
Output of 2 successful tasks were not shown.
NX Nx detected a flaky task
Run duration: 39.5s
Cache: Skipped (--skip-nx-cache)
```

Exit code 1. Lint/typecheck completed successfully; test failed. The captured tail does not identify the failing assertion. A read-only attempt to locate the matching saved terminal output was unsuccessful. **Do not infer a timing failure, a particular failed case, or a test count from this evidence.** Nx's flaky-task label is not an identified root cause. The suite was not rerun to recover discarded output.

Independent probes used installed esbuild to bundle current source, JSDOM for source DOM/computed-style comparisons, and marked plus JSDOM for Markdown-output interpretation. No new dependency was installed. Probes were temporary .mjs files under C:/Users/abdal/AppData/Local/Temp, deleted with their bundle after use. Source DOM/parsed-output evidence is sufficient for the semantic findings; this is not an exhaustive real-browser conformance audit.

## D1–D8 regression status

“Fixed” refers to independent reruns of the original failure inputs, not universal correctness of the associated feature.

| Defect | Status | Evidence/result |
| --- | --- | --- |
| D1 log context/tail loss | FIXED | L:168–180 forces required groups. Original 103-line input at budget 10 and 200 benign error-word lines plus summary at budget 2000 both return exact original input, including final summary. LS:423 onward retains regressions. |
| D2 double-escaped script promotion | FIXED | T:417–418/T:499 refuses original input with original bytes and script-body reason. HS:499. |
| D3 quoted end-tag attribute leakage | FIXED | T:391–398 shares quote-aware body scan. Original returns shown + after only. HS:513. |
| D4 style entity/comment/later override cases | FIXED | T:577–617. Original numeric entity and comment cases hide SECRET; none→block retains VISIBLE. HS:517–541. |
| D5 unit-bearing caption loss | FIXED | H:589–598 preserves original Amounts in thousands adjacent to its table. HS:544. |
| D6 ragged-table quadratic padding | FIXED | H:602–607 pads header only. Original n=6000 at exact 2 MiB: 104 ms, html-extract, 96,003 output chars. HS:556. |
| D7 pre trailing whitespace loss | FIXED | H:511–524 preserves original first/newline/last/two spaces/two newlines in fence. HS:574. |
| D8 selected root heading semantics | FIXED | H:271–278 renders selected H1 as a node: # Only heading. HS:578. |

## N1–N5 regression status

| Defect | Status | Evidence/result |
| --- | --- | --- |
| N1 repeated document-suffix script scan | FIXED | T:499–513 scans < positions until the current script's close. Original sibling scripts: 524,273 chars 66 ms; 1,048,570 chars 102 ms; 2,097,147 chars 210 ms. All return visible. HS:598–608 covers cap-sized cases with/without a later comment. |
| N2 valid compound display overrides ignored | FIXED | T:125–150 accepts inline flow/block flex; original inputs retain VISIBLE. Unsupported winning values refuse at T:605–609. HS:611–628. |
| N3 depth-eight code/href flattening | FIXED original; broader semantic gap R3-1 | H:418–421 refuses the original depth-eight code/link input byte-for-byte. a/code/kbd/samp independently refuse at the limit. HS:638. |
| N4 pre initial newline handling | FIXED originals | T:705–727 token-aware state and T:85 matcher: original comment retains LF; numeric LF and lone CR remove the parser-consumed newline. H:515 no longer performs a second leading trim. HS:648–657. |
| N5 caption/fostered-content order | FIXED original | H:565–598 uses separate accumulators. Original returns OUTSIDE, then CAPTION, then table CELL. HS:660. |

Additional refusal checks used BOM + CRLF: a winning var() display, an invalid display keyword, and an over-depth code element all returned exact original strings (H:125–126), with explicit reasons. CSS !important controls preserved the correct known winner or conservatively refused uncertainty. No new exposure was established in the inspected compound-display grammar; the developer's separate 2,379-value claim was not independently rerun.

## Five logic questions

### 1. How does this fail silently?

H:377–379 decodes visible text then emits it without inline Markdown/HTML protection: the output can hide words that were visible source text (R3-1). T:29–37 classifies visible xmp raw text as removed and omits it from successful extraction (R3-2).

### 2. What user action produces unexpected behaviour?

Reading a literal markup example in tt/var/textarea or a normal paragraph can turn that example into an actual hidden element in rendered Markdown (H:379). Reading a legacy page using xmp for examples can lose the entire example (T:35).

### 3. What input data produces a wrong answer?

The literal inputs under R3-1 and R3-2 reproduce meaning loss, with source and rendered-output DOM checks. Preformatted pre, actual script data and the four explicitly protected semantic leaves behaved correctly in the corresponding depth probes (H:410–421).

### 4. What happens when a dependency fails?

HTML extraction catches HtmlRefusal/unexpected exceptions and returns original input plus a reason (H:112–126). New refusal paths were verified with BOM/CRLF. The pure parser has no external async dependency. Log tokenization exceptions remain a later pipeline handling responsibility (L:333–345); Batch 2e is not verified here. Neither local catch can guarantee recovery from process-wide memory exhaustion, but the prior demonstrated table expansion and script stall are fixed.

### 5. What is missing that the requirements never mentioned?

A general text-to-Markdown escaping boundary, rather than only protecting selected tags (H:73/H:379), and separate raw-text tokenization versus visual-visibility classification (T:29–37). Performance assertions also need to distinguish pragmatic load tolerance from evidence of scaling (HS:446–451).

## Failure modes — Log

No newly identified log defect. Required head/tail/error-context retention remains unconditional (L:168–180), exact consecutive equality remains at L:143, and repeated counts remain explicit at L:154. Original D1 inputs and independent cap probes passed.

Exceeding the reducer budget is intentional: batches.md:234–236 assigns the subsequent cut to Batch 2e, while :264/:635 require unconditional head 40/tail 80/errors ±3. The pipeline must still verify that its final cut/spool fulfills the end-to-end contract; reducer-level retention alone cannot prove tail preservation after a head cut. No such future integration is claimed complete.

The already recorded error-run-collapse wording mismatch and broad error-pattern heuristic are not counted again. The successful local cases do not override the failed scoped test target.

## Failure modes — HTML

### R3-1. Blocking — Unprotected visible text becomes active inline HTML

- Files: **H:73**, **H:377–379**, **H:418–431**, **H:363–367**. The only generic escaping is for block starts at H:289–294.
- Minimal failure input:
  `<main><p>text <tt>&lt;span hidden&gt;VISIBLE&lt;/span&gt;</tt></p></main>`.
- Expected: keep the literal visible text `text <span hidden>VISIBLE</span>` as literal Markdown text, using entities/backslash escaping/code protection, or refuse with original bytes.
- Actual: `text <span hidden>VISIBLE</span>`, reducer html-extract. marked→JSDOM creates a real hidden SPAN containing VISIBLE. The original JSDOM document has a TT text node containing those literal characters and no hidden span.
- Flattened variant:
  `'<main>' + '<blockquote>'.repeat(8) + '<var>text &lt;span hidden&gt;VISIBLE&lt;/span&gt;</var>' + '</blockquote>'.repeat(8) + '</main>'`.
  Actual output starts with eight quote markers and ends `text <span hidden>VISIBLE</span>`; parsed output again has a hidden span. The same holds with tt, textarea or span.
- Script-looking-text variant: eight quotes wrapping `<p>text &lt;script&gt;VISIBLE&lt;/script&gt;</p>` produces `> > > > > > > > text <script>VISIBLE</script>`; parsed output contains a SCRIPT node that did not exist in the source.
- Symptom/impact: literal examples change into markup and visible words cease to be ordinary visible text. This is a content-integrity finding, not a claim that scripts execute through the application's sanitizer.
- Current handling: a/code/kbd/samp refuse at depth eight; pre stays fenced at every depth; all other text is decoded and appended without inline escaping. Checking more tag names alone cannot protect normal paragraphs.
- Recommendation: escape text-node content for its Markdown context before appending it, retaining raw text only inside correctly constructed code fences/spans. Treat textarea/raw visible text deliberately. Add source-text versus parsed-output assertions for both shallow and flattened cases.
- Provenance: this is newly identified in r3, **not proven newly introduced by the round-2 fix**. N3's exact code/link regression is repaired; the underlying text-emission boundary remains incomplete.

### R3-2. Blocking — Visible xmp content is classified as hidden script-like data

- Files: **T:29–37**, **T:415–423**, **T:637–638**.
- Failure input:
  `<main><p>shown</p><xmp>text &lt;span hidden&gt;VISIBLE&lt;/span&gt;</xmp></main>`.
- Expected: preserve the visible raw preformatted example (including the literal ampersand entity spellings, since xmp is raw text), or refuse extraction unchanged.
- Actual: `shown`, reducer html-extract, no content-omission note.
- Independent evidence: JSDOM source XMP has display block, white-space pre and textContent `text &lt;span hidden&gt;VISIBLE&lt;/span&gt;`.
- Symptom/impact: an entire visible code/example block disappears. It is uncommon legacy markup, but dropping it silently still violates the visible-content contract.
- Current handling: RAW_TEXT is spread into REMOVED, conflating tokenizer state with visibility; scan also never records raw body text for these elements.
- Recommendation: separate raw-text scanning from the hidden-element set. Preserve and fence supported visible raw-text elements, or conservatively refuse them. Do not entity-decode xmp/plaintext bodies as though they were ordinary HTML character data.
- Provenance: an existing limitation newly exposed by the requested raw-text probes, not a regression attributed to the latest edits.

## Blocking issues

R3-1 (H:379): text-to-Markdown semantic corruption. R3-2 (T:35): silent loss of visible raw text. Inputs, expected/actual results and recommendations are above.

## Serious issues

None newly established. The prior serious quadratic script path is repaired, supported by both bounded control flow and independent size measurements (T:499–513).

## Moderate and minor issues

No additional numbered defect. Timing-test robustness and incomplete verification are recorded below without manufacturing an assertion failure cause.

## Relative timing guard assessment

HS:446–451 checks **elapsed < 1500 ms OR elapsed < 3 × a freshly timed reference**. Therefore 1500 ms remains a fast acceptance threshold, **not an unconditional ceiling**.

- This is a reasonable pragmatic response to steady machine load. Best-of-three measurements (HS:434–442) reduce transient noise.
- It will catch the known orders-of-magnitude N1 regression under comparable load. More importantly, N1's dedicated regressions still use an absolute 1500 ms assertion (HS:606–607); D6 does too (HS:568). Their guards were not weakened by the relative fallback.
- It does **not prove that every tested path is linear**. Only one size is measured; a modest quadratic regression might remain under either threshold. The reference invokes the same reducer, so a shared regression affecting both can preserve the ratio.
- It is **not guaranteed non-flaky**. Candidate and reference minima come from separate sequential windows; a load change or GC shift between those windows can cause false acceptance/rejection. No deterministic paired-load or scaling evidence was supplied.
- Recommendation: retain the practical guard, but add a small multi-size scaling check for expensive families and record raw candidate/reference times when it fails. Do not claim “any quadratic path” must be 100× slower solely from the N1 example (HS:425–427).

The scoped suite failed in this review, but the saved tail does not identify the assertion; it cannot be used to claim this new relative check failed or passed. Independent single-run probes recorded reference 1711 ms and deep quotes 1514 ms, both above 1500 under concurrent work. Those measurements are reported honestly without treating them as demonstrated super-linear behavior.

## Semantic-leaf coverage

| Probe at eight quote levels | Result | Assessment |
| --- | --- | --- |
| a, code, kbd, samp | Exact-input refusal | Correct for tested shapes, H:418 |
| pre with literal span/script text | Fenced output; no hidden span/script node after Markdown parsing | Correct, H:410/H:511 |
| Actual script body followed by shown paragraph | Script content absent, shown retained | Correct, T:415 |
| var, tt, textarea, ordinary span/text with encoded markup | Active hidden span in parsed output | R3-1 |
| Literal script-looking paragraph text | SCRIPT node created in parsed Markdown | R3-1 |
| Visible xmp | Entire example omitted | R3-2 |

The absence of pre from SEMANTIC_LEAVES is not itself a defect: its unconditional fenced branch runs first. var/tt need protection through a general text boundary even above the nesting limit.

## Data flow

1. src/index.ts:12–13 exports reducers unchanged — OK, no public API migration.
2. L:87–94 strips ANSI/groups/selects; L:168–180 forces required retention — original log fix remains.
3. T:207–210 scans/builds tree; quote-aware tags at T:359/T:391 — original tag fixes remain.
4. T:499–513 bounds script guard to current body; T:577–609 models/refuses style values — N1/N2 repaired for tested paths.
5. T:705–727 tracks initial pre token state — N4 originals repaired.
6. H:135–137 measures/selects/renders; H:271–278 preserves root semantics — D8 remains repaired.
7. H:418 refuses protected deep leaves, but H:379 emits other decoded text unprotected — R3-1.
8. T:35/H:385 discard removed subtrees — R3-2's visibility misclassification.
9. H:565–609 separates foster/caption output and avoids per-row padding — N5/D6 repaired.
10. H:112–126 catches refusal and returns original bytes — checked BOM/CRLF paths retain identity.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| D1–D8 literal fixes | COMPLETE | Independent reruns |
| N1–N5 literal fixes | COMPLETE | Independent reruns |
| Unconditional reducer-level log required set | COMPLETE | Final cap/spool remains Batch 2e |
| No new dependencies/no LLM/pure functions | COMPLETE within reviewed implementation | No package-diff claim |
| Hidden/non-rendered content handling | PARTIAL | Literal visible text can become hidden/script markup, R3-1 |
| Preserve visible main content | PARTIAL | R3-1/R3-2 |
| Pre newline/trailing whitespace preservation | COMPLETE for original cases | Not an exhaustive HTML tokenizer proof |
| Bounded processing of known adversarial families | COMPLETE for diagnosed quadratic cases | No new super-linear path demonstrated; tests do not prove all shapes |
| New refusals preserve original bytes | COMPLETE for checked cases | Not a substitute for general semantic escaping |
| Scoped test/lint/typecheck verification | PARTIAL | Test target failed; assertion unavailable; lint/typecheck pass |
| End-to-end raw spool and final cap | OUTSIDE BATCH | Batch 2e not inspected here |

Implicit requirements unaddressed: context-correct Markdown escaping and separation of raw tokenization from visibility.

## Edge cases and independent timings

Single runs; input lengths are UTF-16 units matching the implementation cap. Nx work and probes overlapped, so timings are observations under load, not idle-machine benchmarks.

| Case | Handled | Time/result | Concern |
| --- | --- | --- | --- |
| Original ragged table n=6000, exact 2 MiB | YES | 104 ms | No old allocation blowup |
| Sibling scripts 524,273 / 1,048,570 / 2,097,147 chars | YES | 66 / 102 / 210 ms | Supports linear scan fix |
| Unclosed paragraph reference, exact 2 MiB | YES functionally | **1711 ms** | Above absolute threshold under load |
| 500 quote levels + paragraph runs, exact 2 MiB | YES functionally | **1514 ms**, unchanged | Above absolute threshold; no super-linear cause established |
| Huge style value, exact 2 MiB | YES | 215 ms | Bounded scan |
| Many < characters, exact 2 MiB | YES | 270 ms, unchanged | No elements |
| Unterminated attribute, exact 2 MiB | YES | 1 ms, unchanged | EOF guard |
| Huge log line, exact 2 MiB | YES | 68 ms, unchanged | Bounded token counting |
| Alternating log lines, exact 2 MiB | YES | 326 ms | No incorrect dedupe |
| Huge leading-zero pre numeric LF reference, exact 2 MiB | YES | 2 ms | New regex stayed bounded |
| Unknown CSS / deep semantic leaf with BOM+CRLF | YES | Exact identity | New refusal paths |
| Encoded inline HTML examples | NO | Hidden/script node introduced | R3-1 |
| XMP visible raw text | NO | Dropped | R3-2 |
| Repeated/concurrent calls | YES by construction | Per-call state T:208, H:272, L:167 | No timers/listeners/external writes |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for prior regression statuses and two semantic findings; MEDIUM for remaining parser coverage and LOW for the unidentified test-failure cause.
- Top risk: a successful html-extract response can still change or erase visible example content.
- What a robust implementation would add: general context-aware text escaping, explicit visible raw-text handling/refusal, semantic DOM-differential fixtures, and clearer timing failure evidence.
- Final-round boundary: this review reports remaining issues; it does not authorize another implementation round, change task state or perform a commit.
