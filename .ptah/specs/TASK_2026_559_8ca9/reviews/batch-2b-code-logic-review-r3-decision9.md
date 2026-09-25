# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION (requested verdict: REVISE) |
| Blocking issues | 1 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 3 |

Independent Decision 9 review of **Batch 2b, Task 2b.2 only**. JSON was not reviewed. All earlier reproductions now pass, but an HTML-context failure and two resource-guard gaps remain. This is above 3–4 because the lexer rebuild fixes the prior ordinary structural failures and implements the specified reconstruction/rendering contracts. It is below 7–8 because valid input can still lose its enclosing HTML context silently, and a guarded-size input can block the host for seconds.

Path aliases used throughout: **M** = `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts`; **S** = `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.spec.ts`. All other paths are worktree-relative. `F` below means exactly 30 copies of `body line more prose text`, joined by LF.

## Earlier failure inputs

These were independently executed against current source using a temporary Node probe, as well as covered by the passing suite. The seven named groups contain eight concrete inputs because d1 has two variants.

| Input | Result | Evidence |
| --- | --- | --- |
| r1 S1, multiline setext, budget 1 | Complete `DO NOT\ndelete production\n---` retained; one-line omission note | M:143, M:507; S:540 |
| r1 S2, four-space fence-like closer, budget 30 | Whole five-line code block omitted; `Top` and `Next` retained | M:143, M:453; S:547 |
| r1 S3, fence on list-item line, budget 30 | `(list, 3 lines, omitted)`; `Top` and `Next` retained | M:143, M:453; S:556 |
| r1 S4, heading inside HTML comment, budget 30 | `# Top\n\n(33 lines omitted)\n\n# Next\nnext`; no promoted heading | M:143, M:462; S:570 |
| r2 d1a, HTML then setext, budget 70 | Exact HTML retained with the blank line before `Real heading\n---`; 30-line omission note | M:464; S:176 |
| r2 d1b, paragraph then setext, budget 70 | Exact paragraph retained with the blank line before `Real heading\n---`; 30-line omission note | M:464; S:184 |
| r2 d2, list continuation then outdented fence, budget 30 | `# Top\n\n(7 lines omitted)\n\n# Next\n\n(30 lines omitted)` | M:143, M:445; S:201 |
| r2 d3, mixed details/Markdown, budget 1 | Original input byte-identical, `HTML element spans Markdown blocks` | M:107; S:225 |

The d1 budget-1 cases and nested-div d3 variant are explicitly asserted in S:195 and S:236. They passed in the scoped suite.

## Five logic questions

### 1. How does this fail silently?

Rule H counts tag-shaped text inside HTML comments as real tags (M:206, M:211). A comment can cancel an actual wrapper opening or closing, allowing headings-only rendering to detach a heading from that wrapper (M:507). Defect 1 reproduces this and returns an ordinary `markdown-outline` result.

### 2. What user action produces unexpected behaviour?

Outlining a long but shallow blockquote with lazy continuation lines blocks synchronously for approximately 8.2 seconds under the size cap (M:88, M:99, M:143; defect 2). Outlining a BOM-prefixed document can send deeply nested first-line containers into the lexer despite the nesting guard (M:91, M:95; defect 3).

### 3. What input data produces a wrong answer?

The valid mixed HTML/Markdown input in defect 1 exposes `# delete production` without its enclosing `<details>` context. Individual raw tokens and heading text remain unchanged, so the structural oracle still accepts the result (S:41). This is a semantic context loss, rather than a line-rewriting failure.

### 4. What happens when a dependency fails?

Lexer exceptions return the original input with a named reason (M:98; injected RangeError spec S:257). Missing raw reconstruction also returns the original input (M:104; duplicate-definition spec S:248). Slow synchronous lexing has no timeout or cancellation boundary (M:143); a try/catch cannot bound elapsed time. Token-counting exceptions propagate from M:261 and `libs/backend/tool-output-reducers/src/lib/token-measure.ts:30`; the later pipeline owns that handling. No I/O, timers, subscriptions or disposable handles are created by this reducer.

### 5. What is missing that the requirements never mentioned?

