# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION (requested verdict: REVISE) |
| Blocking issues | 3 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 3 distinct defects |

Fresh independent review of Batch 2b, revision round 2 of 2, Markdown only. The four round-1 reproductions now pass, but structure still changes silently in three reproduced scenarios. This is above the foundational-failure band because the reducer implements budgeting, atomic units and useful conservative fallbacks; it remains below 5–6 because ordinary Markdown can still expose code as a heading, lose a real heading, or detach content from its HTML context. JSON was not reviewed.

Paths below use **M** for `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts` and **S** for its adjacent `markdown.reducer.spec.ts`. These aliases apply to every file:line citation.

## Round-1 defect status

| Original defect / input | Status in this revision | Independently observed result |
| --- | --- | --- |
| 1: `# Intro\nDO NOT\ndelete production\n---\nbody`, budget 1 | FIXED for the original defect | Complete paragraph retained: `# Intro\nDO NOT\ndelete production\n---\n(section text omitted, 1 lines)`. M:188–193 moves the whole paragraph; the list/quote exclusion checks every line. Regression S:324. |
| 2A: top-level fence containing a four-space-indented backtick run, budget 30 | FIXED for this input | Output keeps `# Top`, replaces the complete five-line block with `(code block, 5 lines, omitted)`, and keeps `# Next`. M:294–299 rejects an overindented closer. Regression S:331. |
| 2B: fence opened on `- ` plus three backticks, budget 30 | FIXED for this input; container handling remains incomplete | Byte-identical `markdown-unchanged`, reason `fence inside a list item or block quote` (M:147–150). Regression S:352. New defect 2 demonstrates a continuation-line variant. |
| 3: HTML comment containing `# NOT a heading`, budget 30 | FIXED for the original comment defect | The three comment lines survive together; no standalone promoted heading. M:172–179 and M:397–400 recognize the atomic comment. Regression S:366. HTML-wrapper context remains incomplete in new defect 3. |

All four inputs were reconstructed from the archived r1 review and executed against the current source, independently of Jest assertions.

## Five logic questions

### 1. How does this fail silently?

M:132 discards the blank separator before a new heading. M:591 then joins that heading directly to retained preceding content, changing its parse without warning (defect 1). M:296 accepts an outdented list-fence boundary as a top-level closer and M:181 subsequently promotes code to a heading (defect 2). All return `markdown-outline`.

### 2. What user action produces unexpected behaviour?

Reducing a README with a setext heading after a blank-separated HTML block causes the heading to become part of the HTML block (M:177, M:193, M:591). Reducing a numbered installation step followed by a top-level fenced example can instead expose the example's `#` line as a heading (M:154). Concrete inputs follow.

### 3. What input data produces a wrong answer?

A blank-separated `<details>` example loses its summary and wrapper while retaining its inner heading (M:382, M:638–645). Ordinary paragraph text immediately before a blank-separated setext heading also becomes part of that heading after reduction (M:132, M:591). Verbatim line membership alone cannot establish structural preservation.

### 4. What happens when a dependency fails?

The only runtime import is the local token counter (M:24). Its `gpt-tokenizer` call (`libs/backend/tool-output-reducers/src/lib/token-measure.ts:29`) can throw; M:103 and M:468 propagate that failure. Pipeline exception handling belongs to the later batch, not these functions. There are no asynchronous operations, resource handles, timers or external writes in the reviewed reducer. Detected structural ambiguity returns the entire original string through M:113–114, including CRLF bytes.

### 5. What is missing that the requirements never mentioned?

The specific revision recipe does not track list containers across lines or HTML element context across blank-delimited Markdown blocks (M:210, M:382). It also does not say how a heading retains its required preceding separator (M:128). These omissions matter to the overarching “never promote, split or reword” requirement in `batches.md:391–392`; defects below distinguish implementation faults from an incomplete prescribed heuristic.

