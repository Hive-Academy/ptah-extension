# Code Logic Review — TASK_2026_559_8ca9

## Summary

Independent review of Batch 2c's post-cap bounded correction, 2026-09-26. **Verdict: REVISE.**

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 3 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 3 defect families |

All original D1–D8, N1–N5 and R3 literal inputs pass. Three remaining families silently change successful HTML extraction: incomplete escaping, code-span composition, and visibility overrides. These reproducible cases keep the score below 6; repaired regressions, working refusals, unconditional log retention and bounded observed timings separate it from 4. The remaining gaps are not all attributed to the latest correction.

Current-worktree citation aliases:

- **H:** libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts
- **T:** adjacent html-tree.ts
- **L:** adjacent log.reducer.ts
- **HS/LS/MS:** adjacent html.reducer.spec.ts, log.reducer.spec.ts, markdown.reducer.spec.ts
- **TS:** libs/backend/tool-output-reducers/src/lib/token-measure.spec.ts
- **CS:** adjacent content-detector.spec.ts

## Scope and verification

Read complete H/T/L and their specs, the three timing-edited sibling specs, reducer types/token measurement, Markdown and detector comparison implementations, barrel/project configuration, context Decision 7, Batch 2 amendment/risks/2c/KI-2b-1 and archived r1–r3 findings. Task discovery found no task-description.md, implementation-plan.md or code-style-review.md; batches.md describes a plan-free task. Ptah search returned zero AGENTS.md files; native ancestor/target checks found none. No direct Ptah file-read or Write tool was listed; native reads and apply_patch were used.

No git operations or reviewed-source edits were performed. This is a current-file review, not a verified git-diff/package-diff inventory.

Scoped ptah_get_diagnostics for H/L: **0 errors, 0 warnings**.

Ran once:

    node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache

Captured completion tail:

    √  nx run @ptah-extension/tool-output-reducers:lint
    √  nx run @ptah-extension/tool-output-reducers:typecheck
    √  nx run @ptah-extension/tool-output-reducers:test
    NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
    Output of 3 successful tasks were not shown.
    Run duration:      1m 51s
    Cache:             Skipped (--skip-nx-cache)
    Critical path:     1m 51s (1 task)

No failed assertion was reported. PowerShell wrapped Nx's initial stderr as NativeCommandError; the final Nx target summary explicitly reports success. Passing string expectations do not establish rendered semantics: HS:688–698 checks strings/regexes, whereas these independent probes parse the output.

Temporary .mjs probes bundled current TypeScript with installed esbuild, parsed source with JSDOM, and parsed output with installed marked defaults plus JSDOM. No package was installed. Ordinary visible-text comparisons normalize whitespace; preformatted content also received raw/fence checks. Scripts/resources were not executed/loaded. Visibility inheritance was checked using direct computed styles: an oracle that prunes every visibility:hidden ancestor would repeat the implementation's error. Image findings compare DOM structure with original literal text, without assuming how missing resources render alt text. These are content-integrity findings, not sanitizer bypass or script-execution claims.

## D1–D8 status

PASS means the literal inputs/recipes were independently rerun, not universal browser conformance.

| Case | Status | Current evidence/result |
| --- | --- | --- |
| D1 context/tail | PASS | Original 103-line budget-10 and 201-line budget-2000 cases return exact originals, including summary. L:168–180; LS:441–473. |
| D2 double-escaped script | PASS | Exact original returned with script-body refusal. T:419–420; HS:516–523. |
| D3 quoted end-tag attribute | PASS | Returns shown, blank line, after. T:391–398; HS:530–531. |
| D4 CSS entity/comment/order | PASS | Numeric-colon/comment cases hide SECRET; none→block retains VISIBLE. T:579–618; HS:534–550. |
| D5 caption units | PASS | Amounts in thousands retained immediately above USD/5 table. H:607–627; HS:561–564. |
| D6 ragged table | PASS | Original n=6000, exact 2 MiB: 63/34/34 ms; html-extract, 96,003 output chars. Header-only padding H:620–625; HS:573–581. |
| D7 pre trailing whitespace | PASS | Original first/newline/last/two spaces/two newlines retained in fence. H:529–542; HS:584–585. |
| D8 selected heading | PASS | Original H1 becomes a level-one Markdown heading. H:277–287; HS:588–589. |

