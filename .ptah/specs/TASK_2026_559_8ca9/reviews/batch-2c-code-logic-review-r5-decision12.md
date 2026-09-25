# Code Logic Review — TASK_2026_559_8ca9

## Summary

Independent Batch 2c, User Decision 12 review, 2026-09-26. **Verdict: REVISE.** Output was evaluated as plain text throughout. No finding depends on interpreting output as Markdown or HTML. The accepted log reducer was not reviewed.

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 4 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Failure modes found | 7 numbered defect families |

All earlier HTML literal failures now produce correct plain text or byte-identical refusal. New inputs demonstrate hidden-content promotion, visible-content loss and character corruption. These significant safety problems place the score below 5–6. Functional plain-text rendering, repaired regressions, correct identity paths and green scoped checks separate it from 1–2. Findings are remaining defects, not claims that this round introduced them.

Current-file aliases:

- **H**: libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts
- **T**: libs/backend/tool-output-reducers/src/lib/reducers/html-tree.ts
- **HS**: libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.spec.ts

## Earlier failure-input status

PASS means independent execution of the original literal/recipe, with expectations changed only for Decision 12. The independent assertion run passed 55 cases, including semantic regressions, hidden-element controls and BOM/CRLF refusals. D6/N1 recipes were independently executed as performance probes too.