## Failure modes / numbered new defects

In the examples, `F` means exactly 30 repetitions of `body line more prose text`, joined with LF. All reported outputs were obtained from the current implementation. The already-installed `marked` lexer independently confirmed the before/after block types; no dependency was added.

### 1. Required blank separators disappear before headings

- Severity: **blocking**.
- File / evidence: M:126, M:128–132, M:188–193, M:591. A pending blank is discarded when starting a section; a setext paragraph's `blankBefore` is also discarded when it becomes a heading. Rendering has no heading separator to emit.
- Trigger / failing input, budget 70: `# Top\n<div>\nhtml\n</div>\n\nReal heading\n---\n` followed by `F`.
- Symptom: output begins `# Top\n<div>\nhtml\n</div>\nReal heading\n---\n`. The blank line is gone. The lexer originally reports HTML, space, heading; afterward it reports one HTML block containing `Real heading`, the underline and the retained body. The heading is no longer a Markdown heading.
- Second failing input, budget 70: `# Top\nBody paragraph.\n\nReal heading\n---\n` followed by `F`. Output begins `# Top\nBody paragraph.\nReal heading\n---\n`; the lexer now reports `Body paragraph.\nReal heading\n---` as one heading.
- Current handling: line selection remains verbatim, but block boundaries are lost. The returned notes report only omitted line counts.
- Impact: a real heading disappears from the outline's Markdown structure, or ordinary body text gains heading status. This is a silent misleading result under the preservation contract (`batches.md:375`, `:391`).
- Expected behaviour / fix: carry the original required blank separator with the heading and preserve it when emitting preceding content. Cover both paragraph→setext and HTML→setext, plus HTML→ATX, including the headings-only path. If a safe boundary cannot be retained using original lines, return the complete input unchanged with a reason.

### 2. An outdented fence after a list continuation closes the wrong block

- Severity: **blocking**.
- File / evidence: M:154–156, M:159, M:210–231, M:291–301. Container information exists only for the current line; `fenceClose` treats any 0–3-indent matching run as a closer. The outdent check excludes the selected closer.
- Trigger / failing input, budget 30: lines `# Top`, `1. Install:`, an empty line, three spaces plus ` ```bash ` (the three backticks immediately followed by `bash`, with no trailing space), `   echo ok`, three unindented backticks, `# still code`, three unindented backticks, `# Next`, then `F`.
- Exact compact input notation: `# Top\n1. Install:\n\n   ```bash\n   echo ok\n```\n# still code\n```\n# Next\n` + `F`.
- Observed output: `# Top\n1. Install:\n(4 lines omitted)\n# still code\n(32 lines omitted)`.
- Current handling: the first unindented fence is taken as the list fence's closer. `# still code` becomes a mandatory heading; the next fence consumes `# Next` as code.
- Independent evidence: the installed lexer parses the original as heading, list containing the indented code, a separate top-level fenced code block containing `# still code`, heading `# Next`, then paragraph. Its output parse has a real heading `# still code` and no `# Next`.
- Impact: code is promoted into document instructions and a real heading is dropped. This is the same dangerous class as r1 defect 2, on a distinct continuation-line input.
- Expected behaviour / fix: retain list-container context across lines, or conservatively return unchanged when an indented fence following a list cannot be classified safely. Include the candidate closing line when deciding whether the enclosing container changed; do not merely apply a top-level closer rule. Add this exact case independently of `fencesBalanced`.

### 3. Blank-separated Markdown inside `<details>` loses its wrapper and summary