## N1–N5 status

| Case | Status | Current evidence/result |
| --- | --- | --- |
| N1 sibling scripts | PASS | Original cap recipe returns visible; 0.5/1/2 MiB minima 26/38/68 ms. Bounded scan T:501–515; HS:608–618. |
| N2 compound display | PASS | Original inline flow/block flex overrides retain VISIBLE. T:125–150, T:604–611; HS:621–638. |
| N3 depth-eight code/link | PASS | Exact original refused byte-for-byte. H:436–439; HS:641–655. Separate shallow composition gaps remain. |
| N4 pre initial newline | PASS | Original comment retains LF; numeric LF/lone CR consume initial newline. T:707–714; HS:658–667. |
| N5 foster/caption order | PASS | Original produces OUTSIDE, CAPTION, then CELL table. H:583–616; HS:670–672. |

## R3 correction status

| Case | Status | Evidence/result |
| --- | --- | --- |
| R3-1 shallow tt | PASS literal; broader boundary incomplete | H:296–297/H:397 escape angles. Source/output visible strings match; no hidden span is created. Defect 1 bypasses the general protection. |
| R3-1 eight-quote var/tt/textarea/span | PASS literals | All retain literal span markup under marked→JSDOM. H:397/H:445–449. |
| R3-1 eight-quote script-looking paragraph | PASS literal | No SCRIPT node introduced; literal text retained. H:397; HS:693–698. |
| R3-2 xmp | PASS | Exact original returned with “xmp or plaintext raw text is not modelled”. T:409–414; HS:711–715. |
| R3-2 plaintext | PASS | BOM/CRLF-bearing plaintext input also returned exactly. T:409–414/H:131–132. |
| Isolated code/pre long delimiters | PASS controls; composition incomplete | Leading/trailing-backtick and backticks-only spans pass; five-backtick pre fence protects four-backtick content. H:537/H:646–648. Defect 2 covers adjacency/spaces. |

## Five logic questions

### 1. How does this fail silently?

H:296–297 escapes selected characters independently per text node, permitting backslash cancellation and cross-node entities (defect 1). H:642–648 independently trims/delimits code leaves, changing adjacent text (defect 2). T:622–640 removes a subtree even when CSS restores visible content (defect 3). All return html-extract without a fidelity warning.

### 2. What user action produces unexpected behaviour?

Reading a page documenting literal Markdown/escaped tags, adjacent code fragments or a heading ending in # changes the example (H:397, H:458, H:648). Reading content shown by a display override or visibility-restoring child loses that content (T:623, T:616, T:722).

### 3. What input data produces a wrong answer?

Defects 1–3 give literal inputs reproducing changed visible strings, invented links/images/HTML, changed code text and missing VISIBLE content. Original regression literals pass; the distinction is coverage.

### 4. What happens when a dependency fails?

HTML has no async parsing dependency. H:120–132 catches refusal/unexpected exceptions and returns original input with a reason; H:149–153 refuses empty/nonshrinking output. BOM/CRLF, raw-text, CSS, depth, size and hidden-only refusal probes retained original bytes. No non-empty probe yielded empty output. Log tokenizer exceptions remain uncaught locally at L:342; pipeline catch/spool belongs to future Batch 2e. A synchronous catch cannot guarantee recovery from process-wide memory exhaustion.

### 5. What is missing that the requirements never mentioned?

Serialization must be safe across adjacent nodes, not just within individual strings (H:407–408). CSS visibility does not imply permanent removal of every descendant (T:640/T:722). Same-implementation timing references do not independently prove scaling (HS:72/LS:398/MS:873). These are implications of the existing fidelity/bounded-work requirements.

## Failure modes — numbered new defects

### 1. Blocking — Partial escaping still turns literal text into live HTML/Markdown