The prescribed Rule H regex cannot distinguish comments/attributes from actual HTML tags (`batches.md:480`), the prescribed guard ordering checks a different first-line prefix than the lexer sees (`batches.md:468`, `:474`), and the performance fixture covers repeated nested list items but not lazy blockquote continuations (S:801). The implementation follows these narrow recipes; defects 1–3 also identify limitations in the approved design, not merely deviations from it.

## Failure modes / numbered defects

### 1. Comment text can cancel real HTML-wrapper tags

- Severity: **Blocking** — silent loss of context that misleads the recipient.
- File: M:75, M:206, M:211, M:507.
- Failure input, budget 1:

  `# Top\n<details>\n<!-- </details> -->\n\n# delete production\n\n</details><!-- <details> -->\n` + `F`

- Expected: `markdown-unchanged`, original input byte-identical, with a reason identifying unsupported/spanning HTML context. The real details element spans the Markdown heading; the tags inside comments do not close/open it.
- Actual, reproduced:

  `# Top\n# delete production\n\n(section text omitted, 33 lines)`

  Reducer is `markdown-outline`; notes say headings alone exceed the budget.
- Current handling: the opening HTML token gets tally zero because the commented closing tag cancels `<details>`; the closing HTML token likewise gets tally zero from its commented opener. The middle heading becomes independently retainable.
- Impact: a heading inside a collapsed example becomes an unconditional document heading, the same context-loss class as prior d3. The output also passes the current oracle: heading lists match and every non-note raw comes from the input.
- Recommendation: conservatively return unchanged for comment/attribute/raw-text ambiguity around wrapper tags, or use a context-aware HTML scan. Add this literal regression; token membership alone cannot verify wrapper context. Do not weaken the context-preservation requirement to match the tally heuristic.

### 2. Shallow lazy blockquotes cause seconds of synchronous lexer work

- Severity: **Serious** — a tool result blocks the host execution thread on a probable supported content shape.
- File: M:88, M:91, M:99, M:143; performance coverage S:801.
- Failure input: `'# A\n' + '> x\nx\n'.repeat(42666)`, `budgetTokens: 2000`. Length is **256,000 UTF-16 code units**, below 262,144; every container prefix is only two characters.
- Expected: bounded processing, using an unchanged fallback before entering an expensive lexer path when necessary. The existing under-cap performance fixture targets less than one second (S:817).
- Actual: returns `markdown-outline` after **8,205 ms** synchronously. Notes are `kept 0 of 85332 section lines` and `omitted 1 block(s)`. The body is one oversized blockquote; its reduction did not need that much lexer work.
- Scaling evidence: the same family at 64,000 characters took approximately 373 ms in the first probe; at 128,002 characters, **1,921 ms**; at 256,000, **8,205 ms**. The larger two were measured in one run after warm-up. This supports super-linear cost; it is not a universal complexity proof.
- Current handling: both guards pass, then `blockTokens` runs synchronously. Catching exceptions does not interrupt a slow successful call. Existing list-heavy timing coverage does not exercise this family.
- Recommendation: add a cheap conservative guard for large quote/lazy-continuation workloads, or another demonstrably bounded fallback before lexing. Add a regression for this family and measure scaling, not only a single repeated-list case. A timeout checked after lexing would not protect the host.

### 3. Leading BOM bypasses first-line nesting protection

- Severity: **Moderate** — an edge-case guard bypass with demonstrated deep recursion; no crash was induced.
- File: M:91, M:95, M:156, M:176.
- Failure input: `'\ufeff' + '> '.repeat(1000) + 'x'`, `budgetTokens: 1`.
- Expected: original input unchanged with `container nesting too deep to outline safely`, **zero lexer calls**, matching the identical content without BOM.
- Actual: original input eventually returned with `budget too small for any line`, after **1,001 calls** to `Lexer.prototype.blockTokens` (approximately 9 ms in this bounded probe). Without BOM the same nesting is rejected immediately with zero lexer calls. Even 66 prefix characters reproduce the reason mismatch.
- Current handling: the guard sees BOM as the first non-prefix character and stops examining that line. BOM is then stripped before the lexer sees the deep prefix.
- Impact: a BOM-bearing first line escapes the explicit heap/recursion protection. The observed probe demonstrates bypass, not heap exhaustion; increasing depth until process abort was deliberately unnecessary.
- Recommendation: make the guard ignore exactly the same initial BOM removed for lexing, while preserving the original input for fallback. Test BOM plus 65+ prefix characters and assert the lexer is never called.