- Severity: **blocking**.
- File / evidence: M:381–393, M:177–182, M:638–645. Candidate HTML units stop at the first blank line. No state relates the opening element to the Markdown between it and its closing element; headings-only output independently removes both HTML units.
- Trigger / failing input, budget 1: `# Top\n<details>\n<summary>Dangerous example</summary>\n\n# delete production\n\n</details>\n` followed by `F`.
- Observed output: `# Top\n# delete production\n(section text omitted, 34 lines)`.
- Current handling: the Markdown heading survives, but the collapsed example wrapper and its cautionary summary disappear. There is no unchanged fallback or note explaining this context loss.
- Impact: a heading inside a named collapsible example is exposed as an unconditional top-level document section. Preserving its text does not preserve its surrounding meaning.
- Expected behaviour / fix: preserve the complete enclosing HTML/Markdown region atomically, or use the prescribed byte-identical unchanged fallback with a reason naming the unsupported mixed HTML/Markdown container.
- Requirements distinction: the implementation follows the narrow “candidate ends before the next blank line” recipe (`batches.md:404–405`). That recipe does not establish safety for a paired HTML element containing Markdown across blanks. The broader safety principle (`batches.md:391–392`) still requires preserving context or declining to reduce. Do not fix this by simply treating the inner heading as removable ordinary text.

## Blocking issues

Numbered defects 1–3 above are the three blocking issues. Each supplies file:line evidence, failing input, actual output, impact and a concrete fix. Defect 1's two inputs share one separator-loss cause and are counted once.

## Serious issues

None additional substantiated.

## Moderate and minor issues

None additional counted. Test coverage limits and performance uncertainty are recorded below, without duplicating the blocking findings.

## Data flow

1. **OK:** input is split into logical lines (M:90); unchanged exits return the original string, not a reconstruction (M:114).
2. **PARTIAL:** scanner recognizes same-line containers, indentation and top-level fences (M:146–165). Cross-line list context is missing: defect 2.
3. **PARTIAL:** fixed-marker HTML is atomic; generic candidates stop at blank lines (M:354–420). Enclosing mixed HTML/Markdown context is lost: defect 3.
4. **PARTIAL:** full setext paragraph becomes a heading (M:188–193), but required preceding separators are discarded: defect 1.
5. **OK within checked cases:** whole-unit round-robin selection keeps source order within each section (M:526–571); oversized atomic units can use typed omission notes (M:574–575).
6. **PARTIAL:** render emits retained source lines and notes in order, or original input if no content survives (M:589–629); structural classification and separators are not repaired here.
7. **PARTIAL:** headings-only retains all classified heading lines and adds a permitted omission note (M:633–648), but cannot protect a heading whose classification/context was already lost.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Whole open paragraph in setext heading; reject any list/quote paragraph line | COMPLETE for the specified revision | M:188–193; original regression fixed |
| Same-line container, 4+ column fence, and outdented content fallbacks | COMPLETE for the specified guards | M:147–161; broader list continuation remains unsafe |
| Every heading preserved with its level; no promotion or split | PARTIAL | Defects 1 and 2 |
| Fixed-end HTML units and unterminated fallback | COMPLETE within examined cases | M:366–375; original comment regression fixed |
| Generic HTML candidate safety | PARTIAL | Literal candidate recipe implemented; mixed-container context lost, defect 3 |
| Verbatim input line subsequence plus omission notes; nonempty result | COMPLETE at the line-content level | M:619–629, M:638–645; does not prove semantic structure |
| Representative size and retained first-section lines | COMPLETE for the supplied fixture | S:505 onward; scoped checks pass |
| Pure functions, no new dependencies, no `as any` | COMPLETE in reviewed files | M:24–25 and full-file inspection |

Implicit requirements not addressed: preserving heading boundary separators; cross-line list state; paired HTML context spanning blank-separated Markdown.

## Edge cases