- **Files:** H:105–107, H:296–297, H:395–408; generated-context sites H:350–351, H:458, H:596, H:636, H:654.
- **Trigger:** literal backslashes/Markdown punctuation, or entity characters separated across DOM text nodes.
- **Failure input A** (one literal backslash before each encoded angle):

      <main><p>text \&lt;span hidden&gt;VISIBLE\&lt;/span&gt;</p></main>

- **Expected A:** visible literal text containing the backslashes and span example, or exact-input refusal.
- **Actual A:** output has two backslashes before each <. marked consumes a pair as one literal backslash and creates a real hidden SPAN. Visible output is only “text \”. The original has no SPAN element.
- **Comment variant:** the following creates a real comment and loses VISIBLE:

      <main><p>text \&lt;!--VISIBLE--&gt; after</p></main>

- **Failure input B:**

      <main><p>text &amp;<span>copy;</span></p></main>

- **Expected B:** literal “text &copy;”.
- **Actual B:** H:297 sees an isolated ampersand and does not escape it; H:408 assembles “text &copy;”, which marked renders as “text ©”. A same-node backslash before &amp;copy; also activates the entity through escape parity.
- **Failure input C:**

      <main><p>text [VISIBLE](/wrong)</p></main>

- **Expected C:** retain the original literal punctuation/destination, with no link.
- **Actual C:** marked creates an A with href /wrong and visible text “text VISIBLE”. The sibling literal ![VISIBLE](/image.png) becomes an IMG. A literal heading suffix and image alt label also change:

      <main><h1>literal #</h1></main>
      <main><p><img alt="a](/wrong)"></p></main>

  The heading emits “# literal #” and loses its final literal #. The alt emits “[image: a](/wrong)]”, inventing a link rather than the intended literal label.