## Blocking issues

Defect 1: M:206/M:211 count comment contents as structural HTML; M:507 then removes actual wrapper tokens and presents an inner heading without its original context. Preserve the wrapper or return unchanged.

## Serious issues

Defect 2: M:143 performs unbounded-duration synchronous work on a supported, below-cap shallow blockquote. Add pre-lex protection and a lazy-continuation performance regression.

## Moderate and minor issues

Defect 3: M:91 checks before the BOM is stripped at M:95, allowing the first-line nesting guard to be bypassed.

Coverage observations, not additional shipping defects: S:43 uses set membership, so it does not prove block order or multiplicity; the separate line-subsequence helper is not applied universally. S:809 calls `reduceMarkdown` directly and checks non-emptiness at S:816, so the list-heavy reduced result does not pass through the required structural oracle. These limitations do not negate the useful existing oracle checks.

## Data flow

1. **PARTIAL:** character cap and linear prefix guard run before lexing (M:88, M:156). Literal cap is implemented correctly; defects 2 and 3 limit its resource protection.
2. **OK:** CRLF/lone CR normalize to LF and a single initial BOM is carried separately (M:94). `unchanged` always returns the original input (M:133).
3. **OK:** fresh Lexer and fresh defaults/options on each call, top-level block pass only (M:143). Probe installed a throwing global `marked.use({ tokenizer: { heading() { throw ... } } })`; reducer output was identical before/after. No shared marked state is mutated by this source.
4. **OK:** concatenated raw tokens must reconstruct normalized input before selection (M:104). Duplicate definitions decline reduction instead of dropping text silently.
5. **PARTIAL:** HTML tally runs before heading selection (M:107); it fixes original d3 and nested divs, but defect 1 bypasses it.
6. **OK within reviewed contract:** sections derive from top-level headings (M:222); budgeting visits whole blocks round-robin and stops/replaces them by type (M:343). No retained raw is edited by selection.
7. **OK at raw/line level:** rendering visits source tokens in order, retains separators after emitted tokens, and inserts separate note paragraphs (M:403, M:411, M:460). Headings-only adds the authorized terminators (M:513). Nonempty input cannot become empty: no body returns original, no surviving body/heading returns original (M:118, M:486, M:510).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Earlier r1/r2 inputs fixed | COMPLETE | All eight concrete inputs independently reproduced successfully |
| Optional BOM + kept raws in input order + permitted notes/separators | COMPLETE in inspected rendering | Semantic HTML context is a separate gap, defect 1 |
| Never merge lines; nonempty input never empty | COMPLETE in inspected paths | Authorized headings-only newline insertion at M:514 |
| Reconstruction and original bytes on unchanged paths | COMPLETE | M:104/M:133; corresponding specs passed |
| Rule H literal tally algorithm | COMPLETE | Prescribed algorithm itself has defect 1 |
| Preserve mixed HTML/Markdown context or decline | PARTIAL | Defect 1 |
| Fresh isolated Lexer, no global mutation | COMPLETE | Source inspection and global-tokenizer probe |
| Size/nesting/catch guard implementation | PARTIAL | Size/catch correct; BOM bypass in defect 3 |
| Adequate protection against pathological input | PARTIAL | Defect 2 |
| Structural oracle catches old separator regression | COMPLETE | Probe removed blank before d1b setext heading; oracle rejected changed heading list |
| Oracle on every reduced spec result | PARTIAL | S:809 bypasses helper; oracle also cannot prove HTML context |
| Remove superseded scanners; no dead code | COMPLETE within reviewed source | M:142/M:222 replace old parser; named obsolete functions/constants absent; remaining private functions have callers |
| Existing fixture size/content, off-kind Python | COMPLETE for supplied fixtures | S:325, S:714; scoped suite passed |
| Jest/esbuild marked ESM packaging | COMPLETE for reviewed Node runtime | See verification below; downstream app packaging remains later-batch work |

