# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 3 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 4 |

Independent review of the post-cap bounded correction, Batch 2b Task 2b.2, Markdown only. JSON was not reviewed. All three exact r3 inputs now behave correctly, but three distinct HTML-scanning gaps still silently detach headings from their enclosing HTML. The required verification also fails one timing assertion.

Score 5 rather than 3–4: the lexer, reconstruction, selection and rendering work on earlier regressions, and the resource guards now stop the demonstrated r3 inputs. Below 7–8: confirmed context loss remains in the central preservation contract.

Evidence aliases: **M** = `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts`; **S** = its adjacent `markdown.reducer.spec.ts`. Relative paths refer to the named worktree. **F** means exactly 30 copies of `body line more prose text` joined by LF. Inputs below use JavaScript string notation.

## Exact r3 inputs

All three archived inputs were executed against current source in a temporary Node probe. Lexer calls were counted by wrapping `Lexer.prototype.blockTokens` inside that disposable process.

| Input | Expected and observed | Evidence |
| --- | --- | --- |
| D1: `'# Top\n<details>\n<!-- </details> -->\n\n# delete production\n\n</details><!-- <details> -->\n' + F`, budget 1 | Original unchanged; `HTML element spans Markdown blocks`; 1 lexer call; 5.72 ms | M:297, M:317, M:144; S:255 |
| D2: `'# A\n' + '> x\nx\n'.repeat(42666)`, budget 2000, length 256000 | Original unchanged; `block quote continuation too costly to outline safely`; zero lexer calls; 34.55 ms | M:122, M:239; S:885 |
| D3: `'\ufeff' + '> '.repeat(1000) + 'x'`, budget 1 | Original unchanged; `container nesting too deep to outline safely`; zero lexer calls; 0.19 ms | M:116, M:119; S:295 |

These are local measurements, not latency guarantees. Subsequent probes confirmed identical outcomes.

## Five logic questions

### 1. How does this fail silently?

`stripComments` removes comment-shaped strings without first checking attribute context (M:297, M:332). `scanHtml` interprets inline code as markup (M:306), and its raw-text set omits iframe (M:98). Each can produce zero wrapper tallies and allow M:637 to output an enclosed heading alone. Defects 1–3 return normal `markdown-outline` success responses.

### 2. What user action produces unexpected behaviour?

Outlining the HTML/Markdown examples below at budget 1 exposes `# delete production` outside its details container (M:141, M:144, M:164). The required scoped verification also fails its nested-list timing assertion (S:880). That latter observation is a validation failure, not proof of equivalent production latency.

### 3. What input data produces a wrong answer?

A literal comment opener in a quoted attribute, a backtick code span containing a counter-tag, or counter-tags inside iframe text defeats the tally (M:98, M:297, M:306). Installed `marked.parse` plus installed JSDOM independently confirmed each original heading has a `details` ancestor and each reduced heading does not.

### 4. What happens when a dependency fails?

Lexer exceptions return original input with the error name (M:129); an injected RangeError probe verified BOM/CRLF preservation. Reconstruction failures return original input (M:135; duplicate-definition regression S:310). Token-counter exceptions propagate from M:385 and `libs/backend/tool-output-reducers/src/lib/token-measure.ts:30`; the later pipeline owns that handling. No I/O, timers, subscriptions or resource handles are created here. The catch at M:131 cannot interrupt slow synchronous lexing.

### 5. What is missing that the requirements never mentioned?

Rule H must distinguish real markup from literal attribute, code-span and raw-text content. The recipe accepts a code-span false positive (`batches.md:489`), but does not authorize false negatives that remove actual wrappers. Also, the restart metric is not a general proof of marked complexity (M:239), and Jest's recursive lexer spy can materially affect timing (S:868).

## Failure modes / numbered defects

### 1. Attribute-contained comment markers erase real wrapper tags

- Severity: **Blocking** — silent misleading context loss.
- File: M:297, M:328, M:332, M:336, M:340; consequential output M:637.
- Trigger / exact failure input, budget 1:

~~~js
'# Top\n<img title="<!--">\n<details>\n-->\n\n# delete production\n\n<img title="<!--">\n</details>\n-->\n' + F
~~~

- Expected: original unchanged with an HTML-context reason, or preservation of the entire enclosing context. The comment opener is inside an image attribute value.
- Actual: `markdown-outline`, text `'# Top\n# delete production\n\n(section text omitted, 36 lines)'`; notes `['headings alone exceed the token budget; kept every heading']`.
- Current handling: stripping removes everything from each attribute's comment opener through the later comment closer, including the real details tag. The remainder is an incomplete image tag with no recognized block tag; neither the ambiguity conjunction at M:141 nor tally at M:144 rejects it.
- Impact: an instruction belonging to a details container becomes an unconditional heading. The independent DOM probe confirmed loss of the ancestor.
- Recommendation: identify quoted attribute context before stripping comments, or conservatively decline when that distinction cannot be made. Add this literal regression; S:263 only tests tag-shaped text in attributes.