- **Generated-link cases:**

      <main><p><a href="/correct">x\]</a></p></main>
      <main><p><a href="/path\&amp;copy;">VISIBLE</a></p></main>

  The first emits two backslashes before ], renders literal “[x\]](/correct)” and loses the link. The second produces marked href /path%5C© instead of retaining literal ampersand-copy-semicolon in the destination. H:351 adds escapes without protecting existing backslashes. Control: ordinary ]/( label text and /a(b) target correctly retain visible text and encode parentheses.
- **Autolink case:**

      <main><p>text &lt;http://example.com&gt;</p></main>

  Visible text stays intact, but marked's GFM URL recognition creates a link to http://example.com%3E. Adding a literal backslash before the encoded < restores an angle autolink and removes literal angle brackets. The “no autolink can form” comment is therefore too strong (H:291–292).
- **Current handling:** only < and selected & are generically escaped. Existing backslashes, other Markdown punctuation and assembled-node boundaries remain active.
- **Impact:** successful extraction can hide examples, alter literal instructions/data and invent destinations. This is semantic corruption, not an execution claim.
- **Recommendation:** serialize text, headings, labels, destinations and cells for their actual Markdown contexts; protect original backslashes before adding escapes and prevent entities forming across nodes (escaping every literal & is one conservative option). Test assembled marked+JSDOM output; refuse uncertain cases if faithful conversion is beyond the bounded correction.

### 2. Blocking — Adjacent code spans merge, and trimming joins visible words

- **Files:** H:639–648; concatenation H:407–408; collapse H:300–301.
- **Failure input A:**

      <main><p><code>a</code><code>b</code></p></main>

- **Expected A:** visible “ab” with both fragments preserved as code, or exact-input refusal.
- **Actual A:** Markdown consists of one backtick, a, two backticks, b, one backtick. marked creates one CODE node containing a, two literal backticks, b. Source JSDOM has two CODE nodes with combined text “ab”. Correct per-leaf delimiter lengths do not prevent neighboring closing/opening delimiters coalescing.
- **Failure input B:**

      <main><p>A<code> x </code>B</p></main>

- **Expected B:** visible “A x B”.
- **Actual B:** collapse trims both code-edge spaces; output renders “AxB”.
- **Controls:** isolated leading/trailing-backtick and backticks-only spans passed; pre's long fence passed. The longest-run calculation itself is not the defect.
- **Current handling:** each leaf is trimmed and independently fenced, then appended without boundary handling.
- **Impact:** successful extraction invents literal backticks or changes word/token boundaries in examples.
- **Recommendation:** preserve visible edge whitespace and serialize neighboring code fragments as a coordinated sequence—merge compatible adjacent code nodes, use safe boundaries, or refuse. Add source/rendered text assertions; a preceding literal backslash also exercises defect 1.

### 3. Blocking — Visibility overrides are discarded with the entire subtree

- **Files:** T:613–627, T:639–652, T:722–723; H:189/H:403–404.
- **Failure input A:**

      <main><p>shown</p><div hidden style="display:block">VISIBLE</div></main>

- **Expected A:** retain VISIBLE, or refuse the conflicting visibility state.
- **Actual A:** html-extract returns only “shown”, with “skipped 1 hidden element(s)”. JSDOM computes DIV display:block and visibility:visible. T:623 returns before considering the style.
- **Failure input B:**

      <main><p>shown</p><div style="visibility:hidden">SECRET<span style="visibility:visible">VISIBLE</span></div></main>

- **Expected B:** retain shown and VISIBLE, omit SECRET, or refuse the unsupported inheritance case.
- **Actual B:** html-extract returns only shown. Direct JSDOM inspection computes parent visibility:hidden and child visibility:visible. The child restores visibility; display:none would be different. T:640 reduces both mechanisms to removed, and T:722 prevents storing child text under underRemoved.
- **Current handling:** one removed/underRemoved flag represents every hiding mechanism, and hidden wins unconditionally over display.
- **Impact:** visible main content silently disappears; the note asserts the wrong hidden classification.
- **Recommendation:** distinguish display/content suppression from inherited visibility, account for hidden's display override, or conservatively refuse conflicting/restored states before discarding text. Test child computed styles directly; ancestor-pruning text oracles mask this bug.

## Blocking issues

Defects 1–3 above. Each independently returns success-looking html-extract with changed or missing content. Related examples are grouped rather than counted as separate defects.

## Serious issues

None newly established. Original D6/N1 quadratic paths pass their cap probes (H:620–625, T:501–515).

## Moderate and minor issues

No additional numbered issue. Timing limitations below are not a newly demonstrated production quadratic path. The earlier non-error-only wording discrepancy remains: batches.md:635 says non-error runs only, while L:143/L:154 and LS:286–290 deliberately collapse identical errors with counts. It is disclosed, not counted again.

## Hidden-content and refusal coverage

| Case | Result | Evidence / limit |
| --- | --- | --- |
| script/style/template/noscript/iframe/noembed/noframes | PASS sibling probes: shown retained, SECRET absent | T:29–38/T:417–425; batches.md:647 explicitly removes noscript |
| Original script/end-tag/CSS hiding inputs | PASS literals | T:391–420/T:579–618 |
| xmp/plaintext | Exact-input refusal | T:409–414 |
| Hidden inline wrapper spanning blocks | Existing regressions pass in scoped suite; refusal path inspected | T:833–837; HS:266–298; Markdown KI-2b-1 remains outside this correction |
| Encoded literal markup/entities | FAIL broader cases | Defect 1 |
| hidden overridden by display | FAIL | Defect 3A |
| visibility restored on descendant | FAIL | Defect 3B |
| Stylesheet-only hiding/visual tricks | Declared limitation | H:39–41; no stylesheet engine |
| Closed details, CSS all/reset, other legacy/layout elements | Residual uncertainty | Not certified by JSDOM layout or this review; no extra finding asserted |
| Empty/hidden-only/nonshrinking/size/depth/CSS/raw-text refusals | Exact originals; no empty-for-nonempty result observed | H:115–153 |

## Relative timing guard assessment

The formula matches the correction claim: accept under the absolute threshold; otherwise require both under 10,000 ms and under the reference multiple. Factors: HTML 3 (HS:67–72), log 4 (LS:393–398), Markdown 4 (MS:864–873), tokens 8 (TS:94–96), detector 8 (CS:212–218). Usually the minimum of three samples is checked, not every invocation. The ceiling is not a synchronous watchdog/cancellation mechanism.

| Reference | Linearity assessment | Evidence / limitation |
| --- | --- | --- |
| HTML capFill('<p>x') | Bounded forward traversal for this shape | Consecutive p starts close prior p (T:752–758); 0.5/1/2 MiB minima 155/303/622 ms. Same reducer can share a regression. |
| Log alternating a/b | Linear for this bounded-token family | L:136–150, L:168–181, L:246–290; 0.5/1/2 MiB minima 34/67/129 ms. Same implementation can share a regression. |
| Markdown small sections | Observed approximately linear over tested range | MS:847–850; 64/128/256 KiB minima 3/6/11 ms. marked dependency at markdown.reducer.ts:161–165 prevents this being an independent complexity proof. |
| Markdown lazy-list cap | Observed approximately linear over tested range | MS:851; 64/128/256 KiB minima 48/69/143 ms. Not a proof for every marked version/list shape. |
| Token quarter of actual generated text | Short-word fixture consistent with linear work; not a general tokenization guarantee | Actual TS:13–46 generator reused. 64 KiB samples 80/25/10 ms; 256 KiB 32/50/56; 1 MiB 192/854/547. Full/quarter minima ratio 6 under contention. A dominant quadratic term normally yields ~16x for 4x size and fails factor 8 under comparable load. BPE long-run superlinearity is explicitly recognized at L:41–44. |
| Detector short log lines | Bounded linear scans for this family | CS:213–218; fixed 64 KiB sniff window in content-detector.ts. Probe 3/2/1 ms. Beyond that window, this family is bounded rather than proportional to total payload. |

The old N1 multi-second/tens-of-seconds stall fails the 10-second ceiling. The old detector fence regression greatly exceeds its short-log reference. **These guards cannot guarantee detection of every quadratic regression.** A candidate and same-size reference both regressed to 2,000 ms pass factor 3/4 and the ceiling. The HTML unclosed-paragraph case and log alternating-line case literally use their own shape as fallback (HS:475/HS:72; LS:426/LS:398). A small quadratic term can also remain under the absolute bound. Sequential windows see different GC/load.

No new production quadratic path is established. Keep practical bounds, but use paired multi-size scaling or independent reference work to support stronger complexity claims and emit candidate/reference times on failures. R3 already raised the general limitation; it is not counted again.

## Independent performance observations

Three sequential runs per shape. HTML/log cap probes ran before this review's Nx job. Other Node/Nx jobs were present, so **idle-machine status was not verified**. No independent cap sample exceeded 1,500 ms.

| Shape | Input chars | Samples (ms) | Outcome |
| --- | --- | --- | --- |
| Original ragged table n=6000 | 2,097,152 | 63 / 34 / 34 | Extracted, 96,003 output chars |
| Sibling scripts | 2,097,147 | 76 / 80 / 68 | visible only |
| Unclosed paragraphs | 2,097,152 | 691 / 665 / 622 | Extracted |
| Paragraphs under 500 quotes | 2,097,152 | 674 / 669 / 666 | Original retained |
| Unclosed list items | 2,097,150 | 650 / 644 / 830 | Extracted |
| Stray < characters | 2,097,152 | 273 / 138 / 161 | Original retained |
| Unterminated huge style attribute | 2,097,152 | 2 / 0 / 0 rounded | EOF refusal, not style-parser benchmark |
| Alternating log lines | 2,097,152 | 241 / 129 / 132 | Reduced |
| Log newlines only | 2,097,152 | 451 / 290 / 364 | Reduced, non-empty marker |
| Huge single log line | 2,097,152 | 15 / 11 / 6 | Original retained |

The implementation cap is UTF-16 string length (H:115), not UTF-8 bytes. The scoped suite exercised other listed families; Nx's success tail does not expose their times.

## Log assessment

L:168–180 unconditionally forces head 40/tail 80 and ±3 groups around matching errors, even at budget 1. Independent 1,000-line input with an error at 500 returned exactly the required set plus correctly counted gaps. Strict post-ANSI full-line equality at L:143 means same/same/other/same collapses only the first run (×2); a/b/a stays unchanged. Existing Jest/TypeScript/Python/stack cases pass (LS:267–284).

A repeated context group can retain more than ±3 raw lines, not fewer. Blank lines do not collapse (L:142). Error recall remains heuristic (L:68–71); repeated identical errors collapse with explicit counts despite the recorded plan wording. Final cut/spool is Batch 2e (batches.md:234–240); reducer-level retention does not certify tail retention after that future cut.

## Data flow

1. src/index.ts:12–13 exports reducers — OK at library boundary.
2. L:87–94 strips ANSI/groups/finds errors — OK tested.
3. L:168–181 forces required set/grows regions — D1 fixed.
4. T:207–210 builds per-call tree; T:359–398 scans quote-aware tags — D3 fixed.
5. T:409–425 refuses raw-text uncertainty/handles script — R3-2/D2 originals fixed.
6. T:579–652 classifies visibility; T:722 discards text — defect 3 loses content before rendering.
7. H:140–143 measures/selects/renders; H:277–287 preserves semantic roots — D8 fixed.
8. H:397 escapes, H:408 concatenates, H:458/H:636/H:654 adds contextual syntax — defect 1.
9. H:529–542 fences pre — original whitespace/fence controls pass.
10. H:639–648 serializes each code leaf — defect 2.
11. H:583–627 orders table content/pads header only — D5/D6/N5 originals pass.
12. H:120–132/H:149–153 returns original on refusal — identity works; semantic successes bypass recovery.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| D1–D8, N1–N5 original fixes | COMPLETE for literals | Broader semantics incomplete |
| R3-1 original examples | COMPLETE for literals | Defect 1 still defeats general escaping |
| R3-2 xmp/plaintext | COMPLETE | Exact refusal confirmed |
| Head/tail/error context/exact consecutive dedupe | COMPLETE for current requested behavior | Recorded non-error-only plan wording differs |
| Preserve visible content and meaning | PARTIAL | Defects 1–3 |
| Remove specified raw/hidden content | PARTIAL overall | Raw sibling controls pass; overrides misclassified |
| Byte-preserving refusals/non-empty output | COMPLETE checked scope | No semantic validation of successes |
| Bounded observed cap cost | COMPLETE tested families | Idle status unavailable; guards do not prove all paths linear |
| No new runtime parsing dependency/pure functions | COMPLETE within read code | No package-diff claim |
| Project test/lint/typecheck | COMPLETE | All three report success |
| Raw spool/final cut | OUTSIDE BATCH | Batch 2e not reviewed |

Implicit requirements unaddressed: serialization across nodes, safe label/destination contexts, and visibility inheritance/overrides.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/nonempty refusals | YES tested | Original retained H:131–132 | Whitespace-only input may legitimately remain whitespace-only |
| BOM/CRLF refusal | YES | Original unchanged | Explicit raw-text/CSS controls |
| Repeated/concurrent calls | YES by construction | Per-call tree/renderer/selection; no timers/listeners/I/O | No asynchronous race boundary |
| Deep semantic leaf | YES original | H:436–439 refusal | Other layout flattening is deliberate |
| Isolated long-backtick code/pre | YES controls | H:537/H:646 | Adjacency fails, defect 2 |
| Backslashes/split entities | NO | Per-node partial escaping | Defect 1 |
| Heading/label/destination punctuation | NO documented cases | Context gaps | Defect 1 |
| Visibility-restoring child | NO | Whole-subtree removal | Defect 3 |
| Known huge adversarial families | YES observed | Forward scans/bounded rendering | No universal/idle proof |

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for the three demonstrated semantic families and literal-regression results; **MEDIUM** for remaining HTML/CSS conformance and untested scaling.
- Top risk: a successful html-extract response still silently changes or removes visible content on valid small inputs.
- What a robust implementation would add: context-aware escaping across node boundaries, coordinated code-span/whitespace rendering, conservative visibility-override handling, DOM-differential assertions, and paired scaling evidence.
- This review does not authorize another correction round, change task state or commit anything.