Implicit requirements not adequately addressed: HTML tag context in comments, equivalence of guarded/lexed first-line prefixes, and shallow-container lexer cost.

## Edge cases

| Case | Handled | How / concern |
| --- | --- | --- |
| CRLF reduced and unchanged | YES | S:298/S:303 compare LF result and original bytes; M:94/M:133 |
| BOM heading | YES | S:310 verifies BOM plus heading; M:95 |
| BOM plus deep first-line container | NO | Defect 3 |
| Duplicate link definitions | YES | Reconstruction mismatch returns original, S:248 |
| Lexer throws | YES | Original returned with error name, M:98/S:257 |
| More than 262,144 code units | YES | Immediate original-input return, M:88/S:269; cap is code units, not UTF-8 bytes, as specified |
| Long pure whitespace indent | YES | Does not trigger nesting guard, S:289; lexer handles code or reconstruction fallback |
| Shallow lazy quote near cap | NO | Defect 2 |
| Cross-token details/div wrapper | YES for ordinary cases | M:107 and d3 regressions |
| Wrapper tags counterbalanced by comments | NO | Defect 1 |
| No heading / zero budget / all headings over budget | YES | Original fallback or all headings retained, M:486/M:510; S:351/S:441 |
| Repeated calls/global marked extensions | YES in probe | Fresh defaults and Lexer, M:143 |

## Verification and scope

- Read M and S in full, the named project/Jest/spec/barrel/commitlint configuration, reducer types, token measure, Decision 7/9 context and binding batch rules, and prior r1/r2 evidence. Read the existing Electron Jest transform precedent and local tsconfig/Jest preset. The task folder has no `task-description.md`, `implementation-plan.md` or style review; `batches.md:13` declares the work plan-free.
- `ptah_search_files` returned no AGENTS.md; native hidden-file discovery also found no AGENTS.md/CLAUDE.md. No direct file-read/Write tool was listed; native reads and the file patch writer were used. No reviewed source was edited and no git operations were performed.
- Scoped `ptah_get_diagnostics`: **0 errors, 0 warnings**.
- Ran the exact requested PowerShell command once: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers`. All three local targets succeeded, exit 0; cache 0/3. Tail:

  ```text
  NX Successfully ran targets test, lint, typecheck for project @ptah-extension/tool-output-reducers
  Run duration: 6.4s
  Cache: 0/3 hit (0%)
  ```

  Nx Cloud separately reported its organization disabled/free-plan 401. This did not fail the local targets. The concise output did not expose the test count; no exact count is asserted.
- Jest ESM handling is present at `jest.config.ts:6` and `:16`, with JS transformation enabled by `tsconfig.spec.json:9`; the uncached passing suite verifies this configuration. `project.json:16` externalizes marked. A separate in-memory esbuild CJS bundle of the Markdown entry, with marked/gpt-tokenizer external, loaded and executed correctly on **Node v24.15.0**, matching the reviewed runtime. This did not run the full Nx build or establish older-Node compatibility. Downstream application distribution is explicitly outside this batch (`batches.md:439`).
- Custom probes lived at `C:/Users/abdal/AppData/Local/Temp/ptah-559-fresh-review.mjs`, used installed dependencies and in-memory TypeScript transpilation, and were deleted after execution. No large inline shell script or persistent mutation was used. Global-marked mutation occurred only inside the disposable probe process.
- Oracle check: removing one d1b separator in memory was rejected by the heading-list comparison. Defect 1 still satisfies the oracle's exact raw-membership and heading-list rules. No source mutation was necessary to establish either result.
- Residual uncertainty: finite tests/probes do not prove all CommonMark/HTML combinations, worst-case lexer complexity, uncatchable heap behavior, or future pipeline integration. The three numbered findings are supported by actual observed results, without claiming an unobserved crash.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the reproduced failures; performance numbers are local measurements.
- Top risk: the HTML guard can still expose a heading outside its enclosing example context while reporting successful reduction.
- What a robust implementation would add: conservative HTML-context handling, equivalent BOM-aware guard input, a pre-lex bound for lazy blockquote workloads, and focused regressions for all three reproductions.
- This report does not authorize another implementation/review round, alter task state, or revisit accepted JSON work.