### 2. Inline code counter-tags cancel actual inline HTML wrappers

- Severity: **Blocking** — silent misleading context loss.
- File: M:139, M:306, M:314, M:317; consequential output M:637.
- Trigger / exact failure input, budget 1 (literal single-backtick code spans):

~~~js
'# Top\ntext <details> `</details>`\n\n# delete production\n\ntext </details> `<details>`\n\n' + F
~~~

- Expected: original unchanged with a spanning-HTML reason, or retention of the full details region. Tags inside code spans are literal text.
- Actual: `markdown-outline`, text `'# Top\n# delete production\n\n(section text omitted, 32 lines)'`, with the headings-only note.
- Current handling: excluding top-level `code` tokens at M:139 does not exclude code spans in paragraph raws. Each paragraph balances its real tag against the opposite literal tag in its code span. The installed parser renders the supposed closing tag as `<code>&lt;/details&gt;</code>`, confirming it does not close the wrapper.
- Impact: the enclosed heading loses its details context although the raw-membership oracle accepts it (S:41).
- Recommendation: account for inline literal/escape context before counting paragraph tags, or conservatively return unchanged where code spans and structural tags coexist. This need not introduce the prohibited inline lexer into production. The accepted recall-only false positive in `batches.md:489` does not cover this unsafe false negative.

### 3. Iframe raw text can still fake wrapper balance

- Severity: **Blocking** — silent misleading context loss.
- File: M:98, M:302, M:306, M:317; consequential output M:637.
- Trigger / exact failure input, budget 1:

~~~js
'# Top\n<details><iframe></details></iframe>\n\n# delete production\n\n<iframe><details></iframe></details>\n' + F
~~~

- Expected: original unchanged with an HTML raw-text/context reason. Tags inside iframe text do not change the outer details element.
- Actual: `markdown-outline`, text `'# Top\n# delete production\n\n(section text omitted, 32 lines)'`, with the headings-only note.
- Current handling: `RAW_TEXT_OPEN` covers script/style/textarea/pre/title but not iframe. Each token counts iframe's inner details counter-tag as real, yielding zero tallies and no ambiguity. The DOM probe confirms the original heading remains inside details.
- Impact: the same context-loss class through a separately unsupported raw-text state.
- Recommendation: cover relevant HTML raw-text states, including iframe, or conservatively reject unsupported raw-text elements around wrappers. The five-name set is insufficient. S:275 exercises textarea only.

### 4. Required nested-list timing verification fails

- Severity: **Moderate** — observed acceptance-check failure; production slowdown is not established.
- File: S:863, S:864, S:868, S:880; production entry M:130/M:180.
- Trigger / exact input:

~~~js
const line = '- '.repeat(16) + 'x\n';
const doc = '# Top\n\n' + line.repeat(Math.floor((262144 - 7) / line.length));
// reduceMarkdown(doc, { budgetTokens: 2000 }), under the test's lexer spy.
~~~

- Expected: elapsed below 1000 ms and all three required Nx targets green.
- Actual: **1219.8655 ms** at S:880; 1 test failed, 160 passed. Lint and typecheck succeeded. Correctness assertions before the timing assertion passed.
- Current handling: synchronous lexing runs, as intended. Nx labels the task flaky. This measurement includes test instrumentation and concurrent validation activity; standalone 30-level nested lists took 411.88 ms, so it does not establish a standalone production >1000 ms family.
- Impact: the required green gate and timing criterion cannot be certified from this run.
- Recommendation: investigate under controlled benchmarking and distinguish recursive-spy overhead/host contention from production cost. Retain a meaningful acceptance bound rather than merely raising it. The failed suite was not rerun.

## Blocking issues

Defects 1–3 are three distinct scan-context errors with confirmed ancestor loss. They can share a context-aware solution but require distinct regression coverage.

## Serious issues

None independently substantiated. No standalone crafted family measured above 1000 ms.

## Moderate and minor issues

Defect 4 is the counted moderate issue. Coverage limitation, not an additional shipping defect: S:43 uses set membership, so the oracle alone does not prove order, multiplicity or HTML ancestry. Rendering order was checked separately at M:584 and M:631.

## D1/D2 soundness and performance

The HTML regex (M:95) has disjoint attribute alternatives: unquoted characters exclude quotes and angle brackets, and quoted alternatives consume a closing quote. The optional terminal angle bracket permits an incomplete match instead of requiring suffix retries. No super-linear regex family was found. The comment scan advances its position beyond each closing marker (M:341) and returns immediately for an unclosed comment. Defects 1–3 are lexical correctness failures, not measured complexity failures.