| Case | Handled | How / concern |
| --- | --- | --- |
| Numbered `1. Install:` with blank then three-space-indented fenced block and equally indented closer | YES | Probe retains all three fence lines together at budget 60; existing S:477 tests several budgets. This does not cover defect 2. |
| Nested block quotes before a fence | YES | `> >` plus a fence triggers unchanged, M:223–231 and M:148. |
| `<details>` with no blank before a heading | YES | Candidate detects heading and returns unchanged, M:385–390. |
| `<details>` with blank-separated Markdown | NO | Defect 3. |
| `<br>` at line start inside an open paragraph followed by setext underline | YES, conservatively | Probe `DO NOT\n<br> delete production\n---` returns unchanged; no qualifier is lost. |
| Setext paragraph after a blank-separated HTML block | NO | Defect 1. |
| Spaces mixed with tabs in fence indent | YES for examined cases | ` \t` advances to column 4 and triggers unchanged, M:217. |
| CRLF | YES for the stated line-content contract | Ambiguous input is byte-identical; reduced content uses LF (M:90, M:629). The contract does not require retained line terminators to remain CRLF. |
| All ambiguous vs ambiguity in one later section | YES | Both return the entire input unchanged, M:91–94. This is the correct scope under `batches.md:391`; reducing other sections would weaken that explicit input-level fallback. |
| No headings / budget zero / blank-only input | YES within inspected paths | M:97–99, M:619–620, M:639–640 preserve nonempty input. |
| 65,000-character spaces, quote runs, repeated list markers, backticks, unterminated comment | YES in representative probes | Approximately 0.06–5.94 ms per case; not an exhaustive worst-case proof. |

## Non-blocking notes and verification

- Read both named changed files in full, archived r1 review, binding Batch 2b/amendment text, full context, token-measure, reducer types and project configuration. The task folder contains no task-description.md, implementation-plan.md or code-style-review.md; `batches.md:13` explicitly calls this work plan-free. Direct `ptah_search_files` and hidden-file native discovery found no AGENTS.md. No direct file-read or Write tool is listed; native reads and the patch writer were used. No git operations were performed.
- Scoped `ptah_get_diagnostics` returned zero errors and warnings. Ran the exact requested scoped Nx test/lint/typecheck command once: all three targets succeeded, exit 0, cache 0/3. Nx Cloud additionally reported its organization disabled/free-plan 401; local targets succeeded. The concise output does not expose the test count, so the executor's precise 117/117 count is not independently asserted here.
- Custom probes were written to `C:/Users/abdal/AppData/Local/Temp/ptah-559-review.mjs`, executed using Node and TypeScript in-memory transpilation against the current source, then deleted. No multiline script was passed inline to a shell. `marked` was loaded from the existing worktree dependency solely as an independent block-structure check.
- The hand scanner consumes input monotonically (M:210–278); fence close and content-indent passes traverse their selected block (M:286–333), and HTML scans either consume their block or return immediately (M:354–393). No overlapping repeated-run regex was found. The requested long-line probes completed in approximately 0–6 ms locally. This is representative performance evidence, not a universal 2 MB latency guarantee.
- Structure: M is 649 lines, below the 700-line soft ceiling. Named private functions separate scanning, HTML boundaries, token estimation, selection and rendering. The file remains readable without a forced split; no `as any`, suppression directive, I/O or logging was found. Runtime dependencies remain the existing local token counter. No separate structural finding is warranted.
- `fencesBalanced` now limits indentation to 0–3 spaces (S:35–60) and the four r1 tests inspect expected retained blocks directly (S:324–386). It still checks fence balance rather than full container semantics; a balanced output cannot establish that a code line was never promoted. The new defects need explicit structural expectations.
- Omission notes and headings-only rendering preserve the lexical line-subsequence rule. Notes do not merge distinct source lines. This weaker property passes even for all three failures; tests must also check structural context.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the reproduced failures; performance measurements are representative.
- Top risk: a list-contained fence boundary causes a code comment to become a heading while a real heading disappears.
- What a robust implementation would add: original heading separators; safe cross-line container handling or conservative fallback; atomic mixed HTML/Markdown context; explicit regressions for all three defects.
- This is the requested final review round. No additional review loop, task-state change or source correction was initiated.