| Earlier input | Status | Result / current evidence |
| --- | --- | --- |
| r1 D1 | EXCLUDED | Log-only; accepted by user, not re-reviewed |
| r1 D2 double-escaped script | PASS refusal | Original bytes; script-body reason. T:425/T:507; HS:525 |
| r1 D3 quoted end-tag attribute | PASS | shown, blank line, after; no attribute leakage. T:397/T:365; HS:539 |
| r1 D4 A numeric colon / B CSS comment | PASS | shown; SECRET absent. T:585/T:534; HS:543 |
| r1 D4 C none→block | PASS | shown + VISIBLE. T:593/T:657; HS:554 |
| r1 D5 units caption | PASS | Amounts in thousands, blank line, USD/newline/5. H:589/H:598; HS:570 |
| r1 D6 n=6000 ragged table, exact cap | PASS | 66 ms, exact expected unpadded rows, 35,997 output chars. H:574/H:585; HS:582 |
| r1 D7 trailing pre whitespace | PASS | Exact first/newline/last/two spaces/two newlines retained. H:517; HS:593 |
| r1 D8 standalone H1 | PASS | Only heading, as plain text requires. H:278; HS:597 |
| r2 N1 sibling scripts, cap recipe | PASS | 2,097,147 chars → visible, 203 ms. T:507; HS:617 |
| r2 N2 inline flow / block flex | PASS | Both retain VISIBLE. T:129/T:610; HS:630 |
| r2 N3 eight quotes, link and code | PASS | before link (/essential) after, blank line, literal text <span hidden>VISIBLE</span>. H:443/H:449/H:456; HS:650 |
| r2 N4 comment / numeric LF / lone CR | PASS | Comment retains LF; numeric LF/CR consumed. T:748/T:89; HS:665 |
| r2 N5 fostered DIV plus caption | PASS | OUTSIDE, CAPTION, CELL, separated by blank lines. H:565/H:598; HS:677 |
| r3 R3-1 shallow TT | PASS | Literal text <span hidden>VISIBLE</span>. H:408; HS:689 |
| r3 R3-1 eight-quote VAR/TT/TEXTAREA/SPAN | PASS | Same literal characters for all four. H:408/H:461; T:428 |
| r3 R3-1 script-looking paragraph | PASS | Literal text <script>VISIBLE</script>. H:408; HS:701 |
| r3 R3-2 XMP / PLAINTEXT | PASS refusal | Exact originals; raw-text reason. T:415; HS:716 |
| r4 defect 1 A backslash/angle and comment variants | PASS | Backslashes and decoded literal angles retained. H:408; HS:726 |
| r4 defect 1 B split entity / same-node backslash entity | PASS | Literal text &copy; / text \&copy;; no second decode across nodes. H:408/H:326; HS:728 |
| r4 defect 1 C literal link/image punctuation | PASS | Original punctuation retained. H:408; HS:729 |
| r4 defect 1 heading suffix / image-alt punctuation | PASS | literal # / [image: a](/wrong)]. H:456/H:663; HS:731 |
| r4 defect 1 generated label / destination / control | PASS | x\] (/correct), VISIBLE (/path\&copy;), ]/( (/a(b)). H:358/H:617 |
| r4 defect 1 angle URL / backslashed angle URL | PASS | Literal text <http://example.com> / text \<http://example.com>. H:408 |
| r4 defect 2 adjacent code / code-edge spaces | PASS | ab / A x B. H:443/H:301; HS:737 |
| r4 defect 3 hidden+display / visibility-restoring child | PASS refusal | Exact originals; conflicting visibility state not modelled. T:649/T:653; HS:745 |

## Scope and verification

Read H, T and HS in full, the four earlier reviews, context Decisions 7/12, Batch 2 safety rule/amendment, plan-validation risks and Batch 2c. Also inspected reducer types, barrel/project configuration and the sibling JSON identity/error contract. Task discovery found no task-description.md, implementation-plan.md or code-style-review.md. Ptah file search returned zero AGENTS.md files; native ancestor/target-directory checks found none. No listed Ptah file-read or Write tool was available; native reads and the apply_patch file tool were used. No reviewed source or task state was edited; no git operation or package-diff verification was performed.

Scoped ptah_get_diagnostics on H/T/HS: **0 errors, 0 warnings**.

Ran once:

    node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache

Completion tail:

    √ nx run @ptah-extension/tool-output-reducers:lint
    √ nx run @ptah-extension/tool-output-reducers:typecheck
    √ nx run @ptah-extension/tool-output-reducers:test
    NX Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
    Output of 3 successful tasks were not shown.
    Run duration: 25.9s
    Cache: Skipped (--skip-nx-cache)

No failed assertion was reported. PowerShell wrapped initial Nx stderr as NativeCommandError; the final Nx summary explicitly reports success. The output was saved so a failing assertion could be recovered without rerunning the suite.

Temporary .mjs probes bundled actual source with installed esbuild and used installed JSDOM for source textContent, tree and computed styles. Installed Playwright Chromium independently checked closed details and CSS resets because JSDOM does not resolve them faithfully. Output was never parsed as markup. No package was installed; input scripts/resources were not executed/loaded. Temporary scripts, bundle and Nx log were deleted after use; browsers were closed. Independent performance probes ran after Nx completed; an otherwise idle machine was not established.

## Five logic questions

### 1. How does this fail silently?

T:599 normalizes a CSS-invalid property into a valid override and exposes hidden text (3A). T:763 discards browser-fostered visible content (2). T:235/T:245 change decoded characters (1). H:456 emits closed details contents (4). All return success-looking html-extract.

### 2. What user action produces unexpected behaviour?

Reading encoded examples changes names/code points (T:67/T:233); reading a hidden table loses its visible fostered content (T:763); reading a collapsed disclosure exposes its closed body (T:648/H:456). A nested-link input stalls synchronous extraction beyond the requested threshold (H:653).

### 3. What input data produces a wrong answer?

Defects 1–4, 6 and 7 below give exact inputs and expected/actual plain text. They demonstrate altered characters, lost/promoted content, duplicate URLs and removed verbatim whitespace. H:624 also mistakes an unfinished equality comparison for proven inequality.

### 4. What happens when a dependency fails?

H:59 imports only a local parser and erased types. There is no external async, filesystem or network dependency. H:104 catches HtmlRefusal and unexpected exceptions; H:117 returns the untouched input. Size/depth/CSS/raw-text/visibility refusals and BOM/CRLF identity were checked. Catching an exception cannot cancel work already spent at H:653 or guarantee recovery from process-wide memory exhaustion. The per-call tree and renderer allocate no timers, listeners or external resources (H:121/H:278/T:213).

### 5. What is missing that the requirements never mentioned?

Browser table insertion can cross hidden ancestry (T:763); CSS whitespace is narrower than JS trim (T:599); shorthand resets affect visibility (T:601); closed details is hidden without ordinary descendant display:none (T:648); source-node count cannot prove normalized URL inequality (H:643). Modeling or conservative refusal is needed to satisfy the existing fidelity promise.

## Failure modes — numbered new defects

### 1. Blocking — Character-reference decoding changes browser text

- File: **T:67–83, T:228–245**, consumed by **H:408/H:501**. **HS:352–354** explicitly expects the valid é reference to remain encoded.
- Failure input:

      <main><p>caf&eacute; &amp without semicolon &#128; &NotEqualTilde;</p></main>

- Expected, from JSDOM textContent: café & without semicolon € ≂̸.
- Actual: caf&eacute; &amp without semicolon U+0080 &NotEqualTilde; — with an actual U+0080 control character in place of the displayed code-point label.
- Raw variant:

      <main><pre>A&nbsp;B&ensp;C&zwj;D</pre></main>

- Expected code-point sequence: A\u00a0B\u2002C\u200dD. Actual: A B CD.
- Current handling: limited named map, mandatory semicolon for named references, missing HTML numeric replacements and lossy space/joiner mappings. Pre is verbatim, so its changed spaces cannot be excused as ordinary whitespace collapsing.
- Impact: names, examples and data silently change; plain text has no later decoding stage to repair them.
- Recommendation: browser-compatible reference decoding, including context/numeric replacements, or refuse references the model cannot faithfully decode. Preserve code points in raw text.

### 2. Blocking — Hidden table ancestry discards browser-fostered visible content

- Files: **T:763–765/T:823–826**, **H:414–415/H:571**.
- Failure input:

      <main><p>shown</p><table hidden><div>VISIBLE</div><tr><td>SECRET</td></tr></table></main>

- Expected: shown\n\nVISIBLE, or exact-input refusal.
- Actual: shown, html-extract, with skipped 1 hidden element(s).
- JSDOM evidence: main children become P, visible DIV, hidden TABLE. DIV is moved before TABLE and is not under its hidden attribute. The custom tree keeps DIV inside TABLE and discards its text during scanning.
- Confirmed variants: hidden TBODY with a DIV outside a cell; and the following after the shown paragraph:

      <table><div hidden><tr><td>VISIBLE</td></tr></div></table>

  JSDOM moves the hidden DIV outside TABLE and leaves VISIBLE in a visible table cell. Extraction still drops it.
- Current handling: render-time foster ordering cannot recover text already discarded by parser visibility or a skipped hidden section.
- Impact: visible main-content text disappears despite the repaired simple foster/caption literal.
- Recommendation: resolve table insertion/foster parenting before visibility pruning, or refuse shapes where browser/custom ancestry diverge across a hidden boundary.

### 3. Blocking — CSS resolution both exposes hidden text and misses restored visibility

- Files: **T:599–606/T:601–602/T:648–661**.
- Failure input A, expressed as a JS string; \u00a0 is one literal NBSP:

      '<main><p>shown</p><div style="display:none;\u00a0display:block">SECRET</div></main>'

- Expected: shown. Actual: shown\n\nSECRET, html-extract.
- JSDOM and Chromium both retain only display: none in the CSS declaration and compute display:none. NBSP is part of an invalid property name. JS trim removes it, inventing a valid display property whose block value wins.
- Reverse-direction input:

      '<main><p>shown</p><div style="\u00a0display:none">VISIBLE</div></main>'

  Both DOM engines compute display:block; extraction returns shown.
- Failure input B:

      <main><p>shown</p><div hidden style="all:initial">VISIBLE</div></main>

- Expected: byte-identical refusal with conflicting visibility state not modelled, or faithful output if fully modeled. Actual: shown.
- Confirmed child-restoration variant:

      <main><p>shown</p><div style="visibility:hidden">SECRET<span style="all:initial">VISIBLE</span></div></main>

  Expected: refusal or shown + VISIBLE with SECRET absent. Actual: shown.
- Chromium computes display:inline on the reset hidden element and visibility:visible on the reset child; body.innerText is shown\n\nVISIBLE for both. JSDOM does not resolve all correctly, so it is not evidence for B.
- Current handling: JS trim/whitespace normalization exceeds CSS grammar; properties outside the whitelist, including all, are ignored. Explicit longhand conflict guards work, equivalent reset states do not.
- Impact: the safety boundary fails in both directions, including promotion of hidden text to agent-visible output.
- Recommendation: use CSS whitespace/token rules and refuse unsupported visibility-affecting shorthands. Include all resets in the conflict policy.

### 4. Blocking — Closed details contents are emitted as visible text

- Files: **T:648–661/T:680**, **H:82/H:456–459**.
- Failure input:

      <main><p>shown</p><details><summary>Title</summary><div>SECRET</div></details></main>

- Expected: shown\n\nTitle, or exact-input refusal.
- Actual: shown\n\nTitle\n\nSECRET, html-extract.
- Independent Chromium body.innerText is shown\n\nTitle. JSDOM reports ordinary display values on descendants and is not a disclosure-layout oracle.
- Current handling: open is read but used only for dialog. Details is an ordinary block and all children render.
- Impact: a common collapsed UI component contributes content that is not currently visible.
- Recommendation: model closed details/first summary, or refuse it conservatively; retain normal open-details content.

### 5. Serious — Anchor comparison decodes entire text nodes before enforcing its bound

- Files: **H:619–623/H:643/H:653–655**.
- Failure recipe:

      const cap = 2097152;
      const prefix = '<a href="/x">'.repeat(500);
      const input = prefix + '&amp;'.repeat(Math.floor((cap - prefix.length) / 5));
      reduceHtml(input, { budgetTokens: 2000 });

- Expected: comparison cost bounded by short href; no independent cap observation above 1,500 ms.
- Actual: 2,097,150 input chars, **2,203 ms**, html-extract, 420,630 output chars. Smaller same-family observations: 515 ms at 524,785 chars; 1,151 ms at 1,049,075 chars.
- Current handling: bounds are checked before visiting a node, but an arbitrarily large text node is decoded fully before its length is checked. Nearby nested anchors repeat this work. H:630–633's claimed href-length bound does not hold.
- Impact: synchronous host stall. This is a demonstrated threshold failure and unbounded-per-href comparison, **not evidence of superlinear scaling**; observed scaling is roughly linear and the depth cap supplies a constant global bound.
- Recommendation: incrementally decode/normalize and stop once enough normalized characters establish inequality, or precompute bounded subtree summaries once. Avoid full-node decoding per comparison.

### 6. Moderate — An unfinished anchor comparison is treated as proven inequality

- Files: **H:643–644/H:624–625/H:660**.
- Failure input:

      <main><p>go <a href="/x">    /x</a></p></main>

- Expected: go /x under the equal-URL rule. Actual: go /x (/x).
- Empty-node variant: put 25 empty SPAN elements before /x inside the anchor; same duplicate. Remove /x and the empty anchor produces go (/x).
- Current handling: raw character/node counts return undefined before final whitespace normalization. undefined is neither empty nor href, so it causes annotation. Source length and empty-node count do not establish normalized inequality/nonemptiness.
- Impact: URL suppression depends on invisible whitespace/empty markup; empty links gain text absent from their visible label.
- Recommendation: retain unknown as a distinct state or compute a correct bounded normalized summary. Annotate only proven nonempty, unequal text.

### 7. Moderate — Whitespace-only pre blocks violate the verbatim contract

- Files: **H:517–524**, secondary filter **H:424**.
- Failure input, exact JS string:

      '<main><p>shown</p><pre>  \n \n</pre><p>after</p></main>'

- JSDOM pre.textContent is two spaces, LF, one space, LF; there is no initial newline to consume.
- Expected under the documented block join: shown\n\n  \n \n\n\nafter, or exact-input refusal.
- Actual: shown\n\nafter.
- Current handling: trim-based emptiness removes the block; generic block filtering would remove it again.
- Impact: explicitly verbatim whitespace data/layout is lost on a narrow edge case.
- Recommendation: distinguish an empty block from nonempty whitespace-bearing verbatim content.

## Blocking issues

Defects **1–4** above contain file:line, literal inputs, expected/actual, impact and fixes. **3A** directly reproduces hidden-content promotion in both JSDOM and Chromium. Defect 4 is independently verified in Chromium; no JSDOM layout claim is made.

## Serious issues

Defect **5**: cap-sized anchor/entity input took 2,203 ms; full-node decoding defeats the advertised href-length comparison bound. It is not labeled quadratic.

## Moderate and minor issues

- Defects **6–7**: normalized equality/empty labels and whitespace-only pre fidelity.
- Minor dead-data residue: **T:65** still collects class, allocated/stored at **T:387–390**, but no H/T consumer remains. Remove unused collection unless a stated consumer needs it. No live Markdown escape/fence/delimiter renderer remains: **H:429–483/H:517–524/H:617–668** are plain-text paths. This is not an additional runtime failure family or a formatting complaint.

## Hidden-content and refusal assessment

| Boundary | Result | Evidence / limit |
| --- | --- | --- |
| hidden/direct display:none/visibility:hidden or collapse | PASS ordinary controls | T:648–662; HS:251/HS:543; CSS grammar gap is defect 3 |
| script/style/template/noscript/iframe/noembed/noframes | PASS independent sibling probes | T:29–38/T:423; shown retained, SECRET absent |
| xmp/plaintext | PASS refusal | T:415; exact bytes including BOM/CRLF controls |
| Comments/quoted end tags/double-escaped script | PASS literal controls and suite | T:283/T:317/T:397/T:425; HS:322/HS:525/HS:539 |
| hidden/closed-dialog/UA-none plus explicit non-none display | PASS refusal | T:649; hidden/block, dialog/initial, style/inline controls |
| Explicit descendant visibility restoration | PASS refusal | T:653; visible, inherit and initial under hidden/collapse |
| all resets and NBSP property names | FAIL | Defect 3; ignored shorthand/invented valid property |
| Fostered content crossing hidden table ancestry | FAIL visible-text retention | Defect 2 |
| Closed details | FAIL hidden-content removal | Defect 4, Chromium verified |
| aria-hidden alone | Outside required hiding policy | No finding |
| Stylesheet-only/opacity/clipping/off-screen hiding | Declared limit | H:49–51; not counted as defects |
| Every explicit refusal retains original bytes | PASS code inspection and executed cases | H:101–118/H:123–139; no normalization on identity |
| Nonempty input never yields empty output | PASS inspected guard/probes/suite | H:130–139; HS:9–21/HS:432 |

No universal browser-conformance claim is made. Visibility:hidden descendants were inspected directly for restoration, not blindly pruned in the oracle.

## Independent cap timings

Single observations in UTF-16 input characters, matching **H:101**, not UTF-8 bytes. No idle-machine or universal time-bound claim.

| Shape | Input chars | Time | Outcome |
| --- | --- | --- | --- |
| Original ragged table n=6000 | 2,097,152 | 66 ms | Exact sparse-row expectation |
| Original sibling scripts | 2,097,147 | 203 ms | visible |
| Unclosed paragraphs | 2,097,152 | 1,091 ms | Extracted |
| Paragraphs under 500 quotes | 2,097,152 | 1,215 ms | Extracted |
| Stray less-than signs | 2,097,152 | 107 ms | Original retained |
| Giant valid color style attribute | 2,097,152 | 148 ms | Extracted |
| Entity text under 500 short-target anchors | 2,097,150 | **2,203 ms** | Defect 5 |

An initially over-cap style construction only exercised the size refusal and is excluded; the correctly sized sample above measures parsing. **HS:67–72** permits elapsed >1,500 ms under a relative reference and hard ceiling, so green suite checks do not contradict 2,203 ms. The anchor step stack avoids child-array copying (**H:641–651**), but does not bound node decoding (**H:653**).

## Data flow

1. Public export (**src/index.ts:13**) and pure reducer contract (**src/lib/reducer.types.ts:1**) — OK library boundary; pipeline/spooling outside review.
2. Length guard and extraction catch (**H:100–118**) — OK identity paths.
3. Forward scanner (**T:270–433**) — original tokenizer cases pass; reference decoder defect 1.
4. Styles/visibility (**T:585–663**) — explicit conflicts refuse; defect 3; closed-details policy missing, defect 4.
5. Tree/text attachment (**T:748–765/T:823–826**) — irreversible fostered-text loss, defect 2.
6. Measure/select/fallback (**H:166–230**) — documented heuristic; generated-page HS:143–174 passes. No universal boilerplate-recognition claim.
7. Plain-text rendering (**H:278–668**) — original semantics pass; link/pre defects 5–7.
8. Empty/nonshrinking fallback/success (**H:130–148**) — OK nonempty/refusal guarantees; cannot detect semantically wrong nonempty output.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Earlier HTML literal regressions | COMPLETE | Independent reruns; D1 excluded as requested |
| Plain text with no Markdown escaping/fences/heading syntax | COMPLETE | H:429–483/H:517/H:617; original r4 cases pass |
| Heading/block/list/table/link/image layout | PARTIAL | Ordinary fixtures pass; URL suppression defect 6 |
| Entities decoded to browser characters | PARTIAL | Defect 1 |
| Code/pre raw text verbatim | PARTIAL | Entity mappings and whitespace-only pre, 1/7 |
| Hidden text omitted, visible main content preserved | PARTIAL | Defects 2–4 |
| Restored/conflicting visibility refuses | PARTIAL | Explicit longhands pass; reset bypass, 3 |
| Identity refusals/no empty-for-nonempty | COMPLETE inspected/tested scope | H:100–139; no OOM recovery promise |
| Linear work/cap performance/bounded anchor comparison | PARTIAL | Old quadratic paths repaired; defect 5 exceeds threshold and href bound |
| No new runtime dependency/LLM/I/O | COMPLETE within reviewed source | Package diff not verified; no git operations allowed |
| Removed Markdown renderer dead code | PARTIAL | Renderer gone; unused class collection remains |
| Scoped test/lint/typecheck | COMPLETE | All three targets passed |

Implicit requirements needing coverage: CSS token/reset semantics, disclosure state, table insertion ancestry, normalized bounded equality and character-reference fidelity.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/no-element/hidden-only | YES | H:123/H:135 identity | Refusal may contain original hidden markup, as authorized |
| Oversize/deep/malformed | YES tested refusal paths | H:101/T:805/H:106 | Successful malformed parses can still have wrong ancestry |
| BOM/CRLF refusal | YES | H:117 exact equality | No rewriting |
| Punctuation/adjacent code | YES originals | H:301/H:443 | No Markdown interpretation applied |
| Unlisted entities/raw reference spaces | NO | T:67/T:233 | Defect 1 |
| Hidden table foster parenting | NO | T:763 | Defect 2 |
| Explicit longhand restoration | YES | T:649/T:653 refusal | Equivalent reset still missed |
| NBSP CSS/all reset | NO | T:599/T:601 | Defect 3 |
| Closed details | NO | H:456 generic block | Defect 4 |
| Giant entity node in link comparison | NO threshold/bound | H:653 | Defect 5 |
| Equal href with empty nodes/leading spaces | NO | H:624 | Defect 6 |
| Whitespace-only pre | NO | H:521 | Defect 7 |
| Repeated/concurrent calls | YES by construction | H:121/H:278/T:214 per-call state | No session growth/timers/I/O |

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for reproduced defects and earlier literal statuses; **MEDIUM** for remaining browser conformance/general performance.
- Top risk: successful plain-text extraction still promotes hidden text and removes or changes visible content.
- What a robust implementation would add: faithful references or refusal, CSS-token/reset-aware visibility, table-boundary/disclosure handling, incremental normalized anchor summaries and nonempty verbatim whitespace preservation.
- This review does not edit source, change task state, perform a commit or authorize another implementation round.