The quote-cost implementation is linear: one split followed by bounded scans of each line and one product per run (M:249). Resetting `runLines` ensures a new run does not use stale depth to count a first-line restart. This bounds the measured restart families; it is not a proof of all marked execution paths.

Standalone probes used production code, warmed token counting and a lexer-call counter; the timed reducer never ran an inline pass. Repeated units filled the largest whole repetition under 262144 code units after `'# A\n'`.

| Family | Length | Time ms | Result |
| --- | ---: | ---: | --- |
| Bullet-separated lazy quotes: `> x\nx\n- x\n` | 262144 | 338.04 | Lexed |
| Bullet-separated lazy quote-lists: `> - x\nx\n- x\n` | 262144 | 364.20 | Lexed |
| Nested quote list items: `- > > x\n  > x\n- x\n` | 262138 | 183.98 | Lexed |
| 30-level quotes | 262140 | 45.27 | Lexed |
| 30-level lists | 262140 | 411.88 | Lexed |
| 15 mixed list/quote levels then a bullet | 262090 | 316.95 | Lexed |
| Same-depth quote list/text: `> - x\n> x\n` | 262144 | 150.90 | Lexed |
| List-contained lazy quote continuations | 262144 | 117.43 | Lexed |
| Lazy quote with 1000-character continuation lines | 261304 | 20.49 | Lexed |
| 500-character reference destinations | 262112 | 3.33 | Reconstruction fallback |
| Malformed repeated reference definitions | 262123 | 9.95 | Lexed |
| Near-cap reference label/title/unclosed destination | 262127–262133 | 14.42–21.12 | Lexed |
| Nested-parenthesis reference destination | 260010 | 18.81 | Lexed |
| Repeated opening brackets by line | 262144 | 48.64 | Lexed |
| Setext candidates: `a\n= x\n` | 262144 | 21.39 | Lexed |
| Many setext headings: `a\n===\n` | 262144 | 80.19 | No-body fallback |
| Near-setext spaced markers | 262084 | 14.64 | Lexed |
| Emphasis-heavy lines / near-cap single line | 262005–262140 | 6.11–19.08 | Lexed |
| Repeated quoted/unclosed HTML starts | 195004–262099 | 5.42–35.44 | Lexed |
| Repeated unclosed comment markers | 260004 | 16.92 | Lexed |
| Quote blank lines / tab quotes / ordered quote items | 262144 | 12.61–21.41 | Quote-cost fallback |

Twenty-nine exploratory families ran across two probe batches. None exceeded 1000 ms standalone. The only measured >1000 ms case was the required Jest nested-list fixture in defect 4. Finite probes do not establish universal complexity.

Ordinary probe: `'# A\n\n<!-- prettier-ignore -->\n\nUse <kbd>Enter</kbd><br> here.\n\n' + F`, budget 40, retained the comment and entire inline-HTML paragraph, then emitted `(30 lines omitted)`. A balanced standalone div also reduced. No needless refusal was observed for the requested ordinary examples (M:297/M:314). The conservative ambiguity rule at M:141 may decline other documents; optimal recall is not asserted.

## Data flow

1. **OK:** original size cap precedes normalization (M:111); CRLF/lone CR normalize and one initial BOM is removed (M:116).
2. **OK:** precisely the same `text` reaches the nesting guard, quote guard and lexer (M:119, M:122, M:130). BOM and lone-CR deep-prefix probes made zero lexer calls.
3. **OK:** fresh options and lexer, block pass only (M:180); exceptions and reconstruction mismatch return original input (M:133/M:136).
4. **GAP:** HTML scans precede selection, but defects 1–3 fake balance (M:138).
5. **OK at raw level:** sections and round-robin decisions use whole tokens (M:346/M:467).
6. **OK at raw level:** render visits source tokens in order, appending exact selected raws and following separators (M:584/M:598). Writer adds permitted note separators (M:527/M:535); headings-only adds authorized terminators (M:637).
7. **OK:** every unchanged exit uses original `input` (M:170). No body, no omissions and no surviving content have explicit fallbacks (M:155/M:606/M:610/M:634). Nonempty input cannot become empty.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Exact r3 inputs corrected | COMPLETE | Independent probes; S:251/S:885 |
| Earlier r1/r2 inputs corrected | COMPLETE for named cases | Nine independent exact-output probes; S:176/S:601 |
| D1 enclosing HTML context | PARTIAL | Defects 1–3 |
| D1 regex/comment-scan cost | COMPLETE within examined families | M:95/M:328; no demonstrated super-linear scan |
| D2 linear quote guard | COMPLETE | M:239; original costly input rejected before lexer |
| D2 general performance acceptance | PARTIAL | No standalone >1000 ms family; required fixture fails |
| D3 guard/lexer input equivalence | COMPLETE | M:116–130; BOM/lone-CR probes |
| Original unchanged bytes | COMPLETE in inspected paths | M:170; 102 unchanged-result equality checks |
| Optional BOM + kept raws in order + permitted notes | COMPLETE at raw level | M:527/M:584/M:637; semantic HTML loss remains |
| Nonempty input never empty | COMPLETE in inspected paths | Fallbacks above; probe matrix |
| Required scoped checks | PARTIAL | Lint/typecheck pass; 160 tests pass, 1 fails |

Implicit requirement still unmet: HTML context cannot be inferred from a tally that treats literals as markup.

## Edge cases

| Case | Handled | How / concern |
| --- | --- | --- |
| r1 multiline setext, four-space fence, list fence, comment heading | YES | Exact-output probes passed; S:601 |
| r2 HTML/paragraph→setext separators | YES | Budget-70 exact-output probes; S:180/S:188 |
| r2 list continuation/outdented fence | YES | Exact-output probe; S:205 |
| Ordinary spanning details/nested div | YES | Original unchanged; S:229/S:240 |
| r3 real-comment counter-tags | YES | S:257 and exact probe |
| Comment-looking attributes | NO | Defect 1 |
| Code-span counter-tags | NO | Defect 2 |
| Iframe raw-text counter-tags | NO | Defect 3 |
| BOM/deep first line; lone CR before deep line | YES | Zero lexer calls; M:116/M:119 |
| CRLF/CR/BOM on unchanged paths | YES | 102 equality checks over budgets 0/1/20/2000 |
| Duplicate definitions and injected lexer throw | YES | S:310/S:319; probes |
| Zero budget/no headings/blank-only | YES for nonempty contract | M:155/M:610/M:634 |
| Over-cap input | YES | Original fallback before scan, M:111 |
| Required nested-list timing | NO in this run | 1219.8655 ms; S:880 |

## Verification and scope

- Read both named source/spec files in full, archived r3 findings, relevant Markdown r1/r2 evidence, task context, binding Decision 9 section, reducer types, token measure and project configuration. The task folder contains no task-description.md, implementation-plan.md or style review. No JSON source review was performed.
- `ptah_search_files` returned no AGENTS.md; native checks of applicable ancestor directories also found no instruction file. No direct file-read/Write tool is listed; native reads and the file patch writer were used. No source edits or git operations were performed.
- Scoped `ptah_get_diagnostics`: **0 errors, 0 warnings**.
- Ran exactly once: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers`. Exit 1. Lint/typecheck succeeded; tests failed only at S:880. Read retained output at `C:/Users/abdal/.nx/d66630b900f534d5/cache/terminalOutputs/7849581431703440869`; corresponding `cache/run.json` records this command and task statuses at 2026-09-25 18:50:09–18:50:20 UTC. The suite was not rerun. Relevant tail:

~~~text
Test Suites: 1 failed, 3 passed, 4 total
Tests:       1 failed, 160 passed, 161 total
Time:        9.95 s
Failed tasks:
- @ptah-extension/tool-output-reducers:test
~~~

  Nx separately reported a disabled free-plan Cloud organization/401. The local assertion failure is independently recorded.
- Independently checked r1 S1–S4; r2 d1a/d1b, d2, d3 and nested-div variant. All nine exact expected results passed. The other 160 suite tests passed, including the nine added timing families and headings-only separator variants.
- Probe matrix covered LF/CR/CRLF, BOM, no-heading/blank/heading-only documents, tiny/normal budgets, duplicate references, size/depth/quote fallbacks and injected RangeError. Every nonempty case remained nonempty; all 102 unchanged results equalled their originals.
- Temporary .mjs files used installed TypeScript to transpile current reducer/token-helper source in memory; installed marked/gpt-tokenizer executed it. Installed JSDOM independently verified HTML ancestry. Timing probes retained the production block-only lexer path. Files were placed under `C:/Users/abdal/AppData/Local/Temp` and removed after use; no large inline shell script was used.
- Residual uncertainty: finite tests cannot prove all CommonMark/HTML combinations or worst-case lexer complexity. The timing failure cannot alone establish production latency. The three HTML defects are confirmed semantic failures.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for confirmed context loss and the recorded test failure; limited for universal timing claims.
- Top risk: a successful outline still exposes a heading outside its enclosing details context.
- What a robust implementation would add: attribute-aware comment handling, code-span-aware or conservative HTML scanning, complete raw-text ambiguity coverage, the three semantic regressions and a resolved timing gate.
- This review does not authorize another correction round or alter task state.

